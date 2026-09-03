// WHAT A JUDGE DID, MADE QUERYABLE — the impure half of the observability sink.
//
// WHY:        All three model passes persist their successes and discard their failures. A judge
//             that STOPPED ANSWERING was indistinguishable from a judge that FOUND NOTHING:
//             `runCoverageJudge`'s `failures`/`refused`/`silent` were folded into
//             `evaluateArtifact`'s `judge` object that only the direct HTTP handler ever read;
//             `supportJudge`'s disagreements went into an in-memory `escalation_refusals` dict that
//             died with the response; `stuffingJudge`'s hit count was embedded in the PROSE of one
//             `posting_wording_kept` message.
// SUPERSEDES: nothing. Every existing in-memory tally and every response field stays exactly as it
//             was — this is a SECOND, structured view of the same facts, never a replacement.
// EVIDENCE:   docs/qc-evidence/AC-judge-observability.md (feasibility rows 2, 4, 6, 8, 9),
//             docs/qc-evidence/IMPL-judge-observability.md.
//
// THIS IS INSTRUMENTATION AND IT MAY NEVER DECIDE ANYTHING. Two properties carry that, and both are
// guarded by tests rather than by this comment:
//   1. Every write here is non-fatal. `recordJudgeOutcomes` catches everything and returns a count;
//      it has no throwing path, so a sink outage cannot 500 a route or roll back a gate.
//   2. Nothing that computes a gate, a score, a coverage count or an evidence verdict imports this
//      module. `H:judge-outcome-not-gating` asserts both halves.
// An instrumentation write that can fail a gate is a worse failure mode than the blindness it cures.
//
// AGGREGATED, NEVER PER-REQUIREMENT. Callers hand over a tally — the same
// `Record<outcome_kind, count>` shape `escalation_refusals` already used — so one call writes
// O(distinct outcome kinds) rows, not O(requirements). `H:judge-outcome-volume-bounded` fails if
// that changes.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS' }

/** The judges this sink knows about. Matches the CHECK in `schema.ts` exactly. */
export type JudgeName = 'coverage' | 'support' | 'stuffing' | 'escalation'

export interface JudgeOutcomeWrite {
  oppId: string
  /** Provenance only. Null for `writeEvidence`, which is opportunity-scoped and has no artifact. */
  artifactId?: string | null
  /** Null for `writeEvidence`, which has no run id today. */
  runId?: string | null
  judge: JudgeName
  /** `{ transport_failed: 2, refused: 1 }` — the exact strings the in-memory tallies already use. */
  outcomes: Record<string, number>
}

/**
 * THE SEEDED RETENTION WINDOW, in days. `0` means keep forever.
 *
 * Code seeds the FIRST value; the owner changes it at PATCH /api/app/judge-outcome-prefs. Per the
 * repo's no-hardcoded-config rule this may never be a bare literal in the delete statement — a
 * prune threshold is exactly the sort of number an owner must be able to change without a deploy,
 * and "keep everything" has to be reachable from the same control rather than by editing code.
 */
export const DEFAULT_JUDGE_OUTCOME_RETENTION_DAYS = 90

/**
 * EXTENDS `owner_search_prefs` rather than standing up a settings table.
 *
 * That is the established per-owner settings store and `jdSweep`, `appDimensions`, `appSearchPrefs`
 * and `appRemediation` all extend it the same way, each ensuring its own columns. A second settings
 * table is the parallel-system shape "extend, don't duplicate" forbids.
 */
export async function ensureJudgeOutcomePrefs(client: any): Promise<void> {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(
    `alter table owner_search_prefs
       add column if not exists judge_outcome_retention_days int not null default ${DEFAULT_JUDGE_OUTCOME_RETENTION_DAYS}`)
}

/** The owner's retention window, or the seed when they have no row yet. Never throws. */
export async function loadJudgeOutcomeRetentionDays(client: any, owner: string): Promise<number> {
  try {
    await ensureJudgeOutcomePrefs(client)
    const r = (await client.query(
      `select judge_outcome_retention_days from owner_search_prefs where owner_email = $1`, [owner])).rows[0]
    const n = Number(r?.judge_outcome_retention_days)
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_JUDGE_OUTCOME_RETENTION_DAYS
  } catch {
    return DEFAULT_JUDGE_OUTCOME_RETENTION_DAYS
  }
}

/**
 * The table, ensured at write time.
 *
 * SCHEMA_SQL is the canonical declaration and this is deliberately the SAME shape rather than a
 * second opinion about it — `H:judge-outcome-ddl-parity` compares the two so they cannot drift. It
 * exists because the migration runner and the code deploy are separate events: a run that lands
 * before pg-migrate must record its outcomes rather than silently lose them, which is the exact
 * blindness this whole file exists to end.
 */
const ENSURE_SQL = `
  create table if not exists judge_outcome (
    id           bigserial primary key,
    opp_id       uuid not null references opportunity(id) on delete cascade,
    artifact_id  uuid references artifact(id) on delete set null,
    run_id       uuid,
    judge        text not null check (judge in ('coverage','support','stuffing','escalation')),
    outcome_kind text not null check (outcome_kind <> ''),
    count        int not null default 1 check (count > 0),
    created_at   timestamptz not null default now()
  )`

/**
 * Record one judge's tally. Returns the number of rows written — 0 is a normal answer.
 *
 * NEVER THROWS, and that is the whole safety argument rather than a nicety. Every caller is on a
 * path that decides a gate, a score or an owner's evidence, and those paths already hold the
 * standing invariant that an outage must not take the gate down (`appCoverage.ts`'s header, the
 * `.catch(() => undefined)` around both judge calls in `appChecks.ts`). A NEW write that can 500 a
 * request would be a regression against that, not a feature — so the failure of this function is
 * silence, exactly like the failures it was built to report.
 */
export async function recordJudgeOutcomes(client: any, w: JudgeOutcomeWrite): Promise<number> {
  try {
    if (!w?.oppId) return 0
    const entries = Object.entries(w.outcomes || {})
      // A zero is the absence of a row, not a row saying zero. Negative counts cannot happen and
      // are dropped rather than stored, because the CHECK would reject them and one rejected insert
      // must not cost the rest of the tally.
      .filter(([kind, n]) => kind && Number.isFinite(Number(n)) && Number(n) > 0)
    if (!entries.length) return 0
    await client.query(ENSURE_SQL)
    let written = 0
    for (const [kind, n] of entries) {
      // ONE STATEMENT PER ROW, EACH INDEPENDENTLY WRAPPED. A single rejected row (an environment
      // whose migration has not run, a kind that outgrew the CHECK) must cost that row and nothing
      // else. Deliberately NOT in a transaction: these callers are already inside their own
      // transaction discipline and an instrumentation BEGIN/ROLLBACK could interfere with theirs.
      try {
        await client.query(
          `insert into judge_outcome (opp_id, artifact_id, run_id, judge, outcome_kind, count)
           values ($1,$2,$3,$4,$5,$6)`,
          [w.oppId, w.artifactId ?? null, w.runId ?? null, w.judge, String(kind), Math.trunc(Number(n))])
        written++
      } catch { /* one row lost; the rest of the tally still lands */ }
    }
    return written
  } catch {
    // Table missing, connection gone, anything. Instrumentation reports; it does not decide.
    return 0
  }
}

/**
 * Drop rows older than the owner's retention window, for ONE opportunity. Never throws.
 *
 * Scoped to the opportunity just written rather than sweeping the table, so the cost of the prune
 * is proportional to the write that triggered it. `days <= 0` is the owner choosing to keep
 * everything and prunes nothing.
 */
export async function pruneJudgeOutcomes(client: any, oppId: string, days: number): Promise<number> {
  try {
    if (!oppId || !Number.isFinite(days) || days <= 0) return 0
    const r = await client.query(
      `delete from judge_outcome
        where opp_id = $1 and created_at < now() - make_interval(days => $2::int)`,
      [oppId, Math.trunc(days)])
    return Number(r?.rowCount || 0)
  } catch { return 0 }
}

/**
 * Record a tally and prune in one non-fatal step — what every caller actually wants.
 *
 * `owner` is only used to read the retention setting. When the caller does not have one (
 * `writeEvidence` is opportunity-scoped and takes no owner) it is resolved from the opportunity
 * rather than defaulting to the code seed behind the owner's back: the whole point of the setting
 * is that the stored value wins over the seed, and a silent fallback would delete rows on a window
 * the owner never chose.
 *
 * NOTHING IS PRUNED WHEN NOTHING WAS WRITTEN. A prune on every check run with the judges off would
 * be a DELETE for no reason on the owner's default path.
 */
export async function recordAndPrune(client: any, w: JudgeOutcomeWrite, owner?: string | null): Promise<number> {
  const written = await recordJudgeOutcomes(client, w)
  if (!written) return 0
  try {
    let who = owner || null
    if (!who) {
      who = (await client.query(
        `select owner_email from opportunity where id = $1`, [w.oppId])).rows[0]?.owner_email || null
    }
    if (who) await pruneJudgeOutcomes(client, w.oppId, await loadJudgeOutcomeRetentionDays(client, who))
  } catch { /* a failed prune is not a failed run */ }
  return written
}

// ---------------------------------------------------------------------------------------------
// GET  /api/app/judge-outcome-prefs               — the retention window and its seed
// PATCH /api/app/judge-outcome-prefs { retentionDays } — change it (0 = keep forever)
// ---------------------------------------------------------------------------------------------
//
// THE ROUTE IS THE POINT, and `appDimensions.ts` already wrote down why: a stored default with no
// writer is a constant wearing a setting's clothes. `owner_search_prefs.chk_*` was "configurable"
// for months with no route and no UI, which is the no-hardcoded-config rule satisfied on paper and
// not in the product. A retention window that only a deploy can change is the same defect.
export async function judgeOutcomePrefs(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureJudgeOutcomePrefs(client)
    if (req.method === 'PATCH') {
      const guard = requireWrite(req); if (guard) return guard
      const b = (await req.json().catch(() => ({}))) as any
      const raw = Number(b?.retentionDays)
      if (!Number.isFinite(raw) || raw < 0) {
        return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'retentionDays must be a number >= 0 (0 keeps everything)' } }
      }
      await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
      await client.query(
        `update owner_search_prefs set judge_outcome_retention_days = $2 where owner_email = $1`,
        [owner, Math.trunc(raw)])
    }
    const retentionDays = await loadJudgeOutcomeRetentionDays(client, owner)
    return {
      status: 200, headers: HEADERS,
      jsonBody: { ok: true, owner, retentionDays, seed: DEFAULT_JUDGE_OUTCOME_RETENTION_DAYS },
    }
  } catch (e: any) {
    context.error('judgeOutcomePrefs', e)
    return { status: 500, headers: HEADERS, jsonBody: { ok: false, error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/opportunity/{oppId}/judge-outcomes — what the judges did, by run.
//
// READ-ONLY AND DECIDES NOTHING. It exists so the facts this sink stores are reachable without
// hand-written SQL; no gate, score or coverage number consults it.
export async function judgeOutcomesGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const own = (await client.query(
      `select id from opportunity where id = $1 and owner_email = $2`, [req.params.oppId, owner])).rows[0]
    if (!own) return { status: 404, headers: HEADERS, jsonBody: { ok: false, error: 'not found' } }
    await client.query(ENSURE_SQL)
    const rows = (await client.query(
      `select run_id, artifact_id, judge, outcome_kind, count, created_at
         from judge_outcome where opp_id = $1
        order by created_at desc, judge, outcome_kind limit 500`, [req.params.oppId])).rows
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, opp_id: req.params.oppId, outcomes: rows } }
  } catch (e: any) {
    context.error('judgeOutcomesGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { ok: false, error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('judgeOutcomePrefs', { methods: ['GET', 'PATCH', 'OPTIONS'], authLevel: 'anonymous', route: 'app/judge-outcome-prefs', handler: judgeOutcomePrefs })
app.http('judgeOutcomesGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{oppId}/judge-outcomes', handler: judgeOutcomesGet })

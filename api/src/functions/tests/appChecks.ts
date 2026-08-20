// P2.1/P2.2 persistence, gate aggregation, and the approval block.
//
// All rule logic lives in `checks.ts`, which imports neither @azure/functions nor pg and is
// exercised by `api/test/checks.test.mjs`. This file loads the inputs, stores the results, and
// enforces the gate.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { runChecks, gateFor, attentionCount, CheckResult, CheckThresholds, DEFAULT_THRESHOLDS } from './checks'
import { computeArtifactScore, ArtifactScore } from './artifactScore'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

/**
 * Per-owner check thresholds.
 *
 * EXTENDS `owner_search_prefs` rather than creating a settings table — that is the established
 * per-owner settings store and `jdSweep.ts` already extended it the same way. Code seeds the first
 * value (from the live prompt); the owner changes it from there. No threshold in `checks.ts` may
 * become a permanent constant.
 */
export async function ensureCheckPrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(`
    alter table owner_search_prefs
      add column if not exists chk_skill_max_chars      int not null default ${DEFAULT_THRESHOLDS.skillMaxChars},
      add column if not exists chk_skills_total_min     int not null default ${DEFAULT_THRESHOLDS.skillsTotalMin},
      add column if not exists chk_skills_total_max     int not null default ${DEFAULT_THRESHOLDS.skillsTotalMax},
      add column if not exists chk_relevant_max_chars   int not null default ${DEFAULT_THRESHOLDS.relevantMaxChars},
      add column if not exists chk_relevant_allowance   int not null default ${DEFAULT_THRESHOLDS.relevantOverLimitAllowance},
      add column if not exists chk_expertise_words      int not null default ${DEFAULT_THRESHOLDS.expertiseWords},
      add column if not exists chk_cover_words_min      int not null default ${DEFAULT_THRESHOLDS.coverWords[0]},
      add column if not exists chk_cover_words_max      int not null default ${DEFAULT_THRESHOLDS.coverWords[1]}`)
}

export async function loadThresholds(client: any, owner: string): Promise<Partial<CheckThresholds>> {
  await ensureCheckPrefs(client)
  const r = (await client.query(
    `select chk_skill_max_chars, chk_skills_total_min, chk_skills_total_max, chk_relevant_max_chars,
            chk_relevant_allowance, chk_expertise_words, chk_cover_words_min, chk_cover_words_max
       from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  if (!r) return {}
  return {
    skillMaxChars: r.chk_skill_max_chars,
    skillsTotalMin: r.chk_skills_total_min,
    skillsTotalMax: r.chk_skills_total_max,
    relevantMaxChars: r.chk_relevant_max_chars,
    relevantOverLimitAllowance: r.chk_relevant_allowance,
    expertiseWords: r.chk_expertise_words,
    coverWords: [r.chk_cover_words_min, r.chk_cover_words_max],
  }
}

/**
 * Run the engine for one artifact and store the results plus the aggregated gate.
 *
 * Each run gets its own `run_id` so a run is inspectable as a set and history is preserved — a
 * regeneration must be comparable to what preceded it, which is impossible if results are
 * overwritten in place.
 */
export async function evaluateArtifact(client: any, artifactId: string, owner: string): Promise<{
  artifact_id: string; run_id: string; gate: string; attention: number; results: CheckResult[]; score: ArtifactScore
}> {
  const art = (await client.query(
    `select a.id, a.type, a.packet_id, p.opp_id, p.pkg_json, o.company, o.owner_email
       from artifact a join packet p on p.id = a.packet_id join opportunity o on o.id = p.opp_id
      where a.id = $1`, [artifactId])).rows[0]
  if (!art) throw new Error('artifact not found')

  const requirements = (await client.query(
    `select id, seq, verbatim, item_text, kind from requirement where opp_id=$1 order by seq`, [art.opp_id])).rows
  const swaps = (await client.query(
    `select action, driver, to_label, from_label from swap_decision where packet_id=$1`, [art.packet_id])).rows

  const results = runChecks({
    type: art.type,
    pkg: art.pkg_json || {},
    company: art.company,
    requirements,
    swaps,
    thresholds: await loadThresholds(client, owner || art.owner_email),
  })

  const runId = randomUUID()
  const gate = gateFor(results)
  const attention = attentionCount(results)

  // The score is computed in the SAME run as the checks and reads must-have coverage OUT of them,
  // rather than recomputing it. Two implementations of one rule drift, and the day they drift is the
  // day the gate and the score describe different states of the same artifact (R4).
  // Published, scoreable term-library entries are what keyword coverage needs; there are none yet,
  // so that component stays null rather than defaulting to a number.
  const scoreable = Number((await client.query(
    `select count(*)::int as n from term_library_entry e join term_library l on l.id = e.library_id
      where e.scoreable = true and l.published_at is not null`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0)
  const score = computeArtifactScore({
    requirements,
    checks: results,
    keyword: scoreable > 0 ? { covered: 0, scoreable } : null,
    seniority: null,          // reviewer-graded; P4 supplies it as a stored input
  })
  const uncoveredIds = score.uncovered_requirement_seqs
    .map(seq => requirements.find((r: any) => r.seq === seq))
    .filter(Boolean).map((r: any) => r.id).filter(Boolean)

  await client.query('begin')
  try {
    for (const r of results) {
      await client.query(
        `insert into check_result (artifact_id, run_id, check_key, engine, state, observed, expected, offenders)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [artifactId, runId, r.check_key, r.engine, r.state, r.observed, r.expected, r.offenders])
    }
    // The gate is REPLACED per artifact (it is the current verdict), while check_result accumulates
    // by run_id (it is the history). Overriding is cleared by a new run on purpose: an override
    // approves a specific set of findings, not the artifact forever.
    await client.query(
      `insert into artifact_gate (artifact_id, run_id, gate, attention_count, computed_at)
       values ($1,$2,$3,$4, now())
       on conflict (artifact_id) do update set
         run_id = excluded.run_id, gate = excluded.gate,
         attention_count = excluded.attention_count, computed_at = now(),
         override_by = null, override_at = null, override_reason = null`,
      [artifactId, runId, gate, attention])
    await client.query(
      `insert into artifact_score
         (artifact_id, run_id, must_have_coverage, must_have_source, keyword_coverage, keyword_source,
          seniority_alignment, seniority_source, composite, band, uncovered_requirement_ids,
          engine_version, weights)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (artifact_id, run_id) do nothing`,
      [artifactId, runId, score.must_have_coverage.value, score.must_have_coverage.source,
       score.keyword_coverage.value, score.keyword_coverage.source,
       score.seniority_alignment.value, score.seniority_alignment.source,
       score.composite, score.band, uncoveredIds, score.engine_version, JSON.stringify(score.weights)])
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }

  return { artifact_id: artifactId, run_id: runId, gate, attention, results, score }
}

/**
 * May this artifact move to `approved`?
 *
 * A `fail` blocks, full stop — only deterministic rows produce `fail`, and those are facts about the
 * text, not opinions. A `warn` blocks UNTIL overridden, and the override must already be recorded;
 * approving and overriding in one motion would let the UI skip the reason.
 *
 * An artifact with NO gate row has never been checked. That is not permission — it is the absence of
 * a verdict, and it is exactly the state a caller would exploit by approving before running checks.
 */
export async function approvalBlock(client: any, artifactId: string): Promise<{ blocked: boolean; reason: string; gate: string | null }> {
  const g = (await client.query(
    `select gate, override_by, attention_count from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
  if (!g) return { blocked: true, reason: 'no checks have been run for this artifact', gate: null }
  if (g.gate === 'fail') return { blocked: true, reason: `${g.attention_count} blocking finding(s); a fail cannot be overridden`, gate: 'fail' }
  if (g.gate === 'warn' && !g.override_by) return { blocked: true, reason: `${g.attention_count} finding(s) need an explicit override with a reason`, gate: 'warn' }
  return { blocked: false, reason: '', gate: g.gate }
}

// POST /api/app/artifact/{artifactId}/checks — run the engine and store the verdict.
export async function artifactChecksRun(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const out = await evaluateArtifact(client, req.params.artifactId, owner)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...out } }
  } catch (e: any) {
    context.error('artifactChecksRun', e)
    const msg = String(e?.message || e)
    return { status: msg === 'artifact not found' ? 404 : 500, headers: HEADERS, jsonBody: { error: msg } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/artifact/{artifactId}/checks — the latest run, its gate, and every finding.
export async function artifactChecksGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const art = (await client.query(
      `select a.id from artifact a join packet p on p.id=a.packet_id join opportunity o on o.id=p.opp_id
        where a.id=$1 and o.owner_email=$2`, [req.params.artifactId, owner])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const g = (await client.query(`select * from artifact_gate where artifact_id=$1`, [art.id])).rows[0] || null
    const results = g
      ? (await client.query(`select * from check_result where artifact_id=$1 and run_id=$2 order by check_key`, [art.id, g.run_id])).rows
      : []
    const score = g
      ? (await client.query(`select * from artifact_score where artifact_id=$1 and run_id=$2`, [art.id, g.run_id])).rows[0] || null
      : null
    const history = (await client.query(
      `select composite, band, must_have_coverage, computed_at from artifact_score
        where artifact_id=$1 order by computed_at desc limit 10`, [art.id])).rows
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        artifactId: art.id,
        gate: g?.gate ?? null,
        attention: g?.attention_count ?? 0,
        computedAt: g?.computed_at ?? null,
        override: g?.override_by ? { by: g.override_by, at: g.override_at, reason: g.override_reason } : null,
        score, history,
        results,
      },
    }
  } catch (e: any) {
    context.error('artifactChecksGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/artifact/{artifactId}/gate-override  { reason }
// Only a `warn` may be overridden. The actor is resolved SERVER-side from the verified session — a
// client-supplied actor would make the audit row worthless.
export async function artifactGateOverride(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner, verified } = resolveOwner(req)
  if (!verified) return { status: 403, headers: HEADERS, jsonBody: { error: 'an override needs a verified session — the audit row records who did it' } }
  const body: any = await req.json().catch(() => ({}))
  const reason = String(body?.reason || '').trim()
  if (reason.length < 8) return { status: 400, headers: HEADERS, jsonBody: { error: 'a reason of at least 8 characters is required' } }
  let client
  try {
    client = await getPgClient()
    const g = (await client.query(`select gate from artifact_gate where artifact_id=$1`, [req.params.artifactId])).rows[0]
    if (!g) return { status: 404, headers: HEADERS, jsonBody: { error: 'no checks have been run for this artifact' } }
    if (g.gate === 'fail') return { status: 409, headers: HEADERS, jsonBody: { error: 'a fail cannot be overridden — fix the findings or re-run the checks', gate: 'fail' } }
    if (g.gate === 'pass') return { status: 200, headers: HEADERS, jsonBody: { ok: true, gate: 'pass', note: 'nothing to override' } }
    await client.query(
      `update artifact_gate set override_by=$1, override_at=now(), override_reason=$2 where artifact_id=$3`,
      [owner, reason, req.params.artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, gate: 'warn', overriddenBy: owner, reason } }
  } catch (e: any) {
    context.error('artifactGateOverride', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('artifactChecksRun', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/checks', handler: artifactChecksRun })
app.http('artifactChecksGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/checks-result', handler: artifactChecksGet })
app.http('artifactGateOverride', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/gate-override', handler: artifactGateOverride })

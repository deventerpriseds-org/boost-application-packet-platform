// P2.1/P2.2 persistence, gate aggregation, and the approval block.
//
// All rule logic lives in `checks.ts`, which imports neither @azure/functions nor pg and is
// exercised by `api/test/checks.test.mjs`. This file loads the inputs, stores the results, and
// enforces the gate.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { runChecks, gateFor, attentionCount, CheckResult } from './checks'
import { loadThresholds, resolveOptionsFrom } from './checkPrefs'
import { computeArtifactScore, ArtifactScore } from './artifactScore'
import { loadFacts, sourceText } from './appFacts'
import { shapeVerdict } from './appReviewer'
import { resolvePostingSource } from './jdText'
import { ensureEvidenceTable, writeEvidence, loadRequirementsWithEvidence } from './appRequirements'
import { EvidenceInput, EvidenceRow } from './evidence'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

// `ensureCheckPrefs` / `loadThresholds` moved to `checkPrefs.ts` (see the note there: it broke an
// appChecks <-> appRequirements import cycle). Re-exported so every existing importer is unchanged.
export { ensureCheckPrefs, loadThresholds, resolveOptionsFor, resolveOptionsFrom } from './checkPrefs'

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
    `select a.id, a.type, a.packet_id, p.opp_id, p.pkg_json, o.company, o.owner_email,
            o.jd_real, o.raw_jd, o.why_surfaced
       from artifact a join packet p on p.id = a.packet_id join opportunity o on o.id = p.opp_id
      where a.id = $1`, [artifactId])).rows[0]
  if (!art) throw new Error('artifact not found')

  const swaps = (await client.query(
    `select action, driver, to_label, from_label from swap_decision where packet_id=$1`, [art.packet_id])).rows

  // R3 needs BOTH sides or it must not judge. The posting side is the employer's own text —
  // `resolvePostingSource`, never `groundingText`, which falls back to `jd_summary` and would have
  // the check accuse a candidate of echoing OUR OWN model's summary. The profile side is the same
  // reader the fact deriver uses, so "what the candidate owns" has exactly one answer; if it is
  // unreadable the check reports not_applicable rather than treating an empty profile as proof the
  // candidate owns nothing, which would flag every figure they legitimately hold.
  const posting = resolvePostingSource(art)
  const profileRead = await sourceText().catch(() => ({ text: '', sources: ['profile UNREADABLE'], records: [] as any[] }))
  const profile = profileRead.text

  // P8.3 / C6 — coverage is decided by evidence rows, so they are resolved and PERSISTED here and
  // then read back, rather than computed in memory for the checks alone. The JD step and the gate
  // must be looking at the same rows; two resolutions of the same question are two answers waiting
  // to disagree.
  //
  // An unreadable profile writes nothing and reports `profileReadable: false`. Resolving against an
  // empty profile would produce zero evidence rows for every requirement, and zero rows presented as
  // a measurement is the "0% covered" that means "we did not look".
  await ensureEvidenceTable(client)
  const thresholds = await loadThresholds(client, owner || art.owner_email)
  if (profileRead.records.length) {
    // The owner's thresholds reach the RESOLVER, not just the checks. `writeEvidence` used to be
    // called with no options, so `ResolveOptions` was overridable in principle and fixed in
    // production — which is the no-hardcoded-config rule broken with a settings hook attached.
    // NO TRANSPORT on the gate path either, and for a sharper reason than cost. Four artifacts of
    // one packet enter `evaluateArtifact` concurrently, each calling `writeEvidence`; with a
    // transport here that is four independent sets of model calls for the same opportunity, and
    // because two runs can return DIFFERENT proposals, the last committer wins with a row set the
    // other three were never judged against. The gate would then be reading rows that no longer
    // exist. Escalation happens ONCE, on the evidence route the build calls, before the checks run.
    await writeEvidence(client, art.opp_id, profileRead.records, resolveOptionsFrom(thresholds))
  }
  const requirements = await loadRequirementsWithEvidence(client, art.opp_id)
  const evidence: EvidenceInput = {
    profileReadable: profileRead.records.length > 0,
    bySeq: Object.fromEntries(requirements.map((r: any) => [r.seq, r.evidence_quote == null ? null : ({
      quote: r.evidence_quote,
      source_kind: r.evidence_source_kind,
      source_label: r.evidence_source_label,
      source_key: r.evidence_source_key,
      char_start: r.evidence_char_start,
      char_end: r.evidence_char_end,
      // The REAL stored values. These were being synthesized — `extra: null`, `record_sha256: ''`,
      // `resolver_version: 0` — while the columns sat in the row already selected. Inert today
      // because nothing downstream reads them, and one edit away from a digest field holding a
      // value no digest produced.
      extra: r.evidence_extra,
      // NULL stays NULL. It used to be coerced to 0, which was harmless while every row had a
      // ratio and is not any more: a proposed row has none, and 0 is a MEASUREMENT — it would read
      // as "the matcher scored this and got zero" rather than "no rule scored this at all".
      ratio: r.evidence_ratio === null || r.evidence_ratio === undefined ? null : Number(r.evidence_ratio),
      method: r.evidence_method,
      record_sha256: r.evidence_record_sha256,
      resolver_version: r.evidence_resolver_version,
      proposal_version: r.evidence_proposal_version ?? null,
    } as EvidenceRow)])),
  }

  const results = runChecks({
    type: art.type,
    pkg: art.pkg_json || {},
    company: art.company,
    requirements,
    swaps,
    postingText: posting.text,
    profileText: profile,
    evidence,
    facts: await loadFacts(client, owner || art.owner_email),
    thresholds,
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
          judged_requirement_ids, engine_version, weights)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (artifact_id, run_id) do nothing`,
      [artifactId, runId, score.must_have_coverage.value, score.must_have_coverage.source,
       score.keyword_coverage.value, score.keyword_coverage.source,
       score.seniority_alignment.value, score.seniority_alignment.source,
       score.composite, score.band, uncoveredIds,
       // READ from the check, never re-derived here. `coverable` is checks.ts's predicate and a
       // second copy of it in this file is precisely the R4 defect this column exists to close.
       results.find(r => r.check_key === 'must_have_coverage')?.judged || [],
       score.engine_version, JSON.stringify(score.weights)])
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
    // P4.2 - the two engines are separated at the TOP LEVEL of the response, not left as one flat
    // array for each client to partition. Two clients partitioning independently is how one screen
    // comes to show a model's opinion as a rule and another does not. `results` is kept as the
    // union for existing callers.
    const review = g
      ? (await client.query(`select * from review_verdict where artifact_id=$1 and run_id=$2`, [art.id, g.run_id])).rows[0] || null
      : null
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
        engines: {
          deterministic: {
            // Only these rows can produce a gate `fail` (D6). Said here so a reader of the API
            // never has to infer it from the states they happen to see.
            decides: 'pass/warn/fail',
            results: results.filter((r: any) => r.engine === 'deterministic'),
          },
          reviewer: {
            decides: 'warn at most - the reviewer grades and critiques, it never fails an artifact',
            results: results.filter((r: any) => r.engine === 'reviewer'),
            verdict: review ? shapeVerdict(review) : null,
          },
        },
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

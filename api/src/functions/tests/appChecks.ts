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
import { listCorrections } from './appCorrections'
import { EvidenceInput, EvidenceRow } from './evidence'
import { resolveTemplateSlots } from './roleFocus'
import { runCoverageJudge, judgeVerdictsFor } from './appCoverage'
import { openAiJson } from './openaiJson'

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
    `select a.id, a.type, a.packet_id, p.opp_id, p.pkg_json, p.resume_template_id, o.company, o.owner_email,
            o.jd_html, o.jd_posting_raw, o.why_surfaced
       from artifact a join packet p on p.id = a.packet_id join opportunity o on o.id = p.opp_id
      where a.id = $1`, [artifactId])).rows[0]
  if (!art) throw new Error('artifact not found')

  // THE OWNER'S PER-TEMPLATE FIXED SLOT COUNTS — the input `fixed_slot_count` grades against.
  //
  // Nothing supplied these until 2026-08-30, so the check reported `not_applicable` for EVERY packet
  // while the setting sat filled in on the template row. Measured on the rebuilt Trinnex packet the
  // same day: `skills_1` shipped 8 items against a template holding 11 and `skills_2` shipped 10
  // against 9, recorded honestly as `dropped`/`added` swap rows, and the gate could not see any of it.
  //
  // READ FROM THE PACKET'S OWN RESUME, through the same `templates/<rowKey>` reader the build used,
  // so the counts the gate grades against are the counts the swap pairing paired against. NULL
  // `resume_template_id` (every packet before 2026-08-24) means the owner's default, which resolves
  // to no per-template row and therefore all-null — `not_applicable`, unchanged from today.
  //
  // NOT passed in as an argument by `ensurePackage`: this function is also reached directly from the
  // checks route, long after any build, from an artifact id alone. A parameter would be absent on
  // that path and present on the other, which is a check that grades differently depending on who
  // asked. One derivation, from the stored row, for both callers.
  //
  // An unreadable table yields all-null, never zeros and never a throw: a slot count that cannot be
  // read must not become a `fail`, and a `0` would declare every item in the list illegal.
  const slots = await resolveTemplateSlots(art.resume_template_id)

  const swaps = (await client.query(
    `select action, driver, to_label, from_label, requirement_id, seq, list from swap_decision where packet_id=$1`, [art.packet_id])).rows

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
      // Carried through so `ruleEvidenceOf` can tell a proposal the owner ACCEPTED from one still
      // waiting. Without this the gate cannot distinguish them and coverage stays pinned at 0.
      confirmed_at: r.evidence_confirmed_at ?? null,
      confirmed_by: r.evidence_confirmed_by ?? null,
    } as EvidenceRow)])),
  }

  // THE COVERAGE JUDGE — and yes, this is a transport on the gate path, which the comment above
  // forbids. Read that comment again before deleting this one: its argument is about `writeEvidence`
  // PERSISTING ROWS SHARED BY THE FOUR ARTIFACTS OF ONE PACKET. Four concurrent runs each propose
  // different evidence for the same opportunity, the last committer wins, and the other three are
  // then gated against rows that no longer exist. Every clause of that turns on the rows being
  // shared. None of it applies here, and the reasons are structural rather than hopeful:
  //
  //   - A VERDICT IS ABOUT ONE ARTIFACT'S OWN TEXT. The resume's summary and the cover letter's body
  //     are different documents; there is no shared row for a concurrent run to overwrite.
  //   - THE ROW IS CONTENT-ADDRESSED. `verdict_key` is a digest of the requirement, the field, the
  //     field's text, the model and the prompt version — so two runs that would write the same row
  //     are writing the same ANSWER, and the write is `on conflict do nothing`. Last-committer-wins
  //     cannot produce a different state.
  //   - A SECOND RUN OF UNCHANGED TEXT SPENDS NOTHING and answers identically, which is the property
  //     the escalation tier could not have and the reason it had to move off this path.
  //
  // OFF BY DEFAULT (`chk_coverage_judge`), and every failure — transport, cap, unparseable, a query
  // that throws — yields SILENCE for the affected field rather than a negative verdict. The whole
  // call is wrapped because a judge that throws must not take the gate down with it: an artifact
  // still gets its checks, computed lexically, exactly as before this existed.
  const judgeModel = process.env.OPENAI_MODEL || 'gpt-4o'
  const coverage = await runCoverageJudge(client, {
    oppId: art.opp_id,
    artifactId: art.id,
    type: art.type,
    pkg: art.pkg_json || {},
    requirements,
    thresholds,
    model: judgeModel,
    // Temperature 0, at the owner's instruction. The model is the same literal the rest of the
    // pipeline uses — see CheckThresholds.coverageJudge for why it is not a setting yet.
    fetchJson: openAiJson({ feature: 'coverage:judge', model: judgeModel, temperature: 0, maxTokens: 2000 }),
  }).catch(() => undefined)

  const results = runChecks({
    type: art.type,
    pkg: art.pkg_json || {},
    company: art.company,
    requirements,
    judgeVerdicts: coverage && judgeVerdictsFor(coverage),
    swaps,
    postingText: posting.text,
    profileText: profile,
    evidence,
    facts: await loadFacts(client, owner || art.owner_email),
    thresholds,
    slots,
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
    // `covered: null`, NEVER 0. Nothing in the product counts per-asset term placement yet, so the
    // numerator does not exist. A literal 0 here was latent: `keyword_coverage` reads as an honest
    // null ONLY while `scoreable === 0`, and the instant a library version is published this
    // ternary would flip and render a measured-looking 0% across six consumers. Null says
    // "unmeasured"; 0 would claim "we counted, and the answer was none".
    keyword: scoreable > 0 ? { covered: null, scoreable } : null,
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
export async function approvalBlock(
  client: any, artifactId: string,
  // ADVISORY MODE, passed in rather than read here. The caller already loads the owner's thresholds,
  // and a second read inside this function would be a second answer to "what did the owner choose" —
  // the divergence this codebase keeps paying for. Defaulting to `false` means every caller that has
  // not been updated keeps the strict behaviour, which is the safe direction for an omission.
  advisory = false,
): Promise<{ blocked: boolean; reason: string; gate: string | null }> {
  const g = (await client.query(
    `select gate, override_by, attention_count from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
  if (!g) return { blocked: true, reason: 'no checks have been run for this artifact', gate: null }
  // A fail is absolutely blocking UNLESS the owner has put the gate in advisory mode, in which case
  // it becomes overridable on exactly the same terms as a warn: a verified session and a written
  // reason, recorded. Note what does NOT change — `gate` is still 'fail' and `attention_count` is
  // still the same number, so nothing about the finding is softened, only the consequence.
  if (g.gate === 'fail' && !advisory) {
    return { blocked: true, reason: `${g.attention_count} blocking finding(s); a fail cannot be overridden`, gate: 'fail' }
  }
  if (g.gate === 'fail' && !g.override_by) {
    return {
      blocked: true,
      reason: `${g.attention_count} blocking finding(s); advisory mode is on, so this needs an explicit override with a reason`,
      gate: 'fail',
    }
  }
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
        // THE ONE NEW FIELD THE CLIENT NEEDS, and it is published rather than inferred on purpose.
        // `assetGate.footerFor` states that it derives the footer "from the SERVER's gate and nothing
        // else… never inspects the check rows to form its own opinion". Advisory mode is a second
        // input to that same decision, so it has to arrive the same way — as a server-computed
        // boolean. A client that read the owner's settings itself would be a second implementation
        // of the rule, free to disagree with `approvalBlock` about whether a button should be live.
        advisory: (await loadThresholds(client, owner).catch(() => ({} as any)))?.gateAdvisory === true,
        computedAt: g?.computed_at ?? null,
        override: g?.override_by ? { by: g.override_by, at: g.override_at, reason: g.override_reason } : null,
        // THE CHANGE LOG. `app/src/api.js` has documented for two phases that "the change log rides
        // on artifactChecksResult", and `assetGate.correctionsState()` is built to read exactly this
        // key - but this payload never carried it, so the selector saw `undefined` and returned its
        // "absent" shape forever. The consequence was total: corrections were invisible in BOTH
        // surfaces that render them - the QC step's "Done for you" AND the per-field margin - while
        // the rows sat in the table the whole time.
        //
        // Measured 2026-08-23. The resume artifact of packet 4860ae3b has ONE correction ("15" ->
        // "multiple" in ResumeSummary). Rendering app/dist against fixtures identical except for
        // this key: [data-qc="blocks-corrected-for-you"] counts 0 without it and 1 with it.
        //
        // `listCorrections` is the SAME function `GET /app/artifact/{id}/corrections` uses. Two
        // queries for one change log is how the count on one surface drifts from the count on
        // another - the defect `correctionsState` already guards on the client side.
        //
        // An artifact with none returns an EMPTY ARRAY, never an absent key: "nothing needed
        // correcting" and "nobody asked" are different states and the UI says different things
        // about them. It cannot tell them apart unless they differ on the wire.
        corrections: await listCorrections(client, art.id).catch(() => []),
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
    // THE SECOND OF THE TWO SITES THAT HARD-BLOCK A FAIL, and it has to learn the setting too.
    // Updating only `approvalBlock` would leave the owner able to approve but unable to record the
    // override that approval now requires — a deadlock where each half enforces a different rule.
    const advisory = (await loadThresholds(client, owner).catch(() => ({} as any)))?.gateAdvisory === true
    if (g.gate === 'fail' && !advisory) {
      return { status: 409, headers: HEADERS, jsonBody: { error: 'a fail cannot be overridden — fix the findings or re-run the checks', gate: 'fail' } }
    }
    if (g.gate === 'pass') return { status: 200, headers: HEADERS, jsonBody: { ok: true, gate: 'pass', note: 'nothing to override' } }
    await client.query(
      `update artifact_gate set override_by=$1, override_at=now(), override_reason=$2 where artifact_id=$3`,
      [owner, reason, req.params.artifactId])
    // `g.gate`, not the literal 'warn' this used to return. Now that a fail can reach this line, a
    // hardcoded 'warn' would tell the caller its blocking findings had been downgraded — the exact
    // misreport this change is otherwise careful to avoid.
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, gate: g.gate, overriddenBy: owner, reason } }
  } catch (e: any) {
    context.error('artifactGateOverride', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('artifactChecksRun', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/checks', handler: artifactChecksRun })
app.http('artifactChecksGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/checks-result', handler: artifactChecksGet })
app.http('artifactGateOverride', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/gate-override', handler: artifactGateOverride })

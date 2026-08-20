// P4 — the independent reviewer's HTTP and persistence layer.
//
// All the judgement lives in `reviewer.ts`, which imports neither @azure/functions nor pg and is
// exercised by `api/test/reviewer.test.mjs`. This file loads the inputs, makes the one model call,
// verifies what came back against the employer's posting, and stores it.
//
// IT ATTACHES TO THE DETERMINISTIC RUN. The reviewer does not mint its own `run_id`. It reads the
// one on `artifact_gate` and writes under it, because `artifactChecksGet` selects check rows by
// `(artifact_id, run_id = artifact_gate.run_id)` — a reviewer that minted its own id would store
// rows that no reader can ever see, and the database would look correct while the product showed
// nothing. Attaching also means one run is one set of findings from two engines, rather than two
// runs somebody has to reconcile later.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { createHash } from 'node:crypto'
import { TableClient } from '@azure/data-tables'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { gateFor, attentionCount, CheckResult } from './checks'
import { computeArtifactScore, judgedMustHaveIds } from './artifactScore'
import { resolvePostingSource } from './jdText'
import { parseAgentJson } from './agentJson'
import { logUsage } from './usageMeter'
import {
  REVIEWER_VERSION, REVIEWER_PROMPT_KEYS, BUILTIN_REVIEWER_SYSTEM, BUILTIN_REVIEWER_USER,
  ReviewRequirement, buildReviewerPayload, validateCitations, parseReview, agreementFor,
  reviewerChecks, promptSourceCheck, scrubCritique, AcceptedCitation, DroppedCitation,
} from './reviewer'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

/**
 * The reviewer's model. Seeded default, overridable per deployment without a code change — the
 * point of an INDEPENDENT reviewer is partly that it need not be the model that wrote the document.
 */
export const REVIEWER_MODEL = process.env.REVIEWER_MODEL || 'gpt-4o'
const REVIEWER_TEMPERATURE = Number(process.env.REVIEWER_TEMPERATURE ?? 0.1)

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

export interface LoadedPrompt { content: string; version: number; source: 'prompts_table' | 'builtin' }

/**
 * One active prompt row, with its version.
 *
 * A missing row falls back to the built-in text and reports `source: 'builtin'` with version 0 — and
 * `promptSourceCheck` then raises that as a `warn` finding naming the partition key. The considered
 * alternative was refusing to run at all; that trades a visible, fixable warning for a QC layer that
 * silently produces no review, which is the worse failure. A stored 0 is never ambiguous because
 * `prompt_source` is NOT NULL beside it.
 */
export async function loadPrompt(key: string, builtin: string): Promise<LoadedPrompt> {
  try {
    const client = TableClient.fromConnectionString(CONN, 'Prompts')
    let best: { content: string; version: number } | null = null
    for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${key}' and is_active eq true` } })) {
      const content = String((e as any).content || '')
      const version = Number((e as any).version ?? 0)
      if (!content.trim()) continue
      if (!best || version > best.version) best = { content, version }
    }
    if (best) return { ...best, source: 'prompts_table' }
  } catch { /* the table being unreachable is a fallback, not a crash */ }
  return { content: builtin, version: 0, source: 'builtin' }
}

export interface ReviewOutcome {
  artifact_id: string
  run_id: string
  ran: boolean
  reason?: string
  grade: string | null
  seniority_alignment: number | null
  agreed: number
  disagreed: number
  citations_received: number
  citations_kept: number
  citations_dropped: number
  gate: string
  attention: number
  override_cleared: boolean
  results: CheckResult[]
}

/**
 * Run one blind review of one artifact and store it.
 *
 * `fetchJson` is injected so the test suite can exercise the whole path without a network — it is
 * not a seam for changing behaviour.
 */
export async function runReview(
  client: any,
  artifactId: string,
  owner: string,
  fetchJson: (system: string, user: string) => Promise<any> = defaultFetchJson,
): Promise<ReviewOutcome> {
  const art = (await client.query(
    `select a.id, a.type, a.packet_id, p.opp_id, p.pkg_json,
            o.company, o.role, o.owner_email, o.jd_real, o.raw_jd, o.why_surfaced, o.jd_text, o.jd_text_sha256
       from artifact a join packet p on p.id = a.packet_id join opportunity o on o.id = p.opp_id
      where a.id = $1 and o.owner_email = $2`, [artifactId, owner])).rows[0]
  if (!art) throw new Error('artifact not found')

  const gateRow = (await client.query(`select run_id, override_by from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
  if (!gateRow) throw new Error('run the deterministic checks first — a review attaches to a check run')
  const runId: string = gateRow.run_id

  const reqRows: Array<ReviewRequirement & { jd_text_sha256: string | null }> = (await client.query(
    `select id, seq, kind, item_text, verbatim, char_start, char_end, jd_text_sha256
       from requirement where opp_id=$1 order by seq`, [art.opp_id])).rows
  const requirements: ReviewRequirement[] = reqRows

  // The posting body the offsets were measured against. `jd_text` is the stored canonical string;
  // resolvePostingSource is the same function the extractor used, never a second regex.
  const resolved = resolvePostingSource(art)
  const postingText: string = art.jd_text || resolved.text
  const postingSource = art.jd_text ? (resolved.source || 'jd_text') : resolved.source

  const finish = async (ran: boolean, reason: string, rows: CheckResult[], verdict: any | null): Promise<ReviewOutcome> =>
    persist(client, artifactId, runId, rows, verdict, ran, reason, !!gateRow.override_by)

  // --- the two refusals. Both make ZERO model calls. --------------------------------------------
  if (!postingText) {
    // Measured: 116 of 1,349 parsed opportunities have no employer text at all. A review of nothing
    // is a confident opinion with no evidence behind it, and the alert-digest case is worse — it
    // would grade a resume against a mail about many jobs.
    const why = 'this opportunity has no employer posting text — there is nothing to review against'
    return finish(false, why, reviewerChecks({ review: emptyReview(), agreement: emptyAgreement(), accepted: [], dropped: [], requirements, ran: false, skippedReason: why }), null)
  }
  const digest = sha256(postingText)
  // Every recorded sha, not just the first non-null one. Rows can carry different shas when a
  // re-extraction partially completed, and consulting only the first would let a stale set through.
  // The opportunity's own digest counts too — it is the posting the offsets were measured against.
  const recorded = Array.from(new Set(
    [...reqRows.map(r => r.jd_text_sha256), art.jd_text_sha256].filter(Boolean) as string[]))
  if (recorded.length && !recorded.includes(digest)) {
    // Requirement offsets are only valid against the exact body they were measured on (schema).
    // The posting has been re-fetched since; every span citation would resolve against a different
    // string, so the honest move is to say the evidence is stale, not to review anyway.
    const why = 'the posting text has changed since the requirements were extracted — re-extract before reviewing'
    return finish(false, why, reviewerChecks({ review: emptyReview(), agreement: emptyAgreement(), accepted: [], dropped: [], requirements, ran: false, skippedReason: why }), null)
  }

  // --- the blind payload ------------------------------------------------------------------------
  const payload = buildReviewerPayload({
    type: art.type, postingText, requirements, pkg: art.pkg_json || {},
    company: art.company, jobTitle: art.role,
  })

  const [sys, usr] = await Promise.all([
    loadPrompt(REVIEWER_PROMPT_KEYS.system, BUILTIN_REVIEWER_SYSTEM),
    loadPrompt(REVIEWER_PROMPT_KEYS.user, BUILTIN_REVIEWER_USER),
  ])
  const promptRow = promptSourceCheck(sys.source, REVIEWER_PROMPT_KEYS.system, sys.version)

  const raw = await fetchJson(sys.content, `${usr.content}\n${JSON.stringify(payload)}`)
  await logUsage('artifact:review', REVIEWER_MODEL, raw?.usage)

  const parsed = parseAgentJson(raw?.choices?.[0]?.message?.content)
  if (!parsed.value) {
    const why = `the reviewer returned no JSON object (${parsed.detail})`
    return finish(false, why, [promptRow, ...reviewerChecks({ review: emptyReview(), agreement: emptyAgreement(), accepted: [], dropped: [], requirements, ran: false, skippedReason: why })], null)
  }
  const review = parseReview(parsed.value)

  // --- verification -----------------------------------------------------------------------------
  const { accepted, dropped } = validateCitations(review.citations, postingText, requirements)
  const scrub = scrubCritique(review.critique, dropped)
  review.critique = scrub.kept

  // What the deterministic engine actually reached a coverage verdict on, and what it decided.
  // Read from the stored score row rather than recomputed, so agreement is measured against the
  // number the gate was built on (R4).
  const scoreRow = (await client.query(
    `select uncovered_requirement_ids, must_have_coverage, must_have_source from artifact_score
      where artifact_id=$1 and run_id=$2`,
    [artifactId, runId])).rows[0]
  const uncoveredIds: string[] = scoreRow?.uncovered_requirement_ids || []
  const uncoveredSeqs = requirements.filter(r => uncoveredIds.includes(String(r.id))).map(r => r.seq)
  // D16. This used to be "every row of kind must_have", which is a DIFFERENT population from the one
  // `checks.ts` judged: the coverage check scores `coverable` only — must-haves minus the
  // eligibility clauses no merge field can carry, minus the rows the owner's facts own. Requirements
  // the engine never had an opinion about were therefore counted as agreeing or disagreeing with the
  // reviewer, in a number that names a disagreement.
  //
  // `judgedMustHaveIds` reads what the check PUBLISHED about the population it judged (the
  // denominator in `must_have_source`, and the uncovered ids) and never re-derives `coverable` —
  // that predicate belongs to checks.ts, and a second copy of it is the R4 defect. It is sound in
  // one direction only: a row it does not return is `not_comparable`, never silently agreed.
  const engineJudged = judgedMustHaveIds(requirements, scoreRow)
  const agreement = agreementFor(review.judgements, uncoveredSeqs, requirements, engineJudged)

  const rows = [promptRow, ...reviewerChecks({ review, agreement, accepted, dropped, requirements, ran: true })]
  if (scrub.removed.length) {
    // NO offenders. The removed lines are exactly the text that must not reach a reader — echoing
    // them here re-published the whole sentence `scrubCritique` had just deleted, unmarked, where a
    // UI rendering offenders generically prints it as a reviewer finding. The count is the finding;
    // the fabricated sentence is not evidence of anything.
    rows.push({
      check_key: 'reviewer_citations_scrubbed', engine: 'reviewer', state: 'warn',
      observed: `${scrub.removed.length} critique point(s) were removed: they rested on a quote that does not occur in the posting`,
      expected: 'every critique point stands on text the posting actually contains',
      offenders: [],
    })
  }

  return finish(true, '', rows, {
    grade: review.grade,
    seniority_alignment: review.seniority_alignment,
    agreement, accepted, dropped,
    critique: review.critique,
    prompt_key: REVIEWER_PROMPT_KEYS.system,
    prompt_version: sys.version,
    prompt_source: sys.source,
    posting_source: postingSource,
    jd_text_sha256: digest,
  })
}

const emptyReview = () => ({ grade: null, seniority_alignment: null, judgements: [], citations: [], critique: [] })
const emptyAgreement = () => ({ agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 })

async function defaultFetchJson(system: string, user: string): Promise<any> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: REVIEWER_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 4000, temperature: REVIEWER_TEMPERATURE,
      response_format: { type: 'json_object' },
    }),
  })
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`)
  return r.json()
}

/**
 * Store the reviewer's rows and re-aggregate the run.
 *
 * The gate is recomputed over EVERY row of the run, both engines, through the same `gateFor` the
 * deterministic pass used — so a reviewer warning moves the badge and the gate together, and
 * `attention_count` can never describe a different set of findings from the one on screen.
 *
 * D6 holds structurally: reviewer rows are capped at `warn` when they are constructed, and
 * `gateFor` downgrades a reviewer `fail` even if one somehow arrived. Only a deterministic `fail`
 * produces a gate `fail`.
 */
async function persist(
  client: any, artifactId: string, runId: string, rows: CheckResult[],
  verdict: any | null, ran: boolean, reason: string, hadOverride: boolean,
): Promise<ReviewOutcome> {
  await client.query('begin')
  try {
    // Re-running the reviewer on the same run replaces its own rows; it never touches the
    // deterministic ones.
    await client.query(`delete from check_result where artifact_id=$1 and run_id=$2 and engine='reviewer'`, [artifactId, runId])
    for (const r of rows) {
      await client.query(
        `insert into check_result (artifact_id, run_id, check_key, engine, state, observed, expected, offenders)
         values ($1,$2,$3,'reviewer',$4,$5,$6,$7)`,
        [artifactId, runId, r.check_key, r.state, r.observed, r.expected, r.offenders])
    }

    if (verdict) {
      await client.query(
        `insert into review_verdict
           (artifact_id, run_id, grade, seniority_alignment, agreed, disagreed, reviewer_stricter,
            reviewer_looser, citations, dropped_citations, critique, reviewer_model, prompt_key,
            prompt_version, prompt_source, blind, posting_source, jd_text_sha256, ran_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17, now())
         on conflict (artifact_id, run_id) do update set
           grade = excluded.grade, seniority_alignment = excluded.seniority_alignment,
           agreed = excluded.agreed, disagreed = excluded.disagreed,
           reviewer_stricter = excluded.reviewer_stricter, reviewer_looser = excluded.reviewer_looser,
           citations = excluded.citations, dropped_citations = excluded.dropped_citations,
           critique = excluded.critique, reviewer_model = excluded.reviewer_model,
           prompt_key = excluded.prompt_key, prompt_version = excluded.prompt_version,
           prompt_source = excluded.prompt_source, posting_source = excluded.posting_source,
           jd_text_sha256 = excluded.jd_text_sha256, ran_at = now()`,
        [artifactId, runId, verdict.grade, verdict.seniority_alignment,
         verdict.agreement.agreed, verdict.agreement.disagreed,
         verdict.agreement.reviewer_stricter, verdict.agreement.reviewer_looser,
         JSON.stringify(verdict.accepted), JSON.stringify(verdict.dropped), verdict.critique,
         REVIEWER_MODEL, verdict.prompt_key, verdict.prompt_version, verdict.prompt_source,
         verdict.posting_source, verdict.jd_text_sha256])
    }

    // --- the score's seniority component ---------------------------------------------------------
    // An UPDATE, deliberately. The deterministic pass already inserted this row for this run with
    // `on conflict do nothing`, so an insert here would be silently discarded and seniority would
    // never land — with a 200 and no error to show for it. The composite and band are recomputed
    // through `computeArtifactScore` rather than assigned, so the null-unless-all-three rule stays
    // in one place.
    if (verdict && typeof verdict.seniority_alignment === 'number') {
      const s = (await client.query(
        `select must_have_coverage, keyword_coverage, weights from artifact_score where artifact_id=$1 and run_id=$2`,
        [artifactId, runId])).rows[0]
      if (s) {
        const recomputed = computeArtifactScore({
          requirements: [], checks: [],
          keyword: null, seniority: verdict.seniority_alignment,
          weights: s.weights || undefined,
        })
        // must_have and keyword keep the values the deterministic pass measured; only the seniority
        // component and the composite that depends on it are rewritten.
        const composite = (s.must_have_coverage !== null && s.keyword_coverage !== null)
          ? Math.round(s.must_have_coverage * (s.weights?.mustHave ?? 0.5)
                     + s.keyword_coverage * (s.weights?.keyword ?? 0.3)
                     + recomputed.seniority_alignment.value! * (s.weights?.seniority ?? 0.2))
          : null
        await client.query(
          `update artifact_score set seniority_alignment=$1, seniority_source=$2, composite=$3, band=$4
            where artifact_id=$5 and run_id=$6`,
          [recomputed.seniority_alignment.value,
           `reviewer-graded (${REVIEWER_MODEL}, prompt v${verdict.prompt_version})`,
           composite, composite === null ? null : bandOf(composite), artifactId, runId])
      }
    }

    const all: CheckResult[] = (await client.query(
      `select check_key, engine, state, observed, expected, offenders from check_result
        where artifact_id=$1 and run_id=$2`, [artifactId, runId])).rows
    const gate = gateFor(all)
    const attention = attentionCount(all)
    // An override approves a SPECIFIC set of findings. The reviewer just changed that set, so the
    // override no longer describes what was approved and is cleared — but the caller is told, so it
    // is never a silent revert of a human decision.
    // `run_id=$4` matters: the run id was read BEFORE this transaction opened, so a deterministic
    // re-run interleaving in between would otherwise stamp a gate computed over the OLD run onto the
    // new run's row. With the predicate the update simply matches nothing and the newer run stands.
    //
    // The override is cleared only when the review actually produced findings. A refusal path — no
    // posting text, no model call, only not_applicable rows — revoking a human's recorded approval
    // is a side effect nobody asked for; it changed no finding, so it invalidates no approval.
    const clearOverride = ran && rows.some(r => r.state === 'warn' || r.state === 'fail')
    await client.query(
      `update artifact_gate set gate=$1, attention_count=$2, computed_at=now()`
        + (clearOverride ? `, override_by=null, override_at=null, override_reason=null` : ``)
        + ` where artifact_id=$3 and run_id=$4`, [gate, attention, artifactId, runId])
    await client.query('commit')

    return {
      artifact_id: artifactId, run_id: runId, ran, reason: reason || undefined,
      grade: verdict?.grade ?? null,
      seniority_alignment: verdict?.seniority_alignment ?? null,
      agreed: verdict?.agreement.agreed ?? 0,
      disagreed: verdict?.agreement.disagreed ?? 0,
      citations_received: (verdict?.accepted.length ?? 0) + (verdict?.dropped.length ?? 0),
      citations_kept: verdict?.accepted.length ?? 0,
      citations_dropped: verdict?.dropped.length ?? 0,
      gate, attention, override_cleared: hadOverride && clearOverride, results: rows,
    }
  } catch (e) { await client.query('rollback'); throw e }
}

const bandOf = (n: number): string => (n >= 85 ? 'strong' : n >= 70 ? 'acceptable' : 'needs_work')

// POST /api/app/artifact/{artifactId}/review — run one blind review and store it.
export async function artifactReviewRun(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const out = await runReview(client, req.params.artifactId, owner)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, reviewer_version: REVIEWER_VERSION, ...out } }
  } catch (e: any) {
    context.error('artifactReviewRun', e)
    const msg = String(e?.message || e)
    const status = msg === 'artifact not found' ? 404 : msg.startsWith('run the deterministic checks first') ? 409 : 500
    return { status, headers: HEADERS, jsonBody: { error: msg } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/artifact/{artifactId}/review — the stored verdict for the current run.
//
// Every number here is READ, never recomputed from a model response: the response body has no room
// for the raw reply at all. A surface that recounts agreement from the raw JSON is a second
// implementation of that rule and will print a different number the first time a citation is
// dropped.
export async function artifactReviewGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const art = (await client.query(
      `select a.id from artifact a join packet p on p.id=a.packet_id join opportunity o on o.id=p.opp_id
        where a.id=$1 and o.owner_email=$2`, [req.params.artifactId, owner])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const g = (await client.query(`select run_id from artifact_gate where artifact_id=$1`, [art.id])).rows[0]
    if (!g) return { status: 200, headers: HEADERS, jsonBody: { verdict: null, results: [], note: 'no checks have been run for this artifact' } }
    // Tolerant of the table not existing yet: it is created by pgMigrate, which runs on demand, so
    // between a deploy and that migration this route would otherwise 500. A missing table means no
    // review has ever been stored — which is `null`, not an error.
    const v = (await client.query(`select * from review_verdict where artifact_id=$1 and run_id=$2`, [art.id, g.run_id])
      .catch(() => ({ rows: [] }))).rows[0] || null
    const results = (await client.query(
      `select * from check_result where artifact_id=$1 and run_id=$2 and engine='reviewer' order by check_key`,
      [art.id, g.run_id])).rows
    const history = (await client.query(
      `select run_id, grade, seniority_alignment, agreed, disagreed, reviewer_model, prompt_version, ran_at
         from review_verdict where artifact_id=$1 order by ran_at desc limit 10`, [art.id])).rows
    return { status: 200, headers: HEADERS, jsonBody: { verdict: v ? shapeVerdict(v) : null, results, history } }
  } catch (e: any) {
    context.error('artifactReviewGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

/**
 * The verdict as the UI reads it.
 *
 * `dropped_citations` is reported as a COUNT and a reason breakdown, never as its quotes. The
 * quotes did not survive verification; putting them on the wire is how a fabricated quote ends up
 * rendered next to real ones.
 */
export function shapeVerdict(v: any) {
  const accepted: AcceptedCitation[] = Array.isArray(v.citations) ? v.citations : []
  const dropped: DroppedCitation[] = Array.isArray(v.dropped_citations) ? v.dropped_citations : []
  const byReason: Record<string, number> = {}
  for (const d of dropped) byReason[d.reason] = (byReason[d.reason] || 0) + 1
  return {
    run_id: v.run_id,
    grade: v.grade,
    seniority_alignment: v.seniority_alignment,
    agreed: v.agreed,
    disagreed: v.disagreed,
    reviewer_stricter: v.reviewer_stricter,
    reviewer_looser: v.reviewer_looser,
    citations: accepted,
    citations_received: accepted.length + dropped.length,
    citations_kept: accepted.length,
    citations_dropped: dropped.length,
    dropped_by_reason: byReason,
    critique: v.critique,
    reviewer_model: v.reviewer_model,
    prompt_key: v.prompt_key,
    prompt_version: v.prompt_version,
    prompt_source: v.prompt_source,
    blind: v.blind,
    posting_source: v.posting_source,
    ran_at: v.ran_at,
  }
}

app.http('artifactReviewRun', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/review', handler: artifactReviewRun })
app.http('artifactReviewGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/review-result', handler: artifactReviewGet })

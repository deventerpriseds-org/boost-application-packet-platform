// WHAT:       Runs the coverage judge for ONE artifact: reads cached verdicts, asks the model only
//             about what is missing, stores what comes back, and hands `runChecks` a verdict map.
// WHY:        `coversIn` scores "align engineering strategy with business goals" against "aligning
//             engineering strategies with business objectives" at 0.60 and calls it absent, because
//             `covText.includes('strategy')` is false against `strategies`. Measured on the owner's
//             live Trinnex packet: 0 of 19 requirements counted.
// SUPERSEDES: nothing. `coversIn` remains, and is what runs when this is off or silent.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/DIAG-coverage-recognition.md (A1, A6),
//             docs/qc-evidence/AC-llm-coverage-judge.md.
//
// THIS IS THE IMPURE HALF. Every rule lives in `coverageJudge.ts` and is exercised without a network
// or a database; this file owns only the three things that need the outside world -- the cache read,
// the call, and the write. Keeping them apart is what lets the whole tier be tested deterministically
// while a model sits in the production path.
//
// THE FAILURE POSTURE, and it is the most important thing here. Every way this can go wrong --
// transport down, unparseable answer, cap reached, a query that throws -- produces NO VERDICT for
// the affected field, never a negative one. A requirement nothing answered stays out of the map, and
// `judgeSilent` in checks.ts then excludes it from placement rather than letting the lexical
// fallback answer in the judge's name. An outage must never be storable as "the document does not
// cover this": that is absent evidence read as a finding, which is the failure this whole tier is
// built against.
import {
  buildCoverageUser, COVERAGE_SYSTEM, parseCoverageVerdicts, judgeableRequirements,
  combineFieldVerdicts, verdictKey, JUDGE_VERSION, PROMPT_VERSION,
  type CoverageVerdict, type JudgeRequirement, type JudgeResult,
} from './coverageJudge'
import { contentJson, type FetchJson } from './openaiJson'
import {
  coversIn, checkFieldsFor, MIN_JUDGEABLE_TOKENS, type CheckThresholds,
} from './checks'
import { normalizePostingText } from './jdText'
import { STUFFING_SYSTEM, buildStuffingUser, parseStuffing } from './stuffingJudge'

export interface CoverageRunInput {
  oppId: string
  artifactId: string
  type: string
  pkg: Record<string, any>
  requirements: JudgeRequirement[]
  thresholds: Partial<CheckThresholds>
  fetchJson: FetchJson
  /** The model actually asked, stored and keyed on. See CheckThresholds.coverageJudge for why it is not a setting yet. */
  model: string
}

export interface CoverageRunResult {
  /** `undefined` means the judge did not run at all -- the untouched lexical path. */
  verdicts?: Map<number, CoverageVerdict & { field: string }>
  calls: number
  cacheHits: number
  refused: number
  /** Asked and unanswered. Reported so a run that judged nothing is visible rather than silent. */
  silent: number[]
  failures: Array<{ field: string; error: string }>
}

const OFF: CoverageRunResult = { calls: 0, cacheHits: 0, refused: 0, silent: [], failures: [] }

const reqText = (r: JudgeRequirement) => String(r.verbatim || r.item_text || '')

/**
 * The fields to judge, and the text of each.
 *
 * Derived from `checkFieldsFor` -- the SAME list `runChecks` builds `covText` from -- rather than a
 * second list here. Two derivations of "which fields does this artifact have" would drift, and the
 * day they drift the judge answers about one document while the check asks about another.
 */
export function judgeableFields(type: string, pkg: Record<string, any>): Array<{ field: string; text: string }> {
  return checkFieldsFor(type)
    .filter(f => pkg?.[f] != null && String(pkg[f]).trim() !== '')
    .map(f => ({ field: f, text: String(pkg[f]) }))
}

/**
 * Judge one artifact.
 *
 * ORDER MATTERS AND IS DELIBERATE: cache first, then the cap, then the call. A packet rebuilt with
 * byte-identical text costs nothing and answers identically -- which is the whole reason the verdict
 * is stored rather than re-asked, since a model may answer the same question twice and differ.
 */
export async function runCoverageJudge(client: any, input: CoverageRunInput): Promise<CoverageRunResult> {
  if (input.thresholds?.coverageJudge !== true) return OFF

  const fields = judgeableFields(input.type, input.pkg)
  const minTokens = input.thresholds.evidenceMinTokens ?? MIN_JUDGEABLE_TOKENS
  const asked = judgeableRequirements(input.requirements || [], minTokens)
  if (!fields.length || !asked.length) return OFF

  const maxCalls = input.thresholds.coverageJudgeMaxCalls ?? 12
  const minQuote = input.thresholds.coverageJudgeMinQuoteChars ?? 20
  // The lexical answer for the SAME artifact text, stored beside the judge's so a disagreement is
  // queryable rather than anecdotal. Built exactly as runChecks builds it (checks.ts:526,710).
  const covText = normalizePostingText(fields.map(f => f.text).join('\n')).toLowerCase()

  const perField: Array<{ field: string; result: JudgeResult }> = []
  const failures: CoverageRunResult['failures'] = []
  let calls = 0
  let cacheHits = 0
  let refused = 0

  for (const { field, text } of fields) {
    const keyed = asked.map(r => ({ r, key: verdictKey({ requirement: reqText(r), field, fieldText: text, model: input.model }) }))
    let cached = new Map<string, CoverageVerdict>()
    try {
      cached = await readCached(client, input.oppId, keyed)
    } catch (e: any) {
      // A cache that cannot be read is a cache miss, never a verdict. Recorded so a broken query
      // shows up as a cost rather than as a silently model-less run.
      failures.push({ field, error: `cache: ${String(e?.message || e).slice(0, 200)}` })
    }

    const hits: CoverageVerdict[] = []
    const missing: JudgeRequirement[] = []
    for (const { r, key } of keyed) {
      const hit = cached.get(key)
      if (hit) { hits.push({ ...hit, seq: r.seq }); cacheHits++ } else missing.push(r)
    }

    if (!missing.length) { perField.push({ field, result: { verdicts: hits, refused: [], unjudged: [] } }); continue }
    if (calls >= maxCalls) {
      // THE CAP IS SILENCE, NOT A NO. What was cached still counts; what was not is unanswered, and
      // `combineFieldVerdicts` keeps it out of the map.
      failures.push({ field, error: `cap: ${maxCalls} calls already made` })
      perField.push({ field, result: { verdicts: hits, refused: [], unjudged: missing.map(r => r.seq) } })
      continue
    }

    let raw: any
    try {
      calls++
      raw = await input.fetchJson(COVERAGE_SYSTEM, buildCoverageUser(missing, field, text))
    } catch (e: any) {
      failures.push({ field, error: `transport: ${String(e?.message || e).slice(0, 200)}` })
      perField.push({ field, result: { verdicts: hits, refused: [], unjudged: missing.map(r => r.seq) } })
      continue
    }

    const parsed = parseCoverageVerdicts(contentJson(raw), missing, text)
    // The quote floor the profile side already applies, pointed at the document: a two-character
    // "quote" is present in every document ever written and shows nothing.
    const kept = parsed.verdicts.filter(v => !v.covered || (v.quote || '').length >= minQuote)
    refused += parsed.refused.length + (parsed.verdicts.length - kept.length)

    try {
      await writeVerdicts(client, input, field, text, covText, kept, missing)
    } catch (e: any) {
      // A verdict that could not be stored is still a valid answer for THIS run. It costs a call
      // next time; it does not change what the owner is told now.
      failures.push({ field, error: `write: ${String(e?.message || e).slice(0, 200)}` })
    }

    perField.push({
      field,
      result: {
        verdicts: [...hits, ...kept],
        refused: parsed.refused,
        unjudged: [...parsed.unjudged, ...parsed.verdicts.filter(v => !kept.includes(v)).map(v => v.seq)],
      },
    })
  }

  const combined = combineFieldVerdicts(perField, asked.map(r => r.seq))
  return { verdicts: combined.verdicts, calls, cacheHits, refused, silent: combined.silent, failures }
}

async function readCached(
  client: any, oppId: string, keyed: Array<{ r: JudgeRequirement; key: string }>,
): Promise<Map<string, CoverageVerdict>> {
  const rows = (await client.query(
    `select verdict_key, covered, basis, quote, char_start, char_end, why, judge_version
       from requirement_coverage
      where opp_id = $1 and verdict_key = any($2::text[])`,
    [oppId, keyed.map(k => k.key)])).rows || []
  const out = new Map<string, CoverageVerdict>()
  for (const row of rows) {
    out.set(row.verdict_key, {
      seq: -1,                       // filled in by the caller from the key's own requirement
      covered: row.covered === true,
      basis: row.basis,
      quote: row.quote ?? null,
      char_start: row.char_start ?? null,
      char_end: row.char_end ?? null,
      why: row.why,
      judge_version: row.judge_version,
    })
  }
  return out
}

async function writeVerdicts(
  client: any, input: CoverageRunInput, field: string, text: string, covText: string,
  verdicts: CoverageVerdict[], asked: JudgeRequirement[],
): Promise<void> {
  const bySeq = new Map(asked.map(r => [r.seq, r]))
  for (const v of verdicts) {
    const r = bySeq.get(v.seq)
    if (!r) continue
    await client.query(
      `insert into requirement_coverage
         (opp_id, artifact_id, field, requirement_text, verdict_key, covered, basis, quote,
          char_start, char_end, why, lexical_covered, judge_version, prompt_version, model)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (opp_id, verdict_key) do nothing`,
      [input.oppId, input.artifactId, field, reqText(r),
       verdictKey({ requirement: reqText(r), field, fieldText: text, model: input.model }),
       v.covered, v.basis, v.quote, v.char_start, v.char_end, v.why,
       // What `coversIn` said about the same artifact text. The measurement that answers "is the
       // judge earning its calls", and the column the UI reads to show both readings.
       coversIn(covText, r), JUDGE_VERSION, PROMPT_VERSION, input.model])
  }
}

/** The shape `CheckInput.judgeVerdicts` takes. Narrowed here so `checks.ts` never sees this module. */
export function judgeVerdictsFor(result: CoverageRunResult) {
  if (!result.verdicts) return undefined
  const out = new Map<number, { covered: boolean; basis: string; quote: string | null; why: string }>()
  for (const [seq, v] of result.verdicts) out.set(seq, { covered: v.covered, basis: v.basis, quote: v.quote, why: v.why })
  return out
}

/**
 * THE STUFFING READ — does a passage name the posting's topics without claiming any of them?
 *
 * LIVES HERE rather than in a module of its own because it is the same shape as the coverage judge
 * and shares every part of it: the same transport, the same per-field loop, the same rule that a
 * citation is verified byte-exact before anyone sees it, and the same owner switch. A second runner
 * would be a second place to fix the day any of those changes.
 *
 * WHAT IT ADDS TO WHAT ALREADY EXISTS. `scanWording` finds contiguous runs of 8+ tokens lifted from
 * the ad; this finds the scattered kind it structurally cannot see. Both feed ONE check
 * (`posting_wording_kept`), which is a `warn` the writer decides and can never fail a gate.
 *
 * NOT CACHED, deliberately and with the cost stated rather than hidden. A verdict about a
 * REQUIREMENT is worth storing because the gate reads it and must not flip between runs; this
 * produces a `warn` a person reads, so a re-run that returns slightly different prose costs nothing
 * but a call. It is bounded by the SAME per-run cap as the judge and runs only on fields that carry
 * prose. Tracked as `D:stuffing-read-is-not-cached` if that stops being an acceptable trade.
 */
export async function runStuffingRead(input: {
  type: string
  pkg: Record<string, any>
  postingText: string
  thresholds: Partial<CheckThresholds>
  fetchJson: FetchJson
}): Promise<{ hits: Array<{ field: string; phrase: string; why: string }>; calls: number; refused: number; failures: string[] }> {
  const off = { hits: [], calls: 0, refused: 0, failures: [] as string[] }
  if (input.thresholds?.coverageJudge !== true) return off
  const posting = String(input.postingText || '').trim()
  if (!posting) return off          // nothing to compare against is not a finding

  const fields = judgeableFields(input.type, input.pkg)
  if (!fields.length) return off
  const maxCalls = input.thresholds.coverageJudgeMaxCalls ?? 12

  const hits: Array<{ field: string; phrase: string; why: string }> = []
  const failures: string[] = []
  let calls = 0
  let refused = 0
  for (const { field, text } of fields) {
    if (calls >= maxCalls) { failures.push(`${field}: cap`); continue }
    try {
      calls++
      const parsed = parseStuffing(
        contentJson(await input.fetchJson(STUFFING_SYSTEM, buildStuffingUser(field, text, posting))), text)
      refused += parsed.refused.length
      for (const h of parsed.hits) hits.push({ field, phrase: h.phrase, why: h.why })
    } catch (e: any) {
      // A read that could not run raises NOTHING. Silence is the correct output of a failure here:
      // this surface accuses the owner's own prose, so an outage must never produce a finding.
      failures.push(`${field}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return { hits, calls, refused, failures }
}

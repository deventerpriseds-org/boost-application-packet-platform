// P4.1 — the blind reviewer, as pure logic. No @azure/functions, no pg, no network.
//
// WHAT MAKES IT INDEPENDENT. A second model asked to grade its own pipeline's work, while shown
// that pipeline's reasoning, agrees with it. That is not review, it is an echo with a token cost.
// The reviewer here is shown exactly three things — the employer's posting text, the extracted
// requirement rows, and the finished asset — and nothing else. Not the generator's rationale, not
// the swap reasons, not the deterministic check results, not the score. `buildReviewerPayload`
// builds from an ALLOWLIST and `assertBlind` re-walks the finished payload and throws if any
// forbidden key survived at any depth, so "the payload is blind" is a test, not a claim.
//
// WHAT MAKES ITS OUTPUT SAFE TO SHOW. A model asked for quotes will invent them. Every citation is
// re-checked server-side against the employer's own text, EXACTLY:
//   1. the quote must be long enough to identify anything at all,
//   2. it must occur in the posting text the requirement offsets were recorded against, and
//   3. at least one of its occurrences must land inside the span of the requirement it claims.
// A quote that appears somewhere else in the posting is the adversarial case this exists to catch:
// it is real text, it is verifiable, and it is evidence for a different requirement. Dropped
// citations are COUNTED and stored, because a model that fabricates is itself a finding.
//
// Matching is exact (modulo whitespace), never fuzzy. A citation NAMES a requirement — it is
// accusation-grade, and the standing rule is that fuzzy matching ranks, it never accuses.
import { CheckResult, CheckState } from './checks'
import { mergeFieldsFor } from './insertions'

export const REVIEWER_VERSION = 1

/** Grades share the vocabulary of `artifact_score.band` so the UI never carries two scales. */
export type Grade = 'strong' | 'acceptable' | 'needs_work'
export const GRADES: Grade[] = ['strong', 'acceptable', 'needs_work']

export interface ReviewRequirement {
  id: string
  seq: number
  kind: string
  item_text: string
  verbatim: string | null
  char_start: number | null
  char_end: number | null
}

// ---------------------------------------------------------------------------------------------
// Blindness
// ---------------------------------------------------------------------------------------------

/**
 * Keys that carry the generator's reasoning. If any of these reaches the reviewer the review is no
 * longer independent, so their presence anywhere in the payload is a thrown error rather than a
 * warning. Matched case-insensitively against the key name, as a whole word or a snake/camel part,
 * so `swapReason` and `swap_reason` are both caught while an innocent `season` is not.
 */
export const BLIND_FORBIDDEN_KEYS = [
  'rationale', 'reason', 'reasons', 'swap', 'swaps', 'swap_decision', 'driver',
  'steps', 'role_focus', 'roledirective', 'directive', 'calls', 'c1', 'c2', 'c3',
  'check', 'checks', 'check_result', 'checkresults', 'gate', 'offenders',
  'score', 'composite', 'band', 'critique', 'grade', 'verdict', 'coverage',
]

const keyParts = (key: string): string[] =>
  String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map(s => s.toLowerCase())

/** True when a key name carries generator reasoning. Whole-part match — never a substring. */
export function isForbiddenKey(key: string): boolean {
  const parts = keyParts(key)
  const whole = parts.join('_')
  return BLIND_FORBIDDEN_KEYS.includes(whole) || parts.some(p => BLIND_FORBIDDEN_KEYS.includes(p))
}

/**
 * Walk the finished payload and throw on the first forbidden key, naming its path.
 *
 * Deliberately run on the OUTPUT of `buildReviewerPayload` rather than trusting it: the allowlist
 * protects against fields we thought of, this protects against the nested object someone passes
 * through later. `_meta` keys the payload itself defines are exempt by path, listed explicitly.
 */
export function assertBlind(payload: any, path = '$', exempt: string[] = []): void {
  if (payload === null || typeof payload !== 'object') return
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertBlind(v, `${path}[${i}]`, exempt))
    return
  }
  for (const [k, v] of Object.entries(payload)) {
    const p = `${path}.${k}`
    if (!exempt.includes(p) && isForbiddenKey(k)) {
      throw new Error(`reviewer payload is not blind: ${p} carries generator reasoning`)
    }
    assertBlind(v, p, exempt)
  }
}

export interface ReviewerPayloadInput {
  type: string
  /** The employer's own posting text — `resolvePostingSource(opp).text`, never a model summary. */
  postingText: string
  requirements: ReviewRequirement[]
  /** The finished asset's merge fields. Only the fields the template actually has are sent. */
  pkg: Record<string, any>
  company?: string
  jobTitle?: string
}

export interface ReviewerPayload {
  asset_type: string
  company: string
  job_title: string
  posting: string
  requirements: Array<{ requirement_id: string; seq: number; kind: string; text: string }>
  asset: Record<string, string>
}

/**
 * The exact object the reviewer sees.
 *
 * Asset fields come from `mergeFieldsFor(type)` — the same TEMPLATE_META table that decides what a
 * document can hold — so pipeline bookkeeping that rides along in `pkg` (`_parsedFieldCount` and
 * friends) is excluded by construction rather than by a denylist that has to keep up.
 *
 * Requirement rows send `item_text` (the model paraphrase) and NOT `verbatim`. Handing the reviewer
 * the posting substring the extractor already chose would let it "cite" by copying that field back,
 * which validates perfectly and proves nothing. It has the whole posting; finding the words is the
 * work being asked for.
 */
export function buildReviewerPayload(input: ReviewerPayloadInput): ReviewerPayload {
  const fields = mergeFieldsFor(input.type)
  const asset: Record<string, string> = {}
  for (const f of fields) {
    const v = input.pkg?.[f]
    if (typeof v === 'string' && v.trim()) asset[f] = v
  }
  const payload: ReviewerPayload = {
    asset_type: input.type,
    company: input.company || '',
    job_title: input.jobTitle || '',
    posting: input.postingText || '',
    requirements: (input.requirements || []).map(r => ({
      requirement_id: r.id,
      seq: r.seq,
      kind: r.kind,
      text: r.item_text,
    })),
    asset,
  }
  // `$.requirements[i].kind` is the requirement's own must_have/nice_to_have classification, which
  // the reviewer needs; it is not a generator opinion. Nothing else is exempt.
  assertBlind(payload, '$', [])
  return payload
}

// ---------------------------------------------------------------------------------------------
// Citation validation
// ---------------------------------------------------------------------------------------------

/**
 * A quote shorter than this cannot identify a requirement. Measured against the corpus: three-word
 * fragments such as "product management experience" occur in most postings more than once, so a
 * short quote that "validates" is validating the posting's vocabulary, not the claim.
 */
export const MIN_QUOTE_CHARS = 20
export const MIN_QUOTE_WORDS = 4

export type DropReason =
  | 'quote_too_short'
  | 'quote_not_in_posting'
  | 'unknown_requirement'
  | 'requirement_has_no_anchor'
  | 'quote_does_not_resolve_to_requirement'
  | 'no_posting_text'

export interface Citation {
  requirement_id: string
  verbatim_quote: string
  claim: string
}

export interface AcceptedCitation extends Citation {
  seq: number
  char_start: number
  char_end: number
}

export interface DroppedCitation extends Citation {
  reason: DropReason
  detail: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every occurrence of `quote` in `postingText`, as spans into that exact string.
 *
 * TWO tolerances, and no others: whitespace between tokens (`\s+`, because the model re-wraps
 * lines) and letter case (the `i` flag, because the model title-cases and upper-cases what it
 * quotes). No stemming, no stopword removal, no similarity threshold, no token dropping — one
 * changed word is a different quote and does not match.
 *
 * Because case is tolerated, the model's own string is NOT what gets stored: the caller slices the
 * posting at the returned span, so what reaches the user is the employer's bytes. A field named
 * `verbatim_quote` holding a case-shifted paraphrase of the employer's words would be a small lie
 * in exactly the place this module exists to prevent one.
 *
 * The returned spans index the ORIGINAL string, so they are directly comparable to
 * `requirement.char_start`.
 */
export function findQuoteSpans(quote: string, postingText: string): Array<{ start: number; end: number }> {
  const tokens = String(quote || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || !postingText) return []
  const re = new RegExp(tokens.map(escapeRe).join('\\s+'), 'gi')
  const out: Array<{ start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(postingText)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length })
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return out
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end

/**
 * Keep the citations the posting supports; drop the rest with a reason.
 *
 * Nothing is repaired, nudged, or matched approximately. A citation either resolves to the
 * requirement it names, in the employer's own text, or it does not reach the user.
 */
export function validateCitations(
  citations: Citation[],
  postingText: string,
  requirements: ReviewRequirement[],
): { accepted: AcceptedCitation[]; dropped: DroppedCitation[] } {
  const accepted: AcceptedCitation[] = []
  const dropped: DroppedCitation[] = []
  const byId = new Map(requirements.map(r => [String(r.id), r]))

  for (const c of citations || []) {
    const quote = String(c?.verbatim_quote || '').trim()
    const base: Citation = { requirement_id: String(c?.requirement_id || ''), verbatim_quote: quote, claim: String(c?.claim || '') }
    const drop = (reason: DropReason, detail: string) => dropped.push({ ...base, reason, detail })

    if (!postingText) { drop('no_posting_text', 'no employer posting text to verify against'); continue }
    const wordCount = quote.split(/\s+/).filter(Boolean).length
    if (quote.length < MIN_QUOTE_CHARS || wordCount < MIN_QUOTE_WORDS) {
      drop('quote_too_short', `${quote.length} chars / ${wordCount} words; need >= ${MIN_QUOTE_CHARS} chars and >= ${MIN_QUOTE_WORDS} words`)
      continue
    }
    const req = byId.get(base.requirement_id)
    if (!req) { drop('unknown_requirement', 'no requirement row has that id'); continue }

    const spans = findQuoteSpans(quote, postingText)
    if (!spans.length) { drop('quote_not_in_posting', 'the quote does not occur in the employer posting text'); continue }

    if (req.char_start === null || req.char_end === null) {
      // An unlocatable requirement has no span to resolve against. Its `verbatim` is null too (the
      // schema enforces that pairing), so there is no anchor at all — and absent evidence is never
      // an acceptance.
      drop('requirement_has_no_anchor', `requirement #${req.seq} was never located in the posting (match_method unlocatable/beyond_model_window/no_posting)`)
      continue
    }
    const reqSpan = { start: req.char_start, end: req.char_end }
    const hit = spans.find(s => overlaps(s, reqSpan))
    if (!hit) {
      drop('quote_does_not_resolve_to_requirement',
        `the quote occurs at ${spans.map(s => `${s.start}-${s.end}`).join(', ')} but requirement #${req.seq} spans ${reqSpan.start}-${reqSpan.end}`)
      continue
    }
    // The employer's actual bytes at the matched span — not `quote`, which is the model's
    // rendering of them and may differ in case and whitespace.
    accepted.push({ ...base, verbatim_quote: postingText.slice(hit.start, hit.end), seq: req.seq, char_start: hit.start, char_end: hit.end })
  }
  return { accepted, dropped }
}

// ---------------------------------------------------------------------------------------------
// Parsing the reviewer's reply
// ---------------------------------------------------------------------------------------------

export interface RequirementJudgement {
  requirement_id: string
  covered: boolean
}

export interface ParsedReview {
  grade: Grade | null
  seniority_alignment: number | null
  judgements: RequirementJudgement[]
  citations: Citation[]
  critique: string[]
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/**
 * Normalise the reviewer's JSON object into the shape the rest of P4 stores.
 *
 * Anything unrecognised becomes null rather than a default. A grade the model did not give must not
 * arrive as "acceptable"; a seniority number it did not give must not arrive as 0, which would feed
 * a real value into the composite score and make it look measured.
 */
export function parseReview(value: Record<string, any> | null | undefined): ParsedReview {
  const v: any = value || {}
  const gradeRaw = String(v.grade ?? '').toLowerCase().trim().replace(/\s+/g, '_')
  const grade = (GRADES as string[]).includes(gradeRaw) ? gradeRaw as Grade : null

  const sr = v.seniority_alignment ?? v.seniorityAlignment
  const sn = typeof sr === 'number' ? sr : (typeof sr === 'string' && sr.trim() !== '' ? Number(sr) : NaN)
  const seniority_alignment = Number.isFinite(sn) ? clamp100(sn) : null

  const rawJ = Array.isArray(v.requirements) ? v.requirements : (Array.isArray(v.judgements) ? v.judgements : [])
  const judgements: RequirementJudgement[] = rawJ
    .filter((j: any) => j && (j.requirement_id ?? j.requirementId))
    .map((j: any) => ({
      requirement_id: String(j.requirement_id ?? j.requirementId),
      covered: j.covered === true || j.covered === 'true' || j.covered === 'yes',
    }))

  const citations: Citation[] = (Array.isArray(v.citations) ? v.citations : [])
    .filter((c: any) => c && typeof c === 'object')
    .map((c: any) => ({
      requirement_id: String(c.requirement_id ?? c.requirementId ?? ''),
      verbatim_quote: String(c.verbatim_quote ?? c.verbatimQuote ?? c.quote ?? ''),
      claim: String(c.claim ?? ''),
    }))

  const critique: string[] = (Array.isArray(v.critique) ? v.critique : (v.critique ? [v.critique] : []))
    .map((s: any) => String(s || '').trim()).filter(Boolean)

  return { grade, seniority_alignment, judgements, citations, critique }
}

/**
 * Remove any critique line that repeats a quote the validator dropped.
 *
 * `citations[]` and `critique[]` come out of the same model call, so a quote refused as fabricated
 * can walk straight back onto the screen inside a critique bullet — where it reads as the reviewer's
 * own observation and carries no "unverified" marking at all. Dropping the whole line is the right
 * severity: a line built around a quote that does not exist is not repairable by deleting the quote.
 *
 * Only quotes long enough to be identifying are used as scrub keys, so a two-word drop cannot
 * silently delete unrelated criticism.
 */
export function scrubCritique(critique: string[], dropped: DroppedCitation[]): { kept: string[]; removed: string[] } {
  const keys = dropped
    .map(d => d.verbatim_quote.trim())
    .filter(q => q.length >= MIN_QUOTE_CHARS)
    .map(q => q.split(/\s+/).filter(Boolean))
    .filter(t => t.length >= MIN_QUOTE_WORDS)
    .map(t => new RegExp(t.map(escapeRe).join('\\s+'), 'i'))
  const kept: string[] = []
  const removed: string[] = []
  for (const line of critique || []) {
    if (keys.some(re => re.test(line))) removed.push(line)
    else kept.push(line)
  }
  return { kept, removed }
}

// ---------------------------------------------------------------------------------------------
// Agreement — measured server-side, never reported by either engine about itself
// ---------------------------------------------------------------------------------------------

export interface Agreement {
  agreed: number
  disagreed: number
  /** Requirement seqs the reviewer calls uncovered where the deterministic engine called them covered. */
  reviewer_stricter: number[]
  /** Requirement seqs the reviewer calls covered where the deterministic engine called them uncovered. */
  reviewer_looser: number[]
  /** Judgements naming a requirement id that does not exist. Never counted either way. */
  unmatched: number
  /**
   * Judgements about requirements the DETERMINISTIC engine never judged.
   *
   * `must_have_coverage` judges must-haves, minus the ones the owner's facts settled and the ones no
   * merge field can reach. The reviewer judges everything it is given. Counting a judgement the
   * rules engine never made as "agreement" would manufacture consensus out of silence, so those are
   * counted here and excluded from both agreed and disagreed.
   */
  not_comparable: number
}

/**
 * Compare the reviewer's per-requirement judgement to the deterministic engine's.
 *
 * The reviewer never saw the deterministic verdict — that is the whole point — so the comparison
 * happens here, after both exist, and the counts are STORED. A UI that recomputes agreement from a
 * raw response is a second implementation of this rule and will eventually print a different number
 * from the one the gate was built on (R4).
 */
export function agreementFor(
  judgements: RequirementJudgement[],
  uncoveredSeqs: number[],
  requirements: ReviewRequirement[],
  /** Requirement ids the deterministic engine actually reached a coverage verdict on. */
  engineJudgedIds: Iterable<string>,
): Agreement {
  const byId = new Map(requirements.map(r => [String(r.id), r]))
  const judged = new Set(Array.from(engineJudgedIds, String))
  const uncovered = new Set(uncoveredSeqs)
  const out: Agreement = { agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 }
  for (const j of judgements || []) {
    const id = String(j.requirement_id)
    const req = byId.get(id)
    if (!req) { out.unmatched++; continue }
    if (!judged.has(id)) { out.not_comparable++; continue }
    const engineCovered = !uncovered.has(req.seq)
    if (engineCovered === j.covered) { out.agreed++; continue }
    out.disagreed++
    if (engineCovered && !j.covered) out.reviewer_stricter.push(req.seq)
    else out.reviewer_looser.push(req.seq)
  }
  out.reviewer_stricter.sort((a, b) => a - b)
  out.reviewer_looser.sort((a, b) => a - b)
  return out
}

// ---------------------------------------------------------------------------------------------
// Reviewer rows for check_result
// ---------------------------------------------------------------------------------------------

/**
 * D6, enforced at the point of construction: a reviewer row may never be `fail`.
 *
 * `gateFor` already downgrades a reviewer `fail` when aggregating, but a stored `fail` would still
 * render as a blocking finding in every list that reads the rows directly. Capping here means the
 * row that exists is the row that is true.
 */
const cap = (state: CheckState): CheckState => (state === 'fail' ? 'warn' : state)

const row = (check_key: string, state: CheckState, observed: string, expected: string, offenders: string[] = []): CheckResult =>
  ({ check_key, engine: 'reviewer', state: cap(state), observed, expected, offenders })

const notComparable = (a: Agreement): string =>
  a.not_comparable ? `; ${a.not_comparable} not comparable (the rules engine judged no coverage for them)` : ''

/**
 * The prompt this review ran on, as a finding.
 *
 * A review produced from the built-in fallback is a real review, but it did not run on the prompt
 * the owner authored and can edit — so it is surfaced as a `warn` naming the missing partition key,
 * not swallowed. The alternative considered was refusing to run at all; that trades a visible,
 * fixable warning for a silent absence of review, which is the worse failure for a QC layer.
 */
export function promptSourceCheck(source: 'prompts_table' | 'builtin', key: string, version: number): CheckResult {
  return source === 'prompts_table'
    ? row('reviewer_prompt_source', 'pass', `${key} v${version} from the Prompts table`, 'the reviewer runs on an owner-authored prompt row')
    : row('reviewer_prompt_source', 'warn', `no active "${key}" row in the Prompts table — the built-in fallback was used (recorded as version 0)`,
        'the reviewer runs on an owner-authored prompt row', [`Prompts partition key "${key}" has no active row`])
}

export interface ReviewerCheckInput {
  review: ParsedReview
  agreement: Agreement
  accepted: AcceptedCitation[]
  dropped: DroppedCitation[]
  requirements: ReviewRequirement[]
  /** False when the model produced no usable JSON at all. */
  ran: boolean
  /** Why the reviewer could not run, when it did not. */
  skippedReason?: string
}

/**
 * The reviewer's findings, as `check_result` rows with `engine: 'reviewer'`.
 *
 * Every branch that has nothing to judge returns `not_applicable`, never `pass`. A reviewer row
 * that says `pass` because there were no requirements to review is exactly the row that turns an
 * unreviewed artifact green.
 */
export function reviewerChecks(input: ReviewerCheckInput): CheckResult[] {
  const { review, agreement, accepted, dropped, requirements, ran } = input
  const out: CheckResult[] = []
  const KEYS = ['reviewer_grade', 'reviewer_coverage_agreement', 'reviewer_citations', 'reviewer_critique']
  // `reviewer_prompt_source` is NOT in this list: it is emitted by promptSourceCheck whenever a
  // prompt was resolved at all, including on a run that then produced nothing usable.

  if (!ran) {
    const why = input.skippedReason || 'the reviewer produced no usable output'
    for (const k of KEYS) out.push(row(k, 'not_applicable', why, 'an independent review of this artifact'))
    return out
  }

  // --- grade ------------------------------------------------------------------------------------
  if (review.grade === null) {
    out.push(row('reviewer_grade', 'not_applicable', 'the reviewer returned no recognisable grade', `one of ${GRADES.join(', ')}`))
  } else if (review.grade === 'needs_work') {
    out.push(row('reviewer_grade', 'warn', 'the independent reviewer graded this needs_work',
      'strong or acceptable', review.critique.slice(0, 5)))
  } else {
    out.push(row('reviewer_grade', 'pass', `the independent reviewer graded this ${review.grade}`, 'strong or acceptable'))
  }

  // --- coverage agreement -----------------------------------------------------------------------
  if (!requirements.length) {
    out.push(row('reviewer_coverage_agreement', 'not_applicable', 'the posting produced no requirement rows to agree about',
      'the reviewer and the rules engine reach the same coverage verdict'))
  } else if (!review.judgements.length) {
    out.push(row('reviewer_coverage_agreement', 'not_applicable', `the reviewer judged none of the ${requirements.length} requirements`,
      'a per-requirement coverage judgement'))
  } else if (agreement.disagreed > 0) {
    // Only the STRICTER disagreements are named as offenders. Where the reviewer is looser it is
    // arguing that a deterministic finding is wrong — that argument belongs in the critique, and it
    // must not read as a new finding against the document.
    const offenders = agreement.reviewer_stricter.map(seq => {
      const r = requirements.find(x => x.seq === seq)
      return `#${seq} ${r ? r.item_text.slice(0, 140) : ''}`.trim()
    })
    out.push(row('reviewer_coverage_agreement', offenders.length ? 'warn' : 'pass',
      `${agreement.agreed} agreed, ${agreement.disagreed} disagreed (${agreement.reviewer_stricter.length} stricter, ${agreement.reviewer_looser.length} looser)${notComparable(agreement)}`,
      'the reviewer and the rules engine reach the same coverage verdict', offenders))
  } else if (!agreement.agreed && !agreement.disagreed) {
    // Every judgement was about a requirement the rules engine never reached a verdict on. There is
    // no agreement to report — reporting "0 disagreed" as a pass would read as consensus.
    out.push(row('reviewer_coverage_agreement', 'not_applicable',
      `the rules engine reached no coverage verdict on any of the ${review.judgements.length} requirement(s) the reviewer judged${notComparable(agreement)}`,
      'the reviewer and the rules engine reach the same coverage verdict'))
  } else {
    out.push(row('reviewer_coverage_agreement', 'pass', `${agreement.agreed} agreed, 0 disagreed${notComparable(agreement)}`,
      'the reviewer and the rules engine reach the same coverage verdict'))
  }

  // --- citations --------------------------------------------------------------------------------
  const total = accepted.length + dropped.length
  if (!total) {
    out.push(row('reviewer_citations', 'not_applicable', 'the reviewer cited nothing', 'every claim carries a quote from the posting'))
  } else if (dropped.length) {
    // The offender names the REQUIREMENT and the reason, never the refused quote.
    //
    // Putting the quote here was a real leak, found by the independent verifier: `offenders` is
    // stored on `check_result` and read back verbatim by three endpoints, so a fabricated quote
    // that `validateCitations` had just refused was rendered to the user anyway — through a second
    // door, and with no marking to say it was refuted. Scrubbing it out of `critique[]` and then
    // re-emitting it here defeats the entire point of scrubbing.
    out.push(row('reviewer_citations', 'warn',
      `${dropped.length} of ${total} citations did not verify against the employer posting`,
      'every cited quote occurs in the posting and resolves to the requirement it names',
      dropped.map(d => `requirement ${d.requirement_id || '(unknown)'}: ${d.reason}`)))
  } else {
    out.push(row('reviewer_citations', 'pass', `${accepted.length} of ${total} citations verified`,
      'every cited quote occurs in the posting and resolves to the requirement it names'))
  }

  // --- critique ---------------------------------------------------------------------------------
  if (!review.critique.length) {
    out.push(row('reviewer_critique', 'pass', 'the reviewer raised nothing', 'no unaddressed criticism'))
  } else {
    out.push(row('reviewer_critique', 'warn', `${review.critique.length} point(s) raised`, 'no unaddressed criticism',
      review.critique.slice(0, 10)))
  }

  return out
}

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------

/** The Prompts-table partition keys this reviewer reads. Rows are authored in the prompts console. */
export const REVIEWER_PROMPT_KEYS = { system: 'reviewer_system', user: 'reviewer_user' } as const

/**
 * Built-in fallbacks, used only when the Prompts table has no active row. A verdict produced from
 * these records `prompt_version = 0` and `prompt_source = 'builtin'`, so provenance is never
 * ambiguous — a stored 0 means "no prompt row existed", not "version unknown".
 */
export const BUILTIN_REVIEWER_SYSTEM = [
  'You are an independent reviewer. You did not write the document you are reviewing and you have',
  'not been told how it was written. Judge only what is in front of you: the employer\'s job posting,',
  'the extracted requirements, and the finished document.',
  '',
  'Rules you must follow:',
  '- Every claim you make about the posting must carry a VERBATIM quote copied character-for-character',
  '  from the posting text you were given. Do not paraphrase inside a quote. Do not invent a quote.',
  '  A quote you cannot copy exactly is a claim you must not make.',
  '- Quote at least six words, and quote the sentence that states the requirement you are citing.',
  '- Judge each requirement independently: does the DOCUMENT give an employer evidence for it?',
  '- Say needs_work when the document would not survive a hiring manager\'s read, acceptable when it',
  '  would pass but is unremarkable, strong when it is directly responsive to this posting.',
  '- If you cannot tell, say so in the critique. Do not guess.',
  '',
  'Reply with JSON only, no prose and no code fence:',
  '{"grade":"strong|acceptable|needs_work","seniority_alignment":0-100,',
  ' "requirements":[{"requirement_id":"<id>","covered":true|false}],',
  ' "citations":[{"requirement_id":"<id>","verbatim_quote":"<exact posting text>","claim":"<what it shows>"}],',
  ' "critique":["<one specific, actionable problem>"]}',
].join('\n')

export const BUILTIN_REVIEWER_USER = [
  'Review the document below against the posting.',
  '',
  'seniority_alignment is 0-100: how well the document\'s scope, scale and altitude match the level',
  'this posting is hiring for. 100 means the document reads as exactly this level.',
  '',
  'PAYLOAD:',
].join('\n')

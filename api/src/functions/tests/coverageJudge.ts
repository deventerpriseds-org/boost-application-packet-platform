// WHAT:       Does THIS DOCUMENT address this posting requirement? Judged by a model, cited from the
//             document, and every citation verified byte-exact by code before it is allowed to count.
// WHY:        `coversIn` (checks.ts:276) answers the same question with 70% LITERAL content-word
//             overlap. Measured on the owner's live Trinnex packet: 0 of 19 requirements counted,
//             with four near-misses at 0.67 / 0.60 / 0.57 / 0.50. The 0.60 is
//             "align engineering strategy with business goals" answered by "aligning engineering
//             strategies with business objectives" — two words swapped, counted as nothing, because
//             `covText.includes(tk)` cannot match `strategy` against `strategies`.
// SUPERSEDES: nothing. `coversIn` REMAINS and is the fallback when no verdict is supplied.
// SUPERSEDED-BY: nothing — current.
// EVIDENCE:   docs/qc-evidence/DIAG-coverage-recognition.md (A1, A6),
//             docs/qc-evidence/AC-llm-coverage-judge.md, docs/qc-evidence/FEASIBILITY-llm-judgement.md.
//
// NOTHING HERE CALLS THE NETWORK. The transport is injected, exactly as `evidenceProposal` does it,
// so every rule below is exercised without one and `H12`'s purity holds. `appChecks` supplies the
// real transport.
//
// THE HOUSE RULE THIS CHANGES, AND WHAT REPLACES IT. `checks.ts:781` states "a model may PROPOSE,
// only an exact rule may ACCUSE". The owner has directed that a model may accuse here, and the
// replacement safeguard is not trust — it is that **the model must point at words the document
// actually contains, and code checks that it did**. A verdict claiming coverage with a quote that is
// not byte-present in the field is REFUSED before anyone sees it. That is the same discipline
// `verifyProposal` applies to profile excerpts, pointed at the document instead.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not decide whether the CANDIDATE has the experience —
// that is the profile question, `supportIn`, and conflating the two would merge the populations
// `must_have_coverage` and `evidence_placed` exist to keep apart. This answers only: does this text
// address this line of the posting.
import { itemTokens } from './swaps'

/** How the document addresses the requirement. `absent` is a real answer, not a failure. */
export type CoverageBasis = 'direct' | 'synonym' | 'near_phrasing' | 'absent'

export const COVERAGE_BASES: CoverageBasis[] = ['direct', 'synonym', 'near_phrasing', 'absent']

/** The version stamped on every stored verdict, so a prompt change is visible in the data. */
export const JUDGE_VERSION = 1

export interface JudgeRequirement { seq: number; kind: string; verbatim: string | null; item_text: string }

export interface CoverageVerdict {
  seq: number
  covered: boolean
  basis: CoverageBasis
  /** A span of the FIELD TEXT, verified present. Null whenever `covered` is false. */
  quote: string | null
  /** The model's reason, shown to the owner. Never empty on an accepted verdict. */
  why: string
  judge_version: number
}

/**
 * Why a model's row was thrown away. Named rather than collapsed, because "the model said no" and
 * "the model claimed a quote that is not in the document" are different facts about a run and only
 * the second is a defect worth alerting on.
 */
export type VerdictRefusal =
  | 'unknown_seq'          // a seq the run did not ask about
  | 'bad_basis'            // outside COVERAGE_BASES
  | 'covered_without_quote'
  | 'quote_not_in_field'   // THE accusation-grade check
  | 'no_reason'
  | 'basis_absent_but_covered'

export interface JudgeResult {
  verdicts: CoverageVerdict[]
  refused: Array<{ seq: number | null; refusal: VerdictRefusal; detail?: string }>
  /** Requirements the model returned nothing for. Reported, never silently treated as `absent`. */
  unjudged: number[]
}

const reqText = (r: JudgeRequirement) => String(r.verbatim || r.item_text || '')

/**
 * The prompt.
 *
 * ALL requirements in ONE call, per field. Measured: per-requirement-per-artifact is 84 calls on the
 * owner's packet, batched per field it is a handful — and batching is also what lets the model see
 * the requirements as a set, so it can decline the ones the document does not reach rather than
 * judging each in isolation with no sense of the document's actual scope.
 *
 * THE INSTRUCTIONS THAT DO THE WORK, and why each is here rather than implied:
 *  - *quote from the document* — this is the whole safety property. A model that cannot point at
 *    words has not shown coverage, and `parseCoverageVerdicts` refuses it.
 *  - *do not reward vocabulary* — the failure the owner reported is a document stuffed with the
 *    posting's nouns. A judge that counts name-dropping would automate the very thing they objected
 *    to. AC-5 fixes this as a permanent adversarial test.
 *  - *`absent` is a good answer* — a judge that finds coverage everywhere is worse than the
 *    threshold it replaces, because it fabricates coverage in a document a person sends to an
 *    employer.
 */
export function buildCoverageUser(reqs: JudgeRequirement[], fieldName: string, fieldText: string): string {
  const lines = (reqs || []).map(r => `- [#${r.seq} ${r.kind}] ${reqText(r)}`).join('\n')
  return [
    `FIELD: ${fieldName}`,
    '',
    'THE DOCUMENT TEXT (this, and nothing else, is what you are judging):',
    String(fieldText || ''),
    '',
    'THE POSTING\'S LINES:',
    lines,
    '',
    'For EACH line, decide whether THIS DOCUMENT TEXT addresses it.',
    '',
    'RULES:',
    '1. If it does, quote the exact span of the document text that addresses it. Copy it character for',
    '   character — a quote that is not present verbatim in the document is discarded and your verdict',
    '   with it.',
    '2. Judge MEANING, not wording. "aligning engineering strategies with business objectives"',
    '   addresses "align engineering strategy with business goals". Say whether the match is `direct`,',
    '   `synonym` or `near_phrasing`.',
    '3. NAMING A TOPIC IS NOT ADDRESSING IT. A document that lists the posting\'s vocabulary without',
    '   claiming to have done any of it covers nothing. Reward the claim, never the keyword.',
    '4. `absent` is a correct and useful answer. Do not stretch. A claim of coverage that a reader',
    '   would not accept is worse than a gap, because this document is sent to an employer.',
    '5. Give one short sentence of reasoning per line, saying what in the document addresses it.',
    '',
    'Return STRICT JSON: {"verdicts":[{"seq":<int>,"covered":<bool>,"basis":"direct|synonym|near_phrasing|absent","quote":<string|null>,"why":<string>}]}',
    'One entry per line above. No prose, no markdown, no extra keys.',
  ].join('\n')
}

export const COVERAGE_SYSTEM = [
  'You judge whether a document addresses a job posting\'s requirements.',
  'You quote the document to show it. You never quote the posting.',
  'You judge meaning rather than wording, and you never treat the presence of a topic word as evidence the document claims that experience.',
  'An honest "absent" is more useful than a stretched "covered".',
].join('\n')

/**
 * Turn the model's answer into verdicts, refusing anything it cannot stand behind.
 *
 * `fieldText.indexOf(quote)` on the ORIGINAL text — no lower-casing, no normalisation, no fuzzy
 * fallback, deliberately identical to `verifyProposal`'s rule. A model that paraphrases its own
 * quote, tidies the punctuation, or stitches two sentences together fails here and its verdict is
 * dropped rather than shown.
 *
 * ABSENT EVIDENCE IS NOT A PASS AND NOT A FAIL. A requirement the model returned nothing for lands
 * in `unjudged`, never in `verdicts` as `absent` — "the judge did not answer" and "the judge said no"
 * are different facts, and only the caller can decide what an unanswered one means.
 */
export function parseCoverageVerdicts(
  raw: any, reqs: JudgeRequirement[], fieldText: string,
): JudgeResult {
  const text = String(fieldText || '')
  const wanted = new Map<number, JudgeRequirement>()
  for (const r of reqs || []) wanted.set(Number(r.seq), r)

  const verdicts: CoverageVerdict[] = []
  const refused: JudgeResult['refused'] = []
  const seen = new Set<number>()
  const rows = Array.isArray(raw?.verdicts) ? raw.verdicts : []

  for (const row of rows) {
    const seq = Number(row?.seq)
    if (!Number.isFinite(seq) || !wanted.has(seq)) {
      refused.push({ seq: Number.isFinite(seq) ? seq : null, refusal: 'unknown_seq' }); continue
    }
    if (seen.has(seq)) continue          // first answer wins; a second is not a second opinion
    const basis = String(row?.basis || '') as CoverageBasis
    if (!COVERAGE_BASES.includes(basis)) { refused.push({ seq, refusal: 'bad_basis', detail: String(row?.basis) }); continue }

    const why = String(row?.why || '').trim()
    if (!why) { refused.push({ seq, refusal: 'no_reason' }); continue }

    const covered = row?.covered === true
    if (covered && basis === 'absent') { refused.push({ seq, refusal: 'basis_absent_but_covered' }); continue }

    if (!covered) { seen.add(seq); verdicts.push({ seq, covered: false, basis, quote: null, why, judge_version: JUDGE_VERSION }); continue }

    const quote = typeof row?.quote === 'string' ? row.quote.trim() : ''
    if (!quote) { refused.push({ seq, refusal: 'covered_without_quote' }); continue }
    const at = text.indexOf(quote)
    if (at === -1) { refused.push({ seq, refusal: 'quote_not_in_field', detail: quote.slice(0, 80) }); continue }

    seen.add(seq)
    // The DOCUMENT's own bytes at the found offsets, never the model's string. Equal by construction
    // here because `indexOf` found it — which is exactly why re-slicing is free and closes the gap
    // if that ever stops being true.
    verdicts.push({ seq, covered: true, basis, quote: text.slice(at, at + quote.length), why, judge_version: JUDGE_VERSION })
  }

  const unjudged = [...wanted.keys()].filter(s => !seen.has(s)).sort((a, b) => a - b)
  return { verdicts, refused, unjudged }
}

/**
 * Which requirements are worth asking about at all.
 *
 * Mirrors `MIN_JUDGEABLE_TOKENS` rather than inventing a second rule: a requirement with too few
 * contentful words cannot be judged either way, by a model or a threshold, and `checks.ts` already
 * reports those as uncovered so a human sees them. Sending them to the judge would spend a call to
 * obtain an answer the engine is contractually required to ignore.
 */
export function judgeableRequirements(reqs: JudgeRequirement[], minTokens: number): JudgeRequirement[] {
  return (reqs || []).filter(r => itemTokens(reqText(r)).length >= minTokens)
}

/** The verdict lookup `checks.ts` consumes. Keyed by seq, per field. */
export type VerdictMap = Map<string, Map<number, CoverageVerdict>>

/** `field -> seq -> verdict`, built once per run by the caller and read by the pure checks. */
export function verdictMap(byField: Array<{ field: string; result: JudgeResult }>): VerdictMap {
  const out: VerdictMap = new Map()
  for (const { field, result } of byField || []) {
    const m = new Map<number, CoverageVerdict>()
    for (const v of result.verdicts) m.set(v.seq, v)
    out.set(field, m)
  }
  return out
}

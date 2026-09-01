// WHAT:       Does this passage NAME the posting's topics without claiming to have done any of them?
//             Judged by a model, cited byte-exact from the document, shown as the writer's call.
// WHY:        Owner, on the shipped Trinnex summary: "this one is a hack full of verbatim lines from
//             the jd that isn't subtle at all and would get me accused of stuffing." `scanWording`
//             (figureEcho.ts:498) is the check that exists for this and it finds NOTHING here,
//             because it looks for CONTIGUOUS runs of 8+ tokens lifted from the ad. Stuffing is not
//             usually contiguous. It is the posting's nouns, scattered through a sentence that never
//             says the writer did any of them.
// SUPERSEDES: nothing. `scanWording` REMAINS and is the exact half -- a verbatim run is a fact, it
//             needs no judgement, and it is cheaper. This adds the half a substring search cannot see.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/DIAG-summary-stuffing.md, docs/qc-evidence/DIAG-coverage-recognition.md.
//
// NOTHING HERE CALLS THE NETWORK. The transport is injected.
//
// THE MEASUREMENT THAT SHAPED THIS, and it is why the check is worth having at all. The same live
// summary that reads as stuffed scored 0 of 19 on requirement coverage. So the document was
// simultaneously FULL of the posting's vocabulary and EMPTY of its claims -- which is precisely the
// shape that gets a candidate accused of keyword stuffing, and precisely the shape a word-matcher
// cannot describe: to `scanWording` it is silent, and to a coverage threshold it is a low score with
// no explanation attached.
//
// WHAT IT MUST NOT DO, and this is the harder half. Using the employer's noun in a REAL claim is
// good writing, not stuffing: "led the SOC 2 certification" is exactly what a resume should say. The
// difference between that and "familiar with SOC 2, ISO 27001 and NIST" is whether a claim is
// attached, which is a judgement about meaning -- the same judgement `coverageJudge` makes, pointed
// at the writer's own prose instead of the employer's requirement.
//
// AND IT NEVER FAILS A GATE. `posting_wording_kept` is a `warn` and stays one: only the writer can
// say whether a phrase is the employer's sentence, the industry's standard term, or their own
// voice. A model may raise it for a person to look at. It may not decide it.
import { sha256 } from './evidence'

export const STUFFING_VERSION = 1

export interface StuffingHit {
  /** A span of the FIELD TEXT, verified present. */
  phrase: string
  char_start: number
  char_end: number
  /** Why this reads as vocabulary rather than a claim. Shown to the owner; never empty. */
  why: string
}

export type StuffingRefusal =
  | 'phrase_not_in_field'   // THE accusation-grade check
  | 'no_reason'
  | 'empty_phrase'

export interface StuffingResult {
  hits: StuffingHit[]
  refused: Array<{ refusal: StuffingRefusal; detail?: string }>
}

export const STUFFING_SYSTEM = [
  'You read one passage from a candidate\'s application document, against the job posting it was written for.',
  'You find only one thing: places where the passage NAMES a topic from the posting without claiming the candidate did it.',
  'You quote the passage to show it. You never quote the posting.',
  'Using the employer\'s own words inside a real claim is good writing and is NEVER a hit --',
  '"led the SOC 2 certification" is a claim; "familiar with SOC 2, ISO 27001 and NIST" is a list.',
  'Finding nothing is a common and correct answer. This is shown to the writer about their own prose,',
  'so a false flag costs their trust in every other thing you say.',
].join('\n')

export function buildStuffingUser(fieldName: string, fieldText: string, postingText: string): string {
  return [
    `THE PASSAGE (from the candidate's ${fieldName}):`,
    String(fieldText || ''),
    '',
    'THE POSTING IT WAS WRITTEN FOR:',
    String(postingText || ''),
    '',
    'Find the places in THE PASSAGE where a topic from the posting is NAMED but nothing is claimed',
    'about having done it.',
    '',
    'RULES:',
    '1. Quote the exact span of THE PASSAGE. Copy it character for character -- a quote not present',
    '   verbatim in the passage is discarded and your answer with it.',
    '2. A CLAIM IS NEVER A HIT, however much of the posting\'s vocabulary it uses. Ask: does this say',
    '   the candidate DID something? Then leave it alone.',
    '3. An empty list is a good answer. Do not reach.',
    '4. One short sentence per hit, saying why it reads as vocabulary rather than as a claim.',
    '',
    'Return STRICT JSON: {"hits":[{"phrase":<string>,"why":<string>}]}',
    'No prose, no markdown, no extra keys.',
  ].join('\n')
}

/**
 * Read the answer, refusing anything the model cannot point at.
 *
 * `fieldText.indexOf(phrase)` on the ORIGINAL text -- the same rule `verifyProposal` and
 * `parseCoverageVerdicts` apply. A model that paraphrases the passage it is accusing has not shown
 * the owner anything they can act on, and an accusation nobody can locate is worse than silence.
 */
export function parseStuffing(raw: any, fieldText: string): StuffingResult {
  const text = String(fieldText || '')
  const hits: StuffingHit[] = []
  const refused: StuffingResult['refused'] = []
  const seen = new Set<number>()

  for (const row of Array.isArray(raw?.hits) ? raw.hits : []) {
    const phrase = typeof row?.phrase === 'string' ? row.phrase.trim() : ''
    if (!phrase) { refused.push({ refusal: 'empty_phrase' }); continue }
    const why = String(row?.why || '').trim()
    if (!why) { refused.push({ refusal: 'no_reason', detail: phrase.slice(0, 60) }); continue }
    const at = text.indexOf(phrase)
    if (at === -1) { refused.push({ refusal: 'phrase_not_in_field', detail: phrase.slice(0, 60) }); continue }
    // One hit per span. A model repeating itself is not two findings, and a duplicated offender
    // inflates a count the owner reads as severity.
    if (seen.has(at)) continue
    seen.add(at)
    // The DOCUMENT's own bytes at the found offsets, never the model's string.
    hits.push({ phrase: text.slice(at, at + phrase.length), char_start: at, char_end: at + phrase.length, why })
  }
  return { hits, refused }
}

/** Identity of what was read, so an unchanged passage need not be re-read. */
export function stuffingKey(fieldName: string, fieldText: string, postingText: string, model: string): string {
  return sha256([
    `stuffing:${STUFFING_VERSION}`,
    `model:${model}`,
    `field:${fieldName}`,
    `text:${String(fieldText || '')}`,
    `posting:${String(postingText || '')}`,
  ].join('\u0000'))
}

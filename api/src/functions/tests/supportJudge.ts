// WHAT:       Does THIS EXCERPT of the candidate's profile actually show what the requirement asks?
//             A CHALLENGE to a model's own proposal -- name the gaps first, cited from the excerpt, and
//             verified byte-exact by code. What survives it may COUNT toward must_have_coverage.
// WHY:        `must_have_coverage` reads `ruleEvidenceOf` (checks.ts:892), which nulls any `proposed`
//             row the owner has not confirmed. On the owner's live Trinnex packet 15 of 17 evidence
//             rows are `proposed`, so the number reads 0/12 and NOTHING in the product could move it
//             except the owner clicking twelve times. Owner, 2026-09-01: "resolve the zero out of 12
//             everything that you work on should work not get put off till later".
// SUPERSEDES: nothing. The deterministic resolver and the owner's confirmation both stay exactly as
//             they are; this adds a third way a row can be evidenced, stamped so it is never mistaken
//             for either.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/DIAG-coverage-recognition.md, docs/qc-evidence/AC-llm-coverage-judge.md.
//
// NOTHING HERE CALLS THE NETWORK. The transport is injected, exactly as `evidenceProposal` does it.
//
// WHY THIS IS NOT "ASKING THE SAME MODEL TWICE" -- REWRITTEN 2026-09-01 BECAUSE THE FIRST ANSWER
// WAS WRONG, and both the owner and an independent AC pass said so before it shipped anywhere.
//
// The first version handed this pass `e.quote` -- THE SPAN THE PROPOSAL PASS HAD ALREADY CHOSEN --
// and asked what that span fails to show. Two objections, arriving independently, and both correct:
//
//   the owner   "why would finding a match require what's missing instead of what's matching?"
//   AC B-6      it "must be given a materially different view -- at minimum the requirement plus the
//               source record, not merely the span the first pass already chose. A second question
//               asked of the same model about the same self-selected span is a weaker independence
//               claim than it appears."
//
// Both name the same hole: selecting the excerpt is EXACTLY what the first pass was for, so a
// mis-selected excerpt is the failure most likely to be present, and a challenge that can only ask
// "does this span show it?" is structurally unable to see it.
//
// SO THIS PASS NOW ANSWERS THE SAME QUESTION, INDEPENDENTLY, AND THE TEST IS AGREEMENT.
// It is given the requirement and the WHOLE RECORD -- never the first pass's answer -- and asked
// what the owner said a match question should ask: which words here show this? The row is promoted
// only when the two independently-chosen spans OVERLAP (`spansOverlap`, checked in code from stored
// offsets). Two reads landing on the same words is a machine-checkable fact; "the model said nothing
// was missing" is the model's own report about itself.
//
// FOUR THINGS MUST ALL HOLD, or the row stays exactly where it is today:
//   1. it cites a span byte-present in THE RECORD -- `verifyProposal`'s own discipline,
//   2. that span OVERLAPS the one the proposal pass chose,
//   3. it declares nothing missing (kept: it catches a model contradicting itself, which is real,
//      and it is now one condition of several rather than the whole warrant),
//   4. and it claims support.
// Any failure -- a throw, an unparseable answer, a named gap, an uncited claim, a fabricated quote,
// or two reads that disagree about where the evidence is -- leaves the row `proposed`, which is
// today's behaviour. The lane can only ever ADD a vetted row; it can never withdraw one.
import { sha256 } from './evidence'

/** Bump when the prompt or the acceptance rules change, so a row can be attributed to a ruleset. */
export const PROPOSAL_VET_VERSION = 1

export type SupportRefusal =
  | 'model_declined'        // it said the excerpt does not show it
  | 'missing_named'         // it named something the requirement asks and the excerpt lacks
  | 'no_quote'
  | 'quote_not_in_excerpt'  // THE accusation-grade check
  | 'no_reason'
  | 'unparseable'

export interface SupportVerdict {
  supported: boolean
  /** A span of THE EXCERPT, verified present. Null unless supported. */
  quote: string | null
  char_start: number | null
  char_end: number | null
  /** What the model said the excerpt does NOT show. Published either way -- it is the useful half. */
  missing: string[]
  why: string
  refusal: SupportRefusal | null
  vet_version: number
}

export const SUPPORT_SYSTEM = [
  'You decide whether one excerpt from a candidate\'s profile SHOWS what a job requirement asks for.',
  'You answer the harder question first: what does the requirement ask that this excerpt does NOT show?',
  'Only then do you say whether what remains is supported, and you quote the excerpt to show it.',
  'You never quote the requirement, and you never infer from what the excerpt suggests about the person.',
  'Naming something as missing is the most useful answer you can give. A row you decline stays exactly',
  'where it is -- shown to the owner for their own decision -- so declining costs nothing and',
  'overstating costs the candidate their credibility with an employer.',
].join('\n')

export function buildSupportUser(requirement: string, record: string): string {
  return [
    'THE REQUIREMENT:',
    String(requirement || ''),
    '',
    'THE RECORD FROM THE CANDIDATE\'S PROFILE (this, and nothing else, is what you are reading):',
    String(record || ''),
    '',
    'ANSWER IN THIS ORDER:',
    '1. "quote": the exact span of THE RECORD that shows the candidate has what the requirement asks',
    '   for -- or null if no part of it does. Copy it character for character; a quote not present',
    '   verbatim in the record is discarded and your answer with it. Quote the SMALLEST span that',
    '   actually shows it.',
    '2. "missing": every distinct thing the requirement asks for that this record does NOT show. Be',
    '   concrete -- a named certification, a named technology, a scale, a responsibility.',
    '3. "supported": true ONLY if "missing" is empty and your quote shows what the requirement asks.',
    '4. "why": one short sentence, saying what in the record shows it.',
    '',
    'Return STRICT JSON: {"quote":<string|null>,"missing":[<string>],"supported":<bool>,"why":<string>}',
    'No prose, no markdown, no extra keys.',
  ].join('\n')
}

/**
 * Do two independently-chosen spans point at the same thing?
 *
 * THE AGREEMENT TEST, and it is the property that makes this pass worth making. Half-open ranges, so
 * touching ends do not count: `[0,5)` and `[5,9)` are adjacent, not overlapping, and two reads that
 * picked adjacent sentences did not pick the same evidence.
 */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Read the second read, refusing anything it cannot stand behind.
 *
 * ORDER IS THE SAFETY PROPERTY. `missing` is checked BEFORE `supported`, so a model that names a gap
 * and then claims support anyway is refused by code rather than believed -- the contradiction is
 * caught by the rule, not by the model's consistency.
 */
export function parseSupportVerdict(raw: any, excerpt: string): SupportVerdict {
  const text = String(excerpt || '')
  const base = { quote: null, char_start: null, char_end: null, vet_version: PROPOSAL_VET_VERSION }

  if (!raw || typeof raw !== 'object') {
    return { ...base, supported: false, missing: [], why: '', refusal: 'unparseable' }
  }
  // F-3, found by an independent verifier and a defect I shipped: this read
  // `Array.isArray(raw.missing) ? raw.missing : []`, so a model naming its gap as a BARE STRING —
  // `missing: 'SOC 2 cert'` against a prompt asking for `["..."]`, a JSON-shape slip rather than an
  // exotic input — had its gap DISCARDED and the row promoted to `vetted`, which counts toward the
  // gate. Every other malformed shape in this module refuses; this one alone resolved in the
  // direction that ADMITS the claim, against the file's own rule that absent evidence is never a
  // pass. A named gap in the wrong container is still a named gap.
  const rawMissing = raw.missing
  const missing = (Array.isArray(rawMissing) ? rawMissing
    : rawMissing == null ? []
    : [rawMissing])
    .map((m: any) => String(m || '').trim()).filter(Boolean)
  const why = String(raw.why || '').trim()

  // A NAMED GAP REFUSES THE ROW, whatever the model then says about it. This is the whole reason the
  // question is asked in this order.
  if (missing.length) return { ...base, supported: false, missing, why, refusal: 'missing_named' }
  if (raw.supported !== true) return { ...base, supported: false, missing, why, refusal: 'model_declined' }
  if (!why) return { ...base, supported: false, missing, why, refusal: 'no_reason' }

  const quote = typeof raw.quote === 'string' ? raw.quote.trim() : ''
  if (!quote) return { ...base, supported: false, missing, why, refusal: 'no_quote' }
  const at = text.indexOf(quote)
  if (at === -1) return { ...base, supported: false, missing, why, refusal: 'quote_not_in_excerpt' }

  return {
    supported: true,
    // The EXCERPT's own bytes at the found offsets, never the model's string.
    quote: text.slice(at, at + quote.length),
    char_start: at,
    char_end: at + quote.length,
    missing: [],
    why,
    refusal: null,
    vet_version: PROPOSAL_VET_VERSION,
  }
}

/**
 * The note stored on a judged row, and it is deliberately not just the model's sentence.
 *
 * A row that COUNTS toward the gate has to carry, on its face, the fact that a model put it there
 * and the words it pointed at. "Coverage rose" must be falsifiable by the person reading the row --
 * they have to be able to tell a better profile from a chattier model.
 */
export function vettedNote(why: string, quote: string): string {
  return `vetted: challenged for what it fails to show, found nothing missing, and points at "${quote}" — ${String(why || '').trim()}`
}

/** Identity of what was judged, so a re-run over unchanged text need not re-ask. */
export function supportKey(requirement: string, excerpt: string, model: string): string {
  return sha256([
    `support:${PROPOSAL_VET_VERSION}`,
    `model:${model}`,
    `req:${String(requirement || '')}`,
    `excerpt:${String(excerpt || '')}`,
  ].join('\u0000'))
}

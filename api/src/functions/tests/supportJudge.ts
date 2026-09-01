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
// WHY A SECOND READ IS NOT JUST "ASKING THE SAME MODEL TWICE".
//
// `escalateOne` already asks "does this record support this requirement, and if so quote it", and
// `verifyProposal` already proves the quote is real. If counting a proposal were safe, the fix would
// be deleting one condition in `checks.ts` -- and it is not safe, for the reason written there: the
// model's answer is CONFIRMING, so it finds support at the rate it was asked to find support.
//
// This pass asks the FALSIFYING question instead, and it is asked in the order that matters: the
// model must FIRST list what the requirement asks that the excerpt does not show, and only then may
// it claim support. A model that has just written "does not show: SOC 2 certification" cannot
// coherently claim the excerpt shows it. That is disconfirming evidence made mechanical rather than
// hoped for, and `missing` being non-empty REFUSES the row by code, not by the model's own verdict.
//
// THREE THINGS MUST ALL HOLD, or the row stays exactly where it is today:
//   1. the model declares nothing missing,
//   2. it claims support,
//   3. and it cites a span that is byte-present in THE EXCERPT -- the same `indexOf` discipline
//      `verifyProposal` applies to the record, applied one level in.
// Any failure -- a throw, an unparseable answer, a missing list, an uncited claim, a fabricated
// quote -- leaves the row `proposed`, which is today's behaviour. The lane can only ever ADD a
// judged row; it can never withdraw one, and it can never make a row worse than it is now.
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

export function buildSupportUser(requirement: string, excerpt: string): string {
  return [
    'THE REQUIREMENT:',
    String(requirement || ''),
    '',
    'THE EXCERPT (this, and nothing else, is what you are judging):',
    String(excerpt || ''),
    '',
    'ANSWER IN THIS ORDER:',
    '1. "missing": every distinct thing the requirement asks for that this excerpt does NOT show.',
    '   Be concrete -- a named certification, a named technology, a scale, a responsibility. If the',
    '   excerpt shows all of it, return an empty list.',
    '2. "supported": true ONLY if "missing" is empty and this excerpt, on its own, shows what the',
    '   requirement asks. Otherwise false.',
    '3. "quote": when supported, the exact span of THE EXCERPT that shows it. Copy it character for',
    '   character -- a quote not present verbatim in the excerpt is discarded and your answer with it.',
    '4. "why": one short sentence, saying what in the excerpt shows it.',
    '',
    'Return STRICT JSON: {"missing":[<string>],"supported":<bool>,"quote":<string|null>,"why":<string>}',
    'No prose, no markdown, no extra keys.',
  ].join('\n')
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
  const missing = (Array.isArray(raw.missing) ? raw.missing : [])
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

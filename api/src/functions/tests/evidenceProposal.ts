// The escalation tier: a model PROPOSES an excerpt, deterministic rules ACCEPT or REFUSE it.
//
// WHERE THIS SITS, and why it is not "the matcher, but with AI".
//
// `requirementSupport` compares words. That reaches every requirement whose wording overlaps the
// profile's, and it provably cannot reach the rest: `improve operational reliability` shares no
// content word with `reduced outages from nine hours to one`, so no threshold, fold or tokenizer
// finds it. Measured on the owner's own data — `Experience in leading technology operations` is
// evidenced by three consecutive bullets about governance, scaled agile operations and strategic
// roadmaps, and the token matcher can only see the two literal words scattered across a wider span.
//
// THE TRIGGER IS ESCALATION, NOT EVERY ROW. This runs only where the deterministic pass already
// returned null. That is deliberate and it is what protects the determinism contract: the rows the
// exact rules settled stay reproducible and attributable to `RESOLVER_VERSION`, and only the
// escalated minority carries model provenance — which is stamped on the row rather than inferred
// later. It is the same shape the `escalation` table already uses for "a rule could not settle
// this, hand it to better judgement", where the better judgement has until now been a human.
//
// THE HOUSE RULE IS THE WHOLE DESIGN: a model may RANK or PROPOSE; only an exact deterministic rule
// may ACCUSE. So the model is asked one narrow, checkable question — "does this record support this
// requirement, and if so quote the sentence" — and every answer is then put through the SAME
// verification the deterministic path uses. A proposal that is not byte-for-byte present in the
// record is discarded, not stored with a caveat. The model widens what gets CHECKED; it never
// decides what is TRUE.
//
// NOTHING HERE CALLS THE NETWORK. The transport is injected, so the rules below are exercised by
// ordinary tests with hand-written model answers, including adversarial ones. `appRequirements`
// supplies the real transport.
import type { ProfileRecord } from './evidence'
import { requirementClass, claimTokens } from './requirementSupport'

/** Bump when the proposal rules change, so a row can be attributed to a ruleset. */
export const PROPOSAL_VERSION = 1

/**
 * What the model is allowed to return. Deliberately tiny.
 *
 * It names a record and quotes a span of it, and that is all. It does not score, does not rank, and
 * cannot mark anything evidenced — `supported` is a claim this module then tries to falsify. Asking
 * for less makes the answer checkable; asking for a confidence number would invite trusting one.
 */
export interface ModelProposal {
  source_key: string
  quote: string
  reasoning: string
  supported: boolean
}

export type ProposalRefusal =
  | 'model_declined'          // the model itself said the record does not support it
  | 'unknown_source_key'      // it named a record that does not exist
  | 'quote_not_in_record'     // THE IMPORTANT ONE: it paraphrased instead of quoting
  | 'banned_source'           // it quoted the owner's do-not-use list
  | 'requirement_class'       // eligibility/numeric — no excerpt settles these, at any tier
  | 'quote_too_short'
  | 'no_reasoning'            // an unexplained match is not reviewable, so it is not accepted

export interface AcceptedProposal {
  source_key: string
  quote: string
  char_start: number
  char_end: number
  reasoning: string
  proposal_version: number
}

export interface ProposalOutcome {
  accepted: AcceptedProposal | null
  refusal: ProposalRefusal | null
}

/**
 * The prompt. Kept in code, versioned with `PROPOSAL_VERSION`, and written to make the ONE failure
 * mode expensive: a model that paraphrases produces a quote that fails the substring check and is
 * thrown away, so the instruction to copy exactly is repeated rather than implied.
 */
export const PROPOSAL_SYSTEM = [
  'You decide whether a candidate\'s stored profile supports a single job requirement.',
  '',
  'Return JSON only: {"supported": boolean, "source_key": string, "quote": string, "reasoning": string}.',
  '',
  'RULES, and the first is the one that matters:',
  '1. `quote` MUST be copied CHARACTER-FOR-CHARACTER from one of the records given to you.',
  '   Do not fix grammar, do not shorten, do not join text from two records, do not add an ellipsis.',
  '   A quote that is not an exact substring is discarded and your answer is wasted.',
  '2. Quote the SMALLEST span that actually supports the requirement. If several adjacent items in a',
  '   bullet list support it together, quote that contiguous run and nothing beyond it.',
  '3. Set "supported": false when the profile does not support the requirement. That is a useful',
  '   answer and is expected often. Never stretch to find something.',
  '4. Never infer where a person LIVES, their work authorization, or a clearance from prose.',
  '5. "reasoning" is one sentence explaining why this excerpt supports the requirement.',
].join('\n')

/** The records, rendered for the model with the keys it must quote back. */
export function buildProposalUser(requirement: string, records: ProfileRecord[]): string {
  const body = records
    .map(r => `--- source_key: ${r.key} (${r.label})\n${r.text}`)
    .join('\n\n')
  return `REQUIREMENT:\n${requirement}\n\nPROFILE RECORDS:\n${body}`
}

/**
 * Put a model proposal through the same gate the deterministic path uses.
 *
 * Every branch here is a REFUSAL rather than a repair. Repairing a near-miss quote — trimming
 * whitespace until it matches, or searching for the closest span — would be the module inventing
 * provenance on the model's behalf, which is the one thing the house rule forbids.
 */
export function verifyProposal(
  requirement: string,
  records: ProfileRecord[],
  proposal: ModelProposal | null | undefined,
  opts: { neverEvidence: Set<string>; minQuoteChars: number },
): ProposalOutcome {
  const refuse = (refusal: ProposalRefusal): ProposalOutcome => ({ accepted: null, refusal })

  // The class rules bind at EVERY tier. A model is not permitted to settle a residence requirement
  // from prose just because it is more persuasive than a regex.
  if (requirementClass(requirement)) return refuse('requirement_class')
  if (!proposal || proposal.supported !== true) return refuse('model_declined')

  const key = String(proposal.source_key || '')
  if (opts.neverEvidence.has(key)) return refuse('banned_source')
  const rec = (records || []).find(r => r && r.key === key)
  if (!rec || typeof rec.text !== 'string') return refuse('unknown_source_key')

  const quote = String(proposal.quote || '')
  if (quote.length < opts.minQuoteChars) return refuse('quote_too_short')
  if (!String(proposal.reasoning || '').trim()) return refuse('no_reasoning')

  // THE ACCUSATION-GRADE CHECK, and the reason a model is safe to use here at all. `indexOf` on the
  // ORIGINAL record text — no lower-casing, no normalization, no fuzzy fallback. A model that
  // paraphrases, tidies punctuation or merges two records fails here and its answer is dropped.
  const at = rec.text.indexOf(quote)
  if (at === -1) return refuse('quote_not_in_record')

  return {
    accepted: {
      source_key: rec.key,
      quote,
      char_start: at,
      char_end: at + quote.length,
      reasoning: String(proposal.reasoning).trim(),
      proposal_version: PROPOSAL_VERSION,
    },
    refusal: null,
  }
}

/**
 * Is this requirement worth escalating at all?
 *
 * Escalation costs a model call, so it is skipped where the answer is already known: a class the
 * rules refuse outright at every tier, and a requirement too thin to judge either way. Both would
 * be refused after the call, so making it would only spend money to reach the same answer.
 */
export function worthEscalating(requirement: string, minTokens: number): boolean {
  if (requirementClass(requirement)) return false
  return claimTokens(requirement).length >= minTokens
}

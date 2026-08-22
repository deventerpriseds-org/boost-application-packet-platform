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
import {
  requirementClass, claimTokens, namedEntityTokens, tokensOf, sameWord, isContentful,
} from './requirementSupport'

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

/**
 * The records, rendered for the model with the keys it must quote back.
 *
 * A BANNED record is not shown at all, rather than shown and rejected afterwards. `verifyProposal`
 * refuses one with `banned_source` and that refusal must stay — but a model cannot decline to quote
 * what it was never given, and rendering the owner's do-not-use list into a prompt in order to throw
 * the answer away spends a call to reach a refusal that was certain, and puts text the owner
 * excluded in front of a model for no reason. Two independent guards, in the right order.
 */
export function buildProposalUser(
  requirement: string, records: ProfileRecord[], neverEvidence: Set<string> = new Set(),
): string {
  const body = (records || [])
    .filter(r => r && !neverEvidence.has(r.key))
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

// --- the runner ------------------------------------------------------------------------------
//
// Everything above is pure judgement over an answer someone else obtained. This is the part that
// obtains it — and it is still transport-injected, so the whole tier is exercisable without a
// network. `appRequirements` supplies the real transport from `openaiJson`.

import { sha256, type EvidenceRow } from './evidence'
import { contentJson, type FetchJson } from './openaiJson'

/**
 * Why a row was not escalated, or what happened when it was.
 *
 * `transport_failed` is deliberately its OWN outcome and never collapses into `model_declined`.
 * "We never reached the model" and "the model said no" are different facts, and a tier that stores
 * them the same way records an outage as an absence of evidence — the house rule about absent
 * evidence, broken one layer below where anyone would look.
 */
export type EscalationOutcome =
  | { kind: 'accepted'; row: EvidenceRow; reasoning: string; reasoningWithdrawn: boolean; overclaimed: string[] }
  | { kind: 'refused'; reason: ProposalRefusal }
  | { kind: 'skipped' }
  | { kind: 'transport_failed'; error: string }
  | { kind: 'unparseable' }

export interface EscalateOptions {
  fetchJson: FetchJson
  neverEvidence: Set<string>
  minQuoteChars: number
  /** The resolver's own token floor — a requirement too thin to judge is too thin to escalate. */
  minTokens: number
  resolverVersion: number
}

/**
 * Escalate ONE requirement.
 *
 * The order is not arbitrary. `worthEscalating` runs BEFORE the call, so a row whose answer is
 * already known — a class no excerpt can settle, a requirement too thin to judge — costs nothing.
 * Then the model is asked. Then `verifyProposal` applies the SAME gate the deterministic path uses,
 * and the row is built from the RECORD's bytes rather than from the model's string: `rec.text.slice`
 * on the offsets `verifyProposal` measured, so the stored quote cannot be the model's text even if
 * the two ever disagreed.
 */
export async function escalateOne(
  requirement: string,
  records: ProfileRecord[],
  opts: EscalateOptions,
): Promise<EscalationOutcome> {
  if (!worthEscalating(requirement, opts.minTokens)) return { kind: 'skipped' }

  let raw: any
  try {
    raw = await opts.fetchJson(PROPOSAL_SYSTEM, buildProposalUser(requirement, records, opts.neverEvidence))
  } catch (e: any) {
    // NOT a refusal. The row stays unevidenced and the caller can tell the owner the tier could not
    // run, rather than reporting that the profile does not support the requirement.
    return { kind: 'transport_failed', error: String(e?.message || e).slice(0, 300) }
  }

  const parsed = contentJson(raw)
  if (!parsed || typeof parsed !== 'object') return { kind: 'unparseable' }

  const outcome = verifyProposal(requirement, records, parsed as ModelProposal, {
    neverEvidence: opts.neverEvidence,
    minQuoteChars: opts.minQuoteChars,
  })
  if (!outcome.accepted) return { kind: 'refused', reason: outcome.refusal as ProposalRefusal }

  const a = outcome.accepted
  const rec = records.find(r => r.key === a.source_key)!
  // The explanation faces its own check, and the RESULT of that check is what gets stored — never
  // the model's raw sentence. See `verifyReasoning`: an exact rule withdraws a named-entity
  // overclaim, and everything else is published beside a deterministic statement of what the excerpt
  // does not mention.
  const verdict = verifyReasoning(requirement, rec.text.slice(a.char_start, a.char_end), a.reasoning)
  return {
    kind: 'accepted',
    reasoning: verdict.note,
    reasoningWithdrawn: verdict.withdrawn,
    overclaimed: verdict.overclaimed,
    row: {
      // The record's own bytes at the verified offsets — never the model's string. On this path the
      // two are equal by construction (verifyProposal found the quote with indexOf), which is
      // exactly why re-slicing costs nothing and closes the gap if that ever stops being true.
      quote: rec.text.slice(a.char_start, a.char_end),
      source_kind: rec.kind,
      source_label: rec.label,
      source_key: a.source_key,
      char_start: a.char_start,
      char_end: a.char_end,
      // The model's one sentence, in SPEC 4.1's supporting-note column. Prose about the quote,
      // never a second quote — which is the only thing `extra` is allowed to hold.
      // The VERIFIED note, not the model's sentence. Never empty — `verifyProposal` already refuses
      // an unexplained match, so a row whose note we blanked would contradict this module one function up.
      extra: verdict.note,
      // NOT a similarity score. There is no ratio to report for a proposed row, and inventing one
      // would be a fabricated composite: the number a reviewer trusts most and the one most likely
      // to be wrong. `method` and `proposal_version` carry the provenance instead.
      ratio: null,
      method: 'proposed',
      record_sha256: sha256(rec.text),
      resolver_version: opts.resolverVersion,
      proposal_version: PROPOSAL_VERSION,
    },
  }
}

// --- verifying the model's EXPLANATION ---------------------------------------------------------
//
// The quote is settled by `indexOf`. The sentence explaining WHY it matches was checked only for
// being non-empty, and it is the text shown to the owner as the reason to trust the row. Measured on
// the first live run, two of five explanations asserted what their own quote does not show: one said
// an excerpt demonstrated "security" from a passage mentioning none, and one called "real-time data
// collection" IoT.
//
// THE OBVIOUS FIX DOES NOT WORK, AND THAT IS WHY THIS IS SHAPED THE WAY IT IS. "Drop the sentence
// when it names a requirement term the quote lacks" was built and run against the real cases first:
//
//   1. It MISSED the security case. `sameWord('secure','security')` is FALSE — `forms()` has no
//      -e -> -ity rule — so the word at issue never matched. It dropped that row anyway, on
//      `software`, which means a test asserting "case 1 is dropped" would pass while the guard was
//      blind to the defect that commissioned it. A vacuous gate that looks like a working one.
//   2. It fired THREE times on sound reasoning: for "Build and promote a high-performing engineering
//      culture" evidenced by "I have fostered high-performing teams", the explanation "which directly
//      evidences building an engineering culture" flagged `build`, `engineering`, `culture`.
//      Restating the requirement is what an explanation DOES.
//   3. It would drop an HONEST explanation hardest of all — "the excerpt shows scale but does not
//      address security" names `security` while the quote lacks it, and is exactly right.
//
// (2) and (1) are structurally identical to a token matcher: in both the reasoning names a
// requirement term the quote lacks. Only a semantic reading separates "fostered high-performing
// teams ~ engineering culture" from "real-time decision support !~ security", and a model policing a
// model's prose relocates the problem rather than solving it.
//
// SO THE TWO JOBS ARE SPLIT BY WHAT CAN BE SETTLED EXACTLY:
//
//   ACCUSE only on NAMED tokens — `IoT`, `AI/ML`, `SOC 2`, `Java`. An acronym or product name is
//   present or it is not; there is no near-miss and no morphology to get wrong, which is the same
//   reason `supportIn` already treats named entities as absolute. A model claiming the excerpt shows
//   IoT when the string `iot` appears nowhere in it is wrong by an exact rule, and its sentence is
//   withdrawn.
//
//   LABEL everything else, with the deterministic fact `resolveEvidence` already publishes:
//   "the excerpt does not mention: secure". The owner reads the model's claim beside a computed note
//   contradicting it. That catches the security case — which no exact rule can settle — without
//   accusing anyone, and it cannot cry wolf, because it states rather than judges.
//
// `extra` is NEVER left null. `verifyProposal` refuses an unexplained match outright
// (`no_reasoning`: "an unexplained match is not reviewable"), so storing a row with nothing in its
// note would contradict this module's own rule one function up. A withdrawn sentence is REPLACED by
// the fact that withdrew it.

export interface ReasoningVerdict {
  /** Named requirement tokens the explanation claimed and the quote does not contain. */
  overclaimed: string[]
  /** Requirement content words absent from the excerpt. A FACT, published either way. */
  missing: string[]
  /** True when the model's sentence was withdrawn by an exact rule. */
  withdrawn: boolean
  /** What to store in `requirement_evidence.extra`. Never empty. */
  note: string
}

const carries = (toks: string[], t: string) => toks.includes(t) || toks.some(h => sameWord(t, h))

export function verifyReasoning(requirement: string, quote: string, reasoning: string): ReasoningVerdict {
  const reqText = String(requirement || '')
  const q = tokensOf(String(quote || '')).map(x => x.t)
  const r = tokensOf(String(reasoning || '')).map(x => x.t)

  // The accusation, and it is deliberately narrow. Named tokens only.
  const named = [...namedEntityTokens(reqText)]
  const overclaimed = named.filter(t => carries(r, t) && !carries(q, t))

  // The fact, over the same contentful population `supportIn` measures support on.
  const missing = claimTokens(reqText).filter(isContentful).filter(t => !carries(q, t))

  // HOW THE FACT IS PHRASED MATTERS, because on this path it is almost always a long list. A row
  // reaches the model precisely BECAUSE the requirement's words are absent from the profile — that is
  // what the deterministic matcher could not get past — so listing every missing term on every row
  // would be near-maximal, would read as an accusation against evidence the design considers sound,
  // and would train the owner to ignore it.
  //
  // So: when NOTHING of the requirement appears, say that once, plainly, and name the model as the
  // thing that judged it. When only SOME terms are absent, they are the informative case and are
  // listed — capped, because a list nobody finishes is a list nobody reads.
  const total = claimTokens(reqText).filter(isContentful).length
  const missNote = !missing.length ? ''
    : missing.length >= total
      ? 'none of the requirement\'s own words appear in this excerpt — a model judged it relevant'
      : `the excerpt does not mention: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? `, and ${missing.length - 6} more` : ''}`
  const clean = String(reasoning || '').trim()

  if (overclaimed.length) {
    const why = `a model's explanation was withdrawn: it credited the excerpt with ${overclaimed.join(', ')}, which it does not contain`
    return { overclaimed, missing, withdrawn: true, note: missNote ? `${why} — ${missNote}` : why }
  }
  // Not withdrawn: the model's sentence stands, with the fact beside it rather than instead of it.
  const note = [clean, missNote].filter(Boolean).join(' — ')
  return { overclaimed: [], missing, withdrawn: false, note }
}

// Does THIS profile record support THIS requirement? — the purpose-made matcher (option (c)).
//
// WHY THIS MODULE EXISTS, and why it is not a duplicate of `requirements.locate()`.
//
// `locate(paraphrase, postingText)` answers "where in this document did this text come from". Its
// module header states the premise it is built on: the jd_table Item is a PARAPHRASE OF THE VERY
// DOCUMENT BEING SEARCHED, so a source span always exists to be found. `evidence.ts` reused it to
// compare an employer's requirement against the candidate's profile — two documents with no
// derivation relationship at all. The premise does not transfer, and no threshold repairs a false
// premise: measured on production, the evidence spine evidenced 0 of 10 requirements on opp
// 9f9c370a (run 32451913037) and 0 of 35 on opp 2cb56fb3 (run 32480993987), with 0 refusals against
// 15 readable profile records.
//
// This is NOT a second answer to "where does this text appear". It is the FIRST answer to a
// different question — "does this record support this claim" — which nothing in the repo asks.
// `locate` stays exactly as it is; it is correct in P1's domain. This withdraws a MISUSE.
//
// FUZZY MATCHING IS FOR RANKING, NEVER FOR ACCUSING (house rule), and here that line is drawn
// explicitly: `ratio` ranks candidate excerpts; the accusation — "this excerpt evidences this
// requirement" — is settled by rules that are exact (token identity, or an explicitly enumerated
// morphological fold), never by a similarity score.
//
// NOTHING HERE CALLS A MODEL. Same records + same requirement text = same row, every time. That is
// load-bearing: `RESOLVER_VERSION` exists so a stored row can be attributed to a ruleset, which is
// meaningless if the ruleset is a sampled generation.
//
// OFFSETS ARE ONLY EVER MEASURED ON THE ORIGINAL RECORD TEXT. Lower-casing and folding happen to
// TOKEN STRINGS, never to a rewritten copy of the record that an index is then taken from. This is
// the H32 class (U+0130 lowercases to two code units, so an index into a lower-cased copy is not an
// index into the original) and it is invisible to a substring assertion, because the wrong span is
// still a true substring. See `H:offsets-from-original`.
import { sentenceBounds, type Span } from './requirements'

/**
 * Function words and requirement boilerplate — dropped before anything is measured.
 *
 * Two groups, kept in one set because they are dropped for one reason: neither carries a claim
 * about the candidate.
 *
 *  1. FUNCTION WORDS — the same population `requirements.LOC_STOP` drops.
 *  2. REQUIREMENT BOILERPLATE — `experience`, `ability`, `strong`, `proven`, `knowledge`. Every
 *     posting has them and no résumé sentence is about them.
 *
 * WHAT IS DELIBERATELY *NOT* HERE, and this is the whole point of not reusing `swaps.itemTokens`:
 * `swaps.STOP` also drops `leading lead led drive driven driving using use used`. Those are VERBS,
 * and the verb is the entire difference between "I built it", "I will build it" and "I supported
 * the person who built it". A matcher that deletes the verb and keeps the domain nouns cannot tell
 * a claim from its negation. `itemTokens` is right for its own job (comparing two SKILL ITEMS, where
 * the verb is noise); it is wrong for this one.
 */
const STOP = new Set((
  // function words
  'a an the and or but of in on at to for with without by from as is are was were be been being am ' +
  'this that these those it its we you they i he she our your their his her will would can could ' +
  'shall should may might must do does did have has had not no nor so than such very more most ' +
  'other some any each all both who whom whose which what when where why how there here about into ' +
  'over under across within while during before after above below between through per via up down ' +
  'out off again further then once because if unless until upon among against along toward towards ' +
  // requirement boilerplate
  'experience experienced experiences ability able abilities strong proven demonstrate demonstrated ' +
  'excellent solid deep hands-on hands on knowledge understanding familiarity familiar skill skills ' +
  'skilled expertise track record year years minimum maximum plus preferred required requirement ' +
  'requirements ideal ideally successful successfully effective effectively including include ' +
  'includes included etc e.g i.e ie eg role position candidate you\'ll well good great'
).split(/\s+/))

/**
 * Irregular verb forms, past and participle, mapped to their base.
 *
 * ADDING A LEMMATIZER IS A DECISION, SO IT IS MADE HERE, EXPLICITLY, AND SCOPED.
 * `termMatch.ts:15` records stemming as DELIBERATELY REJECTED (`ops`->`op`, `sre`->`sr`) and
 * `figureEcho.stem()` handles plurals only. Neither of those decisions is reversed: this table and
 * the suffix rules below are used ONLY inside this module, ONLY for deciding whether two tokens are
 * the same word, and NEVER for offsets, for term matching, or for anything a reader is shown.
 *
 * It exists because the defect is a TENSE defect. Requirements are imperative or nominal ("Build
 * and promote...", "Ability to manage..."); résumés are past tense ("Built and promoted..."). No
 * suffix rule reaches `built -> build`; it is irregular, so a table is the only deterministic way.
 * Measured: tense alone moved a requirement from ratio 1.00 to 0.60 and off the bottom of the gate.
 *
 * Kept SHORT and to verbs that actually appear in achievement writing. A long list is a place for a
 * wrong entry to hide.
 */
const IRREGULAR: Record<string, string> = {
  built: 'build', rebuilt: 'rebuild', led: 'lead', ran: 'run', run: 'run', grew: 'grow',
  grown: 'grow', drove: 'drive', driven: 'drive', took: 'take', taken: 'take', made: 'make',
  brought: 'bring', held: 'hold', won: 'win', spoke: 'speak', spoken: 'speak', wrote: 'write',
  written: 'write', sold: 'sell', sought: 'seek', taught: 'teach', thought: 'think',
  began: 'begin', begun: 'begin', chose: 'choose', chosen: 'choose', drew: 'draw', drawn: 'draw',
  gave: 'give', given: 'give', went: 'go', gone: 'go', met: 'meet', oversaw: 'oversee',
  overseen: 'oversee', spent: 'spend', kept: 'keep', left: 'leave', found: 'find',
  understood: 'understand', rewrote: 'rewrite', rewritten: 'rewrite', shrank: 'shrink',
  withdrew: 'withdraw', undertook: 'undertake', undertaken: 'undertake',
}

/**
 * The shortest a suffix-stripped stem may be.
 *
 * 4, so that `ops -> op` and `sre -> sr` — the two cases `termMatch.ts` names as the reason it
 * rejected stemming — cannot be produced here either. `teams -> team` (4) and `built -> build`
 * (irregular, not stripped) both survive.
 */
const MIN_STEM = 4

/**
 * Every form a token could be, as a SET. Two tokens are the same word if their sets intersect.
 *
 * A set rather than a single canonical stem, because `manage`/`managed`/`managing` do not reduce to
 * one string under any rule simple enough to be safe: `managed` yields `manage` (drop `d`) and
 * `manag` (drop `ed`), `managing` yields `manag` and `manage`, and the base `manage` yields only
 * itself. Intersection finds `manage` for every pair without needing to know which is canonical.
 */
export function forms(tokenRaw: string): Set<string> {
  const t = tokenRaw.toLowerCase()
  const out = new Set<string>([t])
  const irr = IRREGULAR[t]
  if (irr) out.add(irr)
  const add = (s: string) => { if (s.length >= MIN_STEM) out.add(s) }
  // A de-doubled form is a SECOND reduction of a stem that already cleared MIN_STEM
  // (`running` -> `runn` -> `run`), so it gets a floor of 3. It cannot produce `ops` -> `op`:
  // that is a plain plural strip on a 3-letter token, which `add` still refuses.
  const addDoubled = (s: string) => { if (s.length >= 3) out.add(s) }

  if (t.endsWith('ies') && t.length > 4) add(`${t.slice(0, -3)}y`)        // strategies -> strategy
  else if (t.endsWith('ied') && t.length > 4) add(`${t.slice(0, -3)}y`)   // identified -> identify
  else if (t.endsWith('sses')) add(t.slice(0, -2))                        // processes -> process
  else if (t.endsWith('es') && t.length > 3) { add(t.slice(0, -1)); add(t.slice(0, -2)) }
  else if (t.endsWith('s') && !t.endsWith('ss')) add(t.slice(0, -1))      // teams -> team

  if (t.endsWith('ed') && t.length > 3) {
    add(t.slice(0, -1))                                                   // promoted -> promote
    add(t.slice(0, -2))                                                   // promoted -> promot
    const s = t.slice(0, -2)
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) addDoubled(s.slice(0, -1))  // shipped -> ship
  }
  if (t.endsWith('ing') && t.length > 4) {
    const s = t.slice(0, -3)
    add(s)                                                                // managing -> manag
    add(`${s}e`)                                                          // managing -> manage
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) addDoubled(s.slice(0, -1))  // running -> run
  }
  return out
}

/** Do two raw tokens denote the same word, allowing only the enumerated folds above? */
export const sameWord = (a: string, b: string): boolean => {
  if (a === b) return true
  const fa = forms(a)
  for (const f of forms(b)) if (fa.has(f)) return true
  return false
}

interface Tok { t: string; s: number; e: number }

/**
 * Tokens with their offsets INTO THE STRING PASSED IN — never into a transformed copy.
 *
 * Identical in shape to `requirements.tokenize` (which is module-private) and identical in the
 * property that matters: `m.index` and `m[0].length` are measured on the original, so lower-casing
 * the token TEXT cannot move the span. That is the H32 fix expressed as a construction rather than
 * as a rule to remember.
 */
export function tokensOf(text: string): Tok[] {
  const out: Tok[] = []
  const re = /[A-Za-z0-9][A-Za-z0-9'+#./-]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const t = m[0].toLowerCase().replace(/[.'-]+$/, '')
    if (t.length > 1) out.push({ t, s: m.index, e: m.index + m[0].length })
  }
  return out
}

/**
 * Tokens of the requirement that LOOK like a proper noun, product, vendor, certification,
 * framework or acronym — the population M11's exact-name rule applies to.
 *
 * Scoped deliberately narrow, and stated as a heuristic rather than a lookup, because the repo has
 * no named-entity table and adding one is the lemmatizer-shaped decision CONCERN 3 says should be
 * made openly, not smuggled in here. A token counts as named when its ORIGINAL form (before
 * lowercasing — case is exactly the signal) shows one of:
 *   - a digit (`SOC 2`, `Office 365`);
 *   - `/`, `+` or `#` (`AI/ML`, `C++`, `C#`);
 *   - an uppercase letter after its first character (`IoT`, `McKinsey`) — mixed case mid-word is
 *     not a spelling a common noun takes;
 *   - capitalized, and NOT the first word of the requirement, where a sentence-initial capital is
 *     orthography rather than a signal (`Kubernetes`, `Snowflake`).
 *
 * STATED LIMITATION, not hidden: a lowercase brand name written in prose — `dbt` — matches none of
 * these and is NOT flagged. That is the same gap CONCERN 3 names for `built -> build`: reaching it
 * needs real entity recognition, which this module does not add.
 */
export function namedEntityTokens(text: string): Set<string> {
  const raw = String(text || '')
  const out = new Set<string>()
  const re = /[A-Za-z0-9][A-Za-z0-9'+#./-]*/g
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(raw)) !== null) {
    const w = m[0]
    const isFirst = idx === 0
    idx++
    const lower = w.toLowerCase().replace(/[.'-]+$/, '')
    if (lower.length <= 1) continue
    const named = /\d/.test(w) || /[/+#]/.test(w) || /[A-Z]/.test(w.slice(1))
      || (!isFirst && /^[A-Z]/.test(w))
    if (named) out.add(lower)
  }
  return out
}

/** The content words of a requirement, in order, deduplicated. Boilerplate never reaches here. */
export function claimTokens(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const { t } of tokensOf(String(text || ''))) {
    if (STOP.has(t) || /^\d+$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

// --- what a requirement IS, before asking whether a sentence supports it -------------------------

/**
 * Eligibility clauses: facts about a person's residence, authorisation or clearance.
 *
 * A residence is a fact about a human being, not a phrase in a résumé. There is no excerpt that can
 * honestly prove one, so this class is REFUSED outright rather than thresholded — no owner setting
 * reaches it (see `SAFETY_FLOOR_RULES`). `checks.ts` already excludes this population from
 * `coverable` and names it in `elig.offenders`, and an `escalation` row asks a human. Refusing here
 * routes the requirement to that path instead of quietly answering it with a coincidence.
 *
 * `remote` is deliberately ABSENT from this pattern. "Ability to manage remote teams" is a claim
 * about what the candidate has done, not about where they live, and it must stay evidenceable.
 */
const ELIGIBILITY_RE = new RegExp([
  'resid(e|es|ing|ence|ent)', 'must live', 'located in', 'based in', 'relocat',
  'commut', 'work authoriz', 'authoriz(ed|ation) to work', 'right to work', 'eligible to work',
  'visa', 'sponsorship', 'green card', 'citizen', 'clearance', 'polygraph',
  'willing to travel', 'travel \\d+\\s*%', 'on-?site', 'in-office',
  'hybrid (work|schedule|model|environment|arrangement)',
].join('|'), 'i')

/**
 * Quantities: years, money, headcount thresholds.
 *
 * These belong to the FACT path (`dimensions.ts:419-425`, `basis:'fact'`), where a stored number is
 * compared with a stated number. H41b already records the invariant in the other direction: the
 * leadership fact settles a leadership requirement and total years cannot stand in for it. An
 * excerpt cannot settle "minimum of 8 years" — prose that mentions eight of something is not a
 * measurement — so no evidence row is written from one.
 *
 * The old resolver reached the same answer by accident: `itemTokens` dropped `years`/`experience` as
 * stopwords and dropped the bare digit `8` for being one character, so the requirement fell below
 * `MIN_JUDGEABLE_TOKENS` and returned null. This matcher raises the token yield, so the accident is
 * gone and the rule has to be stated.
 */
const NUMERIC_RE = new RegExp([
  '\\b\\d+\\s*\\+?\\s*(years?|yrs?)\\b', '\\bminimum of\\s+\\d', '\\bat least\\s+\\d',
  '[$€£]\\s?\\d', '\\bbudget of\\b', '\\bp&l of\\b', '\\b\\d+\\s*(m|mm|bn|b|k)\\b\\+?',
].join('|'), 'i')

/**
 * Negation and attribution inside the excerpt itself.
 *
 * M16's decision, made rather than left to silence: these are REFUSED. An excerpt printed beside a
 * requirement IS the claim "your profile says this", and attributing someone else's accomplishment
 * to the candidate is the highest-severity output this system can produce. "reported to the leader
 * who owned the P&L" contains every word of "owned the P&L" and supports the opposite claim.
 *
 * The cost is stated plainly: this refuses some true matches — a bullet reading "delivered the
 * migration with no downtime" will not evidence a migration requirement. That is a false NEGATIVE,
 * which surfaces the requirement to a human, and it is the direction this whole module errs in.
 */
const NEGATION_RE = new RegExp([
  '\\b(not|never|neither|nor)\\b', '\\bno\\s+\\w', '\\bdeclin(e|ed|ing)\\b',
  '\\brefus(e|ed|ing)\\b', '\\bfailed to\\b', '\\brather than\\b', '\\binstead of\\b',
  // `without` NEGATES only when it precedes a VERB FORM — "without taking on", "without having
  // authority". A bare `without <noun>` ("passed the audit without a finding") describes an
  // OUTCOME, not an absence of the achievement, and flagging it refused a real SOC 2 fixture that
  // had done nothing wrong: "Established the SOC 2 ... and passed the first audit without a
  // finding" supports the establishment claim; "without a finding" is not negating it.
  '\\bwithout\\s+\\w+ing\\b', '\\bwithout\\s+(a|an|any)?\\s*(direct\\s+)?authority\\b',
].join('|'), 'i')

const ATTRIBUTION_RE = new RegExp([
  '\\breport(s|ed|ing)? to\\b', '\\bon behalf of\\b', '\\bunder the (leadership|direction) of\\b',
  '\\bmy (manager|boss|director|lead|leader)\\b', '\\bwho (owned|led|managed|built|ran|drove)\\b',
  '\\bsupport(ed|ing)? the .{0,30}\\bwho\\b',
].join('|'), 'i')

/**
 * What KIND of requirement this is, when the kind alone settles it.
 *
 * Exported and applied BEFORE the token-count gate, so a class refusal is never reported as
 * "unjudgeable". `Minimum of 8 years of engineering leadership experience` yields two content words
 * after boilerplate is dropped, so it used to fall out of the token gate first — the right answer
 * ("no row") for the wrong reason, which is exactly what M13 warns the raised token yield would
 * turn into an accusation the day the wording got longer.
 */
export function requirementClass(text: string): 'eligibility' | 'numeric' | null {
  const t = String(text || '')
  if (ELIGIBILITY_RE.test(t)) return 'eligibility'
  if (NUMERIC_RE.test(t)) return 'numeric'
  return null
}

export type RefusalReason =
  | 'unjudgeable' | 'eligibility' | 'numeric' | 'no_candidate' | 'below_threshold'
  | 'missing_specific_token' | 'generic_overlap_only' | 'list_element_unsupported'
  | 'negated_or_attributed' | 'quote_too_short' | 'no_distinctive_token' | 'banned_source'

/**
 * The rules an owner setting can never reach.
 *
 * An owner may tune how much evidence is enough. An owner may not turn on false provenance. Exported
 * so `H:safety-floor-not-configurable` can assert the list is exactly what the code enforces.
 */
/**
 * The gates a candidate excerpt passes, in order. ONE list, so `supportIn` and
 * `evidence.refusalReason` cannot rank them differently and report two diagnoses for one refusal.
 *
 * A refusal is reported as the FURTHEST any candidate got — the LAST entry present — not as the
 * worst thing any candidate hit. Reporting the worst is what an early version did and it was
 * actively misleading: a five-item list whose best sentence carries four items is refused by the
 * CONJUNCTION rule, but every OTHER sentence in the profile lacks the specific tokens entirely, so
 * "missing_specific_token" won on severity and hid the rule that actually decided it.
 */
export const GATE_ORDER: RefusalReason[] = [
  'quote_too_short', 'no_candidate', 'missing_specific_token', 'generic_overlap_only',
  'list_element_unsupported', 'negated_or_attributed', 'no_distinctive_token', 'below_threshold',
]

/**
 * Reasons decided BEFORE any excerpt is looked at — they are properties of the requirement (or of
 * the profile), not of a candidate, so they are returned directly and never ranked against a gate.
 */
export const PRE_GATE_REASONS: RefusalReason[] = ['eligibility', 'numeric', 'unjudgeable', 'banned_source']

/** How far a refusal got. Higher is further. -1 for a pre-gate reason. */
export const gateProgress = (r: RefusalReason | null): number => (r ? GATE_ORDER.indexOf(r) : -1)

export const SAFETY_FLOOR_RULES: RefusalReason[] = [
  'eligibility', 'numeric', 'missing_specific_token', 'generic_overlap_only',
  'list_element_unsupported', 'negated_or_attributed', 'banned_source',
]

// --- candidate excerpts --------------------------------------------------------------------------

/**
 * Every excerpt a record can offer, as spans of the ORIGINAL text.
 *
 * A segment is a sentence, additionally clipped at line breaks. `sentenceBounds` is reused rather
 * than reimplemented — it carries the abbreviation handling that stops `must be a U.S. Citizen`
 * clipping to `must be a U.S.` — but it does not treat a newline as a boundary, and a stored profile
 * field like a skills block is newline-separated bullets. Without the line clip, one such record is
 * a single 2,000-character "sentence" and any requirement drawn from anywhere in it would quote the
 * whole block.
 *
 * `maxSegments` joins CONTIGUOUS segments only. That matters at the database: the stored row must
 * satisfy `length(quote) = char_end - char_start`, so a quote stitched from two non-contiguous spans
 * is rejected by the schema — and would be a synthesis presented as a verbatim quote.
 */
export function segments(text: string, maxSegments = 1): Span[] {
  const t = String(text || '')
  if (!t) return []

  // Base segments: walk the string, intersecting the sentence bound with the line bound.
  const base: Span[] = []
  let pos = 0
  let guard = 0
  while (pos < t.length && guard++ < 100000) {
    if (/\s/.test(t[pos])) { pos++; continue }
    const sb = sentenceBounds(t, pos)
    let lineEnd = t.indexOf('\n', pos)
    if (lineEnd === -1) lineEnd = t.length
    const start = Math.max(pos, sb.start)
    const end = Math.min(sb.end, lineEnd)
    if (end <= start) { pos = Math.max(pos + 1, Math.min(sb.end, lineEnd + 1)); continue }
    const trimmed = t.slice(start, end).replace(/\s+$/, '')
    if (trimmed) base.push({ start, end: start + trimmed.length })
    pos = end > pos ? end : pos + 1
  }

  const n = Math.max(1, Math.min(3, Math.floor(maxSegments) || 1))
  const out: Span[] = [...base]
  // Contiguous runs. The span runs from the first segment's start to the last one's end, so the
  // quote is one unbroken slice of the record including whatever separates them.
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len <= base.length; i++) {
      out.push({ start: base[i].start, end: base[i + len - 1].end })
    }
  }
  return out
}

// --- the judgement --------------------------------------------------------------------------------

export interface SupportInput {
  /** The requirement, as the employer wrote it. */
  requirement: string
  /** The record's ORIGINAL text. Every offset returned indexes this string. */
  recordText: string
  /**
   * Retained for callers that already build it; no longer consulted by the judgement. Record
   * frequency measured the candidate's career rather than a word's informativeness — see WEAK.
   */
  recordCounts?: Map<string, number>
  threshold: number
  maxSentences: number
  minQuoteChars: number
  minQuoteWords: number
  distinctiveLen: number
}

/**
 * Low-information words whose ABSENCE from an excerpt does not sink the match.
 *
 * THIS REPLACES A RULE THAT WAS BACKWARDS, and the correction is the whole fix.
 * The previous version classed a token as "generic" when it appeared in MORE THAN ONE of the
 * candidate's own profile records, then refused whenever every matched token was generic. Measured
 * against the real production profile (15 records, opp 9f9c370a run 32505124784): `Drive platform
 * modernization` was REFUSED while the profile literally contains "Platform Modernization", because
 * `platform` and `modernization` each appear in several records. That reasoning is inverted — a word
 * recurring across a person's own history means they do that thing constantly, which is STRONGER
 * evidence, not weaker. Record frequency measures the candidate's career, not the word's
 * informativeness, and using it to discount evidence penalised exactly the strongest matches.
 *
 * What actually matters is WHICH token is missing. A missing weak verb (`drive`, `lead`, `support`)
 * costs nothing — every posting opens with one and no résumé sentence is about it. A missing
 * CONTENTFUL word is fatal: `high-performing engineering culture` against a profile that says
 * "security-first engineering culture" is missing `high-performing`, and evidencing it would claim
 * the candidate built a high-performing culture when they documented a different one. That is the
 * false provenance this module exists to prevent, and it is decided by the missing token's kind, not
 * by a ratio.
 *
 * Kept to verbs and degree words that carry no claim on their own. Anything nameable, measurable, or
 * domain-specific stays OUT, so its absence still refuses.
 */
const WEAK = new Set((
  // low-information action verbs a posting uses to introduce a duty
  'drive drives driving drove driven lead leads leading led manage manages managing managed ' +
  'support supports supporting supported ensure ensures ensuring ensured provide provides ' +
  'providing provided deliver delivers delivering delivered own owns owning owned run runs ' +
  'running ran oversee oversees overseeing oversaw help helps helping helped work works working ' +
  'worked perform performs performing performed handle handles handling handled maintain ' +
  'maintains maintaining maintained collaborate collaborates collaborating collaborated ' +
  'partner partners partnering partnered contribute contributes contributing contributed ' +
  // degree and framing words
  'effectively efficiently successfully strongly closely directly broad deep strong solid ' +
  'excellent significant substantial extensive relevant appropriate overall general various'
).split(/\s+/))

/** Does this token carry a claim of its own? Only these must be present for a match to stand. */
export const isContentful = (t: string) => !WEAK.has(t)

/**
 * Domain CATEGORY words — the vocabulary every posting and every résumé in this industry shares.
 *
 * This is M10 ("generic-vocabulary overlap alone is not evidence") expressed the way it should have
 * been the first time. The first attempt measured "generic" as *appears in more than one of the
 * candidate's records*, which is a fact about their career, not about the word — and it refused
 * `Drive platform modernization` against a profile containing "Platform Modernization". This list
 * is a fact about the WORD: `engineering`, `software`, `technology` appear in essentially every
 * technology posting and every technology résumé, so an overlap made only of them discriminates
 * nothing.
 *
 * Deliberately SHORT and deliberately not owner-settable. It is the M10 safety floor, so it must
 * hold at the loosest reachable configuration (M17) — a threshold of 0 must not be able to turn
 * `Strong understanding of software engineering practices` into evidence just because the profile
 * says "software" and "engineering" somewhere while never mentioning `practices`.
 */
const CATEGORY = new Set((
  'engineering engineer software technology technical data platform platforms digital enterprise ' +
  'business systems system solutions operations product products program programme project ' +
  'projects service services team teams organisation organization company industry'
).split(/\s+/))

/** A word so common to this domain that its presence alone distinguishes nothing. */
export const isCategoryWord = (t: string) => CATEGORY.has(t)

export interface SupportResult {
  ok: boolean
  reason: RefusalReason | null
  span: Span | null
  /** RANKING ONLY. Share of the requirement's tokens the excerpt carries with no fold at all. */
  ratio: number
  /** Share carried allowing the enumerated folds — the number `threshold` gates. */
  support: number
  /** Requirement tokens the excerpt does not carry, for the stored `extra` note. */
  missing: string[]
  /** True when the requirement text occurs literally inside the excerpt. */
  literal: boolean
}

const refuse = (reason: RefusalReason): SupportResult =>
  ({ ok: false, reason, span: null, ratio: 0, support: 0, missing: [], literal: false })

/**
 * Split a requirement into list ELEMENTS, or return null when it is not a list.
 *
 * A list is a COMMA SERIES — `IoT data, models, geospatial data, and AI/ML`. The comma is what makes
 * it one, and requiring it is what stops `Build and promote a high-performing engineering culture`
 * being read as two requirements: that is one verb phrase with a shared object, and splitting it
 * would demand the excerpt contain a standalone "build" as well as a standalone "promote".
 */
export function listElements(text: string): string[] | null {
  const s = String(text || '')
  if (!s.includes(',')) return null
  const parts = s.split(/\s*,\s*|\s+\band\b\s+|\s+\bor\b\s+/i)
    // `..., and AI/ML` splits on the COMMA first, so the last element arrives as `and AI/ML`.
    // Without this the element carries a conjunction that is not part of the thing being asked for.
    .map(p => p.trim().replace(/^(?:and|or)\s+/i, '').trim())
    .filter(Boolean)
    .filter(p => claimTokens(p).length > 0)
  // A real conjunctive list has SUBSTANTIVE members. `scalable, secure, high-quality software` is
  // three adjectives modifying one noun, not three requirements, and demanding each as its own
  // evidenced claim refused a requirement nothing was wrong with (measured, run 32505124784).
  // A member counts as substantive when it carries more than one content word or names something.
  const substantive = parts.filter(pt => claimTokens(pt).length > 1 || namedEntityTokens(pt).size > 0)
  return parts.length >= 3 && substantive.length >= 2 ? parts : null
}

/**
 * Where the requirement occurs LITERALLY (case-insensitive) inside the record, tightened to include
 * one trailing sentence-ending mark if the match happens to sit right against one — or null.
 *
 * Exists so an exact literal match gets the TIGHT quote `locate`'s old exact branch gave it, rather
 * than always widening to the whole containing sentence. Widening only helps the FOLDED case (M6:
 * the requirement's own words are not literally present, so the excerpt needs the whole statement
 * to avoid presenting a truncated fragment as the claim) — it is pure padding when the requirement
 * already IS the record's own words. `needle.length >= 8` mirrors the same floor `locate`'s exact
 * branch used, so a two-word requirement cannot win by accident on a coincidental substring.
 *
 * This is NOT a reuse of `locate()` and does not inherit its premise: it does not sweep for an
 * ANCHORED span when no exact one exists (that is what made `locate` wrong here), it only checks
 * whether the words are literally there — a check that is safe regardless of which document derived
 * from which.
 */
function literalSpan(requirement: string, text: string): Span | null {
  const needle = requirement.trim().replace(/[.;:,]+$/, '')
  if (needle.length < 8) return null
  // Case-insensitive REGEX EXEC against the ORIGINAL string — never `text.toLowerCase().indexOf(...)`.
  // `toLowerCase()` is not length-preserving (H32: U+0130 -> two code units), so an index found on a
  // lower-cased COPY is not a valid index into `text`. `m.index` here is measured on `text` itself.
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const m = re.exec(text)
  if (!m) return null
  let end = m.index + m[0].length
  if (end < text.length && /[.!?]/.test(text[end])) end++
  return { start: m.index, end }
}

/**
 * Does this record support this requirement, and if so with which excerpt?
 *
 * The order of the gates is the order of their severity, so a refusal names the strongest reason.
 */
export function supportIn(input: SupportInput): SupportResult {
  const requirement = String(input.requirement || '')
  const text = String(input.recordText || '')
  if (!requirement || !text) return refuse('no_candidate')

  const klass = requirementClass(requirement)
  if (klass) return refuse(klass)

  const want = claimTokens(requirement)
  if (want.length < 1) return refuse('unjudgeable')

  const distinctive = want.filter(t => t.length >= input.distinctiveLen)
  const elements = listElements(requirement)
  // Every NAMED token must be carried exactly — Snowflake, Kubernetes, SOC 2, AI/ML, an employer's
  // own name. No ratio, no fold beyond the enumerated ones, no similarity.
  const mustName = want.filter(t => namedEntityTokens(requirement).has(t))
  // Every CONTENTFUL token must be carried too. The weak verbs and degree words are the only ones
  // whose absence is survivable — see WEAK's comment for the measured reason.
  const mustCarry = want.filter(isContentful)

  let best: SupportResult | null = null
  // Why each candidate excerpt failed, so a refusal is a DIAGNOSIS rather than a shrug. Without
  // this the strongest reason is invisible: a list requirement whose missing element happens to be
  // generic vocabulary is refused by the conjunction rule and would otherwise be reported as merely
  // "below threshold", which reads like a tuning problem instead of a safety refusal.
  const seen: RefusalReason[] = []
  // The literal span (if any) is tried ALONGSIDE the sentence segments, not instead of them — the
  // ranking below (ratio, then shorter excerpt) picks it naturally when it wins, and falls back to
  // a full-sentence candidate when no exact literal span exists.
  const lit = literalSpan(requirement, text)
  const candidates = lit ? [lit, ...segments(text, input.maxSentences)] : segments(text, input.maxSentences)
  for (const span of candidates) {
    const excerpt = text.slice(span.start, span.end)
    if (excerpt.length < input.minQuoteChars) { seen.push('quote_too_short'); continue }
    if (excerpt.trim().split(/\s+/).filter(Boolean).length < input.minQuoteWords) { seen.push('quote_too_short'); continue }

    const have = tokensOf(excerpt).map(x => x.t)
    const haveSet = new Set(have)
    const carries = (t: string) => haveSet.has(t) || have.some(h => sameWord(t, h))

    const matched = want.filter(carries)
    if (matched.length === 0) { seen.push('no_candidate'); continue }
    // Measured over CONTENTFUL tokens only, and this is where the two halves divide.
    //
    // NAMED tokens (above) are absolute: no threshold reaches them, because an excerpt that does not
    // contain `Snowflake` cannot evidence a Snowflake requirement at any setting. Everything else is
    // a matter of DEGREE and belongs to the owner's threshold.
    //
    // Weak verbs are excluded from the denominator, not merely tolerated in the numerator: leaving
    // them in penalises the same absence twice. Measured — `Drive platform modernization` against a
    // profile literally containing "Platform Modernization" scored 2/3 = 0.667 and was refused for
    // missing `drive` alone. The threshold asks how much of the CLAIM is present, and a weak verb
    // carries no claim.
    //
    // An earlier revision of this fix made contentful coverage a HARD gate as well. That was wrong
    // in a way worth recording: every contentful token then had to be carried, so `support` was
    // always exactly 1 by the time it was compared, and the owner's threshold became inert — a
    // settings-shaped constant, the exact defect H42 exists to catch. Caught by the two threshold
    // tests in `evidence.test.mjs`, which is why they assert MOVEMENT rather than a value.
    const judged = mustCarry.length ? mustCarry : want
    const support = judged.filter(carries).length / judged.length
    const exactHits = want.filter(t => haveSet.has(t)).length
    const ratio = exactHits / want.length

    // --- the safety floor: exact rules, in the order their violation is most serious -------------
    //
    // A NAMED token must be CARRIED — Snowflake, Kubernetes, SOC 2, AI/ML. No ratio, no stem beyond
    // the enumerated folds, no similarity. An ordinary specific word that happens to be missing
    // (`design` in a roadmap requirement) is NOT this rule — it just costs `support`, same as any
    // other unmatched token, and the threshold below decides whether that is still enough.
    if (mustName.some(t => !carries(t))) { seen.push('missing_specific_token'); continue }
    // M10's floor, and it is NOT threshold-governed: when something contentful is missing and
    // everything present is domain category vocabulary, the overlap discriminates nothing. Held at
    // every reachable setting, because the loosest threshold is exactly where this would otherwise
    // manufacture evidence.
    {
      const got = mustCarry.filter(carries)
      const lost = mustCarry.filter(t => !carries(t))
      if (lost.length && got.length && got.every(isCategoryWord)) {
        seen.push('generic_overlap_only'); continue
      }
    }
    // M10 in its own words: an overlap made only of words that recur across unrelated records —
    // `engineering` for a technology executive — is supplied by the industry, not the achievement.
    // A conjunction is evidenced whole or not at all. Element granularity deliberately ignores the
    // generic waiver above: one member of a five-item list is never the list.
    if (elements && !elements.every(el => claimTokens(el).every(carries))) { seen.push('list_element_unsupported'); continue }
    if (NEGATION_RE.test(excerpt) || ATTRIBUTION_RE.test(excerpt)) { seen.push('negated_or_attributed'); continue }
    if (distinctive.length && !distinctive.some(carries)) { seen.push('no_distinctive_token'); continue }

    // --- the owner-settable part -----------------------------------------------------------------
    if (support < input.threshold) { seen.push('below_threshold'); continue }

    const cand: SupportResult = {
      ok: true, reason: null, span, ratio: Math.round(ratio * 1000) / 1000, support,
      missing: want.filter(t => !carries(t)),
      literal: excerpt.toLowerCase().includes(requirement.trim().replace(/[.;:,]+$/, '').toLowerCase()),
    }
    // Rank: more of the requirement carried literally wins; then the shorter excerpt, because a
    // tighter quote is better proof of the same claim; then the earlier position, so the result does
    // not depend on the order `segments` happens to emit runs in.
    if (!best) { best = cand; continue }
    if (cand.ratio > best.ratio) { best = cand; continue }
    if (cand.ratio < best.ratio) continue
    const cl = cand.span!.end - cand.span!.start
    const bl = best.span!.end - best.span!.start
    if (cl < bl || (cl === bl && cand.span!.start < best.span!.start)) best = cand
  }

  if (best) return best
  if (!seen.length) return refuse('no_candidate')
  let furthest: RefusalReason = seen[0]
  for (const r of seen) if (gateProgress(r) > gateProgress(furthest)) furthest = r
  return refuse(furthest)
}

/** How many records contain each token — the input to the generic/specific split. */
export function countTokensAcrossRecords(records: Array<{ text: string }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const rec of records || []) {
    if (!rec || typeof rec.text !== 'string') continue
    for (const t of new Set(tokensOf(rec.text).map(x => x.t))) {
      counts.set(t, (counts.get(t) || 0) + 1)
    }
  }
  return counts
}

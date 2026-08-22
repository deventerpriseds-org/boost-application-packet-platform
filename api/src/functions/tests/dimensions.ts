// P8.4 — the posting-vs-profile comparison, graded by dimension.
//
// Pure: no @azure/functions, no pg (H12's rule, applied here by choice before anyone asks).
// Exercised by api/test/dimensions.test.mjs.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// A DIMENSION is a named axis of comparison — "Leadership tenure", "Budget owned". It is not a
// requirement and a requirement is not a dimension: several posting lines can feed one dimension,
// and most lines feed none. For one opportunity a dimension resolves to at most ONE row carrying
// what the posting asks on that axis, what the stored profile evidences on it, and a grade.
//
// The grade is about the PROFILE, never about a generated document. Nothing has been written into
// an asset when the JD step renders, and `SPEC.md:145-146` says the copy must say so. That is also
// why this module never imports the checks engine's document-side coverage: `covers()` answers
// "did these words land in the artifact", which is a different question with a different answer.
//
// THREE FAILURE MODES THIS FILE IS SHAPED AROUND, each of which has already shipped once somewhere
// in this codebase:
//
//  1. A ratio over an empty population read as a pass. The prototype's grader returns 'strong' for
//     `d === 0` (`docs/qc-evidence/qc/data.js:606`), so a class the posting never mentioned renders
//     "0 of 0 · Strong match". `gradeFit` returns `not_applicable` for a zero denominator and there
//     is no branch that can produce a grade without one.
//  2. "No evidence" printed over a measured shortfall. The prototype maps weak → 'No evidence'
//     (`data.js:583`) and its one weak fixture happens to be a true absence, so the fixture cannot
//     expose it. `shortfall` distinguishes `nothing_found` from `falls_short`, and the two carry
//     different sentences.
//  3. A number asserted with no comparator. This USED to describe Organization size and Budget
//     owned: `checkAgainstFacts` did arithmetic for years only, so `people` and `usd` fell through
//     to `unknown` and two of the eight named dimensions could never be graded from their figures.
//     D23 fixed that in `ownerFacts` — the ONE demand parser, extended per unit — and this module
//     now grades them. The REFUSAL remains, because the reason for it does: a number this system
//     cannot put on the same scale as the posting's is recorded as
//     `numeric_verdict: 'unavailable'` and said out loud, rather than eyeballed. That case is no
//     longer hypothetical either — see the scale guard in the fact path below, where an owner's
//     budget stored without its magnitude ("$18M" saved as 18 by Settings) is refused rather than
//     graded, because grading it would accuse them of a shortfall they do not have.
import { itemTokens } from './swaps'
import { OwnerFact, parseQuantity, factQuantity, formatQuantity, isComparableUnit, Quantity, FACT_BY_KEY } from './ownerFacts'
import { MIN_JUDGEABLE_TOKENS } from './evidence'

/**
 * Bumped when the seeded set, a matcher, or a grading rule changes, so old rows stay findable.
 *
 * 2 (D23): `people` and `usd` are graded from their figures. Rows written at version 1 recorded
 * `numeric_verdict: 'unavailable'` for Organization size and Budget owned because no comparator
 * existed; the same inputs now produce a grade, so the two are not the same measurement and must
 * not be read as one.
 */
export const DIMENSION_VERSION = 2

export type Fit = 'strong' | 'moderate' | 'weak' | 'not_applicable'

/** How the grade was reached. Recorded on every row so a reader can tell arithmetic from overlap. */
export type Basis = 'fact' | 'evidence' | 'none'

/** Whether the numbers on the two sides were actually compared. `null` = this axis has no number. */
export type NumericVerdict = 'satisfied' | 'not_satisfied' | 'unavailable' | null

/** Weak has two meanings and they are not interchangeable. */
export type Shortfall = 'nothing_found' | 'falls_short' | null

export interface DimensionDef {
  key: string
  label: string
  /**
   * Which posting lines belong to this axis. A MATCHER, not a preference — the same kind of thing
   * as `ELIGIBILITY_RE` (checks.ts) and `FactDef.asks` (ownerFacts.ts), and like them it lives in
   * code. What the owner configures is WHICH dimensions apply to a role family (`DIMENSION_SETS`),
   * which is the list a user would reasonably want to change; a regular expression is not.
   */
  asks: RegExp
  /**
   * The owner_facts this axis can be settled by, MOST SPECIFIC FIRST.
   *
   * A list rather than one key because of a defect measured in this codebase, not a hypothetical:
   * `checkAgainstFacts` scans `FACT_CATALOGUE` in order and returns on the FIRST def whose `asks`
   * matches (`ownerFacts.ts:104-135`). `experience.years_total`'s matcher (`/\d+\+? (years|yrs)/`)
   * is a strict superset of `experience.years_leadership`'s (the same, plus a leadership word), and
   * `years_total` is listed first — so `experience.years_leadership` can never be selected for any
   * text at all. Measured: "Requires 10+ years of engineering leadership experience" resolves to
   * `experience.years_total`, and no counterexample exists by construction.
   *
   * Reordering that catalogue would change which requirements the GATE treats as settled
   * (`checks.ts:474-475` drops fact-resolved rows from `coverable`), which is a different lane's
   * blast radius. So this module accepts whichever fact the matcher actually returned, RECORDS it,
   * and says on the row which of the owner's numbers was compared — rather than printing a
   * leadership grade derived from a total-experience number without saying so. Recorded in
   * `.claude/DEFERRED.md`.
   */
  factKeys?: string[]
  /** Why this axis is on the list, shown in the settings surface. */
  help: string
}

/**
 * The eight dimensions the backlog names, seeded as FIRST VALUES.
 *
 * `BACKLOG.md:403-405`: "tenure, org size, budget, compliance, modernization, cycle time, domain,
 * public sector — configurable per role family". The labels below are `SPEC.md:141-144`'s.
 */
export const DIMENSION_CATALOGUE: DimensionDef[] = [
  { key: 'leadership_tenure', label: 'Leadership tenure', factKeys: ['experience.years_leadership', 'experience.years_total'],
    asks: /\b\d+\+?\s*(?:years|yrs)\b/i,
    help: 'How long the posting wants you to have been leading, against your recorded years.' },
  { key: 'organization_size', label: 'Organization size', factKeys: ['scope.largest_team'],
    asks: /\b(?:team|org|organi[sz]ation|headcount|direct reports|engineers|staff)\b/i,
    help: 'The size of the organization the posting describes, against the largest you have led.' },
  { key: 'budget_owned', label: 'Budget owned', factKeys: ['scope.largest_budget'],
    asks: /\b(?:p&l|budget|spend|opex|capex|\$\s?\d)/i,
    help: 'Budget or P&L the posting asks you to own, against the largest you have owned.' },
  { key: 'compliance_ownership', label: 'Compliance ownership',
    asks: /\b(?:soc\s?2|iso\s?27001|hipaa|pci|gdpr|fedramp|audit|compliance|regulat\w*|controls)\b/i,
    help: 'Compliance regimes the posting names, against what your profile evidences owning.' },
  { key: 'platform_modernization', label: 'Platform modernization',
    asks: /\b(?:modern\w*|monolith|micro-?services|re-?platform\w*|migrat\w*|cloud-?native|legacy|refactor\w*)\b/i,
    help: 'Modernization the posting describes, against rebuilds your profile evidences.' },
  { key: 'cycle_time', label: 'Cycle time',
    asks: /\b(?:cycle time|lead time|delivery speed|time to market|throughput|velocity|deployment frequency|dora)\b/i,
    help: 'Delivery-speed outcomes the posting asks for, against what your profile evidences.' },
  { key: 'domain_background', label: 'Domain background',
    asks: /\b(?:industry|domain|vertical|industrial|iot|safety-?critical|fintech|healthcare|manufactur\w*|logistics)\b/i,
    help: 'The industry the posting is in, against the domains your profile covers.' },
  { key: 'public_sector', label: 'Public sector',
    asks: /\b(?:public sector|government|federal|fedramp|gsa|state and local|municipal|procurement)\b/i,
    help: 'Public-sector exposure the posting asks for, against what your profile evidences.' },
]

export const DIMENSION_BY_KEY = new Map(DIMENSION_CATALOGUE.map(d => [d.key, d]))

/** Every seeded dimension, in catalogue order. The fallback set when a family is not configured. */
export const DEFAULT_SET_KEY = 'default'

/**
 * Seeded per-role-family sets — FIRST VALUES the owner changes, never permanent constants.
 *
 * Keyed by `roleTaxonomy` family slug (`roleTaxonomy.ts:45-56`), which is the role-family concept
 * this product already has. A third role concept would be the "extend, don't duplicate" failure.
 * Only families whose seeded set DIFFERS from the default are listed; everything else inherits it,
 * so this map is a set of deliberate departures rather than ten copies of one list.
 */
export const DIMENSION_SETS: Record<string, string[]> = {
  [DEFAULT_SET_KEY]: DIMENSION_CATALOGUE.map(d => d.key),
  product: ['leadership_tenure', 'organization_size', 'budget_owned', 'cycle_time', 'domain_background', 'public_sector'],
  data: ['leadership_tenure', 'organization_size', 'budget_owned', 'compliance_ownership', 'platform_modernization', 'domain_background'],
  architecture: ['leadership_tenure', 'compliance_ownership', 'platform_modernization', 'cycle_time', 'domain_background'],
}

export type SetSource = 'owner' | 'seed_family' | 'seed_default'

export interface ResolvedDimensionSet {
  family: string
  keys: string[]
  defs: DimensionDef[]
  source: SetSource
  /**
   * Present whenever the set did NOT come from configuration for this family. Callers must surface
   * it. Same posture, and the same reason, as `ResolvedRoleFocus.warning` (`roleFocus.ts:5-16`): a
   * silent fallback and a chosen configuration produce identical output, and the difference is
   * exactly what a reader needs.
   */
  warning?: string
}

/**
 * Which dimensions apply to this role family, and WHERE that answer came from.
 *
 * `stored` is the owner's configuration: `{ [family]: string[] }`. An empty array is a real answer
 * (the owner turned every dimension off for that family) and is honoured; `undefined` is not.
 */
export function dimensionsFor(family: string | null | undefined, stored?: Record<string, string[]> | null): ResolvedDimensionSet {
  const fam = String(family || '').trim().toLowerCase() || DEFAULT_SET_KEY
  const pick = (keys: string[]) => keys.map(k => DIMENSION_BY_KEY.get(k)).filter(Boolean) as DimensionDef[]

  const ownerKeys = stored && Object.prototype.hasOwnProperty.call(stored, fam) ? stored[fam] : undefined
  if (Array.isArray(ownerKeys)) {
    const keys = ownerKeys.filter(k => DIMENSION_BY_KEY.has(k))
    return { family: fam, keys, defs: pick(keys), source: 'owner' }
  }
  const ownerDefault = stored && Array.isArray(stored[DEFAULT_SET_KEY]) ? stored[DEFAULT_SET_KEY] : null
  if (ownerDefault) {
    const keys = ownerDefault.filter(k => DIMENSION_BY_KEY.has(k))
    return {
      family: fam, keys, defs: pick(keys), source: 'owner',
      warning: `no dimension set configured for role family "${fam}"; used your default set — change it in Settings ▸ Comparison dimensions`,
    }
  }
  if (Array.isArray(DIMENSION_SETS[fam])) {
    const keys = DIMENSION_SETS[fam]
    return { family: fam, keys, defs: pick(keys), source: 'seed_family' }
  }
  const keys = DIMENSION_SETS[DEFAULT_SET_KEY]
  return {
    family: fam, keys, defs: pick(keys), source: 'seed_default',
    warning: `no dimension set configured for role family "${fam}"; used the seeded default set — change it in Settings ▸ Comparison dimensions`,
  }
}

/**
 * The four-card / ratio grade, `SPEC.md:146` exactly: >= 0.99 strong, >= 0.7 moderate, else weak.
 *
 * A ZERO DENOMINATOR IS NOT A GRADE. The prototype returns 'strong' for `d === 0`
 * (`qc/data.js:606`); that is absent evidence rendered as a pass, which is the one thing this whole
 * layer exists to stop, and it is the reason this function returns `not_applicable` instead of
 * taking `0/0`. Every caller must handle the fourth value.
 */
export const STRONG_AT = 0.99
export const MODERATE_AT = 0.7

export function gradeFit(covered: number, total: number): Fit {
  if (!Number.isFinite(covered) || !Number.isFinite(total) || total <= 0) return 'not_applicable'
  const ratio = covered / total
  if (ratio >= STRONG_AT) return 'strong'
  if (ratio >= MODERATE_AT) return 'moderate'
  return 'weak'
}

/** The label a grade prints. `weak` deliberately has TWO, because it means two different things. */
export const FIT_LABEL: Record<string, string> = {
  strong: 'Strong match',
  moderate: 'Moderate match',
  weak_nothing_found: 'Nothing found',
  weak_falls_short: 'Falls short',
  weak: 'Falls short',
  not_applicable: 'Not compared',
}

export function fitLabel(fit: Fit, shortfall?: Shortfall): string {
  if (fit !== 'weak') return FIT_LABEL[fit]
  return shortfall === 'nothing_found' ? FIT_LABEL.weak_nothing_found : FIT_LABEL.weak_falls_short
}

/** A requirement row joined to its evidence — the shape `loadRequirementsWithEvidence` returns. */
export interface ComparisonRequirement {
  seq: number
  verbatim: string | null
  item_text: string
  kind: string
  match_method?: string | null
  /**
   * `method` IS PART OF THE EVIDENCE, and leaving it out was not a simplification.
   *
   * Without it this module structurally could not tell a rule's finding from a model's proposal, so
   * `evidenced` below counted both and a proposed row graded a dimension `strong` — measured by an
   * independent verifier: `platform_modernization` weak -> strong with a model's quote in the
   * `profile` slot under `basis:'evidence'`, written to `comparison_dimension` on the deployed path.
   * A type that cannot express the distinction cannot be asked to respect it.
   */
  evidence?: { quote: string; source_label: string; source_kind: string; ratio?: number | null; method?: string | null } | null
}

export interface ComparisonInput {
  requirements: ComparisonRequirement[]
  /** False when the stored profile could not be READ. Never the same as "supports nothing". */
  profileReadable: boolean
  facts?: OwnerFact[]
  defs: DimensionDef[]
  /** The posting changed since the offsets were measured — nothing derived from them is measured. */
  stale?: boolean
  minTokens?: number
}

export interface DimensionRow {
  key: string
  label: string
  fit: Fit
  basis: Basis
  numeric_verdict: NumericVerdict
  shortfall: Shortfall
  /** The posting's side. `quoted` false means `text` is the model's paraphrase, never a quote. */
  posting: { seq: number; text: string; quoted: boolean } | null
  /** The profile's side. NEVER a model's summary — an excerpt, or a fact the owner confirmed. */
  profile: { value: string; source_label: string; source: 'evidence' | 'fact' } | null
  /** Mandatory for moderate and weak. Derived from stored values, never model prose. */
  note: string | null
  /** Why this axis was not graded. Mandatory for not_applicable. */
  reason: string | null
  covered: number | null
  total: number | null
  matched_seqs: number[]
  dimension_version: number
}

const textOf = (r: ComparisonRequirement) => String(r.verbatim || r.item_text || '')
const label = (r: ComparisonRequirement) => `#${r.seq} ${textOf(r).slice(0, 80)}`

/** A fact only speaks when the owner has confirmed it (`ownerFacts.ts:92-99`). */
function confirmedFact(key: string | undefined, facts: OwnerFact[]): OwnerFact | null {
  if (!key) return null
  const f = facts.find(x => x.key === key)
  return f && f.value != null && f.value !== '' && f.confirmed_at ? f : null
}

/** The first of this axis's facts the owner has actually confirmed, in most-specific order. */
function firstConfirmed(keys: string[] | undefined, facts: OwnerFact[]): OwnerFact | null {
  for (const k of keys || []) { const f = confirmedFact(k, facts); if (f) return f }
  return null
}

/** The fact's human label, so a row can say WHICH of the owner's numbers was compared. */
const factLabel = (key: string) => FACT_BY_KEY.get(key)?.label || key
const factUnit = (key: string) => FACT_BY_KEY.get(key)?.unit || 'that unit'

/**
 * Can the fact matcher actually COMPARE this fact's unit to a number in the posting?
 *
 * D23 widened this from years-only to `years | people | usd`, and it does NOT decide the answer
 * itself — `isComparableUnit` (ownerFacts.ts) does, beside the parser that implements it. Two
 * places answering "which units have arithmetic" is how this module and the gate come to disagree
 * about the same fact, so there is one answer and this function reads it.
 *
 * Blast radius, traced rather than assumed. Extending the comparator changes what
 * `checkAgainstFacts` returns for scope requirements — `unknown` becomes `satisfied` or
 * `not_satisfied` — and `checks.ts:474-475` drops fact-resolved rows from `coverable`. Measured on
 * the source: `ownedByFacts` is built from ALL fact verdicts INCLUDING `unknown`, and `coverable`
 * excludes `ownedByFacts`, so the same rows leave `coverable` either way and the coverage
 * denominator is unchanged. What DOES change is which bucket the row reports in: `facts_needed`
 * loses it, and `facts_settled` or `fact_shortfall` (state `warn`) gains it. That is the intended
 * product change and it is the same shape D22's fix had.
 */
export function hasNumericComparator(factKey: string | undefined): boolean {
  if (!factKey) return false
  const def = FACT_BY_KEY.get(factKey)
  return !!def && isComparableUnit(def.unit)
}

/** The unit an axis's fact is measured in, when that unit has arithmetic. */
function comparableUnitOf(factKey: string): Quantity | null {
  const u = FACT_BY_KEY.get(factKey)?.unit
  return isComparableUnit(u) ? u : null
}

const NOT_APPLICABLE_STALE = 'the posting changed since these offsets were measured, so nothing here has been compared'
const NOT_APPLICABLE_UNREADABLE = 'your stored profile could not be read, so no comparison could be made'

/**
 * Build one comparison row per configured dimension.
 *
 * Deterministic and model-free: same inputs, same rows, same order, every time. A model call in
 * here would make every criterion above it unfalsifiable and would change the grades on re-run.
 */
export function buildComparison(input: ComparisonInput): DimensionRow[] {
  const minTokens = typeof input.minTokens === 'number' ? input.minTokens : MIN_JUDGEABLE_TOKENS
  const reqs = Array.isArray(input.requirements) ? input.requirements : []
  const facts = input.facts || []

  const na = (d: DimensionDef, reason: string, extra: Partial<DimensionRow> = {}): DimensionRow => ({
    key: d.key, label: d.label, fit: 'not_applicable', basis: 'none', numeric_verdict: null,
    shortfall: null, posting: null, profile: null, note: null, reason,
    covered: null, total: null, matched_seqs: [], dimension_version: DIMENSION_VERSION, ...extra,
  })

  return (input.defs || []).map((d): DimensionRow => {
    // Order matters: the states that mean "nothing was measured" are checked BEFORE anything that
    // could produce a grade, so no branch below can grade over an input it never read.
    if (input.stale) return na(d, NOT_APPLICABLE_STALE)
    if (!reqs.length) return na(d, 'this posting produced no lines to compare against')

    const matched = reqs.filter(r => d.asks.test(textOf(r)))
    if (!matched.length) return na(d, `this posting does not ask about ${d.label.toLowerCase()}`)

    const matched_seqs = matched.map(r => r.seq)

    // Unreadable profile is checked AFTER matching, so the row can still say what the posting asks
    // — one side of a two-sided comparison is more use than an empty row — but it is never graded.
    if (!input.profileReadable) {
      return na(d, NOT_APPLICABLE_UNREADABLE, { posting: postingSide(matched), matched_seqs })
    }

    const judgeable = matched.filter(r => itemTokens(textOf(r)).length >= minTokens)
    if (!judgeable.length) {
      return na(d, `the ${matched.length} line(s) this posting asks on ${d.label.toLowerCase()} are too short to judge either way`,
        { posting: postingSide(matched), matched_seqs })
    }

    const posting = postingSide(judgeable)

    // ── the fact path: arithmetic beats token overlap when the arithmetic is available ──────────
    // THE AXIS'S OWN FACT, not whichever fact a first-match scan happens to return.
    //
    // `checkAgainstFacts` is deliberately NOT the selector here, and the reason is measured rather
    // than stylistic. It scans `FACT_CATALOGUE` in order and returns on the first def whose `asks`
    // matches (`ownerFacts.ts:104-135`); `experience.years_total` is listed first and its matcher is
    // a strict superset of `experience.years_leadership`'s, so for an owner who has recorded their
    // LEADERSHIP years and not their total years it returns
    // `{ fact_key: 'experience.years_total', verdict: 'unknown', detail: 'no value recorded' }` —
    // the recorded fact is invisible and the dimension reports a gap the owner does not have.
    // Reproduced against the built module before this branch was written.
    //
    // What is reused is the ARITHMETIC (`demandedNumber`) and the CONFIRMATION rule, which are the
    // parts that must not diverge. What is not reused is the selection, which is the broken part.
    // The underlying defect still affects the gate and is recorded in `.claude/DEFERRED.md`.
    const numericFactKey = (d.factKeys || []).find(k => hasNumericComparator(k) && confirmedFact(k, facts))
    if (numericFactKey) {
      const used = confirmedFact(numericFactKey, facts)!
      // The AXIS'S unit drives BOTH sides. Reading the posting with the years pattern while the
      // fact is measured in people is the shape D23 would have shipped if only
      // `hasNumericComparator` were widened: `demandedNumber` returns null for any text without
      // the word "years", every line would `continue`, and the row would silently fall through to
      // the evidence path — the change landing and doing nothing.
      const unit = comparableUnitOf(numericFactKey)
      const owned = unit ? factQuantity(used, unit) : null
      if (unit && owned) {
        const profile = { value: String(used.value), source_label: factLabel(numericFactKey), source: 'fact' as const }
        for (const r of judgeable) {
          const demanded = parseQuantity(textOf(r), unit)
          if (demanded === null) continue
          const posted = { seq: r.seq, text: textOf(r), quoted: !!r.verbatim }

          // THE SCALE GUARD. Settings > Facts stores "$18M" as value_num 18 (it strips the
          // magnitude: `Number(String(v).replace(/[^0-9.]/g,''))`, Settings.jsx:1489) while
          // `deriveFacts` stores the same figure as 18000000 — two writers, one fact, six orders
          // of magnitude apart, both live in `owner_fact` today. Grading 18 against 10000000 would
          // print "Falls short" at an owner who runs an $18M budget. This is an accusation, and
          // the standing rule is that accusations are never made on a value this system is not
          // sure it can compare. Refused, named, and NOT rescaled upward — rescaling would turn a
          // real $18K shortfall into a pass, which is strictly worse than the bug being fixed.
          if (unit === 'usd' && !owned.explicit && demanded.value >= 1000 && owned.value < 1000) {
            return na(d,
              `your profile records ${factLabel(numericFactKey).toLowerCase()} as "${used.value}", which does not say whether that is dollars, thousands or millions — so it was NOT compared to the ${formatQuantity(demanded.value, unit)} this posting asks for. Re-enter it with its magnitude (for example "$18M") in your master profile`,
              { posting: posted, matched_seqs, numeric_verdict: 'unavailable', profile })
          }

          const detail = `${formatQuantity(owned.value, unit)} recorded, ${formatQuantity(demanded.value, unit)} required`
          if (owned.value >= demanded.value) {
            return {
              key: d.key, label: d.label, fit: 'strong', basis: 'fact', numeric_verdict: 'satisfied',
              shortfall: null, posting: posted, profile, note: null, reason: null,
              covered: 1, total: 1, matched_seqs, dimension_version: DIMENSION_VERSION,
            }
          }
          return {
            key: d.key, label: d.label, fit: 'weak', basis: 'fact', numeric_verdict: 'not_satisfied',
            shortfall: 'falls_short', posting: posted, profile,
            note: `${detail} — the posting asks for more than your recorded ${factLabel(numericFactKey).toLowerCase()}`,
            reason: null, covered: 0, total: 1, matched_seqs, dimension_version: DIMENSION_VERSION,
          }
        }
      }
      // The fact is confirmed and comparable, but no judgeable line states a number to compare it
      // to. Fall through to the evidence path rather than inventing a demand.
    }

    // ── the evidence path ───────────────────────────────────────────────────────────────────────
    // A line is evidenced when it HAS an excerpt AND a RULE chose that excerpt.
    //
    // The second half is the correction. `checks.ts` refuses to let a model-proposed row move
    // `must_have_coverage`, on the grounds that a byte-exact quote is not a relevance finding — but
    // this module is a FOURTH grader, in another file, outside the set that guard covers, and it was
    // counting proposals as evidence. The comparison card is where the owner reads how they measure
    // up, so a proposal grading a dimension `strong` is the same claim the gate refuses to make,
    // made somewhere the gate cannot see. Same rule, same reason, one line lower down the stack.
    const ruleEvidenced = (r: ComparisonRequirement) =>
      !!(r.evidence && r.evidence.quote && r.evidence.method !== 'proposed')
    const evidenced = judgeable.filter(ruleEvidenced)
    const unevidenced = judgeable.filter(r => !ruleEvidenced(r))

    // A fact the owner confirmed still SHOWS on the profile side even when it cannot be compared —
    // that is the two-sidedness the acceptance sentence asks for. What it must not do is grade.
    const uncomparableFact = (d.factKeys || []).some(hasNumericComparator) ? null : firstConfirmed(d.factKeys, facts)
    const uncomparableKey = uncomparableFact ? (d.factKeys || []).find(k => confirmedFact(k, facts) === uncomparableFact)! : null

    if (!evidenced.length) {
      // Nothing in the profile speaks to this axis. The ONE case where the only signal available is
      // a number nobody can compare is not a finding about the candidate — it is a missing
      // comparator, and reporting it as a shortfall would be an accusation built on absent evidence.
      if (uncomparableFact) {
        // Reachable only for an axis whose fact is measured in a unit that has NO arithmetic —
        // `percent`, or a fact with no unit at all. It is NOT reachable for Organization size or
        // Budget owned any more, and saying otherwise would be the product printing a limitation
        // it no longer has. `H:comparator-units-agree` fails if a factKey'd axis loses arithmetic.
        return na(d, `your profile records ${factLabel(uncomparableKey!).toLowerCase()} as "${uncomparableFact.value}", but this system has no way to compare ${factUnit(uncomparableKey!)} to the figure in the posting, so no grade is claimed`,
          {
            posting, matched_seqs, numeric_verdict: 'unavailable',
            profile: { value: String(uncomparableFact.value), source_label: factLabel(uncomparableKey!), source: 'fact' },
          })
      }
      return {
        key: d.key, label: d.label, fit: 'weak', basis: 'evidence', numeric_verdict: null,
        shortfall: 'nothing_found', posting, profile: null,
        note: `nothing in your profile evidences the ${judgeable.length} line(s) this posting asks on ${d.label.toLowerCase()}: ${judgeable.map(label).join('; ')}`,
        reason: null, covered: 0, total: judgeable.length, matched_seqs,
        dimension_version: DIMENSION_VERSION,
      }
    }

    const best = evidenced.slice().sort((a, b) => (b.evidence!.ratio || 0) - (a.evidence!.ratio || 0) || a.seq - b.seq)[0]
    const fit = gradeFit(evidenced.length, judgeable.length)
    const profile = {
      value: best.evidence!.quote,
      source_label: best.evidence!.source_label,
      source: 'evidence' as const,
    }
    const numeric_verdict: NumericVerdict = uncomparableFact ? 'unavailable' : null
    const uncomparableTail = uncomparableFact
      ? `; your recorded ${factLabel(uncomparableKey!).toLowerCase()} ("${uncomparableFact.value}") was NOT compared to the posting's figure — this system has no arithmetic for ${factUnit(uncomparableKey!)}`
      : ''

    // Mandatory for moderate and weak, and it names the SPECIFIC shortfall in terms of both sides.
    const note = fit === 'strong' && !uncomparableTail
      ? null
      : `${evidenced.length} of ${judgeable.length} line(s) this posting asks on ${d.label.toLowerCase()} are evidenced by your profile`
        + (unevidenced.length ? `; no excerpt for: ${unevidenced.map(label).join('; ')}` : '')
        + uncomparableTail

    return {
      key: d.key, label: d.label, fit, basis: 'evidence', numeric_verdict,
      shortfall: fit === 'weak' ? 'falls_short' : null,
      posting, profile, note, reason: null,
      covered: evidenced.length, total: judgeable.length, matched_seqs,
      dimension_version: DIMENSION_VERSION,
    }
  })
}

/**
 * The posting cell: the employer's own words where they were located, the model's paraphrase where
 * they were not — and the row says WHICH. `requirements.ts:52-53` is explicit that `item_text` is
 * "Never presented as a quote", so `quoted` travels with the text rather than being inferred later.
 * A located line always wins, so the strongest available attribution is the one shown.
 */
function postingSide(rows: ComparisonRequirement[]): { seq: number; text: string; quoted: boolean } | null {
  if (!rows.length) return null
  const located = rows.find(r => typeof r.verbatim === 'string' && r.verbatim.length > 0)
  const r = located || rows[0]
  return { seq: r.seq, text: textOf(r), quoted: !!(located && r.verbatim) }
}

/**
 * Everything the comparison surface prints, in ONE object, so a card and a table row cannot be
 * computed from two different filters (R4).
 *
 * `graded` is the population any ratio is over; `not_applicable` rows are counted BY NAME rather
 * than absorbed, the shape `checks.ts:526-531` uses for the rows it excludes.
 */
export interface ComparisonSummary {
  graded: number
  strong: number
  moderate: number
  weak: number
  notApplicable: number
  /** Named, never a bare count — "3 not compared" with no names is a job nobody can act on. */
  notApplicableLabels: string[]
  /** Null unless every configured dimension was graded. A partial composite is worse than none. */
  ratio: number | null
}

export function summarize(rows: DimensionRow[]): ComparisonSummary {
  const r = Array.isArray(rows) ? rows : []
  const na = r.filter(x => x.fit === 'not_applicable')
  const graded = r.filter(x => x.fit !== 'not_applicable')
  const strong = graded.filter(x => x.fit === 'strong').length
  return {
    graded: graded.length,
    strong,
    moderate: graded.filter(x => x.fit === 'moderate').length,
    weak: graded.filter(x => x.fit === 'weak').length,
    notApplicable: na.length,
    notApplicableLabels: na.map(x => x.label),
    // NEVER a composite over a population with holes in it. If any dimension went ungraded the
    // ratio has no denominator anybody agreed to, and the number a reviewer trusts most is the one
    // most likely to be wrong.
    ratio: na.length || !graded.length ? null : Math.round((strong / graded.length) * 1000) / 1000,
  }
}

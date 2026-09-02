// P2.3 — the decomposed per-artifact score.
//
// RECONCILED AGAINST THE FOUR SCORES THAT ALREADY EXIST (the plan forbids shipping a fifth without
// this). None of them is per-artifact, so this is a new GRAIN rather than a duplicate:
//
//   opportunity.match_score  — model-generated fit for the ROLE. NOT posting-grounded: appApply
//                              builds its prompt from role/company/why_surfaced/signals/pains plus a
//                              MasterContext summary, and never reads jd_html. Then MUTATED in place
//                              by the role-taxonomy boost.
//   opportunity.base_score   — the same number captured once BEFORE that boost.
//   opportunity.ats_score    — posting-grounded, from atsScoreOne against the real posting text.
//   packet.ats_score         — packet-level, from jdAnalysis.
//
// So `match` answers "is this role worth pursuing", `ats_score` answers "does the candidate match
// the posting", and THIS table answers "does this document cover this posting's requirements". Three
// different questions; the UI must never present them as versions of one number.
//
// The name is `artifact_score`, NOT `match_score` — that column already exists with a different live
// meaning, and reusing the name is how two numbers come to disagree while looking like one.
import { CheckResult } from './checks'

export const ENGINE_VERSION = 1

/** The weights the backlog specifies. Seeded defaults — overridable, never a permanent constant. */
export const DEFAULT_WEIGHTS = { mustHave: 0.5, keyword: 0.3, seniority: 0.2 }

export type Band = 'strong' | 'acceptable' | 'needs_work'
export const DEFAULT_BANDS = { strong: 85, acceptable: 70 }

export interface ScoreComponent {
  value: number | null        // 0-100, or null when nothing can honestly produce it
  source: string              // what produced it, or why it could not be produced
}

export interface ArtifactScore {
  must_have_coverage: ScoreComponent
  keyword_coverage: ScoreComponent
  seniority_alignment: ScoreComponent
  composite: number | null
  band: Band | null
  uncovered_requirement_seqs: number[]
  engine_version: number
  weights: typeof DEFAULT_WEIGHTS
}

export interface ScoreInput {
  requirements?: Array<{ seq: number; kind: string }>
  /** The deterministic check results for this artifact — must_have_coverage is measured there. */
  checks?: CheckResult[]
  /**
   * Published term-library coverage, when a library version exists.
   * `covered: null` means "a library exists but nothing has counted placement yet" — a THIRD state,
   * distinct from both "no library" and "measured zero". See computeArtifactScore.
   */
  /**
   * `source` is OPTIONAL AND LOAD-BEARING WHEN PRESENT. Without it the two sentences below
   * hardcode "scoreable library terms", which was true while the published term library was
   * the only possible source and became a LIE the moment an interim source existed: an ATS
   * keyword count would have been reported to the owner as library coverage, so a jump in the
   * number the day a library is published would be unattributable. A caller supplying a
   * differently-sourced numerator MUST name it.
   */
  keyword?: { covered: number | null; scoreable: number; source?: string } | null
  /** Reviewer-graded, so it is a stored INPUT and never recomputed here (P4 supplies it). */
  seniority?: number | null
  weights?: Partial<typeof DEFAULT_WEIGHTS>
  bands?: Partial<typeof DEFAULT_BANDS>
}

export function bandFor(composite: number | null, bands = DEFAULT_BANDS): Band | null {
  if (composite === null) return null
  if (composite >= bands.strong) return 'strong'
  if (composite >= bands.acceptable) return 'acceptable'
  return 'needs_work'
}

/**
 * Compute the decomposed score.
 *
 * A component with no honest source is `null`, and **the composite is null unless ALL THREE are
 * present**. A composite computed from one of three components, or from a zero standing in for
 * "unknown", is a fabricated number wearing a score's clothes — and it is precisely the number a
 * reviewer would trust most. Today that means:
 *   - must_have_coverage  measured, from requirement rows via the deterministic check
 *   - keyword_coverage    null — the term library has ZERO published entries (measured live)
 *   - seniority_alignment null — reviewer-graded, and the reviewer does not exist until P4
 * so the composite is null and the UI must show three components and no headline number, rather
 * than a confident 100 that means "we checked one third of one thing".
 *
 * Reproducible: same inputs and same engine_version give the same number, with no model call.
 */
export function computeArtifactScore(input: ScoreInput): ArtifactScore {
  const weights = { ...DEFAULT_WEIGHTS, ...(input.weights || {}) }
  const bands = { ...DEFAULT_BANDS, ...(input.bands || {}) }
  const checks = input.checks || []

  // --- must-have coverage: read from the CHECK, not recomputed --------------------------------
  // Recomputing it here would create a second implementation of the same rule, and the day the two
  // drift is the day the gate and the score disagree about the same artifact.
  // ENGINE-FILTERED on purpose (P4.2). `check_key` is not unique across engines by accident — it is
  // kept unique by convention (reviewer keys are `reviewer_*`), and a convention is not a guarantee.
  // Without this filter a reviewer row keyed `must_have_coverage` would feed a model's opinion into
  // a number the gate and the UI both present as measured.
  const mh = checks.find(c => c.check_key === 'must_have_coverage' && c.engine === 'deterministic')
  let mustHave: ScoreComponent
  const uncovered: number[] = []

  if (!mh || mh.state === 'not_applicable') {
    mustHave = { value: null, source: mh ? `not applicable: ${mh.observed}` : 'no must_have_coverage check was run' }
  } else {
    // The check's offenders name the uncovered requirements as "#<seq> <text>".
    for (const o of mh.offenders) {
      const m = /^#(\d+)\b/.exec(o)
      if (m) uncovered.push(Number(m[1]))
    }
    // BOTH numbers come from the check. The denominator used to be recomputed here as "every row of
    // kind must_have", which is a DIFFERENT population from the one the check judged: the check
    // deliberately excludes the requirements `template_reach` reports as unreachable and the ones the
    // owner's facts already settled. Recomputing it counted every excluded row as covered — 3/4 on a
    // posting where exactly one requirement was judged and it FAILED. That is a not_applicable row
    // laundered into the numerator, which is the same defect as a check passing on absent evidence,
    // and it inflated the one number a reviewer trusts most. The check's `observed` leads with
    // "<covered>/<judged>" for exactly this reason; a form this cannot read produces null, not a
    // guess.
    const m = /^(\d+)\/(\d+)\b/.exec(String(mh.observed || ''))
    const judged = m ? Number(m[2]) : null
    const covered = m ? Number(m[1]) : null
    mustHave = (judged === null || covered === null)
      ? { value: null, source: `must_have_coverage reported "${mh.observed}", which does not state how many requirements it judged` }
      : {
        value: judged ? Math.round((covered / judged) * 100) : null,
        source: judged ? mustHaveSource(covered, judged) : 'the posting produced no must-haves',
      }
  }

  // --- keyword coverage: a PUBLISHED library AND a measured placement count --------------------
  // THREE states, not two. A library version can exist while nothing has yet counted how many of
  // its terms the artifact actually places, and that middle state is NOT zero coverage — it is
  // unmeasured. Collapsing it to 0 is the fabricated-composite failure this file exists to refuse:
  // `round(0 / N * 100)` renders as a confident, measured-looking 0%, and a component with no
  // source is precisely the number a reviewer trusts most. `covered: null` is how a caller says
  // "a library exists, placement is not counted yet" without inventing a numerator.
  const kwIn = input.keyword
  const keyword: ScoreComponent =
    !kwIn || kwIn.scoreable <= 0
      ? { value: null, source: 'no published term-library version has scoreable entries yet' }
      : (kwIn.covered === null || kwIn.covered === undefined)
        ? { value: null, source: `${kwIn.scoreable} scoreable library terms, but term placement has not been measured` }
        : { value: Math.round((kwIn.covered / kwIn.scoreable) * 100), source: kwIn.source || `${kwIn.covered}/${kwIn.scoreable} scoreable library terms present` }

  // --- seniority: a stored reviewer input, never computed here ---------------------------------
  const seniority: ScoreComponent = (typeof input.seniority === 'number')
    ? { value: Math.max(0, Math.min(100, Math.round(input.seniority))), source: 'reviewer-graded (stored input)' }
    : { value: null, source: 'not graded — the independent reviewer (P4) has not run' }

  const all = [mustHave.value, keyword.value, seniority.value]
  const composite = all.every(v => v !== null)
    ? Math.round(mustHave.value! * weights.mustHave + keyword.value! * weights.keyword + seniority.value! * weights.seniority)
    : null

  return {
    must_have_coverage: mustHave,
    keyword_coverage: keyword,
    seniority_alignment: seniority,
    composite,
    band: bandFor(composite, bands),
    uncovered_requirement_seqs: uncovered.sort((a, b) => a - b),
    engine_version: ENGINE_VERSION,
    weights,
  }
}

// ---------------------------------------------------------------------------------------------
// WHICH ROWS THE ENGINE JUDGED — written once, read once, never re-derived.
//
// D16. `appReviewer` compares the reviewer's per-requirement judgements against the deterministic
// engine's, and it needs the set of requirements the engine actually reached a coverage verdict on.
// It used every row of `kind === 'must_have'`, but `checks.ts` judges only `coverable` — must-haves
// minus the eligibility clauses `template_reach` reports as unreachable, minus the rows the owner's
// facts own. So requirements the engine never had an opinion about were counted as AGREED or
// DISAGREED with the reviewer. Reviewer agreement is an accusation-grade number; a row nobody
// judged belongs in `not_comparable`, which is the same rule as absent evidence being
// `not_applicable` rather than `pass`.
//
// The fix does NOT recompute `coverable` here. That predicate belongs to `checks.ts` and a second
// implementation of it is the R4 defect this codebase has been bitten by repeatedly — one source
// per number. Instead it reads what the check already PUBLISHED about the population it judged:
//   * `artifact_score.must_have_source` states the denominator, "<covered>/<judged> ...";
//   * `artifact_score.uncovered_requirement_ids` names the judged rows that failed.
//
// That yields two sound cases and no guess in between:
//   * judged === the number of must-have rows  -> `coverable` WAS every must-have, exactly.
//   * judged  <  the number of must-have rows  -> the engine excluded some rows and the score row
//     does not say which. The uncovered ids are still known to have been judged; the covered ones
//     are not identifiable, so they stay `not_comparable`. That UNDERSTATES agreement rather than
//     inventing it, which is the direction every other check in this codebase errs in.
//
// The honest, complete fix is for the writer to record the judged ids alongside the uncovered ones
// (`artifact_score` needs the column and `appChecks.evaluateArtifact` needs to fill it). This
// function is written so that lands as a one-line addition: pass the recorded ids and they win.

/** The one place the `must_have_source` string is BUILT. `parseMustHaveSource` is its inverse. */
export function mustHaveSource(covered: number, judged: number): string {
  return `${covered}/${judged} must-have requirements evidenced`
}

/**
 * Read `<covered>/<judged>` back out of a stored `must_have_source`.
 *
 * Paired with `mustHaveSource` in this file so the writer and the reader cannot drift apart — a
 * hardening case asserts the round trip. Anything it cannot read returns null, never a default:
 * a fabricated denominator is worse than an absent one.
 */
export function parseMustHaveSource(source: string | null | undefined): { covered: number; judged: number } | null {
  const m = /^(\d+)\/(\d+)\b/.exec(String(source || ''))
  if (!m) return null
  return { covered: Number(m[1]), judged: Number(m[2]) }
}

export interface JudgedScoreRow {
  must_have_coverage: number | null
  must_have_source: string | null
  uncovered_requirement_ids?: unknown
  /** Recorded judged ids, when the writer stores them. Preferred over every inference below. */
  judged_requirement_ids?: unknown
}

/**
 * The requirement ids the deterministic coverage check is KNOWN to have judged.
 *
 * Never a superset of the truth. A caller may treat everything outside the returned set as
 * `not_comparable`; it may not treat membership as a guess.
 */
export function judgedMustHaveIds(
  requirements: Array<{ id: unknown; kind: string }>,
  score: JudgedScoreRow | null | undefined,
): string[] {
  // No coverage verdict at all (not_applicable, or no row) means nothing was judged.
  if (!score || score.must_have_coverage === null || score.must_have_coverage === undefined) return []

  const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
  const recorded = asIds(score.judged_requirement_ids)
  if (recorded.length) return recorded

  const mustHaves = requirements.filter(r => r.kind === 'must_have').map(r => String(r.id))
  const parsed = parseMustHaveSource(score.must_have_source)
  if (parsed && parsed.judged === mustHaves.length) return mustHaves

  const uncovered = new Set(asIds(score.uncovered_requirement_ids))
  return mustHaves.filter(id => uncovered.has(id))
}

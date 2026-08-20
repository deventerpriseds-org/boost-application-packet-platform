// P2.3 — the decomposed per-artifact score.
//
// RECONCILED AGAINST THE FOUR SCORES THAT ALREADY EXIST (the plan forbids shipping a fifth without
// this). None of them is per-artifact, so this is a new GRAIN rather than a duplicate:
//
//   opportunity.match_score  — model-generated fit for the ROLE. NOT posting-grounded: appApply
//                              builds its prompt from role/company/why_surfaced/signals/pains plus a
//                              MasterContext summary, and never reads jd_real. Then MUTATED in place
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
  /** Published term-library coverage, when a library version exists. */
  keyword?: { covered: number; scoreable: number } | null
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
  const reqs = input.requirements || []
  const checks = input.checks || []

  // --- must-have coverage: read from the CHECK, not recomputed --------------------------------
  // Recomputing it here would create a second implementation of the same rule, and the day the two
  // drift is the day the gate and the score disagree about the same artifact.
  const mh = checks.find(c => c.check_key === 'must_have_coverage')
  const mustHaveTotal = reqs.filter(r => r.kind === 'must_have').length
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
    const covered = Math.max(0, mustHaveTotal - uncovered.length)
    mustHave = {
      value: mustHaveTotal ? Math.round((covered / mustHaveTotal) * 100) : null,
      source: mustHaveTotal ? `${covered}/${mustHaveTotal} must-have requirements covered` : 'the posting produced no must-haves',
    }
  }

  // --- keyword coverage: only from a PUBLISHED term library ------------------------------------
  const kwIn = input.keyword
  const keyword: ScoreComponent = (kwIn && kwIn.scoreable > 0)
    ? { value: Math.round((kwIn.covered / kwIn.scoreable) * 100), source: `${kwIn.covered}/${kwIn.scoreable} scoreable library terms present` }
    : { value: null, source: 'no published term-library version has scoreable entries yet' }

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

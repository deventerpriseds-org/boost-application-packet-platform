// Pure logic for the per-asset gate drawer (the component lives in screens/AssetGateDrawer.jsx).
//
// It sits in a plain .js module for the same ONE reason overlay.js does: Node's built-in test runner
// can import it with no DOM and no new dependency, so the rules below can be PROVEN rather than
// eyeballed. Nothing here touches window/document — anything that does stays in the component.
//
// The rules being proven are the two the whole feature exists to keep:
//   1. the badge count, the gate word and the footer action all read ONE server payload;
//   2. `not_applicable` is never folded into a pass, and a composite is never fabricated.

// Asset labels. The same map is currently inlined in Library.jsx, OppDetail.jsx and
// PacketBuilder.jsx; it lives here so those three can converge on one copy rather than a fourth
// being added. An unknown type falls through to the raw type - never to a blank.
export const ASSET_LABEL = { resume: 'Resume', compact_resume: 'Compact resume', cover: 'Cover letter', portfolio: 'Portfolio', video: 'Intro video' }
export const assetLabel = (t) => ASSET_LABEL[t] || String(t || 'Asset').replace(/_/g, ' ')
export const STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' }

// Plain-language gate words (SPEC 7 bans the engine's own vocabulary as a user-facing label).
// null is its own state: an artifact with no gate row has never been checked, and that is the
// ABSENCE of a verdict rather than permission - the server blocks approval on it, so we say so.
export const GATE_META = {
  pass: { tone: 'green', word: 'Clear', blurb: 'nothing needs attention' },
  warn: { tone: 'yellow', word: 'Needs a decision', blurb: 'findings you can accept, with a reason' },
  fail: { tone: 'red', word: 'Blocked', blurb: 'findings that must be fixed' },
}
export const gateMeta = (gate) => GATE_META[gate] || { tone: 'panel', word: 'Not checked', blurb: 'the checks have not been run' }

// Check states. not_applicable is NOT a pass and never shares a colour with one: a check that had
// no evidence to test against is the exact state a green gate would launder into confidence.
export const STATE_META = {
  pass: { tone: 'green', label: 'Clear' },
  warn: { tone: 'yellow', label: 'Needs a look' },
  fail: { tone: 'red', label: 'Must fix' },
  not_applicable: { tone: 'panel', label: 'Not checked - no evidence' },
}
export const stateMeta = (s) => STATE_META[s] || { tone: 'panel', label: String(s || 'unknown') }

// check_key -> plain language. An unmapped key degrades to the key with its underscores opened out,
// so a check added server-side shows up honestly instead of vanishing from the list.
export const CHECK_LABEL = {
  skill_char_limit: 'Skill lines fit the template',
  skill_list_count: 'Skill count and split',
  relevant_char_limit: 'Relevant-experience lines fit',
  expertise_phrase_length: 'Expertise phrases are the right length',
  word_counts: 'Section word counts',
  empty_merge_fields: 'No empty blocks',
  whitespace: 'No stray spacing',
  markup_residue: 'No leftover markup',
  ai_tells: 'No machine-sounding phrases',
  cross_list_redundancy: 'Nothing repeated across lists',
  company_named: 'The company is named',
  company_in_body: 'The right company in the body',
  must_have_coverage: 'Must-haves this document covers',
  responsibilities_addressed: 'Responsibilities addressed',
  changes_cited: 'Every change cites the posting',
  omission_list: 'Nothing you asked to omit appears',
  template_reach: 'Requirements no block can carry',
  facts_settled: 'Facts you confirmed are used',
  facts_needed: 'Facts still needed',
  fact_shortfall: 'A confirmed fact falls short',
}
export const checkLabel = (k) => CHECK_LABEL[k] || String(k || '').replace(/_/g, ' ')

// Merge field -> plain language, for the Blocks tab. Same degrade-to-the-key rule.
export const FIELD_LABEL = {
  ResumeSummary: 'Summary',
  SkillsBullets1: 'Skills, column 1',
  SkillsBullets2: 'Skills, column 2',
  ExpertiseBullets: 'Areas of expertise',
  RelevantBullets1: 'Relevant experience, role 1',
  RelevantBullets2: 'Relevant experience, role 2',
  RelevantBullets3: 'Relevant experience, role 3',
}
export const fieldLabel = (f) => FIELD_LABEL[f] || String(f || '')

// insertion.method, in the words a reader can act on. `manual` is listed because the column allows
// it; nothing in this pipeline writes it, and it is never inferred.
export const METHOD_LABEL = {
  template_fill: 'filled straight from the package',
  model_rewrite: 'rewritten by a later pass',
  manual: 'edited by hand',
}

/**
 * What the footer may offer, derived from the SERVER's gate and nothing else.
 *
 * It never inspects the check rows to form its own opinion: `gate` is the decision and `attention`
 * is the count the server made that decision with. The wording of the refusals deliberately mirrors
 * `approvalBlock()` in api/src/functions/tests/appChecks.ts, so a disabled button and the server's
 * own 409 body say the same thing rather than two different things about one rule.
 */
export function footerFor(result) {
  if (!result) return { kind: 'loading', label: 'Approve', disabled: true, headline: 'Loading the gate', reason: 'the server has not answered yet' }
  const gate = result.gate == null ? null : result.gate
  const n = Number(result.attention || 0)
  if (gate === null) {
    return { kind: 'unchecked', label: 'Approve', disabled: true, headline: 'Not checked',
      reason: 'no checks have been run for this artifact - run them before approving' }
  }
  if (gate === 'fail') {
    return { kind: 'fail', label: 'Approve', disabled: true, headline: 'Blocked',
      reason: n + ' blocking finding(s); a fail cannot be overridden' }
  }
  if (gate === 'warn') {
    return result.override
      ? { kind: 'warn_overridden', label: 'Approve with exceptions', disabled: false, headline: 'Exception already recorded',
          reason: result.override.by + ' accepted these findings: ' + result.override.reason }
      : { kind: 'warn', label: 'Approve with exceptions', disabled: false, needsReason: true, headline: 'Needs a decision',
          reason: n + ' finding(s) need an explicit override with a reason' }
  }
  return { kind: 'pass', label: 'Approve', disabled: false, headline: 'Clear', reason: 'every check that could run is clear' }
}

/**
 * Does the server's own payload contradict itself?
 *
 * The badge/gate split is closed by construction here (one payload feeds both), so this can never
 * fire because of a UI bug - it fires when `gate`, `attention` and `results` genuinely disagree,
 * which is the defect P8.5 exists to prevent and the one the reference prototype ships with
 * (`qc/data.js:641` counts a WIDER set than `:548` gates on, so it renders a green gate beside
 * "1 to fix"). Reporting the disagreement beats quietly rendering one of the two numbers and letting
 * the reader believe it.
 */
export function reconcile(result) {
  if (!result || result.gate == null) return null
  const rows = Array.isArray(result.results) ? result.results : []
  const listed = rows.filter((r) => r.state === 'fail' || r.state === 'warn').length
  const out = []
  if (listed !== Number(result.attention || 0)) {
    out.push('the server counted ' + result.attention + ' finding(s) needing attention but sent ' + listed + ' such row(s)')
  }
  if (result.gate === 'pass' && Number(result.attention || 0) > 0) {
    out.push('the gate reads pass while ' + result.attention + ' finding(s) still need attention')
  }
  const reviewerFail = rows.some((r) => r.engine === 'reviewer' && r.state === 'fail')
  const deterministicFail = rows.some((r) => r.engine === 'deterministic' && r.state === 'fail')
  if (result.gate === 'fail' && reviewerFail && !deterministicFail) {
    out.push('the only failing rows come from the independent reviewer, which may never block an asset on its own')
  }
  return out.length ? out : null
}

/** How many of the badge's `attention` findings came from the reviewer rather than the rules. */
export function reviewerAttention(result) {
  const rows = Array.isArray(result && result.results) ? result.results : []
  return rows.filter((r) => r.engine === 'reviewer' && (r.state === 'fail' || r.state === 'warn')).length
}

/**
 * The three score parts, each carrying the server's prose for why it has no value.
 *
 * A missing component must say WHY - never 0, never blank. `artifact_score` stores each value beside
 * its own `_source` column for exactly this, and the composite is null unless all three exist.
 */
export function scoreParts(score) {
  if (!score) return []
  return [
    { key: 'must', label: 'Must-haves covered', value: score.must_have_coverage, source: score.must_have_source },
    { key: 'kw', label: 'Keywords present', value: score.keyword_coverage, source: score.keyword_source },
    { key: 'sen', label: 'Seniority fit', value: score.seniority_alignment, source: score.seniority_source },
  ]
}

export const fmtWhen = (v) => { if (!v) return 'never'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString() }
export const arr = (v) => (Array.isArray(v) ? v : [])
export const errText = (e) => String((e && e.message) || e)

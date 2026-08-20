// Pure logic behind the posting-analysis surfaces (the card on the JD step, and the keyword tally
// modal). No React import, no window/document — Node's built-in test runner imports this directly,
// which is the only way the rules below can be asserted rather than described.
// Tests: app/test/postingAnalysis.test.mjs.
//
// THE RULES THIS MODULE EXISTS TO ENFORCE
//   1. "ATS" belongs to the keyword TERM LIBRARY and its COVERAGE. Requirements, responsibilities,
//      model-inferred keywords and the model match estimate are never called ATS.
//   2. A count that blends "the posting said so" with "the parser defaulted it" disguises a guess
//      as a fact. requirements.ts keeps `kind_source` precisely so that never happens; the NUMBER
//      on screen has to carry the split, not only the prose beneath it.
//   3. Absent evidence is unknown, never a pass. "No published library version" and "we never
//      looked" are different states and must print differently.
//   4. Model output is never presented under a heading that claims the employer wrote it.

/**
 * Every `data-qc` selector the posting-analysis surfaces render.
 *
 * Same constant, same rule, same reason as QC_HOOKS (qcRail.js), GATE_HOOKS (assetGate.js),
 * BLOCK_HOOKS (assetBlocks.js) and PACKET_HOOKS (packetBuilder.js). This screen was the one that
 * ALREADY had hooks - 28 of them - and so was left hand-typing every one while the screens that had
 * none were given constants. That gap is not cosmetic: the cross-screen collision test unions the
 * hook CONSTANTS, so 28 of the app's selectors were the only ones never checked for collisions, and
 * P8.7 hand-typed a 29th (`keyword-columns`) rather than closing it.
 */
export const POSTING_HOOKS = {
  card: 'posting-analysis',
  stale: 'posting-stale',
  tab: 'jd-tab',
  panel: 'jd-tabpanel',
  legend: 'req-legend',
  group: 'req-group',
  groupCount: 'group-count',
  kindSourceSplit: 'kind-source-split',
  row: 'req-row',
  quote: 'req-quote',
  paraphrase: 'req-paraphrase',
  kindSource: 'kind-source',
  keywords: 'ats-keywords',
  libraryState: 'keyword-library-state',
  modelKeywords: 'model-keywords',
  keywordColumns: 'keyword-columns',   // carries data-qc-cols - P8.7's breakpoint, selectable
  keywordGroup: 'keyword-group',
  tally: 'keyword-tally',
  matchEstimate: 'match-estimate',
  matchEstimateButton: 'match-estimate-button',
  analysisRunning: 'analysis-running',
  analysisResult: 'analysis-result',
  // P8.4 - the posting-vs-profile comparison (SPEC 4.2). Declared here rather than hand-typed in
  // the component so the two existing guards can see them: postingAnalysis.test.mjs asserts every
  // hook is rendered and none is hand-typed, and assetGate.test.mjs unions the HOOKS constants to
  // catch a value colliding with another screen's. A hook outside a constant is invisible to both.
  compare: 'posting-compare',
  compareRow: 'compare-row',            // carries data-qc-dimension and data-qc-fit
  compareFit: 'compare-fit',
  compareNote: 'compare-note',
  compareScope: 'compare-scope',
  compareEmpty: 'compare-empty',
  compareSetSource: 'compare-set-source',
  compareCols: 'compare-cols',          // carries data-qc-cols - the responsive rule, selectable
  compareSummary: 'compare-summary',
}

// -- the comparison's grade vocabulary (P8.4) ---------------------------------------------------
// `weak` deliberately renders as TWO different labels. The prototype maps it to a single
// 'No evidence' (docs/qc-evidence/qc/data.js:583) and its one weak fixture happens to be a true
// absence, so the fixture cannot expose the case where the profile DOES speak to the axis and falls
// short - where "No evidence" is a false statement about the candidate.
export const FIT_LABEL = {
  strong: 'Strong match',
  moderate: 'Moderate match',
  weak_nothing_found: 'Nothing found',
  weak_falls_short: 'Falls short',
  not_applicable: 'Not compared',
}

export function fitLabel(fit, shortfall) {
  if (fit !== 'weak') return FIT_LABEL[fit] || 'Not compared'
  return shortfall === 'nothing_found' ? FIT_LABEL.weak_nothing_found : FIT_LABEL.weak_falls_short
}

/** Semantic colour per grade. `not_applicable` is NEUTRAL - it is an absence, not a bad result. */
export const FIT_COLOR = {
  strong: 'var(--proto-green)',
  moderate: 'var(--proto-yellow)',
  weak: 'var(--proto-red)',
  not_applicable: 'var(--proto-ink3)',
}

/**
 * What the comparison surface says about itself, derived from the payload rather than hardcoded.
 *
 * Four states, and they are four different sentences. "Nothing has been resolved yet" and "the
 * comparison ran and found nothing to compare" are not the same claim, and printing one for both is
 * how absent evidence gets read as a measurement.
 */
export function comparisonState(comparison) {
  if (!comparison) return { state: 'loading', headline: 'Loading the comparison...', detail: '' }
  const rows = Array.isArray(comparison.dimensions) ? comparison.dimensions : []
  if (!comparison.resolved || !rows.length) {
    return {
      state: 'unresolved', rows: [],
      headline: 'This posting has not been compared to your profile yet.',
      detail: 'Nothing has been measured - which is not the same as nothing matching. Run the evidence resolve for this opportunity to build the comparison.',
    }
  }
  const graded = rows.filter((r) => r && r.fit !== 'not_applicable')
  if (!graded.length) {
    return {
      state: 'none_graded', rows,
      headline: 'None of these dimensions could be compared for this posting.',
      detail: 'Every row below says which state it is in. An ungraded row is a measurement nobody made, not a shortfall.',
    }
  }
  return {
    state: 'graded', rows,
    headline: `${graded.length} of ${rows.length} dimension(s) compared`,
    detail: 'Each row shows what this posting asks and what your stored profile evidences.',
  }
}

/**
 * The comparison table's responsive rule.
 *
 * The number lives HERE, not in a CSS media query, for the reason `keywordColumns` already records:
 * ui-verify.yml can set a viewport width but can only SELECT, never read a computed style, so a
 * media query is invisible to it. The column count is rendered as `data-qc-cols` and is therefore
 * provable. SPEC 4.2's own prototype uses the same width via useWide(); this is that number, made assertable.
 */
export const COMPARE_WIDE_MIN = 900

/** 4 columns at or above the breakpoint, 1 below. Never 0, never NaN. */
export function compareColumns(width) {
  const w = Number(width)
  return Number.isFinite(w) && w >= COMPARE_WIDE_MIN ? 4 : 1
}

export function compareGridTemplate(width) {
  return compareColumns(width) === 4
    ? '150px minmax(0, 1fr) minmax(0, 1fr) 130px'
    : 'minmax(0, 1fr)'
}

/**
 * The four column headings, verbatim from SPEC.md:140-141.
 * Exported so a test can assert the rendered headings ARE the spec's, rather than something that
 * merely reads like them.
 */
export const COMPARE_COLUMNS = ['Dimension', 'The posting asks for', 'Your profile evidences', 'Fit']

/**
 * The scoping sentence SPEC.md:145-146 requires. Without it a strong grade reads as a claim about
 * the finished packet, and at this step nothing has been written into an asset at all.
 */
export const COMPARE_SCOPE_NOTE =
  'Fit is graded against your stored profile only - nothing here has been written into an asset yet.'

// ── requirement rows ────────────────────────────────────────────────────────────────────────────

export const KIND_ABBR = { must_have: 'MH', nice_to_have: 'NTH', responsibility: 'RESP' }

// requirement.kind_source records WHY a line was filed where it was.
export const KIND_SOURCE_NOTE = {
  posting_required_marker: 'the posting marks this required',
  posting_optional_marker: 'the posting marks this preferred',
  posting_section_heading: 'it sits under a "preferred" heading in the posting',
  category: 'from the section the posting listed it under',
  category_default: 'defaulted - the posting did not say required or preferred',
  fallback: 'the parser could not classify this line',
}
export const KIND_SOURCE_NOTE_DEFAULT = 'the parser defaulted it'

export function kindSourceNote(kindSource) {
  return KIND_SOURCE_NOTE[kindSource] || KIND_SOURCE_NOTE_DEFAULT
}

// A row with one of these match_methods has NO employer quote. What we hold is the model's
// paraphrase, and it is labelled as such rather than dressed up as something the employer wrote.
export const NO_QUOTE_REASON = {
  unlocatable: 'this wording could not be located in the posting text',
  beyond_model_window: 'the posting is longer than the parser ever read',
  no_posting: 'no posting text is stored for this opportunity',
}
export const NO_QUOTE_REASON_DEFAULT = 'the posting span for this line is unknown'

export function noQuoteReason(matchMethod) {
  return NO_QUOTE_REASON[matchMethod] || NO_QUOTE_REASON_DEFAULT
}

/** A row is QUOTED only when the resolver actually located the employer's own words. */
export function isQuoted(row) {
  return !!(row && typeof row.verbatim === 'string' && row.verbatim.length > 0)
}

export function modelKeywords(rows) {
  return Array.from(new Set((Array.isArray(rows) ? rows : []).map((r) => r && r.model_keyword).filter(Boolean)))
}

export function groupRequirements(rows) {
  const all = Array.isArray(rows) ? rows : []
  const responsibilities = all.filter((r) => r && r.kind === 'responsibility')
  const mustHaves = all.filter((r) => r && r.kind === 'must_have')
  const niceToHaves = all.filter((r) => r && r.kind === 'nice_to_have')
  return {
    all,
    responsibilities,
    mustHaves,
    niceToHaves,
    requirements: [...mustHaves, ...niceToHaves],
    modelKeywords: modelKeywords(all),
  }
}

// ── the kind_source split (AC7) ─────────────────────────────────────────────────────────────────
// Order is the reading order on screen: what the posting itself asserted first, what the parser
// supplied last, so "3 (1 marked required - 2 defaulted)" never reads as three marked requirements.
export const KIND_SOURCE_SHORT = {
  posting_required_marker: 'marked required',
  posting_optional_marker: 'marked preferred',
  posting_section_heading: 'under a preferred heading',
  category: 'from a posting section',
  category_default: 'defaulted',
  fallback: 'unclassified',
}
export const UNKNOWN_KIND_SOURCE = 'unknown'
export const KIND_SOURCE_SHORT_DEFAULT = 'source unrecorded'

const KIND_SOURCE_ORDER = Object.keys(KIND_SOURCE_SHORT)

/** True only when the POSTING supplied the evidence for the filing. A default is not evidence. */
const EVIDENCED_KIND_SOURCES = new Set([
  'posting_required_marker', 'posting_optional_marker', 'posting_section_heading', 'category',
])
export function isEvidencedKindSource(kindSource) {
  return EVIDENCED_KIND_SOURCES.has(kindSource)
}

/**
 * Split a group's count by where each row's kind came from.
 * `total` is still the row count, but it never travels without `breakdown`/`text`.
 */
export function summarizeKindSource(rows) {
  const all = Array.isArray(rows) ? rows : []
  const counts = new Map()
  for (const r of all) {
    const raw = r && typeof r.kind_source === 'string' ? r.kind_source.trim() : ''
    const key = raw || UNKNOWN_KIND_SOURCE
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const rank = (k) => {
    const i = KIND_SOURCE_ORDER.indexOf(k)
    return i === -1 ? KIND_SOURCE_ORDER.length : i
  }
  const breakdown = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count, label: KIND_SOURCE_SHORT[key] || KIND_SOURCE_SHORT_DEFAULT }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))
  const evidenced = breakdown.filter((b) => isEvidencedKindSource(b.key)).reduce((n, b) => n + b.count, 0)
  return {
    total: all.length,
    evidenced,
    defaulted: all.length - evidenced,
    breakdown,
    // Rendered beside the count. Empty only when there is nothing to count.
    text: breakdown.map((b) => `${b.count} ${b.label}`).join(' · '),
    // A single-source group needs no split; a blended one always does.
    blended: breakdown.length > 1,
  }
}

// ── the keyword term library (the latent lie: this used to be hardcoded) ────────────────────────
// Derived from the checks engine's artifact_score row, never asserted. `keyword_coverage` is an int
// or null; the row itself is null when no checks run has been read at all. Those are three states.
export function keywordLibraryState(score) {
  if (!score) {
    return {
      state: 'unknown',
      coverage: null,
      source: null,
      headline: 'Keyword coverage has not been read for this packet.',
      detail: 'No checks run has been loaded, so coverage is unknown - not zero. Absent evidence is not a pass.',
    }
  }
  const coverage = typeof score.keyword_coverage === 'number' ? score.keyword_coverage : null
  const source = score.keyword_source || null
  if (coverage === null) {
    return {
      state: 'unpublished',
      coverage: null,
      source,
      headline: 'The ATS term library has no published version yet.',
      detail: 'Keyword coverage cannot be scored against it, so no coverage number is shown here - an invented one is worse than none.',
    }
  }
  return {
    state: 'published',
    coverage,
    source,
    headline: `ATS keyword coverage: ${coverage}%`,
    detail: 'Measured against the published term library, counting only scoreable entries.',
  }
}

// ── the keyword list's breakpoint (P8.7) ────────────────────────────────────────────────────────
// "the ATS list is 2-up >= 1040px and 1-up below". The number lives HERE, and the component reads
// its column count from keywordColumns() rather than from a CSS media query, for two reasons:
//   1. one source. A media query in theme.css plus a threshold in a module is two numbers that
//      have to agree, and nothing would notice the day they stopped.
//   2. it is assertable. The column count is rendered as `data-qc-cols`, so ui-verify.yml - which
//      can set a viewport width but can only SELECT, never read a computed style - can prove the
//      breakpoint with `[data-qc="keyword-columns"][data-qc-cols="2"]`. A media query is invisible
//      to it.
// The measured width is the VIEWPORT's, matching the sibling rule in the same backlog item ("the
// right column is the assistant, docked >= 1440px only"), which is a viewport rule too.
export const KEYWORD_2UP_MIN = 1040

/** 2 columns at or above the breakpoint, 1 below. An unusable width is 1 - never 0, never NaN. */
export function keywordColumns(width) {
  const w = Number(width)
  return Number.isFinite(w) && w >= KEYWORD_2UP_MIN ? 2 : 1
}

/** The grid track list for that count. Kept beside the rule so the two cannot describe different
 *  layouts, and `minmax(0, 1fr)` rather than `1fr` so a long unbroken term cannot widen a column
 *  past its share and push the card into a horizontal scroll. */
export function keywordGridTemplate(width) {
  return keywordColumns(width) === 2 ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)'
}

// ── the posting body on the JD step (AC31) ──────────────────────────────────────────────────────
// `jdSummary` is opportunity.jd_summary and `why` is opportunity.why_surfaced. BOTH are model
// output. Neither may appear under a heading that says it is the posting. The employer's own text
// is opportunity.jd_text, whose length arrives as `jdTextLen` from the requirements endpoint, and
// the only place it is ever shown verbatim is a located requirement row.
export function postingBody({ jdSummary, why, jdTextLen } = {}) {
  const summary = typeof jdSummary === 'string' ? jdSummary.trim() : ''
  const surfaced = typeof why === 'string' ? why.trim() : ''
  const len = typeof jdTextLen === 'number' ? jdTextLen : null
  const stored = len === null
    ? ''
    : len > 0
      ? ` The employer's own posting text (${len.toLocaleString()} characters) is stored; it is quoted only in the located lines below.`
      : ' No employer posting text is stored for this opportunity, so nothing below can quote it.'

  if (summary) {
    return {
      kind: 'summary',
      heading: 'Posting summary',
      badge: 'model-written',
      provenance: `A model wrote this summary from the posting. It is not the employer's wording.${stored}`,
      body: summary,
    }
  }
  if (surfaced) {
    return {
      kind: 'why',
      heading: 'Why this surfaced',
      badge: 'model-written',
      provenance: `A model wrote this when the opportunity was surfaced. It is not the posting, and no part of it is the employer's wording.${stored}`,
      body: surfaced,
    }
  }
  return {
    kind: 'none',
    heading: 'Posting',
    badge: null,
    provenance: 'No posting text and no summary are stored for this opportunity.',
    body: null,
  }
}

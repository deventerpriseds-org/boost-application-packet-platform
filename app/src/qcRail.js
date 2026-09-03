// P5.1 - the packet-level QC & evidence rail.
//
// Pure logic ONLY. No React import, no JSX, no window/document, so Node's built-in test runner can
// import it directly and every rule below is PROVEN rather than eyeballed:
//     node --input-type=module -e "await import('./app/src/qcRail.js')"
// Tests: app/test/qcRail.test.mjs.
//
// This module exists because a count bug shipped from a .jsx that computed its own numbers. The
// component that renders this rail computes NO gate, NO severity and NO count - it renders what the
// functions here return.
//
// It EXTENDS ../assetGate.js rather than restating it: engineRows(), scoreParts(), gateMeta() and
// stateMeta() are the P5.3 selectors and stay the single definition of "which engine sent this row",
// "what are the three score parts" and "what colour is a state". Only what is genuinely new to the
// PACKET-level rail lives here.
import {
  engineRows, scoreParts, gateMeta, stateMeta, arr, severityFor, reconcile, assetLabel, pctWidth,
  correctionsState, orderCorrections, correctionRow, correctionSentence, correctionAnomalies,
  correctionSourceText, undoAvailability, keepAvailability, revertOutcome, suggestScope, fieldLabel,
  ATTENTION_ORDER, attentionRank, firstFixFinding, severityWeight, bySeverity, checkLabel,
  CHANGE_LOG_HEADLINE, CORRECTION_SOURCE, CORRECTION_REVERT_ROUTE,
} from './assetGate.js'

export { engineRows, scoreParts, gateMeta, stateMeta, pctWidth }

// SPEC 4.8-11. The severity ORDER is assetGate's, re-exported here for the same reason the score
// selectors are: the rail reads one definition of "what is read first" rather than keeping a second
// copy that is free to drift from the drawer's.
export { ATTENTION_ORDER, attentionRank, firstFixFinding, severityFor, severityWeight, bySeverity }

// P8.6's change log reads the SAME payload the gate and the counters read, so its selectors live
// beside theirs in assetGate.js and are re-exported here rather than reimplemented. A second
// definition of "how many corrections" is the whole failure this rail was built to prevent.
export {
  correctionsState, orderCorrections, correctionRow, correctionSentence, correctionAnomalies,
  correctionSourceText, undoAvailability, keepAvailability, revertOutcome, suggestScope,
  CHANGE_LOG_HEADLINE, CORRECTION_SOURCE, CORRECTION_REVERT_ROUTE,
}

/**
 * Every `data-qc` selector this rail renders.
 *
 * ui-verify.yml selects by CSS ONLY (COUNT_SEL / CLICK_SEL / MEASURE_SEL are raw selectors), so a
 * surface with no stable hook is permanently unprovable on the live site no matter how correct it
 * is. Naming them here - and rendering nothing by a hand-typed string - keeps the verifier's inputs
 * and the DOM from drifting apart, and lets a test assert the .jsx actually uses each one.
 */
export const QC_HOOKS = {
  rail: 'qc-rail',                       // the step root
  gate: 'qc-gate',                       // the packet gate word
  counts: 'qc-counts',                   // the counts strip
  toFix: 'qc-to-fix',                    // the "to fix" number
  toReview: 'qc-to-review',              // the "to review" number
  unchecked: 'qc-unchecked',             // assets with no gate row at all
  body: 'qc-body',                       // the plain-language sentence under the gate
  headline: 'qc-headline',               // the composite, or the statement that there is none
  component: 'qc-score-component',       // one of the three score parts
  tab: 'qc-tab',
  panel: 'qc-tabpanel',
  filter: 'qc-filter',                   // the active requirement filter
  goToField: 'qc-go-to-field',           // finding -> the draft itself (the drawer link stays too)
  clearFilter: 'qc-clear-filter',
  coverageCard: 'qc-coverage-card',
  coverageCount: 'qc-coverage-count',
  reqRow: 'qc-req-row',
  asset: 'qc-asset',
  check: 'qc-check',
  checkCount: 'qc-check-count',          // the clickable count (carries artifact + section)
  countInert: 'qc-count-inert',          // an offender that resolves to no section
  notApplicable: 'qc-not-applicable',
  review: 'qc-review',
  loops: 'qc-loops',
  empty: 'qc-empty',
  // P8.6 - the change log (R1). `corrected` is a THIRD number beside toFix and toReview, never
  // added into either: a correction is something already done, not something to do.
  changeLog: 'qc-change-log',            // the change-log region
  corrected: 'qc-corrected',             // how many changes were made for the user
  correctionsUndone: 'qc-corrections-undone',
  correctionNote: 'qc-correction-note',  // the sentence for a log that is absent, empty or unreadable
  // SPEC 4.8-10 - the sibling list: what the run could NOT settle, on the page beside what it did.
  decisions: 'qc-decisions',             // the region
  decisionAsset: 'qc-decision-asset',    // one asset inside it (carries data-qc-artifact)
  decisionNote: 'qc-decision-note',      // clear / unchecked / loading - three DIFFERENT sentences
  decisionError: 'qc-decision-error',    // an asset whose findings could not be read, named not dropped
  decisionCount: 'qc-decision-count',    // the two numbers, carried from railTotals - never recomputed
  decisionAnomaly: 'qc-decision-anomaly',// the payload contradicting itself, REPORTED not resolved
  correction: 'qc-correction',           // one change (carries data-qc-field and data-qc-state)
  correctionOpen: 'qc-correction-open',  // opens the field the change was made in
  correctionUndo: 'qc-correction-undo',
  correctionSuggest: 'qc-correction-suggest',
  correctionRefusal: 'qc-correction-refusal',   // the server's own words when an undo is declined
  correctionAnomaly: 'qc-correction-anomaly',
  // SPEC 4.8-21 - `Ask why` on a swap row. Carries the artifact the question was bound to, because
  // the swap row itself is packet-level and the binding is the part that can be wrong.
  askWhy: 'qc-ask-why',
  // SPEC 4.8-20 - `Undo this`, its sibling on the same row and the same seed mechanism. Its own
  // hook rather than a variant attribute on `qc-ask-why`, because the two have DIFFERENT absence
  // rules (a `kept` row keeps Ask why and loses this one), and a sweep that cannot tell them apart
  // cannot tell a correct absence from a missing control.
  undoSwap: 'qc-undo-swap',
  // SPEC 4.11-7 - `Re-run QC` on a recorded change. See the CorrectionRow comment for why this is
  // the row that carries it and what was NOT built beside it.
  correctionRerun: 'qc-correction-rerun',
  // SPEC 4.11-7 - the sentence standing in for a control that must not render.
  correctionKeepNote: 'qc-correction-keep-note',
  // Frontend checks-wiring gap: a write to an artifact's text (generate/content/ai-edit/owner-edit/
  // revert) can succeed while the SERVER's attempt to recompute the gate in that same request fails.
  // The response still carries `ok: true` (the text WAS saved) plus `checksStale`/`checksError`
  // beside it, so a silent gate is the one thing that must never happen here: the number on screen
  // may now describe text that no longer exists. This is that number's caveat.
  staleChecks: 'qc-stale-checks',
}

// The five tabs P5.1 specifies, in the backlog's order.
export const RAIL_TABS = [
  { key: 'coverage', label: 'Coverage' },
  { key: 'compare', label: 'Original vs final' },
  { key: 'loops', label: 'Remediation loops' },
  { key: 'checks', label: 'Checks' },
  { key: 'review', label: 'Independent review' },
]

// ── the gate ────────────────────────────────────────────────────────────────────────────────────

/**
 * THE SERVER'S gate, verbatim.
 *
 * gateFor() lives in api/src/functions/tests/checks.ts and is the ONE place an artifact's verdict is
 * decided. A client that re-derives it from `results` will disagree with the server the moment the
 * two implementations drift - and the server is the one that refuses the approval, so the client
 * would be the one that is wrong while looking authoritative.
 *
 * `null` becomes 'unchecked', NEVER 'pass'. An artifact with no artifact_gate row has not been
 * checked; that is the ABSENCE of a verdict, not permission, and approvalBlock() blocks on it.
 */
export function railGate(result) {
  const g = result && result.gate
  return g == null ? 'unchecked' : String(g)
}

/** Plain-language words for a gate, including the unchecked state assetGate's map has no key for. */
export const RAIL_GATE_META = {
  unchecked: { tone: 'panel', word: 'Not checked', blurb: 'the checks have not been run for this asset' },
}
export function railGateMeta(result) {
  const g = railGate(result)
  return RAIL_GATE_META[g] || gateMeta(g)
}

/**
 * The sentence for a checks-stale caveat, or null when there is nothing to say.
 *
 * `entry` is one `useQcEntries()` row - `{ stale, staleError }`. The server names the reason
 * (`checksError`) whenever it has one (a model call failed, a timeout); when it does not, the
 * generic sentence still tells the reader the number may be wrong, which is the one thing that must
 * never go unsaid. Kept a pure function, not inlined in the .jsx, for the same reason every other
 * sentence in this rail is: the component renders words, it does not compose them.
 */
export function staleChecksNote(entry) {
  if (!entry || !entry.stale) return null
  const reason = entry.staleError ? String(entry.staleError).trim() : ''
  return reason
    ? `Checks could not be recomputed after the last change - ${reason}. The numbers below may be out of date.`
    : 'Checks could not be recomputed after the last change. The numbers below may be out of date.'
}

/**
 * The number of findings needing attention - the SERVER's own `attention`, never a recount.
 *
 * attentionCount() computed it over the same rows the gate was computed from, in the same run. A
 * client recount answers a different question the moment the payload's rows and its count disagree,
 * and quietly substituting our number for theirs is how a badge and a gate come to contradict each
 * other with no way for the reader to tell which is real. reconcile() (assetGate.js) is where a
 * disagreement gets REPORTED; nothing here resolves it.
 */
export function railAttention(result) {
  const n = Number(result && result.attention)
  return Number.isFinite(n) ? n : 0
}

const NEEDS_ATTENTION = (r) => r && (r.state === 'fail' || r.state === 'warn')

/**
 * The two counts, as two independent fields. NOTHING sums them.
 *
 * `toFix` is what the measured rules found; `toReview` is what the independent reviewer raised. A
 * reviewer `fail` counts in toReview and NEVER in toFix (decision D6): only deterministic rows can
 * fail an artifact, so folding a reviewer fail into "to fix" would tell a reader they are blocked by
 * something that cannot block them.
 *
 * There is deliberately no `total` here. A single blended number is what let a green gate render
 * beside "1 to fix" in the reference prototype - the two halves answer different questions and are
 * acted on differently, so they are never added together.
 */
export function railCounts(result) {
  return {
    toFix: engineRows(result, 'deterministic').filter(NEEDS_ATTENTION).length,
    toReview: engineRows(result, 'reviewer').filter(NEEDS_ATTENTION).length,
  }
}

/**
 * Packet-level rollup across assets. Each FIELD is summed over the assets independently; the two
 * fields are still never added to each other.
 *
 * `unchecked` is its own number rather than being folded into either: an asset nobody ran the checks
 * on has zero findings, and reporting that as "nothing to fix" is exactly the laundering this rail
 * exists to prevent.
 */
export function railTotals(entries) {
  const list = arr(entries)
  let toFix = 0, toReview = 0, unchecked = 0, checked = 0
  // P8.6 / R4. Corrections are summed in their OWN accumulators and are added to neither counter.
  // `correctionsMeasured` is how many assets sent a readable change log; when it is zero the rail
  // prints no corrections number at all, because a total of 0 over assets that were never asked is
  // the reviewer's "0 disagreements" - a measurement reported that was never taken.
  let corrected = 0, correctionsUndone = 0, correctionsMeasured = 0, correctionsUnread = 0
  for (const e of list) {
    const result = e && e.result
    if (railGate(result) === 'unchecked') { unchecked += 1; continue }
    checked += 1
    const c = railCounts(result)
    toFix += c.toFix
    toReview += c.toReview
    const log = correctionsState(result)
    if (log.hasNumber) { correctionsMeasured += 1; corrected += log.count; correctionsUndone += log.undone }
    else correctionsUnread += 1
  }
  return {
    toFix, toReview, unchecked, checked, assets: list.length,
    corrected, correctionsUndone, correctionsMeasured, correctionsUnread,
  }
}

/**
 * The change log for ONE asset, and the sentence to print when there is not one.
 *
 * A thin pass-through on purpose: it exists so every surface reaches the change log through the rail
 * module the way it reaches the gate, rather than a component reading `result.corrections` itself.
 * The moment a `.jsx` touches that property directly there are two definitions of the number.
 */
export function railChangeLog(result) {
  return correctionsState(result)
}

// `severityWeight` and `bySeverity` MOVED to ./assetGate.js beside `ATTENTION_ORDER`, the order they
// derive from - the same move `pctWidth` made, and for the same reason. The gate drawer may not
// import this module, so while the rule lived here the drawer's Checks tab had to carry its own
// copy (`{ fail: 0, warn: 1, not_applicable: 2, pass: 3 }`), making FOUR orderings of one claim.
// Re-exported above, so every existing caller and test keeps its import unchanged.

/**
 * The rows that could not be checked, each carrying the SERVER's reason.
 *
 * not_applicable is never a pass and is counted in neither number - so the only way it stays visible
 * is by rendering its `observed`, which is the sentence saying why there was nothing to test against.
 */
export function notApplicableRows(result) {
  const rows = [...engineRows(result, 'deterministic'), ...engineRows(result, 'reviewer')]
  return rows.filter((r) => r && r.state === 'not_applicable')
    .map((r) => ({ check_key: r.check_key, reason: r.observed || 'no reason was recorded', engine: r.engine }))
}

/** Every row this payload carries, in one list, ordered by severity. */
export function allRows(result) {
  return bySeverity([...engineRows(result, 'deterministic'), ...engineRows(result, 'reviewer')])
}

/**
 * The sentence under the gate word.
 *
 * The case this function exists for: every check came back not_applicable, so the server says `warn`
 * (gateFor's `every(not_applicable)` branch). Showing `warn` with the generic "findings you can
 * accept" blurb would be a lie - there are no findings, there is no evidence. It says so instead.
 */
export function railBody(result) {
  const gate = railGate(result)
  if (gate === 'unchecked') return 'The checks have not been run for this asset, so there is no verdict to show. That is not a pass.'
  const rows = allRows(result)
  if (rows.length && rows.every((r) => r.state === 'not_applicable')) {
    return 'Nothing could be checked. Every check had no evidence to test against, so the gate is '
      + gate + ' - an absence of findings, not a clean result.'
  }
  if (!rows.length) return 'The server recorded a gate of ' + gate + ' but sent no check rows with it.'
  const c = railCounts(result)
  const na = rows.filter((r) => r.state === 'not_applicable').length
  const parts = []
  if (c.toFix) parts.push(c.toFix + ' to fix from the measured rules')
  if (c.toReview) parts.push(c.toReview + ' to review from the independent reviewer')
  if (!parts.length) parts.push('nothing needs attention')
  return parts.join(' · ')
    + (na ? '. ' + na + ' check(s) had nothing to test against and are not counted in either number - that is not a pass.' : '.')
}

// ── the score ───────────────────────────────────────────────────────────────────────────────────

/**
 * The headline number - or the honest statement that there is not one.
 *
 * `composite` is null unless all three components exist (computeArtifactScore), and TODAY
 * `keyword_coverage` and `seniority_alignment` are both null on live rows: the term library has no
 * published scoreable entries and the reviewer has not graded. So the normal case is NO headline,
 * and the components carry the server's own prose for why. Never 0, never a dash-percent, never NaN.
 */
export function railHeadline(score) {
  const parts = scoreParts(score)
  const missing = parts.filter((p) => p.value == null)
  const composite = score && score.composite
  if (composite == null) {
    return {
      hasNumber: false, value: null, band: null, parts, missing,
      why: missing.length
        ? 'No overall number: a composite is only computed when all three parts exist, and '
          + missing.length + ' of them ' + (missing.length === 1 ? 'does' : 'do') + ' not - '
          + missing.map((m) => m.label.toLowerCase()).join(', ') + '.'
        : 'No overall number was stored for this run.',
    }
  }
  return { hasNumber: true, value: Number(composite), band: score.band || null, parts, missing, why: '' }
}

/**
 * The independent reviewer's line.
 *
 * A null verdict means the reviewer HAS NOT RUN. "0 disagreements" is a measurement, and reporting a
 * measurement that was never taken is the exact shape of the bug this whole feature is against.
 */
export function verdictLine(verdict) {
  if (!verdict) {
    return { ran: false, text: 'The independent reviewer has not run for this asset. Nothing here has been second-guessed.' }
  }
  const agreed = Number(verdict.agreed)
  const disagreed = Number(verdict.disagreed)
  const bits = []
  bits.push(verdict.grade ? 'graded ' + verdict.grade : 'no grade recorded')
  if (Number.isFinite(agreed) || Number.isFinite(disagreed)) {
    bits.push((Number.isFinite(agreed) ? agreed : 'an unrecorded number of') + ' agreed, '
      + (Number.isFinite(disagreed) ? disagreed : 'an unrecorded number of') + ' disagreed')
  }
  if (Number.isFinite(Number(verdict.citations_kept))) {
    bits.push(Number(verdict.citations_kept) + ' of ' + Number(verdict.citations_received) + ' citations survived verification')
  }
  return { ran: true, text: bits.join(' · ') }
}

/**
 * The reviewer's verdict as the rail reads it - taken from the server's own grouping.
 *
 * NOTHING here reaches for the raw refused-quote column. shapeVerdict() deliberately keeps those
 * quotes off the wire and sends counts plus a reason breakdown instead: a quote that failed
 * verification did not appear in the posting, and rendering it beside real ones is how a fabricated
 * quote gets read as evidence. app/test/qcRail.test.mjs greps app/src for that column name, so this
 * comment does not name it either - a grep that its own guard trips on teaches people to ignore it.
 */
export function railVerdict(result) {
  const r = result && result.engines && result.engines.reviewer
  return (r && r.verdict) || null
}

// ── deep links: a count that opens the field it counted (P8.5) ───────────────────────────────────

/**
 * Every merge field the pipeline can write, from TEMPLATE_META (api packetTemplates.ts):
 *   resume / compact_resume - 7 each, portfolio - 7, cover - 3.
 * A check offender names one of these or it names none; there is no third possibility, because
 * these are the only slots the generator has.
 */
export const MERGE_FIELDS = [
  'ResumeSummary', 'SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets',
  'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3',
  '@Company', '@CoverLetterDate', '@CoverLetterBody', '@AboutMe1_50words',
  '@AboutMe2_60words', '@ExecutiveProfile_55words', '@CoreAccomplishments_5blts_180words',
]

/**
 * Checks whose finding is ABOUT one field even though the offender string does not repeat its name.
 * Both are emitted by checks.ts with a fixed subject:
 *   company_named   -> `expected <X>, found <Y>`      (the subject is @Company)
 *   company_in_body -> `"<X>" absent from @CoverLetterBody`  (already names it, kept for clarity)
 */
export const CHECK_SUBJECT_FIELD = {
  company_named: '@Company',
  company_in_body: '@CoverLetterBody',
}

/**
 * The section (merge field) one offender points at, or null.
 *
 * `check_result` has NO section_id column - P8.5 needs one anyway, so it is DERIVED here, in one
 * place, from the merge-field name checks.ts writes into the offender string. Every caller uses this
 * function; a second inline regex somewhere in a .jsx is how two surfaces come to disagree about
 * which field a finding belongs to.
 *
 * Deliberately EXACT, never fuzzy: this decides whether a count is clickable, and a wrong section
 * sends a reader to a field that has nothing wrong with it. Absent evidence returns null - which the
 * caller renders inert with the reason - rather than a best guess.
 *
 * Offender shapes it must read (checks.ts):
 *   `RelevantBullets1: some item (24)`      relevant_char_limit / omission_list
 *   `ResumeSummary: double space`           whitespace / markup_residue
 *   `@AboutMe1_50words: 61 words (want ...)` word_counts
 *   `SkillsBullets2`                         empty_merge_fields (the bare field name)
 *   `item (SkillsBullets1 + SkillsBullets2)` cross_list_redundancy - TWO fields, so it resolves to
 *                                            neither: a reader sent to one of them would be told the
 *                                            wrong half of the story.
 */
export function sectionIdForOffender(checkKey, offender) {
  const s = String(offender == null ? '' : offender).trim()
  if (!s) return null

  // Two fields named in one offender: the finding is the RELATIONSHIP between them, not a defect in
  // either. Refuse rather than pick.
  const named = MERGE_FIELDS.filter((f) => s.includes(f))
  if (named.length > 1) return null

  // `Field: rest` - the form checks.ts uses whenever it attributes a defect to a field.
  const colon = s.indexOf(':')
  if (colon > 0) {
    const head = s.slice(0, colon).trim()
    if (MERGE_FIELDS.includes(head)) return head
  }
  // The bare field name (empty_merge_fields).
  if (MERGE_FIELDS.includes(s)) return s
  // A single field named anywhere in the string (company_in_body's `absent from @CoverLetterBody`).
  if (named.length === 1) return named[0]
  // A check whose subject is fixed by the rule itself.
  const subject = CHECK_SUBJECT_FIELD[checkKey]
  if (subject) return subject
  return null
}

/** Why an offender could not be resolved - shown beside it, so "not clickable" is never mute. */
export function inertReason(checkKey, offender) {
  const s = String(offender == null ? '' : offender).trim()
  if (MERGE_FIELDS.filter((f) => s.includes(f)).length > 1) {
    return 'this finding spans two fields, so it does not open one of them'
  }
  if (/^#\d+\b/.test(s)) return 'this is a posting requirement, not a field of the document'
  return 'this finding names no merge field, so there is nothing to open'
}

/**
 * Split one check's offenders into the ones that can open a field and the ones that cannot.
 *
 * An offender with no section is EXCLUDED from the link set and rendered inert WITH its reason. A
 * count wired to a link that lands nowhere is worse than no link: it teaches a reader that the
 * evidence trail is broken, which is the one thing this rail is for.
 */
export function offenderLinks(artifactId, row) {
  const key = row && row.check_key
  const linked = []
  const inert = []
  for (const o of arr(row && row.offenders)) {
    const sectionId = sectionIdForOffender(key, o)
    if (sectionId && artifactId) linked.push({ offender: String(o), artifact_id: artifactId, section_id: sectionId })
    else inert.push({ offender: String(o), reason: artifactId ? inertReason(key, o) : 'this finding is not tied to an asset' })
  }
  return { linked, inert }
}

/**
 * The FIRST merge field one check's offenders name, or null.
 *
 * A thin read of `sectionIdForOffender` over `row.offenders`, in payload order, stopping at the
 * first that resolves. It exists so `packetFailList` reaches the field through the same single parse
 * as every other surface instead of consulting `CHECK_SUBJECT_FIELD` alone - see the comment there
 * for the defect that produced.
 *
 * NULL, never a guess. `sectionIdForOffender` already refuses an offender naming two fields (the
 * finding is the relationship between them) and one naming none, and this inherits both refusals
 * rather than falling back to "the first field mentioned anywhere".
 */
export function firstOffenderField(row) {
  const key = row && row.check_key
  for (const o of arr(row && row.offenders)) {
    const f = sectionIdForOffender(key, o)
    if (f) return f
  }
  return null
}

/**
 * The count rendered against one check, and whether it may be clicked.
 *
 * `count` is the number of offenders the server sent - the finding's own size. It is clickable only
 * when at least one offender resolves to a section, and it then carries artifact_id + section_id so
 * the click can open that field.
 */
export function countLink(artifactId, row) {
  const { linked, inert } = offenderLinks(artifactId, row)
  const first = linked[0] || null
  return {
    count: arr(row && row.offenders).length,
    linkable: !!first,
    artifact_id: first ? first.artifact_id : null,
    section_id: first ? first.section_id : null,
    sections: Array.from(new Set(linked.map((l) => l.section_id))),
    linked,
    inert,
    reason: first ? '' : (arr(row && row.offenders).length
      ? 'none of these findings names a field of the document'
      : 'this check listed no specific items'),
  }
}

/**
 * ONE check's offenders, grouped by the merge field each one names, with the field prefix removed.
 *
 * Written for `posting_wording_kept` - the prototype puts that finding in the FIELD'S MARGIN
 * (`docs/qc-evidence/qc/assets.jsx:124`, "Wording kept from the posting"), beside the sentence the
 * phrase is in, because it is a judgement the writer makes about their own words. But it is
 * deliberately keyed on `checkKey` rather than hardcoding that one check: every offender in
 * checks.ts that attributes a defect to a field uses the same `Field: rest` shape, so the next
 * check the design wants in a margin needs no second grouping function.
 *
 * SPLIT ON THE FIELD NAME, never on the first colon. `posting_wording_kept` offenders are
 * `` `${field}: "${phrase}"` `` and a kept phrase can itself contain a colon - splitting on
 * indexOf(':') would silently truncate the phrase the reader is being asked to judge. Resolution
 * goes through `sectionIdForOffender` for the same reason `offenderLinks` does: one parse, so the
 * margin and the QC tab can never disagree about which field a finding belongs to.
 *
 * Returns null when the payload has no such row - which is NOT the same as a row with no offenders
 * (a pass), and the caller must be able to tell them apart.
 */
export function offendersByField(result, checkKey) {
  const row = allRows(result).find((r) => r && r.check_key === checkKey)
  if (!row) return null
  const byField = {}
  for (const o of arr(row.offenders)) {
    const s = String(o)
    const field = sectionIdForOffender(checkKey, s)
    if (!field) continue
    let text = s.startsWith(field + ':') ? s.slice(field.length + 1).trim() : s.trim()
    // checks.ts quotes the phrase; the margin renders it as the field's own words, so the quotes
    // would read as part of it. Stripped only when they wrap the WHOLE value.
    if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
    ;(byField[field] || (byField[field] = [])).push(text)
  }
  return { row, byField, state: row.state, expected: row.expected || '' }
}

/**
 * Every finding that names a merge field, grouped by that field — the per-field list the collapsed
 * header's counts finally have something to expand into.
 *
 * THE GAP: the asset header counts `N to fix` / `N to review` / `N your call`, and only TWO of the
 * five severities rendered anywhere in a field's margin (`fixed`, via the change log, and
 * `posting_wording_kept`). A deterministic `fail` on this asset was invisible on the very step where
 * the reader is reading the draft — the number said "1 to fix" and nothing said what.
 *
 * `posting_wording_kept` is EXCLUDED here on purpose. It already has a richer block of its own in
 * the margin (the phrase, its `kept` status, the reword control), and rendering it twice would put
 * one finding in two places and let the two drift. Everything else lands in this list.
 *
 * Offenders are filtered to the ones naming THIS field, so a check that failed across three fields
 * shows each field only its own — a reader looking at Skills 1 should not be handed Relevant 2's
 * offender to puzzle over.
 */
export function findingsByField(result, exclude = ['posting_wording_kept']) {
  const skip = new Set(arr(exclude))
  const out = {}
  for (const row of allRows(result)) {
    if (!row || skip.has(row.check_key)) continue
    const sev = severityFor(row)
    if (!sev) continue
    const byField = {}
    for (const o of arr(row.offenders)) {
      const f = sectionIdForOffender(row.check_key, o)
      if (!f) continue
      const s = String(o)
      ;(byField[f] || (byField[f] = [])).push(
        s.startsWith(f + ':') ? s.slice(f.length + 1).trim() : s.trim())
    }
    for (const [f, offenders] of Object.entries(byField)) {
      ;(out[f] || (out[f] = [])).push({
        check_key: row.check_key, sev, state: row.state, engine: row.engine,
        expected: row.expected || '', offenders,
      })
    }
  }
  // Worst first, so the thing that blocks is the thing read first.
  const rank = { fix: 3, review: 2, soft: 1 }
  for (const f of Object.keys(out)) out[f].sort((a, b) => rank[b.sev] - rank[a.sev])
  return out
}

/**
 * The WORST severity attaching to each merge field — `{ ResumeSummary: 'fix', ... }`.
 *
 * Lets a field state its own condition (the measurement line paints red/yellow) without the
 * component re-deriving severity from state+engine. That split is D6's — a reviewer `fail` may
 * never block — and a field painted from a second reading of it would be free to contradict the
 * rail and the asset header, which both go through `severityFor`.
 *
 * A row contributes to a field only where one of its OFFENDERS names that field, through the same
 * `sectionIdForOffender` every other surface uses. A check that failed for the artifact as a whole
 * and names no field colours nothing: it is not this field's problem, and painting every field for
 * it is how a screen teaches a reader to ignore colour.
 */
export function fieldSeverities(result) {
  const rank = { fix: 3, review: 2, soft: 1 }
  const out = {}
  for (const row of allRows(result)) {
    const sev = severityFor(row)
    if (!sev) continue
    const fields = new Set()
    for (const o of arr(row.offenders)) {
      const f = sectionIdForOffender(row.check_key, o)
      if (f) fields.add(f)
    }
    for (const f of fields) {
      if (!out[f] || rank[sev] > rank[out[f]]) out[f] = sev
    }
  }
  return out
}

/** The offenders of one grouped check that belong to one field. [] when there are none. */
export function offendersForField(grouped, mergeField) {
  if (!grouped || !mergeField) return []
  return grouped.byField[mergeField] || []
}

/**
 * The findings on one asset that name a given requirement.
 *
 * The offender prefix is read through offenderSeq() - the SAME parse the coverage cards use. A
 * second inline `startsWith('#' + seq)` in a component is how two surfaces come to disagree about
 * which findings belong to a requirement.
 */
export function rowsForRequirement(result, seq) {
  const rows = allRows(result)
  if (seq == null) return rows
  return rows.filter((r) => arr(r.offenders).some((o) => offenderSeq(o) === Number(seq)))
}

/**
 * SPEC 4.8-10 - "Needs a decision", ON THE PAGE. The sibling of railChangeLog(): the change log is
 * what the run SETTLED on its own, this is what it could not.
 *
 * EVERY INPUT ALREADY EXISTED. The rows, the fail/warn split, the ordering and the deep-link target
 * are all already rendered in the Checks tab and the gate drawer; what was missing was a page-level
 * mount, because SPEC 4.8 is explicit that both lists are "on the page, not behind a tab or a
 * search". So this is a PROJECTION of the payload the rail already fetched - not a second fetch,
 * not a sixth tab, and above all not a third definition of "needs attention".
 *
 * That last point is the one worth guarding. `needsAttention` (assetGate.js) and `NEEDS_ATTENTION`
 * (above) are already two copies of the same predicate differing only in name, and the existing
 * "computes nothing" guard greps QcRail.jsx only, so it is structurally blind to a third copy
 * landing in a module. This function restates nothing: it reads engineRows() and NEEDS_ATTENTION,
 * the same two things railCounts() reads, which is why its row count and the counts strip cannot
 * disagree - they are the same rows.
 *
 * FOUR PER-ASSET STATES, four different sentences, exactly as ChangeLog has. `unchecked` is not
 * `clear`: an asset nobody ran the checks on has zero findings, and printing "nothing needs a
 * decision" over it is the vacuous green this whole rail exists to prevent. `error` is not
 * `clear` either - an omitted asset reads as nothing-to-decide for it, so it is named.
 */
export function railDecisions(entries) {
  const assets = arr(entries).map((e) => {
    const result = e && e.result
    // SPEC 4.8-11 - ORDERED BY SEVERITY, through the one rank every other surface reads.
    //
    // This used to be a hand-rolled nest: engine outermost, then `['fail','warn']`. That produced
    // deterministic-fail, deterministic-warn, reviewer-fail, reviewer-warn - which puts a reviewer
    // `fail` (severity `soft`, "Your call", the row that may never block) ABOVE a reviewer `warn`
    // (severity `review`), the exact inversion 4.8-11 names. It was also a THIRD ordering of the same
    // rows, free to disagree with `bySeverity` above it and with the drawer's Checks tab.
    //
    // `attentionRank` sorts; the sort is stable within a rank (index tie-break), so two renders of
    // one payload are identical. `kind` is still the ENGINE's own word - it says which of the two
    // counters the row belongs to, which is not the same question as how urgently it reads, and D6
    // is why those two are never collapsed.
    const rows = [...engineRows(result, 'deterministic').filter(NEEDS_ATTENTION).map((r) => ({ r, engine: 'deterministic', kind: 'fix' })),
      ...engineRows(result, 'reviewer').filter(NEEDS_ATTENTION).map((r) => ({ r, engine: 'reviewer', kind: 'review' }))]
      .map((x, i) => ({ ...x, i, sev: severityFor(x.r) }))
      .sort((a, b) => (attentionRank(a.sev) - attentionRank(b.sev)) || (a.i - b.i))
      .map((x) => ({ row: x.r, kind: x.kind, engine: x.engine, sev: x.sev }))
    const unchecked = railGate(result) === 'unchecked'
    const status = e && e.resultLoading ? 'loading'
      : e && e.resultError ? 'error'
        : unchecked ? 'unchecked'
          : rows.length ? 'open' : 'clear'
    // An asset with NO gate row is excluded from toFix/toReview by railTotals (it is counted in
    // `unchecked` instead), so any finding it carries is in no number the counts strip shows. Both
    // obvious moves are wrong: hiding the rows loses a real finding, and adding them to `rows`
    // makes this list disagree with the strip above it. So they are LISTED and counted separately,
    // and the contradiction is reported the way reconcile() reports the server's own.
    const anomalies = arr(reconcile(result))
    if (unchecked && rows.length) {
      anomalies.push('this asset has no gate row, so its ' + rows.length +
        ' open finding(s) are in neither number above - the checks need to be run before they count')
    }
    return {
      artifact: e && e.artifact, label: e && e.label, status, rows, unchecked,
      error: (e && e.resultError) || null,
      anomalies,
    }
  })
  const totals = railTotals(entries)
  return {
    assets,
    // COUNTED rows only, so this reconciles with the strip by construction. See `uncounted`.
    rows: assets.reduce((n, a) => n + (a.unchecked ? 0 : a.rows.length), 0),
    uncounted: assets.reduce((n, a) => n + (a.unchecked ? a.rows.length : 0), 0),
    // Carried, never recomputed here. The list and the counts strip read one number so they cannot
    // drift; a mismatch between them is a bug in this projection, and the guard asserts equality.
    toFix: totals.toFix,
    toReview: totals.toReview,
    unchecked: totals.unchecked,
    // ANY ROW ON SCREEN, not `status === 'open'`. The status form was a real on-screen falsehood
    // (verifier F-1): an asset with findings but no gate row gets `status: 'unchecked'`, never
    // 'open', so `anyOpen` came back false on a screen that was rendering its CheckRows — and the
    // footer then printed "Nothing is waiting on you. Every check that could run is clear." above
    // two listed findings. Both halves false, and it is the exact vacuous-green laundering AC 1.8
    // exists to prevent, arriving one step to the side of where AC 1.8 was looking.
    //
    // `rows.length` is what the reader can SEE, and the footer is a statement about what they see.
    // A derived status is a proxy for that; the proxy and the screen disagreed.
    anyOpen: assets.some((a) => a.rows.length > 0),
    anyChecked: totals.checked > 0,
  }
}

/** The sentence for an asset with no open decisions, which is NOT one sentence. */
export const DECISION_NOTE = {
  clear: 'Every check that could run on this asset is clear.',
  unchecked: 'The checks have not been run on this asset, so nothing here has been decided either way.',
  loading: 'Reading the open findings for this asset...',
}

/** The swap decisions that cite a given requirement id. */
/**
 * `list -> artifact`, derived from the PACKET'S OWN ARTIFACTS rather than from render-time
 * registration.
 *
 * SPEC 4.1-20 (`Where it is used ->`) is the one row of the JD evidence cluster that did not ship,
 * and the reason was never a missing feature. Every piece existed: `goToField`, `swapsForRequirement`
 * and the swaps themselves. What was missing is this hop - a swap row is keyed by LIST, not by
 * artifact, so turning one into a navigation needs to know which artifact renders that list.
 *
 * The app already had such a map (`listOwners`, PacketBuilder) and it could not be used here: it is
 * populated by asset cards REGISTERING as they render, so on the JD step - where the reader is - it
 * is `{}`, and the link would be absent exactly where SPEC asks for it. Deriving it from the packet's
 * own artifacts makes it available on every step, including before any asset card has mounted.
 *
 * Returns `{}` rather than a partial map when insertions have not loaded, so the caller renders no
 * link at all instead of a link that resolves to nothing.
 *
 * EACH OWNER ALSO CARRIES `mergeField`, and that is the only human name a swap row can be given.
 * `swap_decision` has no `merge_field` column at all (`schema.ts:564`) and its `list` is a raw enum
 * - `skills_1 | skills_2 | relevant_1 | relevant_2 | relevant_3`, a CHECK constraint, not copy. The
 * insertion row that ties the list to a field is the ONLY place the field name exists on the client,
 * so it is carried here, once, beside the artifact it was already resolving. `sharedSourceNote`
 * already takes `list` and uses it purely as a map key rather than in its sentence; this keeps that
 * discipline available to every caller instead of leaving the next one to interpolate the enum
 * (which is exactly `assetBlocks.js:765`, the third render site that shipped `swapped - owner`).
 */
export function listOwnersFromArtifacts(entries) {
  const out = {}
  for (const e of arr(entries)) {
    const artifactId = e && (e.artifactId || (e.artifact && e.artifact.id))
    if (!artifactId) continue
    for (const row of arr(e.insertions && e.insertions.insertions)) {
      const list = row && row.list
      if (!list) continue
      if (!out[list]) out[list] = []
      if (!out[list].some((o) => o.id === artifactId)) {
        out[list].push({
          id: artifactId,
          label: e.label || assetLabel(e.type || (e.artifact && e.artifact.type)),
          mergeField: row.merge_field || null,
        })
      }
    }
  }
  return out
}

/**
 * Where a requirement is USED: the artifact and merge field a swap for it landed in, or null.
 *
 * NULL IS THE CONTRACT. A requirement with no swap, a swap whose list no artifact renders, or
 * insertions that have not loaded all return null, and the caller must render NO LINK - the ledger
 * row for this feature says the link appears "ONLY where a swap actually names the requirement (no
 * dead UI)".
 */
export function requirementUsage(swaps, requirementId, owners) {
  const rows = swapsForRequirement(swaps, requirementId)
  const map = owners || {}
  for (const s of arr(rows)) {
    const list = s && s.list
    if (!list) continue
    const holder = arr(map[list])[0]
    if (!holder || !holder.id) continue
    return { artifactId: holder.id, list, label: holder.label || null, mergeField: s.merge_field || list }
  }
  return null
}

export function swapsForRequirement(swaps, requirementId) {
  const rows = arr(swaps && swaps.swaps)
  return requirementId ? rows.filter((s) => s && s.requirement_id === requirementId) : rows
}

/**
 * SPEC 4.8-21 - `Ask why` on a swap row. The QUESTION the button seeds, or null.
 *
 * It seeds and it sends nothing. `docs/qc-evidence/qc/evidence.jsx:233` calls `onAsk(...)`, which is
 * the assistant-panel seed and nothing else, so this row is a SPEC 4.11 substitution wearing a 4.8
 * name (`AC-packet-ui-final.md` 2f, AC 34). Two conditions from that AC pass survive and are met
 * here: no swap-revert mutation is built - there is none, `appSwaps.ts` is GET-only, which is also
 * why the prototype's sibling `Undo this` does not ship beside this button - and the `Why` column
 * keeps printing the answer it already prints, so this is a conversational follow-up rather than a
 * claim that the reason was missing.
 *
 * NULL IS THE CONTRACT, same as `requirementUsage`, and for two independent reasons:
 *
 *  - `seedAssistant` (`PacketBuilder.jsx:765`) refuses a seed with no artifact - "never open a panel
 *    that cannot send", because `canSend` needs one. A swap row is PACKET-level and carries no
 *    artifact at all, so a row whose list no artifact renders (or whose insertions have not loaded)
 *    has nothing to seed and must render NO BUTTON. That is the repo's no-dead-UI rule, not caution.
 *  - a row with neither a `from_label` nor a `to_label` names nothing a question could be about.
 *
 * THE SENTENCE NEVER CONTAINS `swap.list`. The prototype interpolates it, and in the prototype it is
 * a display name ("Core Skills"); here it is a CHECK-constrained enum (`schema.ts:567`,
 * `skills_1 | relevant_2 | ...`). It is resolved through the insertion row's `merge_field` to
 * `fieldLabel` - the ONE table that already heads the field, writes the correction sentences and
 * labels the gate drawer - so `skills_1` reaches the reader as "Skills 1". If no merge field
 * resolved, the owning asset's label is the fallback; the enum is never a fallback.
 *
 * @param {{list?: string, from_label?: string|null, to_label?: string|null}|null} swap
 * @param {Record<string, Array<{id: string, label?: string, mergeField?: string|null}>>} owners
 * @returns {{artifactId: string, where: string, text: string}|null}
 */
export function swapAskWhy(swap, owners) {
  const s = swap || null
  const list = s && s.list
  if (!list) return null
  const holder = arr((owners || {})[list])[0]
  if (!holder || !holder.id) return null
  const from = s.from_label ? String(s.from_label).trim() : ''
  const to = s.to_label ? String(s.to_label).trim() : ''
  if (!from && !to) return null
  // `fieldLabel(null)` is the empty string, so the asset label carries the sentence when the
  // insertion row named no field. One of the two is always present.
  const where = (holder.mergeField ? fieldLabel(holder.mergeField) : '') || holder.label || ''
  if (!where) return null
  const text = from
    ? `Why did you change "${from}" in ${where}?`
    : `Why did you add "${to}" to ${where}?`
  return { artifactId: holder.id, where, text }
}

/**
 * SPEC 4.8-20 - `Undo this` on a swap row. The REQUEST the button seeds, or null.
 *
 * OWNER-DECIDED, and previously mis-closed. The recorded objection (the paragraph above, and
 * `PROTOTYPE-COVERAGE.md:415-416`) is that **no swap-revert MUTATION is built** - `appSwaps.ts` is
 * GET-only. That is true and is untouched here: this ships no route, calls no mutation and asserts
 * no revert. It is the SEEDED REQUEST its neighbour `Ask why` already is - the prototype's own
 * mechanism for it, `docs/qc-evidence/qc/evidence.jsx:232`, which calls the same `onAsk(...)` on the
 * same row as `:233` and nothing else. A constraint on ONE implementation is not the absence of the
 * control, and `AC-packet-ui-final.md` AC-34's actual condition - that no swap-revert mutation be
 * built - still holds.
 *
 * IT INHERITS `swapAskWhy`'s NULL CONTRACT EXACTLY, and for the same two reasons: `seedAssistant`
 * (`PacketBuilder.jsx:765`) refuses a seed with no artifact ("never open a panel that cannot send"),
 * and a row naming neither a `from_label` nor a `to_label` describes nothing a request could act on.
 * No artifact, no button - the repo's no-dead-UI rule, not caution.
 *
 * IT ADDS ONE REFUSAL `swapAskWhy` DOES NOT HAVE: `action: 'kept'`. A kept row is the tailoring pass
 * deciding to change nothing, so there is no change to undo, and a control offering to undo it would
 * be dead in the strictest sense - it would send a request about an event that never happened.
 * `Ask why` stays correct on those rows (why something was KEPT is a real question), which is
 * exactly why this is a separate refusal rather than a shared one.
 *
 * THE SENTENCE NEVER CONTAINS `swap.list`, same as `swapAskWhy`: the prototype interpolates it as a
 * display name, here it is a CHECK-constrained enum (`schema.ts:567`, `skills_1 | relevant_2 | ...`)
 * resolved through the insertion row's `merge_field` to `fieldLabel`, so `skills_1` reaches the
 * reader as "Skills 1".
 *
 * @param {{list?: string, action?: string, from_label?: string|null, to_label?: string|null}|null} swap
 * @param {Record<string, Array<{id: string, label?: string, mergeField?: string|null}>>} owners
 * @returns {{artifactId: string, where: string, text: string}|null}
 */
export function swapUndo(swap, owners) {
  const s = swap || null
  const list = s && s.list
  if (!list) return null
  // Nothing happened on a kept row, so there is nothing to put back.
  if (String(s.action || '') === 'kept') return null
  const holder = arr((owners || {})[list])[0]
  if (!holder || !holder.id) return null
  const from = s.from_label ? String(s.from_label).trim() : ''
  const to = s.to_label ? String(s.to_label).trim() : ''
  if (!from && !to) return null
  const where = (holder.mergeField ? fieldLabel(holder.mergeField) : '') || holder.label || ''
  if (!where) return null
  // THREE SENTENCES, because the three actions are three different asks and one wording would be
  // wrong for two of them. A drop has no replacement to name; an add has no original to restore.
  const text = from && to
    ? `Undo the swap of "${from}" for "${to}" in ${where}, and tell me which posting line loses its coverage.`
    : from
      ? `Put "${from}" back in ${where} - it was dropped and I would rather keep it.`
      : `Undo adding "${to}" to ${where}.`
  return { artifactId: holder.id, where, text }
}

// pctWidth moved to ./assetGate.js beside scoreParts() - the score-part bar renderer now lives in
// ONE component (AssetGateDrawer's <ScoreParts>), and that component may not import this module.
// Re-exported above, so every existing caller and test keeps its import.

// ── coverage ────────────────────────────────────────────────────────────────────────────────────

/**
 * The three requirement classes, ALWAYS three cards, each with its OWN closed/total.
 *
 * Nothing sums across kinds. A must-have and a responsibility are different obligations judged by
 * different checks, and one number over both hides which class is short.
 *
 * A kind with zero rows still returns a card, labelled "none extracted". Dropping it would make the
 * screen look complete when a whole class was never extracted from the posting - the failure is in
 * the extraction, and a missing card reports it as nothing at all.
 *
 * `closed` is null, never 0, when nothing measured it:
 *   must_have      measured by the deterministic `must_have_coverage` check
 *   responsibility measured by `responsibilities_addressed`
 *   nice_to_have   MEASURED BY NOTHING. checks.ts filters must_have and responsibility only; there
 *                  is no nice-to-have check. 0/N would read as total failure and N/N as complete,
 *                  and both would be inventions.
 */
export const COVERAGE_KINDS = [
  { key: 'must_have', label: 'Requirements · must have', check: 'must_have_coverage' },
  { key: 'nice_to_have', label: 'Requirements · nice to have', check: null },
  { key: 'responsibility', label: 'Responsibilities', check: 'responsibilities_addressed' },
]

export const NO_CHECK_NOTE = {
  nice_to_have: 'no check measures nice-to-have coverage - the engine judges must-haves and responsibilities only, so this is unmeasured rather than zero',
}

/** The `#<seq>` an offender starts with, or null. Same shape artifactScore.ts reads server-side. */
export function offenderSeq(offender) {
  const m = /^#(\d+)\b/.exec(String(offender == null ? '' : offender).trim())
  return m ? Number(m[1]) : null
}

/**
 * Which requirement seqs are still open, taken from the check offenders across every asset that
 * actually ran the check.
 *
 * A seq is CLOSED when at least one asset covers it - the packet is what gets sent, so a must-have
 * carried by the cover letter is carried. That makes the open set the INTERSECTION of the assets'
 * uncovered sets, and it only counts assets whose check actually ran: a `not_applicable` row means
 * nothing was measured, and treating its empty offender list as "covered everything" is precisely
 * how a gate goes green on unverified work.
 */
export function openSeqs(entries, checkKey) {
  let open = null
  let measured = 0
  let reason = ''
  for (const e of arr(entries)) {
    const rows = engineRows(e && e.result, 'deterministic')
    const row = rows.find((r) => r && r.check_key === checkKey)
    if (!row) continue
    if (row.state === 'not_applicable') { reason = reason || row.observed || ''; continue }
    measured += 1
    const seqs = new Set(arr(row.offenders).map(offenderSeq).filter((n) => n !== null))
    open = open === null ? seqs : new Set([...open].filter((n) => seqs.has(n)))
  }
  return { measured, open: open === null ? null : [...open].sort((a, b) => a - b), reason }
}

/**
 * Seqs the deterministic engine deliberately did NOT judge for coverage.
 *
 * P8.3 / C6 moved `must_have_coverage`'s denominator to the rows it actually judges — it excludes
 * requirements no generated merge field can carry (`template_reach`) and requirements waiting on an
 * unconfirmed owner fact (`facts_needed`). This card was left counting `total - |offenders|` over
 * EVERY row of the kind, which credits every excluded row as closed. On the live Trinnex shape that
 * printed "3 of 4 closed" — 75%, from three rows nothing measured — while the check beside it said
 * 0/1. It is the same arithmetic, and the same three rows, as the defect H28 removed from the
 * server; applying that fix only where the H-case looked would have left it on screen.
 *
 * Read off the SAME offender contract (`#<seq> …`) and the same run as the coverage check, so the
 * two cannot describe different populations. A row excluded here is `unmeasured`, never `closed`:
 * "nothing measured this" and "this is fine" are different statements.
 *
 * `facts_settled` is deliberately NOT in this list. A must-have the owner's confirmed facts SATISFY
 * is answered — closed is the truthful state for it.
 */
export const UNJUDGED_CHECKS = ['template_reach', 'facts_needed', 'fact_shortfall']

export function unjudgedSeqs(entries) {
  const out = new Set()
  for (const e of arr(entries)) {
    const rows = engineRows(e && e.result, 'deterministic')
    for (const key of UNJUDGED_CHECKS) {
      const row = rows.find((r) => r && r.check_key === key)
      if (!row) continue
      for (const n of arr(row.offenders).map(offenderSeq)) if (n !== null) out.add(n)
    }
  }
  return out
}

export function coverageCards(requirements, entries) {
  const rows = arr(requirements)
  return COVERAGE_KINDS.map((k) => {
    const mine = rows.filter((r) => r && r.kind === k.key)
    const total = mine.length
    if (!total) {
      return {
        key: k.key, label: k.label, total: 0, closed: null, rows: [],
        empty: true, note: 'none extracted', source: 'the posting produced no lines of this class',
      }
    }
    if (!k.check) {
      return {
        key: k.key, label: k.label, total, closed: null, rows: mine,
        empty: false, note: 'not measured', source: NO_CHECK_NOTE[k.key] || 'no check measures this class',
      }
    }
    const { measured, open, reason } = openSeqs(entries, k.check)
    if (!measured || open === null) {
      return {
        key: k.key, label: k.label, total, closed: null, rows: mine, empty: false, note: 'not measured',
        source: reason || 'no asset in this packet has run the checks, so coverage is unknown - not zero',
      }
    }
    // Only the rows the engine judged are in the ratio. `total` is the JUDGED population, so the
    // card and the `must_have_coverage` check print the same denominator; `classTotal` keeps the
    // size of the class so the excluded rows are visible rather than absorbed.
    const unjudged = unjudgedSeqs(entries)
    const judged = mine.filter((r) => !unjudged.has(Number(r.seq)))
    const unjudgedHere = mine.filter((r) => unjudged.has(Number(r.seq)))
    const openHere = judged.filter((r) => open.includes(Number(r.seq)))
    const closed = judged.length - openHere.length
    if (!judged.length) {
      return {
        key: k.key, label: k.label, total: 0, classTotal: total, closed: null, rows: mine,
        unjudgedSeqs: unjudgedHere.map((r) => Number(r.seq)), empty: false, note: 'not measured',
        source: 'all ' + total + ' line(s) of this class were excluded from the coverage question - '
          + 'nothing measured them, which is not the same as covering them',
      }
    }
    return {
      key: k.key, label: k.label, total: judged.length, classTotal: total, closed, rows: mine,
      empty: false, note: '',
      openSeqs: openHere.map((r) => Number(r.seq)),
      unjudgedSeqs: unjudgedHere.map((r) => Number(r.seq)),
      source: closed + ' of ' + judged.length + ' closed by at least one asset in this packet, measured by '
        + k.check.replace(/_/g, ' ') + ' across ' + measured + ' asset(s)'
        + (unjudgedHere.length ? ' (' + unjudgedHere.length + ' more not judged either way)' : ''),
    }
  })
}

/** Is one requirement row still open, per the cards above? Unknown stays unknown. */
export function requirementState(card, row) {
  if (!card || card.closed === null) return { state: 'unmeasured', tone: 'panel', label: 'not measured' }
  const seq = Number(row && row.seq)
  // A row the engine excluded from the coverage question is UNMEASURED. Falling through to the
  // green `closed` below is how three rows nothing looked at rendered as covered on this screen.
  if (arr(card.unjudgedSeqs).includes(seq)) return { state: 'unmeasured', tone: 'panel', label: 'not measured' }
  return arr(card.openSeqs).includes(seq)
    ? { state: 'open', tone: 'red', label: 'open' }
    : { state: 'closed', tone: 'green', label: 'closed' }
}

// ── step completion ─────────────────────────────────────────────────────────────────────────────

/**
 * Is the QC step done?
 *
 * GATE-DRIVEN, not visit-driven, and deliberately NOT the rule the asset steps use. `stepDone()` in
 * PacketBuilder.jsx marks an asset step complete from `artifact.status === 'approved'` - and every
 * historical approved artifact in this database has ZERO check rows, because approval predates the
 * checks engine. Copying that rule here would tick the QC step for packets nothing has ever checked,
 * which is the single most dangerous green this screen could show.
 *
 * Done requires, for EVERY asset: a gate row exists, it is not `fail`, and a `warn` already carries a
 * recorded override. That is approvalBlock() in api/src/functions/tests/appChecks.ts, restated as a
 * question about the whole packet rather than one artifact - the same rule, not a second opinion.
 */
export const NO_ASSETS_REASON = 'this packet has no assets to check'

export function qcStepState(entries) {
  const list = arr(entries)
  if (!list.length) return { done: false, reason: NO_ASSETS_REASON }
  const unchecked = list.filter((e) => railGate(e && e.result) === 'unchecked')
  if (unchecked.length) {
    return { done: false, reason: unchecked.length + ' asset(s) have never been checked - that is not a pass' }
  }
  // A fail still blocks the step UNLESS the server said advisory mode is on AND the owner has
  // recorded an override for it. An advisory fail with no override falls through to `undecided`
  // below, so the step reads "needs an explicit decision" rather than silently completing — the
  // step must never tick because a rule was relaxed, only because a human answered it.
  const failing = list.filter((e) => railGate(e.result) === 'fail'
    && !(e.result && e.result.advisory && e.result.override))
  if (failing.length) return { done: false, reason: failing.length + ' asset(s) have blocking findings' }
  const undecided = list.filter((e) => {
    const g = railGate(e.result)
    return (g === 'warn' || g === 'fail') && !(e.result && e.result.override)
  })
  if (undecided.length) {
    return { done: false, reason: undecided.length + ' asset(s) need an explicit decision with a reason' }
  }
  return { done: true, reason: 'every asset is clear, or its findings were accepted with a recorded reason' }
}

export function qcStepDone(entries) { return qcStepState(entries).done }

/**
 * SPEC 4.3-9/10/11 - what the keyword tally modal's QC summary says about itself.
 *
 * PURE, and it DERIVES NOTHING. No gate, no severity, no count, no arithmetic: every `result` is
 * handed to <GateBadge> exactly as the server sent it, and the score is read through railHeadline()
 * - the same selector the QC rail's own block reads. A second opinion about a gate rendered inches
 * from the first is how one screen comes to contradict another, and this modal sits on the JD step
 * where the reader cannot see the rail to compare.
 *
 * `scored` is the ONE entry whose artifact_score is rendered. The CALLER picks it (PacketBuilder
 * already computes it as the resume entry) and passes its type, so this module holds no second
 * hardcoded artifact-type list and the packet never acquires a composite of its own: `artifact_score`
 * is per artifact, and averaging four of them would be exactly the fabricated composite
 * computeArtifactScore refuses to produce.
 *
 * SIX states, and they are six different sentences, because they are six different claims:
 *   no_assets         nothing has been built - not a pass, and not "unscored"
 *   no_scored_asset   assets exist, but the one this block scores is not among them
 *   unreadable        its checks payload could not be read - an absence of evidence, reported
 *   reading           the payload is still in flight
 *   not_scored        the payload arrived with NO score row at all (TODAY'S LIVE STATE: every
 *                     artifact in docs/qc-evidence/fixtures.json has `score: null`)
 *   scored            a score row exists; railHeadline() decides whether it has a composite
 * `not_scored` and a stored row whose `composite` is null are NOT the same claim, and printing one
 * sentence for both would report "no overall number was stored for this run" for an asset no run
 * ever touched.
 */
export function qcSummaryModel(entries, { scored = null, scoredType = null } = {}) {
  const list = arr(entries)
  const subject = assetLabel(scoredType)
  const lower = subject.toLowerCase()
  // The rows are the packet's REAL artifacts, in the order the packet lists them - never a fixed
  // type list, which would draw gate rows for assets this packet does not have.
  const rows = list.map((e) => ({
    artifactId: e.artifactId || (e.artifact && e.artifact.id) || null,
    type: e.type || (e.artifact && e.artifact.type) || null,
    label: e.label || assetLabel(e.type || (e.artifact && e.artifact.type)),
    result: e.result || null,
    loading: !!e.resultLoading,
    error: e.resultError || null,
    // SPEC 4.4-14 in the tally modal. Carried ON THE ROW rather than derived in the component,
    // because <QcSummaryBlock> derives nothing by design - every sentence, row and score it shows
    // comes from here, so a number or a target computed there would be a second opinion the reader
    // could not reconcile. NULL when the asset has no openable field, and the component must then
    // render no click at all rather than one that goes nowhere.
    fixTarget: firstFixTarget(list, e.artifactId || (e.artifact && e.artifact.id) || null),
  }))
  // AC B.8, and it is the same sentence the rail prints for the same reason.
  const scope = subject + ' only - there is no packet-wide score, and averaging the assets would invent one'
  const base = { subject, rows, scope, score: null, headline: null }
  if (!list.length) {
    return {
      ...base, state: 'no_assets', rows: [], scope: null,
      sentence: 'Nothing has been built yet, so ' + NO_ASSETS_REASON + '.',
      detail: 'There is no gate and no score because there is nothing to check. That is not a pass.',
    }
  }
  if (!scored) {
    return {
      ...base, state: 'no_scored_asset',
      sentence: 'No ' + lower + ' has been built for this packet, so there is no score to show.',
      detail: 'The assets that do exist are listed below with their own gate. None of their scores stands in for the ' + lower + '.',
    }
  }
  if (scored.resultError) {
    return {
      ...base, state: 'unreadable',
      sentence: 'The checks for the ' + lower + ' could not be read, so no score is shown.',
      detail: 'The server said: ' + String(scored.resultError) + '. An unread payload is an absence, not a pass.',
    }
  }
  if (!scored.result) {
    return {
      ...base, state: scored.resultLoading ? 'reading' : 'not_scored',
      sentence: scored.resultLoading
        ? 'Reading the score for the ' + lower + '...'
        : 'No score has been computed for the ' + lower + ' yet.',
      detail: scored.resultLoading
        ? 'Nothing is claimed until it arrives.'
        : 'The checks have not been run for it, so there is no score row to read. That is an absence, not a zero.',
    }
  }
  const score = scored.result.score || null
  if (!score) {
    return {
      ...base, state: 'not_scored',
      sentence: 'No score has been computed for the ' + lower + ' yet.',
      detail: 'The checks ran but stored no score row for it, so there is nothing to read. That is an absence, not a zero.',
    }
  }
  return {
    ...base, state: 'scored', score, headline: railHeadline(score),
    sentence: 'The match score for the ' + lower + '.',
    detail: 'Measured by the checks engine and stored on the artifact, not estimated by a model.',
  }
}

/** The gate that colours the step circle: the worst state any asset is in. */
export function packetGate(entries) {
  const list = arr(entries)
  if (!list.length) return 'unchecked'
  const gates = list.map((e) => railGate(e && e.result))
  if (gates.includes('fail')) return 'fail'
  if (gates.includes('unchecked')) return 'unchecked'
  if (gates.includes('warn')) return 'warn'
  return 'pass'
}

/**
 * Every item that BLOCKS sending, across the whole packet, one row each.
 *
 * SPEC 4.10 asks the send step for "n items to fix across m assets" and a row per failing item with
 * a way to reach it. Everything needed was already imported into the screen that renders it - the
 * step simply never asked. This is the asking, in ONE place, so the card, the rows and the count
 * cannot disagree about what is blocking.
 *
 * DETERMINISTIC ROWS ONLY, and that is not a simplification. `railCounts` states the rule this
 * follows: a reviewer `fail` counts in toReview and NEVER in toFix, because only deterministic rows
 * can fail an artifact (decision D6). Folding a reviewer flag in here would tell the reader they are
 * blocked by something that cannot block them - and this list is specifically the answer to "what is
 * stopping me sending".
 *
 * `unchecked` is NOT absent from this list. An asset whose checks never ran cannot be shown as
 * clear: that is the absent-evidence-is-not-a-pass rule, and on this step it is the difference
 * between "nothing is wrong" and "nobody looked".
 */
export function packetFailList(entries) {
  const items = []
  const assets = new Set()
  for (const e of arr(entries)) {
    const artifactId = e && (e.artifactId || e.id)
    const result = e && e.result
    if (!artifactId) continue
    if (railGate(result) === 'unchecked') {
      assets.add(artifactId)
      items.push({
        artifactId, type: e.type || null, check_key: null, mergeField: null,
        observed: 'The checks have not been run for this asset, so there is no verdict to show. That is not a pass.',
        unchecked: true,
      })
      continue
    }
    for (const r of allRows(result)) {
      if (!r || r.state !== 'fail' || r.engine === 'reviewer') continue
      assets.add(artifactId)
      items.push({
        artifactId, type: e.type || null, check_key: r.check_key,
        // THE FIELD IS RESOLVED FROM THE OFFENDERS, through `sectionIdForOffender` - the module's
        // ONE parse, the same one `offenderLinks`, `findingsByField` and `fieldSeverities` use.
        //
        // It read `CHECK_SUBJECT_FIELD[check_key] || null`, and that map holds exactly TWO keys
        // (`company_named`, `company_in_body`). So every finding on a resume - `skill_char_limit`,
        // `word_counts`, `whitespace`, all of them - produced `mergeField: null`, `firstFixTarget`
        // returned null for the whole asset, and `PacketBuilder.jsx:191` passed
        // `onClick={undefined}`. That is why RENDER-SWEEP.md's 4.4-14 row measured a badge reading
        // `Blocked | 70 to fix | 3 to review` with `getComputedStyle().cursor === "default"` whose
        // click moved nothing: not a missing handler - the handler was already wired at
        // `PacketBuilder.jsx:953` - but a target this function could never produce for it.
        //
        // `CHECK_SUBJECT_FIELD` is NOT dropped: it is the last branch of `sectionIdForOffender`
        // itself, so a check whose rule fixes its own subject still resolves, and it is kept here as
        // the explicit fallback for a failing row that sent NO offenders at all (which is the shape
        // every existing H-case in packetFailList.test.mjs is built on).
        mergeField: firstOffenderField(r) || CHECK_SUBJECT_FIELD[r.check_key] || null,
        observed: r.observed || '', offenders: arr(r.offenders), unchecked: false,
      })
    }
  }
  return { items, count: items.length, assets: assets.size }
}

/**
 * The first field a reader could actually be sent to for an artifact, or NULL when there is none.
 *
 * SPEC 4.4-14: the gate badge deep-links to the first failing field. `GateBadge` has carried the
 * whole affordance for a while - it takes `onClick` and, when given one, already renders
 * `role="button"`, `tabIndex={0}` and an Enter/Space handler - and all three of its mount sites
 * omitted it, so the badge was inert everywhere it appeared.
 *
 * BUILT ON `packetFailList` RATHER THAN BESIDE IT, so "what needs fixing" has one definition and one
 * ordering. A second walk over the rows here would be a parallel answer to the same question, and
 * the two would disagree the first time either changed - the failure this repo names as fixing one
 * consumer and missing the others.
 *
 * NULL IS THE POINT, not an edge case. `mergeField` is `CHECK_SUBJECT_FIELD[check_key] || null`, and
 * an UNCHECKED asset always has `mergeField: null` - it has no findings, so there is no field to
 * open. A badge wired to navigate nowhere is exactly the dead UI the standing rule forbids, so the
 * caller must treat null as "render the badge, give it no click" rather than as "navigate to
 * nothing". The send step already applies this shape (`f.mergeField && <button…>`).
 */
export function firstFixTarget(entries, artifactId) {
  const { items } = packetFailList(entries)
  for (const it of items) {
    if (artifactId && it.artifactId !== artifactId) continue
    // `unchecked` rows carry a null mergeField by construction, so this one test covers both the
    // never-checked asset and a failing check whose rule names no subject field.
    if (!it.mergeField) continue
    // NAMES THE FINDING IT ACTUALLY OPENS, and that pairing is the whole point of returning it here.
    //
    // The badge used to take its TITLE from `firstFixFinding(result)` and its DESTINATION from this
    // function, and the two select independently: `firstFixFinding` takes the first `fix` row
    // whatever its offenders say, while this one SKIPS every row with a null mergeField. Measured on
    // the live packet (RENDER-SWEEP-2.md, both assets): the badge read
    // `70 to fix - Skill lines fit the template ->` and landed on `RelevantBullets1`, because
    // `skill_char_limit` is exactly the check that correctly resolves no field. A control that names
    // one finding and opens another is a false statement about where the reader is going - the same
    // class as a swap row naming an "original" the owner never wrote.
    //
    // One selection now serves both. `checkLabel` is assetGate's own map, so the wording cannot
    // drift from the rail this link lands in.
    return {
      artifactId: it.artifactId, mergeField: it.mergeField,
      check_key: it.check_key || null, title: checkLabel(it.check_key),
    }
  }
  return null
}

/**
 * What the packet header may say about readiness - the WORD, and any contradiction behind it.
 *
 * Two independent facts meet in that header and nothing has ever compared them:
 *
 *   p.status        a STORED string ('ready' / 'sent' / ...), which is what renders "Ready to ship ✓"
 *   packetGate(...)  COMPUTED from the QC results now on screen
 *
 * They are not derived from each other, so they can disagree - a packet can carry status 'ready'
 * while its assets' checks say `fail`. Until now the computed gate reached the screen ONLY as
 * `railGateMeta(...).tone` on the QC step circle (PacketBuilder.jsx:843): a colour, on one step, with
 * no words. So the disagreement was not merely unreported, it was unreadable - invisible to a reader
 * who cannot distinguish the hues, and absent entirely from the six steps that are not QC.
 *
 * This REPORTS; it decides nothing. The gate still comes from the server and approval is still
 * refused server-side. It is the same stance reconcile() takes on the drawer: when two numbers that
 * should agree do not, say so rather than quietly rendering the friendlier one.
 */
const CLAIMS_READY = { ready: 'is marked ready to ship', sent: 'has already been sent' }

export function packetReadiness(status, entries) {
  const gate = packetGate(entries)
  const meta = railGateMeta({ gate })
  const claim = CLAIMS_READY[String(status || '')]
  // 'warn' is NOT a contradiction: a warn packet reaches ready legitimately, by an approval with a
  // recorded reason. Only an outright fail, or checks that never ran, contradict the claim.
  const contradicts = claim && (gate === 'fail' || gate === 'unchecked')
  return {
    gate,
    word: meta.word,
    tone: meta.tone,
    contradiction: contradicts
      ? 'This packet ' + claim + ', but its checks now read "' + meta.word.toLowerCase() +
        '" - ' + meta.blurb + '. The stored status and the current checks disagree; the checks are the newer fact.'
      : null,
  }
}

// ── remediation loops ───────────────────────────────────────────────────────────────────────────

/**
 * What the Remediation loops tab may honestly show.
 *
 * THE PREMISE THIS WAS BUILT ON STOPPED BEING TRUE, and the comment outlived it. It said "P3 IS NOT
 * BUILT. There is no remediation_loop table and no escalation table anywhere in api/src" — both
 * tables shipped, they are in SCHEMA_SQL and EXPECTED_TABLES, and four routes serve them
 * (`/remediate`, `/remediation`, `/escalation/{id}`, `/remediation-prefs`). What was actually missing
 * was a CALLER: `app/src/api.js` referenced none of them, so P3 was deployed and had executed ZERO
 * times in production (`D:remediation-never-ran`). The tab then told the owner the controller did not
 * exist, which is how a stale comment becomes a false statement in the product.
 *
 * So this model now takes the REAL loop ledger when the caller has fetched it, and falls back to
 * `insertion.loop` — the pass record every asset has — when it has not. The distinction is reported
 * rather than blurred: `source` says which one the numbers came from, because "no passes have run"
 * and "we did not ask" are different facts and only one of them is about the packet.
 */
export function loopsModel(entries) {
  const list = arr(entries)
  const assets = list.map((e) => {
    // The real ledger, when the caller fetched it. `passes` are `remediation_loop` rows; each has an
    // `n`, a halt reason and the requirements it closed or left open.
    const ledger = e && e.remediation && Array.isArray(e.remediation.passes) ? e.remediation.passes : null
    if (ledger) {
      const esc = arr(e.remediation.escalations)
      return {
        artifact_id: e && e.artifact && e.artifact.id,
        label: e && e.label,
        loading: !!(e && e.remediationLoading),
        error: (e && e.remediationError) || null,
        source: 'ledger',
        passes: ledger.length,
        loops: ledger.map((r) => Number(r.n)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b),
        // A pass that ran is remediation, whatever it closed — `n` counts from 1, so every ledger row
        // IS a second look. That is the difference from the fallback, where loop 0 is the first
        // generation and only loops above it mean anything was revisited.
        remediation: ledger.length,
        rewritten: ledger.reduce((a, r) => a + arr(r.closed).length, 0),
        outcome: e.remediation.outcome || null,
        halted: ledger.some((r) => r.halted),
        haltReason: (ledger.find((r) => r.halted) || {}).halt_reason || null,
        open: esc.filter((x) => x && x.state !== 'resolved').length,
        escalations: esc,
      }
    }
    const rows = arr(e && e.insertions && e.insertions.insertions)
    const loops = Array.from(new Set(rows.map((r) => Number(r.loop)).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b)
    const rewritten = rows.filter((r) => Number(r.loop) > 0 && r.before_text != null && r.after_text != null && r.before_text !== r.after_text)
    return {
      artifact_id: e && e.artifact && e.artifact.id,
      label: e && e.label,
      loading: !!(e && e.insertionsLoading),
      error: (e && e.insertionsError) || null,
      source: 'insertions',
      passes: loops.length,
      loops,
      remediation: loops.filter((n) => n > 0).length,
      rewritten: rewritten.length,
      outcome: null, halted: false, haltReason: null, open: 0, escalations: [],
    }
  })
  const remediation = assets.reduce((a, x) => a + x.remediation, 0)
  // Which source the NUMBERS came from. Mixed is reported as the weaker one: if any asset fell back,
  // the total is not a ledger total, and calling it one would be the more confident of two readings.
  const fromLedger = assets.length > 0 && assets.every((a) => a.source === 'ledger')
  const openEscalations = assets.reduce((a, x) => a + (x.open || 0), 0)
  return {
    assets,
    remediation,
    openEscalations,
    anyLoaded: assets.some((a) => !a.loading && !a.error),
    source: fromLedger ? 'ledger' : 'insertions',
    note: fromLedger
      ? 'Each pass below is a real remediation run: what it closed, what it left open, and why it '
        + 'stopped. Anything the loop could not close is escalated to you rather than retried forever.'
      : 'The remediation ledger has not been loaded for these assets, so this falls back to the pass '
        + 'record every asset has - insertion.loop, incremented once per regeneration. A loop count of '
        + 'one means the asset was generated once and never revisited. This is not the same as saying '
        + 'no remediation has run.',
    empty: remediation === 0,
    emptyText: fromLedger
      ? 'No remediation pass has run on this packet yet.'
      : 'No asset in this packet has been through a second pass, so nothing has been remediated yet.',
  }
}

// ── small shared helpers ────────────────────────────────────────────────────────────────────────

export { arr }
export const errText = (e) => String((e && e.message) || e)

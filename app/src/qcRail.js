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
import { engineRows, scoreParts, gateMeta, stateMeta, arr } from './assetGate.js'

export { engineRows, scoreParts, gateMeta, stateMeta }

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
  for (const e of list) {
    const result = e && e.result
    if (railGate(result) === 'unchecked') { unchecked += 1; continue }
    checked += 1
    const c = railCounts(result)
    toFix += c.toFix
    toReview += c.toReview
  }
  return { toFix, toReview, unchecked, checked, assets: list.length }
}

/**
 * Ordering weight for a finding. Higher sorts first.
 *
 * A reviewer `fail` MUST weigh less than a deterministic `fail` (D6): one is a measured fact about
 * the text that blocks the artifact, the other is a model's opinion that can never block it. Ranking
 * them equally puts an opinion at the top of a list of blockers.
 *
 * `not_applicable` outranks `pass` because it is an open question - something could not be checked -
 * while a pass is settled. It still counts toward NEITHER number above.
 */
export function severityWeight(row) {
  const engine = row && row.engine === 'reviewer' ? 'reviewer' : 'deterministic'
  const state = row && row.state
  if (state === 'fail') return engine === 'reviewer' ? 50 : 100
  if (state === 'warn') return engine === 'reviewer' ? 40 : 60
  if (state === 'not_applicable') return 10
  return 0
}

/** Findings ordered by what a reader must act on first. Stable within a weight. */
export function bySeverity(rows) {
  return arr(rows)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (severityWeight(b.r) - severityWeight(a.r)) || (a.i - b.i))
    .map((x) => x.r)
}

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

/** The swap decisions that cite a given requirement id. */
export function swapsForRequirement(swaps, requirementId) {
  const rows = arr(swaps && swaps.swaps)
  return requirementId ? rows.filter((s) => s && s.requirement_id === requirementId) : rows
}

/** A 0-100 value as a bar width, clamped. Never NaN, never negative, never over 100. */
export function pctWidth(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0%'
  return Math.max(0, Math.min(100, n)) + '%'
}

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
export function qcStepState(entries) {
  const list = arr(entries)
  if (!list.length) return { done: false, reason: 'this packet has no assets to check' }
  const unchecked = list.filter((e) => railGate(e && e.result) === 'unchecked')
  if (unchecked.length) {
    return { done: false, reason: unchecked.length + ' asset(s) have never been checked - that is not a pass' }
  }
  const failing = list.filter((e) => railGate(e.result) === 'fail')
  if (failing.length) return { done: false, reason: failing.length + ' asset(s) have blocking findings' }
  const undecided = list.filter((e) => railGate(e.result) === 'warn' && !(e.result && e.result.override))
  if (undecided.length) {
    return { done: false, reason: undecided.length + ' asset(s) need an explicit decision with a reason' }
  }
  return { done: true, reason: 'every asset is clear, or its findings were accepted with a recorded reason' }
}

export function qcStepDone(entries) { return qcStepState(entries).done }

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

// ── remediation loops ───────────────────────────────────────────────────────────────────────────

/**
 * What the Remediation loops tab may honestly show.
 *
 * P3 IS NOT BUILT. There is no `remediation_loop` table and no `escalation` table anywhere in
 * api/src - the loop controller that would write `n / ran_at / closed[] / remaining[] / halted` does
 * not exist. So this tab is wired to the ONE real record of passes that does exist: `insertion.loop`,
 * which writeInsertions() increments each time an artifact is regenerated.
 *
 * That is a REAL (usually empty) query, not a fixture. Every asset in the live database sits at loop
 * 0 - one generation, no remediation - and this returns exactly that, with the reason it is not more.
 * Rendering an invented loop log here would be dead UI dressed as evidence.
 */
export function loopsModel(entries) {
  const list = arr(entries)
  const assets = list.map((e) => {
    const rows = arr(e && e.insertions && e.insertions.insertions)
    const loops = Array.from(new Set(rows.map((r) => Number(r.loop)).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b)
    const rewritten = rows.filter((r) => Number(r.loop) > 0 && r.before_text != null && r.after_text != null && r.before_text !== r.after_text)
    return {
      artifact_id: e && e.artifact && e.artifact.id,
      label: e && e.label,
      loading: !!(e && e.insertionsLoading),
      error: (e && e.insertionsError) || null,
      passes: loops.length,
      loops,
      remediation: loops.filter((n) => n > 0).length,
      rewritten: rewritten.length,
    }
  })
  const remediation = assets.reduce((a, x) => a + x.remediation, 0)
  return {
    assets,
    remediation,
    anyLoaded: assets.some((a) => !a.loading && !a.error),
    note: 'The remediation loop controller (backlog P3.1) is not built: there is no remediation_loop '
      + 'table and no escalation table in the API, so there is no loop log to read. What is shown is '
      + 'the real pass record every asset does have - insertion.loop, incremented once per '
      + 'regeneration. A loop count of one means the asset was generated once and never revisited.',
    empty: remediation === 0,
    emptyText: 'No asset in this packet has been through a second pass, so nothing has been remediated yet.',
  }
}

// ── small shared helpers ────────────────────────────────────────────────────────────────────────

export { arr }
export const errText = (e) => String((e && e.message) || e)

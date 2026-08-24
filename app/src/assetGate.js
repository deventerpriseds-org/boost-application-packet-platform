// Pure logic for the per-asset gate drawer (the component lives in screens/AssetGateDrawer.jsx).
//
// It sits in a plain .js module for the same ONE reason overlay.js does: Node's built-in test runner
// can import it with no DOM and no new dependency, so the rules below can be PROVEN rather than
// eyeballed. Nothing here touches window/document — anything that does stays in the component.
//
// The rules being proven are the two the whole feature exists to keep:
//   1. the badge count, the gate word and the footer action all read ONE server payload;
//   2. `not_applicable` is never folded into a pass, and a composite is never fabricated.

/**
 * Every `data-qc` selector the gate drawer renders.
 *
 * ui-verify.yml (scripts/ui-verify.mjs) selects by CSS ONLY - COUNT_SEL, CLICK_SEL and MEASURE_SEL
 * are raw selectors handed to `document.querySelector`. A surface with no stable hook is therefore
 * unprovable on the live site by anything except matching body TEXT, which breaks on a copy edit
 * and can never distinguish two surfaces that say the same words. This drawer had ZERO hooks while
 * PostingAnalysis.jsx had 24, so P8.5's deep link and P5.3's badge/gate agreement were only ever
 * assertable by prose.
 *
 * This is the same constant QC_HOOKS (qcRail.js) is, for the same reason and with the same rule:
 * the component renders NO hand-typed `data-qc` string, so the verifier's selector and the DOM
 * cannot drift apart. app/test/assetGate.test.mjs holds both halves to it.
 */
export const GATE_HOOKS = {
  drawer: 'gate-drawer',               // the drawer root (also carries data-qc-tab)
  badge: 'gate-badge',                 // the gate pill group, header and card alike
  gate: 'gate-word',                   // the gate word itself
  toFix: 'gate-to-fix',                // findings from the measured rules
  toReview: 'gate-to-review',          // findings from the independent reviewer - never added to toFix
  summary: 'gate-summary',             // the one reconciled strip shown above every tab
  disagreement: 'gate-disagreement',   // reconcile(): the server's own numbers do not agree
  exception: 'gate-exception',         // a recorded override
  tab: 'gate-tab',
  panel: 'gate-tabpanel',
  block: 'gate-block',                 // one merge field on the Blocks tab (carries data-qc-field)
  check: 'gate-check',                 // one check row (carries data-qc-state)
  quote: 'gate-posting-quote',         // the posting's own words echoed onto an asset
  runChecks: 'gate-run-checks',
  approve: 'gate-approve',
  reason: 'gate-reason',               // the exception textarea
}

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

/**
 * SEVERITY - what a finding means for the READER, which is not the same as its raw state.
 *
 * The words are the prototype's (`docs/qc-evidence/qc/data.js` SEV_LABEL) and the guard reads them
 * out of that file, so they cannot drift from the design without the suite saying so.
 *
 * This EXTENDS STATE_META rather than replacing it: pass / not_applicable have no severity and fall
 * through to their existing words. What severity adds is the ENGINE, and it adds it because the
 * state alone misstates the case. Decision D6 (qcRail.js railCounts) says only a deterministic row
 * can fail an artifact - a reviewer `fail` may never block on its own, and reconcile() reports it as
 * a contradiction when the gate acts as though it did. Yet STATE_META maps every `fail` to
 * 'Must fix' in red, so the drawer has been telling the reader they are blocked by exactly the row
 * that cannot block them. 'Your call' is what D6 already decided; this is naming it, not deciding it.
 *
 * `open` ('Needs your answer') is deliberately ABSENT. In the prototype it comes from OPEN_ITEMS - a
 * separate list of questions each carrying its own `ask` - and the app has no such source. Minting it
 * from a state we do have would be inventing a bucket, which is the one thing a label may not do.
 */
export const SEV_LABEL = {
  fix: 'Fix before approval',
  review: 'Review',
  soft: 'Your call',
  fixed: 'Corrected for you',
}
export const SEV_TONE = { fix: 'red', review: 'yellow', soft: 'panel', fixed: 'green' }

/** fail|warn + engine -> severity key, or null for a row that needs no attention. */
export function severityFor(row) {
  if (!row) return null
  if (row.state === 'warn') return 'review'
  if (row.state !== 'fail') return null
  return row.engine === 'reviewer' ? 'soft' : 'fix'
}

/**
 * How many findings sit in each severity bucket — the counts the prototype keeps on the collapsed
 * "What this X answers" row (`qc/assets.jsx:218-221`: `N corrected`, `N to fix`, `N to review`,
 * `N your call`).
 *
 * Built on `severityFor`, NOT on a second reading of state+engine. That split is the one D6 rests
 * on — a reviewer `fail` may never block — and a header that re-derived it would be free to
 * disagree with the rail below it about how many things block this asset.
 *
 * `pass` and `not_applicable` fall out entirely: severityFor returns null for both, and a header
 * that counted them would be reporting settled rows as work.
 */
export function severityCounts(result) {
  const out = { fix: 0, review: 0, soft: 0 }
  for (const r of [...engineRows(result, 'deterministic'), ...engineRows(result, 'reviewer')]) {
    const sev = severityFor(r)
    if (sev && out[sev] !== undefined) out[sev] += 1
  }
  return out
}

/** The words and tone for ONE finding row. Falls back to STATE_META where there is no severity. */
export function severityMeta(row) {
  const sev = severityFor(row)
  if (!sev) return stateMeta(row && row.state)
  return { tone: SEV_TONE[sev], label: SEV_LABEL[sev], sev }
}

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
  // C6 moved this number's meaning and the label did not follow. It counts must-haves your PROFILE
  // can evidence with a quote — not must-haves the document happens to repeat, which is what the
  // old wording promised and what the pre-C6 numerator actually measured. A label that describes
  // the previous definition is worse than no label: the number is right and the sentence next to
  // it is wrong, so a reader trusts the wrong one.
  must_have_coverage: 'Must-haves your profile can evidence',
  responsibilities_addressed: 'Responsibilities addressed',
  changes_cited: 'Every change cites the posting',
  omission_list: 'Nothing you asked to omit appears',
  template_reach: 'Requirements no block can carry',
  // The prototype's own heading for this finding, read off `docs/qc-evidence/qc/assets.jsx:124`.
  // Without an entry it degraded to "posting wording kept", which reads as an accusation; the
  // design's wording says what it is - wording the ad used that your draft kept, for you to judge.
  posting_wording_kept: 'Wording kept from the posting',
  facts_settled: 'Facts you confirmed are used',
  facts_needed: 'Facts still needed',
  fact_shortfall: 'A confirmed fact falls short',
}
export const checkLabel = (k) => CHECK_LABEL[k] || String(k || '').replace(/_/g, ' ')

// Merge field -> plain language. Same degrade-to-the-key rule.
//
// THE DESIGN'S WORDING, not a description of the column. Read off the rendered prototype
// 2026-08-23: it heads the fields "Resume summary", "Skills 1", "Relevant 1", "Expertise", and
// writes corrections as '"sixty engineers" rewritten as "sixty-two engineers" in Resume summary'.
// The previous values ("Summary", "Skills, column 1", "Relevant experience, role 1") explained the
// column to a developer; these name it the way the document does.
//
// ONE table, so the field heading, the QC correction sentence, the gate drawer and the deep-link
// tooltip all say the same words. Changing it here changed all four - which is the point, and the
// reason two tests that pinned the old strings were updated with it rather than around it.
export const FIELD_LABEL = {
  ResumeSummary: 'Resume summary',
  SkillsBullets1: 'Skills 1',
  SkillsBullets2: 'Skills 2',
  ExpertiseBullets: 'Expertise',
  RelevantBullets1: 'Relevant 1',
  RelevantBullets2: 'Relevant 2',
  RelevantBullets3: 'Relevant 3',
  // Cover letter and portfolio. The '@' names are template slots; these are what the document
  // calls them (rendered prototype: "Letter body", "About me 1", "About me 2").
  '@Company': 'Company',
  '@CoverLetterDate': 'Date',
  '@CoverLetterBody': 'Letter body',
  '@AboutMe1_50words': 'About me 1',
  '@AboutMe2_60words': 'About me 2',
  '@ExecutiveProfile_55words': 'Executive profile',
  '@CoreAccomplishments_5blts_180words': 'Core accomplishments',
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
  // ADVISORY MODE. `result.advisory` is the SERVER's boolean, published beside the gate for exactly
  // the reason stated above — this function must not form its own opinion by reading settings. A
  // fail is still a fail and still says so; what changes is that the owner may accept it on the
  // record instead of being stuck. The wording keeps mirroring approvalBlock()'s 409 body.
  if (gate === 'fail' && result.advisory) {
    return result.override
      ? { kind: 'fail_overridden', label: 'Approve with exceptions', disabled: false, headline: 'Blocking findings accepted',
          reason: result.override.by + ' accepted ' + n + ' blocking finding(s): ' + result.override.reason }
      : { kind: 'fail_advisory', label: 'Approve with exceptions', disabled: false, needsReason: true, headline: 'Blocking findings',
          reason: n + ' blocking finding(s); advisory mode is on, so this needs an explicit override with a reason' }
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
  const split = attentionSplit(result)
  const out = []
  if (split.listed !== split.counted) {
    out.push('the server counted ' + result.attention + ' finding(s) needing attention but sent ' + split.listed + ' such row(s)')
  }
  if (result.gate === 'pass' && split.counted > 0) {
    out.push('the gate reads pass while ' + result.attention + ' finding(s) still need attention')
  }
  const reviewerFail = engineRows(result, 'reviewer').some((r) => r.state === 'fail')
  const deterministicFail = engineRows(result, 'deterministic').some((r) => r.state === 'fail')
  if (result.gate === 'fail' && reviewerFail && !deterministicFail) {
    out.push('the only failing rows come from the independent reviewer, which may never block an asset on its own')
  }
  return out.length ? out : null
}

/**
 * The rows belonging to ONE engine, taken from the SERVER's own grouping whenever it sends one.
 *
 * P4.2 made `engines.deterministic.results` / `engines.reviewer.results` a top-level part of
 * GET /artifact/{id}/checks-result exactly so a client stops re-partitioning a set the server has
 * already split. Two clients partitioning independently is how one screen comes to show a model's
 * opinion as a measured rule and another does not.
 *
 * The `results`-filter branch is a FALLBACK for a server that predates P4 (the flat payload with no
 * `engines` key), not a second opinion: it only runs when the key is absent. In that branch
 * `deterministic` is deliberately "everything that is not the reviewer" rather than
 * `engine === 'deterministic'`, so a row from an engine added later is still shown somewhere
 * instead of silently vanishing from both tabs.
 */
export function engineRows(result, engine) {
  const grouped = result && result.engines && result.engines[engine]
  if (grouped && Array.isArray(grouped.results)) return grouped.results
  const rows = Array.isArray(result && result.results) ? result.results : []
  return engine === 'reviewer'
    ? rows.filter((r) => r.engine === 'reviewer')
    : rows.filter((r) => r.engine !== 'reviewer')
}

const needsAttention = (r) => r.state === 'fail' || r.state === 'warn'

/**
 * THE one split of the findings into rules-side and reviewer-side. Every surface that shows either
 * half - the badge, the drawer summary, the Checks tab - reads it from here.
 *
 * Both halves are COUNTED from their own rows. Neither is ever derived by subtracting the other
 * from `attention`, which is what produced a rendered "-2 from the measured rules": the server's
 * `attention` and the rows it sent can genuinely disagree, and subtraction turns that disagreement
 * into a negative finding count instead of reporting it. A count of rows cannot go below zero, so
 * the clamp is structural rather than a Math.max bolted on afterwards, and `fix + review === listed`
 * holds for every payload.
 *
 * `counted` is the server's own `attention` number, carried alongside rather than mixed in, so a
 * caller that wants the server's figure asks for it explicitly. When `counted !== listed` the
 * payload contradicts itself and reconcile() says so - nothing here quietly picks a winner.
 */
export function attentionSplit(result) {
  const fix = engineRows(result, 'deterministic').filter(needsAttention).length
  const review = engineRows(result, 'reviewer').filter(needsAttention).length
  return { fix, review, listed: fix + review, counted: Number((result && result.attention) || 0) }
}

/** How many of the listed findings came from the reviewer rather than the rules. */
export function reviewerAttention(result) {
  return attentionSplit(result).review
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
    { key: 'must', label: 'Must-haves evidenced', value: score.must_have_coverage, source: score.must_have_source },
    { key: 'kw', label: 'Keywords present', value: score.keyword_coverage, source: score.keyword_source },
    { key: 'sen', label: 'Seniority fit', value: score.seniority_alignment, source: score.seniority_source },
  ]
}

export const fmtWhen = (v) => { if (!v) return 'never'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString() }
export const arr = (v) => (Array.isArray(v) ? v : [])
export const errText = (e) => String((e && e.message) || e)

// ── P8.6 / P8.1 R1: the change log ───────────────────────────────────────────────────────────────
//
// R1 says the user reviews a CHANGE LOG, not a to-do list: anything the engine could fix it fixed
// before the user saw it, and it records the fix. This half is the reading of that record.
//
// THE CONTRACT THIS RENDERS, and where it comes from. `correction.ts` on the P8.1 branch is the
// pure engine: it plans corrections, applies them right-to-left so every stored offset stays
// relative to the ORIGINAL field text, and reverts by replaying the list minus one row. A row
// carries `merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq,
// reason, source`. The wire shape this module expects is that row plus the database `id` the revert
// route needs, and `reverted_by` / `reverted_at` once it has been undone:
//
//     GET  /api/app/artifact/{id}/checks-result   ->  { ..., corrections?: Correction[] }
//     POST /api/app/correction/{correctionId}/revert  ->  { ok: true, text } | { ok: false, reason }
//
// `corrections` IS AN ARRAY OR IT IS ABSENT. There is no object form and no envelope, because the
// four states below have to stay four states, and every extra shape is another way for two of them
// to collapse into one.
//
// THE ONE THING THIS MODULE EXISTS TO GET RIGHT: **absent is not empty.** `checks-result` carries no
// `corrections` key today - not on main and not on the API branch - so `undefined` is the only value
// this code will see until that lane merges. Rendering it as "nothing needed correcting" would tell
// every user, on every artifact, that their text was audited and found clean by an audit that never
// ran. That is P8.1 AC-14's vacuous green moved from the engine onto the screen, and it is the same
// rule the rest of this file already keeps: absent evidence is `not_applicable`, never `pass`.
//
// The trap is mechanical rather than conceptual. `arr()` two lines above is
// `Array.isArray(v) ? v : []`, it is what every neighbouring line does to a list, and it maps
// `undefined`, `null`, `7` and `[]` to the same value. So `corrections` is NEVER passed through it:
// the kind is decided from the raw property first, and only a value already proven to be an array
// is read as a list.

/** The revert route this module's undo names. Stated once so the client and the API can be diffed. */
export const CORRECTION_REVERT_ROUTE = '/app/correction/{correctionId}/revert'

/**
 * Where a replacement came from, in the user's words.
 *
 * An unrecognised value falls through to ITSELF rather than to either known one - the assetLabel
 * rule. Defaulting an unknown source to `generalized` would tell a reader a number was invented when
 * the server said it came from their profile, or the exact reverse; both are worse than showing the
 * raw word and letting them ask.
 */
export const CORRECTION_SOURCE = {
  generalized: 'generalised, because your profile does not evidence a figure of your own',
  profile_figure: 'taken from your own profile',
}
export const correctionSourceText = (s) => CORRECTION_SOURCE[s] || String(s || 'no source was recorded')

/** Finished framing (R1). These are the words the change log is allowed to use about itself. */
export const CHANGE_LOG_HEADLINE = 'Done for you'

/**
 * The four states a change log can be in, decided from the RAW payload key.
 *
 * unchecked  the checks never ran, so no run could have reported corrections
 * absent     the run reported, and said nothing about corrections at all
 * malformed  `corrections` arrived as something that is not a list
 * empty      the run reported a change log and it is empty - nothing needed correcting
 * ok         rows
 *
 * Only `empty` and `ok` may print a number. `absent` printing 0 would be the reviewer's
 * "0 disagreements" bug: a measurement reported that was never taken.
 */
export function correctionsState(result) {
  if (!result || result.gate == null) {
    return correctionsShape('unchecked', [],
      'The checks have not been run for this asset, so there is no change log. That is not the same as nothing needing correction.')
  }
  // The raw key, before anything can normalise it away.
  const raw = result.corrections
  if (raw === undefined) {
    return correctionsShape('absent', [],
      'This run reported no change log, so nothing here says whether any figure was rewritten for you. '
      + 'That is not the same as nothing needing correction - it means this build of the API did not answer the question.')
  }
  if (!Array.isArray(raw)) {
    const t = raw === null ? 'null' : typeof raw
    return correctionsShape('malformed', [],
      'The run sent a change log that is not a list - it arrived as ' + t + ' - so it cannot be read. No number is shown for it.',
      t)
  }
  if (!raw.length) {
    return correctionsShape('empty', [],
      'Nothing needed correcting: this run reported a change log and it is empty.')
  }
  const rows = orderCorrections(raw)
  const undone = rows.filter((r) => r.undone).length
  const corrected = rows.length - undone
  // correctionsShape counts the rows; nothing here recounts them. `corrected` and `undone` are read
  // back out of the shape below rather than computed twice, so the sentence and the number cannot
  // disagree - the same rule the gate keeps with `attention`.
  const shape = correctionsShape('ok', rows,
    corrected + ' change(s) already applied to your text' + (undone ? ', and ' + undone + ' you have undone' : '')
    + '. Change or revert any of them.')
  shape.anomalies = correctionAnomalies(rows)
  return shape
}

function correctionsShape(kind, rows, body, observedType = '') {
  const measured = kind === 'ok' || kind === 'empty'
  return {
    kind,
    hasNumber: measured,
    count: measured ? rows.filter((r) => !r.undone).length : null,
    undone: measured ? rows.filter((r) => r.undone).length : null,
    listed: measured ? rows.length : null,
    rows,
    anomalies: [],
    headline: CHANGE_LOG_HEADLINE,
    body,
    observedType,
  }
}

/**
 * Rows in DOCUMENT order, which is what `applied_seq` means.
 *
 * `planCorrections` numbers rows ascending by `char_start` precisely "so a change log reads in
 * document order for a human", so ordering by `applied_seq` is reading the server's own ordering
 * rather than inventing one. A row with no usable seq keeps its payload position instead of sorting
 * to an arbitrary end, and `correctionAnomalies` reports it - a silently reordered log is a log a
 * reader cannot check against the document in front of them.
 *
 * Stable within an equal weight, the bySeverity rule, so two renders of one payload are identical.
 */
export function orderCorrections(rows) {
  return arr(rows)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const as = Number(a.r && a.r.applied_seq)
      const bs = Number(b.r && b.r.applied_seq)
      const ao = Number.isFinite(as) ? as : Number.POSITIVE_INFINITY
      const bo = Number.isFinite(bs) ? bs : Number.POSITIVE_INFINITY
      return (ao - bo) || (a.i - b.i)
    })
    .map((x, n) => correctionRow(x.r, n))
}

/** One row, everything the screen needs, nothing the screen has to work out for itself. */
export function correctionRow(row, index) {
  const r = row || {}
  const seq = Number(r.applied_seq)
  const seqKnown = Number.isFinite(seq)
  const field = String(r.merge_field || '')
  const phrase = String(r.phrase == null ? '' : r.phrase)
  const replacement = String(r.replacement == null ? '' : r.replacement)
  const undone = !!(r.reverted_at || r.reverted_by)
  return {
    key: (r.id ? String(r.id) : 'seq') + ':' + (seqKnown ? seq : 'n' + index),
    id: typeof r.id === 'string' && r.id ? r.id : null,
    seq: seqKnown ? seq : null,
    seqKnown,
    merge_field: field,
    fieldName: fieldLabel(field),
    phrase,
    replacement,
    reason: String(r.reason == null ? '' : r.reason),
    source: String(r.source == null ? '' : r.source),
    sourceText: correctionSourceText(r.source),
    undone,
    undoneBy: r.reverted_by || null,
    undoneAt: r.reverted_at || null,
    sentence: correctionSentence({ phrase, replacement, fieldName: fieldLabel(field), undone }),
  }
}

/**
 * The row's own sentence, in finished framing - "Corrected", never "needs fixing".
 *
 * An undone row keeps its place in the log and says what it now reads, because SPEC 5 asks the
 * revert to flip the row to Undone rather than remove it: a revert that deletes the row deletes the
 * record that the change was ever made, which is the one thing a change log is for.
 */
export function correctionSentence({ phrase, replacement, fieldName, undone }) {
  const where = fieldName ? ' in ' + fieldName : ''
  return undone
    ? 'Undone: "' + replacement + '" is back to "' + phrase + '"' + where + '.'
    : 'Corrected: "' + phrase + '" rewritten as "' + replacement + '"' + where + '.'
}

/**
 * Anomalies in the ordering key, REPORTED rather than smoothed over.
 *
 * Two rows sharing an `applied_seq`, or a row without one, means the record of what was applied to
 * one field is not a total order - and the revert replays that order. Saying so beside the log is
 * how a reader learns the record is imperfect; hiding it is how they learn it after an undo lands
 * in the wrong place.
 */
export function correctionAnomalies(rows) {
  const list = arr(rows)
  const out = []
  const missing = list.filter((r) => !r.seqKnown).length
  if (missing) out.push(missing + ' change(s) carry no position in the field, so they are listed where the run sent them')
  const seen = new Map()
  for (const r of list) if (r.seqKnown) seen.set(r.seq, (seen.get(r.seq) || 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  if (dupes.length) out.push('two or more changes share position ' + dupes.join(', ') + ' in their field, so their order here is the order the run sent them')
  return out
}

/**
 * May this row be undone, and if not, WHY not.
 *
 * NO DEAD UI. The revert route names a correction by its database id, so a row that carries no id
 * cannot be the subject of a real request - and a button that cannot make a request is a button that
 * teaches the reader the trail is broken. The control is not rendered in that case and this sentence
 * is rendered instead. When the API lane ships rows with ids the control appears on real data, with
 * no change here.
 */
export function undoAvailability(row) {
  if (!row) return { can: false, reason: 'there is no change to undo' }
  if (row.undone) {
    return { can: false, reason: 'this change was already undone' + (row.undoneBy ? ' by ' + row.undoneBy : '') }
  }
  if (!row.id) {
    return { can: false,
      reason: 'this change log was sent without an identifier for this row, so there is nothing for an undo to name - '
        + 'the build of the API that sent it cannot revert a correction yet' }
  }
  return { can: true, reason: '' }
}

/**
 * The outcome of an undo, decided by `ok` and NOTHING else.
 *
 * `revertOne` answers `{ok:true, text}` or `{ok:false, reason}`, and a correction can legitimately
 * revert a field back to the empty string - so branching on `res.text` reports a phantom refusal,
 * with no reason attached, for a revert that actually succeeded.
 *
 * A REFUSAL IS A REAL STATE, not an error to swallow. `revertOne` declines when the recovered
 * original does not hash to `before_sha256`, which means somebody edited that field after the
 * correction was applied and the original can no longer be restored safely. That is the server
 * telling the user something true about their own document, and it is rendered in the server's own
 * words beside the row it concerns.
 */
export function revertOutcome(res) {
  if (!res || typeof res !== 'object') {
    return { ok: false, reason: 'the server sent no answer to the undo, so nothing about this change has been established' }
  }
  if (res.ok === true) return { ok: true, text: typeof res.text === 'string' ? res.text : null, reason: '' }
  const stated = [res.reason, res.error].find((v) => typeof v === 'string' && v.trim())
  return { ok: false, reason: stated ? String(stated).trim() : 'the server refused the undo without stating a reason' }
}

/**
 * "Suggest something different", scoped to ONE merge field (R6, SPEC 4.7).
 *
 * It EXTENDS the ai-edit path the resume editor already uses - POST /app/artifact/{id}/ai-edit with
 * a `section` - rather than standing up a second way to ask for a change. The caveat is not
 * decoration: an ai-edit rewrites the whole field, so the recovered original stops hashing to
 * `before_sha256` and every undo on that field will refuse afterwards. The user is told that before
 * they send, not after they try to undo.
 */
export function suggestScope(row) {
  const name = (row && row.fieldName) || 'this field'
  return {
    label: 'ASK FOR A CHANGE · ' + String(name).toUpperCase(),
    scope: 'Scoped to this field only.',
    caveat: 'Rewriting this field means the changes already applied to it can no longer be undone - '
      + 'an undo needs the field to be exactly as the run left it.',
    placeholder: 'What should this say instead?',
  }
}

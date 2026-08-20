// P8.6 / P8.1 R1 - guards for the change log (app/src/assetGate.js, rendered by screens/QcRail.jsx).
//   cd app && npm test
//
// Every assertion below names a specific way this surface can lie, and every one was RUN against the
// defect it describes before being committed - a guard that still passes with its defect reinstated
// is inert, and three of those shipped in this repo in one session. The reinstated line and the
// observed failure are recorded in each guard's own comment.
//
// The lie this file is mostly about: **absent is not empty.** `checks-result` carries no
// `corrections` key today, so `undefined` is the only value this code sees until the API lane
// merges. A UI that renders it as "nothing needed correcting" tells every user, on every artifact,
// that their text was audited and found clean by an audit that never ran.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  correctionsState, orderCorrections, correctionRow, correctionSentence, correctionAnomalies,
  correctionSourceText, undoAvailability, revertOutcome, suggestScope,
  CHANGE_LOG_HEADLINE, CORRECTION_SOURCE,
} from '../src/assetGate.js'
import { railCounts, railTotals, railAttention, railChangeLog, QC_HOOKS } from '../src/qcRail.js'

const SRC = new URL('../src/', import.meta.url)
const readSrc = (rel) => readFileSync(new URL(rel, SRC), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The change-log region of QcRail.jsx, sliced by the SENTINEL COMMENTS rather than by a component
 * name. A guard anchored on an identifier is a guard about spelling: rename the component and it
 * either breaks on correct code or, worse, silently starts inspecting an empty string and passes.
 */
function changeLogRegion() {
  const src = readSrc('screens/QcRail.jsx')
  const a = src.indexOf('P8.6-CHANGELOG-BEGIN')
  const b = src.indexOf('P8.6-CHANGELOG-END')
  assert.ok(a > 0 && b > a, 'the change-log sentinels are missing from QcRail.jsx')
  return src.slice(a, b)
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx)$/.test(name)) out.push(full)
  }
  return out
}

// One correction, in the wire shape `correction.ts` produces plus the id the revert route needs.
const row = (over = {}) => ({
  id: 'corr-1', merge_field: 'ResumeSummary', phrase: '$18M', replacement: '8-figure',
  char_start: 10, char_end: 14, applied_seq: 1,
  reason: 'the posting states $18M; your profile does not evidence it', source: 'generalized',
  ...over,
})
const withLog = (corrections) => ({ gate: 'pass', attention: 0, corrections, results: [], engines: { deterministic: { results: [] }, reviewer: { results: [] } } })

// ── A. the four states ───────────────────────────────────────────────────────────────────────────

test('absent, empty, unchecked and malformed are four states, not one', () => {
  // THE guard of this lane. Reinstated defect: `const raw = arr(result.corrections)` at the top of
  // correctionsState, which is what every neighbouring line in this module does to a list.
  // Observed with it: absent, empty and malformed all returned kind 'empty' and this test failed on
  // the first assert.notEqual - "'empty' != 'empty'". Restored: four kinds, four bodies.
  const unchecked = correctionsState({ gate: null })
  const absent = correctionsState({ gate: 'pass' })
  const empty = correctionsState(withLog([]))
  const malformed = correctionsState(withLog(7))

  const kinds = [unchecked.kind, absent.kind, empty.kind, malformed.kind]
  assert.equal(new Set(kinds).size, 4, 'four payloads must produce four kinds, got ' + JSON.stringify(kinds))

  const bodies = [unchecked.body, absent.body, empty.body, malformed.body]
  for (const b of bodies) assert.ok(b && b.length > 20, 'every state must say something: ' + JSON.stringify(b))
  assert.equal(new Set(bodies).size, 4, 'four states must read as four different sentences')

  // And they must say the RIGHT thing, not merely differ.
  assert.match(unchecked.body, /have not been run/i)
  assert.match(absent.body, /did not answer|reported no change log/i)
  assert.ok(!/nothing needed correcting/i.test(absent.body),
    'the absent state must never claim nothing needed correcting - nobody asked')
  assert.match(empty.body, /[Nn]othing needed correcting/)
  assert.match(malformed.body, /not a list/i)
})

test('null and undefined corrections are NOT the same state', () => {
  // `corrections: null` is a server that answered with a broken value; `undefined` is a server that
  // did not answer. Collapsing them hides a real API bug behind a normal-looking screen.
  assert.notEqual(correctionsState(withLog(null)).kind, correctionsState({ gate: 'pass' }).kind)
  assert.equal(correctionsState(withLog(null)).kind, 'malformed')
  assert.match(correctionsState(withLog(null)).body, /null/)
})

test('a state that measured nothing claims NO number - not zero', () => {
  // The verdictLine rule, applied here: "0 disagreements" is a measurement, and reporting a
  // measurement that was never taken is the shape of the bug this whole feature is against.
  // Reinstated defect: `hasNumber: true` for every kind. Observed: this test failed on the
  // 'absent' iteration; the rail then printed "0 corrected for you" for every live artifact.
  for (const r of [{ gate: null }, { gate: 'pass' }, withLog(7), withLog('nope')]) {
    const st = correctionsState(r)
    assert.equal(st.hasNumber, false, st.kind + ' must not claim a number')
    assert.equal(st.count, null, st.kind + ' must have a null count, never 0')
    assert.equal(st.undone, null)
    assert.equal(st.listed, null)
  }
  const empty = correctionsState(withLog([]))
  assert.equal(empty.hasNumber, true, 'an EMPTY log was measured - it may say 0')
  assert.equal(empty.count, 0)
})

test('the kind is decided from the raw key, never from a normalised list', () => {
  // Structural, because the runtime test above can be satisfied by an implementation that branches
  // on the raw key and then calls arr() two lines later - which works until someone reorders the
  // branches. `arr` maps undefined, null, 7 and [] to the same value, so it may never touch this
  // property at all.
  const src = stripComments(readSrc('assetGate.js'))
  assert.ok(!/arr\(\s*(result|r|res)?\.?\s*corrections/.test(src) && !/arr\([^)]*\.corrections/.test(src),
    'corrections must never be passed through arr() - it erases the distinction this feature depends on')
  assert.ok(/raw === undefined/.test(src), 'the absent case must be decided against the raw property')
})

// ── B. R4: corrections are never folded into the attention counters ─────────────────────────────

test('corrections cannot move the fix/review numbers', () => {
  // Reinstated defect: `toFix: ... + correctionsState(result).rows.length` in railCounts.
  // Observed: railCounts deep-equal failed, 1 vs 8. That is the badge/gate contradiction this repo
  // has shipped twice, in its third available shape.
  const base = {
    gate: 'warn', attention: 1,
    engines: {
      deterministic: { results: [{ engine: 'deterministic', state: 'warn', check_key: 'whitespace', offenders: [] }] },
      reviewer: { results: [] },
    },
  }
  const withCorrections = { ...base, corrections: Array.from({ length: 7 }, (_, i) => row({ id: 'c' + i, applied_seq: i + 1 })) }

  assert.deepEqual(railCounts(base), railCounts(withCorrections), 'corrections must not enter either counter')
  assert.equal(railAttention(base), railAttention(withCorrections), 'the server attention number is untouched')

  const a = railTotals([{ result: base }])
  const b = railTotals([{ result: withCorrections }])
  for (const field of ['toFix', 'toReview', 'unchecked', 'checked', 'assets']) {
    assert.equal(a[field], b[field], field + ' must be identical whether or not corrections exist')
  }
  assert.equal(b.corrected, 7, 'they are counted, on their own')
  assert.equal(a.corrected, 0)
  assert.equal(a.correctionsMeasured, 0, 'the payload with no change log counts as unmeasured')
  assert.equal(b.correctionsMeasured, 1)
})

test('nothing exposes a blended total', () => {
  // A single blended number is what let a green gate render beside "1 to fix" in the reference
  // prototype. There is no field here that adds any two of the three.
  const t = railTotals([{ result: { gate: 'warn', attention: 1, corrections: [row()], engines: { deterministic: { results: [{ engine: 'deterministic', state: 'warn', check_key: 'x' }] }, reviewer: { results: [] } } } }])
  assert.ok(!('total' in t), 'no total field')
  const sums = [t.toFix + t.toReview, t.toFix + t.corrected, t.toReview + t.corrected, t.toFix + t.toReview + t.corrected]
  for (const [k, v] of Object.entries(t)) {
    if (k === 'assets' || k === 'checked') continue
    assert.ok(!(sums.includes(v) && v > Math.max(t.toFix, t.toReview, t.corrected)),
      k + ' looks like a sum of two counts (' + v + ')')
  }
})

test('the change log and the counters come from ONE payload object', () => {
  // Behaviour, not spelling: change the one payload and all three must move together, because all
  // three are functions of it alone.
  const p1 = { gate: 'warn', attention: 1, corrections: [row()], engines: { deterministic: { results: [{ engine: 'deterministic', state: 'warn', check_key: 'x' }] }, reviewer: { results: [] } } }
  const p2 = { gate: 'pass', attention: 0, corrections: [row(), row({ id: 'c2', applied_seq: 2 })], engines: { deterministic: { results: [] }, reviewer: { results: [] } } }
  assert.notDeepEqual(railCounts(p1), railCounts(p2))
  assert.notEqual(railChangeLog(p1).count, railChangeLog(p2).count)
  assert.equal(railChangeLog(p1).count, 1)
  assert.equal(railChangeLog(p2).count, 2)
})

// ── C. ordering and the row model ────────────────────────────────────────────────────────────────

test('rows read in document order, and the same payload orders identically twice', () => {
  const rows = [row({ id: 'c', applied_seq: 3 }), row({ id: 'a', applied_seq: 1 }), row({ id: 'b', applied_seq: 2 })]
  const once = orderCorrections(rows).map((r) => r.seq)
  const twice = orderCorrections(rows).map((r) => r.seq)
  assert.deepEqual(once, [1, 2, 3])
  assert.deepEqual(once, twice, 'ordering must be deterministic across renders of one payload')
})

test('a duplicate or missing position is REPORTED, and the order stays stable', () => {
  // Reinstated defect: `correctionAnomalies` returning []. Observed: this test failed on the
  // anomalies length assert. The record of what was applied to a field is what a revert replays, so
  // "this order is the order the run sent them" has to be said out loud rather than assumed.
  const dupes = orderCorrections([row({ id: 'a', applied_seq: 1 }), row({ id: 'b', applied_seq: 1 })])
  assert.deepEqual(dupes.map((r) => r.id), ['a', 'b'], 'equal positions keep payload order')
  assert.equal(correctionAnomalies(dupes).length, 1)
  assert.match(correctionAnomalies(dupes)[0], /share position 1/)

  const missing = orderCorrections([row({ id: 'a', applied_seq: undefined }), row({ id: 'b', applied_seq: 1 })])
  assert.deepEqual(missing.map((r) => r.id), ['b', 'a'], 'a row with no position sorts after the ones that have one')
  assert.equal(correctionAnomalies(missing).length, 1)
  assert.match(correctionAnomalies(missing)[0], /no position/)
})

test('a row carries every field the server sent, and reword none of them', () => {
  const r = correctionRow(row(), 0)
  assert.equal(r.phrase, '$18M')
  assert.equal(r.replacement, '8-figure')
  assert.equal(r.reason, 'the posting states $18M; your profile does not evidence it')
  assert.equal(r.merge_field, 'ResumeSummary', 'the RAW merge-field name survives')
  assert.equal(r.fieldName, 'Summary', 'and its plain-language label is resolved through fieldLabel')
  assert.equal(r.id, 'corr-1')
})

test('an unknown source falls through to itself, never to one of the two known ones', () => {
  // The assetLabel rule. Defaulting an unknown source to `generalized` would tell a reader a number
  // was invented when the server said it came from their profile, or the exact reverse.
  assert.equal(correctionSourceText('generalized'), CORRECTION_SOURCE.generalized)
  assert.equal(correctionSourceText('profile_figure'), CORRECTION_SOURCE.profile_figure)
  const unknown = correctionSourceText('some_future_source')
  assert.match(unknown, /some_future_source/)
  assert.notEqual(unknown, CORRECTION_SOURCE.generalized)
  assert.notEqual(unknown, CORRECTION_SOURCE.profile_figure)
  assert.ok(correctionSourceText(undefined).length > 0, 'a missing source is never a blank')
})

test('the change log speaks in finished framing (R1)', () => {
  // Asserted on the STRINGS the module returns, not on what a constant is named - a guard that reads
  // an identifier is defeated by a rename. Reinstated defect: correctionSentence returning
  // 'Needs fixing: ...'. Observed: failed on the /^Corrected/ assert.
  const applied = correctionSentence({ phrase: '$18M', replacement: '8-figure', fieldName: 'Summary', undone: false })
  const undone = correctionSentence({ phrase: '$18M', replacement: '8-figure', fieldName: 'Summary', undone: true })
  assert.match(applied, /^Corrected: /)
  assert.match(undone, /^Undone: /)

  const strings = [
    CHANGE_LOG_HEADLINE, applied, undone,
    correctionsState(withLog([row()])).body,
    correctionsState(withLog([])).body,
    ...Object.values(CORRECTION_SOURCE),
    suggestScope(correctionRow(row(), 0)).scope,
  ]
  for (const s of strings) {
    for (const banned of ['needs fixing', 'to fix', 'to-do', 'pending', 'action required', 'you should']) {
      assert.ok(!s.toLowerCase().includes(banned), 'finished framing forbids "' + banned + '" in: ' + JSON.stringify(s))
    }
  }
})

// ── D. undo, refusal, and NO DEAD UI ─────────────────────────────────────────────────────────────

test('a row with no id offers no undo, and says why', () => {
  // NO DEAD UI, decided by the DATA rather than by a feature flag: the revert route names a
  // correction by its id, so a row without one cannot be the subject of a real request. When the API
  // lane ships rows with ids the control appears on real data with no change to this code.
  const noId = correctionRow(row({ id: undefined }), 0)
  assert.equal(undoAvailability(noId).can, false)
  assert.ok(undoAvailability(noId).reason.length > 20, 'and it must say why, not go quietly missing')

  assert.equal(undoAvailability(correctionRow(row(), 0)).can, true)

  const undone = correctionRow(row({ reverted_at: '2026-08-20T10:00:00Z', reverted_by: 'v@e.io' }), 0)
  assert.equal(undoAvailability(undone).can, false)
  assert.match(undoAvailability(undone).reason, /already undone/)
})

test('an undone correction STAYS in the log and leaves the corrected count', () => {
  // SPEC 5: reverting "flips that row to Undone". A revert that removes the row removes the record
  // that the change was ever made, which is the one thing a change log is for.
  // Reinstated defect: filtering reverted rows out of orderCorrections. Observed: listed was 1, not
  // 2, and the row vanished from the log entirely.
  const st = correctionsState(withLog([row(), row({ id: 'c2', applied_seq: 2, reverted_at: '2026-08-20T10:00:00Z', reverted_by: 'v@e.io' })]))
  assert.equal(st.listed, 2, 'both rows are still listed')
  assert.equal(st.count, 1, 'but only the one still applied is counted as corrected')
  assert.equal(st.undone, 1)
  const undoneRow = st.rows.find((r) => r.id === 'c2')
  assert.ok(undoneRow, 'the undone row is still present')
  assert.equal(undoneRow.undone, true)
  assert.match(undoneRow.sentence, /^Undone: /)
  assert.equal(undoneRow.undoneBy, 'v@e.io')
})

test('a revert is judged by ok, never by the text it returned', () => {
  // A correction can revert a field back to the empty string. An implementation branching on
  // `res.text` reports a phantom refusal, with no reason attached, for a revert that succeeded.
  // Reinstated defect: `if (!res.text) return {ok:false, ...}`. Observed: failed on the first assert.
  const emptied = revertOutcome({ ok: true, text: '' })
  assert.equal(emptied.ok, true, 'ok:true with empty text is a SUCCESS')
  assert.equal(emptied.text, '')
  assert.equal(revertOutcome({ ok: true, text: 'restored' }).ok, true)
})

test('a refusal is a state with the server own words, never a swallowed error', () => {
  // revertOne declines when the recovered original no longer hashes to before_sha256 - somebody
  // edited the field after the correction was applied. That is the server telling the user something
  // true about their document, and a generic "could not undo" throws it away.
  const edited = 'this field was edited after the correction was applied, so the original cannot be restored safely'
  const out = revertOutcome({ ok: false, reason: edited })
  assert.equal(out.ok, false)
  assert.equal(out.reason, edited, 'verbatim - not summarised, not replaced')

  assert.equal(revertOutcome({ ok: false, reason: 'no applied correction with seq 4' }).reason, 'no applied correction with seq 4')
  assert.equal(revertOutcome({ error: 'not found' }).reason, 'not found', 'a thrown body error is still a reason')

  // No answer at all is its own state and must not read as a success.
  for (const bad of [null, undefined, 'nope', 0]) {
    const r = revertOutcome(bad)
    assert.equal(r.ok, false)
    assert.ok(r.reason.length > 20, 'a refusal with no stated reason still says so: ' + JSON.stringify(r))
  }
  assert.match(revertOutcome({ ok: false }).reason, /without stating a reason/)
})

test('"suggest something different" is scoped to ONE merge field and says what it costs', () => {
  const scope = suggestScope(correctionRow(row(), 0))
  assert.match(scope.label, /ASK FOR A CHANGE · SUMMARY/)
  assert.match(scope.scope, /this field only/i)
  assert.ok(scope.caveat.length > 40, 'rewriting the field makes every undo on it refuse - say so BEFORE they send')
  assert.match(scope.caveat, /no longer be undone/i)
})

// ── E. structural: one definition, one payload, no fabrication ───────────────────────────────────

test('no .jsx in app/src touches result.corrections - every surface goes through the selector', () => {
  // Measured hole this closes: the existing "computes NOTHING" guard (qcRail.test.mjs) runs four
  // negative regexes against QcRail.jsx and `arr(result.corrections).length` matches NONE of them.
  // The corrections number is a plain array length, so there is no friction stopping it being
  // written inline in the JSX where the pill renders - and then it is right on one surface and
  // absent or different on the four others that render a gate badge.
  const offenders = []
  for (const f of walk(new URL('../src', import.meta.url).pathname)) {
    if (!/\.jsx$/.test(f)) continue
    const src = stripComments(readFileSync(f, 'utf8'))
    if (/\.corrections\b/.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [], 'a component read .corrections directly instead of the selector')
})

test('the corrections selectors live with the gate selectors and stay importable without a DOM', () => {
  const src = readSrc('assetGate.js')
  assert.ok(!/from ['"]react['"]/.test(src) && !/\bdocument\.|window\./.test(stripComments(src)),
    'the module must stay pure - node --test imports it with no DOM')
  assert.equal(typeof correctionsState, 'function')
  assert.equal(typeof railChangeLog, 'function', 'and the rail re-exports it rather than redefining it')
})

test('no fabricated correction data anywhere in app/src', () => {
  // The "no fixture data backs the remediation tab" rule. If there are no corrections the log is
  // honestly empty; it is never populated with examples to make the screen look finished.
  for (const f of walk(new URL('../src', import.meta.url).pathname)) {
    const src = stripComments(readFileSync(f, 'utf8'))
    assert.ok(!/8-figure/.test(src), f + ' contains a literal replacement value')
    assert.ok(!/SAMPLE_CORRECTIONS|FIXTURE_CORRECTIONS|const\s+CORRECTIONS\s*=/.test(src),
      f + ' backs the change log with a literal')
  }
})

test('the undo goes through api.js, to a real route, with the right owner rule', () => {
  const api = readSrc('api.js')
  const line = api.split('\n').find((l) => l.trim().startsWith('revertCorrection:'))
  assert.ok(line, 'revertCorrection must exist in api.js')
  assert.match(line, /postDetailed/, 'a refusal carries the reason with it - post() collapses it into an HTTP code')
  assert.match(line, /\/app\/correction\/\$\{correctionId\}\/revert/)
  assert.ok(!/owner=/.test(line),
    'a write must not carry ?owner= - requireWrite takes the owner from the verified session')

  const checks = api.split('\n').filter((l) => l.trim().startsWith('artifactChecksResult:'))
  assert.ok(checks.length && checks.every((l) => /\?owner=/.test(l)),
    'the GET that carries the change log is owner-scoped and must pass ?owner=')

  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  assert.ok(!/fetch\(/.test(jsx), 'the rail goes through api.js, which is where the owner rule lives')
})

test('the undo control is WIRED, not a stub, and a refresh re-reads the payload', () => {
  // NO DEAD UI, inspected at the HANDLER rather than the label. Reinstated defect: replacing the
  // doUndo body with a toast. Observed: failed on the api.revertCorrection assert.
  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  assert.ok(/api\.revertCorrection\(/.test(jsx), 'the undo must call the real helper')
  assert.ok(/api\.aiEditArtifact\(/.test(jsx), 'the scoped rewrite must call the real field-scoped edit path')
  assert.ok(!/onClick=\{\(\) => toast\(/.test(jsx) && !/onClick=\{\(\) => \{\}\}/.test(jsx),
    'no stubbed handler may sit behind a rendered control')
  assert.ok(!/coming soon|not yet available/i.test(jsx), 'a placeholder label is not an affordance')

  // After a mutation the ONE payload is re-read, so the log, the number and the gate cannot describe
  // three different moments. Reverting puts the figure back and re-opens the check that named it -
  // a locally spliced row would hide exactly that.
  assert.ok(/api\.artifactChecksResult\(/.test(jsx) && /setResult\(/.test(jsx),
    'a mutation must be followed by a re-read of checks-result, not a local edit')
  assert.ok(!/setCorrections|corrections\.splice|corrections\.filter\(/.test(jsx),
    'no component-local mutation of the corrections list')
})

test('the gate badge deliberately prints NO corrections number, and that is on the record', () => {
  // A decision, not an oversight. GateBadge is the GATE badge: it exists to say what blocks
  // approval, and a correction blocks nothing. It is also rendered by Packets.jsx, where no change
  // log is on screen to reconcile a number against.
  const drawer = stripComments(readSrc('screens/AssetGateDrawer.jsx'))
  assert.ok(!/corrections/i.test(drawer),
    'if the drawer ever prints a corrections number it must read the same selector - update this guard deliberately')
})

test('the change log hardcodes no behavioural value of its own', () => {
  // What app/ can actually prove of "no hardcoded config": no cap on how many changes are listed, no
  // "first N then show more", no truncation of the user's own text. Anything an owner would want to
  // change lives server-side, and this lane adds no client-side literal that governs what they see.
  const log = stripComments(changeLogRegion())
  assert.ok(log.length > 500, 'the change-log region must be found for this guard to mean anything')
  assert.ok(!/\.slice\(0,\s*\d+\)/.test(log), 'no cap on how many changes are shown')
  assert.ok(!/substring\(0,\s*\d+\)|truncate|MAX_[A-Z_]+/.test(log), 'no truncation of the stored text')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(log), 'no raw hex - every colour is a token')
  assert.ok(!/var\(--[^)]*\$\{/.test(log), 'no interpolated custom-property name')
})

test('every hook the change log renders is a declared, unique constant', () => {
  // Rename-proof by construction: it iterates QC_HOOKS rather than naming any key, so renaming a
  // hook key changes nothing here. What it asserts is that the region references its hooks THROUGH
  // the constant and hand-types none of them - a hand-typed data-qc is how the verifier's selector
  // and the DOM drift apart, and ui-verify.yml can only select by CSS.
  const region = changeLogRegion()
  const referenced = Object.keys(QC_HOOKS).filter((k) => region.includes('QC_HOOKS.' + k))
  assert.ok(referenced.length >= 8,
    'the change log must render its own hooks - found ' + referenced.length
    + '. (8 is a floor against a vacuous pass, not a design limit: the region renders the log, a '
    + 'number, an undone number, a per-state note, a row, an open link, an undo, a suggest, a '
    + 'refusal and an anomaly.)')
  // Over EVERY hook value, not only the referenced ones. Checking only what the region still
  // references is a hole I put here myself while making this guard rename-proof: hand-typing
  // `data-qc="qc-change-log"` removes `QC_HOOKS.changeLog` from `referenced`, so a loop over
  // `referenced` stops looking at the very hook that was just hand-typed. Measured: with that
  // version, reinstating the hand-typed attribute left this test GREEN.
  const stripped = stripComments(region)
  for (const value of Object.values(QC_HOOKS)) {
    assert.ok(!new RegExp(`data-qc=["']${value}["']`).test(stripped),
      'data-qc="' + value + '" is hand-typed - it must come from QC_HOOKS so the verifier\'s selector cannot drift')
  }
  const values = Object.values(QC_HOOKS)
  assert.equal(new Set(values).size, values.length, 'hook values must stay unique')
})

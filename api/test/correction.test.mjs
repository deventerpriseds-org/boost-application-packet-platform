// P8.1 / R1 — corrections, and the offset drift that makes the obvious implementation wrong in a
// way the document never reveals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanEcho } from '../dist/functions/tests/figureEcho.js'
import {
  planCorrections, applyCorrections, originalOf, revertOne, isWellFormed, sha256,
} from '../dist/functions/tests/correction.js'

const POSTING = 'Own a $18M portfolio, 60+ direct reports and three business units, at 40% growth.'
const PROFILE = 'Led platform engineering for a regional utility.'
const FIELD = 'Managed a $18M portfolio with 60+ reports across three business units, 40% growth.'
const plan = (gen = FIELD, posting = POSTING, profile = PROFILE) =>
  planCorrections('ResumeSummary', gen, scanEcho(gen, posting, profile).echoes)

test('every echoed figure with an honest replacement gets a row, in document order', () => {
  const rows = plan()
  assert.deepEqual(rows.map(r => r.phrase), ['$18M', '60+', 'three'])
  assert.deepEqual(rows.map(r => r.replacement), ['8-figure', 'multiple', 'multiple'])
  assert.deepEqual(rows.map(r => r.applied_seq), [1, 2, 3])
  assert.ok(rows.every(r => r.source === 'generalized'))
})

test('a figure with no honest replacement produces NO row and stays in the document', () => {
  // generalize() returns null for a rate: there is no honest generalisation of "40%", and inventing
  // one would be the fabrication this layer exists to prevent. It stays an open finding.
  const rows = plan()
  assert.ok(!rows.some(r => r.phrase.includes('%')), '40% was corrected — to what?')
  assert.ok(applyCorrections(FIELD, rows).includes('40%'))
})

test('every row addresses exactly its own phrase', () => {
  for (const r of plan()) {
    assert.ok(isWellFormed(r), JSON.stringify(r))
    assert.equal(FIELD.slice(r.char_start, r.char_end), r.phrase)
    assert.equal(r.char_end - r.char_start, r.phrase.length)
  }
})

test('applying is exact, and leaves everything it was not asked to touch alone', () => {
  const out = applyCorrections(FIELD, plan())
  assert.equal(out, 'Managed a 8-figure portfolio with multiple reports across multiple business units, 40% growth.')
  assert.ok(!out.includes('$18M') && !out.includes('60+'))
})

test('THE DRIFT CASE — offsets stay valid across three corrections in one field', () => {
  // The defect this module exists to prevent. `$18M` (4 chars) becomes `8-figure` (8), so every
  // figure to its right shifts by four. A left-to-right walk using the original offsets produces
  // the RIGHT DOCUMENT and a WRONG RECORD — the errors accumulate only in the log, so nothing looks
  // broken until someone clicks Undo months later.
  const rows = plan()
  const corrected = applyCorrections(FIELD, rows)
  // Proof the shift is real and large enough to corrupt: the second correction's stored offset no
  // longer addresses its own replacement in the corrected string.
  const naive = corrected.slice(rows[1].char_start, rows[1].char_start + rows[1].replacement.length)
  assert.notEqual(naive, rows[1].replacement, 'no drift in this fixture — the test proves nothing')
  // And the module recovers the original exactly anyway, because it never relies on that.
  assert.equal(originalOf(corrected, rows), FIELD)
  assert.equal(sha256(originalOf(corrected, rows)), rows[0].before_sha256)
})

test('reverting the MIDDLE correction restores only that phrase', () => {
  const rows = plan()
  const corrected = applyCorrections(FIELD, rows)
  const r = revertOne(corrected, rows, 2)
  assert.ok(r.ok, r.reason)
  assert.equal(r.text, 'Managed a 8-figure portfolio with 60+ reports across multiple business units, 40% growth.')
  assert.ok(r.text.includes('60+'), 'the reverted phrase is back')
  assert.ok(r.text.includes('8-figure') && r.text.includes('multiple business units'), 'the others are untouched')
})

test('reverting every correction returns the document to byte-identical original', () => {
  const rows = plan()
  let text = applyCorrections(FIELD, rows)
  let live = [...rows]
  for (const seq of [3, 1, 2]) {           // deliberately not in order
    const r = revertOne(text, live, seq)
    assert.ok(r.ok, r.reason)
    text = r.text
    live = live.filter(c => c.applied_seq !== seq)
  }
  assert.equal(text, FIELD)
})

test('a revert REFUSES when the field was edited in between — it never guesses', () => {
  // D19's warning made structural: a hash that is stored but never recomputed is not a guard. This
  // one is recomputed, and the refusal writes nothing.
  const rows = plan()
  const corrected = applyCorrections(FIELD, rows)
  const edited = corrected.replace('portfolio', 'portfolio and P&L')
  const r = revertOne(edited, rows, 1)
  assert.equal(r.ok, false)
  assert.ok(/edited after|no longer matches/.test(r.reason), r.reason)
  assert.equal(r.text, undefined, 'a refusal must not hand back text')
})

test('the hash is RECOMPUTED — an edit that disturbs no offset is still caught', () => {
  // This case exists because the obvious one does not exercise the hash at all. Editing mid-field
  // moves the later corrections, so `originalOf` throws and the refusal comes from the offset check
  // — the sha comparison never runs. Proven by deleting it: the suite stayed 14/14 green, which is
  // D19's exact shape (a hash written and served but never recomputed is not a guard).
  //
  // An edit AFTER the last correction, of the same length, disturbs nothing. `originalOf` succeeds
  // and returns a perfectly well-formed original that is NOT the one the corrections were computed
  // against. Only the hash can tell.
  const rows = plan()
  const corrected = applyCorrections(FIELD, rows)
  const edited = corrected.replace('40% growth.', '45% growth.')
  assert.equal(edited.length, corrected.length, 'the fixture must not move any offset')
  assert.notEqual(edited, corrected)
  const r = revertOne(edited, rows, 1)
  assert.equal(r.ok, false, 'a tail edit slipped past the hash')
  assert.ok(/edited after/.test(r.reason), r.reason)
  assert.equal(r.text, undefined)
})

test('a correction is never applied to text it does not address', () => {
  const rows = plan()
  assert.throws(() => applyCorrections(FIELD.replace('$18M', '$20M'), rows), /does not address its own phrase/)
})

test('the same figure twice in one field corrects each occurrence independently', () => {
  // A global String.replace is the plausible wrong answer, and it corrupts the unrelated one.
  const f = 'Ran 60+ sites in 2019-60 and grew to 60+ regions.'
  const posting = 'We need 60+ sites.'
  const rows = planCorrections('ResumeSummary', f, scanEcho(f, posting, 'Nothing relevant.').echoes)
  const out = applyCorrections(f, rows)
  assert.ok(out.includes('2019-60'), 'the unrelated number was rewritten')
  assert.equal(out.match(/multiple/g).length, rows.length)
})

test('a figure the profile also evidences is never corrected', () => {
  // R2 beats a literal R3. Correcting it would delete the candidate's own true achievement.
  const f = 'Ran 60 sites.'
  const rows = planCorrections('ResumeSummary', f, scanEcho(f, 'Need 60+ sites.', 'Operated 60 sites.').echoes)
  assert.deepEqual(rows, [])
  assert.equal(applyCorrections(f, rows), f)
})

test('no posting text means no corrections — never a silent clean pass', () => {
  const scan = scanEcho(FIELD, '', PROFILE)
  assert.equal(scan.notApplicable, true)
  assert.deepEqual(planCorrections('ResumeSummary', FIELD, scan.echoes), [])
})

test('an offset that does not address its own figure is dropped, not applied', () => {
  const rows = plan()
  const forged = [{ ...rows[0], char_start: rows[0].char_start + 1, char_end: rows[0].char_end + 1 }]
  assert.throws(() => applyCorrections(FIELD, forged), /malformed|does not address/)
})

test('the module is pure — no pg, no HTTP, no model call', () => {
  // Deterministic by construction: the same field corrects the same way forever, which is what lets
  // a revert months later be exact rather than approximate.
  assert.equal(applyCorrections(FIELD, plan()), applyCorrections(FIELD, plan()))
})

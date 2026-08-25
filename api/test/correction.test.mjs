// P8.1 / R1 — corrections, and the offset drift that makes the obvious implementation wrong in a
// way the document never reveals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('the route contract: a refusal is a 200 the UI can render, not an error it swallows', () => {
  // `revertOne` declining is a SUCCESSFUL outcome — the system worked and said no. Returning 4xx
  // would put it down a generic error path where the user is told nothing, and the reason ("this
  // field was edited after the correction was applied") is the whole content of the interaction.
  //
  // Source rules, because the distinction is about which branch produces which status, and both
  // branches return a well-formed body.
  const src = readFileSync(new URL('../src/functions/tests/appCorrections.ts', import.meta.url), 'utf8')
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

  assert.match(code, /if \(!result\.ok\)[\s\S]{0,220}status: 200[\s\S]{0,120}ok: false/,
    'a declined revert no longer returns 200 with the reason — the user will be shown nothing')

  // A declined revert must write NOTHING. A row stamped `reverted_by` whose text never changed is
  // worse than either outcome alone: the log says undone and the document disagrees.
  const declineBranch = code.slice(code.indexOf('if (!result.ok)'), code.indexOf('const pkg = {'))
  assert.ok(!/update /i.test(declineBranch), 'the decline branch writes to the database')

  // The stamp is the session owner, never the client's word for it.
  assert.match(code, /set reverted_by = \$1[\s\S]{0,200}\[owner, correctionId\]/,
    'reverted_by is not taken from the resolved session owner')
  assert.ok(!/body\?\.reverted_by|body\.reverted_by/.test(code), 'reverted_by is read from the request body')

  // The write pair is atomic: the package text and the undone stamp cannot disagree.
  assert.ok(code.includes("client.query('begin')") && code.includes("client.query('rollback')"),
    'the package update and the revert stamp are not in one transaction')

  // Mutations need a verified session; `resolveOwner` alone DEFAULTS to the demo account, so
  // requireWrite is what actually closes the route.
  assert.match(code, /requireWrite\(req\); if \(guard\) return guard/, 'the revert route is unguarded')
})

test('the change log always ships an array, so "none" and "not asked" stay distinguishable', () => {
  const src = readFileSync(new URL('../src/functions/tests/appCorrections.ts', import.meta.url), 'utf8')
  assert.match(src, /jsonBody: \{ artifact_id: artifactId, corrections: rows \}/,
    'the corrections key is conditional — an absent key and an empty list are different states')
})

// ── D:owner-edit-offsets-two-frames — the frame guards ──────────────────────────────────────────
//
// An owner edit was un-undoable the moment any other correction shared the field, and it poisoned
// that field's whole change log: `revertOne` refused BOTH rows, not just the new one. Two writers
// put offsets into `correction` in two different coordinate systems and one reader assumed a single
// one. The single-correction case worked perfectly, which is why it shipped.
//
// Fixed as option (b) — the READER learns the frame — over the ledger's recommended (a), on measured
// evidence: (a) rewrites the writer, leaves every stored row broken, and (measured, §E1 of the AC
// pass) makes a NEW owner edit on an affected field start getting refused.
import { createHash } from 'node:crypto'
import { CORRECTION_FRAME, frameOf } from '../dist/functions/tests/correction.js'

const FRAME_FIELD = 'Led $18M supplier negotiation across teams'
const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
// The §1 fixture, in the two frames its two writers actually produce.
const genRow = {
  merge_field: 'F', phrase: '$18M', replacement: '8-figure',
  char_start: 4, char_end: 8, before_sha256: sha(FRAME_FIELD),
  applied_seq: 1, reason: 'generalized', source: 'generalized', frame: 'original',
}
const appliedText = applyCorrections(FRAME_FIELD, [genRow])          // "Led 8-figure supplier negotiation across teams"
const ownerRow = {
  merge_field: 'F', phrase: 'supplier negotiation', replacement: 'Vendor selection',
  char_start: appliedText.indexOf('supplier negotiation'),
  char_end: appliedText.indexOf('supplier negotiation') + 'supplier negotiation'.length,
  before_sha256: sha(appliedText), applied_seq: 2,
  reason: 'you changed this yourself', source: 'owner_edit', frame: 'applied',
}
const bothApplied = applyCorrections(appliedText, [{ ...ownerRow, char_start: ownerRow.char_start, char_end: ownerRow.char_end }])

test('H:revert-across-two-frames: an owner edit beside a pipeline row is undoable, and so is the pipeline row', () => {
  // AC-1 — the reported defect. Before the fix BOTH of these returned ok:false.
  const undoOwner = revertOne(bothApplied, [genRow, ownerRow], 2)
  assert.equal(undoOwner.ok, true, `owner row refused: ${undoOwner.reason}`)
  assert.equal(undoOwner.text, 'Led 8-figure supplier negotiation across teams')

  // AC-2 — the POISONING half. The pipeline row has no defect of its own and was refused anyway.
  const undoPipeline = revertOne(bothApplied, [genRow, ownerRow], 1)
  assert.equal(undoPipeline.ok, true, `pipeline row refused: ${undoPipeline.reason}`)
  assert.equal(undoPipeline.text, 'Led $18M Vendor selection across teams')
})

test('H:revert-two-owner-rows: the trigger is a second row in another frame, not "a pipeline row"', () => {
  // AC-3, and the case the LEDGER DOES NOT NAME. Two owner edits, no pipeline correction at all,
  // break identically — so an AC written only to the ledger's wording would have left this live.
  const first = { ...ownerRow, applied_seq: 1, before_sha256: sha(FRAME_FIELD),
    char_start: FRAME_FIELD.indexOf('supplier negotiation'),
    char_end: FRAME_FIELD.indexOf('supplier negotiation') + 'supplier negotiation'.length }
  const afterFirst = applyCorrections(FRAME_FIELD, [first])
  const second = { merge_field: 'F', phrase: 'across teams', replacement: 'company-wide',
    char_start: afterFirst.indexOf('across teams'),
    char_end: afterFirst.indexOf('across teams') + 'across teams'.length,
    before_sha256: sha(afterFirst), applied_seq: 2, reason: 'you changed this yourself',
    source: 'owner_edit', frame: 'applied' }
  const both = applyCorrections(afterFirst, [second])
  for (const seq of [1, 2]) {
    const r = revertOne(both, [first, second], seq)
    assert.equal(r.ok, true, `two owner edits, seq ${seq} refused: ${r.reason}`)
  }
})

test('H:revert-legacy-rows-need-no-backfill: a row with NO frame resolves through the source map', () => {
  // AC-4. Every row already in production predates the column. If this ever fails, the fix has
  // quietly become a migration — which is precisely what choosing (b) over (a) bought us.
  const legacyGen = { ...genRow }; delete legacyGen.frame
  const legacyOwner = { ...ownerRow }; delete legacyOwner.frame
  assert.equal(legacyGen.frame, undefined)
  assert.equal(legacyOwner.frame, undefined)
  assert.equal(frameOf(legacyGen), 'original')
  assert.equal(frameOf(legacyOwner), 'applied')
  for (const seq of [1, 2]) {
    const r = revertOne(bothApplied, [legacyGen, legacyOwner], seq)
    assert.equal(r.ok, true, `legacy row seq ${seq} refused: ${r.reason}`)
  }
})

test('H:correction-frame-declared-not-guessed: an unknown source REFUSES and names itself', () => {
  // AC-5. A default here would silently pick a coordinate system for a row nobody has reasoned
  // about — the exact class of bug this whole change exists to remove.
  // An explicitly DECLARED frame beats the map, by design — so to exercise the map path at all the
  // fixture must carry no frame. Getting this wrong the first time is instructive: the guard failed
  // because the code was right.
  const alien = { ...ownerRow, source: 'imported_from_elsewhere' }
  delete alien.frame
  assert.equal(frameOf(alien), null)
  assert.equal(frameOf({ ...alien, frame: 'applied' }), 'applied',
    'a row that DECLARES its frame is readable even when its source is unknown to this version')
  const r = revertOne(bothApplied, [genRow, alien], 1)
  assert.equal(r.ok, false)
  assert.match(r.reason, /imported_from_elsewhere/,
    'the refusal must NAME the source it cannot place, or nobody can act on it')
  assert.equal(r.text, undefined, 'a refusal writes nothing')
})

test('H:correction-frame-map-exhaustive: every source in the DB domain has a decided frame', () => {
  // AC-6. The TS `Record<CorrectionSource, …>` catches a widened UNION at compile time; this catches
  // a widened DATABASE DOMAIN, which the compiler cannot see. The two must not drift.
  const schema = readFileSync(new URL('../src/functions/tests/schema.ts', import.meta.url), 'utf8')
  const m = schema.match(/check \(source in \(([^)]+)\)\)/)
  assert.ok(m, 'source CHECK not found in schema.ts')
  const dbSources = Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]).sort()
  assert.deepEqual(Object.keys(CORRECTION_FRAME).sort(), dbSources,
    'a source the database accepts has no frame, so a row of that kind would be un-undoable')
  for (const [src, frame] of Object.entries(CORRECTION_FRAME)) {
    assert.ok(frame === 'original' || frame === 'applied', `${src} has a nonsense frame: ${frame}`)
  }
})

test('H:revert-verifies-every-owner-row-hash: not just the target row', () => {
  // AC-7. Unwinding walks backwards through rows the caller did not ask about. If one of those has
  // moved, splicing anyway writes into a document nobody can check — so each is verified against
  // the state IT recorded, not merely the one the reader happens to be undoing.
  const lying = { ...ownerRow, before_sha256: sha('a state this field was never in') }
  const r = revertOne(bothApplied, [genRow, lying], 1)
  assert.equal(r.ok, false, 'a wrong hash on a NON-target row must still refuse')
  assert.equal(r.text, undefined)
})

test('H:revert-reason-never-blames-the-owner-falsely: a rebuild is not an edit', () => {
  // AC-8. When a rebuild plans pipeline rows ON TOP of an existing owner edit, the ordering cannot
  // be replayed. Today's code returns "this field was edited after the correction was applied",
  // which accuses the owner of something they did not do. The refusal has to be TRUE.
  const ownerFirst = { ...ownerRow, applied_seq: 1 }
  const pipelineAfter = { ...genRow, applied_seq: 2 }
  const r = revertOne(bothApplied, [ownerFirst, pipelineAfter], 1)
  assert.equal(r.ok, false, 'this ordering is not replayable and must refuse')
  // The FALSE sentence is the specific one today's code returns — "this field was edited after the
  // correction was applied" — which asserts a manual edit invalidated the log when what happened was
  // a rebuild. Banning the substring "you edited" outright would be too blunt: the honest reason
  // legitimately says a rebuild happened AFTER the owner edited, which is exactly what occurred.
  assert.doesNotMatch(r.reason, /(this field|it) was edited after the correction was applied/i,
    `refusal makes the false claim: "${r.reason}"`)
  assert.match(r.reason, /rebuil/i, 'the reason should say what actually happened')
})

test('H:revert-writes-nothing-when-text-moved: the safety floor is not loosened', () => {
  // AC-10/AC-11. The fix must not buy its new capability by weakening the refusal. Both a
  // length-CHANGING tamper and a SAME-LENGTH one (which disturbs no offset, so only the hash can
  // catch it) must still refuse.
  const longer = bothApplied.replace('Led', 'Led personally')
  const sameLen = bothApplied.replace('across', 'ACROSS')
  for (const [label, text] of [['length-changing', longer], ['same-length', sameLen]]) {
    for (const seq of [1, 2]) {
      const r = revertOne(text, [genRow, ownerRow], seq)
      assert.equal(r.ok, false, `${label} tamper, seq ${seq}: spliced instead of refusing`)
      assert.equal(r.text, undefined)
    }
  }
})

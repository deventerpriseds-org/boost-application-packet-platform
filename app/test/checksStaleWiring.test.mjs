// Frontend checks-wiring gap (Lane C): guards for the two things Lane C was asked to build.
//
// No DOM in this suite (`node --test test/*.test.mjs`, no @testing-library) so, matching this
// repo's own established idiom (apiShape.test.mjs, qcRail.test.mjs's stripComments/readSrc sweep),
// pure logic is asserted directly and WIRING is asserted structurally against the source text - the
// same thing a source grep in an H-case does for a construct a runtime test cannot otherwise reach.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { staleChecksNote } from '../src/qcRail.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const QC_RAIL_SRC = read('../src/screens/QcRail.jsx')
const PACKET_BUILDER_SRC = read('../src/screens/PacketBuilder.jsx')
const OPP_DETAIL_SRC = read('../src/screens/OppDetail.jsx')
const API_SRC = read('../src/api.js')
const SETTINGS_SRC = read('../src/screens/Settings.jsx')

// ── GAP 1 part A: staleChecksNote, the pure selector ───────────────────────────────────────────

test('staleChecksNote: renders nothing when the entry is not stale', () => {
  assert.equal(staleChecksNote({ stale: false, staleError: null }), null)
  assert.equal(staleChecksNote({ stale: false, staleError: 'ignored while not stale' }), null)
  assert.equal(staleChecksNote(null), null)
  assert.equal(staleChecksNote(undefined), null)
})

test('staleChecksNote: renders a sentence when the entry IS stale, naming the reason when there is one', () => {
  const withReason = staleChecksNote({ stale: true, staleError: 'model call timed out' })
  assert.equal(typeof withReason, 'string')
  assert.match(withReason, /model call timed out/)
  assert.match(withReason, /out of date/i)

  const noReason = staleChecksNote({ stale: true, staleError: null })
  assert.equal(typeof noReason, 'string')
  assert.match(noReason, /out of date|could not be recomputed/i)
  assert.notEqual(noReason, withReason)
})

// ── GAP 1 part A: the write flows actually READ checksStale/checksError and REPORT it ──────────
//
// One assertion per route this lane was told to confirm and wire (appPackets.ts/appCorrections.ts):
// artifactGenerate, artifactContent, artifactAiEdit, correctionRevert. artifactOwnerEdit is excluded
// on purpose - `api.ownerEdit` has zero call sites in app/src (grep -rn "\.ownerEdit\(" app/src), so
// there is nothing to assert a signal was wired onto.

test('PacketBuilder.generate() (artifactGenerate) reads checksStale/checksError and reports it', () => {
  const m = PACKET_BUILDER_SRC.match(/const generate = async[\s\S]{0,900}/)
  assert.ok(m, 'generate() not found in PacketBuilder.jsx')
  assert.match(m[0], /res\.checksStale/)
  assert.match(m[0], /markQcStale\(a\.id, res\.checksError\)/)
})

test('PacketBuilder ArtifactCard List Tweaks send (artifactAiEdit) reads checksStale and reports it', () => {
  const m = PACKET_BUILDER_SRC.match(/api\.aiEditArtifact\(a\.id, \{ instruction: assetAsk\.trim\(\) \}\)[\s\S]{0,200}/)
  assert.ok(m, 'the assetAsk send handler was not found in PacketBuilder.jsx')
  assert.match(m[0], /res\.checksStale/)
  assert.match(m[0], /onStaleSignal/)
})

test('QcRail CorrectionRow.doAsk (artifactAiEdit) reads checksStale and reports it', () => {
  const m = QC_RAIL_SRC.match(/const doAsk = async[\s\S]{0,400}/)
  assert.ok(m, 'doAsk() not found in QcRail.jsx')
  assert.match(m[0], /res\.checksStale/)
  assert.match(m[0], /onStaleSignal\(!!res\.checksStale, res\.checksError\)/)
})

test('QcRail CorrectionRow.doUndo (correctionRevert) reads checksStale and reports it', () => {
  const m = QC_RAIL_SRC.match(/const doUndo = async[\s\S]{0,900}/)
  assert.ok(m, 'doUndo() not found in QcRail.jsx')
  assert.match(m[0], /res\.checksStale/)
  assert.match(m[0], /onStaleSignal\(!!res\.checksStale, res\.checksError\)/)
})

test('QcRail CorrectionRow.doRerun clears a stale mark on a real recompute', () => {
  const m = QC_RAIL_SRC.match(/const doRerun = async[\s\S]{0,400}/)
  assert.ok(m, 'doRerun() not found in QcRail.jsx')
  assert.match(m[0], /onStaleSignal\(false\)/)
})

test('OppDetail ResumeField.save() (artifactContent) reads checksStale and reports it', () => {
  const m = OPP_DETAIL_SRC.match(/const save = async[\s\S]{0,900}/)
  assert.ok(m, 'ResumeField.save() not found in OppDetail.jsx')
  assert.match(m[0], /r\.checksStale/)
  assert.match(m[0], /onStaleSignal\(!!r\.checksStale, r\.checksError\)/)
})

test('OppDetail ResumeField.aiEdit() (artifactAiEdit) reads checksStale and reports it', () => {
  const m = OPP_DETAIL_SRC.match(/const aiEdit = async[\s\S]{0,500}/)
  assert.ok(m, 'ResumeField.aiEdit() not found in OppDetail.jsx')
  assert.match(m[0], /r\.checksStale/)
  assert.match(m[0], /onStaleSignal\(!!r\.checksStale, r\.checksError\)/)
})

test('OppDetail ResumeTab.generate() (artifactGenerate) reads checksStale and reports it', () => {
  const m = OPP_DETAIL_SRC.match(/const generate = async \(a\)[\s\S]{0,400}/)
  assert.ok(m, 'ResumeTab.generate() not found in OppDetail.jsx')
  assert.match(m[0], /r\.checksStale/)
  assert.match(m[0], /markStale\(a\.id, r\.checksError\)/)
})

// setResult must NOT clear a stale mark on a plain re-read: the GET /checks-result route only
// returns the last STORED gate (confirmed by reading appChecks.ts:artifactChecksGet), so it carries
// no freshness signal. Only clearStale (a genuine recompute) may resolve one.
test('useQcEntries.setResult never touches stale/staleError - only markStale/clearStale do', () => {
  const m = QC_RAIL_SRC.match(/const setResult = useCallback\(\(artifactId, fresh\) => \{[\s\S]{0,400}?\}, \[\]\)/)
  assert.ok(m, 'setResult not found in QcRail.jsx')
  // Strip // comments before checking - the explanatory comment above the code legitimately says
  // "stale" (it explains why the CODE does not touch it). The assertion is about the code, not the
  // prose describing the code.
  const codeOnly = m[0].replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(codeOnly, /stale/i)
  // And a positive check that it's the RIGHT object literal - it still writes loading/error/data.
  assert.match(codeOnly, /loading: false, error: null, data: fresh/)
})

// ── GAP 1 part B: ok:false from /document and /slides must never read as a failure ─────────────
//
// api/src/functions/tests/appPackets.ts's templated branches of artifactDocument/artifactSlides can
// return `ok: false` (warnings present) alongside a real docUrl. app.js's plain post() only throws
// on a non-2xx HTTP status - these routes always return 200 - so the three consumers below must
// branch on `.error`, never on `.ok`, or a future edit re-introduces the exact regression this lane
// was asked to check for.

test('PacketBuilder.makeDoc/makeSlides never branch on res.ok - only res.error, and always keep docUrl', () => {
  const doc = PACKET_BUILDER_SRC.match(/const makeDoc = async[\s\S]{0,900}?\n  \}/)
  const slides = PACKET_BUILDER_SRC.match(/const makeSlides = async[\s\S]{0,900}?\n  \}/)
  assert.ok(doc, 'makeDoc not found in PacketBuilder.jsx')
  assert.ok(slides, 'makeSlides not found in PacketBuilder.jsx')
  for (const [name, m] of [['makeDoc', doc], ['makeSlides', slides]]) {
    assert.doesNotMatch(m[0], /res\.ok/, `${name} must not branch on res.ok - it would discard a real docUrl on a warnings-only ok:false`)
    assert.match(m[0], /res\.error/, `${name} must still branch on res.error`)
    assert.match(m[0], /res\.(docUrl|deckUrl)/, `${name} must patch the returned url unconditionally`)
  }
})

test('OppDetail.makeDoc never branches on r.ok - only r.error, and always keeps docUrl', () => {
  const m = OPP_DETAIL_SRC.match(/const makeDoc = async[\s\S]{0,400}?\n  \}/)
  assert.ok(m, 'makeDoc not found in OppDetail.jsx')
  assert.doesNotMatch(m[0], /r\.ok\b/, 'makeDoc must not branch on r.ok - it would discard a real docUrl on a warnings-only ok:false')
  assert.match(m[0], /r\.error/, 'makeDoc must still branch on r.error')
  assert.match(m[0], /r\.docUrl/, 'makeDoc must patch docUrl unconditionally')
})

// ── GAP 2: the judge-outcome retention control ──────────────────────────────────────────────────

test('api.js exposes judge-outcome-prefs GET/PATCH with ?owner= on both, PATCH via patch_ (route is GET/PATCH-only)', () => {
  const getM = API_SRC.match(/judgeOutcomePrefsGet:\s*\(\)\s*=>\s*get\(([^)]*)\)/)
  assert.ok(getM, 'judgeOutcomePrefsGet not found in api.js')
  assert.match(getM[1], /\/app\/judge-outcome-prefs/)
  assert.match(getM[1], /owner=/)

  const setM = API_SRC.match(/judgeOutcomePrefsSet:\s*\([^)]*\)\s*=>\s*patch_\(([^)]*)\)/)
  assert.ok(setM, 'judgeOutcomePrefsSet not found in api.js, or it does not use patch_ (the route is registered GET/PATCH only, not POST)')
  assert.match(setM[1], /\/app\/judge-outcome-prefs/)
  assert.match(setM[1], /owner=/)
})

test('Settings.jsx: JudgeOutcomeRetentionSettings loads via judgeOutcomePrefsGet and saves via judgeOutcomePrefsSet', () => {
  const m = SETTINGS_SRC.match(/function JudgeOutcomeRetentionSettings\(\)[\s\S]*?\n\}/)
  assert.ok(m, 'JudgeOutcomeRetentionSettings not found in Settings.jsx')
  assert.match(m[0], /api\.judgeOutcomePrefsGet\(\)/)
  assert.match(m[0], /api\.judgeOutcomePrefsSet\(/)
})

test('Settings.jsx: the retention control is actually mounted in the quality tab, not dead code', () => {
  assert.match(SETTINGS_SRC, /active === 'quality'[\s\S]{0,200}<JudgeOutcomeRetentionSettings \/>/)
})

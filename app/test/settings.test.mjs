// The Settings screen's pure logic. See app/src/settings.js for why this file exists at all: the
// screen built to stop settings being unreachable had its own unreachable logic, and a defect that
// blanked a third of its controls lived there undetected.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chkValueFor } from '../src/settings.js'

// The shape the API actually publishes: some settings are scalars, some are [lo, hi] pairs, and the
// COLUMNS are always per-end. That mismatch is the whole defect.
const CHECKS = {
  skillMaxChars: 24,
  evidenceEscalateMax: 8,
  gateAdvisory: false,
  coverWords: [250, 400],
  resumeSummaryWords: [55, 60],
  aboutMe1Words: [45, 48],
  skillsTotal: [20, 22],
}

test('H:chk-pair-columns-are-not-blank: a _min/_max column reads its END of a published pair', () => {
  // Every one of these rendered EMPTY before, because `coverWordsMin` is not a key the API sends.
  assert.equal(chkValueFor('chk_cover_words_min', CHECKS), 250)
  assert.equal(chkValueFor('chk_cover_words_max', CHECKS), 400)
  assert.equal(chkValueFor('chk_resume_summary_words_min', CHECKS), 55)
  assert.equal(chkValueFor('chk_resume_summary_words_max', CHECKS), 60)
  assert.equal(chkValueFor('chk_about_me1_words_min', CHECKS), 45)
  assert.equal(chkValueFor('chk_skills_total_max', CHECKS), 22)
})

test('H:chk-scalar-is-never-read-as-half-a-pair: a direct hit always wins', () => {
  // `evidenceEscalateMax` ENDS IN Max and is a scalar. Splitting on the suffix first would look for
  // an `evidenceEscalate` pair, find the boolean-ish escalate flag, and read a nonsense index.
  assert.equal(chkValueFor('chk_evidence_escalate_max', CHECKS), 8)
  assert.equal(chkValueFor('chk_skill_max_chars', CHECKS), 24)
  // A legitimate `false` is a value, not an absence.
  assert.equal(chkValueFor('chk_gate_advisory', CHECKS), false)
  // And a legitimate 0 must survive, or a threshold of zero reads as unset.
  assert.equal(chkValueFor('chk_cover_words_min', { coverWords: [0, 400] }), 0)
})

test('H:chk-absent-stays-absent: nothing is invented for a setting the payload lacks', () => {
  assert.equal(chkValueFor('chk_nothing_here', CHECKS), undefined)
  assert.equal(chkValueFor('chk_cover_words_min', {}), undefined)
  assert.equal(chkValueFor('chk_cover_words_min', { coverWords: 'not a pair' }), undefined)
  assert.equal(chkValueFor('chk_cover_words_min', { coverWords: [null, 400] }), undefined)
  assert.equal(chkValueFor('', CHECKS), undefined)
  assert.equal(chkValueFor('chk_cover_words_min', null), undefined)
})

test('H:settings-uses-the-shared-mapper: the screen does not re-derive the lookup inline', () => {
  const src = readFileSync(new URL('../src/screens/Settings.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /chkValueFor\(column, p\.checks\)/, 'Settings must read values through the mapper')
  assert.ok(!/p\.checks\[\s*k\s*\]/.test(src), 'the inline camel lookup is back — that is the defect')
})

// ── The master profile editor's UI half ─────────────────────────────────────────────────────────
//
// These three are SOURCE guards, and that is a deliberate second-best. The component is not
// extractable without a refactor nobody asked for, so what a runtime test cannot reach is asserted
// against the source instead -- with the comments stripped first, because a guard that fires on
// prose is one people learn to ignore (this repo has shipped two of those).

/** The body of the MasterProfileSettings component, comments removed. */
const masterProfileSource = () => {
  const all = readFileSync(new URL('../src/screens/Settings.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const i = all.indexOf('function MasterProfileSettings()')
  assert.ok(i > 0, 'MasterProfileSettings must exist -- the slice is the guard, so an absent component is a failure')
  const j = all.indexOf('\nconst SECTIONS', i)
  assert.ok(j > i, 'the component must still sit above SECTIONS, or this slice silently reads the wrong code')
  return all.slice(i, j)
}

// H:master-profile-ui-keeps-edits-on-failure -- AC10. A save that fails must not cost the owner
// their typing. The mechanism is ordering: `saved` (the baseline the boxes are diffed against) is
// reconciled ONLY after the response has been checked, so on the failure path every edit is still
// in its textarea. Asserted as ordering rather than as presence, because a `setSaved` moved above
// the check reads identically line by line and loses the edit.
//
// MUTATION that must make this FIRE: move `setSaved({ ...saved, ...patch })` above the
// `if (!r || r.ok === false) throw` line, or add a `setSaved`/`setVals(saved)` into the catch block.
test('H:master-profile-ui-keeps-edits-on-failure: the baseline moves only after a checked success', () => {
  const body = masterProfileSource()
  const check = body.indexOf('r.ok === false) throw')
  const commit = body.indexOf('setSaved({ ...saved, ...patch })')
  assert.ok(check > 0, 'the save must check the response before believing it')
  assert.ok(commit > 0, 'a successful save must reconcile the baseline')
  assert.ok(check < commit,
    'the failure check must come BEFORE the baseline is moved -- reversing them discards the edit')
  const cat = body.slice(body.indexOf('} catch (e) {', check))
  assert.ok(!/setSaved|setVals/.test(cat.slice(0, cat.indexOf('finally'))),
    'the catch block must not touch the edited text or the baseline')
})

// H:master-profile-ui-sends-only-changed -- AC2/AC4 on the client side. The route upserts partially,
// but that only helps if the screen sends a partial body: posting all 14 blocks would rewrite the
// thirteen the owner did not touch with whatever the form was holding, and bump their updated_at.
//
// MUTATION that must make this FIRE: build the patch from `blocks` instead of `changed`.
test('H:master-profile-ui-sends-only-changed: an untouched block is not in the request body', () => {
  const body = masterProfileSource()
  assert.match(body, /for \(const k of changed\) patch\[k\]/,
    'the patch must be built from the CHANGED keys, not from every block')
  assert.ok(!/for \(const b of blocks\) patch\[/.test(body),
    'building the patch from every block is the full-resave defect')
  assert.match(body, /api\.masterProfileSet\(patch\)/, 'and it is the patch that gets sent')
})

// H:master-profile-ui-standing-note -- AC11. "Packets already built keep their original wording" is
// STANDING copy: true whether or not a save just happened. A version of it that only appears after a
// successful save is one the owner reads once and never again, which is exactly when they need it.
//
// MUTATION that must make this FIRE: delete the note, or move it inside a `note?.ok &&` conditional.
test('H:master-profile-ui-standing-note: the already-built warning is not gated on a save', () => {
  const body = masterProfileSource()
  const NOTE = 'Packets already built keep their original wording'
  const at = body.indexOf(NOTE)
  assert.ok(at > 0, 'the standing note must be on the screen')

  // Its own opening tag must be rendered UNCONDITIONALLY. Checked structurally -- what sits before
  // the tag on its line, and the line above it -- rather than by scanning a fixed window of
  // characters. The first version of this guard did scan a window, 240 characters wide, and
  // mutate.sh returned INERT: `{note?.ok && (` fell about twelve characters outside it, so the
  // guard was reading a window that could not contain what it was looking for. A window is a
  // magic number; the enclosing tag is a fact about the code.
  const tag = body.lastIndexOf('<div', at)
  assert.ok(tag > 0 && tag < at, 'the note must sit inside an element')
  const lineStart = body.lastIndexOf('\n', tag) + 1
  const prevLineStart = body.lastIndexOf('\n', lineStart - 2) + 1
  const GATED = /\bnote[?.\w]*\s*(&&|\?)/   // only a conditional ON THE SAVE BANNER, not any `)}`
  for (const [what, seg] of [['on its own line', body.slice(lineStart, tag)],
                             ['on the line above', body.slice(prevLineStart, lineStart)]]) {
    assert.ok(!GATED.test(seg),
      `the standing note is gated on save state ${what} -- it must be true whether or not a save `
      + 'just happened, or the owner reads it once and never again')
  }
})

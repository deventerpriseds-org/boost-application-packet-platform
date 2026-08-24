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

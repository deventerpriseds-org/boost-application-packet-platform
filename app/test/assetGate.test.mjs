// Unit tests for the per-asset gate drawer's pure logic (app/src/assetGate.js).
// Node 22's built-in runner, no DOM, no new dependency — the same constraint overlay.test.mjs and
// api/ work under.
//   cd app && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  footerFor, reconcile, reviewerAttention, scoreParts,
  gateMeta, stateMeta, checkLabel, fieldLabel, assetLabel, STATE_META,
} from '../src/assetGate.js'

test('the footer follows the SERVER gate, and never invents permission', () => {
  // No payload and "never checked" are BOTH blocking. The absence of a verdict is not a pass:
  // approvalBlock() in api/src/functions/tests/appChecks.ts returns
  // "no checks have been run for this artifact" for a missing artifact_gate row, and the UI must
  // agree with it rather than offering a button the server will 409.
  assert.equal(footerFor(null).disabled, true)
  assert.equal(footerFor(undefined).disabled, true)
  const unchecked = footerFor({ gate: null, attention: 0 })
  assert.equal(unchecked.kind, 'unchecked')
  assert.equal(unchecked.disabled, true)
  assert.match(unchecked.reason, /no checks have been run/)

  const pass = footerFor({ gate: 'pass', attention: 0 })
  assert.equal(pass.kind, 'pass')
  assert.equal(pass.label, 'Approve')
  assert.equal(pass.disabled, false)
  assert.equal(pass.needsReason, undefined)
})

test('a fail is disabled AND carries the reason; it can never become an override', () => {
  const f = footerFor({ gate: 'fail', attention: 3 })
  assert.equal(f.disabled, true)
  assert.equal(f.needsReason, undefined, 'a fail must never offer the exception path (409 server-side)')
  assert.match(f.reason, /3 blocking finding\(s\)/)
  assert.match(f.reason, /cannot be overridden/)
  assert.notEqual(f.reason, '', 'a disabled action with no reason is a dead end')
})

test('a warn asks for a reason first, and stops asking once one is recorded', () => {
  const needs = footerFor({ gate: 'warn', attention: 2, override: null })
  assert.equal(needs.needsReason, true)
  assert.equal(needs.disabled, false)
  assert.equal(needs.label, 'Approve with exceptions')
  assert.match(needs.reason, /2 finding\(s\) need an explicit override with a reason/)

  const done = footerFor({ gate: 'warn', attention: 2, override: { by: 'von.ellis@enterpriseds.io', at: '2026-08-20T00:00:00Z', reason: 'client accepted the shorter summary' } })
  assert.equal(done.needsReason, undefined)
  assert.equal(done.disabled, false)
  assert.match(done.reason, /von\.ellis@enterpriseds\.io accepted these findings/)
  assert.match(done.reason, /client accepted the shorter summary/)
})

test('P8.5-AC2: a gate that disagrees with its own findings is REPORTED, not smoothed over', () => {
  // The reference prototype computes its badge from ATTENTION (non-pass checks + open items + loose
  // terms + mirrors, qc/data.js:641) while gateFor() reads CHECKS alone (:548), so it can render
  // gate `pass` beside a badge saying "1 to fix". Here the badge and the gate come from ONE payload,
  // so this can only fire on a genuine server-side contradiction — and it must fire loudly.
  assert.equal(reconcile({ gate: 'pass', attention: 0, results: [{ state: 'pass', engine: 'deterministic' }] }), null)

  const green_but_dirty = reconcile({ gate: 'pass', attention: 1, results: [{ state: 'warn', engine: 'deterministic' }] })
  assert.ok(green_but_dirty, 'pass beside a non-zero count must never render silently')
  assert.ok(green_but_dirty.some((p) => /gate reads pass while 1 finding/.test(p)))

  const miscount = reconcile({ gate: 'warn', attention: 4, results: [{ state: 'warn', engine: 'deterministic' }] })
  assert.ok(miscount.some((p) => /counted 4 finding\(s\).*sent 1 such row/.test(p)),
    'the badge count and the listed rows must be the same set')
})

test('D6: only the deterministic rules may produce a fail', () => {
  const reviewerOnly = reconcile({ gate: 'fail', attention: 1, results: [{ state: 'fail', engine: 'reviewer' }] })
  assert.ok(reviewerOnly && reviewerOnly.some((p) => /may never block an asset on its own/.test(p)))
  // A deterministic fail is the legitimate way to reach `fail` — no complaint.
  assert.equal(reconcile({ gate: 'fail', attention: 1, results: [{ state: 'fail', engine: 'deterministic' }] }), null)
  // A reviewer fail alongside a warn gate is exactly D6 working; nothing to report.
  assert.equal(reconcile({ gate: 'warn', attention: 1, results: [{ state: 'fail', engine: 'reviewer' }] }), null)
})

test('the badge count splits into rules + reviewer without losing a finding', () => {
  const result = {
    gate: 'warn', attention: 3,
    results: [
      { state: 'fail', engine: 'deterministic' },
      { state: 'warn', engine: 'deterministic' },
      { state: 'fail', engine: 'reviewer' },
      { state: 'pass', engine: 'deterministic' },
      { state: 'not_applicable', engine: 'deterministic' },
    ],
  }
  assert.equal(reconcile(result), null, 'this payload is self-consistent')
  const rev = reviewerAttention(result)
  assert.equal(rev, 1)
  // Split shown in the drawer header: rules + reviewer must equal the badge exactly, or a finding
  // appears to vanish between tabs.
  assert.equal((result.attention - rev) + rev, result.attention)
  assert.equal(result.attention - rev, 2)
})

test('not_applicable is its own state and is never dressed as a pass', () => {
  assert.notEqual(stateMeta('not_applicable').tone, stateMeta('pass').tone)
  assert.equal(stateMeta('not_applicable').tone, 'panel')
  assert.match(stateMeta('not_applicable').label, /not checked/i)
  assert.ok(!/clear/i.test(stateMeta('not_applicable').label), 'must not read as clear')
  // Every state the engine can emit has an entry; an unknown one degrades to grey, never to green.
  for (const s of ['pass', 'warn', 'fail', 'not_applicable']) assert.ok(STATE_META[s])
  assert.equal(stateMeta('something_new').tone, 'panel')
})

test('a missing gate reads as "not checked", never as clear', () => {
  assert.equal(gateMeta(null).word, 'Not checked')
  assert.equal(gateMeta(undefined).tone, 'panel')
  assert.equal(gateMeta('pass').word, 'Clear')
  assert.notEqual(gateMeta(null).tone, gateMeta('pass').tone)
})

test('a score component with no value carries the server prose for WHY, never a 0', () => {
  // artifact_score stores each value beside its own _source column precisely so a null can explain
  // itself. Rendering 0, or a blank, would read as a measured result.
  const parts = scoreParts({
    must_have_coverage: 80, must_have_source: '4/5 must-have requirements covered',
    keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet',
    seniority_alignment: null, seniority_source: 'not graded - the independent reviewer (P4) has not run',
  })
  assert.equal(parts.length, 3)
  const missing = parts.filter((p) => p.value == null)
  assert.equal(missing.length, 2)
  for (const m of missing) {
    assert.ok(m.source && m.source.length > 0, `${m.key} must say why it has no value`)
    assert.notEqual(m.value, 0, 'null must never be rendered as zero')
  }
  assert.deepEqual(scoreParts(null), [], 'no score row at all is an empty list, not a fabricated one')
})

test('unknown keys degrade to something readable rather than disappearing', () => {
  assert.equal(checkLabel('must_have_coverage'), 'Must-haves this document covers')
  assert.equal(checkLabel('a_check_added_later'), 'a check added later')
  assert.equal(fieldLabel('SkillsBullets1'), 'Skills, column 1')
  assert.equal(fieldLabel('SomeNewMergeField'), 'SomeNewMergeField')
  assert.equal(assetLabel('compact_resume'), 'Compact resume')
  assert.equal(assetLabel('some_new_type'), 'some new type')
  assert.equal(assetLabel(null), 'Asset')
})

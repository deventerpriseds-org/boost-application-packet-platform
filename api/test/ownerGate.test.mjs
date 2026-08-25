import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runChecks } from '../dist/functions/tests/checks.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const find = (rows, k) => rows.find((r) => r.check_key === k)
const PKG = { ResumeSummary: 'Led platform engineering across three business units.' }
const cited = (swaps) => find(runChecks({ type: 'resume', pkg: PKG, swaps }), 'changes_cited')

test('H:owner-edit-never-fails-the-gate: the owner is not accused of not justifying their own resume', () => {
  // DECISION B, direction one. Before this, an owner who rewrote a line got their packet FAILED and
  // their own words printed as the offender - the gate demanding they justify their resume to the
  // tool. Measured shape: the rebuild re-derives the swap, normItem no longer matches the original,
  // the row lands 'swapped' + 'unattributed', and changes_cited fails on it.
  const r = cited([
    { action: 'swapped', driver: 'owner', to_label: 'Supplier negotiation', from_label: 'Vendor selection' },
    { action: 'swapped', driver: 'posting', to_label: 'Roadmap ownership', from_label: 'Roadmaps' },
  ])
  assert.equal(r.state, 'pass', 'an owner edit beside a cited change must not fail the packet')
  assert.ok(!JSON.stringify(r.offenders || []).includes('Supplier negotiation'),
    'the owner\'s own words must never be named as an offender')
  // Excluded from the DENOMINATOR too, not merely from the offenders: "all 2 changes cited" would
  // be a claim about a row this check did not judge.
  assert.match(r.observed, /all 1 changes? cited/, `denominator must exclude the owner row: ${r.observed}`)
})

test('H:owner-edit-never-buys-a-citation: the quieter failure, and the more dangerous one', () => {
  // DECISION B, direction two. attribute() marks a row 'posting' at containment >= ATTRIBUTION
  // _THRESHOLD, so an owner edit that happened to overlap some requirement would have SILENTLY
  // bought a citation and turned the gate green. A green light nobody earned is worse than a red
  // one nobody deserved, because nothing prompts anyone to look at it.
  //
  // An owner row is neither cited nor uncited - it is not this check's business at all.
  const onlyOwner = cited([
    { action: 'swapped', driver: 'owner', to_label: 'Supplier negotiation', from_label: 'Vendor selection' },
  ])
  assert.equal(onlyOwner.state, 'pass')
  assert.match(onlyOwner.observed, /nothing was swapped or added/,
    `an owner-only packet has nothing for THIS check to judge: ${onlyOwner.observed}`)

  // and a genuinely uncited MODEL change still fails, with the owner row absent from both counts
  const mixed = cited([
    { action: 'swapped', driver: 'owner', to_label: 'Supplier negotiation', from_label: 'Vendor selection' },
    { action: 'added', driver: 'unattributed', to_label: 'Quantum cryptography', from_label: null },
  ])
  assert.equal(mixed.state, 'fail', 'the gate must still catch what the MODEL did')
  assert.deepEqual(mixed.offenders, ['added: Quantum cryptography'])
  assert.match(mixed.observed, /1 of 1 changes cite nothing/, mixed.observed)
})

test('H:driver-domain-parity: the driver domain is declared in three places and they must agree', () => {
  // Same failure class as H:correction-ddl-parity one migration earlier. Three homes, and a fourth
  // that fails SILENTLY - see the next test.
  const schema = read('../src/functions/tests/schema.ts')
  const inline = /driver\s+text not null check \(driver in \(([^)]*)\)\)/.exec(schema)
  assert.ok(inline, 'schema.ts must declare the driver domain')
  const alter = /alter table swap_decision\s+drop constraint if exists swap_decision_driver_check;\s*alter table swap_decision\s+add constraint swap_decision_driver_check\s*\n?\s*check \(driver in \(([^)]*)\)\)/i.exec(schema)
  assert.ok(alter, 'a new driver value is unreachable on an EXISTING database without an idempotent ALTER')

  const norm = (s) => s.split(',').map((v) => v.trim().replace(/^'|'$/g, '')).sort()
  const fromTs = (src, name) => {
    const m = new RegExp(`export type ${name} = ([^\\n]*)`).exec(src)
    return m[1].split('|').map((v) => v.trim().replace(/^'|'$/g, '')).sort()
  }
  const domains = {
    'schema.ts inline CHECK': norm(inline[1]),
    'schema.ts ALTER': norm(alter[1]),
    'swaps.ts Driver': fromTs(read('../src/functions/tests/swaps.ts'), 'Driver'),
    'compactFit.ts SwapDriver': fromTs(read('../src/functions/tests/compactFit.ts'), 'SwapDriver'),
  }
  const sigs = Object.entries(domains).map(([n, d]) => [n, d.join('|')])
  assert.equal(new Set(sigs.map(([, s]) => s)).size, 1,
    `the driver domain DISAGREES across its homes:\n${sigs.map(([n, s]) => `  ${n}: ${s}`).join('\n')}`)
})

test('H:new-driver-needs-owner-facing-copy: a raw enum value must never reach the screen', () => {
  // THE SILENT HOME. Both render sites end in `String(s.driver || '')`, a deliberate fallthrough
  // that shows the raw word rather than guessing at a meaning. Correct - and it means a new driver
  // ships as the literal string `owner` on the owner's screen unless BOTH sites are updated, with
  // no test and no type error to catch it. Identical shape to CORRECTION_SOURCE's fallthrough,
  // which is how a half-migration stayed invisible earlier the same day.
  for (const f of ['../../app/src/screens/AssetGateDrawer.jsx', '../../app/src/screens/QcRail.jsx']) {
    const src = read(f)
    assert.ok(/s\.driver === 'owner'/.test(src), `${f} renders a driver but does not handle 'owner'`)
    assert.ok(/you changed this yourself/.test(src), `${f} must say who acted, in the owner's words`)
  }
  // THE THIRD SITE, missed by the first version of this guard. It interpolates the raw enum into a
  // list item's status, so 'owner' shipped as the bare word while the two sites above read fine.
  // Found by an independent verifier. The lesson is in the guard's own title: "a raw enum value
  // must never reach the screen" is a claim about EVERY screen, and a loop over two of three places
  // asserts something narrower than what it says.
  const derive = read('../../app/src/assetBlocks.js')
  const interpolations = [...derive.matchAll(/\$\{swap\.driver\}/g)]
  assert.ok(interpolations.length > 0, 'the status line must still exist')
  assert.match(derive, /swap\.driver === 'owner' \? `\$\{swap\.action\} · you changed this`/,
    'assetBlocks.js interpolates the raw driver and must special-case owner before it')
})

// ── THE GUARD THAT WAS MISSING, AND WHY DECISION B SHIPPED INERT ────────────────────────────────

import { buildSwaps } from '../dist/functions/tests/swaps.js'

test('H:owner-driver-is-actually-produced: the exemption must have something to exempt', () => {
  // FOUND BY AN INDEPENDENT VERIFIER, NOT BY THE GUARDS ABOVE, and that is the lesson.
  // H:owner-edit-never-fails-the-gate passed from the day it was written - on a hand-built
  // {driver:'owner'} fixture the system NEVER PRODUCED. swaps.ts emitted only 'rule', 'posting' and
  // 'unattributed'; nothing anywhere wrote 'owner'. So the exemption in changes_cited was
  // unreachable, and the failure it claims to prevent - the gate failing a packet and naming the
  // owner's own words - was still live in production while its guard sat green.
  //
  // This test runs the REAL buildSwaps. A guard that only ever sees fixtures it built itself proves
  // that the code agrees with the fixture, not that the system produces the fixture.
  const pkg = { SkillsBullets1: 'Supplier negotiation\nStakeholder alignment' }
  // Newline-separated STRINGS: splitItems() reads these, and an array joins into one item, which
  // is how the first version of this test produced a phantom extra row and failed for the wrong
  // reason. The fixture has to be the shape the pipeline actually receives or the test proves
  // nothing about it.
  const call1 = { skills1: 'Vendor selection\nStakeholder alignment' }
  const call3 = { skills1: 'Supplier negotiation\nStakeholder alignment' }

  // WITHOUT the owner's label: exactly the live failure. The rebuild cannot explain the change.
  const blind = buildSwaps({ call1, call3, pkg, requirements: [] })
  const blindChanged = blind.swaps.filter((s) => s.action === 'swapped' || s.action === 'added')
  assert.ok(blindChanged.length > 0, 'the fixture must produce a change to reason about')
  assert.ok(blindChanged.every((s) => s.driver !== 'owner'),
    'nothing may claim owner-authorship without being told')

  // WITH it: the row is the owner's, and changes_cited stops accusing them.
  const seen = buildSwaps({ call1, call3, pkg, requirements: [], ownerLabels: ['Supplier negotiation'] })
  const mine = seen.swaps.find((s) => s.to_label === 'Supplier negotiation')
  assert.ok(mine, 'the owner-edited label must appear as a row')
  assert.equal(mine.driver, 'owner', 'the real pipeline must emit the driver the gate exempts')

  const before = find(runChecks({ type: 'resume', pkg, swaps: blind.swaps }), 'changes_cited')
  const after = find(runChecks({ type: 'resume', pkg, swaps: seen.swaps }), 'changes_cited')
  assert.equal(before.state, 'fail', 'the un-flagged case must still fail - that IS the live bug')
  assert.ok(JSON.stringify(before.offenders).includes('Supplier negotiation'),
    'and it must be the owner\'s own words being named')
  assert.notEqual(after.state, 'fail', 'flagged as the owner\'s, the gate must stop failing the packet')
  assert.ok(!JSON.stringify(after.offenders || []).includes('Supplier negotiation'))
})

test('H:owner-label-match-is-exact: a paraphrase must not inherit the exemption', () => {
  // The model's rewording of the owner's phrase is still the MODEL'S change. A fuzzy membership
  // test here would hand the model the owner's exemption from the gate, which is the quieter half
  // of decision B wearing a different hat.
  const pkg = { SkillsBullets1: 'Supplier negotiations\nStakeholder alignment' }
  const built = buildSwaps({
    call1: { skills1: 'Vendor selection\nStakeholder alignment' },
    call3: { skills1: 'Supplier negotiations\nStakeholder alignment' },
    pkg, requirements: [], ownerLabels: ['Supplier negotiation'],   // singular vs plural
  })
  const near = built.swaps.find((s) => s.to_label === 'Supplier negotiations')
  assert.ok(near, 'the near-miss row must exist')
  assert.notEqual(near.driver, 'owner', 'a near miss is not the owner\'s wording')
})

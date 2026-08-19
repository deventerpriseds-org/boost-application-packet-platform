// P1.3 — skill_candidate / swap_decision. Field names and separators mirror the REAL pipeline
// (pipeline.ts buildPackageForJD Call-1/Call-3, mt17.assemblePackage).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitItems, similarity, attribute, buildSwaps, LISTS, LIST_FIELDS,
  SWAP_THRESHOLD, ATTRIBUTION_THRESHOLD,
} from '../dist/functions/tests/swaps.js'

const REQS = [
  { seq: 0, verbatim: 'You will own the integrated product roadmap for corporate hiring technology', item_text: 'Own the roadmap', kind: 'responsibility' },
  { seq: 1, verbatim: 'Minimum of 10 years of product management experience', item_text: '10+ years', kind: 'must_have' },
  { seq: 2, verbatim: null, item_text: 'Kubernetes exposure', kind: 'nice_to_have' },
]

test('splitItems matches the pipeline separators and strips bullet glyphs', () => {
  assert.deepEqual(splitItems('• Roadmap ownership\n• P&L management'), ['Roadmap ownership', 'P&L management'])
  assert.deepEqual(splitItems('A | B · C'), ['A', 'B', 'C'])
  assert.deepEqual(splitItems(''), [])
  assert.deepEqual(splitItems(null), [])
  assert.deepEqual(splitItems(undefined), [])
})

test('similarity is symmetric, bounded, and ignores filler words', () => {
  assert.equal(similarity('Roadmap ownership', 'Roadmap ownership'), 1)
  assert.equal(similarity('a', ''), 0)
  const x = similarity('Proven experience leading roadmap strategy', 'Roadmap strategy leadership')
  assert.equal(x, similarity('Roadmap strategy leadership', 'Proven experience leading roadmap strategy'))
  assert.ok(x > 0 && x <= 1)
})

test('attribute cites the employer words, never a paraphrase', () => {
  const a = attribute('Owned the integrated product roadmap for hiring technology', REQS)
  assert.equal(a.seq, 0)
  assert.equal(a.quote, REQS[0].verbatim, 'the quote must be the posting text, not item_text')
  assert.ok(a.confidence >= ATTRIBUTION_THRESHOLD)
  // A requirement with no located verbatim can never supply a citation.
  assert.equal(attribute('Kubernetes exposure across clusters', [REQS[2]]), null)
  assert.equal(attribute('Completely unrelated clinical trial work', REQS), null)
})

test('an unchanged item still produces a row — "kept" is data, not noise', () => {
  const r = buildSwaps({
    call1: { skills1: 'Roadmap ownership\nP&L management' },
    call3: {}, pkg: { SkillsBullets1: 'Roadmap ownership\nP&L management' },
    requirements: REQS,
  })
  const s1 = r.swaps.filter(x => x.list === 'skills_1')
  assert.equal(s1.length, 2)
  assert.ok(s1.every(x => x.action === 'kept'))
  assert.equal(r.itemCount, 2)
})

test('a kept row is never presented as posting-driven', () => {
  const r = buildSwaps({
    call1: { skills1: 'Own the integrated product roadmap for corporate hiring technology' },
    call3: {}, pkg: { SkillsBullets1: 'Own the integrated product roadmap for corporate hiring technology' },
    requirements: REQS,
  })
  const kept = r.swaps.find(x => x.action === 'kept')
  assert.equal(kept.driver, 'unattributed')
  assert.equal(kept.verbatim_quote, null, 'nothing changed, so the posting did not drive anything')
})

test('a reworded item is a swap carrying a real quote, not a drop plus an add', () => {
  const r = buildSwaps({
    call1: { relevant1: 'Led product roadmap work' },
    call3: {}, pkg: { RelevantBullets1: 'Owned the integrated product roadmap for corporate hiring technology' },
    requirements: REQS,
  })
  const s = r.swaps.filter(x => x.list === 'relevant_1')
  assert.equal(s.length, 1)
  assert.equal(s[0].action, 'swapped')
  assert.equal(s[0].driver, 'posting')
  assert.equal(s[0].verbatim_quote, REQS[0].verbatim)
  assert.ok(s[0].confidence > 0)
})

test('an unrelated replacement is a drop AND an add, never a false swap', () => {
  const r = buildSwaps({
    call1: { skills2: 'Clinical trial submissions to the FDA' },
    call3: {}, pkg: { SkillsBullets2: 'Vendor contract negotiation' },
  })
  const acts = r.swaps.filter(x => x.list === 'skills_2').map(x => x.action).sort()
  assert.deepEqual(acts, ['added', 'dropped'])
  assert.ok(SWAP_THRESHOLD > 0 && SWAP_THRESHOLD < 1)
})

test('two originals collapsing onto one final give swapped + merged, never two swaps', () => {
  const r = buildSwaps({
    call1: { skills1: 'Product roadmap ownership\nProduct roadmap strategy' },
    call3: {}, pkg: { SkillsBullets1: 'Product roadmap ownership and strategy' },
  })
  const acts = r.swaps.filter(x => x.list === 'skills_1').map(x => x.action)
  assert.equal(acts.filter(a => a === 'swapped').length, 1)
  assert.equal(acts.filter(a => a === 'merged').length, 1)
  assert.equal(r.itemCount, 1, 'the document contains ONE bullet — the table must not claim two')
})

test('an added item no requirement explains is UNATTRIBUTED, never laundered as rule-driven', () => {
  const r = buildSwaps({
    call1: { skills1: 'Roadmap ownership' },
    call3: {}, pkg: { SkillsBullets1: 'Roadmap ownership\nQuantum cryptography research' },
    requirements: REQS,
  })
  const added = r.swaps.find(x => x.action === 'added')
  assert.equal(added.driver, 'unattributed')
  assert.equal(added.requirement_seq, null)
  assert.equal(added.verbatim_quote, null)
  assert.equal(r.unattributed, 1, 'this is the count P2.2 must be able to block on')
})

test('every swapped/added row either carries a quote or is counted as unattributed', () => {
  const r = buildSwaps({
    call1: { skills1: 'Led roadmap work', relevant2: 'Ran a team' },
    call3: {},
    pkg: { SkillsBullets1: 'Owned the integrated product roadmap for corporate hiring technology',
           RelevantBullets2: 'Managed vendor relationships' },
    requirements: REQS,
  })
  const changes = r.swaps.filter(x => x.action === 'swapped' || x.action === 'added')
  for (const c of changes) {
    const ok = (c.driver === 'posting' && c.verbatim_quote && c.requirement_seq !== null) || c.driver === 'unattributed'
    assert.ok(ok, `row is neither cited nor counted as a failure: ${JSON.stringify(c)}`)
  }
  assert.equal(changes.length, r.swaps.filter(x => ['swapped','added'].includes(x.action)).length)
})

test('candidates cover every item across all five lists, including unchanged ones', () => {
  const call1 = { skills1: 'A one\nB two', skills2: 'C three', relevant1: 'D four', relevant2: 'E five', relevant3: 'F six' }
  const pkg = { SkillsBullets1: 'A one\nB two', SkillsBullets2: 'C three', RelevantBullets1: 'D four',
                RelevantBullets2: 'E five', RelevantBullets3: 'G seven' }
  const r = buildSwaps({ call1, call3: {}, pkg })
  assert.equal(r.itemCount, 6)
  // 6 originals + 1 genuinely new final
  assert.equal(r.candidates.length, 7)
  assert.deepEqual([...new Set(r.candidates.map(c => c.list))].sort(), [...LISTS].sort())
  assert.ok(r.candidates.every(c => c.char_len === c.label.length))
})

test('pass_b origin is recorded for items only the ATS pass produced', () => {
  const r = buildSwaps({ call1: { skills1: 'A one' }, call3: {}, pkg: { SkillsBullets1: 'A one\nZ nine' } })
  assert.equal(r.candidates.find(c => c.label === 'A one').origin, 'pass_a')
  assert.equal(r.candidates.find(c => c.label === 'Z nine').origin, 'pass_b')
})

test('an item already in the standing profile is marked profile_original', () => {
  const r = buildSwaps({
    call1: { skills1: 'Enterprise architecture governance' }, call3: {},
    pkg: { SkillsBullets1: 'Enterprise architecture governance' },
    profileText: 'Twenty years of enterprise architecture governance and platform strategy.',
  })
  assert.equal(r.candidates[0].origin, 'profile_original')
})

test('falls back to call3 when assemblePackage produced no merged value', () => {
  const r = buildSwaps({ call1: { skills1: 'A one' }, call3: { finalSkills1: 'B two' }, pkg: {} })
  assert.equal(r.itemCount, 1)
  assert.equal(r.swaps.filter(x => x.list === 'skills_1').length, 2)   // dropped + added
})

test('empty everything is survivable and produces no rows', () => {
  const r = buildSwaps({ call1: {}, call3: {}, pkg: {} })
  assert.deepEqual(r.candidates, []); assert.deepEqual(r.swaps, [])
  assert.equal(r.itemCount, 0); assert.equal(r.unattributed, 0)
})

test('buildSwaps is deterministic and makes no model call', () => {
  const input = { call1: { skills1: 'Led roadmap work' }, call3: {}, pkg: { SkillsBullets1: 'Owned the product roadmap' }, requirements: REQS }
  assert.deepEqual(buildSwaps(input), buildSwaps(input))
  assert.deepEqual(Object.keys(LIST_FIELDS).sort(), [...LISTS].sort())
})

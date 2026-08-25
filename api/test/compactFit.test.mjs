// The compact resume's single Core Skills line, and the decision to DELETE a skill from a document
// the owner sends to employers. That is the reason this file is thorough out of proportion to the
// module's size.
//
// Owner's instruction: "the skills are broken into two columns in the regular resume but its a
// single block in the compact resume so i think you should be starting with taking the two and
// making them one as a part of generating the compact resume. if overspill of space becomes an
// issue, it should be flagged. the least relevent item could be removed to make it fit and i should
// be notified that happened in the right margin."
import test from 'node:test'
import assert from 'node:assert/strict'
import { fitCompactSkills, DEFAULT_SEPARATOR } from '../dist/functions/tests/compactFit.js'

const P = (label, action, driver, requirementId = null, seq = null) => ({ label, action, driver, requirementId, seq })

test('H:compact-combines-both-lists-in-document-order', () => {
  const r = fitCompactSkills({ skills1: ['A', 'B'], skills2: ['C', 'D'], budget: 999 })
  assert.deepEqual(r.kept, ['A', 'B', 'C', 'D'], 'both columns become one line, order preserved')
  assert.equal(r.text, ['A', 'B', 'C', 'D'].join(DEFAULT_SEPARATOR))
  assert.equal(r.fits, true)
  assert.deepEqual(r.dropped, [], 'nothing is removed when it already fits')
})

test('H:compact-dedupes-across-the-two-lists', () => {
  // The full resume hides a duplicate in two columns; one block does not. Collapsed once, and the
  // FIRST occurrence wins so document order is what survives.
  const r = fitCompactSkills({ skills1: ['Kubernetes', 'AWS'], skills2: ['kubernetes ', 'Terraform'], budget: 999 })
  assert.deepEqual(r.kept, ['Kubernetes', 'AWS', 'Terraform'])
})

test('H:compact-never-drops-a-posting-answer: evidence is not deleted to save space', () => {
  // THE CENTRAL SAFETY PROPERTY. An item answering a requirement is what the packet's coverage
  // claims rest on. Dropping one to fit would make the resume disagree with its own evidence.
  const skills1 = ['Master One', 'Master Two', 'Master Three']
  const skills2 = ['Platform Modernization', 'Master Four']
  const provenance = [
    P('Master One', 'kept', 'unattributed', null, 0),
    P('Master Two', 'kept', 'unattributed', null, 1),
    P('Master Three', 'kept', 'unattributed', null, 2),
    P('Platform Modernization', 'swapped', 'posting', 'req-1', 3),
    P('Master Four', 'kept', 'unattributed', null, 4),
  ]
  const r = fitCompactSkills({ skills1, skills2, provenance, budget: 25 })
  assert.ok(r.kept.includes('Platform Modernization'), 'the posting-driven skill must survive')
  assert.ok(!r.dropped.some((d) => d.label === 'Platform Modernization'))
})

test('H:compact-drop-order-is-master-content-first-then-posting-added', () => {
  // The measured tiers (live swap_decision over skills_1/skills_2, 2026-08-24):
  //   swapped+posting 4 -> never dropped
  //   swapped/added+unattributed 9 -> pipeline put it here FOR this posting
  //   kept+unattributed 27 -> master content answering nothing: the drop pool
  const items = ['Keep Me Posting', 'Added For This', 'Master Filler']
  const provenance = [
    P('Keep Me Posting', 'swapped', 'posting', 'req-1', 0),
    P('Added For This', 'added', 'unattributed', null, 1),
    P('Master Filler', 'kept', 'unattributed', null, 2),
  ]
  // Budget forces exactly one drop.
  const full = items.join(DEFAULT_SEPARATOR).length
  const r = fitCompactSkills({ skills1: items, skills2: [], provenance, budget: full - 1 })
  assert.equal(r.dropped.length, 1)
  assert.equal(r.dropped[0].label, 'Master Filler', 'master content answering nothing goes first')
  assert.match(r.dropped[0].reason, /master list/i, 'the margin must say WHY this one')
})

test('H:compact-drops-only-as-far-as-the-budget-requires', () => {
  // Removing more than necessary is the same defect as removing the wrong one: it is content the
  // owner wrote, gone for no reason.
  const items = ['AAAA', 'BBBB', 'CCCC', 'DDDD']
  const prov = items.map((l, i) => P(l, 'kept', 'unattributed', null, i))
  const full = items.join(DEFAULT_SEPARATOR).length
  const r = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget: full - 1 })
  assert.equal(r.dropped.length, 1, 'one item over budget removes exactly one item')
  assert.ok(r.text.length <= r.budget)
})

test('H:compact-tie-breaks-on-position-deterministically', () => {
  // Same rank across the pool: the END of the line goes first, and repeated calls agree. A
  // non-deterministic pick would delete a different skill on every rebuild.
  const items = ['One', 'Two', 'Three', 'Four']
  const prov = items.map((l, i) => P(l, 'kept', 'unattributed', null, i))
  const budget = items.join(DEFAULT_SEPARATOR).length - 1
  const a = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget })
  const b = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget })
  assert.deepEqual(a.dropped.map((d) => d.label), ['Four'], 'the last item goes first')
  assert.deepEqual(a.dropped, b.dropped, 'the same inputs must always drop the same item')
})

test('H:compact-over-budget-after-drops-is-declared-not-hidden', () => {
  // Everything left answers the posting and it STILL does not fit. Deleting one of those would
  // remove the evidence the coverage claims depend on, so it ships long and says so.
  const items = ['Posting Skill Number One', 'Posting Skill Number Two']
  const prov = items.map((l, i) => P(l, 'swapped', 'posting', `req-${i}`, i))
  const r = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget: 5 })
  assert.deepEqual(r.dropped, [], 'no posting answer may be dropped')
  assert.equal(r.fits, false)
  assert.equal(r.overBudgetAfterDrops, true, 'the overflow must be declared')
  assert.ok(r.text.includes('Posting Skill Number One'), 'the content still ships')
})

test('H:compact-no-provenance-is-treated-as-master-content-not-as-protected', () => {
  // Absent evidence must never grant protection. A skill with no recorded row is master content
  // until something says otherwise — the inverse would make an unrecorded item undroppable and the
  // line could never be made to fit.
  const items = ['AAAA', 'BBBB', 'CCCC']
  const full = items.join(DEFAULT_SEPARATOR).length
  const r = fitCompactSkills({ skills1: items, skills2: [], budget: full - 1 })
  assert.equal(r.dropped.length, 1, 'an unrecorded skill is droppable')
})

test('H:compact-separator-counts-against-the-budget', () => {
  // The joiner is real text in the rendered line. Ignoring it under-counts and the document
  // overflows anyway — a budget that lies is worse than no budget.
  const items = ['AAAA', 'BBBB']
  const r = fitCompactSkills({ skills1: items, skills2: [], budget: 8 })   // 4+4 fits, 4+3+4 does not
  assert.equal(r.fullLength, ('AAAA' + DEFAULT_SEPARATOR + 'BBBB').length)
  assert.ok(r.fullLength > 8, 'the separator is part of the measured length')
  assert.equal(r.dropped.length, 1)
})

test('H:compact-empty-input-is-not-an-error', () => {
  const r = fitCompactSkills({ skills1: [], skills2: [], budget: 10 })
  assert.equal(r.text, '')
  assert.equal(r.fits, true)
  assert.deepEqual(r.dropped, [])
})

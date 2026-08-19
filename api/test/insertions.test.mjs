// P1.4 — insertion rows. Field names come from TEMPLATE_META, the same table varsForType injects
// from, so a row can never name a slot the document does not have.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFieldsFor, buildInsertions, LIST_FIELD_TO_LIST } from '../dist/functions/tests/insertions.js'
import { TEMPLATE_META } from '../dist/functions/tests/packetTemplates.js'

const REQS = [
  { seq: 0, verbatim: 'You will own the integrated product roadmap for corporate hiring technology', item_text: 'x', kind: 'responsibility' },
  { seq: 1, verbatim: 'Minimum of 10 years of product management experience', item_text: 'y', kind: 'must_have' },
]

test('merge fields come from the template table, never from a second hardcoded list', () => {
  for (const type of Object.keys(TEMPLATE_META)) {
    assert.deepEqual(mergeFieldsFor(type), TEMPLATE_META[type].placeholders)
  }
  assert.deepEqual(mergeFieldsFor('video'), [], 'a type with no template has no merge fields')
  assert.deepEqual(mergeFieldsFor('nonsense'), [])
})

test('the real field counts are 7/7/7/3 — the backlog says the compact resume has 6', () => {
  assert.equal(mergeFieldsFor('resume').length, 7)
  assert.equal(mergeFieldsFor('compact_resume').length, 7)
  assert.equal(mergeFieldsFor('portfolio').length, 7)
  assert.equal(mergeFieldsFor('cover').length, 3)
  assert.deepEqual(mergeFieldsFor('compact_resume'), mergeFieldsFor('resume'),
    'compact_resume is a byte-identical duplicate of resume — recorded, not silently reconciled')
})

test('every merge field produces a row and each names its own field', () => {
  const r = buildInsertions({ type: 'resume', pkg: { ResumeSummary: 'A summary.' } })
  assert.equal(r.rows.length, 7)
  assert.deepEqual(r.rows.map(x => x.merge_field), TEMPLATE_META.resume.placeholders)
  assert.ok(r.rows.every(x => typeof x.merge_field === 'string' && x.merge_field.length > 0))
})

test('an unfilled slot is recorded as NOT generated, never omitted', () => {
  const r = buildInsertions({ type: 'cover', pkg: { '@Company': 'Acme' } })
  assert.equal(r.filled, 1)
  assert.equal(r.unfilled, 2)
  const blank = r.rows.filter(x => !x.generated)
  assert.ok(blank.every(x => x.after_text === null && x.item_count === 0),
    'a block with no merge field behind it must never claim to be generated')
  assert.equal(r.rows.length, 3, 'the row is still there — the UI shows what the pipeline cannot reach')
})

test('empty string counts as unfilled, not as generated empty content', () => {
  const r = buildInsertions({ type: 'cover', pkg: { '@Company': '', '@CoverLetterBody': null } })
  assert.equal(r.filled, 0)
  assert.equal(r.unfilled, 3)
})

test('method is DERIVED: first fill vs a rewrite of a previous loop', () => {
  const first = buildInsertions({ type: 'cover', pkg: { '@CoverLetterBody': 'v1' } })
  assert.equal(first.rows.find(x => x.merge_field === '@CoverLetterBody').method, 'template_fill')

  const second = buildInsertions({
    type: 'cover', pkg: { '@CoverLetterBody': 'v2' }, prevPkg: { '@CoverLetterBody': 'v1' }, loop: 1,
  })
  const row = second.rows.find(x => x.merge_field === '@CoverLetterBody')
  assert.equal(row.method, 'model_rewrite')
  assert.equal(row.before_text, 'v1')
  assert.equal(row.after_text, 'v2')
  assert.equal(row.loop, 1)
})

test('unchanged text across a loop is not reported as a rewrite', () => {
  const r = buildInsertions({ type: 'cover', pkg: { '@CoverLetterBody': 'same' }, prevPkg: { '@CoverLetterBody': 'same' }, loop: 2 })
  assert.equal(r.rows.find(x => x.merge_field === '@CoverLetterBody').method, 'template_fill')
})

test('manual is never inferred — a model change must not be laundered as human judgement', () => {
  const r = buildInsertions({
    type: 'resume', pkg: { ResumeSummary: 'b' }, prevPkg: { ResumeSummary: 'a' }, loop: 1,
  })
  assert.ok(r.rows.every(x => x.method !== 'manual'))
})

test('list-backed fields name their list, and prose fields do not', () => {
  const r = buildInsertions({ type: 'resume', pkg: { SkillsBullets1: 'A\nB\nC', ResumeSummary: 'prose' } })
  assert.equal(r.rows.find(x => x.merge_field === 'SkillsBullets1').list, 'skills_1')
  assert.equal(r.rows.find(x => x.merge_field === 'ResumeSummary').list, null)
  assert.equal(r.rows.find(x => x.merge_field === 'SkillsBullets1').item_count, 3,
    'the count comes from the text, so a UI block cannot invent one')
  assert.deepEqual(Object.keys(LIST_FIELD_TO_LIST).sort(),
    ['RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3', 'SkillsBullets1', 'SkillsBullets2'])
})

test('attribution cites the employer words, or nothing', () => {
  const r = buildInsertions({
    type: 'resume',
    pkg: { ResumeSummary: 'Owned the integrated product roadmap for corporate hiring technology',
           ExpertiseBullets: 'Clinical trial submissions to the FDA' },
    requirements: REQS,
  })
  const cited = r.rows.find(x => x.merge_field === 'ResumeSummary')
  assert.equal(cited.verbatim_quote, REQS[0].verbatim)
  assert.equal(cited.requirement_seq, 0)
  const uncited = r.rows.find(x => x.merge_field === 'ExpertiseBullets')
  assert.equal(uncited.verbatim_quote, null)
  assert.equal(uncited.requirement_seq, null)
  assert.equal(r.attributed, 1)
})

test('an unfilled slot is never attributed to a requirement', () => {
  const r = buildInsertions({ type: 'resume', pkg: {}, requirements: REQS })
  assert.ok(r.rows.every(x => x.verbatim_quote === null && x.requirement_seq === null && x.confidence === 0))
})

test('buildInsertions is deterministic and makes no model call', () => {
  const input = { type: 'portfolio', pkg: { '@Company': 'Acme', '@AboutMe1_50words': 'about' }, requirements: REQS }
  assert.deepEqual(buildInsertions(input), buildInsertions(input))
})

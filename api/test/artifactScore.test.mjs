// P2.3 — the decomposed per-artifact score. The rule that matters: a component with no honest
// source is null, and the composite is null unless all three are present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeArtifactScore, bandFor, DEFAULT_WEIGHTS, ENGINE_VERSION } from '../dist/functions/tests/artifactScore.js'

const check = (state, observed = '', offenders = []) =>
  ({ check_key: 'must_have_coverage', engine: 'deterministic', state, observed, expected: '', offenders })

const REQS = [
  { seq: 0, kind: 'must_have' }, { seq: 1, kind: 'must_have' },
  { seq: 2, kind: 'must_have' }, { seq: 3, kind: 'must_have' },
  { seq: 4, kind: 'responsibility' },
]

test('the weights are the ones the backlog specifies', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, { mustHave: 0.5, keyword: 0.3, seniority: 0.2 })
  assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 1)
})

test('must-have coverage is READ from the check, not recomputed', () => {
  const r = computeArtifactScore({
    requirements: REQS,
    checks: [check('fail', '3/4 must-haves covered', ['#2 Deep Kubernetes experience'])],
  })
  assert.equal(r.must_have_coverage.value, 75)
  assert.deepEqual(r.uncovered_requirement_seqs, [2], 'the uncovered requirement is named, so the number is clickable')
  assert.match(r.must_have_coverage.source, /3\/4/)
})

test('full coverage is 100 and names nothing', () => {
  const r = computeArtifactScore({ requirements: REQS, checks: [check('pass', '4/4 must-haves covered')] })
  assert.equal(r.must_have_coverage.value, 100)
  assert.deepEqual(r.uncovered_requirement_seqs, [])
})

// ---- the honesty rules ---------------------------------------------------------------------
test('THE composite is null unless all three components exist', () => {
  const r = computeArtifactScore({ requirements: REQS, checks: [check('pass', '4/4 covered')] })
  assert.equal(r.must_have_coverage.value, 100)
  assert.equal(r.keyword_coverage.value, null)
  assert.equal(r.seniority_alignment.value, null)
  assert.equal(r.composite, null, 'a composite from 1 of 3 components is a fabricated number')
  assert.equal(r.band, null)
})

test('a missing component is never treated as a zero', () => {
  const r = computeArtifactScore({
    requirements: REQS, checks: [check('pass', '4/4 covered')],
    keyword: { covered: 10, scoreable: 10 },
  })
  assert.equal(r.composite, null, 'still missing seniority — must not score 0.5*100 + 0.3*100 + 0.2*0')
})

test('every unavailable component SAYS WHY, so the UI can explain the gap', () => {
  const r = computeArtifactScore({ requirements: REQS, checks: [check('not_applicable', 'no requirement rows')] })
  assert.match(r.must_have_coverage.source, /not applicable/)
  assert.match(r.keyword_coverage.source, /no published term-library version/)
  assert.match(r.seniority_alignment.source, /reviewer \(P4\) has not run/)
})

test('an empty term library yields null keyword coverage, never 0 and never 100', () => {
  for (const kw of [null, undefined, { covered: 0, scoreable: 0 }]) {
    assert.equal(computeArtifactScore({ keyword: kw }).keyword_coverage.value, null)
  }
  assert.equal(computeArtifactScore({ keyword: { covered: 3, scoreable: 12 } }).keyword_coverage.value, 25)
})

test('seniority is a stored reviewer input, clamped, never inferred', () => {
  assert.equal(computeArtifactScore({ seniority: 82 }).seniority_alignment.value, 82)
  assert.equal(computeArtifactScore({ seniority: 140 }).seniority_alignment.value, 100)
  assert.equal(computeArtifactScore({ seniority: -5 }).seniority_alignment.value, 0)
  assert.match(computeArtifactScore({ seniority: 82 }).seniority_alignment.source, /reviewer-graded/)
})

test('a posting with no must-haves yields null, not 100', () => {
  const r = computeArtifactScore({
    requirements: [{ seq: 0, kind: 'responsibility' }],
    checks: [check('pass', '0/0')],
  })
  assert.equal(r.must_have_coverage.value, null, 'nothing to cover is not the same as covering everything')
})

// ---- the full composite --------------------------------------------------------------------
test('with all three present the composite is the weighted sum, and banded', () => {
  const r = computeArtifactScore({
    requirements: REQS, checks: [check('pass', '4/4 covered')],
    keyword: { covered: 8, scoreable: 10 },   // 80
    seniority: 90,
  })
  assert.equal(r.composite, Math.round(100 * 0.5 + 80 * 0.3 + 90 * 0.2))   // 92
  assert.equal(r.composite, 92)
  assert.equal(r.band, 'strong')
})

test('bands: >=85 strong, 70-84 acceptable, <70 needs work', () => {
  assert.equal(bandFor(85), 'strong')
  assert.equal(bandFor(84), 'acceptable')
  assert.equal(bandFor(70), 'acceptable')
  assert.equal(bandFor(69), 'needs_work')
  assert.equal(bandFor(null), null)
})

test('weights and bands are overridable — nothing here is a permanent constant', () => {
  const args = { requirements: REQS, checks: [check('pass', '4/4 covered')], keyword: { covered: 5, scoreable: 10 }, seniority: 50 }
  assert.equal(computeArtifactScore(args).composite, Math.round(100 * 0.5 + 50 * 0.3 + 50 * 0.2))
  const custom = computeArtifactScore({ ...args, weights: { mustHave: 1, keyword: 0, seniority: 0 } })
  assert.equal(custom.composite, 100)
  assert.equal(computeArtifactScore({ ...args, bands: { strong: 99, acceptable: 98 } }).band, 'needs_work')
})

test('recomputing with the same inputs and engine_version reproduces the number exactly', () => {
  const args = { requirements: REQS, checks: [check('fail', '3/4', ['#1 x'])], keyword: { covered: 7, scoreable: 9 }, seniority: 71 }
  assert.deepEqual(computeArtifactScore(args), computeArtifactScore(args))
  assert.equal(computeArtifactScore(args).engine_version, ENGINE_VERSION)
})

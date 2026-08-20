// P2.3 — the decomposed per-artifact score. The rule that matters: a component with no honest
// source is null, and the composite is null unless all three are present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runChecks } from '../dist/functions/tests/checks.js'
import {
  computeArtifactScore, bandFor, DEFAULT_WEIGHTS, ENGINE_VERSION,
  judgedMustHaveIds, mustHaveSource, parseMustHaveSource,
} from '../dist/functions/tests/artifactScore.js'

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

// ---- D16: which rows the engine judged, read rather than re-derived --------------------------

const JUDGED_REQS = [
  { id: 'r0', seq: 0, kind: 'must_have' },      // eligibility — checks.ts excludes it from coverable
  { id: 'r1', seq: 1, kind: 'must_have' },      // owned by the owner's facts — also excluded
  { id: 'r2', seq: 2, kind: 'must_have' },      // judged, covered
  { id: 'r3', seq: 3, kind: 'must_have' },      // judged, uncovered
  { id: 'r4', seq: 4, kind: 'responsibility' }, // never part of must-have coverage
]

test('the judged set never includes a row the check excluded from its denominator', () => {
  const judged = judgedMustHaveIds(JUDGED_REQS, {
    must_have_coverage: 50, must_have_source: mustHaveSource(1, 2), uncovered_requirement_ids: ['r3'],
  })
  assert.ok(!judged.includes('r0'), 'an eligibility clause the engine never judged')
  assert.ok(!judged.includes('r1'), 'a fact-owned row the engine never judged')
  assert.ok(!judged.includes('r4'), 'a responsibility is not a must-have')
  assert.deepEqual(judged, ['r3'],
    'the covered judged row is not identifiable from the score row, so it stays out — understating, never inventing')
})

test('when the check judged every must-have, every must-have is comparable', () => {
  const judged = judgedMustHaveIds(JUDGED_REQS, {
    must_have_coverage: 75, must_have_source: mustHaveSource(3, 4), uncovered_requirement_ids: ['r3'],
  })
  assert.deepEqual([...judged].sort(), ['r0', 'r1', 'r2', 'r3'])
})

test('no coverage verdict means nothing was judged', () => {
  assert.deepEqual(judgedMustHaveIds(JUDGED_REQS, { must_have_coverage: null, must_have_source: null }), [])
  assert.deepEqual(judgedMustHaveIds(JUDGED_REQS, undefined), [])
})

test('an unreadable must_have_source falls back to the named rows, never to every must-have', () => {
  const judged = judgedMustHaveIds(JUDGED_REQS, {
    must_have_coverage: 50, must_have_source: 'coverage was measured somehow', uncovered_requirement_ids: ['r3'],
  })
  assert.deepEqual(judged, ['r3'])
})

test('a recorded judged set wins over every inference', () => {
  const judged = judgedMustHaveIds(JUDGED_REQS, {
    must_have_coverage: 50, must_have_source: mustHaveSource(1, 2),
    uncovered_requirement_ids: ['r3'], judged_requirement_ids: ['r2', 'r3'],
  })
  assert.deepEqual(judged, ['r2', 'r3'])
})

test('must_have_source round-trips through its own parser', () => {
  assert.deepEqual(parseMustHaveSource(mustHaveSource(3, 7)), { covered: 3, judged: 7 })
  assert.deepEqual(parseMustHaveSource(mustHaveSource(0, 1)), { covered: 0, judged: 1 })
  assert.equal(parseMustHaveSource('the posting produced no must-haves'), null)
  assert.equal(parseMustHaveSource(null), null)
})

test('the source the scorer actually stores is one the parser can read', () => {
  const score = computeArtifactScore({
    requirements: REQS,
    checks: [check('fail', '1/2 must-haves evidenced (2 not reachable by any generated field, not counted either way)', ['#3 x'])],
  })
  assert.deepEqual(parseMustHaveSource(score.must_have_coverage.source), { covered: 1, judged: 2 })
})

test('the coverage check publishes exactly the rows it judged, and the writer stores them', () => {
  // D16's completion. `judged_requirement_ids` closes the gap `judgedMustHaveIds` could only
  // half-infer: without it, a run where SOME must-haves were excluded leaves the judged-and-covered
  // rows unknown, so they fall to `not_comparable` — understating agreement rather than inventing
  // it, but still not the truth.
  //
  // The set must come FROM the check. `coverable` is checks.ts's predicate; a second copy of it in
  // the writer or in appReviewer is the R4 defect this column exists to close.
  const reqs = [
    { id: 'a1', seq: 1, kind: 'must_have', item_text: 'Lead a platform engineering organisation at scale' },
    { id: 'a2', seq: 2, kind: 'must_have', item_text: 'Reside in the East Coast of the United States' },
  ]
  const rows = runChecks({ type: 'resume', pkg: { ResumeSummary: 'Led platform engineering.' }, requirements: reqs, swaps: [],
    postingText: 'Lead a platform engineering organisation at scale. Reside in the East Coast of the United States.',
    profileText: 'Led platform engineering organisations at scale.',
    // The REAL EvidenceInput shape: { profileReadable, bySeq }, keyed by seq. My first version of
    // this fixture invented `{ readable, byRequirement }`, so profileReadable was undefined, the
    // check bailed to not_applicable, and the whole test passed while measuring nothing — it stayed
    // green with the defect reinstated. A fixture in the wrong shape is a test that cannot fail.
    evidence: {
      profileReadable: true,
      bySeq: {
        1: { quote: 'Led platform engineering organisations at scale', source_kind: 'work_history',
             source_label: 'Platform lead', source_key: 'work:1', char_start: 0, char_end: 46,
             method: 'exact', ratio: 1, extra: null, record_sha256: 'f'.repeat(64), resolver_version: 1 },
        2: null,
      },
    } })

  const cov = rows.find(r => r.check_key === 'must_have_coverage')
  assert.ok(cov, 'no coverage row at all')
  if (cov.state === 'not_applicable') {
    assert.ok(!cov.judged || cov.judged.length === 0,
      'a check that reached NO verdict must not claim to have judged anything')
  } else {
    assert.ok(Array.isArray(cov.judged), 'the coverage check did not publish its judged set')
    // The eligibility row is excluded from `coverable`, so it must NOT appear as judged — that is
    // the whole defect: it was being scored as agreeing or disagreeing with the reviewer.
    assert.ok(!cov.judged.includes('a2'),
      'an eligibility row the check EXCLUDED was published as judged')
    assert.ok(cov.judged.length < reqs.length,
      'judged equals every must-have — the exclusion is not reflected, which is the defect')
  }
})

test('the writer stores what the check published, never its own recomputation', () => {
  // A source rule, because the assertion is about where a value COMES FROM, which no runtime test
  // can see: both a read and a recomputation produce a plausible array.
  const src = readFileSync(new URL('../src/functions/tests/appChecks.ts', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(src, /results\.find\(r => r\.check_key === 'must_have_coverage'\)\?\.judged/,
    'the writer no longer reads the judged set from the check')
  assert.ok(!/kind === 'must_have'/.test(src),
    'appChecks recomputes the must-have population — that is the second copy of the predicate')
})

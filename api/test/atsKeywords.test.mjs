// The interim keyword score — the ATS keyword list from the resume's own Call-1 pass, scored
// against the text that SHIPPED.
//
// THE FIXTURE IS THE OWNER'S REAL TABLE, read out of production on 2026-09-02 (packet 85cee965,
// opp 9f9c370a) rather than invented. That is the whole reason this module is shaped as it is: the
// owner asked for the parse to be built against real data instead of against the prompt, and the
// real data carried a `<th>` header row the prompt does not mention. A hand-written fixture would
// have matched the prompt, passed, and shipped a denominator one too large forever.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseAtsKeywords, keywordPresent, atsCoverage, atsCoverageSource, ATS_SHIPPED_FIELDS,
} from '../dist/functions/tests/atsKeywords.js'
import { computeArtifactScore } from '../dist/functions/tests/artifactScore.js'

/** Verbatim shape from production: a `<th>` header row, then one `<tr>` per keyword, three `<td>`. */
const LIVE_TABLE = `<table>
  <tr><th>ATS Optimized Keywords</th><th>Skills &amp; Relevant Skills Covered</th><th>Location</th></tr>
  <tr><td>Engineering Execution</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Technology Strategy</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Resource Allocation</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Governance Frameworks</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Engineering Leadership</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Technology Evaluation</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Business Alignment</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Leadership Experience</td><td>Missing</td><td>Missing</td></tr>
  <tr><td>Regulated Industries</td><td>Missing</td><td>Missing</td></tr>
</table>`

/** What actually shipped for that packet: 6 of the 9 keywords are present, 3 are not. */
const SHIPPED = [
  'Engineering Execution\nTechnology Strategy\nResource Allocation',
  'Governance Frameworks\nBusiness Alignment',
  'Engineering Leadership',
]

test('H:ats-header-row-is-not-a-keyword: the denominator is 9, not 10', () => {
  // THE OFF-BY-ONE THE REAL DATA CAUGHT. The owner's prompt describes three columns and never
  // mentions a header; the model emits one anyway. Counting it would inflate every denominator by
  // one, in the same direction, on every packet — a silently wrong score rather than a broken one.
  const kws = parseAtsKeywords(LIVE_TABLE)
  assert.equal(kws.length, 9, `expected 9 keywords, got ${kws.length}: ${kws.join(', ')}`)
  assert.ok(!kws.some(k => /ATS Optimized Keywords/i.test(k)), 'the header leaked into the keyword list')
  assert.equal(kws[0], 'Engineering Execution')
  assert.equal(kws[8], 'Regulated Industries')

  // A MIXED HEADER IS WHAT MAKES THE `<th>` SKIP LOAD-BEARING, and without this case the skip is
  // behaviourally equivalent to the `<td>` requirement below it — proven by mutation: deleting the
  // skip changed nothing, because the live header carries `<th>` cells only and has no `<td>` to
  // pick up. A model that emits `<th>` for the first cell and `<td>` for the rest is ordinary
  // output, and against that the skip is the only thing standing between a header label and the
  // denominator.
  const mixedHeader = `<table>
    <tr><th>ATS Optimized Keywords</th><td>Skills Covered</td><td>Location</td></tr>
    <tr><td>Business Alignment</td><td>Missing</td><td>Missing</td></tr>
  </table>`
  assert.deepEqual(parseAtsKeywords(mixedHeader), ['Business Alignment'],
    'a header row with any <td> put its label in the keyword list — the denominator is inflated ' +
    'and one entry can never be covered')
})

test('H:ats-numerator-comes-from-what-shipped: never from the table\'s own Missing column', () => {
  // THE DEFECT THIS MODULE EXISTS TO PREVENT, pinned on the real numbers.
  //
  // Every column-2 cell in the live table reads "Missing", so a parser that trusted it would report
  // 0/9. Six of those nine are in the shipped document. Measured against production 2026-09-02:
  // reading column 2 tells the owner their resume places NONE of the posting's keywords while it
  // places two thirds of them. The table is a true statement about the PRE-SWAP draft — Call 1
  // writes it, Call 3's merge runs afterwards — so it describes a document that no longer exists.
  const c = atsCoverage(LIVE_TABLE, SHIPPED)
  assert.equal(c.total, 9)
  assert.equal(c.covered, 6,
    'THE NUMERATOR CAME FROM THE STALE COLUMN. Every column-2 cell says "Missing" and six of the ' +
    'nine keywords are present in the shipped skills text; a covered count of 0 means the parser ' +
    'read the pre-swap table instead of the document.')
  const missed = c.rows.filter(r => !r.covered).map(r => r.keyword)
  assert.deepEqual(missed, ['Technology Evaluation', 'Leadership Experience', 'Regulated Industries'])
})

test('H:ats-source-names-itself: an interim number never claims to be library coverage', () => {
  // The owner must be able to attribute a jump in this number to a SOURCE change rather than wonder
  // what happened to their resume. `artifactScore` hardcoded "scoreable library terms present" —
  // true while the library was the only possible source, a lie the moment this one existed.
  const c = atsCoverage(LIVE_TABLE, SHIPPED)
  const src = atsCoverageSource(c)
  assert.match(src, /6\/9 ATS keywords/)
  assert.match(src, /interim/)
  assert.ok(!/library term/i.test(src), 'an interim measurement must not describe itself as library coverage')

  // ...and it survives into the score, rather than being replaced by the library wording.
  const s = computeArtifactScore({
    requirements: [], checks: [],
    keyword: { covered: c.covered, scoreable: c.total, source: src },
  })
  assert.equal(s.keyword_coverage.value, 67)
  assert.equal(s.keyword_coverage.source, src)
})

test('H:ats-absent-is-null-never-zero: three ways to have no number, none of them 0%', () => {
  // Absent evidence is not a measurement. `round(0/N*100)` renders as a confident, measured-looking
  // 0% — the fabricated-composite failure, and the one most likely to be believed.
  for (const [label, cov] of [
    ['no table at all',      atsCoverage(null, SHIPPED)],
    ['empty table body',     atsCoverage('   ', SHIPPED)],
    ['unparseable body',     atsCoverage('Missing ATS Skills: none found.', SHIPPED)],
    ['no shipped text yet',  atsCoverage(LIVE_TABLE, [null, '', undefined])],
  ]) {
    assert.equal(cov.covered, null, `${label} must be null`)
    assert.equal(cov.total, null, `${label} must have no denominator`)
    assert.ok(cov.reason && cov.reason.length > 10, `${label} must say why in the owner's terms`)
    assert.ok(!/^0/.test(String(cov.covered)), `${label} must not be zero`)
  }
  // ...and a null component makes the composite null rather than a partial number.
  const s = computeArtifactScore({ requirements: [], checks: [], keyword: null, seniority: 95 })
  assert.equal(s.composite, null, 'a missing component must null the composite, never be skipped')
})

test('H:ats-match-is-whole-phrase: a score component never accuses on a fuzzy match', () => {
  // Fuzzy matching is for RANKING, never for ACCUSING — and here the error direction is the bad
  // one: a loose match INFLATES the number a reviewer trusts most.
  assert.equal(keywordPresent('Engineering Leadership', 'Engineering Leadership at scale'), true)
  assert.equal(keywordPresent('engineering leadership', 'ENGINEERING LEADERSHIP'), true, 'case-insensitive')
  assert.equal(keywordPresent('Engineering Leadership', 'Engineering  \n  Leadership'), true, 'whitespace collapses')
  // The near-miss that a similarity threshold would wrongly accept:
  assert.equal(keywordPresent('Leadership Experience', 'Engineering Leadership'), false,
    'two keywords sharing a word are not the same keyword')
  assert.equal(keywordPresent('Regulated Industries', 'Regulated industry experience'), false,
    'a stem match is not a phrase match')
  assert.equal(keywordPresent('', 'anything'), false)
})

test('H:ats-shipped-fields-exclude-the-summary: no scoring off the posting\'s own words', () => {
  // ResumeSummary is prose the remediation loop is KNOWN to stuff with posting wording (open row:
  // "Stop the remediation loop stuffing ResumeSummary with JD wording"). Counting a keyword because
  // it appears there would let the document score itself on the employer's words — what checks.ts
  // calls "a document repeating words back at itself".
  assert.ok(!ATS_SHIPPED_FIELDS.includes('ResumeSummary'), 'the summary must not feed the numerator')
  assert.ok(!ATS_SHIPPED_FIELDS.includes('CoverLetterBody'))
  for (const f of ['SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets',
                   'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3']) {
    assert.ok(ATS_SHIPPED_FIELDS.includes(f), `${f} is a skills slot and must count`)
  }
})

test('H:ats-column-one-missing-is-not-a-keyword: a shifted table does not invent one', () => {
  // A model that shifts its columns puts "Missing" in column 1. Scoring against a keyword literally
  // named Missing would be a denominator entry nothing could ever cover.
  const shifted = `<table>
    <tr><th>K</th><th>C</th><th>L</th></tr>
    <tr><td>Missing</td><td>Governance Frameworks</td><td>Skills1</td></tr>
    <tr><td>Business Alignment</td><td>Missing</td><td>Missing</td></tr>
  </table>`
  assert.deepEqual(parseAtsKeywords(shifted), ['Business Alignment'])
})

test('H:ats-keywords-deduplicate: one keyword listed twice is one denominator entry', () => {
  const dupes = `<table>
    <tr><td>Business Alignment</td><td>Missing</td><td>Missing</td></tr>
    <tr><td>business alignment</td><td>Missing</td><td>Missing</td></tr>
  </table>`
  assert.equal(parseAtsKeywords(dupes).length, 1, 'a repeated keyword must not double the denominator')
})

test('H:ats-match-has-word-boundaries: a prefix is not a keyword', () => {
  // REFUTED BY AN INDEPENDENT VERIFIER (VERIFY-ats-keyword-score-1.md, C6). `keywordPresent`'s own
  // header claimed "whole-phrase ... and nothing cleverer" while the implementation was an unguarded
  // substring test. The shipped cases only probed multi-word near-misses, never a short keyword that
  // is a PREFIX of a longer word — and real ATS lists are full of single terms.
  //
  // Every one of these was counted as COVERED before the fix. The direction is the dangerous one:
  // each false positive INFLATES the score.
  for (const [kw, text] of [
    ['Cloud',   'We use Cloudera for data warehousing'],
    ['Program', 'Extensive Programming experience'],
    ['Manage',  'Strong Management background'],
    ['Lead',    'Leadership'],
    ['Test',    'Automated Testing pipeline'],
  ]) {
    assert.equal(keywordPresent(kw, text), false,
      `"${kw}" was counted as present in "${text}" — a prefix of a longer word is not the keyword`)
  }
  // ...while genuine occurrences still match, including at the edges and beside punctuation.
  for (const [kw, text] of [
    ['Cloud',   'Cloud architecture at scale'],
    ['Cloud',   'Delivered cloud'],
    ['Agile',   'Agile, Scrum, Kanban'],
    ['Python',  'Python/Django services'],
    ['C++',     'Shipped C++ tooling'],
    ['.NET',    'Migrated .NET services'],
  ]) {
    assert.equal(keywordPresent(kw, text), true, `"${kw}" is genuinely present in "${text}"`)
  }
})

test('H:ats-all-td-header-is-still-a-header', () => {
  // The residual risk the verifier found attacking C4 past its wording: the `<th>` test was the only
  // defence, so a model rendering the header as `<td><b>ATS Optimized Keywords</b></td>` put its
  // LABEL in the keyword list — a denominator entry no document can ever cover.
  const noTh = `<table>
    <tr><td>ATS Optimized Keywords</td><td>Skills Covered</td><td>Location</td></tr>
    <tr><td>Business Alignment</td><td>Missing</td><td>Missing</td></tr>
    <tr><td>Governance Frameworks</td><td>Missing</td><td>Missing</td></tr>
  </table>`
  assert.deepEqual(parseAtsKeywords(noTh), ['Business Alignment', 'Governance Frameworks'],
    'a header row with no <th> inflated the denominator with its own label')
  // A table that DOES use <th> is unaffected — every <td> row is still a keyword.
  assert.equal(parseAtsKeywords(LIVE_TABLE).length, 9, 'the <th> path must not lose a keyword')
})

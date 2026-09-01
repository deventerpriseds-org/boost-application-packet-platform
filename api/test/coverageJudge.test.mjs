// The document-coverage judge — the piece that replaces `coversIn`'s 70% literal overlap with a
// model's reading, and refuses anything the model cannot point at in the document.
//
// Fixtures are the OWNER'S LIVE TRINNEX ROWS (db-query runs 33465454139 for the requirements,
// 33464691925 for the summary), not invented text, because two ratios in an earlier pass did not
// reproduce against reconstructed wording and that is exactly the class of error these guard.
//
//   cd api && node --test test/coverageJudge.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildCoverageUser, parseCoverageVerdicts, judgeableRequirements, verdictMap,
  COVERAGE_BASES, JUDGE_VERSION,
} from '../dist/functions/tests/coverageJudge.js'

// The live summary, verbatim from insertion.after_text.
const SUMMARY = 'Visionary technology leader with a robust track record in driving enterprise transformations and aligning engineering strategies with business objectives. Adept at building high-performing teams and fostering a culture of collaboration and innovation, delivering scalable and secure software solutions. Proven ability to leverage emerging technologies to enhance operational efficiency, customer outcomes, and measurable business impact.'

const REQS = [
  { seq: 9, kind: 'responsibility', verbatim: 'Build, lead, and develop high-performing engineering managers and technical teams', item_text: '' },
  { seq: 12, kind: 'must_have', verbatim: 'Engineering & Technology Leadership Proven experience leading software engineering organizations', item_text: '' },
  { seq: 15, kind: 'must_have', verbatim: 'Ability to align engineering strategy with business goals', item_text: '' },
]

test('H:judge-quote-must-be-in-the-document', () => {
  // THE accusation-grade check, and the whole reason a model is safe to use here. A verdict claiming
  // coverage with a quote the document does not contain is REFUSED, not shown and not counted —
  // identical in discipline to verifyProposal's indexOf on the profile record.
  const r = parseCoverageVerdicts({ verdicts: [
    { seq: 15, covered: true, basis: 'synonym', quote: 'aligning engineering strategies with business objectives', why: 'same claim, different words' },
    { seq: 12, covered: true, basis: 'near_phrasing', quote: 'a seasoned technology executive', why: 'invented — not in the text' },
  ] }, REQS, SUMMARY)

  assert.equal(r.verdicts.length, 1, 'only the verifiable verdict survives')
  assert.equal(r.verdicts[0].seq, 15)
  assert.equal(r.verdicts[0].covered, true)
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].refusal, 'quote_not_in_field')
  assert.equal(r.refused[0].seq, 12)
})

test('H:judge-refuses-a-claim-it-cannot-support', () => {
  // Four ways a row is thrown away, each named rather than collapsed: "the model said no" and "the
  // model claimed something it cannot show" are different facts about a run.
  const r = parseCoverageVerdicts({ verdicts: [
    { seq: 15, covered: true, basis: 'synonym', quote: '', why: 'no quote given' },
    { seq: 12, covered: true, basis: 'absent', quote: 'Visionary technology leader', why: 'contradicts itself' },
    { seq: 9, covered: true, basis: 'nonsense', quote: 'building high-performing teams', why: 'bad basis' },
    { seq: 99, covered: false, basis: 'absent', quote: null, why: 'not a seq we asked about' },
  ] }, REQS, SUMMARY)

  assert.equal(r.verdicts.length, 0, 'not one of these may count')
  assert.deepEqual(r.refused.map(x => x.refusal).sort(),
    ['bad_basis', 'basis_absent_but_covered', 'covered_without_quote', 'unknown_seq'])
})

test('H:judge-never-invents-an-answer-it-was-not-given', () => {
  // Absent evidence is not_applicable, NEVER a pass and never a fail. A requirement the model did not
  // answer for lands in `unjudged` — it must not appear as `covered: false`, because "the judge said
  // no" and "the judge did not answer" are different and only the caller can decide what the second
  // one means. A run that silently converted one into the other is how a gate goes green on
  // unverified work.
  const r = parseCoverageVerdicts({ verdicts: [
    { seq: 15, covered: false, basis: 'absent', quote: null, why: 'the document does not claim this' },
  ] }, REQS, SUMMARY)

  assert.deepEqual(r.unjudged, [9, 12], 'the two unanswered requirements are reported as unanswered')
  assert.equal(r.verdicts.length, 1)
  assert.equal(r.verdicts[0].covered, false, 'an explicit no IS a verdict and is kept')
  assert.equal(r.verdicts[0].quote, null, 'a negative verdict never carries a quote')
})

test('H:judge-reason-is-required', () => {
  // The reason is what the owner reads to decide whether to overrule. A verdict without one is a
  // number with no argument behind it, which is the thing this whole change exists to stop shipping.
  const r = parseCoverageVerdicts({ verdicts: [
    { seq: 15, covered: true, basis: 'synonym', quote: 'aligning engineering strategies with business objectives', why: '   ' },
  ] }, REQS, SUMMARY)
  assert.equal(r.verdicts.length, 0)
  assert.equal(r.refused[0].refusal, 'no_reason')
})

test('H:judge-quote-is-the-documents-bytes', () => {
  // The stored quote is re-sliced out of the document at the found offsets rather than kept as the
  // model's string. Equal by construction today because indexOf found it; the re-slice costs nothing
  // and closes the gap the day that stops being true.
  const r = parseCoverageVerdicts({ verdicts: [
    { seq: 9, covered: true, basis: 'near_phrasing', quote: 'building high-performing teams', why: 'the document claims team-building' },
  ] }, REQS, SUMMARY)
  assert.equal(r.verdicts[0].quote, 'building high-performing teams')
  assert.ok(SUMMARY.includes(r.verdicts[0].quote), 'the stored quote is a real span of the document')
  assert.equal(r.verdicts[0].judge_version, JUDGE_VERSION, 'every verdict is stamped, so a prompt change is visible in the data')
})

test('H:judge-prompt-forbids-rewarding-vocabulary', () => {
  // AC-5's other half. The failure the owner reported is a document stuffed with the posting's nouns;
  // a judge that counted name-dropping would automate exactly what they objected to. Structural,
  // because the instruction living in the prompt is the only place this can be asserted without a
  // model in the loop.
  const p = buildCoverageUser(REQS, 'ResumeSummary', SUMMARY)
  assert.match(p, /NAMING A TOPIC IS NOT ADDRESSING IT/,
    'the prompt must forbid treating a topic word as evidence of the experience')
  assert.match(p, /Reward the claim, never the keyword/)
  assert.match(p, /`absent` is a correct and useful answer/,
    'the prompt must make an honest gap a good outcome, or the judge stretches')
  assert.match(p, /character for\s+\/\/?\s*|character for/,
    'the prompt must demand a verbatim span')
  // The document is in the prompt; the posting's own sentences are there as the QUESTION, and the
  // model is told to quote the document. A prompt that omitted the text would be asking blind.
  assert.ok(p.includes(SUMMARY), 'the field text must be in the prompt')
})

test('H:judge-skips-what-cannot-be-judged-either-way', () => {
  // Mirrors MIN_JUDGEABLE_TOKENS rather than inventing a second rule. A requirement too thin to judge
  // is reported as uncovered by checks.ts already; sending it to the judge spends a call on an answer
  // the engine is contractually required to ignore.
  const thin = [{ seq: 1, kind: 'must_have', verbatim: 'Own it', item_text: '' }, ...REQS]
  const kept = judgeableRequirements(thin, 3)
  assert.deepEqual(kept.map(r => r.seq), [9, 12, 15], 'the two-token requirement is not sent')
})

test('H:verdict-map-is-per-field', () => {
  // Coverage is a property of (field, requirement), not of the packet. One map per field, because a
  // summary and a skills list answer different lines and merging them would let one field's coverage
  // silently satisfy a check about another.
  const a = parseCoverageVerdicts({ verdicts: [{ seq: 15, covered: true, basis: 'synonym', quote: 'aligning engineering strategies with business objectives', why: 'x' }] }, REQS, SUMMARY)
  const b = parseCoverageVerdicts({ verdicts: [{ seq: 15, covered: false, basis: 'absent', quote: null, why: 'y' }] }, REQS, 'Some other field entirely.')
  const m = verdictMap([{ field: 'ResumeSummary', result: a }, { field: 'SkillsBullets1', result: b }])
  assert.equal(m.get('ResumeSummary').get(15).covered, true)
  assert.equal(m.get('SkillsBullets1').get(15).covered, false)
})

test('H:judge-module-stays-pure', () => {
  // H12's rule, asserted on the new module rather than assumed. The transport is injected exactly as
  // evidenceProposal does it, so every rule above is exercised without a network — which is what
  // keeps the whole api suite deterministic while a model sits in the production path.
  const src = readFileSync(new URL('../src/functions/tests/coverageJudge.ts', import.meta.url), 'utf8')
  for (const banned of ['@azure/functions', "from './pgClient'", 'openaiJson', 'fetch(']) {
    assert.ok(!src.includes(banned), `coverageJudge.ts references ${banned} — it is no longer pure`)
  }
  assert.ok(COVERAGE_BASES.includes('absent'), 'absent is a first-class basis, not an error state')
})

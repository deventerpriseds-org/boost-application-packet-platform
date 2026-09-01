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
  buildCoverageUser, parseCoverageVerdicts, judgeableRequirements, verdictMap, verdictKey,
  combineFieldVerdicts,
  COVERAGE_BASES, JUDGE_VERSION, PROMPT_VERSION,
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

// ─── COMPOSITION: covers() asks about the whole artifact, the judge is asked one field at a time ─

const res = (verdicts, unjudged = []) => ({ verdicts, refused: [], unjudged })
const V = (seq, covered, basis = covered ? 'synonym' : 'absent') => ({
  seq, covered, basis, quote: covered ? 'aligning engineering strategies' : null,
  char_start: covered ? 26 : null, char_end: covered ? 57 : null, why: 'r', judge_version: JUDGE_VERSION,
})

test('H:one-covering-field-covers-the-artifact', () => {
  // `covers()` decides on covText — EVERY present field joined (checks.ts:526,710). A requirement
  // addressed in the cover letter is addressed by the artifact, so the union is the right answer
  // and a per-field "no" beside a per-field "yes" must not cancel it.
  const { verdicts, silent } = combineFieldVerdicts([
    { field: 'ResumeSummary', result: res([V(15, false)]) },
    { field: 'CoverLetterBody', result: res([V(15, true)]) },
  ], [15])
  assert.equal(verdicts.get(15).covered, true)
  assert.equal(verdicts.get(15).field, 'CoverLetterBody', 'and it names the field the quote came from')
  assert.deepEqual(silent, [])
})

test('H:the-strongest-basis-carries-the-quote', () => {
  // Among covering fields the better reading wins, so the stored quote is the best one available
  // rather than whichever field happened to be asked first.
  const { verdicts } = combineFieldVerdicts([
    { field: 'ResumeSummary', result: res([{ ...V(15, true), basis: 'near_phrasing' }]) },
    { field: 'ExecProfile', result: res([{ ...V(15, true), basis: 'direct' }]) },
  ], [15])
  assert.equal(verdicts.get(15).basis, 'direct')
  assert.equal(verdicts.get(15).field, 'ExecProfile')
})

test('H:a-no-needs-every-field-to-have-answered', () => {
  // THE COMPOSITION-LEVEL VERSION OF THE SAME RULE THE PARSER ENFORCES. One field says no and the
  // other never answered — the silent one might have been the field that covered it, so the honest
  // result is silence, not "absent". Reporting a partial answer as a finding is exactly the failure
  // this whole tier is built against, one step below where anyone would look for it.
  const partial = combineFieldVerdicts([
    { field: 'ResumeSummary', result: res([V(15, false)]) },
    { field: 'CoverLetterBody', result: res([], [15]) },
  ], [15])
  assert.equal(partial.verdicts.has(15), false, 'a partially-answered requirement is not a verdict')
  assert.deepEqual(partial.silent, [15])

  // Every field answered no — that IS a no, and it is returned as one.
  const all = combineFieldVerdicts([
    { field: 'ResumeSummary', result: res([V(15, false)]) },
    { field: 'CoverLetterBody', result: res([V(15, false)]) },
  ], [15])
  assert.equal(all.verdicts.get(15).covered, false)
  assert.deepEqual(all.silent, [])
})

test('H:a-requirement-nobody-answered-is-silent', () => {
  const { verdicts, silent } = combineFieldVerdicts(
    [{ field: 'ResumeSummary', result: res([V(15, true)], [12]) }], [15, 12])
  assert.equal(verdicts.get(15).covered, true)
  assert.equal(verdicts.has(12), false, 'never invented as absent')
  assert.deepEqual(silent, [12])
})

// ─── the CACHE KEY: a model answers twice and may differ, so the answer is stored ──────────────

const KEY = { requirement: REQS[2].verbatim, field: 'ResumeSummary', fieldText: SUMMARY, model: 'gpt-4o' }

test('H:verdict-key-changes-with-the-document', () => {
  // AC-8b. One character of an edit is a DIFFERENT DOCUMENT and must miss the cache. Serving the
  // old verdict over edited prose is the stale-answer failure the key exists to prevent — and it
  // would be invisible, because a hit looks exactly like a correct answer.
  const same = verdictKey(KEY)
  assert.equal(same, verdictKey({ ...KEY }), 'identical inputs are one key')
  assert.notEqual(same, verdictKey({ ...KEY, fieldText: SUMMARY.replace('Visionary', 'visionary') }))
  assert.notEqual(same, verdictKey({ ...KEY, requirement: KEY.requirement + '.' }))
  assert.notEqual(same, verdictKey({ ...KEY, field: 'CoverLetter' }))
  assert.notEqual(same, verdictKey({ ...KEY, model: 'gpt-4o-mini' }),
    'a different model is a different judge — the consolidation sweep must invalidate, not inherit')
})

test('H:verdict-key-carries-the-prompt-version', () => {
  // AC-8a. The version is IN the key, so editing the prompt cannot leave every cached verdict
  // answering the old question. Asserted structurally because the constant cannot be varied at
  // runtime: the built key must not be reproducible without the version that produced it.
  const src = readFileSync(new URL('../src/functions/tests/coverageJudge.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export function verdictKey'))
  assert.ok(/PROMPT_VERSION/.test(body), 'verdictKey must include PROMPT_VERSION')
  assert.ok(/JUDGE_VERSION/.test(body), 'verdictKey must include JUDGE_VERSION')
  assert.ok(/input\.model/.test(body), 'verdictKey must include the model')
  assert.ok(/input\.fieldText/.test(body), 'verdictKey must include the field text')
  assert.equal(typeof PROMPT_VERSION, 'number')
  // NUL, not a space or a pipe: a separator that can occur inside a requirement or a document lets
  // two different inputs join to one string.
  assert.ok(/join\('\\u0000'\)/.test(body), 'the separator must be NUL')
})

test('H:verdict-carries-the-offsets-it-was-made-from', () => {
  // The quote and its position are ONE fact. Downstream re-running indexOf is a second
  // implementation of an answer this module already has, and the day they disagree a highlight
  // lands on different words than the verdict was made from.
  const quote = 'aligning engineering strategies with business objectives'
  const r = parseCoverageVerdicts({ verdicts: [
    { seq: 15, covered: true, basis: 'synonym', quote, why: 'same claim, reworded' },
    { seq: 12, covered: false, basis: 'absent', quote: null, why: 'no claim of leading an org' },
  ] }, REQS.slice(1), SUMMARY)
  const v = r.verdicts.find(x => x.seq === 15)
  assert.equal(SUMMARY.slice(v.char_start, v.char_end), quote, 'the offsets index the quote exactly')
  assert.equal(v.char_start, SUMMARY.indexOf(quote))
  const no = r.verdicts.find(x => x.seq === 12)
  assert.deepEqual([no.quote, no.char_start, no.char_end], [null, null, null],
    'no quote means no offsets — never 0, which is a position')
})

// ─── the WIRING: checks.ts prefers the verdict, falls back, and never guesses ──────────────────
//
// `evidence_placed` is the one check `covers()` feeds (`checks.ts:905`). These exercise runChecks
// end to end rather than the pure parser, because the defect worth guarding is in the seam.
import { runChecks } from '../dist/functions/tests/checks.js'

// evidence_placed only runs on requirements the PROFILE already evidences, so the fixture needs a
// rule-method evidence row — `anchored`, not `proposed`, since a proposal is not rule evidence.
const REQ_15 = { id: 'r15', seq: 15, kind: 'must_have',
  verbatim: 'Ability to align engineering strategy with business goals', item_text: '' }
const evidenceFor = (seqs) => ({
  profileReadable: true,
  bySeq: Object.fromEntries(seqs.map(s => [s, {
    quote: 'Designed and implemented OKRs and monthly executive ops reviews',
    source_label: 'Work history 2', method: 'anchored', confirmed_at: null,
  }])),
})
const base = {
  type: 'resume',
  pkg: { ResumeSummary: SUMMARY },
  requirements: [REQ_15],
  evidence: evidenceFor([15]),
  profileText: 'Von Ellis. Engineering leadership across regulated enterprises.',
  postingText: 'Ability to align engineering strategy with business goals',
}
const placed = (rs) => rs.find(r => r.check_key === 'evidence_placed')

test('H:judge-verdict-beats-the-word-match', () => {
  // The whole point. `coversIn` scores this pair 0.60 and calls it absent because `strategy` is not
  // a substring of `strategies`. Measured on the owner's live Trinnex row. With a verdict, the
  // judge's reading wins and the same document stops being accused of omitting what it says.
  const without = placed(runChecks(base))
  assert.equal(without.state, 'warn', 'the lexical rule reports this document as not placing #15')
  assert.equal(without.offenders.length, 1)

  const withJudge = placed(runChecks({ ...base,
    judgeVerdicts: new Map([[15, { covered: true, basis: 'synonym',
      quote: 'aligning engineering strategies with business objectives', why: 'same claim, reworded' }]]) }))
  assert.equal(withJudge.state, 'pass', 'the judge says the document places it, and that wins')
  assert.equal(withJudge.offenders.length, 0)
})

test('H:no-verdict-map-changes-nothing', () => {
  // The regression that matters most: every existing test, and every run with the judge disabled,
  // must behave exactly as before. Absence of the map is the untouched path, not a special case.
  //
  // PIN THE OUTCOME, not just the two spellings of "no map". A first version of this asserted only
  // that `judgeVerdicts: undefined` matched the field being absent — which are the same value on
  // every read path, so it could not fail and mutation-proving caught it inert (2026-09-01). What
  // makes it a guard is asserting WHAT the judge-less path produces: the lexical rule's own answer,
  // warn with #15 named, exactly as before this wiring existed.
  const a = placed(runChecks(base))
  assert.equal(a.state, 'warn', 'with no judge, evidence_placed still reports the lexical answer')
  assert.equal(a.offenders.length, 1)
  assert.ok(String(a.offenders[0]).includes('align engineering strategy'),
    'and still names the requirement the lexical rule found unplaced')
  const b = placed(runChecks({ ...base, judgeVerdicts: undefined }))
  assert.deepEqual({ s: a.state, o: a.offenders }, { s: b.state, o: b.offenders })
})

test('H:judge-silence-is-not-a-no', () => {
  // ASKED AND UNANSWERED IS NOT "ABSENT". A requirement in the map's keyset-that-was-asked but with
  // no verdict must be excluded from placement, never fall through to the lexical rule — reporting
  // the fallback's opinion as the judge's finding is absent evidence read as a finding, which is
  // the failure mode this file's whole design is against. An EMPTY map means "asked, answered
  // nothing", so #15 is dropped rather than accused.
  const silent = placed(runChecks({ ...base, judgeVerdicts: new Map() }))
  assert.notEqual(silent.state, 'warn', 'an unanswered requirement must not be reported as unplaced')
  assert.equal(silent.offenders.length, 0, 'and must never appear as an offender')
})

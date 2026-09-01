// THE STUFFING READ — the half of "did you keep the posting's wording" that a substring search
// cannot see.
//
// WHY IT EXISTS. Owner, on the shipped Trinnex summary: "this one is a hack full of verbatim lines
// from the jd that isn't subtle at all and would get me accused of stuffing." `scanWording` is the
// check that exists for exactly that and it finds NOTHING in that summary, because it looks for
// CONTIGUOUS runs of 8+ tokens. The measured shape is the opposite: the same passage scored 0 of 19
// on requirement coverage — full of the posting's vocabulary, empty of its claims.
//
// WHAT THESE MUST PIN, in both directions. A check that accuses the owner's own prose is the most
// expensive kind to get wrong: a false flag costs their trust in every other row on the screen. So
// half of these are about NOT firing.
//
//   cd api && node --test test/stuffingRead.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStuffing, buildStuffingUser, STUFFING_SYSTEM } from '../dist/functions/tests/stuffingJudge.js'
import { runStuffingRead } from '../dist/functions/tests/appCoverage.js'
import { runChecks } from '../dist/functions/tests/checks.js'

// The live summary, verbatim from insertion.after_text.
const SUMMARY = 'Visionary technology leader with a robust track record in driving enterprise transformations and aligning engineering strategies with business objectives. Adept at building high-performing teams and fostering a culture of collaboration and innovation, delivering scalable and secure software solutions.'
const POSTING = 'We are looking for a leader to drive enterprise transformation, align engineering strategy with business goals, build high-performing teams, and deliver scalable and secure software solutions.'

test('H:a-flagged-phrase-must-be-in-the-document', () => {
  // THE accusation-grade check. This surface tells the owner their own sentence reads as
  // name-dropping; a phrase they cannot find in their own text is an accusation nobody can act on,
  // which is worse than silence.
  const r = parseStuffing({ hits: [
    { phrase: 'delivering scalable and secure software solutions', why: 'names the posting\'s phrase with no claim attached' },
    { phrase: 'a track record of delivering at scale', why: 'invented — not in the passage' },
  ] }, SUMMARY)
  assert.equal(r.hits.length, 1)
  assert.equal(SUMMARY.slice(r.hits[0].char_start, r.hits[0].char_end), r.hits[0].phrase,
    'the offsets index the flagged span exactly')
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].refusal, 'phrase_not_in_field')
})

test('H:a-flag-without-a-reason-is-not-a-flag', () => {
  // The owner has to decide whether the phrase is the employer's sentence, the industry's standard
  // term, or their own voice. A flag with no argument gives them nothing to decide with.
  const r = parseStuffing({ hits: [
    { phrase: 'Visionary technology leader', why: '   ' },
    { phrase: '', why: 'nothing to point at' },
  ] }, SUMMARY)
  assert.equal(r.hits.length, 0)
  assert.deepEqual(r.refused.map(x => x.refusal).sort(), ['empty_phrase', 'no_reason'])
})

test('H:one-span-is-one-finding', () => {
  // A model repeating itself is not two findings. The count is read as severity, and an inflated
  // one is the cry-wolf failure this repo treats as worse than no check.
  const twice = { phrase: 'Visionary technology leader', why: 'a label, not a claim' }
  const r = parseStuffing({ hits: [twice, { ...twice }] }, SUMMARY)
  assert.equal(r.hits.length, 1)
})

test('H:the-prompt-protects-a-real-claim', () => {
  // THE HARD HALF. Using the employer's noun inside a real claim is good writing — "led the SOC 2
  // certification" is what a resume should say. A check that flagged it would be telling the owner
  // to write worse, which is the opposite of the point.
  const p = buildStuffingUser('ResumeSummary', SUMMARY, POSTING)
  assert.match(p, /A CLAIM IS NEVER A HIT/)
  assert.match(p, /An empty list is a good answer/)
  assert.match(p, /character for/, 'it must demand a verbatim span')
  assert.ok(p.includes(SUMMARY) && p.includes(POSTING), 'both sides must be in the prompt')
  assert.match(STUFFING_SYSTEM, /is a claim; .* is a list/, 'the system prompt must carry the contrast')
  assert.match(STUFFING_SYSTEM, /a false flag costs their trust/,
    'the cost of over-flagging must be stated, or the model reaches')
})

// ─── THE RUNNER ────────────────────────────────────────────────────────────────────────────────

const says = (hits) => async () => ({ choices: [{ message: { content: JSON.stringify({ hits }) } }] })
const base = (over = {}) => ({
  type: 'resume', pkg: { ResumeSummary: SUMMARY }, postingText: POSTING,
  thresholds: { coverageJudge: true },
  fetchJson: says([{ phrase: 'delivering scalable and secure software solutions', why: 'the posting\'s phrase, no claim attached' }]),
  ...over,
})

test('H:the-stuffing-read-is-off-unless-the-owner-asked', async () => {
  let asked = 0
  for (const thresholds of [{}, { coverageJudge: false }]) {
    const r = await runStuffingRead(base({ thresholds, fetchJson: async () => { asked++; return {} } }))
    assert.deepEqual(r.hits, [])
    assert.equal(r.calls, 0)
  }
  assert.equal(asked, 0, 'the model is never asked')
})

test('H:nothing-to-compare-against-raises-nothing', async () => {
  // Absent evidence is not a finding. With no posting text there is no "the posting's wording" to
  // have kept, and a model asked anyway would invent the comparison.
  let asked = 0
  const r = await runStuffingRead(base({ postingText: '   ', fetchJson: async () => { asked++; return {} } }))
  assert.deepEqual(r.hits, [])
  assert.equal(asked, 0)
})

test('H:a-read-that-fails-raises-nothing-rather-than-raising-doubt', async () => {
  // This surface accuses the owner's own prose. An outage must never produce a finding — and unlike
  // the coverage judge, silence here costs nothing at all, because the check it feeds is a warn.
  const r = await runStuffingRead(base({ fetchJson: async () => { throw new Error('OpenAI HTTP 503') } }))
  assert.deepEqual(r.hits, [])
  assert.equal(r.failures.length, 1)
  assert.match(r.failures[0], /OpenAI HTTP 503/)
})

test('H:the-cap-bounds-what-one-run-can-spend', async () => {
  let asked = 0
  const r = await runStuffingRead(base({
    pkg: { ResumeSummary: SUMMARY, ExpertiseBullets: 'Enterprise transformation. Scalable and secure software solutions.' },
    thresholds: { coverageJudge: true, coverageJudgeMaxCalls: 1 },
    fetchJson: async (...a) => { asked++; return says([])(...a) },
  }))
  assert.equal(asked, 1)
  assert.ok(r.failures.some(f => /cap/.test(f)))
})

// ─── THE CHECK IT FEEDS ────────────────────────────────────────────────────────────────────────

const wording = (rs) => rs.find(r => r.check_key === 'posting_wording_kept')
const checkInput = (over = {}) => ({
  type: 'resume', pkg: { ResumeSummary: SUMMARY }, requirements: [],
  postingText: POSTING, profileText: 'I have delivered software for twenty years.', ...over,
})

test('H:a-model-raised-passage-lands-on-the-check-that-already-asks-that-question', () => {
  // ONE check, not two. It is one question to the writer ("is this your wording or theirs?") with
  // one remedy — their judgement, never an auto-correct. Two rows saying the same thing about the
  // same sentence would leave the owner reconciling them.
  const without = wording(runChecks(checkInput()))
  assert.equal(without.state, 'pass', 'scanWording alone finds nothing in this passage')

  const with_ = wording(runChecks(checkInput({ stuffingHits: [
    { field: 'ResumeSummary', phrase: 'delivering scalable and secure software solutions', why: 'the posting\'s phrase, no claim attached' },
  ] })))
  assert.equal(with_.state, 'warn', 'and it is a WARN — the writer decides, this can never fail a gate')
  assert.equal(with_.offenders.length, 1)
  assert.match(with_.offenders[0], /delivering scalable and secure software solutions/)
  assert.match(with_.offenders[0], /no claim attached/, 'the reason travels with the phrase')
  assert.match(with_.observed, /raised by a model reading for name-dropping/,
    'a finding a model raised must say so where it is read')
})

test('H:no-stuffing-hits-is-the-untouched-path', () => {
  const a = wording(runChecks(checkInput()))
  const b = wording(runChecks(checkInput({ stuffingHits: [] })))
  assert.deepEqual({ s: a.state, o: a.offenders }, { s: b.state, o: b.offenders })
  assert.equal(a.state, 'pass')
  assert.ok(!/model/.test(a.observed), 'and it says nothing about a model that did not find anything')
})

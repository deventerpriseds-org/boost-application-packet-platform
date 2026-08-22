// Verifying the model's EXPLANATION — D:proposal-reasoning-unverified.
//
// The quote is settled by `indexOf` and is not what this file tests. These cover the sentence stored
// beside it, which the owner reads as the reason to trust the row and which nothing checked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyReasoning } from '../dist/functions/tests/evidenceProposal.js'

// The two live cases, verbatim from db-query 32541365164, and two controls.
const SECURITY = {
  req: 'Ensure delivery of scalable, secure, and high-quality software',
  quote: 'Redesigned a predictive analytics suite, converting a consultative service into a scalable digital experience, driving 60% revenue growth and 30% higher retention rates through personalized insights and real-time decision support.',
  why: 'The quote demonstrates experience in creating scalable software solutions that enhance quality and security through real-time decision support and personalized insights.',
}
const IOT = {
  req: 'Knowledge of AI/ML and IoT technologies',
  quote: 'Developed a SaaS platform integrating real-time data collection, mobile applications, data modeling, and automated reporting, improving revenue-earning operational efficiency by 60% through predictive analytics.',
  why: 'The quote demonstrates experience with IoT data, data modeling, and AI/ML through the development of a SaaS platform that integrates these elements.',
}

test('H:named-overclaim-is-withdrawn: an acronym the excerpt does not contain is an exact defect', () => {
  // The ONE thing that can be settled without judgement. `IoT` is present or it is not — no
  // morphology, no near-miss, which is why `supportIn` already treats named entities as absolute.
  const v = verifyReasoning(IOT.req, IOT.quote, IOT.why)
  assert.equal(v.withdrawn, true)
  assert.deepEqual(v.overclaimed.sort(), ['ai/ml', 'iot'], 'the specific claims must be named')
  assert.match(v.note, /withdrawn/)
  assert.match(v.note, /iot/, 'the note must say WHICH claim was withdrawn, or it is unreviewable')
  assert.ok(!v.note.includes(IOT.why), 'the withdrawn sentence must not survive in the note')
})

test('H:no-vacuous-reasoning-gate: the security case is LABELLED, and never "caught" by accident', () => {
  // THE TRAP THIS CASE EXISTS FOR, found by an independent reviewer before the code shipped.
  //
  // The first mechanism dropped this row — but on the token `software`, not `secure`. A test
  // asserting only "case 1 is dropped" would have gone GREEN while the guard was blind to the defect
  // that commissioned it. `sameWord('secure','security')` is FALSE: `forms()` has no -e -> -ity rule,
  // so the word at issue could never have matched.
  //
  // So the honest behaviour is to DECLINE to judge it and publish the fact instead. This asserts the
  // decline explicitly, which is the assertion that cannot be satisfied by accident.
  const v = verifyReasoning(SECURITY.req, SECURITY.quote, SECURITY.why)
  assert.equal(v.withdrawn, false, 'no exact rule reaches this — it must NOT be reported as caught')
  assert.deepEqual(v.overclaimed, [], 'and nothing may be accused')
  // But the owner still sees it: `secure` is named as absent, beside the claim that it is present.
  assert.ok(v.missing.includes('secure'), 'the missing term the reasoning contradicts must be published')
  assert.match(v.note, /does not mention:[^—]*secure/, 'and must reach the stored note')
  assert.ok(v.note.includes(SECURITY.why), 'the model\'s sentence stands — it is contradicted, not deleted')
})

test('H:reasoning-check-never-cries-wolf: sound explanations survive, including honest negatives', () => {
  // Restating the requirement is what an explanation DOES. The naive check flagged `build`,
  // `engineering` and `culture` here — three false accusations against correct reasoning.
  const good = verifyReasoning(
    'Build and promote a high-performing engineering culture',
    'Passionate about customer-centric product design, I have fostered high-performing teams',
    'The candidate has fostered high-performing teams, which directly evidences building an engineering culture.')
  assert.equal(good.withdrawn, false)
  assert.deepEqual(good.overclaimed, [])

  // The case that would have been punished hardest: reasoning that is EXPLICITLY honest about a gap
  // names the missing term, and a naive check drops it for saying so.
  const honest = verifyReasoning(SECURITY.req, SECURITY.quote,
    'The excerpt shows scale and quality but does not address security.')
  assert.equal(honest.withdrawn, false, 'an explanation admitting a gap must never be withdrawn for admitting it')
  assert.ok(honest.note.includes('does not address security'))
})

test('the note characterises a no-overlap row instead of listing every word', () => {
  // A row reaches the model BECAUSE the requirement's words are absent — that is what the
  // deterministic matcher could not get past. Listing all of them on every row would be
  // near-maximal, would read as an accusation against evidence the design considers sound, and would
  // train the owner to ignore the note.
  const v = verifyReasoning('Improve operational reliability',
    'Reduced outages from nine hours to one across the payments platform.',
    'Cutting outage duration is an improvement in operational reliability.')
  assert.equal(v.withdrawn, false)
  assert.match(v.note, /none of the requirement's own words appear/)
  assert.ok(!/does not mention:/.test(v.note), 'the exhaustive list must not also appear')
  assert.match(v.note, /a model judged it relevant/, 'the note must name what did the judging')
})

test('the note is NEVER empty, whatever comes in', () => {
  // `verifyProposal` refuses an unexplained match outright (`no_reasoning`: "an unexplained match is
  // not reviewable"). A row whose note we blanked would contradict that one function up.
  for (const [why, label] of [['', 'empty'], ['   ', 'whitespace'], [null, 'null'], [undefined, 'undefined']]) {
    const v = verifyReasoning(SECURITY.req, SECURITY.quote, why)
    assert.ok(v.note && v.note.trim().length > 0, `${label} reasoning produced an empty note`)
  }
  // And a requirement the excerpt fully covers leaves the model's sentence alone, with nothing added.
  const covered = verifyReasoning('reduced outages', 'Reduced outages from nine hours to one.', 'It says so directly.')
  assert.equal(covered.note, 'It says so directly.')
  assert.deepEqual(covered.missing, [])
})

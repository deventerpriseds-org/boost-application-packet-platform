// Verifying the model's EXPLANATION — D:proposal-reasoning-unverified.
//
// The quote is settled by `indexOf` and is not what this file tests. These cover the sentence stored
// beside it, which the owner reads as the reason to trust the row and which nothing checked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyReasoning, parseAppeal, buildAppealUser, APPEAL_SYSTEM, escalateOne } from '../dist/functions/tests/evidenceProposal.js'

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

// ─── THE APPEAL — A6. The exact rule still accuses; only a CITED answer overturns it ────────────
//
// Measured on the owner's live Trinnex packet (db-query 33503167998): `verifyReasoning` withdrew 2
// of 10 explanations and at least one was CORRECT. Requirement #20 admits "or related technical
// field" in its own words, the excerpt reads "Information Systems", and the rule withdrew on
// computer/software/engineering because it can only ask whether the strings appear.
//
// The fix does NOT narrow the accusation. `namedEntityTokens` counts any non-first capitalised word,
// so a Title Case degree list produces those three — but narrowing it would stop withdrawing real
// overclaims on plain capitalised names, and weakening a guard is the owner's call. So the rule is
// untouched and a model may DEFEND, on terms it cannot fake.

const DEGREE = {
  req: 'Bachelor\'s degree in Computer Science, Software Engineering, Data Science, Engineering, or related technical field.',
  quote: 'Bachelor of Science with Honors in Information Systems, University of Maryland',
  why: 'The excerpt shows a technical bachelor\'s degree, which the requirement admits as a related field to computer science and software engineering.',
}

test('H:appeal-must-quote-the-excerpt: a defence that cannot be pointed at is not a defence', () => {
  const v = verifyReasoning(DEGREE.req, DEGREE.quote, DEGREE.why)
  assert.equal(v.withdrawn, true, 'the fixture must reproduce the live withdrawal')

  // A paraphrase of the excerpt — the exact failure `verifyProposal` exists to catch, one layer up.
  const paraphrased = parseAppeal(
    { upheld: v.overclaimed.map(t => ({ term: t, quote: 'a degree in information systems' })) },
    DEGREE.quote, v.overclaimed)
  assert.equal(paraphrased.overturned, false, 'a quote that is not IN the excerpt defends nothing')
  assert.deepEqual(paraphrased.upheld, [])

  // The real span, byte for byte.
  const cited = parseAppeal(
    { upheld: v.overclaimed.map(t => ({ term: t, quote: 'Information Systems' })) },
    DEGREE.quote, v.overclaimed)
  assert.equal(cited.overturned, true, 'the correct evidence is restored')
  assert.equal(cited.upheld.length, v.overclaimed.length)
  assert.ok(cited.upheld.every(u => DEGREE.quote.includes(u.quote)),
    'and what is stored is the EXCERPT\'s bytes, never the model\'s string')
})

test('H:a-partial-defence-leaves-the-withdrawal-standing', () => {
  // The withdrawal was made for ALL the disputed terms, so answering some of them does not answer
  // it. This is the direction that matters: an appeal that fell short must fail CLOSED.
  const v = verifyReasoning(DEGREE.req, DEGREE.quote, DEGREE.why)
  assert.ok(v.overclaimed.length > 1, 'the fixture needs more than one disputed term')
  const partial = parseAppeal({ upheld: [{ term: v.overclaimed[0], quote: 'Information Systems' }] },
    DEGREE.quote, v.overclaimed)
  assert.equal(partial.overturned, false)
  assert.equal(partial.upheld.length, 1, 'what WAS defended is still reported')
})

test('H:the-appeal-cannot-invent-a-dispute', () => {
  // It can only ever overturn a withdrawal, never cause one. A term nobody disputed is ignored, and
  // an empty dispute list can never be "all upheld" — otherwise a model returning `{upheld: []}`
  // against no dispute would read as an overturn of nothing.
  assert.equal(parseAppeal({ upheld: [{ term: 'kubernetes', quote: 'Information Systems' }] },
    DEGREE.quote, ['computer']).overturned, false, 'defending a term nobody disputed is not a defence')
  assert.equal(parseAppeal({ upheld: [] }, DEGREE.quote, []).overturned, false,
    'no dispute is not an overturn')
  for (const junk of [null, undefined, {}, { upheld: 'yes' }, { upheld: [{}] }]) {
    assert.equal(parseAppeal(junk, DEGREE.quote, ['computer']).overturned, false,
      `an unusable answer leaves the withdrawal standing: ${JSON.stringify(junk)}`)
  }
})

test('H:the-appeal-asks-only-about-the-excerpt', () => {
  // The prompt must forbid arguing from what the excerpt implies about the person, and must make an
  // undefended term a good answer — a defender that always defends is worse than no appeal, because
  // it would launder every withdrawal.
  const p = buildAppealUser(DEGREE.req, DEGREE.quote, ['computer', 'software'])
  assert.ok(p.includes(DEGREE.quote), 'the excerpt must be in the prompt')
  assert.match(p, /character for/, 'it must demand a verbatim span')
  assert.match(p, /An undefended term is a correct and useful answer/)
  assert.match(APPEAL_SYSTEM, /Leaving a term undefended is a correct answer/)
  assert.match(APPEAL_SYSTEM, /never argue from what the excerpt implies about the person/)
})

// ─── THE SEAM: the appeal as `escalateOne` actually runs it ─────────────────────────────────────
//
// The three tests above cover the parser. These cover the WIRING, because a correct parser that the
// escalation path never calls — or calls when the setting is off — is a feature nobody has.

const RECORDS = [{
  key: 'education:umd', label: 'Education', kind: 'profile_field',
  text: `Bachelor of Science with Honors in Information Systems, University of Maryland`,
}]
const PROPOSAL = {
  supported: true, source_key: 'education:umd', quote: DEGREE.quote, reasoning: DEGREE.why,
}
// Call 1 is the proposal, call 2 is the appeal. `answers` lets each test decide what call 2 does.
const transport = (appealAnswer) => {
  const seen = []
  const fetchJson = async (system) => {
    seen.push(system)
    if (seen.length === 1) return { choices: [{ message: { content: JSON.stringify(PROPOSAL) } }] }
    if (typeof appealAnswer === 'function') return appealAnswer()
    return { choices: [{ message: { content: JSON.stringify(appealAnswer) } }] }
  }
  return { fetchJson, seen }
}
const opts = (t, appeal) => ({
  fetchJson: t.fetchJson, neverEvidence: new Set(), minQuoteChars: 20, minTokens: 2,
  resolverVersion: 1, appeal,
})

test('H:a-cited-appeal-restores-the-evidence-the-rule-wrongly-withdrew', async () => {
  // The live Trinnex case, end to end: the rule withdraws, the model cites "Information Systems"
  // out of the excerpt, and the owner gets the evidence back WITH the dispute on the record.
  const t = transport({ upheld: [
    { term: 'computer', quote: 'Information Systems' },
    { term: 'software', quote: 'Information Systems' },
    { term: 'engineering', quote: 'Information Systems' },
  ] })
  const out = await escalateOne(DEGREE.req, RECORDS, opts(t, true))
  assert.equal(out.kind, 'accepted')
  assert.equal(out.reasoningWithdrawn, false, 'the withdrawal is overturned')
  assert.match(out.row.extra, /a rule disputed/,
    'and the dispute is STORED — an overturned withdrawal must not read like a row nobody questioned')
  assert.match(out.row.extra, /Information Systems/, 'with the span that answered it')
  assert.equal(t.seen.length, 2, 'one proposal call, one appeal call')
})

test('H:an-appeal-that-fails-leaves-the-withdrawal-standing', async () => {
  // FAIL CLOSED, three ways. This is the property that makes the appeal safe to add at all: it can
  // only ever overturn a withdrawal with a positive cited answer, and everything else is today's
  // behaviour unchanged.
  for (const [label, answer] of [
    ['the transport throws', () => { throw new Error('OpenAI HTTP 503') }],
    ['the answer is unparseable', () => ({ choices: [{ message: { content: 'not json' } }] })],
    ['the quote is not in the excerpt', { upheld: [{ term: 'computer', quote: 'a related field' }] }],
    ['only some terms are defended', { upheld: [{ term: 'computer', quote: 'Information Systems' }] }],
  ]) {
    const t = transport(answer)
    const out = await escalateOne(DEGREE.req, RECORDS, opts(t, true))
    assert.equal(out.kind, 'accepted', label)
    assert.equal(out.reasoningWithdrawn, true, `the withdrawal must stand when ${label}`)
    assert.match(out.row.extra, /withdrawn/, `and the note must say so when ${label}`)
  }
})

test('H:the-appeal-is-not-made-when-the-owner-has-not-asked-for-it', async () => {
  // Off is today's behaviour EXACTLY — the withdrawal stands and no second call is made, so the
  // setting is a real switch rather than a label on something that runs anyway.
  const t = transport({ upheld: [{ term: 'computer', quote: 'Information Systems' }] })
  const out = await escalateOne(DEGREE.req, RECORDS, opts(t, false))
  assert.equal(out.reasoningWithdrawn, true)
  assert.equal(t.seen.length, 1, 'the appeal call is never made')
})

test('H:an-undisputed-row-never-reaches-the-appeal', async () => {
  // The appeal costs a call, and a row the rule did not withdraw has nothing to appeal. Spending on
  // one would be a per-row cost with no decision behind it.
  const CLEAN = { req: 'Experience leading engineering teams',
    quote: 'I have led engineering teams across three regulated enterprises for a decade' }
  const records = [{ key: 'work:1', label: 'Work', kind: 'work_history', text: CLEAN.quote }]
  const seen = []
  const fetchJson = async () => {
    seen.push(1)
    return { choices: [{ message: { content: JSON.stringify({
      supported: true, source_key: 'work:1', quote: CLEAN.quote,
      reasoning: 'the excerpt states a decade of leading engineering teams',
    }) } }] }
  }
  const out = await escalateOne(CLEAN.req, records, {
    fetchJson, neverEvidence: new Set(), minQuoteChars: 20, minTokens: 2, resolverVersion: 1, appeal: true,
  })
  assert.equal(out.reasoningWithdrawn, false)
  assert.equal(seen.length, 1, 'no appeal call for a row nothing disputed')
})

// P4 — the independent reviewer.
//
// The tests that matter here are the adversarial ones: a reviewer implementation that validates
// citations with `posting.includes(quote)` passes a happy-path test and is wrong in exactly the way
// this layer exists to prevent. Each of those cases names the failure it forbids.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildReviewerPayload, assertBlind, isForbiddenKey, BLIND_FORBIDDEN_KEYS,
  findQuoteSpans, validateCitations, MIN_QUOTE_CHARS, MIN_QUOTE_WORDS,
  parseReview, agreementFor, reviewerChecks, promptSourceCheck, scrubCritique, GRADES,
} from '../dist/functions/tests/reviewer.js'
import { gateFor } from '../dist/functions/tests/checks.js'
import { computeArtifactScore } from '../dist/functions/tests/artifactScore.js'

// A posting where the SAME phrase occurs twice — once as the requirement, once in an unrelated
// paragraph. This is the shape that breaks a naive validator.
const POSTING = [
  'About the role. We are hiring a Director of Digital Technology Operations.',
  'Requirements: The successful candidate will have ten years of leadership experience in a regulated utility.',
  'Our culture values ten years of leadership experience in every team we build, and we say so often.',
  'You must be authorised to work in the United States without sponsorship.',
].join(' ')

const at = (needle, from = 0) => {
  const i = POSTING.indexOf(needle, from)
  assert.notEqual(i, -1, `fixture is wrong: "${needle}" not in the posting`)
  return { start: i, end: i + needle.length }
}

const REQ_QUOTE = 'The successful candidate will have ten years of leadership experience in a regulated utility.'
const AUTH_QUOTE = 'You must be authorised to work in the United States without sponsorship.'

const reqs = () => {
  const a = at(REQ_QUOTE)
  const b = at(AUTH_QUOTE)
  return [
    { id: 'r1', seq: 0, kind: 'must_have', item_text: 'Ten or more years leading in a regulated utility', verbatim: REQ_QUOTE, char_start: a.start, char_end: a.end },
    { id: 'r2', seq: 1, kind: 'must_have', item_text: 'US work authorisation without sponsorship', verbatim: AUTH_QUOTE, char_start: b.start, char_end: b.end },
    { id: 'r3', seq: 2, kind: 'responsibility', item_text: 'Own the operations roadmap', verbatim: null, char_start: null, char_end: null },
  ]
}

// ---- blindness ---------------------------------------------------------------------------------

test('the payload carries the posting, the requirements and the asset — and nothing else', () => {
  const p = buildReviewerPayload({
    type: 'resume', postingText: POSTING, requirements: reqs(),
    pkg: { ResumeSummary: 'Twenty years in utilities.', SkillsBullets1: 'Grid ops | Regulatory' },
    company: 'Trinnex', jobTitle: 'Director',
  })
  assert.deepEqual(Object.keys(p).sort(), ['asset', 'asset_type', 'company', 'job_title', 'posting', 'requirements'])
  assert.deepEqual(Object.keys(p.requirements[0]).sort(), ['kind', 'requirement_id', 'seq', 'text'])
})

test('generator reasoning cannot reach the reviewer, however deeply it is nested', () => {
  // The leak this forbids is nested: someone passes `packet.pkg_json` or the built package wholesale
  // and the generator's own QC notes ride along inside a field nobody enumerated.
  const SENTINEL = 'SENTINEL-RATIONALE-7'
  const p = buildReviewerPayload({
    type: 'resume', postingText: POSTING, requirements: reqs(),
    pkg: {
      ResumeSummary: 'Twenty years in utilities.',
      _parsedFieldCount: 7,
      swaps: [{ rationale: SENTINEL }],
      calls: { c3: { rationale: SENTINEL } },
      steps: [SENTINEL],
    },
  })
  assert.ok(!JSON.stringify(p).includes(SENTINEL), 'the generator rationale survived into the payload')
  assert.ok(!JSON.stringify(p).includes('_parsedFieldCount'))
})

test('the requirement rows never carry the deterministic engine\'s conclusion', () => {
  // Handing the reviewer `coverage: "escalated"` makes agreement circular: it agrees because it was
  // told the answer, and the disagreement count that the whole phase rests on becomes meaningless.
  const withVerdict = reqs().map(r => ({ ...r, coverage: 'escalated', closed_on_loop: 2 }))
  const p = buildReviewerPayload({ type: 'resume', postingText: POSTING, requirements: withVerdict, pkg: {} })
  assert.ok(!JSON.stringify(p).includes('escalated'))
  assert.ok(!JSON.stringify(p).includes('closed_on_loop'))
})

test('assertBlind throws on a forbidden key at any depth, naming its path', () => {
  assert.throws(() => assertBlind({ a: { b: [{ swap_reason: 'x' }] } }), /\$\.a\.b\[0\]\.swap_reason/)
  assert.throws(() => assertBlind({ deep: { deeper: { rationale: 1 } } }), /not blind/)
})

test('the forbidden-key test matches whole name parts, so it neither over- nor under-fires', () => {
  for (const k of ['rationale', 'swapReason', 'swap_reason', 'checkResults', 'roleFocus', 'c3'])
    assert.ok(isForbiddenKey(k), `${k} should be forbidden`)
  // A guard people learn to ignore is worse than no guard.
  for (const k of ['season', 'research', 'unreasonable', 'gateway', 'scoreboardTitle'])
    assert.ok(!isForbiddenKey(k), `${k} must NOT be forbidden`)
  assert.ok(BLIND_FORBIDDEN_KEYS.includes('rationale'))
})

// ---- citation validation -----------------------------------------------------------------------

test('a quote that occurs OUTSIDE the requirement it names is dropped, even though it is real text', () => {
  // The naive implementation is `posting.includes(quote) && requirementExists(id)`. It accepts this
  // citation: the words are genuinely in the posting, they are genuinely quoted, and they are
  // evidence for nothing — they land in a culture paragraph, not in the requirement.
  const second = at('Our culture values ten years of leadership experience in every team we build, and we say so often.')
  const quote = POSTING.slice(second.start, second.end)
  const { accepted, dropped } = validateCitations(
    [{ requirement_id: 'r1', verbatim_quote: quote, claim: 'covered' }], POSTING, reqs())
  assert.equal(accepted.length, 0)
  assert.equal(dropped[0].reason, 'quote_does_not_resolve_to_requirement')
  assert.match(dropped[0].detail, /requirement #0 spans/)
})

test('the same quote, taken from inside the requirement span, is accepted', () => {
  const { accepted, dropped } = validateCitations(
    [{ requirement_id: 'r1', verbatim_quote: REQ_QUOTE, claim: 'the posting asks for ten years' }], POSTING, reqs())
  assert.equal(dropped.length, 0)
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].seq, 0)
  assert.equal(POSTING.slice(accepted[0].char_start, accepted[0].char_end), REQ_QUOTE)
})

test('a quote that only matches the model PARAPHRASE is dropped', () => {
  // `item_text` is a paraphrase by design. Validating against `verbatim || item_text` — the fallback
  // pattern the coverage check uses — would make every invented quote pass.
  const { accepted, dropped } = validateCitations(
    [{ requirement_id: 'r1', verbatim_quote: 'Ten or more years leading in a regulated utility', claim: 'x' }], POSTING, reqs())
  assert.equal(accepted.length, 0)
  assert.equal(dropped[0].reason, 'quote_not_in_posting')
})

test('a requirement with no anchor can never be cited', () => {
  const { accepted, dropped } = validateCitations(
    [{ requirement_id: 'r3', verbatim_quote: REQ_QUOTE, claim: 'x' }], POSTING, reqs())
  assert.equal(accepted.length, 0)
  assert.equal(dropped[0].reason, 'requirement_has_no_anchor')
  assert.match(dropped[0].detail, /never located/)
})

test('a citation naming a requirement that does not exist is dropped, not guessed at', () => {
  const { dropped } = validateCitations(
    [{ requirement_id: 'nope', verbatim_quote: REQ_QUOTE, claim: 'x' }], POSTING, reqs())
  assert.equal(dropped[0].reason, 'unknown_requirement')
})

test('a quote too short to identify anything is dropped before it is looked up', () => {
  const { dropped } = validateCitations(
    [{ requirement_id: 'r1', verbatim_quote: 'ten years', claim: 'x' }], POSTING, reqs())
  assert.equal(dropped[0].reason, 'quote_too_short')
  assert.ok(MIN_QUOTE_CHARS >= 20 && MIN_QUOTE_WORDS >= 4)
})

test('with no posting text nothing validates — absent evidence is never an acceptance', () => {
  const { accepted, dropped } = validateCitations(
    [{ requirement_id: 'r1', verbatim_quote: REQ_QUOTE, claim: 'x' }], '', reqs())
  assert.equal(accepted.length, 0)
  assert.equal(dropped[0].reason, 'no_posting_text')
})

test('quote matching tolerates re-wrapped whitespace and nothing else', () => {
  const wrapped = REQ_QUOTE.replace(/ /g, '\n   ')
  assert.equal(findQuoteSpans(wrapped, POSTING).length, 1, 'a re-wrapped quote must still match')
  // No stemming, no stopword removal, no similarity: one changed word is a different quote.
  assert.equal(findQuoteSpans(REQ_QUOTE.replace('ten years', 'twelve years'), POSTING).length, 0)
})

test('citation validation contains no fuzzy matcher — it accuses, so it must be exact', () => {
  // The standing rule: fuzzy matching RANKS, it never ACCUSES. A citation decides whether a claim
  // reaches the user, which is asserting, not ranking.
  const src = readSource('reviewer.ts').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/\bsimilarity\s*\(/.test(src), 'reviewer.ts must not call similarity()')
})

// ---- parsing -----------------------------------------------------------------------------------

test('a grade the model did not give arrives as null, never as a default', () => {
  assert.equal(parseReview({}).grade, null)
  assert.equal(parseReview({ grade: 'excellent' }).grade, null)
  assert.equal(parseReview({ grade: 'Needs Work' }).grade, 'needs_work')
  for (const g of GRADES) assert.equal(parseReview({ grade: g }).grade, g)
})

test('a seniority number the model did not give arrives as null, never as 0', () => {
  // A 0 would be a real value feeding a real composite, and it would look measured.
  assert.equal(parseReview({}).seniority_alignment, null)
  assert.equal(parseReview({ seniority_alignment: 'not sure' }).seniority_alignment, null)
  assert.equal(parseReview({ seniority_alignment: 72 }).seniority_alignment, 72)
  assert.equal(parseReview({ seniority_alignment: 140 }).seniority_alignment, 100)
})

// ---- agreement ---------------------------------------------------------------------------------

test('agreement counts only the requirements the RULES ENGINE actually judged', () => {
  // The engine judges must-haves minus the ones the facts settled and the ones no merge field can
  // reach. Counting a judgement it never made as "agreement" manufactures consensus out of silence.
  const a = agreementFor(
    [{ requirement_id: 'r1', covered: true }, { requirement_id: 'r2', covered: false }, { requirement_id: 'r3', covered: true }],
    [], reqs(), ['r1'])
  assert.equal(a.agreed, 1)
  assert.equal(a.disagreed, 0)
  assert.equal(a.not_comparable, 2)
})

test('a stricter reviewer and a looser reviewer are distinguished, not just counted', () => {
  const a = agreementFor(
    [{ requirement_id: 'r1', covered: false }, { requirement_id: 'r2', covered: true }],
    [1], reqs(), ['r1', 'r2'])
  assert.deepEqual(a.reviewer_stricter, [0], 'engine said covered, reviewer said not')
  assert.deepEqual(a.reviewer_looser, [1], 'engine said uncovered, reviewer said covered')
  assert.equal(a.disagreed, 2)
})

test('a judgement about an id that does not exist is never counted either way', () => {
  const a = agreementFor([{ requirement_id: 'ghost', covered: true }], [], reqs(), ['r1'])
  assert.equal(a.unmatched, 1)
  assert.equal(a.agreed + a.disagreed, 0)
})

// ---- the rows ------------------------------------------------------------------------------------

test('every reviewer row carries engine reviewer and a namespaced key', () => {
  const rows = allRows()
  assert.ok(rows.length)
  for (const r of rows) {
    assert.equal(r.engine, 'reviewer')
    assert.match(r.check_key, /^reviewer_/, 'reviewer keys must be namespaced')
  }
})

test('a reviewer row can NEVER be a fail (D6), whatever the review said', () => {
  // check_result is unique on (artifact_id, run_id, check_key) and gateFor turns a deterministic
  // fail into a gate fail. A reviewer row stored as `fail` would render as a blocking finding in
  // every list that reads rows directly, even though the gate would downgrade it.
  for (const r of allRows()) assert.notEqual(r.state, 'fail')
})

test('reviewer keys cannot collide with any deterministic key', async () => {
  const { runChecks } = await import('../dist/functions/tests/checks.js')
  const det = new Set(runChecks({ type: 'resume', pkg: {}, requirements: [], swaps: [] }).map(r => r.check_key))
  for (const r of allRows()) {
    assert.ok(!det.has(r.check_key), `${r.check_key} collides with a deterministic key — the unique constraint would let a model opinion REPLACE a rule`)
  }
})

test('a reviewer warn degrades an all-pass gate to warn, and never to fail', () => {
  const det = [{ check_key: 'x', engine: 'deterministic', state: 'pass', observed: '', expected: '', offenders: [] }]
  const rev = [{ check_key: 'reviewer_grade', engine: 'reviewer', state: 'warn', observed: '', expected: '', offenders: [] }]
  assert.equal(gateFor(det), 'pass')
  assert.equal(gateFor([...det, ...rev]), 'warn')
  const revFail = [{ check_key: 'reviewer_grade', engine: 'reviewer', state: 'fail', observed: '', expected: '', offenders: [] }]
  assert.equal(gateFor([...det, ...revFail]), 'warn', 'a reviewer fail is still only a warn')
})

test('a reviewer row can never feed the must-have score', () => {
  // artifactScore reads `must_have_coverage` out of the checks. Without the engine filter a reviewer
  // row wearing that key would put a model's opinion into a number presented as measured.
  const s = computeArtifactScore({
    requirements: [{ seq: 0, kind: 'must_have' }],
    checks: [{ check_key: 'must_have_coverage', engine: 'reviewer', state: 'pass', observed: '', expected: '', offenders: [] }],
  })
  assert.equal(s.must_have_coverage.value, null)
  assert.match(s.must_have_coverage.source, /no must_have_coverage check was run/)
})

test('nothing to judge is not_applicable, never pass', () => {
  const none = reviewerChecks({
    review: { grade: null, seniority_alignment: null, judgements: [], citations: [], critique: [] },
    agreement: { agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 },
    accepted: [], dropped: [], requirements: [], ran: false, skippedReason: 'no employer posting text',
  })
  assert.ok(none.every(r => r.state === 'not_applicable'), 'a review that did not run must not report a pass')
  assert.ok(none.every(r => /no employer posting text/.test(r.observed)))
})

test('an empty citations array does not read as "the reviewer found nothing wrong"', () => {
  const rows = reviewerChecks({
    review: { grade: 'strong', seniority_alignment: 80, judgements: [], citations: [], critique: [] },
    agreement: { agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 },
    accepted: [], dropped: [], requirements: reqs(), ran: true,
  })
  const cit = rows.find(r => r.check_key === 'reviewer_citations')
  assert.equal(cit.state, 'not_applicable')
  const agr = rows.find(r => r.check_key === 'reviewer_coverage_agreement')
  assert.equal(agr.state, 'not_applicable', 'judging nothing is not agreement')
})

test('dropped citations become a visible finding, with the reason on each one', () => {
  const rows = reviewerChecks({
    review: { grade: 'strong', seniority_alignment: 80, judgements: [], citations: [], critique: [] },
    agreement: { agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 },
    accepted: [], dropped: [{ requirement_id: 'r1', verbatim_quote: 'invented', claim: 'x', reason: 'quote_not_in_posting', detail: '' }],
    requirements: reqs(), ran: true,
  })
  const cit = rows.find(r => r.check_key === 'reviewer_citations')
  assert.equal(cit.state, 'warn')
  assert.match(cit.offenders[0], /quote_not_in_posting/)
})

test('a fabricated quote cannot survive inside a critique bullet', () => {
  // citations[] and critique[] come from the same model call. A quote refused as fabricated walks
  // back onto the screen inside a critique line, where it reads as the reviewer's own observation.
  const fake = 'the ideal candidate must hold an active TS SCI clearance'
  const { kept, removed } = scrubCritique(
    ['The resume never addresses that ' + fake + '.', 'The summary buries the utility experience.'],
    [{ requirement_id: 'r1', verbatim_quote: fake, claim: '', reason: 'quote_not_in_posting', detail: '' }])
  assert.equal(removed.length, 1)
  assert.deepEqual(kept, ['The summary buries the utility experience.'])
})

test('a short dropped quote cannot silently delete unrelated criticism', () => {
  const { kept, removed } = scrubCritique(
    ['The summary is thin on scale.'],
    [{ requirement_id: 'r1', verbatim_quote: 'the', claim: '', reason: 'quote_too_short', detail: '' }])
  assert.equal(removed.length, 0)
  assert.equal(kept.length, 1)
})

test('a review run on the built-in prompt says so, as a warn naming the missing row', () => {
  const good = promptSourceCheck('prompts_table', 'reviewer_system', 3)
  assert.equal(good.state, 'pass')
  assert.match(good.observed, /v3/)
  const fallback = promptSourceCheck('builtin', 'reviewer_system', 0)
  assert.equal(fallback.state, 'warn')
  assert.match(fallback.observed, /no active "reviewer_system" row/)
})

// ---- helpers -------------------------------------------------------------------------------------

function allRows() {
  return reviewerChecks({
    review: { grade: 'needs_work', seniority_alignment: 40, judgements: [{ requirement_id: 'r1', covered: false }], citations: [], critique: ['too generic'] },
    agreement: { agreed: 0, disagreed: 1, reviewer_stricter: [0], reviewer_looser: [], unmatched: 0, not_comparable: 0 },
    accepted: [], dropped: [{ requirement_id: 'r1', verbatim_quote: 'x', claim: '', reason: 'quote_too_short', detail: '' }],
    requirements: reqs(), ran: true,
  }).concat(promptSourceCheck('builtin', 'reviewer_system', 0))
}

function readSource(name) {
  return readFileSync(new URL(`../src/functions/tests/${name}`, import.meta.url), 'utf8')
}

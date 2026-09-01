// THE CHALLENGE — the pass that decides whether a model's proposal may COUNT toward coverage.
//
// WHY IT EXISTS. `must_have_coverage` reads `ruleEvidenceOf` (checks.ts), which nulls any `proposed`
// row the owner has not confirmed. On the owner's live Trinnex packet 15 of 17 evidence rows are
// `proposed`, so the number reads 0/12 and nothing in the product could move it but twelve clicks.
//
// WHY IT IS NOT JUST ASKING THE SAME MODEL TWICE, which is the thing these guards must actually pin:
// the proposal pass asks a CONFIRMING question ("does this support it?") and finds support at the
// rate it was asked to. The challenge asks the opposite one FIRST — "what does the requirement ask
// that this excerpt does not show?" — and a non-empty answer refuses the row IN CODE, before the
// model's own yes/no is read. Order is the safety property, so order is what is mutation-proved.
//
//   cd api && node --test test/proposalVet.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseSupportVerdict, buildSupportUser, vettedNote, SUPPORT_SYSTEM, PROPOSAL_VET_VERSION,
} from '../dist/functions/tests/supportJudge.js'

// The owner's live Trinnex shapes: the requirement no lexical rule reaches, and the excerpt the
// proposal pass found for it.
const REQ = 'Ability to align engineering strategy with business goals'
const EXCERPT = 'Designed and implemented OKRs and monthly executive ops reviews that tied engineering delivery to revenue targets'

test('H:a-named-gap-refuses-the-row-whatever-the-model-then-says', () => {
  // THE ONE THAT MATTERS. A model that names something missing and claims support anyway is
  // CONTRADICTING ITSELF, and the contradiction is caught by the rule rather than by trusting the
  // model to be consistent. This is the whole reason the question is asked in this order.
  const v = parseSupportVerdict({
    missing: ['a named revenue figure'], supported: true,
    quote: 'tied engineering delivery to revenue targets', why: 'it ties delivery to revenue',
  }, EXCERPT)
  assert.equal(v.supported, false, 'a gap it named itself must refuse the row')
  assert.equal(v.refusal, 'missing_named')
  assert.deepEqual(v.missing, ['a named revenue figure'],
    'and what it said was missing is KEPT — that is the useful half, and the owner reads it')
  assert.equal(v.quote, null, 'a refused row carries no citation')
})

test('H:a-vet-must-quote-the-excerpt', () => {
  // The same accusation-grade check `verifyProposal` makes on the record, applied one level in. A
  // model that paraphrases its own citation has not shown anything.
  const paraphrased = parseSupportVerdict({
    missing: [], supported: true, quote: 'tied delivery to revenue', why: 'it says so',
  }, EXCERPT)
  assert.equal(paraphrased.supported, false)
  assert.equal(paraphrased.refusal, 'quote_not_in_excerpt')

  const real = parseSupportVerdict({
    missing: [], supported: true,
    quote: 'tied engineering delivery to revenue targets', why: 'it ties delivery to revenue',
  }, EXCERPT)
  assert.equal(real.supported, true)
  assert.equal(EXCERPT.slice(real.char_start, real.char_end), real.quote,
    'the offsets index the quote in the excerpt exactly')
  assert.equal(real.vet_version, PROPOSAL_VET_VERSION, 'every verdict is stamped with its ruleset')
})

test('H:every-other-way-of-answering-refuses-too', () => {
  // Absent evidence is never a pass. Each of these leaves the row exactly where it is — `proposed`,
  // shown to the owner, not counted — which is today's behaviour.
  const cases = [
    ['model_declined', { missing: [], supported: false, quote: null, why: 'it does not show it' }],
    ['no_reason', { missing: [], supported: true, quote: 'tied engineering delivery to revenue targets', why: '  ' }],
    ['no_quote', { missing: [], supported: true, quote: '', why: 'it shows it' }],
    ['unparseable', null],
    ['unparseable', 'not an object'],
  ]
  for (const [refusal, raw] of cases) {
    const v = parseSupportVerdict(raw, EXCERPT)
    assert.equal(v.supported, false, `${refusal} must not count`)
    assert.equal(v.refusal, refusal)
    assert.equal(v.quote, null)
  }
})

test('H:the-challenge-asks-for-gaps-before-it-asks-for-support', () => {
  // Structural, because the ORDER of the questions is what makes the answer worth more than the
  // proposal it re-reads — and order lives in the prompt, where no runtime test can see it.
  const p = buildSupportUser(REQ, EXCERPT)
  const gapAt = p.indexOf('"missing"')
  const supportAt = p.indexOf('"supported"')
  assert.ok(gapAt > -1 && supportAt > -1, 'both questions must be asked')
  assert.ok(gapAt < supportAt, 'the gaps must be asked for FIRST, or this is just the proposal again')
  assert.match(p, /ANSWER IN THIS ORDER/)
  assert.match(p, /character for/, 'it must demand a verbatim span')
  assert.ok(p.includes(EXCERPT), 'the excerpt must be in the prompt')
  assert.match(SUPPORT_SYSTEM, /what does the requirement ask that this excerpt does NOT show/)
  assert.match(SUPPORT_SYSTEM, /Naming something as missing is the most useful answer/,
    'declining must be framed as a good answer, or the challenge finds support to please')
})

test('H:a-counted-row-says-on-its-face-that-a-model-put-it-there', () => {
  // A row that counts toward the gate has to carry its own provenance and the words it points at, or
  // "coverage rose" is not falsifiable — a reviewer cannot tell a better profile from a chattier
  // model.
  const note = vettedNote('it ties delivery to revenue', 'tied engineering delivery to revenue targets')
  assert.match(note, /vetted/)
  assert.match(note, /challenged/, 'the note must say the claim was attacked, not merely accepted')
  assert.match(note, /tied engineering delivery to revenue targets/, 'and must carry the citation')
})

test('H:vet-module-stays-pure', () => {
  const src = readFileSync(new URL('../src/functions/tests/supportJudge.ts', import.meta.url), 'utf8')
  for (const banned of ['@azure/functions', "from './pgClient'", 'openaiJson', 'fetch(']) {
    assert.ok(!src.includes(banned), `supportJudge.ts references ${banned} — it is no longer pure`)
  }
})

// ─── THE PAIR THAT DECIDES THE 0/12 ────────────────────────────────────────────────────────────
import { runChecks } from '../dist/functions/tests/checks.js'

const MUST = { id: 'r15', seq: 15, kind: 'must_have', verbatim: REQ, item_text: '' }
const evidence = (method, extra = null) => ({
  profileReadable: true,
  bySeq: { 15: { quote: EXCERPT, source_label: 'Work history 2', source_key: 'work:2',
    char_start: 0, char_end: EXCERPT.length, method, extra, confirmed_at: null, ratio: null } },
})
const input = (method, extra) => ({
  type: 'resume', pkg: { ResumeSummary: 'Visionary technology leader aligning engineering strategies with business objectives.' },
  requirements: [MUST], evidence: evidence(method, extra),
  profileText: EXCERPT, postingText: REQ,
})
const coverage = (rs) => rs.find(r => r.check_key === 'must_have_coverage')

test('H:a-vetted-row-counts-and-a-proposed-one-does-not', () => {
  // BOTH HALVES, in one case, because they are one decision. `vetted` counts BECAUSE it is not
  // `proposed` — there is no clause naming it — which is easy to break by widening `isProposed` and
  // easy to miss. Pinning only the half that counts would let the other half rot silently.
  const asProposed = coverage(runChecks(input('proposed')))
  assert.equal(asProposed.state, 'fail', 'an unconfirmed proposal must NOT count — this is the 0/12')
  assert.match(asProposed.observed, /0\/1 must-haves evidenced/)
  assert.match(asProposed.observed, /awaiting your confirmation/)

  const asVetted = coverage(runChecks(input('vetted', 'vetted: challenged ...')))
  assert.equal(asVetted.state, 'pass', 'a challenged row that held DOES count — this is the fix')
  assert.match(asVetted.observed, /1\/1 must-haves evidenced/)
})

test('H:a-counted-vet-is-named-where-the-number-is-read', () => {
  // A count that rose because a model was consulted must say so IN THE SENTENCE the owner reads,
  // not somewhere in an evidence panel. Same discipline as the "awaiting your confirmation"
  // parenthetical, pointed the other way: that one says what was left out, this says what went in.
  const o = coverage(runChecks(input('vetted'))).observed
  assert.match(o, /1 vetted/, 'the count of model-vetted rows must appear')
  assert.match(o, /a model challenged the match and it held/,
    'and it must say what "vetted" MEANS, in words, where it is read')
  assert.match(o, /quoting your own words/)

  // A run with no vetted rows says nothing about vetting — a parenthetical that appears when it is
  // empty is noise, and noise is what teaches people to stop reading the sentence.
  assert.ok(!/vetted/.test(coverage(runChecks(input('exact'))).observed))
})

test('H:a-deterministic-row-is-unaffected-by-any-of-this', () => {
  // The lane can only ever ADD a way to count. A row a rule found still counts exactly as it did.
  const o = coverage(runChecks(input('exact')))
  assert.equal(o.state, 'pass')
  assert.match(o.observed, /1\/1 must-haves evidenced/)
})

// ─── F-3, from VERIFY-coverage-judge-3: a gap in the wrong container is still a gap ─────────────

test('H:a-gap-named-outside-an-array-still-refuses-the-row', () => {
  // THE ONE MALFORMED INPUT THAT USED TO RESOLVE TOWARD ADMITTING THE CLAIM. The prompt asks for
  // `"missing":[<string>]`; a model answering `missing: 'SOC 2 cert'` is a JSON-shape slip, not an
  // exotic input. It used to be discarded by `Array.isArray(...) ? ... : []`, and the row was then
  // promoted to `vetted` — which counts toward the gate. Every other malformed shape in this module
  // refuses. Found by an independent verifier, not by me.
  const v = parseSupportVerdict({
    missing: 'a named SOC 2 certification', supported: true,
    quote: 'tied engineering delivery to revenue targets', why: 'w',
  }, EXCERPT)
  assert.equal(v.supported, false, 'a gap named as a bare string must still refuse the row')
  assert.equal(v.refusal, 'missing_named')
  assert.deepEqual(v.missing, ['a named SOC 2 certification'], 'and it is reported, not swallowed')

  // Absent is still absent — the honest empty case must keep working.
  assert.equal(parseSupportVerdict({
    supported: true, quote: 'tied engineering delivery to revenue targets', why: 'w',
  }, EXCERPT).supported, true, 'no `missing` key at all is an empty gap list, not a refusal')
})

// ─── F-7, from VERIFY-coverage-judge-3: the judge may only ADD coverage ────────────────────────

test('H:the-judge-can-add-coverage-and-can-never-take-it-away', async () => {
  // A DEFECT I SHIPPED. The citation safeguard binds only the model's YES — a `covered:false` is
  // accepted with `quote:null`, because an absence cannot be cited — and `covered:false` is the
  // branch that produces the offender line. So one uncited model sentence could turn a passing
  // check into a named accusation about a document containing the requirement WORD FOR WORD.
  const { runChecks } = await import('../dist/functions/tests/checks.js')
  const VERBATIM = 'Ability to align engineering strategy with business goals is what I have done for a decade.'
  const req = { id: 'r0', seq: 0, kind: 'must_have',
    verbatim: 'Ability to align engineering strategy with business goals', item_text: '' }
  const base = {
    type: 'resume', pkg: { ResumeSummary: VERBATIM }, requirements: [req],
    evidence: { profileReadable: true, bySeq: { 0: { quote: EXCERPT, source_label: 'Work history 1',
      source_key: 'work:1', char_start: 0, char_end: EXCERPT.length, method: 'anchored',
      extra: null, confirmed_at: null, ratio: null } } },
    profileText: EXCERPT, postingText: req.verbatim,
  }
  const placed = (rs) => rs.find(r => r.check_key === 'evidence_placed')

  const lexical = placed(runChecks(base))
  assert.equal(lexical.state, 'pass', 'the document contains the requirement verbatim')

  const modelSaysNo = placed(runChecks({ ...base,
    judgeVerdicts: new Map([[0, { covered: false, basis: 'absent', quote: null, why: 'I do not think so' }]]) }))
  assert.equal(modelSaysNo.state, 'pass',
    'an uncited model "no" must NOT accuse a document that says it word for word')
  assert.equal(modelSaysNo.offenders.length, 0)

  // And the direction the tier exists for still works: a document that says it in OTHER words.
  const REWORDED = { ...base, pkg: { ResumeSummary: 'Aligning engineering strategies with business objectives for a decade.' } }
  assert.equal(placed(runChecks(REWORDED)).state, 'warn', 'the lexical rule misses the paraphrase')
  assert.equal(placed(runChecks({ ...REWORDED,
    judgeVerdicts: new Map([[0, { covered: true, basis: 'synonym',
      quote: 'Aligning engineering strategies with business objectives', why: 'same claim' }]]) })).state,
    'pass', 'and the judge still fixes it — the half worth having is untouched')
})

// P3 — the remediation loop's pure logic.
//
// A loop is a machine for producing green. Left alone it reaches green the three cheap ways: by
// taking credit for coverage it did not create, by stopping and calling that success, or by removing
// the evidence that said it had failed. Each test below is aimed at one of those, and each guard was
// watched to FAIL with the fix reverted before it was kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LOOP_PREFS, ZERO_SPEND, addCall, costComplete, budgetVerdict, offenderSeqs, coverageView,
  realEdits, creditClosures, scopeForRequirements, applyScopedFields, buildScopedPrompt, decidePass,
  evidenceRemoved, assertEvidenceIntact, reportedOutcome, escalationFor, isHonestGreen,
  STRUCTURAL_FIELDS, HALT_REASONS, profileEvidenceFor, nextPassNumber,
} from '../dist/functions/tests/remediation.js'

const req = (seq, text) => ({ seq, verbatim: text, item_text: text })
const det = (key, state, extra = {}) =>
  ({ check_key: key, engine: 'deterministic', state, observed: `${key} ${state}`, expected: '', offenders: [], ...extra })

// ---------------------------------------------------------------------------------------------
// P3-11 — a close requires an edit that carries the evidence
// ---------------------------------------------------------------------------------------------

test('P3-11 a requirement that flips with NO edit is a phantom close, never credited', () => {
  const r = creditClosures({
    wasOpen: [1], nowOpen: [],
    edits: [{ merge_field: 'ResumeSummary', before_text: 'same text', after_text: 'same text' }],
    requirements: [req(1, 'led a platform modernization programme')],
  })
  assert.deepEqual(r.closed, [], 'nothing was rewritten, so nothing may be credited')
  assert.deepEqual(r.phantom, [1])
  assert.deepEqual(r.editedFields, [])
})

test('P3-11 an edit to an UNRELATED field does not earn the close it appears to cause', () => {
  // The defect class: covers() is token overlap over the WHOLE document, so pushing any text in can
  // flip a requirement. Only text this pass wrote may justify the credit.
  const r = creditClosures({
    wasOpen: [1], nowOpen: [],
    edits: [{ merge_field: 'ExpertiseBullets', before_text: 'old', after_text: 'Budget stewardship and vendor negotiation' }],
    requirements: [req(1, 'led a platform modernization programme across four business units')],
  })
  assert.deepEqual(r.closed, [], 'the rewritten text does not evidence the requirement')
  assert.deepEqual(r.phantom, [1])
  assert.deepEqual(r.editedFields, ['ExpertiseBullets'])
})

test('P3-11 an edit that DOES carry the evidence is credited', () => {
  const r = creditClosures({
    wasOpen: [1, 2], nowOpen: [2],
    edits: [{ merge_field: 'ResumeSummary', before_text: 'old', after_text: 'Led a platform modernization programme across four business units.' }],
    requirements: [req(1, 'led a platform modernization programme across four business units'), req(2, 'owns regulatory reporting to the board')],
  })
  assert.deepEqual(r.closed, [1])
  assert.deepEqual(r.phantom, [])
  assert.deepEqual(r.remaining, [2])
})

test('P3-11 realEdits ignores a row whose after_text is blank or unchanged', () => {
  const rows = [
    { merge_field: 'a', before_text: 'x', after_text: 'x' },
    { merge_field: 'b', before_text: 'x', after_text: '   ' },
    { merge_field: 'c', before_text: null, after_text: null },
    { merge_field: 'd', before_text: 'x', after_text: 'y' },
  ]
  assert.deepEqual(realEdits(rows).map(r => r.merge_field), ['d'])
})

// ---------------------------------------------------------------------------------------------
// P3-05 / P3-37 — converged is unfalsifiable; green because fixed, never because stopped
// ---------------------------------------------------------------------------------------------

test('P3-05 nothing open but must_have_coverage is not_applicable is NOT convergence', () => {
  const d = decidePass({
    pass: 1, coverage: coverageView([det('must_have_coverage', 'not_applicable')]),
    remaining: [], progressedLastPass: null, spend: ZERO_SPEND, prefs: DEFAULT_LOOP_PREFS, scope: ['ResumeSummary'],
  })
  assert.equal(d.action, 'halt')
  assert.equal(d.reason, 'no_coverage_evidence', 'absent evidence is not_applicable, never a pass')
  assert.notEqual(d.reason, 'converged')
})

test('P3-05 converged requires BOTH an empty open list and a passing coverage check', () => {
  const conv = decidePass({
    pass: 1, coverage: coverageView([det('must_have_coverage', 'pass')]),
    remaining: [], progressedLastPass: null, spend: ZERO_SPEND, prefs: DEFAULT_LOOP_PREFS, scope: ['ResumeSummary'],
  })
  assert.equal(conv.reason, 'converged')
  const warn = decidePass({
    pass: 1, coverage: coverageView([det('must_have_coverage', 'warn')]),
    remaining: [], progressedLastPass: null, spend: ZERO_SPEND, prefs: DEFAULT_LOOP_PREFS, scope: ['ResumeSummary'],
  })
  assert.notEqual(warn.reason, 'converged', 'a warn coverage check is not convergence')
})

test('P3-37 a halted run with must-haves open never reports converged, and says so in words', () => {
  const o = reportedOutcome([
    { n: 1, halted: false, halt_reason: null, remaining: [3, 4], must_have_state: 'fail' },
    { n: 2, halted: true, halt_reason: 'no_progress', remaining: [3, 4], must_have_state: 'fail' },
  ])
  assert.equal(o.converged, false)
  assert.equal(o.openMustHaves, 2)
  assert.match(o.summary, /Halted after 2 pass\(es\) \(no_progress\) with 2 must-have/)
  assert.doesNotMatch(o.summary, /Converged/)
})

test('P3-37 reportedOutcome refuses converged when the last row still lists open requirements', () => {
  // The row could only exist if the table CHECK were bypassed; the reader must not trust it anyway.
  const o = reportedOutcome([{ n: 1, halted: true, halt_reason: 'converged', remaining: [9], must_have_state: 'pass' }])
  assert.equal(o.converged, false, 'converged with something open is a contradiction, not a result')
})

test('only converged is honest green', () => {
  assert.equal(isHonestGreen('converged'), true)
  for (const r of HALT_REASONS.filter(r => r !== 'converged')) assert.equal(isHonestGreen(r), false, r)
})

// ---------------------------------------------------------------------------------------------
// P3-38 — never green by removing evidence
// ---------------------------------------------------------------------------------------------

test('P3-38 requirement rows disappearing during a loop is refused', () => {
  const why = evidenceRemoved({ reqCount: 12, mustHaveState: 'fail' }, { reqCount: 9, mustHaveState: 'pass' })
  assert.match(why, /requirement rows changed during the loop: 12 -> 9/)
  assert.throws(() => assertEvidenceIntact({ reqCount: 12, mustHaveState: 'fail' }, { reqCount: 9, mustHaveState: 'pass' }),
    /remediation refused/)
})

test('P3-38 must_have_coverage sliding fail -> not_applicable is refused', () => {
  const why = evidenceRemoved({ reqCount: 12, mustHaveState: 'fail' }, { reqCount: 12, mustHaveState: 'not_applicable' })
  assert.match(why, /fail -> not_applicable/)
})

test('P3-38 an honest fail -> pass with the evidence intact is allowed', () => {
  assert.equal(evidenceRemoved({ reqCount: 12, mustHaveState: 'fail' }, { reqCount: 12, mustHaveState: 'pass' }), null)
})

// ---------------------------------------------------------------------------------------------
// The denominator (D-12) — read from the engine, not from requirement rows
// ---------------------------------------------------------------------------------------------

test('the open list comes from the engine offenders, and only when it FAILED', () => {
  const v = coverageView([det('must_have_coverage', 'fail', { offenders: ['#3 lead the portfolio', '#7 board reporting', '#3 dupe'] })])
  assert.deepEqual(v.openSeqs, [3, 7])
  assert.equal(v.judged, true)
  const passing = coverageView([det('must_have_coverage', 'pass', { offenders: ['#3 stale'] })])
  assert.deepEqual(passing.openSeqs, [], 'a passing check has no open list, whatever it left in offenders')
})

test('a missing must_have_coverage row is not_applicable and not judged', () => {
  const v = coverageView([det('skill_char_limit', 'pass')])
  assert.equal(v.state, 'not_applicable')
  assert.equal(v.judged, false)
})

test('a reviewer-engine coverage row never supplies the denominator', () => {
  const v = coverageView([{ check_key: 'must_have_coverage', engine: 'reviewer', state: 'fail', observed: '', expected: '', offenders: ['#1 x'] }])
  assert.equal(v.judged, false, 'the loop optimises against deterministic rows only (D6)')
})

test('offenderSeqs ignores anything not shaped like an offender', () => {
  assert.deepEqual(offenderSeqs(['#12 a', 'no seq here', '#4 b', null, '#12 again']), [4, 12])
  assert.deepEqual(offenderSeqs(null), [])
})

// ---------------------------------------------------------------------------------------------
// Scope — do not rewrite closed blocks
// ---------------------------------------------------------------------------------------------

test('a field that is the SOLE evidence for a covered requirement is withheld', () => {
  const reqs = [req(1, 'board reporting and audit committee governance'), req(2, 'platform modernization across business units')]
  const pkg = {
    ResumeSummary: 'Board reporting and audit committee governance every quarter.',
    ExpertiseBullets: 'Vendor management',
    SkillsBullets1: '', SkillsBullets2: '', WorkHistoryBullets1: '', RelevantBullets1: '', RelevantBullets2: '',
  }
  const s = scopeForRequirements('resume', pkg, reqs, [2])
  assert.ok(!s.fields.includes('ResumeSummary'), 'rewriting it is the one action that can re-open #1')
  assert.deepEqual(s.protected.find(p => p.field === 'ResumeSummary').protects, [1])
  assert.ok(s.fields.includes('ExpertiseBullets'))
})

test('structural fields are never in scope — rewriting them cannot close a requirement', () => {
  const s = scopeForRequirements('cover', { '@Company': 'Trinnex', '@CoverLetterBody': 'text' }, [], [])
  for (const f of STRUCTURAL_FIELDS) assert.ok(!s.fields.includes(f), `${f} must never be rewritable`)
})

// ---------------------------------------------------------------------------------------------
// Scoped regeneration — enforced on the way in, not requested in a prompt
// ---------------------------------------------------------------------------------------------

test('a model key outside the scope is REJECTED, not written', () => {
  const r = applyScopedFields({ A: 'a', B: 'b' }, { A: 'new a', B: 'hijacked' }, ['A'])
  assert.equal(r.pkg.B, 'b', 'B was not in scope; the pass promised not to touch it')
  assert.deepEqual(r.applied, ['A'])
  assert.match(r.rejected.find(x => x.field === 'B').why, /outside the scope/)
})

test('a blank value is rejected — emptying a correct field is a deletion, not a remediation', () => {
  const r = applyScopedFields({ A: 'real content' }, { A: '   ' }, ['A'])
  assert.equal(r.pkg.A, 'real content')
  assert.match(r.rejected[0].why, /blank/)
})

test('an identical value is not counted as an edit', () => {
  const r = applyScopedFields({ A: 'same' }, { A: 'same' }, ['A'])
  assert.deepEqual(r.applied, [])
  assert.match(r.rejected[0].why, /identical/)
})

test('the scoped prompt mines the profile and forbids invention', () => {
  const { system, user } = buildScopedPrompt({
    company: 'Trinnex', role: 'CTO', pass: 2, fields: ['ResumeSummary'],
    current: { ResumeSummary: 'current text' },
    open: [{ seq: 3, verbatim: 'own a P&L of $18M', item_text: 'own a P&L', kind: 'must_have' }],
    profileText: 'Ran an $18M budget and a 60+ person organisation.', omitList: 'never mention Acme',
  })
  assert.match(system, /NEVER invent an employer, a metric, a title, a date, a certification or a system/)
  assert.match(user, /mine this FIRST/)
  assert.match(user, /Ran an \$18M budget/, 'the backlog: the evidence was already in the profile and was not pulled forward')
  assert.match(user, /never mention Acme/, "the owner's do-not-use list must reach the model")
  assert.match(user, /#3 must_have/)
})

// ---------------------------------------------------------------------------------------------
// Budget — enforced, not observed
// ---------------------------------------------------------------------------------------------

test('an UNPRICED call is never counted as free, and the token ceiling becomes the binding limit', () => {
  let s = addCall({ ...ZERO_SPEND }, { costUsd: null, tokens: 1000 })
  assert.equal(s.usd, 0)
  assert.equal(s.unpricedCalls, 1)
  assert.equal(costComplete(s), false)
  // The USD ceiling must NOT trip on an undercount, and must not authorise another pass either.
  const v = budgetVerdict({ ...s, tokens: 5, passesDone: 1 }, { ...DEFAULT_LOOP_PREFS, costCeilingUsd: 0.0001 })
  assert.equal(v.halt, false, 'a ceiling decided from an undercount is a false statement, not a conservative one')
  assert.equal(v.costComplete, false)
  assert.match(v.detail, /cost unknown \(1 unpriced call\(s\)\)/)
  const tok = budgetVerdict({ ...s, tokens: 999999, passesDone: 1 }, DEFAULT_LOOP_PREFS)
  assert.equal(tok.reason, 'token_ceiling')
  assert.match(tok.detail, /unpriced model/)
})

test('the cost ceiling trips when every call was priced', () => {
  const s = addCall({ ...ZERO_SPEND }, { costUsd: 5, tokens: 10 })
  assert.equal(budgetVerdict({ ...s, passesDone: 1 }, DEFAULT_LOOP_PREFS).reason, 'cost_ceiling')
})

test('the time budget is checked before anything else — a timed-out run is never "no progress"', () => {
  const v = budgetVerdict({ ...ZERO_SPEND, elapsedMs: 999_999, passesDone: 9, tokens: 9e9 }, DEFAULT_LOOP_PREFS)
  assert.equal(v.reason, 'time_budget')
})

test('the pass ceiling is the owner\'s, not a constant', () => {
  const s = { ...ZERO_SPEND, passesDone: 2 }
  assert.equal(budgetVerdict(s, DEFAULT_LOOP_PREFS).halt, false)
  assert.equal(budgetVerdict(s, { ...DEFAULT_LOOP_PREFS, maxPasses: 2 }).reason, 'max_passes')
})

// ---------------------------------------------------------------------------------------------
// Halting order — every exit names itself
// ---------------------------------------------------------------------------------------------

test('a budget halt is never mislabelled as no_progress', () => {
  const d = decidePass({
    pass: 3, coverage: coverageView([det('must_have_coverage', 'fail', { offenders: ['#1 x'] })]),
    remaining: [1], progressedLastPass: false,
    spend: { ...ZERO_SPEND, elapsedMs: 999_999 }, prefs: DEFAULT_LOOP_PREFS, scope: ['ResumeSummary'],
  })
  assert.equal(d.reason, 'time_budget', 'a run cut short by a ceiling had no chance to make progress')
})

test('a pass that closed nothing halts as no_progress', () => {
  const d = decidePass({
    pass: 2, coverage: coverageView([det('must_have_coverage', 'fail', { offenders: ['#1 x'] })]),
    remaining: [1], progressedLastPass: false, spend: { ...ZERO_SPEND, passesDone: 1 },
    prefs: DEFAULT_LOOP_PREFS, scope: ['ResumeSummary'],
  })
  assert.equal(d.reason, 'no_progress')
})

test('an empty scope halts rather than rewriting evidence already held', () => {
  const d = decidePass({
    pass: 1, coverage: coverageView([det('must_have_coverage', 'fail', { offenders: ['#1 x'] })]),
    remaining: [1], progressedLastPass: null, spend: ZERO_SPEND, prefs: DEFAULT_LOOP_PREFS, scope: [],
  })
  assert.equal(d.reason, 'nothing_reachable')
})

test('with work to do and budget left, the loop regenerates', () => {
  const d = decidePass({
    pass: 1, coverage: coverageView([det('must_have_coverage', 'fail', { offenders: ['#1 x', '#2 y'] })]),
    remaining: [1, 2], progressedLastPass: null, spend: ZERO_SPEND, prefs: DEFAULT_LOOP_PREFS, scope: ['ResumeSummary'],
  })
  assert.equal(d.action, 'regenerate')
  assert.equal(d.reason, null)
})

// ---------------------------------------------------------------------------------------------
// P3.2 — escalations
// ---------------------------------------------------------------------------------------------

test('an escalation states what was searched and why it could not be closed', () => {
  const e = escalationFor({
    requirement: { seq: 4, verbatim: 'FedRAMP authorization experience', item_text: 'FedRAMP', kind: 'must_have' },
    artifactType: 'resume', pass: 3, haltReason: 'no_progress',
    searched: ['ResumeSummary', 'ExpertiseBullets'],
    withheld: [{ field: 'SkillsBullets1', protects: [1, 2] }],
    profileSearched: true,
  })
  assert.match(e.detail, /FedRAMP authorization experience/)
  assert.match(e.detail, /the standing profile \(MasterContext\)/)
  assert.match(e.detail, /ResumeSummary, ExpertiseBullets/)
  assert.match(e.detail, /SkillsBullets1 \(sole evidence for #1, #2\)/)
  assert.match(e.detail, /No content was invented to close it/)
  assert.match(e.ask, /Supply evidence|accept the gap/)
})

test('every halt reason has a sentence — an escalation never says the raw enum', () => {
  for (const reason of HALT_REASONS) {
    const e = escalationFor({
      requirement: { seq: 1, verbatim: null, item_text: 'a requirement', kind: 'nice_to_have' },
      artifactType: 'cover', pass: 1, haltReason: reason, searched: [], withheld: [], profileSearched: false,
    })
    assert.doesNotMatch(e.detail, new RegExp(`Why it is still open: ${reason}\\.`), `${reason} has no sentence`)
  }
})

// ---------------------------------------------------------------------------------------------
// P3-02 — an ungrounded opportunity is not remediated at all
// ---------------------------------------------------------------------------------------------

test('P3-02 ungrounded is a first-class halt reason with its own sentence', () => {
  assert.ok(HALT_REASONS.includes('ungrounded'))
  const e = escalationFor({
    requirement: { seq: 1, verbatim: null, item_text: 'a requirement', kind: 'must_have' },
    artifactType: 'resume', pass: 0, haltReason: 'ungrounded', searched: [], withheld: [], profileSearched: false,
  })
  assert.match(e.detail, /no job posting on file/)
  assert.equal(isHonestGreen('ungrounded'), false)
})

// ---------------------------------------------------------------------------------------------
// P3-18 — the evidence was already in the profile and was simply not pulled forward
// ---------------------------------------------------------------------------------------------

test('P3-18 an open requirement the profile ALREADY evidences is named', () => {
  const open = [
    req(1, 'managed an operating budget above fifteen million dollars'),
    req(2, 'holds an active FedRAMP authorization'),
  ]
  const hits = profileEvidenceFor(
    'Managed an operating budget above fifteen million dollars and a 60+ person organisation.', open)
  assert.deepEqual(hits, [1], 'the budget was in the work history all along; FedRAMP genuinely is not')
})

test('P3-18 an empty profile names nothing rather than everything', () => {
  assert.deepEqual(profileEvidenceFor('', [req(1, 'anything at all here')]), [])
  assert.deepEqual(profileEvidenceFor('   ', [req(1, 'anything at all here')]), [])
})

test('P3-18 uses the SAME predicate as the gate — no second coverage rule', () => {
  // A requirement whose distinctive tokens are absent must not be claimed as profile-evidenced.
  assert.deepEqual(profileEvidenceFor('unrelated prose about sailing', [req(1, 'regulatory reporting to the audit committee')]), [])
})

// ---------------------------------------------------------------------------------------------
// A second run continues the ledger — it does not overwrite the first
// ---------------------------------------------------------------------------------------------

test('a second run starts after the highest pass already recorded', () => {
  assert.equal(nextPassNumber(-1), 1, 'no rows yet: the first pass is 1')
  assert.equal(nextPassNumber(0), 1, 'only the loop-0 baseline exists')
  assert.equal(nextPassNumber(3), 4, 'run 1 ended at pass 3; run 2 continues at 4, it does not restate 1')
  assert.equal(nextPassNumber(null), 1)
  assert.equal(nextPassNumber(undefined), 1)
  assert.equal(nextPassNumber(NaN), 1)
})

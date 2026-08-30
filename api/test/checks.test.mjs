// P2.1 — the deterministic checks engine.
//
// THRESHOLDS: THERE ARE TWO LIVE PROMPTS AND THEY STATE DIFFERENT LIMITS. Established from the
// primary source (`docs/zap-289877647/prompts/`), 2026-08-22:
//   16-update-resume-portfolio-fields (Call 1, the GENERATOR)  — "strict limit of 30 characters
//     per skill", repeated four times; relevant lists "no more than 1 bullet with more than 20
//     characters" (which is why `relevantOverLimitAllowance` is 1, not a flat cap).
//   25-post-analysis-qa (Call 3, `ats_user`, the QC pass)       — skills 24, relevant 20.
// This header previously said "the LIVE prompt states 30" citing run 32311693658. That was true of
// the GENERATOR and was read as though only one prompt existed.
//
// The seeds are now 24/20 BY OWNER DECISION (2026-08-22: "stick to 24/20 to start and we will
// assess pushing to 30"), which is the QC pass's number. CONSEQUENCE, deliberately accepted: the
// generator is still instructed to produce up to 30, so items it was allowed to write will be
// graded as findings. That is the owner's call, and the seeds are owner-overridable anyway.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, gateFor, attentionCount, DEFAULT_THRESHOLDS, AI_TELLS } from '../dist/functions/tests/checks.js'

const find = (rs, k) => rs.find(r => r.check_key === k)
const RESUME_FULL = {
  // INSIDE the 55-60 band (Prompt 16's own contract), because almost every test below builds on
  // this package and asserts "nothing else in this package should fail". A summary outside the band
  // makes `word_counts` fail everywhere and turns an unrelated assertion into noise. It is also
  // simply more honest: a fixture that could never pass the product's own checks is not a fixture
  // of a good packet.
  ResumeSummary: 'A pragmatic engineering leader who owns roadmap strategy across several product lines, builds and grows durable delivery teams across regions, and turns a messy operating picture into measurable outcomes that executives and customers can both see clearly, quarter after quarter, without drama or surprise reversals along the way, and who keeps the plan honest when the numbers move against it',
  SkillsBullets1: Array.from({ length: 10 }, (_, i) => `Skill number ${i}`).join('\n'),
  SkillsBullets2: Array.from({ length: 10 }, (_, i) => `Other skill ${i}`).join('\n'),
  ExpertiseBullets: 'One two three four five\nSix seven eight nine ten',
  RelevantBullets1: 'Short one\nShort two',
  RelevantBullets2: 'Alpha\nBeta',
  RelevantBullets3: 'Gamma\nDelta',
}

test('the thresholds are the prompt values, not the backlog values', () => {
  assert.equal(DEFAULT_THRESHOLDS.skillMaxChars, 24,
    'owner decision 2026-08-22: 24 is the QC prompt\'s number; the generator prompt says 30')
  assert.deepEqual([DEFAULT_THRESHOLDS.skillsTotalMin, DEFAULT_THRESHOLDS.skillsTotalMax], [20, 22])
  assert.equal(DEFAULT_THRESHOLDS.relevantOverLimitAllowance, 1, 'the prompt states an allowance, not a flat cap')
  assert.deepEqual(DEFAULT_THRESHOLDS.coverWords, [250, 400])
})

test('thresholds are overridable — nothing here is a permanent constant', () => {
  // 22 chars — inside the seeded 24, outside a stricter 20. The old fixture was 28 chars, which
  // passed only while the seed was 30.
  const pkg = { ...RESUME_FULL, SkillsBullets1: 'Twenty two char skill!' }
  assert.equal(find(runChecks({ type: 'resume', pkg }), 'skill_char_limit').state, 'pass')
  const strict = runChecks({ type: 'resume', pkg, thresholds: { skillMaxChars: 20 } })
  assert.equal(find(strict, 'skill_char_limit').state, 'fail')
})

test('a deliberately over-length skill produces exactly one fail NAMING that skill', () => {
  const long = 'This skill label is definitely longer than thirty characters'
  const rs = runChecks({ type: 'resume', pkg: { ...RESUME_FULL, SkillsBullets1: `Short one\n${long}` } })
  const fails = rs.filter(r => r.state === 'fail' && r.check_key === 'skill_char_limit')
  assert.equal(fails.length, 1)
  assert.equal(fails[0].offenders.length, 1)
  assert.match(fails[0].offenders[0], /longer than thirty characters \(\d+\)/)
})

test('offenders name items, never a bare count', () => {
  const rs = runChecks({ type: 'resume', pkg: { ...RESUME_FULL, SkillsBullets1: 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } })
  const f = find(rs, 'skill_char_limit')
  assert.equal(f.offenders.length, 2)
  assert.ok(f.offenders.every(o => /[A-Za-z]/.test(o)), 'an offender must be actionable text')
})

test('the relevant-list rule is an ALLOWANCE of one per list, not a flat cap', () => {
  const oneOver = { ...RESUME_FULL, RelevantBullets1: 'Short\nA twenty five char item!!' }
  assert.equal(find(runChecks({ type: 'resume', pkg: oneOver }), 'relevant_char_limit').state, 'pass')
  const twoOver = { ...RESUME_FULL, RelevantBullets1: 'A twenty five char item!!\nAnother overly long item here' }
  const r = find(runChecks({ type: 'resume', pkg: twoOver }), 'relevant_char_limit')
  assert.equal(r.state, 'fail')
  assert.equal(r.offenders.length, 2)
})

test('skill count and split are checked together', () => {
  const r = find(runChecks({ type: 'resume', pkg: RESUME_FULL }), 'skill_list_count')
  assert.equal(r.state, 'pass')
  const lopsided = find(runChecks({ type: 'resume', pkg: { ...RESUME_FULL, SkillsBullets2: 'Only one' } }), 'skill_list_count')
  assert.equal(lopsided.state, 'warn')
  assert.ok(lopsided.offenders.some(o => /total/.test(o)) && lopsided.offenders.some(o => /split/.test(o)))
})

test('an item in two lists is caught and both lists are named', () => {
  const r = find(runChecks({ type: 'resume', pkg: { ...RESUME_FULL, RelevantBullets1: 'Skill number 0\nOther' } }), 'cross_list_redundancy')
  assert.equal(r.state, 'fail')
  assert.match(r.offenders[0], /SkillsBullets1 \+ RelevantBullets1/)
})

test('omission-list membership fails, and its ABSENCE is not_applicable rather than pass', () => {
  const hit = find(runChecks({ type: 'resume', pkg: RESUME_FULL, omitList: 'Skill number 3' }), 'omission_list')
  assert.equal(hit.state, 'fail')
  assert.match(hit.offenders[0], /Skill number 3/)
  assert.equal(find(runChecks({ type: 'resume', pkg: RESUME_FULL }), 'omission_list').state, 'not_applicable')
})

test('machine-tell vocabulary and em-dashes are found', () => {
  const r = find(runChecks({ type: 'resume', pkg: { ...RESUME_FULL, ResumeSummary: 'A testament to delve into the ever-evolving landscape — truly.' } }), 'ai_tells')
  assert.equal(r.state, 'warn')
  assert.ok(r.offenders.some(o => o.includes('delve')))
  assert.ok(r.offenders.some(o => /em-dash/.test(o)))
  assert.ok(AI_TELLS.length > 10)
})

test('markup, code fences, unresolved tokens and entities are all residue', () => {
  const r = find(runChecks({ type: 'resume', pkg: { ...RESUME_FULL,
    ResumeSummary: '```\n<p>Owned P&amp;L</p> {{289877659__Items to Omit}}\n```' } }), 'markup_residue')
  assert.equal(r.state, 'fail')
  for (const kind of [/code fence/, /unresolved/, /html markup/, /html entity/]) {
    assert.ok(r.offenders.some(o => kind.test(o)), `missed ${kind}`)
  }
})

test('empty merge fields are reported against the template, and clean text passes', () => {
  assert.equal(find(runChecks({ type: 'resume', pkg: RESUME_FULL }), 'empty_merge_fields').state, 'pass')
  const r = find(runChecks({ type: 'resume', pkg: { ResumeSummary: 'only this' } }), 'empty_merge_fields')
  assert.equal(r.state, 'fail')
  assert.equal(r.offenders.length, 6, 'the resume has 7 merge fields; 6 are empty here')
})

test('word bands apply only to the fields an artifact actually has', () => {
  // THE INVARIANT IS "only the fields this artifact HAS", not "the resume has none".
  //
  // This used to assert `find(resume, 'word_counts') === undefined` — true only while ResumeSummary
  // had no band, which was the defect: Prompt 16 asks the model for `### Resume Summary (55-60
  // words)` and nothing enforced or displayed it, so production shipped 48/49/49/61/61/70/70 words,
  // none inside the band. The band now exists, so the old assertion pinned the old state rather
  // than the rule. The rule itself is unchanged and is what is asserted now: a band belongs to a
  // FIELD, and a field the artifact does not carry is never judged.
  const resume = runChecks({ type: 'resume', pkg: RESUME_FULL })
  const rw = find(resume, 'word_counts')
  assert.ok(rw, 'the resume carries ResumeSummary, which is word-banded')
  assert.match(rw.expected, /ResumeSummary 55-60/, 'the resume states its own band')
  assert.ok(!/CoverLetterBody|AboutMe|ExecutiveProfile/.test(rw.expected),
    'a band for a field the resume does not have must never be applied to it')

  const good = 'word '.repeat(300).trim()
  const cover = runChecks({ type: 'cover', pkg: { '@Company': 'Acme', '@CoverLetterDate': 'x', '@CoverLetterBody': good }, company: 'Acme' })
  assert.equal(find(cover, 'word_counts').state, 'pass')

  const short = runChecks({ type: 'cover', pkg: { '@Company': 'Acme', '@CoverLetterDate': 'x', '@CoverLetterBody': 'too short' }, company: 'Acme' })
  const w = find(short, 'word_counts')
  assert.equal(w.state, 'fail')
  assert.match(w.offenders[0], /@CoverLetterBody: 2 words \(want 250-400\)/)
})

test('the stale company name is caught in both the field and the letter body', () => {
  const stale = runChecks({
    type: 'cover', company: 'Trinnex',
    pkg: { '@Company': 'Previous Employer', '@CoverLetterDate': 'x', '@CoverLetterBody': 'word '.repeat(300).trim() },
  })
  assert.equal(find(stale, 'company_named').state, 'fail')
  assert.match(find(stale, 'company_named').offenders[0], /expected Trinnex, found Previous Employer/)
  assert.equal(find(stale, 'company_in_body').state, 'fail')

  const good = runChecks({
    type: 'cover', company: 'Trinnex',
    pkg: { '@Company': 'Trinnex', '@CoverLetterDate': 'x', '@CoverLetterBody': `Trinnex ${'word '.repeat(299)}`.trim() },
  })
  assert.equal(find(good, 'company_named').state, 'pass')
  assert.equal(find(good, 'company_in_body').state, 'pass')
})

// ---- AC 2.1.9, the safety rule -------------------------------------------------------------
test('coverage with NO requirement rows is not_applicable — never pass', () => {
  const rs = runChecks({ type: 'resume', pkg: RESUME_FULL })
  for (const k of ['must_have_coverage', 'responsibilities_addressed']) {
    assert.equal(find(rs, k).state, 'not_applicable', `${k} must not pass on absent evidence`)
  }
  assert.ok(!rs.some(r => ['must_have_coverage', 'responsibilities_addressed'].includes(r.check_key) && r.state === 'pass'))
})

// P8.3 / C6: coverage is decided by EVIDENCE rows, not by whether the document repeats the words.
// `evidence` is now a required input for any coverage verdict; these helpers shape it.
const evRow = (label = 'Work history 1 · stored profile') =>
  ({ quote: 'led the platform modernization programme end to end', source_kind: 'work_history',
     source_label: label, source_key: 'workHistory1', char_start: 0, char_end: 51,
     extra: null, ratio: 1, method: 'anchored', record_sha256: '', resolver_version: 1 })
const evidenceFor = (...seqs) => ({ profileReadable: true, bySeq: Object.fromEntries(seqs.map(n => [n, evRow()])) })

test('an unevidenced must-have fails and names the requirement', () => {
  // Was: "an uncovered must-have fails and names the requirement", where covered meant the words
  // appeared in the generated document. C6 moved the numerator to evidence rows; the assertion the
  // test was written to make — one uncovered must-have, a fail, and the requirement named — is
  // unchanged.
  const reqs = [
    { seq: 0, verbatim: 'Deep experience with Kubernetes cluster federation', item_text: 'k8s', kind: 'must_have' },
    { seq: 1, verbatim: 'Owns roadmap strategy and measurable outcomes', item_text: 'roadmap', kind: 'must_have' },
  ]
  const r = find(runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs, evidence: evidenceFor(1) }), 'must_have_coverage')
  assert.equal(r.state, 'fail')
  assert.equal(r.offenders.length, 1)
  assert.match(r.offenders[0], /#0 Deep experience with Kubernetes/)
  assert.match(r.offenders[0], /no evidence found in your profile/)
  assert.equal(r.observed, '1/2 must-haves evidenced')
})

test('a document containing the words does NOT make a requirement covered without evidence (C6)', () => {
  // The whole of P8.3 in one assertion. RESUME_FULL literally contains "roadmap strategy and
  // execution", which is what the pre-C6 numerator counted; with no evidence row it is not coverage.
  const reqs = [{ seq: 0, verbatim: 'Deep experience with roadmap strategy and execution', item_text: '', kind: 'must_have' }]
  const withoutEvidence = runChecks({
    type: 'resume', pkg: { ...RESUME_FULL, ResumeSummary: 'Deep experience with roadmap strategy and execution.' },
    requirements: reqs, evidence: { profileReadable: true, bySeq: {} },
  })
  const c = find(withoutEvidence, 'must_have_coverage')
  assert.equal(c.state, 'fail', 'the document says it; the profile does not support it')
  assert.match(c.offenders[0], /no evidence found in your profile/)
  // And the placement signal the old numerator carried is not lost — it is its own number.
  assert.equal(find(withoutEvidence, 'evidence_placed').state, 'not_applicable')
})

test('an evidenced requirement absent from the document is a placement warning, not a coverage gap', () => {
  const reqs = [{ seq: 0, verbatim: 'Deep experience with Kubernetes cluster federation', item_text: '', kind: 'must_have' }]
  const rs = runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs, evidence: evidenceFor(0) })
  assert.equal(find(rs, 'must_have_coverage').state, 'pass', 'the profile supports it')
  const placed = find(rs, 'evidence_placed')
  assert.equal(placed.state, 'warn', 'and this asset never says it')
  assert.match(placed.offenders[0], /#0 Deep experience with Kubernetes/)
})

test('coverage with NO evidence input at all is not_applicable — never pass, never fail', () => {
  const reqs = [{ seq: 0, verbatim: 'Deep experience with Kubernetes cluster federation', item_text: '', kind: 'must_have' }]
  for (const evidence of [undefined, { profileReadable: false, bySeq: {} }]) {
    const rs = runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs, evidence })
    for (const k of ['must_have_coverage', 'responsibilities_addressed', 'evidence_placed']) {
      assert.equal(find(rs, k).state, 'not_applicable', `${k} must not judge what it could not read`)
    }
  }
})

test('a posting with requirements but no must-haves is not_applicable, not pass', () => {
  const reqs = [{ seq: 0, verbatim: 'Run the weekly ops review', item_text: 'ops', kind: 'responsibility' }]
  assert.equal(find(runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs }), 'must_have_coverage').state, 'not_applicable')
})

test('P1.5 template reach: preconditions no merge field can carry are surfaced, not scored', () => {
  // Live Trinnex must-have: "Reside in the East Coast of the United States". No resume can evidence
  // where someone lives; scoring it guarantees a permanently red gate, and an always-red gate is one
  // people learn to ignore.
  const reqs = [
    { seq: 0, verbatim: 'Reside in the East Coast of the United States', item_text: '', kind: 'must_have' },
    { seq: 1, verbatim: 'must be a U.S. Citizen or Green Card Holder', item_text: '', kind: 'must_have' },
    { seq: 2, verbatim: 'Active Secret security clearance required', item_text: '', kind: 'must_have' },
    { seq: 3, verbatim: 'Deep experience with roadmap strategy and execution', item_text: '', kind: 'must_have' },
  ]
  const rs = runChecks({
    type: 'resume',
    pkg: { ...RESUME_FULL, ResumeSummary: 'Owns roadmap strategy and execution with deep experience.' },
    requirements: reqs,
    evidence: evidenceFor(3),
  })
  const elig = find(rs, 'template_reach')
  assert.equal(elig.state, 'not_applicable')
  assert.equal(elig.offenders.length, 3, 'they are still NAMED — not scored never means not shown')
  assert.match(elig.offenders[0], /Reside in the East Coast/)

  // Only the coverable one is judged, and it IS covered, so the gate is not permanently red.
  const cov = find(rs, 'must_have_coverage')
  assert.equal(cov.state, 'pass')
  // ONE denominator, and it names what it left out. The fail branch used to divide by all four
  // must-haves while judging one, which credited the three unreachable rows as covered.
  assert.equal(cov.observed, '1/1 must-haves evidenced (3 not reachable by any generated field, not counted either way)')
})

test('a posting whose requirements are all reachable says so', () => {
  const rs = runChecks({
    type: 'resume', pkg: RESUME_FULL,
    requirements: [{ seq: 0, verbatim: 'Deep experience with roadmap strategy', item_text: '', kind: 'must_have' }],
    evidence: evidenceFor(0),
  })
  assert.equal(find(rs, 'template_reach').state, 'pass')
})

// ---- facts settle requirements about the CANDIDATE, not about the document -------------------
const ownerFact = (key, value, value_num = null) =>
  ({ key, value, value_num, source: 'owner_stated', confirmed_at: '2026-08-20T00:00:00Z' })

// The fixture asked for LEADERSHIP years and recorded only TOTAL years, and asserted a pass. That
// passed because `checkAgainstFacts` could not reach `experience.years_leadership` at all (D22 /
// H41) — the assertion was encoding the defect. The requirement is now a plain years one, which is
// what this test is about; the leadership case is H43, where it belongs.
test('a years requirement is settled by the profile, not by whether the resume repeats the number', () => {
  const rs = runChecks({
    type: 'resume', pkg: RESUME_FULL,
    requirements: [{ seq: 0, verbatim: 'Minimum of 10 years of professional experience', item_text: '', kind: 'must_have' }],
    facts: [ownerFact('experience.years_total', '24 years', 24)],
  })
  assert.equal(find(rs, 'facts_settled').state, 'pass')
  // It must NOT also be judged as uncovered document text — that would double-count one requirement.
  assert.equal(find(rs, 'must_have_coverage').state, 'not_applicable')
})

test('a shortfall WARNS and shows the arithmetic — it is a fit problem, not a document defect', () => {
  const rs = runChecks({
    type: 'resume', pkg: RESUME_FULL,
    requirements: [{ seq: 3, verbatim: '30+ years of experience required', item_text: '', kind: 'must_have' }],
    facts: [ownerFact('experience.years_total', '24 years', 24)],
  })
  const f = find(rs, 'fact_shortfall')
  assert.equal(f.state, 'warn', 'rewriting a resume cannot create years you do not have')
  assert.match(f.offenders[0], /24 years recorded, 30 required/)
})

test('a requirement needing an unrecorded fact is surfaced, never guessed', () => {
  const rs = runChecks({
    type: 'resume', pkg: RESUME_FULL,
    requirements: [{ seq: 0, verbatim: 'Active Secret security clearance required', item_text: '', kind: 'must_have' }],
    facts: [ownerFact('experience.years_total', '24 years', 24)],
  })
  const f = find(rs, 'facts_needed')
  assert.equal(f.state, 'not_applicable')
  assert.match(f.offenders[0], /clearance/)
})

test('an UNCONFIRMED fact does not settle anything, and the requirement stays surfaced', () => {
  const unconfirmed = { key: 'experience.years_total', value: '24 years', value_num: 24, source: 'derived', confirmed_at: null }
  const rs = runChecks({
    type: 'resume', pkg: RESUME_FULL,
    requirements: [{ seq: 0, verbatim: 'Minimum of 10 years of experience', item_text: '', kind: 'must_have' }],
    facts: [unconfirmed],
  })
  assert.equal(find(rs, 'facts_settled').state, 'not_applicable')
  assert.match(find(rs, 'facts_needed').offenders[0], /unconfirmed/)
})

test('with no facts recorded the engine behaves exactly as before', () => {
  const reqs = [{ seq: 0, verbatim: 'Deep experience with roadmap strategy and execution', item_text: '', kind: 'must_have' }]
  const withNone = runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs })
  assert.equal(withNone.find(r => r.check_key === 'facts_settled'), undefined, 'no fact rows, no fact checks')
  assert.ok(find(withNone, 'must_have_coverage'))
})

test('a requirement the facts own is reported ONCE, not under template_reach as well', () => {
  // Live Trinnex: "Reside in the East Coast" appeared under BOTH facts_needed and template_reach.
  // One requirement, two entries, two jobs for the reader where there is one.
  // Maryland IS on the East Coast, so this now SETTLES rather than asking. What the test pins is
  // that whichever way it resolves, the requirement appears in exactly one place.
  const rs = runChecks({
    type: 'resume', pkg: RESUME_FULL,
    requirements: [{ seq: 6, verbatim: 'Reside in the East Coast of the United States', item_text: '', kind: 'must_have' }],
    facts: [ownerFact('identity.location', 'Westminster, MD 21158')],
  })
  const named = k => (find(rs, k)?.offenders || []).join(' ')
  assert.equal(find(rs, 'facts_settled').state, 'pass', 'geography is looked up, not asked about')
  assert.ok(!/East Coast/.test(named('template_reach')), 'and it must not be listed a second time')
  assert.ok(!/East Coast/.test(named('facts_needed')), 'nor asked about once it is settled')
})

// ---- P2.2 inputs ---------------------------------------------------------------------------
test('an uncited change is a FAIL, never a warn', () => {
  const swaps = [
    { action: 'added', driver: 'unattributed', to_label: 'Quantum cryptography', from_label: null },
    { action: 'swapped', driver: 'posting', to_label: 'Roadmap ownership', from_label: 'Roadmaps' },
  ]
  const r = find(runChecks({ type: 'resume', pkg: RESUME_FULL, swaps }), 'changes_cited')
  assert.equal(r.state, 'fail')
  assert.deepEqual(r.offenders, ['added: Quantum cryptography'])
})

test('a rule-driven drop is not an uncited change — only swaps and adds are cited', () => {
  const swaps = [{ action: 'dropped', driver: 'rule', to_label: null, from_label: 'Secure coding' }]
  assert.equal(find(runChecks({ type: 'resume', pkg: RESUME_FULL, swaps }), 'changes_cited').state, 'pass')
})

test('no swap rows at all is not_applicable, never pass', () => {
  assert.equal(find(runChecks({ type: 'resume', pkg: RESUME_FULL }), 'changes_cited').state, 'not_applicable')
})

// ---- gate ----------------------------------------------------------------------------------
test('gate: any deterministic fail wins; a reviewer fail can only warn', () => {
  const d = (state, engine = 'deterministic') => ({ check_key: 'k', engine, state, observed: '', expected: '', offenders: [] })
  assert.equal(gateFor([d('pass'), d('fail')]), 'fail')
  assert.equal(gateFor([d('pass'), d('warn')]), 'warn')
  assert.equal(gateFor([d('pass'), d('fail', 'reviewer')]), 'warn', 'a model opinion must never block on its own')
  assert.equal(gateFor([d('pass'), d('pass')]), 'pass')
  // CORRECTED 2026-08-20. This asserted 'pass' — the only assertion in this block with no message,
  // recording what the implementation happened to do rather than a decision. The test immediately
  // below states the opposite principle in the author's own words: "nothing was verified — that is
  // not the same as everything passing." An empty set is strictly LESS verified than an
  // all-not_applicable set, so it cannot be the one that passes. See H22.
  assert.equal(gateFor([]), 'warn', 'no rows means nothing was checked, which is not a pass')
})

test('gate: not_applicable neither helps nor hurts, but an ALL-unknown artifact is not a pass', () => {
  const d = (state) => ({ check_key: 'k', engine: 'deterministic', state, observed: '', expected: '', offenders: [] })
  assert.equal(gateFor([d('pass'), d('not_applicable')]), 'pass')
  assert.equal(gateFor([d('not_applicable'), d('not_applicable')]), 'warn',
    'nothing was verified — that is not the same as everything passing')
})

test('the badge count and the gate read the SAME rows (the prototype bug)', () => {
  const d = (state) => ({ check_key: String(Math.random()), engine: 'deterministic', state, observed: '', expected: '', offenders: [] })
  const rs = [d('pass'), d('warn'), d('fail'), d('not_applicable')]
  assert.equal(attentionCount(rs), 2)
  assert.equal(gateFor(rs), 'fail')
  const clean = [d('pass'), d('pass')]
  assert.equal(attentionCount(clean), 0)
  assert.equal(gateFor(clean), 'pass', 'zero attention items must never sit beside a non-pass gate')
})

test('the engine is deterministic and costs no tokens', () => {
  const input = { type: 'resume', pkg: RESUME_FULL, company: 'Acme', omitList: 'Secure coding' }
  assert.deepEqual(runChecks(input), runChecks(input))
  assert.ok(runChecks(input).every(r => r.engine === 'deterministic'))
})

// --- R3 / P8.2: the posting's figures are the employer's, not the candidate's -------------------

const POSTING = 'You will manage a $18M portfolio across three business units and 60+ sites.'
const PROFILE = 'Operated 60 sites for a regional utility. Ran platform engineering.'
// R3's fixtures must land INSIDE the 55-60 word band, or `word_counts` fails on every one of them
// and drowns the check actually under test. Substituting the phrase dropped the summary under ten
// words; appending it to the full summary pushed it to 68. Neither is what these tests are about,
// so the phrase is COMPOSED to a compliant length instead. R3 scans for a figure anywhere in the
// field, so the phrase's position and the filler around it do not affect what is being exercised.
const FILLER = 'delivering measurable outcomes across teams and regions with steady quarterly execution and honest reporting to the board'.split(/\s+/)
const bandWords = (text, target = 58) => {
  const w = String(text).trim().split(/\s+/).filter(Boolean)
  if (w.length >= 55) return w.join(' ')   // already in or over band: never truncate the phrase itself
  for (let i = 0; w.length < target; i++) w.push(FILLER[i % FILLER.length])
  return w.join(' ')
}
const echoPkg = (summary) => ({ ...RESUME_FULL, ResumeSummary: bandWords(summary) })

test('R3 names the field and the exact figure taken from the posting', () => {
  const rs = runChecks({ type: 'resume', pkg: echoPkg('Managed a $18M portfolio across three business units.'),
                         postingText: POSTING, profileText: PROFILE })
  const r = find(rs, 'posting_figure_echo')
  assert.equal(r.state, 'warn')
  assert.deepEqual(r.offenders, ['ResumeSummary: $18M', 'ResumeSummary: three'])
  assert.ok(r.offenders.every(o => /^[A-Za-z]\w*: \S/.test(o)), 'an offender must name a field and a string')
})

test('R3 keeps a figure the profile also states, and says so', () => {
  // C5: a figure in BOTH posting and profile is kept and citable — R2 (evidence) beats a literal
  // reading of R3. Stripping "60" would delete the candidate's own true achievement because the
  // employer happened to ask for 60+.
  const rs = runChecks({ type: 'resume', pkg: echoPkg('Ran 60 sites across the Midwest.'),
                         postingText: POSTING, profileText: PROFILE })
  const r = find(rs, 'posting_figure_echo')
  assert.equal(r.state, 'pass')
  assert.deepEqual(r.offenders, [])
  // CITE, not count. C5 says kept AND cited, and R2 defines evidenced as "a verbatim excerpt from
  // the stored profile can be shown next to it". "1 figure(s) kept" — the first wording — told the
  // owner nothing they could check: not which figure, and not on what evidence.
  assert.match(r.observed, /kept as yours/, 'the carve-out must be visible, not silent')
  assert.match(r.observed, /60 \(your profile states 60\)/, 'it must name the figure AND the profile text that licenses it')
})

test('R3 without a posting or without a profile is not_applicable — never pass, never an accusation', () => {
  const pkg = echoPkg('Managed a $18M portfolio across three business units.')
  for (const [posting, profile, why] of [
    ['', PROFILE, /posting text/i],
    [POSTING, '', /profile/i],
    ['', '', /posting text/i],
  ]) {
    const r = find(runChecks({ type: 'resume', pkg, postingText: posting, profileText: profile }), 'posting_figure_echo')
    assert.equal(r.state, 'not_applicable', `posting=${!!posting} profile=${!!profile}`)
    assert.match(r.observed, why, 'not_applicable must say which side was missing')
    assert.deepEqual(r.offenders, [], 'nothing may be named when nothing could be judged')
  }
})

test('R3 warns rather than reddening the gate', () => {
  // C5 again, and the cry-wolf rule. A figure present in both documents can be legitimate, and the
  // P8.1 correction path supersedes this state. A gate that goes red on a shared number is a gate
  // people learn to click past — the offender list is what makes this actionable.
  const rs = runChecks({ type: 'resume', pkg: echoPkg('Managed a $18M portfolio across three business units.'),
                         postingText: POSTING, profileText: PROFILE })
  assert.equal(find(rs, 'posting_figure_echo').state, 'warn')
  assert.ok(!rs.some(r => r.state === 'fail'),
    `nothing else in this package should fail, but these did: ${rs.filter(r => r.state === 'fail')
      .map(r => `${r.check_key} (${r.observed})`).join(', ')}`)
  assert.equal(gateFor(rs), 'warn')
})

test('R3 scans every populated field, not just the summary', () => {
  // C3: the prototype shipped a swap reading `P&L $18M` because it "matches the figure in the
  // posting". A list item is exactly as indefensible in an interview as a summary sentence.
  const rs = runChecks({ type: 'resume',
    pkg: { ...RESUME_FULL, SkillsBullets1: 'Short one\nP&L $18M', RelevantBullets1: 'Org Scaling 60+\nShort two' },
    postingText: POSTING, profileText: 'Ran platform engineering.' })
  const r = find(rs, 'posting_figure_echo')
  assert.equal(r.state, 'warn')
  assert.ok(r.offenders.includes('SkillsBullets1: $18M'), `list items were not scanned: ${r.offenders}`)
  assert.ok(r.offenders.includes('RelevantBullets1: 60+'), `list items were not scanned: ${r.offenders}`)
})

// ---------------------------------------------------------------------------------------------
// D5 — a swap recorded but not yet rendered was text nobody checked.

test('D5: R3 scans swap labels that have not been rendered into a field yet', () => {
  // The backlog is explicit: "a list item may not read `Org Scaling 60+` or `P&L $18M`". Before
  // this, `runChecks` scanned `pkg` only, so a swap sitting in `swap_decision.to_label` passed R3
  // simply because the rendering had not caught up. The label is text the user will read.
  const rs = runChecks({
    type: 'resume', pkg: echoPkg('Led platform engineering for a regional utility.'),
    postingText: POSTING, profileText: PROFILE,
    swaps: [{ action: 'swapped', driver: 'posting', from_label: 'Team Leadership', to_label: 'P&L $18M' }],
  })
  const r = find(rs, 'posting_figure_echo')
  assert.equal(r.state, 'warn', 'an unrendered swap label carrying the posting\'s figure must surface')
  assert.deepEqual(r.offenders, ['swap: P&L $18M: $18M'])
})

test('D5: a swap label ALREADY rendered is reported once, not twice', () => {
  // The cry-wolf half. Adding the labels to the scan naively prints every offender twice — once as
  // the field and once as the label — under two different names for one string in one document.
  // A check that names people may not inflate its own count.
  const rs = runChecks({
    type: 'resume', pkg: echoPkg('Owned P&L $18M for the region.'),
    postingText: POSTING, profileText: PROFILE,
    swaps: [{ action: 'swapped', driver: 'posting', from_label: 'x', to_label: 'P&L $18M' }],
  })
  const r = find(rs, 'posting_figure_echo')
  assert.deepEqual(r.offenders, ['ResumeSummary: $18M'], 'the rendered field owns it; the label must not repeat it')
})

test('D5: swap labels do not manufacture an R3 verdict out of nothing', () => {
  // A clean label must not turn a pass into a warn, and `not_applicable` must survive: absent
  // posting text is still "could not look", never "looked and found nothing".
  const clean = [{ action: 'swapped', driver: 'posting', from_label: 'x', to_label: 'Platform Engineering' }]
  const passed = find(runChecks({ type: 'resume', pkg: echoPkg('Led platform engineering.'),
                                  postingText: POSTING, profileText: PROFILE, swaps: clean }), 'posting_figure_echo')
  assert.equal(passed.state, 'pass')
  assert.deepEqual(passed.offenders, [])
  const blind = find(runChecks({ type: 'resume', pkg: echoPkg('Led platform engineering.'),
                                 postingText: '', profileText: PROFILE, swaps: clean }), 'posting_figure_echo')
  assert.equal(blind.state, 'not_applicable', 'no posting text is not a clean scan')
})

// ---------------------------------------------------------------------------------------------
// D4 — wording kept from the posting, surfaced as its own check.

test('D4: wording kept from the posting is its own check, not more figure offenders', () => {
  // The spec separates them because the REMEDY differs: a figure gets auto-corrected (R1/P8.1), a
  // phrase never does. Folding them together would put prose into the auto-correct path.
  const posting = 'You will manage a portfolio of enterprise customers across three business units and report to the COO.'
  const rs = runChecks({ type: 'resume',
    pkg: echoPkg('Managed a portfolio of enterprise customers across three business units for a utility.'),
    postingText: posting, profileText: 'Operated 60 sites for a regional utility.' })
  const w = find(rs, 'posting_wording_kept')
  assert.equal(w.state, 'warn')
  assert.equal(w.offenders.length, 1)
  assert.match(w.offenders[0], /^ResumeSummary: "a portfolio of enterprise customers across three business units"$/)
  // The figure check is a SEPARATE row and does not absorb the phrase.
  const f = find(rs, 'posting_figure_echo')
  assert.ok(!f.offenders.some(o => /portfolio of enterprise/.test(o)), 'wording must not leak into the figure check')
})

test('D4: no posting text is not_applicable, never "no wording was kept"', () => {
  const rs = runChecks({ type: 'resume', pkg: echoPkg('Managed a portfolio of enterprise customers across three business units.'),
                         postingText: '<p></p>', profileText: PROFILE })
  assert.equal(find(rs, 'posting_wording_kept').state, 'not_applicable')
})

test('D4: the new check stays silent across every existing fixture in this file', () => {
  // The cry-wolf budget, measured rather than asserted. A new WARN-state check raises
  // attentionCount and can move a gate, so it must not fire on prose nobody copied.
  const fixtures = [
    ['Led platform engineering for a regional utility.', POSTING, PROFILE],
    ['Ran 60 sites across the Midwest.', POSTING, PROFILE],
    ['Managed a $18M portfolio across three business units.', POSTING, PROFILE],
    ['Cut incident volume 37% and shipped 14 releases.', POSTING, PROFILE],
    ['Built and led platform engineering teams across three regions.', POSTING, PROFILE],
  ]
  for (const [summary, posting, profile] of fixtures) {
    const w = find(runChecks({ type: 'resume', pkg: echoPkg(summary), postingText: posting, profileText: profile }), 'posting_wording_kept')
    assert.equal(w.state, 'pass', `${summary} -> ${JSON.stringify(w.offenders)}`)
  }
})

test('D4: the run length comes from thresholds, not from a constant', () => {
  const posting = 'We need someone to drive operational excellence across the enterprise every day.'
  const pkg = echoPkg('Drove operational excellence across the enterprise every day.')
  const base = { type: 'resume', pkg, postingText: posting, profileText: PROFILE }
  assert.equal(find(runChecks(base), 'posting_wording_kept').state, 'pass', 'silent at the seeded default')
  assert.equal(find(runChecks({ ...base, thresholds: { wordingRunTokens: 5 } }), 'posting_wording_kept').state, 'warn',
    'an owner lowering the threshold surfaces it — the value is not code-only')
})

// --- the escalation tier at the GATE ----------------------------------------------------------

/** A model-proposed evidence row: byte-exact, correctly attributed, and unscored by any rule. */
const proposedRow = () =>
  ({ quote: 'reduced outages from nine hours to one', source_kind: 'work_history',
     source_label: 'Work history 1 · stored profile', source_key: 'workHistory1',
     char_start: 0, char_end: 37, extra: 'Cutting outage duration improves reliability.',
     ratio: null, method: 'proposed', record_sha256: '', resolver_version: 2, proposal_version: 1 })

test('H:proposed-evidence-cannot-pass-the-gate: a model may propose, only a rule may accuse', () => {
  // THE PLACE THE ESCALATION TIER COULD HAVE LOOSENED THE WHOLE ENGINE SILENTLY.
  //
  // A proposed row is byte-exact in the record it names — `verifyProposal` accepts nothing else — so
  // it is indistinguishable from a deterministic row by inspection. But byte-exactness is not
  // RELEVANCE: the deterministic path also clears a lexical floor (token overlap at
  // EVIDENCE_THRESHOLD, a distinctive token, the conjunction and negation rules) and a proposed row
  // clears none of them by design, because it exists for the cases where no word is shared. Its only
  // relevance judge is the model, and its `reasoning` is stored, never verified.
  //
  // If this check counted it, `must_have_coverage` — whose own comment calls it accusation-grade —
  // would quietly move from "verbatim AND lexically supported" to "verbatim", and no surface would
  // say so. So a proposed row is evidence to SHOW, never evidence to PASS ON.
  const reqs = [{ seq: 0, verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'must_have' }]

  const withProposed = runChecks({
    type: 'resume', pkg: RESUME_FULL, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: proposedRow() } },
  })
  const c = find(withProposed, 'must_have_coverage')
  assert.notEqual(c.state, 'pass', 'a model-proposed excerpt must NOT turn the gate green on its own')
  assert.equal(c.state, 'fail')
  assert.match(c.observed, /model-proposed, awaiting your confirmation/,
    'the count must say a model was involved, or a coverage rise is unattributable')

  // The excerpt is SHOWN, not hidden. Leaving the owner a blank when a model found something real
  // would be the opposite failure — this is strictly better information than "nothing found".
  assert.match(c.offenders[0], /a model proposes "reduced outages from nine hours to one"/)
  assert.match(c.offenders[0], /confirm it/)

  // And the identical row with a DETERMINISTIC method does pass — so the difference is provenance
  // and nothing else. Without this half the case would also pass if coverage were broken outright.
  const withRule = runChecks({
    type: 'resume', pkg: RESUME_FULL, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: { ...proposedRow(), method: 'anchored', ratio: 1 } } },
  })
  assert.equal(find(withRule, 'must_have_coverage').state, 'pass',
    'the same excerpt from a RULE is coverage — only the provenance may change the verdict')
})

test('H:proposed-evidence-cannot-pass-ANY-evidence-check: all three, not just the one I remembered', () => {
  // FOUND BY AN INDEPENDENT VERIFIER, and the miss is the reason this case is separate from the one
  // above rather than folded into it. `must_have_coverage` was filtered; `responsibilities_addressed`
  // and `evidence_placed` were left on the unfiltered `evidenceOf`, 34 and 46 lines below the helper
  // written to prevent exactly that — this repo's own "fix all consumers, not just the one you
  // found" rule, broken inside a single else-branch.
  //
  // So the guard is written over the SET of evidence-reading checks rather than over one name. A
  // fourth check added later that counts a proposed row as settled fails here.
  const reqs = [
    { seq: 0, verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'must_have' },
    { seq: 1, verbatim: 'Own the reliability of the payments platform end to end', item_text: '', kind: 'responsibility' },
  ]
  const bySeq = { 0: proposedRow(), 1: proposedRow() }
  const rs = runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs, evidence: { profileReadable: true, bySeq } })

  for (const key of ['must_have_coverage', 'responsibilities_addressed', 'evidence_placed']) {
    const c = find(rs, key)
    assert.ok(c, `${key} is missing — the scan has gone stale`)
    assert.notEqual(c.state, 'pass',
      `${key} passed on model-proposed evidence alone — a model may propose, only a rule may accuse`)
  }

  // `evidence_placed` specifically must not ACCUSE either. Its question is "of what the profile
  // evidences, what reached this asset" — counting a proposed row would make it charge the document
  // with omitting something only a model ever claimed was relevant.
  assert.equal(find(rs, 'evidence_placed').state, 'not_applicable',
    'evidence_placed must have nothing to judge when the only evidence is proposed')

  // Same rows from a RULE: all three become judgeable again, so the difference is provenance alone.
  const ruleRows = { 0: { ...proposedRow(), method: 'anchored', ratio: 1 }, 1: { ...proposedRow(), method: 'anchored', ratio: 1 } }
  const rr = runChecks({ type: 'resume', pkg: RESUME_FULL, requirements: reqs, evidence: { profileReadable: true, bySeq: ruleRows } })
  assert.equal(find(rr, 'must_have_coverage').state, 'pass')
  assert.notEqual(find(rr, 'evidence_placed').state, 'not_applicable')
})

// A CONFIRMED PROPOSAL IS NOT "AWAITING YOUR CONFIRMATION".
//
// Found by an independent verifier against live production (2026-08-23). The shipped string read
// "2/12 must-haves evidenced (5 model-proposed, awaiting your confirmation, 1 answered from your
// profile facts, not counted either way)" — while only THREE proposals were actually pending. The
// other two were confirmed and were the numerator, so the sentence declared five rows uncounted
// while its own count of two consisted entirely of two of those five.
//
// The numerator was correct throughout (it reads `ruleEvidenceOf`). This guards the SURFACE: the
// exclusions are spelled out rather than absorbed precisely so a reviewer can audit the number, and
// a parenthetical that contradicts the count destroys that.
test('H:a-confirmed-proposal-is-not-reported-as-awaiting: the tail cannot contradict the numerator', () => {
  const req = (seq, text) => ({
    id: `r${seq}`, seq, kind: 'must_have', item_text: text, verbatim: text,
    char_start: 0, char_end: text.length, match_method: 'exact', kind_source: 'category_default',
  })
  const ev = (confirmed) => ({
    quote: 'an excerpt from the profile', source_kind: 'work_history', source_label: 'Career',
    source_key: 'work:career', char_start: 0, char_end: 27, extra: null, ratio: null,
    method: 'proposed', record_sha256: 'sha', resolver_version: 1, proposal_version: 1,
    confirmed_at: confirmed ? '2026-08-23T05:48:26.832Z' : null,
    confirmed_by: confirmed ? 'von.ellis@enterpriseds.io' : null,
  })
  const requirements = [req(1, 'first distinct requirement text here'), req(2, 'second distinct requirement text here'),
                        req(3, 'third distinct requirement text here')]
  const results = runChecks({
    type: 'resume', pkg: {}, company: 'Acme', requirements, swaps: [],
    postingText: '', profileText: '', facts: [],
    // One confirmed, two still pending.
    evidence: { profileReadable: true, bySeq: { 1: ev(true), 2: ev(false), 3: ev(false) } },
  })
  const cov = results.find(r => r.check_key === 'must_have_coverage')
  assert.ok(cov, 'must_have_coverage must be produced')
  const m = /(\d+) model-proposed, awaiting your confirmation/.exec(cov.observed)
  assert.ok(m, `expected an awaiting-confirmation clause, got: ${cov.observed}`)
  assert.equal(Number(m[1]), 2,
    `THE TAIL CONTRADICTS THE NUMERATOR. It reports ${m[1]} proposals "awaiting your confirmation ` +
    `... not counted either way", but one of them is confirmed and IS counted. Observed: ${cov.observed}`)
})

// ── H:fixed-slot-count — the owner's fixed-slot rule, and the three states it must never confuse ──
//
// The check decides a GATE and NAMES OFFENDERS, so it is accusation-grade: a false `fail` accuses a
// document that is correct, and a false `pass` lets a document that broke the template ship. It
// arrived with ZERO coverage - an independent verifier inverted all three of its states (unknown ->
// pass, the compact_resume branch deleted so the check goes absent, mismatch -> pass) and the suite
// stayed green on every one. These cases exist so that can never be true again.
//
// Owner, 2026-08-29: *"the 10 can't be increased to 12 or reduce to 8 etc so only swaps are allowed
// not adds or drops given the limited space in the resume template"*, and *"also relevant and
// expertise counts"*, and *"fixed slot counts change per template"*.

const SLOT_PKG = {
  SkillsBullets1: 'A\nB\nC',            // 3 items
  SkillsBullets2: 'D\nE',               // 2 items
  ExpertiseBullets: 'F\nG',             // 2 items
  RelevantBullets1: 'H', RelevantBullets2: 'I', RelevantBullets3: 'J',
}

test('H:fixed-slot-count-unknown-is-not-applicable: a count nobody set accuses nobody', () => {
  // ABSENT EVIDENCE IS not_applicable, NEVER pass AND NEVER fail. Both directions matter: `pass`
  // reports an unmeasured document as verified, `fail` accuses one on a number nobody supplied.
  const r = find(runChecks({ type: 'resume', pkg: SLOT_PKG }), 'fixed_slot_count')
  assert.ok(r, 'the check must be EMITTED even when it cannot decide - gateFor cannot see an absent check')
  assert.equal(r.state, 'not_applicable')
  assert.match(r.observed, /no per-template slot count is set/)

  // A slot count of 0 is the trap this guards: it would declare every item in the list illegal.
  // `0` must be treated as unset, exactly like null and like an absent key.
  const zero = find(runChecks({ type: 'resume', pkg: SLOT_PKG, slots: { SkillsBullets1: 0 } }), 'fixed_slot_count')
  assert.equal(zero.state, 'not_applicable', 'a slot count of 0 must never be read as "zero slots allowed"')
})

test('H:fixed-slot-count-fails-on-a-mismatch-and-names-the-offender', () => {
  const r = find(runChecks({ type: 'resume', pkg: SLOT_PKG, slots: { SkillsBullets1: 5, SkillsBullets2: 2 } }), 'fixed_slot_count')
  assert.equal(r.state, 'fail', 'a document that lost two slots must trip the gate, not warn')
  assert.equal(r.offenders.length, 1, 'only the list that actually broke is named')
  assert.match(r.offenders[0], /SkillsBullets1: template holds 5, document ships 3 \(2 dropped\)/)
  // The gate is the whole point of the fail: a finding nothing acts on is decoration. `gateFor`
  // returns the CheckState directly, and only a DETERMINISTIC fail reaches 'fail' - a reviewer fail
  // degrades to 'warn' - so this also pins the check's `engine` as deterministic.
  assert.equal(r.engine, 'deterministic')
  assert.equal(gateFor([r]), 'fail')
})

test('H:fixed-slot-count-passes-only-on-an-exact-match, and names what it could not measure', () => {
  const r = find(runChecks({ type: 'resume', pkg: SLOT_PKG, slots: { SkillsBullets1: 3, SkillsBullets2: 2 } }), 'fixed_slot_count')
  assert.equal(r.state, 'pass')
  assert.equal(r.offenders.length, 0)
  // A PARTIAL measurement must never read as a whole one: the four lists with no count are named in
  // the observed text, so a reader can tell "all lists correct" from "the two I could check".
  assert.match(r.observed, /not set: RelevantBullets1, RelevantBullets2, RelevantBullets3, ExpertiseBullets/)

  // An over-count is a violation in the other direction and must be worded as such.
  const over = find(runChecks({ type: 'resume', pkg: SLOT_PKG, slots: { SkillsBullets1: 2 } }), 'fixed_slot_count')
  assert.equal(over.state, 'fail')
  assert.match(over.offenders[0], /\(1 added\)/)
})

test('H:fixed-slot-count-is-emitted-for-compact-resume-as-not-applicable, never absent', () => {
  // `checks.ts:311-325` records what happens when a check silently stops being emitted: six of them
  // vanished from the compact resume and `gateFor` could not see any of them. So the compact resume
  // - which DELIBERATELY drops skills to fit a character budget - gets an explicit not_applicable
  // naming that reason, rather than being skipped.
  const rs = runChecks({ type: 'compact_resume', pkg: SLOT_PKG, slots: { SkillsBullets1: 3, SkillsBullets2: 2 } })
  const r = find(rs, 'fixed_slot_count')
  assert.ok(r, 'ABSENT from the results array is the failure this case exists for, not merely not_applicable')
  assert.equal(r.state, 'not_applicable')
  assert.match(r.observed, /fitCompactSkills/)
})

test('H:fixed-slot-count-covers-relevant-and-expertise, not just skills', () => {
  // Scope is the owner's, stated twice: *"also relevant and expertise counts"*. A check that quietly
  // covered only the two skills lists would satisfy every other case above and still be wrong.
  const r = find(runChecks({
    type: 'resume', pkg: SLOT_PKG,
    slots: { ExpertiseBullets: 4, RelevantBullets2: 3 },
  }), 'fixed_slot_count')
  assert.equal(r.state, 'fail')
  assert.equal(r.offenders.length, 2)
  assert.ok(r.offenders.some(o => /^ExpertiseBullets: template holds 4, document ships 2/.test(o)))
  assert.ok(r.offenders.some(o => /^RelevantBullets2: template holds 3, document ships 1/.test(o)))
})

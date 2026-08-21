// P2.1 — the deterministic checks engine. Thresholds are the ones the LIVE prompt states
// (api-test run 32311693658), not the backlog's, because the prompt is the system that produced
// every artifact in the database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, gateFor, attentionCount, DEFAULT_THRESHOLDS, AI_TELLS } from '../dist/functions/tests/checks.js'

const find = (rs, k) => rs.find(r => r.check_key === k)
const RESUME_FULL = {
  ResumeSummary: 'A leader who owns roadmap strategy and delivers measurable outcomes.',
  SkillsBullets1: Array.from({ length: 10 }, (_, i) => `Skill number ${i}`).join('\n'),
  SkillsBullets2: Array.from({ length: 10 }, (_, i) => `Other skill ${i}`).join('\n'),
  ExpertiseBullets: 'One two three four five\nSix seven eight nine ten',
  RelevantBullets1: 'Short one\nShort two',
  RelevantBullets2: 'Alpha\nBeta',
  RelevantBullets3: 'Gamma\nDelta',
}

test('the thresholds are the prompt values, not the backlog values', () => {
  assert.equal(DEFAULT_THRESHOLDS.skillMaxChars, 30, 'the backlog says 24; the live prompt says 30')
  assert.deepEqual([DEFAULT_THRESHOLDS.skillsTotalMin, DEFAULT_THRESHOLDS.skillsTotalMax], [20, 22])
  assert.equal(DEFAULT_THRESHOLDS.relevantOverLimitAllowance, 1, 'the prompt states an allowance, not a flat cap')
  assert.deepEqual(DEFAULT_THRESHOLDS.coverWords, [250, 400])
})

test('thresholds are overridable — nothing here is a permanent constant', () => {
  const pkg = { ...RESUME_FULL, SkillsBullets1: 'A twenty six character skill' }
  assert.equal(find(runChecks({ type: 'resume', pkg }), 'skill_char_limit').state, 'pass')
  const strict = runChecks({ type: 'resume', pkg, thresholds: { skillMaxChars: 24 } })
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
  const resume = runChecks({ type: 'resume', pkg: RESUME_FULL })
  assert.equal(find(resume, 'word_counts'), undefined, 'the resume template has no word-banded field')

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
const echoPkg = (summary) => ({ ...RESUME_FULL, ResumeSummary: summary })

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
  assert.ok(!rs.some(r => r.state === 'fail'), 'nothing else in this package should fail')
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

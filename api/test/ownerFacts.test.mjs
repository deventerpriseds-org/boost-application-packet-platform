// P6 — the candidate fact catalogue. The catalogue is ordered by MEASURED demand across 7,559 live
// requirement rows (years 511, degrees 466, work-auth 43, clearance 36, scope 24, mode 20,
// travel 14, location 14), not by guesswork.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FACT_CATALOGUE, FACT_BY_KEY, demandedNumber, checkAgainstFacts, proposeMissingFacts,
} from '../dist/functions/tests/ownerFacts.js'

const fact = (key, value, value_num = null, confirmed = true, source = 'owner_stated') =>
  ({ key, value, value_num, source, confirmed_at: confirmed ? '2026-08-20T00:00:00Z' : null })

test('the catalogue leads with the highest-measured-demand facts', () => {
  assert.equal(FACT_CATALOGUE[0].key, 'experience.years_total', 'years is 511 rows — the biggest single ask')
  assert.ok(FACT_CATALOGUE.some(f => f.key === 'education.highest_degree'))
  assert.equal(FACT_CATALOGUE.length, FACT_BY_KEY.size, 'keys are unique')
  for (const f of FACT_CATALOGUE) {
    assert.ok(f.label && f.help && f.category && f.asks instanceof RegExp, `${f.key} is incomplete`)
  }
})

test('demandedNumber reads the number a requirement states', () => {
  assert.equal(demandedNumber('Minimum of 10 years of product management experience'), 10)
  assert.equal(demandedNumber('15+ years of progressive leadership'), 15)
  assert.equal(demandedNumber('Deep experience with roadmaps'), null)
})

// ---- numeric facts settle numeric requirements ------------------------------------------------
test('a confirmed years fact settles a years requirement, both ways', () => {
  const facts = [fact('experience.years_total', '22 years', 22)]
  const yes = checkAgainstFacts('Minimum of 10 years of experience', facts)
  assert.equal(yes.verdict, 'satisfied')
  assert.match(yes.detail, /22 years recorded, 10 required/)

  const no = checkAgainstFacts('25+ years of experience required', facts)
  assert.equal(no.verdict, 'not_satisfied')
  assert.match(no.detail, /22 years recorded, 25 required/)
})

// ---- the honesty rules -------------------------------------------------------------------------
test('a MISSING fact is unknown, never satisfied', () => {
  const r = checkAgainstFacts('Minimum of 10 years of experience', [])
  assert.equal(r.verdict, 'unknown')
  assert.match(r.detail, /no value recorded/)
})

test('an UNCONFIRMED fact cannot settle a requirement', () => {
  const proposed = [fact('experience.years_total', '22 years', 22, false, 'proposed')]
  const r = checkAgainstFacts('Minimum of 10 years of experience', proposed)
  assert.equal(r.verdict, 'unknown', 'a guess about the owner must not settle a gate')
  assert.match(r.detail, /unconfirmed/)
})

test('a fact whose fit depends on the PERSON is surfaced, never inferred', () => {
  // The line is not "never infer" — geography is reference data and is settled below. It is: never
  // infer what depends on the person. Whether this clearance level counts, or how far someone will
  // commute, is theirs to answer.
  const r = checkAgainstFacts('Active TS/SCI clearance required',
    [fact('eligibility.security_clearance', 'Secret (inactive)')])
  assert.equal(r.verdict, 'unknown')
  assert.match(r.detail, /"Secret \(inactive\)" recorded/)
})

test('a requirement no fact covers returns null rather than a fabricated verdict', () => {
  assert.equal(checkAgainstFacts('Own the integrated product roadmap', [fact('experience.years_total', '22', 22)]), null)
})

// ---- growth ------------------------------------------------------------------------------------
test('facts a posting asked for but nothing answers are proposed — this is how the table grows', () => {
  const reqs = [
    'Minimum of 10 years of experience',
    'Active Secret security clearance required',
    'must be a U.S. Citizen',
    'Own the integrated product roadmap',
  ]
  const proposed = proposeMissingFacts(reqs, [fact('experience.years_total', '22 years', 22)])
  const keys = proposed.map(p => p.key)
  assert.ok(keys.includes('eligibility.security_clearance'))
  assert.ok(keys.includes('eligibility.work_authorization'))
  assert.ok(!keys.includes('experience.years_total'), 'an answered fact is not proposed again')
})

test('nothing is proposed when every asked-for fact is already answered', () => {
  const proposed = proposeMissingFacts(['Minimum of 10 years of experience'],
    [fact('experience.years_total', '22 years', 22)])
  assert.deepEqual(proposed, [])
})

test('the catalogue patterns match the real phrasings measured in the corpus', () => {
  const cases = [
    ['experience.years_total', '10+ years of product management experience'],
    ['education.highest_degree', "Bachelor's degree in Computer Science or equivalent"],
    ['eligibility.work_authorization', 'must be a U.S. Citizen or Green Card Holder'],
    ['eligibility.security_clearance', 'Active Secret clearance required'],
    ['identity.location', 'Reside in the East Coast of the United States'],
    ['preference.relocation', 'Willing to relocate to Austin'],
    ['preference.work_mode', 'Hybrid, 3 days a week in the office'],
    ['preference.travel_max', 'Willing to travel up to 25%'],
    ['scope.largest_team', 'Experience leading a team of 50 engineers'],
    ['scope.largest_budget', 'P&L responsibility for the business unit'],
  ]
  for (const [key, text] of cases) {
    assert.ok(FACT_BY_KEY.get(key).asks.test(text), `${key} did not match: ${text}`)
  }
})

// ---- derivation: read the facts off the source, don't ask for them ---------------------------
import { deriveFacts } from '../dist/functions/tests/ownerFacts.js'

const RESUME = `
VON ELLIS
Senior Technology Executive

EXPERIENCE
Vice President, Software Engineering | Acme Corp | 2018 - Present
  Led an org of 120 engineers across four product lines. Owned a $14M budget.
Director of Engineering | Globex | 2011 - 2018
  Managed 45 direct reports and delivered the platform re-architecture.
Senior Engineering Manager | Initech | 2003 - 2011

EDUCATION
Master of Science in Computer Science, State University
Bachelor of Science in Electrical Engineering, State University

CERTIFICATIONS
PMP, AWS Certified Solutions Architect, SAFe 5
`

test('years of experience derive from the earliest DATED role, not from any stray year', () => {
  const f = deriveFacts(RESUME, 2026).find(x => x.key === 'experience.years_total')
  assert.equal(f.value_num, 23, '2003 to 2026')
  assert.match(f.evidence, /2003/, 'the evidence names the role it came from')
})

test('the highest degree wins, and lesser ones are kept as evidence', () => {
  const f = deriveFacts(RESUME, 2026).find(x => x.key === 'education.highest_degree')
  assert.match(f.value, /^Master/, 'Master outranks Bachelor')
  assert.match(f.evidence, /Bachelor/, 'the others stay visible for confirmation')
})

test('certifications are collected', () => {
  const f = deriveFacts(RESUME, 2026).find(x => x.key === 'education.certifications')
  for (const c of ['PMP', 'AWS Certified', 'SAFe']) assert.match(f.value, new RegExp(c, 'i'))
})

test('the LARGEST team and budget win, not the first mentioned', () => {
  const facts = deriveFacts(RESUME, 2026)
  assert.equal(facts.find(x => x.key === 'scope.largest_team').value_num, 120, '120 beats 45')
  assert.equal(facts.find(x => x.key === 'scope.largest_budget').value, '$14M')
})

test('derivation is reproducible — the clock is injected, never read', () => {
  assert.deepEqual(deriveFacts(RESUME, 2026), deriveFacts(RESUME, 2026))
  assert.notEqual(
    deriveFacts(RESUME, 2026).find(x => x.key === 'experience.years_total').value_num,
    deriveFacts(RESUME, 2030).find(x => x.key === 'experience.years_total').value_num)
})

test('empty or fact-free text yields nothing rather than a guess', () => {
  assert.deepEqual(deriveFacts(''), [])
  assert.deepEqual(deriveFacts('   '), [])
  assert.deepEqual(deriveFacts('A paragraph about leadership philosophy with no dates or degrees.'), [])
})

test('an implausible span is rejected rather than recorded', () => {
  // A copyright line "1975 - 2026" must not become 51 years of experience.
  const f = deriveFacts('Founded 1899 - 1905. Senior Engineer | 2015 - Present', 2026)
    .find(x => x.key === 'experience.years_total')
  assert.ok(f === undefined || f.value_num < 60)
})

// The real template writes "AUG 2021 – Present" and "JAN 2015 – JUL 2021". Without an optional
// month before the END year, only the current role matched and a decades-long career derived as
// "5 years (since 2021)" — measured live on the production resume template.
test('a month before the END year does not break the range match', () => {
  const cv = `EXPERIENCE
    VP ENTERPRISE SOFTWARE STRATEGY  AUG 2021 - Present
    DIRECTOR OF ENGINEERING          JAN 2015 - JUL 2021
    SENIOR MANAGER                   Mar. 2008 - Dec 2014`
  const f = deriveFacts(cv, 2026).find(x => x.key === 'experience.years_total')
  assert.equal(f.value_num, 18, 'earliest dated role is 2008, not the current one')
  assert.match(f.evidence, /2008/)
})

// ---- geography is reference data, not a question for the owner --------------------------------
test('a state on the Atlantic seaboard SATISFIES an East Coast requirement outright', () => {
  const r = checkAgainstFacts('Reside in the East Coast of the United States',
    [fact('identity.location', 'Westminster, MD 21158 (Maryland)')])
  assert.equal(r.verdict, 'satisfied', 'Maryland is on the East Coast — that is lookup, not judgement')
  assert.match(r.detail, /Maryland \(MD\) is on the East Coast/)
})

test('a state that is NOT on the coast fails the same requirement, with the reason', () => {
  const r = checkAgainstFacts('Must reside on the East Coast',
    [fact('identity.location', 'Denver, Colorado')])
  assert.equal(r.verdict, 'not_satisfied')
  assert.match(r.detail, /not on the East Coast/)
})

test('a named state in the requirement is compared to the recorded state', () => {
  assert.equal(checkAgainstFacts('Must reside in Texas', [fact('identity.location', 'Austin, TX')]).verdict, 'satisfied')
  assert.equal(checkAgainstFacts('Must reside in Texas', [fact('identity.location', 'Westminster, MD')]).verdict, 'not_satisfied')
})

test('a commute radius still ASKS — that depends on the person, not on geography', () => {
  const r = checkAgainstFacts('Must live within 30 miles of our Baltimore office',
    [fact('identity.location', 'Westminster, MD 21158')])
  assert.equal(r.verdict, 'unknown', 'how far someone will commute is theirs to decide')
})

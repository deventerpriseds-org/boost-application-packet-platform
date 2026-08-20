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

test('a non-numeric fact is surfaced for a human, never inferred', () => {
  const r = checkAgainstFacts('Reside in the East Coast of the United States',
    [fact('identity.location', 'Boston, MA')])
  assert.equal(r.verdict, 'unknown', 'the system must not decide that Boston satisfies "East Coast"')
  assert.match(r.detail, /"Boston, MA" recorded/)
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

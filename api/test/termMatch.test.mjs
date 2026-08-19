// Run: cd api && npm test   (Node's built-in runner — no dependency added)
// These assert behaviour that was MEASURED as broken on the live corpus, so they are regression
// tests, not illustrations. See .claude/QC-EVIDENCE-PLAN.md prerequisites X3/X4.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { termNormalize, normalizeAliases, confidenceFor, matchesEntry } from '../dist/functions/tests/termMatch.js'
const same = (a, b) => assert.equal(termNormalize(a), termNormalize(b))
const diff = (a, b) => assert.notEqual(termNormalize(a), termNormalize(b))

test('&-terms normalize and keep the token "and"', () => {
  assert.equal(termNormalize('P&L'), 'p and l')
  assert.equal(termNormalize('R&D'), 'r and d')
  same('P&L', 'P and L'); same('P&amp;L', 'P&L'); diff('P&L', 'M&A')
})
test('alphanumeric identifiers split: SOC2 == SOC 2', () => { same('SOC 2', 'SOC2'); same('ISO 27001', 'ISO27001') })
test('K8s keeps medial digits', () => assert.equal(termNormalize('K8s'), 'k8s'))
test('unambiguous version markers fold', () => {
  same('SOC 2', 'SOC 2 Type II'); same('ISO 27001', 'ISO 27001:2022'); same('PCI DSS', 'PCI-DSS 4.0'); same('FedRAMP', 'FedRAMP High')
})
test('bare trailing integers are NOT folded — SOC must not collapse into SOC 2', () => {
  diff('SOC', 'SOC 2')
  diff('TOGAF', 'TOGAF 9')   // folded by explicit alias instead, where a human decided
  const togaf = { alias_normalized: normalizeAliases('TOGAF', ['TOGAF 9', 'TOGAF 10']), match_mode: 'exact_norm', display_term: 'TOGAF' }
  assert.ok(matchesEntry(togaf, 'TOGAF 9'))
})
test('near-miss terms stay distinct', () => {
  diff('ISO 27001', 'ISO 9001'); diff('PCI', 'PCI DSS'); diff('Generative AI', 'Large Language Model'); diff('Zero Trust', 'ZTNA')
})
test('separators collapse', () => { same('Go-to-Market', 'Go to Market'); same('CI/CD', 'CI-CD'); same('Zero-Trust', 'Zero Trust') })
test('trademark, possessive, dotted acronym', () => {
  assert.equal(termNormalize('Kubernetes®'), 'kubernetes')
  assert.equal(termNormalize("Kubernetes's"), 'kubernetes')
  assert.equal(termNormalize('S.O.C.'), 'soc')
})
test('confidence is corroboration arithmetic, not opinion', () => {
  assert.ok(confidenceFor(['onet','esco','jd_corpus'], 5) > confidenceFor(['jd_corpus'], 5))
  assert.equal(confidenceFor(['onet','onet','onet'], 0), confidenceFor(['onet'], 0))
  assert.ok(confidenceFor(['jd_corpus'], 200) > confidenceFor(['jd_corpus'], 1))
  assert.ok(confidenceFor(['a','b','c','d','e'], 100000) <= 1)
})
test('SAFe needs case-sensitive matching (302 live "safe" vs 8 "scaled agile")', () => {
  const safe = { alias_normalized: ['safe'], match_mode: 'case_sensitive_acronym', display_term: 'SAFe' }
  assert.ok(matchesEntry(safe, 'We run SAFe at scale'))
  assert.ok(!matchesEntry(safe, 'a safe environment'))
  assert.ok(!matchesEntry(safe, 'fail-safe systems'))
})
test('token_subset matches competency phrasing', () => {
  const board = { alias_normalized: ['board reporting'], match_mode: 'token_subset', display_term: 'Board Reporting' }
  assert.ok(matchesEntry(board, 'regular reporting to the Board of Directors'))
  assert.ok(!matchesEntry(board, 'quarterly reporting'))
})

// ── corpus miner ────────────────────────────────────────────────────────────────────────────────
import { ngramsForDoc } from '../dist/functions/tests/termMiner.js'

test('miner extracts real phrases and rejects stopword-edged ones', () => {
  const g = ngramsForDoc('Own the product roadmap and the operating model for the platform.')
  assert.ok(g.has('product roadmap'), 'keeps a real 2-gram')
  assert.ok(g.has('operating model'), 'keeps the highest-value exec 2-gram')
  assert.ok(!g.has('the product roadmap'), 'rejects leading stopword')
  assert.ok(!g.has('roadmap and'), 'rejects trailing stopword')
  assert.ok(!g.has('and the'), 'rejects all-noise')
})
test('miner does not span clause boundaries', () => {
  const g = ngramsForDoc('Owns budget. Reports to the board.')
  assert.ok(!g.has('budget reports'), 'a phrase must not straddle a sentence break')
})
test('miner counts documents, not occurrences', () => {
  const g = ngramsForDoc('roadmap roadmap roadmap')
  assert.equal([...g].filter((x) => x === 'roadmap').length, 1)
})
test('miner sees &-terms only because entities are decoded first', () => {
  const g = ngramsForDoc('Owned P&amp;L across the division')
  assert.ok(g.has('p and l'), 'P&L survives as a mineable term')
})

test('miner drops EEO/benefits boilerplate but keeps real terms that share tokens', () => {
  const g = ngramsForDoc('Equal opportunity employer. We consider applicants without regard to sexual orientation, gender identity, race color religion. Benefits include medical dental vision and paid time off.')
  assert.ok(!g.has('sexual orientation'), 'EEO phrase dropped')
  assert.ok(!g.has('gender identity'), 'EEO phrase dropped')
  assert.ok(!g.has('medical dental'), 'benefits phrase dropped')
  const real = ngramsForDoc('Own identity and access management and the product roadmap.')
  assert.ok(real.has('identity and access management'), 'a real term sharing the token "identity" survives')
  assert.ok(real.has('product roadmap'), 'real term survives')
})

test('EEO variants created by keeping the token "and" are also blocked', () => {
  // termNormalize keeps `and` so P&L survives; the blocklist must cover the resulting surface forms.
  const g = ngramsForDoc('without regard to race, color, religion, sex, sexual orientation, gender identity. Benefits: medical, dental and vision.')
  for (const bad of ['regard to race', 'orientation gender', 'sex sexual', 'dental and vision']) {
    assert.ok(!g.has(bad), `blocked: ${bad}`)
  }
  assert.ok(ngramsForDoc('Owned P&amp;L').has('p and l'), 'P&L still survives — the reason `and` is kept')
})

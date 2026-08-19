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

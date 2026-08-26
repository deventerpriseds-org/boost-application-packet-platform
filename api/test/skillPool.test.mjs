// Unit tests for api/src/functions/tests/skillPool.ts — turning the owner's stored skills prose
// into a discrete pool. Node's built-in runner, no DOM, no new dependency.
//   cd api && npm test
//
// EVERY assertion here is about the SAME constraint: no fake data. This module may only SPLIT and
// NORMALISE text the owner already wrote. The failure it must never have is a pool containing a
// term the owner did not write — either invented outright, or manufactured by splitting one of
// their skills into fragments that each look like a skill and are not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSkillPool, splitSkillField, isRejected, skillKey } from '../dist/functions/tests/skillPool.js'

test('H:skill-pool-never-splits-one-skill-into-fragments', () => {
  // THE RISKY CASE, and the reason `looksLikeList` is structural rather than clever. An executive
  // profile is full of multi-word skills containing commas. Splitting one produces fragments that
  // each READ like a skill — "Mergers", "Acquisitions" — which is fabrication wearing a plausible
  // shape, and the hardest kind to notice in a dropdown.
  assert.deepEqual(splitSkillField('Mergers, Acquisitions and Divestitures'),
    ['Mergers, Acquisitions and Divestitures'])
  assert.deepEqual(splitSkillField('Governance, Risk and Compliance'),
    ['Governance, Risk and Compliance'])
  // Two parts is not a list, however short.
  assert.deepEqual(splitSkillField('Hiring, onboarding'), ['Hiring, onboarding'])
})

test('H:skill-pool-does-split-a-real-list', () => {
  // The converse, so the guard above cannot be satisfied by never splitting at all — which would
  // "pass" while making the pool useless.
  assert.deepEqual(splitSkillField('Kubernetes, Terraform, CI/CD'), ['Kubernetes', 'Terraform', 'CI/CD'])
  // The pipe run is the format THIS APP already writes for an ATS skills line, so it must split.
  assert.deepEqual(splitSkillField('SOC 2 | ISO 27001 | FedRAMP'), ['SOC 2', 'ISO 27001', 'FedRAMP'])
  assert.deepEqual(splitSkillField('Platform scale;Org design'), ['Platform scale', 'Org design'])
})

test('H:skill-pool-strips-formatting-not-wording', () => {
  // Bullets, numbering and dashes are the owner's FORMATTING. The words are theirs and are not
  // touched — no title-casing, no expansion, no rewording.
  assert.deepEqual(splitSkillField('• Platform modernization\n2) Org design\n- P&L ownership'),
    ['Platform modernization', 'Org design', 'P&L ownership'])
  assert.deepEqual(splitSkillField('  M&A   due   diligence  '), ['M&A due diligence'])
})

test('H:skill-pool-rejects-only-by-SHAPE-never-by-vocabulary', () => {
  // The owner's standing correction: "the original skills lists i built are based on fact so they
  // can be referenced." So nothing here may judge WHICH words are skills. Only shapes that cannot
  // be a term at all are dropped: empty, letterless, or a sentence.
  assert.equal(isRejected('').rejected, true)
  assert.equal(isRejected('---').rejected, true)
  assert.equal(isRejected('2024').rejected, true)
  // A long, real executive skill SURVIVES. This is the cry-wolf direction and it matters more.
  assert.equal(isRejected('Enterprise architecture across multi-business-unit portfolios').rejected, false)
  assert.equal(isRejected('Coaching').rejected, false)
  assert.equal(isRejected('P&L').rejected, false)
  // A sentence is not a term.
  const long = isRejected('I led the modernization of our core safety platform across three separate business units this year')
  assert.equal(long.rejected, true)
  assert.match(long.why, /too long/)
  // Every rejection states WHY. A silent drop is how a pool quietly loses the owner's data.
  for (const t of ['', '---', '2024']) assert.ok(isRejected(t).why, `rejection of ${JSON.stringify(t)} carries no reason`)
})

test('H:skill-pool-dedupes-across-sources-and-keeps-both-origins', () => {
  const p = buildSkillPool({ skills1: 'SOC 2\nKubernetes', softHardSkillsPool: 'SOC-2\nCoaching' })
  assert.equal(p.entries.length, 3, 'SOC 2 and SOC-2 must be ONE entry')
  const soc = p.entries.find(e => e.key === skillKey('SOC 2'))
  assert.deepEqual(soc.origins, ['skills1', 'softHardSkillsPool'], 'both sources must be recorded')
  assert.equal(soc.term, 'SOC 2', 'the FIRST spelling wins - the owner wrote it that way in the primary field')
  assert.equal(p.duplicates, 1)
})

test('H:skill-pool-reports-its-composition-and-its-losses', () => {
  // The owner asked to SEE the pool. That means per-source counts and the dropped terms WITH
  // reasons, not just a final list — otherwise a source contributing nothing looks identical to a
  // source that was never read.
  const p = buildSkillPool({ skills1: 'Kubernetes\n2024', skills2: '', expertise: 'Org design' })
  assert.equal(p.bySource.skills1, 1)
  assert.equal(p.bySource.skills2, 0, 'an empty source must report 0, not be absent')
  assert.equal(p.bySource.expertise, 1)
  assert.equal(p.rejected.length, 1)
  assert.equal(p.rejected[0].term, '2024')
  assert.equal(p.rejected[0].origin, 'skills1', 'a dropped term must name the source it came from')
})

test('H:skill-pool-invents-nothing-from-nothing', () => {
  // Absent evidence is not a default list. Empty in, empty out — never a seeded fallback, which is
  // the `DEFAULT_LIBRARY` anti-pattern this repo already carries a scar from.
  for (const empty of [null, undefined, '', '   ', '\n\n']) {
    assert.deepEqual(splitSkillField(empty), [], `${JSON.stringify(empty)} produced terms out of nothing`)
  }
  const p = buildSkillPool({ skills1: null, skills2: '', softHardSkillsPool: '   ' })
  assert.equal(p.entries.length, 0, 'an empty pool must stay empty rather than fall back to a default list')
})

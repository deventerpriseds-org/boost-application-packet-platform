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

// ── the SECOND LEVEL: `Category: term, term | Category: ...` ─────────────────────────────────────
// All ~36 of relevantProficiencies' terms were being refused before this - each group arrived as one
// 15-27 word string and isRejected called it prose. Correctly: the alternative was storing
// "Governance and Compliance: Standards and Compliance, AI/ML Strategy, ..." as ONE skill.

test('H:skill-pool-two-level-split-is-declared-never-sniffed', () => {
  // THE TRAP THIS EXISTS FOR, and it passes every test written against today's data. Reusing
  // `looksLikeList` for the second level yields the right answer NOW only because every group's
  // longest part is <= 4 words, and one group sits EXACTLY on that boundary ("Corporate AI Use
  // Cases" = 4). A 5-word proficiency added later flips looksLikeList to false, the group collapses
  // to one chunk, isRejected refuses it at > 12 words, and the WHOLE CATEGORY VANISHES silently.
  //
  // So: a category containing a deliberately LONG term must still split into its parts.
  const long = 'Ops: Alpha, Beta, A Deliberately Long Five Word Term, Gamma'
  const pool = buildSkillPool({ relevantProficiencies: long })
  const terms = pool.entries.map(e => e.term)
  assert.deepEqual(terms, ['Alpha', 'Beta', 'A Deliberately Long Five Word Term', 'Gamma'],
    'the second-level split collapsed on a long term - it is sniffing, not declared: ' + JSON.stringify(terms))
  assert.equal(pool.rejected.length, 0)
  assert.ok(pool.entries.every(e => e.category === 'Ops'), JSON.stringify(pool.entries))
})

test('H:skill-pool-category-never-becomes-a-skill', () => {
  // A trailing-colon group must yield NOTHING. Falling through pushes the CATEGORY NAME into the
  // bank as a skill - measured on the pre-change parser, which returned ['Governance and Compliance']
  // for exactly this input. A category is a label for the owner's skills, never one of them.
  const pool = buildSkillPool({ relevantProficiencies: 'Governance and Compliance:' })
  assert.equal(pool.entries.length, 0, JSON.stringify(pool.entries.map(e => e.term)))
  assert.ok(!pool.entries.some(e => e.term === 'Governance and Compliance'))
})

test('H:skill-pool-strips-the-category-before-splitting-not-after', () => {
  // Splitting first emits "Ops: Alpha" - a string the owner never wrote. That is fabrication, not
  // parsing, and it is the shape the current parser already produces for a two-level field.
  const pool = buildSkillPool({ relevantProficiencies: 'Ops: Alpha, Beta, Gamma' })
  assert.ok(!pool.entries.some(e => e.term.includes(':')),
    'a term still carries its category prefix: ' + JSON.stringify(pool.entries.map(e => e.term)))
})

test('H:skill-pool-uses-the-FIRST-colon-only', () => {
  // `split(':')[1]` keeps one fragment and discards the rest of the line - measured to destroy two
  // of three terms when a term itself contains a colon.
  const pool = buildSkillPool({ relevantProficiencies: 'Ops: Alpha, SOC 2: Type II, Gamma' })
  const terms = pool.entries.map(e => e.term)
  assert.deepEqual(terms, ['Alpha', 'SOC 2: Type II', 'Gamma'], JSON.stringify(terms))
})

test('H:skill-pool-second-level-does-not-disable-the-shape-guard', () => {
  // Exempting categorised terms from isRejected would turn the category prefix into a laundering
  // bypass: any prose gets in by prefixing it with "X:". The guard must still fire on the REMAINDER.
  const prose = 'Ops: ' + Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')
  const pool = buildSkillPool({ relevantProficiencies: prose })
  assert.equal(pool.entries.length, 0, JSON.stringify(pool.entries.map(e => e.term)))
  assert.equal(pool.rejected.length, 1)
  assert.match(pool.rejected[0].why, /too long to be a term/)
})

test('H:skill-pool-group-without-a-category-is-parsed-not-dropped', () => {
  // A malformed group (no colon) is still the owner's data. It falls back to single-level parsing
  // rather than being discarded - a silent drop is the loss this module exists to prevent.
  const pool = buildSkillPool({ relevantProficiencies: 'Ops: Alpha, Beta | Gamma, Delta, Epsilon' })
  const terms = pool.entries.map(e => e.term)
  assert.ok(terms.includes('Gamma') && terms.includes('Delta') && terms.includes('Epsilon'), JSON.stringify(terms))
  assert.equal(pool.entries.find(e => e.term === 'Gamma').category, null)
  assert.equal(pool.entries.find(e => e.term === 'Alpha').category, 'Ops')
})

test('H:skill-pool-category-survives-to-a-reader', () => {
  // The repo's most-repeated defect is a field shipping WRITE-ONLY: written by the producer, dropped
  // before any consumer. The category is only worth carrying if it can be read back per entry, so
  // this asserts the read, not the write.
  const pool = buildSkillPool({ relevantProficiencies: 'Ops: Alpha, Beta | Risk: Gamma' })
  const byCategory = {}
  for (const e of pool.entries) (byCategory[e.category ?? '_'] ||= []).push(e.term)
  assert.deepEqual(byCategory, { Ops: ['Alpha', 'Beta'], Risk: ['Gamma'] }, JSON.stringify(byCategory))
})

// ── REWORDING: the one place this module changes the owner's words ───────────────────────────────

test('H:skill-pool-rewords-only-from-the-injected-map-never-from-code', () => {
  // The parser must never rewrite the owner's wording on its own initiative. With NO map, every term
  // is verbatim - including the long expertise statements, which stay exactly as written.
  const src = { expertise: 'Optimizing scaled agile operations|Governance frameworks for compliance' }
  const pool = buildSkillPool(src)
  assert.deepEqual(pool.entries.map(e => e.term),
    ['Optimizing scaled agile operations', 'Governance frameworks for compliance'])
  assert.equal(pool.reworded.length, 0, 'a reword happened with no map supplied: ' + JSON.stringify(pool.reworded))
})

test('H:skill-pool-reword-is-reported-so-it-can-be-audited', () => {
  // A reword changes the owner's own words. Doing it silently is indistinguishable from the parser
  // inventing text, so every application is reported from -> to.
  const pool = buildSkillPool({ expertise: 'Optimizing scaled agile operations' },
    { rewords: { 'Optimizing scaled agile operations': 'Scaled Agile Operations' } })
  assert.deepEqual(pool.entries.map(e => e.term), ['Scaled Agile Operations'])
  assert.deepEqual(pool.reworded, [{ from: 'Optimizing scaled agile operations', to: 'Scaled Agile Operations', origin: 'expertise' }])
})

test('H:skill-pool-one-reword-may-yield-several-terms', () => {
  // "Budget Development and P&L Management" is genuinely TWO of the owner's skills. A 1:1 map
  // silently dropped "P&L Management" - a term of the owner's lost to the map's shape, which is the
  // same data loss the rest of this module refuses.
  const pool = buildSkillPool({ expertise: 'Budget Development and P&L Management' },
    { rewords: { 'Budget Development and P&L Management': 'Budget Development | P&L Management' } })
  assert.deepEqual(pool.entries.map(e => e.term), ['Budget Development', 'P&L Management'])
  assert.equal(pool.bySource.expertise, 2)
})

test('H:skill-pool-reword-map-is-matched-case-insensitively', () => {
  const pool = buildSkillPool({ expertise: 'KPI-driven performance management' },
    { rewords: { 'kpi driven performance management': 'KPI-Driven Performance' } })
  assert.deepEqual(pool.entries.map(e => e.term), ['KPI-Driven Performance'])
})

test('H:skill-pool-a-stale-reword-is-surfaced-not-silent', () => {
  // The map drifts the moment the owner edits the source field: the map still says "rewrite X" while
  // X is gone, and whatever they typed instead sails through unreworded. The pool still builds and
  // the counts still look plausible, so this failure is invisible unless it is reported.
  const pool = buildSkillPool({ expertise: 'Something Else Entirely' },
    { rewords: { 'A Term That No Longer Exists': 'Whatever' } })
  assert.deepEqual(pool.staleRewords, ['A Term That No Longer Exists'])
  const clean = buildSkillPool({ expertise: 'Something Else Entirely' },
    { rewords: { 'Something Else Entirely': 'Something Else' } })
  assert.deepEqual(clean.staleRewords, [], 'a reword that DID apply was reported stale')
})

test('H:skill-pool-reword-runs-before-the-shape-guard', () => {
  // The reason a term is reworded is that the owner's phrasing is a statement rather than a term.
  // Rejecting first would refuse it for the exact property the reword exists to fix, so the reword
  // must win - a 20-word statement mapped to a 2-word skill lands in the bank.
  const long = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')
  const pool = buildSkillPool({ expertise: long }, { rewords: { [long]: 'Short Skill' } })
  assert.deepEqual(pool.entries.map(e => e.term), ['Short Skill'])
  assert.equal(pool.rejected.length, 0)
})

test('H:skill-pool-dedup-stays-EXACT-so-near-misses-remain-separate', () => {
  // schema.ts:745-748 - a bank feeds a SELECT the owner picks from and a swap that MOVES A GATE, so
  // collapsing two of the owner's distinct skills is accusation-grade and unrecoverable once seeded.
  // These three pairs are live in the owner's real data and must survive as six entries.
  const pool = buildSkillPool({
    skills1: 'Data Strategy|KPI-Driven Execution|Scaled Agile Engineering',
    expertise: 'Enterprise Data Strategy|KPI-Driven Performance|Scaled Agile Operations',
  })
  assert.equal(pool.entries.length, 6, JSON.stringify(pool.entries.map(e => e.term)))
  assert.equal(pool.duplicates, 0)
})

test('H:skill-pool-numbering-strip-still-never-eats-a-leading-digit', () => {
  // Regression on the defect a test caught in the first draft: stripping any leading digit turned
  // "3D modelling" into "D modelling". Re-asserted HERE because the two-level path is a new route to
  // `tidy` and a category's terms go through it too.
  const pool = buildSkillPool({ relevantProficiencies: 'Ops: 3D modelling, 5G architecture, 2) Org design' })
  assert.deepEqual(pool.entries.map(e => e.term), ['3D modelling', '5G architecture', 'Org design'])
})

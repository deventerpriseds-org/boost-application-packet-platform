// Which pass wrote the skill that shipped — and the analysis sections none of them could place.
//
// WHY THIS EXISTS. The three generation calls live in one function's local scope and are discarded,
// so the only thing surviving a build was the MERGED result. That made the most consequential
// question about the pipeline unanswerable after the fact: is the refinement pass reaching the
// document, or is the QC pass overwriting it? It was asked directly and could not be answered from
// any stored row — which is the definition of a diagnosis that does not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  skillLineage, collectAnalysis, ANALYSIS_SECTION_MAX, ANALYSIS_TOTAL_MAX,
} from '../dist/functions/tests/packetBuild.js'

const src = (f) => readFileSync(new URL(`../src/functions/tests/${f}`, import.meta.url), 'utf8')

test('H:lineage-names-the-pass-that-actually-shipped', () => {
  // Derived from the VALUES, never asserted beside them, so the label cannot disagree with the lists
  // it describes. Each slot is compared against what is in the package — what happened, not what the
  // precedence rule says should have happened.
  const c1 = { skills1: 'draft one', skills2: 'draft two', relevant1: 'r1', relevant2: 'r2', relevant3: 'r3' }
  const c2 = { skills1: 'refined one', relevant1: 'refined r1' }
  const c3 = { finalSkills2: 'qc two' }
  const pkg = {
    SkillsBullets1: 'refined one', SkillsBullets2: 'qc two',
    RelevantBullets1: 'refined r1', RelevantBullets2: 'r2', RelevantBullets3: '',
  }
  const rows = skillLineage(c1, c2, c3, pkg)
  const by = Object.fromEntries(rows.map((r) => [r.slot, r]))
  assert.equal(by.SkillsBullets1.winner, 'call2', 'the refinement shipped and was not credited')
  assert.equal(by.SkillsBullets2.winner, 'call3')
  assert.equal(by.RelevantBullets1.winner, 'call2')
  assert.equal(by.RelevantBullets2.winner, 'call1')
  assert.equal(by.RelevantBullets3.winner, 'none', 'an empty slot must not be credited to a pass')
  // Every pass's own text is kept, so a reader can see what was rejected, not only what won.
  assert.equal(by.SkillsBullets1.call1, 'draft one')
  assert.equal(by.SkillsBullets1.call2, 'refined one')
  assert.equal(rows.length, 5)
})

test('H:lineage-compares-content-not-formatting', () => {
  // MEASURED, and the first version got it wrong. The shipped SkillsBullets1 was Call 2's list item
  // for item — "Engineering Leadership / Digital Transformation / Software Quality Assurance / ..." —
  // and the raw string comparison still returned `none` for all five slots, because a correction pass
  // runs after assembly and strips the "- " bullet prefix. A lineage that says "none" on every row of
  // a healthy build is worse than none at all: it is a panel that always says the same wrong thing.
  const asBullets = '- Engineering Leadership\n- Digital Transformation\n- Cloud Strategy'
  const asPlain = 'Engineering Leadership\nDigital Transformation\nCloud Strategy'
  const rows = skillLineage({ skills1: 'other' }, { skills1: asBullets }, {}, { SkillsBullets1: asPlain })
  assert.equal(rows[0].winner, 'call2', 'a bullet prefix was read as a different list')

  // It must still be a CONTENT comparison, not a fuzzy one: a different list is a different list.
  const different = skillLineage({ skills1: 'other' }, { skills1: asBullets }, {},
    { SkillsBullets1: asPlain + '\nAgile Methodologies' })
  assert.equal(different[0].winner, 'none', 'an extra item was treated as the same list')
})

test('H:analysis-records-the-full-length-even-when-truncated', () => {
  // A record that shrinks the number along with the text is how "7,446 characters discarded" becomes
  // un-measurable a week later. `chars` is the FULL length; `truncated` says the body was cut.
  const big = 'x'.repeat(ANALYSIS_SECTION_MAX + 500)
  const sections = collectAnalysis({ _unmapped: [{ title: 'Missing ATS Swap Suggestions', body: big }] }, null)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].chars, big.length, 'the recorded length was shrunk to the kept length')
  assert.equal(sections[0].body.length, ANALYSIS_SECTION_MAX)
  assert.equal(sections[0].truncated, true)
  assert.equal(sections[0].call, 1)
})

test('H:analysis-has-both-producers-and-a-total-cap', () => {
  // Call 2 now produces unmapped sections too, so the store has TWO producers. And builds are
  // frequent: an uncapped diagnostic column is a table that grows without anyone deciding it should.
  const both = collectAnalysis(
    { _unmapped: [{ title: 'Jobscan Extraction', body: 'a'.repeat(100) }] },
    { _unmapped: [{ title: 'Word and Character Requirements Check', body: 'Removed' }] })
  assert.deepEqual(both.map((s) => s.call), [1, 2], 'a producer is missing from the capture')

  const many = Array.from({ length: 40 }, (_, i) => ({ title: `s${i}`, body: 'y'.repeat(2000) }))
  const capped = collectAnalysis({ _unmapped: many }, null)
  const total = capped.reduce((n, s) => n + s.body.length, 0)
  assert.ok(total <= ANALYSIS_TOTAL_MAX, `capture grew to ${total}, past the ${ANALYSIS_TOTAL_MAX} cap`)
  assert.ok(capped.length < many.length, 'nothing was dropped, so the cap did not apply')

  // Empty bodies are not records. A heading with no content is not a discarded section.
  assert.deepEqual(collectAnalysis({ _unmapped: [{ title: 'x', body: '   ' }] }, null), [])
})

test('H:lineage-is-diagnostic-only: it must never reach an accusation-grade table', () => {
  // THE RULE THIS ENCODES. This is model prose. `requirement_evidence` feeds coverage,
  // `check_result` and `artifact_score` feed the gate and the score, and `swap_decision` names what
  // was swapped and why. Model output reaching any of them turns a diagnosis into a claim about the
  // candidate — which is the failure the whole evidence layer exists to prevent. `last_build` is
  // diagnostic: nothing scores off it and no gate reads it.
  const code = src('appPackets.ts')
  const persist = code.slice(code.indexOf('update packet set last_build'), code.indexOf('last_build persist failed'))
  assert.match(persist, /lineage:/, 'the lineage is not persisted')
  assert.match(persist, /analysis:/, 'the analysis is not persisted')

  // The capture may be written to `last_build` and nowhere else.
  const FORBIDDEN = ['requirement_evidence', 'check_result', 'artifact_score', 'swap_decision']
  for (const [name, fn] of [['skillLineage', 'skillLineage'], ['collectAnalysis', 'collectAnalysis']]) {
    for (const call of code.split('\n').filter((l) => l.includes(`${fn}(`))) {
      for (const table of FORBIDDEN) {
        assert.ok(!call.includes(table), `${name} output is being written toward ${table}`)
      }
    }
  }
  const pb = src('packetBuild.ts')
  for (const table of FORBIDDEN) {
    assert.ok(!pb.includes(`insert into ${table}`) && !pb.includes(`update ${table}`),
      `packetBuild writes ${table} — the capture module must not touch a scoring table`)
  }
})

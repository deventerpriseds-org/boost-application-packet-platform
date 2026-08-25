// P1.4 — insertion rows. Field names come from TEMPLATE_META, the same table varsForType injects
// from, so a row can never name a slot the document does not have.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFieldsFor, buildInsertions, LIST_FIELD_TO_LIST } from '../dist/functions/tests/insertions.js'
import { TEMPLATE_META } from '../dist/functions/tests/packetTemplates.js'
import { readFileSync } from 'node:fs'

const REQS = [
  { seq: 0, verbatim: 'You will own the integrated product roadmap for corporate hiring technology', item_text: 'x', kind: 'responsibility' },
  { seq: 1, verbatim: 'Minimum of 10 years of product management experience', item_text: 'y', kind: 'must_have' },
]

test('merge fields come from the template table, never from a second hardcoded list', () => {
  for (const type of Object.keys(TEMPLATE_META)) {
    assert.deepEqual(mergeFieldsFor(type), TEMPLATE_META[type].placeholders)
  }
  assert.deepEqual(mergeFieldsFor('video'), [], 'a type with no template has no merge fields')
  assert.deepEqual(mergeFieldsFor('nonsense'), [])
})

test('the real field counts are 7/2/7/3 — and the compact resume is no longer a copy of the resume', () => {
  assert.equal(mergeFieldsFor('resume').length, 7)
  assert.equal(mergeFieldsFor('portfolio').length, 7)
  assert.equal(mergeFieldsFor('cover').length, 3)

  // RESOLVED 2026-08-24. This case previously asserted `compact_resume.length === 7` and
  // `deepEqual(compact, resume)`, with the comment "a byte-identical duplicate of resume —
  // recorded, not silently reconciled". That was the right call at the time: the duplication was
  // real and nobody had measured the actual compact document, so recording it beat guessing.
  //
  // It has now been measured. `diag/doc-structure?type=compact_resume` against the owner's
  // "ATS Polished Engineering Compact Resume Template" (api-test run 32784628025) found
  // {{ResumeSummary}} and {{SkillsBullets}} and nothing else — Expertise is static prose there and
  // there are no Relevant lists at all. So the duplicate set was not merely redundant, it was
  // WRONG for the document it names.
  //
  // The assertion now holds the reconciled fact AND the reason the old one existed, so a future
  // reader does not "restore" the copy.
  assert.deepEqual(mergeFieldsFor('compact_resume'), ['ResumeSummary', 'SkillsBullets'],
    'the compact resume has its own two-placeholder set, measured from the real document')
  assert.notDeepEqual(mergeFieldsFor('compact_resume'), mergeFieldsFor('resume'),
    'compact_resume must never go back to being a copy of resume')

  // The singular name is the whole point: {{SkillsBullets}} is ONE block built from the resume's
  // two lists. A stray {{SkillsBullets1}} here would inject a token the compact doc does not have.
  assert.ok(!mergeFieldsFor('compact_resume').some((f) => /^SkillsBullets[0-9]$/.test(f)),
    'the compact resume takes the combined line, never the numbered lists')
})

test('every merge field produces a row and each names its own field', () => {
  const r = buildInsertions({ type: 'resume', pkg: { ResumeSummary: 'A summary.' } })
  assert.equal(r.rows.length, 7)
  assert.deepEqual(r.rows.map(x => x.merge_field), TEMPLATE_META.resume.placeholders)
  assert.ok(r.rows.every(x => typeof x.merge_field === 'string' && x.merge_field.length > 0))
})

test('an unfilled slot is recorded as NOT generated, never omitted', () => {
  const r = buildInsertions({ type: 'cover', pkg: { '@Company': 'Acme' } })
  assert.equal(r.filled, 1)
  assert.equal(r.unfilled, 2)
  const blank = r.rows.filter(x => !x.generated)
  assert.ok(blank.every(x => x.after_text === null && x.item_count === 0),
    'a block with no merge field behind it must never claim to be generated')
  assert.equal(r.rows.length, 3, 'the row is still there — the UI shows what the pipeline cannot reach')
})

test('empty string counts as unfilled, not as generated empty content', () => {
  const r = buildInsertions({ type: 'cover', pkg: { '@Company': '', '@CoverLetterBody': null } })
  assert.equal(r.filled, 0)
  assert.equal(r.unfilled, 3)
})

test('method is DERIVED: first fill vs a rewrite of a previous loop', () => {
  const first = buildInsertions({ type: 'cover', pkg: { '@CoverLetterBody': 'v1' } })
  assert.equal(first.rows.find(x => x.merge_field === '@CoverLetterBody').method, 'template_fill')

  const second = buildInsertions({
    type: 'cover', pkg: { '@CoverLetterBody': 'v2' }, prevPkg: { '@CoverLetterBody': 'v1' }, loop: 1,
  })
  const row = second.rows.find(x => x.merge_field === '@CoverLetterBody')
  assert.equal(row.method, 'model_rewrite')
  assert.equal(row.before_text, 'v1')
  assert.equal(row.after_text, 'v2')
  assert.equal(row.loop, 1)
})

test('unchanged text across a loop is not reported as a rewrite', () => {
  const r = buildInsertions({ type: 'cover', pkg: { '@CoverLetterBody': 'same' }, prevPkg: { '@CoverLetterBody': 'same' }, loop: 2 })
  assert.equal(r.rows.find(x => x.merge_field === '@CoverLetterBody').method, 'template_fill')
})

test('manual is never inferred — a model change must not be laundered as human judgement', () => {
  const r = buildInsertions({
    type: 'resume', pkg: { ResumeSummary: 'b' }, prevPkg: { ResumeSummary: 'a' }, loop: 1,
  })
  assert.ok(r.rows.every(x => x.method !== 'manual'))
})

test('list-backed fields name their list, and prose fields do not', () => {
  const r = buildInsertions({ type: 'resume', pkg: { SkillsBullets1: 'A\nB\nC', ResumeSummary: 'prose' } })
  assert.equal(r.rows.find(x => x.merge_field === 'SkillsBullets1').list, 'skills_1')
  assert.equal(r.rows.find(x => x.merge_field === 'ResumeSummary').list, null)
  assert.equal(r.rows.find(x => x.merge_field === 'SkillsBullets1').item_count, 3,
    'the count comes from the text, so a UI block cannot invent one')
  assert.deepEqual(Object.keys(LIST_FIELD_TO_LIST).sort(),
    ['RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3', 'SkillsBullets1', 'SkillsBullets2'])
})

test('attribution cites the employer words, or nothing', () => {
  const r = buildInsertions({
    type: 'resume',
    pkg: { ResumeSummary: 'Owned the integrated product roadmap for corporate hiring technology',
           ExpertiseBullets: 'Clinical trial submissions to the FDA' },
    requirements: REQS,
  })
  const cited = r.rows.find(x => x.merge_field === 'ResumeSummary')
  assert.equal(cited.verbatim_quote, REQS[0].verbatim)
  assert.equal(cited.requirement_seq, 0)
  const uncited = r.rows.find(x => x.merge_field === 'ExpertiseBullets')
  assert.equal(uncited.verbatim_quote, null)
  assert.equal(uncited.requirement_seq, null)
  assert.equal(r.attributed, 1)
})

test('an unfilled slot is never attributed to a requirement', () => {
  const r = buildInsertions({ type: 'resume', pkg: {}, requirements: REQS })
  assert.ok(r.rows.every(x => x.verbatim_quote === null && x.requirement_seq === null && x.confidence === 0))
})

test('buildInsertions is deterministic and makes no model call', () => {
  const input = { type: 'portfolio', pkg: { '@Company': 'Acme', '@AboutMe1_50words': 'about' }, requirements: REQS }
  assert.deepEqual(buildInsertions(input), buildInsertions(input))
})

// ── The loop-0 baseline: what "Show original" shows, and what makes `method` mean anything ───────
//
// Until 2026-08-24 `writeInsertions` set `prevPkg = {}` at loop 0, so on the baseline package --
// the draft everyone actually looks at -- every row had `before_text = null`. Two defects, one
// cause: `Show original` had nothing to show (and the app hid the control, which the owner called
// "black box and not clear"), and `changed` could never be true, so EVERY generated field was
// recorded `template_fill` and rendered "From profile" even when the model rewrote it wholesale.
//
// The baseline is the owner's MasterContext block for the slot. Owner: "the show original is always
// referencing showing the template the prompts are using as a baseline. there is always an original
// value for those sections." The prototype agrees -- qc/data.js:203 gives the Skills field a
// `before` of "Enterprise Governance | Technology Strategy | Agile Transformation | ...", exactly
// the set SKILL_ROWS records as `orig`.
import { MASTER_BASELINE_FIELD, masterBaseline } from '../dist/functions/tests/evidence.js'

test('H:master-baseline-covers-the-resume-slots: every resume merge field has an original', () => {
  // The seven resume placeholders are the ones the owner sees on the resume step. A slot with no
  // mapping renders "no earlier version", which is honest but is NOT the intended end state here.
  for (const field of TEMPLATE_META.resume.placeholders) {
    assert.ok(MASTER_BASELINE_FIELD[field],
      `resume merge field ${field} has no MasterContext baseline — "Show original" would be empty on it`)
  }
})

test('H:master-baseline-omits-absent-blocks: an empty column is not an empty original', () => {
  const out = masterBaseline({ resumeSummary: 'the master summary', skills1: '', skills2: '   ', expertise: null })
  assert.deepEqual(Object.keys(out), ['ResumeSummary'],
    'only blocks with real text become an original; blank/absent stay absent')
  assert.equal(out.ResumeSummary, 'the master summary')
  assert.deepEqual(masterBaseline(null), {}, 'a missing MasterContext row yields no baselines, not junk')
})

test('H:relevant-lists-share-one-pool: the one-to-many mapping is intentional and total', () => {
  // relevantProficiencies is a single pooled block that the packet splits into three slots. All
  // three legitimately share it — that IS what each was written from. Asserted so a later reader
  // does not "fix" the duplication into two-thirds of the fields losing their original.
  for (const f of ['RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3']) {
    assert.equal(MASTER_BASELINE_FIELD[f], 'relevantProficiencies', `${f} must map to the shared pool`)
  }
})

test('H:baseline-makes-method-separate: copied stays From profile, rewritten becomes Written for this posting', () => {
  // THE POINT OF THE WHOLE CHANGE. Same call, one field the model copied and one it rewrote.
  // NOTE the fields chosen: `mergeFieldsFor('resume')` is TEMPLATE_META.resume.placeholders, which
  // is the SEVEN dynamic slots. Work history is NOT among them — in the current template that
  // section is static text (appFacts.ts:25 reads it as a primary source of facts), so it never
  // becomes an insertion row. Asserting against it is how the first draft of this test failed.
  const prevPkg = masterBaseline({
    resumeSummary: 'the master summary',
    skills1: 'A | B | C',
    expertise: 'Governance | Delivery',
  })
  const { rows } = buildInsertions({
    type: 'resume',
    pkg: {
      ResumeSummary: 'a summary rewritten for THIS posting',
      SkillsBullets1: 'A | B | C',
      ExpertiseBullets: 'Governance | Delivery',
    },
    prevPkg,
    loop: 0,
  })
  const by = Object.fromEntries(rows.map((r) => [r.merge_field, r]))

  assert.equal(by.ResumeSummary.method, 'model_rewrite',
    'a summary that differs from the master was written for this posting')
  assert.equal(by.ResumeSummary.before_text, 'the master summary',
    'and "Show original" must have the master text to show')

  assert.equal(by.SkillsBullets1.method, 'template_fill',
    'a skills list the model copied verbatim really did come From profile')
  assert.equal(by.ExpertiseBullets.method, 'template_fill', 'ditto an unchanged expertise list')

  // The regression this replaces: with no baseline, ALL THREE collapse to template_fill and the
  // rewritten summary claims "From profile".
  const flat = buildInsertions({
    type: 'resume',
    pkg: { ResumeSummary: 'a summary rewritten for THIS posting' },
    prevPkg: {},
    loop: 0,
  }).rows.find((r) => r.merge_field === 'ResumeSummary')
  assert.equal(flat.method, 'template_fill')
  assert.equal(flat.before_text, null,
    'documents the OLD behaviour so the difference this change makes is visible in the suite')
})

test('H:baseline-is-loop-0-only: a remediation pass still compares against the previous pass', () => {
  // The master must NOT leak into loops >= 1 — there, "before" means pass n-1's output, and
  // realEdits/creditClosures depend on that meaning.
  const { rows } = buildInsertions({
    type: 'resume',
    pkg: { ResumeSummary: 'pass 1 text' },
    prevPkg: { ResumeSummary: 'pass 0 text' },
    loop: 1,
  })
  const r = rows.find((x) => x.merge_field === 'ResumeSummary')
  assert.equal(r.before_text, 'pass 0 text', 'loop 1 compares against loop 0, never against the master')
  assert.equal(r.loop, 1)
})

test('H:baseline-loads-only-at-loop-0: writeInsertions must not read the master on a pass', () => {
  // Structural: the master read is gated on `loop === 0`. Ungating it would silently redefine
  // before_text for every remediation pass and corrupt what realEdits measures.
  const src = readFileSync(new URL('../src/functions/tests/appInsertions.ts', import.meta.url), 'utf8')
  assert.match(src, /loop === 0 \? await loadMasterBaseline\(\) : \{\}/,
    'the master baseline must be read at loop 0 ONLY')
  // ...and a Storage failure must degrade, never throw: losing a disclosure must not cost a build.
  const fn = src.slice(src.indexOf('async function loadMasterBaseline'))
  assert.match(fn.slice(0, fn.indexOf('\n}')), /catch \{ return \{\} \}/,
    'loadMasterBaseline must swallow its errors — the packet still builds without a baseline')
})

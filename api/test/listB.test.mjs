// LIST B — the pre-swap copies Call 3 compares against.
//
// `ats_user`'s objective is "Compare each skill in Lists A to Lists B" and "eliminate redundancy
// across Skills Lists A (1,2), Skills Lists B (1,2), and the Relevant Skills Lists". This pipeline
// supplied ONLY List A: 21 tokens interpolated, 9 supplied, so the QC pass merged against nothing
// and its swap reasoning and `changes_cited` degenerated.
//
// List B needs no new node. The owner's prompt asks the model to restate each list inside the swap
// table "before any swaps", so each arrives TWICE; `resumeParser` is first-unfilled-wins, so the
// placed field is the post-swap final and the SECOND copy lands in `_unmapped` and was dropped.
// That is `D33` and `D:call3-compares-against-an-empty-list` seen from opposite ends.
//
// The titles below are the ones MEASURED as discarded on a real build (D33, job 945e28ed):
// `Skills1` (315-357 chars), `Skills2` (320-364), `Relevant Skills 1/2/3` (132-140) and the
// `Relevant Skills bullet list N` variants — not invented headings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { listBFromCalls, LIST_B_TOKENS } from '../dist/functions/tests/pipeline.js'
import { headingKeysFor } from '../dist/functions/tests/resumeParser.js'

const sec = (title, body) => ({ title, body })

test('the pre-swap copies are recovered into their own slots', () => {
  const c1 = {
    _unmapped: [
      sec('Skills1', 'Original Skill A\nOriginal Skill B'),
      sec('Skills2', 'Original Skill C'),
      sec('Relevant Skills 1', 'Original Relevant One'),
    ],
  }
  const c2 = { _unmapped: [sec('Relevant Skills 2', 'Original Relevant Two')] }
  const b = listBFromCalls(c1, c2)
  assert.equal(b.skills1, 'Original Skill A\nOriginal Skill B')
  assert.equal(b.skills2, 'Original Skill C')
  assert.equal(b.relevant1, 'Original Relevant One')
  assert.equal(b.relevant2, 'Original Relevant Two', 'Call 2 sections must be recovered too')
})

test('the "bullet list N" heading variant maps to the same slots', () => {
  // The prompt emits both `### Relevant Skills 1 ###` and `### Relevant Skills bullet list 1 ###`,
  // and D33 measured BOTH being discarded. Whatever `headingKeysFor` maps, this must follow — the
  // point of reusing that mapper is that neither side can drift.
  const variant = 'Relevant Skills bullet list 1'
  const keys = headingKeysFor(variant)
  const b = listBFromCalls({ _unmapped: [sec(variant, 'Variant body')] })
  if (keys.includes('relevant1')) {
    assert.equal(b.relevant1, 'Variant body',
      'the parser maps this heading, so List B recovery must map it identically')
  } else {
    assert.deepEqual(b, {}, 'the parser does not map this heading, so recovery must not invent a mapping')
  }
})

test('FIRST copy wins, mirroring the parser', () => {
  const c1 = {
    _unmapped: [
      sec('Skills1', 'The pre-swap original'),
      sec('Skills1', 'A later revision'),
    ],
  }
  assert.equal(listBFromCalls(c1).skills1, 'The pre-swap original',
    'the earliest restatement is the pre-swap original; a later one is a further revision')
})

test('sections that map to no field are ignored, not guessed at', () => {
  const c1 = {
    _unmapped: [
      sec('Missing ATS Swap Suggestions', 'analysis prose'),
      sec('Jobscan Extraction', 'more prose'),
      sec('Word and Character Requirements Check', 'Removed'),
    ],
  }
  assert.deepEqual(listBFromCalls(c1), {},
    'analysis sections are not skill lists; recovering them into a skills slot would feed the QC ' +
    'pass prose where it expects a list')
})

test('an empty body is never recovered', () => {
  assert.deepEqual(listBFromCalls({ _unmapped: [sec('Skills1', '')] }), {},
    'an empty section is not a list; supplying it would look like a real empty List B')
})

test('missing or malformed calls do not throw', () => {
  assert.deepEqual(listBFromCalls(null, undefined, {}, { _unmapped: null }), {})
})

// THE WIRING. The recovery is worthless if the recovered value is filed under a token the prompt
// does not read. These five tokens are read out of the live `ats_user` prompt (8,807 chars):
//   List B Skills 1/2            -> 290709249__output__Item 13 / 15
//   Relevant skills b (1, 2, 3)  -> 289877662__output__Item 41 / 43 / 45
test('each slot is wired to the token the prompt actually interpolates', () => {
  // Keyed by the PARSER's keys, which is what headingKeysFor returns — using the merge-field
  // names here was the bug this file caught: every lookup missed and List B stayed empty.
  assert.deepEqual(LIST_B_TOKENS(), {
    skills1: '290709249__output__Item 13',
    skills2: '290709249__output__Item 15',
    relevant1: '289877662__output__Item 41',
    relevant2: '289877662__output__Item 43',
    relevant3: '289877662__output__Item 45',
  }, 'a recovered list filed under the wrong token is still an empty List B to the prompt')
})

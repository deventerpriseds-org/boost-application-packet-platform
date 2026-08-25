import test from 'node:test'
import assert from 'node:assert/strict'
import { reapplyOwnerEdits } from '../dist/functions/tests/correction.js'

const row = (seq, phrase, replacement, source = 'owner_edit') => ({
  merge_field: 'SkillsBullets1', phrase, replacement,
  char_start: 0, char_end: phrase.length, before_sha256: 'a'.repeat(64),
  applied_seq: seq, reason: 'the owner rewrote this', source,
})

test('H:owner-edit-survives-a-rebuild: the edit is re-applied to regenerated text', () => {
  // DECISION A. The row already survived a rebuild - nothing deletes from `correction` - but the
  // TEXT did not, because applyCorrections only ever runs on the pipeline's freshly-planned rows.
  // Without this the change log asserts an edit the document does not contain.
  const out = reapplyOwnerEdits('Vendor selection\nStakeholder alignment',
    [row(1, 'Vendor selection', 'Supplier negotiation')])
  assert.equal(out.text, 'Supplier negotiation\nStakeholder alignment')
  assert.equal(out.applied.length, 1)
  assert.deepEqual(out.lapsed, [])
})

test('H:owner-edit-matched-by-phrase-not-stale-offsets: the offsets describe text that no longer exists', () => {
  // The stored offsets describe the field AS IT STOOD when the owner edited it. After a rebuild
  // they point at arbitrary characters. Matching on them would splice into the middle of a word.
  // Here the phrase has MOVED - char_start says 0, it is actually at 21.
  const out = reapplyOwnerEdits('Stakeholder alignment Vendor selection',
    [row(1, 'Vendor selection', 'Supplier negotiation')])
  assert.equal(out.text, 'Stakeholder alignment Supplier negotiation')
  assert.equal(out.applied.length, 1)
})

test('H:owner-edit-lapses-loudly-never-silently: absent and ambiguous both REPORT', () => {
  // Absent evidence is not_applicable, never pass. An edit that cannot be placed must surface as a
  // lapse the owner can see - dropping it quietly is the failure this whole row exists to prevent.
  const absent = reapplyOwnerEdits('Entirely different prose now.',
    [row(1, 'Vendor selection', 'Supplier negotiation')])
  assert.equal(absent.text, 'Entirely different prose now.', 'nothing may be spliced')
  assert.equal(absent.applied.length, 0)
  assert.equal(absent.lapsed.length, 1)
  assert.match(absent.lapsed[0].reason, /rewritten/)

  // AMBIGUOUS. Two occurrences and we cannot know which the owner meant. Guessing would rewrite a
  // sentence they never looked at, which is worse than leaving the edit unapplied.
  const ambiguous = reapplyOwnerEdits('vendor here and vendor there', [row(1, 'vendor', 'supplier')])
  assert.equal(ambiguous.text, 'vendor here and vendor there', 'an ambiguous target must not be guessed')
  assert.equal(ambiguous.applied.length, 0)
  assert.equal(ambiguous.lapsed.length, 1)
  assert.match(ambiguous.lapsed[0].reason, /more than once/)
})

test('H:owner-edit-never-fuzzy-matches: a near miss is a lapse, not a match', () => {
  // Splicing text into the owner's own document is as accusation-grade as this product gets.
  // Similarity is for ranking. A phrase that is nearly there is NOT there.
  for (const text of ['Vendor Selection', 'vendor  selection', 'Vendors selection']) {
    const out = reapplyOwnerEdits(text, [row(1, 'Vendor selection', 'X')])
    if (text === 'Vendor Selection') {
      // case differs -> still a lapse. Exactness here is deliberate: markRuns ignores case because a
      // generator re-cases at a sentence start, but a SPLICE must reproduce what the owner saw.
      assert.equal(out.applied.length, 0, `case-differing text must not be spliced: ${text}`)
    } else {
      assert.equal(out.applied.length, 0, `near miss must not be spliced: ${text}`)
    }
    assert.equal(out.text, text, 'the document is unchanged when nothing matched exactly')
  }
})

test('H:owner-edit-replay-is-deterministic: rows replay in applied_seq order', () => {
  // Whatever order the rows arrive from the database, the document must come out the same.
  const rows = [row(2, 'beta', 'B'), row(1, 'alpha', 'A')]
  const a = reapplyOwnerEdits('alpha then beta', rows)
  const b = reapplyOwnerEdits('alpha then beta', [...rows].reverse())
  assert.equal(a.text, 'A then B')
  assert.equal(a.text, b.text, 'row arrival order must not change the document')
})

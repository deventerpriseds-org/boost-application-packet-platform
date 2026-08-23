// The deterministic normaliser — MODEL PROPOSES, CODE DECIDES.
//
// Every fixture below is the REAL production package for opportunity 9f9c370a, read out of the live
// database 2026-08-22 (db-query run 32603750148). Invented fixtures were how the earlier
// `join('\n')` assumption survived review: it looked obviously correct, and it was only wrong for
// data shapes I had not looked at. These strings are the ones the product actually stores.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeAcrossLists, enforceCharLimits, normalisePackage,
} from '../dist/functions/tests/normalise.js'
import { DEFAULT_THRESHOLDS } from '../dist/functions/tests/checks.js'

// Live values. Note "Cloud Infrastructure Management" appears in BOTH lists — that is the real
// `cross_list_redundancy` finding on this packet, not a contrived one.
const LIVE_SKILLS1 = [
  'Software Engineering Leadership',      // 31
  'Digital Transformation Expertise',     // 32
  'Cloud Infrastructure Management',      // 31
  'Scalable Software Solutions',          // 27
  'Engineering Culture Development',      // 31
  'Stakeholder Collaboration',
  'Agile Methodologies',
  'Compliance Standards',
  'Continuous Improvement',
  'Data Analytics Expertise',
].join('\n')
const LIVE_RELEVANT1 = [
  'Cloud Infrastructure Management',      // duplicate of a SkillsBullets1 item
  'Digital Transformation Strategy',
  'Agile Engineering Practices',
].join('\n')

const livePkg = () => ({ SkillsBullets1: LIVE_SKILLS1, RelevantBullets1: LIVE_RELEVANT1 })
const T = DEFAULT_THRESHOLDS
const never = async () => null                    // model declines / transport down
const truncate = async ({ item, maxChars }) => item.slice(0, maxChars)   // a FITTING proposal

test('dedupe removes the cross-list duplicate and keeps the first occurrence', () => {
  const pkg = livePkg()
  const changes = dedupeAcrossLists(pkg)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].field, 'RelevantBullets1')
  assert.equal(changes[0].before, 'Cloud Infrastructure Management')
  assert.equal(changes[0].after, null, 'a dedupe REMOVES an item; after must be null')
  // Kept in the skills list, gone from the relevant list.
  assert.ok(pkg.SkillsBullets1.includes('Cloud Infrastructure Management'))
  assert.ok(!pkg.RelevantBullets1.includes('Cloud Infrastructure Management'))
  // And nothing else moved.
  assert.equal(pkg.RelevantBullets1, 'Digital Transformation Strategy\nAgile Engineering Practices')
})

test('dedupe preserves the stored formatting exactly for untouched fields', () => {
  const pkg = livePkg()
  dedupeAcrossLists(pkg)
  assert.equal(pkg.SkillsBullets1, LIVE_SKILLS1, 'a field with no duplicate must be byte-identical')
})

// THE FIDELITY GUARD. This is the assumption that was wrong the first time this module was written:
// `splitItems` strips a leading `-`/`*`/`•`/`·` and splits on `|`, so `join('\n')` is NOT its
// inverse. Writing back would have deleted the bullets from a document sent to an employer.
test('a bullet-prefixed field is left completely untouched', async () => {
  const bulleted = '- Cloud Infrastructure Management\n- Digital Transformation Strategy'
  const pkg = { SkillsBullets1: LIVE_SKILLS1, RelevantBullets1: bulleted }
  dedupeAcrossLists(pkg)
  assert.equal(pkg.RelevantBullets1, bulleted,
    'bullets must survive: the round trip is lossy, so the field must not be rewritten at all')

  const r = await enforceCharLimits(pkg, T, truncate)
  assert.equal(pkg.RelevantBullets1, bulleted, 'char-limit pass must not reformat it either')
  assert.ok(r.unresolved.some(u => u.includes('RelevantBullets1')),
    'skipping a field must be REPORTED, not silent')
})

test('a pipe-separated field is left untouched too', () => {
  const piped = 'Cloud Infrastructure Management | Agile Engineering Practices'
  const pkg = { SkillsBullets1: LIVE_SKILLS1, RelevantBullets1: piped }
  dedupeAcrossLists(pkg)
  assert.equal(pkg.RelevantBullets1, piped)
})

test('over-limit items are reworded when the proposal actually fits', async () => {
  const pkg = livePkg()
  const { changes } = await enforceCharLimits(pkg, T, truncate)
  const skillChanges = changes.filter(c => c.field === 'SkillsBullets1')
  assert.ok(skillChanges.length > 0, 'the live package has items over the limit; some must be fixed')
  for (const c of skillChanges) {
    assert.ok(c.after.length <= T.skillMaxChars, `"${c.after}" still exceeds ${T.skillMaxChars}`)
    assert.equal(c.rule, 'skill_char_limit')
  }
  // Every item in the written-back field now fits.
  for (const item of pkg.SkillsBullets1.split('\n')) {
    assert.ok(item.length <= T.skillMaxChars, `"${item}" (${item.length}) exceeds the limit after normalisation`)
  }
})

// THE SAFETY PROPERTY. Everything else is convenience; this is what makes the pass safe to run on
// every build. A model that returns something too long, empty, or nothing at all must leave the
// package exactly as it was.
test('a proposal that does not fit is REJECTED and the original kept', async () => {
  const pkg = livePkg()
  const before = pkg.SkillsBullets1
  const tooLong = async ({ item }) => item + ' and more words that make it longer'
  const { changes, unresolved } = await enforceCharLimits(pkg, T, tooLong)
  assert.deepEqual(changes, [], 'no change may be recorded when nothing fit')
  assert.equal(pkg.SkillsBullets1, before, 'the package must be untouched when every proposal failed')
  assert.ok(unresolved.length > 0, 'the failure must be reported, not swallowed')
})

test('an empty or absent proposal is rejected', async () => {
  const pkg = livePkg()
  const before = pkg.SkillsBullets1
  const { changes } = await enforceCharLimits(pkg, T, never)
  assert.deepEqual(changes, [])
  assert.equal(pkg.SkillsBullets1, before)

  const pkg2 = livePkg()
  const blank = async () => '   '
  const r2 = await enforceCharLimits(pkg2, T, blank)
  assert.deepEqual(r2.changes, [], 'whitespace is not a valid rewrite')
  assert.equal(pkg2.SkillsBullets1, before)
})

test('a rewrite that collides with an existing item is rejected', async () => {
  // Scoped to the ONE list that already contains the proposed string. The first version of this
  // test passed `livePkg()` and asserted `changes` was empty overall — but 'Agile Methodologies'
  // collides only inside SkillsBullets1; for RelevantBullets1 it is a fitting, non-colliding value
  // and was CORRECTLY accepted. The code was right and the test was wrong, which is exactly the
  // shape of a test that would later be "fixed" by breaking working code.
  const pkg = { SkillsBullets1: LIVE_SKILLS1 }
  const before = pkg.SkillsBullets1
  const collide = async () => 'Agile Methodologies'   // already present in this list
  const { changes, unresolved } = await enforceCharLimits(pkg, T, collide)
  assert.deepEqual(changes, [], 'a colliding rewrite must not be accepted — it trades one finding for another')
  assert.equal(pkg.SkillsBullets1, before, 'the list must be untouched')
  assert.ok(unresolved.length > 0, 'the rejection must be reported')

  // And the counterpart: the SAME string in a list that does not contain it is accepted, so the
  // guard is a collision check and not a blanket refusal.
  const other = { RelevantBullets1: ['X'.repeat(T.relevantMaxChars + 5), 'Y'.repeat(T.relevantMaxChars + 4)].join('\n') }
  const r2 = await enforceCharLimits(other, T, collide)
  assert.ok(r2.changes.length > 0, 'a non-colliding fitting rewrite must still be accepted')
})

test('a rewrite throwing does not take the pass down', async () => {
  const pkg = livePkg()
  const before = pkg.SkillsBullets1
  const boom = async () => { throw new Error('transport died') }
  const { changes, unresolved } = await enforceCharLimits(pkg, T, boom)
  assert.deepEqual(changes, [])
  assert.equal(pkg.SkillsBullets1, before)
  assert.ok(unresolved.length > 0)
})

test('the relevant-list allowance is honoured, not driven to zero', async () => {
  // Three items all over the relevant limit; the check permits `relevantOverLimitAllowance` per
  // list, so only the excess is fixed and the LONGEST are kept as the allowed exceptions.
  const long = ['A'.repeat(T.relevantMaxChars + 9), 'B'.repeat(T.relevantMaxChars + 5), 'C'.repeat(T.relevantMaxChars + 1)]
  const pkg = { RelevantBullets1: long.join('\n') }
  const { changes } = await enforceCharLimits(pkg, T, truncate)
  assert.equal(changes.length, Math.max(0, 3 - T.relevantOverLimitAllowance),
    'exactly the excess over the allowance should be reworded')
  const kept = pkg.RelevantBullets1.split('\n')
  const stillOver = kept.filter(i => i.length > T.relevantMaxChars)
  assert.equal(stillOver.length, T.relevantOverLimitAllowance, 'the allowance should be used, not wasted')
  assert.ok(stillOver.every(i => i.startsWith('A')),
    'the LONGEST item should be the one kept as the exception — a rewrite would damage it most')
})

test('normalisePackage runs dedupe BEFORE rewriting, so no call is spent on a doomed item', async () => {
  const pkg = livePkg()
  const asked = []
  const spy = async (a) => { asked.push(a.item); return a.item.slice(0, a.maxChars) }
  await normalisePackage(pkg, T, spy)
  assert.ok(!asked.includes('Cloud Infrastructure Management') || !pkg.RelevantBullets1.includes('Cloud Infrastructure Management'),
    'the duplicate must not be reworded in the list it is about to be removed from')
})

test('normalisePackage never throws', async () => {
  const r = await normalisePackage(null, T, never)
  assert.ok(Array.isArray(r.changes), 'a broken input must return a result, not throw')
})

// THE RETRY, added after production measured the gap: the first live run rejected
// "Software Engineering Leadership" (31) as un-shortenable to 30, which is a trivial edit. The model
// had returned something too long and was discarded silently, never learning it had failed.
test('a failed proposal is retried ONCE, with the measured reason', async () => {
  const pkg = { SkillsBullets1: LIVE_SKILLS1 }
  const seen = []
  // Too long first, correct second — exactly the production failure and its cheap fix.
  const flaky = async ({ item, maxChars, priorAttempt }) => {
    seen.push(priorAttempt || null)
    return priorAttempt ? item.slice(0, maxChars) : item + ' XXXXXXXX'
  }
  const { changes } = await enforceCharLimits(pkg, T, flaky)
  assert.ok(changes.length > 0, 'the retry must rescue an item the first attempt got wrong')
  assert.equal(seen[0], null, 'the first attempt carries no prior-failure note')
  assert.ok(/still over the \d+ limit/.test(seen[1]),
    'the retry must state the MEASURED length of the previous answer, not just "try again"')
})

test('the retry is strictly bounded to one extra attempt', async () => {
  const pkg = { SkillsBullets1: LIVE_SKILLS1 }
  let calls = 0
  const alwaysBad = async ({ item }) => { calls++; return item + ' still too long' }
  const { changes, unresolved } = await enforceCharLimits(pkg, T, alwaysBad)
  assert.deepEqual(changes, [], 'nothing should be accepted when every attempt fails')
  assert.ok(unresolved.length > 0, 'giving up must be visible')
  // DERIVED from the fixture and the live threshold, never a magic number: the first version of
  // this assertion hardcoded 8 (four over-limit items x two attempts), which silently encoded the
  // then-current 30-char seed. When the seed moved to 24 the count became 12 and the test failed
  // for a reason that had nothing to do with retry bounding.
  const overLimit = LIVE_SKILLS1.split('\n').filter(i => i.length > T.skillMaxChars).length
  assert.ok(overLimit > 0, 'fixture no longer has any over-limit item; this test would be vacuous')
  assert.ok(calls <= overLimit * 2,
    `unbounded retry: ${calls} calls for ${overLimit} over-limit items (max ${overLimit * 2})`)
})

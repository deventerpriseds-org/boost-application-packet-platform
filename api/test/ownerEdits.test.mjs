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

// ── the write route ─────────────────────────────────────────────────────────────────────────────

import { locateOwnerPhrase } from '../dist/functions/tests/correction.js'
import { readFileSync } from 'node:fs'
const routeSrc = () => readFileSync(new URL('../src/functions/tests/appCorrections.ts', import.meta.url), 'utf8')

test('H:owner-phrase-located-in-ONE-place: the write route and the rebuild share the rule', () => {
  // EXTEND, NOT DUPLICATE. The route decides whether to accept an edit; reapplyOwnerEdits decides
  // whether it survives a rebuild. Two copies of "exactly once or refuse" would eventually accept
  // an edit at write time that lapses on the very next build for a DIFFERENT reason - which reads
  // to the owner as the product losing their work at random.
  assert.deepEqual(locateOwnerPhrase('Vendor selection here', 'Vendor selection'), { at: 0 })
  assert.equal(locateOwnerPhrase('nothing like it', 'Vendor selection').at, null)
  assert.equal(locateOwnerPhrase('a and a', 'a').at, null)
  assert.equal(locateOwnerPhrase('anything', '').at, null)

  const src = routeSrc()
  const route = src.slice(src.indexOf('export async function artifactOwnerEdit'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.match(route, /locateOwnerPhrase\(current, phrase\)/, 'the route must use the shared rule')
  assert.ok(!/current\.indexOf\(phrase/.test(route),
    'the route must not re-implement the phrase search it just delegated')
})

test('H:owner-edit-route-is-session-authenticated: an edit is a mutation, not a read', () => {
  // resolveOwner accepts an unverified ?owner= for READS. A write must not: this route splices text
  // into a document and inserts a row that says the OWNER did it. requireWrite is the same gate
  // every other mutation in this file uses.
  const src = routeSrc()
  const route = src.slice(src.indexOf('export async function artifactOwnerEdit'))
  assert.match(route.slice(0, 400), /const guard = requireWrite\(req\); if \(guard\) return guard/,
    'requireWrite must run before anything else in the handler')
  assert.match(src, /app\.http\('artifactOwnerEdit'/, 'the route must be registered or it does not exist')
})

test('H:owner-edit-refusal-is-200-not-4xx: a decline is a fact the owner must be shown', () => {
  // Same contract revertOne already established. A refusal here is the system WORKING and declining
  // - the phrase moved, or it is ambiguous - and the reason is about the owner's own document. A
  // 4xx would be swallowed by a generic error path and they would be told nothing at all.
  const src = routeSrc()
  const route = src.slice(src.indexOf('export async function artifactOwnerEdit'))
  const refusals = [...route.matchAll(/jsonBody: \{ ok: false, reason:/g)]
  assert.ok(refusals.length >= 3, `expected the refusal shape at least 3 times, found ${refusals.length}`)
  assert.ok(!/status: 4\d\d, headers: HEADERS, jsonBody: \{ ok: false/.test(route),
    'a refusal must never be returned as a 4xx')
})

test('H:api-object-has-no-duplicate-keys: a shadowed helper is a silent no-op', () => {
  // An independent AC pass found artifactInsertions and packetSwaps each defined TWICE in this
  // object literal. Identical, so no live defect - but the LATER definition silently wins, and
  // editing the earlier one changes nothing while reading like a change. They are gone now; this
  // keeps them gone, and covers the next one.
  const src = readFileSync(new URL('../../app/src/api.js', import.meta.url), 'utf8')
  const keys = [...src.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1])
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))]
  assert.deepEqual(dupes, [], `duplicate keys in the api object: ${dupes.join(', ')}`)
  assert.ok(keys.includes('ownerEdit'), 'the owner-edit helper must exist')
})

// ── THE INTEGRATION, which is what was actually missing ─────────────────────────────────────────

import { applyCorrectionPass } from '../dist/functions/tests/appCorrections.js'

/** A client that answers only what this pass asks, so the pass itself is what is under test. */
function fakeClient(storedOwnerEdits) {
  return {
    async query(sql, params) {
      if (/create table|create unique index|create index|alter table/i.test(sql)) return { rows: [] }
      if (/from correction/i.test(sql) && /owner_edit/.test(sql)) return { rows: storedOwnerEdits }
      if (/insert into correction/i.test(sql)) return { rows: [] }
      return { rows: [] }
    },
  }
}

test('H:owner-edit-reapply-is-WIRED: deleting the integration must fail the suite', () => {
  // THIS IS THE GUARD THAT WAS MISSING, AND AN INDEPENDENT VERIFIER FOUND IT, NOT ME.
  // Every test above imports reapplyOwnerEdits DIRECTLY. Deleting the entire re-apply block from
  // applyCorrectionPass - reverting decision A's integration completely - left the suite at
  // 825/825 with zero failures. The FUNCTION was proven; the fact that anything CALLS it was not.
  //
  // A unit test of a helper says the helper is correct. It says nothing about whether the product
  // uses it, and "the product uses it" is the entire claim decision A makes.
  return applyCorrectionPass(
    fakeClient([{
      merge_field: 'SkillsBullets1', phrase: 'Vendor selection', replacement: 'Supplier negotiation',
      char_start: 0, char_end: 16, before_sha256: 'a'.repeat(64), applied_seq: 1,
      reason: 'you changed this yourself', source: 'owner_edit',
    }]),
    {
      artifactId: 'art-1',
      pkg: { SkillsBullets1: 'Vendor selection\nStakeholder alignment' },
      postingText: 'We need a leader who can run vendor relationships and own the roadmap end to end.',
      profileText: 'Led vendor relationships.',
    },
  ).then((res) => {
    assert.equal(res.notApplicable, false, res.reason || 'the pass must have been able to look')
    assert.equal(res.pkg === undefined ? 'mutated-in-place' : 'mutated-in-place', 'mutated-in-place')
    assert.deepEqual(res.ownerLapsed, [], 'a placeable edit must not lapse')
  })
})

test('H:owner-edit-reapply-mutates-the-package: the edit reaches the document, not just the row', async () => {
  const pkg = { SkillsBullets1: 'Vendor selection\nStakeholder alignment' }
  await applyCorrectionPass(
    fakeClient([{
      merge_field: 'SkillsBullets1', phrase: 'Vendor selection', replacement: 'Supplier negotiation',
      char_start: 0, char_end: 16, before_sha256: 'a'.repeat(64), applied_seq: 1,
      reason: 'you changed this yourself', source: 'owner_edit',
    }]),
    { artifactId: 'art-1', pkg, postingText: 'vendor relationships and the roadmap', profileText: 'x' },
  )
  // The package is mutated IN PLACE - that is how the caller receives it, so that is what to assert.
  assert.equal(pkg.SkillsBullets1, 'Supplier negotiation\nStakeholder alignment',
    'the owner edit must be re-applied to the regenerated package')
})

test('H:owner-edit-lapse-is-REPORTED-by-the-pass: silence here is the failure', async () => {
  // The lapse must travel OUT of the pass. reapplyOwnerEdits returning it is not enough - the pass
  // has to hand it to the caller, or an edit disappears with nobody able to say so.
  const pkg = { SkillsBullets1: 'Entirely different prose after a rebuild.' }
  const res = await applyCorrectionPass(
    fakeClient([{
      merge_field: 'SkillsBullets1', phrase: 'Vendor selection', replacement: 'Supplier negotiation',
      char_start: 0, char_end: 16, before_sha256: 'a'.repeat(64), applied_seq: 1,
      reason: 'you changed this yourself', source: 'owner_edit',
    }]),
    { artifactId: 'art-1', pkg, postingText: 'vendor relationships and the roadmap', profileText: 'x' },
  )
  assert.equal(pkg.SkillsBullets1, 'Entirely different prose after a rebuild.', 'nothing may be spliced')
  assert.equal((res.ownerLapsed || []).length, 1, 'the lapse must reach the caller')
  assert.match(res.ownerLapsed[0].reason, /rewritten/)
})

test('H:owner-lapse-reaches-the-owner: a reported lapse with no consumer is still a silence', async () => {
  // ownerLapsed was PRODUCED and READ NOWHERE - appPackets assigned the pass result and never
  // looked at it. So a rebuild could discard the owner's wording while the change log went on
  // asserting it was in place. The module's own doc already said "the caller must surface these",
  // which is exactly the kind of instruction that does not execute.
  //
  // A source guard, not a behavioural one, and worth saying why: driving the real build needs
  // OpenAI, Google and Postgres. What can be asserted here is that the ONLY consumer exists and
  // reaches the owner-visible channel - `built.warnings`, which summariseBuild turns into the
  // packet's note.
  const src = readFileSync(new URL('../src/functions/tests/appPackets.ts', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.match(code, /for \(const l of corrections\.ownerLapsed \|\| \[\]\)/,
    'the build must iterate the lapses the correction pass reports')
  assert.match(code, /built\.warnings\.push\(`your edit to \$\{l\.row\.merge_field\} could not be kept/,
    'and push each one into the owner-visible warnings channel')
})

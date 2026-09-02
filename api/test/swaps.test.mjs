// P1.3 — skill_candidate / swap_decision. Field names and separators mirror the REAL pipeline
// (pipeline.ts buildPackageForJD Call-1/Call-3, mt17.assemblePackage).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  splitItems, similarity, attribute, buildSwaps, LISTS, LIST_FIELDS,
  SWAP_THRESHOLD, ATTRIBUTION_THRESHOLD, slotsFor,
} from '../dist/functions/tests/swaps.js'

const listOf = (r, list) => r.lists.find((l) => l.list === list)

const REQS = [
  { seq: 0, verbatim: 'You will own the integrated product roadmap for corporate hiring technology', item_text: 'Own the roadmap', kind: 'responsibility' },
  { seq: 1, verbatim: 'Minimum of 10 years of product management experience', item_text: '10+ years', kind: 'must_have' },
  { seq: 2, verbatim: null, item_text: 'Kubernetes exposure', kind: 'nice_to_have' },
]

test('splitItems matches the pipeline separators and strips bullet glyphs', () => {
  assert.deepEqual(splitItems('• Roadmap ownership\n• P&L management'), ['Roadmap ownership', 'P&L management'])
  assert.deepEqual(splitItems('A | B · C'), ['A', 'B', 'C'])
  assert.deepEqual(splitItems(''), [])
  assert.deepEqual(splitItems(null), [])
  assert.deepEqual(splitItems(undefined), [])
})

test('similarity is symmetric, bounded, and ignores filler words', () => {
  assert.equal(similarity('Roadmap ownership', 'Roadmap ownership'), 1)
  assert.equal(similarity('a', ''), 0)
  const x = similarity('Proven experience leading roadmap strategy', 'Roadmap strategy leadership')
  assert.equal(x, similarity('Roadmap strategy leadership', 'Proven experience leading roadmap strategy'))
  assert.ok(x > 0 && x <= 1)
})

test('attribute cites the employer words, never a paraphrase', () => {
  const a = attribute('Owned the integrated product roadmap for hiring technology', REQS)
  assert.equal(a.seq, 0)
  assert.equal(a.quote, REQS[0].verbatim, 'the quote must be the posting text, not item_text')
  assert.ok(a.confidence >= ATTRIBUTION_THRESHOLD)
  // A requirement with no located verbatim can never supply a citation.
  assert.equal(attribute('Kubernetes exposure across clusters', [REQS[2]]), null)
  assert.equal(attribute('Completely unrelated clinical trial work', REQS), null)
})

test('an unchanged item still produces a row — "kept" is data, not noise', () => {
  const r = buildSwaps({
    call1: { skills1: 'Roadmap ownership\nP&L management' },
    call3: {}, pkg: { SkillsBullets1: 'Roadmap ownership\nP&L management' },
    requirements: REQS,
  })
  const s1 = r.swaps.filter(x => x.list === 'skills_1')
  assert.equal(s1.length, 2)
  assert.ok(s1.every(x => x.action === 'kept'))
  assert.equal(r.itemCount, 2)
})

test('a kept row is never presented as posting-driven', () => {
  const r = buildSwaps({
    call1: { skills1: 'Own the integrated product roadmap for corporate hiring technology' },
    call3: {}, pkg: { SkillsBullets1: 'Own the integrated product roadmap for corporate hiring technology' },
    requirements: REQS,
  })
  const kept = r.swaps.find(x => x.action === 'kept')
  assert.equal(kept.driver, 'unattributed')
  assert.equal(kept.verbatim_quote, null, 'nothing changed, so the posting did not drive anything')
})

test('a reworded item is a swap carrying a real quote, not a drop plus an add', () => {
  const r = buildSwaps({
    call1: { relevant1: 'Led product roadmap work' },
    call3: {}, pkg: { RelevantBullets1: 'Owned the integrated product roadmap for corporate hiring technology' },
    requirements: REQS,
  })
  const s = r.swaps.filter(x => x.list === 'relevant_1')
  assert.equal(s.length, 1)
  assert.equal(s[0].action, 'swapped')
  assert.equal(s[0].driver, 'posting')
  assert.equal(s[0].verbatim_quote, REQS[0].verbatim)
  assert.ok(s[0].confidence > 0)
})

// CONTRACT CHANGE, 2026-08-30. This test used to assert the OPPOSITE: an unrelated replacement was
// a drop plus an add, because pairing ran on `similarity() >= SWAP_THRESHOLD`. Under fixed slots
// that is the wrong statement about the document — the slot did not empty and a new slot did not
// appear; ONE slot changed hands. A drop+add pair also mis-feeds two real consumers: `restoreOptions`
// (`assetBlocks.js:638`) offers "Put back X" for the drop, and `compactFit.rankOf` ranks a drop at 0
// (first to be deleted from the compact resume) while a swap ranks 1.
test('one slot changing hands is ONE swap, not a drop plus an add', () => {
  const r = buildSwaps({
    call1: { skills2: 'Clinical trial submissions to the FDA' },
    call3: {}, pkg: { SkillsBullets2: 'Vendor contract negotiation' },
  })
  const rows = r.swaps.filter(x => x.list === 'skills_2')
  assert.deepEqual(rows.map(x => x.action), ['swapped'])
  assert.equal(rows[0].from_label, 'Clinical trial submissions to the FDA')
  assert.equal(rows[0].to_label, 'Vendor contract negotiation')
  // and the two texts share NOTHING, so this pairing cannot have come from similarity.
  assert.equal(similarity('Clinical trial submissions to the FDA', 'Vendor contract negotiation'), 0)
  assert.ok(SWAP_THRESHOLD > 0 && SWAP_THRESHOLD < 1)
})

test('two originals collapsing onto one final give swapped + merged, never two swaps', () => {
  const r = buildSwaps({
    call1: { skills1: 'Product roadmap ownership\nProduct roadmap strategy' },
    call3: {}, pkg: { SkillsBullets1: 'Product roadmap ownership and strategy' },
  })
  const acts = r.swaps.filter(x => x.list === 'skills_1').map(x => x.action)
  assert.equal(acts.filter(a => a === 'swapped').length, 1)
  assert.equal(acts.filter(a => a === 'merged').length, 1)
  assert.equal(r.itemCount, 1, 'the document contains ONE bullet — the table must not claim two')
})

// The omission list is real: the resume prompt interpolates {{289877659__Items to Omit}},
// zapVars maps it to MasterContext.itemsToOmit, and mt-13 verifies live that it is non-empty.
test('a drop the owner do-not-use list explains is rule-driven, never posting-driven', () => {
  const r = buildSwaps({
    call1: { skills1: 'Roadmap ownership\nCI/CD pipeline tuning' },
    call3: {}, pkg: { SkillsBullets1: 'Roadmap ownership' },
    requirements: REQS,
    omitList: 'CI/CD pipeline tuning\nSecure coding',
  })
  const dropped = r.swaps.find(x => x.action === 'dropped')
  assert.equal(dropped.driver, 'rule')
  assert.equal(dropped.verbatim_quote, null, 'a rule drop must never carry a posting citation')
  assert.match(dropped.rationale, /do-not-use list/)
  assert.equal(r.unattributed, 0, 'a rule-driven drop is explained, so it is not an unexplained change')
})

test('a drop NOT on the omission list stays unattributed — rule is not a catch-all', () => {
  const r = buildSwaps({
    call1: { skills1: 'Roadmap ownership\nVendor negotiation' },
    call3: {}, pkg: { SkillsBullets1: 'Roadmap ownership' },
    omitList: 'Secure coding',
  })
  const dropped = r.swaps.find(x => x.action === 'dropped')
  assert.equal(dropped.driver, 'unattributed')
})

test('an omitted item is NOT marked profile_original even if it sits in the profile blob', () => {
  // itemsToOmit is excluded from profileText upstream; this pins the intent at this layer too.
  const r = buildSwaps({
    call1: { skills1: 'Secure coding' }, call3: {}, pkg: { SkillsBullets1: '' },
    omitList: 'Secure coding', profileText: 'Enterprise architecture governance',
  })
  assert.notEqual(r.candidates[0].origin, 'profile_original')
})

test('an added item no requirement explains is UNATTRIBUTED, never laundered as rule-driven', () => {
  const r = buildSwaps({
    call1: { skills1: 'Roadmap ownership' },
    call3: {}, pkg: { SkillsBullets1: 'Roadmap ownership\nQuantum cryptography research' },
    requirements: REQS,
  })
  const added = r.swaps.find(x => x.action === 'added')
  assert.equal(added.driver, 'unattributed')
  assert.equal(added.requirement_seq, null)
  assert.equal(added.verbatim_quote, null)
  assert.equal(r.unattributed, 1, 'this is the count P2.2 must be able to block on')
})

test('every swapped/added row either carries a quote or is counted as unattributed', () => {
  const r = buildSwaps({
    call1: { skills1: 'Led roadmap work', relevant2: 'Ran a team' },
    call3: {},
    pkg: { SkillsBullets1: 'Owned the integrated product roadmap for corporate hiring technology',
           RelevantBullets2: 'Managed vendor relationships' },
    requirements: REQS,
  })
  const changes = r.swaps.filter(x => x.action === 'swapped' || x.action === 'added')
  for (const c of changes) {
    const ok = (c.driver === 'posting' && c.verbatim_quote && c.requirement_seq !== null) || c.driver === 'unattributed'
    assert.ok(ok, `row is neither cited nor counted as a failure: ${JSON.stringify(c)}`)
  }
  assert.equal(changes.length, r.swaps.filter(x => ['swapped','added'].includes(x.action)).length)
})

test('candidates cover every item across every list, including unchanged ones', () => {
  const call1 = { skills1: 'A one\nB two', skills2: 'C three', relevant1: 'D four', relevant2: 'E five', relevant3: 'F six' }
  const pkg = { SkillsBullets1: 'A one\nB two', SkillsBullets2: 'C three', RelevantBullets1: 'D four',
                RelevantBullets2: 'E five', RelevantBullets3: 'G seven', ExpertiseBullets: 'H eight' }
  // `expertise` joined LISTS on 2026-08-30. It has no separate Call-1 field, so its baseline comes
  // from the master block; without one the shipped item is correctly an `added`.
  const r = buildSwaps({ call1, call3: {}, pkg, master: { ExpertiseBullets: 'H eight' } })
  assert.equal(r.itemCount, 7)
  // 6 call-1 originals + 1 genuinely new final + 1 expertise item
  assert.equal(r.candidates.length, 8)
  assert.deepEqual([...new Set(r.candidates.map(c => c.list))].sort(), [...LISTS].sort())
  assert.ok(r.candidates.every(c => c.char_len === c.label.length))
  // and every list reports counts, including the ones with nothing in them
  assert.deepEqual(r.lists.map(l => l.list).sort(), [...LISTS].sort())
})

test('pass_b origin is recorded for items only the ATS pass produced', () => {
  const r = buildSwaps({ call1: { skills1: 'A one' }, call3: {}, pkg: { SkillsBullets1: 'A one\nZ nine' } })
  assert.equal(r.candidates.find(c => c.label === 'A one').origin, 'pass_a')
  assert.equal(r.candidates.find(c => c.label === 'Z nine').origin, 'pass_b')
})

test('an item already in the standing profile is marked profile_original', () => {
  const r = buildSwaps({
    call1: { skills1: 'Enterprise architecture governance' }, call3: {},
    pkg: { SkillsBullets1: 'Enterprise architecture governance' },
    profileText: 'Twenty years of enterprise architecture governance and platform strategy.',
  })
  assert.equal(r.candidates[0].origin, 'profile_original')
})

test('falls back to call3 when assemblePackage produced no merged value', () => {
  const r = buildSwaps({ call1: { skills1: 'A one' }, call3: { finalSkills1: 'B two' }, pkg: {} })
  assert.equal(r.itemCount, 1)
  // One baseline item, one shipped item, one slot: a single `swapped` row. (It was dropped+added
  // before the fixed-slot rewrite — see the contract-change note above.)
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  assert.deepEqual(rows.map(x => x.action), ['swapped'])
  assert.equal(listOf(r, 'skills_1').finalCount, 1)
})

test('empty everything is survivable and produces no rows', () => {
  const r = buildSwaps({ call1: {}, call3: {}, pkg: {} })
  assert.deepEqual(r.candidates, []); assert.deepEqual(r.swaps, [])
  assert.equal(r.itemCount, 0); assert.equal(r.unattributed, 0)
})

test('buildSwaps is deterministic and makes no model call', () => {
  const input = { call1: { skills1: 'Led roadmap work' }, call3: {}, pkg: { SkillsBullets1: 'Owned the product roadmap' }, requirements: REQS }
  assert.deepEqual(buildSwaps(input), buildSwaps(input))
  assert.deepEqual(Object.keys(LIST_FIELDS).sort(), [...LISTS].sort())
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FIXED-SLOT SWAP PAIRING (AC `docs/qc-evidence/AC-fixed-slot-swap-pairing.md`, 2026-08-30)
//
// The defect: `swaps.ts:222` read `splitItems(call1[f.passA])` as the "original". That is Call 1's
// MODEL OUTPUT, not the owner's master template. Measured live on 2026-08-29: 9 of 14 swap rows
// named an "original" that appears nowhere in the master, so the reviewer was shown one model draft
// replacing another and told it was their own resume changing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ── AC-1 — the "original" is the MASTER TEMPLATE, not Call 1 ────────────────────────────────────
test('AC-1: from_label comes from the master template, and never from call1 alone', () => {
  // call1 and master DISAGREE ON EVERY ITEM, which is the shape the live measurement found. If the
  // baseline were still call1, every from_label below would be a "Draft" string.
  const r = buildSwaps({
    call1: { skills1: 'Draft alpha\nDraft beta' },
    call3: {},
    pkg: { SkillsBullets1: 'Master one\nShipped two' },
    master: { SkillsBullets1: 'Master one\nMaster two' },
  })
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  const froms = rows.map(x => x.from_label).filter(Boolean)
  assert.ok(froms.length > 0, 'the fixture must produce from_labels to reason about')
  for (const f of froms) {
    assert.ok(['Master one', 'Master two'].includes(f), `from_label must be master text, got: ${f}`)
    assert.ok(!/^Draft /.test(f), 'no from_label may originate from call1 when a master block exists')
  }
  assert.equal(listOf(r, 'skills_1').baselineSource, 'master')
})

test('AC-1: with NO master block the baseline degrades to call1 and SAYS SO', () => {
  // `masterBaseline()` returns only non-empty blocks and `loadMasterBaseline()` returns {} on any
  // Storage failure (appInsertions.ts:33). Reporting zero originals there would claim the packet
  // invented the owner's whole list; falling back is the honest answer, and `baselineSource` records
  // it so nothing downstream has to guess which text the row is comparing against.
  const r = buildSwaps({ call1: { skills1: 'Draft alpha' }, call3: {}, pkg: { SkillsBullets1: 'Draft alpha' }, master: {} })
  assert.equal(listOf(r, 'skills_1').baselineSource, 'call1')
  assert.equal(r.swaps.find(x => x.list === 'skills_1').from_label, 'Draft alpha')
  // an empty list on both sides is neither — it must not claim a master it never had
  assert.equal(listOf(r, 'relevant_3').baselineSource, 'none')
})

test('AC-1: a master-derived original is profile_original, never pass_a', () => {
  // `pass_a` means "Call 1, the resume writer" (swaps.ts:6-8). Saying that about the owner's own
  // standing text is false about who wrote it. skill_candidate.origin admits profile_original.
  const r = buildSwaps({
    call1: {}, call3: {}, pkg: { SkillsBullets1: 'Master one' }, master: { SkillsBullets1: 'Master one' },
  })
  assert.equal(r.candidates.find(c => c.label === 'Master one').origin, 'profile_original')
})

// ── AC-3 — set membership first, order-independent ──────────────────────────────────────────────
test('AC-3: a label in BOTH master and final is kept, whatever order it sits in', () => {
  const master = { SkillsBullets1: 'A one\nB two\nC three' }
  const run = (final) => buildSwaps({ call1: {}, call3: {}, pkg: { SkillsBullets1: final }, master })

  const r = run('C three\nA one\nD four')
  const kept = r.swaps.filter(x => x.list === 'skills_1' && x.action === 'kept')
  assert.deepEqual(kept.map(x => x.from_label).sort(), ['A one', 'C three'])
  for (const label of ['A one', 'C three']) {
    const others = r.swaps.filter(x => x.action !== 'kept' && (x.from_label === label || x.to_label === label))
    assert.equal(others.length, 0, `${label} is in both lists and must appear in no non-kept row`)
  }
  // the leftovers on each side pair up: B two occupied the slot D four now holds
  const changed = r.swaps.filter(x => x.list === 'skills_1' && x.action === 'swapped')
  assert.deepEqual(changed.map(x => [x.from_label, x.to_label]), [['B two', 'D four']])

  // ORDER MUST NOT MATTER. Every permutation of the final list yields the same kept set.
  for (const perm of ['A one\nC three\nD four', 'D four\nC three\nA one', 'A one\nD four\nC three']) {
    const k = run(perm).swaps.filter(x => x.list === 'skills_1' && x.action === 'kept').map(x => x.from_label).sort()
    assert.deepEqual(k, ['A one', 'C three'], `permutation "${perm}" changed the kept set`)
  }
})

test('AC-3: duplicates are matched one for one, never one final claimed twice', () => {
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one\nB two' },
    master: { SkillsBullets1: 'A one\nA one' },
  })
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  assert.equal(rows.filter(x => x.action === 'kept').length, 1, 'only one A one is actually shipped')
  const claimedTwice = rows.filter(x => x.to_label === 'A one')
  assert.equal(claimedTwice.length, 1, 'a single shipped item may back exactly one row')
})

// ── AC-4 — leftovers pair by POSITION, and the fixture makes similarity disagree ─────────────────
test('AC-4: leftovers pair by relative position, NOT by similarity', () => {
  // THE FIXTURE IS THE POINT. Without a case where the two rules disagree the assertion is vacuous.
  // Greedy-by-similarity (the OLD rule) pairs:
  //   'Roadmap ownership'  -> 'Product roadmap ownership and strategy'   (containment 1.0)
  //   'Vendor negotiation' -> 'Vendor contract negotiation'              (containment 1.0)
  // Position pairs the other way round. Both scores are 1.0, so this is not a threshold artefact —
  // it is the two rules giving opposite answers on the same input.
  const master = { SkillsBullets1: 'Kept item\nRoadmap ownership\nVendor negotiation' }
  const pkg = { SkillsBullets1: 'Kept item\nVendor contract negotiation\nProduct roadmap ownership and strategy' }
  assert.equal(similarity('Roadmap ownership', 'Product roadmap ownership and strategy'), 1)
  assert.equal(similarity('Vendor negotiation', 'Vendor contract negotiation'), 1)
  assert.equal(similarity('Roadmap ownership', 'Vendor contract negotiation'), 0)

  const r = buildSwaps({ call1: {}, call3: {}, pkg, master })
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  assert.equal(rows.filter(x => x.action === 'kept').length, 1)
  const pairs = rows.filter(x => x.action === 'swapped').map(x => [x.from_label, x.to_label])
  assert.deepEqual(pairs, [
    ['Roadmap ownership', 'Vendor contract negotiation'],
    ['Vendor negotiation', 'Product roadmap ownership and strategy'],
  ], 'leftover i must pair with leftover i — similarity would have swapped these two')
})

test('AC-4: the canonical A/B/C/D vs A/X/Y/Z case pairs B->X, C->Y, D->Z', () => {
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one\nX nine\nY ten\nZ eleven' },
    master: { SkillsBullets1: 'A one\nB two\nC three\nD four' },
  })
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  assert.deepEqual(rows.filter(x => x.action === 'kept').map(x => x.from_label), ['A one'])
  assert.deepEqual(rows.filter(x => x.action === 'swapped').map(x => [x.from_label, x.to_label]),
    [['B two', 'X nine'], ['C three', 'Y ten'], ['D four', 'Z eleven']])
  assert.equal(rows.filter(x => x.action === 'added' || x.action === 'dropped').length, 0)
})

// ── AC-5 — a positional pair does not fabricate a citation ───────────────────────────────────────
test('AC-5: a positional pair below ATTRIBUTION_THRESHOLD cites nothing', () => {
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Quantum cryptography research' },
    master: { SkillsBullets1: 'Clinical trial submissions' },
    requirements: REQS,
  })
  const s = r.swaps.find(x => x.list === 'skills_1' && x.action === 'swapped')
  assert.ok(s, 'the slot did change hands, so there must be a swap row')
  assert.ok(similarity('Quantum cryptography research', REQS[0].verbatim) < ATTRIBUTION_THRESHOLD)
  assert.equal(s.driver, 'unattributed')
  assert.equal(s.verbatim_quote, null)
  assert.equal(s.requirement_seq, null)
  assert.equal(s.confidence, 0)
  // the DB contract: check ((driver = 'posting') = (verbatim_quote is not null))
  for (const row of r.swaps) {
    assert.equal(row.driver === 'posting', row.verbatim_quote !== null,
      `row violates swap_decision's citation CHECK: ${JSON.stringify(row)}`)
  }
  assert.equal(r.unattributed, 1, 'and it must be COUNTED, not quietly dropped')
})

test('AC-5: a positional pair that DOES match a requirement still earns its quote', () => {
  // The converse, so the rule above is not just "positional swaps are never cited".
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Owned the integrated product roadmap for corporate hiring technology' },
    master: { SkillsBullets1: 'Clinical trial submissions' },
    requirements: REQS,
  })
  const s = r.swaps.find(x => x.action === 'swapped')
  assert.equal(s.driver, 'posting')
  assert.equal(s.verbatim_quote, REQS[0].verbatim)
  assert.equal(s.requirement_seq, 0)
  assert.ok(s.confidence > 0)
})

// ── AC-6 — the owner-edit exemption survives the rewrite ─────────────────────────────────────────
test('AC-6: an owner-written label keeps driver=owner and stays out of unattributed', () => {
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Supplier negotiation' },
    master: { SkillsBullets1: 'Vendor selection' },
    requirements: REQS,
    ownerLabels: ['Supplier negotiation'],
  })
  const s = r.swaps.find(x => x.action === 'swapped')
  assert.equal(s.to_label, 'Supplier negotiation')
  assert.equal(s.driver, 'owner')
  assert.equal(r.unattributed, 0, 'the owner explaining their own resume was never the question')

  // and the exemption is EXACT — a paraphrase does not inherit it
  const near = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Supplier negotiations' },
    master: { SkillsBullets1: 'Vendor selection' },
    ownerLabels: ['Supplier negotiation'],
  }).swaps.find(x => x.action === 'swapped')
  assert.notEqual(near.driver, 'owner')
})

// F-1 (found by the independent verifier; PRE-EXISTING, not introduced by the pairing rewrite).
// An owner-typed line that HAPPENS TO MATCH a requirement's verbatim used to produce
// driver='owner' WITH a non-NULL verbatim_quote, because the three citation fields were computed
// from `att` independently of the driver. `swap_decision` has
//   check ((driver = 'posting') = (verbatim_quote is not null))
// so Postgres REJECTS that row, which aborts the whole writeSwaps transaction; appPackets.ts:619
// swallows the throw and the packet ships with a COMPLETELY EMPTY swap table — every list, not just
// the offending one. The trigger is the owner editing a line to say what the employer asked for,
// which is the most likely edit they make.
test('F-1: an owner row that also matches a requirement carries NO citation', () => {
  const verbatim = 'You will own the integrated product roadmap for corporate hiring technology'
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: verbatim },
    master: { SkillsBullets1: 'Clinical trial submissions' },
    requirements: REQS,
    ownerLabels: [verbatim],
  })
  const s = r.swaps.find(x => x.action === 'swapped')
  // the fixture must actually be attributable, or this proves nothing
  assert.ok(similarity(verbatim, REQS[0].verbatim) >= ATTRIBUTION_THRESHOLD,
    'fixture must score above the attribution threshold, else the collision never arises')
  assert.equal(s.driver, 'owner')
  assert.equal(s.verbatim_quote, null, 'the owner did not cite the employer')
  assert.equal(s.requirement_seq, null)
  assert.equal(s.confidence, 0)
})

test('F-1: the DB citation contract holds for EVERY row this module can emit', () => {
  // Asserted as the equivalence the DDL states, over a package that exercises kept / swapped /
  // added / dropped / merged / owner / rule all at once — not one hand-picked row.
  const r = buildSwaps({
    call1: { skills2: 'Vendor selection' }, call3: {},
    pkg: {
      SkillsBullets1: 'Owned the integrated product roadmap for corporate hiring technology\nA one',
      SkillsBullets2: 'Supplier negotiation',
      RelevantBullets1: 'Product roadmap ownership and strategy',
      ExpertiseBullets: 'Governance',
    },
    master: {
      SkillsBullets1: 'A one\nClinical trial submissions\nCI/CD pipeline tuning',
      RelevantBullets1: 'Product roadmap ownership\nProduct roadmap strategy',
      ExpertiseBullets: 'Governance',
    },
    requirements: REQS,
    omitList: 'CI/CD pipeline tuning',
    // BOTH kinds of owner label, deliberately: one that matches no requirement, and one that DOES
    // (the roadmap line clears ATTRIBUTION_THRESHOLD against REQS[0]). Without the second, this
    // sweep never sees an owner row holding an `att`, and the F-1 collision it exists to catch
    // cannot arise — proven: with only 'Supplier negotiation' here, reinstating the F-1 defect left
    // this test GREEN while the targeted test above failed.
    ownerLabels: ['Supplier negotiation', 'Owned the integrated product roadmap for corporate hiring technology'],
  })
  const seen = new Set(r.swaps.map(x => x.action))
  assert.ok(seen.size >= 4, `the fixture must exercise several actions, saw: ${[...seen].join(',')}`)
  assert.ok(new Set(r.swaps.map(x => x.driver)).size >= 3, 'and several drivers')
  for (const row of r.swaps) {
    assert.equal(row.driver === 'posting', row.verbatim_quote !== null,
      `check ((driver='posting') = (verbatim_quote is not null)) violated: ${JSON.stringify(row)}`)
    // and the three citation fields move together — a seq without a quote is the same lie
    assert.equal(row.verbatim_quote !== null, row.requirement_seq !== null,
      `quote and requirement_seq disagree: ${JSON.stringify(row)}`)
    if (row.verbatim_quote === null) assert.equal(row.confidence, 0)
  }
})

// ── AC-7 — when the counts agree, every row is kept or swapped ───────────────────────────────────
test('AC-7: n slots in and n slots out gives exactly n rows, all kept or swapped', () => {
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one\nX nine\nC three' },
    master: { SkillsBullets1: 'A one\nB two\nC three' },
    slots: { SkillsBullets1: 3 },
  })
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  assert.equal(rows.length, 3)
  assert.ok(rows.every(x => x.action === 'kept' || x.action === 'swapped'),
    `unexpected actions: ${rows.map(x => x.action).join(',')}`)
  const l = listOf(r, 'skills_1')
  assert.equal(l.mismatch, false)
  assert.equal(l.expected, 3)
  assert.equal(l.observed, 3)
})

// ── AC-8 — the slot count precedence, and `unknown` is null and never zero ───────────────────────
test('AC-8: slotsFor is per-template or UNKNOWN, and unknown is null — never 0', () => {
  assert.deepEqual(slotsFor('SkillsBullets1', { SkillsBullets1: 11 }), { n: 11, source: 'template' })
  // No template row at all — the shape a missing config produces.
  assert.deepEqual(slotsFor('SkillsBullets1', undefined), { n: null, source: 'unknown' })
  assert.deepEqual(slotsFor('SkillsBullets1', {}), { n: null, source: 'unknown' })
  // Explicit null, and the degenerate numbers. A 0 would declare every item in the list illegal, so
  // it is UNKNOWN rather than an accusation built on absent evidence.
  for (const v of [null, 0, -1, NaN, Infinity, undefined]) {
    const got = slotsFor('SkillsBullets1', { SkillsBullets1: v })
    assert.deepEqual(got, { n: null, source: 'unknown' }, `slots=${String(v)} must be unknown, got ${JSON.stringify(got)}`)
  }
  // There is deliberately NO master-derived fallback: the owner settled that fixed slot counts
  // change per template, so a count read off the master would be right for one and wrong for the next.
  const r = buildSwaps({
    call1: {}, call3: {}, pkg: { SkillsBullets1: 'A one\nB two' }, master: { SkillsBullets1: 'A one\nB two' },
  })
  const l = listOf(r, 'skills_1')
  assert.equal(l.slots, null, 'a populated master must NOT be read as a slot count')
  assert.equal(l.slotSource, 'unknown')
  assert.equal(l.expected, null, 'expected=null is the caller\'s signal to report not_applicable')
  assert.equal(l.mismatch, false, 'an unknown slot count can never be a violation')
})

// ── AC-9 — a violation is REPORTED, never thrown, clamped or padded ──────────────────────────────
test('AC-9a: buildSwaps does not throw on a count mismatch', () => {
  // A throw is the QUIETEST outcome available, not the loudest: appPackets.ts:617-622 swallows it
  // into a console.warn, the packet ships with an EMPTY swap table, and checks.ts:906-908 then
  // reports changes_cited as not_applicable with no mention of the violation.
  assert.doesNotThrow(() => buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one' },
    master: { SkillsBullets1: 'A one\nB two\nC three' },
    slots: { SkillsBullets1: 3 },
  }))
})

test('AC-9b: an unpaired master leftover is dropped, an unpaired final leftover is added', () => {
  const short = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one\nB two' },
    master: { SkillsBullets1: 'A one\nB two\nC three' },
    slots: { SkillsBullets1: 3 },
  })
  const sl = listOf(short, 'skills_1')
  assert.equal(sl.dropped, 1)
  assert.deepEqual(sl.droppedLabels, ['C three'])
  assert.equal(sl.added, 0)
  assert.equal(sl.mismatch, true)
  assert.equal(sl.expected, 3)
  assert.equal(sl.observed, 2)
  assert.equal(short.swaps.find(x => x.from_label === 'C three').action, 'dropped')

  const long = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one\nB two\nD four' },
    master: { SkillsBullets1: 'A one\nB two' },
    slots: { SkillsBullets1: 2 },
  })
  const ll = listOf(long, 'skills_1')
  assert.equal(ll.added, 1)
  assert.deepEqual(ll.addedLabels, ['D four'])
  assert.equal(ll.dropped, 0)
  assert.equal(ll.mismatch, true)
  assert.equal(ll.expected, 2)
  assert.equal(ll.observed, 3)
  assert.equal(long.swaps.find(x => x.to_label === 'D four').action, 'added')
})

test('AC-9b: nothing is padded or clamped to make the counts agree', () => {
  // Fabricating a partner would be the "never fabricate a composite" failure in its purest form:
  // a swap row NAMES a line of the owner's resume as the thing that was replaced.
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'A one' },
    master: { SkillsBullets1: 'A one\nB two\nC three' },
    slots: { SkillsBullets1: 3 },
  })
  const rows = r.swaps.filter(x => x.list === 'skills_1')
  assert.equal(rows.length, 3, 'every baseline item still produces exactly one row')
  assert.equal(rows.filter(x => x.action === 'swapped').length, 0, 'there was nothing to swap into')
  for (const row of rows.filter(x => x.action === 'dropped')) {
    assert.equal(row.to_label, null, 'a drop must not be given an invented partner')
  }
})

// ── The counts contract the caller (checks.ts) reads ─────────────────────────────────────────────
test('the per-list counts reconcile with the rows that were actually emitted', () => {
  const r = buildSwaps({
    call1: { skills2: 'Draft only' }, call3: {},
    pkg: { SkillsBullets1: 'A one\nX nine', SkillsBullets2: 'Draft only', RelevantBullets1: 'New item' },
    master: { SkillsBullets1: 'A one\nB two\nC three' },
    slots: { SkillsBullets1: 3 },
  })
  for (const l of r.lists) {
    const rows = r.swaps.filter(x => x.list === l.list)
    const n = (a) => rows.filter(x => x.action === a).length
    assert.equal(l.kept, n('kept'), `${l.list} kept`)
    assert.equal(l.swapped, n('swapped'), `${l.list} swapped`)
    assert.equal(l.merged, n('merged'), `${l.list} merged`)
    assert.equal(l.dropped, n('dropped'), `${l.list} dropped`)
    assert.equal(l.added, n('added'), `${l.list} added`)
    assert.equal(l.observed, l.finalCount)
    assert.equal(l.expected, l.slots)
    assert.equal(l.mismatch, l.expected !== null && l.observed !== l.expected)
  }
  assert.equal(r.itemCount, r.lists.reduce((a, l) => a + l.finalCount, 0))
})

// ── Expertise joins the swap machinery ───────────────────────────────────────────────────────────
test('expertise is a real swap list, paired off the master like any other', () => {
  assert.ok(LISTS.includes('expertise'))
  // The field names are the assembler's, read from mt17.ts:150
  //   ExpertiseBullets: firstNonEmpty(call1.expertise, call3.finalExpertise, call3.expertise)
  // — not guessed from the merge field, which would leave the call1 fallback structurally dead.
  // `masterKey` joined on 2026-08-30: it names the MasterContext block this list's master text is
  // read from, which is what tells `splitBaselineItems` whether that block is the pooled two-level
  // shape. Expertise's is its own flat field, so it is NOT pooled — asserted below and again in
  // `H:pooled-mode-is-relevant-only`.
  assert.deepEqual(LIST_FIELDS.expertise, {
    passA: 'expertise', passB: 'finalExpertise', merge: 'ExpertiseBullets', masterKey: 'expertise',
  })
  // and the Call-1 fallback actually reaches text when there is no master block
  const noMaster = buildSwaps({
    call1: { expertise: 'Governance\nStrategy' }, call3: {},
    pkg: { ExpertiseBullets: 'Governance\nDelivery' },
  })
  assert.equal(listOf(noMaster, 'expertise').baselineSource, 'call1')
  assert.deepEqual(noMaster.swaps.filter(x => x.list === 'expertise').map(x => x.action), ['kept', 'swapped'])
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { ExpertiseBullets: 'Governance\nDelivery' },
    master: { ExpertiseBullets: 'Governance\nStrategy' },
    slots: { ExpertiseBullets: 2 },
  })
  const rows = r.swaps.filter(x => x.list === 'expertise')
  assert.deepEqual(rows.map(x => x.action), ['kept', 'swapped'])
  assert.deepEqual([rows[1].from_label, rows[1].to_label], ['Strategy', 'Delivery'])
  const l = listOf(r, 'expertise')
  assert.equal(l.baselineSource, 'master')
  assert.equal(l.mismatch, false)
})

// ── Regression: the truthful-sentence rules the rewrite must not undo ────────────────────────────
test('the rewrite keeps merged, so a folded item is never reported as missing', () => {
  // An unpaired baseline leftover whose content IS in a final another pair already holds. Calling
  // that `dropped` would be false about the shipped document — the same class of false sentence
  // crossListRationale exists to kill. This is NOT similarity pairing: no final is consumed and no
  // pair changes; it only chooses which true sentence to write about an already-unpaired leftover.
  const r = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Product roadmap ownership and strategy' },
    master: { SkillsBullets1: 'Product roadmap ownership\nProduct roadmap strategy' },
  })
  const acts = r.swaps.filter(x => x.list === 'skills_1').map(x => x.action)
  assert.deepEqual(acts, ['swapped', 'merged'])
  assert.equal(r.itemCount, 1, 'the document contains ONE bullet — the table must not claim two')
  assert.equal(listOf(r, 'skills_1').dropped, 0, 'a folded item is not a drop')
})

test('an omit-list item with a positional partner is a SWAP; with none it is a rule-driven drop', () => {
  // The omit list explains why an item LEFT, not what replaced it. A refilled slot is a swap.
  const refilled = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Vendor negotiation' },
    master: { SkillsBullets1: 'CI/CD pipeline tuning' },
    omitList: 'CI/CD pipeline tuning',
  }).swaps.find(x => x.list === 'skills_1')
  assert.equal(refilled.action, 'swapped')
  assert.equal(refilled.to_label, 'Vendor negotiation')

  // With nothing to pair against it stays the rule-driven drop the app renders a caveat for.
  const emptied = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Roadmap ownership' },
    master: { SkillsBullets1: 'Roadmap ownership\nCI/CD pipeline tuning' },
    omitList: 'CI/CD pipeline tuning',
  }).swaps.find(x => x.action === 'dropped')
  assert.equal(emptied.driver, 'rule')
  assert.equal(emptied.verbatim_quote, null)
  assert.match(emptied.rationale, /do-not-use list/)
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE POOLED RELEVANT BASELINE (2026-08-30)
//
// THE DEFECT, measured in PRODUCTION, not hypothesised. `boost-pg-mcp-write`:
//   select distinct from_label from swap_decision
//    where from_label like '%: %' and list like 'relevant%' and length(from_label) > 100
// returned exactly FIVE rows, 135-245 characters each, and those five strings were the `from_label`
// of ALL FIFTEEN relevant rows across relevant_1/2/3 — e.g.
//   "Governance and Compliance: Standards and Compliance, AI/ML Strategy, Cybersecurity Leadership,
//    Data Strategy, Policy Development, Customer-Centricity"                         (149 chars)
// presented to the owner as ONE "original" skill of theirs, and triple-counted across the three
// lists. Root cause: `evidence.ts:193-195` maps RelevantBullets1/2/3 to the ONE pooled
// MasterContext key `relevantProficiencies`, and `splitItems` splits only on `|`/newline/bullet —
// which yields the five CATEGORY GROUPS, not the 36 terms inside them.
//
// THE FIXTURE BELOW IS THE LIVE MASTER, VERBATIM. It is the concatenation of those five production
// `from_label`s — i.e. text the SYSTEM PRODUCED, not a hand-made row the writers never emit. The
// same 36 terms / 5 categories are independently pinned by docs/qc-evidence/AC-skill-breakdown.md:97.
const LIVE_POOL = [
  'Governance and Compliance: Standards and Compliance, AI/ML Strategy, Cybersecurity Leadership, Data Strategy, Policy Development, Customer-Centricity',
  'Technology Strategy and Transformation: Digital Platform Maturity, SaaS Growth Strategy, Tech-Driven Innovation, Corporate AI Use Cases',
  'Business and Financial Impact: P&L Optimization, Budget and Cost Control, Investment Strategy, Business Decision Modeling, M&A Integrations, Strategic Partnerships, Portfolio Management, Profitability Analysis',
  'Data Analytics and AI: Enterprise Data Strategy, Data Insights Automation, AI/ML Advancements, Data-Driven Decisioning, Predictive Analytics, BI and Visualization, KPI-Driven Execution, Real-Time Intelligence',
  'Execution and Operations: Scaled Agile Engineering, Business Process Re-Engineering, Strategic Roadmapping, Product Design, Innovation Frameworks, Cost Optimization, AI in Operations, Platform Scalability, Global Leadership, Tech Talent Strategy',
].join(' | ')

const POOL_MASTER = {
  RelevantBullets1: LIVE_POOL, RelevantBullets2: LIVE_POOL, RelevantBullets3: LIVE_POOL,
}
// The RelevantBullets1/2/3 that actually shipped in that packet — the live `to_label`s of the same
// fifteen rows, in seq order. Again: what the system emitted, not an invented shape.
const LIVE_FINALS = {
  RelevantBullets1: 'AI/ML & Data Plan\nEnterprise Architecture Governance\nPlatform Scalability',
  RelevantBullets2: 'Cloud Infrastructure Management\nDev Practices',
  RelevantBullets3: 'Secured Engineering\nAgile Development\nContinuous Quality Engineering',
}
const relRows = (r) => r.swaps.filter((s) => s.list.startsWith('relevant'))

test('H:relevant-from-label-is-a-term-never-a-category-line', () => {
  const r = buildSwaps({ call1: {}, call3: {}, pkg: { ...LIVE_FINALS }, master: POOL_MASTER })
  const rows = relRows(r)
  assert.ok(rows.length, 'no relevant rows at all — the fixture stopped exercising the path')

  // THE MEASUREMENT. Before: every relevant from_label was 135-245 chars and contained the
  // "Category: term, term" shape. After: the longest is 20.
  for (const s of rows) {
    const f = s.from_label
    if (f === null) continue
    assert.ok(f.length <= 60, `from_label is ${f.length} chars, a category line came through: ${JSON.stringify(f)}`)
    // The precise structural discriminator, not a length heuristic: a category LINE is
    // "<label>: <term>, <term>". A term never carries a colon followed by a comma-separated tail.
    assert.ok(!/:\s.*,/.test(f), `from_label still has the "Category: a, b" shape: ${JSON.stringify(f)}`)
  }

  // and it is not merely SHORT — it must be one of the owner's 36 actual terms.
  const POOL_TERMS = new Set(LIVE_POOL.split(' | ')
    .flatMap((g) => g.slice(g.indexOf(':') + 1).split(',').map((t) => t.trim())))
  assert.equal(POOL_TERMS.size, 36, `the fixture no longer parses to 36 terms (${POOL_TERMS.size})`)
  for (const s of rows) {
    if (s.from_label === null) continue
    assert.ok(POOL_TERMS.has(s.from_label),
      `from_label is not one of the owner's 36 proficiencies: ${JSON.stringify(s.from_label)}`)
  }
})

test('H:pooled-term-in-the-final-is-kept-not-swapped-off-a-category', () => {
  // `Platform Scalability` IS the owner's own term (Execution and Operations, 8th) and it SHIPPED in
  // relevant_1. Production reported it as `swapped` FROM
  // "Business and Financial Impact: P&L Optimization, ..." — a term the owner still has, named as a
  // replacement for a 209-char line they never wrote. Set membership must call it `kept`.
  const r = buildSwaps({ call1: {}, call3: {}, pkg: { ...LIVE_FINALS }, master: POOL_MASTER })
  const ps = relRows(r).filter((s) => s.to_label === 'Platform Scalability')
  assert.equal(ps.length, 1, JSON.stringify(ps))
  assert.equal(ps[0].action, 'kept')
  assert.equal(ps[0].from_label, 'Platform Scalability')
  // REQUIREMENT 2 — the category is not lost. `swap_decision` has no category column and an
  // unpersisted SwapRow field would ship write-only (the `correction.frame` defect), so it rides on
  // `rationale`, which IS persisted and IS returned by GET /api/app/packet/{id}/swaps.
  assert.equal(ps[0].rationale, 'unchanged from the master template (Execution and Operations)')
})

test('H:pooled-baseline-accuses-nobody-and-never-twice', () => {
  const r = buildSwaps({ call1: {}, call3: {}, pkg: { ...LIVE_FINALS }, master: POOL_MASTER })
  const rows = relRows(r)

  // 36 pooled terms against a 2-3 slot list leaves ~34 unpaired per list. Emitting those as
  // `dropped` would print ~99 of the owner's own proficiencies under "Taken out of this list"
  // (AssetBlocks.jsx:404-411), and would name each of them in all three lists.
  for (const a of ['dropped', 'merged', 'swapped']) {
    assert.equal(rows.filter((s) => s.action === a).length, 0,
      `a pooled baseline emitted ${a} rows: ` + JSON.stringify(rows.filter((s) => s.action === a)))
  }
  // AND NOTHING MAY QUIETLY VANISH. Found by mutation M1: re-enabling Phase 2 under pool mode does
  // not produce a `swapped` row (the leftover branch's poolMode guard swallows it) — it CLAIMS the
  // final, so that final stops being `added` and disappears from the table altogether. Suppressing
  // a false accusation must never suppress a true row, so every shipped item is accounted for
  // exactly once. Without this assertion M1 was invisible here.
  for (const l of r.lists.filter((x) => x.baselineMode === 'pool')) {
    const mine = rows.filter((s) => s.list === l.list)
    assert.equal(mine.length, l.finalCount,
      `${l.list} ships ${l.finalCount} items but the table has ${mine.length} rows`)
    assert.equal(mine.filter((s) => s.to_label !== null).length, l.finalCount)
    assert.equal(new Set(mine.map((s) => s.to_label)).size, l.finalCount, `${l.list} double-claims a final`)
  }
  for (const l of r.lists.filter((x) => x.baselineMode === 'pool')) {
    assert.deepEqual(l.droppedLabels, [], `${l.list} named pooled offenders`)
    // counted, never silent
    assert.equal(l.unusedBaseline, l.originalCount - l.kept)
    assert.equal(l.originalCount, 36)
  }

  // NO DUPLICATE ACCUSATION, asserted structurally rather than by counting today's rows: any
  // from_label that appears in more than one list must belong to a NON-accusing action. `kept` is
  // the only action whose from_label equals its to_label, so it accuses nobody.
  const byLabel = new Map()
  for (const s of rows) {
    if (s.from_label === null) continue
    const seen = byLabel.get(s.from_label) || []
    seen.push(s)
    byLabel.set(s.from_label, seen)
  }
  for (const [label, group] of byLabel) {
    if (group.length < 2) continue
    for (const s of group) {
      assert.equal(s.action, 'kept', `"${label}" is named by a ${s.action} row in ${group.length} lists`)
      assert.equal(s.from_label, s.to_label)
    }
  }
})

test('H:pooled-mode-is-relevant-only-and-only-off-the-master', () => {
  // REQUIREMENT 4 — skills and expertise are measured correct in production today (11/11, 9/9, 7/7
  // exact) and must not move. Proven two ways, not asserted.
  //
  // (1) The flag itself. `isPooledMasterField` reads `skillPool.TWO_LEVEL_FIELDS`, which holds
  //     `relevantProficiencies` alone.
  for (const l of ['skills_1', 'skills_2', 'expertise']) {
    assert.equal(LIST_FIELDS[l].masterKey === 'relevantProficiencies', false, l)
  }

  // (2) BEHAVIOURALLY: a skills master that happens to LOOK two-level must still be ONE item,
  //     because skills1 is not a pooled field. If the two-level split ever leaked to skills, this
  //     fails — the whole point of declaring rather than sniffing.
  const skillsShaped = buildSwaps({
    call1: {}, call3: {},
    pkg: { SkillsBullets1: 'Ops: Alpha, Beta' },
    master: { SkillsBullets1: 'Ops: Alpha, Beta' },
  })
  const sk = skillsShaped.swaps.filter((s) => s.list === 'skills_1')
  assert.deepEqual(sk.map((s) => s.from_label), ['Ops: Alpha, Beta'],
    'the two-level split leaked into skills_1')
  assert.equal(listOf(skillsShaped, 'skills_1').baselineMode, 'list')
  assert.equal(listOf(skillsShaped, 'skills_1').originalCount, 1)

  // (3) The CALL-1 FALLBACK for a relevant list is an ordinary per-list block the resume writer
  //     produced, NOT a pool — so with no master text it keeps the fixed-slot pairing it always had,
  //     positional swaps and all. Pool mode requires the master to actually be in use.
  const fallback = buildSwaps({
    call1: { relevant1: 'Alpha\nBeta' }, call3: {},
    pkg: { RelevantBullets1: 'Alpha\nGamma' },
  })
  const l1 = listOf(fallback, 'relevant_1')
  assert.equal(l1.baselineSource, 'call1')
  assert.equal(l1.baselineMode, 'list')
  assert.deepEqual(fallback.swaps.filter((s) => s.list === 'relevant_1').map((s) => s.action),
    ['kept', 'swapped'])
})

test('H:master-key-parity: LIST_FIELDS.masterKey mirrors evidence.MASTER_BASELINE_FIELD', async () => {
  // `swaps.ts` cannot IMPORT the map — evidence.ts -> reviewer.ts -> insertions.ts -> swaps.ts is a
  // cycle — so the key is re-declared there and pinned here. Without this the two drift silently and
  // a relevant list quietly stops being pooled (or a skills list starts being).
  const { MASTER_BASELINE_FIELD } = await import('../dist/functions/tests/evidence.js')
  for (const list of LISTS) {
    assert.equal(LIST_FIELDS[list].masterKey, MASTER_BASELINE_FIELD[LIST_FIELDS[list].merge],
      `${list}: swaps.ts says ${LIST_FIELDS[list].masterKey}, evidence.ts says ${MASTER_BASELINE_FIELD[LIST_FIELDS[list].merge]}`)
  }
})

test('H:origin-is-membership-not-authorship: pass_b survives a Call 3 that produced nothing', () => {
  // THE MISREADING THIS PINS, and it cost a whole lane on 2026-09-02. `swaps.ts` used to claim in a
  // header comment that "Call 3 (ATS QC + merge) -> finalSkills1/2 ... = origin `pass_b`". That was
  // read as an AUTHORSHIP claim, written into .claude/DEFERRED.md, then into an AC brief AS A
  // PREMISE, and an independent pass designed six criteria and priced a production migration around
  // a defect that was never in the data.
  //
  // `origin` has only ever been MEMBERSHIP: `pass_a` = in the baseline, `pass_b` = in the shipped
  // list and not in the baseline. `finals` is `pkg[f.merge] ?? call3[f.passB]` — the SHIPPED package
  // FIRST, Call 3 only as a fallback.
  //
  // THE FIXTURE IS THE LIVE SHAPE, not one invented to pass. db-query run 33635773017 measured
  // len(call3) === 0 for all five final* fields on opportunity 9f9c370a, and `pipeline.ts:536`'s
  // `p3.value || {}` produces exactly this `{}` whenever the QC pass returns no parseable JSON.
  const baseline = 'Product roadmap\nStakeholder alignment'
  const shipped = 'Product roadmap\nStakeholder alignment\nHiring technology strategy'
  const { candidates } = buildSwaps({
    call1: { skills1: baseline },
    call3: {},                                    // Call 3 produced NOTHING, as in production
    pkg: { SkillsBullets1: shipped },             // the third item came from Call 2
  })
  const added = candidates.find((c) => c.label === 'Hiring technology strategy')
  assert.ok(added, 'the item that is in the shipped list but not the baseline must be a candidate')
  assert.equal(added.origin, 'pass_b',
    'pass_b means "in what shipped, not in the baseline" — it must NOT depend on Call 3 having ' +
    'produced anything, because on the measured packet Call 3 produced zero characters')
  const kept = candidates.find((c) => c.label === 'Product roadmap')
  assert.equal(kept.origin, 'pass_a', 'and a baseline item stays pass_a')
})

test('H:origin-comment-does-not-claim-authorship: the prose cannot re-teach the wrong meaning', () => {
  // A guard on a COMMENT, which this repo normally refuses — prose does not run. It earns the
  // exception because the comment IS the defect here: the code was always correct and the false
  // sentence in its header is what propagated into a ledger row, a brief, and an AC pass.
  // Narrow on purpose: it forbids re-binding pass_b to a specific call, not any mention of Call 3.
  const s = readFileSync(new URL('../src/functions/tests/swaps.ts', import.meta.url), 'utf8')
  const header = s.slice(0, s.indexOf('export type Origin'))
  assert.doesNotMatch(header, /Call 3[^\n]*=\s*origin `pass_b`/,
    'the header must not re-assert that Call 3 is what pass_b means')
  assert.match(header, /MEMBERSHIP, NOT AUTHORSHIP/,
    'and it must say plainly what pass_b does mean, so the next reader cannot repeat the misreading')
})

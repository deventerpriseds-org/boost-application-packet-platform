// Unit tests for the asset-blocks logic (app/src/assetBlocks.js).
// Node 22's built-in runner, no DOM, no new dependency — the same constraint api/ works under.
//   cd app && npm test
//
// WHY THIS FILE EXISTS. Every function here used to live in screens/AssetBlocks.jsx, which does
// `import React from 'react'`, so `node --test` could not load it at all ("Unknown file extension
// .jsx") and none of it was covered. The bug that shipped as a result is the first test below: the
// card re-split `after_text` in the browser and printed THAT number, so a field whose row recorded
// 4 items drew 6 lines and told the reader "this draft has 6 bullets". `item_count` is the number
// the API measured and the number the checks were run against.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  keywordDisplacement, keywordDisplacementText,
  keywordGrade, GRADE_WORD, GRADE_MARK,
  UNKNOWN_REQS_NOTE, UNKNOWN_TERMS_NOTE,
  countMismatchNote, deriveItems, draftSizeText, expectationFor, itemCountOf, joinLabels,
  latestRows, listBodyModel, listsOf, meterModel, normLabel, registerListOwners, reqsForRow,
  scopeSwaps, shapeOf, sharedSourceNote, splitItems, statPct, wordCount, observedFor,
  ORIGINAL_NONE_NOTE, originalState, PLACEHOLDER_NOTE, placeholderToken,
  OMIT_LIST_RATIONALE, omitListCaveat, restoreOptions, shortenAction,
  CROSS_LIST_RATIONALE_PREFIX, isCrossListDrop,
  attentionWithFields, unplacedFindings, unplacedOf, unplacedTarget, unplacedReason,
  registerFieldOwners, NO_OWNER_REASON, UNPLACED_LINK_HOOK,

  pickListModel, pickListAsk,
} from '../src/assetBlocks.js'
import { severityCounts } from '../src/assetGate.js'
import { findingsByField, QC_HOOKS } from '../src/qcRail.js'

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
// Comments describe the rule; only real code can break it.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── the regression this file was created for ────────────────────────────────────────────────────

// A real shape: the row says 4, the text splits into 6. Before the fix the card drew 6 rows and
// claimed 6 bullets, out-voting the row its own gate was computed from.
const DISAGREEING_ROW = {
  merge_field: '@CoreAccomplishments_5blts_180words',
  generated: true,
  list: null,
  loop: 0,
  item_count: 4,
  after_text: 'One\nTwo\nThree\nFour\nFive\nSix',
}

test('the count printed is the ROW item_count, never a re-split of the text', () => {
  // Both numbers are real and different — this is not arithmetic, it is a choice of source.
  assert.equal(splitItems(DISAGREEING_ROW.after_text).length, 6)
  assert.equal(DISAGREEING_ROW.item_count, 4)

  const d = deriveItems(DISAGREEING_ROW)
  assert.equal(d.count, 4, 'count must come off the row')
  assert.equal(d.recorded, 4)
  assert.equal(d.splitCount, 6, 'the split is still available, it just does not supply the count')
  assert.equal(d.disagrees, true)
  assert.notEqual(d.count, d.splitCount)
})

test('the expectation line reports the row count, not the drawn line count', () => {
  const expect = expectationFor(DISAGREEING_ROW.merge_field)
  assert.deepEqual(expect, { words: 180, bullets: 5 })
  const text = draftSizeText(DISAGREEING_ROW, expect)
  assert.match(text, /^4 bullets, /)
  assert.ok(!text.includes('6 bullets'), 'the browser split must not reach the reader as a claim')
})

test('a disagreement is stated, not silently resolved', () => {
  const note = countMismatchNote(4, 6)
  assert.ok(note, 'a mismatch must produce a note')
  assert.match(note, /records 4 items/)
  assert.match(note, /splits into 6/)
  assert.match(note, /checks were run against/)
  // It reads correctly in the other direction too (row higher than the split).
  assert.match(countMismatchNote(6, 4), /records 6 items/)
  assert.match(countMismatchNote(1, 3), /records 1 item\b/)
  // And stays quiet when there is nothing to report.
  assert.equal(countMismatchNote(4, 4), null)
  assert.equal(countMismatchNote(null, 6), null, 'a row with no recorded count cannot disagree')
})

test('a list body draws every line it has but claims only the row count', () => {
  const m = listBodyModel({ ...DISAGREEING_ROW, list: 'skills_1' }, [])
  assert.equal(m.count, 4, 'the claim is the row')
  assert.equal(m.lines.length, 6, 'the text is not truncated - hiding two real lines is a worse lie')
  assert.ok(m.countNote, 'so the contradiction has to be visible')
})

test('a row with no recorded count falls back to the split, and says nothing false', () => {
  const row = { generated: true, list: null, item_count: undefined, after_text: 'a\nb\nc' }
  const d = deriveItems(row)
  assert.equal(d.recorded, null)
  assert.equal(d.count, 3)
  assert.equal(d.disagrees, false)
  assert.equal(itemCountOf(row), null)
  assert.equal(itemCountOf({ item_count: 0 }), 0, 'zero is a recorded count, not a missing one')
  assert.equal(itemCountOf({ item_count: 'x' }), null)
  assert.equal(itemCountOf({ item_count: -1 }), null)
})

test('layout is decided by the row count too, so shape and count cannot disagree', () => {
  // item_count 1 with three lines of text: the row says one item, so it is not drawn as a 3-item
  // list. Before the fix the split decided this, giving a "3-item list" whose header said 1.
  const row = { generated: true, list: null, item_count: 1, after_text: 'a\nb\nc' }
  assert.equal(shapeOf(row), 'prose')
  assert.ok(countMismatchNote(deriveItems(row).recorded, deriveItems(row).splitCount))

  assert.equal(shapeOf({ generated: true, list: null, item_count: 3, after_text: 'a\nb\nc' }), 'list')
  assert.equal(shapeOf({ generated: true, list: 'skills_1', item_count: 1, after_text: 'a' }), 'list',
    'a row that names a list is a list whatever its count')
  assert.equal(shapeOf({ generated: false, item_count: 0, after_text: null }), 'static')
  assert.equal(shapeOf({ generated: true, list: null, item_count: 3, after_text: 'AWS | SQL | Python' }), 'pipe')
  assert.equal(shapeOf({ generated: true, list: null, item_count: 1, after_text: 'A single sentence.' }), 'prose')
})

// ── the structural reason the bug shipped ───────────────────────────────────────────────────────

test('the logic module stays loadable by the test runner (no React, no JSX)', () => {
  const code = stripComments(src('../src/assetBlocks.js'))
  assert.ok(!/from\s+['"]react['"]/.test(code), 'importing React would put this back out of reach of node --test')
  assert.ok(!/<[A-Z][A-Za-z]*[\s/>]/.test(code), 'JSX in this file would do the same')
})

test('the component does not keep a second copy of the item split', () => {
  const code = stripComments(src('../src/screens/AssetBlocks.jsx'))
  assert.match(code, /from '\.\.\/assetBlocks\.js'/, 'the component must render from the tested module')
  assert.ok(!/splitItems\s*\(/.test(code), 'a re-split in the component is exactly how the count drifted')
  assert.ok(!/\.split\(\/\\r\?\\n/.test(code), 'and so is a re-implementation of the regex')
})

// ── packet-level provenance (decision 9) ────────────────────────────────────────────────────────

const SWAP = {
  list: 'skills_1', action: 'swapped', driver: 'posting',
  from_label: 'Led roadmap work', to_label: 'Owned the integrated product roadmap',
  rationale: 'the posting asks for roadmap ownership',
}
const LIST_ROW = { generated: true, list: 'skills_1', item_count: 2, after_text: 'Owned the integrated product roadmap\nRan the intake process' }

test('a swap is marked as the packet-level decision it is', () => {
  const m = listBodyModel(LIST_ROW, [SWAP], { artifactId: 'art-resume', listOwners: {} })
  const matched = m.lines.find((l) => l.swap)
  assert.ok(matched, 'the swap must line up with the item it produced')
  assert.equal(matched.sharedSource, true)
  assert.equal(matched.from, 'Led roadmap work')
  assert.equal(matched.status, 'swapped · posting')
  assert.equal(m.lines.find((l) => !l.swap).sharedSource, false, 'a line with no swap row claims nothing')
  assert.match(m.sharedNote, /^Packet-level decision/)
})

test('when a sibling asset renders the same list, the note names it', () => {
  const listOwners = {
    skills_1: [{ id: 'art-resume', label: 'Resume' }, { id: 'art-compact', label: 'Compact resume' }],
  }
  const onResume = listBodyModel(LIST_ROW, [SWAP], { artifactId: 'art-resume', listOwners })
  assert.match(onResume.sharedNote, /Compact resume/)
  assert.ok(!onResume.sharedNote.includes('Resume,'), 'a card never cross-references itself')

  const onCompact = listBodyModel(LIST_ROW, [SWAP], { artifactId: 'art-compact', listOwners })
  assert.match(onCompact.sharedNote, /\bResume\b/)
  assert.ok(!onCompact.sharedNote.includes('Compact resume'))
})

test('with no sibling known the note still states the scope rather than going silent', () => {
  const note = sharedSourceNote('skills_1', 'art-resume', { skills_1: [{ id: 'art-resume', label: 'Resume' }] })
  assert.match(note, /^Packet-level decision/)
  assert.match(note, /every asset in this packet/)
  assert.equal(sharedSourceNote(null, 'art-resume', {}), null, 'a field with no list has no packet-level swap')
  assert.equal(sharedSourceNote('skills_1', 'art-resume', undefined), sharedSourceNote('skills_1', 'art-resume', {}))
})

test('a field with no swap rows gets no packet-level note', () => {
  const m = listBodyModel(LIST_ROW, [], { artifactId: 'art-resume', listOwners: {} })
  assert.equal(m.sharedNote, null)
})

test('joinLabels reads as a sentence for one, two and many siblings', () => {
  assert.equal(joinLabels(['Compact resume']), 'Compact resume')
  assert.equal(joinLabels(['Compact resume', 'Portfolio']), 'Compact resume and Portfolio')
  assert.equal(joinLabels(['A', 'B', 'C']), 'A, B and C')
  assert.equal(joinLabels([]), '')
})

test('the list-owner registry is stable, so a card reporting the same lists cannot loop', () => {
  const a = registerListOwners({}, 'art-resume', 'Resume', ['skills_1', 'skills_2'])
  assert.deepEqual(Object.keys(a).sort(), ['skills_1', 'skills_2'])
  const b = registerListOwners(a, 'art-resume', 'Resume', ['skills_1', 'skills_2'])
  assert.equal(b, a, 'an unchanged report must return the SAME object or React re-renders forever')
  const c = registerListOwners(a, 'art-compact', 'Compact resume', ['skills_1'])
  assert.notEqual(c, a)
  assert.equal(c.skills_1.length, 2)
  assert.equal(c.skills_2.length, 1)
  // An asset that stops rendering a list stops being cited by it.
  const d = registerListOwners(c, 'art-resume', 'Resume', ['skills_1'])
  assert.deepEqual(d.skills_2, [])
  assert.deepEqual(d.skills_1.map((o) => o.id).sort(), ['art-compact', 'art-resume'])
  assert.equal(registerListOwners({}, null, 'X', ['skills_1']).skills_1, undefined)
})

// ── the meter ───────────────────────────────────────────────────────────────────────────────────

const METER_ROWS = [{ requirement_id: 'r1' }, { requirement_id: 'r1' }, { requirement_id: null }]

test('an unmeasurable stat is stated as unknown, never rendered as a zero', () => {
  // Live ground truth: term_library_entry has no published scoreable rows, and no per-asset
  // term-placement endpoint exists. Absent is not zero, and it must not LOOK like zero.
  const { stats, notes } = meterModel({ rows: METER_ROWS, filled: 5, unfilled: 2, requirements: { total: 8 }, scopedSwaps: [] })
  assert.ok(!stats.some((s) => s.key === 'terms'), 'no terms stat without a source')
  assert.ok(notes.includes(UNKNOWN_TERMS_NOTE), 'but the reader is told it was not measured')
  assert.match(UNKNOWN_TERMS_NOTE, /unknown/)
  for (const note of notes) {
    assert.ok(!/\d/.test(note), `an unknown-stat note must carry no number: ${note}`)
    assert.ok(!/0 of 0|0%/.test(note))
  }
})

test('the terms stat appears the moment a real source exists', () => {
  const { stats, notes } = meterModel({
    rows: METER_ROWS, filled: 5, unfilled: 2, requirements: { total: 8 }, scopedSwaps: [],
    terms: { placed: 9, total: 24 },
  })
  const terms = stats.find((s) => s.key === 'terms')
  assert.deepEqual({ n: terms.n, d: terms.d }, { n: 9, d: 24 })
  assert.ok(!notes.includes(UNKNOWN_TERMS_NOTE))
})

test('no stat ever reaches the meter with a zero denominator', () => {
  const cases = [
    { rows: [], filled: 0, unfilled: 0, requirements: null, scopedSwaps: [] },
    { rows: METER_ROWS, filled: 0, unfilled: 0, requirements: { total: 0 }, scopedSwaps: [] },
    { rows: METER_ROWS, filled: 3, unfilled: 4, requirements: { total: 'nope' }, scopedSwaps: [] },
    { rows: METER_ROWS, filled: 3, unfilled: 4, requirements: { total: 8 }, scopedSwaps: [{ action: 'kept', driver: 'rule' }] },
  ]
  for (const input of cases) {
    for (const s of meterModel(input).stats) {
      assert.ok(s.d > 0, `${s.key} reached the meter with d=${s.d}`)
      assert.ok(Number.isFinite(s.n))
    }
  }
})

test('a posting with zero requirement rows reads as unmeasured, not as a zero score', () => {
  for (const requirements of [null, { total: 0 }, { total: null }, {}]) {
    const { stats, notes } = meterModel({ rows: METER_ROWS, filled: 1, unfilled: 1, requirements, scopedSwaps: [] })
    assert.ok(!stats.some((s) => s.key === 'lines'), `total=${JSON.stringify(requirements)} must not produce a stat`)
    assert.ok(notes.includes(UNKNOWN_REQS_NOTE))
  }
})

test('the placed-lines stat counts distinct requirement rows, not rows that cite them', () => {
  const { stats } = meterModel({ rows: METER_ROWS, filled: 2, unfilled: 1, requirements: { total: 8 }, scopedSwaps: [] })
  const lines = stats.find((s) => s.key === 'lines')
  assert.deepEqual({ n: lines.n, d: lines.d }, { n: 1, d: 8 })
})

test('the posting-driven stat counts only changes, and only against changes', () => {
  const swaps = [
    { action: 'swapped', driver: 'posting' },
    { action: 'added', driver: 'unattributed' },
    { action: 'kept', driver: 'posting' },
    { action: 'dropped', driver: 'rule' },
  ]
  const driven = meterModel({ rows: [], filled: 0, unfilled: 0, requirements: null, scopedSwaps: swaps })
    .stats.find((s) => s.key === 'driven')
  assert.deepEqual({ n: driven.n, d: driven.d }, { n: 1, d: 2 })
})

test('the fields stat pluralises its subtitle off the real number', () => {
  const one = meterModel({ rows: [], filled: 6, unfilled: 1, requirements: null, scopedSwaps: [] }).stats.find((s) => s.key === 'fields')
  assert.equal(one.sub, '1 static template field')
  const many = meterModel({ rows: [], filled: 5, unfilled: 2, requirements: null, scopedSwaps: [] }).stats.find((s) => s.key === 'fields')
  assert.equal(many.sub, '2 static template fields')
})

test('statPct never divides by zero', () => {
  assert.equal(statPct(1, 4), 25)
  assert.equal(statPct(3, 3), 100)
  assert.equal(statPct(1, 0), 0)
})

// ── the insertions x swaps x requirements join ──────────────────────────────────────────────────

test('only the latest loop is drawn; earlier loops are the before-text behind it', () => {
  const data = {
    loop: 1,
    insertions: [
      { merge_field: 'A', loop: 0 }, { merge_field: 'B', loop: 0 },
      { merge_field: 'A', loop: 1 },
    ],
  }
  assert.deepEqual(latestRows(data).map((r) => r.merge_field), ['A'])
  assert.deepEqual(latestRows({ loop: 0, insertions: [] }), [])
  assert.deepEqual(latestRows(null), [])
})

test('swaps are scoped to the lists this asset actually renders', () => {
  const rows = [{ list: 'skills_1' }, { list: null }, { list: 'relevant_1' }]
  const lists = listsOf(rows)
  assert.deepEqual([...lists].sort(), ['relevant_1', 'skills_1'])
  const all = [{ list: 'skills_1' }, { list: 'skills_2' }, { list: 'relevant_1' }]
  assert.deepEqual(scopeSwaps(all, lists).map((s) => s.list), ['skills_1', 'relevant_1'])
  assert.deepEqual(scopeSwaps(all, new Set()), [])
})

test('a block cites its own requirement plus the ones its list swaps name, deduped and in order', () => {
  const reqById = new Map([
    ['r1', { id: 'r1', seq: 4 }],
    ['r2', { id: 'r2', seq: 1 }],
  ])
  const swaps = [
    { list: 'skills_1', requirement_id: 'r2' },
    { list: 'skills_1', requirement_id: 'r1' },   // duplicate of the row's own
    { list: 'skills_2', requirement_id: 'r9' },   // another list
    { list: 'skills_1', requirement_id: 'gone' }, // not in the requirement map
  ]
  const row = { list: 'skills_1', requirement_id: 'r1' }
  assert.deepEqual(reqsForRow(row, swaps, reqById).map((r) => r.id), ['r2', 'r1'], 'sorted by seq, no duplicates')
  assert.deepEqual(reqsForRow({ list: null, requirement_id: null }, swaps, reqById), [])
})

// ── text helpers ────────────────────────────────────────────────────────────────────────────────

test('splitItems matches the separators the API split uses', () => {
  assert.deepEqual(splitItems('- one\n* two\n• three'), ['one', 'two', 'three'])
  assert.deepEqual(splitItems('AWS | SQL | Python'), ['AWS', 'SQL', 'Python'])
  assert.deepEqual(splitItems('   '), [])
  assert.deepEqual(splitItems(null), [])
  // Mirrors the API guard exactly: only null/undefined are empty, so 0 is the string "0".
  assert.deepEqual(splitItems(undefined), [])
  assert.deepEqual(splitItems(0), ['0'])
})

test('normLabel only loosens matching, never identity', () => {
  assert.equal(normLabel('  Owned the   Roadmap. '), 'owned the roadmap')
  assert.equal(normLabel('Owned the roadmap'), normLabel('owned the ROADMAP,'))
  assert.notEqual(normLabel('Owned the roadmap'), normLabel('Owned the backlog'))
})

test('wordCount counts words, not characters or lines', () => {
  assert.equal(wordCount('one two  three\nfour'), 4)
  assert.equal(wordCount('   '), 0)
  assert.equal(wordCount(null), 0)
})

test('expectationFor reads the expectation out of the field name and nowhere else', () => {
  assert.deepEqual(expectationFor('@AboutMe1_50words'), { words: 50, bullets: null })
  assert.deepEqual(expectationFor('@CoreAccomplishments_5blts_180words'), { words: 180, bullets: 5 })
  assert.equal(expectationFor('SkillsBullets1'), null)
  assert.equal(expectationFor(null), null)
})

test('draftSizeText omits bullets when the field name never asked for them', () => {
  const row = { generated: true, item_count: 3, after_text: 'a b c\nd e' }
  assert.equal(draftSizeText(row, { words: 50, bullets: null }), '5 words')
  assert.equal(draftSizeText(row, { words: null, bullets: 4 }), '3 bullets, 5 words')
  assert.equal(draftSizeText(row, null), null)
})

// ── P8.7: the blocks card is selectable by CSS, and the two disclosures stay opposite ───────────
import { ASSET_ANSWERS_DEFAULT_OPEN, BLOCK_HOOKS, correctionsForField, orderFields, targetFor } from '../src/assetBlocks.js'
import { ASSET_BODY_DEFAULT_OPEN, PACKET_HOOKS } from '../src/packetBuilder.js'

const BLOCKS_SRC = src('../src/screens/AssetBlocks.jsx')
const PACKET_SRC = src('../src/screens/PacketBuilder.jsx')
const SHELL_SRC = src('../src/shell.jsx')

test('every BLOCK_HOOKS selector is rendered, and the card hand-types none of them', () => {
  for (const [name, value] of Object.entries(BLOCK_HOOKS)) {
    assert.ok(BLOCKS_SRC.includes('BLOCK_HOOKS.' + name),
      `BLOCK_HOOKS.${name} ("${value}") is declared but never rendered`)
  }
  const stripped = stripComments(BLOCKS_SRC)
  for (const value of Object.values(BLOCK_HOOKS)) {
    assert.ok(!new RegExp(`data-qc=["']${value}["']`).test(stripped),
      `data-qc="${value}" is hand-typed — it must come from BLOCK_HOOKS`)
  }
  const values = Object.values(BLOCK_HOOKS)
  assert.equal(new Set(values).size, values.length)
})

test('H:the-draft-is-visible-on-load: the artifact BODY and the field BLOCK both default open', () => {
  // REPLACES 'the asset HEADER defaults collapsed and the field BLOCK defaults open'. That test
  // asserted ASSET_HEADER_DEFAULT_OPEN === false, citing P8.7 "asset headers are collapsed by
  // default". P8.7 is right and was applied to the WRONG OBJECT - the old comment in
  // packetBuilder.js even named that as the mistake it was guarding, but it pinned the value, not
  // the meaning, so the guard passed green on the defect.
  //
  // Ground truth, from RENDERING the prototype rather than reading the plan (scripts/render-spec.mjs):
  // `qc/assets.jsx` AssetHeader() is the "What this resume answers" counters panel, with its own
  // useState(false), sitting INSIDE the card above the fields. screens/INDEX.md 09 captions it
  // "Artifact card header, gate badge, doc buttons, collapsed asset header" - card open, panel shut.
  //
  // Measured cost on production 2026-08-23: #/packet/2cb56fb3.../resume rendered bodyLen 850 with
  // NO blocks panel in the DOM, against 6379 for the same packet's QC step. The draft was invisible.
  assert.equal(ASSET_BODY_DEFAULT_OPEN, true,
    'the draft is the point of the screen - it must not be behind an undocumented click')

  const packet = stripComments(PACKET_SRC)
  assert.match(packet, /useState\(ASSET_BODY_DEFAULT_OPEN\)/,
    'the card body must seed its state from the named default, not from a bare literal')
  assert.match(packet, /data-qc=\{PACKET_HOOKS\.assetHeader\}[\s\S]{0,200}data-qc-open=/,
    'the disclosure must publish its open state, or the default is unprovable on the live site')

  const blocks = stripComments(BLOCKS_SRC)
  assert.match(blocks, /defaultOpen = true/, 'the field block must still default OPEN')
  assert.match(blocks, /useState\(defaultOpen\)/)
  assert.match(blocks, /data-qc=\{BLOCK_HOOKS\.root\}[\s\S]{0,160}data-qc-open=/,
    'the block must publish its open state too, so the pair can be read off the DOM at once')
})

test('collapsing the header hides the asset BODY, not just its label', () => {
  // A disclosure that reports data-qc-open="0" while still rendering everything underneath is a
  // lie the attribute makes look verified.
  const packet = stripComments(PACKET_SRC)
  assert.match(packet, /\{open && \([\s\S]{0,200}data-qc=\{PACKET_HOOKS\.assetBody\}/,
    'the body must be rendered conditionally on the header state')
})

// ── inline change log (P8.6, the design's two surfaces) ──────────────────────────────────────────

/**
 * H:corrections-render-beside-the-field
 *
 * The design puts a correction in TWO places and the app only had one of them. Confirmed by
 * rendering the prototype 2026-08-23: step 2 Resume shows 8 inline "Corrected for you" cards in the
 * field margin, while step 6 QC shows the same rows rolled up as "Done for you". The app rendered
 * them ONLY in the QC step, so the owner had to leave the draft to find out why a figure changed -
 * the exact complaint that produced this work.
 *
 * Asserts the invariant, not the incident: the field margin reaches the change log THROUGH the
 * shared selector and renders the SHARED row component. A second, private correction row in
 * AssetBlocks would satisfy "something renders inline" while re-introducing the two-definitions bug
 * that `corrections.test.mjs` exists to prevent.
 */
test('H:corrections-render-beside-the-field: the field margin renders the shared row from the selector', () => {
  const src = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url).pathname, 'utf8')

  // The invariant is WHERE `railChangeLog` comes from, not that it is the only thing imported from
  // there. The original regex pinned the whole brace, so adding `offendersByField` alongside it -
  // another selector from the same module, which is exactly what this rule wants - failed the test.
  // A guard that fires on the behaviour it is asking for is the cry-wolf failure hardening rule 2
  // forbids, so it now matches the NAME inside the import rather than the brace's exact contents.
  assert.match(src, /import\s*\{[^}]*\brailChangeLog\b[^}]*\}\s*from\s*['"]\.\.\/qcRail\.js['"]/,
    'the inline log must come from the rail selector, not from a second derivation')
  assert.match(src, /import\s*\{\s*CorrectionRow\s*\}\s*from\s*['"]\.\/QcRail\.jsx['"]/,
    'the inline row must BE the QC row - two renderings of one correction is the bug')
  assert.match(src, /<CorrectionRow\b[^>]*\binField\b/,
    'rendered inside the field it corrects, so it does not restate the field name')
  assert.match(src, /Corrected for you/,
    "the design's own words for the inline group")
  assert.ok(!/\.slice\(0,\s*\d+\)/.test(src.slice(src.indexOf('Corrected for you') - 400, src.indexOf('Corrected for you') + 400)),
    'no cap on how many corrections a field may show')
})

test('H:corrections-render-beside-the-field: field scoping is an id match, never a substring', () => {
  const rows = [
    { key: 'a', merge_field: 'Summary' },
    { key: 'b', merge_field: 'SummaryExtra' },
    { key: 'c', merge_field: 'Relevant1' },
  ]
  assert.deepEqual(correctionsForField(rows, 'Summary').map((r) => r.key), ['a'],
    'SummaryExtra must NOT leak into Summary - a merge field name is an identifier')
  assert.deepEqual(correctionsForField(rows, '').map((r) => r.key), [])
  assert.deepEqual(correctionsForField(null, 'Summary'), [])
})

// ── visual alignment to the prototype ────────────────────────────────────────────────────────────

/**
 * H:the-draft-reads-in-document-order
 *
 * `appInsertions.ts:81` returns `order by i.loop, i.merge_field` - ALPHABETICALLY. On the resume
 * that opens the screen on `ExpertiseBullets` and buries `ResumeSummary` fourth. The prototype
 * opens on the summary. Owner, 2026-08-23: "why is it rendering out of order vs the prototype with
 * experience at the top instead of resume summary?"
 *
 * Measured by rendering both sides that day:
 *   prototype  Resume summary -> Skills 1 -> Skills 2 -> Relevant 1-3 -> Work experience
 *   app        ExpertiseBullets -> RelevantBullets1 -> 2 -> 3 -> ResumeSummary -> Skills 1 -> 2
 *
 * Asserts the invariant, not the incident: the summary leads, skills precede relevant, and the
 * order is NOT the alphabetical one the API hands over. An unlisted field keeps its position and
 * lands last, so a new template field appears at the end rather than jumping to the top.
 */
test('H:the-draft-reads-in-document-order: the summary leads and the order is not alphabetical', () => {
  const shuffled = [
    { merge_field: 'ExpertiseBullets' }, { merge_field: 'RelevantBullets1' },
    { merge_field: 'RelevantBullets2' }, { merge_field: 'RelevantBullets3' },
    { merge_field: 'ResumeSummary' }, { merge_field: 'SkillsBullets1' },
    { merge_field: 'SkillsBullets2' },
  ]
  const got = orderFields(shuffled).map((r) => r.merge_field)
  assert.deepEqual(got, [
    'ResumeSummary', 'SkillsBullets1', 'SkillsBullets2',
    'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3', 'ExpertiseBullets',
  ], 'the resume must read in the prototype order')

  const alphabetical = [...shuffled].map((r) => r.merge_field).sort()
  assert.notDeepEqual(got, alphabetical, 'alphabetical is what the API returns and what looked wrong')

  // Unknown fields: stable, and after the known ones - never dropped, never promoted.
  const withNew = orderFields([{ merge_field: 'ZNewField' }, { merge_field: 'ResumeSummary' }, { merge_field: 'ANewField' }])
  assert.deepEqual(withNew.map((r) => r.merge_field), ['ResumeSummary', 'ZNewField', 'ANewField'],
    'unlisted fields keep their relative order and sort last')

  // The ordering must be applied where the screen reads its rows, not only in the helper.
  assert.match(stripComments(src('../src/assetBlocks.js')), /return orderFields\(all\.filter\(/,
    'latestRows must return ordered rows, or the sort exists but nothing uses it')
})

/**
 * H:sidenav-starts-collapsed
 *
 * Owner request 2026-08-23: "the left most nav menu needs to be collapsible and collapsed by
 * default." 196px of permanently-parked chrome is 196px the draft, its provenance margin and the
 * posting quotes do not get - and the prototype's three-column JD layout only opens above 1040px.
 *
 * Collapsed must keep the ICONS. A rail you cannot navigate from is not collapsed, it is hidden.
 */
test('H:sidenav-starts-collapsed: default closed, still navigable, and the state persists', () => {
  const s = stripComments(SHELL_SRC)
  assert.match(s, /export const SIDENAV_DEFAULT_OPEN = false/,
    'the nav starts collapsed, and the default is named so a test can hold it')
  assert.match(s, /data-qc="sidenav"[\s\S]{0,120}data-qc-open=/,
    'the nav must publish its open state, or "collapsed by default" is unprovable on the live site')
  assert.match(s, /data-qc="sidenav-toggle"/, 'collapsible means there is a control to do it with')
  assert.match(s, /localStorage\.setItem\(SIDENAV_KEY/, 'the choice is remembered')
  // Icons survive the collapse: the label is conditional, the icon is NOT. Asserting only that the
  // label is conditional cannot catch an icon that also gets hidden - measured, that mutation left
  // the suite green - so the icon's own unconditionality is what is asserted.
  assert.match(s, /\{open && n\.label\}/, 'the LABEL hides when collapsed')
  const iconLine = (s.match(/<span style=\{\{ width: 16[^\n]*\{n\.icon\}<\/span>/) || [''])[0]
  assert.ok(iconLine, 'the nav icon must still be rendered')
  assert.ok(!/\{open &&\s*$/.test(s.slice(0, s.indexOf(iconLine)).trimEnd()),
    'the icon must NOT be behind `open &&` - a rail you cannot navigate from is hidden, not collapsed')
})

/**
 * H:the-answers-panel-is-what-p8.7-collapses
 *
 * P8.7 says "asset headers are collapsed by default". In the design an ASSET HEADER is the
 * "What this resume answers" counters panel INSIDE the card - `qc/assets.jsx` AssetHeader carries
 * its own `React.useState(false)`, and screens/INDEX.md 09 captions the card "Artifact card header
 * ... collapsed asset header" with 10 showing it expanded.
 *
 * The app had applied that instruction to the whole artifact card, which hid the DRAFT (see
 * ASSET_BODY_DEFAULT_OPEN, measured: the live resume step rendered 850 chars and no blocks panel).
 * Both halves now sit on the objects P8.7 was written about: the card body OPENS, this panel CLOSES.
 * Asserting them together is the point - a fix that flips the wrong one fails here either way.
 *
 * Owner, 2026-08-23: "things that are supposed to be collapsed are collapsed and you missed that
 * (ie the what this resume answers section that still looks different)".
 */
test('H:the-answers-panel-is-what-p8.7-collapses: closed by default, summary still readable', () => {
  assert.equal(ASSET_ANSWERS_DEFAULT_OPEN, false, 'P8.7 applies to THIS panel')
  assert.equal(ASSET_BODY_DEFAULT_OPEN, true, 'and never to the card body - that hid the draft')

  const s = stripComments(BLOCKS_SRC)
  assert.match(s, /useState\(ASSET_ANSWERS_DEFAULT_OPEN\)/,
    'seeded from the named default, not a bare literal')
  assert.match(s, /What this \{label \|\| 'asset'\} answers/,
    "named from the reader's side - 'What is in this asset' describes a data structure")
  assert.match(s, /data-qc=\{BLOCK_HOOKS\.meter\}[\s\S]{0,160}data-qc-open=/,
    'publishes its state, or "collapsed by default" is unprovable on the live site')
  assert.match(s, /data-qc=\{BLOCK_HOOKS\.meterToggle\}/, 'collapsible needs a control')

  // The counts stay on the CLOSED row. A disclosure that hides its own summary makes you open it
  // to discover whether opening it was worth it.
  assert.match(s, /!open && stats\.map/, 'the summary renders while collapsed')
  assert.match(s, /data-qc=\{BLOCK_HOOKS\.meterSummary\}/, 'and is addressable for verification')
})

/**
 * H:a-field-states-the-rule-it-is-held-to
 *
 * The prototype prints every field's target beside its measurement - "longest 22 chars <= 24 chars
 * each", "0 over 20 chars, max 1 item over 20 chars", "6 x 5 words, exactly 5 words". The app
 * printed the measurement alone, which cannot tell a reader whether 20 words is fine.
 *
 * THE NUMBER MUST BE THE OWNER'S, NOT A LITERAL. These are settings (chk_skill_max_chars,
 * chk_relevant_max_chars, chk_expertise_words), reachable in Settings, and the owner was explicit:
 * "all such rule numbers need to be available for tweaking in the settings/config". A literal in the
 * UI would promise "<= 24 chars" while the gate enforced 30 - a screen lying about the rule it is
 * reporting, which is worse than a screen that says nothing.
 */
test('H:a-field-states-the-rule-it-is-held-to: the target comes from the thresholds, never a literal', () => {
  const t = { skillMaxChars: 24, relevantMaxChars: 20, relevantOverLimitAllowance: 1, expertiseWords: 5 }
  assert.equal(targetFor('SkillsBullets1', t), '≤ 24 chars each')
  assert.equal(targetFor('RelevantBullets2', t), 'max 1 item over 20 chars')
  assert.equal(targetFor('ExpertiseBullets', t), 'exactly 5 words each')

  // THE POINT: change the setting, change the promise. If this still says 24 the UI is hardcoded.
  const raised = targetFor('SkillsBullets1', { ...t, skillMaxChars: 30 })
  assert.equal(raised, '≤ 30 chars each', 'the screen must follow the setting the owner chose')
  assert.ok(!raised.includes('24'), 'a literal 24 would survive the owner raising the limit')

  // No thresholds, no target - never a default. A contract stated from a guess is a promise the
  // gate has not agreed to.
  assert.equal(targetFor('SkillsBullets1', null), null)
  assert.equal(targetFor('SkillsBullets1', {}), null)
  assert.equal(targetFor('ResumeSummary', t), null, 'no source for a summary word target - say nothing')

  // The screen must go through it rather than composing its own sentence.
  const blocks = stripComments(BLOCKS_SRC)
  assert.match(blocks, /targetFor\(row\.merge_field, thresholds\)/, 'the field reads the shared derivation')
  assert.ok(!/\b(?:24|20)\s*chars\b/.test(blocks), 'no threshold literal may appear in the rendering')
})

/**
 * H:the-field-carries-its-own-controls
 *
 * screens/INDEX.md 11 shows the resume summary with "Show original   Ask for a change" directly
 * under the text, in the same position on every field. The app had "Compare with original" (its own
 * phrasing for the same act) and offered "Ask for a change" only from the QC step - so requesting a
 * change meant leaving the sentence you wanted changed, which is the argument this whole screen
 * exists to make.
 *
 * NOT A SECOND EDIT PATH. It posts to `aiEditArtifact` with `section`, the same field-scoped route
 * QcRail's correction row uses. Two ways to ask for one change is how the two disagree about what
 * was asked.
 */
test('H:the-field-carries-its-own-controls: Show original and a field-scoped Ask for a change', () => {
  const s = stripComments(BLOCKS_SRC)

  assert.match(s, /'Hide original' : 'Show original'/, "the design's wording, paired with its inverse")
  assert.ok(!/Compare with original/.test(s), 'the old phrasing must be gone, not merely joined')

  assert.match(s, /data-qc=\{BLOCK_HOOKS\.askChange\}[\s\S]{0,120}data-qc-field=/,
    'the ask is addressable AND names the field it is scoped to')
  assert.match(s, /aiEditArtifact\(artifactId, \{ instruction: ask\.trim\(\), section: row\.merge_field \}\)/,
    'the SAME field-scoped route the QC correction row uses - never a second edit path')

  // The cost has to be stated BEFORE sending: rewriting a field makes every undo on it refuse.
  assert.match(s, /can no longer be undone/,
    'say what the rewrite costs before it is sent, not after')

  // A static template block is not generated text and cannot be rewritten - no dead control.
  assert.match(s, /\{!isStatic && artifactId && \(/, 'no ask on a static template block')
})

/**
 * H:a-field-is-named-the-way-the-document-names-it
 *
 * The design heads each block with the field's human name and keeps the raw merge field beside it
 * as a small mono tag (screens/INDEX.md 11: "Resume summary … ResumeSummary"). The app printed only
 * the identifier - `SkillsBullets1` - which names a template slot, not a part of a resume.
 *
 * BOTH are rendered on purpose. The name is what the reader recognises; the slot is what ties the
 * block to the template it fills and to every check that reports against `merge_field`. Dropping
 * the slot would make a finding that names SkillsBullets1 unlocatable on screen.
 *
 * ONE table (`FIELD_LABEL`), so the block heading, the QC correction sentence, the gate drawer and
 * the deep-link tooltip cannot drift into four vocabularies for one field.
 */
test('H:a-field-is-named-the-way-the-document-names-it: human name heads it, slot stays beside it', () => {
  const s = stripComments(BLOCKS_SRC)
  assert.match(s, /fontWeight: 600 \}\}>\{fieldLabel\(row\.merge_field\)\}/,
    'the heading is the human name, resolved through the shared table')
  assert.match(s, /data-qc=\{BLOCK_HOOKS\.fieldSlot\}[\s\S]{0,200}\{row\.merge_field\}/,
    'and the raw slot is still rendered, or a finding naming it cannot be found on screen')
  assert.ok(!/fontWeight: 600 \}\}>\{row\.merge_field\}/.test(s),
    'the identifier must not be the heading')
})

/**
 * H:the-threshold-beats-the-field-name
 *
 * Some merge fields bake a size into their NAME - `@AboutMe1_50words`,
 * `@CoreAccomplishments_5blts_180words`. The checks engine holds a different number for the same
 * field: `aboutMe1Words [45, 48]`, `coreAccomplishmentsWords [98, 125]`. Two owners of one number,
 * disagreeing silently, and a 50-word draft of `@AboutMe1_50words` satisfies its own name while
 * FAILING the gate.
 *
 * The design settles it, and rendering the prototype is what surfaced the answer: it heads those
 * fields "48 words · 45-48 words" and "254 words · 250-400 words" - the THRESHOLDS. The number in
 * the name is stale. So the threshold is displayed and the name-derived expectation is suppressed
 * wherever a threshold exists, because two different targets beside one measurement is worse than
 * either alone.
 */
test('H:the-threshold-beats-the-field-name: ranges come from thresholds, not from the name', () => {
  const t = { coverWords: [250, 400], aboutMe1Words: [45, 48], aboutMe2Words: [75, 80],
              execProfileWords: [50, 55], coreAccomplishmentsWords: [98, 125] }

  assert.equal(targetFor('@AboutMe1_50words', t), '45–48 words',
    'the NAME says 50; the gate says 45-48; the gate is what is shown')
  assert.equal(targetFor('@CoreAccomplishments_5blts_180words', t), '98–125 words',
    'the name says 180 - nowhere near what is enforced')
  assert.equal(targetFor('@CoverLetterBody', t), '250–400 words')
  assert.equal(targetFor('@ExecutiveProfile_55words', t), '50–55 words')

  // Never a half-range, and never a number pulled out of the name as a fallback.
  assert.equal(targetFor('@AboutMe1_50words', { aboutMe1Words: [45] }), null)
  assert.equal(targetFor('@AboutMe1_50words', {}), null)
  assert.ok(!/50 words/.test(String(targetFor('@AboutMe1_50words', t))),
    'the stale name number must never appear')

  // And the name-derived expectation must not render beside a threshold target.
  assert.match(stripComments(BLOCKS_SRC), /\{expect && !target && \(/,
    'two different targets beside one measurement is worse than either alone')
})

test('H:observed-matches-rule-unit: the measurement is stated in the unit its rule tests', () => {
  // The card printed "{count} lines - {words} words" for EVERY field regardless of its rule, so a
  // skills list read "10 lines - 20 words - <= 24 chars each" - a word count beside a character
  // limit. The two halves did not answer each other, so the line could not tell the reader whether
  // the field passed. Seen on the live production screenshot 2026-08-23, not inferred.
  const T = { skillMaxChars: 24, relevantMaxChars: 20, relevantOverLimitAllowance: 1,
              expertiseWords: 5, coverWords: [250, 400] }
  const row = (txt) => ({ after_text: txt, generated: true })

  // Each pair must share a unit. Asserted as a PAIR because either string alone is unfalsifiable.
  const pairs = [
    ['SkillsBullets1', row('Enterprise Architecture\nSoftware Development'), /chars/],
    ['RelevantBullets1', row('short\nthis one is definitely over twenty chars'), /chars/],
    ['ExpertiseBullets', row('one two three four five\nsix seven eight nine ten'), /words/],
    ['@CoverLetterBody', row('a b c d e'), /words/],
  ]
  for (const [field, r, unit] of pairs) {
    const o = observedFor(field, r, T)
    const t = targetFor(field, T)
    assert.ok(o, 'no measurement for ' + field)
    assert.match(o, unit, field + ' measured in the wrong unit: ' + o)
    assert.match(t, unit, field + ' target in the wrong unit: ' + t)
  }

  // Real values, so a branch that returns a plausible-shaped wrong number is caught.
  assert.equal(observedFor('SkillsBullets1', row('Enterprise Architecture\nSoftware Development'), T), 'longest 23 chars')
  assert.equal(observedFor('RelevantBullets1', row('short\nthis one is definitely over twenty chars'), T), '1 over 20 chars')

  // A NON-uniform expertise list must not claim uniformity - "6 x 5 words" asserts every phrase is
  // 5 words, which is the exact thing the rule tests, so a false one would be worse than silence.
  assert.equal(observedFor('ExpertiseBullets', row('one two three four five\nsix seven eight nine ten'), T), '2 × 5 words')
  assert.equal(observedFor('ExpertiseBullets', row('one two three four five\nsix seven'), T), '2 phrases, 2–5 words')

  // Null wherever targetFor is null - an unruled field keeps the old lines/words line.
  for (const field of ['ResumeSummary', '@Company', 'NotAField']) {
    assert.equal(observedFor(field, row('a b c'), T), null, field + ' invented a rule it has none for')
    assert.equal(targetFor(field, T), null, field + ' - the pair must agree about having no rule')
  }
  assert.equal(observedFor('SkillsBullets1', row(''), T), null, 'no items means nothing to measure')
  assert.equal(observedFor('SkillsBullets1', row('x'), {}), null, 'no threshold means no stated rule')

  // ONE map behind both, or the pair drifts about which fields even have a band.
  const src = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  assert.equal((src.match(/const RANGE = \{/g) || []).length, 1, 'RANGE is defined more than once')
})

test('H:click-targets-are-controls: an onClick span carries a role and a keyboard path', () => {
  // Five click targets shipped as bare <span onClick>: "Copy tracked link", "Build entire packet",
  // per-field "Ask for a change", "Show/Hide original", "Show/Hide blocks". No role, no tabIndex,
  // no key handler - unreachable by keyboard and announced as text. It also made them invisible to
  // compare-ui.mjs, which collects `button, [role="button"], a`, so controls that had existed since
  // P8.6 were being reported as prototype-only.
  //
  // THE TAG IS PARSED, NOT REGEXED. A JSX opening tag contains `=>` inside its handlers, so any
  // /<span[^>]*>/ stops at the arrow and reports a correctly-fixed element as broken - this guard
  // did exactly that on its first run, on all three elements it had just fixed. Walking to the
  // first `>` at brace depth 0 is the only way to see the whole tag.
  const openTags = (src, tag) => {
    const out = []
    for (let i = src.indexOf('<' + tag); i > -1; i = src.indexOf('<' + tag, i + 1)) {
      let depth = 0
      for (let j = i; j < src.length; j++) {
        const c = src[j]
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) { out.push(src.slice(i, j + 1)); break }
      }
    }
    return out
  }

  const files = ['../src/screens/AssetBlocks.jsx', '../src/screens/PacketBuilder.jsx', '../src/screens/QcRail.jsx']
  let checked = 0
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const tag of openTags(src, 'span')) {
      if (!/\bonClick=/.test(tag)) continue
      checked++
      const where = rel + ':\n' + tag.slice(0, 240)
      assert.match(tag, /role="button"/, 'clickable span with no role - no keyboard path, reads as text:\n' + where)
      assert.match(tag, /tabIndex=\{[^}]*0[^}]*\}|tabIndex=\{?0\}?/, 'clickable span that cannot be focused:\n' + where)
      assert.match(tag, /onKeyDown=/, 'clickable span with no Enter/Space handler:\n' + where)
    }
  }
  // A guard that inspected nothing would pass silently - that is the vacuous-green failure this
  // repo already shipped once. Assert it actually found the elements it exists to police.
  assert.ok(checked >= 5, 'expected at least 5 clickable spans across the three screens, saw ' + checked)
})

test('H:corrected-count-never-invents-zero: an unmeasured change log prints no number', () => {
  // `correctionsState` returns `count: null` for every payload it could not measure - unchecked,
  // absent, malformed. Rendering that as "0 corrected" is the reviewer's "0 disagreements" bug:
  // a measurement reported that was never taken, and the reader cannot tell it from a real zero.
  const base = { rows: [], filled: 1, unfilled: 0, requirements: { total: 2 }, scopedSwaps: [] }

  assert.equal(meterModel({ ...base, corrected: null }).corrected, null, 'null is not a count')
  assert.equal(meterModel({ ...base }).corrected, null, 'a caller that passes nothing measured nothing')
  assert.equal(meterModel({ ...base, corrected: undefined }).corrected, null)
  // Not a number is not a number, however it arrives.
  assert.equal(meterModel({ ...base, corrected: NaN }).corrected, null)
  assert.equal(meterModel({ ...base, corrected: 'four' }).corrected, null)

  // A measured zero is real, and still shows nothing: the prototype does not print it, and
  // "nothing was corrected" is not news beside the counts. It must not print "0" either.
  assert.equal(meterModel({ ...base, corrected: 0 }).corrected, null)

  // A measured count passes through untouched.
  assert.equal(meterModel({ ...base, corrected: 4 }).corrected, 4)
})

test('H:corrected-count-comes-from-the-server: not a re-count of the rows in the browser', () => {
  const code = stripComments(BLOCKS_SRC)
  // `count` excludes rows the reader undid; `rows.length` does not. A screen that counted the rows
  // itself would keep showing an undone correction in its total.
  assert.match(code, /correctedCount: state \? state\.log\.count : null/,
    'the corrected count must be the server-measured `count`, not a length')
  assert.match(code, /corrected=\{correctedCount\}/, 'the meter never receives the count')
  assert.match(code, /data-qc=\{BLOCK_HOOKS\.meterCorrected\}/, 'the count is computed but never rendered')

  // THE NEGATIVE ASSERTION WAS PINNED TO ONE SPELLING AND WAS THEREFORE INERT. It forbade exactly
  // `corrected={correctionRows.length}` — so the independent verifier's M10, which keeps
  // `corrected={correctedCount}` and instead re-derives the VARIABLE
  // (`const correctedCount = correctionRows ? correctionRows.length : null`), sailed through at
  // 240/240 while the meter rendered "3 corrected" for 2 corrections and 1 undone one. A wrong
  // number shown to the owner, with a green suite.
  //
  // The fix is to pin the SOURCE rather than to forbid one wording: `correctedCount` may only ever
  // arrive by destructuring the hook. Any re-derivation needs a `const correctedCount =`, `let`, or
  // a rename of the prop — and the prop name is asserted just above, so a rename fails there.
  assert.match(code, /const \{[^}]*\bcorrectedCount\b[^}]*\} = useArtifactCorrections\(/,
    'correctedCount must come from the hook, which reports the server-measured count')
  assert.ok(!/(?:const|let|var)\s+correctedCount\s*=/.test(code),
    're-derived correctedCount in the component - it must come only from the hook destructure, '
    + 'or an undone correction is counted again (verifier mutation M10)')
})

test('H:gap-harness-ignores-leading-glyphs: a decorative prefix is not a different control', () => {
  // The register counted four "missing controls" on the resume step. TWO of them had existed all
  // along: `✓ Open Google Doc ↗` (PacketBuilder.jsx:154) and `⎘ Copy tracked link` (:168, wired to
  // real `api.trackedLink`). The harness matched control text exactly, so the glyph made each read
  // as a different string from the prototype's, and the gap number overstated the work.
  //
  // The fix belongs in the MEASUREMENT: stripping a useful affordance out of the product to satisfy
  // an exact-text matcher would be gaming the number rather than measuring it.
  const src = readFileSync(new URL('../../scripts/compare-ui.mjs', import.meta.url), 'utf8')
  const m = /const GLYPH = (\/[^\n]*\/)\n/.exec(src)
  assert.ok(m, 'compare-ui.mjs no longer normalises leading glyphs')
  // eslint-disable-next-line no-eval
  const GLYPH = eval(m[1])
  const norm = (t) => t.replace(/\s+/g, ' ').trim().replace(GLYPH, '').trim()

  assert.equal(norm('✓ Open Google Doc ↗'), 'Open Google Doc ↗')
  assert.equal(norm('⎘ Copy tracked link'), 'Copy tracked link')

  // A TRAILING arrow survives — the prototype uses it too, and stripping it would collapse two
  // labels that genuinely differ.
  assert.ok(norm('Open Google Doc ↗').endsWith('↗'))
  // Words are never touched, so controls that differ by TEXT stay distinct.
  assert.equal(norm('Show original'), 'Show original')
  assert.notEqual(norm('Show original'), norm('Hide original'))
  // And the strip cannot eat a label whole.
  assert.equal(norm('▸ View draft'), 'View draft')
})

// ── row 9: the per-kind split ───────────────────────────────────────────────────────────────────
//
// The prototype (§10) shows "5/5 must-haves"; the app showed one undifferentiated "Posting lines
// placed". The blocker recorded against this row was an endpoint change, and that was WRONG:
// GET /app/opportunity/{id}/requirements already returns the rows with `kind` on each, alongside
// `total`, and `groupRequirements()` already splits them. This is client derivation over data the
// payload already carried.

const KIND_PAYLOAD = {
  total: 6,
  requirements: [
    { id: 'm1', kind: 'must_have' }, { id: 'm2', kind: 'must_have' },
    { id: 'p1', kind: 'responsibility' }, { id: 'p2', kind: 'responsibility' },
    { id: 'n1', kind: 'nice_to_have' },
    { id: 'x1', kind: null },            // deliberately unclassified — see the total test below
  ],
}

test('the meter splits placed lines by kind, counting only rows this asset cites', () => {
  const rows = [{ requirement_id: 'm1' }, { requirement_id: 'm1' }, { requirement_id: 'p2' }, { requirement_id: null }]
  const { stats } = meterModel({ rows, filled: 5, unfilled: 2, requirements: KIND_PAYLOAD, scopedSwaps: [] })
  const by = (k) => stats.find((s) => s.key === `kind_${k}`)

  assert.deepEqual({ n: by('mustHaves').n, d: by('mustHaves').d }, { n: 1, d: 2 },
    'm1 cited twice is ONE must-have answered, not two')
  assert.deepEqual({ n: by('responsibilities').n, d: by('responsibilities').d }, { n: 1, d: 2 })
  assert.deepEqual({ n: by('niceToHaves').n, d: by('niceToHaves').d }, { n: 0, d: 1 },
    'a kind the asset answers none of is still a real 0/1 — the denominator exists')
})

test('a kind the posting does not use produces no stat, never a 0/0', () => {
  const payload = { total: 2, requirements: [{ id: 'm1', kind: 'must_have' }, { id: 'm2', kind: 'must_have' }] }
  const { stats } = meterModel({ rows: [{ requirement_id: 'm1' }], filled: 1, unfilled: 0, requirements: payload, scopedSwaps: [] })
  assert.ok(stats.find((s) => s.key === 'kind_mustHaves'), 'the kind that exists is reported')
  for (const k of ['responsibilities', 'niceToHaves']) {
    assert.ok(!stats.some((s) => s.key === `kind_${k}`), `${k} has no rows — it must not appear as 0/0`)
  }
  for (const s of stats) assert.ok(s.d > 0, `no stat may carry a zero denominator: ${s.key}`)
})

// THE ONE THAT MATTERS. groupRequirements classifies exactly three kinds, so a row whose kind is
// null or unrecognised belongs to NO group. If the per-kind split had replaced the total, that row
// would vanish from every coverage count on the screen with nothing saying so.
test('the total is not replaced by the sum of the parts, so an unclassified row is never dropped', () => {
  const { stats } = meterModel({
    rows: [{ requirement_id: 'm1' }], filled: 1, unfilled: 0, requirements: KIND_PAYLOAD, scopedSwaps: [],
  })
  const lines = stats.find((s) => s.key === 'lines')
  assert.ok(lines, 'the undifferentiated total must survive alongside the split')
  assert.equal(lines.d, 6, 'the total counts every requirement row, classified or not')

  const partsD = stats.filter((s) => s.key.startsWith('kind_')).reduce((a, s) => a + s.d, 0)
  assert.equal(partsD, 5, 'the three kinds account for five of the six rows')
  assert.ok(partsD < lines.d, 'the parts under-count the total here — which is exactly why the total stays')
})

test('a payload with no requirement rows still yields the total stat and no kind stats', () => {
  const { stats } = meterModel({
    rows: [{ requirement_id: 'm1' }], filled: 1, unfilled: 0, requirements: { total: 4 }, scopedSwaps: [],
  })
  assert.ok(stats.find((s) => s.key === 'lines'), 'total is measured and reported')
  assert.ok(!stats.some((s) => s.key.startsWith('kind_')), 'no rows means no split — not three empty stats')
})

// ── "Show original" — SPEC 4.5 puts it on EVERY field ────────────────────────────────────────────
//
// The defect: the control was gated on `row.before_text`, so a field with no earlier version
// rendered NOTHING and the reader could not tell "unchanged" from "broken" from "first draft".
// Owner, on seeing it: "i dont understand why you would consider it a dead link leaidng me to
// believe if it doesnt have original text now it never will, that is black box and not clear."
//
// The invariant, not the incident: originalState ALWAYS returns a state with a label, and it NEVER
// invents text it does not have. Absent evidence is disclosed, never rendered as a comparison.

test('H:show-original-always: every row yields a labelled state, including one with no earlier version', () => {
  for (const row of [
    { before_text: 'was', after_text: 'now' },
    { before_text: 'same', after_text: 'same' },
    { before_text: null, after_text: 'now' },
    { before_text: '', after_text: 'now' },
    {},
  ]) {
    const st = originalState(row)
    assert.ok(st && typeof st.label === 'string' && st.label.length > 0,
      `every row must produce a non-empty label; got ${JSON.stringify(st)} for ${JSON.stringify(row)}`)
    assert.ok(['changed', 'identical', 'none'].includes(st.kind), `unexpected kind ${st.kind}`)
  }
})

test('H:show-original-no-fabrication: a row with no earlier version renders NO body text and says so', () => {
  for (const row of [{ before_text: null, after_text: 'now' }, { before_text: '', after_text: 'now' }, {}]) {
    const st = originalState(row)
    assert.equal(st.kind, 'none', 'a null or empty before_text is the honest-unknown state')
    assert.equal(st.text, null, 'NEVER fabricate an original — there is none to show')
    assert.equal(st.body, ORIGINAL_NONE_NOTE, 'the reason must be stated, not left blank')
  }
})

test('H:show-original-not-a-false-claim: identical bytes are not headed "before this posting"', () => {
  const st = originalState({ before_text: 'same bytes', after_text: 'same bytes' })
  assert.equal(st.kind, 'identical')
  assert.ok(!/before this posting/i.test(st.label),
    'heading an unchanged field as changed is the false claim ROW 7 was about')
  assert.equal(st.text, 'same bytes', 'the text is still shown so the reader can confirm it')
})

test('H:show-original-changed: a real earlier version is shown under the changed heading', () => {
  const st = originalState({ before_text: 'the old paragraph', after_text: 'the new paragraph' })
  assert.equal(st.kind, 'changed')
  assert.equal(st.text, 'the old paragraph')
  assert.match(st.label, /before this posting/i)
})

// STRUCTURAL: the control must not be re-gated on before_text. A runtime test cannot see JSX, and
// re-adding `{row.before_text && (` around the toggle is exactly how this regresses — it reads like
// a tidy-up.
test('H:show-original-ungated: the toggle in AssetBlocks.jsx is not wrapped in a before_text guard', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/screens/AssetBlocks.jsx', import.meta.url)), 'utf8')
  const i = src.indexOf('BLOCK_HOOKS.compareToggle')
  assert.ok(i > 0, 'the compare toggle must still exist')
  const before = src.slice(Math.max(0, i - 600), i).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  assert.ok(!/row\.before_text\s*&&\s*\($/m.test(before.trimEnd()),
    'the Show original control must render unconditionally — originalState decides what it says')
})

// ── SPEC 4.5-40: the {{merge field}} token, inline in a static block ─────────────────────────────
// The row asks for two things and the coverage doc scored them as one: the token (the app HAS the
// field name) and the template's surrounding prose (no app route delivers it — the only readers are
// server-side diag routes needing a Google token the browser does not hold). Only the first ships;
// the second is scoped out in writing rather than discovered mid-build.

test('H:placeholder-token-is-derived: the {{token}} comes from the row, never a field-name list', () => {
  assert.equal(placeholderToken({ merge_field: 'SkillsBullets1' }), '{{SkillsBullets1}}')
  assert.equal(placeholderToken({ merge_field: 'ResumeSummary' }), '{{ResumeSummary}}')
  // No literal field list may appear FOR THIS PURPOSE. `shapeOf`'s own comment states the reason:
  // an allow-list goes stale the moment a template gains a placeholder; TEMPLATE_META in api/src
  // stays the one home for the field list.
  //
  // SCOPED TO THE PLACEHOLDER PATH, and that precision is the point. A first draft of this swept
  // both whole files and fired on FIELD_ORDER (:274, the display order the app deliberately owns)
  // and on the ExpertiseBullets threshold-key map (:718-793) — correct code, untouched by this
  // change. A guard that fires on correct-but-different code is the cry-wolf failure this repo
  // deleted a whole linter over. What must stay derived is the TOKEN.
  const fn = stripComments(src('../src/assetBlocks.js'))
  const body = fn.slice(fn.indexOf('export function placeholderToken'), fn.indexOf('export const PLACEHOLDER_NOTE'))
  const jsxAll = stripComments(src('../src/screens/AssetBlocks.jsx'))
  const staticBranch = jsxAll.slice(jsxAll.indexOf("if (shape === 'static')"), jsxAll.indexOf("if (shape === 'list')"))
  for (const name of ['SkillsBullets', 'ResumeSummary', 'ExpertiseBullets', 'RelevantBullets']) {
    assert.ok(!body.includes(name), `placeholderToken hardcodes ${name} — the token must come from row.merge_field`)
    assert.ok(!staticBranch.includes(name), `the static block hardcodes ${name} — the token must come from row.merge_field`)
  }
  // And it really is built from the row, not read off some other source. Matched on the FIELD, not
  // on `row.merge_field` — the dotted form rejected `row?.merge_field`, which is the same read
  // written differently, and a guard that fails on a refactor gets switched off.
  assert.match(body, /merge_field/, 'placeholderToken does not read the row\'s merge_field')
})

test('H:placeholder-never-empty-braces: a row with no field name renders no token', () => {
  // `{{}}`, `{{null}}` and `{{undefined}}` are each a token the document does not have — an
  // invented slot is worse than a missing one, because the reader believes it.
  for (const row of [{}, { merge_field: null }, { merge_field: '' }, { merge_field: '   ' },
                     { merge_field: undefined }, null, undefined]) {
    assert.equal(placeholderToken(row), null, `placeholderToken(${JSON.stringify(row)}) invented a token`)
  }
})

test('H:placeholder-is-static-only: a generated block is byte-identical to its after_text', () => {
  // AC 2.4 / regression guard 2. The token is presentational and belongs to the STATIC branch only.
  // A generated block still renders exactly the bytes of row.after_text — including a leftover
  // `{{X}}` in the stored value, which is reachable because stripLeftoverTokens runs on the
  // DOCUMENT, not on the stored package value.
  const jsx = stripComments(src('../src/screens/AssetBlocks.jsx'))
  const staticBranch = jsx.slice(jsx.indexOf("if (shape === 'static')"), jsx.indexOf("if (shape === 'list')"))
  assert.ok(staticBranch.includes('placeholderToken(row)'), 'the static branch no longer builds the token')
  const rest = jsx.slice(jsx.indexOf("if (shape === 'list')"))
  assert.ok(!rest.includes('placeholderToken'),
    'a non-static branch renders the placeholder — a generated block must render row.after_text unchanged')
  // shapeOf must keep deciding static from `generated` alone, with no field-name allow-list.
  assert.equal(shapeOf({ generated: false, merge_field: 'SkillsBullets1' }), 'static')
  assert.equal(shapeOf({ generated: true, after_text: 'one line' }), 'prose')
})

test('H:no-screen-claims-it-cannot-see-what-it-shows: the static block does not contradict itself', () => {
  // SIBLING of H:no-stale-not-built-claim (qcRail.test.mjs), which asserts the same class — "no
  // screen tells the owner a shipped subsystem does not exist" — but greps qcRail.js/QcRail.jsx
  // ONLY and is structurally blind to this file. Slug, not a number, per the H-case naming rule.
  //
  // The sentence this replaces read "The pipeline cannot see that text, so it is not shown as a
  // draft." True of the template's WORDS; false of the field NAME, which is printed in mono two
  // lines above and now printed again as {{Token}}. Shipping the token with that sentence standing
  // puts a contradiction on one screen.
  const jsx = stripComments(src('../src/screens/AssetBlocks.jsx'))
  assert.ok(!/pipeline cannot see that text/i.test(jsx),
    'the screen still tells the owner the pipeline cannot see the very slot it is now printing')
  // And it must still say what the app genuinely does NOT hold, or the disclosure is simply gone.
  assert.ok(/does not hold the template/i.test(jsx),
    'the screen no longer says the template prose is unavailable — that limitation is real and must stay stated')
})

test('H:placeholder-claims-no-document-read: compact_resume cannot be silently mis-stated', () => {
  // D:compact-template-placeholder-mismatch is OPEN and the owner's decision. Measured in api-test
  // run 32784628025: the compact-resume Doc has {{ResumeSummary}} and {{SkillsBullets}} and is
  // MISSING SkillsBullets1/2, ExpertiseBullets, RelevantBullets1/2/3, while TEMPLATE_META declares
  // the full resume's seven. So the app may state the pipeline's EXPECTATION and may not assert the
  // document's CONTENTS. Phrasing it that way is true under either branch of the open decision and
  // needs no per-type allow-list — which would go stale exactly like a field-name list.
  assert.match(PLACEHOLDER_NOTE, /has not read your document/i,
    'the note asserts the document contains the slot — that is not something the app has checked')
  const jsx = stripComments(src('../src/screens/AssetBlocks.jsx'))
  assert.ok(jsx.includes('PLACEHOLDER_NOTE'), 'the disclosure is defined but never rendered')
  assert.ok(jsx.includes('BLOCK_HOOKS.fieldPlaceholder'), 'the token carries no stable hook for ui-verify')
  // Regression guard 2: the token is IN ADDITION TO the mono slot label, not a replacement for it.
  assert.ok(jsx.includes('BLOCK_HOOKS.fieldSlot'), 'the mono merge-field slot label was displaced by the token')
  assert.notEqual(BLOCK_HOOKS.fieldPlaceholder, BLOCK_HOOKS.fieldSlot)
})

// ── SPEC 4.11-8 caveat + 4.11-5's two remaining quick actions ────────────────────────────────────
//
// Built 2026-08-27 from `docs/qc-evidence/AC-assistant-panel.md` Group F (AC-16, AC-17) — the two
// rows of §4.11 the AC pass found to be both wanted and unblocked. Neither needs the assistant
// panel: they are field-scoped requests, and SPEC §2's ground rule R6 puts those beside the field.

test('H:omit-caveat-only-fires-on-a-recorded-rule-drop: silence when nothing was dropped by the list', () => {
  // The prototype ships this caveat as a HARDCODED string on a fixture (`qc/assist.jsx:19`), so it
  // is true on every reply there. SPEC's wording is conditional — "a caveat WHEN a change will be
  // reverted" — and copying the fixture would print a revert warning on fields nothing reverts.
  // Absence must therefore be assertable, which is what `[data-qc="blocks-omit-caveat"]` gives
  // ui-verify.yml.
  assert.equal(omitListCaveat([]).text, null)
  assert.equal(omitListCaveat(undefined).text, null)
  // A drop the MODEL made is not predictable and must NOT produce the caveat.
  assert.equal(omitListCaveat([{ action: 'dropped', driver: 'posting', from_label: 'Agile', rationale: 'not carried into the final list' }]).text, null)
  // Right rationale, wrong action — a KEPT row names the phrase but nothing was reverted.
  assert.equal(omitListCaveat([{ action: 'kept', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE }]).text, null)
})

test('H:omit-caveat-matches-the-rationale-exactly-never-fuzzily: accusation-grade', () => {
  // CLAUDE.md's standing rule: fuzzy matching is for RANKING, never for ACCUSING. This sentence
  // tells the owner their own list will undo their edit — it names a cause, so a near-miss on the
  // rationale must produce nothing rather than a plausible guess.
  const near = OMIT_LIST_RATIONALE.replace('do-not-use', 'do not use')
  assert.equal(omitListCaveat([{ action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: near }]).text, null)
  assert.equal(omitListCaveat([{ action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: 'omit' }]).text, null)
  // THE FIXTURE THAT MAKES THIS GUARD REAL, added after an independent verifier proved the two
  // above could not see the failure they were written for. Both are SHORTER than the literal, so a
  // fuzzy `rationale.includes('do-not-use')` implementation passed them and the suite stayed
  // 372/372 green with the exactness gone. A SUPERSET is what a substring test cannot survive.
  assert.equal(omitListCaveat([{ action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE + ' (superseded)' }]).text, null)
  assert.equal(omitListCaveat([{ action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: 'previously ' + OMIT_LIST_RATIONALE }]).text, null)
  const hit = omitListCaveat([{ action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE }])
  assert.deepEqual(hit.phrases, ['Agile'])
  assert.match(hit.text, /"Agile"/)
  // It states what is KNOWN (the LAST run) and hedges the future, because the reader's own edit is
  // what it is warning about — never "the next run will drop it".
  assert.match(hit.text, /last run/)
  assert.match(hit.text, /may not stick/)
  assert.doesNotMatch(hit.text, /next run will/)
})

test('H:omit-caveat-never-ships-the-raw-omit-list: only labels already on screen', () => {
  // `evidence.ts:221` NEVER_EVIDENCE and `pipeline.ts:85` both keep `itemsToOmit` off the wire.
  // The caveat is built from `from_label`, which is the row already rendered under "Taken out of
  // this list" — so this function cannot become the leak, whatever it is handed.
  const out = omitListCaveat([{ action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE, itemsToOmit: 'SECRET-LIST' }])
  assert.doesNotMatch(out.text, /SECRET-LIST/)
})

test('H:restore-never-offers-a-phrase-the-rule-will-remove-again: no self-undoing control', () => {
  // The expensive kind of dead UI: a control that appears to work and is then silently undone on
  // the next pass. An omit-list drop is exactly that, so it is excluded and the caveat speaks
  // instead. Both halves are asserted together because they are one decision about one row.
  const rows = [
    { action: 'dropped', driver: 'posting', from_label: 'Vendor selection', rationale: 'not carried into the final list' },
    { action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE },
  ]
  const opts = restoreOptions({ swapsForList: rows, canEdit: true })
  assert.deepEqual(opts.map((o) => o.label), ['Vendor selection'])
  assert.match(opts[0].ask, /"Vendor selection"/)
  assert.equal(omitListCaveat(rows).phrases.length, 1)
  // No candidates and no permission both mean NO CONTROL, not a disabled one.
  assert.deepEqual(restoreOptions({ swapsForList: rows, canEdit: false }), [])
  assert.deepEqual(restoreOptions({ swapsForList: [], canEdit: true }), [])
  // ONLY a dropped row can be put back. The verifier found this filter unguarded while the
  // IDENTICAL line in omitListCaveat was covered — two functions written in one commit with
  // asymmetric coverage. Without it, every kept/added/swapped item grows a "Put back X" offering
  // to restore something that is already there.
  assert.deepEqual(restoreOptions({ canEdit: true, swapsForList: [
    { action: 'kept', from_label: 'A', rationale: 'x' },
    { action: 'added', from_label: 'B', rationale: 'x' },
    { action: 'swapped', from_label: 'C', rationale: 'x' },
    { action: 'merged', from_label: 'D', rationale: 'x' },
  ] }), [])
})

test('H:shorten-carries-the-real-rule-never-a-bare-template: and no rule means no control', () => {
  // The prototype's sentence is `'Shorten this to fit its word rule: '` — a rule it cannot name,
  // because the fixture has no thresholds. The app renders "56 words - 55-60 words" beside the
  // field already, so the request carries those exact strings rather than leaving the model to
  // guess which limit was meant.
  const ok = shortenAction({ mergeField: 'ResumeSummary', observed: '70 words', target: '55–60 words', canEdit: true })
  assert.match(ok.ask, /70 words/)
  assert.match(ok.ask, /55–60 words/)
  assert.equal('reason' in ok, false)
  // No stated rule -> no control, and the REASON is said rather than the control vanishing without
  // explanation (the `keywordActions` precedent).
  const none = shortenAction({ mergeField: 'ResumeSummary', observed: null, target: null, canEdit: true })
  assert.equal(none.ask, null)
  // NO `reason`, and this asserts its ABSENCE rather than its text. The first version returned one
  // and nothing rendered it — a write-only field whose only reader was this test, which is how a
  // JSDoc came to claim a sentence the reader never saw. Asserting the absence stops it coming back
  // silently; if a caller ever needs it, the test has to change with the renderer.
  assert.equal('reason' in none, false, 'shortenAction must not return a field no caller renders')
  assert.equal(shortenAction({ mergeField: 'ResumeSummary', observed: '70 words', target: '55–60 words', canEdit: false }).ask, null)
})

test('H:run-scoped-claims-read-the-latest-pass-only: "the last run" means the last run', () => {
  // THE ONE REAL CORRECTNESS BUG THE VERIFIER FOUND, and it was invisible from the diff. The screen
  // reads `provenance.swaps.swaps`, which is EVERY pass (`appSwaps.ts:113` says so and offers
  // `current` alongside it), and `scopeSwaps` filters on `list` and never on `loop`. Harmless for a
  // change LOG, which is meant to show every pass. Not harmless for a sentence naming a specific
  // run: measured, a loop-1 omit drop that loop 2 KEPT produced "The last run took X out of this
  // list" — and the last run had kept it.
  const rows = [
    { loop: 1, action: 'dropped', driver: 'rule', from_label: 'OldPhrase', rationale: OMIT_LIST_RATIONALE },
    { loop: 1, action: 'dropped', driver: 'posting', from_label: 'OldDrop', rationale: 'not carried into the final list' },
    { loop: 2, action: 'kept', driver: 'rule', from_label: 'OldPhrase', rationale: 'x' },
    { loop: 2, action: 'dropped', driver: 'rule', from_label: 'NewPhrase', rationale: OMIT_LIST_RATIONALE },
  ]
  // Only loop 2's drop is named. The stale loop-1 claim must be gone in BOTH directions.
  assert.deepEqual(omitListCaveat(rows).phrases, ['NewPhrase'])
  assert.doesNotMatch(omitListCaveat(rows).text, /OldPhrase/)
  // ... and the stale loop-1 restore offer with it: putting back something the current pass already
  // carries is a request the reader cannot mean.
  assert.deepEqual(restoreOptions({ swapsForList: rows, canEdit: true }).map((o) => o.label), [])

  // A row that cannot be shown to be current is dropped once ANY row carries a loop - absent
  // evidence is never a pass.
  assert.deepEqual(omitListCaveat([
    { action: 'dropped', driver: 'rule', from_label: 'NoLoop', rationale: OMIT_LIST_RATIONALE },
    { loop: 3, action: 'kept', driver: 'rule', from_label: 'z', rationale: 'x' },
  ]).phrases, [])
  // But data predating the column has exactly one pass to speak of, so it is NOT silently blanked.
  assert.deepEqual(omitListCaveat([
    { action: 'dropped', driver: 'rule', from_label: 'NoLoop', rationale: OMIT_LIST_RATIONALE },
  ]).phrases, ['NoLoop'])
})

test('H:no-blank-or-duplicated-control: a repeated phrase is one control, an empty one is none', () => {
  // F-5 from the verifier's line-deletion sweep: the `new Set` dedupe and the blank-label
  // `.filter(Boolean)` were both unguarded in both functions. Neither is exotic — the same phrase
  // dropped from two lists is the ordinary case (swap rows are keyed by PACKET and list, which is
  // why sharedSourceNote exists), and it would draw two identical "Put back X" controls side by
  // side. A blank label draws a control naming nothing.
  const dupes = [
    { loop: 1, action: 'dropped', driver: 'posting', from_label: 'Vendor selection', rationale: 'a' },
    { loop: 1, action: 'dropped', driver: 'posting', from_label: 'Vendor selection', rationale: 'b' },
    { loop: 1, action: 'dropped', driver: 'posting', from_label: '   ', rationale: 'c' },
    { loop: 1, action: 'dropped', driver: 'posting', from_label: null, rationale: 'd' },
  ]
  assert.deepEqual(restoreOptions({ swapsForList: dupes, canEdit: true }).map((o) => o.label), ['Vendor selection'])
  const om = [
    { loop: 1, action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE },
    { loop: 1, action: 'dropped', driver: 'rule', from_label: 'Agile', rationale: OMIT_LIST_RATIONALE },
    { loop: 1, action: 'dropped', driver: 'rule', from_label: '', rationale: OMIT_LIST_RATIONALE },
  ]
  assert.deepEqual(omitListCaveat(om).phrases, ['Agile'])
  // Singular reads as singular. The ternary is one word each way and nothing else asserted it.
  assert.match(omitListCaveat(om).text, /because it is on your do-not-use list/)
  const two = [...om, { loop: 1, action: 'dropped', driver: 'rule', from_label: 'Scrum', rationale: OMIT_LIST_RATIONALE }]
  assert.match(omitListCaveat(two).text, /because they are on your do-not-use list/)
})

test('H:restore-excludes-the-SECOND-deterministic-reverter: the cross-list drop', () => {
  // THIS SHIPPED AS A LIVE DEFECT AND AN INDEPENDENT PASS FOUND IT, not this file's own guard.
  // `restoreOptions`' doc asserted the owner's do-not-use list was "THE ONLY DETERMINISTIC REVERTER
  // IN THE PIPELINE". False: `dedupeAcrossLists` (normalise.ts:100-123) is pure, deterministic, and
  // runs on EVERY build, inside normalisePackage at appPackets.ts:561 - BEFORE writeSwaps at :618,
  // mutating the same pkg. Its deletions arrived as ordinary drops, so a "Put back X" was offered
  // for an item the next build removes again: the exact self-undoing control this function exists
  // to prevent, through a producer its guard could not see.
  //
  // The guard was not wrong about its own case. It was written against the only reverter its author
  // knew about, which is why an assertion about "the only X" is worth distrusting on sight.
  const rows = [
    { loop: 1, action: 'dropped', driver: 'posting', from_label: 'Real drop', rationale: 'not carried into the final list' },
    { loop: 1, action: 'dropped', driver: 'rule', from_label: 'Omitted', rationale: OMIT_LIST_RATIONALE },
    { loop: 1, action: 'dropped', driver: 'posting', from_label: 'Cloud Architecture', rationale: 'already listed in RelevantBullets1; kept there rather than listed twice' },
  ]
  assert.deepEqual(restoreOptions({ swapsForList: rows, canEdit: true }).map((o) => o.label), ['Real drop'])

  // NO CAVEAT for the cross-list case, deliberately. The item is still in the document, in another
  // list, so warning that it "will be reverted" would be its own false sentence - the same mistake
  // in the opposite direction. Only the omit-list phrase is named.
  assert.deepEqual(omitListCaveat(rows).phrases, ['Omitted'])

  // Anchored at position 0, not a substring search: a rationale that merely CONTAINS the phrase is
  // not a cross-list drop, and treating it as one would silently withdraw a legitimate control.
  assert.equal(isCrossListDrop('already listed in X; kept there rather than listed twice'), true)
  assert.equal(isCrossListDrop('this was already listed in X'), false)
  assert.equal(isCrossListDrop('not carried into the final list'), false)
  assert.equal(isCrossListDrop(null), false)
})

test('H:cross-list-rationale-parity: the app prefix is the one swaps.ts writes', () => {
  // Same failure mode as H:omit-caveat-rationale-parity, and the same fix: two repos hold separate
  // copies of one literal, so a reword on either side silently switches the exclusion OFF and turns
  // a self-undoing control back on with every other test still green.
  const swapsSrc = src('../../api/src/functions/tests/swaps.ts')
  assert.ok(swapsSrc.includes(`CROSS_LIST_RATIONALE_PREFIX = '${CROSS_LIST_RATIONALE_PREFIX}'`),
    `swaps.ts no longer writes the prefix the app excludes on: ${CROSS_LIST_RATIONALE_PREFIX}`)
  // And it is genuinely a PREFIX there - built by concatenation at position 0, not embedded mid
  // sentence, or `startsWith` on this side would never match what the producer emits.
  assert.match(swapsSrc, /crossListRationale = \(mergeField: string\): string =>\s*\n?\s*`\$\{CROSS_LIST_RATIONALE_PREFIX\}/,
    'crossListRationale must start with the prefix, or the app-side startsWith cannot match it')
})

test('H:omit-caveat-rationale-parity: one producer, and it is the rule branch', () => {
  // The api and the app hold SEPARATE copies of this string and the match must be exact, so a
  // reword on either side would silently switch the caveat off with every other test still green.
  // This is the structural rule a runtime test cannot express: it reads the producer's source.
  const swapsSrc = src('../../api/src/functions/tests/swaps.ts')
  assert.ok(swapsSrc.includes(`rationale: '${OMIT_LIST_RATIONALE}'`),
    `swaps.ts no longer writes the rationale the app matches on: ${OMIT_LIST_RATIONALE}`)

  // WHY THE SECOND HALF EXISTS, recorded because it was found by mutation and not by reading.
  // `omitListCaveat` filters on `driver === 'rule'` AND on the exact rationale. Deleting the driver
  // half left the whole suite green (measured 2026-08-27: 372/372 with it removed), because today
  // exactly ONE site writes that rationale and it is the rule branch — so the two conditions are
  // behaviourally equivalent and no producible fixture can tell them apart. The driver check is
  // therefore documentation, not protection, and claiming it "guarded" would be claiming a proof
  // the mutation refused to give.
  //
  // What IS load-bearing is the assumption underneath it: that the rationale implies the driver. A
  // second write site with a different driver would silently change what the caveat accuses without
  // touching a line of app code. That assumption is what this pins.
  const sites = swapsSrc.split(`rationale: '${OMIT_LIST_RATIONALE}'`).length - 1
  assert.equal(sites, 1, 'a second producer of the omit rationale appeared; omitListCaveat assumes exactly one')
  // AND EXACTLY ONE `driver: 'rule'` ROW, which is the half the first version missed. The verifier
  // added a SECOND rule-driven drop carrying a DIFFERENT rationale: tsc clean, api 886/886, app
  // 372/372 — the guard was blind, because it pinned THAT producer rather than that there is only
  // one. Those rows are the worst case available: they produce no caveat AND a "Put back X"
  // control, i.e. exactly the self-undoing UI restoreOptions exists to prevent.
  const ruleRows = (swapsSrc.match(/driver: 'rule'/g) || []).length
  assert.equal(ruleRows, 1,
    'a second driver:\'rule\' drop exists; it produces no caveat and a restore control that the next pass undoes')
  const before = swapsSrc.slice(0, swapsSrc.indexOf(`rationale: '${OMIT_LIST_RATIONALE}'`))
  const objStart = before.lastIndexOf('swaps.push({')
  assert.ok(objStart !== -1 && before.slice(objStart).includes("driver: 'rule'"),
    'the omit-list rationale is no longer written on a driver:\'rule\' row — omitListCaveat filters on both')
})

// ── a line with no swap row must not render a blank status ──────────────────────────────────────
//
// Owner, 2026-08-29, looking at the live packet: *"the prototype shows the buttons regardless and
// an unchanged value if not swapped. that's better than showing nothing which doesn't match the
// design and leaves me wondering if something broken"*. The prototype's own list
// (`docs/qc-evidence/qc/assets.jsx:292`) renders `unchanged` for every non-swapped item; the app
// rendered an empty string, and an empty cell in a provenance column is indistinguishable from a
// broken one.
//
// The claim is still evidence-bounded, which is why the second case exists: `unchanged` is only
// asserted when the list HAS attribution and this line simply was not named by it. With no swap
// rows at all nothing judged the list, and reporting absent evidence as a finding is the one thing
// this codebase refuses to do everywhere else.
test('an unswapped line says "unchanged" when the list has attribution', () => {
  const m = listBodyModel(LIST_ROW, [SWAP], { artifactId: 'art-resume', listOwners: {} })
  const untouched = m.lines.find((l) => !l.swap)
  assert.ok(untouched, 'the fixture must contain a line no swap row names')
  assert.equal(untouched.text, 'Ran the intake process')
  assert.equal(untouched.status, 'unchanged',
    'a line the attribution did not name survived the pass — saying nothing reads as broken')
})

test('an unswapped line stays silent when the list has NO attribution', () => {
  const m = listBodyModel(LIST_ROW, [], { artifactId: 'art-resume', listOwners: {} })
  assert.equal(m.lines.length, 2)
  for (const l of m.lines) {
    assert.equal(l.status, '',
      'with no swap rows nothing judged this list, so "unchanged" would report absent evidence as a finding')
  }
})

// ── SPEC 4.4-29 · the findings the field margins do NOT show ─────────────────────────────────────
//
// THE DEFECT THESE GUARD, MEASURED. `origin/ui-fixtures:raw-dump.json` (opp `9f9c370a-...`, 540
// check rows): the resume's asset header prints `40 to fix · 33 to review` = 73 findings while the
// field margins under it render **20**; the compact resume prints 47 and renders **2**. The gap is
// structural — `severityCounts` (assetGate.js) counts every fail/warn ROW, while `findingsByField`
// (qcRail.js) emits one only where `sectionIdForOffender` resolves an offender AND
// `AssetBlocks.jsx` then renders only `findings[r.merge_field]` for THIS artifact's own rows. Ten of
// the compact resume's invisible rows name `RelevantBullets1/2/3` and `ExpertiseBullets`, fields the
// RESUME renders — a real cross-asset navigation, which is the `Go to field ->` the prototype puts
// on that list (`docs/qc-evidence/qc/assets.jsx:257`).

const UP_RENDERED = ['ResumeSummary', 'SkillsBullets1']

// Distinct check_keys so "how many ROWS were placed" is countable from findingsByField, which keys
// its output by FIELD and emits one entry per (row, field) pair.
const UP_RESULT = {
  results: [
    // placed: names a field this card renders
    { check_key: 'whitespace', engine: 'deterministic', state: 'fail', expected: 'no stray spacing',
      offenders: ['ResumeSummary: two spaces'] },
    // placed on a field this card renders, via the second offender
    { check_key: 'ai_tells', engine: 'deterministic', state: 'warn', expected: '',
      offenders: ['#3 leverage', 'SkillsBullets1: synergy'] },
    // UNPLACED, names a field only a SIBLING renders
    { check_key: 'relevant_char_limit', engine: 'deterministic', state: 'fail', expected: 'under 20 chars',
      offenders: ['RelevantBullets1: far too long a line'] },
    // UNPLACED, names no field at all
    { check_key: 'cross_list_redundancy', engine: 'reviewer', state: 'fail', expected: '',
      offenders: ['#7 repeated across two lists'] },
    // UNPLACED, names TWO fields, so sectionIdForOffender refuses to pick one
    { check_key: 'word_counts', engine: 'deterministic', state: 'warn', expected: '',
      offenders: ['ResumeSummary and ExpertiseBullets disagree'] },
    // not a finding at all - must never reach either list
    { check_key: 'company_named', engine: 'deterministic', state: 'pass', expected: '', offenders: [] },
  ],
}

const UP_OWNERS = registerFieldOwners(
  registerFieldOwners({}, 'art-resume', 'Resume', ['RelevantBullets1', 'ExpertiseBullets']),
  'art-compact', 'Compact resume', UP_RENDERED)

// THE RECONCILIATION. Not a tautology over my own filter: the "placed" side is counted from
// `findingsByField` — the OTHER function, the one the margins actually render from — so if its
// placement rule and `unplacedOf`'s ever diverge, this sum breaks. That divergence IS the defect.
test('H:unplaced-reconciles-the-header-count: placed + unplaced == every finding the header counts', () => {
  const counts = severityCounts(UP_RESULT)
  const total = counts.fix + counts.review + counts.soft
  assert.equal(total, 5, 'the fixture must carry five findings and one pass')

  const byField = findingsByField(UP_RESULT, [])          // no exclusions: count what placement CAN see
  const placed = new Set()
  for (const f of UP_RENDERED) for (const row of byField[f] || []) placed.add(row.check_key)

  const unplaced = unplacedFindings(UP_RESULT, UP_RENDERED)
  assert.equal(placed.size + unplaced.length, total,
    'every counted finding must be either in a field margin or in the unplaced list - the gap is the bug')
  assert.equal(unplaced.length, 3)
  assert.deepEqual(unplaced.map((f) => f.check_key).sort(),
    ['cross_list_redundancy', 'relevant_char_limit', 'word_counts'])
})

test('H:unplaced-is-the-complement-never-a-duplicate: a finding in a margin is not listed again', () => {
  const unplaced = unplacedFindings(UP_RESULT, UP_RENDERED)
  const keys = unplaced.map((f) => f.check_key)
  assert.ok(!keys.includes('whitespace'),
    'whitespace names ResumeSummary, which this card renders - listing it again is the second enumeration 4.2-4 forbids')
  assert.ok(!keys.includes('ai_tells'),
    'ONE offender naming a rendered field is enough to place the row - it renders in that margin')
  assert.ok(!keys.includes('company_named'), 'a pass row is not a finding and belongs on neither list')
})

test('H:unplaced-worst-first: the thing that blocks is the thing read first', () => {
  const unplaced = unplacedFindings(UP_RESULT, UP_RENDERED)
  const rank = { fix: 3, review: 2, soft: 1 }
  for (let i = 1; i < unplaced.length; i += 1) {
    assert.ok(rank[unplaced[i - 1].sev] >= rank[unplaced[i].sev],
      'the same ordering findingsByField uses, or the two surfaces read in different orders')
  }
  assert.equal(unplaced[0].sev, 'fix')
})

// NO DEAD UI, the half a structural grep cannot reach: a link is offered ONLY where an artifact
// that renders the named field actually exists. `qc/assets.jsx:257` gates on `a.sec` for the same
// reason, and `requirementUsage` states the identical null contract.
test('H:unplaced-link-only-with-a-real-target: no target, no control, and always a reason', () => {
  const unplaced = unplacedFindings(UP_RESULT, UP_RENDERED)
  const byKey = Object.fromEntries(unplaced.map((f) => [f.check_key, f]))

  const cross = unplacedTarget(byKey.relevant_char_limit, UP_OWNERS, 'art-compact')
  assert.deepEqual(cross, { artifactId: 'art-resume', mergeField: 'RelevantBullets1', label: 'Resume', self: false },
    'a field a SIBLING renders is a real navigation - this is the compact-resume case, 10 rows on the live fixture')
  assert.equal(unplacedReason(byKey.relevant_char_limit, UP_OWNERS, 'art-compact'), '',
    'a row that offers a link needs no reason')

  for (const key of ['cross_list_redundancy', 'word_counts']) {
    assert.equal(unplacedTarget(byKey[key], UP_OWNERS, 'art-compact'), null,
      `${key} names no resolvable field - a link here would land nowhere`)
    assert.ok(unplacedReason(byKey[key], UP_OWNERS, 'art-compact').length > 10,
      'not clickable must never be mute - inertReason is the rail\'s own wording, reused')
  }

  // A field nothing in the packet renders: the finding names one, and there is still no target.
  const orphan = unplacedTarget({ check_key: 'x', fields: ['@CoverLetterBody'], offenders: [] }, UP_OWNERS, 'art-compact')
  assert.equal(orphan, null)
  assert.equal(unplacedReason({ check_key: 'x', fields: ['@CoverLetterBody'], offenders: [] }, UP_OWNERS, 'art-compact'),
    NO_OWNER_REASON, 'a named field no asset renders is stated, not silently dropped')

  assert.equal(unplacedTarget(byKey.relevant_char_limit, {}, 'art-compact'), null,
    'an empty registry offers nothing - the asset steps start with {} until the cards report in')
})

test('H:unplaced-link-is-the-rail-hook-not-a-second-name: SPEC 4.4-29 selects on qc-go-to-field', () => {
  // The row the render sweep measured as 0 nodes. A second hook name would make the sweep's own
  // selector unable to see the fix.
  assert.equal(UNPLACED_LINK_HOOK, 'qc-go-to-field')
  assert.equal(UNPLACED_LINK_HOOK, QC_HOOKS.goToField, 'one concept, one hook, imported not retyped')

  const jsx = stripComments(src('../src/screens/AssetBlocks.jsx'))
  const block = jsx.slice(jsx.indexOf('function UnplacedFindings'), jsx.indexOf('function DistributionMeter'))
  assert.ok(block.length > 500, 'UnplacedFindings not found - this assertion has gone stale')
  assert.match(block, /data-qc=\{UNPLACED_LINK_HOOK\}/, 'the link must carry the shared hook constant')
  assert.ok(!/data-qc="qc-go-to-field"/.test(block), 'hand-typed hook strings drift from the constant')
  assert.match(block, /\{target && onGoToField && \(/,
    'the control must render only behind a resolved target AND a supplied navigator - no dead UI')
  assert.match(block, /data-qc=\{BLOCK_HOOKS\.unplaced\}\s+data-qc-n=\{rows\.length\}/,
    'the container must carry its count, or the reconciliation is not assertable from the DOM')
  assert.match(block, /if \(!rows \|\| !rows\.length\) return null/,
    'nothing to show means nothing renders - never an empty "0 findings" box')
  assert.match(block, /onGoToField\(target\.artifactId, target\.mergeField\)/,
    'it must call the SAME navigator the rail uses, with the target it resolved')
})

test('H:field-owners-withdraw-a-stale-owner: a card that stops rendering a field stops owning it', () => {
  let owners = registerFieldOwners({}, 'a1', 'Resume', ['ResumeSummary', 'SkillsBullets1'])
  assert.deepEqual(owners.ResumeSummary, [{ id: 'a1', label: 'Resume' }])

  owners = registerFieldOwners(owners, 'a1', 'Resume', ['SkillsBullets1'])
  assert.deepEqual(owners.ResumeSummary, [],
    'a stale owner outliving the card that reported it is a link to a field that is no longer there')
  assert.deepEqual(owners.SkillsBullets1, [{ id: 'a1', label: 'Resume' }])

  const same = registerFieldOwners(owners, 'a1', 'Resume', ['SkillsBullets1'])
  assert.equal(same, owners, 'an unchanged report must return the SAME object, or the effect re-fires forever')

  assert.equal(registerFieldOwners(owners, null, 'X', ['ResumeSummary']), owners, 'no artifact id, no change')
})

test('H:one-report-two-registries: fields and lists come from the SAME card callback', () => {
  // Two callbacks would let a card be registered as the owner of its lists and not of its fields.
  const jsx = stripComments(src('../src/screens/AssetBlocks.jsx'))
  // SCOPED TO THE CALL. An unscoped `[\s\S]{0,120}` window ran past the closing paren into the
  // effect's own dependency array, where `fieldsKey` also appears - so deleting the argument left
  // the assertion GREEN. Caught by mutation, which is the only thing that catches an inert guard.
  const at = jsx.indexOf('onListsRendered(artifact.id')
  assert.ok(at > 0, 'the card no longer reports at all - this assertion has gone stale')
  const call = jsx.slice(at, jsx.indexOf('\n  }', at))
  assert.match(call, /listsKey/, 'lists must still be reported')
  assert.match(call, /fieldsKey/, 'the card must report lists AND fields on ONE call')

  const pb = stripComments(src('../src/screens/PacketBuilder.jsx'))
  const cb = pb.slice(pb.indexOf('const registerLists = useCallback'))
  assert.match(cb.slice(0, 400), /registerListOwners\(prev, artifactId, label, lists\)/)
  assert.match(cb.slice(0, 400), /registerFieldOwners\(prev, artifactId, label, fields\)/,
    'both registries must be fed from that one report')
  assert.match(pb, /fieldOwners=\{fieldOwners\} onGoToField=\{goToField\}/,
    'the asset card must be handed the SAME navigator the QC rail is handed, never a second one')
})

// ── SPEC 4.5-12 — the pick list ─────────────────────────────────────────────────────────────────

test('H:pick-list-shows-what-was-considered-not-only-what-shipped', () => {
  // THE POINT OF THE ROW. A dropped item is the one the owner CANNOT otherwise see -- it is not on
  // the page to be seen -- so a pick list that only lists what shipped would be a list of things
  // already visible, which is no control at all.
  const rows = [
    { action: 'kept', to_label: 'Product roadmap', requirement_id: 'r1' },
    { action: 'added', to_label: 'Hiring technology', requirement_id: null },
    { action: 'dropped', from_label: 'Banned wording', driver: 'rule', rationale: OMIT_LIST_RATIONALE },
    { action: 'dropped', from_label: 'Lives elsewhere', driver: 'rule', rationale: 'already listed in Skills 2' },
  ]
  const items = pickListModel(rows, { onPage: ['Product roadmap', 'Hiring technology'] })
  assert.equal(items.length, 4, 'every considered item must appear, including the dropped ones')
  const by = Object.fromEntries(items.map((i) => [i.text, i]))

  assert.equal(by['Product roadmap'].selected, true)
  assert.equal(by['Hiring technology'].selected, true)
  assert.equal(by['Banned wording'].selected, false, 'a dropped item is not on the page')

  // BLOCKED IS THE OWNER'S DO-NOT-USE LIST AND NOTHING ELSE. A cross-list drop is not a ban -- the
  // item is fine and lives in another list -- and striking it through would accuse the owner's own
  // wording of being forbidden. Exact match on the rationale, never a substring: this repo's
  // standing rule is that anything naming an offender is exact, never fuzzy.
  assert.equal(by['Banned wording'].blocked, true)
  assert.equal(by['Lives elsewhere'].blocked, false,
    'a cross-list drop was marked as banned - it is not on the do-not-use list')
  assert.match(by['Lives elsewhere'].note, /already listed in/)
})

test('H:pick-list-seeds-a-request-and-sets-nothing', () => {
  // There is no route that reorders a list. The checkboxes compose a SENTENCE; if they ever appear
  // to commit, the control is lying about what it did. The ask must name the field and every chosen
  // item, so the assistant is not guessing at "these" against the owner's own document.
  const ask = pickListAsk('Skills 1', ['Product roadmap', 'Hiring technology'])
  assert.match(ask, /Skills 1/)
  assert.match(ask, /Product roadmap \| Hiring technology/)
  assert.equal(pickListAsk('Skills 1', []), null, 'an empty selection must produce NO sentence')
  assert.equal(pickListAsk('Skills 1', ['   ']), null, 'whitespace is not a selection')

  // NO CANDIDATES, NO CONTROL.
  assert.deepEqual(pickListModel([], {}), [])
  assert.deepEqual(pickListModel(null, {}), [])

  const BLOCKS = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8')
  assert.match(BLOCKS, /onAsk=\{\(sentence\) => \{ setAskSent\(null\); seedAsk\(sentence\) \}\}/,
    'the pick list must route through seedAsk, the same seeder its neighbours use - a second edit ' +
    'path would be the parallel system, and it would be the one without the confirmation')
  assert.ok(!/pickList[\s\S]{0,400}api\.\w+\(/.test(BLOCKS),
    'the pick list calls an API directly - it seeds, it does not commit')
})


// ---------------------------------------------------------------------------------------------
// SPEC 4.6 displacement line - "Took the place of X in Skills 1."
//
// EVIDENCE THIS ROW WAS REAL, not a prototype flourish: db-query run 33687166561 (2026-09-02) on
// production returned 35 distinct swapped TO-labels and 11 joining a `requirement.model_keyword`
// exactly. The row had been recorded as unsourced from a code comment; PC-3's own text names
// `swap_decision.from_label -> to_label` as the source.

test('H:displacement-names-only-a-recorded-swap', () => {
  const swaps = [
    { action: 'swapped', from_label: 'Digital Transformation', to_label: 'Cloud-native Services', list: 'Skills 1' },
    { action: 'kept', from_label: 'Kept Thing', to_label: 'Kept Thing', list: 'Skills 1' },
    // THE ROW THE FIRST VERSION OF THIS TEST LACKED, and mutation-proving is what found it. Every
    // other non-swapped row here is ALSO excluded by a second condition (dropped has no TO, added
    // has no FROM, the kept row above has FROM === TO), so deleting the `action` check changed
    // nothing and the harness correctly reported INERT. This row is excluded by the action check
    // and NOTHING ELSE: a real from/to pair on a row that is not a swap. It is not hypothetical --
    // production carries 55 rows with both labels against only 35 `swapped` (db-query 33687166561),
    // so ~20 rows would produce a FALSE "took the place of" without the action check.
    { action: 'kept', from_label: 'Old Wording', to_label: 'Current Wording', list: 'Skills 1' },
    { action: 'dropped', from_label: 'Dropped Thing', to_label: null, list: 'Skills 2' },
    { action: 'added', from_label: null, to_label: 'Added Thing', list: 'Skills 2' },
  ]
  // The one swapped row resolves, with its predecessor and its list.
  assert.deepEqual(keywordDisplacement(swaps, 'Cloud-native Services'),
    { from: 'Digital Transformation', list: 'Skills 1' })
  // A KEPT row displaced nothing. An ADDED row went into empty space. Neither may claim a
  // predecessor - that sentence names an offender and must come from a recorded swap only.
  assert.equal(keywordDisplacement(swaps, 'Kept Thing'), null)
  assert.equal(keywordDisplacement(swaps, 'Current Wording'), null)
  assert.equal(keywordDisplacement(swaps, 'Added Thing'), null)
  assert.equal(keywordDisplacement(swaps, 'Dropped Thing'), null)
  // A keyword nothing swapped for is null, not a guess.
  assert.equal(keywordDisplacement(swaps, 'Never Mentioned'), null)
})

test('H:displacement-never-says-a-term-replaced-itself', () => {
  // from === to records no displacement. Rendering "took the place of Kubernetes" on the chip
  // Kubernetes reads as a bug, and it is one.
  const same = [{ action: 'swapped', from_label: 'Kubernetes', to_label: 'Kubernetes', list: 'Skills 1' }]
  assert.equal(keywordDisplacement(same, 'Kubernetes'), null)
  // Differing only by case/punctuation is the SAME label under normLabel, so still no displacement.
  const casey = [{ action: 'swapped', from_label: 'kubernetes.', to_label: 'Kubernetes', list: 'Skills 1' }]
  assert.equal(keywordDisplacement(casey, 'Kubernetes'), null)
  // A missing or blank from_label cannot name a predecessor either.
  assert.equal(keywordDisplacement([{ action: 'swapped', from_label: '  ', to_label: 'X' }], 'X'), null)
  assert.equal(keywordDisplacement([{ action: 'swapped', from_label: null, to_label: 'X' }], 'X'), null)
})

test('H:displacement-text-drops-the-list-clause-rather-than-printing-null', () => {
  assert.equal(keywordDisplacementText({ from: 'Digital Transformation', list: 'Skills 1' }),
    'Took the place of Digital Transformation in Skills 1.')
  // This app has swap rows with no list; the prototype interpolates it unconditionally. "in null"
  // on screen is worse than a sentence that stops.
  assert.equal(keywordDisplacementText({ from: 'Digital Transformation', list: null }),
    'Took the place of Digital Transformation.')
  assert.equal(keywordDisplacementText(null), null)
  const noList = [{ action: 'swapped', from_label: 'A', to_label: 'B', list: '   ' }]
  assert.equal(keywordDisplacementText(keywordDisplacement(noList, 'B')), 'Took the place of A.')
})

test('H:displacement-tolerates-junk-input-without-throwing', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    assert.equal(keywordDisplacement(bad, 'X'), null)
  }
  assert.equal(keywordDisplacement([null, undefined, {}], 'X'), null)
  assert.equal(keywordDisplacement([{ action: 'swapped', from_label: 'A', to_label: 'B' }], ''), null)
  assert.equal(keywordDisplacement([{ action: 'swapped', from_label: 'A', to_label: 'B' }], null), null)
  // THE ROW THAT MAKES THE EMPTY-KEYWORD REFUSAL NON-EQUIVALENT, found by mutation-proving. With a
  // populated to_label an empty keyword falls through the loop and returns null anyway, so deleting
  // `if (!k) return null` changed nothing and the harness reported INERT. A BLANK to_label is the
  // case that separates them: normLabel('') === normLabel(undefined) === '', so an empty keyword
  // MATCHES the row and walks away with a displacement claim for a term that does not exist.
  const blankTo = [{ action: 'swapped', from_label: 'Real Predecessor', to_label: '  ', list: 'Skills 1' }]
  assert.equal(keywordDisplacement(blankTo, ''), null)
  assert.equal(keywordDisplacement(blankTo, null), null)
  assert.equal(keywordDisplacement([{ action: 'swapped', from_label: 'Real Predecessor' }], ''), null)
})


// ---------------------------------------------------------------------------------------------
// SPEC 4.5-29 / 4.5-30 - the reworded marker and the match grade.
//
// The row was recorded as needing a term library. It does not: the prototype never visualises one
// (`libTerms()` is a flag filter used as a denominator), and the grade is an OUTPUT comparison --
// does the posting say the term the way the draft says it. Production 2026-09-02: 5,396 requirements
// whose verbatim contains their model_keyword, 6,804 where it does not, 2,221 with no verbatim.

test('H:grade-is-decided-by-the-posting-not-by-a-library', () => {
  // The posting says it literally -> exact. Case and surrounding words do not matter.
  assert.equal(keywordGrade('SOC 2 Type II', 'ownership of SOC 2 Type II'), 'exact')
  assert.equal(keywordGrade('Multi-region AWS', 'multi-region AWS'), 'exact')
  assert.equal(keywordGrade('Cloud-native Services', 'to cloud-native services'), 'exact')
  // The posting frames it differently -> reworded. These are the prototype's own variant rows.
  assert.equal(keywordGrade('Distributed Teams', 'a distributed organization of 60+'), 'reworded')
  assert.equal(keywordGrade('P&L Ownership', 'P&L or budget ownership at $10M or above'), 'reworded')
  assert.equal(keywordGrade('Cycle Time Reduction', 'reducing delivery cycle time in a regulated environment'), 'reworded')
})

test('H:grade-is-null-when-the-posting-line-was-never-located', () => {
  // ABSENT EVIDENCE IS NOT A GRADE. 2,221 production requirements have no verbatim; calling those
  // `reworded` would report "the posting says it differently" about a posting line nobody found.
  for (const v of [null, undefined, '', '   ']) assert.equal(keywordGrade('Kubernetes', v), null)
  for (const k of [null, undefined, '', '   ']) assert.equal(keywordGrade(k, 'Hands-on depth with Kubernetes'), null)
  // And null must render nothing at all - no marker, no word.
  assert.equal(GRADE_MARK[null], undefined)
  assert.equal(GRADE_WORD[null], undefined)
})

test('H:grade-marks-only-the-reworded-chip', () => {
  // The marker is what 4.5-29 IS. An exact chip carries none, and an empty string means the
  // component renders no node rather than an empty span.
  assert.equal(GRADE_MARK.exact, '')
  assert.ok(GRADE_MARK.reworded)
  assert.notEqual(GRADE_MARK.reworded, GRADE_MARK.exact)
})

test('H:grade-never-offers-a-third-word-that-would-be-constant', () => {
  // The prototype's third grade, `loose`, is decided by NOT being in the scoreable library. Every
  // chip here is a model_keyword, declared never scoreable, so `loose` would be the same answer on
  // every chip - decoration, and worse, it reads as a scoring verdict the panel disclaims.
  assert.deepEqual(Object.keys(GRADE_WORD).sort(), ['exact', 'reworded'])
  for (const w of Object.values(GRADE_WORD)) assert.doesNotMatch(String(w), /loose|not scored/i)
  // Whatever the inputs, only those two or null ever come back.
  for (const [k, v] of [['a', 'a'], ['a', 'b'], ['', ''], ['x', null]]) {
    assert.ok([null, 'exact', 'reworded'].includes(keywordGrade(k, v)))
  }
})

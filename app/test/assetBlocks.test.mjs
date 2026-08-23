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
  UNKNOWN_REQS_NOTE, UNKNOWN_TERMS_NOTE,
  countMismatchNote, deriveItems, draftSizeText, expectationFor, itemCountOf, joinLabels,
  latestRows, listBodyModel, listsOf, meterModel, normLabel, registerListOwners, reqsForRow,
  scopeSwaps, shapeOf, sharedSourceNote, splitItems, statPct, wordCount,
} from '../src/assetBlocks.js'

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
import { BLOCK_HOOKS, correctionsForField } from '../src/assetBlocks.js'
import { ASSET_BODY_DEFAULT_OPEN, PACKET_HOOKS } from '../src/packetBuilder.js'

const BLOCKS_SRC = src('../src/screens/AssetBlocks.jsx')
const PACKET_SRC = src('../src/screens/PacketBuilder.jsx')

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

  assert.match(src, /import\s*\{\s*railChangeLog\s*\}\s*from\s*['"]\.\.\/qcRail\.js['"]/,
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

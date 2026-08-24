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
  scopeSwaps, shapeOf, sharedSourceNote, splitItems, statPct, wordCount, observedFor,
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

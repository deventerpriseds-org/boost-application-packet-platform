// Unit tests for api/src/functions/tests/slideTables.ts — reading TABLES out of a Google Slides
// presentation as a grid rather than as flattened prose.
//   cd api && npm test
//
// THE FIXTURES ARE API-SHAPED ON PURPOSE. This repo has shipped guards written against a shape the
// producer never emits three separate times (VERIFY-30 F4, the F5 rebuild detector, and the
// railDecisions fixtures). The Slides nesting below —
//   presentation.slides[].pageElements[].table.tableRows[].tableCells[].text.textElements[].textRun.content
// — is the real one, and it is deliberately NOT the Docs nesting that diagDocStructure.ts walks
// (document.body.content[].table.tableRows[].tableCells[].content). Same nouns, different root and
// a different leaf. A test written against the Docs shape would pass while the reader returned
// nothing from a real deck.
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSlideTables, columnOf, previewTables } from '../dist/functions/tests/slideTables.js'

const cell = (...runs) => ({ text: { textElements: runs.map(content => ({ textRun: { content } })) } })
const row = (...cells) => ({ tableCells: cells })
const deck = (...slides) => ({ slides })
const tableEl = (objectId, ...rows) => ({ objectId, table: { tableRows: rows } })

test('H:slide-tables-read-the-SLIDES-shape-not-the-docs-shape', () => {
  const d = deck({ pageElements: [tableEl('t1',
    row(cell('Skill'), cell('Evidence')),
    row(cell('Platform modernization'), cell('Trinnex')),
  )] })
  const tables = extractSlideTables(d)
  assert.equal(tables.length, 1)
  assert.equal(tables[0].slide, 1, 'slide numbers are 1-based so they match what the owner sees')
  assert.equal(tables[0].objectId, 't1')
  assert.deepEqual(tables[0].cells, [['Skill', 'Evidence'], ['Platform modernization', 'Trinnex']])

  // The DOCS shape must yield nothing here. If this ever starts returning rows, someone has made
  // the reader "tolerant" of both — and a reader that accepts both shapes cannot tell you which one
  // it actually found, which is how "the deck has no tables" and "I looked in the wrong place"
  // become indistinguishable.
  const docsShaped = { body: { content: [{ table: { tableRows: [{ tableCells: [{ content: [] }] }] } }] } }
  assert.deepEqual(extractSlideTables(docsShaped), [])
})

test('H:slide-tables-join-every-text-run-in-a-cell', () => {
  // Google splits a single cell's text across several textRun elements whenever formatting changes
  // mid-string. Reading only the first run silently truncates the owner's data at the first bold
  // word — a loss that looks like a short skill rather than like a bug.
  const d = deck({ pageElements: [tableEl('t1', row(cell('SOC 2', ' Type II', ' ownership')))] })
  assert.deepEqual(extractSlideTables(d)[0].cells, [['SOC 2 Type II ownership']])
})

test('H:slide-table-cells-keep-interior-newlines', () => {
  // Interior newlines are the owner's own line breaks INSIDE one cell, and splitSkillField splits
  // on them later. Collapsing them here would merge separate skills into one term — fabrication by
  // concatenation, which is harder to spot than a dropped row.
  const d = deck({ pageElements: [tableEl('t1', row(cell('  Kubernetes\nTerraform  ')))] })
  const got = extractSlideTables(d)[0].cells[0][0]
  assert.equal(got, 'Kubernetes\nTerraform', 'edges trimmed, interior newline preserved')
})

test('H:slide-tables-are-never-ragged', () => {
  // A short row must pad, not leave holes. Otherwise columnOf returns undefined for some rows and a
  // string for others, and the caller cannot tell an EMPTY cell from a row that ended early.
  const d = deck({ pageElements: [tableEl('t1',
    row(cell('A'), cell('B'), cell('C')),
    row(cell('D')),
  )] })
  const t = extractSlideTables(d)[0]
  assert.equal(t.columns, 3)
  assert.deepEqual(t.cells, [['A', 'B', 'C'], ['D', '', '']])
  for (const r of t.cells) assert.equal(r.length, 3)
})

test('H:slide-tables-report-absence-as-a-result-not-an-error', () => {
  // A deck with no tables is a legitimate finding. Throwing, or returning something falsy that a
  // caller reads as failure, is how "there are no tables" gets reported as "the read failed" — and
  // absent evidence must never be laundered in either direction.
  assert.deepEqual(extractSlideTables(deck({ pageElements: [] })), [])
  assert.deepEqual(extractSlideTables(deck({})), [])
  assert.deepEqual(extractSlideTables({}), [])
  assert.deepEqual(extractSlideTables(null), [])
  assert.deepEqual(extractSlideTables({ slides: 'not an array' }), [])
})

test('H:column-is-taken-by-INDEX-never-guessed', () => {
  // Row 0 is treated as the header by CONVENTION and nothing sniffs for one. Detecting a header
  // (bold? shaded? shorter?) is right most of the time and silently wrong the rest, and wrong here
  // drops the owner's first real skill as if it were a heading.
  const t = extractSlideTables(deck({ pageElements: [tableEl('t1',
    row(cell('Skill'), cell('Where')),
    row(cell('Org design'), cell('Trinnex')),
    row(cell(''), cell('ignored')),
    row(cell('P&L ownership'), cell('eMoney')),
  )] }))[0]
  const col = columnOf(t, 0)
  assert.equal(col.header, 'Skill')
  assert.deepEqual(col.values, ['Org design', 'P&L ownership'], 'blank cells drop out of values')
  // Out-of-range is null, not an exception and not an empty column that reads as "nothing there".
  assert.equal(columnOf(t, 9), null)
  assert.equal(columnOf(t, -1), null)
  assert.equal(columnOf(null, 0), null)
})

test('H:preview-does-not-truncate', () => {
  // The whole point of the preview is that the owner SEES what is in the deck. A three-row sample
  // would make a column look tidier and shorter than it is, which is the same misrepresentation as
  // a fabricated entry, just in the flattering direction.
  const rows = Array.from({ length: 40 }, (_, i) => row(cell(`skill ${i}`)))
  const t = extractSlideTables(deck({ pageElements: [tableEl('t1', row(cell('Skill')), ...rows)] }))
  const p = previewTables(t)[0]
  assert.equal(p.rows, 41)
  assert.deepEqual(p.headers, ['Skill'])
  assert.equal(p.sample.length, 40, 'every body row must be shown, not a sample of them')
})

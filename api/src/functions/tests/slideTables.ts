/**
 * Reading TABLES out of a Google Slides presentation, as a grid rather than as flattened prose.
 *
 * Pure functions here — no fetch, no Google client — so `node --test` can exercise the traversal
 * against real API-shaped fixtures. The route that calls Google passes the parsed JSON straight in.
 *
 * WHY THIS EXISTS, and why the existing reader could not do it. `templateText()`
 * (`packetTemplates.ts:222`) already reads Slides, so "nothing can read Slides" is FALSE. But it
 * runs everything through `collectText`, which is four lines of "push every `content` string you
 * find, in document order, then join". Structure does not survive that: a table becomes a run of
 * words with no rows, no columns and no cell boundaries — so "the appropriate column from the
 * portfolio slide" is unrecoverable from its output. That is the real gap, and it is narrower than
 * "cannot read Slides": the transport works, the SHAPE is thrown away.
 *
 * AND THE DOCS READER DOES NOT TRANSFER. `diagDocStructure.ts:41-43` is the only place in the repo
 * that touches `tableCells`, and it walks the **Docs** shape: `document.body.content[]` →
 * `table.tableRows[].tableCells[].content`. Slides nests differently —
 * `presentation.slides[].pageElements[].table.tableRows[].tableCells[].text.textElements[].textRun.content`.
 * Same nouns, different root and a different leaf. Reusing the Docs walk would silently return
 * nothing, which reads as "the deck has no tables" rather than "I looked in the wrong place".
 */

/** One table, as a grid. Rows are in document order; every row is padded to the same width. */
export interface SlideTable {
  /** 1-based slide number, so it matches what the owner sees in the deck. */
  slide: number
  /** The Slides objectId, for anyone who needs to go back to the source element. */
  objectId: string | null
  rows: number
  columns: number
  /** `cells[rowIndex][columnIndex]`. Never ragged — a missing cell is an empty string, not undefined. */
  cells: string[][]
}

/** Join the text runs inside ONE Slides table cell. */
function cellText(cell: any): string {
  const els = cell?.text?.textElements
  if (!Array.isArray(els)) return ''
  const out: string[] = []
  for (const el of els) {
    const c = el?.textRun?.content
    if (typeof c === 'string') out.push(c)
  }
  // Trim only the edges. Interior newlines are the owner's own line breaks inside a cell and are
  // what `splitSkillField` will later split on, so destroying them here would merge separate skills
  // into one term — fabrication by concatenation.
  return out.join('').replace(/^\s+|\s+$/g, '')
}

/**
 * Extract every table in a Slides presentation, in slide order.
 *
 * Returns `[]` for a presentation with no tables. That is a RESULT, not an error: a deck can
 * legitimately have none, and reporting it as an empty grid rather than throwing lets the caller
 * say "no tables found" instead of "the read failed".
 */
export function extractSlideTables(presentation: any): SlideTable[] {
  const slides = presentation?.slides
  if (!Array.isArray(slides)) return []
  const out: SlideTable[] = []
  slides.forEach((slide: any, i: number) => {
    const elements = slide?.pageElements
    if (!Array.isArray(elements)) return
    for (const el of elements) {
      const t = el?.table
      if (!t || !Array.isArray(t.tableRows)) continue
      const cells: string[][] = t.tableRows.map((row: any) =>
        (Array.isArray(row?.tableCells) ? row.tableCells : []).map((c: any) => cellText(c)))
      // Pad to the widest row. A ragged grid makes `columnOf` return undefined for some rows and a
      // string for others, and the caller cannot tell "empty cell" from "row too short".
      const width = cells.reduce((n: number, r: string[]) => Math.max(n, r.length), 0)
      for (const r of cells) while (r.length < width) r.push('')
      out.push({
        slide: i + 1,
        objectId: typeof el.objectId === 'string' ? el.objectId : null,
        rows: cells.length,
        columns: width,
        cells,
      })
    }
  })
  return out
}

/**
 * One column of a table, by index, with the header separated from the body.
 *
 * `header` is row 0 — a CONVENTION, not a detection. Deliberately not guessed: sniffing which row
 * is a header (bold? shaded? shorter?) is exactly the kind of cleverness that is right most of the
 * time and silently wrong the rest, and being wrong here means the owner's first real skill is
 * dropped as a heading. The caller shows the owner the grid and the owner says which column;
 * nothing here infers intent.
 */
export function columnOf(table: SlideTable, index: number): { header: string; values: string[] } | null {
  if (!table || index < 0 || index >= table.columns) return null
  const col = table.cells.map((r) => r[index] ?? '')
  return { header: col[0] ?? '', values: col.slice(1).filter((v) => v.trim() !== '') }
}

/**
 * A compact preview of every table, for showing a human before anything is chosen.
 *
 * Values are NOT truncated. A shortened preview would make a column look tidier than it is, and the
 * entire reason this is shown first is so the owner sees what is actually in their deck.
 */
export function previewTables(tables: SlideTable[]): {
  slide: number; rows: number; columns: number; headers: string[]; sample: string[][]
}[] {
  return tables.map((t) => ({
    slide: t.slide,
    rows: t.rows,
    columns: t.columns,
    headers: t.cells[0] ?? [],
    // Every row after the header. The owner asked to SEE the pool; a sample of three would defeat that.
    sample: t.cells.slice(1),
  }))
}

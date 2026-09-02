// Unit tests for api/src/functions/tests/diagDocLayout.ts — the READ-ONLY /api/diag/doc-layout
// diagnostic that answers "how many lines does this resume list actually have room for".
//   cd api && npm test
//
// THE FIXTURES ARE API-SHAPED ON PURPOSE, and specifically they are the DOCS shape:
//   document.body.content[].paragraph.elements[].textRun.content
//   document.body.content[].table.tableRows[].tableCells[].content[]
// which is NOT the Slides shape that slideTables.ts walks
// (presentation.slides[].pageElements[].table.tableRows[].tableCells[].text.textElements[]).
// `slideTables.test.mjs:5-12` records that this repo has shipped guards written against a shape the
// producer never emits three separate times. Same nouns, different root and a different leaf.
//
// Nothing here touches Google or Postgres. Every function under test is pure by construction.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractPlaceholderSites,
  extractSections,
  countableLines,
  parseDocId,
  unreadableDoc,
  docReport,
} from '../dist/functions/tests/diagDocLayout.js'

// ── Docs-API fixture builders ────────────────────────────────────────────────────────────────────
const para = (text, opts = {}) => ({
  paragraph: {
    elements: [{ textRun: { content: text } }],
    paragraphStyle: { namedStyleType: opts.style || 'NORMAL_TEXT' },
    ...(opts.bullet ? { bullet: { listId: 'l1', nestingLevel: opts.nesting ?? 0 } } : {}),
  },
})
const cell = (...content) => ({ content })
const row = (...cells) => ({ tableCells: cells })
const table = (rows, columns, ...tableRows) => ({ table: { rows, columns, tableRows } })
const docOf = (...content) => ({ title: 'Resume Template', body: { content } })

// ── 1. the structural question: WHERE does each placeholder sit ──────────────────────────────────

test('H:placeholder-site-reports-its-container — a token in a table cell reports the cell, not just "found"', () => {
  // The owner's real question is whether the LAYOUT constrains a list. Reporting only that
  // {{SkillsBullets1}} exists cannot answer it; reporting that it sits in row 0 / column 0 of a
  // 1x2 table can. diagDocStructure.ts:31-42 collects text runs and tables into SEPARATE lists and
  // so structurally cannot produce this link — that gap is why this function exists.
  const doc = docOf(
    para('PROFESSIONAL SUMMARY', { style: 'HEADING_1' }),
    para('{{ResumeSummary}}'),
    para('CORE SKILLS', { style: 'HEADING_1' }),
    table(1, 2,
      row(cell(para('{{SkillsBullets1}}', { bullet: true })), cell(para('{{SkillsBullets2}}', { bullet: true }))),
    ),
  )
  const sites = extractPlaceholderSites(doc)
  assert.deepEqual(sites.map((s) => s.name), ['ResumeSummary', 'SkillsBullets1', 'SkillsBullets2'])

  const summary = sites[0]
  assert.equal(summary.table, null, 'a bare body paragraph is NOT in a table — reporting one would invent a constraint')
  assert.equal(summary.container, 'paragraph')

  const skills1 = sites[1]
  assert.deepEqual(skills1.table, { tableIndex: 0, rows: 1, columns: 2, rowIndex: 0, columnIndex: 0 })
  assert.equal(skills1.container, 'listItem', 'the Docs API attached a bullet, so it is a real list item')
  assert.equal(skills1.bulletNestingLevel, 0)

  assert.deepEqual(sites[2].table, { tableIndex: 0, rows: 1, columns: 2, rowIndex: 0, columnIndex: 1 })
})

test('H:placeholder-site-distinguishes-bullet-from-paragraph', () => {
  // "Bulleted list item" vs "bare paragraph" is a real structural difference and it must come from
  // the API's own `bullet` object, never from the text starting with a dash — a fuzzy read here
  // would call hand-typed "- Foo" a list item and mis-describe the layout.
  const doc = docOf(para('{{ExpertiseBullets}}', { bullet: true, nesting: 1 }), para('- {{RelevantBullets1}}'))
  const sites = extractPlaceholderSites(doc)
  assert.equal(sites[0].container, 'listItem')
  assert.equal(sites[0].bulletNestingLevel, 1)
  assert.equal(sites[1].container, 'paragraph', 'a leading dash is text, not a bullet')
  assert.equal(sites[1].bulletNestingLevel, null)
})

test('H:placeholder-site-walks-headers-and-footers — a token there is still injected', () => {
  // replaceAllText is document-wide (packetTemplates.ts:204-211), so a placeholder in a header IS
  // filled. diagDocStructure.ts:69-73 records the same reasoning: missing them reports a present
  // token as ABSENT, a false negative that would condemn a working template.
  const doc = {
    title: 'T',
    body: { content: [para('body text')] },
    headers: { h1: { content: [para('{{HeaderThing}}')] } },
    footers: { f1: { content: [para('{{FooterThing}}')] } },
  }
  const sites = extractPlaceholderSites(doc)
  assert.deepEqual(sites.map((s) => [s.name, s.region]), [['HeaderThing', 'header'], ['FooterThing', 'footer']])
})

test('H:doc-layout-reads-the-DOCS-shape-not-the-slides-shape', () => {
  // The Slides nesting must yield nothing here. A reader tolerant of both shapes cannot tell you
  // which one it found, and "the template has no placeholders" then becomes indistinguishable from
  // "I looked in the wrong tree" — the precise confusion this whole route exists to eliminate.
  const slidesShaped = {
    slides: [{ pageElements: [{ table: { tableRows: [{ tableCells: [{ text: { textElements: [{ textRun: { content: '{{SkillsBullets1}}' } }] } }] }] } }] }],
  }
  assert.deepEqual(extractPlaceholderSites(slidesShaped), [])
  assert.deepEqual(extractSections(slidesShaped), [])
})

// ── 2. the printed question: how many LINES did a section actually print ─────────────────────────

test('H:section-lines-count-what-PRINTS — paragraphs and embedded newlines both', () => {
  // Both halves are load-bearing. An owner's own list is separate paragraphs; an injected list
  // arrives through ONE replaceAllText (packetTemplates.ts:204-211) whose newlines can land inside a
  // single paragraph. Counting only paragraphs reports a rendered 8-skill list as 1 line — which is
  // exactly the number the owner is trying to discover, reported wrong.
  const doc = docOf(
    para('CORE SKILLS', { style: 'HEADING_1' }),
    para('Enterprise Architecture\nCloud Strategy\nData Governance'),   // one paragraph, 3 printed lines
    para('Platform Modernization'),
    para('   '),                                                        // blank — prints nothing
    para('RELEVANT EXPERIENCE', { style: 'HEADING_2' }),
    para('Agile Portfolio Mgmt\nSaaS Platforms'),
  )
  const sections = extractSections(doc)
  assert.deepEqual(sections.map((s) => s.heading), ['CORE SKILLS', 'RELEVANT EXPERIENCE'])
  assert.equal(sections[0].lineCount, 4, '3 newline-separated + 1 paragraph; the blank does not print')
  assert.deepEqual(sections[0].lines, ['Enterprise Architecture', 'Cloud Strategy', 'Data Governance', 'Platform Modernization'])
  assert.equal(sections[1].lineCount, 2)
})

test('H:section-split-uses-the-DOCUMENTS-own-heading-style-not-a-guess', () => {
  // Sections come from namedStyleType, the document's own statement of what a heading is. An
  // ALL-CAPS/short heuristic would be right most of the time and silently wrong the rest, and a
  // mis-split section reports a wrong capacity for a real list. Fuzzy matching is for ranking,
  // never for asserting (CLAUDE.md, "Standing rules distilled from those failures").
  const doc = docOf(
    para('SQL, ETL, API DESIGN'),                 // ALL CAPS and short — but NOT a heading
    para('Actual Heading', { style: 'HEADING_2' }),
    para('one'),
  )
  const sections = extractSections(doc)
  assert.equal(sections.length, 2)
  assert.equal(sections[0].heading, null, 'content before the first real heading is the preamble')
  assert.deepEqual(sections[0].lines, ['SQL, ETL, API DESIGN'], 'ALL CAPS text is content, not a section break')
  assert.equal(sections[1].heading, 'Actual Heading')
})

test('H:section-lines-include-table-cell-text — a two-column skills block is one section', () => {
  // The full resume puts its skills in two columns (packetTemplates.ts:31-46 records the owner's
  // words: "the skills are broken into two columns in the regular resume"). If cell text were
  // skipped, the section holding the owner's biggest list would report ZERO lines.
  const doc = docOf(
    para('CORE SKILLS', { style: 'HEADING_1' }),
    table(1, 2,
      row(cell(para('A\nB\nC\nD')), cell(para('E\nF\nG\nH'))),
    ),
  )
  const sections = extractSections(doc)
  assert.equal(sections.length, 1, 'a table does not open a new section')
  assert.equal(sections[0].heading, 'CORE SKILLS')
  assert.equal(sections[0].lineCount, 8, 'the 8 skills the live resume ships, counted across both columns')
})

test('H:countable-lines-counts-soft-breaks-and-drops-blanks', () => {
  // \v is Docs' soft line break (Shift+Enter) and it PRINTS as a new line. Missing it under-reports
  // every list an owner built with soft breaks — the natural way to keep a list inside one cell.
  assert.deepEqual(countableLines('a\vb\r\nc\n\n   \nd'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(countableLines(''), [])
  assert.deepEqual(countableLines(null), [])
  assert.deepEqual(countableLines(undefined), [])
})

// ── 3. the accusation-shaped failure: unreachable must NEVER read as "none" ───────────────────────

test('H:unreachable-google-is-not-zero-placeholders', () => {
  // THE ONE THAT MATTERS. An owner reading `placeholderCount: 0` would conclude the template
  // imposes no layout constraint and set slot counts accordingly — when in fact nobody reached the
  // document. Absent evidence is `not_applicable`, never `pass` (CLAUDE.md); the sibling cases are
  // diagSkillSources.ts:62 and :123-125, both written after this exact confusion.
  const r = unreadableDoc('abc123', 'owner setting', 'Docs API 403 reading abc123')

  assert.equal(r.read, false)
  assert.equal(r.placeholders, null)
  assert.notDeepEqual(r.placeholders, [], 'an empty ARRAY would read as "the template has no placeholders"')
  assert.equal(Array.isArray(r.placeholders), false, 'nothing downstream may .length or .map this into a count of zero')
  assert.equal(r.placeholderCount, null)
  assert.notEqual(r.placeholderCount, 0, 'zero is a measurement; this is the absence of one')
  assert.equal(r.placeholderNames, null)
  assert.equal(r.sections, null)
  assert.equal(r.totalLines, null)
  assert.notEqual(r.totalLines, 0)
  assert.equal(r.text, null)
  assert.match(r.error, /403/, 'the REASON travels with the failure, so a reader can act on it')
})

test('H:read-document-reports-real-counts — the honest branch still works', () => {
  // The guard above is only meaningful if the success path genuinely produces numbers. A route that
  // always returned null would pass the null test and be useless.
  const doc = docOf(para('CORE SKILLS', { style: 'HEADING_1' }), para('{{SkillsBullets1}}\n{{SkillsBullets2}}'))
  const r = docReport('tpl1', 'seed constant', doc)
  assert.equal(r.read, true)
  assert.equal(r.title, 'Resume Template')
  assert.equal(r.placeholderCount, 2)
  assert.deepEqual(r.placeholderNames, ['SkillsBullets1', 'SkillsBullets2'])
  assert.equal(r.totalLines, 2)
  assert.match(r.via.structure, /docs\.googleapis\.com/)
})

test('H:truncation-is-announced-in-the-same-object-as-the-text', () => {
  // A cut sample that does not say it was cut is a sample a reader treats as the whole document.
  const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
  const doc = docOf(para(long))
  const r = docReport('d', 'query', doc, { maxChars: 100, exportedText: long })
  assert.equal(r.text.truncated, true)
  assert.equal(r.text.chars, long.length, 'the FULL length is reported even though the sample is cut')
  assert.match(r.text.sample, /TRUNCATED at 100 chars of/)

  const short = docReport('d', 'query', docOf(para('tiny')), { maxChars: 10000, exportedText: 'tiny' })
  assert.equal(short.text.truncated, false)
  assert.equal(short.text.sample, 'tiny')
})

test('H:drive-export-preferred-for-printed-text-and-its-source-is-named', () => {
  // Two Google approaches answer two questions; a report that does not say which it used cannot be
  // audited. The export is what PRINTS, so it wins for the text sample when present — and its
  // failure degrades the sample to the Docs-derived text rather than removing it.
  const doc = docOf(para('Heading', { style: 'HEADING_1' }), para('from-docs-api'))
  const withExport = docReport('d', 'query', doc, { exportedText: 'from-drive-export' })
  assert.equal(withExport.text.sample, 'from-drive-export')
  assert.match(withExport.via.text, /drive/i)

  const withoutExport = docReport('d', 'query', doc, { exportedText: null })
  assert.match(withoutExport.text.sample, /from-docs-api/)
  assert.match(withoutExport.via.text, /Docs API structure/)
  assert.equal(withoutExport.read, true, 'a failed export must NOT invalidate the structural answer')
  assert.equal(withoutExport.placeholderCount, 0, 'and this document truly has no placeholders — measured, not absent')
})

// ── 4. artifact.doc_url ──────────────────────────────────────────────────────────────────────────

test('H:parse-doc-id-handles-null-doc-url-as-a-state-not-an-error', () => {
  // artifact.doc_url (schema.ts:103) is nullable and a null is ORDINARY — an artifact not yet built.
  // Throwing here would turn a normal state into a 500 and hide every other document in the report.
  assert.equal(parseDocId(null), null)
  assert.equal(parseDocId(undefined), null)
  assert.equal(parseDocId(''), null)
  assert.equal(parseDocId('   '), null)
})

test('H:parse-doc-id-extracts-from-the-url-shapes-this-repo-actually-writes', () => {
  // packetTemplates/mt05.ts:60 writes `https://docs.google.com/document/d/${docId}/edit`.
  assert.equal(
    parseDocId('https://docs.google.com/document/d/1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw/edit'),
    '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw',
  )
  assert.equal(
    parseDocId('https://docs.google.com/presentation/d/1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec/edit#slide=id.p'),
    '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec',
  )
  assert.equal(parseDocId('https://drive.google.com/open?id=1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'),
    '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw')
  // A bare id, so the owner may paste either.
  assert.equal(parseDocId('1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'), '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw')
  // Something URL-shaped that matched nothing must be null, NOT a guess. Reporting structure for
  // the wrong document is worse than reporting none.
  assert.equal(parseDocId('https://example.com/not-a-doc'), null)
  assert.equal(parseDocId('nope'), null)
})

// ── 5. the route is READ-ONLY, enforced structurally ─────────────────────────────────────────────

test('H:doc-layout-route-is-read-only — no mutating Google or SQL verb in the source', async () => {
  // A source grep rather than a behavioural test, because the invariant is structural: this route is
  // ANONYMOUS (authLevel: 'anonymous'), so any mutation reachable from it is reachable by anyone.
  // The sibling route it deliberately does not extend, diagDocStructure.ts:154-157, COPIES a Drive
  // file on a plain GET — that is the regression this guard refuses to let creep in here.
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../src/functions/tests/diagDocLayout.ts', import.meta.url), 'utf8')
  // Strip comments first: this file's prose NAMES the forbidden calls when explaining why it does
  // not make them, and a guard that fires on its own rationale is the cry-wolf failure hardening
  // rule 2 forbids ("Two guards fired on a comment ... when first written").
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  for (const forbidden of ['batchUpdate', 'files/copy', '/copy`', 'shareAnyone', 'copyTemplate', 'deleteDriveFile', 'permissions']) {
    assert.ok(!code.includes(forbidden), `diagDocLayout.ts must not reference ${forbidden} — it is a read-only diagnostic`)
  }
  for (const verb of [/method:\s*'POST'/, /method:\s*'DELETE'/, /method:\s*'PATCH'/, /method:\s*'PUT'/]) {
    assert.ok(!verb.test(code), `diagDocLayout.ts must issue no ${verb} request`)
  }
  // The single SQL statement must be a SELECT.
  const sql = code.match(/client\.query\(\s*'([^']+)'/)
  assert.ok(sql, 'the artifact lookup should still be present')
  assert.match(sql[1].trim(), /^select /i, 'the only SQL this route runs must be a SELECT')
  assert.ok(!/\b(insert|update|delete)\b/i.test(sql[1]), 'no write verb may appear in the SQL')

  // And it registers exactly one route, its own.
  const routes = [...code.matchAll(/app\.http\(/g)]
  assert.equal(routes.length, 1, 'this file registers only its own route')
  assert.match(code, /route: 'diag\/doc-layout'/)
})

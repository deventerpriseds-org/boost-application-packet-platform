import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'
import { RESUME_TEMPLATE_ID, metaFor } from './packetTemplates'
import { loadPipelineSettings } from './pipelineConfig'
import { getPgClient } from './pgClient'

/**
 * GET /api/diag/doc-layout — READ-ONLY. What a human would look at if they opened the resume
 * template and a finished resume side by side, expressed as JSON.
 *
 * WHY THIS EXISTS. The owner sets per-template "slot counts" — how many lines each resume list has
 * room for — and nothing in this system can currently tell them the real number, so the number gets
 * guessed. The reason it gets guessed is structural, not an oversight:
 *
 *   The template's placeholders are exactly {{ExpertiseBullets}} {{RelevantBullets1..3}}
 *   {{ResumeSummary}} {{SkillsBullets1}} {{SkillsBullets2}} and nothing else
 *   (`diagSkillSources.ts:16-22`, proven live at api-test run 32973162995; the same set is restated
 *   at `config.ts:134` and `slots.ts:19`).
 *
 * ONE token per list. It expands to whatever `injectValues` (`packetTemplates.ts:204`) puts there,
 * so the template's TEXT cannot state a capacity — a capacity is a fact about the PRINTED PAGE.
 * Counting `{{...}}` occurrences answers "how many lists", never "how many lines fit". Hence the two
 * halves below, which are the two things a human actually looks at:
 *
 *   1. WHERE each placeholder sits — bare paragraph, list item, or table cell (and if a cell, the
 *      table's dimensions and the cell's indices). That is what says whether the LAYOUT physically
 *      constrains a list. A one-row table cell constrains; a bulleted paragraph in open body text
 *      does not.
 *   2. WHAT a rendered document actually printed — the text per section with a line count, so the
 *      owner can see what "8 skills in list 1" and "3 / 2 / 3 relevant items" look like on the page.
 *      (Those measured figures are the parent session's, established today against the live app;
 *      this route is how they stop being someone's recollection.)
 *
 * WHY NOT `diag/doc-structure`, WHICH ALREADY EXISTS. `diagDocStructure.ts` reads the same template
 * and already reports a placeholder inventory, page size, margins and a table list — so "nothing can
 * read the Doc" would be a false claim. Three specific gaps, each read off that file:
 *   - its `fingerprint()` flattens every text run into ONE array (`:31-36`) and regexes the JOINED
 *     string (`:80-81`), while tables go into a SEPARATE list (`:42`). Nothing links a placeholder to
 *     its container, which is question 1 entirely.
 *   - it discards the document text after the placeholder regex, so question 2 has no answer there.
 *   - it is NOT read-only: `:154-157` defaults `copy` to on, so a plain GET COPIES a Drive file, and
 *     `:150` calls `shareAnyone` on the template (a permissions write). A diagnostic you cannot run
 *     without mutating Drive is one people avoid running.
 * Auth, the owner-resolved template id and the expected-placeholder set are IMPORTED from the
 * existing modules rather than re-implemented — the duplication that matters is a second auth path
 * or a second idea of which template is live, and neither exists here.
 *
 * READ-ONLY IS A HARD PROPERTY OF THIS FILE. Every Google call below is a GET. There is no
 * `files/copy`, no `:batchUpdate`, no `permissions`, no DELETE, and the one SQL statement is a
 * SELECT. A diagnostic that can mutate is a footgun, and this one is reached by an anonymous route.
 */

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Default cap on the raw exported text returned per document. `?maxChars=` overrides. */
const DEFAULT_MAX_CHARS = 20000

// ── pure parsing: everything below this line is unit-tested in api/test/docLayout.test.mjs ────────
// No fetch, no Google client, no pg. The route hands the parsed JSON straight in. This is the
// slideTables.ts arrangement (`slideTables.ts:4-6`) and it exists for the same reason: a traversal
// that can only be exercised by calling Google is a traversal nobody exercises.

/** Where one `{{Placeholder}}` occurrence physically sits in a Google Doc. */
export interface PlaceholderSite {
  /** The token as written, e.g. `{{SkillsBullets1}}`. */
  token: string
  /** The token without braces, e.g. `SkillsBullets1` — matches `TEMPLATE_META.placeholders`. */
  name: string
  /** Which tree it was found in. A placeholder in a header/footer is still injected: `replaceAllText` is document-wide. */
  region: 'body' | 'header' | 'footer'
  /**
   * The paragraph's own shape.
   * `listItem` means the Docs API attached a `bullet` to the paragraph — a REAL bulleted/numbered
   * list, not a paragraph that merely starts with a dash.
   */
  container: 'paragraph' | 'listItem'
  /** `NORMAL_TEXT`, `HEADING_2`, `TITLE`, … — the Docs API's own name for the paragraph style. */
  namedStyleType: string | null
  /** Bullet nesting depth when `container === 'listItem'`, else null. */
  bulletNestingLevel: number | null
  /**
   * The enclosing table cell, when there is one. THIS IS THE FIELD THE SLOT-COUNT QUESTION TURNS ON:
   * a list inside a fixed cell is constrained by the cell; a list in open body text is not.
   * `tableIndex` is 0-based in document order over the tables encountered in the same region.
   */
  table: { tableIndex: number; rows: number; columns: number; rowIndex: number; columnIndex: number } | null
  /** The full text of the paragraph the token sits in, trimmed. Context for a human reading the JSON. */
  paragraphText: string
}

/** One heading-delimited run of the document, with what it printed. */
export interface DocSection {
  /** The heading text that opened this section; null for content before the first heading. */
  heading: string | null
  /** The Docs API `namedStyleType` of that heading paragraph, e.g. `HEADING_1`. */
  headingStyle: string | null
  /**
   * Printed lines in this section, excluding the heading itself and excluding blank lines.
   *
   * A "line" here is one paragraph, further split on any embedded `\n`. Both halves are needed:
   * an owner's own list is separate paragraphs, while `injectValues` writes a whole list through a
   * single `replaceAllText` (`packetTemplates.ts:204-211`) whose newlines may land inside one
   * paragraph. Counting only paragraphs would report an injected 8-item list as 1 line.
   */
  lines: string[]
  lineCount: number
  charCount: number
}

/** Read the plain text out of one Docs API paragraph element. */
function paragraphText(paragraph: any): string {
  const out: string[] = []
  for (const el of (paragraph?.elements || [])) {
    const t = el?.textRun?.content
    if (typeof t === 'string') out.push(t)
  }
  return out.join('')
}

/**
 * Split a block of document text into printed, non-blank lines.
 *
 * Exported because it is the one arithmetic the owner's slot count rests on, and an off-by-one here
 * would silently move every capacity number this route reports.
 */
export function countableLines(text: string): string[] {
  return String(text == null ? '' : text)
    // Docs uses \v (vertical tab) for a soft line break inside a paragraph — Shift+Enter. It PRINTS
    // as a new line, so it counts as one. Missing this under-reports every list an owner built with
    // soft breaks, which is the natural way to keep a list inside one table cell.
    .split(/\r\n|\r|\n|\v/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

const TOKEN_RE = /\{\{@?[^}\n]{1,80}\}\}/g

/**
 * Every `{{Placeholder}}` in a Docs API document, WITH the structural context of each occurrence.
 *
 * Returns `[]` for a document that genuinely contains none. The caller must never turn an
 * unreachable document into this value — see `unreadableDoc()`.
 */
export function extractPlaceholderSites(doc: any): PlaceholderSite[] {
  const sites: PlaceholderSite[] = []

  const walk = (
    content: any[],
    region: 'body' | 'header' | 'footer',
    cell: PlaceholderSite['table'],
    tableCounter: { n: number },
  ) => {
    for (const el of (content || [])) {
      if (el?.paragraph) {
        const text = paragraphText(el.paragraph)
        const bullet = el.paragraph.bullet
        for (const token of (text.match(TOKEN_RE) || [])) {
          sites.push({
            token: token.trim(),
            name: token.trim().replace(/^\{\{|\}\}$/g, ''),
            region,
            container: bullet ? 'listItem' : 'paragraph',
            namedStyleType: el.paragraph.paragraphStyle?.namedStyleType ?? null,
            bulletNestingLevel: bullet ? (bullet.nestingLevel ?? 0) : null,
            table: cell,
            paragraphText: text.trim(),
          })
        }
      }
      if (el?.table) {
        const t = el.table
        const tableIndex = tableCounter.n++
        // `t.rows`/`t.columns` are the API's own counts; fall back to the array lengths so a
        // response that omits them still reports real dimensions rather than null.
        const rows = typeof t.rows === 'number' ? t.rows : (t.tableRows || []).length
        const columns = typeof t.columns === 'number'
          ? t.columns
          : ((t.tableRows || [])[0]?.tableCells || []).length
        ;(t.tableRows || []).forEach((row: any, rowIndex: number) => {
          ;(row?.tableCells || []).forEach((c: any, columnIndex: number) => {
            walk(c?.content, region, { tableIndex, rows, columns, rowIndex, columnIndex }, tableCounter)
          })
        })
      }
      // A tableOfContents also holds paragraphs; a placeholder is not expected there, but walking it
      // costs nothing and NOT walking it would report a real token as absent.
      if (el?.tableOfContents?.content) walk(el.tableOfContents.content, region, cell, tableCounter)
    }
  }

  walk(doc?.body?.content, 'body', null, { n: 0 })
  // header walk removed
  for (const box of Object.values(doc?.footers || {})) walk((box as any)?.content, 'footer', null, { n: 0 })
  return sites
}

/**
 * The document's body split into sections at its HEADING paragraphs, with a line count for each.
 *
 * Sections come from the document's own `namedStyleType`, not from a guess about which lines look
 * like headings. A heuristic ("ALL CAPS and short") would be right most of the time and silently
 * wrong the rest, and this repo's standing rule is that fuzzy matching is for ranking, never for
 * asserting — a mis-split section reports a wrong capacity for a real list.
 */
export function extractSections(doc: any): DocSection[] {
  const sections: DocSection[] = [{ heading: null, headingStyle: null, lines: [], lineCount: 0, charCount: 0 }]

  const push = (text: string) => {
    const cur = sections[sections.length - 1]
    for (const line of countableLines(text)) {
      cur.lines.push(line)
      cur.charCount += line.length
    }
  }

  const walk = (content: any[]) => {
    for (const el of (content || [])) {
      if (el?.paragraph) {
        const style = el.paragraph.paragraphStyle?.namedStyleType || ''
        const text = paragraphText(el.paragraph)
        const isHeading = /^(TITLE|SUBTITLE|HEADING_\d+)$/.test(style)
        if (isHeading && text.trim()) {
          sections.push({ heading: text.trim(), headingStyle: style, lines: [], lineCount: 0, charCount: 0 })
        } else {
          push(text)
        }
      }
      if (el?.table) {
        // Cell text belongs to whichever section the table sits in. A table does not open a section:
        // a two-column skills table would otherwise fragment one printed block into many.
        for (const row of (el.table.tableRows || [])) for (const c of (row?.tableCells || [])) walk(c?.content)
      }
      if (el?.tableOfContents?.content) walk(el.tableOfContents.content)
    }
  }
  walk(doc?.body?.content)

  for (const s of sections) s.lineCount = s.lines.length
  // Drop a leading preamble that captured nothing, so the output does not open with an empty row.
  return sections.filter((s, i) => i > 0 || s.lineCount > 0)
}

/** One document as this route reports it. `placeholders === null` means NOT READ, never "none found". */
export interface DocReport {
  docId: string
  /** How this document was named, so a surprising id is traceable to the setting that produced it. */
  idSource: string
  read: boolean
  error?: string
  title: string | null
  /** Which Google API produced each half. Stated because the two answer different questions. */
  via: { structure: string; text: string }
  placeholders: PlaceholderSite[] | null
  placeholderCount: number | null
  /** Distinct token names, sorted — the quick answer to "which lists does this document have". */
  placeholderNames: string[] | null
  sections: DocSection[] | null
  totalLines: number | null
  text: { chars: number; truncated: boolean; sample: string } | null
}

/**
 * A document that could NOT be read, as a report.
 *
 * THIS IS THE MOST IMPORTANT FUNCTION IN THE FILE, and it is four lines. The failure it exists to
 * prevent is the one this repo has already been bitten by and encoded twice — `diagSkillSources.ts:62`
 * ("An empty table is a RESULT to report, never an empty pool to seed from silently") and
 * `diagSkillSources.ts:123-125` ("Returning an empty table list here would be indistinguishable from
 * 'the deck has no tables'"). The same shape here is worse: an owner setting slot counts off a
 * response that says the template has ZERO placeholders would conclude the layout imposes no
 * constraint, when in fact nobody ever reached the document.
 *
 * So `placeholders` is `null`, never `[]`, and `read` is false. Absent evidence is not a finding.
 */
export function unreadableDoc(docId: string, idSource: string, error: string, via?: Partial<DocReport['via']>): DocReport {
  return {
    docId, idSource, read: false, error, title: null,
    via: { structure: via?.structure || 'not attempted', text: via?.text || 'not attempted' },
    placeholders: null, placeholderCount: null, placeholderNames: null,
    sections: null, totalLines: null, text: null,
  }
}

/** Build the report for a document whose Docs API JSON was successfully fetched. */
export function docReport(
  docId: string,
  idSource: string,
  doc: any,
  opts: { maxChars?: number; exportedText?: string | null; textVia?: string } = {},
): DocReport {
  const maxChars = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : DEFAULT_MAX_CHARS
  const placeholders = extractPlaceholderSites(doc)
  const sections = extractSections(doc)
  // Prefer the Drive plain-text export when the caller fetched one — it is what the document
  // PRINTS. Fall back to the section lines, which come from the same Docs JSON we already hold, so
  // a Drive-export failure degrades the text sample rather than removing it.
  const full = opts.exportedText != null
    ? opts.exportedText
    : sections.flatMap((s) => (s.heading ? [s.heading, ...s.lines] : s.lines)).join('\n')
  return {
    docId, idSource, read: true, title: doc?.title ?? null,
    via: {
      structure: 'Docs API GET https://docs.googleapis.com/v1/documents/{id}',
      text: opts.textVia || (opts.exportedText != null
        ? 'Drive export GET /drive/v3/files/{id}/export?mimeType=text/plain'
        : 'derived from the Docs API structure (Drive export not used)'),
    },
    placeholders,
    placeholderCount: placeholders.length,
    placeholderNames: [...new Set(placeholders.map((p) => p.name))].sort(),
    sections,
    totalLines: sections.reduce((n, s) => n + s.lineCount, 0),
    text: {
      chars: full.length,
      truncated: full.length > maxChars,
      // Truncation is announced in the same object as the text, so a reader can never mistake a cut
      // sample for the whole document.
      sample: full.length > maxChars ? `${full.slice(0, maxChars)}\n…[TRUNCATED at ${maxChars} chars of ${full.length}]` : full,
    },
  }
}

/**
 * The Google file id inside an `artifact.doc_url`.
 *
 * `artifact.doc_url` (`schema.ts:103`) is nullable, and a null there is an ordinary state — an
 * artifact that has not been built yet. Returning null rather than throwing keeps that case a
 * reported fact instead of a 500. Accepts a bare id so an owner can paste either.
 */
export function parseDocId(docUrl: string | null | undefined): string | null {
  const s = String(docUrl == null ? '' : docUrl).trim()
  if (!s) return null
  const m = s.match(/\/(?:document|presentation|spreadsheets|file)\/d\/([A-Za-z0-9_-]{10,})/)
  if (m) return m[1]
  const q = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (q) return q[1]
  // A bare id: Drive ids are long and have no slashes. Anything URL-shaped that got here did not
  // match the patterns above, and guessing at it would report structure for the wrong document.
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s
  return null
}

// ── the route ─────────────────────────────────────────────────────────────────────────────────────

async function fetchDoc(token: string, id: string): Promise<{ ok: true; doc: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { ok: false, error: `Docs API ${res.status} reading ${id}: ${(await res.text()).slice(0, 200)}` }
    return { ok: true, doc: await res.json() }
  } catch (err: any) {
    return { ok: false, error: `Docs API unreachable for ${id}: ${String(err?.message || err)}` }
  }
}

/** Drive plain-text export. Best-effort: its failure degrades the text sample, never the structure. */
async function fetchExportText(token: string, id: string): Promise<{ text: string | null; via: string }> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fplain`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      return { text: null, via: `Drive export FAILED (${res.status}) — text below is derived from the Docs API structure instead` }
    }
    return { text: await res.text(), via: 'Drive export GET /drive/v3/files/{id}/export?mimeType=text/plain' }
  } catch (err: any) {
    return { text: null, via: `Drive export unreachable (${String(err?.message || err)}) — text below is derived from the Docs API structure instead` }
  }
}

/** The artifact row, read-only. Returns the row or the reason there isn't one. */
async function readArtifact(artifactId: string): Promise<{ row: any | null; error?: string }> {
  let client: any = null
  try {
    client = await getPgClient()
    // SELECT ONLY. This route has no write path by construction.
    const r = await client.query(
      'select id, packet_id, type, status, template_id, doc_url from artifact where id = $1',
      [artifactId],
    )
    return { row: r.rows[0] || null, error: r.rows[0] ? undefined : `no artifact row with id ${artifactId}` }
  } catch (err: any) {
    return { row: null, error: `artifact lookup failed: ${String(err?.message || err)}` }
  } finally {
    if (client) { try { await client.end() } catch { /* closing a broken client must not mask the real error */ } }
  }
}

export async function diagDocLayout(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }

  const queryTemplateId = (req.query.get('templateId') || '').trim()
  const artifactId = (req.query.get('artifactId') || '').trim()
  const expectType = (req.query.get('type') || 'resume').trim()
  const maxChars = Number(req.query.get('maxChars') || '') > 0 ? Number(req.query.get('maxChars')) : DEFAULT_MAX_CHARS

  try {
    // Which template the PRODUCTION builder would copy, not whichever id the seed table holds.
    // `source`, not truthiness: `resolveText` never returns '' (`pipelineConfig.ts:192` and the
    // comment at `diagDocStructure.ts:116-121` — testing truthiness made that route's seed branch
    // dead and made every audit claim "owner setting", including when the owner's id was REJECTED).
    const settings = await loadPipelineSettings().catch(() => null)
    const resumeSetting = settings ? settings.resumeTemplateId : null
    const templateId = (queryTemplateId || (resumeSetting && resumeSetting.value) || RESUME_TEMPLATE_ID).trim()
    const templateIdSource = queryTemplateId ? 'query (?templateId=)'
      : !resumeSetting ? 'seed constant — pipeline settings could not be read'
      : resumeSetting.source === 'config' ? 'owner setting (google.resumeTemplateId)'
      : 'seed constant — no owner setting is configured'
    const templateIdNote = (!queryTemplateId && resumeSetting && resumeSetting.reason) ? resumeSetting.reason : undefined

    // The placeholder set this artifact type actually injects, from the SAME table `varsForType`
    // reads (`packetTemplates.ts:120-127`), so "expected but not found" means "this slot will be
    // empty in every packet" rather than "this doc differs from some other doc".
    const expectMeta = metaFor(expectType)
    const expected = expectMeta ? expectMeta.placeholders : []

    let token: string
    try {
      token = HAS_GOOGLE_OAUTH
        ? await getGoogleOAuthToken()
        : await getGoogleToken(
            process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
            'https://www.googleapis.com/auth/documents.readonly https://www.googleapis.com/auth/drive.readonly',
            IMPERSONATE_SUBJECT,
          )
    } catch (err: any) {
      // NO TOKEN MEANS NO EVIDENCE. `ok:false`, and every document reports `placeholders: null`.
      // Returning `ok:true` with an empty inventory here is the exact failure this route is built
      // to refuse: it would read as "the template has no placeholders", and an owner would set slot
      // counts believing the layout constrains nothing.
      const reason = `Google auth failed: ${String(err?.message || err)}`
      return {
        status: 200, headers: HEADERS,
        jsonBody: {
          ok: false, error: reason,
          templateId, templateIdSource, templateIdNote, expectType, expectedPlaceholders: expected,
          template: unreadableDoc(templateId, templateIdSource, reason),
          artifact: artifactId ? { artifactId, error: reason, doc: unreadableDoc('', 'artifact.doc_url', reason) } : null,
        },
      }
    }

    // 1. THE TEMPLATE — structure. Docs API, because only it distinguishes a bulleted list item in
    //    open body text from a paragraph pinned inside a fixed table cell. A flat export cannot.
    const tplFetch = await fetchDoc(token, templateId)
    let template: DocReport
    if (!tplFetch.ok) {
      template = unreadableDoc(templateId, templateIdSource, tplFetch.error, { structure: 'Docs API — FAILED' })
    } else {
      const exp = await fetchExportText(token, templateId)
      template = docReport(templateId, templateIdSource, tplFetch.doc, { maxChars, exportedText: exp.text, textVia: exp.via })
    }

    // Only meaningful when the template was actually READ. `null` otherwise — a "missing" list
    // computed against an inventory nobody fetched is an accusation with no evidence behind it.
    const missingPlaceholders = template.read && expected.length
      ? expected.filter((e) => !(template.placeholderNames || []).includes(e))
      : null

    // 2. A RENDERED DOCUMENT — what actually printed. `artifact.doc_url` (`schema.ts:103`) holds it;
    //    the id is parsed out of the URL so the owner never has to paste one, and a null doc_url is
    //    an ordinary unbuilt artifact rather than an error.
    let artifact: any = null
    if (artifactId) {
      const { row, error } = await readArtifact(artifactId)
      if (!row) {
        artifact = { artifactId, error, doc: unreadableDoc('', 'artifact.doc_url', error || 'artifact not found') }
      } else {
        const docId = parseDocId(row.doc_url)
        if (!docId) {
          const reason = row.doc_url
            ? `artifact.doc_url is set but no Google file id could be parsed from it: ${String(row.doc_url).slice(0, 200)}`
            : 'artifact.doc_url is null — this artifact has not been rendered yet'
          artifact = {
            artifactId, type: row.type, status: row.status, templateId: row.template_id, docUrl: row.doc_url || null,
            error: reason, doc: unreadableDoc('', 'artifact.doc_url', reason),
          }
        } else {
          const gen = await fetchDoc(token, docId)
          let doc: DocReport
          if (!gen.ok) {
            doc = unreadableDoc(docId, 'artifact.doc_url', gen.error, { structure: 'Docs API — FAILED' })
          } else {
            const exp = await fetchExportText(token, docId)
            doc = docReport(docId, 'artifact.doc_url', gen.doc, { maxChars, exportedText: exp.text, textVia: exp.via })
          }
          artifact = {
            artifactId, type: row.type, status: row.status, templateId: row.template_id,
            docUrl: row.doc_url, docId, doc,
          }
        }
      }
    }

    // `ok` tracks whether the EVIDENCE was obtained, not whether the HTTP handler survived. A caller
    // must be able to branch on one field to know whether the numbers below are real.
    const ok = template.read && (!artifactId || !!(artifact && artifact.doc && artifact.doc.read))

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok,
        readOnly: true,
        templateId, templateIdSource, templateIdNote,
        expectType,
        expectTypeNote: expectMeta ? undefined : `unknown artifact type "${expectType}" — no placeholder set to check against`,
        expectedPlaceholders: expected,
        missingPlaceholders,
        template,
        artifact,
        note: 'A slot count is a fact about the PRINTED PAGE, not about the template text: one token per list expands to whatever is injected. Read `template.placeholders[].table` for whether a list sits in a fixed cell, and `artifact.doc.sections[].lineCount` for what a real build printed.',
      },
    }
  } catch (err: any) {
    // Even the catch-all refuses to imply an empty inventory.
    return {
      status: 200, headers: HEADERS,
      jsonBody: { ok: false, error: String(err?.message || err), template: unreadableDoc('', 'unknown', String(err?.message || err)), artifact: null },
    }
  }
}

app.http('diagDocLayout', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/doc-layout', handler: diagDocLayout,
})

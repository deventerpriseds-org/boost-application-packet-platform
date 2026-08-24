import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'
import { RESUME_TEMPLATE_ID, copyTemplate, shareAnyone, metaFor } from './packetTemplates'
import { loadPipelineSettings } from './pipelineConfig'

// GET /api/diag/doc-structure — structural fingerprint of the resume template vs a
// pure copy (copy step only, no injection) vs a generated doc, so we can DIFF the
// exact fields that distort a layout: table column widths, image size/crop, page
// size + margins. This exists to trace WHY generated resumes come out with squished
// columns / skewed images when the source template renders correctly. Read-only
// (it only reads doc JSON + makes docs link-readable); the pure copy is a throwaway.

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

async function getDoc(token: string, id: string): Promise<any> {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`get ${id} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// A dimension in the Docs API is { magnitude, unit }. Round for readable diffs.
function dim(v: any): number | null { return v && typeof v.magnitude === 'number' ? Math.round(v.magnitude) : null }

// Pull only the fields that can cause visible distortion.
function fingerprint(doc: any, expectPlaceholders?: string[]) {
  const ds = doc.documentStyle || {}
  const tables: any[] = []
  // Every text run in the document, including inside table cells, headers and footers. Collected on
  // the SAME walk as the tables so a placeholder parked in a table cell is not missed -- which is
  // exactly where a compact resume is most likely to put one.
  const textRuns: string[] = []
  const walk = (nodes: any[]) => {
    for (const el of (nodes || [])) {
      for (const pe of (el.paragraph?.elements || [])) {
        const t = pe.textRun?.content
        if (typeof t === 'string') textRuns.push(t)
      }
      if (el.table) {
        const t = el.table
        const columnProps = (t.tableStyle?.tableColumnProperties || []).map((c: any) => ({ widthType: c.widthType, width: dim(c.width) }))
        const firstRowCellWidths = (t.tableRows?.[0]?.tableCells || []).map((c: any) => dim(c.tableCellStyle?.width))
        tables.push({ rows: t.rows, columns: t.columns, columnProps, firstRowCellWidths })
        for (const row of (t.tableRows || [])) for (const cell of (row.tableCells || [])) walk(cell.content)
      }
    }
  }
  walk(doc.body?.content)

  const images: any[] = []
  const addObjs = (map: any, kind: string) => {
    for (const k of Object.keys(map || {})) {
      const props = map[k]?.inlineObjectProperties || map[k]?.positionedObjectProperties
      const eo = props?.embeddedObject
      if (!eo) continue
      const size = eo.size || {}
      const crop = eo.imageProperties?.cropProperties
      images.push({
        kind, id: k,
        w: dim(size.width), h: dim(size.height),
        ratio: (dim(size.width) && dim(size.height)) ? Number((dim(size.width)! / dim(size.height)!).toFixed(3)) : null,
        crop: crop ? { l: crop.offsetLeft || 0, r: crop.offsetRight || 0, t: crop.offsetTop || 0, b: crop.offsetBottom || 0, angle: crop.angle || 0 } : null,
      })
    }
  }
  addObjs(doc.inlineObjects, 'inline')
  addObjs(doc.positionedObjects, 'positioned')

  // Headers and footers are separate trees. A placeholder in one still gets injected by
  // `injectValues` (replaceAllText is document-wide), so missing them here would report a token as
  // ABSENT when it is present -- a false negative that would block a perfectly good template.
  for (const box of [...Object.values(doc.headers || {}), ...Object.values(doc.footers || {})]) {
    walk((box as any)?.content)
  }

  // WHY THIS IS HERE AT ALL. This route could already say a template was readable and structurally
  // sound while it was completely unusable, because a Doc with none of the {{tokens}} injects
  // nothing and renders as an empty shell. Configuring a template you cannot verify is how a build
  // silently produces a blank resume. `stripLeftoverTokens` then deletes any token that was never
  // filled, so the evidence disappears from the OUTPUT too.
  const text = textRuns.join('')
  const found = [...new Set((text.match(/\{\{@?[^}\n]{1,80}\}\}/g) || []).map((t) => t.trim()))]
  const foundNames = found.map((t) => t.replace(/^\{\{|\}\}$/g, ''))
  const expected = expectPlaceholders || []
  const placeholders = {
    found,
    // Named against what the artifact type actually injects, so "missing" means "this slot will be
    // empty in every packet", not "this doc differs from some other doc".
    expected,
    missing: expected.filter((e) => !foundNames.includes(e)),
    unexpected: foundNames.filter((f) => expected.length > 0 && !expected.includes(f)),
    usableAsTemplate: expected.length > 0 && expected.every((e) => foundNames.includes(e)),
  }

  return {
    title: doc.title,
    pageSize: { w: dim(ds.pageSize?.width), h: dim(ds.pageSize?.height) },
    margins: { top: dim(ds.marginTop), bottom: dim(ds.marginBottom), left: dim(ds.marginLeft), right: dim(ds.marginRight) },
    placeholders,
    tableCount: tables.length, tables,
    imageCount: images.length, images,
  }
}

export async function diagDocStructure(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const token = HAS_GOOGLE_OAUTH
      ? await getGoogleOAuthToken()
      : await getGoogleToken(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!, 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive', IMPERSONATE_SUBJECT)

    // The OWNER-RESOLVED template, not whatever the seed table happens to hold. This defaulted to
    // RESUME_TEMPLATE_ID, so the diagnostic could audit a document the production builder never
    // copies - the exact drift pipelineConfig:96-100 records ("`source` is not decoration. The
    // whole P7-8 defect was invisible precisely because the run never said WHICH value it used").
    //
    // `source`, NOT truthiness. The first version of this tested `resolvedTemplateId ? … : …`, and
    // `resolveText` NEVER returns an empty value - its own interface comment says "Never ''", it
    // falls back to the seed. So the seed branch was DEAD and every audit claimed "owner setting"
    // including the default state and the case where the owner's id was REJECTED and silently
    // replaced by the seed. That is a worse version of the defect this block exists to fix: the
    // diagnostic would audit the seed while naming the owner's setting as its source.
    const settings = await loadPipelineSettings().catch(() => null)
    const resumeSetting = settings ? settings.resumeTemplateId : null
    const queryId = (req.query.get('templateId') || '').trim()
    const templateId = (queryId || (resumeSetting && resumeSetting.value) || RESUME_TEMPLATE_ID).trim()
    const templateSource = queryId ? 'query (?templateId=)'
      : !resumeSetting ? 'seed constant - the pipeline settings could not be read'
      : resumeSetting.source === 'config' ? 'owner setting (google.resumeTemplateId)'
      : 'seed constant - no owner setting is configured'
    // A rejected id is the case that reads as configured and is not. `resolveText` records WHY.
    const templateSourceNote = (!queryId && resumeSetting && resumeSetting.reason) ? resumeSetting.reason : undefined
    const docId = (req.query.get('docId') || '').trim()
    const makeCopy = req.query.get('copy') !== '0'

    // WHICH placeholder set to hold this document to. `?type=` names an artifact type and the
    // expected set comes from TEMPLATE_META -- the SAME table `varsForType` injects from, so
    // "missing" here means precisely "this slot will be empty in every packet". Defaults to
    // `resume`, which is also `compact_resume`'s set (they declare identical placeholders).
    const expectType = (req.query.get('type') || 'resume').trim()
    const expectMeta = metaFor(expectType)
    const expectPlaceholders = expectMeta ? expectMeta.placeholders : []
    const out: any = {
      templateId, templateSource, templateSourceNote,
      expectType, expectPlaceholders,
      expectTypeNote: expectMeta ? undefined : `unknown artifact type "${expectType}" - no placeholder set to check against`,
    }

    // 1. Original template — fingerprint + make link-readable so it can be opened for comparison.
    const tpl = await getDoc(token, templateId)
    await shareAnyone(token, templateId).catch(() => {})
    out.template = { url: `https://docs.google.com/document/d/${templateId}/edit`, ...fingerprint(tpl, expectPlaceholders) }

    // 2. Pure copy through the SAME copyTemplate path, NO injection — isolates copy step vs inject step.
    if (makeCopy) {
      const copyId = await copyTemplate(token, templateId, 'STRUCTURE DIFF — pure copy (no injection)')
      await shareAnyone(token, copyId).catch(() => {})
      out.pureCopy = { url: `https://docs.google.com/document/d/${copyId}/edit`, ...fingerprint(await getDoc(token, copyId), expectPlaceholders) }
    }

    // 3. A generated doc (full copy + inject) when an id is supplied.
    if (docId) {
      await shareAnyone(token, docId).catch(() => {})
      out.generated = { url: `https://docs.google.com/document/d/${docId}/edit`, ...fingerprint(await getDoc(token, docId), expectPlaceholders) }
    }

    return { status: 200, headers: HEADERS, jsonBody: out }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('diagDocStructure', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/doc-structure', handler: diagDocStructure })

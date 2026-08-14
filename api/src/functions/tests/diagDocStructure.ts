import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'
import { RESUME_TEMPLATE_ID, copyTemplate, shareAnyone } from './packetTemplates'

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
function fingerprint(doc: any) {
  const ds = doc.documentStyle || {}
  const tables: any[] = []
  const walk = (nodes: any[]) => {
    for (const el of (nodes || [])) {
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

  return {
    title: doc.title,
    pageSize: { w: dim(ds.pageSize?.width), h: dim(ds.pageSize?.height) },
    margins: { top: dim(ds.marginTop), bottom: dim(ds.marginBottom), left: dim(ds.marginLeft), right: dim(ds.marginRight) },
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

    const templateId = (req.query.get('templateId') || RESUME_TEMPLATE_ID).trim()
    const docId = (req.query.get('docId') || '').trim()
    const makeCopy = req.query.get('copy') !== '0'
    const out: any = { templateId }

    // 1. Original template — fingerprint + make link-readable so it can be opened for comparison.
    const tpl = await getDoc(token, templateId)
    await shareAnyone(token, templateId).catch(() => {})
    out.template = { url: `https://docs.google.com/document/d/${templateId}/edit`, ...fingerprint(tpl) }

    // 2. Pure copy through the SAME copyTemplate path, NO injection — isolates copy step vs inject step.
    if (makeCopy) {
      const copyId = await copyTemplate(token, templateId, 'STRUCTURE DIFF — pure copy (no injection)')
      await shareAnyone(token, copyId).catch(() => {})
      out.pureCopy = { url: `https://docs.google.com/document/d/${copyId}/edit`, ...fingerprint(await getDoc(token, copyId)) }
    }

    // 3. A generated doc (full copy + inject) when an id is supplied.
    if (docId) {
      await shareAnyone(token, docId).catch(() => {})
      out.generated = { url: `https://docs.google.com/document/d/${docId}/edit`, ...fingerprint(await getDoc(token, docId)) }
    }

    return { status: 200, headers: HEADERS, jsonBody: out }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('diagDocStructure', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/doc-structure', handler: diagDocStructure })

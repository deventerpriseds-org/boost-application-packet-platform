import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

const TEMPLATES: { key: string; id: string; kind: 'doc' | 'slides' }[] = [
  { key: 'resume', id: '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw', kind: 'doc' },
  { key: 'portfolio', id: '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec', kind: 'slides' },
  { key: 'coverLetter', id: '1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0', kind: 'slides' },
]

// Walk any JSON structure and pull the text out of every {textRun|textElement}.content.
function collectText(node: any, out: string[]) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return }
  if (typeof node.content === 'string') out.push(node.content)
  for (const k of Object.keys(node)) collectText(node[k], out)
}

// GET /api/diag/template-placeholders — reads each packet template and returns
// every {{...}} placeholder token it actually contains (authoritative list).
export async function diagTemplatePlaceholders(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    const token = HAS_GOOGLE_OAUTH
      ? await getGoogleOAuthToken()
      : await getGoogleToken(saJson!, 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/presentations', IMPERSONATE_SUBJECT)

    const result: any[] = []
    for (const t of TEMPLATES) {
      const url = t.kind === 'doc'
        ? `https://docs.googleapis.com/v1/documents/${t.id}`
        : `https://slides.googleapis.com/v1/presentations/${t.id}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) { result.push({ template: t.key, id: t.id, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }); continue }
      const doc = await res.json() as any
      const chunks: string[] = []
      collectText(doc, chunks)
      const joined = chunks.join('')
      const tokens = Array.from(new Set((joined.match(/\{\{@?[^}]+\}\}/g) || []).map((s) => s.trim())))
      result.push({ template: t.key, id: t.id, kind: t.kind, title: doc.title, placeholders: tokens.sort() })
    }
    return { status: 200, headers: HEADERS, jsonBody: { templates: result } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('diagTemplatePlaceholders', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/template-placeholders', handler: diagTemplatePlaceholders })

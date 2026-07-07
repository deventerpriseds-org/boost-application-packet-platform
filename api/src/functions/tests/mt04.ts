import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, IMPERSONATE_SUBJECT } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const RESUME_TEMPLATE_ID = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'
const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'

export async function mt04(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    const token = await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive', IMPERSONATE_SUBJECT)
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${RESUME_TEMPLATE_ID}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'MT-04 Test Copy - DELETE ME', parents: [OUTPUT_FOLDER_ID] })
    })
    if (!res.ok) throw new Error(`Drive copy failed: HTTP ${res.status} ${await res.text()}`)
    const data = await res.json() as any
    const fileId = data.id
    const fileUrl = `https://docs.google.com/document/d/${fileId}/edit`
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Doc created: ${fileUrl}`, fileId, fileUrl } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt04', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-04', handler: mt04 })

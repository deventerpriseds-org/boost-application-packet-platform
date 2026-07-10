import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function mt03(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    const token = await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive.readonly')
    const folderId = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=%22${folderId}%22+in+parents&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`Drive API HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const count = data.files?.length ?? 0
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Token obtained. Drive API returned ${count} file(s) in output folder.` } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt03', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-03', handler: mt03 })

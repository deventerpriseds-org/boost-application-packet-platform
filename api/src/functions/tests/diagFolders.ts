import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// Role-based template folders discovered in Zap 289877647 (If/Then Code node).
const FOLDERS: Record<string, string> = {
  engineering: '1iER8mCSeOfChAqtNNSarq-ZGzlcsBe77',
  'product management': '1w8wqPvE3fnUSV39-1ILDVNGDZqU4y8Ja'
}

// GET /api/diag/folders - list the contents of the role template folders so we
// can identify the compact/ATS resume template file IDs for each role.
export async function diagFolders(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson && !HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'No Google auth configured' } }

  try {
    const token = HAS_GOOGLE_OAUTH
      ? await getGoogleOAuthToken()
      : await getGoogleToken(saJson!, 'https://www.googleapis.com/auth/drive.readonly', IMPERSONATE_SUBJECT)

    const out: Record<string, any> = {}
    for (const [role, folderId] of Object.entries(FOLDERS)) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=%22${folderId}%22+in+parents+and+trashed%3Dfalse&fields=files(id,name,mimeType,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const body = await res.text()
      if (!res.ok) { out[role] = { folderId, error: `HTTP ${res.status}: ${body.slice(0, 150)}` }; continue }
      const data = JSON.parse(body)
      out[role] = {
        folderId,
        files: (data.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          type: f.mimeType?.replace('application/vnd.google-apps.', ''),
          modified: f.modifiedTime
        }))
      }
    }

    return { status: 200, headers: HEADERS, jsonBody: { authMode: HAS_GOOGLE_OAUTH ? 'oauth (dev@enterpriseds.io)' : 'service account', folders: out } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('diagFolders', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/folders', handler: diagFolders })

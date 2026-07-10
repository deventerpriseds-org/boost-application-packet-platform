import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const TARGETS: Record<string, string> = {
  resumeTemplate: '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw',
  portfolioTemplate: '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec',
  coverLetterTemplate: '1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0',
  outputFolder: '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'
}

// GET /api/diag/drive - report owner + drive type of templates/output folder
// so we know which Google account/domain owns them and which fix applies.
export async function diagDrive(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    const sa = JSON.parse(saJson)
    const token = await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive.readonly')

    const results: Record<string, any> = {}
    for (const [name, id] of Object.entries(TARGETS)) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,driveId,owners(emailAddress,displayName),capabilities(canAddChildren,canEdit)&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const body = await res.text()
      let json: any = null
      try { json = JSON.parse(body) } catch {}
      results[name] = res.ok
        ? {
            name: json?.name,
            owners: (json?.owners || []).map((o: any) => o.emailAddress),
            inSharedDrive: !!json?.driveId,
            driveId: json?.driveId || null,
            canAddChildren: json?.capabilities?.canAddChildren,
            canEdit: json?.capabilities?.canEdit
          }
        : { error: `HTTP ${res.status}: ${(body.match(/"message":\s*"([^"]+)"/) || [, body.slice(0, 100)])[1]}` }
    }

    const ownerDomains = new Set<string>()
    Object.values(results).forEach((r: any) => (r.owners || []).forEach((e: string) => ownerDomains.add(e.split('@')[1] || '?')))

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        serviceAccount: sa.client_email,
        serviceAccountClientId: sa.client_id,
        ownerDomains: [...ownerDomains],
        files: results,
        interpretation: `The templates/folder are owned by: ${[...ownerDomains].join(', ') || 'unknown'}. Domain-wide delegation must impersonate a user in that Google Workspace domain (not necessarily your M365 domain). If owners are personal @gmail.com accounts, there is no Workspace admin — use a Shared Drive or have the owner run the copies instead.`
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('diagDrive', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'diag/drive',
  handler: diagDrive
})

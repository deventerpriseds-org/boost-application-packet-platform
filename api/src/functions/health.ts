import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient, TableServiceClient } from '@azure/data-tables'
import { google } from 'googleapis'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

// GET /api/health - basic health check
export async function health(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  try {
    // Verify storage connection
    const svc = TableServiceClient.fromConnectionString(CONN)
    const tables: string[] = []
    for await (const table of svc.listTables()) {
      tables.push(table.name!)
    }

    return {
      status: 200,
      headers,
      jsonBody: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        storage: 'connected',
        tables
      }
    }
  } catch (err) {
    return {
      status: 500,
      headers,
      jsonBody: { status: 'error', error: String(err) }
    }
  }
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: health
})

// POST /api/test-connection - test any configured connection
export async function testConnection(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (req.method === 'OPTIONS') return { status: 204, headers }

  try {
    const { connection } = await req.json() as { connection: string }
    context.log(`Testing connection: ${connection}`)

    switch (connection) {
      case 'azure': {
        const svc = TableServiceClient.fromConnectionString(CONN)
        const tables: string[] = []
        for await (const t of svc.listTables()) tables.push(t.name!)
        return { status: 200, headers, jsonBody: { success: true, detail: `Storage connected. Tables: ${tables.join(', ')}` } }
      }
      case 'openai': {
        const key = process.env.OPENAI_API_KEY
        if (!key) return { status: 200, headers, jsonBody: { success: false, detail: 'OPENAI_API_KEY not set in Function App settings' } }
        const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
        return { status: 200, headers, jsonBody: { success: res.ok, detail: res.ok ? 'OpenAI connected' : `HTTP ${res.status}` } }
      }
      case 'google': {
        // Read from AppConfig table first, fall back to env var
        const configClient = TableClient.fromConnectionString(CONN, 'AppConfig')
        const getVal = async (key: string) => {
          try {
            const e = await configClient.getEntity('auth', key)
            return e.value as string
          } catch { return null }
        }
        const rawJson = await getVal('google.serviceAccountJson') ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        if (!rawJson) return { status: 200, headers, jsonBody: { success: false, detail: 'Google service account JSON not configured. Add it in Auth & Config → Google APIs.' } }
        const folderId = await getVal('google.outputFolderId') ?? process.env.ZAPIER_DOCS_FOLDER_ID
        if (!folderId) return { status: 200, headers, jsonBody: { success: false, detail: 'Output Folder ID not configured. Add it in Auth & Config → Google APIs.' } }
        const creds = JSON.parse(rawJson)
        const auth = new google.auth.GoogleAuth({
          credentials: creds,
          scopes: ['https://www.googleapis.com/auth/drive.readonly']
        })
        const drive = google.drive({ version: 'v3', auth })
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 10
        })
        const files = res.data.files ?? []
        return { status: 200, headers, jsonBody: { success: true, detail: `Drive connected. Found ${files.length} file(s) in folder.`, files: files.map(f => f.name) } }
      }
      default:
        return { status: 200, headers, jsonBody: { success: false, detail: `Connection type '${connection}' not yet implemented` } }
    }
  } catch (err) {
    return { status: 500, headers, jsonBody: { success: false, error: String(err) } }
  }
}

app.http('testConnection', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: testConnection
})

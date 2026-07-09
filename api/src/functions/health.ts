import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient, TableServiceClient } from '@azure/data-tables'

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
  route: 'test-connection',
  handler: testConnection
})

// GET /api/config-status - report which credentials are configured server-side
// Returns booleans only — never the secret values themselves.
export async function configStatus(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  const has = (v?: string) => !!(v && v.trim())

  return {
    status: 200,
    headers,
    jsonBody: {
      microsoft: has(process.env.MICROSOFT_CLIENT_ID) && has(process.env.MICROSOFT_CLIENT_SECRET),
      google: has(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      openai: has(process.env.OPENAI_API_KEY),
      heygen: has(process.env.HEYGEN_API_KEY),
      elevenlabs: has(process.env.ELEVENLABS_API_KEY),
      elevenlabsVoice: has(process.env.ELEVENLABS_DEFAULT_VOICE_ID),
      heygenCloneAvatar: has(process.env.HEYGEN_CLONE_1_AVATAR_IDENTITY_ID),
      heygenCloneVoice: has(process.env.HEYGEN_CLONED_VOICE_ID),
      azure: has(process.env.AZURE_STORAGE_CONNECTION_STRING),
      // Google OAuth-user connection: true once a refresh token is stored, i.e.
      // dev@enterpriseds.io has consented and file copies run as that account.
      googleOAuthConnected: has(process.env.GOOGLE_REFRESH_TOKEN),
      googleOAuthClientReady: has(process.env.GOOGLE_CLIENT_ID) && has(process.env.GOOGLE_CLIENT_SECRET),
      // masked hints so the UI can show a non-empty, non-secret indicator
      hints: {
        openai: has(process.env.OPENAI_API_KEY) ? 'sk-••••••••' : '',
        microsoft: has(process.env.MICROSOFT_CLIENT_ID) ? `${(process.env.MICROSOFT_CLIENT_ID || '').slice(0, 8)}••••` : '',
        azure: has(process.env.AZURE_STORAGE_CONNECTION_STRING) ? 'n8nstxpdthydai6fkm ••••' : ''
      }
    }
  }
}

app.http('configStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config-status',
  handler: configStatus
})

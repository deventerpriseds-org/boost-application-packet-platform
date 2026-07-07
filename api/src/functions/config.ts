import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient, odata } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const TABLE = 'AppConfig'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// GET /api/config - load all config values
export async function getConfig(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }

  try {
    const client = TableClient.fromConnectionString(CONN, TABLE)
    const values: Record<string, string> = {}
    for await (const entity of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq 'auth'` } })) {
      values[entity.rowKey as string] = entity.value as string
    }
    return { status: 200, headers, jsonBody: { success: true, values } }
  } catch (err) {
    return { status: 500, headers, jsonBody: { success: false, error: String(err) } }
  }
}

app.http('getConfig', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'config',
  handler: getConfig
})

// POST /api/config - save config values { values: { "google.outputFolderId": "...", ... } }
export async function saveConfig(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }

  try {
    const { values } = await req.json() as { values: Record<string, string> }
    const client = TableClient.fromConnectionString(CONN, TABLE)

    for (const [key, value] of Object.entries(values)) {
      await client.upsertEntity({
        partitionKey: 'auth',
        rowKey: key,
        value
      }, 'Replace')
    }

    return { status: 200, headers, jsonBody: { success: true, saved: Object.keys(values).length } }
  } catch (err) {
    return { status: 500, headers, jsonBody: { success: false, error: String(err) } }
  }
}

app.http('saveConfig', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'config',
  handler: saveConfig
})

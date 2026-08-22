import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient, odata } from '@azure/data-tables'
import { requireWrite } from './tests/appSession'
// The ten keys the pipeline declares. IMPORTED, never re-listed — a whitelist typed twice is a
// whitelist that drifts, and this one decides what may be read and written.
import { CONFIG_KEYS } from './tests/pipelineConfig'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const TABLE = 'AppConfig'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// GET /api/config - the PIPELINE settings, and only those.
//
// SECURED 2026-08-22, before anything was wired to it. As shipped this route was
// `authLevel: 'anonymous'` with no session check on either method, and the GET returned EVERY row of
// the AppConfig partition named `auth` — an unauthenticated dump of a config partition, and an
// unauthenticated write to it. It had ZERO callers anywhere (`grep -rn "api/config" app/ web/
// scripts/` returns nothing), which is the only reason tightening it carries no breakage risk, and
// is also why nobody noticed.
//
// Two changes, and the projection is the more important one. The GET now returns only the keys
// `CONFIG_KEYS` declares — the ten pipeline settings — instead of the whole partition, so a
// credential that ever lands beside them is not served by this route. Deny-by-default: a key nobody
// declared is not returned, rather than a list of keys nobody may read.
export async function getConfig(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }

  try {
    const client = TableClient.fromConnectionString(CONN, TABLE)
    const allowed = new Set<string>(Object.values(CONFIG_KEYS))
    const values: Record<string, string> = {}
    for await (const entity of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq 'auth'` } })) {
      const k = entity.rowKey as string
      if (allowed.has(k)) values[k] = entity.value as string
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

  // A VERIFIED SESSION, like every other mutation in this API. Without it, anyone who could reach
  // the function could rewrite the pipeline's template ids, output folder and sender address.
  const guard = requireWrite(req); if (guard) return guard
  try {
    const { values } = await req.json() as { values: Record<string, string> }
    const client = TableClient.fromConnectionString(CONN, TABLE)

    // Same whitelist as the read, and for the same reason: a key the pipeline does not declare is
    // ignored rather than written. This route must not be a way to put arbitrary rows into the
    // `auth` partition.
    const allowed = new Set<string>(Object.values(CONFIG_KEYS))
    const saved: string[] = []
    const ignored: string[] = []
    for (const [key, value] of Object.entries(values || {})) {
      if (!allowed.has(key)) { ignored.push(key); continue }
      await client.upsertEntity({ partitionKey: 'auth', rowKey: key, value: String(value) }, 'Replace')
      saved.push(key)
    }

    return { status: 200, headers, jsonBody: { success: true, saved: saved.length, keys: saved, ignored } }
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

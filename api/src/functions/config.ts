import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient, odata } from '@azure/data-tables'
import { requireWrite, resolveOwner } from './tests/appSession'
// The ten keys the pipeline declares. IMPORTED, never re-listed — a whitelist typed twice is a
// whitelist that drifts, and this one decides what may be read and written.
import { CONFIG_KEYS } from './tests/pipelineConfig'
import { SEED_TEMPLATE_ROLE_FOCUS, templateRowKey } from './tests/roleFocus'

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



// POST /api/config - save config values { values: { "google.outputFolderId": "...", ... } }
export async function saveConfig(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }

  // A VERIFIED SESSION — and `requireWrite` is NOT that, which is the defect this replaces.
  //
  // `requireWrite` allows a write when `verified || owner === DEMO_EMAIL`, and `resolveOwner`
  // DEFAULTS the owner to DEMO_EMAIL when no `?owner=` is supplied. So an unauthenticated POST
  // resolved to demo and was waved straight through — to a table that holds the pipeline's template
  // ids, output folder and sender address. That guard is correct for OWNER-SCOPED tables, which have
  // a demo partition to absorb such a write; `AppConfig` is global shared state with no such
  // partition, so a "demo" write here rewrites the real owner's live pipeline.
  //
  // This is the identical reasoning already written into `promptsApi` for the Prompts table, which
  // is the other global table in this API. Same hazard, same guard.
  const { verified } = resolveOwner(req)
  if (!verified) {
    return { status: 403, headers, jsonBody: { success: false, error: 'a verified session is required to change pipeline configuration' } }
  }
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




// ── The RESUME TEMPLATE's role focus ────────────────────────────────────────────────────────────
//
// The owner's ruling: *"let the resume chosen drive the persona, right now it's only engineering
// available"*. `resolveRoleFocus` reads `templates/resume-<driveId>` before anything else, and this
// is the writer that makes that row settable — without which the focus is a code constant and the
// no-hardcoded-config rule is violated by the very change that was meant to satisfy it.
//
// Same table, same guard, same deny-by-default shape as the pipeline settings above. It is a second
// PARTITION rather than a second store: `templates` already existed and `resolveRoleFocus` already
// read from it — what was missing was any way to write it.

/** Only `roleFocus`, and only on a `resume-` row. A writer that accepts arbitrary fields on
 *  arbitrary rows is a way to put anything into AppConfig, which is what the projection above
 *  exists to prevent on the read side. */
function isTemplateRow(rowKey: string): boolean {
  return /^resume-[A-Za-z0-9_-]{10,}$/.test(rowKey)
}

// GET /api/config/templates — every configured template focus, plus the seeds for those with none.
export async function getTemplateConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }
  try {
    const client = TableClient.fromConnectionString(CONN, TABLE)
    const configured: Record<string, string> = {}
    for await (const entity of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq 'templates'` } })) {
      const k = entity.rowKey as string
      if (isTemplateRow(k) && (entity as any).roleFocus) configured[k] = String((entity as any).roleFocus)
    }
    // The seeded templates are listed too, so the screen can show a template nobody has configured
    // yet rather than an empty list that looks like nothing exists.
    const templates = Object.entries(SEED_TEMPLATE_ROLE_FOCUS).map(([templateId, seed]) => {
      const row = templateRowKey(templateId)
      return { templateId, rowKey: row, roleFocus: configured[row] || seed, source: configured[row] ? 'config' : 'seed' }
    })
    for (const [row, roleFocus] of Object.entries(configured)) {
      if (!templates.some((t) => t.rowKey === row)) {
        templates.push({ templateId: row.replace(/^resume-/, ''), rowKey: row, roleFocus, source: 'config' })
      }
    }
    return { status: 200, headers, jsonBody: { success: true, templates } }
  } catch (err) {
    return { status: 500, headers, jsonBody: { success: false, error: String(err) } }
  }
}

// POST /api/config/templates { templateId, roleFocus }
export async function saveTemplateConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }
  const { verified } = resolveOwner(req)
  if (!verified) {
    return { status: 403, headers, jsonBody: { success: false, error: 'a verified session is required to change a template role focus' } }
  }
  try {
    const body = await req.json() as { templateId?: string; roleFocus?: string }
    const templateId = String(body?.templateId || '').trim()
    const roleFocus = String(body?.roleFocus || '').trim()
    const rowKey = templateRowKey(templateId)
    if (!templateId || !isTemplateRow(rowKey)) {
      return { status: 400, headers, jsonBody: { success: false, error: 'templateId must be a Drive id' } }
    }
    // A blank focus is a DELETE, not a stored empty string: an empty row would win over the seed in
    // `resolveRoleFocus` and silently blank the directive that every prompt is prefixed with.
    if (!roleFocus) {
      try { await TableClient.fromConnectionString(CONN, TABLE).deleteEntity('templates', rowKey) } catch { /* already absent */ }
      return { status: 200, headers, jsonBody: { success: true, templateId, roleFocus: null, cleared: true } }
    }
    await TableClient.fromConnectionString(CONN, TABLE).upsertEntity({ partitionKey: 'templates', rowKey, roleFocus }, 'Merge')
    return { status: 200, headers, jsonBody: { success: true, templateId, roleFocus } }
  } catch (err) {
    return { status: 500, headers, jsonBody: { success: false, error: String(err) } }
  }
}

// ONE REGISTRATION PER ROUTE, dispatching on the method — and this is not a style preference.
//
// `config` was registered TWICE, `getConfig` for GET and `saveConfig` for POST. Only the first
// registration wins: `POST /api/config` returned **404 in production** (api-test run 32558143290),
// which means `saveConfig` had never once been reachable and the Settings ▸ Pipeline Save button
// could not have worked on any day of its life. `config/templates` was written the same way and
// inherited the same defect the hour it shipped. `app/coach/config` had it too.
//
// This is the shape `promptsApi` already uses — one function, `req.method` inside — and the reason
// it works there. `H:one-http-registration-per-route` now fails the suite on a duplicate route.
export async function configApi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }
  return req.method === 'POST' ? saveConfig(req, context) : getConfig(req, context)
}

export async function templateConfigApi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers }
  return req.method === 'POST' ? saveTemplateConfig(req, context) : getTemplateConfig(req, context)
}

app.http('configApi', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'config', handler: configApi })
app.http('templateConfigApi', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'config/templates', handler: templateConfigApi })

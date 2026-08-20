import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { resolveOwner } from './appSession'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// GET  /api/prompts        -> list all active prompt rows (partition + content)
// POST /api/prompts        -> upsert { partitionKey, content } as a new active version
export async function promptsApi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const client = TableClient.fromConnectionString(CONN, 'Prompts')

  try {
    if (req.method === 'GET') {
      const prompts: Record<string, any> = {}
      for await (const e of client.listEntities()) {
        const pk = (e as any).partitionKey
        // Prefer active rows; keep the highest version seen
        const existing = prompts[pk]
        const version = (e as any).version ?? 0
        const isActive = (e as any).is_active === true
        if (!existing || isActive || version >= (existing.version ?? 0)) {
          prompts[pk] = {
            partitionKey: pk,
            rowKey: (e as any).rowKey,
            content: (e as any).content || '',
            is_active: isActive,
            version,
            notes: (e as any).notes || '',
            length: ((e as any).content || '').length
          }
        }
      }
      return { status: 200, headers: HEADERS, jsonBody: { prompts: Object.values(prompts) } }
    }

    if (req.method === 'POST') {
      // D7 - a POST here rewrites live document generation for six partition keys, and the route is
      // authLevel:'anonymous' with no guard at all.
      //
      // DEPARTURE FROM THE PLAN, DELIBERATE. The plan prescribed `requireWrite`, "one line, same
      // pattern as every other mutation". That would NOT have closed this: `requireWrite` allows a
      // write when `verified || owner === DEMO_EMAIL`, and `resolveOwner` DEFAULTS owner to
      // DEMO_EMAIL when no ?owner= is supplied. An unauthenticated POST resolves to demo and is
      // waved through. That guard is correct for owner-scoped tables, which have a demo partition;
      // the Prompts table is global shared state with no such partition, so a "demo" write here
      // edits the real owner's live prompts. The guard used is the one from artifactGateOverride:
      // verified session or nothing. Placed inside the POST branch so GET and OPTIONS still work
      // unauthenticated - the dev console's preflight and the prompt list both depend on that.
      const { verified } = resolveOwner(req)
      if (!verified) {
        return { status: 403, headers: HEADERS, jsonBody: { error: 'a verified session is required to change prompts - this table drives live document generation' } }
      }
      const body = await req.json() as { partitionKey?: string; content?: string; notes?: string }
      if (!body.partitionKey || typeof body.content !== 'string') {
        return { status: 400, headers: HEADERS, jsonBody: { error: 'partitionKey and content are required' } }
      }
      // Find current max version for this partition
      let maxVersion = 0
      for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${body.partitionKey}'` } })) {
        const v = (e as any).version ?? 0
        if (v > maxVersion) maxVersion = v
        // deactivate old rows
        if ((e as any).is_active) {
          await client.updateEntity({ partitionKey: body.partitionKey, rowKey: (e as any).rowKey, is_active: false } as any, 'Merge')
        }
      }
      const newVersion = maxVersion + 1
      const rowKey = `v${String(newVersion).padStart(3, '0')}`
      await client.upsertEntity({
        partitionKey: body.partitionKey,
        rowKey,
        content: body.content,
        is_active: true,
        version: newVersion,
        notes: body.notes || 'Saved from dev console'
      }, 'Replace')
      return { status: 200, headers: HEADERS, jsonBody: { saved: true, partitionKey: body.partitionKey, rowKey, version: newVersion } }
    }

    return { status: 405, headers: HEADERS, jsonBody: { error: 'method not allowed' } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('promptsApi', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'prompts',
  handler: promptsApi
})

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function mt09(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const client = TableClient.fromConnectionString(CONN, 'Prompts')
  const rowKey = 'v000-test'
  try {
    await client.upsertEntity({
      partitionKey: 'resume_system',
      rowKey,
      content: 'test prompt content',
      is_active: false,
      version: 0,
      notes: 'MT-09 test row'
    }, 'Replace')

    const entity = await client.getEntity('resume_system', rowKey)
    if ((entity as any).content !== 'test prompt content') throw new Error('Content mismatch on read-back')
    await client.deleteEntity('resume_system', rowKey)
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: 'Row written to Prompts table, queried back with correct content, deleted cleanly.' } }
  } catch (err) {
    try { await client.deleteEntity('resume_system', rowKey) } catch {}
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt09', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-09', handler: mt09 })

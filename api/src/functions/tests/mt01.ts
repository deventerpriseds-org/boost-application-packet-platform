import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function mt01(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const client = TableClient.fromConnectionString(CONN, 'AppConfig')
  const rowKey = `mt-01-${Date.now()}`
  try {
    await client.createEntity({ partitionKey: 'test', rowKey, value: 'ping' })
    const entity = await client.getEntity('test', rowKey)
    if ((entity as any).value !== 'ping') throw new Error('Value mismatch on read-back')
    await client.deleteEntity('test', rowKey)
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Row written (${rowKey}), read back with correct value, deleted cleanly.` } }
  } catch (err) {
    try { await client.deleteEntity('test', rowKey) } catch {}
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt01', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-01', handler: mt01 })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const REQUIRED_FIELDS = [
  'resumeSummary', 'workHistory1', 'workHistory2', 'workHistory3', 'workHistory4',
  'skills1', 'skills2', 'expertise', 'relevantProficiencies',
  'aboutMe1', 'aboutMe2', 'executiveProfile', 'coreAccomplishments',
  'softHardSkillsPool', 'itemsToOmit'
]

export async function mt13(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const client = TableClient.fromConnectionString(CONN, 'MasterContext')

  try {
    const entities: any[] = []
    for await (const e of client.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) {
      entities.push(e)
    }
    if (entities.length === 0) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'MasterContext table empty — needs to be seeded with baseline content.' } }

    const ctx = entities[0]
    const missing = REQUIRED_FIELDS.filter(f => !ctx[f] || String(ctx[f]).trim() === '')
    if (missing.length > 0) {
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Missing or empty fields: ${missing.join(', ')}`, missing } }
    }
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `All ${REQUIRED_FIELDS.length} required fields present and non-empty.` } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt13', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-13', handler: mt13 })

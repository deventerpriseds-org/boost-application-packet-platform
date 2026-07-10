import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { randomUUID } from 'crypto'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function mt20(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const client = TableClient.fromConnectionString(CONN, 'JobApplications')
  const rowKey = randomUUID()
  const now = new Date().toISOString()

  try {
    await client.createEntity({
      partitionKey: 'applications',
      rowKey,
      JobTitle: 'VP of Engineering',
      Company: 'TechVenture Inc',
      RoleType: 'Engineering',
      Status: 'complete',
      FullResumeUrl: 'https://docs.google.com/document/d/test',
      PortfolioUrl: 'https://docs.google.com/presentation/d/test',
      CoverLetterUrl: 'https://docs.google.com/presentation/d/test2',
      ProcessedAt: now
    })

    // Query back by Company
    const found: any[] = []
    for await (const e of client.listEntities({ queryOptions: { filter: "PartitionKey eq 'applications' and Company eq 'TechVenture Inc'" } })) {
      if ((e as any).rowKey === rowKey) found.push(e)
    }

    if (found.length === 0) throw new Error('Row not found after write')
    const row = found[0]
    const missingFields = ['JobTitle', 'Company', 'RoleType', 'Status', 'FullResumeUrl'].filter(f => !(row as any)[f])
    if (missingFields.length > 0) throw new Error(`Fields missing after read-back: ${missingFields.join(', ')}`)

    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Job record written and retrieved. RowKey: ${rowKey}`, rowKey, row } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt20', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-20', handler: mt20 })

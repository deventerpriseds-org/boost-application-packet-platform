import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// GET/POST /api/diag/pg-setup — one-time bootstrap for the app database:
// creates the vector + pg_trgm extensions in whatever database pgClient is
// currently pointed at (AZURE_PG_DATABASE / DATABASE_URL). Idempotent.
export async function pgSetup(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    await client.query('create extension if not exists vector')
    await client.query('create extension if not exists pg_trgm')
    const db = await client.query('select current_database() as db')
    const ext = await client.query("select extname, extversion from pg_extension where extname in ('vector','pg_trgm') order by extname")
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: ext.rows.length === 2,
        database: db.rows[0].db,
        extensions: ext.rows,
        detail: `Extensions ready in ${db.rows[0].db}: ${ext.rows.map((r: any) => r.extname).join(', ')}`
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('pgSetup', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/pg-setup', handler: pgSetup })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-28 — Postgres + pgvector connectivity against RAG_AI_Agents.
// Confirms the extensions are installed, then does a temp-table CRUD round-trip.
export async function mt28(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    const who = await client.query('select current_database() as db, version() as version')
    const ext = await client.query("select extname, extversion from pg_extension where extname in ('vector','pg_trgm') order by extname")
    const extNames = ext.rows.map((r: any) => r.extname)

    // Temp-table round trip (temp tables auto-drop at session end)
    const table = `mt28_probe_${Date.now()}`
    await client.query(`create temp table "${table}" (id serial primary key, note text)`)
    await client.query(`insert into "${table}" (note) values ($1)`, ['pgvector connectivity ok'])
    const read = await client.query(`select note from "${table}" where id = 1`)

    const hasVector = extNames.includes('vector')
    const hasTrgm = extNames.includes('pg_trgm')
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: hasVector && read.rows[0]?.note === 'pgvector connectivity ok',
        detail: `Connected to ${who.rows[0].db}. Extensions: ${extNames.join(', ') || 'none'}. Temp-table CRUD ok.`,
        database: who.rows[0].db,
        serverVersion: String(who.rows[0].version).split(' ').slice(0, 2).join(' '),
        extensions: ext.rows,
        vectorInstalled: hasVector,
        pgTrgmInstalled: hasTrgm,
        readBack: read.rows[0]?.note
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt28', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-28', handler: mt28 })

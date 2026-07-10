import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'
import { SCHEMA_SQL, EXPECTED_TABLES } from './schema'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// GET/POST /api/diag/pg-migrate — runs the production schema idempotently against
// the configured app database, then reports which expected tables now exist and
// their row counts. Safe to re-run (all CREATE ... IF NOT EXISTS).
export async function pgMigrate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    await client.query(SCHEMA_SQL)

    const db = (await client.query('select current_database() as db')).rows[0].db
    const present = (await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,
      [EXPECTED_TABLES]
    )).rows.map((r: any) => r.table_name)

    const counts: Record<string, number> = {}
    for (const t of present) {
      const c = await client.query(`select count(*)::int as n from "${t}"`)
      counts[t] = c.rows[0].n
    }
    const missing = EXPECTED_TABLES.filter((t) => !present.includes(t))

    // Confirm the pgvector index on opportunity exists
    const idx = (await client.query(
      `select indexname from pg_indexes where tablename='opportunity' and indexname='opp_embedding_hnsw'`
    )).rowCount || 0

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: missing.length === 0,
        database: db,
        detail: missing.length === 0
          ? `Schema applied to ${db}: ${present.length}/${EXPECTED_TABLES.length} tables present, vector index ${idx ? 'ok' : 'MISSING'}.`
          : `Missing tables: ${missing.join(', ')}`,
        tables: counts,
        vectorIndex: idx > 0
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('pgMigrate', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/pg-migrate', handler: pgMigrate })

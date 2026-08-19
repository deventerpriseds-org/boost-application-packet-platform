// P1.1 persistence + read API for the requirement rows.
//
// All parsing/locating logic is in `requirements.ts`, which imports neither @azure/functions nor pg
// and is exercised by `api/test/requirements.test.mjs`. This file only moves those rows in and out
// of Postgres.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { buildRequirements } from './requirements'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

// Columns the requirement spine needs on `opportunity`. Also declared in schema.ts SCHEMA_SQL (D1
// puts NEW TABLES there); this keeps environments that have not re-migrated from 500ing.
export async function ensureRequirementCols(client: any) {
  await client.query(`
    alter table opportunity
      add column if not exists jd_text text,
      add column if not exists jd_text_sha256 text,
      add column if not exists jd_text_truncated boolean`)
}

/**
 * Extract and persist the requirement rows for one opportunity.
 *
 * Replace, never append: re-parsing a posting must not double its requirement count. The delete and
 * the inserts share one transaction so a failure mid-write cannot leave a posting with half a spine.
 * Returns the measured location stats — the honest number for how much of this posting is evidenced.
 */
export async function writeRequirements(client: any, opp: any): Promise<{
  opp_id: string; rows: number; located: number; located_rate: number
  jd_source: string | null; truncated: boolean
}> {
  const built = buildRequirements(opp)
  await client.query('begin')
  try {
    await client.query(
      `update opportunity set jd_text=$1, jd_text_sha256=$2, jd_text_truncated=$3 where id=$4`,
      [built.jd_text || null, built.jd_text ? built.jd_text_sha256 : null, built.posting_truncated, opp.id],
    )
    await client.query(`delete from requirement where opp_id=$1`, [opp.id])
    for (let i = 0; i < built.rows.length; i++) {
      const r = built.rows[i]
      await client.query(
        `insert into requirement
           (opp_id, seq, item_text, verbatim, char_start, char_end, match_method, kind, kind_source,
            model_keyword, competency, coverage, weight, source_category, jd_source, jd_text_sha256,
            extractor_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [opp.id, i, r.item_text, r.verbatim, r.char_start, r.char_end, r.match_method, r.kind,
         r.kind_source, r.model_keyword, r.competency, r.coverage, r.weight, r.source_category,
         built.jd_source, built.jd_text_sha256, r.extractor_version],
      )
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }
  return {
    opp_id: opp.id, rows: built.rows.length, located: built.located,
    located_rate: Math.round(built.located_rate * 1000) / 1000,
    jd_source: built.jd_source, truncated: built.posting_truncated,
  }
}

/**
 * Drop the spine for an opportunity whose posting has gone away.
 * `applyAnchorTruth` nulls jd_table/jd_requirements when no single-job source exists; leaving the
 * rows behind would keep serving quotes attributed to a posting the row no longer has.
 */
export async function clearRequirements(client: any, oppId: string) {
  await client.query(`delete from requirement where opp_id=$1`, [oppId])
  await client.query(`update opportunity set jd_text=null, jd_text_sha256=null, jd_text_truncated=null where id=$1`, [oppId])
}

// GET /api/app/opportunity/{id}/requirements
export async function requirementsGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureRequirementCols(client)
    const opp = (await client.query(
      `select id, jd_text, jd_text_sha256, jd_text_truncated from opportunity where id=$1 and owner_email=$2`,
      [req.params.id, owner])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const rows = (await client.query(`select * from requirement where opp_id=$1 order by seq`, [opp.id])).rows
    // A stored sha that no longer matches the posting means the offsets were measured against a
    // different body. Say so rather than serving quotes that may no longer be in the posting.
    const stale = rows.some((r: any) => r.jd_text_sha256 !== opp.jd_text_sha256)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        oppId: opp.id, jdTextLen: (opp.jd_text || '').length, jdTextTruncated: !!opp.jd_text_truncated,
        stale, located: rows.filter((r: any) => r.char_start !== null).length, total: rows.length,
        requirements: rows,
      },
    }
  } catch (e: any) {
    context.error('requirementsGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/qc/requirements/backfill   { limit?: number, oppId?: string }
// Structures already-parsed postings. Deterministic and model-free, so it is safe to re-run.
export async function requirementsBackfill(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  const body: any = await req.json().catch(() => ({}))
  const limit = Math.min(Number(body?.limit) || 50, 500)
  let client
  try {
    client = await getPgClient()
    await ensureRequirementCols(client)
    const opps = (await client.query(
      body?.oppId
        ? `select id, jd_real, raw_jd, why_surfaced, jd_table from opportunity where id=$1 and owner_email=$2`
        : `select id, jd_real, raw_jd, why_surfaced, jd_table from opportunity
             where owner_email=$2 and jd_table is not null order by updated_at desc limit $1`,
      body?.oppId ? [body.oppId, owner] : [limit, owner])).rows

    const results = []
    for (const opp of opps) results.push(await writeRequirements(client, opp))
    const rows = results.reduce((a, r) => a + r.rows, 0)
    const located = results.reduce((a, r) => a + r.located, 0)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, opportunities: results.length, rows, located,
        located_rate: rows ? Math.round((located / rows) * 1000) / 1000 : 0,
        no_posting: results.filter(r => r.jd_source === null).length,
        truncated: results.filter(r => r.truncated).length,
      },
    }
  } catch (e: any) {
    context.error('requirementsBackfill', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('requirementsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/requirements', handler: requirementsGet })
app.http('requirementsBackfill', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/requirements/backfill', handler: requirementsBackfill })

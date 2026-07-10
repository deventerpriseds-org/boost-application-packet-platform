import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
const DEMO_EMAIL = 'demo@executive-engine.local'
const SELF_BASE = process.env.COACH_SELF_BASE || 'https://job-platform-api.azurewebsites.net/api'

async function ensureBulkTable(client: any) {
  await client.query(`create table if not exists bulk_job (
    id uuid primary key default gen_random_uuid(),
    owner text not null,
    status text not null default 'running',
    total int not null default 0,
    done int not null default 0,
    results jsonb not null default '[]'::jsonb,
    params jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`)
}

// POST /api/app/bulk/packets { oppIds?[] | topN?, stage?, seedCadence?, draftOutreach? }
// Build the full packet across MANY opportunities. For each opp: build-all (+optional
// cadence + DRAFT outreach). NEVER sends. Runs inline (bounded), writes progress to
// bulk_job, returns the job. Poll GET /api/app/bulk/{jobId}.
export async function bulkPackets(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let body: any = {}; try { body = await req.json() } catch {}
  const seedCadence = body?.seedCadence === true
  const draftOutreach = body?.draftOutreach === true
  const cap = Math.min(Math.max(Number(body?.topN) || (Array.isArray(body?.oppIds) ? body.oppIds.length : 5), 1), 15)
  let client
  try {
    client = await getPgClient(); await ensureBulkTable(client)

    // Resolve the opportunity list.
    let oppIds: string[] = Array.isArray(body?.oppIds) ? body.oppIds.map(String) : []
    if (!oppIds.length) {
      const q = new URLSearchParams({ owner }); if (body?.stage) q.set('stage', String(body.stage))
      const list = await fetch(`${SELF_BASE}/app/opportunities?${q.toString()}`).then((r) => r.json()).catch(() => ({})) as any
      oppIds = (list?.opportunities || []).slice(0, cap).map((o: any) => o.id)
    } else {
      oppIds = oppIds.slice(0, cap)
    }
    if (!oppIds.length) return { status: 200, headers: HEADERS, jsonBody: { error: 'no opportunities to process' } }

    const job = (await client.query(`insert into bulk_job (owner, status, total, params) values ($1,'running',$2,$3) returning id`, [owner, oppIds.length, JSON.stringify({ seedCadence, draftOutreach })])).rows[0]
    const jobId = job.id
    const results: any[] = []
    for (const id of oppIds) {
      let r: any
      try {
        r = await fetch(`${SELF_BASE}/app/opportunity/${encodeURIComponent(id)}/packet/build-all?owner=${encodeURIComponent(owner)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seedCadence, draftOutreach })
        }).then((x) => x.json())
      } catch (e) { r = { error: String(e) } }
      results.push({ oppId: id, company: r?.company, ok: !!r?.ok, artifacts: r?.artifacts, cadenceSeeded: r?.cadenceSeeded, outreachDrafted: r?.outreachDrafted, error: r?.error })
      await client.query(`update bulk_job set done = done + 1, results = $1, updated_at = now() where id = $2`, [JSON.stringify(results), jobId])
    }
    await client.query(`update bulk_job set status = 'done', updated_at = now() where id = $1`, [jobId])
    const okCount = results.filter((x) => x.ok).length
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, jobId, total: oppIds.length, built: okCount, sent: false, results, note: 'Bulk build complete. Nothing was sent.' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/bulk/{jobId}
export async function bulkStatus(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const jobId = req.params.jobId
  let client
  try {
    client = await getPgClient(); await ensureBulkTable(client)
    const j = (await client.query(`select id, owner, status, total, done, results, created_at, updated_at from bulk_job where id = $1`, [jobId])).rows[0]
    if (!j) return { status: 404, headers: HEADERS, jsonBody: { error: 'job not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { jobId: j.id, status: j.status, total: j.total, done: j.done, results: j.results, updatedAt: j.updated_at } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('bulkPackets', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/bulk/packets', handler: bulkPackets })
app.http('bulkStatus', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/bulk/{jobId}', handler: bulkStatus })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const DEMO_EMAIL = 'demo@executive-engine.local'

async function ensureAssetEvents(client: any) {
  await client.query(`create table if not exists asset_event (
    id bigserial primary key, asset_id text not null, opp_id uuid, viewer text,
    event text not null default 'open', view_seconds int default 0,
    ts timestamptz not null default now())`)
  await client.query(`create index if not exists asset_event_asset_idx on asset_event(asset_id)`)
}

// GET /api/app/asset/{artifactId}/open?v=<viewer> — the tracked share link.
// Logs an open event, then 302-redirects to the artifact's real doc/deck/video
// URL. Share THIS link (not the raw Drive URL) to see who opened your assets.
export async function assetOpen(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const artifactId = req.params.artifactId
  const viewer = req.query.get('v') || 'anonymous'
  let client
  try {
    client = await getPgClient()
    await ensureAssetEvents(client)
    const art = (await client.query(`select a.doc_url, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art || !art.doc_url) return { status: 404, headers: HEADERS, jsonBody: { error: 'asset not found or has no shareable URL yet' } }
    await client.query(`insert into asset_event (asset_id, opp_id, viewer, event) values ($1,$2,$3,'open')`, [artifactId, art.opp_id, viewer])
    return { status: 302, headers: { Location: art.doc_url } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/asset/event { assetId, oppId?, viewer?, event?, viewSeconds? }
// Log an engagement event (e.g. an in-app view, or view-time on unload).
export async function assetEvent(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const b = (await req.json().catch(() => ({}))) as any
    if (!b?.assetId) return { status: 400, headers: HEADERS, jsonBody: { error: 'assetId required' } }
    const event = ['open', 'view', 'forward', 'download'].includes(b.event) ? b.event : 'view'
    client = await getPgClient()
    await ensureAssetEvents(client)
    await client.query(
      `insert into asset_event (asset_id, opp_id, viewer, event, view_seconds) values ($1,$2,$3,$4,$5)`,
      [String(b.assetId), b.oppId || null, b.viewer || 'owner', event, Number(b.viewSeconds) || 0]
    )
    return { status: 200, headers: HEADERS, jsonBody: { ok: true } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/assets/analytics?owner= — per-asset engagement, scoped to the
// owner's opportunities. Returns opens, unique viewers, total view-time, last
// open, and a label (company · artifact type) for each tracked asset.
export async function assetsAnalytics(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient()
    await ensureAssetEvents(client)
    const rows = (await client.query(
      `select e.asset_id,
              o.company, o.role, a.type as artifact_type,
              count(*) filter (where e.event = 'open') as opens,
              count(*) filter (where e.event = 'open' and e.ts >= now() - interval '7 days') as opens7d,
              count(*) filter (where e.event = 'forward') as forwards,
              count(distinct e.viewer) filter (where e.viewer <> 'owner') as unique_viewers,
              coalesce(sum(e.view_seconds),0) as view_seconds,
              max(e.ts) as last_event
         from asset_event e
         left join artifact a on a.id::text = e.asset_id
         left join packet p on p.id = a.packet_id
         left join opportunity o on o.id = coalesce(e.opp_id, p.opp_id)
        where o.owner_email = $1 or o.owner_email is null
        group by e.asset_id, o.company, o.role, a.type
        order by max(e.ts) desc nulls last
        limit 100`, [owner]
    )).rows
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        totalOpens: rows.reduce((s: number, r: any) => s + Number(r.opens || 0), 0),
        totalOpens7d: rows.reduce((s: number, r: any) => s + Number(r.opens7d || 0), 0),
        totalForwards: rows.reduce((s: number, r: any) => s + Number(r.forwards || 0), 0),
        assets: rows.map((r: any) => ({
          assetId: r.asset_id,
          label: r.company ? `${r.company} · ${r.artifact_type || 'asset'}` : (r.artifact_type || r.asset_id),
          company: r.company, role: r.role, type: r.artifact_type,
          opens: Number(r.opens || 0), opens7d: Number(r.opens7d || 0),
          forwards: Number(r.forwards || 0), uniqueViewers: Number(r.unique_viewers || 0),
          viewSeconds: Number(r.view_seconds || 0), lastEvent: r.last_event,
        })),
      }
    }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('assetOpen', { methods: ['GET'], authLevel: 'anonymous', route: 'app/asset/{artifactId}/open', handler: assetOpen })
app.http('assetEvent', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/asset/event', handler: assetEvent })
app.http('assetsAnalytics', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/assets/analytics', handler: assetsAnalytics })

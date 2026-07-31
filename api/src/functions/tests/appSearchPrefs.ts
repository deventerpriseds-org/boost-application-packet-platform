import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ACT-32/33/34 — the owner's search/filter preferences: which metros to target (LinkedIn geoIds from
// geoMaster) and whether to restrict to remote-optional. Consumed by the frontend (Swipe/Opportunities
// filter, Settings) AND the scheduled search (ACT-34: geoId/remote as search params). One row per owner.
async function ensurePrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (
    owner_email    text primary key,
    target_geo_ids text[] not null default '{}',
    remote_only    boolean not null default false,
    updated_at     timestamptz not null default now()
  )`)
}

export async function getSearchPrefs(client: any, owner: string): Promise<{ targetGeoIds: string[]; remoteOnly: boolean }> {
  await ensurePrefs(client)
  const r = (await client.query('select target_geo_ids, remote_only from owner_search_prefs where owner_email=$1', [owner])).rows[0]
  return { targetGeoIds: r?.target_geo_ids || [], remoteOnly: !!r?.remote_only }
}

// GET → read prefs · POST → upsert prefs (verified session). One route, method-dispatched.
export async function searchPrefs(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient()
    if (req.method === 'GET') {
      const prefs = await getSearchPrefs(client, owner)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...prefs } }
    }
    // POST — mutate
    const guard = requireWrite(req); if (guard) return guard
    const b = (await req.json().catch(() => ({}))) as any
    const targetGeoIds = Array.isArray(b?.targetGeoIds) ? b.targetGeoIds.map((s: any) => String(s)).filter(Boolean).slice(0, 50) : []
    const remoteOnly = !!b?.remoteOnly
    await ensurePrefs(client)
    await client.query(
      `insert into owner_search_prefs (owner_email, target_geo_ids, remote_only, updated_at)
       values ($1,$2,$3, now())
       on conflict (owner_email) do update set target_geo_ids=excluded.target_geo_ids, remote_only=excluded.remote_only, updated_at=now()`,
      [owner, targetGeoIds, remoteOnly],
    )
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, targetGeoIds, remoteOnly } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('searchPrefs', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/search-prefs', handler: searchPrefs })

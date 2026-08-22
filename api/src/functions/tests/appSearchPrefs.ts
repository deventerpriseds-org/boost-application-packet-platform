import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { TempThresholds, DEFAULT_TEMP_THRESHOLDS, normalizeTempThresholds } from './signals'
// The `chk_*` half of the SAME table. Its columns, defaults and whitelist live in `checkPrefs`, which
// is the one reader/writer of them; this route only dispatches to it, so there is no second
// declaration of what a check setting is.
import { loadThresholds, writeCheckPrefs, checkPrefColumns } from './checkPrefs'

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
  // Owner-editable TEMPERATURE band cut-points (recency of the posting). Seeded with the shared
  // defaults; the owner retunes them in Settings ▸ Intake. Idempotent add.
  await client.query(`
    alter table owner_search_prefs add column if not exists temp_hot_hours  int not null default ${DEFAULT_TEMP_THRESHOLDS.hotMaxHours};
    alter table owner_search_prefs add column if not exists temp_warm_days  int not null default ${DEFAULT_TEMP_THRESHOLDS.warmMaxDays};
    alter table owner_search_prefs add column if not exists temp_cool_days  int not null default ${DEFAULT_TEMP_THRESHOLDS.coolMaxDays};
  `)
}

export async function getSearchPrefs(client: any, owner: string): Promise<{ targetGeoIds: string[]; remoteOnly: boolean; tempThresholds: TempThresholds }> {
  await ensurePrefs(client)
  const r = (await client.query('select target_geo_ids, remote_only, temp_hot_hours, temp_warm_days, temp_cool_days from owner_search_prefs where owner_email=$1', [owner])).rows[0]
  return {
    targetGeoIds: r?.target_geo_ids || [], remoteOnly: !!r?.remote_only,
    tempThresholds: normalizeTempThresholds({ hotMaxHours: r?.temp_hot_hours, warmMaxDays: r?.temp_warm_days, coolMaxDays: r?.temp_cool_days }),
  }
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
      // D:chk-settings-have-no-writer — the check thresholds ride the SAME route as the rest of
      // `owner_search_prefs` rather than getting a parallel one. `columns` is published alongside the
      // values so the UI can render a control per setting from the API's own list, which is what
      // stops a knob added later from being invisible until someone hand-writes a field for it.
      const checks = await loadThresholds(client, owner)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...prefs, checks, checkColumns: checkPrefColumns() } }
    }
    // POST — mutate. Partial update: only the keys present in the body change, so saving the
    // temperature bands never clobbers the metro/remote prefs (and vice-versa).
    const guard = requireWrite(req); if (guard) return guard
    const b = (await req.json().catch(() => ({}))) as any
    await ensurePrefs(client)
    await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
    const sets: string[] = []; const vals: any[] = [owner]
    if (Array.isArray(b?.targetGeoIds)) { vals.push(b.targetGeoIds.map((s: any) => String(s)).filter(Boolean).slice(0, 50)); sets.push(`target_geo_ids=$${vals.length}`) }
    if (typeof b?.remoteOnly === 'boolean') { vals.push(b.remoteOnly); sets.push(`remote_only=$${vals.length}`) }
    if (b?.tempThresholds && typeof b.tempThresholds === 'object') {
      const t = normalizeTempThresholds(b.tempThresholds)
      vals.push(t.hotMaxHours); sets.push(`temp_hot_hours=$${vals.length}`)
      vals.push(t.warmMaxDays); sets.push(`temp_warm_days=$${vals.length}`)
      vals.push(t.coolMaxDays); sets.push(`temp_cool_days=$${vals.length}`)
    }
    if (sets.length) await client.query(`update owner_search_prefs set ${sets.join(', ')}, updated_at=now() where owner_email=$1`, vals)
    // Partial in the same sense as everything above it: only the `chk_*` keys present in
    // `body.checks` move, so saving a threshold never clobbers the metro or temperature prefs.
    const wroteChecks = await writeCheckPrefs(client, owner, b?.checks)
    const prefs = await getSearchPrefs(client, owner)
    const checks = await loadThresholds(client, owner)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...prefs, checks, checkColumns: checkPrefColumns(), wroteChecks } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('searchPrefs', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/search-prefs', handler: searchPrefs })

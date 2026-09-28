import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { TempThresholds, DEFAULT_TEMP_THRESHOLDS, normalizeTempThresholds } from './signals'
// `stripWorkMode` and `METROS` come from the geo master so the owner's alias keys are normalised
// EXACTLY as resolveMetro normalises a location, and so a saved geoId is checked against the real
// metro table rather than trusted from the request body.
import { stripWorkMode, METROS } from './geoMaster'
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
  // OWNER-DEFINED LOCATION ALIASES. `{ "<lowercased raw location>": "<geoId>" }`.
  //
  // WHY THIS EXISTS, measured 2026-09-28: the metro alias table is hardcoded in `geoMaster.ts`, and
  // a location it cannot match resolves to null -- which `matchesLocationPrefs` treats as EXCLUDE.
  // 378 of the owner's 743 jobs were being filtered out that way, and closing a gap meant a code
  // change and a deploy. That is the "no hardcoded config" rule broken: the owner could not fix
  // their own search. This column is the owner-editable layer over the seeded table, exactly as
  // that rule prescribes -- code SEEDS the metros, the owner overrides.
  await client.query(
    `alter table owner_search_prefs add column if not exists location_aliases jsonb not null default '{}'::jsonb`)
}

/** Normalise a raw location for alias lookup. Mirrors resolveMetro's own lowercase + work-mode strip. */
export function aliasKey(rawLocation: string): string {
  return stripWorkMode(String(rawLocation || '')).trim().toLowerCase()
}

export async function getSearchPrefs(client: any, owner: string): Promise<{ targetGeoIds: string[]; remoteOnly: boolean; tempThresholds: TempThresholds; locationAliases: Record<string, string> }> {
  await ensurePrefs(client)
  const r = (await client.query('select target_geo_ids, remote_only, temp_hot_hours, temp_warm_days, temp_cool_days, location_aliases from owner_search_prefs where owner_email=$1', [owner])).rows[0]
  return {
    targetGeoIds: r?.target_geo_ids || [], remoteOnly: !!r?.remote_only,
    tempThresholds: normalizeTempThresholds({ hotMaxHours: r?.temp_hot_hours, warmMaxDays: r?.temp_warm_days, coolMaxDays: r?.temp_cool_days }),
    locationAliases: (r?.location_aliases && typeof r.location_aliases === 'object') ? r.location_aliases : {},
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
    // Owner-defined location aliases. MERGED, not replaced, so saving one mapping never drops the
    // others -- the same partial-update contract every field above follows.
    //
    // THE GEOID IS VALIDATED AGAINST THE REAL METRO TABLE. A geoId is what the location filter
    // compares, so accepting an arbitrary string from the body would let a typo create a metro that
    // exists for exactly one owner and silently matches nothing -- the same class of silent
    // exclusion this whole feature exists to end. An empty string is the documented way to REMOVE a
    // mapping; anything else unrecognised is refused by name so the screen can say which.
    if (b?.locationAliases && typeof b.locationAliases === 'object' && !Array.isArray(b.locationAliases)) {
      const valid = new Set(METROS.map((m) => m.geoId).filter(Boolean) as string[])
      const merged: Record<string, string> = { ...(await getSearchPrefs(client, owner)).locationAliases }
      const rejected: string[] = []
      for (const [rawLoc, geoId] of Object.entries(b.locationAliases)) {
        const key = aliasKey(rawLoc)
        if (!key) continue
        const gid = String(geoId ?? '')
        if (!gid) { delete merged[key]; continue }          // '' removes the mapping
        if (!valid.has(gid)) { rejected.push(`${rawLoc} -> ${gid}`); continue }
        merged[key] = gid
      }
      if (rejected.length) {
        return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: `not a known metro geoId: ${rejected.join(', ')}` } }
      }
      vals.push(JSON.stringify(merged)); sets.push(`location_aliases=$${vals.length}::jsonb`)
    }
    if (sets.length) await client.query(`update owner_search_prefs set ${sets.join(', ')}, updated_at=now() where owner_email=$1`, vals)
    // Partial in the same sense as everything above it: only the `chk_*` keys present in
    // `body.checks` move, so saving a threshold never clobbers the metro or temperature prefs.
    // D:config-staleness-backfill (AC 10) — `queued` reports how many already-gated artifacts this
    // write's chk_coverage_judge/chk_reviewer_auto off->on transition (if any) just enqueued for a
    // bounded background recheck, so a caller sees a count rather than silence.
    const { written: wroteChecks, queued: checksQueued } = await writeCheckPrefs(client, owner, b?.checks)
    const prefs = await getSearchPrefs(client, owner)
    const checks = await loadThresholds(client, owner)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...prefs, checks, checkColumns: checkPrefColumns(), wroteChecks, checksQueued } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('searchPrefs', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/search-prefs', handler: searchPrefs })

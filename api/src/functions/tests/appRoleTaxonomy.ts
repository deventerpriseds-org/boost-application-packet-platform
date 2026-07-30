import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { SEED, GROUP_LABEL, resolveTitle, scoreWithBoost, normalize, seedCounts, Tier } from './roleTaxonomy'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

// ── Schema (additive, idempotent) ─────────────────────────────────────────────────────────────
// Per-user editable taxonomy so the user can add titles / change tiers themselves. Seeded from
// the ROLE_TAX module. Opportunity gets the matched columns + boosted score bookkeeping.
async function ensureSchema(client: any) {
  await client.query(`create table if not exists taxonomy_title (
    owner_email text not null,
    grp         text not null,             -- csuite | vp | director (mail-watcher group slugs)
    role_slug   text not null,
    role        text not null,
    variation   text not null default '',
    title       text not null,
    normalized  text not null,
    tier        text not null default 'watch' check (tier in ('fav','watch','off')),
    is_seed     boolean not null default false,
    updated_at  timestamptz not null default now(),
    primary key (owner_email, normalized)
  )`)
  await client.query(`create index if not exists taxonomy_title_role_idx on taxonomy_title(owner_email, grp, role_slug)`)
  for (const col of [
    `matched_group text`, `matched_role text`, `matched_variation text`,
    `title_tier text`, `is_favorite boolean not null default false`, `base_score int`,
  ]) {
    await client.query(`alter table opportunity add column if not exists ${col}`).catch(() => {})
  }
}

// Seed a user's taxonomy_title from the in-memory SEED (idempotent — never clobbers user edits).
async function seedUser(client: any, owner: string): Promise<number> {
  const rows = SEED.titles
  // batch insert via unnest; ON CONFLICT keeps existing (user-edited) rows untouched
  const grp: string[] = [], rs: string[] = [], rn: string[] = [], vr: string[] = [], ti: string[] = [], no: string[] = [], tr: string[] = []
  for (const t of rows) {
    grp.push(t.group); rs.push(t.roleSlug); rn.push(t.role); vr.push(t.variation); ti.push(t.title); no.push(normalize(t.title)); tr.push(t.tier)
  }
  const res = await client.query(
    `insert into taxonomy_title (owner_email, grp, role_slug, role, variation, title, normalized, tier, is_seed)
     select $1, g, s, r, v, t, n, te, true
     from unnest($2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[]) as x(g,s,r,v,t,n,te)
     on conflict (owner_email, normalized) do nothing`,
    [owner, grp, rs, rn, vr, ti, no, tr]
  )
  return res.rowCount || 0
}

// Load the user's tier overrides (normalized → tier) so user edits win over the seed default.
async function loadTierMap(client: any, owner: string): Promise<Map<string, Tier>> {
  const rows = (await client.query(`select normalized, tier from taxonomy_title where owner_email=$1`, [owner])).rows
  const m = new Map<string, Tier>()
  for (const r of rows) m.set(r.normalized, r.tier as Tier)
  return m
}

// Tag one opportunity row from its title/JD. Returns the columns to persist. Idempotent:
// base_score is captured once (coalesce) so re-runs don't double-boost.
export function tagFields(row: any, tierMap?: Map<string, Tier>) {
  // Classify on `role` — the per-opp title from parseAlert, PROVEN accurate against the real
  // posting (51/51 ground-truthed 2026-07-30). NEVER classify on jd_title: it is derived from the
  // whole digest, so every sibling opp inherits the digest's HEADLINE title and gets mis-binned.
  const title = row.role || row.jd_title || ''
  const context = `${row.jd_summary || ''} ${row.jd_requirements || ''}`
  const m = resolveTitle(title, context)
  // user tier override (by normalized title) wins over the seed tier
  const override = tierMap?.get(normalize(title))
  const tier: Tier = override || m.tier
  const isFavorite = tier === 'fav' && m.matched && !m.backlog
  const base = row.base_score != null ? row.base_score : row.match_score  // capture once
  const score = scoreWithBoost(base, isFavorite)
  return {
    matched_group: m.group, matched_role: m.role, matched_variation: m.variation,
    title_tier: tier, is_favorite: isFavorite, base_score: base, match_score: score,
  }
}

// ── POST /api/app/taxonomy/retag — backfill: tag every (non-dismissed) opportunity ────────────
export async function taxonomyRetag(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const owner = resolveOwner(req).owner
    client = await getPgClient()
    await ensureSchema(client)
    const seeded = await seedUser(client, owner)
    const tierMap = await loadTierMap(client, owner)
    const rows = (await client.query(
      `select id, role, jd_title, jd_summary, jd_requirements, match_score, base_score from opportunity where owner_email=$1`, [owner]
    )).rows
    let tagged = 0, favorites = 0
    for (const r of rows) {
      const f = tagFields(r, tierMap)
      if (f.is_favorite) favorites++
      await client.query(
        `update opportunity set matched_group=$2, matched_role=$3, matched_variation=$4,
           title_tier=$5, is_favorite=$6, base_score=$7, match_score=$8 where id=$1`,
        [r.id, f.matched_group, f.matched_role, f.matched_variation, f.title_tier, f.is_favorite, f.base_score, f.match_score]
      )
      tagged++
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, owner, seededTitles: seeded, processed: tagged, favorites, seedCounts: seedCounts() } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── GET /api/app/taxonomy — read model: groups → roles → titles (with tier) + counts ──────────
export async function taxonomyRead(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const owner = resolveOwner(req).owner
    client = await getPgClient()
    await ensureSchema(client)
    if (!(await client.query(`select 1 from taxonomy_title where owner_email=$1 limit 1`, [owner])).rowCount) {
      await seedUser(client, owner)
    }
    const rows = (await client.query(
      `select grp, role_slug, role, variation, title, tier from taxonomy_title where owner_email=$1 order by grp, role, title`, [owner]
    )).rows
    const groups: Record<string, any> = {}
    for (const r of rows) {
      const g = (groups[r.grp] ||= { slug: r.grp, label: GROUP_LABEL[r.grp] || r.grp, roles: {} })
      const role = (g.roles[r.role_slug] ||= { slug: r.role_slug, role: r.role, titles: [], fav: 0, watch: 0, off: 0 })
      role.titles.push({ title: r.title, variation: r.variation, tier: r.tier })
      role[r.tier as 'fav' | 'watch' | 'off'] += 1
    }
    const out = Object.values(groups).map((g: any) => ({ ...g, roles: Object.values(g.roles) }))
    const totals = rows.reduce((a: any, r: any) => { a[r.tier] = (a[r.tier] || 0) + 1; return a }, {})
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, groups: out, counts: { groups: out.length, titles: rows.length, ...totals } } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── POST /api/app/taxonomy/title — add a title variant manually ───────────────────────────────
export async function taxonomyAddTitle(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const owner = resolveOwner(req).owner
    const b = (await req.json().catch(() => ({}))) as any
    const title = String(b?.title || '').trim()
    if (!title) return { status: 400, headers: HEADERS, jsonBody: { error: 'title required' } }
    // infer group/role from the title if not supplied
    const m = resolveTitle(title)
    const grp = String(b?.group || m.group || 'vp')
    const roleSlug = String(b?.roleSlug || m.roleSlug || `${grp}-other`)
    const role = String(b?.role || m.role || 'Other')
    const tier: Tier = ['fav', 'watch', 'off'].includes(b?.tier) ? b.tier : 'fav'
    client = await getPgClient()
    await ensureSchema(client)
    await client.query(
      `insert into taxonomy_title (owner_email, grp, role_slug, role, variation, title, normalized, tier, is_seed)
       values ($1,$2,$3,$4,$5,$6,$7,$8,false)
       on conflict (owner_email, normalized) do update set tier=excluded.tier, updated_at=now()`,
      [owner, grp, roleSlug, role, String(b?.variation || title), title, normalize(title), tier]
    )
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, title, group: grp, roleSlug, role, tier } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── PATCH /api/app/taxonomy/title/tier — set a title's tier (fav | watch | off) ───────────────
export async function taxonomySetTier(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const owner = resolveOwner(req).owner
    const b = (await req.json().catch(() => ({}))) as any
    const tier: Tier = b?.tier
    if (!['fav', 'watch', 'off'].includes(tier)) return { status: 400, headers: HEADERS, jsonBody: { error: "tier must be fav|watch|off" } }
    const norm = b?.normalized ? String(b.normalized) : normalize(String(b?.title || ''))
    if (!norm) return { status: 400, headers: HEADERS, jsonBody: { error: 'title or normalized required' } }
    client = await getPgClient()
    await ensureSchema(client)
    const r = await client.query(`update taxonomy_title set tier=$3, updated_at=now() where owner_email=$1 and normalized=$2 returning title`, [owner, norm, tier])
    if (!r.rowCount) return { status: 404, headers: HEADERS, jsonBody: { error: 'title not found', normalized: norm } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, title: r.rows[0].title, tier } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('taxonomyRead', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy', handler: taxonomyRead })
app.http('taxonomyRetag', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/retag', handler: taxonomyRetag })
app.http('taxonomyAddTitle', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/title', handler: taxonomyAddTitle })
app.http('taxonomySetTier', { methods: ['PATCH', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/title/tier', handler: taxonomySetTier })

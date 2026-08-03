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
  // Draft layer (PRD §3): the working set behind "Save favorites" / "Revert N". A draft row exists
  // only while it DIFFERS from the published tier; publish flushes drafts into taxonomy_title.tier.
  await client.query(`create table if not exists title_tier_draft (
    owner_email text not null,
    normalized  text not null,
    tier        text not null check (tier in ('fav','watch','off')),
    updated_at  timestamptz not null default now(),
    primary key (owner_email, normalized)
  )`)
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

// Rescore every (non-dismissed) opportunity from the current published taxonomy tiers. This is the
// `taxonomy.published → rescore_opportunities` job (PRD §6 Events): recompute is_favorite / match_score
// so a newly-favorited title promotes its matched opps immediately. Shared by retag + publish.
async function rescoreOpps(client: any, owner: string): Promise<{ processed: number; favorites: number }> {
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
  return { processed: tagged, favorites }
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
    const { processed, favorites } = await rescoreOpps(client, owner)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, owner, seededTitles: seeded, processed, favorites, seedCounts: seedCounts() } }
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
    // Effective tier = draft tier (working set) when present, else published taxonomy_title.tier.
    const rows = (await client.query(
      `select t.grp, t.role_slug, t.role, t.variation, t.title, t.tier as published, d.tier as draft
         from taxonomy_title t
         left join title_tier_draft d on d.owner_email=t.owner_email and d.normalized=t.normalized
        where t.owner_email=$1 order by t.grp, t.role, t.title`, [owner]
    )).rows
    // Live counts: open (non-dismissed) opps matched to each role's variation + the favorited subset.
    const liveRows = (await client.query(
      `select matched_role as role, matched_variation as variation,
              count(*)::int as live, count(*) filter (where is_favorite)::int as favlive
         from opportunity
        where owner_email=$1 and not dismissed and not coalesce(is_demo,false) and matched_group is not null
        group by matched_role, matched_variation`, [owner]
    )).rows
    const liveByVar = new Map<string, number>()      // role||variation → live count
    let favoritedOpps = 0
    for (const lr of liveRows) {
      liveByVar.set(`${lr.role}||${lr.variation}`, lr.live)
      favoritedOpps += lr.favlive
    }
    const groups: Record<string, any> = {}
    let dirty = 0
    for (const r of rows) {
      const tier = (r.draft ?? r.published) as 'fav' | 'watch' | 'off'
      if (r.draft != null && r.draft !== r.published) dirty++
      const g = (groups[r.grp] ||= { slug: r.grp, label: GROUP_LABEL[r.grp] || r.grp, roles: {} })
      const role = (g.roles[r.role_slug] ||= { slug: r.role_slug, role: r.role, titles: [], fav: 0, watch: 0, off: 0, live: 0 })
      const live = liveByVar.get(`${r.role}||${r.variation}`) || 0
      role.titles.push({ title: r.title, variation: r.variation, tier, published: r.published, live })
      role[tier] += 1
      role.live += live
    }
    const out = Object.values(groups).map((g: any) => ({ ...g, roles: Object.values(g.roles) }))
    const totals = rows.reduce((a: any, r: any) => { const t = (r.draft ?? r.published); a[t] = (a[t] || 0) + 1; return a }, {})
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, groups: out, dirty, favoritedOpps, counts: { groups: out.length, titles: rows.length, ...totals } } }
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

// Upsert a draft tier for one normalized title. A draft row is kept only while it DIFFERS from the
// published tier — if the requested tier equals published, the draft row is removed (keeps `dirty` honest).
async function upsertDraft(client: any, owner: string, norm: string, tier: Tier): Promise<boolean> {
  const pub = (await client.query(`select tier from taxonomy_title where owner_email=$1 and normalized=$2`, [owner, norm])).rows[0]
  if (!pub) return false
  if (pub.tier === tier) {
    await client.query(`delete from title_tier_draft where owner_email=$1 and normalized=$2`, [owner, norm])
  } else {
    await client.query(
      `insert into title_tier_draft (owner_email, normalized, tier) values ($1,$2,$3)
       on conflict (owner_email, normalized) do update set tier=excluded.tier, updated_at=now()`,
      [owner, norm, tier])
  }
  return true
}

async function dirtyCount(client: any, owner: string): Promise<number> {
  return (await client.query(
    `select count(*)::int n from title_tier_draft d join taxonomy_title t
       on t.owner_email=d.owner_email and t.normalized=d.normalized
      where d.owner_email=$1 and d.tier<>t.tier`, [owner])).rows[0].n
}

// ── PATCH /api/app/taxonomy/title/tier — stage a title's tier in the DRAFT layer (fav|watch|off) ─
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
    const ok = await upsertDraft(client, owner, norm, tier)
    if (!ok) return { status: 404, headers: HEADERS, jsonBody: { error: 'title not found', normalized: norm } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, normalized: norm, tier, dirty: await dirtyCount(client, owner) } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── POST /api/app/taxonomy/roles/bulk-tier — stage EVERY title of a role to one tier (atomic) ───
export async function taxonomyBulkTier(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const owner = resolveOwner(req).owner
    const b = (await req.json().catch(() => ({}))) as any
    const tier: Tier = b?.tier
    if (!['fav', 'watch', 'off'].includes(tier)) return { status: 400, headers: HEADERS, jsonBody: { error: 'tier must be fav|watch|off' } }
    const grp = String(b?.group || ''); const roleSlug = String(b?.roleSlug || '')
    if (!grp || !roleSlug) return { status: 400, headers: HEADERS, jsonBody: { error: 'group and roleSlug required' } }
    client = await getPgClient()
    await ensureSchema(client)
    const norms = (await client.query(`select normalized from taxonomy_title where owner_email=$1 and grp=$2 and role_slug=$3`, [owner, grp, roleSlug])).rows
    if (!norms.length) return { status: 404, headers: HEADERS, jsonBody: { error: 'role has no titles', group: grp, roleSlug } }
    for (const n of norms) await upsertDraft(client, owner, n.normalized, tier)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, group: grp, roleSlug, tier, count: norms.length, dirty: await dirtyCount(client, owner) } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── POST /api/app/taxonomy/publish — flush drafts → published tiers, clear drafts, rescore opps ──
export async function taxonomyPublish(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const owner = resolveOwner(req).owner
    client = await getPgClient()
    await ensureSchema(client)
    const changed = (await client.query(
      `update taxonomy_title t set tier=d.tier, updated_at=now()
         from title_tier_draft d
        where t.owner_email=d.owner_email and t.normalized=d.normalized and d.owner_email=$1 and t.tier<>d.tier
        returning t.normalized`, [owner])).rowCount || 0
    await client.query(`delete from title_tier_draft where owner_email=$1`, [owner])
    const { processed, favorites } = await rescoreOpps(client, owner)   // taxonomy.published → rescore
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, published: changed, rescored: processed, favoritedOpps: favorites } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── POST /api/app/taxonomy/revert — discard the draft working set (back to published) ───────────
export async function taxonomyRevert(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const owner = resolveOwner(req).owner
    client = await getPgClient()
    await ensureSchema(client)
    const n = (await client.query(`delete from title_tier_draft where owner_email=$1`, [owner])).rowCount || 0
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, reverted: n } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('taxonomyRead', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy', handler: taxonomyRead })
app.http('taxonomyRetag', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/retag', handler: taxonomyRetag })
app.http('taxonomyAddTitle', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/title', handler: taxonomyAddTitle })
app.http('taxonomySetTier', { methods: ['PATCH', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/title/tier', handler: taxonomySetTier })
app.http('taxonomyBulkTier', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/roles/bulk-tier', handler: taxonomyBulkTier })
app.http('taxonomyPublish', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/publish', handler: taxonomyPublish })
app.http('taxonomyRevert', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/taxonomy/revert', handler: taxonomyRevert })

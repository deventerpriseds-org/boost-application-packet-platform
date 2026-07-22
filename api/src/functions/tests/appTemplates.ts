import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'

// Templates subsystem — owner-scoped reusable content (resume variants, cover
// letters, recruiter/HM outreach, LinkedIn notes, thank-you notes, portfolio &
// video scripts). Real CRUD backed by a `template` table. No fake seeding: an
// owner with no templates gets an empty list.

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

// The category taxonomy per the design. Stored as free text, validated here.
const CATEGORIES = ['resume', 'cover', 'recruiter', 'hm', 'linkedin', 'thankyou', 'portfolio', 'video'] as const
type Category = typeof CATEGORIES[number]

async function ensureTable(client: any) {
  await client.query(`create table if not exists template (
    id uuid primary key default gen_random_uuid(),
    owner_email text not null,
    category text not null,
    name text not null,
    body text not null default '',
    is_primary boolean not null default false,
    usage_count int not null default 0,
    reply_rate real,
    updated_at timestamptz default now(),
    created_at timestamptz default now())`)
}

function rowToTemplate(r: any) {
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    body: r.body,
    isPrimary: r.is_primary,
    usageCount: Number(r.usage_count),
    replyRate: r.reply_rate === null || r.reply_rate === undefined ? null : Number(r.reply_rate),
    updatedAt: r.updated_at,
    createdAt: r.created_at
  }
}

// GET /api/app/templates?owner= — list this owner's templates, ordered by category.
export async function templatesList(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient(); await ensureTable(client)
    const rows = (await client.query(
      `select id, category, name, body, is_primary, usage_count, reply_rate, updated_at, created_at
         from template where owner_email = $1
        order by category, is_primary desc, name`, [owner]
    )).rows
    const templates = rows.map(rowToTemplate)
    // Per-category counts across the full taxonomy (0 for empty categories).
    const counts: Record<string, number> = {}
    for (const c of CATEGORIES) counts[c] = 0
    for (const t of templates) counts[t.category] = (counts[t.category] || 0) + 1
    const categories = CATEGORIES.map((key) => ({ key, count: counts[key] || 0 }))
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, templates, categories } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/templates { id?, category, name, body?, isPrimary? } — upsert.
// With id: update that owner's row. Without id: insert a new template.
// Setting isPrimary=true unsets any other primary in the same category (real behavior).
export async function templatesUpsert(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const body = (await req.json().catch(() => ({}))) as any
    const id = body?.id ? String(body.id) : null
    const category = String(body?.category || '').trim().toLowerCase()
    const name = String(body?.name || '').trim()
    const text = body?.body === undefined || body?.body === null ? '' : String(body.body)
    const isPrimary = body?.isPrimary === true

    if (!CATEGORIES.includes(category as Category)) {
      return { status: 400, headers: HEADERS, jsonBody: { error: `category must be one of ${CATEGORIES.join(', ')}` } }
    }
    if (!name) return { status: 400, headers: HEADERS, jsonBody: { error: 'name is required' } }

    client = await getPgClient(); await ensureTable(client)

    let row: any
    if (id) {
      row = (await client.query(
        `update template set category=$3, name=$4, body=$5, is_primary=$6, updated_at=now()
           where id=$1 and owner_email=$2 returning *`,
        [id, owner, category, name, text, isPrimary]
      )).rows[0]
      if (!row) return { status: 404, headers: HEADERS, jsonBody: { error: 'template not found' } }
    } else {
      row = (await client.query(
        `insert into template (owner_email, category, name, body, is_primary)
         values ($1,$2,$3,$4,$5) returning *`,
        [owner, category, name, text, isPrimary]
      )).rows[0]
    }

    // Enforce a single primary per (owner, category): unset the others.
    if (isPrimary) {
      await client.query(
        `update template set is_primary=false, updated_at=now()
           where owner_email=$1 and category=$2 and id <> $3 and is_primary`,
        [owner, category, row.id]
      )
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, template: rowToTemplate(row) } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/templates/delete { id } — delete this owner's template.
export async function templatesDelete(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const body = (await req.json().catch(() => ({}))) as any
    if (!body?.id) return { status: 400, headers: HEADERS, jsonBody: { error: 'id required' } }
    client = await getPgClient(); await ensureTable(client)
    const res = await client.query(`delete from template where id=$1 and owner_email=$2`, [String(body.id), owner])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, deleted: res.rowCount || 0 } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/templates/{id}/use — increment usage_count so "used N×" is real.
export async function templatesUse(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  const id = req.params.id
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!id) return { status: 400, headers: HEADERS, jsonBody: { error: 'id required' } }
    client = await getPgClient(); await ensureTable(client)
    const row = (await client.query(
      `update template set usage_count = usage_count + 1, updated_at=now()
         where id=$1 and owner_email=$2 returning *`,
      [id, owner]
    )).rows[0]
    if (!row) return { status: 404, headers: HEADERS, jsonBody: { error: 'template not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, template: rowToTemplate(row) } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET (list) + POST (upsert) share one route — two registrations on the same route
// template collide in the Azure Functions host and both get dropped.
const templatesCollection = async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  return req.method === 'POST' ? templatesUpsert(req, ctx) : templatesList(req, ctx)
}

app.http('templatesCollection', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/templates', handler: templatesCollection })
app.http('templatesDelete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/templates/delete', handler: templatesDelete })
app.http('templatesUse', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/templates/{id}/use', handler: templatesUse })

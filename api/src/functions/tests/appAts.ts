import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { routeOpportunity } from './mailWatch'

// G3 Phase A — ATS ingestion. Greenhouse / Lever / Ashby publish public job-board
// APIs per company. The user configures board tokens (like the mail watcher);
// ingestion fetches postings, maps them to opportunities, and reuses the intake
// pipeline's embed → pgvector-dedupe → insert-as-discovered (insertOpp).

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
const PROVIDERS = ['greenhouse', 'lever', 'ashby'] as const
type Provider = typeof PROVIDERS[number]

async function ensureTable(client: any) {
  await client.query(`create table if not exists ats_source (
    id uuid primary key default gen_random_uuid(),
    owner_email text not null,
    provider text not null,
    board text not null,
    enabled boolean not null default true,
    last_run timestamptz,
    created_at timestamptz default now(),
    unique (owner_email, provider, board))`)
}

// --- Adapters: fetch a company's board → normalized {company, role, location, comp, url} ---
async function fetchGreenhouse(board: string): Promise<any[]> {
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`)
  if (!r.ok) throw new Error(`greenhouse ${r.status}`)
  const j = await r.json() as any
  return (j.jobs || []).map((job: any) => ({ company: board, role: job.title, location: job.location?.name || null, comp: null, url: job.absolute_url }))
}
async function fetchLever(board: string): Promise<any[]> {
  const r = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`)
  if (!r.ok) throw new Error(`lever ${r.status}`)
  const j = await r.json() as any
  return (Array.isArray(j) ? j : []).map((job: any) => ({ company: board, role: job.text, location: job.categories?.location || null, comp: null, url: job.hostedUrl }))
}
async function fetchAshby(board: string): Promise<any[]> {
  const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`)
  if (!r.ok) throw new Error(`ashby ${r.status}`)
  const j = await r.json() as any
  return (j.jobs || []).map((job: any) => ({ company: j.name || board, role: job.title, location: job.location || null, comp: job.compensation?.summary || null, url: job.jobUrl || job.applyUrl }))
}
async function fetchBoard(provider: Provider, board: string): Promise<any[]> {
  if (provider === 'greenhouse') return fetchGreenhouse(board)
  if (provider === 'lever') return fetchLever(board)
  if (provider === 'ashby') return fetchAshby(board)
  return []
}

// Keep executive-level roles only (this is an exec platform) — coarse title filter.
function isExecRole(role: string): boolean {
  const t = (role || '').toLowerCase()
  return /\b(chief|cto|cio|ciso|cfo|coo|ceo|cpo|cmo|vp|vice president|head of|director|svp|evp|president)\b/.test(t)
}

// GET /api/app/ats/sources — list; POST — add/update { provider, board, enabled? }.
// One function handles both methods (two functions on the same route drop one).
export async function atsSources(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient(); await ensureTable(client)
    if (req.method === 'POST') {
      const body = await req.json() as any
      const provider = String(body?.provider || '').toLowerCase()
      const board = String(body?.board || '').trim()
      if (!PROVIDERS.includes(provider as Provider) || !board) return { status: 400, headers: HEADERS, jsonBody: { error: `provider must be one of ${PROVIDERS.join(', ')} and board is required` } }
      const { rows } = await client.query(
        `insert into ats_source (owner_email, provider, board, enabled) values ($1,$2,$3,$4)
         on conflict (owner_email, provider, board) do update set enabled = $4 returning id`,
        [owner, provider, board, body?.enabled !== false])
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: rows[0].id } }
    }
    const { rows } = await client.query(`select id, provider, board, enabled, last_run from ats_source where owner_email = $1 order by provider, board`, [owner])
    return { status: 200, headers: HEADERS, jsonBody: { sources: rows, providers: PROVIDERS } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// POST /api/app/ats/sources/delete { id }
export async function atsSourceDelete(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    const body = await req.json() as any
    if (!body?.id) return { status: 400, headers: HEADERS, jsonBody: { error: 'id required' } }
    client = await getPgClient(); await ensureTable(client)
    await client.query(`delete from ats_source where id = $1 and owner_email = $2`, [body.id, owner])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// POST /api/app/ats/preview { provider, board } — fetch+normalize WITHOUT inserting.
export async function atsPreview(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json() as any
    const provider = String(body?.provider || '').toLowerCase() as Provider
    const board = String(body?.board || '').trim()
    if (!PROVIDERS.includes(provider) || !board) return { status: 400, headers: HEADERS, jsonBody: { error: 'provider + board required' } }
    const jobs = await fetchBoard(provider, board)
    const exec = jobs.filter((j) => isExecRole(j.role))
    return { status: 200, headers: HEADERS, jsonBody: { total: jobs.length, execRoles: exec.length, sample: exec.slice(0, 8) } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/app/ats/ingest { provider?, board?, execOnly? } — run ingestion now.
// With provider+board: that one source. Without: every enabled configured source.
export async function atsIngest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    const body = await req.json().catch(() => ({})) as any
    const execOnly = body?.execOnly !== false
    client = await getPgClient(); await ensureTable(client)

    let sources: { id?: string; provider: string; board: string }[]
    if (body?.provider && body?.board) {
      sources = [{ provider: String(body.provider).toLowerCase(), board: String(body.board) }]
    } else {
      sources = (await client.query(`select id, provider, board from ats_source where owner_email = $1 and enabled`, [owner])).rows
    }
    if (!sources.length) return { status: 200, headers: HEADERS, jsonBody: { error: 'no ATS sources configured. Add a Greenhouse/Lever/Ashby board first.' } }

    const perSource: any[] = []
    let inserted = 0, dupes = 0, scanned = 0
    for (const s of sources) {
      try {
        let jobs = await fetchBoard(s.provider as Provider, s.board)
        if (execOnly) jobs = jobs.filter((j) => isExecRole(j.role))
        jobs = jobs.slice(0, 60) // safety cap per source per run
        let ins = 0, dup = 0
        for (const j of jobs) {
          const r = await routeOpportunity(client, owner, j, { source: s.provider, why: `${s.provider} · ${s.board}${j.url ? ` · ${j.url}` : ''}` })
          if (r.inserted) ins++; else dup++
        }
        scanned += jobs.length; inserted += ins; dupes += dup
        perSource.push({ provider: s.provider, board: s.board, scanned: jobs.length, inserted: ins, duplicates: dup })
        if (s.id) await client.query(`update ats_source set last_run = now() where id = $1`, [s.id])
      } catch (e) { perSource.push({ provider: s.provider, board: s.board, error: String(e) }) }
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, scanned, inserted, duplicates: dupes, sources: perSource } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

app.http('atsSources', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/ats/sources', handler: atsSources })
app.http('atsSourceDelete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/ats/sources/delete', handler: atsSourceDelete })
app.http('atsPreview', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/ats/preview', handler: atsPreview })
app.http('atsIngest', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/ats/ingest', handler: atsIngest })

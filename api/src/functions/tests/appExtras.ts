import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
const DEMO_EMAIL = 'demo@executive-engine.local'

// GET /api/app/assets?owner= — every generated artifact across packets + engagement
export async function assetsList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient()
    await client.query(`alter table artifact add column if not exists content text`)
    await client.query(`alter table artifact add column if not exists drive_url text`)
    const rows = (await client.query(
      `select a.id, a.type, a.status, a.updated_at, a.doc_url, a.drive_url, o.id as opp_id, o.company, o.role,
              coalesce(ev.opens, 0) as opens
         from artifact a
         join packet p on p.id = a.packet_id
         join opportunity o on o.id = p.opp_id
         left join (select asset_id, count(*) filter (where event in ('open','view')) as opens from asset_event group by asset_id) ev on ev.asset_id = a.id::text
        where o.owner_email = $1 and not o.dismissed and (a.content is not null or a.doc_url is not null)
        order by a.updated_at desc`, [owner]
    )).rows
    return { status: 200, headers: HEADERS, jsonBody: { count: rows.length, assets: rows.map((r: any) => ({
      id: r.id, type: r.type, status: r.status, oppId: r.opp_id, company: r.company, role: r.role,
      docUrl: r.doc_url, driveUrl: r.drive_url, opens: Number(r.opens), updatedAt: r.updated_at
    })) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/personas?owner= — role profiles (targeting config)
export async function personasList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient()
    const personas = (await client.query(`select key, name, master_role, comp_target, positioning from persona where owner_email = $1 order by key`, [owner])).rows
    const counts = (await client.query(`select unnest(roles_for) as pkey, count(*)::int as n from opportunity where owner_email = $1 and not dismissed group by 1`, [owner])).rows
    const countMap: Record<string, number> = {}
    for (const c of counts) countMap[c.pkey] = c.n
    return { status: 200, headers: HEADERS, jsonBody: { personas: personas.map((p: any) => ({
      key: p.key, name: p.name, masterRole: p.master_role, compTarget: p.comp_target, positioning: p.positioning, opportunities: countMap[p.key] || 0
    })) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

const DEFAULT_LIBRARY = [
  { kind: 'playbook', name: 'Reliability-first modernization', category: 'Technical narrative', content: { thesis: 'Stabilize reliability, instrument cost, reinvest savings into platform capability.' } },
  { kind: 'playbook', name: 'AI cost governance', category: 'Operating model', content: { thesis: 'Unit economics per inference, tiered model routing, FinOps review tied to margins.' } },
  { kind: 'playbook', name: 'Board-readable operating cadence', category: 'Leadership', content: { thesis: 'A metrics cadence the board can read: reliability, velocity, spend, talent.' } },
  { kind: 'template', name: 'HM outreach v2', category: 'Outreach', content: { est_reply: '31%' } },
]

// GET /api/app/library?owner=&kind= — playbooks / templates (seeds defaults once)
export async function libraryList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  const kind = req.query.get('kind')
  let client
  try {
    client = await getPgClient()
    const n = (await client.query(`select count(*)::int as n from library_entity where owner_email = $1`, [owner])).rows[0].n
    if (n === 0) {
      for (const e of DEFAULT_LIBRARY) {
        await client.query(`insert into library_entity (owner_email, is_demo, kind, name, category, content) values ($1, true, $2, $3, $4, $5)`,
          [owner, e.kind, e.name, e.category, JSON.stringify(e.content)])
      }
    }
    const rows = (await client.query(
      `select id, kind, name, category, content from library_entity where owner_email = $1 ${kind ? 'and kind = $2' : ''} order by kind, name`,
      kind ? [owner, kind] : [owner]
    )).rows
    return { status: 200, headers: HEADERS, jsonBody: { count: rows.length, entities: rows } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/answers/vision { imageBase64 }
// gpt-4o vision: detect application-form questions from a screenshot and draft
// copy-paste-ready answers grounded in the candidate's opportunity context.
export async function answersVision(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const body = await req.json().catch(() => ({})) as any
    let img = (body?.imageBase64 || '').toString()
    img = img.replace(/^data:image\/\w+;base64,/, '')
    if (img.length < 100) return { status: 400, headers: HEADERS, jsonBody: { error: 'imageBase64 required (a form screenshot)' } }
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()
    const o = (await client.query(`select company, role, comp_range, location, source, why_surfaced from opportunity where id = $1`, [oppId])).rows[0]
    if (!o) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const profile = `Candidate is applying for ${o.role} at ${o.company} (${o.location || 'n/a'}). Comp target: ${o.comp_range || 'n/a'}. Source: ${o.source || 'n/a'}. Why a fit: ${o.why_surfaced || 'n/a'}. US work-authorized, no sponsorship needed, ~4 weeks notice.`
    const instruction = `You detect application-form questions from a screenshot and draft concise, copy-paste-ready answers using the candidate profile. Return ONLY JSON: { "answers": [ { "question": "...", "answer": "..." } ] }. ${profile}`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } }
        ] }],
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    const answers = Array.isArray(parsed.answers) ? parsed.answers.filter((a: any) => a.question && a.answer) : []
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, company: o.company, role: o.role, count: answers.length, answers } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('answersVision', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/answers/vision', handler: answersVision })
app.http('assetsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/assets', handler: assetsList })
app.http('personasList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/personas', handler: personasList })
app.http('libraryList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/library', handler: libraryList })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const DEMO_EMAIL = 'demo@executive-engine.local'
const STAGES = ['discovered', 'saved', 'enriched', 'applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer', 'accepted']

function rowToOpp(r: any) {
  return {
    id: r.id, company: r.company, logo: r.logo_url, role: r.role, location: r.location,
    comp: r.comp_range, match: r.match_score, fit: r.fit, urgency: r.urgency,
    source: r.source, why: r.why_surfaced, hm: r.hiring_manager, recruiter: r.recruiter,
    rolesFor: r.roles_for, stage: r.stage, personaKey: r.persona_key, dismissed: r.dismissed,
    signals: r.company_signals, pain: r.pain_hypotheses, isDemo: r.is_demo
  }
}

// GET /api/app/opportunities?owner=&persona=&stage=  — list (excludes dismissed)
export async function opportunitiesList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = req.query.get('owner') || DEMO_EMAIL
  const persona = req.query.get('persona')
  const stage = req.query.get('stage')
  const includeDemo = req.query.get('includeDemo') !== 'false' // default: show demo/sample data
  let client
  try {
    client = await getPgClient()
    const conds = ['owner_email = $1', 'not dismissed']
    const params: any[] = [owner]
    if (!includeDemo) conds.push('not is_demo')
    if (persona) { params.push(persona); conds.push(`$${params.length} = any(roles_for)`) }
    if (stage) { params.push(stage); conds.push(`stage = $${params.length}`) }
    const rows = (await client.query(
      `select * from opportunity where ${conds.join(' and ')} order by match_score desc nulls last`, params
    )).rows

    // Stage funnel counts for the pipeline board
    const byStage: Record<string, number> = {}
    for (const s of STAGES) byStage[s] = 0
    for (const r of rows) byStage[r.stage] = (byStage[r.stage] || 0) + 1

    return { status: 200, headers: HEADERS, jsonBody: { stages: STAGES, byStage, count: rows.length, opportunities: rows.map(rowToOpp) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/opportunity/{id}  — detail + contacts
export async function opportunityDetail(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const id = req.params.id
  let client
  try {
    client = await getPgClient()
    const opp = (await client.query(`select * from opportunity where id = $1`, [id])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const contacts = (await client.query(`select name, role, signal, match from contact where opp_id = $1`, [id])).rows
    return { status: 200, headers: HEADERS, jsonBody: { ...rowToOpp(opp), contacts } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/stage { stage }  — advance/move pipeline stage
export async function opportunityMoveStage(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const id = req.params.id
  let client
  try {
    const body = await req.json() as any
    const stage = body?.stage
    if (!STAGES.includes(stage)) return { status: 400, headers: HEADERS, jsonBody: { error: `invalid stage; must be one of ${STAGES.join(', ')}` } }
    client = await getPgClient()
    const r = await client.query(`update opportunity set stage = $1, updated_at = now() where id = $2 returning id, stage`, [stage, id])
    if (!r.rowCount) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.rows[0].id, stage: r.rows[0].stage } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/dismiss  — soft-remove (swipe "pass")
export async function opportunityDismiss(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const id = req.params.id
  let client
  try {
    client = await getPgClient()
    const r = await client.query(`update opportunity set dismissed = true, updated_at = now() where id = $1 returning id`, [id])
    if (!r.rowCount) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.rows[0].id, dismissed: true } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('opportunitiesList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunities', handler: opportunitiesList })
app.http('opportunityDetail', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}', handler: opportunityDetail })
app.http('opportunityMoveStage', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/stage', handler: opportunityMoveStage })
app.http('opportunityDismiss', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/dismiss', handler: opportunityDismiss })

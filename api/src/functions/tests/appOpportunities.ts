import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite, serverError } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const DEMO_EMAIL = 'demo@executive-engine.local'
const STAGES = ['discovered', 'saved', 'enriched', 'applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer', 'accepted']

// Stage-transition history table (additive, idempotent). Records one row per
// stage change so metrics can compute dwell time (avg days per stage).
async function ensureStageHistory(client: any) {
  await client.query(`create table if not exists opportunity_stage_history (
    id uuid primary key default gen_random_uuid(),
    owner_email text,
    opportunity_id uuid,
    from_stage text,
    to_stage text,
    changed_at timestamptz default now()
  )`)
}

function rowToOpp(r: any) {
  return {
    id: r.id, company: r.company, logo: r.logo_url, role: r.role, location: r.location,
    comp: r.comp_range, match: r.match_score, fit: r.fit, urgency: r.urgency,
    source: r.source, why: r.why_surfaced, hm: r.hiring_manager, recruiter: r.recruiter,
    rolesFor: r.roles_for, stage: r.stage, personaKey: r.persona_key, dismissed: r.dismissed,
    signals: r.company_signals, pain: r.pain_hypotheses, isDemo: r.is_demo,
    createdAt: r.created_at, sourceDate: r.source_date,
    jdTitle: r.jd_title, jdCompany: r.jd_company, jdSummary: r.jd_summary,
    jdRequirements: r.jd_requirements, jdTable: r.jd_table
  }
}

// GET /api/app/opportunities?owner=&persona=&stage=  — list (excludes dismissed)
export async function opportunitiesList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  const persona = req.query.get('persona')
  const stage = req.query.get('stage')
  const includeDemo = req.query.get('includeDemo') !== 'false' // default: show demo/sample data
  let client
  try {
    client = await getPgClient()
    // `?stage=rejected` or `?includeDismissed=1|true` surfaces dismissed/rejected
    // opps (so the Pipeline can render a Rejected lane). Default is unchanged:
    // dismissed rows stay excluded.
    const idParam = (req.query.get('includeDismissed') || '').toLowerCase()
    const wantRejectedOnly = stage === 'rejected'
    const includeDismissed = wantRejectedOnly || idParam === '1' || idParam === 'true'

    const conds = ['owner_email = $1']
    const params: any[] = [owner]
    if (wantRejectedOnly) conds.push('dismissed')       // only rejected rows
    else if (!includeDismissed) conds.push('not dismissed')
    if (!includeDemo) conds.push('not is_demo')
    if (persona) { params.push(persona); conds.push(`$${params.length} = any(roles_for)`) }
    if (stage && !wantRejectedOnly) { params.push(stage); conds.push(`stage = $${params.length}`) }
    const rows = (await client.query(
      `select * from opportunity where ${conds.join(' and ')} order by match_score desc nulls last`, params
    )).rows

    // Stage funnel counts for the pipeline board (+ a 'rejected' lane count)
    const byStage: Record<string, number> = {}
    for (const s of STAGES) byStage[s] = 0
    byStage.rejected = 0
    for (const r of rows) {
      if (r.dismissed) byStage.rejected += 1
      else byStage[r.stage] = (byStage[r.stage] || 0) + 1
    }

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        stages: STAGES, byStage, count: rows.length, includeDismissed,
        // `rejected` marks dismissed rows so the UI can route them to a Rejected lane.
        opportunities: rows.map((r: any) => ({ ...rowToOpp(r), rejected: !!r.dismissed })),
      }
    }
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
    const guard = requireWrite(req); if (guard) return guard
    const body = await req.json() as any
    const stage = body?.stage
    if (!STAGES.includes(stage)) return { status: 400, headers: HEADERS, jsonBody: { error: `invalid stage; must be one of ${STAGES.join(', ')}` } }
    client = await getPgClient()
    // Capture the current stage + owner BEFORE the update so we can record the transition.
    const prev = (await client.query(`select stage, owner_email from opportunity where id = $1`, [id])).rows[0]
    if (!prev) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const r = await client.query(`update opportunity set stage = $1, updated_at = now() where id = $2 returning id, stage`, [stage, id])
    if (!r.rowCount) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    // Best-effort stage-transition history. Never break the stage change on failure — log and move on.
    try {
      await ensureStageHistory(client)
      if (prev.stage !== stage) {
        await client.query(
          `insert into opportunity_stage_history (owner_email, opportunity_id, from_stage, to_stage)
           values ($1, $2, $3, $4)`,
          [prev.owner_email, id, prev.stage, stage]
        )
      }
    } catch (histErr) {
      context.log(`opportunityMoveStage: failed to record stage history for ${id}: ${histErr}`)
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.rows[0].id, stage: r.rows[0].stage } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/dismiss  — soft-remove (swipe "pass")
export async function opportunityDismiss(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const id = req.params.id
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    client = await getPgClient()
    const r = await client.query(`update opportunity set dismissed = true, updated_at = now() where id = $1 returning id`, [id])
    if (!r.rowCount) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.rows[0].id, dismissed: true } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('opportunitiesList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunities', handler: opportunitiesList })
app.http('opportunityDetail', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}', handler: opportunityDetail })
app.http('opportunityMoveStage', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/stage', handler: opportunityMoveStage })
app.http('opportunityDismiss', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/dismiss', handler: opportunityDismiss })

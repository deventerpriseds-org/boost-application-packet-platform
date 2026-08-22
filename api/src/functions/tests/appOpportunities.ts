import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite, serverError } from './appSession'
import { getPgClient } from './pgClient'
import { resolveMetro, parseWorkMode } from './geoMaster'
import { getSearchPrefs } from './appSearchPrefs'
import { deriveTemperature, deriveActionPriority, DEFAULT_TEMP_THRESHOLDS, TempThresholds } from './signals'
// One direction only: appPackets does NOT import this module, so this cannot cycle.
import { markPacketSent } from './appPackets'

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

interface SignalCtx { nowMs: number; thr: TempThresholds; dueSet: Set<string> }

function rowToOpp(r: any, ctx?: SignalCtx) {
  const metro = resolveMetro(r.location || '')       // ACT-32: map free-text location → metro
  const workMode = parseWorkMode(r.location || '')   // ACT-33: remote / hybrid / onsite
  // Derived signals — computed HERE (the one funnel every screen reads) so Today/Opps/Swipe/Pipeline agree.
  const c = ctx || { nowMs: Date.now(), thr: DEFAULT_TEMP_THRESHOLDS, dueSet: new Set<string>() }
  const temp = deriveTemperature(r.source_date, r.created_at, c.nowMs, c.thr)
  const actionPriority = deriveActionPriority(r.stage, c.dueSet.has(r.id))
  return {
    metroName: metro?.name || null, metroGeoId: metro?.geoId || null, workMode,
    id: r.id, company: r.company, logo: r.logo_url, role: r.role, location: r.location,
    comp: r.comp_range, match: r.match_score, atsScore: r.ats_score ?? null, fit: r.fit, urgency: r.urgency,
    // recency temperature (+ posting age) and journey action-priority — the new signals
    temperature: temp.temperature, postedAgeDays: temp.ageDays, actionPriority,
    hasDueTouch: c.dueSet.has(r.id),
    source: r.source, why: r.why_surfaced, hm: r.hiring_manager, recruiter: r.recruiter,
    rolesFor: r.roles_for, stage: r.stage, personaKey: r.persona_key, dismissed: r.dismissed,
    isFavorite: !!r.is_favorite, tier: r.title_tier, matchedGroup: r.matched_group,
    matchedRole: r.matched_role, matchedVariation: r.matched_variation, baseScore: r.base_score,
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
    // Favorites first (priority flagging), then boosted match_score desc. `is_favorite`
    // is set by the taxonomy tagger; coalesce guards rows not yet tagged.
    const rows = (await client.query(
      `select * from opportunity where ${conds.join(' and ')}
       order by coalesce(is_favorite,false) desc, match_score desc nulls last`, params
    )).rows

    // Signal context — built ONCE per request: owner temperature thresholds + the set of opp ids that
    // have a DUE outreach touch (the "act today" event that bumps action-priority to urgent).
    const { tempThresholds } = await getSearchPrefs(client, owner)
    const dueRows = (await client.query(
      `select distinct m.opp_id from outreach_message m
         join opportunity o on o.id = m.opp_id
        where o.owner_email = $1 and m.state = 'due'`, [owner])).rows
    const ctx: SignalCtx = { nowMs: Date.now(), thr: tempThresholds, dueSet: new Set(dueRows.map((d: any) => d.opp_id)) }

    // Stage funnel counts for the pipeline board (+ a 'rejected' lane count)
    const byStage: Record<string, number> = {}
    for (const s of STAGES) byStage[s] = 0
    byStage.rejected = 0
    // Signal tallies so Today/Opps can show counts without re-deriving off the same funnel.
    const byTemperature: Record<string, number> = { hot: 0, warm: 0, cooling: 0, cold: 0 }
    const byPriority: Record<string, number> = { urgent: 0, active: 0, ready: 0, new: 0, done: 0 }
    const opps = rows.map((r: any) => {
      const o = rowToOpp(r, ctx)
      if (r.dismissed) byStage.rejected += 1
      else {
        byStage[r.stage] = (byStage[r.stage] || 0) + 1
        if (o.temperature) byTemperature[o.temperature] = (byTemperature[o.temperature] || 0) + 1
        byPriority[o.actionPriority] = (byPriority[o.actionPriority] || 0) + 1
      }
      return { ...o, rejected: !!r.dismissed }
    })

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        stages: STAGES, byStage, byTemperature, byPriority, count: rows.length, includeDismissed,
        tempThresholds,
        // `rejected` marks dismissed rows so the UI can route them to a Rejected lane.
        opportunities: opps,
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
    // APPLYING IS ONE INTENT, SO IT WRITES BOTH FACTS.
    //
    // The owner told us they applied; a packet they applied WITH has shipped, and leaving it at
    // "Ready to ship" would contradict the stage sitting next to it. This is deliberately NOT
    // wired to the outreach send: those channels include `linkedinConnect`, `coldCall` and
    // `followUp`, and a connect request is not an application — auto-advancing there would have
    // marked the pipeline applied on a LinkedIn touch. A human pressing "Mark as applied" is the
    // only signal that actually means it, which is why this hangs off the stage change and not
    // off `outreachSend`.
    //
    // Non-fatal and only forward: `markPacketSent` no-ops when there is no packet (an opportunity
    // can be applied to without one) and when it is already sent.
    const packetSent = stage === 'applied' ? await markPacketSent(client, id) : false
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.rows[0].id, stage: r.rows[0].stage, packetSent } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/dismiss  — soft-remove (swipe "pass").
// Body `{ undo: true }` reverses it (dismissed = false) so a mis-swipe can be
// restored to its original stage without any data loss.
export async function opportunityDismiss(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const id = req.params.id
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const body = await req.json().catch(() => ({})) as any
    const undo = body?.undo === true
    client = await getPgClient()
    const r = await client.query(
      `update opportunity set dismissed = $2, updated_at = now() where id = $1 returning id`,
      [id, !undo]
    )
    if (!r.rowCount) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.rows[0].id, dismissed: !undo } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('opportunitiesList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunities', handler: opportunitiesList })
app.http('opportunityDetail', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}', handler: opportunityDetail })
app.http('opportunityMoveStage', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/stage', handler: opportunityMoveStage })
app.http('opportunityDismiss', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/dismiss', handler: opportunityDismiss })

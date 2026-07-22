import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, serverError } from './appSession'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

// Stage grouping for the Today dashboard pipeline mix. Maps the 12 real pipeline
// stages (opportunity.stage) into the four board lanes the UI shows.
const STAGE_GROUPS: Record<string, string[]> = {
  reviewing: ['discovered', 'saved', 'enriched'],
  outreach: ['applied', 'outreach', 'engaged'],
  interviewing: ['screen', 'r1', 'panel', 'final'],
  offer: ['offer', 'accepted'],
}
const INTERVIEW_STAGES = ['screen', 'r1', 'panel', 'final']

// GET /api/app/metrics/today?owner= — REAL metrics for the Today dashboard.
// Every number is computed from live Postgres columns; anything not derivable
// from a real column is omitted (see `present`/`omitted` in the response) rather
// than fabricated.
export async function todayMetrics(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  const includeDemo = req.query.get('includeDemo') !== 'false'
  let client
  try {
    client = await getPgClient()
    const demoFilter = includeDemo ? '' : 'and not is_demo'

    // --- Pipeline mix: real count of active (non-dismissed) opps per stage ---
    const stageRows = (await client.query(
      `select stage, count(*)::int as n
         from opportunity
        where owner_email = $1 and not dismissed ${demoFilter}
        group by stage`, [owner]
    )).rows
    const byStage: Record<string, number> = {}
    for (const r of stageRows) byStage[r.stage] = r.n
    const pipelineMix: Record<string, { count: number; pct: number }> = {}
    let activeTotal = 0
    for (const g of Object.keys(STAGE_GROUPS)) {
      const c = STAGE_GROUPS[g].reduce((s, st) => s + (byStage[st] || 0), 0)
      pipelineMix[g] = { count: c, pct: 0 }
      activeTotal += c
    }
    for (const g of Object.keys(pipelineMix)) {
      pipelineMix[g].pct = activeTotal ? Math.round((pipelineMix[g].count / activeTotal) * 100) : 0
    }

    // --- KPIs (all from real opportunity columns) ---
    const hot = (await client.query(
      `select count(*)::int as n from opportunity where owner_email = $1 and not dismissed and urgency = 'Hot' ${demoFilter}`, [owner]
    )).rows[0].n
    const interviewCount = (await client.query(
      `select count(*)::int as n from opportunity
        where owner_email = $1 and not dismissed and stage = any($2::text[]) ${demoFilter}`,
      [owner, INTERVIEW_STAGES]
    )).rows[0].n
    const rejected = (await client.query(
      `select count(*)::int as n from opportunity where owner_email = $1 and dismissed ${demoFilter}`, [owner]
    )).rows[0].n

    // --- Weekly: opps created in last 7 days vs prior 7 days (real created_at) ---
    const weekly = (await client.query(
      `select
         count(*) filter (where created_at >= now() - interval '7 days')::int as last7,
         count(*) filter (where created_at < now() - interval '7 days' and created_at >= now() - interval '14 days')::int as prior7
       from opportunity
       where owner_email = $1 and not dismissed ${demoFilter}`, [owner]
    )).rows[0]
    const weeklyDelta = weekly.last7 - weekly.prior7

    // --- Outreach throughput + reply rate (real outreach_message columns) ---
    // A message counts as "sent" once it has a sent_at timestamp (set on send /
    // 'sent' state) and as "replied" once replied_at is set. replyRate = replied/sent.
    await client.query(`alter table outreach_message add column if not exists opened_at timestamptz`)
    await client.query(`alter table outreach_message add column if not exists replied_at timestamptz`)
    const outreach = (await client.query(
      `select
         count(*)::int as total,
         count(*) filter (where m.state = 'sent')::int as sent,
         count(*) filter (where m.sent_at is not null)::int as sent_count,
         count(*) filter (where m.opened_at is not null)::int as opened_count,
         count(*) filter (where m.replied_at is not null)::int as replied_count
       from outreach_message m
       join opportunity o on o.id = m.opp_id
      where o.owner_email = $1 and not o.dismissed ${includeDemo ? '' : 'and not o.is_demo'}`, [owner]
    )).rows[0]
    const replySent = outreach.sent_count
    const replyRate = {
      sent: replySent,
      replied: outreach.replied_count,
      opened: outreach.opened_count,
      pct: replySent ? Math.round((outreach.replied_count / replySent) * 100) : 0,
    }

    // --- Avg days per stage (dwell time) from opportunity_stage_history ---
    // For each opportunity, the dwell time in a stage is the gap between the
    // transition INTO it and the next transition OUT. We average those gaps.
    // If no transitions have been recorded yet, return null + 'accumulating'.
    await client.query(`create table if not exists opportunity_stage_history (
      id uuid primary key default gen_random_uuid(),
      owner_email text,
      opportunity_id uuid,
      from_stage text,
      to_stage text,
      changed_at timestamptz default now()
    )`)
    const histCount = (await client.query(
      `select count(*)::int as n from opportunity_stage_history where owner_email = $1`, [owner]
    )).rows[0].n
    let avgDaysPerStage: any
    if (histCount === 0) {
      avgDaysPerStage = null
    } else {
      // Dwell in a stage = time from the transition that ENTERED it (to_stage=S)
      // until the next transition on the same opp. Overall + per-stage averages.
      const dwell = (await client.query(
        `with events as (
           select opportunity_id, to_stage as stage, changed_at,
                  lead(changed_at) over (partition by opportunity_id order by changed_at) as next_at
             from opportunity_stage_history
            where owner_email = $1
         ),
         spans as (
           select stage, extract(epoch from (next_at - changed_at)) / 86400.0 as days
             from events where next_at is not null
         )
         select stage, avg(days)::float8 as avg_days, count(*)::int as n from spans group by stage`, [owner]
      )).rows
      const perStage: Record<string, { avgDays: number; transitions: number }> = {}
      let totalDays = 0, totalN = 0
      for (const d of dwell) {
        perStage[d.stage] = { avgDays: Math.round(d.avg_days * 10) / 10, transitions: d.n }
        totalDays += d.avg_days * d.n
        totalN += d.n
      }
      avgDaysPerStage = {
        overall: totalN ? Math.round((totalDays / totalN) * 10) / 10 : null,
        perStage,
        completedTransitions: totalN,
      }
    }

    // --- Goals / today's activity (real timestamps) ---
    const reviewedToday = (await client.query(
      `select count(*)::int as n from opportunity
        where owner_email = $1 and not dismissed and updated_at::date = current_date ${demoFilter}`, [owner]
    )).rows[0].n
    const packetsBuiltToday = (await client.query(
      `select count(*)::int as n from packet p
        join opportunity o on o.id = p.opp_id
       where o.owner_email = $1 and p.created_at::date = current_date ${includeDemo ? '' : 'and not o.is_demo'}`, [owner]
    )).rows[0].n
    const outreachSentToday = (await client.query(
      `select count(*)::int as n from outreach_message m
        join opportunity o on o.id = m.opp_id
       where o.owner_email = $1 and m.sent_at is not null and m.sent_at::date = current_date ${includeDemo ? '' : 'and not o.is_demo'}`, [owner]
    )).rows[0].n

    const metrics = {
      pipelineMix,                              // { reviewing|outreach|interviewing|offer: { count, pct } }
      kpis: {
        active: activeTotal,                    // non-dismissed opportunities
        hot,                                    // urgency = 'Hot'
        interview: interviewCount,              // stage in screen/r1/panel/final
        rejected,                               // dismissed = true
      },
      weekly: {
        last7: weekly.last7,                    // created in last 7 days
        prior7: weekly.prior7,                  // created in the 7 days before that
        delta: weeklyDelta,
      },
      outreach: {
        total: outreach.total,
        sent: outreach.sent,
        replyRate,                              // { sent, replied, opened, pct } — real counts
      },
      // Avg dwell time per stage from opportunity_stage_history. null (with
      // note 'accumulating') until at least one stage transition is recorded.
      avgDaysPerStage,                          // null | { overall, perStage, completedTransitions }
      goals: {
        reviewedToday,                          // opps updated today
        packetsBuiltToday,                      // packets created today
        outreachSentToday,                      // outreach messages sent today
      },
      // Keys computed from real columns and returned above:
      present: [
        'pipelineMix', 'kpis.active', 'kpis.hot', 'kpis.interview', 'kpis.rejected',
        'weekly.last7', 'weekly.prior7', 'weekly.delta',
        'outreach.total', 'outreach.sent', 'outreach.replyRate',
        ...(avgDaysPerStage === null ? [] : ['avgDaysPerStage']),
        'goals.reviewedToday', 'goals.packetsBuiltToday', 'goals.outreachSentToday',
      ],
      // Metrics not currently derivable (populated as data accumulates):
      omitted: avgDaysPerStage === null
        ? { avgDaysPerStage: 'accumulating — no stage transitions recorded yet' }
        : {},
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, metrics } }
  } catch (err) {
    return serverError(err, HEADERS)
  } finally { try { await client?.end() } catch {} }
}

app.http('todayMetrics', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/metrics/today', handler: todayMetrics })

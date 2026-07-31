import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { loadConfig } from './mailWatch'
import { getSearchPrefs } from './appSearchPrefs'
import { buildAllTitleQueries, makeKeepCard, runOneQuery, fillJdsForFresh, RoleQuery } from './jdSearch'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ── Pattern B: full-coverage LinkedIn title sweep ──────────────────────────────────────────────
// WHY: the owner's favourite titles are a {seniority}×{discipline} grid — 651 distinct titles today.
// The old batch timer only searched 8 titles/role (~136, ~21%). To cover ALL 651 without tripping
// LinkedIn's single-IP throttle (~10 reqs/burst → 429) OR paying for billed sleep on the Consumption
// (Y1 Dynamic) plan, we DON'T loop-with-sleeps in one long execution (would blow the 10-min cap and
// waste GB-s). Instead: a per-MINUTE timer runs exactly ONE query per fire, walking a DB cursor over
// the ~87 OR-batches. Each fire is ~2s → negligible GB-s, immune to the 10-min timeout, naturally
// paced. A full sweep of all 651 completes across the active window each day (24h look-back = no gaps).
//
// State + config live on owner_search_prefs (EXTENDED, not a new table): search_enabled (the switch,
// default OFF), titles_per_query, active_hours_et, plus the cursor (sweep_index/cycle, backoff_until,
// consec_blocks, last_fired_at/last_query). All owner-settable via GET/POST /api/app/search-sweep.

const DEFAULT_ACTIVE_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]   // ET; ~11 slots ≈ full sweep/day
const SWEEP_TZ = 'America/New_York'

function hourInTz(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()))
}

// Add the sweep columns once (idempotent). owner_search_prefs itself is ensured by getSearchPrefs.
async function ensureSweepCols(client: any) {
  await client.query(`
    alter table owner_search_prefs add column if not exists search_enabled  boolean     not null default false;
    alter table owner_search_prefs add column if not exists titles_per_query int         not null default 8;
    alter table owner_search_prefs add column if not exists active_hours_et  int[]       not null default '{6,7,8,9,10,11,12,13,14,15,16}';
    alter table owner_search_prefs add column if not exists sweep_index      int         not null default 0;
    alter table owner_search_prefs add column if not exists sweep_cycle      int         not null default 0;
    alter table owner_search_prefs add column if not exists backoff_until    timestamptz;
    alter table owner_search_prefs add column if not exists consec_blocks    int         not null default 0;
    alter table owner_search_prefs add column if not exists last_fired_at    timestamptz;
    alter table owner_search_prefs add column if not exists last_query       text;
  `)
}

interface SweepState {
  enabled: boolean; titlesPerQuery: number; activeHoursEt: number[]
  sweepIndex: number; sweepCycle: number; backoffUntil: string | null
  consecBlocks: number; lastFiredAt: string | null; lastQuery: string | null
}

async function getSweepState(client: any, owner: string): Promise<SweepState> {
  await getSearchPrefs(client, owner)   // ensures base table
  await ensureSweepCols(client)
  const r = (await client.query(
    `select search_enabled, titles_per_query, active_hours_et, sweep_index, sweep_cycle,
            backoff_until, consec_blocks, last_fired_at, last_query
       from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  return {
    enabled: !!r?.search_enabled,
    titlesPerQuery: r?.titles_per_query ?? 8,
    activeHoursEt: (r?.active_hours_et && r.active_hours_et.length) ? r.active_hours_et : DEFAULT_ACTIVE_HOURS,
    sweepIndex: r?.sweep_index ?? 0,
    sweepCycle: r?.sweep_cycle ?? 0,
    backoffUntil: r?.backoff_until ? new Date(r.backoff_until).toISOString() : null,
    consecBlocks: r?.consec_blocks ?? 0,
    lastFiredAt: r?.last_fired_at ? new Date(r.last_fired_at).toISOString() : null,
    lastQuery: r?.last_query ?? null,
  }
}

// One timer fire = at most ONE query. Deterministic query list, cursor picks the next one.
export async function jdSweepTick(_t: Timer, context: InvocationContext): Promise<void> {
  let client: any
  try {
    const owner = (await loadConfig()).ownerEmail
    client = await getPgClient()
    const st = await getSweepState(client, owner)

    if (!st.enabled) { context.log('jd-sweep: disabled (search_enabled=false) — skip'); return }
    const etHour = hourInTz(SWEEP_TZ)
    if (!st.activeHoursEt.includes(etHour)) { context.log(`jd-sweep: skip (ET hour ${etHour} not active)`); return }
    if (st.backoffUntil && Date.now() < Date.parse(st.backoffUntil)) {
      context.log(`jd-sweep: backing off until ${st.backoffUntil} — skip`); return
    }

    const queries: RoleQuery[] = await buildAllTitleQueries(client, owner, st.titlesPerQuery)
    if (!queries.length) { context.log('jd-sweep: no queries built — skip'); return }

    // small human jitter (2–15s) so fires aren't a rigid metronome; negligible GB-s.
    await new Promise((res) => setTimeout(res, 2000 + Math.floor(Math.random() * 13000)))

    const idx = ((st.sweepIndex % queries.length) + queries.length) % queries.length
    const q = queries[idx]
    const prefs = await getSearchPrefs(client, owner)
    const res = await runOneQuery(client, owner, q, makeKeepCard(prefs), { tpr: 'r86400', pages: 1 })

    if (res.blocked) {
      // 429/quota wall: exponential backoff, DO NOT advance the cursor (retry same query next time).
      const blocks = st.consecBlocks + 1
      const backoffMin = Math.min(60, 2 ** Math.min(blocks, 6))   // 2,4,8,16,32,60 min cap
      await client.query(
        `update owner_search_prefs set consec_blocks=$2, backoff_until=now() + ($3 || ' minutes')::interval,
             last_fired_at=now(), last_query=$4 where owner_email=$1`,
        [owner, blocks, String(backoffMin), q.keywords])
      context.log(`jd-sweep: BLOCKED on [${idx}/${queries.length}] "${q.role}" — backoff ${backoffMin}m (streak ${blocks})`)
      return
    }

    // JD-fill the new opps this query found (bounded, paced, shared with the batch path).
    const jd = await fillJdsForFresh(client, res.fresh, 20)

    // advance cursor; wrap → next cycle.
    const nextIdx = idx + 1
    const wrapped = nextIdx >= queries.length
    await client.query(
      `update owner_search_prefs set sweep_index=$2, sweep_cycle = sweep_cycle + $3,
           consec_blocks=0, backoff_until=null, last_fired_at=now(), last_query=$4 where owner_email=$1`,
      [owner, wrapped ? 0 : nextIdx, wrapped ? 1 : 0, q.keywords])
    context.log(`jd-sweep [${idx + 1}/${queries.length}] "${q.role}" (${q.titles} titles): cards=${res.cards} new=${res.inserted} dup=${res.duplicate} jdStored=${jd.jdStored}${wrapped ? ' — CYCLE COMPLETE' : ''}`)
  } catch (e) {
    context.log(`jd-sweep error: ${e}`)
  } finally { try { await client?.end() } catch {} }
}

// GET  /api/app/search-sweep → config + cursor + the exact built queries (preview before enabling).
// POST /api/app/search-sweep → update { enabled, titlesPerQuery, activeHoursEt } (verified session).
export async function searchSweep(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client: any
  try {
    client = await getPgClient()
    if (req.method === 'GET') {
      const st = await getSweepState(client, owner)
      const queries = await buildAllTitleQueries(client, owner, st.titlesPerQuery)
      return {
        status: 200, headers: HEADERS,
        jsonBody: {
          ok: true,
          config: { enabled: st.enabled, titlesPerQuery: st.titlesPerQuery, activeHoursEt: st.activeHoursEt },
          cursor: {
            sweepIndex: st.sweepIndex, sweepCycle: st.sweepCycle, backoffUntil: st.backoffUntil,
            consecBlocks: st.consecBlocks, lastFiredAt: st.lastFiredAt, lastQuery: st.lastQuery,
          },
          totalQueries: queries.length,
          totalTitles: queries.reduce((n, q) => n + q.titles, 0),
          queries: queries.map((q, i) => ({ index: i, role: q.role, titles: q.titles, keywords: q.keywords })),
        },
      }
    }
    const guard = requireWrite(req); if (guard) return guard
    const b = (await req.json().catch(() => ({}))) as any
    await getSweepState(client, owner)   // ensure columns exist
    const sets: string[] = []; const vals: any[] = [owner]
    if (typeof b.enabled === 'boolean') { vals.push(b.enabled); sets.push(`search_enabled=$${vals.length}`) }
    if (Number.isFinite(b.titlesPerQuery)) { vals.push(Math.max(1, Math.min(12, Math.floor(b.titlesPerQuery)))); sets.push(`titles_per_query=$${vals.length}`) }
    if (Array.isArray(b.activeHoursEt)) {
      const hours = b.activeHoursEt.map((n: any) => Math.floor(Number(n))).filter((n: number) => n >= 0 && n <= 23)
      vals.push(hours); sets.push(`active_hours_et=$${vals.length}`)
    }
    if (!sets.length) return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'nothing to update' } }
    await client.query(`update owner_search_prefs set ${sets.join(', ')}, updated_at=now() where owner_email=$1`, vals)
    const st = await getSweepState(client, owner)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, config: { enabled: st.enabled, titlesPerQuery: st.titlesPerQuery, activeHoursEt: st.activeHoursEt } } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('searchSweep', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/search-sweep', handler: searchSweep })
// Pattern B: fire every minute; the handler gates on enabled + active-hour + backoff and does ≤1 query.
app.timer('jdSweepTick', { schedule: '0 */1 * * * *', handler: jdSweepTick })

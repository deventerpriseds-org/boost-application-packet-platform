import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { routeOpportunity, loadConfig } from './mailWatch'
import { scraperFetch, classifyResponse, sleepJitter } from './scraperProxy'
import { canonicalJobUrl } from './jdLinks'
import { SEED } from './roleTaxonomy'
import { fetchAndStoreJd, ensureJdCols } from './jdBackfill'
import { getSearchPrefs } from './appSearchPrefs'
import { resolveMetro, parseWorkMode } from './geoMaster'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

const strip = (s: string) =>
  (s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/gi, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()

// LinkedIn public guest job-SEARCH endpoint. f_E=5,6 = Director + Executive experience levels;
// f_TPR=r{sec} = posted within N seconds (r86400 = 24h). Paginates by start (increments of 25).
export function buildSearchUrl(keywords: string, opts: { location?: string; tpr?: string; start?: number } = {}): string {
  const p = new URLSearchParams({
    keywords, location: opts.location || 'United States',
    f_E: '5,6', f_TPR: opts.tpr || 'r86400', start: String(opts.start || 0),
  })
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${p.toString()}`
}

export interface SearchCard { jobId: string; title: string; company: string; location: string; postedDate: string | null }

// Parse the search HTML (a list of job cards) → structured cards. jobId comes from the
// urn:li:jobPosting:{id} entity-urn (or the /jobs/view/…-{id} link). Dedup by jobId.
export function parseSearchCards(html: string): SearchCard[] {
  const out: SearchCard[] = []
  const seen = new Set<string>()
  for (const chunk of html.split(/<li[\s>]/i).slice(1)) {
    const idM = chunk.match(/urn:li:jobPosting:(\d{6,})/) || chunk.match(/jobs\/view\/[^"?]*?-(\d{6,})/)
    if (!idM) continue
    const jobId = idM[1]
    if (seen.has(jobId)) continue
    seen.add(jobId)
    const title = strip((chunk.match(/base-search-card__title[^>]*>([\s\S]*?)<\//i) || [])[1] || '')
    const company = strip((chunk.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || '')
    const location = strip((chunk.match(/job-search-card__location[^>]*>([\s\S]*?)<\//i) || [])[1] || '')
    const postedDate = (chunk.match(/datetime="([\d-]+)"/) || [])[1] || null
    if (title && company) out.push({ jobId, title, company, location, postedDate })
  }
  return out
}

// The user's roles to search for: their favourite role names (taxonomy_title tier=fav) → persona
// master_role → the seeded taxonomy roles. Deduped, capped. Extends the existing role systems.
async function loadRoleKeywords(client: any, owner: string, max = 40): Promise<string[]> {
  const norm = (arr: string[]) => Array.from(new Set(arr.map((s) => (s || '').trim()).filter(Boolean))).slice(0, max)
  try {
    const r = await client.query(`select distinct role from taxonomy_title where owner_email=$1 and tier='fav'`, [owner])
    if (r.rows.length) return norm(r.rows.map((x: any) => x.role))
  } catch { /* table may not exist */ }
  try {
    const r = await client.query(`select distinct master_role from persona where owner_email=$1 and master_role is not null`, [owner])
    if (r.rows.length) return norm(r.rows.map((x: any) => x.master_role))
  } catch { /* */ }
  return norm(SEED.roles.map((r) => r.role))
}

export interface RoleQuery { role: string; keywords: string; titles: number }

// ACT-29: search on the FAVOURITE TITLE VARIANTS (taxonomy_title tier='fav', the level below role),
// not the bare role name. Per role, OR-concatenate that role's favourite titles into ONE guest-search
// query — e.g. `"Chief Technology Officer" OR "Platform CTO" OR "Enterprise CTO"` — so one search
// covers all of a role's target titles. Results whose title matches a fav variant get is_favorite=true
// via tagFields, so they surface under the favourite+recent scope; fuzzy near-misses fall to watch/off.
// Capped at maxTitlesPerQuery phrases/role to keep the keyword string under LinkedIn's length limit.
// Falls back to role-name search when the user has no favourites yet.
async function loadFavoriteTitleQueries(
  client: any, owner: string, opts: { maxRoles?: number; maxTitlesPerQuery?: number } = {},
): Promise<RoleQuery[]> {
  const maxRoles = opts.maxRoles || 40
  const maxTitles = Math.max(1, Math.min(12, opts.maxTitlesPerQuery || 8))
  try {
    const r = await client.query(
      `select role, array_agg(distinct title) as titles
         from taxonomy_title
        where owner_email=$1 and tier='fav' and coalesce(title,'') <> ''
        group by role order by role`,
      [owner],
    )
    const queries: RoleQuery[] = []
    for (const row of r.rows) {
      const titles = Array.from(new Set((row.titles || []).map((s: string) => String(s).trim()).filter(Boolean))).slice(0, maxTitles)
      if (!titles.length) continue
      queries.push({ role: row.role, keywords: titles.map((t) => `"${t}"`).join(' OR '), titles: titles.length })
    }
    if (queries.length) return queries.slice(0, maxRoles)
  } catch { /* taxonomy_title may not exist */ }
  // Fallback: search bare role names (previous behaviour).
  return (await loadRoleKeywords(client, owner, maxRoles)).map((role) => ({ role, keywords: role, titles: 0 }))
}

// Core: search each role on the guest endpoint (direct, hardened, jittered), parse cards, and route
// each through the SAME opportunity pipeline (dedup + role-tag + jobId/url capture). It only
// DISCOVERS + inserts — the real JD is filled by the paced direct fetch (jd-backfill/fetch), so this
// stays fast and bounded. Stops a role's paging on a block; whole run halts on repeated blocks.
export async function runRoleSearch(owner: string, opts: { tpr?: string; location?: string; pages?: number; roleLimit?: number; fetchJds?: boolean; jdFetchCap?: number } = {}) {
  const pages = Math.max(1, Math.min(3, opts.pages || 1))
  const fetchJds = opts.fetchJds !== false               // inline-fetch the real JD for each new opp (default on)
  const jdFetchCap = Math.max(0, Math.min(40, opts.jdFetchCap ?? 20))  // bound the inline burst — usually a handful/cycle
  let client: any
  const summary = { roles: 0, searched: 0, cardsFound: 0, inserted: 0, duplicate: 0, blocked: 0, jdFetched: 0, jdStored: 0, jdOutcomes: {} as Record<string, number>, byRole: [] as any[] }
  const fresh: Array<{ id: string; job_id: string }> = []   // newly-inserted opps to fill JDs for
  try {
    client = await getPgClient()
    // ACT-29: one OR-concatenated favourite-TITLE query per role (falls back to role names).
    const queries = await loadFavoriteTitleQueries(client, owner, { maxRoles: opts.roleLimit || 40 })
    summary.roles = queries.length
    // ACT-34: location/remote gate applied at INGEST (before insert + JD-fetch) so off-target cards
    // never cost a JD fetch. Empty target set + no remote-only = keep everything (unchanged behaviour).
    const prefs = await getSearchPrefs(client, owner)
    const targets = new Set(prefs.targetGeoIds)
    const keepCard = (loc: string): boolean => {
      if (!targets.size && !prefs.remoteOnly) return true
      const m = resolveMetro(loc || '')
      const inTarget = !!(m && m.geoId && targets.has(m.geoId))
      const isRemote = parseWorkMode(loc || '') === 'remote'
      if (targets.size && prefs.remoteOnly) return inTarget || isRemote
      if (targets.size) return inTarget
      return isRemote // remoteOnly, no target metros
    }
    ;(summary as any).skippedLocation = 0
    let consecBlocked = 0
    for (const q of queries) {
      const role = q.role
      let roleInserted = 0, roleCards = 0
      for (let pg = 0; pg < pages; pg++) {
        const url = buildSearchUrl(q.keywords, { tpr: opts.tpr, location: opts.location, start: pg * 25 })
        const r = await scraperFetch(url, { force: 'direct' })
        summary.searched++
        const outcome = classifyResponse(r.status, r.body, false)
        if (outcome === 'blocked' || outcome === 'quota_exceeded') { summary.blocked++; consecBlocked++; break }
        consecBlocked = 0
        const cards = parseSearchCards(r.body)
        roleCards += cards.length; summary.cardsFound += cards.length
        for (const c of cards) {
          if (!keepCard(c.location)) { (summary as any).skippedLocation++; continue }  // ACT-34 location/remote gate
          const res = await routeOpportunity(client, owner,
            { company: c.company, role: c.title, location: c.location, url: canonicalJobUrl(c.jobId), postedDate: c.postedDate, jobId: c.jobId },
            { source: 'LinkedIn Search' })
          if (res.inserted) { summary.inserted++; roleInserted++; if (res.id) fresh.push({ id: res.id, job_id: c.jobId }) } else summary.duplicate++
        }
        if (cards.length < 25) break            // last page for this role
        await sleepJitter(2500)                 // human pacing between pages
      }
      summary.byRole.push({ role, titles: q.titles, cards: roleCards, inserted: roleInserted })
      if (consecBlocked >= 3) break             // real wall — stop the run
      await sleepJitter(3000)                   // human pacing between roles
    }

    // Inline JD-fetch phase: fill jd_real for the handful of NEW opps this cycle found, using the
    // SAME direct-from-Azure paced fetch as the backfill sweep (fetchAndStoreJd). Bounded by
    // jdFetchCap and paced with jitter so it never approaches the ~30-burst/IP wall. Stops early on
    // a genuine block/quota wall (leaves the rest for the next cycle rather than hammering).
    if (fetchJds && fresh.length && jdFetchCap > 0) {
      await ensureJdCols(client)
      let consec = 0
      for (const opp of fresh.slice(0, jdFetchCap)) {
        const { outcome, stored } = await fetchAndStoreJd(client, opp, { runTag: 'search-inline' })
        summary.jdFetched++
        summary.jdOutcomes[outcome] = (summary.jdOutcomes[outcome] || 0) + 1
        if (stored) summary.jdStored++
        if (outcome === 'blocked' || outcome === 'quota_exceeded') { if (++consec >= 3) break } else consec = 0
        await sleepJitter(2500)                 // human pacing between JD fetches
      }
    }
    return summary
  } finally { try { await client?.end() } catch {} }
}

// POST /api/mail/jd-search — manual trigger. body: { tpr?, location?, pages?, roleLimit? }
export async function jdSearch(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const body = (await req.json().catch(() => ({}))) as any
  const cfg = await loadConfig()
  try {
    const summary = await runRoleSearch(cfg.ownerEmail, body)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...summary } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  }
}

// The owner's local run-hours (Eastern) — the search fires at these hours ET.
const SEARCH_HOURS_ET = [5, 13, 18]     // 5am, 1pm, 6pm
const SEARCH_TZ = 'America/New_York'
function hourInTz(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()))
}

// Timer: exec-role search 3×/day at 5am/1pm/6pm ET. Because NCRONTAB fires in UTC and ET shifts with
// DST, we fire at the UTC hours that bracket those ET times (09/10, 17/18, 22/23) and then run ONLY
// when it's actually 5/13/18 in New York — DST-safe and independent of any WEBSITE_TIME_ZONE setting.
// PAUSE SWITCH. Search targets the favourite title variants (ACT-29), one OR-query per role; the full
// set fits ONE ET slot (5am/1pm/6pm). RE-PAUSED 2026-07-31 at owner request: hold OFF until the owner
// can REVIEW the exact built queries and explicitly approve (see ACT-36 — query preview). The manual
// POST /api/mail/jd-search still works for testing. Flip to false only after that sign-off.
const SEARCH_PAUSED = true

export async function jdSearchTimer(_t: Timer, context: InvocationContext): Promise<void> {
  if (SEARCH_PAUSED) { context.log('jd-search timer: PAUSED (SEARCH_PAUSED=true) — skipping'); return }
  const etHour = hourInTz(SEARCH_TZ)
  if (!SEARCH_HOURS_ET.includes(etHour)) { context.log(`jd-search timer: skip (ET hour ${etHour} not in ${SEARCH_HOURS_ET})`); return }
  try {
    const cfg = await loadConfig()
    const s = await runRoleSearch(cfg.ownerEmail, { tpr: 'r86400', pages: 1 })   // inline JD-fetch on by default
    context.log(`jd-search timer @${etHour}:00 ET: roles=${s.roles} cards=${s.cardsFound} inserted=${s.inserted} dup=${s.duplicate} blocked=${s.blocked} jdFetched=${s.jdFetched} jdStored=${s.jdStored}`)
  } catch (e) { context.log(`jd-search timer error: ${e}`) }
}

app.http('jdSearch', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-search', handler: jdSearch })
// Fire at the UTC hours covering 5am/1pm/6pm ET across DST; the handler gates to the exact ET hour.
app.timer('jdSearchTimer', { schedule: '0 0 9,10,17,18,22,23 * * *', handler: jdSearchTimer })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { getMicrosoftToken } from './googleAuth'
import { loadConfig, graphCreds, isAlert, parseAlert, embedBatch } from './mailWatch'
import { extractJobAnchors, canonicalJobUrl, normText, tokenSim, injectJobMarkers } from './jdLinks'
import { scraperFetch, extractGuestJdHtml, classifyResponse } from './scraperProxy'
import { logJdFetch } from './jdFetchLog'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

async function ensureCols(client: any): Promise<void> {
  await client.query(`alter table opportunity add column if not exists job_id text`)
  await client.query(`alter table opportunity add column if not exists job_url text`)
  await client.query(`alter table opportunity add column if not exists jd_real text`)
  await client.query(`alter table opportunity add column if not exists jd_fetched_at timestamptz`)
}

const guestUrl = (jobId: string) => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`

// Ensure the jd_real/jd_fetched_at columns exist without needing the full ensureCols dance.
// Exposed so callers outside this file (e.g. the inline search fetch) can be defensive on first run.
export async function ensureJdCols(client: any): Promise<void> { await ensureCols(client) }

// Fetch ONE opp's real JD from the LinkedIn guest endpoint, classify, log to jd_fetch_log, and
// persist. Shared by the paced backfill sweep and the inline search fetch so both stay identical:
// ok_jd → store jd_real; auth_required/not_found → mark fetched (terminal on guest endpoint) so it
// isn't retried forever; blocked/empty/etc → leave for a later attempt. Direct-from-Azure, no proxy.
// Caller is responsible for pacing (jitter/sleep) between calls. Returns the outcome + whether stored.
export async function fetchAndStoreJd(
  client: any,
  row: { id: string; job_id: string },
  opts: { runTag?: string; concurrency?: number } = {},
): Promise<{ outcome: string; stored: boolean }> {
  const r: any = await scraperFetch(guestUrl(String(row.job_id)), { force: 'direct' })
  const jd = extractGuestJdHtml(r.body)
  const outcome = classifyResponse(r.status, r.body, jd.descriptionHtml != null)
  await logJdFetch({
    jobId: String(row.job_id), provider: r.provider || 'direct', via: r.via, httpStatus: r.status,
    outcome, jdTextLen: jd.textLen, bytes: r.body.length, latencyMs: r.latencyMs,
    concurrency: opts.concurrency || 1, runTag: opts.runTag || 'inline', usage: r.usage, error: r.error,
  })
  let stored = false
  if (outcome === 'ok_jd' && jd.descriptionHtml) {
    await client.query(`update opportunity set jd_real = $1, jd_fetched_at = now() where id = $2`, [jd.descriptionHtml, row.id])
    stored = true
  } else if (outcome === 'auth_required' || outcome === 'not_found') {
    await client.query(`update opportunity set jd_fetched_at = now() where id = $1 and jd_real is null`, [row.id])
  }
  return { outcome, stored }
}

// ---------------------------------------------------------------------------
// POST /api/mail/jd-backfill/scan  — recover jobIds for EXISTING opportunities. LLM-FREE.
// The ingest fix only captures jobIds going forward; opps ingested before it have none. This
// re-reads the last {days} of alert emails, extracts each job anchor's {jobId, title, tail} from the
// HTML (no LLM → zero OpenAI exposure, no 504 timeout), and back-links the jobId onto the matching
// existing opp: the anchor's company must appear in the anchor tail AND its title must overlap the
// opp's role (or a very strong title match alone). Under-links rather than mis-links when unsure.
// Body: { days?: 14, maxEmails?: 400 }
// ---------------------------------------------------------------------------
export async function jdBackfillScan(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const body = (await req.json().catch(() => ({}))) as any
  const days = Math.max(1, Math.min(90, Number(body.days) || 14))
  const llm = body.llm === true          // LLM mode: parseAlert + exact company+role match (reliable)
  const maxEmails = Math.max(1, Math.min(2000, Number(body.maxEmails) || (llm ? 1000 : 400)))  // llm is time-bounded, not count-bounded
  const beforeIso = typeof body.beforeIso === 'string' ? body.beforeIso : null  // pagination cursor

  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: 'Graph app credentials not configured' } }
  const cfg = await loadConfig()
  const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString()
  const filter = `receivedDateTime ge ${sinceIso}` + (beforeIso ? ` and receivedDateTime lt ${beforeIso}` : '')

  let client: any
  try {
    client = await getPgClient()
    await ensureCols(client)

    // LLM MODE — reads the whole email, gets {company, role, jobId} per role, exact-matches an
    // existing opp (job_id null). Reliable where anchor-context string matching fails. Paged 100
    // emails/call via beforeIso so it stays under Azure's 240s cap; OpenAI calls have 429 backoff.
    if (llm) {
      let url: string | null = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages?$filter=${filter}&$select=subject,from,bodyPreview,body,receivedDateTime&$top=50&$orderby=receivedDateTime desc`
      let scanned = 0, alerts = 0, idsFound = 0, linked = 0, alreadyHad = 0, oldestIso: string | null = null
      const startMs = Date.now()
      const TIME_BUDGET_MS = 160_000   // stop well under Azure's 240s gateway cap; return a cursor
      let timedOut = false
      while (url && scanned < maxEmails && !timedOut) {
        const res: any = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: `Graph messages HTTP ${res.status}`, detail: (await res.text()).slice(0, 400) } }
        const page = (await res.json()) as any
        for (const msg of (page.value || [])) {
          if (scanned >= maxEmails) break
          if (Date.now() - startMs > TIME_BUDGET_MS) { timedOut = true; break }  // per-email check → reliable return
          scanned++
          if (msg?.receivedDateTime) oldestIso = msg.receivedDateTime  // desc order → last seen is oldest
          const from = (msg?.from?.emailAddress?.address || '').toLowerCase()
          if (!isAlert(cfg, from, msg?.subject || '', msg?.bodyPreview || '')) continue
          const { text, ids } = injectJobMarkers(msg?.body?.content || '')
          if (!ids.length) continue
          // Skip the LLM call entirely if every jobId in this email is already linked (saves OpenAI
          // + time on the newest emails, which the earlier passes already did).
          const linkedIds = (await client.query(`select job_id from opportunity where owner_email=$1 and job_id = any($2::text[])`, [cfg.ownerEmail, ids])).rows.map((r: any) => String(r.job_id))
          if (linkedIds.length >= ids.length) { alreadyHad += ids.length; continue }
          alerts++
          const opps = (await parseAlert(text)).filter((o: any) => o.jobId)   // gpt-4o-mini, 429-backoff
          // Pass 1 — free exact match; collect the ones that miss for a single batched embed.
          const needEmbed: any[] = []
          for (const o of opps) {
            idsFound++
            const has = await client.query(`select 1 from opportunity where owner_email=$1 and job_id=$2 limit 1`, [cfg.ownerEmail, String(o.jobId)])
            if (has.rowCount) { alreadyHad++; continue }
            const exact = (await client.query(
              `select id from opportunity where owner_email=$1 and job_id is null
                 and lower(company)=lower($2) and lower(role)=lower($3) order by created_at desc limit 1`,
              [cfg.ownerEmail, o.company, o.role])).rows[0]?.id || null
            if (exact) {
              await client.query(`update opportunity set job_id=$1, job_url=$2 where id=$3 and job_id is null`,
                [String(o.jobId), canonicalJobUrl(String(o.jobId)), exact])
              linked++
            } else needEmbed.push(o)
          }
          // Pass 2 — ONE embeddings call for all exact-misses, then pgvector nearest-neighbour each.
          if (needEmbed.length) {
            const vecs = await embedBatch(needEmbed.map((o) => `${o.company} — ${o.role}`))
            for (let k = 0; k < needEmbed.length; k++) {
              const vec = vecs[k]; if (!vec) continue
              const nn = (await client.query(
                `select id, (embedding <=> $2::vector) as dist from opportunity
                   where owner_email=$1 and job_id is null and embedding is not null
                   order by embedding <=> $2::vector limit 1`, [cfg.ownerEmail, vec])).rows[0]
              if (nn && Number(nn.dist) < 0.20) {
                await client.query(`update opportunity set job_id=$1, job_url=$2 where id=$3 and job_id is null`,
                  [String(needEmbed[k].jobId), canonicalJobUrl(String(needEmbed[k].jobId)), nn.id])
                linked++
              }
            }
          }
        }
        url = page['@odata.nextLink'] || null
      }
      const hasMore = timedOut || !!url || scanned >= maxEmails
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, mode: 'llm', scanned, alerts, idsFound, linked, alreadyHad, timedOut, oldestIso, hasMore, nextCursor: hasMore ? oldestIso : null } }
    }
    // Load the unlinked-opp pool ONCE (owner, no jobId yet, within window). Match in-memory — fast.
    const pool: Array<{ id: string; company: string; role: string; ncompany: string; used: boolean }> =
      (await client.query(
        `select id, company, role from opportunity
          where owner_email = $1 and job_id is null and created_at >= now() - ($2 || ' days')::interval`,
        [cfg.ownerEmail, String(days)],
      )).rows.map((r: any) => ({ id: r.id, company: r.company || '', role: r.role || '', ncompany: normText(r.company || ''), used: false }))

    let url: string | null = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages?$filter=receivedDateTime ge ${sinceIso}&$select=subject,from,bodyPreview,body,receivedDateTime&$top=50&$orderby=receivedDateTime desc`
    let scanned = 0, alerts = 0, idsFound = 0, linked = 0, alreadyHad = 0
    const unmatched: Array<{ jobId: string; title: string }> = []

    while (url && scanned < maxEmails) {
      const res: any = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: `Graph messages HTTP ${res.status}`, detail: (await res.text()).slice(0, 400) } }
      const page = (await res.json()) as any
      for (const msg of (page.value || [])) {
        if (scanned >= maxEmails) break
        scanned++
        const from = (msg?.from?.emailAddress?.address || '').toLowerCase()
        if (!isAlert(cfg, from, msg?.subject || '', msg?.bodyPreview || '')) continue
        const anchors = extractJobAnchors(msg?.body?.content || '')
        if (!anchors.length) continue
        alerts++
        for (const a of anchors) {
          idsFound++
          const already = await client.query(`select 1 from opportunity where owner_email=$1 and job_id=$2 limit 1`, [cfg.ownerEmail, a.jobId])
          if (already.rowCount) { alreadyHad++; continue }
          // Score each unused pool opp against the anchor CONTEXT (title text is often empty in these
          // emails): company must appear in the context AND the opp's role words must overlap it.
          const nctx = normText(a.context)
          let best: typeof pool[number] | null = null, bestScore = 0
          for (const p of pool) {
            if (p.used) continue
            const companyInCtx = p.ncompany.length >= 3 && nctx.includes(p.ncompany)
            const rsim = tokenSim(a.context, p.role)   // role words present in the surrounding text
            const score = (companyInCtx ? 0.5 : 0) + 0.5 * rsim
            // Confident match: company present + a decent share of the role's words also present.
            const accept = companyInCtx && rsim >= 0.5
            if (accept && score > bestScore) { bestScore = score; best = p }
          }
          if (best) {
            await client.query(`update opportunity set job_id=$1, job_url=$2 where id=$3 and job_id is null`,
              [a.jobId, canonicalJobUrl(a.jobId), best.id])
            best.used = true; linked++
          } else if (unmatched.length < 60) unmatched.push({ jobId: a.jobId, title: (a.title || a.context).slice(0, 90) })
        }
      }
      url = page['@odata.nextLink'] || null
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, days, scanned, alerts, idsFound, linked, alreadyHad, poolSize: pool.length, unmatchedCount: unmatched.length, unmatched: unmatched.slice(0, 25) } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

// ---------------------------------------------------------------------------
// POST /api/mail/jd-backfill/fetch — fetch REAL JDs for opps that have a jobId, via scrape.do
// cheap mode, escalating to super proxy on a block. Stores jd_real + jd_fetched_at and logs every
// attempt to jd_fetch_log (with concurrency + runTag) so this same run doubles as the rate-limit
// experiment. Body: { limit?: 20, concurrency?: 5, favoritesOnly?: true, superOnBlock?: true, runTag? }
// ---------------------------------------------------------------------------
export async function jdBackfillFetch(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const body = (await req.json().catch(() => ({}))) as any
  const limit = Math.max(1, Math.min(200, Number(body.limit) || 20))
  const concurrency = Math.max(1, Math.min(20, Number(body.concurrency) || 1))
  const delayMs = Math.max(0, Math.min(20000, Number(body.delayMs) || 0))  // pause between waves (safe sweep)
  const favoritesOnly = body.favoritesOnly !== false
  const direct = body.direct === true            // fetch straight from Azure egress — no proxy, no credits
  const superOnBlock = !direct && body.superOnBlock !== false
  const runTag = String(body.runTag || (direct ? 'backfill-direct' : `backfill-c${concurrency}`))
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const cfg = await loadConfig()
  let client: any
  try {
    client = await getPgClient()
    await ensureCols(client)
    const favClause = favoritesOnly ? 'and is_favorite = true' : ''
    const rows = (await client.query(
      `select id, job_id, company, role from opportunity
        where owner_email = $1 and job_id is not null and jd_fetched_at is null ${favClause}
        order by is_favorite desc, created_at desc limit $2`,
      [cfg.ownerEmail, limit],
    )).rows

    const tally: Record<string, number> = {}
    let stored = 0, escalated = 0
    const bump = (k: string) => { tally[k] = (tally[k] || 0) + 1 }

    // Fetch one opp. On a genuine block (429/999/challenge), RETRY — each scrape.do request rotates
    // to a fresh exit IP, and we escalate cheap→super, so a transient block self-heals instead of
    // stopping the sweep. Every attempt (incl. the blocked ones) is logged so the rate signal is still
    // visible in jd_fetch_log. Returns the FINAL outcome. maxTries retries only apply to 'blocked'.
    const maxTries = Math.max(1, Math.min(4, Number(body.maxTries) || 3))
    async function one(row: any): Promise<'ok_jd' | 'blocked' | 'auth_required' | 'not_found' | 'proxy_error' | 'empty' | 'login_wall'> {
      const url = guestUrl(row.job_id)
      let r: any, jd: any, outcome: any = 'blocked'
      // Direct mode = one try straight from Azure egress (no proxy, no credits). Proxy mode retries.
      const tries = direct ? 1 : maxTries
      for (let attempt = 0; attempt < tries; attempt++) {
        // Attempt 0 = cheap (datacenter, ~1 credit); retries escalate to super (residential, rotated).
        const useSuper = attempt > 0 && superOnBlock
        if (useSuper) escalated++
        r = direct
          ? await scraperFetch(url, { force: 'direct' })
          : await scraperFetch(url, { provider: 'scrapedo', sdSuper: useSuper })
        jd = extractGuestJdHtml(r.body)
        outcome = classifyResponse(r.status, r.body, jd.descriptionHtml != null)
        await logJdFetch({
          jobId: String(row.job_id), provider: r.provider || (direct ? 'direct' : 'scrapedo'), via: r.via, httpStatus: r.status,
          outcome, jdTextLen: jd.textLen, bytes: r.body.length, latencyMs: r.latencyMs, concurrency,
          runTag: attempt > 0 ? `${runTag}+retry${attempt}` : runTag, usage: r.usage, error: r.error,
        })
        if (outcome !== 'blocked') break   // only a real rate-limit/anti-bot block is worth a fresh-IP retry
        if (delayMs) await sleep(delayMs)  // brief pause before the next IP
      }
      bump(outcome)
      if (outcome === 'ok_jd' && jd.descriptionHtml) {
        await client.query(`update opportunity set jd_real = $1, jd_fetched_at = now() where id = $2`, [jd.descriptionHtml, row.id])
        stored++
      } else if (outcome === 'auth_required' || outcome === 'not_found') {
        // Terminal on the guest endpoint (job needs login / is gone). Mark fetched so the sweep skips
        // it next time — the logged-in Chrome-extension path can capture these later. Leaves jd_real null.
        await client.query(`update opportunity set jd_fetched_at = now() where id = $1 and jd_real is null`, [row.id])
      }
      return outcome
    }

    // Run in concurrency-sized waves, paced by delayMs. A single job that stays blocked through all
    // fresh-IP retries is tolerated (skipped); we only STOP when blocks are PERSISTENT across waves
    // (>= STOP_AFTER consecutive blocked jobs) — that's a real wall, not a one-off. IP rotation +
    // retry means transient blocks self-heal and the sweep keeps pulling.
    const STOP_AFTER = 3
    let stoppedAtBlock = false, quotaExceeded = false, consecBlocked = 0
    for (let i = 0; i < rows.length && !stoppedAtBlock && !quotaExceeded; i += concurrency) {
      const outcomes = await Promise.all(rows.slice(i, i + concurrency).map(one))
      for (const o of outcomes) {
        if (o === 'quota_exceeded') { quotaExceeded = true; break }   // account-level: stop now, nothing to retry
        if (o === 'blocked') { consecBlocked++; if (consecBlocked >= STOP_AFTER) { stoppedAtBlock = true; break } }
        else consecBlocked = 0
      }
      if (delayMs && i + concurrency < rows.length) await sleep(delayMs)
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, runTag, concurrency, delayMs, maxTries, candidates: rows.length, stored, escalated, stoppedAtBlock, quotaExceeded, outcomes: tally } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('jdBackfillScan', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-backfill/scan', handler: jdBackfillScan })
app.http('jdBackfillFetch', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-backfill/fetch', handler: jdBackfillFetch })

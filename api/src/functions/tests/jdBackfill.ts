import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { getMicrosoftToken } from './googleAuth'
import { loadConfig, graphCreds, isAlert, parseAlert } from './mailWatch'
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
      const TIME_BUDGET_MS = 180_000   // stop well under Azure's 240s gateway cap; return a cursor
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
          const opps = await parseAlert(text)          // gpt-4o-mini, serial, 429-backoff
          for (const o of opps) {
            if (!o.jobId) continue
            idsFound++
            const has = await client.query(`select 1 from opportunity where owner_email=$1 and job_id=$2 limit 1`, [cfg.ownerEmail, String(o.jobId)])
            if (has.rowCount) { alreadyHad++; continue }
            const upd = await client.query(
              `update opportunity set job_id=$1, job_url=$2
                 where id = (select id from opportunity
                              where owner_email=$3 and job_id is null
                                and lower(company)=lower($4) and lower(role)=lower($5)
                              order by created_at desc limit 1) returning id`,
              [String(o.jobId), canonicalJobUrl(String(o.jobId)), cfg.ownerEmail, o.company, o.role],
            )
            if (upd.rowCount) linked++
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
  const superOnBlock = body.superOnBlock !== false
  const runTag = String(body.runTag || `backfill-c${concurrency}`)
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

    // Fetch one opp: cheap mode first, escalate to super on a block. Log every attempt.
    async function one(row: any): Promise<void> {
      const url = guestUrl(row.job_id)
      let r = await scraperFetch(url, { provider: 'scrapedo', sdSuper: false })
      let jd = extractGuestJdHtml(r.body)
      let outcome = classifyResponse(r.status, r.body, jd.descriptionHtml != null)
      let usedSuper = false
      if (outcome === 'blocked' && superOnBlock) {
        usedSuper = true; escalated++
        r = await scraperFetch(url, { provider: 'scrapedo', sdSuper: true })
        jd = extractGuestJdHtml(r.body)
        outcome = classifyResponse(r.status, r.body, jd.descriptionHtml != null)
      }
      bump(outcome)
      await logJdFetch({
        jobId: String(row.job_id), provider: r.provider || 'scrapedo', via: r.via, httpStatus: r.status,
        outcome, jdTextLen: jd.textLen, bytes: r.body.length, latencyMs: r.latencyMs,
        concurrency, runTag: usedSuper ? `${runTag}+super` : runTag, usage: r.usage, error: r.error,
      })
      if (outcome === 'ok_jd' && jd.descriptionHtml) {
        await client.query(`update opportunity set jd_real = $1, jd_fetched_at = now() where id = $2`, [jd.descriptionHtml, row.id])
        stored++
      }
    }

    // Run in concurrency-sized waves so we can sweep the block-rate vs request-rate curve. Paced by
    // delayMs between waves for the safe sweep; stop early the moment a wave still ends 'blocked'
    // after super-escalation — that's the cap, and we don't hammer past it.
    let stoppedAtBlock = false
    for (let i = 0; i < rows.length; i += concurrency) {
      const before = tally['blocked'] || 0
      await Promise.all(rows.slice(i, i + concurrency).map(one))
      if ((tally['blocked'] || 0) > before) { stoppedAtBlock = true; break }
      if (delayMs && i + concurrency < rows.length) await sleep(delayMs)
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, runTag, concurrency, delayMs, candidates: rows.length, stored, escalated, stoppedAtBlock, outcomes: tally } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('jdBackfillScan', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-backfill/scan', handler: jdBackfillScan })
app.http('jdBackfillFetch', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-backfill/fetch', handler: jdBackfillFetch })

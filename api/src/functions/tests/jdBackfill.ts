import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { getMicrosoftToken } from './googleAuth'
import { loadConfig, graphCreds, isAlert, parseAlert } from './mailWatch'
import { injectJobMarkers, canonicalJobUrl } from './jdLinks'
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
// POST /api/mail/jd-backfill/scan  — recover jobIds for EXISTING opportunities.
// The ingest fix only captures jobIds going forward; opps ingested before it have none. This
// re-reads the last {days} of alert emails from the mailbox, extracts each role's jobId from the
// HTML (marker logic), re-parses with the SAME parseAlert, and back-links the jobId onto the
// existing opportunity row (matched by owner + company + role, where job_id is still null).
// Body: { days?: 14, maxEmails?: 300 }
// ---------------------------------------------------------------------------
export async function jdBackfillScan(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const body = (await req.json().catch(() => ({}))) as any
  const days = Math.max(1, Math.min(90, Number(body.days) || 14))
  const maxEmails = Math.max(1, Math.min(1000, Number(body.maxEmails) || 300))

  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: 'Graph app credentials not configured' } }
  const cfg = await loadConfig()
  const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString()

  let client: any
  try {
    client = await getPgClient()
    await ensureCols(client)
    let url: string | null = `https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages?$filter=receivedDateTime ge ${sinceIso}&$select=subject,from,bodyPreview,body,receivedDateTime,parentFolderId&$top=50&$orderby=receivedDateTime desc`
    let scanned = 0, alerts = 0, idsFound = 0, linked = 0, alreadyHad = 0
    const unmatched: Array<{ company: string; role: string; jobId: string }> = []

    while (url && scanned < maxEmails) {
      const res: any = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: `Graph messages HTTP ${res.status}`, detail: (await res.text()).slice(0, 400) } }
      const page = (await res.json()) as any
      for (const msg of (page.value || [])) {
        if (scanned >= maxEmails) break
        scanned++
        const from = (msg?.from?.emailAddress?.address || '').toLowerCase()
        if (!isAlert(cfg, from, msg?.subject || '', msg?.bodyPreview || '')) continue
        const { text, ids } = injectJobMarkers(msg?.body?.content || '')
        if (!ids.length) continue
        alerts++
        const opps = await parseAlert(text)
        for (const o of opps) {
          if (!o.jobId) continue
          idsFound++
          // Back-link to the existing opp created from this email: exact company+role, id still null.
          const upd = await client.query(
            `update opportunity set job_id = $1, job_url = $2
               where id = (
                 select id from opportunity
                  where owner_email = $3 and job_id is null
                    and lower(company) = lower($4) and lower(role) = lower($5)
                  order by created_at desc limit 1
               ) returning id`,
            [String(o.jobId), canonicalJobUrl(String(o.jobId)), cfg.ownerEmail, o.company, o.role],
          )
          if (upd.rowCount) linked++
          else {
            // Already linked, or no exact match — check if some row already carries this id.
            const has = await client.query(`select 1 from opportunity where owner_email=$1 and job_id=$2 limit 1`, [cfg.ownerEmail, String(o.jobId)])
            if (has.rowCount) alreadyHad++
            else if (unmatched.length < 50) unmatched.push({ company: o.company, role: o.role, jobId: String(o.jobId) })
          }
        }
      }
      url = page['@odata.nextLink'] || null
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, days, scanned, alerts, idsFound, linked, alreadyHad, unmatchedCount: unmatched.length, unmatched } }
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

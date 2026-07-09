import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'
import { getPgClient } from './pgClient'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

const MAILBOX = () => process.env.MAIL_WATCH_MAILBOX || 'von.ellis@enterpriseds.io'
const OWNER = () => process.env.MAIL_OWNER_EMAIL || 'demo@executive-engine.local'
const CLIENT_STATE = () => process.env.MAIL_CLIENT_STATE || 'ee-linkedin-watch'
const NOTIFY_URL = () => process.env.MAIL_NOTIFY_URL || 'https://job-platform-api.azurewebsites.net/api/mail/notify'

function graphCreds() {
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
  const clientId = process.env.MICROSOFT_CLIENT_ID, clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  return { tenantId, clientId, clientSecret }
}

// --- OpenAI helpers -------------------------------------------------------
async function embed(text: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) })
  })
  if (!res.ok) return null
  const v = (await res.json() as any)?.data?.[0]?.embedding
  return Array.isArray(v) ? `[${v.join(',')}]` : null
}

// Parse a (LinkedIn) job-alert email → array of opportunities. Alerts often list
// several roles, so we extract all of them.
async function parseAlert(rawText: string): Promise<any[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return []
  const system = 'You extract executive job opportunities from a job-alert email. Return ONLY JSON.'
  const user = `From this job-alert email, extract every distinct role. Return JSON: { "opportunities": [ { "company": "...", "role": "...", "location": "...", "comp": "...", "url": "..." } ] }. Use null for unknown fields. Email:\n${rawText.slice(0, 8000)}`
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200, response_format: { type: 'json_object' } })
  })
  if (!res.ok) return []
  const parsed = JSON.parse((await res.json() as any)?.choices?.[0]?.message?.content || '{}')
  return Array.isArray(parsed.opportunities) ? parsed.opportunities.filter((o: any) => o.company && o.role) : []
}

// Insert one opportunity if it isn't a near-duplicate (pgvector). Returns status.
async function insertOpp(client: any, o: any): Promise<{ inserted: boolean; id?: string; reason?: string; company: string; role: string }> {
  const owner = OWNER()
  const vec = await embed(`${o.company} — ${o.role}`)
  if (vec) {
    const dup = (await client.query(
      `select id, (embedding <=> $2::vector) as dist from opportunity
        where owner_email = $1 and not dismissed and embedding is not null
        order by embedding <=> $2::vector limit 1`, [owner, vec]
    )).rows[0]
    if (dup && Number(dup.dist) < 0.12) return { inserted: false, reason: 'duplicate', company: o.company, role: o.role }
  } else {
    // Fallback dedupe by exact company+role.
    const dup = (await client.query(`select id from opportunity where owner_email = $1 and lower(company) = lower($2) and lower(role) = lower($3) and not dismissed limit 1`, [owner, o.company, o.role])).rows[0]
    if (dup) return { inserted: false, reason: 'duplicate', company: o.company, role: o.role }
  }
  const roleLower = (o.role || '').toLowerCase()
  const personaKey = roleLower.includes('product') ? 'VPP' : roleLower.includes('cto') || roleLower.includes('chief') ? 'CTO' : 'VPE'
  const r = await client.query(
    `insert into opportunity
       (owner_email, is_demo, persona_key, company, role, location, comp_range, source, source_date,
        why_surfaced, roles_for, stage, urgency, embedding)
     values ($1, false, $2, $3, $4, $5, $6, 'LinkedIn', now(), $7, $8, 'discovered', 'Warm', ${vec ? '$9::vector' : 'null'})
     returning id`,
    vec
      ? [owner, personaKey, o.company, o.role, o.location || null, o.comp || null, `New LinkedIn alert${o.url ? ` · ${o.url}` : ''}`, [personaKey], vec]
      : [owner, personaKey, o.company, o.role, o.location || null, o.comp || null, `New LinkedIn alert${o.url ? ` · ${o.url}` : ''}`, [personaKey]]
  )
  return { inserted: true, id: r.rows[0].id, company: o.company, role: o.role }
}

async function ingestText(rawText: string) {
  let client
  try {
    client = await getPgClient()
    const opps = await parseAlert(rawText)
    const results = []
    for (const o of opps) results.push(await insertOpp(client, o))
    return { parsed: opps.length, inserted: results.filter((r) => r.inserted).length, results }
  } finally { try { await client?.end() } catch {} }
}

async function ingestMessageId(token: string, id: string) {
  const m = await fetch(`https://graph.microsoft.com/v1.0/users/${MAILBOX()}/messages/${id}?$select=subject,from,bodyPreview,body,receivedDateTime`, { headers: { Authorization: `Bearer ${token}` } })
  if (!m.ok) return { error: `fetch message HTTP ${m.status}` }
  const msg = await m.json() as any
  const from = (msg?.from?.emailAddress?.address || '').toLowerCase()
  const text = `From: ${from}\nSubject: ${msg?.subject}\n\n${(msg?.body?.content || msg?.bodyPreview || '').replace(/<[^>]+>/g, ' ')}`
  // Only treat LinkedIn (or job-alert-looking) mail as opportunities.
  const looksLikeAlert = from.includes('linkedin') || /job alert|jobs for you|new jobs|is hiring|recommended job/i.test(`${msg?.subject} ${msg?.bodyPreview}`)
  if (!looksLikeAlert) return { skipped: 'not a job alert', from }
  return await ingestText(text)
}

// GET/POST /api/mail/notify — Graph webhook: validation handshake + notifications.
export async function mailNotify(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const validationToken = req.query.get('validationToken')
  if (validationToken) return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: validationToken }
  try {
    const body = await req.json().catch(() => ({})) as any
    const notifications = Array.isArray(body?.value) ? body.value : []
    const creds = graphCreds()
    if (creds.clientId && creds.clientSecret && notifications.length) {
      const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
      for (const n of notifications) {
        if (n.clientState && n.clientState !== CLIENT_STATE()) continue
        const id = n?.resourceData?.id
        if (id) { try { await ingestMessageId(token, id) } catch (e) { context.log(`ingest error: ${e}`) } }
      }
    }
  } catch (e) { context.log(`notify error: ${e}`) }
  return { status: 202, headers: HEADERS, jsonBody: { ok: true } }
}

// POST /api/mail/subscribe — create the Graph change-notification subscription.
export async function mailSubscribe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT_CLIENT_ID/SECRET not set' } }
  try {
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const expiration = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() // ~2 days (mail max ~3)
    // Clean up ALL existing /mail/notify subscriptions before creating a fresh
    // one — removes stale watches on an old mailbox (after changing
    // MAIL_WATCH_MAILBOX) and collapses any accidental duplicates on the same
    // mailbox. Guarantees exactly one live watch after subscribe.
    const removed: string[] = []
    try {
      const existing = ((await (await fetch('https://graph.microsoft.com/v1.0/subscriptions', { headers: { Authorization: `Bearer ${token}` } })).json()) as any)?.value || []
      for (const s of existing) {
        if ((s.notificationUrl || '').includes('/mail/notify')) {
          await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
          removed.push(s.id)
        }
      }
    } catch {}
    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl: NOTIFY_URL(),
        resource: `users/${MAILBOX()}/mailFolders('inbox')/messages`,
        expirationDateTime: expiration,
        clientState: CLIENT_STATE(),
      })
    })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: `subscribe HTTP ${res.status}: ${txt.slice(0, 500)}`, hint: res.status === 403 ? 'App registration needs Mail.Read (Application) + admin consent to subscribe to a mailbox.' : undefined } }
    const sub = JSON.parse(txt)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, subscriptionId: sub.id, expires: sub.expirationDateTime, mailbox: MAILBOX(), removedStale: removed } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

// GET /api/mail/subscriptions — list current subscriptions (diag).
export async function mailSubscriptions(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', { headers: { Authorization: `Bearer ${token}` } })
    return { status: 200, headers: HEADERS, jsonBody: await res.json() }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/ingest-test { text } — run the parse→dedupe→insert pipeline on
// raw email text, without needing a live Graph message. For verification.
export async function mailIngestTest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const text = (await req.json().catch(() => ({})) as any)?.text
    if (!text || text.length < 20) return { status: 400, headers: HEADERS, jsonBody: { error: 'text required' } }
    return { status: 200, headers: HEADERS, jsonBody: await ingestText(text) }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// Timer: renew subscriptions nearing expiry + fallback poll for missed alerts.
export async function mailRenew(myTimer: Timer, context: InvocationContext): Promise<void> {
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return
  try {
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    // Renew any of our subscriptions.
    const subs = ((await (await fetch('https://graph.microsoft.com/v1.0/subscriptions', { headers: { Authorization: `Bearer ${token}` } })).json()) as any)?.value || []
    for (const s of subs) {
      if ((s.notificationUrl || '').includes('/mail/notify')) {
        await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${s.id}`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expirationDateTime: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() })
        })
      }
    }
    // Fallback poll: ingest recent inbox alerts (dedupe makes this safe).
    const since = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    const list = await fetch(`https://graph.microsoft.com/v1.0/users/${MAILBOX()}/mailFolders('inbox')/messages?$filter=receivedDateTime ge ${since}&$select=id&$top=10`, { headers: { Authorization: `Bearer ${token}` } })
    if (list.ok) {
      const ids = ((await list.json()) as any)?.value || []
      for (const m of ids) { try { await ingestMessageId(token, m.id) } catch {} }
    }
  } catch (e) { context.log(`renew error: ${e}`) }
}

app.http('mailNotify', { methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'mail/notify', handler: mailNotify })
app.http('mailSubscribe', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/subscribe', handler: mailSubscribe })
app.http('mailSubscriptions', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/subscriptions', handler: mailSubscriptions })
app.http('mailIngestTest', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/ingest-test', handler: mailIngestTest })
app.timer('mailRenew', { schedule: '0 */30 * * * *', handler: mailRenew })

import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'
import { getPgClient } from './pgClient'
import { logUsage } from './usageMeter'
import { resolveOwner } from './appSession'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Env values are the *defaults* only — the live watch config is stored in
// Postgres (mail_watch_config) and edited from the in-app Intake config panel.
const DEFAULT_MAILBOX = process.env.MAIL_WATCH_MAILBOX || 'von.ellis@enterpriseds.io'
// Owner always equals the watched mailbox. The old 'demo@executive-engine.local' default
// was a bug — opportunities were stored under the wrong key and never appeared in the UI.
const DEFAULT_OWNER = process.env.MAIL_OWNER_EMAIL || DEFAULT_MAILBOX
const CLIENT_STATE = () => process.env.MAIL_CLIENT_STATE || 'ee-linkedin-watch'
const NOTIFY_URL = () => process.env.MAIL_NOTIFY_URL || 'https://job-platform-api.azurewebsites.net/api/mail/notify'
const DEFAULT_SENDERS = ['linkedin']
const DEFAULT_SUBJECTS = [
  'job alert', 'jobs for you', 'new jobs', 'is hiring', 'recommended job',
  'new opportunit', 'position', 'opening', 'career', 'hiring', 'role at',
  'jobs matching', 'job match', 'executive role',
]

function graphCreds() {
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
  const clientId = process.env.MICROSOFT_CLIENT_ID, clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  return { tenantId, clientId, clientSecret }
}

// --- Watch config (Postgres-backed, singleton keyed by owner_email) ---------
type WatchConfig = {
  ownerEmail: string
  mailbox: string
  folder: string        // well-known name ('inbox') or a Graph mailFolder id
  folderName: string    // display name for the UI
  senders: string[]     // sender substrings that mark a message as a job alert
  subjectPatterns: string[] // subject/body keywords that mark a job alert
  enabled: boolean
}

async function ensureConfigTable(client: any) {
  await client.query(`create table if not exists mail_watch_config (
    owner_email text primary key,
    mailbox text not null,
    folder text not null default 'inbox',
    folder_name text not null default 'Inbox',
    senders text[] not null default '{}',
    subject_patterns text[] not null default '{}',
    enabled boolean not null default true,
    updated_at timestamptz not null default now()
  )`)
}

function rowToConfig(r: any): WatchConfig {
  return {
    ownerEmail: r.owner_email, mailbox: r.mailbox, folder: r.folder, folderName: r.folder_name,
    senders: r.senders || [], subjectPatterns: r.subject_patterns || [], enabled: r.enabled,
  }
}

// Load the live config for a given owner, creating a default row on first use.
// If no owner is provided (webhook path), loads the first enabled row in the table.
async function loadConfig(owner?: string): Promise<WatchConfig> {
  let client
  try {
    client = await getPgClient()
    await ensureConfigTable(client)
    let row: any
    if (owner) {
      row = (await client.query('select * from mail_watch_config where owner_email = $1', [owner])).rows[0]
      // Fall back to the legacy DEFAULT_OWNER row so existing config is not lost on first login.
      if (!row) row = (await client.query('select * from mail_watch_config where owner_email = $1', [DEFAULT_OWNER])).rows[0]
    } else {
      // Webhook / no-auth path: pick the CANONICAL config — the one whose owner
      // matches the mailbox it watches (the invariant enforced below). A stray
      // row that watches someone else's mailbox under a different owner (e.g. a
      // demo owner pointed at a real inbox) must never win, or every ingested
      // alert lands under the wrong owner. Tie-break by recency.
      row = (await client.query('select * from mail_watch_config where enabled = true order by (owner_email = mailbox) desc, updated_at desc limit 1')).rows[0]
    }
    if (!row) {
      const effectiveOwner = owner || DEFAULT_OWNER
      row = (await client.query(
        `insert into mail_watch_config (owner_email, mailbox, folder, folder_name, senders, subject_patterns, enabled)
         values ($1,$2,'inbox','Inbox',$3,$4,true) returning *`,
        [effectiveOwner, DEFAULT_MAILBOX, DEFAULT_SENDERS, DEFAULT_SUBJECTS]
      )).rows[0]
    }
    return rowToConfig(row)
  } finally { try { await client?.end() } catch {} }
}

async function saveConfig(owner: string, patch: Partial<WatchConfig>): Promise<WatchConfig> {
  let client
  try {
    client = await getPgClient()
    await ensureConfigTable(client)
    const cur = (await client.query('select * from mail_watch_config where owner_email = $1', [owner])).rows[0]
      // If no row for this owner yet, copy the legacy DEFAULT_OWNER row's settings as a starting point.
      ?? (await client.query('select * from mail_watch_config where owner_email = $1', [DEFAULT_OWNER])).rows[0]
    const base: WatchConfig = cur ? rowToConfig(cur) : { ownerEmail: owner, mailbox: DEFAULT_MAILBOX, folder: 'inbox', folderName: 'Inbox', senders: DEFAULT_SENDERS, subjectPatterns: DEFAULT_SUBJECTS, enabled: true }
    // ownerEmail always tracks the mailbox — they must match so opportunities
    // show up when the user views their pipeline.
    const newMailbox = patch.mailbox ?? base.mailbox
    const effectiveOwner = newMailbox
    const next: WatchConfig = { ...base, ...patch, mailbox: newMailbox, ownerEmail: effectiveOwner }
    // If the mailbox (and therefore owner key) changed, delete the stale row first.
    if (cur && cur.owner_email !== effectiveOwner) {
      await client.query('delete from mail_watch_config where owner_email = $1', [cur.owner_email])
    }
    const row = (await client.query(
      `insert into mail_watch_config (owner_email, mailbox, folder, folder_name, senders, subject_patterns, enabled, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (owner_email) do update set
         mailbox = excluded.mailbox, folder = excluded.folder, folder_name = excluded.folder_name,
         senders = excluded.senders, subject_patterns = excluded.subject_patterns, enabled = excluded.enabled, updated_at = now()
       returning *`,
      [effectiveOwner, next.mailbox, next.folder, next.folderName, next.senders, next.subjectPatterns, next.enabled]
    )).rows[0]
    return rowToConfig(row)
  } finally { try { await client?.end() } catch {} }
}

const folderRef = (cfg: WatchConfig) => `mailFolders('${cfg.folder || 'inbox'}')`
const messagesResource = (cfg: WatchConfig) => `users/${cfg.mailbox}/${folderRef(cfg)}/messages`

// Detect which job board sourced a message. Checks folder name first (user mail rules
// are the cleanest signal), then sender/keyword as a catch-all. Both always run.
function detectSource(from: string, folderName?: string): string {
  const boards: Array<[RegExp, string]> = [
    [/linkedin/i, 'LinkedIn'],
    [/indeed/i, 'Indeed'],
    [/theladders|ladders/i, 'Ladders'],
    [/glassdoor/i, 'Glassdoor'],
    [/ziprecruiter/i, 'ZipRecruiter'],
    [/greenhouse/i, 'Greenhouse'],
    [/lever\.co/i, 'Lever'],
    [/dice\.com/i, 'Dice'],
    [/monster/i, 'Monster'],
  ]
  const folder = (folderName || '').toLowerCase()
  const sender = (from || '').toLowerCase()
  for (const [pat, label] of boards) {
    if (pat.test(folder) || pat.test(sender)) return label
  }
  return 'Email'
}

// Fire-and-forget: classify the opportunity against the user's target roles and
// update roles_for[], match_score, fit, urgency, why_surfaced.
async function tagOppRoles(oppId: string, opp: any, owner: string): Promise<void> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return
  let client
  try {
    client = await getPgClient()
    const personas = (await client.query(
      `select key, name, master_role from persona where owner_email = $1 order by key`, [owner]
    )).rows
    if (!personas.length) return
    const roleList = personas.map((p: any) => `${p.key}: ${p.name || p.master_role}`).join(', ')
    const prompt = `You are a talent classifier. Given a job title and company, identify which of the user's target roles it matches (zero or more). Return ONLY JSON: { "matched": ["KEY1","KEY2"], "fit": "Strong"|"Possible"|"Stretch", "urgency": "Hot"|"Warm"|"Cool", "why": "one sentence" }.\nJob: ${opp.role} at ${opp.company}\nTarget roles: ${roleList}`
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 200, response_format: { type: 'json_object' } })
    })
    if (!res.ok) return
    const j = (await res.json()) as any
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}')
    const matched: string[] = Array.isArray(parsed.matched) ? parsed.matched.filter((k: string) => personas.some((p: any) => p.key === k)) : []
    await client.query(
      `update opportunity set roles_for=$2, fit=$3, urgency=$4, why_surfaced=coalesce(nullif(why_surfaced,''), $5) where id=$1`,
      [oppId, matched, parsed.fit || null, parsed.urgency || 'Warm', parsed.why || null]
    )
  } catch { /* fire-and-forget: never throw */ } finally { try { await client?.end() } catch {} }
}

// Does a message look like a job alert? Always requires job-related keywords in
// subject/preview — sender alone is never sufficient, because LinkedIn and other
// boards also send connection updates, post notifications, etc. that are noise.
function isAlert(cfg: WatchConfig, from: string, subject: string, preview: string): boolean {
  // 1. Configured subject/preview phrases ("is hiring", "new jobs", "recommended job"…).
  const pats = (cfg.subjectPatterns || []).filter(Boolean)
  if (pats.length) {
    try { if (new RegExp(pats.join('|'), 'i').test(`${subject || ''} ${preview || ''}`)) return true } catch {}
  }
  // 2. Dedicated job-alert SENDER addresses. LinkedIn/Indeed alerts use
  //    "{Role} at {Company}" subjects that match none of the phrases above, so
  //    key off the sender instead. Matches jobalerts-noreply@linkedin.com,
  //    jobs-noreply@linkedin.com, donotreply@jobalert.indeed.com — while
  //    excluding general notifications like messages-noreply@linkedin.com.
  const f = (from || '').toLowerCase()
  if (/jobalert|jobs?[-.]noreply|job[-.]?alert/.test(f)) return true
  return false
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
  const j = (await res.json()) as any
  await logUsage('intake:embed', 'text-embedding-3-small', j?.usage)
  const v = j?.data?.[0]?.embedding
  return Array.isArray(v) ? `[${v.join(',')}]` : null
}

// Parse a (LinkedIn) job-alert email → array of opportunities. Alerts often list
// several roles, so we extract all of them.
async function parseAlert(rawText: string): Promise<any[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return []
  const system = 'You extract senior executive job opportunities from a job-alert email. Return ONLY JSON. Only include roles at the VP, Director, C-suite, Partner, or equivalent senior leadership level. Skip coordinator, specialist, analyst, manager, support, or entry/mid-level roles.'
  const user = `From this job-alert email, extract only SENIOR EXECUTIVE roles (VP, Director, C-suite, SVP, EVP, Partner, Head of, GM, President, or equivalent). Skip any role below director level. Return JSON: { "opportunities": [ { "company": "...", "role": "...", "location": "...", "comp": "...", "url": "...", "postedDate": "YYYY-MM-DD or null" } ] }. postedDate: the date the job was posted or listed, NOT the email received date. Look for text like "Posted 3 days ago", "Posted July 10", "2 days ago", etc. and resolve to an ISO date. Use null if no posted date is mentioned. Use null for other unknown fields. If no senior roles exist, return { "opportunities": [] }. Email:\n${rawText.slice(0, 8000)}`
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200, response_format: { type: 'json_object' } })
  })
  if (!res.ok) return []
  const j = (await res.json()) as any
  await logUsage('intake:parse', 'gpt-4o-mini', j?.usage)
  const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}')
  return Array.isArray(parsed.opportunities) ? parsed.opportunities.filter((o: any) => o.company && o.role) : []
}

// Insert one opportunity if it isn't a near-duplicate (pgvector). Returns status.
// Exported + source-parameterized so ATS ingestion (appAts) reuses the exact
// embed → dedupe → insert-as-discovered pipeline.
export { embed as embedOpp }
export async function insertOpp(client: any, owner: string, o: any, source = 'LinkedIn', why?: string, receivedAt?: string, rawJd?: string): Promise<{ inserted: boolean; id?: string; reason?: string; company: string; role: string }> {
  const vec = await embed(`${o.company} — ${o.role}`)
  if (vec) {
    const dup = (await client.query(
      `select id, (embedding <=> $2::vector) as dist from opportunity
        where owner_email = $1 and not dismissed and embedding is not null
        order by embedding <=> $2::vector limit 1`, [owner, vec]
    )).rows[0]
    if (dup && Number(dup.dist) < 0.12) return { inserted: false, reason: 'duplicate', company: o.company, role: o.role }
  } else {
    const dup = (await client.query(`select id from opportunity where owner_email = $1 and lower(company) = lower($2) and lower(role) = lower($3) and not dismissed limit 1`, [owner, o.company, o.role])).rows[0]
    if (dup) return { inserted: false, reason: 'duplicate', company: o.company, role: o.role }
  }
  const whyText = why || `New ${source} alert${o.url ? ` · ${o.url}` : ''}`
  // Prefer job's posted date extracted by AI; fall back to email received date; then now()
  const sourceDateVal = o.postedDate || receivedAt || null
  // Param order — non-vec: [owner$1, company$2, role$3, location$4, comp$5, whyText$6, source$7, (sourceDate$8)]
  //                    vec: [owner$1, company$2, role$3, location$4, comp$5, whyText$6, vec$7,   source$8, (sourceDate$9)]
  // Placeholders below MUST match these positions exactly, or Postgres throws
  // "could not determine data type of parameter $N" for any param the SQL never references.
  const sourceDateExpr = sourceDateVal ? `$${vec ? 9 : 8}::timestamptz` : 'now()'
  const r = await client.query(
    `insert into opportunity
       (owner_email, is_demo, company, role, location, comp_range, source, source_date,
        why_surfaced, roles_for, stage, urgency, embedding)
     values ($1, false, $2, $3, $4, $5, ${vec ? '$8' : '$7'}, ${sourceDateExpr}, $6, '{}', 'discovered', 'Warm', ${vec ? '$7::vector' : 'null'})
     returning id`,
    vec
      ? [owner, o.company, o.role, o.location || null, o.comp || null, whyText, vec, source, ...(sourceDateVal ? [sourceDateVal] : [])]
      : [owner, o.company, o.role, o.location || null, o.comp || null, whyText, source, ...(sourceDateVal ? [sourceDateVal] : [])]
  )
  const id = r.rows[0].id
  if (rawJd) {
    try {
      await client.query(`alter table opportunity add column if not exists raw_jd text`)
      await client.query(`update opportunity set raw_jd = $1 where id = $2`, [rawJd, id])
    } catch {}
  }
  return { inserted: true, id, company: o.company, role: o.role }
}

// Role bins mapped to a mailbox folder (empty = "router decides" → AI classify).
async function folderRoles(client: any, owner: string, folderId?: string): Promise<string[]> {
  if (!folderId) return []
  try {
    await ensureFolderMapTable(client)
    const rows = (await client.query(
      `select role_key from folder_role_map where owner_email=$1 and folder_id=$2`, [owner, folderId]
    )).rows
    return rows.map((r: any) => r.role_key)
  } catch { return [] }
}

// UNIFIED OPPORTUNITY ROUTER — the single entry point every input source funnels through
// (role-mapped folders, general inbox, ATS boards, browser-extension capture). It inserts via
// the shared insertOpp primitive, then assigns roles ONE consistent way for every source:
//   1. folder-mapped: if parentFolderId matches folder_role_map rows, assign those role bins
//      directly (deterministic — this is how a user funnels jobs that would fail keyword filters)
//   2. otherwise: AI-classify via tagOppRoles (general inbox, ATS, extension, unmapped folders)
// Prior to this, tagOppRoles ran only on the mail path and the folder→role signal was dead at
// ingest; ATS/extension opps got no role at all. Now all three paths route identically.
export async function routeOpportunity(
  client: any, owner: string, o: any,
  opts: { source?: string; parentFolderId?: string; why?: string; receivedAt?: string; rawJd?: string } = {}
): Promise<{ inserted: boolean; id?: string; reason?: string; company: string; role: string; routed?: string }> {
  const res = await insertOpp(client, owner, o, opts.source || 'Email', opts.why, opts.receivedAt, opts.rawJd)
  if (!res.inserted || !res.id) return res
  // Path 1 — deterministic folder→role bins
  const mapped = await folderRoles(client, owner, opts.parentFolderId)
  if (mapped.length) {
    try {
      await client.query(
        `update opportunity set roles_for=$2, why_surfaced=coalesce(nullif(why_surfaced,''), $3) where id=$1`,
        [res.id, mapped, `Folder-routed from ${opts.source || 'mailbox'}`]
      )
      return { ...res, routed: `folder:${mapped.join(',')}` }
    } catch { /* fall through to AI if the direct assign fails */ }
  }
  // Path 2/3 — AI classify (fire-and-forget, never blocks ingest)
  tagOppRoles(res.id, o, owner).catch(() => {})
  return { ...res, routed: 'ai' }
}

async function ingestText(rawText: string, owner: string, source = 'Email', receivedAt?: string, parentFolderId?: string) {
  let client
  try {
    client = await getPgClient()
    const opps = await parseAlert(rawText)
    const results = []
    for (const o of opps) {
      // Route through the unified hub so folder→role and AI classification are consistent.
      const r = await routeOpportunity(client, owner, o, { source, parentFolderId, receivedAt, rawJd: rawText })
      results.push(r)
    }
    return { parsed: opps.length, inserted: results.filter((r) => r.inserted).length, results }
  } finally { try { await client?.end() } catch {} }
}

async function ingestMessageId(token: string, id: string, cfg: WatchConfig) {
  const m = await fetch(`https://graph.microsoft.com/v1.0/users/${cfg.mailbox}/messages/${id}?$select=subject,from,bodyPreview,body,receivedDateTime,parentFolderId`, { headers: { Authorization: `Bearer ${token}` } })
  if (!m.ok) return { error: `fetch message HTTP ${m.status}` }
  const msg = await m.json() as any
  const from = (msg?.from?.emailAddress?.address || '').toLowerCase()
  const text = `From: ${from}\nSubject: ${msg?.subject}\n\n${(msg?.body?.content || msg?.bodyPreview || '').replace(/<[^>]+>/g, ' ')}`
  if (!isAlert(cfg, from, msg?.subject, msg?.bodyPreview)) return { skipped: 'not a job alert', from }
  const source = detectSource(from, cfg.folderName)
  const receivedAt = msg?.receivedDateTime || undefined
  // parentFolderId lets the unified router assign a role directly when the mail landed in a
  // role-mapped folder (folder_role_map). Unmapped folders / inbox → AI classify.
  return await ingestText(text, cfg.ownerEmail, source, receivedAt, msg?.parentFolderId)
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
      const cfg = await loadConfig()
      for (const n of notifications) {
        if (n.clientState && n.clientState !== CLIENT_STATE()) continue
        const id = n?.resourceData?.id
        if (id) { try { await ingestMessageId(token, id, cfg) } catch (e) { context.log(`ingest error: ${e}`) } }
      }
    }
  } catch (e) { context.log(`notify error: ${e}`) }
  return { status: 202, headers: HEADERS, jsonBody: { ok: true } }
}

// POST /api/mail/subscribe — create the Graph change-notification subscription
// for the currently-configured mailbox + folder (pruning any prior watch).
export async function mailSubscribe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT_CLIENT_ID/SECRET not set' } }
  try {
    const owner = resolveOwner(req).owner
    const cfg = await loadConfig(owner)
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const expiration = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()
    // Prune ALL prior /mail/notify subscriptions → guarantees exactly one watch.
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
        resource: messagesResource(cfg),
        expirationDateTime: expiration,
        clientState: CLIENT_STATE(),
      })
    })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: `subscribe HTTP ${res.status}: ${txt.slice(0, 500)}`, hint: res.status === 403 ? 'App registration needs Mail.Read (Application) + admin consent to subscribe to a mailbox.' : undefined } }
    const sub = JSON.parse(txt)
    // Ensure ownerEmail is in sync with the subscribed mailbox.
    await saveConfig(owner, { ownerEmail: cfg.mailbox }).catch(() => {})
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, subscriptionId: sub.id, expires: sub.expirationDateTime, mailbox: cfg.mailbox, folder: cfg.folderName, removedStale: removed } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

// GET /api/mail/subscriptions — list current subscriptions (diag).
export async function mailSubscriptions(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', { headers: { Authorization: `Bearer ${token}` } })
    return { status: 200, headers: HEADERS, jsonBody: await res.json() }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// GET/POST /api/mail/config — read or update the watch configuration.
export async function mailConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const owner = resolveOwner(req).owner
    if (req.method === 'GET') return { status: 200, headers: HEADERS, jsonBody: { config: await loadConfig(owner) } }
    const body = (await req.json().catch(() => ({}))) as any
    const patch: Partial<WatchConfig> = {}
    if (typeof body.mailbox === 'string') patch.mailbox = body.mailbox.trim()
    if (typeof body.folder === 'string') patch.folder = body.folder.trim()
    if (typeof body.folderName === 'string') patch.folderName = body.folderName.trim()
    if (Array.isArray(body.senders)) patch.senders = body.senders.map((s: any) => String(s).trim()).filter(Boolean)
    if (Array.isArray(body.subjectPatterns)) patch.subjectPatterns = body.subjectPatterns.map((s: any) => String(s).trim()).filter(Boolean)
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, config: await saveConfig(owner, patch) } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// Recursively walk a mailbox's folder tree. Graph only returns direct children per
// call, so we descend into any folder reporting childFolderCount > 0. Returns a flat,
// depth-ordered list where each entry carries its full path + nesting level, so the UI
// can render a multilevel tree. Bounded by maxDepth to avoid pathological mailboxes.
async function fetchFolderTree(mailbox: string, token: string, maxDepth = 6): Promise<any[]> {
  const out: any[] = []
  async function walk(parentId: string | null, parentPath: string, level: number) {
    if (level > maxDepth) return
    const url = parentId
      ? `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${parentId}/childFolders?$top=100&$select=id,displayName,totalItemCount,childFolderCount`
      : `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders?$top=100&$select=id,displayName,totalItemCount,childFolderCount`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const rows = (((await res.json()) as any)?.value || [])
    for (const f of rows) {
      const path = parentPath ? `${parentPath}/${f.displayName}` : f.displayName
      out.push({ id: f.id, name: f.displayName, path, parentId, level, count: f.totalItemCount, childCount: f.childFolderCount || 0 })
      if ((f.childFolderCount || 0) > 0) await walk(f.id, path, level + 1)
    }
  }
  await walk(null, '', 0)
  return out
}

// GET /api/mail/folders?mailbox=[&tree=1] — list a mailbox's folders.
// Default: flat top-level list (back-compat for the single-folder selector).
// tree=1: full recursive tree with path + level for the folder→role mapping UI.
export async function mailFolders(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const mailbox = req.query.get('mailbox') || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    if (req.query.get('tree')) {
      const folders = await fetchFolderTree(mailbox, token)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, mailbox, folders } }
    }
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders?$top=100&$select=id,displayName,totalItemCount`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, mailbox, detail: `folders HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` } }
    const folders = (((await res.json()) as any)?.value || []).map((f: any) => ({ id: f.id, name: f.displayName, count: f.totalItemCount }))
    // 'inbox' is always addressable by its well-known name.
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, mailbox, folders } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/folders/create { name, parentId? } — create a mail folder (nested if
// parentId given). Needs Mail.ReadWrite app permission on the Graph app — a 403 here means
// the scope isn't granted yet. Returns the created folder {id, name} on success.
export async function mailFolderCreate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const name = String(body?.name || '').trim().slice(0, 120)
    if (!name) return { status: 400, headers: HEADERS, jsonBody: { error: 'name required' } }
    const parentId = body?.parentId ? String(body.parentId).trim() : null
    const mailbox = String(body?.mailbox || '').trim() || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const url = parentId
      ? `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${parentId}/childFolders`
      : `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name, isHidden: false }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = (j as any)?.error?.message || `HTTP ${res.status}`
      const needsPerm = res.status === 403
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, status: res.status, detail, needsPermission: needsPerm ? 'Mail.ReadWrite' : undefined } }
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, folder: { id: (j as any).id, name: (j as any).displayName, parentId } } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// Indeed/LinkedIn digests wrap the real role: "{Company} is hiring for {ROLE}. N more
// {search-term} jobs." The trailing "N more … jobs" is the SEARCH LABEL, not the role —
// classifying on it wrongly tags Program Managers etc. as C-suite. Extract just the role.
function extractRole(subject: string): string {
  const s = subject || ''
  const m = s.match(/is hiring for\s+(.+?)(?:\.\s*\d+\s+(?:more|new)\b|$)/i)
  if (m) return m[1].trim()
  // Pure digest rollup ("N new <term> job(s)…") — a count, not a specific posting. No role.
  if (/^\s*\d+\s+new\b/i.test(s)) return ''
  // Strip a trailing ". N more/new <term> job(s) [in <loc>]" digest summary if present.
  return s.replace(/\.\s*\d+\s+(?:more|new)\b.*$/i, '').trim()
}

// Seniority classifier — shared by reclassify (backfill) and rule generation.
// Priority: C Suite > VP/Head-of/Executive > Director. "Executive" (not Chief) → VP,
// per confirmed tiering. Deputy Chief → C Suite. Returns null = stays in parent.
const CSUITE_ACRONYMS = ['CEO', 'CTO', 'CIO', 'CFO', 'COO', 'CISO', 'CMO', 'CPO', 'CRO', 'CDO', 'CHRO', 'CSO', 'CCO', 'CXO', 'CAIO', 'CTIO']
function seniorityTier(subject: string): 'csuite' | 'vp' | 'director' | null {
  const s = subject || ''
  if (/\bchief\b/i.test(s)) return 'csuite'
  if (new RegExp(`\\b(${CSUITE_ACRONYMS.join('|')})\\b`).test(s)) return 'csuite'
  if (/\bfounder\b/i.test(s)) return 'csuite'
  if (/\bpresident\b/i.test(s) && !/\bvice\s+president\b/i.test(s)) return 'csuite'
  if (/\b(vice\s+president|VP|SVP|EVP|AVP)\b/i.test(s)) return 'vp'
  if (/\bhead of\b/i.test(s)) return 'vp'
  if (/\bexecutive\b/i.test(s)) return 'vp'   // Executive anything (not Chief) → VP
  if (/\bdirector\b/i.test(s)) return 'director'
  return null
}

// Core reclassify/reconcile logic, shared by the HTTP endpoint and the reconcile timer.
// Classifies every message in sourceFolderId by seniority and moves it to the right folder.
// Moves whose destination equals the source folder are SKIPPED — so this is safe to run
// as a re-audit over the seniority folders themselves (correct placements are no-ops).
async function reclassifyFolder(
  mailbox: string, token: string, sourceFolderId: string,
  opts: { targets: any; unmatchedTarget?: string | null; senderContains?: string; max?: number; dryRun?: boolean },
): Promise<any> {
  const { targets = {}, unmatchedTarget = null, senderContains = '', dryRun = true } = opts
  const max = Math.min(Math.max(Number(opts.max) || 2000, 1), 20000)
  let url: string | null = `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${sourceFolderId}/messages?$select=subject,from&$top=100`
  const msgs: any[] = []
  while (url && msgs.length < max) {
    const res: any = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { ok: false, detail: `list HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
    const j = await res.json() as any
    for (const m of (j.value || [])) msgs.push({ id: m.id, subject: m.subject, from: (m?.from?.emailAddress?.address || '').toLowerCase() })
    url = j['@odata.nextLink'] || null
  }
  const counts = { csuite: 0, vp: 0, director: 0, other: 0 }
  const toMove: { id: string; dest: string }[] = []
  for (const m of msgs) {
    if (senderContains && !m.from.includes(senderContains)) { counts.other++; continue }
    const tier = seniorityTier(extractRole(m.subject))
    const dest = (tier && targets[tier]) ? targets[tier] : unmatchedTarget
    if (tier && targets[tier]) counts[tier]++; else counts.other++
    if (dest && dest !== sourceFolderId) toMove.push({ id: m.id, dest })   // skip same-folder (already correct)
  }
  let moved = 0; const errors: string[] = []
  if (!dryRun) {
    for (let i = 0; i < toMove.length; i += 20) {
      const chunk = toMove.slice(i, i + 20)
      const batch = { requests: chunk.map((it, k) => ({ id: String(k), method: 'POST', url: `/users/${mailbox}/messages/${it.id}/move`, headers: { 'Content-Type': 'application/json' }, body: { destinationId: it.dest } })) }
      const r = await fetch('https://graph.microsoft.com/v1.0/$batch', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) })
      if (!r.ok) { if (errors.length < 5) errors.push(`batch ${r.status}: ${(await r.text()).slice(0, 120)}`); continue }
      const jr = await r.json() as any
      for (const resp of (jr.responses || [])) { if (resp.status >= 200 && resp.status < 300) moved++; else if (errors.length < 5) errors.push(`move ${resp.status}`) }
    }
  }
  return { ok: true, dryRun, scanned: msgs.length, capped: msgs.length >= max, counts, wouldMove: toMove.length, moved, errors }
}

// POST /api/mail/folders/reclassify — thin wrapper over reclassifyFolder().
export async function mailReclassify(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const sourceFolderId = String(body?.sourceFolderId || '').trim()
    if (!sourceFolderId) return { status: 400, headers: HEADERS, jsonBody: { error: 'sourceFolderId required' } }
    const mailbox = String(body?.mailbox || '').trim() || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const out = await reclassifyFolder(mailbox, token, sourceFolderId, {
      targets: body?.targets || {},
      unmatchedTarget: body?.unmatchedTarget ? String(body.unmatchedTarget).trim() : null,
      senderContains: String(body?.senderContains || '').trim().toLowerCase(),
      max: Number(body?.max) || 2000,
      dryRun: body?.dryRun !== false,
    })
    return { status: 200, headers: HEADERS, jsonBody: out }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// seniority_routing: persisted map of each source folder → its seniority subfolders +
// sender match, so the reconcile timer knows what to re-audit. One row per (owner, source).
async function ensureRoutingTable(client: any) {
  await client.query(`create table if not exists seniority_routing (
    owner_email text not null,
    source_name text not null,
    sender_match text not null default '',
    parent_id text not null,
    csuite_id text not null,
    vp_id text not null,
    director_id text not null,
    updated_at timestamptz not null default now(),
    primary key (owner_email, source_name)
  )`)
}

// GET/POST /api/mail/routing — read or upsert a source's seniority routing config.
export async function mailRouting(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const owner = resolveOwner(req).owner
    client = await getPgClient()
    await ensureRoutingTable(client)
    if (req.method === 'GET') {
      const rows = (await client.query(`select source_name, sender_match, parent_id, csuite_id, vp_id, director_id from seniority_routing where owner_email=$1 order by source_name`, [owner])).rows
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, routes: rows } }
    }
    const b = (await req.json().catch(() => ({}))) as any
    const src = String(b?.sourceName || '').trim()
    if (!src || !b?.parentId || !b?.csuite || !b?.vp || !b?.director) return { status: 400, headers: HEADERS, jsonBody: { error: 'sourceName, parentId, csuite, vp, director required' } }
    await client.query(
      `insert into seniority_routing (owner_email, source_name, sender_match, parent_id, csuite_id, vp_id, director_id, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (owner_email, source_name) do update set sender_match=excluded.sender_match, parent_id=excluded.parent_id,
         csuite_id=excluded.csuite_id, vp_id=excluded.vp_id, director_id=excluded.director_id, updated_at=now()`,
      [owner, src, String(b?.senderMatch || '').trim().toLowerCase(), b.parentId, b.csuite, b.vp, b.director],
    )
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, sourceName: src } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// Reconcile timer: every 2h, re-audit each configured source's folders with the precise
// classifier and correct any mail the (approximate) Outlook rules mis-sorted. Timer
// triggers aren't subject to the HTTP gateway timeout, so it has headroom for large folders.
// POST /api/mail/reconcile also runs it on demand.
async function runReconcile(owner?: string): Promise<any> {
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { error: 'MICROSOFT creds not set' }
  const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
  let client
  try {
    client = await getPgClient()
    await ensureRoutingTable(client)
    const rows = owner
      ? (await client.query(`select * from seniority_routing where owner_email=$1`, [owner])).rows
      : (await client.query(`select * from seniority_routing`)).rows
    const summary: any[] = []
    for (const r of rows) {
      const mailbox = r.owner_email
      const targets = { csuite: r.csuite_id, vp: r.vp_id, director: r.director_id }
      let movedTotal = 0
      // Audit parent + each seniority sub; unmatched → parent. Same-folder moves are skipped.
      for (const folder of [r.parent_id, r.csuite_id, r.vp_id, r.director_id]) {
        const res = await reclassifyFolder(mailbox, token, folder, { targets, unmatchedTarget: r.parent_id, senderContains: r.sender_match, max: 4000, dryRun: false })
        if (res?.moved) movedTotal += res.moved
      }
      summary.push({ source: r.source_name, corrected: movedTotal })
    }
    return { ok: true, sources: summary.length, summary }
  } finally { try { await client?.end() } catch {} }
}

export async function mailReconcileHttp(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const owner = resolveOwner(req).owner
    return { status: 200, headers: HEADERS, jsonBody: await runReconcile(owner) }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

export async function mailReconcileTimer(_t: any, context: InvocationContext): Promise<void> {
  try { const r = await runReconcile(); context.log(`reconcile: ${JSON.stringify(r)}`) } catch (e) { context.log(`reconcile error: ${e}`) }
}

// Approximate subject keywords for forward Outlook rules (no regex in rules — the
// reconcile timer corrects any mis-sorts using the precise classifier).
const TIER_SUBJECT_KEYWORDS: Record<string, string[]> = {
  csuite: ['Chief', 'CEO', 'CTO', 'CIO', 'CFO', 'COO', 'CISO', 'CMO', 'CPO', 'CRO', 'CDO', 'CHRO', 'Founder'],
  vp: ['Vice President', 'VP', 'SVP', 'EVP', 'Head of', 'Executive'],
  director: ['Director'],
}

// GET /api/mail/rules — list the mailbox's inbox message rules (to find/repoint existing ones).
export async function mailRulesList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const mailbox = req.query.get('mailbox') || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messageRules`, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json() as any
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: JSON.stringify(j).slice(0, 300) } }
    const rules = (j.value || []).map((r: any) => ({ id: r.id, name: r.displayName, sequence: r.sequence, enabled: r.isEnabled, conditions: r.conditions, moveToFolder: r?.actions?.moveToFolder }))
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, rules } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/rules/repoint { ruleId, destFolderId } — change a rule's move-to target.
export async function mailRuleRepoint(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const b = (await req.json().catch(() => ({}))) as any
    const ruleId = String(b?.ruleId || '').trim()
    const destFolderId = String(b?.destFolderId || '').trim()
    if (!ruleId || !destFolderId) return { status: 400, headers: HEADERS, jsonBody: { error: 'ruleId and destFolderId required' } }
    const mailbox = String(b?.mailbox || '').trim() || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messageRules/${ruleId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: { moveToFolder: destFolderId, stopProcessingRules: true } }),
    })
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: (await res.text()).slice(0, 300) } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, ruleId, destFolderId } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/rules/build-seniority — from seniority_routing, create forward inbox rules
// (per source × tier) that move new arrivals into the seniority subfolders at delivery.
// senderContains + subjectContains(tier keywords) → move to sub, stop. Approximate; the
// reconcile timer corrects. Rules are ordered csuite→vp→director so the senior tier wins.
export async function mailRulesBuild(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  let client
  try {
    const owner = resolveOwner(req).owner
    const mailbox = (await loadConfig(owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    client = await getPgClient()
    await ensureRoutingTable(client)
    const rows = (await client.query(`select * from seniority_routing where owner_email=$1 order by source_name`, [owner])).rows
    const results: any[] = []
    let seq = 1
    const tiers: ('csuite' | 'vp' | 'director')[] = ['csuite', 'vp', 'director']
    for (const r of rows) {
      const sender = String(r.sender_match || r.source_name || '').toLowerCase()
      for (const tier of tiers) {
        const dest = tier === 'csuite' ? r.csuite_id : tier === 'vp' ? r.vp_id : r.director_id
        const rule: any = {
          displayName: `EDS · ${r.source_name} · ${tier === 'csuite' ? 'C Suite' : tier === 'vp' ? 'VP & Head of' : 'Director'}`,
          sequence: seq++, isEnabled: true,
          conditions: { subjectContains: TIER_SUBJECT_KEYWORDS[tier], ...(sender ? { senderContains: [sender] } : {}) },
          actions: { moveToFolder: dest, stopProcessingRules: true },
        }
        const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messageRules`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(rule),
        })
        const j = await res.json().catch(() => ({}))
        results.push({ name: rule.displayName, ok: res.ok, id: (j as any)?.id, error: res.ok ? undefined : JSON.stringify(j).slice(0, 160) })
      }
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, created: results.filter((x) => x.ok).length, total: results.length, results } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// POST /api/mail/rules/build-parents { sources?: string[] } — create a catch-all sender rule
// per source that sweeps any remaining mail from that source's sender into the parent source
// folder. Sequenced AFTER every existing rule (so the seniority tier rules — which stop on a
// tier match — win first, and only non-tier mail falls through here). senderContains uses the
// precise sender_match (fall back to source_name). Idempotent: skips a source whose parent rule
// (`EDS · {source} · Parent`) already exists. This gives LinkedIn/Ladders the same parent-folder
// behavior Indeed/Lensa already have from their legacy sender rules.
export async function mailRulesBuildParents(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  let client
  try {
    const owner = resolveOwner(req).owner
    const mailbox = (await loadConfig(owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const b = (await req.json().catch(() => ({}))) as any
    const only: string[] | null = Array.isArray(b?.sources) ? b.sources.map((s: any) => String(s)) : null
    client = await getPgClient()
    await ensureRoutingTable(client)
    const rows = (await client.query(`select * from seniority_routing where owner_email=$1 order by source_name`, [owner])).rows
    // Read existing rules to find the max sequence to append after, and skip dup names.
    const listRes = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messageRules`, { headers: { Authorization: `Bearer ${token}` } })
    const listJson = await listRes.json() as any
    const existing = listJson.value || []
    const existingNames = new Set(existing.map((r: any) => r.displayName))
    let seq = Math.max(0, ...existing.map((r: any) => r.sequence || 0)) + 1
    const results: any[] = []
    for (const r of rows) {
      if (only && !only.includes(r.source_name)) continue
      const name = `EDS · ${r.source_name} · Parent`
      if (existingNames.has(name)) { results.push({ name, ok: true, skipped: 'already exists' }); continue }
      const sender = String(r.sender_match || r.source_name || '').toLowerCase()
      const rule: any = {
        displayName: name, sequence: seq++, isEnabled: true,
        conditions: { senderContains: [sender] },
        actions: { moveToFolder: r.parent_id, stopProcessingRules: true },
      }
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messageRules`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(rule),
      })
      const j = await res.json().catch(() => ({}))
      results.push({ name, sender, ok: res.ok, id: (j as any)?.id, error: res.ok ? undefined : JSON.stringify(j).slice(0, 160) })
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, created: results.filter((x) => x.ok && !x.skipped).length, total: results.length, results } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// POST /api/mail/rules/delete { ruleId } — delete an inbox message rule by id.
export async function mailRuleDelete(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const b = (await req.json().catch(() => ({}))) as any
    const ruleId = String(b?.ruleId || '').trim()
    if (!ruleId) return { status: 400, headers: HEADERS, jsonBody: { error: 'ruleId required' } }
    const mailbox = String(b?.mailbox || '').trim() || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messageRules/${ruleId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: (await res.text()).slice(0, 300) } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, ruleId } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// GET /api/mail/messages?folderId=&top=&mailbox=[&subjectsOnly=1] — list message
// subjects/senders for sampling seniority patterns. With folderId → that folder;
// without → the ENTIRE mailbox (Graph /messages spans all folders). subjectsOnly=1
// returns just an array of subject strings to keep the payload small for large samples.
export async function mailMessages(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const folderId = req.query.get('folderId')
    const top = Math.min(Math.max(Number(req.query.get('top')) || 200, 1), 5000)
    const subjectsOnly = !!req.query.get('subjectsOnly')
    const mailbox = req.query.get('mailbox') || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const base = folderId
      ? `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${folderId}/messages`
      : `https://graph.microsoft.com/v1.0/users/${mailbox}/messages` // whole mailbox, all folders
    let url: string | null = `${base}?$select=subject,from,receivedDateTime,parentFolderId&$top=100&$orderby=receivedDateTime desc`
    const out: any[] = []
    while (url && out.length < top) {
      const res: any = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` } }
      const j = await res.json() as any
      for (const m of (j.value || [])) out.push({ subject: m.subject, from: m?.from?.emailAddress?.address, received: m.receivedDateTime, parentFolderId: m.parentFolderId })
      url = j['@odata.nextLink'] || null
    }
    const sliced = out.slice(0, top)
    if (subjectsOnly) return { status: 200, headers: HEADERS, jsonBody: { ok: true, count: sliced.length, subjects: sliced.map((m) => m.subject) } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, count: sliced.length, messages: sliced } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/folders/create-bulk { folders: [{name, parentId?}] } — create many
// folders in one call. Returns a per-folder result so partial failures are visible.
export async function mailFoldersBulkCreate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const items = Array.isArray(body?.folders) ? body.folders : []
    if (!items.length) return { status: 400, headers: HEADERS, jsonBody: { error: 'folders[] required' } }
    const mailbox = String(body?.mailbox || '').trim() || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const results: any[] = []
    for (const it of items) {
      const name = String(it?.name || '').trim().slice(0, 120)
      const parentId = it?.parentId ? String(it.parentId).trim() : null
      if (!name) { results.push({ name: it?.name, ok: false, error: 'name required' }); continue }
      const url = parentId
        ? `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${parentId}/childFolders`
        : `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders`
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, isHidden: false }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) results.push({ name, parentId, ok: false, status: res.status, error: (j as any)?.error?.message || `HTTP ${res.status}` })
      else results.push({ name, parentId, ok: true, id: (j as any).id })
    }
    const created = results.filter((r) => r.ok).length
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, created, total: results.length, results } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/folders/delete { folderId } — delete a mail folder (cleanup/undo).
export async function mailFolderDelete(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const folderId = String(body?.folderId || '').trim()
    if (!folderId) return { status: 400, headers: HEADERS, jsonBody: { error: 'folderId required' } }
    const mailbox = String(body?.mailbox || '').trim() || (await loadConfig(resolveOwner(req).owner)).mailbox
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${folderId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok && res.status !== 204) return { status: 200, headers: HEADERS, jsonBody: { ok: false, status: res.status, detail: (await res.text()).slice(0, 300) } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, removed: folderId } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// folder_role_map: maps a mailbox folder → a role bin (persona.key). Rows the router
// consults when a message's parentFolderId matches, to assign a role directly instead
// of AI-classifying. Many-to-many: a role can pull from several folders and a folder can
// feed several roles, so the PK is (owner, folder_id, role_key) — one row per assignment.
// A folder with NO rows here is "router decides" (imported, AI picks the role).
async function ensureFolderMapTable(client: any) {
  await client.query(`create table if not exists folder_role_map (
    owner_email text not null,
    folder_id text not null,
    folder_path text not null default '',
    role_key text not null,
    skip_filter boolean not null default true,
    updated_at timestamptz not null default now(),
    primary key (owner_email, folder_id, role_key)
  )`)
}

// GET /api/mail/folder-map — list this owner's folder↔role assignments.
// POST /api/mail/folder-map { folderId, folderPath, roleKey } — add one assignment.
export async function mailFolderMap(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const owner = resolveOwner(req).owner
    client = await getPgClient()
    await ensureFolderMapTable(client)
    if (req.method === 'GET') {
      const rows = (await client.query(
        `select folder_id, folder_path, role_key, skip_filter from folder_role_map where owner_email=$1 order by folder_path`, [owner]
      )).rows
      const mappings = rows.map((r: any) => ({ folderId: r.folder_id, folderPath: r.folder_path, roleKey: r.role_key, skipFilter: r.skip_filter }))
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, mappings } }
    }
    const body = (await req.json().catch(() => ({}))) as any
    const folderId = String(body?.folderId || '').trim()
    const roleKey = String(body?.roleKey || '').trim()
    if (!folderId || !roleKey) return { status: 400, headers: HEADERS, jsonBody: { error: 'folderId and roleKey required' } }
    const folderPath = String(body?.folderPath || '').trim()
    const skipFilter = body?.skipFilter === false ? false : true
    await client.query(
      `insert into folder_role_map (owner_email, folder_id, folder_path, role_key, skip_filter, updated_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (owner_email, folder_id, role_key)
       do update set folder_path=excluded.folder_path, skip_filter=excluded.skip_filter, updated_at=now()`,
      [owner, folderId, folderPath, roleKey, skipFilter]
    )
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, folderId, roleKey, skipFilter } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// POST /api/mail/folder-map/delete { folderId, roleKey } — remove one assignment
// (folder reverts to router-decides for that role). Omit roleKey to clear ALL of a folder's roles.
export async function mailFolderMapDelete(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const owner = resolveOwner(req).owner
    const body = (await req.json().catch(() => ({}))) as any
    const folderId = String(body?.folderId || '').trim()
    const roleKey = String(body?.roleKey || '').trim()
    if (!folderId) return { status: 400, headers: HEADERS, jsonBody: { error: 'folderId required' } }
    client = await getPgClient()
    await ensureFolderMapTable(client)
    const r = roleKey
      ? await client.query(`delete from folder_role_map where owner_email=$1 and folder_id=$2 and role_key=$3`, [owner, folderId, roleKey])
      : await client.query(`delete from folder_role_map where owner_email=$1 and folder_id=$2`, [owner, folderId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, removed: r.rowCount ?? 0 } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// POST /api/mail/self-test — run the watcher checklist end-to-end and report
// each check with pass/fail + detail, so the config panel can confirm wiring.
export async function mailSelfTest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const checks: { name: string; pass: boolean; detail: string }[] = []
  const add = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail })
  let cfg: WatchConfig | null = null
  const owner = resolveOwner(req).owner
  try {
    // 1. Config loads from Postgres
    try { cfg = await loadConfig(owner); add('Config store (Postgres)', true, `owner ${owner}, mailbox ${cfg.mailbox}, folder ${cfg.folderName}`) }
    catch (e) { add('Config store (Postgres)', false, String(e)) }

    // 2. OpenAI key present (parse + embed)
    add('OpenAI key (parse/embed)', !!process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY ? 'present' : 'OPENAI_API_KEY missing')

    // 3. Graph credentials + token
    const creds = graphCreds()
    let token: string | null = null
    if (!creds.clientId || !creds.clientSecret) add('Graph credentials', false, 'MICROSOFT_CLIENT_ID/SECRET missing')
    else {
      try { token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret); add('Graph credentials', true, 'token acquired') }
      catch (e) { add('Graph credentials', false, String(e)) }
    }

    // 4. Mailbox + folder reachable (read one message)
    if (token && cfg) {
      try {
        const r = await fetch(`https://graph.microsoft.com/v1.0/${messagesResource(cfg)}?$top=1&$select=id,receivedDateTime`, { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) { const n = (((await r.json()) as any)?.value || []).length; add('Mailbox + folder readable', true, `${cfg.mailbox} / ${cfg.folderName}${n ? ' (has mail)' : ' (empty window)'}`) }
        else add('Mailbox + folder readable', false, `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      } catch (e) { add('Mailbox + folder readable', false, String(e)) }
    }

    // 5. Subscription active for this mailbox/folder
    if (token && cfg) {
      try {
        const subs = (((await (await fetch('https://graph.microsoft.com/v1.0/subscriptions', { headers: { Authorization: `Bearer ${token}` } })).json()) as any)?.value) || []
        const want = messagesResource(cfg)
        const mine = subs.filter((s: any) => (s.notificationUrl || '').includes('/mail/notify'))
        const match = mine.find((s: any) => s.resource === want)
        if (match) add('Live subscription', true, `watching, renews ${match.expirationDateTime}`)
        else if (mine.length) add('Live subscription', false, `watch exists but for a different folder — click Subscribe to repoint`)
        else add('Live subscription', false, 'no active watch — click Subscribe')
      } catch (e) { add('Live subscription', false, String(e)) }
    }

    // 6. Webhook endpoint reachable (validation handshake)
    try {
      const probe = `st${Math.floor((cfg ? cfg.mailbox.length : 7) * 131)}`
      const r = await fetch(`${NOTIFY_URL()}?validationToken=${probe}`)
      const echoed = (await r.text()) === probe
      add('Webhook handshake', r.ok && echoed, echoed ? 'notify endpoint echoes token' : `HTTP ${r.status}`)
    } catch (e) { add('Webhook handshake', false, String(e)) }

    // 7. Postgres opportunity store reachable
    try {
      let client
      try { client = await getPgClient(); const c = (await client.query('select count(*)::int as n from opportunity')).rows[0].n; add('Opportunity store', true, `${c} rows`) }
      finally { try { await client?.end() } catch {} }
    } catch (e) { add('Opportunity store', false, String(e)) }

    const passed = checks.filter((c) => c.pass).length
    return { status: 200, headers: HEADERS, jsonBody: { ok: passed === checks.length, passed, total: checks.length, config: cfg, checks } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err), checks } } }
}

// POST /api/mail/ingest-test { text } — run parse→dedupe→insert on raw text.
export async function mailIngestTest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const text = (await req.json().catch(() => ({})) as any)?.text
    if (!text || text.length < 20) return { status: 400, headers: HEADERS, jsonBody: { error: 'text required' } }
    const cfg = await loadConfig()
    return { status: 200, headers: HEADERS, jsonBody: await ingestText(text, cfg.ownerEmail) }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// Timer: renew subscriptions nearing expiry + fallback poll for missed alerts.
export async function mailRenew(myTimer: Timer, context: InvocationContext): Promise<void> {
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return
  try {
    const cfg = await loadConfig()
    if (!cfg.enabled) return
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const subs = ((await (await fetch('https://graph.microsoft.com/v1.0/subscriptions', { headers: { Authorization: `Bearer ${token}` } })).json()) as any)?.value || []
    for (const s of subs) {
      if ((s.notificationUrl || '').includes('/mail/notify')) {
        await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${s.id}`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expirationDateTime: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() })
        })
      }
    }
    // Fallback poll: ingest recent alerts (dedupe makes this safe).
    const since = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    const list = await fetch(`https://graph.microsoft.com/v1.0/${messagesResource(cfg)}?$filter=receivedDateTime ge ${since}&$select=id&$top=10`, { headers: { Authorization: `Bearer ${token}` } })
    if (list.ok) {
      const ids = ((await list.json()) as any)?.value || []
      for (const m of ids) { try { await ingestMessageId(token, m.id, cfg) } catch {} }
    }
  } catch (e) { context.log(`renew error: ${e}`) }
}

// POST /api/mail/send-test — inject a LinkedIn-style alert to fire the path E2E.
export async function mailSendTest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const cfg = await loadConfig()
    const body = (await req.json().catch(() => ({}))) as any
    const sender = body?.from || process.env.MAIL_SENDER || 'dev@enterpriseds.io'
    const to = body?.to || cfg.mailbox
    const company = body?.company || 'Northwind Robotics'
    const role = body?.role || 'Chief Operating Officer'
    const location = body?.location || 'Boston, MA (Hybrid)'
    const subject = body?.subject || `LinkedIn Job Alert: ${role} at ${company}`
    const html = body?.html || `<p>Your job alert for executive roles</p>
      <h2>${role}</h2>
      <p><b>${company}</b> — ${location}</p>
      <p>Estimated compensation: $280,000–$340,000 + equity</p>
      <p>${company} is hiring a ${role} to scale operations across North America.</p>
      <p><a href="https://www.linkedin.com/jobs/view/3901234567">View job</a></p>`
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          from: { emailAddress: { address: sender } },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      })
    })
    const detail = res.ok ? 'sent (202)' : `HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`
    return { status: 200, headers: HEADERS, jsonBody: { ok: res.ok, from: sender, to, subject, detail } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// A few well-known Greenhouse boards to pull a REAL random posting from.
const SAMPLE_GH_BOARDS = ['stripe', 'databricks', 'gitlab', 'coinbase', 'robinhood', 'airbnb', 'anthropic', 'discord']
function isExecTitle(t: string): boolean { return /\b(chief|cto|cio|ciso|cfo|coo|ceo|cpo|cmo|vp|vice president|head of|director|svp|evp|president)\b/i.test(t || '') }

// Pull a handful of real executive postings (from Greenhouse boards) to populate
// the alert with genuine company/role/location content.
async function realExecRoles(n: number, board?: string): Promise<any[]> {
  const boards = board ? [board] : SAMPLE_GH_BOARDS.slice().sort(() => Math.random() - 0.5)
  const out: any[] = []
  for (const b of boards) {
    if (out.length >= n) break
    try {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b)}/jobs`)
      if (!r.ok) continue
      const jobs = (((await r.json()) as any)?.jobs || []).filter((j: any) => isExecTitle(j.title))
      const company = b.charAt(0).toUpperCase() + b.slice(1)
      for (const j of jobs.sort(() => Math.random() - 0.5).slice(0, n)) {
        out.push({ company, role: j.title, location: j.location?.name || 'Remote', url: j.absolute_url })
        if (out.length >= n) break
      }
    } catch { /* next board */ }
  }
  return out
}

// LinkedIn-style job-alert digest (mimics the layout/subject LinkedIn actually sends).
function linkedinAlert(jobs: any[]): { subject: string; html: string } {
  const lead = jobs[0]
  const subject = `${lead.role} at ${lead.company}${jobs.length > 1 ? ` and ${jobs.length - 1} other new jobs` : ''}`
  const cards = jobs.map((j) => `
    <table role="presentation" width="100%" style="margin:12px 0;border:1px solid #e0e0e0;border-radius:8px"><tr><td style="padding:14px">
      <div style="font-size:16px;font-weight:600;color:#0a66c2">${j.role}</div>
      <div style="font-size:14px;color:#000">${j.company}</div>
      <div style="font-size:13px;color:#666">${j.location}</div>
      <a href="${j.url}" style="display:inline-block;margin-top:8px;color:#0a66c2;font-weight:600">View job</a>
    </td></tr></table>`).join('')
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px">
    <div style="color:#0a66c2;font-weight:700;font-size:18px">LinkedIn</div>
    <p style="font-size:15px">Your job alert for <b>executive roles</b> — ${jobs.length} new ${jobs.length === 1 ? 'job' : 'jobs'}</p>
    ${cards}
    <p style="font-size:12px;color:#999">You are receiving job alerts for executive roles. Manage alerts on LinkedIn.</p>
  </div>`
  return { subject, html }
}

// Indeed-style job-alert (mimics Indeed's typical alert email).
function indeedAlert(jobs: any[]): { subject: string; html: string } {
  const lead = jobs[0]
  const subject = `${jobs.length} new ${lead.role.split(' ').slice(0, 3).join(' ')} jobs`
  const rows = jobs.map((j) => `
    <div style="padding:12px 0;border-bottom:1px solid #eee">
      <a href="${j.url}" style="font-size:16px;color:#2557a7;font-weight:600;text-decoration:none">${j.role}</a>
      <div style="font-size:14px;color:#2d2d2d">${j.company}</div>
      <div style="font-size:13px;color:#767676">${j.location}</div>
    </div>`).join('')
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px">
    <div style="color:#2557a7;font-weight:700;font-size:18px">indeed</div>
    <p style="font-size:15px"><b>${jobs.length}</b> new jobs match your search: <b>executive</b></p>
    ${rows}
    <p style="font-size:12px;color:#999">This is a job alert from Indeed. Unsubscribe or edit alerts on Indeed.</p>
  </div>`
  return { subject, html }
}

// POST /api/mail/send-test-real { source?, board?, count? } — email a REALISTIC job
// alert (LinkedIn / Indeed / Greenhouse format) populated with real executive
// postings, to the watched mailbox, so the full intake flow runs on genuine content.
export async function mailSendTestReal(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const cfg = await loadConfig()
    const sender = body?.from || process.env.MAIL_SENDER || 'dev@enterpriseds.io'
    const to = body?.to || cfg.mailbox
    const source = ['linkedin', 'indeed', 'greenhouse'].includes(body?.source) ? body.source : 'linkedin'
    const count = source === 'greenhouse' ? 1 : Math.min(Math.max(Number(body?.count) || 3, 1), 6)
    const jobs = await realExecRoles(count, body?.board)
    if (!jobs.length) return { status: 200, headers: HEADERS, jsonBody: { error: 'could not fetch real postings right now — try again' } }

    let subject: string, html: string
    if (source === 'indeed') ({ subject, html } = indeedAlert(jobs))
    else if (source === 'greenhouse') { const j = jobs[0]; subject = `New role: ${j.role} at ${j.company}`; html = `<p>${j.company} is hiring.</p><h2>${j.role}</h2><p><b>${j.company}</b> — ${j.location}</p><p><a href="${j.url}">View job</a></p>` }
    else ({ subject, html } = linkedinAlert(jobs))

    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html }, from: { emailAddress: { address: sender } }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true })
    })
    const detail = res.ok ? 'sent (202)' : `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
    return { status: 200, headers: HEADERS, jsonBody: { ok: res.ok, source, from: sender, to, subject, jobs, count: jobs.length, detail, note: `Realistic ${source} alert emailed to the watched mailbox. Run "pull inbox now" or wait for the watcher to ingest it.` } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// Collect all messages matching a Graph URL, following @odata.nextLink pages.
async function fetchAllMessages(token: string, url: string): Promise<any[]> {
  const msgs: any[] = []
  let next: string | null = url
  while (next) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break
    const j = (await res.json()) as any
    msgs.push(...(j?.value || []))
    next = j?.['@odata.nextLink'] || null
    if (msgs.length > 2000) break  // safety cap
  }
  return msgs
}

// POST /api/mail/poll-now { minutes? } — on-demand inbox pull + ingest trace.
export async function mailPollNow(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const owner = resolveOwner(req).owner
    const cfg = await loadConfig(owner)
    const minutes = Number((await req.json().catch(() => ({})) as any)?.minutes) || 60
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString()
    const url = `https://graph.microsoft.com/v1.0/${messagesResource(cfg)}?$filter=receivedDateTime ge ${since}&$select=id,subject,from,receivedDateTime&$top=50&$orderby=receivedDateTime desc`
    const msgs = await fetchAllMessages(token, url)
    const trace: any[] = []
    for (const m of msgs) {
      const r = await ingestMessageId(token, m.id, cfg).catch((e) => ({ error: String(e) }))
      trace.push({ subject: m.subject, from: m?.from?.emailAddress?.address, received: m.receivedDateTime, result: r })
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, mailbox: cfg.mailbox, folder: cfg.folderName, scanned: msgs.length, trace } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/mail/clear-reload { days? } — wipe stale opportunities for the owner and
// re-pull the last N days from the watched mailbox. Fixes the empty-pipeline problem
// when past emails were ingested under the wrong owner key.
export async function mailClearReload(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const creds = graphCreds()
  if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }
  try {
    const { owner } = resolveOwner(req)
    const cfg = await loadConfig(owner)
    const days = Math.max(1, Math.min(Number((await req.json().catch(() => ({})) as any)?.days) || 7, 30))
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)

    // Delete all real (non-demo) opportunities for the authenticated owner.
    let pgClient
    let cleared = 0
    try {
      pgClient = await getPgClient()
      const del = await pgClient.query(`delete from opportunity where owner_email = $1 and not is_demo`, [owner])
      cleared = del.rowCount ?? 0
    } finally { try { await pgClient?.end() } catch {} }

    // Re-poll the mailbox for the requested window.
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const url = `https://graph.microsoft.com/v1.0/${messagesResource(cfg)}?$filter=receivedDateTime ge ${since}&$select=id,subject,from,receivedDateTime&$top=50&$orderby=receivedDateTime desc`
    const msgs = await fetchAllMessages(token, url)

    let parsed = 0, inserted = 0
    for (const m of msgs) {
      try {
        const r = await ingestMessageId(token, m.id, cfg)
        if (r && typeof r === 'object' && 'parsed' in r) { parsed += (r as any).parsed; inserted += (r as any).inserted }
      } catch {}
    }

    return { status: 200, headers: HEADERS, jsonBody: { ok: true, owner: cfg.ownerEmail, mailbox: cfg.mailbox, days, cleared, scanned: msgs.length, ingested: { parsed, inserted } } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

app.http('mailNotify', { methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'mail/notify', handler: mailNotify })
app.http('mailSendTest', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/send-test', handler: mailSendTest })
app.http('mailSendTestReal', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/send-test-real', handler: mailSendTestReal })
app.http('mailPollNow', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/poll-now', handler: mailPollNow })
app.http('mailClearReload', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/clear-reload', handler: mailClearReload })
app.http('mailSubscribe', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/subscribe', handler: mailSubscribe })
app.http('mailSubscriptions', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/subscriptions', handler: mailSubscriptions })
app.http('mailIngestTest', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/ingest-test', handler: mailIngestTest })
app.http('mailConfig', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/config', handler: mailConfig })
app.http('mailFolders', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folders', handler: mailFolders })
app.http('mailMessages', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/messages', handler: mailMessages })
app.http('mailReclassify', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folders/reclassify', handler: mailReclassify })
app.http('mailRouting', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/routing', handler: mailRouting })
app.http('mailReconcileHttp', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/reconcile', handler: mailReconcileHttp })
app.timer('mailReconcileTimer', { schedule: '0 15 */2 * * *', handler: mailReconcileTimer })
app.http('mailRulesList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/rules', handler: mailRulesList })
app.http('mailRuleRepoint', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/rules/repoint', handler: mailRuleRepoint })
app.http('mailRulesBuild', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/rules/build-seniority', handler: mailRulesBuild })
app.http('mailRulesBuildParents', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/rules/build-parents', handler: mailRulesBuildParents })
app.http('mailRuleDelete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/rules/delete', handler: mailRuleDelete })
app.http('mailFolderCreate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folders/create', handler: mailFolderCreate })
app.http('mailFoldersBulkCreate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folders/create-bulk', handler: mailFoldersBulkCreate })
app.http('mailFolderDelete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folders/delete', handler: mailFolderDelete })
app.http('mailFolderMap', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folder-map', handler: mailFolderMap })
app.http('mailFolderMapDelete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/folder-map/delete', handler: mailFolderMapDelete })
app.http('mailSelfTest', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/self-test', handler: mailSelfTest })
app.timer('mailRenew', { schedule: '0 */30 * * * *', handler: mailRenew })

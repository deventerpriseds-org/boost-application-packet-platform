import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { getMicrosoftToken } from './googleAuth'
import { logUsage } from './usageMeter'

// Email channels can actually be sent via Graph; LinkedIn/call channels have no
// send API and are copy-paste by design.
const EMAIL_CHANNELS = new Set(['coldEmail', 'followUp'])
const OUTREACH_SENDER = () => process.env.OUTREACH_SENDER || process.env.MAIL_SENDER || 'von.ellis@enterpriseds.io'

function graphCreds() {
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
  return { tenantId, clientId: process.env.MICROSOFT_CLIENT_ID, clientSecret: process.env.MICROSOFT_CLIENT_SECRET }
}

// Add recipient/subject columns (idempotent; safe every call).
async function ensureOutreachCols(client: any) {
  await client.query(`alter table outreach_message add column if not exists to_email text`)
  await client.query(`alter table outreach_message add column if not exists subject text`)
}

// Pull a "Subject: ..." line out of a generated email body, if present.
function splitSubject(body: string): { subject: string | null; rest: string } {
  const m = (body || '').match(/^\s*subject:\s*(.+?)\s*(?:\n|$)/i)
  if (m) return { subject: m[1].trim(), rest: body.slice(m[0].length).replace(/^\s+/, '') }
  return { subject: null, rest: body }
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const DEMO_EMAIL = 'demo@executive-engine.local'

// Channel config: schema-valid ids, character limits, and a drafting hint.
const CHANNELS: Record<string, { label: string; limit: number; brief: string }> = {
  coldEmail: { label: 'Cold email', limit: 2500, brief: 'a concise cold email with a subject line, POV-led opener, one specific proof point, and a low-friction ask' },
  linkedinConnect: { label: 'LinkedIn connect', limit: 300, brief: 'a LinkedIn connection request note UNDER 300 characters — warm, specific, no ask beyond connecting' },
  linkedinDM: { label: 'LinkedIn DM', limit: 1000, brief: 'a short LinkedIn direct message that references a signal and proposes a quick call' },
  inMail: { label: 'InMail', limit: 2000, brief: 'a LinkedIn InMail: crisp value proposition, one proof point, and a 20-minute ask' },
  followUp: { label: 'Follow-up', limit: 1200, brief: 'a brief, friendly follow-up that adds value and restates the ask without pressure' },
}
const TONES = ['Direct', 'Warm', 'POV-led']
const STATES = ['draft', 'scheduled', 'due', 'sent']

function msgShape(m: any) {
  return {
    id: m.id, oppId: m.opp_id, contactId: m.contact_id, channel: m.channel,
    channelLabel: CHANNELS[m.channel]?.label || m.channel, limit: CHANNELS[m.channel]?.limit,
    tone: m.tone, body: m.body, state: m.state, dayOffset: m.day_offset,
    scheduledFor: m.scheduled_for, sentAt: m.sent_at, createdAt: m.created_at,
    toEmail: m.to_email, subject: m.subject, sendable: EMAIL_CHANNELS.has(m.channel),
  }
}

// GET /api/app/opportunity/{id}/outreach — messages + cadence for an opp
export async function outreachList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    client = await getPgClient()
    const opp = (await client.query(`select company, role from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const rows = (await client.query(
      `select * from outreach_message where opp_id = $1 order by coalesce(day_offset, 999), created_at`, [oppId]
    )).rows
    return { status: 200, headers: HEADERS, jsonBody: { company: opp.company, role: opp.role, channels: Object.entries(CHANNELS).map(([id, c]) => ({ id, label: c.label, limit: c.limit })), tones: TONES, messages: rows.map(msgShape) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/outreach/generate { channel, tone, contactId? }
export async function outreachGenerate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const body = await req.json() as any
    const channel = body?.channel
    const tone = TONES.includes(body?.tone) ? body.tone : 'Direct'
    const contactId = body?.contactId || null
    if (!CHANNELS[channel]) return { status: 400, headers: HEADERS, jsonBody: { error: `invalid channel; one of ${Object.keys(CHANNELS).join(', ')}` } }
    client = await getPgClient()
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    let contact = null
    if (contactId) contact = (await client.query(`select name, role, signal from contact where id = $1`, [contactId])).rows[0]
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }

    const ch = CHANNELS[channel]
    const system = `You are an executive job-search outreach strategist. Write ${ch.brief}. Tone: ${tone}. Be specific and human; weave the provided signal in naturally. Output ONLY the message text (include a "Subject:" line only for cold email). Hard limit: ${ch.limit} characters.`
    const user = `TARGET ROLE: ${opp.role} at ${opp.company}\n${contact ? `RECIPIENT: ${contact.name} (${contact.role})\nSIGNAL: ${contact.signal || 'n/a'}\n` : ''}Why this candidate surfaced: ${opp.why_surfaced || 'n/a'}\nCompany signals: ${(opp.company_signals || []).join('; ') || 'n/a'}\nPain hypotheses: ${(opp.pain_hypotheses || []).join('; ') || 'n/a'}\n\nWrite the ${ch.label} now.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 900 })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    let text = (data.choices?.[0]?.message?.content || '').trim()
    await logUsage(`outreach:${channel}`, 'gpt-4o-mini', data.usage)
    // Enforce the LinkedIn connect hard limit defensively.
    if (text.length > ch.limit) text = text.slice(0, ch.limit)

    const inserted = (await client.query(
      `insert into outreach_message (opp_id, contact_id, channel, tone, body, state) values ($1,$2,$3,$4,$5,'draft') returning *`,
      [oppId, contactId, channel, tone, text]
    )).rows[0]
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, message: msgShape(inserted), chars: text.length, withinLimit: text.length <= ch.limit, promptSentToAI: { model: 'gpt-4o-mini', system, user } } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/outreach/{messageId}/state { state }
export async function outreachState(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const messageId = req.params.messageId
  let client
  try {
    const body = await req.json() as any
    const state = body?.state
    if (!STATES.includes(state)) return { status: 400, headers: HEADERS, jsonBody: { error: `invalid state; one of ${STATES.join(', ')}` } }
    client = await getPgClient()
    const sentAt = state === 'sent' ? 'now()' : 'sent_at'
    const r = (await client.query(`update outreach_message set state = $1, sent_at = ${sentAt} where id = $2 returning *`, [state, messageId])).rows[0]
    if (!r) return { status: 404, headers: HEADERS, jsonBody: { error: 'message not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, message: msgShape(r) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Default 7-touch cadence (day offset, channel, initial state).
const CADENCE = [
  { d: 0, channel: 'coldEmail', state: 'sent' },
  { d: 1, channel: 'linkedinConnect', state: 'sent' },
  { d: 3, channel: 'followUp', state: 'sent' },
  { d: 5, channel: 'inMail', state: 'due' },
  { d: 8, channel: 'followUp', state: 'scheduled' },
  { d: 10, channel: 'followUp', state: 'scheduled' },
  { d: 14, channel: 'coldEmail', state: 'scheduled' },
]

// POST /api/app/opportunity/{id}/cadence — seed the standard cadence if none exists
export async function cadenceSeed(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    client = await getPgClient()
    const opp = (await client.query(`select id from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const existing = (await client.query(`select count(*)::int as n from outreach_message where opp_id = $1 and day_offset is not null`, [oppId])).rows[0].n
    if (existing === 0) {
      for (const c of CADENCE) {
        await client.query(
          `insert into outreach_message (opp_id, channel, state, day_offset, scheduled_for) values ($1,$2,$3,$4, now() + ($4 || ' days')::interval)`,
          [oppId, c.channel, c.state, c.d]
        )
      }
    }
    const rows = (await client.query(`select * from outreach_message where opp_id = $1 order by coalesce(day_offset, 999), created_at`, [oppId])).rows
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, seeded: existing === 0, messages: rows.map(msgShape) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/outreach?owner= — cross-opp queue grouped by state
export async function outreachQueue(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  const includeDemo = req.query.get('includeDemo') !== 'false'
  let client
  try {
    client = await getPgClient()
    const rows = (await client.query(
      `select m.*, o.company, o.role from outreach_message m
         join opportunity o on o.id = m.opp_id
        where o.owner_email = $1 and not o.dismissed ${includeDemo ? '' : 'and not o.is_demo'}
        order by array_position(array['due','scheduled','draft','sent']::text[], m.state), coalesce(m.day_offset, 999)`, [owner]
    )).rows
    return { status: 200, headers: HEADERS, jsonBody: { count: rows.length, messages: rows.map((m: any) => ({ ...msgShape(m), company: m.company, role: m.role })) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/outreach/{messageId}/send { to?, subject? } — actually send.
// Email channels go out via Graph sendMail (from OUTREACH_SENDER); LinkedIn/call
// channels have no API, so we return a copy-paste result and leave state as-is.
export async function outreachSend(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const messageId = req.params.messageId
  let client
  try {
    const body = (await req.json().catch(() => ({}))) as any
    client = await getPgClient()
    await ensureOutreachCols(client)
    const m = (await client.query(
      `select m.*, o.company, o.role from outreach_message m join opportunity o on o.id = m.opp_id where m.id = $1`, [messageId]
    )).rows[0]
    if (!m) return { status: 404, headers: HEADERS, jsonBody: { error: 'message not found' } }

    // LinkedIn / call channels: no send API — copy-paste by design.
    if (!EMAIL_CHANNELS.has(m.channel)) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, delivered: false, copyPaste: true, channel: m.channel, note: `${CHANNELS[m.channel]?.label || m.channel} has no send API — copy the text and send it manually, then mark it sent.` } }
    }

    const to = (body?.to || '').trim()
    if (!to || !/.+@.+\..+/.test(to)) return { status: 400, headers: HEADERS, jsonBody: { error: 'a valid recipient email (to) is required to send' } }
    const creds = graphCreds()
    if (!creds.clientId || !creds.clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MICROSOFT creds not set' } }

    const { subject: parsedSubj, rest } = splitSubject(m.body || '')
    const subject = (body?.subject || parsedSubj || `Regarding ${m.role} at ${m.company}`).slice(0, 255)
    const sender = OUTREACH_SENDER()
    const token = await getMicrosoftToken(creds.tenantId, creds.clientId, creds.clientSecret)
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: rest || m.body || '' },
          from: { emailAddress: { address: sender } },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      })
    })
    if (!res.ok) {
      const detail = `sendMail HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, delivered: false, detail, hint: res.status === 403 ? `App needs Mail.Send (Application) for ${sender}.` : undefined } }
    }
    const updated = (await client.query(
      `update outreach_message set state = 'sent', sent_at = now(), to_email = $1, subject = $2 where id = $3 returning *`,
      [to, subject, messageId]
    )).rows[0]
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, delivered: true, from: sender, to, subject, message: msgShape(updated) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Timer: fire due cadence touches. Every scheduled message whose scheduled_for
// has passed flips to 'due' so it surfaces in the queue for review + send.
// (We promote to 'due', not auto-send, so nothing goes out without a human.)
async function promoteDue(client: any): Promise<number> {
  const r = await client.query(`update outreach_message set state = 'due' where state = 'scheduled' and scheduled_for is not null and scheduled_for <= now() returning id`)
  return r.rowCount || 0
}

export async function outreachTick(myTimer: Timer, context: InvocationContext): Promise<void> {
  let client
  try {
    client = await getPgClient()
    await ensureOutreachCols(client)
    const n = await promoteDue(client)
    if (n) context.log(`outreachTick: promoted ${n} scheduled → due`)
  } catch (e) { context.log(`outreachTick error: ${e}`) } finally { try { await client?.end() } catch {} }
}

// POST /api/app/outreach/tick — run the scheduler on demand (same as the hourly
// timer). Returns how many scheduled touches became due. For verification + a
// manual "process now" control.
export async function outreachTickNow(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    await ensureOutreachCols(client)
    const promoted = await promoteDue(client)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, promoted } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } } finally { try { await client?.end() } catch {} }
}

app.http('outreachList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/outreach', handler: outreachList })
app.http('outreachGenerate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/outreach/generate', handler: outreachGenerate })
app.http('cadenceSeed', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/cadence', handler: cadenceSeed })
app.http('outreachState', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/outreach/{messageId}/state', handler: outreachState })
app.http('outreachSend', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/outreach/{messageId}/send', handler: outreachSend })
app.http('outreachTickNow', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/outreach/tick', handler: outreachTickNow })
app.timer('outreachTick', { schedule: '0 0 */1 * * *', handler: outreachTick })
app.http('outreachQueue', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/outreach', handler: outreachQueue })

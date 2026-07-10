import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { coachToolSchemas, executeCoachTool } from './coachTools'
import { bootstrapMemory, listMemory, recall, remember, getPool } from './coachMemory'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const OPENAI_URL = 'https://api.openai.com/v1/responses'
const DEMO_EMAIL = 'demo@executive-engine.app'
const MODEL = process.env.COACH_MODEL || 'gpt-4o'

const SYSTEM = `You are the Executive Engine Coach — an AI operator embedded in an executive job-search platform ("Executive Engine"). The platform runs the full journey: Intake (LinkedIn/email alerts → opportunities), Production line (tailored resume, cover letter, portfolio deck, intro video packets), Outreach (multi-channel cold email / follow-up / LinkedIn / call with a cadence), and Convert (interview prep, debrief, offer negotiation).

Your role is not just to advise — you can DO. You have tools that perform every action the user would otherwise do by hand: list and move opportunities through the 12 pipeline stages, build packets and generate real Google Docs/Slides, draft and send outreach, run interview prep and offer analysis, read usage/cost, and inspect system/credential status for debugging. You also have live web search (Tavily) for company research, hiring-manager background, and comp benchmarks, plus durable memory (remember/recall) so you carry context across conversations.

Operating principles:
- When the user asks you to take an action, use the tool — don't just describe it. Chain tools when a goal needs several steps (e.g. find the opportunity → build its packet → generate the resume).
- For anything you take action on that changes state (advancing a stage, sending outreach), briefly confirm what you did and the result.
- Proactively remember durable facts and preferences the user shares (target comp, roles, tone, decisions) with the remember tool.
- Use recall at the start of substantive requests to ground yourself in prior context.
- Use web search whenever information could be newer than your training or is company/person/market specific. Cite source URLs.
- You understand the system's own architecture and can help debug it: read config_status / mail_config for tracing. Be precise and honest — never claim an action succeeded if a tool returned an error.
- Keep replies focused and skimmable. Use short paragraphs or tight bullets.`

interface RespReply { id?: string; output_text?: string; output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ text?: string; type?: string }> }> }

function extractText(j: RespReply): string {
  if (j.output_text) return j.output_text
  const parts = (j.output ?? []).flatMap((o) => o.content ?? [])
  return parts.find((c) => c?.type === 'output_text' || c?.text)?.text ?? ''
}
function extractToolCalls(j: RespReply) {
  return (j.output ?? []).filter((o) => o.type === 'function_call' && o.call_id && o.name)
    .map((o) => ({ call_id: o.call_id!, name: o.name!, arguments: o.arguments ?? '{}' }))
}

async function getVectorStoreId(): Promise<string | null> {
  try {
    const pool = getPool()
    await pool.query(`CREATE TABLE IF NOT EXISTS coach_config (id INT PRIMARY KEY DEFAULT 1, vector_store_id TEXT, updated_at TIMESTAMPTZ DEFAULT now())`)
    const { rows } = await pool.query<{ vector_store_id: string }>(`SELECT vector_store_id FROM coach_config WHERE id=1`)
    return rows[0]?.vector_store_id || null
  } catch { return null }
}

// POST /api/app/coach/chat { messages:[{role,content}], owner }
export async function coachChat(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
  try {
    const body = await req.json() as any
    const owner = (body?.owner || DEMO_EMAIL).toString()
    const history = Array.isArray(body?.messages) ? body.messages.slice(-16) : []
    if (!history.length) return { status: 400, headers: HEADERS, jsonBody: { error: 'messages required' } }
    const lastUser = [...history].reverse().find((m: any) => m.role === 'user')?.content || ''

    // Ground with durable memory (best-effort).
    let memHint = ''
    try {
      const hits = await recall({ owner, query: String(lastUser), k: 5 })
      if (hits.length) memHint = '\n\nRelevant saved memory (from prior conversations):\n' + hits.map((h) => `- ${h.text}`).join('\n')
    } catch { /* memory optional */ }

    const tools: any[] = coachToolSchemas()
    const vsId = await getVectorStoreId()
    if (vsId) tools.push({ type: 'file_search', vector_store_ids: [vsId] })

    const runningInput: unknown[] = history.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
    let previousResponseId: string | undefined
    const toolTrace: Array<{ name: string; arguments: any }> = []
    const maxHops = 8

    let reply = ''
    for (let hop = 0; hop <= maxHops; hop++) {
      const reqBody: Record<string, unknown> = {
        model: MODEL,
        instructions: SYSTEM + memHint,
        input: runningInput,
        tools,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      }
      const res = await fetch(OPENAI_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(reqBody),
      })
      if (!res.ok) throw new Error(`OpenAI Responses ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const json = await res.json() as RespReply
      previousResponseId = json.id

      const calls = extractToolCalls(json)
      if (calls.length === 0 || hop === maxHops) { reply = extractText(json).trim(); break }

      const nextInput: unknown[] = []
      for (const tc of calls) {
        let args: any = {}
        try { args = JSON.parse(tc.arguments) } catch { args = {} }
        toolTrace.push({ name: tc.name, arguments: args })
        const output = await executeCoachTool(tc.name, args, { owner })
        nextInput.push({ type: 'function_call_output', call_id: tc.call_id, output })
      }
      runningInput.length = 0
      runningInput.push(...nextInput)
    }

    // Persist the exchange to memory as a lightweight conversation record (best-effort).
    try { if (reply) await remember({ owner, kind: 'conversation', text: `User: ${String(lastUser).slice(0, 500)}\nCoach: ${reply.slice(0, 500)}`, source: 'coach-chat' }) } catch { /* optional */ }

    return { status: 200, headers: HEADERS, jsonBody: { reply, toolCalls: toolTrace, usedMemory: !!memHint, usedVectorStore: !!vsId } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

// POST /api/app/coach/memory/bootstrap
export async function coachMemoryBootstrap(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  return { status: 200, headers: HEADERS, jsonBody: await bootstrapMemory() }
}

// GET /api/app/coach/memory/list?owner=
export async function coachMemoryList(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = req.query.get('owner') || DEMO_EMAIL
  try { return { status: 200, headers: HEADERS, jsonBody: { memory: await listMemory({ owner, limit: 100 }) } } }
  catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/app/coach/provision — create (or return) the OpenAI vector store for file_search.
export async function coachProvision(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
  try {
    const existing = await getVectorStoreId()
    if (existing) return { status: 200, headers: HEADERS, jsonBody: { vectorStoreId: existing, created: false } }
    const res = await fetch('https://api.openai.com/v1/vector_stores', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ name: 'executive-engine-coach' }),
    })
    if (!res.ok) throw new Error(`vector_stores ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const vs = await res.json() as any
    const pool = getPool()
    await pool.query(`CREATE TABLE IF NOT EXISTS coach_config (id INT PRIMARY KEY DEFAULT 1, vector_store_id TEXT, updated_at TIMESTAMPTZ DEFAULT now())`)
    await pool.query(`INSERT INTO coach_config (id, vector_store_id, updated_at) VALUES (1,$1,now())
                      ON CONFLICT (id) DO UPDATE SET vector_store_id=$1, updated_at=now()`, [vs.id])
    return { status: 200, headers: HEADERS, jsonBody: { vectorStoreId: vs.id, created: true } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

// POST /api/app/coach/upload { filename, contentBase64 } — add a file to the coach's vector store.
export async function coachUpload(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
  try {
    const body = await req.json() as any
    const filename = (body?.filename || 'upload.txt').toString()
    const b64 = (body?.contentBase64 || '').toString().replace(/^data:[^;]+;base64,/, '')
    if (!b64) return { status: 400, headers: HEADERS, jsonBody: { error: 'contentBase64 required' } }
    let vsId = await getVectorStoreId()
    if (!vsId) {
      const prov = await coachProvision(req as any)
      vsId = (prov.jsonBody as any)?.vectorStoreId
    }
    if (!vsId) return { status: 200, headers: HEADERS, jsonBody: { error: 'no vector store' } }
    // Upload the file to OpenAI Files.
    const form = new FormData()
    form.append('purpose', 'assistants')
    form.append('file', new Blob([Buffer.from(b64, 'base64')]), filename)
    const fres = await fetch('https://api.openai.com/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form as any })
    if (!fres.ok) throw new Error(`files ${fres.status}: ${(await fres.text()).slice(0, 200)}`)
    const file = await fres.json() as any
    // Attach the file to the vector store.
    const ares = await fetch(`https://api.openai.com/v1/vector_stores/${vsId}/files`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ file_id: file.id }),
    })
    if (!ares.ok) throw new Error(`vector_stores/files ${ares.status}: ${(await ares.text()).slice(0, 200)}`)
    return { status: 200, headers: HEADERS, jsonBody: { fileId: file.id, vectorStoreId: vsId } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

// GET /api/app/coach/status?owner=
export async function coachStatus(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = req.query.get('owner') || DEMO_EMAIL
  const out: any = { model: MODEL, tavily: !!(process.env.TAVILY_API_KEY || '').trim(), openai: !!process.env.OPENAI_API_KEY }
  try { out.vectorStoreId = await getVectorStoreId() } catch (e) { out.vectorStoreError = String(e) }
  try { const m = await listMemory({ owner, limit: 1 }); out.memoryReady = true; out.hasMemory = m.length > 0 } catch (e) { out.memoryReady = false; out.memoryError = String(e) }
  return { status: 200, headers: HEADERS, jsonBody: out }
}

app.http('coachChat', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/chat', handler: coachChat })
app.http('coachMemoryBootstrap', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/bootstrap', handler: coachMemoryBootstrap })
app.http('coachMemoryList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/list', handler: coachMemoryList })
app.http('coachProvision', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/provision', handler: coachProvision })
app.http('coachUpload', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/upload', handler: coachUpload })
app.http('coachStatus', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/status', handler: coachStatus })

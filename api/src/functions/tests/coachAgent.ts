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
const DEMO_EMAIL = 'demo@executive-engine.local'
const MODEL = process.env.COACH_MODEL || 'gpt-4o'

const SYSTEM = `You are the Executive Engine Coach — the AI operator AND resident architect of an executive job-search platform ("Executive Engine"). You are not a generic assistant: you know this system's architecture intimately and you can both operate it and help extend it.

WHAT THE PLATFORM IS
It runs the full journey: Intake (LinkedIn/email alerts → opportunities via a Microsoft Graph watcher), Production line (tailored resume, cover letter, portfolio deck, intro video — built by copying designed Google templates and filling placeholders), Outreach (multi-channel cold email / follow-up / LinkedIn / call on a cadence, real sends via Graph), and Convert (interview prep, debrief via Whisper, offer negotiation). Data lives in Azure Postgres (boost_resume_n_packet_builder); the API is Azure Functions (job-platform-api); the app is a Static Web App. Credentials live in GitHub secrets, synced to the Function App.

HOW YOUR MEMORY WORKS (answer this precisely — it matters to the user)
Your durable memory lives in the USER'S OWN Azure Postgres database — pgvector tables coach_memory (semantic, embedded) and coach_triples (a knowledge graph). Every preference, decision, and piece of feedback you save with remember() is embedded and stored THERE, in the user's database. This makes your memory VENDOR-PORTABLE: if we swap OpenAI for a different model tomorrow, all memory persists — only the embedding/inference layer changes; the knowledge stays because it is in the user's DB, not a vendor's account. The OpenAI vector store is a SECONDARY, rebuildable store for uploaded reference documents only — it is NOT where your knowledge of the user lives. Do not conflate the two, and do not describe your memory as "files."

YOUR ROLE
- You can DO, not just advise: tools perform every action the user would do by hand — list/move opportunities across the 12 stages, build packets and generate real Google Docs/Slides, draft and send outreach, interview prep, offer analysis, usage/cost, and system/credential diagnostics.
- You are the architect: when asked what's in place, what you can do, or how something works, answer concretely — name the real components — and PROACTIVELY offer to build, change, or improve things. Never deflect a system/meta question with vague talk of "files."
- Continuous improvement: whenever the user gives feedback or states a preference/decision, immediately capture it with remember() (kind 'feedback', 'preference', or 'decision') so it compounds and shapes future work. Recall at the start of substantive requests.

OPERATING PRINCIPLES
- When asked to take an action, use the tool — don't just describe it. Chain tools for multi-step goals.
- After any state change (advancing a stage, sending outreach), confirm what you did and the result. Never claim success if a tool returned an error.
- Use web search (Tavily) for anything newer than your training or company/person/market-specific; cite source URLs.
- Keep replies focused and skimmable.`

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

async function ensureConfigTable(pool: any) {
  await pool.query(`CREATE TABLE IF NOT EXISTS coach_config (id INT PRIMARY KEY DEFAULT 1, vector_store_id TEXT, updated_at TIMESTAMPTZ DEFAULT now())`)
  await pool.query(`ALTER TABLE coach_config ADD COLUMN IF NOT EXISTS system_prompt TEXT`)
  await pool.query(`ALTER TABLE coach_config ADD COLUMN IF NOT EXISTS model TEXT`)
}

async function getVectorStoreId(): Promise<string | null> {
  try {
    const pool = getPool()
    await ensureConfigTable(pool)
    const { rows } = await pool.query<{ vector_store_id: string }>(`SELECT vector_store_id FROM coach_config WHERE id=1`)
    return rows[0]?.vector_store_id || null
  } catch { return null }
}

// Returns the stored coach config (custom system prompt + model), falling back
// to the built-in defaults. The stored prompt is what the Settings UI edits.
async function getCoachConfig(): Promise<{ systemPrompt: string; model: string; custom: boolean }> {
  try {
    const pool = getPool()
    await ensureConfigTable(pool)
    const { rows } = await pool.query<{ system_prompt: string; model: string }>(`SELECT system_prompt, model FROM coach_config WHERE id=1`)
    const sp = rows[0]?.system_prompt
    return { systemPrompt: sp || SYSTEM, model: rows[0]?.model || MODEL, custom: !!sp }
  } catch { return { systemPrompt: SYSTEM, model: MODEL, custom: false } }
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

    const cfg = await getCoachConfig()
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
        model: cfg.model,
        instructions: cfg.systemPrompt + memHint,
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

// GET /api/app/coach/config — the coach's system prompt + model (the Settings editor reads this).
export async function coachConfigGet(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const cfg = await getCoachConfig()
  return { status: 200, headers: HEADERS, jsonBody: { ...cfg, defaultPrompt: SYSTEM, defaultModel: MODEL } }
}

// POST /api/app/coach/config { systemPrompt?, model?, reset? } — update the editable prompt/model.
export async function coachConfigSet(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json() as any
    const pool = getPool()
    await ensureConfigTable(pool)
    if (body?.reset === true) {
      await pool.query(`INSERT INTO coach_config (id, system_prompt, model, updated_at) VALUES (1, NULL, NULL, now())
                        ON CONFLICT (id) DO UPDATE SET system_prompt=NULL, model=NULL, updated_at=now()`)
    } else {
      const sp = typeof body?.systemPrompt === 'string' ? body.systemPrompt : null
      const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : null
      await pool.query(`INSERT INTO coach_config (id, system_prompt, model, updated_at) VALUES (1, $1, $2, now())
                        ON CONFLICT (id) DO UPDATE SET system_prompt = COALESCE($1, coach_config.system_prompt), model = COALESCE($2, coach_config.model), updated_at=now()`, [sp, model])
    }
    return { status: 200, headers: HEADERS, jsonBody: await getCoachConfig() }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('coachChat', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/chat', handler: coachChat })
app.http('coachConfigGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/config', handler: coachConfigGet })
app.http('coachConfigSet', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/config', handler: coachConfigSet })
app.http('coachMemoryBootstrap', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/bootstrap', handler: coachMemoryBootstrap })
app.http('coachMemoryList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/list', handler: coachMemoryList })
app.http('coachProvision', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/provision', handler: coachProvision })
app.http('coachUpload', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/upload', handler: coachUpload })
app.http('coachStatus', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/status', handler: coachStatus })

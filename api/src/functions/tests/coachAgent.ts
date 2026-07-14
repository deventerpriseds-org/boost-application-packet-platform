import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { coachToolSchemas, executeCoachTool } from './coachTools'
import { bootstrapMemory, listMemory, recall, remember, deleteMemory, getPool } from './coachMemory'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const OPENAI_URL = 'https://api.openai.com/v1/responses'
const DEMO_EMAIL = 'demo@executive-engine.local'
const MODEL = process.env.COACH_MODEL || 'gpt-4o'
const DB_CUTOFF = 'June 2023'

const SYSTEM = `You are the Executive Engine Coach — the AI operator AND resident architect of an executive job-search platform ("Executive Engine"). You are not a generic assistant: you know this system's architecture intimately and you can both operate it and help extend it.

WHAT THE PLATFORM IS
It runs the full journey: Intake (LinkedIn/email alerts → opportunities via a Microsoft Graph watcher), Production line (tailored resume, cover letter, portfolio deck, intro video — built by copying designed Google templates and filling placeholders), Outreach (multi-channel cold email / follow-up / LinkedIn / call on a cadence, real sends via Graph), and Convert (interview prep, debrief via Whisper, offer negotiation). Data lives in Azure Postgres (boost_resume_n_packet_builder); the API is Azure Functions (job-platform-api); the app is a Static Web App. Credentials live in GitHub secrets, synced to the Function App.

HOW YOUR MEMORY WORKS (answer this precisely — it matters to the user)
Your durable memory lives in the USER'S OWN Azure Postgres database — pgvector tables coach_memory (semantic, embedded) and coach_triples (a knowledge graph). Every preference, decision, and piece of feedback you save with remember() is embedded and stored THERE, in the user's database. This makes your memory VENDOR-PORTABLE: if we swap OpenAI for a different model tomorrow, all memory persists — only the embedding/inference layer changes; the knowledge stays because it is in the user's DB, not a vendor's account. The OpenAI vector store is a SECONDARY, rebuildable store for uploaded reference documents only — it is NOT where your knowledge of the user lives. Do not conflate the two, and do not describe your memory as "files."

YOUR ROLE
- You can DO, not just advise: tools perform every action the user would do by hand — list/move opportunities across the 12 stages, build packets and generate real Google Docs/Slides, draft and send outreach, interview prep, offer analysis, usage/cost, and system/credential diagnostics.
- You are the architect: when asked what's in place, what you can do, or how something works, answer concretely — name the real components — and PROACTIVELY offer to build, change, or improve things. Never deflect a system/meta question with vague talk of "files."
- Continuous improvement: whenever the user gives feedback or states a preference/decision, immediately capture it with remember() (kind 'feedback', 'preference', or 'decision') so it compounds and shapes future work. Recall at the start of substantive requests.

THE 12-STAGE PIPELINE & YOUR PLAYBOOK (do exactly what's asked — ONE step OR the whole chain)
Stages: discovered → saved → enriched → applied → outreach → engaged → screen → r1 → panel → final → offer → accepted.
- INTAKE: discovered — new alerts arrive via the watcher; re-scan with mail_poll_now. saved — advance_stage to 'saved'; dismiss_opportunity to drop. enriched — enrich_opportunity (company signals, stakeholders, pain hypotheses).
- PRODUCTION LINE (applied): analyze_jd (keywords/ATS score/gaps) → build the packet. For ONE artifact: generate_artifact then create_document (resume/compact) or create_slides (cover/portfolio). For the WHOLE packet in one shot: build_full_packet (optionally seedCadence + draftOutreach). set_artifact_status to approve. answers_vision drafts application-form answers. generate_video renders the intro video.
- OUTREACH: seed_cadence (the multi-touch plan) → generate_outreach (channel: coldEmail|followUp|linkedin|call). outreach_tick promotes due touches. set_outreach_state to update. assets_analytics for engagement.
- CONVERT: interview_prep for a round. To record a live debrief you CANNOT run the mic — call ui_action{action:'start_debrief_recording', opportunityId}. interview_debrief on a transcript. list_interviews. offer_analysis for the offer; advance_stage to move rounds; 'accepted' is the win.
- BULK / start-to-finish: for "do my top N" or several opportunities, call bulk_run (topN or oppIds, +seedCadence +draftOutreach) and report the jobId + bulk_status — do not loop one-by-one.
- BROWSER actions (the server can't do): use ui_action for start_debrief_recording, navigate (open a screen), copy_link.

ABSOLUTE RULE: you NEVER send outreach or emails automatically. You draft, seed cadences, and prepare everything, then report and wait for the user to approve sending. Only send_outreach when the user explicitly says to send a specific message.

CRITICAL — WHERE YOUR DATA LIVES (do not get this wrong)
- ALL questions about jobs, opportunities, the pipeline, counts, "how many came in today", "latest opportunities", dates, stages, packets, or outreach are answered by CALLING THE TOOLS (list_opportunities, get_opportunity, list_packets, list_outreach, get_usage, …) against the live Postgres database. NEVER answer these from "uploaded files" or say you couldn't find them in files — that is wrong. If you need dates, list_opportunities returns createdAt + sourceDate per opportunity.
- "How many came in today?" → call list_opportunities and count those whose createdAt/sourceDate is today. "Latest opportunities and their dates?" → call list_opportunities, sort by createdAt desc, report the top few with their dates.
- The file_search tool (if present at all) searches ONLY documents the user explicitly uploaded — it is NEVER the source of pipeline/opportunity data. If a question is about the user's jobs and you find yourself reaching for files, STOP and call list_opportunities instead.

OPERATING PRINCIPLES
- When asked to take an action, use the tool — don't just describe it. Chain tools for multi-step goals; do a single step when only one is asked.
- After any state change, confirm what you did and the result. Never claim success if a tool returned an error.
- WEB SEARCH: Your knowledge cutoff is June 2023. You have NO reliable knowledge of events, people's current roles or teams, prices, news, funding rounds, or any fact that could have changed after June 2023. For ANYTHING that could have changed since then you MUST call tavily_web_search and answer ONLY from its results with cited source URLs. If the search fails or returns nothing, say you couldn't retrieve current data — never answer such questions from memory. This is separate from the pipeline tools above — use list_opportunities etc. for the user's own jobs, and tavily_web_search for the outside world.
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

async function ensureOpsTables(pool: any) {
  await pool.query(`create table if not exists coach_activity (
    id uuid primary key default gen_random_uuid(), owner text not null, user_msg text, reply text,
    tools jsonb default '[]'::jsonb, instructions text, created_at timestamptz default now())`)
  await pool.query(`create index if not exists coach_activity_owner_idx on coach_activity (owner, created_at desc)`)
  await pool.query(`create table if not exists coach_thread (owner text primary key, messages jsonb default '[]'::jsonb, updated_at timestamptz default now())`)
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

// Core coach turn — shared by the HTTP chat endpoint and the voice Chat Completions bridge.
// Takes a history array and owner, runs the full Responses loop (gpt-4o, all tools, cutoff
// grounding, memory), persists activity + thread, returns reply + tool trace.
export async function runCoachTurn(
  history: Array<{ role: string; content: string }>,
  owner: string,
  key: string,
): Promise<{ reply: string; toolCalls: Array<{ name: string; arguments: any }>; uiActions: any[]; usedMemory: boolean; usedVectorStore: boolean }> {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || ''

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const curYear = now.getUTCFullYear()
  const dateHint = `KNOWLEDGE CUTOFF RULE (HARD): This application's database was last updated in ${DB_CUTOFF}. You have NO reliable knowledge of any event, person's role or team, price, news, funding round, or fact that could have changed after ${DB_CUTOFF}. For ANY such question you MUST call tavily_web_search and answer ONLY from its results. Never answer post-${DB_CUTOFF} questions from memory — if Tavily fails, say you cannot confirm without a live search.\n\nCURRENT DATE: ${todayStr}. The current year is ${curYear}. HARD RULE for tavily_web_search: NEVER put a year earlier than ${curYear} in a query unless the user named one — just search the topic. Prefer max_results >= 5. Only set a narrow time_range when the user explicitly asks for very recent news. If a search returns nothing, broaden it and retry. Never fabricate figures — report only what the search returned, with source URLs.`

  let memHint = ''
  try {
    const hits = await recall({ owner, query: String(lastUser), k: 5 })
    if (hits.length) memHint = '\n\nRelevant saved memory (from prior conversations):\n' + hits.map((h) => `- ${h.text}`).join('\n')
  } catch { /* memory optional */ }

  const cfg = await getCoachConfig()
  const tools: any[] = coachToolSchemas()
  const vsId = await getVectorStoreId()
  let vsHasFiles = false
  if (vsId) {
    try {
      const vr = await fetch(`https://api.openai.com/v1/vector_stores/${vsId}`, { headers: { Authorization: `Bearer ${key}` } })
      if (vr.ok) { const vj = await vr.json() as any; vsHasFiles = (vj?.file_counts?.completed || 0) > 0 }
    } catch { /* ignore */ }
  }
  if (vsId && vsHasFiles) tools.push({ type: 'file_search', vector_store_ids: [vsId] })

  const runningInput: unknown[] = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
  // Channel B: cutoff rule in the conversation channel (not only instructions).
  runningInput.unshift({
    role: 'system',
    content: `HARD RULE: Your knowledge cutoff is ${DB_CUTOFF}. Any question about events, roles, prices, news, teams, or facts that may have changed after ${DB_CUTOFF} MUST be answered via tavily_web_search only — never from memory. Today is ${todayStr}.`,
  })

  let previousResponseId: string | undefined
  const toolTrace: Array<{ name: string; arguments: any }> = []
  const maxHops = 8
  let reply = ''

  for (let hop = 0; hop <= maxHops; hop++) {
    const reqBody: Record<string, unknown> = {
      model: cfg.model,
      instructions: dateHint.trim() + '\n\n' + cfg.systemPrompt + memHint,
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

  const uiActions = toolTrace.filter((t) => t.name === 'ui_action').map((t) => t.arguments)

  try { if (reply) await remember({ owner, kind: 'conversation', text: `User: ${String(lastUser).slice(0, 500)}\nCoach: ${reply.slice(0, 500)}`, source: 'coach-chat' }) } catch {}
  try {
    const pool = getPool(); await ensureOpsTables(pool)
    await pool.query(`insert into coach_activity (owner, user_msg, reply, tools, instructions) values ($1,$2,$3,$4,$5)`,
      [owner, String(lastUser).slice(0, 1000), reply.slice(0, 2000), JSON.stringify(toolTrace), (dateHint.trim() + '\n\n' + cfg.systemPrompt + memHint).slice(0, 8000)])
    const fullThread = [...history.map((m) => ({ role: m.role, content: String(m.content || '') })), { role: 'assistant', content: reply }].slice(-40)
    await pool.query(`insert into coach_thread (owner, messages, updated_at) values ($1,$2,now())
                      on conflict (owner) do update set messages=$2, updated_at=now()`, [owner, JSON.stringify(fullThread)])
  } catch {}

  return { reply, toolCalls: toolTrace, uiActions, usedMemory: !!memHint, usedVectorStore: !!(vsId && vsHasFiles) }
}

// POST /api/app/coach/chat { messages:[{role,content}], owner }
export async function coachChat(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
  try {
    const body = await req.json() as any
    const _ro = resolveOwner(req); const owner = _ro.verified ? _ro.owner : (body?.owner || DEMO_EMAIL).toString()
    const history = Array.isArray(body?.messages) ? body.messages.slice(-16) : []
    if (!history.length) return { status: 400, headers: HEADERS, jsonBody: { error: 'messages required' } }

    const result = await runCoachTurn(history, owner, key)

    return { status: 200, headers: HEADERS, jsonBody: { reply: result.reply, toolCalls: result.toolCalls, uiActions: result.uiActions, usedMemory: result.usedMemory, usedVectorStore: result.usedVectorStore } }
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
  const owner = resolveOwner(req).owner
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
  const owner = resolveOwner(req).owner
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

// POST /api/app/coach/memory/add { text, kind, owner } — manual "add context" row.
export async function coachMemoryAdd(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json() as any
    const text = (body?.text || '').toString().trim()
    if (!text) return { status: 400, headers: HEADERS, jsonBody: { error: 'text required' } }
    const _ro = resolveOwner(req); const owner = _ro.verified ? _ro.owner : (body?.owner || DEMO_EMAIL).toString()
    const kind = ['note', 'fact', 'preference', 'decision', 'feedback'].includes(body?.kind) ? body.kind : 'note'
    const r = await remember({ owner, kind, text, source: 'manual:settings' })
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, id: r.id } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/app/coach/memory/delete { id }
export async function coachMemoryDelete(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json() as any
    if (!body?.id) return { status: 400, headers: HEADERS, jsonBody: { error: 'id required' } }
    return { status: 200, headers: HEADERS, jsonBody: await deleteMemory(String(body.id)) }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// GET /api/app/coach/activity?owner= — the agent's action log (tool calls + prompt sent per turn).
export async function coachActivity(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  try {
    const pool = getPool(); await ensureOpsTables(pool)
    const { rows } = await pool.query(`select id, user_msg, reply, tools, created_at from coach_activity where owner=$1 order by created_at desc limit 40`, [owner])
    return { status: 200, headers: HEADERS, jsonBody: { activity: rows.map((r: any) => ({ id: r.id, userMsg: r.user_msg, reply: r.reply, tools: r.tools || [], createdAt: r.created_at })) } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// GET /api/app/coach/thread?owner= — restore the persisted conversation (proof it's DB-backed).
export async function coachThreadGet(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  try {
    const pool = getPool(); await ensureOpsTables(pool)
    const { rows } = await pool.query(`select messages, updated_at from coach_thread where owner=$1`, [owner])
    return { status: 200, headers: HEADERS, jsonBody: { messages: rows[0]?.messages || [], updatedAt: rows[0]?.updated_at || null } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// POST /api/app/coach/thread/clear { owner }
export async function coachThreadClear(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json().catch(() => ({})) as any
    const _ro = resolveOwner(req); const owner = _ro.verified ? _ro.owner : (body?.owner || DEMO_EMAIL).toString()
    const pool = getPool(); await ensureOpsTables(pool)
    await pool.query(`delete from coach_thread where owner=$1`, [owner])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

app.http('coachChat', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/chat', handler: coachChat })
app.http('coachMemoryAdd', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/add', handler: coachMemoryAdd })
app.http('coachMemoryDelete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/delete', handler: coachMemoryDelete })
app.http('coachActivity', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/activity', handler: coachActivity })
app.http('coachThreadGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/thread', handler: coachThreadGet })
app.http('coachThreadClear', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/thread/clear', handler: coachThreadClear })
app.http('coachConfigGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/config', handler: coachConfigGet })
app.http('coachConfigSet', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/config', handler: coachConfigSet })
app.http('coachMemoryBootstrap', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/bootstrap', handler: coachMemoryBootstrap })
app.http('coachMemoryList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/memory/list', handler: coachMemoryList })
app.http('coachProvision', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/provision', handler: coachProvision })
app.http('coachUpload', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/upload', handler: coachUpload })
app.http('coachStatus', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/coach/status', handler: coachStatus })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// POST /api/diag/convai-agent-ensure — create an ElevenLabs Conversational AI
// agent (voice = default voice, OpenAI LLM, exec-coach prompt) and return its id.
// Run once; then store the id as ELEVENLABS_AGENT_ID.
export async function convaiAgentEnsure(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_API_KEY not set' } }
  const existing = process.env.ELEVENLABS_AGENT_ID
  if (existing) return { status: 200, headers: HEADERS, jsonBody: { ok: true, agentId: existing, note: 'already configured via ELEVENLABS_AGENT_ID' } }

  try {
    const bodyText = (await req.json().catch(() => ({})) as any)
    const prompt = bodyText?.prompt
      || 'You are a warm, sharp executive career coach on a live voice call. Keep replies to 1-3 short spoken sentences. Ask one question at a time. No markdown.'
    const firstMessage = bodyText?.firstMessage || "Hi, I'm your Executive Engine coach. What would you like to work on?"

    const payload: any = {
      name: 'Executive Engine Coach',
      conversation_config: {
        agent: {
          prompt: { prompt, llm: 'gpt-4o-mini' },
          first_message: firstMessage,
          language: 'en',
        },
        tts: voiceId ? { voice_id: voiceId } : {},
      },
    }
    const res = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: `create HTTP ${res.status}: ${txt.slice(0, 400)}` } }
    const j = JSON.parse(txt)
    const agentId = j?.agent_id || j?.agentId
    return { status: 200, headers: HEADERS, jsonBody: { ok: !!agentId, agentId, raw: agentId ? undefined : j } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: String(err) } }
  }
}

// GET /api/app/voice/session — mint a short-lived signed WebSocket URL for the
// agent so the browser can connect without ever seeing the API key.
export async function voiceSession(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.ELEVENLABS_API_KEY
  const agentId = req.query.get('agentId') || process.env.ELEVENLABS_AGENT_ID
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_API_KEY not set' } }
  if (!agentId) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_AGENT_ID not set (run diag/convai-agent-ensure first)' } }
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { 'xi-api-key': key }
    })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `signed-url HTTP ${res.status}: ${txt.slice(0, 300)}` } }
    const j = JSON.parse(txt)
    const signedUrl = j?.signed_url || j?.signedUrl
    return { status: 200, headers: HEADERS, jsonBody: { signedUrl, agentId } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

// POST /api/diag/convai-agent-tune — upgrade the agent's turn detection to the
// echo-robust turn_v3 model and set a turn timeout. Reduces self-interruption
// from acoustic echo (the agent hearing its own voice on speakerphone).
export async function convaiAgentTune(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.ELEVENLABS_API_KEY
  const agentId = req.query.get('agentId') || process.env.ELEVENLABS_AGENT_ID
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_API_KEY not set' } }
  if (!agentId) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_AGENT_ID not set' } }
  try {
    const patch = {
      conversation_config: {
        turn: { turn_timeout: 8, turn_model: 'turn_v3' },
      },
    }
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
    })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: `PATCH HTTP ${res.status}: ${txt.slice(0, 400)}` } }
    let j: any = null; try { j = JSON.parse(txt) } catch {}
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, agentId, turn: j?.conversation_config?.turn || 'updated' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: String(err) } }
  }
}

app.http('convaiAgentEnsure', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/convai-agent-ensure', handler: convaiAgentEnsure })
app.http('convaiAgentTune', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/convai-agent-tune', handler: convaiAgentTune })
app.http('voiceSession', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/voice/session', handler: voiceSession })

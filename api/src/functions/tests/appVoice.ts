import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { runCoachTurn } from './coachAgent'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// POST /api/app/voice/turn { audioBase64, mime?, history? }
// One conversational turn for the 1:1 voice call: speech → OpenAI transcription
// → OpenAI reply → ElevenLabs voice. Returns transcript, reply text, reply audio
// (base64 mp3), and per-hop timings so the client can show lag.
export async function voiceTurn(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const openaiKey = process.env.OPENAI_API_KEY
  const elKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID
  if (!openaiKey) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
  if (!elKey || !voiceId) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_API_KEY / voice not set' } }

  try {
    const body = await req.json() as any
    let audio = (body?.audioBase64 || '').toString().replace(/^data:[^;]+;base64,/, '')
    const mime = body?.mime || 'audio/webm'
    const history = Array.isArray(body?.history) ? body.history.slice(-8) : []
    if (audio.length < 100) return { status: 400, headers: HEADERS, jsonBody: { error: 'audioBase64 required' } }
    const audioBuf = Buffer.from(audio, 'base64')

    // 1) STT — OpenAI transcription (whisper-1).
    const t0 = Date.now()
    const form = new FormData()
    const ext = mime.includes('mp3') || mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : mime.includes('mp4') ? 'mp4' : 'webm'
    form.append('file', new Blob([audioBuf], { type: mime }), `speech.${ext}`)
    form.append('model', 'whisper-1')
    const sttRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${openaiKey}` }, body: form as any
    })
    if (!sttRes.ok) throw new Error(`STT HTTP ${sttRes.status}: ${(await sttRes.text()).slice(0, 200)}`)
    const transcript = ((await sttRes.json() as any)?.text || '').trim()
    const tStt = Date.now()

    if (!transcript) {
      return { status: 200, headers: HEADERS, jsonBody: { transcript: '', reply: "I didn't catch that — could you say it again?", audioBase64: null, timings: { sttMs: tStt - t0 } } }
    }

    // 2) LLM — fast reply, spoken-style, with short history.
    const messages = [
      { role: 'system', content: 'You are a warm, concise executive career coach on a live voice call. Reply in 1-3 short spoken sentences. No markdown, no lists.' },
      ...history.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
      { role: 'user', content: transcript },
    ]
    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 160, temperature: 0.6 })
    })
    if (!llmRes.ok) throw new Error(`LLM HTTP ${llmRes.status}: ${(await llmRes.text()).slice(0, 200)}`)
    const reply = ((await llmRes.json() as any)?.choices?.[0]?.message?.content || '').trim()
    const tLlm = Date.now()

    // 3) TTS — ElevenLabs turbo (low latency).
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST', headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: reply, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    })
    if (!ttsRes.ok) throw new Error(`TTS HTTP ${ttsRes.status}: ${(await ttsRes.text()).slice(0, 200)}`)
    const replyAudio = Buffer.from(await ttsRes.arrayBuffer())
    const tTts = Date.now()

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        transcript, reply,
        audioBase64: `data:audio/mpeg;base64,${replyAudio.toString('base64')}`,
        timings: { sttMs: tStt - t0, llmMs: tLlm - tStt, ttsMs: tTts - tLlm, totalMs: tTts - t0 },
        bytes: replyAudio.length,
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('voiceTurn', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/voice/turn', handler: voiceTurn })

const VOICE_OWNER = process.env.VOICE_DEFAULT_OWNER || 'voice@executive-engine.local'

// POST /api/app/voice/chat — ElevenLabs Custom LLM endpoint.
// ConvAI sends a Chat Completions-format request; we run the full coach brain
// (same as /api/app/coach/chat) and return a Chat Completions-format response.
// ElevenLabs reads choices[0].message.content and speaks it with the configured voice.
export async function voiceChat(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
  try {
    const body = await req.json() as any
    const messages: Array<{ role: string; content: string }> = Array.isArray(body?.messages) ? body.messages : []
    // Strip system messages inserted by ConvAI (we supply our own via runCoachTurn).
    const history = messages.filter((m) => m.role !== 'system').slice(-16)
    if (!history.length) return { status: 200, headers: HEADERS, jsonBody: { error: 'messages required' } }

    const result = await runCoachTurn(history, VOICE_OWNER, key)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        id: `chatcmpl-voice-${Date.now()}`,
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: result.reply }, finish_reason: 'stop' }],
      },
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('voiceChat', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/voice/chat', handler: voiceChat })

// POST /api/diag/convai-agent-point — patch the ElevenLabs ConvAI agent to use
// our /api/app/voice/chat endpoint as its custom LLM instead of gpt-4o-mini.
// Run once after deploy; the agent_id is read from ELEVENLABS_AGENT_ID env var.
export async function convaiAgentPoint(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const elKey = process.env.ELEVENLABS_API_KEY
  const agentId = process.env.ELEVENLABS_AGENT_ID
  if (!elKey) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_API_KEY not set' } }
  if (!agentId) return { status: 200, headers: HEADERS, jsonBody: { error: 'ELEVENLABS_AGENT_ID not set' } }

  const customLlmUrl = 'https://job-platform-api.azurewebsites.net/api/app/voice/chat'

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_config: {
          custom_llm: { url: customLlmUrl },
        },
      }),
    })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, status: res.status, detail: txt.slice(0, 400) } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, agentId, customLlmUrl } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: String(err) } }
  }
}

app.http('convaiAgentPoint', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/convai-agent-point', handler: convaiAgentPoint })

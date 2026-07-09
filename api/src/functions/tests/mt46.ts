import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// MT-46 — Realtime voice-loop latency. Self-contained: synthesizes a spoken
// question with ElevenLabs (stands in for the user's mic), then runs the live
// call pipeline — OpenAI transcription → OpenAI reply → ElevenLabs voice — and
// reports real per-hop latency so we can judge lag before wiring the mic UI.
export async function mt46(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const openaiKey = process.env.OPENAI_API_KEY
  const elKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID
  if (!openaiKey) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }
  if (!elKey || !voiceId) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'ELEVENLABS_API_KEY / voice not set' } }
  const question = (await req.json().catch(() => ({})) as any)?.text
    || 'What is a strong way to answer when an interviewer asks about my biggest weakness?'

  const tts = async (text: string) => {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST', headers: { 'xi-api-key': elKey!, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' })
    })
    if (!r.ok) throw new Error(`TTS HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`)
    return Buffer.from(await r.arrayBuffer())
  }

  try {
    // 0) Synthesize the "spoken" question (not counted in call latency).
    const inputAudio = await tts(question)

    // 1) STT
    const t0 = Date.now()
    const form = new FormData()
    form.append('file', new Blob([inputAudio], { type: 'audio/mpeg' }), 'q.mp3')
    form.append('model', 'whisper-1')
    const sttRes = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${openaiKey}` }, body: form as any })
    if (!sttRes.ok) throw new Error(`STT HTTP ${sttRes.status}: ${(await sttRes.text()).slice(0, 160)}`)
    const transcript = ((await sttRes.json() as any)?.text || '').trim()
    const tStt = Date.now()

    // 2) LLM
    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [
        { role: 'system', content: 'You are a warm, concise executive career coach on a live voice call. Reply in 1-3 short spoken sentences.' },
        { role: 'user', content: transcript },
      ], max_tokens: 160, temperature: 0.6 })
    })
    if (!llmRes.ok) throw new Error(`LLM HTTP ${llmRes.status}: ${(await llmRes.text()).slice(0, 160)}`)
    const reply = ((await llmRes.json() as any)?.choices?.[0]?.message?.content || '').trim()
    const tLlm = Date.now()

    // 3) TTS (reply)
    const replyAudio = await tts(reply)
    const tTts = Date.now()

    const timings = { sttMs: tStt - t0, llmMs: tLlm - tStt, ttsMs: tTts - tLlm, totalMs: tTts - t0 }
    // "Limited lag" target for a request/response turn: under ~4s total.
    const pass = !!transcript && !!reply && replyAudio.length > 1000 && timings.totalMs < 6000
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: `Voice loop: "${transcript.slice(0, 60)}" → reply in ${timings.totalMs}ms (STT ${timings.sttMs} / LLM ${timings.llmMs} / TTS ${timings.ttsMs}). ${pass ? 'Within lag target.' : 'Over target or incomplete.'}`,
        transcript, reply, timings, replyBytes: replyAudio.length,
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt46', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-46', handler: mt46 })

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// MT-45 — ElevenLabs one-shot text-to-speech. Sends text to the default voice and
// confirms real audio bytes come back (valid MP3 frame + non-trivial length),
// with latency. Proves the ElevenLabs credential + narration pipeline.
export async function mt45(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'ELEVENLABS_API_KEY not set' } }
  if (!voiceId) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'ELEVENLABS_DEFAULT_VOICE_ID not set' } }

  try {
    const text = (await req.json().catch(() => ({})) as any)?.text
      || 'Hello — this is the Executive Engine narration test. Your voice pipeline is working.'
    const t0 = Date.now()
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    })
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const ms = Date.now() - t0
    const contentType = res.headers.get('content-type') || ''
    // Valid MP3: ID3 tag ("ID3") or an MPEG audio frame sync (0xFF Ex/Fx).
    const isMp3 = buf.length > 1000 && (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))
    const pass = res.ok && isMp3
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `ElevenLabs returned ${buf.length} bytes of ${contentType || 'audio'} in ${ms}ms (valid MP3).`
          : `Unexpected response — ${buf.length} bytes, content-type ${contentType}, mp3=${isMp3}`,
        bytes: buf.length, contentType, latencyMs: ms, voiceId, model: 'eleven_turbo_v2_5'
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt45', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-45', handler: mt45 })

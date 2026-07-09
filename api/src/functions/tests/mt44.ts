import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// MT-44 — HeyGen avatar-video render. Proves the HeyGen credential + v2 render
// pipeline: fetch a real avatar + voice from the account, submit a short avatar
// video from a script, and confirm a video_id comes back (render is async, so a
// returned video_id + accepted job is the pass condition). Optionally polls once.
export async function mt44(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.HEYGEN_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'HEYGEN_API_KEY not set' } }
  const H = { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' }

  try {
    // 1) Pick a real avatar from this account.
    const avRes = await fetch('https://api.heygen.com/v2/avatars', { headers: H })
    if (!avRes.ok) throw new Error(`avatars HTTP ${avRes.status}: ${(await avRes.text()).slice(0, 200)}`)
    const avData = await avRes.json() as any
    const avatar = (avData?.data?.avatars || [])[0]
    const avatarId = avatar?.avatar_id
    if (!avatarId) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'No avatars available on this HeyGen account', avatarsSample: (avData?.data?.avatars || []).slice(0, 2) } }

    // 2) Pick a voice.
    const vRes = await fetch('https://api.heygen.com/v2/voices', { headers: H })
    const vData = vRes.ok ? await vRes.json() as any : { data: { voices: [] } }
    const voiceId = (vData?.data?.voices || [])[0]?.voice_id

    // 3) Submit a short render.
    const body = {
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
        voice: voiceId
          ? { type: 'text', input_text: 'Hello — this is a test intro from the Executive Engine.', voice_id: voiceId }
          : { type: 'text', input_text: 'Hello — this is a test intro from the Executive Engine.' },
      }],
      dimension: { width: 1280, height: 720 },
    }
    const genRes = await fetch('https://api.heygen.com/v2/video/generate', { method: 'POST', headers: H, body: JSON.stringify(body) })
    const genText = await genRes.text()
    if (!genRes.ok) throw new Error(`generate HTTP ${genRes.status}: ${genText.slice(0, 300)}`)
    const gen = JSON.parse(genText)
    const videoId = gen?.data?.video_id
    if (!videoId) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'No video_id returned', response: gen } }

    // 4) One status poll (render is async and may take minutes).
    let status = 'processing', videoUrl: string | null = null
    try {
      const stRes = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: H })
      if (stRes.ok) { const st = await stRes.json() as any; status = st?.data?.status || status; videoUrl = st?.data?.video_url || null }
    } catch {}

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: true,
        detail: `HeyGen render accepted — video_id ${videoId} (status: ${status}). Avatar ${avatarId}${voiceId ? `, voice ${voiceId}` : ''}.`,
        videoId, avatarId, voiceId, status, videoUrl,
        avatarsAvailable: (avData?.data?.avatars || []).length,
        voicesAvailable: (vData?.data?.voices || []).length,
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt44', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-44', handler: mt44 })

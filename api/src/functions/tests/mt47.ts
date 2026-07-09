import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
const RECIPIENT = 'von.ellis@enterpriseds.io'
const SENDER = 'dev@enterpriseds.io'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function heygenStatus(H: any, videoId: string) {
  const r = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: H })
  if (!r.ok) return { status: 'unknown' }
  const d = await r.json() as any
  return { status: d?.data?.status || 'unknown', videoUrl: d?.data?.video_url || null, error: d?.data?.error || null }
}

// Submit a HeyGen render for a given character block; returns { video_id } or throws.
async function submitRender(H: any, character: any, voiceId: string, text: string) {
  const body = {
    video_inputs: [{ character, voice: { type: 'text', input_text: text, voice_id: voiceId } }],
    dimension: { width: 1280, height: 720 },
  }
  const res = await fetch('https://api.heygen.com/v2/video/generate', { method: 'POST', headers: H, body: JSON.stringify(body) })
  const txt = await res.text()
  if (!res.ok) throw new Error(`generate HTTP ${res.status}: ${txt.slice(0, 300)}`)
  const j = JSON.parse(txt)
  const id = j?.data?.video_id
  if (!id) throw new Error(`no video_id: ${txt.slice(0, 200)}`)
  return id
}

// MT-47 — Clone-avatar + clone-voice HeyGen video, then email the finished MP4
// link. Uses HEYGEN_CLONE_1_AVATAR_IDENTITY_ID + HEYGEN_CLONED_VOICE_ID. Tries an
// avatar-type character, falls back to talking_photo, polls to completion, and
// sends the link to von.ellis@enterpriseds.io via Microsoft Graph.
export async function mt47(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.HEYGEN_API_KEY
  const avatarId = process.env.HEYGEN_CLONE_1_AVATAR_IDENTITY_ID
  const voiceId = process.env.HEYGEN_CLONED_VOICE_ID
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'HEYGEN_API_KEY not set' } }
  if (!avatarId || !voiceId) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'HEYGEN_CLONE_1_AVATAR_IDENTITY_ID or HEYGEN_CLONED_VOICE_ID not set' } }
  const H = { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' }

  try {
    const text = (await req.json().catch(() => ({})) as any)?.text
      || "Hi, this is my Executive Engine intro. I lead platform modernization at scale, and I'm excited to bring that to your team."

    // Submit — try avatar, fall back to talking_photo if HeyGen rejects the type.
    let videoId: string, mode = 'avatar'
    try {
      videoId = await submitRender(H, { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' }, voiceId, text)
    } catch (e1) {
      mode = 'talking_photo'
      videoId = await submitRender(H, { type: 'talking_photo', talking_photo_id: avatarId }, voiceId, text)
    }

    // Poll to completion (cap ~150s to stay within the function timeout).
    let st = await heygenStatus(H, videoId)
    for (let i = 0; i < 15 && st.status !== 'completed' && st.status !== 'failed'; i++) {
      await sleep(10000)
      st = await heygenStatus(H, videoId)
    }
    if (st.status === 'failed') return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Render failed: ${JSON.stringify(st.error)}`, videoId, mode } }
    if (st.status !== 'completed' || !st.videoUrl) {
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Still rendering (status ${st.status}) after ~150s. Re-run to email once complete.`, videoId, mode, status: st.status } }
    }

    // Email the finished link via Graph.
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
    const clientId = process.env.MICROSOFT_CLIENT_ID, clientSecret = process.env.MICROSOFT_CLIENT_SECRET
    let emailed = false, emailDetail = 'skipped (Graph creds missing)'
    if (clientId && clientSecret) {
      const token = await getMicrosoftToken(tenantId, clientId, clientSecret)
      const mail = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: {
          subject: 'Your Executive Engine clone video is ready',
          body: { contentType: 'HTML', content: `<p>Your HeyGen clone-avatar video (voice clone) is ready.</p><p><a href="${st.videoUrl}">▶ Watch / download the MP4</a></p><p style="color:#888;font-size:12px">video_id ${videoId} · mode ${mode}</p>` },
          toRecipients: [{ emailAddress: { address: RECIPIENT } }]
        } })
      })
      emailed = mail.ok
      emailDetail = mail.ok ? `sent to ${RECIPIENT} (HTTP ${mail.status})` : `Graph HTTP ${mail.status}: ${(await mail.text()).slice(0, 200)}`
    }

    return {
      status: 200, headers: HEADERS,
      jsonBody: { pass: emailed, detail: emailed ? `Clone video rendered and emailed to ${RECIPIENT}.` : `Video rendered but email ${emailDetail}`, videoId, mode, videoUrl: st.videoUrl, emailed, emailDetail }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt47', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-47', handler: mt47 })

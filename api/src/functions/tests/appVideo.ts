import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function heygenHeaders() {
  const key = process.env.HEYGEN_API_KEY
  return key ? { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' } : null
}

// Resolve the clone identity id → a renderable look (group id → first look's avatar_id).
async function resolveLook(H: any, rawId: string) {
  try {
    const g = await fetch(`https://api.heygen.com/v2/avatar_group/${rawId}/avatars`, { headers: H })
    if (g.ok) {
      const look = ((await g.json() as any)?.data?.avatar_list || [])[0]?.avatar_id
      if (look) return look
    }
  } catch {}
  return rawId
}

async function ensureVideoCols(client: any) {
  await client.query(`alter table artifact add column if not exists content text`)
  await client.query(`alter table artifact add column if not exists heygen_video_id text`)
}

// POST /api/app/artifact/{artifactId}/video — submit a clone-avatar render from
// the artifact's script; store the video_id and mark it rendering.
export async function artifactVideoGenerate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  const H = heygenHeaders()
  const avatarRaw = process.env.HEYGEN_CLONE_1_AVATAR_IDENTITY_ID
  const voiceId = process.env.HEYGEN_CLONED_VOICE_ID
  if (!H) return { status: 200, headers: HEADERS, jsonBody: { error: 'HEYGEN_API_KEY not set' } }
  if (!avatarRaw || !voiceId) return { status: 200, headers: HEADERS, jsonBody: { error: 'clone avatar/voice not configured' } }
  let client
  try {
    client = await getPgClient()
    await ensureVideoCols(client)
    const art = (await client.query(`select id, type, content from artifact where id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const script = (art.content || '').trim() || 'Hi, this is my Executive Engine intro. I lead platform modernization at scale, and I would be excited to bring that to your team.'
    const text = script.slice(0, 1500) // keep clip short

    const avatarId = await resolveLook(H, avatarRaw)
    const body = {
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
        voice: { type: 'text', input_text: text, voice_id: voiceId },
      }],
      dimension: { width: 1280, height: 720 },
    }
    const res = await fetch('https://api.heygen.com/v2/video/generate', { method: 'POST', headers: H, body: JSON.stringify(body) })
    const txt = await res.text()
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `generate HTTP ${res.status}: ${txt.slice(0, 300)}` } }
    const videoId = JSON.parse(txt)?.data?.video_id
    if (!videoId) return { status: 200, headers: HEADERS, jsonBody: { error: `no video_id: ${txt.slice(0, 200)}` } }

    await client.query(`update artifact set heygen_video_id = $1, updated_at = now() where id = $2`, [videoId, artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, videoId, status: 'processing' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/artifact/{artifactId}/video — poll status; persist the URL when done.
export async function artifactVideoStatus(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  const H = heygenHeaders()
  if (!H) return { status: 200, headers: HEADERS, jsonBody: { error: 'HEYGEN_API_KEY not set' } }
  let client
  try {
    client = await getPgClient()
    await ensureVideoCols(client)
    const art = (await client.query(`select heygen_video_id, doc_url from artifact where id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    if (art.doc_url) return { status: 200, headers: HEADERS, jsonBody: { status: 'completed', videoUrl: art.doc_url } }
    if (!art.heygen_video_id) return { status: 200, headers: HEADERS, jsonBody: { status: 'none' } }

    const r = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${art.heygen_video_id}`, { headers: H })
    if (!r.ok) return { status: 200, headers: HEADERS, jsonBody: { status: 'unknown' } }
    const d = (await r.json() as any)?.data || {}
    const status = d.status || 'processing'
    let videoUrl = d.video_url || null
    if (status === 'completed' && videoUrl) {
      await client.query(`update artifact set doc_url = $1, status = case when status = 'todo' then 'review' else status end, updated_at = now() where id = $2`, [videoUrl, artifactId])
    }
    return { status: 200, headers: HEADERS, jsonBody: { status, videoUrl, error: d.error || null } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('artifactVideoGenerate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/video', handler: artifactVideoGenerate })
app.http('artifactVideoStatus', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/video/status', handler: artifactVideoStatus })

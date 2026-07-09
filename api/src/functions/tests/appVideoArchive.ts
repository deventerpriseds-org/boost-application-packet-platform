import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleOAuthToken, HAS_GOOGLE_OAUTH } from './googleAuth'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
const ARCHIVE_FOLDER_NAME = 'Executive Engine Videos'

// Find (or create) the video-archive folder in the OAuth user's Drive.
async function findOrCreateFolder(token: string): Promise<string> {
  if (process.env.VIDEO_ARCHIVE_FOLDER_ID) return process.env.VIDEO_ARCHIVE_FOLDER_ID
  const q = encodeURIComponent(`name='${ARCHIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const find = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } })
  const found = ((await find.json() as any)?.files || [])[0]?.id
  if (found) return found
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ARCHIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  })
  const id = (await create.json() as any)?.id
  if (!id) throw new Error('could not create archive folder')
  return id
}

// POST /api/app/artifact/{artifactId}/archive — copy the artifact's HeyGen MP4 to
// Drive (permanent) and store the Drive link on the artifact.
export async function artifactArchive(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'Google OAuth not connected (needed for Drive upload)' } }
  let client
  try {
    client = await getPgClient()
    await client.query(`alter table artifact add column if not exists drive_url text`)
    const art = (await client.query(`select doc_url, drive_url, type from artifact where id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    if (art.drive_url) return { status: 200, headers: HEADERS, jsonBody: { ok: true, driveUrl: art.drive_url, note: 'already archived' } }
    if (!art.doc_url) return { status: 200, headers: HEADERS, jsonBody: { error: 'no rendered video to archive' } }

    const token = await getGoogleOAuthToken()
    const folderId = await findOrCreateFolder(token)

    // Download the MP4 (HeyGen signed URL).
    const mp4Res = await fetch(art.doc_url)
    if (!mp4Res.ok) throw new Error(`download HTTP ${mp4Res.status}`)
    const mp4 = Buffer.from(await mp4Res.arrayBuffer())

    // Multipart upload to Drive.
    const boundary = 'ee_boundary_' + Math.random().toString(36).slice(2)
    const name = `intro-video-${artifactId.slice(0, 8)}.mp4`
    const meta = JSON.stringify({ name, parents: [folderId], mimeType: 'video/mp4' })
    const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
    const body = Buffer.concat([Buffer.from(pre, 'utf8'), mp4, Buffer.from(`\r\n--${boundary}--`, 'utf8')])
    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    })
    const upText = await up.text()
    if (!up.ok) throw new Error(`upload HTTP ${up.status}: ${upText.slice(0, 200)}`)
    const uploaded = JSON.parse(upText)
    const fileId = uploaded.id
    let link = uploaded.webViewLink || `https://drive.google.com/file/d/${fileId}/view`

    // Make it link-shareable.
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      })
    } catch {}

    await client.query(`update artifact set drive_url = $1, updated_at = now() where id = $2`, [link, artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, driveUrl: link, fileId, bytes: mp4.length } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('artifactArchive', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/archive', handler: artifactArchive })

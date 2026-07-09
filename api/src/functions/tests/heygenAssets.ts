import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// diag/heygen-assets — enumerate THIS API key's own avatars so we can find how the
// cloned avatar (HEYGEN_CLONE_1_AVATAR_IDENTITY_ID) is registered: as an avatar
// group "look", a talking photo, or a plain avatar — and whether it's in this space.
export async function heygenAssets(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.HEYGEN_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'HEYGEN_API_KEY not set' } }
  const target = (process.env.HEYGEN_CLONE_1_AVATAR_IDENTITY_ID || '').toLowerCase()
  const H = { 'X-Api-Key': key, Accept: 'application/json' }

  async function get(url: string) {
    try { const r = await fetch(url, { headers: H }); const t = await r.text(); let j: any = null; try { j = JSON.parse(t) } catch {} ; return { ok: r.ok, status: r.status, json: j, text: j ? undefined : t.slice(0, 200) } }
    catch (e) { return { ok: false, error: String(e) } }
  }

  // Collect candidate id lists from the endpoints that hold custom/cloned assets.
  const groups = await get('https://api.heygen.com/v2/avatar_group.list')
  const talking = await get('https://api.heygen.com/v1/talking_photo.list')
  const avatarsV2 = await get('https://api.heygen.com/v2/avatars')

  // Flatten avatar-group looks (one call per group is heavy; just list groups + ids first).
  const groupList = groups.json?.data?.avatar_group_list || groups.json?.data?.groups || []
  const talkingList = talking.json?.data?.talking_photos || talking.json?.data || []
  const av = avatarsV2.json?.data?.avatars || []

  // Look for the target id anywhere.
  const hay = JSON.stringify({ groupList, talkingList: Array.isArray(talkingList) ? talkingList : [] }).toLowerCase()
  const foundInGroupsOrTalking = target ? hay.includes(target) : false
  const foundInPublicAvatars = target ? av.some((a: any) => (a.avatar_id || '').toLowerCase() === target) : false

  // If the target is a group id, try to fetch its looks.
  let groupLooks: any = null
  const matchGroup = groupList.find((g: any) => (g.id || g.group_id || '').toLowerCase() === target)
  if (matchGroup) {
    const gid = matchGroup.id || matchGroup.group_id
    groupLooks = await get(`https://api.heygen.com/v2/avatar_group/${gid}/avatars`)
  }

  return {
    status: 200, headers: HEADERS,
    jsonBody: {
      targetIdMasked: target ? `${target.slice(0, 8)}…` : null,
      foundInGroupsOrTalking, foundInPublicAvatars,
      counts: { avatarGroups: groupList.length, talkingPhotos: Array.isArray(talkingList) ? talkingList.length : 'n/a', publicAvatars: av.length },
      avatarGroupsSample: groupList.slice(0, 8).map((g: any) => ({ id: g.id || g.group_id, name: g.name, type: g.group_type || g.type })),
      talkingPhotosSample: (Array.isArray(talkingList) ? talkingList : []).slice(0, 8).map((t: any) => ({ id: t.talking_photo_id || t.id, name: t.talking_photo_name || t.name })),
      groupLooks: groupLooks?.json?.data || null,
      rawStatuses: { groups: groups.status, talking: talking.status, avatars: avatarsV2.status }
    }
  }
}

app.http('heygenAssets', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/heygen-assets', handler: heygenAssets })

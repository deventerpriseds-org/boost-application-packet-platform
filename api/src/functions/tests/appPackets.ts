import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'
import { getGoogleOAuthToken, HAS_GOOGLE_OAUTH } from './googleAuth'
import { logUsage } from './usageMeter'
import { metaFor, varsForType, copyTemplate, injectValues, stripLeftoverTokens, shareAnyone } from './packetTemplates'
import { buildPackageForJD } from './pipeline'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const DEMO_EMAIL = 'demo@executive-engine.local'
// Artifact types a packet is built from (matches the schema CHECK constraint).
const ARTIFACT_TYPES = ['resume', 'compact_resume', 'cover', 'portfolio', 'video']
const ARTIFACT_STATUSES = ['todo', 'drafting', 'review', 'changes', 'approved']

// Ensure the artifact table can hold generated text (idempotent; safe on every call).
async function ensureContentColumn(client: any) {
  await client.query(`alter table artifact add column if not exists content text`)
  await client.query(`alter table artifact add column if not exists drive_url text`)
}

// Load (or lazily create) a packet + its 5 artifact rows for an opportunity.
async function loadPacket(client: any, oppId: string) {
  let pkt = (await client.query(`select * from packet where opp_id = $1 order by round desc limit 1`, [oppId])).rows[0]
  if (!pkt) {
    pkt = (await client.query(`insert into packet (opp_id) values ($1) returning *`, [oppId])).rows[0]
  }
  const existing = (await client.query(`select type from artifact where packet_id = $1`, [pkt.id])).rows.map((r: any) => r.type)
  const missing = ARTIFACT_TYPES.filter((t) => !existing.includes(t))
  for (const t of missing) {
    await client.query(`insert into artifact (packet_id, type) values ($1, $2)`, [pkt.id, t])
  }
  const artifacts = (await client.query(`select id, type, status, template_id, doc_url, content, drive_url, updated_at from artifact where packet_id = $1`, [pkt.id])).rows
  // Canonical ordering
  artifacts.sort((a: any, b: any) => ARTIFACT_TYPES.indexOf(a.type) - ARTIFACT_TYPES.indexOf(b.type))
  return { pkt, artifacts }
}

// Recompute packet.status from its artifacts' states.
async function recomputePacket(client: any, packetId: string) {
  const arts = (await client.query(`select status from artifact where packet_id = $1`, [packetId])).rows
  const allApproved = arts.length > 0 && arts.every((a: any) => a.status === 'approved')
  const anyStarted = arts.some((a: any) => a.status !== 'todo')
  const status = allApproved ? 'ready' : anyStarted ? 'review' : 'building'
  await client.query(`update packet set status = $1, updated_at = now() where id = $2`, [status, packetId])
  return status
}

function packetShape(pkt: any, artifacts: any[]) {
  return {
    id: pkt.id, oppId: pkt.opp_id, status: pkt.status, round: pkt.round,
    jdAnalyzed: pkt.jd_analyzed, coveredKw: pkt.covered_kw || [], atsScore: pkt.ats_score,
    approved: artifacts.filter((a) => a.status === 'approved').length, total: artifacts.length,
    artifacts: artifacts.map((a) => ({ id: a.id, type: a.type, status: a.status, templateId: a.template_id, docUrl: a.doc_url, driveUrl: a.drive_url, content: a.content, updatedAt: a.updated_at }))
  }
}

// GET /api/app/opportunity/{id}/packet — packet + artifacts (created on first access)
export async function packetGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    client = await getPgClient()
    await ensureContentColumn(client)
    const opp = (await client.query(`select id, company, role from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const { pkt, artifacts } = await loadPacket(client, oppId)
    return { status: 200, headers: HEADERS, jsonBody: { company: opp.company, role: opp.role, ...packetShape(pkt, artifacts) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/packets?owner= — all packets (one row per opp that has a packet) for the list view
export async function packetsList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = req.query.get('owner') || DEMO_EMAIL
  const includeDemo = req.query.get('includeDemo') !== 'false'
  let client
  try {
    client = await getPgClient()
    const rows = (await client.query(
      `select p.id, p.opp_id, p.status, p.ats_score, o.company, o.role, o.match_score, o.stage,
              count(a.*) filter (where a.status = 'approved') as approved,
              count(a.*) as total
         from packet p
         join opportunity o on o.id = p.opp_id
         left join artifact a on a.packet_id = p.id
        where o.owner_email = $1 and not o.dismissed ${includeDemo ? '' : 'and not o.is_demo'}
        group by p.id, o.company, o.role, o.match_score, o.stage
        order by o.match_score desc nulls last`, [owner]
    )).rows
    return { status: 200, headers: HEADERS, jsonBody: { count: rows.length, packets: rows.map((r: any) => ({
      id: r.id, oppId: r.opp_id, company: r.company, role: r.role, match: r.match_score, stage: r.stage,
      status: r.status, atsScore: r.ats_score, approved: Number(r.approved), total: Number(r.total)
    })) } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

const ARTIFACT_BRIEF: Record<string, string> = {
  resume: 'a keyword-tailored executive resume (summary + 3 impact bullets) targeting this role',
  compact_resume: 'a one-page compact resume headline + 4 tight achievement bullets',
  cover: 'a concise, specific cover letter (3 short paragraphs) tailored to this company and role',
  portfolio: 'a portfolio one-pager outline: 3 case studies mapped to this role\'s likely pain points',
  video: 'a 90-second intro video script (spoken, first person) opening tailored to this company'
}

// POST /api/app/artifact/{artifactId}/generate — draft content for one artifact via OpenAI
export async function artifactGenerate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    client = await getPgClient()
    await ensureContentColumn(client)
    const art = (await client.query(`select a.*, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, persona_key from opportunity where id = $1`, [art.opp_id])).rows[0]
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }

    const brief = ARTIFACT_BRIEF[art.type] || 'a tailored application asset'
    const system = `You are an executive career strategist writing polished application assets. Write ${brief}. Be specific, results-oriented, and grounded in the provided opportunity. Output plain text only (no markdown headers).`
    const user = `ROLE: ${opp.role} at ${opp.company}\nComp: ${opp.comp_range || 'n/a'}\nPersona: ${opp.persona_key}\nWhy surfaced: ${opp.why_surfaced || 'n/a'}\nCompany signals: ${(opp.company_signals || []).join('; ') || 'n/a'}\nPain hypotheses: ${(opp.pain_hypotheses || []).join('; ') || 'n/a'}\n\nWrite the asset now.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200 })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    await logUsage(`packet:${art.type}`, 'gpt-4o-mini', data.usage)

    await client.query(
      `update artifact set content = $1, status = 'review',
         version_history = coalesce(version_history, '[]'::jsonb) || jsonb_build_object('len', $2::int),
         updated_at = now() where id = $3`,
      [content, content.length, artifactId]
    )
    const status = await recomputePacket(client, art.packet_id)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, artifactStatus: 'review', packetStatus: status, content, promptSentToAI: { model: 'gpt-4o-mini', system, user } } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/artifact/{artifactId}/status { status } — advance the artifact state machine
export async function artifactStatus(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    const body = await req.json() as any
    const status = body?.status
    if (!ARTIFACT_STATUSES.includes(status)) return { status: 400, headers: HEADERS, jsonBody: { error: `invalid status; one of ${ARTIFACT_STATUSES.join(', ')}` } }
    client = await getPgClient()
    const art = (await client.query(`update artifact set status = $1, updated_at = now() where id = $2 returning packet_id`, [status, artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const packetStatus = await recomputePacket(client, art.packet_id)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, artifactStatus: status, packetStatus } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Find (or create) a Drive folder by name under the OAuth user's My Drive.
async function findOrCreateFolder(token: string, name: string): Promise<string> {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)
  const find = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } })
  if (find.ok) { const id = (((await find.json()) as any)?.files || [])[0]?.id; if (id) return id }
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
  })
  const j = (await create.json()) as any
  if (!create.ok) throw new Error(`folder create HTTP ${create.status}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.id
}

const DOC_TITLE: Record<string, string> = {
  resume: 'Resume', compact_resume: 'Compact Resume', cover: 'Cover Letter', portfolio: 'Portfolio One-Pager',
}

// Cache the assembled package on the packet so building resume + cover +
// portfolio shares ONE 3-agent generation (unless regen is requested).
async function ensurePkgColumn(client: any) {
  await client.query(`alter table packet add column if not exists pkg_json jsonb`)
}

// G6 — build a real artifact by COPYING its template and filling {{placeholders}}
// with the proven pipeline package (assemblePackage). Returns null if the type
// has no template (caller falls back to the legacy prose path).
async function buildTemplatedArtifact(client: any, art: any, opp: any, regen: boolean) {
  const meta = metaFor(art.type)
  if (!meta) return null
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  await ensurePkgColumn(client)
  const pkt = (await client.query(`select pkg_json from packet where id = $1`, [art.packet_id])).rows[0]
  let pkg: Record<string, string | null> | null = (!regen && pkt?.pkg_json) ? pkt.pkg_json : null
  if (!pkg) {
    const roleType = opp.persona_key || opp.role || 'Executive'
    const jd = [`${opp.role} at ${opp.company}.`, opp.comp_range ? `Comp: ${opp.comp_range}.` : '',
      opp.why_surfaced || '', (opp.company_signals || []).length ? `Company signals: ${(opp.company_signals || []).join('; ')}.` : '',
      (opp.pain_hypotheses || []).length ? `Pain hypotheses: ${(opp.pain_hypotheses || []).join('; ')}.` : ''].filter(Boolean).join(' ')
    const built = await buildPackageForJD({ key, jd, roleType, company: opp.company, jobTitle: opp.role })
    pkg = built.pkg
    await logUsage(`packet:${art.type}:generate`, 'gpt-4o-mini', {})
    await client.query(`update packet set pkg_json = $1, updated_at = now() where id = $2`, [JSON.stringify(pkg), art.packet_id])
  }

  const token = await getGoogleOAuthToken()
  const name = `${opp.company || 'Opportunity'} — ${meta.kindLabel}`
  const id = await copyTemplate(token, meta.templateId, name)
  await injectValues(token, id, varsForType(art.type, pkg), meta.isSlides)
  const cleaned = await stripLeftoverTokens(token, id, meta.isSlides)
  await shareAnyone(token, id)
  const url = meta.isSlides ? `https://docs.google.com/presentation/d/${id}/edit` : `https://docs.google.com/document/d/${id}/edit`

  // Store a readable preview of what was injected + the doc url.
  const preview = meta.placeholders.map((p) => (pkg![p] ? `${p}:\n${pkg![p]}` : '')).filter(Boolean).join('\n\n')
  await client.query(`update artifact set doc_url = $1, content = coalesce(nullif(content,''), $2), status = case when status = 'todo' then 'review' else status end, updated_at = now() where id = $3`, [url, preview, art.id])
  return { url, isSlides: meta.isSlides, cleaned, kindLabel: meta.kindLabel, title: name }
}

// POST /api/app/artifact/{artifactId}/document — turn the generated text into a
// real, shareable Google Doc (Drive create → insert content → anyone-reader).
// Stores the doc URL on artifact.doc_url. 'video' artifacts use the HeyGen path.
export async function artifactDocument(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_REFRESH_TOKEN not set — run the Google consent flow first (owns Drive quota).' } }
    client = await getPgClient()
    await ensureContentColumn(client)
    const art = (await client.query(`select a.*, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    if (art.type === 'video') return { status: 400, headers: HEADERS, jsonBody: { error: 'video artifacts are rendered via the HeyGen video action, not a document' } }
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, persona_key from opportunity where id = $1`, [art.opp_id])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }

    // G6: if this type has a designed template, COPY it and fill placeholders.
    if (metaFor(art.type)) {
      const regen = ((await req.json().catch(() => ({}))) as any)?.regen === true
      const built = await buildTemplatedArtifact(client, art, opp, regen)
      const packetStatus = await recomputePacket(client, art.packet_id)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, docUrl: built!.url, deckUrl: built!.isSlides ? built!.url : undefined, title: built!.title, cleanedTokens: built!.cleaned, templated: true, packetStatus } }
    }

    if (!art.content || !art.content.trim()) return { status: 400, headers: HEADERS, jsonBody: { error: 'generate the content first, then create the document' } }

    const token = await getGoogleOAuthToken()
    const folderId = await findOrCreateFolder(token, 'Executive Engine Packets')
    const title = `${opp?.company || 'Opportunity'} — ${DOC_TITLE[art.type] || art.type}`

    // 1. Create an empty Google Doc in the packets folder.
    const created = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId] })
    })
    const cj = (await created.json()) as any
    if (!created.ok) throw new Error(`Doc create HTTP ${created.status}: ${JSON.stringify(cj).slice(0, 200)}`)
    const docId = cj.id

    // 2. Insert the generated text at the start of the document.
    const upd = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: art.content } }] })
    })
    if (!upd.ok) throw new Error(`Docs insert HTTP ${upd.status}: ${(await upd.text()).slice(0, 200)}`)

    // 3. Make it viewable by anyone with the link.
    await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`
    await client.query(`update artifact set doc_url = $1, updated_at = now() where id = $2`, [docUrl, artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, docUrl, title } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Split generated prose into up to N slide-sized sections: each slide gets a
// short title (first line/sentence) and the rest as body.
function toSlideSections(content: string, max = 4): { title: string; body: string }[] {
  const chunks = content.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean).slice(0, max)
  return chunks.map((chunk, i) => {
    const firstLine = chunk.split('\n')[0].replace(/^[#*\-\d.\s]+/, '').trim()
    const short = firstLine.length <= 70 ? firstLine : firstLine.slice(0, 67) + '…'
    const body = chunk.slice(chunk.indexOf('\n') + 1).trim() || chunk
    // If the chunk was a single line, keep it as body under a generic title.
    if (!chunk.includes('\n')) return { title: ['Overview', 'Impact', 'Approach', 'Fit'][i] || 'Highlights', body: chunk }
    return { title: short, body }
  })
}

// POST /api/app/artifact/{artifactId}/slides — turn the portfolio text into a
// real Google Slides deck (title slide + section slides), anyone-with-link
// reader. Stores the deck URL on artifact.doc_url.
export async function artifactSlides(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_REFRESH_TOKEN not set — run the Google consent flow first.' } }
    client = await getPgClient()
    await ensureContentColumn(client)
    const art = (await client.query(`select a.*, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, persona_key from opportunity where id = $1`, [art.opp_id])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }

    // G6: COPY the designed Slides template and fill its placeholders.
    if (metaFor(art.type)) {
      const regen = ((await req.json().catch(() => ({}))) as any)?.regen === true
      const built = await buildTemplatedArtifact(client, art, opp, regen)
      const packetStatus = await recomputePacket(client, art.packet_id)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, deckUrl: built!.url, docUrl: built!.url, title: built!.title, cleanedTokens: built!.cleaned, templated: true, packetStatus } }
    }

    if (!art.content || !art.content.trim()) return { status: 400, headers: HEADERS, jsonBody: { error: 'generate the content first, then create the deck' } }

    const token = await getGoogleOAuthToken()
    const folderId = await findOrCreateFolder(token, 'Executive Engine Packets')
    const title = `${opp?.company || 'Opportunity'} — Portfolio`

    // 1. Create the presentation in the packets folder (Drive scope).
    const created = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.presentation', parents: [folderId] })
    })
    const cj = (await created.json()) as any
    if (!created.ok) throw new Error(`Slides create HTTP ${created.status}: ${JSON.stringify(cj).slice(0, 200)}`)
    const presId = cj.id

    // 2. Find the default slide so we can drop it after adding our own.
    const pres = await fetch(`https://slides.googleapis.com/v1/presentations/${presId}`, { headers: { Authorization: `Bearer ${token}` } })
    const pj = (await pres.json()) as any
    if (!pres.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `Slides read HTTP ${pres.status}: ${JSON.stringify(pj).slice(0, 200)}`, hint: pres.status === 403 ? 'The Google OAuth token needs the presentations scope — re-run consent with https://www.googleapis.com/auth/presentations.' : undefined } }
    const defaultSlideId = pj?.slides?.[0]?.objectId

    // 3. Build a title slide + one slide per section via batchUpdate.
    const sections = toSlideSections(art.content, 4)
    const requests: any[] = []
    // Title slide
    requests.push({ createSlide: { objectId: 's_title', slideLayoutReference: { predefinedLayout: 'TITLE' }, placeholderIdMappings: [
      { layoutPlaceholder: { type: 'CENTERED_TITLE' }, objectId: 'p_title' },
      { layoutPlaceholder: { type: 'SUBTITLE' }, objectId: 'p_sub' },
    ] } })
    requests.push({ insertText: { objectId: 'p_title', text: `${opp?.company || ''} — Portfolio` } })
    requests.push({ insertText: { objectId: 'p_sub', text: opp?.role || '' } })
    // Section slides
    sections.forEach((s, i) => {
      const tId = `title_${i}`, bId = `body_${i}`
      requests.push({ createSlide: { objectId: `slide_${i}`, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' }, placeholderIdMappings: [
        { layoutPlaceholder: { type: 'TITLE' }, objectId: tId },
        { layoutPlaceholder: { type: 'BODY' }, objectId: bId },
      ] } })
      requests.push({ insertText: { objectId: tId, text: s.title } })
      requests.push({ insertText: { objectId: bId, text: s.body.slice(0, 1800) } })
    })
    // Remove the empty default slide last.
    if (defaultSlideId) requests.push({ deleteObject: { objectId: defaultSlideId } })

    const upd = await fetch(`https://slides.googleapis.com/v1/presentations/${presId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests })
    })
    if (!upd.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `Slides batchUpdate HTTP ${upd.status}: ${(await upd.text()).slice(0, 300)}` } }

    // 4. Anyone-with-link reader.
    await fetch(`https://www.googleapis.com/drive/v3/files/${presId}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })

    const deckUrl = `https://docs.google.com/presentation/d/${presId}/edit`
    await client.query(`update artifact set doc_url = $1, updated_at = now() where id = $2`, [deckUrl, artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, deckUrl, slides: sections.length + 1, title } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

const SELF_BASE = process.env.COACH_SELF_BASE || 'https://job-platform-api.azurewebsites.net/api'
async function selfPost(path: string, body: any): Promise<any> {
  try {
    const r = await fetch(`${SELF_BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    return await r.json().catch(() => ({}))
  } catch (e) { return { error: String(e) } }
}

// POST /api/app/opportunity/{id}/packet/build-all — build the ENTIRE packet in one
// call: every templated artifact (resume + compact Docs, cover + portfolio Slides)
// as real Google files, sharing one generation. Optionally seed the cadence and
// DRAFT (never send) a cold email. This is the "make it start to finish" endpoint.
export async function packetBuildAll(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const owner = req.query.get('owner') || DEMO_EMAIL
  let body: any = {}; try { body = await req.json() } catch {}
  let client
  try {
    if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_REFRESH_TOKEN not set' } }
    client = await getPgClient(); await ensureContentColumn(client)
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, persona_key from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const { pkt, artifacts } = await loadPacket(client, oppId)
    const results: any[] = []
    for (const a of artifacts) {
      if (!metaFor(a.type)) continue // skip video (HeyGen) + non-templated
      try {
        const built = await buildTemplatedArtifact(client, { ...a, packet_id: pkt.id, opp_id: oppId }, opp, false)
        results.push({ type: a.type, url: built!.url, cleanedTokens: built!.cleaned })
      } catch (e) { results.push({ type: a.type, error: String(e) }) }
    }
    const packetStatus = await recomputePacket(client, pkt.id)
    let cadenceSeeded = false, outreachDrafted = false
    if (body?.seedCadence === true) { const r = await selfPost(`app/opportunity/${oppId}/cadence?owner=${encodeURIComponent(owner)}`, {}); cadenceSeeded = !r?.error }
    if (body?.draftOutreach === true) { const r = await selfPost(`app/opportunity/${oppId}/outreach/generate?owner=${encodeURIComponent(owner)}`, { channel: 'coldEmail' }); outreachDrafted = !r?.error }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, company: opp.company, artifacts: results, packetStatus, cadenceSeeded, outreachDrafted, sent: false, note: 'Packet built. Nothing was sent.' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/jd-analysis — JD/ATS analysis: keywords, must-haves,
// ATS score, gaps. Stores on the packet (jd_analyzed, ats_score, covered_kw).
export async function jdAnalysis(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient(); await ensureContentColumn(client)
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const { pkt } = await loadPacket(client, oppId)
    const system = 'You are an ATS/JD analyst. Return ONLY JSON: {"keywords":[],"mustHaves":[],"atsScore":<0-100 int>,"gaps":[]}. keywords = ATS keywords for this role; mustHaves = hard requirements; gaps = likely gaps for a senior exec candidate.'
    const user = `Role: ${opp.role} at ${opp.company}\nComp: ${opp.comp_range || 'n/a'}\nContext: ${opp.why_surfaced || ''}\nSignals: ${(opp.company_signals || []).join('; ')}\nPains: ${(opp.pain_hypotheses || []).join('; ')}`
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 900 }) })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
    const data = await res.json() as any
    let a: any = {}; try { a = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch {}
    await logUsage('packet:jd-analysis', 'gpt-4o-mini', data.usage)
    const kws = Array.isArray(a.keywords) ? a.keywords.map(String) : []
    const ats = Number.isFinite(a.atsScore) ? Math.round(a.atsScore) : null
    await client.query(`update packet set jd_analyzed = true, ats_score = $1, covered_kw = $2, updated_at = now() where id = $3`, [ats, kws, pkt.id])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, analysis: { keywords: kws, mustHaves: a.mustHaves || [], atsScore: ats, gaps: a.gaps || [] } } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/enrich — company signals, stakeholders, pain
// hypotheses. Updates the opportunity.
export async function opportunityEnrich(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()
    const opp = (await client.query(`select company, role, why_surfaced from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const system = 'You are a go-to-market researcher. Return ONLY JSON: {"companySignals":[],"stakeholders":[],"painHypotheses":[]}. companySignals = recent, plausible company signals; stakeholders = likely hiring stakeholders (title level); painHypotheses = the pains this hire likely solves.'
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: `Company: ${opp.company}\nRole: ${opp.role}\nContext: ${opp.why_surfaced || ''}` }], max_tokens: 800 }) })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
    const data = await res.json() as any
    let a: any = {}; try { a = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch {}
    await logUsage('opportunity:enrich', 'gpt-4o-mini', data.usage)
    const signals = Array.isArray(a.companySignals) ? a.companySignals.map(String) : []
    const pains = Array.isArray(a.painHypotheses) ? a.painHypotheses.map(String) : []
    await client.query(`update opportunity set company_signals = $1, pain_hypotheses = $2, updated_at = now() where id = $3`, [signals, pains, oppId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, enrichment: { companySignals: signals, stakeholders: a.stakeholders || [], painHypotheses: pains } } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('packetGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet', handler: packetGet })
app.http('packetsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packets', handler: packetsList })
app.http('packetBuildAll', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet/build-all', handler: packetBuildAll })
app.http('jdAnalysis', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/jd-analysis', handler: jdAnalysis })
app.http('opportunityEnrich', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/enrich', handler: opportunityEnrich })
app.http('artifactGenerate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/generate', handler: artifactGenerate })
app.http('artifactStatus', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/status', handler: artifactStatus })
app.http('artifactDocument', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/document', handler: artifactDocument })
app.http('artifactSlides', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/slides', handler: artifactSlides })

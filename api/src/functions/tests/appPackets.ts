import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

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
        where o.owner_email = $1 and not o.dismissed
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

app.http('packetGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet', handler: packetGet })
app.http('packetsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packets', handler: packetsList })
app.http('artifactGenerate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/generate', handler: artifactGenerate })
app.http('artifactStatus', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/status', handler: artifactStatus })

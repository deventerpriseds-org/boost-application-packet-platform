import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { logUsage } from './usageMeter'

// G3 Phase B (structured apply) + Phase C (ATS match score).
// - match-score: keyword match-rate + gap list per opportunity (Jobscan-style),
//   grounded in the candidate master context; stored on opportunity.match_score.
// - apply/prepare: draft the application answer set (Greenhouse questions when the
//   opp is a Greenhouse posting, else the universal set) + attach the tailored
//   resume/cover doc links; attempt a real Greenhouse submit only if an API key is
//   configured, otherwise return a ready-to-submit handoff. NEVER sends outreach.

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING

async function masterContextSummary(): Promise<string> {
  if (!CONN) return ''
  try {
    const ctx = TableClient.fromConnectionString(CONN, 'MasterContext')
    let mc: any = {}
    for await (const e of ctx.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e
    // Pull a compact profile from whatever fields exist.
    const parts = Object.entries(mc).filter(([k]) => !k.startsWith('_') && !['partitionKey', 'rowKey', 'etag', 'timestamp'].includes(k))
      .map(([k, v]) => `${k}: ${String(v).slice(0, 300)}`).slice(0, 12)
    return parts.join('\n')
  } catch { return '' }
}

async function openaiJson(system: string, user: string, feature: string, maxTokens = 1000): Promise<any> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens }),
  })
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
  const data = await res.json() as any
  await logUsage(feature, 'gpt-4o-mini', data.usage)
  try { return JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch { return {} }
}

// POST /api/app/opportunity/{id}/match-score — Phase C.
export async function matchScore(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    client = await getPgClient()
    const o = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses from opportunity where id = $1`, [oppId])).rows[0]
    if (!o) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const mc = await masterContextSummary()
    const system = 'You are an ATS match analyst (Jobscan-style). Return ONLY JSON: {"matchRate":<0-100 int>,"matched":[],"gaps":[],"summary":""}. matchRate = how well the candidate matches this role; matched = the candidate strengths that map to the role; gaps = missing/weak keywords to address.'
    const user = `ROLE: ${o.role} at ${o.company}\nComp: ${o.comp_range || 'n/a'}\nContext: ${o.why_surfaced || ''}\nSignals: ${(o.company_signals || []).join('; ')}\nPains: ${(o.pain_hypotheses || []).join('; ')}\n\nCANDIDATE MASTER CONTEXT:\n${mc || '(a senior technology/product executive)'}`
    const a = await openaiJson(system, user, 'ats:match-score', 900)
    const rate = Number.isFinite(a.matchRate) ? Math.max(0, Math.min(100, Math.round(a.matchRate))) : null
    if (rate != null) await client.query(`update opportunity set match_score = $1, updated_at = now() where id = $2`, [rate, oppId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, matchRate: rate, matched: a.matched || [], gaps: a.gaps || [], summary: a.summary || '' } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

// Parse a Greenhouse board + job id from a posting URL (best-effort).
function parseGreenhouse(url: string): { board: string; jobId: string } | null {
  if (!url) return null
  let m = url.match(/greenhouse\.io\/(?:embed\/job_app\?token=|.*?boards[.-]?[a-z]*\.greenhouse\.io\/)?([a-z0-9_-]+)\/jobs\/(\d+)/i)
  if (m) return { board: m[1], jobId: m[2] }
  m = url.match(/greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i)
  if (m) return { board: m[1], jobId: m[2] }
  const jid = url.match(/[?&]gh_jid=(\d+)/)
  const bd = url.match(/boards\.greenhouse\.io\/([a-z0-9_-]+)/i)
  if (jid && bd) return { board: bd[1], jobId: jid[1] }
  return null
}

// POST /api/app/opportunity/{id}/apply/prepare — Phase B.
// body { board?, jobId?, style? } — override the parsed Greenhouse ref if needed.
export async function applyPrepare(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    const body = await req.json().catch(() => ({})) as any
    client = await getPgClient()
    const o = (await client.query(`select company, role, comp_range, location, source, why_surfaced from opportunity where id = $1`, [oppId])).rows[0]
    if (!o) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    // Tailored resume/cover doc links from the packet, if built.
    const docs = (await client.query(
      `select a.type, a.doc_url from artifact a join packet p on p.id = a.packet_id where p.opp_id = $1 and a.doc_url is not null`, [oppId])).rows
    const profile = `Applying for ${o.role} at ${o.company} (${o.location || 'n/a'}). Comp target: ${o.comp_range || 'n/a'}. Why a fit: ${o.why_surfaced || 'n/a'}. US work-authorized, no sponsorship needed, ~4 weeks notice.\n\nMASTER CONTEXT:\n${await masterContextSummary()}`
    const style = ['Concise', 'Detailed', 'STAR'].includes(body?.style) ? body.style : 'Concise'

    // If this is a Greenhouse posting, map answers to the REAL application questions.
    // The Greenhouse posting URL is stored in why_surfaced ("greenhouse · board · https://…").
    const gh = body?.board && body?.jobId ? { board: String(body.board), jobId: String(body.jobId) } : parseGreenhouse(String(body?.url || o.why_surfaced || o.source || ''))
    let questions: string[] | null = null
    if (gh) {
      try {
        const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${gh.board}/jobs/${gh.jobId}?questions=true`)
        if (r.ok) { const j = await r.json() as any; questions = (j.questions || []).map((q: any) => q.label).filter(Boolean) }
      } catch { /* fall through to universal set */ }
    }

    let system: string, user: string
    if (questions && questions.length) {
      system = `You draft ${style} application answers for the exact questions below, using the candidate profile. Return ONLY JSON: {"answers":[{"question":"","answer":""}]}. Answer every question.`
      user = `QUESTIONS:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nPROFILE:\n${profile}`
    } else {
      system = `You draft the standard executive application answer set (${style}) using the candidate profile. Return ONLY JSON: {"answers":[{"question":"","answer":""}]} covering: work authorization, sponsorship, salary expectation, earliest start date, relocation/remote, "why this company", and a leadership example.`
      user = `PROFILE:\n${profile}`
    }
    const a = await openaiJson(system, user, 'ats:apply-prepare', 1600)
    const answers = Array.isArray(a.answers) ? a.answers.filter((x: any) => x.question && x.answer) : []

    // Real submit needs the company's Greenhouse API key (per-company); we don't
    // hold those, so we return a ready-to-submit handoff unless a key is present.
    const canSubmit = gh && !!process.env.GREENHOUSE_API_KEY
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, oppId, company: o.company, role: o.role, style,
        ats: gh ? { provider: 'greenhouse', board: gh.board, jobId: gh.jobId, questionsFound: (questions || []).length } : null,
        answers, documents: docs.map((d: any) => ({ type: d.type, url: d.doc_url })),
        submitted: false,
        mode: canSubmit ? 'ready-to-submit (Greenhouse API key present — submit not auto-fired; confirm to send)' : 'handoff (copy-paste ready; no per-company submit key configured)',
      }
    }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
  finally { try { await client?.end() } catch {} }
}

app.http('matchScore', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/match-score', handler: matchScore })
app.http('applyPrepare', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/apply/prepare', handler: applyPrepare })

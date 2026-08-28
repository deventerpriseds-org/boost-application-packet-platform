import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { groundingText } from './jdText'
import { logUsage } from './usageMeter'
import { loadConfig } from './mailWatch'

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
function parseGreenhouse(text: string): { board: string; jobId: string } | null {
  if (!text) return null
  let m = text.match(/greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i)
  if (m) return { board: m[1], jobId: m[2] }
  const jid = text.match(/[?&]gh_jid=(\d+)/)
  // Board from a boards.greenhouse.io URL, else from our stored "greenhouse · <board> · …".
  const bd = text.match(/boards[.-]?[a-z]*\.greenhouse\.io\/([a-z0-9_-]+)/i) || text.match(/greenhouse\s*·\s*([a-z0-9_-]+)/i)
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

// POST /api/app/answers/from-questions { questions[], company?, role?, url?, style?, owner? }
// The universal auto-apply engine: the Chrome extension reads the REAL questions off
// whatever application form the user is on and posts them here; we draft a tailored
// answer for each, in order. Works on any ATS (no per-site API needed).
export async function answersFromQuestions(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json() as any
    const questions: string[] = Array.isArray(body?.questions) ? body.questions.map((q: any) => String(q || '').slice(0, 300)).filter(Boolean) : []
    if (!questions.length) return { status: 400, headers: HEADERS, jsonBody: { error: 'questions[] required' } }
    const style = ['Concise', 'Detailed', 'STAR'].includes(body?.style) ? body.style : 'Concise'
    const company = (body?.company || '').toString()
    const role = (body?.role || '').toString()
    const profile = `Applying${role ? ` for ${role}` : ''}${company ? ` at ${company}` : ''}${body?.url ? ` (${body.url})` : ''}. US work-authorized, no sponsorship needed, ~4 weeks notice.\n\nMASTER CONTEXT:\n${await masterContextSummary()}`
    const system = `You fill a job application form. For EACH numbered question below, write a ${style}, copy-paste-ready answer using the candidate profile. Return ONLY JSON: {"answers":["...","..."]} — an array of answer STRINGS in the SAME ORDER as the questions, one per question. For yes/no or short fields answer briefly; skip nothing (use a best-effort answer, or "" only if truly not answerable).`
    const user = `QUESTIONS:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nPROFILE:\n${profile}`
    const a = await openaiJson(system, user, 'ats:autofill', 1800)
    let answers: string[] = Array.isArray(a.answers) ? a.answers.map((x: any) => String(x ?? '')) : []
    // Align length to the questions (pad/trim) so index-matching in the extension is safe.
    answers = questions.map((_, i) => answers[i] ?? '')
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, count: answers.length, answers } }
  } catch (err) { return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } } }
}

// ── Initial ATS score (spec) — JD keywords auto-matched against the master baseline ──────────────
// Design-handoff spec: "keywords auto-matched against the master baseline — ATS opens high (~84%),
// only gaps flagged red." Distinct from match_score: this scores the REAL JD (not just role/company)
// vs the candidate master baseline, and is stored in its OWN column so it never overwrites a match_score
// the owner computed by hand. Populated by a paced timer over opps that have a real JD but no ats_score.
async function ensureAtsCols(client: any) {
  await client.query(`alter table opportunity add column if not exists ats_score int`)
  await client.query(`alter table opportunity add column if not exists ats_gaps text[]`)
  await client.query(`alter table opportunity add column if not exists ats_scored_at timestamptz`)
}

// Score ONE opp's real JD against the master baseline. Stores ats_score + ats_gaps; never touches
// match_score. Returns null when there's no usable JD to score.
async function atsScoreOne(client: any, o: any, mc: string): Promise<{ atsScore: number | null; gaps: string[] } | null> {
  // Was: strip tags only. That left HTML entities encoded, so "P&L" (83 postings) matched ZERO and
  // every &-term was invisible across 71% of the corpus. groundingText decodes entities.
  const jd = groundingText(o)
  if (jd.length < 200) return null   // no real JD yet → leave for later (timer retries once JD lands)
  const system = 'You are an ATS match analyst (Jobscan-style). Compare the candidate master baseline to THIS job description and return ONLY JSON: {"atsScore":<0-100 int>,"gaps":[]}. atsScore = % of the role\'s important keywords/requirements the candidate already demonstrably covers. gaps = the specific missing/weak keywords to add. Be realistic: a strong senior match opens in the 80s.'
  const user = `JOB: ${o.role} at ${o.company}\n\nJOB DESCRIPTION:\n${jd.slice(0, 6000)}\n\nCANDIDATE MASTER BASELINE:\n${mc || '(a senior technology/product executive)'}`
  const a = await openaiJson(system, user, 'ats:auto-score', 700)
  const atsScore = Number.isFinite(a.atsScore) ? Math.max(0, Math.min(100, Math.round(a.atsScore))) : null
  const gaps = Array.isArray(a.gaps) ? a.gaps.map((s: any) => String(s)).slice(0, 12) : []
  if (atsScore != null) await client.query(`update opportunity set ats_score=$1, ats_gaps=$2, ats_scored_at=now() where id=$3`, [atsScore, gaps, o.id])
  return { atsScore, gaps }
}

// POST /api/app/ats-backfill { limit?, favoritesOnly? } — score a batch on demand.
export async function atsBackfill(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const body = (await req.json().catch(() => ({}))) as any
  const limit = Math.max(1, Math.min(50, Number(body.limit) || 20))
  const favoritesOnly = body.favoritesOnly === true
  const owner = resolveOwner(req).owner
  let client
  try {
    client = await getPgClient()
    await ensureAtsCols(client)
    const favClause = favoritesOnly ? 'and is_favorite = true' : ''
    const rows = (await client.query(
      `select id, role, company, jd_html, jd_summary, jd_requirements from opportunity
         where owner_email=$1 and not dismissed and not is_demo and ats_score is null
           and coalesce(length(jd_html),0) > 200 ${favClause}
         order by is_favorite desc, source_date desc nulls last limit $2`, [owner, limit])).rows
    const mc = await masterContextSummary()
    let scored = 0; const start = Date.now()
    for (const o of rows) {
      if (Date.now() - start > 180_000) break
      try { const r = await atsScoreOne(client, o, mc); if (r?.atsScore != null) scored++ } catch { /* skip */ }
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, candidates: rows.length, scored } }
  } catch (e) { return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } } }
  finally { try { await client?.end() } catch {} }
}

// Timer: every 5 min, score a SMALL favorites-first batch of opps that have a real JD but no ats_score.
// Self-idles when the backlog is clear (steady-state ~0). Mirrors jdBackfillTick's pacing discipline.
export async function atsBackfillTick(_t: Timer, context: InvocationContext): Promise<void> {
  let client: any
  try {
    const owner = (await loadConfig()).ownerEmail
    client = await getPgClient()
    await ensureAtsCols(client)
    const rows = (await client.query(
      `select id, role, company, jd_html, jd_summary, jd_requirements from opportunity
         where owner_email=$1 and not dismissed and not is_demo and ats_score is null
           and coalesce(length(jd_html),0) > 200
         order by is_favorite desc, source_date desc nulls last limit 4`, [owner])).rows
    if (!rows.length) { context.log('ats-backfill: backlog clear'); return }
    const mc = await masterContextSummary()
    let scored = 0
    for (const o of rows) { try { const r = await atsScoreOne(client, o, mc); if (r?.atsScore != null) scored++ } catch { /* skip */ } }
    context.log(`ats-backfill: scored ${scored}/${rows.length}`)
  } catch (e) { context.log(`ats-backfill error: ${e}`) }
  finally { try { await client?.end() } catch {} }
}

app.http('matchScore', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/match-score', handler: matchScore })
app.http('atsBackfill', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/ats-backfill', handler: atsBackfill })
app.timer('atsBackfillTick', { schedule: '0 */5 * * * *', handler: atsBackfillTick })
app.http('answersFromQuestions', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/answers/from-questions', handler: answersFromQuestions })
app.http('applyPrepare', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/apply/prepare', handler: applyPrepare })

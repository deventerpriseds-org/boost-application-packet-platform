import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

async function openaiJson(system: string, user: string, maxTokens = 1600) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, response_format: { type: 'json_object' } })
  })
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  return JSON.parse(data.choices?.[0]?.message?.content || '{}')
}

function oppGrounding(o: any) {
  return `ROLE: ${o.role} at ${o.company}\nComp: ${o.comp_range || 'n/a'}\nWhy surfaced: ${o.why_surfaced || 'n/a'}\nCompany signals: ${(o.company_signals || []).join('; ') || 'n/a'}\nPain hypotheses: ${(o.pain_hypotheses || []).join('; ') || 'n/a'}`
}

// GET /api/app/opportunity/{id}/interviews — list interview rows
export async function interviewList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    client = await getPgClient()
    const opp = (await client.query(`select company, role from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const rows = (await client.query(`select id, stage, questions, transcript, debrief, created_at from interview where opp_id = $1 order by created_at desc`, [oppId])).rows
    return { status: 200, headers: HEADERS, jsonBody: { company: opp.company, role: opp.role, interviews: rows } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/interview/prep { stage?, interviewers? }
export async function interviewPrep(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    const body = await req.json().catch(() => ({})) as any
    const stage = body?.stage || 'panel'
    const interviewers = body?.interviewers || ''
    client = await getPgClient()
    const o = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses from opportunity where id = $1`, [oppId])).rows[0]
    if (!o) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const system = 'You are an executive interview coach. Return ONLY JSON.'
    const user = `Prepare interview prep for this role.\n${oppGrounding(o)}\nStage: ${stage}. Interviewers: ${interviewers || 'unknown panel'}.\nReturn JSON: { "questions": [ { "question": "...", "strength": "strong|medium|gap", "suggestedAnswer": "..." } ], "coverageMap": [ { "theme": "...", "covered": true|false } ] }. At least 6 questions.`
    const prep = await openaiJson(system, user)
    const row = (await client.query(`insert into interview (opp_id, stage, questions) values ($1,$2,$3) returning id, stage, questions, created_at`, [oppId, stage, JSON.stringify(prep.questions || [])])).rows[0]
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, interviewId: row.id, stage, questions: prep.questions || [], coverageMap: prep.coverageMap || [] } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/interview/{interviewId}/debrief { transcript }
export async function interviewDebrief(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const interviewId = req.params.interviewId
  let client
  try {
    const body = await req.json().catch(() => ({})) as any
    const transcript = (body?.transcript || '').toString()
    if (transcript.length < 20) return { status: 400, headers: HEADERS, jsonBody: { error: 'transcript too short' } }
    client = await getPgClient()
    const iv = (await client.query(`select id from interview where id = $1`, [interviewId])).rows[0]
    if (!iv) return { status: 404, headers: HEADERS, jsonBody: { error: 'interview not found' } }
    const system = 'You are an interview debrief analyst. Return ONLY JSON.'
    const user = `Analyze this interview transcript. Return JSON: { "summary": "...", "advanceLikelihood": "high|medium|low", "perQuestionScores": [ { "question": "...", "score": 1-5, "note": "..." } ], "followUps": [ "..." ] }.\nTranscript:\n${transcript.slice(0, 6000)}`
    const debrief = await openaiJson(system, user, 1300)
    await client.query(`update interview set transcript = $1, debrief = $2 where id = $3`, [transcript, JSON.stringify(debrief), interviewId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, interviewId, debrief } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET/POST /api/app/opportunity/{id}/offer — GET current offer; POST analyzes a new one
export async function offerRoute(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  if (req.method === 'GET') {
    try {
      client = await getPgClient()
      const opp = (await client.query(`select company, role, comp_range from opportunity where id = $1`, [oppId])).rows[0]
      if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
      const offer = (await client.query(`select id, their_offer, counter, floor, benchmarks, status, updated_at from offer where opp_id = $1 order by created_at desc limit 1`, [oppId])).rows[0] || null
      return { status: 200, headers: HEADERS, jsonBody: { company: opp.company, role: opp.role, compRange: opp.comp_range, offer } }
    } catch (err) {
      return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
    } finally { try { await client?.end() } catch {} }
  }
  try {
    const body = await req.json().catch(() => ({})) as any
    const their = body?.theirOffer || {}
    const floor = body?.floor || {}
    if (their.base == null) return { status: 400, headers: HEADERS, jsonBody: { error: 'theirOffer.base required' } }
    client = await getPgClient()
    const o = (await client.query(`select company, role, comp_range from opportunity where id = $1`, [oppId])).rows[0]
    if (!o) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const system = 'You are an executive compensation negotiation advisor. Return ONLY JSON.'
    const user = `Role: ${o.role} at ${o.company}. Target range: ${o.comp_range || 'n/a'}.\nTheir offer: base $${their.base}, equity $${their.equityPerYear || 0}/yr, sign-on $${their.signOn || 0}.\nMy floor: base $${floor.base || 0}, equity $${floor.equityPerYear || 0}/yr.\nReturn JSON: { "counterDraft": "...", "compBenchmarks": [ { "metric": "...", "market": "..." } ], "leverageSummary": "...", "recommendation": "accept|counter|decline", "totalTheirs": number, "totalFloor": number }.`
    const neg = await openaiJson(system, user, 1300)
    const row = (await client.query(
      `insert into offer (opp_id, their_offer, counter, floor, benchmarks, status)
       values ($1,$2,$3,$4,$5,'countered') returning id, status, updated_at`,
      [oppId, JSON.stringify(their), JSON.stringify({ draft: neg.counterDraft, recommendation: neg.recommendation, leverageSummary: neg.leverageSummary, totalTheirs: neg.totalTheirs, totalFloor: neg.totalFloor }), JSON.stringify(floor), JSON.stringify(neg.compBenchmarks || [])]
    )).rows[0]
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, offerId: row.id, status: row.status, counterDraft: neg.counterDraft, compBenchmarks: neg.compBenchmarks || [], leverageSummary: neg.leverageSummary, recommendation: neg.recommendation, totalTheirs: neg.totalTheirs, totalFloor: neg.totalFloor } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/interview/{interviewId}/transcribe { audioBase64, mimeType? }
// Whisper speech-to-text → returns the transcript (and stores it on the row).
// The debrief step then analyzes it. Keeps audio out of the DB (transcript only).
export async function interviewTranscribe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const interviewId = req.params.interviewId
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const b64 = (body?.audioBase64 || '').toString().replace(/^data:[^;]+;base64,/, '')
    if (!b64 || b64.length < 100) return { status: 400, headers: HEADERS, jsonBody: { error: 'audioBase64 required' } }
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    const mimeType = body?.mimeType || 'audio/webm'
    const ext = mimeType.includes('mp3') || mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'webm'
    const bytes = Buffer.from(b64, 'base64')

    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mimeType }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form as any,
    })
    if (!res.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `Whisper HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` } }
    const transcript = ((await res.json()) as any)?.text || ''

    try { client = await getPgClient(); await client.query(`update interview set transcript = $1 where id = $2`, [transcript, interviewId]) } catch {}
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, interviewId, transcript, chars: transcript.length } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('interviewList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/interviews', handler: interviewList })
app.http('interviewTranscribe', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/interview/{interviewId}/transcribe', handler: interviewTranscribe })
app.http('interviewPrep', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/interview/prep', handler: interviewPrep })
app.http('interviewDebrief', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/interview/{interviewId}/debrief', handler: interviewDebrief })
app.http('offerRoute', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/offer', handler: offerRoute })

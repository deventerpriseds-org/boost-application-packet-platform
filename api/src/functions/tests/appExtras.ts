import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// POST /api/app/opportunity/{id}/answers/vision { imageBase64 }
// gpt-4o vision: detect application-form questions from a screenshot and draft
// copy-paste-ready answers grounded in the candidate's opportunity context.
export async function answersVision(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const body = await req.json().catch(() => ({})) as any
    let img = (body?.imageBase64 || '').toString()
    img = img.replace(/^data:image\/\w+;base64,/, '')
    if (img.length < 100) return { status: 400, headers: HEADERS, jsonBody: { error: 'imageBase64 required (a form screenshot)' } }
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()
    const o = (await client.query(`select company, role, comp_range, location, source, why_surfaced from opportunity where id = $1`, [oppId])).rows[0]
    if (!o) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const profile = `Candidate is applying for ${o.role} at ${o.company} (${o.location || 'n/a'}). Comp target: ${o.comp_range || 'n/a'}. Source: ${o.source || 'n/a'}. Why a fit: ${o.why_surfaced || 'n/a'}. US work-authorized, no sponsorship needed, ~4 weeks notice.`
    const instruction = `You detect application-form questions from a screenshot and draft concise, copy-paste-ready answers using the candidate profile. Return ONLY JSON: { "answers": [ { "question": "...", "answer": "..." } ] }. ${profile}`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } }
        ] }],
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    const answers = Array.isArray(parsed.answers) ? parsed.answers.filter((a: any) => a.question && a.answer) : []
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, company: o.company, role: o.role, count: answers.length, answers } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('answersVision', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/answers/vision', handler: answersVision })

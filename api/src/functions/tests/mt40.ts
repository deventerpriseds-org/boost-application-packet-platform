import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-40 — Interview prep. From a JD + interviewer list, generates likely
// questions with strength tags, suggested answers, and a coverage map.
export async function mt40(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  const jd = 'VP of Engineering at TechVenture Inc — scale a 150-person org, cloud-native SaaS, DevSecOps, M&A due diligence.'
  const interviewers = 'CTO (technical depth), CPO (product partnership), VP People (leadership & culture)'
  const system = 'You are an executive interview coach. Return ONLY JSON.'
  const user = `Prepare interview prep for this role. Return JSON: { "questions": [ { "question": "...", "strength": "strong|medium|gap", "suggestedAnswer": "..." } ], "coverageMap": [ { "theme": "...", "covered": true|false } ] }. JD: ${jd}. Interviewers: ${interviewers}. Give at least 6 questions.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1600, response_format: { type: 'json_object' } })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let prep: any = {}
    try { prep = JSON.parse(content) } catch {}
    const qCount = Array.isArray(prep.questions) ? prep.questions.length : 0
    const covCount = Array.isArray(prep.coverageMap) ? prep.coverageMap.length : 0
    const pass = qCount >= 6 && covCount >= 1
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass ? `Generated ${qCount} likely questions with strength tags + a ${covCount}-theme coverage map.` : `Incomplete — ${qCount} questions, ${covCount} coverage themes`,
        questionCount: qCount,
        prep,
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt40', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-40', handler: mt40 })

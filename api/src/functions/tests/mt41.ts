import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const SAMPLE_TRANSCRIPT = `Interviewer: Walk me through how you'd scale our platform team from 150 to 250 engineers.
Candidate: I'd start with an org design review, define clear charters, and invest in staff-plus leadership before hiring ICs...
Interviewer: How do you approach DevSecOps and SOC 2 in a fast-moving org?
Candidate: I embed security in the SDLC with automated gates and a security champions program...
Interviewer: Tell me about a time an M&A technical due diligence surfaced a major risk.
Candidate: During an acquisition I found an unscalable monolith and untracked data flows; I built a 90-day remediation plan...`

// MT-41 — Interview debrief. From a transcript, generates an AI summary,
// per-question scores, and owed follow-ups — the spec's debrief contract.
export async function mt41(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  let transcript = SAMPLE_TRANSCRIPT
  try { const b = await req.json() as any; if (b?.transcript) transcript = String(b.transcript) } catch {}

  const system = 'You are an interview debrief analyst. Return ONLY JSON.'
  const user = `Analyze this interview transcript. Return JSON: { "summary": "...", "advanceLikelihood": "high|medium|low", "perQuestionScores": [ { "question": "...", "score": 1-5, "note": "..." } ], "followUps": [ "..." ] }. Transcript:\n${transcript}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200, response_format: { type: 'json_object' } })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let debrief: any = {}
    try { debrief = JSON.parse(content) } catch {}
    const scores = Array.isArray(debrief.perQuestionScores) ? debrief.perQuestionScores.length : 0
    const pass = !!debrief.summary && scores >= 2 && Array.isArray(debrief.followUps)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass ? `Debrief: ${scores} scored questions, advance-likelihood ${debrief.advanceLikelihood}, ${debrief.followUps.length} follow-ups.` : `Incomplete debrief — summary=${!!debrief.summary}, scores=${scores}`,
        debrief,
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt41', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-41', handler: mt41 })

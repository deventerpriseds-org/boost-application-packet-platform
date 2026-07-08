import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { FORM_SCREENSHOT_B64 } from './visionFixtures'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-36 — Application-answers autofill via gpt-4o vision. Sends an application
// FORM screenshot, detects the questions, and drafts a copy-paste-ready answer
// per field. Proves the "Application Answers autofill" spec feature.
export async function mt36(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  let imageB64 = FORM_SCREENSHOT_B64
  try { const b = await req.json() as any; if (b?.imageB64) imageB64 = String(b.imageB64) } catch {}

  const profile = 'Candidate: senior engineering executive, US work-authorized, no sponsorship needed, desired base $400k, can start in 6 weeks, open to relocation, 20+ years leadership.'
  const instruction = `You detect application-form questions from a screenshot and draft concise, copy-paste-ready answers using the candidate profile. Return ONLY JSON: { "answers": [ { "question": "...", "answer": "..." } ] }. ${profile}`
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageB64}` } }
        ] }],
        max_tokens: 900,
        response_format: { type: 'json_object' }
      })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let parsed: any = {}
    try { parsed = JSON.parse(content) } catch {}
    const answers = Array.isArray(parsed.answers) ? parsed.answers : []
    const filled = answers.filter((a: any) => a.question && a.answer).length
    const pass = filled >= 4
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Vision detected and answered ${filled} application questions from the form screenshot.`
          : `Only ${filled} question/answer pairs detected (need ≥4)`,
        answers,
        model: 'gpt-4o (vision)',
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt36', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-36', handler: mt36 })

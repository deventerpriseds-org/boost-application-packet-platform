import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { JD_SCREENSHOT_B64 } from './visionFixtures'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-35 — JD/ATS analysis via gpt-4o vision. Sends a job-description SCREENSHOT
// (image) to gpt-4o and expects structured ATS analysis: keywords, must-haves,
// ATS score, gaps. Proves the vision capability the spec's JD/ATS step needs.
export async function mt35(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  let imageB64 = JD_SCREENSHOT_B64
  try { const b = await req.json() as any; if (b?.imageB64) imageB64 = String(b.imageB64) } catch {}

  const instruction = 'You are an ATS analyst. Read this job-description screenshot and return ONLY JSON with keys: keywords (string[]), mustHaves (string[]), atsScore (0-100 estimate of how ATS-critical this role is to match), gaps (string[] of likely resume gaps for a generic executive). Return only the JSON object.'
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
        max_tokens: 800,
        response_format: { type: 'json_object' }
      })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let analysis: any = {}
    try { analysis = JSON.parse(content) } catch {}

    const kwCount = Array.isArray(analysis.keywords) ? analysis.keywords.length : 0
    const mhCount = Array.isArray(analysis.mustHaves) ? analysis.mustHaves.length : 0
    const pass = kwCount >= 3 && mhCount >= 1
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Vision read the JD screenshot: ${kwCount} keywords, ${mhCount} must-haves, ATS score ${analysis.atsScore}.`
          : `Vision analysis incomplete — ${kwCount} keywords, ${mhCount} must-haves`,
        analysis,
        model: 'gpt-4o (vision)',
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt35', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-35', handler: mt35 })

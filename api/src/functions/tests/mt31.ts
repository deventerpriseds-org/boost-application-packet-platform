import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const SAMPLE_ALERT = `From: jobalerts@linkedin.com
Subject: New job alert: VP of Engineering at TechVenture Inc

Hi Von, here are new roles matching "VP Engineering":

VP of Engineering — TechVenture Inc (San Francisco, CA · Hybrid)
$380,000–$450,000 + equity
Posted by Dana Lee, Head of Talent
Lead a 150-person global engineering org building a cloud-native SaaS platform.
Apply: https://linkedin.com/jobs/view/vp-engineering-techventure-12345`

// MT-31 — Parse alert. Raw job-alert email text -> structured Opportunity JSON.
// Mirrors the spec's "Parse alert" AI contract (gpt-4o-mini).
export async function mt31(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  let alertText = SAMPLE_ALERT
  try { const b = await req.json() as any; if (b?.alertText) alertText = String(b.alertText) } catch {}

  const system = 'You extract structured job opportunities from raw job-alert emails. Return ONLY valid JSON.'
  const user = `Extract this job alert into JSON with keys: company, role, location, compRange, sourcePlatform, applyUrl, hiringManager, recruiter (use null if absent). Return only the JSON object.\n\nEMAIL:\n${alertText}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 500, response_format: { type: 'json_object' } })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let opp: any = {}
    try { opp = JSON.parse(content) } catch {}

    const required = ['company', 'role', 'location', 'compRange', 'applyUrl']
    const missing = required.filter((f) => !opp[f])
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: missing.length === 0,
        detail: missing.length === 0
          ? `Parsed opportunity: ${opp.role} @ ${opp.company} (${opp.location}), ${opp.compRange}.`
          : `Missing fields: ${missing.join(', ')}`,
        opportunity: opp,
        promptSentToAI: { model: 'gpt-4o-mini', maxTokens: 500, system, user },
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt31', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-31', handler: mt31 })

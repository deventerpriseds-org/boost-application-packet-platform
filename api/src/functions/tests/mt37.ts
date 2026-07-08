import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// Channel character limits enforced by the composer.
const LIMITS: Record<string, number> = { linkedinConnect: 300, inMail: 2000, coldEmail: 2500, followUp: 1200 }

// MT-37 — Multi-channel outreach draft. From a contact + company signals, drafts
// cold email, LinkedIn connect (≤300 chars), InMail, and a follow-up in one call,
// then asserts each respects its channel character limit.
export async function mt37(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  const contact = 'Dana Lee, Head of Talent at TechVenture Inc. Signal: posted about scaling the platform team; mutual connection Alex Rivera.'
  const system = 'You are an executive outreach writer. Return ONLY JSON.'
  const user = `Draft outreach to this contact for a VP of Engineering role. Return JSON with keys: coldEmail, linkedinConnect (MUST be <= 300 characters), inMail, followUp. Tone: warm, POV-led. Weave in the signal naturally. Contact: ${contact}`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200, response_format: { type: 'json_object' } })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || '{}'
    let msgs: any = {}
    try { msgs = JSON.parse(content) } catch {}

    const channels = ['coldEmail', 'linkedinConnect', 'inMail', 'followUp']
    const present = channels.filter((c) => typeof msgs[c] === 'string' && msgs[c].length > 0)
    const limitCheck = channels.map((c) => ({ channel: c, chars: (msgs[c] || '').length, limit: LIMITS[c], withinLimit: (msgs[c] || '').length <= LIMITS[c] }))
    const allWithin = limitCheck.every((l) => l.withinLimit)
    const pass = present.length === 4 && allWithin

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Drafted all 4 channels; LinkedIn connect ${msgs.linkedinConnect.length}/300 chars, all within limits.`
          : `Issue — ${present.length}/4 channels present; limits ok=${allWithin}`,
        channelsPresent: present,
        limitCheck,
        messages: msgs,
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt37', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-37', handler: mt37 })

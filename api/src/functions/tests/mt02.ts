import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function mt02(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set in Function App settings' } }

  const start = Date.now()
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'say "pong"' }], max_tokens: 5 })
    })
    const latency = Date.now() - start
    if (!res.ok) {
      const text = await res.text()
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` } }
    }
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || ''
    if (latency > 10000) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Timeout: ${latency}ms` } }
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Response: "${content}" — latency: ${latency}ms` } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt02', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-02', handler: mt02 })

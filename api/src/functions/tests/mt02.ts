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

  // Conversational prompt — a live model reply is required. We also inject the
  // server's current date/time so the response is grounded in real, changing
  // context that a canned answer could not reproduce.
  const now = new Date().toISOString()
  const prompt = `Hello how are you, what is the current date and time? For reference, the current UTC time is ${now}.`

  const start = Date.now()
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 120 })
    })
    const latency = Date.now() - start
    if (!res.ok) {
      const text = await res.text()
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` } }
    }
    const data = await res.json() as any
    const content = (data.choices?.[0]?.message?.content || '').trim()
    const gotReply = content.length > 0
    if (latency > 10000) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Timeout: ${latency}ms` } }
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: gotReply,
        detail: gotReply
          ? `Model replied in ${latency}ms: "${content}"`
          : 'Model returned an empty response',
        prompt,
        modelResponse: content,
        model: data.model,
        latencyMs: latency
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt02', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-02', handler: mt02 })

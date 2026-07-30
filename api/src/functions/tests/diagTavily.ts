import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

// POST /api/diag/tavily — DIAGNOSTIC. Uses Tavily's server-side fetch to get around bot-403s that
// block our sandbox WebFetch (dev.to, scrapfly, etc.). body: { urls: [...] } → Tavily /extract
// returns full page raw_content; or { q: "..." } → Tavily /search. Guarded, throwaway research aid.
export async function diagTavily(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const key = (process.env.TAVILY_API_KEY || '').trim()
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: 'TAVILY_API_KEY not set' } }
  const body = (await req.json().catch(() => ({}))) as any
  try {
    if (Array.isArray(body.urls) && body.urls.length) {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: body.urls, extract_depth: 'advanced' }),
      })
      const j = (await res.json().catch(() => ({}))) as any
      const results = (j.results || []).map((r: any) => ({ url: r.url, content: String(r.raw_content || '').slice(0, Number(body.max || 8000)) }))
      return { status: 200, headers: HEADERS, jsonBody: { ok: res.ok, status: res.status, failed: j.failed_results || [], results } }
    }
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: String(body.q || ''), search_depth: 'advanced', max_results: 8, include_answer: 'advanced', include_raw_content: true }),
    })
    const j = (await res.json().catch(() => ({}))) as any
    const results = (j.results || []).map((r: any) => ({ url: r.url, title: r.title, content: String(r.raw_content || r.content || '').slice(0, 3000) }))
    return { status: 200, headers: HEADERS, jsonBody: { ok: res.ok, status: res.status, answer: j.answer || null, results } }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  }
}

app.http('diagTavily', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/tavily', handler: diagTavily })

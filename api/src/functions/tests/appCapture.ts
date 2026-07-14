import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { insertOpp } from './mailWatch'

// G11 support — the universal-capture endpoint the Chrome extension posts to:
// "save any job page → opportunity". Normalizes a scraped page into an
// opportunity and reuses the intake embed→dedupe→insert pipeline.

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }

// POST /api/app/capture { url, title?, company?, text?, owner? }
export async function appCapture(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const body = await req.json() as any
    // Prefer the server-verified token; else the extension's configured owner
    // (body); else the shared demo workspace.
    const ro = resolveOwner(req)
    const owner = ro.verified ? ro.owner : (body?.owner || ro.owner)
    const url = (body?.url || '').toString()
    const rawTitle = (body?.title || '').toString()
    const text = (body?.text || '').toString().slice(0, 8000)
    if (!url && !rawTitle && !text) return { status: 400, headers: HEADERS, jsonBody: { error: 'need at least a url, title, or page text' } }

    // Normalize the page into a structured opportunity (best-effort via OpenAI).
    let o: any = { company: body?.company || null, role: rawTitle || null, location: null, comp: null, url }
    if (key) {
      const system = 'Extract the single job posting from this web page into JSON. Return ONLY {"company":"","role":"","location":"","comp":"","url":""}. Use null for unknown.'
      const user = `URL: ${url}\nTitle: ${rawTitle}\nCompany hint: ${body?.company || ''}\nPage text:\n${text}`
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 400 }),
      })
      if (res.ok) { try { const j = await res.json() as any; const p = JSON.parse(j.choices?.[0]?.message?.content || '{}'); o = { company: p.company || o.company, role: p.role || o.role, location: p.location || null, comp: p.comp || null, url: p.url || url } } catch {} }
    }
    if (!o.company || !o.role) return { status: 200, headers: HEADERS, jsonBody: { error: 'could not identify a company + role on this page', parsed: o } }

    client = await getPgClient()
    const r = await insertOpp(client, owner, o, 'Extension', `Saved from ${url || 'a web page'}`)
    // Store raw page text for JD parsing — best-effort, don't fail the insert
    if (r.inserted && r.id && text) {
      try {
        await client.query(`alter table opportunity add column if not exists raw_jd text`)
        await client.query(`update opportunity set raw_jd = $1 where id = $2`, [text, r.id])
      } catch {}
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, inserted: r.inserted, reason: r.reason, id: r.id, opportunity: { company: o.company, role: o.role, location: o.location } } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('appCapture', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/capture', handler: appCapture })

import { app, HttpRequest, HttpResponseInit } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
const SELF_BASE = process.env.COACH_SELF_BASE || 'https://job-platform-api.azurewebsites.net/api'

// GET /api/app/health — real liveness/readiness: pings Postgres and reports which
// integrations are configured. For uptime monitoring & post-deploy checks.
export async function appHealth(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const out: any = { ok: false, ts: new Date().toISOString(), checks: {} }
  // DB
  let client
  try {
    const t0 = Date.now()
    client = await getPgClient()
    await client.query('select 1')
    out.checks.db = { ok: true, ms: Date.now() - t0 }
  } catch (e) { out.checks.db = { ok: false, error: String(e) } }
  finally { try { await client?.end() } catch {} }
  // Integration presence (config, not live calls)
  out.checks.openai = { ok: !!process.env.OPENAI_API_KEY }
  out.checks.graph = { ok: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) }
  out.checks.google = { ok: !!(process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) }
  out.checks.storage = { ok: !!process.env.AZURE_STORAGE_CONNECTION_STRING }
  out.checks.tavily = { ok: !!(process.env.TAVILY_API_KEY || '').trim() }
  out.checks.session = { ok: !!(process.env.SESSION_SIGNING_SECRET || process.env.MICROSOFT_CLIENT_SECRET) }
  out.ok = out.checks.db.ok
  return { status: out.ok ? 200 : 503, headers: HEADERS, jsonBody: out }
}

// GET /api/app/selftest — automated smoke test of the key app/* read endpoints.
// Returns pass/fail per endpoint so a deploy can be verified in one call.
export async function appSelftest(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const checks: Array<{ name: string; ok: boolean; ms: number; detail?: string }> = []
  const probe = async (name: string, path: string, ok: (j: any) => boolean) => {
    const t0 = Date.now()
    try {
      const r = await fetch(`${SELF_BASE}/${path}`)
      const j = await r.json().catch(() => ({}))
      checks.push({ name, ok: r.ok && ok(j), ms: Date.now() - t0, detail: j?.error })
    } catch (e) { checks.push({ name, ok: false, ms: Date.now() - t0, detail: String(e) }) }
  }
  await probe('opportunities', 'app/opportunities', (j) => Array.isArray(j.opportunities))
  await probe('packets', 'app/packets', (j) => Array.isArray(j.packets))
  await probe('outreach', 'app/outreach', (j) => Array.isArray(j.messages) || Array.isArray(j.queue) || typeof j === 'object')
  await probe('coach-status', 'app/coach/status', (j) => 'model' in j)
  await probe('mail-config', 'mail/config', (j) => typeof j === 'object')
  await probe('health', 'app/health', (j) => j.ok === true)
  const passed = checks.filter((c) => c.ok).length
  return { status: 200, headers: HEADERS, jsonBody: { ok: passed === checks.length, passed, total: checks.length, checks } }
}

app.http('appHealth', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/health', handler: appHealth })
app.http('appSelftest', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/selftest', handler: appSelftest })

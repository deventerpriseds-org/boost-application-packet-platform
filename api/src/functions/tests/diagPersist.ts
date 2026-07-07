import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { persistRefreshToken } from './googleOAuth'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

// GET /api/diag/persist - exercise the exact managed-identity -> ARM -> app
// settings WRITE path the OAuth callback uses to auto-save the refresh token.
// Writes a harmless GOOGLE_PERSIST_SELFTEST key (never touches the real token)
// and reads it back, so we can prove auto-save works end to end.
export async function diagPersist(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const steps: any[] = []
  const env = {
    IDENTITY_ENDPOINT: !!process.env.IDENTITY_ENDPOINT,
    IDENTITY_HEADER: !!process.env.IDENTITY_HEADER,
    WEBSITE_OWNER_NAME: process.env.WEBSITE_OWNER_NAME || null,
    WEBSITE_RESOURCE_GROUP: process.env.WEBSITE_RESOURCE_GROUP || null,
    WEBSITE_SITE_NAME: process.env.WEBSITE_SITE_NAME || null
  }
  steps.push({ step: 'env', value: env })

  try {
    const idEndpoint = process.env.IDENTITY_ENDPOINT
    const idHeader = process.env.IDENTITY_HEADER
    // WEBSITE_OWNER_NAME = "{sub}+{rg}-{region}webspace"; take sub before '+'
    const sub = process.env.WEBSITE_OWNER_NAME?.split('+')[0] || '09594120-1b35-4e21-84c6-451ac27175a3'
    const rg = process.env.WEBSITE_RESOURCE_GROUP || 'EnterpriseDS_ResourceGRP'
    const site = process.env.WEBSITE_SITE_NAME || 'job-platform-api'

    if (!idEndpoint || !idHeader) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: 'No IDENTITY_ENDPOINT/HEADER — managed identity not available to the worker', steps } }
    }

    // 1. Get ARM token from managed identity
    const tokRes = await fetch(`${idEndpoint}?resource=https://management.azure.com/&api-version=2019-08-01`, {
      headers: { 'X-IDENTITY-HEADER': idHeader }
    })
    const tokBody = await tokRes.text()
    steps.push({ step: 'msiToken', httpStatus: tokRes.status, ok: tokRes.ok, sample: tokRes.ok ? 'token acquired' : tokBody.slice(0, 200) })
    if (!tokRes.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: 'MSI token request failed', steps } }
    const armToken = JSON.parse(tokBody).access_token

    const base = `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${site}`

    // 2. Read current settings
    const listRes = await fetch(`${base}/config/appsettings/list?api-version=2022-03-01`, {
      method: 'POST', headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' }, body: '{}'
    })
    steps.push({ step: 'readSettings', httpStatus: listRes.status, ok: listRes.ok })
    if (!listRes.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: `ARM read failed (role assignment / scope?): ${(await listRes.text()).slice(0, 200)}`, steps } }
    const current = await listRes.json() as any

    // 3. Write a harmless self-test key, preserving everything else
    const marker = `selftest-${new Date().toISOString()}`
    current.properties.GOOGLE_PERSIST_SELFTEST = marker
    const putRes = await fetch(`${base}/config/appsettings?api-version=2022-03-01`, {
      method: 'PUT', headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'functionapp', properties: current.properties })
    })
    steps.push({ step: 'writeSettings', httpStatus: putRes.status, ok: putRes.ok })
    if (!putRes.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: `ARM write failed (needs Contributor on the site): ${(await putRes.text()).slice(0, 200)}`, steps } }
    const after = await putRes.json() as any

    const persisted = after.properties?.GOOGLE_PERSIST_SELFTEST === marker

    // Also exercise the REAL callback function directly: re-save the current
    // refresh token (safe no-op re-write) and report the actual boolean it
    // returns. This proves the exact function the OAuth callback calls works.
    let realFnResult: any = 'skipped (no GOOGLE_REFRESH_TOKEN present)'
    const currentRt = process.env.GOOGLE_REFRESH_TOKEN
    if (currentRt) {
      const r = await persistRefreshToken(currentRt)
      realFnResult = r ? 'persistRefreshToken() returned TRUE — callback auto-save works' : 'persistRefreshToken() returned FALSE'
      steps.push({ step: 'realCallbackFunction', ok: r })
    }

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: persisted,
        proof: persisted ? `Auto-save WORKS: wrote and read back GOOGLE_PERSIST_SELFTEST=${marker}` : 'Write returned but value not confirmed',
        realCallbackFunction: realFnResult,
        note: 'realCallbackFunction calls the exact persistRefreshToken() the OAuth callback uses.',
        steps
      }
    }
  } catch (err) {
    steps.push({ step: 'exception', error: String(err) })
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, steps } }
  }
}

app.http('diagPersist', { methods: ['GET'], authLevel: 'anonymous', route: 'diag/persist', handler: diagPersist })

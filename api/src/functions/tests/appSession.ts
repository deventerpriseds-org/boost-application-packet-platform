import { app, HttpRequest, HttpResponseInit } from '@azure/functions'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Server-verified identity. On sign-in the app mints a short HMAC-signed session
// token (verified against the provider), and every API call sends it as
// `Authorization: Bearer <token>`. resolveOwner() derives the trusted owner from
// that token instead of a client-asserted ?owner= query param (which remains a
// fallback for the shared demo workspace). No new secret: signs with
// SESSION_SIGNING_SECRET or the existing AZURE_CLIENT_SECRET.

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }
const DEMO_EMAIL = 'demo@executive-engine.local'
const TTL_SEC = 60 * 60 * 12 // 12h

// HMAC key. Uses a dedicated secret if set, else the Graph app secret that's
// already synced to the Function App (MICROSOFT_CLIENT_SECRET) — no new secret needed.
function secret(): string { return process.env.SESSION_SIGNING_SECRET || process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || 'dev-only-insecure-secret' }
function b64url(b: Buffer | string): string { return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function b64urlJson(o: any): string { return b64url(JSON.stringify(o)) }
function fromB64url(s: string): Buffer { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64') }

export function signSession(email: string, provider: string, nowSec: number): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = b64urlJson({ email, provider, iat: nowSec, exp: nowSec + TTL_SEC })
  const data = `${header}.${payload}`
  const sig = b64url(createHmac('sha256', secret()).update(data).digest())
  return `${data}.${sig}`
}

export function verifySession(token: string, nowSec: number): { email: string; provider: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const data = `${parts[0]}.${parts[1]}`
    const expected = createHmac('sha256', secret()).update(data).digest()
    const got = fromB64url(parts[2])
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
    const payload = JSON.parse(fromB64url(parts[1]).toString('utf8'))
    if (!payload?.email || typeof payload.exp !== 'number' || payload.exp < nowSec) return null
    return { email: payload.email, provider: payload.provider || 'unknown' }
  } catch { return null }
}

// The trusted owner for a request: verified token if present & valid, else the
// query-param owner (shared/demo workspace). verified=false means unauthenticated.
export function resolveOwner(req: HttpRequest): { owner: string; verified: boolean } {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (m) {
    const v = verifySession(m[1].trim(), Math.floor(Date.now() / 1000))
    if (v?.email) return { owner: v.email, verified: true }
  }
  return { owner: req.query.get('owner') || DEMO_EMAIL, verified: false }
}

// POST /api/auth/session { msAccessToken } — verify a Microsoft Graph access token
// via /me, then mint a session token. (Google mints via /auth/google/token.)
export async function authSession(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const body = await req.json() as any
    const msToken = (body?.msAccessToken || '').toString()
    if (!msToken) return { status: 400, headers: HEADERS, jsonBody: { error: 'msAccessToken required' } }
    const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { Authorization: `Bearer ${msToken}` } })
    if (!me.ok) return { status: 401, headers: HEADERS, jsonBody: { error: `Graph /me ${me.status} — token not valid` } }
    const p = await me.json() as any
    const email = (p.mail || p.userPrincipalName || '').toLowerCase()
    if (!email) return { status: 401, headers: HEADERS, jsonBody: { error: 'no email on token' } }
    const token = signSession(email, 'microsoft', Math.floor(Date.now() / 1000))
    return { status: 200, headers: HEADERS, jsonBody: { token, email, displayName: p.displayName || email, expiresInSec: TTL_SEC } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('authSession', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'auth/session', handler: authSession })

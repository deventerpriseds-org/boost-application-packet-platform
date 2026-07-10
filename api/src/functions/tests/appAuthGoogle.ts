import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// POST /api/auth/google/token { code, redirectUri }
// Server-side half of the shared-broker Google sign-in: exchange the auth code
// for tokens (using GOOGLE_CLIENT_ID/SECRET), then read the user's identity.
// redirectUri MUST equal the one used in the auth request (the shared broker).
export async function authGoogleToken(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  try {
    if (!clientId || !clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_CLIENT_ID/SECRET not set' } }
    const body = (await req.json().catch(() => ({}))) as any
    const code = body?.code
    const redirectUri = body?.redirectUri
    if (!code || !redirectUri) return { status: 400, headers: HEADERS, jsonBody: { error: 'code and redirectUri are required' } }

    // 1. Exchange the single-use code for an access token.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    })
    const token = (await tokenRes.json()) as any
    if (!tokenRes.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `token exchange failed: ${token.error || tokenRes.status}${token.error_description ? ` (${token.error_description})` : ''}` } }

    // 2. Read the identity (needs the openid/email/profile scopes on the token).
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const info = (await infoRes.json()) as any
    if (!infoRes.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `userinfo failed: ${info.error || infoRes.status}` } }

    return {
      status: 200, headers: HEADERS,
      jsonBody: { accessToken: token.access_token, accountId: info.sub, displayName: info.name || info.email, email: info.email },
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('authGoogleToken', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'auth/google/token', handler: authGoogleToken })

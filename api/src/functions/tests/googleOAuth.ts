import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const REDIRECT_URI = 'https://job-platform-api.azurewebsites.net/api/google/callback'
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations'
].join(' ')

// GET /api/google/auth - redirect the browser to Google's consent screen.
// Sign in as dev@enterpriseds.io and approve to obtain a refresh token.
export async function googleAuth(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return { status: 500, jsonBody: { error: 'GOOGLE_CLIENT_ID not set' } }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  })
  return {
    status: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }
  }
}

// GET /api/google/callback - exchange the auth code for a refresh token and
// persist it to the Function App settings so it survives restarts.
export async function googleCallback(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const code = req.query.get('code')
  const err = req.query.get('error')
  if (err) return { status: 400, headers: { 'Content-Type': 'text/html' }, body: `<h2>Consent failed</h2><p>${err}</p>` }
  if (!code) return { status: 400, headers: { 'Content-Type': 'text/html' }, body: '<h2>Missing authorization code</h2>' }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return { status: 500, jsonBody: { error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set' } }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    })
    const data = await res.json() as any
    if (!res.ok) return { status: 400, headers: { 'Content-Type': 'text/html' }, body: `<h2>Token exchange failed</h2><pre>${JSON.stringify(data, null, 2)}</pre>` }

    const refreshToken: string | undefined = data.refresh_token
    if (!refreshToken) {
      return {
        status: 400, headers: { 'Content-Type': 'text/html' },
        body: '<h2>No refresh token returned</h2><p>Google only returns a refresh token on first consent. Revoke the app at myaccount.google.com/permissions and retry, or ensure prompt=consent.</p>'
      }
    }

    // Persist the refresh token to Function App settings via ARM using the
    // managed identity / assigned identity of the function (if available).
    // If persistence fails, still show the token so it can be set manually.
    let persisted = false
    let persistError = ''
    try {
      persisted = await persistRefreshToken(refreshToken)
    } catch (e) {
      persistError = String(e)
    }

    return {
      status: 200, headers: { 'Content-Type': 'text/html' },
      body: `<!doctype html><html><body style="font-family:system-ui;max-width:640px;margin:40px auto;line-height:1.5">
        <h2>✓ Google consent complete</h2>
        <p>Refresh token obtained for the signed-in account.</p>
        ${persisted
          ? '<p style="color:green">Saved to Function App settings as <code>GOOGLE_REFRESH_TOKEN</code>. The app is restarting — Google tests will pass shortly.</p>'
          : `<p style="color:#b00">Could not auto-save (${persistError || 'no managed identity'}). Copy the value below and set it as the <code>GOOGLE_REFRESH_TOKEN</code> app setting manually.</p>
             <textarea style="width:100%;height:80px">${refreshToken}</textarea>`}
      </body></html>`
    }
  } catch (e) {
    return { status: 500, headers: { 'Content-Type': 'text/html' }, body: `<h2>Error</h2><pre>${String(e)}</pre>` }
  }
}

// Best-effort self-persist of the refresh token using the function's managed
// identity to call ARM. Returns false if no identity/token endpoint available.
async function persistRefreshToken(refreshToken: string): Promise<boolean> {
  const idEndpoint = process.env.IDENTITY_ENDPOINT
  const idHeader = process.env.IDENTITY_HEADER
  const sub = process.env.WEBSITE_OWNER_NAME?.split('+')[0]
  const rg = process.env.WEBSITE_RESOURCE_GROUP
  const site = process.env.WEBSITE_SITE_NAME
  if (!idEndpoint || !idHeader || !sub || !rg || !site) return false

  // Get ARM token from the managed identity
  const tokRes = await fetch(`${idEndpoint}?resource=https://management.azure.com/&api-version=2019-08-01`, {
    headers: { 'X-IDENTITY-HEADER': idHeader }
  })
  if (!tokRes.ok) return false
  const armToken = (await tokRes.json() as any).access_token

  const base = `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${site}`
  // Read current settings, add ours, write back
  const listRes = await fetch(`${base}/config/appsettings/list?api-version=2022-03-01`, {
    method: 'POST', headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' }, body: '{}'
  })
  if (!listRes.ok) return false
  const current = await listRes.json() as any
  current.properties.GOOGLE_REFRESH_TOKEN = refreshToken
  const putRes = await fetch(`${base}/config/appsettings?api-version=2022-03-01`, {
    method: 'PUT', headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'functionapp', properties: current.properties })
  })
  return putRes.ok
}

app.http('googleAuth', { methods: ['GET'], authLevel: 'anonymous', route: 'google/auth', handler: googleAuth })
app.http('googleCallback', { methods: ['GET'], authLevel: 'anonymous', route: 'google/callback', handler: googleCallback })

import { createSign } from 'crypto'

// Optional `subject` enables domain-wide delegation: the service account
// impersonates that Workspace user, so files it creates are owned by the user
// (and use the user's Drive quota) instead of the service account (which has
// 0 bytes of quota). Requires the SA's client ID to be authorized for these
// scopes in Google Admin → Security → API Controls → Domain-wide Delegation.
export async function getGoogleToken(serviceAccountJson: string, scope: string, subject?: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim: Record<string, unknown> = {
    iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }
  if (subject) claim.sub = subject
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url')
  const signingInput = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(sa.private_key, 'base64url')
  const jwt = `${signingInput}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  })
  if (!res.ok) throw new Error(`Token fetch failed: HTTP ${res.status} ${await res.text()}`)
  const data = await res.json() as any
  return data.access_token
}

// The Workspace user the service account impersonates when creating Drive files.
// Override via GOOGLE_IMPERSONATE_SUBJECT app setting. Must be a real user who
// owns/can-access the templates and output folder and has Drive storage quota.
export const IMPERSONATE_SUBJECT = process.env.GOOGLE_IMPERSONATE_SUBJECT || 'dev@enterpriseds.io'

export async function getMicrosoftToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default'
    })
  })
  if (!res.ok) throw new Error(`MS token failed: HTTP ${res.status} ${await res.text()}`)
  const data = await res.json() as any
  return data.access_token
}

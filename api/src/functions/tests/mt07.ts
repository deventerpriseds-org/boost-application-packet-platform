import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function mt07(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e'
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not set' } }

  try {
    const token = await getMicrosoftToken(tenantId, clientId, clientSecret)
    const res = await fetch('https://graph.microsoft.com/v1.0/users/dev@enterpriseds.io/sendMail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: {
          subject: 'MT-07 Test — Platform Connection Verified',
          body: { contentType: 'Text', content: 'MT-07 test — job application platform connection verified. This is an automated test message.' },
          toRecipients: [{ emailAddress: { address: 'von.ellis@enterpriseds.io' } }]
        }
      })
    })
    if (!res.ok) {
      const text = await res.text()
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Graph HTTP ${res.status}: ${text.slice(0, 300)}` } }
    }
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: 'Email sent via Graph API (HTTP 202). Check von.ellis@enterpriseds.io inbox.' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt07', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-07', handler: mt07 })

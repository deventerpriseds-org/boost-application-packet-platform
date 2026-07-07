import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const TEST_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMTkwCiUlRU9G'

export async function mt08(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
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
          subject: 'MT-08 Test — Email With PDF Attachment',
          body: { contentType: 'Text', content: 'MT-08 test — email with PDF attachment. Verify the attachment opens correctly.' },
          toRecipients: [{ emailAddress: { address: 'von.ellis@enterpriseds.io' } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'MT-08-test-attachment.pdf',
            contentType: 'application/pdf',
            contentBytes: TEST_PDF_BASE64
          }]
        }
      })
    })
    if (!res.ok) {
      const text = await res.text()
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Graph HTTP ${res.status}: ${text.slice(0, 300)}` } }
    }
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: 'Email with PDF attachment sent (HTTP 202). Check von.ellis@enterpriseds.io — verify attachment opens.' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt08', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-08', handler: mt08 })

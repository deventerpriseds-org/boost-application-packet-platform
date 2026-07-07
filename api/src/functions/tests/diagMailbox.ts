import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// GET /api/diag/mailbox - verify the Graph mail sender/recipient mailboxes
// actually exist and are licensed. Explains "202 accepted but no email".
export async function diagMailbox(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) return { status: 200, headers: HEADERS, jsonBody: { error: 'MS creds not set' } }

  const sender = 'dev@enterpriseds.io'
  const recipient = 'von.ellis@enterpriseds.io'

  try {
    const token = await getMicrosoftToken(tenantId, clientId, clientSecret)

    const lookup = async (upn: string) => {
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${upn}?$select=displayName,userPrincipalName,mail,accountEnabled,assignedLicenses,mailboxSettings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const body = await res.text()
      let json: any = null
      try { json = JSON.parse(body) } catch {}
      // Also probe whether a mailbox exists by asking for the mailbox settings endpoint
      let mailboxProbe = 'unknown'
      const mbx = await fetch(`https://graph.microsoft.com/v1.0/users/${upn}/mailboxSettings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (mbx.ok) mailboxProbe = 'mailbox exists'
      else {
        const mbxBody = await mbx.text()
        mailboxProbe = `HTTP ${mbx.status}: ${(mbxBody.match(/"code":\s*"([^"]+)"/) || [, mbxBody.slice(0, 80)])[1]}`
      }
      return {
        httpStatus: res.status,
        exists: res.ok,
        displayName: json?.displayName,
        mail: json?.mail,
        accountEnabled: json?.accountEnabled,
        licenseCount: Array.isArray(json?.assignedLicenses) ? json.assignedLicenses.length : 0,
        mailboxProbe,
        error: res.ok ? undefined : (json?.error?.code || body.slice(0, 120))
      }
    }

    const [senderInfo, recipientInfo] = await Promise.all([lookup(sender), lookup(recipient)])

    // Read-back proof: query the sender's Sent Items for our recent test subjects.
    // Requires Mail.Read application permission. If present, a matching message
    // here is definitive proof the email actually sent (not just 202-accepted).
    let sentItems: any = 'Mail.Read not granted (add it for delivery proof)'
    const sentRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${sender}/mailFolders/sentitems/messages?$top=5&$select=subject,sentDateTime,toRecipients&$orderby=sentDateTime desc`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (sentRes.ok) {
      const sj = await sentRes.json() as any
      sentItems = (sj.value || []).map((m: any) => ({
        subject: m.subject,
        sentDateTime: m.sentDateTime,
        to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address)
      }))
    } else {
      const sb = await sentRes.text()
      sentItems = `HTTP ${sentRes.status}: ${(sb.match(/"code":\s*"([^"]+)"/) || [, sb.slice(0, 80)])[1]}`
    }

    const dirReadBlocked = senderInfo.error === 'Authorization_RequestDenied'

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        tenantId,
        sender: { upn: sender, ...senderInfo },
        recipient: { upn: recipient, ...recipientInfo },
        sentItemsRecent: sentItems,
        interpretation: dirReadBlocked
          ? `Directory lookup blocked (app has Mail.Send but not User.Read.All), so existence can't be confirmed this way. A 202 from sendMail already implies ${sender} is a real mailbox. To PROVE delivery, grant Mail.Read and re-check "sentItemsRecent" above for the test subjects.`
          : (senderInfo.mailboxProbe.startsWith('HTTP')
              ? `Sender ${sender} has no reachable mailbox — Graph 202 but nothing sends.`
              : `Sender mailbox valid. If no email arrives, check Junk/Quarantine for ${recipient}.`)
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  }
}

app.http('diagMailbox', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'diag/mailbox',
  handler: diagMailbox
})

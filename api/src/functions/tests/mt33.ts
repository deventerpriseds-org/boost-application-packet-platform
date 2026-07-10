import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-33 — Inbox watcher / Graph folder read. Lists mail folders and reads recent
// messages from the inbox of the monitored mailbox, simulating the per-folder
// watcher ingest (read scope). Proves the intake connection without a live
// subscription webhook.
export async function mt33(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'MICROSOFT_CLIENT_ID / SECRET not set' } }

  const mailbox = 'dev@enterpriseds.io'
  try {
    const token = await getMicrosoftToken(tenantId, clientId, clientSecret)

    // 1. list mail folders (proves folder-per-source routing is reachable)
    const foldersRes = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders?$top=20&$select=displayName,totalItemCount`, { headers: { Authorization: `Bearer ${token}` } })
    if (!foldersRes.ok) throw new Error(`mailFolders HTTP ${foldersRes.status}: ${(await foldersRes.text()).slice(0, 200)}`)
    const folders = ((await foldersRes.json()) as any).value || []

    // 2. read recent inbox messages (simulates ingest of alert emails)
    const msgRes = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/inbox/messages?$top=5&$select=subject,from,receivedDateTime`, { headers: { Authorization: `Bearer ${token}` } })
    if (!msgRes.ok) throw new Error(`messages HTTP ${msgRes.status}: ${(await msgRes.text()).slice(0, 200)}`)
    const messages = (((await msgRes.json()) as any).value || []).map((m: any) => ({
      subject: m.subject, from: m.from?.emailAddress?.address, receivedDateTime: m.receivedDateTime
    }))

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: true,
        detail: `Watcher read ${folders.length} mail folders and ${messages.length} recent inbox messages from ${mailbox}.`,
        mailbox,
        folders: folders.map((f: any) => ({ name: f.displayName, count: f.totalItemCount })),
        recentMessages: messages
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt33', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-33', handler: mt33 })

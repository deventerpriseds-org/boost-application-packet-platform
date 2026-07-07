import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getMicrosoftToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const TEST_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMTkwCiUlRU9G'

const DOC_LINKS = {
  fullResume: 'https://docs.google.com/document/d/test-resume/edit',
  compactResume: 'https://docs.google.com/document/d/test-compact/edit',
  portfolio: 'https://docs.google.com/presentation/d/test-portfolio/edit',
  coverLetter: 'https://docs.google.com/presentation/d/test-coverletter/edit',
}

const COLD_EMAIL = `Hi [Hiring Manager],

I wanted to reach out directly about the VP of Engineering role at TechVenture Inc. With 20+ years of enterprise engineering leadership — scaling teams to 150+ engineers, driving SaaS platform delivery, and managing $25M+ budgets — I believe I'm a strong match.

I've attached my application package for your review.

Best regards,
Von Ellis`

const ATS_SUMMARY = `ATS Keyword Match: 85% | Jobscan Score: 92/100
Top matched keywords: Enterprise Architecture, Cloud Strategy, DevSecOps, Agile, SaaS, M&A`

const SKILLS_COMPARISON = `Before → After Skills Optimization:
Skills Bullets 1: Enterprise Architecture | Cloud Strategy | DevSecOps
Skills Bullets 2: Agile Transformation | SaaS Platforms | M&A Integration
Relevant: Agile Portfolio Mgmt | SaaS Platforms | Data Governance`

const HTML_BODY = `
<html><body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
<h2>Application Package: TechVenture Inc — VP of Engineering [MT-21 TEST]</h2>

<h3>📄 Documents</h3>
<ul>
  <li><a href="${DOC_LINKS.fullResume}">Full Resume (Google Doc)</a></li>
  <li><a href="${DOC_LINKS.compactResume}">Compact/ATS Resume (Google Doc)</a></li>
  <li><a href="${DOC_LINKS.portfolio}">Portfolio Deck (Google Slides)</a></li>
  <li><a href="${DOC_LINKS.coverLetter}">Cover Letter (Google Slides)</a></li>
</ul>

<h3>✉️ Cold Email Draft</h3>
<pre style="background:#f5f5f5;padding:12px;border-radius:4px;">${COLD_EMAIL}</pre>

<h3>🎯 ATS Analysis</h3>
<pre style="background:#f5f5f5;padding:12px;border-radius:4px;">${ATS_SUMMARY}</pre>

<h3>📊 Skills Comparison</h3>
<pre style="background:#f5f5f5;padding:12px;border-radius:4px;">${SKILLS_COMPARISON}</pre>

<hr/><p style="color:#999;font-size:11px;">MT-21 Test — Job Application Platform</p>
</body></html>`

export async function mt21(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
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
          subject: 'Application Prep: TechVenture Inc - VP of Engineering [MT-21 TEST]',
          body: { contentType: 'HTML', content: HTML_BODY },
          toRecipients: [{ emailAddress: { address: 'von.ellis@enterpriseds.io' } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'MT-21-test-attachment.pdf',
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
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: 'Delivery email sent with all 4 doc links, cold email, ATS summary, and PDF attachment. Check von.ellis@enterpriseds.io.' } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt21', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-21', handler: mt21 })

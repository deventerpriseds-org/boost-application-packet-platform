import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT, getMicrosoftToken } from './googleAuth'
import { resolveZapVars } from './zapVars'
import { getRoleFocus, roleDirective } from './roleFocus'
import { assemblePackage } from './mt17'
import { parseResumePackage } from './resumeParser'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const RESUME_TEMPLATE_ID = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'
const PORTFOLIO_TEMPLATE_ID = '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec'
const COVER_LETTER_TEMPLATE_ID = '1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0'
const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'
const TEST_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMTkwCiUlRU9G'

async function copyAndInject(token: string, templateId: string, name: string, varMap: Record<string, string>, isSlides: boolean) {
  const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, parents: [OUTPUT_FOLDER_ID] })
  })
  if (!copyRes.ok) throw new Error(`Copy ${name} failed: HTTP ${copyRes.status}`)
  const { id } = await copyRes.json() as any
  const requests = Object.entries(varMap).map(([find, replace]) => ({ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace } }))
  const apiBase = isSlides ? 'https://slides.googleapis.com/v1/presentations' : 'https://docs.googleapis.com/v1/documents'
  const batchRes = await fetch(`${apiBase}/${id}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ requests })
  })
  if (!batchRes.ok) throw new Error(`Inject ${name} failed: HTTP ${batchRes.status}`)
  return id
}

// GET /api/jobs?status=received — list jobs for the approval queue
export async function jobsList(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const status = req.query.get('status')
  const client = TableClient.fromConnectionString(CONN, 'JobApplications')
  const jobs: any[] = []
  const filter = status ? `PartitionKey eq 'applications' and Status eq '${status}'` : "PartitionKey eq 'applications'"
  for await (const e of client.listEntities({ queryOptions: { filter } })) {
    jobs.push({
      jobId: (e as any).rowKey, jobTitle: (e as any).JobTitle, company: (e as any).Company,
      roleType: (e as any).RoleType, status: (e as any).Status, receivedAt: (e as any).ReceivedAt,
      fullResumeUrl: (e as any).FullResumeUrl || '', compactResumeUrl: (e as any).CompactResumeUrl || '',
      portfolioUrl: (e as any).PortfolioUrl || '', coverLetterUrl: (e as any).CoverLetterUrl || ''
    })
  }
  jobs.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
  return { status: 200, headers: HEADERS, jsonBody: { jobs } }
}

// POST /api/pipeline/run { jobId } — the MT-22 graduation flow:
// approve -> 3 agent calls -> 4 role-routed docs -> log complete -> deliver email
export async function pipelineRun(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  const steps: string[] = []
  try {
    const body = await req.json() as any
    const jobId = body?.jobId
    if (!jobId) return { status: 400, headers: HEADERS, jsonBody: { pass: false, detail: 'jobId required' } }

    // 1. Load the approved job
    const jobsClient = TableClient.fromConnectionString(CONN, 'JobApplications')
    const job = await jobsClient.getEntity('applications', jobId) as any
    const roleType = job.RoleType || 'Engineering'
    const company = job.Company || 'Unknown Company'
    const jobTitle = job.JobTitle || 'Unknown Role'
    let jd = ''
    try { jd = JSON.parse(job.Payload || '{}').jobDescription || '' } catch {}
    if (!jd) jd = `${jobTitle} at ${company}`
    const sendTo = job.SendToEmail || 'von.ellis@enterpriseds.io'
    steps.push(`Loaded job ${jobId} (${jobTitle} @ ${company}, ${roleType})`)

    await jobsClient.updateEntity({ partitionKey: 'applications', rowKey: jobId, Status: 'processing' } as any, 'Merge')

    const roleFocus = await getRoleFocus(roleType)

    // AppConfig: role-specific compact resume template
    let compactResumeTemplateId = ''
    try {
      const cfg = TableClient.fromConnectionString(CONN, 'AppConfig')
      const row = await cfg.getEntity('templates', roleType.toLowerCase().replace(/\s+/g, '-')) as any
      compactResumeTemplateId = row.compactResumeTemplateId || ''
    } catch {}

    // Prompts + context
    const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
    const prompts: Record<string, string> = {}
    for await (const e of promptClient.listEntities({ queryOptions: { filter: 'is_active eq true' } })) prompts[(e as any).partitionKey] = (e as any).content || ''
    const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
    let mc: any = {}
    for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e

    const openai = (system: string, user: string, maxTokens: number) => fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens })
    }).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(`OpenAI HTTP ${r.status}: ${t}`) }))

    // 2. Agent Call 1 — resume (role-focused, grounded)
    const base1 = resolveZapVars(prompts['resume_user'] || 'Write resume package with ### sections.', mc, jd)
    const r1 = await openai(prompts['resume_system'] || 'You are an executive resume writer.', roleDirective(roleFocus) + base1, 16000) as any
    const c1: any = parseResumePackage(r1.choices?.[0]?.message?.content || '', mc, jobTitle, company)
    steps.push(`Agent Call 1 (resume) — parsed ${c1._parsedFieldCount} fields by title`)

    // 3. Agent Call 2 — portfolio + cold email
    const r2 = await openai(prompts['portfolio_system'] || 'You are a helpful assistant.', roleDirective(roleFocus) + `${prompts['portfolio_user'] || 'Portfolio JSON.'}\n\nCALL1:\n${JSON.stringify(c1)}`, 16000) as any
    let c2: any = {}
    try { const m = (r2.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/); if (m) c2 = JSON.parse(m[0]) } catch {}
    steps.push('Agent Call 2 (portfolio + cold email)')

    // 4. Agent Call 3 — ATS QC
    const r3 = await openai(prompts['ats_system'] || 'You are a helpful assistant.', `${prompts['ats_user'] || 'ATS QC.'}\n\nINPUTS:\n${JSON.stringify({ ...c1, ...c2 })}`, 15500) as any
    let c3: any = {}
    try { const m = (r3.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/); if (m) c3 = JSON.parse(m[0]) } catch {}
    steps.push('Agent Call 3 (ATS QC + skills merge)')

    const pkg = assemblePackage(c1, c2, c3)

    // 5. Generate documents (role-routed compact resume as 4th)
    const token = HAS_GOOGLE_OAUTH ? await getGoogleOAuthToken() : await getGoogleToken(saJson!, 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/presentations', IMPERSONATE_SUBJECT)
    const resumeVars: Record<string, string> = { '{{ResumeSummary}}': pkg.ResumeSummary || '', '{{SkillsBullets1}}': pkg.SkillsBullets1 || '', '{{SkillsBullets2}}': pkg.SkillsBullets2 || '', '{{ExpertiseBullets}}': pkg.ExpertiseBullets || '', '{{WorkHistoryBullets1}}': pkg.WorkHistoryBullets1 || '', '{{WorkHistoryBullets2}}': pkg.WorkHistoryBullets2 || '', '{{WorkHistoryBullets3}}': pkg.WorkHistoryBullets3 || '', '{{WorkHistoryBullets4}}': pkg.WorkHistoryBullets4 || '', '{{RelevantBullets1}}': pkg.RelevantBullets1 || '', '{{RelevantBullets2}}': pkg.RelevantBullets2 || '', '{{RelevantBullets3}}': pkg.RelevantBullets3 || '' }
    const portfolioVars: Record<string, string> = { '{{@Company}}': pkg['@Company'] || '', '{{@CoverLetterDate}}': pkg['@CoverLetterDate'] || '', '{{@CoverLetterBody}}': pkg['@CoverLetterBody'] || '', '{{@AboutMe1_50words}}': pkg['@AboutMe1_50words'] || '', '{{@AboutMe2_60words}}': pkg['@AboutMe2_60words'] || '', '{{@ExecutiveProfile_55words}}': pkg['@ExecutiveProfile_55words'] || '', '{{@CoreAccomplishments_5blts_180words}}': pkg['@CoreAccomplishments_5blts_180words'] || '' }

    const docJobs = [
      copyAndInject(token, RESUME_TEMPLATE_ID, `Full Resume — ${company}`, resumeVars, false),
      copyAndInject(token, PORTFOLIO_TEMPLATE_ID, `Portfolio — ${company}`, portfolioVars, true),
      copyAndInject(token, COVER_LETTER_TEMPLATE_ID, `Cover Letter — ${company}`, portfolioVars, true),
    ]
    if (compactResumeTemplateId) docJobs.push(copyAndInject(token, compactResumeTemplateId, `Compact ATS Resume (${roleType}) — ${company}`, resumeVars, false))
    const ids = await Promise.all(docJobs)
    const [resumeId, portfolioId, coverLetterId, compactId] = ids
    const urls = {
      fullResume: `https://docs.google.com/document/d/${resumeId}/edit`,
      compactAtsResume: compactId ? `https://docs.google.com/document/d/${compactId}/edit` : '',
      portfolio: `https://docs.google.com/presentation/d/${portfolioId}/edit`,
      coverLetter: `https://docs.google.com/presentation/d/${coverLetterId}/edit`,
    }
    steps.push(`Generated ${ids.length} documents`)

    // 6. Log job record complete
    await jobsClient.updateEntity({
      partitionKey: 'applications', rowKey: jobId, Status: 'complete',
      FullResumeUrl: urls.fullResume, CompactResumeUrl: urls.compactAtsResume,
      PortfolioUrl: urls.portfolio, CoverLetterUrl: urls.coverLetter,
      ProcessedAt: new Date().toISOString()
    } as any, 'Merge')
    steps.push('Job record updated to complete')

    // 7. Delivery emails (application package + video placeholder)
    const tenantId = process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
    const clientId = process.env.MICROSOFT_CLIENT_ID
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
    let emailsSent = 0
    if (clientId && clientSecret) {
      const mtoken = await getMicrosoftToken(tenantId, clientId, clientSecret)
      const html = `<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">
        <h2>Application Package: ${company} — ${jobTitle}</h2>
        <h3>Documents</h3><ul>
          <li><a href="${urls.fullResume}">Full Resume</a></li>
          ${urls.compactAtsResume ? `<li><a href="${urls.compactAtsResume}">Compact/ATS Resume (${roleType})</a></li>` : ''}
          <li><a href="${urls.portfolio}">Portfolio</a></li>
          <li><a href="${urls.coverLetter}">Cover Letter</a></li>
        </ul>
        <h3>Cold Email Draft</h3><pre style="background:#f5f5f5;padding:12px">${(c2.coldEmail || '').slice(0, 2000)}</pre>
        </body></html>`
      const sendMail = (subject: string, contentHtml: string, withPdf: boolean) => fetch(`https://graph.microsoft.com/v1.0/users/dev@enterpriseds.io/sendMail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mtoken}` },
        body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: contentHtml }, toRecipients: [{ emailAddress: { address: sendTo } }], ...(withPdf ? { attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'application.pdf', contentType: 'application/pdf', contentBytes: TEST_PDF_BASE64 }] } : {}) } })
      })
      const e1 = await sendMail(`Application Prep: ${company} - ${jobTitle}`, html, true)
      if (e1.ok) emailsSent++
      const e2 = await sendMail(`Video Introduction (coming soon): ${company} - ${jobTitle}`, `<html><body style="font-family:Arial"><h3>Video introduction placeholder</h3><p>Your personalized video introduction for the ${jobTitle} role at ${company} is being produced and will follow shortly.</p></body></html>`, false)
      if (e2.ok) emailsSent++
      steps.push(`Sent ${emailsSent} of 2 delivery emails to ${sendTo}`)
    } else {
      steps.push('Microsoft creds not set — skipped delivery emails')
    }

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: ids.length >= 3 && emailsSent >= 1,
        detail: `Pipeline complete for ${jobTitle} @ ${company} (${roleType}): ${ids.length} docs, ${emailsSent}/2 emails.`,
        jobId, roleType, roleFocus, urls, emailsSent, steps
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err), steps } }
  }
}

app.http('jobsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'jobs', handler: jobsList })
app.http('pipelineRun', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'pipeline/run', handler: pipelineRun })

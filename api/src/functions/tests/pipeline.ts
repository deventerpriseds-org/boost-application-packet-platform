import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT, getMicrosoftToken } from './googleAuth'
import { resolveZapVars } from './zapVars'
import { resolveRoleFocus, roleDirective } from './roleFocus'
import { assemblePackage } from './mt17'
import { parseResumePackage } from './resumeParser'
import { parseAgentJson, isEmptyResult } from './agentJson'
import { loadPipelineSettings, requireDriveId, isDriveId, CONFIG_KEYS, PipelineSettings } from './pipelineConfig'

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
  // Validate BEFORE the request so a missing/blank/sentinel id is reported as the configuration gap
  // it is, naming the document, instead of arriving at Drive as an opaque 404 on `files//copy`.
  const tpl = requireDriveId(templateId, `Template id for "${name}"`)
  const parent = requireDriveId(OUTPUT_FOLDER_ID, 'Output folder id', 'google.outputFolderId')
  const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${tpl}/copy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, parents: [parent] })
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

// The proven 3-agent packet generation (resume → portfolio/cover → ATS QC),
// grounded in the Prompts + MasterContext tables and role focus, returning the
// assembled placeholder package. Extracted from pipelineRun so BOTH the MT-22
// test flow and the production Executive Engine packet builder use the identical
// engine (this is what produced the correctly-filled portfolio files).
// Returns `calls` alongside the package because P1.3 cannot reconstruct what changed from the merged
// output alone: assemblePackage's per-slot preference for Call 3 over Call 1 IS the swap decision,
// and both sides are needed to see it. These were previously discarded at the end of this function.
export async function buildPackageForJD(opts: { key: string; jd: string; roleType: string; company: string; jobTitle: string }): Promise<{ pkg: Record<string, string | null>; steps: string[]; roleFocus: any; roleFocusSource: string; calls: { c1: any; c2: any; c3: any }; usage: Array<{ pass: string; usage: any }>; promptVersions: Record<string, number>; profileText: string; omitList: string; warnings: string[]; qcApplied: boolean; settings: PipelineSettings }> {
  const { key, jd, roleType, company, jobTitle } = opts
  const steps: string[] = []
  const warnings: string[] = []

  // Runtime knobs come from the existing AppConfig/auth store (Auth & Config screen), not from code.
  const settings = await loadPipelineSettings()
  warnings.push(...settings.warnings)

  const role = await resolveRoleFocus(roleType, settings.defaultRoleFocus)
  const roleFocus = role.focus
  if (role.warning) warnings.push(`role focus: ${role.warning}`)
  steps.push(`Role focus "${roleFocus}" (source: ${role.source})`)

  // X6 — the version is loaded alongside the content. This projection took `content` only, so
  // nothing downstream could say WHICH prompt produced a given package. P4 requires a
  // prompt_version on every verdict, and "the active one at the time" is not recoverable after the
  // fact once a prompt is superseded.
  const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
  const prompts: Record<string, string> = {}
  const promptVersions: Record<string, number> = {}
  for await (const e of promptClient.listEntities({ queryOptions: { filter: 'is_active eq true' } })) {
    const key = (e as any).partitionKey
    prompts[key] = (e as any).content || ''
    promptVersions[key] = Number((e as any).version ?? 0)
  }
  const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
  let mc: any = {}
  for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e

  // `temperature` was never sent, so the Chat Completions default applied to all three calls —
  // including the reconciliation pass, which is the one call in the run that should be the least
  // creative. Both values are configurable (AppConfig/auth), seeded from `SEED_TEMPERATURES`.
  const openai = (system: string, user: string, maxTokens: number, temperature: number) => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature })
  }).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(`OpenAI HTTP ${r.status}: ${t}`) }))

  const tGen = settings.generateTemperature.value
  const tQc = settings.qcTemperature.value
  steps.push(`Temperatures — generation ${tGen} (${settings.generateTemperature.source}), QC ${tQc} (${settings.qcTemperature.source})`)

  const base1 = resolveZapVars(prompts['resume_user'] || 'Write resume package with ### sections.', mc, jd)
  const r1 = await openai(prompts['resume_system'] || 'You are an executive resume writer.', roleDirective(roleFocus) + base1, 16000, tGen) as any
  const c1: any = parseResumePackage(r1.choices?.[0]?.message?.content || '', mc, jobTitle, company)
  steps.push(`Agent Call 1 (resume) — parsed ${c1._parsedFieldCount} fields by title`)
  if (!c1._parsedFieldCount) warnings.push('Call 1 produced no recognisable ### sections — the package is MasterContext only')
  // P7 item 1. A `### Title ###` section whose title maps to no merge field used to be swallowed
  // by the field above it, title and all — so a prompt edit that ADDED a section silently moved
  // content into the wrong resume slot, which is exactly what P7's acceptance line forbids. The
  // parser now keeps it separate; this makes it visible, because silently dropping it and silently
  // misfiling it are the same defect.
  for (const u of (c1._unmapped || [])) {
    warnings.push(`Call 1 returned a section named "${u.title}" that maps to no merge field — its ${u.body.length} characters were NOT placed in any document`)
  }

  // Calls 2 and 3 were sending their prompts RAW: every `{{node__field}}` token the seeded Zapier
  // prompts carry reached the model as a literal. For Call 3 that included the job description
  // itself, so the ATS-QC pass was asked to compare two lists against a posting it never saw.
  // `extra` supplies the tokens that only exist mid-run (Call-1's own output, the target company
  // and role); everything still unmapped is blanked rather than shown to the model.
  const base2 = resolveZapVars(prompts['portfolio_user'] || 'Portfolio JSON.', mc, jd)
  const r2 = await openai(prompts['portfolio_system'] || 'You are a helpful assistant.', roleDirective(roleFocus) + `${base2}\n\nCALL1:\n${JSON.stringify(c1)}`, 16000, tGen) as any
  const p2 = parseAgentJson(r2.choices?.[0]?.message?.content)
  const c2: any = p2.value || {}
  if (!p2.value) warnings.push(`Call 2 (portfolio) returned no JSON object (${p2.detail}) — portfolio/cover fields fall back to Call 1`)
  steps.push(`Agent Call 2 (portfolio + cold email) — JSON via ${p2.via}`)

  const atsExtra: Record<string, string> = {
    '289877667__ResumeSummary': c1.resumeSummary || '',
    '289877667__skills list 1': c1.skills1 || '',
    '289877667__skills list 2': c1.skills2 || '',
    '289877667__Expertise': c1.expertise || '',
    '289877667__Relevant 1': c1.relevant1 || '',
    '289877667__Relevant 2': c1.relevant2 || '',
    '289877667__Relevant 3': c1.relevant3 || '',
    '289877662__output__Item 7': company || '',
    '289877662__output__Item 5': jobTitle || '',
  }
  const base3 = resolveZapVars(prompts['ats_user'] || 'ATS QC.', mc, jd, undefined, atsExtra)
  const r3 = await openai(prompts['ats_system'] || 'You are a helpful assistant.', `${base3}\n\nINPUTS:\n${JSON.stringify({ ...c1, ...c2 })}`, 15500, tQc) as any
  const p3 = parseAgentJson(r3.choices?.[0]?.message?.content)
  const c3: any = p3.value || {}
  // An inert Call 3 is the difference between "QC ran and agreed" and "QC never landed". It used to
  // be swallowed by a `catch` and reported as neither; every downstream swap row then reads `kept`.
  const qcApplied = !!p3.value && !isEmptyResult(p3.value)
  if (!p3.value) warnings.push(`Call 3 (ATS QC) returned no JSON object (${p3.detail}) — the package is Call 1 unreviewed`)
  else if (!qcApplied) warnings.push('Call 3 (ATS QC) returned an empty object — no skill merge or summary update was applied')
  steps.push(`Agent Call 3 (ATS QC + skills merge) — JSON via ${p3.via}, applied: ${qcApplied}`)

  const pkg = assemblePackage(c1, c2, c3) as Record<string, string | null>
  // The standing profile, so an item that predates this application can be marked profile_original
  // rather than credited to a pass that merely repeated it. `itemsToOmit` is EXCLUDED: it is the
  // owner's do-not-use list, injected into the resume prompt as {{289877659__Items to Omit}}.
  // Leaving it in would mark a banned item as part of the profile — the exact inverse of the truth.
  const omitList = String((mc as any)?.itemsToOmit || '')
  const profileText = Object.entries(mc || {})
    .filter(([k, v]) => typeof v === 'string' && k !== 'itemsToOmit')
    .map(([, v]) => v as string).join(' ')
  // The MT-22 route returns `warnings` to its caller; the production packet builder
  // (appPackets.buildTemplatedArtifact) does not read them, so emit them here too — otherwise a
  // config gap or an inert QC call is invisible on the path that actually ships documents.
  if (warnings.length) console.warn(`[pipeline] ${warnings.length} warning(s) for ${jobTitle} @ ${company}:\n - ${warnings.join('\n - ')}`)

  // D8 - the three generation calls were never metered. Their `usage` objects were read from the
  // OpenAI reply and then dropped on the floor here, so the production packet build recorded ZERO
  // rows in usage_metering while being the most expensive thing the product does. They are returned
  // rather than logged here so metering stays in the HTTP layer that owns the pg client.
  const usage = [
    { pass: 'resume', usage: (r1 as any)?.usage },
    { pass: 'portfolio', usage: (r2 as any)?.usage },
    { pass: 'ats-qc', usage: (r3 as any)?.usage },
  ]
  return { pkg, steps, roleFocus, roleFocusSource: role.source, calls: { c1, c2, c3 }, usage, promptVersions, profileText, omitList, warnings, qcApplied, settings }
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

    // 2-4. Proven 3-agent generation (shared with the production packet builder).
    const built = await buildPackageForJD({ key, jd, roleType, company, jobTitle })
    const { pkg, steps: genSteps, roleFocus } = built
    const warnings: string[] = [...built.warnings]
    steps.push(...genSteps)

    // AppConfig: role-specific compact resume template, then the owner's configured default. A role
    // with neither used to skip the 4th document in silence — `pass` only counts >= 3 docs, so a
    // packet could ship without the ATS resume and still report success.
    const roleRow = roleType.toLowerCase().replace(/\s+/g, '-')
    let compactResumeTemplateId = ''
    let compactSource = 'none'
    try {
      const cfg = TableClient.fromConnectionString(CONN, 'AppConfig')
      const row = await cfg.getEntity('templates', roleRow) as any
      compactResumeTemplateId = String(row.compactResumeTemplateId || '')
      if (compactResumeTemplateId) compactSource = `templates/${roleRow}`
    } catch (e) {
      const status = (e as any)?.statusCode
      if (status !== 404) warnings.push(`AppConfig templates/${roleRow} lookup failed: ${String((e as any)?.message || e).slice(0, 160)}`)
    }
    if (!compactResumeTemplateId && built.settings.compactResumeTemplateId) {
      compactResumeTemplateId = built.settings.compactResumeTemplateId
      compactSource = CONFIG_KEYS.compactResumeTemplateId
    }
    if (compactResumeTemplateId && !isDriveId(compactResumeTemplateId)) {
      warnings.push(`Compact resume template id from ${compactSource} is not a Drive id (${JSON.stringify(compactResumeTemplateId)}) — the compact ATS resume was NOT generated`)
      compactResumeTemplateId = ''
      compactSource = 'invalid'
    }
    if (!compactResumeTemplateId) {
      warnings.push(`No compact ATS resume template for role "${roleType}" — add compactResumeTemplateId to AppConfig templates/${roleRow}, or set ${CONFIG_KEYS.compactResumeTemplateId} in Auth & Config. The compact ATS resume was NOT generated.`)
    }
    steps.push(`Compact ATS resume template: ${compactResumeTemplateId ? compactSource : 'NOT CONFIGURED'}`)

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
        <h3>Cold Email Draft</h3><pre style="background:#f5f5f5;padding:12px">${(pkg.coldEmail || '').slice(0, 2000)}</pre>
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
        // A run that produced documents but hit a config gap or an inert agent call is not a clean
        // pass. It still returns its artifacts — but it says so, instead of reporting bare success.
        pass: ids.length >= 3 && emailsSent >= 1 && warnings.length === 0,
        detail: `Pipeline complete for ${jobTitle} @ ${company} (${roleType}): ${ids.length} docs, ${emailsSent}/2 emails.`
          + (warnings.length ? ` ${warnings.length} warning(s).` : ''),
        jobId, roleType, roleFocus, roleFocusSource: built.roleFocusSource, qcApplied: built.qcApplied,
        urls, emailsSent, steps, warnings
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err), steps } }
  }
}

app.http('jobsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'jobs', handler: jobsList })
app.http('pipelineRun', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'pipeline/run', handler: pipelineRun })

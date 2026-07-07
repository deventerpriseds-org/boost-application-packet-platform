import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'
import { assemblePackage } from './mt17'
import { resolveZapVars } from './zapVars'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const RESUME_TEMPLATE_ID = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'
const PORTFOLIO_TEMPLATE_ID = '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec'
const COVER_LETTER_TEMPLATE_ID = '1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0'
const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'

async function copyAndInjectDoc(token: string, templateId: string, name: string, varMap: Record<string, string>, isSlides: boolean) {
  const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, parents: [OUTPUT_FOLDER_ID] })
  })
  if (!copyRes.ok) throw new Error(`Copy ${name} failed: HTTP ${copyRes.status}`)
  const { id } = await copyRes.json() as any

  const requests = Object.entries(varMap).map(([find, replace]) => ({
    replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace }
  }))
  const apiBase = isSlides ? 'https://slides.googleapis.com/v1/presentations' : 'https://docs.googleapis.com/v1/documents'
  const batchRes = await fetch(`${apiBase}/${id}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requests })
  })
  if (!batchRes.ok) throw new Error(`Inject ${name} failed: HTTP ${batchRes.status}`)
  return id
}

export async function mt19(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!key || !saJson) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
    const prompts: Record<string, string> = {}
    for await (const e of promptClient.listEntities({ queryOptions: { filter: 'is_active eq true' } })) {
      prompts[(e as any).partitionKey] = (e as any).content || ''
    }
    const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
    let masterContext: any = {}
    for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) {
      masterContext = e
    }
    const FAKE_JD = 'VP of Engineering at TechVenture Inc — lead global engineering org, 150+ engineers, cloud-native SaaS.'

    const openai = (system: string, user: string, maxTokens: number) => fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens })
    }).then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(`HTTP ${r.status}: ${t}`) }))

    // Call 1 — resolve Zap placeholders against MasterContext + JD
    const base19 = prompts['resume_user'] || 'Write resume package with ### delimited sections.'
    const resolved19 = resolveZapVars(base19, masterContext, FAKE_JD)
    const call1User19 = resolved19 === base19
      ? `${resolved19}\n\nCONTEXT:\n${JSON.stringify(masterContext)}\n\nJD:\n${FAKE_JD}`
      : resolved19
    const r1 = await openai(prompts['resume_system'] || 'You are an executive resume writer.', call1User19, 16000) as any
    const secs = (r1.choices?.[0]?.message?.content || '').split('###').map((s: string) => s.trim()).filter(Boolean)
    const c1: any = { date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), targetRole: 'VP of Engineering', targetCompany: 'TechVenture Inc', resumeSummary: secs[0] || '', skills1: secs[1] || '', skills2: secs[2] || '', expertise: secs[3] || '', workHistory1: secs[4] || '', workHistory2: secs[5] || '', workHistory3: secs[6] || '', workHistory4: secs[7] || '', relevant1: secs[8] || '', relevant2: secs[9] || '', relevant3: secs[10] || '', coverLetter: secs[11] || '', aboutMe1: secs[12] || '', aboutMe2: secs[13] || '', executiveProfile: secs[14] || '', coreAccomplishments: secs[15] || '' }

    // Call 2
    const r2 = await openai(prompts['portfolio_system'] || 'You are a helpful assistant.', `${prompts['portfolio_user'] || 'Generate portfolio JSON with aboutMe1, aboutMe2, executiveProfile, coverLetter, coldEmail.'}\n\nCALL1:\n${JSON.stringify(c1)}`, 16000) as any
    let c2: any = {}
    try { const m = (r2.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/); if (m) c2 = JSON.parse(m[0]) } catch {}

    // Call 3
    const r3 = await openai(prompts['ats_system'] || 'You are a helpful assistant.', `${prompts['ats_user'] || 'Return JSON: finalSkills1[], finalSkills2[], finalRelevant1, finalRelevant2, finalRelevant3, updatedResumeSummary, jobscanQcTable.'}\n\nINPUTS:\n${JSON.stringify({ ...c1, ...c2 })}`, 15500) as any
    let c3: any = {}
    try { const m = (r3.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/); if (m) c3 = JSON.parse(m[0]) } catch {}

    const pkg = assemblePackage(c1, c2, c3)
    const token = HAS_GOOGLE_OAUTH
      ? await getGoogleOAuthToken()
      : await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/presentations', IMPERSONATE_SUBJECT)
    const company = c1.targetCompany

    const resumeVars: Record<string, string> = { '{{ResumeSummary}}': pkg.ResumeSummary || '', '{{SkillsBullets1}}': pkg.SkillsBullets1 || '', '{{SkillsBullets2}}': pkg.SkillsBullets2 || '', '{{ExpertiseBullets}}': pkg.ExpertiseBullets || '', '{{WorkHistoryBullets1}}': pkg.WorkHistoryBullets1 || '', '{{WorkHistoryBullets2}}': pkg.WorkHistoryBullets2 || '', '{{WorkHistoryBullets3}}': pkg.WorkHistoryBullets3 || '', '{{WorkHistoryBullets4}}': pkg.WorkHistoryBullets4 || '', '{{RelevantBullets1}}': pkg.RelevantBullets1 || '', '{{RelevantBullets2}}': pkg.RelevantBullets2 || '', '{{RelevantBullets3}}': pkg.RelevantBullets3 || '' }
    const portfolioVars: Record<string, string> = { '{{@Company}}': pkg['@Company'] || '', '{{@CoverLetterDate}}': pkg['@CoverLetterDate'] || '', '{{@CoverLetterBody}}': pkg['@CoverLetterBody'] || '', '{{@AboutMe1_50words}}': pkg['@AboutMe1_50words'] || '', '{{@AboutMe2_60words}}': pkg['@AboutMe2_60words'] || '', '{{@ExecutiveProfile_55words}}': pkg['@ExecutiveProfile_55words'] || '', '{{@CoreAccomplishments_5blts_180words}}': pkg['@CoreAccomplishments_5blts_180words'] || '', '{{SoftSkills1}}': Array.isArray(c3.finalSkills1) ? c3.finalSkills1[0] || '' : '', '{{SoftSkills2}}': Array.isArray(c3.finalSkills1) ? c3.finalSkills1[1] || '' : '', '{{HardSkills1}}': Array.isArray(c3.finalSkills2) ? c3.finalSkills2[0] || '' : '', '{{HardSkills2}}': Array.isArray(c3.finalSkills2) ? c3.finalSkills2[1] || '' : '' }

    const [resumeId, portfolioId, coverLetterId] = await Promise.all([
      copyAndInjectDoc(token, RESUME_TEMPLATE_ID, `MT-19 Full Resume — ${company}`, resumeVars, false),
      copyAndInjectDoc(token, PORTFOLIO_TEMPLATE_ID, `MT-19 Portfolio — ${company}`, portfolioVars, true),
      copyAndInjectDoc(token, COVER_LETTER_TEMPLATE_ID, `MT-19 Cover Letter — ${company}`, portfolioVars, true),
    ])

    const urls = {
      fullResume: `https://docs.google.com/document/d/${resumeId}/edit`,
      portfolio: `https://docs.google.com/presentation/d/${portfolioId}/edit`,
      coverLetter: `https://docs.google.com/presentation/d/${coverLetterId}/edit`,
    }
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: '3 of 4 documents generated (compact resume template not seeded yet). Open each URL and verify no placeholders visible.', urls } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt19', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-19', handler: mt19 })

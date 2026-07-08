import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'
import { assemblePackage } from './mt17'
import { resolveZapVars } from './zapVars'
import { getRoleFocus, roleDirective } from './roleFocus'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const RESUME_TEMPLATE_ID = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'
const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'
const FAKE_JD = 'VP of Engineering at TechVenture Inc — lead global engineering org, 150+ engineers, cloud-native SaaS, $25M budget, 15+ yrs exp required.'

export async function mt18(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }
  if (!saJson) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    // Role type drives content focus (Engineering vs Product Management)
    let roleType = 'Engineering'
    try { const body = await req.json() as any; if (body?.roleType) roleType = String(body.roleType) } catch {}
    const roleFocus = await getRoleFocus(roleType)

    // Load prompts + context
    const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
    let systemPrompt = '', userPrompt = ''
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'resume_system' and is_active eq true" } })) {
      systemPrompt = (e as any).content || ''
    }
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'resume_user' and is_active eq true" } })) {
      userPrompt = (e as any).content || ''
    }
    const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
    let masterContext: any = {}
    for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) {
      masterContext = e
    }

    // Resolve Zap {{nodeId__value}} placeholders against MasterContext + JD
    const base18 = userPrompt || 'Write a full resume package with ### delimited sections.'
    const resolved18 = resolveZapVars(base18, masterContext, FAKE_JD)
    const call1User = roleDirective(roleFocus) + (resolved18 === base18
      ? `${resolved18}\n\nCONTEXT:\n${JSON.stringify(masterContext)}\n\nJD:\n${FAKE_JD}`
      : resolved18)

    // Agent Call 1
    const call1Res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt || 'You are an executive resume writer.' },
          { role: 'user', content: call1User }
        ],
        max_tokens: 16000
      })
    })
    if (!call1Res.ok) throw new Error(`Agent Call 1 failed: HTTP ${call1Res.status}`)
    const call1Data = await call1Res.json() as any
    const call1Content = call1Data.choices?.[0]?.message?.content || ''
    const sections = call1Content.split('###').map((s: string) => s.trim()).filter(Boolean)
    const aiCalls = [{
      label: 'Agent Call 1 — Resume Package',
      promptSentToAI: { model: 'gpt-4o-mini', maxTokens: 16000, system: systemPrompt || 'You are an executive resume writer.', user: call1User },
      aiResponse: call1Content
    }]

    // Simple section parser — map by index or keyword
    const call1: any = {
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      targetRole: 'VP of Engineering', targetCompany: 'TechVenture Inc',
      resumeSummary: sections[0] || '', skills1: sections[1] || '', skills2: sections[2] || '',
      expertise: sections[3] || '', workHistory1: sections[4] || '', workHistory2: sections[5] || '',
      workHistory3: sections[6] || '', workHistory4: sections[7] || '',
      relevant1: sections[8] || '', relevant2: sections[9] || '', relevant3: sections[10] || '',
      coverLetter: sections[11] || '', aboutMe1: sections[12] || '', aboutMe2: sections[13] || '',
      executiveProfile: sections[14] || '', coreAccomplishments: sections[15] || ''
    }

    // Assemble package with mock call2/call3
    const pkg = assemblePackage(call1, { aboutMe1: call1.aboutMe1, aboutMe2: call1.aboutMe2, executiveProfile: call1.executiveProfile, coverLetter: call1.coverLetter, coldEmail: '' }, { finalSkills1: call1.skills1.split('|'), finalSkills2: call1.skills2.split('|'), finalRelevant1: call1.relevant1, finalRelevant2: call1.relevant2, finalRelevant3: call1.relevant3, updatedResumeSummary: call1.resumeSummary })

    // Populate Google Doc
    const token = HAS_GOOGLE_OAUTH
      ? await getGoogleOAuthToken()
      : await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents', IMPERSONATE_SUBJECT)
    const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${RESUME_TEMPLATE_ID}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `MT-18 Full Resume — ${call1.targetCompany}`, parents: [OUTPUT_FOLDER_ID] })
    })
    if (!copyRes.ok) throw new Error(`Doc copy failed: HTTP ${copyRes.status}`)
    const { id: docId } = await copyRes.json() as any

    const varMap: Record<string, string> = {
      '{{ResumeSummary}}': pkg.ResumeSummary || '',
      '{{SkillsBullets1}}': pkg.SkillsBullets1 || '',
      '{{SkillsBullets2}}': pkg.SkillsBullets2 || '',
      '{{ExpertiseBullets}}': pkg.ExpertiseBullets || '',
      '{{WorkHistoryBullets1}}': pkg.WorkHistoryBullets1 || '',
      '{{WorkHistoryBullets2}}': pkg.WorkHistoryBullets2 || '',
      '{{WorkHistoryBullets3}}': pkg.WorkHistoryBullets3 || '',
      '{{WorkHistoryBullets4}}': pkg.WorkHistoryBullets4 || '',
      '{{RelevantBullets1}}': pkg.RelevantBullets1 || '',
      '{{RelevantBullets2}}': pkg.RelevantBullets2 || '',
      '{{RelevantBullets3}}': pkg.RelevantBullets3 || '',
    }
    const requests = Object.entries(varMap).map(([find, replace]) => ({
      replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace }
    }))
    const batchRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests })
    })
    if (!batchRes.ok) throw new Error(`batchUpdate failed: HTTP ${batchRes.status}`)

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Full resume doc created for ${roleType} focus. Open and verify all placeholders replaced: ${docUrl}`, roleType, roleFocus, docId, docUrl, aiCalls } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt18', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-18', handler: mt18 })

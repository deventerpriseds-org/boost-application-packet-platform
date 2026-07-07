import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const FAKE_JD = `We are seeking a VP of Engineering to lead our global engineering organization at TechVenture Inc. The ideal candidate will have 15+ years of experience in enterprise software leadership, with a proven track record of scaling engineering teams, driving digital transformation, and delivering cloud-native SaaS platforms.`

const REQUIRED_SECTIONS = ['date', 'targetRole', 'targetCompany', 'resumeSummary', 'skills1', 'skills2', 'expertise', 'relevant1', 'relevant2', 'relevant3', 'coverLetter', 'aboutMe1', 'aboutMe2', 'executiveProfile', 'coreAccomplishments']

export async function mt14(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  try {
    // Load prompts
    const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
    let systemPrompt = '', userPrompt = ''
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'resume_system' and is_active eq true" } })) {
      systemPrompt = (e as any).content || ''
    }
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'resume_user' and is_active eq true" } })) {
      userPrompt = (e as any).content || ''
    }

    // Load master context
    const ctxClient = TableClient.fromConnectionString(CONN, 'MasterContext')
    let masterContext = ''
    for await (const e of ctxClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) {
      masterContext = JSON.stringify(e)
    }

    const finalSystem = systemPrompt || 'You are an executive recruiter. Create a tailored resume optimized for ATS.'
    const finalUser = (userPrompt || 'Generate a complete resume package with 14+ sections delimited by ###.') +
      `\n\nMASTER CONTEXT:\n${masterContext}\n\nJOB DESCRIPTION:\n${FAKE_JD}`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: finalSystem }, { role: 'user', content: finalUser }],
        max_tokens: 16000
      })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || ''
    const sections = content.split('###').map((s: string) => s.trim()).filter(Boolean)

    if (sections.length < 14) {
      return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: `Only ${sections.length} sections returned (need 14+). Check prompt.`, sections } }
    }
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `${sections.length} sections returned.`, sectionCount: sections.length, sections } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt14', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-14', handler: mt14 })

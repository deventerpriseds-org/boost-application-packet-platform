import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const MOCK_MT14_OUTPUT = {
  targetRole: 'VP of Engineering',
  targetCompany: 'TechVenture Inc',
  resumeSummary: 'Visionary technology executive with 20+ years driving digital transformation across enterprise software platforms.',
  skills1: 'Enterprise Architecture | Cloud Strategy | DevSecOps',
  skills2: 'Agile Transformation | SaaS Platforms | M&A Integration',
  expertise: 'Digital Transformation | Engineering Leadership | Platform Modernization',
  coverLetter: 'Dear Hiring Manager, I am excited to apply for the VP of Engineering role at TechVenture Inc...',
  aboutMe1: 'I lead with innovation and build high-performing engineering cultures.',
  aboutMe2: 'As a technology executive I have scaled organizations from 20 to 150+ engineers across global markets.',
  executiveProfile: 'Technology executive with proven track record of delivering enterprise platforms at scale.',
  coreAccomplishments: '• Led $25M digital transformation program\n• Scaled engineering org from 40 to 150+ engineers\n• Delivered 3 SaaS platforms to market'
}

function countWords(s: string) { return s.trim().split(/\s+/).length }

export async function mt15(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  try {
    const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
    let systemPrompt = '', userPrompt = ''
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'portfolio_system' and is_active eq true" } })) {
      systemPrompt = (e as any).content || ''
    }
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'portfolio_user' and is_active eq true" } })) {
      userPrompt = (e as any).content || ''
    }

    const finalSystem = systemPrompt || 'You are a helpful assistant.'
    const finalUser = (userPrompt || 'Generate portfolio content with fields: aboutMe1 (45-55 words), aboutMe2 (70-85 words), executiveProfile (45-60 words), coverLetter (250-400 words), coldEmail. Return as JSON.') +
      `\n\nCALL 1 OUTPUTS:\n${JSON.stringify(MOCK_MT14_OUTPUT)}`

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

    // Try to parse JSON from response
    let parsed: any = {}
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
    } catch { parsed = { raw: content } }

    const checks: string[] = []
    const fields = ['aboutMe1', 'aboutMe2', 'executiveProfile', 'coverLetter', 'coldEmail']
    const missing = fields.filter(f => !parsed[f])
    if (missing.length > 0) checks.push(`Missing fields: ${missing.join(', ')}`)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: missing.length === 0,
        detail: missing.length === 0 ? 'All 5 portfolio fields present.' : checks.join('; '),
        wordCounts: {
          aboutMe1: parsed.aboutMe1 ? countWords(parsed.aboutMe1) : 0,
          aboutMe2: parsed.aboutMe2 ? countWords(parsed.aboutMe2) : 0,
          executiveProfile: parsed.executiveProfile ? countWords(parsed.executiveProfile) : 0,
          coverLetter: parsed.coverLetter ? countWords(parsed.coverLetter) : 0,
        },
        output: parsed
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt15', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-15', handler: mt15 })

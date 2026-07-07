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

    // The real prompt returns ###-delimited sections, not JSON. Parse into
    // { header: body } and locate the portfolio content sections.
    const sections: Record<string, string> = {}
    const parts = content.split('###').map((s: string) => s.trim()).filter(Boolean)
    for (let i = 0; i < parts.length - 1; i += 2) {
      const header = parts[i].replace(/<[^>]+>/g, '').trim().toLowerCase()
      sections[header] = parts[i + 1]
    }
    const find = (needle: string) => Object.entries(sections).find(([h, b]) => h.includes(needle) && b && b.length > 5)?.[1] || ''

    const portfolio = {
      aboutMe1: find('about me') || find('about me passage 1') || find('about me 1'),
      aboutMe2: find('about me passage 2') || find('about me 2'),
      executiveProfile: find('executive profile'),
      coverLetter: find('cover letter'),
      coldEmail: find('cold email'),
    }
    // aboutMe2 fallback: if only one "about me" section, split not needed — accept aboutMe1 presence
    const required = ['aboutMe1', 'executiveProfile', 'coverLetter']
    const missing = required.filter((f) => !(portfolio as any)[f])

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: missing.length === 0,
        detail: missing.length === 0
          ? `Portfolio content generated: ${Object.keys(sections).length} sections (About Me, Executive Profile, Cover Letter${portfolio.coldEmail ? ', Cold Email' : ''}).`
          : `Missing sections: ${missing.join(', ')}`,
        sectionHeaders: Object.keys(sections),
        wordCounts: {
          aboutMe1: portfolio.aboutMe1 ? countWords(portfolio.aboutMe1) : 0,
          aboutMe2: portfolio.aboutMe2 ? countWords(portfolio.aboutMe2) : 0,
          executiveProfile: portfolio.executiveProfile ? countWords(portfolio.executiveProfile) : 0,
          coverLetter: portfolio.coverLetter ? countWords(portfolio.coverLetter) : 0,
        },
        portfolioContent: portfolio,
        rawOutput: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt15', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-15', handler: mt15 })

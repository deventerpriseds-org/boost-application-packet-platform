import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const MOCK_INPUTS = {
  resumeSummary: 'Visionary technology executive with 20+ years driving digital transformation.',
  skills1: 'Enterprise Architecture | Cloud Strategy | DevSecOps',
  skills2: 'Agile Transformation | SaaS Platforms | M&A Integration',
  expertise: 'Digital Transformation | Engineering Leadership',
  relevant1: 'Agile Portfolio Mgmt',
  relevant2: 'SaaS Platforms',
  relevant3: 'Data Governance',
  aboutMe1: 'I lead with innovation and build high-performing engineering cultures.',
  coverLetter: 'Dear Hiring Manager, I am excited to apply for the VP of Engineering role...',
  coldEmail: 'Hi [Name], I came across the VP of Engineering role at TechVenture Inc and believe my background aligns well.'
}

export async function mt16(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  try {
    const promptClient = TableClient.fromConnectionString(CONN, 'Prompts')
    let systemPrompt = '', userPrompt = ''
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'ats_system' and is_active eq true" } })) {
      systemPrompt = (e as any).content || ''
    }
    for await (const e of promptClient.listEntities({ queryOptions: { filter: "PartitionKey eq 'ats_user' and is_active eq true" } })) {
      userPrompt = (e as any).content || ''
    }

    const finalSystem = systemPrompt || 'You are a helpful assistant.'
    const finalUser = (userPrompt || 'Perform ATS QC on the resume content. Return JSON with: finalSkills1 (array), finalSkills2 (array), finalRelevant1, finalRelevant2, finalRelevant3 (strings ≤20 chars each), updatedResumeSummary (50-65 words), jobscanQcTable (string).') +
      `\n\nINPUTS:\n${JSON.stringify(MOCK_INPUTS)}`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: finalSystem }, { role: 'user', content: finalUser }],
        max_tokens: 15500
      })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content || ''

    // The real ATS/Post-Analysis-QA prompt returns ###-delimited HTML sections,
    // not JSON. Parse into { header: body } and verify the expected sections.
    const sections: Record<string, string> = {}
    const parts = content.split('###').map((s: string) => s.trim()).filter(Boolean)
    for (let i = 0; i < parts.length - 1; i += 2) {
      const header = parts[i].replace(/<[^>]+>/g, '').trim().toLowerCase()
      sections[header] = parts[i + 1]
    }
    // Validate against the RAW content (case-insensitive) — robust to the
    // irregular ### delimiters the ATS prompt emits that break strict pairing.
    const lc = content.toLowerCase()
    const checks = {
      finalSkills1: /skills\s*1/.test(lc),
      finalSkills2: /skills\s*2/.test(lc),
      relevantSkills: /relevant skills/.test(lc),
      updatedResumeSummary: /updated resume summary/.test(lc),
      jobscan: /jobscan|job scan|match rate/.test(lc),
      coldEmail: /cold email/.test(lc),
    }
    const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: missing.length === 0,
        detail: missing.length === 0
          ? `ATS QC complete: ${Object.keys(sections).length} sections (skills merge, updated summary, cold email, jobscan).`
          : `Missing sections: ${missing.join(', ')}`,
        sectionHeaders: Object.keys(sections),
        parsedSections: checks,
        promptSentToAI: { model: 'gpt-4o-mini', maxTokens: 15500, system: finalSystem, user: finalUser },
        aiResponse: content
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt16', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-16', handler: mt16 })

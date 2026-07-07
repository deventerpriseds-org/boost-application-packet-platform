import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const PORTFOLIO_TEMPLATE_ID = '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec'
const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'

const PORTFOLIO_VARS: Record<string, string> = {
  '{{@Company}}': 'TechVenture Inc',
  '{{@CoverLetterDate}}': 'July 7, 2026',
  '{{@CoverLetterBody}}': 'TEST COVER LETTER BODY — placeholder for full letter content',
  '{{@AboutMe1_50words}}': 'TEST ABOUT ME 1 — executive innovation philosophy statement approximately fifty words in length for testing purposes only delete before production use',
  '{{@AboutMe2_60words}}': 'TEST ABOUT ME 2 — career narrative statement approximately sixty words in length for testing purposes only delete before production use',
  '{{@ExecutiveProfile_55words}}': 'TEST EXECUTIVE PROFILE — as a technology executive statement approximately fifty-five words for testing purposes only',
  '{{@CoreAccomplishments_5blts_180words}}': 'TEST CORE ACCOMPLISHMENTS — five bullet points totaling approximately one hundred eighty words for testing',
  '{{SoftSkills1}}': 'Strategic Vision',
  '{{SoftSkills2}}': 'Executive Presence',
  '{{HardSkills1}}': 'Cloud Architecture',
  '{{HardSkills2}}': 'Enterprise SaaS',
}

export async function mt06(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    const token = await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/presentations')

    const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${PORTFOLIO_TEMPLATE_ID}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'MT-06 Slides Inject Test - DELETE ME', parents: [OUTPUT_FOLDER_ID] })
    })
    if (!copyRes.ok) throw new Error(`Copy failed: HTTP ${copyRes.status} ${await copyRes.text()}`)
    const { id: presId } = await copyRes.json() as any

    const requests = Object.entries(PORTFOLIO_VARS).map(([find, replace]) => ({
      replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace }
    }))
    const batchRes = await fetch(`https://slides.googleapis.com/v1/presentations/${presId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests })
    })
    if (!batchRes.ok) throw new Error(`batchUpdate failed: HTTP ${batchRes.status} ${await batchRes.text()}`)

    const deckUrl = `https://docs.google.com/presentation/d/${presId}/edit`
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Variables injected. Open to verify: ${deckUrl}`, presId, deckUrl } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt06', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-06', handler: mt06 })

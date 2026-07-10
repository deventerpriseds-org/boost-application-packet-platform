import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleToken, getGoogleOAuthToken, HAS_GOOGLE_OAUTH, IMPERSONATE_SUBJECT } from './googleAuth'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const RESUME_TEMPLATE_ID = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'
const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'

const RESUME_VARS: Record<string, string> = {
  '{{ResumeSummary}}': 'TEST SUMMARY — ATS optimized executive statement',
  '{{SkillsBullets1}}': 'Enterprise Architecture',
  '{{SkillsBullets2}}': 'Cloud Strategy',
  '{{ExpertiseBullets}}': 'Digital Transformation Leadership',
  '{{WorkHistoryBullets1}}': 'Led enterprise software strategy across 15 global markets',
  '{{WorkHistoryBullets2}}': 'Directed digital engineering organization of 120+ engineers',
  '{{WorkHistoryBullets3}}': 'Architected corporate information solutions platform',
  '{{WorkHistoryBullets4}}': 'Delivered GIS and water infrastructure analytics systems',
  '{{RelevantBullets1}}': 'Agile Portfolio Mgmt',
  '{{RelevantBullets2}}': 'SaaS Platforms',
  '{{RelevantBullets3}}': 'Data Governance',
}

export async function mt05(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' } }

  try {
    const token = HAS_GOOGLE_OAUTH
      ? await getGoogleOAuthToken()
      : await getGoogleToken(saJson, 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents', IMPERSONATE_SUBJECT)

    // Copy template
    const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${RESUME_TEMPLATE_ID}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'MT-05 Variable Injection Test - DELETE ME', parents: [OUTPUT_FOLDER_ID] })
    })
    if (!copyRes.ok) throw new Error(`Copy failed: HTTP ${copyRes.status} ${await copyRes.text()}`)
    const { id: docId } = await copyRes.json() as any

    // Inject variables
    const requests = Object.entries(RESUME_VARS).map(([find, replace]) => ({
      replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace }
    }))
    const batchRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests })
    })
    if (!batchRes.ok) throw new Error(`batchUpdate failed: HTTP ${batchRes.status} ${await batchRes.text()}`)

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`
    return { status: 200, headers: HEADERS, jsonBody: { pass: true, detail: `Variables injected. Open to verify: ${docUrl}`, docId, docUrl } }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt05', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-05', handler: mt05 })

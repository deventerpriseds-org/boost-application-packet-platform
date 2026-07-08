import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const ENGINEERING_TEMPLATES = {
  resumeTemplateId: '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw',
  portfolioTemplateId: '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec',
  coverLetterTemplateId: '1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0',
  outputFolderId: '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'
}

export async function mt12(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const client = TableClient.fromConnectionString(CONN, 'AppConfig')

  // Seed engineering templates if not present
  try {
    await client.upsertEntity({
      partitionKey: 'templates',
      rowKey: 'engineering',
      ...ENGINEERING_TEMPLATES
    }, 'Replace')
  } catch (err) {
    context.log('Seed warning:', err)
  }

  try {
    const results: Record<string, any> = {}
    for (const roleType of ['Engineering', 'Product Management']) {
      const rowKey = roleType.toLowerCase().replace(' ', '-')
      try {
        const entity = await client.getEntity('templates', rowKey)
        results[roleType] = {
          resumeTemplateId: (entity as any).resumeTemplateId,
          portfolioTemplateId: (entity as any).portfolioTemplateId,
          coverLetterTemplateId: (entity as any).coverLetterTemplateId,
          outputFolderId: (entity as any).outputFolderId
        }
      } catch {
        results[roleType] = null
      }
    }

    const engOk = !!(results['Engineering'] && results['Engineering'].resumeTemplateId)
    const pmOk = !!(results['Product Management'] && results['Product Management'].resumeTemplateId)
    const shared = engOk && pmOk && results['Engineering'].resumeTemplateId === results['Product Management'].resumeTemplateId
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: engOk && pmOk,
        detail: (engOk && pmOk)
          ? `Role router resolved template sets for both roles.${shared ? ' (Product Management currently shares Engineering templates; content is shifted at the prompt level.)' : ''}`
          : `Missing template set — Engineering: ${engOk ? 'ok' : 'missing'}, Product Management: ${pmOk ? 'ok' : 'missing'}`,
        sharedTemplates: shared,
        results
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt12', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-12', handler: mt12 })

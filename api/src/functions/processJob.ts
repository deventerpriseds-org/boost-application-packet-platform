import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!

export async function processJob(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('processJob triggered')

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    }
  }

  try {
    const body = await req.json() as Record<string, unknown>
    context.log('Received job payload:', JSON.stringify(body).slice(0, 200))

    const jobId = `job-${Date.now()}`
    const timestamp = new Date().toISOString()

    // Log to JobApplications table
    const client = TableClient.fromConnectionString(CONN, 'JobApplications')
    await client.createEntity({
      partitionKey: 'applications',
      rowKey: jobId,
      JobTitle: String(body.jobTitle || ''),
      Company: String(body.company || ''),
      RoleType: String(body.roleType || ''),
      SendToEmail: String(body.sendToEmail || ''),
      Status: 'received',
      ReceivedAt: timestamp,
      Payload: JSON.stringify(body).slice(0, 32000)
    })

    context.log(`Job logged to table: ${jobId}`)

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      jsonBody: {
        success: true,
        jobId,
        message: 'Job received and logged. Awaiting approval.',
        receivedAt: timestamp
      }
    }
  } catch (err) {
    context.log('Error in processJob:', err)
    return {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      jsonBody: { success: false, error: String(err) }
    }
  }
}

app.http('processJob', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: processJob
})

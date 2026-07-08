import { Client } from 'pg'

// Returns a connected node-postgres Client for the RAG_AI_Agents database.
// Reads DATABASE_URL (preferred) or the discrete AZURE_PG_* app settings.
// The caller MUST call client.end() when done. TLS is required by Azure PG
// Flexible Server; we don't verify the CA chain here (rejectUnauthorized:false)
// since we connect by trusted hostname over the Azure backbone.
export async function getPgClient(): Promise<Client> {
  const url = process.env.DATABASE_URL
  let client: Client
  if (url) {
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  } else {
    const host = process.env.AZURE_PG_HOST
    const database = process.env.AZURE_PG_DATABASE || 'RAG_AI_Agents'
    const user = process.env.AZURE_PG_USER
    const password = process.env.AZURE_PG_PASSWORD
    if (!host || !user || !password) {
      throw new Error('DATABASE_URL not set (and AZURE_PG_HOST/USER/PASSWORD incomplete). Set the RAG_AI_Agents connection string on the Function App.')
    }
    client = new Client({ host, port: Number(process.env.AZURE_PG_PORT || 5432), database, user, password, ssl: { rejectUnauthorized: false } })
  }
  await client.connect()
  return client
}

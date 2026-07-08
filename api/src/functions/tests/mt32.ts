import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

async function embed(key: string, text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  })
  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}: ${await res.text()}`)
  return ((await res.json()) as any).data[0].embedding
}

// MT-32 — Dedupe. Seeds an existing opportunity's embedding, then checks an
// incoming near-duplicate against it via pgvector cosine similarity and returns
// a skip-dupe decision above a threshold. This is the watcher's dedupe stage.
export async function mt32(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  const THRESHOLD = 0.85 // cosine similarity above which we treat as a duplicate
  let client
  try {
    const existing = 'VP of Engineering at TechVenture Inc — San Francisco — lead 150-person cloud SaaS engineering org.'
    const incomingDup = 'Vice President, Engineering — TechVenture Inc (SF) — lead the ~150 person engineering organization for a cloud SaaS product.'
    const incomingNew = 'Chief Marketing Officer at RetailBrands — New York — own global brand and demand generation.'

    const [ve, vd, vn] = await Promise.all([embed(key, existing), embed(key, incomingDup), embed(key, incomingNew)])
    const dim = ve.length
    const toVec = (a: number[]) => `[${a.join(',')}]`

    client = await getPgClient()
    const table = `mt32_dedupe_${Date.now()}`
    await client.query(`create temp table "${table}" (id int, v vector(${dim}))`)
    await client.query(`insert into "${table}" values (1,$1)`, [toVec(ve)])

    // cosine similarity = 1 - cosine distance
    const check = async (v: number[]) => {
      const r = await client!.query(`select 1 - (v <=> $1::vector) as similarity from "${table}" order by similarity desc limit 1`, [toVec(v)])
      return Number(r.rows[0].similarity)
    }
    const dupSim = await check(vd)
    const newSim = await check(vn)

    const dupIsDuplicate = dupSim >= THRESHOLD
    const newIsDuplicate = newSim >= THRESHOLD
    const pass = dupIsDuplicate && !newIsDuplicate

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Dedupe correct: near-duplicate similarity ${dupSim.toFixed(3)} ≥ ${THRESHOLD} (SKIP); new role ${newSim.toFixed(3)} < ${THRESHOLD} (KEEP).`
          : `Dedupe misclassified — dup sim ${dupSim.toFixed(3)}, new sim ${newSim.toFixed(3)}, threshold ${THRESHOLD}`,
        threshold: THRESHOLD,
        nearDuplicate: { similarity: dupSim, decision: dupIsDuplicate ? 'skip-duplicate' : 'keep' },
        differentRole: { similarity: newSim, decision: newIsDuplicate ? 'skip-duplicate' : 'keep' }
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt32', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-32', handler: mt32 })

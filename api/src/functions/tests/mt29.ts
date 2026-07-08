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
  const data = await res.json() as any
  return data.data[0].embedding
}

// MT-29 — Embeddings + pgvector similarity. Embeds an anchor + a near-duplicate
// + an unrelated string, stores them in a pgvector column, and confirms cosine
// distance ranks the near-duplicate closest. Proves the dedupe/match backbone.
export async function mt29(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  let client
  try {
    const anchor = 'VP of Engineering at TechVenture Inc — lead global engineering org, cloud-native SaaS.'
    const dup = 'Vice President of Engineering, TechVenture Inc — lead the global engineering organization for a cloud SaaS platform.'
    const other = 'Senior Marketing Manager at RetailCo — own brand campaigns and social strategy.'

    const [va, vd, vo] = await Promise.all([embed(key, anchor), embed(key, dup), embed(key, other)])
    const dim = va.length

    client = await getPgClient()
    const table = `mt29_vec_${Date.now()}`
    await client.query(`create temp table "${table}" (id int, label text, v vector(${dim}))`)
    const toVec = (arr: number[]) => `[${arr.join(',')}]`
    await client.query(`insert into "${table}" values (1,'duplicate',$1),(2,'unrelated',$2)`, [toVec(vd), toVec(vo)])

    // cosine distance (<=>) from the anchor; lower = more similar
    const q = await client.query(
      `select label, (v <=> $1::vector) as cos_distance from "${table}" order by cos_distance asc`,
      [toVec(va)]
    )
    const ranked = q.rows.map((r: any) => ({ label: r.label, cosDistance: Number(r.cos_distance) }))
    const closest = ranked[0]
    const pass = closest?.label === 'duplicate'

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Embedded 3 strings (dim ${dim}). Near-duplicate ranked closest (cos ${closest.cosDistance.toFixed(4)}) vs unrelated (${ranked[1]?.cosDistance.toFixed(4)}).`
          : `Ranking unexpected — closest was "${closest?.label}"`,
        embeddingDim: dim,
        ranking: ranked
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt29', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-29', handler: mt29 })

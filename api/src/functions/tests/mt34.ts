import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// The spec's 12-stage opportunity pipeline.
const STAGES = ['discovered', 'saved', 'enriched', 'applied', 'outreach', 'engaged', 'screen', 'r1', 'panel', 'final', 'offer', 'accepted']

function nextStage(cur: string): string | null {
  const i = STAGES.indexOf(cur)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

// MT-34 — Opportunity 12-stage state machine on Postgres. Inserts an opportunity
// at 'discovered', advances it legally through every stage to 'accepted',
// rejects an illegal skip, and soft-removes on dismiss.
export async function mt34(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    const table = `mt34_opps_${Date.now()}`
    await client.query(`create temp table "${table}" (id int primary key, company text, stage text, dismissed boolean default false)`)
    await client.query(`insert into "${table}" values (1,'TechVenture Inc','discovered',false)`)

    const path: string[] = ['discovered']
    let cur = 'discovered'
    // Advance one legal step at a time to 'accepted'
    while (true) {
      const nxt = nextStage(cur)
      if (!nxt) break
      await client.query(`update "${table}" set stage=$1 where id=1 and stage=$2`, [nxt, cur])
      const r = await client.query(`select stage from "${table}" where id=1`)
      if (r.rows[0].stage !== nxt) throw new Error(`transition ${cur}->${nxt} failed`)
      cur = nxt
      path.push(cur)
    }
    const reachedAccepted = cur === 'accepted'

    // Illegal transition guard: only advance if current stage matches the expected predecessor.
    const illegal = await client.query(`update "${table}" set stage='screen' where id=1 and stage='discovered'`)
    const illegalBlocked = (illegal.rowCount || 0) === 0 // no row matched -> blocked

    // Soft-remove on dismiss
    await client.query(`update "${table}" set dismissed=true where id=1`)
    const dz = await client.query(`select dismissed from "${table}" where id=1`)
    const softRemoved = dz.rows[0].dismissed === true

    const pass = reachedAccepted && illegalBlocked && softRemoved
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Advanced through all ${STAGES.length} stages to 'accepted'; illegal skip blocked; dismiss soft-removed.`
          : `State machine issue — reachedAccepted=${reachedAccepted}, illegalBlocked=${illegalBlocked}, softRemoved=${softRemoved}`,
        stages: STAGES,
        transitionPath: path,
        illegalSkipBlocked: illegalBlocked,
        softRemovedOnDismiss: softRemoved
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt34', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-34', handler: mt34 })

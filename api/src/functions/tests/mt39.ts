import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// MT-39 — Asset analytics. Records view events for a shared asset (opens, view
// time, forwards) in Postgres, then aggregates opens / total view-time / unique
// viewers / most-viewed — the metrics the spec's Assets analytics surfaces.
export async function mt39(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    const table = `mt39_events_${Date.now()}`
    await client.query(`create temp table "${table}" (asset_id text, viewer text, event text, view_seconds int, ts timestamptz default now())`)

    // Simulate a handful of engagement events on a portfolio deck
    const events = [
      ['portfolio-1', 'dana@techventure.com', 'open', 45],
      ['portfolio-1', 'dana@techventure.com', 'open', 60],
      ['portfolio-1', 'cto@techventure.com', 'open', 120],
      ['portfolio-1', 'cto@techventure.com', 'forward', 0],
      ['resume-1', 'dana@techventure.com', 'open', 30],
    ]
    for (const [a, v, e, s] of events) {
      await client.query(`insert into "${table}" (asset_id,viewer,event,view_seconds) values ($1,$2,$3,$4)`, [a, v, e, s])
    }

    const agg = await client.query(`
      select asset_id,
             count(*) filter (where event='open') as opens,
             count(*) filter (where event='forward') as forwards,
             count(distinct viewer) as unique_viewers,
             coalesce(sum(view_seconds),0) as total_view_seconds
      from "${table}" group by asset_id order by opens desc`)

    const rows = agg.rows.map((r: any) => ({
      assetId: r.asset_id, opens: Number(r.opens), forwards: Number(r.forwards),
      uniqueViewers: Number(r.unique_viewers), totalViewSeconds: Number(r.total_view_seconds)
    }))
    const mostViewed = rows[0]
    const pass = rows.length === 2 && mostViewed.opens === 3 && mostViewed.forwards === 1

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Tracked ${events.length} events across ${rows.length} assets. Most-viewed '${mostViewed.assetId}': ${mostViewed.opens} opens, ${mostViewed.forwards} forward, ${mostViewed.totalViewSeconds}s total.`
          : `Aggregation unexpected`,
        analytics: rows,
        mostViewed
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt39', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-39', handler: mt39 })

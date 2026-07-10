import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// GET /api/app/usage — running AI spend: totals, per-feature, per-model, per-day,
// and recent calls. Reads the usage_metering table written by usageMeter.logUsage.
export async function usageSummary(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    // Table + feature column may not exist on a brand-new DB.
    await client.query(`create table if not exists usage_metering (
      id bigserial primary key, model text, feature text, prompt_tokens int,
      completion_tokens int, cost_usd numeric(12,8), ts timestamptz not null default now())`)
    await client.query(`alter table usage_metering add column if not exists feature text`)

    const total = (await client.query(
      `select count(*)::int as calls,
              coalesce(sum(prompt_tokens+completion_tokens),0)::bigint as tokens,
              coalesce(sum(cost_usd),0)::numeric as cost
         from usage_metering`)).rows[0]
    const byFeature = (await client.query(
      `select coalesce(feature,'other') as feature, count(*)::int as calls,
              coalesce(sum(cost_usd),0)::numeric as cost
         from usage_metering group by 1 order by cost desc limit 20`)).rows
    const byModel = (await client.query(
      `select coalesce(model,'?') as model, count(*)::int as calls,
              coalesce(sum(cost_usd),0)::numeric as cost
         from usage_metering group by 1 order by cost desc`)).rows
    const byDay = (await client.query(
      `select to_char(date_trunc('day', ts), 'YYYY-MM-DD') as day, count(*)::int as calls,
              coalesce(sum(cost_usd),0)::numeric as cost
         from usage_metering group by 1 order by 1 desc limit 14`)).rows
    const recent = (await client.query(
      `select feature, model, prompt_tokens, completion_tokens, cost_usd, ts
         from usage_metering order by ts desc limit 15`)).rows

    const num = (x: any) => Number(x || 0)
    return {
      status: 200, headers: HEADERS, jsonBody: {
        total: { calls: total.calls, tokens: num(total.tokens), costUsd: num(total.cost) },
        byFeature: byFeature.map((r: any) => ({ feature: r.feature, calls: r.calls, costUsd: num(r.cost) })),
        byModel: byModel.map((r: any) => ({ model: r.model, calls: r.calls, costUsd: num(r.cost) })),
        byDay: byDay.map((r: any) => ({ day: r.day, calls: r.calls, costUsd: num(r.cost) })),
        recent: recent.map((r: any) => ({ feature: r.feature, model: r.model, promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens, costUsd: num(r.cost_usd), ts: r.ts })),
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('usageSummary', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/usage', handler: usageSummary })

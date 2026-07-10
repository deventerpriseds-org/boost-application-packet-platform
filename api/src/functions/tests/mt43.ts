import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// gpt-4o-mini pricing (USD per 1M tokens) — used for cost estimation.
const PRICE_IN = 0.15 / 1_000_000
const PRICE_OUT = 0.60 / 1_000_000

// MT-43 — OpenAI cost/token metering. Makes a real completion, reads the `usage`
// block, computes cost, logs a row to a persistent usage_metering table, and
// returns this call's cost plus the running total. Proves cost observability.
export async function mt43(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: 'OPENAI_API_KEY not set' } }

  let client
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Summarize executive job-search automation in one sentence.' }], max_tokens: 60 })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json() as any
    const usage = data.usage || {}
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0
    const cost = promptTokens * PRICE_IN + completionTokens * PRICE_OUT

    client = await getPgClient()
    // Persistent table so cost accumulates across calls (real observability).
    await client.query(`create table if not exists usage_metering (
      id bigserial primary key, model text, prompt_tokens int, completion_tokens int,
      cost_usd numeric(12,8), ts timestamptz default now())`)
    await client.query(`insert into usage_metering (model, prompt_tokens, completion_tokens, cost_usd) values ($1,$2,$3,$4)`,
      ['gpt-4o-mini', promptTokens, completionTokens, cost])
    const agg = await client.query(`select count(*) as calls, coalesce(sum(cost_usd),0) as total_cost, coalesce(sum(prompt_tokens+completion_tokens),0) as total_tokens from usage_metering`)
    const row = agg.rows[0]

    const pass = promptTokens > 0 && completionTokens > 0 && cost > 0
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: pass
          ? `Metered call: ${promptTokens}+${completionTokens} tokens = $${cost.toFixed(6)}. Running total: ${row.calls} calls, ${row.total_tokens} tokens, $${Number(row.total_cost).toFixed(6)}.`
          : `No usage returned from OpenAI`,
        thisCall: { model: 'gpt-4o-mini', promptTokens, completionTokens, costUsd: cost },
        runningTotal: { calls: Number(row.calls), totalTokens: Number(row.total_tokens), totalCostUsd: Number(row.total_cost) }
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt43', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-43', handler: mt43 })

import { getPgClient } from './pgClient'

// Per-token USD pricing by model (input, output). Embeddings bill input only.
const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15 / 1e6, out: 0.60 / 1e6 },
  'gpt-4o': { in: 2.50 / 1e6, out: 10.0 / 1e6 },
  'text-embedding-3-small': { in: 0.02 / 1e6, out: 0 },
  'whisper-1': { in: 0, out: 0 }, // billed per-minute; token cost n/a
}

export function costOf(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICES[model] || PRICES['gpt-4o-mini']
  return promptTokens * p.in + completionTokens * p.out
}

// Best-effort: log one metered call to usage_metering. Never throws — metering
// must not break the feature it measures. Opens its own short-lived client.
export async function logUsage(feature: string, model: string, usage: any): Promise<void> {
  try {
    const promptTokens = usage?.prompt_tokens || 0
    const completionTokens = usage?.completion_tokens || 0
    if (!promptTokens && !completionTokens) return
    const cost = costOf(model, promptTokens, completionTokens)
    let client
    try {
      client = await getPgClient()
      await client.query(`create table if not exists usage_metering (
        id bigserial primary key, model text, feature text, prompt_tokens int,
        completion_tokens int, cost_usd numeric(12,8), ts timestamptz not null default now())`)
      await client.query(`alter table usage_metering add column if not exists feature text`)
      await client.query(
        `insert into usage_metering (model, feature, prompt_tokens, completion_tokens, cost_usd) values ($1,$2,$3,$4,$5)`,
        [model, feature, promptTokens, completionTokens, cost]
      )
    } finally { try { await client?.end() } catch {} }
  } catch { /* swallow — metering is non-critical */ }
}

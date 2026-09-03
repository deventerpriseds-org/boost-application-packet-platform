import { getPgClient } from './pgClient'

// D8 - what this file gets wrong when it is left alone.
//
// 1. SHAPE. The Chat Completions API returns `prompt_tokens`/`completion_tokens`; the Responses API
//    returns `input_tokens`/`output_tokens`. This function read only the first pair, so every call
//    made through the Responses API - `packet:ai-edit` among them - matched neither field, hit the
//    `if (!promptTokens && !completionTokens) return` guard, and recorded NOTHING. The dashboard was
//    not under-reporting those calls, it had never seen one.
// 2. PRICE. An unknown model silently billed at gpt-4o-mini's rate. That is a fabricated number: it
//    is wrong by whatever the real model costs, and it is indistinguishable in the table from a
//    price we actually know. An unpriced model now records `cost_usd = null` and says which model
//    needs a price, rather than inventing one.
//
// Expect `/app/usage` totals to JUMP once this lands. That is a correction, not a regression.

/** Per-token USD pricing by model (input, output). Seeded defaults - see PRICE_OVERRIDE_ENV. */
export const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15 / 1e6, out: 0.60 / 1e6 },
  'gpt-4o': { in: 2.50 / 1e6, out: 10.0 / 1e6 },
  'gpt-4o (vision)': { in: 2.50 / 1e6, out: 10.0 / 1e6 },
  'text-embedding-3-small': { in: 0.02 / 1e6, out: 0 },
  'whisper-1': { in: 0, out: 0 }, // billed per-minute; token cost n/a
  // GPT-5.6 tier. NOT guesses: sourced in `docs/model-ab-findings.md`, imported from
  // huddle-extension-app (sha ef67eb5) and confirmed 2026-08-10 via Tavily across 5 sources against
  // OpenAI's pricing page reflecting the July-30-2026 cut.
  //
  // `gpt-5.6-luna` is AI_EDIT_MODEL's default. Without this entry `costOf()` fell back to
  // gpt-4o-mini, under-reporting the AI-edit path 1.33x on input and 2x on output — measured and
  // written down in `.claude/memory.md` as "NOT fixed yet", where it sat unread.
  'gpt-5.6-luna': { in: 0.20 / 1e6, out: 1.20 / 1e6 },
  'gpt-5.6-terra': { in: 2.00 / 1e6, out: 12.00 / 1e6 },
  'gpt-5.6-sol': { in: 5.00 / 1e6, out: 30.00 / 1e6 },
  // Best-known list prices, carried across from the same document, which flags them as NOT
  // re-confirmed in that pass. Recorded as such rather than left absent.
  'o3': { in: 2.00 / 1e6, out: 8.00 / 1e6 },
  'o3-mini': { in: 1.10 / 1e6, out: 4.40 / 1e6 },
}

/**
 * Owner-supplied prices for models this table does not know, as JSON:
 *   {"gpt-5.6-luna":{"in":0.00000125,"out":0.00001}}
 * A new model must not require a code change to become costable, and it must not be priced by
 * guesswork in the meantime. Read once per call; malformed JSON is ignored, never thrown.
 */
export const PRICE_OVERRIDE_ENV = 'MODEL_PRICES_JSON'

export function priceFor(model: string): { in: number; out: number } | null {
  try {
    const raw = process.env[PRICE_OVERRIDE_ENV]
    if (raw) {
      const o = JSON.parse(raw)
      const p = o?.[model]
      if (p && Number.isFinite(Number(p.in)) && Number.isFinite(Number(p.out))) {
        return { in: Number(p.in), out: Number(p.out) }
      }
    }
  } catch { /* a malformed override must not stop metering */ }
  return PRICES[model] || null
}

/**
 * Cost in USD, or null when the model has no known price.
 *
 * Null is the honest answer and the useful one: it makes the unpriced model visible in the table
 * instead of hiding it inside a total that looks measured.
 */
export function costOf(model: string, promptTokens: number, completionTokens: number): number | null {
  const p = priceFor(model)
  if (!p) return null
  return promptTokens * p.in + completionTokens * p.out
}

/** Both OpenAI usage shapes, plus the nested `usage.input_tokens_details` variants. */
export function tokensOf(usage: any): { prompt: number; completion: number } {
  const u: any = usage || {}
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? u.inputTokens ?? 0) || 0
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? u.outputTokens ?? 0) || 0
  return { prompt, completion }
}

/**
 * D:usage-metering-cannot-see-a-failure — the third defect this file gets wrong when left alone.
 *
 * `logUsage` is called from inside `openAiJson`, AFTER its `if (!r.ok) throw`. So a call that never
 * reached the model, or that came back 429/500, recorded NOTHING — not a failed row, no row at all.
 * The ledger that exists to answer "what did this feature spend and do" could only ever describe
 * the calls that worked, which is the same success-is-visible-failure-is-not shape all three judges
 * had, one layer lower.
 *
 * `outcome` is the fix and it is deliberately COARSE: this function sits below the layer that can
 * tell a refusal from an answer (`openAiJson` has already returned by the time its caller parses
 * the model's JSON), so it records only what it can actually observe — the call happened, or the
 * transport failed. Parse-level outcomes belong to `judge_outcome`, which is written by the callers
 * that know them.
 *
 * A FAILED CALL HAS NO TOKENS, so the zero-token early return below is bypassed for it. Keeping
 * that return for successes is still right: a success with no usage block is a call the API did not
 * bill and there is nothing to record.
 */
export type UsageOutcome = 'ok' | 'transport_failed'

// Best-effort: log one metered call to usage_metering. Never throws — metering
// must not break the feature it measures. Opens its own short-lived client.
export async function logUsage(feature: string, model: string, usage: any, outcome: UsageOutcome = 'ok'): Promise<void> {
  try {
    const { prompt: promptTokens, completion: completionTokens } = tokensOf(usage)
    // A failure is worth a row precisely BECAUSE it has no tokens. Returning here on the failure
    // path is what made a transport outage invisible in the first place.
    if (!promptTokens && !completionTokens && outcome === 'ok') return
    const cost = costOf(model, promptTokens, completionTokens)
    let client
    try {
      client = await getPgClient()
      await client.query(`create table if not exists usage_metering (
        id bigserial primary key, model text, feature text, prompt_tokens int,
        completion_tokens int, cost_usd numeric(12,8), ts timestamptz not null default now())`)
      await client.query(`alter table usage_metering add column if not exists feature text`)
      // 'ok' is the correct default for every row already in this table: each was written by the
      // success path, which is what those rows have always meant. Declared identically in
      // SCHEMA_SQL — H:judge-outcome-ddl-parity holds the two in step.
      await client.query(`alter table usage_metering add column if not exists outcome text not null default 'ok'`)
      await client.query(
        `insert into usage_metering (model, feature, prompt_tokens, completion_tokens, cost_usd, outcome) values ($1,$2,$3,$4,$5,$6)`,
        [model, feature, promptTokens, completionTokens, cost, outcome]
      )
    } finally { try { await client?.end() } catch {} }
  } catch { /* swallow — metering is non-critical */ }
}

// The OpenAI JSON transport, in ONE place.
//
// WHY THIS FILE EXISTS, honestly. There are 31 modules in this API that each build their own
// `fetch('https://api.openai.com/v1/chat/completions', ...)`. That is not a pattern to extend; it is
// the same twelve lines copied 31 times, and the escalation tier would have made it 32. Rather than
// add another copy or refactor 31 working call sites in a lane that does not own them, this is the
// ONE implementation new callers use, and the place the other 31 migrate to when their own lane
// touches them. Recorded as `D:openai-transport-duplicated` so the migration is a tracked row
// rather than an intention.
//
// It is deliberately thin. It does not retry, does not cache, does not parse the model's content,
// and holds no prompt — those are policy, and policy belongs to the caller that knows what it asked
// for. What it DOES own is the part every copy got right and would be dangerous to get wrong: the
// key comes from the environment and never from an argument, the response format is forced to JSON,
// and a non-2xx is an exception rather than a value that reads like an answer.
import { logUsage } from './usageMeter'

/** The shape callers inject in tests. Same signature as `appReviewer`'s private version. */
export type FetchJson = (system: string, user: string) => Promise<any>

export interface OpenAiCallOptions {
  /** Metering feature key, e.g. `evidence:escalate`. Required — an unmetered model call is invisible spend. */
  feature: string
  model?: string
  temperature?: number
  maxTokens?: number
}

/**
 * One chat completion, JSON-forced, metered.
 *
 * THROWS on a missing key and on any non-2xx, and that is the correct behaviour rather than a
 * returned null: the caller must be able to tell "the model said no" from "we never reached the
 * model". Collapsing those two into one falsy value is how a transport outage becomes a stored
 * finding of "no evidence exists".
 */
export function openAiJson(opts: OpenAiCallOptions): FetchJson {
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o'
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0
  const maxTokens = opts.maxTokens || 1500

  return async (system: string, user: string): Promise<any> => {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('OPENAI_API_KEY not set')
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature,
        response_format: { type: 'json_object' },
      }),
    })
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`)
    const raw = await r.json()
    // Metering is not optional and not the caller's to remember. A tier that can spend per
    // requirement is exactly the kind that must show up in `usage_metering` from its first call.
    await logUsage(opts.feature, model, (raw as any)?.usage)
    return raw
  }
}

/**
 * The model's JSON content, or null.
 *
 * Separate from the transport because "the HTTP call succeeded" and "the model returned parseable
 * JSON" are different facts and the caller must be able to act on each. `response_format` makes
 * non-JSON unlikely, not impossible — D31 in the ledger is a live case of a model returning no
 * parseable object through exactly this setting — so this returns null rather than throwing, and
 * the caller decides what an unparseable answer means for its row.
 */
export function contentJson(raw: any): any | null {
  const text = raw?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) return null
  try { return JSON.parse(text) } catch { /* fall through to the brace scan */ }
  // The same salvage the rest of the codebase does: a model that wraps its object in prose or a
  // fenced block still returned an object. Anything that is not a balanced object stays null.
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a === -1 || b <= a) return null
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return null }
}

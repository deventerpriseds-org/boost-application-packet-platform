// D8 — metering. The two defects this file guards were both invisible at runtime: a call that
// recorded nothing, and a cost that was confidently wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { tokensOf, costOf, priceFor, PRICES, PRICE_OVERRIDE_ENV } from '../dist/functions/tests/usageMeter.js'

test('both OpenAI usage shapes are read', () => {
  // Chat Completions says prompt/completion; the Responses API says input/output. Reading only the
  // first pair meant `packet:ai-edit` — which uses the Responses API — recorded ZERO rows, ever.
  assert.deepEqual(tokensOf({ prompt_tokens: 10, completion_tokens: 5 }), { prompt: 10, completion: 5 })
  assert.deepEqual(tokensOf({ input_tokens: 10, output_tokens: 5 }), { prompt: 10, completion: 5 })
})

test('a payload carrying BOTH shapes is not double counted', () => {
  // `(a||0) + (b||0)` is the plausible-looking wrong answer.
  assert.deepEqual(tokensOf({ prompt_tokens: 10, input_tokens: 10, completion_tokens: 5, output_tokens: 5 }),
    { prompt: 10, completion: 5 })
})

test('a missing or unusable usage object reads as zero rather than NaN', () => {
  for (const u of [null, undefined, {}, { total_tokens: 40 }, { prompt_tokens: 'x' }]) {
    const t = tokensOf(u)
    assert.ok(Number.isFinite(t.prompt) && Number.isFinite(t.completion), `NaN from ${JSON.stringify(u)}`)
  }
})

test('the sourced GPT-5.6 prices are used, not a fallback', () => {
  // The rates were researched, confirmed across 5 sources, imported into `docs/model-ab-findings.md`
  // and recorded in memory as APPLYING HERE — and were then not applied, because the agent looked at
  // the code and concluded "I do not know this model's price" without reading its own memory.
  // Luna is AI_EDIT_MODEL's default; the gpt-4o-mini fallback under-reported it 1.33x in / 2x out.
  assert.equal(costOf('gpt-5.6-luna', 1e6, 1e6), 0.20 + 1.20)
  assert.equal(costOf('gpt-5.6-terra', 1e6, 1e6), 2 + 12)
  assert.equal(costOf('gpt-5.6-sol', 1e6, 1e6), 5 + 30)
  assert.notEqual(costOf('gpt-5.6-luna', 1e6, 1e6), costOf('gpt-4o-mini', 1e6, 1e6))
  // Luna is exactly one tenth of Terra on both axes — the cross-check memory records.
  assert.ok(Math.abs(costOf('gpt-5.6-luna', 1e6, 0) * 10 - costOf('gpt-5.6-terra', 1e6, 0)) < 1e-9)
})

test('an unpriced model costs null — never the price of a different model', () => {
  // The old code fell back to gpt-4o-mini's rate for any unknown model. That is a fabricated number:
  // wrong by whatever the real model costs, and indistinguishable in the table from a real price.
  assert.equal(costOf('genuinely-unknown-model-v9', 1e6, 1e6), null)
  assert.equal(priceFor('totally-unknown-model'), null)
  assert.notEqual(costOf('totally-unknown-model', 1e6, 1e6), costOf('gpt-4o-mini', 1e6, 1e6))
})

test('a known model still costs what it costs', () => {
  assert.equal(costOf('gpt-4o-mini', 1e6, 1e6), 0.15 + 0.60)
  assert.equal(costOf('whisper-1', 1e6, 1e6), 0, 'a zero PRICE is a real price, not a missing one')
})

test('a new model can be priced without a deploy, and a malformed override never throws', () => {
  const prev = process.env[PRICE_OVERRIDE_ENV]
  try {
    // A model the table does not know, so the override is the ONLY source of a price for it.
    process.env[PRICE_OVERRIDE_ENV] = JSON.stringify({ 'some-future-model': { in: 1 / 1e6, out: 4 / 1e6 } })
    assert.equal(costOf('some-future-model', 1e6, 1e6), 1 + 4)
    process.env[PRICE_OVERRIDE_ENV] = '{not json'
    assert.equal(costOf('some-future-model', 1e6, 1e6), null, 'a malformed override falls through, it does not throw')
    // An override also WINS over a table entry, so a price correction needs no deploy.
    process.env[PRICE_OVERRIDE_ENV] = JSON.stringify({ 'gpt-5.6-luna': { in: 9 / 1e6, out: 9 / 1e6 } })
    assert.equal(costOf('gpt-5.6-luna', 1e6, 0), 9)
  } finally {
    if (prev === undefined) delete process.env[PRICE_OVERRIDE_ENV]; else process.env[PRICE_OVERRIDE_ENV] = prev
  }
})

test('no metering call passes an empty usage object', () => {
  // `logUsage(feature, model, {})` early-returns on zero tokens, so such a call site has never
  // recorded a row and never will — metering that reads as present in review and is inert at
  // runtime. Measured 2026-08-20: appPackets.ts:324 was exactly this, for the production packet
  // build, the single most expensive operation the product performs.
  const offenders = []
  for (const f of readdirSync(new URL('../src/functions/tests/', import.meta.url))) {
    if (!f.endsWith('.ts')) continue
    const src = readFileSync(new URL(`../src/functions/tests/${f}`, import.meta.url), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    if (/logUsage\([^)]*,\s*\{\s*\}\s*\)/.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [])
})

test('every model literal handed to logUsage is either priced or provably null-costed', () => {
  // Stays true as callers are added: a new model with no price records a null cost rather than a
  // wrong one, which is the invariant — not "PRICES is exhaustive", which it can never be.
  const models = new Set()
  for (const f of readdirSync(new URL('../src/functions/tests/', import.meta.url))) {
    if (!f.endsWith('.ts')) continue
    const src = readFileSync(new URL(`../src/functions/tests/${f}`, import.meta.url), 'utf8')
    for (const m of src.matchAll(/logUsage\([^,]+,\s*'([^']+)'/g)) models.add(m[1])
  }
  assert.ok(models.size >= 2, 'the scan found no logUsage call sites — it has gone stale')
  for (const m of models) {
    const c = costOf(m, 100, 100)
    assert.ok(c === null || (Number.isFinite(c) && c >= 0), `${m} produced ${c}`)
    if (c === null) assert.ok(!(m in PRICES), `${m} is in PRICES but costed null`)
  }
})

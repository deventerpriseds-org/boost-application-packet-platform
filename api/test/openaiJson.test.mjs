// The shared OpenAI transport. Everything here runs without a network.
//
// What is worth testing in twelve lines of fetch is not the fetch — it is the two places where a
// wrong answer looks like a right one:
//   1. a transport failure that returns falsy instead of throwing, which a caller reads as "the
//      model found nothing" and stores as a finding;
//   2. an unparseable body that returns something truthy, which a caller reads as an answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openAiJson, contentJson } from '../dist/functions/tests/openaiJson.js'

test('a missing key THROWS rather than returning null', async () => {
  // The distinction the escalation tier depends on: "we never reached the model" must not be
  // expressible as the same value as "the model declined". A tier that cannot tell them apart
  // records an outage as an absence of evidence, which is the "absent evidence is not_applicable,
  // never pass" rule broken at the transport layer.
  const prev = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    await assert.rejects(() => openAiJson({ feature: 'test' })('sys', 'user'), /OPENAI_API_KEY not set/)
  } finally { if (prev !== undefined) process.env.OPENAI_API_KEY = prev }
})

test('contentJson: a clean object parses', () => {
  const raw = { choices: [{ message: { content: '{"supported":true,"quote":"abc"}' } }] }
  assert.deepEqual(contentJson(raw), { supported: true, quote: 'abc' })
})

test('contentJson: an object wrapped in prose or a fence is salvaged', () => {
  // D31 in the ledger is a LIVE case of a model returning no parseable object through
  // `response_format: json_object` — so the salvage is not defensive programming, it is the
  // measured behaviour of the same setting on the same account.
  for (const body of [
    'Here is the answer:\n```json\n{"supported":false}\n```',
    'Sure! {"supported":false} — hope that helps.',
    '{"supported":false}\n\nLet me know if you need more.',
  ]) {
    assert.deepEqual(contentJson({ choices: [{ message: { content: body } }] }), { supported: false }, body)
  }
})

test('contentJson: anything that is not an object is NULL, never a guess', () => {
  // Each of these returned truthy under a naive `text.includes('{')` check. Null is the only honest
  // answer — the caller must be able to treat "the model did not answer in the agreed shape" as its
  // own outcome rather than receiving a partial object it will read fields off.
  for (const body of [
    '', '   ', 'I cannot answer that.',
    'the opening brace { is never closed',
    '} closed before it opened {',
    '{not json at all}',
  ]) {
    assert.equal(contentJson({ choices: [{ message: { content: body } }] }), null, JSON.stringify(body))
  }
  // And a malformed envelope, which is what a proxy error page or a truncated stream looks like.
  for (const raw of [null, undefined, {}, { choices: [] }, { choices: [{}] }, { choices: [{ message: {} }] }]) {
    assert.equal(contentJson(raw), null, JSON.stringify(raw))
  }
})

test('H:model-call-is-metered: the transport meters every call, and the caller cannot forget to', () => {
  // Metering lives INSIDE the transport rather than beside each call site, because a tier that
  // spends per requirement is exactly the kind whose cost must be visible from its first call — and
  // because the 31 hand-rolled copies this file replaces do not agree on whether they meter at all
  // (`D:openai-transport-duplicated`). Asserted structurally: a runtime test would need a network.
  const src = readFileSync(new URL('../src/functions/tests/openaiJson.ts', import.meta.url), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.match(body, /await logUsage\(/, 'the transport does not meter — model spend would be invisible')
  assert.match(body, /feature: string/, 'the feature key is not required, so a call can be metered anonymously')
  // And the key is read from the environment, never accepted as an argument. A key-shaped parameter
  // is how a secret reaches a log line or a prompt.
  assert.match(body, /process\.env\.OPENAI_API_KEY/)
  assert.ok(!/key\s*[?:]\s*string/.test(body), 'the transport accepts a key as an argument — it must come from the environment')
})

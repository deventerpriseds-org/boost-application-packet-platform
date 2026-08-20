// P7 — the ATS QC call (pipeline.ts Call 3) is asked for JSON by its system prompt while its stored
// user prompt (Prompts/ats_user, 9356 chars, read live 2026-08-20) still carries the zap's "output a
// clean HTML table" instructions. The old extractor was `content.match(/\{[\s\S]*\}/)` inside a
// try/catch, so any reply carrying prose or HTML around the object was silently discarded and the
// run continued as if QC had agreed with everything. These cases are the replies that regex loses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentJson, isEmptyResult } from '../dist/functions/tests/agentJson.js'

const PAYLOAD = {
  finalSkills1: ['Platform Modernization', 'Cloud Strategy'],
  finalSkills2: ['SOC 2 Compliance'],
  finalRelevant1: ['Roadmap Ownership'],
  updatedResumeSummary: 'Executive with a record of modernizing regulated platforms.',
}

test('a bare JSON object parses directly', () => {
  const r = parseAgentJson(JSON.stringify(PAYLOAD))
  assert.equal(r.via, 'direct')
  assert.deepEqual(r.value, PAYLOAD)
})

test('a ```json fenced object parses — the most common wrapper', () => {
  const r = parseAgentJson('Here is the result:\n```json\n' + JSON.stringify(PAYLOAD) + '\n```\nLet me know.')
  assert.equal(r.via, 'fence')
  assert.deepEqual(r.value, PAYLOAD)
})

test('trailing prose after the object no longer destroys the parse', () => {
  // The old greedy regex paired the first `{` with the LAST `}` in the message.
  const reply = JSON.stringify(PAYLOAD) + '\n\nNote: I kept {most} of the original items.'
  assert.match(reply.match(/\{[\s\S]*\}/)[0], /Note:/, 'precondition: the greedy span really does over-reach')
  assert.throws(() => JSON.parse(reply.match(/\{[\s\S]*\}/)[0]), 'precondition: the old extractor threw here')

  const r = parseAgentJson(reply)
  assert.equal(r.via, 'balanced')
  assert.deepEqual(r.value, PAYLOAD)
})

test('an HTML QC table around the object does not end the object early', () => {
  // ats_user asks for raw HTML tables; a style attribute puts braces inside a JSON string value.
  const withTable = { ...PAYLOAD, jobscanQcTable: '<table style="{border:1px}"><tr><td>Cloud</td></tr></table>' }
  const reply = '<h3>Final Skills QC</h3>\n<table><tr><td>x</td></tr></table>\n' + JSON.stringify(withTable)
  const r = parseAgentJson(reply)
  assert.equal(r.via, 'balanced')
  assert.deepEqual(r.value, withTable)
})

test('the largest parseable object wins over a small preamble object', () => {
  const reply = '{"note":"working"}\n' + JSON.stringify(PAYLOAD)
  const r = parseAgentJson(reply)
  assert.deepEqual(r.value, PAYLOAD)
})

test('a reply with no JSON reports failure instead of an empty object', () => {
  const r = parseAgentJson('<table><tr><td>Cloud Strategy</td><td>Covered</td></tr></table>')
  assert.equal(r.value, null)
  assert.equal(r.via, 'none')
  assert.match(r.detail, /no parseable JSON/)
  assert.equal(parseAgentJson('').value, null)
  assert.equal(parseAgentJson(null).value, null)
  assert.equal(parseAgentJson(undefined).value, null)
})

test('a JSON array is not accepted as the result object', () => {
  assert.equal(parseAgentJson('[1,2,3]').value, null)
})

test('isEmptyResult separates "QC decided nothing" from "QC never landed"', () => {
  assert.equal(isEmptyResult(null), true)
  assert.equal(isEmptyResult({}), true)
  assert.equal(isEmptyResult({ finalSkills1: [], updatedResumeSummary: '   ' }), true)
  assert.equal(isEmptyResult({ finalSkills1: [], updatedResumeSummary: 'x' }), false)
  assert.equal(isEmptyResult(PAYLOAD), false)
})

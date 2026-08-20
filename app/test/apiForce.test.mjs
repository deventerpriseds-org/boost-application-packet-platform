// A server-side idempotency fix shipped without its one consumer, and the control that exists ONLY
// to re-run provably could not re-run. This guards the shape rather than the incident: any helper
// whose UI affordance is "do it again" must be able to say so on the wire.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')

test('analyzeJd can send force — the re-run control has a way to re-run', () => {
  const line = stripComments(src('api.js')).split('\n').find(l => l.includes('analyzeJd:'))
  assert.ok(line, 'analyzeJd disappeared from api.js')
  assert.match(line, /force/, 'analyzeJd must be able to send force, or the Re-run button is inert')
  assert.match(line, /opts|options|\{\s*force/, 'it must take the flag from its caller, not hardcode it')
})

test('the analysis button actually passes force', () => {
  const body = stripComments(src('screens/PacketBuilder.jsx'))
  const call = body.split('\n').find(l => l.includes('api.analyzeJd('))
  assert.ok(call, 'the analysis call disappeared')
  assert.match(call, /force/, 'a click on "Re-run analysis" must reach the server as a forced run')
})

// The inverse half: the guard must not fire on a correct future refactor that renames the option
// object, so it checks for the WORD force reaching the wire, not one exact spelling.
test('the guard reads the real construct, not a formatting accident', () => {
  const line = stripComments(src('api.js')).split('\n').find(l => l.includes('analyzeJd:'))
  assert.ok(!/^\s*\/\//.test(line), 'the guard must not match a commented-out line')
})

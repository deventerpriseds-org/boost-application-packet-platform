import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { packetFailList } from '../src/qcRail.js'

const entry = (artifactId, type, rows, gate = 'fail') =>
  ({ artifactId, type, result: rows === null ? null : { gate, results: rows } })
const row = (check_key, state, engine = 'deterministic', observed = 'o') =>
  ({ check_key, state, engine, observed, offenders: [] })

test('H:send-fail-list-is-deterministic-only: a reviewer flag cannot block, so it is not listed', () => {
  // railCounts states the rule this follows: a reviewer `fail` counts in toReview and NEVER in
  // toFix, because only deterministic rows can fail an artifact (decision D6). This list is
  // specifically the answer to "what is stopping me sending" - putting a reviewer flag in it would
  // tell the reader they are blocked by something that cannot block them.
  const r = packetFailList([entry('a1', 'resume', [
    row('must_have_coverage', 'fail'),
    row('tone', 'fail', 'reviewer'),
    row('word_counts', 'warn'),
  ])])
  assert.equal(r.count, 1, 'only the deterministic fail blocks')
  assert.equal(r.items[0].check_key, 'must_have_coverage')
  assert.ok(!r.items.some((i) => i.check_key === 'tone'), 'a reviewer fail must not appear')
  assert.ok(!r.items.some((i) => i.check_key === 'word_counts'), 'a warn does not block sending')
})

test('H:send-lists-unchecked-as-blocking: nobody looked is not nothing is wrong', () => {
  // Absent evidence is not_applicable, never pass. On THIS step the distinction is the difference
  // between "nothing is wrong" and "nobody looked", and only one of those should let a packet go.
  const r = packetFailList([entry('a1', 'resume', null)])
  assert.equal(r.count, 1)
  assert.equal(r.items[0].unchecked, true)
  assert.match(r.items[0].observed, /have not been run/)
  assert.match(r.items[0].observed, /not a pass/)
})

test('H:send-counts-items-and-assets-separately: two numbers, two questions', () => {
  const r = packetFailList([
    entry('a1', 'resume', [row('must_have_coverage', 'fail'), row('changes_cited', 'fail')]),
    entry('a2', 'cover', [row('word_counts', 'fail')]),
    entry('a3', 'video', [row('x', 'pass')]),
  ])
  assert.equal(r.count, 3, 'three failing items')
  assert.equal(r.assets, 2, 'across two assets - a3 is clean and must not be counted')
})

test('H:send-clean-packet-lists-nothing: a clean packet must produce an EMPTY list, not a zero row', () => {
  const r = packetFailList([entry('a1', 'resume', [row('x', 'pass')], 'pass')])
  assert.deepEqual(r.items, [])
  assert.equal(r.count, 0)
  assert.equal(r.assets, 0)
  // and the degenerate inputs
  assert.equal(packetFailList([]).count, 0)
  assert.equal(packetFailList(undefined).count, 0)
  assert.equal(packetFailList([{ result: { gate: 'fail', results: [row('x', 'fail')] } }]).count, 0,
    'an entry with no artifactId cannot be navigated to and must not be listed')
})

test('H:send-step-renders-the-list-it-computes: a count with no rows leaves the reader hunting', () => {
  const src = readFileSync(new URL('../src/screens/PacketBuilder.jsx', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.match(code, /const failList = packetFailList\(qcEntries\)/, 'the step must compute the list')
  assert.match(code, /data-qc="send-gate-card"/, 'the packet gate card must render')
  assert.match(code, /failList\.items\.map/, 'and one row per failing item, not just the count')
  assert.match(code, /data-qc="send-open-field"/, 'each row needs a way to reach the field')
  assert.match(code, /goToField\(f\.artifactId, f\.mergeField\)/, 'which must use the EXISTING navigator')
  // 4.10-2: the computed gate beside the stored status on the per-asset list
  assert.match(code, /<GateBadge result=\{\(qcEntries\.find/, 'the send list must show the computed gate too')
})

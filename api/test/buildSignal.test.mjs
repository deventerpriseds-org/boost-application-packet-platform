// The build wake-signal — D35's second half, after the owner asked for the storage account to be
// used instead of a one-minute timer.
//
// Nothing here touches Azure. What is worth testing is the part that fails SILENTLY: a message the
// host cannot read is not an error anyone sees, it is a build that never starts, and the queue
// extension and the storage SDK disagree by default about how a message is encoded.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BUILD_QUEUE_NAME, encodeBuildSignal, decodeBuildSignal,
} from '../dist/functions/tests/buildSignal.js'

const src = (f) => readFileSync(new URL(`../src/functions/tests/${f}`, import.meta.url), 'utf8')

test('H:build-signal-is-base64: the encoding the queue trigger expects, not the SDK default', () => {
  // The Functions queue extension defaults to base64 for compatibility with the classic SDKs, while
  // `@azure/storage-queue` sends plain text. Sending raw JSON is the version of this that LOOKS like
  // it works — the message is accepted and sits in the queue — and is then quietly dead-lettered
  // instead of triggering anything. There is no error to notice; the build simply never starts.
  const wire = encodeBuildSignal({ jobId: 'abc', oppId: 'def' })
  assert.match(wire, /^[A-Za-z0-9+/]+=*$/, 'the signal was not base64-encoded')
  assert.notEqual(wire[0], '{', 'raw JSON on the wire is dead-lettered, not delivered')
  assert.deepEqual(JSON.parse(Buffer.from(wire, 'base64').toString('utf8')), { jobId: 'abc', oppId: 'def' })
})

test('H:build-signal-reads-either-encoding: a worker must not depend on how the message was produced', () => {
  // The host may hand the handler an already-decoded object, a JSON string, or a base64 string,
  // depending on the extension version and who wrote the message. All three are the same signal. A
  // worker that only understands the one we happen to send today is one that stops working when the
  // extension bundle moves — and the symptom would be builds that queue and never run.
  const want = { jobId: 'j1', oppId: 'o1' }
  assert.deepEqual(decodeBuildSignal(encodeBuildSignal(want)), want, 'base64 form unreadable')
  assert.deepEqual(decodeBuildSignal(JSON.stringify(want)), want, 'plain JSON form unreadable')
  assert.deepEqual(decodeBuildSignal(want), want, 'pre-decoded object unreadable')
})

test('H:unreadable-signal-is-null-not-a-throw: a bad message must not poison the queue', () => {
  // An exception in the handler makes the host redeliver five times and then poison the message. A
  // signal we cannot read is worth one log line, not five wake-ups and a dead letter.
  for (const bad of ['', '   ', 'not json', Buffer.from('not json').toString('base64'), '{}', null, undefined, 42, {}]) {
    assert.equal(decodeBuildSignal(bad), null, `garbage decoded to something: ${JSON.stringify(bad)}`)
  }
})

test('H:build-worker-is-queue-triggered: the wake-up is the signal, the timer is only the sweep', () => {
  // The rule this encodes: when a push signal exists for the thing being waited on, it is the
  // primary mechanism and a fixed-interval poll is a FALLBACK scoped to what it cannot cover. The
  // first version of this queue woke on a one-minute tick, which made every build wait up to sixty
  // seconds for an event whose exact moment we already knew.
  const code = src('appBuildJobs.ts')
  assert.match(code, /app\.storageQueue\('buildQueueWorker'[\s\S]*?queueName: BUILD_QUEUE_NAME/,
    'the build worker is not queue-triggered')
  assert.match(code, /app\.timer\('buildQueueSweep', \{ schedule: '0 \*\/(\d+) \* \* \* \*'/,
    'the sweep is gone — a dead worker leaves a row nothing will ever wake')
  const every = Number(code.match(/app\.timer\('buildQueueSweep', \{ schedule: '0 \*\/(\d+) \* \* \* \*'/)[1])
  assert.ok(every >= 5, `the sweep runs every ${every} minutes — that is a poll wearing a fallback's name`)
  // And the POST must actually send the signal, or the queue trigger is decoration and every build
  // silently waits for the sweep instead.
  assert.match(code, /sendBuildSignal\(\{ jobId: r\.job\.id/, 'nothing sends the signal the worker waits on')
})

test('H:signal-failure-does-not-fail-the-build: the job row is already committed', () => {
  // The signal only decides whether a build starts in a second or on the next sweep. Throwing when
  // storage is unreachable would turn a latency problem into an outage on a request whose work is
  // already durably queued.
  const code = src('buildSignal.ts')
  assert.match(code, /catch \(e\) \{\s*\n\s*log\(`build signal not sent/, 'a send failure is not swallowed')
  assert.match(code, /if \(!conn\) \{ log\('build signal not sent/, 'a missing connection string throws')
  assert.equal(BUILD_QUEUE_NAME, 'packet-build-jobs')
})

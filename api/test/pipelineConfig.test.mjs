// P7 items 5 and 7 — the unvalidated fallback and the temperature on the QA step.
// Values come from AppConfig/auth (the store `GET|POST /api/config` already reads and writes, and
// the Auth & Config screen already edits); the constants in code are seeds only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTemperature, isDriveId, requireDriveId, settingsFromConfig,
  SEED_TEMPERATURES, CONFIG_KEYS,
} from '../dist/functions/tests/pipelineConfig.js'

test('the QC seed is materially colder than the generation seed', () => {
  // The whole point of the item: reconciliation must not be the most creative call in the run.
  assert.ok(SEED_TEMPERATURES.qc < SEED_TEMPERATURES.generate)
  assert.ok(SEED_TEMPERATURES.qc <= 0.3, 'a "low" QC temperature must actually be low')
  // Both must be inside the range the API accepts.
  for (const t of Object.values(SEED_TEMPERATURES)) assert.ok(t >= 0 && t <= 2)
})

test('parseTemperature accepts a configured value and reports its source', () => {
  assert.deepEqual(parseTemperature('0.4', 0.15), { value: 0.4, source: 'config' })
  assert.deepEqual(parseTemperature(0, 0.15), { value: 0, source: 'config' })
  assert.deepEqual(parseTemperature(2, 0.15), { value: 2, source: 'config' })
})

test('parseTemperature falls back — never NaN, never out of range, always with a reason', () => {
  assert.deepEqual(parseTemperature(undefined, 0.15), { value: 0.15, source: 'default' })
  assert.deepEqual(parseTemperature('', 0.15), { value: 0.15, source: 'default' })
  assert.deepEqual(parseTemperature('   ', 0.15), { value: 0.15, source: 'default' })

  const bad = parseTemperature('warm', 0.15)
  assert.equal(bad.value, 0.15)
  assert.equal(bad.source, 'default')
  assert.match(bad.reason, /not a number/)

  const high = parseTemperature('3', 0.15)
  assert.equal(high.value, 0.15)
  assert.match(high.reason, /out of range/)
  assert.match(parseTemperature('-1', 0.15).reason, /out of range/)
})

test('isDriveId accepts the real template ids and rejects the fallback literals', () => {
  // The three ids this repo actually copies (pipeline.ts / packetTemplates.ts).
  assert.equal(isDriveId('1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'), true)
  assert.equal(isDriveId('1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec'), true)
  assert.equal(isDriveId('1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'), true)

  // The zap's unmatched-role fallback, and its neighbours.
  assert.equal(isDriveId('Unknown'), false)
  assert.equal(isDriveId('unknown'), false)
  assert.equal(isDriveId('Unknown Company'), false)
  assert.equal(isDriveId(''), false)
  assert.equal(isDriveId('   '), false)
  assert.equal(isDriveId(undefined), false)
  assert.equal(isDriveId(null), false)
  assert.equal(isDriveId(123), false)
  assert.equal(isDriveId('https://docs.google.com/document/d/1bwOcxvkbih/edit'), false)
  assert.equal(isDriveId('placeholder'), false)
})

test('requireDriveId throws naming the document and the setting to fix', () => {
  assert.equal(requireDriveId(' 1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt ', 'Output folder id'), '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt')
  assert.throws(
    () => requireDriveId('Unknown', 'Template id for "Compact ATS Resume"', 'google.compactResumeTemplateId'),
    (e) => /Compact ATS Resume/.test(e.message) && /google\.compactResumeTemplateId/.test(e.message) && /Unknown/.test(e.message),
  )
  assert.throws(() => requireDriveId(undefined, 'Output folder id'), /\(unset\)/)
})

test('settingsFromConfig seeds an empty store and keeps QC colder than generation', () => {
  const s = settingsFromConfig({})
  assert.equal(s.generateTemperature.value, SEED_TEMPERATURES.generate)
  assert.equal(s.generateTemperature.source, 'default')
  assert.equal(s.qcTemperature.value, SEED_TEMPERATURES.qc)
  assert.ok(s.qcTemperature.value < s.generateTemperature.value)
  assert.equal(s.compactResumeTemplateId, '')
  assert.equal(s.defaultRoleFocus, '')
  assert.deepEqual(s.warnings, [])
})

test('settingsFromConfig honours the owner and refuses garbage loudly', () => {
  const s = settingsFromConfig({
    [CONFIG_KEYS.generateTemperature]: '0.9',
    [CONFIG_KEYS.qcTemperature]: '0',
    [CONFIG_KEYS.compactResumeTemplateId]: '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw',
    [CONFIG_KEYS.defaultRoleFocus]: 'product management',
  })
  assert.equal(s.generateTemperature.value, 0.9)
  assert.equal(s.qcTemperature.value, 0)
  assert.equal(s.qcTemperature.source, 'config')
  assert.equal(s.compactResumeTemplateId, '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw')
  assert.equal(s.defaultRoleFocus, 'product management')
  assert.deepEqual(s.warnings, [])

  const bad = settingsFromConfig({
    [CONFIG_KEYS.qcTemperature]: 'hot',
    [CONFIG_KEYS.compactResumeTemplateId]: 'Unknown',
  })
  assert.equal(bad.qcTemperature.value, SEED_TEMPERATURES.qc)
  assert.equal(bad.compactResumeTemplateId, '', 'an invalid id must never reach Drive')
  assert.equal(bad.warnings.length, 2)
  assert.ok(bad.warnings.some((w) => w.includes(CONFIG_KEYS.qcTemperature)))
  assert.ok(bad.warnings.some((w) => w.includes(CONFIG_KEYS.compactResumeTemplateId)))
})

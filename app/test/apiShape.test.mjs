import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')

test('H:api-has-no-duplicate-keys: a second definition silently wins and the first is dead', () => {
  // FOUND 2026-08-25 by an independent AC pass, confirmed by grep: `api.js` defined THREE keys
  // twice — artifactChecksResult (142/187), artifactInsertions (171/192), packetSwaps (172/193).
  // All three pairs were byte-identical, so there was no live defect. The hazard is the next edit:
  // in a JS object literal the LAST definition wins, so a fix applied to the earlier line is a
  // silent no-op that tests cannot distinguish from a fix that was never written. One of the three
  // was `artifactChecksResult`, the helper the whole change log and the field margin ride on.
  const keys = [...SRC.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((m) => m[1])
  const seen = new Set()
  const dupes = [...new Set(keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false))))]
  assert.deepEqual(dupes, [], `api.js defines these keys more than once: ${dupes.join(', ')}`)
})

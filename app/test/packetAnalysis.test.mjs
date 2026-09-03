// SPEC — the model output that reached no document, and the reader it never had.
//
// The fixture is the OWNER'S REAL STORED SHAPE, from db-query run 33657794878: the same titles, the
// same duplicate-title pairs, the same truncation flags. A hand-invented fixture would not have had
// two "Missing ATS Skills" rows with different bodies, which is the case that decides `sectionsFor`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  homeOf, sectionsFor, countFor, analysisCacheKey, normTitle,
  HOME_JD, HOME_FIELDS, HOME_SWAPS, HOME_OTHER, ANALYSIS_HOOKS,
} from '../src/packetAnalysis.js'

const LIVE = [
  { call: 2, title: 'Word and Character Requirements Check', body: 'x'.repeat(400), chars: 4473, truncated: true },
  { call: 1, title: 'Job Description Summary', body: 'y'.repeat(400), chars: 4374, truncated: true },
  { call: 1, title: 'Jobscan Extraction', body: 'Jobscan says...', chars: 2893 },
  { call: 1, title: 'Missing ATS Skills', body: '<table>A</table>', chars: 1620 },
  { call: 1, title: 'Missing ATS Skills', body: '<table>B</table>', chars: 796 },
  { call: 1, title: 'Missing ATS Swap Suggestions', body: 'swap this', chars: 935 },
  { call: 2, title: 'Job Description Summary', body: 'y'.repeat(400), chars: 4374, truncated: true },
  { call: 1, title: 'Skills1', body: 'pre-swap list', chars: 329 },
]

test('H:analysis-every-section-has-a-home-and-none-is-dropped', () => {
  // THE FAILURE THIS PREVENTS is the one that created the row: a section nobody displays. An
  // unknown title must land in `other`, never vanish — adding a section to a prompt cannot silently
  // remove it from the UI.
  assert.equal(homeOf('Job Description Summary'), HOME_JD)
  assert.equal(homeOf('  JOB   description SUMMARY '), HOME_JD, 'case and spacing must not decide a home')
  assert.equal(homeOf('Word and Character Requirements Check'), HOME_FIELDS)
  assert.equal(homeOf('Missing ATS Swap Suggestions'), HOME_SWAPS)
  assert.equal(homeOf('Some Section A Prompt Adds Next Year'), HOME_OTHER)
  assert.equal(homeOf(''), HOME_OTHER)
  assert.equal(homeOf(null), HOME_OTHER)

  // EVERY row of the live shape reaches exactly one home, and the homes partition the input.
  const total = [HOME_JD, HOME_FIELDS, HOME_SWAPS, HOME_OTHER]
    .reduce((n, h) => n + countFor(LIVE, h), 0)
  const nonEmpty = LIVE.filter((s) => s.body.trim()).length
  assert.ok(total > 0 && total <= nonEmpty, 'homes must partition the sections, not duplicate them')
  assert.equal(countFor(LIVE, HOME_SWAPS), 1)
  assert.equal(countFor(LIVE, HOME_FIELDS), 1)
  assert.equal(countFor(LIVE, HOME_OTHER), 1, 'Skills1 has no named home and must still be reachable')
})

test('H:analysis-same-title-different-body-are-both-kept', () => {
  // THE LIVE CASE, and the reason this is not a plain Set on title. "Missing ATS Skills" is stored
  // TWICE with different bodies (1,620 and 796 chars) because collectAnalysis walks Call 1 and
  // Call 2 and both emitted one. Collapsing them by title would silently hide one of the owner's
  // two tables; showing them as an undifferentiated pair would read as one correcting the other.
  const jd = sectionsFor(LIVE, HOME_JD)
  const ats = jd.filter((s) => normTitle(s.title) === 'missing ats skills')
  assert.equal(ats.length, 2, 'two different bodies under one title must both survive')
  assert.notEqual(ats[0].body, ats[1].body)

  // An EXACT duplicate (same title AND same body) collapses — that is noise, not information.
  const jds = jd.filter((s) => normTitle(s.title) === 'job description summary')
  assert.equal(jds.length, 1, 'a byte-identical repeat is noise and must collapse')

  // Empty bodies never render.
  assert.equal(sectionsFor([{ title: 'Job Description Summary', body: '   ' }], HOME_JD).length, 0)
  assert.deepEqual(sectionsFor(null, HOME_JD), [])
})

test('H:analysis-truncation-is-stated-never-silent', () => {
  // `chars` is what the model PRODUCED; `body` is what was stored. When they differ the reader is
  // looking at part of a section, and a cut-off sentence read as the model's own ending is a
  // misreading the UI caused. Two of the live sections are already truncated.
  const cut = sectionsFor(LIVE, HOME_FIELDS)[0]
  assert.equal(cut.truncated, true, 'a stored body shorter than chars must be flagged')
  assert.ok(cut.chars > cut.body.length, 'chars must stay the FULL length, never the kept length')

  // Derived, not merely trusted: a section whose flag is absent but whose lengths disagree is still
  // truncated, because the flag is written by a producer this module does not control.
  const inferred = sectionsFor([{ title: 'Jobscan Extraction', body: 'ab', chars: 900 }], HOME_JD)[0]
  assert.equal(inferred.truncated, true, 'truncation must be derived from the lengths, not only the flag')

  const whole = sectionsFor([{ title: 'Jobscan Extraction', body: 'abc', chars: 3 }], HOME_JD)[0]
  assert.equal(whole.truncated, false)
})

test('H:analysis-cache-key-is-null-rather-than-colliding', () => {
  // The payload is semi-dynamic: it changes only when a build runs, so (packetId, builtAt) is a
  // safe forever-key and a rebuild changes the key rather than invalidating an entry.
  const a = analysisCacheKey('pkt-1', '2026-09-02T15:00:00Z')
  assert.ok(a && a.includes('pkt-1'))
  assert.notEqual(a, analysisCacheKey('pkt-1', '2026-09-02T16:00:00Z'), 'a rebuild must change the key')
  assert.notEqual(a, analysisCacheKey('pkt-2', '2026-09-02T15:00:00Z'), 'two packets must never share a key')

  // NULL DISABLES CACHING rather than minting a colliding key. Without this, every packet lacking a
  // builtAt shares one key and the cache serves one packet's analysis for another — the worst
  // failure available here, and silent.
  assert.equal(analysisCacheKey('pkt-1', null), null)
  assert.equal(analysisCacheKey('pkt-1', ''), null)
  assert.equal(analysisCacheKey(null, '2026-09-02T15:00:00Z'), null)
})

test('H:analysis-route-is-owner-scoped-and-states-absence', () => {
  // A packet id alone must not disclose another owner's analysis — joined through opportunity,
  // exactly as swapsGet does.
  const api = readFileSync(new URL('../../api/src/functions/tests/appPackets.ts', import.meta.url), 'utf8')
  const fn = api.slice(api.indexOf('export async function packetAnalysis'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.match(body, /join opportunity o on o\.id = p\.opp_id/, 'the route must join through opportunity')
  assert.match(body, /o\.owner_email = \$2/, 'and filter on the resolved owner')
  // Absent evidence is STATED, never an empty array pretending to be an answer.
  assert.match(body, /reason: raw\.length \? null/, 'an empty result must carry a reason')
  assert.match(body, /builtAt/, 'the cache key must be returned or the client cannot cache safely')
})

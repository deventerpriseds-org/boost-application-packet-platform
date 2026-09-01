// The coverage judge's IMPURE half — cache, call, write — exercised with a fake client and a fake
// transport, so every failure posture is provable without a network or a database.
//
// The postures being guarded are not edge cases. Each one is a way an OUTAGE could be stored as a
// FINDING against the owner's document, which is the failure this whole tier exists to prevent.
//
//   cd api && node --test test/coverageRun.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { runCoverageJudge, judgeableFields, judgeVerdictsFor } from '../dist/functions/tests/appCoverage.js'
import { verdictKey } from '../dist/functions/tests/coverageJudge.js'

const SUMMARY = 'Visionary technology leader with a robust track record in driving enterprise transformations and aligning engineering strategies with business objectives.'
// A SECOND REAL RESUME FIELD. checkFieldsFor('resume') is ResumeSummary, SkillsBullets1/2,
// ExpertiseBullets and RelevantBullets1/2/3 — CoverLetterBody belongs to a different artifact type,
// and a fixture using it would exercise a one-field artifact while claiming to test two.
const EXPERTISE = 'Aligning engineering strategies with business objectives across regulated enterprises.'

const REQ = { seq: 15, kind: 'must_have', verbatim: 'Ability to align engineering strategy with business goals', item_text: '' }

// A client that records every query and answers reads with whatever rows it was seeded with.
const fakeClient = (rows = []) => {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params })
      if (/from requirement_coverage/.test(sql)) {
        return { rows: rows.filter(r => (params[1] || []).includes(r.verdict_key)) }
      }
      return { rows: [] }
    },
  }
}

const answer = (verdicts) => async () => ({ choices: [{ message: { content: JSON.stringify({ verdicts }) } }] })

const base = (over = {}) => ({
  oppId: '11111111-1111-1111-1111-111111111111',
  artifactId: '33333333-3333-3333-3333-333333333333',
  type: 'resume',
  pkg: { ResumeSummary: SUMMARY },
  requirements: [REQ],
  thresholds: { coverageJudge: true },
  model: 'gpt-4o',
  fetchJson: answer([{ seq: 15, covered: true, basis: 'synonym', why: 'same claim, reworded',
    quote: 'aligning engineering strategies with business objectives' }]),
  ...over,
})

test('H:judge-off-is-the-untouched-path', async () => {
  // The default. With the setting off nothing is asked, nothing is written, and `checks.ts` gets no
  // map at all — which is the path `H:no-verdict-map-changes-nothing` pins byte-for-byte.
  let asked = 0
  const client = fakeClient()
  for (const thresholds of [{}, { coverageJudge: false }, { coverageJudge: 'yes' }]) {
    const r = await runCoverageJudge(client, base({ thresholds, fetchJson: async () => { asked++; return {} } }))
    assert.equal(r.verdicts, undefined, `no map for ${JSON.stringify(thresholds)}`)
    assert.equal(r.calls, 0)
  }
  assert.equal(asked, 0, 'the model is never asked')
  assert.equal(client.calls.length, 0, 'and the database is never touched')
})

test('H:transport-failure-is-silence-not-a-no', async () => {
  // THE POSTURE THAT MATTERS MOST. An outage must never be storable as "the document does not cover
  // this". The requirement comes back SILENT — absent from the map — so judgeSilent excludes it from
  // placement instead of the lexical fallback answering in the judge's name.
  const client = fakeClient()
  const r = await runCoverageJudge(client, base({
    fetchJson: async () => { throw new Error('OpenAI HTTP 503') },
  }))
  assert.equal(r.verdicts.has(15), false, 'no verdict at all')
  assert.deepEqual(r.silent, [15])
  assert.equal(r.failures.length, 1)
  assert.match(r.failures[0].error, /transport: OpenAI HTTP 503/)
  assert.ok(!client.calls.some(c => /insert into requirement_coverage/.test(c.sql)), 'nothing is stored')
})

test('H:an-unreadable-cache-is-a-miss-not-a-verdict', async () => {
  // A query that throws must degrade to "ask the model", never to a stored answer nobody read and
  // never to a negative verdict. The run still produces the right answer and records the cost.
  const client = {
    calls: [],
    query: async (sql, params) => {
      if (/from requirement_coverage/.test(sql)) throw new Error('relation does not exist')
      client.calls.push({ sql, params }); return { rows: [] }
    },
  }
  const r = await runCoverageJudge(client, base())
  assert.equal(r.verdicts.get(15).covered, true, 'the model was still asked and its answer stands')
  assert.equal(r.calls, 1)
  assert.match(r.failures[0].error, /cache: relation does not exist/)
})

test('H:a-cached-verdict-costs-no-call', async () => {
  // The whole reason a verdict is stored: a rebuild with byte-identical text must answer identically
  // and spend nothing. A model asked twice may differ, and a gate that flips between two runs of
  // unchanged code is worse than one that is wrong consistently.
  const key = verdictKey({ requirement: REQ.verbatim, field: 'ResumeSummary', fieldText: SUMMARY, model: 'gpt-4o' })
  const client = fakeClient([{ verdict_key: key, covered: true, basis: 'synonym',
    quote: 'aligning engineering strategies with business objectives', char_start: 96, char_end: 152,
    why: 'cached reading', judge_version: 1 }])
  let asked = 0
  const r = await runCoverageJudge(client, base({ fetchJson: async () => { asked++; return {} } }))
  assert.equal(asked, 0, 'the model is not asked about something already answered')
  assert.equal(r.calls, 0)
  assert.equal(r.cacheHits, 1)
  assert.equal(r.verdicts.get(15).covered, true)
  assert.equal(r.verdicts.get(15).why, 'cached reading')
})

test('H:the-cap-stops-calls-without-accusing', async () => {
  // A cap that turned unasked requirements into "not covered" would be a budget limit producing
  // findings. It produces SILENCE instead: the second field is never asked, and its requirement is
  // not in the map.
  const client = fakeClient()
  let asked = 0
  const r = await runCoverageJudge(client, base({
    pkg: { ResumeSummary: SUMMARY, ExpertiseBullets: EXPERTISE },
    thresholds: { coverageJudge: true, coverageJudgeMaxCalls: 1 },
    fetchJson: async () => {
      asked++
      // Only the FIRST field gets an answer, and it is a "no" — so if the cap leaked into a verdict
      // the requirement would appear as an offender rather than as silence.
      return { choices: [{ message: { content: JSON.stringify({ verdicts: [
        { seq: 15, covered: false, basis: 'absent', quote: null, why: 'the summary does not claim it' },
      ] }) } }] }
    },
  }))
  assert.equal(asked, 1, 'exactly one call, as capped')
  assert.equal(r.verdicts.has(15), false,
    'one field answered no and the other was never asked — that is silence, not a finding')
  assert.deepEqual(r.silent, [15])
  assert.ok(r.failures.some(f => /cap: 1 calls/.test(f.error)))
})

test('H:a-quote-too-short-to-mean-anything-is-refused', async () => {
  // The floor the profile side already applies (MIN_QUOTE_CHARS), pointed at the document. "leader"
  // appears in every executive document ever written and shows nothing about coverage.
  const client = fakeClient()
  const r = await runCoverageJudge(client, base({
    fetchJson: answer([{ seq: 15, covered: true, basis: 'synonym', quote: 'leader', why: 'it says leader' }]),
  }))
  assert.equal(r.verdicts.has(15), false, 'a verdict resting on six characters does not count')
  assert.deepEqual(r.silent, [15])
  assert.equal(r.refused, 1)
})

test('H:what-is-stored-is-what-was-asked-for', async () => {
  // The write must use the SAME key the read looked up, or every run is a miss and the cache is
  // decorative. Asserted by recomputing the key independently and finding it in the insert.
  const client = fakeClient()
  await runCoverageJudge(client, base())
  const ins = client.calls.find(c => /insert into requirement_coverage/.test(c.sql))
  assert.ok(ins, 'the verdict is stored')
  const key = verdictKey({ requirement: REQ.verbatim, field: 'ResumeSummary', fieldText: SUMMARY, model: 'gpt-4o' })
  assert.equal(ins.params[4], key, 'stored under the key the next run will look up')
  assert.equal(ins.params[3], REQ.verbatim, 'keyed on requirement TEXT — re-extraction destroys ids')
  assert.equal(ins.params[5], true)
  assert.equal(ins.params[14], 'gpt-4o', 'the model is recorded, so a model change is visible in the data')
  assert.match(ins.sql, /on conflict \(opp_id, verdict_key\) do nothing/,
    'two artifacts of one packet judging identical text must not collide')
})

test('H:the-lexical-answer-is-stored-beside-the-judges', async () => {
  // AC-15. Without this column "is the judge earning its calls" is answerable only by anecdote. The
  // measured case: coversIn says NO to the pair the judge says YES to, and both readings are kept.
  const client = fakeClient()
  await runCoverageJudge(client, base())
  const ins = client.calls.find(c => /insert into requirement_coverage/.test(c.sql))
  assert.equal(ins.params[5], true, 'the judge covered it')
  assert.equal(ins.params[11], false,
    'and coversIn did not — strategy vs strategies, the 0.60 near-miss this tier was built for')
})

test('H:the-judge-asks-about-the-fields-the-check-reads', async () => {
  // ONE derivation of "which fields does this artifact have". If the judge asked about a different
  // set than covText is built from, it would be answering about a document the check never saw.
  assert.deepEqual(judgeableFields('resume', { ResumeSummary: SUMMARY, ExpertiseBullets: '   ', Nonsense: 'x' })
    .map(f => f.field), ['ResumeSummary'],
    'empty and unknown fields are not judged')
  const both = judgeableFields('resume', { ResumeSummary: SUMMARY, ExpertiseBullets: EXPERTISE }).map(f => f.field)
  assert.ok(both.includes('ResumeSummary') && both.includes('ExpertiseBullets'))
})

test('H:the-map-handed-to-checks-carries-only-what-checks-reads', async () => {
  const client = fakeClient()
  const r = await runCoverageJudge(client, base())
  const map = judgeVerdictsFor(r)
  assert.deepEqual([...map.keys()], [15])
  assert.deepEqual(Object.keys(map.get(15)).sort(), ['basis', 'covered', 'quote', 'why'])
  assert.equal(judgeVerdictsFor({ calls: 0, cacheHits: 0, refused: 0, silent: [], failures: [] }), undefined,
    'no run means no map, not an empty one — an empty map means "asked and answered nothing"')
})

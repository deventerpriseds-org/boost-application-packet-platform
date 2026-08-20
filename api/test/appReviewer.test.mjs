// D16 — reviewer agreement is measured against the rows the deterministic engine actually judged.
//
// This exercises `runReview` end to end against a fake pg client and an injected model response, so
// the assertion is about what the STORED numbers become, not about how the judged set is spelled.
// `judgedMustHaveIds` has its own unit tests in artifactScore.test.mjs; this file is what fails if
// the caller stops using it, which a source grep could be talked out of.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runReview } from '../dist/functions/tests/appReviewer.js'

const POSTING = 'We are hiring. Requirements: reside on the East Coast, US citizenship, ten years of '
  + 'experience, and deep experience with roadmap strategy and execution.'

// r0 an eligibility clause and r1 a fact-owned row: checks.ts drops both from `coverable`, so the
// engine reached NO coverage verdict on them. r2 judged and covered, r3 judged and uncovered — which
// is exactly what "1/2 must-have requirements evidenced" with r3 uncovered describes.
const REQS = [
  { id: 'r0', seq: 0, kind: 'must_have', item_text: 'reside on the East Coast', verbatim: 'reside on the East Coast', char_start: null, char_end: null, jd_text_sha256: null },
  { id: 'r1', seq: 1, kind: 'must_have', item_text: 'US citizenship', verbatim: 'US citizenship', char_start: null, char_end: null, jd_text_sha256: null },
  { id: 'r2', seq: 2, kind: 'must_have', item_text: 'ten years of experience', verbatim: 'ten years of experience', char_start: null, char_end: null, jd_text_sha256: null },
  { id: 'r3', seq: 3, kind: 'must_have', item_text: 'deep experience with roadmap strategy and execution', verbatim: 'deep experience with roadmap strategy and execution', char_start: null, char_end: null, jd_text_sha256: null },
]

/**
 * A pg client that answers only the reads `runReview` makes, and records the writes.
 *
 * Deliberately not a general fake: an unrecognised statement throws, so a query added to the module
 * later fails this test loudly instead of silently returning `{ rows: [] }` and letting an assertion
 * pass on a path that no longer runs.
 */
function fakeClient(scoreRow) {
  const writes = []
  return {
    writes,
    async query(sql, params) {
      const q = String(sql).replace(/\s+/g, ' ').trim()
      if (/^(begin|commit|rollback)$/i.test(q)) return { rows: [] }
      if (q.startsWith('select a.id, a.type')) {
        return { rows: [{ id: 'art1', type: 'resume', packet_id: 'p1', opp_id: 'o1', pkg_json: { ResumeSummary: 'x' }, company: 'Acme', role: 'Director', owner_email: 'o@e.io', jd_real: POSTING, raw_jd: null, why_surfaced: null, jd_text: POSTING, jd_text_sha256: null }] }
      }
      if (q.startsWith('select run_id, override_by from artifact_gate')) return { rows: [{ run_id: 'run1', override_by: null }] }
      if (q.startsWith('select id, seq, kind, item_text')) return { rows: REQS }
      if (q.startsWith('select uncovered_requirement_ids')) return { rows: scoreRow ? [scoreRow] : [] }
      if (q.startsWith('select must_have_coverage, keyword_coverage, weights')) return { rows: [] }
      if (q.startsWith('delete from check_result')) { writes.push(['delete', params]); return { rows: [] } }
      if (q.startsWith('insert into check_result')) { writes.push(['check', params]); return { rows: [] } }
      if (q.startsWith('insert into review_verdict')) { writes.push(['verdict', params]); return { rows: [] } }
      if (q.startsWith('select check_key, engine, state')) {
        return { rows: writes.filter(w => w[0] === 'check').map(w => ({ check_key: w[1][2], engine: 'reviewer', state: w[1][3], observed: w[1][4], expected: w[1][5], offenders: w[1][6] })) }
      }
      if (q.startsWith('update artifact_gate set')) { writes.push(['gate', params]); return { rows: [] } }
      throw new Error(`fakeClient: unhandled statement "${q.slice(0, 80)}"`)
    },
  }
}

const modelSays = (judgements) => async () => ({
  choices: [{ message: { content: JSON.stringify({ grade: 'acceptable', seniority_alignment: 70, judgements, citations: [], critique: [] }) } }],
})

test('a requirement the engine never judged is not_comparable, never agreement', async () => {
  const client = fakeClient({
    uncovered_requirement_ids: ['r3'],
    must_have_coverage: 50,
    must_have_source: '1/2 must-have requirements evidenced',
  })
  // The reviewer calls the two EXCLUDED rows covered, and agrees with the engine about r3.
  const out = await runReview(client, 'art1', 'o@e.io', modelSays([
    { requirement_id: 'r0', covered: true },
    { requirement_id: 'r1', covered: true },
    { requirement_id: 'r3', covered: false },
  ]))

  assert.equal(out.ran, true)
  assert.equal(out.agreed, 1,
    'rows the engine excluded from coverage were counted as agreeing with the reviewer')
  assert.equal(out.disagreed, 0)

  const row = out.results.find(r => r.check_key === 'reviewer_coverage_agreement')
  assert.match(row.observed, /2 not comparable/,
    'the two unjudged rows must be reported as not comparable, on screen, not absorbed into "agreed"')
})

test('when the engine judged every must-have, every judgement is still compared', async () => {
  const client = fakeClient({
    uncovered_requirement_ids: ['r3'],
    must_have_coverage: 75,
    must_have_source: '3/4 must-have requirements evidenced',
  })
  const out = await runReview(client, 'art1', 'o@e.io', modelSays([
    { requirement_id: 'r0', covered: true },
    { requirement_id: 'r1', covered: true },
    { requirement_id: 'r3', covered: false },
  ]))
  assert.equal(out.agreed, 3, 'the fix must not throw away a measurement that was genuinely comparable')
  assert.equal(out.disagreed, 0)
  const row = out.results.find(r => r.check_key === 'reviewer_coverage_agreement')
  assert.ok(!/not comparable/.test(row.observed), `nothing was excluded, so nothing is incomparable — got "${row.observed}"`)
})

test('no coverage verdict at all means no agreement is claimed', async () => {
  // must_have_coverage null: the check was not_applicable. Reporting "0 disagreed" as consensus is
  // the absent-evidence-read-as-a-pass failure this codebase guards everywhere else.
  const client = fakeClient({ uncovered_requirement_ids: [], must_have_coverage: null, must_have_source: null })
  const out = await runReview(client, 'art1', 'o@e.io', modelSays([
    { requirement_id: 'r2', covered: true },
    { requirement_id: 'r3', covered: false },
  ]))
  assert.equal(out.agreed, 0)
  assert.equal(out.disagreed, 0)
  const row = out.results.find(r => r.check_key === 'reviewer_coverage_agreement')
  assert.equal(row.state, 'not_applicable')
  assert.match(row.observed, /2 not comparable/)
})

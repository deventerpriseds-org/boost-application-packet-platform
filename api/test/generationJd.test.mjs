// X1 — generation must be grounded in the employer's posting, not in our own metadata about the job.
// Before this, `jd_real` was never selected by any of the four call sites, so every figure and claim
// the pipeline produced came from role/company/why_surfaced/company_signals/pain_hypotheses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generationJd } from '../dist/functions/tests/appPackets.js'

const OPP = {
  role: 'VP Product', company: 'Acme', comp_range: '$300k',
  company_signals: ['Series D'], pain_hypotheses: ['no roadmap discipline'],
  why_surfaced: 'New LinkedIn alert: 12 jobs matching your search',
}

test('the posting leads and is marked grounded', () => {
  const r = generationJd({ ...OPP, jd_real: '<p>You will own the roadmap for our hiring platform. 10+ years required.</p>' })
  assert.equal(r.grounded, true)
  assert.match(r.jd, /JOB POSTING/)
  assert.match(r.jd, /own the roadmap for our hiring platform/)
  assert.ok(r.jd.indexOf('JOB POSTING') < r.jd.indexOf('RESEARCH CONTEXT'), 'posting must come first')
})

test('research context is kept but labelled as NOT from the posting', () => {
  const r = generationJd({ ...OPP, jd_real: '<p>Own the roadmap. 10+ years required.</p>' })
  assert.match(r.jd, /RESEARCH CONTEXT \(our notes, NOT from the posting\)/)
  assert.match(r.jd, /Comp: \$300k/)
  assert.match(r.jd, /Series D/)
})

test('the alert digest is dropped once a real posting exists', () => {
  const r = generationJd({ ...OPP, jd_real: '<p>Own the roadmap for our platform.</p>' })
  assert.ok(!/New LinkedIn alert/.test(r.jd),
    'why_surfaced describes SIBLING jobs — the exact fabrication resolveJdSource refuses to parse')
})

test('no posting: builds anyway, but is NEVER marked grounded', () => {
  const r = generationJd({ ...OPP, jd_real: null, raw_jd: null })
  assert.equal(r.grounded, false)
  assert.ok(!/JOB POSTING/.test(r.jd))
  assert.match(r.jd, /VP Product at Acme/)
})

test('an alert digest in raw_jd does not count as a posting', () => {
  const r = generationJd({ ...OPP, jd_real: null, raw_jd: 'New LinkedIn alert: 12 jobs', why_surfaced: 'LinkedIn alert' })
  assert.equal(r.grounded, false)
})

test('the posting is bounded so a huge JD cannot blow the prompt', () => {
  const r = generationJd({ ...OPP, jd_real: '<p>' + 'own the roadmap. '.repeat(3000) + '</p>' })
  assert.equal(r.grounded, true)
  assert.ok(r.jd.length < 14000, `prompt grew to ${r.jd.length}`)
})

// P7 — Calls 2 and 3 sent their stored prompts RAW. `resolveZapVars` was applied to Call 1 only, so
// every `{{node__field}}` token in `portfolio_user` and `ats_user` reached the model as a literal.
// For Call 3 that included {{289877647__answers__Target Job Description}}: the ATS-QC pass was
// asked to compare two skill lists against a posting it had never been shown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveZapVars } from '../dist/functions/tests/zapVars.js'

const MC = {
  resumeSummary: 'MC summary',
  skills1: 'MC skills one',
  skills2: 'MC skills two',
  expertise: 'MC expertise',
  workHistory1: 'MC work 1',
  workHistory2: 'MC work 2',
  itemsToOmit: 'MC omit list',
}
const JD = 'Director of Platform Engineering. Must have SOC 2 and 10 years of leadership.'

test('the job-description token resolves — this is what Call 3 was missing', () => {
  const out = resolveZapVars('Job:\n{{289877647__answers__Target Job Description}}', MC, JD)
  assert.equal(out, `Job:\n${JD}`)
  assert.ok(!out.includes('{{'))
})

test('an unmapped token is still blanked, never shown to the model', () => {
  const out = resolveZapVars('A {{289877662__output__Item 33}} B', MC, JD)
  assert.equal(out, 'A  B')
})

test('extra supplies the run-scoped tokens that MasterContext cannot', () => {
  // The ats_user tokens for Call-1's own output lists.
  const tpl = 'Skills 1: {{289877667__skills list 1}}\nRelevant 1: {{289877667__Relevant 1}}\nCompany: {{289877662__output__Item 7}}'
  const out = resolveZapVars(tpl, MC, JD, undefined, {
    '289877667__skills list 1': 'Cloud Strategy | DevSecOps',
    '289877667__Relevant 1': 'Roadmap Ownership',
    '289877662__output__Item 7': 'TechVenture Inc',
  })
  assert.equal(out, 'Skills 1: Cloud Strategy | DevSecOps\nRelevant 1: Roadmap Ownership\nCompany: TechVenture Inc')
})

test('extra overrides the MasterContext baseline for the same token', () => {
  // Call 1 already replaced the standing profile text; Call 3 must review what Call 1 produced.
  const out = resolveZapVars('{{289877648__value}}', MC, JD, undefined, { '289877648__value': 'Call-1 rewritten summary' })
  assert.equal(out, 'Call-1 rewritten summary')
  assert.equal(resolveZapVars('{{289877648__value}}', MC, JD), 'MC summary', 'without extra the baseline still wins')
})

test('extra tolerates null/undefined values without printing "undefined" into the prompt', () => {
  const out = resolveZapVars('[{{289877667__Expertise}}]', MC, JD, undefined, { '289877667__Expertise': undefined })
  assert.equal(out, '[]')
})

test('omitting extra changes nothing for existing callers (Call 1 is untouched)', () => {
  const tpl = 'Summary: {{289877648__value}} Omit: {{289877659__Items to Omit}} Work: {{289877649__value}}'
  const before = resolveZapVars(tpl, MC, JD)
  const after = resolveZapVars(tpl, MC, JD, undefined, {})
  assert.equal(before, after)
  assert.match(before, /Summary: MC summary/)
  assert.match(before, /Omit: MC omit list/)
  assert.match(before, /MC work 1\n\nMC work 2/)
})

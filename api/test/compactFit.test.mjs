// The compact resume's single Core Skills line, and the decision to DELETE a skill from a document
// the owner sends to employers. That is the reason this file is thorough out of proportion to the
// module's size.
//
// Owner's instruction: "the skills are broken into two columns in the regular resume but its a
// single block in the compact resume so i think you should be starting with taking the two and
// making them one as a part of generating the compact resume. if overspill of space becomes an
// issue, it should be flagged. the least relevent item could be removed to make it fit and i should
// be notified that happened in the right margin."
import test from 'node:test'
import assert from 'node:assert/strict'
import { fitCompactSkills, DEFAULT_SEPARATOR } from '../dist/functions/tests/compactFit.js'

const P = (label, action, driver, requirementId = null, seq = null) => ({ label, action, driver, requirementId, seq })

test('H:compact-combines-both-lists-in-document-order', () => {
  const r = fitCompactSkills({ skills1: ['A', 'B'], skills2: ['C', 'D'], budget: 999 })
  assert.deepEqual(r.kept, ['A', 'B', 'C', 'D'], 'both columns become one line, order preserved')
  assert.equal(r.text, ['A', 'B', 'C', 'D'].join(DEFAULT_SEPARATOR))
  assert.equal(r.fits, true)
  assert.deepEqual(r.dropped, [], 'nothing is removed when it already fits')
})

test('H:compact-dedupes-across-the-two-lists', () => {
  // The full resume hides a duplicate in two columns; one block does not. Collapsed once, and the
  // FIRST occurrence wins so document order is what survives.
  const r = fitCompactSkills({ skills1: ['Kubernetes', 'AWS'], skills2: ['kubernetes ', 'Terraform'], budget: 999 })
  assert.deepEqual(r.kept, ['Kubernetes', 'AWS', 'Terraform'])
})

test('H:compact-never-drops-a-posting-answer: evidence is not deleted to save space', () => {
  // THE CENTRAL SAFETY PROPERTY. An item answering a requirement is what the packet's coverage
  // claims rest on. Dropping one to fit would make the resume disagree with its own evidence.
  const skills1 = ['Master One', 'Master Two', 'Master Three']
  const skills2 = ['Platform Modernization', 'Master Four']
  const provenance = [
    P('Master One', 'kept', 'unattributed', null, 0),
    P('Master Two', 'kept', 'unattributed', null, 1),
    P('Master Three', 'kept', 'unattributed', null, 2),
    P('Platform Modernization', 'swapped', 'posting', 'req-1', 3),
    P('Master Four', 'kept', 'unattributed', null, 4),
  ]
  const r = fitCompactSkills({ skills1, skills2, provenance, budget: 25 })
  assert.ok(r.kept.includes('Platform Modernization'), 'the posting-driven skill must survive')
  assert.ok(!r.dropped.some((d) => d.label === 'Platform Modernization'))
})

test('H:compact-drop-order-is-master-content-first-then-posting-added', () => {
  // The measured tiers (live swap_decision over skills_1/skills_2, 2026-08-24):
  //   swapped+posting 4 -> never dropped
  //   swapped/added+unattributed 9 -> pipeline put it here FOR this posting
  //   kept+unattributed 27 -> master content answering nothing: the drop pool
  const items = ['Keep Me Posting', 'Added For This', 'Master Filler']
  const provenance = [
    P('Keep Me Posting', 'swapped', 'posting', 'req-1', 0),
    P('Added For This', 'added', 'unattributed', null, 1),
    P('Master Filler', 'kept', 'unattributed', null, 2),
  ]
  // Budget forces exactly one drop.
  const full = items.join(DEFAULT_SEPARATOR).length
  const r = fitCompactSkills({ skills1: items, skills2: [], provenance, budget: full - 1 })
  assert.equal(r.dropped.length, 1)
  assert.equal(r.dropped[0].label, 'Master Filler', 'master content answering nothing goes first')
  assert.match(r.dropped[0].reason, /master list/i, 'the margin must say WHY this one')
})

test('H:compact-drops-only-as-far-as-the-budget-requires', () => {
  // Removing more than necessary is the same defect as removing the wrong one: it is content the
  // owner wrote, gone for no reason.
  const items = ['AAAA', 'BBBB', 'CCCC', 'DDDD']
  const prov = items.map((l, i) => P(l, 'kept', 'unattributed', null, i))
  const full = items.join(DEFAULT_SEPARATOR).length
  const r = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget: full - 1 })
  assert.equal(r.dropped.length, 1, 'one item over budget removes exactly one item')
  assert.ok(r.text.length <= r.budget)
})

test('H:compact-tie-breaks-on-position-deterministically', () => {
  // Same rank across the pool: the END of the line goes first, and repeated calls agree. A
  // non-deterministic pick would delete a different skill on every rebuild.
  const items = ['One', 'Two', 'Three', 'Four']
  const prov = items.map((l, i) => P(l, 'kept', 'unattributed', null, i))
  const budget = items.join(DEFAULT_SEPARATOR).length - 1
  const a = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget })
  const b = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget })
  assert.deepEqual(a.dropped.map((d) => d.label), ['Four'], 'the last item goes first')
  assert.deepEqual(a.dropped, b.dropped, 'the same inputs must always drop the same item')
})

test('H:compact-over-budget-after-drops-is-declared-not-hidden', () => {
  // Everything left answers the posting and it STILL does not fit. Deleting one of those would
  // remove the evidence the coverage claims depend on, so it ships long and says so.
  const items = ['Posting Skill Number One', 'Posting Skill Number Two']
  const prov = items.map((l, i) => P(l, 'swapped', 'posting', `req-${i}`, i))
  const r = fitCompactSkills({ skills1: items, skills2: [], provenance: prov, budget: 5 })
  assert.deepEqual(r.dropped, [], 'no posting answer may be dropped')
  assert.equal(r.fits, false)
  assert.equal(r.overBudgetAfterDrops, true, 'the overflow must be declared')
  assert.ok(r.text.includes('Posting Skill Number One'), 'the content still ships')
})

test('H:compact-no-provenance-is-treated-as-master-content-not-as-protected', () => {
  // Absent evidence must never grant protection. A skill with no recorded row is master content
  // until something says otherwise — the inverse would make an unrecorded item undroppable and the
  // line could never be made to fit.
  const items = ['AAAA', 'BBBB', 'CCCC']
  const full = items.join(DEFAULT_SEPARATOR).length
  const r = fitCompactSkills({ skills1: items, skills2: [], budget: full - 1 })
  assert.equal(r.dropped.length, 1, 'an unrecorded skill is droppable')
})

test('H:compact-separator-counts-against-the-budget', () => {
  // The joiner is real text in the rendered line. Ignoring it under-counts and the document
  // overflows anyway — a budget that lies is worse than no budget.
  const items = ['AAAA', 'BBBB']
  const r = fitCompactSkills({ skills1: items, skills2: [], budget: 8 })   // 4+4 fits, 4+3+4 does not
  assert.equal(r.fullLength, ('AAAA' + DEFAULT_SEPARATOR + 'BBBB').length)
  assert.ok(r.fullLength > 8, 'the separator is part of the measured length')
  assert.equal(r.dropped.length, 1)
})

test('H:compact-empty-input-is-not-an-error', () => {
  const r = fitCompactSkills({ skills1: [], skills2: [], budget: 10 })
  assert.equal(r.text, '')
  assert.equal(r.fits, true)
  assert.deepEqual(r.dropped, [])
})

// ── The four defects an independent AC pass found, each proven by EXECUTION first ────────────────
// Every one of these passed the original suite. They are the shapes the tests did not cover, which
// is why "mutation-proven" was an overstatement: a mutation proves a test catches one reversion, not
// that the suite covers the space.

test('H:compact-rank-is-the-strongest-claim: a duplicated label cannot lose its posting evidence', () => {
  // D-1. Measured before the fix: identical data, and the ORDER of provenance rows decided whether
  // a skill answering req-9 survived. Kept-row-first DELETED it; posting-row-first kept it.
  const args = (rows) => ({
    skills1: ['Kubernetes', 'Filler A'], skills2: ['Kubernetes'], provenance: rows, budget: 6,
  })
  const kept  = { label: 'Kubernetes', action: 'kept',    driver: 'unattributed', requirementId: null,    seq: 0 }
  const post  = { label: 'Kubernetes', action: 'swapped', driver: 'posting',      requirementId: 'req-9', seq: 1 }
  const other = { label: 'Filler A',   action: 'kept',    driver: 'unattributed', requirementId: null,    seq: 2 }

  for (const rows of [[kept, post, other], [post, kept, other]]) {
    const r = fitCompactSkills(args(rows))
    assert.ok(!r.dropped.some((d) => d.label === 'Kubernetes'),
      `a label with ANY posting row must survive regardless of row order: ${JSON.stringify(r.dropped)}`)
  }
})

test('H:compact-unreadable-budget-ships-content-never-blanks-it', () => {
  // D-2. Measured before the fix: `budget: NaN` returned { text:'', kept:[], fits:true } — every
  // skill deleted and the blank line reported as a success.
  for (const budget of [NaN, null, undefined, 0, -5, 'abc']) {
    const r = fitCompactSkills({ skills1: ['Alpha', 'Bravo', 'Charlie'], skills2: [], budget })
    assert.deepEqual(r.kept, ['Alpha', 'Bravo', 'Charlie'], `budget ${String(budget)} must not delete content`)
    assert.deepEqual(r.dropped, [])
    assert.equal(r.budgetUnreadable, true, 'and it must SAY the fit was never enforced')
  }
})

test('H:compact-tie-break-uses-document-position-not-per-list-seq', () => {
  // D-3. `swap_decision.seq` restarts per list (schema keys it unique per packet+list+seq+loop), so
  // ordering by it let a skills_2 item out-rank a skills_1 item by position alone. The correct
  // ordinal is the index in the COMBINED line. Note both lists are populated here — the original
  // suite passed `skills2: []` everywhere, so this could not have been caught.
  const r = fitCompactSkills({
    skills1: ['Alpha', 'Bravo'],
    skills2: ['Delta', 'Echo'],
    provenance: [
      { label: 'Alpha', action: 'kept', driver: 'unattributed', seq: 0 },
      { label: 'Bravo', action: 'kept', driver: 'unattributed', seq: 1 },
      { label: 'Delta', action: 'kept', driver: 'unattributed', seq: 0 },   // seq RESTARTS
      { label: 'Echo',  action: 'kept', driver: 'unattributed', seq: 1 },
    ],
    budget: ['Alpha', 'Bravo', 'Delta', 'Echo'].join(DEFAULT_SEPARATOR).length - 1,
  })
  assert.deepEqual(r.dropped.map((d) => d.label), ['Echo'],
    'the last item in the COMBINED line goes first, not the one with the highest per-list seq')
})

test('H:compact-an-already-dropped-row-does-not-protect-a-label', () => {
  // D-4. `driver` was checked before `action`, so a dropped+posting row ranked as protected and two
  // live skills were deleted to preserve an item the pipeline had already removed.
  // Ghost is placed LAST on purpose. The first draft of this test put it first, and it survived on
  // the position tie-break rather than on protection — a test that would have passed either way and
  // proved nothing. Last position isolates the one variable: with the fix Ghost is rank 0 and goes
  // first; before it, Ghost ranked 2 and a live skill was deleted instead.
  const r = fitCompactSkills({
    skills1: ['Live One', 'Live Two', 'Ghost'], skills2: [],
    provenance: [
      { label: 'Live One', action: 'kept',    driver: 'unattributed', requirementId: null,    seq: 0 },
      { label: 'Live Two', action: 'kept',    driver: 'unattributed', requirementId: null,    seq: 1 },
      { label: 'Ghost',    action: 'dropped', driver: 'posting',      requirementId: 'req-1', seq: 2 },
    ],
    budget: 'Live One | Live Two'.length,
  })
  assert.deepEqual(r.dropped.map((d) => d.label), ['Ghost'],
    'an already-dropped row must be droppable, and it goes before any live content')
  assert.ok(r.kept.includes('Live One') && r.kept.includes('Live Two'),
    'live content must not be sacrificed to keep a ghost')
})

// ── The wiring: a declared placeholder MUST have a producer, and drops MUST reach the margin ─────
import { readFileSync as _rf } from 'node:fs'
const PACKETS_SRC = _rf(new URL('../src/functions/tests/appPackets.ts', import.meta.url), 'utf8')
const CHECKS_SRC  = _rf(new URL('../src/functions/tests/checks.ts', import.meta.url), 'utf8')
const META_SRC    = _rf(new URL('../src/functions/tests/packetTemplates.ts', import.meta.url), 'utf8')

test('H:compact-placeholder-has-a-producer: a declared token nothing fills blanks the document', () => {
  // THE DEFECT THIS BRANCH BRIEFLY SHIPPED. `TEMPLATE_META.compact_resume` declares
  // {{SkillsBullets}}; if nothing assigns pkg.SkillsBullets, varsForType injects '' and the compact
  // resume goes out with a BLANK Core Skills line, silently. Asserted structurally because a
  // runtime test would need Google and Postgres.
  assert.match(META_SRC, /placeholders: \['ResumeSummary', 'SkillsBullets'\]/,
    'the compact resume must declare the combined line')
  assert.match(PACKETS_SRC, /pkg = \{ \.\.\.pkg, SkillsBullets: fit\.text \}/,
    'nothing produces pkg.SkillsBullets — the compact resume would ship blank')
  assert.match(PACKETS_SRC, /if \(art\.type === 'compact_resume'\)/,
    'the producer must be scoped to the compact resume')
})

test('H:compact-drop-reaches-the-margin: the owner is told WHICH skill went, not how many', () => {
  // The owner asked to be "notified that happened in the right margin". The margin renders
  // check_result offenders, and the repo's rule is that offenders NAME the items: "2 removed" tells
  // them something is wrong without telling them what to put back.
  assert.match(CHECKS_SRC, /out\.push\(bad\('compact_skills_fit'/,
    'there must be a compact_skills_fit finding')
  assert.match(CHECKS_SRC, /fit\.dropped\.map\(d => `\$\{d\.label\} — \$\{d\.reason\}`\)/,
    'offenders must name each dropped skill and why')
  // It must reuse the render's function, not re-implement the rule.
  assert.match(CHECKS_SRC, /import \{ fitCompactSkills \} from '\.\/compactFit'/,
    'the check must reuse fitCompactSkills, never a second copy of the drop rule')
  // An unreadable budget must not read as a pass.
  assert.match(CHECKS_SRC, /if \(fit\.budgetUnreadable\)/,
    'a budget that could not be read must be reported, never treated as fitting')
})

test('H:compact-check-sees-the-same-facts-the-render-did', () => {
  // Ranking on `driver` alone would let the check name a different skill than the document lost.
  assert.match(CHECKS_SRC, /requirementId: sw\.requirement_id \?\? null/,
    'the check must receive requirement_id so it reproduces the render decision')
  const APPCHECKS = _rf(new URL('../src/functions/tests/appChecks.ts', import.meta.url), 'utf8')
  assert.match(APPCHECKS, /select action, driver, to_label, from_label, requirement_id, seq, list from swap_decision/,
    'the swaps projection must carry the fields the ranking reads')
})

// ── Found by an independent verifier on 4c070dd, both live and both mine ─────────────────────────

test('H:compact-empty-line-is-never-a-pass', () => {
  // F1. An empty combined line returned { text:'', fits:true, dropped:[] } and the check printed
  // "Core Skills fits: 0 of 320 chars" — a GREEN PASS on a blank section of a document the owner
  // sends to employers. That is the exact failure this module exists to prevent, arriving through
  // the front door, and it violates "absent evidence is never a pass".
  for (const [s1, s2] of [[[], []], [[''], ['  ']], [[], ['']]]) {
    const r = fitCompactSkills({ skills1: s1, skills2: s2, budget: 320 })
    assert.equal(r.text, '')
    assert.equal(r.empty, true, `no content must be DECLARED, not reported as fitting: ${JSON.stringify([s1, s2])}`)
  }
  // ...and content present must NOT be flagged empty.
  assert.equal(fitCompactSkills({ skills1: ['Go'], skills2: [], budget: 320 }).empty, undefined)
})

test('H:compact-empty-line-fails-the-CHECK-not-just-the-module', async () => {
  // The module-level case above passed while the CHECK still reported the blank line as a pass —
  // caught by mutating `if (fit.empty)` to `if (false)` and watching the suite stay green. A flag
  // nothing reads is not a guard, and this is the layer the owner actually sees.
  const { runChecks } = await import('../dist/functions/tests/checks.js')
  const r = runChecks({
    type: 'compact_resume', pkg: { ResumeSummary: 'x' }, company: 'X', requirements: [], swaps: [],
    postingText: '', profileText: '', evidence: {}, facts: {}, thresholds: {},
  }).find((x) => x.check_key === 'compact_skills_fit')
  assert.ok(r, 'compact_skills_fit must be emitted')
  assert.equal(r.state, 'fail', 'a blank Core Skills section must not report as fitting')
  assert.match(r.observed, /empty/i, 'and it must say the line is empty, not quote a character count')
})

test('H:compact-checks-are-not-fewer-than-the-resume-s', async () => {
  // F2 — THE REGRESSION THIS BRANCH INTRODUCED, and the implementer wrongly called it "NOT REAL".
  // `has()` gated on `mergeFieldsFor(type)` — the TEMPLATE PLACEHOLDER list — so when compact_resume
  // stopped declaring the resume's seven placeholders it silently took SIX checks with it, including
  // `omission_list`, the owner's never-use list. They did not degrade to `not_applicable`; they were
  // never emitted, and a gate cannot see a check that never ran.
  //
  // Measured before the fix: resume 17 results, compact_resume 12.
  const { runChecks } = await import('../dist/functions/tests/checks.js')
  const pkg = {
    ResumeSummary: 'x', SkillsBullets1: 'Kubernetes | Rust', SkillsBullets2: 'Go | Terraform',
    ExpertiseBullets: 'a | b', RelevantBullets1: 'c', RelevantBullets2: 'd', RelevantBullets3: 'e',
  }
  const run = (type) => runChecks({
    type, pkg, company: 'X', requirements: [], swaps: [], postingText: '', profileText: '',
    evidence: {}, facts: { itemsToOmit: 'Rust' }, thresholds: {},
  }).map((r) => r.check_key)

  const resume = new Set(run('resume'))
  const compact = new Set(run('compact_resume'))
  const lost = [...resume].filter((k) => !compact.has(k))
  assert.deepEqual(lost, [],
    `the compact resume ships the resume's skills content and must answer the same rules; lost: ${lost.join(', ')}`)
  assert.ok(compact.has('omission_list'), "the owner's never-use list must be checked on the compact resume")
  assert.ok(compact.has('compact_skills_fit'), 'and the compact resume keeps its own fit check')
})

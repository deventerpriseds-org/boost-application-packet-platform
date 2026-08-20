// P8.4 — the posting-vs-profile comparison. Tests written against the COLD acceptance criteria in
// docs/qc-evidence/AC-P8.4.md, which were produced by an independent agent before this code existed.
//
// Each test names the criterion it discharges. Where a test guards a defect, the defect is the one
// the criterion predicted — and every guard here was proved by reinstating that defect and watching
// the named assertion fail (recorded per test).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIMENSION_CATALOGUE, DIMENSION_BY_KEY, DIMENSION_SETS, DEFAULT_SET_KEY, DIMENSION_VERSION,
  dimensionsFor, gradeFit, fitLabel, buildComparison, summarize, hasNumericComparator,
  STRONG_AT, MODERATE_AT,
} from '../dist/functions/tests/dimensions.js'
import { MIN_JUDGEABLE_TOKENS } from '../dist/functions/tests/evidence.js'

const defs = DIMENSION_CATALOGUE
const only = (key) => [DIMENSION_BY_KEY.get(key)]

const req = (seq, text, extra = {}) => ({
  seq, verbatim: text, item_text: text, kind: 'must_have', match_method: 'exact', evidence: null, ...extra,
})
const withEvidence = (r, quote = 'Led a distributed organization of 62 engineers across three time zones', ratio = 0.9) =>
  ({ ...r, evidence: { quote, source_label: 'Work history · VP Engineering, Resideo', source_kind: 'work_history', ratio } })

const fact = (key, value, value_num, confirmed = true) => ({
  key, value, value_num, source: 'owner_stated', confirmed_at: confirmed ? '2026-01-01T00:00:00Z' : null,
})

// ── AC14: the grading boundaries, exactly ──────────────────────────────────────────────────────

test('AC14: the fit boundaries are >= 0.99 strong, >= 0.7 moderate, else weak — pinned at each edge', () => {
  assert.equal(STRONG_AT, 0.99)
  assert.equal(MODERATE_AT, 0.7)
  assert.equal(gradeFit(100, 100), 'strong')       // 1.0
  assert.equal(gradeFit(99, 100), 'strong')        // 0.99 inclusive
  assert.equal(gradeFit(98999, 100000), 'moderate') // 0.98999
  assert.equal(gradeFit(70, 100), 'moderate')      // 0.7 inclusive
  assert.equal(gradeFit(69999, 100000), 'weak')    // 0.69999
  assert.equal(gradeFit(0, 100), 'weak')           // 0.0
})

// AC15 — the prototype's `fit(0,0) === 'strong'` (docs/qc-evidence/qc/data.js:606). Proved by
// reverting: `if (total <= 0) return 'strong'` makes THIS assertion fail by name.
test('AC15: a zero denominator is never a grade — 0 of 0 is not a strong match', () => {
  assert.equal(gradeFit(0, 0), 'not_applicable')
  assert.notEqual(gradeFit(0, 0), 'strong')
  assert.equal(gradeFit(5, 0), 'not_applicable')
  assert.equal(gradeFit(NaN, 3), 'not_applicable')
  assert.equal(gradeFit(1, -1), 'not_applicable')
})

// ── AC32: weak means two different things and must not print one sentence for both ─────────────

test('AC32: a measured shortfall never renders as "No evidence"', () => {
  assert.notEqual(fitLabel('weak', 'falls_short'), fitLabel('weak', 'nothing_found'))
  assert.ok(!/no evidence/i.test(fitLabel('weak', 'falls_short')),
    'a profile that speaks to the axis and falls short must not be reported as an absence')
  assert.equal(fitLabel('not_applicable'), 'Not compared')
})

// ── AC1 / AC2 / AC4 / AC5: the dimension set, and where it came from ───────────────────────────

test('AC1: the eight seeded dimensions live in one catalogue, keyed uniquely', () => {
  assert.equal(DIMENSION_CATALOGUE.length, 8)
  const keys = DIMENSION_CATALOGUE.map(d => d.key)
  assert.equal(new Set(keys).size, 8, 'two dimensions share a key')
  for (const d of DIMENSION_CATALOGUE) {
    assert.ok(d.label && d.help && d.asks instanceof RegExp, `${d.key} is missing label, help or matcher`)
  }
  // Every seeded per-family set names only real dimensions — a typo would silently drop an axis.
  for (const [family, list] of Object.entries(DIMENSION_SETS)) {
    for (const k of list) assert.ok(DIMENSION_BY_KEY.has(k), `${family} names unknown dimension ${k}`)
  }
})

test('AC2/AC5: a defaulted set is visibly defaulted, and an unconfigured family warns', () => {
  const seeded = dimensionsFor('engineering', null)
  assert.equal(seeded.source, 'seed_default')
  assert.ok(seeded.warning && /engineering/.test(seeded.warning),
    'a silent fallback and a chosen configuration must not be indistinguishable')

  const familySeed = dimensionsFor('product', null)
  assert.equal(familySeed.source, 'seed_family')
  assert.equal(familySeed.warning, undefined, 'a family with its own seeded set is not a fallback')
})

test('AC4: the owner set wins, and a dimension the owner removed produces no row at all', () => {
  const stored = { engineering: ['leadership_tenure', 'budget_owned'] }
  const r = dimensionsFor('engineering', stored)
  assert.equal(r.source, 'owner')
  assert.deepEqual(r.keys, ['leadership_tenure', 'budget_owned'])

  const rows = buildComparison({
    requirements: [req(0, 'Lead a distributed organization of 60+ engineers')],
    profileReadable: true, defs: r.defs,
  })
  assert.equal(rows.length, 2)
  assert.ok(!rows.some(x => x.key === 'organization_size'),
    'a removed dimension came back as a row — removal must remove, not grade weak')
})

test('AC4: turning every dimension off for a family is a real answer, not a missing one', () => {
  const r = dimensionsFor('engineering', { engineering: [] })
  assert.equal(r.source, 'owner')
  assert.deepEqual(r.keys, [])
  assert.equal(r.warning, undefined)
})

test('AC4: an unknown key in stored config is dropped rather than crashing or inventing a row', () => {
  const r = dimensionsFor('engineering', { engineering: ['leadership_tenure', 'not_a_dimension'] })
  assert.deepEqual(r.keys, ['leadership_tenure'])
})

// ── AC21: every state that must be not_applicable, never weak ──────────────────────────────────

const NA_CASES = [
  ['a: the posting is silent on the dimension', {
    requirements: [req(0, 'Write clean code and review pull requests carefully')],
    profileReadable: true, defs: only('public_sector'),
  }, /does not ask about public sector/],
  ['b: the stored profile could not be read', {
    requirements: [req(0, 'Own a P&L or budget of $10M+')],
    profileReadable: false, defs: only('budget_owned'),
  }, /could not be read/],
  ['c: the opportunity has no requirement rows', {
    requirements: [], profileReadable: true, defs: only('budget_owned'),
  }, /no lines to compare/],
  ['f: the matched line is too short to judge', {
    requirements: [req(0, 'Budget')], profileReadable: true, defs: only('budget_owned'),
  }, /too short to judge/],
  ['i: the stored offsets no longer match the posting', {
    requirements: [req(0, 'Own a P&L or budget of $10M+')],
    profileReadable: true, stale: true, defs: only('budget_owned'),
  }, /posting changed/],
]

for (const [name, input, reasonRe] of NA_CASES) {
  test(`AC21(${name}) is not_applicable with a reason, never weak`, () => {
    const [row] = buildComparison(input)
    assert.equal(row.fit, 'not_applicable', `${name} was graded ${row.fit}`)
    assert.notEqual(row.fit, 'weak')
    assert.ok(row.reason && row.reason.trim(), 'a not_applicable row with no reason is indistinguishable from a pass')
    assert.match(row.reason, reasonRe)
    assert.equal(row.covered, null)
    assert.equal(row.total, null)
    assert.equal(row.note, null)
  })
}

test('AC21(b): an unreadable profile still shows what the posting asks — one side, never a grade', () => {
  const [row] = buildComparison({
    requirements: [req(0, 'Own a P&L or budget of $10M+')],
    profileReadable: false, defs: only('budget_owned'),
  })
  assert.equal(row.fit, 'not_applicable')
  assert.ok(row.posting && /P&L/.test(row.posting.text))
  assert.equal(row.profile, null, 'an unreadable profile cannot produce a profile value')
})

test('AC21(g): an UNCONFIRMED fact never settles a dimension', () => {
  const rows = buildComparison({
    requirements: [req(0, 'Requires 10+ years of engineering leadership experience')],
    profileReadable: true, defs: only('leadership_tenure'),
    facts: [fact('experience.years_leadership', '14', 14, false)],
  })
  assert.notEqual(rows[0].basis, 'fact', 'a guess the system made about the owner settled a grade')
  assert.notEqual(rows[0].fit, 'strong')
})

// ── AC23: the mirror — a real gap is weak, and stays in the denominator ────────────────────────

test('AC23: a readable profile that supports nothing is weak, not not_applicable', () => {
  const [row] = buildComparison({
    requirements: [req(0, 'Own a P&L or budget of $10M+ across three business units')],
    profileReadable: true, defs: only('budget_owned'),
  })
  assert.equal(row.fit, 'weak', 'a real, measured gap was filed as unmeasured — the comparison now reads complete')
  assert.equal(row.shortfall, 'nothing_found')
  assert.equal(row.total, 1, 'a weak row must stay in the denominator')
  assert.equal(row.covered, 0)
  assert.ok(row.note && row.note.trim())
})

// ── AC30/AC31/AC33: the reason is mandatory, specific, and derived ─────────────────────────────

test('AC30: every moderate and weak row carries a non-empty note', () => {
  const rows = buildComparison({
    requirements: [
      withEvidence(req(0, 'Lead a distributed organization of 60+ engineers')),
      req(1, 'Grow the engineering organization through two acquisitions'),
      req(2, 'Own the engineering staff plan and headcount forecast'),
      req(3, 'Own a P&L or budget of $10M+ across three business units'),
      withEvidence(req(4, 'Reduce delivery cycle time across regulated programmes'),
        'Cut delivery cycle time 40% on one regulated programme', 0.8),
    ],
    profileReadable: true, defs,
  })
  const graded = rows.filter(r => r.fit === 'moderate' || r.fit === 'weak')
  assert.ok(graded.length >= 2, 'the fixture must actually produce moderate/weak rows')
  for (const r of graded) {
    assert.ok(r.note && r.note.trim().length > 0, `${r.key} is ${r.fit} with no reason`)
  }
})

test('AC31: a note names the specific shortfall and is not a restatement of anything on the row', () => {
  const rows = buildComparison({
    requirements: [
      withEvidence(req(0, 'Lead a distributed organization of 60+ engineers')),
      req(1, 'Grow the engineering organization through two acquisitions'),
      req(2, 'Own the engineering staff plan and headcount forecast'),
      req(3, 'Own a P&L or budget of $10M+ across three business units'),
      req(4, 'Deliver FedRAMP authorization for the public sector platform'),
    ],
    profileReadable: true, defs,
  })
  const graded = rows.filter(r => r.note)
  for (const r of graded) {
    assert.notEqual(r.note, r.label)
    assert.notEqual(r.note, fitLabel(r.fit, r.shortfall))
    if (r.posting) assert.notEqual(r.note, r.posting.text)
    if (r.profile) assert.notEqual(r.note, r.profile.value)
    assert.ok(r.note.length > 20, `"${r.note}" is too short to be a reason`)
  }
  // Three different shortfalls must produce three different sentences — a fixed string per grade
  // is filler, and filler is what the criterion exists to reject.
  const notes = new Set(graded.map(r => r.note))
  assert.ok(notes.size >= 3, `only ${notes.size} distinct notes across ${graded.length} graded rows — the note is boilerplate`)
})

test('AC33: a note is derived from stored values — it quotes the offending lines by seq', () => {
  const [row] = buildComparison({
    requirements: [
      req(7, 'Own a P&L or budget of $10M+ across three business units'),
      req(9, 'Manage the capex and opex plan for the engineering organization'),
    ],
    profileReadable: true, defs: only('budget_owned'),
  })
  assert.match(row.note, /#7/)
  assert.match(row.note, /#9/)
})

// ── AC16/AC17/AC19: how a grade was derived is recorded ────────────────────────────────────────

test('AC17: a comparable number is graded by arithmetic, and both numbers are on the row', () => {
  const [row] = buildComparison({
    requirements: [req(0, 'Requires 10+ years of engineering leadership experience')],
    profileReadable: true, defs: only('leadership_tenure'),
    facts: [fact('experience.years_leadership', '14', 14)],
  })
  assert.equal(row.basis, 'fact')
  assert.equal(row.numeric_verdict, 'satisfied')
  assert.equal(row.fit, 'strong')
  assert.ok(row.profile && row.profile.source === 'fact' && row.profile.value === '14')
  assert.ok(row.posting && /10\+ years/.test(row.posting.text))
})

test('AC17: a shortfall on a comparable number is weak and the note carries the arithmetic', () => {
  const [row] = buildComparison({
    requirements: [req(0, 'Requires 20+ years of engineering leadership experience')],
    profileReadable: true, defs: only('leadership_tenure'),
    facts: [fact('experience.years_leadership', '14', 14)],
  })
  assert.equal(row.fit, 'weak')
  assert.equal(row.numeric_verdict, 'not_satisfied')
  assert.equal(row.shortfall, 'falls_short')
  assert.match(row.note, /14/)
  assert.match(row.note, /20/)
})

// ── AC18: no grade from a number nobody compared ───────────────────────────────────────────────

test('AC18: org size and budget have no numeric comparator today, and the row says so', () => {
  assert.equal(hasNumericComparator('experience.years_leadership'), true)
  assert.equal(hasNumericComparator('scope.largest_team'), false,
    'if a comparator was added, this test must be updated deliberately — not silently')
  assert.equal(hasNumericComparator('scope.largest_budget'), false)
})

test('AC18: a budget dimension with only an uncomparable number is not_applicable, never graded', () => {
  const [row] = buildComparison({
    requirements: [req(0, 'Own a P&L or budget of $10M+ across three business units')],
    profileReadable: true, defs: only('budget_owned'),
    facts: [fact('scope.largest_budget', '$2M engineering budget', 2000000)],
  })
  assert.equal(row.fit, 'not_applicable', 'a number was graded with no comparator')
  assert.equal(row.numeric_verdict, 'unavailable')
  assert.match(row.reason, /cannot yet compare/)
  // Two-sided even when ungraded: the owner still sees their own recorded figure.
  assert.ok(row.profile && row.profile.source === 'fact')
  assert.ok(row.posting)
})

test('AC18: when evidence DOES support the line, the uncompared number is stated, not folded in', () => {
  const [row] = buildComparison({
    requirements: [withEvidence(req(0, 'Lead a distributed organization of 60+ engineers'))],
    profileReadable: true, defs: only('organization_size'),
    facts: [fact('scope.largest_team', '62 engineers', 62)],
  })
  assert.equal(row.basis, 'evidence')
  assert.equal(row.numeric_verdict, 'unavailable')
  assert.ok(row.note && /NOT compared/.test(row.note),
    'the row implied a numeric comparison it never made')
})

// ── AC8/AC9/AC10: what the two sides may contain ───────────────────────────────────────────────

test('AC8: an unlocated line is carried as a paraphrase and flagged as one, never as a quote', () => {
  const [row] = buildComparison({
    requirements: [{ seq: 3, verbatim: null, item_text: 'Own the compliance audit programme end to end',
                     kind: 'must_have', match_method: 'unlocatable', evidence: null }],
    profileReadable: true, defs: only('compliance_ownership'),
  })
  assert.equal(row.posting.quoted, false, 'a model paraphrase was presented as the employer\'s words')
})

test('AC8: a located line beats an unlocated one for the posting cell', () => {
  const [row] = buildComparison({
    requirements: [
      { seq: 1, verbatim: null, item_text: 'compliance things', kind: 'must_have', match_method: 'unlocatable', evidence: null },
      req(2, 'Own SOC 2 Type II and ISO 27001 through external audit'),
    ],
    profileReadable: true, defs: only('compliance_ownership'),
  })
  assert.equal(row.posting.quoted, true)
  assert.equal(row.posting.seq, 2)
})

test('AC9/AC10: the profile cell is the stored excerpt verbatim, never a rewrite', () => {
  const quote = 'Owned SOC 2 Type II and ISO 27001 through two external audits'
  const [row] = buildComparison({
    requirements: [withEvidence(req(0, 'Own SOC 2 Type II and ISO 27001 through external audit'), quote, 0.95)],
    profileReadable: true, defs: only('compliance_ownership'),
  })
  assert.equal(row.profile.value, quote, 'the profile cell must be the excerpt, byte for byte')
  assert.equal(row.profile.source, 'evidence')
  assert.match(row.profile.source_label, /Work history/)
})

test('AC10: the profile cell never carries a figure that exists only in the posting', () => {
  const rows = buildComparison({
    requirements: [
      withEvidence(req(0, 'Lead a distributed organization of 60+ engineers')),
      withEvidence(req(1, 'Own a P&L or budget of $18M'), 'Held an $8M engineering budget to plan', 0.8),
    ],
    profileReadable: true, defs,
  })
  for (const r of rows) {
    if (!r.profile) continue
    assert.ok(!/\$18M/.test(r.profile.value), 'the posting\'s own figure appeared in the candidate\'s column')
    assert.ok(!/\b60\+/.test(r.profile.value), 'the posting\'s own figure appeared in the candidate\'s column')
  }
})

// ── AC26/AC27: nothing fabricated ──────────────────────────────────────────────────────────────

test('AC26: a row with no derivable profile side carries null, never zero', () => {
  const [row] = buildComparison({
    requirements: [req(0, 'Deliver FedRAMP authorization for the public sector platform')],
    profileReadable: true, defs: only('public_sector'),
  })
  assert.equal(row.profile, null, 'an absent profile value must be null — not an empty string, not a placeholder')
})

test('AC27: a summary over a population with holes in it is null', () => {
  const rows = buildComparison({
    requirements: [withEvidence(req(0, 'Lead a distributed organization of 60+ engineers'))],
    profileReadable: true, defs,
  })
  const s = summarize(rows)
  assert.ok(s.notApplicable > 0, 'the fixture must contain ungraded dimensions')
  assert.equal(s.ratio, null, 'a composite was computed over a population with ungraded members')
  // AC25 — excluded rows are named, never absorbed.
  assert.equal(s.notApplicableLabels.length, s.notApplicable)
  for (const l of s.notApplicableLabels) assert.ok(l && l.trim())
})

test('AC27: a fully graded population does produce a ratio', () => {
  const rows = [
    { key: 'a', label: 'A', fit: 'strong' }, { key: 'b', label: 'B', fit: 'moderate' },
  ]
  const s = summarize(rows)
  assert.equal(s.graded, 2)
  assert.equal(s.ratio, 0.5)
})

test('AC27: summarize over nothing is null, not zero', () => {
  assert.equal(summarize([]).ratio, null)
  assert.equal(summarize(null).graded, 0)
})

// ── AC52: determinism ──────────────────────────────────────────────────────────────────────────

test('AC52: identical inputs produce identical rows, including order', () => {
  const input = () => ({
    requirements: [
      withEvidence(req(0, 'Lead a distributed organization of 60+ engineers')),
      req(1, 'Own a P&L or budget of $10M+ across three business units'),
      req(2, 'Reduce delivery cycle time across regulated programmes'),
    ],
    profileReadable: true, defs,
    facts: [fact('experience.years_leadership', '14', 14)],
  })
  assert.deepEqual(buildComparison(input()), buildComparison(input()))
  assert.deepEqual(buildComparison(input()).map(r => r.key), defs.map(d => d.key),
    'row order must follow the configured set, so two renders cannot disagree')
})

test('AC7: every row records the version of the rules that produced it', () => {
  const rows = buildComparison({ requirements: [], profileReadable: true, defs })
  for (const r of rows) assert.equal(r.dimension_version, DIMENSION_VERSION)
})

// ── AC20: one threshold for "does the profile support this" ────────────────────────────────────

test('AC20: the judgeability floor is the evidence resolver\'s, not a second constant', () => {
  const short = 'Own the budget'          // 2 content words after stopword removal
  const [row] = buildComparison({
    requirements: [req(0, short)], profileReadable: true, defs: only('budget_owned'),
  })
  assert.equal(row.fit, 'not_applicable')
  // The floor is IMPORTED from evidence.ts. Passing the same number explicitly must not change it.
  const [same] = buildComparison({
    requirements: [req(0, short)], profileReadable: true, defs: only('budget_owned'), minTokens: MIN_JUDGEABLE_TOKENS,
  })
  assert.deepEqual(row, same)
})

// ── AC13: nothing on a row is model prose ──────────────────────────────────────────────────────

test('AC13: every value on a row traces to a stored string or a derived count', () => {
  const [row] = buildComparison({
    requirements: [withEvidence(req(0, 'Own SOC 2 Type II and ISO 27001 through external audit'))],
    profileReadable: true, defs: only('compliance_ownership'),
  })
  // The posting cell is the requirement's own text; the profile cell is the evidence quote.
  assert.equal(row.posting.text, 'Own SOC 2 Type II and ISO 27001 through external audit')
  assert.equal(row.profile.value, 'Led a distributed organization of 62 engineers across three time zones')
})

// Unit tests for the packet-level QC & evidence rail's pure logic (app/src/qcRail.js).
// Node 22's built-in runner, no DOM, no new dependency.
//   cd app && npm test
//
// Every assertion below was written against a specific way this screen can lie: a client-computed
// gate, a null gate read as permission, a recount that disagrees with the server, a reviewer's
// opinion counted as a blocker, a not_applicable folded into a pass, a fabricated composite, a
// clickable count that lands nowhere. Each test names the lie it prevents.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  QC_HOOKS, RAIL_TABS, railGate, railGateMeta, railAttention, railCounts, railTotals,
  severityWeight, bySeverity, notApplicableRows, allRows, railBody, railHeadline, verdictLine,
  railVerdict, sectionIdForOffender, inertReason, offenderLinks, countLink, MERGE_FIELDS,
  coverageCards, requirementState, openSeqs, offenderSeq, qcStepState, qcStepDone, packetGate,
  loopsModel, rowsForRequirement, swapsForRequirement, pctWidth, packetReadiness,
  offendersByField, offendersForField, fieldSeverities,
} from '../src/qcRail.js'

const SRC = new URL('../src/', import.meta.url)
const readSrc = (rel) => readFileSync(new URL(rel, SRC), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx)$/.test(name)) out.push(full)
  }
  return out
}

// ── the gate is the server's ─────────────────────────────────────────────────────────────────────

test('railGate returns the SERVER field verbatim - it never re-derives the verdict', () => {
  // The exact payload from the criteria: a deterministic FAIL row sitting under a gate of 'warn'.
  // A client that reimplemented gateFor() would answer 'fail' here and contradict the server, which
  // is the system that actually refuses the approval.
  const contradictory = { gate: 'warn', results: [{ engine: 'deterministic', state: 'fail', check_key: 'x' }] }
  assert.equal(railGate(contradictory), 'warn')

  for (const g of ['pass', 'warn', 'fail']) assert.equal(railGate({ gate: g, results: [] }), g)
})

test('gate null is "unchecked", never "pass", and never wears a pass colour', () => {
  assert.equal(railGate({ gate: null, attention: 0, results: [] }), 'unchecked')
  assert.equal(railGate({}), 'unchecked')
  assert.equal(railGate(null), 'unchecked')
  assert.notEqual(railGate({ gate: null }), 'pass')

  const unchecked = railGateMeta({ gate: null })
  const pass = railGateMeta({ gate: 'pass' })
  assert.notEqual(unchecked.tone, pass.tone, 'unchecked must be visually distinct from pass')
  assert.notEqual(unchecked.tone, 'green', 'the absence of a verdict must never be green')
  assert.match(unchecked.word, /not checked/i)

  assert.match(railBody({ gate: null }), /not been run/i)
  assert.ok(!/\bclear\b/i.test(railBody({ gate: null })), 'an unchecked asset must not read as clear')
})

test('railAttention is the server count, never a recount of the rows', () => {
  // The criteria's payload: the server says 3, four rows need attention. It must return 3.
  const disagreeing = {
    gate: 'warn', attention: 3,
    results: [
      { engine: 'deterministic', state: 'fail', check_key: 'a' },
      { engine: 'deterministic', state: 'warn', check_key: 'b' },
      { engine: 'reviewer', state: 'fail', check_key: 'c' },
      { engine: 'reviewer', state: 'warn', check_key: 'd' },
    ],
  }
  assert.equal(railAttention(disagreeing), 3)
  assert.notEqual(railAttention(disagreeing), 4, 'a recount would answer 4 and silently overwrite the server')
  assert.equal(railAttention({ gate: 'pass' }), 0)
  assert.equal(railAttention(null), 0)
})

// ── the two counts ───────────────────────────────────────────────────────────────────────────────

test('railCounts returns toFix and toReview as SEPARATE fields, and nothing sums them', () => {
  const r = {
    gate: 'warn', attention: 4,
    engines: {
      deterministic: { results: [
        { engine: 'deterministic', state: 'fail', check_key: 'a' },
        { engine: 'deterministic', state: 'warn', check_key: 'b' },
        { engine: 'deterministic', state: 'pass', check_key: 'c' },
        { engine: 'deterministic', state: 'not_applicable', check_key: 'd' },
      ] },
      reviewer: { results: [
        { engine: 'reviewer', state: 'fail', check_key: 'r1' },
        { engine: 'reviewer', state: 'warn', check_key: 'r2' },
      ] },
    },
  }
  const c = railCounts(r)
  assert.deepEqual(Object.keys(c).sort(), ['toFix', 'toReview'], 'no third blended number may exist')
  assert.equal(c.toFix, 2)
  assert.equal(c.toReview, 2, 'a reviewer FAIL counts here (D6), not in toFix')

  // D6 in isolation: a reviewer fail alone must produce zero to fix.
  const reviewerOnly = { gate: 'warn', attention: 1, engines: { deterministic: { results: [] }, reviewer: { results: [{ engine: 'reviewer', state: 'fail', check_key: 'r' }] } } }
  assert.equal(railCounts(reviewerOnly).toFix, 0, 'a reviewer fail can never block, so it can never be "to fix"')
  assert.equal(railCounts(reviewerOnly).toReview, 1)
})

test('the module never adds the two counts together', () => {
  // Structural, because the rule is about a number that must NOT exist. A blended total is what let
  // the reference prototype render a green gate beside "1 to fix".
  // PRECISE on purpose: it fires on the one construct that is the defect - the two counts added to
  // each other - and not on `c.toFix + ' to fix'`, which is string concatenation and correct. A
  // guard that trips on correct code is one people learn to ignore.
  const src = stripComments(readSrc('qcRail.js'))
  assert.ok(!/toFix\s*\+\s*[\w.]*toReview/.test(src), 'toFix must never be added to toReview')
  assert.ok(!/toReview\s*\+\s*[\w.]*toFix/.test(src), 'toReview must never be added to toFix')
  // And the shape itself carries no third number, on any payload.
  for (const payload of [null, {}, { gate: 'warn', results: [{ engine: 'reviewer', state: 'fail' }] }]) {
    assert.deepEqual(Object.keys(railCounts(payload)).sort(), ['toFix', 'toReview'])
  }
})

test('railTotals sums each field over assets independently, and counts unchecked separately', () => {
  const entries = [
    { result: { gate: 'fail', attention: 1, engines: { deterministic: { results: [{ engine: 'deterministic', state: 'fail', check_key: 'a' }] }, reviewer: { results: [] } } } },
    { result: { gate: 'warn', attention: 1, engines: { deterministic: { results: [] }, reviewer: { results: [{ engine: 'reviewer', state: 'warn', check_key: 'b' }] } } } },
    { result: { gate: null } },
  ]
  const t = railTotals(entries)
  assert.equal(t.toFix, 1)
  assert.equal(t.toReview, 1)
  assert.equal(t.unchecked, 1, 'an unchecked asset is its own number, never folded into "nothing to fix"')
  assert.equal(t.checked, 2)
})

// ── severity ─────────────────────────────────────────────────────────────────────────────────────

test('a reviewer fail weighs LESS than a deterministic fail', () => {
  const detFail = { engine: 'deterministic', state: 'fail' }
  const revFail = { engine: 'reviewer', state: 'fail' }
  assert.ok(severityWeight(revFail) < severityWeight(detFail),
    'ranking an opinion level with a measured blocker puts it at the top of a list of blockers')
  assert.ok(severityWeight(revFail) <= severityWeight({ engine: 'deterministic', state: 'warn' }),
    'a reviewer fail degrades to warn (D6), so it may not outrank a measured warn')
  assert.ok(severityWeight({ state: 'not_applicable' }) > severityWeight({ state: 'pass' }),
    'an unanswered question outranks a settled one')
  assert.equal(severityWeight({ state: 'pass' }), 0)

  const sorted = bySeverity([
    { engine: 'deterministic', state: 'pass', check_key: 'p' },
    { engine: 'reviewer', state: 'fail', check_key: 'rf' },
    { engine: 'deterministic', state: 'fail', check_key: 'df' },
    { engine: 'deterministic', state: 'not_applicable', check_key: 'na' },
  ])
  assert.deepEqual(sorted.map((r) => r.check_key), ['df', 'rf', 'na', 'p'])
})

// ── not_applicable ───────────────────────────────────────────────────────────────────────────────

test('not_applicable is counted in NEITHER number and renders the reason it could not be checked', () => {
  const r = {
    gate: 'warn', attention: 0,
    engines: {
      deterministic: { results: [
        { engine: 'deterministic', state: 'not_applicable', check_key: 'must_have_coverage', observed: 'no requirement rows for this opportunity' },
        { engine: 'deterministic', state: 'pass', check_key: 'whitespace', observed: 'clean' },
      ] },
      reviewer: { results: [] },
    },
  }
  const c = railCounts(r)
  assert.equal(c.toFix, 0)
  assert.equal(c.toReview, 0)
  const na = notApplicableRows(r)
  assert.equal(na.length, 1)
  assert.equal(na[0].reason, 'no requirement rows for this opportunity',
    'the server prose IS the content - without it the row is an unexplained blank')
  assert.match(railBody(r), /not counted in either number/)
  assert.match(railBody(r), /not a pass/)
})

test('all not_applicable: the server says warn, and the body says nothing could be checked', () => {
  const r = {
    gate: 'warn', attention: 0,
    engines: {
      deterministic: { results: [
        { engine: 'deterministic', state: 'not_applicable', check_key: 'a', observed: 'no rows' },
        { engine: 'deterministic', state: 'not_applicable', check_key: 'b', observed: 'no rows' },
      ] },
      reviewer: { results: [] },
    },
  }
  assert.equal(railGate(r), 'warn', 'gateFor() returns warn for an all-not_applicable run; show it')
  const body = railBody(r)
  assert.match(body, /nothing could be checked/i)
  assert.match(body, /no evidence/i)
  assert.ok(!/clean result/.test(body.replace('not a clean result', '')), 'it must not read as clean')
  assert.equal(allRows(r).length, 2)
})

// ── the score ────────────────────────────────────────────────────────────────────────────────────

test('composite null gives NO headline number - the three components carry their stored prose', () => {
  // The live shape today: keyword_coverage and seniority_alignment are both null on every row, so
  // this is the NORMAL case, not an edge case.
  const h = railHeadline({
    composite: null, band: null,
    must_have_coverage: 80, must_have_source: '4/5 must-have requirements covered',
    keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet',
    seniority_alignment: null, seniority_source: 'not graded - the independent reviewer (P4) has not run',
  })
  assert.equal(h.hasNumber, false)
  assert.equal(h.value, null)
  assert.notEqual(h.value, 0, 'null must never become 0')
  assert.ok(!Number.isNaN(h.value), 'null must never become NaN')
  assert.equal(h.parts.length, 3)
  assert.equal(h.missing.length, 2)
  for (const m of h.missing) assert.ok(m.source && m.source.length > 5, 'a missing part must say WHY')
  assert.match(h.why, /only computed when all three parts exist/)
  assert.ok(!/—%|--%|\bNaN\b/.test(h.why))

  const full = railHeadline({ composite: 84, band: 'acceptable', must_have_coverage: 80, must_have_source: 'a', keyword_coverage: 90, keyword_source: 'b', seniority_alignment: 80, seniority_source: 'c' })
  assert.equal(full.hasNumber, true)
  assert.equal(full.value, 84)
  assert.equal(full.missing.length, 0)

  assert.equal(railHeadline(null).hasNumber, false, 'no score row at all is still not a number')
})

test('verdict null says the reviewer has not run - never "0 disagreements"', () => {
  const v = verdictLine(null)
  assert.equal(v.ran, false)
  assert.match(v.text, /has not run/i)
  assert.ok(!/\b0\b/.test(v.text), 'a measurement that was never taken must not be reported as zero')

  const ran = verdictLine({ grade: 'B', agreed: 4, disagreed: 0, citations_kept: 2, citations_received: 3 })
  assert.equal(ran.ran, true)
  assert.match(ran.text, /graded B/)
  assert.match(ran.text, /0 disagreed/, 'a real zero, measured, is reportable')
})

test('the reviewer verdict is read from the server grouping', () => {
  const r = { engines: { reviewer: { verdict: { grade: 'A' } } } }
  assert.equal(railVerdict(r).grade, 'A')
  assert.equal(railVerdict({ engines: { reviewer: { results: [] } } }), null)
  assert.equal(railVerdict(null), null)
})

test('dropped_citations is never read anywhere in app/src', () => {
  // shapeVerdict() keeps refused quotes off the wire on purpose: they did not survive verification
  // against the posting, so rendering them beside real quotes is how a fabricated quote is read as
  // evidence. Reaching for the raw field re-opens the hole.
  // The criterion is a literal grep over app/src, comments included - so this reads the raw bytes.
  const banned = ['dropped', 'citations'].join('_')
  const hits = walk(new URL('../src', import.meta.url).pathname)
    .filter((f) => readFileSync(f, 'utf8').includes(banned))
  assert.deepEqual(hits, [], 'no file under app/src may name the refused-quote column')
})

// ── engine grouping ──────────────────────────────────────────────────────────────────────────────

test('rows are grouped by the SERVER engines object, with a filter only as fallback', () => {
  const grouped = {
    gate: 'warn', attention: 1,
    results: [{ engine: 'deterministic', state: 'warn', check_key: 'ignored-union-row' }],
    engines: {
      deterministic: { results: [{ engine: 'deterministic', state: 'warn', check_key: 'from-server' }] },
      reviewer: { results: [] },
    },
  }
  assert.deepEqual(allRows(grouped).map((r) => r.check_key), ['from-server'],
    'when the server has grouped the rows, the client must not re-partition the flat union')

  const flat = { gate: 'warn', attention: 2, results: [
    { engine: 'deterministic', state: 'warn', check_key: 'a' },
    { engine: 'reviewer', state: 'warn', check_key: 'b' },
  ] }
  assert.equal(allRows(flat).length, 2, 'a pre-P4 flat payload still resolves')
  assert.equal(railCounts(flat).toReview, 1)
})

// ── deep links ───────────────────────────────────────────────────────────────────────────────────

test('a section id is derived from the merge-field name in the offender string', () => {
  // The shapes checks.ts actually writes.
  assert.equal(sectionIdForOffender('relevant_char_limit', 'RelevantBullets1: some long item (24)'), 'RelevantBullets1')
  assert.equal(sectionIdForOffender('whitespace', 'ResumeSummary: double space'), 'ResumeSummary')
  assert.equal(sectionIdForOffender('markup_residue', '@CoverLetterBody: html markup'), '@CoverLetterBody')
  assert.equal(sectionIdForOffender('word_counts', '@AboutMe1_50words: 61 words (want 45-48)'), '@AboutMe1_50words')
  assert.equal(sectionIdForOffender('empty_merge_fields', 'SkillsBullets2'), 'SkillsBullets2')
  assert.equal(sectionIdForOffender('company_in_body', '"Acme" absent from @CoverLetterBody'), '@CoverLetterBody')
  assert.equal(sectionIdForOffender('company_named', 'expected Acme, found Globex'), '@Company',
    'this check names no field in its offender, but its subject is fixed by the rule')

  // Refusals. Each of these would send a reader to a field that is not the problem.
  assert.equal(sectionIdForOffender('cross_list_redundancy', 'agile (SkillsBullets1 + SkillsBullets2)'), null,
    'two fields in one offender resolves to NEITHER - the finding is the relationship between them')
  assert.equal(sectionIdForOffender('cross_list_redundancy', 'SkillsBullets1: agile (also in SkillsBullets2)'), null,
    'even in the `Field: rest` form, a second field named in the same offender makes the target ambiguous - '
    + 'refusing is what stops a reader being sent to the half of the story that is fine')
  assert.equal(sectionIdForOffender('must_have_coverage', '#12 Lead a team of 60+ engineers'), null,
    'a requirement is not a field of the document')
  assert.equal(sectionIdForOffender('skill_char_limit', 'Some very long skill line (34)'), null)
  assert.equal(sectionIdForOffender('whitespace', ''), null)
  assert.equal(sectionIdForOffender('whitespace', null), null)
  assert.equal(sectionIdForOffender('anything', 'NotAMergeField: double space'), null,
    'the match is EXACT against TEMPLATE_META - a lookalike name resolves to nothing')

  assert.equal(MERGE_FIELDS.length, 14, 'resume 7 + cover/portfolio 7 distinct, from TEMPLATE_META')
})

test('an offender that resolves to no section is excluded from the link set and given a reason', () => {
  const row = {
    check_key: 'cross_list_redundancy',
    offenders: ['RelevantBullets1: aaa (24)', 'agile (SkillsBullets1 + SkillsBullets2)', '#4 something'],
  }
  const { linked, inert } = offenderLinks('art-1', row)
  assert.equal(linked.length, 1)
  assert.deepEqual(linked[0], { offender: 'RelevantBullets1: aaa (24)', artifact_id: 'art-1', section_id: 'RelevantBullets1' })
  assert.equal(inert.length, 2)
  for (const i of inert) assert.ok(i.reason && i.reason.length > 5, 'inert must never be mute')
  assert.match(inert[0].reason, /spans two fields/)
  assert.match(inert[1].reason, /posting requirement/)

  // Every linked entry carries BOTH ids. P8.5: a count with only one of them cannot open a field.
  for (const l of linked) {
    assert.ok(l.artifact_id, 'artifact_id is required')
    assert.ok(l.section_id, 'section_id is required')
  }
})

test('a count is clickable only when it lands somewhere', () => {
  const nowhere = countLink('art-1', { check_key: 'skill_char_limit', offenders: ['Some long skill (34)', 'Another (33)'] })
  assert.equal(nowhere.count, 2, 'the count still shows - it is the finding\'s size')
  assert.equal(nowhere.linkable, false)
  assert.equal(nowhere.artifact_id, null)
  assert.equal(nowhere.section_id, null)
  assert.match(nowhere.reason, /names a field/)
  assert.equal(nowhere.inert.length, 2)

  const somewhere = countLink('art-1', { check_key: 'whitespace', offenders: ['ResumeSummary: tab'] })
  assert.equal(somewhere.linkable, true)
  assert.equal(somewhere.artifact_id, 'art-1')
  assert.equal(somewhere.section_id, 'ResumeSummary')

  const noArtifact = countLink(null, { check_key: 'whitespace', offenders: ['ResumeSummary: tab'] })
  assert.equal(noArtifact.linkable, false, 'a section with no artifact is still not a destination')
})

// ── coverage cards ───────────────────────────────────────────────────────────────────────────────

const REQS = [
  { seq: 0, kind: 'must_have', item_text: 'ten years', verbatim: '10+ years' },
  { seq: 1, kind: 'must_have', item_text: 'lead teams', verbatim: 'Lead teams' },
  { seq: 2, kind: 'nice_to_have', item_text: 'mba', verbatim: 'MBA preferred' },
  { seq: 3, kind: 'responsibility', item_text: 'own roadmap', verbatim: 'Own the roadmap' },
]
const entryWith = (rows) => ({ result: { gate: 'warn', attention: rows.length, engines: { deterministic: { results: rows }, reviewer: { results: [] } } } })

test('exactly three coverage cards, keyed by kind, each with its OWN closed/total', () => {
  const cards = coverageCards(REQS, [entryWith([
    { engine: 'deterministic', check_key: 'must_have_coverage', state: 'fail', offenders: ['#1 Lead teams'] },
    { engine: 'deterministic', check_key: 'responsibilities_addressed', state: 'pass', offenders: [] },
  ])])
  assert.equal(cards.length, 3)
  assert.deepEqual(cards.map((c) => c.key), ['must_have', 'nice_to_have', 'responsibility'])

  const mh = cards.find((c) => c.key === 'must_have')
  assert.equal(mh.total, 2, 'the total counts THIS kind only')
  assert.equal(mh.closed, 1)

  const resp = cards.find((c) => c.key === 'responsibility')
  assert.equal(resp.total, 1)
  assert.equal(resp.closed, 1)

  // Nothing sums across kinds: no card's total equals the whole requirement set.
  for (const c of cards) assert.notEqual(c.total, REQS.length, 'a card must never count another kind\'s rows')
  assert.equal(cards.reduce((a, c) => a + c.total, 0), REQS.length, 'together they partition the set')
})

test('nice-to-have is UNMEASURED, not zero and not complete', () => {
  const card = coverageCards(REQS, [entryWith([{ engine: 'deterministic', check_key: 'must_have_coverage', state: 'pass', offenders: [] }])])
    .find((c) => c.key === 'nice_to_have')
  assert.equal(card.total, 1)
  assert.equal(card.closed, null, 'no check measures this class, so a number would be an invention')
  assert.notEqual(card.closed, 0)
  assert.match(card.source, /no check measures nice-to-have/)
})

test('a kind with zero rows still returns a card labelled "none extracted"', () => {
  const cards = coverageCards([{ seq: 0, kind: 'must_have', item_text: 'x' }], [])
  assert.equal(cards.length, 3)
  const nth = cards.find((c) => c.key === 'nice_to_have')
  assert.equal(nth.empty, true)
  assert.equal(nth.total, 0)
  assert.equal(nth.note, 'none extracted',
    'dropping the card would make the screen look complete when a whole class was never extracted')
  assert.equal(cards.find((c) => c.key === 'responsibility').empty, true)
})

test('a not_applicable coverage check leaves closed NULL - it never reads as covered', () => {
  const cards = coverageCards(REQS, [entryWith([
    { engine: 'deterministic', check_key: 'must_have_coverage', state: 'not_applicable', offenders: [], observed: 'no requirement rows for this opportunity' },
  ])])
  const mh = cards.find((c) => c.key === 'must_have')
  assert.equal(mh.closed, null, 'an empty offender list on a not_applicable row means NOTHING was measured')
  assert.notEqual(mh.closed, mh.total, 'treating it as measured would mark every requirement covered')
  assert.match(mh.source, /no requirement rows/)

  // And with no assets checked at all.
  const none = coverageCards(REQS, []).find((c) => c.key === 'must_have')
  assert.equal(none.closed, null)
  assert.match(none.source, /not zero/)
})

test('a requirement closed by ANY asset in the packet is closed', () => {
  const resume = entryWith([{ engine: 'deterministic', check_key: 'must_have_coverage', state: 'fail', offenders: ['#0 10+ years', '#1 Lead teams'] }])
  const cover = entryWith([{ engine: 'deterministic', check_key: 'must_have_coverage', state: 'fail', offenders: ['#1 Lead teams'] }])
  const { open, measured } = openSeqs([resume, cover], 'must_have_coverage')
  assert.equal(measured, 2)
  assert.deepEqual(open, [1], '#0 is covered by the cover letter, so it is not open for the packet')

  const card = coverageCards(REQS, [resume, cover]).find((c) => c.key === 'must_have')
  assert.equal(card.closed, 1)
  assert.equal(requirementState(card, { seq: 1 }).state, 'open')
  assert.equal(requirementState(card, { seq: 0 }).state, 'closed')
  assert.equal(requirementState({ closed: null }, { seq: 0 }).state, 'unmeasured')
  assert.equal(offenderSeq('#12 something'), 12)
  assert.equal(offenderSeq('SkillsBullets1: x'), null)
})

test('filtering by a requirement reads the SAME offender parse the coverage cards use', () => {
  const result = { gate: 'warn', attention: 2, engines: { deterministic: { results: [
    { engine: 'deterministic', check_key: 'must_have_coverage', state: 'fail', offenders: ['#3 Lead teams', '#7 Ship things'] },
    { engine: 'deterministic', check_key: 'whitespace', state: 'warn', offenders: ['ResumeSummary: tab'] },
  ] }, reviewer: { results: [] } } }
  assert.deepEqual(rowsForRequirement(result, 3).map((r) => r.check_key), ['must_have_coverage'])
  assert.deepEqual(rowsForRequirement(result, 9).map((r) => r.check_key), [])
  assert.equal(rowsForRequirement(result, null).length, 2, 'no filter means every row')
  // A prefix parse that is not offenderSeq would match #3 inside #30.
  const wide = { gate: 'warn', engines: { deterministic: { results: [
    { engine: 'deterministic', check_key: 'must_have_coverage', state: 'fail', offenders: ['#30 something'] },
  ] }, reviewer: { results: [] } } }
  assert.deepEqual(rowsForRequirement(wide, 3).map((r) => r.check_key), [], '#3 must not match #30')

  const swaps = { swaps: [{ id: 'a', requirement_id: 'r1' }, { id: 'b', requirement_id: null }] }
  assert.deepEqual(swapsForRequirement(swaps, 'r1').map((s) => s.id), ['a'])
  assert.deepEqual(swapsForRequirement(swaps, null).map((s) => s.id), ['a', 'b'])
  assert.deepEqual(swapsForRequirement(null, 'r1'), [])
})

test('a bar width is clamped and never NaN', () => {
  assert.equal(pctWidth(50), '50%')
  assert.equal(pctWidth(-4), '0%')
  assert.equal(pctWidth(140), '100%')
  assert.equal(pctWidth(null), '0%')
  assert.equal(pctWidth(undefined), '0%')
  assert.ok(!pctWidth('nope').includes('NaN'))
})

// ── step completion ──────────────────────────────────────────────────────────────────────────────

test('the QC step is GATE-driven: any failing asset keeps it incomplete', () => {
  const pass = { result: { gate: 'pass', attention: 0 } }
  const fail = { result: { gate: 'fail', attention: 2 } }
  assert.equal(qcStepDone([pass, fail]), false)
  assert.match(qcStepState([pass, fail]).reason, /blocking findings/)
  assert.equal(qcStepDone([pass, pass]), true)
})

test('an approved artifact with no check rows does NOT complete the QC step', () => {
  // Every historical approved artifact in this database has ZERO check rows. PacketBuilder marks the
  // ASSET steps done from status === 'approved'; copying that rule here would tick QC for packets
  // nothing has ever checked.
  const approvedButUnchecked = { artifact: { status: 'approved' }, result: { gate: null, attention: 0 } }
  assert.equal(qcStepDone([approvedButUnchecked]), false)
  assert.match(qcStepState([approvedButUnchecked]).reason, /never been checked/)
  assert.equal(qcStepDone([]), false, 'a packet with no assets is not a completed QC step')
})

test('a warn needs a recorded override before the step completes', () => {
  const warn = { result: { gate: 'warn', attention: 1 } }
  assert.equal(qcStepDone([warn]), false)
  assert.match(qcStepState([warn]).reason, /explicit decision/)
  const overridden = { result: { gate: 'warn', attention: 1, override: { by: 'x@y.z', reason: 'accepted, tiny' } } }
  assert.equal(qcStepDone([overridden]), true, 'this mirrors approvalBlock() server-side')
})

test('the packet gate is the worst state any asset is in, and unchecked outranks warn', () => {
  assert.equal(packetGate([{ result: { gate: 'pass' } }, { result: { gate: 'warn' } }]), 'warn')
  assert.equal(packetGate([{ result: { gate: 'fail' } }, { result: { gate: 'pass' } }]), 'fail')
  assert.equal(packetGate([{ result: { gate: 'warn' } }, { result: { gate: null } }]), 'unchecked',
    'an unmeasured asset is a bigger hole than a measured warning')
  assert.equal(packetGate([]), 'unchecked')
  assert.equal(packetGate([{ result: { gate: 'pass' } }]), 'pass')
})

// ── remediation loops ────────────────────────────────────────────────────────────────────────────

test('the remediation tab falls back to insertion.loop, and NEVER claims P3 does not exist', () => {
  // THE ASSERTION THIS REPLACES WAS `assert.match(m.note, /not built/)`, and it is why the stale
  // claim survived: the note said "there is no remediation_loop table and no escalation table in the
  // API", both tables had shipped, and a test was holding that sentence in place. A test that pins a
  // PREMISE rather than a behaviour keeps the premise alive after it stops being true.
  //
  // The behaviour worth pinning is the fallback being LABELLED. "No pass has run" and "we did not
  // load the ledger" are different facts and only one is about the packet.
  const m = loopsModel([
    { artifact: { id: 'a1' }, label: 'Resume', insertions: { insertions: [{ loop: 0, merge_field: 'ResumeSummary' }] } },
    { artifact: { id: 'a2' }, label: 'Cover letter', insertions: { insertions: [] } },
  ])
  assert.equal(m.assets.length, 2)
  assert.equal(m.assets[0].passes, 1)
  assert.equal(m.assets[0].remediation, 0, 'loop 0 is the first generation, not a remediation pass')
  assert.equal(m.empty, true)
  assert.equal(m.source, 'insertions', 'the fallback must say it is the fallback')
  assert.match(m.note, /insertion\.loop/, 'and name the record it is actually reading')
  assert.match(m.note, /not the same as saying\s+no remediation has run/, 'it must not be read as a measurement of remediation')
  assert.ok(!/not built|does not exist|no remediation_loop table/i.test(m.note),
    'the tables shipped — the note must never tell the owner the controller does not exist')

  const withLoop = loopsModel([{ artifact: { id: 'a1' }, insertions: { insertions: [
    { loop: 0, before_text: null, after_text: 'x' }, { loop: 1, before_text: 'x', after_text: 'y' },
  ] } }])
  assert.equal(withLoop.assets[0].remediation, 1)
  assert.equal(withLoop.assets[0].rewritten, 1)
  assert.equal(withLoop.empty, false)
})

test('the remediation tab reads the REAL ledger when it has been fetched', () => {
  // D:remediation-never-ran. Four routes were deployed and app/src/api.js called none of them, so P3
  // had executed zero times in production and the tab reported on `insertion.loop` instead. This is
  // the shape the real ledger arrives in.
  const m = loopsModel([{
    artifact: { id: 'a1' }, label: 'Resume',
    remediation: {
      outcome: { converged: false, note: 'halted at pass 2' },
      passes: [
        { n: 1, halted: false, closed: ['#3', '#7'], remaining: ['#5'], close_state: 'partial' },
        { n: 2, halted: true, halt_reason: 'no_progress', closed: [], remaining: ['#5'], close_state: 'open' },
      ],
      escalations: [
        { id: 'e1', state: 'open', requirement_seq: 5 },
        { id: 'e2', state: 'resolved', requirement_seq: 3 },
      ],
    },
  }])
  const a = m.assets[0]
  assert.equal(a.source, 'ledger')
  assert.equal(m.source, 'ledger')
  // Every ledger row IS a second look — `n` counts from 1 — which is the difference from the
  // fallback, where loop 0 is the first generation and does not count.
  assert.equal(a.remediation, 2, 'both passes are remediation; there is no loop 0 in this ledger')
  assert.equal(a.rewritten, 2, 'two requirements were closed across the passes')
  assert.equal(a.halted, true)
  assert.equal(a.haltReason, 'no_progress')
  assert.equal(a.open, 1, 'only the unresolved escalation is open')
  assert.equal(m.openEscalations, 1)
  assert.equal(m.empty, false)
  assert.match(m.note, /escalated to you/, 'the ledger note must explain what happens to what it cannot close')
  assert.ok(!/insertion\.loop/.test(m.note), 'the ledger note must not describe the fallback')
})

test('a MIXED packet reports the weaker source, never the more confident one', () => {
  // One asset with a ledger and one without is not a ledger total. Reporting it as one would be the
  // more confident of two readings, which is the failure this repo names as absent evidence read as
  // a measurement.
  const m = loopsModel([
    { artifact: { id: 'a1' }, remediation: { passes: [{ n: 1, closed: [], remaining: [] }], escalations: [] } },
    { artifact: { id: 'a2' }, insertions: { insertions: [{ loop: 0 }] } },
  ])
  assert.equal(m.source, 'insertions', 'any fallback makes the total a fallback total')
  assert.match(m.note, /insertion\.loop/)
})

test('H:remediation-has-a-caller: the deployed routes are reachable from the product', () => {
  // D:remediation-never-ran, and the invariant is CALLER-SIDE because that is where the gap was.
  // Four routes shipped and ran zero times in production for one reason: `app/src/api.js` referenced
  // none of them. Nothing was broken — nothing was connected — and an unconnected subsystem reads
  // exactly like one with no data yet. This is the third time that shape has appeared in this repo
  // (D:build-runs-no-qc, D24, this), so it is asserted rather than remembered.
  const apiSrc = stripComments(readSrc('api.js'))
  for (const [fn, route] of [
    ['artifactRemediationGet', '/remediation'],
    ['artifactRemediate', '/remediate'],
    ['escalationResolve', '/app/escalation/'],
  ]) {
    // A PROPERTY DEFINITION, not a substring. `includes(fn)` passed when the mutation test renamed
    // the export to `_removed_artifactRemediationGet` — the old name was still IN the file, as part
    // of the new one, so the guard reported a caller that no longer existed. Found by reverting it;
    // it would never have been found by reading.
    assert.match(apiSrc, new RegExp(`(^|[^A-Za-z0-9_])${fn}\\s*:`, 'm'),
      `api.js defines no ${fn} — the route is deployed and unreachable`)
    assert.ok(apiSrc.includes(route), `api.js never names ${route}`)
  }
  // And a screen must actually CALL it: an api.js entry nothing invokes is the same gap one level up.
  const rail = stripComments(readSrc('screens/QcRail.jsx'))
  assert.match(rail, /api\.artifactRemediationGet\(/, 'the ledger is never fetched by any screen')
  assert.match(rail, /withRemediation/, 'the fetch is not gated to the tab that needs it')
  const builder = stripComments(readSrc('screens/PacketBuilder.jsx'))
  assert.match(builder, /withRemediation:/, 'nothing ever turns the remediation fetch on')
})

test('H:no-stale-not-built-claim: no screen tells the owner a shipped subsystem does not exist', () => {
  // The claim that outlived its premise. `qcRail.js` asserted "there is no remediation_loop table and
  // no escalation table in the API" long after both shipped — and a TEST was pinning that sentence in
  // place, which is how it survived review. A comment can go stale quietly; a comment a test defends
  // goes stale loudly and stays.
  // COMMENTS ARE STRIPPED FIRST, and that precision is not optional. The first version of this case
  // fired on the comment that RECORDS the stale claim in order to explain why it was wrong — the
  // same false positive this repo already deleted a linter over (`termMatch.ts:21`, the smart-quote
  // normalizer flagged for containing the characters it strips). A guard that fires on the history
  // of a defect is one people switch off. What must not survive is the claim in text the OWNER READS.
  for (const f of ['qcRail.js', 'screens/QcRail.jsx']) {
    const src = stripComments(readSrc(f))
    assert.ok(!/P3 IS NOT BUILT/i.test(src), `${f} still claims P3 is not built`)
    assert.ok(!/there is no .{0,4}remediation_loop/i.test(src), `${f} still claims the table is absent`)
    assert.ok(!/loop controller .{0,20}(is not built|does not exist)/i.test(src),
      `${f} still tells the owner the controller does not exist`)
  }
})

test('no fixture data backs the remediation tab', () => {
  const src = stripComments(readSrc('screens/QcRail.jsx'))
  assert.ok(!/FIXTURE|SAMPLE_LOOPS|const\s+LOOPS\s*=/.test(src), 'the loops tab must read a real query, never a literal')
  assert.ok(/loopsModel\(/.test(src), 'it must go through the model function')
})

// ── the .jsx computes nothing ────────────────────────────────────────────────────────────────────

test('QcRail.jsx renders values and computes NO gate, NO severity, NO count', () => {
  // This is the structural rule the whole file split exists for: a count bug shipped from a .jsx
  // that did its own arithmetic.
  const src = stripComments(readSrc('screens/QcRail.jsx'))
  assert.ok(!/\.filter\([^)]*\)\.length\s*\+\s*/.test(src), 'no count may be assembled by adding two filters')
  assert.ok(!/state\s*===\s*['"]fail['"]\s*\|\|[^\n]*state\s*===\s*['"]warn['"]/.test(src),
    'deciding what "needs attention" is the module\'s job, not the component\'s')
  assert.ok(!/\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.engine/.test(src),
    'the component must not partition rows by engine - engineRows() reads the server grouping')
  assert.ok(!/gateFor|attentionCount/.test(src), 'no reimplementation of the server aggregation')
  for (const fn of ['railGate(', 'railCounts(', 'railBody(', 'coverageCards(', 'countLink(']) {
    assert.ok(src.includes(fn), `it must actually call ${fn}`)
  }
  // P8.6 closed a MEASURED hole in the four regexes above. `arr(result.corrections).length` - a
  // component counting the change log itself - matches none of them: the first needs a trailing `+`,
  // the second is about states, the third about engines, the fourth about two function names. The
  // corrections number is the cheapest count yet to compute inline, because unlike every other
  // number on this screen it is a plain array length with no filtering to make it feel expensive.
  // Any payload list read straight off `result` in this component is the same class of defect.
  assert.ok(!/\bresult\.corrections\b|\.result\.corrections\b/.test(src),
    'the component must reach the change log through the module, never read result.corrections itself')
  assert.ok(!/arr\(\s*\w+\.result\.\w+\s*\)\.length/.test(src),
    'a count taken off the raw payload in the component is the bug this whole split exists to prevent')
})

test('every QC_HOOKS selector is rendered, and the component hand-types none of them', () => {
  const src = readSrc('screens/QcRail.jsx')
  for (const [name, value] of Object.entries(QC_HOOKS)) {
    assert.ok(src.includes('QC_HOOKS.' + name), `QC_HOOKS.${name} ("${value}") is declared but never rendered`)
  }
  const stripped = stripComments(src)
  for (const value of Object.values(QC_HOOKS)) {
    assert.ok(!new RegExp(`data-qc=["']${value}["']`).test(stripped),
      `data-qc="${value}" is hand-typed - it must come from QC_HOOKS so the verifier's selector cannot drift`)
  }
  // The hook values must be unique, or a verifier selector matches two different surfaces.
  const values = Object.values(QC_HOOKS)
  assert.equal(new Set(values).size, values.length)
})

test('the rail uses the shared tab classes and the Overlay primitive, with no raw hex', () => {
  const src = stripComments(readSrc('screens/QcRail.jsx'))
  assert.ok(/px-tab-active/.test(src) && /px-tab-idle/.test(src), 'the existing tab classes, not a new one')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), 'no raw hex - every colour is a token')
  assert.ok(!/var\(--[^)]*\$\{/.test(src),
    'an interpolated custom-property name is the bug that made todo pills invisible; use toneFill/toneColor')
  assert.deepEqual(RAIL_TABS.map((t) => t.label),
    ['Coverage', 'Original vs final', 'Remediation loops', 'Checks', 'Independent review'])
})

test('every owner-scoped GET the rail uses appends ?owner=', () => {
  // resolveOwner() falls back to the DEMO owner when no ?owner= is present, so an omitted parameter
  // silently 404s the real owner's rows. This bit listPersonas.
  const api = readSrc('api.js')
  for (const helper of ['artifactChecksResult', 'artifactInsertions', 'packetSwaps', 'requirements']) {
    const lines = api.split('\n').filter((l) => l.trim().startsWith(helper + ':'))
    assert.ok(lines.length, `${helper} not found in api.js`)
    for (const l of lines) assert.match(l, /\?owner=|&owner=/, `${helper} must carry ?owner=`)
  }
  const src = stripComments(readSrc('screens/QcRail.jsx'))
  assert.ok(!/fetch\(/.test(src), 'the rail must go through api.js, which is where the owner rule lives')
})

// ── P8.3 / C6: the rail counts the population the engine judged ────────────────────────────────

test('a requirement nothing measured is never CLOSED on the rail (the 75% again)', () => {
  // The live Trinnex shape. `must_have_coverage` judges one row and fails it; `template_reach`
  // reports three as unreachable in the same run. Counting `total - |offenders|` over every
  // must_have row credits those three as closed and prints "3 of 4" — 75%, the same number, from
  // the same three rows, that H28 removed from the server. Applying that fix only on the server
  // left it on this screen.
  const reqs = [
    { seq: 0, kind: 'must_have', item_text: 'Reside in the East Coast of the United States' },
    { seq: 1, kind: 'must_have', item_text: 'must be a U.S. Citizen or Green Card Holder' },
    { seq: 2, kind: 'must_have', item_text: 'Active Secret security clearance required' },
    { seq: 3, kind: 'must_have', item_text: 'Deep experience with roadmap strategy and execution' },
  ]
  const entry = entryWith([
    { engine: 'deterministic', check_key: 'must_have_coverage', state: 'fail',
      observed: '0/1 must-haves evidenced (3 not reachable by any generated field, not counted either way)',
      offenders: ['#3 Deep experience with roadmap strategy and execution — no evidence found in your profile'] },
    { engine: 'deterministic', check_key: 'template_reach', state: 'not_applicable',
      observed: '3 requirement(s) no generated merge field can carry',
      offenders: ['#0 Reside in the East Coast of the United States',
                  '#1 must be a U.S. Citizen or Green Card Holder',
                  '#2 Active Secret security clearance required'] },
  ])
  const card = coverageCards(reqs, [entry]).find((c) => c.key === 'must_have')

  assert.equal(card.closed, 0, 'nothing is closed here')
  assert.equal(card.total, 1, 'the denominator is the judged population, as the check prints it')
  assert.equal(card.classTotal, 4, 'and the class size is still visible')
  assert.notEqual(card.closed + '/' + card.total, '3/4', 'the incident number must not be reachable')

  for (const seq of [0, 1, 2]) {
    assert.equal(requirementState(card, { seq }).state, 'unmeasured',
      `#${seq} was excluded from the coverage question — green "closed" claims something nobody checked`)
  }
  assert.equal(requirementState(card, { seq: 3 }).state, 'open')
})

test('a fact-owned requirement is not counted closed by the rail either', () => {
  const reqs = [
    { seq: 0, kind: 'must_have', item_text: 'Minimum of 30 years of experience' },
    { seq: 1, kind: 'must_have', item_text: 'Deep experience with roadmap strategy and execution' },
  ]
  const entry = entryWith([
    { engine: 'deterministic', check_key: 'must_have_coverage', state: 'pass', observed: '1/1 must-haves evidenced', offenders: [] },
    { engine: 'deterministic', check_key: 'fact_shortfall', state: 'warn', observed: '1 requirement(s) your profile does not meet',
      offenders: ['#0 Minimum of 30 years of experience — 24 years recorded, 30 required'] },
  ])
  const card = coverageCards(reqs, [entry]).find((c) => c.key === 'must_have')
  assert.equal(card.total, 1)
  assert.equal(card.closed, 1)
  assert.equal(requirementState(card, { seq: 0 }).state, 'unmeasured',
    'a shortfall is a fit problem the coverage check never judged — it is not closed')
})

// ── the packet header states the gate in WORDS, and reports a contradiction ──────────────────────
//
// Until this landed, the computed packet gate reached the screen ONLY as
// `railGateMeta({gate: packetGate(qcEntries)}).tone` on the QC step circle
// (PacketBuilder.jsx). A colour, on one step of seven. Two facts meet in that header and nothing
// compared them: `p.status` is STORED, `packetGate()` is COMPUTED from the checks on screen.

test('H:packet-gate-has-words: the packet gate is never colour-only', () => {
  const r = packetReadiness('drafting', [{ result: { gate: 'fail', attention: 2 } }])
  assert.equal(r.gate, 'fail')
  assert.equal(r.word, 'Blocked', 'the WORD is what a reader who cannot see the tone relies on')
  assert.ok(r.word && r.word.trim().length > 0)
  assert.ok(r.tone, 'the tone is still carried - words IN ADDITION to colour, not instead of it')
  // SPEC 7: the engine's own vocabulary is banned as a user-facing label.
  for (const raw of ['fail', 'warn', 'pass', 'unchecked']) {
    assert.notEqual(r.word.toLowerCase(), raw, 'the raw engine token must never be the label')
  }
  // An unchecked packet says so; absence of a verdict is not permission.
  assert.equal(packetReadiness('drafting', []).word, 'Not checked')

  // And the screen must actually RENDER it, not merely be able to.
  const pb = readSrc('screens/PacketBuilder.jsx').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(pb, /data-qc="packet-gate"[\s\S]{0,80}\{readiness\.word\}/,
    'the header does not render the gate word')
})

test('H:stored-ready-vs-computed-gate: a claim the checks contradict is REPORTED', () => {
  // 'ready' is a stored string; the gate is computed. Neither derives from the other.
  const lying = packetReadiness('ready', [{ result: { gate: 'fail', attention: 1 } }])
  assert.ok(lying.contradiction, 'status ready beside a failing gate must never render silently')
  assert.match(lying.contradiction, /marked ready to ship/)
  assert.match(lying.contradiction, /blocked/i)

  const sentButBroken = packetReadiness('sent', [{ result: { gate: null } }])
  assert.ok(sentButBroken.contradiction, 'a sent packet whose checks never ran is also a contradiction')

  // NOT contradictions - these are the states that legitimately coexist, and a guard that fired on
  // them would be the cry-wolf failure hardening rule 2 forbids.
  assert.equal(packetReadiness('ready', [{ result: { gate: 'warn', attention: 1 } }]).contradiction, null,
    'a warn packet reaches ready legitimately, by an approval with a recorded reason')
  assert.equal(packetReadiness('ready', [{ result: { gate: 'pass', attention: 0 } }]).contradiction, null)
  assert.equal(packetReadiness('drafting', [{ result: { gate: 'fail', attention: 3 } }]).contradiction, null,
    'a failing gate on a packet that claims nothing is just a failing gate')

  const pb = readSrc('screens/PacketBuilder.jsx').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(pb, /readiness\.contradiction && \(/, 'the contradiction is computed but never rendered')
})

// ── the field margin: "Wording kept from the posting" ────────────────────────────────────────────
//
// checks.ts:425-434 emits `posting_wording_kept` with offenders shaped `Field: "phrase"`. The
// prototype (docs/qc-evidence/qc/assets.jsx:124) renders them in the FIELD'S margin, not on the QC
// tab, because keeping a phrase is a judgement the writer makes beside their own sentence.

const WORDING_RESULT = (offenders) => ({
  gate: 'warn',
  attention: 1,
  results: [{
    check_key: 'posting_wording_kept',
    state: 'warn',
    engine: 'deterministic',
    expected: "no generated field repeats a run of the posting's wording",
    offenders,
  }],
})

test('H:wording-phrase-survives-whole: the phrase reaches the margin exactly as the check found it', () => {
  // WHAT THIS PROVES, and the history of the claim - corrected after an independent verifier
  // applied the mutation and got the opposite result from the one written here (C-4).
  //
  // On the FIELD-PREFIXED offenders checks.ts emits, `slice(indexOf(':') + 1)` and the by-name
  // strip are behaviourally equivalent: the prefix colon IS the first colon, because a merge-field
  // name contains none. That much was and is true, and it is why the first draft of this comment
  // said the test does not fail on that mutation.
  //
  // It stopped being true in the same commit. The `company_in_body` case below - an offender with
  // NO field prefix, where the colon form cuts into a string that has nothing to cut - was added
  // precisely to discriminate, and it does: the mutation now FAILS here. The comment was left
  // describing the test as it stood one edit earlier. Stale by two minutes, wrong by the time
  // anyone read it, and it would have taught the next reader that this guard is weaker than it is.
  const g = offendersByField(WORDING_RESULT([
    'ResumeSummary: "Note: we ship weekly"',
    'SkillsBullets1: "safety-critical systems"',
  ]), 'posting_wording_kept')

  assert.deepEqual(g.byField.ResumeSummary, ['Note: we ship weekly'],
    'the phrase did not survive the prefix strip intact')
  // The by-name strip is the code that runs, and an offender with NO prefix must be left whole
  // rather than cut at whatever colon it happens to contain. This half DOES discriminate.
  const noPrefix = offendersByField({
    gate: 'warn', attention: 1,
    results: [{ check_key: 'company_in_body', state: 'warn', engine: 'deterministic', expected: '',
      offenders: ['absent from @CoverLetterBody: checked the whole body'] }],
  }, 'company_in_body')
  assert.deepEqual(noPrefix.byField['@CoverLetterBody'], ['absent from @CoverLetterBody: checked the whole body'],
    'an offender that does not start with `Field:` must not be cut at a colon inside it')
  assert.deepEqual(g.byField.SkillsBullets1, ['safety-critical systems'])
  // The wrapping quotes checks.ts adds are not part of the phrase.
  assert.ok(!g.byField.ResumeSummary[0].includes('"'))
  // The rule that listed them travels with them, so the margin never retypes it.
  assert.match(g.expected, /repeats a run of the posting/)
})

test('H:wording-absent-row-is-not-an-empty-one: null and [] mean different things', () => {
  // A payload with no `posting_wording_kept` row (the check never ran) must not look like a row
  // with no offenders (it ran and found nothing). The first is unknown; the second is a pass.
  assert.equal(offendersByField({ gate: 'pass', attention: 0, results: [] }, 'posting_wording_kept'), null)

  const clean = offendersByField(WORDING_RESULT([]), 'posting_wording_kept')
  assert.notEqual(clean, null)
  assert.deepEqual(clean.byField, {})

  // An offender that names no merge field is DROPPED from every field rather than attached to one -
  // the same refusal `offenderLinks` makes. A reader sent to a field the phrase is not in would be
  // asked to judge a sentence that does not contain it.
  const vague = offendersByField(WORDING_RESULT(['"quarterly business review"']), 'posting_wording_kept')
  assert.deepEqual(vague.byField, {})

  assert.deepEqual(offendersForField(null, 'ResumeSummary'), [])
  assert.deepEqual(offendersForField(clean, 'ResumeSummary'), [])
})

test('H:wording-kept-is-rendered-in-the-margin: the selector is wired, not merely exported', () => {
  const src = stripComments(readSrc('screens/AssetBlocks.jsx'))
  // ANCHORED ON THE WHOLE PROP, not on the call appearing somewhere in it. As a bare substring this
  // was inert: the independent verifier's M12 kept the call and wrapped it in a condition that is
  // never true —
  //
  //     wording={r.merge_field === '__never__' ? offendersForField(wording, r.merge_field) : []}
  //
  // — so the suite stayed at 240/240 while the browser rendered ZERO wording blocks. The entire
  // feature vanished from the page with every guard green. Same shape as the `revisionNotes` miss
  // already recorded in api/test/hardening.test.mjs: assert at the call site, not as a bare word.
  assert.match(src, /wording=\{offendersForField\(wording, r\.merge_field\)\}/,
    'the field margin must receive exactly the offenders for that field - an unconditional pass-through')
  assert.match(src, /data-qc=\{BLOCK_HOOKS\.fieldWordingKept\}/,
    'the margin block is not rendered')
  // REACHABILITY, not just presence. The hook assertion above passes on `{false && wording.length
  // > 0 && (` - markup that exists and can never render, which is the "computed but never shown"
  // failure this file already guards for the packet gate. The condition is pinned to the prop.
  assert.match(src, /\{wording\.length > 0 && \(/,
    'the kept list is gated on something other than the phrases it was given')
  assert.match(src, /checkLabel\('posting_wording_kept'\)/,
    'the heading must come from CHECK_LABEL, not a second literal in the .jsx')

  // `kept` is a plain status word and must NOT be one of the gate words: this check is a warn that
  // can never block, and borrowing "Needs a decision" would rank a phrase the writer may want to
  // keep alongside a blocker.
  assert.match(src, />kept</, 'the per-phrase status word is missing')
  const marginBlock = src.slice(src.indexOf('BLOCK_HOOKS.fieldWordingKept'), src.indexOf('Posting line answered'))
  for (const gateWord of ['Blocked', 'Needs a decision', 'Fix before approval']) {
    assert.ok(!marginBlock.includes(gateWord), `the kept list must not use the gate word "${gateWord}"`)
  }
})

test('H:wording-ask-reuses-the-field-edit-path: no second route for a reword', () => {
  const src = stripComments(readSrc('screens/AssetBlocks.jsx'))
  // The reword control opens the field's OWN ask box. There is exactly one call to the edit route
  // in this screen; a second would be a parallel edit path, which the ask box already covers.
  assert.equal((src.match(/api\.aiEditArtifact\(/g) || []).length, 1,
    'a second edit path was added instead of reusing the field ask box')
  assert.match(src, /seedAskReword/, 'the reword control is not wired to the ask box')
  // Keyboard-reachable, like every other span-as-control on this screen.
  const at = src.indexOf('BLOCK_HOOKS.wordingAsk')
  assert.ok(at > 0, 'the reword control has no test hook')
  const askLink = src.slice(at - 200, at + 400)
  assert.match(askLink, /role="button"/)
  assert.match(askLink, /tabIndex=\{0\}/)
  assert.match(askLink, /onKeyDown=/)
})

test('H:field-severity-only-where-a-finding-names-the-field', () => {
  // A check that failed for the artifact as a whole and names no merge field must colour NOTHING.
  // Painting every field for it teaches a reader to ignore colour, which is the cry-wolf failure.
  const result = { gate: 'fail', attention: 3, results: [
    { check_key: 'skill_char_limit', state: 'fail', engine: 'deterministic',
      offenders: ['SkillsBullets1: some very long skill label (31)'] },
    { check_key: 'word_counts', state: 'fail', engine: 'deterministic',
      offenders: ['ResumeSummary: 70 words (want 55-60)'] },
    { check_key: 'posting_wording_kept', state: 'warn', engine: 'deterministic',
      offenders: ['ResumeSummary: "safety-critical"'] },
    { check_key: 'ai_tells', state: 'fail', engine: 'deterministic', offenders: ['em-dash x3'] },
  ] }
  const sev = fieldSeverities(result)
  assert.equal(sev.SkillsBullets1, 'fix')
  assert.equal(sev.ResumeSummary, 'fix', 'the WORST severity wins - fail outranks the warn')
  assert.equal(Object.keys(sev).length, 2, 'ai_tells names no field and must colour none')

  // AND THE DISCRIMINATING CASE. The assertion above is satisfied even by a bug that attaches a
  // fieldless finding to some default field, WHENEVER that field is already coloured for another
  // reason - which it was here, so the check was inert. A payload whose ONLY finding names no field
  // must colour NOTHING, and that cannot pass by coincidence.
  assert.deepEqual(fieldSeverities({ gate: 'fail', attention: 1, results: [
    { check_key: 'ai_tells', state: 'fail', engine: 'deterministic', offenders: ['em-dash x3'] },
  ] }), {}, 'a finding that names no merge field must colour no field at all')
})

test('H:field-severity-respects-D6: a reviewer fail is never "fix"', () => {
  // D6: only a deterministic row may fail an artifact. A reviewer fail is 'soft' ("Your call"), and
  // a field painted red for one would tell the reader they are blocked by something that cannot
  // block them - the same misstatement severityFor was written to end.
  const sev = fieldSeverities({ gate: 'warn', attention: 1, results: [
    { check_key: 'reviewer_summary', state: 'fail', engine: 'reviewer',
      offenders: ['ResumeSummary: reads as boilerplate'] },
  ] })
  assert.equal(sev.ResumeSummary, 'soft')

  // pass / not_applicable carry no severity and colour nothing.
  assert.deepEqual(fieldSeverities({ gate: 'pass', attention: 0, results: [
    { check_key: 'whitespace', state: 'pass', engine: 'deterministic', offenders: ['ResumeSummary: x'] },
    { check_key: 'facts_needed', state: 'not_applicable', engine: 'deterministic', offenders: ['ResumeSummary: y'] },
  ] }), {})
})

test('H:field-severity-paints-through-one-map: no runtime custom-property names', () => {
  const src = stripComments(readSrc('screens/AssetBlocks.jsx'))
  assert.match(src, /SEV_COLOR\[fieldSev\]/, 'the measurement must paint through the shared map')
  // The silent-failure shape highlight.js's header names: CSS drops an unparseable var() without a
  // word, so a built-at-runtime property renders as "no colour" rather than as an error. A guard in
  // the suite caught exactly this construct being written here.
  assert.ok(!/var\(--proto-\$\{/.test(src), 'a custom-property name is being built at runtime')
  assert.match(src, /data-qc-sev=\{fieldSev \|\| ''\}/, 'the severity must be readable from the DOM')
})

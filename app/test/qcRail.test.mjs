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
  railDecisions, DECISION_NOTE, packetFailList, qcSummaryModel, NO_ASSETS_REASON, firstFixTarget, listOwnersFromArtifacts, requirementUsage, swapAskWhy,
  swapUndo, ATTENTION_ORDER, attentionRank, severityFor, firstFixFinding, firstOffenderField, keepAvailability } from '../src/qcRail.js'
import { scoreParts, FIELD_LABEL } from '../src/assetGate.js'
import { TALLY_SCORE_DEFER } from '../src/postingAnalysis.js'

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

// ── option B: a finding's second destination ────────────────────────────────────────────────────
//
// Owner decision, 2026-08-24. A finding names a field; today the ONLY route from it is the gate
// drawer, which shows that field's RECORD (generated or static, item count, pass) and never its
// text. Option B adds a second route to the draft itself, where the sentence and its edit controls
// are. Additive by instruction: the drawer link is untouched, so nothing anyone relies on changes.
test('the go-to-draft hook is registered and distinct from the drawer route', () => {
  assert.equal(QC_HOOKS.goToField, 'qc-go-to-field')
  const values = Object.values(QC_HOOKS)
  assert.equal(new Set(values).size, values.length, 'two hooks sharing a value makes them unselectable apart')
})

// The control has to be WIRED, not merely present. Three ways this ships broken and looks fine:
// the span renders but calls the drawer handler; the prop is declared and never threaded to the
// tabs; or the deep link is resolved in the card (which knows only its own id) instead of the
// parent (which knows both), so every card rings its own field.
test('the go-to-draft control calls its own handler, and the prop reaches both tabs', () => {
  const rail = readFileSync(new URL('../src/screens/QcRail.jsx', import.meta.url), 'utf8')

  // Window starts BEFORE the hook attribute: role/tabIndex sit on the opening line above it.
  const at = rail.indexOf('QC_HOOKS.goToField')
  const block = rail.slice(Math.max(0, at - 300), at + 700)
  assert.match(block, /onClick=\{\(\) => onGoToField\(/, 'the control must call onGoToField, not onOpen')
  assert.match(block, /onKeyDown=/, 'a span used as a button needs a keyboard path')
  assert.match(block, /role="button"/)

  // Threaded all the way down, not declared and dropped.
  for (const tab of ['ChecksTab', 'ReviewTab']) {
    const sig = new RegExp(`function ${tab}\\(\\{[^}]*onGoToField`)
    assert.match(rail, sig, `${tab} must accept onGoToField`)
  }
  assert.match(rail, /<ChecksTab[^>]*onGoToField=\{onGoToField\}/s)
  assert.match(rail, /<ReviewTab[^>]*onGoToField=\{onGoToField\}/s)
  assert.match(rail, /export default function QcRail\(\{[^}]*onGoToField/s, 'QcRail must accept it from the parent')
})

test('the deep link is resolved by the parent, so one finding rings ONE card', () => {
  const pb = readFileSync(new URL('../src/screens/PacketBuilder.jsx', import.meta.url), 'utf8')
  // The artifact-id match happens where BOTH ids are known. A card resolving `fieldFocus` itself
  // would ring its own field for a finding on a different artifact.
  assert.match(pb, /focusField=\{fieldFocus && fieldFocus\.artifactId === a\.id \? fieldFocus\.section : null\}/,
    'the parent must resolve which card owns the focus')
  assert.match(pb, /focusField=\{focusField\}/, 'and the card must pass through what it was handed')
  // The step is derived from the same rule getArtifactsByStep uses, not a second mapping.
  assert.match(pb, /a\.type === 'resume' \|\| a\.type === 'compact_resume'\) \? 'resume' : a\.type/,
    'compact_resume must land on the Resume step, as getArtifactsByStep puts it there')
  // SCOPED to goToField's own body. `if (!a) return` appears twice in this file, so an unscoped
  // match would still pass with THIS guard deleted — the assertion would be watching the wrong one.
  const fn = pb.slice(pb.indexOf('const goToField = useCallback'), pb.indexOf('}, [artifacts, setActiveStep])'))
  assert.ok(fn.length > 100, 'goToField body not found - this assertion has gone stale')
  assert.match(fn, /if \(!a\) return/, 'an unknown artifact id must do nothing, never guess a step')
})

// ── SPEC 4.8-10: "Needs a decision", on the page ────────────────────────────────────────────────
// The change log's sibling. SPEC 4.8 says both lists are "on the page, not behind a tab or a
// search"; one was, and this one lived only in the Checks tab and the drawer. Every input already
// existed — this is a PROJECTION of the payload the rail already had, and the guards below are
// mostly about it staying one.

const DEC_FIX_FAIL = { check_key: 'k_fail', state: 'fail', engine: 'deterministic' }
const DEC_FIX_WARN = { check_key: 'k_warn', state: 'warn', engine: 'deterministic' }
const DEC_REV_FAIL = { check_key: 'k_rev', state: 'fail', engine: 'reviewer' }
const DEC_PASS = { check_key: 'k_ok', state: 'pass', engine: 'deterministic' }
const decEntry = (id, result, extra = {}) => ({ artifact: { id }, label: id, result, ...extra })

// THE SHAPE PRODUCTION ACTUALLY SENDS. appChecks.ts:307-319 publishes a SERVER-SIDE grouping
// (`engines.deterministic.results` / `engines.reviewer.results`) alongside the flat array, and
// engineRows() prefers the grouping — so a fixture built only from `results` exercises the FALLBACK
// branch and proves nothing about the payload the app receives. Writing guards against a shape the
// producer does not emit is the defect that shipped twice in one day (VERIFY-30 F4, then the F5
// rebuild detector); this is the same mistake refusing to happen a third time.
const decServerEntry = (id, { gate, attention, det = [], rev = [] }) => decEntry(id, {
  gate, attention, results: [...det, ...rev],
  engines: { deterministic: { decides: 'pass/warn/fail', results: det },
             reviewer: { decides: 'warn at most', results: rev, verdict: null } },
})

test('H:decisions-reconcile-with-the-counts-strip: the list and the numbers are the same rows', () => {
  // CLAUDE.md's cross-surface rule applied here: the header strip, the per-asset chips, the Checks
  // tab and this list are FOUR consumers of one payload. `rows` counts only rows on assets the
  // strip also counts, so equality is structural rather than coincidental.
  const cases = [
    [decEntry('a', { gate: 'fail', attention: 3, results: [DEC_FIX_FAIL, DEC_FIX_WARN, DEC_REV_FAIL, DEC_PASS] })],
    [decEntry('a', { gate: 'pass', attention: 0, results: [DEC_PASS] })],
    [decEntry('a', { gate: 'fail', attention: 1, results: [DEC_FIX_FAIL] }),
     decEntry('b', { gate: 'pass', attention: 0, results: [DEC_PASS] })],
    [decEntry('a', { gate: 'fail', attention: 2, results: [DEC_FIX_FAIL, DEC_REV_FAIL] }),
     decEntry('b', null)],
    [],
  ]
  for (const entries of cases) {
    const d = railDecisions(entries)
    const t = railTotals(entries)
    assert.equal(d.rows, t.toFix + t.toReview,
      `the list renders ${d.rows} rows while the strip says ${t.toFix} + ${t.toReview}`)
    assert.equal(d.toFix, t.toFix)
    assert.equal(d.toReview, t.toReview)
    assert.equal(d.unchecked, t.unchecked)
  }
})

test('H:decisions-order-is-the-modules: blocking rows come before rows that only want a look', () => {
  // Asserted on the EMITTED order, not on JSX, because the component is forbidden from sorting.
  const d = railDecisions([decEntry('a', {
    gate: 'fail', attention: 3,
    results: [DEC_REV_FAIL, DEC_FIX_WARN, DEC_FIX_FAIL],   // deliberately worst-case input order
  })])
  assert.deepEqual(d.assets[0].rows.map((r) => r.row.check_key), ['k_fail', 'k_warn', 'k_rev'])
  assert.deepEqual(d.assets[0].rows.map((r) => r.kind), ['fix', 'fix', 'review'])
})

test('H:decisions-empty-is-not-one-sentence: unchecked is never reported as clear', () => {
  // THE vacuous-green case. An asset nobody ran the checks on has zero findings; printing "nothing
  // needs a decision" over it is absent evidence reported as a pass — the exact failure the rail
  // exists to prevent, and the reason ChangeLog carries four sentences rather than one.
  const checkedClear = railDecisions([decEntry('a', { gate: 'pass', attention: 0, results: [DEC_PASS] })])
  assert.equal(checkedClear.assets[0].status, 'clear')
  assert.equal(checkedClear.anyChecked, true)
  assert.equal(checkedClear.anyOpen, false)

  const neverChecked = railDecisions([decEntry('a', null)])
  assert.equal(neverChecked.assets[0].status, 'unchecked')
  assert.equal(neverChecked.anyChecked, false, 'an unchecked packet must not report itself as checked-and-clear')
  assert.notEqual(DECISION_NOTE.clear, DECISION_NOTE.unchecked)
  assert.match(DECISION_NOTE.unchecked, /have not been run/i)
  assert.doesNotMatch(DECISION_NOTE.unchecked, /\bclear\b/i)

  // Loading is a third state: an asset still being read has not been found clear either.
  const loading = railDecisions([decEntry('a', null, { resultLoading: true })])
  assert.equal(loading.assets[0].status, 'loading')
})

test('H:decisions-name-the-asset-they-could-not-read: an error is never an omission', () => {
  const d = railDecisions([decEntry('a', null, { resultError: 'HTTP 500' })])
  assert.equal(d.assets.length, 1, 'the asset was dropped — which reads as "nothing to decide" for it')
  assert.equal(d.assets[0].status, 'error')
  assert.equal(d.assets[0].error, 'HTTP 500')
})

test('H:decisions-report-the-uncounted: a finding in no number is flagged, not hidden or double-counted', () => {
  // An asset with findings but NO gate row is excluded from toFix/toReview by railTotals. Hiding
  // its rows loses a real finding; adding them to `rows` makes this list disagree with the strip.
  // Both are wrong, so they are listed, counted apart, and the contradiction is stated.
  const d = railDecisions([decEntry('a', { gate: null, attention: 2, results: [DEC_FIX_FAIL, DEC_REV_FAIL] })])
  assert.equal(d.assets[0].status, 'unchecked')
  assert.equal(d.assets[0].rows.length, 2, 'the findings were hidden')
  assert.equal(d.rows, 0, 'uncounted findings leaked into the number the strip also shows')
  assert.equal(d.uncounted, 2)
  assert.ok(d.assets[0].anomalies.some((a) => /neither number above/.test(a)),
    'the payload contradicts the strip and nothing says so')
})

test('H:decisions-do-not-restate-needs-attention: no third copy of the predicate', () => {
  // `needsAttention` (assetGate.js) and `NEEDS_ATTENTION` (qcRail.js) are ALREADY two copies
  // differing only in name. The existing "computes nothing" guard greps QcRail.jsx only and is
  // structurally blind to a third copy landing in a module, which is exactly where this one went.
  const pred = /state\s*===\s*['"]fail['"]\s*\|\|[^\n]*state\s*===\s*['"]warn['"]/g
  let n = 0
  for (const f of ['qcRail.js', 'assetGate.js']) {
    n += (stripComments(readSrc(f)).match(pred) || []).length
  }
  assert.ok(n <= 2, `${n} definitions of "needs attention" across the two modules — it was 2; ` +
    'railDecisions must call engineRows()/NEEDS_ATTENTION, not restate the rule')
})

test('H:decisions-are-on-the-page-not-a-sixth-tab: the mount sits between the log and the tabs', () => {
  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  const log = jsx.indexOf('<ChangeLog ')
  const dec = jsx.indexOf('<Decisions ')
  const tabs = jsx.indexOf('RAIL_TABS.map(')
  assert.ok(dec > 0, 'the Needs-a-decision region is defined but never mounted')
  assert.ok(log < dec && dec < tabs,
    'SPEC 4.8 puts both lists ON THE PAGE — this one must sit after the change log and before the tab strip')
  // And it must not have become a tab instead. RAIL_TABS is pinned by assert.deepEqual above;
  // this states the intent so a future reader does not "fix" that pin by editing the array.
  assert.equal(RAIL_TABS.length, 5, 'a sixth tab was added — SPEC 4.8 says NOT behind a tab')
  assert.ok(!RAIL_TABS.some((t) => /decision/i.test(t.key + t.label)))
  // The component renders, and decides nothing: no sort, no filter, no arithmetic of its own.
  const body = jsx.slice(jsx.indexOf('function Decisions('), jsx.indexOf('export default function QcRail'))
  assert.ok(body.includes('railDecisions(entries)'), 'the region does not go through the module')
  assert.ok(!/\.sort\(/.test(body), 'the component sorts — ordering is the module\'s job')
  assert.ok(!/\.filter\(/.test(body), 'the component filters — deciding what needs attention is the module\'s job')
  assert.ok(!/\.length\s*\+/.test(body), 'the component assembles a count')
  // It reuses CheckRow rather than growing a second row treatment for the same finding.
  assert.ok(body.includes('<CheckRow'), 'a second row treatment was built for a finding the Checks tab already renders')
})

test('H:decisions-hold-on-the-shape-the-api-sends: the grouped payload, not the flat fallback', () => {
  // Same four claims, re-proved against `engines.{deterministic,reviewer}.results` — the branch
  // engineRows() actually takes in production. The fixtures above take the other one.
  const entries = [
    decServerEntry('a', { gate: 'fail', attention: 3, det: [DEC_REV_FAIL, DEC_FIX_WARN, DEC_FIX_FAIL].filter((r) => r.engine === 'deterministic'), rev: [DEC_REV_FAIL] }),
    decServerEntry('b', { gate: 'pass', attention: 0, det: [DEC_PASS], rev: [] }),
    decEntry('c', null),
  ]
  const d = railDecisions(entries)
  const t = railTotals(entries)
  // reconciles
  assert.equal(d.rows, t.toFix + t.toReview)
  assert.equal(d.toFix, 2)
  assert.equal(d.toReview, 1)
  // ordering survives the grouped branch: fail, warn, then the reviewer's row
  assert.deepEqual(d.assets[0].rows.map((r) => r.row.check_key), ['k_fail', 'k_warn', 'k_rev'])
  assert.deepEqual(d.assets[0].rows.map((r) => r.kind), ['fix', 'fix', 'review'])
  // the three states still separate
  assert.deepEqual(d.assets.map((a) => a.status), ['open', 'clear', 'unchecked'])
  assert.equal(d.anyChecked, true)
})

// ── the three defects the independent verifier found, each of which shipped 311/0 GREEN ──────────
// All three share one shape, and it is the shape this repo has already paid for twice: A GUARD THAT
// GREPS ONE FILE PROVES NOTHING ABOUT THE FILE ON THE OTHER SIDE OF THE PROP. It was closed for
// 4.8-10's predicate in the same commit that left it open for 4.1-3's wiring and for the rail's own
// sentence lookup.

test('H:decisions-footer-cannot-contradict-the-rows-above-it: F-1', () => {
  // THE VERIFIER'S F-1, and the sharpest finding of the three: the region printed
  // "Nothing is waiting on you. Every check that could run is clear." directly beneath two rendered
  // CheckRows. Both halves false — findings ARE waiting, and asset A's checks never ran, so "every
  // check that could run is clear" is absent evidence reported as a pass.
  //
  // Root cause: `anyOpen` read a derived STATUS while the footer is a claim about what is ON SCREEN.
  // An asset with findings but no gate row is 'unchecked', never 'open', so the proxy said empty
  // while the screen said otherwise. The invariant is stated against the rows, not the status.
  const failDet = { check_key: 'k1', state: 'fail', engine: 'deterministic' }
  const failRev = { check_key: 'k2', state: 'fail', engine: 'reviewer' }
  const ungated = decEntry('A', { gate: null, attention: 2, results: [failDet, failRev] })
  const clean = decEntry('B', { gate: 'pass', attention: 0, results: [DEC_PASS] })

  // the exact payload from the verifier's repro
  const d = railDecisions([ungated, clean])
  assert.equal(d.uncounted, 2, 'precondition: the ungated asset still carries two findings')
  assert.equal(d.anyOpen, true,
    'the footer would render "every check that could run is clear" over two listed findings')

  // the milder variant of the same root cause: the ungated asset ALONE
  assert.equal(railDecisions([ungated]).anyOpen, true,
    'a footer implying emptiness would render over rendered rows')

  // THE INVARIANT, not the incident: the clear-sentence branch is unreachable whenever ANY row is
  // on screen — counted or not. This is what makes the assertion survive a refactor of `status`.
  for (const entries of [[ungated], [ungated, clean], [clean, ungated],
                         [decEntry('C', { gate: 'fail', attention: 1, results: [failDet] })]]) {
    const m = railDecisions(entries)
    const rowsOnScreen = m.assets.reduce((n, a) => n + a.rows.length, 0)
    if (rowsOnScreen > 0) assert.equal(m.anyOpen, true,
      `${rowsOnScreen} rows render but anyOpen is false — the footer claims the opposite of the screen`)
  }
  // and the converse, so this is not satisfied by hardcoding true
  assert.equal(railDecisions([clean]).anyOpen, false)
  assert.equal(railDecisions([]).anyOpen, false)
})

test('H:decisions-sentence-is-looked-up-BY-STATUS: F-3', () => {
  // THE VERIFIER'S F-3. `H:decisions-empty-is-not-one-sentence` proves the four sentences differ and
  // that railDecisions returns the right status — and nothing proved the SCREEN looks the sentence
  // up by that status. Mutating `{DECISION_NOTE[a.status]}` to `{DECISION_NOTE.clear}` left the
  // suite 311/0 while reporting an UNCHECKED asset to the owner as clear: verbatim AC 1.8's failure.
  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  assert.match(jsx, /DECISION_NOTE\[\s*a\.status\s*\]/,
    'the screen picks its sentence by a literal key — an unchecked asset can be reported as clear')
  // No literal member access may stand in for the lookup.
  for (const k of ['clear', 'unchecked', 'loading']) {
    assert.ok(!jsx.includes('DECISION_NOTE.' + k),
      `the screen hardcodes DECISION_NOTE.${k} instead of looking the sentence up by status`)
  }
})

test('H:jd-qc-link-is-WIRED-not-just-rendered: F-2', () => {
  // THE VERIFIER'S F-2, from two mutations that both shipped green:
  //   A) delete `onOpenQc` from PacketBuilder      -> the control never renders at all (it is gated
  //                                                   on the prop), so the whole feature vanishes
  //   B) setActiveStep('qc') -> setActiveStep('jd') -> the control re-opens the step it is already on
  // Every 4.1-3 assertion greps PostingAnalysis.jsx, which is the half that CANNOT see either bug.
  // The AC doc predicted this in writing: "Run (i) alone does not prove 3.1 - it proves the words
  // are on screen, which is exactly the dead-UI failure the standing rule names."
  const builder = stripComments(readSrc('screens/PacketBuilder.jsx'))
  const mount = builder.slice(builder.indexOf('<PostingAnalysisCard'))
  const props = mount.slice(0, mount.indexOf('/>'))
  assert.match(props, /onOpenQc=/,
    'PacketBuilder does not pass onOpenQc — the control is gated on that prop, so 4.1-3 renders nowhere')
  assert.match(props, /setActiveStep\(\s*'qc'\s*\)/,
    'the navigation prop does not go to the QC step — the control would open the wrong step')
  // It must use the ONE step API rather than a second router, on this side of the prop too.
  assert.ok(!/window\.location|history\.pushState/.test(props),
    'the mount navigates directly instead of through setActiveStep')
})

// ── THE SHIP GATE MUST NOT FAIL OPEN ─────────────────────────────────────────────────────────────
// Found by a local render comparison, not by the suite, and it had been live: the Review & send step
// reported "Nothing blocks sending." on the SAME packet, in the SAME session, from the SAME payload
// that the QC step was rendering as "Blocked - 52 to fix, 1 never checked". Measured on a driven
// render: data-qc-count="0", data-qc-assets="0", zero fail rows, and re-run at --settle 12000 as a
// disconfirming test in case it was a fetch race. It was not.
//
// Cause: useQcEntries emitted { artifact, label, result, ... } with no `artifactId`, while
// packetFailList reads `e.artifactId || e.id` and does `if (!artifactId) continue` - so it skipped
// EVERY entry and returned an empty list, which reads as "nothing wrong".
//
// This is the worst failure this repo has a name for: absent evidence rendered as PERMISSION.
// The guard is BEHAVIOURAL, not a source grep for the key - a grep would pass on an entry that
// carried the key with the wrong value, and would not have caught the `type` half at all.

test('H:ship-gate-cannot-fail-open: a blocking finding always reaches the send step', () => {
  const shape = (id, type, result) => ({
    artifact: { id, type }, artifactId: id, type, label: type, result,
  })
  const failRow = { check_key: 'ats_parse', state: 'fail', engine: 'deterministic' }

  // A packet with one FAILING asset and one asset nobody checked. Both must block.
  const entries = [
    shape('a1', 'resume', { gate: 'fail', attention: 1, results: [failRow] }),
    shape('a2', 'cover', null),                                   // no gate row at all
  ]
  const fl = packetFailList(entries)
  assert.ok(fl.items.length > 0,
    'the send step would say "Nothing blocks sending" over a failing packet - the gate FAILS OPEN')
  assert.ok(fl.count > 0, 'the blocking count is zero on a packet that is blocked')
  assert.ok(fl.assets > 0, 'no asset is named as blocking')
  // Both reasons must be represented: a real fail AND an unchecked asset. An unchecked asset is the
  // absent-evidence case and is the one most easily laundered into a pass.
  const ids = new Set(fl.items.map((i) => i.artifactId))
  assert.ok(ids.has('a1'), 'the failing asset is missing from the fail list')
  assert.ok(ids.has('a2'), 'the UNCHECKED asset is missing - absent evidence is not permission')
  // Every item must name its asset. An item with a null artifactId cannot be opened or acted on.
  for (const i of fl.items) assert.ok(i.artifactId, 'a fail-list item names no artifact')

  // And the converse, so this cannot be satisfied by returning items unconditionally.
  const clean = [shape('a1', 'resume', { gate: 'pass', attention: 0, results: [] })]
  assert.equal(packetFailList(clean).count, 0, 'a genuinely clean packet must not be reported blocked')
})

test('H:qc-entries-carry-what-the-gate-reads: producer and consumers agree on the shape', () => {
  // The mismatch was between ONE producer and THREE consumers, and it survived because nothing
  // asserted the contract between them. Stated here as the contract, in both directions.
  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  const producer = jsx.slice(jsx.indexOf('const entries = useMemo'), jsx.indexOf('}), [list, checks, ins, rem])'))
  for (const key of ['artifactId:', 'type:', 'result:', 'label:']) {
    assert.ok(producer.includes(key), `useQcEntries no longer emits ${key} - a consumer reads it`)
  }
  // NOT just "the key is present" - the key must be ASSIGNED FROM THE ARTIFACT. Presence alone was
  // proved insufficient by mutation: `artifactId: null` left the whole suite green while restoring
  // the exact fail-open behaviour, because the behavioural test above builds its own entries and so
  // exercises the SELECTOR, never the PRODUCER. That is the same two-sides-of-the-prop blindness as
  // the bug itself, reappearing inside its own fix.
  //
  // This is a SOURCE-SHAPE assertion and therefore weaker than a behavioural one; there is no DOM
  // renderer in this suite, so the producer cannot be executed here. The thing that actually caught
  // the original defect was a local RENDER of the built app against fixtures
  // (scripts/render-app.mjs), which drove the real component and read the real DOM. Worth knowing
  // which instrument found it: not this file.
  assert.match(producer, /artifactId:\s*a(\s*&&\s*a)?\.id/,
    'artifactId is present but not taken from the artifact id - a null or wrong value here fails the ship gate open')
  assert.match(producer, /\btype:\s*a(\s*&&\s*a)?\.type/,
    'type is present but not taken from the artifact - fail-list items would name no asset type')
  // The consumers that read them, named so a future edit to either side has to look at the other.
  const mod = stripComments(readSrc('qcRail.js'))
  assert.ok(/e\.artifactId/.test(mod), 'packetFailList no longer reads artifactId')
  const builder = stripComments(readSrc('screens/PacketBuilder.jsx'))
  assert.ok(/e\.artifactId === a\.id/.test(builder),
    'the asset gate badge no longer matches entries by artifactId')
})

// ── SPEC 4.3-9/10/11: the QC summary inside the keyword tally modal ─────────────────────────────
//
// The modal opens from the JD step, where the reader CANNOT see the QC rail to check it against.
// Every one of these guards is about that: a sentence, a row or a number that disagrees with the
// rail has no way of being caught by the person reading it.

const tallyEntry = (id, type, label, result, extra = {}) => ({
  artifact: { id, type }, artifactId: id, type, label, result,
  resultLoading: false, resultError: null, ...extra,
})
const TALLY_SCORE = {
  composite: 78, band: 'acceptable',
  must_have_coverage: 62, must_have_source: 'measured over 13 must-have lines',
  keyword_coverage: 71, keyword_source: 'measured against term library v4',
  seniority_alignment: 55, seniority_source: 'graded by the independent reviewer',
}

test('H:tally-two-empties-two-sentences: no two states of the QC summary print the same claim', () => {
  // "nothing has been built" and "the thing that carries the score has not been built" and "it was
  // never checked" are three different facts. One sentence for two of them is how an absence gets
  // read as a measurement - the failure the whole rail exists to prevent, arriving on a screen that
  // cannot see the rail.
  const resume = (result, extra) => tallyEntry('r1', 'resume', 'Resume', result, extra)
  const cover = tallyEntry('c1', 'cover', 'Cover letter', { gate: 'warn', attention: 1 })
  const cases = {
    no_assets: qcSummaryModel([], { scored: null, scoredType: 'resume' }),
    no_scored_asset: qcSummaryModel([cover], { scored: null, scoredType: 'resume' }),
    unreadable: (() => { const e = resume(null, { resultError: 'HTTP 500' }); return qcSummaryModel([e], { scored: e, scoredType: 'resume' }) })(),
    reading: (() => { const e = resume(null, { resultLoading: true }); return qcSummaryModel([e], { scored: e, scoredType: 'resume' }) })(),
    not_scored: (() => { const e = resume({ gate: 'fail', attention: 2 }); return qcSummaryModel([e], { scored: e, scoredType: 'resume' }) })(),
    scored: (() => { const e = resume({ gate: 'pass', attention: 0, score: TALLY_SCORE }); return qcSummaryModel([e], { scored: e, scoredType: 'resume' }) })(),
  }
  for (const [want, m] of Object.entries(cases)) assert.equal(m.state, want, `${want} reported ${m.state}`)
  const sentences = Object.values(cases).map((m) => m.sentence)
  assert.equal(new Set(sentences).size, sentences.length, 'two states share a sentence: ' + JSON.stringify(sentences))
  // AND the CLAIM as a whole, not just its first line. F-3, found by the independent verifier:
  // the two `not_scored` branches (`qcRail.js:955-976`) share a sentence BY DESIGN and carry the
  // distinction entirely in `detail` - "the checks have not been run" versus "the checks ran but
  // stored no score row". Asserting distinctness over `sentence` alone left the details free to
  // collapse with the suite green, which erases the never-ran / ran-and-stored-nothing split. That
  // split is not a nicety here: `score: null` on every production artifact means the app lives in
  // exactly these two states today, and telling them apart is the whole point.
  const claims = Object.values(cases).map((m) => m.sentence + ' || ' + m.detail)
  assert.equal(new Set(claims).size, claims.length, 'two states make the same claim: ' + JSON.stringify(claims))
  // The two that share a sentence must be the ones that differ in detail, stated so a future reader
  // does not "tidy" them into one.
  const neverRan = (() => { const e = resume(null); return qcSummaryModel([e], { scored: e, scoredType: 'resume' }) })()
  const ranNoRow = cases.not_scored
  assert.equal(neverRan.state, ranNoRow.state, 'precondition: both are the not_scored state')
  assert.notEqual(neverRan.detail, ranNoRow.detail,
    'never-ran and ran-but-stored-nothing print the same detail - an absence and a measurement made and discarded')
  // AC B.9 - the empty-packet sentence is qcStepState's own, not a second wording of it.
  assert.ok(cases.no_assets.sentence.includes(NO_ASSETS_REASON), cases.no_assets.sentence)
  assert.ok(qcStepState([]).reason.includes(NO_ASSETS_REASON))
  // AC B.10 - a packet with no resume must not read as an empty packet, and must not borrow the
  // cover letter's score.
  assert.ok(!cases.no_scored_asset.sentence.includes(NO_ASSETS_REASON))
  assert.equal(cases.no_scored_asset.score, null)
  assert.equal(cases.no_scored_asset.headline, null)
  assert.equal(cases.no_scored_asset.rows.length, 1)
})

test('H:band-tone-fails-closed: an unrecognised verdict is never shown as permission', async () => {
  // F-2, found by the independent verifier. `assetGate.js:391-396` STATES the rule in prose - "an
  // unknown band falls to red rather than to green, because an unrecognised verdict is not
  // permission" - and nothing enforced it: flipping the final 'red' to 'green' left node 342/0,
  // test:tally 49/49 and test:qc 81/88 (the same 7). Not a regression from this work - main carried
  // the identical ternary, inlined and equally unguarded - but a rule NAMED without a test behind it
  // is precisely the class this repo has been bitten by repeatedly.
  //
  // Three surfaces render this pill (the drawer's Match tab, the QC rail's compact block, the tally
  // modal), so a wrong colour here says "acceptable" on three screens at once.
  const { bandTone } = await import('../src/assetGate.js')
  assert.equal(bandTone('strong'), 'green')
  assert.equal(bandTone('acceptable'), 'yellow')
  // EVERY other input, including ones a server could plausibly send, must fail CLOSED.
  for (const unknown of ['weak', 'poor', 'unknown', '', null, undefined, 'STRONG', 'Strong', 0, 'pass']) {
    assert.equal(bandTone(unknown), 'red',
      `bandTone(${JSON.stringify(unknown)}) is not red - an unrecognised verdict rendered as permission`)
  }
  // Case matters: a tolerant match would turn a typo in a stored band into a green light.
  assert.notEqual(bandTone('STRONG'), 'green')
})

test('H:tally-rows-are-the-packets-own-artifacts: never a fixed type list', () => {
  // The prototype hardcodes ['resume','compact_resume','cover','portfolio'] (qc/packet.jsx:344),
  // which draws gate rows for assets a packet does not have - fake data and dead UI in one row.
  const mk = (n) => Array.from({ length: n }, (_, i) => tallyEntry('a' + i, 'cover', 'Cover letter', { gate: 'pass', attention: 0 }))
  for (const n of [2, 5]) {
    const m = qcSummaryModel(mk(n), { scored: null, scoredType: 'resume' })
    assert.equal(m.rows.length, n, `${n} artifacts produced ${m.rows.length} rows`)
  }
  // Order and identity are the packet's, and the RESULT is passed through untouched: the badge
  // reads the server's payload, and a copy made here would be a second opinion about a gate.
  const result = { gate: 'warn', attention: 3, results: [{ state: 'fail', engine: 'reviewer' }] }
  const entries = [tallyEntry('r1', 'resume', 'Resume', result), tallyEntry('v1', 'video', 'Intro video', null)]
  const m = qcSummaryModel(entries, { scored: entries[0], scoredType: 'resume' })
  assert.deepEqual(m.rows.map((r) => r.artifactId), ['r1', 'v1'])
  assert.equal(m.rows[0].result, result, 'the row must hand the badge the SAME payload object')
  assert.equal(m.rows[1].result, null, 'an unchecked asset keeps its null - never a substituted gate')
})

test('H:tally-scores-one-asset-and-says-which: no packet-level composite is ever formed', () => {
  // artifact_score is per artifact. Averaging four of them would be exactly the fabricated
  // composite computeArtifactScore refuses to produce, and it is the number a reader trusts most.
  const strong = tallyEntry('r1', 'resume', 'Resume', { gate: 'pass', attention: 0, score: TALLY_SCORE })
  const weak = tallyEntry('c1', 'cover', 'Cover letter', { gate: 'fail', attention: 9, score: { ...TALLY_SCORE, composite: 10 } })
  const m = qcSummaryModel([strong, weak], { scored: strong, scoredType: 'resume' })
  assert.equal(m.score.composite, 78, 'the scored asset\'s own composite, not a blend')
  assert.equal(m.headline.value, 78)
  assert.equal(m.subject, 'Resume')
  // AC B.8 - the surface must NAME the artifact it is scoring, and refuse a packet-wide one.
  assert.match(m.scope, /^Resume only - there is no packet-wide score/)
  for (const bad of [44, 43.5, 88]) assert.ok(!String(m.scope).includes(String(bad)))
})

test('H:tally-unread-is-not-unscored: an error is reported, never rendered as an absence of score', () => {
  const err = tallyEntry('r1', 'resume', 'Resume', null, { resultError: 'HTTP 500 from checks-result' })
  const m = qcSummaryModel([err], { scored: err, scoredType: 'resume' })
  assert.equal(m.state, 'unreadable')
  assert.match(m.detail, /HTTP 500 from checks-result/, 'the server\'s own words are dropped')
  assert.equal(m.score, null)
  // And the row still names the asset: an omitted asset reads as "nothing wrong with it".
  assert.equal(m.rows.length, 1)
  assert.equal(m.rows[0].label, 'Resume')
  assert.equal(m.rows[0].error, 'HTTP 500 from checks-result')
})

test('H:tally-defer-key-tracks-scoreParts: the keyword number cannot silently come back', () => {
  // AC B.4 branch (a) works by KEY. Rename scoreParts' `kw` key and the defer map stops matching -
  // silently, with no test failing and `keyword_coverage` printed twice on one screen under two
  // labels. This is the guard for that rename.
  const keys = scoreParts(TALLY_SCORE).map((p) => p.key)
  assert.deepEqual(keys, ['must', 'kw', 'sen'])
  for (const k of Object.keys(TALLY_SCORE_DEFER)) {
    assert.ok(keys.includes(k), `TALLY_SCORE_DEFER defers "${k}", which scoreParts() no longer emits`)
  }
  assert.ok(Object.keys(TALLY_SCORE_DEFER).includes('kw'),
    'the keyword part is no longer deferred - the tally modal now prints keyword_coverage twice')
  // The deferral must point somewhere real: KeywordLibraryState is what renders it.
  assert.match(TALLY_SCORE_DEFER.kw, /term library/i)
})

test('H:tally-summary-derives-nothing: the model reads selectors, it does not re-decide them', () => {
  // qcRail.js's own header rule, applied to the newest selector in it. A gate re-derived here would
  // be a THIRD opinion (checks.ts, railGate, and this) on a screen that shows none of the others.
  const mod = stripComments(readSrc('qcRail.js'))
  const at = mod.indexOf('export function qcSummaryModel')
  assert.ok(at > 0, 'qcSummaryModel is gone')
  const region = mod.slice(at, mod.indexOf('\nexport ', at + 10))
  for (const banned of ['railGate(', 'gateMeta(', 'severityFor(', '.filter(', '.reduce(', "=== 'fail'", "=== 'pass'"]) {
    assert.ok(!region.includes(banned), `qcSummaryModel derives a verdict of its own: ${banned}`)
  }
  assert.ok(region.includes('railHeadline('), 'the score must be read through railHeadline, not restated')
})

// ── SPEC 4.4-14 — the gate badge deep-links to the first failing field ───────────────────────────

test('H:first-fix-target-is-null-when-there-is-nowhere-to-go', () => {
  // THE CASE THAT MATTERS. `GateBadge` renders role="button", tabIndex and an Enter/Space handler
  // the moment it is given an onClick, so a target that resolves to nothing does not merely do
  // nothing - it advertises itself as actionable to a keyboard and a screen reader. That is the
  // dead UI the standing rule forbids, and it is why null is a first-class return rather than an
  // edge case the caller can shrug at.
  //
  // An UNCHECKED asset always has `mergeField: null` (packetFailList builds it that way), so it has
  // no field to open even though it very much has a problem.
  const unchecked = [{ artifactId: 'a1', type: 'resume', result: null }]
  assert.equal(firstFixTarget(unchecked, 'a1'), null, 'an unchecked asset offered a navigation target')

  // A passing asset likewise: nothing is failing, so there is nothing to open.
  const passing = [{ artifactId: 'a1', type: 'resume', result: { gate: 'pass', results: [] } }]
  assert.equal(firstFixTarget(passing, 'a1'), null)

  // And an artifact that is not in the list at all.
  assert.equal(firstFixTarget(passing, 'nope'), null)
  assert.equal(firstFixTarget([], 'a1'), null)
  assert.equal(firstFixTarget(null, 'a1'), null)
})

test('H:first-fix-target-reads-packetFailList-not-a-second-walk', () => {
  // One definition of "what needs fixing", one ordering. A second walk over the rows here would be
  // a parallel answer to the same question, and the two would disagree the first time either
  // changed - which is this repo's most-repeated defect (fix one consumer, miss the others).
  // Asserted by AGREEMENT rather than by implementation: the target must be the first item of
  // packetFailList that has an openable field, for the same input.
  const entries = [{
    artifactId: 'a1', type: 'resume',
    result: { gate: 'fail', results: [
      { check_key: 'placeholder_left', state: 'fail', engine: 'deterministic', observed: 'x' },
      { check_key: 'company_named', state: 'fail', engine: 'deterministic', observed: 'y' },
    ] },
  }]
  const { items } = packetFailList(entries)
  const expected = items.find((i) => i.mergeField)
  const got = firstFixTarget(entries, 'a1')
  assert.ok(expected, 'precondition: the fixture must produce at least one openable finding')
  assert.deepEqual(got, { artifactId: expected.artifactId, mergeField: expected.mergeField })
})

test('H:first-fix-target-skips-a-finding-that-names-no-field', () => {
  // `mergeField` is `CHECK_SUBJECT_FIELD[check_key] || null`, so a real failing check can still have
  // no subject field. Such a row must be SKIPPED rather than returned with a null field - returning
  // it would hand the caller a target it cannot navigate to, which is the null case wearing a
  // disguise.
  const entries = [{
    artifactId: 'a1', type: 'resume',
    result: { gate: 'fail', results: [
      // A REAL check key that maps to no subject field - `placeholder_left` is not in
      // CHECK_SUBJECT_FIELD, which holds only company_named and company_in_body. Using a real one
      // rather than an invented key proves the skip against the actual map.
      { check_key: 'placeholder_left', state: 'fail', engine: 'deterministic', observed: 'x' },
    ] },
  }]
  const t = firstFixTarget(entries, 'a1')
  assert.ok(t === null || t.mergeField, 'a target was returned with no field to open: ' + JSON.stringify(t))
})

test('H:first-fix-target-never-crosses-artifacts', () => {
  // The badge is per-asset. Returning another asset's field would send the reader to a document they
  // did not click on, which is worse than no link.
  const entries = [
    { artifactId: 'a1', type: 'resume', result: { gate: 'pass', results: [] } },
    // `company_named` is one of only TWO keys in CHECK_SUBJECT_FIELD. The first draft of this
    // fixture used `placeholder_left`, which maps to nothing - so it produced mergeField: null and
    // the test failed against CORRECT code. Exactly the "can the system produce your fixture?"
    // check: a fixture the mapping cannot yield proves nothing about the mapping.
    { artifactId: 'a2', type: 'cover', result: { gate: 'fail', results: [
      { check_key: 'company_named', state: 'fail', engine: 'deterministic', observed: 'x' },
    ] } },
  ]
  assert.equal(firstFixTarget(entries, 'a1'), null, 'a passing asset borrowed another asset\'s finding')
  const t2 = firstFixTarget(entries, 'a2')
  assert.equal(t2 && t2.artifactId, 'a2')
})

test('H:qc-summary-rows-carry-their-own-fix-target', () => {
  // The tally modal's <QcSummaryBlock> derives NOTHING - every sentence, row and score comes from
  // qcSummaryModel. Computing the target in the component would be a second opinion the reader
  // cannot reconcile against the rail, so it rides on the row.
  const entries = [
    { artifactId: 'r1', type: 'resume', label: 'Resume', result: { gate: 'fail', results: [
      { check_key: 'company_named', state: 'fail', engine: 'deterministic', observed: 'x' },
    ] } },
    { artifactId: 'c1', type: 'cover', label: 'Cover letter', result: null },
  ]
  const m = qcSummaryModel(entries, { scored: entries[0], scoredType: 'resume' })
  const byId = Object.fromEntries(m.rows.map((r) => [r.artifactId, r]))
  assert.ok('fixTarget' in byId.r1, 'the row does not carry a fixTarget at all')
  assert.equal(byId.r1.fixTarget && byId.r1.fixTarget.artifactId, 'r1')
  assert.ok(byId.r1.fixTarget.mergeField)
  // the unchecked asset gets null, so the component renders no click for it
  assert.equal(byId.c1.fixTarget, null, 'an unchecked row carried a navigation target')
})

// ── SPEC 4.1-20 — `Where it is used →` on the JD step ────────────────────────────────────────────

test('H:list-owners-derived-from-artifacts-not-render-registration', () => {
  // THE WHOLE REASON 4.1-20 NEVER SHIPPED. The app's existing `listOwners` is built by asset cards
  // REGISTERING as they render, so on the JD step - the step this link lives on - it is {} and the
  // link would be absent exactly where SPEC asks for it. Deriving from the packet's own artifacts
  // makes the map available before any card has mounted.
  const entries = [
    { artifactId: 'r1', type: 'resume', label: 'Resume', insertions: { insertions: [{ list: 'A' }, { list: 'B' }] } },
    { artifactId: 'c1', type: 'cover', label: 'Cover letter', insertions: { insertions: [{ list: 'B' }] } },
  ]
  const owners = listOwnersFromArtifacts(entries)
  assert.deepEqual(Object.keys(owners).sort(), ['A', 'B'])
  assert.deepEqual(owners.A.map((o) => o.id), ['r1'])
  // One list rendered by two assets keeps BOTH, in packet order - the resume and the compact resume
  // render identical templates, and collapsing them would lose the sibling the change is shared with.
  assert.deepEqual(owners.B.map((o) => o.id), ['r1', 'c1'])
})

test('H:list-owners-is-empty-not-partial-when-insertions-are-absent', () => {
  // Insertions load asynchronously. A PARTIAL map is worse than none: it renders the link for the
  // artifacts that happened to load and silently hides it for the rest, so the reader concludes the
  // requirement was never used. Empty means the caller renders no links at all.
  assert.deepEqual(listOwnersFromArtifacts([{ artifactId: 'r1', type: 'resume' }]), {})
  assert.deepEqual(listOwnersFromArtifacts([{ artifactId: 'r1', insertions: { insertions: [] } }]), {})
  assert.deepEqual(listOwnersFromArtifacts([]), {})
  assert.deepEqual(listOwnersFromArtifacts(null), {})
})

test('H:requirement-usage-is-null-unless-a-swap-actually-names-it', () => {
  // The ledger row for this feature is explicit: render the link "ONLY where a swap actually names
  // the requirement (no dead UI)". Every not-found path must be null, not a best guess.
  const owners = { A: [{ id: 'r1', label: 'Resume' }] }
  const swaps = { swaps: [{ requirement_id: 'q1', list: 'A', merge_field: '@Bullets' }] }
  assert.deepEqual(requirementUsage(swaps, 'q1', owners),
    { artifactId: 'r1', list: 'A', label: 'Resume', mergeField: '@Bullets' })
  // no swap for this requirement
  assert.equal(requirementUsage(swaps, 'q2', owners), null)
  // a swap whose list NO artifact renders - the map cannot place it, so there is nowhere to go
  assert.equal(requirementUsage({ swaps: [{ requirement_id: 'q1', list: 'Ghost' }] }, 'q1', owners), null)
  // insertions not loaded yet
  assert.equal(requirementUsage(swaps, 'q1', {}), null)
  assert.equal(requirementUsage(swaps, 'q1', null), null)
  // no swaps at all
  assert.equal(requirementUsage(null, 'q1', owners), null)
})

test('H:requirement-usage-falls-back-to-the-list-when-no-merge-field', () => {
  // A swap row may carry no merge_field. The list name is the honest fallback - it is what
  // insertion.list ties back to the field - and returning a target with a null section would hand
  // the navigator nothing to focus.
  const owners = { A: [{ id: 'r1', label: 'Resume' }] }
  const u = requirementUsage({ swaps: [{ requirement_id: 'q1', list: 'A' }] }, 'q1', owners)
  assert.equal(u.mergeField, 'A')
  assert.ok(u.mergeField, 'the target must always carry something the navigator can focus')
})

test('H:jd-field-link-is-wired-not-just-derived: the hop 4.1-20 built stays connected', () => {
  // WHY A SOURCE GREP AND NOT A UNIT TEST. `listOwnersFromArtifacts` and `requirementUsage` are pure
  // and already asserted above, and closing `D:jd-evidence-has-no-field-link` leaned on that. An
  // independent verifier showed the lean was too heavy: FIVE wiring mutations passed the whole suite
  // AND the build, including reverting `withInsertions` to `activeStep === 'qc'` — the exact original
  // defect the ledger row described — and dropping the `usage &&` condition the row's own acceptance
  // sentence names. Pure functions cannot see whether anyone calls them. This is the same structural
  // pattern the QcRail deep-link guard above uses, aimed at the JD step.
  const pb = readFileSync(new URL('../src/screens/PacketBuilder.jsx', import.meta.url), 'utf8')
  const pa = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')

  // 1. The insertions the map is DERIVED FROM must be loaded on the JD step, not the QC step alone.
  //    This is the defect the ledger row described: listOwners was empty exactly where SPEC asks
  //    for the link.
  assert.match(pb, /withInsertions:\s*activeStep === 'qc' \|\| activeStep === 'jd'/,
    'the JD step must load insertions, or listOwnersFromArtifacts has nothing to map')

  // 2. Both props reach the card. A derivation nothing passes down is a function with no caller.
  const card = pb.slice(pb.indexOf('<PostingAnalysisCard'))
  const openTag = card.slice(0, card.indexOf('/>'))
  assert.match(openTag, /listOwners=\{listOwnersFromArtifacts\(qcEntries\)\}/)
  assert.match(openTag, /onGoToField=\{goToField\}/,
    'the JD card must reuse the existing navigator, never a second one')

  // 3. Threaded all the way to the row that renders the link.
  assert.match(pa, /export function PostingAnalysisCard\(\{[^}]*onGoToField/s)
  assert.match(pa, /function Group\(\{[^}]*onGoToFieldRef/s)
  assert.match(pa, /function RequirementRow\(\{[^}]*onGoToFieldRef/s)
  assert.match(pa, /<RequirementRow[^>]*onGoToFieldRef=\{onGoToFieldRef\}/s)

  // 4. NO DEAD UI, which is the row's own acceptance sentence: a requirement no swap names shows no
  //    link at all. Both halves of the condition are load-bearing and the verifier proved neither
  //    was guarded — dropping `usage &&` renders a link that navigates nowhere.
  assert.match(pa, /\{usage && onGoToFieldRef && \(/,
    'the link must render only when a swap names the requirement AND a navigator exists')
})

// ── SPEC 4.8-21 — `Ask why` on a swap row ───────────────────────────────────────────────────────

test('H:ask-why-never-names-the-raw-list-enum: the question says "Skills 1", never "skills_1"', () => {
  // THE DEFECT THIS EXISTS TO PREVENT, and it is one the prototype hands you. `evidence.jsx:233`
  // interpolates `${r.list}` — correct THERE, where the prototype's fixture holds display names.
  // In this app `swap_decision.list` is a CHECK-constrained enum (`api/.../schema.ts:567`:
  // 'skills_1','skills_2','relevant_1','relevant_2','relevant_3'), so copying the prototype's
  // sentence verbatim puts `skills_1` in front of the reader. That is the same class as
  // `assetBlocks.js:765` — the THIRD render site, which shipped `swapped · owner` on a list item
  // because a guard covered two of the three places a raw enum could reach the screen.
  //
  // The resolution is the one table: insertion.merge_field -> FIELD_LABEL (`assetGate.js:208`),
  // which already heads the field, writes the correction sentences and labels the gate drawer.
  const entries = [
    { artifactId: 'r1', type: 'resume', label: 'Resume',
      insertions: { insertions: [{ list: 'skills_1', merge_field: 'SkillsBullets1' }] } },
  ]
  const owners = listOwnersFromArtifacts(entries)
  const ask = swapAskWhy({ list: 'skills_1', from_label: 'Stakeholder management', to_label: 'Cross-functional leadership' }, owners)

  assert.equal(ask.text, 'Why did you change "Stakeholder management" in Skills 1?')
  assert.equal(ask.artifactId, 'r1', 'the question must be bound to the asset that renders the list')
  // The invariant, not the incident: NO list key may appear in a sentence a reader sees, whichever
  // one the row names.
  for (const key of ['skills_1', 'skills_2', 'relevant_1', 'relevant_2', 'relevant_3']) {
    assert.ok(!ask.text.includes(key), `the seeded question leaks the raw list enum ${key}`)
  }
  // An `added` row has no original. It still names a real label and a real field - never `-`, which
  // is what the Original column prints for it.
  const added = swapAskWhy({ list: 'skills_1', from_label: null, to_label: 'Cross-functional leadership' }, owners)
  assert.equal(added.text, 'Why did you add "Cross-functional leadership" to Skills 1?')
  // A field FIELD_LABEL does not know still resolves to the slot name, never to the list enum.
  const other = listOwnersFromArtifacts([{ artifactId: 'c1', label: 'Cover letter',
    insertions: { insertions: [{ list: 'relevant_2', merge_field: '@SomeNewSlot' }] } }])
  assert.equal(swapAskWhy({ list: 'relevant_2', from_label: 'A' }, other).text,
    'Why did you change "A" in @SomeNewSlot?')

  // ...and that fallback is DEFENSIVE ONLY, proven against the producer rather than assumed.
  // `insertions.ts:20 LIST_FIELD_TO_LIST` is the only thing that ever writes `insertion.list`, and
  // it writes it from exactly five merge fields. Every one of them must be a key FIELD_LABEL knows,
  // or a real swap row would seed a sentence ending in a bare template slot. (CLAUDE.md 0b: "can
  // the system PRODUCE your fixture?" - a guard that passes on a hand-made row the writers never
  // emit has proven nothing.)
  const producer = readFileSync(new URL('../../api/src/functions/tests/insertions.ts', import.meta.url), 'utf8')
  const block = producer.slice(producer.indexOf('LIST_FIELD_TO_LIST'))
  const fields = [...block.slice(0, block.indexOf('}')).matchAll(/^\s*(\w+):\s*'/gm)].map((m) => m[1])
  // ASSERT THE SET, NOT THE COUNT (2026-08-30). This was `fields.length === 5` and it broke the day
  // `ExpertiseBullets` legitimately joined the map. A bare count is a rubber stamp: the only repair
  // it ever invites is bumping the number, which is exactly what someone does when a field is
  // WRONGLY added or silently REMOVED. Naming the set costs the same line and says which fields.
  assert.deepEqual(fields.slice().sort(),
    ['ExpertiseBullets', 'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3',
     'SkillsBullets1', 'SkillsBullets2'],
    'the producer map did not parse, or its fields changed - re-read insertions.ts before trusting this')
  for (const f of fields) {
    assert.notEqual(FIELD_LABEL[f], undefined,
      `insertion.list can be written for ${f}, but FIELD_LABEL does not name it - the question would end in a raw slot`)
  }
})

test('H:ask-why-is-null-unless-it-has-an-artifact-to-be-about', () => {
  // NO DEAD UI, and here it is also a hard requirement rather than a preference: `seedAssistant`
  // (`PacketBuilder.jsx:765`) returns early without an artifactId — "never open a panel that cannot
  // send", because `canSend` (`assistantPanel.js:116`) needs one. A swap row is PACKET-level and
  // carries no artifact at all (`swap_decision` has no artifact_id column), so a row the map cannot
  // place would render a button whose click does nothing whatsoever.
  const owners = listOwnersFromArtifacts([{ artifactId: 'r1', label: 'Resume',
    insertions: { insertions: [{ list: 'skills_1', merge_field: 'SkillsBullets1' }] } }])
  // a list NO artifact renders
  assert.equal(swapAskWhy({ list: 'relevant_3', from_label: 'A' }, owners), null)
  // insertions not loaded yet — the map is {} by contract, not partial
  assert.equal(swapAskWhy({ list: 'skills_1', from_label: 'A' }, {}), null)
  assert.equal(swapAskWhy({ list: 'skills_1', from_label: 'A' }, null), null)
  // a row naming nothing a question could be about
  assert.equal(swapAskWhy({ list: 'skills_1', from_label: null, to_label: null }, owners), null)
  assert.equal(swapAskWhy({ list: 'skills_1', from_label: '  ', to_label: '' }, owners), null)
  // no list, no swap
  assert.equal(swapAskWhy({ from_label: 'A' }, owners), null)
  assert.equal(swapAskWhy(null, owners), null)
})

test('H:ask-why-seeds-the-panel-and-sends-nothing', () => {
  // The whole row is a SPEC 4.11 substitution wearing a 4.8 name: the prototype's `onAsk` is the
  // assistant-panel SEED and nothing else (`AC-packet-ui-final.md` §2f). A seeder that sends is a
  // second edit path wearing a different name (`assistantPanel.js:74`), so the wiring is asserted
  // structurally — a pure function cannot see whether the component calls `api.` next to it.
  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  const pb = stripComments(readSrc('screens/PacketBuilder.jsx'))

  // 1. The sentence and the binding come from the module. The .jsx composes neither.
  assert.match(jsx, /swapAskWhy\(s,\s*owners\)/, 'the row must ask the module for the question')
  assert.ok(!/Why did you (change|add)/.test(jsx),
    'the question is hand-typed in the component - it must come from swapAskWhy, or the enum rule has two homes')

  // 2. Rendered ONLY behind the null check. Dropping it is exactly the dead button the case above
  //    proves swapAskWhy refuses to describe.
  assert.match(jsx, /\{ask && \(/, 'the button must render only when the question has a target')
  assert.match(jsx, /data-qc=\{QC_HOOKS\.askWhy\}/)

  // 3. It seeds. It does not send, and it does not mutate the swap.
  assert.match(jsx, /onClick=\{\(\)\s*=>\s*onAsk\(ask\.text,\s*ask\.artifactId\)\}/,
    'the click must hand the sentence AND its artifact to the seeder')
  const cell = jsx.slice(jsx.indexOf('QC_HOOKS.askWhy'))
  assert.ok(!/api\./.test(cell.slice(0, 400)), 'Ask why must call no route - there is none, and it seeds rather than acts')

  // 4. WHAT AC 34 ACTUALLY FORBADE, restated. This clause used to read `!/>Undo this</` - "no
  //    per-swap undo may ship". That is not AC 34's condition and the two are not the same claim:
  //    AC 34 forbids a swap-revert MUTATION, and the prototype's own `Undo this`
  //    (`docs/qc-evidence/qc/evidence.jsx:232`) calls `onAsk(...)` - the identical seeder its
  //    `Ask why` neighbour on `:233` calls. Banning the CONTROL because one implementation of it
  //    would need a route it cannot have is reading a constraint on a use as the absence of the
  //    thing, which is the exact error `CLAUDE.md`'s feasibility rule names. The owner decided to
  //    keep both. So the invariant is enforced where it lives - on the mutation - and it is
  //    enforced HARDER than the old line, which said nothing about routes at all.
  assert.match(jsx, /data-qc=\{QC_HOOKS\.undoSwap\}/, 'SPEC 4.8-20 - the undo control must render')
  const undoCell = jsx.slice(jsx.indexOf('QC_HOOKS.undoSwap'))
  assert.ok(!/api\./.test(undoCell.slice(0, 400)),
    'Undo this must call no route - AC 34 forbids a swap-revert mutation, and appSwaps.ts is GET-only')
  assert.match(jsx, /onClick=\{\(\)\s*=>\s*onAsk\(undo\.text,\s*undo\.artifactId\)\}/,
    'it must seed the same panel Ask why seeds, handing over the sentence AND its artifact')
  // The sentence is the module's, exactly as clause 1 requires of Ask why.
  assert.ok(!/Undo the swap of|Undo adding|it was dropped and I would rather/.test(jsx),
    'the undo sentence is hand-typed in the component - it must come from swapUndo')

  // 4b. THE MUTATION ITSELF, checked at the client's one door to the API. If a swap-revert call is
  //     ever added to api.js, AC 34's real condition has changed and this must be re-decided rather
  //     than discovered later on a screen.
  const apiSrc = stripComments(readSrc('api.js'))
  const swapCalls = apiSrc.match(/^[^\n]*swap[^\n]*$/gim) || []
  for (const line of swapCalls) {
    assert.ok(!/\b(post|put|patch|del)\s*\(/.test(line),
      'a swap MUTATION reached api.js - AC 34 forbids one: ' + line.trim())
  }

  // 5. Threaded from the seed slot that owns the panel, using the map 4.1-20 already derives rather
  //    than a second one.
  assert.match(jsx, /listOwnersFromArtifacts\(entries\)/)
  assert.match(jsx, /owners=\{listOwners\}\s+onAsk=\{onSeedAssistant\}/s)
  const railTag = pb.slice(pb.indexOf('<QcRail'))
  assert.match(railTag.slice(0, railTag.indexOf('/>')), /onSeedAssistant=\{seedAssistant\}/,
    'the rail must reach the SAME seed slot the asset cards use, never a second one')
})

// ── SPEC 4.8-20 — `Undo this` on a swap row ─────────────────────────────────────────────────────
//
// PREVIOUSLY MIS-CLOSED, and the miss is the lesson. The recorded objection was that no swap-revert
// MUTATION exists (`appSwaps.ts:234` registers exactly one route, `GET|OPTIONS
// app/packet/{id}/swaps`), and that objection was read as "so the control must not ship". But the
// prototype's `Undo this` (`docs/qc-evidence/qc/evidence.jsx:232`) is a SEED - it calls the same
// `onAsk(...)` its `Ask why` sibling on `:233` calls - so the route it does not have is a
// constraint on one implementation, not the absence of the control. The mutation ban is still
// enforced, in `H:ask-why-seeds-the-panel-and-sends-nothing` clauses 4 and 4b.

test('H:swap-undo-is-null-unless-it-has-an-artifact-to-be-about', () => {
  // `seedAssistant` (PacketBuilder.jsx:765) refuses a seed with no artifact - "never open a panel
  // that cannot send" - and a swap row is PACKET-level, carrying none of its own. Every path that
  // cannot reach one must return null so the component renders NO BUTTON. This is the identical
  // contract swapAskWhy keeps, asserted independently rather than assumed to be inherited.
  const owners = { skills_1: [{ id: 'a1', label: 'Resume', mergeField: 'SkillsBullets1' }] }
  const ok = swapUndo({ list: 'skills_1', action: 'swapped', from_label: 'A', to_label: 'B' }, owners)
  assert.ok(ok && ok.artifactId === 'a1', 'precondition: the happy path must produce a target')

  assert.equal(swapUndo({ list: 'relevant_3', action: 'swapped', from_label: 'A' }, owners), null,
    'a list no artifact renders has nothing to seed')
  assert.equal(swapUndo({ list: 'skills_1', action: 'swapped', from_label: 'A' }, {}), null,
    'insertions not loaded yet - the map is empty, so there is no artifact')
  assert.equal(swapUndo({ list: 'skills_1', action: 'swapped', from_label: 'A' }, null), null)
  assert.equal(swapUndo({ action: 'swapped', from_label: 'A' }, owners), null, 'a row with no list')
  assert.equal(swapUndo({ list: 'skills_1', action: 'swapped', from_label: null, to_label: null }, owners), null,
    'a row naming neither side describes nothing a request could act on')
  assert.equal(swapUndo({ list: 'skills_1', action: 'swapped', from_label: '  ', to_label: '' }, owners), null,
    'whitespace is not a name')
  assert.equal(swapUndo(null, owners), null)
  // An owner entry with no id cannot be bound to, and must not be treated as a target.
  assert.equal(swapUndo({ list: 'skills_1', action: 'swapped', from_label: 'A' }, { skills_1: [{ label: 'Resume' }] }), null)
})

test('H:swap-undo-refuses-a-kept-row-where-ask-why-does-not', () => {
  // THE ONE REFUSAL THE TWO CONTROLS DO NOT SHARE, and the reason they need separate hooks. A
  // `kept` row is the tailoring pass deciding to change nothing. There is no change to undo, so an
  // undo there would send a request about an event that never happened - dead in the strictest
  // sense. Why something was LEFT ALONE is still a real question, so `Ask why` must survive on the
  // same row; a shared refusal would have deleted it.
  const owners = { skills_1: [{ id: 'a1', label: 'Resume', mergeField: 'SkillsBullets1' }] }
  const kept = { list: 'skills_1', action: 'kept', from_label: 'A', to_label: 'A' }
  assert.equal(swapUndo(kept, owners), null, 'a kept row offered an undo for a change never made')
  assert.ok(swapAskWhy(kept, owners), 'and Ask why must NOT have been taken down with it')
})

test('H:swap-undo-never-names-the-raw-list-enum', () => {
  // `swap_decision.list` is a CHECK-constrained enum (`schema.ts:567`), not copy. The prototype
  // interpolates it because there it is a display name. Here it must be resolved through the
  // insertion row's merge_field to FIELD_LABEL, the same table that heads the field and writes the
  // correction sentences - so `skills_1` reaches the reader as "Skills 1".
  const owners = { skills_1: [{ id: 'a1', label: 'Resume', mergeField: 'SkillsBullets1' }] }
  for (const swap of [
    { list: 'skills_1', action: 'swapped', from_label: 'A', to_label: 'B' },
    { list: 'skills_1', action: 'dropped', from_label: 'A' },
    { list: 'skills_1', action: 'added', to_label: 'B' },
  ]) {
    const u = swapUndo(swap, owners)
    assert.ok(u, 'precondition: ' + swap.action + ' must produce a request')
    assert.ok(!u.text.includes('skills_1'), 'the raw enum reached the reader: ' + u.text)
    assert.ok(u.text.includes('Skills 1'), 'the field was not resolved through FIELD_LABEL: ' + u.text)
  }
  // No merge field on the insertion row - the ASSET label carries the sentence. The enum is never
  // the fallback, which is the case that would otherwise leak it.
  const noField = swapUndo({ list: 'skills_1', action: 'dropped', from_label: 'A' },
    { skills_1: [{ id: 'a1', label: 'Compact resume' }] })
  assert.ok(noField && noField.text.includes('Compact resume'))
  assert.ok(!noField.text.includes('skills_1'))
})

test('H:swap-undo-says-what-actually-happened-on-each-action', () => {
  // THREE ACTIONS, THREE ASKS. One wording cannot serve all three: a drop has no replacement to
  // name and an add has no original to restore, so "Undo the swap of X for Y" would describe a
  // change that did not happen on two of the three - a seeded request the reader then has to
  // correct by hand, which is worse than no seed.
  const owners = { skills_1: [{ id: 'a1', label: 'Resume', mergeField: 'SkillsBullets1' }] }
  const swapped = swapUndo({ list: 'skills_1', action: 'swapped', from_label: 'A', to_label: 'B' }, owners)
  const dropped = swapUndo({ list: 'skills_1', action: 'dropped', from_label: 'A' }, owners)
  const added = swapUndo({ list: 'skills_1', action: 'added', to_label: 'B' }, owners)
  assert.ok(swapped.text.includes('"A"') && swapped.text.includes('"B"'), 'a swap names BOTH sides')
  assert.ok(dropped.text.includes('"A"') && !dropped.text.includes('"B"'), 'a drop has no replacement to name')
  assert.ok(added.text.includes('"B"') && !added.text.includes('"A"'), 'an add has no original to restore')
  assert.equal(new Set([swapped.text, dropped.text, added.text]).size, 3,
    'two actions produced the same sentence, so one of them is describing the wrong event')

  // THESE FOUR WERE ADDED AFTER A MUTATION SURVIVED. Collapsing the three branches to the swap
  // wording alone still passed everything above it: with `to_label` absent the template renders
  // `Undo the swap of "A" for "" in Skills 1`, which contains "A", does not contain "B", and is
  // still distinct from its siblings - three assertions satisfied by a sentence with a hole in it
  // that misnames a drop as a swap. An EMPTY QUOTED PAIR is the tell, and so is the verb.
  for (const [action, u] of [['dropped', dropped], ['added', added]]) {
    assert.ok(!u.text.includes('""'),
      'the ' + action + ' sentence has an empty quoted slot - a template is being used for an event it does not fit: ' + u.text)
    assert.ok(!/\bswap\b/i.test(u.text),
      'a ' + action + ' row is not a swap and must not be described as one: ' + u.text)
  }
  assert.match(swapped.text, /\bswap\b/i, 'and the swap row must still say what it was')
})

// ── SPEC 4.8-11 — attention ordering: fail -> open -> warn -> fixed -> soft ──────────────────────

test('H:attention-order-has-one-home-and-severityWeight-reads-it', () => {
  // The order is a CLAIM ABOUT SEVERITY and it is stated once. A second literal list at a sort site
  // is how the Checks tab and the "Needs a decision" list come to present the same findings in two
  // different orders - the shape this repo names as fixing one consumer and missing the others.
  assert.deepEqual(ATTENTION_ORDER, ['fix', 'open', 'review', 'fixed', 'soft'],
    'the design order (SPEC 4.8-11) changed - if that is deliberate, every consumer moves with it')

  // The weight is DERIVED, proven by agreement across the whole vocabulary rather than by reading
  // the implementation: a lower rank must always weigh more.
  const rowFor = { fix: { engine: 'deterministic', state: 'fail' },
    review: { engine: 'deterministic', state: 'warn' },
    soft: { engine: 'reviewer', state: 'fail' } }
  for (const [a, b] of [['fix', 'review'], ['review', 'soft'], ['fix', 'soft']]) {
    assert.ok(attentionRank(a) < attentionRank(b), 'precondition: ' + a + ' ranks before ' + b)
    assert.ok(severityWeight(rowFor[a]) > severityWeight(rowFor[b]),
      'weight disagrees with rank for ' + a + ' vs ' + b + ' - two orderings exist')
  }
})

test('H:reviewer-warn-outranks-reviewer-fail: the ordering defect 4.8-11 names', () => {
  // THE ACTUAL BUG. The old severityWeight sorted on `state` first and consulted `engine` only to
  // break the tie, so a reviewer `fail` (50) beat a reviewer `warn` (40). Through severityFor those
  // are `soft` ("Your call") and `review` ("Review") - opposite ends of the design's order. So an
  // opinion the gate may NEVER act on (D6) sorted above a finding actually asking for a decision.
  const revFail = { engine: 'reviewer', state: 'fail', check_key: 'rf' }
  const revWarn = { engine: 'reviewer', state: 'warn', check_key: 'rw' }
  assert.equal(severityFor(revFail), 'soft')
  assert.equal(severityFor(revWarn), 'review')
  assert.ok(severityWeight(revWarn) > severityWeight(revFail),
    'a reviewer fail outranks a reviewer warn - the 4.8-11 inversion is back')
  assert.deepEqual(bySeverity([revFail, revWarn]).map((r) => r.check_key), ['rw', 'rf'])
  // And D6's own floor still holds in the same breath: a reviewer fail never reaches a measured one.
  assert.ok(severityWeight({ engine: 'deterministic', state: 'fail' }) > severityWeight(revFail))
})

test('H:unknown-severity-is-surfaced-never-dropped', () => {
  // A sort keyed on `indexOf` returns -1 for an unrecognised key, and a caller that reads the miss
  // as "no severity" DELETES the row - which is how a finding nobody has a label for disappears
  // from the one list that exists to show it. It sorts to the TOP instead, following bandTone's
  // stance twenty lines away: an unrecognised verdict is not permission.
  assert.equal(attentionRank('a-severity-nobody-has-defined'), -1)
  assert.ok(attentionRank('a-severity-nobody-has-defined') < attentionRank('fix'),
    'an unknown severity must sort somewhere EXPLICIT and visible')
  // A pass and a not_applicable are the ABSENCE of a severity, not an unknown one, and must not be
  // dragged to the top with it.
  assert.ok(attentionRank(null) > attentionRank('soft'), 'no severity is not an unknown severity')
  assert.equal(severityWeight({ state: 'pass' }), 0)
  assert.ok(severityWeight({ state: 'not_applicable' }) > severityWeight({ state: 'pass' }),
    'an unanswered question outranks a settled one')
})

test('H:decisions-are-ordered-by-severity-not-by-engine', () => {
  // `railDecisions` built its rows with a hand-rolled nest - engine outermost, then fail/warn -
  // which was a THIRD ordering of the same rows, free to disagree with bySeverity above it and with
  // the drawer. It produced det-fail, det-warn, rev-fail, rev-warn: the 4.8-11 inversion again.
  const entries = [{
    artifact: { id: 'a1' }, artifactId: 'a1', label: 'Resume',
    result: { gate: 'warn', attention: 3, engines: {
      deterministic: { results: [{ check_key: 'dw', state: 'warn', engine: 'deterministic' }] },
      reviewer: { results: [
        { check_key: 'rf', state: 'fail', engine: 'reviewer' },
        { check_key: 'rw', state: 'warn', engine: 'reviewer' },
      ] },
    } },
  }]
  const rows = railDecisions(entries).assets[0].rows
  assert.deepEqual(rows.map((r) => r.row.check_key), ['dw', 'rw', 'rf'],
    'the reviewer fail (soft) sorted above a warn (review)')
  // Ordered by the SHARED rank, proven by agreement rather than by re-reading the implementation.
  const ranks = rows.map((r) => attentionRank(severityFor(r.row)))
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'the list is not in attentionRank order')
  // Every row still carries the severity it was sorted by, so the DOM can be checked against it.
  assert.deepEqual(rows.map((r) => r.sev), ['review', 'review', 'soft'])
  // And `kind` still answers the OTHER question - which counter the row belongs to (D6).
  assert.deepEqual(rows.map((r) => r.kind), ['fix', 'review', 'review'])
})

// ── SPEC 4.4-14 — the gate count deep-links `n to fix -> <title>` ────────────────────────────────

test('H:fail-list-field-is-resolved-from-the-offenders-not-a-two-key-map', () => {
  // THE DEFECT RENDER-SWEEP.md MEASURED. `mergeField` was `CHECK_SUBJECT_FIELD[check_key] || null`,
  // and that map holds exactly TWO keys. So every real resume finding produced a null field,
  // firstFixTarget returned null for the whole asset, and PacketBuilder passed
  // `onClick={undefined}` - a badge reading "70 to fix" with `cursor: "default"` whose click moved
  // nothing. The handler was wired the whole time; the TARGET could never be produced.
  // THE FIXTURES ARE THE ENGINE'S OWN OFFENDER SHAPES, read out of
  // `api/src/functions/tests/checks.ts`, because a fixture the producer cannot emit proves nothing
  // about the producer:
  //   relevant_char_limit  `:435`  `${f}: ${i} (${i.length})`
  //   word_counts          `:621`  `${f}: ${w} words (want ${lo}-${hi})`
  //   empty_merge_fields   `:600`  the bare field name
  // The first draft of this test used `skill_char_limit` with a `SkillsBullets1:` prefix and that
  // shape DOES NOT EXIST: `:350` emits `${s} (${s.length})` - the skill text and its length, no
  // field - because `skills` is flattened across SkillsBullets1 and 2 (`:343`) and the check
  // genuinely cannot say which one an over-long item came from. So that check correctly resolves to
  // NO field and is not evidence either way; these three are.
  const entries = [{
    artifactId: 'a1', type: 'resume',
    result: { gate: 'fail', results: [
      { check_key: 'relevant_char_limit', state: 'fail', engine: 'deterministic', observed: 'x',
        offenders: ['RelevantBullets1: led the platform rebuild end to end (44)'] },
    ] },
  }]
  assert.equal(packetFailList(entries).items[0].mergeField, 'RelevantBullets1',
    'a real failing resume check still resolves to no field')
  assert.deepEqual(firstFixTarget(entries, 'a1'), { artifactId: 'a1', mergeField: 'RelevantBullets1' },
    'so the badge has nowhere to send the reader and renders inert')
  // The other two producers, so this rests on the CLASS of offender rather than on one check.
  assert.equal(firstOffenderField({ check_key: 'word_counts',
    offenders: ['@AboutMe1_50words: 61 words (want 45-55)'] }), '@AboutMe1_50words')
  assert.equal(firstOffenderField({ check_key: 'empty_merge_fields',
    offenders: ['SkillsBullets2'] }), 'SkillsBullets2')
  // And the check that honestly names no field stays unresolved rather than being guessed at.
  assert.equal(firstOffenderField({ check_key: 'skill_char_limit',
    offenders: ['stakeholder management and delivery (38)'] }), null,
  'skill_char_limit offenders carry no field prefix - resolving one would be a guess')

  // The refusals of `sectionIdForOffender` are INHERITED, not re-decided: an offender naming two
  // fields is a finding ABOUT the relationship between them, and one naming none names none.
  assert.equal(firstOffenderField({ check_key: 'cross_list_redundancy',
    offenders: ['item (SkillsBullets1 + SkillsBullets2)'] }), null, 'a two-field offender was picked apart')
  assert.equal(firstOffenderField({ check_key: 'must_have_coverage', offenders: ['#3 something'] }), null)
  assert.equal(firstOffenderField({ check_key: 'x', offenders: [] }), null)
  assert.equal(firstOffenderField(null), null)

  // And the two-key map is still the FALLBACK for a failing row that sent no offenders at all.
  const noOffenders = [{ artifactId: 'a2', type: 'cover',
    result: { gate: 'fail', results: [{ check_key: 'company_named', state: 'fail', engine: 'deterministic', offenders: [] }] } }]
  assert.equal(packetFailList(noOffenders).items[0].mergeField, '@Company')
})

test('H:first-fix-finding-names-a-blocker-never-a-reviewer-opinion', () => {
  // SPEC 4.4-14's `<title>` half. D6: only a deterministic row can block, so a badge reading
  // "3 to fix - <a reviewer's opinion>" would name as a blocker the one row that cannot block.
  const result = { gate: 'fail', attention: 2, engines: {
    deterministic: { results: [{ check_key: 'skill_char_limit', state: 'fail', engine: 'deterministic' }] },
    reviewer: { results: [{ check_key: 'ai_tells', state: 'fail', engine: 'reviewer' }] },
  } }
  const f = firstFixFinding(result)
  assert.equal(f.check_key, 'skill_char_limit')
  assert.equal(f.title, 'Skill lines fit the template', 'the title must be the CHECK_LABEL, not the raw key')
  // A reviewer fail ALONE names nothing - there is no blocker to open.
  assert.equal(firstFixFinding({ gate: 'warn', engines: { reviewer: { results: [
    { check_key: 'ai_tells', state: 'fail', engine: 'reviewer' }] } } }), null,
  'a reviewer fail was offered as the thing to fix')
  assert.equal(firstFixFinding({ gate: 'pass', results: [] }), null, 'a clean asset named a blocker')
  assert.equal(firstFixFinding(null), null)
})

// ── SPEC 4.11-7 — Keep / Revert / Re-run QC on a recorded change ─────────────────────────────────

test('H:correction-keep-renders-a-reason-not-a-vacuous-button', () => {
  // A correction is applied BEFORE the reader sees it (R1: the change log is a record of finished
  // work), so there is no pending state for a `Keep` to move. The button would send nothing, change
  // nothing and record nothing. The rule is the repo's: a control with nothing to act on must not
  // render, and the reason renders in its place.
  for (const row of [{ undone: false }, { undone: true }]) {
    const k = keepAvailability(row)
    assert.equal(k.can, false, 'Keep became actionable - it has no route and no pending state')
    assert.ok(k.reason && k.reason.length > 20, 'a refusal with no reason teaches nothing')
  }
  assert.notEqual(keepAvailability({ undone: true }).reason, keepAvailability({ undone: false }).reason,
    'an undone change and an applied one are different states - one sentence is false for one of them')

  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  assert.match(jsx, /data-qc=\{QC_HOOKS\.correctionKeepNote\}/, 'the reason must be selectable')
  assert.ok(!/>Keep</.test(jsx), 'a Keep BUTTON shipped: it commits nothing and is worse than vacuous')
  assert.match(jsx, /keepAvailability\(row\)/, 'the sentence must come from the module, not the component')
})

test('H:correction-rerun-calls-the-real-route-and-re-reads-after-it', () => {
  // SPEC 4.11-7's third control. `Re-run QC` has a REAL route - the same `api.runArtifactChecks` the
  // gate drawer's footer calls - so unlike Keep it is a button, not a sentence. It must be followed
  // by the same re-read every other action on this row ends with, or the gate, the counts and this
  // log describe three different moments.
  const jsx = stripComments(readSrc('screens/QcRail.jsx'))
  assert.match(jsx, /data-qc=\{QC_HOOKS\.correctionRerun\}/)
  const rerun = jsx.slice(jsx.indexOf('const doRerun'), jsx.indexOf('const doAsk'))
  assert.match(rerun, /api\.runArtifactChecks\(artifactId\)/, 'it must call the SAME route the drawer footer does')
  assert.match(rerun, /await onUndid\(\)/, 'without the re-read the counts above it go stale')
  // NO ARTIFACT, NO BUTTON: a row with nothing to run the checks for has no request to make.
  assert.match(jsx, /\{artifactId && \(\s*<button[^>]*QC_HOOKS\.correctionRerun/s,
    'the control must be gated on having an artifact to run the checks for')
})

// INDEPENDENT VERIFIER — round 2. Sharper probes for the evidence_placed / gate paths and for C3.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, gateFor } from '../dist/functions/tests/checks.js'
import { verifyProposal } from '../dist/functions/tests/evidenceProposal.js'
import { buildComparison, dimensionsFor } from '../dist/functions/tests/dimensions.js'

const find = (rows, key) => rows.find(r => r.check_key === key)
const REC_TEXT = 'Reduced outages from nine hours to one across the payments platform.'

const proposed = (over = {}) => ({
  quote: 'Reduced outages from nine hours to one', source_kind: 'work_history',
  source_label: 'Work history · CTO', source_key: 'workHistory1',
  char_start: 0, char_end: 38, extra: 'reasoning', ratio: null, method: 'proposed',
  record_sha256: '', resolver_version: 2, proposal_version: 1, ...over,
})

// A document that literally repeats the requirement's words, so `covers()` is satisfied.
const RESUME_COVERS = {
  summary: 'Improved operational reliability across the platform by reducing outages from nine hours to one.',
  bullets: ['Improved operational reliability across the platform.'], skills: [], experience: [],
}

test('V2-a: evidence_placed CAN be turned to `pass` by a model-proposed row alone', () => {
  const reqs = [{ seq: 0, id: 'a', verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'must_have' }]
  const without = runChecks({ type: 'resume', pkg: RESUME_COVERS, requirements: reqs,
    evidence: { profileReadable: true, bySeq: {} } })
  const withP = runChecks({ type: 'resume', pkg: RESUME_COVERS, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: proposed() } } })
  const a = find(without, 'evidence_placed'), b = find(withP, 'evidence_placed')
  console.log('  PLACED without :', a.state, '|', a.observed)
  console.log('  PLACED with    :', b.state, '|', b.observed)
  assert.notEqual(b.state, 'pass',
    `LEAK: evidence_placed went ${a.state} -> ${b.state} because of a model proposal ("${b.observed}")`)
})

test('V2-b: the GATE — can a model proposal move an artifact from warn to pass?', () => {
  const reqs = [{ seq: 0, id: 'a', verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'responsibility' }]
  const without = runChecks({ type: 'resume', pkg: RESUME_COVERS, requirements: reqs,
    evidence: { profileReadable: true, bySeq: {} } })
  const withP = runChecks({ type: 'resume', pkg: RESUME_COVERS, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: proposed() } } })
  const gA = gateFor(without), gB = gateFor(withP)
  const diff = without.map((r, i) => [r.check_key, r.state, withP[i]?.state]).filter(([, x, y]) => x !== y)
  console.log('  gate without =', gA, ' gate with =', gB)
  console.log('  rows that changed:', JSON.stringify(diff))
  console.log('  warn/fail rows WITH proposal:', JSON.stringify(withP.filter(r => r.state !== 'pass' && r.state !== 'not_applicable').map(r => [r.check_key, r.state])))
  assert.equal(gA, gB, `LEAK: the artifact gate moved ${gA} -> ${gB} on a model proposal alone`)
})

test('V2-c: dimensions.ts buildComparison — is a proposed row counted as `evidenced`?', () => {
  // buildComparison reads r.evidence.quote and never looks at method (`dimensions.ts:439`).
  const defs = dimensionsFor(null, null).defs
  const req = {
    seq: 0, id: 'a', kind: 'must_have',
    verbatim: 'Modernize the legacy platform and retire technical debt across the estate',
    item_text: 'Modernize the legacy platform and retire technical debt across the estate',
  }
  const evRow = { quote: 'Reduced outages from nine hours to one', source_label: 'WH1', source_kind: 'work_history', ratio: null }
  const withEv = buildComparison({ requirements: [{ ...req, evidence: evRow }], profileReadable: true, facts: [], defs })
  const without = buildComparison({ requirements: [{ ...req, evidence: null }], profileReadable: true, facts: [], defs })
  const graded = rows => rows.filter(r => r.fit !== 'not_applicable').map(r => [r.key, r.fit, r.basis, r.profile && r.profile.value])
  console.log('  WITH a proposed-shaped evidence row :', JSON.stringify(graded(withEv)))
  console.log('  WITHOUT any evidence row            :', JSON.stringify(graded(without)))
  const g = graded(withEv)
  assert.ok(g.length === 0 || !g.some(x => x[1] === 'strong'),
    'LEAK: a model-proposed excerpt graded a dimension `strong` — dimensions.ts never reads `method`')
})

// --- C3 refined: only assert refusal for quotes that are genuinely NOT substrings --------------
test('V2-d: C3 refined — every genuinely-non-substring probe is refused', () => {
  const rec = { key: 'k', kind: 'work_history', label: 'L', text: REC_TEXT }
  const base = 'Reduced outages from nine hours to one'
  const probes = {
    'leading space':   ' ' + base,
    'NBSP for space':  base.replace(/ /g, ' '),
    'curly apostrophe': base.replace('outages', 'out’ages'),
    'ellipsis append': base + '…',
    'digit paraphrase': 'Reduced outages from 9 hours to 1',
    'case tidy':       base.toLowerCase(),
    'two records join': base + ' Led a governance program.',
    'zero-width space': base.replace('outages', 'out​ages'),
  }
  const bad = []
  for (const [name, q] of Object.entries(probes)) {
    const isSub = REC_TEXT.includes(q)
    const o = verifyProposal('Improve operational reliability', [rec],
      { supported: true, source_key: 'k', quote: q, reasoning: 'r' },
      { neverEvidence: new Set(), minQuoteChars: 12 })
    const verdict = o.accepted ? 'ACCEPTED' : `refused:${o.refusal}`
    console.log(`  ${name.padEnd(18)} substring=${String(isSub).padEnd(5)} -> ${verdict}`)
    if (!isSub && o.accepted) bad.push(name)
    if (o.accepted) {
      assert.equal(rec.text.slice(o.accepted.char_start, o.accepted.char_end), o.accepted.quote,
        `${name}: offsets do not re-slice to the quote`)
    }
  }
  assert.deepEqual(bad, [], 'these non-substring quotes were ACCEPTED')
})

test('V2-e: whitespace-bearing quote — trailing space IS a substring; check the DB length invariant', () => {
  const rec = { key: 'k', kind: 'work_history', label: 'L', text: REC_TEXT }
  const q = 'Reduced outages from nine hours to one '   // trailing space, genuinely present
  assert.ok(REC_TEXT.includes(q))
  const o = verifyProposal('Improve operational reliability', [rec],
    { supported: true, source_key: 'k', quote: q, reasoning: 'r' },
    { neverEvidence: new Set(), minQuoteChars: 12 })
  assert.ok(o.accepted, 'a genuinely-verbatim quote with a trailing space is byte-exact and accepted')
  assert.equal(o.accepted.char_end - o.accepted.char_start, q.length,
    'DB CHECK length(quote) = char_end - char_start')
  assert.equal(rec.text.slice(o.accepted.char_start, o.accepted.char_end), q)
  console.log('  trailing-space quote accepted, offsets consistent — byte-exactness holds')
})

test('V2-f: C3 — the model names a DIFFERENT record than the one containing the quote', () => {
  const recs = [
    { key: 'a', kind: 'work_history', label: 'A', text: 'Alpha text with a distinctive marker phrase here.' },
    { key: 'b', kind: 'work_history', label: 'B', text: 'Beta text entirely unrelated to the above.' },
  ]
  const o = verifyProposal('Improve operational reliability', recs,
    { supported: true, source_key: 'b', quote: 'a distinctive marker phrase', reasoning: 'r' },
    { neverEvidence: new Set(), minQuoteChars: 12 })
  console.log('  cross-record quote ->', o.accepted ? 'ACCEPTED' : `refused:${o.refusal}`)
  assert.equal(o.accepted, null, 'a quote from record A attributed to record B must be refused')
})

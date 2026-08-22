// INDEPENDENT VERIFIER — adversarial probes written with no shared context with the implementer.
// Not part of the product suite; deleted after the verification run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks } from '../dist/functions/tests/checks.js'
import { resolveOptionsFrom } from '../dist/functions/tests/checkPrefs.js'
import { writeEvidence } from '../dist/functions/tests/appRequirements.js'
import { verifyProposal, escalateOne, PROPOSAL_VERSION, buildProposalUser } from '../dist/functions/tests/evidenceProposal.js'
import { contentJson, openAiJson } from '../dist/functions/tests/openaiJson.js'

const find = (rows, key) => rows.find(r => r.check_key === key)

// ---------------------------------------------------------------------------------------------
// C1 — ZERO MODEL CALLS WHEN THE OWNER SWITCHED IT OFF
// ---------------------------------------------------------------------------------------------
function fakeClient(rows, failOn = null) {
  const inserts = []; const stmts = []
  return {
    inserts, stmts,
    async query(sql, params) {
      stmts.push(String(sql).trim().split('\n')[0].trim())
      if (/from requirement where opp_id/.test(sql)) return { rows }
      if (/^\s*insert into requirement_evidence/.test(sql)) {
        if (failOn && failOn(params)) throw new Error('violates check constraint "requirement_evidence_method_check"')
        inserts.push(params); return { rows: [] }
      }
      return { rows: [] }
    },
  }
}
const REC = { key: 'workHistory1', kind: 'work_history', label: 'Work history · CTO',
  text: 'Reduced outages from nine hours to one across the payments platform.' }
const REQ = 'Improve operational reliability'
const rowsOf = () => [{ id: 'r1', seq: 0, verbatim: REQ, item_text: REQ }]
const GOOD = { supported: true, source_key: 'workHistory1',
  quote: 'Reduced outages from nine hours to one',
  reasoning: 'Cutting outage duration is an improvement in operational reliability.' }
const says = obj => async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] })

test('V-C1a: chk_evidence_escalate=false -> resolveOptionsFrom gives escalate:false -> ZERO transport calls', async () => {
  const opts = resolveOptionsFrom({ evidenceEscalate: false })
  assert.equal(opts.escalate, false, 'owner said false; resolveOptionsFrom must not upgrade it')
  let calls = 0
  const spy = async (...a) => { calls++; return says(GOOD)(...a) }
  const c = fakeClient(rowsOf())
  const out = await writeEvidence(c, 'opp', [REC], opts, undefined, spy)
  assert.equal(calls, 0, 'THE CLAIM: transport must never be invoked')
  assert.equal(out.escalated, 0); assert.equal(out.proposed, 0)
  assert.equal(c.inserts.length, 0)
})

test('V-C1b: what the DB row actually yields for a false column — loadThresholds shape', () => {
  // loadThresholds maps `r.chk_evidence_escalate === true`. Simulate all three DB states.
  const fromRow = v => ({ evidenceEscalate: v === true })
  assert.equal(resolveOptionsFrom(fromRow(false)).escalate, false, 'column false -> OFF')
  assert.equal(resolveOptionsFrom(fromRow(null)).escalate, false, 'column NULL -> reads as OFF (not the seed)')
  assert.equal(resolveOptionsFrom(fromRow(true)).escalate, true, 'column true -> ON')
  assert.equal(resolveOptionsFrom({}).escalate, true, 'NO ROW at all -> seed ON')
})

// ---------------------------------------------------------------------------------------------
// C2 — CAN A PROPOSED ROW REACH A `pass` ANYWHERE?
// ---------------------------------------------------------------------------------------------
const RESUME = {
  summary: 'Reduced outages from nine hours to one across the payments platform.',
  bullets: [], skills: [], experience: [],
}
const proposed = (over = {}) => ({
  quote: 'Reduced outages from nine hours to one', source_kind: 'work_history',
  source_label: 'Work history · CTO', source_key: 'workHistory1',
  char_start: 0, char_end: 38, extra: 'reasoning', ratio: null, method: 'proposed',
  record_sha256: '', resolver_version: 2, proposal_version: 1, ...over,
})

test('V-C2a: must_have_coverage — proposed row does NOT pass (the literal claim)', () => {
  const reqs = [{ seq: 0, id: 'a', verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'must_have' }]
  const r = runChecks({ type: 'resume', pkg: RESUME, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: proposed() } } })
  const c = find(r, 'must_have_coverage')
  assert.notEqual(c.state, 'pass')
})

test('V-C2b: responsibilities_addressed — DOES a proposed row pass?', () => {
  const reqs = [{ seq: 0, id: 'a', verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'responsibility' }]
  const withNothing = runChecks({ type: 'resume', pkg: RESUME, requirements: reqs,
    evidence: { profileReadable: true, bySeq: {} } })
  const withProposed = runChecks({ type: 'resume', pkg: RESUME, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: proposed() } } })
  const a = find(withNothing, 'responsibilities_addressed')
  const b = find(withProposed, 'responsibilities_addressed')
  console.log('  RESP without evidence :', a.state, '|', a.observed)
  console.log('  RESP with proposed    :', b.state, '|', b.observed)
  assert.notEqual(b.state, 'pass',
    `LEAK: a model-proposed row turned responsibilities_addressed ${a.state} -> ${b.state} ("${b.observed}")`)
})

test('V-C2c: evidence_placed — DOES a proposed row pass?', () => {
  const reqs = [{ seq: 0, id: 'a', verbatim: 'Improve operational reliability across the platform', item_text: '', kind: 'must_have' }]
  const withNothing = runChecks({ type: 'resume', pkg: RESUME, requirements: reqs,
    evidence: { profileReadable: true, bySeq: {} } })
  const withProposed = runChecks({ type: 'resume', pkg: RESUME, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: proposed() } } })
  const a = find(withNothing, 'evidence_placed')
  const b = find(withProposed, 'evidence_placed')
  console.log('  PLACED without evidence :', a.state, '|', a.observed)
  console.log('  PLACED with proposed    :', b.state, '|', b.observed)
  assert.notEqual(b.state, 'pass',
    `LEAK: a model-proposed row turned evidence_placed ${a.state} -> ${b.state} ("${b.observed}")`)
})

// ---------------------------------------------------------------------------------------------
// C3 — CAN A NON-SUBSTRING QUOTE GET STORED?
// ---------------------------------------------------------------------------------------------
const RECS = [REC]
const V = (p) => verifyProposal(REQ, RECS, p, { neverEvidence: new Set(), minQuoteChars: 12 })

test('V-C3a: trailing whitespace / NFC-vs-NFD / homoglyph quotes are all REFUSED', () => {
  const base = 'Reduced outages from nine hours to one'
  const probes = {
    'trailing space': base + ' ',
    'leading space': ' ' + base,
    'NBSP for space': base.replace(/ /g, ' '),
    'NFD decomposed': base.normalize('NFD'),
    'curly-quote swap': base.replace('outages', 'out’ages'),
    'ellipsis join': base + '…',
  }
  for (const [name, q] of Object.entries(probes)) {
    const o = V({ ...GOOD, quote: q })
    console.log(`  ${name.padEnd(18)} ->`, o.accepted ? 'ACCEPTED' : `refused:${o.refusal}`)
    assert.equal(o.accepted, null, `${name} was ACCEPTED — non-byte-exact quote stored`)
  }
})

test('V-C3b: an accented record where NFC/NFD differ — the model returns the other normalization', () => {
  const rec = { key: 'k', kind: 'work_history', label: 'L',
    text: 'Led the Bogotá platform team and reduced incident volume sharply.' } // NFC é-style
  const nfd = 'Led the Bogotá platform team'.normalize('NFD')
  const o = verifyProposal('Improve regional operational reliability', [rec],
    { supported: true, source_key: 'k', quote: nfd, reasoning: 'x' },
    { neverEvidence: new Set(), minQuoteChars: 12 })
  console.log('  NFD-vs-NFC accented quote ->', o.accepted ? 'ACCEPTED' : `refused:${o.refusal}`)
  assert.equal(o.accepted, null)
})

test('V-C3c: the STORED quote is re-sliced from the record, and the pre-insert offset assertion holds', async () => {
  const c = fakeClient(rowsOf())
  await writeEvidence(c, 'opp', [REC], { escalate: true }, undefined, says(GOOD))
  assert.equal(c.inserts.length, 1)
  const p = c.inserts[0]
  const [, quote, , , sourceKey, start, end] = p
  assert.equal(REC.text.slice(start, end), quote, 'stored quote must be the record bytes at the offsets')
  assert.equal(end - start, quote.length, 'the DB CHECK length(quote)=char_end-char_start must hold')
})

test('V-C3d: contentJson brace salvage cannot smuggle a non-substring past verifyProposal', () => {
  // A model that wraps prose around the object, with a quote that is NOT in the record.
  const raw = { choices: [{ message: { content:
    'Sure! Here you go:\n```json\n{"supported":true,"source_key":"workHistory1","quote":"Reduced outages from 9 hours to 1","reasoning":"r"}\n```' } }] }
  const parsed = contentJson(raw)
  assert.ok(parsed && parsed.supported === true, 'salvage did parse the object')
  const o = V(parsed)
  assert.equal(o.accepted, null, 'salvaged-but-paraphrased quote must still be refused')
  assert.equal(o.refusal, 'quote_not_in_record')
})

test('V-C3e: contentJson brace salvage on nested braces — does it mangle?', () => {
  const raw = { choices: [{ message: { content:
    'note {aside} {"supported":true,"source_key":"workHistory1","quote":"Reduced outages from nine hours to one","reasoning":"r"} trailing {x}' } }] }
  const parsed = contentJson(raw)
  console.log('  nested-brace salvage ->', JSON.stringify(parsed))
  // a=first '{', b=last '}' spans the whole thing; JSON.parse fails -> null. Assert it is NOT a
  // half-parsed object that could carry a bogus quote.
  assert.ok(parsed === null || parsed.quote === 'Reduced outages from nine hours to one')
})

// ---------------------------------------------------------------------------------------------
// C4 — A TRANSPORT FAILURE MUST NEVER READ AS "THE PROFILE SUPPORTS NOTHING"
// ---------------------------------------------------------------------------------------------
test('V-C4: four failure modes, each distinct from model_declined and each leaving the row unevidenced', async () => {
  const modes = {
    thrown:      async () => { throw new Error('ECONNRESET') },
    httpError:   async () => { throw new Error('OpenAI HTTP 429: rate limited') },
    nonJsonBody: async () => ({ choices: [{ message: { content: 'I cannot answer that.' } }] }),
    emptyBody:   async () => ({}),
  }
  const seen = {}
  for (const [name, t] of Object.entries(modes)) {
    const c = fakeClient(rowsOf())
    const out = await writeEvidence(c, 'opp', [REC], { escalate: true }, undefined, t)
    seen[name] = out
    console.log(`  ${name.padEnd(12)} -> evidenced=${out.evidenced} proposed=${out.proposed} refusals=${JSON.stringify(out.escalation_refusals)}`)
    assert.equal(c.inserts.length, 0, `${name}: nothing may be written`)
    assert.equal(out.proposed, 0)
    assert.ok(!out.escalation_refusals.model_declined,
      `${name}: MUST NOT be reported as model_declined`)
  }
  // Missing OPENAI_API_KEY, through the real transport factory.
  const prev = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    const c = fakeClient(rowsOf())
    const out = await writeEvidence(c, 'opp', [REC], { escalate: true }, undefined, openAiJson({ feature: 'v' }))
    console.log('  missingKey   ->', JSON.stringify(out.escalation_refusals))
    assert.equal(c.inserts.length, 0)
    assert.ok(!out.escalation_refusals.model_declined, 'missing key must not read as model_declined')
    assert.ok(out.escalation_refusals.transport_failed >= 1, 'missing key must be transport_failed')
  } finally { if (prev !== undefined) process.env.OPENAI_API_KEY = prev }

  // And the CONTRAST: an actual model refusal is a different key.
  const c2 = fakeClient(rowsOf())
  const declined = await writeEvidence(c2, 'opp', [REC], { escalate: true }, undefined,
    says({ supported: false, source_key: '', quote: '', reasoning: '' }))
  console.log('  model_declined ->', JSON.stringify(declined.escalation_refusals))
  assert.equal(declined.escalation_refusals.model_declined, 1)
})

// ---------------------------------------------------------------------------------------------
// C5 — ONE REJECTED INSERT COSTS ONE ROW
// ---------------------------------------------------------------------------------------------
test('V-C5: a rejected proposed insert loses that row only; deterministic rows survive', async () => {
  const RECS2 = [
    REC,
    { key: 'workHistory2', kind: 'work_history', label: 'WH2',
      text: 'Led a governance program for regulated data across three business units.' },
  ]
  // seq 0 = deterministic-resolvable, seq 1 & 2 = escalation-only
  const rows = [
    { id: 'd1', seq: 0, verbatim: 'Led a governance program for regulated data', item_text: '' },
    { id: 'p1', seq: 1, verbatim: 'Improve operational reliability', item_text: '' },
    { id: 'p2', seq: 2, verbatim: 'Increase platform uptime materially', item_text: '' },
  ]
  // fail ONLY the first proposed insert (requirement_id p1)
  const c = fakeClient(rows, params => params[0] === 'p1')
  const out = await writeEvidence(c, 'opp', RECS2, { escalate: true }, undefined, says(GOOD))
  console.log('  inserts:', c.inserts.map(i => `${i[0]}/${i[9]}`).join(', '))
  console.log('  out:', JSON.stringify({ evidenced: out.evidenced, proposed: out.proposed, refused: out.refused, r: out.escalation_refusals }))
  const ids = c.inserts.map(i => i[0])
  assert.ok(ids.includes('d1'), 'the DETERMINISTIC row must survive a rejected proposed insert')
  assert.ok(ids.includes('p2'), 'a LATER proposed insert must still be attempted and succeed')
  assert.ok(!ids.includes('p1'), 'the rejected row is not stored')
  assert.equal(out.escalation_refusals.insert_rejected, 1)
  // savepoint discipline: each proposed insert must be its own transaction
  const begins = c.stmts.filter(s => /^begin/i.test(s)).length
  const commits = c.stmts.filter(s => /^commit/i.test(s)).length
  const rollbacks = c.stmts.filter(s => /^rollback/i.test(s)).length
  console.log(`  begin=${begins} commit=${commits} rollback=${rollbacks}`)
  assert.ok(begins >= 3, 'deterministic txn + one per proposed insert')
})

// ---------------------------------------------------------------------------------------------
// C1-extra — the ROUTE-level wiring: does evidenceResolve pass a transport when off?
// ---------------------------------------------------------------------------------------------
test('V-C1c: escalateOne itself makes no call when the requirement is not worth escalating', async () => {
  let calls = 0
  const spy = async () => { calls++; return says(GOOD)() }
  const o = await escalateOne('US citizen', RECS, {
    fetchJson: spy, neverEvidence: new Set(), minQuoteChars: 12, minTokens: 2, resolverVersion: 2 })
  assert.equal(o.kind, 'skipped')
  assert.equal(calls, 0)
})

test('V-C2d: a banned record never reaches the prompt AND is refused if named anyway', () => {
  const banned = new Set(['workHistory1'])
  const prompt = buildProposalUser(REQ, RECS, banned)
  assert.ok(!prompt.includes('Reduced outages'), 'banned record text must not be rendered')
  const o = verifyProposal(REQ, RECS, GOOD, { neverEvidence: banned, minQuoteChars: 12 })
  assert.equal(o.refusal, 'banned_source')
})

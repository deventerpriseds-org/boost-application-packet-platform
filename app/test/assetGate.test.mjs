// Unit tests for the per-asset gate drawer's pure logic (app/src/assetGate.js).
// Node 22's built-in runner, no DOM, no new dependency — the same constraint overlay.test.mjs and
// api/ work under.
//   cd app && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  footerFor, reconcile, reviewerAttention, attentionSplit, engineRows, scoreParts,
  gateMeta, stateMeta, checkLabel, fieldLabel, assetLabel, STATE_META,
  SEV_LABEL, severityFor, severityMeta, CHANGE_LOG_HEADLINE, METHOD_LABEL, correctionSentence, severityCounts
} from '../src/assetGate.js'

// The two payloads a verifier reproduced the AC3 defects with. They are shared by the tests below
// so the numbers being asserted are the ones that were actually rendered wrong on screen.
//   A: the server counted ONE finding but sent THREE reviewer rows. `attention - reviewerRows`
//      rendered "-2 from the measured rules".
//   B: the server counted FOUR but sent two deterministic findings. The drawer summary said the
//      rules side was 4 while the Checks tab, filtering the same rows, said 2.
const FEWER_COUNTED_THAN_SENT = {
  gate: 'warn', attention: 1,
  results: [
    { check_key: 'a', state: 'warn', engine: 'reviewer' },
    { check_key: 'b', state: 'warn', engine: 'reviewer' },
    { check_key: 'c', state: 'warn', engine: 'reviewer' },
  ],
}
const MORE_COUNTED_THAN_SENT = {
  gate: 'warn', attention: 4,
  results: [
    { check_key: 'a', state: 'fail', engine: 'deterministic' },
    { check_key: 'b', state: 'warn', engine: 'deterministic' },
    { check_key: 'c', state: 'pass', engine: 'deterministic' },
  ],
}

test('the footer follows the SERVER gate, and never invents permission', () => {
  // No payload and "never checked" are BOTH blocking. The absence of a verdict is not a pass:
  // approvalBlock() in api/src/functions/tests/appChecks.ts returns
  // "no checks have been run for this artifact" for a missing artifact_gate row, and the UI must
  // agree with it rather than offering a button the server will 409.
  assert.equal(footerFor(null).disabled, true)
  assert.equal(footerFor(undefined).disabled, true)
  const unchecked = footerFor({ gate: null, attention: 0 })
  assert.equal(unchecked.kind, 'unchecked')
  assert.equal(unchecked.disabled, true)
  assert.match(unchecked.reason, /no checks have been run/)

  const pass = footerFor({ gate: 'pass', attention: 0 })
  assert.equal(pass.kind, 'pass')
  assert.equal(pass.label, 'Approve')
  assert.equal(pass.disabled, false)
  assert.equal(pass.needsReason, undefined)
})

test('a fail is disabled AND carries the reason; it can never become an override', () => {
  const f = footerFor({ gate: 'fail', attention: 3 })
  assert.equal(f.disabled, true)
  assert.equal(f.needsReason, undefined, 'a fail must never offer the exception path (409 server-side)')
  assert.match(f.reason, /3 blocking finding\(s\)/)
  assert.match(f.reason, /cannot be overridden/)
  assert.notEqual(f.reason, '', 'a disabled action with no reason is a dead end')
})

test('a warn asks for a reason first, and stops asking once one is recorded', () => {
  const needs = footerFor({ gate: 'warn', attention: 2, override: null })
  assert.equal(needs.needsReason, true)
  assert.equal(needs.disabled, false)
  assert.equal(needs.label, 'Approve with exceptions')
  assert.match(needs.reason, /2 finding\(s\) need an explicit override with a reason/)

  const done = footerFor({ gate: 'warn', attention: 2, override: { by: 'von.ellis@enterpriseds.io', at: '2026-08-20T00:00:00Z', reason: 'client accepted the shorter summary' } })
  assert.equal(done.needsReason, undefined)
  assert.equal(done.disabled, false)
  assert.match(done.reason, /von\.ellis@enterpriseds\.io accepted these findings/)
  assert.match(done.reason, /client accepted the shorter summary/)
})

test('P8.5-AC2: a gate that disagrees with its own findings is REPORTED, not smoothed over', () => {
  // The reference prototype computes its badge from ATTENTION (non-pass checks + open items + loose
  // terms + mirrors, qc/data.js:641) while gateFor() reads CHECKS alone (:548), so it can render
  // gate `pass` beside a badge saying "1 to fix". Here the badge and the gate come from ONE payload,
  // so this can only fire on a genuine server-side contradiction — and it must fire loudly.
  assert.equal(reconcile({ gate: 'pass', attention: 0, results: [{ state: 'pass', engine: 'deterministic' }] }), null)

  const green_but_dirty = reconcile({ gate: 'pass', attention: 1, results: [{ state: 'warn', engine: 'deterministic' }] })
  assert.ok(green_but_dirty, 'pass beside a non-zero count must never render silently')
  assert.ok(green_but_dirty.some((p) => /gate reads pass while 1 finding/.test(p)))

  const miscount = reconcile({ gate: 'warn', attention: 4, results: [{ state: 'warn', engine: 'deterministic' }] })
  assert.ok(miscount.some((p) => /counted 4 finding\(s\).*sent 1 such row/.test(p)),
    'the badge count and the listed rows must be the same set')
})

test('D6: only the deterministic rules may produce a fail', () => {
  const reviewerOnly = reconcile({ gate: 'fail', attention: 1, results: [{ state: 'fail', engine: 'reviewer' }] })
  assert.ok(reviewerOnly && reviewerOnly.some((p) => /may never block an asset on its own/.test(p)))
  // A deterministic fail is the legitimate way to reach `fail` — no complaint.
  assert.equal(reconcile({ gate: 'fail', attention: 1, results: [{ state: 'fail', engine: 'deterministic' }] }), null)
  // A reviewer fail alongside a warn gate is exactly D6 working; nothing to report.
  assert.equal(reconcile({ gate: 'warn', attention: 1, results: [{ state: 'fail', engine: 'reviewer' }] }), null)
})

test('the badge count splits into rules + reviewer without losing a finding', () => {
  const result = {
    gate: 'warn', attention: 3,
    results: [
      { state: 'fail', engine: 'deterministic' },
      { state: 'warn', engine: 'deterministic' },
      { state: 'fail', engine: 'reviewer' },
      { state: 'pass', engine: 'deterministic' },
      { state: 'not_applicable', engine: 'deterministic' },
    ],
  }
  assert.equal(reconcile(result), null, 'this payload is self-consistent')
  const s = attentionSplit(result)
  // Each half is COUNTED from its own rows, so the two halves and their total are one arithmetic
  // fact about the payload rather than three independent derivations.
  assert.deepEqual(s, { fix: 2, review: 1, listed: 3, counted: 3 })
  assert.equal(reviewerAttention(result), 1, 'the old helper must be the same number, not a second one')
})

test('AC3 defect 1a: a finding count can never render negative', () => {
  // The rendered bug: attention(1) - reviewerRows(3) = -2 shown as "from the measured rules".
  // The previous assertion here was `(attention - rev) + rev === attention`, which is true of every
  // pair of numbers — it passes on THIS payload while the screen shows -2. It could not fail.
  const s = attentionSplit(FEWER_COUNTED_THAN_SENT)
  assert.equal(s.fix, 0, 'no deterministic row needs attention, so the rules side is 0 - never -2')
  assert.equal(s.review, 3)
  assert.equal(s.listed, 3)
  assert.equal(s.counted, 1, "the server's own number is carried, not mixed into the split")
  assert.ok(s.fix >= 0 && s.review >= 0 && s.listed >= 0, 'a count of findings is never negative')
  // The disagreement is REPORTED rather than absorbed into a negative number.
  const problems = reconcile(FEWER_COUNTED_THAN_SENT)
  assert.ok(problems && problems.some((p) => /counted 1 finding\(s\).*sent 3 such row/.test(p)))
})

test('AC3 defect 1b: the rules side has ONE value, not one per surface', () => {
  // The drawer summary derived it as attention - reviewerRows (4) while the Checks tab filtered the
  // rows (2). Both now read attentionSplit(), so there is one number to be right or wrong about.
  const s = attentionSplit(MORE_COUNTED_THAN_SENT)
  assert.equal(s.fix, 2, 'two deterministic rows need attention; the pass row does not')
  assert.equal(s.review, 0)
  assert.equal(s.listed, 2)
  assert.equal(s.counted, 4)
  assert.notEqual(s.fix, s.counted, 'this payload is exactly the case where the two would diverge')
  assert.ok(reconcile(MORE_COUNTED_THAN_SENT).some((p) => /counted 4 finding\(s\).*sent 2 such row/.test(p)))
})

test('the split holds as an invariant across every payload shape, not just the two reproductions', () => {
  const states = ['pass', 'warn', 'fail', 'not_applicable']
  const engines = ['deterministic', 'reviewer']
  const payloads = []
  for (const attention of [0, 1, 4, 99]) {
    for (const s1 of states) for (const s2 of states) for (const e1 of engines) for (const e2 of engines) {
      payloads.push({ gate: 'warn', attention, results: [{ state: s1, engine: e1 }, { state: s2, engine: e2 }] })
    }
  }
  payloads.push({ gate: 'warn', attention: 2, results: [] })
  payloads.push({ gate: 'warn', attention: 2 })            // no results key at all
  payloads.push({ gate: 'warn', attention: 2, results: null })
  payloads.push(null)
  payloads.push(undefined)
  for (const p of payloads) {
    const s = attentionSplit(p)
    assert.ok(s.fix >= 0, 'fix went negative for ' + JSON.stringify(p))
    assert.ok(s.review >= 0, 'review went negative for ' + JSON.stringify(p))
    assert.equal(s.fix + s.review, s.listed, 'the halves must sum to the total for ' + JSON.stringify(p))
    assert.ok(Number.isInteger(s.listed), 'a finding count is a whole number')
  }
})

test('AC18: the client reads the engine grouping the SERVER sent, and only partitions when there is none', () => {
  // P4.2 added engines.{deterministic,reviewer}.results to GET /artifact/{id}/checks-result. Where
  // the server has grouped the rows, re-filtering them client-side is a second opinion about which
  // engine owns a row — which is how one screen shows a model's critique as a measured rule.
  // The rows below are deliberately grouped AGAINST what a client-side `engine` filter would say,
  // so a test that silently kept filtering cannot pass this.
  const grouped = {
    gate: 'warn', attention: 2,
    results: [
      { check_key: 'a', state: 'warn', engine: 'deterministic' },
      { check_key: 'b', state: 'warn', engine: 'reviewer' },
    ],
    engines: {
      deterministic: { decides: 'pass/warn/fail', results: [{ check_key: 'b', state: 'warn', engine: 'reviewer' }] },
      reviewer: { decides: 'warn at most', results: [{ check_key: 'a', state: 'warn', engine: 'deterministic' }], verdict: null },
    },
  }
  assert.deepEqual(engineRows(grouped, 'deterministic').map((r) => r.check_key), ['b'],
    'the server grouping wins over the row-level engine field')
  assert.deepEqual(engineRows(grouped, 'reviewer').map((r) => r.check_key), ['a'])

  // Fallback: a server that predates P4 sends no `engines` key, and the flat list is partitioned.
  const flat = {
    gate: 'warn', attention: 2,
    results: [
      { check_key: 'a', state: 'warn', engine: 'deterministic' },
      { check_key: 'b', state: 'warn', engine: 'reviewer' },
      { check_key: 'c', state: 'fail', engine: 'some_engine_added_later' },
    ],
  }
  assert.deepEqual(engineRows(flat, 'reviewer').map((r) => r.check_key), ['b'])
  assert.deepEqual(engineRows(flat, 'deterministic').map((r) => r.check_key), ['a', 'c'],
    'an unknown engine still shows on one tab rather than vanishing from both')
  assert.equal(attentionSplit(flat).listed, 3, 'no row may be dropped by the partition')

  // A malformed engines block (present but not an array) falls back rather than rendering nothing.
  const broken = { gate: 'warn', attention: 1, results: [{ check_key: 'a', state: 'warn', engine: 'reviewer' }], engines: { reviewer: { results: null } } }
  assert.deepEqual(engineRows(broken, 'reviewer').map((r) => r.check_key), ['a'])
})

test('no surface re-derives the split inline — the drawer reads the selector and nothing else', () => {
  // Structural, because it is a rule about WHERE a number comes from: three surfaces (badge,
  // summary line, Checks tab) each computing their own version is the defect, and only source can
  // show that they do not. Comments are stripped so the prose explaining the old bug cannot trip it.
  const src = readFileSync(new URL('../src/screens/AssetGateDrawer.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/attention[^\n]*[-+]\s*reviewer/i.test(src),
    'the rules side must not be derived by subtracting the reviewer count from attention')
  assert.ok(!/\.filter\(\s*\(?\s*r\s*\)?\s*=>\s*r\.engine/.test(src),
    'the drawer must not partition rows by engine itself — engineRows() reads the server grouping')
  assert.ok(/attentionSplit\(/.test(src) && /engineRows\(/.test(src), 'it must actually call the selectors')
})

test('not_applicable is its own state and is never dressed as a pass', () => {
  assert.notEqual(stateMeta('not_applicable').tone, stateMeta('pass').tone)
  assert.equal(stateMeta('not_applicable').tone, 'panel')
  assert.match(stateMeta('not_applicable').label, /not checked/i)
  assert.ok(!/clear/i.test(stateMeta('not_applicable').label), 'must not read as clear')
  // Every state the engine can emit has an entry; an unknown one degrades to grey, never to green.
  for (const s of ['pass', 'warn', 'fail', 'not_applicable']) assert.ok(STATE_META[s])
  assert.equal(stateMeta('something_new').tone, 'panel')
})

test('a missing gate reads as "not checked", never as clear', () => {
  assert.equal(gateMeta(null).word, 'Not checked')
  assert.equal(gateMeta(undefined).tone, 'panel')
  assert.equal(gateMeta('pass').word, 'Clear')
  assert.notEqual(gateMeta(null).tone, gateMeta('pass').tone)
})

test('a score component with no value carries the server prose for WHY, never a 0', () => {
  // artifact_score stores each value beside its own _source column precisely so a null can explain
  // itself. Rendering 0, or a blank, would read as a measured result.
  const parts = scoreParts({
    must_have_coverage: 80, must_have_source: '4/5 must-have requirements covered',
    keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet',
    seniority_alignment: null, seniority_source: 'not graded - the independent reviewer (P4) has not run',
  })
  assert.equal(parts.length, 3)
  const missing = parts.filter((p) => p.value == null)
  assert.equal(missing.length, 2)
  for (const m of missing) {
    assert.ok(m.source && m.source.length > 0, `${m.key} must say why it has no value`)
    assert.notEqual(m.value, 0, 'null must never be rendered as zero')
  }
  assert.deepEqual(scoreParts(null), [], 'no score row at all is an empty list, not a fabricated one')
})

test('unknown keys degrade to something readable rather than disappearing', () => {
  // C6 moved this number to what the PROFILE can evidence. The label followed; a label describing
  // the previous definition sits next to a correct number and is the half a reader believes.
  assert.equal(checkLabel('must_have_coverage'), 'Must-haves your profile can evidence')
  assert.ok(!/this document covers/.test(checkLabel('must_have_coverage')),
    'the label promises document repetition again — that is the pre-C6 numerator')
  assert.equal(checkLabel('a_check_added_later'), 'a check added later')
  // Design wording (rendered prototype 2026-08-23): the fields are headed "Skills 1", not
  // "Skills, column 1", which described the column to a developer rather than naming it.
  assert.equal(fieldLabel('SkillsBullets1'), 'Skills 1')
  assert.equal(fieldLabel('SomeNewMergeField'), 'SomeNewMergeField')
  assert.equal(assetLabel('compact_resume'), 'Compact resume')
  assert.equal(assetLabel('some_new_type'), 'some new type')
  assert.equal(assetLabel(null), 'Asset')
})

// The badge labelled the SERVER'S TOTAL as "to fix". With 1 deterministic finding and 3 reviewer
// ones it rendered "4 to fix" — telling the reader to fix three things the reviewer merely raised,
// which under D6 can never fail an artifact. R4's second sentence is that fixes and reviews are
// always counted separately AND LABELLED, and the badge that rule exists to protect was the surface
// breaking it. Found by the independent P8 acceptance author reading shipped code, not by any test
// here: the split selector was built correctly and then the badge did not use it.
test('the badge labels fixes and reviews separately — never the total under one label', () => {
  const row = (engine, state) => ({ check_key: 'k', engine, state, observed: '', expected: '', offenders: [] })
  const payload = {
    gate: 'warn', attention: 4,
    results: [row('deterministic', 'fail'), row('reviewer', 'warn'), row('reviewer', 'warn'), row('reviewer', 'fail')],
  }
  const s = attentionSplit(payload)
  assert.equal(s.fix, 1, 'only the deterministic finding is a thing to FIX')
  assert.equal(s.review, 3, 'the three reviewer rows are things to REVIEW')
  assert.notEqual(s.fix, s.counted, 'the fix count must not be the server total')

  // The structural half: the badge must read the split, not `.counted`. Comments stripped so the
  // guard cannot fire on the explanation of the bug it forbids.
  const src = readFileSync(new URL('../src/screens/AssetGateDrawer.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
  // THE WINDOW IS THE FUNCTION, not a character count. This read `+ 1600` and went green for as
  // long as the function happened to be shorter than that; SPEC 4.4-14's deep link grew it past
  // 1600 and the `split.review` assertion failed against code that renders `split.review` perfectly
  // well, three lines below the cut. A guard that fires on correct code is the cry-wolf failure the
  // hardening rule forbids - and the same cut would have SILENTLY stopped covering the review half
  // had the growth been anywhere else. Slicing to the next top-level declaration covers the whole
  // function however long it gets.
  const from = src.indexOf('function GateBadge')
  const end = src.indexOf('\nconst Section', from)
  assert.ok(end > from, 'the GateBadge function could not be delimited - the guard would cover nothing')
  const badge = src.slice(from, end)
  assert.ok(!/\{\s*n\s*\}\s*to fix/.test(badge), 'the badge must not render a single total as "to fix"')
  assert.match(badge, /split\.fix[\s\S]{0,80}to fix/, 'it must render the deterministic count as the fix count')
  assert.match(badge, /split\.review[\s\S]{0,80}to review/, 'and the reviewer count under its own label')
})

// ── P8.7: the drawer is selectable by CSS ───────────────────────────────────────────────────────
// It had ZERO `data-qc` hooks while PostingAnalysis.jsx had 24, so every claim P5.3 makes about it
// was only assertable on the live site by matching body TEXT — which breaks on a copy edit and can
// never tell two surfaces apart that say the same words. ui-verify.mjs hands COUNT_SEL / CLICK_SEL
// / MEASURE_SEL straight to querySelector; there is no text-matching escape hatch that is stable.
import { GATE_HOOKS, firstFixFinding, attentionRank, ATTENTION_ORDER, keepAvailability, bySeverity, severityWeight } from '../src/assetGate.js'
import { fileURLToPath as gateUrl } from 'node:url'

const GATE_SRC = readFileSync(gateUrl(new URL('../src/screens/AssetGateDrawer.jsx', import.meta.url)), 'utf8')
const gateStrip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('every GATE_HOOKS selector is rendered, and the drawer hand-types none of them', () => {
  for (const [name, value] of Object.entries(GATE_HOOKS)) {
    assert.ok(GATE_SRC.includes('GATE_HOOKS.' + name),
      `GATE_HOOKS.${name} ("${value}") is declared but never rendered — a selector that matches nothing`)
  }
  const stripped = gateStrip(GATE_SRC)
  for (const value of Object.values(GATE_HOOKS)) {
    assert.ok(!new RegExp(`data-qc=["']${value}["']`).test(stripped),
      `data-qc="${value}" is hand-typed — it must come from GATE_HOOKS so the verifier's selector cannot drift`)
  }
  const values = Object.values(GATE_HOOKS)
  assert.equal(new Set(values).size, values.length, 'two hooks share a value — one selector would match two surfaces')
})

test('no hook value collides across the three screens that own one', async () => {
  // A verifier selector is a bare `[data-qc="..."]`; it does not know which screen it is on. Two
  // screens sharing a value makes every count assertion on either of them ambiguous.
  const { QC_HOOKS } = await import('../src/qcRail.js')
  const { BLOCK_HOOKS } = await import('../src/assetBlocks.js')
  const { PACKET_HOOKS } = await import('../src/packetBuilder.js')
  // POSTING_HOOKS was the gap: PostingAnalysis.jsx hand-typed all 29 of its selectors, so the 29
  // that had existed longest were the only ones this union never checked.
  const { POSTING_HOOKS } = await import('../src/postingAnalysis.js')
  const all = [
    ...Object.values(QC_HOOKS), ...Object.values(GATE_HOOKS), ...Object.values(BLOCK_HOOKS),
    ...Object.values(PACKET_HOOKS), ...Object.values(POSTING_HOOKS),
  ]
  const dupes = all.filter((v, i) => all.indexOf(v) !== i)
  assert.deepEqual(dupes, [], `hook values used by more than one screen: ${dupes.join(', ')}`)
})

test('the two counts stay two hooks — a blended one is not addable back by accident', () => {
  // R4/D6: fixes and reviews are counted AND LABELLED separately. The badge once rendered the
  // server's combined `counted` as "N to fix"; separate hooks mean a verifier can catch a
  // regression by selecting each number, not by reading a sentence.
  assert.notEqual(GATE_HOOKS.toFix, GATE_HOOKS.toReview)
  const stripped = gateStrip(GATE_SRC)
  assert.match(stripped, /GATE_HOOKS\.toFix[\s\S]{0,200}split\.fix/)
  assert.match(stripped, /GATE_HOOKS\.toReview[\s\S]{0,200}split\.review/)
  assert.ok(!/data-qc-n=\{split\.counted\}/.test(stripped),
    'the badge is publishing the blended server total as a count of things to fix')
})

// ── Severity labels: the prototype's words, read from the prototype ───────────────────────────────
//
// These three read their expected strings OUT of docs/qc-evidence/ at run time rather than
// restating them. A guard that hardcodes the string it is guarding cannot notice the design moving;
// this one fails the moment the app's copy and the prototype's copy stop agreeing, in either
// direction. Evidence they were needed: the UI gap register listed 'Done for you', 'Fix before
// approval', 'Review' and 'Your call' as present in the prototype and absent from the app.

const PROTO_DATA = readFileSync(new URL('../../docs/qc-evidence/qc/data.js', import.meta.url), 'utf8')
const PROTO_EVIDENCE = readFileSync(new URL('../../docs/qc-evidence/qc/evidence.jsx', import.meta.url), 'utf8')

/** The prototype's own SEV_LABEL literal, parsed rather than retyped. */
function protoSevLabel() {
  const m = PROTO_DATA.match(/const SEV_LABEL = \{([^}]*)\}/)
  assert.ok(m, 'the prototype no longer declares SEV_LABEL - this guard is reading the wrong file')
  const out = {}
  for (const pair of m[1].split(',')) {
    const kv = pair.match(/\s*(\w+)\s*:\s*'([^']*)'/)
    if (kv) out[kv[1]] = kv[2]
  }
  assert.ok(Object.keys(out).length >= 4, 'parsed too few SEV_LABEL entries: ' + JSON.stringify(out))
  return out
}

test('H:sev-label-matches-prototype: every severity word we ship is the prototype word', () => {
  const proto = protoSevLabel()
  // Our keys are the prototype's keys minus `open`, which has no app-side source (OPEN_ITEMS).
  assert.equal(SEV_LABEL.fix, proto.fail, 'deterministic fail must read the prototype "fail" label')
  assert.equal(SEV_LABEL.review, proto.warn)
  assert.equal(SEV_LABEL.soft, proto.soft)
  assert.equal(SEV_LABEL.fixed, proto.fixed)
  assert.ok(!('open' in SEV_LABEL),
    'shipping an "open" severity means a bucket was minted with no data source behind it')
})

test('H:reviewer-fail-is-not-must-fix: a row that cannot block never uses blocking words', () => {
  // D6 (qcRail.js railCounts): only a deterministic row can fail an artifact. STATE_META mapped
  // every fail to 'Must fix' in red, so the drawer told the reader a reviewer finding blocked them.
  const reviewerFail = { state: 'fail', engine: 'reviewer', check_key: 'x' }
  const rulesFail = { state: 'fail', engine: 'deterministic', check_key: 'x' }

  assert.equal(severityFor(reviewerFail), 'soft')
  assert.equal(severityFor(rulesFail), 'fix')

  const words = severityMeta(reviewerFail).label.toLowerCase()
  for (const banned of ['must fix', 'must ', 'before approval', 'blocked', 'required']) {
    assert.ok(!words.includes(banned),
      'a reviewer fail may never block, so it may not say "' + banned + '": ' + JSON.stringify(words))
  }
  assert.notEqual(severityMeta(reviewerFail).tone, severityMeta(rulesFail).tone,
    'the two must not share a colour either - colour is the faster signal than the word')

  // A row with nothing to answer for keeps its existing state words, unchanged.
  assert.equal(severityFor({ state: 'pass' }), null)
  assert.equal(severityMeta({ state: 'pass' }).label, STATE_META.pass.label)
  assert.equal(severityMeta({ state: 'not_applicable' }).label, STATE_META.not_applicable.label)
  // warn is engine-blind: a warning is a warning whoever raised it.
  assert.equal(severityFor({ state: 'warn', engine: 'reviewer' }), 'review')
  assert.equal(severityFor({ state: 'warn', engine: 'deterministic' }), 'review')
})

test('H:change-log-headline-matches-prototype: the change log is headed in the prototype words', () => {
  const m = PROTO_EVIDENCE.match(/>([^<>{}]*\bfor you\b[^<>{}]*)</)
  assert.ok(m, 'the prototype no longer renders a "... for you" heading in qc/evidence.jsx')
  assert.equal(CHANGE_LOG_HEADLINE, m[1].trim(),
    'the app heads its change log differently from the prototype')
})

test('H:correction-controls-use-prototype-words: the change-log row speaks the design language', () => {
  // The app had all three affordances already WIRED and named differently:
  //   'Suggest something different' (prototype: 'Change it')
  //   'Open <fieldName>'            (prototype: 'Review →')
  //   'Corrected'                   (prototype: 'Corrected for you')
  // Tests bind to the data-qc hooks, not these strings, so the rename is safe - and this guard is
  // what stops it silently drifting back. Expected strings are READ from the prototype.
  const src = readFileSync(new URL('../src/screens/QcRail.jsx', import.meta.url), 'utf8')
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  for (const m of PROTO_EVIDENCE.matchAll(/>(Change it|Review →)</g)) {
    assert.ok(stripped.includes('>' + m[1] + '<'),
      'the prototype ships a "' + m[1] + '" control and the change-log row does not use those words')
  }
  assert.equal(SEV_LABEL.fixed, 'Corrected for you')

  // The rename must not have cost the reader the destination: the field tag still renders.
  assert.match(stripped, /\{row\.merge_field\}<\/span>/,
    '"Review →" is only honest while the field name is still on the row')

  for (const gone of ['Suggest something different', 'Open {row.fieldName']) {
    assert.ok(!stripped.includes(gone), 'stale pre-prototype wording is back: ' + gone)
  }
})

test('H:one-method-label: `method` has exactly ONE plain-language table, and it is the true one', () => {
  // There were two, disagreeing on template_fill. AssetBlocks.jsx read one, AssetGateDrawer.jsx the
  // other, so one insertion row described itself two contradictory ways on two screens.
  const blocks = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  const gate = readFileSync(new URL('../src/assetGate.js', import.meta.url), 'utf8')

  assert.equal((gate.match(/^export const METHOD_LABEL = \{/gm) || []).length, 1,
    'assetGate.js is the single definition')
  assert.ok(!/^export const METHOD_LABEL = \{/m.test(blocks),
    'assetBlocks.js has redefined METHOD_LABEL - that is the duplicate that disagreed')
  assert.match(blocks, /export \{ METHOD_LABEL \} from '\.\/assetGate\.js'/,
    'assetBlocks.js must RE-EXPORT the one table, so both screens cannot drift again')

  // And the surviving wording must be the one insertions.ts actually means. `template_fill` is
  // derived as `changed ? 'model_rewrite' : 'template_fill'` - it means NOT changed for this
  // posting - so a label claiming it was written for the posting is false in the flattering
  // direction. Assert on MEANING, not on the exact sentence, so a reword cannot silently re-break it.
  const label = METHOD_LABEL.template_fill.toLowerCase()
  for (const banned of ['written for this posting', 'tailored', 'for this posting', 'for this job']) {
    assert.ok(!label.includes(banned),
      'template_fill means the package value went in UNCHANGED; it may not claim ' +
      JSON.stringify(banned) + ' - got ' + JSON.stringify(METHOD_LABEL.template_fill))
  }
  assert.notEqual(METHOD_LABEL.template_fill, METHOD_LABEL.model_rewrite,
    'the changed and unchanged cases must not read the same')
})

test('H:no-state-word-stutter: the correction row states its state ONCE', () => {
  // Shipped for one deploy as: section header "CORRECTED FOR YOU", then the row reading
  // "Corrected for you Corrected: \"15\" rewritten as \"multiple\" in Resume summary."
  // Three times in two lines. correctionSentence() ALWAYS opens with the state word (R1 guards
  // that prefix), so any separate label beside it is a restatement in BOTH states.
  //
  // Asserted on the RENDERED PAIR, not on one constant: the defect was two correct things placed
  // next to each other, so a guard reading either one alone cannot see it.
  const src = readFileSync(new URL('../src/screens/QcRail.jsx', import.meta.url), 'utf8')
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const row = stripped.slice(stripped.indexOf('export function CorrectionRow'))
  const header = row.slice(0, row.indexOf('data-qc-part="why"'))
  assert.ok(header.includes('data-qc-part="sentence"'), 'anchor moved - this guard is reading the wrong region')
  assert.ok(!/<b[^>]*>\{row\.undone \?/.test(header),
    'a state label is being rendered beside the sentence, which already opens with that word')
  for (const dup of ["'Undone'", 'SEV_LABEL.fixed']) {
    assert.ok(!header.includes(dup),
      'the row header restates the state word ' + dup + '; correctionSentence already carries it')
  }

  // The prefix itself must SURVIVE - it is the accessible signal now, and eight of nine pill tones
  // measure below 4.5:1, so it cannot be replaced by colour. This is R1's invariant, restated here
  // because THIS guard is what would otherwise tempt someone to delete the prefix too.
  assert.match(correctionSentence({ phrase: 'a', replacement: 'b', fieldName: 'F', undone: false }), /^Corrected: /)
  assert.match(correctionSentence({ phrase: 'a', replacement: 'b', fieldName: 'F', undone: true }), /^Undone: /)
})

test('H:severity-counts-share-the-rail-split: the header cannot disagree with the findings below it', () => {
  // The prototype keeps `N to fix` / `N to review` / `N your call` on the collapsed
  // "What this X answers" row (qc/assets.jsx:218-221). Those buckets MUST come from `severityFor`,
  // the same split D6 rests on — a reviewer `fail` is an opinion that may never block, and a header
  // that re-derived state+engine would be free to call it a blocker while the rail calls it a
  // judgement, on the same screen.
  const result = { gate: 'fail', attention: 4, results: [
    { check_key: 'a', engine: 'deterministic', state: 'fail' },      // to fix
    { check_key: 'b', engine: 'deterministic', state: 'fail' },      // to fix
    { check_key: 'c', engine: 'deterministic', state: 'warn' },      // to review
    { check_key: 'd', engine: 'reviewer', state: 'fail' },           // your call — NEVER a blocker
    { check_key: 'e', engine: 'deterministic', state: 'pass' },      // counted nowhere
    { check_key: 'f', engine: 'deterministic', state: 'not_applicable' }, // counted nowhere
  ] }
  assert.deepEqual(severityCounts(result), { fix: 2, review: 1, soft: 1 })

  // A reviewer fail must NEVER land in `fix`. This is the assertion that would catch the header
  // being rebuilt from `state === 'fail'` alone.
  const reviewerOnly = { gate: 'warn', attention: 1, results: [{ check_key: 'r', engine: 'reviewer', state: 'fail' }] }
  assert.deepEqual(severityCounts(reviewerOnly), { fix: 0, review: 0, soft: 1 })

  // Settled rows are not work. A header counting passes would report a clean asset as busy.
  const clean = { gate: 'pass', attention: 0, results: [
    { check_key: 'p', engine: 'deterministic', state: 'pass' },
    { check_key: 'n', engine: 'deterministic', state: 'not_applicable' },
  ] }
  assert.deepEqual(severityCounts(clean), { fix: 0, review: 0, soft: 0 })
  assert.deepEqual(severityCounts({}), { fix: 0, review: 0, soft: 0 })
})

// ── SPEC 4.4-14 — the gate count deep-links `n to fix -> <title>` ────────────────────────────────
//
// `docs/qc-evidence/qc/packet.jsx:266` renders `{list.length} to fix — {it.title} →` as a real
// control. RENDER-SWEEP.md measured this app's badge as `role: null`, `tabindex: null`,
// `getComputedStyle().cursor === "default"`, with a click that moved neither `location.hash` nor
// `body.innerText.length`. Two separate defects produced that: the COUNT was never the control
// (only the whole badge was), and the callers' handler resolved to null anyway because
// `packetFailList` could not produce a target (see H:fail-list-field-is-resolved-from-the-offenders).

test('H:gate-count-is-the-deep-link-and-names-the-finding', () => {
  const badge = gateStrip(GATE_SRC).slice(
    gateStrip(GATE_SRC).indexOf('function GateBadge'),
    gateStrip(GATE_SRC).indexOf('\nconst Section'))

  // The COUNT carries the affordance, not just the badge around it. Without role/tabIndex it is
  // unreachable by keyboard and announced as text, which is how the sweep read it.
  assert.match(badge, /GATE_HOOKS\.toFixLink[\s\S]{0,220}role="button"/,
    'the count must be the control, with a keyboard path')
  assert.match(badge, /GATE_HOOKS\.toFixLink[\s\S]{0,400}onKeyDown/, 'Enter and Space must work on it')
  assert.match(badge, /firstFixFinding\(result\)/, 'the title must come from the module, not be composed here')

  // NO DEAD UI, both directions. No handler -> no link; and the COUNT must survive without one,
  // because the number is a fact about the asset whether or not it can be clicked.
  // RESTATED 2026-08-30. The invariant is UNCHANGED - no handler, no link - but the expression is no
  // longer a single call: the badge now prefers the finding the CALLER's handler will actually open
  // (`firstFix`) and falls back to computing its own. Pinning the old literal would have forced the
  // fix to be reverted to keep a guard green, which is the tail wagging the dog.
  assert.match(badge, /const fix = onClick \? [^\n]*: null/,
    'a link must not be offered when the caller gave no handler')
  assert.match(badge, /firstFix \|\| firstFixFinding\(result\)/,
    'the caller-supplied finding must WIN - computing our own selects independently of the '
    + 'destination and can name a different row than the one the click opens')
  assert.match(badge, /GATE_HOOKS\.toFix\}/, 'the plain count must still render on its own hook')

  // The nested click must not fire the outer one as well.
  assert.match(badge, /stopPropagation/, 'the inner control double-fires into the badge handler')
})

test('H:first-fix-finding-orders-by-the-shared-rank', () => {
  // The finding the badge NAMES must be the one the lists it links into sort FIRST, or the reader
  // is told to fix one thing and handed another. Proven by agreement with attentionRank rather than
  // by re-reading the sort.
  const result = { gate: 'fail', engines: { deterministic: { results: [
    { check_key: 'whitespace', state: 'warn', engine: 'deterministic' },
    { check_key: 'word_counts', state: 'fail', engine: 'deterministic' },
  ] } } }
  const f = firstFixFinding(result)
  assert.equal(f.check_key, 'word_counts', 'a warn (review) was named as the thing to FIX')
  assert.ok(attentionRank(severityFor({ check_key: 'word_counts', state: 'fail', engine: 'deterministic' }))
    < attentionRank(severityFor({ check_key: 'whitespace', state: 'warn', engine: 'deterministic' })),
  'precondition: fix must rank before review')
})

test('H:one-severity-ordering: the drawer sorts by the shared rule, not a local table', () => {
  // FOUR ORDERINGS OF ONE CLAIM existed: severityWeight, railDecisions' engine nest, ATTENTION_ORDER
  // itself, and ChecksTab's own `{ fail: 0, warn: 1, not_applicable: 2, pass: 3 }`. The last one was
  // kept only because this file may not import qcRail.js, which is why `bySeverity` moved beside the
  // order it reads. It happened to AGREE while it only saw deterministic rows; it would have stopped
  // agreeing on the first reviewer row, silently.
  const src = gateStrip(GATE_SRC)
  assert.ok(!/\{\s*fail:\s*0,\s*warn:\s*1/.test(src),
    'the drawer has its own severity table again - it will drift from ATTENTION_ORDER unwatched')
  assert.match(src, /const sorted = bySeverity\(rows\)/, 'the Checks tab must sort through the shared rule')

  // And the shared rule really does order the settled rows too, which is the half a severity-only
  // sort would drop: not_applicable is an open question, pass is settled.
  const rows = [
    { check_key: 'p', state: 'pass', engine: 'deterministic' },
    { check_key: 'na', state: 'not_applicable', engine: 'deterministic' },
    { check_key: 'w', state: 'warn', engine: 'deterministic' },
    { check_key: 'f', state: 'fail', engine: 'deterministic' },
  ]
  assert.deepEqual(bySeverity(rows).map((r) => r.check_key), ['f', 'w', 'na', 'p'])
})

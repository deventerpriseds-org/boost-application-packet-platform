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
  SEV_LABEL, severityFor, severityMeta, CHANGE_LOG_HEADLINE,
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
  const badge = src.slice(src.indexOf('function GateBadge'), src.indexOf('function GateBadge') + 1600)
  assert.ok(!/\{\s*n\s*\}\s*to fix/.test(badge), 'the badge must not render a single total as "to fix"')
  assert.match(badge, /split\.fix[\s\S]{0,80}to fix/, 'it must render the deterministic count as the fix count')
  assert.match(badge, /split\.review[\s\S]{0,80}to review/, 'and the reviewer count under its own label')
})

// ── P8.7: the drawer is selectable by CSS ───────────────────────────────────────────────────────
// It had ZERO `data-qc` hooks while PostingAnalysis.jsx had 24, so every claim P5.3 makes about it
// was only assertable on the live site by matching body TEXT — which breaks on a copy edit and can
// never tell two surfaces apart that say the same words. ui-verify.mjs hands COUNT_SEL / CLICK_SEL
// / MEASURE_SEL straight to querySelector; there is no text-matching escape hatch that is stable.
import { GATE_HOOKS } from '../src/assetGate.js'
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { keywordSwapOptions, keywordActions, keywordPresence, proposedKeywordsForRow, proposedKeywordDetail } from '../src/assetBlocks.js'
import { correctionSentence } from '../src/assetGate.js'

const req = (seq, model_keyword, verbatim = null, kind = 'must_have') =>
  ({ id: `r${seq}`, seq, kind, model_keyword, verbatim })

// ── the selector ────────────────────────────────────────────────────────────────────────────────

test('H:proposed-keywords-dedupe-in-seq-order: one chip per distinct keyword, posting order', () => {
  const reqs = [req(2, 'roadmap ownership', 'own the roadmap'), req(5, 'vendor selection'),
    req(7, 'roadmap ownership', 'x')]
  assert.deepEqual(proposedKeywordsForRow(reqs), ['roadmap ownership', 'vendor selection'])
})

test('H:proposed-keywords-never-invent-a-placeholder: absent is absent', () => {
  // CLAUDE.md: absent evidence is `not_applicable`, never `pass`. A null keyword must not become a
  // chip reading "null", an empty chip, or a "0 keywords" line — those are measurement claims and
  // there is no measurement.
  assert.deepEqual(proposedKeywordsForRow([req(1, null), req(2, ''), req(3, '   ')]), [])
  assert.deepEqual(proposedKeywordsForRow([]), [])
  assert.deepEqual(proposedKeywordsForRow(undefined), [])
  assert.deepEqual(proposedKeywordsForRow(null), [])
})

test('H:proposed-keyword-detail-never-quotes-a-paraphrase: null verbatim stays null', () => {
  // `requirement.item_text` is a MODEL PARAPHRASE (`schema.ts:331`: "NEVER presented as a quote").
  // When the requirement was unlocatable, `verbatim` is null and the panel must say there is
  // nothing to quote — substituting the paraphrase would present model prose as the employer's
  // words, which is the exact failure `Verbatim` exists to prevent.
  const reqs = [req(2, 'roadmap ownership', 'own the roadmap'), req(5, 'vendor selection', null)]
  assert.equal(proposedKeywordDetail(reqs, 'roadmap ownership').verbatim, 'own the roadmap')
  assert.equal(proposedKeywordDetail(reqs, 'vendor selection').verbatim, null)
  assert.equal(proposedKeywordDetail(reqs, 'not a keyword here'), null)
  const src = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export function proposedKeywordDetail'))
    .slice(0, 700).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!body.includes('item_text'), 'the detail must never fall back to the paraphrase')
})

// ── the "never scoreable" wall ──────────────────────────────────────────────────────────────────

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('H:keyword-never-reaches-a-count: model_keyword is absent from every module that scores or gates', () => {
  // `schema.ts:338` and `requirements.ts:59` both declare model_keyword NEVER SCOREABLE. That is a
  // rule about SCORING, not display — the chips render it deliberately. This guard is the wall
  // between the two, and it is a REGRESSION guard: the count was measured at zero when written, so
  // it is honest to say it protects a property that already holds rather than fixing a defect.
  //
  // COMMENTS ARE STRIPPED FIRST, and that is not cosmetic. `appChecks.ts` discusses keyword
  // coverage at length in prose; a guard matching raw text would pass on the comment and could
  // never fail. That is the inert-guard shape this repo has now shipped three times.
  for (const f of ['checks.ts', 'appChecks.ts', 'artifactScore.ts']) {
    const code = strip(readFileSync(new URL(`../../api/src/functions/tests/${f}`, import.meta.url), 'utf8'))
    assert.ok(!code.includes('model_keyword'),
      `${f} references model_keyword in CODE — a never-scoreable field must not reach a gate or a score`)
  }
})

test('H:proposed-keywords-compute-nothing: the selector counts, scores and grades nothing', () => {
  const src = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  const i = src.indexOf('export function proposedKeywordsForRow')
  const body = strip(src.slice(i, src.indexOf('\n}', i)))
  for (const banned of ['length /', '/ ', '* 100', 'Math.round', 'covered', 'scoreable', 'pct', 'score']) {
    assert.ok(!body.includes(banned), `the selector must not compute ${banned}`)
  }
})

test('H:keyword-chip-says-proposed-on-every-chip: the word is not on the heading alone', () => {
  const jsx = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8')
  const i = jsx.indexOf('BLOCK_HOOKS.keywordChip}')
  const end = jsx.indexOf('BLOCK_HOOKS.keywordDetail', i)
  assert.ok(i > 0 && end > i, 'the chip must exist and be followed by the detail panel')
  // BOUNDED BY THE NEXT HOOK, not by a character count. The first version sliced a fixed 900 chars
  // and broke the moment the chip grew handlers - a guard that fails on unrelated growth teaches
  // people to edit the guard instead of reading it.
  const chip = jsx.slice(i, end)
  assert.match(chip, />proposed</, 'the literal word must render inside each chip element')
  // and it must not borrow the visual language of a VERIFIED placement
  assert.ok(!/qc-kw|qc-echo/.test(chip), 'a proposed chip must not wear the highlight classes')
})

// ── #30: an owner edit reads as the owner's, in the log they already have ────────────────────────

test('H:owner-edit-sentence-says-who-acted: "Corrected:" on the owner\'s own words is a lie', () => {
  // An owner edit and a pipeline correction share ONE component and ONE log - deliberately, because
  // two renderings of one change is the divergence CorrectionRow exists to prevent. That makes the
  // SENTENCE the only place who-acted can live, and it matters: "Corrected: ..." on a line the owner
  // wrote themselves tells them the system rewrote their words.
  const s = (source, undone = false) => correctionSentence({
    phrase: 'Vendor selection', replacement: 'Supplier negotiation', fieldName: 'Core skills', undone, source })

  assert.match(s('owner_edit'), /^You changed: "Vendor selection" to "Supplier negotiation" in Core skills\./)
  assert.match(s('generalized'), /^Corrected: /)
  assert.match(s('profile_figure'), /^Corrected: /)
  assert.match(s(undefined), /^Corrected: /, 'an unknown source keeps the existing wording')

  // R1: every sentence opens with its own state word. The row carries no separate label because
  // eight of nine pill tones fail contrast in at least one theme, so the prefix IS the state.
  for (const src of ['owner_edit', 'generalized', undefined]) {
    assert.match(s(src), /^(You changed|Corrected): /, `missing state prefix for ${src}`)
    assert.match(s(src, true), /^Undone: /, `an undone row must read Undone for ${src}`)
  }
})

// ── SPEC 4.6-10 / 4.6-11: the drop request, and the four lies it must not tell ──────────────────
//
// The panel gained ONE control: "Ask to drop it from this field", which seeds the field's own ask
// box with a request and sends nothing. Every guard below exists because the prototype's version of
// this control (docs/qc-evidence/qc/assets.jsx:82) says something this app cannot honestly say.

const JSX = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8')

/**
 * The rendered region under test, comments stripped, bounded by the NEXT hook rather than by a
 * character count — a guard sliced by length breaks the moment the markup grows and teaches people
 * to edit the guard instead of reading it (the lesson H:keyword-chip-says-proposed already carries).
 */
function actionsRegion() {
  const src = strip(JSX)
  const i = src.indexOf('keywordActions({')
  const end = src.indexOf('Posting line answered', i)
  assert.ok(i > 0, 'the keyword panel does not call keywordActions - the control is not rendered')
  assert.ok(end > i, 'the region boundary moved; re-anchor this guard before trusting it')
  return src.slice(i, end)
}

test('H:keyword-drop-claims-no-coverage: the seeded request may not promise a coverage effect', () => {
  // THE TIER-1 ASSERTION of this lane. `requirement.model_keyword` is declared NEVER SCOREABLE
  // (`schema.ts:338`, `requirements.ts:59`) and the panel two lines above tells the reader the
  // keyword "counts toward nothing". The prototype's three sentences all claim the opposite -
  // "record the keyword as uncovered rather than met", "tell me which posting line loses its
  // coverage", "I would rather show a gap than overstate" (qc/assets.jsx:72,82,85). Copying any of
  // them puts a false claim two inches under a sentence that says there is no such number.
  const banned = [/\buncovered\b/i, /\bcoverage\b/i, /\bcovered\b/i, /show a gap/i, /\bloses\b/i]
  const strings = [
    keywordActions({ keyword: 'roadmap ownership', present: true, canEdit: true }).ask,
    keywordActions({ keyword: 'roadmap ownership', present: false, canEdit: true }).reason,
  ]
  for (const s of strings) {
    assert.ok(s, 'both states must produce their sentence')
    for (const re of banned) assert.ok(!re.test(s), `the seeded copy claims a coverage effect: ${re} in "${s}"`)
  }
  // and the same ban over what the panel RENDERS, not only over what the selector returns - a
  // literal typed straight into the JSX would slip past an assertion that only reads the module.
  const region = actionsRegion()
  for (const re of banned) assert.ok(!re.test(region), `the rendered keyword actions claim a coverage effect: ${re}`)
})

test('H:keyword-drop-offers-nothing-it-cannot-do: no inert control, and the reason is SAID', () => {
  // "No dead UI", and its sharper half: absent evidence is never permission. A drop on a keyword the
  // field does not contain would be a no-op that LOOKS like it worked, so no control is rendered and
  // the reason is stated instead. A static block has no edit path at all (`AssetBlocks.jsx` gates
  // the sibling Tweak this on `artifactId && !isStatic`), so it gets neither.
  const on = keywordActions({ keyword: 'roadmap ownership', present: true, canEdit: true })
  // Matched by its three honest ELEMENTS, not as a fixed string: it uses the word drop, it names
  // the keyword, and it scopes itself to this field. An honest reword must not fail this.
  assert.match(on.ask, /\bdrop\b/i)
  assert.match(on.ask, /"roadmap ownership"/)
  assert.match(on.ask, /this field/)
  assert.equal(on.reason, null, 'an offered action must not also render an excuse')

  const absent = keywordActions({ keyword: 'roadmap ownership', present: false, canEdit: true })
  assert.equal(absent.ask, null, 'a keyword the field does not contain has nothing to drop')
  assert.ok(absent.reason && absent.reason.length > 10, 'and the reader must be told why, not left with an empty panel')

  for (const noEdit of [{ present: true, canEdit: false }, { present: false, canEdit: false }]) {
    const r = keywordActions({ keyword: 'roadmap ownership', ...noEdit })
    assert.deepEqual(r, { ask: null, reason: null }, 'a block with no edit path shows neither a control nor a note')
  }
  for (const k of ['', '   ', null, undefined]) {
    assert.deepEqual(keywordActions({ keyword: k, present: true, canEdit: true }), { ask: null, reason: null },
      'a keyword that is not a keyword must not become a control')
  }
  assert.deepEqual(keywordActions(), { ask: null, reason: null }, 'no arguments must not throw or offer anything')

  // DRIVEN BY THE REAL PRODUCERS, not by hand-set booleans. A guard fed a shape the system never
  // emits has shipped three times in this repo; here the keyword comes from `proposedKeywordsForRow`
  // and the presence flag from `keywordPresence`, exactly as the panel builds them.
  const reqs = [req(2, 'roadmap ownership', 'own the roadmap'), req(5, 'vendor selection', 'pick vendors')]
  const kws = proposedKeywordsForRow(reqs)
  const seen = keywordPresence('Owned roadmap ownership end to end.', kws)
  assert.deepEqual(seen.present, ['roadmap ownership'])
  assert.deepEqual(seen.absent, ['vendor selection'])
  const inText = new Set(seen.present)
  const produced = kws.map((k) => keywordActions({ keyword: k, present: inText.has(k), canEdit: true }))
  assert.ok(produced[0].ask && !produced[0].reason, 'the keyword the draft contains must offer the request')
  assert.ok(!produced[1].ask && produced[1].reason, 'the keyword it does not contain must offer only the reason')

  // REACHABILITY, not just presence: the hook can be rendered inside a branch that never runs. The
  // control is pinned to the value the selector returned, and its presence input is the SAME
  // `kwPresent` set the highlight and the chip state read - a fourth derivation of "is this keyword
  // in this text" is what `keywordPresence`'s own comment forbids.
  const region = actionsRegion()
  assert.match(region, /present: kwPresent\.has\(/, 'presence is re-derived instead of reusing kwPresence')
  assert.match(region, /canEdit: Boolean\(artifactId\) && !isStatic/, 'the static/no-artifact gate is missing')
  // Tolerant of a defensive `act && act.ask`; intolerant of no gate at all.
  assert.match(region, /if \([^)]*act\.ask\)/, 'the control is not gated on the selector having offered one')
  assert.match(region, /if \([^)]*act\.reason\)/, 'the reason is not gated on the selector having given one')

  // AC C.5 - the label may not promise a state nothing stores. "Drop it, leave the line open" is a
  // state change; this app can only phrase a request, and it says so on screen rather than letting
  // the reader infer that a decision was recorded.
  assert.ok(!/leave the line open/i.test(region), 'the label promises a persisted decision that nothing records')
  // The DISCLOSURE, not one phrasing of it: deleting it fails, rewording it does not.
  assert.match(region, /no decision/i, 'nothing on screen says the drop stores nothing')
})

test('H:keyword-drop-seeds-the-ask-box-and-sends-nothing: one edit path, one seed mechanism', () => {
  // AC C.2/C.3. `seedAskReword` was already the seed-then-open pattern; this EXTENDS it into one
  // primitive with two callers rather than standing a second one beside it. Nothing is sent until
  // the reader presses Send, so the wording stays theirs to edit.
  const src = strip(JSX)
  assert.match(src, /const seedAsk = \(sentence\) => \{/, 'the shared seed primitive is gone')
  assert.match(src, /const seedAskReword = \(phrase\) => seedAsk\(/,
    'the reword control stopped delegating - that is a second seed mechanism')
  assert.match(src, /Reword "\$\{phrase\}" so it does not repeat the posting's wording\./,
    "the existing reword sentence must survive verbatim")
  assert.equal((src.match(/api\.aiEditArtifact\(/g) || []).length, 1,
    'a second edit path was added instead of reusing the field ask box')

  const region = actionsRegion()
  assert.match(region, /seedAsk\(act\.ask\)/, 'the drop control does not seed the field ask box')
  assert.ok(!/\bapi\./.test(region), 'the keyword actions region calls the API directly - it must only seed text')
  assert.ok(!/await |fetch\(/.test(region), 'the keyword actions region performs a request; activation must send nothing')

  // The selector is TEXT and nothing else: no thenable, no callback, nowhere for a send to hide.
  const r = keywordActions({ keyword: 'roadmap ownership', present: true, canEdit: true })
  assert.deepEqual(Object.keys(r).sort(), ['ask', 'reason'])
  for (const v of Object.values(r)) assert.ok(v === null || typeof v === 'string')
})

test('H:keyword-drop-quotes-no-posting-text: the request names the keyword and nothing else', () => {
  // AC C.9. `openKeywordDetail.verbatim` is null whenever the requirement could not be located, and
  // `item_text` is a model paraphrase that is NEVER presented as a quote (`schema.ts:331`). The
  // sentence therefore carries the keyword alone - there is no branch in which it can quote a
  // posting line the panel has just said it cannot find.
  // Asserted by SHAPE, not by exact string: this guards what may reach the sentence, and pinning the
  // copy would fire on an honest reword - the cry-wolf failure this repo has shipped twice.
  const ask = keywordActions({ keyword: 'vendor selection', present: true, canEdit: true }).ask
  assert.match(ask, /"vendor selection"/, 'the request must name the keyword it is about')
  assert.ok(!/posting/i.test(ask), 'the request must make no claim about a posting line')

  const src = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  const i = src.indexOf('export function keywordActions')
  const body = strip(src.slice(i, src.indexOf('\n}', i)))
  for (const banned of ['verbatim', 'item_text', 'seq', 'reqs']) {
    assert.ok(!body.includes(banned), `the selector reads ${banned} - it must see only the keyword`)
  }
  // and the call site hands it exactly three things, so nothing else can reach the sentence later
  const call = actionsRegion()
  const args = call.slice(call.indexOf('keywordActions({'), call.indexOf('})', call.indexOf('keywordActions({')))
  assert.deepEqual([...args.matchAll(/(\w+):/g)].map((m) => m[1]).sort(), ['canEdit', 'keyword', 'present'])
})

test('H:keyword-drop-is-keyboard-reachable: a bare span is invisible to the UAT collector', () => {
  // NOT boilerplate. `scripts/compare-ui.mjs` collects `button, [role="button"], a`; a shipped
  // control rendered as a plain span was reported MISSING by it once already
  // (`AssetBlocks.jsx` records the incident beside the ask control).
  const region = actionsRegion()
  const at = region.indexOf('BLOCK_HOOKS.keywordDrop')
  assert.ok(at > 0, 'the drop control has no test hook')
  const control = region.slice(Math.max(0, at - 300), at + 500)
  assert.match(control, /role="button"/)
  assert.match(control, /tabIndex=\{0\}/)
  assert.match(control, /onKeyDown=/)
  assert.match(control, /e\.key !== 'Enter' && e\.key !== ' '/, 'Enter and Space must both activate it')
})

// ── SPEC 4.6-9 — swap for one of the owner's OWN banked skills ───────────────────────────────────

test('H:keyword-swap-offers-ONLY-the-owner-own-banked-skills', () => {
  // The rule that decides whether this control is honest. The alternatives come from
  // skill_bank_entry, seeded from the owner's own MasterContext fields. A model-suggested
  // alternative would put words in the owner's mouth on the document that represents them.
  const out = keywordSwapOptions({
    keyword: 'hiring technology', present: true, canEdit: true,
    bank: [{ label: 'Talent Systems', category: 'Execution and Operations' }, { label: 'Data Strategy', category: null }],
    inField: ['hiring technology'],
  })
  assert.deepEqual(out.candidates.map((c) => c.label), ['Talent Systems', 'Data Strategy'])
  assert.equal(out.reason, null)
  assert.match(out.ask('Talent Systems'), /Swap "hiring technology" in this field for "Talent Systems"/)
})

test('H:keyword-swap-shows-NO-control-when-the-bank-is-empty', () => {
  // No bank means no control - not a disabled one, not an empty picker. Both are the dead UI the
  // standing rule forbids, and an empty dropdown reads as broken rather than as "you have none yet".
  const out = keywordSwapOptions({ keyword: 'x', present: true, canEdit: true, bank: [], inField: [] })
  assert.deepEqual(out.candidates, [])
  assert.match(out.reason, /skill bank is empty/)
  assert.match(out.reason, /Settings/, 'the reason must say where to fix it, or it reads as broken')
})

test('H:keyword-swap-never-offers-the-keyword-itself-or-a-term-already-claimed', () => {
  // Swapping a term for itself is a no-op the reader would have to notice for us; offering a term
  // already in the field would claim the same thing twice.
  const out = keywordSwapOptions({
    keyword: 'Data Strategy', present: true, canEdit: true,
    bank: [{ label: 'Data Strategy', category: null }, { label: 'Cloud Architecture', category: null }, { label: 'Risk Management', category: null }],
    inField: ['data strategy', 'Cloud Architecture'],
  })
  assert.deepEqual(out.candidates.map((c) => c.label), ['Risk Management'])
})

test('H:keyword-swap-says-so-when-every-banked-skill-is-already-claimed', () => {
  // A real state with a real sentence, rather than an empty list that looks like a loading failure.
  const out = keywordSwapOptions({
    keyword: 'A', present: true, canEdit: true,
    bank: [{ label: 'B', category: null }], inField: ['b'],
  })
  assert.deepEqual(out.candidates, [])
  assert.match(out.reason, /already claimed/)
})

test('H:keyword-swap-follows-the-same-guards-as-the-drop', () => {
  // Same guard ORDER as keywordActions, because the two sit together and a reader who cannot edit
  // must not be offered either. A term not in the field cannot be swapped any more than dropped.
  const bank = [{ label: 'B', category: null }]
  assert.deepEqual(keywordSwapOptions({ keyword: 'A', present: true, canEdit: false, bank, inField: [] }).candidates, [])
  assert.equal(keywordSwapOptions({ keyword: 'A', present: true, canEdit: false, bank, inField: [] }).reason, null)
  const notPresent = keywordSwapOptions({ keyword: 'A', present: false, canEdit: true, bank, inField: [] })
  assert.deepEqual(notPresent.candidates, [])
  assert.match(notPresent.reason, /does not contain it/)
  assert.deepEqual(keywordSwapOptions({ keyword: '  ', present: true, canEdit: true, bank, inField: [] }).candidates, [])
})

test('H:keyword-swap-request-records-no-decision', () => {
  // Same honesty as the drop: it is a REQUEST seeded into the ask box. Nothing here may claim a
  // coverage effect or imply a stored decision - the drop lane proved a swap through owner-edit
  // gains no attribution at all.
  const out = keywordSwapOptions({
    keyword: 'A', present: true, canEdit: true,
    bank: [{ label: 'B', category: null }], inField: [],
  })
  const ask = out.ask('B')
  assert.ok(!/coverage|uncovered|gap|score|record/i.test(ask), 'the request implies an effect it does not have: ' + ask)
})

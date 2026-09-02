// P8.4 — the JD step's posting-vs-profile comparison. Pure logic + source guards, no DOM.
//   cd app && npm test
//
// Each test names the acceptance criterion it discharges (docs/qc-evidence/AC-P8.4.md, written
// cold by an independent agent before this code existed). Every guard here was proved by
// reinstating the defect it protects and watching the NAMED assertion fail.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  POSTING_HOOKS, FIT_LABEL, FIT_COLOR, fitLabel, comparisonState, comparisonStaleNote,
  COMPARE_WIDE_MIN, compareColumns, compareGridTemplate, COMPARE_COLUMNS, COMPARE_SCOPE_NOTE,
} from '../src/postingAnalysis.js'

const CARD_SRC = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
// The card grid ONLY. Scoping matters: an assertion run over the whole file would be satisfied by
// the comparison ROW's code, which already does most of these things correctly - and that is exactly
// how a guard comes to pass while the surface it names is broken.
const CARD_BLOCK = () => {
  const i = CARD_SRC.indexOf('POSTING_HOOKS.compareCards')
  if (i < 0) throw new Error('the fit-card grid is not rendered at all')
  return CARD_SRC.slice(i, CARD_SRC.indexOf('POSTING_HOOKS.compareCols'))
}
const BUILDER_SRC = readFileSync(new URL('../src/screens/PacketBuilder.jsx', import.meta.url), 'utf8')

const row = (over = {}) => ({
  key: 'budget_owned', label: 'Budget owned', fit: 'moderate', basis: 'evidence',
  numeric_verdict: null, shortfall: null,
  posting: { seq: 2, text: 'Own a P&L or budget of $10M+', quoted: true },
  profile: { value: 'Held an $8M engineering budget to plan', source_label: 'Work history', source: 'evidence' },
  note: '1 of 2 line(s) are evidenced by your profile', reason: null, covered: 1, total: 2,
  matched_seqs: [2], dimension_version: 1, ...over,
})

// ── AC35: the four column headings, verbatim from the spec ─────────────────────────────────────

test('AC35: the comparison renders the four column headings SPEC 4.2 names, verbatim', () => {
  assert.deepEqual(COMPARE_COLUMNS, ['Dimension', 'The posting asks for', 'Your profile evidences', 'Fit'])
  // ...and the component renders them FROM that constant rather than re-typing them, so a heading
  // cannot drift away from the spec in one place while the test asserts the other.
  assert.match(CARD_SRC, /COMPARE_COLUMNS/)
  for (const c of COMPARE_COLUMNS) {
    assert.ok(!new RegExp(`>\\s*${c.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}\\s*<`).test(CARD_SRC),
      `"${c}" is hand-typed in the component as well as declared`)
  }
})

// ── AC37: the scoping sentence ─────────────────────────────────────────────────────────────────

test('AC37: the surface says fit is graded against the profile, not against a written asset', () => {
  assert.match(COMPARE_SCOPE_NOTE, /stored profile only/)
  assert.match(COMPARE_SCOPE_NOTE, /nothing here has been written into an asset/)
  // Tie the constant to its RENDER SITE, not to its presence in the file. This guard was INERT
  // when first written: `assert.match(CARD_SRC, /COMPARE_SCOPE_NOTE/)` still passed after the
  // sentence was deleted from the JSX, because the import line kept the name alive. Measured by
  // replacing `{COMPARE_SCOPE_NOTE}` with `{''}` and watching nothing fail.
  assert.match(CARD_SRC, /POSTING_HOOKS\.compareScope[\s\S]{0,400}\{COMPARE_SCOPE_NOTE\}/,
    'the scoping sentence is imported but no longer rendered inside the scope hook')
})

// ── AC32: weak means two things ────────────────────────────────────────────────────────────────

test('AC32: a measured shortfall is never labelled "No evidence"', () => {
  assert.notEqual(fitLabel('weak', 'falls_short'), fitLabel('weak', 'nothing_found'))
  assert.ok(!/no evidence/i.test(fitLabel('weak', 'falls_short')))
  assert.ok(!/no evidence/i.test(FIT_LABEL.weak_falls_short))
  // The prototype's single mapping is the defect: docs/qc-evidence/qc/data.js:583.
  assert.ok(!Object.values(FIT_LABEL).includes('No evidence'),
    'the prototype label that prints a false statement over a real shortfall came back')
})

test('AC24: not_applicable is neutral, never coloured as a bad result', () => {
  assert.equal(FIT_COLOR.not_applicable, 'var(--proto-ink3)')
  assert.notEqual(FIT_COLOR.not_applicable, FIT_COLOR.weak,
    'an absence of measurement was coloured the same as a shortfall')
  assert.equal(fitLabel('not_applicable'), 'Not compared')
})

// ── AC45: the surface never vanishes, and says which state it is in ────────────────────────────

test('AC45: with no comparison resolved the surface still renders and says so', () => {
  const st = comparisonState({ resolved: false, dimensions: [], summary: null, set: null })
  assert.equal(st.state, 'unresolved')
  assert.match(st.detail, /not the same as nothing matching/)
  assert.equal(st.rows.length, 0, 'an unresolved comparison must not invent rows')
})

test('AC45: a comparison where nothing could be graded is its OWN state, not an empty one', () => {
  const st = comparisonState({ resolved: true, dimensions: [row({ fit: 'not_applicable', note: null, reason: 'the posting does not ask', covered: null, total: null })] })
  assert.equal(st.state, 'none_graded')
  assert.match(st.headline, /None of these dimensions could be compared/)
  assert.equal(st.rows.length, 1, 'the ungraded rows must still render — each says which state it is in')
})

test('AC45: a null payload is "loading", not "nothing matched"', () => {
  assert.equal(comparisonState(null).state, 'loading')
  assert.equal(comparisonState(undefined).state, 'loading')
})

test('AC45: a graded comparison headline counts the graded population, not the row count', () => {
  const st = comparisonState({ resolved: true, dimensions: [
    row(), row({ key: 'public_sector', fit: 'not_applicable', note: null, reason: 'silent', covered: null, total: null }),
  ] })
  assert.equal(st.state, 'graded')
  assert.match(st.headline, /1 of 2/)
})

// ── AC44: the responsive rule is exported and selectable, not a media query ────────────────────

test('AC44: the comparison is 4-up at the breakpoint and 1-up one pixel below', () => {
  assert.equal(COMPARE_WIDE_MIN, 900)
  assert.equal(compareColumns(900), 4)
  assert.equal(compareColumns(899), 1)
  assert.equal(compareColumns(1440), 4)
  // Never 0, never NaN — an unusable width degrades to one column.
  assert.equal(compareColumns(undefined), 1)
  assert.equal(compareColumns('nonsense'), 1)
  assert.equal(compareColumns(-5), 1)
})

test('AC44: the grid template and the column count are ONE decision, not two', () => {
  for (const w of [320, 899, 900, 1440]) {
    const cols = compareColumns(w)
    const tracks = compareGridTemplate(w).split(') ').length
    assert.equal(cols === 4, tracks > 1, `the template at ${w}px does not match its own column count`)
  }
  // The breakpoint number exists in exactly one place.
  const SRC = readFileSync(new URL('../src/postingAnalysis.js', import.meta.url), 'utf8')
  const hits = (SRC.match(/\b900\b/g) || []).length
  assert.equal(hits, 1, 'the comparison breakpoint is written more than once')
  assert.ok(!/@media[^}]*900/.test(CARD_SRC), 'a media query would be invisible to ui-verify')
})

test('AC44: the column count is RENDERED, so a viewport rule can be asserted by selector', () => {
  assert.match(CARD_SRC, /data-qc-cols=\{cols\}/)
})

// ── AC43: hooks are declared, rendered, unique ─────────────────────────────────────────────────

test('AC43: every comparison hook is declared in POSTING_HOOKS and none is hand-typed', () => {
  const compareHooks = Object.entries(POSTING_HOOKS).filter(([n]) => n.startsWith('compare'))
  assert.ok(compareHooks.length >= 8, 'the comparison surface declares too few hooks to be selectable')
  for (const [name, value] of compareHooks) {
    assert.ok(CARD_SRC.includes('POSTING_HOOKS.' + name),
      `POSTING_HOOKS.${name} ("${value}") is declared but never rendered — a selector that matches nothing`)
    assert.ok(!CARD_SRC.includes(`data-qc="${value}"`),
      `data-qc="${value}" is hand-typed — it must come from POSTING_HOOKS so the verifier's selector cannot drift`)
  }
  const values = Object.values(POSTING_HOOKS)
  assert.equal(new Set(values).size, values.length, 'two POSTING_HOOKS entries share a value')
})

test('AC43: no comparison hook collides with another screen\'s vocabulary', async () => {
  const { QC_HOOKS } = await import('../src/qcRail.js')
  const { GATE_HOOKS } = await import('../src/assetGate.js')
  const { BLOCK_HOOKS } = await import('../src/assetBlocks.js')
  const { PACKET_HOOKS } = await import('../src/packetBuilder.js')
  const others = [
    ...Object.values(QC_HOOKS), ...Object.values(GATE_HOOKS),
    ...Object.values(BLOCK_HOOKS), ...Object.values(PACKET_HOOKS),
  ]
  for (const [name, value] of Object.entries(POSTING_HOOKS)) {
    if (!name.startsWith('compare')) continue
    assert.ok(!others.includes(value), `${name} ("${value}") collides with another screen's hook`)
  }
})

// ── AC38 / AC39 / AC40: what must NOT be deleted or introduced ────────────────────────────────

test('AC38: the extraction-provenance strip P5.4 built is still present, unchanged', () => {
  // "not pipeline counters" reads like a deletion instruction, and this strip is the nearest thing
  // to a counter on the step. It is the ONLY surface reporting how much of the employer's text was
  // located, and the strings the backlog bans were never on this screen at all.
  assert.match(CARD_SRC, /lines extracted/)
  assert.match(CARD_SRC, /located in the posting text/)
  assert.match(CARD_SRC, /characters of posting stored/)
  assert.match(CARD_SRC, /posting truncated before the parser read it/)
  assert.match(CARD_SRC, /the posting changed since these offsets were measured/)
})

test('AC39: the run receipt still says the match number is a model estimate, not a measurement', () => {
  assert.match(CARD_SRC, /a model estimate, not a measured coverage score/)
})

test('AC40: "posting lines" and "passes" never appear as JD-step labels', () => {
  // C7 (.claude/QC-EVIDENCE-PLAN.md:253) and SPEC.md:368. Currently true; this is the regression
  // guard that keeps it true now that a second surface prints counts on this step.
  const rendered = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments are commentary, not labels
    .replace(/^\s*\/\/.*$/gm, '')
  for (const [name, src] of [['PostingAnalysis.jsx', CARD_SRC], ['PacketBuilder.jsx', BUILDER_SRC]]) {
    assert.ok(!/posting lines/i.test(rendered(src)), `"posting lines" is a label in ${name}`)
    assert.ok(!/\bpasses\b/i.test(rendered(src)), `"passes" is a label in ${name}`)
  }
})

// ── AC30/AC24: the reason reaches the screen, not just the payload ────────────────────────────

test('AC24/AC30: the row renders note OR reason — a grade or an absence always carries its sentence', () => {
  assert.match(CARD_SRC, /POSTING_HOOKS\.compareNote/)
  assert.match(CARD_SRC, /\{r\.note \|\| r\.reason\}/,
    'the row must render the stored sentence; recomputing it in the browser makes it unauditable')
})

// ── AC36: two-sided, each side attributed ──────────────────────────────────────────────────────

test('AC36: both cells come from stored values and the profile cell names its source', () => {
  assert.match(CARD_SRC, /r\.posting \? r\.posting\.text/)
  assert.match(CARD_SRC, /r\.profile \? r\.profile\.value/)
  assert.match(CARD_SRC, /r\.profile\.source_label/)
})

test('AC8: an unlocated posting line is labelled a model paraphrase on screen', () => {
  assert.match(CARD_SRC, /!r\.posting\.quoted/)
  assert.match(CARD_SRC, /Model paraphrase - not the employer's wording/)
})

// ── AC25: excluded dimensions are named, never absorbed ───────────────────────────────────────

test('AC25: the summary names the not-compared dimensions rather than printing a bare count', () => {
  assert.match(CARD_SRC, /notApplicableLabels\.join/)
  assert.match(CARD_SRC, /not counted either way/)
})

// ── AC2/AC5: where the set came from is on screen ─────────────────────────────────────────────

test('AC2/AC5: the surface says whether the dimension set is the owner\'s or a seeded fallback', () => {
  assert.match(CARD_SRC, /POSTING_HOOKS\.compareSetSource/)
  assert.match(CARD_SRC, /data-qc-source=\{set\.source\}/)
  assert.match(CARD_SRC, /set\.warning/)
})

// ── the mount ─────────────────────────────────────────────────────────────────────────────────

test('the comparison is mounted on the JD step, above the source card it was built from', async () => {
  // The tag name must END here. This guard was INERT when first written: `/<ProfileCompareCard/`
  // still matched after the element was renamed to `<ProfileCompareCardXX`, which unmounts the
  // real component while leaving the regex satisfied. A rename must not defeat a mount guard.
  const MOUNT = /<ProfileCompareCard(?![A-Za-z0-9_])/
  assert.match(BUILDER_SRC, MOUNT)
  // ...and the name it mounts must be the one the module actually exports, so a mount that renders
  // an undefined component (which React silently drops) cannot pass either.
  const mod = await import('../src/screens/PostingAnalysis.jsx').catch(() => null)
  if (mod) assert.equal(typeof mod.ProfileCompareCard, 'function', 'the mounted name is not an exported component')
  assert.match(CARD_SRC, /export function ProfileCompareCard\(/)

  assert.ok(BUILDER_SRC.search(MOUNT) < BUILDER_SRC.indexOf('<PostingAnalysisCard'),
    'the answer must precede the source it was derived from')
  assert.match(BUILDER_SRC, /comparison=\{req\.data\?\.comparison\}/,
    'the comparison must come from the SAME requirements payload, not a second fetch')
})

// ── D23/D24: the card must not present stored rows as if they were built from the live set ─────
//
// `comparison.set` is read LIVE from the owner's prefs; `comparison.dimensions` are rows written
// when the comparison was last resolved. Without this the card prints "Your dimension set for
// engineering." directly above rows built from a different set — a correct sentence beside a stale
// number, which is the half a reader believes (D15's failure, in a new place).
//
// The API decides staleness (appDimensions.comparisonStaleness) so one answer serves every caller.
// This function only turns it into the sentence, so these tests are about the SENTENCE.

test('D24: nothing to say when the stored rows are current', () => {
  assert.equal(comparisonStaleNote(null), null)
  assert.equal(comparisonStaleNote({ dimensions: [], stale: null }), null)
  assert.equal(comparisonStaleNote({ dimensions: [{ key: 'cycle_time' }] }), null,
    'a payload with no `stale` field at all must not invent one')
})

test('D24: a changed SET and changed RULES are different sentences, because the reason differs', () => {
  const setOnly = comparisonStaleNote({
    stale: { set_changed: true, rules_changed: false, missing: ['cycle_time'], extra: ['budget_owned'], row_version: 2 },
  })
  assert.equal(setOnly.kind, 'set')
  assert.match(setOnly.text, /dimension set has changed/)
  assert.doesNotMatch(setOnly.text, /older version of the comparison rules/,
    'a set change was reported as a rules change')

  const rulesOnly = comparisonStaleNote({
    stale: { set_changed: false, rules_changed: true, missing: [], extra: [], row_version: 1 },
  })
  assert.equal(rulesOnly.kind, 'rules')
  assert.match(rulesOnly.text, /older version of the comparison rules/)
  assert.doesNotMatch(rulesOnly.text, /dimension set has changed/)

  const both = comparisonStaleNote({
    stale: { set_changed: true, rules_changed: true, missing: ['cycle_time'], extra: [], row_version: 1 },
  })
  assert.equal(both.kind, 'both')
  assert.match(both.text, /dimension set has changed/)
  assert.match(both.text, /older version of the comparison rules/)

  // Every one of them must say what to DO. A staleness notice with no remedy is a dead end (R5).
  for (const n of [setOnly, rulesOnly, both]) assert.match(n.text, /Re-resolve/)
})

test('D24: the stale notice is actually MOUNTED, not merely exported', () => {
  // A hook can exist in POSTING_HOOKS and be rendered nowhere. Proved by deleting the JSX block:
  // without this assertion every test above still passes and the notice reaches no screen.
  const jsx = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /comparisonStaleNote\(/, 'the screen never computes the notice')
  assert.match(jsx, /POSTING_HOOKS\.compareStale/, 'the notice has no stable hook on screen')
  // ...and it is rendered from the computed value, not from a literal someone typed.
  assert.match(jsx, /\{stale && \(/, 'the notice is not conditional on there being one')
  assert.match(jsx, /\{stale\.text\}/, 'the notice renders something other than the computed text')
})

// ── 4.2-13 and 4.2-4 ────────────────────────────────────────────────────────────────────────────
// The AC pass for this batch overturned BOTH coverage-doc verdicts, and the guards below encode the
// corrections rather than the original rows:
//   4.2-13 was scored PARTIAL. Its mechanism shipped the day before in `2de4ae5`; only the
//          comparison card lacked the prop. Two lines, not new work.
//   4.2-4  was scored PARTIAL "does not enumerate the missing items by name". WRONG — `dimensions.ts`
//          has enumerated them, by `#seq` and text, all along. So this row is ALREADY BUILT and its
//          AC is a REGRESSION GUARD. Building a `Missing:` feature here would be a second,
//          divergent enumeration of one fact, which is the exact class this repo keeps paying for.

test('H:compare-card-opens-qc-through-the-one-step-api: 4.2-13', () => {
  // AC A.8 — the SAME prop and the SAME call as the sibling card. Not a second navigation path.
  const mount = BUILDER_SRC.slice(BUILDER_SRC.indexOf('<ProfileCompareCard'))
  const props = mount.slice(0, mount.indexOf('/>'))
  assert.match(props, /onOpenQc=/, 'ProfileCompareCard is not passed onOpenQc — the control renders nowhere')
  assert.match(props, /setActiveStep\(\s*'qc'\s*\)/, 'the comparison card navigates somewhere other than QC')
  assert.ok(!/window\.location|history\.pushState/.test(props), 'a second navigation path was introduced')
  // The card itself renders it, hooked, keyboard-reachable, and gated on having rows to point at.
  assert.match(CARD_SRC, /data-qc=\{POSTING_HOOKS\.compareOpenQc\}/, 'the control has no stable hook')
  assert.match(CARD_SRC, /\{onOpenQc && rows\.length > 0 && \(/,
    'the control is not gated on the card having compared rows — a dead link on an empty card')
  const at = CARD_SRC.indexOf('POSTING_HOOKS.compareOpenQc')
  const tag = CARD_SRC.slice(CARD_SRC.lastIndexOf('<span', at), CARD_SRC.indexOf('</span>', at))
  assert.match(tag, /role="button"/, 'a bare span is invisible to compare-ui.mjs\'s control inventory')
  assert.match(tag, /tabIndex=\{0\}/)
  assert.match(tag, /onKeyDown=.*e\.key === 'Enter' \|\| e\.key === ' '/)
})

test('H:two-qc-controls-are-distinct-not-duplicated: 4.2-13 AC A.10', () => {
  // TWO QC controls now sit on the JD step, and AC A.10 makes that a decision rather than an
  // accident: distinct labels AND distinct hooks, or exactly one. Duplicate-surface confusion is
  // what `PacketBuilder.jsx:1006-1010` and `PostingAnalysis.jsx:6-8` both exist to end.
  assert.notEqual(POSTING_HOOKS.openQc, POSTING_HOOKS.compareOpenQc, 'the two QC controls share a hook')
  const labels = ['See where each one is answered', 'See how the assets answer these']
  for (const l of labels) {
    const n = CARD_SRC.split(l).length - 1
    assert.equal(n, 1, `"${l}" appears ${n} times — two controls with one label is the A.10 failure`)
  }
  // AC A.9 — neither label may promise per-row targeting. QC's `pick` is internal state with no
  // prop and no route segment, so NEITHER control can land on one line; both must say so.
  assert.equal(CARD_SRC.split('opens the coverage list in QC, line by line').length - 1, 2,
    'one of the two QC controls ships without the honesty sub-line the other carries')
})

test('H:missing-lines-are-enumerated-ONCE-by-the-api: 4.2-4 is ALREADY BUILT', () => {
  // AC A.6. `dimensions.ts:504` emits "…; no excerpt for: #12 <text>; #14 <text>" and `:483` names
  // every judgeable line for the nothing-found case. It renders today through POSTING_HOOKS
  // .compareNote. The guard is that the app keeps RENDERING the API's string and never re-derives
  // its own list of missing items — two enumerations of one fact is the divergence, not the feature.
  assert.match(CARD_SRC, /data-qc=\{POSTING_HOOKS\.compareNote\}/,
    'the note carrying the API\'s named-missing enumeration is no longer rendered')
  // SCOPED TO THE COMPARISON REGION, and this is a narrowing rather than a relaxation.
  //
  // The assertion ran over the WHOLE FILE, and PostingAnalysis.jsx also renders the evidence line,
  // which legitimately reads `ev.missing` -- the array the API returns naming what a second read
  // could not find in a proposed excerpt. That is the API's own value rendered verbatim, in a
  // different component, about a different subject; it is not the comparison card re-deriving a
  // Missing: list, which is the one thing this case exists to forbid. Left unscoped the guard fires
  // on correct code, and a guard people learn to ignore is worse than none -- this repo deleted a
  // whole linter for exactly that.
  //
  // The file's own CARD_BLOCK helper already states the principle ("an assertion run over the whole
  // file would be satisfied by the comparison ROW's code... that is exactly how a guard comes to
  // pass while the surface it names is broken"). The same reasoning applies in reverse here.
  // The region spans BOTH the comparison row and the fit cards -- neither may re-derive the list --
  // and ends where the evidence-line components begin.
  const COMPARE_REGION = CARD_SRC.slice(
    CARD_SRC.indexOf('POSTING_HOOKS.compareNote'), CARD_SRC.indexOf('function ConfirmProposal'))
  assert.ok(COMPARE_REGION.length > 500, 'the comparison region did not slice — the markers have moved')
  assert.ok(!/Missing:\s*\$\{|Missing:\s*\{|\.missing\b/.test(COMPARE_REGION),
    'the card derives its own Missing: list — it must render the API\'s string, sliced by the API')

  // AC A.7 — the deliberate improvement over the prototype survives. The prototype collapses `weak`
  // to one label ('No evidence', data.js:583); this app splits it, because "No evidence" is a FALSE
  // statement about a candidate whose profile speaks to the axis and merely falls short.
  assert.equal(fitLabel('weak', 'nothing_found'), 'Nothing found')
  assert.equal(fitLabel('weak', 'falls_short'), 'Falls short')
  assert.notEqual(fitLabel('weak', 'nothing_found'), fitLabel('weak', 'falls_short'))
  assert.equal(fitLabel('not_applicable'), 'Not compared')
  for (const v of Object.values(FIT_LABEL)) assert.notEqual(v, 'No evidence')
})

// ── 4.2-1 fit cards ─────────────────────────────────────────────────────────────────────────────
// EVERY assertion below exists because an independent verifier proved the corresponding mutation
// ships with the suite GREEN. Measured, not imagined: deleting the whole card block left 319/0.
// These guard BEHAVIOUR, not styling - card size, count-per-row and ordering stay the owner's to
// change without touching a test.

test('H:fit-cards-exist-and-are-one-per-row: A.1', () => {
  // Verifier mutation: `rows.map(` -> `rows.slice(0,3).map(` rendered 3 cards over an 8-row table
  // and the suite stayed GREEN. A card grid that silently drops rows is worse than none - the
  // reader counts the cards and believes that is the whole comparison.
  const block = CARD_BLOCK()
  assert.match(block, /rows\.map\(/, 'the grid no longer renders one card per row')
  assert.ok(!/rows\.slice\(|\.filter\(/.test(block),
    'the grid truncates or filters rows - the cards would under-report the table beneath them')
})

test('H:fit-card-number-is-READ-never-recomputed: A.2, the tier-1 one', () => {
  // Verifier mutation: `{r.covered}` -> `{r.matched_seqs.length}` - the numerator recomputed in the
  // browser - left the suite GREEN. `covered`/`total` are the API's measurement (dimensions.ts);
  // a client recount answers a different question the moment the two drift, and this app has been
  // bitten by exactly that (railAttention's comment records it).
  const block = CARD_BLOCK()
  assert.match(block, /\{\s*r\.covered\s*\}/, 'the numerator is no longer the API\'s `covered`')
  assert.match(block, /of \{\s*r\.total\s*\}/, 'the denominator is no longer the API\'s `total`')
  assert.ok(!/matched_seqs|\.length\b/.test(block),
    'the card derives a count client-side - it must RENDER the API measurement, never recompute it')
})

test('H:fit-card-never-fabricates-a-count: A.3', () => {
  // Verifier mutation: the total guard -> `|| true`, fabricating "0 of 0" for an ungraded
  // dimension. GREEN. A fabricated composite is the number a reviewer trusts most and the one most
  // likely to be wrong.
  const block = CARD_BLOCK()
  assert.match(block, /r\.fit\s*!==\s*'not_applicable'\s*&&\s*r\.total\s*\?/,
    'the card no longer gates its number on the SAME condition the row uses (:105) - two guards for '
    + 'one question is how two surfaces come to disagree')
  assert.match(block, /nothing to count on this dimension/,
    'an ungraded dimension no longer says so - it would print a number it does not have')
})

test('H:fit-card-explains-an-absence: A.3, the reason half', () => {
  // DEFECT-1, found by the verifier and producible from the real producer: the card rendered only
  // `r.note`, but dimensions.ts sets note=null / reason=<why> on every not_applicable row. A stale
  // comparison therefore rendered EIGHT identical "Not compared" tiles with no explanation, while
  // the table beneath each said why. "Nobody asked" and "asked and found nothing" must not look
  // the same - that is the same laundering as a fabricated number, in the other direction.
  const block = CARD_BLOCK()
  assert.match(block, /\{\s*\(\s*r\.note\s*\|\|\s*r\.reason\s*\)/, 'the card no longer falls back to the row reason')
  assert.match(block, /\{\s*r\.note\s*\|\|\s*r\.reason\s*\}/, 'the card renders note but not reason')
  // And it must match the ROW's treatment, which is the thing it is summarising.
  assert.match(CARD_SRC, /\{\(r\.note \|\| r\.reason\) && \(/,
    'CompareRow no longer renders note-or-reason - the two surfaces have diverged again')
})

test('H:fit-card-keeps-the-two-weak-labels: A.7', () => {
  // Verifier mutation: the card verdict hardcoded to 'No evidence' for weak. GREEN. The prototype
  // collapses both weak states to that one string; this app splits them because "No evidence" is a
  // FALSE statement about a candidate whose profile speaks to the axis and merely falls short.
  const block = CARD_BLOCK()
  assert.match(block, /fitLabel\(\s*r\.fit\s*,\s*r\.shortfall\s*\)/,
    'the card no longer goes through fitLabel - the weak split would collapse')
  assert.ok(!/No evidence/.test(block), 'the card hardcodes the prototype\'s single weak label')
  // The split itself, asserted on the function rather than on the string in the JSX.
  assert.notEqual(fitLabel('weak', 'nothing_found'), fitLabel('weak', 'falls_short'))
})

test('H:fit-cards-do-not-stretch-to-the-tallest-sibling: DEFECT-3', () => {
  // MEASURED, not aesthetic. A grid row stretches every cell to its tallest sibling by default, so
  // ONE axis with a long unevidenced note - 1027 characters on a 12-line axis, an ordinary state
  // with no truncation anywhere - inflated its four neighbours to ~740px of mostly white.
  // The owner kept the notes deliberately ("I'm fine with the 8 and the notes"), so the note is not
  // what changes: the STRETCH is. Rendered locally before and after to confirm.
  const block = CARD_BLOCK()
  assert.match(block, /alignItems:\s*'start'/,
    'the card grid stretches every card to its tallest sibling - one long note inflates the whole row')
})

test('H:fit-card-does-not-re-enumerate-missing-lines: A.6', () => {
  // The existing guard fires on a list labelled `Missing:` but NOT on the same list relabelled
  // `Not evidenced:` - the verifier proved that relabelling ships green, so the guard was
  // label-shaped rather than behaviour-shaped. Assert the CONSTRUCT: the card must not derive a
  // list from the row at all. dimensions.ts:504 already enumerates them and re-deriving is two
  // enumerations of one fact.
  const block = CARD_BLOCK()
  assert.ok(!/\.map\(.*=>.*(seq|text)/.test(block) && !/matched_seqs/.test(block),
    'the card builds its own list out of the row - it must render the API string verbatim')
})

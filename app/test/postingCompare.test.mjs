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
  POSTING_HOOKS, FIT_LABEL, FIT_COLOR, fitLabel, comparisonState,
  COMPARE_WIDE_MIN, compareColumns, compareGridTemplate, COMPARE_COLUMNS, COMPARE_SCOPE_NOTE,
} from '../src/postingAnalysis.js'

const CARD_SRC = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
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

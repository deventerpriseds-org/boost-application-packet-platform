// Unit tests for app/src/postingAnalysis.js — the pure logic behind the JD step's posting-analysis
// card and the keyword tally. Node 22's built-in runner, no DOM, no new dependency.
//   cd app && npm test
//
// Every test here corresponds to a real defect found against cold acceptance criteria on
// claude/qc-p5-4-jdstep. They assert the INVARIANT, not the incident, and each one fails if the
// specific fix is reverted (proved by reverting summarizeKindSource to a blended count and
// watching "a blended must-have count is never printed as one number" fail).
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  KIND_ABBR, KIND_LEGEND, reqChipLabel, KIND_SOURCE_NOTE, KIND_SOURCE_SHORT, NO_QUOTE_REASON,
  kindSourceNote, noQuoteReason, isQuoted, modelKeywords, groupRequirements,
  summarizeKindSource, isEvidencedKindSource, keywordLibraryState, postingBody,
  KEYWORD_2UP_MIN, keywordColumns, keywordGridTemplate, POSTING_HOOKS,
  KEYWORD_GROUPS, NOT_COMPARED_NOTE, keywordGroupMeaning,
} from '../src/postingAnalysis.js'

// The fixture from the AC7 reproduction: one line the posting MARKED required, two the parser
// DEFAULTED. A single "3" makes all three look marked.
const MUST_HAVES = [
  { id: 'a', seq: 1, kind: 'must_have', kind_source: 'posting_required_marker', verbatim: '10+ years leading platform teams', char_start: 40, char_end: 72, match_method: 'exact', item_text: '10+ years leading platform teams', model_keyword: 'platform leadership' },
  { id: 'b', seq: 2, kind: 'must_have', kind_source: 'category_default', verbatim: null, char_start: null, char_end: null, match_method: 'unlocatable', item_text: 'Own the roadmap', model_keyword: 'roadmap' },
  { id: 'c', seq: 3, kind: 'must_have', kind_source: 'category_default', verbatim: null, char_start: null, char_end: null, match_method: 'no_posting', item_text: 'Partner with sales', model_keyword: 'roadmap' },
]
const ROWS = [
  ...MUST_HAVES,
  { id: 'd', seq: 4, kind: 'nice_to_have', kind_source: 'posting_optional_marker', verbatim: 'MBA preferred', char_start: 200, char_end: 213, match_method: 'exact', item_text: 'MBA preferred', model_keyword: 'MBA' },
  { id: 'e', seq: 5, kind: 'responsibility', kind_source: 'category', verbatim: null, char_start: null, char_end: null, match_method: 'beyond_model_window', item_text: 'Run the quarterly review', model_keyword: null },
]

// ── AC7: the count must carry the kind_source split ─────────────────────────────────────────────

test('a blended must-have count is never printed as one number', () => {
  const s = summarizeKindSource(MUST_HAVES)
  assert.equal(s.total, 3)
  assert.equal(s.evidenced, 1)
  assert.equal(s.defaulted, 2)
  assert.equal(s.blended, true)
  // The exact string the card renders beside the chip. If this ever collapses to "3" alone, or to
  // one bucket, a guess is being presented as a fact.
  assert.equal(s.text, '1 marked required · 2 defaulted')
  assert.deepEqual(s.breakdown.map((b) => [b.key, b.count]), [
    ['posting_required_marker', 1],
    ['category_default', 2],
  ])
})

test('the split reads posting-evidenced buckets before defaulted ones, whatever the row order', () => {
  const reversed = [...MUST_HAVES].reverse()
  assert.equal(summarizeKindSource(reversed).text, '1 marked required · 2 defaulted')
})

test('a defaulted kind never counts as evidence the posting supplied it', () => {
  for (const k of ['posting_required_marker', 'posting_optional_marker', 'posting_section_heading', 'category']) {
    assert.equal(isEvidencedKindSource(k), true, `${k} comes from the posting`)
  }
  for (const k of ['category_default', 'fallback', 'unknown', '', undefined, null]) {
    assert.equal(isEvidencedKindSource(k), false, `${k} is not posting evidence`)
  }
})

test('a group whose rows all share one source is not blended, and still names that source', () => {
  const s = summarizeKindSource([MUST_HAVES[1], MUST_HAVES[2]])
  assert.equal(s.blended, false)
  assert.equal(s.text, '2 defaulted')
  assert.equal(s.evidenced, 0)
})

test('a missing kind_source is counted as unrecorded, never silently as evidenced', () => {
  const s = summarizeKindSource([{ kind: 'must_have' }, { kind: 'must_have', kind_source: '  ' }])
  assert.equal(s.evidenced, 0)
  assert.equal(s.defaulted, 2)
  assert.equal(s.text, '2 source unrecorded')
})

test('an empty group summarises to nothing rather than throwing or inventing a bucket', () => {
  for (const empty of [[], null, undefined]) {
    const s = summarizeKindSource(empty)
    assert.equal(s.total, 0)
    assert.equal(s.text, '')
    assert.deepEqual(s.breakdown, [])
  }
})

test('every kind_source the extractor can emit has a short label - none falls through to unrecorded', () => {
  // KindSource in api/src/functions/tests/requirements.ts. A new value added there without a label
  // here would print "source unrecorded" beside a real, posting-evidenced count.
  const emitted = [
    'posting_required_marker', 'posting_optional_marker', 'posting_section_heading',
    'category', 'category_default', 'fallback',
  ]
  for (const k of emitted) {
    assert.ok(KIND_SOURCE_SHORT[k], `${k} needs a short label`)
    assert.ok(KIND_SOURCE_NOTE[k], `${k} needs a row-level note`)
  }
})

// ── AC12/AC14: model output is never labelled as a measurement ──────────────────────────────────

test('no model-facing label attaches the word ATS to a model-produced count', () => {
  // model_keyword is "MODEL-GENERATED: a P1.2 candidate, never scoreable" (requirements.ts).
  // Any string this module supplies for a keyword/short label must not carry "ATS".
  const modelLabels = [...Object.values(KIND_SOURCE_SHORT), ...Object.values(KIND_SOURCE_NOTE), ...Object.values(NO_QUOTE_REASON)]
  for (const label of modelLabels) {
    assert.ok(!/\bATS\b/i.test(label), `"${label}" must not say ATS`)
  }
})

test('ATS survives only where it names the term library or its coverage', () => {
  const unknown = keywordLibraryState(null)
  const unpublished = keywordLibraryState({ keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet' })
  const published = keywordLibraryState({ keyword_coverage: 71, keyword_source: '12/17 scoreable library terms present' })
  for (const s of [unknown, unpublished, published]) {
    const text = `${s.headline} ${s.detail}`
    for (const m of text.match(/[^.]*\bATS\b[^.]*/gi) || []) {
      assert.match(m, /term library|keyword coverage/i, `"${m.trim()}" attaches ATS to something other than the library or its coverage`)
    }
  }
})

// ── the latent lie: the library state must be DERIVED ───────────────────────────────────────────

test('a published library with real coverage stops claiming there is no published version', () => {
  const s = keywordLibraryState({ keyword_coverage: 71, keyword_source: '12/17 scoreable library terms present' })
  assert.equal(s.state, 'published')
  assert.equal(s.coverage, 71)
  assert.ok(!/no published version/i.test(`${s.headline} ${s.detail}`))
  assert.match(s.headline, /71%/)
})

test('coverage 0 is a measured zero, not an unpublished library', () => {
  // 0 is falsy. A `score.keyword_coverage || null` check would misreport a real, measured 0% as
  // "the library has no published version yet" - the exact class of bug this function replaced.
  const s = keywordLibraryState({ keyword_coverage: 0, keyword_source: '0/17 scoreable library terms present' })
  assert.equal(s.state, 'published')
  assert.equal(s.coverage, 0)
  assert.match(s.headline, /0%/)
})

test('never having read a checks run is a third state, not a pass and not an unpublished library', () => {
  const s = keywordLibraryState(null)
  assert.equal(s.state, 'unknown')
  assert.equal(s.coverage, null)
  assert.ok(!/no published version/i.test(`${s.headline} ${s.detail}`))
  assert.match(s.detail, /unknown/i)
})

test('an unpublished library says so, and passes the engine its own words through rather than restating them', () => {
  const s = keywordLibraryState({ keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet' })
  assert.equal(s.state, 'unpublished')
  assert.equal(s.coverage, null)
  assert.match(s.headline, /no published version yet/i)
  assert.equal(s.source, 'no published term-library version has scoreable entries yet')
})

// ── AC31: model output is never presented as the employer's words ───────────────────────────────

test('why_surfaced is never shown under a heading that claims it is the posting', () => {
  // The ~116-opportunity case: no jd_summary, so the box used to fall through to why_surfaced and
  // print it under "The posting".
  const pb = postingBody({ jdSummary: null, why: 'Matches your VP Product target and posted 3 days ago', jdTextLen: 0 })
  assert.equal(pb.kind, 'why')
  assert.ok(!/^the posting$/i.test(pb.heading), 'heading must not claim to be the posting')
  assert.ok(!/\bposting\b/i.test(pb.heading), `heading "${pb.heading}" still reads as the posting itself`)
  assert.equal(pb.badge, 'model-written')
  assert.match(pb.provenance, /model wrote this/i)
  assert.match(pb.provenance, /not the posting/i)
  assert.equal(pb.body, 'Matches your VP Product target and posted 3 days ago')
})

test('a model summary is labelled a summary, never the employer wording', () => {
  const pb = postingBody({ jdSummary: 'Own the platform roadmap for a 200-person org.', why: 'ignored', jdTextLen: 8421 })
  assert.equal(pb.kind, 'summary')
  assert.equal(pb.heading, 'Posting summary')
  assert.equal(pb.badge, 'model-written')
  assert.match(pb.provenance, /A model wrote this summary/)
  assert.match(pb.provenance, /not the employer's wording/)
  // When real employer text exists, say so and say where it is actually quoted.
  assert.match(pb.provenance, /8,421 characters/)
})

test('a summary present with no stored employer text says nothing below can quote the employer', () => {
  const pb = postingBody({ jdSummary: 'Own the platform roadmap.', why: null, jdTextLen: 0 })
  assert.match(pb.provenance, /No employer posting text is stored/i)
})

test('an unloaded jdTextLen makes no claim about stored employer text either way', () => {
  const pb = postingBody({ jdSummary: 'Own the platform roadmap.', why: null })
  assert.ok(!/characters/.test(pb.provenance))
  assert.ok(!/No employer posting text is stored/i.test(pb.provenance))
})

test('with neither a summary nor a surfacing note there is nothing to attribute to anyone', () => {
  const pb = postingBody({ jdSummary: '   ', why: '', jdTextLen: 0 })
  assert.equal(pb.kind, 'none')
  assert.equal(pb.body, null)
  assert.equal(pb.badge, null)
})

test('every postingBody branch that renders a body carries a provenance line naming the model', () => {
  const cases = [
    { jdSummary: 'x', why: null },
    { jdSummary: null, why: 'y' },
  ]
  for (const c of cases) {
    const pb = postingBody(c)
    assert.ok(pb.body, 'this branch renders a body')
    assert.match(pb.provenance, /\bmodel\b/i, `"${pb.provenance}" must name the model`)
    assert.equal(pb.badge, 'model-written')
  }
})

// ── row-level attribution ───────────────────────────────────────────────────────────────────────

test('a row counts as quoted only when the employer words were actually located', () => {
  assert.equal(isQuoted(MUST_HAVES[0]), true)
  assert.equal(isQuoted(MUST_HAVES[1]), false)
  assert.equal(isQuoted({ verbatim: '' }), false)
  assert.equal(isQuoted({ item_text: 'a paraphrase' }), false)
  assert.equal(isQuoted(null), false)
})

test('every unquoted match_method has a reason, and an unknown one still refuses to imply a quote', () => {
  for (const m of ['unlocatable', 'beyond_model_window', 'no_posting']) {
    assert.ok(NO_QUOTE_REASON[m], `${m} needs a reason`)
    assert.equal(noQuoteReason(m), NO_QUOTE_REASON[m])
  }
  assert.equal(noQuoteReason('some_future_method'), 'the posting span for this line is unknown')
  assert.equal(noQuoteReason(undefined), 'the posting span for this line is unknown')
})

test('an unrecognised kind_source falls back to saying the parser defaulted it, never to silence', () => {
  assert.equal(kindSourceNote('posting_required_marker'), KIND_SOURCE_NOTE.posting_required_marker)
  assert.equal(kindSourceNote('brand_new_source'), 'the parser defaulted it')
  assert.equal(kindSourceNote(undefined), 'the parser defaulted it')
})

// ── grouping ────────────────────────────────────────────────────────────────────────────────────

test('responsibilities are never mixed into requirements, and requirements keep must before nice', () => {
  const g = groupRequirements(ROWS)
  assert.deepEqual(g.responsibilities.map((r) => r.id), ['e'])
  assert.deepEqual(g.mustHaves.map((r) => r.id), ['a', 'b', 'c'])
  assert.deepEqual(g.niceToHaves.map((r) => r.id), ['d'])
  assert.deepEqual(g.requirements.map((r) => r.id), ['a', 'b', 'c', 'd'])
  assert.ok(!g.requirements.some((r) => r.kind === 'responsibility'))
  // The three tab counts must partition the rows exactly - no row counted twice, none dropped.
  assert.equal(g.responsibilities.length + g.requirements.length, ROWS.length)
})

test('model keywords are de-duplicated and drop nulls, so the tab count is words not rows', () => {
  const g = groupRequirements(ROWS)
  assert.deepEqual(g.modelKeywords, ['platform leadership', 'roadmap', 'MBA'])
  assert.equal(modelKeywords([]).length, 0)
  assert.equal(modelKeywords(null).length, 0)
  // Two rows share "roadmap" and one has none: 5 rows, 3 words.
  assert.notEqual(g.modelKeywords.length, ROWS.length)
})

test('grouping tolerates a null spine without throwing - the card renders before the fetch lands', () => {
  const g = groupRequirements(null)
  assert.deepEqual(g.all, [])
  assert.deepEqual(g.requirements, [])
  assert.deepEqual(g.modelKeywords, [])
})

test('every kind the extractor emits has an abbreviation for the row chip', () => {
  for (const k of ['must_have', 'nice_to_have', 'responsibility']) assert.ok(KIND_ABBR[k])
})

// ── structural guards ───────────────────────────────────────────────────────────────────────────
// These are source greps, not behaviour tests, because the rules are about what the RENDERED
// markup contains — the repo has no DOM test runner, and a rule about test hooks and label text
// cannot be exercised at runtime here. Comments are stripped before matching so a guard can never
// fire on the note explaining it (a guard people learn to ignore is worse than no guard).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PACKET_HOOKS } from '../src/packetBuilder.js'

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** Remove line comments, block comments and JSX comments. Leaves string content alone. */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const POSTING_ANALYSIS = src('../src/screens/PostingAnalysis.jsx')
const PACKET_BUILDER = src('../src/screens/PacketBuilder.jsx')

test('every surface the acceptance criteria name carries a stable data-qc hook', () => {
  // ui-verify.mjs can only select by CSS. Without these, several criteria are unprovable live.
  const required = {
    'posting-analysis': POSTING_ANALYSIS,
    'jd-tab': POSTING_ANALYSIS,
    'jd-tabpanel': POSTING_ANALYSIS,
    'ats-keywords': POSTING_ANALYSIS,
    'req-row': POSTING_ANALYSIS,
    'req-quote': POSTING_ANALYSIS,
    'req-paraphrase': POSTING_ANALYSIS,
    'kind-source': POSTING_ANALYSIS,
    'keyword-tally': POSTING_ANALYSIS,
    'analysis-result': POSTING_ANALYSIS,
    'posting-stale': POSTING_ANALYSIS,
    // P8.7's keyword breakpoint. `data-qc-cols` is what makes 2-up-vs-1-up selectable by CSS at
    // all; a media query would leave ui-verify.mjs, which cannot read a computed style, blind.
    'keyword-columns': POSTING_ANALYSIS,
    'keyword-group': POSTING_ANALYSIS,
    'posting-body': PACKET_BUILDER,
  }
  // A hook counts as rendered whether it is hand-typed OR emitted through a screen's hook
  // constant. PacketBuilder moved to PACKET_HOOKS (P8.7) and the literal string vanished from the
  // file - a guard that only knew the literal form would have called that a REGRESSION, which is
  // the cry-wolf failure that got two guards deleted from this repo.
  const rendered = (file, hook) => {
    if (file.includes(`data-qc="${hook}"`)) return true
    for (const [name, table] of [['PACKET_HOOKS', PACKET_HOOKS], ['POSTING_HOOKS', POSTING_HOOKS]]) {
      const key = Object.entries(table).find(([, v]) => v === hook)
      if (key && file.includes(`data-qc={${name}.${key[0]}}`)) return true
    }
    return false
  }
  for (const [hook, file] of Object.entries(required)) {
    assert.ok(rendered(file, hook), `data-qc="${hook}" is missing`)
  }
})

// ── P8.7: the keyword list's breakpoint ─────────────────────────────────────────────────────────

test('the keyword list is 2-up at 1040px and 1-up one pixel below', () => {
  assert.equal(KEYWORD_2UP_MIN, 1040)
  assert.equal(keywordColumns(1039), 1, '1039 is below the breakpoint')
  assert.equal(keywordColumns(1040), 2, 'the breakpoint itself is 2-up (">= 1040", not "> 1040")')
  assert.equal(keywordColumns(1441), 2)
  assert.equal(keywordColumns(390), 1)
  // A width that is not a number is 1-up. It must never be 0 (no columns renders nothing) and
  // never NaN (which CSS drops, silently taking the whole grid with it).
  for (const bad of [null, undefined, NaN, 'wide', {}]) assert.equal(keywordColumns(bad), 1)
})

test('the grid template and the column count are the same decision, not two', () => {
  // A template that says two tracks while data-qc-cols says one would make the attribute a lie,
  // and the attribute is the only thing ui-verify can read.
  for (const w of [0, 390, 1039, 1040, 1440]) {
    const tracks = keywordGridTemplate(w).split(') minmax(').length
    assert.equal(tracks, keywordColumns(w), `${w}px: template "${keywordGridTemplate(w)}" vs ${keywordColumns(w)} columns`)
  }
  // minmax(0, 1fr), not 1fr: a single unbroken term must not be able to widen a track past its
  // share and push the card into a horizontal scroll.
  assert.ok(keywordGridTemplate(1440).startsWith('minmax(0, 1fr)'))
})

test('every POSTING_HOOKS selector is rendered, and the card hand-types none of them', () => {
  // This screen was the exception: 29 hand-typed selectors, no constant, and therefore the only
  // ones the cross-screen collision check (assetGate.test.mjs) could not see.
  for (const [name, value] of Object.entries(POSTING_HOOKS)) {
    assert.ok(POSTING_ANALYSIS.includes('POSTING_HOOKS.' + name),
      `POSTING_HOOKS.${name} ("${value}") is declared but never rendered`)
  }
  const code = stripComments(POSTING_ANALYSIS)
  const handTyped = code.match(/data-qc="[a-z0-9-]+"/g)
  assert.equal(handTyped, null, `hand-typed hooks are back: ${handTyped && handTyped.join(', ')}`)
  const values = Object.values(POSTING_HOOKS)
  assert.equal(new Set(values).size, values.length)
})

test('the breakpoint number exists in exactly one place', () => {
  const code = stripComments(POSTING_ANALYSIS)
  assert.match(code, /data-qc-cols=\{cols\}/, 'the column count must be rendered, or it cannot be selected')
  assert.match(code, /keywordColumns\(/, 'the component must read the rule, not restate it')
  assert.ok(!/1040/.test(code), 'the threshold is restated in the component - it belongs to keywordColumns() only')
  const css = readFileSync(fileURLToPath(new URL('../src/theme.css', import.meta.url)), 'utf8')
  assert.ok(!/1040/.test(css),
    'a media query in theme.css is a SECOND copy of the breakpoint, and nothing would notice the day the two disagreed')
})

test('ATS appears only where it names the term library, its coverage, or its scoring', () => {
  // The rule the branch set itself and then broke in four places: a legend under the Requirements
  // panel, the card sub-description, the analysis result strip, and the header score button.
  // AssetBlocks.jsx was NOT scanned, and that is exactly where the rule got broken: its
  // ANSWERS_LABEL said "ATS resume" for compact_resume while the other two maps said "Compact
  // resume", so the same card contradicted itself and no guard could see it. A vocabulary rule that
  // reads two of the three files holding the vocabulary is a rule with a blind spot.
  const ASSET_BLOCKS = src('../src/screens/AssetBlocks.jsx')
  for (const [name, file] of [['PostingAnalysis.jsx', POSTING_ANALYSIS], ['PacketBuilder.jsx', PACKET_BUILDER], ['AssetBlocks.jsx', ASSET_BLOCKS]]) {
    const code = stripComments(file)
    for (const m of code.matchAll(/\bATS\b/g)) {
      const window = code.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ')
      assert.match(window, /term library|coverage|scoring/i,
        `${name}: "ATS" at "${window.trim()}" is not attached to the term library, its coverage, or its scoring`)
    }
  }
})

test('no tab, link name or button title sells a model number as an ATS measurement', () => {
  const code = stripComments(POSTING_ANALYSIS)
  // The keywords tab is named for what it holds. Its count comes from model_keyword, which
  // requirements.ts marks "never scoreable" - so no ATS number can be derived from it at all.
  assert.match(code, /label: 'Keywords', count: parsedKeywords\.length/)
  assert.ok(!/label: '[^']*ATS[^']*'/.test(code), 'no tab may be named ATS anything')
  for (const m of code.matchAll(/title="([^"]*)"/g)) {
    assert.ok(!/\bATS\b/.test(m[1]), `title="${m[1]}" must not say ATS`)
  }
})

test('the JD step no longer auto-advances an already-analysed packet past step 1', () => {
  // `p.jdAnalyzed && ... setActiveStep('resume')` hid the posting-analysis card from every packet
  // analysed in an earlier session - which is the common state, not the edge case.
  const code = stripComments(PACKET_BUILDER)
  assert.ok(!/jdAnalyzed[\s\S]{0,160}setActiveStep/.test(code),
    'an auto-advance conditioned on the analysis having succeeded is back')
  assert.ok(!code.includes('ranManuallyRef'), 'the per-mount ref that was meant to suppress it is dead code')
})

test('the JD step renders its body through postingBody, not by falling through to why_surfaced', () => {
  const code = stripComments(PACKET_BUILDER)
  assert.match(code, /postingBody\(\{\s*jdSummary/, 'the provenance-labelled helper must be what renders the box')
  assert.ok(!/opp\?\.why \|\| 'No posting text available/.test(code), 'the unlabelled why_surfaced fallback is back')
})

test('the group count is rendered from the kind_source split, not from rows.length', () => {
  const code = stripComments(POSTING_ANALYSIS)
  assert.match(code, /const split = summarizeKindSource\(rows\)/)
  // Asserted through the constant, not the literal string. This guard matched
  // `data-qc="kind-source-split"` and so failed the moment the screen adopted POSTING_HOOKS - i.e.
  // it called a correct refactor a regression. That is the second time a hook-literal assertion has
  // cried wolf here (the first was `posting-body` when PacketBuilder adopted PACKET_HOOKS); the
  // invariant is that the SPLIT is what gets rendered, never how the attribute is spelled.
  assert.match(code, /data-qc=\{POSTING_HOOKS\.kindSourceSplit\}/)
  assert.ok(!/px-chip">\{rows\.length\}/.test(code), 'a bare blended count is back')
})

test('the keyword library state is derived from the checks score, never hardcoded', () => {
  const code = stripComments(POSTING_ANALYSIS)
  assert.match(code, /const s = keywordLibraryState\(score\)/)
  assert.ok(!/has no published version yet/.test(code),
    'the "no published version" claim is hardcoded in the component again instead of derived')
})


// ── D14 ─────────────────────────────────────────────────────────────────────────────────────────
//
// THE DEFECT, and it was live: `packet.covered_kw` rendered as green chips under the word
// "covered". The call that fills it is `appPackets.jdAnalysis`, whose user message is Role,
// Company, Comp and the job description - measured by reading the request builder, and now pinned
// on the API side by `H:jd-analysis-sees-no-profile`. No candidate input reaches it, so nothing in
// that call could establish coverage of anything. A confident green count for an unmeasured thing.
//
// The fix chosen was (b) RELABEL, not (a) compare: `requirement_evidence` (P8.3), the term-library
// `keyword_coverage` and the P8.4 dimension comparison already measure the candidate, and a fourth
// coverage number derived from a model's free-text guess would have to agree with all three.
//
// These guards test the DERIVATION, not the wording. A verifier who renames `NOT_COMPARED_NOTE` or
// rewrites its sentence still passes; a verifier who marks an uncompared list as compared, or hands
// an uncompared list a tone, fails by name. That distinction is the whole point - two guards were
// defeated in this repo this week by renaming a constant while keeping the defect.

test('H:keyword-claim-follows-provenance: only a profile-compared list may claim comparison or carry a tone', () => {
  // Both directions on the SAME descriptor, so the result cannot be a constant.
  const base = { key: 'probe', qcGroup: 'probe', tone: 'red', what: 'Some list' }

  const uncompared = keywordGroupMeaning({ ...base, profileCompared: false }, 7)
  assert.equal(uncompared.claim, 'posting_only',
    'a list nothing compared to the profile claimed a comparison')
  assert.equal(uncompared.tone, null,
    'an uncompared list carried a tone - a tone is a verdict, and nothing rendered one')
  assert.equal(uncompared.note, NOT_COMPARED_NOTE,
    'an uncompared list shipped without the disclaimer that says so')

  const compared = keywordGroupMeaning({ ...base, profileCompared: true }, 7)
  assert.equal(compared.claim, 'profile_compared')
  assert.equal(compared.tone, 'red', 'the derivation is inert - flipping the fact changed nothing')
  assert.equal(compared.note, null, 'a compared list carried the never-compared disclaimer')

  // Non-vacuity: the two outputs must actually differ, or the assertions above prove nothing.
  assert.notDeepEqual(uncompared, compared)
})

test('H:keyword-claim-follows-provenance: the three shipped groups declare the right producer', () => {
  // `from_run` IS `packet.covered_kw`. If a future lane wires the profile into jdAnalysis and flips
  // this to true, that is option (a) and it must be a deliberate edit here, not a drift.
  assert.equal(KEYWORD_GROUPS.from_run.profileCompared, false,
    'covered_kw was marked profile-compared - jdAnalysis sends no candidate input (see H:jd-analysis-sees-no-profile)')
  assert.equal(KEYWORD_GROUPS.parsed.profileCompared, false,
    'requirements.model_keyword was marked profile-compared - the JD parse never sees the profile')
  assert.equal(KEYWORD_GROUPS.thin.profileCompared, true,
    'the thin list was marked uncompared - appApply.atsScoreOne sends a candidate master baseline')

  // Every group renders through keywordGroupMeaning, so the rule reaches all of them with no
  // carve-out. A carve-out is how the from-run group lost its disclaimer in the first place.
  for (const [k, g] of Object.entries(KEYWORD_GROUPS)) {
    const m = keywordGroupMeaning(k, 3)
    assert.equal(m.profileCompared, g.profileCompared, `${k}: meaning disagrees with its descriptor`)
    assert.equal(m.tone === null, !g.profileCompared, `${k}: tone does not follow provenance`)
    assert.equal(m.note === null, g.profileCompared, `${k}: disclaimer does not follow provenance`)
    assert.match(m.label, /\b3\b/, `${k}: the count is missing from the label`)
  }
})

test('H:keyword-claim-follows-provenance: the count in the label is the count it was given', () => {
  // A hardcoded label would sail past the tests above. Vary the number and the string must move.
  const labels = [0, 1, 42].map(n => keywordGroupMeaning('from_run', n).label)
  assert.equal(new Set(labels).size, 3, 'the label ignores its count')
  assert.match(keywordGroupMeaning('from_run', 0).label, /\b0\b/)
  // A junk count is 0, never NaN on screen.
  assert.match(keywordGroupMeaning('from_run', undefined).label, /\b0\b/)
})

test('H:keyword-claim-follows-provenance: the rendered screen reads its label from the module', () => {
  // The rule lived as a JSX comment before D14, and prose does not run. The one structural claim a
  // unit test can make about the .jsx is that it no longer hand-types these strings: every keyword
  // group must go through KeywordGroup/keywordGroupMeaning. Source grep, per the H-case rules -
  // there is no DOM here to exercise.
  const jsx = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  assert.ok(jsx.includes('keywordGroupMeaning('),
    'PostingAnalysis.jsx no longer calls keywordGroupMeaning - the labels went back to being hand-typed')
  // The old hand-typed headings are gone. Named individually so a failure says which came back.
  for (const gone of ['Terms the analysis run pulled out of the posting -', 'Compared against your profile and flagged as thin -']) {
    assert.ok(!jsx.includes(gone), `a keyword heading is hand-typed in the .jsx again: ${gone}`)
  }
})

// ── requirement-kind abbreviations: ONE map, and a legend that covers it ─────────────────────────

test('H:kind-abbr-single-definition: no second abbreviation map anywhere in app/src', () => {
  // THERE WERE TWO AND THEY DISAGREED. This file said MH/NTH/RESP; assetBlocks.js:160 said M/N/R.
  // So one requirement row rendered as `MH #3` on the posting-analysis screen and `M3` on every
  // asset step — the same defect as the METHOD_LABEL pair, found the same way. assetBlocks.js now
  // RE-EXPORTS this one. A grep, not a behaviour test, because two modules each holding a correct
  // -looking literal is a structural fact no runtime assertion can see.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(js|jsx)$/.test(name)) out.push(full)
    }
    return out
  }
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
  const definers = walk(srcDir).filter((f) =>
    /(?:export\s+)?const\s+KIND_ABBR\s*=/.test(strip(readFileSync(f, 'utf8'))))
  assert.deepEqual(definers.map((f) => f.slice(srcDir.length)), ['postingAnalysis.js'],
    'KIND_ABBR must be DEFINED in exactly one module; every other file re-exports or imports it')
})

test('H:kind-abbr-single-definition: the re-export is the SAME OBJECT, not a copy', async () => {
  // THE GREP ABOVE WAS INERT ON ITS OWN, and the independent verifier proved it. Its M11 defined a
  // second map under an alias and exported it under the canonical name:
  //
  //     const ABBR_MAP = { must_have: 'M', nice_to_have: 'N', responsibility: 'R' }
  //     export { ABBR_MAP as KIND_ABBR }
  //
  // No `const KIND_ABBR =` anywhere, so the grep passed at 240/240 — while the chips rendered
  // `M`/`N`/`R` again and the legend two lines beneath them still read `RQ-MH must-have`. Worse
  // than the drift this PR closed, because now one screen contradicts ITSELF.
  //
  // Identity is the assertion a grep cannot express and an alias cannot defeat: a re-export yields
  // the very same object, a copy never does. Runtime, not source text.
  const [ab, pa] = await Promise.all([
    import('../src/assetBlocks.js'),
    import('../src/postingAnalysis.js'),
  ])
  assert.equal(ab.KIND_ABBR, pa.KIND_ABBR,
    'assetBlocks.js exports a DIFFERENT KIND_ABBR object - it must re-export postingAnalysis.js\'s')
  assert.equal(ab.KIND_WORD, pa.KIND_WORD, 'same for KIND_WORD')
  assert.equal(ab.KIND_LEGEND, pa.KIND_LEGEND, 'same for KIND_LEGEND')
})

test('H:kind-abbr-values: the owner-set abbreviations, and the RQ- stem that carries the meaning', () => {
  // Owner call 2026-08-23. The stem is the point: a must-have and a nice-to-have are two GRADES of
  // one thing (a requirement), a responsibility is a different kind of line. M/N/R flattened three
  // unequal things into three equal-looking letters.
  assert.equal(KIND_ABBR.must_have, 'RQ-MH')
  assert.equal(KIND_ABBR.nice_to_have, 'RQ-NTH')
  assert.equal(KIND_ABBR.responsibility, 'RESP')
  assert.ok(KIND_ABBR.must_have.startsWith('RQ-') && KIND_ABBR.nice_to_have.startsWith('RQ-'),
    'both requirement grades must share the RQ- stem')
  assert.ok(!KIND_ABBR.responsibility.startsWith('RQ-'),
    'a responsibility is not a requirement and must not carry the stem')
})

test('H:kind-legend-covers-every-chip: nothing can be chipped and left unexplained', () => {
  // The chips were opaque tokens with the expansion only in a `title` tooltip — which no touch
  // device shows. The legend is built FROM the same maps the chips read, so a kind cannot be
  // rendered without a row explaining it.
  for (const k of Object.keys(KIND_ABBR)) {
    const row = KIND_LEGEND.find((l) => l.kind === k)
    assert.ok(row, `${k} can be chipped but has no legend row`)
    assert.equal(row.abbr, KIND_ABBR[k])
    assert.ok(row.word && row.word.length > 2, `${k} has no spelled-out word`)
  }
  assert.equal(KIND_LEGEND.length, Object.keys(KIND_ABBR).length)

  // And the asset step must actually RENDER it, not merely be able to.
  const blocks = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(blocks, /<ReqLegend\s+reqs=/, 'the legend is defined but never rendered')
  assert.match(blocks, /KIND_LEGEND\.filter/, 'the legend must be derived from KIND_LEGEND, not retyped')
})

test('H:req-seq-one-convention: what the reader SEES equals what a finding NAMES', async () => {
  // C-1, found by the independent verifier on PR #47. `AssetBlocks` rendered `seq + 1` and was the
  // ONLY 1-based surface in the app, so the same requirement read `RQ-MH 1` on the asset step and
  // `RQ-MH #0` on posting analysis — and a finding whose offender string begins `#0` pointed at a
  // chip labelled `1`.
  //
  // THE ROUND TRIP IS THE ASSERTION, not the format. Seven api writers emit `` `#${r.seq} …` ``
  // (checks.ts:588/594/616/680, dimensions.ts:286, reviewer.ts:504, remediation.ts:539) and
  // offenderSeq() parses `#(\d+)` back out to decide which findings belong to which requirement.
  // So the number in the chip must survive that parse unchanged. Anything else desyncs the label
  // from the finding on a path that feeds the open-seq set and the coverage cards.
  const { offenderSeq } = await import('../src/qcRail.js')
  for (const seq of [0, 1, 7, 42]) {
    const shown = reqChipLabel('must_have', seq)
    const cited = `#${seq} some requirement text`          // exactly what checks.ts writes
    assert.equal(offenderSeq(cited), seq)
    assert.ok(shown.endsWith(`#${seq}`),
      `chip "${shown}" does not carry the stored seq, so it cannot match the finding that cites #${seq}`)
    assert.equal(Number(shown.slice(shown.indexOf('#') + 1)), offenderSeq(cited),
      'the number a reader sees must equal the number a finding names')
  }

  // Degrades rather than inventing a number.
  assert.equal(reqChipLabel('must_have', null), 'RQ-MH')
  assert.equal(reqChipLabel('must_have', undefined), 'RQ-MH')
  assert.equal(reqChipLabel('nonsense_kind', 3), 'REQ #3')

  // BOTH screens through the ONE formatter, and no surface re-offsetting behind its back. The `+1`
  // lived in a .jsx where no unit test could see it; a grep is the only way to keep it gone.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const f of ['AssetBlocks.jsx', 'PostingAnalysis.jsx']) {
    const src = strip(readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8'))
    assert.match(src, /reqChipLabel\(/, `${f} does not render its chip through the shared formatter`)
    assert.ok(!/\bseq\s*\+\s*1\b/.test(src), `${f} re-offsets seq — one convention, and it is the stored one`)
  }
})

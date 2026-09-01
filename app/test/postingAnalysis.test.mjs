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
  KEYWORD_GROUPS, NOT_COMPARED_NOTE, keywordGroupMeaning, tabEvidenceTone, EVIDENCE_TONE,
  evidencePresentation } from '../src/postingAnalysis.js'

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

// ── SPEC 4.1 evidence: the app READS the endpoint's verdict, and never re-derives it ────────────
//
// Context, because these four guards only make sense together. The requirements endpoint has
// shipped a re-validated evidence verdict for months and the app had NO reader — `grep evidence_
// app/src` returned Settings labels and nothing else. The first version of the reader I wrote read
// the raw `evidence_*` columns and invented its own three states, which would have printed "no
// evidence found in your profile" over a row whose excerpt merely MOVED when the owner edited
// their CV. `verifyRequirementRows` nulls every `evidence_*` key on a row that is not `verified`,
// so four genuinely different situations arrive looking identical, and only the verdict tells them
// apart. These guards keep the app on the verdict.

test('H:evidence-states-match-the-api: the app knows every state verifyEvidence can produce', async () => {
  const { EVIDENCE_TONE, EVIDENCE_WORD } = await import('../src/postingAnalysis.js')
  const src = readFileSync(new URL('../../api/src/functions/tests/evidence.ts', import.meta.url), 'utf8')
  const m = src.match(/export type EvidenceState\s*=\s*([^\n]+)/)
  assert.ok(m, 'EvidenceState union not found in evidence.ts — this guard is reading the wrong file')
  const apiStates = Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]).sort()
  assert.ok(apiStates.length >= 6, `expected the full union, parsed only ${apiStates.join(',')}`)

  // `unknown` is the app's own state for a payload that carries no verdict at all (an older
  // deploy). It is deliberately NOT an API state, so it is excluded from the comparison and
  // asserted separately — a reader that silently treats a NEW api state as "not checked" is the
  // failure this guard exists to catch.
  const appStates = Object.keys(EVIDENCE_TONE).filter((k) => k !== 'unknown').sort()
  assert.deepEqual(appStates, apiStates,
    'app evidence states have drifted from evidence.ts — a state the API can emit would render as "not checked for evidence"')
  assert.deepEqual(Object.keys(EVIDENCE_WORD).sort(), Object.keys(EVIDENCE_TONE).sort(),
    'every state needs both a badge word and a tone')
  assert.ok(EVIDENCE_TONE.unknown && EVIDENCE_WORD.unknown, 'the no-verdict fallback must itself be defined')
})

test('H:evidence-tone-resolves-to-a-real-token: no state paints itself invisible', async () => {
  const { EVIDENCE_TONE } = await import('../src/postingAnalysis.js')
  // shell.jsx's own comment: interpolating an unknown tone produces an INVALID declaration and CSS
  // drops it without a word — "the bug that made todo pills invisible". toneColor() swallows an
  // unknown tone into ink3, so a mistyped tone here would paint an evidenced row the same grey as
  // an unchecked one and nothing would report it. Read the real table rather than trusting the call.
  const shell = readFileSync(new URL('../src/shell.jsx', import.meta.url), 'utf8')
  const table = shell.slice(shell.indexOf('const TONE_SOLID'), shell.indexOf('export const toneColor'))
  assert.ok(table.length > 40, 'TONE_SOLID not found in shell.jsx — this guard is reading the wrong region')
  for (const [state, tone] of Object.entries(EVIDENCE_TONE)) {
    assert.match(table, new RegExp(`(^|[{,\\s])${tone}\\s*:`, 'm'),
      `evidence state "${state}" uses tone "${tone}", which TONE_SOLID does not define — toneColor would silently return grey`)
  }
  // The three signals must be DISTINGUISHABLE, or the dot carries no information.
  assert.notEqual(EVIDENCE_TONE.verified, EVIDENCE_TONE.none)
  assert.notEqual(EVIDENCE_TONE.none, EVIDENCE_TONE.stale,
    'a row whose evidence merely needs re-resolving must not be painted the same as a real gap in the profile')
})

test('H:only-verified-may-be-quoted: no unprovable state leaks an excerpt or says "not found"', async () => {
  const { evidencePresentation, EVIDENCE_WORD } = await import('../src/postingAnalysis.js')

  // A row carrying a quote on the wire but a NON-verified verdict. This shape is not hypothetical:
  // `verifyRequirementRows` writes the verdict AFTER the redaction, and any future column added to
  // the join arrives beside it. The verdict is the authority, never the presence of text.
  for (const state of ['none', 'stale', 'misresolved', 'source_missing', 'unverified', 'wat']) {
    const p = evidencePresentation({
      evidenceState: state,
      evidence: { quote: 'Led vendor selection', sourceLabel: 'Resume 2024' },
      evidence_quote: 'Led vendor selection',
      evidenceNote: 'some sentence',
    })
    assert.equal(p.provable, false, `${state} must never be provable`)
    assert.equal(p.quote, null, `${state} leaked an excerpt — only a verified verdict may be shown as a quote`)
    assert.equal(p.source, null, `${state} leaked a source label`)
  }

  // "no evidence found" is a claim about the OWNER'S PROFILE and only `none` earns it. Saying it
  // over `stale` tells an owner their profile lacks something it contains.
  const found = Object.entries(EVIDENCE_WORD).filter(([, w]) => /not found|no evidence/i.test(w)).map(([s]) => s)
  assert.deepEqual(found, ['none'],
    `only "none" may report a gap in the profile; these states also do: ${found.join(', ')}`)

  // And the verified path does carry it all through.
  const ok = evidencePresentation({
    evidenceState: 'verified',
    evidence: { quote: ' Led vendor selection ', sourceLabel: 'Resume 2024', sourceKind: 'resume', extra: 'model proposal', recordChanged: true },
    evidenceNote: null,
  })
  assert.equal(ok.provable, true)
  assert.equal(ok.quote, 'Led vendor selection')
  assert.equal(ok.source, 'Resume 2024')
  assert.equal(ok.extra, 'model proposal')
  assert.equal(ok.recordChanged, true)
  assert.equal(ok.search, null, 'a verified row has nothing to explain about what was looked for')
})

test('H:evidence-read-from-the-verdict-not-the-columns: no screen reads a redacted column', () => {
  // The pre-redaction shape must never be a source in the app. `chk_evidence_*` Settings KEYS are
  // not property reads off a requirement row, so this matches the access construct rather than the
  // bare string — measured: 0 hits across app/src today, 6 `chk_evidence_*` label keys untouched.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const f of ['../src/screens/PostingAnalysis.jsx', '../src/screens/AssetBlocks.jsx', '../src/postingAnalysis.js']) {
    const src = strip(readFileSync(new URL(f, import.meta.url), 'utf8'))
    const hits = Array.from(src.matchAll(/\.evidence_[a-z_]+/g)).map((m) => m[0])
    assert.deepEqual(hits, [],
      `${f} reads ${hits.join(', ')} — those keys are NULLED for every non-verified row, so reading them cannot tell "stale" from "none"`)
  }
  // The reader is actually mounted; a presenter nothing renders is the inert-guard failure.
  const jsx = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /<EvidenceLine\s/, 'EvidenceLine is defined but never mounted')
  assert.match(jsx, /evidencePresentation\(/, 'PostingAnalysis does not go through the shared presenter')
  assert.match(jsx, new RegExp(`data-qc=\\{POSTING_HOOKS\\.evidence\\}`), 'the evidence line has no stable hook')
  assert.match(jsx, new RegExp(`data-qc=\\{POSTING_HOOKS\\.evidenceBody\\}`), 'the excerpt has no stable hook')
})

// ── 4.1-3, the JD step's only route into QC ─────────────────────────────────────────────────────
// SPEC row 4.1-3, prototype `qc/packet.jsx:159`. The card had exactly one header control
// ("Show as tabs/columns") and no way out of the JD step into the answers; the JD step was a
// dead end. Three separate things can regress independently, so each is asserted separately.
test('H:jd-qc-link-is-not-inert: the route into QC is real, gated, and keyboard-reachable', () => {
  const jsx = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')

  // (1) It is MOUNTED and hangs off the shared hook table, so ui-verify can select it and the
  //     "hand-types no data-qc" assertion above covers it.
  assert.match(jsx, /data-qc=\{POSTING_HOOKS\.openQc\}/,
    'the See-where-each-one-is-answered control is not rendered, or does not carry its hook')

  // (2) It calls the prop, never its own navigation. `setActiveStep` is the ONE step API
  //     (12 call sites incl. goToField); a second `go()` inside a child screen is the parallel
  //     system extend-don't-duplicate forbids, and PostingAnalysis.jsx imports no router today.
  assert.doesNotMatch(jsx, /from\s+'\.\.\/state\.jsx'/,
    'PostingAnalysis.jsx pulled in the router directly — navigation must arrive as a prop')
  assert.match(jsx, /onClick=\{onOpenQc\}/, 'the control does not invoke the navigation prop')

  // (3) Hidden, NOT rendered-and-inert, when the extraction produced nothing to point at.
  //     CLAUDE.md: "If a feature isn't ready, hide the control — don't fake it." A link reading
  //     "see where each one is answered" with no "each one" is precisely the fake control.
  assert.match(jsx, /\{onOpenQc && !reqError && rows\.length > 0 && \(/,
    'the control is not gated on having requirements and no extraction error')

  // (4) A bare <span onClick> is invisible to scripts/compare-ui.mjs, which collects
  //     `button, [role="button"], a` — that is how a control shipped in P8.6 was reported MISSING
  //     from the app for weeks (AssetBlocks.jsx:625-632 records it). Also plain keyboard access.
  //     Scoped to the control's OWN opening tag so a role="button" elsewhere on the screen cannot
  //     satisfy it — the cry-wolf inverse, a guard that passes on somebody else's markup.
  const at = jsx.indexOf('POSTING_HOOKS.openQc')
  //     (`indexOf('>')` cannot delimit the tag — the key handler's own `=>` closes it early.)
  const tag = jsx.slice(jsx.lastIndexOf('<span', at), jsx.indexOf('</span>', at))
  assert.match(tag, /role="button"/, 'the control is a bare span — the UI inventory cannot see it')
  assert.match(tag, /tabIndex=\{0\}/, 'the control cannot be reached by Tab')
  assert.match(tag, /onKeyDown=.*e\.key === 'Enter' \|\| e\.key === ' '/,
    'the control cannot be activated from the keyboard')

  // (5) THE ADVERSARIAL ONE (AC 3.4). QC's requirement filter `pick` is internal state with no
  //     prop and no route segment, so this control CANNOT land on one line — it opens the
  //     Coverage list. The label carries an arrow and the words "each one"; shipping that while
  //     implying per-line targeting is the failure. The adjacent sentence must say what it does.
  assert.match(jsx, /opens the coverage list in QC, line by line/,
    'the label promises targeting the control does not have, with no sentence saying what it opens')
})

test('H:jd-card-keeps-its-existing-header-control: the columns toggle still persists', () => {
  // REGRESSION GUARD 3. Adding a sibling control to the same header row must not displace the
  // stored preference that was deliberately made a user setting rather than a code constant.
  const jsx = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /localStorage\.setItem\('ee_posting_columns'/,
    'the columns preference no longer persists')
  assert.match(jsx, /\{columns \? 'Show as tabs' : 'Show as columns'\}/,
    'the Show as tabs/columns control was displaced by the new one')
})

// ── SPEC 4.3-9/10/11: the QC summary inside the keyword tally modal ─────────────────────────────

/** The source of ONE component, so a guard cannot be satisfied by correct code in its neighbour. */
function regionOf(code, startsWith) {
  const at = code.indexOf(startsWith)
  assert.ok(at > 0, `${startsWith} is gone from the file`)
  const rest = code.slice(at + startsWith.length)
  const ends = ['\nfunction ', '\nexport function ', '\n// \u2500'].map((m) => rest.indexOf(m)).filter((i) => i > 0)
  return code.slice(at, at + startsWith.length + (ends.length ? Math.min(...ends) : rest.length))
}

test('H:tally-qc-summary-computes-nothing: the modal renders the model, it does not re-decide it', () => {
  // AC B.1, and it is the AC that sets this change's tier. The tally modal opens from the JD step,
  // where the reader cannot see the QC rail. A gate word, a count or a composite computed HERE
  // would be a second opinion with nothing on screen to reconcile it against - the exact shape of
  // the count bug that put every rule for this rail into qcRail.js in the first place.
  const region = regionOf(stripComments(POSTING_ANALYSIS), 'function QcSummaryBlock(')
  for (const banned of ['railGate(', 'gateMeta(', 'scoreParts(', '.filter(', '.reduce(', "=== 'fail'", "=== 'pass'", '/ 3']) {
    assert.ok(!region.includes(banned), `the QC summary derives its own verdict: ${banned}`)
  }
  // Everything it prints comes off the model or off a shared component.
  assert.match(region, /model\.sentence/)
  assert.match(region, /model\.headline\.why/, 'the null-composite prose is restated instead of read from railHeadline')
  assert.match(region, /<GateBadge /, 'the gate is not rendered by the shared badge')
  assert.match(region, /<ScoreParts /, 'the bars are not rendered by the shared component')
})

test('H:gate-badge-is-imported-not-copied: 4.3-11 is a relocation, and a relocation may not paste', () => {
  // The coverage doc calls 4.3-11 "a relocation, not a missing component". A relocation that COPIES
  // is the duplication the extend-don\'t-duplicate rule forbids, and GateBadge\'s five states -
  // including "gate unavailable" and "not loaded", which are the two an inline copy always drops -
  // were already written once and imported by three files.
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
  const definers = walk(srcDir).filter((f) => /function\s+GateBadge\s*\(/.test(strip(readFileSync(f, 'utf8'))))
  assert.deepEqual(definers.map((f) => f.slice(srcDir.length)), ['screens/AssetGateDrawer.jsx'],
    'GateBadge must be DEFINED once; every other surface imports it')
  assert.match(POSTING_ANALYSIS, /import \{ GateBadge, ScoreParts \} from '\.\/AssetGateDrawer\.jsx'/,
    'the tally modal no longer imports the shared badge and bar renderer')
})

test('H:score-bar-has-one-home: no surface hand-writes a second set of score bars', () => {
  // AC B.14. There were TWO before this change - MatchTab and the QC rail\'s compact block - each
  // with its own clamp, its own "not measured" Pill and its own "no source was recorded" fallback,
  // and 4.3-10 asked for a THIRD inside the tally modal. Three copies of one statement is how the
  // same three parts come to say different things on different screens.
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
  // A `px-bar` is only a SCORE bar when it sits beside the score vocabulary. AssetBlocks.jsx:233
  // draws one for a completion meter and is correct code; a guard that fired on it would be the
  // cry-wolf failure that got two linters deleted from this repo.
  const drawers = walk(srcDir).filter((f) => {
    const code = strip(readFileSync(f, 'utf8'))
    return code.includes('px-bar') && /not measured|scoreParts|\.parts\.map|SCORE_PART/.test(code)
  })
  assert.deepEqual(drawers.map((f) => f.slice(srcDir.length)), ['screens/AssetGateDrawer.jsx'],
    'a second score-bar renderer is back')
  assert.ok(!POSTING_ANALYSIS.includes('px-bar'), 'the tally modal hand-writes bars again')
})

test('H:tally-keyword-number-is-deferred-upward: one measurement, one place, in that order', () => {
  // AC B.4 branch (a). The deferral sentence says "shown once, above", so the layout has to put
  // KeywordLibraryState ABOVE the score block. The key-level half of this guard - that the defer
  // map still matches a key scoreParts() emits - is H:tally-defer-key-tracks-scoreParts.
  const code = stripComments(POSTING_ANALYSIS)
  const region = regionOf(code, 'function QcSummaryBlock(')
  assert.match(region, /defer=\{TALLY_SCORE_DEFER\}/,
    'the score block no longer defers its keyword part - keyword_coverage is now on this screen twice')
  const lib = code.indexOf('<KeywordLibraryState')
  const block = code.indexOf('<QcSummaryBlock')
  assert.ok(lib > 0 && block > 0 && lib < block,
    'the score block claims the keyword number is shown ABOVE it, and it is not')
  // The 30px model estimate keeps its disclaimer, and the composite carries its own provenance:
  // two big numbers, and the reader must be able to tell which one was measured (AC B.5).
  assert.match(code, /It is not keyword coverage, and no applicant tracking system produced it/)
  assert.match(region, /measured by the checks engine and stored on the asset - not a model estimate/)
})

test('H:tally-summary-is-wired-in-the-packet-screen: the block is not a component nobody mounts', () => {
  // THE GAP MY OWN DEFECT HUNT FOUND. Every other guard here proves the COMPONENT and the MODEL;
  // both would stay green with the props never passed, and the QC summary would render nothing at
  // all on the real screen. The browser probe hands the model in directly, so it cannot see this
  // either. This is the producer half - the same producer/consumer pairing qcRail.test.mjs keeps
  // for useQcEntries, and for the same reason: the two sides of a prop are where this repo has
  // shipped write-only fields before.
  const builder = stripComments(PACKET_BUILDER)
  assert.match(builder, /qcSummaryModel\(qcEntries, \{ scored: resumeEntry, scoredType: SCORED_TYPE \}\)/,
    'the QC summary model is no longer derived off the ONE useQcEntries payload every other consumer reads')
  assert.match(builder, /qcSummary=\{qcSummary\}/, 'the tally modal is mounted without its model')
  // AC B.13 - the identical close-and-navigate shape as the existing onGoResume, threaded as a
  // prop. PostingAnalysis.jsx must never import navigation.
  assert.match(builder, /onGoQc=\{\(\) => \{ setAtsOpen\(false\); setActiveStep\('qc'\) \}\}/,
    'Open QC no longer closes the modal and navigates')
  assert.ok(!/from '\.\.\/state\.jsx'/.test(POSTING_ANALYSIS),
    'PostingAnalysis.jsx imports navigation instead of taking it as a prop')
  // The scored artifact type stays ONE literal (the Config check): the modal is handed the type,
  // it does not look for a second one of its own.
  assert.match(builder, /const SCORED_TYPE = 'resume'/)
  // `'resume'` is also this screen's STEP key, a dozen times over, so counting the literal proves
  // nothing. What must stay singular is the ARTIFACT-TYPE comparison: a second one is a second
  // place to change when the owner wants to choose which asset carries the score.
  assert.ok(!/artifact\.type === 'resume'/.test(builder),
    'the scored artifact type is compared against a literal again instead of SCORED_TYPE')
  assert.equal((builder.match(/SCORED_TYPE/g) || []).length, 3,
    'SCORED_TYPE must be declared once and used exactly twice - the lookup and the model call')
})

// ── SPEC 4.1-6 — the tab count's tone ────────────────────────────────────────────────────────────

test('H:tab-tone-never-claims-green-before-anything-is-resolved', () => {
  // Absent evidence is not a pass. A tab whose rows carry no evidenceState has not been resolved,
  // and returning green would tell the owner the posting is fully evidenced before the resolver has
  // run. Null renders UNCOLOURED, which is the honest state.
  assert.equal(tabEvidenceTone([]), null)
  assert.equal(tabEvidenceTone([{ id: 1 }, { id: 2 }]), null)
  assert.equal(tabEvidenceTone(null), null)
  assert.equal(tabEvidenceTone(undefined), null)
})

test('H:tab-tone-never-paints-a-warn-state-red', () => {
  // THE REASON THE PROTOTYPE'S RULE CANNOT BE PORTED. Its `n === d ? green : red` must paint the
  // four unprovable-but-present states red, and a red count over a `misresolved` row tells the owner
  // their CV does not support a claim it DOES support - a false statement about their own profile.
  // EVIDENCE_TONE makes `none` the only red on purpose; this must agree with it, not override it.
  for (const state of ['stale', 'misresolved', 'source_missing', 'unverified']) {
    assert.equal(tabEvidenceTone([{ evidenceState: 'verified' }, { evidenceState: state }]), 'warn',
      `${state} was painted ${tabEvidenceTone([{ evidenceState: state }])} - it is a pipeline warning, not a finding about the owner`)
  }
})

test('H:tab-tone-is-worst-state-wins-and-red-is-terminal', () => {
  assert.equal(tabEvidenceTone([{ evidenceState: 'verified' }, { evidenceState: 'verified' }]), 'green')
  assert.equal(tabEvidenceTone([{ evidenceState: 'verified' }, { evidenceState: 'none' }]), 'red')
  // One unevidenced requirement is the thing the reader most needs to see; no number of verified
  // siblings may soften it, and a warn sibling must not outrank it either.
  assert.equal(tabEvidenceTone([{ evidenceState: 'misresolved' }, { evidenceState: 'none' }]), 'red')
  assert.equal(tabEvidenceTone([{ evidenceState: 'none' }, { evidenceState: 'verified' }]), 'red')
  // BOTH ORDERS, and the second one is why. A mutation replacing `return 'red'` with an assignment
  // passed this guard until this line existed: with red merely assigned, a LATER warn row overwrites
  // it and the tab reports `warn` for a posting that has an unevidenced requirement in it. The first
  // draft only tested warn-then-red, which that mutation gets right by accident.
  assert.equal(tabEvidenceTone([{ evidenceState: 'none' }, { evidenceState: 'misresolved' }]), 'red',
    'a warn row AFTER a red one downgraded the tab - red must be terminal regardless of order')
  assert.equal(tabEvidenceTone([{ evidenceState: 'none' }, { evidenceState: 'unknown' }]), 'red')
})

test('H:tab-tone-downgrades-green-on-an-unknown-state-but-does-not-warn', () => {
  // An unknown state is an ABSENCE of information, not a warning about the owner. It must stop the
  // tab claiming green without accusing anything.
  assert.equal(tabEvidenceTone([{ evidenceState: 'verified' }, { evidenceState: 'unknown' }]), 'panel')
  // ...and it must not outrank a real warning or a real failure.
  assert.equal(tabEvidenceTone([{ evidenceState: 'unknown' }, { evidenceState: 'misresolved' }]), 'warn')
  assert.equal(tabEvidenceTone([{ evidenceState: 'unknown' }, { evidenceState: 'none' }]), 'red')
})

test('H:tab-tone-reads-EVIDENCE_TONE-and-never-a-second-map', () => {
  // A tab and the rows inside it must never disagree about what colour the evidence is. Asserted by
  // AGREEMENT with the row-level map rather than by restating the expected colours here - restating
  // them is how the two drift.
  for (const [state, expected] of Object.entries(EVIDENCE_TONE)) {
    if (state === 'unknown') continue // handled by its own guard above
    assert.equal(tabEvidenceTone([{ evidenceState: state }]), expected,
      `the tab tone for ${state} disagrees with EVIDENCE_TONE`)
  }
})

test('H:keywords-tab-is-never-toned', () => {
  // A colour is a STRONGER claim than a count, and this file already records that attaching a count
  // to model-suggested keywords "made a suggestion look like a measurement". Toning them would be a
  // worse version of the same mistake. Deliberate divergence from the prototype, whose third tab is
  // ATS keywords scored off a term library - not the same thing wearing the same label.
  const src = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  const kw = src.slice(src.indexOf("key: 'keywords'"), src.indexOf("key: 'keywords'") + 260)
  assert.match(kw, /tone: null/, 'the keywords tab must pass tone: null explicitly')
  assert.ok(!/tabEvidenceTone\(parsedKeywords\)/.test(src),
    'the keywords tab is being toned - a suggestion must not be rendered as a measurement')
})

// ─── the confirm control: a model's proposal only counts once a human says so ──────────────────
//
// `checks.ts` states the rule these guard: "a model may PROPOSE, only an exact rule may ACCUSE, and
// must_have_coverage is the accusation". A `proposed` excerpt is shown and does NOT count;
// confirming it is the only promotion, because a human IS an exact rule. Measured in production the
// day the control shipped: 15 proposed rows across 15 requirements, every one carrying a verified
// quote from the owner's own profile, all uncounted, on screens reporting zero coverage.
const evRow = (over = {}) => ({
  evidenceState: 'verified',
  evidence: { quote: 'Led an enterprise-wide Agile transformation', sourceLabel: 'Work history 1',
    method: 'proposed', confirmedAt: null, confirmedBy: null, ...over },
})

test('H:proposal-awaits-a-human: an unconfirmed model proposal asks, a confirmed one does not', () => {
  const open = evidencePresentation(evRow())
  assert.equal(open.method, 'proposed')
  assert.equal(open.awaitingConfirmation, true, 'an unconfirmed proposal must offer the control')
  assert.equal(open.confirmedAt, null)

  const done = evidencePresentation(evRow({ confirmedAt: '2026-09-01T12:00:00Z', confirmedBy: 'von.ellis@enterpriseds.io' }))
  assert.equal(done.awaitingConfirmation, false, 'a confirmed proposal must not ask again')
  assert.equal(done.confirmedBy, 'von.ellis@enterpriseds.io', 'who vouched for it is shown, not just that someone did')
})

test('H:rule-evidence-is-never-asked-to-be-confirmed', () => {
  // `anchored` and `exact` are a RULE's excerpts and already count. Offering "is this your
  // evidence?" on one would ask the owner to ratify something no model proposed, and imply the
  // deterministic path needs their permission to count. It does not.
  for (const method of ['anchored', 'exact']) {
    const p = evidencePresentation(evRow({ method }))
    assert.equal(p.awaitingConfirmation, false, `${method} evidence must never show the confirm control`)
  }
  // No excerpt at all: nothing to confirm, and the control must not appear over an empty verdict.
  const none = evidencePresentation({ evidenceState: 'none', evidence: null })
  assert.equal(none.awaitingConfirmation, false)
  assert.equal(none.method, null)
})

test('H:confirmation-reads-the-verdict-not-the-columns', () => {
  // The FIRST version of this feature read `r.evidence_confirmed_at` off the raw row and
  // `H:evidence-read-from-the-verdict-not-the-columns` failed it, correctly: those keys are nulled
  // for every non-verified row, so read directly they cannot tell "the confirmation lapsed" from
  // "nobody ever confirmed it". Inside the verdict, a confirmation is dropped with the quote it
  // vouched for. This asserts the fix rather than trusting the memory of it.
  const redacted = evidencePresentation({
    evidenceState: 'stale', evidence: null,
    evidence_confirmed_at: '2026-09-01T12:00:00Z', evidence_confirmed_by: 'von.ellis@enterpriseds.io',
  })
  assert.equal(redacted.confirmedAt, null,
    'a redacted row must not report a confirmation recovered from the raw columns')
  assert.equal(redacted.awaitingConfirmation, false)
})

test('H:confirm-control-is-hidden-without-a-target', () => {
  // No dead UI. The route is POST /app/requirement/{seq}/evidence-confirm and it needs the
  // opportunity in the body, so with no `oppId` the button could not work - it is hidden, not shown
  // and broken. Structural: the render is guarded by `oppId` in the same expression.
  const src = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  assert.match(src, /ev\.awaitingConfirmation\s*&&\s*oppId\s*&&/,
    'the confirm control must be gated on BOTH an open proposal and somewhere to send the answer')
})

// ─── VETTED — the model row that COUNTS, and why the owner has to see which ones they are ───────
//
// `must_have_coverage` reads `ruleEvidenceOf`: a `proposed` row does not count, a `vetted` one does.
// So a vetted row is the only place in this product where a model's reading moves the number the
// gate reads, and "coverage rose" has to be checkable on the page — a reader must be able to tell a
// better profile from a chattier model.

test('H:a-vetted-row-is-marked-and-is-not-mistaken-for-agreement', () => {
  const v = evidencePresentation(evRow({ method: 'vetted', extra: 'vetted: challenged for what it fails to show...' }))
  assert.equal(v.vetted, true, 'a vetted row must be identifiable on the page')
  assert.equal(v.confirmedAt, null, 'and it is NOT a confirmation — no human has said yes')
  assert.equal(v.awaitingConfirmation, false,
    'the "awaiting your confirmation" state belongs to `proposed` alone; a vetted row already counts')

  for (const method of ['proposed', 'exact', 'anchored']) {
    assert.equal(evidencePresentation(evRow({ method })).vetted, false,
      `${method} must not be marked vetted`)
  }
  assert.equal(evidencePresentation({ evidenceState: 'none', evidence: null }).vetted, false,
    'an empty verdict is never vetted')
})

test('H:the-reason-a-row-counts-is-on-the-page-not-behind-a-click', () => {
  // `extra` renders inside the disclosure everywhere else, which is right for a supporting note on
  // an excerpt already visible. For a vetted row it is the ARGUMENT FOR A NUMBER THAT CHANGED, and
  // an argument nobody opens is an argument nobody checked.
  const jsx = readFileSync(new URL('../src/screens/PostingAnalysis.jsx', import.meta.url), 'utf8')
  const line = jsx.slice(jsx.indexOf('function EvidenceLine'), jsx.indexOf('function Group'))
  const why = line.indexOf('POSTING_HOOKS.vettedWhy')
  const disclosure = line.indexOf('{open && ev.provable && (')
  assert.ok(why > -1, 'the vetted reasoning has no renderer')
  assert.ok(disclosure > -1, 'the disclosure block moved — this scan has gone stale')
  assert.ok(why < disclosure,
    'the vetted reasoning must render OUTSIDE the "show the line" disclosure')
  // AND IT MUST ACTUALLY RENDER. The first version of this case checked only the POSITION of the
  // hook, so disabling the block outright — `{false && ev.extra && ...}` — passed it. Mutation
  // testing caught that (M34, 2026-09-01): a guard that pins where something sits and not whether
  // it happens is the inert kind this repo treats as worse than none, because it is believed.
  const block = line.slice(Math.max(0, why - 400), why)
  assert.match(block, /\{ev\.vetted && ev\.extra && \(/,
    'the vetted reasoning must be gated on ev.vetted && ev.extra — not disabled, not always-on')
  assert.match(line, /POSTING_HOOKS\.vetted[^W]/, 'the vetted marker itself must render')
  assert.match(line, /challenged for what it misses/,
    'the marker must say what vetted MEANS — the word alone is not self-explanatory')
})

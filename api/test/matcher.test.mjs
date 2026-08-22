// The purpose-made requirement->profile matcher, against the 44 criteria in
// docs/qc-evidence/AC-matcher.md.
//
// THE FIXTURE PROFILE IS NOT A COPY OF THE REQUIREMENTS, and that is the point of this file
// existing separately from `evidence.test.mjs`. Every POSITIVE fixture in that suite is a verbatim
// substring of its fixture profile (AC-matcher F8, re-asserted below as
// `H:evidence-fixtures-are-not-copies`), so the suite only ever exercised `locate`'s exact branch —
// which artificially restores the premise the defect was about. It could not have failed. The two
// cells that matter — a requirement TRUE of the profile but worded differently, and a requirement
// FALSE of the profile but sharing its vocabulary — were both empty.
//
// Naming: H-cases take two-word-minimum SLUGS. A numeric id fails `H26`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  profileRecords, resolveEvidence, resolveAll, refusalReason, sha256, verifyEvidence,
  RESOLVER_VERSION, EVIDENCE_THRESHOLD, MIN_JUDGEABLE_TOKENS, RESOLVE_MIN_TOKENS,
  EVIDENCE_MAX_SENTENCES, NEVER_EVIDENCE, DISTINCTIVE_LEN,
} from '../dist/functions/tests/evidence.js'
import {
  claimTokens, countTokensAcrossRecords, forms, sameWord, segments, listElements, supportIn,
  tokensOf, requirementClass, isContentful, isCategoryWord,
  SAFETY_FLOOR_RULES, GATE_ORDER, PRE_GATE_REASONS,
} from '../dist/functions/tests/requirementSupport.js'
import { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS } from '../dist/functions/tests/reviewer.js'
import { DEFAULT_THRESHOLDS } from '../dist/functions/tests/checks.js'
import { resolveOptionsFrom } from '../dist/functions/tests/checkPrefs.js'
import { writeEvidence, shapeRequirementsForApi } from '../dist/functions/tests/appRequirements.js'
import {
  verifyProposal, worthEscalating, PROPOSAL_VERSION, PROPOSAL_SYSTEM,
} from '../dist/functions/tests/evidenceProposal.js'

const SRC = path.join(import.meta.dirname, '..', 'src', 'functions', 'tests')
const src = f => fs.readFileSync(path.join(SRC, f), 'utf8')
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// --- the fixture profile -------------------------------------------------------------------------
//
// Written as a résumé is written: past tense, first-person-implied, achievement-shaped. The
// requirements below are written as an employer writes them: imperative and nominal. That mismatch
// IS the defect, so the fixture has to contain it.
const MC = {
  workHistory1: [
    'VP Engineering, Resideo 2021-2025.',
    'Built and promoted a high-performing engineering culture.',
    'Managed remote engineering teams across three time zones.',
    'Delivered the platform modernization programme across four product lines.',
  ].join('\n'),
  workHistory2: [
    'Director of Digital Technology, Trinnex 2017-2021.',
    'Owned the digital water technology roadmap with Product and Design.',
    'Ran the enterprise data warehouse and the analytics pipeline.',
    'Owned the IoT data models and the geospatial data programme.',
  ].join('\n'),
  coreAccomplishments: [
    'Established the SOC 2 Type II compliance programme from nothing.',
    'Grew the platform organisation from twelve to sixty engineers.',
  ].join('\n'),
  executiveProfile: 'Technology executive with two decades of experience running engineering organisations.',
  skills1: 'AI/ML platforms, cloud infrastructure, and data governance',
  skills2: 'AI/ML tooling, observability, and incident response',
  // The owner's ban list. Never a source of evidence — two locks, both asserted below.
  itemsToOmit: 'Kubernetes cluster federation',
}
const RECS = profileRecords(MC, null)

/**
 * The loosest configuration the settings store permits. M17: the floor must hold HERE too.
 *
 * `genericRecords` is NOT here — it is not an owner setting (see
 * `requirementSupport.GENERIC_RECORDS`'s comment for why exposing it would let the loosest M11
 * setting be the setting that disables M10).
 */
const LOOSEST = { threshold: 0, minTokens: 1, maxSentences: 3 }

const CULTURE_SENTENCE = 'Built and promoted a high-performing engineering culture.'

/**
 * What a RATIO-ONLY matcher would have said — the counterfactual, so a refusal can be attributed to
 * the rule that made it rather than to the requirement being unmatchable anyway.
 *
 * `postingCompare.test.mjs:4-6` records the discipline: a guard never seen to fail is not known to
 * be a guard. This file cannot delete a rule from the compiled source, so it measures what the
 * judgement WOULD have been with only the tunable half applied, and asserts that it clears the
 * loosest threshold. A refusal that survives that is a refusal the safety floor produced.
 */
function ratioOnlyBest(requirement, records, maxSentences = 1) {
  const want = claimTokens(requirement)
  let best = 0
  for (const rec of records) {
    if (NEVER_EVIDENCE.has(rec.key)) continue
    for (const span of segments(rec.text, maxSentences)) {
      const excerpt = rec.text.slice(span.start, span.end)
      if (excerpt.length < MIN_QUOTE_CHARS) continue
      const have = tokensOf(excerpt).map(x => x.t)
      const hit = want.filter(t => have.includes(t) || have.some(h => sameWord(t, h)))
      best = Math.max(best, hit.length / want.length)
    }
  }
  return best
}

// =================================================================================================
// A. Happy path — M1 to M4
// =================================================================================================

test('M1/M2: the stored row is the record\'s own bytes at its own offsets, and satisfies every DB CHECK', () => {
  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)
  assert.ok(ev, 'a requirement the profile supports in different words must resolve')

  const rec = RECS.find(r => r.key === ev.source_key)
  // M1 — byte-for-byte, against the ORIGINAL record text, not a normalized intermediate.
  assert.equal(rec.text.slice(ev.char_start, ev.char_end), ev.quote)
  // M2 — the four database CHECKs, asserted here so an insert cannot be the first thing to try them.
  assert.ok(ev.char_start >= 0 && ev.char_end > ev.char_start, 'char_end > char_start >= 0')
  assert.equal(ev.quote.length, ev.char_end - ev.char_start, 'length(quote) = char_end - char_start')
  assert.ok(['exact', 'anchored'].includes(ev.method), `method '${ev.method}' is inside the stored CHECK`)
  assert.match(ev.record_sha256, /^[0-9a-f]{64}$/)
  assert.equal(ev.record_sha256, sha256(rec.text))
  assert.equal(ev.resolver_version, RESOLVER_VERSION)
})

test('M2b: a quote is ONE contiguous slice — never stitched from two spans', () => {
  // Every span `segments()` produces is [start,end) of the original, and a multi-sentence candidate
  // runs from the first sentence's start to the last one's end, so whatever separates them is
  // INCLUDED. That is what keeps `length(quote) = char_end - char_start` true. Asserted over every
  // span the generator can emit, at the loosest setting, rather than over the one that won.
  for (const rec of RECS) {
    for (const span of segments(rec.text, 3)) {
      const q = rec.text.slice(span.start, span.end)
      assert.equal(q.length, span.end - span.start, `${rec.key} span ${span.start}..${span.end}`)
      assert.ok(span.end > span.start && span.start >= 0)
    }
  }
})

test('M3: the quote floors are IMPORTED from reviewer.ts, not redeclared', () => {
  // A second pair of numbers for "is this quote substantial" is a second answer to one question,
  // and the citation validator already owns it.
  assert.equal(MIN_QUOTE_CHARS, 20)
  assert.equal(MIN_QUOTE_WORDS, 4)
  const s = stripComments(src('evidence.ts'))
  assert.ok(/import \{ MIN_QUOTE_CHARS, MIN_QUOTE_WORDS \} from '\.\/reviewer'/.test(s),
    'evidence.ts must import the floors from reviewer.ts')
  assert.ok(!/MIN_QUOTE_(CHARS|WORDS)\s*=/.test(s), 'and must not redeclare either of them')
  assert.ok(!/MIN_QUOTE_(CHARS|WORDS)\s*=/.test(stripComments(src('requirementSupport.ts'))),
    'nor may the matcher module')

  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)
  assert.ok(ev.quote.length >= MIN_QUOTE_CHARS)
  assert.ok(ev.quote.trim().split(/\s+/).filter(Boolean).length >= MIN_QUOTE_WORDS)
})

test('M4: the row survives verifyEvidence against the same records — verified, note null', () => {
  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)
  const v = verifyEvidence(ev, RECS)
  assert.equal(v.state, 'verified')
  assert.equal(v.proof, true)
  assert.equal(v.note, null)
  assert.equal(v.recordChanged, false)
})

// =================================================================================================
// B. The three measured cases — M5 to M8
// =================================================================================================

test('M5: the profile\'s own tense still evidences, at the top of the scale', () => {
  const ev = resolveEvidence('Built and promoted a high-performing engineering culture', RECS)
  assert.ok(ev, 'the case that worked before must not be traded away for the case that did not')
  assert.equal(ev.quote, CULTURE_SENTENCE)
  assert.equal(ev.ratio, 1, 'every token matches literally, so the ranking score is 1')
  assert.equal(ev.method, 'exact', 'the requirement occurs literally inside the excerpt')
  assert.equal(ev.source_key, 'workHistory1')
})

test('M6: the imperative form evidences, AND returns the same span the past tense does', () => {
  const past = resolveEvidence('Built and promoted a high-performing engineering culture', RECS)
  const imperative = resolveEvidence('Build and promote a high-performing engineering culture', RECS)

  // (i) an evidence row exists. This is the half a threshold change could also have bought.
  assert.ok(imperative, 'tense alone must not decide whether the profile supports a claim')

  // (ii) THE HALF THAT MATTERS. `locate` anchored this on "high-performing engineering culture" —
  // it threw away the verb that IS the claim and then measured the threshold on what was left,
  // which is why the ratio fell from 1.00 to 0.60. An implementation that returns the short anchor
  // has fixed the COUNT while still presenting a fragment as the proof.
  assert.equal(imperative.quote, past.quote)
  assert.equal(imperative.char_start, past.char_start)
  assert.equal(imperative.char_end, past.char_end)
  assert.equal(imperative.quote, CULTURE_SENTENCE)
  assert.ok(imperative.quote.toLowerCase().includes('built and promoted'),
    'the excerpt must contain the verb, not only the noun phrase')
})

test('M7: "Ability to manage remote teams" resolves — it was unlocatable before', () => {
  // `locate` never produced a span at all for this one, so it exercises the new CANDIDATE
  // generation and not only the new scoring.
  const ev = resolveEvidence('Ability to manage remote teams', RECS)
  assert.ok(ev, 'the profile says the candidate managed remote teams')
  assert.equal(ev.source_key, 'workHistory1')
  assert.match(ev.quote, /Managed remote engineering teams/)
  assert.match(ev.quote, /remote/)
  assert.equal(RECS.find(r => r.key === ev.source_key).text.slice(ev.char_start, ev.char_end), ev.quote)
})

test('M8/H:evidence-fixtures-are-not-copies: positive fixtures are not verbatim copies of the profile', () => {
  // AC-matcher M40: "If only one criterion survives review, keep this one" — it is the only guard
  // that would have caught the defect before production, because every other test in
  // `evidence.test.mjs` passed while the resolver evidenced nothing on real data.
  const POSITIVE = [
    'Build and promote a high-performing engineering culture',
    'Ability to manage remote teams',
    'Built and promoted a high-performing engineering culture',   // M5 — pinned deliberately
  ]
  for (const req of POSITIVE) assert.ok(resolveEvidence(req, RECS), `positive fixture must resolve: ${req}`)

  const isCopy = req => RECS.some(r => r.text.toLowerCase().includes(req.trim().toLowerCase()))
  const notCopies = POSITIVE.filter(req => !isCopy(req))
  assert.ok(notCopies.length >= 2,
    `at least 2 positive fixtures must NOT be verbatim substrings of the profile; got ${notCopies.length}`)
  assert.equal(POSITIVE.filter(isCopy).length, 1, 'exactly one copy, and it exists to pin the exact case')
})

test('H:evidence-fixtures-are-not-copies (the original suite): the F8 measurement, kept as a check', () => {
  // F8 measured, not asserted: every positive fixture in evidence.test.mjs IS a verbatim substring
  // of its fixture profile. This test does not FAIL on that — that file is what it is — it pins the
  // claim so that a future reader can tell the two suites apart, and so that the fixture-shape rule
  // above is understood as a correction rather than a preference.
  const other = fs.readFileSync(path.join(import.meta.dirname, 'evidence.test.mjs'), 'utf8')
  assert.ok(other.includes('Led the platform modernization programme across four product lines'),
    'evidence.test.mjs still uses copy-of-the-profile fixtures; this suite is the one that does not')
})

// =================================================================================================
// C. False evidence — M9 to M17. Every one is asserted at the DEFAULT and at the LOOSEST config.
// =================================================================================================

const bothConfigs = (label, fn) => {
  test(label, () => {
    fn({}, 'default configuration')
    fn(LOOSEST, 'loosest reachable configuration (M17)')
  })
}

bothConfigs('M9: an eligibility clause is never evidenced by prose, at any setting', (opts, where) => {
  const REQ = 'Reside in the East Coast of the United States'
  assert.equal(resolveEvidence(REQ, RECS, opts), null, where)
  assert.equal(refusalReason(REQ, RECS, opts), 'eligibility', where)

  // Nor when the profile is seeded with every word that could look like a residence. A residence is
  // a fact about a person, not a phrase in a résumé.
  const baited = profileRecords({
    ...MC,
    workHistory3: 'Led United Water East Region delivery for the United States coast operations team.',
  }, null)
  assert.equal(resolveEvidence(REQ, baited, opts), null, `${where}: bait`)
  for (const bait of ['Must live within commuting distance of the office',
    'Authorized to work in the United States without sponsorship',
    'Active Top Secret clearance required']) {
    assert.equal(resolveEvidence(bait, baited, opts), null, `${where}: ${bait}`)
  }
})

bothConfigs('M10: generic vocabulary overlap alone is not evidence, at any setting', (opts, where) => {
  const REQ = 'Strong understanding of software engineering practices'
  assert.equal(resolveEvidence(REQ, RECS, opts), null, where)
  // `engineering` is the whole overlap and it occurs in more than one unrelated record — supplied by
  // the industry, not by the achievement.
  const counts = countTokensAcrossRecords(RECS.filter(r => !NEVER_EVIDENCE.has(r.key)))
  assert.ok(counts.get('engineering') > 1, 'engineering must measure as generic in this profile')
  assert.ok(!counts.get('software'), 'software appears in no record, so it is maximally specific')
})

bothConfigs('M11: a named technology is only evidenced by an excerpt that CONTAINS it', (opts, where) => {
  const REQ = 'Deep hands-on experience with Snowflake data warehousing'
  assert.equal(resolveEvidence(REQ, RECS, opts), null, where)
  assert.equal(refusalReason(REQ, RECS, opts), 'missing_specific_token', where)
  // `data` and `warehousing` both land — `warehousing` via the fold onto `warehouse`. Only the
  // exact-name rule stops this, which is `termMatch`'s case_sensitive_acronym reasoning one layer up.
  assert.ok(sameWord('warehousing', 'warehouse'))
})

test('M11 non-vacuity: the exact-name rule, not the ratio, is what refuses Snowflake', () => {
  const REQ = 'Deep hands-on experience with Snowflake data warehousing'
  // Reinstate the defect the rule bans — judge by ratio alone — and the case resolves at the
  // loosest reachable threshold. The rule is therefore load-bearing rather than decorative.
  assert.ok(ratioOnlyBest(REQ, RECS, 3) > LOOSEST.threshold,
    'a ratio-only matcher would have accepted this at the loosest setting')
  assert.equal(resolveEvidence(REQ, RECS, LOOSEST), null, 'and the rule refuses it anyway')
})

bothConfigs('M12: one member of a list never evidences the list, at any setting', (opts, where) => {
  const REQ = 'IoT data, models, geospatial data, and AI/ML'
  assert.deepEqual(listElements(REQ), ['IoT data', 'models', 'geospatial data', 'AI/ML'])
  assert.equal(resolveEvidence(REQ, RECS, opts), null, where)
  assert.ok(SAFETY_FLOOR_RULES.includes(refusalReason(REQ, RECS, opts)), where)
})

test('M12b: the conjunction rule refuses a list whose missing member is NOT a named entity', () => {
  // `AI/ML` is a named token, so the exact-name rule refuses seq-8 before the conjunction rule is
  // reached. This case has no named member, so only the conjunction rule can refuse it — which is
  // what makes the rule provably live rather than shadowed by a stricter one.
  const REQ = 'roadmap ownership, delivery quality, and vendor negotiation'
  assert.ok(listElements(REQ), 'must parse as a list')
  assert.equal(resolveEvidence(REQ, RECS), null)
})

test('M12 non-vacuity: the conjunction rule is the only thing refusing the 4-of-5 case', () => {
  // The fixture is built so that FOUR of the five elements land in one sentence
  // ("Owned the IoT data models and the geospatial data programme.") and the fifth — AI/ML — is
  // GENERIC, because it occurs in two unrelated records. Generic tokens are waived by the
  // exact-name rule, so nothing except the conjunction rule stands between this and a stored row.
  const REQ = 'IoT data, models, geospatial data, and AI/ML'
  const counts = countTokensAcrossRecords(RECS.filter(r => !NEVER_EVIDENCE.has(r.key)))
  assert.ok(counts.get('ai/ml') > 1, 'AI/ML must be generic here or this test proves nothing')
  assert.ok(ratioOnlyBest(REQ, RECS) >= EVIDENCE_THRESHOLD,
    'four of five tokens land in one sentence, which clears the default threshold on ratio alone')
  assert.equal(resolveEvidence(REQ, RECS), null, 'and it is refused anyway')

  // And the same requirement WITHOUT the unsupported element does resolve — so the refusal is about
  // the missing member, not about the shape of the sentence.
  assert.ok(resolveEvidence('IoT data, models, and geospatial data', RECS))
})

test('M12b: a verb conjunction is NOT a list — "Build and promote" must stay one requirement', () => {
  // Splitting on `and` alone would demand a standalone "build" AND a standalone "promote" and would
  // break M6. A list is a COMMA SERIES.
  assert.equal(listElements('Build and promote a high-performing engineering culture'), null)
  assert.equal(listElements('Ability to manage remote teams'), null)
  assert.ok(resolveEvidence('Build and promote a high-performing engineering culture', RECS))
})

bothConfigs('M13: years and money are not settled by prose, at any setting', (opts, where) => {
  for (const REQ of ['Minimum of 8 years of engineering leadership experience',
    'Manage a budget of $50M+ across the technology organisation',
    '15+ years of experience running platform teams']) {
    assert.equal(resolveEvidence(REQ, RECS, opts), null, `${where}: ${REQ}`)
    assert.equal(refusalReason(REQ, RECS, opts), 'numeric', `${where}: ${REQ}`)
  }
  // These belong to the FACT path (dimensions.ts basis:'fact'), where a stored number meets a stated
  // number. H41b already forbids the mirror image: total years cannot stand in for a leadership fact.
})

test('M13 non-vacuity: the old resolver got this right BY ACCIDENT, and the accident is gone', () => {
  // `itemTokens` dropped `years`/`experience` as stopwords and dropped the bare `8` for being one
  // character, so the requirement fell below MIN_JUDGEABLE_TOKENS and returned null — the right
  // answer for the wrong reason. This matcher raises the token yield, so the rule has to be stated.
  const LONG = '15+ years of experience running platform engineering teams at scale'
  assert.ok(claimTokens(LONG).length >= MIN_JUDGEABLE_TOKENS,
    `the new tokenizer yields ${claimTokens(LONG).length} tokens, so the accident no longer protects us`)
  assert.equal(refusalReason(LONG, RECS), 'numeric', 'the RULE refuses it, not the token count')
  assert.equal(resolveEvidence(LONG, RECS), null)
  // And the class is decided BEFORE the token gate, so a short one is not mislabelled `unjudgeable`.
  assert.equal(requirementClass('Minimum of 8 years of experience'), 'numeric')
  assert.equal(refusalReason('Minimum of 8 years of experience', RECS), 'numeric')
})

bothConfigs('M14: the banned list stays banned at BOTH locks, at any setting', (opts, where) => {
  const REQ = 'Deep experience with Kubernetes cluster federation'
  // Lock 1 — `profileRecords` never emits the record at all.
  assert.equal(RECS.find(r => r.key === 'itemsToOmit'), undefined)
  assert.equal(resolveEvidence(REQ, RECS, opts), null, where)

  // Lock 2 — the filter BYPASSED. A matcher that relies only on lock 1 has removed a door.
  const bypassed = [...RECS, {
    key: 'itemsToOmit', kind: 'profile_field', label: 'Items to omit', text: MC.itemsToOmit,
  }]
  assert.equal(resolveEvidence(REQ, bypassed, opts), null, `${where}: filter bypassed`)
  assert.ok(NEVER_EVIDENCE.has('itemsToOmit'))
})

test('M15/H29: a phrase that spans two records is never evidenced by joining them', () => {
  // The guarantee is STRUCTURAL, not threshold-shaped: a winning row names exactly one source_key
  // and its offsets index that record's own text, so no candidate can ever be a synthesis of two
  // records — `sourceText()` joins with `\n\n` for OTHER purposes and the citation validator's
  // matching is whitespace-tolerant, which is exactly the hole this guards. Framed as "null at any
  // threshold" this over-claims: at threshold 0 a requirement can still resolve on a PARTIAL match
  // confined to one record (that is what threshold 0 means), and that is not the H29 defect.
  const REQ = 'Owned the digital water technology programme from nothing'
  const split = profileRecords({
    aboutMe1: 'Owned the digital water technology',
    aboutMe2: 'programme from nothing across the estate',
  }, null)
  for (const opts of [{}, LOOSEST]) {
    const ev = resolveEvidence(REQ, split, opts)
    if (!ev) continue
    const rec = split.find(r => r.key === ev.source_key)
    assert.equal(rec.text.slice(ev.char_start, ev.char_end), ev.quote,
      'a winning row is confined to the ONE record it names — never a blend of two')
    assert.ok(ev.ratio < 1, 'and it must not have been given credit for the other record\'s words')
  }
  // At the DEFAULT threshold specifically, the requirement is genuinely unsupported.
  assert.equal(resolveEvidence(REQ, split), null, 'default: no single record clears 0.7 alone')

  // Joined into ONE record, the same words DO evidence it fully — which is what makes the split
  // case a real guard rather than a requirement nothing could ever match.
  const whole = profileRecords({
    aboutMe1: 'Owned the digital water technology programme from nothing across the estate.',
  }, null)
  assert.ok(resolveEvidence(REQ, whole), 'joined into one record, it resolves')
})

bothConfigs('M16: negation and attribution are REFUSED, deliberately and by decision', (opts, where) => {
  // THE DECISION, stated rather than left to silence: these are refused. An excerpt printed beside a
  // requirement IS the claim "your profile says this", and attributing someone else's accomplishment
  // to the candidate is the highest-severity output this system can produce. The cost is stated in
  // `requirementSupport.NEGATION_RE`'s comment: some true matches are refused, which surfaces the
  // requirement to a human. That is the direction this module errs in.
  const attributed = profileRecords({
    aboutMe1: 'Reported to the leader who owned the P&L for the water technology division.',
  }, null)
  assert.equal(resolveEvidence('Own the P&L for the water technology division', attributed, opts), null, where)

  const negated = profileRecords({
    aboutMe1: 'Declined to take on remote engineering teams during the reorganisation period.',
  }, null)
  assert.equal(resolveEvidence('Ability to manage remote engineering teams', negated, opts), null, where)
})

test('M16 non-vacuity: without the attribution rule the P&L sentence would have resolved', () => {
  const attributed = profileRecords({
    aboutMe1: 'Reported to the leader who owned the P&L for the water technology division.',
  }, null)
  assert.ok(ratioOnlyBest('Own the P&L for the water technology division', attributed, 3) >= EVIDENCE_THRESHOLD,
    'every content word of the requirement is in that sentence — it clears the ratio easily')
  assert.equal(resolveEvidence('Own the P&L for the water technology division', attributed, LOOSEST), null)
})

test('M17/M37: the safety floor is not owner-configurable, and the list says exactly which rules', () => {
  // An owner may tune how much evidence is enough. An owner may not turn on false provenance.
  assert.deepEqual(SAFETY_FLOOR_RULES, [
    'eligibility', 'numeric', 'missing_specific_token', 'generic_overlap_only',
    'list_element_unsupported', 'negated_or_attributed', 'banned_source',
  ])
  // Every floor reason must be reachable from `supportIn`, or the list is describing rules that do
  // not exist — the "guard that has only ever seen an empty input set" failure.
  for (const r of SAFETY_FLOOR_RULES) {
    assert.ok([...GATE_ORDER, ...PRE_GATE_REASONS].includes(r), `${r} must be a real refusal reason`)
  }
  // And no floor rule may read a value out of ResolveOptions.
  const s = stripComments(src('requirementSupport.ts'))
  assert.ok(!/ELIGIBILITY_RE|NUMERIC_RE|NEGATION_RE|ATTRIBUTION_RE/.test(
    s.slice(s.indexOf('export interface SupportInput'), s.indexOf('export interface SupportResult'))),
    'the floor patterns must not be part of the configurable input surface')
})

// =================================================================================================
// D. Determinism and offset integrity — M18 to M22
// =================================================================================================

test('M18: identical inputs produce deepEqual rows, and nothing on this path can reach a network', () => {
  const REQ = 'Build and promote a high-performing engineering culture'
  assert.deepEqual(resolveEvidence(REQ, RECS), resolveEvidence(REQ, RECS))
  assert.deepEqual(resolveEvidence(REQ, RECS), resolveEvidence(REQ, profileRecords(MC, null)))
  assert.deepEqual(resolveAll([{ seq: 0, verbatim: REQ, item_text: '' }], RECS),
    resolveAll([{ seq: 0, verbatim: REQ, item_text: '' }], RECS))

  for (const f of ['evidence.ts', 'requirementSupport.ts']) {
    const s = stripComments(src(f))
    assert.ok(!/Date\.now\(|Math\.random\(|new Date\(/.test(s), `${f} must be deterministic`)
    assert.ok(!/require\(|from ['"](node:)?(http|https|net|dns)['"]|fetch\(|openai/i.test(s),
      `${f} must not be able to reach a network`)
  }
  // Record order is fixed by `profileRecords` sorting on key, so an Azure Table's property order
  // cannot move an offset. Re-asserted here because the resolver now depends on it for tie-breaks.
  const keys = RECS.map(r => r.key)
  assert.deepEqual(keys, [...keys].sort())
})

test('M19/H:offsets-from-original: a case-expanding prefix does not move char_start', () => {
  // H32's own set. `toLowerCase()` is NOT length-preserving — U+0130 lowercases to TWO code units —
  // so an index into a lower-cased copy is not an index into the original. THE TRAP: the substring
  // property HELD while the offsets were wrong, so `slice(start,end) === quote` cannot detect this.
  // The offset is therefore compared against an independently computed `indexOf`.
  for (const prefix of ['', 'İ ', 'İİ ', 'İİİİİ ', 'ẞ ', 'ﬁﬁﬁ ']) {
    const body = `${prefix}Resideo delivery.\n${CULTURE_SENTENCE}\nMore text follows here.`
    const recs = profileRecords({ workHistory1: body }, null)
    const ev = resolveEvidence('Build and promote a high-performing engineering culture', recs)
    assert.ok(ev, `must still resolve with prefix ${JSON.stringify(prefix)}`)
    const rec = recs.find(r => r.key === ev.source_key)
    assert.equal(ev.char_start, rec.text.indexOf(CULTURE_SENTENCE),
      `char_start must equal the index measured on the ORIGINAL, prefix ${JSON.stringify(prefix)}`)
    assert.equal(rec.text.slice(ev.char_start, ev.char_end), ev.quote)
  }
})

test('M19b/M20: no offset is ever taken from a transformed copy of the record', () => {
  // The structural half of M19: the invariant is not "these five characters work", it is that no
  // index is ever measured against a rewritten string. `tokensOf` takes `m.index` on the string it
  // was handed; `segments` takes its bounds from `sentenceBounds` on the same string; the only
  // lower-casing is applied to the TOKEN, after its offsets are recorded.
  const s = stripComments(src('requirementSupport.ts'))
  for (const bad of [/\.toLowerCase\(\)[\s\S]{0,40}\.indexOf\(/, /normalize\(/, /termNormalize/]) {
    assert.ok(!bad.test(s), `offsets must not derive from a transformed copy: ${bad}`)
  }
  // `tokensOf` must record the offset before the token is folded, and it must be the ONLY tokenizer
  // in the module that produces spans.
  assert.ok(/out\.push\(\{ t, s: m\.index, e: m\.index \+ m\[0\]\.length \}\)/.test(s))
})

test('M21/H2: records are toBmp-folded, so a JS UTF-16 offset is a Postgres character offset', () => {
  const rec = profileRecords({ aboutMe1: 'Ran the \u{1F600} platform organisation for the water utility estate.' }, null)[0]
  assert.ok(!/[\u{10000}-\u{10FFFF}]/u.test(rec.text), 'astral characters must be folded out of the record')
  // The length check in the database is what this protects: a surrogate pair counts as two in JS
  // and one in Postgres, so an unfolded record makes `length(quote) = char_end - char_start` false.
  assert.equal([...rec.text].length, rec.text.length)
})

test('M22: the resolver tie-break is the SAME order the read-path join uses', () => {
  // `loadRequirementsWithEvidence` orders by `ratio desc nulls last, source_key, char_start`. The
  // resolver must rank the same way or the two disagree about which excerpt is "the" one. The
  // previous version broke ties by ARRAY order, which is NOT the same: `profileRecords` puts the
  // resume template FIRST while its key (`resume_template:...`) sorts LAST.
  const join = src('appRequirements.ts')
  assert.ok(/order by x\.ratio desc nulls last, x\.source_key, x\.char_start/.test(join),
    'the join order this test is pinned to must still be there')

  // Two records that support the requirement identically. `bbb` is passed FIRST in array order and
  // `aaa` must still win, because `aaa` < `bbb` as a source_key.
  const SENT = 'Managed remote engineering teams across three time zones.'
  const tied = [
    { key: 'bbb', kind: 'profile_field', label: 'B', text: SENT },
    { key: 'aaa', kind: 'profile_field', label: 'A', text: SENT },
  ]
  const ev = resolveEvidence('Ability to manage remote teams', tied)
  assert.equal(ev.source_key, 'aaa', 'ties break by source_key ascending, not by array position')

  // And a strictly better ratio still wins regardless of key order.
  const better = [
    { key: 'aaa', kind: 'profile_field', label: 'A', text: 'Managing the remote programme for engineering delivery teams.' },
    { key: 'zzz', kind: 'profile_field', label: 'Z', text: SENT },
  ]
  const ev2 = resolveEvidence('Managed remote engineering teams', better)
  assert.equal(ev2.source_key, 'zzz')
  assert.equal(ev2.ratio, 1)
})

// =================================================================================================
// E. Extends, does not fork — M23 to M33
// =================================================================================================

test('M23: the storage contract keeps every field, and any added join column is evidence_-prefixed', () => {
  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)
  for (const f of ['quote', 'source_kind', 'source_label', 'source_key', 'char_start', 'char_end',
    'extra', 'ratio', 'method', 'record_sha256', 'resolver_version']) {
    assert.ok(f in ev, `EvidenceRow must still carry ${f}`)
  }
  // `verifyRequirementRows` redacts BY PREFIX, so a column that misses the prefix leaks a fragment
  // of a withdrawn excerpt to the UI.
  const s = src('appRequirements.ts')
  assert.ok(/evidence_/.test(s), 'the evidence_ prefix convention must still exist')
})

test('M24: the pre-store assertion is unchanged, and its comment no longer claims it cannot fire', () => {
  const s = src('appRequirements.ts')
  assert.ok(/rec\.text\.slice\(e\.char_start, e\.char_end\) !== e\.quote\) \{ refused\+\+; continue \}/.test(s),
    'the accusation-grade pre-store assertion must remain exactly as it is')
  // The comment used to say the check "structurally cannot" reject anything, because `locate`
  // constructed its verbatim by slicing. `locate` is no longer the matcher, so that sentence became
  // false — and a false comment about a guard is worse than no comment.
  assert.ok(!/structurally cannot today/.test(s), 'the stale claim must be gone')
  assert.ok(/CORRECTED 2026-08-21/.test(s), 'and replaced with what is true now')
})

test('M25/H:refusal-guard-fires: `refused` increments and NOTHING is inserted', () => {
  // A guard that has only ever seen an empty input set is `not_applicable`, not `pass`. This drives
  // `writeEvidence` through its resolver seam with a row whose quote is NOT the record's bytes.
  const rec = { key: 'aboutMe1', kind: 'profile_field', label: 'About me', text: 'Ran the platform organisation.' }
  const inserts = []
  const client = {
    async query(sql, params) {
      if (/from requirement where opp_id/.test(sql)) {
        return { rows: [{ id: 'r1', seq: 0, verbatim: 'anything at all', item_text: '' }] }
      }
      if (/^\s*insert into requirement_evidence/.test(sql)) { inserts.push(params); return { rows: [] } }
      return { rows: [] }
    },
  }
  const liar = () => ([{
    seq: 0, requirement_text: 'anything at all',
    evidence: {
      quote: 'a quote that is not in the record', source_kind: 'profile_field',
      source_label: 'About me', source_key: 'aboutMe1', char_start: 0, char_end: 33,
      extra: null, ratio: 1, method: 'anchored', record_sha256: sha256(rec.text),
      resolver_version: RESOLVER_VERSION,
    },
  }])

  return writeEvidence(client, 'opp-1', [rec], {}, liar).then(out => {
    assert.equal(out.refused, 1, 'the refusal must be counted')
    assert.equal(inserts.length, 0, 'and nothing may be inserted')
    assert.equal(out.evidenced, 0, 'a refused row is not evidenced')
  })
})

test('M25b: the same seam with an HONEST row inserts exactly one', () => {
  // The other half — without it, "refused increments" could be true because the path always refuses.
  const rec = { key: 'aboutMe1', kind: 'profile_field', label: 'About me', text: 'Ran the platform organisation.' }
  const inserts = []
  const client = {
    async query(sql, params) {
      if (/from requirement where opp_id/.test(sql)) {
        return { rows: [{ id: 'r1', seq: 0, verbatim: 'anything at all', item_text: '' }] }
      }
      if (/^\s*insert into requirement_evidence/.test(sql)) { inserts.push(params); return { rows: [] } }
      return { rows: [] }
    },
  }
  const honest = () => ([{
    seq: 0, requirement_text: 'anything at all',
    evidence: {
      quote: rec.text.slice(0, 29), source_kind: 'profile_field', source_label: 'About me',
      source_key: 'aboutMe1', char_start: 0, char_end: 29, extra: null, ratio: 1,
      method: 'anchored', record_sha256: sha256(rec.text), resolver_version: RESOLVER_VERSION,
    },
  }])
  return writeEvidence(client, 'opp-1', [rec], {}, honest).then(out => {
    assert.equal(out.refused, 0)
    assert.equal(inserts.length, 1)
    assert.equal(out.evidenced, 1)
  })
})

test('M26: record_sha256 still names the record body the offsets were measured on', () => {
  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)
  const rec = RECS.find(r => r.key === ev.source_key)
  assert.equal(ev.record_sha256, sha256(rec.text))

  // `misresolved` must stay REACHABLE: a byte-identical record whose offsets do not yield the quote
  // is a bad write, not an edit the owner never made.
  const bad = { ...ev, char_start: ev.char_start + 3 }
  assert.equal(verifyEvidence(bad, RECS).state, 'misresolved')
  // And an actual edit is `stale`, not `misresolved`.
  const edited = RECS.map(r => r.key === rec.key ? { ...r, text: `Prefixed. ${r.text}` } : r)
  assert.equal(verifyEvidence(ev, edited).state, 'stale')
})

test('M28: replace, never append — a re-resolve deletes this opportunity\'s rows first', () => {
  const s = src('appRequirements.ts')
  assert.ok(/delete from requirement_evidence e using requirement r\s*\n\s*where e\.requirement_id = r\.id and r\.opp_id = \$1/.test(s),
    'the scoped delete must survive')
  assert.ok(s.indexOf("await client.query('begin')") < s.indexOf('delete from requirement_evidence'),
    'and it must be inside the transaction with the inserts')
})

test('M29: RESOLVER_VERSION is bumped and stored rows carry it', () => {
  assert.ok(RESOLVER_VERSION > 1, 'a row must be attributable to a ruleset, and the ruleset changed')
  assert.equal(RESOLVER_VERSION, 2)
  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)
  assert.equal(ev.resolver_version, RESOLVER_VERSION)
})

test('M30/H40: the DETERMINISTIC resolver emits only its own two methods, and the CHECK matches', () => {
  // WIDENED 2026-08-21, and the original version of this case was RIGHT about the danger in a way
  // worth preserving. It said: adding a third method value would have to go on the cold path,
  // because `ensureEvidenceTable` is on the hot path precisely so that `create table if not exists`
  // takes no lock, and a `drop constraint`/`add constraint` pair there takes an ACCESS EXCLUSIVE
  // lock that four artifacts of one packet can hit at once. When the escalation tier added
  // `proposed`, that pair was put on the hot path anyway — this comment did not stop it, an
  // adversarial review did. So the prose became an assertion; see the last block.
  //
  // The invariant that did NOT change, and is the important half: the deterministic resolver still
  // emits only `exact` and `anchored`. `proposed` comes from `evidenceProposal`, never from here. If
  // `resolveEvidence` ever emitted it, a model-provenance stamp would appear on a row no model
  // touched — the provenance lie in the opposite direction from the one the column exists to stop.
  const emitted = new Set()
  for (const req of ['Built and promoted a high-performing engineering culture',
    'Build and promote a high-performing engineering culture', 'Ability to manage remote teams']) {
    const ev = resolveEvidence(req, RECS)
    if (ev) emitted.add(ev.method)
  }
  for (const m of emitted) assert.ok(m === 'exact' || m === 'anchored',
    `the deterministic resolver emitted ${m} — only evidenceProposal may produce a third value`)
  const ev = stripComments(src('evidence.ts'))
  assert.ok(!/method: '(?!exact|anchored)/.test(ev), 'evidence.ts may not emit a third method value')

  // Both declarations carry the SAME union, or an insert that one permits the other rejects.
  for (const [file, re] of [
    ['appRequirements.ts', /method\s+text not null check \(method in \('exact','anchored','proposed'\)\)/],
    ['schema.ts', /method in \('exact','anchored','proposed'\)/],
  ]) assert.ok(re.test(src(file)), `${file} must declare the three-value union`)

  // THE LESSON, AS AN ASSERTION RATHER THAN A PARAGRAPH. `ensureEvidenceTable` runs on every
  // request and four artifacts of one packet enter it concurrently. `create table if not exists`
  // and `add column if not exists` are catalogue-only; `drop constraint` / `add constraint` take an
  // ACCESS EXCLUSIVE lock and would present as intermittent 500s under concurrency rather than as a
  // migration bug. The constraint swap belongs in SCHEMA_SQL, which the deploy applies once.
  const ensure = stripComments(src('appRequirements.ts'))
  const fn = ensure.slice(ensure.indexOf('export async function ensureEvidenceTable'),
                          ensure.indexOf('export async function ensureRequirementCols'))
  assert.ok(fn.length > 100, 'the ensure function moved — this scan has gone stale')
  assert.ok(!/drop\s+constraint/i.test(fn),
    'ensureEvidenceTable takes an ACCESS EXCLUSIVE lock on the hot path — move the constraint swap to SCHEMA_SQL')
  assert.ok(!/add\s+constraint/i.test(fn),
    'ensureEvidenceTable adds a constraint on the hot path — that is the same lock')
})

test('M33/H4b: similarity() must not appear in the resolve path — INCLUDING the new module', () => {
  // H4 measured it: similarity('Skill number 0','Skill number 3') > 0.9, because the shared
  // stopwords carry the score. Anything that ACCUSES must be exact.
  for (const f of ['evidence.ts', 'requirementSupport.ts']) {
    assert.ok(!/\bsimilarity\(/.test(stripComments(src(f))),
      `${f} is on the resolve path and must not use fuzzy similarity`)
  }
  // The guard has to name the new module or it silently stops watching the code it was written for.
  const hard = fs.readFileSync(path.join(import.meta.dirname, 'hardening.test.mjs'), 'utf8')
  assert.ok(/requirementSupport/.test(hard), 'H4b in hardening.test.mjs must cover the new module too')
})

// =================================================================================================
// F. Configuration — M34 to M37
// =================================================================================================

test('M34: every knob the matcher introduces has a chk_ column and a ResolveOptions path', () => {
  const prefs = src('checkPrefs.ts')
  // `genericRecords` is deliberately ABSENT — M37's exception, not M34's rule. See
  // `requirementSupport.GENERIC_RECORDS`.
  assert.ok(!/generic/i.test(prefs), 'M10\'s generic-vocabulary detection must not be a setting')
  for (const [col, field] of [
    ['chk_evidence_threshold', 'evidenceThreshold'],
    ['chk_evidence_min_tokens', 'evidenceMinTokens'],
    ['chk_evidence_max_sentences', 'evidenceMaxSentences'],
  ]) {
    assert.ok(prefs.includes(`add column if not exists ${col}`), `${col} must be added to owner_search_prefs`)
    assert.ok(prefs.includes(`${field}:`), `${col} must be read into CheckThresholds.${field}`)
  }
  // It EXTENDS owner_search_prefs. No new settings table.
  assert.ok(/create table if not exists owner_search_prefs/.test(prefs))
  assert.ok(!/create table if not exists (evidence|matcher)_(prefs|settings)/.test(prefs))

  // The seeded first values are the code constants, so the default and the column cannot drift.
  assert.equal(DEFAULT_THRESHOLDS.evidenceThreshold, EVIDENCE_THRESHOLD)
  // Tracks the RESOLVER's floor: `writeEvidence` feeds it straight into `resolveEvidence`, so it
  // must mean what that function means. The shared `MIN_JUDGEABLE_TOKENS` (3) belongs to
  // `dimensions.ts`/`checks.ts` and is deliberately a different number.
  assert.equal(DEFAULT_THRESHOLDS.evidenceMinTokens, RESOLVE_MIN_TOKENS)
  assert.equal(MIN_JUDGEABLE_TOKENS, 3)
  assert.equal(DEFAULT_THRESHOLDS.evidenceMaxSentences, EVIDENCE_MAX_SENTENCES)

  // And each one actually changes behaviour, or it is a column pretending to be a setting.
  assert.equal(resolveEvidence('Build and promote a high-performing engineering culture', RECS, { threshold: 1.01 }), null)
  assert.ok(resolveEvidence('Build and promote a high-performing engineering culture', RECS, { threshold: 0.5 }))
  assert.equal(resolveEvidence('Ability to manage remote teams', RECS, { minTokens: 9 }), null)
  assert.ok(segments(MC.workHistory1, 2).length > segments(MC.workHistory1, 1).length,
    'maxSentences must change the candidate set')
})

test('M35/H:evidence-opts-reach-every-caller: EVERY writeEvidence call site passes options', () => {
  // F10: `appChecks.evaluateArtifact` passed the owner's thresholds; `evidenceResolve` and
  // `requirementsBackfill` did NOT — so the route in the defect used the seeded literals and the
  // owner's settings applied on one of three call sites. The existing guard passed because it
  // grepped `appChecks.ts` alone: the single-file-grep failure CLAUDE.md names.
  //
  // ENUMERATED BY GREP, not by naming files, for exactly that reason.
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts'))
  const sites = []
  for (const f of files) {
    const s = stripComments(src(f))
    for (const m of s.matchAll(/writeEvidence\(([^)]*)\)/g)) {
      if (/^\s*$/.test(m[1])) continue
      if (/client: any, oppId/.test(m[1])) continue          // the declaration itself
      sites.push({ file: f, args: m[1] })
    }
  }
  assert.ok(sites.length >= 3, `expected at least 3 call sites, found ${sites.length}`)
  for (const s of sites) {
    assert.ok(/,\s*(\{|await resolveOptionsFor|evOpts|opts)/.test(s.args) || s.args.split(',').length >= 4,
      `writeEvidence in ${s.file} must pass options: ${s.args.trim()}`)
  }
  // And there is exactly ONE place that builds them, so a fourth caller cannot invent its own.
  assert.equal(src('checkPrefs.ts').match(/export async function resolveOptionsFor/g).length, 1)
})

test('M36: an owner who has set nothing gets the seeded defaults and a real answer', () => {
  // `loadThresholds` returns `{}` for an owner with no row. Every ResolveOptions field is optional,
  // so `{}` must fall through to the seeded values — NOT to zero, which would evidence everything.
  const unset = { threshold: undefined, minTokens: undefined, maxSentences: undefined }
  for (const opts of [{}, unset]) {
    assert.ok(resolveEvidence('Built and promoted a high-performing engineering culture', RECS, opts))
    assert.ok(resolveEvidence('Build and promote a high-performing engineering culture', RECS, opts))
    assert.ok(resolveEvidence('Ability to manage remote teams', RECS, opts))
    // and the floor still holds for the unconfigured owner
    assert.equal(resolveEvidence('Reside in the East Coast of the United States', RECS, opts), null)
  }
  // An unconfigured owner must not be the "evidences nothing" case — that IS the production state.
  const spine = resolveAll([
    { seq: 0, verbatim: 'Build and promote a high-performing engineering culture', item_text: '' },
    { seq: 1, verbatim: 'Ability to manage remote teams', item_text: '' },
    { seq: 2, verbatim: 'Reside in the East Coast of the United States', item_text: '' },
  ], RECS)
  assert.equal(spine.filter(r => r.evidence).length, 2)
  assert.equal(spine.find(r => r.seq === 2).evidence, null)
})

// =================================================================================================
// G. Downstream — M38
// =================================================================================================

test('M38: the resolver still produces what every downstream consumer reads', () => {
  const ev = resolveEvidence('Build and promote a high-performing engineering culture', RECS)

  // 1 — the ONE join: `ratio` must stay a populated, comparable number.
  assert.equal(typeof ev.ratio, 'number')
  assert.ok(ev.ratio >= 0 && ev.ratio <= 1 && Number.isFinite(ev.ratio))

  // 2/3 — verifyEvidence's states and the evidenced/unevidenced identity.
  const spine = resolveAll([
    { seq: 0, verbatim: 'Build and promote a high-performing engineering culture', item_text: '' },
    { seq: 1, verbatim: 'Reside in the East Coast of the United States', item_text: '' },
  ], RECS)
  const evidenced = spine.filter(r => r.evidence).length
  assert.equal(evidenced + (spine.length - evidenced), spine.length, 'evidenced + unevidenced === total')
  assert.equal(verifyEvidence(null, RECS).state, 'none')
  assert.equal(verifyEvidence(ev, null).state, 'unverified', 'unreadable profile is never verified')

  // 6 — profileReadable is `records.length > 0`, never []-as-readable.
  assert.equal(resolveEvidence('Build and promote a high-performing engineering culture', []), null)

  // 9 — `evidence_placed`'s `placeable` filter is MIN_JUDGEABLE_TOKENS on `itemTokens`, which this
  // change does not touch. Pinned so a later tokenizer swap has to notice it.
  assert.equal(MIN_JUDGEABLE_TOKENS, 3)
  assert.equal(DISTINCTIVE_LEN, 6)
})

// =================================================================================================
// H. The matcher's own primitives
// =================================================================================================

test('the fold: enumerated, and it does NOT reintroduce the stems termMatch rejected', () => {
  for (const [a, b] of [['built', 'build'], ['promoted', 'promote'], ['managed', 'manage'],
    ['managing', 'manage'], ['teams', 'team'], ['strategies', 'strategy'], ['led', 'lead'],
    ['grew', 'grow'], ['ran', 'run'], ['running', 'run'], ['identified', 'identify'],
    ['warehousing', 'warehouse'], ['delivered', 'deliver']]) {
    assert.ok(sameWord(a, b), `${a} must fold onto ${b}`)
    assert.ok(sameWord(b, a), 'and the relation must be symmetric')
  }
  // The two cases `termMatch.ts:15` names as the reason it rejected stemming.
  assert.ok(!forms('ops').has('op'), 'ops must not stem to op')
  assert.ok(!forms('sre').has('sr'), 'sre must not stem to sr')
  assert.ok(!sameWord('ops', 'op'))
  // And it must not fold unrelated words together.
  for (const [a, b] of [['managed', 'manager'], ['data', 'date'], ['culture', 'cultural'],
    ['platform', 'perform'], ['water', 'waiter']]) {
    assert.ok(!sameWord(a, b), `${a} must NOT fold onto ${b}`)
  }
})

test('segments: sentence bounds AND line bounds, with abbreviations intact', () => {
  const text = 'Must be a U.S. Citizen for this role.\nSaaS vs. Services margin tracking was owned here.'
  const spans = segments(text, 1)
  const got = spans.map(s => text.slice(s.start, s.end))
  assert.ok(got.includes('Must be a U.S. Citizen for this role.'), `abbreviation kept: ${JSON.stringify(got)}`)
  assert.ok(got.some(g => g.startsWith('SaaS vs. Services')), `line boundary respected: ${JSON.stringify(got)}`)
  // Every span is an exact slice of the original.
  for (const s of spans) assert.equal(text.slice(s.start, s.end).length, s.end - s.start)
  // A newline-separated bullet block must not become one giant "sentence".
  assert.ok(segments(MC.workHistory1, 1).length >= 4)
})

test('claimTokens keeps the VERB and drops the boilerplate', () => {
  // CONCERN 2: `swaps.STOP` drops `leading lead led drive driven driving experience ability`. A
  // replacement that swaps out `locate` and keeps `itemTokens` fixes nothing, because the deleted
  // words are the ones that carry the claim.
  const t = claimTokens('Ability to lead and drive the delivery of platform experience')
  for (const kept of ['lead', 'drive', 'delivery', 'platform']) assert.ok(t.includes(kept), `must keep ${kept}`)
  for (const dropped of ['ability', 'experience', 'the', 'of', 'to', 'and']) {
    assert.ok(!t.includes(dropped), `must drop ${dropped}`)
  }
})

test('supportIn returns a reason for every refusal, and the severities are one list', () => {
  const counts = countTokensAcrossRecords(RECS)
  const base = {
    threshold: EVIDENCE_THRESHOLD,
    maxSentences: 1, minQuoteChars: MIN_QUOTE_CHARS, minQuoteWords: MIN_QUOTE_WORDS,
    distinctiveLen: DISTINCTIVE_LEN,
  }
  const r = supportIn({ ...base, requirement: 'Reside in Boston', recordText: MC.workHistory1 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'eligibility')
  assert.equal(r.span, null)

  const ok = supportIn({
    ...base, requirement: 'Build and promote a high-performing engineering culture', recordText: MC.workHistory1,
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.reason, null)
  assert.equal(MC.workHistory1.slice(ok.span.start, ok.span.end), CULTURE_SENTENCE)

  // Every reason the module can produce is ranked, or a refusal could be reported as `no_candidate`.
  const declared = new Set([...GATE_ORDER, ...PRE_GATE_REASONS])
  const s = src('requirementSupport.ts')
  for (const m of s.matchAll(/refuse\('([a-z_]+)'\)|seen\.push\('([a-z_]+)'\)/g)) {
    const reason = m[1] || m[2]
    assert.ok(declared.has(reason), `${reason} must appear in REFUSAL_SEVERITY`)
  }
})

test('H:matcher-not-locate: the resolve path no longer imports locate()', () => {
  // The whole ticket in one assertion. `locate` stays exactly as it is in `requirements.ts` — it is
  // correct in P1's domain — but it is no longer the matcher, and a future edit must not quietly
  // put it back.
  const s = stripComments(src('evidence.ts'))
  assert.ok(!/\blocate\b/.test(s), 'evidence.ts must not reach for locate() again')
  assert.ok(!/from '\.\/swaps'/.test(s), 'nor for itemTokens, whose STOP list deletes the verbs')
  // And `locate` itself must still exist and still be used by the posting path it was written for.
  assert.ok(/export function locate\(paraphrase: string, postingText: string/.test(src('requirements.ts')))
})

// =================================================================================================
// J. THE PRODUCTION SHAPE — the tests that would have caught this before it shipped
//
// Everything above was written against requirements shaped like SENTENCES ("Build and promote a
// high-performing engineering culture"). Production does not store those. It stores jd_table Items:
// bare FRAGMENTS of three to five content words, often with no verb at all. The matcher passed 46
// tests and then evidenced 0 of 10 on opp 9f9c370a and 0 of 38 on opp c5671835, because every
// fixture above shared a shape the real data does not have.
//
// These fixtures are the REAL requirement strings (db-query run 32504616715) and a profile
// paraphrased from the REAL excerpts the debug probe returned (run 32505124784) — deliberately
// reworded so they are not verbatim copies, per M8/M40.
//
// The rule this encodes, which is the actual lesson: a fixture must come from the shape the system
// really sees, and the cheapest way to know that shape is to read production before writing tests.
// =================================================================================================

const PROD_MC = {
  aboutMe1: 'By aligning enterprise strategy with execution, I have led digital and agile transformations that empowered teams, streamlined operations, and delivered measurable outcomes.',
  aboutMe2: 'A technology leader focused on modernization, platform strategy, and building durable engineering organisations that ship reliably.',
  coreAccomplishments: 'Established a security-first engineering culture, embedding DevSecOps practices within SDLC workflows and improving delivery predictability.',
  resumeSummary: 'Passionate about bridging vision and execution, I empower teams to deliver measurable business outcomes and accelerate digital evolution.',
  relevantProficiencies: 'Standards and Compliance, AI/ML Strategy, Cybersecurity Leadership, Data Strategy, Policy Development | Technology Strategy | Platform Modernization',
  skills1: 'Enterprise Architecture, Cloud Platforms, Agile Delivery, Product Strategy',
  workHistory1: 'Collaborated with CTO and CPO to design a 3-year technology roadmap, securing a $13M budget increase for a Software Center of Excellence.',
  workHistory3: 'Directed enterprise architecture and technology operations for a global organisation, managing distributed engineering teams.',
  workHistory4: 'Owned platform strategy and delivery quality, partnering with product leadership to raise engineering standards.',
}
const PROD = profileRecords(PROD_MC, null)

test('H:production-shape-evidences: the real fragments the profile DOES support resolve', () => {
  // Each of these is a fragment in the production shape whose contentful words are genuinely in the
  // profile. Before the WEAK/category correction every one of them was refused, which is how the
  // matcher reached 0 of 38 on a CTO posting against a CTO's own résumé.
  for (const req of [
    'Experience in leading technology operations',
    'Lead technology strategy',
    'Experience with enterprise architecture',
    'Drive platform modernization',
    'Manage distributed engineering teams',
    'Partner with product leadership',
  ]) {
    const ev = resolveEvidence(req, PROD)
    assert.ok(ev, `must evidence: ${req}`)
    const rec = PROD.find(r => r.key === ev.source_key)
    assert.equal(rec.text.slice(ev.char_start, ev.char_end), ev.quote,
      'and the quote must still be the record\'s own bytes')
  }
})

test('H:production-shape-refuses: the real fragments the profile does NOT support stay refused', () => {
  // The other half, and the half that matters more. Every one of these is a REAL requirement from
  // opp 9f9c370a that the profile genuinely does not support. A matcher loosened until the six
  // above pass must not drag any of these through with them.
  const MUST_REFUSE = {
    'Reside in the East Coast of the United States': 'eligibility',
    'Collaborate effectively with Trinnex stakeholders': 'missing_specific_token',
    'IoT data, models, geospatial data, and AI/ML': 'missing_specific_token',
  }
  for (const [req, reason] of Object.entries(MUST_REFUSE)) {
    assert.equal(resolveEvidence(req, PROD), null, `must refuse: ${req}`)
    assert.equal(refusalReason(req, PROD), reason, `and for the right reason: ${req}`)
    // At the loosest reachable configuration too — these are floor rules, not tuning.
    assert.equal(resolveEvidence(req, PROD, LOOSEST), null, `must refuse at loosest: ${req}`)
  }
  // These are refused by DEGREE rather than by the floor, so they are asserted at the default only.
  for (const req of [
    'high-performing engineering culture',        // profile says security-first, not high-performing
    'Strong understanding of software engineering practices',
    'optimize water supply and demand',           // the profile has no water content at all
    'Ability to manage remote teams',             // the profile never says "remote"
  ]) {
    assert.equal(resolveEvidence(req, PROD), null, `must refuse at default: ${req}`)
  }
})

test('H:weak-verb-not-fatal: a missing weak verb never sinks a match, a missing adjective always does', () => {
  // The two halves of the correction, stated as one invariant. `Drive platform modernization`
  // against "…focused on modernization, platform strategy…" is missing only `drive`, and evidences.
  // `high-performing engineering culture` against "security-first engineering culture" is missing
  // `high-performing` — a word that carries the claim — and must not.
  assert.ok(resolveEvidence('Drive platform modernization', PROD))
  assert.equal(resolveEvidence('high-performing engineering culture', PROD), null)

  assert.ok(!isContentful('drive') && !isContentful('lead') && !isContentful('support'))
  assert.ok(isContentful('high-performing') && isContentful('geospatial') && isContentful('remote'))

  // And the category floor is about the WORD, never about how often the candidate happens to use it.
  assert.ok(isCategoryWord('engineering') && isCategoryWord('software') && isCategoryWord('platform'))
  assert.ok(!isCategoryWord('modernization') && !isCategoryWord('geospatial'))
})

test('H:record-frequency-not-evidence: a token recurring across records must not be discounted', () => {
  // The defect this whole correction fixes, pinned so it cannot come back. The first version treated
  // a token appearing in more than one of the candidate's records as GENERIC and refused when every
  // matched token was generic — so a profile that mentions "platform" in five records made
  // `platform` count for LESS. Record frequency describes the candidate's career, not the word's
  // informativeness; using it to discount evidence penalises the strongest matches.
  const repeated = profileRecords({
    aboutMe1: 'Owned platform modernization across the estate.',
    aboutMe2: 'Platform modernization was the core of the operating model.',
    workHistory1: 'Directed platform modernization for three business units.',
  }, null)
  const ev = resolveEvidence('Drive platform modernization', repeated)
  assert.ok(ev, 'a claim the profile makes repeatedly is MORE evidenced, never less')
  assert.equal(repeated.find(r => r.key === ev.source_key).text.slice(ev.char_start, ev.char_end), ev.quote)
})

test('H:bullet-blob-not-one-quote: a pipe-separated field splits into items, not one blob', () => {
  // The first evidence row production ever stored quoted a 400-character pipe-delimited skills blob
  // as proof of `Experience in leading technology operations` (db-query 2026-08-21, resolver_version
  // 2, offsets and length all structurally valid). The live profile separates items inside one field
  // with `|`, and `segments()` split only on newlines and sentence punctuation, so the whole field
  // was ONE candidate. A long excerpt also clears a coverage threshold merely by containing more
  // words, so the blob outranked the focused item that actually said the thing.
  const BLOB = 'Budget Development and P&L Management|KPI-driven performance management|Enterprise alignment of strategy and execution|Global technology operations leadership'
  const spans = segments(BLOB, 1).map(s => BLOB.slice(s.start, s.end))
  assert.ok(spans.includes('Global technology operations leadership'), `got ${JSON.stringify(spans)}`)
  // NOT "no candidate may span a separator" — the enclosing line is emitted too, deliberately, as
  // the fallback for items shorter than the quote floor. Item-only was a regression: the live
  // `expertise` items are under MIN_QUOTE_WORDS, every candidate failed the floor and production
  // went from 1 evidenced back to 0 (run 32508310532). The invariant is that the WINNER is the
  // item whenever an item qualifies, which the tie-break on shorter span guarantees.
  assert.ok(spans.some(x => x.includes('|')), 'the enclosing line is kept as a fallback candidate')

  const recs = profileRecords({ expertise: BLOB }, null)
  const ev = resolveEvidence('Experience in leading technology operations', recs)
  assert.ok(ev)
  assert.equal(ev.quote, 'Global technology operations leadership')
  assert.ok(ev.quote.length < 60, 'the excerpt must be the ITEM, never the whole field')
  assert.equal(recs[0].text.slice(ev.char_start, ev.char_end), ev.quote, 'offsets still index the original')
})

test('H:refusal-says-what-was-sought: an unevidenced row reports the words it looked for', () => {
  // "no evidence found in your profile" is true and unactionable. The resolver already knows which
  // rule refused, which words were missing and the closest excerpt it saw; throwing that away left
  // the owner with a dead end instead of a decision.
  const joined = [{
    seq: 0, verbatim: 'Ability to manage remote teams', item_text: '',
    evidence_quote: null, evidence_source_key: null, evidence_char_start: null, evidence_char_end: null,
  }]
  const out = shapeRequirementsForApi(joined, PROD)
  const row = out.requirements[0]

  assert.equal(row.evidenced, false, 'surfacing the search must never make a row look evidenced')
  assert.ok(row.evidenceSearch, 'an unevidenced row must say what was sought')
  assert.ok(row.evidenceSearch.soughtWords.includes('remote'))
  assert.ok(row.evidenceSearch.missingWords.includes('remote'),
    'and must name the word the profile never uses')
  assert.ok(row.evidenceSearch.reason, 'and which rule refused it')
  assert.ok(typeof row.evidenceSearch.closestExcerpt === 'string' && row.evidenceSearch.closestExcerpt.length > 0,
    'and the nearest thing the profile does say')
  assert.ok(row.evidenceSearch.closestExcerpt.length <= 160, 'bounded — a hint, not a record dump')

  // An EVIDENCED row shows its quote instead; it does not carry a search.
  const ok = shapeRequirementsForApi([{
    seq: 1, verbatim: 'Manage distributed engineering teams', item_text: '',
    evidence_quote: 'managing distributed engineering teams', evidence_source_key: 'workHistory3',
    evidence_char_start: 0, evidence_char_end: 38,
  }], PROD)
  assert.equal(ok.requirements[0].evidenceSearch, null)
})

// =================================================================================================
// K. THE ESCALATION TIER — a model proposes, deterministic rules accept or refuse
// =================================================================================================

test('H:tightest-bullet-run-wins: the excerpt is the run that carries the support, not the field', () => {
  // The owner's real `expertise` field. `Experience in leading technology operations` resolved to
  // ALL SEVEN bullets (286 chars) — four of which (budgets, KPIs, M&A) say nothing about the
  // requirement. The match is CORRECT; the citation was imprecise. Sub-runs let the shorter-span
  // tie-break pick the run that actually carries the tokens.
  const EXP = 'Budget Development and P&L Management|KPI-driven performance management|Enterprise alignment of strategy and execution|Governance frameworks for compliance|Optimizing scaled agile operations|Strategic roadmaps for customer-centric innovation|M&A due diligence and technology integration'
  const recs = profileRecords({ expertise: EXP }, null)
  const ev = resolveEvidence('Experience in leading technology operations', recs)
  assert.ok(ev, 'the requirement IS supported and must stay evidenced')
  assert.ok(ev.quote.length < EXP.length, 'and must no longer quote the whole field')
  assert.ok(ev.quote.length <= 140, `expected a tight run, got ${ev.quote.length} chars`)
  assert.ok(!ev.quote.includes('Budget Development'), 'irrelevant leading bullets must be dropped')
  assert.equal(recs[0].text.slice(ev.char_start, ev.char_end), ev.quote, 'offsets still index the original')
})

test('H:bullet-run-is-a-setting: the excerpt width is the owner\'s, and the knob reads backwards', () => {
  // The owner chose the TIGHT citation "for now" and said they may want the wide one back. That
  // makes the width a setting — `owner_search_prefs.chk_evidence_bullet_run`, seeded 3.
  //
  // TWO invariants, and the second one is a trap this case exists to pin down.
  //
  // (1) The knob moves the CITATION, never the MATCH. The whole line is a candidate at every value,
  //     so no setting can un-evidence a supported requirement. That is what makes it safe to expose.
  // (2) LOWER = BROADER. It caps how narrow a candidate may be, and `supportIn` breaks ties toward
  //     the shorter span, so raising it can only tighten. Measured, not assumed: the first version of
  //     this guard asserted that a HIGHER value widens the quote and failed — 3 and 12 return the
  //     same 130 characters. The revert the owner asked for is `= 1`, not a big number.
  const EXP = 'Budget Development and P&L Management|KPI-driven performance management|Enterprise alignment of strategy and execution|Governance frameworks for compliance|Optimizing scaled agile operations|Strategic roadmaps for customer-centric innovation|M&A due diligence and technology integration'
  const recs = profileRecords({ expertise: EXP }, null)
  const REQ = 'Experience in leading technology operations'

  const at = (n) => resolveEvidence(REQ, recs, { bulletRunMax: n })
  const wide = at(1)
  const tight = at(3)
  assert.ok(wide && tight, 'the requirement is evidenced at BOTH widths — the knob is presentation, not reach')
  assert.equal(wide.ratio, tight.ratio, 'the MATCH must not move with the citation width')

  // The measured pair, so a future change to the tie-break cannot silently flip the direction.
  assert.equal(wide.quote.length, EXP.length, 'bulletRunMax=1 is the revert: the whole field')
  assert.ok(tight.quote.length <= 140, `expected the tight run at 3, got ${tight.quote.length}`)
  assert.ok(!tight.quote.includes('Budget Development'), 'irrelevant leading bullets must be dropped')

  // Monotone, and never wider than the previous step. This is the property the owner is actually
  // buying: one number, one direction, no surprises between the values they might try.
  let prev = Infinity
  for (const n of [1, 2, 3, 4, 7, 12]) {
    const ev = at(n)
    assert.ok(ev, `bulletRunMax=${n} must not un-evidence a supported requirement`)
    assert.ok(ev.quote.length <= prev, `raising the setting widened the quote at ${n} — the direction flipped`)
    prev = ev.quote.length
    // The accusation-grade half is not negotiable by a setting, at any value.
    assert.equal(recs[0].text.slice(ev.char_start, ev.char_end), ev.quote)
  }

  // A nonsense value takes the seeded default or clamps; none of them may break the resolver.
  for (const bad of [0, -5, 1.7, NaN]) {
    assert.ok(at(bad), `bulletRunMax=${bad} must not un-evidence a supported requirement`)
  }
})

test('H:proposal-must-be-verbatim: a paraphrased model quote is refused, never repaired', () => {
  const recs = profileRecords({
    workHistory1: 'Reduced outages from nine hours to one across the payments platform.',
  }, null)
  const opts = { neverEvidence: NEVER_EVIDENCE, minQuoteChars: MIN_QUOTE_CHARS }
  const REQ = 'Improve operational reliability'

  // THE CASE THE TIER EXISTS FOR: no shared content word, so the deterministic matcher cannot reach
  // it, and a model can.
  assert.equal(resolveEvidence(REQ, recs), null, 'word-matching provably cannot find this')
  const good = verifyProposal(REQ, recs, {
    source_key: 'workHistory1', supported: true,
    quote: 'Reduced outages from nine hours to one',
    reasoning: 'Cutting outage duration is an improvement in operational reliability.',
  }, opts)
  assert.ok(good.accepted, 'an exact quote is accepted')
  assert.equal(recs[0].text.slice(good.accepted.char_start, good.accepted.char_end), good.accepted.quote)

  // EVERY way a fluent model goes wrong, each refused rather than repaired.
  const bad = [
    ['quote_not_in_record', 'Reduced outages from 9 hours to 1', 'digits rewritten'],
    ['quote_not_in_record', 'reduced outages from nine hours to one', 'case changed'],
    ['quote_not_in_record', 'Reduced outages from nine hours to one.', 'punctuation added'],
    ['quote_not_in_record', 'Reduced outages substantially across payments', 'paraphrased'],
  ]
  for (const [expected, quote, why] of bad) {
    const out = verifyProposal(REQ, recs, {
      source_key: 'workHistory1', supported: true, quote, reasoning: 'x',
    }, opts)
    assert.equal(out.accepted, null, `must refuse: ${why}`)
    assert.equal(out.refusal, expected, why)
  }
})

test('H:proposal-floor-binds-every-tier: the model cannot reach what the rules refuse outright', () => {
  const recs = profileRecords({
    workHistory1: 'Graduated from Pennsylvania State University and worked across the eastern seaboard.',
    itemsToOmit: 'Kubernetes cluster federation',
  }, null)
  const opts = { neverEvidence: NEVER_EVIDENCE, minQuoteChars: MIN_QUOTE_CHARS }

  // Eligibility is refused at EVERY tier. A model is not allowed to settle where someone lives from
  // prose merely because it argues more persuasively than a regex.
  const elig = verifyProposal('Reside in the East Coast of the United States', recs, {
    source_key: 'workHistory1', supported: true,
    quote: 'worked across the eastern seaboard',
    reasoning: 'Penn State and the eastern seaboard imply East Coast residence.',
  }, opts)
  assert.equal(elig.accepted, null)
  assert.equal(elig.refusal, 'requirement_class')
  assert.equal(worthEscalating('Reside in the East Coast of the United States', 2), false,
    'and it is not even sent to the model')

  // The owner's ban list is not a source at any tier either.
  const banned = verifyProposal('Deep experience with Kubernetes cluster federation', [
    ...recs, { key: 'itemsToOmit', kind: 'profile_field', label: 'Items to omit', text: 'Kubernetes cluster federation' },
  ], {
    source_key: 'itemsToOmit', supported: true,
    quote: 'Kubernetes cluster federation', reasoning: 'It is listed.',
  }, opts)
  assert.equal(banned.refusal, 'banned_source')

  // A record that does not exist, and an unexplained match.
  assert.equal(verifyProposal('Lead platform work', recs, {
    source_key: 'nope', supported: true, quote: 'Graduated from Pennsylvania', reasoning: 'x',
  }, opts).refusal, 'unknown_source_key')
  assert.equal(verifyProposal('Lead platform work', recs, {
    source_key: 'workHistory1', supported: true,
    quote: 'Graduated from Pennsylvania State University', reasoning: '   ',
  }, opts).refusal, 'no_reasoning')

  // And a model that declines is respected rather than second-guessed.
  assert.equal(verifyProposal('Lead platform work', recs, {
    source_key: 'workHistory1', supported: false, quote: '', reasoning: 'Nothing here supports it.',
  }, opts).refusal, 'model_declined')
})

test('H:escalation-is-scoped: only rows the deterministic pass could not settle are sent', () => {
  // The determinism contract survives because the model never sees the rows exact rules settled —
  // those stay reproducible and attributable to RESOLVER_VERSION. Escalation is the trigger.
  assert.equal(worthEscalating('Minimum of 8 years of experience', 2), false, 'numeric: no excerpt settles it')
  assert.equal(worthEscalating('Leadership', 2), false, 'too thin to judge either way')
  assert.equal(worthEscalating('Improve operational reliability', 2), true)
  assert.ok(PROPOSAL_VERSION >= 1, 'a proposal row must be attributable to a ruleset')

  // The prompt has to carry the one instruction that makes the output checkable.
  assert.match(PROPOSAL_SYSTEM, /CHARACTER-FOR-CHARACTER/)
  assert.match(PROPOSAL_SYSTEM, /Never infer where a person LIVES/)
})

// --- L. the escalation tier, wired -----------------------------------------------------------
//
// Everything in section K judges a model answer in isolation. These drive the whole pass through
// `writeEvidence` with an injected transport, so what is tested is the WIRING: when a call is made,
// when it is not, what reaches the database, and what a failure does to the row.

/** A fake pg client that records inserts and lets a test make one of them fail. */
function fakeClient(rows, failOn = null) {
  const inserts = []
  const stmts = []
  return {
    inserts, stmts,
    async query(sql, params) {
      stmts.push(String(sql).trim().split('\n')[0].trim())
      if (/from requirement where opp_id/.test(sql)) return { rows }
      if (/^\s*insert into requirement_evidence/.test(sql)) {
        if (failOn && failOn(params)) throw new Error('violates check constraint')
        inserts.push(params); return { rows: [] }
      }
      return { rows: [] }
    },
  }
}

const ESC_REC = {
  key: 'workHistory1', kind: 'work_history', label: 'Work history · CTO',
  text: 'Reduced outages from nine hours to one across the payments platform.',
}
// Shares NO content word with the record — the case the deterministic matcher provably cannot reach.
const ESC_REQ = 'Improve operational reliability'
const escRows = [{ id: 'r1', seq: 0, verbatim: ESC_REQ, item_text: ESC_REQ }]
const modelSays = (obj) => async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] })
const GOOD = {
  supported: true, source_key: 'workHistory1',
  quote: 'Reduced outages from nine hours to one',
  reasoning: 'Cutting outage duration is an improvement in operational reliability.',
}

test('H:escalation-is-off-by-default: no toggle, no transport, ZERO model calls', async () => {
  // The observable form of "defaults OFF". Not "the flag is false" — the transport is never invoked,
  // which is the only version of this claim that a caller cannot accidentally undo.
  let calls = 0
  const spy = async (...a) => { calls++; return modelSays(GOOD)(...a) }

  for (const [label, opts, transport] of [
    ['no options at all', {}, spy],
    ['escalate explicitly false', { escalate: false }, spy],
    ['escalate TRUE but no transport supplied', { escalate: true }, undefined],
  ]) {
    const c = fakeClient(escRows)
    const out = await writeEvidence(c, 'opp-1', [ESC_REC], opts, undefined, transport)
    assert.equal(calls, 0, `${label}: the model was called`)
    assert.equal(out.escalated, 0, `${label}: escalated must be 0`)
    assert.equal(out.proposed, 0, `${label}: proposed must be 0`)
    assert.equal(c.inserts.length, 0, `${label}: nothing may be written`)
  }
})

test('H:escalation-reaches-what-words-cannot: the happy path, with offsets that index the record', async () => {
  // The whole justification for the tier, as a test: the deterministic pass provably cannot settle
  // this row, and the model can.
  assert.equal(resolveEvidence(ESC_REQ, [ESC_REC]), null, 'word-matching must NOT reach this')

  const c = fakeClient(escRows)
  const out = await writeEvidence(c, 'opp-1', [ESC_REC], { escalate: true }, undefined, modelSays(GOOD))
  assert.equal(out.escalated, 1)
  assert.equal(out.proposed, 1)
  assert.equal(out.evidenced, 1, 'a proposed row IS evidence, and is counted as such')
  assert.equal(c.inserts.length, 1)

  const [, quote, , , sourceKey, start, end, extra, ratio, method, , , proposalVersion] = c.inserts[0]
  assert.equal(method, 'proposed', 'provenance must be stamped, not inferred')
  assert.equal(proposalVersion, PROPOSAL_VERSION)
  assert.equal(ratio, null, 'a proposed row has no similarity score and must not invent one')
  assert.equal(sourceKey, 'workHistory1')
  assert.equal(extra, GOOD.reasoning, 'the reasoning is stored, so the owner can judge it')
  // THE ACCUSATION-GRADE HALF: the offsets index the record's real bytes.
  assert.equal(ESC_REC.text.slice(start, end), quote)
  assert.ok(ESC_REC.text.includes(quote))
})

test('H:escalation-never-touches-a-settled-row: only rows the rules could not reach', async () => {
  // Two requirements: one the deterministic pass settles, one it cannot. Exactly one call.
  const settled = 'Reduced outages from nine hours to one'
  assert.ok(resolveEvidence(settled, [ESC_REC]), 'fixture: this one must resolve deterministically')
  const asked = []
  const transport = async (sys, user) => { asked.push(user); return modelSays(GOOD)() }
  const rows = [
    { id: 'r1', seq: 0, verbatim: settled, item_text: settled },
    { id: 'r2', seq: 1, verbatim: ESC_REQ, item_text: ESC_REQ },
  ]
  const c = fakeClient(rows)
  const out = await writeEvidence(c, 'opp-1', [ESC_REC], { escalate: true }, undefined, transport)
  assert.equal(asked.length, 1, 'the settled row must never be sent to the model')
  assert.ok(asked[0].includes(ESC_REQ) && !asked[0].includes(`REQUIREMENT:\n${settled}`))
  assert.equal(out.escalated, 1)
  assert.equal(out.evidenced, 2, 'one deterministic + one proposed')
})

test('H:escalation-cap-binds-and-says-so', async () => {
  // A posting with 38 unevidenced requirements must not make 38 calls the first time it is opened,
  // and what was skipped must be reported rather than silently dropped.
  let calls = 0
  const transport = async (...a) => { calls++; return modelSays({ supported: false })(...a) }
  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `r${i}`, seq: i, verbatim: ESC_REQ, item_text: ESC_REQ,
  }))
  const c = fakeClient(many)
  const out = await writeEvidence(c, 'opp-1', [ESC_REC], { escalate: true, escalateMax: 3 }, undefined, transport)
  assert.equal(calls, 3, 'the cap must bind')
  assert.equal(out.escalated, 3)
  assert.equal(out.escalation_refusals.over_cap, 1, 'silent truncation reads as "we covered everything"')
})

test('H:transport-failure-is-not-a-finding: an outage never reads as "your profile supports nothing"', async () => {
  // The house rule at the transport layer. Every one of these leaves the row UNEVIDENCED and says
  // WHY — none of them may be reported as the model having declined.
  for (const [label, transport, expected] of [
    ['a thrown transport', async () => { throw new Error('OpenAI HTTP 503') }, 'transport_failed'],
    ['an unparseable body', async () => ({ choices: [{ message: { content: 'I cannot answer that.' } }] }), 'unparseable'],
    ['an empty envelope', async () => ({}), 'unparseable'],
  ]) {
    const c = fakeClient(escRows)
    const out = await writeEvidence(c, 'opp-1', [ESC_REC], { escalate: true }, undefined, transport)
    assert.equal(c.inserts.length, 0, `${label}: nothing may be written`)
    assert.equal(out.proposed, 0, `${label}`)
    assert.equal(out.evidenced, 0, `${label}`)
    assert.equal(out.escalation_refusals[expected], 1, `${label}: must be reported as ${expected}`)
    assert.ok(!out.escalation_refusals.model_declined,
      `${label}: an outage must NEVER be recorded as the model declining`)
  }
})

test('H:proposal-insert-failure-costs-one-row: a rejected insert does not lose the run', async () => {
  // The savepoint. Most plausible cause is a CHECK on an environment whose migration has not run:
  // in Postgres a failed statement poisons the surrounding transaction, so without the savepoint one
  // bad row takes every later insert with it.
  const rows = [
    { id: 'r1', seq: 0, verbatim: ESC_REQ, item_text: ESC_REQ },
    { id: 'r2', seq: 1, verbatim: ESC_REQ, item_text: ESC_REQ },
  ]
  const c = fakeClient(rows, params => params[0] === 'r1')   // the FIRST proposed insert fails
  const out = await writeEvidence(c, 'opp-1', [ESC_REC], { escalate: true }, undefined, modelSays(GOOD))
  assert.equal(out.escalation_refusals.insert_rejected, 1, 'the rejection must be counted')
  assert.equal(out.proposed, 1, 'and the SECOND row must still have been written')
  assert.equal(c.inserts.length, 1)
  assert.equal(c.inserts[0][0], 'r2')
  // Each proposed insert is its own transaction, so a failure rolls back that row alone.
  assert.ok(c.stmts.filter(s => s === 'begin').length >= 2, 'proposed inserts must not share one transaction')
})

test('H:escalation-runs-after-the-deterministic-commit', async () => {
  // Ordering, asserted rather than described. The deterministic transaction opens by DELETING every
  // evidence row for the opportunity; a model call inside it would mean one bad proposal costing the
  // whole rewrite. The commit must land before the first model call.
  const seen = []
  const c = {
    inserts: [], stmts: [],
    async query(sql) {
      const head = String(sql).trim().split('\n')[0].trim()
      seen.push(head)
      if (/from requirement where opp_id/.test(sql)) return { rows: escRows }
      return { rows: [] }
    },
  }
  const transport = async (...a) => { seen.push('MODEL CALL'); return modelSays(GOOD)(...a) }
  await writeEvidence(c, 'opp-1', [ESC_REC], { escalate: true }, undefined, transport)
  const firstCall = seen.indexOf('MODEL CALL')
  const firstCommit = seen.indexOf('commit')
  assert.ok(firstCommit !== -1 && firstCall !== -1)
  assert.ok(firstCommit < firstCall,
    'the model was called inside the transaction that deletes the deterministic rows')
})

test('H:banned-record-never-reaches-the-prompt', async () => {
  // Two independent guards, in the right order. The owner's do-not-use list must not be RENDERED to
  // a model at all — refusing the answer afterwards spends a call to reach a certain refusal and
  // shows the model text the owner excluded.
  const banned = { key: 'itemsToOmit', kind: 'profile_field', label: 'Items to omit', text: 'Never mention the 2019 layoffs.' }
  let prompt = ''
  const transport = async (sys, user) => { prompt = user; return modelSays({ supported: false })() }
  const c = fakeClient(escRows)
  await writeEvidence(c, 'opp-1', [ESC_REC, banned], { escalate: true }, undefined, transport)
  assert.ok(prompt.includes('workHistory1'), 'the eligible record must be shown')
  assert.ok(!prompt.includes('itemsToOmit'), 'the banned record must not be in the prompt at all')
  assert.ok(!prompt.includes('2019 layoffs'), 'nor its text')

  // And the second guard still stands on its own, for a model that names it anyway.
  const outcome = verifyProposal(ESC_REQ, [ESC_REC, banned], {
    supported: true, source_key: 'itemsToOmit', quote: 'Never mention the 2019 layoffs.',
    reasoning: 'it is in the profile',
  }, { neverEvidence: NEVER_EVIDENCE, minQuoteChars: MIN_QUOTE_CHARS })
  assert.equal(outcome.refusal, 'banned_source')
  assert.equal(outcome.accepted, null)
})

test('H:escalation-on-by-default: the seed is ON, and an owner saying false still wins', () => {
  // OWNER DECISION 2026-08-21: "I don't know why the escalation needs to be turned on or off vs
  // always on ... make sure the toggle is automatically on by default." This reverses the
  // safe-by-default posture the toggle shipped with hours earlier, so it is pinned rather than left
  // to a literal someone re-reads later and "corrects".
  //
  // What makes ON safe is not the toggle — it is that a proposed row can never reach the gate
  // (`H:proposed-evidence-cannot-pass-the-gate`). The tier only ever adds information beside a
  // requirement that had none.
  assert.equal(DEFAULT_THRESHOLDS.evidenceEscalate, true, 'the seed must be ON')

  // THE THREE STATES, and the middle one is the reason this is `!== false` rather than `=== true`.
  // `ensureCheckPrefs` adds the column but does not INSERT a row, so `loadThresholds` returns `{}`
  // for an owner nobody has written yet. A strict read would leave exactly that owner OFF while the
  // column default said ON — a seed that reads as enabled and behaves as disabled.
  assert.equal(resolveOptionsFrom({}).escalate, true, 'no row yet must take the seed, not fall off')
  assert.equal(resolveOptionsFrom({ evidenceEscalate: true }).escalate, true)
  assert.equal(resolveOptionsFrom({ evidenceEscalate: false }).escalate, false,
    'an owner who switched it off must beat the code seed — the setting wins, always')
})

test('H:draft-is-written-from-prompts-not-evidence: the resume text never reads an evidence row', () => {
  // OWNER CONSTRAINT 2026-08-21: "I'm fine with your design decision for now as long as its just
  // related to grading / scoring... i still want my original prompts to be driving what the resume
  // draft is."
  //
  // The tier must stay on the QC side of the line. Asserted structurally because the alternative is
  // a promise in prose: `ensurePackage`/`assemblePackage` — the drafting path — must not read
  // evidence, and the ONE evidence call in `appPackets` must come AFTER the artifacts are built.
  const s = stripComments(src('appPackets.ts'))
  const draft = s.slice(s.indexOf('export async function ensurePackage'), s.indexOf('async function buildTemplatedArtifact'))
  assert.ok(draft.length > 200, 'ensurePackage moved — this scan has gone stale')
  assert.ok(!/requirement_evidence|loadRequirementsWithEvidence|evidence/i.test(draft),
    'the drafting path reads evidence — the owner\'s prompts must be what writes the draft')

  // ORDERING, AND COUNT. This caught a real defect twenty minutes after it reached production:
  // commit c230f30 carried a second `selfPost(.../evidence)` placed BEFORE the build loop that I did
  // not intend to write and did not notice in the diff. Live, it made every build-all resolve
  // evidence TWICE — once against a packet that had not been rebuilt yet — which doubles escalation
  // model spend and grades the wrong artifacts.
  //
  // The count assertion is the half the first version lacked. Ordering alone would have missed a
  // duplicate placed AFTER the loop, which is the same waste with none of the wrongness to reveal it.
  const calls = [...s.matchAll(/\/evidence\?owner=/g)]
  assert.equal(calls.length, 1,
    `appPackets makes ${calls.length} evidence calls per build — exactly one, after the artifacts exist`)
  const buildLoop = s.indexOf('buildTemplatedArtifact(client, { ...a')
  const evidenceCall = s.indexOf('/evidence?owner=')
  assert.ok(buildLoop > 0 && evidenceCall > 0, 'the build loop or the evidence call moved')
  assert.ok(buildLoop < evidenceCall,
    'evidence is resolved BEFORE the artifacts are built — it must run after, on what was written')
})

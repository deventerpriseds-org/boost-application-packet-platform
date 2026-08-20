// HARDENING — every past failure, encoded as an assertion that fails if it comes back.
//
// WHY THIS FILE EXISTS. Lessons were being recorded as prose in `.claude/actions.md`. Prose does not
// run. It relies on a future session reading a long file and remembering the right paragraph at the
// right moment, and that failed repeatedly inside a single session: the fuzzy-matcher bug was fixed
// in one place and the same class was left live in three others, one of which set a gate.
//
// The rule for this file: WHEN A MISTAKE IS FOUND, IT GETS AN ID AND A TEST HERE. Not a note. A test.
// Each case names the failure, the evidence that it was real, and the invariant that now prevents it.
// A note explains a mistake to a reader who happens to look; a test refuses to let it return.
//
// Each ID is referenced from `.claude/actions.md` so the story and the guard point at each other.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { normalizePostingText, decodeEntities, groundingText } from '../dist/functions/tests/jdText.js'
import { buildRequirements, locate, mapKind, sentenceBounds } from '../dist/functions/tests/requirements.js'
import { onOmitList, omitEntries, similarity } from '../dist/functions/tests/swaps.js'
import { runChecks, gateFor, attentionCount, COVERAGE_THRESHOLD, MIN_JUDGEABLE_TOKENS } from '../dist/functions/tests/checks.js'
import { computeArtifactScore } from '../dist/functions/tests/artifactScore.js'
import { deriveFacts } from '../dist/functions/tests/ownerFacts.js'
import { validateCitations, reviewerChecks } from '../dist/functions/tests/reviewer.js'

const SRC = new URL('../src/functions/tests/', import.meta.url).pathname
const src = (f) => readFileSync(join(SRC, f), 'utf8')
const allSources = () => readdirSync(SRC).filter(f => f.endsWith('.ts')).map(f => [f, src(f)])

/** Source with comments removed. A guard that fires on prose is one people learn to ignore. */
const stripComments = (body) => body
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

// ---------------------------------------------------------------------------------------------
// H1 — HTML entities were never decoded, so every &-term was invisible to matching.
// Evidence: 872 of 1,230 live postings (71%) contain `&amp;`; "P&L" was present in 83 postings and
// matched in ZERO.
test('H1: entity decoding happens before anything matches on posting text', () => {
  assert.equal(normalizePostingText('<p>Owned P&amp;L and M&amp;A</p>'), 'Owned P&L and M&A')
  assert.equal(decodeEntities('&amp;amp;'), '&', 'double-encoded rows exist in the corpus')
})

// ---------------------------------------------------------------------------------------------
// H2 — JS string offsets are UTF-16 code units; Postgres substring counts characters. Emoji made
// them diverge. Evidence: 63 of 3,090 requirement rows failed SQL re-verification while being
// perfectly self-consistent in JavaScript.
test('H2: normalized posting text is addressable from SQL (no astral characters)', () => {
  const t = normalizePostingText('<p>Join our rocket ship 🚀 and own the 📈 roadmap</p>')
  assert.equal([...t].length, t.length)
})

// ---------------------------------------------------------------------------------------------
// H3 — Offsets must never index MODEL output. `groundingText` falls back to jd_summary /
// jd_requirements, which the model wrote; an offset into those quotes the model, not the employer.
test('H3: the requirement extractor never grounds quotes in model output', () => {
  // Check the IMPORT and the CALL, not the word — the file mentions groundingText in a comment
  // explaining why it is not used, and a test that fires on prose is a test people learn to ignore.
  const body = src('requirements.ts')
  const imports = body.split('\n').filter(l => l.startsWith('import'))
  assert.ok(!imports.some(l => /groundingText/.test(l)), 'requirements.ts must not import groundingText')
  const code = stripComments(body)
  assert.ok(!/\bgroundingText\s*\(/.test(code), 'requirements.ts must not call groundingText')
  const r = buildRequirements({
    jd_real: null, raw_jd: null,
    jd_summary: 'A leader who will own the integrated product roadmap.',
    jd_table: '<table><tr><td>skills</td><td>Own the integrated product roadmap.</td><td>k</td></tr></table>',
  })
  assert.equal(r.jd_source, null)
  assert.ok(r.rows.every(x => x.char_start === null))
  // groundingText itself still exists for KEYWORD matching, where model text is acceptable.
  assert.ok(groundingText({ jd_summary: 'x' }).length > 0)
})

// ---------------------------------------------------------------------------------------------
// H4 — A fuzzy matcher used to ACCUSE. similarity() drops stopwords and short tokens, so
// "Skill number 0" and "Skill number 3" both reduce to {skill, number} and score 1.0 — one banned
// item would have named nine innocent ones as violations.
// THE GENERAL RULE: fuzzy is acceptable for RANKING, never for ACCUSING.
test('H4: the omission matcher is exact-or-whole-phrase, never fuzzy', () => {
  const omitted = omitEntries('Secure coding')
  assert.equal(onOmitList('Secure coding', omitted), true)
  assert.equal(onOmitList('Secure coding practices', omitted), true, 'whole-phrase containment counts')
  assert.equal(onOmitList('Skill number 0', omitEntries('Skill number 3')), false,
    'near-identical labels must not be accused of being the banned one')
  assert.ok(similarity('Skill number 0', 'Skill number 3') > 0.9,
    'similarity DOES rate them identical — which is exactly why it must not drive an accusation')
})

test('H4b: no accusation-grade check reaches for similarity()', () => {
  const checks = src('checks.ts')
  const accusing = checks.slice(checks.indexOf('const covers ='))
  assert.ok(!/\bsimilarity\(/.test(accusing),
    'coverage decides a gate; it must not be decided by a ranking heuristic')
})

// ---------------------------------------------------------------------------------------------
// H5 — A located span crossed a clause boundary and captured the role-title line.
// Evidence (live Trinnex, opp 9f9c370a): a stored must_have read
// "digital water technology). Role: Director of Digital Technology Operations" — not a requirement,
// and it then counted as COVERED because the resume naturally contains those words.
test('H5: a requirement span never crosses a sentence boundary', () => {
  const posting = 'We build digital water technology). Role: Director of Digital Technology Operations '
    + 'and Innovation. You will own the integrated product roadmap for the platform.'
  const l = locate('Own the integrated product roadmap for the platform', posting)
  if (l.char_start !== null) {
    assert.ok(!/\.\s+[A-Z]/.test(l.verbatim.slice(0, -1)),
      `span crossed a sentence boundary: ${JSON.stringify(l.verbatim)}`)
    assert.equal(posting.slice(l.char_start, l.char_end), l.verbatim)
  }
  const b = sentenceBounds(posting, posting.indexOf('You will own'))
  assert.ok(posting.slice(b.start, b.end).startsWith('You will own'))
})

// H5c — the FIX for H5 introduced the mirror-image bug: sentence clipping treated an
// abbreviation's period as a sentence end. Measured on live rows: "must be a U.S. Citizen",
// "SaaS vs. Services margin tracking", "e.g. Apple, Nest, Sonos". Truncating a real requirement
// fabricates a quote just as surely as running past its end does.
test('H5c: an abbreviation period does not end a sentence', () => {
  for (const [text, needle] of [
    ['Candidates must be a U.S. Citizen or Green Card Holder for this role.', 'must be a U.S. Citizen'],
    ['Implement SaaS vs. Services margin tracking across the portfolio.', 'SaaS vs. Services margin tracking'],
    ['Experience at a consumer company (e.g. Apple, Nest) is required.', 'e.g. Apple'],
  ]) {
    const b = sentenceBounds(text, text.indexOf(needle))
    assert.ok(text.slice(b.start, b.end).includes(needle),
      `clipped mid-abbreviation: ${JSON.stringify(text.slice(b.start, b.end))}`)
  }
  // A real sentence end still ends the sentence.
  const t = 'We build water technology. Role: Director of Operations'
  const b = sentenceBounds(t, 0)
  assert.ok(!t.slice(b.start, b.end).includes('Role:'))
})

test('H5b: a garbage fragment is NOT reported as a covered must-have', () => {
  const garbage = { seq: 7, verbatim: 'digital water technology). Role: Director of Digital Technology Operations', item_text: '', kind: 'must_have' }
  const rs = runChecks({
    type: 'resume',
    pkg: { ResumeSummary: 'Director of Digital Technology Operations at a water technology company.' },
    requirements: [garbage, { seq: 6, verbatim: 'Significant experience in software engineering management', item_text: '', kind: 'must_have' }],
  })
  const cov = rs.find(r => r.check_key === 'must_have_coverage')
  assert.notEqual(cov.state, 'pass',
    'a gate must not go green on a fragment that was never a requirement')
})

// ---------------------------------------------------------------------------------------------
// H6 — A coverage check with nothing to check against returned `pass`, which is how a gate goes
// green on an artifact nobody verified. (AC 2.1.9, the safety rule.)
test('H6: absent evidence is not_applicable, and an all-unknown artifact is not a pass', () => {
  const rs = runChecks({ type: 'resume', pkg: { ResumeSummary: 'x' } })
  for (const k of ['must_have_coverage', 'responsibilities_addressed', 'changes_cited']) {
    assert.equal(rs.find(r => r.check_key === k).state, 'not_applicable')
  }
  const na = (state) => ({ check_key: String(Math.random()), engine: 'deterministic', state, observed: '', expected: '', offenders: [] })
  assert.equal(gateFor([na('not_applicable'), na('not_applicable')]), 'warn')
  assert.ok(COVERAGE_THRESHOLD >= 0.7 && MIN_JUDGEABLE_TOKENS >= 3, 'coverage must stay accusation-grade')
})

// ---------------------------------------------------------------------------------------------
// H7 — A score must not be assembled from components that do not exist. A composite built from one
// of three, or from a zero standing in for "unknown", is the number a reviewer trusts most.
test('H7: no composite without all three components, and no zero-for-unknown', () => {
  const withOne = computeArtifactScore({
    requirements: [{ seq: 0, kind: 'must_have' }],
    checks: [{ check_key: 'must_have_coverage', engine: 'deterministic', state: 'pass', observed: '1/1', expected: '', offenders: [] }],
  })
  assert.equal(withOne.must_have_coverage.value, 100)
  assert.equal(withOne.composite, null)
  assert.equal(withOne.band, null)
  assert.ok(/no published term-library/.test(withOne.keyword_coverage.source), 'it must say WHY it is absent')
})

// ---------------------------------------------------------------------------------------------
// H8 — A hard requirement in a row's own words was downgraded to optional by a "preferred" up to
// 400 characters earlier. Evidence: 78 of 541 nice_to_have rows carried a mandatory marker in their
// own verbatim, including "must be a U.S. Citizen" and "Minimum of 8 years".
test('H8: a hard gate in the row own words is never downgraded by an earlier heading', () => {
  const window = 'Preferred qualifications: MBA or advanced degree. '
  for (const own of ['must be a U.S. Citizen or Green Card Holder', 'Minimum of 8 years of experience', '15+ years of progressive leadership']) {
    assert.equal(mapKind('experience', own, window).kind, 'must_have', own)
  }
})

// ---------------------------------------------------------------------------------------------
// H9 — `resolveOwner` returns {owner, verified}; passing the whole object as a SQL parameter
// compiled cleanly and selected 0 of 1,351 eligible rows.
test('H9: a resolveOwner result is never used as if it were the email string', () => {
  // The real invariant: the result is destructured, OR bound to a name whose .owner/.verified is
  // then read. Binding it and reading a field is correct; passing the whole object is the bug.
  const bad = []
  for (const [f, body] of allSources()) {
    for (const line of body.split('\n')) {
      if (!/resolveOwner\(req\)/.test(line)) continue
      // Any destructuring is correct — `{ owner }`, `{ verified }`, `{ owner, verified }`. The
      // first version of this guard accepted only `{ owner`, so `const { verified } =
      // resolveOwner(req)` (promptsApi's D7 guard, which is right) was reported as the bug. A guard
      // that fires on correct code is one people learn to ignore.
      if (/\{\s*(owner|verified)\b/.test(line)) continue          // destructured
      if (/resolveOwner\(req\)\.(owner|verified)/.test(line)) continue  // field read inline
      const m = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*resolveOwner\(req\)/.exec(line)
      if (m && new RegExp(`\\b${m[1].replace('$', '\\$')}\\.(owner|verified)\\b`).test(body)) continue
      bad.push(`${f}: ${line.trim()}`)
    }
  }
  assert.deepEqual(bad, [], 'resolveOwner returns {owner,verified} — using it whole silently matches nothing')
})

// ---------------------------------------------------------------------------------------------
// H10 — SQL lives inside a TypeScript template literal, so a backtick in a SQL COMMENT terminates
// the string. It broke the build twice, both times only at `tsc`, never at review.
test('H10: SCHEMA_SQL contains no backticks and no template interpolation', () => {
  const schema = src('schema.ts')
  const sql = schema.slice(schema.indexOf('SCHEMA_SQL = `') + 14, schema.indexOf('`;'))
  assert.ok(!sql.includes('`'), 'a backtick inside SCHEMA_SQL ends the template literal early')
  assert.ok(!/\$\{/.test(sql), 'interpolation inside SCHEMA_SQL would inject unescaped values')
})

// ---------------------------------------------------------------------------------------------
// H11 — New relational tables belong in SCHEMA_SQL + EXPECTED_TABLES (decision D1), not in ad-hoc
// ensure*() ALTERs that pgMigrate never sees.
test('H11: every table this layer added is registered for migration', () => {
  const schema = src('schema.ts')
  for (const t of ['requirement', 'skill_candidate', 'swap_decision', 'insertion',
                   'check_result', 'artifact_gate', 'artifact_score',
                   'term_library', 'term_library_entry', 'term_candidate']) {
    assert.ok(schema.includes(`create table if not exists ${t} `) || schema.includes(`create table if not exists ${t}(`),
      `${t} is not in SCHEMA_SQL`)
    assert.ok(new RegExp(`'${t}'`).test(schema.slice(schema.indexOf('EXPECTED_TABLES'))),
      `${t} is not in EXPECTED_TABLES, so a migration gap would go unreported`)
  }
})

// ---------------------------------------------------------------------------------------------
// H12 — Pure rule modules must stay testable without Azure or a database, or the rules stop being
// tested and start being hoped for.
test('H12: rule modules import neither @azure/functions nor pg', () => {
  for (const f of ['checks.ts', 'requirements.ts', 'swaps.ts', 'insertions.ts', 'artifactScore.ts', 'jdText.ts', 'termMatch.ts']) {
    const body = src(f)
    assert.ok(!/@azure\/functions/.test(body), `${f} must stay pure`)
    assert.ok(!/from '\.\/pgClient'/.test(body), `${f} must stay pure`)
  }
})

// ---------------------------------------------------------------------------------------------
// H13 — Generation was fed a synthesised pseudo-JD because the opportunity projection was
// duplicated across four call sites and every one of them omitted jd_real.
test('H13: there is ONE opportunity projection for generation, and it selects the real posting', () => {
  const body = src('appPackets.ts')
  assert.ok(/const OPP_FIELDS = /.test(body))
  const proj = body.slice(body.indexOf('const OPP_FIELDS'), body.indexOf('const OPP_FIELDS') + 400)
  assert.ok(/jd_real/.test(proj), 'the projection must carry the employer posting')
  assert.ok(!/select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, persona_key from opportunity/.test(body),
    'the old jd_real-less projection must not reappear')
})

// ---------------------------------------------------------------------------------------------
// H14 — A date-range pattern allowed a month before the START year but not the END year, so
// "AUG 2021 - Present" matched while "JAN 2015 - JUL 2021" did not. On the real resume template
// only the current role matched, and the earliest-dated-role rule then derived
// "experience.years_total = 5 years (since 2021)" for a 24-year career.
// The invariant: a derived span must come from the EARLIEST dated role, whatever the date format.
test('H14: month-qualified date ranges on both sides are read, so the earliest role wins', () => {
  const formats = [
    'Lead  AUG 2021 - Present\nDirector  JAN 2015 - JUL 2021\nManager  Mar. 2008 - Dec 2014',
    'Lead  2021 to Present\nDirector  2015 to 2021\nManager  2008 to 2014',
    'Lead  2021 – Present\nDirector  Jan 2015 – Jul 2021\nManager  2008 – 2014',
  ]
  for (const cv of formats) {
    const f = deriveFacts(cv, 2026).find(x => x.key === 'experience.years_total')
    assert.ok(f, `no span derived from:\n${cv}`)
    assert.equal(f.value_num, 18, `earliest role is 2008, not the current one:\n${cv}`)
  }
})

// ---------------------------------------------------------------------------------------------
// H15 — Verifying a deploy with `latest:` asks GitHub for the newest run, which immediately after a
// push is still the PREVIOUS commit's. It reported "deployed" while the old worker was serving, and
// the resulting 400s from stale code read like an application bug for two rounds.
// The invariant: the deploy-wait helper must refuse the racy form rather than rely on remembering.
test('H15: the deploy-wait helper refuses latest: and demands a commit', () => {
  const sh = readFileSync(new URL('../../scripts/wait-run.sh', import.meta.url).pathname, 'utf8')
  assert.match(sh, /sha:/, 'the helper must support waiting on a specific commit')
  assert.match(sh, /\*deploy\*\)/, 'the helper must special-case deploy workflows')
  assert.match(sh, /refusing latest:/, 'and refuse the racy form outright')
  const guard = sh.slice(sh.indexOf('*deploy*)'), sh.indexOf('*deploy*)') + 400)
  assert.match(guard, /exit 2/, 'refusing means a non-zero exit, not a printed warning')
})

// ---------------------------------------------------------------------------------------------
// H16 — A citation validator of the shape `postingText.includes(quote) && requirementExists(id)`
// accepts real, verifiable, employer-authored text as evidence for the WRONG requirement. Measured
// on the live corpus: a phrase such as "ten years of leadership experience" occurs both in the
// requirements block and in the culture paragraph of the same posting, and `locate()` carries a
// `taken` parameter precisely because repeated phrasing is the norm, not the exception.
// The invariant: an accepted citation's quote must OVERLAP the span of the requirement it names.
test('H16: a citation only validates inside the span of the requirement it cites', () => {
  const posting = 'Requirements: candidates need eight years of regulated utility leadership experience. '
    + 'Culture: we prize eight years of regulated utility leadership experience in every hire we make.'
  const quote = 'eight years of regulated utility leadership experience'
  const first = posting.indexOf(quote)
  const second = posting.indexOf(quote, first + 1)
  assert.notEqual(second, -1, 'the fixture must contain the phrase twice')
  const reqs = [{ id: 'r1', seq: 0, kind: 'must_have', item_text: 'Eight years in regulated utilities',
                  verbatim: quote, char_start: first, char_end: first + quote.length }]

  const inSpan = validateCitations([{ requirement_id: 'r1', verbatim_quote: quote, claim: 'x' }], posting, reqs)
  assert.equal(inSpan.accepted.length, 1, 'the requirement\'s own words must validate')

  // The naive check passes this: the words ARE in the posting. They are evidence for nothing.
  const outOfSpan = validateCitations(
    [{ requirement_id: 'r1', verbatim_quote: posting.slice(second, second + quote.length + 25), claim: 'x' }], posting, reqs)
  assert.equal(outOfSpan.accepted.length, 0)
  assert.equal(outOfSpan.dropped[0].reason, 'quote_does_not_resolve_to_requirement')

  // And structurally: the validator must resolve by OFFSET, not by presence alone.
  const body = stripComments(src('reviewer.ts'))
  assert.match(body, /char_start/, 'validation must consult the requirement offsets')
  assert.ok(!/\bsimilarity\s*\(/.test(body), 'a citation accuses — fuzzy matching may never decide one')
})

// ---------------------------------------------------------------------------------------------
// H17 — `check_result` is unique on (artifact_id, run_id, check_key) and the reviewer writes into
// the SAME run as the deterministic engine (it must, or `artifactChecksGet` cannot see its rows).
// A reviewer key colliding with a deterministic one therefore either aborts the run or REPLACES the
// rules engine's verdict with a model's opinion under the rules engine's key — which `gateFor` and
// `computeArtifactScore` would then read as deterministic.
// The invariant: reviewer keys are namespaced, and the score filters on engine regardless.
test('H17: reviewer check keys cannot collide with deterministic ones, and the score filters anyway', () => {
  const det = new Set(runChecks({ type: 'resume', pkg: {}, requirements: [], swaps: [] }).map(r => r.check_key))
  const rev = reviewerChecks({
    review: { grade: 'needs_work', seniority_alignment: 10, judgements: [], citations: [], critique: ['x'] },
    agreement: { agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 },
    accepted: [], dropped: [], requirements: [], ran: true,
  })
  for (const r of rev) {
    assert.match(r.check_key, /^reviewer_/, `${r.check_key} is not namespaced`)
    assert.ok(!det.has(r.check_key), `${r.check_key} collides with a deterministic key`)
    assert.notEqual(r.state, 'fail', 'D6: a reviewer row may never be a fail')
  }
  // Belt and braces: even a colliding row must not reach the score.
  const s = computeArtifactScore({
    requirements: [{ seq: 0, kind: 'must_have' }],
    checks: [{ check_key: 'must_have_coverage', engine: 'reviewer', state: 'pass', observed: '', expected: '', offenders: [] }],
  })
  assert.equal(s.must_have_coverage.value, null, 'a model opinion must never become a measured number')
  assert.match(stripComments(src('artifactScore.ts')), /engine === 'deterministic'/)
})

// ---------------------------------------------------------------------------------------------
// H18 — `artifactChecksGet` selects check rows by `run_id = artifact_gate.run_id`. A second engine
// that mints its own `randomUUID()` run stores rows that NO reader can ever see: the database looks
// correct, every insert returns success, and the product shows nothing. The same shape bites the
// score row, which the deterministic pass inserts with `on conflict (artifact_id, run_id) do
// nothing` — a reviewer INSERTing seniority into that run is silently discarded, with a 200.
// The invariant: the reviewer attaches to the existing run, and updates the score rather than
// inserting over it.
test('H18: the reviewer attaches to the deterministic run and UPDATES the score row', () => {
  const body = stripComments(src('appReviewer.ts'))
  assert.ok(!/randomUUID/.test(body), 'the reviewer must not mint its own run_id')
  assert.match(body, /select run_id[\s\S]{0,80}from artifact_gate/, 'it must read the run it attaches to')
  assert.match(body, /update artifact_score set seniority_alignment/,
    'seniority must be an UPDATE — an insert is swallowed by the deterministic pass\'s do-nothing conflict clause')
  assert.ok(!/insert into artifact_score/.test(body), 'inserting here would be silently discarded')
  // And the gate must be recomputed over the whole run, or the badge and the gate describe
  // different sets of findings (R4).
  assert.match(body, /attentionCount\(all\)/)
  assert.match(body, /gateFor\(all\)/)
})

// ---------------------------------------------------------------------------------------------
// H19 — `requireWrite` allows a write when `verified || owner === DEMO_EMAIL`, and `resolveOwner`
// DEFAULTS owner to DEMO_EMAIL when no ?owner= is supplied. So dropping `requireWrite` onto an
// endpoint that has no demo partition leaves it fully open to an unauthenticated caller while
// reading as guarded in the diff. The `Prompts` table is global shared state — a POST there rewrites
// live document generation for every owner.
// The invariant: a global-state mutation guards on `verified`, never on requireWrite alone.
test('H19: the prompts POST guards on a verified session, not on requireWrite', () => {
  const body = stripComments(src('promptsApi.ts'))
  const post = body.slice(body.indexOf("req.method === 'POST'"))
  assert.match(post, /const \{ verified \} = resolveOwner\(req\)/, 'the guard must read `verified`')
  assert.match(post, /if \(!verified\)[\s\S]{0,120}status: 403/, 'and refuse without one')
  // requireWrite alone would be the broken fix; assert it is not what is relied on here.
  assert.ok(!/requireWrite/.test(body),
    'requireWrite waves through the demo default — it cannot guard a table with no demo partition')
  // The guard belongs INSIDE the POST branch: at the top it would 401 the CORS preflight and the
  // unauthenticated GET the prompts console and the reviewer both need.
  assert.ok(body.indexOf('const { verified }') > body.indexOf("req.method === 'GET'"),
    'the guard must not sit above the GET/OPTIONS branches')
})

// ---------------------------------------------------------------------------------------------
// H20 — A refused citation reached the user anyway, through a SECOND door.
//
// `validateCitations` correctly dropped a fabricated quote, and `scrubCritique` correctly deleted
// the critique line that rested on it. Then `reviewerChecks` wrote the quote into `offenders`, and
// the scrubbed sentence was re-emitted whole into `reviewer_citations_scrubbed.offenders`. Those
// rows are stored on `check_result` and read back verbatim by THREE endpoints (`/review`,
// `/review-result`, `/checks`), so a UI rendering offenders generically printed the fabricated text
// as a reviewer finding — unmarked, exactly as if it were real.
//
// Measured by the independent verifier on 6046b6f:
//   offenders: ['quote_not_in_posting: "the company operates fourteen research hospitals worldwide"']
//   offenders: ['The posting says the company operates fourteen research hospitals worldwide, ...']
//
// The invariant: text that failed verification never appears in ANY stored field. Closing one exit
// while leaving another open is not a fix — the guard must be about the text, not about the field.
test('H20: text that failed verification never appears in any stored field', () => {
  const FABRICATED = 'the company operates fourteen research hospitals worldwide'
  const rows = reviewerChecks({
    review: {
      grade: 'needs_work', seniority_alignment: 40, judgements: [], citations: [],
      critique: ['The summary is thin on scale.'],   // already scrubbed by the caller
    },
    agreement: { agreed: 0, disagreed: 0, reviewer_stricter: [], reviewer_looser: [], unmatched: 0, not_comparable: 0 },
    accepted: [],
    dropped: [{ requirement_id: 'r1', verbatim_quote: FABRICATED, claim: 'x', reason: 'quote_not_in_posting', detail: '' }],
    requirements: [], ran: true,
  })
  const serialized = JSON.stringify(rows)
  assert.ok(!serialized.includes(FABRICATED),
    `a refused quote reached a stored field: ${serialized}`)
  // The finding must still exist — suppressing the quote must not suppress the fact of the drop.
  const cit = rows.find(r => r.check_key === 'reviewer_citations')
  assert.equal(cit.state, 'warn')
  assert.match(cit.observed, /did not verify/)
})

// ---------------------------------------------------------------------------------------------
// H21 — `verbatim_quote` held the MODEL's string, not the employer's.
//
// `findQuoteSpans` matches case-insensitively (the `i` flag) because models title-case and
// upper-case what they quote. Storing the model's rendering under a field named `verbatim_quote`
// meant a case-shifted paraphrase of the employer's words was presented to the user as verbatim —
// a small lie in precisely the place this module exists to prevent one.
// Measured: 'DEMONSTRATED OWNERSHIP OF A MULTI REGION' accepted against a lowercase posting.
// The invariant: an accepted citation carries the posting's own bytes at the matched span.
test('H21: an accepted citation stores the employer\'s bytes, not the model\'s rendering', () => {
  const posting = 'Requirements: demonstrated ownership of a multi region platform at scale.'
  const quote = 'demonstrated ownership of a multi region platform'
  const start = posting.indexOf(quote)
  const reqs = [{ id: 'r1', seq: 0, kind: 'must_have', item_text: 'Multi-region ownership',
                  verbatim: quote, char_start: start, char_end: start + quote.length }]
  const SHOUTED = quote.toUpperCase()
  const { accepted } = validateCitations([{ requirement_id: 'r1', verbatim_quote: SHOUTED, claim: 'x' }], posting, reqs)
  assert.equal(accepted.length, 1, 'case-shifted quotes must still validate')
  assert.equal(accepted[0].verbatim_quote, quote, 'the stored quote must be the posting\'s own text')
  assert.notEqual(accepted[0].verbatim_quote, SHOUTED)
  assert.equal(posting.slice(accepted[0].char_start, accepted[0].char_end), accepted[0].verbatim_quote)
})

// ---------------------------------------------------------------------------------------------
// H22 — `gateFor([])` returned 'pass'. The function that IS the gate answered "everything passed"
// to the question "what was checked?" when the answer was "nothing".
//
// Every branch of gateFor already honoured "absent evidence is never a pass" — including the
// explicit `results.length && results.every(not_applicable)` one — and the rule leaked underneath
// all of them, because that `results.length &&` short-circuits on an empty array and the final
// `return 'pass'` catches it. Measured 2026-08-20: `gateFor([]) === 'pass'`.
//
// Latent while `evaluateArtifact` was the only caller (runChecks returns 10 rows even for empty
// input, so it never passed []). P4 made it reachable: appReviewer re-aggregates the gate from a
// DATABASE read, and a query returning no rows would have written gate='pass'.
//
// The invariant: an empty check set can never produce a passing gate, from any caller, ever.
test('H22: no rows is never a pass — the gate cannot go green on an unchecked artifact', () => {
  assert.notEqual(gateFor([]), 'pass', 'an empty check set means nothing was checked')
  assert.equal(gateFor([]), 'warn')
  assert.equal(attentionCount([]), 0, 'but there is nothing to COUNT — the gate carries the meaning')

  // The neighbouring rule this one hid under, still intact.
  const na = [{ check_key: 'x', engine: 'deterministic', state: 'not_applicable', observed: '', expected: '', offenders: [] }]
  assert.equal(gateFor(na), 'warn', 'all-not_applicable was already warn; empty must not be weaker')

  // And the real paths are unchanged.
  const rows = runChecks({ type: 'resume', pkg: {}, requirements: [], swaps: [] })
  assert.ok(rows.length > 0)
  assert.equal(gateFor(rows), 'fail')
})

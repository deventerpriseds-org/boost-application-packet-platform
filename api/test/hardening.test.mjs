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
import { onOmitList, omitEntries, similarity, itemTokens } from '../dist/functions/tests/swaps.js'
import { runChecks, gateFor, attentionCount, COVERAGE_THRESHOLD, MIN_JUDGEABLE_TOKENS } from '../dist/functions/tests/checks.js'
import { computeArtifactScore } from '../dist/functions/tests/artifactScore.js'
import { deriveFacts } from '../dist/functions/tests/ownerFacts.js'
import { parseResumePackage } from '../dist/functions/tests/resumeParser.js'
import { validateCitations, reviewerChecks } from '../dist/functions/tests/reviewer.js'
import { extractFigures, scanEcho, claimKey, isMarked } from '../dist/functions/tests/figureEcho.js'
import { profileRecords, resolveEvidence } from '../dist/functions/tests/evidence.js'

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

  // P8.3 moved the coverage numerator into `evidence.ts`, so the accusation moved with it. The
  // module's own header makes "fuzzy for RANKING, never for ACCUSING" its central claim; without
  // this line nothing stopped `similarity()` — which H4 shows rates "Skill number 0" and "Skill
  // number 3" above 0.9 — from being wired into the path that decides whether a candidate's
  // requirement is evidenced. Found absent by the independent verifier of P8.3.
  assert.ok(!/\bsimilarity\(/.test(stripComments(src('evidence.ts'))),
    'evidence decides coverage, which decides the gate; it must not be decided by a ranking heuristic')
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
  for (const t of ['requirement', 'requirement_evidence', 'skill_candidate', 'swap_decision', 'insertion',
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
  for (const f of ['checks.ts', 'requirements.ts', 'swaps.ts', 'insertions.ts', 'artifactScore.ts', 'jdText.ts', 'termMatch.ts', 'evidence.ts']) {
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

// ---------------------------------------------------------------------------------------------
// H23 — A `### Title ###` section whose title mapped to no merge field was classified as BODY and
// absorbed into the field above it, title included. Measured on main before the fix:
//   parse('### Resume Summary ###\nExecutive who modernizes...\n### Leadership Philosophy ###\nI
//   build teams that ship.\n### Skills 1 ###\n...')
//   → resumeSummary === "Executive who modernizes regulated platforms.\n\nLeadership Philosophy\n\nI
//     build teams that ship."
// and that string went into the document. So a PROMPT EDIT THAT ADDED A SECTION silently moved
// content into the wrong resume slot — precisely what P7's own acceptance line forbids, still true
// after the parity half of the fix had landed and been called done.
//
// The root cause was the delimiter GRAMMAR being discarded: `split('###')` cannot tell
// `### Title ###` (bracketed both sides, a heading) from a lone `###` inside a sentence. Matching
// the pair settles it without a length heuristic — which matters, because the obvious heuristic
// ("short and unpunctuated is a heading") misclassifies the fragment "Also delivered" produced by
// splitting "Also delivered ### platform rebuilds".
//
// The invariant: no `###` section may contribute text to a field it does not title.
test('H23: a section never contributes text to a field it does not title', () => {
  const p = parseResumePackage([
    '### Resume Summary ###', 'Executive who modernizes regulated platforms.',
    '### Leadership Philosophy ###', 'I build teams that ship.',
    '### Skills 1 ###', 'Cloud Strategy | DevSecOps',
  ].join('\n'), {}, 'Director', 'Trinnex')

  for (const [field, text] of Object.entries(p)) {
    if (typeof text !== 'string' || !text) continue
    assert.ok(!/Leadership Philosophy/.test(text), `the unknown section's TITLE reached ${field}`)
    assert.ok(!/I build teams to ship|I build teams that ship/.test(text), `its BODY reached ${field}`)
  }
  // ...and it is surfaced rather than silently dropped: both failures change the document without
  // saying so, and only one of them is visible to a reader of the output.
  assert.deepEqual(p._unmapped, [{ title: 'Leadership Philosophy', body: 'I build teams that ship.' }])

  // The same walk lived in two more files when resumeParser was "fixed". Fix all consumers.
  const offenders = allSources()
    .filter(([f, body]) => /parts\[i \+ 1\]/.test(stripComments(body)))
    .map(([f]) => f)
  assert.deepEqual(offenders, [], 'the positional pair-walk is back in a section parser')
})

// ---------------------------------------------------------------------------------------------
// H24 — A scanner reported a figure that does not appear in the text it scanned.
//
// `extractFigures('40% growth')` returned exactly one figure: `{raw:'4', key:'num:4'}`. Two defects
// composed, and each one alone was survivable:
//   (a) `/(\d[\d,]*(?:\.\d+)?)\s*(%|percent)\b/` never matches "40% growth" at all. `%` is a
//       non-word character and so is the space after it, so the trailing `\b` has no boundary to
//       sit on. The percent scanner was dead code against the commonest way to write a percentage.
//   (b) the bare-count scanner ended in `(?!\s*(?:%|percent))`. A TAIL THAT CAN FAIL IS A TAIL THE
//       ENGINE BACKTRACKS PAST: refused "40" because of the `%`, it retried with "4", found "0%"
//       after it, and the lookahead was satisfied. The number four was never in the sentence.
//
// This is accusation-grade output — R3 names the figure a candidate supposedly stole from the
// posting. A phantom figure means accusing a resume of echoing a number neither document contains,
// which is the cry-wolf failure hardening rule 2 exists to forbid.
//
// The invariant is not "fix the percent regex". It is that a scanner may only report substrings it
// actually found: every figure must be exactly the text at its own span, and no two figures may
// claim overlapping ground — because a figure counted twice is a second way to invent one.
test('H24: a figure scanner only ever reports text that is actually there', () => {
  const corpus = [
    'Manage a $18M portfolio across three business units, 60+ direct reports, 40% growth.',
    'Drive 12.5% margin improvement over 1,200 accounts and $400k of tooling spend.',
    '400+ industrial operators, sixty sites, one million monthly users, 99.9% uptime.',
    'Own a $2.5B P&L. Reduce cost 30 percent. Ship 4 releases a quarter.',
    'A million things to fix, hundreds of thousands of rows, no numbers at all here.',
    '',
  ]
  for (const text of corpus) {
    const figs = extractFigures(text)
    for (const f of figs) {
      assert.equal(text.slice(f.start, f.end), f.raw,
        `reported ${JSON.stringify(f.raw)} but the text at [${f.start},${f.end}) is ` +
        `${JSON.stringify(text.slice(f.start, f.end))} — in: ${text}`)
      assert.ok(text.includes(f.raw), `${JSON.stringify(f.raw)} is not in: ${text}`)
    }
    for (let i = 1; i < figs.length; i++) {
      assert.ok(figs[i].start >= figs[i - 1].end,
        `${figs[i - 1].raw} and ${figs[i].raw} overlap — one figure counted twice in: ${text}`)
    }
  }
  // The exact incident, pinned: 40% is a rate, and there is no four.
  assert.deepEqual(extractFigures('40% growth').map(f => f.raw), ['40%'])
  assert.equal(extractFigures('40% growth').filter(f => f.kind === 'count').length, 0)

  // And the structural half — no scanner in this layer may end a pattern in a failing lookahead
  // over the SAME characters it is trying to skip. Use a span/overlap guard instead, which cannot
  // backtrack because there is nothing left to backtrack into.
  // This half is a SOURCE rule because the runtime cannot see the defect once the percent scanner
  // works: the backtracked "4" lands inside the span the percent scanner already claimed, so the
  // overlap guard silently eats it and every assertion above still passes. Verified by reverting —
  // restoring the lookahead alone leaves all 27 hardening cases green. The hazard is real and
  // invisible, which is exactly the kind that needs a structural guard.
  //
  // `[^)]*` cannot be used to reach the lookahead: the pattern it must cross contains `)` of its
  // own (`(?:\.\d+)`), so the scan has to be line-scoped.
  const offenders = []
  for (const [f, body] of allSources()) {
    for (const line of stripComments(body).split('\n')) {
      if (/matchAll\(/.test(line) && /\(\?!/.test(line) && /%|percent/.test(line)) offenders.push(`${f}: ${line.trim()}`)
    }
  }
  assert.deepEqual(offenders, [], 'a backtrackable exclusion lookahead is back in a figure scanner')
})

// ---------------------------------------------------------------------------------------------
// H25 — An accusation-grade check fired on text that had done nothing wrong.
//
// R3 names the field and the exact string a candidate supposedly lifted from the employer's ad. Its
// first rule was the backlog's literal wording — "no numeric string that also appears in jd_real" —
// and measured against a real resume package with a posting reading "three business units" it
// produced three offenders:
//     ResumeSummary: (none)   SkillsBullets1: 3   SkillsBullets2: 3   ExpertiseBullets: three
// from the bullets "Skill number 3", "Other skill 3" and "One two three four five". Not one of them
// mentions a business unit. The document was clean and the check called it a thief.
//
// A guard people learn to ignore is worse than no guard (hardening rule 2), and this is the shape
// that gets ignored fastest: a check that is right about the rare case and wrong about the common
// one. The rule that fixes it is not a threshold or a similarity score — it is that a bare number
// is not a claim. "3" claims nothing; "3 business units" does.
//
// The invariant: a check that names an offender must fire on the CLAIM, not on a number that
// happens to appear in both documents — and it must still catch the real echo.
test('H25: R3 accuses a claim, never a coincidence of digits', () => {
  const posting = 'You will own three business units, a $18M portfolio and 60+ sites.'
  const profile = 'Ran platform engineering for a regional utility.'

  // The exact incident. Every one of these is innocent.
  for (const clean of [
    'Skill number 3', 'Other skill 3', 'One two three four five', 'Ran 3 marathons.',
    'Three times a week.', 'Cut cost 18%.', 'Shipped 60 releases of the scheduler.',
  ]) {
    const hits = scanEcho(clean, posting, profile).echoes
    assert.deepEqual(hits, [], `${JSON.stringify(clean)} was accused of echoing: ${hits.map(e => e.figure.raw)}`)
  }

  // And the check is still a check. Each of these IS the employer's number.
  for (const [guilty, expected] of [
    ['Led three business units.', ['three']],
    ['Managed a $18M portfolio.', ['$18M']],
    ['Ran 60 sites.', ['60']],                 // unmarked answer to a marked ask — the commonest echo
    ['Owned three business unit rebuilds and a $18M budget.', ['three', '$18M']],
  ]) {
    assert.deepEqual(scanEcho(guilty, posting, profile).echoes.map(e => e.figure.raw), expected, guilty)
  }

  // The structural half: an unmarked figure may never key on the number alone.
  //
  // This comment used to claim "deleting the unit from claimKey restores the incident exactly".
  // A verifier proved that false: `scanEcho` INLINED the same rule and never called `claimKey`, so
  // reverting `claimKey` changed nothing in production and only this assertion fired. The guard was
  // watching dead code and would have kept passing while the real logic beside it was reverted.
  // `scanEcho` now decides through `claimKey` itself — reverting it fails nine cases, not one.
  const bare = extractFigures('three business units')[0]
  assert.ok(!isMarked(bare))
  assert.notEqual(claimKey(bare), bare.key, 'an unmarked figure keyed on the bare number again')
  assert.notEqual(claimKey(bare), claimKey(extractFigures('three marathons')[0]),
    'two different nouns must be two different claims')
})

// ---------------------------------------------------------------------------------------------
// H27 — A check reported PASS on evidence it never read, because the caller and the scanner
// disagreed about what "empty" means.
//
// `scanEcho` decides emptiness against the NORMALIZED posting; `runChecks` re-derived it from the
// RAW string. `opportunity.jd_real` stores `descriptionHtml`, so `<p></p>` is a non-empty raw
// string and an empty posting. Measured before the fix, with a generated summary stating an $18M
// P&L and 60 engineers:
//     runChecks(postingText: '<p></p>')      -> state=pass  "no posting-only figures across 1 field(s)"
//     scanEcho (same input)                  -> notApplicable=true "no employer posting text..."
// and `gateFor([pass])` turned that into a green gate. The scanner got it right and the caller
// threw the answer away — `notApplicable` had ZERO readers in src/.
//
// The profile side was worse, because it does not go quiet, it ACCUSES:
//     profile '<p></p>' -> warn, offenders ["ResumeSummary: 60", "ResumeSummary: $18M"]
//     profile '  '      -> not_applicable
// An unreadable profile named the candidate's own figures as stolen, because the evidence that
// would have exonerated them read as absent rather than as unreadable.
//
// The invariant is not "trim harder". It is that ONE component owns the question "could this be
// judged", and every caller reports that component's answer rather than computing its own.
test('H27: the check reports the scanner\'s not_applicable, it does not re-derive it', () => {
  const pkg = { ResumeSummary: 'Scaled the org to 60 engineers and owned an $18M P&L.' }
  const posting = 'We manage a $18M portfolio with 60+ engineers.'
  const profile = 'Von scaled the org to 60 engineers and owned an $18M P&L at Acme.'
  const row = (rs) => rs.find(r => r.check_key === 'posting_figure_echo')

  // A posting that is markup and nothing else was never compared to anything.
  for (const empty of ['<p></p>', '<div><br/></div>', '&nbsp;&nbsp;', '  <br>  ', '<script>var x=1</script>']) {
    const r = row(runChecks({ type: 'resume', pkg, postingText: empty, profileText: profile }))
    assert.equal(r.state, 'not_applicable', `posting ${JSON.stringify(empty)} produced ${r.state}`)
    assert.notEqual(gateFor([r]), 'pass', 'and it may never turn into a green gate')
  }

  // A profile that is markup and nothing else cannot exonerate — and must not accuse.
  for (const empty of ['<p></p>', '<div></div>', '&nbsp;']) {
    const r = row(runChecks({ type: 'resume', pkg, postingText: posting, profileText: empty }))
    assert.equal(r.state, 'not_applicable', `profile ${JSON.stringify(empty)} produced ${r.state}`)
    assert.deepEqual(r.offenders, [], 'an unreadable profile named an offender')
  }

  // Both readable: the check does its job, and the kept figures are CITED rather than counted.
  const good = row(runChecks({ type: 'resume', pkg, postingText: posting, profileText: profile }))
  assert.equal(good.state, 'pass')
  assert.match(good.observed, /your profile states/, 'C5 says kept AND cited; a count is not an excerpt')

  // Structural: no caller may re-implement the emptiness test the scanner already owns.
  const offenders = allSources()
    .filter(([f]) => f !== 'figureEcho.ts')
    .filter(([, body]) => /scanEcho\(/.test(stripComments(body)))
    .filter(([, body]) => /(postingText|profileText)\s*\|\|\s*''\s*\)\s*\.trim\(\)|String\(\s*input\.(postingText|profileText)[^)]*\)\.trim\(\)/.test(stripComments(body)))
    .map(([f]) => f)
  assert.deepEqual(offenders, [], 'a caller is deciding emptiness for itself again')
})

// ---------------------------------------------------------------------------------------------
// H26 — This file could carry two different cases under one ID, and nothing would notice.
//
// Not a hypothetical. Measured 2026-08-20 across three live lane branches:
//     qc-p8-2-figures   H24 H25 H28
//     qc-p8-3-evidence  H27 H28 H29 H30
//     qc-p3-remediation H26 H27 H28 H29 H30 H31
// `H28` meant three different defects; `H27`, `H29` and `H30` two each. IDs had been pre-allocated
// one per lane precisely to prevent this, which was never going to be enough — each lane found
// several defects, not one. Ranges, not single IDs.
//
// The reason it goes unnoticed is structural: this file is append-only by convention, so three
// branches each appending at the end MERGE CLEANLY. Git reports no conflict, every branch is green
// in isolation, and the duplicates land silently. An ID that names two things is an ID that names
// nothing — `.claude/actions.md` points at these numbers, and the whole scheme depends on the
// pointer resolving to exactly one case.
//
// The invariant: one ID, one case, and no gaps that hide a case lost in a merge.
test('H26: every hardening case has its own ID', () => {
  const self = readFileSync(new URL('./hardening.test.mjs', import.meta.url), 'utf8')
  // Read the ID off the test NAME, which is what a reader and actions.md both use. Comments are
  // stripped first: this very comment block lists six duplicate IDs, and a scan that counted those
  // would fire on the description of the bug rather than the bug.
  const ids = [...stripComments(self).matchAll(/test\('(H(\d+)):/g)].map(m => ({ id: m[1], n: Number(m[2]) }))
  assert.ok(ids.length >= 26, `only ${ids.length} cases found — the scan has gone stale`)

  const seen = new Map()
  const dupes = []
  for (const { id } of ids) {
    if (seen.has(id)) dupes.push(id); else seen.set(id, true)
  }
  assert.deepEqual(dupes, [], 'two cases share an ID — actions.md now points at both and resolves to neither')

  // A GAP is the other half of the same accident: a merge that dropped a case leaves its number
  // unused, and the next lane reuses it for something unrelated. Numbering must be contiguous from
  // H1, so a hole is visible at the moment it appears rather than at the moment it is reused.
  const nums = ids.map(x => x.n).sort((a, b) => a - b)
  const missing = []
  for (let i = 1; i <= nums[nums.length - 1]; i++) if (!nums.includes(i)) missing.push(`H${i}`)
  assert.deepEqual(missing, [], 'a hardening case was lost in a merge — its ID is unused')
})

// ---------------------------------------------------------------------------------------------
// H28 — The must-have numerator credited requirements that the engine had just declared it was NOT
// judging. `must_have_coverage`'s fail branch divided by `mustHaves.length` while its numerator came
// from `coverable` alone (checks.ts, pre-P8.3), and `computeArtifactScore` repeated the wider
// denominator a third time with `mustHaveTotal = reqs.filter(r => r.kind === 'must_have').length`.
//
// Evidence, on the shape the live Trinnex posting actually has (opp 9f9c370a: 4 must-haves, of which
// "Reside in the East Coast of the United States", "must be a U.S. Citizen or Green Card Holder" and
// "Active Secret security clearance required" are eligibility clauses no merge field can carry, and
// one is judgeable): the check printed "3/4 must-haves covered" and the score returned 75 — while
// exactly ONE requirement had been measured and it had FAILED. `template_reach` reported those three
// as not_applicable in the same run, and the numerator counted them as covered anyway.
//
// This is `not_applicable` laundered into a numerator: the same defect as a check going green on
// absent evidence (H6), one layer up, and it inflates the single number a reviewer trusts most.
//
// The invariant: every branch of a coverage check divides by the population it actually judged, the
// score takes BOTH numbers from that check rather than recomputing either, and a row excluded from
// the judgement is counted by name instead of being absorbed into the numerator.
test('H28: a requirement nothing measured is never counted as covered', () => {
  const reqs = [
    { seq: 0, verbatim: 'Reside in the East Coast of the United States', item_text: '', kind: 'must_have' },
    { seq: 1, verbatim: 'must be a U.S. Citizen or Green Card Holder', item_text: '', kind: 'must_have' },
    { seq: 2, verbatim: 'Active Secret security clearance required', item_text: '', kind: 'must_have' },
    { seq: 3, verbatim: 'Deep experience with roadmap strategy and execution', item_text: '', kind: 'must_have' },
  ]
  const results = runChecks({
    type: 'resume',
    pkg: { ResumeSummary: 'Owns roadmap strategy and execution with deep experience.' },
    requirements: reqs,
    evidence: { profileReadable: true, bySeq: {} },   // the profile supports none of them
  })
  const cov = results.find(r => r.check_key === 'must_have_coverage')
  assert.equal(cov.state, 'fail')
  assert.match(cov.observed, /^0\/1 /, `judged one requirement and it failed, so the numerator is 0/1, not 3/4 — got "${cov.observed}"`)
  assert.match(cov.observed, /3 not reachable by any generated field/, 'the excluded rows must be counted by name, not absorbed')

  // The score must reach the same conclusion, because it reads BOTH numbers off that check.
  const score = computeArtifactScore({ requirements: reqs, checks: results })
  assert.equal(score.must_have_coverage.value, 0,
    'recomputing the denominator from every must_have row scores this 75 for an artifact that covered nothing')

  // The structural half: the score must not grow its own denominator back. Deleting the parse and
  // restoring `reqs.filter(r => r.kind === 'must_have').length` reproduces the incident exactly, and
  // no runtime assertion above would notice on an input with no excluded rows.
  const scoreSrc = stripComments(src('artifactScore.ts'))
  assert.ok(!/kind\s*===\s*'must_have'/.test(scoreSrc),
    'the score recomputed the must-have population instead of reading the checks denominator')
})

// ---------------------------------------------------------------------------------------------
// H29 — An evidence quote must be a substring of the profile record it NAMES, not of the profile.
//
// This is H16 arriving in a new place. H16 records that `postingText.includes(quote) &&
// requirementExists(id)` accepted a reviewer citation lifted from an unrelated part of the document,
// and the fix was to require the quote to land inside the CITED requirement's span. P8.3's
// acceptance sentence — "an evidence quote is a substring of the stored profile record it names" —
// is the same rule, and the same shortcut is available: `sourceText().text` is a single blob of the
// resume template joined to every MasterContext field, so a quote validated against IT can span two
// unrelated records and still pass. A sentence half in one job's history and half in another's is
// not something the candidate ever wrote.
//
// The invariant: resolution is per-record. A span is only evidence if the record it names contains
// exactly those bytes at exactly those offsets; a quote that exists only in the concatenation is
// refused rather than attributed to whichever record it started in.
test('H29: evidence resolves against ONE named record, never against the joined profile', () => {
  // Deliberately split across two records: the phrase exists in the concatenation and in neither
  // record on its own.
  const split = [
    { key: 'workHistory1', kind: 'work_history', label: 'Work history 1', text: 'VP Engineering, Resideo. Led the platform modernization' },
    { key: 'workHistory2', kind: 'work_history', label: 'Work history 2', text: 'programme across four product lines and retired the mainframe.' },
  ]
  const req = 'Led the platform modernization programme across four product lines'
  // sourceText joins records with '\n\n'; the citation validator's match is whitespace-tolerant
  // (reviewer.findQuoteSpans), so the separator is no protection at all.
  const blob = split.map(r => r.text).join('\n\n').replace(/\s+/g, ' ')
  assert.ok(blob.includes(req), 'the phrase IS in the joined profile — that is the trap')
  assert.equal(resolveEvidence(req, split), null, 'and it is in no single record, so it is not evidence')

  // And when a record genuinely does contain it, the row is the record's own bytes at its offsets.
  const whole = profileRecords({ workHistory1: `VP Engineering, Resideo. ${req} and retired the mainframe.` }, null)
  const ev = resolveEvidence(req, whole)
  assert.ok(ev, 'a real match must still resolve — a guard that refuses everything is not a guard')
  assert.equal(ev.source_key, 'workHistory1')
  assert.equal(whole[0].text.slice(ev.char_start, ev.char_end), ev.quote)
})

// ---------------------------------------------------------------------------------------------
// H30 — "your profile does not support this" and "we could not read your profile" are different
// statements, and only one of them is a measurement.
//
// C6 moved the coverage numerator onto evidence rows. That creates a state the old numerator could
// not reach: a run where the profile could not be read at all (the resume template is fetched live
// over Google OAuth and MasterContext over a storage connection string — appFacts.sourceText records
// both failures in `sources` and returns an empty string). Resolving against an empty profile
// produces zero evidence rows for every requirement, and zero rows reported as a number is "0%
// covered" meaning "we did not look" — an accusation against the candidate for an outage.
//
// The opposite error is just as available: filing a READ profile that genuinely supports nothing as
// not_applicable drops those requirements out of the denominator, and the packet reads 100% covered
// with a hard requirement unmet. That is H6's failure with the sign flipped.
//
// The invariant: an unreadable profile is not_applicable and a NULL score component (never 0, never
// pass, never fail); a readable profile with no support is a determinate gap — fail, named, and
// still in the denominator.
test('H30: an unreadable profile measures nothing; a readable one that supports nothing is a gap', () => {
  const reqs = [{ seq: 0, verbatim: 'Deep experience with Kubernetes cluster federation', item_text: '', kind: 'must_have' }]

  for (const evidence of [undefined, { profileReadable: false, bySeq: {} }]) {
    const rs = runChecks({ type: 'resume', pkg: { ResumeSummary: 'x' }, requirements: reqs, evidence })
    const cov = rs.find(r => r.check_key === 'must_have_coverage')
    assert.equal(cov.state, 'not_applicable', 'a run that could not read the profile measured nothing')
    assert.notEqual(cov.state, 'pass')
    assert.notEqual(cov.state, 'fail')
    const score = computeArtifactScore({ requirements: reqs, checks: rs })
    assert.equal(score.must_have_coverage.value, null, 'unknown is null, never zero')
    assert.equal(score.composite, null)
    assert.equal(gateFor([cov]), 'warn', 'and an unmeasured coverage row can never carry a gate to pass')
  }

  const read = runChecks({
    type: 'resume', pkg: { ResumeSummary: 'x' }, requirements: reqs,
    evidence: { profileReadable: true, bySeq: { 0: null } },
  })
  const cov = read.find(r => r.check_key === 'must_have_coverage')
  assert.equal(cov.state, 'fail', 'we looked and found nothing — that is a gap, not an unknown')
  assert.match(cov.observed, /^0\/1 /, 'and it stays in the denominator; dropping it reads 100%')
  assert.match(cov.offenders[0], /no evidence found in your profile/)
})

// ---------------------------------------------------------------------------------------------
// H31 — `covers()` returns false for a requirement it CANNOT judge, and that answer is only correct
// for the question it was written for.
//
// `covers()` refuses any requirement with fewer than MIN_JUDGEABLE_TOKENS content words (H5b). For
// COVERAGE that is right: an unjudgeable requirement must surface to a human rather than pass
// quietly. `evidence_placed` asks the opposite-facing question — "the profile supports this and did
// this asset say it?" — and reusing the same false there accuses a document of omitting something it
// states.
//
// Evidence, live: Trinnex requirement #5 (opp 9f9c370a) is "Experience in leading technology
// operations". `itemTokens` drops the stopwords and leaves exactly two — technology, operations —
// and the resume summary contains both, verbatim, in that order. The first version of this check
// printed "0/2 evidenced requirements appear in this document" and named #5 as absent from an asset
// whose first sentence is the requirement.
//
// The invariant: a check reporting an offender must have been able to judge it. A row the measure
// cannot reach is counted apart and named as unjudged, never folded into the offenders.
test('H31: a requirement too short to measure is never reported as missing from a document', () => {
  const req = { seq: 5, kind: 'must_have', verbatim: null, item_text: 'Experience in leading technology operations' }
  const evidence = {
    profileReadable: true,
    bySeq: { 5: { quote: 'led technology operations for a regional utility', source_kind: 'work_history',
                  source_label: 'Work history 1', source_key: 'workHistory1', char_start: 0, char_end: 47,
                  extra: null, ratio: 1, method: 'anchored', record_sha256: '', resolver_version: 1 } },
  }
  const rs = runChecks({
    type: 'resume',
    pkg: { ResumeSummary: 'Experience in leading technology operations for utility platforms.' },
    requirements: [req], evidence,
  })
  const placed = rs.find(r => r.check_key === 'evidence_placed')
  assert.ok(!placed.offenders.some(o => /^#5\b/.test(o)),
    `the summary literally says it; naming it absent is an accusation on absent evidence — got ${JSON.stringify(placed.offenders)}`)
  assert.equal(placed.state, 'not_applicable')
  assert.match(placed.observed, /none long enough to judge placement/)

  // And the reason really is the token floor — the same one `covers()` publishes.
  assert.ok(itemTokens('Experience in leading technology operations').length < MIN_JUDGEABLE_TOKENS)
})

// ---------------------------------------------------------------------------------------------
// H32 — A quote can be a TRUE SUBSTRING at the offsets recorded and still be the wrong five
// characters, because `toLowerCase()` is not length-preserving.
//
// `locate`'s exact branch searched `postingText.toLowerCase()` and used the index into that COPY as
// an offset into the ORIGINAL. U+0130 (Turkish dotted capital I) lowercases to two code units, so
// every one of them before a match shifts the recorded offset by one.
//
// Measured, found by the independent verifier of P8.3 with a record beginning
// "İİİİİ Resideo. led the platform modernization programme across four product lines and more.":
//     orig len 91, lower len 96
//     locate -> char_start 20, char_end 86     (the phrase actually begins at 15)
//     verbatim = "he platform modernization programme across four product lines and "
// "led t" cut off the front, " and " glued on the end — and `s.slice(20, 86) === verbatim` is TRUE,
// so every substring guard in the codebase passes it. It cleared MIN_QUOTE_CHARS, MIN_QUOTE_WORDS
// and the 0.7 ratio. `toBmp` does not help: U+0130 is BMP.
//
// It matters twice over. It has always been live on `requirement.verbatim`, where it garbles the
// employer's words; P8.3 points the same function at the candidate's own profile, where a garbled
// "your own words" is the worse failure of the two.
//
// The invariant: an offset is measured on the string it indexes. A case-insensitive search runs
// over the ORIGINAL — `m.index` and `m[0].length` are the original's — never over a folded copy,
// because no case fold is guaranteed to preserve length.
test('H32: an offset is measured on the string it indexes, never on a folded copy', () => {
  const phrase = 'led the platform modernization programme across four product lines'
  // One case-expanding character per prefix length, so a shifted offset is off by exactly that many.
  for (const pad of ['', 'İ', 'İİ', 'İİİİİ', 'ẞ', 'ﬁﬁﬁ']) {
    const text = `${pad} Resideo. ${phrase} and more.`
    const truth = text.indexOf(phrase)
    const r = locate(phrase, text)
    assert.equal(r.char_start, truth, `pad ${JSON.stringify(pad)}: offset drifted with the fold`)
    assert.equal(r.verbatim, phrase, `pad ${JSON.stringify(pad)}: the excerpt is the wrong characters`)
    // The substring property held even when it was WRONG — which is why it cannot be the only test.
    assert.equal(text.slice(r.char_start, r.char_end), r.verbatim)
  }

  // And the search is still case-insensitive, which is what the fold was there for.
  const upper = 'RESIDEO. LED THE PLATFORM MODERNIZATION PROGRAMME ACROSS FOUR PRODUCT LINES and more.'
  const u = locate(phrase, upper)
  assert.equal(u.match_method, 'exact')
  assert.equal(upper.slice(u.char_start, u.char_end), u.verbatim)
  assert.equal(u.verbatim.toLowerCase(), phrase.toLowerCase())

  // Structural: the folded-copy search must not come back. Nothing above would notice on ASCII.
  const body = stripComments(src('requirements.ts'))
  assert.ok(!/postingText\.toLowerCase\(\)/.test(body),
    'the exact branch indexed a lower-cased copy again')
})

// H33 — A behaviour toggle the server reads and NOTHING can send. Third shipping of this class.
//
//   actions.md A2   `regen` honoured server-side, `appPackets.ts:454` hardcoded it false
//   actions.md X2   made `regen` reachable — from ONE of the three routes that read it
//   actions.md      "Re-run ATS analysis": server read `force`, `api.js` helper took no argument
//
// Measured 2026-08-20, after X2 was recorded as closed: `appPackets.ts:382` (document) and `:457`
// (slides) both read `regen` from the body and `:319` honours it, yet NO caller on ANY path could
// send it. Not the UI — `api.js` posted `{}` with no options parameter. Not the coach agent —
// `coachTools.ts:28/29` post no body to those routes and their tool schemas declare only
// `artifactId`. A parameterised cache bypass with zero senders, on the two routes a user reaches
// when they want exactly that.
//
// Fixing instances is what failed the first two times, so this asserts the CLASS: a toggle the
// server reads must have some caller able to send it, or be listed as unreachable by design with a
// reason. It is a source rule because the absence of a caller cannot be exercised at runtime.
// Routes with NO committed caller anywhere — not `app/src/api.js`, not the legacy `web/` console,
// not `.github/workflows/`, not `scripts/` (all four searched 2026-08-20). They are operator
// endpoints, invoked by hand with a written-out body through `api-test.yml`, so there is no caller
// for this guard to find and its absence is not evidence of a defect.
//
// This list is the guard's pressure valve, and it is exactly where a real gap would go to hide.
// Two assertions below keep it honest: every entry must carry a reason, and no entry may name a
// toggle something CAN send — so an entry cannot be parked here and quietly outlive its fix.
const UNREACHABLE_BY_DESIGN = [
  { toggle: 'favoritesOnly', route: 'app/ats-backfill', why: 'operator backfill, invoked by hand via api-test.yml' },
  { toggle: 'fetchJd', route: 'mail/jd-backfill/recover-targeted', why: 'operator JD recovery, hand-invoked' },
  { toggle: 'debug', route: 'mail/jd-backfill/recover-targeted', why: 'operator diagnostic dump, hand-invoked' },
  { toggle: 'favoritesOnly', route: 'mail/jd-backfill/recover-targeted', why: 'operator JD recovery scope, hand-invoked' },
  { toggle: 'llm', route: 'mail/jd-backfill/scan', why: 'operator scan mode, hand-invoked' },
  { toggle: 'favoritesOnly', route: 'mail/jd-backfill/fetch', why: 'operator fetch scope, hand-invoked' },
  { toggle: 'direct', route: 'mail/jd-backfill/fetch', why: 'operator fetch strategy, hand-invoked' },
  { toggle: 'superOnBlock', route: 'mail/jd-backfill/fetch', why: 'operator fallback on a blocked fetch, hand-invoked' },
  { toggle: 'dryRun', route: 'mail/folders/reclassify', why: 'operator reclassify preview — the safe half of a destructive op' },
  // Both surfaced only after the grammar widened and the route-unscoped coach fallback was removed.
  // `apply` is the one a verifier found sitting outside this list precisely because the guard could
  // not see it: `\bapply\b` matched `/apply/` in an unrelated coach tool's URL and certified it.
  { toggle: 'apply', route: 'mail/jd-backfill/dismiss-phantoms', why: 'operator phantom-dismissal — preview vs apply, hand-invoked' },
  { toggle: 'skipFilter', route: 'mail/folder-map', why: 'operator folder-map override, hand-invoked' },
]

test('H33: every server-side body toggle has a caller that can send it', () => {
  const API_JS = readFileSync(new URL('../../app/src/api.js', import.meta.url), 'utf8')
  const apiCode = stripComments(API_JS)
  // The legacy `web/` console is a real caller surface. Omitting it made the guard report the whole
  // MT harness family as unreachable — correct code, accused, because the search looked in one of
  // the two clients that exist.
  const WEB_DIR = new URL('../../web/', import.meta.url).pathname
  const webCode = (() => {
    const read = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? (e.name === 'node_modules' ? [] : read(join(d, e.name)))
        : /\.(js|jsx|html)$/.test(e.name) ? [readFileSync(join(d, e.name), 'utf8')] : [])
    try { return stripComments(read(WEB_DIR).join('\n')) } catch { return '' }
  })()
  const COACH_SRC = src('coachTools.ts')

  // Both grammars actually in use. Comments stripped FIRST: this case's own header names `regen`
  // and `force` half a dozen times, and a scan that counted those would fire on the description of
  // the bug rather than the bug — the cry-wolf failure, from inside the guard meant to prevent it.
  // A verifier slipped SIX shapes past the first grammar, every one of them a real way this
  // codebase already writes a toggle:
  //   const { deepScan } = body            destructured, never touches `.x`
  //   flag(body, 'deepScan')               read through a helper
  //   (await req.json())?.x !== false      the inline form accepted `=== true` only — an asymmetry,
  //                                        since the `body.x` form already accepted both
  //   input?.deepScan === true             receiver named something other than body/b/json/payload
  //   if (body?.deepScan)                  bare truthy — NOT hypothetical: appFacts.ts:232 reads
  //                                        `body.confirm` exactly this way and was invisible
  //   body?.deepScan === false             the negative comparison
  // Widened to any receiver, any of the four comparison forms, and the destructured and
  // helper-read shapes. A grammar that only sees the canonical spelling measures the author's
  // habits, not the codebase.
  // The receiver is not guessed from a name list — it is RESOLVED per file to the variables actually
  // assigned from `req.json()`. Widening to a plausible-sounding list (`opts`, `args`, `input`,
  // `parsed`) instead made the guard cry wolf on eighteen internal destructurings — `const {
  // agreement, dropped, ran } = …` in reviewer.ts among them, which touch no request at all. A
  // guard that fires on internal variable names is one people learn to ignore.
  const receiversIn = (code) => {
    const names = new Set(['body'])
    for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:\(?\s*await\s+)?req\.json\(\)/g)) names.add(m[1])
    for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*\(\s*await\s+req\.json\(\)/g)) names.add(m[1])
    return [...names]
  }
  // Six shapes a verifier slipped past the first grammar, each a real way this codebase writes a
  // toggle: destructured (`const { x } = body`); read through a helper; the inline
  // `(await req.json())?.x !== false`, which the first version accepted only as `=== true` while
  // already accepting both for `body.x` — an asymmetry, not a scope choice; a differently-named
  // receiver; a bare truthy `if (body?.x)`, which is NOT hypothetical (appFacts.ts:232 reads
  // `body.confirm` exactly that way and was invisible); and `=== false`.
  const toggleRe = (code) => {
    const R = `(?:${receiversIn(code).join('|')})`
    const CMP = '(?:===\\s*(?:true|false)|!==\\s*(?:false|true))'
    return new RegExp([
      `\\b${R}\\s*\\??\\.\\s*([a-zA-Z_]\\w*)\\s*${CMP}`,
      `\\(await\\s+req\\.json\\(\\)[^;]*?\\)\\s*\\??\\.\\s*([a-zA-Z_]\\w*)\\s*${CMP}`,
      `\\bconst\\s*\\{([^}]+)\\}\\s*=\\s*${R}\\b`,
    ].join('|'), 'g')
  }

  // A toggle is only answerable together with the ROUTE that reads it: "can anything send `regen`"
  // has no answer, but "can anything send `regen` to /artifact/{id}/document" does. So resolve each
  // occurrence to its enclosing handler, and each handler to the route it is registered under.
  const found = []
  for (const [file, body] of allSources()) {
    const code = stripComments(body)
    const routeOf = new Map()
    for (const m of code.matchAll(/route:\s*'([^']+)'[^}]*handler:\s*(\w+)/g)) routeOf.set(m[2], m[1])
    for (const m of code.matchAll(/handler:\s*(\w+)[^}]*route:\s*'([^']+)'/g)) routeOf.set(m[1], m[2])
    const fns = [...code.matchAll(/(?:export\s+)?async\s+function\s+(\w+)/g)].map(m => ({ name: m[1], at: m.index }))
    // A handler reached through a DISPATCHER has no `app.http` of its own — `templatesUpsert` is
    // called by a registered function that switches on `req.method`. Reporting its route as
    // unresolved made a healthy toggle look unreachable, so inherit the dispatcher's route.
    // Matches both spellings a dispatcher is written in — `async function name(req` and
    // `const name = async (req`. Requiring the `function` keyword missed `templatesCollection`,
    // which is the const-arrow form, and left `isPrimary` reported as unreachable while
    // Settings.jsx sends it on every click.
    for (const [, f1, f2, callee] of code.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*async)[\s\S]{0,600}?\b(\w+)\(req[,)]/g)) {
      const caller = f1 || f2
      if (caller && routeOf.has(caller) && !routeOf.has(callee)) routeOf.set(callee, routeOf.get(caller))
    }
    for (const m of code.matchAll(toggleRe(code))) {
      // A DESTRUCTURED name is only a toggle if it is later used as one. `const { roleType,
      // jobTitle } = body` is ordinary input, and counting it turns this into "every body field
      // must be sendable" — a different, far noisier rule that fired on eight data fields in the
      // legacy MT harness. Require a boolean use of the name in the same file.
      // EXPLICIT comparison only. Bare truthiness (`if (alertText)`) is how you test that a STRING
      // arrived, not how you read a flag, and accepting it re-flagged `alertText`, `imageB64` and
      // `demoState` — three data fields — as behaviour toggles.
      const usedAsBoolean = (n) => new RegExp(
        `\\b${n}\\s*(?:===\\s*(?:true|false)|!==\\s*(?:true|false))`
      ).test(code)
      const names = m[3]
        ? m[3].split(',').map(x => x.trim().split(':')[0].trim()).filter(Boolean).filter(usedAsBoolean)
        : [(m[1] || m[2] || m[4])]
      for (const name of names) {
      if (!name) continue
      const owner = fns.filter(f => f.at < m.index).pop()
      found.push({ toggle: name, file, handler: owner?.name || '(top level)', route: routeOf.get(owner?.name) || null })
      }
    }
  }
  // A TIGHT BAND, not a floor. `>= 8` against a real 24 could not detect staleness at all: a
  // verifier amputated the `!== false` grammar (24 reads -> 16) and then optional chaining
  // (-> 12), and the guard went green both times — blinding it to the dominant idiom in this
  // codebase without a single failure. A floor set far below the real number is decoration.
  //
  // Measured 2026-08-20 on this branch: 24 reads, 18 distinct names —
  //   apply debug direct draftOutreach dryRun enabled execOnly favoritesOnly fetchJd force
  //   isPrimary llm regen reset seedCadence skipFilter superOnBlock undo
  // (The first version of this comment recorded "11 reads, 7 distinct names" — off by more than
  // 2x, which breaks the H-case rule that the recorded evidence must be the measured value.)
  const distinct = new Set(found.map(x => x.toggle)).size
  assert.ok(found.length >= 20 && found.length <= 40,
    `${found.length} toggle reads — expected ~24. Below the band the grammar has gone blind; above it, widen deliberately and re-record the count here.`)
  assert.ok(distinct >= 15, `only ${distinct} distinct toggle names — expected ~18; the grammar has narrowed`)

  // `{param}` in a route matches `${param}` in an api.js template literal.
  // The closing anchor allows a QUERY STRING. Anchoring hard on the backtick made every helper
  // that appends `?owner=…` invisible, so `helpersFor` returned nothing and the guard accused
  // correct code: tightening `body.confirm` to an explicit comparison would have reported
  // `confirm -> app/qc/facts/set` unreachable while `api.js:125` forwards a bag to it.
  const routeRe = (r) => new RegExp('`/' + r.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '\\$\\{[^}]+\\}') + '(?:\\?[^`]*)?`')

  // Two ways to send, and rule TWO is mandatory. The string `regen` appears ZERO times in api.js,
  // yet `regen` on packet/build-all is genuinely reachable because `buildFullPacket` forwards an
  // opaque `opts`. A name-only scan would accuse correct code on its first run — which guards in
  // this repo have now done twice. But the forwarding check must be scoped to the helper for THAT
  // route: taken globally, one forwarding helper anywhere certifies every toggle everywhere, and
  // the guard passes while a brand-new unreachable toggle sits in the tree. It did exactly that on
  // its first version, caught by adding an unsendable `deepScan` and watching nothing happen.
  // EVERY helper on that route, not the first. `.find()` was the first version and it was wrong in
  // the quietest possible way: `dismiss` sits above `undismiss` and `coachConfigGet` above
  // `coachConfigSet`, so the read-only sibling matched first and the guard reported the real sender
  // missing. It named four healthy toggles as defects — the cry-wolf failure, in the guard whose
  // entire purpose is to not cry wolf.
  const helpersFor = (route) => {
    if (!route) return []
    const re = routeRe(route)
    return apiCode.split('\n').filter(l => re.test(l))
  }
  const canSend = ({ toggle, route }) => {
    const named = new RegExp(`\\b${toggle}\\b`)
    // A helper for this route that either names the toggle or forwards a caller-supplied object.
    // A bare identifier as the body argument is a caller-supplied bag, whatever it is named —
    // `opts`, `body`, `data`. Enumerating the names missed `templateSave: (data) => post(…, data)`
    // and reported `isPrimary` unreachable when Settings.jsx sends it on every click.
    // Anchored to the CALL, not the line. `/,\s*\w+\s*\)/` alone matched the arrow function's own
    // PARAMETER list — `atsSourceAdd: (provider, board) => post(…, { provider, board })` was read
    // as forwarding a bag because of `, board)` in its signature, and the guard cleared a toggle
    // that route cannot send. A guard too permissive in one spot is indistinguishable from no
    // guard, and this one had already been vacuous once.
    const FORWARDS = /post(?:Detailed)?\(`[^`]*`,\s*[a-zA-Z_]\w*\s*\)/
    if (helpersFor(route).some(l => named.test(l) || FORWARDS.test(l))) return true
    // A route we could not resolve is not evidence of anything — fall back to naming it anywhere in
    // api.js rather than reporting an unresolved route as an unreachable toggle.
    if (!route && named.test(apiCode)) return true
    if (named.test(webCode)) return true                                     // the legacy console is a client
    // The coach agent is a caller too, but ROUTE-SCOPED. Matching its source by bare name was the
    // single worst bug in this guard: `\bapply\b` matched the substring `/apply/` inside the URL
    // path of an unrelated coach tool on a different route, and certified `apply` on
    // `mail/jd-backfill/dismiss-phantoms` — a genuinely unsendable operator toggle that therefore
    // never reached the allowlist for review. A global name test is the vacuous shape this guard
    // has now had three times.
    if (route) {
      const tail = route.replace(/\{[^}]+\}/g, '')
      const tool = stripComments(COACH_SRC).split('\n').find(l => l.includes('path:') && tail.split('/').filter(x => x.length > 3).every(seg => l.includes(seg)))
      if (tool && named.test(tool)) return true
    }
    return false
  }

  const unreachable = found.filter(x => !canSend(x))
    .filter(x => !UNREACHABLE_BY_DESIGN.some(u => u.toggle === x.toggle && u.route === x.route))
    .map(x => `${x.toggle} -> ${x.route || x.handler} (read in ${x.file}, no caller can send it)`)
  assert.deepEqual([...new Set(unreachable)], [], 'a server toggle has no caller that can send it')

  for (const u of UNREACHABLE_BY_DESIGN) {
    assert.ok(u.why && u.why.length > 10, `${u.toggle} is allowlisted with no reason`)
    assert.ok(!canSend(u), `${u.toggle} is allowlisted but a caller CAN send it — the allowlist is hiding a real gap`)
  }

  // The two instances that prompted this, pinned by name so a revert is caught even if the class
  // scan above is later loosened.
  for (const helper of ['generateArtifactDocument', 'generateArtifactSlides']) {
    const line = apiCode.split('\n').find(l => l.includes(`${helper}:`))
    assert.ok(line, `${helper} not found in api.js`)
    assert.match(line, /opts\s*=\s*\{\}/, `${helper} takes no options argument — it cannot send regen`)
    assert.match(line, /opts\.regen/, `${helper} does not forward regen`)
  }
})

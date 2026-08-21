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
import { computeArtifactScore, judgedMustHaveIds, mustHaveSource, parseMustHaveSource } from '../dist/functions/tests/artifactScore.js'
import { deriveFacts } from '../dist/functions/tests/ownerFacts.js'
import { parseResumePackage } from '../dist/functions/tests/resumeParser.js'
import { validateCitations, reviewerChecks, agreementFor } from '../dist/functions/tests/reviewer.js'
import { extractFigures, scanEcho, claimKey, isMarked, generalize } from '../dist/functions/tests/figureEcho.js'
import { planCorrections } from '../dist/functions/tests/correction.js'
import { profileRecords, resolveEvidence } from '../dist/functions/tests/evidence.js'

const SRC = new URL('../src/functions/tests/', import.meta.url).pathname
const src = (f) => readFileSync(join(SRC, f), 'utf8')
const allSources = () => readdirSync(SRC).filter(f => f.endsWith('.ts')).map(f => [f, src(f)])

/** Source with comments removed. A guard that fires on prose is one people learn to ignore. */
const stripComments = (body) => body
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

/**
 * The body of ONE top-level `export function <name>(` declaration, and nothing else.
 *
 * Structural guards that search a whole MODULE accuse every other function in it. H28's did, the
 * moment a second function in `artifactScore.ts` legitimately needed the construct H28 forbids
 * inside the scorer. Sliced to the closing brace in column 0, which is what this codebase's
 * formatting guarantees; a name that does not resolve returns '' so the caller's own staleness
 * assertion fires rather than the guard passing on nothing.
 */
const functionBody = (body, name) => {
  const start = body.indexOf(`export function ${name}(`)
  if (start < 0) return ''
  const end = body.indexOf('\n}', start)
  return end < 0 ? body.slice(start) : body.slice(start, end + 2)
}

/**
 * The text of ONE `create table if not exists <name> ( ... );` block, and nothing else.
 *
 * Every schema assertion below needs this, and the two that did not have it were INERT. Both failed
 * the same way and it is worth stating once: `SCHEMA_SQL` contains each constraint TWICE — inline on
 * the CREATE TABLE, and again in the idempotent `alter table ... add constraint` that carries it to
 * a database which already exists. A substring search over the whole string therefore cannot tell
 * "inline on the create" from "in the alter", so deleting the inline one changed nothing and the
 * guard passed. A `[\s\S]*?` span was worse: with the real column deleted it simply walked on to
 * the NEXT table that had a column by that name and matched there.
 * Verified by an independent verifier, 2026-08-20, who deleted each constraint in turn and watched
 * NO TEST FAIL four times.
 */
const createTable = (schema, name) => {
  const start = schema.indexOf(`create table if not exists ${name} (`)
  assert.notEqual(start, -1, `no create table for ${name} — the scan has gone stale`)
  const end = schema.indexOf('\n);', start)
  assert.notEqual(end, -1, `unterminated create table for ${name}`)
  return schema.slice(start, end)
}

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
// H26 — Two cases under one ID, and nothing noticed. Then the FIX for that failed three more times.
//
// The original failure, measured 2026-08-20 across three live lane branches:
//     qc-p8-2-figures   H24 H25 H28
//     qc-p8-3-evidence  H27 H28 H29 H30
//     qc-p3-remediation H26 H27 H28 H29 H30 H31
// `H28` meant three different defects; `H27`, `H29` and `H30` two each.
//
// WHY THE OBVIOUS FIXES ALL FAILED, in order, in one session:
//   1. Pre-allocate one ID per lane   -> each lane found SEVERAL defects, not one.
//   2. Pre-allocate RANGES per lane   -> lanes overran their range, and new lanes appeared.
//   3. Claim IDs at merge time        -> worked, but cost a manual renumber on every merge. Three
//                                        of them, by hand, plus a bad splice that left the file
//                                        unparseable.
//   4. This guard, checking one file  -> STRUCTURALLY BLIND to the actual failure. Within a single
//                                        branch there are never duplicates; the collision exists
//                                        only in the union of branches that cannot see each other,
//                                        and by then both are green. It also never matched the
//                                        `b`-variants at all: 44 of 52 cases were scanned, and
//                                        H4b/H5b/H34b/H35b/H36b/H39b/H41b/H44b were invisible.
//
// The root cause is not coordination. It is a GLOBAL COUNTER assigned on branches that cannot see
// each other — a design that requires coordination to be correct, in a workflow that has none.
//
// So the counter is retired. H1-H44 are FROZEN: they are referenced from `.claude/actions.md`, from
// code comments and from each other, and renaming them would break every pointer for no gain. Every
// NEW case takes a SLUG naming what it guards — `H:schema-parity`, `H:no-vacuous-gate`. Two lanes
// can mint slugs simultaneously without collision, and if they DO collide it is because they guard
// the same thing, which is information rather than an accident.
//
// The invariant: one ID one case, across every form, and no new number can be minted.
const FROZEN_MAX = 44
test('H26: every hardening case has its own ID, and the counter stays retired', () => {
  const self = readFileSync(new URL('./hardening.test.mjs', import.meta.url), 'utf8')
  // Comments stripped first: this block lists six duplicate IDs, and a scan counting those would
  // fire on the description of the bug rather than the bug.
  const ids = [...stripComments(self).matchAll(/test\('(H(?:\d+b?|:[a-z0-9-]+)):/g)].map(m => m[1])
  assert.ok(ids.length >= 52, `only ${ids.length} cases found — the scan has gone stale`)

  const seen = new Set(); const dupes = []
  for (const id of ids) { if (seen.has(id)) dupes.push(id); else seen.add(id) }
  assert.deepEqual(dupes, [], 'two cases share an ID — actions.md now points at both and resolves to neither')

  // THE MECHANISM. A new numeric ID cannot be minted, so two lanes cannot pick the same next number.
  const minted = ids.filter(id => /^H\d+b?$/.test(id) && Number(id.match(/\d+/)[0]) > FROZEN_MAX)
  assert.deepEqual(minted, [],
    `H1-H${FROZEN_MAX} are frozen. A new case takes a SLUG naming what it guards — test('H:what-it-guards: ...') ` +
    `— because a shared counter assigned on branches that cannot see each other collides by design, ` +
    `and did so three times in one session.`)

  // Gaps in the FROZEN range only: a merge that dropped a case leaves its number unused, and the
  // pointer in actions.md then resolves to nothing.
  const nums = ids.filter(id => /^H\d+$/.test(id)).map(id => Number(id.slice(1)))
  const missing = []
  for (let i = 1; i <= FROZEN_MAX; i++) if (!nums.includes(i)) missing.push(`H${i}`)
  assert.deepEqual(missing, [], 'a frozen hardening case was lost in a merge — its ID is unused')

  // Slugs must say what they guard, so the ID stays a pointer rather than becoming a new counter.
  const badSlugs = ids.filter(id => id.startsWith('H:') && id.slice(2).split('-').length < 2)
  assert.deepEqual(badSlugs, [], 'a slug that is a single word is a counter with extra steps')
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
  //
  // Scoped to `computeArtifactScore`'s OWN BODY, not the whole file. The first version searched the
  // module and would have fired on `judgedMustHaveIds` (H44), which reads `kind === 'must_have'` to
  // answer a different question — WHICH must-have rows the reviewer may be compared against — and
  // never touches a denominator. A guard that accuses correct code is one people switch off, and
  // this one is still exact: reinstating the recompute inside the function reintroduces the string
  // inside this slice and fails.
  const fnBody = functionBody(stripComments(src('artifactScore.ts')), 'computeArtifactScore')
  assert.ok(fnBody.length > 400, 'computeArtifactScore body not found — the slice has gone stale')
  assert.ok(!/kind\s*===\s*'must_have'/.test(fnBody),
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

// -----------------------------------------------------------------------------------------------
// H34 — the swap writer deleted the whole packet's provenance on every build, and swap_decision had
// no pass dimension at all. Evidence: `appSwaps.writeSwaps` ran
// `delete from swap_decision where packet_id=$1` unconditionally, and the table's unique key was
// `(packet_id, list, seq)`. A remediation loop calling it on pass 2 therefore DESTROYED pass 1's
// swap rows — the loop deleting its own justification for every change it had just made, and the
// packet screen showing only the last pass's decisions as if they were the whole story.
// The invariant, not the incident: any writer that clears provenance for a packet must scope the
// clear to the pass it is rewriting.
test('H34: provenance deletes are scoped to a pass, never to a whole packet', () => {
  const offenders = []
  for (const [file, body] of allSources()) {
    const code = stripComments(body)
    // The real construct: a DELETE from a provenance table keyed by packet alone.
    const re = /delete\s+from\s+(swap_decision|skill_candidate|insertion)\s+where\s+([^`'"]*)/gi
    let m
    while ((m = re.exec(code))) {
      const [, table, predicate] = m
      if (!/\bloop\s*=/.test(predicate)) offenders.push(`${file}: delete from ${table} where ${predicate.trim().slice(0, 60)}`)
    }
  }
  assert.deepEqual(offenders, [], 'a packet-wide provenance delete erases every earlier pass')
})

test('H34b: swap_decision and skill_candidate carry the pass in their key', () => {
  // Asserted on the CREATE TABLE block ALONE. The first version searched the whole of SCHEMA_SQL and
  // was inert three ways over: the unique also appears in the idempotent ALTER, and the two
  // `[\s\S]*?` spans ran past the end of their table into the next one that happened to have a
  // `loop int not null default 0` (the `escalation` table). All three passed with the column deleted.
  const swap = createTable(src('schema.ts'), 'swap_decision')
  const skill = createTable(src('schema.ts'), 'skill_candidate')
  assert.match(swap, /unique \(packet_id, list, seq, loop\)/,
    'without loop in the key, pass 2 overwrites pass 1 row for row')
  assert.match(swap, /\n\s*loop\s+int not null default 0/, 'swap_decision must have a loop column')
  assert.match(skill, /\n\s*loop\s+int not null default 0/,
    'skill_candidate rows are the FK targets of swap_decision; deleting them packet-wide nulls the links')
})

// ---------------------------------------------------------------------------------------------
// H35 — generation and RENDERING were the same function, so the only way to regenerate content was
// to also issue a Drive `files/{id}/copy`. Evidence: `buildTemplatedArtifact` did both. A four-pass
// remediation loop over the four templated artifacts would have created 16 Google files per packet,
// and since there is no Drive DELETE anywhere in this codebase (D-9) 15 of them would be orphaned
// on the quota-bearing OAuth account. X5 / P3-25: documents render ONCE, after the loop.
test('H35: the remediation loop body contains no Drive call — rendering is a separate step', () => {
  const loop = stripComments(src('appRemediation.ts'))
  // The pass loop is everything between the `for (let pass` header and the render call that follows
  // it. A Drive call inside that span is the 4N defect returning.
  const start = loop.indexOf('for (let pass')
  const end = loop.indexOf('renderArtifact(client, art, opp, pkg')
  assert.ok(start > 0 && end > start, 'the loop and the single render call must both be present')
  const body = loop.slice(start, end)
  for (const call of ['copyTemplate', 'injectValues', 'buildTemplatedArtifact', 'googleapis.com/drive']) {
    assert.ok(!body.includes(call), `${call} is reachable from inside the pass loop — that is 4N Drive copies`)
  }
})

test('H35b: ensurePackage generates without rendering, so a pass can run without a Drive copy', () => {
  const packets = stripComments(src('appPackets.ts'))
  const start = packets.indexOf('export async function ensurePackage')
  const end = packets.indexOf('export async function renderArtifact')
  assert.ok(start > 0 && end > start, 'the two halves must be separate exported functions')
  const gen = packets.slice(start, end)
  for (const call of ['copyTemplate', 'injectValues', 'getGoogleOAuthToken']) {
    assert.ok(!gen.includes(call), `ensurePackage still calls ${call}; generation and rendering are welded together again`)
  }
})

// ---------------------------------------------------------------------------------------------
// H36 — `insertion.loop` was DERIVED inside the writer as `max(loop) + 1`, so it counted document
// RENDERS: every build advanced it, including a build that served a cached package and made zero
// model calls. Three loop-ish counters already existed (`packet.round`, never incremented;
// `insertion.loop`; `check_result.run_id`) and P3 wanted a fourth. Decision 14: give this one the
// meaning P3 needs and let the CALLER own it — loop 0 is the baseline, 1..n are remediation passes.
// The invariant: no provenance writer may invent a pass number for itself.
test('H36: the pass number is supplied by the caller, never derived from max(loop)', () => {
  const offenders = allSources()
    .filter(([, body]) => /max\(loop\)/i.test(stripComments(body)))
    .map(([f]) => f)
  assert.deepEqual(offenders, [], 'a writer deriving its own pass number counts renders, not passes')

  const ins = stripComments(src('appInsertions.ts'))
  assert.match(ins, /const loop = Math\.max\(0, Number\(args\.loop \?\? 0\) \| 0\)/,
    'writeInsertions must take the pass from its caller')
  // ...and pass n's "before" must be pass n-1's "after", never its own.
  assert.match(ins, /loop=\$2`, \[artifactId, loop - 1\]/, 'before_text must come from the PREVIOUS pass')
})

test('H36b: every loop/pass/round counter column has a writer — no dead counter', () => {
  // The invariant, not the incident. `packet.round` was READ by loadPacket's ORDER BY and by
  // packetShape and written by NOTHING, so it was always 1: the ordering was a no-op and the API
  // reported round 1 forever. A counter nobody increments is worse than no counter, because every
  // reader believes it. Decision 14 forbids adding a fourth beside two that already disagree; this
  // asserts the general rule that any counter that EXISTS is advanced by something.
  const schema = stripComments(src('schema.ts'))
  const columns = [...new Set([...schema.matchAll(/^\s*(\w*(?:loop|pass|round)\w*)\s+int\b/gim)]
    .map(m => m[1].toLowerCase()))]
  const code = allSources().filter(([f]) => f !== 'schema.ts').map(([, b]) => stripComments(b)).join('\n')
  const unwritten = columns.filter(c => {
    if (c === 'loop') return false            // supplied by the caller on every insert (H36 above)
    if (c === 'n') return false               // remediation_loop.n, inserted per pass
    return !new RegExp(`set\\s+${c}\\s*=|\\b${c}\\s*=\\s*${c}\\s*\\+`, 'i').test(code)
  })
  assert.deepEqual(unwritten, [], 'a counter column that no code ever advances — readers will trust it anyway')
})

// ---------------------------------------------------------------------------------------------
// H37 — `converged` is the one word a user trusts without reading anything else, so it must not be
// storable by a writer that merely intends to be honest. The guard is structural: a CHECK that
// refuses the word while anything is open, and a composite FOREIGN KEY into `check_result` so the
// coverage state on the row cannot be ASSERTED — only copied from a check the engine really recorded
// for that exact run. Evidence for why this is needed: `evaluateArtifact` writes check_result rows
// keyed by run_id, and nothing else in the schema tied a summary row back to them.
test('H37: converged is unforgeable in the schema, not just in the writer', () => {
  const schema = src('schema.ts')
  assert.match(schema, /check \(halt_reason is distinct from 'converged'\s*\n?\s*or \(cardinality\(remaining\) = 0 and close_state = 'pass'\)\)/,
    'the converged CHECK is gone; the word becomes whatever the writer says')
  assert.match(schema, /foreign key \(artifact_id, run_id, close_check_key, close_state\)\s*\n?\s*references check_result \(artifact_id, run_id, check_key, state\)/,
    'without the composite FK, close_state is an assertion rather than a copy of a real check')
  // The loop must be tied to the DOCUMENT-side check. `must_have_coverage` is computed from the
  // owner's profile alone and no rewrite can move it, so binding convergence to it would make
  // convergence unreachable and every run would halt having closed nothing.
  assert.match(schema, /close_check_key text not null default 'evidence_placed' check \(close_check_key = 'evidence_placed'\)/,
    'the loop is bound to a check other than evidence_placed')
  // On check_result's OWN create block. Searching all of SCHEMA_SQL matched the idempotent ALTER
  // instead, so this assertion could not fail while that ALTER existed — inert, and inert in the
  // guard whose whole subject is a constraint that must be in two places at once.
  assert.match(createTable(schema, 'check_result'), /unique \(artifact_id, run_id, check_key, state\)/,
    'the FK needs this unique inline on check_result, for a database created from scratch')
  // P3-38: going green by turning a failure into "nothing to check" is refused by the table.
  assert.match(schema, /check \(not \(prev_close_state in \('warn','fail'\) and close_state = 'not_applicable'\)\)/,
    'a judged state sliding to not_applicable is evidence disappearing, not placement being achieved')
  // P3-11: a credited close requires an edit.
  assert.match(schema, /check \(cardinality\(closed\) = 0 or cardinality\(edited_fields\) > 0\)/,
    'a pass that rewrote nothing may credit nothing')
})

// ---------------------------------------------------------------------------------------------
// H38 — the loop must not become a second definition of "covered". `checks.covers()` decides
// `must_have_coverage`, which decides the GATE; if the loop implemented its own token-overlap rule
// to decide what a pass closed, the two would drift and the loop would start claiming closes the
// gate does not recognise. The predicate is exported from `checks.ts` and imported, once.
test('H38: the loop decides coverage with the gate\'s predicate, never its own', () => {
  const rem = stripComments(src('remediation.ts'))
  assert.match(rem, /import \{[^}]*coversText[^}]*\} from '\.\/checks'/,
    'the loop must import the gate\'s coverage predicate')
  // The real construct of a home-grown re-implementation: a local overlap ratio.
  assert.ok(!/COVERAGE_THRESHOLD\s*=/.test(rem), 'the loop redefined the coverage threshold')
  assert.ok(!/hit\.length \/ toks\.length/.test(rem), 'the loop re-implemented the overlap rule')
})

// ---------------------------------------------------------------------------------------------
// H39 — a composite FOREIGN KEY was declared against `check_result (artifact_id, run_id, check_key,
// state)` while the UNIQUE that makes that tuple a legal FK target was added with the idempotent
// alters at the FOOT of the same script. On a FRESH database that works (check_result carries the
// constraint inline). On the LIVE database, where check_result has existed since P2 WITHOUT it,
// `create table remediation_loop` aborts the whole migration with
//   ERROR: there is no unique constraint matching given keys for referenced table "check_result"
// — Postgres requires the UNIQUE at CREATE TABLE time, not by the end of the transaction.
//
// This is invisible to every test in this repo: there is no Postgres in the sandbox, so the schema
// is never executed here. It is exactly the case CLAUDE.md's H-case rule reserves for a source
// assertion — "structural rules a runtime test cannot express".
//
// The invariant, not the incident: for EVERY composite FK in SCHEMA_SQL, the constraint that makes
// its target tuple unique must appear EARLIER in the script than the table that references it.
test('H39b: a schema statement never depends on a column added later in the same script', () => {
  // The general form of H39, and the reason it is stated generally: the FK was one instance, and
  // executing SCHEMA_SQL against a real PostgreSQL 16.13 seeded with `main`'s schema turned up a
  // SECOND — `create index swap_dec_packet_idx on swap_decision(packet_id, loop, ...)` referencing
  // a `loop` column that the idempotent ALTER only added 350 lines further down. On a fresh database
  // both were fine, because the inline CREATE TABLE carries the column. On an EXISTING one — which
  // is every production database — `create table if not exists` is a no-op, the column is absent,
  // and the statement aborts the whole migration:
  //     ERROR:  column "loop" does not exist
  // The invariant, not the incident: if a column is added by an idempotent ALTER, every statement
  // that NAMES that column must come after the ALTER.
  const whole = src('schema.ts')
  const sql = whole.slice(whole.indexOf('SCHEMA_SQL = '))
  const offenders = []
  for (const m of sql.matchAll(/alter table\s+(\w+)\s+add column if not exists\s+(\w+)/g)) {
    const [, table, col] = m
    const addedAt = m.index
    // Index creations are the statements that bit us; they name columns directly and run inline.
    const idxRe = new RegExp(`create index if not exists \\w+ on ${table}\\s*\\(([^)]*)\\)`, 'g')
    for (const ix of sql.matchAll(idxRe)) {
      if (!new RegExp(`\\b${col}\\b`).test(ix[1])) continue
      if (ix.index < addedAt) {
        offenders.push(`index on ${table}(${ix[1].trim()}) at ${ix.index} names "${col}", which is only added at ${addedAt}`)
      }
    }
    // ...and so do constraint additions that reference the column.
    const conRe = new RegExp(`alter table ${table} add constraint \\w+ [^;]*?\\b${col}\\b[^;]*;`, 'g')
    for (const c of sql.matchAll(conRe)) {
      if (c.index < addedAt) offenders.push(`constraint on ${table} at ${c.index} names "${col}", only added at ${addedAt}`)
    }
  }
  assert.deepEqual(offenders, [],
    'a statement runs before the column it names exists — fine on a fresh database, fatal on every existing one')
})

test('H39: a composite FK\'s unique target is established before the table that references it', () => {
  const whole = src('schema.ts')
  const sql = whole.slice(whole.indexOf('SCHEMA_SQL = '))
  const offenders = []
  const fkRe = /foreign key \(([^)]+)\)\s*\n?\s*references (\w+) \(([^)]+)\)/g
  let m
  while ((m = fkRe.exec(sql))) {
    const [, , table, cols] = m
    const tuple = cols.split(',').map(c => c.trim())
    if (tuple.length < 2) continue                 // a single-column FK may target a primary key
    const fkAt = m.index
    const inline = `unique (${tuple.join(', ')})`

    // THE INLINE CONSTRAINT DOES NOT COUNT, and that is the whole point of this case. Every CREATE
    // here is `create table if not exists`, so on a database where the referenced table ALREADY
    // exists — production, for every table older than the current phase — the create is a no-op and
    // its inline UNIQUE is never applied. Only an idempotent `alter table ... add constraint ...
    // unique (...)` reaches an existing database, and Postgres wants the UNIQUE in place at CREATE
    // TABLE time, so that alter must run BEFORE the table carrying the FK is created.
    //
    // The first version of this guard accepted the inline constraint and was therefore INERT: it
    // passed with the defect deliberately reinstated. It is written this way because it was watched
    // to fail.
    const alterAt = (() => {
      for (let i = sql.indexOf(`alter table ${table} add constraint`); i !== -1;
           i = sql.indexOf(`alter table ${table} add constraint`, i + 1)) {
        if (sql.slice(i, i + 400).includes(inline)) return i
      }
      return -1
    })()
    if (alterAt === -1) {
      offenders.push(`FK into ${table}(${cols}): no idempotent "alter table ${table} add constraint ... ${inline}"`
        + ` anywhere — a fresh database gets the inline UNIQUE, an existing one never does`)
      continue
    }
    if (alterAt > fkAt) {
      offenders.push(`FK into ${table}(${cols}) is declared at ${fkAt} but its idempotent unique only runs at ${alterAt}`
        + ` — this aborts the whole migration on any database where ${table} already exists`)
    }
    // On the CREATE TABLE block, not on the whole script: the ALTER a few lines up contains this
    // exact substring, so `sql.includes(inline)` matched it and the line could never fail. That is
    // the same inertness this very case was rewritten to remove, reintroduced one line below it.
    assert.match(createTable(sql, table), new RegExp(inline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${table} should also carry ${inline} inline, for a database created from scratch`)
  }
  assert.deepEqual(offenders, [], 'a composite FK whose unique target is not established, for an EXISTING database, before it')
})

// ---------------------------------------------------------------------------------------------
// H40 — a TypeScript union and the schema CHECK that STORES it drifted, and the drift was invisible
// until the exact case it mattered.
//
// `HaltReason` gained `unattributed_coverage` — the guard that stops the loop claiming a convergence
// nothing this run produced — and the CHECK on `remediation_loop.halt_reason` did not. Both TS
// guards were live and correct: `decidePass` refused the claim and `appRemediation` assigned the
// reason. Then the INSERT recording that refusal violated
//     remediation_loop_halt_reason_check
// so the packet was already mutated, NO ledger row existed at all, the phantom escalation written
// for exactly this case was never reached, and the caller got a 500. The loop refused the claim in
// memory and could not record the refusal.
//
// The invariant, not the incident: any TS union persisted into a CHECK must be SET-EQUAL to it, in
// both directions. A member missing from the CHECK is an unstorable state; a member missing from the
// union is a state nothing can produce and no reader expects.
test('H40: every persisted union is set-equal to the CHECK that stores it', () => {
  const sql = src('schema.ts')
  const rem = src('remediation.ts')

  // Read the CHECK's members off the column definition, not off the whole file: `in ('a','b')`
  // appears in several constraints and matching the wrong one would compare two unrelated lists.
  const checkMembers = (table, column) => {
    const block = createTable(sql, table)
    const m = new RegExp(`\\n\\s*${column}\\s+text[^\\n]*?check \\(${column} in \\(([^)]*)\\)\\)`).exec(block)
    assert.ok(m, `no CHECK found for ${table}.${column} — the scan has gone stale`)
    return new Set(m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')))
  }
  // ...and the union's members off its exported literal array, which is the list the code uses.
  const unionMembers = (name) => {
    const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(stripComments(rem))
    assert.ok(m, `no ${name} array found`)
    return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]))
  }

  const inCheck = checkMembers('remediation_loop', 'halt_reason')
  const inUnion = unionMembers('HALT_REASONS')
  const missingFromCheck = [...inUnion].filter(x => !inCheck.has(x)).sort()
  const missingFromUnion = [...inCheck].filter(x => !inUnion.has(x)).sort()

  assert.deepEqual(missingFromCheck, [],
    'a halt reason the code can emit but the table refuses to store — the insert throws at exactly the moment the reason fires')
  assert.deepEqual(missingFromUnion, [],
    'a halt reason the table allows that no code produces — a state no reader expects and nothing can create')
  // Guard against the scan silently matching nothing on both sides at once.
  assert.ok(inUnion.size >= 11, `only ${inUnion.size} halt reasons found — the scan has gone stale`)
})

// ---------------------------------------------------------------------------------------------
// H39c — H39b walks columns that HAVE an idempotent ALTER and checks nothing runs before it. A
// column with NO ALTER AT ALL falls outside that loop entirely, and that is the case that shipped.
//
// The retarget renamed three columns and added a fourth INSIDE `create table if not exists`, with no
// ALTER. Proven by execution on a seeded cluster: seed main -> apply the pre-retarget revision ->
// apply the retarget. The migration EXITS 0 AND REPORTS CLEAN, and the table still carries
// must_have_check_key with the FK bound to it. The first INSERT the loop makes then dies with
//     ERROR: column "close_state" does not exist
// Every guard passed. Only running it found this.
//
// The invariant: a column the code WRITES must be reachable on an EXISTING database, not merely
// present in the CREATE. Scoped to the tables this lane created and has already shipped a revision
// of — a blanket rule over every table in the file would fire on columns that have only ever had
// one shape, which is the cry-wolf failure this file exists to avoid.
test('H39c: every column this lane CHANGED is reachable on an existing database', () => {
  const sql = src('schema.ts')
  const app = stripComments(src('appRemediation.ts'))

  // SCOPED TO THE COLUMNS THAT CHANGED, and deliberately not to every column in the table. A rule
  // over all columns fires on ones that have only ever had a single shape — the cry-wolf failure
  // this file exists to prevent; the first version of this case did exactly that, naming eleven
  // healthy columns. The general form ("does this column exist on a database built from an earlier
  // revision") cannot be answered from one source snapshot at all. It is answered by EXECUTION
  // instead: see CLAUDE.md — seed main's schema, apply the previous revision, apply this one. That
  // is how F2 was found, and no source guard would have found it.
  const CHANGED = [
    'close_check_key', 'close_state', 'prev_close_state',   // renamed from must_have_*
    'coverage_state', 'profile_evidence', 'superseded_doc_url',
    'cleared_override_by', 'cleared_override_at', 'cleared_override_reason',
  ]
  const offenders = []
  for (const col of CHANGED) {
    const reachable = new RegExp(`alter table remediation_loop\\s+add column if not exists\\s+${col}\\b`).test(sql)
      || new RegExp(`rename column \\w+ to ${col}\\b`).test(sql)
    if (!reachable) offenders.push(`remediation_loop.${col}`)
    // ...and it must be in the CREATE too, or a fresh database lacks it.
    assert.match(createTable(sql, 'remediation_loop'), new RegExp(`\\n\\s*${col}\\s`),
      `${col} is reachable by ALTER but absent from the CREATE — a fresh database would not have it`)
  }
  assert.deepEqual(offenders, [],
    'a column this lane renamed or added exists only in the CREATE — on a database where the table '
    + 'already exists, "create table if not exists" skips it and every INSERT naming it fails')

  // A staleness anchor: close_state IS written on every ledger insert, so if it ever stops being
  // named there this list has drifted from the code. close_check_key is deliberately NOT checked —
  // it carries a DEFAULT and the writer never names it, which is correct.
  assert.ok(app.includes('close_state'), 'close_state is not written by appRemediation — the CHANGED list is stale')
})

// ---------------------------------------------------------------------------------------------
// H39d — the same class for a CONSTRAINT rather than a column, and it is how F1's fix was inert.
//
// Adding 'unattributed_coverage' to the halt_reason CHECK in the CREATE fixes a FRESH database only.
// On one that already ran an earlier revision the create is skipped, the 10-member CHECK survives,
// and the insert still throws — while H40 passes, because H40 reads the SOURCE, not the database.
// A constraint whose membership can change needs an idempotent replacement exactly as a column does.
test('H39d: EVERY named CHECK on remediation_loop has an idempotent replacement', () => {
  // Not "the one that bit us" — all of them. Three separate constraints on this table kept a stale
  // expression on an upgraded database, and the third was found only by executing the migration:
  //   halt_reason   kept 10 members, so the loop could not persist its own refusal
  //   close_check_key  stayed bound to must_have_coverage
  //   check4        stayed `prev = 'fail'`, blind to 'warn' — which is how evidence_placed reports
  //                 failure, so the evidence-removal guard was off on exactly the databases it protects
  // A CHECK inside `create table if not exists` is skipped wholesale on a database that already has
  // the table, so its ORIGINAL expression is the one that runs, forever. Naming every constraint is
  // what makes a replacement possible; asserting every named one is replaced removes the class.
  const sql = src('schema.ts')
  const create = createTable(sql, 'remediation_loop')
  const named = [...create.matchAll(/constraint (remediation_loop_\w+)\s*\n?\s*check/g)].map(m => m[1])
  assert.ok(named.length >= 5, `only ${named.length} named CHECKs found on remediation_loop — the scan has gone stale`)

  const missing = named.filter(c => {
    const dropped = sql.includes(`alter table remediation_loop drop constraint if exists ${c};`)
    const readded = new RegExp(`alter table remediation_loop add constraint ${c}\\s*\\n?\\s*check`).test(sql)
    return !(dropped && readded)
  })
  assert.deepEqual(missing, [],
    'a CHECK exists only in the CREATE — a database that already has the table keeps its original expression forever')

  // The COLUMN-LEVEL checks are a second form and were the two that actually bit: `halt_reason text
  // check (...)` and `close_check_key text ... check (...)`. They get auto-names too, so they need
  // the same replacement, and matching only the `constraint <name> check` form would have missed
  // both of them — which is how the first version of this case passed while halt_reason was stale.
  for (const col of ['halt_reason', 'close_check_key']) {
    assert.match(create, new RegExp(`\\n\\s*${col}\\s+text[^\\n]*check \\(${col} `),
      `${col} has no inline CHECK in the CREATE — a fresh database would not constrain it`)
    assert.ok(sql.includes(`alter table remediation_loop drop constraint if exists remediation_loop_${col}_check;`)
      && new RegExp(`alter table remediation_loop add constraint remediation_loop_${col}_check\\s*\\n?\\s*check`).test(sql),
      `${col}'s column-level CHECK has no idempotent replacement — an upgraded database keeps the original members forever`)
  }

  // ...and no ANONYMOUS table-level check may be added back, because an auto-named one cannot be
  // dropped by a stable name and so cannot be replaced at all.
  const anon = [...create.matchAll(/\n\s{2}check \(/g)]
  assert.equal(anon.length, 0,
    'an anonymous CHECK on remediation_loop — it gets an auto-name like remediation_loop_check4 and becomes unreplaceable')
})

// ---------------------------------------------------------------------------------------------
// H41 — A first-match scan over an ORDERED catalogue made one of its entries unreachable, and the
// unreachable entry was the more specific one. FIXED; this case now guards the fix.
//
// Measured against the built module, not inferred. `checkAgainstFacts` (ownerFacts.ts) used to walk
// `FACT_CATALOGUE` in order and return on the FIRST def whose `asks` matched. Entry 0 is
// `experience.years_total` (`/\d+\+?\s*(years|yrs)/`); entry 1 is `experience.years_leadership`
// (the same, PLUS a leadership word) — a strict subset. So:
//
//   checkAgainstFacts('Requires 10+ years of engineering leadership experience', facts)
//     -> { fact_key: 'experience.years_total', ... }        every time, for every input
//
// and no counterexample could exist by construction. Two consequences, both live until this fix:
//   * a posting asking for 10 years of LEADERSHIP was answered by TOTAL years of experience, so
//     22 total years "satisfied" it for someone who had led for three;
//   * an owner who recorded their leadership years and not their total years got
//     "no value recorded" — the fact they DID record was invisible.
//
// Selection is now by DECLARED refinement (`FactDef.refines`), read by `selectFactDef`, so it does
// not depend on catalogue position at all. The invariant asserted here is the general one, not the
// incident: **a def whose matcher is a strict subset of another def's must DECLARE that it refines
// it, and the narrower def must be the one selected.** An undeclared subset is a shadow — the def
// can never be chosen for any text, whatever the order happens to be today.
//
// Measured over a corpus rather than named pairs, so a THIRTEENTH catalogue entry whose matcher is
// accidentally narrower than an existing one fails here on the day it is added. The corpus also
// contains a line that matches two defs for unrelated reasons ("Bachelor's degree required; PMP
// certification preferred" matches both education entries): neither is a subset of the other, both
// stay selectable, and the guard must NOT fire on it. A guard that accuses correct code is one
// people learn to ignore.
const H41_CORPUS = [
  'Requires 10+ years of engineering leadership experience',
  '15 years managing engineering teams',
  '20+ years in leadership roles',
  'Minimum of 10 years of professional experience',
  '8 yrs of relevant industry experience required',
  "Bachelor's degree in Computer Science or equivalent",
  'MBA or advanced degree preferred',
  'PMP certification required',
  'AWS Certified Solutions Architect strongly preferred',
  "Bachelor's degree required; PMP certification preferred",
  'Must be a U.S. Citizen or Green Card Holder',
  'No visa sponsorship is available for this position',
  'Active Secret security clearance required',
  'TS/SCI with polygraph',
  'Must reside in the East Coast of the United States',
  'Candidate must be based in Austin, Texas',
  'Willing to relocate to Denver',
  'Hybrid, 3 days a week onsite in Chicago',
  'Fully remote position',
  'Willing to travel up to 25%',
  'Able to travel domestically',
  'Has led a team of 40 engineers',
  'Manages 12 direct reports',
  'Owned a budget of $18M',
  'P&L responsibility for the division',
]

test('H41: no catalogue entry is hidden behind a more general one', async () => {
  const { FACT_CATALOGUE, selectFactDef } = await import('../dist/functions/tests/ownerFacts.js')
  assert.ok(FACT_CATALOGUE.length >= 12, `only ${FACT_CATALOGUE.length} fact defs — the scan has gone stale`)

  const matches = new Map(FACT_CATALOGUE.map(d => [d.key, new Set(H41_CORPUS.filter(t => d.asks.test(t)))]))
  assert.ok([...matches.values()].every(m => m.size > 0),
    'a catalogue entry matches nothing in the corpus, so this case cannot see it — extend H41_CORPUS')

  // --- the structural half: every strict-subset relation must be DECLARED ----------------------
  const undeclared = []
  for (const a of FACT_CATALOGUE) {
    for (const b of FACT_CATALOGUE) {
      if (a === b) continue
      const A = matches.get(a.key), B = matches.get(b.key)
      if (A.size >= B.size) continue
      if (![...A].every(t => B.has(t))) continue          // not a subset — two unrelated questions
      if (a.refines === b.key) continue                   // declared, and honoured below
      undeclared.push(`${a.key} is a strict subset of ${b.key} and does not declare refines`)
    }
  }
  assert.deepEqual(undeclared, [],
    'an undeclared subset relation: the narrower def can never be selected for any text')

  // --- the behavioural half: the narrower def is the one SELECTED ------------------------------
  // Not "is it declared" — what the function DOES. Deleting `refines` or restoring the first-match
  // scan makes every one of these come back as the general entry.
  const wrong = []
  for (const t of H41_CORPUS) {
    const matching = FACT_CATALOGUE.filter(d => d.asks.test(t))
    if (matching.length < 2) continue
    const selected = selectFactDef(t)
    // The selected def must not be one that another matching def declares it refines.
    const generalised = new Set(matching.map(d => d.refines).filter(k => k && matching.some(m => m.key === k)))
    if (generalised.has(selected.key)) wrong.push(`${JSON.stringify(t)} selected the general ${selected.key}`)
  }
  assert.deepEqual(wrong, [], 'a general def answered a requirement its own refinement also matched')

  // --- the incident, in both directions it actually broke --------------------------------------
  const probe = 'Requires 10+ years of engineering leadership experience'
  assert.equal(selectFactDef(probe).key, 'experience.years_leadership',
    'the leadership requirement is answered by the leadership fact, not by total years')
  assert.equal(selectFactDef('Minimum of 10 years of professional experience').key, 'experience.years_total',
    'a plain years requirement still resolves to total years — the fix must not invert the pair')
})

test('H41b: the leadership fact settles a leadership requirement, and total years cannot stand in', async () => {
  const { checkAgainstFacts } = await import('../dist/functions/tests/ownerFacts.js')
  const probe = 'Requires 10+ years of engineering leadership experience'
  const fact = (key, n) => ({ key, value: String(n), value_num: n, source: 'owner_stated', confirmed_at: 'x' })

  // Direction 1 — the recorded leadership fact was invisible; it now answers, with its own number.
  const onlyLeadership = checkAgainstFacts(probe, [fact('experience.years_leadership', 14)])
  assert.equal(onlyLeadership.fact_key, 'experience.years_leadership')
  assert.equal(onlyLeadership.verdict, 'satisfied')
  assert.match(onlyLeadership.detail, /14 years recorded, 10 required/)

  // Direction 2 — the costly one. 22 total years must NOT satisfy a 10-year LEADERSHIP requirement
  // for someone who has led for three. Before the fix this returned satisfied on years_total.
  const bothRecorded = checkAgainstFacts(probe, [
    fact('experience.years_total', 22), fact('experience.years_leadership', 3),
  ])
  assert.equal(bothRecorded.fact_key, 'experience.years_leadership')
  assert.equal(bothRecorded.verdict, 'not_satisfied',
    '22 total years answered a leadership requirement for someone who has led for three')
  assert.match(bothRecorded.detail, /3 years recorded, 10 required/)

  // Direction 3 — total years alone no longer settles it either way; it is a fact the owner has not
  // recorded, which is `unknown`, which is what PROPOSES the fact. Absent evidence, not a pass.
  const onlyTotal = checkAgainstFacts(probe, [fact('experience.years_total', 22)])
  assert.equal(onlyTotal.fact_key, 'experience.years_leadership')
  assert.equal(onlyTotal.verdict, 'unknown')
})

// ---------------------------------------------------------------------------------------------
// H42 — A stored setting that production READS and nothing WRITES is a constant wearing a
// settings-shaped costume.
//
// Measured at c360e6e: `owner_search_prefs.chk_skill_max_chars … chk_evidence_min_tokens` are added
// by `ensureCheckPrefs` and read by `loadThresholds` (appChecks.ts), and the only route that writes
// that table (`appSearchPrefs.ts`) sets `target_geo_ids`, `remote_only` and three `temp_*` columns —
// none of the `chk_*` ones. `grep -rn "chk_" app/src` returns nothing. So every threshold the
// checks engine calls "overridable per owner" is changeable only by hand-written SQL, which is the
// no-hardcoded-config rule satisfied on paper and not in the product.
//
// The invariant: a per-owner settings column that production reads must have a writer somewhere in
// the API. Asserted by READING THE COLUMN NAMES OUT OF THE ENSURE STATEMENT rather than listing
// them here, so adding a tenth column cannot escape the guard by not being in a hardcoded list —
// the way H11's hand-maintained table array can.
test('H42: every per-owner settings column production reads has a writer that can set it', () => {
  const apiDir = new URL('../src/functions/tests/', import.meta.url)
  const read = (f) => readFileSync(new URL(f, apiDir), 'utf8')
  const sources = ['appChecks.ts', 'appSearchPrefs.ts', 'appDimensions.ts', 'jdSweep.ts', 'appFacts.ts']
    .map(f => { try { return [f, read(f)] } catch { return null } })
    .filter(Boolean)

  // Columns any module ADDS to owner_search_prefs.
  const declared = new Set()
  for (const [, body] of sources) {
    for (const m in [] ) void m
    for (const m of stripComments(body).matchAll(/add column if not exists\s+([a-z0-9_]+)/g)) declared.add(m[1])
  }
  assert.ok(declared.size >= 5, `only ${declared.size} settings columns found — the scan has gone stale`)

  // Columns any module WRITES.
  //
  // Read the SQL, do not pattern-match the JavaScript around it. The first version of this scan
  // looked for `col=$1` and missed every clause built dynamically — `sets.push(\`temp_hot_hours=$${
  // vals.length}\`)` in appSearchPrefs, `backoff_until=now() + …` in jdSweep — and so accused six
  // settings that DO have writers. A guard that names innocent offenders is one people switch off.
  // So: take the SQL text (every backtick string in these files), and collect `col =` assignments
  // from it.
  const written = new Set()
  for (const [, body] of sources) {
    const b = stripComments(body)
    for (const lit of b.match(/`[^`]*`/g) || []) {
      for (const m of lit.matchAll(/\b([a-z][a-z0-9_]*)\s*=\s*(?!=)/g)) written.add(m[1])
    }
  }

  const unwritable = [...declared].filter(c => !written.has(c)).sort()
  // The KNOWN set, pinned. Same reasoning as H41: asserting "none" would be red on arrival for a
  // pre-existing gap this lane did not create, and a guard that is red on arrival gets switched
  // off. Pinning it fails on a NEW unwritable setting AND on the known ones being fixed.
  const KNOWN = [
    'chk_cover_words_max', 'chk_cover_words_min', 'chk_evidence_min_tokens', 'chk_evidence_threshold',
    'chk_expertise_words', 'chk_relevant_allowance', 'chk_relevant_max_chars', 'chk_skill_max_chars',
    'chk_skills_total_max', 'chk_skills_total_min',
  ]
  assert.deepEqual(unwritable, KNOWN,
    `the set of unwritable per-owner settings changed: ${JSON.stringify(unwritable)} — a new setting shipped with no way for the owner to change it, or the known ones were fixed and this case must be updated`)

  // P8.4's own setting is NOT in that set, and its writer is exercised by dimensionsDb.test.mjs.
  assert.ok(written.has('cmp_dimensions'), 'the dimension set shipped with no writer — the exact shape this case exists to stop')
})


// ---------------------------------------------------------------------------------------------
// H43 — H41's defect where it did damage: the GATE.
//
// H41 guards the SELECTION (`selectFactDef` picks the narrower def). This case guards the
// consequence, because the selection only mattered because `checks.ts` routes `facts_settled`,
// `fact_shortfall` and `facts_needed` through `checkAgainstFacts`, and those rows move the badge.
//
// Evidence, the shape D22 recorded: a posting asking for "10+ years of engineering leadership"
// against an owner with 22 total years and three years of leadership. Before the fix the scan
// returned `experience.years_total`, the arithmetic was 22 >= 10, and the run reported
// `facts_settled: pass` — a confident, correctly formatted, TRUE statement about the wrong fact.
// `checks.test.mjs` encoded that as an expectation, which is how it survived: the fixture asked for
// LEADERSHIP years and recorded only TOTAL years, and asserted a pass.
//
// The invariant: a fact verdict that reaches the gate is about the fact the posting actually asked
// for. A years-of-leadership requirement is never settled by a total-years figure.
test('H43: a fact verdict that reaches the gate is about the fact the posting asked for', () => {
  const LEADERSHIP = 'Requires 10+ years of engineering leadership experience'
  const reqs = [{ seq: 0, verbatim: LEADERSHIP, item_text: '', kind: 'must_have' }]
  const fact = (key, n) => ({ key, value: String(n), value_num: n, source: 'owner_stated', confirmed_at: 'x' })
  const run = (facts) => runChecks({
    type: 'resume',
    pkg: { ResumeSummary: 'Owns roadmap strategy and execution with deep experience.' },
    requirements: reqs, facts, evidence: { profileReadable: true, bySeq: {} },
  })
  const find = (rs, k) => rs.find(r => r.check_key === k)

  // 1. Total years alone must not settle it. It is a fact the owner has not recorded — surfaced for
  //    them to answer, which is what proposes the row, not laundered into a pass.
  const totalOnly = run([fact('experience.years_total', 22)])
  assert.equal(find(totalOnly, 'facts_settled').state, 'not_applicable',
    '22 total years settled a LEADERSHIP requirement — the gate read the wrong fact')
  assert.match(find(totalOnly, 'facts_needed').offenders[0], /Years in leadership/,
    'the unanswered fact must be named as the leadership one, not as total years')

  // 2. Recorded and short: a WARN naming the LEADERSHIP arithmetic. Before the fix this was a pass.
  const ledThree = run([fact('experience.years_total', 22), fact('experience.years_leadership', 3)])
  assert.equal(find(ledThree, 'facts_settled').state, 'not_applicable')
  const shortfall = find(ledThree, 'fact_shortfall')
  assert.equal(shortfall.state, 'warn', 'three years of leadership satisfied a ten-year requirement')
  assert.match(shortfall.offenders[0], /3 years recorded, 10 required/,
    'the arithmetic on screen must be the leadership figure, not the total-years one')

  // 3. Recorded and sufficient: it settles, off its own number.
  const ledTwelve = run([fact('experience.years_total', 22), fact('experience.years_leadership', 12)])
  assert.equal(find(ledTwelve, 'facts_settled').state, 'pass')
  assert.equal(find(ledTwelve, 'fact_shortfall'), undefined)

  // 4. And the pair is not inverted: a plain years requirement is still total years.
  const plain = runChecks({
    type: 'resume',
    pkg: { ResumeSummary: 'Owns roadmap strategy and execution with deep experience.' },
    requirements: [{ seq: 0, verbatim: 'Minimum of 10 years of professional experience', item_text: '', kind: 'must_have' }],
    facts: [fact('experience.years_total', 22)], evidence: { profileReadable: true, bySeq: {} },
  })
  assert.equal(find(plain, 'facts_settled').state, 'pass')
})

// ---------------------------------------------------------------------------------------------
// H44 — Reviewer agreement was measured against requirements the engine never judged.
//
// `appReviewer` compares the reviewer's per-requirement judgements with the deterministic engine's
// and stores `agreed` / `disagreed` / `reviewer_stricter` / `reviewer_looser`. It built the
// comparable set as every row of `kind === 'must_have'`:
//
//   const engineJudged = scoreRow?.must_have_coverage == null ? []
//     : requirements.filter(r => r.kind === 'must_have').map(r => String(r.id))
//
// but `checks.ts` judges `coverable` — must-haves MINUS the eligibility clauses `template_reach`
// reports as unreachable, MINUS the rows the owner's facts own. On the shape the live Trinnex
// posting has (4 must-haves, 3 eligibility, 1 judged) that is 4 rows compared against an engine that
// had an opinion about 1. The three the engine never judged are not in `uncovered_requirement_ids`,
// so `engineCovered` computed `true` for them, and a reviewer saying "covered" was recorded as
// AGREEING with a verdict that was never reached. Reviewer agreement is an accusation-grade number.
//
// The invariant, and it has two halves that must both hold:
//   * a requirement the engine did not judge is `not_comparable`, never agreed and never disagreed;
//   * the comparable set is READ from what the check published, never re-derived. `coverable` is
//     checks.ts's predicate and a second implementation of it is the R4 defect this codebase keeps
//     being bitten by — one source per number.
test('H44: reviewer agreement counts only requirements the engine actually judged', () => {
  // r0 an eligibility clause, r1 owned by the owner's facts — checks.ts excludes both from
  // `coverable`. r2 judged and covered, r3 judged and uncovered: "1/2 must-have requirements
  // evidenced" is exactly what the check publishes for that population.
  const requirements = [
    { id: 'r0', seq: 0, kind: 'must_have' },
    { id: 'r1', seq: 1, kind: 'must_have' },
    { id: 'r2', seq: 2, kind: 'must_have' },
    { id: 'r3', seq: 3, kind: 'must_have' },
  ]
  const scoreRow = {
    must_have_coverage: 50,
    must_have_source: mustHaveSource(1, 2),
    uncovered_requirement_ids: ['r3'],
  }

  const judged = judgedMustHaveIds(requirements, scoreRow)
  assert.ok(!judged.includes('r0') && !judged.includes('r1'),
    'rows the engine excluded from coverage were offered to the reviewer comparison as judged')

  // The behavioural half, through the function that produces the stored numbers. The reviewer
  // claims all three are covered; the engine judged only r3, and said it was not.
  const judgements = [
    { requirement_id: 'r0', covered: true },
    { requirement_id: 'r1', covered: true },
    { requirement_id: 'r3', covered: false },
  ]
  const a = agreementFor(judgements, [3], requirements, judged)
  assert.equal(a.not_comparable, 2,
    'a requirement the engine never judged was counted as agreement with the reviewer')
  assert.equal(a.agreed, 1, 'the one genuinely comparable row must still be compared')
  assert.equal(a.disagreed, 0)

  // When the check DID judge every must-have, the whole set is comparable — the fix must not throw
  // the measurement away to be safe.
  const all = judgedMustHaveIds(requirements, {
    must_have_coverage: 75, must_have_source: mustHaveSource(3, 4), uncovered_requirement_ids: ['r3'],
  })
  assert.deepEqual([...all].sort(), ['r0', 'r1', 'r2', 'r3'])

  // No coverage verdict at all means nothing was judged — absent evidence, not a pass.
  assert.deepEqual(judgedMustHaveIds(requirements, { must_have_coverage: null, must_have_source: null }), [])
  assert.deepEqual(judgedMustHaveIds(requirements, null), [])

  // A recorded judged set, when the writer stores one, wins over every inference above.
  assert.deepEqual(judgedMustHaveIds(requirements, { ...scoreRow, judged_requirement_ids: ['r2', 'r3'] }), ['r2', 'r3'])
})

test('H44b: the must_have_source denominator survives the round trip it is read back through', () => {
  // H44's conservative branch turns on parsing `<covered>/<judged>` out of a string the scorer
  // wrote. Writer and reader live in one file for that reason, and this is what stops them drifting:
  // change the wording of `mustHaveSource` without changing `parseMustHaveSource` and the reviewer
  // silently falls back to the uncovered rows for every artifact, with no error anywhere.
  assert.deepEqual(parseMustHaveSource(mustHaveSource(3, 7)), { covered: 3, judged: 7 })
  assert.equal(parseMustHaveSource('the posting produced no must-haves'), null,
    'an unreadable source must be null, never a defaulted denominator')

  // And the string the scorer ACTUALLY stores is one the reader can read — asserted through
  // computeArtifactScore rather than through the helper, so a caller that stops using the helper is
  // caught too.
  const checks = [{
    check_key: 'must_have_coverage', engine: 'deterministic', state: 'fail',
    observed: '1/2 must-haves evidenced (2 not reachable by any generated field, not counted either way)',
    expected: '', offenders: ['#3 something — no evidence'],
  }]
  const score = computeArtifactScore({ requirements: [], checks })
  assert.deepEqual(parseMustHaveSource(score.must_have_coverage.source), { covered: 1, judged: 2 },
    'the scorer stored a must_have_source the reviewer cannot read back')
})

// ---------------------------------------------------------------------------------------------
// H:corrections-before-store — a correction pass placed beside the check that motivates it produces a document the user
// reads and a record that disagrees with it.
//
// The natural home for R1 is `appChecks.ts`, next to `posting_figure_echo`. Put it there and
// everything looks right: the check goes green, the change log renders, every test written
// alongside passes. What breaks is invisible from that vantage — `packet.pkg_json` and
// `insertion.after_text` were both written BEFORE the correction, so they describe text nobody
// will ever see. Downstream it compounds: `remediation.realEdits()` decides whether a pass edited
// anything by comparing `after_text` to `before_text`, and `creditClosures()` joins `after_text`
// to decide which requirements a pass may credit — so the loop credits closures against text that
// never shipped.
//
// The invariant, not the incident: the correction pass must run before the package is persisted,
// in the ONE function every build funnels through, so that the stored package, the provenance
// writers and every check all read the same corrected text.
test('H:corrections-before-store: corrections are applied before the package is stored, not beside the check', () => {
  // The CALL, not the import. The first version of this guard searched for the bare identifier and
  // found the `import` line at the top of the file — which precedes everything, so the ordering
  // assertion was trivially true and the guard passed with the pass moved after the store. Caught
  // by reverting it; an inert guard is worse than none.
  // Named 'code', not 'src': a local 'src' shadows the module-level helper of the same name and
  // throws "Cannot access 'src' before initialization" at the call inside its own initialiser.
  const code = stripComments(src('appPackets.ts')).replace(/^\s*import[^\n]*\n/gm, '')
  const iPass = code.search(/await\s+applyCorrectionPass\s*\(/)
  assert.ok(iPass > 0, 'the correction pass is not CALLED from the package builder at all')

  // It must precede the pkg_json write, the swap writer and the insertion writer.
  for (const after of ['update packet set pkg_json', 'writeSwaps(', 'writeInsertions(']) {
    const iAfter = code.indexOf(after)
    assert.ok(iAfter > 0, `${after} not found — this guard has gone stale`)
    assert.ok(iPass < iAfter,
      `applyCorrectionPass runs AFTER ${after}, so what is stored is not what the user reads`)
  }

  // And it must NOT be called from the checks layer, which runs after the package is already
  // persisted — that placement is the defect this case exists to prevent.
  assert.ok(!/applyCorrectionPass/.test(stripComments(src('appChecks.ts'))),
    'the correction pass moved into appChecks, where it can only correct text already stored')
})

// H:correction-layer-pure — the pure layer stays pure, because that is what makes every offset and revert path
// testable without a database. A correction whose rules can only be exercised through pg is a
// correction whose revert path is exercised by nobody.
test('H:correction-layer-pure: the correction judgement layer takes no database or HTTP dependency', () => {
  const pure = stripComments(src('correction.ts'))
  for (const banned of ['pgClient', '@azure/functions', 'logUsage', 'fetch(']) {
    assert.ok(!pure.includes(banned), `correction.ts references ${banned} — it is no longer pure`)
  }
})

// ---------------------------------------------------------------------------------------------
// D3 — the substitute figure. THE ANSWER IS THAT THERE IS NO RESOLVER, AND THESE GUARD THAT.
//
// The backlog asks for an echoed figure to be replaced with the candidate's own ("60+" -> "62")
// where one exists. `scanEcho` structurally cannot supply it: the profile side is indexed by the
// EXACT figure (`profileByKey`), so it answers "does the profile also say 60?" and a hit there is
// the KEEP branch (`shared_with_profile`) -- the opposite of a substitute. Answering "what is the
// candidate's corresponding number?" is a different question, keyed on the UNIT, and no such index
// exists for the profile.
//
// `docs/qc-evidence/P8.1-ACCEPTANCE.md` §4 records the accepted resolution: GENERALIZATION ONLY.
// Substitution may be written only as the AC-10 resolver -- exactly one profile figure sharing the
// stemmed, exact unit, with `profile_source_key` and offsets recorded, and the substring at those
// offsets equal to the substituted figure. Zero or two-or-more matches fall through to generalize.
//
// Anything that RANKS is forbidden outright. A guessed number in a resume is worse than a false
// accusation: the candidate has to defend it in an interview. These cases are dormant-but-armed --
// they cost nothing today and fail the moment someone implements the tempting version.

test('H:no-figure-ranking: nothing in the figure path may rank a candidate substitute', () => {
  // "Fuzzy matching is for RANKING, never for ACCUSING" already governs this codebase. A figure
  // SUBSTITUTION is stricter still: it does not merely accuse, it writes a number into the resume,
  // which the candidate then has to defend in an interview. Nearest-magnitude, most-recent and
  // best-fuzzy-unit are all forbidden.
  //
  // THIS GUARD WAS INERT WHEN FIRST WRITTEN, and was caught by reinstating the defect it names.
  // It banned the word `nearest` as /\bnearest\b/, which does not match `nearestProfileFigure` --
  // the trailing \b fails against a camelCase capital, exactly the way the percent regex's trailing
  // \b never matched "40% growth". A word list is the wrong instrument. These rules match the
  // CONSTRUCT instead, and are measured against the files as they stand: `Math.abs` appears zero
  // times in all three, and every `.sort(` in them orders by a document OFFSET.
  for (const f of ['figureEcho.ts', 'correction.ts', 'appCorrections.ts']) {
    const code = stripComments(src(f))

    // 1. Absolute difference has no honest use in an EXACT-match figure path. Its only purpose
    //    here would be "how far is this profile figure from the posting's?", which is ranking.
    assert.ok(!/Math\.abs\s*\(/.test(code), `${f} uses Math.abs — the figure path matches exactly, it never measures distance`)

    // 2. Sorting may order by POSITION and nothing else. This is the rule that actually catches a
    //    resolver: ranking candidates means sorting them by value.
    for (const m of code.matchAll(/\.sort\(\s*\([^)]*\)\s*=>\s*([^)]*)\)/g)) {
      assert.match(m[1].trim(), /^[ab]\.(figure\.)?(start|char_start|applied_seq)\s*-\s*[ab]\.(figure\.)?(start|char_start|applied_seq)$/,
        `${f} sorts by "${m[1].trim()}" — the figure path may order by document offset only`)
    }

    // 3. Names, matched WITHOUT a trailing boundary so camelCase cannot hide them.
    for (const banned of [/nearest/i, /closest/i, /best.?match/i, /most.?recent/i, /\bsimilarity\s*\(/, /levenshtein/i, /\brank(ed|ing|By)?\b/i]) {
      assert.ok(!banned.test(code), `${f} names a ranking construct (${banned})`)
    }
  }
})

test('H:generalize-closed-range: a generalisation may never be a new number', () => {
  // The whole risk of D3 in one assertion. `generalize` is the ONLY function that produces
  // replacement text, so if a substitute figure is ever invented it must appear here. Its range is
  // a closed vocabulary: an order-of-magnitude phrase, the word "multiple", or null (escalate).
  // "62" -- or any bare quantity -- can never be a legal output.
  const corpus = ['$18M portfolio', '$400k budget', '60+ reports', 'three units', '40% growth',
                  '18M users', '400k users', '2.5B valuation', 'USD 18M portfolio', '1,200 staff',
                  'sixty engineers', 'one hundred engineers', '$5,000 stipend', '18 million users']
  let produced = 0
  for (const t of corpus) {
    for (const f of extractFigures(t)) {
      const g = generalize(f)
      if (g === null) continue
      produced++
      assert.ok(/^\d+-figure$/.test(g) || g === 'multiple',
        `generalize invented "${g}" from "${t}" — the range is N-figure | multiple | null`)
    }
  }
  assert.ok(produced >= 8, `the corpus must actually exercise generalize (produced ${produced})`)
})

test('H:profile-figure-provenance: source=profile_figure is unforgeable', () => {
  // AC-10. Today nothing writes it -- `planCorrections` always records 'generalized', which is the
  // accepted resolution. This guard is the tripwire on the version someone writes later: the
  // moment `source: 'profile_figure'` appears, the same file must also carry the provenance that
  // makes the claim checkable, or the assertion fails.
  for (const f of ['correction.ts', 'appCorrections.ts']) {
    const code = stripComments(src(f))
    const writes = /source\s*[:=]\s*'profile_figure'/.test(code)
    if (!writes) continue
    for (const need of ['profile_source_key', 'profile_char_start', 'profile_char_end']) {
      assert.ok(code.includes(need),
        `${f} writes source='profile_figure' without ${need} — an unprovenanced substitute is a fabricated number`)
    }
  }
  // And the shipped behaviour, so this case is not purely structural: every planned correction
  // today is a generalisation, and none of them is a bare number.
  const gen = 'Managed a $18M portfolio across three business units.'
  const rows = planCorrections('ResumeSummary', gen, scanEcho(gen, 'Own a $18M portfolio across three business units.', 'Profile: ran platform engineering.').echoes)
  assert.ok(rows.length > 0, 'the fixture must actually produce corrections')
  for (const r of rows) {
    assert.equal(r.source, 'generalized', 'generalization is the only path P8.1 ships')
    assert.ok(!/^\d[\d,]*(\.\d+)?\+?$/.test(r.replacement), `replacement "${r.replacement}" is a bare number`)
  }
})

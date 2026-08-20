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
import { runChecks, gateFor, COVERAGE_THRESHOLD, MIN_JUDGEABLE_TOKENS } from '../dist/functions/tests/checks.js'
import { computeArtifactScore } from '../dist/functions/tests/artifactScore.js'

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
      if (/\{\s*owner/.test(line)) continue                       // destructured
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

// A staleness guard for `docs/qc-evidence/PROTOTYPE-COVERAGE.md`.
//
// WHY THIS EXISTS. `.claude/DEFERRED.md` has had a staleness guard for weeks. It fired twice on
// 2026-08-27 and was right both times: a row claiming something was unbuilt went stale the moment
// the code landed, and the suite said so in the same commit.
//
// This document had none, and it was found UNDERSTATING three separate times in one day:
//   - 4.6-9 was ranked as "blocked on reading the owner's live skill fields". It was fully built -
//     `useSkillBank` -> `api.skillBankGet()` -> `keywordSwapOptions` -> a real <select>. The rank was
//     never revisited after the skill-bank work shipped.
//   - 4.1-6 was ABSENT. Reading the PROTOTYPE SOURCE showed its colour IS the n/d ratio's verdict, so
//     it inherits 4.1-5, which this app refuses on the record. It was already decided, not missing.
//   - Nine more rows on 2026-08-27, all from work shipped the same day: the count moved 151 -> 158
//     BUILT with zero new code.
//
// The cost is not cosmetic. A row that says "not built" is an instruction to build it, so a stale
// ABSENT is an invitation to rebuild something that already works - which is hours, every time.
//
// SCOPE, chosen deliberately rather than "check everything". Only ABSENT rows carry a machine check.
// ABSENT is the heaviest claim in the document (CLAUDE.md: "blocked / absent / not built is the
// heaviest claim you can make") and the only one whose rotting actively causes work. PARTIAL and
// BUILT rot toward under-claiming, which is cheap; demanding a pattern for all 221 rows would be
// ceremony that gets deleted the first time it cries wolf.
//
// It lives in app/test rather than beside the ledger guard in api/test because every path an ABSENT
// row names is under `app/src`, and this suite is the one that runs when those files change.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOC = join(REPO, 'docs', 'qc-evidence', 'PROTOTYPE-COVERAGE.md')

const VERDICTS = ['NOT-IN-PROTOTYPE', 'NOT IN PROTOTYPE', 'OUT-OF-SCOPE', 'OUT OF SCOPE',
  'DELIBERATE', 'PARTIAL', 'ABSENT', 'BUILT']

/** Every `| <section>-<n> |` row, with the verdict cell resolved. */
function parse(lines = readFileSync(DOC, 'utf8').split('\n')) {
  const rows = []
  lines.forEach((line, i) => {
    const m = /^\|\s*(\d+\.\d+)-(\d+)\s*\|/.exec(line)
    if (!m) return
    let verdict = null
    for (const cell of line.split('|')) {
      const c = cell.replace(/[*_]/g, '').trim().toUpperCase()
      const hit = VERDICTS.find((v) => c.startsWith(v))
      if (hit) { verdict = hit.replace(/ /g, '-'); break }
    }
    rows.push({ n: i + 1, id: `${m[1]}-${m[2]}`, section: m[1], verdict, line })
  })
  return rows
}

/** `check: absent <path> <pattern>` — the same grammar the ledger guard uses. */
function checkOf(row) {
  const m = /`check:\s*absent\s+(\S+)\s+(.+?)`/.exec(row.line)
  return m ? { path: m[1], pattern: m[2] } : null
}

test('H:coverage-every-row-parses: a verdict this guard cannot read is a verdict it cannot check', () => {
  // The first mechanical recount returned NOTHING for 34 rows, because verdicts carry annotations
  // (`**BUILT - CHANGED from ABSENT**`, `BUILT (relocated)`, `NOT-IN-PROTOTYPE`) and the parser only
  // matched bare words. It reported 129 BUILT against a real 151. A coverage number gets quoted for
  // weeks, so a parser that silently drops rows is worse than no count at all.
  const bad = parse().filter((r) => !r.verdict)
  assert.deepEqual(bad.map((r) => `L${r.n} ${r.id}`), [],
    `rows whose verdict cell does not parse; add the verdict word or extend VERDICTS: ${bad.map((r) => r.id).join(', ')}`)
})

test('H:coverage-absent-rows-carry-a-check: the heaviest claim must be falsifiable', () => {
  // An ABSENT row with no machine check is a claim nobody can test, sitting in a document people
  // plan from. Every other verdict is exempt on purpose - see the scope note at the top.
  const missing = parse().filter((r) => r.verdict === 'ABSENT' && !checkOf(r))
  assert.deepEqual(missing.map((r) => `L${r.n} ${r.id}`), [],
    'ABSENT rows without `check: absent <path> <pattern>`: ' + missing.map((r) => r.id).join(', '))
})

test('H:coverage-absent-check-is-real: a pattern that cannot fail is not a check', () => {
  // Both halves were stolen from the ledger guard, which learned them the hard way: an empty pattern
  // compiles to /(?:)/ and matches every file, and a path that no longer exists makes the check
  // vacuously true. Either one is a green light that means nothing.
  const out = []
  for (const r of parse().filter((x) => x.verdict === 'ABSENT')) {
    const c = checkOf(r)
    if (!c) continue
    if (c.pattern.trim().length < 3) out.push(`L${r.n} ${r.id}: pattern ${JSON.stringify(c.pattern)} is too short to mean anything`)
    const p = join(REPO, c.path)
    if (!existsSync(p) || !statSync(p).isFile()) out.push(`L${r.n} ${r.id}: names ${c.path}, which is not a file in this repo`)
    try { new RegExp(c.pattern) } catch (e) { out.push(`L${r.n} ${r.id}: /${c.pattern}/ does not compile - ${e.message}`) }
  }
  assert.deepEqual(out, [], out.join(' | '))
})

test('H:coverage-stale-absent-fails: the thing was built, re-verdict the row', () => {
  // THE ONE THAT EARNS THE FILE. If an ABSENT row's pattern now MATCHES, the feature exists and the
  // document is telling its next reader to build it again. Measured three times on 2026-08-27; each
  // was found by hand, and only because someone happened to look.
  const out = []
  for (const r of parse().filter((x) => x.verdict === 'ABSENT')) {
    const c = checkOf(r)
    if (!c) continue
    const p = join(REPO, c.path)
    if (!existsSync(p)) continue          // reported by the check above; not double-counted here
    let hit
    try { hit = new RegExp(c.pattern, 'm').test(readFileSync(p, 'utf8')) } catch { continue }
    if (hit) out.push(`L${r.n} ${r.id}: /${c.pattern}/ NOW MATCHES ${c.path} - it was built, re-verdict the row`)
  }
  assert.deepEqual(out, [], out.join(' | '))
})

test('H:coverage-absent-is-rare-enough-to-mean-something', () => {
  // A floor with a reason, not a round number. The point of the machine-checked set is that it is
  // small enough to stay true; if ABSENT ever swells back to dozens, the rows will have been added
  // faster than anyone checked them and this file's guarantee quietly stops being worth anything.
  // 12 is roughly double today's 3 - loose enough never to fire on ordinary work.
  const absent = parse().filter((r) => r.verdict === 'ABSENT')
  assert.ok(absent.length <= 12,
    `${absent.length} ABSENT rows. Either the backlog grew a lot, or rows are being marked absent without being checked.`)
})


// ── A STATED TALLY MUST EQUAL ITS OWN ROWS ───────────────────────────────────────────────────────
//
// WHY, MEASURED 2026-09-02. All ELEVEN per-section tally lines had drifted from their rows, every
// one UNDER-claiming. `§4.10` read `BUILT 2 · PARTIAL 2 · ABSENT 4` against eight rows that all say
// BUILT; `§4.11` read `BUILT 0 · ABSENT 6` against rows saying BUILT 5 · ABSENT 1. The headline in
// §13-CURRENT stayed correct the whole time because a person recomputed it every pass. The section
// lines had no such discipline: a DERIVED VALUE WITH NO DERIVER AND NO CONSUMER THAT VALIDATES IT.
//
// ON THIS FILE'S OWN SCOPE NOTE (above): it argues ABSENT-only, because demanding a hand-written
// `check:` pattern for 221 rows is ceremony, and because row-level under-claiming is cheap. Both
// still hold. Neither applies here — this check demands NO annotation from anyone, it computes; and
// "under-claiming is cheap" is true of a ROW (granular, read by one person) and measurably false of
// a TALLY (quoted, aggregated into the headline, 100% incidence).
//
// THREE DESIGN CHOICES ARE THE INDEPENDENT AC PASS'S, NOT MINE, and each corrects a real defect in
// the version I withdrew (docs/qc-evidence/AC-tally-drift-guard.md):
//   1. It REUSES `parse()`. My version read "the 4th cell", but rows carry 3, 5, 6 and 7 cells —
//      §4.12 is a 3-cell table with the verdict in cell 2 — so it resolved NOTHING for those rows
//      and only looked right via an accidental `cells.length < 4` skip. A second parser, in the one
//      file whose header records a second parser reporting "129 BUILT against a real 151".
//   2. Rows are attributed BY ID PREFIX, never by markdown section: `:487`'s single heading covers
//      §4.11 AND §4.12, 14 rows against a correct `§4.11 tally — 9 rows`.
//   3. The scan unit is the TALLY LINE, not the section. `:346` is an orphan fragment
//      `ABSENT **2** · DELIBERATE **7**.` sitting inside §4.5, whose rows hold 0 ABSENT and 6
//      DELIBERATE. A section-scoped scanner fires TWICE on a correct document, on day one. It is
//      deliberately left in place as a permanent negative control.
const TALLY_RE = /^\*\*§(4\.\d+) tally — (\d+) rows?:\*\*/
const EXPECTED_TALLIES = ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9', '4.10', '4.11']
// §4.12 has five rows and no tally, legitimately: all five are OUT-OF-SCOPE, which §0 excludes from
// the denominator. Named, with its reason, so a NEW section cannot appear with no summary in silence.
const TALLY_EXEMPT = ['4.12']

function tallies(lines) {
  const out = []
  lines.forEach((line, i) => {
    const m = TALLY_RE.exec(line)
    if (!m) return
    const stated = {}
    for (const [, v, n] of line.matchAll(
      /\b(BUILT|PARTIAL|ABSENT|DELIBERATE|NOT-IN-PROTOTYPE|OUT-OF-SCOPE)\*{0,2} \*\*(\d+)\*\*/g)) {
      stated[v] = Number(n)
    }
    out.push({ n: i + 1, section: m[1], statedRows: Number(m[2]), stated })
  })
  return out
}

/** Rows grouped by the id prefix they declare — never by where they sit in the file. */
function countsBySection(rows) {
  const by = {}
  for (const r of rows) {
    const c = (by[r.section] ||= {})
    if (r.verdict) c[r.verdict] = (c[r.verdict] || 0) + 1
  }
  return by
}

// The assertions, as named functions over (lines, rows) so the not-vacuous test below can run the
// SAME code CI runs against a mutated copy. A fixture exercising a simplified copy proves nothing.
const T = {
  // AC-1 / AC-10: every number the line states equals the recount. `?? 0` is load-bearing — a
  // stated category the rows do not have must FAIL, and `if (!counted[v]) continue` would pass it.
  'tally-matches-rows': (lines, rows) => {
    const by = countsBySection(rows)
    return tallies(lines).flatMap((t) => Object.entries(t.stated)
      .filter(([v, stated]) => ((by[t.section] || {})[v] ?? 0) !== stated)
      .map(([v, stated]) => `§${t.section} (line ${t.n}) says ${v} ${stated}, rows say ${(by[t.section] || {})[v] ?? 0}`))
  },
  // AC-8 + AC-9: the stated N must be the real row count, and the numbers must ACCOUNT for all of
  // them. Together these close the omission hole -- dropping a non-zero category from a line leaves
  // sum(stated) < N, which is the §4.10/§4.11 under-claim shape.
  'tally-accounts-for-every-row': (lines, rows) => {
    const by = countsBySection(rows)
    const problems = []
    for (const t of tallies(lines)) {
      const real = Object.values(by[t.section] || {}).reduce((a, b) => a + b, 0)
      if (real !== t.statedRows) problems.push(`§${t.section} (line ${t.n}) says ${t.statedRows} rows, counted ${real}`)
      const sum = Object.values(t.stated).reduce((a, b) => a + b, 0)
      if (sum !== t.statedRows) problems.push(`§${t.section} (line ${t.n}) numbers sum to ${sum} but it claims ${t.statedRows} rows - a category is missing from the line`)
    }
    return problems
  },
  // AC-5 + AC-6, and the most important assertion here: every other one is VACUOUS the moment a
  // line stops matching. Without this the failure mode is not "the guard misfires", it is "the
  // guard silently stops existing" - the original defect one level up.
  'every-tally-is-read': (lines, rows) => {
    const seen = tallies(lines).map((t) => t.section).sort()
    const problems = []
    const missing = EXPECTED_TALLIES.filter((s) => !seen.includes(s))
    const extra = seen.filter((s) => !EXPECTED_TALLIES.includes(s))
    if (missing.length) problems.push(`tally line(s) no longer parse for: ${missing.join(', ')}`)
    if (extra.length) problems.push(`unexpected tally section(s): ${extra.join(', ')}`)
    for (const s of [...new Set(rows.map((r) => r.section))]) {
      if (!EXPECTED_TALLIES.includes(s) && !TALLY_EXEMPT.includes(s)) {
        problems.push(`§${s} has rows but no tally line and is not in TALLY_EXEMPT`)
      }
    }
    return problems
  },
  // AC-4: a row whose verdict does not resolve is counted nowhere, so it would silently shrink the
  // recount and make a stale line look correct.
  'tally-rows-resolve-a-verdict': (lines, rows) =>
    rows.filter((r) => !r.verdict).map((r) => `row ${r.id} (line ${r.n}) resolved no verdict`),
}

for (const [name, fn] of Object.entries(T)) {
  test(`H:coverage-${name}`, () => {
    const lines = readFileSync(DOC, 'utf8').split('\n')
    assert.deepEqual(fn(lines, parse(lines)), [])
  })
}

test('H:coverage-tally-guard-not-vacuous: every assertion above fires on its own reinstated defect', () => {
  const LINES = readFileSync(DOC, 'utf8').split('\n')
  // Anchor + change assertions are the point: an anchor that stopped matching would report the
  // guard INERT when nothing was actually tested. That exact false-INERT happened on this lane today.
  const swap = (find, replace) => {
    const i = LINES.findIndex((l) => l.startsWith(find))
    assert.notEqual(i, -1, `fixture anchor "${find}" not found - the fixture has gone stale`)
    const out = [...LINES]
    out[i] = replace(out[i])
    assert.notEqual(out[i], LINES[i], `fixture for "${find}" applied no change - it would report the guard inert`)
    return out
  }
  const fixtures = [
    // The real §4.10 defect, put back verbatim.
    ['tally-matches-rows', swap('**§4.10 tally', (l) =>
      l.replace('BUILT **8**.', 'BUILT **2** · PARTIAL **2** · ABSENT **4**.'))],
    // The omission variant: drop a non-zero category, leaving the numbers short of the stated N.
    ['tally-accounts-for-every-row', swap('**§4.1 tally', (l) =>
      l.replace(' · DELIBERATE **10**', ''))],
    // A line that stops parsing must not silently disable the guard.
    ['every-tally-is-read', swap('**§4.7 tally', (l) => l.replace('**§4.7 tally', '**S4.7 tally'))],
    // A row whose verdict cannot be resolved.
    ['tally-rows-resolve-a-verdict', swap('| 4.10-1 |', (l) =>
      l.replace(/\bBUILT\b/, 'looks fine'))],
  ]
  const proven = []
  for (const [name, lines] of fixtures) {
    const problems = T[name](lines, parse(lines))
    assert.ok(problems.length > 0, `${name} did NOT fire on its own reinstated defect - the guard is inert`)
    proven.push(`${name}: ${problems[0].slice(0, 76)}`)
  }
  assert.equal(proven.length, Object.keys(T).length,
    `every assertion in T must have a fixture; proven ${proven.length} of ${Object.keys(T).length}`)
})

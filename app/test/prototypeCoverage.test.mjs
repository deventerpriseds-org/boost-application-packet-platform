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
function parse() {
  const lines = readFileSync(DOC, 'utf8').split('\n')
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


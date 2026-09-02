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

// ── ACT-70: the headline must equal the rows ─────────────────────────────────────────────────────
//
// WHY THIS EXISTS, measured rather than imagined. `13-CURRENT` holds ONE hand-maintained headline
// beside ~216 verdict rows that several lanes move independently. On 2026-09-02 it collided THREE
// times in one afternoon: the `cover` lane reached 167/182, the QC + Review-and-send lane 166/183,
// the `jd` lane earlier still. Every lane was correct against its own tree, every conflict landed
// on this one block, and the merged recount (169/182) was HIGHER than any lane reported, because
// row moves are additive. The same defect had already happened twice in its non-concurrent form:
// the SS4.8 and SS4.10 tallies each contradicted the table printed directly above them.
//
// SCOPE IS DELIBERATELY NARROW -- `13-CURRENT` only. `13a`/`13b`/`13c`/`13d` are FROZEN historical
// figures by the doc's own caption, and `13-RENDER` uses a different (section-subset) formula.
// Guarding those would flag correct content, which is the cry-wolf failure this repo forbids and
// the reason its smart-quote linter was deleted the night it was written.
//
// It reuses `parse()` above and MUST NOT reimplement it. The doc's own prose calls its method
// "4th cell, earliest token", which is an IMPRECISE description of `parse()`: measured across the
// live file the two agree on 216 of 221 rows and disagree only on the five 3-column `4.12-*` rows,
// where a literal 4th-cell reader returns null. Those are OUT-OF-SCOPE and excluded either way, so
// the count is unaffected -- but the prose is not a spec, and a second parser here would be the
// parallel system that H:coverage-every-row-parses already exists to punish.
const EXCLUDED = new Set(['NOT-IN-PROTOTYPE', 'OUT-OF-SCOPE', 'DELIBERATE'])

/** The 13-CURRENT slice ONLY: from its heading to the next `### `. */
function currentBlock() {
  const lines = readFileSync(DOC, 'utf8').split('\n')
  const start = lines.findIndex((l) => /^### 13-CURRENT\./.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^### /.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

function recount() {
  const rows = parse()
  const tally = {}
  for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1
  const denominator = rows.filter((r) => !EXCLUDED.has(r.verdict)).length
  return { BUILT: tally.BUILT || 0, PARTIAL: tally.PARTIAL || 0, ABSENT: tally.ABSENT || 0, denominator }
}

test('H:headline-block-is-findable: a guard that cannot find its target must fail, never pass', () => {
  // AC3. The anchor is a heading an unrelated edit can rename. A guard that silently returns when it
  // cannot find its subject is the "absent evidence is not a pass" rule broken in code.
  assert.ok(currentBlock(), 'could not locate the `### 13-CURRENT.` block in PROTOTYPE-COVERAGE.md '
    + '- it was renamed or deleted; this guard cannot verify a headline it cannot find')
})

test('H:headline-matches-the-rows: the stated parity figure must equal a recount of the rows', () => {
  // AC1. The whole point: nobody may hand-maintain this number beside rows that move underneath it.
  const block = currentBlock()
  const head = /#\s+\*\*(\d+)\s+of\s+(\d+)\s+prototype elements present/.exec(block)
  assert.ok(head, 'the 13-CURRENT block no longer states `N of D prototype elements present`')
  const cell = (label) => {
    const m = new RegExp(`\\|\\s*\\*?\\*?${label}\\*?\\*?\\s*\\|\\s*\\*?\\*?(\\d+)\\*?\\*?\\s*\\|`).exec(block)
    assert.ok(m, `the 13-CURRENT breakdown table no longer states a count for ${label}`)
    return Number(m[1])
  }
  const stated = { BUILT: Number(head[1]), denominator: Number(head[2]),
    PARTIAL: cell('PARTIAL'), ABSENT: cell('ABSENT') }
  assert.equal(cell('BUILT'), stated.BUILT,
    'the headline sentence and the breakdown table disagree with EACH OTHER about BUILT')
  const got = recount()
  const delta = (k) => `${k}: stated ${stated[k]}, rows say ${got[k]} (${got[k] - stated[k] >= 0 ? '+' : ''}${got[k] - stated[k]})`
  assert.deepEqual(
    { BUILT: stated.BUILT, PARTIAL: stated.PARTIAL, ABSENT: stated.ABSENT, denominator: stated.denominator },
    { BUILT: got.BUILT, PARTIAL: got.PARTIAL, ABSENT: got.ABSENT, denominator: got.denominator },
    'the 13-CURRENT headline no longer matches the rows. RECOUNT, do not hand-edit one side:\n  '
    + ['BUILT', 'PARTIAL', 'ABSENT', 'denominator'].map(delta).join('\n  ')
    + '\n  (denominator = rows minus NOT-IN-PROTOTYPE, OUT-OF-SCOPE and DELIBERATE)')
})

test('H:headline-percentages-follow-its-own-counts', () => {
  // AC2. A correct count beside a percentage computed from an older one is still a wrong number.
  const block = currentBlock()
  const den = Number(/#\s+\*\*\d+\s+of\s+(\d+)\s+prototype/.exec(block)[1])
  for (const label of ['BUILT', 'PARTIAL', 'ABSENT']) {
    const m = new RegExp(`\\|\\s*\\*?\\*?${label}\\*?\\*?\\s*\\|\\s*\\*?\\*?(\\d+)\\*?\\*?\\s*\\|\\s*\\*?\\*?([\\d.]+)%`).exec(block)
    assert.ok(m, `no percentage stated for ${label}`)
    assert.equal(m[2], (Number(m[1]) / den * 100).toFixed(1),
      `${label}: ${m[1]}/${den} is ${(Number(m[1]) / den * 100).toFixed(1)}%, but the table says ${m[2]}%`)
  }
})

test('H:headline-guard-window-excludes-the-frozen-blocks', () => {
  // AC4. Proves the slice boundary is LOAD-BEARING rather than incidentally correct. 13a's frozen
  // `148 of 183` and 13-RENDER's `83 of 84` are both correct where they sit; a guard that widened
  // its window to swallow them would fail on content nobody should change.
  const block = currentBlock()
  assert.ok(!block.includes('148 of 183'),
    "the 13-CURRENT window has widened to include 13a's FROZEN historical figure")
  assert.ok(!block.includes('83 of 84'),
    "the 13-CURRENT window has widened to include 13-RENDER, which uses a different formula")
})

test('H:headline-guard-has-exactly-one-parser', () => {
  // AC5. The failure this forbids is not hypothetical: an earlier ad-hoc recount reported 129 BUILT
  // against a real 151 because it used its own parser, and H:coverage-every-row-parses exists
  // because of it. Two parsers in one file WILL diverge, and the one that disagrees with the tests
  // is the one people quote. Matched on the declaration form only, so a helper named `parseFoo`
  // cannot trip it.
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const defs = src.match(/^function parse\s*\(/gm) || []
  assert.equal(defs.length, 1,
    `this file must define exactly ONE row parser and every guard must reuse it; found ${defs.length}`)
})

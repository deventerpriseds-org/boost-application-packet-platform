// DEFERRED LEDGER — the ledger that catches stale claims had gone stale three times.
//
// WHY THIS FILE EXISTS. `.claude/DEFERRED.md` exists because "a claim about state that nothing
// re-checks" is how work that was never done reads as done. The ledger itself became that claim.
// Measured on `main` at d3c6bf5, before this guard:
//   - status was PROSE ONLY: "CLOSED." x7, "DONE." x4, "FIXED" x2, plus "DONE, proven live.",
//     "DONE for four lanes", "CLOSED AS 'GENERALIZATION ONLY'", "NOT DONE". Nothing could tell
//     open from closed, and 26 rows were strikethrough-shaped while only 22 carried the closed tail.
//   - four ids meant two different defects each: D20 (ed19230 vs a54be89), D21 and D22
//     (e77b612/7b97f02 vs a54be89), D26 (e1ac1f0 vs the a9f23a3 merge, which duplicated the row
//     and its `## Contrast` heading verbatim and orphaned D35 under a headerless table).
//   - five rows read "DONE ... NOT verified live" and were taken as finished.
// The remedy is the one that retired the H-case counter: stop asking people to remember, and make
// the malformed or stale version fail the suite.
//
// TWO THINGS THIS GUARD LEARNED FROM THE FIRST DRAFT, both caught before landing:
//   1. The first migration re-keyed by COMMIT DATE and picked the wrong side of D21/D22. Ground
//      truth is the citations: appDimensions.ts:14, schema.ts:854, dimensionsDb.test.mjs and
//      hardening.test.mjs:277 all mean the P8.4 schema row by `D21`; ownerFacts.ts:31,238,
//      dimensions.ts:311, checks.test.mjs:250, hardening.test.mjs:1874,2282 all mean
//      `years_leadership` by `D22`. `D:ledger-citation-resolves` now makes that class impossible.
//   2. A naive citation scan flagged `D97706` — the amber hex in `app/src/theme.css`. Bounding the
//      id to two digits and refusing a hex-ish left neighbour removes it. That is the cry-wolf
//      failure this repo has already deleted a linter for; the bound is not decoration.
//
// Naming follows `H26`: slugs, never numbers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

const REPO = new URL('../../', import.meta.url).pathname
const LEDGER = join(REPO, '.claude/DEFERRED.md')

const STATUSES = new Set(['OPEN', 'CLOSED', 'WONTDO'])
const VEHICLES = new Set(['db-query.yml', 'api-test.yml', 'ui-verify.yml', 'owner', 'lane'])
const FROZEN_MAX = 37          // D1-D37 are cited from source and keep their numbers. As H26 does.
const ROW_STRICT = /^\|\s*(D\d+[a-z]?|D:[a-z0-9-]+)\s*\|(.*)\|\s*$/
const ROW_LOOSE = /^\|\s*D[\d:][^|]*\|/      // anything that even LOOKS like a row, for the census
const HEADER = '| # | Status | Not done | What makes it look done | Trigger / check |'
const ROW_FLOOR = 35           // 41 rows at the time of writing; a scan that finds far fewer is broken

// ---------------------------------------------------------------------------------------------
// Parsing and the assertions, as pure functions over (lines). Every case below runs the SAME
// function the real ledger runs, against a fixture with one defect reinstated — see
// `D:ledger-guard-not-vacuous`. A guard proven only by passing on the real file is not proven
// (hardening.test.mjs:2093 records one that was inert and shipped).
// ---------------------------------------------------------------------------------------------
export function parse (lines) {
  const rows = []
  let section = null
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) section = lines[i].slice(3).trim()
    const m = ROW_STRICT.exec(lines[i])
    if (!m) continue
    rows.push({ n: i + 1, section, id: m[1], cells: m[2].split(/(?<!\\)\|/).map(c => c.trim()) })
  }
  return rows
}
const claimOf = r => r.cells[1]
const triggerOf = r => r.cells[3]

export function checkOf (row) {
  const m = /`check:\s*(grep|absent|manual)\s+([^\s`]+)\s*(?:—\s*)?([^`]*)`/.exec(triggerOf(row) || '')
  return m ? { kind: m[1], arg: m[2], rest: m[3].trim().replace(/\\\|/g, '|') } : null
}

const A = {}   // assertion name -> (lines, rows) => string[] of problems

A['rows-parse'] = (lines, rows) => {
  const out = []
  const loose = lines.filter(l => ROW_LOOSE.test(l) && l !== HEADER).length
  if (rows.length < ROW_FLOOR) out.push(`only ${rows.length} rows parsed (floor ${ROW_FLOOR}) — the scan has gone stale`)
  if (rows.length !== loose) out.push(`parser saw ${rows.length} rows but ${loose} lines look like rows — a row is being skipped silently`)
  for (const r of rows) if (r.cells.length !== 4) out.push(`L${r.n} ${r.id}: ${r.cells.length + 1} columns, expected 5`)
  return out
}

A['one-id-one-row'] = (lines, rows) => {
  const seen = new Map()
  for (const r of rows) seen.set(r.id, [...(seen.get(r.id) || []), r.n])
  return [...seen].filter(([, ns]) => ns.length > 1).map(([id, ns]) => `${id} names two rows: L${ns.join(', L')}`)
}

A['status-is-a-token'] = (lines, rows) =>
  rows.filter(r => !STATUSES.has(r.cells[0])).map(r => `L${r.n} ${r.id}: status ${JSON.stringify(r.cells[0]).slice(0, 50)}`)

A['counter-retired'] = (lines, rows) => rows.map(r => r.id).filter(id => {
  const m = /^D(\d+)[a-z]?$/.exec(id)
  return m && Number(m[1]) > FROZEN_MAX
}).map(id => `${id} is a new number; D1-D${FROZEN_MAX} are frozen and a new row takes a slug`)

A['slug-has-two-words'] = (lines, rows) =>
  rows.map(r => r.id).filter(id => id.startsWith('D:') && id.slice(2).split('-').filter(Boolean).length < 2)
    .map(id => `${id} is a one-word slug — a number with letters`)

A['open-not-terminal-prose'] = (lines, rows) =>
  // Anchored at the head of the claim, after an optional strikethrough. Deliberately NOT a scan for
  // the words anywhere in the cell: several rows legitimately quote their own history mid-cell, and
  // a scan that fired on those is the cry-wolf failure. Only the row's OPENING claim is judged.
  rows.filter(r => r.cells[0] === 'OPEN' && /^(?:~~[^~]*~~\s*)?\*\*(?:DONE|CLOSED|FIXED)\b/.test(claimOf(r)))
    .map(r => `L${r.n} ${r.id} is OPEN but opens with a terminal claim`)

A['closed-carries-evidence'] = (lines, rows) =>
  // A floor, not a proof: it fails "CLOSED, done." and nothing else. A stronger regex over free
  // prose would be fuzzy matching used to ACCUSE, which this repo bans; the real evidence rule is
  // `stale-row-fails` below, which executes rather than reads.
  rows.filter(r => r.cells[0] === 'CLOSED' && !claimOf(r).includes('`'))
    .map(r => `L${r.n} ${r.id}: closed with nothing concrete named`)

A['open-carries-check'] = (lines, rows) =>
  rows.filter(r => r.cells[0] === 'OPEN')
    .map(r => ({ r, hits: (triggerOf(r).match(/`check:/g) || []).length }))
    .filter(x => x.hits !== 1)
    .map(x => `L${x.r.n} ${x.r.id}: ${x.hits} check directives, expected exactly 1`)

A['manual-names-its-vehicle'] = (lines, rows) => {
  const out = []
  for (const r of rows.filter(x => x.cells[0] === 'OPEN')) {
    const c = checkOf(r)
    if (!c) { out.push(`L${r.n} ${r.id}: check directive does not parse`); continue }
    if (c.kind === 'manual' && !VEHICLES.has(c.arg)) out.push(`L${r.n} ${r.id}: vehicle ${JSON.stringify(c.arg)} is not one of ${[...VEHICLES].join(', ')}`)
  }
  return out
}

A['check-names-a-construct'] = (lines, rows) =>
  // D20 cited `appFacts.ts:232`; the construct now lives at :239 and the claim never changed. A
  // check pinned to a line number is a guaranteed future false positive.
  rows.map(r => ({ r, c: checkOf(r) })).filter(x => x.c && x.c.kind !== 'manual' && /:\d+\b/.test(x.c.rest + ' ' + x.c.arg))
    .map(x => `L${x.r.n} ${x.r.id}: check names a line coordinate, which rots while the defect stands`)

A['check-pattern-is-real'] = (lines, rows) =>
  rows.map(r => ({ r, c: checkOf(r) })).filter(x => x.c && x.c.kind !== 'manual' && x.c.rest.length < 3)
    .map(x => `L${x.r.n} ${x.r.id}: pattern ${JSON.stringify(x.c.rest)} is empty or too short — ` +
      'an empty pattern compiles to /(?:)/, matches every file, and is counted as machine-checked')

A['stale-row-fails'] = (lines, rows) => {
  const out = []
  for (const r of rows) {
    const c = checkOf(r)
    if (!c || c.kind === 'manual') continue
    const path = join(REPO, c.arg)
    if (!existsSync(path) || !statSync(path).isFile()) { out.push(`L${r.n} ${r.id}: check names ${c.arg}, not a file in this repo`); continue }
    let hit
    try { hit = new RegExp(c.rest, 'm').test(readFileSync(path, 'utf8')) }
    catch (e) { out.push(`L${r.n} ${r.id}: pattern /${c.rest}/ does not compile — ${e.message}`); continue }
    const closed = r.cells[0] === 'CLOSED'
    if (c.kind === 'grep' && !hit) out.push(closed
      ? `L${r.n} ${r.id}: /${c.rest}/ no longer in ${c.arg} — the fix REGRESSED, reopen the row`
      : `L${r.n} ${r.id}: /${c.rest}/ no longer matches ${c.arg} — the defect is gone, close the row`)
    if (c.kind === 'absent' && hit) out.push(closed
      ? `L${r.n} ${r.id}: /${c.rest}/ is back in ${c.arg} — the defect REGRESSED, reopen the row`
      : `L${r.n} ${r.id}: /${c.rest}/ now matches ${c.arg} — the thing was built, close the row`)
  }
  return out
}

A['no-duplicate-section'] = (lines) => {
  const heads = lines.filter(l => l.startsWith('## ')).map(l => l.trim())
  return [...new Set(heads.filter((h, i) => heads.indexOf(h) !== i))].map(h => `${h} appears twice — the a9f23a3 merge signature`)
}

A['table-header'] = (lines, rows) => rows.map(r => {
  let i = r.n - 2
  while (i >= 0 && lines[i].startsWith('|')) i--
  return lines[i + 1] === HEADER ? null : `L${r.n} ${r.id} sits under ${JSON.stringify(lines[i + 1])}`
}).filter(Boolean)

// ---------------------------------------------------------------------------------------------
const LINES = (() => {
  assert.ok(existsSync(LEDGER), '.claude/DEFERRED.md is missing — the ledger cannot be absent and green')
  return readFileSync(LEDGER, 'utf8').split('\n')
})()
const ROWS = parse(LINES)
const run = name => assert.deepEqual(A[name](LINES, ROWS), [], name)

test('D:ledger-rows-parse: every row is five columns and none is skipped', () => run('rows-parse'))
test('D:ledger-one-id-one-row: no id names two defects', () => run('one-id-one-row'))
test('D:ledger-status-is-a-token: status is never inferred from prose', () => run('status-is-a-token'))
test('D:ledger-counter-retired: a new numeric id fails, as H26 fails one', () => run('counter-retired'))
test('D:ledger-slug-has-two-words: a slug says what it defers', () => run('slug-has-two-words'))
test('D:ledger-open-not-terminal-prose: an open row does not open by claiming it is done', () => run('open-not-terminal-prose'))
test('D:ledger-closed-carries-evidence: a closed row names something concrete', () => run('closed-carries-evidence'))
test('D:ledger-open-carries-check: every open row carries exactly one check', () => run('open-carries-check'))
test('D:ledger-manual-names-its-vehicle: a row nothing here can settle says what would', () => run('manual-names-its-vehicle'))
test('D:ledger-check-names-a-construct: a check is never pinned to a line number', () => run('check-names-a-construct'))
test('D:ledger-check-pattern-is-real: an empty pattern matches every file and is not a check', () => run('check-pattern-is-real'))
test('D:ledger-no-duplicate-section: a bad merge splice fails', () => run('no-duplicate-section'))
test('D:ledger-table-header: every table holding rows declares the five columns', () => run('table-header'))

test('D:ledger-stale-row-fails: a row whose claim no longer holds fails, in both directions', () => {
  const kind = r => (checkOf(r) || {}).kind
  const machine = ROWS.filter(r => kind(r) === 'grep' || kind(r) === 'absent')
  const manual = ROWS.filter(r => kind(r) === 'manual')
  const none = ROWS.filter(r => !kind(r))
  assert.ok(machine.length >= 8, `only ${machine.length} rows are machine-checked — a ledger of manual rows checks nothing`)
  // Every row lands in exactly one bucket. The first census printed machine and manual and omitted
  // the rest, so 16 closed-by-prose rows read as covered by a green run.
  assert.equal(machine.length + manual.length + none.length, ROWS.length, 'the census does not account for every row')
  console.log(`[D:ledger] ${ROWS.length} rows: ${machine.length} machine-checked, ` +
    `${manual.length} NOT CHECKED HERE (not_applicable, not pass) — ${manual.map(r => r.id).join(', ')}; ` +
    `${none.length} closed with NO check, re-checked by nothing — ${none.map(r => r.id).join(', ')}`)
  run('stale-row-fails')
})

test('D:ledger-citation-resolves: every D-id cited from source resolves to exactly one row', () => {
  // The bound to two digits and the refusal of a hex-ish left neighbour are what keep `#D97706`
  // (app/src/theme.css) out. Without them this fires on a colour.
  const CITE = /(?<![#0-9a-fA-F])\bD(\d{1,2}[a-z]?)\b/g
  const ids = new Set(ROWS.map(r => r.id))
  const files = []
  const walk = (p) => {
    if (p.includes('worktrees')) return
    const st = statSync(p)
    if (st.isFile()) { if (['.ts', '.mjs', '.js', '.jsx', '.md', '.sh'].includes(extname(p))) files.push(p); return }
    for (const e of readdirSync(p)) walk(join(p, e))
  }
  for (const r of ['api/src', 'api/test', 'app/src', 'scripts', '.claude/actions.md', '.claude/DEFERRED.md']) {
    const p = join(REPO, r)
    if (existsSync(p)) walk(p)
  }
  assert.ok(files.length > 50, `citation scan found only ${files.length} files — it has gone blind`)
  const dangling = []
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(CITE)) {
      const id = 'D' + m[1]
      if (!ids.has(id)) dangling.push(`${f.slice(REPO.length)} cites ${id}, which is no row`)
    }
  }
  assert.deepEqual([...new Set(dangling)], [],
    're-keying a row without updating what points at it leaves a pointer resolving to nothing')
})

test('D:ledger-guard-not-vacuous: every assertion above is proven by reinstating its defect', () => {
  // Each fixture is the REAL ledger with one defect put back, run through the SAME parser and the
  // SAME assertion function CI runs. A fixture that exercised a simplified copy would prove nothing.
  const swap = (find, replace) => {
    const i = LINES.findIndex(l => l.startsWith(find))
    assert.notEqual(i, -1, `fixture anchor ${find} not found — the fixture has gone stale`)
    const out = [...LINES]; out[i] = replace(out[i])
    assert.notEqual(out[i], LINES[i], `fixture for ${find} applied no change — it would report the guard inert`)
    return out
  }
  const firstOpen = ROWS.find(r => r.cells[0] === 'OPEN')
  const fixtures = [
    ['rows-parse', swap('| D1 |', l => l.replace(' | CLOSED | ', ' | CLOSED '))],
    ['one-id-one-row', swap('| D2 |', l => l.replace('| D2 |', '| D1 |'))],
    ['status-is-a-token', swap('| D1 |', l => l.replace(' | CLOSED | ', ' | Closed | '))],
    ['counter-retired', swap('| D:remediation-atomicity |', l => l.replace('| D:remediation-atomicity |', `| D${FROZEN_MAX + 1} |`))],
    ['slug-has-two-words', swap('| D:remediation-atomicity |', l => l.replace('D:remediation-atomicity', 'D:atomicity'))],
    ['open-not-terminal-prose', swap(`| ${firstOpen.id} |`, l => l.replace(' | OPEN | ', ' | OPEN | **DONE.** '))],
    ['closed-carries-evidence', swap('| D1 |', l => l.replace(/\|\s*CLOSED\s*\|[^|]*\|/, '| CLOSED | it is closed |'))],
    ['open-carries-check', swap(`| ${firstOpen.id} |`, l => l.replace(/`check:[^`]*`/, ''))],
    ['manual-names-its-vehicle', swap('| D34 |', l => l.replace('`check: manual lane', '`check: manual someday'))],
    ['check-names-a-construct', swap('| D20 |', l => l.replace('`check: grep api/src/functions/tests/appFacts.ts', '`check: grep api/src/functions/tests/appFacts.ts:232'))],
    ['check-pattern-is-real', swap('| D3 |', l => l.replace(/`check: absent (\S+) [^`]*`/, '`check: absent $1 `'))],
    ['stale-row-fails', swap('| D20 |', l => l.replace('body\\.confirm', 'a_construct_that_is_not_there'))],
    ['no-duplicate-section', [...LINES, '## Contrast']]
    // table-header is proven below: it needs the HEADER mutated, not a row.
  ]
  const proven = []
  for (const [name, lines] of fixtures) {
    const problems = A[name](lines, parse(lines))
    assert.ok(problems.length > 0, `${name} did NOT fire on its own reinstated defect — the guard is inert`)
    proven.push(`${name}: ${problems[0].slice(0, 72)}`)
  }
  // table-header needs the header itself broken, not a row.
  const hdrLines = [...LINES]
  hdrLines[hdrLines.indexOf(HEADER)] = '| # | Not done | What makes it look done | Trigger |'
  const hdrProblems = A['table-header'](hdrLines, parse(hdrLines))
  assert.ok(hdrProblems.length > 0, 'table-header did NOT fire on a reverted header — the guard is inert')
  proven.push(`table-header: ${hdrProblems[0].slice(0, 72)}`)

  assert.equal(proven.length, Object.keys(A).length,
    `${proven.length} assertions proven but ${Object.keys(A).length} exist — an unproven assertion may be inert`)
  console.log('[D:ledger] reinstated-defect proof:\n  ' + proven.join('\n  '))
})

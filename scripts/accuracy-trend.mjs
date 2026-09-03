#!/usr/bin/env node
// WHAT:       Counts REFUTED / CONFIRMED verdicts across docs/qc-evidence/VERIFY-*.md and prints the
//             refutation rate per pass, oldest first, so "are my mistakes declining" is a MEASURED
//             answer rather than a self-assessment.
// WHY:        Owner, 2026-09-02: "be sure you are updating the accuracy log so that your mistakes
//             are on a consistent decline." A prose log cannot show a trend -- it accumulates
//             anecdotes, and the writer decides which ones. The count is the only part that cannot
//             be flattered. The same day's audit found 5 log entries against ~67 refutations, four
//             of the five caught by the owner rather than by a pass.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/accuracy-log.md 2026-09-02 entry, which carries the baseline this measures
//             against.
//
// THE ONE JUDGEMENT THIS TOOL REFUSES TO MAKE. It does not weight a refutation by severity, because
// that is exactly the knob a motivated reader turns to make a bad month look fine. Severity belongs
// in the log's prose, where a human reads it; the number stays blunt.
//
// Run: node scripts/accuracy-trend.mjs [--json]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'docs/qc-evidence')

/**
 * Count verdicts in one artifact.
 *
 * COUNTS PER LINE, NOT PER OCCURRENCE, and matches only a verdict in a VERDICT POSITION -- the token
 * alone, or bolded, at a line's start or after a claim id / separator. The naive `grep -c CONFIRMED`
 * also counts every sentence that says "confirmed by reading the source", which inflates the
 * denominator with prose and makes the rate look better than it is. That is the direction of error
 * this file exists to avoid, so it is worth the stricter pattern.
 */
function verdictsIn (text) {
  const RE = /(?:^|\||\s)(?:\*\*)?(CONFIRMED|REFUTED|NOT_APPLICABLE)(?:\*\*)?(?:\s*[—\-:.]|\s*$)/
  let confirmed = 0, refuted = 0, na = 0
  for (const line of text.split('\n')) {
    const m = RE.exec(line)
    if (!m) continue
    if (m[1] === 'CONFIRMED') confirmed++
    else if (m[1] === 'REFUTED') refuted++
    else na++
  }
  return { confirmed, refuted, na }
}

/** The artifact's date, from git rather than mtime — a container restore rewrites mtimes. */
function dateOf (file) {
  try {
    const out = execSync(`git log -1 --format=%cs -- "docs/qc-evidence/${file}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (out) return out
  } catch { /* not committed yet */ }
  return statSync(join(DIR, file)).mtime.toISOString().slice(0, 10)
}

const files = readdirSync(DIR).filter((f) => /^VERIFY-.*\.md$/.test(f))
const rows = files.map((f) => {
  const v = verdictsIn(readFileSync(join(DIR, f), 'utf8'))
  const total = v.confirmed + v.refuted
  return { file: f, date: dateOf(f), ...v, total, rate: total ? v.refuted / total : null }
}).filter((r) => r.total > 0).sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
  process.exit(0)
}

const pct = (r) => (r == null ? '   —' : `${String(Math.round(r * 100)).padStart(3)}%`)
console.log('date        refuted/total   rate   artifact')
console.log('----------  -------------  -----   --------')
for (const r of rows) {
  console.log(`${r.date}  ${String(r.refuted).padStart(6)}/${String(r.total).padEnd(6)} ${pct(r.rate)}   ${r.file}`)
}

// THE TREND, as first half vs second half of the passes in date order. Deliberately NOT a
// least-squares fit: with this few passes a regression line reads as more precision than exists,
// and the question being asked is only "is the recent half better than the earlier half".
const mid = Math.floor(rows.length / 2)
const sum = (rs, k) => rs.reduce((n, r) => n + r[k], 0)
const half = (rs) => (sum(rs, 'total') ? sum(rs, 'refuted') / sum(rs, 'total') : null)
const older = half(rows.slice(0, mid))
const newer = half(rows.slice(mid))
console.log('')
console.log(`passes: ${rows.length}   refuted: ${sum(rows, 'refuted')}   confirmed: ${sum(rows, 'confirmed')}   overall: ${pct(half(rows))}`)
console.log(`earlier half: ${pct(older)}      recent half: ${pct(newer)}`)
if (older != null && newer != null) {
  const delta = newer - older
  console.log(delta < -0.01 ? `TREND: improving (${pct(older)} -> ${pct(newer)})`
    : delta > 0.01 ? `TREND: WORSENING (${pct(older)} -> ${pct(newer)})`
      : `TREND: flat (${pct(older)} -> ${pct(newer)})`)
}
console.log('')
console.log('A rate that falls because FEWER PASSES RAN is not improvement. Read the pass count first.')

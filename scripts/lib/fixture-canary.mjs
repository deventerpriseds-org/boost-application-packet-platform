// THE CANARY: prove the instrument can SEE before letting it report an absence.
//
// ONE definition, imported by BOTH fixture consumers (`compare-ui.mjs`, `render-app.mjs`), because
// the first version of this check lived only in `compare-ui.mjs` while `render-app.mjs` — the script
// that actually produced the 627-char "the app renders nothing" reading on 2026-08-29 — was left
// unguarded. A guard on one of two consumers is a guard you will walk around without noticing.
//
// WHY IT EXISTS. Every false finding this harness has produced has one shape: the fixture starved
// the app of an input, the app correctly rendered nothing, and the nothing was reported as a missing
// feature. Four times in one session. The worst told the owner the 24/20 skill character limits had
// been "removed from the app's code and/or pipeline"; live DB the same hour said 24 and 20, and the
// only defect was that `/search-prefs` carried no `checks` object.
//
// The rule it encodes:
//
//   An instrument that cannot see has no standing to report an absence.
//
// See docs/qc-evidence/LOCAL-RENDER-UAT.md §3-§4 and .claude/accuracy-log.md (2026-08-29).

/**
 * Inputs whose ABSENCE IS INDISTINGUISHABLE FROM A MISSING FEATURE.
 *
 * A key belongs here only if its absence renders as plausible, quiet, correct-looking UI — never
 * for something that would throw or render an obvious blank. That is the whole discrimination: a
 * crash is self-reporting, a convincing lie is not.
 */
const REQUIRED = [
  {
    has: (f) => {
      const prefs = Object.entries(f).find(([k]) => k.includes('search-prefs'))?.[1]
      return !!(prefs && prefs.checks && Object.keys(prefs.checks).length)
    },
    why: '/search-prefs has no `checks` — EVERY rule label ("<= 24 chars each", the word bands, the '
      + 'gate contract) renders as unset and reads exactly like the product having lost its limits',
  },
  {
    has: (f) => {
      const req = Object.entries(f).find(([k]) => k.endsWith('/requirements'))?.[1]
      return !!(req && req.comparison)
    },
    why: 'the /requirements fixture has no `comparison` — the ENTIRE "posting against your profile" '
      + 'surface (the fit cards, the DIMENSION/asks-for/evidences/FIT table, "Run again") renders as '
      + '"Loading the comparison..." and reads exactly like a surface nobody built. Measured '
      + '2026-09-02: this single absence accounted for ~19 of the 27 panels the jd step had been '
      + 'reported as missing since UI-GAP-REGISTER. `appRequirements.ts:846-851` returns it; '
      + '`build-fixtures.mjs` never emitted it, so the harness has never once been able to see it',
  },
  {
    has: (f) => Object.keys(f).some((k) => k.includes('/swaps')),
    why: 'no /swaps key — every `original -> final` row renders as a bare list, which reads exactly '
      + 'like the swap feature never having been built',
  },
]

/**
 * Exit the process unless the fixture set can carry a finding.
 *
 * Deliberately `process.exit(1)` rather than a thrown error or a returned boolean: the failure mode
 * is a caller that presses on, and every softer signal has already been ignored in practice — the
 * previous generation of this check printed `!!! THIN FIXTURE SET - the next gap number will be
 * INFLATED`, was read, and was walked past.
 *
 * @param {object} fixtures route-keyed fixture object
 * @param {string} who      script name, so the message says which instrument is refusing
 */
export function assertFixtureCanSee(fixtures, who) {
  const failed = REQUIRED.filter((r) => !r.has(fixtures || {}))
  if (!failed.length) return
  console.error(`\n!!! HARNESS CANARY FAILED (${who}) - this run CANNOT measure the app:`)
  for (const f of failed) console.error('    ' + f.why)
  console.error('\n    Any "the app is missing X" read off this run would be a claim about the '
    + 'FIXTURE.\n    Rebuild it with scripts/build-fixtures.mjs from a full dump first.\n')
  process.exit(1)
}

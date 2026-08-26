# VERIFY-f-guards — independent verification of the three F-guards (commit 34eda36)

Verifier: independent subagent. No shared context with the implementing agent.
Repo HEAD at start: 26ce997 (== origin/main). Branch: claude/three-small-ui-gaps.
Started: (in progress)

Scope: check the THREE GUARDS added to close prior verifier findings F-1/F-2/F-3
(`docs/qc-evidence/VERIFY-groups-bc.md`). NOT a re-verification of Groups B/C.

Method: every mutation run under `trap ... EXIT` restore; `git diff --stat` asserted
empty after each. Exact pass/fail counts recorded, never "should".

---

## Log

### Baseline (unmutated, HEAD 26ce997)

| suite | command | observed |
|---|---|---|
| node unit | `cd app && npm test` | `# pass 343  # fail 0` — 343/343 |
| tally probe | `cd app && npm run test:tally` | `50/50 checks passed`, incl. `PASS the score heading NAMES the asset the score belongs to` |

`git status --short` clean, HEAD == origin/main == 26ce997.

### What the three guards actually are (read from source, not from the commit message)

- **F-1** — `app/test/browser/run-keyword-tally.mjs:155-160`. On the `scored` case it reads
  `[data-qc="tally-qc-score"] > div` (first child = the heading), strips `/^match score\s*[-–—:]?\s*/i`,
  and asserts the remainder is non-empty AND `=== ` (case-insensitively) the text of
  `[data-qc="tally-qc-asset"][data-qc-type="resume"] span` (the resume row's label).
- **F-2** — `app/test/qcRail.test.mjs:1402-1420`, `H:band-tone-fails-closed`. Imports `bandTone`
  from `../src/assetGate.js`; asserts `strong→green`, `acceptable→yellow`, and that 10 other
  inputs (`'weak','poor','unknown','',null,undefined,'STRONG','Strong',0,'pass'`) all → `red`.
- **F-3** — `app/test/qcRail.test.mjs:1375-1388`, inside `H:tally-two-empties-two-sentences`.
  Two additions: (a) distinctness now over `sentence + ' || ' + detail` across all `cases`;
  (b) a `neverRan` model built from `resume(null)` and asserted same `state` but different
  `detail` from `cases.not_scored`.

**Provenance of the two sides of the F-1 comparison (the circularity question, answered):**
`qcRail.js:923` sets `subject = assetLabel(scoredType)`. The row label is
`e.label || assetLabel(e.type)` (`qcRail.js:932`). In the probe fixture
(`test/browser/keyword-tally-probe.jsx:24,78`) the entry carries a **hardcoded literal**
`'Resume'`, so the row side does NOT flow through `assetLabel()` in this test — the two sides
have different sources here. The comparison is therefore not trivially circular. Whether it is
circular in a way that matters is tested below (M1c/M1d).

### F-2 — `H:band-tone-fails-closed` (mutations run by me, not replays)

All under `trap restore EXIT`; `git diff --stat` on `app/src/*` empty after every run.

| id | mutation to `app/src/assetGate.js:397` | observed | verdict |
|---|---|---|---|
| M2a | final `'red'` → `'green'` | `# pass 342 # fail 1`, `not ok 334 - H:band-tone-fails-closed` | guard FIRES (matches claim exactly) |
| M2b | `acceptable → 'yellow'` changed to `'green'` | `# pass 342 # fail 1`, `not ok 334` | guard FIRES |
| M2c | whole fn made case-tolerant (`String(band).toLowerCase()`) | `# pass 342 # fail 1`, `not ok 334` | guard FIRES — the `'STRONG'`/`'Strong'` cases are load-bearing, not decoration |
| M2d | rewritten as a `BAND_TONE` lookup map + `hasOwnProperty` guard (behaviour-identical refactor) | `# pass 343 # fail 0` | does NOT cry wolf |

F-2 claim (`flip final 'red'→'green'` ⇒ `not ok 334`, baseline 343/0): **CONFIRMED**, exact
count match. The guard also catches two mutations the implementer never tried, and survives a
legitimate refactor.

### F-3 — strengthened `H:tally-two-empties-two-sentences`

| id | mutation to `app/src/qcRail.js` | observed | verdict |
|---|---|---|---|
| M3a | branch-1's `detail` copied over branch-2's | `# pass 341 # fail 2`, incl. `not ok 333 - H:tally-two-empties-two-sentences` | guard FIRES (matches claim) |
| M3b | **the two details SWAPPED** — never-ran now says "The checks ran but stored no score row", ran-and-stored-nothing now says "The checks have not been run" | `# pass 343 # fail 0` | **GUARD IS INERT** |
| M3c | branch-2 reworded, same meaning ("The run happened and stored no score row…") | `# pass 343 # fail 0` | does NOT cry wolf |
| M3d | branch-1's detail := branch-2's detail + a trailing space | `# pass 343 # fail 0` | trivial-distinctness hole (renders identically in HTML) |

(M3a was measured in a first sweep whose restore path was wrong, so it ran stacked on the M2a
mutation — hence `fail 2`. `not ok 333` is `H:tally-two-empties-two-sentences` and is independent
of `assetGate.js`, so the data point stands. Tree was restored to clean and re-verified before the
second sweep; all M2b–M3d rows above come from the clean sweep.)

F-3 claim (copying branch-1's detail over branch-2 ⇒ `not ok 333`): **CONFIRMED**.
But see NEW DEFECT 1 (M3b) and NEW DEFECT 2 (fixture reachability) below.


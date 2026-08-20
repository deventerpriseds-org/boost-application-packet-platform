# The AC/verifier gate — what it found

Six independent agents, 2026-08-20. Four wrote acceptance criteria COLD (forbidden from reading the
implementation they were writing criteria for); five verified against them in isolated worktrees.
~135 criteria. Every load-bearing claim below was re-checked against the source before being recorded.

**Nothing in P5 is merged. Nothing anywhere is confirmed live.** No branch here deploys, so a
`ui-verify` run today would exercise `main` and return a meaningless pass.

---

## Scoreboard

| Stream | Verified | Failed | Partial | Live-only |
|---|---|---|---|---|
| P4 reviewer | 19 | 1 | — | 7 |
| P0 wiring + X1–X6 | 12 | 6 | 4 | 7 |
| P5.2 asset blocks | 13 | 4 | — | 5 (no qualifying data) |
| P5.3 gate drawer | 18 | 2 | 1 | 4 (no qualifying data) |
| P5.4 JD step | 16 | 6 | — | 6 |

---

## The defects that matter, in severity order

### 1. A refused quote reached the user anyway — P4, MY OWN CODE. **FIXED (H20)**
`validateCitations` refused a fabricated quote, `scrubCritique` deleted the critique line resting on
it — and then `reviewerChecks` wrote the quote into `offenders`, which three endpoints read back
verbatim. Closing one exit while leaving another open is not a fix. Proven by reverting: the guard
fails when the leak returns.

### 2. The step presents model output as the employer's words — P5.4 AC31. **OPEN**
`PacketBuilder.jsx:415-428` renders a box headed **"The posting"** whose body is `jd_summary` or,
failing that, `why_surfaced` — both model output. The same screen that painstakingly refuses to quote
`item_text` prints `why_surfaced` under that heading. **This branch RENAMED the box from "Job
description" to "The posting", making the mis-attribution stronger than it was on `main`.**

### 3. A card claims 4 lines and draws 6 — P5.2 AC5. **OPEN**
Fixture `item_count: 4`, `after_text` with 6 lines → the header says "4 lines", the body renders 6
rows, and the expectation line reads "this draft has 6 bullets". The client re-splits `after_text`
with its own copy of the API's regex. The regexes are byte-identical, so they agree *for text the API
also measured* — and nothing enforces that. `item_count` is the number the checks ran against; when
they disagree the card out-votes the row.

### 4. A finding count renders as **-2** — P5.3 AC3. **OPEN**
`Number(result.attention || 0) - reviewerN` goes negative when reviewer rows exceed `attention`. One
payload renders `1 to fix` (badge), `-2 from the measured rules`, and `3 from the independent
reviewer`. The reconcile banner does fire, to its credit — but three numbers for one quantity is the
exact failure the feature exists to prevent, reproduced inside the fix. A second defect rides along:
the rules-side number is computed two different ways (`attention − reviewerN` in the summary, a row
filter in `ChecksTab`), giving 4 and 2 for the same thing.

### 5. `covered_kw` does not mean covered — P0. **OPEN, PRE-EXISTING**
The `jdAnalysis` prompt says `keywords = ATS keywords for this role` — the posting's keyword list,
with **no comparison to the candidate anywhere**. That array is stored in `covered_kw`, returned as
`coveredKw`, and rendered as green `✓ {kw}` chips plus "N covered". P0 existed because "the one QC
surface in the app shows only good news"; after the fix it still asserts coverage it never computed.

### 6. The "Re-run" button provably cannot re-run — P0. **OPEN**
`api.js:110` — `analyzeJd: (oppId) => post(…, {})` takes no argument and never sends `force`, so the
server returns cache. The button's label flips to "↻ Re-run ATS analysis" once analysed. P0.2's
idempotency fix shipped without its one consumer.

### 7. X6 was never finished, and the commit message said it was — P0. **FIXED, in P4**
`3b36026`'s message claims `buildPackageForJD` "now returns `promptVersions`". The diff never touched
the return statement; it was a write-only local, and `noUnusedLocals` is unset so `tsc` could not flag
it. Fixed on the P4 branch — but by P4 needing it, not by that commit doing what it said.

### 8. X2 is half done and the plan lists it complete — P0. **OPEN**
The API reads `regen` in three places; `grep -rn "regen" app/src/` → **0**. The UI never sends it.
**P3.1's loop depends directly on this half.**

### 9. Dark-mode `accent` pills measure 1.90:1 — P0. **OPEN**
`.proto-dark` overrides `--surface-brand-subtle` but never `--surface-brand-default`, so an accent
pill is dark teal on near-black teal across 15+ live sites. `panel` misses the 4.5:1 AC in both
themes (4.28 light / 4.04 dark). P0.3 fixed the invisible-pill *instance* and left a worse one live.

### 10. Model prices were in the repo and went unread — D8. **FIXED**
`docs/model-ab-findings.md` (imported from huddle, ACT-50) and `.claude/memory.md` both carried
sourced rates — Luna $0.20/$1.20, Terra $2/$12, Sol $5/$30 — under a heading ending "APPLIES HERE …
NOT fixed yet". Asked why `gpt-5.6-luna` had no price, the session answered "I do not know its real
rate" and invented a null-cost policy. The owner caught it. **An unknown that memory already answers
is not an unknown, it is an unread note.**

---

## Cross-branch dependency worth knowing

P5.3 fails AC18 ("group by engine from the server's `engines` object") because **`main` has no such
field**. P4 adds it to `artifactChecksGet`. So that failure resolves when P4 lands — the drawer
should then read `engines.deterministic.results` / `engines.reviewer.results` instead of
re-partitioning `results` client-side. Ordering: **P4 before P5.3**.

---

## The structural finding, across three of five streams

**None of the P5 branches put its logic in a testable place.**
- P5.2: `splitItems`/`shapeOf`/`expectationFor` are exported from a `.jsx` that imports React, so
  `node --test` cannot load them. Zero tests added. *This is why AC5 shipped — a three-line unit test
  on `item_count` vs `splitItems` would have caught it.*
- P5.4: zero tests added; zero `data-qc` hooks, which makes several criteria permanently unprovable
  on the live system.
- P5.3: has a pure module and 10 tests — and its headline test asserts `(x − y) + y === x`, which is
  arithmetic, not a property of the code. **It cannot fail.** It is the exact assertion that would
  have to catch the `-2` bug, and it passes while the screen renders `-2`.

Every verifier had to build its own browser probe to check anything. That cost is the finding.

---

## And the gap underneath all of it

**No workflow in this repo runs the tests.** `grep -rln "npm test" .github/workflows/` → nothing.
The 262 API assertions only ever run where somebody runs them by hand.

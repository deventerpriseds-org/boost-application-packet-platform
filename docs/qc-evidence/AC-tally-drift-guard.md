# AC — `tally-drift-guard`: a stated section tally must equal a recount of its own rows

<!--
WHAT:       Acceptance criteria for a regression guard over the per-section tally lines in
            docs/qc-evidence/PROTOTYPE-COVERAGE.md.
WHY:        Measured 2026-09-02: ALL 11 tally lines had drifted from their own rows, every one
            under-claiming (worst: §4.10 stated BUILT 2 · PARTIAL 2 · ABSENT 4 against eight rows
            that all say BUILT). Root cause: a derived value with no deriver and no consumer that
            validates it. The §13 headline stayed correct only because a human recomputed it each
            pass; the section lines had no such discipline.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   docs/qc-evidence/PROTOTYPE-COVERAGE.md (the drifted lines, now recounted at 38bff57);
            commit 9464f8a (a first implementation, WITHDRAWN so these criteria could be written
            against a tree where the guard is absent).
-->

**Written cold, before the code exists.** Verified absent, not assumed:

```
$ git log --oneline -1                      # claude/boost-app-setup-approach-ejv09v
9464f8a revert(guard): withdraw the tally guard pending a cold AC pass
$ grep -c 'tally' app/test/prototypeCoverage.test.mjs
0
$ grep -rn 'coverage-tally' app/ api/ scripts/ | wc -l
0
```

An earlier implementation existed and was deliberately reverted at `9464f8a` so requirement (a)
could be satisfied honestly rather than backfilled. **That prior diff is treated here as a
PROPOSAL to be adjudicated, not as a baseline to ratify** — three of its behaviours are rejected
below (AC-14, REJ-1, REJ-4).

---

## 1. FEASIBILITY TABLE

Every row below was produced by a command run against
`claude/boost-app-setup-approach-ejv09v` @ `9464f8a` on 2026-09-02. Cited `file:line` are live.

| Dependency | Producer (who writes it) | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **The 11 tally lines** | Hand-typed by whoever last edited a section. **No deriver exists.** | **NONE.** Only machine reader of the doc is `app/test/prototypeCoverage.test.mjs`, which never looks at a tally line (`grep -c tally` → **0**). The other 6 files that name the doc do so **in comments only** (`api/test/hardening.test.mjs:5243`, `app/src/qcRail.js:836`, `scripts/build-fixtures.mjs:126`, `.github/workflows/fixture-refresh.yml:100`). | `grep -rln PROTOTYPE-COVERAGE --include=*.mjs --include=*.js --include=*.ts --include=*.yml .` → 7 files; only one reads it at runtime, and not the tallies | **EXISTS-BUT-CONSTRAINED** — the value exists; nothing derives or validates it. This *is* the defect. |
| **Tally line FORMAT — consistent across all 11?** | — | — | Regex `^\*\*§(4\.\d+) tally — (\d+) rows:\*\*` matched **11 of 11** lines (L163, 199, 233, 283, 345, 370, 391, 431, 459, 480, 512). Per-verdict tokens matched by `\b(VERDICT)\*{0,2} \*\*(\d+)\*\*` — every stated number parsed. | **EXISTS** — one uniform grammar, no exceptions. |
| **Number of SPEC sections vs number of tallies** | `## N. SPEC §4.x` headings | — | `grep -c '^## \d\+\. SPEC §4\.'` → **11**; tally lines → **11**; one per section, none duplicated. | **EXISTS** |
| **Row format — which cell holds the verdict** | — | `parse()` at `app/test/prototypeCoverage.test.mjs:39-55` | **THE 4th CELL IS NOT SAFE.** 221 id-rows split on `\|` give cell counts **3, 5, 6 and 7**. A cell-index-3 parser returns nothing for **5 rows** — all of §4.12 (L539-543), whose table is `\| # \| Element \| Verdict \|` (3 cells, verdict in cell **2**). The existing `parse()`, which scans *every* cell for a cell that `startsWith` a verdict word, resolves **221/221** and agrees with a cell-3 parser on all 216 rows where both produce an answer. | **EXISTS-BUT-CONSTRAINED** — a verdict cell exists on every row, but its **index varies by table**. Positional parsing is refuted; reuse `parse()`. |
| **Section boundaries as a scoping key** | `## N. SPEC §4.x` headings | — | **REFUTED as a scoping key.** `## 12. SPEC §4.11 — Assistant · §4.12 — …` (L487) contains **two tables**: nine `4.11-*` rows (L502-510) and five `4.12-*` rows (L539-543). Scoping the recount to the heading region yields **14 rows** against a correct `§4.11 tally — 9 rows`. | **EXISTS-BUT-CONSTRAINED** — headings do not partition rows 1:1 with tallies. Scope by the row's **own id prefix** (`4.11-`), which does. |
| **Verdict vocabulary** | §0 table, L38-45, "inherited from `COMPONENT-INVENTORY.md:24-25`" | `VERDICTS` const, `prototypeCoverage.test.mjs:33-34` | Six verdicts: BUILT, PARTIAL, ABSENT, DELIBERATE, NOT-IN-PROTOTYPE, OUT-OF-SCOPE. §0 L44-45: NOT-IN-PROTOTYPE and OUT-OF-SCOPE are *"Excluded from the denominator"*; DELIBERATE is *"Counted separately — this is not a gap"*. Live census over 221 rows: `BUILT 170 · DELIBERATE 29 · PARTIAL 10 · NOT-IN-PROTOTYPE 6 · OUT-OF-SCOPE 5 · ABSENT 1`. | **EXISTS** |
| **Does any section legitimately omit a tally?** | — | — | **YES — exactly one.** `4.12` has 5 rows and no tally line. All five are OUT-OF-SCOPE (§0: excluded from the denominator; SPEC §8 says do not build it). Every other id prefix (`4.1`–`4.11`) has exactly one. | **EXISTS-BUT-CONSTRAINED** — the guard must exempt `4.12` **by rule and by name**, not by silently skipping unmatched prefixes. |
| **Would the guard be GREEN on today's tree?** | — | — | Recount by id-prefix vs the 11 stated lines: **11/11 exact** on every stated per-verdict number; **statedRows == realRows == sum(stated)** for all 11; **zero** categories present in rows but omitted from a line. | **EXISTS** — day-one green. No cry-wolf on the current document. |
| **Stated row COUNT (`— N rows:`) convention** | — | — | All 11 currently use the bare form and all 11 are arithmetically closed (e.g. §4.5: 43 = 36+6+1). The historical `N rows (row 15 excluded)` parenthetical appears **nowhere** in the file today (`grep -c 'rows (row'` → 0). | **EXISTS** — but see AC-6: that parenthetical would make the line unparseable, which is why AC-5 exists. |
| **Cry-wolf mine #1 — orphan count fragment** | A stale §4.5 tally never fully deleted | — | **`PROTOTYPE-COVERAGE.md:346` is a bare line reading `ABSENT **2** · DELIBERATE **7**.`**, sitting directly under §4.5's tally (L345) and above its prose. §4.5's rows contain **0 ABSENT** and **6 DELIBERATE**. A *section-scoped* scanner for `VERDICT **n**` fires on it, twice, on a correct document. | **EXISTS** — a live landmine. Matching must be **tally-LINE-scoped**. |
| **Cry-wolf mine #2 — headline-shaped tables that are not the headline** | §0 and §13a | — | `\| **BUILT** \| …` also matches the §0 **vocabulary** table (L40-42, no counts at all) and the **superseded** §13a headline (L742-744: `**148** \| **80.9%**`), which the doc itself labels *"the 2026-08-25 measurement … NOT current"* (L555-557). A third at L846 is a per-component delta table. | **EXISTS-BUT-CONSTRAINED** — a headline check must be anchored to the `### 13-CURRENT` region **and** the blockquote (`> \|`) form. |
| **Cry-wolf mine #3 — headline PERCENTAGES** | §13-CURRENT table, L563-566 | — | The shown percentages are **truncated, not rounded**: `1/181 = 0.5525%` is printed **`0.5%`**, but rounds to **`0.6%`**. (170/181, 10/181 and 180/181 are identical either way, so the file gives no evidence of a consistent convention.) | **EXISTS-BUT-CONSTRAINED** — asserting the percentage column would **fail on a correct document today**. Counts only. |
| **§13-CURRENT headline vs a global recount** | Recomputed **by hand** each parity pass | — | Global recount over all 221 rows: `BUILT 170, PARTIAL 10, ABSENT 1`, denominator `BUILT+PARTIAL+ABSENT = 181`. The stated headline (L561-566) is `170 of 181 (93.9%) · PARTIAL 10 · ABSENT 1`. **Exact.** | **EXISTS** — checkable, and green today. |
| **A home for the guard** | — | — | `app/test/prototypeCoverage.test.mjs` (123 lines, 5 tests) already owns this document: it opens it, parses all 221 rows, and holds `VERDICTS`. `app/package.json:10` → `node --test test/*.test.mjs`. Baseline `npm --prefix app test` → **431 pass / 0 fail**. | **EXISTS** — extend it; do not create a file. |
| **Mutation-proof harness** | — | — | **ALREADY BUILT, and not in `scripts/`.** `api/test/deferredLedger.test.mjs:235-280` (`D:ledger-guard-not-vacuous`) reinstates each defect **into in-memory copies of the real document**, runs the **same** assertion functions CI runs, asserts each fires, and closes with `assert.equal(proven.length, Object.keys(A).length)` so an unproven assertion fails the suite. Its `swap()` helper asserts both that the anchor was **found** and that the replacement **changed the line** — i.e. it has mutate.sh's `NOT-APPLIED` outcome built in. | **EXISTS** — a permanent, in-suite proof pattern to copy. `scripts/mutate.sh` remains the one-shot cross-check. |

---

## 2. ADJUDICATION — should this guard exist, and does it belong in that file?

### 2.1 Should it exist at all? **YES.** (The legitimate "no" was considered and is refuted by the rate.)

The honest case for **no** is the strongest one available and worth stating: this document is prose
evidence, not production code; nothing branches on a tally; and a suite that fails because a
markdown summary is stale is a suite that blocks unrelated work on a bookkeeping error. That case
loses on one measured number.

**11 of 11 lines had drifted.** Not a sample — the population. A process with a 100% failure rate
is not a process, and "recount it when you edit a section" has now been demonstrated to be an
instruction nobody follows, including the sessions that wrote the instruction. Two further facts
settle it:

- **The direction was uniform: every one under-claimed.** Drift here is not noise around a true
  value, it is a systematic bias that under-reports finished work to the owner, and the worst case
  (`§4.10`: stated `BUILT 2 · PARTIAL 2 · ABSENT 4` against eight rows all reading BUILT) reads as
  *six outstanding gaps that do not exist*. CLAUDE.md: *"a row that says 'not built' is an
  instruction to build it"* — the same cost applies to a tally that says it.
- **The check is arithmetic, not judgement.** It compares a stated integer to a recount of the rows
  in the same file. It cannot be *wrong*, only *disagreed with*, and disagreement is exactly the
  defect. This is the property that makes it immune to the cry-wolf failure the file's own header
  fears — see 2.3.

### 2.2 Does it belong in `app/test/prototypeCoverage.test.mjs`? **YES, and it must EXTEND `parse()`.**

Same document, same parser, same subject. The alternative homes were checked:
`api/test/deferredLedger.test.mjs` guards a different document; a new file would be a second
instrument over one document, which is the failure §1a of the doc itself warns about.

**But "extend" here is a hard requirement, not a preference, and there is mechanical proof.** The
file's header records that a *second, independently written* parser over these rows *"reported 129
BUILT against a real 151"*. The withdrawn implementation at `9464f8a` repeated that mistake: it
wrote a fresh inline parser keyed on **cell index 3**, which silently returns nothing for the five
`4.12-*` rows (3-cell table, verdict in cell 2) — it survived only because a `cells.length < 4`
guard skipped them by accident. Two parsers over one table, disagreeing on 5 of 221 rows, in the
one file whose header exists to warn about exactly that.

> **Required: one `parse()`, extended if it needs to be. A second row parser in this file is a
> rejected design, not a stylistic note.**

### 2.3 Does it contradict the header's ABSENT-only scope note? **NO — and the note stays as written.**

The note says:

> *"Only ABSENT rows carry a machine check … PARTIAL and BUILT rot toward under-claiming, which is
> cheap; demanding a pattern for all 221 rows would be ceremony that gets deleted the first time it
> cries wolf."*

Read it precisely. **It is a rule about what the DOCUMENT must CARRY, not about what the TEST may
COMPUTE.** Its subject is the authoring burden of a `check: absent <path> <pattern>` annotation —
a human-written falsifiable claim that costs judgement to write, goes stale, and is what would get
deleted when it misfires. The tally check demands **no annotation from anyone**: every input it
reads is already in the file, and the assertion is `stated == recount`.

So the three clauses of the note survive intact:

| Clause | Applies to the tally check? |
|---|---|
| *"demanding a pattern for all 221 rows"* | **No.** It demands zero patterns. It reads 11 lines that already exist. |
| *"gets deleted the first time it cries wolf"* | **No.** It has no threshold, no similarity, no judgement — it is integer equality over the same file. Verified green on today's document, including the four live landmines in the feasibility table. |
| *"PARTIAL and BUILT rot toward under-claiming, which is cheap"* | **True of a ROW, false of a TALLY** — see below. |

That last clause is the only real tension, and it is a **scope error rather than a wrong belief**.
The cost model it states is correct for a row: a row is read by whoever is working on that one
element, so a stale `BUILT` merely under-sells one control. **A tally is not read that way — it is
the unit that gets QUOTED**, aggregated into the §13 headline, and reported to the owner as
progress. Under-claiming is cheap on a row precisely because a row is granular; it is expensive on
a summary precisely because a summary is not.

**Is the note's reasoning still sound now that under-claiming is measured at 11/11?** Its reasoning
is sound; its *empirical premise* has been narrowed. "Under-claiming is cheap" was never tested
before 2026-09-02 — and it is now false for tallies specifically, at a 100% incidence rate, with a
worst case that invented six phantom gaps. It remains untested, and plausibly still true, for
rows. **Recommendation: leave the scope note's rule alone and append one sentence recording the
narrowing**, so the next reader does not re-derive the ABSENT-only scope as covering summaries too.

### 2.4 The root cause, and what actually fixes it

> *"a derived value with no deriver and no consumer that validates it."*

There are two candidate fixes and only one of them is being specified:

| Fix | Verdict |
|---|---|
| **DERIVE** the tally lines — a script that rewrites them from the rows | **Rejected for now** (see REJ-2). It removes the stated number entirely, so there is nothing left to disagree with — but it makes the document machine-generated in part, and a generator that runs on demand is itself a thing nobody runs. |
| **VALIDATE** the stated number against a recount in the suite | **Specified here.** The stated line stays human-authored; the suite becomes the consumer that validates it. Cheaper, reversible, and it fails in CI rather than requiring anyone to remember to run it. |

---

## 3. ACCEPTANCE CRITERIA

Every AC is binary and names the command or `file:line` that decides it. Unless stated otherwise,
the deciding command is `npm --prefix app test` (`app/package.json:10`), whose **baseline on this
tree is 431 pass / 0 fail**.

### Group A — the recount is correct and complete

**AC-1 — a stated per-verdict number must equal a recount of its own rows.**
Given `PROTOTYPE-COVERAGE.md` and its 11 tally lines, when the suite runs, then for every token
matching `\b(BUILT|PARTIAL|ABSENT|DELIBERATE|NOT-IN-PROTOTYPE|OUT-OF-SCOPE)\*{0,2} \*\*(\d+)\*\*`
on a tally line, the stated integer equals the number of rows whose **id prefix** matches that
line's `§4.x` and whose resolved verdict is that verdict — and the suite passes on the current
document (all 11 lines are exact today: verified by recount, §1).
*Decides it:* the new test fails with a message naming the section, the verdict, the stated number
and the counted number.

**AC-2 — rows are attributed by ID PREFIX, never by markdown section boundary.**
Given `## 12. SPEC §4.11 — Assistant · §4.12 — Prototype-only comparison mode` (L487) contains
nine `4.11-*` rows **and** five `4.12-*` rows, when the recount for `§4.11 tally — 9 rows` is
computed, then it counts exactly **9** rows, not 14.
*Decides it:* a unit assertion that the recount bucket for `4.11` has size 9 and the bucket for
`4.12` has size 5, from `PROTOTYPE-COVERAGE.md:502-510` and `:539-543`.
*Rationale:* heading-scoped counting is refuted by measurement, not by taste.

**AC-3 — the recount reuses the file's existing `parse()`; no second row parser is introduced.**
Given `app/test/prototypeCoverage.test.mjs:39-55` already resolves a verdict for **221/221** rows
including the 3-cell `4.12-*` table, when the tally guard is added, then it obtains verdicts from
that same function (extended in place if needed) and the file contains exactly **one** function
that maps a table line to a verdict.
*Decides it:* `grep -c 'VERDICTS.find\|\.match(/\\b(BUILT' app/test/prototypeCoverage.test.mjs`
resolves to a single verdict-resolution site; and a reviewer reading the file finds one parser.
**This AC is structural and is decided by reading, not by a runtime assertion** — flagged as such,
though AC-4 makes a violation of it *detectable* rather than merely reviewable.

**AC-4 — the recount must resolve a verdict for every row it counts.**
Given a row whose verdict cell no verdict word matches, when the tally guard runs, then that row
is reported as unparseable and the suite FAILS — it is never silently dropped from a count.
*Decides it:* the existing `H:coverage-every-row-parses` already asserts this for the whole file
(`prototypeCoverage.test.mjs:57-64`); the tally guard must count from the **same** parsed set, so
that a row invisible to the parser cannot be invisible to a tally. Verified by asserting
`parsedRows.length === 221` at the point of counting, and that the sum of all per-prefix buckets
equals `parsedRows.length`.

### Group B — the guard cannot be silently disabled (this is the load-bearing group)

**AC-5 — exactly the expected set of tally lines must parse, or the suite fails.**
Given the tally-line regex, when the suite runs, then the set of `§4.x` prefixes it successfully
parsed equals exactly `{4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11}` — 11 lines — and
any reformatting, deletion or typo that drops one to 10 FAILS the suite naming the missing section.
*Decides it:* `assert.deepEqual(parsedTallySections.sort(), EXPECTED.sort())`.
*Why this is the most important AC in the document:* every other assertion in this file is
vacuous the moment a line stops matching. Without AC-5, the failure mode is not "the guard
misfires" but "the guard silently stops existing" — which is the identical shape as the original
defect (*a derived value with no deriver*), reintroduced one level up. CLAUDE.md: *"Absent evidence
is `not_applicable`, never `pass`."*

**AC-6 — an id prefix that has rows but no tally must be exempted BY NAME, with a reason.**
Given `4.12` has five rows (`:539-543`) and no tally line, when the suite runs, then it passes,
and the exemption is a named constant (e.g. `TALLY_EXEMPT = ['4.12']`) carrying the reason — all
five rows are OUT-OF-SCOPE and §0 (`:45`) excludes OUT-OF-SCOPE from the denominator. A prefix
that appears in rows, is not in `EXPECTED` and is not in `TALLY_EXEMPT` FAILS.
*Decides it:* the assertion in AC-5, plus `assert` that every id prefix present in rows is in
`EXPECTED ∪ TALLY_EXEMPT`.
*Rejects:* silently skipping a prefix with no tally line — that would let a whole new section be
added with no summary and no complaint.

**AC-7 — the tally line, not the section, is the scan unit.**
Given `PROTOTYPE-COVERAGE.md:346` is a bare orphan line reading `ABSENT **2** · DELIBERATE **7**.`
inside §4.5's region, whose rows contain **0 ABSENT and 6 DELIBERATE**, when the suite runs, then
it PASSES.
*Decides it:* `npm --prefix app test` is green on the unmodified document. A section-scoped scanner
fails here twice, on a correct document — this is the concrete cry-wolf case the guard must survive
on day one.
*Finding, out of scope for this guard:* **L346 is itself a stale fragment of a superseded §4.5
tally and should be deleted by the parity lane** (a tier-3 prose edit). It is left in place here on
purpose so that it stands as a permanent negative control for AC-7. If it is deleted, the guard
must be re-proved against a re-inserted copy in the AC-13 fixture set.

### Group C — the stated row count and category completeness

**AC-8 — the stated `— N rows:` must equal the real row count for that prefix.**
Given `**§4.5 tally — 43 rows:**` (`:345`), when the suite runs, then the number of `4.5-*` rows
is exactly 43. True for all 11 today (verified: statedRows == realRows for every line).
*Decides it:* the new test fails naming section, stated N and counted N.

**AC-9 — the stated numbers must ACCOUNT FOR every row: `sum(stated) == stated N rows`.**
Given a tally line, when the suite runs, then the sum of its per-verdict integers equals its stated
row count. True for all 11 today (e.g. §4.5: 36 + 6 + 1 = 43; §4.9: 12 + 1 + 1 + 2 = 16).
*Why this AC and not "assert every category present in rows is named on the line":* the two are
equivalent in effect and this one is cheaper and cannot be gamed. Together AC-1 + AC-8 + AC-9 close
the omission hole: **a category with a non-zero row count cannot be dropped from a line**, because
dropping it leaves `sum(stated) < N rows`. That is precisely the `§4.10` defect shape
(`BUILT 2 · PARTIAL 2 · ABSENT 4` — a line whose numbers happened to sum to 8 while three of them
were fictional; AC-1 catches that one, AC-9 catches the omission variant).

**AC-10 — a category stated as `**0**` passes iff the recount is 0.**
Given a tally line naming a verdict with a stated `0`, when the recount for that verdict is `0`,
then it passes; when the recount is non-zero, it FAILS. No line uses `0` today, so this AC is
proved by a fixture (AC-13), not by the live document.
*Decides it:* the recount must use `counted[v] ?? 0`, never `if (!counted[v]) continue` — the
latter turns a false zero into a pass.

**AC-11 — a tally line naming a verdict with zero rows in that section is NOT a special case.**
Given `§4.7 tally — 9 rows: BUILT 9` names only one category while §4.7's rows contain zero of the
other five, when the suite runs, then it PASSES — an unnamed category with zero rows is not an
error. Covered by AC-9's arithmetic (9 == 9); no separate mechanism.

### Group D — the headline

**AC-12 — the §13-CURRENT headline table must equal the global recount, COUNTS ONLY.**
Given the blockquote table at `PROTOTYPE-COVERAGE.md:562-566` under `### 13-CURRENT` (`:552`), when
the suite runs, then its **Count** column for BUILT / PARTIAL / ABSENT equals the recount over ALL
221 rows (today: 170 / 10 / 1), and the denominator asserted in the heading `170 of 181` equals
`BUILT + PARTIAL + ABSENT` (today: 181, per §0's exclusion of DELIBERATE, NOT-IN-PROTOTYPE and
OUT-OF-SCOPE).
*The guard MUST NOT assert:*
- **the percentage column** — `1/181 = 0.5525%` is printed `0.5%`; rounded to 1 d.p. it is `0.6%`.
  A percentage assertion fails on a correct document today. (Verified: `python3 -c` on all four
  values; only the 0.5/0.6 pair discriminates, and it discriminates against the guard.)
- **§13a's table at `:742-744`** (`148 / 24 / 11`) — the document labels it *"the 2026-08-25
  measurement … NOT current"* (`:555-557`). It is history and must stay wrong.
- **§0's vocabulary table at `:40-42`**, which matches `| **BUILT** |` and carries no counts.
- **the delta table at `:846`**.
*Decides it:* anchor the scan to the line range from `### 13-CURRENT` to the next `### `, and
require the blockquote form `> | **BUILT** | **170** | …`. Suite green on the unmodified document
proves the three exclusions.

**AC-12 is SECOND PRIORITY and may be deferred without blocking AC-1..AC-11.** Stated plainly
because the brief raises the two-instruments objection and it deserves a straight answer:

- **The objection does not apply.** §1a's warning is about two *different instruments* producing
  two headline numbers (a rendered-text diff vs a component diff). AC-12 is not a second
  instrument — it is **the same rows, the same parser, the same rule**, asserting that the
  hand-computed number matches. It creates no second number; it removes the possibility of one.
- **But the headline has no measured defect.** It stayed correct through the entire drift episode,
  and it reconciles exactly today. Guarding a thing that has never rotted is the ceremony the
  file's header warns about — the honest counter is that it stayed correct *because a human
  recomputed it every pass*, which is a discipline, not a mechanism, and the same absence of a
  deriver that rotted 11 lines applies to it.
- **Decision: build it, in a separate H-case, after Group A–C are green.** Separate so that a
  headline reformat cannot take the section guard down with it, and so it can be deleted alone if
  it ever proves brittle.

### Group E — the guard is proved non-vacuous, permanently

**AC-13 — every new assertion is proved by reinstating its defect INTO THE DOCUMENT, in-suite.**
Given the pattern already built at `api/test/deferredLedger.test.mjs:235-280`
(`D:ledger-guard-not-vacuous`), when the tally guard is added, then each of its assertions is
expressed as a pure function over `lines`, and a companion test builds an in-memory copy of the
**real** document with one defect reinstated, runs the **same** function, and asserts it produces
at least one problem.
*Required properties, all three already present in `swap()` at `:238-244` — copy it, do not
re-invent it:*
1. the fixture anchor must be **found**, or the test fails (`assert.notEqual(i, -1)`);
2. the replacement must have **changed the line**, or the test fails
   (*"it would report the guard inert"*) — this is `mutate.sh`'s `NOT-APPLIED` outcome, in-suite;
3. a completeness assertion `proven.length === Object.keys(A).length`, so an assertion added later
   without a fixture FAILS.
*Decides it:* `npm --prefix app test` passes, and the test's own console line lists one proven
fixture per assertion.
*Why in-suite and not only `scripts/mutate.sh`:* a `mutate.sh` run proves the guard fired **once,
on the day it was written**. The in-suite harness re-proves it on every CI run, forever, and it is
the pattern this repo already uses for its other document guard. **"Extend, don't duplicate"
applies to the proof harness as much as to the parser.**

**AC-14 — the guard must not depend on a `withdrawn/in progress` sentence in the document.**
Given all 11 tally lines currently end with prose reading *"a tally-drift guard (IN PROGRESS —
withdrawn pending its independent AC pass…)"*, when the guard lands and that prose is rewritten to
name the live H-case, then the suite still passes.
*Decides it:* the tally-line regex anchors on `^\*\*§4\.\d+ tally — \d+ rows:\*\*` and the
per-verdict token pattern only; no assertion reads the trailing `*( … )*` commentary.
*Rationale:* the commentary **will** be rewritten in the same commit that lands the guard. A
matcher that reads it would fail on its own landing commit.

### Group F — no collateral damage

**AC-15 — the pre-existing five tests still pass unchanged.**
Given `H:coverage-every-row-parses`, `H:coverage-absent-rows-carry-a-check`,
`H:coverage-absent-check-is-real`, `H:coverage-stale-absent-fails` and
`H:coverage-absent-is-rare-enough-to-mean-something` (`prototypeCoverage.test.mjs:57-123`), when
the guard lands, then all five pass and none of their assertions is weakened to accommodate it.
*Decides it:* `npm --prefix app test` → **≥ 431 pass, 0 fail** (baseline 431; the new tests add to
it, they do not replace).

**AC-16 — H-case names are SLUGS, not numbers.**
Given CLAUDE.md freezes `H1`-`H44` and requires every new case to take a slug of at least two
words, when the new tests are named, then every one matches `H:[a-z0-9-]+` and contains at least
two hyphen-separated words.
*Decides it:* `grep -o "test('H[^']*" app/test/prototypeCoverage.test.mjs` — every result matches
`H:[a-z0-9-]+-[a-z0-9-]+`, none matches `H\d`.
**Flagged: this AC is decided by a grep, NOT by the suite, and that is a real gap I checked rather
than assumed.** `H26` (`api/test/hardening.test.mjs:804-806`) enforces the rule with
`readFileSync(new URL('./hardening.test.mjs', import.meta.url))` — **it reads only its own file**
and is structurally blind to `app/test/`. Its own header already records this class of blindness
(*"STRUCTURALLY BLIND to the actual failure … 44 of 52 cases were scanned"*). The five existing
`H:coverage-*` names in `prototypeCoverage.test.mjs` therefore comply by convention, not by
enforcement. **Do not cite "H26 passes" as evidence that a new app-side slug is valid — it proves
nothing about that file.** Widening H26's scan to every `*.test.mjs` in the repo is a reasonable
follow-up, is out of scope here, and should not be bundled into this guard.

---

## 4. PROPOSED H-CASES — by SLUG, asserting the INVARIANT

Names comply with `H:[a-z0-9-]+`, at least two words, no numeric id (CLAUDE.md; the frozen range is
`H1`–`H44`). All live in `app/test/prototypeCoverage.test.mjs` beneath the existing five.

| Slug | Invariant it asserts (NOT the incident) | ACs |
|---|---|---|
| `H:coverage-tally-matches-rows` | **A stated summary of a set equals a recount of that set.** Not "§4.10 must say 8" — any tally line, present or future, must agree with its own rows. | AC-1, AC-2, AC-4, AC-10 |
| `H:coverage-tally-accounts-for-every-row` | **A summary must account for the whole set it summarises**: `sum(stated) == stated N rows == real rows`. Omission is a form of drift, not a formatting choice. | AC-8, AC-9, AC-11 |
| `H:coverage-every-tally-is-read` | **A check that cannot find its subject must fail, never pass.** The set of parsed tally lines equals a declared expected set; an unmatched prefix is either an explicit exemption or a failure. | AC-5, AC-6 |
| `H:coverage-headline-matches-rows` | **The one quoted number is derived from the same rows by the same rule** — counts only, scoped to §13-CURRENT. *(Second priority; separate test so it can be deferred or deleted alone.)* | AC-12 |
| `H:coverage-tally-guard-not-vacuous` | **Every assertion above is proven by reinstating its defect into the real document**, and an assertion added without a fixture fails the suite. | AC-13, AC-15 |

### Naming note
`H:coverage-*` is the prefix the five existing cases in this file already use. Reusing it is
deliberate — CLAUDE.md: *"One concept, one name, everywhere."* Two lanes minting
`H:coverage-tally-matches-rows` simultaneously would mean they guard the same thing, which is
information rather than a collision.

---

## 5. MUTATIONS — each must make its H-case FIRE

**The subject of every one of these guards is a FILE — `docs/qc-evidence/PROTOTYPE-COVERAGE.md`.
So the FILE is what gets mutated.** Mutating the test's own assertion disables the test, which
cannot make that test fail, and returns a false `INERT`. That mis-step was made in this very lane
earlier today and is recorded at `.claude/actions.md` (the `§4.10` re-aim); it is not hypothetical.

Every anchor below was verified **byte-exact and unique** in the current file
(`grep -Fc` → `1` for all four), which is what `mutate.sh` requires — it refuses an anchor matching
zero or more than once and reports `NOT-APPLIED` rather than a false `INERT`.

### 5.1 In-suite fixtures (AC-13) — the permanent proof

Each is an in-memory line swap over the **real** document, run through the **same** assertion
function, following `api/test/deferredLedger.test.mjs:238-244`.

| Fixture | Reinstated defect (the historical value, where one exists) | Must fire |
|---|---|---|
| `tally-matches-rows` | On §4.10's line, `BUILT **8**` → `BUILT **2** · PARTIAL **2** · ABSENT **4**` — **the exact stale text measured on 2026-09-02** | `H:coverage-tally-matches-rows` (3 problems: BUILT 2≠8, PARTIAL 2≠0, ABSENT 4≠0) |
| `tally-accounts-for-every-row` | On §4.1's line, delete ` · DELIBERATE **10**`, leaving `— 32 rows:** BUILT **20** · PARTIAL **2**` | `H:coverage-tally-accounts-for-every-row` (22 ≠ 32). **Must NOT be caught by `tally-matches-rows`** — every number left on the line is still correct, which is the point of having both. |
| `tally-row-count` | On §4.5's line, `— 43 rows:` → `— 41 rows:` | `H:coverage-tally-accounts-for-every-row` (stated 41, rows 43) |
| `every-tally-is-read` | On §4.7's line, `**§4.7 tally — 9 rows:**` → `**§4.7 tally (9 rows):**` | `H:coverage-every-tally-is-read` (parsed 10, expected 11 — §4.7 missing). **The anti-silent-disable proof; without it a reformat quietly removes the guard.** |
| `exempt-prefix-is-named` | Remove `'4.12'` from `TALLY_EXEMPT` | `H:coverage-every-tally-is-read` (prefix 4.12 has rows, no tally, no exemption) |
| `zero-is-counted` | On §4.7's line, `BUILT **9**` → `BUILT **9** · ABSENT **2**` | `H:coverage-tally-matches-rows` (ABSENT 2 ≠ 0) **and** `H:coverage-tally-accounts-for-every-row` (11 ≠ 9). Proves AC-10's `?? 0` rather than `if (!counted[v]) continue`. |
| `headline-counts` | `> \| **BUILT** \| **170** \| **93.9%** \|` → `**167**` | `H:coverage-headline-matches-rows` |
| `headline-denominator` | In §13-CURRENT's heading, `170 of 181` → `170 of 183` | `H:coverage-headline-matches-rows` |

**Negative controls — these must be present and must NOT fire** (they are already in the live
document, so a green suite on the unmodified file proves all four at once):
`:346` the orphan `ABSENT **2** · DELIBERATE **7**.` · `:742-744` the superseded §13a headline
(`148 / 24 / 11`) · `:40-42` §0's verdict-vocabulary table · `:539-543` the five 3-cell `4.12-*`
rows.

### 5.2 One-shot cross-check with `scripts/mutate.sh`

Run once at implementation time as an independent confirmation that the in-suite fixtures are not
themselves lying. `/workspace/eds-claude-skills/scripts/mutate.sh` is present and executable.

```
scripts/mutate.sh \
  docs/qc-evidence/PROTOTYPE-COVERAGE.md \
  /tmp/anchor-410.txt \
  /tmp/replace-410.txt \
  'cd /home/user/boost-application-packet-platform; npm --prefix app test' \
  'coverage-tally-matches-rows'
```

Three mechanics that are easy to get wrong and are called out because they were:

1. **`;` not `&&` in TEST_CMD.** A `cd` that fails, or a build step that exits non-zero on a
   mutation's type error while still emitting output, must not prevent the suite from running —
   `&&` turns "the mutation broke the build" into a misreported result. (No build step is needed
   for a `.md` mutation here, but the rule is the same and the TEST_CMD above obeys it.)
2. **`mutate.sh` restores SOURCE but not `dist/`.** Irrelevant for a markdown mutation — noted so
   nobody generalises from this run to a `.ts` one.
3. **Anchors come from FILES, never from shell arguments** — a quoted anchor passed through bash
   loses backslashes and dollar signs. The em-dash (`—`), the middot (`·`) and the section sign
   (`§`) in these anchors make that failure especially likely here. Write
   `**§4.10 tally — 8 rows:** BUILT **8**.` into `/tmp/anchor-410.txt` with a heredoc and pass the
   path.

**Read the three outcomes literally:** `FIRED` = the guard is real; `INERT` = it protects nothing;
`NOT-APPLIED` = **nothing was tested and the guard is UNPROVEN** — never report that as INERT.

---

## 6. CRITERIA CONSIDERED AND REJECTED

**REJ-1 — "The verdict is the 4th table cell."** *(This was the withdrawn implementation's design.)*
Refuted by measurement, not preference: 221 id-rows split on `|` yield cell counts **3, 5, 6 and
7**, and the five `4.12-*` rows (`:539-543`) use a 3-cell table whose verdict is cell **2**. A
cell-index-3 parser resolves nothing for them. It survived in `9464f8a` only because a
`cells.length < 4` early-`continue` skipped them silently — a correct result by accident, which is
worse than a wrong one because it will not stay correct. **Rejected in favour of reusing `parse()`
(AC-3), which resolves 221/221.**

**REJ-2 — Generate the tally lines from the rows instead of checking them.**
Genuinely tempting: it eliminates the drift class entirely rather than detecting it, and it is the
direct answer to "a derived value with no deriver". Rejected for **now**, on three grounds: it
makes part of a hand-written evidence document machine-generated, so a human edit to a tally line
becomes a merge conflict against a generator; a generator is a thing somebody must remember to run,
which is the same discipline that already failed 11 times; and it would have to reproduce the prose
commentary each line carries. **Recorded as a real alternative, not dismissed** — if the check
proves noisy in practice, generation is the escalation, and it should reuse the same `parse()`.

**REJ-3 — Assert the headline PERCENTAGES.**
Rejected on evidence: `1/181 = 0.5525%` is printed as **`0.5%`** (`:565`), which is truncation;
rounded to one decimal it is `0.6%`. The other three values (93.9, 5.5, 99.4) are identical under
both conventions, so the document supplies **no evidence** of which rule it follows — and an
assertion under either rule fails on a correct document today. Counts only (AC-12).

**REJ-4 — "A tally line may omit a category it has none of, so only check what it states."**
*(Also the withdrawn implementation's stated rule.)* The premise is true and the conclusion does
not follow. Under state-only checking, a category with a **non-zero** row count can be dropped from
a line and the guard stays green — which is `§4.10`'s and `§4.11`'s exact failure shape
(under-claiming by omission as well as by wrong numbers). **Rejected in favour of AC-9's
arithmetic closure** (`sum(stated) == stated N rows == real rows`), which permits omitting a
zero-count category and forbids omitting a non-zero one, with no list of categories to maintain.

**REJ-5 — Scope the recount to markdown section boundaries (`## N. SPEC §4.x` … next heading).**
Refuted by `:487`, where one heading covers §4.11 *and* §4.12 and holds 14 rows against a correct
`§4.11 tally — 9 rows`. **Rejected in favour of row-id-prefix attribution (AC-2)**, which is also
self-documenting: the row says which tally it belongs to.

**REJ-6 — Scan the whole section region for `VERDICT **n**` tokens rather than the tally line only.**
Refuted by `:346`, a live orphan line reading `ABSENT **2** · DELIBERATE **7**.` left over from a
superseded §4.5 tally. §4.5's rows hold 0 ABSENT and 6 DELIBERATE, so a section-scoped scanner
fires **twice on a correct document**, on its first run. This is the precise cry-wolf death the
file's header predicts. **Rejected in favour of line-scoped matching (AC-7).**

**REJ-7 — Extend the guard to check that each row's VERDICT is correct.**
Out of scope and correctly so. A verdict is a judgement about whether an element is built; only a
human or a render pass can settle it, and the document's own §14/§15 explain why. This guard
asserts **only** that the summary and the rows agree — it says nothing about whether a verdict is
right. Keeping that boundary is what makes it un-arguable and therefore un-deletable.

**REJ-8 — Require every row to carry a `check:` pattern (extend the ABSENT scope to all 221 rows).**
Explicitly rejected by the file's header and nothing here disturbs that. It is an authoring
obligation on 221 rows, it demands human judgement per row, and it is what would get deleted the
first time it misfires. **The tally guard requires no annotation from anyone** — which is exactly
why it does not contradict the note (§2.3).

**REJ-9 — Assert a minimum/maximum on the tallies (e.g. "BUILT must not decrease").**
Rejected: a ratchet on a measurement is an instruction to fudge the measurement. Rows legitimately
move BUILT → PARTIAL when a render pass disproves a source-only read, and the denominator
legitimately shrinks when a row closes DELIBERATE (`:571`: *"the denominator moved 183 → 182"*).
A guard that made an honest re-verdict fail the suite would corrupt the data it exists to protect.

**REJ-10 — Delete `:346` (the orphan fragment) as part of this work.**
Correct to do, wrong to bundle. It is a tier-3 prose edit belonging to the parity lane, and it is
this guard's single best negative control while it remains. **Recommendation: land the guard first
with `:346` in place (proving AC-7 against a real mine), then delete the line in a separate commit
and re-prove AC-7 against a fixture-inserted copy.**

**REJ-11 — Put the guard in a new file, or in `api/test/`.**
Rejected: `app/test/prototypeCoverage.test.mjs` already opens this document, already parses all 221
rows, and already owns its staleness. A second file over one document is the two-instruments
failure §1a of the document itself describes. *(The header's reason for `app/test` over `api/test`
— every path an ABSENT row names is under `app/src` — is unaffected by this addition.)*

**REJ-12 — Prove the guard once with `scripts/mutate.sh` and stop there.**
Rejected as *insufficient*, not as wrong. A one-shot mutation proves the guard fired on the day it
was written; it says nothing about the day someone edits the parser. The repo already has the
durable form — `D:ledger-guard-not-vacuous` (`api/test/deferredLedger.test.mjs:235-280`) — with
anchor-found and change-applied assertions and a completeness check that fails when an assertion
gains no fixture. **AC-13 requires the in-suite harness; `mutate.sh` is the one-shot cross-check on
top of it, not the substitute for it.**

---

## 7. SUMMARY FOR THE IMPLEMENTER

1. **Build it.** 11/11 drift, uniformly under-claiming, is not rot — it is the absence of a deriver.
2. **In `app/test/prototypeCoverage.test.mjs`, extending `parse()`. One parser in that file.**
3. **Attribute rows by id prefix; match on the tally LINE only.** Both are refuted alternatives
   with named line numbers, not opinions.
4. **AC-5 is the one that must not be cut.** Everything else is vacuous without it.
5. **Counts, never percentages; §13-CURRENT only, and second.**
6. **Prove it by mutating the DOCUMENT, in-suite, in the shape `deferredLedger.test.mjs` already
   uses.** Mutating the test returns a false INERT — that happened in this lane today.
7. Expected end state: `npm --prefix app test` ≥ 436 pass / 0 fail (baseline 431 + 5 new).
8. Two things to leave alone: `:346` (delete separately, REJ-10) and the header's ABSENT-only scope
   note (append one sentence recording the narrowing, §2.3 — do not rewrite the rule).

# AC — the headline-recount guard (ACT-70)

**Tier 1** (asserts a coverage count, decides a CI gate). AC pass, written before any implementation
code. Every number below was measured against the live file on this branch — none is assumed.

**Method:** ran the existing `parse()` from `app/test/prototypeCoverage.test.mjs` against the real
`docs/qc-evidence/PROTOTYPE-COVERAGE.md` (`node -e '...'`, shown inline below each finding), plus a
second hand-built parser implementing the doc's own *textual description* of its method, to settle
the discrepancy the brief asked about. `node --test app/test/prototypeCoverage.test.mjs` → **5/5
pass**, 117ms, confirming the existing infrastructure is live and cheap before building on it.

---

## FEASIBILITY TABLE

| Dependency | Producer | Consumer | Proof (command + result) | Verdict |
|---|---|---|---|---|
| Row-level verdict parser (`parse()`, `VERDICTS`, `checkOf()`) | `app/test/prototypeCoverage.test.mjs:23-35` | 5 existing `H:coverage-*` tests | `node --test app/test/prototypeCoverage.test.mjs` → 5/5 pass, 117ms | **EXISTS** |
| A guard comparing 13-CURRENT's stated headline to `parse()`'s recomputed figure | none | none | `grep -rniE "recount|headline" app/test scripts` → no hit on this doc; the doc's own text says outright: *"The guard — a check that recomputes this number from the rows and fails when the stated figure disagrees — is proposed in `ACT-70` and remains unwritten"* (`PROTOTYPE-COVERAGE.md:578-579`) | **ABSENT — this is the thing being built** |
| The doc's *stated* method ("4th cell, verdict token appearing earliest in the cell", `PROTOTYPE-COVERAGE.md:438`) vs `parse()`'s *actual* method (leftmost cell that `startsWith` a token) | doc prose vs running code | future implementer, if they trust the prose over the code | Ran both against the live file (below). Agree on 216/221 rows. Disagree on exactly the 5 `4.12-*` rows: those are 3-column rows (no proto-ref column), so their verdict lands in split-cell index 3, not 4 — a literal "4th cell" reader returns `null` there; `parse()`'s leftmost-match correctly resolves `OUT-OF-SCOPE`. Both denominators are unaffected either way, because `OUT-OF-SCOPE` rows are excluded regardless of which parser reads them. | **EXISTS-BUT-CONSTRAINED** — `parse()` is the correct, more-robust implementation; the doc's *prose description* of it is imprecise and must not be used as an independent spec |
| 13-CURRENT's stated headline (`169 of 182, 92.9%`, `PARTIAL 12`, `ABSENT 1`) vs `parse()`'s live recount | doc + rows | 3 parallel lanes that collided on this block 2026-09-02 | `node -e` script below → computed `BUILT 169 / denominator 182 (210 non-excluded − 28 DELIBERATE) / PARTIAL 12 / ABSENT 1` — **exact match** | **EXISTS, currently accurate** (would pass a guard today with zero doc edits) |
| 13a/13b's frozen historical figures (`148 of 183`, per-section `150/23/12`) | doc | narrative-only, per its own caption | Doc text: *"Read §13-CURRENT for the live picture; §13a below is the 2026-08-25 measurement, kept for its delta narrative and NOT current"* (`:567`); 13b: *"Regenerated mechanically at `34eda36`"*, its own frozen snapshot (`:803`) | **EXISTS, deliberately frozen** — must be excluded from the guard by design |
| 13-RENDER's `83 of 84 BUILT (98.8%)`, scoped to §4.4+4.5+4.6+4.7 | doc + rows | §17 cites it | Summed `parse()` over those 4 sections: BUILT 30+36+8+9=83, non-deliberate denominator 33+42+11+9−(3+6+2+0)=84 — **exact match today** | **EXISTS, currently accurate**, different formula (section-subset, not whole-doc) — see scope decision below |
| The 11 per-section `§4.n tally` lines | doc + rows | readers of each section | Computed `parse()` per section and diffed against every stated tally line (below): **3 of 11 match** (§4.3, §4.9, §4.10); **8 of 11 are stale right now** (§4.1, §4.2, §4.4, §4.5, §4.6, §4.7, §4.8, §4.11), with measured deltas listed below | **EXISTS-BUT-CONSTRAINED — measurably stale today**, not a hypothetical |
| `/workspace/eds-claude-skills/scripts/mutate.sh` | eds-claude-skills | mandated by this repo's `CLAUDE.md` for every new-guard mutation proof | `CLAUDE.md`: *"USE `.../scripts/mutate.sh`, NOT A HAND-ROLLED SCRIPT"* | **EXISTS** — implementation phase must use it, not a hand-rolled diff/restore |

**The comparison command, for the record** (run against `HEAD` on this branch, not assumed):

```js
// parse() copied verbatim from app/test/prototypeCoverage.test.mjs — not reimplemented
const rows = parse(); // 221 rows
const excluded = new Set(['NOT-IN-PROTOTYPE','OUT-OF-SCOPE']);
const nonExcluded = rows.filter(r => !excluded.has(r.verdict));      // 210
const nonDeliberate = nonExcluded.filter(r => r.verdict !== 'DELIBERATE'); // 182
const built = rows.filter(r => r.verdict === 'BUILT').length;        // 169
// 169/182 = 92.9% — matches the stated 13-CURRENT headline exactly.
```

---

## Per-section tally staleness, measured (evidence for the scope decision below)

| Section | Stated (in doc today) | Computed from rows (today) | Agrees? |
|---|---|---|---|
| §4.1 | BUILT 19 · PARTIAL 3 · ABSENT 2 · DELIB 8 | BUILT **20** · PARTIAL 3 · ABSENT **0** · DELIB **9** | **NO** |
| §4.2 | BUILT 11 · PARTIAL 3 · ABSENT 0 · DELIB 0 | BUILT **13** · PARTIAL **1** · ABSENT 0 · DELIB 0 | **NO** |
| §4.3 | BUILT 9 · PARTIAL 2 · ABSENT 0 · DELIB 2 | BUILT 9 · PARTIAL 2 · ABSENT 0 · DELIB 2 | yes |
| §4.4 | BUILT 24 · PARTIAL 7 · ABSENT 0 · DELIB 2 | BUILT **30** · PARTIAL **0** · ABSENT 0 · DELIB **3** | **NO** |
| §4.5 | BUILT 32 · PARTIAL 1 · ABSENT 2 · DELIB 7 | BUILT **36** · PARTIAL **0** · ABSENT **0** · DELIB **6** | **NO** |
| §4.6 | BUILT 7 · PARTIAL 1 · ABSENT 1 · DELIB 2 | BUILT **8** · PARTIAL 1 · ABSENT **0** · DELIB 2 | **NO** |
| §4.7 | BUILT 7 · PARTIAL 1 · ABSENT 1 · DELIB 0 | BUILT **9** · PARTIAL **0** · ABSENT **0** · DELIB 0 | **NO** |
| §4.8 | BUILT 18 · PARTIAL 4 · ABSENT 0 · DELIB 3 | BUILT **19** · PARTIAL **3** · ABSENT 0 · DELIB 3 | **NO** |
| §4.9 | BUILT 12 · PARTIAL 1 · ABSENT 0 · DELIB 1 | BUILT 12 · PARTIAL 1 · ABSENT 0 · DELIB 1 | yes |
| §4.10 | BUILT 8 · PARTIAL 0 · ABSENT 0 · DELIB 0 | BUILT 8 · PARTIAL 0 · ABSENT 0 · DELIB 0 | yes |
| §4.11 | BUILT 0 · PARTIAL 2 · ABSENT 6 · DELIB 1 | BUILT **5** · PARTIAL **1** · ABSENT **1** · DELIB **2** | **NO** |

**This is the exact defect ACT-70 exists to prevent, already live in 8 of 11 places** — including
in the two sections (§4.8, §4.10) the brief cites as the *historical* precedent, which have since
been mechanically fixed while 8 *other* sections drifted the same way, unwatched. This is the
central input to the scope decision below: guarding these too, in the same pass as 13-CURRENT,
would require fixing 8 stale blocks as a prerequisite — real, if mechanical, work that should not
ride silently inside a "guard" commit.

---

## SCOPE DECISION

**IN SCOPE (this AC pass, ACT-70):** the `13-CURRENT` block only — its headline line and its
3-row breakdown table. This is the literal block that collided three times on 2026-09-02 and the
literal problem ACT-70's brief describes.

**OUT OF SCOPE, and why:**

- **13a, 13b, 13c, 13d** — deliberately frozen/historical, by the doc's own caption. Guarding them
  would be the exact cry-wolf failure `CLAUDE.md`'s smart-quote-linter story warns against: correct
  content flagged as a defect.
- **13-RENDER's `83 of 84`** — currently accurate, but a *different* formula (a 4-section subset,
  not the whole-doc denominator). Adding it now doubles the anchor/regex surface of a Tier-1 guard
  for a number that isn't the one that actually collided. Recommend as a fast-follow once 13-CURRENT
  is merged and proven, not bundled in.
- **The 11 per-section `§4.n tally` lines** — 8 are stale *today*, measured above. Fixing them is a
  real, if mechanical, edit across most of the document (re-deriving already-decided verdicts, no
  judgment calls) and deserves its own commit and its own review, not to be smuggled in as a side
  effect of adding a guard. **Recommend a follow-up item (ACT-71): mechanically recompute and correct
  all 8 stale tally lines from `parse()`'s own output, in one commit, THEN extend this guard (or add
  a sibling one) to keep them honest.** The exact stated-vs-computed deltas are recorded above so
  that follow-up costs no rediscovery.
- **The narrative delta sentences** (`"+6 BUILT on 2026-09-02, from THREE passes..."`, `"merged
  recount of three lanes"`) — free-form English, not a verdict in a fixed table slot. Machine-checking
  prose narrative is fragile and exactly the kind of guard that cries wolf on correct text; not
  proposed at all, for any scope.

---

## ACCEPTANCE CRITERIA

Numbered, binary, `Given/When/Then`. Every new test lives in `app/test/prototypeCoverage.test.mjs`
and **calls the existing `parse()` function directly — no second parser.**

### AC1 — the headline count matches the rows

**Given** the `13-CURRENT` block states `# **N of D prototype elements present (P%)**` plus a
breakdown table with BUILT/PARTIAL/ABSENT counts,
**when** the guard extracts that stated N, D, BUILT, PARTIAL, ABSENT and recomputes the same four
integers from `parse()` (denominator = total rows − `NOT-IN-PROTOTYPE` − `OUT-OF-SCOPE` −
`DELIBERATE`; BUILT/PARTIAL/ABSENT = counts within that denominator),
**then** all four stated integers must equal all four computed integers, or the test fails with a
message naming the block (`13-CURRENT`), every stated value, every computed value, and each delta.

**Mutation A (headline edited, rows untouched):** change `169 of 182` → `170 of 182` in the
13-CURRENT block only. Suite must fail; message must show stated BUILT 170, computed BUILT 169,
delta −1.

**Mutation B (row edited, headline untouched — the actual collision scenario):** flip row `4.11-4`'s
verdict cell from `ABSENT` to `BUILT` (the "a lane re-verdicts a row and forgets the headline" case
this guard exists for). Suite must fail; message must show computed BUILT 170 vs stated 169,
computed ABSENT 0 vs stated 1.

Both mutations exercise the same assertion via two different, realistic edit paths — this is the
core of the guard and the one AC that must never be skipped.

### AC2 — the headline percentages are consistent with the headline counts

**Given** the same breakdown table also states a percentage per row (`92.9%`, `6.6%`, `0.5%`),
**when** the guard recomputes `(statedCount / statedDenominator * 100).toFixed(1)` for BUILT,
PARTIAL and ABSENT using the *stated* counts (not the recomputed ones — this isolates a rounding/typo
bug from a staleness bug),
**then** each recomputed percentage string must equal the stated one.

**Mutation:** change `92.9%` → `95.0%`, leaving `169`/`182` untouched. Suite must fail with a message
distinguishable from AC1's (names this as a percentage-consistency failure, not a count mismatch).

### AC3 — an absent or renamed 13-CURRENT block fails loud, never silently passes

**Given** the anchor heading `### 13-CURRENT.` could be deleted or renamed by an unrelated edit,
**when** the guard cannot locate it,
**then** the test must fail with an explicit "could not locate the 13-CURRENT block" message — never
silently skip or report a pass. (Standing rule: *"Absent evidence is `not_applicable`, never `pass`."*
Precedent: `H:coverage-every-row-parses` exists because an earlier parser silently dropped 34 rows.)

**Mutation:** rename `### 13-CURRENT.` → `### 13-CURRENT-OLD.`. Suite must fail with that explicit
message, not a bare `TypeError`/`null` crash.

### AC4 — the guard's scan window excludes every frozen/historical block, structurally, not by luck

**Given** `13a`/`13b`/`13c`/`13d` sit *after* `13-CURRENT` in the same `## 13.` section and contain
different numbers for the same kind of claim (`148 of 183`, `83 of 84`),
**when** the guard extracts the 13-CURRENT slice by bounding it between `/^### 13-CURRENT\./` and the
next `/^### /` heading,
**then** that extracted slice must not contain the strings `148 of 183` or `83 of 84` — proven
against the real file today, no synthetic fixture needed, since both numbers already coexist in the
document right now.

**Mutation (proves the boundary is load-bearing, not incidental):** widen the terminating regex from
`/^### /` to `/^## /` (i.e. stop only at the next `##`-level heading). Because `13a`/`13-RENDER` are
`###`-level, nested under the same `## 13.` heading, this change makes the slice swallow all of them.
Suite must then fail (the widened slice now contains `148 of 183`, which disagrees with the recount).
Restore the regex; suite passes again. This is the mutation that proves AC4 is actually enforced by
the extraction logic, not merely true by accident of today's numbers.

### AC5 — the guard reuses `parse()`; it does not reimplement the doc's own prose description

**Given** the doc's own text describes its method as "4th cell, earliest token" (`:438`), which was
measured above to disagree with `parse()` on 5 rows,
**when** the new guard code is written,
**then** it must call the existing `parse()` (same function, same file) and must not contain a second
regex-based row-verdict extractor.

**Mutation:** temporarily add a second `function parse2(...)` stub anywhere in
`app/test/prototypeCoverage.test.mjs` that reimplements row-verdict extraction. A structural check
(`grep -c '^function parse\b'` on the file, asserted `=== 1`) must fail. Remove the stub; passes
again. This operationalizes `CLAUDE.md`'s "Extend, don't duplicate" for this specific file rather
than relying on review discipline alone.

---

## What this AC pass explicitly recommends NOT building (and why)

1. **A second/duplicate row parser** — `parse()` already exists, is correct, and is more robust than
   the doc's own prose description of it (see the §4.12 finding). AC5 makes this structurally
   enforced, not just a stated intention.
2. **A checker for 13a/13b/13c/13d** — deliberately frozen historical content; AC4 proves the scan
   window excludes them by construction.
3. **A checker for the 11 per-section `§4.n tally` lines** — real value, but 8 of 11 are stale
   *today* (measured above), so bundling them into ACT-70 means the guard can't merge without first
   landing an unrelated-looking whole-document edit. Deferred to a named follow-up (ACT-71) with the
   exact deltas already in hand.
4. **A checker for 13-RENDER's `83 of 84`** — currently accurate, but a different (section-subset)
   formula; adding it now is scope creep on a Tier-1 guard past what actually collided. Fast-follow,
   not blocking.
5. **Any check on the narrative delta sentences** (`"+6 BUILT..."`, `"merged recount of three
   lanes"`) — free-form prose, not a verdict in a fixed slot; machine-checking it is the cry-wolf
   failure this repo has already written down and reverted once (the smart-quote linter).
6. **A CI-wiring change** — `app/test/prototypeCoverage.test.mjs` is already a standing `node:test`
   file with 5 passing tests; new tests added to it are picked up automatically by whatever already
   runs this suite. No new CI plumbing is implied by this AC pass.

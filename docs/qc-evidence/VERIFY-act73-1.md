# VERIFY-act73-1 — Independent verifier pass, loop 1

Repo: `/home/user/boost-application-packet-platform`, branch `claude/eds-skills-setup-summary-ngpaos`
(HEAD `4672e0e`, in sync with origin at time of verification).

This is loop 1: no prior state, all claims derived from scratch. Written incrementally.

---
## C1 — five guards reuse `parse()`, exactly one row parser

**CONFIRMED.** `grep -n "function " app/test/prototypeCoverage.test.mjs` shows 4 functions total:
`parse()` (L40), `checkOf()` (L58), `currentBlock()` (L148), `recount()` (L159). Every one of the 5
new headline guards (`H:headline-block-is-findable`, `H:headline-matches-the-rows`,
`H:headline-percentages-follow-its-own-counts`, `H:headline-guard-window-excludes-the-frozen-blocks`,
`H:headline-guard-has-exactly-one-row-parser`) calls `currentBlock()` and/or `recount()`, and
`recount()` itself calls `parse()` at L160. `currentBlock()` does not parse rows — it only slices
text between headings. No guard reimplements the row regex. There is exactly one `function parse(`
in the file (L40).

## C2 — `H:headline-matches-the-rows` fails in BOTH directions

**CONFIRMED**, by mutation via `mutate.sh` (not by reading — actually reinstated the defect and
watched the suite fail):

- Direction A (headline edited, rows untouched): mutated `169 of 182 ... (92.9%)` →
  `170 of 182 ... (93.4%)`. Result: `FIRED`.
- Direction B (a row's verdict moved, headline untouched): mutated row `4.1-1` from `BUILT` to
  `PARTIAL`. Result: `FIRED`.

Both restores verified clean against HEAD by the harness.

## C3 — scan window covers `13-CURRENT` only, does not flag frozen content

**CONFIRMED.**
1. Baseline: `node --test app/test/prototypeCoverage.test.mjs` on unmutated source — all 10 tests
   pass, including `H:headline-guard-window-excludes-the-frozen-blocks`. Since the document currently
   contains both `148 of 183` (13a) and `83 of 84` (13-RENDER) verbatim, and the test still passes,
   the guard is not firing on that correct content today.
2. Verified the boundary is load-bearing, not incidental: `currentBlock()` (L148-157) stops the slice
   at the FIRST following `### ` heading. Headings via `grep -n "^### "`: `13-CURRENT` at L563,
   `13-RENDER` at L642 — the very next `### `. So the window is L563-641 and structurally cannot
   include 13a (L749) or 13-RENDER's own content.
3. Attacked it directly: mutated `currentBlock()` to widen the window to the SECOND following `### `
   heading (swallowing 13-RENDER's `83 of 84` into the slice). Result: `FIRED` — the guard correctly
   caught the widened window pulling in frozen content it must not touch.

## C4 — `H:headline-percentages-follow-its-own-counts` catches percentage drift

**CONFIRMED** by mutation. Changed `**BUILT** | **169** | **92.9%**` → `**169** | **95.0%**` (count
left alone, percentage drifted from what `169/182` actually computes to). Result: `FIRED`.

## C5 — `H:headline-block-is-findable` fails when the anchor is renamed/deleted

**CONFIRMED** by mutation. Renamed `### 13-CURRENT.` → `### 13-RENAMED.`. Result: `FIRED` — the
guard does not silently pass when it cannot find its target; it fails loudly, which is the "absent
evidence is not a pass" property the brief asked for.

## C6 — mutation-proof, re-run independently, and an attempt to break each guard beyond the author's own tests

Re-ran `mutate.sh` myself (not trusting the PR's reported outcomes) for every guard above; all
`FIRED` as shown in C2-C5.

**`H:headline-guard-has-exactly-one-row-parser`, specifically:**
- Re-ran the documented v3 case: inserted a second function `secondParser()` under a DIFFERENT name,
  reimplementing the row match with the exact literal regex `/^\|\s*(\d+\.\d+)-(\d+)\s*\|/` (same
  escaping as the real parser). Result: `FIRED`. Confirms v3 is not vacuous for the case it was
  written to catch.
- **Attempted to break it beyond what the author tested — and found a real gap.** Inserted a second
  parser using a *behaviourally identical* but differently-escaped regex,
  `/^\|\s*([0-9]+\.[0-9]+)-([0-9]+)\s*\|/` (character class instead of `\d`). This is not a
  behaviourally-inert mutation — `[0-9]` and `\d` match identically for ASCII digits in JS without
  the `/u` flag, so this is a second, functioning row parser that would genuinely drift from `parse()`
  independently, exactly the risk the guard's own comment says it exists to catch ("a second parser
  under a different name that re-implements the row regex and drifts"). Result: **`INERT`** — the
  guard's needle is the LITERAL substring `(\d+\.\d+)-`, so any reimplementation using different
  regex syntax for the same match (character classes, non-capturing groups, a differently-ordered
  alternation, etc.) is invisible to it.

  **This is a genuine, reportable limitation, not a mutate.sh false negative.** The guard's docstring
  already hints at narrowness ("assembled from two halves so it cannot appear contiguously... except
  where a real parser writes it") but does not disclose that the narrowness extends to ANY syntactic
  rewrite of the same regex, not just accidental self-matches. The guard proves "no second copy of
  this exact string," which is a real but strictly weaker property than "no second parser." Given
  this is TIER 1 (a coverage-count / CI-gate guard), flagging it rather than silently accepting the
  brief's framing.

## C7 — `fixture-refresh.yml`'s new `check_result` join reproduces the live route exactly

**CONFIRMED**, on all three sub-claims:

1. **Semantics match.** Live route (`appChecks.ts:388-390`): `g = select * from artifact_gate where
   artifact_id=$1`; `results = g ? select * from check_result where artifact_id=$1 and run_id=$2
   (using g.run_id) : []`. The new SQL (`fixture-refresh.yml`, `checks` key):
   `select ... from check_result cr join artifact_gate g on g.artifact_id = cr.artifact_id and
   g.run_id = cr.run_id where cr.artifact_id in (...)`. An INNER JOIN on both `artifact_id` and
   `run_id` is the set-based equivalent of "for each artifact, only the rows whose run_id equals
   that artifact's gate's run_id" — same predicate as the route.
2. **No-gate case matches.** An artifact with no `artifact_gate` row contributes nothing to the
   join (no `g` row to match), exactly matching the route's `g ? ... : []`.
3. **Cannot multiply rows — verified from the schema, not asserted from the comment.**
   `artifact_gate.artifact_id` is declared `primary key` (`schema.ts:791`), so at most one `g` row
   exists per `artifact_id`; the join's `g.run_id = cr.run_id` predicate then admits at most that one
   row per `check_result` row. No fan-out is possible.

Same reasoning holds for the `scores` key (`artifact_score s join artifact_gate g on
g.artifact_id=s.artifact_id and g.run_id=s.run_id`) — and `artifact_score` additionally carries
`unique (artifact_id, run_id)` (`schema.ts:841`), so the join is 1:1 on both sides, doubly
confirming no multiplication. `scoreHistory` is correctly NOT run-scoped (deliberately, per its own
comment) and matches the route's unconditional `... order by computed_at desc limit 10`, using a
`LATERAL` join to cap per-artifact rather than per-packet — verified this is necessary: a flat
`limit 10` over a packet-wide query would starve artifacts after the first, which the LATERAL avoids.

## C8 — new `artifact_score`/history keys match live-route key names, checked against actual consumers

**CONFIRMED**, traced to the real reader, not the brief's description:
- `AssetGateDrawer.jsx:389`: `const s = result.score` — top-level `score` key, matching
  `checkResultFor()`'s returned `{ ..., score, history, ... }` (`build-fixtures.mjs`).
- `assetGate.js:497-503` (`scoreParts`) reads `score.must_have_coverage`, `score.keyword_coverage`,
  `score.seniority_alignment`, `score.must_have_source` / `keyword_source` / `seniority_source` —
  exact snake_case `artifact_score` column names. The dump's `row_to_json(s)` on that table produces
  identically-named JSON keys, and the live route's `score` field is the raw pg row from
  `select * from artifact_score ...` — same shape both ways.
- `AssetGateDrawer.jsx:395,422-424`: `history.map(h => ...)` reads `h.computed_at`, `h.composite`,
  `h.must_have_coverage` — a subset of the four columns (`composite, band, must_have_coverage,
  computed_at`) the SQL's `scoreHistory` LATERAL projects; matches.

## C9 — the extended thin-fixture refusal extends the EXISTING guard and cannot false-positive on a legitimate fixture

**CONFIRMED** on both parts asked, **with one reportable gap found by direct testing (not reading)**.

- **Single mechanism, not parallel.** `grep -n "const thin\|thin.push\|if (thin.length)"` shows one
  `const thin = []` (L225), pushes from four pre-existing checks plus the two NEW ones (`artifact_score`
  absence at L251, duplicate `check_key` at L267), and exactly one `if (thin.length)` refusal block
  (L273) gated by the same `--allow-thin` flag. Not a second refusal path.
- **No false positive on a legitimate fixture** — tested directly, not inferred. Built a synthetic
  `raw-dump.json` with one gated, scored, non-duplicated artifact plus `apiRequirements.comparison`
  resolved. `node scripts/build-fixtures.mjs --raw ... --opp opp1 --out ...` → exit 0, no thin warning.
- **Both new checks genuinely FIRE on the defects they claim to catch** (tested by injection, not
  read): (a) removed the `scores` array entirely from an otherwise-legitimate dump with one gated
  artifact → exit 1, `missing: artifact_score ...`. (b) appended a second `check_result` row for the
  same artifact/check_key under a different `run_id` (simulating a fixture-refresh run that skipped
  the join) → exit 1, `missing: checks scoped to the gate's run - artifact art1 carries 2 result rows
  for 1 distinct check_key ...`.

**Gap found, not claimed by C9 but worth flagging (TIER 1 adjacent — this feeds coverage claims
elsewhere in the doc):** the `artifact_score` predicate is `gated.length && !gated.some(a =>
score(a))` — it fires only when **every** gated artifact lacks a score. Constructed a fixture with
TWO gated artifacts, one scored and one not (`gate: 'fail'`, no score row) — the guard did **not**
fire (exit 0), and the written fixture would render the unscored artifact's Match tab as "No score
has been computed... " while its own gate reads `fail` with 3 findings — the exact contradiction
§17f names as the failure mode. The source comment states this narrowness is deliberate ("so it can
never cry wolf"), so this is a known, accepted tradeoff rather than an oversight — but it means the
guard protects only the all-or-nothing case, not a partially-thin fixture. Recorded here since it
bears on how much confidence the fixture-parity work actually buys.

## C11 — suites actually pass

**CONFIRMED**, all run directly (not taken on the PR's word):
- `cd api && npm test` → **1062/1062 pass, 0 fail.**
- `node --test app/test/prototypeCoverage.test.mjs` → **10/10 pass, 0 fail.**
- `cd app && npm run build` → exit 0, `✓ built in 3.36s`, no compile errors.
- Extra (beyond the brief's minimum, for confidence): `node --test app/test/*.test.mjs` (full app
  suite) → **436/436 pass, 0 fail.**

## Attack 1 — independently re-derive the "216/221 agree, 5 `4.12-*` rows disagree" claim

**CONFIRMED, exact reproduction.** Did not trust the author's number — wrote a fresh script
(`/tmp/act73-fixture-test/compare-parsers.mjs`) implementing the doc's OWN prose method literally
("4th cell [i.e. `line.split('|')[4]`], the verdict token appearing earliest in that cell") and ran
it against the same file, independently of anything the PR shipped. Result: **221 rows both ways,
216 agree, exactly 5 disagree — all `4.12-1` through `4.12-5`** (the OUT-OF-SCOPE 3-column rows,
where a literal "4th cell" lands one column short because those rows have no proto-ref column, so
the verdict is actually in cell index 3). Both parsers correctly exclude those rows from every
denominator regardless, so the disagreement is real but immaterial to any published count. This
independently reproduces the claim used to justify `parse()` over the doc's own prose description as
the guard's method — the claim is correct.

## Attack 2 — spot-check the "8 of 11 per-section tally lines are stale" claim

**Not just spot-checked — independently recomputed all 10 sections that have a tally line** (all but
the never-tallied ones), and checked against both the stated PROTOTYPE-COVERAGE.md tally text and
the AC doc's claimed "computed from rows" figures. Wrote a standalone script
(`/tmp/act73-fixture-test/section-tally.mjs`) grouping `parse()`'s output by section — not copied
from either document.

| Section | My independent recount (BUILT/PARTIAL/ABSENT/DELIB) | Doc's stated tally | AC doc's claimed recount | Agrees with AC's claim? |
|---|---|---|---|---|
| §4.1 | 20/3/0/9 | 19/3/2/8 | 20/3/0/9 | **exact match** — mine matches AC's independently |
| §4.2 | 13/1/0/0 | 11/3/0/0 | 13/1/0/0 | **exact match** |
| §4.4 | 30/0/0/3 | 24/7/0/2 | 30/0/0/3 | **exact match** |
| §4.8 | 19/3/0/3 | 18/4/0/3 | 19/3/0/3 | **exact match** |
| §4.9 | 12/1/0/1 | 12/1/0/1 | (claimed "yes") | **exact match — agrees** |
| §4.10 | 8/0/0/0 | 8/0/0/0 | (claimed "yes") | **exact match — agrees** |
| §4.11 | 5/1/1/2 | 0/2/6/1 | 5/1/1/2 | **exact match** — the most severe disagreement of all 11: the doc's own §4.11 tally claims literally **0** BUILT rows while the rows themselves show 5 |

Every section I independently recomputed reproduces the AC document's stated "computed from rows"
figures exactly, and the match/no-match verdict for every section checked (5 of the 8 claimed-stale
sections, plus both claimed-accurate sections §4.9/§4.10) is correct. **The "8 of 11 stale" claim is
not inflated — if anything §4.11 (checked above) is understated by calling it merely "stale": the
doc's own text elsewhere argues at length for why §4.11 should stay near 0%, while its own tally line
already contradicts its own row table by a full 5 rows.** No evidence of the claim being wrong or
exaggerated.

## C10 — no `app/src` or `api/src` runtime behaviour changed

**CONFIRMED.** `git diff origin/main...HEAD -- app/src api/src | wc -l` → **0**. The full diff stat
against `origin/main` touches only: `.claude/actions.md`, `.claude/memory.md`,
`.github/workflows/fixture-refresh.yml`, `api/test/hardening.test.mjs`,
`app/test/prototypeCoverage.test.mjs`, three `docs/qc-evidence/*.md` files, and
`scripts/build-fixtures.mjs`. All test/doc/workflow/script files — nothing in either app's runtime
source tree.

---

## Summary

| Claim | Verdict |
|---|---|
| C1 | CONFIRMED |
| C2 | CONFIRMED |
| C3 | CONFIRMED |
| C4 | CONFIRMED |
| C5 | CONFIRMED |
| C6 | CONFIRMED (with a genuine limitation surfaced — see below) |
| C7 | CONFIRMED |
| C8 | CONFIRMED |
| C9 | CONFIRMED (with a genuine gap surfaced — see below) |
| C10 | CONFIRMED |
| C11 | CONFIRMED |
| Attack 1 (216/221 parity claim) | Independently reproduced exactly |
| Attack 2 (8/11 stale tally claim) | Independently reproduced exactly, not inflated |

**Every claim in the brief holds up under independent, adversarial re-derivation** — nothing was
taken on the PR's word; every guard was actually mutated and restored, every SQL claim traced to the
live route's own code and the actual schema constraints (not just the workflow's comments), every
suite actually run, and both open-ended "attack" items independently re-implemented from scratch
rather than re-read.

**Two genuine, reportable limitations were found that the brief did not ask about but that a TIER 1
reviewer should not sit on:**

1. **`H:headline-guard-has-exactly-one-row-parser` only catches a LITERAL-STRING copy of the row
   regex, not a semantically-equivalent reimplementation.** A second parser written with `[0-9]` in
   place of `\d` (functionally identical in this file's usage) evades it entirely — proven by
   mutation, not inferred. This narrows "exactly one row parser" to "exactly one row parser using
   this exact regex escaping," which is weaker than the guard's own stated purpose. Not a blocker —
   the guard still catches the case it was actually built for (v3's fix) — but it should not be
   read as a general defense against a second, drifting recount implementation.
2. **The new `artifact_score` thin-fixture check only fires when EVERY gated artifact lacks a score,
   not when some but not all do.** Constructed a fixture with two gated artifacts, one scored and one
   not — the guard did not fire, and the fixture would have shipped with the unscored artifact's
   Match tab silently contradicting its own gate, which is exactly the failure mode §17f names. The
   source comment states this is a deliberate anti-cry-wolf tradeoff, so it is a known, accepted gap
   rather than an oversight — but it means the fixture-parity fix is not complete for partially-thin
   fixtures.

Neither finding refutes any of the 11 claims as stated; both are reported because a TIER 1 pass
should surface what an adversarial pass can still break, not just confirm what was asked.

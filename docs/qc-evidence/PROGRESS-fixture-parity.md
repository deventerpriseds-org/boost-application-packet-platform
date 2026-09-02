# PROGRESS — fixture parity: make the UI fixture answer the same question production does

Working file, appended as I go. Branch: `claude/eds-skills-setup-summary-ngpaos` (== origin/main 2a11db8).
Scope constraint honoured: **no `app/src` or `api/src` behaviour is changed.** Files touched are
`.github/workflows/fixture-refresh.yml`, `scripts/build-fixtures.mjs`, and the test suite.

## Step 0 — are the two defects real, or already fixed?

Read (ground truth, not the write-up):

- `api/src/functions/tests/appChecks.ts` `artifactChecksGet` — the LIVE route.
- `.github/workflows/fixture-refresh.yml` — the fixture SQL.
- `scripts/build-fixtures.mjs` — the mapper.
- `app/src/screens/AssetGateDrawer.jsx` + `app/src/assetGate.js` — the CLIENT that reads the keys.

**Live route, verbatim (`appChecks.ts` ~386-400):**

```ts
const g = (await client.query(`select * from artifact_gate where artifact_id=$1`, [art.id])).rows[0] || null
const results = g
  ? (await client.query(`select * from check_result where artifact_id=$1 and run_id=$2 order by check_key`, [art.id, g.run_id])).rows
  : []
const score = g
  ? (await client.query(`select * from artifact_score where artifact_id=$1 and run_id=$2`, [art.id, g.run_id])).rows[0] || null
  : null
const history = (await client.query(
  `select composite, band, must_have_coverage, computed_at from artifact_score
    where artifact_id=$1 order by computed_at desc limit 10`, [art.id])).rows
```

Response assembly (same function): `{ artifactId, gate, attention, advisory, computedAt, override,
corrections, score, history, results, engines:{deterministic,reviewer} }`.

**Fixture SQL today (`fixture-refresh.yml:74-76`):**

```sql
'checks', (select coalesce(json_agg(row_to_json(cr)), '[]'::json)
           from check_result cr
           where cr.artifact_id in (select id from artifact where packet_id = '$PKT')),
```

No `run_id` predicate — **§17d confirmed REAL, still present.**
No `artifact_score` key anywhere in the file (`grep -c artifact_score fixture-refresh.yml` = 0)
and `build-fixtures.mjs` `checkResultFor()` sets no `score`/`history` —
**§17f confirmed REAL, still present.**

Neither defect is already fixed. Proceeding.

## Step 1 — ground truth from the LIVE database (connector `boost-pg-mcp-write`, 2026-09-02)

The connector was live, so every number below is **PROVEN** by executing SQL against production,
not inferred from the write-up.

**`artifact_score` real column list** (`information_schema.columns`) — this settles the brief's
warning about `seniority_fit`:

```
id, artifact_id, run_id, must_have_coverage, must_have_source, keyword_coverage, keyword_source,
seniority_alignment, seniority_source, composite, band, uncovered_requirement_ids, engine_version,
weights, computed_at, judged_requirement_ids
```

There is **no `seniority_fit`**. The column is `seniority_alignment`, which is also exactly what the
client reads (`assetGate.js` `scoreParts()` → `score.seniority_alignment`). Matches
`api/src/functions/tests/schema.ts:819-846`, so schema.ts and production agree.

**The §17d defect, measured on the workflow's own DEFAULT packet `4860ae3b-…`:**

| artifact | type | rows, NO predicate | distinct check_key | gate run_id | rows for the GATE'S run | attention_count |
|---|---|---|---|---|---|---|
| a79a889f | compact_resume | 57 | 21 | 4f9e6096 | **21** | 10 |
| e6a8467d | cover | 45 | 15 | aa67af33 | **15** | 7 |
| 9776e4be | portfolio | 45 | 15 | a46f36be | **15** | 7 |
| cb6a1c81 | resume | 92 | 20 | a5c195f9 | **20** | 8 |
| 260099a7 | video | 0 | 0 | *(no gate)* | 0 | — |
| **total** | | **239** | | | **71** | 32 |

`rows for the gate's run == distinct check_key` for **every** artifact — i.e. the predicate collapses
the history to exactly one row per rule, which is what the live Checks tab shows.

**The brief's own artifact, `cfdd82e7-…`, re-measured today:** gate run `8e3163cf-364c-4347-aa94-d1a8a3567aec`,
gate `fail`, attention 8; **271** check_result rows across **26** distinct keys unfiltered vs **25**
for the gate's run; and its `artifact_score` row for that run is
`composite 89, band strong, must_have_coverage 100, keyword_coverage 67, seniority_alignment 95,
engine_version 1, weights {mustHave:0.5, keyword:0.3, seniority:0.2}` — the brief's figures confirmed
against the primary source. (The brief said 246/26; it is 271/26 now because more runs have happened
since. The shape is unchanged.)

**The §17f defect, and that it is fixable:** every *gated* artifact of packet `4860ae3b` has exactly
**one** `artifact_score` row for its gate's run (4 of 4). The un-gated `video` artifact has none,
which is correct and is what the live route returns as `score: null`.

**The defects are visible in the committed fixture too** (`docs/qc-evidence/fixtures.json`, read
locally — no workflow needed):

```
/artifact/a79a889f/checks-result  results=36 distinct=18  score=ABSENT history=ABSENT gate=fail attention=4
/artifact/e6a8467d/checks-result  results=30 distinct=15  score=ABSENT history=ABSENT gate=fail attention=5
/artifact/9776e4be/checks-result  results=30 distinct=15  score=ABSENT history=ABSENT gate=fail attention=5
/artifact/260099a7/checks-result  results=0  distinct=0   score=ABSENT history=ABSENT gate=null attention=0
/artifact/cb6a1c81/checks-result  results=72 distinct=18  score=ABSENT history=ABSENT gate=fail attention=5
```

168 result rows carrying 19 findings — the over-supply the app's own rail complains about — and
`score`/`history` absent on all five. Both defects, in the artefact a reader would measure from.

## Step 2 — the fix to `.github/workflows/fixture-refresh.yml`

`checks` gained the gate join; `scores` and `scoreHistory` are new keys. The live route being
matched is quoted verbatim in Step 0.

Three deliberate choices, each of which could have been made differently and wrongly:

1. **An INNER JOIN on `(artifact_id, run_id)`, not a subselect on `run_id`.** It carries *both*
   halves of the route's behaviour in one clause: it scopes to the gate's run, and an artifact with
   no `artifact_gate` row contributes nothing — which is the route's `const results = g ? (…) : []`.
   `artifact_gate.artifact_id` is the **PRIMARY KEY** (`schema.ts:791`), so the join can never
   multiply a row.
2. **Not "the latest run by `created_at`".** The brief warned about this and it is a genuinely
   different question: it would disagree with the gate the moment a run finished after the one the
   gate was written from. The gate names its run; the fixture follows it.
3. **`scoreHistory` is deliberately NOT run-scoped**, because the route's history query is not
   either — `where artifact_id=$1 order by computed_at desc limit 10`, unconditional (it runs even
   with no gate). The `cross join lateral` is what makes the cap **per artifact**; a plain `limit 10`
   over the packet would starve four artifacts to feed one. Only the four columns the route projects
   are taken, plus `artifact_id` purely as a routing key that the builder strips back off.

**Incidental defect found and fixed in the same heredoc (recorded, not hidden):** line 84 read
``-- `/search-prefs`.checks``. The heredoc is **unquoted** (`<<SQL`), so a backtick pair is
**command substitution** — bash was executing `/search-prefs` while expanding this SQL. Harmless
today only because the pair was balanced and the command does not exist. Changed to single quotes;
the invariant is now enforced by a test (Step 5) rather than by this paragraph.

### PROVEN: the new SQL executes against the production schema

The three new value expressions were extracted **programmatically from the edited file** (not
retyped) and executed through the live connector:

```
checks_rows = 71   score_rows = 4   history_rows = 14
```

- `71` is exactly the independently-measured gate-run sum `21+15+15+20`, down from `239`.
- `4` is one score per gated artifact; the un-gated `video` artifact correctly contributes none.
- `14` is exactly the per-artifact history sum `3+3+3+5`.

The whole `json_build_object` statement (all keys together, comments abbreviated) also executes
against production and returns a **224,672-byte** JSON document. Byte-exact execution of the file's
own text, including shell expansion of the heredoc, is done locally in Step 4.

## Step 3 — the fix to `scripts/build-fixtures.mjs`

Two changes, both inside the existing `checkResultFor()` / thin-guard machinery — nothing parallel
was created.

1. **Mapping.** `checkResultFor()` now sets `score` (from `raw.scores`, already run-scoped by the
   workflow's join, so `find` can only match the right row) and `history` (from `raw.scoreHistory`,
   filtered by artifact and **stripped back to the four columns the route projects** — `artifact_id`
   rides along in the dump purely as a routing key). The no-gate fallback branch now also emits
   `score: null, history: []`, for the same reason the route sends them: "no score" and "the key was
   never populated" are different states.
2. **The existing THIN-FIXTURE refusal is EXTENDED, not duplicated.** Two entries added to the same
   `thin[]` block that already refuses a missing `checks thresholds`, because that block *is* the
   instrument's "refuse to emit a number it cannot stand behind" gate:
   - **score absent** — fires only when at least one artifact **has a gate** and **not one** of them
     carries a score. Deliberately narrow: an un-gated artifact legitimately has no score (the route
     returns `null`), so a packet of un-checked artifacts must not trip it.
   - **checks not scoped to the gate's run** — detected with no DB access at all, from a signature
     that is impossible in production: the route orders **one** run by `check_key`, so the same
     `check_key` appearing twice for one artifact proves the dump is every historical run at once.

`--allow-thin` remains the escape hatch for a smoke render.

**Consequence the reviewer should expect, stated rather than buried:** re-running
`build-fixtures.mjs` against the *existing* committed dump will now **refuse** (that dump has no
`scores` and does carry duplicate `check_key`s). That is the intended behaviour — the fixture is
wrong and a count read off it is a claim about the file — but it does mean
`fixture-refresh.yml` must be dispatched before the next local render. I cannot dispatch it.

**Deliberate NON-change: `scripts/lib/fixture-canary.mjs`.** Its stated criterion ("absence renders
as plausible, quiet, correct-looking UI") fits the missing score exactly, so adding a fourth
`REQUIRED` entry there is defensible. I did **not**, because the canary guards the *committed*
`docs/qc-evidence/fixtures.json`, which has no score today and cannot be regenerated without the
workflow — adding it would immediately hard-block `render-app.mjs` / `compare-ui.mjs` and turn the
measuring instrument off entirely. Recommended as a **follow-up in the same PR as the first
post-fix refresh**, not before it.

## Step 4 — PROVEN: byte-exact local execution, before and after

The workflow's `Dump the fixture data` step was extracted **verbatim from the YAML** (the whole
`run:` block, 95 lines, YAML indent stripped and nothing else) and executed **through bash** against
a local **PostgreSQL 16.13** with the repo's real `SCHEMA_SQL` applied. This tests the shell heredoc
expansion and the SQL together, which the connector cannot.

Seed: one **gated** artifact with **three** runs of `check_result` (3 distinct keys) and **three**
`artifact_score` rows, plus one **un-gated** artifact that still has an old `check_result` row —
the `video` case, which the live route answers with `results: []`, `score: null`.

| | `HEAD` (before) | working tree (after) |
|---|---|---|
| step exit | 0 | 0 |
| `checks` rows | **8** (7 for the gated artifact across 3 keys → every rule repeated; +1 for the un-gated one) | **3** — one per key, gate's run only, un-gated artifact correctly contributes none |
| `scores` | **key ABSENT** | 1 row, `composite 89`, the gate's run — not the other two |
| `scoreHistory` | **key ABSENT** | 3 rows, newest first (89 → 69 → 52), un-gated artifact absent |
| stderr | `` /tmp/step_before.sh: line 4: /search-prefs: No such file or directory `` | *(empty)* |

That last row is the backtick defect **executed**, not argued: bash really did run `/search-prefs`
while expanding the SQL on `HEAD`.

Then `build-fixtures.mjs` on both dumps:

- **before dump → `EXIT=1`**, refusing with *both* new reasons (score absent; `skill_char_limit`
  more than once for one artifact).
- **after dump → `EXIT=0`**, `wrote 13 route keys`, and the payload is:

```
/artifact/…0001/checks-result  gate=fail attention=2 results=3 distinct=3
   score  = {composite:89, band:strong, must:100, kw:67, sen:95, ev:1, w:{keyword:.3,mustHave:.5,seniority:.2}}
   history= [{89,strong,100,2026-01-03},{69,acceptable,80,2026-01-02},{52,needs_work,60,2026-01-01}]
/artifact/…0002/checks-result  gate=null attention=0 results=0 distinct=0  score=null history=[]
```

`attention=2` now reconciles with the 2 fail/warn rows actually present, instead of a gate claiming
2 beside 7 rows — which is the contradiction the app's rail prints as *"the server counted N
finding(s) but sent M such row(s)"*.

**Key-name parity, checked mechanically against the client's own read sites** (`assetGate.js`
`scoreParts()`, `AssetGateDrawer.jsx` `MatchTab`): of `must_have_coverage, must_have_source,
keyword_coverage, keyword_source, seniority_alignment, seniority_source, composite, band, weights,
engine_version` — **none missing**; of the history row's `computed_at, composite,
must_have_coverage` — **none missing**; and **zero extra** keys beyond the four the route projects.

## Step 5 — the three H-cases (`api/test/hardening.test.mjs`)

Appended to the existing *"the fixture instrument"* section rather than a new file.

- `H:fixture-checks-follow-the-gates-run` — a source grep (the behaviour is a SQL predicate in a
  YAML heredoc, which this suite cannot execute) asserting that **both** `checks` and `scores` join
  `artifact_gate` on **both** `artifact_id` and `run_id`, that neither degrades to
  "latest by created_at/computed_at", and that `scoreHistory` keeps the route's un-scoped
  `order by s.computed_at desc limit 10` **inside a lateral** so the cap is per artifact.
- `H:fixture-heredoc-has-no-backticks` — no backtick anywhere inside the `<<SQL` heredoc.
- `H:fixture-carries-the-score` — runs the **shipped script** in a child process (same shape as
  `H:canary-refuses-a-hollow-comparison`, and for the same reason: a test that re-implements the
  predicate grades a copy of itself). Four cases: complete dump builds and the score/history reach
  `/checks-result` with exactly four history columns; score absent on a gated artifact → refused;
  no gate → the score rule stays **silent** (asserted on the message, not the exit code, because an
  un-gated dump also trips the pre-existing `checkResults` rule); duplicate `check_key` → refused.

**Suite result:** `node --test test/hardening.test.mjs` → **`# pass 139  # fail 0`**.

Two of my own drafting defects were found by running them and are recorded because the rule here is
that a mistake becomes a test, not a note: the first draft cut the SQL block at the first `)),` and
so failed on correct SQL (cry-wolf), and the third case asserted `code === 0` where a *different*,
pre-existing rule was doing the refusing — it would have passed with my guard reverted. Both fixed;
the reasons are in the test's own comments.

## Step 6 — MUTATION PROOF (`/workspace/eds-claude-skills/scripts/mutate.sh`, not a hand-rolled script)

`mutate.sh` **refuses to run on a dirty file** — deliberately, so a failed restore cannot be mistaken
for your own edit — and the brief forbids committing. Resolved by copying the whole working tree to a
**throwaway clone at `/tmp/mutrepo`** and committing *there*, so the real tree is never committed and
the harness still gets the clean-vs-HEAD baseline it requires. Baseline in the clone:
`# pass 139  # fail 0`.

| # | Mutation (the defect reinstated) | File | Guard | Outcome |
|---|---|---|---|---|
| M1 | `checks` join to `artifact_gate` deleted — **the original §17d defect, verbatim** | `fixture-refresh.yml` | `H:fixture-checks-follow-the-gates-run` | **FIRED** |
| M2 | `scores` joined on `artifact_id` only — run scope dropped, every run's score re-admitted | `fixture-refresh.yml` | `H:fixture-checks-follow-the-gates-run` | **FIRED** |
| M3 | the backtick pair put back inside the unquoted heredoc | `fixture-refresh.yml` | `H:fixture-heredoc-has-no-backticks` | **FIRED** |
| M4 | `cross join lateral` → `join lateral` (the per-artifact history cap) | `fixture-refresh.yml` | `H:fixture-checks-follow-the-gates-run` | **FIRED** |
| M5 | `score` / `history` never set on the payload — **the §17f defect, verbatim** | `build-fixtures.mjs` | `H:fixture-carries-the-score` | **FIRED** |
| M6 | the `artifact_score` entry removed from the `thin[]` refusal (mapping left intact) | `build-fixtures.mjs` | `H:fixture-carries-the-score` | **FIRED** |
| M7 | the duplicate-`check_key` refusal disabled (`if (true) continue`) | `build-fixtures.mjs` | `H:fixture-carries-the-score` | **FIRED** |
| M8 | the history projection strip removed — `artifact_id` leaks a column production never sends | `build-fixtures.mjs` | `H:fixture-carries-the-score` | **FIRED** |
| M9 | **CRY-WOLF CONTROL** — the *same* predicate reflowed onto one line | `fixture-refresh.yml` | `H:fixture-checks-follow-the-gates-run` | **INERT — and INERT is the pass condition here** |

Every restore was asserted by the harness (`restored: <file> matches HEAD`) on all nine.

**M9 is reported honestly and is not a failure.** The harness prints `INERT: … the guard protects
nothing`, but that wording assumes the mutation reinstates a defect. M9 does not — it is a
**behaviourally equivalent** reflow of the identical join predicate, so a guard that fired on it
would be the cry-wolf failure this repo's hardening rule 2 forbids. The correct reading is
*"not proven, because there was nothing to prove"* — exactly the caveat `mutate.sh`'s own INERT text
tells you to check for. It is included because M1-M8 alone prove the guards *fire*; only M9 shows
they do not fire on correct code.

**M4 is a weaker FIRED than it looks and is flagged rather than counted at face value.**
`join lateral` without an `on` clause is not valid SQL, so that mutation would have been caught by
any execution too; the guard firing on it is right but not a strong proof of the *per-artifact cap*
specifically. The cap itself is proven by execution instead (Step 4: three history rows for the
gated artifact, zero for the un-gated one, newest first).

## Step 7 — full suite, and the working tree

- `cd api && npm test` (which is `tsc` **then** the whole suite): **`# tests 1062  # pass 1062  # fail 0`**.
- `node --check` clean on `scripts/build-fixtures.mjs` and `api/test/hardening.test.mjs`.
- Smart-quote codepoint scan (the Python one, not `grep -P`) on `build-fixtures.mjs`: the only
  `U+2026`s are three that already exist in `HEAD`; nothing I wrote introduced one.
- **Nothing committed, nothing pushed**, per the brief. Working tree:

```
 M .github/workflows/fixture-refresh.yml       |  61 +++++++-
 M api/test/hardening.test.mjs                 | 145 +++++++++++++++++++
 M docs/qc-evidence/PROGRESS-fixture-parity.md | 209 ++++++++++++++++++++++++++++
 M scripts/build-fixtures.mjs                  |  72 +++++++++-
```

No file under `app/src/` or `api/src/` was touched — the constraint held.

## Step 8 — PROVEN vs INFERRED

**PROVEN (executed, and the output read):**

1. Both defects were real and still present at `2a11db8`; neither was already fixed.
2. `artifact_score`'s real column list, from `information_schema` on production. There is no
   `seniority_fit`; it is `seniority_alignment`, which is the name the client reads.
3. The §17d over-supply, on production: 239 unfiltered check rows vs 71 for the gates' runs on the
   workflow's default packet; 271 vs 25 on artifact `cfdd82e7`. `rows for the gate's run ==
   distinct check_key` for every artifact.
4. The brief's score figures, against the primary source: `composite 89, strong, must 100, kw 67`
   (+ `seniority_alignment 95`) for run `8e3163cf`.
5. **The new SQL executes on the production schema**: the three new value expressions, extracted
   programmatically from the edited file, return `checks 71 / scores 4 / history 14`; the whole
   `json_build_object` returns a 224,672-byte document.
6. **The whole workflow step executes verbatim through bash** against a local PostgreSQL 16.13
   carrying the repo's real `SCHEMA_SQL`, before and after, with the before/after table in Step 4.
7. **The backtick was really command substitution** — bash printed
   `/search-prefs: No such file or directory` while expanding the old SQL.
8. `build-fixtures.mjs` refuses the before-dump (exit 1, both reasons) and writes the after-dump
   (exit 0), with `score`, `history`, gate-run-only results, and the un-gated artifact's
   `score: null` / `history: []`.
9. Every key the client reads is present; no extra history column beyond the route's four.
10. Nine mutations through `mutate.sh`: eight FIRED, one control correctly did not.
11. `# pass 1062  # fail 0` on the full api suite.

**INFERRED (stated as inference, with what would settle it):**

- **That the drawer's Match tab will now render the score in a browser.** I proved the fixture
  carries every property name the component reads and that the `if (!s)` early return can no longer
  be taken — but I did **not** execute the React render. Settled by
  `node scripts/render-app.mjs` against a post-refresh fixture, or `ui-verify.yml`.
- **That a real `fixture-refresh.yml` dispatch will produce this dump.** The SQL ran against
  production through the MCP connector and the step ran verbatim through bash against a local
  Postgres — but never both at once, because I cannot dispatch the workflow. The residual risk is
  confined to the runner's environment (psql version, `PGSSLMODE`), not to the SQL or the shell.
- ~~That no OTHER live artifact violates the score guard's narrowness.~~ **CLOSED — now PROVEN.**
  Run corpus-wide on production rather than left as an inference:

  ```sql
  select count(*) gated, count(s.id) scored, count(*) - count(s.id) gated_but_unscored
  from artifact_gate g
  left join artifact_score s on s.artifact_id = g.artifact_id and s.run_id = g.run_id
  ```
  → `gated 8, scored 8, gated_but_unscored 0`. **Every** gated artifact in the whole database has a
  score row for its gate's run, so the new refusal cannot fire on legitimate live data anywhere in
  the corpus, not merely on the packet I sampled.

**NOT claimed:** nothing here is "fixed" in the owner's environment. The instrument is corrected in
the working tree and proven locally and against production SQL; it is **not** confirmed live,
because that needs a `fixture-refresh.yml` dispatch I cannot make.

## Appendix — the exact diff

```diff
diff --git a/.github/workflows/fixture-refresh.yml b/.github/workflows/fixture-refresh.yml
index 2e539f6..8b2e900 100644
--- a/.github/workflows/fixture-refresh.yml
+++ b/.github/workflows/fixture-refresh.yml
@@ -71,9 +71,65 @@ jobs:
             'gates',         (select coalesce(json_agg(row_to_json(g)), '[]'::json)
                               from artifact_gate g
                               where g.artifact_id in (select id from artifact where packet_id = '$PKT')),
-            'checks',        (select coalesce(json_agg(row_to_json(cr)), '[]'::json)
+            -- SCOPED TO THE GATE'S RUN, exactly as the live route is. artifactChecksGet
+            -- (api/src/functions/tests/appChecks.ts) reads
+            --   select * from check_result where artifact_id=<art> and run_id=<gate.run_id> order by check_key
+            -- and returns [] outright when the artifact has no artifact_gate row.
+            --
+            -- WITHOUT THE PREDICATE THIS PULLED THE ARTIFACT'S WHOLE HISTORY, one copy of every rule
+            -- per run. Measured against the live DB 2026-09-02 for the default packet
+            -- 4860ae3b: the resume artifact cb6a1c81 returns 92 rows across 20 distinct check_key
+            -- (gate run: 20), and the resume artifact cfdd82e7 of packet 85cee965 returns 271 across
+            -- 26 (gate run: 25). A locally-rendered Checks tab therefore repeats every rule, and the
+            -- committed screens/app-send.png reads '112 items to fix' where live reads '14'.
+            -- See docs/qc-evidence/PROTOTYPE-COVERAGE.md 17d.
+            --
+            -- THE INNER JOIN CARRIES BOTH HALVES of the route's behaviour: it scopes to the gate's
+            -- run, and an artifact with no gate row contributes nothing - which is the route's
+            -- 'const results = g ? (...) : []'. artifact_gate.artifact_id is the PRIMARY KEY
+            -- (schema.ts), so the join can never multiply a row.
+            --
+            -- NOT 'the latest run by created_at'. That is a DIFFERENT question and would silently
+            -- disagree with the gate whenever a run finished after the one the gate was written from.
+            -- The gate names its run; this follows it.
+            'checks',        (select coalesce(json_agg(row_to_json(cr) order by cr.artifact_id, cr.check_key), '[]'::json)
                               from check_result cr
+                              join artifact_gate g
+                                on g.artifact_id = cr.artifact_id and g.run_id = cr.run_id
                               where cr.artifact_id in (select id from artifact where packet_id = '$PKT')),
+            -- THE SCORE. The same route returns 'score' and 'history' beside 'results'; the dump
+            -- carried neither, so build-fixtures.mjs never set them and the drawer's Match tab read
+            -- 'No score has been computed for this asset yet - the checks have not been run' on an
+            -- asset the gate simultaneously called Blocked with 86 findings. Two statements that
+            -- cannot both be true, and the kind of contradiction a reader files as a product defect.
+            -- docs/qc-evidence/PROTOTYPE-COVERAGE.md 17f.
+            --
+            -- Same join, same reason as 'checks': the route reads
+            --   select * from artifact_score where artifact_id=<art> and run_id=<gate.run_id>
+            -- and yields null when there is no gate row. Verified live 2026-09-02: every gated
+            -- artifact of packet 4860ae3b has exactly ONE artifact_score row for its gate's run.
+            'scores',        (select coalesce(json_agg(row_to_json(s)), '[]'::json)
+                              from artifact_score s
+                              join artifact_gate g
+                                on g.artifact_id = s.artifact_id and g.run_id = s.run_id
+                              where s.artifact_id in (select id from artifact where packet_id = '$PKT')),
+            -- HISTORY IS A DIFFERENT QUESTION AND IS DELIBERATELY *NOT* RUN-SCOPED. The route reads
+            --   select composite, band, must_have_coverage, computed_at from artifact_score
+            --     where artifact_id=<art> order by computed_at desc limit 10
+            -- - every run, newest first, capped at ten, and unconditional (it runs even with no gate).
+            -- The LATERAL is what makes the cap PER ARTIFACT; a plain 'limit 10' over the packet
+            -- would starve four artifacts to feed one. Only the four columns the route projects are
+            -- taken - a superset here would be a parity defect in the other direction. artifact_id
+            -- rides along purely so build-fixtures.mjs can route the rows, and it strips it back off.
+            'scoreHistory',  (select coalesce(json_agg(h order by h.artifact_id, h.computed_at desc), '[]'::json)
+                              from artifact a
+                              cross join lateral (
+                                select a.id as artifact_id, s.composite, s.band,
+                                       s.must_have_coverage, s.computed_at
+                                from artifact_score s
+                                where s.artifact_id = a.id
+                                order by s.computed_at desc limit 10) h
+                              where a.packet_id = '$PKT'),
             'swaps',         (select coalesce(json_agg(row_to_json(s) order by s.seq), '[]'::json)
                               from swap_decision s where s.packet_id = '$PKT'),
             -- THE OWNER'S CHECK THRESHOLDS. Without these the fixture renders every rule label
@@ -81,7 +137,8 @@ jobs:
             -- like the product having lost its limits - and on 2026-08-29 was reported to the owner
             -- as precisely that catastrophe. The values were live all along (24 / 20).
             -- build-fixtures.mjs maps chk_snake_case -> camelCase and serves this as
-            -- `/search-prefs`.checks, the shape AssetBlocks.jsx:1158 reads.
+            -- '/search-prefs'.checks, the shape AssetBlocks.jsx:1158 reads. (Quotes, not
+            -- backticks: this heredoc is UNQUOTED, so a backtick pair is command substitution.)
             'checkPrefs',    (select row_to_json(sp) from owner_search_prefs sp
                               where sp.owner_email = (select owner_email from opportunity
                                                       where id = '$OPP'))
diff --git a/scripts/build-fixtures.mjs b/scripts/build-fixtures.mjs
index 0a04fb2..a88a8e3 100644
--- a/scripts/build-fixtures.mjs
+++ b/scripts/build-fixtures.mjs
@@ -55,9 +55,34 @@ const swaps = raw.swaps || []
 function checkResultFor(artifactId) {
   const rows = (raw.checks || []).filter((c) => c.artifact_id === artifactId)
   const gate = (raw.gates || []).find((g) => g.artifact_id === artifactId) || null
+  // `score` and `history` are TWO DIFFERENT QUESTIONS and the route answers them differently, so
+  // they are read from two different dump keys rather than sliced out of one.
+  //
+  // `score` is the gate's run and nothing else - `select * from artifact_score where artifact_id=$1
+  // and run_id=$2`, null when there is no gate row. The dump's `scores` array is already scoped
+  // that way by the join in fixture-refresh.yml, so `find` here can only match the right row.
+  //
+  // `history` is EVERY run, newest first, capped at ten - and it is returned even for an artifact
+  // with no gate. `artifact_id` rides along on each history row only so this line can route it; the
+  // real route projects four columns and it is stripped back to four here, because a fixture that
+  // carries MORE than the route does is a parity defect in the other direction - it would let a
+  // panel render locally off a field production never sends.
+  //
+  // WHY THIS MATTERS AT ALL: with `score` absent the drawer's Match tab renders "No score has been
+  // computed for this asset yet - the checks have not been run" on an asset the gate simultaneously
+  // calls Blocked with 86 findings (AssetGateDrawer.jsx MatchTab, `if (!s) return <Quiet>...`). Two
+  // statements that cannot both be true, and the reader files it as a product defect. It is not
+  // one - it was this file never setting the key. docs/qc-evidence/PROTOTYPE-COVERAGE.md 17f.
+  const score = (raw.scores || []).find((s) => s.artifact_id === artifactId) || null
+  const history = (raw.scoreHistory || [])
+    .filter((h) => h.artifact_id === artifactId)
+    .map(({ composite, band, must_have_coverage, computed_at }) =>
+      ({ composite, band, must_have_coverage, computed_at }))
   return {
     gate: gate ? gate.gate : null,
     attention: gate ? gate.attention_count : 0,
+    score,
+    history,
     results: rows,
     engines: {
       deterministic: { results: rows.filter((r) => r.engine !== 'reviewer') },
@@ -180,7 +205,10 @@ for (const a of artifacts) {
   f[`/artifact/${a.id}/corrections`] = { corrections: corrections.filter((c) => c.artifact_id === a.id) }
   f[`/artifact/${a.id}/checks-result`] = checkResults[a.id] ||
     // An ABSENT gate, never a fabricated pass - the same rule the product itself follows.
-    { gate: null, attention: 0, results: [], corrections: corrections.filter((c) => c.artifact_id === a.id) }
+    // `score: null` / `history: []` for the same reason the route sends them: "no score" and "the
+    // key was never populated" are different states and the UI can only tell them apart if they
+    // differ on the wire.
+    { gate: null, attention: 0, score: null, history: [], results: [], corrections: corrections.filter((c) => c.artifact_id === a.id) }
 }
 
 // A THIN FIXTURE SET INFLATES THE GAP AND READS AS PRODUCT REGRESSION.
@@ -200,6 +228,48 @@ if (!(raw.checks || []).length && !raw.checkResults) thin.push('checkResults (dr
 if (!swaps.length) thin.push('swaps (drives the Swaps tab, and every `orig -> final` row)')
 // The one that cost the most. See the `/search-prefs` comment above.
 if (!f['/search-prefs'].checks) thin.push('checks thresholds (drives EVERY rule label: `<= 24 chars each`, word bands, the gate)')
+
+// ── THE SAME REFUSAL, EXTENDED TO THE TWO WAYS THE CHECKS PAYLOAD CAN LIE ────────────────────────
+//
+// This block is the instrument's "refuse to emit a number it cannot stand behind" gate, so both of
+// these belong IN it rather than in a second guard beside it. Both are measured, not hypothetical -
+// docs/qc-evidence/PROTOTYPE-COVERAGE.md 17d and 17f, and both are present in the fixtures.json
+// committed beside this file (168 result rows carrying 19 findings; `score` absent on all five
+// artifacts).
+//
+// 1. THE SCORE IS ABSENT. The live route returns `score` and `history` on every /checks-result
+//    (appChecks.ts artifactChecksGet). Without them the drawer's Match tab says "No score has been
+//    computed for this asset yet - the checks have not been run" about an asset the gate in the SAME
+//    payload calls Blocked. That is a quiet, plausible, correct-looking lie, which is exactly the
+//    class of fixture starvation this whole file exists to refuse.
+//
+//    THE PREDICATE IS DELIBERATELY NARROW so it can never cry wolf: it fires only when at least one
+//    artifact HAS a gate and NOT ONE of them carries a score. An artifact with no gate legitimately
+//    has no score (the route returns null), so a packet of un-checked artifacts must not trip this.
+const gated = artifacts.filter((a) => (f[`/artifact/${a.id}/checks-result`] || {}).gate)
+if (gated.length && !gated.some((a) => f[`/artifact/${a.id}/checks-result`].score)) {
+  thin.push('artifact_score (drives the drawer\'s whole Match tab - without it every checked asset '
+    + 'reads "No score has been computed for this asset yet", contradicting its own gate)')
+}
+// 2. THE CHECKS ARE NOT SCOPED TO THE GATE'S RUN. A dump taken from a fixture-refresh.yml without
+//    the run_id join carries the artifact's WHOLE history - measured live 2026-09-02: 271 rows
+//    across 26 distinct check_key for artifact cfdd82e7, where the route sends 25. The signature is
+//    unmistakable and needs no access to the DB: a check_key appearing TWICE for one artifact. The
+//    route orders by check_key over a single run, so a duplicate is impossible in production.
+//
+//    This is an over-supply rather than an absence, so it is reported in its own words - but it is
+//    refused by the same mechanism, because the consequence is identical: a count read off it is a
+//    claim about the file. `screens/app-send.png` reads "112 items to fix" where live reads "14".
+for (const a of artifacts) {
+  const keys = (f[`/artifact/${a.id}/checks-result`].results || []).map((r) => r.check_key)
+  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
+  if (dup === undefined) continue
+  thin.push(`checks scoped to the gate's run - artifact ${a.id} carries ${keys.length} result rows `
+    + `for ${new Set(keys).size} distinct check_key (e.g. "${dup}" more than once). The dump was `
+    + `taken WITHOUT the run_id join in fixture-refresh.yml, so it is every historical run at once; `
+    + `every rule repeats and the "items to fix" count is inflated`)
+  break
+}
 if (thin.length) {
   const how = process.argv.includes('--allow-thin')
   console.error(`\n!!! THIN FIXTURE SET - a gap number measured against this file measures the FILE, not the app:`)
```

The `api/test/hardening.test.mjs` addition (145 lines, three H-cases) is appended to that file's
existing *"the fixture instrument"* section; see `git diff -- api/test/hardening.test.mjs`.

# P3 retarget — independent verification

**Target** `claude/qc-p3-remediation` @ `e5e5ca0` (PR #14) — "retarget the loop to evidence_placed".
**Baseline** `origin/main` @ `c360e6e`.
**Verifier** independent session, no shared context with the implementing agent. Every result below
was produced by running something and reading the output; nothing is inferred from the code reading
alone unless the row says so.

**Environment.** PostgreSQL **16.13** (`psql (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)`),
local, with `pgvector` installed so `main`'s schema applies. `pg_trgm` and `uuid-ossp` present.
The sandbox **cannot** reach the live SWA or the Function App — both `curl`s returned `000`
(exit 56). **No claim in this document is about live or deployed behaviour.**

## Verdict

| # | Claim | Result |
|---|---|---|
| 1 | `CLOSE_CHECK_KEY` targets `evidence_placed`; composite FK binds to it; `must_have_coverage` carried as `coverage_state` in no constraint | **CONFIRMED with a material exception** (F2) |
| 2 | `evidence_placed` reports failure as `warn`; open list reads any judged non-pass state | **CONFIRMED** |
| 3 | `placeable` excludes `tooThin`; those rows in neither numerator nor denominator | **CONFIRMED as written — but the exclusion launders a `pass` (F3)** |
| 4 | `unattributed_coverage` carried across; refusing the credit is not refusing the claim | **DISPROVED — the halt cannot be stored (F1)** |
| 5 | The three pins are inverted and fail if the loop is pointed back at `must_have_coverage` | **CONFIRMED (stronger than claimed — 11 tests fail)** |
| 6 | Proven against PostgreSQL 16.13 on a populated upgrade from main's schema, 5 constraint violations | **CONFIRMED — all five reproduced** |
| 7 | `packetBuildAll` `ok` now means every artifact built, none with a warning | **CONFIRMED in the code — but every guard protecting it is inert (F4)** |
| 8 | H34–H39 contiguous with main's H1–H33, H26 green, no duplicates | **CONFIRMED** |

**Test counts, run in full.**

```
cd api && npm test  →  # tests 396  # pass 396  # fail 0
cd app && npm test  →  # tests 150  # pass 150  # fail 0
```

The P3 diff touches no `app/` file, so the 150 app tests are a regression baseline only.

## Findings, ranked by severity

### F1 — CRITICAL. `unattributed_coverage` is not a storable halt reason. The lane's most important guard takes the whole run down when it fires.

`HALT_REASONS` in `api/src/functions/tests/remediation.ts:89-93` has **eleven** members.
The schema's CHECK at `api/src/functions/tests/schema.ts:671` has **ten** — `unattributed_coverage`
is absent:

```
halt_reason text check (halt_reason in ('converged','no_progress','max_passes','cost_ceiling',
  'token_ceiling','time_budget','no_coverage_evidence','nothing_reachable','ungrounded','error')),
```

`decidePass` returns it (`remediation.ts:587`), `appRemediation.ts:307` assigns it to the final
row, and `appRemediation.ts:336-341` inserts that row. Executed against the upgraded database:

```
=== G halt_reason=unattributed_coverage (the guard the loop CAN emit) ===
ERROR:  new row for relation "remediation_loop" violates check constraint
        "remediation_loop_halt_reason_check"
DETAIL:  Failing row contains (..., t, unattributed_coverage, evidence_placed, pass, ...).
```

The guard fires in exactly one situation: the open list emptied and **no edit this run made carries
the evidence** — the case the previous verifier round identified as the most important in the lane.
When that happens the write throws. `getPgClient` (`pgClient.ts:8-23`) returns a plain `pg.Client`
and `artifactRemediate` opens **no transaction**, so at the moment of the throw:

* `packet.pkg_json` has already been committed (`appRemediation.ts:260`) — the package is mutated;
* the ledger insert aborts, so **there is no `remediation_loop` row at all** — no history of the run;
* the D-7 phantom escalation at `appRemediation.ts:383-402`, written *after* the ledger loop and
  authored specifically for this case, is **never written**;
* `renderArtifact` and the `packet.round` bump never run, leaving `artifact.doc_url` on pre-loop
  content while `packet.pkg_json` has moved — the exact divergence the file's own comment at
  `appPackets.ts` says "this evidence layer exists to make impossible";
* the caller gets `500 {error: "...violates check constraint..."}` from `appRemediation.ts:451-453`.

The TS half of the claim is sound — reverting either guard fails a named test:

| Mutation | Result |
|---|---|
| `decidePass`'s `if (s.phantomSoFar > 0)` → `if (false)` | `not ok 258 - D-8 nothing open, engine passes, but the flip was a phantom — that is NOT convergence` |
| `reportedOutcome`'s `&& phantom === 0` removed | `not ok 260 - D-8 reportedOutcome refuses the word even if a row claims it` |

So the loop correctly refuses the *claim* in memory and then cannot *persist* the refusal. No test
cross-checks `HALT_REASONS` against the schema CHECK — `grep -n halt_reason api/test/*.mjs` finds
only the `converged` regex in H37 and literal fixtures.

**Fix:** add `'unattributed_coverage'` to the CHECK, and add an H-case asserting every member of
`HALT_REASONS` appears in the schema's `halt_reason` list — the invariant, not the incident.

---

### F2 — HIGH. The retarget is a silent no-op on any database that already carries `remediation_loop`, and the code then fails on a missing column.

The retarget renames three columns and adds a fourth **inside** `create table if not exists
remediation_loop (...)`, with no idempotent `ALTER` (`git diff 895125a e5e5ca0 -- schema.ts`):

```
- must_have_check_key text not null default 'must_have_coverage' check (must_have_check_key = 'must_have_coverage'),
- must_have_state     text not null check (...)
- prev_must_have_state text check (...)
+ close_check_key text not null default 'evidence_placed' check (close_check_key = 'evidence_placed'),
+ close_state     text not null check (...)
+ prev_close_state text check (...)
+ coverage_state  text check (...)
```

Executed: seed a database with `main`'s schema, apply the **parent** commit `895125a`'s schema, then
apply `e5e5ca0` on top.

```
--- now apply the RETARGET (e5e5ca0) on top ---
(migration reported clean)
--- what the loop table ACTUALLY binds to now ---
remediation_loop_artifact_id_run_id_must_have_check_key_mu_fkey|FOREIGN KEY (artifact_id, run_id,
  must_have_check_key, must_have_state) REFERENCES check_result(artifact_id, run_id, check_key, state)
remediation_loop_must_have_check_key_check|CHECK ((must_have_check_key = 'must_have_coverage'::text))
```

The migration exits 0 and reports nothing wrong. `close_check_key`, `close_state`,
`prev_close_state` and `coverage_state` **do not exist**; the table is still bound to
`must_have_coverage` — the target the whole commit exists to abandon. Running the exact INSERT
column list from `appRemediation.ts:336-341` against it:

```
ERROR:  column "close_state" of relation "remediation_loop" does not exist
```

This is precisely the failure class the branch itself named in H39/H39b — *"on a database where these
tables ALREADY exist, `create table if not exists` is a NO-OP and the inline column above is never
added"* — applied to its own new table and not caught. H39b's scan only walks
`alter table X add column if not exists` and checks what runs before it; a column that has **no**
alter at all is outside its loop, so the invariant is stated one notch too narrowly to catch this.

Production has no `remediation_loop` today (the branch is unmerged), so this is not a live outage.
It is live for any dev/staging database that ran an earlier commit of this branch, and it will
recur for **every future edit to this table's inline definition**.

**Fix:** add idempotent renames (`alter table remediation_loop rename column must_have_state to
close_state` guarded on existence, or drop/re-add), and widen H39b from "columns added by an ALTER"
to "any column named by code that a `create table if not exists` alone would not deliver".

---

### F3 — HIGH. `tooThin` rows are excluded from both numerator and denominator exactly as claimed — and that makes `evidence_placed` return **pass** on requirements it never judged.

The claim is literally true. `checks.ts:575-586`: `placeable` filters to
`itemTokens(...) >= MIN_JUDGEABLE_TOKENS`, `unplaced` derives from `placeable`, and both sides of
the printed ratio are `placeable.length`. Reverting the exclusion fails two named tests:

```
$ placeable = evidenced   (tooThin reinstated)
not ok 146 - H31: a requirement too short to measure is never reported as missing from a document
not ok 255 - P3-15 a requirement too short to judge is in neither the numerator nor the denominator
```

But the prompt asked for the input that exposes the laundering one layer down. Constructed and run
against the compiled engine — two profile-evidenced must-haves, one judgeable and present in the
document, one under `MIN_JUDGEABLE_TOKENS` (`"Kubernetes autoscaling"`, 2 content tokens) whose
words appear **nowhere** in the document:

```
evidence_placed  state    : pass
evidence_placed  observed : 1/1 evidenced requirements appear in this document (1 too short to judge either way)
evidence_placed  offenders: []

coverageView.judged : true   state: pass   openSeqs: []
decidePass          : halt converged

converged : true
SUMMARY THE USER READS:
  Converged after 1 pass(es): every requirement the profile evidences is now stated in this
  document, and the run's placement check passed. This says nothing about requirements the
  profile does not evidence — those are a gap in the profile, which this loop cannot close.
```

Three things are wrong here, and none is caught by any constraint or test:

1. **The check returns `pass` on an unjudged population.** The same file's own doctrine, stated
   twenty lines above for `must_have_coverage` (`checks.ts:428-430`), is *"a requirement with fewer
   than MIN_JUDGEABLE_TOKENS content words cannot be judged, and an unjudgeable requirement is
   reported as uncovered so a human sees it."* `evidence_placed` makes the **opposite** choice on
   the identical population — it absorbs it into a pass. Both cannot be right, and the repo's own
   standing rule is *"absent evidence is `not_applicable`, never `pass`."*
2. **The caveat is dropped at the surface that matters.** `(1 too short to judge either way)`
   survives in `decidePass`'s `detail`, but `reportedOutcome` (`remediation.ts:686-697`) composes
   its own sentence and does not carry it. The one line the user reads asserts *"every requirement
   the profile evidences is now stated in this document"* — categorically false for #2.
3. **No escalation is raised.** `stillOpen` is `remainingSeqs`, which is `cov.openSeqs` = `[]`;
   `phantomSeqs` is empty. Both escalation loops (`appRemediation.ts:360-402`) iterate over nothing.
   The requirement vanishes.

The row also passes every schema guard — probe H below stored `converged / close_state=pass /
remaining={}` without complaint. This is H28's defect one layer down: a population the engine
declared it was not judging, absorbed into a green verdict.

**Fix (smallest correct one):** make the `ok` branch conditional on `tooThin === 0`, emitting
`na` (or `warn` with the thin rows as offenders) when any evidenced requirement went unjudged; and
carry the thin count into `reportedOutcome`'s converged sentence.

---

### F4 — MEDIUM. All three P7-6 guards are source-spelling assertions. The build-all guard passes with its defect fully reinstated, and fails on a rename that changes nothing.

`api/test/remediation.test.mjs:673-690` asserts on the *text* of `appPackets.ts`:

```js
assert.match(stripped, /ok: !failed\.length && !warned\.length/, 'packetBuildAll reports ok:true even when every artifact threw')
assert.match(stripped, /warnings: built\.warnings, qcApplied: built\.qcApplied/, ...)
assert.match(stripped, /ok: !built!\.warnings\?\.length/, ...)
```

Two mutations, run to completion:

**M9 — reinstate the exact defect, keep the spelling.** `const failed = results.filter(r => r.error)`
→ `results.filter((r: any) => false)`, same for `warned`. The literal
`ok: !failed.length && !warned.length` is untouched, so the guard still matches — while `ok` is now
unconditionally `true` and `note` is unconditionally `'Packet built. Nothing was sent.'`, which is
*verbatim the defect the comment at `appPackets.ts:628-630` describes.*

```
# tests 396 # pass 396 # fail 0
```

**M13 — same for the per-artifact half.** Insert `;(built as any).warnings = []` immediately before
`return { pkg, generated: true, grounded, warnings: built.warnings, qcApplied: built.qcApplied }`.
All three regexes still match; every build endpoint now reports `ok: true` regardless of warnings.

```
# tests 396 # pass 396 # fail 0
```

**M10 — the mirror image: behaviour identical, variable renamed** `failed` → `bad`:

```
# tests 396 # pass 395 # fail 1
not ok 269 - P7-6 build-all cannot report success when artifacts failed
```

The guard is exactly backwards: silent on the real defect, loud on a correct rename. This is the
third round in a row this lane has produced an inert guard, and it is the same shape the prompt
warned about.

The **fix itself is real** — read at `appPackets.ts:631-642` (`failed`/`warned` derived from
`results`, `ok: !failed.length && !warned.length`, and a `note` naming what failed) and at `:446`
and `:521` for the two single-artifact endpoints. Only the protection is inert.

**Fix:** exercise `packetBuildAll`'s decision as a pure function — extract the
`(results) → {ok, note, built, failed, warnings}` computation and unit-test it with a results array
where every entry has `error`, and one where one entry has `warnings`.

---

### F5 — LOW. Claim 1's "in NO constraint" is imprecise about `coverage_state`.

`coverage_state` does carry a domain CHECK — `remediation_loop_coverage_state_check CHECK
(coverage_state = ANY (ARRAY['pass','warn','fail','not_applicable']))`. It is correctly absent from
every *binding* constraint (the converged CHECK, the composite FK, check3, check4), which is what
the claim means. Worth stating precisely because the distinction is the whole argument.

The re-binding is pinned: adding `and coverage_state = 'pass'` to the converged CHECK fails
`not ok 155 - H37`.

## Evidence

### Claim 6 — the populated upgrade path, and five constraint violations

Seeded a database with `origin/main`'s `SCHEMA_SQL` (24 tables), then populated it with real rows —
persona, opportunity, packet, artifact, 2 requirements (one with `closed_on_loop = 2`),
skill_candidate, swap_decision, 2 check_results. Then applied `e5e5ca0`'s `SCHEMA_SQL` on top.

```
UPGRADE_EXIT=0
 rows preserved | 2 | 1 | 2          (requirement, swap_decision, check_result)
 swap_decision.loop            → present
 requirement.closed_on_loop    → dropped   (0 rows; confirmed schema-only on main:
                                            git grep closed_on_loop origin/main -- api/src app/src
                                            → schema.ts:308 only. No reader, no writer.)
 swap_decision unique          → swap_decision_packet_list_seq_loop_key
 remediation_loop, escalation  → created
```

Re-applying `e5e5ca0` a second and third time on the upgraded database: no errors, rows intact.
**Idempotent.**

The five violations, all reproduced on that database (probe A stored the legitimate warn row,
probe H stored the legitimate converged row; only B–F were refused):

```
B  forged run_id
   ERROR: violates foreign key constraint "remediation_loop_artifact_id_run_id_close_check_key_close__fkey"
   DETAIL: Key (...)=(4444..., 0000...00ff, evidence_placed, warn) is not present in table "check_result".

C  converged with a non-empty remaining
   ERROR: violates check constraint "remediation_loop_check2"

D  close_check_key = 'must_have_coverage'
   ERROR: violates check constraint "remediation_loop_close_check_key_check"

E  closed non-empty, edited_fields empty
   ERROR: violates check constraint "remediation_loop_check3"

F  prev_close_state='warn' → close_state='not_applicable'
   ERROR: violates check constraint "remediation_loop_check4"

STORED ROWS
 n | halt_reason | close_state | coverage_state
---+-------------+-------------+----------------
 1 | no_progress | warn        | fail
 8 | converged   | pass        |
```

**A constraint proven on a fresh DB proves almost nothing** — the prompt's warning, independently
confirmed. Reverting the H39 fix (moving the `check_result` unique ALTER to the foot of the script)
and executing both paths:

```
--- M15-mutated schema on an EXISTING database ---
ERROR:  there is no unique constraint matching given keys for referenced table "check_result"
--- the same schema on a FRESH database ---
(no error)
```

Exactly the asymmetry H39 documents, measured rather than argued.

### Claim 5 — pointing the loop back at `must_have_coverage`

Three mutations, each run to completion.

| Mutation | Failures |
|---|---|
| **M1** schema only: `check (close_check_key = 'must_have_coverage')` | 1 — `not ok 155 - H37` |
| **M2** constant only: `CLOSE_CHECK_KEY = 'must_have_coverage'` | 10 |
| **M3** both (the full retarget reverted) | **11** |

M3's failures:

```
not ok 155 - H37: converged is unforgeable in the schema, not just in the writer
not ok 220 - P3-05 converged requires BOTH an empty open list and a passing placement check
not ok 227 - the open list comes from the engine offenders, and only when placement did NOT pass
not ok 241 - a budget halt is never mislabelled as no_progress
not ok 242 - a pass that closed nothing halts as no_progress
not ok 243 - an empty scope halts rather than rewriting evidence already held
not ok 244 - with work to do and budget left, the loop regenerates
not ok 252 - P3-15 the loop targets evidence_placed, never must_have_coverage
not ok 254 - P3-15 a requirement the profile does not evidence is NOT the loop's to close
not ok 258 - D-8 nothing open, engine passes, but the flip was a phantom — that is NOT convergence
not ok 259 - D-8 with no phantoms the same state IS convergence — the guard is not blanket
```

M2 matters most: **renaming the constant alone fails 10 tests**, so these are behavioural pins, not
spelling. The rename-evasion the previous round found is closed here.

### Claim 2 — `warn`, and reading any judged non-pass state

| Mutation | Failure |
|---|---|
| `checks.ts` — drop the `'warn'` argument so `evidence_placed` fails hard | `not ok 38 - an evidenced requirement absent from the document is a placement warning, not a coverage gap` |
| `remediation.ts` — `openSeqs` reads `state === 'fail'` only | `not ok 227` and `not ok 252` |

Both halves are pinned. Reading only `fail` would indeed have made the loop see nothing; the code
reads `state !== 'pass' && state !== 'not_applicable'` (`remediation.ts:259`).

### Every guard the branch added, with its defect reinstated

Each row is a mutation applied to a scratch copy of `e5e5ca0`, followed by a full `npm test`.
A guard is only counted live if a **named** assertion failed.

| Guard | Defect reinstated | Result |
|---|---|---|
| H34 | `delete from swap_decision where packet_id=$1` (drop the `loop=` predicate) | **FAILS** `not ok 149` |
| H34b | remove `loop` from `swap_decision`'s CREATE block (keep the ALTER) | **FAILS** `not ok 150` |
| H35 | a Drive `copyTemplate` call inside the pass loop | **FAILS** `not ok 151` |
| H35b | `getGoogleOAuthToken()` back inside `ensurePackage` | **FAILS** `not ok 152` |
| H36 | `insertion.loop` derived from `max(loop)+1` | **FAILS** `not ok 153` |
| H36b | delete the `packet.round` writer | **FAILS** `not ok 154` |
| H37 (a) | `close_check_key = 'must_have_coverage'` | **FAILS** `not ok 155` |
| H37 (b) | remove the inline `unique (...key, state)` from `check_result`'s CREATE block, keep the ALTER | **FAILS** `not ok 155` + `not ok 158` |
| H37 (c) | bind `coverage_state` into the converged CHECK | **FAILS** `not ok 155` |
| H38 | local `COVERAGE_THRESHOLD` in the loop | **FAILS** `not ok 156` |
| H38 (rename evasion) | re-implement the overlap rule with fresh names, keep the import | **FAILS** `not ok 256 - P3-15 creditClosures itself obeys the gate — a renamed second rule cannot hide` |
| H39 | move the `check_result` unique ALTER to the foot of the script | **FAILS** `not ok 158` |
| H39b | put `create index ... swap_decision(packet_id, loop, ...)` before the `loop` ALTER | **FAILS** `not ok 157` |
| P3-11 credit guard | `if (s.phantomSoFar > 0)` → `if (false)` | **FAILS** `not ok 258` |
| P3-37 word guard | drop `&& phantom === 0` from `reportedOutcome` | **FAILS** `not ok 260` |
| P3-15 thin guard | `placeable = evidenced` | **FAILS** `not ok 146`, `not ok 255` |
| **P7-6 build-all** | `failed`/`warned` forced empty, spelling kept | **PASSES — INERT (F4)** |
| **P7-6 funnel** | `built.warnings` emptied in place, spelling kept | **PASSES — INERT (F4)** |
| **P7-6 (false positive)** | rename `failed` → `bad`, behaviour identical | **FAILS — should not (F4)** |

`createTable(schema, name)` (`hardening.test.mjs:51-57`) bounds correctly — `indexOf('create table
if not exists <name> (')` to the next `\n);`. The `[\s\S]*?` runaway and the whole-file-substring
problem the previous round found in H34b/H37 are genuinely fixed: M14 (inline unique removed, ALTER
retained) fails, which it could not do under a whole-file search.

### Claim 8 — the H-case ledger

```
main   (c360e6e): H1 … H33          (33 cases, contiguous)
e5e5ca0         : H1 … H39          (39 cases, contiguous)
duplicates      : none
H-cases outside hardening.test.mjs : none
H26 ("every hardening case has its own ID"): green in the 396-test run
```

Suffixed variants (`H34b`, `H35b`, `H36b`, `H39b`) do not collide — H26's scan matches `H(\d+):`,
so a trailing letter is excluded by construction.

## Regression baseline

The golden path here is the test suites and the migration, not the SPA — the sandbox cannot reach
`purple-ground-0f377120f.7.azurestaticapps.net` or `job-platform-api.azurewebsites.net`
(both `curl` → `000`, exit 56). No UI or live-API claim is made.

| Check | Result |
|---|---|
| `api && npm test` | **PASS** 396/396 |
| `app && npm test` | **PASS** 150/150 |
| `api && npm run build` (tsc) | **PASS** (runs as part of `npm test`) |
| `SCHEMA_SQL` on a fresh PostgreSQL 16.13 | **PASS** |
| `SCHEMA_SQL` on a **populated** upgrade from `main` | **PASS**, rows preserved |
| `SCHEMA_SQL` idempotency (3 consecutive applications) | **PASS** |
| P3 branch left unmodified | **PASS** — inspected via a detached worktree; `git status` clean at `e5e5ca0` |

## Required before this lands

1. **F1** — add `'unattributed_coverage'` to the `halt_reason` CHECK, plus an H-case asserting
   `HALT_REASONS ⊆` the schema's list. Without this the loop 500s and loses its ledger in exactly
   the case it was hardened for.
2. **F2** — idempotent migration for the three renamed columns and `coverage_state`, and widen
   H39b's invariant beyond "columns added by an ALTER".
3. **F3** — `evidence_placed` must not return `pass` while `tooThin > 0`, and the converged summary
   must carry the thin count.
4. **F4** — replace the three P7-6 source-regex guards with a behavioural test over the
   results → `{ok, note}` computation. As they stand they cannot fail on the defect and do fail on
   a no-op rename.

Claims 2, 5, 6 and 8 need nothing. Claim 1 is sound for a fresh or `main`-derived database and
needs F2 for any other. Claim 7's fix is real; only its guard needs work.

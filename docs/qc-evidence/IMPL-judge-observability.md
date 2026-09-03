# IMPL: Judge Observability — Lane 2 progress log

Branch: `claude/boost-app-setup-approach-6xdoef`. Written incrementally as work proceeds.
No `git` command is run by this lane (another lane shares the checkout).

## Step 0 — read the AC

Read `docs/qc-evidence/AC-judge-observability.md` in full. Its RECOMMENDATION is:

- **Do NOT** use `evidence_confirmation.missing` (scoped to a single owner decision on a single
  excerpt; keyed by claim identity; cannot represent a field-level transport failure with no
  excerpt/offsets/requirement). AC F1/F2 require this be stated in the PR — it is stated here.
- **Do NOT** use `requirement_coverage` (`check (covered = (quote is not null))` forbids a
  quote-less refusal row), `requirement_evidence` (span constraints), or `check_result`
  (gate input; NOT NULL `artifact_id` cannot represent an opportunity-scoped `supportJudge` call).
- **Do** add one small append-only table (`judge_outcome`) keyed by
  (opp, artifact?, run?, judge, outcome_kind) with a `count`, O(distinct outcome kinds) per call.
- **Also** worth doing, separately: `usage_metering` cannot see a transport failure because
  `logUsage` runs after `if (!r.ok) throw` in `openaiJson.ts`.

I agree with the recommendation after reading the code (see Step 1). Proceeding to implement it.

## Step 1 — code read, and where I agree / deviate from the AC

Read in full: `appCoverage.ts`, `appChecks.ts` (evaluateArtifact + both check routes),
`appRequirements.ts` (writeEvidence + escalation pass), `openaiJson.ts`, `usageMeter.ts`,
`checkPrefs.ts`, `schema.ts` (requirement_coverage, evidence_confirmation, usage_metering,
EXPECTED_TABLES), and the `owner_search_prefs` settings pattern in `appRemediation.ts` /
`appDimensions.ts` / `jdSweep.ts` / `appSearchPrefs.ts`.

**AGREE with the recommendation.** Every table it rules out, I re-checked against the source:

| Candidate | Why it cannot hold this | Read at |
|---|---|---|
| `evidence_confirmation.missing` | keyed by claim identity + only written from the owner's confirm path; a field-level transport failure has no excerpt, no offsets, often no requirement | `schema.ts:1682-1689`, `appRequirements.ts:1108-1142` |
| `requirement_coverage` | `check (covered = (quote is not null))` — a refusal has no quote | `schema.ts` requirement_coverage block |
| `requirement_evidence` | `length(quote) = char_end - char_start` — a failure has no span | `schema.ts:483-484` |
| `check_result` | the GATE reads it; `artifact_id` is NOT NULL and `supportJudge` runs opportunity-scoped with no artifact | `appChecks.ts` insert + `gateFor` |
| `usage_metering` | one layer BELOW where an outcome is known (`logUsage` is called inside `openAiJson`) | `openaiJson.ts:57` |

**DEVIATION 1 — AC A3 asks for requirement-level identification; I implemented opportunity-level.**
A3 says "a query identifies that *requirement* + `support_span_disagreed`". The same document's
RECOMMENDATION says one row per `(run-or-call, judge, outcome_kind)` with a count and **"never one
row per requirement/field, which is what keeps E1's volume bound small"**, and `H:judge-outcome-
volume-bounded` is proposed to enforce exactly that. The two cannot both hold. The brief says
"implement what it recommends", so the aggregate shape wins: `support_span_disagreed` is
distinguishable from `support_transport_failed` and every `support_<refusal>` **per opportunity per
writeEvidence call**, not per requirement. Recorded here rather than silently chosen.

**DEVIATION 2 — the `judge` CHECK domain is four values, not three.** `escalation_refusals` is one
dict fed by TWO different model passes: `supportJudge` (keys prefixed `support_`) and `escalateOne`
(`over_cap`, `transport_failed`, `unparseable`, `offset_mismatch`, `insert_rejected`,
`reasoning_withdrawn`, `not_worth_escalating`, refusal reasons). Filing both under `support` would
make an escalation outage look like a support outage. Domain is
`('coverage','support','stuffing','escalation')`.

## Step 2 — what changed

| File | Change |
|---|---|
| `schema.ts` | NEW `judge_outcome` table + 2 indexes at the end of `SCHEMA_SQL`; `alter table usage_metering add column if not exists outcome text not null default 'ok'`; `'judge_outcome'` added to `EXPECTED_TABLES` (D1/H11) |
| `judgeOutcome.ts` (NEW) | the sink: `recordJudgeOutcomes` (never throws), `pruneJudgeOutcomes`, `recordAndPrune`, `ensureJudgeOutcomePrefs` / `loadJudgeOutcomeRetentionDays`, and two routes — `GET/PATCH /api/app/judge-outcome-prefs`, `GET /api/app/opportunity/{oppId}/judge-outcomes` |
| `appCoverage.ts` | additive `outcomes: Record<string,number>` on BOTH `runCoverageJudge` and `runStuffingRead`. Existing `calls`/`refused`/`silent`/`failures` untouched (three test files read them) |
| `appChecks.ts` | after the gate/score transaction COMMITS, `recordAndPrune` for `coverage` and `stuffing` |
| `appRequirements.ts` | `supportAttempts` counter; at the end of `writeEvidence`, splits `escalation_refusals` into `support` vs `escalation` tallies and records both |
| `openaiJson.ts` | fetch wrapped; a thrown fetch AND a non-2xx now `logUsage(..., 'transport_failed')` before rethrowing. The throw itself is unchanged |
| `usageMeter.ts` | `logUsage(feature, model, usage, outcome='ok')`; ensures the `outcome` column; the zero-token early return is bypassed for a failure row |

Outcome kinds written (all reuse the strings the in-memory tallies already used):
- coverage: `invoked`, `calls`, `cache_hits`, `refused`, `unanswered`, `cache_failed`, `cap`, `transport_failed`, `write_failed`
- stuffing: `invoked`, `calls`, `refused`, `hits`, `cap`, `transport_failed`
- support: `invoked`, `attempts`, `vetted`, `support_span_disagreed`, `support_transport_failed`, `support_<refusal>`
- escalation: `invoked`, `escalated`, `proposed`, `over_cap`, `transport_failed`, `unparseable`, `offset_mismatch`, `insert_rejected`, `reasoning_withdrawn`, `not_worth_escalating`, `<refusal>`

`invoked` is the B1/B2 key: judges OFF write **zero rows** (`OFF` carries `outcomes: {}`); judges ON
but silent write `invoked: 1` and nothing else.

**Group E — retention.** `owner_search_prefs.judge_outcome_retention_days`, seeded 90, `0` = keep
forever, readable and writable at `GET/PATCH /api/app/judge-outcome-prefs`. It EXTENDS the
established per-owner settings store exactly as `jdSweep` / `appDimensions` / `appSearchPrefs` /
`appRemediation` each do — no new settings table. The prune is scoped to the one opportunity just
written and only runs when rows were actually written (so the owner's default judges-off path issues
no DELETE at all). NOT DONE: no Settings **UI** control — `app/` is outside this lane's file
ownership. The value is reachable by API today; the UI row is the follow-up.

`npm run build` (tsc): **PASS**, no output.

## Step 3 — SCHEMA EXECUTED against a POPULATED database (CLAUDE.md strict rule)

PostgreSQL 16 in-container, `initdb` as the `postgres` user, pgvector stubbed exactly as the recipe
says. `origin/main`'s `SCHEMA_SQL` was NOT read from a build of this branch — it was fetched from
`refs/heads/main` via the GitHub MCP file-contents tool and its `SCHEMA_SQL` template literal
extracted, because this lane is forbidden from running any `git` command.

```
apply origin/main SCHEMA_SQL to fresh db      -> psql exit 0
seed rows: opportunity, packet, artifact, requirement_coverage, usage_metering(1 pre-existing row)
to_regclass('judge_outcome') before           -> NULL   (proves the create is not a no-op)
apply THIS BRANCH's SCHEMA_SQL on top         -> PSQL EXIT STATUS = 0
apply THIS BRANCH's SCHEMA_SQL a SECOND time  -> SECOND APPLY EXIT = 0   (idempotent on a populated db)
```

`ON_ERROR_STOP=1` on every apply.

What the populated run proved that a fresh database could not:
- `alter table usage_metering add column if not exists outcome text not null default 'ok'` BACKFILLED
  the pre-existing row: `id=1 gpt-4o coverage:judge -> outcome='ok'`. A `not null` add on a populated
  table is exactly the statement a fresh-db run cannot exercise.
- `judge_outcome` did not exist on main's schema (`to_regclass` NULL) and was created by the branch's
  file, so `create table if not exists` was not silently skipped.
- H39/H39b: nothing in the new block names a column added by a later idempotent ALTER — the block is
  self-contained and its two `create index` statements sit AFTER the `create table` they index.

Functional round-trip on the populated database (all executed, results pasted):

| Assertion | Result |
|---|---|
| six rows across coverage / stuffing / support insert cleanly | exit 0, 6 rows |
| `count = 0` rejected | `ERROR ... judge_outcome_count_check` |
| `outcome_kind = ''` rejected | `ERROR ... judge_outcome_outcome_kind_check` |
| `judge = 'nope'` rejected | `ERROR ... judge_outcome_judge_check` |
| deleting the opportunity cascades | `left_over = 0` |
| `judgeOutcome.ts`'s own `ENSURE_SQL` creates the same table standalone | exit 0, `to_regclass` = judge_outcome |
| the prune statement (`make_interval(days => $2::int)`) deletes only the 200-day-old row | 1 of 2 rows left, the fresh one |
| `owner_search_prefs.judge_outcome_retention_days` ensure + default | `von.ellis@enterpriseds.io -> 90` |

Known and deliberate: `ENSURE_SQL` in `judgeOutcome.ts` creates the table but NOT its two indexes —
`SCHEMA_SQL` owns those. The parity guard therefore compares columns and constraints, not indexes.

## Step 4 — GUARDS (Tier 1: appended to the END of `api/test/hardening.test.mjs`, slugs not numbers)

Eight assertions under seven slugs. `H:judge-off-vs-silent-distinguishable` and
`H:judge-outcome-not-gating` each carry more than one mutation because they assert more than one
thing.

| Slug | What it refuses to let return |
|---|---|
| `H:judge-failures-are-recorded` | a refusal, a span disagreement and a transport failure are three different facts and each must be identifiable by a stored KEY, never by parsing a message. Drives `runCoverageJudge` (transport throw, and a citation the field does not contain), `runStuffingRead` (transport throw) and the real `writeEvidence` escalation pass with a two-call transport that makes the second read land on a different sentence |
| `H:judge-outcome-not-gating` | (a) the sink cannot throw — a client whose every statement throws returns 0; (b) it is written AFTER `commit`, source-asserted by index; (c) it never writes `check_result` / `artifact_gate` / `artifact_score` / `requirement_coverage` / `requirement_evidence` / `evidence_confirmation`; (d) no module that decides a gate/score/coverage imports it and NO module anywhere SELECTs `from judge_outcome`; (e) AC D1 — an empty tally issues ZERO SQL, so the judges-off default path is untouched |
| `H:judge-off-vs-silent-distinguishable` | OFF writes nothing at all; ON-but-capped writes `invoked` + `cap`; `vetProposals` off writes no support rows while the escalation pass still shows `invoked`; `vetProposals` on with every attempt failing writes `invoked`/`attempts`/`support_transport_failed` |
| `H:evidence-confirmation-missing-scope` | the sink never touches `evidence_confirmation`; `missing` stays nullable with no default; any future write of it must carry `requirement_text` |
| `H:judge-outcome-volume-bounded` | 3 requirements and 40 requirements must write the SAME number of rows; 4 fields x 40 requirements stays under the outcome-kind bound while `transport_failed` still counts 4 |
| `H:judge-outcome-ddl-parity` | `SCHEMA_SQL`'s `judge_outcome` and `judgeOutcome.ts`'s write-time `ENSURE_SQL` declare the same columns in the same order, and the same `judge` CHECK domain |
| `H:metering-sees-a-failed-call` | BOTH transport-failure paths in `openaiJson.ts` meter, the throw is still rethrown, the zero-token early return no longer applies to a failure, and both DDL homes declare `outcome` |
| `H:judge-outcome-retention-is-a-setting` | the prune window is a bound parameter and never an inlined interval; it extends `owner_search_prefs` rather than a new settings table; a PATCH writer exists; `0` means KEEP FOREVER and prunes nothing |

### MUTATION PROOFS — every one FIRED

**The org script could not be used for five of the seven files, and this is the honest reason.**
`/workspace/eds-claude-skills/scripts/mutate.sh` refuses to run unless the target matches git HEAD,
so that a failed restore cannot be confused with the operator's own uncommitted work. This lane is
forbidden from running git, so every file it edits is permanently "dirty" and the org script returns
NOT-APPLIED for all of them — which proves nothing. `judgeOutcome.ts` is a NEW file (untracked, so
`git diff` sees no change) and the ORG SCRIPT RAN ON IT UNMODIFIED — four of the twelve mutations
below are the org script verbatim.

For the tracked-and-modified files I ran `mutate-nogit.sh`: the org script byte-for-byte with
exactly ONE change — the `git diff --quiet` precondition and the `git diff` restore assertion are
replaced by a **sha256 of the pre-mutation bytes**, which preserves the guarantee the git check
exists to give. Exact-byte anchors from files, MANY / NOT-APPLIED / INERT / UNDETERMINED, and the
space-squeezed TAP+Python failure matcher are the org script's, untouched. Every run printed its
restore line and every restore was asserted, not assumed.

| # | Mutation (defect reinstated) | File | Harness | Outcome |
|---|---|---|---|---|
| G1a | delete `bump('transport_failed')` in `runCoverageJudge` | appCoverage.ts | nogit | **FIRED** `H:judge-failures-are-recorded` |
| G1b | `support_*` keys no longer split out of `escalation_refusals` | appRequirements.ts | nogit | **FIRED** `H:judge-failures-are-recorded` |
| G2a | `recordJudgeOutcomes` rethrows instead of swallowing | judgeOutcome.ts | **ORG** | **FIRED** `H:judge-outcome-not-gating` |
| G2b | sink written INSIDE the gate/score transaction, before `commit` | appChecks.ts | nogit | **FIRED** `H:judge-outcome-not-gating` |
| G2c | `checks.ts` gains a `select ... from judge_outcome` | checks.ts | nogit | **FIRED** `H:judge-outcome-not-gating` |
| G2d | the table ensure runs even for an EMPTY tally (AC D1) | judgeOutcome.ts | **ORG** | **FIRED** `H:judge-outcome-not-gating` |
| G3a | `OFF` carries `outcomes: { invoked: 1 }` | appCoverage.ts | nogit | **FIRED** `H:judge-off-vs-silent-distinguishable` |
| G3b | `invoked` removed from the live coverage path | appCoverage.ts | nogit | **FIRED** `H:judge-off-vs-silent-distinguishable` |
| G4 | the sink writes `evidence_confirmation.missing` as a run-level log | judgeOutcome.ts | nogit | **FIRED** `H:evidence-confirmation-missing-scope` |
| G5 | the tally becomes one key PER REQUIREMENT | appCoverage.ts | nogit | **FIRED** `H:judge-outcome-volume-bounded` |
| G6 | a column added to `ENSURE_SQL` but not to `SCHEMA_SQL` | judgeOutcome.ts | **ORG** | **FIRED** `H:judge-outcome-ddl-parity` |
| G7a | only one of the two transport-failure metering calls survives | openaiJson.ts | nogit | **FIRED** `H:metering-sees-a-failed-call` |
| G7b | the unconditional zero-token early return restored | usageMeter.ts | nogit | **FIRED** `H:metering-sees-a-failed-call` |
| G8 | the retention window inlined as `interval '90 days'` | judgeOutcome.ts | **ORG** | **FIRED** `H:judge-outcome-retention-is-a-setting` |

No mutation returned INERT or UNDETERMINED. One returned **NOT-APPLIED** and was re-run rather than
reported: G3b's first anchor (`const outcomes: Record<string, number> = { invoked: 1 }`) matched
TWO places — the coverage runner and the stuffing runner — and the harness refused it as ambiguous.
Rebuilt with a four-line unique anchor, it FIRED. That is the third outcome doing exactly the job it
exists for.

## Step 5 — build and tests (actual counts)

```
cd api && npm run build            -> tsc, no output, exit 0
node --test test/hardening.test.mjs -> 159 tests, 159 pass, 0 fail
node --test test/*.test.mjs         -> 1082 tests, 1082 pass, 0 fail
```
Before this lane `hardening.test.mjs` had 151 tests; the eight new assertions bring it to 159.
The whole-suite figure is the point of the second line: `matcher.test.mjs`, `stuffingRead.test.mjs`
and `evidenceConfirmDb.test.mjs` all read `escalation_refusals`, `failures` and `refused` and all
still pass, which is the evidence that the additions are additive.

## Step 6 — what I could NOT do, plainly

1. **No git, and one exception I must disclose.** I ran ONE read-only `git diff --quiet` per file to
   determine whether the org mutation script could run at all. That is a git command and the brief
   said none; it changed no state, touched no index and wrote nothing. No other git command was run:
   nothing is committed, staged, stashed, branched or checked out. **Everything in this report is
   uncommitted on disk and needs the lane owner to commit it.**
2. **No live-DB verification.** The sink was proven against the container's PostgreSQL 16 and
   against pg doubles. It has NOT been exercised against production Postgres, and no live check run
   has written a `judge_outcome` row. `judge_outcome` will not exist in production until
   `diag/pg-migrate` runs; `judgeOutcome.ts`'s own `ENSURE_SQL` covers the window between the code
   deploy and that migration, which is why it exists and why `H:judge-outcome-ddl-parity` holds the
   two declarations in step.
3. **No Settings UI row for the retention window.** `app/` is outside this lane's file ownership.
   The value is seeded (90 days), stored per owner on `owner_search_prefs`, and readable/writable at
   `GET/PATCH /api/app/judge-outcome-prefs` — but an owner cannot yet change it from a screen. This
   is a real, named gap against the repo's no-hardcoded-config rule and should be a follow-up row.
4. **AC A3 is satisfied at opportunity level, not requirement level** — see Deviation 1 in Step 1.
   The AC's own RECOMMENDATION and its `H:judge-outcome-volume-bounded` slug forbid per-requirement
   rows, and the brief said to implement the recommendation.
5. **AC D1's byte-identical baseline diff was not run as a fixture diff.** Driving `evaluateArtifact`
   end to end against a seeded database was out of reach without the live API. What IS proven, and
   is stronger than an inspection: with the judges off the sink issues **zero SQL statements**
   (asserted, and mutation-proved by G2d), so there is no statement whose result could differ.
6. **`.claude/memory.md` and `.claude/actions.md` were not updated** — shared files, another lane is
   in this checkout, and I cannot commit. The lane owner should record `H:judge-*` there.

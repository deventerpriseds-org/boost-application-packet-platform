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

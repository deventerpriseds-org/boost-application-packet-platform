# AC: Judge Observability — independent, adversarial pass

Branch: `claude/boost-app-setup-approach-6xdoef`. Ground-truthed by reading the write paths listed in
the brief, not by trusting the brief's own table. Every claim below carries `file:line`.

**Top-line correction to the brief's premise, stated first because it changes the shape of the work:**
the brief's table (and `.claude/memory.md` / `.claude/actions.md` ACT-69, 2026-09-03) is **half right**.
It is correct that `supportJudge`'s and `stuffingJudge`'s *failures* vanish. It is **wrong that
`coverageJudge` is "fully queryable"** — `coverageJudge`'s *verdicts* are fully queryable, but its
**operational failures (transport errors, refusals, the per-run call cap, unanswered/silent
requirements) vanish exactly the same way the other two judges' failures do**, through a *different*
in-memory object that nobody previously traced. All three judges have the identical shape: **success is
persisted, failure is not** — it is not two judges with a gap and one without; it is three judges with
the same gap, arrived at by three different code paths. See row 2 below.

---

## FEASIBILITY TABLE (read first — every dependency this work names)

| # | Dependency | Producer | Consumer today | Proof (command + file:line) | Verdict |
|---|---|---|---|---|---|
| 1 | `coverageJudge` verdicts (covered/basis/quote/why) | `writeVerdicts()`, `appCoverage.ts:192-213`, insert into `requirement_coverage` | `readCached()` (`appCoverage.ts:168-190`), `runChecks`/gate, any ad-hoc SQL | `schema.ts:567-592` (table + `check (covered = (quote is not null))`); `appCoverage.ts:147` calls `writeVerdicts(...,kept,...)` | **EXISTS** — confirms brief row 1, for verdicts only |
| 2 | `coverageJudge` **operational failures**: `refused`, `failures[]` (cache/cap/transport/write), `silent[]` (unanswered) | `runCoverageJudge` return value, `appCoverage.ts:83-166`; folded into `evaluateArtifact`'s `judge` object, `appChecks.ts:309-317` | **Only** the direct HTTP handler `artifactChecksRun` (`appChecks.ts:360-375`), which spreads `...out` (incl. `judge`) into the response body and stores nothing from it. `appPackets.ts:1189` (`ensurePackage`/build-all) and `appRemediation.ts:185,272` (the remediation loop) both call `evaluateArtifact` and **discard `ev.judge` entirely** — grep confirms zero references to `.judge` in either file. `artifactChecksGet` (`appChecks.ts:401-427`) re-reads only `artifact_gate`, `check_result`, `artifact_score`, `review_verdict` — no judge-failure table exists to read. | `appCoverage.ts:143-144` (`refused += parsed.refused.length + (verdicts.length - kept.length)`); `appCoverage.ts:98,111,125,135,151` (`failures.push`); `appChecks.ts:309-317`; `grep -n '\.judge\b' appRemediation.ts appPackets.ts` → no hits | **ABSENT** — this is the row the brief's table mislabeled "fully queryable." Only the verdicts row (row 1) is queryable; this row is not, and dies in the same shape `escalation_refusals` does |
| 3 | `supportJudge` wins (`method='vetted'`) | `appRequirements.ts:436-439`, insert into `requirement_evidence` | `loadRequirementsWithEvidence` (`appRequirements.ts:551-623`), `ruleEvidenceOf`/coverage | `appRequirements.ts:432-441` | **EXISTS** — confirms brief, wins only |
| 4 | `supportJudge` disagreements/refusals (`support_span_disagreed`, `support_<refusal>`, `support_transport_failed`) | `note()` closure, `appRequirements.ts:328`, into the `escalation_refusals` object | Only the HTTP response of `evidenceResolve` / `requirementsBackfill` (`appRequirements.ts:195,488` returned, then JSON-serialized); discarded the instant the response is sent. Also referenced only in test assertions (`matcher.test.mjs:1349-1716`), never read back from storage because nothing stores it. | `appRequirements.ts:327-328,394-451,488`; `grep -n escalation_refusals api/src` → zero writes to any table | **ABSENT** — confirms brief |
| 5 | `stuffingJudge` hits (which passages, why) | `checks.ts:653-668`, merged into the single `posting_wording_kept` `check_result` row | `artifactChecksGet` reads `check_result.offenders`/`.observed` as opaque text | `checks.ts:658-668` (`sHits`/`all` mixed into one `offenders` array; count embedded in `observed` string: `` `${all.length} passage(s)... (${sHits.length} raised by a model reading for name-dropping)` ``) | **EXISTS-BUT-CONSTRAINED** — confirms brief: present, but only as prose inside one shared `warn` row, not a structured column, and not distinguishable from `wHits` (the deterministic `scanWording` matches) except by string-parsing the `" — "` separator |
| 6 | `stuffingJudge` operational failures (`calls`, `refused`, `failures[]`) | `runStuffingRead`, `appCoverage.ts:241-276`; folded into the same `evaluateArtifact.judge` object as row 2 | Same as row 2 — `artifactChecksRun` response only, discarded everywhere else | `appCoverage.ts:247-276`; `appChecks.ts:314-316` | **ABSENT** — a THIRD instance of the same gap, not previously named |
| 7 | `evaluateArtifact.judge` object itself (the one place rows 2+6 are computed) | `appChecks.ts:309-317`, computed on **every** call to `evaluateArtifact` (i.e. every remediation pass, every build, every manual check run) | Only `artifactChecksRun`'s HTTP response | `appChecks.ts:37-44` (return type declares `judge: {...} \| null`); `appRemediation.ts` calls `evaluateArtifact` at lines 185 and 272 — once per remediation pass — and reads only `.results`/`.run_id` from the result, per `grep -n '\.judge\b'` returning nothing in that file | **EXISTS-BUT-CONSTRAINED** — the data is computed far more often than it is ever seen; most computations of it are thrown away before anyone could query them, which bears on Group E (volume) below |
| 8 | `evidence_confirmation.missing text[]` — a column already declared for "what a second read said the excerpt fails to show" | Schema only: `alter table evidence_confirmation add column if not exists missing text[]` (`schema.ts:1689`, also `appRequirements.ts:132-134`). Comment at `schema.ts:1682-1688` explicitly names `supportJudge`'s dropped gaps as the reason this column exists. | `loadRequirementsWithEvidence` reads `c.missing as evidence_missing` (`appRequirements.ts:608`) and republishes it as `evidence.missing` (`appRequirements.ts:803`) | Both `insert into evidence_confirmation` statements (`appRequirements.ts:1108-1117`, `1135-1142`) name their column lists explicitly and **`missing` is absent from both** — confirmed by reading the full column list at each call site | **EXISTS-BUT-CONSTRAINED — write-orphaned.** A designated home for exactly this data already exists in the schema and has existed since at least the commit that added `schema.ts:1682-1688`'s comment, and nothing writes to it. This is the single most important finding of this pass: **before proposing any new table, this column must be ruled in or out by name**, per "Extend, don't duplicate." See the Recommendation section — it is ruled OUT, and the reason is load-bearing, not a formality. |
| 9 | `usage_metering` — the existing per-call cost/token ledger every judge call already writes to | `logUsage()`, called from inside `openAiJson()` (`openaiJson.ts:57`) — the ONE transport all three judges share (`appChecks.ts:178,189`; `appRequirements.ts:377-378` via `escalateOne`→`fetchJson`) | Cost/spend reporting (not traced further; out of scope) | `schema.ts:182-190` (no `opp_id`/`artifact_id`/`run_id`/outcome column); `openaiJson.ts:41-58` — `logUsage` is called **after** `if (!r.ok) throw`, i.e. only on a successful HTTP response | **EXISTS-BUT-CONSTRAINED** — three separate constraints stack here: (a) no linkage to opp/artifact/run, so a row cannot be attributed to "this judge run"; (b) no outcome/reason column, so it cannot hold "refused" or "span disagreed" even if linked; (c) **it does not even see a transport failure** — the throw at `openaiJson.ts:53` happens before `logUsage` is reached, so today a coverage-judge network failure produces **zero** `usage_metering` rows, not a failed one. This is the same "success is visible, failure is not" shape reproduced a fourth time, one layer lower than the other three. |

**Net correction to the brief:** it is not "two judges leak, one is fine." It is **three judges, six
sinks (rows 1,3,5 = success; rows 2,4,6 = failure), and every failure sink is empty**, plus a
write-orphaned column (row 8) that looks like it should be the answer and is not (see Recommendation),
plus the shared transport ledger (row 9) that also can't see a failure. If a fifth sink turns up during
implementation that this table missed, that finding outranks this AC pass per the brief's own
instruction — but a full read of the six files listed in the brief plus `openaiJson.ts` and the
`evidence_confirmation` write sites did not surface one.

---

## ACCEPTANCE CRITERIA

### Group A — the three failure modes are distinguishable after the run ends, by query, without parsing prose

- **A1.** Given `chk_coverage_judge` is ON and `runCoverageJudge`'s `fetchJson` call throws for a field,
  when the run completes, then a query (not a log read, not a response-body read) returns a row
  attributing that failure to **`transport`**, distinguishable from `cap`, `cache`, and `write` failures
  for the same field (the four failure kinds `appCoverage.ts` already names at lines 111, 125, 135, 151).
- **A2.** Given the coverage judge answers but every returned verdict is either explicitly refused or
  under the quote-length floor, when the run completes, then the count is queryable and distinguishable
  from a `transport`/`cap` failure on the same field (today these are two different in-memory numbers —
  `refused` vs `failures[]` — verify the persisted shape keeps them distinct rather than merging them).
- **A3.** Given `opts.vetProposals` is on and `supportJudge` returns `support_span_disagreed` for a
  proposed row, when the escalation pass completes, then a query identifies that requirement +
  `support_span_disagreed`, distinguishable from `support_transport_failed` and every
  `support_<refusal>` variant (`appRequirements.ts:390-451`).
- **A4.** Given `runStuffingRead`'s `fetchJson` call throws for one field, when the check run completes,
  then the failure count is queryable, distinguishable from the `cap` case at `appCoverage.ts:262`.
- **A5.** Given all of A1-A4, when queried, then none of them requires parsing `check_result.observed`
  or `check_result.offenders` prose (the `" — "`-separated, human-readable strings at `checks.ts:658-668`
  stay exactly as they are for the human reader; the new sink is a second, structured view of the same
  facts, not a replacement for the prose).

### Group B — OFF is distinguishable from ON-but-silent

- **B1.** Given `chk_coverage_judge=false` (the owner's default) for an artifact, when
  `evaluateArtifact` runs, then the observability sink shows **no evidence the judge was invoked** for
  that run (either zero rows, or an explicit "did not run" marker — pick one and be consistent across
  coverage/stuffing/support).
- **B2.** Given `chk_coverage_judge=true` and the judge runs but returns zero verdicts for every field
  (e.g. every call answered "not covered" or every call hit `cap`), when the run completes, then the
  sink shows the judge **ran** (a non-zero call count, or an explicit "ran, produced nothing" marker)
  — provably different from B1's state, by query.
- **B3.** Same pair for `supportJudge`: given `opts.vetProposals=false`, the sink shows no support-judge
  activity for that `writeEvidence` call; given `opts.vetProposals=true` and every candidate is
  `support_transport_failed`, the sink shows the judge ran and every attempt failed — distinguishable
  from "never asked."

### Group C — the model-raised stuffing count is queryable without string-parsing

- **C1.** Given `runStuffingRead` finds N hits across an artifact's fields, when the check run
  completes, then N is obtainable by a query against a structured value, not by a regex over
  `check_result.observed`'s `` `(${sHits.length} raised by a model reading for name-dropping)` ``
  substring (`checks.ts:664`) and not by counting `" — "` occurrences inside `offenders` (which would
  also miscount if a deterministic `scanWording` hit's phrase happens to contain that substring).

### Group D — instrumentation cannot move a gate, a score, or a coverage count

- **D1 (regression guard, mandatory).** Given the same artifact/opportunity fixture run before and
  after this change with judges OFF, when checks run, then every `check_result` row (`state`,
  `observed`, `expected`, `offenders`), `artifact_gate.gate`/`attention_count`, every `artifact_score.*`
  column, and every `requirement_coverage` row are **byte-identical** to a pre-change baseline captured
  from the same fixture. This must be an actual diff against a captured baseline, not an assertion that
  "nothing changed" by inspection.
- **D2.** Same fixture, judges ON (mocked `fetchJson` returning fixed verdicts): the new sink writes
  succeed AND `check_result`/`artifact_gate`/`artifact_score`/`requirement_coverage` are unchanged from
  what they were before this change was made (i.e. the new writes are additive, never a rewire of an
  existing write).
- **D3.** Given the new sink's write throws (simulated: the insert fails), when the run completes, then
  the existing gate/score/coverage/evidence outcome for that run is **unchanged** and the route does
  not 500 — the write must be wrapped exactly the way `appCoverage.ts:146-152` already wraps
  `writeVerdicts` failures (`failures.push` on catch, never propagated). This is not optional: every
  existing write in these three judges' paths already follows "an outage never takes the gate down"
  (stated explicitly at `appCoverage.ts:17-23` and `checks.ts` D4 comment); a NEW write that can 500 the
  request would be a regression against that standing invariant, not a new feature.
- **D4.** Grep-provable at review time: `runChecks`, `gateFor`, `computeArtifactScore`, and
  `ruleEvidenceOf` (wherever it lives — `evidence.ts` per the module comments above) do **not** import
  from or query the new sink. It is written, never read, by anything that decides a gate/score/coverage
  number.

### Group E — retention / volume

- **E1.** State the actual write cadence: `evaluateArtifact` runs on every manual check, every
  remediation pass (`appRemediation.ts:185,272` — one call per pass, and a remediation loop can run
  many passes per artifact per `decidePass`'s cap logic), and every packet build-all
  (`appPackets.ts:1189`, once per artifact of the packet). The AC must state, with a number or a
  formula, how many new rows one `evaluateArtifact` call can produce (recommendation below argues for
  O(distinct outcome kinds) per call — small and bounded — not O(requirements) or O(fields ×
  requirements)).
- **E2.** Given the sink accumulates indefinitely, when volume is projected over the artifact's
  remediation history, then either (a) a stated, owner-configurable retention/prune policy exists — per
  the repo's "no hardcoded config" rule, the prune threshold itself must be a setting with a seeded
  default, not a bare literal — or (b) an explicit statement that unbounded growth is accepted, with the
  reasoning, submitted for the owner's sign-off before implementation (this repo's Group 1-tier work
  requires that sign-off for any new stored population; instrumentation is exactly a "new subsystem"
  under "Extend, don't duplicate" if it becomes its own table).

### Group F — the write-orphaned column (row 8) is resolved, not ignored

- **F1.** Given this work ships, when reviewed, then the PR states explicitly whether
  `evidence_confirmation.missing` is wired up, deliberately left orphaned with a stated reason, or
  removed — "extend, don't duplicate" requires this column be ruled in or out by name before a new
  table is proposed, and leaving it silently unaddressed while adding a new sink beside it is the exact
  parallel-system failure that rule exists to catch.
- **F2.** If `evidence_confirmation.missing` is used for any part of this work, then it is used **only**
  for its existing scope (per-claim, populated at the moment the owner confirms/vetoes a specific
  excerpt) and not repurposed as a run-level/aggregate judge-failure log — doing so would conflate "the
  owner never decided" (row absent) with "the second read never disagreed" (value empty), which is
  exactly the null-vs-empty-array distinction the column's own comment at `schema.ts:1686-1688` already
  protects for a different pair of facts, and repurposing it would break that protection.

---

## RECOMMENDATION: one small new table, not `evidence_confirmation.missing`, not `usage_metering`

**Row 8 first, because it looks like the obvious answer and is the wrong one.**
`evidence_confirmation.missing` is scoped to a single **owner decision on a single excerpt** — its
unique key is the claim identity (`opp_id, requirement_text, source_key, char_start, char_end,
record_sha256`) and a row is only written when the owner calls `POST .../evidence-confirm`
(`appRequirements.ts:1039-1148`). It cannot hold "the coverage judge's transport failed on field
`@ExpertiseBody`" — there is no excerpt, no offsets, and often no requirement at all (a field-level
transport failure in `runCoverageJudge` isn't about any one requirement). Repurposing it would also
silently violate the null-vs-empty invariant its own schema comment establishes for a different
distinction. **Verdict: do not use it for this.** (AC F1/F2 exist so this reasoning is stated in the PR,
not just here.)

**Row 9 second.** `usage_metering` is the closest existing "this call happened" ledger and is
genuinely under-used — it doesn't even see a transport failure today (§Feasibility row 9c). Widening it
with nullable `opp_id`/`artifact_id`/`run_id` columns would close the "did the judge run at all" half of
Groups A/B cheaply, and IS worth doing as a small, separate, Tier-2 fix (log on the throw path too, not
only on success) — but it structurally cannot carry the **parse-level** outcome (`refused`,
`support_span_disagreed`, `cap`, `unparseable`), because `logUsage` is called from inside `openAiJson`
(`openaiJson.ts:57`), one layer below where the caller (`runCoverageJudge`, `writeEvidence`'s escalation
loop, `runStuffingRead`) computes those outcomes from the model's *parsed* JSON. `openAiJson` has
already returned by the time a caller knows "refused" vs "answered."

**Row 1/3/5 (`requirement_coverage`, `requirement_evidence`, `check_result`) are ruled out by their own
CHECK constraints and existing meanings**, not by preference:
- `requirement_coverage` enforces `check (covered = (quote is not null))` (`schema.ts:591`) — a refusal
  has no quote, so it cannot be inserted here without either violating the constraint or inventing a
  fake quote, which is exactly the "never fabricate" rule this repo already enforces elsewhere.
- `requirement_evidence` requires an actual span (`char_start >= 0 and char_end > char_start`,
  `length(quote) = char_end - char_start`, `schema.ts:483-484`) — same problem, sharper: a transport
  failure or a disagreement has no span to store.
- `check_result` is scoped to one `(artifact_id, run_id, check_key)` and is the input to the GATE
  (`gateFor`). Writing operational judge failures into it directly would put untrusted-shaped rows next
  to gate-deciding rows in the same table, inviting exactly the "instrumentation that can fail a gate"
  failure mode Group D exists to forbid. `supportJudge` also runs with **no `artifact_id` at all**
  (`writeEvidence` is opportunity-scoped) — `check_result`'s NOT NULL `artifact_id` FK cannot represent
  that call.

**Proposed minimum shape — one small, append-only table**, e.g. `judge_outcome`:

```
opp_id       uuid not null references opportunity(id) on delete cascade
artifact_id  uuid references artifact(id) on delete set null   -- nullable: supportJudge has none
run_id       uuid                                              -- nullable: writeEvidence has no run_id today
judge        text not null check (judge in ('coverage','support','stuffing'))
outcome_kind text not null    -- e.g. 'transport_failed','cap','cache_failed','write_failed',
                               --      'refused','support_span_disagreed','support_<refusal>', etc.
                               --      — reuse the exact strings note()/failures already use, don't invent new ones
count        int not null default 1
created_at   timestamptz not null default now()
```

One row per **(run-or-call, judge, outcome_kind)** with a `count`, aggregated exactly the way the
existing in-memory objects already aggregate (`escalation_refusals[k]++`, `failures.push(...)`) —
**never** one row per requirement/field, which is what keeps E1's volume bound small (roughly the
number of distinct outcome kinds per judge per call, not the number of requirements). This is the
smallest structure that can hold all of rows 2/4/6 without violating any existing table's invariants,
and it is genuinely new because nothing in the schema today is shaped to hold "an outcome with no
quote and no span." State this reasoning in the PR per Group D/F rather than asserting it.

---

## PROPOSED H-CASE SLUGS

- `H:judge-failures-are-recorded` — a mocked transport failure / model refusal for each of the three
  judges produces a queryable row; deleting the write leaves the suite red.
- `H:judge-outcome-not-gating` — mutate the new sink write to also flip `check_result`/`artifact_gate`;
  confirm a test catches it (Group D's mutation-proof).
- `H:judge-off-vs-silent-distinguishable` — the OFF/ON-but-empty pair (Group B) stays distinguishable;
  a regression that makes both cases produce zero rows must fail this.
- `H:evidence-confirmation-missing-scope` — asserts `missing` is written **only** from the
  evidence-confirm path with a real claim identity, never from a run-level aggregate — guards against a
  future change repurposing it per F2.
- `H:judge-outcome-volume-bounded` — asserts row count per `evaluateArtifact`/`writeEvidence` call is
  O(outcome kinds), not O(requirements) — catches an accidental switch to per-requirement rows.

---

*Feasibility table and ACs are complete as of this line. No implementation code was written for this
pass.*

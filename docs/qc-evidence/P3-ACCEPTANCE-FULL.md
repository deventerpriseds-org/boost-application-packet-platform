# P3 — remediation loop: the complete acceptance criteria (P3-01 … P3-46)

Reconstructed COLD by an independent AC agent against `main`, **before any P3 code exists**, from
`BACKLOG.md` §P3, `SPEC.md`, `.claude/QC-EVIDENCE-PLAN.md` (§8 P3, §7 dependency chain, §9 conflict
register, §11 decisions 14–19) and the live code — never from an implementation. No branch named
`claude/qc-p3-*` was read.

**Relationship to `P3-ACCEPTANCE.md`.** That file is the surviving fragment of the first cold pass: the
four headline criteria (P3-05, P3-11, P3-25, P3-37/38), twelve divergences, and the list of
sandbox-verifiable IDs. **Its IDs are authoritative and their meaning is preserved here exactly as
written there.** This file restores the ~40 whose text was lost. The divergence register (D-1 … D-12)
is NOT repeated here — read it there; it is the reason several criteria below are worded the way they
are.

**Standing owner directive applied throughout:** on any spec-vs-codebase divergence, DEFAULT TO WHAT
IS ALREADY BUILT; depart only for a named defect. Where a criterion below requires a departure, the
defect is named in its text.

**Absent evidence is `not_applicable`, never `pass`.** A criterion whose vehicle cannot run today is
marked `NOT VERIFIABLE TODAY` with the reason, and may not be claimed.

---

## Verification vehicles

| Mark | Vehicle |
|---|---|
| `sandbox` | `cd api && npm ci && npm run build && npm test` (Node 22 built-in runner over `api/test/*.test.mjs`) |
| `db-query.yml` | workflow_dispatch with a `sql` input, read via `get_job_logs` |
| `api-test.yml` | workflow_dispatch `method`/`path`/`body` against the deployed Function |
| `ui-verify.yml` | Playwright-in-GHA against the live SPA |
| `NOT VERIFIABLE TODAY` | with the reason stated |

**No P3 criterion is claimable through `ui-verify.yml`.** P5 is not merged and the harness gaps (D2
route-driven step, D3 click/absence/viewport) are open — the plan's §6 forbids claiming coverage on an
AC the harness cannot express.

The sandbox-verifiable set named in `P3-ACCEPTANCE.md` is preserved exactly: **P3-03, 04, 05, 07, 08,
10, 15, 18, 19, 23, 25, 27, 29, 30, 40, 42, 44, 46.**

---

## A. Prerequisites and the scoped-regeneration primitive (P3-01 … P3-10)

> **AC 3.1.0 (X2) blocks everything else.** Without it every loop criterion below passes vacuously
> against `packet.pkg_json`. D-8: `buildPackageForJD` is monolithic — call 2 consumes
> `JSON.stringify(c1)`, call 3 consumes `{...c1, ...c2}`, `assemblePackage` merges whole payloads.
> **Nothing today can regenerate one merge field.** That primitive is new capability inside P3's
> scope (plan §11 decision 17), not a wiring change.

**P3-01.** Given a packet whose `packet.pkg_json` is already populated and which has at least one open
must-have, when the loop controller runs pass 1, then `packet.pkg_json` differs from its pre-pass
value **and** at least one `usage_metering` row exists whose `feature` names that pass — a pass served
from the cache is a failure of this criterion, not a fast pass.
*Verify:* `api-test.yml` (run the loop) + `db-query.yml` (compare `pkg_json` hash and count rows).

**P3-02.** Given an opportunity for which `generationJd(opp)` returns `grounded:false` (no `jd_real`
and no `raw_jd` — 116 of 1,349 parsed opportunities), when the loop is invoked, then it makes zero
model calls, writes zero `remediation_loop` rows beyond a single `n=0` row, and records
`halt_reason='ungrounded'`. A loop against a synthesised pseudo-JD would remediate toward our own
metadata, which X1 exists to prevent.
*Verify:* `api-test.yml` on an ungrounded opportunity + `db-query.yml` on `usage_metering`.

**P3-03.** `sandbox` — Given a current package and an explicit set of merge fields to regenerate, when
the scoped-regeneration primitive is called, then every merge field **not** in that set is
byte-identical in the returned package to the field in the input package.
*Named defect this prevents (D-8 / plan §11-17):* pass 2 regenerating everything and destroying
content pass 1 already got right.

**P3-04.** `sandbox` — Given an empty field scope (no open requirement maps to any writable merge
field), when the scoped-regeneration primitive is called, then it returns the input package unchanged
and issues zero model calls.

**P3-05.** `sandbox` — **`converged` must be unfalsifiable.** Given a `remediation_loop` row being
written, when its `halt_reason` is `'converged'`, then `cardinality(remaining) = 0` **and** that
pass's `run_id` has a `must_have_coverage` `check_result` row with `state='pass'` — not
`not_applicable`, not `warn`. Enforced by a **table CHECK**, not by the writer's good intentions
(the row therefore carries the pass's coverage state as its own column so the CHECK can see it).
"Converged" is the one word a user will trust without reading anything else.
*Verify:* assert the constraint text in `schema.ts` `SCHEMA_SQL`; `db-query.yml` proves it is live by
attempting the illegal insert and receiving a constraint violation.

**P3-06.** Given a loop that ran N passes for a packet, when `remediation_loop` is read, then exactly
N rows exist for that packet with `n` contiguous from 1 to N, each carrying `ran_at`, `closed[]`,
`remaining[]`, `note` and `halted`, and exactly one row has `halted = true`.
*Verify:* `db-query.yml`.

**P3-07.** `sandbox` — Given a pass's ledger row, when `closed[]` and `remaining[]` are compared, then
they are disjoint and their union is exactly the pass's coverage denominator (P3-14) — no requirement
is both closed and remaining, and none is silently absent from both.

**P3-08.** `sandbox` — Given a pass whose `closed[]` is empty, when the controller decides whether to
continue, then it halts, sets `halted=true` and records `halt_reason='no_progress'`. A loop that keeps
paying for passes that close nothing is the failure the backlog's "halt when a pass closes nothing,
and record why" line describes.

**P3-09.** Given the configured maximum number of passes (seeded default 4), when that many passes have
run with requirements still open, then the last row carries `halted=true` and
`halt_reason='max_passes'`, and no row with `n > max` exists for that packet.
*Verify:* `db-query.yml`.

**P3-10.** `sandbox` — Given the pass maximum and the cost/time budgets, when the controller reads
them, then each is read from the per-owner settings store (`owner_search_prefs`, the store
`appChecks.ensureCheckPrefs` and `jdSweep.ts` already extend) with the code supplying only the seeded
first value. No behaviour-affecting P3 threshold is a code-only constant — the repo's "No hardcoded
config" strict rule.
*Verify:* unit test that an injected non-default max/budget changes the controller's decision, plus a
source assertion that the controller does not compare against a literal.

---

## B. Closing credit, and the coverage denominator (P3-11 … P3-20)

**P3-11.** **A close requires an actual edit.** Given a requirement recorded as closed on pass N, when
the ledger is read, then `requirement.closed_on_loop = N` (or its per-artifact successor, P3-12) is
legal **only** when an `insertion` row exists at `loop = N` whose `after_text` differs from its
`before_text`. This is the headline defect class: `checks.covers()` is token overlap over the whole
document (`COVERAGE_THRESHOLD = 0.7` across `allText`), so an edit to an unrelated field can flip a
requirement to "covered" and the loop would take credit for closing it.
*Verify:* `db-query.yml` — every `closed_on_loop = N` row must join to a changed `insertion` row at
loop N; the count of rows failing that join must be 0.

**P3-12.** Given that coverage is judged per-**artifact** by `evaluateArtifact` over a per-**packet**
`pkg_json` across four artifacts with different merge fields (resume 7, compact_resume 7, portfolio 7,
cover 3), when a close is recorded, then it is recorded at `(requirement_id, artifact_id)` grain.
`requirement.closed_on_loop` — a single `int` on a per-**opportunity** row with **zero writers and
zero readers today** (`schema.ts:308`, its only occurrence in the codebase) — is reshaped to that
grain or dropped; it is never left as an int that cannot express "covered in the resume but not the
cover letter", which is the normal case (D-6, plan §11-16).
*Verify:* `db-query.yml` on `information_schema` plus a live packet's rows.

**P3-13.** Given a merge field whose requirement closed at pass k, when pass k+1 runs, then that
field's `insertion` row at `loop = k+1` has `after_text` identical to its loop-k `after_text` and
`method = 'template_fill'`, not `'model_rewrite'` — "no pass rewrites an already-closed block"
(BACKLOG P3.1 acceptance).
*Verify:* `db-query.yml`.

**P3-14.** Given that `checks.ts` deliberately removes requirements from the coverage denominator —
`template_reach` (the `ELIGIBILITY_RE` preconditions no generated merge field can carry),
`facts_settled` and `facts_needed` (requirements the owner's `owner_fact` rows own) — when the loop
computes `remaining[]`, then its denominator is exactly the `coverable` set `runChecks` computes, and
eligibility rows and fact-owned rows are listed separately as "not chased, and why", never counted as
open work. A loop reading open requirements off `requirement` directly would chase requirements it
structurally cannot close and burn every pass on them (D-12).
*Verify:* `db-query.yml` comparing the pass's `remaining[]` against the run's `check_result` rows.

**P3-15.** `sandbox` — Given the same requirement rows, facts and package, when the loop's denominator
and `runChecks`'s `must_have_coverage` `observed` ratio are computed, then they are equal for every
input. One implementation of one rule (R4 / plan §9 C6): the loop must read the check, not recompute
coverage, or the day the two drift is the day the gate and the loop describe different states of the
same artifact.

**P3-16.** Given `requirements.ts:392` sets `coverage: loc.char_start === null ? 'escalated' : null`
at **extraction**, meaning "the quote could not be located in the posting" and decided before any loop
exists, when any number of loop passes run, then `select count(*) from requirement where
coverage='escalated'` is unchanged and the loop has written zero values into `requirement.coverage`.
Loop give-ups go to the `escalation` table (D-5, plan §11-15).
*Verify:* `db-query.yml`, before and after a live loop run.

**P3-17.** Given both populations exist for one opportunity, when a single query is run, then it can
return "quote not locatable in the posting" and "the loop gave up" as two separate counts with no
disambiguating heuristic. Two populations in one column is exactly how a gate comes to count the
wrong thing.
*Verify:* `db-query.yml`.

**P3-18.** `sandbox` — Given open requirements after pass 1 and a stored profile (`MasterContext`),
when pass 2 is prepared, then the controller first runs an evidence search over the profile and the
pass records which open requirements had supporting profile text that pass 1 did not surface — the
`$18M` budget and the `60+` team size in the prototype both existed in the work history and were
simply not pulled forward (BACKLOG P3.1).

**P3-19.** `sandbox` — Given an open requirement for which the profile contains no supporting excerpt,
when pass 2+ runs, then the primitive produces no candidate text for it, the requirement stays in
`remaining[]`, and nothing generalized, softened or synthesized is written. R2: evidence or escalate.
This is the criterion that stops "loop until 100%" from becoming "write until it looks covered".

**P3-20.** Given requirement R closed during a multi-pass run, when the ledger is read, then R appears
in exactly one pass's `closed[]`, and that pass is the one whose `insertion` row changed the field
that covers it. A requirement re-listed as closed by a later pass is double-counting.
*Verify:* `db-query.yml`.

---

## C. X5 render-once, D8 metering, the cost ceiling and the wall-clock guard (P3-21 … P3-30)

> D-9 corrects X5's framing: **every rebuild already orphans a Drive file.** There is no Drive
> `DELETE` anywhere in `api/src/functions/tests/`, and `buildTemplatedArtifact` overwrites
> `artifact.doc_url` after each copy. The loop does not introduce this; at 4 passes it multiplies it
> to 16 files per packet on the quota-bearing OAuth account.

**P3-21.** Given a packet completing an N-pass loop (N > 1), when the packet output folder
`1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt` is listed, then exactly **4** new files exist for that packet.
*Verify:* `api-test.yml` — **blocked until `diagFolders.ts` is extended to list the packet output
folder; it currently lists only the two role template folders.** Until then this criterion is
`not_applicable`, not `pass`.

**P3-22.** Given an N-pass loop over one artifact, when `artifact.doc_url` history is inspected, then
it was written exactly once for that run, after the loop halted.
*Verify:* `db-query.yml` (`updated_at` / `version_history` cardinality for the run window).

**P3-23.** `sandbox` — Given the loop controller module, when its call graph is inspected, then
`copyTemplate`, `injectValues` and `buildTemplatedArtifact` are not reachable from inside the pass
loop; rendering is a separate step the controller invokes once after halting. Proven by a unit test in
which a fake renderer is invoked exactly once per templated artifact across N passes, and by a source
assertion that the loop body contains no Drive call.

**P3-24.** Given a run that supersedes an artifact's previous `doc_url`, when the new url is written,
then the superseded Drive file id is persisted in a row that names the artifact and the run, so the
existing orphan population is measurable. The loop must not silently increase an orphan count nobody
can query. Deletion is a separate owner decision (plan §11-18) and is **not** required by this
criterion.
*Verify:* `db-query.yml`.

**P3-25.** `sandbox` (primary) — **Documents render once (X5).** Given a packet completing an N-pass
loop over 4 templated artifacts, when the run finishes, then it issues exactly **4** Drive copies, not
**4N**.
*Live half:* `api-test.yml`, blocked on the same `diagFolders` extension as P3-21.

**P3-26.** Given an N-pass loop, when `usage_metering` is read for that packet's run window, then every
pass has at least one row, each row's `feature` names both the artifact type/pass name and the
remediation pass number, and the number of passes with zero rows is 0. D8: `appPackets.ts` used to
pass `logUsage(..., {})`, which `logUsage` discards on zero tokens, so the production packet build —
the most expensive operation in the product — had never recorded a single row.
*Verify:* `db-query.yml`.

**P3-27.** `sandbox` — Given the P3 source, when `grep -n "logUsage(.*, {})" api/src/` is run, then it
returns 0 matches; and `tokensOf` resolves both OpenAI usage shapes
(`prompt_tokens||input_tokens`, `completion_tokens||output_tokens`) for every call the loop makes.

**P3-28.** Given a pass run on a model with no entry in `PRICES` and no `MODEL_PRICES_JSON` override,
when the meter row is written, then the row exists with real token counts and `cost_usd IS NULL`. A
fabricated cost is worse than a missing one because it is indistinguishable from a real one in the
table.
*Verify:* `db-query.yml`.

**P3-29.** `sandbox` — **Enforce a cost ceiling, not just observation** (plan §8 P3). Given an
accumulated spend for a packet run and a configured per-packet ceiling, when the next pass would carry
the total past the ceiling, then the controller halts **before** issuing the call and records
`halt_reason='cost_ceiling'` with the observed and configured amounts in `note`.

**P3-30.** `sandbox` — Given the Azure Functions consumption-plan wall-clock limit, when the elapsed
time since the run started exceeds the configured time budget, then the controller stops before
starting another pass, writes a complete `halted=true` row with `halt_reason='time_budget'`, and
leaves the ledger internally consistent. Copies `appApply.atsBackfill`'s guard shape
(`if (Date.now() - start > 180_000) break`, `appApply.ts:204`) rather than inventing a second pattern
— a run killed by the platform mid-pass leaves a ledger that says a pass started and never finished.

---

## D. Escalations — P3.2 (P3-31 … P3-36)

**P3-31.** Given the loop halts with anything open, when the `escalation` table is read, then one row
exists per open item carrying `requirement_id`, `ats_term_id`, `artifact_id`, `state ∈ {open,
resolved, accepted}`, `title`, `detail` and `ask`, and `detail` states **what was searched and why it
could not be closed** — not merely that it is open.
*Verify:* `db-query.yml`.

**P3-32.** Given an uncoverable nice-to-have, when the loop halts, then it produces **exactly one**
open escalation for it, and re-running the loop for the same packet does not create a second.
*Verify:* `db-query.yml`.

**P3-33.** Given an escalation in state `open`, when the user supplies the missing evidence through the
resolve endpoint, then the escalation moves to `resolved`, a new `remediation_loop` row is written with
`n = max(n) + 1` for that packet, and the earlier passes' rows are untouched — the ledger continues, it
does not reset.
*Verify:* `api-test.yml` then `db-query.yml`.

**P3-34.** Given an escalation in state `open`, when the user accepts the gap, then `state='accepted'`,
zero characters of asset content change, `artifact_score.must_have_coverage` for that artifact is
unchanged, and `artifact_gate.gate` is unchanged. Accepting a gap records a decision; it does not
improve a score. "The score reflects the gap rather than hiding it" (BACKLOG P3.2 acceptance).
*Verify:* `api-test.yml` then `db-query.yml`.

**P3-35.** Given any escalation row, when it is read, then at least one of `requirement_id` /
`ats_term_id` is non-null and `artifact_id` is non-null — every escalation resolves to the exact object
it is about, so the count can deep-link (R5). A bare title with no target is a dead end.
*Verify:* `db-query.yml`.

**P3-36.** Given a loop that halts with `halt_reason='converged'`, when the `escalation` table is read
for that packet, then it contains zero rows created by that run. Escalations are created on halt with
something open, never mid-loop and never on a clean convergence.
*Verify:* `db-query.yml`.

---

## E. The honesty criteria (P3-37 … P3-46)

**P3-37.** **Green because fixed, never because stopped.** Given a loop that halts with must-haves
still open (for any `halt_reason` — `no_progress`, `max_passes`, `cost_ceiling`, `time_budget`), when
the gate is read, then it is `fail`. A loop may never reach `pass` by giving up.
*Verify:* `db-query.yml` — for every packet with a `halted` row whose `remaining[]` is non-empty, the
count of artifacts at `gate='pass'` must be 0.

**P3-38.** **And it must not reach green by removing evidence.** Given a loop run over a packet, when
before-and-after are compared, then the `requirement` row count for that opportunity is unchanged
across the loop, and `must_have_coverage` never transitions `fail → not_applicable` between two runs
of the same artifact. Deleting the rows that prove the gap is the cheapest way to a green gate, and
`not_applicable` is the state that hides it.
*Verify:* `db-query.yml`, snapshotted before and after.

**P3-39.** Given text the loop wrote into any list-backed merge field, when `swap_decision` is read for
that packet, then every `swapped`/`added` row carries `driver='posting'` with a non-null
`verbatim_quote` (the schema CHECK already ties those together), and the count of `driver =
'unattributed'` rows does not increase from one pass to the next. An uncited change is a `fail`, never
a `warn` (P2.2), and the loop is the process most likely to manufacture them at volume.
*Verify:* `db-query.yml`.

**P3-40.** `sandbox` — Given candidate text produced by a pass that contains a numeric figure which
appears in the posting and does not appear in the owner's profile, when the pass evaluates the
candidate, then the figure is rejected or rewritten to the owner's own figure, and the requirement is
**not** counted as closed by that figure. R3 / plan §9 C3: the posting's figures are the employer's
numbers, not evidence. Carve-out preserved (C5 / R2): a figure present in **both** the posting and the
profile is kept and cited.

**P3-41.** **Human overrides are not silently erased.** Given `artifact_gate.override_by/at/reason`
recorded by a human, when the loop calls `evaluateArtifact` — whose upsert clears all three columns on
every run — up to the configured maximum times, then each cleared override is first written to an
audit row naming the actor, timestamp, reason and the `run_id` that cleared it, and the number of
audit rows equals the number of clears. The rule "an override approves a specific set of findings"
still holds; silently discarding a human's recorded reason four times in one automated run is not what
that rule was written for (D-10, plan §11-19).
*Verify:* `db-query.yml`.

**P3-42.** `sandbox` — Given a pass whose model has no known price, so `costOf()` returns `null`, when
the cost ceiling is evaluated, then the controller does **not** add zero and continue: it falls back to
the configured token ceiling and can still halt. A null cost must never read as "free" — that is how an
unpriced model becomes the one with no budget.

**P3-43.** Given `appSwaps.writeSwaps` executes `delete from swap_decision where packet_id=$1` on every
build, and `swap_decision`'s unique key is `(packet_id, list, seq)` with **no `loop` column at all**,
when pass 2 runs, then pass 1's swap rows still exist and are addressable by their pass. **Named
defect (D-2): pass 2 destroys pass 1's swap record — the loop deletes its own justification for every
change it made.** The departure required is a `loop` dimension on `swap_decision` and an accumulate-
rather-than-replace writer, mirroring `appInsertions`, which already does this correctly.
*Verify:* `db-query.yml` — count swap rows per packet per loop after a 2-pass run; pass 1's count must
be non-zero.

**P3-44.** `sandbox` — Given three loop-ish counters already exist — `packet.round` (read via `order by
round desc`, **never incremented**), `insertion.loop` (counts document RENDERS, incremented on every
build including a cache hit that made zero model calls), and `check_result.run_id` — when P3 ships,
then `insertion.loop` means the remediation pass and is not incremented for a pass that made zero
model calls; **no fourth counter is added**; and `packet.round` is either incremented by the loop or
dropped, not left dead beside two counters that already disagree (D-1, D-4, plan §11-14; "Extend,
don't duplicate" is a strict rule).
*Verify:* unit test on the pass-number function (a cache hit does not advance it) plus a source
assertion that no new `*_loop`/`*_pass`/`round` counter column is introduced.

**P3-45.** Given a completed multi-pass run, when the QC & evidence step's **Passes** tab is opened,
then it shows, per pass, what the pass closed, what remained, where it halted and why — reading the
`remediation_loop` rows and no other source (SPEC §4.8).
*Verify:* **NOT VERIFIABLE TODAY.** P5 is not merged, and `scripts/ui-verify.mjs` cannot click, assert
absence, or measure layout (D3 open, plan §6). Claiming this today would be claiming coverage the
harness cannot express.

**P3-46.** `sandbox` — Given identical ledger inputs, when the controller's decision function is called
twice, then it returns an identical decision, identical `closed[]`/`remaining[]` membership and
identical ordering, and it makes zero model calls of its own. The controller is arithmetic over check
results; only the generation primitive it invokes may call a model.

---

## Cross-references that constrain these criteria

- **Plan §9 conflict register — P8 overrides earlier phases.** C2: the gate reads POST-correction
  state and a revert re-reddens it, which is why P3-37 is stated over the halted state rather than
  over the last pass's output. C4: length checks re-run after every correction, so a pass that fixes
  coverage and breaks `word_counts` has not closed anything — P3-08's "closed nothing" is measured on
  the check run, not on the edit count. C6: coverage counts come from evidence rows, not term
  placement (P3-14, P3-15).
- **Plan §7 order.** P3 depends on P2 and runs parallel to P4. Nothing here may depend on a
  `review_verdict` row: a reviewer disagreement can never produce `fail` (D6), so it can never be what
  keeps a loop running.
- **Decision §11-3 (owner).** Status reset is a state change only — findability and stage placement
  are preserved. No loop may delete a packet, move `opportunity.stage`, or remove a started packet
  from its stage list.

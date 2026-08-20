# P3 — independent verification of the remediation loop

Written by an INDEPENDENT VERIFIER who did not write the P3 code and does not defend it. Every line
below reports something observed: test-runner output, `psql` output, `grep` results, or a mutation
that was applied and watched. "Should work" and "looks correct" appear nowhere. Absent evidence is
recorded as `not_verifiable`, never as a pass.

**Under test:** `claude/qc-p3-remediation` @ `1916c55` (re-verified; the first pass ran against
`ce2a808`).
**Baseline:** `main` @ `44d1cfc`.
**Acceptance read:** `main:docs/qc-evidence/P3-ACCEPTANCE.md` (4 headline criteria + 12 divergences)
and `origin/claude/qc-p3-ac:docs/qc-evidence/P3-ACCEPTANCE-FULL.md` (P3-01 … P3-46).

**One constraint in the brief was wrong, in the branch's favour.** The brief said there is no
Postgres. This container ships **PostgreSQL 16.13** (`/usr/bin/psql`, `postgresql-16` installed). A
throwaway cluster was stood up and `SCHEMA_SQL` was executed for real — on a fresh database, on an
upgrade from `main`'s schema, and through `pg` using the exact call `pgMigrate.ts:15` makes. That
turns several criteria from "assert the constraint text" into "watch the database refuse the row",
and it is how the finding in §6.1 was reached. There is still no Drive and no deployed Function.

---

## 1. Test counts, verbatim

### `main` @ `44d1cfc`
```
# tests 301
# suites 0
# pass 301
# fail 0
# cancelled 0
# skipped 0
# todo 0
MAIN_44d1cfc_TEST_EXIT=0
```

### `claude/qc-p3-remediation` @ `1916c55`  — **RED**
```
1..347
# tests 347
# suites 0
# pass 346
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1063.976276
BRANCH_HEAD_1916c55_TEST_EXIT=1
```
The failure:
```
not ok 118 - H26: every hardening case has its own ID
  error: |-
    a hardening case was lost in a merge — its ID is unused
    + [ 'H28', 'H29', 'H30', 'H31' ]
    - []
```

### `claude/qc-p3-remediation` @ `ce2a808` (first pass, for the record)
```
1..312
# tests 312
# pass 312
# fail 0
TEST_EXIT=0
```
`npm ci` → 137 packages, 2 high-severity advisories. `npm run build` (tsc) → exit 0, no output, at
both commits.

**`main` is green and exits 0. The branch is red and exits 1.** Merging it as it stands turns `main`
red. See §7.2 for whether that is expected.

---

## 2. DISPROVEN

These are the only part of this document that changes what happens next.

The first pass tallied **six**. Re-reading my own verdicts while re-verifying, two more belong here:
D-7 was written up as "violated by design" and D-8 as "a scope limit", and both of those are
softenings of a disproof. They are stated plainly below. **Eight, not six.**

---

### D-1 — `H32b` (was `H26b`) cannot fail. All three of its assertions are inert.

**Claim.** `H32b: swap_decision and skill_candidate carry the pass in their key` guards the H26/H32
defect (`writeSwaps` deleting a whole packet's provenance, and `swap_decision` having no pass
dimension).

**What I did.** Reverted each thing the test names, one at a time, and ran `node --test
test/hardening.test.mjs`. Four mutations, at `1916c55`:

| Mutation | Result |
|---|---|
| remove `loop` from `swap_decision`'s `CREATE TABLE` unique key | **no test failed** |
| delete the `loop` column from `swap_decision`'s `CREATE TABLE` | **no test failed** |
| delete the `loop` column from `skill_candidate`'s `CREATE TABLE` | **no test failed** |
| remove `unique (artifact_id, run_id, check_key, state)` from `check_result`'s `CREATE TABLE` (D-2) | **no test failed** |

Output for each was identical:
```
MUTANT: SWAPKEY
    >>> NO TEST FAILED  (guard is INERT)
MUTANT: SWAPCOL
    >>> NO TEST FAILED  (guard is INERT)
MUTANT: SKILLCOL
    >>> NO TEST FAILED  (guard is INERT)
```

**Why it is disproven — two mechanical causes.**

1. `assert.match(schema, /unique \(packet_id, list, seq, loop\)/)` — that string occurs **twice** in
   `schema.ts`: once at the `CREATE TABLE` (line 373) and once in the idempotent migration
   (`alter table swap_decision add constraint swap_decision_packet_list_seq_loop_key unique
   (packet_id, list, seq, loop)`). Deleting the first leaves the second matching.
2. `/create table if not exists swap_decision[\s\S]*?loop\s+int not null default 0/` uses an
   **unbounded lazy span**. It does not stop at the end of the table. Diagnosed with a probe:

   ```
   --- swap_decision   match length 1301
   TAIL: "...re-running one pass stays idempotent.\n  loop           int not null default 0"
   --- skill_candidate match length 658
   TAIL: "...pass 1's swap rows lose the ids they point at.\n  loop         int not null default 0"
   ```
   With the real column deleted the regex simply walks on to the next table that has one — the
   `escalation` table's `loop int not null default 0` — and matches there.

**Consequence.** The single most-cited defect in the commit message (H26: "pass 2 destroyed pass 1's
swap record") is guarded by a test that passes with the guard removed. Note `H32` (the delete-scope
grep) **is** live — see §3. It is `H32b`, the schema half, that is inert.

**Fix.** Bound the spans to the table (`[^;]*?`, or slice `CREATE TABLE`…`);` first) and assert on the
`CREATE TABLE` slice rather than on the whole file.

---

### D-2 — `H35`'s (was `H29`'s) third assertion cannot fail, and neither can `H37`'s "fresh database" line.

**Claim.** `H35` asserts `unique (artifact_id, run_id, check_key, state)` exists on `check_result`
"as the FK target". `H37`'s last line asserts the inline constraint separately "for a fresh
database".

**What I did.** Deleted the inline `unique (artifact_id, run_id, check_key, state)` from
`check_result`'s `CREATE TABLE`, leaving the idempotent alter. Ran the suite.

**What I observed.** `>>> NO TEST FAILED (guard is INERT)`.

**Why.** Both assertions are substring searches over the whole of `SCHEMA_SQL`:
```js
assert.match(schema, /unique \(artifact_id, run_id, check_key, state\)/, 'the FK needs this unique …')
...
assert.ok(sql.includes(inline), `${table} should also carry ${inline} inline, for a fresh database`)
```
The idempotent alter — `alter table check_result add constraint check_result_artifact_run_key_state_key
unique (artifact_id, run_id, check_key, state);` — contains that substring. Neither assertion can
distinguish "inline on the CREATE TABLE" from "in the ALTER", so neither can ever fail while the
ALTER exists.

**This is the same mistake `a0128f1` was written to correct, one line further down.** That commit
says H31's first version "accepted `check_result`'s INLINE unique as proof the target existed, so it
passed with the defect deliberately reinstated — an inert guard, which is worse than none", and that
the fix "asserts the inline constraint separately for fresh databases". The line added to do that
does not do it.

**Severity: low, today.** I checked empirically whether the inline constraint is still load-bearing
now that the ALTER runs before `remediation_loop`:
```
built: inline unique removed from check_result CREATE TABLE
  fresh-db exit with inline removed=0
  remediation_loop created: 1
```
A fresh database is fine without it. So the inertness is currently cosmetic. It stops being cosmetic
the moment anyone reorders the file back.

---

### D-3 — `H36` (was `H30`) is evaded by renaming two identifiers.

**Claim.** `H36: the loop decides coverage with the gate's predicate, never its own`.

**What I did.** Three mutations at `1916c55`.

| Mutation | Result |
|---|---|
| drop the `coversText` import, re-implement locally using `COVERAGE_THRESHOLD` | **FAILS** — `the loop must import the gate's coverage predicate` |
| keep the import, add a second rule named `LOOP_COVERAGE_MIN` computing `hit.length / toks.length` | **FAILS** — `the loop re-implemented the overlap rule` |
| keep the import, add a rule using **different variable names** and threshold `0.5`, and use it for credit | **PASSES** |

The third mutation in full — this is a live second definition of "covered", at a different threshold
from the gate's `0.7`, deciding what the loop credits:
```ts
const LOOP_MIN = 0.5
const localCovers = (t: string, words: string[]) =>
  words.filter(w => t.includes(w)).length / words.length >= LOOP_MIN
...
const credited = !!r && edits.length > 0 && localCovers(writtenText.toLowerCase(), …)
```
```
  hardening: NO H-CASE FAILED (H36 inert against a rename)
  remediation.test.mjs # tests 37
  remediation.test.mjs # pass 37
  remediation.test.mjs # fail 0
```

**Why it is disproven.** The guard matches on `COVERAGE_THRESHOLD\s*=` and the literal string
`hit.length / toks.length`. It tests spelling, not behaviour. And the behavioural suite does not
close the gap either: **all 37 `remediation.test.mjs` tests pass with the loop using a different
coverage rule from the gate**, because no test pins the threshold or compares the loop's verdict to
`runChecks`'s on the same input.

**Fix.** P3-15 already states the right assertion — "the loop's denominator and `runChecks`'s
`must_have_coverage` observed ratio are equal for every input". Assert that behaviourally
(table-driven, both functions, same inputs) instead of grepping for identifiers.

---

### D-4 — "No hardcoded config" is not true as a blanket claim.

**Claim.** P3-10: "No behaviour-affecting P3 threshold is a code-only constant."

**What I did.** Read `ensureLoopPrefs` / `loadLoopPrefs` / `remediationPrefs`; machine-listed every
non-comment numeric and string literal in `remediation.ts` and `appRemediation.ts`; traced what
`regenerateFields` is actually called with.

**What I observed.** The **four ceilings are genuinely owner-owned** — `rem_max_passes`,
`rem_cost_ceiling_usd`, `rem_wall_clock_ms`, `rem_token_ceiling`, `rem_enabled` on
`owner_search_prefs`, seeded from `DEFAULT_LOOP_PREFS`, changed at `PATCH
/api/app/remediation-prefs`. `budgetVerdict` and `decidePass` contain no numeric literal other than
`Math.round(x / 1000)` for display, and the owner-sensitivity is tested
(`budgetVerdict({passesDone:2}, DEFAULT)` → `halt:false`; with `{maxPasses:2}` → `max_passes`).

But these behaviour-affecting values cannot be changed without a deploy:

| Literal | Location | What it decides |
|---|---|---|
| `SCOPED_REGEN_MODEL = 'gpt-4o-mini'` | `pipeline.ts` | the model **every** remediation pass runs on — not in prefs, not env-overridable |
| `max_tokens: opts.maxTokens ?? 4000` | `pipeline.ts` `regenerateFields` | `appRemediation` never passes `maxTokens`, so it is always 4000 |
| `temperature: opts.temperature ?? 0.4` | same | never passed, so always 0.4 |
| `.slice(0, 12000)` on `profileText` | `remediation.ts:368` | how much of the standing profile the model may mine — directly bounds what P3-18 can surface |
| `STRUCTURAL_FIELDS = ['@Company','@CoverLetterDate']` | `remediation.ts` | fields permanently excluded from every scope |

**Why it is disproven.** The model, its token cap, its temperature and the profile truncation are all
behaviour-affecting and all code-only. P3-10 is satisfied for the ceilings it names and false as
stated for the loop as a whole.

---

### D-5 — P3-33: resolving an escalation does not do what the API tells the user it does.

**Claim.** P3-33: supplying evidence moves the escalation to `resolved`, **a new `remediation_loop`
row is written with `n = max(n) + 1`**, and the earlier rows are untouched. `escalationResolve`
rejects a resolution without evidence — `"resolving an escalation requires the evidence, in `note` —
the loop re-runs against it"` — and its success response says `"Re-run the remediation loop for this
artifact; the evidence you supplied is now on the record."`

**What I did.** Read `escalationResolve` in full. Then `grep -rn resolution_note api/src app`.

**What I observed.**
```
api/src/functions/tests/appRemediation.ts:337   update escalation set state='accepted', resolution_note='closed by the remediation loop',
api/src/functions/tests/appRemediation.ts:446   update escalation set state=$1, resolution_note=$2, …
api/src/functions/tests/schema.ts:679           resolution_note text,
```
Three writes, one column declaration, **zero reads**. `escalationResolve` updates the `escalation`
row and returns; it writes no `remediation_loop` row. And on the next run, `loadProfile()` reads only
the MasterContext table and `buildScopedPrompt` receives only `profileText` / `omitList` — the
escalation and its `resolution_note` are never consulted.

**Why it is disproven.** Two failures. (a) No `remediation_loop` row is written at resolve time, so
P3-33's literal requirement is unmet. (b) The evidence the endpoint **refuses to proceed without** is
stored and never read by anything. Re-running the loop mines exactly the same profile that already
failed to close the requirement. The user is asked for evidence, told the loop will re-run against
it, and the loop cannot see it.

---

### D-6 — P3-09's pass ceiling is per-run, so `n > max` rows exist for a packet.

**Claim.** P3-09: when the configured maximum number of passes has run, "no row with `n > max` exists
for that packet".

**What I did.** Read the controller loop. `decidePass` is called with `pass: pass - firstPass + 1`
and `budgetVerdict` compares `spend.passesDone` (also `pass - firstPass + 1`) against
`prefs.maxPasses`.

**What I observed.** The ceiling is measured **per run**, not per packet. `nextPassNumber` makes a
second run continue the ledger, so a second run with `firstPass = 5` and `maxPasses = 4` writes rows
`n = 5,6,7,8`.

**Why it is disproven.** Those are rows with `n > max` for that packet — exactly what P3-09 forbids.
This is not an implementation slip; it is an **unreconciled conflict between two acceptance
criteria**: P3-33 requires the ledger to continue across runs, P3-09 is written as though `n` were
bounded by the ceiling. The implementation chose P3-33 and is right to; but P3-09 as written is not
met, neither acceptance document reconciles them, and the branch does not say so.

---

### D-7 — P3-07 is violated, and there is no test for it.

**Claim.** P3-07 (`sandbox`): `closed[]` and `remaining[]` are disjoint and their union is exactly
the pass's coverage denominator — "no requirement is both closed and remaining, and none is silently
absent from both."

**What I did.** Ran `creditClosures` against the compiled module for a phantom-close case.

**What I observed.**
```
ledger closed[]    = []
ledger phantom[]   = [ 1 ]
ledger remaining[] = []
```
Requirement #1 was in the denominator before the pass and appears in **neither** `closed` nor
`remaining` after it. `remaining` is `cov.openSeqs` — the engine's post-pass open list — and a
phantom-flipped requirement is not open, while the P3-11 guard correctly refuses to credit it.

Additionally: `grep -n "P3-07" api/test/remediation.test.mjs` finds nothing. P3-07 is on the
sandbox-verifiable list in both acceptance documents and **has no test**.

**Why it is disproven.** The invariant does not hold. It is not invisible — `phantom_closes` records
it — but the stated union property is false, and nothing in the suite would notice if it got worse.
There is a second consequence: because escalations are raised only for `stillOpen`, a
phantom-flipped requirement gets **neither credit nor an escalation**. It leaves the user-visible
open list silently.

---

### D-8 — The loop can still report `converged` on a close it did not make. Demonstrated.

**Claim.** P3-11 is the headline defect class: "`covers()` is token overlap over the whole document,
so an edit to an unrelated field can flip a requirement to 'covered' **and the loop would take credit
for closing it**." I graded this "proven" for the ledger column and filed the rest as a scope limit.
That was too generous, and this is the correction.

**What I did.** Ran the real compiled `coversText`, `creditClosures`, `decidePass` and
`reportedOutcome` on a case where the pass's own writing does not evidence the requirement but the
assembled document does.

**What I observed.**
```
coversText(written only)   = false   <- the pass did NOT evidence requirement #1
coversText(whole document) = true    <- but the GATE sees it covered

ledger closed[]    = []      <- P3-11 guard working: no credit taken in the column
ledger phantom[]   = [ 1 ]
ledger remaining[] = []

decidePass -> {"action":"halt","reason":"converged","detail":"every must-have is covered — 1/1 must-haves covered"}
reportedOutcome -> {
 "converged": true,
 "openMustHaves": 0,
 "passes": 1,
 "haltReason": "converged",
 "summary": "Converged after 1 pass(es): every must-have requirement is covered and the run's coverage check passed."
}
```
The database permits the row: `remaining` is empty, `must_have_state` is `pass` (a real check said
so), and `check (cardinality(closed) = 0 or cardinality(edited_fields) > 0)` is satisfied by the
**empty** `closed`.

**Why it is disproven.** A run that rewrote one unrelated field, credited nothing, and closed nothing
tells the user **"Converged … every must-have requirement is covered."** The P3-11 guard protects a
column; it does not protect the sentence. Both acceptance documents frame P3-11 as being about the
loop taking credit, and a `converged` summary is taking credit.

This does not contradict the P3-11 verdict in §3 — `creditClosures` does exactly what it claims. The
disproof is of the criterion's purpose, not of the function.

**Fix.** `reportedOutcome` and `decidePass` should treat a pass whose flips were all phantom as
`no_progress`, or `converged` should additionally require that every requirement that left the open
list did so in some pass's `closed[]`.

---

## 3. PROVEN — one line each

Each was established by applying a mutation and watching the named assertion fail, by executing SQL
against PostgreSQL 16.13, or by an exhaustive grep whose output is quoted.

- **P3-11 / `creditClosures`, no-edit case** — with `credited = true`, `not ok 1 … nothing was rewritten, so nothing may be credited (+[1] -[])`.
- **P3-11 / `creditClosures`, unrelated-edit case** — with `credited = !!r && edits.length > 0`, `not ok 2 … the rewritten text does not evidence the requirement`.
- **P3-11 / `realEdits`** — blank, unchanged and null `after_text` rows are all rejected; only the genuinely changed field survives.
- **P3-05 / CHECK** — live Postgres: `converged` with `remaining` non-empty → `ERROR: violates check constraint "remediation_loop_check2"`.
- **P3-05 / composite FK, wrong state** — `must_have_state='pass'` on a run the engine scored `fail` → `ERROR: violates foreign key constraint … Key (…, must_have_coverage, pass) is not present in table "check_result"`.
- **P3-05 / composite FK, no run** — `converged` against a `run_id` with no `check_result` → same FK violation.
- **P3-05 / legitimate path** — engine really recorded `pass`, nothing open → `INSERT 0 1`, and it is the only row stored.
- **P3-05 / FK target exists** — `check_result` carries `unique (artifact_id, run_id, check_key, state)` and is created ~140 lines before `remediation_loop`; `\d remediation_loop` lists the FK live.
- **P3-11 / schema CHECK** — crediting a close with no edited field → `ERROR: violates check constraint "remediation_loop_check3"`.
- **P3-38 / schema CHECK** — `prev='fail'` → `must_have_state='not_applicable'` → `ERROR: violates check constraint "remediation_loop_check4"`.
- **P3-38 / `evidenceRemoved`** — with the body stubbed to `return null`, `not ok 10` and `not ok 11` both fire; and `assertEvidenceIntact` runs **before** any `insert into remediation_loop`.
- **P3-37 / `reportedOutcome`** — with `converged` reduced to `reason === 'converged'`, `not ok 8 … converged with something open is a contradiction, not a result — true !== false`.
- **P3-37 / `isHonestGreen`** — only `converged` is green; every other halt reason is false.
- **P3-25 / X5, loop body** — inserting `copyTemplate(await getGoogleOAuthToken(), …)` inside the pass loop → `copyTemplate is reachable from inside the pass loop — that is 4N Drive copies`.
- **P3-25 / X5, split** — adding `getGoogleOAuthToken()` back into `ensurePackage` → `ensurePackage still calls getGoogleOAuthToken; generation and rendering are welded together again`.
- **P3-23 / transitive Drive reachability** — verified by hand, not by the grep: `grep -c` for the four Drive primitives is `0` in `appInsertions.ts`, `appChecks.ts`, `usageMeter.ts`, `checks.ts`, `remediation.ts`; `regenerateFields`'s body contains only `https://api.openai.com/v1/chat/completions`; `loadProfile` uses Azure Table Storage.
- **P3-44 / caller-owned pass number** — restoring `max(loop) + 1` in `writeInsertions` → `a writer deriving its own pass number counts renders, not passes (+['appInsertions.ts'])`.
- **P3-44 / no dead counter** — deleting `update packet set round = round + 1` → `a counter column that no code ever advances (+['round'])`.
- **H32 / delete scope** — reverting to `delete from swap_decision where packet_id=$1` → offenders `['appSwaps.ts: delete from swap_decision where packet_id=$1', 'appSwaps.ts: delete from skill_candidate where packet_id=$1']`.
- **P3-43 / two passes coexist** — live Postgres: inserting `(packet, skills_1, seq 1, loop 1)` and `(…, loop 2)` under `unique (packet_id, list, seq, loop)` → `INSERT 0 2`, both rows present.
- **H37 / composite-FK ordering** — moving the idempotent ALTER back to the foot → `FK into check_result(artifact_id, run_id, check_key, state) is declared at 37750 but its idempotent unique only runs at 42907 — this aborts the whole migration on any database where check_result already exists`. A genuinely good, generalised guard.
- **P3-03 / `applyScopedFields`** — out-of-scope keys, blank values and identical values are each rejected and named; tested.
- **P3-08 / `no_progress`, P3-29 / `cost_ceiling`, P3-30 / `time_budget`, P3-42 / unpriced** — each halt reason is produced by `budgetVerdict`/`decidePass` under test, and the ordering is asserted (a timed-out run is never reported as `no_progress`).
- **P3-42 / null is never zero** — `addCall` adds `0` and increments `unpricedCalls`; `costComplete` gates the USD ceiling; the token ceiling is unconditional and its message names the unpriced model.
- **P3-27 / metering shape** — `grep -rn "logUsage(.*, {})" api/src/` → **0 matches**; `tokensOf` resolves `prompt_tokens||input_tokens||promptTokens||inputTokens` and the output equivalents.
- **P3-18 / `profileEvidenceFor`** — names only open requirements the profile evidences, names nothing on an empty profile, and uses the gate's predicate.
- **P3-16 / population separation** — `grep` for `update requirement`, `delete from requirement`, `coverage=` in `appRemediation.ts` → none. The loop writes nothing into `requirement.coverage`.
- **P3-10 / owner-owned ceilings** — all four read from `owner_search_prefs`; `decidePass`/`budgetVerdict` contain no threshold literal. (Bounded by D-4.)
- **P3-46 / determinism by construction** — `remediation.ts` imports neither `@azure/functions` nor `pg` nor any clock; `decidePass` is pure arithmetic over check results. No explicit repeat-call test exists.
- **X2 / `regen` reaches the builder** — `appPackets.ts:429`, `:504`, `:605` read it; `:320`/`:335` honour it; `app/src/api.js:147` forwards options; `PacketBuilder.jsx:584` sends `{regen:true}`. (Bounded by §6.6.)
- **File ownership** — `git diff --name-only origin/main...1916c55 | grep -E "appChecks\.ts|figureEcho\.ts|appFacts\.ts|requirements\.ts|^app/"` → **(none — clean)**. Full stat: 13 files, all of them P3's own plus three `.claude/` docs. `checks.ts` is touched but is not on the forbidden list, and the change is an extraction (`covers` closure → exported `coversIn`/`coversText`, with `runChecks` calling it).
- **Fresh-database migration** — `SCHEMA_SQL` @ `1916c55` applies to an empty database with `ON_ERROR_STOP=1`, `exit=0`, both P3 tables created.

---

## 4. NOT VERIFIABLE HERE — grouped by reason

**Count.** I classify **29 criteria** as not verifiable in this environment, not 35. The enumeration
is below so the number can be checked rather than trusted. Two of them (P3-21, P3-25) are the *live
halves* of criteria whose sandbox halves are proven in §3.

### 4a. No deployed Function — the loop cannot be run end to end (7)
`api-test.yml` is the vehicle; there is no Function App reachable from here.

- **P3-01** a pass must change `pkg_json` and write a metering row — needs a real run.
- **P3-02** an ungrounded opportunity halts with `halt_reason='ungrounded'` and zero model calls — the code path is present and returns before any call, but the behaviour is unobserved.
- **P3-33** resolve → new ledger row — see D-5; the *code* is disproven, the *live* behaviour is unobserved.
- **P3-34** accepting a gap changes no content, no `artifact_score`, no `artifact_gate`.
- **P3-45** the QC rail's **Passes** tab — see 4d.
- **P3-21 / P3-25 (live halves)** — see 4b.

### 4b. No Drive (2, both live halves)
No Google OAuth token, no quota-bearing account, and `diagFolders.ts` still lists only the two role
template folders — it does not list the packet output folder `1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt`, so
even with credentials the count could not be read.

- **P3-21** exactly 4 new files in the packet output folder after an N-pass loop.
- **P3-25 (live half)** 4 Drive copies, not 4N, observed against the real API. *(The sandbox half is proven — §3.)*

### 4c. No production data and no live run — ledger arithmetic (19)
`db-query.yml` is the vehicle. I have a **schema-only** Postgres: it settles DDL, constraints and
forgery attempts (which is how §3's P3-05 and P3-43 lines were obtained) but holds no packets, no
requirements and no completed runs, so no ledger arithmetic can be computed.

P3-06 (contiguous `n`, exactly one `halted`), **P3-11 (the db-query half** — every `closed_on_loop = N`
joins to a changed `insertion` at loop N; the pure-logic half is proven in §3), P3-12 (per-artifact
close grain), P3-13 (a closed block is not rewritten by a later pass), P3-14 (the denominator equals
`runChecks`'s `coverable` set), P3-17 (the two `escalated` populations separable in one query), P3-20
(a requirement appears in exactly one pass's `closed[]`), P3-22 (`doc_url` written once per run),
P3-24 (superseded Drive id recorded), P3-26 (every pass has a metering row), P3-28 (unpriced model →
row exists with `cost_usd IS NULL`), P3-31 (one escalation per open item, `detail` states what was
searched), P3-32 (re-running creates no duplicate), P3-35 (every escalation resolves to an object),
P3-36 (a converged run creates zero escalations), **P3-37 / P3-38 (the db-query halves** — snapshots
before and after; the sandbox and schema halves are proven in §3), P3-39 (`driver='unattributed'`
does not increase pass to pass), P3-41 (an audit row per cleared override), P3-43 (the db-query half
— pass 1's swap count non-zero after a 2-pass run; the constraint half is proven in §3).

### 4d. Harness gap (1)
- **P3-45** the **Passes** tab. P5 is not merged and `scripts/ui-verify.mjs` cannot click, assert
  absence, or measure layout (D3 open). Claiming this would be claiming coverage the harness cannot
  express. Both acceptance documents already say no P3 criterion is claimable through `ui-verify.yml`.

### 4e. Criteria that are sandbox-marked but are really model-behaviour claims (2)
Recording these honestly rather than counting them as passes:

- **P3-19** "nothing generalized, softened or synthesized is written" — enforced only by prompt text
  (`buildScopedPrompt`'s "NEVER invent…" lines, which *are* asserted) plus `applyScopedFields`'s blank
  rejection. Whether the model complies cannot be observed without calling it.
- **P3-23 (the unit-test half)** — the criterion asks for "a unit test in which a fake renderer is
  invoked exactly once per templated artifact across N passes". **That test does not exist.**
  `grep -rn "renderArtifact|fake render|renderer" api/test/*.mjs` returns only the two `indexOf`
  anchors inside the H33/H33b source greps. Only the source assertion half was built.

---

## 5. CRY-WOLF assessment of the H-case source greps

**Do they fire on correct code? No.** At `1916c55` the only red test is `H26` (§7.2); every H-case
that guards P3 passes on the unmodified tree. Zero false positives observed.

**Does `stripComments` actually work? Yes, for what it is used on.**
```js
const stripComments = (body) => body
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
```
Block comments are removed globally. For line comments the `[^:]` guard is doing real work: on
`const u = 'https://x.com/y' // note`, the regex cannot match at the `//` inside `https://` (preceded
by `:`), advances, matches the real comment, and `.*$` eats it — URL survives, comment dies. I
confirmed no guard fires on the unmodified tree.

**Its blind spots, none of which is currently triggering:**
1. **It does not strip SQL `--` comments.** `schema.ts` is one enormous template literal whose
   commentary is `--`-prefixed and therefore fully visible to every grep. `H32`'s regex
   (`delete\s+from\s+(swap_decision|…)\s+where\s+…`) would fire on a `--` comment that quoted the
   old statement. The current schema comment happens to phrase it as ``deleted 'where packet_id=$1'``
   and dodges it by wording, not by design.
2. **It is not string-literal aware.** A code string containing `//` not preceded by `:` would be
   truncated mid-line.
3. **No `/g` on the line-comment replace** — only the first `//` per line is considered.

**The real problem is not cry-wolf, it is the opposite: guards that cannot cry at all.** Four
assertions across `H32b`, `H35` and `H37` are inert (D-1, D-2), and `H36` is evaded by a rename
(D-3). The common root cause in three of the four is **searching the whole file for a substring that
also occurs in the idempotent migration block**, and in the fourth an **unbounded `[\s\S]*?` that
crosses table boundaries**. Both are mechanical and both are cheap to fix.

**Two guards deserve credit.** `H37` generalises correctly — it walks *every* composite FK, demands
the idempotent ALTER form specifically (rejecting the inline constraint, which is the subtle part),
and demands it appear earlier in the script. It failed when the defect was reinstated, naming both
byte offsets. And `H34b`'s "every counter column has a writer" is an invariant rather than an
incident, and it fired.

**A structural limit worth stating.** `H33` slices the loop body between two string literals and
greps for four names. A Drive call reached *transitively* through a helper would be invisible to it.
I checked transitively by hand (§3) and it is clean today, but the guard does not cover the case it
appears to.

---

## 6. Things I believe are wrong that the author did not claim

### 6.1 — **CRITICAL: the P3 schema still cannot migrate an existing database.** The `a0128f1` fix is correct and holds; a second defect of the same class remains and is unguarded.

This is the most important finding in this document, and it was reachable only because this container
had Postgres.

`pgMigrate.ts:15` runs the whole schema as **one statement**: `await client.query(SCHEMA_SQL)`. In
node-postgres that is the simple query protocol, which wraps every statement in one implicit
transaction — **any error rolls back all of it**.

I built a database with `main`'s schema (`44d1cfc`, i.e. production's shape) and then applied each
version of `SCHEMA_SQL`:

```
############ UPGRADE PATH (main 44d1cfc already applied) -> ce2a808
  psql:ce2a808.sql:368: ERROR:  column "loop" does not exist
  psql:ce2a808.sql:642: ERROR:  there is no unique constraint matching given keys for referenced table "check_result"
  psql:ce2a808.sql:643: ERROR:  relation "remediation_loop" does not exist
  psql:ce2a808.sql:644: ERROR:  relation "remediation_loop" does not exist
  exit=3 ; P3 tables created: 0

############ UPGRADE PATH (main 44d1cfc already applied) -> 1916c55
  psql:1916c55.sql:368: ERROR:  column "loop" does not exist
  exit=3 ; P3 tables created: 0
```

**The `a0128f1` fix holds.** The `there is no unique constraint matching given keys` error is gone at
`1916c55`. The author's diagnosis was right and is now confirmed against a live database rather than
argued.

**But the migration still aborts**, at `SCHEMA_SQL` line 368:
```sql
create index if not exists swap_dec_packet_idx on swap_decision(packet_id, loop, list, seq);
```
`create table if not exists swap_decision` is a no-op on an existing database, so its inline `loop`
column is never added; the column only arrives from `alter table swap_decision add column if not
exists loop int not null default 0` **at the foot of the file**; and the index above references
`loop` before that runs. Identical failure class to the one `a0128f1` fixed — a statement depending
on something only an idempotent alter provides, placed before that alter.

Reproduced at full production fidelity through `pg`, making the exact call `pgMigrate.ts` makes:
```
baseline (main schema) tables: 23
client.query(SCHEMA_SQL) -> THREW
  message : column "loop" does not exist
  code    : 42703
  P3 tables now present: 0
  swap_decision.loop present: 0
```
Because it is one implicit transaction, **nothing** commits — not the P3 tables, not
`swap_decision.loop`, not any of the unrelated idempotent alters in the file.

**It is the only one left, and the fix is a one-line move.** I moved that single index creation to
the foot of the file, changed nothing else, and re-ran the upgrade:
```
--- remaining errors on the upgrade path with just that one line moved ---
  P3 tables created: 2
```
Zero errors. Both P3 tables created.

**Why no test catches it.** `H37` guards **composite foreign keys** only. This is an **index**, so
`H37`'s regex never sees it. The invariant `H37` states — "for every composite FK … the constraint
that makes its target tuple unique must appear EARLIER in the script" — is the right idea scoped one
case too narrowly. The general rule is: *any statement referencing a column or constraint that only
an idempotent alter supplies must appear after that alter.* That covers indexes, FKs and CHECKs
alike.

**Recommendation:** move the `swap_dec_packet_idx` creation below the idempotent alter block, and
widen `H37` (or add a sibling) to cover `create index … (…)` against columns added by `add column if
not exists`. Best of all, run `SCHEMA_SQL` against a throwaway Postgres in CI on both paths (fresh
and upgraded-from-`main`) — the whole class disappears at once, and this container proves it costs
about a minute.

### 6.2 — A second run **can** still overwrite the first run's ledger, and the GET reports the wrong run.

`nextPassNumber` fixes the case the commit message describes. It does not cover
`appRemediation.ts:269`, where a run in which **no pass executed** writes its row with `n: 0`
hard-coded, ignoring `firstPass`:

- Two runs that both halt immediately both write `n = 0`, and `on conflict (artifact_id, n) do
  update` **overwrites the first**. That is the defect `nextPassNumber` was added to prevent, one
  branch over.
- `GET …/remediation` does `order by n` and `reportedOutcome` takes `rows[rows.length - 1]`, so a
  second run that converges immediately lands at position 0 and an **older** run's verdict is
  reported as current. Run against the compiled module:
  ```
  ledger as the GET reads it: n=0 (run 2, converged), n=1,2,3 (run 1, max_passes, 2 open)
  GET /remediation reports: { converged: false, haltReason: "max_passes",
    summary: "Halted after 4 pass(es) (max_passes) with 2 must-have requirement(s) still open." }
  ```
  It errs safe — it under-claims rather than over-claims — but the ledger and the run now disagree,
  which the comment at `appRemediation.ts:391` explicitly promises can never happen ("the outcome
  sentence is produced by the SAME function the run used, so the ledger and the run can never
  disagree about whether the loop converged").
- In that same branch `finalLoop = firstPass` while the stored row is `n = 0`, so `update
  remediation_loop set superseded_doc_url=$1 … and n=$3` targets a row that does not exist for this
  run, and escalations are stamped `loop: firstPass` rather than `0`.

### 6.3 — Calling `/remediate` on an already-converged artifact still issues a Drive copy.

`renderArtifact` at `appRemediation.ts:344` is gated only on `body?.render !== false`, never on
whether a pass ran. A call that makes zero model calls and halts immediately at `converged` still
issues a `files/{id}/copy` and overwrites `artifact.doc_url`. Per D-9 there is no Drive `DELETE`
anywhere in this codebase, so **every such no-op call orphans one more file** on the quota-bearing
account. `update packet set round = round + 1` also fires, so `packet.round` counts no-op calls as
rounds. X5's "4, not 4N" holds per run; "no unnecessary copy" does not.

### 6.4 — `posting_figure_echo` can fail in the same run that reports `converged`.

P3-40 requires that a figure taken from the posting but absent from the profile is rejected **and
that the requirement is not counted as closed by that figure**. `grep -n "figureEcho|figure_echo"` in
`appRemediation.ts` and `remediation.ts` → **no reference in either loop module**. `creditClosures`
credits on `coversText` alone, with no figure-echo veto.

`posting_figure_echo` *is* a deterministic check `runChecks` emits (`checks.ts:285/296/298`), so it
would turn the **gate** red — but `decidePass` and `reportedOutcome` consult only
`must_have_coverage`, never the gate. So the run can return `converged: true` with the summary
"every must-have requirement is covered" **alongside `gate: 'fail'` in the very same response
object**, on requirements closed with the employer's own numbers. The second half of P3-40 is not
implemented.

### 6.5 — `prompt_tokens` / `completion_tokens` are always written as 0, and `cost_usd` is a running total.

`appRemediation.ts:248` and `:274` hard-code `prompt_tokens: 0, completion_tokens: 0` into every
ledger row, though `tokensOf(gen.usage)` computed the real values one block earlier and handed them
to `logUsage`. Both schema columns are dead. `cost_usd` and `elapsed_ms` are written as **cumulative
run totals** on every row, not per pass — so a per-pass cost read off `remediation_loop` is wrong,
and once any pass runs on an unpriced model every subsequent row's `cost_usd` is `NULL`.

### 6.6 — X2's UI half is real but was already on `main`, and the main build button still does not send `regen`.

`git blame main -- app/src/screens/PacketBuilder.jsx` puts lines 346–352 at `c590dba5`, already
merged before this lane. More usefully: of the three `buildAll` call sites, only line 584
(`KeywordTallyOverlay`'s `onBuildAll`) sends `{regen:true}`. Line 490 — the button actually labelled
**"Build entire packet"** — and line 510's link both use `onClick={buildAll}`, so the click event
becomes `opts`, `opts.regen` is `undefined`, and those paths still replay the cached package.

### 6.7 — Smaller, but real
- **The composite FK makes the honest "no coverage evidence" ledger row unstorable.** Verified live: inserting the `n=0` / `no_coverage_evidence` row for a run with no `must_have_coverage` check raises the FK violation, which would 500 the request and leave *no* ledger — the opposite of the stated intent at `appRemediation.ts:263`. Unreachable today, because `runChecks` emits a `must_have_coverage` row on every branch (`checks.ts:364, 424, 426, 429`) and `evaluateArtifact` persists all results. It becomes reachable the day that check is made conditional.
- **`creditClosures` uses the union of a pass's edits.** `writtenText` is every changed field joined; a requirement whose tokens are split across two individually-inadequate rewrites is credited. Narrower than whole-document overlap, still union overlap.
- **`PATCH /remediation-prefs` does not validate.** `Number(b[k])` with no check: `{"maxPasses":"abc"}` sends `NaN` to an `int` column and 500s.
- **`pkg_json` is per-packet but the loop is per-artifact.** Remediating the resume rewrites the package the cover letter is also built from; after remediating artifact 2, artifact 1's rendered document is stale relative to `pkg_json`. Not a claim under test, but worth a decision.
- **P3-38's guard covers only two classes.** Row count and `fail → not_applicable`. A run that keeps the count identical while *replacing* requirement rows passes. No such writer exists on this branch.

---

## 7. The two changes I was asked to re-check

### 7.1 — The composite FK ordering fix (`a0128f1`): **the fix holds.**

Verified against a live database on the path that actually breaks, not by reading the diff. See §6.1
for the full output. In short:

- **`ce2a808` on an existing database** reproduces the author's diagnosis exactly:
  `ERROR: there is no unique constraint matching given keys for referenced table "check_result"`.
  The author found this; I did not. My first-pass verdict on item 3 said "the SQL executes" — that was
  true **only for a fresh database**, which is the one path that never had the bug. The author's
  find is real and my original coverage was incomplete.
- **`1916c55`**: that error is gone.
- **`H37`, the guard added with it, is live** — reinstating the defect fails it with both byte
  offsets named.

Two qualifications, both above: `H37`'s "for a fresh database" assertion is inert (D-2), and a second
defect of the same class survives at `SCHEMA_SQL` line 368 and still blocks the migration (§6.1).

### 7.2 — The H26–H31 → H32–H37 renumbering and the H28–H31 gap: **partly agree.**

**The facts, checked rather than assumed.**
- The branch's H IDs are `H1 … H27`, then `H32, H32b, H33, H33b, H34, H34b, H35, H36, H37`. Gap:
  **H28, H29, H30, H31.**
- The reservation is **real**. `origin/claude/qc-p8-3-evidence` (7 commits ahead of `origin/main`,
  unmerged) genuinely carries `test('H28'`, `test('H29'`, `test('H30'`, `test('H31'`.
- The renumbering is therefore **the right call**: `H26`'s own comment records that `H28` meant three
  different defects across three lanes, and this lane vacating the range removes the collision.

**Where I do not agree: the premise as put to me is not what I measured.** The request said "`main`'s
own H26 … currently reports a GAP". It does not. On `main` @ `44d1cfc`, `H26` **passes** — 301/301,
exit 0. The gap and the red test exist **only on the P3 branch**, and they are created by the
renumbering. That is a material difference: this is not a pre-existing condition on `main` that the
branch inherits; it is a failing test the branch introduces.

**So: reservation expected, red suite not.** Three reasons it should not ship red:

1. **`npm test` exits 1.** Merging this branch makes `main` red unless P8.3 lands first. A red main is
   not a state to reason about a lane from.
2. **The guard reports a false cause.** Its message is `a hardening case was lost in a merge — its ID
   is unused`, and its stated invariant is "no gaps that hide a case lost in a merge". Here nothing
   was lost. A guard that names the wrong cause is a guard people learn to override — which is the
   precise failure mode `H26`'s own preamble describes about prose lessons.
3. **It makes test status a function of merge order.** The branch is green only if P8.3 merges first.
   That is the same silent-merge fragility `H26` exists to surface, re-created in a new form.

**The fix belongs in `H26`, not in this branch.** `H26` currently allows no gaps at all:
```js
for (let i = 1; i <= nums[nums.length - 1]; i++) if (!nums.includes(i)) missing.push(`H${i}`)
assert.deepEqual(missing, [], 'a hardening case was lost in a merge — its ID is unused')
```
Give it an explicit reservation register — e.g. `const RESERVED = { H28: 'qc-p8-3-evidence', H29:
'qc-p8-3-evidence', H30: 'qc-p8-3-evidence', H31: 'qc-p8-3-evidence' }` — subtract declared
reservations from `missing`, and fail on any **undeclared** hole. That keeps the invariant intact,
keeps the pointer from `.claude/actions.md` resolving, makes the reservation legible to the next
lane, and gets the suite back to green without weakening anything.

---

## 8. What I did not verify, and how to reproduce what I did

**Not verified:** anything in §4; the behaviour of the model inside `regenerateFields`; and any live
Drive or Function behaviour.

**Reproducing the Postgres work** — it needs no cloud access and took under a minute:
```bash
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/qcdata -U postgres -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/qcdata \
  -o '-k /tmp -p 5433 -c listen_addresses=' -l /var/lib/postgresql/qcdata/log start -w"

# extract SCHEMA_SQL from any revision
git show <rev>:api/src/functions/tests/schema.ts \
  | sed -n '/export const SCHEMA_SQL = `/,/^`;/p' | sed '1s/.*SCHEMA_SQL = `//' | sed '$d' > /tmp/s.sql
# pgvector is absent in this container; shim the three vector lines (unrelated to P3)

# the path that matters: existing database, then the branch
psql -h /tmp -p 5433 -U postgres -c 'create database up'
psql -h /tmp -p 5433 -U postgres -d up -f /tmp/main.sql
psql -h /tmp -p 5433 -U postgres -d up -f /tmp/branch.sql     # <-- the errors appear here
```
Adding this to CI on both paths — fresh, and upgraded-from-`main` — would have caught both §6.1
defects and `a0128f1`'s, and would retire the whole "no Postgres in the sandbox, so it is asserted
structurally" category of guard.

**All mutation experiments were local and reverted.** After every one: `git status --porcelain` empty,
`git rev-parse HEAD` unchanged, suite re-run. No commit was made to `claude/qc-p3-remediation` and
nothing was pushed to it.

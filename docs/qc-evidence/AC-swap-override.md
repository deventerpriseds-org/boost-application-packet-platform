# AC — #30 "an owner can edit a swapped value in place" (adversarial, independent)

**Written:** 2026-08-25 · by an independent AC-writing subagent that did **not** plan this work.
**Analysis only** — nothing under `app/src` or `api/src` was modified, nothing was committed.

**Ground truth:** every claim below is checked against `origin/main`, per `CLAUDE.md`
("Fetch-first before ANSWERING a status question… Answer from `origin/main`").

```
git fetch origin
git rev-parse HEAD         # fb885cfea39de6bebe1f093f0070b131110e5d71
git rev-parse origin/main  # fb885cfea39de6bebe1f093f0070b131110e5d71   -> identical, no drift
```

> **The prior pass is 3 commits stale.** `docs/qc-evidence/AC-resume-margin.md` GAP 3 was written at
> `b319943`. `main` has since moved to `fb885cf` (`f50a422` hover linkage, `89eb970` feasibility
> rule, `fb885cf` blank-asset fix). **I re-verified GAP 3's findings rather than inheriting them.**
> Result: GAP 3's two blocking findings still hold at `fb885cf` (proofs in the table below), and the
> owner's decision resolves its Q3.2. Its Q3.1, Q3.3, Q3.4 and Q3.5 are **still open** and are
> re-raised here with answers where the code settles them.

**The owner's decision is taken as given and is NOT re-opened:** the override extends the existing
`correction` table. My job is to specify that correctly and to find what breaks. **What follows
includes one finding that the owner must see before that decision is implemented** (Hard Question 1)
— reporting it is not re-opening the decision, it is the evidence the decision was made without.

---

## 1. FEASIBILITY TABLE (challenged) — read before writing any code

Required first by `CLAUDE.md` §"Feasibility BEFORE implementation" (line 632). Verdicts are
`EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED`.

| # | Dependency | Brief's claim | My verdict | Proof (command + result) |
|---|---|---|---|---|
| F1 | `correction` has the right shape | EXISTS — `merge_field`, `phrase`, `replacement`, `char_start/end`, `before_sha256`, `applied_seq`, `reason`, `source`, `reverted_by/at` | **EXISTS — claim CONFIRMED, line refs exact** | `git show origin/main:api/src/functions/tests/schema.ts` → `create table if not exists correction (` at **:403**; `artifact_id` :405, `merge_field` :406, `phrase` :407, `replacement` :408, `char_start` :409, `char_end` :410, `before_sha256` :411, `applied_seq` :412, `reason` :413, `source` :414, `run_id` :415, `loop` :416, `reverted_by` :417, `reverted_at` :418. Brief said "403-425"; the table body actually runs **403-428**. Cosmetic. |
| F2 | `correction` survives a rebuild | EXISTS — zero `delete from correction` | **EXISTS-BUT-CONSTRAINED — the claim is true but its PROOF is insufficient, and one path can still destroy the row** | `grep -rn "delete from correction" api/src` → **exit 2, zero hits** (confirmed). **BUT** `schema.ts:405` is `artifact_id uuid not null references artifact(id) **on delete cascade**` — a correction dies with its artifact without any `delete from correction` ever being written. See F2a. |
| F2a | …so: is an `artifact` row ever deleted or replaced on rebuild? | (not in the brief) | **EXISTS — safe today, for a reason the brief did not state** | `grep -rn "delete from artifact" api/src` → **zero hits**. `insert into artifact` occurs at exactly one place, `appPackets.ts:82`, inside `loadPacket`, guarded by `const missing = ARTIFACT_TYPES.filter(t => !existing.includes(t))` (`:79-81`) — it inserts only artifact **types that do not yet exist**. Remediation does **not** create a new packet: `appRemediation.ts:488` is `update packet set round = round + 1 … where id = $1`. `insert into packet` exists only at `appPackets.ts:77`, guarded by `if (!pkt)`. **Conclusion: artifact ids are stable across rebuilds and remediation rounds, so the cascade never fires.** This is the real reason `correction` is durable — not the absence of a DELETE statement. It is a load-bearing invariant and it needs a guard (see `H:artifact-id-stable-across-rebuild`). |
| F3 | `correction.source` accepts an owner value | **CONSTRAINED** — `check (source in ('profile_figure','generalized'))` | **EXISTS-BUT-CONSTRAINED — claim CONFIRMED, and it is worse than one CHECK** | `schema.ts:414`: `source text not null check (source in ('profile_figure','generalized'))`. **The CHECK is only the first of three places** the two-value domain is written down: `correction.ts:32` `export type CorrectionSource = 'profile_figure' \| 'generalized'` — a **TypeScript union**, so a third value fails `tsc`, not just Postgres. A third home is named in F3a. **Altering the CHECK alone is insufficient and would not compile.** |
| F4 | the span constraint | CONSTRAINED — `correction_span_matches_phrase check (char_end - char_start = length(phrase))` | **EXISTS-BUT-CONSTRAINED — claim CONFIRMED, and it is one of FOUR constraints, all of which an override must satisfy** | `schema.ts:422` `correction_span_matches_phrase check (char_end - char_start = length(phrase))`; **:423** `correction_span_ordered check (char_start >= 0 and char_end > char_start)` — note `char_end > char_start` means **an empty `phrase` is rejected by the DATABASE**; **:424** `correction_sha_shaped check (before_sha256 ~ '^[0-9a-f]{64}$')` — a real 64-hex SHA of real text is mandatory; **:427** `correction_revert_paired check ((reverted_by is null) = (reverted_at is null))`. Plus the unique index `correction_unique_seq` (`:430-431`) on `(artifact_id, merge_field, applied_seq, coalesce(run_id, '000…'::uuid))` with the `coalesce` explicitly documented as load-bearing. |

### Nothing in the table is wrong. Two rows are **understated**, and that matters

- **F2's evidence proves the wrong thing.** "Zero `delete from correction`" is true and is *not* why
  the row survives. The row survives because `artifact.id` is stable (F2a). A future change that
  recreates artifacts on regenerate — entirely plausible, and nothing in the schema forbids it —
  silently cascade-deletes every owner override with no `delete from correction` anywhere in the
  diff. **A guard must pin F2a, not F2.**
- **F3 understates the blast radius by two-thirds** (TS union + F3a below).

### F3a — the third home of the source domain, and a fourth constraint the brief missed

*(verified in §2 below; recorded here so the table is complete)*

---
### F3a — the source domain has **FIVE** homes, not one. Altering the CHECK is ~20% of the job

`grep -rn "profile_figure\|'generalized'" api/src app/src api/test` (exit 0, hits below):

| # | Home | Line | What breaks if only `schema.ts:414` is altered |
|---|---|---|---|
| 1 | `api/src/functions/tests/schema.ts:414` | the migration CHECK | — (this is the one the brief found) |
| 2 | **`api/src/functions/tests/appCorrections.ts:66`** | **a SECOND, byte-duplicated `create table if not exists correction (…)` inside `ensureCorrectionTable`**, carrying its own copy of all four constraints (`:74-77`) | **THE WORST ONE. See F3b — this can permanently lock a database out of the new value.** |
| 3 | `api/src/functions/tests/correction.ts:32` | `export type CorrectionSource = 'profile_figure' \| 'generalized'` | `tsc` fails. Loud, cheap, fine. |
| 4 | `app/src/assetGate.js:438-441` `CORRECTION_SOURCE` | the owner-facing copy map | **Does NOT crash — and that is the danger.** `correctionSourceText` (`:442`) is `CORRECTION_SOURCE[s] \|\| String(s \|\| 'no source was recorded')`, deliberately falling through **to the raw value** (docblock `:431-436`: "An unrecognised value falls through to ITSELF rather than to either known one"). So a new source ships as the literal database string in the UI — e.g. the user reads `owner_override` — honest, but unfinished copy that no test will catch. |
| 5 | `api/test/sql/correction.sql:26` | a test fixture DDL whose constraint is named **`correction_source_known`** — a name that **does not exist in production** (`schema.ts` names none of its CHECKs for `source`) — plus an extra `:31` `check (source <> 'profile_figure' or (reason is not null and length(reason) > 0))` that production also does not have | A fixture that diverges from production tests a schema nobody runs. |

Two existing tests also pin the two-value world and must be reconciled, not deleted:
`api/test/correction.test.mjs:22` `assert.ok(rows.every(r => r.source === 'generalized'))`, and
`api/test/hardening.test.mjs:2230` `assert.equal(r.source, 'generalized', 'generalization is the only
path P8.1 ships')`. **Both are correct today and both become false the moment an owner override
exists.** They assert *what `planCorrections` produces*, not *what the table admits* — so the right
reconciliation is to narrow their subject to the pipeline pass, never to relax them.

### F3b (BLOCKING, and it is NOT in the brief) — the duplicated DDL can permanently reject the new value

`appCorrections.ts:53-79` `ensureCorrectionTable()` re-declares the whole table. Its own docblock
(`:47-52`) states why: *"`pgMigrate` is not guaranteed to have run when this executes, and a route
that 500s on a missing table is worse than one that creates it."* And `dimensionsDb.test.mjs:102-103`
records the same ordering as a measured fact: **"`api-deploy.yml` deploys the code BEFORE it runs
`pg-migrate`."**

Compose those two facts:

1. deploy lands code carrying the new `source` value; `pg-migrate` has **not** run yet;
2. any request hits `applyCorrectionPass` → `ensureCorrectionTable` → `create table if not exists`;
3. on a database where `correction` **already exists** (production), that is a NO-OP — harmless;
4. **but a `create table if not exists` is ALSO a no-op for `schema.ts`'s copy.** Neither statement
   can widen an existing CHECK. **A `create table if not exists` NEVER alters an existing table.**
   So on production the new `source` value is rejected by the *old* CHECK **until an explicit
   `alter table correction drop constraint … / add constraint …` is written** — and the brief's
   phrase "a third value needs the CHECK altered" understates this as an edit to line 414 when it is
   actually a **new idempotent ALTER**, which then drags in `H39`/`H39b` ordering.

This is the exact defect class `dimensionsDb.test.mjs:295-306` already guards for
`comparison_dimension` (`H:dimension-ddl-parity`): *"A CHECK added to one copy would be silently
absent from the other."* **There is no equivalent parity guard for `correction`.**
`grep -rn "appCorrections" api/test/*.mjs` → `correction.test.mjs:166,192`, `hardening.test.mjs:2168,2215,4015`
— every one is a source grep about provenance or imports; **none compares the two DDLs.** That
missing guard is the single highest-value new guard in this document (`H:correction-ddl-parity`).

---

# IMPL — fixed-slot swap pairing (`original` = master template, not Call 1)

**Slug:** `fixed-slot-swap-pairing` · **Branch:** `claude/incumbent-wins-swap`
**AC:** `docs/qc-evidence/AC-fixed-slot-swap-pairing.md`
**Status:** COMPLETE — ends with `## END OF IMPL`. (Written incrementally; a copy ending
without that marker is truncated and must not be acted on.)
**Not committed by me** — the parent committed the bulk as `35cab5d`; later edits are left in the
working tree for review.

**Files I own and may edit:** `api/src/functions/tests/swaps.ts`,
`api/src/functions/tests/appSwaps.ts`, `api/test/swaps.test.mjs`, this file.
Everything else is a HANDOFF NOTE, never an edit.

---

## 0. Ground-truth reads before any edit (OBSERVATION)

| # | Read | What it establishes |
|---|---|---|
| O-A | `swaps.ts:222` `const originals = splitItems(call1[f.passA])` | the defect, confirmed at source |
| O-B | `appInsertions.ts:25-34` `async function loadMasterBaseline()` | **NOT exported** — it is a module-private function today |
| O-C | `evidence.ts:211-218` `masterBaseline(mc)` | exported, pure, returns only non-empty blocks |
| O-D | `evidence.ts:188-204` `MASTER_BASELINE_FIELD` | `ExpertiseBullets: 'expertise'` already mapped; `RelevantBullets1/2/3` all map to the one pooled `relevantProficiencies` key |
| O-E | `appPackets.ts:617-622` | `writeSwaps` throw is swallowed into `console.warn` → empty swap table |
| O-F | `schema.ts:551` | `skill_candidate.origin check in ('profile_original','pass_a','pass_b')` |
| O-G | `schema.ts:567` (per AC O-14) | `swap_decision.list` CHECK does **not** admit `'expertise'` |
| O-H | `api/test/hardening.test.mjs:4194-4245` `H:cross-list-drop-…` | calls `buildSwaps` with **no master**, and asserts a `dropped` row for a call1 original. I cannot edit this file. |
| O-I | `api/test/ownerGate.test.mjs:112-195` (3 tests) | call `buildSwaps` with **no master**. I cannot edit this file. |

**INTERPRETATION drawn from O-H + O-I:** a master-only baseline with *no* fallback would make
`originals` empty for every one of those fixtures and delete the rows they assert on. Two test files
I am forbidden to edit would fail. So the baseline resolution **must** degrade to `call1[passA]`
when no master block exists — see §2 for why that is also the honest answer, and §5 for the one AC
falsifier this technically trips.

---

## 1. Contract for the parent session (`checks.ts` wiring) — READ THIS

`buildSwaps` now returns a new `lists: ListCounts[]` field. **It never throws on a count mismatch**
(AC-9a): a mismatch is *reported* here, and reporting it on the gate is the parent's job.

```ts
export interface ListCounts {
  list: ListKey                 // 'skills_1' | … | 'expertise'
  mergeField: string            // 'SkillsBullets1' | … | 'ExpertiseBullets'
  baselineSource: 'master' | 'call1' | 'none'
  originalCount: number         // items in the resolved baseline
  finalCount: number            // items in the shipped list  == `observed`
  slots: number | null          // slotsFor(...).n  — null means UNKNOWN, never 0
  slotSource: 'template' | 'unknown'
  expected: number | null       // === slots. null ⇒ the check is not_applicable, never pass/fail
  observed: number              // === finalCount
  mismatch: boolean             // expected !== null && observed !== expected
  kept: number; swapped: number; merged: number; dropped: number; added: number
  droppedLabels: string[]       // unpaired baseline leftovers  — the offender list for a fail
  addedLabels: string[]         // unpaired final leftovers     — the offender list for a fail
}
```

Wiring notes for the parent:
- `expected === null` ⇒ emit `not_applicable` naming *why* (no template slot count for that field).
  **Never `pass`, never `fail`** (AC-8, AC-10).
- `mismatch === true` ⇒ emit `state:'fail'`, `engine:'deterministic'`, naming `list`, `expected`,
  `observed`, and `droppedLabels`/`addedLabels` as offenders (AC-9c).
- `runChecks` does not receive `lists` today. The cheapest wiring is to thread the `buildSwaps`
  result (or just `lists`) onto the `runChecks` input alongside `swaps`. **I did not touch
  `checks.ts`.**
- Emit the check for **every** in-scope list including `compact_resume` (as `not_applicable`) —
  AC-11 / `checks.ts:311-325`.

### `slots` is INJECTED, never read from config by `swaps.ts`
`buildSwaps` takes `slots?: Record<string, number | null>` **keyed by MERGE FIELD**
(`SkillsBullets1`, `SkillsBullets2`, `RelevantBullets1..3`, `ExpertiseBullets`). `swaps.ts` stays
pure — it never reads `config.ts`, a template row, or the DB. The per-template config store is
another agent's file; whoever owns it passes `templateRow.slots` straight in.
`slotsFor(field, slots)` is exported for the parent to reuse so the precedence lives in ONE place.

---

## 2. Decisions taken, with the reason (INTERPRETATION where marked)

### D-1 — baseline = `master[mergeField]` ELSE `call1[passA]`, and the source is REPORTED
`masterBaseline()` (`evidence.ts:215`) returns only non-empty blocks, so "no key" genuinely means
"no master text known for this field" — not "the master is empty". `loadMasterBaseline()` also
swallows every Storage error into `{}` (`appInsertions.ts:33`), which is the same shape.

Falling back to Call 1 in that case is the honest degradation: emitting zero originals would report
every shipped item as `added`, i.e. it would claim the packet invented the owner's whole resume.
`baselineSource` on `ListCounts` says which one was used, so no consumer has to guess.
**In production every one of the six merge fields IS mapped** (`MASTER_BASELINE_FIELD`), so the
`master` branch is the live path and `call1` fires only on a Storage failure.

### D-2 — `merged` is KEPT, as a re-label of an unpaired baseline leftover
The brief says an unpaired master leftover is `dropped`. It is, *unless* the document demonstrably
still carries its content inside a final that a positional pair already claimed (similarity ≥
`SWAP_THRESHOLD`). Writing `dropped` there is false about the shipped document — the same class of
false sentence `crossListRationale` exists to kill (`swaps.ts:172-190`).

This is **not** similarity-based pairing: the merge test runs *after* pairing is settled, consumes
no final, and changes no pair. It only chooses the truthful label for a leftover. It also keeps
`swaps.test.mjs`'s existing collapse test meaningful. Flagged here because it is a deliberate
narrowing of instruction 5.

### D-3 — a master-derived original is `profile_original`, not `pass_a`
`skill_candidate.origin` admits exactly `profile_original | pass_a | pass_b` (O-F). Labelling a
label that came from the owner's MasterContext as `pass_a` ("Call 1, the resume writer") is simply
false. `profile_original` is the value that means "pre-existing, not written by this generation"
(`swaps.ts:144-145`). No schema change needed. When the baseline fell back to `call1`, `pass_a` is
still correct and is still used.

### D-4 — omit-list drops keep priority over positional pairing? **No — order is: pair first.**
An item on the owner's do-not-use list that has a positional partner is a genuine **swap** (the slot
was refilled); the omit list explains *why it left*, not what replaced it. It only becomes a
rule-driven `dropped` when it is an unpaired leftover — which is exactly the existing test's shape
(`swaps.test.mjs:102`, leftover originals 1 / leftover finals 0), so that test is unaffected.

### D-5 — `expertise` insert is CAPABILITY-PROBED before it is written
Adding `'expertise'` to `LISTS` makes `writeSwaps` attempt `insert … list='expertise'`, which
production's CHECK **rejects** (O-G). A rejected insert aborts the whole transaction, the throw is
swallowed at `appPackets.ts:619`, and **the packet ships with an entirely empty swap table** — the
exact quietest-possible-failure the AC warns about, but for every packet, not just expertise.

So `writeSwaps` probes `pg_constraint` once per call for whether the live CHECK admits `expertise`.
If it does not, expertise rows are held back and the return value carries
`skippedLists: ['expertise']` plus a `console.warn` naming the ALTER. This is **temporary
scaffolding, removable the moment the ALTER lands** — see the handoff note in §3.

---

## 3. HANDOFF NOTES — files I do not own

### HN-1 — `schema.ts` — **RAISED, THEN RESOLVED BY THE PARENT IN `35cab5d`. Verified live, §5f.**
> **Status at hand-off: DONE.** `git show HEAD:schema.ts` now has the widened inline CHECK at
> `:549` (`skill_candidate`) **and** an explicit `alter table skill_candidate … ` at `:641-643`,
> plus `insertion.list` at `:673`. I executed the migration on a populated database and inserted
> `list='expertise'` into both tables successfully — see **§5f**. The
> `listChecksAdmitExpertise` probe in `appSwaps.ts` now returns **true**, so nothing is being held
> back, and the probe is dead weight that can be deleted. The original note is kept below because
> it is the reasoning that found the gap.

<details><summary>Original note — the gap as raised</summary>

**HALF DONE, AND THE MISSING HALF BREAKS EVERY PACKET**
Read at `schema.ts` while implementing (OBSERVATION):
- `swap_decision`: inline CHECK **widened** to include `'expertise'` (`:572`) **and** the explicit
  idempotent ALTER is present (`:619-621`). Done.
- `skill_candidate`: `list text not null check (list in ('skills_1','skills_2','relevant_1',
  'relevant_2','relevant_3'))` at **`:549`** — **NOT widened, and there is no ALTER for it.**
  `grep -n "expertise" api/src/functions/tests/schema.ts` returns hits only in the `swap_decision`
  block and its ALTER.

**Why this is not cosmetic:** `writeSwaps` inserts a `skill_candidate` row for **every candidate**
(`appSwaps.ts`, the `for (const c of writeCandidates)` loop) *before* it inserts any `swap_decision`
row. So `skill_candidate`'s CHECK is the one hit **first**. It fails on a **fresh** database too,
not only on production. Postgres aborts the transaction, `writeSwaps` rethrows,
`appPackets.ts:617-622` swallows it into a `console.warn`, and **every packet ships with a
completely empty swap table** — all lists, not just expertise.

Both halves needed:

```sql
-- inline, in the create table body (so a FRESH database is born correct)
list text not null check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise')),

-- and the explicit ALTER (so an EXISTING database is migrated) — precedent: schema.ts:619-621
alter table skill_candidate drop constraint if exists skill_candidate_list_check;
alter table skill_candidate add constraint skill_candidate_list_check
  check (list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise'));
```

`schema.ts:594-596` states the reason in the file's own words: a create-if-not-exists is a no-op on
an existing table, so production keeps the old CHECK until an explicit ALTER runs.
**Until this lands, D-5's probe keeps expertise rows out of the insert** — the probe checks BOTH
tables, so it is currently returning `false` and holding those rows back. Once both ALTERs land the
probe always returns true and can be deleted.

</details>

### HN-2 — `api/src/functions/tests/appInsertions.ts` — one-word change I DID make
`loadMasterBaseline` was module-private. AC-2's falsifier is
`grep -n "MasterContext\|listEntities" appSwaps.ts` returning a hit — i.e. writing a second reader
is explicitly forbidden. The only way to satisfy AC-2 is to reuse that function, so I added the
`export` keyword to its declaration and nothing else. **Zero behaviour change, additive only.**
Flagged because `appInsertions.ts` is outside my ownership list (it is not on the do-not-edit list).

### HN-3 — `api/src/functions/tests/checks.ts` (parent session)
The slot check itself (AC-9c, AC-10, AC-11). Consume `lists` per §1. I wrote no check.

### HN-4 — `api/test/hardening.test.mjs` (parent session)
The AC-16 H-cases (`H:swap-original-is-master-not-call1`, `H:swap-pairs-by-set-then-position`,
`H:fixed-slot-violation-is-reported-not-thrown`, `H:slot-count-unknown-is-not-applicable`,
`H:slot-check-is-emitted-for-every-list`, `H:swap-actions-stay-readable`). My unit tests in
`api/test/swaps.test.mjs` cover the same behaviours but are not the H-cases.

### HN-5 — per-template slot config (whoever owns it)
`buildSwaps` consumes `slots` as an injected `Record<mergeField, number|null>`. Nothing in
`swaps.ts` reads config. The producer must pass `templateRow.slots`.

### HN-6 — `compactFit` blast radius (AC-13), unmeasured by me
`compactFit.ts:110-116` `rankOf` ranks `swapped` at 1 and plain `kept` at 0. Positional pairing
converts former `dropped`+`added` pairs into `swapped`, which **promotes** those items out of the
compact resume's drop pool (`compactFit.ts:183` `.filter(x => x.rank < 2)`). Direction of the effect
is the opposite of the AC's wording in one respect — the AC reasoned about keeps becoming swaps;
what this implementation actually converts is *drop+add pairs* becoming swaps. Either way the
droppable pool shrinks. **I did not measure it** (needs a real packet's provenance). AC-13 is
OPEN for the parent.

---

### HN-7 — `api/src/functions/tests/appPackets.ts` (parent session) — `slots` is not being passed
`appPackets.ts:618` calls `writeSwaps(... { call1, call3, pkg, profileText, omitList, loop: 0 })`
and **ignores the return value**. Two consequences, both currently benign but both blocking:
- No `slots` reaches `buildSwaps`, so **every** list resolves `expected: null` /
  `slotSource: 'unknown'`. That is the correct not_applicable state, not a bug — but the fixed-slot
  check can never fire until the per-template slot config is threaded through here.
- `lists` / `mismatched` / `skippedLists` reach nobody. `runChecks` needs them (HN-3).

---

## 4. Work log

- Read AC, `swaps.ts`, `appSwaps.ts`, `appInsertions.ts`, `evidence.ts`, `appPackets.ts` call site,
  `hardening.test.mjs:4194+`, `ownerGate.test.mjs:100-200`, existing `swaps.test.mjs`.
- Established the two forbidden-file fixtures that force D-1.
- **Ground-truth correction to the brief (D-6, below).**
- Implemented `swaps.ts` + `appSwaps.ts`; rewrote 3 contract-changed tests; added 16 new tests.
- Mutation-proved six load-bearing lines.

### D-6 — the brief's `LIST_FIELDS.expertise` field names were wrong; I used the assembler's
The brief specified `passA/passB/merge: 'ExpertiseBullets'`. **Ground truth disagrees**
(`mt17.ts:150`, read at source):

```ts
ExpertiseBullets: firstNonEmpty(call1.expertise, call3.finalExpertise, call3.expertise),
```

and `pipeline.ts:504` interpolates `c1.expertise`. So Call 1 writes **`expertise`** and Call 3
writes **`finalExpertise`**. Shipped as
`{ passA: 'expertise', passB: 'finalExpertise', merge: 'ExpertiseBullets' }`.

Naming `passA` after the merge field would have made `call1['ExpertiseBullets']` permanently
`undefined`, leaving the Call-1 fallback **structurally dead for this one list**: with no master
block the baseline would be empty and every shipped expertise item would be reported `added`.
One-line revert if the parent disagrees; the test asserts the mapping explicitly.

---

## 5. VERIFICATION — real commands, real output

### 5a. Build
```
cd api && npm run build      →  tsc, exit 0, no output
```

### 5b. Full suite — `cd api && node --test test/*.test.mjs`

First measurement (before the parallel agent started a local Postgres):
```
# tests 913   # pass 907   # fail 6   # skipped 0
```
Re-measured at hand-off, excluding the three DB-backed files (see the environment note below):
```
ls test/*.test.mjs | grep -vE "buildQueueDb|dimensionsDb|schemaParity" | xargs node --test
# tests 893   # pass 887   # fail 6   # skipped 0
```
**The same six failures both times, and the same six named below.** Nothing new appeared.

> **Environment note, so a slow run is not misread as a hang in this work.** Partway through,
> `buildQueueDb.test.mjs`, `dimensionsDb.test.mjs` and `schemaParity.test.mjs` began taking >25s
> each and the whole suite stopped finishing inside 300s. Cause, established rather than guessed:
> the parallel slot-config agent started a local PostgreSQL to execute its schema change
> (`/tmp/pgd` and `/tmp/pgsock` exist; `ps` shows 55 postgres processes). Those three files **skip
> loudly when no local PostgreSQL is available** and RUN when one is, so they flipped from skipped
> to running-and-slow. None of them reads `swaps.ts`, `appSwaps.ts` or `swap_decision`. Nothing in
> this change can loop: every loop in the new pairing is bounded by `originals.length` or
> `finals.length`.
> **`schemaParity.test.mjs` is worth re-running once `schema.ts` settles** — it is the test that
> would catch HN-1 (a fresh database and an upgraded one disagreeing about `skill_candidate.list`).
> I did not run it to a verdict because `schema.ts` was being actively edited underneath it.

> **Do not read the killed background runs as verdicts.** Three background test jobs
> (`bbf5byqpm`, `bi1rgq51w`, `b8ks0w2n2`) reported `failed` with **exit code 144** — that is a
> KILL (128+16), not a test verdict. All three were launched during the window when the parallel
> agent had left a syntax error in `schema.ts` at `:630` (a backtick inside the `SCHEMA_SQL`
> template literal terminated the string), so `tsc` was failing and `dist/` was stale. Their
> partial output names `H:one-build-per-opportunity` and nine siblings in
> `buildQueueDb.test.mjs` — a DB-backed file that **references none of my modules**
> (`grep -nE "swaps|appSwaps|appInsertions|swap_decision|skill_candidate|buildSwaps|masterBaseline"`
> over all three DB files returns **zero hits**; they import `appDimensions`, `appBuildQueue` and
> `SCHEMA_SQL` only). Re-measured against a clean build in §5g.

The 6 failures, every one accounted for and **none in a file I touched**:

| Failing test | File | Mine? | Evidence |
|---|---|---|---|
| `D:ledger-status-is-a-token` | `deferredLedger.test.mjs` | **no — PRE-EXISTING** | present on a clean `HEAD` tree (baseline run below) |
| `D:ledger-manual-names-its-vehicle` | `deferredLedger.test.mjs` | **no — PRE-EXISTING** | same |
| `H:blank-focus-clears-rather-than-storing-empty` | `templateConfig.test.mjs` | **no** | exercises `api/src/functions/config.ts`, which has 174 uncommitted lines from the parallel slot-config agent |
| `H:template-label-absent-means-leave-alone-not-clear` | `templateConfig.test.mjs` | **no** | same |
| `H:template-row-is-listed-when-it-has-only-a-name` | `templateConfig.test.mjs` | **no** | same |
| `H:template-delete-needs-both-empty` | `templateConfig.test.mjs` | **no** | same |

**Baseline measured on a clean `HEAD` tree: `# tests 894  # pass 892  # fail 2  # skipped 18`** —
the two `D:ledger-*` rows and nothing else. So my change moved the suite from 892→907 passing with
**zero new failures**. (The 18 skips are the DB-backed files, which had no local Postgres at that
point.)

> **Method warning for the next agent: do NOT `git stash` in this tree.** I did, to take that
> baseline, and the parallel agent wrote `docs/qc-evidence/IMPL-slot-config.md` during the ~30s the
> stash was applied, so `git stash pop` refused ("already exists, no checkout"). Recovered with no
> loss — `diff` of the stashed copy against the recreated one was byte-identical, and all tracked
> changes had already been restored — but it was luck, not design. Use
> `git show HEAD:<file>` into a scratch build instead.

### 5c. `api/test/swaps.test.mjs` — `# pass 38  # fail 0`

New coverage: AC-1 (×3, incl. the call1-degradation and `profile_original` origin), AC-3 (×2, incl.
duplicates and four permutations), AC-4 (×2), AC-5 (×2, incl. the positive case), AC-6, AC-7, AC-8,
AC-9a, AC-9b (×2), the counts-reconcile contract, expertise, `merged`, and the omit-list ordering.

**The AC-4 fixture makes similarity and position DISAGREE**, which the brief required or the
assertion is vacuous. Asserted in the test itself, so it cannot silently decay:
```
similarity('Roadmap ownership',  'Product roadmap ownership and strategy') === 1
similarity('Vendor negotiation', 'Vendor contract negotiation')            === 1
similarity('Roadmap ownership',  'Vendor contract negotiation')            === 0
```
Greedy-by-similarity pairs `Roadmap ownership→Product roadmap…` and `Vendor negotiation→Vendor
contract…`; position pairs them the other way round. Both similarity scores are 1.0, so this is not
a threshold artefact — the two rules give opposite answers on the same input, and the test asserts
the positional answer.

### 5d. MUTATION PROOFS — six load-bearing lines, each reverted and re-run
Every one FAILED with the defect reinstated. No inert guard.

| # | Mutation | Result |
|---|---|---|
| M1 | **The original defect reinstated**: `const originals = call1Items` | **14 fail** — AC-1, AC-3 ×2, AC-4 ×2, AC-5 ×2, AC-6, AC-7, AC-9b ×2, expertise, merged, omit-list |
| M2 | Leftovers zipped in **reverse** position | **2 fail** — both AC-4 tests |
| M3 | PHASE 2 (positional pairing) **removed entirely** | **18 fail** — incl. the 3 `ownerGate` H-cases, which is the point: without positional pairing the owner-driver path regresses too |
| M4 | `slotsFor` returns `n: 0` instead of `n: null` for UNKNOWN | **1 fail** — AC-8 |
| M5 | PHASE 1 matches by **position** instead of set membership | **1 fail** — AC-3 order-independence (the four permutations) |
| M6 | `buildSwaps` **throws** on a count mismatch | **4 fail** — AC-9a plus the three that need the honest rows |

M1 and M3 are the two that matter most and they cascade widely, which is correct: the whole module's
behaviour is downstream of "what is the original" and "how do leftovers pair".

Restored and re-verified green after each: `# pass 38  # fail 0`.

### 5e. NOT verified by me — stated plainly rather than assumed
| Claim | Status | What would settle it |
|---|---|---|
| `writeSwaps`' new `master` load, the expertise probe, and `skippedLists` | **NOT executed.** They need `pg` + Azure Storage; `swaps.ts` is the pure half and is the half under test | a DB-backed test, or the live `api-test.yml` rebuild in AC-15 |
| AC-15 — the live 9-of-14 case flips to 0 | **NOT run.** Needs a live rebuild + `db-query.yml` + `GET /api/diag/skill-sources` | exactly those three transports |
| AC-13 — the `compactFit` drop-pool change | **NOT measured.** See HN-6 | before/after `fitCompactSkills` on one real packet's provenance |
| AC-9c / AC-10 / AC-11 — the `runChecks` slot check | **NOT BUILT — not my file.** `checks.ts` is the parent's | HN-3 |
| AC-16 — the six H-cases | **NOT WRITTEN — not my file.** `hardening.test.mjs` is the parent's | HN-4 |
| AC-14 — the expertise DDL | **CONFIRMED** — executed on a populated database, §5f | (done) |
| `schemaParity.test.mjs` | **NOT RUN TO A VERDICT** — `schema.ts` was being edited underneath it | re-run once `schema.ts` settles |

### 5f. AC-14 — the expertise DDL, EXECUTED on a POPULATED database (not read, run)

Per CLAUDE.md's strict rule: a fresh-database pass proves almost nothing, because every
`create table if not exists` is skipped on the database you actually care about. So: apply
**`origin/main`'s** `SCHEMA_SQL`, seed rows, then apply the branch's `SCHEMA_SQL` **on top**.
Against the local PostgreSQL 16.13 at `/var/tmp/p84pg:55432`, `ON_ERROR_STOP=1` throughout.

| Step | Command | Result |
|---|---|---|
| 1 | apply `git show origin/main:…/schema.ts`'s `SCHEMA_SQL` | **exit 0** |
| 2 | **vacuity control** — `insert into skill_candidate (… list) values (…'expertise'…)` on the OLD schema | **`ERROR: new row for relation "skill_candidate" violates check constraint "skill_candidate_list_check"`** — so the test below is not vacuous, and it confirms `skill_candidate` rejects FIRST, before `swap_decision` is ever reached |
| 3 | seed a `skill_candidate` + a `swap_decision` row, then apply the BRANCH's `SCHEMA_SQL` on top | **exit 0** — the migration runs on a populated database |
| 4 | `insert … skill_candidate … list='expertise'` | **ACCEPTED** |
| 4 | `insert … swap_decision … list='expertise'` | **ACCEPTED** |
| 5 | `insert … swap_decision … driver='unattributed', verbatim_quote='a quote'` | **`ERROR: … violates check constraint "swap_decision_check"`** — AC-5's citation contract `((driver='posting') = (verbatim_quote is not null))` still holds, proven against the database rather than by reading it |
| 6 | the `listChecksAdmitExpertise` probe query, run **verbatim** | returns `swap_decision` **and** `skill_candidate` ⇒ the probe returns **true**, nothing is held back |

Database dropped afterwards. **AC-14 is CONFIRMED** on the two things a local database can settle
(the DDL migrates, and both tables accept the row). What a local database cannot settle is whether
production's *existing* constraint matches `origin/main`'s — that is the AC-15 live check.

### 5g. The three DB-backed files — why they are excluded, and what that does NOT hide

`buildQueueDb.test.mjs`, `dimensionsDb.test.mjs` and `schemaParity.test.mjs` are excluded from the
5b re-measurement. Two independent reasons they cannot mask a defect in this work:

1. **They do not reference anything I changed.** Run over all three:
   `grep -nE "swaps|appSwaps|appInsertions|swap_decision|skill_candidate|buildSwaps|masterBaseline"`
   → **zero hits**. Their imports are `appDimensions.js`, `appRequirements.js`, `dimensions.js`,
   `SCHEMA_SQL` and `pg`. There is no path from `swaps.ts` / `appSwaps.ts` to any of them.
2. **They were SKIPPED in the clean-`HEAD` baseline** (`# skipped 18`), so they contributed nothing
   to the 892-passing figure either. Excluding them compares like with like.

They began running — and taking >25s each — only once the parallel agent started a local
PostgreSQL for its own schema work. **Their contents were not measured to a verdict here**, and a
verdict on them belongs to whoever owns `schema.ts` / `appDimensions.ts`. `schemaParity` in
particular is worth a clean run now that `schema.ts` has settled: it is the guard that would catch
a fresh-vs-upgraded disagreement of exactly the HN-1 shape, which §5f only proved for the two
`list` CHECKs specifically rather than for the whole file.

### 5h. Self-attack sweep (§0b) before handing off
1. **Who reads what I wrote?** `grep -rn "LISTS\b\|ListKey\|LIST_FIELDS" api/src app/src` → **no
   consumer outside `swaps.ts`** (the two hits are unrelated prose in `figureEcho.ts` /
   `pipeline.ts`). `grep -rn writeSwaps api/src` → the sole caller is `appPackets.ts:618`, which
   **ignores the return value** — hence HN-7. `grep -rn "skills_1\|'expertise'" app/src` → only
   `qcRail.js` comments; no app code switches on the list enum, so `'expertise'` renders like any
   other list.
2. **Can the system produce my fixture?** Checked against the real producers rather than assuming —
   this is what found D-6 (`mt17.ts:150`) and HN-1 (`schema.ts:549`).
3. **How many homes does the concept have?** `list` has **three**: `swap_decision`'s CHECK,
   `skill_candidate`'s CHECK, and `LIST_FIELDS`. Only two had been widened. The probe covers both
   tables for exactly this reason.
4. **Import-cycle check:** `appSwaps → appInsertions` is one-directional (`appInsertions` imports
   only `RequirementRef` from `swaps`), so no cycle. `H12` (purity of `swaps.ts`) passes — note it
   is a **source grep**, and it fired on a *comment* of mine that spelled out the Azure package
   name; reworded. That is the H-rule-2 cry-wolf shape, worth knowing about before editing this file.

## END OF IMPL


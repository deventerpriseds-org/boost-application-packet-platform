# VERIFY-30 — independent verification of #30 "an owner can edit a swapped value in place"

**Verifier:** independent subagent. Did NOT build this feature. No shared context with the implementer.
**Date:** 2026-08-25
**Base:** `origin/main`

```
git fetch origin
git log --oneline -1            # 812bae7  #30 surface: an owner edit reads as the owner's...
git log --oneline -1 origin/main # 812bae7  -> identical, no drift
```

Commits under test: `be89374`, `d8aec3c`, `c1e7dac`, `6c83a21`, `812bae7`.

Rule applied throughout: a claim I could not execute is `not_verified`, never `pass`.
Written incrementally — each claim appended as it was finished.

---
## Claim 1 — Migration: every home of both enum domains

**Claimed:** `correction.source` has **five** homes, `swap_decision.driver` has **four**, and all are widened.

### `correction.source` — verdict on the five: CONFIRMED

Found by grepping the **old** values (`profile_figure`), not `owner_edit` — grepping the new value
can only find homes that were already fixed, never one that was missed.

```
$ grep -rn "profile_figure" api/src app/src api/test app/test scripts
api/src/functions/tests/appCorrections.ts:75:    source text not null check (source in ('profile_figure','generalized','owner_edit')),
api/src/functions/tests/correction.ts:32:export type CorrectionSource = 'profile_figure' | 'generalized' | 'owner_edit'
api/src/functions/tests/schema.ts:414:  source text not null check (source in ('profile_figure','generalized','owner_edit')),
api/src/functions/tests/schema.ts:452:  check (source in ('profile_figure','generalized','owner_edit'));
api/test/sql/correction.sql:29: constraint correction_source_known check (source in (...,'owner_edit')),
app/src/assetGate.js:440:  profile_figure: 'taken from your own profile',      [446: owner_edit: 'you changed this yourself']
```

All five homes carry `owner_edit`. `api/test/sql/correction-constraints.probe.sql` also names the
domain but only in INSERT values, not a constraint — it is not a home. **CONFIRMED, count is five.**

### `swap_decision.driver` — the four DECLARED homes: CONFIRMED

```
api/src/functions/tests/schema.ts:565:  driver text not null check (driver in ('posting','rule','unattributed','owner')),
api/src/functions/tests/schema.ts:589-590: alter ... add constraint swap_decision_driver_check check (driver in (...,'owner'));
api/src/functions/tests/swaps.ts:27:      export type Driver = 'posting' | 'rule' | 'unattributed' | 'owner'
api/src/functions/tests/compactFit.ts:41: export type SwapDriver = 'posting' | 'rule' | 'unattributed' | 'owner'
```

### >> FINDING F1 — there IS a sixth home, and it is a RENDER site the implementer's own guard missed

`api/test/ownerGate.test.mjs` carries `H:new-driver-needs-owner-facing-copy`, titled
*"a raw enum value must never reach the screen"*. It asserts exactly **two** render sites handle
`'owner'`:

```
for (const f of ['../../app/src/screens/AssetGateDrawer.jsx', '../../app/src/screens/QcRail.jsx'])
```

There is a **THIRD** render site, and it is not in that list:

```
$ grep -rn "driver" app/src
app/src/assetBlocks.js:425:  status: swap ? (swap.action === 'kept' ? 'unchanged' : `${swap.action} · ${swap.driver}`) : '',
app/src/screens/AssetGateDrawer.jsx:235   <- guarded
app/src/screens/QcRail.jsx:332            <- guarded
```

`listBodyModel` interpolates the **raw** `driver` into `line.status`, and `line.status` is rendered:

```
$ grep -rn "listBodyModel" app/src
app/src/screens/AssetBlocks.jsx:342:  const model = listBodyModel(row, swapsForList, { artifactId, listOwners })
$ grep -n "\.status" app/src/screens/AssetBlocks.jsx
362:            <span style={{ whiteSpace: 'nowrap' }}>{line.status}</span>
```

**Proven by execution, not by reading** — driving the real exported function with an owner-driven swap:

```
$ node scratchpad/probe-driver-ui.mjs
OWNER-DRIVEN SWAP -> line.status rendered at AssetBlocks.jsx:362 =
   "swapped · owner"
```

The owner reads the literal database enum **`swapped · owner`** on their own screen — the precise
failure `H:new-driver-needs-owner-facing-copy` was written to prevent, one file outside its loop.
The two guarded sites say *"you changed this yourself"*; this one says `owner`.

**Claim 1 verdict: CONFIRMED as to the nine declared homes; REFUTED as to completeness.**
A sixth home exists (`app/src/assetBlocks.js:425` -> `AssetBlocks.jsx:362`) and is unhandled and
unguarded.

---
## Claim 2 — the migration works on an EXISTING (populated) database — **CONFIRMED**

Re-run independently per `CLAUDE.md` §"Run the schema locally". Local PostgreSQL 16.13, socket
`/tmp/pgsock:55432`, pgvector stubbed. Baseline is `be89374^` = `f2bba98` (the last commit BEFORE
this work), since `origin/main` already contains the change.

```
$ psql -tAc "select version();"
PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) ... 64-bit
$ git rev-parse --short be89374^   ->  f2bba98
```

**Baseline domains on the old schema** (and note: NO idempotent ALTER exists at `f2bba98` —
`grep -n "swap_decision_driver_check\|correction_source" /tmp/schema_old.sql` returns nothing):

```
correction_source_check      | CHECK (source = ANY (ARRAY['profile_figure','generalized']))
swap_decision_driver_check   | CHECK (driver  = ANY (ARRAY['posting','rule','unattributed']))
```

| # | Sub-claim | Command | Observed | Verdict |
|---|---|---|---|---|
| 2a | old CHECK **rejects** `owner_edit` | `insert into correction (... ,'owner_edit')` | `ERROR: violates check constraint "correction_source_check"` | CONFIRMED |
| 2b | old CHECK **rejects** `driver='owner'` | `insert into swap_decision (...,'owner',...)` | `ERROR: violates check constraint "swap_decision_driver_check"` | CONFIRMED |
| 2c | migration applies on populated data, **exit 0** | `psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_new_nv.sql` | `MIGRATION exit=0` | CONFIRMED |
| 2d | **seeded rows survive** | `select count(*), string_agg(distinct source,',') from correction` | `correction: 2 rows, sources=generalized,profile_figure`; `swap_decision: 2 rows, drivers=posting,unattributed` | CONFIRMED |
| 2e | new values then **accepted** | the same two inserts, re-run | `INSERT 0 1` / `INSERT 0 1` | CONFIRMED |
| 2f | **bogus still rejected** (widened, not dropped) | `... ,'totally_bogus')` | `ERROR: violates check constraint` on **both** tables | CONFIRMED |

Constraints read back after the migration:

```
correction_source_check    -> CHECK (source = ANY (ARRAY['profile_figure','generalized','owner_edit']))
swap_decision_driver_check -> CHECK (driver = ANY (ARRAY['posting','rule','unattributed','owner']))
```

### The counterfactual — I did not take "`create table if not exists` cannot widen" on trust

Stripped **both** idempotent ALTER blocks (`schema.ts:440-442`, `:578-580`), leaving only the inline
`create table if not exists` CHECKs, and applied that to a second populated database (`upg2`) that
already had the old schema:

```
$ psql -v ON_ERROR_STOP=1 -q -d upg2 -f /tmp/schema_new_noalter.sql
exit=0                                  <-- it SUCCEEDS, silently
$ psql -d upg2 -tAc "select pg_get_constraintdef(oid) from pg_constraint where conname='correction_source_check';"
CHECK ((source = ANY (ARRAY['profile_figure'::text, 'generalized'::text])))     <-- NOT widened
$ ... conname='swap_decision_driver_check'
CHECK ((driver = ANY (ARRAY['posting'::text, 'rule'::text, 'unattributed'::text])))  <-- NOT widened
$ insert ... 'owner_edit'  -> ERROR: violates check constraint "correction_source_check"
$ insert ... 'owner'       -> ERROR: violates check constraint "swap_decision_driver_check"
```

The ALTER-less run **exits 0 while changing nothing** — the silent-failure mode the claim describes.
The idempotent ALTER is load-bearing, not decorative. **Claim 2 CONFIRMED in full.**

---
## Claim 3 — Decision A: an owner edit survives a rebuild, or lapses loudly — **PARTLY REFUTED**

### The mechanism itself: CONFIRMED

`reapplyOwnerEdits` (`api/src/functions/tests/correction.ts:164`) delegates to `locateOwnerPhrase`
(`:150`), which does `hay.indexOf(needle)` and lapses if a second occurrence exists (`:158`).
Driven directly against the built module:

```
$ node -e "const {reapplyOwnerEdits} = require('./dist/functions/tests/correction.js'); ..."
1. phrase MOVED (offsets say 0, actually at 21) -> "Stakeholder alignment Supplier negotiation"
2. TWO occurrences (ambiguous) -> text unchanged | applied: 0 | lapsed: "those words now appear more
   than once in this field, so it is not clear which one you meant"
3. ABSENT -> text unchanged | applied: 0 | lapsed: "this field was rewritten and no longer contains
   the words you changed"
4. case-differing near miss -> applied: 0 | text unchanged: true
```

Matched by **phrase, not offsets**: CONFIRMED. **Exactly one occurrence or it lapses**: CONFIRMED.
No fuzzy matching: CONFIRMED. Deterministic `applied_seq` replay: CONFIRMED (suite + read of `:173`).

### Wired into `applyCorrectionPass`: CONFIRMED

`appCorrections.ts:150-163` selects `where artifact_id = $1 and source = 'owner_edit' and
reverted_at is null order by applied_seq`, re-applies per field, assigns `pkg[field] = res.text`,
and returns `ownerLapsed` at `:164`.

### >> FINDING F2 — "lapses LOUDLY" is REFUTED. `ownerLapsed` has no consumer anywhere.

`PassResult.ownerLapsed` is produced and returned. Nothing reads it. Repo-wide:

```
$ grep -rn "ownerLapsed" --exclude-dir=node_modules --exclude-dir=.git .
./api/dist/functions/tests/appCorrections.js:123,135,137     (compiled output of the same file)
./api/src/functions/tests/appCorrections.ts:42,149,161,164   (declared, filled, returned)
```

Four source hits, all inside the file that creates it. The single caller drops it on the floor:

```
$ grep -n "corrections\b" api/src/functions/tests/appPackets.ts
538:  const corrections = await applyCorrectionPass(client, {
$ grep -c "corrections\b" api/src/functions/tests/appPackets.ts
1                      <-- assigned once, never read again
$ grep -n "noUnusedLocals" api/tsconfig.json
(not set -> the unused binding is not even a compile error)
```

No API response field, no UI, no log line, no DB column carries a lapse. The owner is never told.
The file's own doc comment (`appCorrections.ts:37-40`) states the obligation that is unmet:

> *"Present and empty when every stored edit was re-applied; a lapse is never silent. **The caller
> must surface these** — an edit the owner made and can no longer see is the one thing this whole
> path exists to prevent, and reporting zero lapses because nobody looked is the same failure in a
> quieter costume."*

The caller does not surface them. By the module's own standard this is "the same failure in a
quieter costume". **The edit lapses SILENTLY.**

### >> FINDING F3 — INERT GUARD: the wiring of Decision A is not guarded at all

`api/test/ownerEdits.test.mjs` imports `reapplyOwnerEdits` directly and never exercises
`applyCorrectionPass`. Mutation-proof — I deleted the entire re-apply block from
`applyCorrectionPass` (reverting Decision A's integration completely), rebuilt, and ran the suite:

```
$ python3 ... # removed lines 150-163, the stored-edit select + reapplyOwnerEdits loop
MUTATION APPLIED: reapplyOwnerEdits call removed from applyCorrectionPass
$ grep -n "reapplyOwnerEdits" api/src/functions/tests/appCorrections.ts
23:  import { ... reapplyOwnerEdits ... }     <- import only
148: // comment
321: // comment                                <- NO CALL REMAINS
$ cd api && npm run build && npm test
# tests 825   # pass 825   # fail 0
```

**825/825 pass with the feature disconnected.** Restored, rebuilt, re-ran: `# pass 825 # fail 0` —
byte-identical. The guard cannot tell the wired system from the unwired one.

`H:owner-edit-survives-a-rebuild` tests the FUNCTION, not the fact that a rebuild calls it. The
title claims the integration; the assertion covers only the unit.

*(Note on counts: the first suite run in this session reported 807 pass / 18 skipped; later runs
report 825 / 0. The 18 are `{ skip: !HAVE_PG }` DB-backed tests in `buildQueueDb`,
`evidenceConfirmDb`, `shipPathDb` that began running once I started local PostgreSQL for Claim 2.
Both mutated and restored runs were made with PG up, so the comparison is like-for-like — and none
of those DB tests exercise the owner-edit path either, or the mutation would have failed.)*

**Claim 3 verdict:** mechanism CONFIRMED; "or lapses loudly" **REFUTED** (no consumer); the
integration is **unguarded** (inert guard).

---
## Claim 4 — Decision B: an owner edit never moves the gate, in either direction — **CONFIRMED**

`checks.ts:921-922` excludes `driver === 'owner'` from `changes`, and `uncited` is derived FROM
`changes`, so the exclusion reaches offenders and denominator alike:

```ts
const changes = swaps.filter(s => (s.action === 'swapped' || s.action === 'added') && s.driver !== 'owner')
const uncited = changes.filter(s => s.driver !== 'posting')
```

Proven by driving the real `runChecks` from the built module — including a CONTROL case the
implementer's tests do not have, to show the exclusion is specific to `owner` and not an artifact
of the fixture:

```
$ node -e "const {runChecks}=require('./dist/functions/tests/checks.js'); ..."

A. owner + cited posting change:      state=pass | observed="all 1 changes cited"      | offenders=[]
B. owner ONLY:                        state=pass | observed="nothing was swapped or added" | offenders=[]
C. owner + uncited MODEL change:      state=fail | observed="1 of 1 changes cite nothing"
                                      | offenders=["added: Quantum cryptography"]
D. CONTROL — identical to A but driver='unattributed' instead of 'owner':
                                      state=fail | observed="1 of 2 changes cite nothing"
                                      | offenders=["swapped: Supplier negotiation"]
```

- **Cannot FAIL the packet** — A passes; the owner's words never appear in `offenders`. CONFIRMED.
- **Cannot BUY a citation** — B reports *"nothing was swapped or added"*, i.e. the owner row is
  neither cited nor uncited; it does not turn an empty check green on the owner's behalf. CONFIRMED.
- **Excluded from the DENOMINATOR** — A says "all **1** changes cited" against two swap rows; the
  control D says "1 of **2**". The owner row is genuinely removed, not merely un-offended. CONFIRMED.
- **The gate still catches the MODEL** — C fails and names only the model's row. CONFIRMED.

### Mutation proof — this guard is LIVE (not inert)

```
$ # removed `&& s.driver !== 'owner'` from checks.ts:921
MUTATION APPLIED: owner exclusion removed from changes_cited
$ npm run build && npm test
# tests 825   # pass 823   # fail 2
not ok 585 - H:owner-edit-never-fails-the-gate: the owner is not accused of not justifying their own resume
not ok 586 - H:owner-edit-never-buys-a-citation: the quieter failure, and the more dangerous one
$ # restored
# tests 825   # pass 825   # fail 0
```

Both Decision B guards fail with the defect reinstated. **Claim 4 CONFIRMED, guard verified live.**

---
## Claim 5 — the write route — **CONFIRMED**

```
$ grep -n "app.http(" api/src/functions/tests/appCorrections.ts
370:app.http('artifactOwnerEdit', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
        route: 'app/artifact/{artifactId}/owner-edit', handler: artifactOwnerEdit })
```

- **Path + method** — `POST /api/app/artifact/{artifactId}/owner-edit`. CONFIRMED.
- **Session-authenticated** — `const guard = requireWrite(req); if (guard) return guard` is the
  first statement after the OPTIONS pre-flight. `requireWrite` (`appSession.ts:72-76`) returns 401
  unless the session is `verified` or the owner is `DEMO_EMAIL`. CONFIRMED.
- **Refuses with 200 + `ok:false`** — three refusal sites, all `status: 200 ... jsonBody: { ok: false,
  reason: ... }`: the no-op edit (same wording), the missing merge-field block, and the phrase that
  cannot be located exactly once. CONFIRMED.

**Nuance worth stating precisely:** the route *does* return 4xx — `400` for a missing
`merge_field`/`phrase`, `404` for an unknown artifact, `409` for an artifact with no stored package.
Those carry an `error:` body, not `ok:false`. So the accurate statement is *"an owner-facing
**refusal** is 200 + `ok:false`; a malformed request or a broken precondition is still a status
code"* — which is what the handler's own doc comment says ("Every other failure IS a status code").
The claim as phrased is true for the refusal class it describes.

### Mutation proof — LIVE
```
$ # removed `const guard = requireWrite(req); if (guard) return guard` from artifactOwnerEdit
$ node --test test/ownerEdits.test.mjs     ->  # pass 8   # fail 1
```

---

## Claim 6 — the surface: `correctionSentence` opens "You changed:" — **CONFIRMED**

Driven directly against `app/src/assetGate.js`:

```
$ node -e "import('./app/src/assetGate.js').then(m => ...)"
owner_edit     -> "You changed: \"Vendor selection\" to \"Supplier negotiation\" in Core skills."
generalized    -> "Corrected: \"Vendor selection\" rewritten as \"Supplier negotiation\" in Core skills."
profile_figure -> "Corrected: ..."
undone owner   -> "Undone: \"Supplier negotiation\" is back to \"Vendor selection\" in Core skills."

correctionSourceText('owner_edit')     -> "you changed this yourself"
correctionSourceText('some_new_value') -> "some_new_value"      <- the raw fallthrough, as documented
```

**Visible in BOTH surfaces: CONFIRMED.** `CorrectionRow` is defined once (`QcRail.jsx:489`) and
mounted twice — the QC rail (`QcRail.jsx:635`) and the field margin (`AssetBlocks.jsx:696`, imported
at `:44`). Both go through `railChangeLog` -> `correctionsState`, which filters only on `r.undone`,
never on `source`; `correctionsForField` scopes by `merge_field` only. Nothing hides an owner row
from either surface.

*(Minor: an UNDONE owner edit renders "Undone: ..." and loses the owner attribution, since the
`undone` branch returns before the `source` check. Defensible, but the log no longer says who made
the change that was undone.)*

---

# Suites — run by me, from a clean tree

```
$ cd api && npm test                       # tests 825  # pass 825  # fail 0
$ node --test app/test/*.test.mjs          # tests 285  # pass 285  # fail 0
$ cd app && npm run test:margin            47/47 checks passed
$ git status --short                       (only this file modified)
```

*(`origin/main` advanced to `06df406` mid-verification. `git diff --name-only 812bae7 origin/main --
api/src app/src api/test app/test` is EMPTY — that commit adds only
`docs/qc-evidence/PROTOTYPE-COVERAGE.md`. This verification remains valid against current main.)*

---

# VERDICT TABLE

| # | Claim | Verdict |
|---|---|---|
| 1 | Migration widens both domains in every home (5 + 4) | **CONFIRMED for the 9 declared homes; REFUTED on completeness** — a 6th, unhandled home exists (F1) |
| 2 | The migration works on an EXISTING populated database | **CONFIRMED** — all six sub-claims, plus the counterfactual |
| 3 | Decision A — survives a rebuild, or lapses loudly | **PARTLY REFUTED** — re-apply CONFIRMED; "lapses loudly" REFUTED (F2); wiring unguarded (F3) |
| 4 | Decision B — never moves the gate, either direction | **CONFIRMED** as written, guard live — **but unreachable in production (F4)** |
| 5 | The write route | **CONFIRMED** |
| 6 | `correctionSentence` opens "You changed:" | **CONFIRMED** |

---

# FINDINGS NOT CLAIMED

## F4 (most serious) — `driver='owner'` is never written, so Decision B is unreachable

Decision B excludes `driver === 'owner'` from `changes_cited`. **Nothing in the system ever produces
that value.** Swept producers, not one file:

```
$ grep -rn "swap_decision" api/src | grep -iE "insert|update|upsert|copy"
api/src/functions/tests/appSwaps.ts:59:   `insert into swap_decision      <- the ONLY writer
$ grep -n "driver:" api/src/functions/tests/swaps.ts
224:  driver: 'rule',                                   (omit-list branch)
252:  driver: attributable && att ? 'posting' : 'unattributed',
$ sed -n '/export async function artifactOwnerEdit/,/^}/p' ... | grep -c "swap_decision"
0        <- the owner-edit route never touches swap_decision
```

`buildSwaps({call1, call3, pkg, requirements, profileText, omitList})` takes **no corrections input**,
so it cannot know an edit was the owner's. The owner-edit route deliberately stores in `correction`
(the handler's doc explains why: `writeSwaps` deletes and re-inserts every build). The consequence is
that the widened `driver` domain and the Decision B exclusion describe a state the system cannot enter.

**The failure Decision B claims to fix is still live.** Proven end-to-end by running the real
`buildSwaps` on a package after the owner-edit route rewrote one item in place:

```
$ node -e "const {buildSwaps}=require('./dist/functions/tests/swaps.js'); ..."
   call1.skills1     = 'Vendor selection\nStakeholder alignment'      (pipeline original)
   pkg.SkillsBullets1= 'Supplier negotiation\nStakeholder alignment'  (after the owner's edit)

SWAP ROWS THE REBUILD RE-DERIVES:
   action=dropped | driver="unattributed" | from="Vendor selection"   | to=null
   action=added   | driver="unattributed" | from=null | to="Supplier negotiation"
ANY row with driver=owner?  -> false

changes_cited on those REAL rows:
   state=fail | observed="1 of 1 changes cite nothing"
   offenders=["added: Supplier negotiation"]
```

The gate **fails the packet and names the owner's own words as the offender** — verbatim the outcome
`H:owner-edit-never-fails-the-gate` says it prevents, and which that test's own comment describes
("the row lands 'swapped' + 'unattributed', and changes_cited fails on it"). The guards pass only
because they hand-construct `{driver:'owner'}` fixtures the system never produces. This is the
`H:no-vacuous-gate` class: a check that is green because the condition it tests cannot arise.

## F5 — an owner edit is NOT undoable once any other correction shares the field

The handler's doc claims: *"`before_sha256` is the hash of the text AS IT IS NOW, which is what makes
the edit undoable by the existing revert route with no special case."* Tested by execution:

```
CASE 1 - owner edit alone:
   {"ok":true,"text":"Vendor selection across teams"}                             <- works

CASE 2 - a pipeline generalization + an owner edit on the SAME field:
   current = "Led 8-figure supplier negotiation across teams"
   revert the OWNER edit (seq 2) ->
     {"ok":false,"reason":"this text no longer matches the change log
                           (correction 2 is not where the record says it is)"}
   revert the GENERALIZATION (seq 1) ->
     {"ok":false,"reason":"... (correction 2 is not where the record says it is)"}
```

**Two coordinate frames in one list.** `planCorrections` (`correction.ts`) writes
`char_start = f.start` and `before_sha256 = sha256(original)` — both relative to the **original**
field text, and `originalOf`'s doc comment (`correction.ts:187-194`) depends on exactly that
("the stored offsets are original-relative"). `artifactOwnerEdit` writes `char_start = first` and
`before_sha256 = sha256(current)` — relative to the **already-corrected** text.

Worse than losing the undo: the mismatch **poisons the whole field's change log**, so the
pre-existing generalization can no longer be reverted either. Case 1 passing is why this is easy to
miss — the single-correction case, which is what the tests exercise, works fine.

## F1 — a third render site shows the raw enum (detail under Claim 1)

`app/src/assetBlocks.js:425` -> `AssetBlocks.jsx:362` renders `"swapped · owner"`.
`H:new-driver-needs-owner-facing-copy` loops over only `AssetGateDrawer.jsx` and `QcRail.jsx`.

## F6 — `swapsGet` counts an owner edit as "unattributed" in the UI

Decision B fixed `changes_cited`. The sibling count was not:

```
api/src/functions/tests/appSwaps.ts:110: unattributed: changes.filter((s: any) => s.driver !== 'posting').length
api/src/functions/tests/swaps.ts:238:    const unattributed = swaps.filter(s => (...) && s.driver !== 'posting').length
app/src/assetBlocks.js:532:              const postingDriven = changed.filter((s) => s.driver === 'posting')
```

All three treat "not posting" as "unattributed", so a `driver='owner'` row would be counted against
the owner in the swaps summary even though the gate excludes it. Latent today because of F4 — but
it is the same omission Decision B was written to close, in three more places.

## Score / coverage exposure — an owner edit does NOT reach `artifact_score` today

Traced all three score components (`artifactScore.ts:84-152`, `appChecks.ts:125-145`):

| Component | Source | Sees an owner edit? |
|---|---|---|
| `must_have_coverage` | read OUT of the `must_have_coverage` check, which judges `ruleEvidenceOf(r)` — requirement **evidence rows resolved against the PROFILE**, not `pkg` | **No** |
| `keyword_coverage` | `keyword: scoreable > 0 ? { covered: null, scoreable } : null` — `covered` is **hardcoded null**; nothing counts per-asset term placement yet | **No** |
| `seniority_alignment` | reviewer-supplied stored input (P4 not shipped) | **No** |
| `composite` | null unless all three are non-null | **No** |

Empirically, running `runChecks` on identical inputs differing only by the owner's edit:

```
CHECKS THAT DIFFER between pre-edit and post-edit pkg:  (none)
SCORE pre : {"mh":0,"kw":null,"sen":null,"composite":null}
SCORE post: {"mh":0,"kw":null,"sen":null,"composite":null}
```

**Caveat, not a clean bill of health:** this holds *because* `keyword_coverage.covered` is pinned to
`null`. The comment at `appChecks.ts:136-140` states that the instant a term-library version is
published this path starts measuring term placement — and term placement is counted **in `pkg` text**,
which an owner edit changes, with no owner exclusion anywhere on that path. The exposure is dormant,
not absent.

## Inert guard — Decision A's wiring (F3, detail under Claim 3)

The only inert guard found. Every other guard I attacked failed correctly when its defect was
reinstated:

| Guard | Mutation | Result |
|---|---|---|
| `H:correction-ddl-parity` | drop `owner_edit` from `appCorrections.ts:75` | **fails** (1) |
| `H:correction-ddl-parity` | drop `owner_edit` from `api/test/sql/correction.sql:29` | **fails** (1) |
| `H:correction-source-widened-by-alter` | delete the idempotent ALTER from `schema.ts` | **fails** (1) |
| `H:driver-domain-parity` | drop `'owner'` from `swaps.ts:27` Driver union | **fails** (1) |
| `H:new-driver-needs-owner-facing-copy` | drop the `'owner'` branch from `QcRail.jsx:332` | **fails** (1) |
| `H:owner-edit-route-is-session-authenticated` | remove `requireWrite` from the handler | **fails** (1) |
| `H:owner-edit-never-fails-the-gate` / `-buys-a-citation` | remove `&& s.driver !== 'owner'` | **fails** (2) |
| **Decision A wiring** | **delete the whole re-apply block from `applyCorrectionPass`** | **825/825 PASS** |

---

# NOT VERIFIED — and what would settle each

| Item | Why | What would settle it |
|---|---|---|
| The route behaves as specified **against the deployed API** | The sandbox egress blocks `job-platform-api.azurewebsites.net`. Everything above is source + local execution. | `.github/workflows/api-test.yml` with `POST /api/app/artifact/<uuid>/owner-edit` — it mints a session token, so it also exercises `requireWrite` for real |
| The migration applies to the **live** Postgres | Proven only against local PostgreSQL 16.13 with pgvector stubbed. The live DB has real pgvector and real data volume. | `db-query.yml` reading `pg_get_constraintdef` for `correction_source_check` and `swap_decision_driver_check` after the next deploy |
| The owner-edit control is reachable and correct **in the rendered SPA** | No browser run was made; `test:margin` is a DOM-replica harness, not the live bundle. | `ui-verify.yml` against a real artifact route, asserting the "You changed:" sentence renders |
| Whether F4 is a defect or an accepted staged decision | I can prove `driver='owner'` is never written; I cannot know whether a follow-up commit was planned to write it. | The owner's call — but the gate is failing owner edits **today**, so it needs one |

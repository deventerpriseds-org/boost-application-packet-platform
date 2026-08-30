# VERIFY — fixed-slot swap pairing (loop 1)

## VERIFY LOOP
work: fixed-slot-swap-pairing
loop: 1

Independent verifier. No shared context with the implementers. Branch
`claude/incumbent-wins-swap`, commits `35cab5d`, `2cd6f69`.
Every verdict below cites a command actually run in this container and its real output.

**STATUS: COMPLETE** — every claim carries a literal CONFIRMED / REFUTED / NOT_APPLICABLE verdict.
Ends with `## END OF VERIFY PASS`; a copy without that marker is truncated.

Method note: I did not read the implementers' tests for the behavioural claims. I wrote my own
probes against the BUILT module (`api/dist/functions/tests/*.js`, `cd api && npm run build` clean)
so that a test written to match the implementation could not launder a defect past me.

---

## Claim 1 — AC-1: no `from_label` originates from `call1[passA]` when a master block exists

**CONFIRMED** (for the master-present case), and the `call1` fallback is **honest degradation, not a
hole** — with one caveat named below.

Probe (`buildSwaps` with disjoint master and call1 text):

```
master.SkillsBullets1 = MasterOne / MasterTwo / MasterThree
call1.skills1         = DraftAlpha / DraftBeta / DraftGamma
pkg.SkillsBullets1    = MasterOne / FinalNew / MasterThree
->
kept     from="MasterOne"   to="MasterOne"  rat="unchanged from the master template"
swapped  from="MasterTwo"   to="FinalNew"   rat="replaces the master template item in this slot"
kept     from="MasterThree" to="MasterThree"
from_labels: [ 'MasterOne', 'MasterTwo', 'MasterThree' ]
any from_label from the call1 draft? false
baselineSource: master
```

Not one `Draft*` label reaches a `from_label`. The AC's own falsifier —
`grep -n "call1\[f.passA\]" api/src/functions/tests/swaps.ts` — still returns a hit, but reading the
line shows it is now the FALLBACK, not the baseline:

```
358  const masterItems = splitItems(master[f.merge])
359  const call1Items  = splitItems(call1[f.passA])
360  const fromMaster  = masterItems.length > 0
361  const originals   = fromMaster ? masterItems : call1Items
362  const baselineSource = fromMaster ? 'master' : (originals.length ? 'call1' : 'none')
```

**On the surviving `call1` fallback — my judgement: honest degradation.** Three observations, then
the interpretation.

- OBSERVATION: the selection is **per list**, not per packet. A packet with a master block for
  `SkillsBullets1` and none for `SkillsBullets2` uses master for the first and call1 for the second
  — probed directly, `skills_2 baselineSource: call1` while `skills_1` was `master`.
- OBSERVATION: the fallback is **recorded, not silent** — `ListCounts.baselineSource` is
  `'master' | 'call1' | 'none'` and is returned to the caller for every list.
- OBSERVATION: the rationale text differs by branch. Master rows read *"unchanged from the master
  template"* / *"replaces the master template item in this slot"*; call1 rows read *"unchanged from
  the first pass"* / *"replaces the first-pass item in this slot"*. So the sentence shown to the
  reviewer never claims master provenance it does not have.
- INTERPRETATION: this satisfies AC-1 as written ("when a master block exists"), and the degradation
  is the honest option — `appInsertions.ts:33` returns `{}` on any Storage failure, so reporting
  zero originals would report the owner's whole list as invented.

**The caveat, and it is a real gap rather than a defect in what was built.** `baselineSource` is
computed and returned but **nothing downstream consumes it**:

```
$ grep -rn "baselineSource" api/src app/src --include=*.ts --include=*.js --include=*.jsx | grep -v dist
api/src/functions/tests/swaps.ts:179   (comment)
api/src/functions/tests/swaps.ts:210   (interface field)
api/src/functions/tests/swaps.ts:362   (assignment)
api/src/functions/tests/swaps.ts:506   (returned)
api/src/functions/tests/appSwaps.ts:  (returned through, see Claim 14)
```

No check, no route projection and no UI reads it. So a reviewer looking at the QC rail cannot tell a
master-baselined row from a call1-baselined one except by the rationale wording. That is
write-mostly state, the same class the repo's own 0b rule #1 names ("who READS what you wrote?").
Not a falsification of AC-1 — recorded as an outstanding gap.

---

## Claim 2 — AC-3: set membership, order-independent, duplicates one-for-one

**CONFIRMED.**

```
master [A,B,C] / final [C,A,D]  ->  kept A, kept C, swapped B->D
master [A,B,C] / final [D,C,A]  ->  kept A, kept C, swapped B->D     (identical)
kept sets equal across permutation? true   ['A','C'] vs ['A','C']
```

Neither `A` nor `C` appears in any non-`kept` row, in either permutation.

Duplicates, matched one-for-one (a multiset, not a set):

```
master [A,A,B] / final [A,C,A]  ->  kept A, kept A, swapped B->C
master [A,A,B] / final [A,C,D]  ->  kept A, swapped A->C, swapped B->D
```

The second case is the one that matters: with only one `A` on the final side, exactly one `A` is
claimed as `kept` and the surplus `A` falls through to positional pairing. No final index is claimed
twice (`freeFinalsByNorm` holds a queue per normalised label and `q.shift()` consumes it,
`swaps.ts:392-406`).

---

## Claim 3 — AC-4: leftovers pair by POSITION, not similarity, on a fixture where the two DISAGREE

**CONFIRMED — and the fixture is not vacuous.** I built the disagreement myself and measured the
similarity matrix before running the pairing, so the disagreement is a fact, not an assumption.

```
master: Alpha anchor line / Kubernetes cluster orchestration / Roadmap ownership across teams / P and L management duties
final:  Alpha anchor line / Budget stewardship program / Portfolio ownership across teams / Kubernetes cluster orchestration platform

similarity(leftover original, leftover final):
                                     Budget   Portfolio   Kubernetes-platform
  Kubernetes cluster orchestration    0.000     0.000        1.000   <-- similarity's choice
  Roadmap ownership across teams      0.000     0.667        0.000
  P and L management duties           0.000     0.000        0.000
```

`similarity()` scores `Kubernetes cluster orchestration` against `Kubernetes cluster orchestration
platform` at **1.000** — the maximum — and `SWAP_THRESHOLD` is 0.5, so the old rule would certainly
have paired them. The actual output pairs by position instead:

```
kept     Alpha anchor line -> Alpha anchor line
swapped  Kubernetes cluster orchestration -> Budget stewardship program          (sim 0.000)
swapped  Roadmap ownership across teams   -> Portfolio ownership across teams    (sim 0.667)
swapped  P and L management duties        -> Kubernetes cluster orchestration platform  (sim 0.000)
```

Two of the three pairs are ones similarity would never have made, and the 1.000 pair was explicitly
NOT made. Relative order is preserved on both sides (`swaps.ts:413-422` builds `leftOrig` and
`leftFinal` in index order and zips index k to index k).

---

## Claim 4 — AC-5: a sub-threshold positional pair writes `unattributed` / NULL quote / 0 confidence

**CONFIRMED.**

```
ATTRIBUTION_THRESHOLD = 0.34   SWAP_THRESHOLD = 0.5
master: Zebra quilting apparatus / Second master line here
final:  Zebra quilting apparatus / Xylophone tuning craft
requirements: [ seq 0, verbatim "You will own the integrated product roadmap" ]
->
swapped from="Second master line here" to="Xylophone tuning craft"
        driver=unattributed  verbatim_quote=null  requirement_seq=null  confidence=0
DB contract ((driver='posting') = (verbatim_quote is not null)) holds: true
```

`row()` (`swaps.ts:530-550`) sets `verbatim_quote`, `requirement_seq` and `confidence` from the same
`att` object, so the three cannot diverge from each other.

---

## Claim 5 — AC-6: the owner-edit exemption yields `driver='owner'` and stays out of `unattributed`

**CONFIRMED for AC-6 as written** — and while proving it I found a **PRE-EXISTING defect on the same
line**, described separately below so it is not confused with a regression.

The AC's two halves:

```
master: Zebra quilting apparatus / Second master line here
final:  Zebra quilting apparatus / OwnerTypedLine
ownerLabels: ['OwnerTypedLine']
->
swapped from="Second master line here" to="OwnerTypedLine" driver=owner
result.unattributed = 0
```

`driver='owner'`, and `buildSwaps`'s `unattributed` counter excludes it
(`swaps.ts:519-520` filters `driver !== 'owner' && driver !== 'posting'`). Both halves hold.

### FINDING F-1 (pre-existing, NOT introduced by this branch) — an owner row that also attributes violates the `swap_decision` CHECK

Same probe, with the owner's typed line made identical to a requirement's verbatim:

```
ownerLabels: ['You will own the integrated product roadmap']
requirements: [ seq 0, verbatim 'You will own the integrated product roadmap' ]
->
swapped ... driver=owner  verbatim_quote="You will own the integrated product roadmap"
            requirement_seq=0  confidence=1
```

`driver='owner'` **with a non-NULL `verbatim_quote`**. The DDL contract is
`check ((driver = 'posting') = (verbatim_quote is not null))` — here the left side is FALSE and the
right side is TRUE, so the row is **rejected by Postgres**. Executed against a real database to be
sure rather than reasoning about it — see Claim 10's harness, where this exact tuple is inserted:

```
ERROR:  new row for relation "swap_decision" violates check constraint "swap_decision_check"
DETAIL: Failing row contains (..., owner, You will own the integrated product roadmap, ...)
```

Cause, at `swaps.ts:530-548` — `verbatim_quote` is set from `att` independently of the `driver`
ternary that then overrides to `'owner'`:

```
verbatim_quote: attributable && att ? att.quote : null,
...
driver: (to && ownerLabels && ownerLabels.has(to)) ? 'owner'
      : attributable && att ? 'posting' : 'unattributed',
```

**Pre-existing, proven, not this branch's regression:**

```
$ git show origin/main:api/src/functions/tests/swaps.ts | grep -n "driver: (to && ownerLabels" -A1
323:    driver: (to && ownerLabels && ownerLabels.has(to)) ? 'owner'
324:      : attributable && att ? 'posting' : 'unattributed',
```

Byte-identical on `origin/main`. **But this branch raises its reachability**, which is why it belongs
in this report rather than only in a backlog row: positional pairing converts leftovers that were
previously `dropped` + `added` into `swapped` rows carrying a `to_label`, and the `'owner'` branch is
gated on `to &&`. More rows with a `to_label` means more rows that can hit it. A single such row
aborts the `writeSwaps` insert, which `appPackets.ts:617-622` swallows — so the packet ships with an
empty swap table and `changes_cited: not_applicable`, the quietest failure this design set out to
eliminate.

**Fix is one line** (null the quote/seq/confidence when the driver resolves to `'owner'`), plus an
H-case. Recorded as REQUIRED-BEFORE-DONE, not as a falsification of AC-6.

---

## Claim 6 — AC-7/8/10: `slotsFor` never returns `{n: 0}`; `fixed_slot_count` is `not_applicable` for unknown

**CONFIRMED.**

`slotsFor` over the whole hostile input space (probe output verbatim):

```
undefined slots             {"n":null,"source":"unknown"}
{} empty                    {"n":null,"source":"unknown"}
{SkillsBullets1: 11}        {"n":11,"source":"template"}
{SkillsBullets1: 0}         {"n":null,"source":"unknown"}     <-- 0 is UNKNOWN, not a count
{SkillsBullets1: null}      {"n":null,"source":"unknown"}
{SkillsBullets1: -3}        {"n":null,"source":"unknown"}
{SkillsBullets1: NaN}       {"n":null,"source":"unknown"}
{SkillsBullets1: 11.7}      {"n":11,"source":"template"}      (floored)
{SkillsBullets1: Infinity}  {"n":null,"source":"unknown"}
{SkillsBullets1: "11"}      {"n":null,"source":"unknown"}     <-- see note
```

No input in that set produces `{n: 0}`. There is deliberately **no master-derived fallback**
(`slotsFor` only reads `slots[mergeField]`), which matches the owner's superseding ruling *"fixed
slot counts change per template"*.

NOTE (not a falsification, worth the owner knowing): the **string** `"11"` resolves to UNKNOWN. If
the per-template config store ever hands the number back as a string, the check degrades to
`not_applicable` — silent, and in the safe direction (never an accusation), but silent. I traced the
producer: `config.ts` coerces with `Number(...)` before storing, so the live path supplies a number;
see Claim 14.

AC-10, the check side, measured through `runChecks`:

```
resume, no slots at all      not_applicable | "no per-template slot count is set for SkillsBullets1, SkillsBullets2, RelevantBullets1, RelevantBullets2, RelevantBullets3, ExpertiseBullets"
resume, slots {}             not_applicable | same
resume, slots all null       not_applicable | same
resume, slots all 0          not_applicable | same
```

Never `pass`, never `fail`, and the reason names *why* it is unknown, as AC-10 requires.

Partial knowledge does not read as whole knowledge:

```
resume, PARTIAL slots (only SkillsBullets1=3)
  pass | "SkillsBullets1 3/3; not set: SkillsBullets2, RelevantBullets1, RelevantBullets2, RelevantBullets3, ExpertiseBullets"
```

The unset lists are named in the observed string rather than quietly excluded.

---

## Claim 7 — AC-9: `buildSwaps` does not throw on a mismatch **AND** a deterministic `fail` row is produced

**CONFIRMED — both halves.** Testing them separately, because either alone passes on the hidden
failure the AC warns about.

**Half (a) — no throw:**

```
master: One alpha / Two beta / Three gamma / Four delta   (4 items)
pkg:    One alpha / Two beta                              (2 items)
slots:  { SkillsBullets1: 4 }
threw? NO
kept     One alpha -> One alpha
kept     Two beta  -> Two beta
dropped  Three gamma -> null   rat="not carried into the final list"
dropped  Four delta  -> null   rat="not carried into the final list"
lists[skills_1] = {"expected":4,"observed":2,"mismatch":true,"kept":2,"dropped":2,
                   "droppedLabels":["Three gamma","Four delta"],"addedLabels":[]}
```

The honest `dropped` rows are still emitted (AC-9b), nothing is padded or clamped, and `ListCounts`
carries the offender labels for the caller.

**Half (b) — a deterministic `fail` check row:** `runChecks` on the same shape (the cross-list-dedupe
case: template says 3, document ships 2):

```json
{
  "check_key": "fixed_slot_count",
  "engine": "deterministic",
  "state": "fail",
  "observed": "SkillsBullets1 2/3; not set: SkillsBullets2, RelevantBullets1, RelevantBullets2, RelevantBullets3, ExpertiseBullets",
  "expected": "every list ships exactly the slot count its template declares",
  "offenders": ["SkillsBullets1: template holds 3, document ships 2 (1 dropped)"]
}
```

`engine: deterministic`, `state: fail`, the list named, expected and observed both printed, and the
offender named rather than counted. Both directions are covered — a second probe with
`ExpertiseBullets: 9` against a 2-item list produced
`"ExpertiseBullets: template holds 9, document ships 2 (7 dropped)"`, and an over-count produces the
`N added` wording from the same branch (`checks.ts:411`).

---

## Claim 8 — AC-11: `compact_resume` emits `fixed_slot_count` as `not_applicable`, and is PRESENT in the results array

**CONFIRMED.** The falsifier here is absence, so I asserted presence explicitly rather than only
reading the state:

```json
{
  "check_key": "fixed_slot_count",
  "engine": "deterministic",
  "state": "not_applicable",
  "observed": "the compact resume fits skills to a character budget and drops to fit (fitCompactSkills)",
  "expected": "every list ships exactly the slot count its template declares",
  "offenders": []
}
```

Present, `not_applicable`, and the reason names `fitCompactSkills`. Critically it stays
`not_applicable` **even when slots are set and mismatched** (`{SkillsBullets1: 4}` against a 3-item
list still returned `not_applicable`), so the compact resume can never be accused on a rule that does
not apply to it.

Structural note on the guard's real shape: the check is inside `if (slotFields.length)`, where
`slotFields = [...SKILL_FIELDS, ...RELEVANT_FIELDS, 'ExpertiseBullets'].filter(has)` and `has` reads
`CHECK_FIELDS_FOR[type] || mergeFieldsFor(type)`. For `compact_resume` that list is
`[ResumeSummary, SkillsBullets1, SkillsBullets2, ExpertiseBullets, RelevantBullets1..3,
SkillsBullets]`, so `slotFields` is non-empty and the branch is reached. For `cover_letter` the check
is genuinely ABSENT from the results array — correct (a cover letter ships none of these lists) and
outside AC-11's scope, but recorded here because it is the same code path.

---

## Claim 9 — AC-12: existing `added`/`dropped` rows still read and render

**CONFIRMED**, in three places — the live database, an upgraded local database, and the renderer.

**Live database** (`db-query.yml` run `33289063388`, job `99197348962`, conclusion `success`, read
from the job log — not from the 204):

```
 action  | n
---------+----
 added   |  7
 dropped |  8
 kept    | 35
 swapped | 15
(4 rows)
```

That is the 8 dropped / 7 added the brief names, still present and readable.

**Upgrade path** — seeded one row of each action on main's schema, then applied this branch's schema
over the populated database (full harness under Claim 10):

```
after upgrade:  added=1  dropped=1  kept=1  swapped=1   skill_candidate=2  insertion=1
action CHECK after upgrade:
  CHECK ((action = ANY (ARRAY['kept','swapped','merged','dropped','added'])))
```

All five action values remain legal (AC-12a: no migration touches `action`, and none is needed).

**Renderer** — `listBodyModel` executed directly on a `dropped` row (see Claim 11's probe) keeps
populating `model.dropped` from `swaps.filter(s => s.action === 'dropped' && s.from_label)`
(`app/src/assetBlocks.js:789`), unchanged by this branch:

```
$ git diff 82f1fbf..2cd6f69 --stat -- app/src/assetBlocks.js
(no output — the file is untouched on this branch)
```

`restoreOptions`, `omitListCaveat` and both pill ternaries live in that same untouched file, so
AC-12b holds by the file being unmodified rather than by my assertion. `changes_cited`
(`checks.ts:921`) is likewise outside this branch's diff to `checks.ts` (which only adds the
FIXED SLOTS block at `:367-425`).

---

## Claim 10 — AC-14 / DDL: `skill_candidate`, `swap_decision` and `insertion` admit `list='expertise'`

**CONFIRMED for the upgrade path — and REFUTED for a fresh database.** Both halves were executed;
the second is finding **F-2** and it is the most serious defect in this pass.

### The vacuity control first — the OLD schema must reject `expertise`

Local PostgreSQL 16.13, `main`'s `SCHEMA_SQL` applied to a fresh database, then real rows seeded
(one opportunity, one packet, one artifact, two `skill_candidate`, four `swap_decision` covering
`kept`/`dropped`/`added`/`swapped`, one `insertion`). Then, on that POPULATED database:

```
ERROR:  new row for relation "swap_decision" violates check constraint "swap_decision_list_check"
ERROR:  new row for relation "skill_candidate" violates check constraint "skill_candidate_list_check"
ERROR:  new row for relation "insertion" violates check constraint "insertion_list_check"
```

All three reject `expertise` before the change. The control is not vacuous.

### The upgrade — this branch's schema applied ON TOP of that populated database

```
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_nv.sql
branch schema exit=0
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_nv.sql     # idempotency
re-run exit=0

CHECK constraints after upgrade:
  swap_decision   CHECK ((list = ANY (ARRAY['skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise'])))
  skill_candidate CHECK ((list = ANY (ARRAY['skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise'])))
  insertion       CHECK ((list = ANY (ARRAY['skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise'])))

$ insert ... list='expertise' into all three
INSERT 0 1
INSERT 0 1
INSERT 0 1
```

All three now admit it, the seeded rows survived, and the migration is idempotent. **CONFIRMED.**

### FINDING F-2 (REFUTED, blocking) — the same SCHEMA_SQL ABORTS on a fresh database

The repo's rule warns that fresh-database success proves nothing about an upgrade. This is the
mirror image and it is worse, because it means a NEW environment cannot be built at all:

```
$ psql -v ON_ERROR_STOP=1 -q -d freshb -f /tmp/schema_nv.sql        # this branch
psql:/tmp/schema_nv.sql:634: ERROR:  relation "insertion" does not exist
branch-on-fresh exit=3

$ psql -v ON_ERROR_STOP=1 -q -d freshm -f /tmp/schema_main_nv.sql   # main, control
main-on-fresh exit=0
```

The ordering defect, located exactly:

```
$ grep -n "create table if not exists insertion|alter table insertion drop constraint" /tmp/schema_nv.sql
609:alter table swap_decision drop constraint if exists swap_decision_list_check;
631:alter table skill_candidate drop constraint if exists skill_candidate_list_check;
634:alter table insertion drop constraint if exists insertion_list_check;      <-- ALTER
654:create table if not exists insertion (                                     <-- CREATE, 20 lines LATER
```

The `insertion` ALTER was placed beside its two siblings, but `insertion`'s `create table` sits
further down the file than `swap_decision`'s and `skill_candidate`'s do. With `ON_ERROR_STOP=1` the
whole migration aborts at line 634, so `insertion` and every statement after it — roughly 900 of the
1555 lines — is never applied.

This is precisely the invariant `H39`/`H39b` encode, generalised from column to table: **a statement
naming a table must come after that table's `create table`.** It was invisible to the implementers'
own populated-database check (which I reproduced at exit 0) because `insertion` already existed
there.

**The repo's own suite already catches it** — see Claim 13. `schemaParity.test.mjs`'s
*"a database built by UPGRADE is identical to one built FRESH"* fails with `relation "insertion" does
not exist` (code `42P01`), as do `buildQueueDb.test.mjs` (10 cases) and
`H:dimension-ddl-parity`. The guard was not missing; it was not run.

**Fix:** move line 634's ALTER (and its matching `add constraint`) to after line 654's `create table
if not exists insertion`, then re-run `node --test api/test/schemaParity.test.mjs`.

---

## Claim 11 — `ExpertiseBullets` -> `'expertise'` in `LIST_FIELD_TO_LIST`, and the blank-status consequence

**CONFIRMED**, both halves, by execution rather than by reading.

The map, read out of the built module:

```
LIST_FIELD_TO_LIST = {
  SkillsBullets1: 'skills_1',  SkillsBullets2: 'skills_2',
  RelevantBullets1: 'relevant_1', RelevantBullets2: 'relevant_2', RelevantBullets3: 'relevant_3',
  ExpertiseBullets: 'expertise'
}
```

The chain from that entry to a blank status, traced end to end:

1. `insertions.ts:117` — `list: LIST_FIELD_TO_LIST[field] ?? null`. Without the entry the insertion
   row for `ExpertiseBullets` stores `list = null`.
2. `AssetBlocks.jsx:1258` — `swapsForList={r.list ? scopedSwaps.filter(s => s.list === r.list) : []}`.
   A null `list` yields the empty array, unconditionally.
3. `assetBlocks.js:781` — `status: swap ? (...) : (swaps.length ? 'unchanged' : '')`. An empty
   `swaps` array makes the final ternary produce `''`.

Executed, both sides:

```
-- BEFORE (row.list = null => swapsForList = [])
"Exp one"   status=""  sharedSource=false
"Exp two"   status=""  sharedSource=false
"Exp three" status=""  sharedSource=false
every status blank? true

-- AFTER (row.list = 'expertise' => the rows are filtered in)
"Exp one"   status="unchanged"        sharedSource=true
"Exp two"   status="swapped · posting" sharedSource=true
"Exp three" status="unchanged"        sharedSource=false
any blank status? false
```

The implementers' account of this defect is accurate. Note the fix only takes effect once the DDL
admits `expertise` — `writeSwaps` holds those rows back otherwise (`appSwaps.ts`
`listChecksAdmitExpertise`), so on production, where the ALTER has not run, Expertise still renders
blank until the migration lands. That is correct conservative behaviour, not a defect, but it means
this fix is **not yet live** and cannot be until F-2 is fixed and deployed.

---

## Claim 12 — MUTATION-PROVING every new guard, done by me, not accepted from the implementers

I reverted each guarded behaviour in the **pinned worktree**, rebuilt, and ran
`node --test test/swaps.test.mjs test/insertions.test.mjs test/checks.test.mjs`
(baseline for those three files at the pinned commit: **105 pass, 0 fail**). Every mutation was
checked for being a real textual change first — a no-op mutation would have reported "NO-OP" and
been discarded rather than silently counted as proof.

| # | Behaviour reverted | fail | The guard that fired | Verdict |
|---|---|---|---|---|
| M1 | `originals = fromMaster ? masterItems : call1Items` -> `= call1Items` | 14 | `AC-1: from_label comes from the master template, and never from call1 alone` (+13 collateral) | **PROVEN** |
| M2 | Phase-1 set-membership lookup disabled | 8 | `AC-3: a label in BOTH master and final is kept…`, `AC-3: duplicates are matched one for one…` | **PROVEN** |
| M3 | Leftovers paired by **greedy `similarity()`** instead of position | **1** | `AC-4: leftovers pair by relative position, NOT by similarity` | **PROVEN** |
| M4 | `verbatim_quote` falls back to `to` when nothing attributed (fabricate a citation) | 2 | `AC-5: a positional pair below ATTRIBUTION_THRESHOLD cites nothing` | **PROVEN** |
| M5 | The `driver: … ? 'owner'` branch deleted from `row()` | 1 | `AC-6: an owner-written label keeps driver=owner and stays out of unattributed` | **PROVEN** |
| M6 | `slotsFor` returns `{n: 0}` instead of `{n: null}` for unknown | 1 | `AC-8: slotsFor is per-template or UNKNOWN, and unknown is null — never 0` | **PROVEN** |
| M7 | `buildSwaps` **throws** on a count mismatch | 4 | `AC-9a: buildSwaps does not throw on a count mismatch` (+3) | **PROVEN** |
| M8 | `ExpertiseBullets: 'expertise'` removed from `LIST_FIELD_TO_LIST` | 1 | `list-backed fields name their list, and prose fields do not` | **PROVEN** |

**M3 is the one that matters most, and it also settles the vacuity question the brief raised.**
Greedy-similarity pairing was caught by exactly ONE test — the disagreement fixture. The *canonical*
`A/B/C/D` vs `A/X/Y/Z` test (`AC-4: the canonical … pairs B->X, C->Y, D->Z`) stayed **green** under
M3, because in that fixture similarity and position happen to agree. So the canonical test alone
would have been vacuous, exactly as the AC warned, and the disagreement fixture is what carries the
whole assertion. It exists and it works.

### The gap probes — three accusation-grade behaviours with NO guard at all

I then reverted three behaviours in `checks.ts` that the ACs treat as load-bearing, expecting a
failure. **None came.** Baseline for the three files is 105 pass / 0 fail; each mutation left it
unchanged:

| # | Behaviour reverted in `checks.ts` | fail | Verdict |
|---|---|---|---|
| M9 | Unknown slot count reports **`pass`** instead of `not_applicable` (AC-10's exact falsifier) | **0** | **UNGUARDED** |
| M10 | The `compact_resume` branch removed, so `fixed_slot_count` goes **ABSENT** from the results array (AC-11's exact falsifier) | **0** | **UNGUARDED** |
| M11 | A mismatch reports **`pass`** instead of `fail`, so the gate never trips (AC-9c's exact falsifier) | **0** | **UNGUARDED** |

M11 was re-run against the **entire** api suite to rule out a guard living elsewhere:

```
FULL suite with the fixed_slot_count FAIL branch disabled:
# tests 916   # pass 895   # fail 18   # cancelled 3      <- identical to the unmutated branch
```

Corroborated structurally — no test file anywhere mentions the check:

```
$ grep -rln "fixed_slot_count" api/test/
(no output)
```

**FINDING F-3.** `fixed_slot_count` is a new **accusation-grade** check: it names offending lists,
carries `state: 'fail'`, and `gateFor` turns the packet's gate on it. It has **zero test coverage**.
All three of its states — `pass`, `fail`, `not_applicable` — can be silently inverted and the suite
stays green. This is the repo's own "an inert guard is worse than no guard, because it is believed"
failure, arriving one level up: the *check* is the guard, and nothing guards the guard.

The behaviour is correct **today** — I verified all three states directly under Claims 6, 7 and 8.
What is missing is anything that keeps it correct tomorrow.

---

## Claim 13 — Cheap suite re-run covering EVERYTHING

**REFUTED.** The suite is not green, and `origin/main` is.

All runs below are in dedicated worktrees so that the concurrent edits described in Claim 15 could
not affect them.

| Tree | commit | api tests | pass | fail | cancelled |
|---|---|---|---|---|---|
| `origin/main` | `6106181` | 894 | **894** | **0** | 0 |
| branch **base** | `82f1fbf` | 894 | 892 | **2** | 0 |
| **branch under review** | `2cd6f69` | 916 | 895 | **18** | 3 |

```
$ cd api && node --test --test-timeout=20000 test/*.mjs
# tests 916   # pass 895   # fail 18   # cancelled 3   # duration_ms 33749
```

App side:

| Tree | app tests | pass | fail | build |
|---|---|---|---|---|
| `origin/main` | 396 | **396** | **0** | — |
| branch `2cd6f69` | 396 | 395 | **1** | `vite build` ✓ built in 3.77s |

Both builds succeed (`api`: `tsc` clean; `app`: `vite build` clean). It is only the tests that fail.

### Attribution — 16 of the 18 api failures are introduced by the two commits under review

The 2 failures on the branch base (`D:ledger-status-is-a-token`,
`D:ledger-manual-names-its-vehicle`, both in `deferredLedger.test.mjs`) come from ledger rows added
in `b8ca0e9`/`82f1fbf` and are **pre-existing, not this work's**. Every other failure is new:

| Cause | Failing cases | Root |
|---|---|---|
| **F-2, the schema ordering defect** | `buildQueueDb.test.mjs` ×10, `dimensionsDb.test.mjs` `H:dimension-ddl-parity`, `schemaParity.test.mjs` *"a database built by UPGRADE is identical to one built FRESH"* (+3 file-level wrappers, +3 cancelled) | all report `relation "insertion" does not exist`, code `42P01` |
| **F-4, `config.ts` broke four pre-existing structural guards** | `H:blank-focus-clears-rather-than-storing-empty`, `H:template-label-absent-means-leave-alone-not-clear`, `H:template-row-is-listed-when-it-has-only-a-name`, `H:template-delete-needs-both-empty` | `templateConfig.test.mjs`, untouched by this branch and green on `main` |

### FINDING F-4 — four template guards are red; the behaviour is fine, the guards are stale

I checked whether these are real regressions or stale patterns, because the two need opposite fixes.
They are **stale patterns**. The guard greps for

```
/if \(!roleFocus && !keepLabel\)[\s\S]{0,220}?deleteEntity\('templates', rowKey\)/
```

and `config.ts:324` now reads

```
if (!roleFocus && !keepLabel && !hasAnySlot(keepSlots)) {
```

The added `&& !hasAnySlot(keepSlots)` is **correct** — a row carrying only slot counts should not be
deleted — and it breaks the literal regex. Same class for the other three. So the behaviour is
right and the assertions need updating to match; but four red guards is still four guards that are
no longer protecting anything, and they cannot be left red.

### FINDING F-5 — the one app failure is a hard-coded count, and I proved the real invariant still holds

`H:ask-why-never-names-the-raw-list-enum` fails on
`assert.equal(fields.length, 5, 'the producer map did not parse')` — `LIST_FIELD_TO_LIST` now has
six entries. Its own message says the count is a parse sanity check, not the invariant. The
invariant is *"every field the producer can write is a key `FIELD_LABEL` knows"*, and I tested that
by execution rather than trusting the reading:

```
$ node probe4.mjs
expertise change -> {"artifactId":"r1","where":"Expertise","text":"Why did you change \"Stakeholder management\" in Expertise?"}
expertise add    -> {"artifactId":"r1","where":"Expertise","text":"Why did you add \"Cross-functional leadership\" to Expertise?"}
leaks any raw enum? false
```

`FIELD_LABEL.ExpertiseBullets = 'Expertise'` already exists (`app/src/assetGate.js:212`), so the
sentence renders correctly and no raw enum reaches the reader. Changing the `5` to a `6` restores a
fully green app suite, and nothing else:

```
$ sed -i "s/fields.length, 5/fields.length, 6/" test/qcRail.test.mjs && npm test
# tests 396   # pass 396   # fail 0
```

**No user-facing defect here** — but it is a red test, and it is the guard that would catch the
*next* list added without a label.

---

## Claim 14 — the KNOWN AND ADMITTED items: are they accurately described?

### "`appPackets.ts:618` passes no `slots` and ignores the return, so `fixed_slot_count` is `not_applicable` in production"

**CONFIRMED, and it is INERT rather than WRONG.** Read at the call site:

```
617  try {
618    await writeSwaps(client, art.packet_id, opp.id, {
619      call1: built.calls.c1, call3: built.calls.c3, pkg,
620      profileText: built.profileText, omitList: built.omitList, loop: 0,
621    })
622  } catch (e) { console.warn('[packets] swap provenance not recorded:', String(e)) }
```

No `slots`, no `master` (loaded inside `writeSwaps`), and the return value is discarded. Swept both
directions for any other supplier:

```
$ grep -rn "runChecks(" api/src --include=*.ts | grep -v dist
api/src/functions/tests/appChecks.ts:108:  const results = runChecks({
api/src/functions/tests/checks.ts:319:export function runChecks(...)

$ grep -rn "slots" appChecks.ts appPackets.ts appRemediation.ts
(no output — nothing passes slots to runChecks either)
```

So in production `input.slots` is `undefined`, `known.length` is 0, and the check emits
`not_applicable` with *"no per-template slot count is set for …"* — which I reproduced exactly
(Claim 6). **It accuses nobody**: `not_applicable` cannot fail a gate, cannot name an offender, and
`slotsFor` cannot degrade to `{n: 0}`. The description is accurate and the state is the honest one.
The feature is simply **not yet reachable end to end**.

### "`roleFocus.ts` carries a handoff comment instead of the wiring"

**CONFIRMED.** The entire `roleFocus.ts` diff on this branch is an 11-line comment inside
`ResolvedRoleFocus` — no `slots` field, no code:

```
+  // NEXT UNIT, deliberately NOT added yet: `slots: Record<string, number|null>` …
+  // … Until that lands, `runChecks` reports
+  // `fixed_slot_count: not_applicable`, which is the correct state for a count nobody supplied.
```

Accurately described, and it names the right reason (importing `config.ts` would pull `app.http`
route registration into `node --test`). The proposed `tests/slots.ts` is the "extend, don't
duplicate" shape.

### "The six AC-16 H-cases are NOT yet written"

**CONFIRMED — outstanding.**

```
$ git diff --stat 82f1fbf..2cd6f69 -- api/test/hardening.test.mjs
(no output — the file is untouched)

$ grep -rn "test('H:swap-original|test('H:swap-pairs|test('H:fixed-slot|test('H:slot-count|test('H:slot-check|test('H:swap-actions" api/test/
(no output — none written)
```

All six slugs appear only as prose, in `AC-fixed-slot-swap-pairing.md` and `IMPL-swap-pairing.md`.
Note this overlaps F-3: `H:slot-count-unknown-is-not-applicable` and
`H:slot-check-is-emitted-for-every-list` are precisely the two that would have caught mutations M9
and M10.

---

## Claim 15 — a process finding the brief did not ask for, but which affects every verdict above

**The working tree moved while I was verifying it.** At the start of this pass
`git status --porcelain` was clean at `2cd6f69`. Twenty minutes later:

```
$ git status --porcelain
 M api/src/functions/tests/swaps.ts
 M api/test/swaps.test.mjs
 M docs/qc-evidence/IMPL-swap-pairing.md

$ ls -l --time-style=full-iso api/src/functions/tests/swaps.ts
-rw-r--r-- 1 root root 32812 2026-08-30 02:54:48 ... swaps.ts        # 5 seconds before I looked
```

Two tests named `F-1: an owner row that also matches a requirement carries NO citation` and
`F-1: the DB citation contract holds for EVERY row this module can emit` appeared in the working
tree — present in neither `35cab5d` nor `2cd6f69`. Someone is fixing F-1 concurrently.

**How I handled it, so these verdicts remain reproducible:** I moved all execution into
`git worktree` checkouts pinned to fixed commits (`2cd6f69`, `82f1fbf`, `origin/main`) and re-ran
every behavioural probe against the pinned build. Every result reported above reproduced identically
there. I did not `git stash` and did not touch the shared tree beyond this verdict file.

**Consequence for the reader:** this report is a verdict on `2cd6f69`. If the concurrent work lands
the F-1 fix, re-check F-1 only — every other finding is independent of `row()`.

---

# VERDICT SUMMARY

| # | Claim | Verdict |
|---|---|---|
| 1 | AC-1 — no `from_label` from `call1[passA]` when a master block exists; `call1` fallback is honest degradation | **CONFIRMED** |
| 2 | AC-3 — set membership, order-independent, duplicates one-for-one | **CONFIRMED** |
| 3 | AC-4 — leftovers pair by POSITION, on a fixture where similarity disagrees (non-vacuous) | **CONFIRMED** |
| 4 | AC-5 — sub-threshold positional pair: `unattributed`, NULL quote, 0 confidence, DB contract held | **CONFIRMED** |
| 5 | AC-6 — owner exemption yields `driver='owner'`, excluded from `unattributed` | **CONFIRMED** |
| 6 | AC-7/8/10 — `slotsFor` never `{n:0}`; `fixed_slot_count` `not_applicable` when unknown | **CONFIRMED** |
| 7 | AC-9 — no throw **and** a deterministic `fail` check row (both halves) | **CONFIRMED** |
| 8 | AC-11 — `compact_resume` emits `not_applicable`, PRESENT in the results array | **CONFIRMED** |
| 9 | AC-12 — existing `added`/`dropped` rows read and render (live DB: 8 dropped, 7 added) | **CONFIRMED** |
| 10 | AC-14/DDL — all three tables admit `expertise` **on upgrade**, with the vacuity control | **CONFIRMED** |
| 10b | …the same schema on a **FRESH** database | **REFUTED** — F-2 |
| 11 | `ExpertiseBullets -> 'expertise'`, and the blank-status consequence | **CONFIRMED** |
| 12 | Every new guard mutation-proved (M1-M8) | **CONFIRMED** |
| 12b | `fixed_slot_count`'s three states guarded by anything | **REFUTED** — F-3, M9/M10/M11 all fail=0 |
| 13 | Cheap suite re-run covering EVERYTHING | **REFUTED** — 18 api + 1 app failures; `main` is 894/894 and 396/396 |
| 14 | Known-and-admitted items accurately described (inert `slots`, `roleFocus` comment, unwritten H-cases) | **CONFIRMED** |
| 15 | Verdicts pinned against a concurrently-moving tree | **CONFIRMED** (method note) |

**CONFIRMED 13 · REFUTED 3 · NOT_APPLICABLE 0**

The pairing engine itself — the substance of this work — is correct, and I could not break it:
every behavioural AC passed, and every guard I tried to defeat fired. The three refutations are all
about what surrounds it: a migration that cannot build a new database, a gate-deciding check nobody
guards, and a red suite.

## REQUIRED BEFORE DONE

1. **F-2 — BLOCKING.** Move the `alter table insertion drop/add constraint … insertion_list_check`
   pair from `schema.ts` line 634 to **after** `create table if not exists insertion` (line 654).
   Verify with `psql -v ON_ERROR_STOP=1 -f <schema> -d <FRESH db>` **and**
   `node --test api/test/schemaParity.test.mjs`. Until this lands the migration aborts on any new
   environment, and the expertise DDL cannot ship.
2. **F-3.** Write the two H-cases that mutations M9 and M10 defeated —
   `H:slot-count-unknown-is-not-applicable` and `H:slot-check-is-emitted-for-every-list` — plus one
   for M11 (a mismatch must be `fail`). Mutation-prove each. These are AC-16 items already agreed.
3. **F-1.** Null `verbatim_quote` / `requirement_seq` / `confidence` when `driver` resolves to
   `'owner'`, or the row is rejected by `swap_decision`'s CHECK and the whole swap table is lost to
   the swallowing catch. Pre-existing on `main`, but this branch increases its reachability. (Work
   appeared in the tree during this pass — re-verify.)
4. **F-4.** Update the four `templateConfig.test.mjs` guards to match the corrected
   `!roleFocus && !keepLabel && !hasAnySlot(keepSlots)` behaviour. Behaviour is right; the greps are
   stale.
5. **F-5.** `api/test/qcRail.test.mjs` — `fields.length, 5` -> `6`. One character; restores a green
   app suite.
6. **Outstanding, not blocking:** the remaining four AC-16 H-cases; a consumer for
   `ListCounts.baselineSource` (currently write-only); and the `tests/slots.ts` extraction that
   makes `fixed_slot_count` reachable end to end.

## NOT VERIFIABLE FROM HERE

- **AC-15** (the live 9-of-14 regression case flips) — **NOT_APPLICABLE**. It needs a packet
  *rebuilt on this branch*, and this branch is not deployed (`api-deploy.yml` fires on `main`
  only). What would settle it, in order: land the branch, then
  `api-test.yml {"method":"POST","path":"/api/app/opportunity/<uuid>/build"}`, then
  `db-query.yml "select from_label from swap_decision where packet_id='<id>'"`, then
  `api-test.yml {"method":"GET","path":"/api/diag/skill-sources"}`, and assert every `from_label`
  appears in the master blocks. I read the CURRENT live counts (Claim 9) but those are pre-change
  rows and prove nothing about the new pairing.
- **AC-13** (the compact-resume drop-pool before/after measurement) — **NOT_APPLICABLE**. No
  before/after record exists in the branch, and producing one needs the same live rebuild. Flagged
  because AC-13 is met *by having measured it*, and it has not been measured.

## END OF VERIFY PASS

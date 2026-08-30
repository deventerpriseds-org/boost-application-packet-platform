# VERIFY — fixed-slot swap pairing (loop 1)

## VERIFY LOOP
work: fixed-slot-swap-pairing
loop: 1

Independent verifier. No shared context with the implementers. Branch
`claude/incumbent-wins-swap`, commits `35cab5d`, `2cd6f69`.
Every verdict below cites a command actually run in this container and its real output.

**STATUS: IN PROGRESS** — this banner is rewritten to COMPLETE only when every claim has a verdict.

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

# VERIFY-frames-loop2 — independent loop-2 verification of `5a6728d`

Verifier agent. No shared context with the implementer. Evidence only.

- Repo HEAD at start: `25fdd5f` (doc-only on top of `5a6728d`).
- **`api/` at HEAD is byte-identical to `api/` at `5a6728d`** — `git show --stat 25fdd5f` lists
  only `CLAUDE.md`. So testing the working tree == testing the commit under test.

Findings appended incrementally below.

---

## Method — I did NOT model the database. I ran the real routes.

Loop 1 modelled the `correction` table in JS. I stood up **PostgreSQL 16.13 locally with SSL** and
imported `api/dist/functions/tests/appCorrections.js`, so `applyCorrectionPass`,
`artifactOwnerEdit`, `correctionRevert` and `ensureCorrectionTable` all run for real against a live
server. The SELECT projection F-1 was about is the actual projection; `frame` is an actual column;
every CHECK constraint is enforced. Harnesses:

| file | what it drives |
|---|---|
| `docs/qc-evidence/loop2-e2e-routes.mjs` | the three real routes end to end: claims 1/3, the F-1 column-is-read probe, and 4 real rebuild shapes for claim 7 |
| `docs/qc-evidence/loop2-rebuild-detector.mjs` | whether the rebuild-detector branch is reachable with production-shaped data |

Setup (reproducible):
```
initdb -D /tmp/pgd -U postgres -A trust ; ssl=on with a self-signed cert (pgClient forces ssl)
pg_ctl -o '-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1' start
createdb ee ; create extension "uuid-ossp" ; create table packet(...) ; create table artifact(...)
DATABASE_URL=postgres://postgres@127.0.0.1:55432/ee node docs/qc-evidence/loop2-e2e-routes.mjs
```
`ensureCorrectionTable()` — the production DDL — created the table. Observed columns:
`applied_seq, artifact_id, before_sha256, char_end, char_start, created_at, frame, id, loop,
merge_field, phrase, reason, replacement, reverted_at, reverted_by, run_id, source`.

## Complete enumeration of every refusal `revertOne` can return

Extracted from `api/src/functions/tests/correction.ts` with comments stripped
(`reason:\s*(\`…\`|'…'|"…"|IDENT)`). Reachable from `revertOne`:

| # | reason | asserts a cause? |
|---|---|---|
| 1 | `` `no applied correction with seq ${seq}` `` | no |
| 2 | `` `this change log contains a change of a kind this version cannot place (${names}), so nothing was undone` `` | no |
| 3 | `'this field was rebuilt after you edited it, so the changes are recorded in an order this version cannot safely unpick'` | **YES — a rebuild AND a human edit** |
| 4 | `` `this text no longer matches the change log (change ${n} is not where the record says it is)` `` | no |
| 5 | `STALE_STATE_REASON` (x2 sites) | no — names both possibilities, accuses neither |
| 6 | `` `this text no longer matches the change log (${e.message})` `` (x2 sites) | no |
| 7 | `` `undoing this would lose your edit: ${at.reason}` `` where `at.reason` ∈ {`'the edit records no phrase to find'`, **`'this field was rewritten and no longer contains the words you changed'`**, `'those words now appear more than once in this field…'`} | **the middle one asserts the field was rewritten** |

The sentence claim 7 was about — *"this field was edited after the correction was applied"* — is
**gone from the module**; both of its call sites now return `STALE_STATE_REASON`.

## CONFIRMED — F-1 is really fixed: the `frame` column is READ by the production route

`loop2-e2e-routes.mjs`, against the live DB. Adversarial probe: store a `frame` that contradicts
the `source`→frame map on a real `owner_edit` row and see whether the outcome changes.

```
stored rows          : seq1/generalized/frame=original  seq2/owner_edit/frame=applied
frame column forced to ORIGINAL (map says applied)
revert result        : {"ok":false,"reason":"this text no longer matches the change log (correction 2 is not where the record says it is)"}
revert with truthful frame=applied: {"ok":true,"merge_field":"F","text":"Led 8-figure supplier negotiation across teams"}
ok      F-1 FIXED: a stored frame that contradicts the source map CHANGES the outcome ⇒ the column is READ
```
The map's answer would have been `ok:true`. The column's answer is a refusal. **CONFIRMED.**

## CONFIRMED — claims 1 and 3, re-derived through the real routes (not a fixture)

```
pipeline rows planned: 1 [["$18M","8-figure"]]
text after pass      : "Led 8-figure supplier negotiation across teams"
owner edit           : {"ok":true,...,"text":"Led 8-figure Vendor selection across teams","applied_seq":2}
revert OWNER row     : {"ok":true,"text":"Led 8-figure supplier negotiation across teams"}   ← claim 1a
revert PIPELINE row  : {"ok":true,"text":"Led $18M Vendor selection across teams"}           ← claim 1b
revert with frame=NULL on every row (legacy): {"ok":true,...}                                 ← claim 3
```
Claim 3 is the no-backfill guarantee: with `frame` NULLed on every row in the database, both rows
still revert through `CORRECTION_FRAME`. **CONFIRMED.**

## CONFIRMED — claim 4, the safety floor, re-derived. 12,840 tampered reverts, 0 splices.

`docs/qc-evidence/loop2-safety-floor.mjs`. Ledgers are built by the REAL producers
(`planCorrections` + `scanEcho`, then owner edits placed by `locateOwnerPhrase`), so every fixture
is one the system can actually emit. 18 scenarios × 3 frame variants:
`declared` (frame stored), `legacy-absent` (no `frame` key at all), `legacy-null` (`frame: null`,
which is what pg returns for an unbackfilled column).

Tamper classes at **every character position**: same-length case flip, same-length byte swap,
insertion (+3), deletion (−1), insertion of a decoy replacement (`8-figure`). Inside replacements
and outside them alike.

```
── control: untampered reverts must SUCCEED ──
  untampered reverts that SUCCEEDED: 48        ← 48/48. the sweep is not vacuous.

tampered reverts   : 12840
  refused          : 12840
  ok:true, tamper inside the target's own replacement (legitimate) : 0
  ok:true, tamper survived intact (no splice into moved text)      : 0
  SPLICES / anomalies                                              : 0
```
**Every single tampered document was refused.** Not one splice.

### The sweep is load-bearing — proven by mutation, not asserted

Delete the positional check in the applied-frame unwind loop (`correction.ts:367-369`) and re-run
the identical sweep:

```
tampered reverts   : 12840
  refused          : 11679          ← 1,161 fewer
  ok:true, tamper survived intact : 1125
  SPLICES / anomalies             : 36        ← e.g. "length arithmetic wrong: got 42"
```
So the 12,840/12,840 refusal at `5a6728d` is a measured property of the code, not an artefact of a
sweep that could not tell the difference. The oracle's non-vacuity is separately demonstrated in the
script: fed a hand-built splicing output, it reports `YES — the tamper is gone, this would be reported`.

## CONFIRMED — the two NEW guards are real. Both mutation-proved.

| mutation | result |
|---|---|
| delete the positional check from the applied-frame unwind loop | `not ok 158 - H:revert-positional-check-is-load-bearing` — **842 pass / 1 fail**, and it is the ONLY failure, matching loop 1's report that 840/840 stayed green without it |
| remove `frame` from `api/test/sql/correction.sql` (reinstates F-2 exactly) | `not ok 163 - H:correction-ddl-column-parity` — 842/1 |
| remove a DIFFERENT column (`reverted_by`) from the same fixture | `not ok 163 - H:correction-ddl-column-parity` — 842/1 ⇒ the guard catches the **class**, not just `frame` |

## CONFIRMED — the changed pre-existing assertion was rewritten, not weakened

Test `the hash is RECOMPUTED — an edit that disturbs no offset is still caught` (#141) drives
original-frame rows, so its refusal comes from the target hash check at `correction.ts:390`.
Deleting that check:

```
MUTATION: original-frame target hash check DELETED
not ok 141 - the hash is RECOMPUTED — an edit that disturbs no offset is still caught
# tests 843 / # pass 842 / # fail 1
```
The test still fails when the guarded behaviour is removed, so `ok === false` and
`text === undefined` are live assertions, not decoration. Independently, three mutations of
`STALE_STATE_REASON`'s wording each failed #141 as well, so the new wording assertion is live too.

## CONFIRMED — claims 2, 5, 6, re-derived (`docs/qc-evidence/loop2-claims-2-5-6.mjs`)

```
CLAIM 2 — two owner edits, NO pipeline row
  rows : seq1/owner_edit/applied  seq2/owner_edit/applied     ← ledger really has no pipeline row
  undo seq1: ok=true "Ran the supplier negotiation across squads"   ← the 2nd edit stays in place
  undo seq2: ok=true "Ran the Vendor selection across teams"        ← the 1st edit stays in place

CLAIM 5 — an unplaceable row
  refusal: "this change log contains a change of a kind this version cannot place
            (imported_from_elsewhere), so nothing was undone"      ← names the source, writes nothing
  every DB-legal source has a frame: profile_figure=original, generalized=original, owner_edit=applied

CLAIM 6 — 3 owner rows, poison each hash in turn, always undo seq1
  control (all hashes intact), undo seq1: ok=true
  poison seq1 → refused    poison seq2 → refused    poison seq3 → refused
```
All three **CONFIRMED**, with the results checked as exact text, not merely `ok:true`.

## CHALLENGE THE RADIUS — I accept the exclusion of claim 8, and here is the primary source

I did not re-run the 4,000-field differential. I checked the thing the differential is a proxy for:
**did the functions claim 8 is about actually change?** Function bodies extracted from both commits
with comments stripped and diffed:

```
$ diff <(git show a0c98a5:…/correction.ts | strip-comments | extract-fns) \
       <(git show 5a6728d:…/correction.ts | strip-comments | extract-fns)
133c133
<       return { ok: false, reason: 'this field was edited after the correction was applied, …' }
---
>       return { ok: false, reason: STALE_STATE_REASON }
144c144   (the same substitution, second site)
```
`planCorrections`, `applyCorrections`, `originalOf`, `isWellFormed`, `reapplyOwnerEdits`,
`locateOwnerPhrase` and `frameOf` are **byte-identical across the two commits**. The only
behavioural delta in the whole file is two reason strings inside `revertOne`. Claim 8's subject is
provably untouched — the radius is right, and this settled it in one command rather than 4,000
comparisons.

### …but the radius's *reasoning* is wrong in a way that matters

The brief says *"F-1 changed what `frameOf` returns for REAL rows."* **It did not.** There are
exactly two writers of `correction`:

```
appCorrections.ts:140  insert … source=$10 (always 'generalized'), frame='original'
appCorrections.ts:375  insert … source='owner_edit',               frame='applied'
```
and `CORRECTION_FRAME` maps `generalized → original`, `owner_edit → applied`. **The column and the
map agree for every row the system can currently write**, so reading the column changes no outcome
on real data. F-1 is a real and necessary fix — a column nothing read was a column that meant
nothing — but it is latent, not behaviour-changing. Confirmed on the live DB: the only rows the
routes produced were `seq1/generalized/frame=original` and `seq2/owner_edit/frame=applied`.

Direction of the error is safe (the radius was drawn wider than needed), so nothing was under-tested.

---

# CLAIM 7 — the headline holds; **two of its three supporting statements are REFUTED**

## 7a. CONFIRMED — the old sentence is gone from every path

The function-body diff above shows both sites now return `STALE_STATE_REASON`, and the complete
enumeration of `reason:` literals in the module contains no occurrence of
*"this field was edited after the correction was applied"*. Across the four rebuild shapes driven
through the **real routes** (`loop2-e2e-routes.mjs`), the only refusals returned were:

```
1. "this text no longer matches the change log (change 2 is not where the record says it is)"
2. "this field no longer matches what that change was recorded against, so the original cannot be
    restored safely — it may have been rebuilt or edited since"
```
Neither accuses anyone. Loop 1 measured 10 false accusations across the same class of shapes; I
measured 0.

## 7b. REFUTED — the rebuild detector is **not** "near-unreachable". It fires on a plain production shape.

The brief states the detector *"is known to be near-unreachable"*. `docs/qc-evidence/loop2-rebuild-detector.mjs`,
driving the real `applyCorrectionPass` / `artifactOwnerEdit` / `correctionRevert` against the live
database, with `run_id` NULL — which is the **only** shape production has, because the one caller,
`appPackets.ts:538`, passes no `runId`:

```
build-1 planned : $18M->8-figure@seq1
owner edit      : {"ok":true,...,"applied_seq":2}
build-2 planned : $25M->8-figure@seq1, 60+->multiple@seq2, 12->multiple@seq3

STORED LEDGER (what revertOne is handed):
  seq1  generalized frame=original  "$18M" -> "8-figure"
  seq2  owner_edit  frame=applied  "supplier negotiation" -> "Vendor selection"
  seq3  generalized frame=original  "12" -> "multiple"
  max(original seq)=3  min(applied seq)=2  detector fires: true

REFUSALS FROM THE REAL ROUTE:
  seq1 (generalized): ok=false  "this field was rebuilt after you edited it, so the changes are
                                 recorded in an order this version cannot safely unpick"
  seq2 (owner_edit) : ok=false  (same)
  seq3 (generalized): ok=false  (same)
```
The recipe is ordinary: **build-1 makes one correction, the owner edits, the rebuild makes three.**
`planCorrections` restarts at 1, `on conflict do nothing` drops seq 1 and 2, seq 3 lands as
`frame='original'` above the owner's seq 2, and the detector fires. No hand-built ordering.

**Is the sentence FALSE there?** No — in this shape a rebuild genuinely did follow an owner edit, and
I could not construct a firing where it had not (applied-frame rows come only from `owner_edit`, and
the owner's `max(seq)+1` guarantees no original-frame row outranks it until a later pass runs). So
this is a **mischaracterisation of reachability, not a live false accusation.** But the refusal does
assert a human edit — *"after **you edited it**"* — which is precisely the category 7c is supposed to
make impossible.

## 7c. REFUTED — the guarantee is **not** unconditional. The grep guard sees one wording only.

`H:revert-refusal-names-no-culprit` matches `/reason: ?'([^']*was edited[^']*)'/`. Its own comment
claims it *"asserts the INVARIANT rather than the incident: no refusal from this module may claim the
field 'was edited', full stop."* It does not. Mutation, applied to the live refusal at
`correction.ts:368` — the same place the original defect lived:

```
MUTATION 3d re-applied
$ grep -c "you edited this field after the correction was applied" dist/functions/tests/correction.js
1                                          ← the mutation really compiled into dist
$ node -e "revertOne(tamperedText, [genRow, ownerRow], 1)"
{"ok":false,"reason":"you edited this field after the correction was applied, so nothing was undone"}
                                           ← and it is REACHABLE, not dead code
$ npm test
# tests 843 / # pass 843 / # fail 0      ← SHIPS GREEN
```
A one-word rewording — `was edited` → `you edited` — walks straight past the guard, and the resulting
sentence is the exact false accusation claim 7 exists to remove. For contrast, the same refusal
written with the literal bigram is caught:

```
MUTATION 3e: "this field was edited after the correction was applied, so nothing was undone"
not ok 159 - H:revert-refusal-names-no-culprit   # pass 842 / fail 1
```
And this is not hypothetical: **the module already ships a sentence the guard cannot see** — 7b's
`'this field was rebuilt after you edited it…'`, which I proved is reachable.

## 7d. NEW FINDING (L2-1) — a reachable refusal from `revertOne` that IS false

`revertOne` re-places surviving owner rows with `locateOwnerPhrase` (`correction.ts:411-415`) and
wraps its reason verbatim. One of those reasons asserts a cause:

```
PROBE — owner edits a phrase that spans a pipeline replacement, then the pipeline row is undone
  text : "Led a major sourcing programme across teams"
  rows : seq1/generalized  seq2/owner_edit
  undo the pipeline row: {"ok":false,"reason":"undoing this would lose your edit: this field was
                          rewritten and no longer contains the words you changed"}
```
**The field was not rewritten.** Nothing regenerated it and nobody edited it. The owner's phrase is
missing because the phrase contained `8-figure`, and undoing the pipeline row is what removed it —
i.e. *the operation the user just asked for* is the cause. The sentence is correct for
`reapplyOwnerEdits` (its other caller, where a rebuild really did rewrite the field) and wrong here.

Severity: **low.** The refusal writes nothing, the `"undoing this would lose your edit:"` prefix
partially rescues it, and it does not accuse a person. But it is the same class as claim 7 — a
refusal asserting a cause the code did not establish — in a refusal the fix did not touch and the
guard cannot see.

---

# Two further observations (neither refutes a claim)

## L2-2 (low) — a MALFORMED stored `frame` silently falls back to the map instead of refusing

F-1 made the column authoritative. `frameOf` accepts only the two exact strings and otherwise falls
through to `CORRECTION_FRAME[source]`:

```
frame="ORIGINAL"   -> frameOf()="original"      frame=""      -> frameOf()="original"
frame="Applied"    -> frameOf()="original"      frame=0       -> frameOf()="original"
frame="orig"       -> frameOf()="original"      frame=true    -> frameOf()="original"
frame=" original"  -> frameOf()="original"      frame={}      -> frameOf()="original"
revert with frame='ORIGINAL' on every row: ok=true "Led $18M Vendor selection across teams"
```
AC-5's stated rule is *"an undeclared frame is a refusal that NAMES the source, never a default"*. A
row that **declares** a frame this version cannot read is treated as if it declared nothing, and the
reader guesses from `source` — the exact inference the column was added to stop doing.

In practice this is **defence-in-depth only**: `ensureCorrectionTable` re-adds
`check (frame is null or frame in ('original','applied'))` idempotently on every route call, so a
database any route has touched cannot hold junk. Confirmed on the live DB — the constraint exists.

## L2-3 (out of radius, pre-existing) — a rebuild's corrections reach the DOCUMENT but not the CHANGE LOG

Observed while driving the real routes, not introduced by this commit. `on conflict do nothing` keys
on `(artifact_id, merge_field, applied_seq, coalesce(run_id, zeros))`, and `planCorrections` restarts
`applied_seq` at 1 every pass, so a rebuild's rows collide with the previous pass's and are dropped —
while `applyCorrections` has already put their text into `pkg_json`:

```
build-2 planned : $25M->8-figure@seq1, 60+->multiple@seq2, 12->multiple@seq3
build-2 text    : "Closed 8-figure of renewals, delivered multiple launches and ran multiple teams"
STORED LEDGER   : seq1 = the OLD "$18M"->"8-figure" row from build-1
                  seq2 = the owner edit
                  seq3 = "12"->"multiple"
```
Two of build-2's three corrections (`$25M→8-figure`, `60+→multiple`) are **in the document with no
row in the change log**. The product's stated contract is *"the user reviews a change log, not a
to-do list"*; here the log understates what was changed. Flagged for the register — it is not this
fix's doing and I did not test it further.

---

# Verdict table

| # | claim (loop-1 numbering) | loop-2 result | evidence |
|---|---|---|---|
| 1 | `generalized` + `owner_edit` on one field: both revert | **CONFIRMED** | real routes on live pg: owner→`ok:true "Led 8-figure supplier negotiation across teams"`, pipeline→`ok:true "Led $18M Vendor selection across teams"` |
| 2 | Two `owner_edit` rows, no pipeline row, both revert | **CONFIRMED** | `loop2-claims-2-5-6.mjs`; both `ok:true`, and each undo leaves the *other* edit in place |
| 3 | Legacy rows with no `frame` still revert | **CONFIRMED** | `frame` NULLed on every row **in the database**, revert still `ok:true`; also `legacy-absent`/`legacy-null` variants across 4,280 tampers each |
| 4 | The safety floor is not loosened | **CONFIRMED** | 12,840 tampered reverts, **12,840 refusals, 0 splices**; control 48/48 untampered succeed; sweep mutation-proved load-bearing (deleting the positional check yields 1,161 `ok:true` and 36 flagged anomalies) |
| 5 | Unknown `source` refuses and names the source | **CONFIRMED** | refusal names `imported_from_elsewhere`, `text === undefined` |
| 6 | Every unwound owner row is hash-verified, not just the target | **CONFIRMED** | 3-row log, each hash poisoned in turn, all three refuse while undoing seq 1; control `ok:true` |
| 7 | A refusal reason is never FALSE | **CONFIRMED (headline) / 2 supporting statements REFUTED** | see below |
| 8 | The document is unchanged | **CONFIRMED without re-running the differential** — the functions it is about are byte-identical across `a0c98a5→5a6728d` |
| F-1 | the `frame` column is now READ | **CONFIRMED** | a stored frame contradicting the source map flips the real route's answer from `ok:true` to `ok:false` |
| F-2 | `H:correction-ddl-column-parity` is real | **CONFIRMED** | fires on the original defect *and* on a different column ⇒ guards the class |
| F-3 | `H:revert-positional-check-is-load-bearing` is real | **CONFIRMED** | deleting the check fails exactly that one test, 842/1 |
| — | the changed pre-existing assertion was not weakened | **CONFIRMED** | deleting the guarded behaviour fails test #141; its `ok===false` / `text===undefined` assertions are live |

### Claim 7, broken out

| sub-claim | result |
|---|---|
| 7a "the old sentence is gone from every path" | **CONFIRMED** — full enumeration + 0 accusations across 4 real rebuild shapes |
| 7b "the rebuild detector is near-unreachable" | **REFUTED** — fires on a plain production shape (1 correction → owner edit → rebuild plans 3). Its sentence was TRUE in every firing I could construct |
| 7c "the guarantee is now unconditional via a source grep guard" | **REFUTED** — `you edited this field after the correction was applied`, live and reachable in `revertOne`, ships **843/843 green** |
| 7d (new) `undoing this would lose your edit: this field was rewritten…` | **FALSE cause, reachable** — the undo itself removed the phrase; nothing rewrote the field |

# Required before this is done

1. **Fix 7c — the guard is the load-bearing artefact and it does not bear the load.** Match the
   concept, not the bigram: forbid any refusal in `revertOne` that names an actor or a cause. A
   workable shape is an allow-list — every `reason` returned by `revertOne` must be one of a small
   set of approved constants — which is enforceable and cannot be reworded around.
2. **Fix 7b's sentence, or the claim.** `'this field was rebuilt after you edited it…'` asserts a
   human edit, is reachable, and is invisible to the guard. Either replace it with
   `STALE_STATE_REASON` (it is a refusal either way) or stop describing the detector as unreachable.
3. **7d** — `revertOne` should not forward `locateOwnerPhrase`'s zero-occurrence reason verbatim;
   in the revert path the cause is the undo, not a rewrite.
4. **L2-2** — decide whether an unreadable declared `frame` should refuse rather than fall back.

Nothing above blocks the frame fix itself: **claims 1-6 and 8 hold, F-1/F-2/F-3 are genuinely
closed, and the safety floor is intact across 12,840 attacks.** The outstanding items are all about
what a refusal SAYS, and about a guard that is believed to be stronger than it is.

# Reproduce

```
npm run build && npm test     # 843/843
cd .. && node docs/qc-evidence/loop2-safety-floor.mjs                                 # 12840 / 0 splices
node docs/qc-evidence/loop2-claims-2-5-6.mjs                                          # claims 2,5,6 + probes
# with local pg on 55432 (see Method):
DATABASE_URL=postgres://postgres@127.0.0.1:55432/ee node docs/qc-evidence/loop2-e2e-routes.mjs
DATABASE_URL=postgres://postgres@127.0.0.1:55432/ee node docs/qc-evidence/loop2-rebuild-detector.mjs
```

**Tree state on exit:** `git diff 5a6728d -- api/` is empty — `api/` is byte-identical to the commit
under test. Full suite re-confirmed **843 pass / 0 fail** after every mutation was restored.

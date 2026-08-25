# VERIFY-frames — independent verification of `D:owner-edit-offsets-two-frames` (commit a0c98a5)

Verifier agent. No shared context with the implementer. Every line below is an observed
command + output, or it is marked as an unverified inference.

Branch under test: `claude/render-interaction-states` @ `a0c98a5` (also on `main`).

Status: COMPLETE. **7 of 8 claims CONFIRMED, claim 7 REFUTED**, plus three defects the claims did
not ask about (F-1 the `frame` column is never read; F-2 a third DDL home was not updated; F-3 a
load-bearing check with no guard). The schema migration and all 8 new guards are confirmed real.
Jump to [VERDICT](#verdict).

## 0. Orientation (observed)

```
$ git log --oneline -1
a0c98a5 Fix D:owner-edit-offsets-two-frames — the reader learns the frame (option b)
$ git show a0c98a5 --stat --format=""
 api/src/functions/tests/appCorrections.ts |  22 +++-
 api/src/functions/tests/correction.ts     | 164 +++++++++++++++++++++++++++++-
 api/src/functions/tests/schema.ts         |  12 +++
 api/test/correction.test.mjs              | 151 +++++++++++++++++++++++++++
 4 files changed, 340 insertions(+), 9 deletions(-)
```

## F-1. FINDING (defect, found before testing any claim): the ONLY production reader of
## `correction` rows DROPS the new `frame` column. The column is write-only.

The commit's headline design decision is *"THE FRAME IS RECORDED, NOT INFERRED … `correction.frame`
is a real column, declared by both writers. The map remains as the reader for legacy NULLs."*

Both writers do declare it (verified in the diff). **No reader ever selects it.**

```
$ grep -rn "from correction" api/src/
api/src/functions/tests/appSwaps.ts:46:    `select distinct c.replacement from correction c
api/src/functions/tests/appCorrections.ts:163:         from correction                      <- applyCorrectionPass, no `frame`
api/src/functions/tests/appCorrections.ts:188:       from correction where artifact_id = $1 ... <- listCorrections, no `frame`
api/src/functions/tests/appCorrections.ts:243:      `select * from correction where id = $1`   <- target row (select *, so frame IS fetched)
api/src/functions/tests/appCorrections.ts:253:      `select * from correction where artifact_id = $1 and merge_field = $2 ...` <- siblings
```

`siblings` does `select *`, so the column comes back from pg — and is then **discarded by hand** in
the projection that builds the array `revertOne` is actually given
(`api/src/functions/tests/appCorrections.ts:255-259`):

```ts
const applied: Correction[] = siblings.map(r => ({
  merge_field: r.merge_field, phrase: r.phrase, replacement: r.replacement,
  char_start: r.char_start, char_end: r.char_end, before_sha256: r.before_sha256,
  applied_seq: r.applied_seq, reason: r.reason, source: r.source,
}))                                                  // <- `frame:` is NOT here
```

`frame` is `frame?: CorrectionFrame | null` (optional) on the `Correction` interface, so omitting it
is not a compile error. Every row that reaches `revertOne` **through the HTTP route** therefore has
`frame === undefined` and resolves *only* through `CORRECTION_FRAME`, i.e. by inferring the frame
from `source` — the exact inference the commit message says it replaced.

**Observable consequence, not just tidiness.** The unit test
`H:correction-frame-declared-not-guessed` asserts
`frameOf({...alien, frame:'applied'}) === 'applied'` — *"a row that DECLARES its frame is readable
even when its source is unknown to this version."* That is true of `frameOf` and **false of the
product**: a row with an unmapped `source` and a declared `frame` is refused by the route, because
the route never hands `frameOf` the declared frame. The guard passes on a fixture the route can
never produce.

Today the map and the declarations agree, so no *current* behaviour differs. The defect is that the
column provides zero protection against the drift it was added to prevent, and the test suite cannot
tell.

Fix is one line: add `frame: r.frame,` to that projection (and, if the change log should show it,
`frame` to `listCorrections`' projection at :186).

---

## Harness

Two scripts written by the verifier, independent of `repro-offset-frames*.mjs`:

| Script | What it does |
|---|---|
| `docs/qc-evidence/verify-frames-harness.mjs` | Claims 1–8 against `api/dist/functions/tests/correction.js`. Pipeline rows come from the REAL producer (`planCorrections` fed by `scanEcho`); owner rows are built with the exact arithmetic `artifactOwnerEdit` performs (`appCorrections.ts:344-373`). |
| `docs/qc-evidence/verify-frames-rebuild.mjs` | Claim 7 only, with a model of the `correction` table that reproduces the real `applied_seq` numbering of BOTH writers and the real unique index + `on conflict do nothing`. |

Baseline first, so a later failure is attributable:

```
$ cd api && npm run build && npm test | tail -8
1..840
# tests 840
# pass 840
# fail 0
```

## Claim 1 — CONFIRMED. `generalized`(seq 1) + `owner_edit`(seq 2) on one field: both revert.

```
$ node docs/qc-evidence/verify-frames-harness.mjs
FIELD      = "Led $18M supplier negotiation across 60+ teams"
afterGen   = "Led 8-figure supplier negotiation across 60+ teams"
both       = "Led 8-figure Vendor selection across 60+ teams"
revert seq2 -> {"ok":true,"text":"Led 8-figure supplier negotiation across 60+ teams"}
revert seq1 -> {"ok":true,"text":"Led $18M Vendor selection across 60+ teams"}
  ok  seq2 (owner) ok:true and text === pipeline-only text
  ok  seq1 (pipeline) ok:true and text === "Led $18M Vendor selection across 60+ teams"
```
Both texts are exactly right: undoing the owner row restores `supplier negotiation` and keeps
`8-figure`; undoing the pipeline row restores `$18M` and keeps `Vendor selection`.

Pre-fix behaviour confirmed separately (`git stash`-free check against `origin/main`, §Claim 8
below): on `main` both of these return `ok:false`.

## Claim 2 — CONFIRMED. Two `owner_edit` rows, no pipeline row, both revert.

```
t1 = "Led $18M Vendor selection across 60+ teams"
t2 = "Led $18M Vendor selection spanning 60+ teams"
revert seq2 -> {"ok":true,"text":"Led $18M Vendor selection across 60+ teams"}
revert seq1 -> {"ok":true,"text":"Led $18M supplier negotiation spanning 60+ teams"}
```

## Claim 3 — CONFIRMED. Legacy rows with NO `frame` property revert; the fix is not a migration.

```
  ok  both fixtures literally lack the `frame` key      (asserted with `'frame' in row === false`)
frameOf(gen)   = original
frameOf(owner) = applied
revert seq2 -> {"ok":true,...}   revert seq1 -> {"ok":true,...}
  ok  legacy rows: both seqs ok:true (no migration required)
  ok  frame === null (the literal pg value) behaves identically to an absent key
```
Both the `undefined` (absent key) and `null` (what pg actually returns for an unbackfilled column)
cases were tested; they behave identically.

## Claim 4 — CONFIRMED. The safety floor is not loosened. 1218 tampered documents, 0 splices.

Six change-log shapes, each with its own honest document, each tampered at **every character
position** in three classes — insert (+1 char), delete (−1 char), same-length case/char swap — plus
leading space, trailing space and empty:

```
tampered documents tried: 1218
refused with NO text:     1218
SPLICED (ok:true or text on refusal): 0
  ok  no tampered document was ever spliced (1218 tried across 6 log shapes)
  ok  NOT VACUOUS: all 9 untampered reverts still succeed (9)
```

The shapes: `pipeline+owner`, `two owner edits`, `pipeline+owner LEGACY (no frame)`, `owner alone`,
`owner DELETION alone`, `pipeline alone`. The non-vacuity line matters — a function that refused
everything would also score 0 splices.

Same-length tampers **inside the owner's own replacement** are covered: the sweep mutates every
position of the honest document, and the honest document contains the replacement.

**The deletion case was probed deliberately** because it is where the positional guard goes vacuous:
`artifactOwnerEdit` explicitly permits `replacement === ''` (`appCorrections.ts:327-328`), and for
such a row `revertOne`'s check `text.slice(char_start, char_start + 0) !== ''` can never fail — the
*only* thing standing between a moved document and a splice is the `before_sha256` comparison. It
holds: all 168 tampers of that shape refused.

Reading the two versions side by side supports the empirical result. Every path through the new
`revertOne` performs at least one **whole-field** SHA-256 comparison before it splices:
* `appliedFrame` non-empty → step 1 hashes each applied row's reconstructed `before` state
  (`correction.ts:350`), and any tamper outside a replacement survives into `before`; any tamper
  inside one is caught by the positional equality at `:343`.
* `appliedFrame` empty → the target is necessarily `original`-frame, and `:366` hashes.
So the refusal is at least as strict per row as the code it replaces, and strictly stricter in the
mixed case (main checked only the target's hash; this checks every applied-frame row's own).

**I could not find any input where it splices into text that genuinely moved.**

## Claim 5 — CONFIRMED. An unknown `source` refuses, names the source, and never defaults.

```
frameOf(alien) = null
seq1 -> {"ok":false,"reason":"this change log contains a change of a kind this version cannot place (imported_from_elsewhere), so nothing was undone"}
seq2 -> {"ok":false,"reason":"... (imported_from_elsewhere), so nothing was undone"}
alien alone -> {"ok":false,"reason":"... (imported_from_elsewhere) ..."}
```
`r.text === undefined` in every case. Also swept `frame` values `undefined | null | '' | 'sideways'
| 'ORIGINAL' | 0` against an unmapped source — `frameOf` returns `null` for all six, so a malformed
declared frame does not become a default either.

> Caveat, see **F-1**: this is true of `frameOf` and of `revertOne`. It is **not** reachable through
> the HTTP route in the "declared frame rescues an unknown source" direction, because the route
> discards `frame`. The refusal direction (what this claim tests) is unaffected.

## Claim 6 — CONFIRMED. Every unwound owner row is hash-verified, not only the target.

```
target=seq1, seq2 has a bad hash -> {"ok":false,"reason":"this field was edited after the correction was applied, ..."}
  ok  a bad hash on a NON-target row still refuses
  ok  control: the honest 3-owner-row log reverts
3 owner rows, MIDDLE hash poisoned, target=newest -> {"ok":false,...}   (text undefined)
3 owner rows, OLDEST hash poisoned, target=newest -> {"ok":false,...}   (text undefined)
```
Stronger than the shipped guard, which only poisons a two-row log. A three-row log where the
**middle** row is poisoned is the case a "check the first and last" implementation would pass; it
refuses.

## Claim 7 — **REFUTED.** The refusal reason IS false in the rebuild shapes the pipeline actually produces.

This is the claim the fix's AC-8 and the guard
`H:revert-reason-never-blames-the-owner-falsely` were written for. The guard passes. The behaviour
it describes does not hold.

### Why the guard passes but the product does not

The guard builds its "rebuild" by hand (`api/test/correction.test.mjs:317-318`):

```js
const ownerFirst    = { ...ownerRow, applied_seq: 1 }
const pipelineAfter = { ...genRow,   applied_seq: 2 }
```

i.e. it *assigns* the pipeline row a `applied_seq` **above** the owner's. That is the only ordering
`revertOne`'s rebuild detector can see (`correction.ts:328-336` compares
`lastOriginal > firstApplied`). The two writers do not number rows that way:

| Writer | `applied_seq` | Source |
|---|---|---|
| `planCorrections` | `rows.length + 1` — **every pass restarts at 1** | `correction.ts:136` |
| `artifactOwnerEdit` | `max(applied_seq) + 1` — monotonic | `appCorrections.ts:355-357` |

and the unique index is `(artifact_id, merge_field, applied_seq, coalesce(run_id,'000…0'))` with
`on conflict do nothing` (`appCorrections.ts:93`), while the only caller of `applyCorrectionPass`
passes **no `runId`** (`appPackets.ts:538-543`), so `run_id` is always NULL and every build shares
one key space. Consequence: a rebuild's rows at seq ≤ the owner's seq are silently dropped, and the
owner's row keeps the highest seq — exactly the ordering the detector cannot see.

### Measured

`docs/qc-evidence/verify-frames-rebuild.mjs` models those exact semantics and drives the real
producers. `FALSE_CLAIM = /(this field|it) was edited after the correction was applied/i` is the
literal sentence AC-8 exists to eliminate.

```
$ node docs/qc-evidence/verify-frames-rebuild.mjs

────────── A. rebuild finds the same 2 figures (all new rows dropped on conflict) ──────────
  build-1 field   : "Led $18M supplier negotiation across 60+ teams"
  after build-1   : "Led 8-figure supplier negotiation across multiple teams" (2 pipeline rows, seq 1,2)
  after owner edit: "Led 8-figure Vendor selection across multiple teams" (owner seq 3)
  build-2 field   : "Led $18M supplier negotiation across 60+ regional teams"
  build-2 planned 2 rows seq [1,2]; 2 DROPPED by `on conflict do nothing` (seq [1,2])
  document now    : "Led 8-figure Vendor selection across multiple regional teams" (owner lapsed: 0)
  ledger          : [{"seq":1,"frame":"original","src":"generalized"},
                     {"seq":2,"frame":"original","src":"generalized"},
                     {"seq":3,"frame":"applied","src":"owner_edit"}]
  revert seq1 -> {"ok":false,"reason":"this field was edited after the correction was applied, so the original cannot be restored safely"}
  !! FAIL  seq1: refusal is TRUE (does not claim the owner edited the field)
  revert seq2 -> {"ok":false,"reason":"this field was edited after the correction was applied, ..."}
  !! FAIL
  revert seq3 -> {"ok":false,"reason":"this field was edited after the correction was applied, ..."}
  !! FAIL

────────── B. rebuild finds fewer figures ──────────                     3 x !! FAIL (same sentence)
────────── C. rebuild finds MORE figures                    ──────────   2 x !! FAIL (same sentence)
────────── D. rebuild plans more rows than the owner seq    ──────────   2 x !! FAIL (same sentence)
────────── E. owner at seq 1, rebuild lands a row at seq 2  ──────────
  ledger          : [{"seq":1,"frame":"applied","src":"owner_edit"},{"seq":2,"frame":"original","src":"generalized"}]
  revert seq1 -> {"ok":false,"reason":"this field was rebuilt after you edited it, so the changes are recorded in an order this version cannot safely unpick"}
  ok       seq1: refusal is TRUE
  revert seq2 -> {"ok":false,"reason":"this field was rebuilt after you edited it, ..."}
  ok       seq2: refusal is TRUE

=== REBUILD MODEL RESULT: 10 FALSE refusal reason(s) ===
```

In A–D the owner made **exactly one** edit and never touched the field again; a rebuild changed the
prose. The product tells them *"this field was edited after the correction was applied"*. That is
the false accusation AC-8 names, still shipping.

Scenario **E** shows the new reason is not dead code: when build-1 finds no figures the owner takes
seq 1, the rebuild's seq-2 row lands above it, and the true "this field was rebuilt after you edited
it" reason is returned. So the detector works — its **trigger condition is wrong**, not its message.

### Severity / suggested fix

Not a safety problem: every one of these outcomes is a refusal that writes nothing. It is a
truthfulness problem, which is the specific thing this AC was about, and it will read to the owner
as the product blaming them for a rebuild the pipeline performed.

The ordering test is a proxy (`applied_seq` ordering) for a fact that is not recorded. Two
directions that would settle it rather than infer it, in the same spirit as recording `frame`:
* compare each `original`-frame row's `before_sha256` against the others — a rebuild produces rows
  whose `before_sha256` differs from the pre-existing rows' (all rows from one pass share it,
  `correction.ts:118`), which is directly observable and needs no seq ordering; or
* record the build/run identity on the row and compare it (`run_id` already exists on the table and
  is simply never populated — `appPackets.ts:538` passes no `runId`).

### Claim 4, broadened: 95,541 randomised tampered documents, 0 splices

`docs/qc-evidence/verify-frames-fuzz.mjs` generates random fields, runs the real
`planCorrections`/`scanEcho`, layers 0–2 owner edits written exactly as `artifactOwnerEdit` writes
them (including empty-replacement deletions), strips the declared frames on half the runs to
simulate production rows, then tampers randomly. Oracle: *if the document is not byte-identical to
the one the change log describes, `revertOne` must return no text.*

```
$ node docs/qc-evidence/verify-frames-fuzz.mjs
change logs generated : 2814
honest reverts        : 7015/8052 succeeded (non-vacuity)
tampered documents    : 95541
SPLICED               : 0
```

## Claim 8 — CONFIRMED. The document is byte-identical, and the defect was real.

Pre-fix tree (`a0c98a5^`) compiled to `/tmp/preapi`, then compared function-for-function.

```
$ node docs/qc-evidence/verify-frames-differential.mjs
=== CLAIM 8a — planCorrections + applyCorrections are byte-identical to pre-fix ===
  4000 random fields compared
  ok  planCorrections emits byte-identical rows (0 differences)
  ok  applyCorrections / originalOf produce byte-identical text (0 differences)

=== CLAIM 8b — the pre-fix code REALLY failed the reported defect ===
  seq1  PRE-FIX -> {"ok":false,"reason":"this text no longer matches the change log (correction 2 is not where the record says it is)"}
  seq1  FIXED   -> {"ok":true,"text":"Led $18M Vendor selection across 60+ teams"}
  seq2  PRE-FIX -> {"ok":false,"reason":"... (correction 2 is not where the record says it is)"}
  seq2  FIXED   -> {"ok":true,"text":"Led 8-figure supplier negotiation across 60+ teams"}
  ok  seq1/seq2: the defect was real — pre-fix did NOT revert; the fix reverts both
  ok  seq1/seq2: LEGACY (no frame declared) also reverts post-fix
```
`applyCorrections`, `planCorrections`, `originalOf` and `isWellFormed` are textually unchanged by
the commit (`git show a0c98a5 -- api/src/functions/tests/correction.ts`, filtering comment lines:
the only edits to `originalOf`'s callers are inside `revertOne`).

Claims 1 and 2 are therefore not verifying a non-bug: `main`'s parent refuses both seqs.

---

## Schema migration — CONFIRMED, executed against a POPULATED pre-existing table.

Per the CLAUDE.md recipe. Local PostgreSQL 16.13, `ON_ERROR_STOP=1` throughout.

```
$ PGHOST=/tmp/pgsock2 PGPORT=55433 psql -tAc "select version()" postgres
PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu ...

# 1. apply the PRE-FIX SCHEMA_SQL (dumped from a build of a0c98a5^, not hand-copied)
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_pre_nv.sql ; echo exit=$?
exit=0

# 2. `frame` is genuinely ABSENT to begin with
$ psql -d upg -tAc "select count(*) from information_schema.columns
                     where table_name='correction' and column_name='frame'"
0

# 3. seed REAL rows through the pre-fix table — one per frame, neither able to carry a frame
$ psql -tAc "select applied_seq||' | '||source||' | '||phrase from correction order by applied_seq"
1 | generalized | $18M
2 | owner_edit | supplier negotiation

# 4. apply THE FIX'S SCHEMA_SQL on top
$ psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_new_nv.sql ; echo psql exit=$?
psql exit=0
$ (re-run for idempotency)                                      exit=0

# 5. the column ARRIVED on the EXISTING table (the `create table if not exists` is a no-op there)
frame | nullable=YES | type=text

# 6. both seeded rows survived, unbackfilled
1 | generalized | frame=NULL | phrase=$18M
2 | owner_edit  | frame=NULL | phrase=supplier negotiation

# 7. the CHECK exists AND ENFORCES — proving it was added, not merely absent
correction_frame_check :: CHECK (((frame IS NULL) OR (frame = ANY (ARRAY['original'::text, 'applied'::text]))))
  set frame='original' -> UPDATE 1
  set frame='applied'  -> UPDATE 1
  set frame='sideways' -> ERROR: violates check constraint "correction_frame_check"
  set frame='ORIGINAL' -> ERROR: violates check constraint "correction_frame_check"
  set frame=''         -> ERROR: violates check constraint "correction_frame_check"
```

The **second** DDL home was executed too — `ensureCorrectionTable`, the copy a route runs when
`pgMigrate` has not:
```
  dropped frame; present now = 0
  after ensureCorrectionTable, present = 1
  rows still there = 2
  sideways rejected: violates check constraint "correction_frame_check"
  applied accepted; row2 frame = applied
```

## F-2. FINDING (low severity): the fix updated 2 of the `correction` table's 3 declared homes, and the parity guard cannot see the difference.

`api/test/correctionDdlParity.test.mjs` exists precisely because *"`correction` is declared THREE
times"* and they must agree. The third home, `api/test/sql/correction.sql`, carries the comment
*"Kept in lockstep with schema.ts and appCorrections.ts."*

```
$ git show a0c98a5 --stat --format="" | grep -c correction.sql
0
$ grep -c frame api/test/sql/correction.sql
0
```

The guard stays green because it compares **only the `source` domain**
(`sourceDomains()`, `correctionDdlParity.test.mjs:24-27`) — nothing compares columns. Consequence
is limited (only the parity test reads that fixture; `grep -rn "correction.sql" api/test .github`
returns one hit, the guard itself), but the guard's stated purpose — the three copies agree — is
not met for the column this commit added.

## F-3. FINDING (coverage gap, real): the applied-frame positional check is load-bearing and completely unguarded.

`correction.ts:343` — `if (text.slice(c.char_start, end) !== c.replacement) return {ok:false,…}`.

Removing it leaves the **whole 840-test suite green** while the safety floor drops measurably:

```
MUT-7  the applied-frame positional check removed  ->  0 failing test(s)
       (NONE — the mutation is invisible to the suite)

but the verifier's own sweep, same mutation:
  tampered documents tried: 1218
  SPLICED: 96
  examples:
   { "sc":"pipeline+owner", "m":"same-len@13", "seq":2,
     "tampered":"Led 8-figure vendor selection across 60+ teams",
     "text"    :"Led 8-figure supplier negotiation across 60+ teams" }
```

The class it protects against is exactly the one the brief names: a **same-length edit inside the
owner's own replacement**. `Vendor selection` → `vendor selection` disturbs no offset, so with the
positional check gone `revertOne` overwrites `[char_start, char_start+len)` regardless of what is
actually there — reconstructing a `before` that hashes correctly, so the hash cannot catch it. The
owner's manual re-wording is silently destroyed and the revert reports success.

`H:revert-writes-nothing-when-text-moved` is named *"the safety floor is not loosened"* but its
same-length case (`bothApplied.replace('across','ACROSS')`) lands **outside** any replacement, where
the hash catches it. One extra line inside that guard closes this:
```js
const insideReplacement = bothApplied.replace('Vendor selection', 'vendor selection')
```

**The shipped code is correct here — this is a guard-strength finding, not a behaviour finding.**

## Mutation proof of the 8 new guards — all 8 fire; none cries wolf.

`docs/qc-evidence/verify-frames-mutations.sh` reverts each behaviour, rebuilds, runs all 840 tests,
and restores. Verbatim:

```
### baseline
# tests 840 / # pass 840 / # fail 0

=== MUT-1  frameOf always returns 'original' (the exact pre-fix assumption) -> 5 failing test(s) ===
    NEW GUARD FIRED: H:revert-across-two-frames
    NEW GUARD FIRED: H:revert-two-owner-rows
    NEW GUARD FIRED: H:revert-legacy-rows-need-no-backfill
    NEW GUARD FIRED: H:correction-frame-declared-not-guessed
    NEW GUARD FIRED: H:revert-reason-never-blames-the-owner-falsely
=== MUT-2  profile_figure removed from CORRECTION_FRAME -> 1 ===
    NEW GUARD FIRED: H:correction-frame-map-exhaustive
=== MUT-3  only the TARGET row's hash verified during the applied-frame unwind -> 1 ===
    NEW GUARD FIRED: H:revert-verifies-every-owner-row-hash
=== MUT-4  the rebuild refusal returns the OLD, false sentence -> 1 ===
    NEW GUARD FIRED: H:revert-reason-never-blames-the-owner-falsely
=== MUT-5  an unknown frame DEFAULTS to 'original' instead of refusing -> 1 ===
    NEW GUARD FIRED: H:correction-frame-declared-not-guessed
=== MUT-6  the applied-frame per-row hash check removed entirely -> 2 ===
    NEW GUARD FIRED: H:revert-verifies-every-owner-row-hash
    NEW GUARD FIRED: H:revert-writes-nothing-when-text-moved
=== MUT-7  the applied-frame positional check removed -> 0 ===       <-- see F-3
    (NONE — the mutation is invisible to the suite)
=== MUT-9  owner survivors re-placed by stored OFFSET, not phrase search -> 1 ===
    NEW GUARD FIRED: H:revert-across-two-frames
=== COUNTER-PROOF  CORRECTION_FRAME reordered (correct, different literal) -> 0 ===
    (NONE — correctly silent)

### restoring and confirming clean
# tests 840 / # pass 840 / # fail 0
```

MUT-8 (removing the original-frame target's own hash check) needed a second form because
`if (false && …)` was rejected by `tsc`. Deleting the block outright:
```
MUT-8b built
    FIRED: the hash is RECOMPUTED — an edit that disturbs no offset is still caught   (a PRE-EXISTING guard)
# fail 1
    and the verifier's sweep under MUT-8b: SPLICED 119 / 1218
```

**Verdict on the guards: all eight fail when the behaviour they describe is reverted.** None of them
is inert. The counter-proof (a semantically identical but textually different map) leaves 840/840
green, so they are not over-fitted to the literal either.

Coverage tally by guard:

| Guard | Fired under |
|---|---|
| `H:revert-across-two-frames` | MUT-1, MUT-9 |
| `H:revert-two-owner-rows` | MUT-1 |
| `H:revert-legacy-rows-need-no-backfill` | MUT-1 |
| `H:correction-frame-declared-not-guessed` | MUT-1, MUT-5 |
| `H:correction-frame-map-exhaustive` | MUT-2 |
| `H:revert-verifies-every-owner-row-hash` | MUT-3, MUT-6 |
| `H:revert-reason-never-blames-the-owner-falsely` | MUT-1, MUT-4 |
| `H:revert-writes-nothing-when-text-moved` | MUT-6 (but NOT MUT-7 — see F-3) |

## Sweep: other readers of `correction` rows

| Reader | Assumes a frame? | Observed |
|---|---|---|
| `correctionRevert` (`appCorrections.ts:233`) | the only one that uses offsets | frame-aware via `frameOf` — but **drops the declared `frame`**, see F-1 |
| `applyCorrectionPass` `stored` select (`:160-165`) | no | feeds `reapplyOwnerEdits`, which matches by phrase and never touches offsets |
| `listCorrections` (`:183-190`) | no | projects `phrase/replacement/char_start/char_end/applied_seq/…`; `frame` not selected, so the change log cannot display it |
| `appSwaps.ts:45-50` | no | `select distinct c.replacement … where source='owner_edit'` — no offsets |
| Frontend | no | `grep -rn "char_start\|char_end" app/src/` → one hit, `PostingAnalysis.jsx:238`, which is a **posting figure**, a different table. `correctionRow`/`orderCorrections` (`assetGate.js:527-560`) render `phrase`, `replacement`, `applied_seq`, `reverted_at` only. |

Nothing else re-derives offsets, so `originalOf` has exactly one consumer (`revertOne`) and it is
consistent.

**One documentation inconsistency the fix makes visible** (`assetGate.js:516-523`):
> *"Rows in DOCUMENT order, which is what `applied_seq` means. `planCorrections` numbers rows
> ascending by `char_start` precisely 'so a change log reads in document order' …"*

That is true of pipeline rows only. `artifactOwnerEdit` numbers by `max(applied_seq)+1`
(`appCorrections.ts:355`), which is **chronological**, not positional — so a change log containing
owner edits is not in document order, and the comment now over-claims. Cosmetic; the rendering is
still deterministic.

---

# VERDICT

| # | Claim | Result | Decisive evidence |
|---|---|---|---|
| 1 | `generalized` + `owner_edit` on one field: both revert with correct text | **CONFIRMED** | `verify-frames-harness.mjs`: seq2 → `"Led 8-figure supplier negotiation across 60+ teams"`, seq1 → `"Led $18M Vendor selection across 60+ teams"`; pre-fix build refuses both |
| 2 | Two `owner_edit` rows, no pipeline row, both revert | **CONFIRMED** | harness §CLAIM 2, both `ok:true`, texts checked |
| 3 | Legacy rows with no `frame` still revert (not a migration) | **CONFIRMED** | harness §CLAIM 3, absent key **and** `null` both work |
| 4 | The safety floor is not loosened | **CONFIRMED** | 1,218 exhaustive + 95,541 randomised tampered documents, **0 splices**, non-vacuity proven. No input found that splices into moved text. |
| 5 | Unknown `source` refuses and names the source | **CONFIRMED** (with the F-1 caveat) | harness §CLAIM 5; 6 malformed `frame` values also refuse |
| 6 | Every owner row unwound is hash-verified, not just the target | **CONFIRMED** | harness §CLAIM 6, including a 3-row log with the **middle** row poisoned |
| 7 | A refusal reason is never FALSE | **REFUTED** | `verify-frames-rebuild.mjs`: 10 false refusals across 4 realistic rebuild shapes; the false sentence AC-8 exists to remove is still returned |
| 8 | The document is unchanged | **CONFIRMED** | 4,000-field differential vs `a0c98a5^`: 0 differences in rows and text |
| — | Schema migration reaches an existing populated table | **CONFIRMED** | PostgreSQL 16.13, pre-fix schema → seeded rows → fix schema, `exit=0`, column present, rows NULL, CHECK enforces; `ensureCorrectionTable` path proven separately |
| — | The 8 new guards are real | **CONFIRMED** | all 8 fail under mutation; counter-proof stays green |

## Refutations and defects, in severity order

1. **Claim 7 REFUTED — the false accusation AC-8 was written to remove is still shipping.**
   In the rebuild shapes the pipeline actually produces (A–D in `verify-frames-rebuild.mjs`), the
   owner made one edit, a rebuild changed the prose, and the product tells them *"this field was
   edited after the correction was applied."* The new true reason exists and works (scenario E) —
   its **trigger condition** is wrong. `revertOne` detects a rebuild by `lastOriginal > firstApplied`
   on `applied_seq`, but `planCorrections` restarts numbering at 1 every pass while
   `artifactOwnerEdit` takes `max+1`, and `run_id` is always NULL, so the owner's row normally holds
   the highest seq and the detector never fires. The guard passes because it hand-assigns the
   pipeline row a seq above the owner's — an ordering the writers do not produce.
   *No safety impact: every one of these outcomes is a refusal that writes nothing.*

2. **F-1 — the new `frame` column is write-only. Its only reader discards it.**
   `appCorrections.ts:255-259` builds the array `revertOne` is given and omits `frame:`. Proven at
   runtime against a live local Postgres: an `owner_edit` row storing `frame='original'` (a
   deliberate contradiction of the map) was reverted **`ok:true`** — the answer only the
   map-based reading gives.
   ```
   stored rows: [ {seq:1, source:'generalized', frame:'original'},
                  {seq:2, source:'owner_edit',  frame:'original'} ]
   pure fn, frame HONOURED -> {"ok":false,"reason":"this text no longer matches the change log ..."}
   pure fn, frame IGNORED  -> {"ok":true,"text":"Led 8-figure supplier negotiation across 60+ teams"}
   THE ROUTE returned      -> {"ok":true,"merge_field":"RelevantBullets1","text":"Led 8-figure supplier negotiation across 60+ teams"}
   ```
   No behaviour differs today because the map and the declarations agree. But the commit's stated
   reason for adding the column — *"a source-to-frame map alone infers a fact from a proxy on every
   read, forever"* — is not yet achieved: every read is still that inference. Fix: `frame: r.frame,`
   in that projection.

3. **F-3 — the applied-frame positional check (`correction.ts:343`) is load-bearing and unguarded.**
   Deleting it leaves 840/840 green while 96/1218 tampered documents get spliced, including
   same-length edits *inside the owner's own replacement*. Shipped code is correct; the guard named
   "the safety floor is not loosened" does not cover half the floor.

4. **F-2 — `api/test/sql/correction.sql`, the third declared home of the table, was not updated.**
   `H:correction-ddl-parity` compares only the `source` domain, so it cannot see a missing column.
   Low impact (nothing but the guard reads that fixture).

5. **Cosmetic** — `assetGate.js:516-523` still describes `applied_seq` as document order; with owner
   rows it is chronological.

## What I could not falsify

I attacked claim 4 with 96,759 tampered documents across 6 hand-built and 2,814 randomly generated
change-log shapes, in both declared-frame and legacy form, including empty-replacement deletions
(where the positional check goes vacuous and only the hash stands). **Zero splices.** Reading the
two versions side by side agrees: every path through the new `revertOne` performs at least one
whole-field SHA-256 comparison before it writes, and in the mixed case it performs strictly more of
them than the code it replaces. I did not find any input where it splices into text that genuinely
moved.

## Reproduce

```bash
cd api && npm run build && npm test            # 840/840
node docs/qc-evidence/verify-frames-harness.mjs        # claims 1-8   (exits 1: claim 7)
node docs/qc-evidence/verify-frames-rebuild.mjs        # claim 7      (exits 1: 10 false reasons)
node docs/qc-evidence/verify-frames-fuzz.mjs           # claim 4 fuzz (exits 0)
node docs/qc-evidence/verify-frames-differential.mjs   # claim 8      (needs /tmp/preapi built from a0c98a5^)
bash docs/qc-evidence/verify-frames-mutations.sh       # the 8 guards (restores the tree on exit)
```

`api/` was left byte-identical to the commit (`git diff --stat HEAD -- api/` is empty) and the suite
is 840/840 after every mutation run.

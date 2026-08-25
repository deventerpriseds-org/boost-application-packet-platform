# AC — `D:owner-edit-offsets-two-frames`

**Tier 1.** `revertOne` decides whether the owner's own document is spliced. Everything below is
written against that, not against "undo is broken".

Written cold and adversarially by an independent AC agent. Nothing here is taken from the ledger
row on trust — the ledger's claim was re-derived by execution first, and the ledger's own framing of
the defect turned out to be **narrower than the defect**.

- Branch at time of writing: `claude/render-interaction-states`, `HEAD 74279d3` (== `origin/main`,
  `git fetch origin` run first).
- Source of the claim: `docs/qc-evidence/VERIFY-30.md` finding **F5**; ledger row
  `.claude/DEFERRED.md:193`.
- Reproduction scripts, committed beside this file:
  - `docs/qc-evidence/repro-offset-frames.mjs` — the defect and the two candidate fixes
  - `docs/qc-evidence/repro-offset-frames-options.mjs` — option (b) built and attacked, plus the
    ordering dependency both options rest on

---

## 0. Verdict up front

| Question | Answer | Evidence |
|---|---|---|
| Does F5 reproduce? | **YES, exactly as reported** | §1 CASE 2 |
| Is the ledger's description complete? | **NO — it is too narrow in two ways and understates the blast radius** | §1 CASE 5, CASE 6 |
| Is `char_start`/`char_end` read by anything but the revert path? | **No — inside the `correction` domain it has exactly one consumer** | §2 |
| Is `before_sha256` read by anything but `revertOne`? | **No — exactly one consumer, which is why the two writers diverged unnoticed** | §2 |
| Is option (a) sufficient? | **No.** It fixes CASE 2 and CASE 5, but cannot express CASE 4, does nothing for rows already in production, and **removes the owner's ability to edit** any field that already holds a legacy row | §4, §E1 |
| Is option (b) buildable and safe? | **Yes — and it fixes existing production rows with no migration.** Attacked with 252 tampered documents: **0 wrong splices** | §4, §G, §H |
| Recommendation | **(b), narrowed and hardened — NOT (a).** This disagrees with the ledger row's own assessment, on evidence | §5 |

**The most important correction to the ledger:** the defect is *not* "a pipeline correction plus an
owner edit". It is **"any second correction on a field whose write is not original-framed"**, and
that includes **two owner edits with no pipeline correction anywhere** (§1 CASE 5). The ledger row's
title, `owner-edit-offsets-two-frames`, is right; its body ("with a generalization AND an owner
edit") describes one instance of it.

---

## 1. Reproduction — executed, not read

```bash
cd /home/user/boost-application-packet-platform/api && npm run build      # tsc, exit 0
cd /home/user/boost-application-packet-platform && node docs/qc-evidence/repro-offset-frames.mjs
```

The script drives the **real producers**. The pipeline row comes from `scanEcho` + `planCorrections`
themselves; the owner row comes from `ownerEditRow()`, a line-for-line transcription of the INSERT
in `artifactOwnerEdit` (`appCorrections.ts:334-359`) — same `locateOwnerPhrase` call, same
`first` / `first + phrase.length`, same `createHash('sha256').update(current)`. No hand-built
fixture decides any outcome.

Fixture:

```
ORIGINAL field text : "Led $18M supplier negotiation across teams"
POSTING             : "You will own a $18M portfolio and lead supplier negotiation across teams."
PROFILE             : "Led supplier negotiation programs for regional teams."
```

### CASE 1 — one owner edit, clean field: WORKS (this is why it shipped)

```
row : {"phrase":"supplier negotiation","replacement":"Vendor selection","char_start":9,"char_end":29,
       "before_sha256":"80d298180ccf5f86…","applied_seq":1,"source":"owner_edit"}
text: "Led $18M Vendor selection across teams"
revertOne(seq 1) -> {"ok":true,"text":"Led $18M supplier negotiation across teams"}
CASE 1: UNDO WORKS
```

On a clean field the "current text" the owner edit frames against **is** the original, so the two
frames coincide and nothing is visible.

### CASE 2 — pipeline generalization + owner edit on one field: **F5 REPRODUCES**

```
current text in pkg_json : "Led 8-figure Vendor selection across teams"
  seq=1 source=generalized phrase="$18M" -> "8-figure"            [4,8)   sha=80d298180ccf…
  seq=2 source=owner_edit  phrase="supplier negotiation" -> "Vendor selection" [13,33) sha=d815533f9651…

FRAME CHECK
  pipeline row sha == sha256(ORIGINAL)      : true
  owner    row sha == sha256(ORIGINAL)      : false
  owner    row sha == sha256(afterPipeline) : true

revertOne(seq 1, source=generalized) -> {"ok":false,"reason":"this text no longer matches the change log (correction 2 is not where the record says it is)"}
revertOne(seq 2, source=owner_edit)  -> {"ok":false,"reason":"this text no longer matches the change log (correction 2 is not where the record says it is)"}
```

**Both rows refuse**, verbatim as F5 reported. The pipeline correction — which was written
correctly, months earlier, by code that has no defect — becomes un-undoable because a *different*
row was added to its field. That is the poisoning claim, confirmed.

### There are TWO independent failure points, not one

This matters for the ACs: fixing one silently leaves the other.

```
=== WHICH GUARD REFUSES — originalOf, or the sha256 comparison? ===
originalOf THREW -> correction 2 is not where the record says it is

=== SECOND, INDEPENDENT FAILURE POINT: before_sha256 is in the wrong frame ===
originalOf(current, [owner row only]) -> "Led 8-figure supplier negotiation across teams"
  == afterPipeline?                  true
  sha256(it) == owner before_sha256? true
  sha256(it) == sha256(ORIGINAL)?    false
```

1. **`originalOf` throws** (`correction.ts:204-206`) — the owner row's `char_start` does not locate
   its own replacement once the pipeline row to its left has been undone.
2. **`before_sha256` is in the wrong frame** (`correction.ts:235`) — the owner row hashes
   `afterPipeline`, and `revertOne` compares it to `sha256(recovered ORIGINAL)`. Proven separately
   by handing `originalOf` only the owner row, so failure point 1 cannot fire: the recovered text is
   `afterPipeline` byte-for-byte, its hash matches the owner row and does **not** match the original.

So a fix that only repairs offsets, leaving `before_sha256` as `sha256(current)`, produces a revert
that walks the text correctly and then refuses on the hash — with the *wrong reason* ("this field was
edited after the correction was applied"), which accuses the owner of an edit they did not make.

### CASE 5 — **NOT IN THE LEDGER**: two owner edits, no pipeline correction at all

```
after edit 1: "Led $18M Vendor selection across teams"
after edit 2: "Led $18M Vendor selection company-wide"
  seq=1 [9,29)  sha=80d298180ccf…      edit1 sha == sha256(ORIGINAL)? true
  seq=2 [26,38) sha=da2bfb3cbff7…      edit2 sha == sha256(ORIGINAL)? false
revertOne(seq 1) -> {"ok":false,"reason":"… (correction 2 is not where the record says it is)"}
revertOne(seq 2) -> {"ok":false,"reason":"… (correction 2 is not where the record says it is)"}
```

**No generalization is involved.** The owner made two edits to one field and lost the ability to undo
either. `artifactOwnerEdit` frames every edit against whatever `pkg_json` currently holds, so edit 2
is framed against post-edit-1 text — a *third* frame. The ledger row's stated trigger ("a
generalization AND an owner edit") is therefore a sufficient condition, not a necessary one, and any
AC written only against that trigger would leave this live.

### CASE 4 — **NOT IN THE LEDGER**: the owner edits the pipeline's own replacement

```
owner edits the generalized words themselves: "8-figure" -> "large"
row : {"phrase":"8-figure","replacement":"large","char_start":4,"char_end":12,"source":"owner_edit"}
text: "Led large supplier negotiation across teams"
revertOne(seq 1) -> {"ok":false, …}
revertOne(seq 2) -> {"ok":false, …}
OPTION (a) on this edit: locate "8-figure" in the ORIGINAL -> {"at":null,"reason":"this field was rewritten and no longer contains the words you changed"}
```

This is the case that **decides between the two options**, and neither the ledger nor F5 names it.
The owner is editing text that exists only *because* of a correction. The phrase `"8-figure"` has no
position in the original at all, so option (a) — "recompute against the original" — has nothing to
compute. See §4.

### CASE 6 — **NOT IN THE LEDGER**: a rebuild moves the text and never updates the row

```
rebuilt field           : "Directed $18M supplier negotiation for the region"
after pipeline pass     : "Directed 8-figure supplier negotiation for the region"
stored owner row        : [9,29) sha=80d298180ccf…
phrase now sits at      : {"at":18}
document after reapply  : "Directed 8-figure Vendor selection for the region"
stored offsets still true? false
revertOne(seq 1) -> {"ok":false,"reason":"… (correction 1 is not where the record says it is)"}
```

`reapplyOwnerEdits` (`correction.ts:164`) re-places the owner's phrase **by phrase**, deliberately
and correctly (DECISION A) — but nothing writes the new `char_start`/`char_end`/`before_sha256` back
to the row. So after any rebuild the owner row's offsets describe a document that no longer exists,
and undo refuses **even with a single owner edit on the field**. CASE 1's "it works" holds only until
the next build.

This is a **third frame problem on the same row**, it is not fixed by either candidate option, and it
needs an owner decision (§6, Q2).

*Observation vs interpretation:* the outputs above are observed. The claim that CASE 6 affects
production rows is an **inference** — it depends on how often a packet is rebuilt after an owner
edit, which I cannot measure from the sandbox (no live DB connector is authenticated in this
session; see §7).

### CASE 7 — **NOT IN THE LEDGER, proven against real PostgreSQL**: a rebuild's correction is silently dropped

`applyCorrectionPass` is called from `appPackets.ts:538` with **no `runId`** (the only call site;
`grep -rn "applyCorrectionPass" api/src`). `planCorrections` restarts `applied_seq` at 1 for every
field on every pass (`correction.ts:80`). The artifact row is created once per packet+type
(`appPackets.ts:82`) and reused, so a rebuild writes against the **same `artifact_id`**.

Executed against the **production DDL extracted from the built module**, not a hand-copy:

```bash
node -e "…extract ensureCorrectionTable's 3 statements from api/dist/…/appCorrections.js…" > /tmp/ensure.sql
psql -v ON_ERROR_STOP=1 -q -d frames -f /tmp/ensure.sql     # PRODUCTION DDL APPLIED: exit 0
```
```
=== two passes on the SAME artifact+field both number their first row applied_seq=1, run_id NULL ===
INSERT 0 1        <- pass 1
INSERT 0 0        <- pass 2 (a rebuild), SILENTLY DROPPED by `on conflict do nothing`
 applied_seq | phrase | char_start | reason
-------------+--------+------------+--------
           1 | $18M   |          4 | pass 1
```

PostgreSQL 16.13, local, `create unique index correction_unique_seq … coalesce(run_id, '000…0')`.

The rebuild's correction **was applied to `pkg` and is in the document** (`appCorrections.ts:124`)
and has **no row in the change log**. The row that survives describes text that no longer exists.

This is a **separate defect** on the same table. It is not fixed by either candidate option, it makes
CASE 6 worse, and it is the reason option (b) cannot lean on `applied_seq` as an ordering. It needs
its own ledger row — §6 Q3.

---

## 2. Feasibility table — challenged

One row per dependency this work names. Every proof is a command that was run in this session.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `correction.char_start` / `char_end` | `planCorrections` (`correction.ts:77-78`, ORIGINAL frame) and `artifactOwnerEdit` (`appCorrections.ts:358`, AS-APPLIED frame) | **Three readers, all in `correction.ts`, all on the apply/revert path**: `isWellFormed:92-94`, `applyCorrections:106-111`, `originalOf:202-207`. Plus two DB CHECK constraints. | `grep -rn "char_start\|char_end" api/src --include=*.ts` | **EXISTS** |
| …anything OUTSIDE the revert path reading them? | — | **NOTHING.** `listCorrections` (`:176`) SELECTs them onto the wire and `appChecks.ts:305` publishes them on `checks-result`, but **no frontend code reads them.** `app/src` has two mentions and both are prose comments (`assetGate.js:403,519`); `PostingAnalysis.jsx:237` reads a **different table's** offsets (`requirement`, into the posting). | `grep -rn "char_start" app/src/` → 3 hits, 2 comments + 1 unrelated table | **EXISTS-BUT-CONSTRAINED** — shipped on the wire, unread. Changing their meaning is invisible to today's UI but is a wire-contract change for any future reader. |
| `correction.before_sha256` | `planCorrections:62` (`sha256(ORIGINAL)`) and `artifactOwnerEdit:359` (`sha256(current)`) | **ONE consumer: `revertOne` (`correction.ts:235`)**, and nothing else. `isWellFormed:95` checks only its *shape*. `listCorrections` does **not** select it, so the UI never sees it. `reapplyOwnerEdits` never reads it. | `grep -rn "before_sha256" api/src app/src api/test` — every other hit is DDL, a comment, or a test fixture | **EXISTS** — single-consumer, which is why the two writers could diverge unnoticed. |
| Anything other than `revertOne` depending on the FRAME | — | **No.** `reapplyOwnerEdits` deliberately uses the phrase and ignores offsets (`correction.ts:125-129` doc + verified: it reads `phrase`/`replacement`/`applied_seq` only). `applyCorrections` is only ever called on one pass's own freshly-planned rows. | `sed -n '164,182p' correction.ts` → no `char_start`/`before_sha256` | **EXISTS-BUT-CONSTRAINED** — the frame has exactly one dependent, and it is the tier-1 one. |
| `applied_seq` as a total application order | `planCorrections:80` (restarts at **1** every pass) and `artifactOwnerEdit:345-347` (`max+1` over the whole field, all passes) | `revertOne:227` (`find` by seq), `originalOf:202` (sort), `reapplyOwnerEdits:173` (sort), `orderCorrections` (`assetGate.js:526`), `correctionAnomalies` (`:597`) | `repro-offset-frames-options.mjs` §A: `pass 1 seqs [1]`, `pass 2 seqs [1]` → **restarts: true**. And within a pass, application order is **descending** seq (`applyCorrections` sorts right-to-left) while owner edits apply **ascending**. | **ABSENT** — there is no total order. This is a hard constraint on option (b) and is the single most load-bearing row in this table. |
| A monotonic per-field ordering column to replace it | — | — | `create_at` exists but each pass's inserts are separate statements in ascending-seq order while application order is descending-seq → `created_at` does not encode application order either. `run_id` is **always NULL** (`appPackets.ts:538` passes none; the only call site). | **ABSENT** |
| A local PostgreSQL to execute DDL/constraint claims against | container | — | `psql -tAc "select version()"` → `PostgreSQL 16.13 (Ubuntu …)` | **EXISTS** |
| Live production Postgres, to count how many fields already hold a mixed-frame log | — | — | Session reminder: `Boost_DB_Connector` **requires authentication**; a CCR session cannot run the OAuth flow. | **ABSENT in this session** — see §7. The blast-radius *count* is therefore `not_verified`, never assumed. |
| `source` as a proxy for the frame | `planCorrections` emits `'generalized'` only; `artifactOwnerEdit` emits `'owner_edit'` only | the proposed `revertOne` | `repro-offset-frames-options.mjs` §F: emitted by `correction.ts` = `["generalized"]`; the domain also permits `profile_figure`, **produced by NOTHING** | **EXISTS-BUT-CONSTRAINED** — exact today, but it is an *inference*, and the domain already contains an unused third value that has no defined frame. |

---

## 3. The ONE core system, and extend vs new

**Core system: `correction.ts` — the single pure module that owns "what a stored offset means".**
Everything about this defect funnels through it. It is already the one place; nothing parallel exists.

- **Upstream producers (2):** `planCorrections` (`correction.ts:61`) via `applyCorrectionPass`
  (`appCorrections.ts:122`), and `artifactOwnerEdit` (`appCorrections.ts:305`). These are the two
  writers that disagree. There is no third writer — `grep -rn "insert into correction" api/src`
  returns exactly those two INSERTs.
- **Downstream consumers (in frame-dependence order):** `revertOne` → `originalOf` /
  `applyCorrections` (the only frame-dependent readers); `correctionRevert`
  (`appCorrections.ts:223`) which supplies the sibling set; `listCorrections` → `appChecks.ts:305`
  → `assetGate.correctionsState` → `qcRail` (frame-independent — they read phrase, replacement,
  reason, source, applied_seq, and never the offsets).
- **EXTEND, not new.** Every candidate below changes existing functions in the existing module. No
  new table, no new endpoint, no parallel store. The `correction` table already carries everything
  needed; the only question is whether one more *fact* (the frame) is recorded on it — §6 Q4.

---

## 4. The two candidate fixes, evaluated against the code

Both were **built and executed**, not judged by reading.
`node docs/qc-evidence/repro-offset-frames-options.mjs`

### Option (a) — `artifactOwnerEdit` recomputes offsets against the ORIGINAL text

Recover the original in memory (`originalOf(current, priorRows)`), locate the phrase **there**, store
original-relative offsets and `sha256(original)`. One frame survives; `revertOne` is untouched.

| | Result |
|---|---|
| CASE 2 (pipeline + owner) | **FIXED.** `revertOne(seq 1) ok:true`, `revertOne(seq 2) ok:true`, and the document produced is byte-identical to today's (`identical to today's write path? true`) |
| CASE 5 (two owner edits) | **FIXED.** both rows now hash to `sha256(ORIGINAL)`, both revert |
| CASE 4 (owner edits `"8-figure"`) | **CANNOT EXPRESS IT.** `locate "8-figure" in the ORIGINAL -> {"at":null}`. The write route must refuse, and the only refusal reason available is *"this field was rewritten and no longer contains the words you changed"* — **which is false**: the owner is looking at those words on screen. |
| Refusal preserved? | **YES, exactly.** §A4: length-changing tamper → refused; **same-length** tamper that disturbs no offset → refused (the hash catches it). `revertOne` is not modified, so its proven behaviour is preserved by construction. |
| **Existing production rows** | **NOT FIXED, AND THE WRITE ROUTE REGRESSES.** §E1: on a field that already holds a legacy corrected-frame owner row, a *new* owner edit is now **refused** — `{"refused":"this field cannot be rewritten right now (correction 2 is not where the record says it is)"}` — because recovering the original replays the legacy row and throws. Today that owner can still edit; only undo fails. **(a) as stated takes away a working capability on exactly the data that has the bug.** |
| Migration for existing rows | **Requires option (b)'s algorithm anyway.** §E3: recovering the original past a legacy owner row needs that row undone **in its own frame** first — the phrase is absent from the recovered text (`{"at":null}`) because it was replaced by the replacement. So a correct (a)-backfill *contains* (b)'s frame-aware unwind. |
| Cost with several corrections of both kinds | Every owner edit becomes O(n) in the field's history **and inherits every prior row's fragility**: one stale row anywhere in the field makes all future edits to that field impossible. |

### Option (b) — `revertOne` learns that owner rows are corrected-frame

Unwind owner rows **descending** `applied_seq` (each restores the state that existed before it),
then pipeline rows **ascending** (their original frame); verify each owner row's own
`before_sha256` against the state it recorded; then re-apply the survivors.

| | Result |
|---|---|
| CASE 2 | **FIXED** — B1: both `ok:true` |
| CASE 5 | **FIXED** — B2: both `ok:true` |
| CASE 4 | **HANDLED, and correctly.** B3: undoing the owner edit returns `"Led 8-figure supplier negotiation across teams"` (`ok:true`); undoing the *underlying* generalization **refuses** with a true reason — `"undoing this would lose your edit: this field was rewritten and no longer contains the words you changed"`. This is the only candidate that lets the owner edit corrected text at all. |
| Refusal preserved? | **PROVEN BY ATTACK, §G and §H.** All 7 hand-built tampers (length-changing left/right, **same-length** left/right, same-length *inside* the owner replacement, whole-field rewrite) → **refused**; the untampered control → succeeds. Brute force, §H: 42 positions × 3 mutation classes × 2 seqs = **252 attempts, option (b) spliced 0 times.** The per-row hash check makes (b) *stricter* than today per row, not looser. |
| **Existing production rows** | **FIXED WITH NO MIGRATION.** §E2: the legacy row reverts `ok:true` on both seqs. Those rows genuinely *are* in the as-applied frame; (b) is the reader that finally interprets them correctly. **This is (b)'s decisive advantage and the ledger row does not mention it.** |
| Cost with several corrections of both kinds | The unwind is exact. The **re-application** of surviving owner rows cannot use their offsets once a row before them is removed, so it falls back to `reapplyOwnerEdits` — exact, case-sensitive, **exactly-once-or-lapse**, never fuzzy. That is a real weakening: at the moment of splicing, a surviving owner row is placed by **search** rather than by recorded offset. It refuses on ambiguity, so it is not a fuzzy match — but it is not the offset guarantee either. |
| Blocker | **The ordering assumption.** §B4: an owner edit made *before* a rebuild leaves a pipeline row applied *after* it, breaking "all pipeline, then all owner" — and `applied_seq` collides (`seq collision? true`). (b) refuses there. So does today's code, and so does (a). |

### Where the ledger row is wrong

> *"(a) keeps one frame and is the smaller change."*

**Half right, and the wrong half is the one that decides.** (a) is the smaller *diff*. It is not the
smaller *change*, because:

1. it does nothing for rows already in production, while (b) fixes them with no migration (E2);
2. its migration needs (b)'s unwind regardless (E3), so choosing (a) does not avoid building (b);
3. between shipping and backfilling, it **removes** the owner's ability to edit affected fields (E1) —
   turning a broken undo into a broken undo *and* a broken edit.

That is an evidence-based disagreement with the ledger, not a preference.

---

## 5. Recommendation

**Option (b), narrowed and hardened — not (a).** Specifically:

1. **`revertOne` unwinds by declared frame** (B's algorithm), with **every owner row's own
   `before_sha256` verified against the state it recorded**. This is strictly more verification than
   today, not less, and §H measured it: 252 tampered documents, 0 splices.
2. **The frame is DECLARED, not inferred from `source`.** An exhaustive `SOURCE_FRAME` map with a
   guard that fails when a `CorrectionSource` value has no entry, and an **unmapped source refuses
   the revert** rather than defaulting. §F is the reason: `profile_figure` is already in the domain
   and produced by nothing, so it has no frame anybody has decided. Defaulting it to either frame is
   a guess on the splice path. *(Whether this becomes a `frame` column instead of a map is Q4 — the
   map needs no schema change and no migration, so it is the recommendation unless the owner wants
   the fact recorded per row.)*
3. **`artifactOwnerEdit` is left alone.** It keeps writing the as-applied frame, which is its natural
   and honest frame — it is the only frame in which the owner's phrase actually exists (CASE 4).
4. **Explicitly out of scope, each referred to its own ledger row:** CASE 6 (rebuild does not write
   the row back), CASE 7 (rebuild correction silently dropped), B4 (no total order), and the
   `correctionAnomalies` cross-field false positive (§D: two different fields each with one
   correction report *"two or more changes share position 1"* — `assetGate.js:597-608` never reads
   `merge_field`).

**Why not a third option.** A `frame` column (option c) is (b) plus a schema change plus a
metadata-only backfill. It is strictly better on the one axis that matters least here — future
sources — and that axis is already covered by the guard in point 2 at zero migration risk. If the
owner prefers the fact recorded rather than mapped, it is a small delta on top of (b), not a
different design. **It is not a reason to prefer (a).**

**One thing this recommendation does NOT do:** it does not make an owner edit undoable after a
rebuild (CASE 6). That is a real, currently-broken behaviour affecting even the single-edit case, and
it needs an owner decision before it can be scoped (Q2).

---

## 6. Acceptance criteria

Written against the recommendation in §5. Every one is binary and observable. Where an AC would
change under option (a), it says so.

`AC-1` … `AC-9` are the fix. `AC-10` … `AC-14` are the guards that must not regress. `AC-15` … `AC-18`
are the boundaries — what this work must be observed **not** to do.

### The fix

**AC-1 — the reported defect.**
Given a field with one `generalized` correction (`applied_seq 1`) and one `owner_edit`
(`applied_seq 2`) whose stored offsets are in the as-applied frame, when `revertOne` is called for
`applied_seq 2`, then it returns `ok:true` and text equal to the field with only the generalization
applied (`"Led 8-figure supplier negotiation across teams"` for the §1 fixture).

**AC-2 — the poisoning half.**
Given the same field, when `revertOne` is called for `applied_seq 1` (the pipeline row, which has no
defect of its own), then it returns `ok:true` and text equal to the field with only the owner edit
applied (`"Led $18M Vendor selection across teams"`).

**AC-3 — the case the ledger omits.**
Given a field with **two `owner_edit` rows and no pipeline correction at all**, when `revertOne` is
called for either `applied_seq`, then it returns `ok:true` and the text with only the *other* edit
applied.

**AC-4 — existing production rows, no migration.**
Given an `owner_edit` row written by today's shipped code (offsets and `before_sha256` in the
as-applied frame) sitting beside a pipeline row, when `revertOne` is called **without any data having
been altered, backfilled or recomputed**, then it returns `ok:true` for both rows.

**AC-5 — the frame is declared, not guessed.**
Given a `correction` row whose `source` has no entry in the source→frame map, when `revertOne` is
called for any row in that field, then it returns `ok:false` with a reason naming the unknown source,
and **writes nothing**. (Today `profile_figure` is in the DB domain and produced by nothing — §F.)

**AC-6 — every source has a decided frame.**
Given the `CorrectionSource` union in `correction.ts:32`, when the guard runs, then every member has
an explicit entry in the source→frame map, and adding a member without an entry fails the suite.

**AC-7 — each owner row's own hash is verified.**
Given a field whose owner row's `before_sha256` does not match the text state recovered immediately
before that row, when `revertOne` is called, then it returns `ok:false` and writes nothing — even
when every offset still addresses its own phrase.

**AC-8 — a refusal reason must be true.**
Given a revert refused because the change log holds an ordering the code cannot replay (§B4), when
the refusal is returned, then its reason does **not** assert that the owner or anyone else edited the
field after the correction was applied. *(Today's code returns exactly that false statement in §B4:
`"this field was edited after the correction was applied"` when what happened was a rebuild.)*

**AC-9 — the document is unchanged by the fix.**
Given the §1 fixture, when the owner edit is written and the corrections applied, then the resulting
`pkg_json` text is **byte-identical** to what today's code produces
(`"Led 8-figure Vendor selection across teams"`). This fix changes what can be *undone*, never what
the owner reads. *(Proven possible for both options: §A1 `identical to today's write path? true`.)*

### The guards that must not regress — this is the tier-1 half

**AC-10 — a length-changing edit to the field still refuses.**
Given a field edited outside the correction path so its length changed, when `revertOne` is called
for any row, then it returns `ok:false` and writes neither `pkg_json` nor `reverted_by`/`reverted_at`.

**AC-11 — a SAME-LENGTH edit still refuses.**
Given a field edited outside the correction path in a way that **disturbs no offset** (same length,
including a substitution inside an owner row's own replacement), when `revertOne` is called, then it
returns `ok:false`. *(This is the property `before_sha256` exists for; an offset walk alone cannot
catch it.)*

**AC-12 — no new splice, measured not argued.**
Given the §1 mixed-frame fixture, when every single-character mutation of the current text is
attempted (substitute / lengthen / delete at every position, for every `applied_seq`), then the
number of reverts that return `ok:true` is **exactly 0**, and the untampered control returns
`ok:true`. *(Measured on the candidate: 252 attempts, 0 splices — §H.)*

**AC-13 — a refusal writes nothing.**
Given any refusal from `revertOne`, when the route returns, then `packet.pkg_json` is unchanged and
the `correction` row's `reverted_by`/`reverted_at` are still NULL, and the HTTP status is **200**
with `ok:false` (not a 4xx). *(Existing contract — `correction.test.mjs:159`.)*

**AC-14 — the owner can still edit.**
Given a field that already holds a legacy as-applied owner row, when the owner submits a new
`owner-edit` for that field, then the route returns `ok:true` and the edit is stored.
*(This is the AC option (a) fails — §E1 returns `{"refused":…}`.)*

### The boundaries — observed, not assumed

**AC-15 — the change log renders identically.**
Given a payload of correction rows, when `correctionsState` / `orderCorrections` / `correctionRow`
run, then their output is unchanged by this work. *(No frontend code reads `char_start`, `char_end`
or `before_sha256` — §2. If the fix changes rendering, something read a field the sweep says nothing
reads.)*

**AC-16 — nothing reaches the gate or the score.**
Given identical inputs differing only by this fix, when `runChecks` and `artifactScore` run, then
every check result and all three score components are unchanged. *(VERIFY-30 measured that an owner
edit does not reach `artifact_score` today — `mh:0, kw:null, sen:null, composite:null` before and
after. That must stay true; it is a gate path.)*

**AC-17 — no schema change, or three-way parity.**
Given the recommendation (a source→frame map, no column), when the DDL parity guard runs, then
`schema.ts`, `ensureCorrectionTable` and `api/test/sql/correction.sql` are unchanged and still agree.
*(If Q4 is answered "record a `frame` column", this AC inverts: all three copies change in ONE commit
and `H:correction-ddl-parity` must be re-run — the D:owner-edit-source-half-widened precedent.)*

**AC-18 — the four out-of-scope defects are RECORDED, not silently carried.**
Given this work lands, when `.claude/DEFERRED.md` is read, then each of CASE 6, CASE 7, B4 and the
`correctionAnomalies` cross-field false positive has its own row with its own evidence, and the
`D:owner-edit-offsets-two-frames` row states plainly that undo-after-rebuild is **still broken**.
A fix that repairs the mixed-frame case while leaving CASE 6 live is a **partial fix and must say so
in the owner's own change log copy**, not only in a ledger.

---

## 7. Mutation proof per guard — the exact mutation, stated

Tier 1: no guard ships unproven. **Three of the six are already proven**, because today's shipped
code *is* the mutation and the reproduction already ran it.

| Guard (proposed H-case) | Covers | The exact mutation | Expected failure | Status |
|---|---|---|---|---|
| `H:revert-spans-both-frames` | AC-1, AC-2 | In `revertOne`, replace the frame-aware unwind with `originalOf(current, applied)` — i.e. restore `correction.ts:231` exactly as it is on `main` today. | Both assertions fail with `ok:false, "…correction 2 is not where the record says it is"` | **ALREADY PROVEN** — `repro-offset-frames.mjs` CASE 2 is that mutation, executed. |
| `H:owner-rows-are-not-the-only-second-frame` | AC-3 | Same mutation as above, on a fixture with **two owner rows and no pipeline row**. | Both `applied_seq` reverts fail | **ALREADY PROVEN** — CASE 5, executed. |
| `H:legacy-owner-row-still-reverts` | AC-4 | Build the row with `char_start = indexOf(phrase in current)` and `before_sha256 = sha256(current)` — today's `artifactOwnerEdit:358-359` verbatim — and assert the revert still succeeds **with no backfill**. Mutation: make the guard construct an *original-framed* row instead. | The guard would pass on a row production never writes → it must be written so that swapping in the original frame makes it **not_applicable/fail**, never a silent pass | **NOT YET PROVEN** — must be mutation-proven at implementation. This is the `H:no-vacuous-gate` risk: a guard that only ever sees hand-built rows the system does not produce. VERIFY-30 F4 found exactly that failure in this same feature. |
| `H:unknown-correction-source-refuses` | AC-5, AC-6 | Delete one member's entry from the source→frame map and assert the suite fails; then set the map's fallback to `'original'` instead of refusing and assert the *refusal* test fails. | Both mutations must fail the suite. If the second does not, the map has a silent default and AC-5 is decorative. | **NOT YET PROVEN** |
| `H:same-length-tamper-still-refuses` | AC-11, AC-12 | Delete the `sha256(original) !== target.before_sha256` comparison (`correction.ts:235`) and the per-owner-row hash check. | The same-length tamper cases in §G must flip from `refused` to `SPLICED`; the §H brute force must report a non-zero splice count. | **PARTIALLY PROVEN** — §G/§H show the candidate refuses all 252; the *mutation* (deleting the hash checks) has not been run. Must be run at implementation, and the brute-force count is the assertion. |
| `H:owner-edit-not-blocked-by-a-legacy-row` | AC-14 | Change `artifactOwnerEdit` to recompute against the original — i.e. **implement option (a)** — and assert the guard fails. | `{"refused":"this field cannot be rewritten right now …"}` | **ALREADY PROVEN** — §E1 is that mutation, executed. It is worth keeping as a guard precisely because option (a) is the intuitive fix and someone will propose it again. |

**A mutation that is behaviourally equivalent must be reported as such and not claimed as proof.**
Note one already in view: mutating `applyCorrections`' sort from descending to ascending `char_start`
is **not** behaviourally equivalent (it breaks multi-correction fields), but mutating it on a
**single-correction** fixture is — which is how this whole class shipped. Every guard here must use a
fixture with **at least two rows in at least two frames**, or it cannot fail.

---

## 8. Already-stored rows — what happens to each option

The `correction` table is never deleted from (`appCorrections.ts:289`, and it is the stated reason the
owner chose it over `swap_decision`). Every row ever written is still there, in the frame its writer
used.

| Row class | In production today | Under option (a) | Under recommendation (b) |
|---|---|---|---|
| Pipeline rows (`generalized`), field with no owner edit | Correct, reverts fine | Unchanged | Unchanged |
| Pipeline rows, field that ALSO has an owner edit | Un-undoable (CASE 2) | **Still un-undoable** until a backfill runs | **Undoable immediately, no migration** (§E2) |
| `owner_edit` rows, clean field, no rebuild since | Undoable (CASE 1) | Unchanged | Unchanged |
| `owner_edit` rows, field with a pipeline row | Un-undoable | **Still un-undoable**; and the field can no longer be edited either (§E1) | **Undoable immediately** (§E2) |
| Two or more `owner_edit` rows on one field | Un-undoable (CASE 5) | Still un-undoable until backfilled | **Undoable immediately** |
| Any `owner_edit` row on a field rebuilt since the edit | Un-undoable (CASE 6) | **Still un-undoable** | **Still un-undoable** — not fixed by this work, see AC-18 and Q2 |
| Pipeline rows from a rebuild | **Never written at all** (CASE 7, `INSERT 0 0`) | Unchanged | Unchanged — separate defect, Q3 |

**Option (a) is a partial fix by construction: it only works for rows written after it ships**, and
its backfill needs option (b)'s unwind to be built first (§E3). **Option (b) is not partial for the
reported defect** — it repairs every already-stored row of the classes above at the moment it
deploys, because those rows are, and always were, honest records in the as-applied frame.

**Option (b) is still partial for CASE 6.** That must be said in the owner-facing copy, not buried:
an owner edit made before a rebuild remains un-undoable under every option evaluated here.

**How many production rows are affected: `not_verified`.** The live DB is not reachable from this
session (`Boost_DB_Connector` reports *requires authentication*; a CCR session cannot run the OAuth
flow). The query that would settle it, once a connector is authorised or via `db-query.yml`:

```sql
select c.merge_field,
       count(*) filter (where c.source =  'owner_edit')  as owner_rows,
       count(*) filter (where c.source <> 'owner_edit')  as pipeline_rows
  from correction c
 where c.reverted_at is null
 group by c.artifact_id, c.merge_field
having count(*) filter (where c.source = 'owner_edit') > 0
   and count(*) > 1;
```

Every field this returns has a poisoned change log **today**.

---

## 9. Questions the owner must answer — not guessed

**Q1 — CASE 4: may the owner edit text that a correction created?**
Today they can (the words are on screen). Under option (a) they cannot, and the refusal copy would be
false. Under (b) they can, and undoing the *underlying* correction then refuses with
*"undoing this would lose your edit"*. Three answers are coherent — allow it and let the underlying
undo refuse (b's behaviour); allow it and let the underlying undo **lapse** the owner edit with a
warning; forbid it at write time with honest copy (*"these words were written by a correction — undo
that instead"*). **This decides AC-5 and part of AC-8. It is a product decision, not a technical one.**

**Q2 — CASE 6: should an owner edit survive a rebuild as an UNDOABLE row, or only as text?**
DECISION A (2026-08-25) settled that the edit survives a rebuild *in the document*. It did not settle
whether it stays undoable. Making it undoable means `reapplyOwnerEdits` must write the new
`char_start`/`char_end`/`before_sha256` back to the row — a new write on the build path, which is
where DECISION A deliberately chose a read-only replay. **Not in scope until answered.**

**Q3 — CASE 7: confirm the silently-dropped rebuild correction becomes its own ledger row.**
Proven on PostgreSQL 16.13 with the production DDL: the second pass's row returns `INSERT 0 0` and the
correction is in the document with no entry in the change log. That is a change log that under-reports
what was done to the owner's text, which is accusation-adjacent. It is **not** fixed here.

**Q4 — should the frame be a recorded column, or an exhaustive map in code?**
The recommendation is a map (no schema change, no migration, guarded by AC-6). A `frame` column makes
it a per-row fact that survives a future writer, at the cost of a three-copy DDL change plus a
metadata-only backfill. Both are defensible; the map is smaller and the guard covers the same
invariant.

**Q5 — is a refused undo acceptable where today's code refuses for the wrong reason?**
`before_sha256` exists so a revert refuses rather than splicing into moved text, and nothing in the
recommendation weakens that (§G, §H: 252 attempts, 0 splices). But (b) re-places *surviving* owner
rows by phrase rather than by offset when rebuilding the text. That placement is exact,
case-sensitive and exactly-once-or-lapse — never fuzzy — and it is the rule DECISION A already blessed
for the rebuild path. **Confirm it is acceptable on the revert path too**, since the revert path is
the one that writes into the owner's document.

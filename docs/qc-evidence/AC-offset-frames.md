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
| Is option (a) sufficient? | **No — it fixes the reported case and CASE 5, but cannot express CASE 4 and does not touch CASE 6** | §3, §4 |
| Is option (b) buildable? | **Yes, but it needs an ordering fact the schema does not record** | §4 |
| Recommendation | **(a), plus an explicit refusal for the case (a) cannot express, plus a decision the owner must make on CASE 6** | §5 |

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

# Pull candidates — shipped, reversible, to be walked together

**What this file is for.** The owner, 2026-08-25:

> *"i dont want anyting hold up progress, particulalrly your questions about low risk items. ship it
> and have it tracked as a potential item to pull and we will walk that document when everything
> works to see if soemthing pushed needs to be pulled."*

So this is the opposite of `.claude/DEFERRED.md`. That file tracks what is **not built**. This one
tracks what **is built and live** but was a judgement call the owner has not yet seen in use — the
things worth a second look once the whole thing works end to end.

**How to use it.** Walk it top to bottom against the running product. For each row: keep, change, or
pull. A row leaves this file only with a decision recorded, never by being quietly dropped.

**What belongs here.** A choice that is defensible but not obviously right, that the owner would
reasonably want to overrule after seeing it, and that can be reversed without unpicking other work.
What does NOT belong: defects (those are bugs), missing work (that is `DEFERRED.md`), or anything
that cannot be undone.

---

## PC-1 — "not in this text" on a proposed keyword chip

**Shipped in:** Row 11 Phase B. **Reverses by:** deleting one conditional span in `AssetBlocks.jsx`.

A chip for a keyword the draft does not contain renders `not in this text` and dims slightly.

**The case for pulling it.** This is the closest thing in the resume step to an accusation, and it
rests on **two unvalidated model outputs at once**: `model_keyword` is a model's guess at what the
ATS keyword is, and the draft is a model's writing. Neither has been checked by a human. An
independent AC pass flagged exactly this and recommended holding it until real chips had been seen.

**The case for keeping it.** It is a statement about the TEXT, which is checkable and exact —
whole-word matching, no similarity score. It never says "reworded" (undecidable), never attributes
intent, and carries the same `proposed` qualifier as the chip. And a chip that stays silent about
absence is arguably worse: the reader assumes presence.

**What to look for when walking it:** do the absent chips cluster on fields where the keyword was
never plausible? If most chips read `not in this text`, the noise is the finding, not the fields.

---

## PC-2 — `markRuns` whole-word was made UNCONDITIONAL, not opt-in

**Shipped in:** `ceab754`. **Reverses by:** re-introducing a `wholeWord` option, default off.

The independent AC set specified this as an OPTION (`AC-B0b`: "given `wholeWord` is omitted, then
behaviour is byte-identical to today"). I made it the only behaviour and inverted an existing test
that had asserted the substring result.

**Why I diverged.** The module's own header says *"EXACT, WHOLE-PHRASE … never fuzzy"* and calls a
highlight *"an ACCUSATION"*. Marking `deliver` inside `delivery` is the same false accusation for the
posting-echo caller as for a keyword; an opt-in flag would have preserved the defect for the one
caller that already existed. Measured before changing it: `AI` matched three times in *"said the
detail was available"*.

**What to look for:** posting echoes that USED to be marked and no longer are. If a genuine echo is
being missed because it sits against a word character, the boundary rule is too strict and the
option should come back.

---

## PC-3 — the keyword detail panel omits SPEC §4.6's match grade, `≈`, and displacement text

**Shipped in:** Row 11 Phase A. **Reverses by:** adding them, once a source exists.

SPEC §4.6 asks the panel to show match quality (Exact / Reworded / Loose), an `≈` prefix for
reworded terms, and "took the place of X in Skills 1". None of the three renders.

**Why.** `matchesEntry` needs a published `term_library_entry` and the library is off by owner
decision. More fundamentally, **"reworded" is undecidable, not merely unsourced** — text that lacks
a keyword is equally consistent with a rewording and with the term never having been placed, and
nothing in the product distinguishes them.

**What to look for:** whether the panel feels thin in use. If it does, the honest fix is a real
source for displacement (`swap_decision` already stores `from_label` → `to_label`) rather than a
grade nobody can compute.

---

## PC-4 — the deep-link focus ring does not auto-clear

**Shipped in:** `focusRing.js`. **Reverses by:** a `setTimeout` in `useScrollToFocus`.

Following a finding to a field outlines it, and the outline persists until the focus changes rather
than fading after ~2s.

**Why.** An earlier note described the prototype's ring as "clears after 2200ms"; that documented a
MOCKUP, and SPEC says nothing about ring timing. This repo has twice removed vanishing toasts for the
same reason — *"a toast that disappears in 2.2s is not evidence a run happened"*. A reader who follows
a link, gets interrupted, and looks back must still see where they were sent.

**What to look for:** whether a persistent ring reads as "this field is still selected" when the
reader has moved on.

---

## PC-5 — chips are ordered by requirement `seq`, and near-duplicates are not collapsed

**Shipped in:** Row 11 Phase A. **Reverses by:** changing `proposedKeywordsForRow`'s ordering or
adding a merge step.

Keywords appear in posting order, deduped by EXACT string only. `roadmap` and `roadmap ownership`
render as two chips.

**Why.** Collapsing them is a similarity judgement, and this repo reserves those for ranking, never
for a claim shown to the reader. Posting order matches the requirement chips directly beneath.

**What to look for:** fields with many near-identical chips. If that is common, the fix is upstream
in the miner, not a merge rule in the margin.

---

## PC-6 — the compact resume cannot host an owner override (when #30 lands)

**Status:** not yet shipped — recorded here now so it is not lost when #30 does land.

The compact resume's `SkillsBullets` is rebuilt into a local variable at `appPackets.ts:691` and
never reaches `pkg_json`. Offsets into it would be fiction, so the override will target the five real
merge fields (`SkillsBullets1/2`, `RelevantBullets1/2/3`) and refuse the compact one.

**What to look for:** whether the owner expects to edit the compact resume directly. If so, the
compact skills text needs to be persisted first — a real change, not a UI tweak.

---

## PC-7 — REVERSED: the correction "frame" becomes a RECORDED COLUMN, not a map in code

**Reversed 2026-08-25 by the owner's standing principle**, stated directly: *"i dont like workarounds
rather than solutions."* My original call is kept below the line so the reversal can be judged.

A `frame` column records, on each row, which coordinate system its offsets are in. The map inferred
the same thing from `source` on every read, forever. Both work; only one removes the ambiguity.

**Why the map was the workaround.** It is a permanent inference standing in for a fact nobody wrote
down. It has to be re-derived on every read, it must stay exhaustive as writers are added, and it is
correct only for as long as `source` remains a reliable proxy for frame — which is exactly the
assumption that produced this bug in the first place. The backfill argument I used for it does not
survive contact either: a legacy row's frame has to be inferred from `source` under BOTH designs.
The column does that inference **once**, at migration, and freezes the answer; the map does it on
every read until someone deletes it.

**Cost, stated honestly:** a three-copy DDL change (schema.ts inline, the idempotent ALTER, the
duplicated DDL in appCorrections.ts) plus a metadata-only backfill that touches no document text.
That is more work than the map and it is the work that makes the ambiguity impossible rather than
managed.

**What to look for:** nothing, if it lands. This row exists to record the reversal, not to be undone.

---

### (superseded) the original call: a map in code

**Status:** decided, not yet shipped (it lands with the `D:owner-edit-offsets-two-frames` fix).
**Reverses by:** adding a `frame` column and a metadata-only backfill.

The F5 AC pass left this open as its Q4. Two writers put offsets into `correction` in two different
coordinate frames, and a reader has to know which. Either the frame is a **column on the row**, or
it is an **exhaustive map in code** keyed by `source`.

**Decided: the map.** No schema change, no migration, no three-copy DDL edit, and the AC set's own
guard (AC-6) already asserts the map is exhaustive — a new `source` value with no frame fails the
suite rather than defaulting to one. Called myself rather than asked, because it is reversible and
invisible to the owner either way.

**What to look for:** a future writer that stores offsets in a frame the map cannot express. The
moment the frame stops being a property of *who wrote the row*, it has to become a column.

---

## PC-8 — an owner edit is re-placed by PHRASE when the document is rebuilt

**Status:** decided, not yet shipped (same fix as PC-7). **Reverses by:** refusing instead.

The AC pass's Q5. When a rebuild moves the text, a surviving owner row is re-placed by finding its
phrase rather than by its stored offsets. Exact, case-sensitive, and **exactly-once-or-lapse** —
never fuzzy, never "closest match".

**Why this is not a loosening.** It is the rule DECISION A already blessed for the rebuild path;
this only extends it to the revert path. The per-row hash check stays, and it is *stricter* than
today's: the AC pass measured 252 tampered documents (42 positions x 3 mutation classes x 2 seqs)
with **0 wrong splices**. A phrase that appears twice, or zero times, lapses the row rather than
guessing — the same refusal `locateOwnerPhrase` already makes everywhere else.

**What to look for:** owner edits that lapse after a rebuild more often than feels right. If a
phrase is commonly duplicated in a field, the exactly-once rule is too strict for that surface and
the row needs an anchor beyond its own text.

---

## PC-9 — the owner MAY edit text a correction wrote, and undoing that correction then refuses

**Status:** decided, not yet shipped (same fix as PC-7/PC-8). **Reverses by:** refusing at write time.

The F5 AC pass's Q1, and the one it called "a product decision, not a technical one". Today the
owner can edit any words on screen, including words a pipeline correction put there. Three coherent
answers: allow it and let the underlying undo refuse; allow it and let the undo **lapse** the owner's
edit with a warning; or forbid the edit at write time.

**Decided: allow it, and the underlying undo refuses** with *"undoing this would lose your edit"*.
Taken rather than asked because the alternatives are both worse in a way the owner would feel
immediately - forbidding the edit REMOVES something that works today, and lapsing silently discards
the owner's own words to restore a machine's. A refusal that names the reason is the only one of the
three that never loses what a human wrote.

**What to look for:** how often that refusal actually fires in use. If it is common, the real answer
is a two-step ("undo the correction AND drop my edit?") rather than a flat refusal.

---

## PC-10 — undo-after-rebuild is NOT fixed, and the copy will say so

**Status:** decided scope boundary. **Reverses by:** making `reapplyOwnerEdits` write the row back.

The AC pass's Q2. DECISION A settled that an owner edit survives a rebuild **in the document**; it
did not settle whether it stays **undoable**. Making it undoable means `reapplyOwnerEdits` writes new
offsets and a new hash back to the row - a new write on the build path, which DECISION A
deliberately made read-only.

**Decided: out of scope for the F5 fix**, which makes that fix partial. AC-18 requires the partiality
be stated in the owner-facing copy rather than buried in a ledger, so the row will say the edit is
in the document and can no longer be undone, instead of failing with a reason about moved text.

**What to look for:** whether a rebuild is common enough in real use that losing undo matters. If it
is, this becomes the next piece of work rather than a boundary.

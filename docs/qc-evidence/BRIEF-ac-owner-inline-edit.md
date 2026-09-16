<!-- WHAT:       AC brief for owner-typed inline editing of an asset field, in the block itself,
                 with prior versions kept and revertable.
     WHY:        The owner can change their packet text today only by TELLING AN AI what to change
                 ("List Tweaks" -> `api.aiEditArtifact`). They asked to type the change themselves:
                 "update the text to be editable and saveable right there in the block by myself,
                 not only ai edits that i have to list. i should be able to click edit and update
                 while previous versions are saved in case we need to revert."
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   the feasibility table below; every row was run against origin/main at a041d8f. -->

# AC BRIEF — type your own edit in the block, with versions kept (loop 1)

Repo: `/home/user/boost-application-packet-platform`, branch `claude/session-handoff-setup-ctozd3`
(re-based onto `origin/main` `a041d8f` — the old ref was pre-squash lineage with NO common ancestor).

**Write into `docs/qc-evidence/AC-owner-inline-edit.md` AS YOU GO**, committing and pushing after
each section. This container restores; a commit that is not pushed dies with it.

    git add docs/qc-evidence/AC-owner-inline-edit.md \
      && git commit -q -m "AC owner-inline-edit: <section>" \
      && git push -q origin claude/session-handoff-setup-ctozd3

## THE OWNER ASKED FOR THIS, in these words

> *"update the text to be editable and saveable right there in the block by myself, not only ai
> edits that i have to list. i should be able to click edit and update while previous versions are
> saved in case we need to revert. I believe this is the case in other parts of the packet builder"*

Their last sentence is a claim to CHECK, not to accept. Where else in the packet builder can the
owner type directly into stored text? Sweep it and say so — if a pattern exists, MATCH it rather
than inventing a second one.

## FEASIBILITY — already run, against `origin/main` `a041d8f`. Verify each row; do not trust me.

| Dependency | Producer | Consumer today | Proof | Verdict |
|---|---|---|---|---|
| `POST /app/artifact/{id}/owner-edit` | `appCorrections.ts:337` `artifactOwnerEdit` | **NOTHING in `app/src/screens/`** | `grep -rn "ownerEdit" app/src` → only `api.js:201` + comments | **EXISTS-BUT-UNCALLED** |
| `api.ownerEdit(artifactId, body)` | `app/src/api.js:201` | no caller | same grep | **EXISTS-BUT-UNCALLED** |
| version history rows | `correction` table, `source='owner_edit'`, `frame='applied'`, `applied_seq`, `before_sha256` | `artifactCorrectionsGet` (`appCorrections.ts:247`) | route registered | **EXISTS** |
| revert one version | `correctionRevert` (`appCorrections.ts:248`) | `QcRail.jsx:590` **already wired** | grep | **EXISTS AND WIRED** |
| the field block UI | `app/src/screens/AssetBlocks.jsx` | its only `<textarea>` (line 508) is the **AI instruction box**, not the text | `grep -n textarea` → one hit | **ABSENT — this is the gap** |
| AI edit path | `api.aiEditArtifact` | `AssetBlocks.jsx:519` | grep | EXISTS (the thing the owner is working around) |

**So the back end is finished and the wire is missing.** Say that first. This is a WIRING job plus
one real design decision, not a new subsystem. If your sweep disagrees with any row, that finding
outranks the row.

## THE DESIGN DECISION THIS BRIEF EXISTS TO SETTLE

`artifactOwnerEdit` is a **phrase splice**, not a field replace. It takes `{merge_field, phrase,
replacement}`, refuses unless `phrase` occurs **exactly once** in the current text (zero = the text
moved under you; two = we cannot tell which you meant — both refuse, no fuzzy match), then writes
one `correction` row.

A "click Edit, retype the paragraph, Save" box produces a WHOLE-FIELD new value. Two ways to map it:

- **(A) whole text as the phrase** — `phrase` = the entire current text, `replacement` = the entire
  new text. Occurs exactly once trivially. No backend change at all. The correction row becomes a
  full before/after snapshot, which is *literally* the "previous versions saved" the owner asked
  for, and `correctionRevert` already restores it.
- **(B) compute a minimal diff** in the client and send the smallest changed span.

**The cost that decides it, and you must measure it rather than reason about it:**
`reapplyOwnerEdits` (`correction.ts`, called at `appCorrections.ts:169`) re-applies owner edits
after a REBUILD by locating `phrase` again. Under (A) the phrase is the whole pre-rebuild text, so
after any rebuild it will not be found and **the owner's edit lapses**. Under (B) a short phrase may
still be found and survive. Read `reapplyOwnerEdits`, find what it does when the phrase is missing,
and find out whether the owner is TOLD. Then recommend one, with the trade-off in the owner's terms
("your typed edit survives a rebuild" vs "it does not"). Do not propose (B) without saying what a
client-side diff costs when the owner rewrites a paragraph wholesale.

## THE THINGS THAT MAKE THIS MORE THAN A TEXTAREA

1. **`pkg_json` is the artifact's stored text and the gate is computed from it.** `artifactOwnerEdit`
   already calls `recheckAfterTextWrite` and returns `checksStale`. State what the block shows when
   `checksStale` is true — a gate computed against the old wording must not be shown as current.
2. **An edit must not silently lose a concurrent change.** `before_sha256` is recorded. Say what
   happens when the text changed between the block rendering and the owner pressing Save — the
   route's exactly-once rule already refuses, so the question is what the OWNER SEES.
3. **A refusal here is a 200 with `ok:false` and a reason in plain words** (the route's own
   contract), not a 4xx. `api.ownerEdit` uses `postDetailed` for exactly this. Confirm the block
   surfaces `reason` verbatim rather than inventing "save failed".
4. **"Previous versions" needs a surface.** `artifactCorrectionsGet` returns the rows and
   `QcRail.jsx:590` already reverts one. Decide: does the block grow its own history list, or does
   it point at the existing per-field Undo the assistant panel already advertises ("Undo is per
   field, in the field itself, not from here")? **Extend, don't duplicate** — two revert affordances
   for one concept is the failure that rule exists to stop.
5. **Empty is a real edit.** The route treats an empty `replacement` as a deletion but the DB's
   `correction_phrase_nonempty` guards the other side. Say what an owner clearing a field gets.

## WHAT THE ACs MUST COVER

`Given <context>, when <action>, then <observable outcome>.` Binary. At minimum: the round trip
(click Edit → change text → Save → the block shows the new text and it survives a reload); a prior
version is listed and reverting restores it; a refusal shows the route's own reason; `checksStale`
is visible; a second tab's concurrent change does not get clobbered; and the AI path ("List Tweaks")
still works unchanged.

**Guards, each mutation-provable** with `mutate.sh` (now on PATH) — use an ABSOLUTE `cd`
(`cd /home/user/boost-application-packet-platform/api && ...` or `/app && ...`), and the command
must emit raw TAP, never piped through `grep -q`. Name for each guard: the file, the exact mutation,
and which AC it proves.

## THE SMALLEST FIRST COMMIT

Say what it is, such that it is independently revertable and proves something on its own.

## BINDING RULES

- **NEVER read or edit any prompt in the Prompts table.**
- Absent evidence is `NOT_APPLICABLE`, never a pass.
- Do not propose weakening any existing guard or refusal — in particular not the exactly-once rule.
- Every verdict cites a command you ran and its output.
- **Measure across the population, not one row.**

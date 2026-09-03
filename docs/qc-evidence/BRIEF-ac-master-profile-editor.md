<!-- WHAT:       AC brief for the Settings screen that lets the owner edit their own master profile.
     WHY:        TIER 1. The 14 `owner_master_block` rows this screen writes are what `masterBaseline`
                 reads, and `masterBaseline` is the BASELINE every swap row's "original" compares
                 against. A writer that corrupts a block silently rewrites provenance on every packet
                 built afterwards -- the same blast radius the cut-over itself carried.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   docs/qc-evidence/RECORD-mastercontext-cutover.md (the cut this unblocks);
                 AC-mastercontext-to-postgres.md (the parent work, whose §5 raised this as an open
                 question the owner has since answered). -->

# AC BRIEF — the master profile editor (loop 1)

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`.
**Write into `docs/qc-evidence/AC-master-profile-editor.md` AS YOU GO**, committing and pushing after
each section:

    git add docs/qc-evidence/AC-master-profile-editor.md \
      && git commit -q -m "AC master-profile-editor: <section>" \
      && git push -q origin claude/incumbent-wins-swap

This container has restored repeatedly today. A commit that is not pushed dies with it. **Another
session may share this working tree** — `git status` before staging, stage explicit paths, never
`git add -A`. That exact mistake swept a peer's in-flight mutation into a pushed commit this morning.

## THE OWNER ASKED FOR THIS, in these words

> *"agreed it should be available for text editing in settings once moved to postgres ... it
> shouldn't be waiting to move to postgres, what's the hold up... seems simple"*

The move is done. `MASTERCONTEXT_SOURCE=postgres` shipped in `0da39b2` and is verified live
(`RECORD-mastercontext-cutover.md`: `entities` 1 → 14, all five sampled fields byte-identical).

**Take the "seems simple" seriously as a design constraint, not as pressure.** If your ACs turn a
text-editing screen into a large build, say so explicitly and justify each part. The owner has been
clear elsewhere that they do not want small requests expanded into multi-feature work.

## WHAT EXISTS TODAY — sweep this, do not trust my summary

- **The data:** `owner_master_block(owner_email, block_key, text, updated_at)`, PK
  `(owner_email, block_key)`, `block_key` constrained by CHECK to the 14 keys `MC_KIND`
  (`evidence.ts:163`) enumerates. 14 rows exist for `von.ellis@enterpriseds.io`.
- **The labels already exist:** `MC_LABEL` (`evidence.ts:181`) maps every key to a human label
  ("Work history 1", "Soft/hard skills pool", …) and its own comment says it is *"for the
  settings-screen names of those fields"* — written for a screen that was never built.
- **The reader:** `readMasterContextEntity()` / `entityFromBlocks()` in `masterContext.ts`.
- **The screen:** `app/src/screens/Settings.jsx` — ~14 sibling sections already
  (`RolesSettings`, `TemplatesSettings`, `IntakeSettings`, `AtsSources`, …). Read several and match
  the house pattern rather than inventing one.
- **The one existing owner-scoped settings WRITE route** is `appSearchPrefs.ts:88`
  (`GET/POST app/search-prefs`). Read it: it is the precedent for auth, owner resolution and shape.

**EXTEND, DON'T DUPLICATE.** State explicitly whether the write route extends an existing settings
route or needs its own, and justify a new one if you propose it.

## THE THINGS THAT MAKE THIS TIER 1 RATHER THAN A FORM

1. **`itemsToOmit` must stay unwritable.** It is the list of things the owner has BANNED. `MC_KIND`'s
   own comment calls itself *"the second lock on the same door"*, the DB CHECK is the third. If the
   editor can write it, all three are bypassed. Say how the screen enforces this and whether a fourth
   lock at the route is warranted or is belt-and-braces.
2. **An empty block and a deleted block are different facts.** The column is `not null default ''`
   deliberately: `''` means "the owner emptied this", absent means "never set". State what the editor
   does when a field is cleared, and make sure it cannot turn one into the other.
3. **A write must not be able to target another owner.** `resolveOwner` accepts an unverified
   `?owner=` for READS. `requireWrite` exists for exactly this. Verify the proposed route uses the
   VERIFIED session's owner, never the query string — the same defect the copy route deliberately
   avoids.
4. **`masterBaseline`'s output changes the moment a block is saved.** That is the intended behaviour,
   but say what the owner should SEE about the consequence: packets already built carry the old
   baseline in `insertion.before_text`. Does the screen need to say so? Is silence here a "no dead
   UI" / black-box problem of the kind the owner has objected to before?
5. **Concurrency.** Two tabs, or a save while a build is reading. `updated_at` exists. State whether
   last-write-wins is acceptable here and why, or whether something more is warranted — and do not
   propose optimistic locking without saying what it costs.

## PUBLISH THE FEASIBILITY TABLE FIRST

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|

Cover at least: `MC_LABEL`'s completeness against the 14 keys; whether `Settings.jsx` has a routing
pattern a new section drops into or whether one must be added; `appSearchPrefs.ts`'s auth shape;
whether any existing route already writes `owner_master_block` (it should not — the copy route is a
one-time seed, not a writer); and whether the app's api client (`app/src/api.js`) already passes
`?owner=` on settings calls.

**`ALREADY BUILT` is a first-class outcome.** If a screen or route for this exists and I missed it,
say so first and the work becomes a regression guard, not a feature.

## WHAT THE ACs MUST COVER

`Given <context>, when <action>, then <observable outcome>.` Binary. At minimum: the round trip
(load → edit → save → reload shows the edit); `itemsToOmit` unwritable; cleared-vs-absent;
cross-owner write refused; an unknown `block_key` refused by the route rather than only by the DB;
and what the owner sees when a save fails.

**Guards, each mutation-provable** with `/workspace/eds-claude-skills/scripts/mutate.sh` — use an
ABSOLUTE `cd` in the test command (`cd /home/user/boost-application-packet-platform/api && ...`),
and the command must emit raw TAP, never piped through `grep -q`. Name for each guard: the file it
lives in, the exact mutation, and which AC it proves.

## THE SMALLEST FIRST COMMIT

Say what it is, such that it is independently revertable and proves something on its own.

## BINDING RULES

- **NEVER read or edit any prompt in the Prompts table.**
- Absent evidence is `NOT_APPLICABLE`, never a pass.
- Do not propose weakening any existing guard or refusal.
- Every verdict cites a command you ran and its output.
- **Measure across the population, not one row.**

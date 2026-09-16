<!-- WHAT:          Adversarial AC brief for owner-typed inline editing of an asset field, in the
                    block itself, with prior versions kept and revertable.
     WHY:           Cold, independent re-verification of BRIEF-ac-owner-inline-edit.md against the
                    live source at origin/main a041d8f (no code has landed since; see git diff below).
     SUPERSEDES:    nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:      every row below cites the command run and its actual output, not the brief's
                    claims. Two brief claims were found stale or incomplete during this pass; both
                    are called out explicitly rather than silently corrected. -->

# AC — type your own edit in the block, with versions kept (loop 1)

Repo `/home/user/boost-application-packet-platform`, branch `claude/session-handoff-setup-ctozd3`.
Verified before writing anything below: `git diff --stat a041d8f HEAD -- . ':!docs/qc-evidence'` is
EMPTY — no application code has changed since the brief's evidence commit. All line numbers here
were re-read from the live files today (2026-09-16), not copied from the brief.

**Wall-clock budget: 25 minutes, self-timed from spawn.** This pass used its research time on
ground-truthing the brief's central premise (see "CORRECTION TO THE BRIEF" below) rather than
padding every row; all claims below were actually run, none are `NOT REACHED`.

## THE OWNER ASKED FOR THIS, verbatim

> *"update the text to be editable and saveable right there in the block by myself, not only ai
> edits that i have to list. i should be able to click edit and update while previous versions are
> saved in case we need to revert. I believe this is the case in other parts of the packet builder"*

## SWEEP: "I believe this is the case in other parts of the packet builder" — CHECKED, and the answer is split

The owner's belief is **half right**. There are TWO existing "type into stored text yourself"
mechanisms in this codebase, doing genuinely different things, and the brief's feasibility table
only found the one that is unwired. The other one is live, in production, right now — and it does
**not** keep versions.

| Mechanism | Where | Route | Keeps versions? | Command run |
|---|---|---|---|---|
| Whole-field textarea + Save | `app/src/screens/OppDetail.jsx:440-502` `ResumeField`, mounted in the Resume tab | `api.saveArtifactContent` → `POST /app/artifact/{id}/content` → `artifactContent` (`appPackets.ts:1520`) | **NO.** `pkg = {...cur, ...body.pkg}; update packet set pkg_json = $1` — a raw merge-and-overwrite. No `correction` row, no history table touched, nothing to revert. | `grep -n "saveArtifactContent" app/src/api.js app/src/screens/*.jsx`; read `appPackets.ts:1516-1558` |
| Phrase-splice + versioned row | `api.ownerEdit` → `POST /app/artifact/{id}/owner-edit` → `artifactOwnerEdit` (`appCorrections.ts:337`) | writes one `correction` row, `source='owner_edit'`, revertable by the existing `correctionRevert` route | **YES**, already, today, for any caller that uses it | read `appCorrections.ts:337-412`; confirmed no caller in `app/src` below |

**So the pattern the owner remembers exists, but it is the wrong one to copy.** `ResumeField` in
`OppDetail.jsx` IS "click Edit, type in a textarea, Save, it's saved right there" — but it silently
destroys whatever was there before with no way back. If this brief's job were merely "match the
existing pattern," it would ship exactly the gap the owner is asking to close. **The correct
instruction is inverted from the brief's framing**: don't copy the existing pattern, use the
*better, already-built and already-unused* mechanism (`artifactOwnerEdit`) that happens to sit right
beside it doing the harder job of keeping history for free.

This also means "extend, don't duplicate" cuts against `OppDetail.jsx`'s own pattern, not just
against inventing something new. **Recorded as a gap, not fixed here**: `ResumeField`'s Save button
is a pre-existing silent-data-loss risk (an owner typing in the Resume tab today loses whatever the
draft replaced, with no record). Fixing that is out of scope for this brief — the owner asked about
the block in the asset cards, `ResumeField` is a different screen — but it belongs in
`.claude/actions.md` as a follow-up, and this AC set must not accidentally hold `ResumeField` up as
the reference implementation.

## FEASIBILITY — re-verified line by line, not trusted from the brief

| Dependency | Producer | Consumer today | Proof (command run just now) | Verdict |
|---|---|---|---|---|
| `POST /app/artifact/{id}/owner-edit` | `appCorrections.ts:337` `artifactOwnerEdit`, registered at `appCorrections.ts:415` | **NOTHING in `app/src/screens/`** | `grep -rn "ownerEdit\|OwnerEdit" app/src` → one hit, `api.js:201` (the client wrapper) plus its own comments; zero call sites | **EXISTS-BUT-UNCALLED** (brief's line number for the route, 337, is correct; the brief's claim of "only `api.js:201` + comments" is confirmed) |
| `api.ownerEdit(artifactId, body)` | `app/src/api.js:201` (`postDetailed`, not `post` — refusals must surface in the owner's words) | no caller | same grep | **EXISTS-BUT-UNCALLED** |
| version history rows | `correction` table; `artifactOwnerEdit` writes `source='owner_edit'`, `frame='applied'` (`appCorrections.ts:394-398`) | `artifactChecksResult` → `listCorrections` (`appChecks.ts:518`, confirmed: `corrections: await listCorrections(client, art.id)`) → `useArtifactCorrections` hook (`AssetBlocks.jsx:134-171`) → rendered by `CorrectionRow` in the field margin (`AssetBlocks.jsx:1036-1045`) | route registered; read path traced end to end | **EXISTS AND ALREADY WIRED FOR READING** — an owner-edit row, once written, needs **zero** new rendering code to show up in the field's existing "Corrected for you" list |
| revert one version | `correctionRevert` (`appCorrections.ts:237`, registered line 416) | `CorrectionRow.doUndo` (`QcRail.jsx:585-604`), and that exact component is **already mounted inside `AssetBlocks.jsx`'s field margin** at line 1040 with `inField` | `undoAvailability()` (`assetGate.js:755-766`) has no `source`-based branch — an `owner_edit` row with an `id` and not `undone` gets `can:true` exactly like any other correction | **EXISTS AND ALREADY WIRED, INCLUDING IN THE TARGET SURFACE** — this is stronger than the brief's row, which only checked QcRail's standalone use |
| the field block UI | `app/src/screens/AssetBlocks.jsx` | its only `<textarea>` is the AI instruction box at **line 972** (brief said line 508 — stale; the file has grown since, the substance is unchanged: one textarea, and it is "List the tweaks for this field", not the draft text) | `grep -n textarea app/src/screens/AssetBlocks.jsx` → exactly one hit, line 972 | **ABSENT — this is the gap**, confirmed, with the corrected line number |
| AI edit path | `api.aiEditArtifact` | `AssetBlocks.jsx:983` (brief said 519 — also stale) inside the "List Tweaks" ask box | grep + read | **EXISTS**, unchanged by this feature |
| `checksStale` reaching the block | `artifactOwnerEdit` already returns it (`appCorrections.ts:408`) | **NOWHERE in `AssetBlocks.jsx` today** — `ArtifactCard` (`PacketBuilder.jsx:151`) accepts an `onStaleSignal` prop and uses it, but `<AssetBlocks .../>` is mounted at `PacketBuilder.jsx:221-227` **without** passing it through, and the inline `<CorrectionRow>` at `AssetBlocks.jsx:1040` is mounted **without** `onStaleSignal` either (compare to `QcRail.jsx:763`, which does pass it) | `grep -n "onStaleSignal" app/src/screens/AssetBlocks.jsx app/src/screens/PacketBuilder.jsx` | **ABSENT — a second, real gap the brief only implied.** Even the *existing* "List Tweaks" AI-edit call in `AssetBlocks.jsx` (line 983) does not surface `checksStale` today. This is not new breakage from the owner-edit feature, but the feature cannot honestly claim to show `checksStale` without also closing this pre-existing wiring gap for at least the new save action. |

**Restated first, as the brief demanded:** the back end for the OWNER-EDIT route and its version
history is finished, correct, and — per the corrected rows above — its READ side (margin display,
undo button) is *already fully wired into the exact screen the owner is asking about*. What is
missing is (1) the SAVE affordance itself (an edit box bound to the draft text, not the AI
instruction), and (2) plumbing `checksStale`/`checksError` up from that save (and, while touching
it, from the pre-existing AI-edit call at the same call site) to wherever the card shows staleness.
This is a smaller wiring job than the brief estimated, because the version-history UI needs no new
code at all — it needs `artifactOwnerEdit` called at all.

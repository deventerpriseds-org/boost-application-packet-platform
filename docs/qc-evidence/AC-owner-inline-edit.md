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

## THE DESIGN DECISION — (A) whole-text-as-phrase vs (B) client-side diff

Read `reapplyOwnerEdits` (`correction.ts:220-238`) and `locateOwnerPhrase` (`correction.ts:206-218`)
in full, plus `api/test/ownerEdits.test.mjs` (the H-cases that already pin this behavior) and the
consumer of a lapse, `appPackets.ts` (grepped, not guessed: `for (const l of corrections.ownerLapsed
|| [])` … `built.warnings.push(\`your edit to ${l.row.merge_field} could not be kept…\`)`).

**Under (A):** `phrase` = the whole field text at click-Edit time, `replacement` = the whole new
text. `reapplyOwnerEdits` re-locates `phrase` in the freshly-rebuilt field on every pipeline rebuild.
A REBUILD REGENERATES THE FIELD'S PROSE, so the exact string that was the *entire previous field* is
overwhelmingly unlikely to reappear verbatim — the edit lapses on **every realistic rebuild**, not
some of them. That is NOT silent: `H:owner-lapse-reaches-the-owner` (`ownerEdits.test.mjs:210-226`)
proves the lapse already reaches `built.warnings`, which `summariseBuild` surfaces as a packet note.
So (A)'s cost is real and near-certain, but it is a **told** cost, in the exact channel this repo
already built for exactly this failure mode.

**Under (B):** a short, minimal diff span survives a rebuild whenever that specific sentence is
untouched by regeneration — which is common (regeneration typically touches the sentence a check
flagged, not the whole field) — but a client-side diff of a full paragraph rewrite is a real thing to
build and get right (multi-line rewrites, whitespace-sensitive diffing, and it must still hit
`locateOwnerPhrase`'s **exactly-once** rule per hunk or the hunk lapses on its own). It does not
remove the lapse case, it only narrows when it fires, and the brief's warning is confirmed: this
adds meaningfully more surface (client diff correctness, plus the same exactly-once-or-refuse
question decided per-hunk instead of once) for a benefit that is a probability, not a guarantee.

**A second, decisive cost of (A) that the brief did not name and is worth stating as its own
finding**: `artifactOwnerEdit` refuses up front with `400 phrase is required` when `phrase` is empty
(`appCorrections.ts:351`). Under (A), `phrase` is always `current` — the field's live text. **If an
owner has already used this feature once to clear a field to empty text, the field can never be
edited again through this route**, because the very next attempt sends `phrase: ''` and is refused
before it even reaches `locateOwnerPhrase`. This is a real, findable trap that (B) does not have
(a short phrase-per-hunk approach never needs "the whole empty field" as its match target). **This
must be an explicit AC** (see AC-8 below) regardless of which option is chosen, because it is a dead
end an owner can reach with a single legitimate action (typing nothing and pressing Save).

**A benefit of (A) the brief also did not name**: it makes concurrent-edit detection come **for
free** from the exactly-once rule, with no extra plumbing. If a second tab's stored `pkg_json` value
for the field has changed at all since a tab loaded it, that tab's captured `current`-as-`phrase`
will not be found verbatim in the live text, and `locateOwnerPhrase` refuses with *"this field was
rewritten and no longer contains the words you changed"* — which is exactly the concurrent-edit
protection item 2 of the brief asks for, with **zero additional code**, because it is what
whole-text-as-phrase means as a side effect. (B)'s smaller phrases are strictly weaker here: a
concurrent edit somewhere else in the same field would not be detected at all if the owner's own
smaller hunk still matches.

**RECOMMENDATION: (A).** In the owner's terms: *"your typed edit does not survive an automatic
rebuild of this field — you'll see a note saying so and can re-type it — but it can never silently
overwrite someone else's simultaneous change, needs no new code in this pass, and the version
history you asked for already works." (B) would make some edits survive a rebuild that (A) would
lose, at the cost of building and trusting a new client-side diff step, and it would need its own,
weaker version of the concurrent-edit protection (A) gets for free.* This is a recommendation, not a
unilateral pick — it is written up above as a decision for sign-off, per this repo's own
feasibility-before-implementation rule, and (A) is cheap enough to reverse later if rebuild-lapse
turns out to bother owners in practice.

**Do not implement (B) under this brief without an explicit go-ahead** — it is a materially larger
and riskier change than the brief's framing suggested, and the exact-once refusal is not to be
weakened for either option (binding rule, unchanged).

## THE FIVE THINGS THAT MAKE THIS MORE THAN A TEXTAREA — resolved, not just posed

1. **`checksStale` visibility.** Resolved above as a real, pre-existing gap (`onStaleSignal` never
   reaches `AssetBlocks.jsx`). The new Save action, and — while the call site is already open —
   the existing "List Tweaks" `api.aiEditArtifact` call at the same component, must both report
   `checksStale`/`checksError` up through a newly threaded `onStaleSignal` prop:
   `PacketBuilder.jsx`'s `<AssetBlocks .../>` mount (line 221) already sits inside `ArtifactCard`,
   which already receives `onStaleSignal` (line 151) and already has a proven consumer
   (`markQcStale`, line 1026's sibling usage). Thread the SAME prop through, do not invent a second
   staleness channel.
2. **Concurrent edit.** Resolved above: option (A)'s exactly-once rule gives this for free. The
   AC is that the OWNER sees `locateOwnerPhrase`'s real refusal text when it fires for this reason,
   not a paraphrase.
3. **Refusal in plain words.** `api.ownerEdit` already uses `postDetailed`. The existing "List
   Tweaks" box already renders `askError` verbatim in a `px-note` (`AssetBlocks.jsx:974`) — the new
   Save control must follow the identical convention: render `res.reason` verbatim, not "save
   failed" (grep target for the guard: `H:owner-edit-refusal-rendered-verbatim`).
4. **"Previous versions" needs a surface — extend, don't duplicate.** Resolved by the feasibility
   table: the field margin's existing "Corrected for you" list (`AssetBlocks.jsx:1036-1045`,
   `CorrectionRow` `inField`) already renders every row for this `merge_field` regardless of
   `source` (`correctionsForField` filters only on `merge_field`, `assetBlocks.js:1308-1311`), and
   `undoAvailability` has no `source` branch. **Do not build a second history list on the block.**
   The only change needed is: after a successful owner-edit save, call the existing
   `useArtifactCorrections(...).refresh()` (already exposed, `AssetBlocks.jsx:169`) so the new row
   appears without a page reload — exactly what `onCorrectionsChanged` already does for the AI-edit
   path (`AssetBlocks.jsx:988`).
5. **Empty is a real edit — and a self-inflicted dead end.** CORRECTION TO THE BRIEF: there is **no**
   database constraint named `correction_phrase_nonempty` anywhere in `schema.ts` or
   `appCorrections.ts`'s `ensureCorrectionTable` (checked both; the only phrase-shaped constraint is
   `correction_span_matches_phrase`, which permits an empty phrase with `char_start=char_end`). The
   guard the brief is thinking of is **application-level only** — `if (!phrase) return 400` at
   `appCorrections.ts:351` — and it is exactly what creates the AC-8 dead end below: once a field is
   owner-edited to empty, `current` (the next `phrase`) is `''`, and every subsequent Save through
   this route 400s before reaching `locateOwnerPhrase`. **This is not proposing to weaken that
   guard** — the fix belongs in the client: an Edit box whose field is currently empty must not
   silently offer a Save that will 400; it must say why in the owner's terms and point at the one
   path that still works (`List Tweaks`/AI edit, which does not use `phrase` at all and is
   unaffected — confirmed by reading `artifactAiEdit`, `appPackets.ts:1610-1615`, which writes
   `pkg_json` directly with no phrase match of any kind).

## FEASIBILITY TABLE VERDICTS, restated in the required column

| Dependency | Producer | Consumer today | Proof | Verdict |
|---|---|---|---|---|
| `artifactOwnerEdit` route | `appCorrections.ts:337` | none in `app/` | grep, above | EXISTS-BUT-UNCALLED |
| `api.ownerEdit` | `api.js:201` | none | grep, above | EXISTS-BUT-UNCALLED |
| version history read+undo in the block's own margin | `correction` rows, `listCorrections`, `CorrectionRow` `inField` | already mounted at `AssetBlocks.jsx:1040` | traced end to end | EXISTS AND WIRED (stronger than the brief claimed) |
| `checksStale` reaching the card | route returns it | nothing forwards it past `AssetBlocks.jsx` | grep, above | ABSENT — must be added, and is shared with the pre-existing AI-edit gap |
| the Edit/Save control itself | — | — | one `<textarea>` exists and it is the AI box | ABSENT — this is the actual net-new UI |
| the "type into stored text" pattern the owner remembers | `ResumeField`/`saveArtifactContent`, `OppDetail.jsx:440` | live today | read `appPackets.ts:1516-1558` | EXISTS-BUT-CONSTRAINED — it exists, and it must NOT be the template, because it has no version history |

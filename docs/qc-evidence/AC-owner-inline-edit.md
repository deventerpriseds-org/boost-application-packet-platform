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

## ACCEPTANCE CRITERIA

Every AC traces to one of: the owner's own words, the feasibility table above, or a defect this
pass found while reading. `Given / When / Then`, binary, with what it is observed via.

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-1 | Given a non-static asset field showing draft text, when the reader clicks the field's new "Edit" control, then a textarea pre-filled with the field's CURRENT `after_text` appears in place of the rendered draft (not the AI instruction box, which stays a separate control) | happy-path | Playwright: click `data-qc=<new-hook>-edit`, assert a `<textarea>` with `value` equal to the pre-edit rendered text |
| AC-2 | Given the Edit textarea is open and the reader changes the text and clicks Save, when the save completes, then `POST /app/artifact/{id}/owner-edit` is called with `merge_field` = this field and the response's `text` is what the block now renders, surviving a reload (`GET .../checks-result` or the artifact fetch on next mount reflects it) | happy-path | network assertion (`res.ok===true`) + re-render shows new text + reload (fresh `GET`) still shows new text |
| AC-3 | Given a field was just owner-edited, when the field's margin change log next refreshes (the existing `useArtifactCorrections().refresh()` call, not a new list), then the margin's "Corrected for you" section shows one new row whose `sourceText` reads "you changed this yourself" and whose Undo control is enabled | happy-path | DOM: `data-qc=fieldChangeLog` count increments by 1; the new row's `data-qc-state="corrected"`; `CORRECTION_SOURCE.owner_edit` string present |
| AC-4 | Given an owner-edited row is visible in the margin, when the reader clicks its Undo, then `POST /app/correction/{id}/revert` is called, the field's text reverts to the pre-edit value, and the row now reads "Undone" | happy-path / regression | DOM before/after text diff + `data-qc-state="undone"` |
| AC-5 | Given the field's current stored text does NOT contain, verbatim and exactly once, the text the reader started editing from (someone/something changed it since the block rendered — e.g. a rebuild or a second tab), when Save is clicked, then the block shows the server's own refusal sentence from `locateOwnerPhrase` verbatim (either "...no longer contains the words you changed" or "...appear more than once...") and does NOT overwrite the field, and does NOT show a generic "save failed" | edge / concurrency | mock the route to return `{ok:false, reason:"this field was rewritten and no longer contains the words you changed"}`, assert that exact string renders and no optimistic text replaced the draft |
| AC-6 | Given the reader clicks Save with the textarea completely unchanged from what was loaded, when the request would be sent, then the client refuses to send it locally OR the server's own no-op refusal ("that is the same wording it already has") is shown verbatim — either way no request writes a pointless correction row for an unedited field | edge | either: Save is disabled with `phrase === replacement`, or a stubbed 200/`ok:false` shows that exact sentence |
| AC-7 | Given `res.checksStale === true` on the owner-edit response, when the save completes, then the SAME stale-gate indicator the card already shows for other writes (`markQcStale`/the card's existing stale badge) appears — reusing the existing `onStaleSignal` channel, not a new one — and it disappears only via the existing re-check path (Re-run QC), never by itself | edge / regression | thread a stub `onStaleSignal` prop into `AssetBlocks`/`AssetBlock` in a component test, assert it is invoked with `(true, err)` on a stale response and the existing stale-badge renders |
| AC-8 | Given a field's stored text is currently the empty string (because a prior owner-edit cleared it), when the reader clicks Edit, then the box does NOT silently offer a Save that will 400 — it states plainly that a cleared field can't be re-edited here yet and points at "List Tweaks", OR the client sidesteps the empty-phrase case by another means that does not touch the `phrase` validation guard | edge | set `after_text` to `''` in a fixture, open Edit, assert either the Save path is disabled with an explanatory `data-qc` note, or no `400 phrase is required` network response is ever produced by this control |
| AC-9 | Given the "List Tweaks" AI-edit control on the same field, when it is used before or after this feature ships, then it behaves identically to today — same route, same request shape, same response handling — and a `correction` row is never written for it (that remains unchanged behavior, not a regression this brief introduces) | regression | `api/test` suite for `artifactAiEdit` unchanged and green; no new `insert into correction` call added to that function |
| AC-10 | Given the owner opens the "Show original" panel and the field has been owner-edited, when they compare, then "Show original" (`originalState`, unrelated existing control) and the NEW owner-edit history are not conflated into one control — "Show original" still shows the pipeline's own pre-pipeline text, the margin's change log shows the versioned owner edits, and neither duplicates the other's job | regression / extend-not-duplicate | DOM: both controls present and independently functional; `original.kind` unaffected by an owner_edit row's presence |

## GUARDS — each mutation-provable, named for the implementer to write and prove with `mutate.sh`

None of these exist yet (no code has landed against this brief). Each is a REQUIRED new H-case, named
by slug, with the exact mutation that must be shown to fail the suite before being trusted.

| Guard (file : behavior) | Mutation to prove it | Proves |
|---|---|---|
| `H:owner-edit-block-uses-shared-route`, in the new client save handler (`AssetBlocks.jsx`) | Replace the call to `api.ownerEdit(...)` with a call to `api.saveArtifactContent(...)` (the no-history route) | AC-2, AC-3 — must fail because no `correction` row is written, so the margin never gains a new row |
| `H:owner-edit-refusal-rendered-verbatim`, in the same handler | Replace `setError(res.reason)` with a hardcoded `setError('save failed')` | AC-5, AC-6 — must fail an assertion checking the literal server sentence is on screen |
| `H:owner-edit-staleness-not-swallowed`, wherever `onStaleSignal` is threaded into `AssetBlocks`/`AssetBlock` | Delete the `if (onStaleSignal) onStaleSignal(...)` call after a successful owner-edit save | AC-7 — must fail a test asserting the stale badge appears after a stale response |
| `H:owner-edit-empty-field-not-a-silent-400`, in the Edit-open logic | Remove whatever empty-field guard is added (button-disable or message) so an empty-field Save is attempted unconditionally | AC-8 — must fail a test asserting no unhandled 400 / a clear message appears instead |
| `H:ai-edit-path-unchanged-by-owner-edit-feature`, in `artifactAiEdit` (`appPackets.ts`) or its call site | Make the new owner-edit save path ALSO invoke `artifactAiEdit` or otherwise touch its call, e.g. by having Save silently call `aiEditArtifact` as a fallback | AC-9 — must fail on an assertion counting exactly one call to `api.aiEditArtifact` per List-Tweaks click, none from Save |

Run each with an ABSOLUTE `cd`:
```
cd /home/user/boost-application-packet-platform/app && \
  /workspace/eds-claude-skills/scripts/mutate.sh <file> <anchor-file> <replacement-file> "<test-cmd>" "<must-fail-pattern>"
```
Raw TAP output only — never pipe through `grep -q`, per this repo's own binding rule on mutation
proof.

## THE SMALLEST FIRST COMMIT

**Wire `api.ownerEdit` into a bare-minimum Edit/Save control on ONE field type, with no `checksStale`
plumbing yet, and prove AC-1 through AC-4 and AC-6.** This is independently revertable (it touches
only `AssetBlocks.jsx` plus its own new small handler; it adds no schema, no new route, no change to
`artifactContent` or `artifactAiEdit`) and it proves something real on its own: that the "back end
is finished, the wire was missing" claim is true — a correction row appears and is undoable the
moment the wire exists, using the READ path this pass proved is already live. `checksStale`
threading (AC-7) and the empty-field guard (AC-8) are real but separable follow-on commits; landing
them together is fine, but the first commit should not be blocked on either.

## GOAL → AC COVERAGE

- "editable and saveable right there in the block" → AC-1, AC-2
- "previous versions are saved" → AC-3, AC-10
- "in case we need to revert" → AC-4
- (implicit) "the change isn't secretly wrong or lost" → AC-5, AC-6, AC-7, AC-8
- (implicit) "the AI path still works" → AC-9
- Every AC traces to a goal above; none is implementation-detail-only.

## BINDING RULES — compliance recorded

- **Prompts table**: not read or touched. No route or query in this pass names it.
- **Absent evidence** is stated as such throughout (e.g. `correction_phrase_nonempty` does not
  exist — stated as ABSENT, not assumed present as the brief claimed).
- **No guard weakened**: the exactly-once rule, the 200/`ok:false` refusal contract, and the
  application-level empty-phrase 400 are all left exactly as they are; AC-8's fix is client-side.
- **Every verdict above cites the command run.**
- **Population, not one row**: the "checksStale never reaches the block" finding was checked
  against BOTH the new owner-edit call site and the pre-existing AI-edit call site at the same
  component, not just the one this brief was about, because both write text into the same
  card and a reader would expect both to behave the same way.

## GAPS / OPEN QUESTIONS FOR THE OWNER

1. **`ResumeField` (`OppDetail.jsx:440`) has no version history today.** Not part of this feature's
   scope (different screen), but it is the exact gap the owner is asking to close, existing
   elsewhere in the product already. Recommend logging as a follow-up in `.claude/actions.md` rather
   than silently leaving it as the "other place this already works" the owner believed in.
2. **Design decision (A) vs (B) needs explicit sign-off** before implementation — recommended: (A),
   whole-text-as-phrase, for the reasons above (free concurrency protection, zero backend change, a
   told rather than silent rebuild-lapse cost). Do not start on (B) without it.
3. **AC-8's exact UI wording** for the empty-field dead end is left to the implementer's judgment —
   only the OBSERVABLE (no silent 400, a real explanation, a working alternative named) is
   prescribed here.

Every claim in this document was reached inside the wall-clock budget; nothing is marked NOT
REACHED.

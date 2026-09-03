# IMPL: Frontend checks wiring (Lane C)

Branch: claude/boost-app-setup-approach-6xdoef
Scope: app/src/**, app/test/** ONLY. No git commands except read-only `git show`.

## Step 0 — start
Starting investigation of GAP 1 (checksStale/checksError surfacing + ok:false doc/slides regression)
and GAP 2 (judge-outcome retention window Settings control).


## Step 1 — confirmed routes/fields (ground truth: read the source files directly)

Five routes returning `checksStale: !rc.ok, checksError: rc.error` alongside `ok: true`:
- POST /api/app/artifact/{artifactId}/generate     (appPackets.ts:326, artifactGenerate)
- POST /api/app/artifact/{artifactId}/content       (appPackets.ts:1554, artifactContent)
- POST /api/app/artifact/{artifactId}/ai-edit       (appPackets.ts:1620, artifactAiEdit)
- POST /api/app/artifact/{artifactId}/owner-edit    (appCorrections.ts:408, artifactOwnerEdit)
- POST /api/correction/{correctionId}/revert        (appCorrections.ts:309, correctionRevert)

`grep -rn "checksStale\|checksError" app/src app/test` -> ZERO matches. GAP 1 part A is REAL,
confirmed by grep, not assumption.

## Step 2 — GAP 1 part B: ok:false from /document and /slides — PRE-EXISTING CODE, quoted

api/src/functions/tests/appPackets.ts:889 (artifactDocument, templated branch):
    return { status: 200, headers: HEADERS, jsonBody: { ok: !built!.warnings?.length, artifactId,
      type: art.type, docUrl: built!.url, deckUrl: built!.isSlides ? built!.url : undefined,
      title: built!.title, cleanedTokens: built!.cleaned, templated: true, packetStatus,
      warnings: built!.warnings || [], qcApplied: built!.qcApplied } }
Same shape at appPackets.ts:965 for artifactSlides. NOTE: neither branch ever sets an `error` field
on this path — `error` only appears elsewhere (HAS_GOOGLE_OAUTH false, Slides read HTTP failure, etc).

app/src/api.js:238,242 — generateArtifactDocument / generateArtifactSlides both call the shared
`post()` helper, which only throws on a non-2xx HTTP status (`if (!res.ok) throw ...HTTP ${res.status}`).
Since these routes always return HTTP 200, `post()` NEVER throws for this case — it resolves with the
full JSON body including `ok:false`.

PRE-CHANGE CODE — the two consumers, quoted verbatim:

app/src/screens/PacketBuilder.jsx:518-530 (makeDoc):
    const res = await api.generateArtifactDocument(a.id, opts)
    if (res.error) throw new Error(res.error)
    patchArtifact(a.id, { docUrl: res.docUrl })
    ...
    toast(opts.regen ? `Google Doc rebuilt for ${TYPE_LABEL[a.type]}` : `Google Doc created for ${TYPE_LABEL[a.type]}`)

app/src/screens/PacketBuilder.jsx:532-544 (makeSlides): same shape, checks `res.error` only.

app/src/screens/OppDetail.jsx:569-573 (makeDoc):
    const r = await api.generateArtifactDocument(a.id, opts); if (r.error) throw new Error(r.error);
    patch(a.id, { docUrl: r.docUrl }); toast(opts.regen ? 'Google Doc rebuilt' : 'Google Doc created'); load({ silent: true })

FINDING (ground-truthed by reading the actual consumer code, not by comparison/assumption):
All three call sites branch on `res.error`, NEVER on `res.ok`. Since the templated
ok:false-with-warnings path never populates `error`, none of these three call sites throws,
discards docUrl, or shows a failure toast for that case. **GAP 1 part B (the suspected regression)
does NOT exist in app/src today — it is ALREADY correctly handled.** This is a first-class
ALREADY-BUILT outcome per CLAUDE.md's feasibility rule. Action: write a regression guard, not a
feature, to lock this in (so a future edit that starts branching on `res.ok` doesn't reintroduce
the bug the task suspected).

Still a real, separate gap: the `warnings` array itself (when non-empty) is silently dropped by all
three consumers — never shown to the owner at all. That's an omission, not a regression, and adjacent
to GAP 1's "surface stale/failed checks" theme, so folding a warnings-are-visible affordance into the
same UI surface as checksStale is in scope and consistent with "extend, don't duplicate."

## Step 3 — GAP 1 part A implementation: core wiring (QcRail + PacketBuilder)

Extended the ONE shared source (`useQcEntries` in app/src/screens/QcRail.jsx — the file's own header
says "ONE source for every asset's QC payload") rather than building a parallel state store:

- `app/src/qcRail.js`: added `QC_HOOKS.staleChecks` and a pure `staleChecksNote(entry)` selector
  (returns null, or a sentence naming `staleError` when present). Kept in the "pure logic" module per
  this file's own rule ("THIS FILE COMPUTES NOTHING [in the .jsx]").
- `app/src/screens/QcRail.jsx` `useQcEntries`: added `stale`/`staleError` fields to each entry, and
  two new setters returned alongside `setResult`: `markStale(id, error)` and `clearStale(id)`.
  IMPORTANT design point: `setResult` (fired after a plain `GET /checks-result` re-read) deliberately
  does NOT clear `stale` — confirmed by reading `artifactChecksGet` (api/src/functions/tests/
  appChecks.ts:404) that the GET route only reads the STORED `artifact_gate`/`check_result` rows and
  never recomputes, so a plain re-fetch after a write proves nothing about freshness. Only
  `doRerun` (POST /artifact/{id}/checks -> a real `runChecks()` recompute, appChecks.ts:387) clears
  a stale mark.
- Rendered in `ChecksTab` (per-asset) via `staleChecksNote(e)`, `data-qc={QC_HOOKS.staleChecks}`.
- Wired the two write flows already living inside QcRail.jsx itself (`CorrectionRow.doUndo` ->
  `api.revertCorrection`, `.doAsk` -> `api.aiEditArtifact`, `.doRerun` -> `api.runArtifactChecks`)
  through a new optional `onStaleSignal(stale, error)` prop, threaded QcRail -> ChangeLog ->
  CorrectionRow. `CorrectionRow` is also reused by AssetBlocks.jsx (`import { CorrectionRow } from
  './QcRail.jsx'`) — the new prop defaults to null there, so that surface is UNCHANGED, not broken.
- `app/src/screens/PacketBuilder.jsx`: destructured `markStale`/`clearStale` from `useQcEntries`,
  passed to `<QcRail markStale clearStale>`, and to `<ArtifactCard qcStale qcStaleError
  onStaleSignal>`. Wired `generate()` (artifactGenerate) and the card's inline "List Tweaks"
  ai-edit send button (artifactAiEdit) to call `markQcStale`. Card renders a `Pill tone="warn"` next
  to `GateBadge` when `qcStale`.

**Found and fixed a real latent bug while wiring this**: `Pill` (app/src/shell.jsx:50) destructures
only `{ children, tone, style }` and does NOT spread extra props — so `title`/`data-qc` passed
directly to `<Pill>` are silently dropped. A pre-existing case of the same thing already existed at
PacketBuilder.jsx:1288 (`<Pill tone={...} data-qc="packet-gate">`), so it's not new, but I did not
repeat it: the new stale badge wraps `<Pill>` in a plain `<span title=... data-qc=...>` so the
tooltip and the CSS hook actually render. Left the pre-existing one alone (out of scope for this
lane - it is a Tier 3 cosmetic; api-owning lanes are live in this checkout and I was told not to
chase unrelated things). Noted for the record, not silently walked past.

Build after this step: `cd app && npm run build` -> **clean, 249 modules, no errors** (only the
pre-existing >500kB chunk-size warning, unrelated).

## Coverage so far vs. the 5 target routes
- artifactGenerate   -> WIRED (PacketBuilder.generate)
- artifactAiEdit     -> WIRED (QcRail CorrectionRow.doAsk; PacketBuilder card's assetAsk send)
- correctionRevert   -> WIRED (QcRail CorrectionRow.doUndo)
- artifactContent    -> NOT YET (only consumer today is OppDetail.jsx's inline field editor — next)
- artifactOwnerEdit  -> `api.ownerEdit` (api.js:201) has ZERO call sites anywhere in app/src today
  (`grep -rn "\.ownerEdit(" app/src --include=*.jsx` = no matches). There is nothing to wire a signal
  onto - the UI for owner-edit itself does not exist yet in this branch. Stating this plainly rather
  than inventing a UI for a route nobody calls: that would be new scope, not this lane's two GAPs.

## Step 4 — GAP 1 part A: OppDetail.jsx wired too (closes artifactContent)

OppDetail.jsx has no shared `useQcEntries()` state (that hook lives in QcRail.jsx and is only
instantiated by PacketBuilder.jsx), so this screen gets its own small, per-screen stale map rather
than importing PacketBuilder's — same shape/keys as useQcEntries (`artifactId -> error string`), so
the two surfaces show the same FACT without literally sharing React state across route boundaries.

- `ResumeTab`: added `staleById` state + `markStale`/`onStaleSignal` helpers.
- `ResumeField.save()` (artifactContent / saveArtifactContent) and `.aiEdit()` (artifactAiEdit) now
  read `r.checksStale`/`r.checksError` and report via the new `onStaleSignal` prop.
- `ResumeTab.generate()` (artifactGenerate) does the same.
- Rendered next to the existing per-artifact status `<Pill>` (line ~597), same wrapping-span pattern
  as PacketBuilder's card (Pill does not forward title/data-qc).

Build after this step: clean, 249 modules, no errors.

## Coverage vs. the 5 target routes — final
- artifactGenerate   -> WIRED (PacketBuilder.generate, OppDetail ResumeTab.generate)
- artifactAiEdit     -> WIRED (QcRail CorrectionRow.doAsk, PacketBuilder card assetAsk send,
                                OppDetail ResumeField.aiEdit)
- correctionRevert   -> WIRED (QcRail CorrectionRow.doUndo)
- artifactContent    -> WIRED (OppDetail ResumeField.save)
- artifactOwnerEdit  -> NOT WIRED. `api.ownerEdit` has zero call sites in app/src on this branch -
  there is no owner-edit UI to attach a signal to. Confirmed again after all the above edits:
  `grep -rn "\.ownerEdit(" app/src --include=*.jsx` -> no matches. Left alone rather than inventing
  new scope; noted here so it is not silently dropped.

NOT wired (found but out of scope for this pass, noted so nothing is silently skipped):
- AssetBlocks.jsx:983 `api.aiEditArtifact` (a second, separate ai-edit UI, distinct from
  PacketBuilder's List Tweaks box) - the file is 1535 lines and already reuses `CorrectionRow`
  (which now supports `onStaleSignal`) for its OWN correction rows via `<CorrectionRow ... inField>`
  at :1040, so ITS correction-row path already picked up the wiring for free once QcRail.jsx's
  `CorrectionRow` gained the prop - AssetBlocks.jsx just doesn't pass an `onStaleSignal` callback
  through, so it defaults to null there (a no-op, not a regression - the prop is additive/optional).
  Its standalone `api.aiEditArtifact` call at :983 remains unwired.
- AssistantPanel.jsx:77 `api.aiEditArtifact` - a third, chat-style ai-edit surface. Unwired.

Both are genuinely reachable follow-up work, not required to close GAP 1 as scoped ("nothing shows
the owner that an artifact's checks are stale" - that is no longer true; three of the five routes'
PRIMARY surfaces show it, the fourth route has no consumer at all, and the fifth route's two
secondary/duplicate ai-edit surfaces are the only unwired case).

## Step 5 — GAP 2: judge-outcome retention window in Settings

Confirmed no existing UI consumer first: `grep -rn "judge-outcome-prefs\|judgeOutcomePrefs\|retentionDays" app/src`
before this change -> zero matches. GAP 2 is real, not already built.

Extended the EXISTING "Quality" settings tab (`app/src/screens/Settings.jsx`, `active === 'quality'`)
rather than a new screen, right beside `ChecksSettings` (the chk_* threshold settings) and
`DimensionSettings` — same `Card`/dirty-tracking/Save pattern those two already use. Did NOT force
this into `ChecksSettings`' dynamic `checkColumns` list: that list is driven by a different API
route/table shape (an array of chk_* columns the search-prefs route publishes); judge-outcome-prefs
is its own dedicated GET/PATCH route with one field, so a sibling Card in the same tab is the correct
"extend" move, not a rename of the columns UI to fit a shape it does not have.

- `app/src/api.js`: added `judgeOutcomePrefsGet()` (GET, `?owner=`) and `judgeOutcomePrefsSet(days)`
  (PATCH via the existing `patch_` helper, `?owner=`). Route is registered `['GET','PATCH','OPTIONS']`
  only (judgeOutcome.ts:254) — used `patch_`, not `post`, matching that registration exactly.
- `app/src/screens/Settings.jsx`: new `JudgeOutcomeRetentionSettings()` Card. Loads current value +
  seed on mount, editable number input (0 = keep forever, matching the API's own documented
  contract), Save disabled until dirty and valid, reuses the file's local `sessionValid()` write
  gate the same way `ChecksSettings.save()` does. Mounted into the quality tab's render list right
  after `<ChecksSettings />`.

Build after this step: clean, 249 modules, no errors.

Where the owner changes it: **Settings -> Quality tab -> "Judge-outcome history" card**, directly
below "Quality checks". Number input labelled "Keep judge outcomes for ... days (0 = keep forever)".

## Step 6 — guards + mutation-proof

New test file: `app/test/checksStaleWiring.test.mjs` (16 tests). Given this suite has no DOM/React
renderer (`node --test test/*.test.mjs`, no @testing-library — confirmed by reading package.json's
`"test"` script and every existing test/*.test.mjs), wiring is asserted structurally against source
text, matching this repo's own established idiom (apiShape.test.mjs's key-duplicate grep,
qcRail.test.mjs's stripComments/readSrc sweep). Pure logic (`staleChecksNote`) is asserted directly.

Covers, at minimum, the three things the brief asked for:
- stale/failed-checks signal renders when the API reports it (`staleChecksNote` tests), and does
  NOT render when it doesn't (the "renders nothing when not stale" test) — plus one wiring test per
  write call site (generate x2, ai-edit x3, content-save x1, revert x1) proving each one actually
  reads `checksStale`/`checksError` off its own response and reports it, not that the UI merely CAN.
- a document/deck produced with an uncomputable gate is not presented as a failure and its
  docUrl/deckUrl is not discarded (the two `res.ok`/`r.ok`-absence regression guards for
  PacketBuilder and OppDetail's makeDoc/makeSlides).
- the retention control reads its current value from the API and PATCHes the owner's choice with
  `?owner=` present (api.js shape test), is actually mounted (not dead code), and uses `patch_` (the
  route is GET/PATCH-only, POST would 405).

Full suite: `cd app && npm test` -> **484/484 pass** (16 new + 468 pre-existing, zero regressions).
Build: `cd app && npm run build` -> clean, 249 modules.

### Mutation-proof — mutate.sh refused as expected (dirty tree, cannot commit), so proved BY HAND

`mutate.sh` was invoked once to confirm its own refusal message on record:

```
$ bash /workspace/eds-claude-skills/scripts/mutate.sh app/src/qcRail.js /tmp/mut/anchor1.txt \
    /tmp/mut/repl1.txt "cd app && node --test test/checksStaleWiring.test.mjs" \
    "renders a sentence when the entry IS stale"
NOT-APPLIED: app/src/qcRail.js has uncommitted changes.
             Commit or stash first -- otherwise a failed restore looks like your own edit.
```

Expected per the brief (two API lanes live in this checkout, I do not commit). Rather than only
handing over anchors, I ran the SAME apply -> test -> restore -> verify-restore sequence by hand
(cp-based backup, not git) for every guard below, and report the REAL observed outcome, not a
prediction. All 7 FIRED and all 7 restores verified byte-identical to the pre-mutation file.

| # | File | Guarded by (test) | Outcome |
|---|---|---|---|
| 1 | app/src/qcRail.js | `staleChecksNote: renders a sentence when the entry IS stale...` | **FIRED** |
| 2 | app/src/screens/PacketBuilder.jsx | `PacketBuilder.generate() (artifactGenerate) reads checksStale...` | **FIRED** |
| 3 | app/src/screens/QcRail.jsx | `QcRail CorrectionRow.doUndo (correctionRevert) reads checksStale...` | **FIRED** |
| 4 | app/src/screens/OppDetail.jsx | `OppDetail ResumeField.save() (artifactContent) reads checksStale...` | **FIRED** |
| 5 | app/src/screens/PacketBuilder.jsx | `PacketBuilder.makeDoc/makeSlides never branch on res.ok...` (GAP1B regression guard) | **FIRED** |
| 6 | app/src/api.js | `api.js exposes judge-outcome-prefs GET/PATCH...via patch_...` | **FIRED** |
| 7 | app/src/screens/Settings.jsx | `Settings.jsx: the retention control is actually mounted...` | **FIRED** |

After all 7: full suite re-run clean (484/484), build clean. No file left in a mutated state.

**For re-running the real tool after this lands on a commit** — the exact anchors/replacements
(verbatim, as applied above):

**#1** `app/src/qcRail.js` — test: `staleChecksNote: renders a sentence when the entry IS stale, naming the reason when there is one` — cmd: `cd app && node --test test/checksStaleWiring.test.mjs`
```
ANCHOR:
export function staleChecksNote(entry) {
  if (!entry || !entry.stale) return null

REPLACEMENT:
export function staleChecksNote(entry) {
  return null
  if (!entry || !entry.stale) return null
```

**#2** `app/src/screens/PacketBuilder.jsx` — test: `PacketBuilder.generate() (artifactGenerate) reads checksStale/checksError and reports it`
```
ANCHOR:
      if (res.checksStale) markQcStale(a.id, res.checksError)

REPLACEMENT:
      // MUTATION: stale signal dropped
```

**#3** `app/src/screens/QcRail.jsx` — test: `QcRail CorrectionRow.doUndo (correctionRevert) reads checksStale and reports it`
```
ANCHOR:
      if (onStaleSignal) onStaleSignal(!!res.checksStale, res.checksError)
      const outcome = revertOutcome(res)

REPLACEMENT:
      // MUTATION: stale signal dropped
      const outcome = revertOutcome(res)
```
(NOTE: this exact line also appears once in `doAsk` — the two-line anchor above, including the
following `revertOutcome(res)` line which only exists in `doUndo`, is what keeps it unique. A
one-line anchor here is REJECTED by mutate.sh as ambiguous.)

**#4** `app/src/screens/OppDetail.jsx` — test: `OppDetail ResumeField.save() (artifactContent) reads checksStale and reports it`
```
ANCHOR:
      if (onStaleSignal) onStaleSignal(!!r.checksStale, r.checksError)
      onPatch(fieldKey, draft); setEditing(false); toast('Section saved')

REPLACEMENT:
      onPatch(fieldKey, draft); setEditing(false); toast('Section saved')
```

**#5** `app/src/screens/PacketBuilder.jsx` — test: `PacketBuilder.makeDoc/makeSlides never branch on res.ok - only res.error, and always keep docUrl`
```
ANCHOR:
      const res = await api.generateArtifactDocument(a.id, opts)
      if (res.error) throw new Error(res.error)
      patchArtifact(a.id, { docUrl: res.docUrl })

REPLACEMENT:
      const res = await api.generateArtifactDocument(a.id, opts)
      if (res.error) throw new Error(res.error)
      // MUTATION: reintroduce the exact regression this lane guards against
      if (!res.ok) throw new Error('build reported warnings')
      patchArtifact(a.id, { docUrl: res.docUrl })
```

**#6** `app/src/api.js` — test: `api.js exposes judge-outcome-prefs GET/PATCH with ?owner= on both, PATCH via patch_ (route is GET/PATCH-only)`
```
ANCHOR:
  judgeOutcomePrefsSet: (retentionDays) => patch_(`/app/judge-outcome-prefs?owner=${encodeURIComponent(_owner)}`, { retentionDays }),

REPLACEMENT:
  judgeOutcomePrefsSet: (retentionDays) => post(`/app/judge-outcome-prefs?owner=${encodeURIComponent(_owner)}`, { retentionDays }),
```

**#7** `app/src/screens/Settings.jsx` — test: `Settings.jsx: the retention control is actually mounted in the quality tab, not dead code`
```
ANCHOR:
      {active === 'quality' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><ChecksSettings /><JudgeOutcomeRetentionSettings /><DimensionSettings /><SkillWordingSettings /><TemplateFocusSettings /><PipelineSettings /></div>}

REPLACEMENT:
      {active === 'quality' && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><ChecksSettings /><DimensionSettings /><SkillWordingSettings /><TemplateFocusSettings /><PipelineSettings /></div>}
```

## FINAL STATUS

- Build: clean (`cd app && npm run build`, 249 modules, no errors).
- Tests: 484/484 pass (`cd app && npm test`), 16 new, 468 pre-existing, zero regressions.
- All 7 new-guard mutations FIRED (hand-run since mutate.sh correctly refused the dirty tree) and
  all restores verified byte-identical.
- Nothing under api/ was touched. Nothing under app/ outside app/src and app/test was touched.
- No git command was run other than `git status`/`git diff --quiet` (read-only, used only to
  confirm mutate.sh's own dirty-tree check) and the one `mutate.sh` invocation that itself refused.

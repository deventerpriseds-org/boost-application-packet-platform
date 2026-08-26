# BUILD — GROUP C (4.6-10 "Drop it, leave the line open" + 4.6-11 assistant-request phrasing)

Branch: `claude/three-small-ui-gaps` (base 115b10a). Agent build log — appended as work proceeds.
DO NOT commit/push from this agent; parent commits.

## Status
- [ ] Read contracts (CLAUDE.md, AC-large-medium.md, AC-skill-bank.md)
- [ ] Trace existing write path (owner-edit / seedAskReword / BLOCK_HOOKS)
- [ ] Implement
- [ ] Guards + mutation proofs
- [ ] 0b defect hunt
- [ ] Local render evidence

## Log

### t1 — contracts read (2026-08-26)
- `docs/qc-evidence/AC-large-medium.md:618-731` — GROUP C ACs C.0-C.12 + REGRESSION GUARD C. Tier 2
  with ONE tier-1 AC (C.4, the copy).
- `docs/qc-evidence/AC-skill-bank.md:25` — REFUTES "there is no writer" **for 4.6-9 only**, and
  `:430` states verbatim: *"Not in scope, and deliberately: 4.6-10 … Group C's `ABSENT` writer
  verdict stands for that one, because a keyword decline has no store."*
- Prototype ground truth, read not inferred — `docs/qc-evidence/qc/assets.jsx:82-83`:
  the drop button is `onClick={() => onAsk('Drop … and leave the line it covers open. I would
  rather show a gap than overstate.')}`. **All three prototype actions are `onAsk` — requests, not
  writes.** So 4.6-10 is a REQUEST in the prototype too; only its sentence claims coverage.

### t2 — TIER-1 QUESTION SETTLED: what a drop WRITES, and why not `owner-edit`
The brief asked me to prove the drop goes through `owner-edit` rather than `ai-edit`. Ground-truthed
against the primary source rather than the summary, the premise does not hold for a DROP:

`api/src/functions/tests/appSwaps.ts:44-49` —
```
select distinct c.replacement from correction c … where … c.source = 'owner_edit' …
  .map(r => r.replacement).filter(Boolean)
```
`ownerLabels` is a set of **replacement strings**, and `swaps.ts:279` sets
`driver: (to && ownerLabels.has(to)) ? 'owner'` — it matches a correction's **replacement** against
a swap row's **`to` label**. A drop's replacement is the empty string, which `.filter(Boolean)`
removes from `ownerLabels` before it is ever consulted. **An `owner-edit` DELETION therefore
produces no `ownerLabels` entry, sets no `driver='owner'`, and changes no `unattributed` count.**
The attribution benefit that would justify routing a drop through `owner-edit` does not exist.

Second reason: `owner-edit` splices `replacement` in at the phrase's exact offsets
(`appCorrections.ts:359`). Deleting a bare keyword out of prose yields `Led  initiatives across
teams` — a double space and a mangled sentence, written into `pkg_json`. Only a rewrite can remove
a term grammatically, and the rewrite path is the ask box.

**Conclusion (Observation vs Interpretation):**
- OBSERVED: `ownerLabels` filters empty replacements; `driver='owner'` keys off `to`-label identity;
  the prototype's drop is an `onAsk`; `AC-skill-bank.md:430` puts 4.6-10 outside the owner-edit
  refutation; `AC C.2` forbids a second POST and `AC C.6` forbids a UI write to the audit tables.
- INTERPRETATION: **a drop writes NOTHING at activation.** It seeds an editable sentence into the
  field's own ask box. If the reader presses Send, the write is whatever that existing box already
  writes (`ai-edit`), unchanged by this lane. The UI says so on screen rather than implying a
  recorded decision.

### t3 — build plan
- `assetBlocks.js`: new pure `keywordActions({ keyword, present, canEdit })` → `{ ask, reason }`.
  Logic lives there; the JSX renders and does not decide (the file's own stated split).
- `AssetBlocks.jsx`: extract `seedAsk(sentence)` as the ONE seed-then-open primitive and make the
  existing `seedAskReword` delegate to it (EXTEND, not a second mechanism). Wire the keyword panel's
  drop control to `seedAsk`.
- Hooks: `keywordActions`, `keywordDrop`, `keywordNoAction` — all from `BLOCK_HOOKS`.
- NOT built: the prototype's `Put back "<orig>"` action — it names a displacement
  (`AssetBlocks.jsx:843-847` records "took the place of" as having no source). NOT built: 4.6-9.

---

## WHAT WAS BUILT

| # | File:line | What |
|---|---|---|
| 1 | `app/src/assetBlocks.js:58-60` | `BLOCK_HOOKS.keywordActions` / `.keywordDrop` / `.keywordNoAction` |
| 2 | `app/src/assetBlocks.js:407-455` | `keywordActions({keyword, present, canEdit}) -> {ask, reason}` — the pure selector. The panel renders its answer; it does not decide. |
| 3 | `app/src/screens/AssetBlocks.jsx:526-530` | `seedAsk(sentence)` — ONE seed-then-open primitive. `seedAskReword` now **delegates** to it, sentence unchanged. Second caller is the keyword panel. EXTEND, not a second mechanism. |
| 4 | `app/src/screens/AssetBlocks.jsx:861-901` | The actions region inside `BLOCK_HOOKS.keywordDetail`, below the explanation and the verbatim quote (AC C.1). |

**Rendered copy** (from the browser probe's DOM dump, not from the source):
```
Not comfortable claiming this?
Ask to drop it from this field
This asks for a rewrite and records no decision. Nothing is sent until you press Send.
```
and, for a keyword the draft does not contain:
```
This field does not contain it, so there is nothing here to drop.
```
Seeded sentence: `Drop "hiring technology" from this field. Rewrite the text without it rather than swapping in a synonym.`

**NOT built, deliberately:** 4.6-9 (separate lane). The prototype's `Put back "<orig>"` action — it names a
displacement, and `AssetBlocks.jsx:843-847` records "took the place of" as having no source in this app.

## WHAT A DROP WRITES (the tier-1 statement)
**At activation: nothing.** No request of any kind — proved from the browser, not asserted: every call
reaching the API mock is recorded, and `apiCalls.length` is unchanged across both the click and the
Enter path (`59/59`, checks *"activating it SENT NOTHING"* / *"the keyboard path sent nothing either"*).
On **Send**, the write is whatever the field's existing ask box already writes — `ai-edit`, one call
site, unchanged (`H:wording-ask-reuses-the-field-edit-path` still counts exactly 1).
**It does NOT use `owner-edit`, and that is the ground-truthed answer, not an omission** — see t2 above:
`ownerLabels` filters empty replacements, so an `owner-edit` deletion attributes nothing either, and
splicing at exact offsets cannot remove a term grammatically.

## GUARDS — every one mutation-proved AND counter-proved
All in `app/test/proposedKeywords.test.mjs` (the suite that OWNS this panel; a guard placed only in
`assetBlocks.test.mjs` would be structurally blind to it — REGRESSION GUARD C names both).

| Guard | Mutation (suite must FAIL) | Result |
|---|---|---|
| `H:keyword-drop-claims-no-coverage` | selector sentence -> the prototype's *"leave the line it covers open… show a gap"* | FAIL 2 ✔ |
| " | coverage claim injected into the RENDERED disclosure only | FAIL 1 ✔ |
| `H:keyword-drop-offers-nothing-it-cannot-do` | delete the `!present` branch | FAIL 2 ✔ |
| " | JSX passes `present: true` instead of `kwPresent.has(...)` | FAIL 1 ✔ |
| " | `canEdit: true` (a static block gets an inert control) | FAIL 1 ✔ |
| " | delete the `keywordNoAction` branch | FAIL 1 ✔ |
| " | delete the on-screen "records no decision" disclosure | FAIL 1 ✔ |
| `H:keyword-drop-seeds-the-ask-box-and-sends-nothing` | `seedAskReword` stops delegating | FAIL 1 ✔ |
| " | the drop control POSTs `api.aiEditArtifact` directly | FAIL 1 ✔ |
| `H:keyword-drop-quotes-no-posting-text` | selector interpolates `verbatim` | FAIL 1 ✔ |
| `H:keyword-drop-is-keyboard-reachable` | delete `onKeyDown` | FAIL 1 ✔ |
| ALL FIVE | delete the entire actions render block | FAIL 5 ✔ |
| ALL | gut the selector body (always offer) | FAIL 2 ✔ |

Counter-proofs (must still PASS): honest reword of the sentence ✔; defensive `act && act.ask` ✔;
whitespace/attribute-per-line churn in the region ✔; reworded disclosure ✔.
Two assertions were LOOSENED because a counter-proof caught them crying wolf: `/\bDrop\b/` ->
`/\bdrop\b/i`, and `/records no decision/` -> `/no decision/i`. Both still fail their deletion.

## MY OWN 0b DEFECT HUNT — what it caught
1. **Who reads it?** `keywordActions` has 1 production consumer (`AssetBlocks.jsx:871`), not
   write-only. The three hooks render in `AssetBlocks.jsx`, which IS `BLOCKS_SRC` in
   `assetBlocks.test.mjs:356` — so the existing "every hook rendered / none hand-typed" guard can SEE
   the change. Cross-screen union (`assetGate.test.mjs`, `postingCompare.test.mjs`) green.
2. **Can the system PRODUCE the fixture?** *Caught a real gap.* The first guards fed hand-set
   booleans. Now `H:keyword-drop-offers-nothing-it-cannot-do` drives the REAL producers —
   `proposedKeywordsForRow` -> `keywordPresence` -> `keywordActions` — and the browser probe drives
   the whole chain from an `insertions` payload.
3. **How many homes?** One: `assetBlocks.js` + `AssetBlocks.jsx` (`grep -rln keywordDetail app/src`).
   Seed mechanism: `seedAsk` with exactly 2 callers.
4. **Delete each load-bearing line** — D1-D4 above. Deleting the whole feature fails 5 guards.
5. *Caught in the probe itself:* the first keyboard check blanked a React-controlled `<textarea>` from
   script, so React skipped the re-render and the probe read its OWN blank back and reported the
   feature broken. Closing the box via its real Cancel button + a real `keyboard.press('Enter')` shows
   it works. **A false FAIL is as expensive as a false PASS.**

## VERIFICATION RUN (commands and their output)
- `cd app && npm test` -> **331 tests, 331 pass, 0 fail** (326 before this lane; +5 new guards).
- `cd app && npm run build` -> `built in 3.39s`, no errors. Smart-quote codepoint scan: **0 hits** on
  all four changed files.
- `cd app && npm run test:margin` (real Chromium at `/opt/pw-browsers`, vite dev server, the panel
  driven by clicks) -> **59/59 checks passed** (47 before; +12 new). This is the RENDERED-DOM proof.
- `git diff --stat -- api/` -> **empty**. No API change, so AC C.6 (no UI write to `skill_candidate` /
  `swap_decision`) holds structurally, not by inspection.

## FLAKE OBSERVED, AND ITS CAUSE
One `npm test` run mid-session reported `tests 239 / fail 6`, the failures naming
`corrections.test.mjs`, `packetFailList.test.mjs`, `qcRail.test.mjs` — none of which this lane
touches. 12 consecutive runs since are 331/331, and those three files pass in isolation.
**Cause: this worktree is being edited by a concurrent lane.** `git status` was clean of modified
files when this agent started; `git diff --stat` now also lists `assetGate.js`, `postingAnalysis.js`,
`qcRail.js`, `AssetGateDrawer.jsx`, `PacketBuilder.jsx`, `PostingAnalysis.jsx`, `QcRail.jsx` — Group
A/B work that appeared during this run. A suite reading those files mid-write is the flake.
**This lane's diff is confined to 4 files** and every hunk in them is this lane's.

## DONE

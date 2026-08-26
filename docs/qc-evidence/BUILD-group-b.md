# BUILD — GROUP B (4.3-9 / 4.3-10 / 4.3-11): QC summary inside the ATS/tally modal

Branch: `claude/three-small-ui-gaps`. Agent: Group B implementer. Started: (see git log)

**Status: IN PROGRESS — appended to as work proceeds.**

## Step 0 — orientation
- Created this file before reading anything else (per brief).

## Step 1 — what I read, and the ONE finding that changed the plan

Read: `CLAUDE.md`, `docs/qc-evidence/AC-large-medium.md` (Group B feasibility table + AC B.1-B.15 +
REGRESSION GUARD B), and the source of every surface named there.

**FINDING (0b check #3 — how many HOMES does the concept have): the compact score block ALREADY
EXISTS, and the AC did not know about it.**

The AC names `MatchTab` (`AssetGateDrawer.jsx:282-325`) as the only bar renderer. There is a
**second, and it is the compact one**: `QcRail.jsx:841-878` renders the composite headline + the
three parts + `px-bar` + the "not measured" Pill + the source prose, driven by an ALREADY-PURE,
ALREADY-TESTED model — `railHeadline(score)` (`qcRail.js:284-299`) — with hooks
`QC_HOOKS.headline` / `QC_HOOKS.component` and the shared clamp `pctWidth()` (`qcRail.js:690`).

`grep -rn "px-bar" app/src` →
```
src/theme.css:229,230           the class itself
src/screens/AssetBlocks.jsx:233 a completion meter (NOT a score part)
src/screens/QcRail.jsx:870      score part  <-- second home
src/screens/AssetGateDrawer.jsx:316 score part  <-- the home the AC names
```

Consequences for the build, all of which make it CHEAPER and more honest:
1. **The composite prose is already a pure function.** `railHeadline().why` says *"No overall number:
   a composite is only computed when all three parts exist, and N of them do not - keywords present,
   seniority fit."* — with no "below", so it is correct in a compact block too. AC B.6 needs **no new
   prose**; MatchTab's own longer sentence stays untouched (AC B.14's "MatchTab unchanged").
2. **AC B.14 becomes 3 homes -> 1**, not 2 -> 1. I extract ONE `ScoreParts` component and make
   MatchTab, QcRail AND the modal render it.
3. `QcRail.jsx:847-851` already carries AC B.8's sentence pattern ("<label> only - there is no
   packet-wide score, and averaging the assets would invent one").

**Second finding — the live data state is not the one the AC's examples assume.**
`docs/qc-evidence/fixtures.json` is real production data: **every artifact's `checks-result.score`
is `null`** (not merely `composite: null`). So today's live path is a FOURTH state — "no score row at
all" — distinct from AC B.6's `composite: null`. The model must separate them or it will print
`railHeadline(null).why` ("No overall number was stored for this run") for a resume that was never
scored, which is a different claim.

## Step 2 — the plan (branch decisions stated, per AC B.4 and the Config check)

- **AC B.4 → branch (a), with a visible deferral.** The score block does **not** print
  `keyword_coverage`. The `kw` part row renders its label and a pointer to the existing
  `KeywordLibraryState` section directly above it, with **no number and no bar**. One measurement,
  one place. `KeywordLibraryState` keeps all three of its states (REGRESSION GUARD B (2) intact).
- **Model:** new pure `qcSummaryModel(entries, { scored, scoredType })` in `app/src/qcRail.js`
  (the module that already owns every packet-level selector). It derives NO gate, NO severity and
  NO count; it reuses `railHeadline()` and passes each entry's `result` through untouched.
- **Renderer:** `ScoreParts` extracted from `MatchTab` into `AssetGateDrawer.jsx` (the file that
  already exports `GateBadge`), with a `variant` for the drawer's boxed rows and the rail's compact
  rows, an optional `hook`, and an optional `defer` map. Consumers: `MatchTab`, `QcRail.jsx`, the
  modal.
- **`GateBadge` is IMPORTED** into `PostingAnalysis.jsx` from `./AssetGateDrawer.jsx` (AC B.2).
- **The scored artifact type stays the ONE literal already at `PacketBuilder.jsx:439`** — lifted to a
  named const so there is exactly one occurrence. No second hardcoded type list (Config check).

## Step 3 — built (all edits in the working tree, NOT committed)

| # | file:line | what |
|---|---|---|
| 1 | `app/src/assetGate.js:397` | `bandTone(band)` — the band->tone ternary was typed out in `AssetGateDrawer.jsx:369` and `QcRail.jsx:856`. One home; unknown band falls to `red`, never green. |
| 2 | `app/src/assetGate.js:399-410` | `pctWidth()` MOVED here from `qcRail.js:690`, beside `scoreParts()`, and re-exported from `qcRail.js:23` so every existing caller and test keeps its import. The drawer had hand-inlined the same clamp. |
| 3 | `app/src/qcRail.js:869` | `NO_ASSETS_REASON` extracted so `qcStepState` and the new model print ONE sentence (AC B.9). |
| 4 | `app/src/qcRail.js:895-985` | **`qcSummaryModel(entries, {scored, scoredType})`** — the pure model. SIX states. Derives no gate, no severity, no count; reuses `railHeadline()`; passes each `result` through untouched. |
| 5 | `app/src/screens/AssetGateDrawer.jsx:100-165` | **`ScoreParts`** extracted from `MatchTab`, exported, with `variant` (drawer/rail), optional `hook`, optional `defer`. |
| 6 | `app/src/screens/AssetGateDrawer.jsx:377` | `MatchTab` now renders `<ScoreParts parts={parts} variant="drawer" />`. |
| 7 | `app/src/screens/QcRail.jsx:863` | The QC rail's compact block renders the SAME component (`variant="rail"`). Third home -> one. |
| 8 | `app/src/postingAnalysis.js:71-75` | 5 new `POSTING_HOOKS` keys, all `tally-` prefixed. |
| 9 | `app/src/postingAnalysis.js:77-92` | `TALLY_SCORE_DEFER` — AC B.4 branch (a), stated in the constant's own docblock. |
| 10 | `app/src/screens/PostingAnalysis.jsx:29-34` | **imports** `GateBadge` + `ScoreParts` (AC B.2: a relocation, not a copy) and `bandTone`. |
| 11 | `app/src/screens/PostingAnalysis.jsx:779-856` | `QcSummaryBlock` — renders the model. No derivation. |
| 12 | `app/src/screens/PostingAnalysis.jsx:858,878,895` | `KeywordTallyOverlay` takes `qcSummary` + `onGoQc`; the block mounts BELOW `KeywordLibraryState` (so "shown once, above" is true of the layout) and the `Open QC` button joins the existing footer. |
| 13 | `app/src/screens/PacketBuilder.jsx:439-450` | `SCORED_TYPE` const (one literal, not a second type list), `qcSummary` derived once off `qcEntries`. |
| 14 | `app/src/screens/PacketBuilder.jsx:1029-1032` | `qcSummary` + `onGoQc={() => { setAtsOpen(false); setActiveStep('qc') }}` — the identical shape to the existing `onGoResume`. |

### AC B.4 — THE BRANCH TAKEN, stated as the AC demands: **(a), with a visible deferral.**
The score block does not print `keyword_coverage`. Its `kw` row keeps its LABEL (dropping it would
hide which three parts a composite needs), carries `data-qc-deferred="1"`, and prints
*"Shown once, above, as coverage against the ATS term library - the same measurement, in one place."*
instead of a number and a bar. `KeywordLibraryState` is untouched and keeps all three of its states.
**Proven, not asserted:** with every part measured (`keyword_coverage: 71`), the string `71` appears
**exactly once** in the whole rendered modal — `run-keyword-tally.mjs`, case `scored`.

### Browser probe (new): `app/test/browser/keyword-tally-probe.*` + `run-keyword-tally.mjs`, `npm run test:tally`
Extends the existing probe harness (`run-posting-analysis.mjs`'s pattern), seven renders of the REAL
`<KeywordTallyOverlay>` under DEV React. **49/49 checks pass.**

## Step 4 — guards, and the mutation proof of every one

Ten new node guards. **Every one was mutation-proven** (defect reinstated -> suite FAILS -> restored)
and **counter-proven** (correct-but-different code still PASSES). `bash /tmp/mut.sh`, verbatim:

| guard | file | mutation | result |
|---|---|---|---|
| `H:tally-two-empties-two-sentences` | `qcRail.test.mjs` | M1: no-resume reuses the empty-packet sentence | **PROVEN** — 340/1 |
| `H:tally-rows-are-the-packets-own-artifacts` | `qcRail.test.mjs` | M2: rows become the prototype's fixed 4-type list | **PROVEN** — 338/3 |
| `H:tally-scores-one-asset-and-says-which` | `qcRail.test.mjs` | M3: the model averages the artifacts' composites | **PROVEN** — 339/2 |
| `H:tally-unread-is-not-unscored` | `qcRail.test.mjs` | M4: the `resultError` branch is dropped | **PROVEN** — 339/2 |
| `H:tally-defer-key-tracks-scoreParts` | `qcRail.test.mjs` | M5: `scoreParts` renames its `kw` key | **PROVEN** — 340/1 |
| `H:tally-summary-derives-nothing` | `qcRail.test.mjs` | M6: the model counts failing gates itself | **PROVEN** — 340/1 |
| `H:tally-qc-summary-computes-nothing` | `postingAnalysis.test.mjs` | M7: `QcSummaryBlock` filters the rows itself | **PROVEN** — 340/1 |
| `H:gate-badge-is-imported-not-copied` | `postingAnalysis.test.mjs` | M8: a local `GateBadge` copy | **PROVEN** — 340/1 |
| `H:score-bar-has-one-home` | `postingAnalysis.test.mjs` | M9: the modal hand-writes its own bars | **PROVEN** — 340/1 |
| `H:tally-keyword-number-is-deferred-upward` | `postingAnalysis.test.mjs` | M10: the `defer` prop is dropped | **PROVEN** — 340/1 |

**Counter-proofs (a guard that fires on a refactor gets switched off):**
| | change | result |
|---|---|---|
| C1 | a defensive `model && model.state` + reflow | **OK** 341/0 |
| C2 | the empty-packet DETAIL sentence reworded | **OK** 341/0 |
| C3 | a comment containing `railGate(` and `.filter(` inside the component | **OK** 341/0 |

C3 matters: the region greps strip comments first, so the guard cannot fire on the note that explains
it — the cry-wolf failure that got two linters deleted from this repo.

**`H:tally-defer-key-tracks-scoreParts` is the one worth reading.** AC B.4 branch (a) works by KEY:
rename `scoreParts`' `kw` and the defer map silently stops matching, `keyword_coverage` comes back
onto the screen a second time under a second label, and nothing else in the suite notices. M5 proves
the guard sees it.

## Step 5 — verification actually run (commands and their output)

| what | command | result |
|---|---|---|
| node suite | `cd app && npm test` | **341 pass, 0 fail** (was 331 before this work) |
| build | `cd app && npm run build` | clean, `built in 4.22s`, no esbuild smart-quote error |
| smart quotes | Python codepoint scan over all 6 edited files | none |
| **the modal, rendered** | `npm run test:tally` (new probe, 7 renders of the REAL overlay under DEV React) | **49/49 checks pass**, zero console errors |
| **QcRail regression** | `render-app.mjs --route '#/packet/2cb.../qc' --fixtures docs/qc-evidence/fixtures.json --text`, before vs after | **body text byte-identical** (925 lines each), `pageErrors: []` |

### Browser-probe mutation proofs (the DOM-level half)
| mutation | result |
|---|---|
| B-M1: `ScoreParts` drawer variant `barTop: 6 -> 7` | **PROVEN** — 48/49, *"the drawer variant matches MatchTab's pre-extraction markup exactly"* FAILS on one `margin-top` |
| B-M2: a bar is drawn for a part with no value | **PROVEN** — 46/49, *"and draws NO bar"* + both parity checks FAIL |
| B-M3: the `defer` prop is dropped | node-level M10 PROVEN; the DOM-level run was lost to a background-job race (see caveat below) |

**Caveat, stated rather than hidden:** two mutation jobs were backgrounded at once and raced on the
same file, so the B-M3 probe output was not captured and one edit had to be re-applied. Everything
reported here was re-run SERIALLY afterwards on the restored tree: `npm test` 342/0, `npm run build`
clean, `npm run test:tally` 49/49, and the QC-step render still byte-identical to `before-qc.txt`.
`git diff` was checked to confirm no mutation survived.

## Step 6 — my own defect hunt (verify-work step 0b), and what it found

**1. Who READS what I wrote?** Traced every new export/prop/field to a consumer.
- `qcSummaryModel` -> `PacketBuilder.jsx:450`; `NO_ASSETS_REASON` -> `qcStepState` + the model;
  `ScoreParts` -> 3 consumers; `bandTone` -> 3; `pctWidth` (moved) -> `ScoreParts` + the re-export
  `qcRail.test.mjs` imports; `TALLY_SCORE_DEFER` -> the modal; `qcSummary`/`onGoQc` -> both sides.
- **FOUND: `model.subject` was WRITE-ONLY** — the model set it, the test read it, the component did
  not. Fixed by rendering it: the score section is now headed `MATCH SCORE - RESUME`
  (`PostingAnalysis.jsx:806-810`), which is also AC B.8's requirement said twice.

**2. Can the system PRODUCE my fixture?** Checked both shapes against the real producers.
- entry shape (`artifact`/`artifactId`/`type`/`label`/`result`/`resultLoading`/`resultError`) read
  off `useQcEntries` itself (`QcRail.jsx:100-125`).
- `checks-result` shape read off **production data**: `docs/qc-evidence/fixtures.json` keys are
  `['attention','corrections','engines','gate','override','results']` with `engines` grouped
  `{deterministic, reviewer}` — the grouping `engineRows()` prefers. The probe exercises the empty
  case; **the real-app render exercises the real one**, and the badges print the server's real
  counts (`11 to fix`, `10 to fix`, `21 to fix`, `Not checked`).
- score column names (`must_have_source` etc.) confirmed against the writer, `artifactScore.ts:214`.

**3. How many HOMES does the concept have?** This is the finding that reshaped the build — see Step 1.
The score-part bar had **two** homes, not the one the AC named, and `pctWidth` vs an inlined
`Math.max(0, Math.min(100, ...))` was the same clamp written twice (the inline copy rendered `NaN%`
where `pctWidth` renders `0%`). Now one home each, with `H:score-bar-has-one-home` to keep it there.
`bandTone` was a third instance of the same shape.

**4. Delete each new load-bearing line — does a test fail?** M1-M14 above. **This found the real gap:**
every guard proved the MODEL or the COMPONENT, and **all of them stayed green with the props never
wired in `PacketBuilder`** — the QC summary would have rendered nothing at all on the real screen
and the browser probe could not see it either, because it hands the model in directly. Closed by
`H:tally-summary-is-wired-in-the-packet-screen` (M11-M14 prove it, C4 counter-proves it).

## Step 7 — rendered locally, in the REAL app, with production fixtures

`scripts/render-app.mjs` gained `--click` (the local half of `ui-verify.mjs`'s existing `CLICK_SEL`,
which this modal needs because it only exists behind a click):

```
node scripts/render-app.mjs --route '#/packet/2cb56fb3-.../jd' \
  --fixtures docs/qc-evidence/fixtures.json \
  --click '[data-qc="match-estimate-button"]' --scrollto '[data-qc="tally-qc-summary"]' --out /tmp/qc-summary2.png
```
`pageErrors: []`. What it renders on TODAY's real data (every artifact has `score: null`):

> **QC summary** — *No score has been computed for the resume yet. The checks ran but stored no score
> row for it, so there is nothing to read. That is an absence, not a zero.*
> *Resume only - there is no packet-wide score, and averaging the assets would invent one.*
> Compact resume **Blocked 11 to fix** · Cover letter **Blocked 10 to fix** · Portfolio **Blocked 10
> to fix** · Intro video **Not checked** · Resume **Blocked 21 to fix**

Five rows: the packet's five real artifacts, in the packet's order, each with the server's own gate
and counts — including the video's `Not checked`, which is the state a vacuous green would hide.

Probe screenshots of the two states production data cannot yet reach (`/tmp/tally-scored.png`,
`/tmp/tally-null_composite.png`):
- **scored**: `ATS keyword coverage: 71%` in the library state, and the `Keywords present` row below
  reading *"Shown once, above..."* with **no number and no bar**; `78` + `acceptable` under
  `MATCH SCORE - RESUME`, with *"measured by the checks engine... not a model estimate"* beside the
  model's `64`.
- **null_composite**: no composite digit, the missing parts named, `not measured` + no bar on
  seniority, and the deferred keyword row carrying neither.

**Rendered locally.** The sandbox cannot reach `*.azurestaticapps.net`; nothing here is a live claim.

## Step 8 — AC by AC, with the evidence for each

| AC | verdict | evidence |
|---|---|---|
| **B.1** nothing new is derived | met | `H:tally-qc-summary-computes-nothing` (region-scoped, comments stripped) + `H:tally-summary-derives-nothing` on the model. M6/M7 prove both. **The change is tier 2 in practice by the AC's own binary test.** |
| **B.2** `GateBadge` imported, never copied | met | `H:gate-badge-is-imported-not-copied` — exactly one `function GateBadge` in `app/src`; M8 (a local copy) FAILS the suite. |
| **B.3** rows iterate the REAL artifact list | met | `H:tally-rows-are-the-packets-own-artifacts` (2 and 5); probe asserts `['resume','cover','video']` in packet order; the real render shows the packet's 5. M2 FAILS. |
| **B.4** the keyword number does not appear twice | met — **branch (a)** | Stated in `TALLY_SCORE_DEFER`'s docblock, in this file, and in the PR body. Probe: with `keyword_coverage: 71`, `71` appears **exactly once** in the modal. M5/M10 FAIL. |
| **B.5** the two BIG numbers are not conflated | met | The composite carries *"measured by the checks engine... not a model estimate"*; the model disclaimer at `:783-785` is untouched (probe asserts it verbatim in two cases). |
| **B.6** the null composite prose is carried | met | Read from `railHeadline().why` — not restated. Probe: no 2-3 digit number, missing parts named. Screenshot `/tmp/tally-null_composite.png`. |
| **B.7** a per-part null says WHY, with no bar | met | Probe: `not measured` + the server's reason + `.px-bar` count **0**; a measured part's bar is `62%`. B-M2 FAILS. |
| **B.8** scoped to ONE artifact and says which | met | `MATCH SCORE - RESUME` + *"Resume only - there is no packet-wide score, and averaging the assets would invent one"*. `H:tally-scores-one-asset-and-says-which`; M3 (averaging) FAILS. |
| **B.9** a packet with NO artifacts | met | `data-qc-state="no_assets"`, `qcStepState`'s own words via `NO_ASSETS_REASON`, no rows, no score block, the modal's other sections intact. |
| **B.10** artifacts but no resume | met | `data-qc-state="no_scored_asset"`, a DIFFERENT sentence, rows still render, no other asset's score shown. M1 FAILS. |
| **B.11** assets never checked | met | Probe: all three badges `data-qc-gate="unchecked"`, block never says clear. |
| **B.12** error / loading passed through | met | Probe: `unavailable` + `unloaded`, both assets named, the server's error text shown. M4 FAILS. |
| **B.13** `Open QC ->` reuses close-and-navigate | met | In the modal FOOTER beside `Go to the resume step`; click, Enter and Space all fire (native `<button>`); `PostingAnalysis.jsx` imports no navigation (asserted). M11/M12 FAIL. |
| **B.14** a compact score block EXTRACTED, never duplicated | met, **and one better than the AC asked** | `ScoreParts` serves MatchTab, QcRail AND the modal (3 homes -> 1). Byte-identical proof: probe compares `innerHTML` against the pre-extraction markup for BOTH variants; B-M1 (one `margin-top`) FAILS it. The QC step's rendered body is identical before/after. |
| **B.15** hook hygiene + no raw hex | met | 5 new keys in `POSTING_HOOKS`, all rendered, none hand-typed, no collision (the existing cross-screen union test), no raw hex (`darkTheme.test.mjs`). `POSTING_HOOKS.tally` still renders. |
| **REGRESSION GUARD B** | met | All four sections render in order (probe). `postingAnalysis.test.mjs` is **purely additive** — `git diff` shows 0 removed lines; `qcRail.test.mjs`'s only removed line is its import list; `assetGate.test.mjs` untouched. |
| **Config check** | met | `SCORED_TYPE` is ONE literal; no second type list; no new code-only threshold; bar colours/labels/order still come from `scoreParts()` + shared CSS. Guarded by `H:tally-summary-is-wired-in-the-packet-screen`. |

## What I could NOT verify from here

The sandbox cannot reach `*.azurestaticapps.net` or `azurewebsites.net`. Everything above is
**rendered locally** against production fixtures. To prove it on the deployed app after this lands
on `main`:

```
mcp__github__actions_run_trigger(method="run_workflow", owner="deventerpriseds-org",
  repo="boost-application-packet-platform", workflow_id="ui-verify.yml", ref="main", inputs={
    "route": "#/packet/2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3/jd",
    "owner": "von.ellis@enterpriseds.io",
    "click_sel": "[data-qc=\"match-estimate-button\"]",
    "expect": "QC summary;there is no packet-wide score;Open QC;It is not keyword coverage, and no applicant tracking system produced it",
    "count_sel": "[data-qc=\"keyword-library-state\"]", "count_max": "1"
  })
```
`count_sel`/`count_max` is AC B.4's live check: **`count_max: 1`, because branch (a) was taken.**
A second run with `count_sel: '[data-qc="tally-qc-asset"]'` and `count_min: 5` proves B.3 live
against that packet's five artifacts.

Two things no live run can reach today, and this is a DATA limit rather than a code one: on real
data every artifact has `score: null`, so **the live app can only show the `not_scored` state**. The
`scored` and `null_composite` states are provable only in the probe until a checks run stores an
`artifact_score` row — which needs a published term-library version (`appChecks.ts:128-141`).

## Step 9 — two things the parent needs to know before committing

**1. Three of Group B's files are ALREADY COMMITTED, inside another lane's commit.**
`aa59426` ("Group C 4.6-10/11: the drop hatch...") was made with a whole-tree add while this lane's
files were untracked, so it swept up:
`app/test/browser/keyword-tally-probe.html`, `app/test/browser/keyword-tally-probe.jsx`,
`app/test/browser/run-keyword-tally.mjs`, and the `test:tally` script in `app/package.json`.
Proof: `git log --diff-filter=A --oneline -- app/test/browser/keyword-tally-probe.jsx` -> `aa59426`.
Nothing is lost and nothing needs re-creating; Group B's remaining changes are the 9 modified files
listed by `git status`. **The exposure is live: another lane committing `-A` again would sweep this
lane's uncommitted `src/` work into its commit too.**

**2. `npm run test:qc` (the QC-rail browser probe) is at 81/88 — and all 7 failures PRE-DATE this work.**
Proved rather than assumed: `git show HEAD:app/src/screens/QcRail.jsx > app/src/screens/QcRail.jsx`,
re-ran, got **the identical 7 failures**, restored. They are the change log's `correctedWord`/
`undoneWord` (element not found, so both contrast checks and the words-not-colour check fail), the
loops tab's fallback sentence, and the picked-requirement Checks filter. **None touches a score
part.** Someone should own them; they are not Group B's, and Group B did not make them worse.
`npm run test:posting` is 26/26.

## Final state
- `cd app && npm test` -> **342 pass, 0 fail** (331 before this work; 11 new guards).
- `cd app && npm run build` -> clean.
- `npm run test:tally` -> **49/49**. `npm run test:posting` -> **26/26**. `npm run test:qc` -> 81/88 (pre-existing).
- QC step render byte-identical to the pre-change build.
- No smart quotes in any edited file (Python codepoint scan).
- **NOT committed, NOT pushed** — the parent commits.

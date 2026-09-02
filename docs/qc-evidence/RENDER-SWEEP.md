# RENDER SWEEP — what actually renders, measured against the DOM

**Started:** 2026-08-30 · **Branch:** `claude/incumbent-wins-swap` · **Base:** `44cf80a`
**Instrument:** `scripts/render-app.mjs` (real `app/dist`, real React, fixture-served `/api/**`) +
Playwright DOM queries against the live page. **Written incrementally** — if this file ends
mid-table, everything above the cut is measured and citable.

**Why:** `PROTOTYPE-COVERAGE.md` carries ~183 verdicts and several were reached by GREP.
`.claude/accuracy-log.md` records THREE false ABSENT claims, each a control that WAS built and
mounted from an imported component the grep never opened. Documentation is a proxy; the rendered
DOM is the ground truth.

**Rules applied on every row** (from the brief, each earned by a measured false failure):
1. PRESENT only from a live DOM query, never from source.
2. ABSENT is the heaviest claim — render in the state that should show it, read the mounting
   file's IMPORT LIST, grep repo-wide for alternate spellings (`&rarr;` vs `->`).
3. `document.body.innerText` EXCLUDES form field values — use `inputValue()`.
4. Never screenshot between counting a node and clicking it (detaches the node).
5. A short screenshot proves nothing — check image height vs page height.
6. OBSERVATION separated from INTERPRETATION.

---

## Status

| phase | state |
|---|---|
| fixtures acquired | **done** — `origin/ui-fixtures:raw-dump.json`, opp `9f9c370a-…` |
| 24 open rows measured | **done** — 24 of 24 |
| BUILT spot-checks | **done** — 21 rows, 5 steps |
| screenshots | **done** — `docs/qc-evidence/screens/` |

**Headline:** 8 open rows are stale and should be **BUILT**; 1 (`4.5-3`) is **worse** than recorded
and is a new defect; **0** of 21 BUILT rows were found falsely BUILT; **3 defects were found in the
measuring harnesses themselves**, each of which manufactures false ABSENTs (§C3). Two are fixed.

---

## Instrument, and its one limitation

**Fixture set:** built from `origin/ui-fixtures:raw-dump.json` (opp `9f9c370a-…`, Trinnex ·
Director of Digital Technology Operations & Innovation — 5 artifacts, 43 insertions, 21
requirements, 540 checks, 4 gates, 39 swaps, **0 corrections**) via
`node scripts/build-fixtures.mjs --raw /tmp/raw-dump.json --opp 9f9c370a-… --allow-thin`.

**The dump carries no `checkPrefs` row**, so `build-fixtures.mjs` refused to write (its
THIN-FIXTURE guard, correctly). The `/search-prefs`.`checks` object was patched in afterwards from
the API's OWN `DEFAULT_THRESHOLDS` (`api/dist/functions/tests/checks.js`, source
`api/src/functions/tests/checks.ts:142`) — `skillMaxChars: 24`, `relevantMaxChars: 20`, which are
the values `build-fixtures.mjs:99` records as confirmed live against `owner_search_prefs`. So the
rule labels render with real numbers, not nulls. **This is the API's seeded default, not a read of
the owner's live row** — stated rather than hidden.

**`0 corrections` in the dump is load-bearing** for rows 4.6-8, 4.8-8, 4.8-20 and 4.11-7, all of
which are about controls that hang off a correction row. Those are marked `NOT_TESTABLE` where the
control could not be brought on screen, never `ABSENT`.

**Harness change made (and why):** `scripts/render-app.mjs` gained an optional `--probe <file>`
argument. It already had `--count <selector>` (ONE selector) and `--click`, which cannot express
several selectors on one page, an `inputValue()` read, or a click chain that asserts between steps.
22 rows would otherwise have needed 22 separate ~12s renders or a fourth bespoke harness — the
brief forbids the latter. The addition is ~12 lines, opt-in, and every existing invocation is
byte-identical because `PROBE` is `''` unless passed.

---

## A. The 22 open rows

| row | claimed | RENDERED | evidence | screenshot |
|---|---|---|---|---|
| **4.1-5** per-tab count `n/m` | PARTIAL | **PARTIAL — confirmed** | 3 nodes at `[data-qc="jd-tab"]`, innerText `Responsibilities (12)` / `Requirements (9)` / `Keywords (21)`. Probed for `(n/m)`, and for the alternate spellings `n of m`, `n⁄m`, `n∕m` — **none matched** (`anySlashRatio:false`, `anyOfRatio:false`). OBSERVATION: a single total. INTERPRETATION: matches the recorded DELIBERATE reason at `PostingAnalysis.jsx:400-403`. | `screens/4.1-jd-step.png` |
| **4.1-10** sub-header `n/m evidenced` | PARTIAL | **PARTIAL — confirmed** | `[data-qc="group-count"]` → `12`; the sibling `[data-qc="kind-source-split"]` → `(12 from a posting section)`. Group head innerText: `Responsibilities \| 12 \| (12 from a posting section)`. No `n/m` anywhere in a group head (`anyRatioInGroupHead:false`). The word "evidenc*" IS on the page (per-row `evidenced — show the line`), so this is not a missing-word artefact — the **ratio** is what does not render. | `screens/4.1-jd-step.png` |
| **4.1-12** req chip in a 150–210px RIGHT column | PARTIAL | **PARTIAL — confirmed, with geometry** | Measured `getBoundingClientRect()` on 4 of 12 `[data-qc="req-row"]` at viewport 1440, row width 1010px. Chip (`RESP #0`): width **58px**, left offset **0**, top offset **10**. Quote: left offset **0**, top offset **32**. So `chipAboveQuote:true`, `sideBySide:false` on every sampled row. OBSERVATION: chip is a full-width-flow element above the line, 58px wide. INTERPRETATION: neither the right column nor the 150–210px width exists. | `screens/4.1-jd-step.png` |
| **4.2-2** card `n of m` BIG number | PARTIAL | **BUILT — doc is STALE** | 4 nodes at `[data-qc="compare-card"]`. Card innerText `SCOPE OF OWNERSHIP \| 5 \| of 5 \| Strong match`. `getComputedStyle` on the card's `<b>`: **`fontSize: 22px`**, `nextElementSibling.innerText: "of 5"` — three such cards (`5`/`of 5`, `2`/`of 4`, `1`/`of 6`). The 4th (`Certifications`, `not_applicable`) correctly prints `nothing to count on this dimension` and **no** number. OBSERVATION: the big `n of m` renders on the CARD, at 22px. INTERPRETATION: the claim *"survives only … inside each comparison row"* is out of date — it predates the `compare-cards` grid. **Re-verdict to BUILT.** ⚠ the comparison payload had to be supplied (see NOT_TESTABLE note below) — the *rendering* is real, the *data* was fixture-fed. | `screens/4.2-2-compare-card.png` |
| **4.3-12** `Open QC →` button | PARTIAL ("the modal does not link to it") | **BUILT — doc is STALE** | Opened the modal by clicking `[data-qc="match-estimate-button"]` (innerText `MATCH ESTIMATE \| 85 \| model estimate · keywords ↗`). Inside it: **1 node at `[data-qc="tally-open-qc"]`**, `tagName BUTTON`, `className px-btn`, innerText **`Open QC - every finding, per asset`**. `getByText(/open\s*qc/i)` → 1. Clicking it moved `location.hash` to **`#/packet/9f9c370a-…/qc`**. The modal offers 5 controls total: `✕`, `your master profile`, `Rebuild every asset from this posting`, `Go to the resume step`, `Open QC - every finding, per asset`. OBSERVATION: the QC link exists, is a real `px-btn`, and navigates. INTERPRETATION: the doc saw only `Go to the resume step` and concluded the QC link was absent; both are present. **Re-verdict to BUILT.** | `screens/4.3-12-open-qc-in-modal.png` |
| **4.3-13** any navigation out closes the modal first | PARTIAL ("needs a runtime check") | **BUILT — runtime check now DONE** | Behavioural, in this order and with no screenshot between the count and the click (rule 4): `[data-qc="tally-qc-summary"], [data-qc="keyword-tally"]` → **2 nodes before**. Clicked `Open QC - every finding, per asset`. → **0 nodes after**, `location.hash === '#/packet/9f9c370a-…/qc'`, and the QC step's own words (`Coverage`/`Checks`/`Swaps`/`Original vs final`) are on screen. OBSERVATION: the modal is gone from the DOM and the route advanced in the same interaction. INTERPRETATION: dismiss-before-navigate holds on the QC exit. Not separately exercised on `Go to the resume step` / `Rebuild every asset` — those share the same `Overlay` close path but were not clicked, so this row is proven for **one** of the three exits. | `screens/4.3-12-open-qc-in-modal.png` |
| **4.4-8** the three doc links are real **buttons**, `nowrap` | PARTIAL | **PARTIAL — confirmed, with computed styles** | `✓ Open Google Doc ↗` → `tagName A`, `className px-link`, `href` present, **`getComputedStyle().whiteSpace === "nowrap"`**. `⧉ Copy tracked link` → `tagName SPAN`, `role="button"`, `tabindex="0"`, `className px-link`, **`whiteSpace: nowrap`**. Neither carries `px-btn`. `Open Slides` NOT on this step — correct, not a gap: `PacketBuilder.jsx:245` picks the label from `docUrl.includes('/presentation/')` and the resume artifact's `docUrl` is a `/document/` URL. OBSERVATION: `nowrap` is applied on both; `px-btn` is not. INTERPRETATION: PARTIAL stands, and it is precisely the half `PacketBuilder.jsx:238-244` records as deliberately declined (converting a real `<a href target=_blank>` to a button would remove middle-click / open-in-new-tab). | `screens/4.4-resume-step.png` |
| **4.4-14** gate count deep-links `n to fix → <title>` | PARTIAL | **PARTIAL — confirmed BEHAVIOURALLY, not by reading** | 2 nodes at `[data-qc="gate-badge"]`: `Blocked \| 70 to fix \| 3 to review` and `Blocked \| 47 to fix`. Each is `tagName SPAN`, `role: null`, `tabindex: null`, **`getComputedStyle().cursor === "default"`**, `0` inner `button/[role=button]/a`. Clicked the first (force, no screenshot in between): `location.hash` unchanged, `body.innerText.length` unchanged (16248 → 16248), `[data-qc="gate-drawer"]` count `0 → 0`. OBSERVATION: the counts render; clicking one does nothing. INTERPRETATION: R5 ("every count deep-links") is unmet on the card badge — the doc's read of `PacketBuilder.jsx:184` mounting `GateBadge` without `onClick` is correct, and now also proven at runtime. | `screens/4.4-resume-step.png` |
| **4.4-24** expanded: `Must-haves` counter | PARTIAL — *"the per-kind split does not [render] … Needs per-kind denominators on `GET /…/requirements` (returns `total` only) — **an endpoint extension**"* | **BUILT — doc is STALE, and its stated blocker is FALSE** | Meter is `aria-expanded="false"` on load; clicked `[data-qc="blocks-answers-toggle"]` to open it (see the probe-bug note below). `[data-qc="blocks-stat"]` then returns **9 nodes**, including **`MUST-HAVES ANSWERED  0 of 7  required lines this asset cites`** (resume) and `1 of 7` (compact resume). OBSERVATION: the per-kind stat renders, with a real denominator. INTERPRETATION: no endpoint extension was ever needed — `meterModel` (`assetBlocks.js:905-910`) splits the requirement ROWS the payload already carries by their own `kind`, via `REQ_KIND_STATS` (`:873-877`). **Re-verdict to BUILT.** | `screens/4.4-24-per-kind-stats.png` |
| **4.4-25** expanded: `Responsibilities` counter | PARTIAL (same claim) | **BUILT — doc is STALE** | Same probe, same node set: **`RESPONSIBILITIES ANSWERED  0 of 12  responsibility lines this asset cites`**, on both assets. | `screens/4.4-24-per-kind-stats.png` |
| **4.4-26** expanded: `Nice-to-haves` counter | PARTIAL (same claim) | **BUILT — doc is STALE** | Same probe, same node set: **`NICE-TO-HAVES ANSWERED  0 of 2  preferred lines this asset cites`**, on both assets. Note the denominators reconcile: 7 + 12 + 2 = 21 = the `POSTING LINES PLACED  0 of 21` total on the same strip. | `screens/4.4-24-per-kind-stats.png` |
| **4.4-29** list row: `Go to field →` | PARTIAL | **PARTIAL — confirmed** | On the resume step: `[data-qc="qc-go-to-field"]` → **0**; `getByText(/go to (the )?field/i)` → **0**; `→` appears once on the page (`Next: Cover letter →`) and `->` zero times, so this is not an arrow-spelling miss. The nearest thing, `OPEN ON THIS FIELD` (8 nodes), was checked and is **`tagName DIV`, `className px-label`, no `role`, no `data-qc`, and no clickable ancestor within 5 levels** — a heading, not a control. `qc-go-to-field` is declared in `QC_HOOKS` and lives on the QC rail, which is where the deep links are driven from. OBSERVATION: no `Go to field` control on the asset header. INTERPRETATION: matches the doc — relocated to the rail, not absent from the product. | `screens/4.4-24-per-kind-stats.png` |
| **4.5-12** pick-list (`type:'select'`, checkboxes + per-item requirement) | ABSENT | **see §B — retested on PORTFOLIO** (row repeated below) | On the resume step: `input[type=checkbox]` → 0, `<select>` → 0, `[role=checkbox]` → 0, across 9 `[data-qc="blocks-field"]` nodes whose attributes are `data-qc-field` / `data-qc-static` / `data-qc-focused` only — **no `data-qc-shape` attribute is emitted at all**. The prototype makes this portfolio-only, so the resume result is not the test. | — |
| **4.6-8** keyword panel action `Put back "<original>"` | PARTIAL ("relocated, not absent") | **PARTIAL — confirmed** | 21 nodes at `[data-qc="blocks-keyword-chip"]`; clicked the first. `[data-qc="blocks-keyword-detail"]` → **1 node**, innerText `engineering execution \| proposed \| A model reading this posting proposed this keyword… \| Posting says: "Lead engineering execution across…" \| This field does not contain it, so there is nothing here to drop.` Its `button/a/select/[role=button]` set is **empty** — no `Put back` inside the panel (`/put back\|restore\|revert\|undo/i` against the panel's own innerText → **false**). Meanwhile on the same page `getByText(/put back/i)` → **17** and `[data-qc="blocks-restore-original"]` → **17** (`Put back "Digital Transformation"`, `Put back "Cloud Architecture"`, …). OBSERVATION: the capability renders 17 times, in the field margin, not in the keyword panel. INTERPRETATION: **relocated — the doc is right.** ⚠ CAVEAT: the chip I opened is one the field does not contain, so `keywordActions` is suppressed by the no-dead-UI rule; a chip whose field DOES contain the term is retested in §B. | `screens/4.6-8-keyword-panel.png` |
| **4.7-7** ask box confirms **in place** on send | PARTIAL — *"not evidenced by reading. **Needs a runtime check**"* | **BUILT — the runtime check is now DONE** | Clicked `[data-qc="blocks-ask-change"]` (9 on the page) → `[data-qc="blocks-ask-box"]` appears. Filled the textarea and read it back with **`inputValue()` → `"Shorten this to 55 words."`**, while `document.body.innerText` did **NOT** contain that string (`bodyTextContainsTyped: false`) — rule 3 demonstrated live, and the exact way this row would have been failed falsely. Clicked `[data-qc="blocks-ask-send"]`: `[data-qc="blocks-ask-sent"]` went **0 → 1**, innerText **`Sent. "Shorten this to 55 words." - the change will appear in this field's change log.` + `Dismiss`**, and the ask box closed (`blocks-ask-box` → 0). OBSERVATION: a distinct in-place confirmation line renders on success, in the field, naming what was sent. **Re-verdict to BUILT.** | `screens/4.6-8-keyword-panel.png` |
| **4.8-1** header: composite match | PARTIAL | **PARTIAL — confirmed** | `[data-qc="qc-headline"]` → 1 node, innerText **`No overall number was stored for this run.`**; regex for any digit in it → **`[]`** (no number at all). The rail header beside it reads `MATCH \| Resume only - there is no packet-wide score, and averaging the assets would invent one`. `[data-qc="qc-gate"]` → `Blocked`; `[data-qc="qc-counts"]` → `200 to fix \| 3 to review \| 1 never checked \| 0 corrected for you`. OBSERVATION: the headline slot renders and prints a refusal rather than a number. INTERPRETATION: exactly the "refuses to fabricate" divergence the doc records. PARTIAL stands. | `screens/4.8-qc-step.png` |
| **4.8-2** header: must-have coverage bars | PARTIAL — *"Component bars render at `QcRail.jsx:788-802` with `not measured` where a part has no source"* | **PARTIAL — but the doc's cited evidence does NOT render in this state** | `[data-qc="qc-score-component"]` → **0 nodes**. `not measured` does appear 4× but every occurrence was traced to a different node: one `<span data-qc="qc-coverage-count">` and three bare `<span class="px-small">` — **none is a score component**. OBSERVATION: no component bar renders on this packet. INTERPRETATION: `railHeadline` returned the no-score branch (`scoreEntry.result.score` is absent in this fixture), and the component bars are inside that same block, so they go with it. The verdict PARTIAL is right; the *reason* in the doc ("bars render") is not true here. Whether they render for a packet that HAS a stored score is `NOT_TESTABLE` on this fixture — the dump carries no score row. | `screens/4.8-qc-step.png` |
| **4.8-11** attention ordering fail → open → warn → fixed → soft | PARTIAL | **PARTIAL — confirmed, with the surface named** | `[data-qc="qc-decisions"]` → 1 node (`Needs a decision \| What the run could not settle on its own…`), `[data-qc="qc-decision-asset"]` → **5 nodes**, one per asset, each opening with its worst finding (`Resume \| Skill lines fit the template \| 5 \| Fix before approval …`). `[data-qc="qc-check"]` → **203 nodes**; their `data-qc-state` values in DOM order are `fail` for the first 40 read. OBSERVATION: severity grouping exists per asset, and the checks list is ordered fail-first, but there is no single page-level attention list rendering the full five-step order. INTERPRETATION: matches the doc. | `screens/4.8-qc-step.png` |
| **4.11-4** scope selector (This packet / This asset / My profile) | ABSENT (`check: absent … 'This packet'`) | **ABSENT — confirmed, but the doc's INSTRUMENT was wrong** | The single-file grep would have been a false negative in the other direction: **`[data-qc="assistant-scope"]` DOES exist in the rendered DOM.** Opened the panel via `[data-qc="assistant-open"]`; the node is `tagName DIV`, `class px-small`, innerText **`Open an asset first — a request has to name the document it changes.`**, and **`scopeControls` is `[]`** — zero `button/select/input/[role=button]/[role=tab]/[role=radio]/option` inside it. `<select>` on the page → 0, radios → 0, `[role=tablist\|radiogroup\|group]` → `[]`. Ground-truthed against the producer: `assistantScope()` (`assistantPanel.js:54-64`) returns a fixed **sentence** with exactly two branches and no choice. OBSERVATION: a scope *statement* renders; a scope *selector* does not exist. INTERPRETATION: ABSENT is the right verdict — reached here from the DOM plus the producing function, not from one grep for one string. | `screens/4.11-4-assistant-scope.png` |
| **4.8-8** done-for-you row: `Change it` | PARTIAL — *"a separate 'Change it' that seeds a rewrite request **is not there**"* | **BUILT — doc is STALE** | The dump carries 0 corrections, so a correction row was injected into the fixture in the endpoint's own shape (`appCorrections.ts:215` `{artifact_id, corrections:[…]}`, columns per `correctionRow` `assetGate.js:563-587`). `[data-qc="qc-correction"]` → 1 node, innerText `Corrected: " " rewritten as " " in Resume summary. \| ResumeSummary \| Review → \| why: a double space between two words \| the replacement was deterministic \| Undo \| Change it`. Its `button/a/[role=button]` set is exactly three: `Review →` (`data-qc="qc-correction-open"`), `Undo` (`data-qc="qc-correction-undo"`), **`Change it` (`data-qc="qc-correction-suggest"`)**. `getByText(/change it/i)` → 1. OBSERVATION: the control exists, with its own declared hook. INTERPRETATION: the doc enumerated two of the row's three controls. **Re-verdict to BUILT.** | `screens/4.9-12-gate-drawer.png` |
| **4.8-20** swaps: `Undo this` | PARTIAL | **PARTIAL — confirmed** | Clicked `[data-qc="qc-tab"][data-qc-tab="compare"]` (`Original vs final`); it became the active tab. The panel renders `What the tailoring pass changed \| Packet-level: one row here covers every asset built from this packet. 39 decision(s), 0 citing no line of the posting.` over a `Original / Final / What happened / Why` table with 39 rows. **The complete set of controls inside that panel is `["Ask why"]`** — one label, 39 nodes at `[data-qc="qc-ask-why"]`. Hunted every spelling on the whole page: `undo` → **0 occurrences**, `put back` → **0**, `undo this` → **false**. OBSERVATION: no per-swap undo on this tab. INTERPRETATION: matches the doc. (The doc's other half — *"correction undo exists"* — is separately confirmed above: `[data-qc="qc-correction-undo"]` → `Undo`, once a correction row exists.) | `screens/4.8-20-swaps-tab.png` |
| **4.9-12** drawer footer: `Ask for a change` | PARTIAL ("relocated") | **PARTIAL — confirmed** | Opened the drawer from `[data-qc="qc-correction-open"]` (`Review →`) — the drawer is mounted from `QcRail.jsx:938`, i.e. the **QC** step, not the asset step, which is why an earlier attempt on the resume step found nothing. `[data-qc="gate-drawer"]` → 1, `data-qc-tab="blocks"`, tabs `Blocks & provenance / Checks / Original vs final / Independent review / Match`. Its complete `button/a/select/[role=button]` set is **the five tabs and nothing else**; `/ask for a change/i` and `/list tweaks/i` against the drawer's whole innerText → **false, false**; `gate-run-checks` and `gate-approve` → absent on this tab. Meanwhile the equivalents render elsewhere: `[data-qc="blocks-ask-change"]` → 9 and `List Tweaks` → 11 on the resume step. OBSERVATION: no ask control in the drawer footer; the capability is on the field and the card. INTERPRETATION: relocated — matches the doc. | `screens/4.9-12-gate-drawer.png` |
| **4.11-7** Keep / Revert / Re-run QC on a reply | PARTIAL | **PARTIAL — confirmed** | Assistant panel opened; `[data-qc*="reply"\|"message"\|"turn"]` → **0** — there is no reply object in the DOM to hang controls on. The panel's complete control set is `Clear` and `Send` (`[data-qc="assistant-send"]`), and its own copy states the design: `Changes are saved as soon as they are made — there is nothing to approve afterwards.` and `Undo is per field, in the field itself, not from here.` `getByText(/^\s*keep\s*$/i)` → 0, `/re-?run/i` → 0, `/revert/i` → 1 (that sentence). The two capabilities the doc names DO exist elsewhere and were both seen: `[data-qc="qc-correction-undo"]` → `Undo`, and `[data-qc="gate-run-checks"]` is declared in `GATE_HOOKS`. OBSERVATION: the controls exist; a reply to attach them to does not. INTERPRETATION: matches the doc exactly. | `screens/4.11-4-assistant-scope.png` |
| **4.5-3** stacks below the breakpoint | PARTIAL — *"Stacking works … but the threshold is **700px**, not the spec's 1080"* | **PARTIAL, but the doc's DESCRIPTION IS WRONG — the wide layout never engages at all. ⚠ NEW DEFECT** | Measured `getComputedStyle(field).gridTemplateColumns` at **7 viewport widths** — 600 / 900 / 1000 / 1080 / 1200 / 1400 / 1600 — with the asset-card root at 522 / 501 / 601 / 681 / 801 / 1001 / 1010px. **Every one returned a SINGLE track** (`492px`, `471px`, `571px`, `651px`, `771px`, `971px`, `980px`). The two-column form (`minmax(0,1fr) 250px`, `AssetBlocks.jsx:1113`) never appeared. Also checked geometrically: the field's two children sit at the **same `left: 411`** with different `top` — stacked, not side by side. Then the decisive check — attached **an independent `ResizeObserver` to the very element the app observes** (`[data-qc="asset-blocks"]`): it reported `contentRect.width = 1001`, i.e. **≥ the 700 threshold** (`wouldBeWideAt700: true`), while the field grid stayed `971px`. OBSERVATION: the box is wide enough by the app's own rule and the wide layout still does not render. INTERPRETATION (**not proven**): `useWideRef`'s effect (`:170-178`, deps `[min]`) runs once on mount, when `AssetBlocks` has early-returned `Loading blocks...` (`:1195`) and `ref.current` is null, so the observer is never attached and `wide` stays `false`. A remount test (navigate to `cover` and back) did **not** flip it, so that mechanism is **unsupported by the one test I ran** — the symptom is measured, the cause is not. **Recommend raising as a defect: the 250px QC margin column is unreachable at any width.** | `screens/4.5-3-field-stacking.png` |
| **4.5-12** pick-list (`type:'select'`, checkboxes + per-item requirement) | ABSENT | **ABSENT — confirmed on the step the prototype actually puts it on** | Rendered the **portfolio** step (the prototype makes this portfolio-only, so the resume reading above was not the test). `input[type=checkbox]` → **0**, `<select>` → **[]**, `[role=checkbox]` → **0**, across **7** `[data-qc="blocks-field"]` nodes — every one with `data-qc-shape: null`. Then the guard against a spelling miss: enumerated **every distinct `data-qc-*` attribute NAME in the whole document** — `data-qc, -open, -type, -gate, -n, -field, -static, -focused, -sev, -keyword, -present, -seeded`. **There is no shape attribute under any spelling.** OBSERVATION: no pick-list shape renders anywhere. INTERPRETATION: matches `shapeOf()` (`assetBlocks.js:144-151`) returning only `static/pipe/list/prose`. ABSENT confirmed. | `screens/4.5-12-portfolio.png` |

**4.6-8 — the caveat above is now closed.** On the portfolio step I stepped through chips until one
was NOT action-suppressed: chip #4 rendered `[data-qc="blocks-keyword-actions"]` → 1 and
`[data-qc="blocks-keyword-drop"]` → 1. `/put back|restore/i` against that panel's innerText → still
**false**. So even where the panel DOES offer actions, `Put back` is not among them. **PARTIAL
stands, unconditionally.**

**4.4-8 — the `Open Slides ↗` branch, missing on resume, renders on portfolio**: `✓ Open Slides ↗`,
`tagName A`, `className px-link`, `whiteSpace: nowrap`. Same shape as the Doc link; still not
`px-btn`. Confirms the resume-step absence was the URL branch, not a gap.

---

## B. Spot-checks of rows currently marked BUILT

The sweep's value is symmetric: a row wrongly marked BUILT is worse than a stale open one, because
nobody is looking for it. **14 BUILT rows across 4 steps**, chosen because each verdict in
`PROTOTYPE-COVERAGE.md` cites a `file:line` — i.e. was reached by READING, not by rendering.

| row | claimed | RENDERED | evidence |
|---|---|---|---|
| 4.1-3 `See where each one is answered →` | BUILT | **BUILT — holds** | `[data-qc="jd-open-qc"]` → 1, innerText `See where each one is answered →` (the real `→`, U+2192 — the exact spelling that produced a false ABSENT in the accuracy log). `tagName SPAN`, `role="button"`, `tabindex="0"`. |
| 4.1-4 three-tab strip, one list at a time | BUILT | **BUILT — holds** | `[role="tablist"]` → 1; three `[data-qc="jd-tab"]` each `role="tab"`, `aria-selected` = `true/false/false`; `[data-qc="jd-tabpanel"]` → **1** (one list at a time, as claimed). |
| 4.1-11 posting line **verbatim** | BUILT | **BUILT — holds** | `[data-qc="req-quote"]` → `tagName BLOCKQUOTE`, innerText `Lead engineering execution across software products and client-facing projects`, and the row carries `The employer's words, characters 2,509-2,587`. |
| 4.1-13 competency spelled out beside the id | BUILT | **BUILT — holds** | First `[data-qc="req-row"]` innerText: `RESP #0 \| competency unassigned \| Lead engineering execution… \| The employer's words, characters 2,509-2,587`. The `\|\| 'competency unassigned'` fallback branch is the one that rendered. |
| 4.1-14 row status dot | BUILT | **BUILT — holds** | Inside the row, a `<span>` with `border-radius: 50%`, **`width: 7px`**, `background-color: rgb(100,116,139)` — the six-state `toneColor`, not a green/red pair, exactly as the doc says. |
| 4.1-15 `evidenced — show the line` | BUILT | **NOT_TESTABLE** | `[data-qc="req-evidence"]` → 12 expanders render, but `getByText(/show the line/i)` → 0 and `/no evidence found/i` → 0. The disclosure renders only when the endpoint verdict is `verified`, and this dump's requirement rows carry no evidence object. Fixture cannot reach the state — **not** an absence. |
| 4.1-29 model terms earn no score credit | BUILT | **BUILT — holds** | Required clicking the **Keywords** tab first (`aria-selected` `true,false,false` → `false,false,true`) — reading the default tab returns 0 keyword nodes, which is a probe error, not an absence. Then: `[data-qc="model-keywords"]` → 1, `Model-inferred words from this posting … they are excluded from ATS scoring …`; `getByText(/excluded from ATS scoring/i)` → 1; three `[data-qc="keyword-group"]` with `data-qc-group/claim` = `parsed/posting_only`, `from-run/posting_only`, `thin/profile_compared`. |
| 4.1-30 keyword list 2-up ≥ 1040px | BUILT | **BUILT — holds, measured** | At viewport **1400**: `[data-qc="keyword-columns"]` carries **`data-qc-cols="2"`** and `getComputedStyle().gridTemplateColumns` is **`493.5px 493.5px`** — two real tracks, not just an attribute. |
| 4.1-21…28 keyword library rows | DELIBERATE | **DELIBERATE — holds** | `[data-qc="keyword-library-state"]` → 1, innerText `Keyword coverage has not been read for this packet. No checks run has been loaded, so coverage is unknown - not zero. Absent evidence is not a pass.` — the state is rendered in words, not hardcoded. |
| 4.2-1 fit-card grid | BUILT | **BUILT — holds** | `[data-qc="compare-cards"]` → 1, containing the four dimension cards (see 4.2-2). |
| 4.2-13 `compare-open-qc` sibling route into QC | BUILT | **BUILT — holds** | `[data-qc="compare-open-qc"]` → 1, innerText `See how the assets answer these →`. |
| 4.4-3 card gate badge (`97 · 3 to review`) | BUILT — *changed from PARTIAL* | **BUILT — holds** | `[data-qc="gate-badge"]` innerText `Blocked \| 70 to fix \| 3 to review`, with the three sub-hooks all present inside it: `gate-word` → `Blocked`, `gate-to-fix` → `70 to fix`, `gate-to-review` → `3 to review`. |
| 4.4-11 `Approve` **disabled** when the gate fails | BUILT — *changed from ABSENT* | **BUILT — holds** | The `Approve` button's `.disabled` property is **`true`**, with `title="The checks block this asset - open QC to see what must be fixed."` The sibling `Regenerate` is `disabled: false` on the same card, so this is a real conditional, not a blanket disable. |
| 4.4-13 asset-level `Ask for a change` | BUILT — *changed from ABSENT* | **BUILT — holds** | `List Tweaks` renders 11× across two distinct hooks — 9 at `[data-qc="blocks-ask-change"]` (per field) and **2 at `[data-qc="packet-asset-ask"]`** (per asset). The asset-level one exists as its own control, not just the field one. |
| 4.6-5 panel: `Posting says "…"` | BUILT | **BUILT — holds** | `[data-qc="blocks-posting-quote"]` → `Posting says: "high-performing engineering culture"`. |
| 4.6-9 `Swap for another skill…` from the skill bank | BUILT — *re-verdicted 2026-08-27 from ABSENT* | **BUILT — holds, and this is the one most worth having checked** | Needed two preconditions the earlier probes did not meet: a `/skill-bank` fixture (the endpoint was in `unmatched` and falling through to `{}`), and a chip whose field actually CONTAINS the term (`keywordSwapOptions` returns a reason, not a control, otherwise). With both met, chip #4 on the portfolio step renders **`tagName SELECT`, `data-qc="blocks-keyword-swap"`**, options `["Swap for another skill…", "Platform Modernisation — engineering", "Vendor Governance — operations", "Data Platform Strategy — data"]` — a real select, populated from the bank, with the row's own placeholder wording. |
| 4.6-10 `Drop it, leave the line open` | BUILT — *changed from ABSENT* | **BUILT — holds** | Same chip: `[data-qc="blocks-keyword-drop"]` → `Ask to drop it from this field`, alongside `[data-qc="blocks-keyword-actions"]` → 1. On the 20 other chips the control is correctly **absent** and replaced by the reason `This field does not contain it, so there is nothing here to drop.` — the no-dead-UI rule, observed rather than assumed. |
| 4.7-8 forwards to the assistant | BUILT — *changed from ABSENT* | **BUILT — holds** | `[data-qc="blocks-forward-assistant"]` → **9 nodes**, innerText `Ask the assistant`, one per field, rendered beside (not instead of) the field's own `List Tweaks`. |
| 4.11-5 `Put back an original` | BUILT | **BUILT — holds** | `[data-qc="blocks-restore-original"]` → **17 nodes**, e.g. `Put back "Digital Transformation"` — one per real dropped candidate, naming the term. |
| 4.11-6 `Shorten to fit` | BUILT | **BUILT — holds** | `[data-qc="blocks-shorten-to-fit"]` → `Shorten to fit`. |
| §4.10 review & send gate list | BUILT | **BUILT — holds** | The `send` step renders a per-asset gate list (`Resume Blocked 70 to fix 3 to review` … `Intro video Not checked todo`), the reconciled total **`112 items to fix across 5 assets`**, and the sentence `Sending stays locked until each one is fixed or the decision is recorded.` **No send control renders while blocked** — correct, and consistent with the no-dead-UI rule rather than a missing button. |

**Result of the BUILT sweep: 21 rows checked across 5 steps (jd, resume, portfolio, video, send).
20 hold. 1 is `NOT_TESTABLE` on this fixture (4.1-15). ZERO were found to be falsely BUILT.**
Every step rendered with `pageErrors: []` and no `unmatched` API call once the two missing fixtures
(`/skill-bank`, `/config/templates`) were supplied.

---

## C. What the sweep changes

### C1. Seven rows are STALE — six understate what is built, one overstates it

| row | doc says | DOM says |
|---|---|---|
| 4.2-2 | PARTIAL — *"survives only … inside each comparison row"* | **BUILT** — a 22px big number on the card |
| 4.3-12 | PARTIAL — *"the modal does not link to it"* | **BUILT** — `tally-open-qc`, and it navigates |
| 4.3-13 | PARTIAL — *"needs a runtime check"* | **BUILT** — modal 2 nodes → 0, route advanced |
| 4.4-24 | PARTIAL — *"needs … an endpoint extension"* | **BUILT** — `MUST-HAVES ANSWERED 0 of 7` |
| 4.4-25 | PARTIAL — same | **BUILT** — `RESPONSIBILITIES ANSWERED 0 of 12` |
| 4.4-26 | PARTIAL — same | **BUILT** — `NICE-TO-HAVES ANSWERED 0 of 2` |
| 4.7-7 | PARTIAL — *"needs a runtime check"* | **BUILT** — `Sent. "…" - the change will appear in this field's change log.` |
| 4.8-8 | PARTIAL — *"a separate 'Change it' … is not there"* | **BUILT** — `qc-correction-suggest` → `Change it` |
| 4.5-3 | PARTIAL — *"stacking works … threshold is 700px"* | **the wide layout never engages at all — new defect** |

That is **8 rows re-verdicted to BUILT** and **1 that is worse than recorded**. Two of the eight
carried a stated *blocker* — an endpoint extension for 4.4-24/25/26 — which does not exist: the
client splits the rows it already receives.

### C2. NOT_TESTABLE on this fixture — stated, never called ABSENT

| row / check | why the state could not be reached |
|---|---|
| 4.1-15 `evidenced — show the line` | the disclosure renders only for endpoint verdict `verified`; the dump's requirement rows carry no evidence object |
| 4.8-2 score component bars | `railHeadline` took the no-score branch — the dump carries no stored score row, so whether the bars render for a scored packet is untested |
| 4.2-2 (data half) | the dump has no `dimension` rows; the comparison payload was supplied in `comparisonPayload`'s own shape (`appDimensions.ts:254-265`). The RENDER is real; the DATA was fixture-fed |
| 4.8-8 (data half) | the dump has 0 corrections; one row was injected in `appCorrections.ts:215`'s shape |
| 4.6-9 (data half) | `/skill-bank` was unfixtured; 3 entries supplied in `useSkillBank`'s shape (`{entries:[{label,category}]}`) |

### C3. THREE defects in the measuring instruments — each one silently manufactures a false ABSENT

These matter more than any single row, because they were **already** corrupting measurements taken
with these harnesses, in the direction of "the app is missing things".

1. **`build-fixtures.mjs` passed artifacts through in `snake_case`** while the real endpoint shapes
   them (`appPackets.ts:207` → `docUrl`, `driveUrl`, `templateId`, `updatedAt`). `PacketBuilder.jsx:236`
   gates the whole doc-link row on `a.docUrl`, so **SPEC 4.4-5 / 4.4-6 / 4.4-7 / 4.4-8 all read as
   not-rendered** against a fixture holding a perfectly good `doc_url`. **Fixed** (`artifactShape`,
   with the trap written up in the file's own trap list).
2. **`build-fixtures.mjs` omitted `requirements.total`.** `meterModel` (`assetBlocks.js:883`) gates
   its entire measured branch on `Number.isFinite(Number(requirements.total))`, so the fixture made
   the app print *"This posting has no requirement rows yet … unknown - not zero"* for 21 real rows,
   and took **4.4-24/25/26 down with it**. This is exactly how those three came to be recorded as
   needing an endpoint extension. **Fixed** (`total` + `located`, derived as the endpoint derives them).
3. **`--full` screenshots capture only the fold.** The app scrolls in an inner `.ee-scrollpane`
   (`scrollHeight 3391` vs `clientHeight 1645`) while `document.documentElement.scrollHeight` is
   `1708`, so Playwright's `fullPage: true` returns a viewport-height image and everything below the
   fold is invisible in the evidence. **Not a code change — use `--h 3600`.** Every screenshot in
   this sweep was taken that way; the two captured before this was found were re-taken.

A fourth, smaller: `/api/config/templates` and `/api/app/skill-bank` fall through to `{}` and are
reported in `unmatched`. `render-app.mjs` reports them honestly — but an agent that does not read
that array measures 4.6-9 as absent, which is what happened here on the first pass.

### C4. Harness change made for this pass

`scripts/render-app.mjs` gained an optional **`--probe <file>`** (a module default-exporting
`async (page) => any`, whose return value is printed as `probe`). `--count` takes one selector and
`--click` one click; neither can express several selectors on one page, an `inputValue()` read, or
a click chain that asserts between steps. Opt-in, ~12 lines, every existing invocation unchanged.

### C5. Probe errors caught during the sweep, recorded so the next pass does not repeat them

- **Clicking `[data-qc="blocks-toggle"]` to "expand" the asset cards COLLAPSED them** — they ship
  open (`Hide blocks`, `aria-expanded="true"`). The first run then reported `blocks-stat` → 0 and
  would have written a false ABSENT for 4.4-24/25/26. **Read `aria-expanded`; never click blindly.**
  The `blocks-answers-toggle` meter beside it genuinely *is* `false` and *does* need a click — the
  two toggles on the same card have opposite defaults.
- **The JD step shows one list at a time.** Probing `[data-qc="model-keywords"]` on the default
  (Responsibilities) tab returns 0. Click the Keywords tab first.
- **The assistant panel overlays the QC tab strip**, so a probe that opens the assistant and then
  clicks a tab times out with `waiting for element to be visible`. Run them as separate passes.
- **The gate drawer is mounted from `QcRail.jsx:938`** — the QC step, not the asset step. Hunting
  it on the resume step finds nothing and means nothing.

---

## D. Reproducing this

```bash
git show origin/ui-fixtures:raw-dump.json > /tmp/raw-dump.json
node scripts/build-fixtures.mjs --raw /tmp/raw-dump.json \
     --opp 9f9c370a-4ac9-441e-b58e-02e3ffcf669e --out /tmp/fx.json --allow-thin
# then patch in what the dump does not carry (thresholds, comparison, corrections, skill bank)
cd app && npm run build && cd ..
node scripts/render-app.mjs --route '#/packet/9f9c370a-…/resume' \
     --fixtures /tmp/fx.json --h 3600 --probe <probe.mjs> --out shot.png
```

`--h 3600` rather than `--full`: see §C3.3. `--allow-thin` is required only because the dump has no
`checkPrefs` row; if `fixture-refresh.yml` is re-run to include one, drop the flag.

**Every verdict above cites the selector queried and the text returned.** Where a control could not
be brought on screen the row says `NOT_TESTABLE` and why — no row in this document was called
ABSENT from a grep.

**Files written by this pass:** this file, `docs/qc-evidence/screens/*`, and two harness fixes with
their reasons written into the scripts (`scripts/build-fixtures.mjs` traps 3 and 4,
`scripts/render-app.mjs` `--probe`). Nothing under `app/src` or `api/` was modified.

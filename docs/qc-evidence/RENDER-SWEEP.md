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
| fixtures acquired | in progress |
| 22 open rows | not started |
| BUILT spot-checks | not started |

_(rows appended below as each is measured)_

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

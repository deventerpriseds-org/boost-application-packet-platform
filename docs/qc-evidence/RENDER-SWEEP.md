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

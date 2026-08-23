# Triage — `portfolio`

Register section: `docs/qc-evidence/UI-GAP-REGISTER.md:191`. Triage was read-only against app source.
(Written by the parent session: this agent ran without a Write tool and returned its content.)

## Summary

| Class | Count |
| --- | --- |
| DEMO-DATA | 6 |
| STRUCTURAL | 5 |
| BLOCKED-ON-DATA | 20 |
| **Total** | **31** (27 register rows + 4 prototype-only controls) |

**The headline accounting fact: 16 of the 20 BLOCKED-ON-DATA rows are already implemented in the
app and simply had nothing to render.** The captured portfolio artifact carried no `insertion` rows,
so `latestRows()` (`assetBlocks.js:174`) returned nothing and every per-field panel was absent. The
single largest unblocking action for this step is getting a portfolio artifact WITH insertion rows
(and requirement attribution) into the captured run — not UI work at all.

**DEMO-DATA (6):** `SafetyIQ · Head of Engineering` · `fail` · `3 corrected` ·
`Platform Modernization` · `sixty-two engineers` · `eight figures`.

## STRUCTURAL, highest value first

1. **`From profile`** — `app/src/assetBlocks.js` `METHOD_LABEL`. Highest value because closing it
   also resolves a **live contradiction**: `assetBlocks.js:162` maps `template_fill` →
   `'written for this posting'` while `assetGate.js:176` maps the SAME key →
   `'filled straight from the package'`. The same row is described two different ways depending on
   which screen you are on. The prototype's two states (`assets.jsx:421`,
   `{s.edited ? 'Written for this posting' : 'From profile'}`) are exactly these two ideas.
   **Reconcile the duplicate into one table — do not introduce a third.**
2. **`M1–M5`** — add a requirement legend beside `ReqChip` (`AssetBlocks.jsx:129`), extending
   `KIND_ABBR` / `KIND_WORD` (`assetBlocks.js:157-158`). The app renders the chips but never explains
   them, so `M3` is an opaque token on **every** asset step, not just portfolio. One fix, four steps.
3. **`D1–D4`** — same legend. Also settles a **three-way abbreviation split**: prototype `M/D/N`,
   `assetBlocks.js` `M/N/R`, `postingAnalysis.js:161` `MH/NTH/RESP`. By the precedence rule the
   prototype's `D` wins for the chip prefix, but `R` is already live — **owner call, not a silent
   flip.**
4. **`N1–N3`** — same legend; already agrees on the letter, so it comes free with (2) and (3).
5. **`Changes made`** — a heading/copy decision only. The app already renders this exact content
   (per-field figure rewrites with Undo and "Ask for a change") under the design's *other* heading,
   "Corrected for you", via `BLOCK_HOOKS.fieldChangeLog`. **Do not build a second correction list.**

## The four genuinely sourceless items

Everything else blocked is waiting on data that exists in principle. These four have no source at all:

- **`Keywords placed`** — `term_library_entry` has zero published scoreable rows (the same reason
  `appChecks.ts` leaves `keyword_coverage` null), AND there is no per-insertion term-placement
  record. Two things must exist first.
- **`Skills shown on the deck`** — prototype section `P6` has `field: null` and sixteen skill chips
  with `selected` flags. No merge field ⇒ no insertion row ⇒ nothing to hang it on. Needs a source
  for the chip set and a per-packet record of which are on the deck.
- **`Slide layouts, case studies, title art`** — section `P7`, also `field: null`. Would need a deck
  template manifest (slide order, which merge field lands on which slide). Nothing on the API side
  describes the Slides template's structure; `PacketBuilder.jsx:173` only knows how to *create* it.
- **The prose rule qualifiers `", past tense"` and `'begins "My career"'`** — `checks.ts` word rules
  carry only `[lo, hi]`, and `checkPrefs.ts` has no style/tense/opener column. Printing them as
  literals would **state a contract the gate does not enforce**, which is the vacuous-green failure
  in a different costume. A check-pref (and the check) must exist first.

## Notes

- `48 words · 45–48 words`: the range half already renders and the threshold-is-authoritative
  question is settled (`targetFor()`); only the `, past tense` qualifier is blocked.
- `5 selected, 98–125 words`: the range and the item count already render. The word **"selected"** is
  the blocked part — it asserts these five were *chosen from a pool*, and no app table records the
  candidate pool or the selected/unselected state.
- `Company, date, letter body`: the app renders three separate blocks where the prototype renders one
  composite slot. That is a prototype layout choice, not a data requirement — a defensible difference.
- The controls `Open Slides ↗`, `Copy tracked link` and `Ask for a change` are all **already
  implemented verbatim** (`PacketBuilder.jsx:151-158`, `AssetBlocks.jsx:409-413`) and gated on data.

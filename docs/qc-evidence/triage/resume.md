# Triage — `resume` step

Register section: `docs/qc-evidence/UI-GAP-REGISTER.md` § `### \`resume\`` (61 panels / 4 controls).
Prototype is behavioural ground truth. Triage was read-only against app source.
(Written by the parent session: this agent ran without a Write tool and returned its content.)

Not re-reported as missing (already built): inline "Corrected for you", per-field "Ask for a change"
box, the collapsed "What this <asset> answers" meter, `FIELD_ORDER`, `targetFor()` thresholds.

## Summary

| Class | Count |
|---|---:|
| DEMO-DATA | 27 |
| STRUCTURAL | 14 |
| BLOCKED-ON-DATA | 3 |
| register artefact (`…and 21 more`) | 1 |
| **total entries** | **45** |

Of the 14 STRUCTURAL rows, **5 are already satisfied in the app** (`fail`, the `3 to review` counterpart
surface, `Changes made`, `Open Google Doc ↗`, and the per-field half of `Ask for a change`) and **6 more
collapse into 2 real fixes** (the five observed-measurement rows are one change; `kept` folds into the
wording panel).

## The genuine remaining work — five items

1. **`56 words · 55–60 words` — the resume summary's word contract. THE BIGGEST REAL HOLE IN THE STEP.**
   `api/src/functions/tests/checks.ts` `WORD_RULES` (:477) and `CheckThresholds` (:54) carry bands for
   every portfolio and cover field but **none for `ResumeSummary`**. So the 55–60 word contract that
   `docs/qc-evidence/qc/data.js:9` records as verbatim from prompt 16 is **neither displayed nor
   checked anywhere in the app** — the resume's headline field is the only prose field in the packet
   with no stated *and* no enforced length contract.
   `targetFor()` correctly returns null rather than guessing — **the fix is the missing threshold,
   not a literal.** Add it to `CheckThresholds`/`DEFAULT_THRESHOLDS`, a `chk_*` column in
   `checkPrefs.ts`, and `WORD_RULES`; then the `RANGE` entry in `targetFor()` follows.
   Highest value: it is the field a reader reads first.

2. **State each field's measurement in its rule's own unit** — `longest 22 chars`, `longest 23 chars`,
   `0 over 20 chars`, `1 over 20 chars`, `6 × 5 words`. One change to `targetFor()`
   (`assetBlocks.js:466`) plus the measurement span (`AssetBlocks.jsx:353-364`).
   **Today the app states a char rule and measures in words**, so the two halves of the line do not
   answer each other: "8 lines - 16 words · ≤ 24 chars each" never tells the reader whether the field
   passes. Cheapest correctness fix in the step; closes five register rows at once.
   Note `expertisePhrases` also has no threshold — "6 phrases" has no owner-settable source and
   `expertise_phrase_length` never checks the count.

3. **`Wording kept from the posting` (+ its `kept` status).** **NOT blocked on data** —
   `checks.ts:425-434` already emits `posting_wording_kept` as a `warn` with offenders shaped
   `` `${field}: "${phrase}"` ``, i.e. field-prefixed and therefore resolvable by the existing
   `sectionIdForOffender()` (`qcRail.js:378`). The payload is already fetched by
   `useArtifactCorrections`. Render it in the field margin and give it a `CHECK_LABEL` entry
   (`assetGate.js:114` has none, so it degrades to "posting wording kept").
   This is a judgement the writer makes beside their own sentence — which is why the prototype puts
   it in the margin rather than the QC tab.

4. **`4 corrected` on the collapsed "What this resume answers" row.** Extend `meterModel()` with the
   count from `correctionsState(result).count` (`assetGate.js:385`), which this component already
   fetches via `railChangeLog`. Use the existing `SEV_LABEL.fixed` — do not mint a second word.

5. **The asset-level `Ask for a change` button.** The prototype has TWO controls with this label: a
   per-field one (built) and a **per-asset** one on the artifact card (`packet.jsx:257`) that seeds
   the assistant with `In the resume: `. Extend the `PacketBuilder.jsx` artifact card reusing
   `api.aiEditArtifact` **without** a `section`. Do not build a new edit path.

## BLOCKED-ON-DATA (3)

- **`Keywords placed`** — `term_library_entry` has zero published scoreable rows (db-query run
  32327554276) and there is no per-asset term-placement endpoint. Same root cause as
  `keyword_coverage` being null. Already recorded in the register's "Known blocked" section.
- **`Posting lines answered`** — the label ALREADY EXISTS (`AssetBlocks.jsx:473-482`, fed by
  `reqsForRow()`). It renders only when the insertion row carries a `requirement_id`. Its absence in
  the capture is an empty-data condition in the fixture, **not a missing panel.**
- **`Answer`** — needs per-artifact open questions carrying the merge field/requirement they attach
  to plus the question text. `facts_needed` offenders are the plausible seed but are phrased as check
  offenders, not questions with an `ask`, and nothing records the answer. This is the same
  `open`/'Needs your answer' gap `assetGate.js:85-88` already records as deliberately absent.

## MEASUREMENT ARTEFACTS — the register overstates the control count

**Three of the four "controls only in the prototype" are matcher artifacts, not gaps.**
`compare-ui.mjs:102` collects only `button, [role="button"], a`, and the app renders these as
`span.px-link` and/or with a leading `✓`/`⎘` glyph:

- `Open Google Doc ↗` — exists at `PacketBuilder.jsx:154`, reported missing only for the `✓ ` prefix.
- `Copy tracked link` — exists at `PacketBuilder.jsx:156-159`, but as a bare `<span>`. **The real
  defect here is accessibility, not absence:** a click target that is a bare span has no role and no
  keyboard path. Give it `role="button"` + `tabIndex`, as `GateBadge` and the meter toggle already do.
- The per-field `Ask for a change` — same span mechanism.

Fixing the two spans closes real accessibility defects AND stops the register reporting phantom gaps.

## Note on `…and 21 more`

A register truncation marker, not a finding. The unlisted panels are almost certainly the remaining
`SKILL_ROWS` orig/final pairs, the R8/R9 static work-history and header text (`data.js:184-191`), and
further `Rule` observed/target strings. Regenerate with `--json` to enumerate before assuming any are
structural; nothing in the visible tail suggests a new panel type.

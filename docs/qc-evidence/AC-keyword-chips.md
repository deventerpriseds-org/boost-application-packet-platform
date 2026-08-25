# AC — Row 11: proposed ATS keyword chips in the resume field margin

**Status:** COMPLETE — all six sections written. No code was written; this is an AC pass only.
**Author:** cold AC pass. I did not plan this work and did not accept any claim in the brief without
re-running its proof.
**Date:** 2026-08-25.

Order of this document, per CLAUDE.md "Feasibility BEFORE implementation":
1. The challenged feasibility table (this comes FIRST — before any AC)
2. The tier split
3. Numbered binary ACs
4. Mutation proof per guard
5. Open questions the owner must answer

---

## 1. Feasibility table — CHALLENGED

I re-ran every proof in the brief. **Two of the three claims are right in verdict but wrong in the
evidence they cite**, and one is wrong in a way that changes the design. Details per row.

### Row 1 — `model_keyword` reaches the asset step

**Brief claimed:** EXISTS. Evidence `requirements.ts:408` writes it; `appRequirements.ts:413`
selects it; `AssetBlocks.jsx:864` builds `reqById`.

**My verdict: EXISTS — confirmed end to end.** But **the cited evidence is wrong at the middle
link, and the middle link is the one that could have failed.**

`appRequirements.ts:413` is NOT a select. It is the *values array of the INSERT* inside
`persistRequirements`:

```
408      `insert into requirement
409         (opp_id, seq, item_text, verbatim, char_start, char_end, match_method, kind, kind_source,
410          model_keyword, competency, coverage, weight, source_category, jd_source, jd_text_sha256,
...
413       [opp.id, i, r.item_text, r.verbatim, r.char_start, r.char_end, r.match_method, r.kind,
414        r.kind_source, r.model_keyword, ...
```

So the brief cited the **write path twice** and never proved the read path at all. Citing a producer
as if it were a consumer is exactly the failure mode the feasibility rule exists to stop — it would
have passed review while the actual question (does the column survive the API projection?) went
unasked.

**The read path, traced by me, is four hops and every one of them had to hold:**

| # | Hop | File:line | Why it could have failed |
|---|---|---|---|
| 1 | `select r.*` from `requirement` | `appRequirements.ts:454` | A column list instead of `r.*` would have dropped it silently |
| 2 | `loadRequirementsWithEvidence` → `shapeRequirementsForApi(rows, records)` | `appRequirements.ts:678`, `:694` | This is a **projection**. It builds an explicit object literal. |
| 3 | `rows.map((r) => ({ ...r, evidenced: …, evidence: …, … }))` | `appRequirements.ts:633-634` | **The `...r` spread is what saves it.** Every other provenance field in that literal is named explicitly; `model_keyword` survives only because the spread is there. Anyone who "tidies" that spread into an explicit allowlist breaks this row and no test would say so today. |
| 4 | `GET /app/opportunity/{id}/requirements` → `api.oppRequirements` → `useAssetProvenance` → `reqById` | `appRequirements.ts:950`, `api.js:173`, `AssetBlocks.jsx:59-77`, `:864` | `reqById` is keyed on `r.id`, so a chip can resolve a keyword back to its requirement row |

**Also confirmed (relevant, and the brief did not mention it):** `verifyRequirementRows`
(`appRequirements.ts:632`) redacts a stale row by **nulling every key whose name starts with
`evidence_`**. `model_keyword` is not `evidence_`-prefixed, so **it survives redaction**. That is
correct here (a proposed keyword is not an evidence claim) but it must be stated, because it means a
chip can render beside a requirement whose evidence has been withdrawn.

**Proof commands I ran:**
```
grep -rn "model_keyword" api/src app/src --include=*.ts --include=*.jsx --include=*.js
sed -n '448,500p' api/src/functions/tests/appRequirements.ts     # the real SELECT: `select r.*`
grep -n "function shapeRequirementsForApi" -A 60 api/src/functions/tests/appRequirements.ts
sed -n '51,80p' app/src/screens/AssetBlocks.jsx                  # useAssetProvenance
```

**Consequence for the ACs:** hop 3 is a load-bearing spread with no guard. That earns a guard of its
own (see AC-G1), independent of anything to do with chips.

---

### Row 2 — per-field keyword placement

**Brief claimed:** EXISTS-BUT-CONSTRAINED — "nothing STORES it, but exact occurrence is computable
client-side". Evidence: the `appChecks.ts:136` comment "Nothing in the product counts per-asset term
placement yet".

**My verdict: the brief is HALF WRONG, and the half it gets wrong is the half the whole feature
rests on. Correct verdict: EXISTS-BUT-CONSTRAINED — but for a different reason, and far more of it
is already built than the brief says.**

**First, the evidence is inadmissible as cited.** CLAUDE.md is explicit: *"a code comment describing
a limitation — that is a claim about the code, not the code."* `appChecks.ts:136` is a comment. I
swept the tables instead.

**What the sweep found — the CLAIM half is fully stored and already resolved per field:**

`insertion` (`schema.ts:576-593`) — one row per artifact per merge field per loop — carries:

```
  requirement_id uuid references requirement(id) on delete set null,
```

and `requirement` carries `model_keyword` (Row 1). `swap_decision` (`schema.ts:534-545`) carries the
same `requirement_id` for the five list fields. So **"which keywords does this field claim" is a
stored, per-field fact today.**

More than that — **the resolver is already written and already shipping**:

```
app/src/assetBlocks.js:276   export function reqsForRow(row, scopedSwaps, reqById) {
app/src/assetBlocks.js:277     const ids = [row && row.requirement_id]
app/src/assetBlocks.js:278     if (row && row.list) for (const s of scopedSwaps || []) if (s.list === row.list && s.requirement_id) ids.push(s.requirement_id)
```

`reqsForRow` already returns the exact `requirement` rows for one field (direct + via list swaps),
deduped and seq-ordered. It is already called at `AssetBlocks.jsx:944` and already rendered as the
`Posting lines answered` chips at `AssetBlocks.jsx:769`.

**Therefore the proposed-keyword set for a field is a one-line derivation off a function that
already ships:**

```js
reqsForRow(row, scopedSwaps, reqById).map(r => r.model_keyword).filter(Boolean)
```

No new table. No new endpoint. No API change (the insertions GET already returns `i.*` including
`requirement_id` — `appInsertions.ts:127`; and `reqById` already carries `model_keyword`).

**This is the "already 90% built" outcome, and the brief invited me to say so loudly. Saying it:
the data layer for `Keywords placed` chips is DONE. What is missing is a derivation and a render,
not a store.**

**What is genuinely ABSENT — and this is the real constraint:** nothing stores whether the field's
TEXT contains the keyword. That is the PLACEMENT half, and it is computable client-side from
`row.after_text` — but only with a matcher that does not lie. See the next finding.

**Proof commands I ran:**
```
grep -rniE "covering_keyword|covered_kw|keyword_placed|placed_keyword|keyword_placement" api/src app/src
sed -n '560,600p' api/src/functions/tests/schema.ts          # insertion.requirement_id
sed -n '534,546p' api/src/functions/tests/schema.ts          # swap_decision.requirement_id
grep -rn "function reqsForRow" -A 15 app/src/assetBlocks.js
grep -rn "insertionsGet" -A 20 api/src/functions/tests/appInsertions.ts   # `select i.*`
```

**Ruled out as a source (checked, so nobody re-checks it):** `packet.covered_kw`
(`schema.ts:88`). It is PACKET-level, not per-field, and `appPackets.ts:182` records it as a
misnomer — it holds terms the JD-analysis model call emitted, not terms anything verified as
placed. It must not be used here.

---

### FINDING F1 — `markRuns` is NOT whole-phrase, and short keywords break it (MEASURED)

This is not in the brief's table and it is the single most important technical fact in this
document.

The brief instructs: *"`markRuns()` is the ONE existing exact matcher … EXTEND it, do not write a
second matcher."* The instruction is right. **But `markRuns` is not the exact matcher its own
docstring says it is.**

`app/src/highlight.js:71-74` claims:

> *"EXACT, WHOLE-PHRASE, CASE-INSENSITIVE — never fuzzy. A highlight is an ACCUSATION … A near-miss
> here would paint the writer's own sentence as borrowed."*

The implementation is a bare case-insensitive **substring** scan — `lower.indexOf(needle, from)`
(`highlight.js:105`) with no word-boundary test anywhere. I ran it:

```
node -e "import('./app/src/highlight.js').then(m => …)"

["AI"]          on 'Led a team that said the detail was available.'
                => "ai" <- AI | "ai" <- AI | "ai" <- AI        ← s(ai)d, det(ai)l, av(ai)lable
["ML","AI"]     on 'Built HTML dashboards and maintained the chain.'
                => "ML" <- ML | "ai" <- AI | "ai" <- AI | "ai" <- AI   ← HT(ML), m(ai)nt…, ch(ai)n
["Java"]        on 'We use JavaScript heavily.'
                => "Java" <- Java                              ← Java ≠ JavaScript. ATS-material.
["Scale"]       on 'Scaled the platform.'
                => "Scale" <- Scale                            ← uncontrolled stem
```

**Why this has never bitten:** the only current caller (`Marked`, `AssetBlocks.jsx:444`) passes
posting-echo phrases, which D4 defines as **8-token contiguous runs**
(`CheckThresholds.wordingRunTokens`). A needle that long cannot collide. The `needle.length > 1`
filter (`highlight.js:96`) drops single characters, so `R` and `C` are safe by accident. Everything
of length ≥ 2 is not.

**ATS keywords are exactly the short needles this breaks on** — `AI`, `ML`, `BI`, `QA`, `UX`, `Go`,
`Java`. Painting `said` yellow as a placed keyword is a false accusation, and it is the precise
thing CLAUDE.md's *"fuzzy matching is for RANKING, never for ACCUSING"* rule forbids. A substring
match is not fuzzy in the similarity sense, but it is **over-broad in the accusing sense**, which is
the same defect wearing a different coat.

**Consequence for the design: "extend `markRuns`" means adding a WHOLE-WORD mode to it, not merely
calling it with `'keyword'`.** Calling it as-is would ship the false accusation. This is a
prerequisite of every AC below that asserts a term IS present, and it is the first thing to build.

`termMatch.ts`'s `matchesEntry` is NOT the fix — see Row 3.

---

### Row 3 — `≈` match quality (reworded vs copied)

**Brief claimed:** ABSENT — no source. Evidence: `matchesEntry` (`termMatch.ts:71`) is API-side only
and returns a boolean.

**My verdict: ABSENT — CONFIRMED, and the brief UNDERSTATES it. There are three independent reasons,
not one, and the third is fatal to the SPEC as written.**

1. **API-side, returns a boolean** — as the brief says. True (`termMatch.ts:71-97`).
2. **It requires a `term_library_entry`, which by owner decision does not exist.** Its signature is
   `matchesEntry(entry: { alias_normalized, match_mode, display_term }, candidateRaw)`. Those are
   `term_library_entry` columns. With the library OFF
   (`D:term-library-off-by-owner-decision`, `.claude/DEFERRED.md:191`) there are zero entries, so
   `matchesEntry` has nothing to be called with. **Any design that reaches for it violates the
   owner's standing decision.** The brief did not say this and it is the stronger reason.
3. **THE FATAL ONE — "reworded" is not merely unsourced, it is UNDECIDABLE from what exists.**
   For a field with claimed keyword `K`, the only two facts derivable are:
   - the field's requirement proposes `K` (stored — Row 2), and
   - the field's text does / does not contain `K` (computable — F1, once fixed).

   When the text does NOT contain `K`, that is consistent with **two different worlds**: the writer
   reworded `K` into other words, or the writer never placed it at all. **Nothing in the product
   distinguishes them.** Rendering `≈ K` picks one of those worlds and asserts it. That is precisely
   CLAUDE.md's *"never fabricate a composite"* — a two-state fact printed as if it resolved a
   three-state question.

**Therefore `≈` MUST NOT SHIP in this row.** SPEC §4.5's `(≈ prefix = reworded rather than copied)`
and §4.6's `Exact term / Reworded / Loose` three-way grade are **not buildable on today's data**,
and no amount of client-side computation changes that — the missing fact is a record of the
generator's intent, which was never written down.

The honest reduction is a **two-state** distinction, both provable:
`proposed · in this field` and `proposed · not in this text`.

**This is an owner question, not a decision I may make** — see §5, Q1.

**Proof commands I ran:**
```
sed -n '1,100p' api/src/functions/tests/termMatch.ts      # matchesEntry signature + entry shape
grep -n "term-library-off" .claude/DEFERRED.md            # the owner decision, verbatim
```

---

### Feasibility table — summary

| Dependency | Brief's verdict | **My verdict** | Change |
|---|---|---|---|
| `model_keyword` reaches the asset step | EXISTS | **EXISTS** | Verdict right, **evidence wrong** — the cited "select" is an INSERT. Real read path is `select r.*` (`:454`) surviving the `...r` spread (`:634`). |
| per-field keyword placement | EXISTS-BUT-CONSTRAINED, "nothing STORES it" | **EXISTS-BUT-CONSTRAINED — but the CLAIM half is stored AND already resolved by shipped code** | Materially wrong. `insertion.requirement_id` + `swap_decision.requirement_id` + `reqsForRow()` already do it. Only PLACEMENT is underived. |
| `≈` match quality | ABSENT | **ABSENT — and undecidable, not merely unsourced** | Stronger. Also depends on the OFF term library. `≈` must not ship. |
| — | (not in brief) | **F1: `markRuns` is a substring matcher, not whole-phrase** | New, measured, blocking for any presence claim. |
| — | (not in brief) | `test:margin` IS CI-blocking (`test.yml:66`, no `continue-on-error`) | The brief is right; the probe's own header comment (`run-field-margin.mjs:14`) is STALE and says the opposite. |

**Nothing here stops the design.** One row is more built than claimed, one is less buildable than
claimed, and one new blocker (F1) must be fixed before any presence assertion renders.

---

## 2. Tier split — the decision

Per CLAUDE.md *"Match the process to the risk"*: **tier is a property of the CODE PATH, not the
size of the change.** Row 11 is not one tier. It is two features that SPEC §4.5 happens to describe
in adjacent bullets, and they sit on opposite sides of the tier line.

### The line

| Part | What it asserts | Tier | Why |
|---|---|---|---|
| **A1.** `proposed` chips listing the field's `model_keyword`s | "the posting line this field answers proposed this term" | **2** | Displays a stored, model-generated value **with its provenance on its face**. Decides no gate, no score, no coverage count. Names no offender. |
| **A2.** Clicking a chip → keyword detail panel (§4.6), read-only | same, plus the requirement text it came from | **2** | Same data, more of it. No new claim. |
| **B1.** Keyword hits highlighted in the body text (§4.5) | **"this specific run of characters IS that keyword"** | **1** | A highlight is an accusation — `highlight.js:71` says so in its own words. F1 proves the only available matcher gets this wrong on short terms. |
| **B2.** "any keyword the field claims but does not contain" (§4.5) | **"this field failed to place a term it claims"** | **1** | Explicitly **names an offender** — CLAUDE.md's own tier-1 trigger, verbatim. |
| **B3.** §4.6's `Exact term / Reworded / Loose` grade | a three-way quality judgement | **1**, and **NOT BUILDABLE** | Row 3: undecidable. Blocked on owner decision Q1. |

### Why B2 is tier 1 even though nothing is stored

The tempting argument is: it is only rendered, never written to `check_result`, so it cannot reach
the gate, so it is tier 2. **That argument is wrong twice.**

1. CLAUDE.md's tier-1 trigger is *"or that names an offender"* — it is not conditioned on
   persistence. An accusation shown to the owner on screen is an accusation.
2. **It is one commit away from reaching the gate, and there is no allowlist standing in the way.**
   I read `gateFor` (`checks.ts:932`):
   ```
   943   if (results.some(r => r.state === 'fail' && r.engine === 'deterministic')) return 'fail'
   ```
   Every `CheckResult` feeds the gate indiscriminately. The moment anyone thinks "this belongs in
   `runChecks` like every other finding", a **model-proposed** keyword starts failing artifacts —
   in direct violation of `schema.ts:338` / `requirements.ts:59` *"never scoreable"*. The tier-1
   ceremony exists to make someone argue that case out loud before it happens.

### Recommendation: SHIP SEPARATELY. A first, then B.

**Ship A (tier 2) on its own, immediately.** It needs **no matcher at all** — it makes no presence
claim, so F1 does not block it. It is a derivation over `reqsForRow`, a render, and a label.

**Hold B (tier 1) behind two things:** the F1 fix (whole-word mode in `markRuns`), and owner
answers to Q1/Q2 (§5).

Three reasons, in order of weight:

1. **B is blocked and A is not.** Shipping them together makes the safe, fully-sourced half wait on
   an unresolved owner question and an unfixed matcher. That is the exact shape CLAUDE.md's
   feasibility rule was written to prevent — *"scoped, agreed and started, then parked hours later."*
2. **Ceremony is inherited upward, not downward.** A combined change is tier 1 in full: AC subagent,
   immediate independent verifier, mutation proof, live verification — for a chip that displays a
   string. The owner named that cost directly.
3. **The tier-1 exception is measured.** CLAUDE.md: verifier runs are batched per phase *"except
   tier 1, which gets one immediately"*, because every real defect found by review in P8.3 was on a
   gate path. Splitting means B gets that immediate verifier and A does not have to buy one.

**One caveat I will not paper over:** splitting means A ships a chip that says a keyword was
*proposed* while the reader can see the word is not in the text, with nothing acknowledging the gap.
That is honest but incomplete. It is the correct trade — an incomplete true statement beats a
complete one built on a matcher that highlights `said` as `AI` — but the owner should know that
between A and B the margin under-explains rather than mis-explains.

### SPEC §4.5 body-text highlighting — in scope?

**Not in scope for A. In scope for B, and only after F1 is fixed.**

Justification: the highlight is the strongest presence assertion on the screen — stronger than a
chip, because it points at specific characters. `markRuns` today would paint `av(ai)lable` as the
keyword `AI`. `highlight.js`'s own header says a near-miss *"would paint the writer's own sentence
as borrowed, which is worse than painting nothing."* Applying that rule to keywords: **highlighting
nothing is strictly better than highlighting the wrong three letters**, so it waits.

### The ONE core system — EXTEND, not NEW

**Core system: the field-margin provenance pipeline.**

```
 UPSTREAM PRODUCERS                    CORE                        DOWNSTREAM CONSUMERS
 requirements.ts:408 buildRequirements ─┐
   → requirement.model_keyword          │
 insertions writer → insertion          ├─ requirementsGet (:950)  ┐
   .requirement_id                      │  insertionsGet (:152)    │
 swaps writer → swap_decision           │         ↓                │
   .requirement_id                      │  useAssetProvenance      │
                                        │  (AssetBlocks.jsx:59)    │
                                        │         ↓                │
                                        └─ reqsForRow()            ├─ ReqChip "Posting lines
                                           (assetBlocks.js:276)    │   answered" (:769)
                                                                   ├─ ReqLegend (:773)
                                                                   └─ Verbatim (:796)
```

**Verdict: EXTEND.** `reqsForRow` already returns exactly the rows a chip needs. `model_keyword` is
already on those rows.

**But do NOT change `reqsForRow`'s return shape.** It has three live consumers in `AssetBlocks.jsx`
(`:769`, `:773`, `:796`) plus two assertions in `app/test/assetBlocks.test.mjs:310-311`. Add a new
pure selector **beside** it in `app/src/assetBlocks.js`, consuming its output:

```js
export function proposedKeywordsForRow(reqs)   // reqs = reqsForRow(...) output
```

New table: **none**. New endpoint: **none**. New matcher: **none** — F1 is fixed *inside*
`highlight.js`, which is the file the repo already designates as the sole owner of "what matched".

---

## 3. Acceptance criteria

Every AC is binary and observable. **Vehicle** is named per AC because `npm test` (275 Node tests)
**cannot fail on a blank screen** — proven on 2026-08-25 when `active is not defined` blanked the
asset step for every list field and reached `main` with the Node suite green
(`.github/workflows/test.yml:59-65`). Anything whose failure mode is *"the component threw"* or
*"nothing rendered"* must be asserted in `app/test/browser/run-field-margin.mjs`
(`npm run test:margin`, required in CI).

| Vehicle | Use for |
|---|---|
| **N** — `node --test` (`app/test/assetBlocks.test.mjs`, `api/test/hardening.test.mjs`) | pure selectors, matcher behaviour, source-structural guards |
| **P** — browser probe (`npm run test:margin`) | anything that must RENDER; every AC that names a `data-qc` hook |

---

### PHASE A — tier 2 — `proposed` chips (ships first, alone)

**AC-A1 (N).** Given a field row whose `requirement_id` resolves to a requirement with
`model_keyword = "roadmap ownership"`, when `proposedKeywordsForRow(reqsForRow(row, swaps, reqById))`
is called, then it returns `["roadmap ownership"]`.

**AC-A2 (N).** Given a list field whose swaps contribute a second requirement with
`model_keyword = "vendor selection"`, when the selector is called, then it returns both keywords,
deduped by exact string, in `requirement.seq` order — the same ordering contract `reqsForRow`
already honours (`assetBlocks.js:287`).

**AC-A3 (N).** Given every resolved requirement has `model_keyword = null`, when the selector is
called, then it returns `[]` — **never** `[null]`, `[""]`, or a placeholder.

**AC-A4 (P).** Given a field whose selector returns `[]`, when the asset step renders, then the
element `[data-qc=BLOCK_HOOKS.keywordChips]` is **absent from the DOM**, and the string
`0 keywords` appears **nowhere** in that field's margin.
*(CLAUDE.md: absent evidence is `not_applicable`, never `pass`. "0 keywords placed" is a measurement
claim; there is no measurement.)*

**AC-A5 (P).** Given a field whose selector returns ≥ 1 keyword, when the asset step renders, then
`[data-qc=BLOCK_HOOKS.keywordChips]` contains exactly one chip per returned keyword, and **the
literal word `proposed` is present inside every chip's own element** — not once in a group heading,
not in a legend, not in a tooltip.
*(The owner fixed the label as "proposed". A reader who sees only one chip must still see the word.)*

**AC-A6 (P).** Given a rendered keyword chip, when the DOM is inspected, then that chip carries
**none** of `HIGHLIGHT_CLASS.keyword` (`qc-kw`), `HIGHLIGHT_CLASS.postingEcho` (`qc-echo`), and none
of the `HIGHLIGHT_LITERALS` swatches appear in its inline style.
*(A proposed term must not borrow the visual language of a *verified* placement. Phase B's highlight
is the same yellow; if the chip wears it too, the two become indistinguishable — which is exactly
the mistake the owner's "never mistake it for validated" constraint names.)*

**AC-A7 (P).** Given the keyword chip group renders, when its text is read, then it contains **no**
`n/m`, no `%`, and no count of any kind.
*(Any numerator here is a coverage count on a never-scoreable field.)*

**AC-A8 (P).** Given a field with keyword chips, when the asset step renders in **both** themes
(`:root` and `.proto-dark`), then the chip's text and background resolve through registered theme
tokens and the field still renders — no blank block, no thrown error.
*(The blank-screen regression class. `run-contrast.mjs` already sweeps contrast; this AC is about
the component surviving the render at all.)*

**AC-A9 (P).** Given a chip is clicked, when the detail panel opens, then it shows the requirement's
`verbatim` (the posting's own words) and repeats the word `proposed`, and shows **no** match-quality
grade, **no** `≈`, and **no** "took the place of" attribution.
*(§4.6's grade and displacement text are Row-3 blocked. Rendering the panel without them is honest;
rendering them is invention.)*

**AC-A10 (N).** Given the requirements payload for a field, when `verifyRequirementRows` has redacted
that row's evidence (every `evidence_*` key nulled — `appRequirements.ts:632`), then the selector
**still** returns the `model_keyword`, and no AC above changes behaviour.
*(Documents the interaction I found in Row 1: `model_keyword` is not `evidence_`-prefixed and
survives redaction. Correct — a proposed term is not an evidence claim — but it must be a decided
property, not an accident nobody noticed.)*

---

### PHASE B — tier 1 — presence (blocked on F1 + Q1/Q2)

**AC-B0 (N) — the F1 fix, prerequisite to every other B.** Given `markRuns(text, phrases, mark, {
wholeWord: true })`, when `phrases = ["AI"]` and `text = "Led a team that said the detail was
available."`, then **zero** runs are marked. And when `text = "Led AI strategy."`, then exactly one
run is marked with `phrase === "AI"` **by identity** (`===` against the caller's array element, the
contract `highlight.js:87-90` already guarantees).

**AC-B0a (N).** Given `wholeWord: true`, when `phrases = ["Java"]` and `text = "We use JavaScript
heavily."`, then zero runs are marked; and when `text = "We use Java heavily."`, then one run is
marked.
*(Java ≠ JavaScript is an ATS-material distinction, not a nicety.)*

**AC-B0b (N).** Given `wholeWord` is **omitted**, when `markRuns` is called with the existing
posting-echo phrases, then behaviour is byte-identical to today.
*(The existing caller must not change. Default off; keywords opt in.)*

**AC-B0c (N).** Given `wholeWord: true` and `phrases = ["P&L"]`, when `text = "Managed P&L of
$18M."`, then one run is marked.
*(A naive `\b…\b` wrap breaks on a leading/trailing non-word character — `\b` after `L` is fine but
`\b` before `P` in `&`-adjacent text is where these regexes die. `termMatch.ts:5-8` records that
`P&L` appears in 83 live postings.)*

**AC-B1 (P).** Given a field whose text contains a proposed keyword as a whole word, when the asset
step renders, then that occurrence carries `HIGHLIGHT_CLASS.keyword` and the chip for that keyword
renders in its **present** state.

**AC-B2 (P).** Given a field whose text does **not** contain the keyword, when the asset step
renders, then no run in that field carries `HIGHLIGHT_CLASS.keyword`, and the chip renders in its
**not-in-this-text** state — worded so it does not assert *reworded* (Row 3).

**AC-B3 (P).** Given a keyword chip is hovered, when the DOM is inspected, then the matching run
gains `HIGHLIGHT_ACTIVE_CLASS` and the link is by **identity** (`r.phrase === active`), with no
`includes` / `indexOf` / `toLowerCase` comparison in the component.
*(`AssetBlocks.jsx:447-450` states this contract for wording rows; keywords must use the same one,
not a second one.)*

**AC-B4 (N) — the offender line.** Given the "claims but does not contain" list is produced, when it
is computed, then it is derived **only** from `wholeWord: true` matching, and a keyword absent from
the text appears **exactly once**, named by its exact `model_keyword` string.

**AC-B5 (P).** Given the offender line renders, when it is read, then it is phrased as a statement
about the **text** ("not in this field's text"), and does not attribute intent, quality, or blame to
the writer, and carries the same `proposed` qualifier as the chip.

---

### GUARDS — the "never scoreable" wall (ship with Phase A)

These are the point of the whole row. CLAUDE.md asks for a guard that makes the violation
**impossible, not merely absent**.

**AC-G1 (N).** Given `api/src/functions/tests/appRequirements.ts`, when the source of
`shapeRequirementsForApi`'s row mapper is read, then it contains the spread `...r`.
*(Row 1, hop 3. The entire feature depends on one spread that nothing guards today. An "explicit
allowlist" refactor would silently delete every chip on the screen and no test would say so.)*

**AC-G2 (N).** Given the three modules that compute or gate — `checks.ts`, `appChecks.ts`,
`artifactScore.ts` — when their source is read **with comments stripped** (the `H26` convention,
because `H:no-figure-ranking` and `D2`/`D10` were all inert for exactly this reason), then the
identifier `model_keyword` appears in **none** of them.
*(This is the wall. A model-proposed term cannot enter a coverage count, a score, or the gate if the
scoring and gate modules never name it. It is true today — the guard is a regression guard, and I
say so rather than dressing it up as a fix.)*

**AC-G3 (N).** Given `computeArtifactScore`, when called with `keyword: { covered: N, scoreable: M }`
for any `N`, then `keyword_coverage.value` is a number — **and** given `appChecks.ts`'s call site is
read with comments stripped, the literal `covered: null` is present.
*(Two halves deliberately. The score function is general-purpose and must stay so; the guard is on
the CALL SITE, which is the only place a numerator could be introduced. `appChecks.ts:139` today
passes `covered: null` unconditionally — the D-row check on `artifactScore.ts` guards the message,
nothing guards the call.)*

**AC-G4 (N).** Given `app/src/assetBlocks.js`, when `proposedKeywordsForRow`'s source is read, then
it performs no arithmetic — no `length` compared to a second length, no `/`, no `%`, no `Math.round`.
*(The chip group must not grow a numerator on the client either. AC-A7 asserts the render; this
asserts the source, because a number could be computed and shown conditionally.)*

**AC-G5 (P).** Given the full asset step renders with keyword chips present, when `runChecks` output
is inspected, then no `check_result` row has a `check_key` containing `keyword`.
*(The `gateFor` wall, asserted from the other end: `checks.ts:943` feeds every deterministic `fail`
straight to the gate.)*

---

## 4. Mutation proof per guard

CLAUDE.md: **"THE ONE STEP THAT IS NEVER SKIPPED, AT ANY TIER: mutation-prove a NEW guard."** Write
the guard, revert the behaviour it guards, confirm the suite **FAILS**, restore. Three guards in one
session previously passed with their defect reinstated.

Each row gives the **exact** edit. A guard whose mutation does not fail must be rewritten, not
explained away.

| Guard | Exact mutation | Must fail with |
|---|---|---|
| **AC-G1** (`...r` spread) | In `appRequirements.ts:634`, replace `...r,` with an explicit list omitting the field: `id: r.id, seq: r.seq, kind: r.kind, verbatim: r.verbatim, item_text: r.item_text,` | G1 fails. **Also run `npm run test:margin`** — if the probe still passes, its fixture is not exercising the real payload shape and the probe is the thing that is wrong. |
| **AC-G2** (scoring modules never name it) | Insert into `checks.ts`, inside `runChecks`, a live statement: `const kw = (requirements || []).map((r) => r.model_keyword).filter(Boolean)` | G2 fails naming `checks.ts`. |
| **AC-G2 — inertness counter-proof** (required) | Instead insert **only a comment**: `// model_keyword is never read here` | G2 must **PASS**. If it fails, the guard is a comment-scanner and will cry wolf on the very file that documents the rule — the `termMatch.ts:21` false positive that got a whole linter deleted. |
| **AC-G3** (call-site numerator) | In `appChecks.ts:141`, change `{ covered: null, scoreable }` to `{ covered: 0, scoreable }` | G3's call-site half fails. **Note the trap this proves:** the string `covered: null` also appears at `appChecks.ts:136` **inside a comment**. A guard that does not strip comments PASSES this mutation. That is not hypothetical — it is the exact shape of `D2` and `D10`, both proven inert. |
| **AC-G4** (no client arithmetic) | Add to `proposedKeywordsForRow`: `const pct = Math.round((out.length / reqs.length) * 100)` and return it | G4 fails. |
| **AC-G5** (no keyword check reaches the gate) | Register in `runChecks` a result `{ check_key: 'keyword_placement', engine: 'deterministic', state: 'fail', … }` | G5 fails. Confirm `gateFor` on that result set returns `'fail'` — this is what the guard exists to prevent. |
| **AC-B0** (whole-word) | Revert the `wholeWord` branch in `highlight.js` so it falls through to plain `lower.indexOf(needle, from)` | AC-B0, B0a fail. **B0c must still pass** — if `P&L` breaks under the *reverted* code it was never the boundary logic that fixed it. |
| **AC-B0b** (no change to the existing caller) | Make `wholeWord` default **`true`** instead of `false` | B0b fails. This is the regression that would silently un-mark posting echoes containing punctuation, on a screen that already ships. |
| **AC-A4** (no "0 keywords placed") | Render the group unconditionally: change the guard to `{chips.length >= 0 && …}` and have the heading print `` `${chips.length} keywords placed` `` | AC-A4 fails in the **browser probe**. A Node test cannot catch this — the failure is a rendered string. |
| **AC-A6** (chip ≠ highlight treatment) | Add `className={HIGHLIGHT_CLASS.keyword}` to the chip element | AC-A6 fails. |
| **AC-A5** (the word "proposed" per chip) | Move `proposed` from the chip into the group heading | AC-A5 fails. This is the owner's stated constraint, so it gets its own mutation rather than riding on A4's. |

### Mutations I expect to be behaviourally equivalent — declared in advance

CLAUDE.md: *"a mutation can be behaviourally equivalent and correctly fail to fail: when that
happens, say so and do not claim the assertion is proven."*

- **AC-A2 ordering.** Reversing the sort in `proposedKeywordsForRow` is a no-op whenever the fixture
  has one keyword. The mutation is only meaningful against a **two-requirement** fixture with
  distinct `seq` — build that fixture first or the proof is vacuous.
- **AC-A3 null handling.** Changing `.filter(Boolean)` to `.filter(x => x !== null)` is equivalent
  for `null` but diverges for `""`. The fixture must contain an **empty-string** `model_keyword` or
  this mutation proves nothing. *(Whether an empty string can reach the column is Q3.)*

---

## 5. Questions the owner must answer before this is built

I have not guessed any of these. Each blocks a specific AC.

**Q1 — `≈` is not buildable. Which reduction do you want?** (Blocks AC-B2, AC-A9, all of §4.6's grade.)
SPEC §4.5 defines `≈` as "reworded rather than copied" and §4.6 asks for `Exact term / Reworded /
Loose`. Row 3 proves *reworded* is **undecidable** from stored data — "not in the text" is equally
consistent with "reworded" and "never placed", and nothing distinguishes them. Options:
  - **(a)** Two states only: `proposed · in this field` / `proposed · not in this text`. Drop `≈`
    and the §4.6 grade. *(Fully sourced today; my recommendation, but it is your call, and I am not
    recording a recommendation as a decision.)*
  - **(b)** Store the generator's intent so *reworded* becomes real — the generator records which
    keyword each phrasing was written to satisfy. New column, new prompt contract, and it admits
    model output into a stored claim, so it is tier 1 in its own right.
  - **(c)** Defer §4.6's grade entirely and ship the panel without it.

**Q2 — does the "claims but does not contain" line ship as an accusation at all?** (Blocks AC-B4,
AC-B5.) It names an offender on the strength of **two** model outputs: the model's `model_keyword`
and the model's `requirement_id` linkage. Neither has ever been validated against anything. Are you
willing to show the owner "this field claims X and does not contain it" on that basis, or should it
be phrased as an observation with no claim of fault?

**Q3 — can `model_keyword` be an empty string, or only `null`?** (Blocks the AC-A3 mutation proof
from being non-vacuous.) `requirements.ts:408` writes `r.keyword || null`, which maps `""` → `null`
at the write path — but production rows predate that line's current form and I did not query live
data. Settle with one `db-query.yml` run:
```sql
SELECT count(*) FILTER (WHERE model_keyword = '')   AS empty_string,
       count(*) FILTER (WHERE model_keyword IS NULL) AS nulls,
       count(*) FILTER (WHERE model_keyword <> '')   AS populated
FROM requirement;
```
That same query also answers the question nobody has asked: **how many fields will show any chip at
all.** If `populated` is near zero, Phase A renders an empty margin on every field and the row is
not worth building yet. **This query should be run before a line of code is written.**

**Q4 — is the two-phase split acceptable?** (§2.) Between A and B the margin lists proposed keywords
without saying whether they landed. Honest but incomplete. Confirm you would rather have that than
wait for the whole row.

---

## 6. Summary for the reader in a hurry

- **Nothing blocks this row**, but the brief's feasibility table was wrong in two places.
- **The data layer for the chips is already built** — `insertion.requirement_id` + `reqsForRow()`
  already resolve per-field requirements, and those rows already carry `model_keyword`. Phase A is a
  selector, a render, and a label. **No new table, no new endpoint, no new matcher.**
- **`markRuns` is a substring matcher despite its docstring** (measured: `AI` matched inside `said`,
  `detail`, `available`; `Java` inside `JavaScript`). Every presence claim is blocked until it gets
  a whole-word mode. **Extend `highlight.js` — it is the file the repo designates as the sole owner
  of "what matched".**
- **`≈` cannot be built.** Not unsourced — undecidable. Owner decision Q1.
- **Tier split: chips are tier 2, highlighting and the offender line are tier 1.** Ship separately,
  A first.
- **Run Q3's query first.** It costs one workflow dispatch and could show the whole row renders
  nothing on live data.

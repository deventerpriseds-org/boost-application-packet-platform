# SCOPE — a driving-keyword record on `swap_decision` (SPEC 4.6-8)

**Written 2026-09-02.** Owner: *"scope the swap_decision keyword column."* This is a SCOPE, not an
AC pass and not an implementation. Nothing under `api/src` or `app/src` is touched by this document.

---

## 0. FEASIBILITY FIRST — and the headline is that the column is not the work

| Dependency | Producer (writes it) | Consumer (reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `swap_decision.requirement_id` | `appSwaps.ts:163-172`, resolved from `SwapRow.requirement_seq` | Swaps tab, `restoreOptions`, this doc | `schema.ts:642` — `requirement_id uuid references requirement(id)` | **EXISTS** |
| `requirement.model_keyword` | JD parse, `requirements.ts:408` | JD step chips, `proposedKeywordsForRow` | rendered on the JD step today | **EXISTS** |
| A join keyword -> swap row | — | — | 17 of 30 `swapped` rows resolve `requirement_id` -> a requirement carrying `model_keyword` | **EXISTS-BUT-CONSTRAINED** |
| **A record of which keyword DROVE a swap** | **nothing** | **nothing** | see §1 | **ABSENT — and not addable as a column alone** |

**`EXISTS-BUT-CONSTRAINED` is the row that matters.** The join exists; it does not mean what 4.6-8
needs. An earlier note in `PROTOTYPE-COVERAGE.md` claimed there was no join at all — that was wrong
and is corrected there and in `.claude/accuracy-log.md`.

---

## 1. WHY A COLUMN ALONE CANNOT BE FILLED

Three facts, each read from source rather than assumed:

1. **The model returns plain text, not structured provenance.** `buildSwaps` consumes
   `splitItems(pkg[f.merge] ?? call3[f.passB])` (`swaps.ts:497`) — a list of item STRINGS. There is
   no per-item field naming a keyword, a target, or a reason.
2. **Attribution is POST-HOC and FUZZY.** `attribute()` (`swaps.ts:224`) takes the final item text
   and returns the best-matching requirement by `similarity()` — token-set containment — at
   `ATTRIBUTION_THRESHOLD = 0.34`, matched against the requirement's **verbatim posting line**.
3. **The engine cannot see keywords at all.** `RequirementRef` is
   `{ seq, verbatim, item_text, kind }` (`swaps.ts:213`). `model_keyword` is not in it.

> **So "record the driving keyword at swap time" is a GENERATION-CONTRACT change, not a schema
> change.** Adding `swap_decision.driving_keyword` today would produce a column that is null on
> every row, because nothing upstream knows the answer. Shipping the column first would be the
> write-only-field defect this repo has already hit once (`correction.frame`).

---

## 2. THE THREE OPTIONS, with the honest cost of each

### Option A — structured generation (makes the claim TRUE at the source)

Change the call-3 response contract so each emitted list item carries the keyword(s) it was written
to place; thread `model_keyword` into `RequirementRef`; persist per swap row.

- **Unlocks:** the prototype's exact control — *"Took the place of X"* — with real causation.
- **Cost:** prompt + response-schema + parser change on a hot path that already carries many guards;
  `RequirementRef` widened; a new column plus a migration.
- **TIER 1.** It **admits model output into a stored claim**. Needs an independent AC pass before
  coding, an independent verifier after, and a vet: a model asserting "I placed keyword K here" is
  exactly the kind of claim that must be checked against the text rather than believed.
- **No backfill is possible.** Every existing row stays null forever; the UI must handle that
  permanently, not as a transitional state.
- **Risk that decides it:** if the model's self-report is wrong, the app prints a false causal claim
  next to a button that rewrites the owner's document. The vet is not optional.

### Option B — exact placement, and NO causation claim  *(recommended first step)*

Do not claim causation. Render the control only where the keyword appears **exactly** in the
replacement text, and word it as placement:

> `"global engineering"` is in the item that replaced `"Agile Transformation"`.

- **Unlocks:** a true, checkable statement using data that exists today.
- **Reuses:** `keywordPresence` (`AssetBlocks.jsx:706`) — the SAME derivation already feeding the
  chip state and the highlight, so a third opinion about "is this keyword in this text" cannot form.
- **Cost:** UI wiring only. **TIER 2** — no new stored claim, no gate, no score.
- **Measured frequency:** **2 of 17** joined swapped rows on the production fixture
  (`global engineering` -> `Global Engineering Teams`, twice). Low, and honest: the no-dead-UI rule
  already governs — no exact match, no control.
- **Limit, stated plainly:** it is a weaker sentence than the prototype's, and it will be absent on
  most rows. That is the price of only saying what is true.

### Option C — leave 4.6-8 PARTIAL

Zero cost, and defensible: the capability exists in the field margin (`AssetBlocks.jsx:946-954`)
and in the Swaps tab. Only the panel-level shortcut is missing.

---

## 3. RECOMMENDATION

**B now, A only if the owner wants true causation.** B is a Tier-2 change that says something true
today; A is a Tier-1 pipeline initiative whose main risk is printing a model's self-report as fact.
Doing B first also de-risks A: it builds the panel slot and the copy, so A later swaps the
CONDITION (exact containment -> recorded causation) without redesigning the control.

**Do NOT ship the middle path** — rendering causation off `requirement_id`'s 0.34 fuzzy attribution.
That is `CLAUDE.md:432`, *"fuzzy matching is for RANKING, never for ACCUSING"*, and it is the
specific thing this scope exists to refuse.

---

## 4. IF OPTION A IS CHOSEN — what the AC pass must settle

1. What EXACTLY does the model assert, and in what field of the response?
2. How is that assertion VETTED before it is stored? (Exact containment of the keyword in the item
   it claims to have placed is the cheapest vet and should probably be mandatory.)
3. What is written when the vet FAILS — null, or a row marked unvetted? (`Absent evidence is
   not_applicable, never pass`.)
4. What does the UI show for the permanent null population of pre-change rows?
5. Which existing guards does the widened `RequirementRef` touch, and does
   `H:...` swap coverage still hold?
6. Does any gate, score or coverage count read the new column? (It must not, or the tier rises
   again.)

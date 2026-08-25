# AC — Row 11: proposed ATS keyword chips in the resume field margin

**Status:** IN PROGRESS (written incrementally — each section is appended as it is proven).
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

# AC — Incumbent Wins: template items stay, model preferences become PROPOSALS

**Status:** feasibility + ACs only. Nothing implemented. Written 2026-08-28.
**Written incrementally** — sections are appended as each is proven, so partial work survives.

## The owner's rule (verbatim)

> "it should be highlighted on the right as a possible replacement that AI likes better but template
> value that is the same stays until I say switch"

Reading: an existing (template/incumbent) skill item that satisfies a JD requirement **STAYS**. A
model-preferred replacement is **SURFACED** in the right-hand rail as a proposal and is applied
**only on explicit owner action**. Nothing silently replaces an incumbent.

Owner's ordering instruction:

> "the retention floor update should be tied to actually confirming which of the template items can
> stay first and then switching based on least relevant"

Reading: **FIRST** determine which incumbents are justified (they cover a requirement), **THEN**
consider swapping only the remainder, ordered by least relevant. This is **not** a percentage
threshold — it is a two-phase decision with coverage as phase 1.

---

## The measured defect this fixes

Trinnex rebuild, packet `85cee965`, opportunity `9f9c370a-4ac9-441e-b58e-02e3ffcf669e`:

1. `assemblePackage` (`api/src/functions/tests/mt17.ts:148-149`) is
   `SkillsBullets1: firstNonEmpty(call3.finalSkills1, call2.skills1, call1.skills1, splitS1)`.
2. Call 3 (the ATS QC pass) returned an **empty string** for both skills slots — stored lineage
   shows `"call3": ""`, `winner: "call2"`. `firstNonEmpty` (`mt17.ts:53-59`) treats empty as "use
   the next candidate", so **a QC pass that failed is indistinguishable from a QC pass that was not
   needed**. No warning is emitted anywhere.
3. Call 2 — whose documented instruction is *"Replace the least relevant or loosely aligned skills
   from previous outputs with these refined phrases"* — returned a **100% replacement**: none of
   Call 1's ten items survived.
4. Call 2 also emitted the SAME items for `skills1` and, split 3/3/3, for `relevant1/2/3`.
   `dedupeAcrossLists` (`normalise.ts:100`) then correctly removed all nine from the Relevant lists,
   leaving **three empty blocks** in the rendered resume.

The owner's rule breaks (2)-(4): a "replace the least relevant" instruction executed as a total
replacement, with no check that the displaced incumbents were themselves covering requirements, and
no proposal step.

---

*(Feasibility table follows below — appended as each row is proven.)*

# Defect register — owner review of the live packet screens, 2026-08-23

Every point the owner raised, and every screenshot, with a status and a fix. Nothing here is
"should work": each row says whether it was VERIFIED against the live database / source, or is still
UNVERIFIED and therefore a hypothesis.

**Spec under review:** `docs/qc-evidence/SPEC.md` ("Packet QC & evidence layer — build spec", 388
lines), which references `docs/qc-evidence/screens/01-…08-…png`. **The owner has been asked to
confirm this is the right document** — `docs/design_handoff/Executive Engine Spec.html` also exists
and is older. If the spec is wrong, every "vs spec" row below is suspect.

**Opportunity in the screenshots:** Trinnex `9f9c370a` — `jd_real` **0 chars**, `raw_jd` 1,054,
source `Extension`, 10 requirements, 5 must-haves, **5 of 5 must-haves have no `verbatim`**.
eMoney `2cb56fb3` is the real comparison: `jd_real` 9,749, 35 requirements, 13 must-haves, 2 without
verbatim.

Status key: **VERIFIED** (measured) · **PARTLY** (mechanism confirmed, extent not) · **UNVERIFIED**.

---

## A. My own false statement

### A1 — I told the owner to "confirm the proposals in the QC rail". That control does not exist. VERIFIED
I built `evidence_confirmation`, the `POST /api/app/requirement/{seq}/evidence-confirm` route, and
the gate logic that counts a confirmed proposal. I proved coverage moves (0/12 → 2/12) by writing
confirmation rows **directly into the database**, then told the owner twice to use a screen I never
wrote. `grep -rn "evidence-confirm" app/src` returns nothing.

**Fix:** build the confirm/reject control per SPEC §4.1 — each requirement row expands to the
proposed excerpt, its source, and Confirm / Reject. Wire `api.js` to the existing route. Until then
Option A is unusable by the owner and must not be described as delivered.
**Tier 1.**

---

## B. Thresholds — the 24/20 question

### B1 — The 24/20 limits ARE live and the stored package obeys them. VERIFIED
The owner asked whether the 30-vs-24/20 mismatch was really fixed. Measured on the owner's row:
```
chk_skill_max_chars = 24 · chk_relevant_max_chars = 20 · chk_relevant_allowance = 1
```
Stored `SkillsBullets1` for Trinnex is 10 items, every one ≤ 24. Only two stored items exceed a
limit anywhere in the packet (`Customer-Centric Innovation` 27 in RelevantBullets2,
`Enterprise Governance` 21 in RelevantBullets1) and both are inside the per-list allowance of 1.

**So the threshold fix reached production.** What the owner saw over-limit is B2, a different bug.
**No fix required. Evidence recorded so this is not re-litigated.**

### B2 — The provenance view shows PRE-NORMALISATION text and labels it "after". VERIFIED
Screenshot "Skills, column 1 (pass 3) — after" lists `Digital Transformation Strategy` (30),
`Scalable Software Solutions` (27), `Agile Operations Management` (27) — all over 24, 7 items.
The **stored** `SkillsBullets1` is a different list of 10 items, all within limits. Pass 1 shows
10 → 5 items; pass 3 shows 10 → 7; the stored artifact has 10. The three do not reconcile.

The normaliser runs after the pass output and before the `pkg_json` write, so the intermediate text
legitimately breaks the limits — but it is being rendered as the final state.

**Fix:** the "after"/"final" column must read the STORED package, not a pass snapshot. Pass output
may be shown, but must be labelled as an intermediate loop and must never occupy the "final"
column. Add a guard asserting the final column equals `pkg_json`.
**Tier 2.** This is the single biggest driver of "the numbers look wrong" and it also explains the
owner's char-count observation.

---

## C. Swap / drop logic

### C1 — 7 items dropped, 1 added: item counts are not anchored. VERIFIED
```
kept 20 · swapped 8 · dropped 7 · added 1
```
Net −6. The owner's rule — "to keep the start and end item counts the same, everything should be
kept or swapped" — is not enforced anywhere.

**Fix:** make `dropped` illegal for a fixed-length list. A removal must be a `swapped` with a
replacement, or the item stays. Where the pipeline genuinely wants fewer items, that must be an
explicit list-length decision, not an unpaired drop. Guard: for every fixed-length list, count of
final items == count of original items.
**Tier 2**, but it changes generated output, so it needs the owner's sign-off on the rule first.

### C2 — "Why" column shows a provenance tag as a justification, and inverts the meaning. VERIFIED
```
Scalable Solutions | dropped | driver = 'posting'
6 of the other 7 drops   | driver = 'unattributed'
```
`driver` records WHICH SOURCE touched the decision — never why, never in which direction. The UI
renders `driver='posting'` plus the matched posting line as the reason, so the screen says the
posting's demand for *"scalable, secure, high-quality software"* is why **Scalable Solutions was
dropped**. The owner is right that this is backwards: that line is a reason to KEEP it.

**Fix:** stop rendering `driver` as a rationale. Either (a) show it as provenance only —
"influenced by: the posting" — or (b) store a real directional rationale at decision time. (a) is
honest immediately; (b) is the correct end state. Do (a) now, (b) with C1.
**Tier 2.**

### C3 — No swap-back control; the final column is not editable. VERIFIED from the screenshot
`Stakeholder Collaboration → Stakeholder Engagement · swapped · unattributed · packet-level` with no
affordance to revert or edit.

**Fix:** per-row "keep the original" and inline edit on the final value. SPEC §4.7 "Inline ask for a
change" is the nearest existing requirement.
**Tier 2.**

---

## D. Provenance copy that contradicts itself

### D1 — "loop 0 / written for this posting" beside "POSTING LINE ANSWERED R2". VERIFIED from screenshot
CoreAccomplishments shows `written for this posting · loop 0`, then `POSTING LINE ANSWERED R2`, then
"Written against the posting line cited above" — with nothing above it, the citation below, and the
quoted line (*"high-performing engineering culture"*) not appearing in the final text.

**Fix:** one statement per block, in reading order: what it is → which posting line it answers →
the quote → where that landed in the final text. Remove "cited above" when the citation is below.
Make the quote a link that scrolls to the placed text (SPEC §4.1 `Where it is used →`).
**Tier 2.**

### D2 — "No posting line matched this block, so nothing in the ad drove its wording" is inverted. VERIFIED as a framing defect
On AboutMe1/AboutMe2. The pipeline tailors blocks TO posting items; it does not ask whether a
posting line happened to drive pre-existing template wording. The sentence describes a search that
runs in the wrong direction and reads as an accusation against untouched template material.

**Fix:** reword to state the truth — "this block was not tailored for this posting; it is the
template text." No claim about what "drove" it.
**Tier 3 (copy)** — but see F1: the underlying direction question is Tier 1.

### D3 — Block order does not match the spec. UNVERIFIED
Owner reports ResumeSummary appearing midway instead of near the top, and ordering generally not
matching the design screenshots.

**Fix:** compare the rendered order against `docs/qc-evidence/screens/09-resume-step-top.png` and
`10-asset-header-expanded.png` and reorder to match. **I have not yet opened those screenshots** —
this row is the owner's report, not my measurement.
**Tier 2.**

---

## E. Missing screens and controls

### E1 — "5 to fix" is not drillable and findings are not actionable there. VERIFIED from screenshot
The badge names a count; clicking does not show what the five are or let the owner act on them.

**Fix:** the count opens the findings list — check name, what was observed, what was expected, the
offenders, and the action. SPEC §4.9 per-asset QC drawer.
**Tier 2.**

### E2 — No reasoning column; cannot tell why an item is unsatisfied. VERIFIED against spec
SPEC §4.1: expanding a row must show "the verbatim profile excerpt that evidenced it, its source …
and `Where it is used →`", and the acceptance is "every 'evidenced' claim can be expanded to a quote
plus source". Not implemented. The owner cannot tell why "Strong understanding of software
engineering practices" is open when the template resume plainly covers it.

**Note:** the data to answer this EXISTS — the resolver publishes `evidenceSearch` with `reason`,
`soughtWords`, `missingWords`, `closestExcerpt`, `closestSourceKey` per requirement. It is simply
not rendered. That is why the API can explain a refusal and the screen cannot.

**Fix:** render `evidenceSearch` in the expanded row. This is the highest value-per-hour item in
the register — the data is already there.
**Tier 2.**

### E3 — Independent review blank on all five assets. VERIFIED
`review_verdict` holds 1 row for Trinnex across 5 assets; the screen correctly reports "has not run"
for the rest. The reviewer is not part of the build path.

**Fix:** decide whether the reviewer runs automatically on build (cost) or on demand from a control
(currently absent). Either way the screen must offer the action rather than only reporting absence.
**Tier 2** — needs an owner decision on cost.

### E4 — ATS term library has no published version. VERIFIED
Screenshot: "The ATS term library has no published version yet… no published term-library version
has scoreable entries yet." SPEC §4.1 requires the keywords tab footer to name the library
(`ENG-LEAD v4`, 1,840 terms, its sources) and §4.3 requires `12/13 placed`. The owner is right that
this is first-order, not deferred: without it the ATS half of the product cannot score at all.

**Fix:** seed and publish a real term library with scoreable entries. Until then the keywords tab is
honest but empty, and `keyword coverage` in the score is permanently null.
**Tier 1** — it feeds a score.

---

## F. The direction of the comparison — the most serious item

### F1 — The screen leads with the wrong artefact and reads as grading the posting. VERIFIED against spec
Screenshot: "This posting, against your profile — 1 of 8 dimension(s) compared … 7 not compared
(Leadership tenure, Organization size, Budget owned, …), not counted either way."

SPEC §4.2 requires this screen to LEAD with **four fit cards** — Responsibilities, Must-have
requirements, Nice-to-have requirements, ATS keywords — each `n of m`, graded
(`covered/total ≥ 0.99 strong, ≥ 0.7 moderate, else weak`), with the posting's items as the
denominator. The dimension table is the SUPPORTING detail beneath them.

What ships surfaces the dimension table first, on eight axes the posting mostly never mentions, so
seven of eight read "not compared". The fit cards do exist — a later screenshot shows
`Requirements · must have 2/5` and `Responsibilities 0/5` — but the owner had to drill to reach
them.

**The owner's reading is correct:** the anchor must be the posting's extracted items, and the
question is how many of them the template resume + profile satisfy. What is displayed inverts that
emphasis.

**Fix:** promote the four fit cards to the top of §4.2 per spec; demote the dimension table; and
suppress or collapse dimensions the posting does not ask about rather than listing them as
"not compared". Re-word the heading so the posting is plainly the anchor.
**Tier 1** — it changes what the owner believes the numbers mean.

---

## G. Attributable to the Trinnex import, not to the QC layer

### G1 — "the employer wording could not be located, so this is the parser paraphrase". VERIFIED
All 5 Trinnex must-haves have `verbatim IS NULL` because `jd_real` is 0 chars. SPEC §4.1's
acceptance ("every extracted line renders verbatim") is unsatisfiable on a 1,054-char capture.

### G2 — Weak/odd requirements and only 5 must-haves. VERIFIED
Consequence of the same 1KB capture.

**Fix for both:** Trinnex cannot be repaired — the extension stored no URL and no `job_id`, so there
is nothing to re-fetch. **Re-capture it, or evaluate on eMoney.** Separately, the extension must
record `job_url` at capture time and warn on a suspiciously short capture (1,054 chars against a
~9,700-char norm is detectable), so a thin capture is neither silent nor permanent.
**Tier 2** for the extension change.

---

## H. Not yet checked

### H1 — "Before/after may be backwards on the ResumeSummary block." PARTLY
B2 proves the final column is not the stored artifact, which explains most of what the owner saw.
Whether the two columns are additionally transposed for ResumeSummary specifically is **not yet
measured**. Check by comparing the rendered "before" against the template's stored ResumeSummary.

---

## Order of work

1. **A1** confirm control — the missing half of a feature already reported as shipped
2. **B2** provenance shows the stored final — kills the char-count and count-drift confusion at once
3. **E2** render `evidenceSearch` — the "why" the owner cannot currently see; data already exists
4. **F1** fit cards lead, posting is the anchor
5. **C2** stop rendering `driver` as a rationale
6. **E4** publish the ATS library
7. **C1 + C3** anchored swaps and a revert control — needs the owner's rule decision first
8. **E1, D1, D3, E3, G2** the rest

## Standing correction to how I report

Every "verified" claim in this session was verified against the DATABASE. The owner's experience is
the SCREEN. Those diverged badly here — coverage genuinely moved to 2/12 while the control to move
it did not exist. **A packet feature is not verified until it is verified on the rendered page**, via
`ui-verify.yml` or the owner. That is now the standard for this module.

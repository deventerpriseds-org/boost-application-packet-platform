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

---

# PART 1 — FEASIBILITY TABLE (comes first, per CLAUDE.md "Feasibility BEFORE implementation")

**Headline, said first because `ALREADY BUILT` is a first-class outcome:**

> **The "does this item cover a requirement / rank by least relevant / keep the covering ones" logic
> ALREADY EXISTS and is in production** — `compactFit.fitCompactSkills` + `requirementSupport.supportIn`.
> **The owner's rule is not a new subsystem. It is (a) reusing `compactFit`'s two-phase decision on
> the SELECTION path instead of only the compact-overspill path, and (b) a proposal surface.**
> Everything below either extends one of those or reuses `owner-edit` / `correction`, which is the
> shipped owner-decision ledger.

| # | Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + real output) | Verdict |
|---|---|---|---|---|---|
| **1a** | **"Does this text support this requirement?" — deterministic, no model** | `requirementSupport.supportIn()` (`api/src/functions/tests/requirementSupport.ts:658`) | `evidence.resolveEvidence` / `evidence.refusalReason` (`evidence.ts:406,482`); `evidenceProposal.ts` | `grep -rln "supportIn" api/src app/src` → `requirementSupport.ts`, `evidence.ts`, `evidenceProposal.ts` (3 files, no app consumer) | **EXISTS** |
| **1b** | Same matcher, applied to a **SKILL ITEM** (≤30 chars) rather than a profile record | — (no caller passes a skill item) | — | Executed against the built module (`api/dist`): `supportIn({requirement:'Experience leading enterprise architecture and cloud strategy', recordText:'Enterprise Architecture', minQuoteChars:20, minQuoteWords:4, …})` → `{"ok":false,"reason":"quote_too_short"}`. Same for `Cloud Strategy` (14 ch), `DevSecOps` (9 ch), `Agile Transformation` (20 ch). Only a 53-char synthetic string passed (`ok:true, ratio:0.8`). | **EXISTS-BUT-CONSTRAINED** |
| **1c** | The matcher's **judgement** on skill items once the citation floors are lowered | — | — | Same module, `minQuoteChars:0, minQuoteWords:0, threshold:0.5` → `Enterprise Architecture` `{ok:true, support:0.5, missing:["leading","cloud","strategy"]}`; `Cloud Strategy` `{ok:true, support:0.5}`; `DevSecOps`/`Agile Transformation`/`M&A Integration` `{ok:false, reason:"no_candidate"}`. **It discriminates correctly.** | **EXISTS-BUT-CONSTRAINED** |
| **1d** | "Which incumbents may stay / which are least relevant" — the owner's **two-phase order** | `compactFit.rankOf` / `rankForLabel` / `fitCompactSkills` (`compactFit.ts:107-219`) | `appPackets.ts:699` (the shipped compact resume) **and** `checks.ts:876` (the `compact_skills_fit` check, re-running the same function on purpose) | `grep -rn "fitCompactSkills" api/src` → `appPackets.ts:9,699`, `checks.ts:22,876`. `rankOf`: `if (p.driver === 'posting' \|\| p.requirementId) return 2 // answers the posting - never dropped`; drop pool sorted `rank asc, then last-position-first`. | **EXISTS** — this **is** the owner's rule, already coded, but scoped to compact-resume overspill |
| **1e** | Coverage attribution on an **incumbent (`kept`) row** | `swaps.attribute()` (`swaps.ts:129`) | `swaps.row()` (`swaps.ts:300`) | `grep -n "const attributable" swaps.ts` → `:305 const attributable = action === 'swapped' \|\| action === 'added' \|\| action === 'dropped'` — **`kept` is deliberately excluded**, and `swaps.ts:303-304` says why: *"`kept` is not a change, so it is never presented as posting-driven"*. So today **no `kept` row ever carries a `requirement_id`**. | **ABSENT (deliberately)** — and this is the single load-bearing gap |
| **2** | **Incumbent / "pre-swap" copies** — List B | `pipeline.listBFromCalls(c1, c2)` (`pipeline.ts:316`), recovered from `_unmapped` parser sections | `atsExtra` → the Call-3 prompt only (`pipeline.ts:492-495`). **It is a prompt input, never a stored column.** | `grep -n "LIST_B_TOKEN\|listBFromCalls" pipeline.ts` → 11 hits, all inside `pipeline.ts`. No `list_b` column in `schema.ts`. Its absence IS reported: `pipeline.ts:487` `'Call 3 has no List B to compare against — the ATS pass will merge against an empty list'`. | **EXISTS-BUT-CONSTRAINED** — recovered and warned about, but **not persisted**; the durable incumbent record is `skill_candidate.origin='pass_a'` + `swap_decision.from_label` |
| **2b** | A durable, queryable record of the incumbent set | `appSwaps.writeSwaps` → `skill_candidate` (`origin` ∈ `profile_original\|pass_a\|pass_b`) and `swap_decision.from_label` | `GET /app/packet/{id}/swaps`; `appPackets.ts:699` (compact fit); `checks.ts`; `AssetBlocks.jsx` via `provenance.swaps.swaps` | `schema.ts:564-588` (`swap_decision`), `appSwaps.ts:51-88`. `swaps.ts:229` pushes every original as a candidate — *"Every item in every list produces a row, INCLUDING unchanged ones"* | **EXISTS** |
| **3a** | A **right-hand margin** that names a specific item and offers the owner an action | `app/src/assetBlocks.js` — `restoreOptions` (`:632`), `omitListCaveat` (`:597`), `shortenAction`, `rewordAction`, `keywordActions` | `app/src/screens/AssetBlocks.jsx:583` (`const restores = restoreOptions(...)`), rendered at `:757` as `Put back "<label>"` | `grep -n "restoreOptions" app/src/assetBlocks.js app/src/screens/AssetBlocks.jsx` → `assetBlocks.js:632`, `AssetBlocks.jsx:38,583`. Dropped items already listed at `AssetBlocks.jsx:404-407` under "Taken out of this list". | **EXISTS** — a per-item, per-list owner-action margin is live |
| **3b** | That margin **applying** a structured proposal (accept / reject a stored row) | — | — | Every existing control returns `{label, ask}` — a **natural-language request** the owner edits and sends to the assistant/`ai-edit`. `assetBlocks.js:695` states the shape: *"a REQUEST the reader can edit before sending, never a decision and never a send."* No `accept`/`apply` handler exists for a swap row. | **ABSENT** — the affordance pattern exists; a structured accept does not |
| **3c** | `swap_decision.override_value` / `override_state` (named in the brief) | — | — | `grep -rn "override_value\|override_state" api/src app/src` → **0 hits**. `schema.ts:564-588` column list has neither. Prior ACs already record this: `AC-skill-bank.md:72` *"ABSENT — the names in the brief do not exist anywhere"*; `AC-resume-margin.md:35` marks it a REAL GAP **blocked on owner decisions Q3.1/Q3.2**. | **ABSENT — and must not be built as named** (see Risk R2) |
| **4** | **How an owner decision is persisted today**, end to end | `POST /app/artifact/{artifactId}/owner-edit` (`appCorrections.ts:390`) → updates `packet.pkg_json` **and** inserts `correction(source='owner_edit', frame='applied')` in one transaction (`:365-380`) | `appSwaps.writeSwaps:45-49` reads `correction.replacement where source='owner_edit' and reverted_at is null` → `ownerLabels` → `swaps.row()` emits **`driver:'owner'`** (`swaps.ts:323`) | `grep -n "app.http(" appCorrections.ts` → `owner-edit` (POST), `corrections` (GET), `correction/{id}/revert` (POST). `schema.ts:414,456` — `source` CHECK includes `'owner_edit'`; `schema.ts:601` — `driver` CHECK includes `'owner'`. | **EXISTS — ALREADY BUILT.** The whole "apply only on explicit owner action, recorded as `driver:'owner'`" chain is live |
| **4b** | An owner decision **surviving a rebuild** | `correction` rows are keyed to `artifact_id`, and `writeSwaps` deletes only `swap_decision`/`skill_candidate` for `(packet_id, loop)` | `reapplyOwnerEdits` (`appCorrections.ts`), `correction.ts:175` — *"DECISION A, taken by the owner 2026-08-25: an owner override survives a rebuild"* | `appSwaps.ts:55-56` — the two deletes name `swap_decision` and `skill_candidate` only; `correction` is untouched. | **EXISTS** |
| **5a** | Detecting that **Call 3 was empty** — object granularity | `pipeline.ts:525` `qcApplied = !!p3.value && !isEmptyResult(p3.value)` | Returned to `appPackets`, surfaced in build responses (`appPackets.ts:799,875,1060,1139`) and `packetBuild.ts:18` | `agentJson.ts:90-96` — `isEmptyResult` returns true only when **`vals.every(...)`** are empty. `pipeline.ts:527` warns *"Call 3 (ATS QC) returned an empty object"*. | **EXISTS** |
| **5b** | Detecting that Call 3 was empty **for a specific slot** | — nothing warns | `packetBuild.skillLineage` (`:128-143`) records per-slot `call1/call2/call3/final/winner` into `packet.last_build` | `packetBuild.ts:85-91` states the constraint explicitly: *"This goes into `packet.last_build`, which is **diagnostic only**: nothing scores off it, no gate reads it… It must never be written into `requirement_evidence`, `check_result`, `artifact_score` or `swap_decision`."* On the Trinnex build the object was non-empty (it carried `updatedResumeSummary`), so `qcApplied` was **true** while `finalSkills1`/`finalSkills2` were `""` and `winner: "call2"`. | **EXISTS-BUT-CONSTRAINED** — recorded, deliberately unreadable by any gate, and **not warned about** |
| **5c** | `firstNonEmpty` distinguishing "empty" from "not needed" | `mt17.firstNonEmpty` (`:53-59`) | `mt17.assemblePackage` (`:148-157`) | `mt17.ts:56` — `else if (c != null && String(c).trim()) return String(c).trim()`. An empty string falls straight through with no signal. Docblock `:52` says the guarantee is only *"a section is only null when EVERY source is empty"*. | **ABSENT** — by construction |
| **6** | Cross-slot duplicate removal | `normalise.dedupeAcrossLists` (`normalise.ts:99-123`) | `normalisePackage` at `appPackets.ts:561` — **before** `writeSwaps` at `:618`, and it **mutates the same `pkg`** | `grep -n "normalisePackage\|writeSwaps" appPackets.ts` → `:561` then `:618`. `swaps.ts:174-190` documents the downstream consequence: the deleted item reaches `buildSwaps` as an original with no matching final. | **EXISTS** — as an after-the-fact cleanup, never as a selection constraint |
| **7** | Least-relevant ordering signal quality | `swap_decision.action` + `driver` + `requirement_id` | `compactFit.rankOf` | `compactFit.ts:19-33` records the measurement against the **live table**: `unattributed` 37 rows / 0 with `requirement_id` / confidence 0.000; `posting` 4 rows / 3 with `requirement_id` / 0.500. **`confidence` cannot rank anything.** | **EXISTS-BUT-CONSTRAINED** — rank by the enum, never by `confidence` |

## Reconciliation against open trackers (required before claiming anything is blocked)

| Prior record | What it says | Status now |
|---|---|---|
| `AC-resume-margin.md:387-480` "GAP 3" | `override_value`/`override_state` are a REAL GAP but **must not be built as briefed**: `writeSwaps` would delete them (Finding 3-A), and `to_label` feeds the gate, the score, `changes_cited`'s offender list and the shipped document (Finding 3-B → **tier 1**). Blocked on Q3.1 / Q3.2. | **Still correct on 3-A and 3-B.** **One premise has since changed:** 3-C objected that `correction.source` was constrained to `('profile_figure','generalized')`. `schema.ts:414,456` now includes **`'owner_edit'`**, and `appSwaps.ts:45-49` already consumes it. So the "is `correction` the right home?" question **has been answered in the affirmative by shipped code** — the third edit path 3-C warned against was avoided. |
| `AC-skill-bank.md:72` | `override_value`/`override_state` → 0 hits; *"The override concept is `correction`."* | Confirmed by re-running the grep today. |
| `IMPORT-NOTE.md:134` | Lists the columns as "Not built. The ⇄ swap-back and editable *ships* value." | Origin is the **prototype**, i.e. a PROPOSAL, not an owner block. |

**Conclusion of the table:** nothing this work needs is absent except (1e) coverage on `kept` rows,
(3b) a structured accept, and (5b/5c) a per-slot empty-Call-3 signal. Everything else is extension.

---

## Blast-radius finding that sets the tier (ground-truthed, not assumed)

The obvious implementation is: **give a `kept` (incumbent) row a `requirement_id` when it covers a
requirement.** That single change propagates through code that already exists —
`compactFit.rankOf:113` reads `p.driver === 'posting' || p.requirementId` and returns rank 2,
*"answers the posting - never dropped"*. So the owner's rule arrives for free on the compact path.

**Which means the question that decides the tier is: what else reads `swap_decision.requirement_id`?**

| Consumer | Reads `swap_decision.requirement_id`? | Proof |
|---|---|---|
| `must_have_coverage` | **NO** | `checks.ts:713-800` computes it from `evidenceOf(r)` / `ruleEvidenceOf(r)` — i.e. `requirement_evidence` rows. `grep -n "requirement_id" checks.ts` returns only `:211, :215, :873`. |
| `changes_cited` (offender list) | **NO** | `checks.ts:921-922` — `swaps.filter(s => (s.action==='swapped'\|\|s.action==='added') && s.driver!=='owner')`, then `s.driver !== 'posting'`. Filters on `action` and `driver` only. |
| `artifact_score.composite` | **NO** | `appReviewer.ts:309-310` composites `must_have_coverage` × `keyword_coverage`. |
| `compact_skills_fit` **and the shipped compact resume** | **YES** | `checks.ts:873` `requirementId: sw.requirement_id ?? null`; `appPackets.ts:699` runs the same `fitCompactSkills`. |

**TIER: 1 — accusation grade.** It does not touch a coverage count, but it decides **what text
ships in a document the owner sends to an employer** and it moves a check verdict. Per CLAUDE.md,
tier is a property of the code path. Full process: this AC set before coding, an independent
`verifier` after, every new guard mutation-proven, live verification.

*(The narrowing is still worth having: it means the work does **not** need to defend
`must_have_coverage` or the offender list, which is where the expensive failures have historically
been.)*

---

# PART 2 — ACCEPTANCE CRITERIA

Format: **Given** context, **when** action, **then** observable outcome. Every one is binary.

## Group A — an incumbent that covers a requirement is NEVER auto-replaced

**AC-1 (coverage is computed for incumbents, using the EXISTING matcher).**
Given a packet whose Call-1 lists contain incumbent item `I` and whose opportunity has requirement
`R`, when the build runs, then coverage of `I` against `R` is decided by
`requirementSupport.supportIn()` — the same function `evidence.ts` uses — and by no new matcher.
*Binary:* `grep -c "supportIn" api/src/functions/tests/swaps.ts` (or wherever the caller lands) ≥ 1,
and a repo-wide grep finds **no second** token-overlap/similarity implementation added by this work.
*Falsifier:* a new `similarity`-style scorer appears anywhere → AC-1 fails.

**AC-2 (the item-scale quote floors are OWNER SETTINGS, seeded, never literals).**
Given `supportIn` is called with a skill item as `recordText`, when the call is made, then
`minQuoteChars` and `minQuoteWords` come from named owner-settable values (the
`owner_search_prefs.chk_*` pattern already used by `chk_evidence_threshold` and
`chk_evidence_bullet_run`), and the code contains only a **seeded default**.
*Binary:* the two values resolve from a column; setting the column changes the outcome for a fixture
item. *Evidence this AC is required:* with the citation floors (`MIN_QUOTE_CHARS=20`,
`MIN_QUOTE_WORDS=4`) every real skill item returns `quote_too_short` — measured above for
`Enterprise Architecture` (23 ch), `Cloud Strategy` (14 ch), `DevSecOps` (9 ch),
`Agile Transformation` (20 ch).
*Falsifier:* a literal `0` or `2` passed at the call site with no settings path → AC-2 fails.

**AC-3 (a covering incumbent is protected from replacement).**
Given incumbent `I` covers requirement `R` per AC-1, and a later pass (Call 2 or Call 3) proposes a
different item for `I`'s position, when the package is assembled, then `I` is present verbatim in
the shipped list for that slot.
*Binary:* assemble a fixture where Call 2 replaces a covering `I`; assert `pkg.SkillsBullets1`
contains `I` byte-for-byte after normalisation.

**AC-4 (protection is recorded, not implicit).**
Given AC-3 held for `I`, when `writeSwaps` runs, then `I`'s row has `action='kept'` **and**
`requirement_id` set to `R`'s id, **and** `driver` is unchanged from what `swaps.row()` would
otherwise emit, **and** `verbatim_quote` is `null`.
*Binary:* `select action, driver, requirement_id, verbatim_quote from swap_decision where …` returns
`kept | <not 'posting'> | <uuid> | null`. The last two are required by the live DB constraint
`check ((driver = 'posting') = (verbatim_quote is not null))` (`schema.ts:587`) — a `kept` row must
not claim a citation it did not make, which is the same principle `swaps.ts:303-304` already states.

**AC-5 (the protection flows through the ONE existing ranker, not a second one).**
Given a `kept` row now carries `requirement_id`, when `fitCompactSkills` runs over the packet's swap
rows, then that label ranks 2 and is excluded from the drop pool.
*Binary:* `compactFit.rankOf({action:'kept', driver:'unattributed', requirementId:'<uuid>'})` returns
`2`. *No change to `compactFit.ts` should be needed for this* — if one is, say so explicitly, because
`rankOf:113` already reads `p.requirementId`.

## Group B — a model-preferred alternative is a PROPOSAL, never an application

**AC-6 (the preferred alternative is surfaced, not applied).**
Given incumbent `I` is protected by AC-3 and pass `P` proposed alternative `A` for that slot, when
the packet is rendered, then the shipped document contains `I` and **not** `A`, and `A` is available
to the UI as a proposal keyed to `(list, I)`.
*Binary:* the rendered `pkg` field contains `I` and does not contain `A`; the swaps/provenance
payload returned by `GET /app/packet/{id}/swaps` carries `A` against `I`.

**AC-7 (the proposal is visible in the field margin, naming both sides).**
Given AC-6, when the owner opens the artifact's field for that list, then the right-hand margin shows
one entry per proposal reading, at minimum, the incumbent label, the proposed label, and the reason
the model preferred it — rendered from an exported selector in `app/src/assetBlocks.js`, alongside
`restoreOptions` / `omitListCaveat`, **not** as a new panel.
*Binary:* the new selector is exported from `assetBlocks.js` and consumed in `AssetBlocks.jsx`; the
existing `app/test/` grep-guard style assertion that `AssetBlocks.jsx` computes nothing itself still
passes.

**AC-8 (no proposal, no control — the standing no-dead-UI rule).**
Given a list for which no pass proposed an alternative to any protected incumbent, when the field
renders, then no proposal control appears at all.
*Binary:* zero proposals → the selector returns `[]` and the margin renders no proposal row.

**AC-9 (a proposal never moves a gate, a score, or a coverage count).**
Given proposals exist for a packet, when `evaluateArtifact` runs, then `must_have_coverage`,
`changes_cited`, `keyword_coverage` and `artifact_score.composite` are byte-identical to a run of the
same packet with the proposals removed.
*Binary:* two `evaluateArtifact` runs over identical inputs differing only in the proposal set →
identical `check_result` rows for those four keys.
*Why this is stated:* `checks.ts:873` is the **only** consumer of `swap_decision.requirement_id`, so
this AC is the assertion that it stays that way.

## Group C — application only on explicit owner action

**AC-10 (application requires an owner action and reuses the shipped route).**
Given a proposal for `(list, I → A)`, when and only when the owner activates the control, then the
change is applied by `POST /app/artifact/{artifactId}/owner-edit` with `phrase=I`, `replacement=A` —
the existing route — and **no new write path to `swap_decision` is created**.
*Binary:* the request appears in the network log with exactly that shape; `grep -rn "insert into
swap_decision" api/src` still returns only `appSwaps.ts`.
*Rationale:* `AC-resume-margin.md` Finding 3-A proved a value written onto `swap_decision` is deleted
by the next `writeSwaps` (`appSwaps.ts:55`). `correction` rows are immune — they are keyed to
`artifact_id` and that delete does not name them.

**AC-11 (the owner's decision is recorded as `driver: 'owner'`).**
Given AC-10 fired, when the packet is next rebuilt, then the swap row whose `to_label` is `A` has
`driver = 'owner'`.
*Binary:* `select driver from swap_decision where to_label = '<A>' and packet_id = …` → `owner`.
*Mechanism, already built:* `appSwaps.ts:45-49` selects `correction.replacement where
source='owner_edit' and reverted_at is null` into `ownerLabels`; `swaps.ts:323` emits `'owner'` for a
label in that set, **checked before attribution** so an owner edit that happens to resemble a
requirement is not laundered into `'posting'`.

**AC-12 (nothing is applied without that action).**
Given proposals exist and the owner takes no action, when the packet is rebuilt any number of times,
then no `correction` row with `source='owner_edit'` exists for those proposals and the shipped text
still contains every protected incumbent.
*Binary:* rebuild twice; `select count(*) from correction where artifact_id=… and source='owner_edit'`
→ `0`, and the incumbent is still in `pkg_json`.

**AC-13 (the decision survives a rebuild).**
Given the owner applied `I → A`, when the packet is rebuilt, then `A` is still in the shipped text.
*Binary:* rebuild; assert `A` present. *Mechanism:* `reapplyOwnerEdits` + DECISION A
(`correction.ts:175`).

## Group D — ordering: coverage FIRST, then least-relevant

**AC-14 (two phases, in the owner's order — and it is not a percentage).**
Given a build where the model proposes replacing `N` incumbents, when the selection runs, then
**phase 1** partitions incumbents into `covers ≥ 1 requirement` and `covers nothing`, and **phase 2**
considers for automatic replacement **only** members of the second partition.
*Binary:* a fixture with 10 incumbents of which 4 cover requirements and a pass proposing 10
replacements → exactly 6 are eligible for automatic swap, and the 4 are untouched.
*Falsifier:* any implementation that selects by a ratio, a percentage of the list, or a "retention
floor" number → AC-14 fails. The owner's instruction is explicit: *"tied to actually confirming which
of the template items can stay first and then switching based on least relevant"*.

**AC-15 (within the eligible remainder, order is least-relevant-first, by the existing rank).**
Given phase 2 has an eligible set, when replacements are ordered, then the order is
`compactFit.rankOf` ascending, ties broken by **position in the combined list, last first** — the
ordering `compactFit.ts:193-196` already implements.
*Binary:* the produced order equals the order `fitCompactSkills` produces over the same rows.

**AC-16 (relevance is never ranked by `confidence`).**
Given any ordering decision in this work, when it is made, then `swap_decision.confidence` is not an
input.
*Binary:* `grep -n "confidence" ` over the new ordering code → 0 hits.
*Evidence:* `compactFit.ts:19-27` measured the live table — every droppable row scores `0.000`;
ordering by it *"is a coin flip dressed as a measurement"*.

## Group E — an empty Call 3 is REPORTED, not silently fallen through

**AC-17 (per-slot emptiness is detected).**
Given Call 3 returns a non-empty object in which `finalSkills1` is `''`, when the package is
assembled, then a warning naming that slot is emitted.
*Binary:* build the Trinnex-shaped fixture (`call3 = {updatedResumeSummary:'…', finalSkills1:'',
finalSkills2:''}`); assert `warnings` contains an entry naming `finalSkills1`.
*Why this is not covered today:* `qcApplied` uses `isEmptyResult` (`agentJson.ts:90-96`), which is
`vals.every(empty)` — object granularity. That object is **not** empty, so `qcApplied` was `true`
while both skills slots were blank. `packetBuild.skillLineage` records the per-slot fact but goes
into `packet.last_build`, which `packetBuild.ts:85-91` declares diagnostic-only and forbids any gate
from reading.

**AC-18 (fall-through is distinguishable from not-needed).**
Given slot `S` where the highest-precedence source is empty and a lower one supplies the value, when
`assemblePackage` runs, then the fact that a higher-precedence source was empty is recoverable from
the build's returned data — not only from `packet.last_build`.
*Binary:* for the fixture in AC-17, the build result exposes, for `SkillsBullets1`, that `call3` was
empty and `call2` supplied the value. *Note:* the existing `skillLineage` already computes
`winner: 'call2'` — this AC asks that the same fact reach a **warning channel**, and explicitly does
**not** ask for `last_build` to become gate-readable.

**AC-19 (the warning does not become an accusation).**
Given AC-17 fired, when checks run, then no `check_result` verdict changes as a result.
*Binary:* two runs differing only in whether the warning fired → identical `check_result` rows.

## Group F — cross-slot duplication prevented at selection, dedupe kept as a net

**AC-20 (an item is not selected into two slots).**
Given a pass returns the same item for `skills1` and for `relevant1`, when selection runs, then the
item is placed in exactly one slot **before** `normalisePackage` is reached.
*Binary:* the Trinnex-shaped fixture (Call 2 emitting nine identical items across `skills1` and
`relevant1/2/3`) → after selection and before `dedupeAcrossLists`, no item appears in two of the five
lists.

**AC-21 (`dedupeAcrossLists` stays, and becomes a no-op on a healthy build).**
Given AC-20 held, when `normalisePackage` runs, then `dedupeAcrossLists` returns **zero**
`cross_list_redundancy` changes.
*Binary:* `changes.filter(c => c.rule === 'cross_list_redundancy').length === 0`.
*Explicitly:* `dedupeAcrossLists` is **not** removed. It is the safety net, and it must still fire on
a fixture that bypasses selection.

**AC-22 (no list is left empty by de-duplication).**
Given the same fixture, when the package is assembled, then none of `SkillsBullets1/2`,
`RelevantBullets1/2/3` is empty **unless** its source was empty at Call 1 too.
*Binary:* assert each of the five rendered blocks is non-empty. *This is the user-visible defect:*
three empty Relevant blocks shipped in the Trinnex resume.

## Group G — the regression guard

**AC-23 (one H-case per invariant, slug-named, and every one mutation-proven).**
Given the work is complete, when `node --test api/test/` runs, then the suite contains at least these
slugged H-cases, and **each has been proven to FAIL with its defect reinstated**:

| Slug | Guards | The mutation that must make it fail |
|---|---|---|
| `H:covering-incumbent-never-auto-swapped` | AC-3 | Allow a covering incumbent into the replacement pool |
| `H:kept-row-carries-no-citation` | AC-4 | Set `driver='posting'` (or a `verbatim_quote`) on a `kept` row |
| `H:proposal-is-not-applied` | AC-6, AC-12 | Write the proposed label into `pkg` at build time |
| `H:owner-apply-writes-correction-not-swap` | AC-10 | Point the apply path at `swap_decision` — this reinstates the exact `appSwaps.ts:55` data loss `AC-resume-margin.md` Finding 3-A measured |
| `H:coverage-before-least-relevant` | AC-14 | Order the whole list by relevance and cut at a percentage |
| `H:relevance-not-ranked-by-confidence` | AC-16 | Sort the drop pool by `confidence` |
| `H:empty-call3-slot-is-reported` | AC-17 | Restore object-granularity-only detection |
| `H:no-cross-slot-duplicate-at-selection` | AC-20, AC-21 | Remove the selection-time uniqueness constraint — the guard must fail **even though `dedupeAcrossLists` still cleans up**, which is the whole point |
| `H:swap-requirement-id-not-a-coverage-input` | AC-9 | Add `swap_decision.requirement_id` to `must_have_coverage`'s numerator |

**AC-24 (a mutation that will correctly FAIL TO FAIL, stated in advance).**
Removing `dedupeAcrossLists` while AC-20's selection constraint holds will leave the suite green,
because the two are behaviourally equivalent on a healthy build. That is not proof
`H:no-cross-slot-duplicate-at-selection` is inert — it is why that guard must assert on the state
**before** `normalisePackage`, and why a second fixture must bypass selection to keep the deduper
covered. Say this rather than claim the assertion is proven.

---

# PART 3 — RISKS, AND WHAT WOULD MAKE THIS NOT WORTH DOING

**R1 — TIER 1. This decides what ships in a document sent to employers.**
`swap_decision` → `fitCompactSkills` → `appPackets.ts:699` is the compact resume's Core Skills line,
and `checks.ts:876` re-runs the same function for `compact_skills_fit`. A wrong coverage verdict
either protects a useless item (a long line) or exposes a load-bearing one (deleted evidence). The
direction of error must be **toward keeping**, which is the direction `compactFit.ts:127-129` already
argues for. Full tier-1 process is mandatory; no part of it is negotiable on size.

**R2 — Do NOT build `swap_decision.override_value` / `override_state`.** They do not exist (0 hits),
and two prior AC passes already established that building them as briefed specifies data loss:
`writeSwaps` (`appSwaps.ts:55`) deletes every row for `(packet_id, loop)` and re-inserts, so a user
value on that table is one the pipeline is licensed to destroy. **`correction` + `owner-edit` is the
answer**, and unlike when `AC-resume-margin.md` was written, `correction.source` now admits
`'owner_edit'` (`schema.ts:414,456`) and `writeSwaps` already consumes it. Reaching for the columns
anyway is the "extend, don't duplicate" failure with a documented precedent.

**R3 — the honest reason this might not be worth doing: `supportIn` on a bare skill item is a
weak signal, and lowering the quote floors is a real loosening.** Measured above,
`Enterprise Architecture` scores `support: 0.5` against
*"Experience leading enterprise architecture and cloud strategy"* with three of five tokens missing.
Half a requirement's content words, carried by a two-word phrase, is thin ground for "this item is
protected". The floors it must bypass (`MIN_QUOTE_CHARS=20`, `MIN_QUOTE_WORDS=4`) exist because a
short excerpt is not a citation. **The mitigation is that this is a KEEP decision, not a citation:**
nothing is quoted to an employer, nothing enters `requirement_evidence`, and erring toward keeping
costs a long line. **If that framing does not hold — if the coverage verdict ever becomes visible as
a claim rather than as a retention reason — the whole approach should be abandoned rather than
tuned.** The signal is not strong enough to be an assertion about the candidate.

**R4 — the ordering signal is thin at the source.** `compactFit.ts:19-27`'s live measurement:
37 `unattributed` rows, all `confidence 0.000`; 4 `posting` rows. Phase 2's "least relevant" order
therefore rests on `action`+`driver` alone, and if AC-1 succeeds, most incumbents will acquire a
`requirement_id` and rank 2 — **shrinking the drop pool toward empty and making phase 2 mostly
inert.** That is arguably correct behaviour under the owner's rule (nothing gets auto-swapped, which
is what they asked for), but it should be measured on a real packet before building phase 2, or the
ordering work is effort spent on an empty set.

**R5 — coupling to the compact resume.** Because `rankOf:113` already reads `requirementId`, AC-4
changes the compact resume's drop behaviour **as a side effect** of a change made for the full
resume. That is desirable (one ranker, per "apply shared logic once at the core source") but it means
the compact resume must be re-verified even though nothing in `compactFit.ts` was edited. Any AC pass
that omits that verification has an untraced downstream consumer.

**R6 — what is NOT accusation-grade, stated so the tier is not over-applied.** Ground-truthed above:
`swap_decision.requirement_id` is read by `checks.ts:873` **only**. `must_have_coverage` derives from
`requirement_evidence` (`checks.ts:713-800`) and `changes_cited` filters on `action`/`driver`
(`checks.ts:921-922`). So this work does **not** need to defend the coverage count or the offender
list — AC-9 and `H:swap-requirement-id-not-a-coverage-input` exist to keep that true, not to repair
it.

**R7 — open question that changes what gets built (a genuine STOP-worthy one, per CLAUDE.md's three
reasons).** *Where does the proposal live between build and owner action?* Options: (a) derive it on
read from existing `swap_decision` rows (no schema change, no persistence, proposal disappears on
rebuild); (b) a new `swap_proposal` table (survives, but is a new structure needing sign-off under
"extend, don't duplicate"). **This AC set is written to be neutral** — AC-6 says only "available to
the UI as a proposal keyed to `(list, I)`". Option (a) should be tried first and is very likely
sufficient, because `buildSwaps` already retains every original and every final. Do not create a
table before proving (a) insufficient.

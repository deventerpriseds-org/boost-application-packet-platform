# P8 — corrections, comparison, counters, affordances: acceptance criteria

Written COLD by an independent AC agent against `origin/main` at **f4c2f43**, before any P8.1, P8.4
or P8.6 code exists. Scope: **P8.1** (corrections), **P8.4** (comparison dimensions), **P8.5**
(fix/review counters — partly built, so these are the regression guard) and **P8.6** (correction
affordances). P8.2 and P8.7 get a coverage section instead of new criteria — see the end.

62 criteria. Every code fact below was re-read on `origin/main` before it was written down; nothing
here is inferred from the plan's prose. Where the plan and the code disagree, the code is recorded.

---

## The five criteria that decide whether P8 is honest

**P8.1-AC12 — a reverted correction is never re-applied.** The plan names this the highest-risk
interaction and it is the one an implementer will get wrong in the direction that looks like success:
the correction pass runs again, sees the same echo, and "fixes" it a second time. Undo that a user
can perform once and the machine silently undoes is worse than no undo at all.

**P8.1-AC9 — revert restores the field BYTE-FOR-BYTE.** Not "contains the original figure". The
whole merge-field string must hash equal to its pre-correction value. A revert that restores
approximately the original is how "60+ sites" comes back as "60 + sites".

**P8.1-AC17 — the gate is recomputed inside the revert, not at the next click.** C2 says the gate
reads post-correction state and a revert re-reddens it. If the recompute is deferred to whoever next
presses "Re-run checks", there is a window in which the document contains the employer's figure and
the badge says `pass`. That window is the entire failure.

**P8.1-AC5 — `check_result.state` must accept `'fixed'` IN POSTGRES.** The union in `checks.ts:27`
is `pass|warn|fail|not_applicable` and the DB CHECK at `schema.ts:403` lists the same four. C1
requires a fifth. A TypeScript-only change passes every sandbox test and throws `23514` on the first
live insert — the exact shape of failure this repo's rules exist to catch.

**P8.5-AC1 — one selector, and today there are two.** `assetGate.js:182 attentionSplit()` and
`qcRail.js:119 railCounts()` are two implementations of the same fail-or-warn split over the same
`engineRows()`. They agree by textual coincidence, not by construction. P8.1 adds a third count
(`corrected`); adding it to one and not the other is precisely the R4 violation P8.5 exists to end.

---

## Verified against the code, 2026-08-20

Standing directive: **default to what is already built; depart only for a named defect, recorded.**

| # | Claim | Ground truth on `f4c2f43` |
|---|---|---|
| **V-1** | X2 (`regen` reachable) gates P8.1-AC7 | **CLOSED, with a residual.** `appPackets.ts:382, 457, 558` all read `regen` from the request body; `PacketBuilder.jsx:584` now sends `{regen:true}` from the ATS modal's rebuild. **But two of the three UI entry points still replay the cache**: `PacketBuilder.jsx:490` (`onClick={buildAll}`) and `:510` ("Build entire packet") pass no options — at `:490` the React SyntheticEvent lands in `opts`, so `opts.regen` is read off an event object. P8.1's idempotency and never-re-apply criteria must be exercised through **all three** paths, because they behave differently. |
| **V-2** | Corrections are per artifact (`correction.artifact_id`, per the backlog) | **`pkg_json` is per PACKET.** `appPackets.ts:319` reads `select pkg_json ... from packet where id = $1`, and `TEMPLATE_META` gives `resume` and `compact_resume` byte-identical placeholder sets (`insertions.ts` header comment). A correction applied "to the resume" mutates the text the compact resume, and any field-sharing artifact, reads. An artifact-keyed correction row over a packet-keyed store is a grain mismatch that has to be resolved before the first row is written, not after. |
| **V-3** | `generalize()` is available for P8.2's rewrite half | **It exists and has ZERO callers.** `grep -rn "generalize" api/src app/src` → `figureEcho.ts` only; `checks.ts:25` imports `scanEcho` alone. The rewrite half of R3 is unbuilt, exactly as the plan says. |
| **V-4** | `scanEcho` can supply the candidate's substitute figure (`60+` → `62`) | **It cannot, today.** `scanEcho` keys the profile side on the EXACT figure (`profileByKey = new Map(profile.map(f => [f.key, f]))`), so it answers "does the candidate also state 60?" — never "what is the candidate's corresponding number?". `62` is a different key and is invisible to it. P8.1's `source='profile_figure'` needs a nearest-analogous-figure resolver that does not exist, and inventing one that guesses is worse than generalizing. |
| **V-5** | `insertion.method` can record a human edit | `Method = 'model_rewrite' \| 'template_fill' \| 'manual'` — `manual` is reserved and **nothing produces it** (`insertions.ts:62-70`), deliberately, so a model change is never laundered as human judgement. P8.6's edits are the first thing entitled to it. Extend that union; do not add a parallel provenance field. |
| **V-6** | The deep-link machinery is new work | **Already built.** `qcRail.js` ships `sectionIdForOffender()`, `countLink()`, `inertReason()` and the `QC_HOOKS` selector table; `AssetGateDrawer.BlocksTab` scrolls and outlines `focusField`. P8.5's deep-link criteria are regression guards over existing code, not a build. |
| **V-7** | The UI harness cannot express P8's ACs (plan §6) | **Stale — D3 landed.** `.github/workflows/ui-verify.yml` now takes `count_sel`, `count_min`, `count_max`, `expect_absent`, `click_sel`, `measure_sel`, `viewport_w`, `viewport_h`. Every P8.4/P8.5/P8.6 UI criterion below is expressible; none may be waived as unverifiable. |
| **V-8** | An unverified caller cannot write | **`requireWrite` lets ANY unverified request write the demo workspace** (`appSession.ts:74`: `if (verified \|\| owner === DEMO_EMAIL) return null`). A correction and a revert are audit-bearing rows; `reverted_by` on a demo write must record the demo identity, never a real owner's email. |
| **V-9** | The correction rules can be modelled on the prototype | **Do not transcribe them.** `qc/data.js:427-433` is a 7-entry literal applied at RENDER time with `useState` undo (plan §4). Copying it produces the hardcoded-config violation the repo forbids and an undo that survives nothing. |

---

## P8.1 — corrections that fix what can be fixed (26 criteria)

### The row

**P8.1-AC1.** Given a deterministic correction is applied to a generated field, when the correction
pass commits, then a `correction` row exists carrying non-null `section_id`, `phrase`,
`replacement`, `reason`, `source`, and a stable reference to the artifact or packet whose text it
changed, with `reverted_by` and `reverted_at` null.

**P8.1-AC2.** Given the `correction` table, when `insert ... (source) values ('auto')` is executed
directly against the live database, then Postgres rejects it with SQLSTATE `23514` — `source` is
constrained by a DB CHECK to the enumerated set (`profile_figure`, `generalized`, plus whatever
P8.6 adds), not validated only in TypeScript.

**P8.1-AC3.** Given `correction.section_id`, when a row is written for an artifact of type `resume`,
then `section_id` is one of the 7 strings returned by `mergeFieldsFor('resume')` (`TEMPLATE_META`
placeholders); an insert naming a field the template does not have is rejected, not stored.

**P8.1-AC4.** Given the grain mismatch in V-2, when a correction is written for a field shared by two
artifacts of one packet (`resume` and `compact_resume` share all 7 placeholders), then exactly ONE
correction row governs that text, and re-running checks on BOTH artifacts reports the same string for
that field. Two rows, or two artifacts disagreeing about one merge field, fails this criterion.

**P8.1-AC5.** Given C1 replaces a deterministic `fail` with a corrected state, when the engine
persists that row, then `select distinct state from check_result` on the LIVE database returns
`fixed` and `schema.ts`'s CHECK constraint enumerates it. A `CheckState` union extended in
TypeScript alone fails this criterion even though `npm test` passes.

**P8.1-AC6.** Given a check whose offender has no deterministic correction available, when the pass
runs, then that row's state is `fail` (unchanged) and no `correction` row is written — C1 turns a
fail into `fixed` **only** where a correction actually exists.

### Applied before Doc injection, into `pkg_json`

**P8.1-AC7.** Given an artifact whose package contains a posting-only figure, when
`POST /api/app/artifact/{id}/document` completes, then `select pkg_json->>'<section_id>' from packet`
contains `replacement` and does not contain `phrase`. The stored package is the assertion target: a
system that substitutes at render time leaves `phrase` in `pkg_json` and passes any UI-only check.

**P8.1-AC8.** Given the same build, when it completes, then the `insertion` row for that
`merge_field` at that `loop` has `after_text` containing `replacement`, and the Google Doc reachable
at `artifact.doc_url` does not contain `phrase` — proving the correction landed before
`injectValues(token, id, varsForType(art.type, pkg), meta.isSlides)` (`appPackets.ts:344`) rather
than after it.

**P8.1-AC9.** Given `sha256(pkg_json->>'<section_id>')` captured before any correction, when the
correction is applied and then reverted, then the hash of that field equals the pre-correction hash
exactly. A revert that leaves a differing whitespace, a straightened quote, or a re-wrapped line
fails, and must fail loudly (an error the user sees) rather than writing an approximation.

**P8.1-AC10.** Given a correction row, when it is applied, then the post-correction field equals the
pre-correction field with exactly one span replaced: every character outside
`[offset, offset+phrase.length)` is unchanged and the length delta equals
`replacement.length - phrase.length`. A correction that also normalises whitespace elsewhere in the
field fails.

**P8.1-AC11.** Given a field in which `phrase` occurs more than once, when the correction is applied,
then the row records which occurrence it changed (an offset, not just the string) and the revert
restores that same occurrence. A blind `String.replace` (first occurrence) or `replaceAll` both fail:
the first is unrevertible when the occurrences differ in context, the second changes text nobody
reviewed.

### Never re-applied after a revert — and idempotent before one

**P8.1-AC12.** Given a correction that has been reverted, when the correction pass runs again against
the SAME package via each of the three paths independently — `POST /artifact/{id}/checks`,
`POST /opportunity/{id}/packet/build-all` with no body (cache replay, V-1), and
`POST /artifact/{id}/document` with `{"regen":false}` — then after each: no new `correction` row
exists for that `(section_id, phrase)`, `count(*) from correction` for that packet is unchanged, and
`pkg_json->>'<section_id>'` still contains `phrase`.

**P8.1-AC13.** Given a reverted correction, when the package is REGENERATED (`{"regen":true}`) and
the new text for that field differs from the reverted text, then the pass's decision to suppress or
re-apply is read from a recorded column on the correction row (name it — e.g. the package hash or
loop the revert applies to), the same inputs produce the same decision on a repeat run, and the row
states which happened. Behaviour that depends on evaluation order, or that is documented only in a
comment, fails this criterion.

**P8.1-AC14.** Given a package with one correctable echo, when the correction pass runs twice with
no intervening edit, then `pkg_json` is byte-identical after the second pass (`md5(pkg_json::text)`
equal) and the second pass writes zero new `correction` rows.

**P8.1-AC15.** Given a correction whose `replacement` itself contains a figure the posting also
states, when the pass runs, then the correction is REFUSED (no row, finding stays open and named)
rather than applied and then corrected again. No correction may create a new offender of the same
check.

**P8.1-AC16.** Given a correction pass, when it runs on any package, then it terminates within a
stated, asserted iteration bound (state the number), and text still failing at the bound is reported
as an open finding rather than looped over. An unbounded fixpoint loop fails even if it happens to
converge on today's data.

### The gate (C1, C2) and the length re-check (C4)

**P8.1-AC17.** Given an artifact whose only failing check is corrected, when the correction pass
commits, then `artifact_gate.gate` is computed in the SAME transaction, `artifact_gate.run_id`
equals the `check_result.run_id` of the post-correction rows, and the gate reflects the corrected
text — not the text as generated.

**P8.1-AC18.** Given that same artifact with `gate='pass'`, when a correction is reverted, then the
revert's own response returns the recomputed gate as `fail` (or `warn`), `artifact_gate.computed_at`
has advanced, and the badge reddens with no further user action. A revert that leaves the previous
gate row untouched until someone presses "Re-run checks" fails.

**P8.1-AC19.** Given a `warn` gate that a human overrode with a recorded reason, when a correction is
applied or reverted and the gate is recomputed, then `artifact_gate.override_by`, `override_at` and
`override_reason` are null and `approvalBlock()` blocks approval again — an override approves a
specific set of findings, not the artifact forever.

**P8.1-AC20.** Given a correction that lengthens a skill from 28 to 33 characters (over
`chk_skill_max_chars` = 30), when the pass completes, then the SAME run emits `skill_char_limit` with
that string in `offenders` and the offender text names the correction that caused it (its id and
`"phrase" -> "replacement"`). A length check computed before corrections are applied — reporting
`pass` on text that is now 33 characters — is the C4 failure.

**P8.1-AC21.** Given a length failure that was present BEFORE any correction ran, when the pass
completes, then that offender does NOT name a correction. Stamping every length offender with the
most recent correction id satisfies AC20 and fails this one.

### Counting, absent evidence, config, auth

**P8.1-AC22.** Given an artifact with 4 corrections, 1 deterministic `fail` and 3 reviewer `warn`
rows, when any surface renders its counts, then it renders `1 to fix`, `3 to review` and a separate
corrections count of `4`; `attentionCount()` returns 2 (the fail and the warns it already counts,
unchanged by the corrections); and no rendered string on that surface is `8`, `5`, or any other sum
of the three populations.

**P8.1-AC23.** Given an opportunity with no posting text, or an owner with no readable profile
(`scanEcho().notApplicable === true`), when the correction pass runs, then zero correction rows are
written, `posting_figure_echo` remains `not_applicable`, and the UI reads "could not be checked",
never "0 corrections needed", "nothing to correct" or any clear-sounding phrasing. Absent evidence is
`not_applicable`, never `pass`.

**P8.1-AC24.** Given the correction engine's source, when it is grepped, then it contains no literal
`phrase -> replacement` table (no `Record<string, string>` of replacement pairs, and none of the
seven entries at prototype `qc/data.js:427-433`), and every threshold it consults resolves through
`loadThresholds()` / `owner_search_prefs` — code may seed a first value, never own one.

**P8.1-AC25.** Given an unverified request carrying `?owner=von.ellis@enterpriseds.io`, when it POSTs
a correction or a revert, then the API returns 401 and no row changes; given the same request against
the demo workspace, it succeeds and `reverted_by` records the demo identity — never a real owner's
email (V-8).

**P8.1-AC26.** Given a correction already reverted, when the revert endpoint is called a second time,
then it returns 409 with the server's own reason, `reverted_at` still holds the FIRST timestamp, and
`pkg_json` is unchanged; given two reverts of one correction issued concurrently, exactly one mutates
the field (conditional update on `reverted_at is null`), and one 409 is returned.

---

## P8.4 — posting-vs-profile comparison, graded (12 criteria)

**P8.4-AC1.** Given the comparison is computed for an opportunity, when it commits, then each
dimension is a persisted row (name the table) carrying `dimension_key`, the posting ask, the profile
value, the profile value's source, a graded `fit`, and a nullable qualifier `note` — the JD step
reads rows, it does not recompute the comparison at render.

**P8.4-AC2.** Given "extend, don't duplicate", when the profile side of a dimension is resolved, then
its value comes from an `owner_fact` row whose key exists in `FACT_CATALOGUE` (`scope.largest_team`,
`scope.largest_budget`, `experience.years_leadership`, …) and the row records that key. A second
profile store stood up for the comparison is a rejection, not an implementation.

**P8.4-AC3.** Given a dimension with no owner fact and no evidence, when it is graded, then `fit` is
the explicit no-evidence value, the profile column renders "No evidence in your profile" with a link
to Settings ▸ Facts, and the row is never blank, never `0`, and never omitted from the table.

**P8.4-AC4.** Given the grading rule in SPEC §4.2, when `covered/total` is exactly `0.99` the grade is
`strong`; at exactly `0.70` it is `moderate`; at `0.6999` it is `weak`. Assert with integers that
round adversarially: 99/100 → strong, 7/10 → moderate, 69/100 → weak.

**P8.4-AC5.** Given a dimension with `total = 0` (nothing in the posting speaks to it), when it is
graded, then the grade is the no-evidence value and the rendered percentage is absent — never `NaN`,
never `100%`, never `strong`. A 0/0 that grades strong is the vacuous green this layer exists to
prevent.

**P8.4-AC6.** Given any row graded `moderate` or `weak`, when it is stored, then `note` is non-empty,
enforced by a DB CHECK (a strong row may have a null note; a moderate or weak row may not) — the
backlog's acceptance line is "every moderate/weak grade carries the reason", and a nullable column
enforced only in application code fails.

**P8.4-AC7.** Given the posting ask on any dimension row, when it is compared to the posting, then it
is a substring of `normalizePostingText(jd_real)` for that opportunity. A model paraphrase in that
column is a fabrication in the position a user reads as the employer's words.

**P8.4-AC8.** Given C7, when `#/packet/{oppId}/jd` is rendered for a real opportunity, then
`ui-verify.yml` with `expect_absent` finds none of "posting lines", "passes" or "distribution" as
labels, and `expect` finds the four fit cards and the four column headers (Dimension · The posting
asks for · Your profile evidences · Fit).

**P8.4-AC9.** Given the dimension list is "configurable per role family", when an owner adds a
dimension through the settings surface for a role family, then an opportunity whose `persona_key`
belongs to that family shows the new dimension with no code change and no deploy; the code path
contains only a seed of the eight named dimensions.

**P8.4-AC10.** Given R4, when the Must-have fit card shows `n of m`, then `m` is the same population
`artifact_score.must_have_coverage` is computed over (must-haves less eligibility-only and
fact-settled rows, per `checks.ts`), or the card states on screen why its denominator differs. Two
must-have counts on one screen that disagree with no explanation fails.

**P8.4-AC11.** Given the comparison is graded "against the stored profile only" (SPEC §4.2), when it
renders before any asset is built, then it renders fully and its copy says nothing has been written
into an asset yet — the comparison must not require a packet, an artifact, or a check run to exist.

**P8.4-AC12.** Given the comparison is computed, when it completes, then zero rows are added to
`usage_metering` for it and a second computation over unchanged inputs produces identical rows —
the comparison is deterministic and costs no tokens.

---

## P8.5 — one source per number, and every number deep-links (12 criteria)

Partly built. These are the regression guard; every one must fail if the guarded code is reverted.

**P8.5-AC1.** Given R4's "one source", when the fail-or-warn split is computed anywhere in `app/`,
then exactly ONE function computes it. Today `assetGate.js:182 attentionSplit()` and
`qcRail.js:119 railCounts()` both do, over the same `engineRows()`; P8.5 collapses them or proves by
test that they cannot drift. Adding `corrected` to one only is the failure this criterion catches.

**P8.5-AC2.** Given any artifact payload, when the badge, the drawer summary, the Checks tab note,
the QC rail strip and the Review-and-send list all render, then all five print the same `to fix` and
`to review` pair for that artifact, and no surface prints their sum under a single label.

**P8.5-AC3.** Given a payload with 1 deterministic `warn` and 3 reviewer `fail` rows, when counts are
computed, then `toFix === 1` and `toReview === 3` — asserted as two exact values, never as an
identity over their sum. The named anti-pattern is `(attention - rev) + rev === attention`
(`app/test/assetGate.test.mjs`, P7 doc), which is true of every pair of numbers.

**P8.5-AC4.** Given a payload whose rows are all `not_applicable`, when it renders, then `to fix` and
`to review` are both 0, the gate word is `warn` (`gateFor` returns warn for all-NA and for zero rows),
and the surface states that checks could not run — never "all clear", never a green pass.

**P8.5-AC5.** Given P8.1's corrections exist for an artifact, when any count renders, then
`corrected` is its own labelled number, is never added into `to fix` or `to review`, and a
correction never appears in the fail/warn attention list.

**P8.5-AC6.** Given an artifact with no `artifact_gate` row, when the packet rollup renders, then it
is counted as `unchecked` in its own field and is not reported as having nothing to fix.

**P8.5-AC7.** Given a deterministic finding whose offender resolves to a merge field, when its count
is clicked in the live UI (`ui-verify.yml` `click_sel` on `[data-qc="qc-check-count"]`), then the
drawer opens on the Blocks tab, the target block is scrolled into view, and the `expect` string —
the field's label — is present after the click.

**P8.5-AC8.** Given an offender that resolves to no merge field, when it renders, then it carries
`[data-qc="qc-count-inert"]` and states why it cannot be opened; it is never a clickable element that
does nothing.

**P8.5-AC9.** Given the ATS analysis modal is open, when a per-asset row or "Open QC →" is clicked,
then the modal is gone (`expect_absent` on its root) in the same interaction that reveals the
destination — SPEC §4.3's "any navigation out of the modal closes it first".

**P8.5-AC10.** Given a payload where the server reports `attention = 1` while sending zero rows
needing attention (the prototype's own defect, plan §5), when the drawer renders, then the
"The gate and its findings do not agree" note is shown, listing the disagreement; the UI never
quietly renders one of the two numbers.

**P8.5-AC11.** Given `gate = 'fail'` where the only failing rows are `engine='reviewer'`, when the
drawer renders, then the reconciliation note reports it (D6: a reviewer row may never produce a
fail), and the reviewer rows appear under Independent review, never under the measured rules.

**P8.5-AC12.** Given every count P8.5 governs, when the DOM is inspected, then each renders one of
the `QC_HOOKS` selectors and no surface hand-types a `data-qc` string — the hook table and the DOM
cannot drift, which is what makes any of these criteria provable on the live site.

---

## P8.6 — ad-hoc correction affordances (12 criteria)

**P8.6-AC1.** Given "Ask for a change" on a field, when it is sent, then the request carries
`section_id` equal to that merge field, the server rejects a `section_id` outside
`mergeFieldsFor(artifact.type)` with 400, and the panel's own label names the field
(`ASK FOR A CHANGE · <field label>`) with the copy "Scoped to this field only."

**P8.6-AC2.** Given every field block on an asset step, when the step renders, then the count of
`Show original` controls equals the number of blocks rendered — including static template blocks.
For `resume` that is `mergeFieldsFor('resume').length` (7) generated blocks plus every static block
the screen shows. A static block that omits the control fails.

**P8.6-AC3.** Given a static template block, when `Show original` is opened, then it renders the
template's ACTUAL text including its `{{merge field}}` placeholders, sourced from the template
document itself (the id the pipeline copies), not from a literal pasted into `app/`. If the template
text cannot be read, the control says so — a plausible sample rendered as template text is fabricated
data and fails.

**P8.6-AC4.** Given a generated field that a later pass rewrote, when `Show original` is opened, then
it shows that field's `insertion.before_text` for the prior loop, and for a field with no prior
version it says so explicitly rather than rendering an empty panel.

**P8.6-AC5.** Given a keyword that displaced a profile item, when "Put back <original>" is used, then
the field's text contains the exact `swap_decision.from_label` string, byte-equal, and the displaced
keyword is gone.

**P8.6-AC6.** Given "Drop it, leave the line open", when it is used on an item that was the only
evidence for must-have `#n`, then after the recompute `#n` appears in the `must_have_coverage`
offenders and `artifact_score.must_have_coverage` is strictly lower than before. Coverage that stays
flat after a drop means the claim was silently kept — the exact failure the backlog's acceptance line
names.

**P8.6-AC7.** Given any of the three keyword controls, when the control is rendered (before it is
clicked), then it states the coverage consequence naming the requirement id it will open or close.
A consequence disclosed only after the action fails.

**P8.6-AC8.** Given the profile's skill bank is empty, when "Swap for another skill…" renders, then
it is disabled with "no skills in your profile to swap in" — never an empty picker, which reads as
"nothing matched".

**P8.6-AC9.** Given a user who never visits the QC step, when they change a field from the asset step
and reload, then `pkg_json->>'<section_id>'` holds the changed text — R6's "correct anything you
notice, in place" is satisfied through the asset step alone.

**P8.6-AC10.** Given any P8.6 edit, when it persists, then it writes a `correction` row through the
SAME table and endpoints as P8.1 (with its own `source` value, admitted by the DB CHECK per
P8.1-AC2) and is revertible by the same revert endpoint under P8.1-AC9's byte-exactness rule. A
separate manual-edit table is a rejection.

**P8.6-AC11.** Given a P8.6 edit lands in a merge field, when the insertion rows are next written,
then that field's `insertion.method` is `manual` — the value reserved in `insertions.ts:17` and
produced by nothing today (V-5). A model rewrite must never be recorded as `manual`, and a human
edit must never be recorded as `model_rewrite`.

**P8.6-AC12.** Given every control P8.6 adds, when `app/src/` is grepped, then none is
`onClick={() => toast(...)}` or otherwise unwired, and no control renders a hardcoded name, count or
status as live data — a feature that is not ready is hidden, not faked.

---

## P8.2 and P8.7 — what the shipped tests already cover, and what they do not

### P8.2 (R3, posting figures)

**Not on `main`.** `api/src/functions/tests/figureEcho.ts` and `api/test/figureEcho.test.mjs` do not
exist at `f4c2f43`; they live on `claude/qc-p8-2-figures` (PR #10). Until that lands, none of the
coverage below is on the deployed system.

**Covered by `figureEcho.test.mjs` (18 cases) + `checks.test.mjs` R3 (5 cases)** — do not re-derive:
extraction of currency / percent / bare-count / spelled forms and their collisions; a percentage is
not its leading digit; a bare four-digit year is not a figure; no stray whitespace in a reported
figure; the counted noun is part of an unmarked claim while a marked figure stands alone; plural
folds to singular by an exact suffix rule; the three-way disposition (`echo` /
`shared_with_profile` / `profile_only`); missing posting OR missing profile is `not_applicable`
and never a clean scan; HTML postings are compared through the one canonical normalizer; offsets
address the generated text exactly; `generalize` never invents a number; the scan is deterministic
and makes no model call; every populated field is scanned, not just the summary; the check `warn`s
rather than reddening the gate.

**NOT covered — and mostly unbuilt:**

1. **The entire rewrite/generalize half.** R3 says figures "are rewritten automatically … and each
   rewrite is logged and revertible". Nothing rewrites anything: `generalize()` has zero callers
   (V-3) and there is no log and no revert. **It depends on P8.1's correction table** — every
   criterion in P8.1 above is therefore also P8.2's acceptance for its second half.
2. **Substituting the candidate's own figure (`60+` → `62`).** No test, no code, and the current
   data structure cannot express it (V-4): `scanEcho` can say the candidate also states 60, never
   what the candidate's analogous number is. An AC is needed that the substitute figure is READ from
   a named profile source and that a resolver which cannot find one falls through to `generalize()`,
   and where that returns null (percentages, sub-2-digit currency) the finding is escalated —
   never a guessed number.
3. **Swap results (`Org Scaling 60+`, `P&L $18M`).** The field-level scan covers list text
   incidentally because the list is a merge-field string, but no check reads `swap_decision.to_label`
   and nothing makes the prototype's `P&L $18M` swap illegal (C3). No test asserts a swap carrying a
   posting figure is refused or corrected.
4. **Non-numeric echoes.** "Wording kept from the posting" has no `check_key`, no row and no
   surface. Unbuilt and untested.
5. **C4.** No test re-runs a length check after a correction, because no correction exists yet
   (P8.1-AC20/AC21 are its acceptance).
6. **Live evidence.** Every R3 case is a synthetic fixture. Nothing shows the check producing a
   non-vacuous verdict on real data — see the sandbox section for the Trinnex query that would.

### P8.7 (presentation constraints)

In flight in a separate lane (`app/`: theme.css, PostingAnalysis, Today, packetBuilder); its ACs are
not re-derived here. What it does **not** cover, and what therefore stays open in this document:

- The §4.2 comparison table and fit cards are **P8.4**, not P8.7 — P8.7's tab/legend/highlight work
  does not deliver a two-sided comparison, and P8.4 is blocked on P8.7 landing only because both
  edit `app/`.
- The §4.8 "Done for you" change log, its per-row `Change it` / `Review →`, and the finished framing
  R1 demands are **P8.1/P8.6**. No P8.7 criterion asserts a corrections list exists.
- The keyword-highlight / posting-echo treatments P8.7 owns (highlighter yellow vs pale tan
  underline) become load-bearing once corrections exist: a corrected span must be distinguishable
  from an echo that was kept. That reconciliation is unassigned in both lanes and needs an owner.

---

## ACs that cannot be verified from the sandbox

The sandbox settles the pure-controller criteria: `cd api && npm ci && npm test` and
`cd app && npm test` (Node 22's built-in runner, X4) plus `npm run build` cover P8.1-AC10, AC11,
AC14, AC15, AC16, AC21, AC22, AC24; P8.4-AC4, AC5, AC6 (logic half), AC12; P8.5-AC1, AC3, AC4, AC5,
AC6, AC12; P8.6-AC2, AC12. Greps settle the structural ones (P8.1-AC24, P8.5-AC1, P8.5-AC12,
P8.6-AC12).

Everything below needs the live environment. The sandbox cannot reach Postgres and cannot reach
`azurewebsites.net`; all three workflows are on `main`. Worked example throughout: the Trinnex
opportunity `9f9c370a-4ac9-441e-b58e-02e3ffcf669e`, artifact
`cfdd82e7-35e9-49e9-a492-c1bb7b46d861`, owner `von.ellis@enterpriseds.io`.

**`db-query.yml`** — every criterion whose assertion target is a stored row or a DB constraint:
P8.1-AC1..AC5, AC7, AC9, AC12, AC13, AC14, AC17, AC19, AC26; P8.4-AC1, AC2, AC6, AC7; P8.5-AC6.

```sql
-- AC1/AC3/AC4: the rows, and the field they name
select id, section_id, phrase, replacement, source, reason, reverted_by, reverted_at
  from correction where artifact_id = 'cfdd82e7-35e9-49e9-a492-c1bb7b46d861' order by created_at;

-- AC2/AC5/AC6: the CONSTRAINTS, not the TypeScript
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid in ('correction'::regclass, 'check_result'::regclass) and contype = 'c';

-- AC7/AC9/AC14: the package is the ground truth, not the render
select md5(pkg_json::text) as pkg_hash,
       md5(pkg_json->>'ResumeSummary') as field_hash,
       pkg_json->>'ResumeSummary' as text
  from packet p join artifact a on a.packet_id = p.id
 where a.id = 'cfdd82e7-35e9-49e9-a492-c1bb7b46d861';

-- AC17/AC19: gate and findings from ONE run
select g.gate, g.run_id, g.computed_at, g.override_by, c.check_key, c.state, c.offenders
  from artifact_gate g join check_result c
    on c.artifact_id = g.artifact_id and c.run_id = g.run_id
 where g.artifact_id = 'cfdd82e7-35e9-49e9-a492-c1bb7b46d861';

-- P8.2 gap 6: is the figure check non-vacuous on real data, or not_applicable?
select state, observed, offenders from check_result
 where artifact_id = 'cfdd82e7-35e9-49e9-a492-c1bb7b46d861' and check_key = 'posting_figure_echo'
 order by created_at desc limit 1;
```

**`api-test.yml`** (`method` / `path` / `body`, and `omit_auth` for the refusal cases; it mints a
verified session token, so mutations work and `reverted_by` records that owner) — every criterion
whose assertion target is an endpoint's behaviour: P8.1-AC7, AC8, AC12, AC13, AC18, AC25, AC26;
P8.6-AC1 (the 400), AC9.

```
POST /api/app/artifact/cfdd82e7-35e9-49e9-a492-c1bb7b46d861/checks?owner=von.ellis@enterpriseds.io
POST /api/app/opportunity/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/packet/build-all   body {"regen":false}
POST /api/app/opportunity/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/packet/build-all   body {"regen":true}
POST /api/app/correction/{correctionId}/revert                                    (twice, for AC26's 409)
POST /api/app/correction/{correctionId}/revert  with omit_auth=false and ?owner=von.ellis@…  (AC25's 401)
```
A new route needs **~90–120s** of worker converge before it stops 404ing, and a deploy must be
verified with `./scripts/wait-run.sh sha:api-deploy.yml:$(git rev-parse HEAD)` — never against
"the latest run" (H15).

**`ui-verify.yml`** (D3 landed: `count_sel`, `count_min/max`, `expect_absent`, `click_sel`,
`measure_sel`, `viewport_w/h` — V-7) — every criterion whose assertion target is the rendered SPA:
P8.1-AC18 (the badge reddening), AC22, AC23 (the wording); P8.4-AC3, AC8, AC10, AC11; P8.5-AC2,
AC7, AC8, AC9, AC10, AC11; P8.6-AC2, AC3, AC4, AC5, AC7, AC8.

```
route "#/packet/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/jd"  owner von.ellis@enterpriseds.io
  expect_absent "posting lines;passes"            expect "Dimension;The posting asks for;Your profile evidences;Fit"     # P8.4-AC8
route "#/packet/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/qc"
  click_sel '[data-qc="qc-check-count"]'          expect "<field label>"                                                 # P8.5-AC7
  count_sel '[data-qc="qc-count-inert"]'                                                                                 # P8.5-AC8
```
Reminder from the harness: seed `localStorage.ee_auth_user` and **reload** — a hash-only nav will not
remount React past the login gate.

**Not verifiable by any vehicle, and must not be claimed:** P8.1-AC8's "the Google Doc does not
contain the phrase" needs the Doc's exported text — either extend `ui-verify.mjs` to fetch the
published doc, or restate the criterion against `insertion.after_text` and say so.

---

## Housekeeping the implementer inherits

- **H-cases.** Each fixed defect becomes an assertion in `api/test/hardening.test.mjs` (append-only,
  shared). H1–H25 are taken; H26 (P3) and H27 (P8.3) are pre-allocated to other lanes. A P8.1 lane
  should claim **H28+** and record the allocation in the plan's lane table before writing.
- **Lane collisions.** `checks.ts`, `appChecks.ts` and `appPackets.ts` are owned by the P8.2 and P3
  lanes right now. P8.1 touches all three. Sequence it after those land, or agree the split first —
  a lane that has not pushed a branch has produced nothing.

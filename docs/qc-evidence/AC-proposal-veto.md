# WHAT:       ACs for "a proposal counts until vetoed" -- brief 1 of 2 (default-count + the veto data model).
# WHY:        Owner, verbatim: "I already said proposals can count until vetoed. make room for the vetoed
#             data and confirm a way to use what we gain to get the score until library is added to
#             supplement not drop it. why wouldn't the reviewer run when the packet is built?" This brief
#             answers clauses 1-2 only (BRIEF-proposals-count-until-vetoed.md split it in two after run
#             33544936097 hit max_tokens). Score/reviewer are BRIEF-interim-score-and-reviewer.md.
# SUPERSEDES: nothing.
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   read directly against branch claude/incumbent-wins-swap @ 8814f14 (HEAD; brief cited 79ceb12,
#             one commit behind HEAD at read time -- "Split the AC brief in two" landed after it). Grep
#             commands and their results are inlined below rather than only asserted.

# AC: a proposal counts until vetoed, and where the veto lives

## 0. Ground truth check, before anything else

`git fetch origin && git status --short --branch`: clean, `claude/incumbent-wins-swap` in sync with
`origin/claude/incumbent-wins-swap` at `8814f14`. No drift.

**Correction to the brief's own framing:** `ruleEvidenceOf` is a local `const` inside `runChecks()`
(`checks.ts`), not an exported/shared function. `grep -rn ruleEvidenceOf api/src` hits 5 files, but four of
those hits are prose comments *naming* it, not imports — verified by reading each. There is nothing to
"widen" as a shared symbol. What actually fans out to the rest of the system is the **check_key
`must_have_coverage`** (and, downstream of it, `evidence_placed` / `responsibilities_addressed`), which is
what A2 below enumerates.

**The load-bearing discovery this pass made, not stated anywhere in the brief:** the veto control is not
merely *missing* — a "veto" button, route and DB write **already ship**, and the write is silently inert
for the common case.

```
app/src/screens/PostingAnalysis.jsx:445-448
  <button ... data-qc={POSTING_HOOKS.confirmNo} onClick={() => send('reject')}>
    {busy === 'reject' ? 'Saving…' : 'Not this one'}
  </button>

api/src/functions/tests/appRequirements.ts, evidenceConfirm(), decision === 'reject':
    await client.query(
      `update evidence_confirmation set withdrawn_at = now(), withdrawn_reason = $1
        where opp_id=$2 and requirement_text=$3 and source_key=$4 and char_start=$5
          and char_end=$6 and record_sha256=$7 and withdrawn_at is null`, [...])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, decision: 'reject', seq } }
```

This is an `UPDATE`, not an `INSERT ... ON CONFLICT`. `evidence_confirmation` only ever gets a row when
the owner has previously clicked "Yes, that is my evidence." For a proposal nobody has confirmed yet —
which, once A1 below lands, will be **most proposed rows**, because nothing will require a click before
they count — this `UPDATE` matches zero rows. The route still returns `{ ok: true, decision: 'reject' }`.
Clicking "Not this one" on a fresh proposal today does *nothing* and reports success.

```
grep -rn "decision.*reject\|decision: 'reject'" api/test/*.mjs   -> no matches
grep -rln "evidenceConfirm(" api/test/*.mjs                       -> no matches
```

Zero tests call the `evidenceConfirm` HTTP handler at all, in either decision. `evidenceConfirmDb.test.mjs`
only exercises confirm-side invariants (`H:confirmed-proposal-is-carried-to-the-gate`,
`H:a-changed-requirement-voids-the-confirmation`, `H:confirmation-survives-re-extraction`). This is not a
gap to design around later — the shipped control is currently misleading, and AC 6 below is a regression
guard for it, not a new feature.

Also confirmed by reading, and load-bearing for B1: `evidencePresentation()` (`app/src/postingAnalysis.js`)
derives exactly three states from a row — `awaitingConfirmation`, `vetted`, `confirmedAt` — and there is no
fourth. A rejected-then-reverted row and a never-touched row are **indistinguishable on the wire**: both
read back with `confirmedAt: null`, because `loadRequirementsWithEvidence`'s join filters
`c.withdrawn_at is null`. So today there is no way to represent "the owner looked at this and said no" —
only "said yes" (a confirmation row exists) or "said nothing" (no row, or a withdrawn row, which reads
identically).

## 1. Feasibility table

| Dependency | Producer | Consumer today | Proof | Verdict |
|---|---|---|---|---|
| `must_have_coverage` counts `exact`/`anchored` and `vetted`, excludes unconfirmed `proposed` (fail-open, not an allow-list) | `checks.ts` `ruleEvidenceOf` | `must_have_coverage`, `responsibilities_addressed`, `evidence_placed` (same file) | Read `checks.ts`: `(isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))`, with the file's own comment naming this fail-open and citing `H:a-judged-row-counts-and-a-proposed-one-does-not` | ALREADY BUILT, but the wrong default for the owner's new instruction |
| Owner **confirms** a proposal (promotes it) | `PostingAnalysis.jsx` `ConfirmProposal` → `api.evidenceConfirm` → `appRequirements.ts` `evidenceConfirm(decision:'confirm')` | `evidence_confirmation` row; read back via `loadRequirementsWithEvidence`'s join; rendered as `ev.confirmedAt` | `insert into evidence_confirmation ... on conflict (...) do update set withdrawn_at=null`; `PostingAnalysis.jsx:441-444` | ALREADY BUILT |
| Owner **vetoes** a proposal | `ConfirmProposal` "Not this one" → `decision:'reject'` → `evidenceConfirm` | An `UPDATE ... where withdrawn_at is null` against a row that, for a never-confirmed proposal, does not exist | See §0 above; `grep` for any test on `decision:'reject'` returns nothing | **ABSENT** — button and route exist; the write is a no-op for the case that matters, and it is untested |
| Persisted reason a claim was vetoed / the model's own named gap | `supportJudge.parseSupportVerdict` → `v.missing` | none — `appRequirements.ts`'s escalation loop only does `note('support_' + v.refusal)`, an in-memory tally (`escalation_refusals`), never written to any row | Read the loop: `if (agrees) {...} else if (v.supported) { note('support_span_disagreed') } else { note(`support_${v.refusal || 'declined'}`) }` — no `INSERT` in any branch that stores `v.missing` | ABSENT |
| A claim-identity key that survives re-extraction (needed for any veto row) | `evidence_confirmation`'s own key: `(opp_id, requirement_text, source_key, char_start, char_end, record_sha256)` | already proven for confirm; not yet used for veto | `schema.ts` comment: "the only stable identity is the CLAIM ITSELF"; `H:confirmation-survives-re-extraction` proves it for confirm | EXISTS-BUT-CONSTRAINED — the mechanism is right, the table's `withdrawn_*` pair currently means "undo a yes," not "assert a no" |
| A distinct, allow-listed `method` gate (vs. today's exclude-by-name gate) | none | `ruleEvidenceOf`'s `isProposed`/`isConfirmed`/`isVetted` helpers | Read `checks.ts`: the gate is `NOT proposed-and-unconfirmed`, i.e. every future `method` value counts unless someone remembers to add it to an exclude clause | ABSENT (exists as an exclude-list; the allow-list itself does not exist) |
| Visual distinction: default-counted-but-unvetoed vs. `vetted` vs. `confirmed` | `evidencePresentation()` | `PostingAnalysis.jsx` `EvidenceLine` | Read `postingAnalysis.js:415-467`: exactly `awaitingConfirmation` / `vetted` / `confirmedAt`, no fourth state | ABSENT (the two existing states were built for a world where proposed rows never counted by default) |
| `requirement_coverage` / `coverageJudge.ts` — a *document*-coverage judge, a different axis from `supportJudge`'s *profile*-coverage judge | `coverageJudge.ts`, `schema.ts` `requirement_coverage` | `checks.ts` `judgeVerdicts` / `covers()` | `schema.ts`: `create table if not exists requirement_coverage (...)`; `checks.ts`: `const covers = (r) => (v?.covered===true) || coversIn(...)` | ALREADY BUILT — **not the same concept**, do not conflate it with the veto work; flagged only so nobody re-derives it as "the missing piece" |
| Score composite folding in proposal/veto state ("use what we gain … supplement not drop it") | — | `artifactScore.ts` | out of scope per the brief's own split | DEFERRED to brief 2 — not designed here, not claimed done |
| Reviewer running at packet-build time | — | `appPackets.ts` / `appReviewer.ts` | out of scope per the brief's own split | DEFERRED to brief 2 — not designed here, not claimed done |

## 2. Design answers (A1-A4, B1-B4)

**A1 — the gate condition.** Neither of the brief's two offered readings is exactly right. The owner's own
sentence — *"I already said proposals can count until vetoed"* — states a **default that already
switched**: proposed rows count **on creation**, no click required. Reading (i) (agreement/`vetted` is the
gate) contradicts "until vetoed," which names the escape hatch as a veto, not a promotion test. Reading
(ii) as posed ("`vetted` merely ranks higher") is closer but incomplete: it does not say what happens to
the second-read agreement pass at all. The actual shape: **`proposed` counts by default; `vetted` stops
being a promotion gate and becomes a corroboration signal shown alongside the row (a stronger badge:
"two independent reads agree"); the owner's veto is the only thing that removes a row from the
numerator.** This is a deliberate inversion of the house rule and must be called out explicitly, not
absorbed silently — see A2.

**A2 — the safety question.** Enumerating every consumer of the `must_have_coverage` check_key (the real
fan-out, per the §0 correction):

| Consumer | File | Now asserts something only a model supports? | Required disclosure |
|---|---|---|---|
| `runChecks` observed string / offender list | `checks.ts` | Yes — the numerator | Extend the existing `includedNote`/`tail` pattern (already used for `vetted`) to name the count of **counted-by-default, unvetoed proposals**, not just vetted ones |
| `gateFor` / `attentionCount` / `artifact_gate` | `checks.ts`, `appPackets.ts` | Yes — a `pass` gate can now rest on an un-reviewed model claim | The gate computation is unchanged (still reads `check_result.state`), but the `observed` string it inherits must carry the count above so an override or a `ready` status is never silently model-only |
| `artifact_score.must_have_coverage` / `composite` / `band` | `artifactScore.ts` | Yes | Reuse the existing `must_have_source` free-text column (already present for exactly this purpose — see `mh.observed` handling at `artifactScore.ts:96-121`) to carry the same disclosure |
| Reviewer-agreement composite recompute | `appReviewer.ts:299-310` | Yes, transitively — it reads `artifact_score.must_have_coverage` directly | Must inherit the same caveat; flag in brief 2 rather than silently changing reviewer-agreement numbers with no visible explanation |
| `remediation_loop.coverageObserved` | `remediation.ts:250-262` | No — already explicitly reporting-only, gated on `evidence_placed` not `must_have_coverage` (schema.ts's documented retarget) | Cosmetic only: extend the same disclosure for consistency, not because it gates anything |
| `qcSummaryScore`, `AssetGateDrawer.jsx`, `qcRail.js` | `app/src` | Yes, downstream of the API strings | No new logic needed if the API's `observed`/`note`/`*_source` strings are rendered verbatim, which is this codebase's existing pattern (`comparisonStaleNote`, `keywordLibraryState`) |

Nothing here proposes weakening "only an exact rule may accuse" without saying so. A2 is answered
correctly if, and only if, every one of the surfaces above prints — in the same sentence as the number —
how many of the counted requirements are unvetoed model proposals.

**A3 — allow-list, not exclude-list.** Yes, and it is required, not optional: today a **new** `method`
value is fail-open (it counts unless a clause explicitly excludes it). Rewritten as
`const COUNTS = new Set(['exact','anchored','proposed','vetted'])` with the veto check first
(`isVetoed(r) ? null : COUNTS.has(method) ? evidenceOf(r) : null`), a value added to the DB `CHECK` later
and not added here is **excluded by default** — fail-closed, the direction every other rule in this file
already takes.

**A4 — visual distinction.** Required. Three states must render distinctly wherever a row appears:
counted-by-default-unvetoed (new — needs its own badge, distinct from both `vetted`'s "challenged and
held" and `confirmedAt`'s "you confirmed this"), vetted, and confirmed. Surfaces: `EvidenceLine`
(`PostingAnalysis.jsx`), the `must_have_coverage` offender/observed strings, `AssetGateDrawer.jsx`,
`artifact_score.must_have_source`.

**B1 — where the veto lives.** `evidence_confirmation` is the right table to extend, not a new one —
"Extend, don't duplicate" applies directly, because the hard part (a claim identity that survives
`delete from requirement where opp_id=$1`, keyed on `record_sha256`) is identical for a "yes" and a "no"
and duplicating that key logic in a second table is exactly the parallel-system shape the org rule
forbids. But it is a real schema change, not a relabeling: **add a `decision` column**
(`text not null default 'confirmed' check (decision in ('confirmed','vetoed'))`), and stop overloading
`withdrawn_at`/`withdrawn_reason` to mean two different things. Today `withdrawn_*` means "undo a yes."
Under this design it means "undo whichever decision this row holds" (see B4) — the pair's own existing
CHECK (`(withdrawn_at is null) = (withdrawn_reason is null)`) is unaffected and still correct. A veto and a
confirmation are the same *shape* of claim (this requirement, this excerpt, this record, at this
digest) with opposite *polarity* — one column, not one table each.

**B2 — where the `missing` text lives.** Give it an identity key on the SAME row rather than a bare
counter. Add a `missing text[]` column (or reuse `extra`, following the `vettedNote()` precedent already
used for the agreement-pass reasoning) on the decision row, written whenever `supportJudge` names a gap —
persisted regardless of whether the row ends up `proposed`/`vetted`/vetoed. Today this is thrown away
(`note('support_' + refusal)` is an in-memory tally only); an owner asked to judge a proposal currently
sees the excerpt but never the reason a second read declined to corroborate it.

**B3 — should a profile edit invalidate a veto?** No, not the same way it invalidates a confirmation, and
the asymmetry the brief names is real and decides this. A stale *confirmation* lapsing is fail-closed (it
removes a claim from the numerator). Under A1's new default, a stale *veto* lapsing would be fail-**open**
— the vetoed requirement would silently start counting again the moment ANY unrelated part of the profile
changed, because `record_sha256` is computed over the whole record, not the cited span. That is the exact
"a check goes green on absent evidence" shape this codebase's own rules exist to prevent, just pointed at
a veto instead of a coverage check. So: do not gate veto-lapse on whole-record `record_sha256` equality.
Use the narrower `evidence_record_changed` signal (already computed elsewhere in this codebase for exactly
"the quote still holds, the ranking is stale") — if the cited span is unchanged, the veto stands regardless
of edits elsewhere in the record; if the cited span itself changed, surface it as "this veto's excerpt
changed — please re-review" rather than silently dropping it.

**B4 — what un-vetoes?** Owner-only, explicit, symmetric with un-rejecting a confirmation today: a new
decision timestamp/actor is recorded (reuse `confirmed_at`/`confirmed_by` generically, or add
`decided_at`/`decided_by` if `decision` makes the existing names read oddly — a naming call for
implementation, not an AC). The audit trail must show both the original veto and the reversal, not merely
overwrite the row — same reasoning the schema comments already give for why `evidence_confirmation` never
deletes a withdrawal.

## 3. Acceptance criteria

**AC1 (default count).** Given a `requirement_evidence` row with `method='proposed'` and no
`evidence_confirmation` decision of any kind, when `must_have_coverage` is computed, then that row counts
toward the numerator (this is the behavior change from today's exclude-list).

**AC2 (veto removes it).** Given the same row, when the owner records a veto for it (however B1's design
is implemented), then `must_have_coverage`'s numerator excludes it, and the offender list names it with a
sentence distinguishing "vetoed by you" from "no evidence found."

**AC3 (veto persists for a never-confirmed row — the regression this pass found).** Given a
`method='proposed'` row that has never had any `evidence_confirmation` row, when the owner clicks "Not
this one" (`decision:'reject'` today, or its renamed equivalent), then a queryable row exists afterward
recording the veto — NOT a 200 response with zero rows written. This is a regression guard on a defect
that ships today, not a new feature.

**AC4 (allow-list, fail-closed on unknown methods).** Given a `requirement_evidence` row whose `method` is
some value not in `{'exact','anchored','proposed','vetted'}` (a future value nobody has wired up yet),
when `must_have_coverage` is computed, then that row does NOT count, and no code change is required
elsewhere to make that true — the gate is written as `COUNTS.has(method)`, not as an exclusion.

**AC5 (veto survives re-extraction).** Given a vetoed claim, when the posting is re-extracted
(`writeRequirements`'s `delete from requirement where opp_id=$1`), then the veto is still in force for
the identical claim (same requirement text, source, offsets, record digest) — mirroring
`H:confirmation-survives-re-extraction`.

**AC6 (veto does not silently lapse on an unrelated edit).** Given a vetoed claim whose cited excerpt is
untouched, when the owner edits an unrelated part of their profile (changing `record_sha256` for the whole
record but not the cited span), then the veto still holds and the requirement still does not count.

**AC7 (missing-gap text is retrievable).** Given a proposal that a second-read pass declined to
corroborate because it named a gap, when the owner is shown that row for a decision, then the gap text the
model named is visible on the row — not merely tallied into an operational counter.

**AC8 (three visually distinct states).** Given three rows — one counted-by-default-and-unvetoed, one
`vetted`, one owner-`confirmed` — when they render in `PostingAnalysis.jsx`, `AssetGateDrawer.jsx`, and the
`must_have_coverage` offender/observed strings, then each renders a distinguishable word/badge/tone, and no
two of the three collapse to the same rendered state.

**AC9 (disclosure travels with the number).** Given a `must_have_coverage` result where N of the counted
rows are unvetoed proposals, when that result reaches `artifact_score.must_have_source`, the gate's
`observed` string, or any frontend surface reading either verbatim, then the sentence names N — "coverage
rose" must stay falsifiable, per this codebase's own standing rule.

**AC10 (un-veto is possible and audited).** Given a vetoed claim, when the owner reverses the veto, then
the row's decision changes back and the reversal is recorded with its own actor/timestamp — the original
veto is not deleted, only superseded, matching how `evidence_confirmation` already treats a withdrawn
confirmation.

**Error states / edge cases.**
- A veto on a row whose `method` is `exact`/`anchored` (a rule's own finding, not a proposal) must be
  refused with the same 409 the confirm route already gives for "this excerpt was resolved by a rule" —
  a human cannot veto a deterministic finding, matching the existing symmetry with confirm.
- A veto request for a requirement/opportunity the caller does not own returns 404, not 403 (matching the
  existing `evidenceConfirm` non-owner behavior).
- An unverified session gets 403 (matching the existing check) — a veto is exactly as accusation-grade as
  a confirmation and needs the same audit-actor guarantee.

## 4. Guards to mutation-prove

Run each through `/workspace/eds-claude-skills/scripts/mutate.sh` (three outcomes: `FIRED`/`INERT`/
`NOT-APPLIED` — a hand-rolled two-outcome script is banned per this repo's standing rule).

1. **`H:proposed-counts-by-default`** — a bare, un-decided `proposed` row counts toward
   `must_have_coverage`. Mutation: reinstate the old exclude-clause
   (`isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r)`) in place of the allow-list; the test
   asserting a bare proposed row counts must FAIL.
2. **`H:vetoed-proposal-never-counts`** — a vetoed row is excluded even though the new default is to
   count. Mutation: delete the veto check from the gate function; the test must FAIL.
3. **`H:allow-list-not-exclude-list`** — a `method` value that is not `{exact,anchored,proposed,vetted}`
   is excluded by default. Mutation: revert the allow-list to a `!== 'unknown_future_method'` exclude
   check; the test must FAIL (this is the guard that proves the code is actually an allow-list, not
   merely styled like one).
4. **`H:reject-writes-a-veto-row-even-when-never-confirmed`** — the regression guard for the defect this
   pass found. Mutation: revert the reject branch to the current `UPDATE ... where withdrawn_at is null`
   with no `INSERT` fallback; a test that asserts a queryable row exists after rejecting a
   never-confirmed proposal must FAIL.
5. **`H:veto-survives-re-extraction`** — mirrors `H:confirmation-survives-re-extraction`. Mutation: drop
   the `ON DELETE CASCADE`-safe claim-identity key (key the veto on `requirement_id` instead of
   `requirement_text`+claim tuple); the test must FAIL after a re-extraction.
6. **`H:veto-distinguishable-from-confirmed-and-vetted`** — three rows in three different states render
   three different words/tones. Mutation: collapse the new default-counted state's badge into the
   existing `vetted` badge; the rendering-distinctness test must FAIL.
7. **`H:stale-veto-does-not-silently-reinstate-coverage`** — an unrelated profile edit must not silently
   un-veto a requirement. Mutation: gate veto-lapse on whole-record `record_sha256` equality (the
   confirmation table's own rule, applied to veto); a test that edits an unrelated part of the profile
   and asserts the requirement stays excluded must FAIL.
8. **`H:missing-gap-text-persisted`** — a named gap from the second-read pass is retrievable on the row.
   Mutation: revert the persistence write back to a bare `note()` counter increment; a test reading the
   gap text back off the row must FAIL.

## 5. Things in the brief that are wrong or incomplete

- **The framing that `ruleEvidenceOf` has "every consumer" to enumerate as if it were shared code is
  wrong.** It is a local const inside `runChecks()`. The real fan-out — and the thing A2 should actually
  enumerate — is the `must_have_coverage` check_key and its two siblings, which the table in §2 does.
- **The brief treats B1 as "which table should hold the veto" as if the veto surface does not exist
  yet.** It does: a button, a route, and a decision parameter already ship. The real finding is that the
  write is a silent no-op for the case that matters (a never-confirmed proposal) and is completely
  untested. AC3 / guard 4 exist because of this, and it changes the shape of the work from "add a
  surface" to "fix a shipped surface and then extend its data model" — the latter is riskier because a
  UI control already trains the owner to expect it works.
- **A1's framing as a binary between two readings is incomplete.** Neither offered reading matches the
  owner's sentence structure ("count until vetoed" names the veto as the exception, not the agreement
  test as the promotion gate). §2's A1 answer states the reading actually used going forward; anyone
  building from the brief's two options alone would build the wrong default.
- **`requirement_coverage` / `coverageJudge.ts` is not mentioned in the brief at all**, and it is close
  enough in shape (a model-judge verdict table with its own key) that an implementer could mistake it for
  "the library" the owner's third clause refers to, or reuse its schema pattern for the veto by mistake.
  Flagged in the feasibility table so brief 2's authors do not have to re-discover it.

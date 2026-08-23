# Acceptance Criteria — Owner Confirmation of Model-Proposed Evidence

**Scope:** ACs, adversarial risks, and regression-guard spec ONLY. No implementation, no source edits.
**Tier (CLAUDE.md "Match the process to the risk"): 1 — accusation grade.** This change decides
`must_have_coverage`, which feeds `artifact_score.must_have_coverage`, the composite, and the gate.
Full process applies: these ACs before code, independent `verifier` after, every new guard
mutation-proved, live verification on the deployed Function.

---

## 0. Ground truth actually read (so a reviewer can check my premises)

| Claim used below | Source read |
|---|---|
| `proposed` rows are excluded from the numerator by `ruleEvidenceOf` | `api/src/functions/tests/checks.ts` ~L611-640 |
| Three surfaces already promise a confirmation that does not exist | `checks.ts` L671 (`…; confirm it`), L684-ish `proposed.length` → `"awaiting your confirmation"`; `appRequirements.ts` L~200 comment; measured observed string |
| `must_have_coverage` divides by `coverable`, excludes are NAMED in the observed string | `checks.ts` ~L655-675 (`excluded[]`, `tail`) |
| `writeEvidence` DELETES then re-inserts; the delete is now scoped by `canEscalate` | `appRequirements.ts` L157-195 |
| Deterministic evidence explicitly DELETES a stale proposal for the same requirement | `appRequirements.ts` L~205-215 (`delete … where method='proposed'`) |
| `loadRequirementsWithEvidence` picks ONE row, `order by ratio desc nulls last, source_key, char_start` | `appRequirements.ts` L~400-425 |
| A proposed row has `ratio = NULL` by design (no fabricated composite) | `evidence.ts` `EvidenceRow.ratio` docblock L83-92 |
| `verifyRequirementRows` nulls **every** key prefixed `evidence_` on a row that no longer proves | `appRequirements.ts` L452-490, `EVIDENCE_COL_PREFIX` |
| **The gate path does NOT run `verifyRequirementRows`** | `grep -rn verifyRequirementRows api/src` → only `appRequirements.ts:499,559`. `appChecks.ts:78-100` builds `evidence.bySeq` straight off `loadRequirementsWithEvidence` |
| `owner_fact.confirmed_at` precedent: "null = nobody has vouched for it", + `check (confirmed_at is null or value is not null)` | `schema.ts` ~L604-627 |
| Server-side actor rule, verbatim precedent to cite | `appChecks.ts` L274-275: *"The actor is resolved SERVER-side from the verified session — a client-supplied actor would make the audit row worthless."* and `schema.ts` L538 (same sentence on `artifact_gate`), plus `check ((override_by is null) = (override_at is null))` |
| `artifactGateOverride` requires `requireWrite` **and then** an explicit `if (!verified) → 403` | `appChecks.ts` L276-281 |
| `resolveOwner` returns `verified:false` for a bare `?owner=`; `requireWrite` still ALLOWS an unverified write when owner === demo | `appSession.ts` L46-76 |
| `requirement_evidence.requirement_id … on delete cascade`; unique `(requirement_id, source_key, char_start, char_end)` | `schema.ts` L404-424 |
| `writeRequirements` does `delete from requirement where opp_id=$1` on every re-extraction → cascades away all evidence | `appRequirements.ts` L348-380 |
| `EVIDENCE_THRESHOLD = 0.7`, owner-configurable as `owner_search_prefs.chk_evidence_threshold` | `evidence.ts` L215-220, `checkPrefs.ts` L53,174,211 |
| H-case naming is a SLUG, never a number (H26 enforces) | `CLAUDE.md`, `api/test/hardening.test.mjs` (212 tests) |

**Terminology used throughout**
- **claim identity** = the tuple that says *what was confirmed*: `(requirement text as extracted, source_key, char_start, char_end, quote bytes, record_sha256)`. NOT the row `id`, NOT `requirement.seq`, NOT `requirement_id` alone.
- **pending proposal** = `method='proposed'` with no confirmation and no rejection.
- **confirmed proposal** = `method='proposed'` carrying a valid, non-stale confirmation.

---

## 1. Happy path — a confirmation moves the number

**AC-1.** Given opportunity `2cb56fb3` whose `must_have_coverage` currently reports
`0/12 must-haves evidenced (8 model-proposed, awaiting your confirmation, …, not counted either way)`,
when the owner confirms exactly ONE pending proposal and the checks are re-run,
then `must_have_coverage.observed` reports `1/12 must-haves evidenced`, the count of
"model-proposed, awaiting your confirmation" drops from 8 to 7, and the confirmed requirement no
longer appears in `offenders`.

**AC-2.** Given the same run, when the observed string is read,
then it names the confirmed population **separately and in words** — e.g.
`1/12 must-haves evidenced (1 confirmed by you; 7 model-proposed, awaiting your confirmation, not counted either way)` —
so a reviewer can subtract human-confirmed coverage from rule-evidenced coverage without opening the database.
*(Argued in §7. This is not cosmetic: `checks.ts` already justifies naming the proposed count on the surface with
"a reviewer cannot tell a better profile from a chattier model". Confirmation adds a third way the number can
rise — a more agreeable owner — and the same argument forces it onto the same surface.)*

**AC-3.** Given the owner confirms all 8 pending proposals, when the checks re-run,
then `must_have_coverage` observed reads `8/12 must-haves evidenced (8 confirmed by you; …)`,
`state` is still `fail`/`warn` (4 remain unevidenced) — i.e. confirmation raises the numerator and
**never** short-circuits the check to `pass` by any path other than the numerator reaching the denominator.

**AC-4.** Given a confirmed proposal, when `responsibilities_addressed` and `evidence_placed` are computed,
then the same rule applies uniformly: a confirmed proposal counts for those checks too, an unconfirmed one
does not — because all three read `ruleEvidenceOf`, and a divergence between them is the exact defect the
independent verifier already caught once ("this line and `evidence_placed` were left on the unfiltered
`evidenceOf`, 34 and 46 lines under the helper written to prevent exactly this").
**Binary test:** grep the coverage/`responsibilities_addressed`/`evidence_placed` branches — all three
must call the same single helper; zero call sites of the raw `evidenceOf` may remain in a numerator.

**AC-5.** Given a confirmed proposal, when the artifact score is recomputed,
then `artifact_score.must_have_coverage` moves consistently with the check's numerator/denominator
(no second computation of coverage anywhere), and `composite` remains non-null only under the existing
`check (composite is null or (must_have_coverage is not null and …))` rule.

---

## 2. The safety property — an UNCONFIRMED proposal must still never count

**AC-6.** Given a `method='proposed'` row with no confirmation, when the checks run,
then that requirement appears in `unevidenced`, is listed in `offenders` with the
`a model proposes "…" from <source>; confirm it` sentence, and is counted in the
"model-proposed, awaiting your confirmation, not counted either way" tail — i.e. behaviour is
**byte-identical to today**.

**AC-7 (non-vacuity — how the guard is proved not to be theatre).** The guard is only meaningful if a
test can distinguish "excluded because unconfirmed" from "excluded because nothing was there".
Given TWO synthetic `runChecks` inputs identical in every field except the confirmation
(row A: `method='proposed'`, unconfirmed; row B: same row, confirmed), when both are run,
then A reports `0/1` and B reports `1/1`. **Both assertions live in the same test.**
A test that only asserts A is vacuous — it passes on an implementation where `ruleEvidenceOf`
returns `null` for every proposed row forever, which is today's code and proves nothing about the new path.

**AC-8.** Given any evidence row whose `method` is `'exact'` or `'anchored'` that somehow carries a
confirmation (data drift, manual SQL, a future migration), when coverage is computed,
then it counts because it is a rule row, and the confirmation changes nothing about it —
the counting predicate must be `method = 'proposed' AND <valid confirmation>` **OR** `method <> 'proposed'`,
never "`confirmed_at IS NOT NULL`" alone. See Risk R-2.

**AC-9.** Given the escalation tier is OFF (default/unconfigured), when a packet is built,
then no proposals are created, no confirmation UI appears, and coverage is computed exactly as it is
today — this change introduces zero behaviour on the default path.

---

## 3. Survival across `writeEvidence` — the critical one

`writeEvidence` DELETEs evidence rows for the opportunity and re-inserts. Two delete scopes exist:
transport-less (`method <> 'proposed'` — proposals survive) and escalating (`delete everything` — proposals
are destroyed and re-proposed). A confirmation stored only as a column on a row that the escalating path
deletes is destroyed by the very next full build. That is not acceptable: the owner performed an
accusation-grade act and the system silently discarded it.

**AC-10 (survival of an unchanged claim).** Given the owner confirmed a proposal, when `writeEvidence`
runs again on the escalating path and the model re-proposes **the same claim identity**
(same `source_key`, `char_start`, `char_end`, same `quote` bytes, same `record_sha256`, same requirement text),
then the resulting row is **confirmed**, with the ORIGINAL `confirmed_at` and `confirmed_by` preserved —
not re-stamped to `now()`, not the confirming actor overwritten by whoever triggered the build.
**Binary test:** confirm → re-run escalating `writeEvidence` with a stub transport returning the identical
proposal → `select confirmed_at, confirmed_by` equals the pre-run values to the microsecond.

**AC-11 (a changed claim does NOT inherit the confirmation).** Given the owner confirmed a proposal,
when the underlying profile record changes so that `record_sha256` differs, **or** the model proposes a
different span/quote for that requirement, **or** the requirement's extracted text changes,
then the resulting row is **NOT confirmed**: it is a pending proposal again, it does not count toward
`must_have_coverage`, and it is re-surfaced to the owner for a fresh decision.

> **Argued, because the brief asks for the argument.** A confirmation is not a vote of confidence in the
> *requirement*; it is the owner asserting "*this exact sentence, from this exact record of mine, answers
> this exact requirement*." Every noun in that sentence is load-bearing. If the quote no longer exists at
> those offsets in that record, a surviving confirmation makes the system assert a claim **no human ever
> made** and **no rule can support** — the definition of a fabricated claim, and strictly worse than the
> 0/12 we have today, because 0/12 is honestly empty while a stale confirmation is confidently wrong.
> This is the same reasoning `verifyRequirementRows` already encodes for D19 ("`loadRequirementsWithEvidence`
> returns what the DATABASE says; this returns what is still TRUE") and the same reasoning behind
> `owner_fact`'s `check (confirmed_at is null or value is not null)` — you cannot confirm an absent value.
> Convenience argues the other way ("the owner already said yes, don't nag them") and convenience loses:
> the cost of re-asking is one click; the cost of a fabricated stored claim is the entire premise of the
> gate. **Fail closed.**

**AC-12 (invalidation is recorded, not silent).** Given a confirmation is invalidated by AC-11,
when the owner next views that requirement, then the surface says the confirmation was withdrawn and why
(e.g. "your profile changed since you confirmed this"), rather than the proposal simply reappearing as if
never confirmed. An audit row (see §7) retains the original confirmation and the reason it lapsed.

**AC-13 (re-extraction / cascade).** Given the owner confirmed a proposal and the posting is re-parsed
(`writeRequirements` → `delete from requirement where opp_id=$1` → `on delete cascade` wipes ALL evidence),
when the requirement is re-extracted with **identical** text and evidence is re-resolved to the identical
claim identity, then AC-10 holds (confirmation survives); when the requirement text differs at that `seq`,
then AC-11 holds (confirmation does NOT transfer). See Risk R-1 — `seq` is reused across re-extraction and
is therefore never a valid key for a confirmation.

**AC-14 (transport-less path).** Given a confirmed proposal and a build that calls `writeEvidence` without a
transport (`canEscalate === false` — the gate path, four concurrent artifacts), when it runs,
then the confirmed proposed row survives untouched (today's scoped delete already spares proposals),
**unless** a deterministic rule row now resolves the same requirement — in which case the existing
`delete … method='proposed'` eviction still fires, the rule row wins, and coverage counts it as a rule row.
A rule superseding a human confirmation is an **improvement** in evidence grade and must be allowed;
the audit row records that the confirmation was superseded rather than rejected.

**AC-15 (concurrency).** Given four artifacts of one packet call `writeEvidence` concurrently while the
owner confirms a proposal, when all complete, then the confirmation is either fully applied or absent —
never a row that is `confirmed` while pointing at a quote from a different run. Confirmation and the
evidence rewrite must not interleave into a mixed state.

---

## 4. Interaction with `verifyRequirementRows` (D19 redaction)

**AC-16.** Given a **confirmed** row whose quote no longer verifies against the profile as it stands now,
when `verifyRequirementRows` processes it, then it is redacted exactly like any other unproven row —
every `evidence_*` key nulled, `evidence_state`/`evidence_note` set — and **confirmation grants no exemption**.
**Binary test:** the redaction must remain the by-construction prefix sweep. Any new column that carries
confirmation state onto the joined row MUST be named with the `evidence_` prefix (e.g. `evidence_confirmed_at`,
`evidence_confirmed_by`) so it is nulled by the same sweep. A column named `confirmed_at` on the joined row
would survive redaction and keep asserting "a human vouched for this" beside a quote that was just withdrawn —
which is verbatim the failure the `EVIDENCE_COL_PREFIX` comment exists to prevent.

**AC-17.** Given a confirmed row that fails re-verification, when coverage is computed **anywhere**,
then it does not count. This requires closing the gap found while reading:
**`appChecks.ts` builds `evidence.bySeq` from the RAW `loadRequirementsWithEvidence` output and never calls
`verifyRequirementRows`.** Today that is safe because (a) rule rows were just re-resolved moments earlier and
(b) proposed rows can't count anyway. Once a confirmed proposal counts, a proposal that survived the scoped
delete from an earlier run — pointing at a profile record the owner has since edited — would count on the gate
path with no re-verification at all. **AC:** the gate path must apply the same verification the read path
applies (or an equivalent proof) before any confirmed proposal enters the numerator; a `record_sha256`
equality check alone is acceptable only if it is proved to be the same predicate `verifyEvidence` uses.
**Binary test:** seed a confirmed proposal, mutate the profile record so the offsets no longer slice the quote,
run the gate path → numerator does NOT include it, and the check's `observed` says so.

**AC-18.** Given a confirmed row redacted by D19, when the requirements read path serves it,
then `evidenceState`/`evidenceNote` distinguish "stale, previously confirmed by you" from
"no evidence found" and from "we could not read your profile" — three different claims, per the existing
three-way rule in `shapeRequirementsForApi`. A withheld confirmed excerpt must never be presented as
"no evidence" (this is the invariant `H:stale-evidence-not-absent` already protects for the unconfirmed case).

---

## 5. Rejection

**AC-19.** Given a pending proposal, when the owner rejects it, then it is recorded as rejected with a
server-resolved actor and timestamp, it does not count toward coverage, and it is no longer presented as
"awaiting your confirmation" — the excluded-count tail distinguishes pending from rejected
(e.g. `5 model-proposed, awaiting your confirmation; 3 you rejected`).

**AC-20.** Given a rejected proposal, when escalation runs again and the model proposes **the same claim
identity**, then the proposal is NOT re-presented to the owner as new work — the rejection stands and is
displayed as a settled decision. *(Rationale: a model at `temperature: 0` will re-propose the same excerpt
every run; re-asking makes the queue a treadmill and trains the owner to click through it, which is exactly
how an accusation-grade control degrades into a rubber stamp.)*

**AC-21.** Given a rejected claim identity, when the model proposes a **different** span/quote for the same
requirement, then that is a NEW pending proposal and IS presented. A rejection rejects a claim, not a
requirement.

**AC-22.** Given a rejected proposal, when the owner changes their mind, then they can undo the rejection
(and, symmetrically, undo a confirmation) from the same surface; the audit trail retains both decisions
rather than overwriting. **Binary test:** confirm → un-confirm → coverage returns to the pre-confirmation
number in the very next run, and both events are readable afterward.

**AC-23.** Given a rejection, when `must_have_coverage` reports, then a rejected requirement is counted in
the denominator and named in `offenders` as unevidenced — rejection must never remove a requirement from the
population being judged. *(A requirement the owner declined to vouch for is unmet, not not-applicable —
excluding it would be the exact `not_applicable`-laundered-into-a-numerator defect the coverage block already
documents having been measured and fixed.)*

---

## 6. Authorization

**AC-24.** Given a request to confirm or reject, when `resolveOwner(req).verified` is `false`,
then the route returns **403** with a message naming the reason ("a confirmation needs a verified session —
the audit row records who did it"), even when the resolved owner is `demo@executive-engine.local`.
This is stricter than `requireWrite` on purpose: `requireWrite` permits an unverified write to the demo
workspace, and a confirmation whose actor is "whoever sent the request" is an audit row worth nothing.
Precedent to follow exactly: `artifactGateOverride` calls `requireWrite` **and then** re-checks `verified`.

**AC-25.** Given a verified session for owner X, when X attempts to confirm evidence attached to a
requirement whose opportunity belongs to owner Y, then the route returns **404** (not 403 — do not confirm
the row's existence to a non-owner), and nothing is written.
**Binary test:** the SQL that loads the target row must join `opportunity` and filter `owner_email = $owner`
in the same statement — never a fetch followed by a comparison in JS, and never trusting a client-supplied
opportunity id alone.

**AC-26.** Given any request body, when it contains an actor/email/`confirmed_by` field,
then that field is **ignored**; the stored actor is `resolveOwner(req).owner` from the verified session only.
**Binary test:** POST with `{"confirmed_by":"someone.else@example.com"}` → stored actor is the session email.

**AC-27.** Given the confirm route, when it is registered, then it is registered exactly once
(`H:one-http-registration-per-route` already guards duplicate registrations silently 404ing the second one),
under the existing `app/...` prefix, with `OPTIONS` handled like every neighbouring route.

**AC-28.** Given a confirm request naming an evidence row that is not `method='proposed'`,
or that does not exist, or that is already confirmed, then the response is a deterministic
4xx/idempotent-200 (specified before implementation, not decided at the keyboard) and no duplicate audit
row is created. Confirming twice must not double-count anything.

---

## 7. Audit — what a reviewer must be able to reconstruct in six months

**AC-29.** Given a confirmed proposal, when a reviewer inspects the database months later,
then they can determine, without inference: **who** confirmed (email, server-resolved), **when**,
**what exactly** was confirmed (the quote bytes, the record it came from, the record digest at that moment,
the requirement text at that moment), and **which ruleset proposed it** (`proposal_version` already exists,
nullable, never defaulted — per `H:model-evidence-is-labelled`).

**AC-30 (all-or-none, per the `artifact_gate` precedent).** Given the confirmation columns,
when the schema is inspected, then a CHECK enforces that actor and timestamp are present together —
`check ((confirmed_by is null) = (confirmed_at is null))` — mirroring
`check ((override_by is null) = (override_at is null))`. A timestamp with no actor is not an audit trail.

**AC-31.** Given a rule-evidenced requirement and a human-confirmed one, when any surface reports coverage,
then the two are distinguishable **on that surface**, not only in the database.
> **Argued.** `checks.ts` already states the principle for the proposed count: *"a count that changed because
> a model was consulted must say so on the surface a reviewer reads, or 'coverage rose' is not falsifiable."*
> Confirmation introduces a second, larger way for the number to move without the profile improving — the
> owner's judgement. If `8/12` can mean "8 rules matched" or "1 rule matched and the owner vouched for 7",
> the number has two meanings and a reviewer has no way to tell which, which is the same defect as the
> laundered `not_applicable` that once printed `3/4` from one measured requirement. So: the observed string
> names the confirmed sub-count (AC-2), and the offender/evidence payloads carry the method through to the UI.

**AC-32.** Given the schema migration, when it runs against a database that ALREADY has
`requirement_evidence` (production, since P1), then every new column/constraint is added by an idempotent
`ALTER … add column if not exists` / drop-then-add-constraint pair, and **no statement anywhere in
`SCHEMA_SQL` references a new column before the ALTER that adds it** (H39/H39b). Verified by executing
`main`'s `SCHEMA_SQL` against local PostgreSQL 16.13, seeding rows, then executing the new `SCHEMA_SQL`
on top with `ON_ERROR_STOP=1` and exit code 0 — per the strict rule in `CLAUDE.md`.
A fresh-database run does not satisfy this AC.

---

## 8. UI (QC rail)

**AC-33.** Given an opportunity with pending proposals, when the owner opens the QC/evidence rail,
then each pending proposal is shown with: the requirement text, the **full proposed quote** (not truncated
past the point of judgement), the `source_label` of the record it came from, the model's supporting note
(`extra`), and an explicit label that a **model** proposed it and a rule did not.

**AC-34.** Given a pending proposal, when the owner confirms it, then the rail immediately reflects the new
state and the coverage figure shown to the owner is recomputed from the server on the next checks run —
never optimistically incremented client-side. *(A client-side count that disagrees with the gate is the
"same data, different numbers on different screens" failure mode `CLAUDE.md` devotes a whole rule to.)*

**AC-35 — bulk "confirm all" MUST NOT exist.**
> **Argued, since the brief asks.** Confirmation *is* the accusation. The entire design of this change is
> "the human becomes the accuser, so the house rule survives" — a single control that converts N model
> proposals into N human accusations with one click destroys precisely the thing being bought. It also has a
> measured failure shape in this codebase: the escalation tier proposes up to 12 rows per opportunity, and a
> "confirm all" over a 613-opportunity corpus is a button that can manufacture thousands of stored claims
> faster than anyone can read one. The permitted ergonomic answer is a **queue that presents one claim at a
> time** with the quote visible; that is fast without being blind.
> **Binary test:** no control in `app/src` submits more than one confirmation per user gesture; a source grep
> for a multi-id confirm payload finds nothing, and the route rejects an array of ids.

**AC-36.** Given the rail, when a proposal's excerpt is stale/unverified (D19), then Confirm is **not
offered** for it — you cannot vouch for a quote the system is currently refusing to display.

**AC-37.** Given the rail, when a requirement is evidenced by a **rule**, then no confirm control appears
for it — there is nothing for a human to accuse; the rule already did.

**AC-38 (no dead UI).** Every control added is wired end-to-end before commit — no `onClick` stub, no
hardcoded counts (per `CLAUDE.md` "No dead UI").

**AC-39 (no hardcoded config).** Given the change introduces any tunable a user would reasonably want to
control (e.g. whether the confirmation queue appears, escalation cap), then it is exposed through the
existing owner settings path (`checkPrefs.ts` / `owner_search_prefs`, guarded by
`H:every-threshold-is-configurable`), and code may only seed the default.
**Explicitly NOT configurable:** whether an *unconfirmed* proposal counts (AC-6) and whether a *stale*
confirmation counts (AC-11/AC-16). Those are correctness invariants, not preferences; making them settings
would let the owner switch the house rule off, which is the failure this whole design exists to avoid.

---

## 9. Regression guard spec — `api/test/hardening.test.mjs`

Naming: **slug, never a number**, ≥2 words (H26 fails a new numeric ID). Every guard below carries a
**MANDATORY mutation proof**: write the guard, revert the behaviour it guards, confirm the suite FAILS on
that specific assertion, restore. A guard that passes with its defect reinstated is worse than no guard.
If a mutation turns out to be behaviourally equivalent and correctly fails to fail, say so explicitly and
do not claim the assertion is proven.

| Guard | Asserts | Mutation proof (must FAIL) |
|---|---|---|
| `H:unconfirmed-proposal-never-counts` | Two `runChecks` inputs identical but for the confirmation: unconfirmed → `0/1` and confirmed → `1/1`, **both asserted in one test** (AC-7) | Make the counting predicate `evidenceOf(r) != null` (count everything) → the unconfirmed half must fail |
| `H:confirmation-is-method-scoped` | The predicate is `method='proposed' AND confirmed` OR `method<>'proposed'`; a confirmation on a rule row changes nothing, and `confirmed_at IS NOT NULL` alone is never the test | Replace with `confirmed_at != null` only → a rule row with no confirmation must stop counting, failing the test |
| `H:confirmation-survives-a-rebuild` | Confirm → re-run escalating `writeEvidence` with a stubbed transport returning the identical proposal → `confirmed_at`/`confirmed_by` byte-identical to before (AC-10) | Restore the unconditional `delete from requirement_evidence …` with no carry-over → confirmation lost → fail |
| `H:stale-confirmation-is-void` | Mutate the profile record so the offsets no longer slice the quote → the confirmed row does not count **on the gate path** and does not count on the read path (AC-11, AC-16, AC-17) | Skip re-verification on the gate path → the stale row counts → fail |
| `H:confirmation-is-redacted-with-its-quote` | Every joined column carrying confirmation state begins with `evidence_`, so `verifyRequirementRows`' prefix sweep nulls it; asserted by driving a stale row through `verifyRequirementRows` and checking no confirmation key survives (AC-16) | Rename the joined column to `confirmed_at` → it survives redaction → fail |
| `H:confirmed-row-outranks-a-pending-one` | With a confirmed and an unconfirmed proposed row on one requirement, `loadRequirementsWithEvidence`'s lateral returns the **confirmed** one (AC / Risk R-4) | Revert the ordering to `ratio desc nulls last, source_key, char_start` → the arbitrary row wins → fail |
| `H:confirmation-needs-a-verified-session` | Source-grep + behavioural: the route calls `requireWrite` **and** re-checks `verified`, returning 403 otherwise, including for the demo owner; and the stored actor comes from `resolveOwner`, never the body (AC-24, AC-26) | Delete the `if (!verified)` line → an unverified demo confirm succeeds → fail |
| `H:confirmation-is-owner-scoped` | The load statement joins `opportunity` and filters `owner_email` in the same SQL; cross-owner confirm returns 404 and writes nothing (AC-25) | Drop the owner predicate from the SQL → cross-owner confirm succeeds → fail |
| `H:confirmation-audit-is-all-or-none` | `SCHEMA_SQL` contains `check ((confirmed_by is null) = (confirmed_at is null))` on `requirement_evidence`, added idempotently, drop-before-add for any constraint (AC-30, AC-32) | Remove the CHECK → fail |
| `H:schema-applies-over-main` (extend the existing local-psql discipline rather than adding a parallel one) | `main`'s `SCHEMA_SQL` → seed rows → new `SCHEMA_SQL` with `ON_ERROR_STOP=1` exits 0 (AC-32) | Move any new `create index`/composite FK above its `ALTER` → migration aborts → fail |
| `H:no-bulk-confirmation` | No `app/src` control submits >1 confirmation per gesture; the route rejects an array payload (AC-35) | Add a `confirmAll` handler → fail |

**Extend, don't duplicate:** every one of these belongs in the existing `api/test/hardening.test.mjs`
(212 tests) beside `H:model-evidence-is-labelled`, `H:evidence-reverified-on-read`, and
`H:stale-evidence-not-absent`, which are the same family. Do not create a new test file for evidence
confirmation.

---

## 10. Adversarial risks / naive-implementation traps

**R-1 — Keying a confirmation by `requirement.seq` (or by `requirement_id` alone).**
`writeRequirements` does `delete from requirement where opp_id=$1` and re-inserts with `seq = i` on every
re-extraction. `seq` is a positional index, reused across extractions; the posting can be re-parsed with a
different body (`jd_text_sha256` changes) and `seq 4` becomes a completely different sentence. A
confirmation keyed on `seq` therefore transfers the owner's accusation to a requirement they never read.
`requirement_id` is safer but is destroyed by the same delete (`on delete cascade`). **Only the claim
identity is stable**: requirement text + `source_key` + offsets + quote + `record_sha256`.

**R-2 — Making `ruleEvidenceOf` count anything with `confirmed_at IS NOT NULL`.**
This looks like the minimal diff and quietly changes the meaning of the whole file: any future code path
that stamps a confirmation for any reason (a backfill, an admin tool, a migration default) promotes a row
to accusation grade. Worse, a `default now()` on the column — the exact defect
`H:model-evidence-is-labelled` already guards against for `proposal_version` — would backfill every
existing row into "confirmed" in one statement and turn 613 opportunities green with nobody having looked.
The predicate must name the method explicitly, and the column must be nullable with no default.

**R-3 — A confirmation that silently survives a profile edit.**
The seductive version is "we already verified it once, and re-asking annoys the owner". The result is the
system asserting a quote that is not in the record, attributed to a named human, with an exact-looking
offset — a claim that is *more* credible-looking than the 0/12 it replaced and *less* true. Note the
compounding factor found while reading: the **gate path never calls `verifyRequirementRows`**, and proposed
rows now survive the transport-less delete, so a confirmed proposal can persist across many builds with
nothing ever re-checking it. This is the single highest-severity trap in the list.

**R-4 — Ratio ordering hides the confirmed row.**
`loadRequirementsWithEvidence` picks ONE row per requirement, `order by ratio desc nulls last, source_key,
char_start`. A proposed row's `ratio` is NULL by design, so *every* proposed row ties, and the tiebreak is
`source_key, char_start` — arbitrary with respect to confirmation. If a requirement ever holds both a
confirmed and a pending proposal (a re-proposal at a different span while the confirmed one is preserved),
the lateral can return the pending one and coverage silently drops back to 0 with no error anywhere.
Ordering must put confirmed first, explicitly.

**R-5 — Confirming by evidence-row `id` alone through a UI that was rendered before a rebuild.**
The owner opens the rail, a build re-runs `writeEvidence`, the row's uuid changes, the owner clicks Confirm
on the stale id. Naive handling either 404s (annoying but safe) or — if the route "helpfully" falls back to
"the current proposal for that requirement" — confirms a claim the owner never saw. The route must confirm
exactly the claim identity the client was shown, and reject a mismatch rather than resolve it.

**R-6 — Counting a confirmed proposal in `evidence_placed` without thinking about what that check asserts.**
`evidence_placed` *accuses the document* of omitting an excerpt. Feeding confirmed proposals in makes the
system accuse the resume of omitting a sentence whose relevance only a model claimed and a human endorsed.
That is defensible (a human endorsed it) but it is a **different** claim from today's, and it must be a
deliberate, stated decision (AC-4) rather than a side effect of changing one helper — the file's own comment
warns about exactly this and an independent verifier already caught it once.

**R-7 — The demo workspace as a back door.** `requireWrite` returns `null` (allow) for
`demo@executive-engine.local` with no session at all. A confirm route that only calls `requireWrite`
therefore lets any unauthenticated caller manufacture human-attributed accusations in the shared sandbox,
and `confirmed_by` records `demo@…` — an audit row that names nobody.

**R-8 — Double counting via the `on conflict … do nothing` span key.** The unique key is
`(requirement_id, source_key, char_start, char_end)` — the SPAN, not the method. `writeEvidence` already
documents that a proposal can legitimately hold the very span a rule later resolves, and handles it by
deleting proposals first. Any confirmation carry-over logic must not reintroduce a path where the insert is
silently dropped (`do nothing`) and the surviving row is the *old* one wearing the *new* run's assumptions.

---

## 11. The one alternative worth considering — and why it is ruled out

**Alternative: lower `evidenceThreshold` (0.70 → something the profile can clear).**
It is genuinely the cheapest option and it is already owner-configurable
(`owner_search_prefs.chk_evidence_threshold`, `checkPrefs.ts:53`), so it needs no schema, no route, no UI,
and no new guard. If it worked it would be strictly preferable to everything above.

**It is ruled out by measurement, not by preference.** Using `api/test/tools/measure-matcher.mjs` — an
offline harness that reproduces all 12 of production's refusal reasons exactly — the **best available
profile excerpt** for each of the 12 must-haves on opportunity `2cb56fb3` scores **0.00-0.50** against the
0.70 threshold, and the tokens that are missing are words the profile **genuinely does not contain**
(`executive`, `capable`, `modern`, `patterns`, `devops`, `sre`, `exceptional`, `communication`).
Derivational stemming was measured separately and clears **zero** of the twelve.

Three consequences:
1. To admit even the best excerpts, the threshold would have to fall to ~0.50 **or below** — and at that
   level it stops being a relevance floor at all. It would admit near-arbitrary excerpts corpus-wide across
   613 opportunities, converting `must_have_coverage` from a measurement into noise, and it would do so
   **silently**: nothing on any surface says which threshold produced a number.
2. The missing tokens are absent from the profile, so no threshold produces evidence for them. Lowering the
   bar does not find the words; it just stops requiring them. **This is not a threshold-tuning problem.**
3. It moves the accusation from a rule to a weaker rule — whereas confirmation moves it to a **human**,
   which is the only actor the house rule ("a model may PROPOSE, only an exact rule may ACCUSE") was ever
   protecting the gate *for*.

The measured escalation result — the model proposed valid, byte-verified evidence for **8 of the 12** — is
the evidence that the gap is bridgeable by judgement rather than by lexical overlap. Confirmation is the
mechanism that lets that judgement enter the numerator without a model ever accusing anything.

---

## 12. Verification plan for the implementation (for the `verifier`, not for me)

1. **Local psql, populated-DB migration test** — `main`'s `SCHEMA_SQL` → seed `requirement` +
   `requirement_evidence` rows → new `SCHEMA_SQL` with `ON_ERROR_STOP=1`, exit 0 (AC-32). Fresh-DB success
   does not count.
2. **Unit** — `runChecks` with synthetic `evidence.bySeq` covering AC-1/2/6/7/8 (both halves in one test).
3. **Integration** — stubbed transport through the `resolver`/`fetchJson` seams for AC-10/11/14 (the seams
   exist precisely so this is testable without a model call).
4. **Live** — `api-test.yml` against opportunity `2cb56fb3` as `von.ellis@enterpriseds.io`: read coverage
   (`0/12`), confirm one proposal, re-run checks, read coverage again. The **observed string** is the
   artifact of proof, quoted verbatim in the report.
5. **Live UI** — `ui-verify.yml` on the QC rail route, asserting the pending-proposal control renders and
   that no bulk-confirm control exists (AC-33, AC-35).
6. **Mutation proofs** for every guard in §9, each reported as: mutation applied → named assertion failed →
   restored.

*(Nothing above may be reported as "fixed"/"working" until it is merged, deployed, and confirmed in the
live environment — `CLAUDE.md` "Verify before reporting" / "Confirm in the user's environment".)*

# Acceptance Criteria — evidence must survive the packet build

Status: DRAFTING (written incrementally; do not treat as final until the "FINAL" marker at the bottom)

Task: ACs only. No implementation. No source edits.

## Ground truth being verified (in progress)
- [ ] `runPacketBuild` / `resolveEvidenceForOpp` in `api/src/functions/tests/appPackets.ts`
- [ ] `evaluateArtifact` in `api/src/functions/tests/appChecks.ts` (+ the concurrency comment above the writeEvidence call)
- [ ] `writeEvidence` in `api/src/functions/tests/appRequirements.ts` (delete-then-reinsert, escalation gate, evidenced=evidenced+proposed)
- [ ] `ruleEvidenceOf` / `isProposed` in `api/src/functions/tests/checks.ts` (~611-640)
- [ ] other callers of `evaluateArtifact` (manual per-artifact route, remediation loop)

(sections appended below as each is read)

## Verified: appRequirements.ts `writeEvidence` (line 127)
- Signature: `(client, oppId, records, opts = {}, resolver = resolveAll, fetchJson?: FetchJson)` — the
  transport is the **6th** positional arg. A 4-arg call therefore passes `fetchJson === undefined`.
- Line 155-161: transaction OPENS with
  `delete from requirement_evidence e using requirement r where e.requirement_id = r.id and r.opp_id = $1`
  — scoped to the opportunity, unconditional, and it removes 'proposed' rows too.
- Line 215: `if (opts.escalate === true && fetchJson)` — a 4-arg call CANNOT re-create a proposed row.
  Comment at 136-139 states absence of transport means "the tier cannot run AT ALL … by construction".
- Doc comment 125: "Each run REPLACES the previous row's evidence rather than accumulating." — the
  delete is intentional and load-bearing for idempotency.
- Escalation inserts are per-row savepointed (line 260-275) and run AFTER the deterministic COMMIT
  (comment 193-201): a proposed row is durable independently of the deterministic pass.
- CONFIRMED the reported-count defect: `escRefused` was split out of `refused` because `evidenced` is
  derived from the deterministic population (comment 204-208). Need to read the return line to confirm
  `evidenced = ... + proposed`.

## Verified: appChecks.ts `evaluateArtifact` (line 32)
- Line 65-76: `if (profileRead.records.length) { await writeEvidence(client, art.opp_id,
  profileRead.records, resolveOptionsFrom(thresholds)) }` — FOUR args. No transport. Confirmed.
- Line 52: unreadable profile → `.catch(() => ({text:'', sources:['profile UNREADABLE'], records: []}))`,
  and the `if (profileRead.records.length)` guard means **nothing is written** when unreadable.
  Comment 60-62: zero rows presented as a measurement is "the '0% covered' that means 'we did not look'".
  THIS REFUSAL MUST NOT REGRESS.
- Line 70-74 is the CONCURRENCY comment, verbatim reason the transport was withheld:
  "Four artifacts of one packet enter `evaluateArtifact` concurrently, each calling `writeEvidence`;
  with a transport here that is four independent sets of model calls for the same opportunity, and
  because two runs can return DIFFERENT proposals, the last committer wins with a row set the other
  three were never judged against. The gate would then be reading rows that no longer exist.
  Escalation happens ONCE, on the evidence route the build calls, before the checks run."
  => The comment's stated INVARIANT ("escalation happens once, before the checks run") is CORRECT;
  what is broken is that the later transport-less call DELETES the result of that one escalation.
- Line 77: `loadRequirementsWithEvidence(client, art.opp_id)` reads the rows back AFTER the destructive
  write — this is the read the gate and the score both consume (line 103 runChecks, line 128 score).

## Verified: the remaining ground truth
- `checks.ts:634-635` — `isProposed = evidenceOf(r)?.method === 'proposed'`;
  `ruleEvidenceOf = isProposed(r) ? null : evidenceOf(r)`. The numerator at 654
  (`unevidenced = coverable.filter(r => !ruleEvidenceOf(r))`) therefore CANNOT count a proposed row.
  House rule, verbatim (comment 631-632): "a model may PROPOSE, only an exact rule may ACCUSE, and
  `must_have_coverage` is the accusation." Line 670-671 counts proposed rows into the `tail` string
  ("N model-proposed, awaiting your confirmation, not counted either way").
- `checks.ts:639-648` — `!ev || !ev.profileReadable` ⇒ `must_have_coverage`,
  `responsibilities_addressed`, `evidence_placed` all `not_applicable`, never pass/fail.
- `appRequirements.ts:309-315` — `const evidenced = resolved.filter(r => r.evidence).length - refused`
  then returns `evidenced: evidenced + proposed`. CONFIRMED: the build's reported `evidenced: 8` with
  `proposed: 8` means deterministic evidence was 0.
- `appRequirements.ts:396-421` `loadRequirementsWithEvidence` — `left join lateral (... order by
  x.ratio desc nulls last, x.source_key, x.char_start limit 1)`. ONE row per requirement; a proposed
  row has NULL ratio so it sorts last, i.e. any rule row with a non-null ratio already outranks it.
- `requirement_evidence` schema (`appRequirements.ts:41-60`): `unique (requirement_id, source_key,
  char_start, char_end)` — keyed on the SPAN, not on `method`; `method` CHECK is
  `('exact','anchored','proposed')`; `requirement_id ... on delete cascade`.
- Callers of `evaluateArtifact` (grep, whole api/src): `appChecks.ts:205` (POST
  /api/app/artifact/{artifactId}/checks — the manual per-artifact route), `appRemediation.ts:185` and
  `:272` (the remediation loop, twice per pass), `appPackets.ts:1001` (the build, per artifact,
  sequential, non-fatal). ALL FOUR reach the same transport-less `writeEvidence` call.
- Callers of `writeEvidence` with a transport: `appPackets.ts:848` (`resolveEvidenceForOpp`, gated
  `opts.escalate === true ? openAiJson(...) : undefined`) and `appRequirements.ts:734` (backfill).
  Transport-less: `appChecks.ts:75` (gate path) and `appRequirements.ts:672` (bulk resolve loop).
  => The bulk-resolve loop at :672 is a SECOND transport-less caller with the same delete, so any fix
  must be in `writeEvidence` itself or applied at every one of these sites.
- `appPackets.ts:970` — `const evidence = await resolveEvidenceForOpp(client, oppId, owner)` runs
  BEFORE the per-artifact `evaluateArtifact` loop at :1001. Ordering is correct; the loop destroys
  the result.

## OBSERVATION — implementation is already in flight in this working tree (not written by me)
`git status` on branch `claude/evidence-survives-the-build` shows
`api/src/functions/tests/appRequirements.ts` MODIFIED (uncommitted, +47/-4) with a `canEscalate`
const, a delete scoped `and e.method <> 'proposed'` on the transport-less path, and a per-requirement
`delete ... where requirement_id = $1 and method = 'proposed'` before each deterministic insert.
I did not write it and I have not edited any source file. These ACs are written against the DEFECT,
not against that patch, and AC-12/AC-13 and RISK-4/RISK-5 below are the adversarial questions that
patch must answer.

---

# ACCEPTANCE CRITERIA

Tier 1 (accusation grade): this code path decides `must_have_coverage`, the artifact gate and the
artifact score, and it governs whether model output reaches a stored claim.

Vocabulary used below, all grounded above:
- **rule row** = a `requirement_evidence` row with `method` in `('exact','anchored')`.
- **proposed row** = `method = 'proposed'`, produced only by the escalation pass.
- **escalating call** = `writeEvidence(...)` where `opts.escalate === true` AND a `fetchJson`
  transport was passed (the 6th arg).
- **non-escalating call** = any other `writeEvidence(...)`, including every 4-arg call.

## A. Happy path — evidence survives the build

**AC-1.** Given an opportunity whose requirements have N>0 proposed rows stored by an escalating
call, when a non-escalating `writeEvidence` runs for that same opportunity, then a `select count(*)
from requirement_evidence e join requirement r on r.id=e.requirement_id where r.opp_id=$1 and
e.method='proposed'` taken after the call returns **the same N** minus only those proposed rows that
were superseded by a rule row for the same requirement (AC-12), and never 0-because-deleted.

**AC-2.** Given opportunity `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3` (35 requirements, 9,749-char
`jd_real`) with escalation ON, when `POST /api/app/opportunity/{id}/evidence` is followed by `POST
/api/app/opportunity/{id}/packet/build-all`, then the row count in `requirement_evidence` for that
opportunity **after build-all is >= the count after the evidence route**, measured by the same
`db-query.yml` SQL run before and after. (The pre-fix measurement was 8 → 0; a fix that produces
8 → 8 passes, 8 → 0 fails, 8 → 12 passes.)

**AC-3.** Given the same run as AC-2, when the four artifacts' `check_result` rows for
`check_key='must_have_coverage'` are read, then the `observed` string reports a denominator > 0 and
a `tail` naming the proposed rows (e.g. `"0/12 must-haves evidenced (8 model-proposed, awaiting your
confirmation, not counted either way)"`) — i.e. the proposals are **visible to the owner** on the
gate surface. A run that reports `0/12` with **no** `model-proposed` clause fails this AC, because
that is the string that proves the rows were deleted rather than excluded.

**AC-4.** Given a full `build-all` on an opportunity with requirements and a readable profile, when
the build completes, then every artifact has an `artifact_gate` row (unchanged from today) AND the
evidence rows read by `loadRequirementsWithEvidence` inside `evaluateArtifact` are the rows that
existed after `resolveEvidenceForOpp`, plus/minus only deterministic re-resolution. No artifact may
be judged against an emptier evidence set than the one the build resolved.

**AC-5.** Given corpus-wide state after the fix is deployed and one `build-all` has run on any
opportunity that previously had proposals, when `select count(*) from requirement_evidence` is run,
then the count is **strictly greater than 1** (the measured pre-fix corpus total across 613
opportunities with requirements). This is the crude but binary "the spine is no longer empty" check.

## B. The concurrency constraint that must NOT be reintroduced

The comment at `appChecks.ts:70-74` is the reason the transport is withheld on the gate path. It
must remain true after the fix.

**AC-6.** Given the fix, when `api/src/functions/tests/appChecks.ts` is read, then the
`writeEvidence(` call inside `evaluateArtifact` still passes **no transport** — verified structurally,
not by intent: the call's argument list contains at most the 4 arguments `(client, art.opp_id,
profileRead.records, resolveOptionsFrom(thresholds))` and contains no `openAiJson`, no `fetchJson`,
and no `fetch` identifier.

**AC-7.** Given a `build-all` on a packet with 4 artifacts and escalation ON, when the model
transport is counted for one opportunity across the whole build, then **exactly one** set of
escalation calls is made (the one inside `resolveEvidenceForOpp`), and `evaluateArtifact` makes
**zero** model calls — for all 4 artifacts, whether they run sequentially (today) or concurrently on
separate connections (the shape the comment anticipates). Observable as: `escalated`/`proposed` are
non-zero exactly once per build in the build's `warnings`/`last_build` record, and any per-artifact
escalation counter is 0.

**AC-8.** Given two `evaluateArtifact` runs for two artifacts of the same packet executing against
the same opportunity, when both complete, then neither run's committed evidence set differs from the
other's in its `proposed` rows — i.e. "last committer wins with a row set the other three were never
judged against" cannot occur, because neither call produces or destroys proposals. Binary check: the
set of `(requirement_id, source_key, char_start, char_end, method='proposed')` tuples is identical
before and after each of the four `evaluateArtifact` calls.

**AC-9.** Given the fix, when `resolveOptionsFrom` / `resolveOptionsFor` are unchanged, then
escalation remains **opt-in and OFF by default**: an owner who has never configured it must see
`proposed: 0` and zero model calls on every path, and the fix must not make the gate path escalate
"just once" by moving the transport into `evaluateArtifact` behind a lock, a memo, or a first-writer
flag (see RISK-1).

## C. The safety property that must NOT regress

**AC-10.** Given a requirement whose only evidence row is `method='proposed'`, when
`must_have_coverage` is computed, then that requirement appears in the **unevidenced** list and does
**not** contribute to the numerator — `ruleEvidenceOf` returns null for it. Binary: for an artifact
with C coverable must-haves of which P are proposed-only and 0 have rule rows, `observed` reads
`0/C must-haves evidenced (P model-proposed, awaiting your confirmation, not counted either way)`.
A fix that raises the numerator because proposals now survive is a **failure of this AC**, not a
success of AC-1.

**AC-11.** Given the fix, when `responsibilities_addressed` and `evidence_placed` are computed, then
they too use `ruleEvidenceOf` (not `evidenceOf`) — the filtering an independent verifier already
caught missing on those two lines (`checks.ts:688-689`) must still be in place. Binary: grep of the
`must_have_coverage` / `responsibilities_addressed` / `evidence_placed` blocks shows zero uses of
bare `evidenceOf(` in a numerator or an `unevidenced`/`open` filter.

**AC-11b.** Given a proposed row that survives a non-escalating call, when the artifact score is
computed, then `must_have_coverage` in `artifact_score` is derived from the same check result
(`computeArtifactScore` reading coverage OUT of the checks, `appChecks.ts:120-133`) and not
recomputed — so the score cannot credit a proposal the gate refused.

## D. Replace / idempotency semantics

**AC-12.** Given a requirement that has BOTH a stale proposed row AND newly-found deterministic
evidence in the same non-escalating run, when the run commits, then **the rule row wins and is the
row `loadRequirementsWithEvidence` returns**, and the stale proposed row for that requirement is
**removed**. Two independent reasons this must be enforced by deletion and not left to ordering:
  (a) the lateral join orders `ratio desc nulls last` — a proposed row has NULL ratio so it already
      loses to a rule row **that has a non-null ratio**; leaving it is untidy but not fatal;
  (b) but `on conflict (requirement_id, source_key, char_start, char_end) do nothing` is keyed on the
      **span, not the method**. A proposal is byte-verified against the record it names, so it can
      legitimately occupy the exact span the rule just resolved — in which case the deterministic
      insert is **silently dropped** and the surviving row stays `method='proposed'`, which
      `ruleEvidenceOf` excludes. The requirement would then read as uncovered *because* the profile
      genuinely evidences it. **AC-12 is failed by any implementation that relies only on (a).**
  Binary test: seed a proposed row at span (K, S, X, Y); run a non-escalating `writeEvidence` whose
  resolver returns a rule row at the identical (K, S, X, Y); assert the surviving row for K has
  `method` in `('exact','anchored')` and that `count(*) where requirement_id=K` is 1.

**AC-13.** Given a requirement whose stale proposed row is NOT superseded (the deterministic pass
found nothing for it), when a non-escalating run commits, then the proposed row is **retained
unchanged** — same `id`, `quote`, offsets, `proposal_version` — so a later escalating run's
`open` filter and the owner's "confirm it" surface both still see it.

**AC-14.** Given any two consecutive non-escalating `writeEvidence` runs over identical inputs, when
both complete, then the total row count for the opportunity is **identical** after the second as
after the first (no accumulation, no doubling). This is the property the original unconditional
delete existed to provide and it must not be lost.

**AC-15.** Given an **escalating** call, when it runs, then it MAY still delete everything for the
opportunity including proposals, because it will re-propose — but its post-state must satisfy AC-14
too (running it twice does not double rows), and its `escalation_refusals` must account for every
row that was deleted and not re-created (e.g. `over_cap`, `transport_failed`). **Adversarial note:**
an escalating call that deletes P proposals and then hits `over_cap` or a transport outage
*legitimately* ends with fewer rows than it started. That is a real net loss of evidence and it is
NOT covered by AC-1. State explicitly whether that loss is accepted; if accepted, it must be visible
in `escalation_refusals`, not silent.

**AC-16.** Given `writeRequirements` re-extracting the requirement spine for an opportunity, when
requirement rows are replaced, then their evidence — proposed rows included — is removed by the
`requirement_id ... on delete cascade` FK. A proposal must never outlive the requirement text it was
proposed against. (Confirmed present in schema; this AC is a regression guard on it.)

**AC-17.** Given the returned counts, when a non-escalating call completes, then `proposed` in the
return value reports **rows this call created** (0 for a non-escalating call), and `evidenced`
(currently `evidenced + proposed`) must not silently start counting **pre-existing surviving**
proposals — otherwise the build log's `evidenced: N` becomes a different measurement than it was
without saying so. Binary: a non-escalating call over an opportunity holding 8 surviving proposals
and 0 deterministic matches returns `proposed: 0` and `evidenced: 0`. **If the fix instead chooses
to report surviving proposals, the field name or the response must change so the two populations
stay separable — a silent redefinition fails this AC.**

## E. Unreadable profile — the refusal must stay

**AC-18.** Given `sourceText()` throws or returns zero records, when `evaluateArtifact` runs, then
`writeEvidence` is **not called at all** (`appChecks.ts:65` guard), no rows are deleted, and no rows
are written. Binary: with a profile reader stubbed to throw, the opportunity's
`requirement_evidence` row count is unchanged and `method='proposed'` rows are unchanged.

**AC-19.** Given the same unreadable-profile run, when the checks are computed, then
`must_have_coverage`, `responsibilities_addressed` and `evidence_placed` are all `not_applicable`
with the observed text "your stored profile could not be read…", never `pass` and never `fail`.

**AC-20.** Given `resolveEvidenceForOpp` on the build path with an unreadable profile, when it runs,
then it returns `{ error: 'no profile record could be read, so no coverage claim can be evidenced' }`
and writes nothing — and the build folds that into `warnings` rather than failing. Unchanged
behaviour; asserted so a fix cannot "helpfully" make an empty profile clear the evidence table.

**AC-21.** Given a caller that is not the owner of the opportunity, when `resolveEvidenceForOpp`
runs, then the `where id=$1 and owner_email=$2` object-level check still refuses before any write
(already guarded by `H:in-process-copy-keeps-the-ownership-check`). The fix must not move the
delete/write above that refusal.

## F. Scope — every caller, not just the one that was found

**AC-22.** Given the fix, when `grep -rn 'writeEvidence(' api/src` is run, then **every** call site
is accounted for and each is classified escalating / non-escalating, and each non-escalating site
exhibits the AC-1 preservation property. The four known sites are `appPackets.ts:848` (escalating,
conditional), `appRequirements.ts:672` (bulk resolve loop — **non-escalating**, same delete, same
defect), `appRequirements.ts:734` (backfill, escalating/conditional) and `appChecks.ts:75` (gate
path, non-escalating). A fix applied only at the `appChecks` site fails this AC — the bulk resolve
loop would still wipe the corpus.

**AC-23.** Given the fix, when the remediation loop runs (`appRemediation.ts:185` and `:272`, i.e.
`evaluateArtifact` called up to 2×per pass over multiple passes), then proposed rows are preserved
across every pass, so a remediation run cannot progressively empty the evidence spine one pass at a
time. Binary: proposed-row count for the opportunity is identical before pass 1 and after the final
pass, absent an escalating call in between.

**AC-24.** Given the manual per-artifact route `POST /api/app/artifact/{artifactId}/checks`
(`appChecks.ts:205`) invoked on an artifact whose opportunity holds proposals, when it returns 200,
then those proposals are still present. This route is a real user action and it is the same
transport-less path.

---

# ADVERSARIAL REVIEW — naive fixes and why each is wrong

**RISK-1 — "just pass the transport everywhere" (add `openAiJson(...)` to the `appChecks.ts:75`
call).** This is the fix the defect's shape invites and it is the one the code was deliberately
written to prevent. `evaluateArtifact` is entered once per artifact — four times per packet — so this
turns one escalation into four independent sets of model calls for the same opportunity. Because two
runs over identical inputs can return DIFFERENT proposals (`temperature: 0` is not a determinism
guarantee — stated in the `writeEvidence` doc comment), each run deletes and re-proposes, and the
last committer wins with a row set the other three artifacts were **never judged against**: three
gates are then stored against evidence that no longer exists. It also multiplies cost by 4 and adds
model latency to a `build-all` that already loses to the 4-minute gateway budget (D35). Violates
AC-6, AC-7, AC-8, AC-9. *Sub-variant that is equally wrong:* "pass the transport but memoize / take a
lock so only the first artifact escalates." That reintroduces the model on the gate path behind a
concurrency primitive on a path that today has none, makes which-artifact-escalated a race, and still
leaves the other three reading rows the first one produced after they started.

**RISK-2 — "never delete" (make the write additive / `on conflict do update`).** The delete is the
only thing that makes re-resolution idempotent — its comment says so and AC-14 requires it. Without
it, every checks run, every remediation pass (up to 2× per pass), and every build appends another
copy of the same evidence, so a requirement accumulates rows without limit. The `unique
(requirement_id, source_key, char_start, char_end)` constraint blunts the worst of it but does not
save you: a resolver whose offsets shift by one character (a re-read profile, a re-extracted record)
produces a *different* span and therefore a *new* row, and `loadRequirementsWithEvidence` then picks
by `ratio desc` from a growing pile of stale excerpts — including excerpts whose source record no
longer says what they claim. That is the "stale quote rendered as proof" failure `verifyRequirementRows`
exists to redact. Violates AC-14.

**RISK-3 — "have `evaluateArtifact` skip `writeEvidence` entirely and just read the rows."**
Superficially attractive: the build already resolved evidence at `appPackets.ts:970`, so why resolve
again? Because `evaluateArtifact` has **three other callers where no evidence pass precedes it**:
the manual route `POST /api/app/artifact/{id}/checks` (`appChecks.ts:205`), and the remediation loop
(`appRemediation.ts:185`, `:272`) which re-evaluates after each edit pass. On those paths the
evidence may be **stale** (resolved against an older profile) or **absent entirely** (an artifact
whose opportunity was never evidence-resolved). Skipping the write there means the gate judges the
current document against evidence from an arbitrary earlier moment, or reports `not_applicable`
forever. Worse, it silently converts the gate from "resolve then judge" to "judge whatever is
lying around", which is exactly the two-answers-to-one-question drift the `appChecks.ts:55-58`
comment forbids. Violates AC-4, AC-23, AC-24. *Sub-variant:* "skip the write only when called from
the build" — that requires a caller-identity flag threaded into `evaluateArtifact`, i.e. the gate's
behaviour now depends on who called it, which is untestable from the outside and invisible in the
stored result.

**RISK-4 — "scope the delete to `method <> 'proposed'` on the non-escalating path"** *(this is the
approach currently in the working tree; it is the most plausible one and it still has to answer
these).* Three specific hazards, each of which must be affirmatively resolved, not assumed:
  (a) **Span collision silently keeps the proposal.** `on conflict (requirement_id, source_key,
      char_start, char_end) do nothing` is keyed on the span, not the method. If a surviving proposal
      occupies the same span a rule row just resolved, the deterministic insert is dropped and the
      row stays `proposed` — so a requirement the profile *genuinely* evidences reads as uncovered,
      because `ruleEvidenceOf` excludes it. This is a **coverage-lowering** bug introduced by a
      coverage-restoring fix. AC-12 is the test; an implementation that does not delete the
      per-requirement proposal before inserting fails it.
  (b) **Unbounded proposal staleness.** Once only an escalating call clears proposals, a proposal can
      survive indefinitely across every checks run, remediation pass and build. Its `proposal_version`
      and `record_sha256` are the only evidence of its age. State explicitly whether a proposal
      older than the current `record_sha256` / profile read must be dropped, and if it is left, that
      `verifyRequirementRows` redaction is what stops a withdrawn excerpt being rendered as proof.
  (c) **Two readings of one condition.** The delete's scope and the escalation pass's guard must be
      the *same* expression. If they can ever disagree — e.g. `opts.escalate === true` on one and
      `!!fetchJson` on the other — you get a call that deletes proposals and cannot re-create them,
      which is the original defect with extra steps. AC-15 and the H-case below both target this.

**RISK-5 — "fix it in `evaluateArtifact` by snapshotting proposals and restoring them after the
write."** Restores the rows but leaves the destructive primitive in place for every other
transport-less caller (`appRequirements.ts:672`, the bulk resolve loop), so the corpus can still be
emptied by a route nobody remembered to patch — violating AC-22 and the repo's "fix all consumers"
rule. It also opens a window in which the rows do not exist: a concurrent read (four artifacts on
separate connections, which the code explicitly anticipates) can observe the gap and judge against
an empty evidence set. The invariant belongs in `writeEvidence`, which is the one place that knows
what it can rebuild.

**RISK-6 — "make `must_have_coverage` count proposed rows so the number stops reading 0."** Named
because it is the tempting way to make the symptom disappear, and it is the single most damaging
option on the list. It moves the check's standard from "verbatim AND lexically supported" to
"verbatim", admits unverified model relevance judgements into the accusation, and nothing on any
surface would say the standard changed. Directly violates AC-10 and the house rule at
`checks.ts:631-632`. The correct outcome of this whole fix is that the numerator **stays 0** for
proposal-only requirements — what changes is that the rows exist to be shown and confirmed.

**RISK-7 — "widen the escalation so the deterministic path can re-derive proposals."** i.e. lower
`EVIDENCE_THRESHOLD` / loosen the matcher so fewer rows need escalating. This is fuzzy matching
migrating into an accusation-grade path — the standing rule ("fuzzy matching is for RANKING, never
for ACCUSING") — and it changes coverage numbers corpus-wide as a side effect of a bug fix, making
the fix's own before/after measurement uninterpretable. Any threshold change must be a separate,
owner-configurable change with its own measurement.

## What "done" does NOT mean here
- A passing local unit test is **not** AC-2 or AC-5: those require a live before/after DB measurement
  via `db-query.yml` on a real opportunity, because the defect was only visible in production data.
- `evidenced: 8` in a build response is **not** proof of coverage — it is `evidenced + proposed`
  (`appRequirements.ts:315`). Read `proposed` alongside it, always.
- A 200 from `build-all` with `must_have_coverage` still `0/12` is a result to investigate, not a
  pass — unless the `tail` names the proposed rows (AC-3), in which case `0/12` is CORRECT.

---

# REGRESSION GUARD — required `api/test/hardening.test.mjs` H-case(s)

Naming: SLUG, never a number, at least two words. Primary case:
**`test('H:evidence-survives-the-build: a call that cannot escalate must not delete proposals', ...)`**

It must assert the INVARIANT, not the incident — the general rule is: **`writeEvidence` may only
delete evidence rows it is capable of re-deriving in the same call.**

Required assertions (behavioural test preferred over a source grep — the behaviour is exercisable,
`matcher.test.mjs` already drives `writeEvidence` against a fake client with an injected resolver and
transport, so the harness exists):

1. **The core assertion.** Seed an opportunity with requirements; run an escalating
   `writeEvidence(client, opp, recs, {escalate:true}, undefined, modelSays(GOOD))` and assert
   `proposed > 0` and P proposed rows are stored. Then run a **4-argument** `writeEvidence(client,
   opp, recs, {})` — exactly the `appChecks.ts:75` shape. Assert the P proposed rows are **still
   present**, by `method='proposed'` count, and that the specific row ids are unchanged (AC-1, AC-13).
2. **Mutation proof (never skipped, any tier).** Revert the delete to unconditional
   (`... where e.requirement_id = r.id and r.opp_id = $1`) and confirm this test **FAILS**. Restore.
   A guard that passes with the defect reinstated is inert and worse than none. Record the mutation
   command and its observed failure output in the test's comment.
3. **The safety half, in the same case or a sibling
   `test('H:proposed-never-accuses: a surviving proposal does not raise the numerator', ...)`.**
   With the P proposals present and zero rule rows, assert `runChecks` reports
   `must_have_coverage` state `fail`/`warn` with numerator 0 and an `observed` containing
   `model-proposed`, and that `ruleEvidenceOf` excluded them. Mutation-prove by changing
   `ruleEvidenceOf` to `evidenceOf` and confirming failure (AC-10, RISK-6).
4. **The span-collision case** —
   `test('H:rule-evidence-evicts-the-stale-proposal: same span must not keep method=proposed', ...)`.
   Seed a proposed row at `(req, source_key, start, end)`; run a non-escalating call whose resolver
   returns a rule row at the **identical span**; assert the surviving row's `method` is not
   `'proposed'` and that exactly one row exists for that requirement (AC-12). This case exists
   because `on conflict ... do nothing` is keyed on the span, so the naive fix passes assertion 1 and
   fails here.
5. **The two-readings structural assertion** (source grep is appropriate here — it is a structural
   rule a runtime test cannot express): assert that the expression scoping the delete and the
   expression guarding the escalation pass are the **same identifier**, i.e. after
   `stripComments(src('appRequirements.ts'))`, the escalation guard is not an independently written
   `opts.escalate === true && fetchJson` while the delete keys off something else. Fail message must
   name the divergence (RISK-4c).
6. **The all-callers assertion** — extend or mirror the existing
   `M35/H:evidence-opts-reach-every-caller` grep (`matcher.test.mjs:750-770`, which already walks
   every `writeEvidence(` call site): assert that **every** call site is either escalating or
   non-escalating by construction and that `appChecks.ts`'s call passes no transport (AC-6, AC-22).
   Fail message must print the offending call's argument list, as M35 already does.
7. **Comment discipline:** record the evidence in the test comment as the repo requires — opportunity
   `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`, 8 proposed rows after the evidence route, **0** after
   `build-all`, `must_have_coverage` `0/12` and `responsibilities_addressed` `0/21` on all four
   artifacts, corpus total 1 row across 613 opportunities with requirements, measured 2026-08-23.
   Without the measured numbers the next reader cannot tell a real rule from a guess.

## FINAL
ACs above are complete and ready for sign-off. No source file was edited by this pass.

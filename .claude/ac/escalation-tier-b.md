# Acceptance Criteria — LLM Escalation Tier for Evidence Resolution

Scope: wiring `evidenceProposal.ts` (proposal + `verifyProposal`/`worthEscalating`) and
`openaiJson.ts` (transport) into `writeEvidence()` in
`api/src/functions/tests/appRequirements.ts`, behind a per-owner toggle defaulting OFF,
as a SECOND async pass over rows the synchronous `resolveAll()` left null.

Status: DRAFT — batch 1 written from the brief alone, before reading any code.
Later batches refine/replace these against the actual source.

---

## Batch 1 — from the brief alone (pre-read)

1. Given a requirement row that the deterministic pass (`resolveEvidence()` in
   `api/src/functions/tests/evidence.ts`) returned null for, and the per-owner escalation
   toggle is ON, when `writeEvidence()` in `api/src/functions/tests/appRequirements.ts`
   runs its second async pass and the model returns a proposal whose `quote` is a
   byte-exact `indexOf` substring of the record named by `source_key`, then the persisted
   row has `method='proposed'`, a non-null `proposal_version`, and start/end offsets that
   satisfy `record.slice(start, end) === quote` exactly — verified by a unit test in
   `api/test/` asserting the offsets round-trip.

2. Given the same corpus and the same posting, when `writeEvidence()` is run once with the
   escalation toggle OFF and once with it ON, then every row the deterministic pass
   settled (i.e. `resolveEvidence()` returned non-null) is byte-identical between the two
   runs — same `method`, same `source_key`, same quote, same offsets, same
   `proposal_version` (null) — asserted by a test that diffs the two result sets and
   requires zero differences on deterministic rows.

3. Given the per-owner escalation toggle is absent/unset for an owner, when `writeEvidence()`
   runs, then the toggle resolves to OFF and ZERO calls are made to the transport in
   `api/src/functions/tests/openaiJson.ts` — observable by injecting/spying the transport
   in a test and asserting the call count is exactly 0, and by the absence of any
   `method='proposed'` row (`select count(*) from ... where method='proposed'` = 0).

---
## Batch 2 — after reading `evidenceProposal.ts`, `openaiJson.ts`, `appRequirements.ts`

Ground truth read: `api/src/functions/tests/evidenceProposal.ts` (160 lines),
`openaiJson.ts` (84), `appRequirements.ts` (576).

**BLOCKING OBSERVATION (settles ACs 4 and 5).** `ensureEvidenceTable()` in
`appRequirements.ts:34-56` declares `requirement_evidence` with an INLINE
`check (method in ('exact','anchored'))` and **no `proposal_version` column**. It is
called on the hot path by `ensureRequirementCols()` (line 70) and by every route.
`create table if not exists` is a no-op on an environment that already has the table —
the file's own comment at lines 64-69 documents exactly this trap for
`requirement_kind_source_check` and fixes it with an explicit
`drop constraint if exists` + `add constraint`. Nothing equivalent exists for
`requirement_evidence_method_check`. So widening the CHECK in `schema.ts` alone does
NOT reach production, and the first `method='proposed'` insert aborts the transaction
in `writeEvidence()` — taking the whole opportunity's evidence with it (the insert loop
is inside `begin`/`commit`, line 109-145), i.e. a failed escalation destroys
DETERMINISTIC rows that were already deleted at line 113.

4. Given a database that already has `requirement_evidence` created by the pre-change
   `ensureEvidenceTable()` (CHECK limited to `'exact','anchored'`, no `proposal_version`),
   when `ensureRequirementCols()` runs after the change, then the table has
   `proposal_version int null` and the method CHECK admits `'proposed'` — proved by the
   populated-database procedure in `CLAUDE.md` ("Run the schema locally"): apply
   `origin/main`'s `SCHEMA_SQL`, insert a real `exact` evidence row, apply the branch's
   `SCHEMA_SQL` **and** run `ensureEvidenceTable`'s DDL, then
   `insert ... method='proposed'` must succeed and
   `select conname from pg_constraint where conrelid='requirement_evidence'::regclass` must
   show a method check containing `proposed`. A fresh-database pass does NOT satisfy this AC.

5. Given the escalation pass produces one row that the database rejects (constraint
   violation, type error, or any insert failure), when `writeEvidence()` completes, then
   the deterministic rows for that opportunity are still present — i.e. the escalation
   inserts must NOT share the transaction that deletes and rewrites the deterministic rows,
   or must be individually guarded. Settled by a test that stubs the client so the
   `method='proposed'` insert throws, then asserts
   `select count(*) from requirement_evidence e join requirement r on r.id=e.requirement_id
    where r.opp_id=$1 and e.method<>'proposed'` equals the count from the same run with
   escalation OFF. Today the `catch` at line 145 does `rollback` + `throw`, which would
   lose every deterministic row and 500 the route.

6. Given the escalation tier is ON and writes a `method='proposed'` row, when
   `loadRequirementsWithEvidence()` (`appRequirements.ts:213-234`) joins it, then the served
   row exposes the provenance — `evidence_proposal_version` (and the reasoning, if stored) —
   because that function's explicit column list does NOT use `select e.*` and a column not
   named there is invisible to `shapeRequirementsForApi()`, `appDimensions.shapeRequirement`
   and `appChecks`. Settled by asserting the projection in the SQL string and by a test that
   round-trips a proposed row through `shapeRequirementsForApi` and finds
   `evidence.proposalVersion` non-null.

7. Given one requirement has BOTH a deterministic excerpt and (from an earlier run) a
   proposed one, when `loadRequirementsWithEvidence()` picks one via
   `order by x.ratio desc nulls last, x.source_key, x.char_start limit 1`, then the
   deterministic row wins. A proposed row must therefore carry `ratio = null` (sorting last)
   or the ordering must be changed to rank `method` explicitly — settled by a SQL test
   inserting one `exact` (ratio non-null) and one `proposed` row on the same requirement and
   asserting `evidence_method = 'exact'`. A proposed row written with a non-null ratio would
   silently outrank a deterministic excerpt; that is the "never override or weaken a
   deterministic result" clause, and the lateral join is the only place it is decided.

8. Given the redaction pass `verifyRequirementRows()` (line 260-288) nulls every key
   starting with `evidence_` on any row whose excerpt no longer verifies, when a proposed
   row goes stale, then `evidence_proposal_version` is nulled with the rest and
   `evidence_state` reports the non-verified state — i.e. the new column MUST be named with
   the `evidence_` prefix in the join alias, or a withdrawn model excerpt leaks its
   provenance while its quote is redacted. Settled by a unit test on
   `verifyRequirementRows` with a proposed row and mismatching records, asserting every
   `evidence_*` key is null.

9. Given the deterministic pass returned an excerpt for a requirement, when the escalation
   pass runs, then that requirement is never sent to the model — asserted by a test that
   spies the injected `FetchJson` and checks the set of requirement seqs it was called for
   is exactly `{seq | resolveAll returned no evidence}`, with zero intersection with the
   evidenced set.

10. Given `worthEscalating(requirement, minTokens)` returns false — either
    `requirementClass(requirement)` is truthy (eligibility/numeric) or
    `claimTokens(requirement).length < minTokens` — when the escalation pass reaches that
    row, then no model call is made for it. Settled by a test over a fixture set containing
    at least one eligibility-class requirement and one below-threshold requirement, asserting
    the transport spy call count equals the count of rows passing `worthEscalating`.

## Batch 3 — after reading `evidence.ts` (exports/`resolveAll`/`ResolveOptions`) and `checkPrefs.ts`

Ground truth: `resolveAll` (evidence.ts:427) is sync and maps every requirement through
`resolveEvidence`; `EvidenceRow.method` is typed `'exact' | 'anchored'` (line 85);
`RESOLVER_VERSION = 2` (line 53); `NEVER_EVIDENCE = new Set(['itemsToOmit'])` (line 139).
`checkPrefs.ts` is the ONE reader/writer of per-owner `chk_*` columns on
`owner_search_prefs`, and its own comments say a setting reaching two of three callers
is worse than none.

11. Given the "No hardcoded config" rule, when the escalation tier ships, then EVERY
    behaviour-affecting value it introduces is a `chk_*`-style column on
    `owner_search_prefs` added by `ensureCheckPrefs()` in `checkPrefs.ts` and mapped by
    `loadThresholds`/`resolveOptionsFrom` — at minimum: the ON/OFF toggle
    (`not null default false`), `minQuoteChars`, the `worthEscalating` `minTokens`, the
    per-run call cap, and the model id. Settled by a source test asserting each name appears
    in `ensureCheckPrefs`'s `alter table` AND in `loadThresholds`'s `select` list, plus a
    Settings-UI path in `app/src/`. A literal in `appRequirements.ts` with no column and no
    UI fails this AC. **`checkPrefs.ts` must NOT import `evidenceProposal.ts` in a way that
    reintroduces the `appChecks`↔`appRequirements` cycle its header documents** — assert the
    import graph stays a DAG.

12. Given the toggle column defaults to `false` and `loadThresholds` returns `{}` for an
    owner with no `owner_search_prefs` row, when `resolveOptionsFor()` maps that to options,
    then the escalation flag is `false` — NOT `undefined` falling through to a seeded default
    of `true`. Settled by a unit test on `resolveOptionsFrom({})` asserting the escalation
    field is falsy, mirroring the existing "an unconfigured owner falls through to the SEEDED
    defaults ... rather than to zero" comment but inverted: for a spend-and-trust toggle the
    unconfigured state must be the SAFE one, not the seeded one.

13. Given `writeEvidence()` has THREE call sites — `appChecks.evaluateArtifact`,
    `requirementsBackfill` (appRequirements.ts:494) and `evidenceResolve` (line 552) — when
    the escalation tier ships, then either all three carry it or the ones that do not are a
    stated, tested decision. Settled by `grep -rn 'writeEvidence(' api/src` and a source test
    asserting every call site passes the owner's options through `resolveOptionsFor`. The
    file's own history records a setting that reached two of three sites; the gate path
    (`evaluateArtifact`) is the one that must not silently differ.

14. Given `evaluateArtifact` can be entered concurrently by four artifacts of one packet
    (documented at `appRequirements.ts:28-32`), when the escalation tier is ON, then four
    concurrent runs do not issue four independent sets of model calls for the same
    opportunity, nor deadlock, nor produce duplicate `proposed` rows — settled by a test
    running `writeEvidence` twice concurrently against the same `oppId` and asserting the
    model-call count and the final row set. Note the existing
    `unique (requirement_id, source_key, char_start, char_end)` + `on conflict do nothing`
    dedupes rows but does NOT dedupe SPEND.

15. Given the model returns a proposal for a record whose key is in `NEVER_EVIDENCE`
    (`'itemsToOmit'`), when `verifyProposal()` is called, then it refuses with
    `'banned_source'` and no row is written — BUT this only holds if `writeEvidence` passes
    `opts.neverEvidence = NEVER_EVIDENCE` AND the banned record is excluded from
    `buildProposalUser()`'s rendered record list in the first place. Settled by a test
    asserting (a) the prompt string built for escalation contains no `source_key:
    itemsToOmit` line, and (b) a hand-written proposal naming it is refused.

16. Given the model returns a proposal whose `quote` differs from the record by a paraphrase,
    a case change, added/removed punctuation, a normalized dash or quote character, an
    ellipsis, or text merged from two records, when `verifyProposal()` runs, then each case
    returns `{accepted: null, refusal: 'quote_not_in_record'}` and writes nothing. Settled by
    a table-driven test in `api/test/` with one case per mutation, each asserting the refusal
    string — including a case where the quote IS present in a DIFFERENT record than the one
    `source_key` names (must still refuse, because `indexOf` runs on `rec.text` only).

17. Given the model returns `source_key` naming a record not in `records`, when
    `verifyProposal()` runs, then refusal is `'unknown_source_key'`; given `supported:false`
    or a null/undefined proposal, refusal is `'model_declined'`; given
    `reasoning: ''` / whitespace, refusal is `'no_reasoning'`; given a quote shorter than
    `minQuoteChars`, refusal is `'quote_too_short'`; given `requirementClass(requirement)` is
    truthy, refusal is `'requirement_class'` and this is checked FIRST, before the proposal is
    even inspected (`evidenceProposal.ts:119`). Each is a separate assertion; all six refusal
    branches must be covered or the test suite does not settle this AC.

18. Given a refusal of ANY kind, when the row is finalized, then the requirement remains
    UNEVIDENCED — no row in `requirement_evidence`, `evidenced` unchanged, and the served
    `evidenceState`/`evidenceNote` is the same sentence it was with the tier OFF. A refusal
    must never write a partial row, a row with a null quote, or a "we tried" marker that
    `shapeRequirementsForApi` counts via `r.evidence_quote != null`. Settled by asserting the
    `evidenced` count from `shapeRequirementsForApi` is identical to the tier-OFF run for
    every refused row.

## Batch 4 — the approval gate path (`appChecks.ts` → `checks.ts`)

Ground truth: `appChecks.evaluateArtifact` (appChecks.ts:62-90) calls `writeEvidence`,
then `loadRequirementsWithEvidence`, then builds `EvidenceInput.bySeq` **directly from the
raw joined rows — it does NOT call `verifyRequirementRows`**, and casts
`method: r.evidence_method` through `as EvidenceRow` (whose `method` type is
`'exact' | 'anchored'`, evidence.ts:85). `checks.ts:587` defines
`evidenceOf(r) = ev.bySeq[r.seq]`, and `checks.ts:602/623-627` turns that into
`must_have_coverage`, which `checks.ts:491` states "decides the GATE, so it is an
accusation-grade test". **A `method='proposed'` row therefore flips the approval gate with
no further check.** That is the single highest-consequence consumer and every AC below is
about it.

19. Given a must-have requirement evidenced ONLY by a model-proposed row, when
    `evaluateArtifact` runs `must_have_coverage`, then the gate outcome is a deliberate,
    stated decision — either (a) proposed rows count toward coverage and the check's message
    names how many of the numerator are model-proposed (e.g. `7/10 must-haves evidenced
    (2 model-proposed)`), or (b) `evidenceOf` excludes `method='proposed'` for the gate.
    Silently counting them with a message identical to the deterministic case fails this AC.
    Settled by a test in `api/test/` that runs `runChecks` with one proposed row in `bySeq`
    and asserts both the `status` and the `detail` string.

20. Given `EvidenceRow.method` is typed `'exact' | 'anchored'`, when a proposed row flows
    through `appChecks.ts:72-89`'s `as EvidenceRow` cast, then the type is widened to include
    `'proposed'` in `evidence.ts` — settled by `cd api && npm run build` succeeding with the
    cast removed, or by a source test asserting the union contains `'proposed'`. The `as`
    cast means TypeScript will NOT catch this; a stored value outside its declared union is
    exactly the "digest field holding a value no digest produced" trap that same comment
    block warns about.

21. Given `appChecks.ts:84` maps `ratio: r.evidence_ratio === null ? 0 : Number(...)`, when a
    proposed row (ratio null) reaches the checks, then no check treats `ratio: 0` as a
    quality signal that differs from a deterministic row's — settled by grepping every
    `.ratio` read in `checks.ts` and asserting each is either unused or explicitly handles
    the proposed case. A proposed row entering as `ratio: 0` while a deterministic row enters
    as `0.8` is a silent quality difference no consumer is told about.

22. Given `appChecks.evaluateArtifact` calls `writeEvidence(..., resolveOptionsFrom(thresholds))`
    (line 69) and NOT `resolveOptionsFor`, when the escalation options are added, then this
    call site receives them too — settled by a test asserting the object passed at line 69
    contains the escalation toggle. This is the gate path; per AC 13 it is the one that must
    not silently differ.

23. Given `evidence_placed` (`checks.ts:641-660`) filters `evidenced` rows and reports
    "evidenced by {source_label}, absent from this asset", when proposed rows join that
    population, then the count and the message still reconcile with `must_have_coverage`'s
    numerator — settled by asserting, in one `runChecks` invocation containing proposed rows,
    that `evidence_placed`'s denominator equals the count of rows `must_have_coverage` treated
    as evidenced (per R4: two counts describing the same population must not disagree).

24. Given the tier is OFF, when `evaluateArtifact` runs end to end, then the gate verdict,
    `must_have_coverage` status, detail string, and the artifact score are byte-identical to
    the pre-change build — settled by running the existing `api/test/` suite unchanged (zero
    modified expectations) plus a golden-fixture comparison of `runChecks` output. Any test
    whose expected string had to change is a regression to justify, not to accept.

25. Given `writeEvidence` returns `{ total, evidenced, unevidenced, refused, profile_records }`
    and `evidenceResolve` publishes `note: 'every requirement is evidenced by a verbatim
    excerpt of your profile'` when `evidenced === total` (appRequirements.ts:563-565), when
    proposed rows contribute to `evidenced`, then that sentence is no longer emitted unless
    every contributing row IS a verbatim excerpt — settled by a test asserting the note text
    for a run whose numerator includes a proposed row. (The sentence happens to stay literally
    true — `verifyProposal` guarantees byte-exactness — but the return shape must also report
    `proposed` as its own count so the caller can tell the two apart.)

26. Given `writeEvidence`'s return type, when escalation runs, then it gains explicit counts:
    `escalated` (rows sent to the model), `proposed` (rows accepted), and refusals broken down
    by `ProposalRefusal`. Settled by a test asserting `evidenced = deterministic + proposed`
    and `escalated >= proposed`. Without this the caller cannot distinguish a coverage rise
    caused by the model from one caused by the profile changing — which is the drift the
    RISKS section below is about.

## Batch 5 — schema reality check, and what is ALREADY guarded

**Correction to Batch 2's blocking observation, ground-truthed by reading `schema.ts`
lines 1110-1118.** `SCHEMA_SQL` *does* manage this correctly:
`alter table requirement_evidence drop constraint if exists requirement_evidence_method_check;`
then `add constraint ... check (method in ('exact','anchored','proposed'));` then
`add column if not exists proposal_version int;`. `api/test/hardening.test.mjs:3205`
(`H:model-evidence-is-labelled`) already asserts all three, plus that
`proposal_version` has NO default. `api/test/schemaParity.test.mjs` already proves
fresh-vs-upgraded parity for `SCHEMA_SQL` against a real local cluster.

**What is STILL live, and it is the same class the parity test was written for.**
`ensureEvidenceTable()` (appRequirements.ts:34-56) is a SECOND declaration of
`requirement_evidence`, in a different file, still carrying
`check (method in ('exact','anchored'))` and no `proposal_version`. It is the HOT-PATH
DDL — `ensureRequirementCols` (line 70) and `appChecks.ts:63` call it on every request —
and its stated purpose is "so an environment that has not re-migrated cannot 500 on the
first evidence write". Neither `schemaParity.test.mjs` nor `H:model-evidence-is-labelled`
reads `appRequirements.ts`; both read `schema.ts` only. So the exact environment that
function exists to protect is the one where a `method='proposed'` insert throws.
This supersedes AC 4:

27. Given a database where `requirement_evidence` does NOT yet exist, when
    `ensureEvidenceTable()` creates it and the escalation tier then writes a proposed row in
    the same request (before any `pgMigrate` run of `SCHEMA_SQL`), then the insert succeeds —
    i.e. `ensureEvidenceTable`'s inline CHECK admits `'proposed'` and its column list includes
    `proposal_version int`. Settled by a NEW H-case (slug, per CLAUDE.md — e.g.
    `H:evidence-ddl-parity`) that extracts the `create table` body from `appRequirements.ts`
    and asserts its method CHECK and column set match `SCHEMA_SQL`'s post-ALTER state; and by
    executing `ensureEvidenceTable`'s DDL against the local PostgreSQL followed by an
    `insert ... method='proposed'`. A test that reads only `schema.ts` does NOT settle this.

28. Given `ensureEvidenceTable` is documented as taking no ACCESS EXCLUSIVE lock
    (appRequirements.ts:28-32 — four artifacts of one packet enter `evaluateArtifact`
    concurrently), when it is amended for the escalation tier, then it still issues no
    `drop constraint`/`add constraint` on the hot path. Settled by a source assertion that
    the function body contains no `drop constraint` and no `alter table requirement_evidence
    add constraint`. Fixing AC 27 by copying `ensureRequirementCols`'s drop/add pattern would
    reintroduce the exact lock the comment forbids — the correct fix is the inline CHECK in
    the `create table` plus an `add column if not exists`.

29. Given `openaiJson.ts` throws on a missing `OPENAI_API_KEY` and on any non-2xx
    (lines 44, 56), when the escalation pass hits either, then the requirement is left
    UNEVIDENCED and the run reports the transport failure distinctly from "the model declined"
    — it must NOT be caught and folded into a refusal count, and it must NOT abort the whole
    `writeEvidence` (losing the deterministic rows). Settled by three tests injecting a
    `FetchJson` that (a) throws `OPENAI_API_KEY not set`, (b) throws `OpenAI HTTP 429`,
    (c) rejects after a timeout — each asserting the deterministic row count is unchanged,
    no `proposed` row exists, and the returned shape carries a non-zero transport-error count.
    The transport's own comment states the reason: "a transport outage becom[ing] a stored
    finding of 'no evidence exists'" is the failure to prevent.

30. Given `contentJson(raw)` returns null for an unparseable body (openaiJson.ts:74-84), when
    the model returns prose, an empty string, a non-object, or an unbalanced brace, then
    `verifyProposal(requirement, records, null, ...)` is reached and refuses with
    `'model_declined'` — and the row is recorded as an UNPARSEABLE outcome distinct from a
    model that genuinely said `supported:false`. Settled by a test feeding each malformed body
    through `contentJson` → `verifyProposal` and asserting no row is written. Note the
    existing `api/test/openaiJson.test.mjs` already covers `contentJson`'s three cases; this
    AC is about what `writeEvidence` DOES with the null.

31. Given `openAiJson({feature})` requires a metering feature key and `logUsage` is called on
    every call (openaiJson.ts:60, guarded by `H:model-call-is-metered`), when the escalation
    tier calls it, then `feature` is a stable, escalation-specific key (e.g.
    `evidence:escalate`) and `usage_metering` shows one row per model call. Settled by
    `select feature, count(*) from usage_metering where feature like 'evidence:%'` against the
    live DB via `.github/workflows/db-query.yml` after one real run, and by asserting the
    literal appears in `appRequirements.ts`. A tier that can spend per requirement and does not
    appear in `/app/usage` is invisible spend.

32. Given the model is called once per escalated requirement, when a posting has 38
    unevidenced requirements (the measured live case), then the run is bounded by an
    owner-settable cap and the cap is observable in the result — settled by a test with 38
    escalatable rows and a cap of 5 asserting exactly 5 transport calls and a reported
    `escalation_capped: true`. Without a cap one backfill of 50 opportunities is an unbounded,
    unattended spend on the `requirementsBackfill` path (appRequirements.ts:494 loops every
    opportunity).

33. Given `writeEvidence` is documented and tested as "Deterministic and model-free, so it is
    safe to re-run" (appRequirements.ts:88, 460, 528), when the escalation tier lands, then
    those three comments and the route docstrings are corrected, and re-running with the tier
    ON is still IDEMPOTENT in its stored result: a second run over an unchanged profile and
    unchanged posting produces the same set of `proposed` rows. Settled by running
    `writeEvidence` twice with a recorded/replayed transport and diffing
    `select requirement_id, source_key, char_start, char_end, method, proposal_version
     from requirement_evidence ... order by 1,2,3` — the two snapshots must be equal.
    A non-zero `temperature` would break this; `openAiJson` defaults it to 0, so assert the
    escalation caller does not override it.

34. Given re-running now costs model calls, when `writeEvidence` runs a second time with no
    change to profile or posting, then it does NOT re-escalate rows already carrying an
    accepted `proposed` row of the current `PROPOSAL_VERSION` — or, if it does, that is a
    stated decision with the spend acknowledged. Settled by a test asserting the transport call
    count on the second run. Note the current code DELETES every evidence row for the
    opportunity first (line 113-115), so the naive wiring re-escalates everything on every
    `requirementsGet`-adjacent write path, and `evaluateArtifact` runs per artifact.

## Batch 6 — working-tree state (re-read 2026-08-21, files changed under me)

`git status` shows `appRequirements.ts`, `evidence.ts`, `evidenceProposal.ts` MODIFIED and
uncommitted; HEAD is `5dfeb97 One OpenAI transport…`. The wiring itself is NOT yet written
(`grep` finds no `worthEscalating`/`verifyProposal`/`openAiJson` reference in
`appRequirements.ts`, `checkPrefs.ts` or `appChecks.ts`). What HAS landed in the tree:

- `evidence.ts:98` — `method: 'exact' | 'anchored' | 'proposed'`, and
  `proposal_version?: number | null`. **AC 20 is satisfied.**
- `evidence.ts:85-92` — `ratio` documented as NULL for a proposed row, explicitly relying on
  `order by ratio desc NULLS LAST`. **AC 7 is satisfied BY DESIGN but not yet BY TEST** — it
  still needs the SQL assertion, because nothing stops a future writer passing a ratio.
- `appRequirements.ts:66-72` — `ensureEvidenceTable` now appends
  `drop constraint if exists requirement_evidence_method_check` +
  `add constraint … check (method in ('exact','anchored','proposed'))` +
  `add column if not exists proposal_version int`. **AC 27 is satisfied. AC 28 is now a LIVE
  DEFECT**, see below.
- `loadRequirementsWithEvidence` still does NOT select `proposal_version`. **AC 6 open.**
- `ensureEvidenceTable`'s inline `create table` CHECK is still `('exact','anchored')`.

35. Given `ensureEvidenceTable` is called on the hot path by `ensureRequirementCols` and by
    `appChecks.ts:63`, and given the file's own comment (lines 28-32) says the hot path calls
    only this function BECAUSE "`create table if not exists` takes no lock on an existing
    table" while a drop-and-re-add CHECK "takes an ACCESS EXCLUSIVE lock on `requirement` —
    fine in the backfill and the requirements GET, and not fine in `evaluateArtifact`, which
    four artifacts of one packet can enter at the same moment", when the new
    `drop constraint`/`add constraint` pair now added to `ensureEvidenceTable` runs, then it
    must NOT be on the hot path. Settled by (a) a source assertion that
    `ensureEvidenceTable`'s body contains no `drop constraint`, and (b) a concurrency test
    running four `evaluateArtifact`-shaped calls against the local PostgreSQL simultaneously
    and asserting none blocks or deadlocks on `requirement_evidence`. **The correct fix is to
    widen the INLINE CHECK inside `create table if not exists` (for fresh databases) and put
    the drop/add ALTER in `ensureRequirementCols` — the cold path that already does exactly
    this for `requirement_kind_source_check` — not in the hot one.** As written the change
    trades a production insert failure for a per-request ACCESS EXCLUSIVE lock, which is the
    trap the surrounding comment was written to prevent.

36. Given the inline `create table if not exists` CHECK in `ensureEvidenceTable` still reads
    `('exact','anchored')`, when a FRESH database is created by that path and the ALTER pair
    is moved per AC 35, then the create and the alter still agree — settled by the new
    `H:evidence-ddl-parity` case asserting the inline CHECK text in `appRequirements.ts`
    matches `SCHEMA_SQL`'s post-migration state, so the two declarations of one table cannot
    drift again.

37. Given `EvidenceRow.ratio` is documented as NULL for a proposed row, when any code path
    writes a proposed row, then `ratio` IS null — settled by a test inserting via the real
    `writeEvidence` escalation path and asserting `select ratio from requirement_evidence
    where method='proposed'` returns null for every row, and by a `runChecks` assertion that
    a proposed row does not outrank a deterministic one in the lateral join (AC 7).

## Batch 7 — what must NOT move, and the score parser

Ground truth: `artifactScore.ts:85-122` does NOT recompute coverage — it FINDS the
`must_have_coverage` check row (`engine === 'deterministic'`, line 92) and **parses the
numerator out of its `observed` string**, returning `value: null` when the message
"does not state how many requirements it judged" (line 117). `judgedRequirementIds`
(line 208-218) returns `[]` when `must_have_coverage` is null. `checks.ts:692` `gateFor`
turns the check states into the gate.

38. Given AC 19 option (a) appends "(N model-proposed)" to `must_have_coverage`'s observed
    string, when `artifactScore` parses it, then the numerator still parses and
    `must_have_coverage` is a number, not null — settled by a unit test feeding the exact new
    string through `artifactScore` and asserting the value. A message change here silently
    nulls a score component and empties `judgedRequirementIds`; that is a downstream consumer
    of a STRING, which is the most fragile coupling in this path.

39. Given `artifactScore.ts:92` filters `engine === 'deterministic'` specifically to stop "a
    reviewer row keyed `must_have_coverage`… feed[ing] a model's opinion into" the score, when
    proposed rows raise coverage, then that filter no longer means what its comment says — the
    deterministic check's own number now contains model-sourced evidence. Settled by an
    explicit decision recorded in the comment plus, per AC 19, the count being visible in the
    string. This is the clearest place the change "silently loosens the evidence standard".

40. Given the escalation tier is OFF (the default), when the full `api/test/` suite runs, then
    every existing test passes with ZERO modified expectations — settled by
    `cd api && npm run build && node --test test/`. In particular `checks.test.mjs`,
    `evidence.test.mjs`, `hardening.test.mjs` (H4, H6, H29,
    `H:evidence-reverified-on-read`, `H:stale-evidence-not-absent`,
    `H:evidence-verified-at-the-boundary`, `H:model-evidence-is-labelled`) and
    `schemaParity.test.mjs` must be untouched.

41. Given `app/src/screens/PostingAnalysis.jsx:238` already annotates
    `match_method === 'anchored'` with "(located by anchor, not an exact string match)", when a
    proposed evidence row is rendered, then the UI states its provenance in the same place and
    register — settled by `.github/workflows/ui-verify.yml` with an `expect` substring naming
    the model-proposed label on a posting known to have one. A row whose provenance is only in
    the database and never on screen fails the "provenance readable from the stored row" clause
    of this brief.

42. Given `verifyEvidence()` recomputes `sha256(rec.text)` against the stored `record_sha256`
    (evidence.ts:591), when a proposed row is written, then it stores the REAL digest of the
    record it quoted — settled by a test asserting `record_sha256 = sha256(rec.text)` for
    proposed rows, so that `H:evidence-reverified-on-read` and the `stale` state work
    identically for them. `record_sha256` is `not null` in both DDLs; a proposed row that
    stored `''` would be silently exempt from re-validation (the regex at line 591 requires
    64 hex chars, so a blank digest reports "not changed" — a proposed row could then never go
    stale).

43. Given `resolver_version` is `not null` on `requirement_evidence`, when a proposed row is
    written, then it carries `RESOLVER_VERSION` (the deterministic pass that refused it) AND
    `proposal_version = PROPOSAL_VERSION` — settled by a SQL assertion on both columns. The two
    answer different questions and neither may be a placeholder.

44. Given `writeEvidence`'s pre-store refusal guard (`appRequirements.ts:133-134`,
    `rec.text.slice(char_start, char_end) !== quote` → `refused++`), when an accepted proposal
    is stored, then it passes that SAME guard — the escalation path must go through it, not
    around it. Settled by asserting the guard runs on proposed rows (drive a proposal whose
    offsets are correct against `records` A but which is stored against `records` B, and assert
    `refused` increments and no row is inserted), mirroring `H:refusal-guard-fires`.

---

# RISKS THE PLAN MAY HAVE MISSED

Adversarial, ordered by how quietly each one lands.

**R1 — The gate flips and nothing says so. (highest)**
`appChecks.evaluateArtifact` builds `EvidenceInput.bySeq` straight from
`loadRequirementsWithEvidence` and never calls `verifyRequirementRows`. `checks.ts:587`'s
`evidenceOf` is `bySeq[seq] != null`. So the ONLY thing standing between a model proposal and
an `ok` on `must_have_coverage` — the check whose own comment says it "decides the GATE, so it
is an accusation-grade test" — is `verifyProposal`'s `indexOf`. That check is genuinely strong
against paraphrase; it is NOT a check on RELEVANCE. A model that quotes a real, verbatim,
correctly-attributed sentence that does not actually support the requirement produces a row
indistinguishable from a deterministic one at the gate. The deterministic tier had a relevance
floor (token overlap, `EVIDENCE_THRESHOLD`, distinctive tokens); the escalation tier's only
relevance judge is the model itself, and `reasoning` is stored, never verified. **The evidence
standard moves from "verbatim AND lexically supported" to "verbatim", and the gate cannot tell.**

**R2 — Coverage drift is unattributable after the fact.**
`writeEvidence` deletes every evidence row for the opportunity and rewrites. Nothing records
what coverage WAS. If a posting goes 1/10 → 7/10, no stored artifact says whether the profile
improved, thresholds changed, or the model got chattier. `usage_metering` records spend, not
outcome. Without the per-run `escalated`/`proposed`/refusal-by-reason counts of AC 26 persisted
alongside the artifact score, "coverage rose" is not falsifiable — and coverage is the number
the approval gate and the score both read.

**R3 — The tier is non-deterministic where the whole file claims determinism.**
Three docstrings say "Deterministic and model-free, so it is safe to re-run"
(appRequirements.ts:88, 460, 528) and `evidenceResolve`'s route comment says the same. Two runs
over identical inputs can now differ. `temperature: 0` is not a determinism guarantee. Every
downstream re-run — `requirementsBackfill` over 50 opportunities, `evaluateArtifact` per
artifact, any future retry — can move the gate for an unchanged posting and an unchanged
profile. That is the "stale/mismatched numbers across surfaces" failure the root CLAUDE.md
devotes a whole strict rule to, arriving through a new door.

**R4 — `evaluateArtifact` concurrency: four artifacts, four escalation runs, one delete each.**
Four artifacts of one packet enter `evaluateArtifact` concurrently (the file says so). Each
calls `writeEvidence`, which BEGINs, DELETEs all evidence for the opportunity, re-resolves, and
inserts. Today that is idempotent so interleaving is harmless. With escalation, four concurrent
runs each spend 38 model calls, and — because they can return DIFFERENT proposals — the last
committer wins with a row set the other three did not see. The gate each artifact was judged
against may be a row set that no longer exists. Neither the `unique(...)` constraint nor
`on conflict do nothing` helps: the DELETE precedes them.

**R5 — The new `drop constraint` on the hot path.** See AC 35. `ensureEvidenceTable` now takes
an ACCESS EXCLUSIVE lock on `requirement_evidence` on EVERY request, in the exact function whose
comment explains it was kept lock-free for the concurrent path. Under R4's four-way concurrency
this is a serialization point at best and a lock pileup at worst, and it will present as
intermittent 500s on `evaluateArtifact`, not as a migration bug.

**R6 — A transport outage reads as "your profile supports nothing".**
`openaiJson.ts`'s own comment names this. But the shape of `writeEvidence` makes it easy to get
wrong: if the escalation pass is wrapped in a broad `try/catch` that swallows, every escalatable
row silently stays unevidenced and the run reports a normal, lower coverage — identical to a
successful run where the model declined everything. Per the house rule, absent evidence is
`not_applicable`, never `pass`; here the analogue is that a transport failure must not be
reported as a measured coverage. `EvidenceHealth`/`evidenceState` currently has no state for
"we could not ask" — five states exist (`none`/`verified`/`stale`/`misresolved`/`source_missing`
/`unverified`) and none of them means this.

**R7 — Cost is per-requirement and unattended.**
`requirementsBackfill` loops up to 50 opportunities (`limit` capped at 500 at line 466) and calls
`writeEvidence` for each. At 38 unevidenced requirements on one posting, one backfill is
thousands of calls. `worthEscalating` filters by class and token count only — it does not cap.
The toggle defaults OFF, which contains this only until someone turns it on and runs a backfill.

**R8 — `verifyProposal` is only as safe as the records it is handed.**
`opts.neverEvidence` is a parameter, not a default. If the caller passes an empty `Set` (or
forgets the argument entirely under a loosely-typed call), `banned_source` never fires and
`itemsToOmit` — the owner's explicit do-not-use list — becomes quotable. Worse, the banned
records must ALSO be excluded from `buildProposalUser`'s rendered list; otherwise the model is
shown text it must not quote, and the only thing stopping it is a post-hoc filter. The
deterministic path excludes them at source (`resolveAll` filters on `NEVER_EVIDENCE` before
resolving). AC 15 covers this; it is listed here because a missing argument is invisible in
review.

**R9 — `contentJson`'s brace-salvage is a small fuzzy step in an accusation path.**
`contentJson` recovers an object from prose by `indexOf('{')` / `lastIndexOf('}')`. That is
lenient parsing of a model answer that then decides an evidence row. It is bounded (the quote
still faces `indexOf`), so it cannot manufacture a false quote — but it CAN turn a malformed,
half-hallucinated response into a well-formed proposal that passes. The safer posture for the
escalation caller specifically is to require a clean `JSON.parse` and treat salvage as
`model_declined`.

**R10 — `proposal_version` is not in the read path, so provenance dies at the join.**
`loadRequirementsWithEvidence` names its columns explicitly. Until `proposal_version` is added
there, the column is written and never read: `shapeRequirementsForApi`, `appChecks`,
`appDimensions.shapeRequirement` and every UI surface see a proposed row as an ordinary evidence
row. The database would distinguish them; nothing a human looks at would. That is precisely "a
row that reads as verified but is not."

**R11 — `verifyRequirementRows`' prefix redaction is load-bearing for the new column.**
It nulls every key starting with `evidence_`. If the join aliases the column as
`proposal_version` rather than `evidence_proposal_version`, a redacted (stale/misresolved)
proposed row keeps its provenance field while losing its quote — a fragment of a withdrawn
excerpt surviving redaction, which that function exists to prevent.

**R12 — The `worthEscalating` skip list is a silent coverage policy.**
Rows skipped before the call are indistinguishable, in the stored result, from rows the model
declined and from rows the transport never reached. Three different facts, one absent row. The
owner sees "not evidenced" and cannot tell that the system chose not to look. `evidenceSearch` /
`lookedFor` already sets the precedent that "what we looked for" must be surfaced; the
escalation skip needs the same treatment or it is a quiet downgrade of an existing, better
behaviour.

**R13 — No test can be written for "the model was not called" unless the seam exists.**
`writeEvidence`'s only injection seam today is `resolver`. The transport must be injectable the
same way (a defaulted parameter, as `openaiJson.ts`'s `FetchJson` type anticipates) or ACs 3, 9,
10, 29, 32 and 34 are all unverifiable — and an untested guard is `not_applicable`, not `pass`,
by this repo's own rule.

**R14 — Per-owner toggle, but the profile read is global.**
`sourceText()` takes no owner argument at any call site in `appRequirements.ts`. If profile
records are effectively global while the escalation toggle is per-owner, then one owner's
escalation setting governs model calls made against records another owner may also be scored
against. Worth confirming before the toggle is described as per-owner isolation.

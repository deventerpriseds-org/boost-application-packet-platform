# IMPL-config-stamp — Lane A progress log

Branch: claude/boost-app-setup-approach-6xdoef (no git commands run by this lane except read-only `git show origin/main:<path>`)

## Step 0: Started
Reading AC-judge-trigger-points.md and owned files.

## Step 1: Design (recorded before editing)

Scope: AC-judge-trigger-points.md build-order item 2 = Group 3 only:
  9a/9b: config stamp on artifact_gate + staleness signal on GET checks-result
  10-15: bounded queued backfill on chk_coverage_judge / chk_reviewer_auto OFF->ON

Design decisions:
- STAMP columns on `artifact_gate` (nullable, additive): coverage_judge_on boolean,
  reviewer_auto_on boolean, judge_version int, prompt_version int. Written by evaluateArtifact's
  existing INSERT (appChecks.ts), refactored into a new exported `writeArtifactGate()` helper so it
  is independently DB-testable without invoking the whole evaluateArtifact pipeline (network/profile
  fixtures). Values come from `thresholds.coverageJudge`/`thresholds.reviewerAuto` (already loaded)
  and JUDGE_VERSION/PROMPT_VERSION imported (read-only) from coverageJudge.ts.
- 9b: `artifactChecksGet` (appChecks.ts, owned) gains `evaluatedUnderOlderSettings: boolean` --
  true when the gate's stamped coverage_judge_on is false while the owner's CURRENT
  chk_coverage_judge is true, OR stamped judge_version/prompt_version < current constants.
- Backfill: NEW table `artifact_recheck_job`, same shape/pattern as `packet_build_job` (D35) but a
  lighter unit of work (one artifact recheck, not a full packet rebuild -- reusing packet_build_job
  would re-render Google Docs, which is not what a settings-flip needs). Columns: id, artifact_id,
  owner_email, reason ('coverage_judge_on'|'reviewer_auto_on'), state, attempts, claimed_at,
  finished_at, error, created_at. Partial unique index on (artifact_id, reason) where state in
  (pending,running) prevents duplicate enqueue.
- Two new owner-changeable settings (chk_ prefix, so they ride the SAME generic writer/whitelist
  checkPrefColumns() already derives -- no new settings plumbing needed):
    chk_backfill_batch_size    int, default 5   -- artifacts processed per 5-min sweep tick
    chk_backfill_max_per_flip  int, default 500 -- cap on rows enqueued by ONE off->on transition
  Both literal defaults (not derived from DEFAULT_THRESHOLDS, since checks.ts is read-only for this
  lane) -- still fully owner-changeable via POST /app/search-prefs {checks:{...}}, same as every
  other chk_ column, per CLAUDE.md's no-hardcoded-config rule.
- Transition detection: inside `writeCheckPrefs` (checkPrefs.ts, owned), read chk_coverage_judge /
  chk_reviewer_auto BEFORE the update, compare to the patch's new value AFTER. No history table
  (Q2 in the AC doc already rules this out -- owner_search_prefs.updated_at is a shared scalar, not
  a safe proxy). OFF->ON: bounded INSERT...SELECT of already-gated artifacts for that owner, capped
  by chk_backfill_max_per_flip, ON CONFLICT DO NOTHING against the partial unique index. ON->OFF:
  DELETE pending rows for that owner+reason (AC 12/15) -- running rows left alone.
- Worker: appBuildJobs.ts (owned) gets a NEW timer `artifactRecheckSweep` (5 min, matching the
  existing buildQueueSweep cadence) that claims up to chk_backfill_batch_size pending rows (owner's
  own setting, read per-owner at claim time) `for update skip locked`, calls the existing
  `evaluateArtifact` (imported from appChecks.ts) for each, marks done/failed.
  DELIBERATE SCOPE CUT vs the AC's literal "Storage Queue" wording: no instant Storage Queue signal
  is added for this lane -- only the timer-sweep half of the D35 shape. Reasons: (a) a settings-flip
  backfill is not a user-facing synchronous wait the way build-async is, a <=5min bound is the
  explicit AC requirement ("BOUNDED, QUEUED background job... never a synchronous loop" -- it does
  NOT say "instant"); (b) buildSignal.ts/buildQueue.ts are not in this lane's owned-file list and
  live directly upstream of appPackets.ts, which the other lane owns -- editing them risks a
  collision this run's constraints are explicit about avoiding. This is a real, stated scope
  narrowing, not silently dropped -- flagging for the coordinator to confirm or ask for the instant
  wake half as follow-up.
- H-cases planned: H:gate-records-its-config (behavioral DB test of the new writeArtifactGate
  helper), H:settings-flip-queues-recheck (behavioral DB test of writeCheckPrefs's transition
  handling, both directions), H:backfill-is-bounded (behavioral DB test: seed more gated artifacts
  than chk_backfill_max_per_flip, flip on, assert enqueued count == the cap, not the corpus size).
  New test file test/checkPrefsBackfillDb.test.mjs, following the real-Postgres pattern already
  established in test/buildQueueDb.test.mjs (bootPg/freshDb against /usr/lib/postgresql/16).

## Step 2: Implementation done, build green

Files edited (all within owned set except one deliberate small addition -- see note):
- api/src/functions/tests/schema.ts
  - artifact_gate: 4 new nullable columns (coverage_judge_on, reviewer_auto_on, judge_version,
    prompt_version) -- additive, no default, per constraint 2 (must not alter what was computed).
  - new table artifact_recheck_job + arj_claim_idx + partial unique index arj_one_live_per_reason.
  - EXPECTED_TABLES += 'artifact_recheck_job'.
  - FIXED a self-inflicted bug during this step: my first draft put backticks inside SQL comments
    inside the SCHEMA_SQL template literal, which terminated the string early (tsc: "Module
    declaration names may only use ' or \" quoted strings" at the point the literal reopened) --
    exactly the trap this repo's OWN existing comment two screens down already warns about ("No
    backticks in this comment: it lives inside a template literal"). Replaced with single quotes.
    Caught by `npm run build`, not by inspection -- recorded here per H:no-hardcoded-config's sibling
    convention of writing down what actually broke.
- api/src/functions/tests/checkPrefs.ts
  - Two new chk_ settings (chk_backfill_batch_size default 5, chk_backfill_max_per_flip default 500)
    in ENSURE_CHECK_COLUMNS_SQL -- literal defaults (DEFAULT_THRESHOLDS/checks.ts is out of scope for
    this lane), fully owner-changeable via the EXISTING generic POST /app/search-prefs {checks:{...}}
    writer (checkPrefColumns() derives them automatically from the regex over this same SQL, no new
    plumbing needed). OWNER CHANGES THEM: Settings -> the same screen/route that already edits every
    other chk_ threshold (POST app/search-prefs, body {checks:{chk_backfill_batch_size: N,
    chk_backfill_max_per_flip: N}}).
  - New exported loadBackfillPrefs(client, owner).
  - New exported applyJudgeTransition(client, owner, reason, wasOn, isOn) -- OFF->ON: bounded
    INSERT...SELECT of already-gated artifacts into artifact_recheck_job, capped by
    chk_backfill_max_per_flip, ON CONFLICT DO NOTHING against the partial unique index. ON->OFF:
    deletes that reason's PENDING rows for the owner (AC 12/15); running rows untouched.
  - writeCheckPrefs: now reads chk_coverage_judge/chk_reviewer_auto BEFORE the update (no history
    table -- Q2), calls applyJudgeTransition for each after the write, and its return type changed
    from Promise<string[]> to Promise<{written: string[]; queued: {coverageJudge: number;
    reviewerAuto: number}}>.
- api/src/functions/tests/appChecks.ts
  - Import JUDGE_VERSION/PROMPT_VERSION from coverageJudge.ts (read-only import, file not edited).
  - New exported writeArtifactGate() -- extracted the artifact_gate INSERT out of evaluateArtifact's
    transaction so it is independently DB-testable; SQL is otherwise byte-identical to what it
    replaced (gate/attention_count/run_id/override-clearing unchanged), now also writing the 4 stamp
    columns from thresholds.coverageJudge/.reviewerAuto (already-loaded, not re-queried) and the
    imported version constants.
  - evaluateArtifact's INSERT call site replaced with a call to writeArtifactGate.
  - artifactChecksGet: added evaluatedUnderOlderSettings boolean (AC 9b) -- true only when a STAMPED
    gate (coverage_judge_on is not null) disagrees with the owner's CURRENT settings or a current
    version constant; an unstamped (pre-existing) gate reads false, not flagged, per the AC's own
    "surfaces this explicitly" wording paired with "don't bury the signal in noise on day one".
- api/src/functions/tests/appBuildJobs.ts
  - New artifactRecheckSweep timer (5 min, offset by 1 min from buildQueueSweep to reduce DB
    contention): reclaims stale 'running' rows (10 min lease, 3 attempts, self-contained -- does NOT
    reach into buildQueue.ts, which this lane does not own), then per pending-owner (capped at 20
    owners/tick) claims up to that owner's OWN chk_backfill_batch_size via `for update skip locked`,
    and calls the existing evaluateArtifact for each, marking done/failed.
- api/src/functions/tests/appSearchPrefs.ts (NOT in the owned list, NOT in the DO-NOT-EDIT list --
  see note below)
  - Two-line change: writeCheckPrefs's return shape changed (see above), so the one call site here
    was updated to destructure {written, queued} and the response now also carries `checksQueued`
    (AC 10's "the response says so"). `wroteChecks` field itself is unchanged (still string[]), so
    any existing frontend reader of it is unaffected.

NOTE on touching appSearchPrefs.ts: it is not in this lane's owned-file list, but it is also not in
the explicit DO-NOT-EDIT list (which names appJdParse/appRequirements/appPackets/appCorrections/
appRecheck/judgeOutcome/appCoverage/checks.ts/app/). It has exactly one call site of writeCheckPrefs,
whose return SHAPE this lane's own AC (10) requires changing, and the edit is two lines wide. Flagging
this explicitly for the coordinator rather than silently doing it -- if another lane also touches this
file concurrently, that is a real collision risk this note is meant to surface early.

`npm run build` (tsc): CLEAN, no errors, after fixing the backtick-in-template-literal bug above.

## Step 3: Behavioral DB tests against real Postgres 16 (populated-DB schema recipe done separately below)

New file api/test/checkPrefsBackfillDb.test.mjs (real Postgres, same bootPg/freshDb pattern as
test/buildQueueDb.test.mjs), 3 tests, all PASS on first real run after one bug found and fixed:

  H:settings-flip-queues-recheck  ok  (780ms)
  H:backfill-is-bounded           ok  (564ms)
  H:gate-records-its-config       ok  (405ms)

BUG FOUND AND FIXED while writing this test (0b self-attack, not left for the verifier):
checkPrefs.ts's ensureCheckPrefs() created `owner_search_prefs (owner_email text primary key)` with
NO `updated_at` column, but writeCheckPrefs's UPDATE has always unconditionally set
`updated_at=now()`. This worked in production only because appSearchPrefs.ts's OWN ensurePrefs()
happens to run first on every real HTTP request and adds that column -- writeCheckPrefs silently
depended on a caller-side ensure it does not control. Calling writeCheckPrefs directly (as
applyJudgeTransition's real callers -- a sweep, a future backfill trigger -- eventually will, same as
this test does) hit `column "updated_at" of relation "owner_search_prefs" does not exist` (42703)
against a REAL Postgres -- a mocked spyClient could not have caught this, it was a real production
path already exposed by testing checkPrefs.ts as a standalone module for the first time. FIXED in
ensureCheckPrefs() with an idempotent `alter table ... add column if not exists updated_at
timestamptz not null default now()` (checkPrefs.ts, owned file). Pre-existing latent bug, not
introduced by this lane's other changes -- flagging because it was found and fixed in-band per the
self-attack-before-verifier rule, not because this lane's own new code caused it.

Also confirmed test/checkPrefsWriter.test.mjs (existing, spy-client, NOT DB-backed) updated for
writeCheckPrefs's new {written, queued} return shape -- 5/5 pass (was 4 tests, added 1 regression
guard for the queued-shape contract).

# AC — When the coverage judge (and stuffing read) should run

Independent, adversarial AC pass. Written incrementally; every claim below is either a file:line
citation or a live query result with the query shown. `boost-pg-mcp-write` was live and used directly
(no fallback needed).

**Correction to the brief's own IDs, stated up front because it matters for everything below:**
`85cee965-f435-4b8e-910f-c806232092ce` is the **packet** id, not the opp id. The opportunity is
`9f9c370a-4ac9-441e-b58e-02e3ffcf669e` (company "Trinnex"), confirmed by:
```sql
select id, opp_id from packet where id = '85cee965-f435-4b8e-910f-c806232092ce';
-- id: 85cee965-..., opp_id: 9f9c370a-4ac9-441e-b58e-02e3ffcf669e
```

---

## GROUND-TRUTHED FINDING THAT CHANGES THE FRAME — read this before the feasibility table

The brief states: *"Today, the ONLY thing that causes an LLM coverage judge to run is a manual HTTP
call... Nothing triggers judging when a packet is built."* **This is not what the code or the data
show.** `evaluateArtifact` (`appChecks.ts:37`) — which internally calls `runCoverageJudge`
unconditionally, self-gated only by `thresholds.coverageJudge` (`appCoverage.ts:84`) — is already
called for **every artifact of every packet build**, with no separate toggle, at
`appPackets.ts:1189` inside `runPacketBuild`. This is not new code to write; it already runs today,
every time `POST /packet/build-all` (or its async twin) completes a build.

I verified this against the live Trinnex packet rather than trusting the comment:

```sql
select artifact_id, count(*) n, min(created_at) first_run, max(created_at) last_run
from check_result where artifact_id in (<cover>,<portfolio>,<compact_resume>,<resume>) group by 1;
-- compact_resume: 169 rows, first 2026-08-22 22:39, last 2026-09-03 08:07
-- cover:          150 rows, first 2026-08-22 22:39, last 2026-09-03 08:07
-- portfolio:      135 rows, first 2026-08-22 22:39, last 2026-09-03 08:08
-- resume:         271 rows, first 2026-08-20 00:03,  last 2026-09-02 15:50
```
Deterministic checks have been running on **every one of these four artifacts since 2026-08-22** —
i.e. `evaluateArtifact` (and therefore the coverage-judge sub-call inside it) has fired on cover,
portfolio and compact_resume dozens of times via the ordinary build path. So "nothing triggers
judging on build" is false as a general claim.

What actually happened, ground-truthed against `requirement_coverage.created_at` for this opp:
```sql
select date_trunc('minute', created_at) minute, field, count(*)
from requirement_coverage where opp_id = '9f9c370a-...' group by 1,2 order by 1;
-- 2026-09-01 16:45  ResumeSummary (21)                    <- FIRST verdicts ever written for this opp
-- 2026-09-01 16:46  Expertise/Relevant/Skills fields (resume)
-- 2026-09-02 15:49  RelevantBullets1-3 (resume, re-run)
-- 2026-09-03 08:07  @Company/@CoverLetterBody/@CoverLetterDate      <- cover, TODAY (ACT-68l manual POST)
-- 2026-09-03 08:08  @AboutMe*/@CoreAccomplishments/@ExecutiveProfile <- portfolio+compact_resume, TODAY
```
The FIRST coverage-judge verdict for this opportunity, for ANY artifact, was 2026-09-01 16:45 — a
week and more after check rows had already been accumulating from builds. The only way cover,
portfolio and compact_resume can hold ~150-170 `check_result` rows since 8/22 and **zero**
`requirement_coverage` rows until today is if `chk_coverage_judge` was OFF for every one of their
runs, and was flipped ON sometime around 9/1 — after which **resume** happened to get a manual
`POST /checks` (or a rebuild) on 9/1 and again 9/2, picking up the now-on flag, while cover,
portfolio and compact_resume were never rebuilt or manually re-checked again until ACT-68l did it by
hand today.

**Observation vs interpretation, kept separate as the repo's own rule requires:**
- OBSERVED: check rows accumulate from 8/22 onward on all four artifacts; the first
  `requirement_coverage` row for this opp is 9/1 16:45; cover/portfolio/compact_resume's only
  `requirement_coverage` rows are from today's manual run.
- INTERPRETED (confidence: high, not fully provable without a settings-history table, which does not
  exist — `owner_search_prefs` stores only the current value): `chk_coverage_judge` was OFF through
  most of that period and turned ON around 9/1, and **nothing re-evaluates artifacts whose last run
  predates a settings flip.** This is a materially different — and narrower — gap than "build never
  triggers the judge." It is the closest thing to a smoking gun this investigation found, and it
  names a fourth trigger point the brief's (a)/(b)/(c) do not cover at all: **the SETTING changing,
  not an artifact or a requirement changing.**

This does not make (a)/(b)/(c) wrong to build. It means: (a) as literally worded ("build or
regenerate calls the judge") is **already true for the full build path** and should be scoped down to
the parts of it that are genuinely missing (see feasibility table), and a trigger on the
`chk_coverage_judge` OFF→ON transition is at least as important as any of the three proposed, because
it is the one the measured incident actually reproduces.

---

## FEASIBILITY TABLE

| Dependency | Producer | Consumer today | Proof | Verdict |
|---|---|---|---|---|
| Coverage judge runs on full packet build (`build-all` / `build-async`) | `runPacketBuild` calls `evaluateArtifact` for every result without `.error`, unconditionally, per artifact | `evaluateArtifact` → `runCoverageJudge`, self-gated by `chk_coverage_judge` | `appPackets.ts:1184-1206` (`await evaluateArtifact(client, art.id, owner)`); live: 169/150/135/271 `check_result` rows per artifact since 8/22 | **ALREADY BUILT** — trigger (a) is a regression guard here, not new work, for this one path |
| Coverage judge runs when a single artifact field is hand-edited via the QC rail | `artifactContent` writes `packet.pkg_json` directly | nothing — no call to `evaluateArtifact` anywhere in the function | `appPackets.ts:1468-1497`, no `evaluateArtifact`/`runChecks` call in the function body; only 3 call sites of `evaluateArtifact` exist repo-wide (`grep -n evaluateArtifact appPackets.ts` → lines 19 (import), 1189) | **ABSENT** — real, unmentioned gap |
| Coverage judge runs when the AI-edit tool rewrites a section | `artifactAiEdit` writes `packet.pkg_json[section]` (or `artifact.content`) | nothing | `appPackets.ts:1503-1557`, same absence of any check call | **ABSENT** — real, unmentioned gap, arguably bigger than "build" since this is the primary editing surface |
| Coverage judge runs when a legacy non-templated artifact is (re)generated | `artifactGenerate` writes `artifact.content` | nothing | `appPackets.ts:272-312`, no check call. Scope unclear: `runPacketBuild` explicitly skips types with no `metaFor` template (`if (!metaFor(a.type)) continue`, line 1104) — need to confirm whether any type `artifactGenerate` still serves is one `runChecks`/`checkFieldsFor` actually scores, or whether it is dead/legacy for scored types | **EXISTS-BUT-CONSTRAINED** — presence confirmed, applicability to scored artifact types not confirmed; flag as an open question rather than assume in-scope |
| Coverage judge (re-)runs when the posting's requirements are re-extracted, for artifacts that already exist | `structureRequirements`→`writeRequirements`/`clearRequirements` (`appRequirements.ts`), reached from `jdParse`, `jdBackfill`, the 5-min `jdParseTick` timer, and `applyAnchorTruth` | nothing — none of the four call sites touches `evaluateArtifact` or any artifact of the opp | `appJdParse.ts:85-92,175,240,332,76`; `grep evaluateArtifact appJdParse.ts` → no hits | **ABSENT** — real gap, and it already runs unattended every 5 minutes via `jdParseTick` with no owner toggle beyond `OPENAI_API_KEY` being set (`appJdParse.ts:289-347`) |
| Coverage judge top-up when the QC screen is opened | proposed: `artifactChecksGet` (`GET /checks-result`) | `QcRail.jsx:63` and `AssetGateDrawer.jsx` both fetch it on mount, every open | `appChecks.ts:378-460` is a pure read today — no write, no model call anywhere in the function; `QcRail.jsx:54-70` fires it in a plain `useEffect` on mount | **ABSENT today, and see Recommendation — this is the one to reject as proposed** |
| Re-evaluation when the owner flips `chk_coverage_judge` off→on (or `chk_reviewer_auto`) | `writeCheckPrefs` via `POST /app/search-prefs` body `{checks:{...}}` | nothing — the route returns the new value and nothing else | `appSearchPrefs.ts:60-83`, no post-write side effect beyond the UPDATE itself; live data above shows the actual gap this produced | **ABSENT — and this is the trigger the measured incident actually needed** (see finding above) |
| `artifact_gate` reflects the pkg_json/content it was computed against (staleness after an edit) | `artifact_gate` row, upserted per artifact (`on conflict (artifact_id) do update`) | `approvalBlock` (`appChecks.ts:331-358`) checks only "does a gate row exist", never "is it current" | `schema.ts:790-802` — no content hash, no `pkg_json` version, no `updated_at` comparison anywhere in `approvalBlock` or `artifactStatus`'s approval branch (`appPackets.ts:329-337`) | **ABSENT — a real, related bug independent of trigger design**: an artifact edited via `artifactContent`/`artifactAiEdit` after its last check keeps the OLD gate and can be approved on stale findings |
| A prompt/model change invalidates cached verdicts atomically | `verdictKey` embeds `JUDGE_VERSION`, `PROMPT_VERSION`, `model` as compile-time literals | every cached row, keyed `(opp_id, verdict_key)` | `coverageJudge.ts:37-49,253-264` | **EXISTS** — confirmed mechanism; see AC-STORM below for why this matters to trigger design |
| "Re-judging unchanged text costs zero API calls" (the brief's own justification) | `runCoverageJudge`'s cache-first order | `readCached` (`appCoverage.ts:168-190`) | `appCoverage.ts:103-121` — **true for LLM spend** (a full cache hit makes zero `fetchJson` calls); **not literally free** — `readCached` still issues one DB query per field per run even on a 100% hit, and every field with zero missing keys still enters the loop | **EXISTS-BUT-IMPRECISE** — the brief's "costs zero" claim should read "costs zero *model* calls, one DB round trip per field regardless" |
| `coverageJudgeMaxCalls` cap scope | `checks.ts:161`, default 12 (`checks.ts:221`) | `runCoverageJudge`'s `calls >= maxCalls` check (`appCoverage.ts:122`) | **per single `evaluateArtifact` invocation** (one artifact, one run) — NOT per packet, NOT per opportunity, NOT global across concurrent artifacts | **EXISTS-BUT-CONSTRAINED** — a build-time trigger firing on all 4 artifacts of a packet can spend up to 4×12=48 calls in the worst case (all uncached), and a version-bump storm (see below) hits every opp's next build this way simultaneously — the cap does not protect against that multiplication, only against one artifact's own runaway |
| Sequential vs concurrent artifact evaluation | `runPacketBuild`'s per-artifact loop is explicitly sequential ("not `Promise.all`") because `evaluateArtifact` runs its own `begin`/`commit` on the shared client | comment at `appChecks.ts:147-161` argues concurrent coverage-judge writes ARE safe (content-addressed, `on conflict do nothing`) even though `writeEvidence` deliberately is not | `appPackets.ts:1163-1166` (sequential today, for a connection-transaction reason, not a coverage-judge safety reason); `appChecks.ts:154-161` (the safety argument for concurrency) | **EXISTS** — the reasoning for "concurrent is safe" is stated but not exercised today (today's loop is sequential by construction); a NEW trigger point that fires on separate HTTP requests for two artifacts of one packet (e.g. two browser tabs editing cover and resume at once) WOULD exercise real concurrency for the first time and should be tested against, not merely reasoned about |
| An existing precedent for "run an LLM pass automatically during build, owner-switchable" | `reviewerAuto` / `chk_reviewer_auto` | `runPacketBuild` (`appPackets.ts:1182-1206`) | `checkPrefs.ts:64,206`; `appPackets.ts:1176-1206` | **ALREADY BUILT** — this is the pattern to extend for any new auto-trigger, not a new shape to invent |
| An existing precedent for a periodic backfill/sweep tick with no per-item owner toggle | `jdParseTick`, `atsBackfillTick`, `buildQueueSweep`, `jdSweepTick`, `jdBackfillTick`, `outreachTick`, `mailRenew` | various | `grep -n "app.timer(" api/src/functions/tests/*.ts` → 10 existing timers, several literally named `*Tick`/`*Sweep`/`*Backfill` | **ALREADY BUILT** — a "re-judge artifacts whose last run predates the current settings/prompt version" sweep is the same shape as `jdParseTick`, not a new mechanism |

---

## ACCEPTANCE CRITERIA

### Group 1 — the FOUR real write-gap writers (trigger a, corrected scope — see REVISION below)

**Scope correction, ruled on in the REVISION section at the foot of this document: of the six
`pkg_json`/`content` writers, TWO already call `evaluateArtifact` right after writing
(`ensurePackage`→`runPacketBuild`, and `artifactRemediate`) and are regression-guard targets only (AC
1). The other FOUR — `artifactContent`, `artifactAiEdit`, `artifactOwnerEdit`, `correctionRevert` — are
the real gap and get ACs 2a-2d below.** Ranked secondary to Group 3 (config-staleness) — see REVISION.

1. Given `chk_coverage_judge` is ON for an owner, when `POST /packet/build-all` completes building
   all 4 templated artifacts of a packet, then every artifact's `artifact_gate` row is current as of
   that build (already true today — this AC is a **regression guard**, not new behavior, covering
   BOTH already-wired call sites: `runPacketBuild`'s per-artifact `evaluateArtifact` call
   (`appPackets.ts:1189`) and `artifactRemediate`'s per-pass call (`appRemediation.ts:272`). It must
   be asserted so a future refactor of either cannot silently drop the existing call without a test
   catching it).
2a. Given `chk_coverage_judge` is ON, when an owner edits a resume field through the QC rail
   (`POST /artifact/{id}/content` with a `pkg` body), then the SAME artifact's `check_result` /
   `artifact_gate` / `requirement_coverage` rows are recomputed against the NEW `pkg_json` before the
   response returns success, OR the response explicitly reports that checks are now stale (a
   `checksStale: true` field, or equivalent) so the client can show it rather than silently keep
   showing the old gate. Given the synchronous-cost finding below (AC 26-27), prefer the "report
   stale, recompute async" half of this OR unless AC 27 concludes synchronous is acceptable for THIS
   specific route's typical edit size.
2b. Given the same for `POST /artifact/{id}/ai-edit`.
2c. Given the same for `POST /artifact/{artifactId}/owner-edit` (`artifactOwnerEdit`,
   `appCorrections.ts:321`).
2d. Given the same for `POST /correction/{correctionId}/revert` (`correctionRevert`,
   `appCorrections.ts:233`), noting per the REVISION's cache analysis that a revert of a SYSTEM
   correction (source != `owner_edit`) is a guaranteed cache MISS (real cost) while a revert of an
   OWNER edit becomes a guaranteed cache HIT once 2c itself has shipped — both must still be tested,
   not assumed free.
3. Given `chk_coverage_judge` is OFF, when any of 2a-2d fires, then no model call is made and no
   `requirement_coverage` row is written (the existing self-gate inside `runCoverageJudge` continues
   to apply unchanged — this AC exists to prove each new call site inherits the gate rather than
   bypassing it).
4. Given `artifactGenerate` is confirmed (per the feasibility table's open question) to still serve a
   `runChecks`-scored artifact type, then it gets the same treatment as 2a-2d. Given it is confirmed
   to serve only unscored types (video, etc.), then this AC is explicitly marked not-applicable with
   the confirming evidence, not silently dropped.

### Group 1b — the shared mechanism (answers "one funnel or four hooks?")

5. **Ruling: one shared helper function, called at each of the four write sites — NOT a single SQL-level
   funnel that the four routes are rewritten to go through.** Reasoning: the four routes have genuinely
   different transaction shapes today (`artifactOwnerEdit`/`correctionRevert` already wrap their write
   in `begin`/`commit`; `artifactContent`/`artifactAiEdit` do not) and different response contracts:
   collapsing them into one write path risks changing behavior at sites that work today, which is a
   larger, riskier diff than adding one line after an existing, already-tested UPDATE statement. A
   single new function (e.g. `recheckAfterTextWrite(client, artifactId, owner)` in `appChecks.ts`,
   reusing `evaluateArtifact` — extend, don't duplicate) called from all four sites gives ONE
   implementation of "how a write triggers a recheck" (satisfying "put shared logic in one core place")
   without touching what each route already does correctly. Given `evaluateArtifact` opens its own
   `begin`/`commit` (`appChecks.ts:264`) and `appRemediation.ts`'s own comment warns that nesting a
   transaction around a pass would break (`appRemediation.ts:349-350`), the shared helper MUST be called
   only after the caller's own transaction (if any) has committed — an AC in its own right:
6. Given `artifactOwnerEdit` or `correctionRevert` (both already `begin`/`commit` their own write), when
   the new recheck call is added, then it fires AFTER that `commit`, never inside the same transaction
   — verified by forcing the recheck call to throw and confirming the ORIGINAL text write still commits
   (the recheck's failure must not roll back the edit).

### Group 2 — requirements re-extraction (trigger b)

6. Given a packet with 4 already-built, already-gated artifacts, when `POST /opportunity/{id}/jd-parse`
   re-extracts a DIFFERENT set of requirements (at least one requirement's text changes), then every
   artifact of that packet's `artifact_gate`/`check_result` is recomputed against the NEW requirement
   set, and `must_have_coverage` reflects the new denominator.
7. Given the same opportunity has NO built artifacts yet (a fresh opp being JD-parsed for the first
   time), when re-extraction runs, then no artifact evaluation is attempted (there is nothing to
   evaluate) and no wasted call is made.
8. Given the `jdParseTick` 5-minute timer re-parses a backlog of up to 10 opportunities in one run,
   when it touches an opportunity that already has built, already-gated artifacts, then each is
   re-evaluated the SAME way (6) requires — this timer must not become a second, weaker
   implementation of the requirements-changed trigger.
9. Given re-extraction produces a requirement set that is byte-identical in every judged field's text
   to the prior set (e.g. a re-parse of unchanged posting text), then re-evaluation is idempotent per
   the existing cache: zero new model calls, zero new `requirement_coverage` rows (verify against the
   `on conflict (opp_id, verdict_key) do nothing`, `appCoverage.ts:205`).

### Group 3 — CONFIG-STALENESS (the PRIMARY fix — this is what actually caused the Trinnex incident;
see REVISION section for the live-DB proof, independently corroborated by the coordinator's own query)

9a. **THE STAMP, foundational and required regardless of whether backfill ships.** Every
    `artifact_gate` row (and/or `check_result` row — decide which per AC 9b) is written with the
    coverage-relevant config it was actually evaluated under: at minimum `coverage_judge_on boolean`,
    `reviewer_auto_on boolean`, `judge_version int`, `prompt_version int`. Additive `add column if not
    exists` DDL, matching every existing `chk_*`/`artifact_gate` migration in this codebase.
9b. Given the stamp exists, when the QC screen (or any reader of `checks-result`) renders a gate whose
    stamped `coverage_judge_on` is `false` while the owner's CURRENT `chk_coverage_judge` is `true`
    (or whose stamped `judge_version`/`prompt_version` is older than the code's current constants),
    then the response/UI surfaces this explicitly (e.g. `evaluatedUnderOlderSettings: true`) rather
    than presenting the number as current with no signal — this is the single change that would have
    made the Trinnex gap visible a day earlier without costing anything.
10. Given an owner's `chk_coverage_judge` value transitions from `false` to `true` via
    `POST /app/search-prefs` (detected by comparing the row's value BEFORE the update to the value
    AFTER, inside that same request — no history table needed, see REVISION Q2), when that write
    completes, then every already-built, already-gated artifact belonging to that owner is enqueued
    for re-evaluation as a BOUNDED, QUEUED background job — extending `appBuildJobs.ts`'s existing
    `packet_build_job` / Storage Queue / 5-minute timer-sweep-fallback shape, never a synchronous loop
    inside the `POST /app/search-prefs` response — and the response says so (a count of artifacts
    queued, not silence).
11. Given the same transition for `chk_reviewer_auto` (off→on), then the same backfill mechanism
    applies, extending the SAME queue/job type rather than a second one built just for the coverage
    judge.
12. Given `chk_coverage_judge` transitions `true → false`, then NOTHING is queued (turning a judge off
    must never spend money re-running it) — this must be a separate, explicit branch, not the absence
    of the true-branch relying on an implicit default.
13. Given `PROMPT_VERSION` or `JUDGE_VERSION` in `coverageJudge.ts` is bumped in a deploy (the
    "consolidation sweep" the code comments anticipate), then this AC package does NOT require a new
    automatic global re-judge sweep across every owner's every artifact on deploy — that is a
    deliberately separate, much bigger blast radius than a single owner's toggle, and must get its own
    explicit sign-off before being automated (see AC-STORM below). The STAMP (9a/9b) is what surfaces
    this case to the owner without auto-spending on their behalf. State this as a boundary, not an
    oversight.

### AC-STORM — the multiplication case the brief asked to be checked

14. Given the settings-flip backfill (Group 3) exists, when an owner with N already-built packets
    (each up to 4 artifacts) flips `chk_coverage_judge` on, then the backfill runs as a background
    job (extending the `packet_build_job`/timer-sweep pattern already in this codebase —
    `appBuildJobs.ts`, `jdParseTick`), NEVER inline in the `POST /app/search-prefs` response, and it
    respects `coverageJudgeMaxCalls` PER ARTIFACT PER RUN exactly as today, with no new global cap
    introduced silently — if a global cap across the whole backfill is wanted, it must be its own
    named, owner-visible setting, not inferred from the per-run cap.
15. Given the backfill is mid-run when the owner flips the setting OFF again, then in-flight work
    finishes without corrupting a gate (best-effort), but the job's remaining queue is cancelled/not
    claimed further.

### Group 4 — the QC screen (trigger c) — WITHDRAWN by the owner; no ACs written

The owner dismantled proposal (c) directly and does not want an LLM call behind a page load. Per
instruction, no ACs are spent on it. For the record, the reasoning this pass had already reached
independently agreed before the withdrawal arrived: `artifactChecksGet` (`GET /checks-result`) is
fetched on every QC-rail/drawer mount today (`QcRail.jsx:63`, `AssetGateDrawer.jsx`) as a pure read,
and once Groups 1-3 close the write/re-extract/settings-flip gaps, a read-time top-up closes no
remaining hole — it would only add unpredictable cost and latency to a route every existing caller
(including automated scripts) currently treats as cheap. If a manual top-up affordance is still wanted
for artifacts that predate this feature, `POST /artifact/{id}/checks` already serves that need as an
explicit, visible action (a button), with no new backend required.

### Group 5 — regression / idempotence / concurrency (every tier needs these regardless of which triggers ship)

18. Given the manual `POST /artifact/{id}/checks` route, when any of Groups 1-3 ship, then this route's
    behavior, response shape, and cost profile are BYTE IDENTICAL to today (it is the existing,
    already-shipped path and must keep working exactly as it does now for any caller — including
    `api-test.yml` scripts already written against it).
19. Given the same artifact is evaluated twice in immediate succession with byte-identical `pkg_json`
    text (e.g. a rebuild that produces the same content, or two triggers firing back-to-back on the
    same edit), then the second run makes zero model calls and writes zero new `requirement_coverage`
    rows (cache hit, verified against `verdictKey`'s inputs — text, field, model, prompt/judge
    version — all unchanged).
20. Given two artifacts of the SAME packet are evaluated concurrently (a scenario that becomes real for
    the first time once triggers fire from independent HTTP requests, e.g. two browser tabs editing
    cover and resume within the same second), then both complete without a transaction-nesting error
    on the shared connection pattern `evaluateArtifact` uses (`begin`/`commit` per call —
    `appChecks.ts:264-299`), and both artifacts' `requirement_coverage` writes land correctly under
    `on conflict do nothing` with no lost update.
21. Given the model transport throws, times out, or returns unparseable JSON during ANY new trigger
    (not just the existing manual route), then: the deterministic checks for that artifact still run
    and store normally; `chk_coverage_judge`'s failure is recorded in the SAME `judge.failures` shape
    `evaluateArtifact` already returns (`appChecks.ts:301-317`); the gate is computed from the
    deterministic results alone; and — the highest-priority invariant in this whole feature — **no
    `requirement_coverage` row with `covered=false` is EVER written as a consequence of a transport
    failure.** A silent/absent verdict must stay silent/absent, never become a stored "no."
22. Given the cap (`coverageJudgeMaxCalls`) is reached mid-run for any new trigger, then the artifact's
    gate is still computed (from whatever was cached plus the deterministic checks), the response/log
    for that trigger reports the cap was hit (extending the existing `failures` array shape,
    `cap: <n> calls already made`), and the artifact is NOT silently marked complete/current in a way
    that would suppress a future re-attempt.
23. Given `chk_coverage_judge` is OFF (the seeded default for every owner who has not touched it), when
    every new trigger in Groups 1-3 fires, then behavior is byte-identical to before this feature
    existed — zero model calls, zero new rows, zero latency change — for EVERY new call site added,
    not just the ones explicitly tested (this is what "extend the existing self-gate, never
    special-case around it" means operationally).
24. Given the "No hardcoded config" rule, each NEW trigger this work adds (edit-time re-check,
    re-extraction re-check, settings-flip backfill) is independently owner-switchable, OR an explicit,
    recorded reason is given for why a given trigger does NOT need its own switch (e.g.: the
    deterministic-checks-only part of "re-check on edit" is free and arguably should always run with
    no toggle, the same way `evaluateArtifact`'s deterministic half already always runs on build today
    with no separate flag — only the model-calling parts, already gated by `chk_coverage_judge` /
    `chk_reviewer_auto`, need to inherit an existing toggle rather than mint a new one per call site).
25. Given the existing `artifact_gate` has no way to express "stale relative to the content it graded"
    (feasibility table row 7), this work either (a) closes that gap as part of shipping Groups 1-2 (a
    new trigger IS the closing of that gap, if it fires reliably on every write path), or (b) states
    explicitly, with the specific write paths named, which ones remain capable of producing a stale
    approvable gate after this ships. Silence on this is not acceptable — a partial fix that still
    leaves `artifactContent` or `artifactAiEdit` unguarded must say so plainly rather than imply the
    staleness problem is solved.

---

## RECOMMENDATION

**Reject (c) as proposed — a GET must not drive an LLM call.** Confirmed live: `QcRail.jsx:63` and
`AssetGateDrawer.jsx` both fetch `checks-result` in a plain `useEffect` on every mount, i.e. every time
a QC drawer opens. Wiring a top-up into that handler means opening a drawer can now cost money and
take LLM-call latency, unpredictably, on a route every existing caller (including automated scripts)
currently treats as a cheap read. This is exactly the shape `CLAUDE.md`'s own "STOP for a decision,
never a status update" section warns against, and the brief itself flagged this as worth challenging.
If Groups 1-3 below are built, (c) closes no gap that isn't already closed upstream — the only
artifacts that could still be missing a verdict when a drawer opens are ones nothing has EVER
triggered a build/edit/re-extract/settings-flip on, which is a vanishingly small and always-explicit
case, better served by the visible "Judge remaining requirements" button in AC 17 than an invisible
read-time side effect.

**SUPERSEDED BY REVISION 2 below — build order, final.** REVISION 2 found a more severe, structurally
confirmed gap (`artifactDocument`/`artifactSlides` bypass `evaluateArtifact` entirely) that outranks
everything under it, so the order is now:

1. **The render-path gap (REVISION 2, AC 4b-4d) first.** Not because it caused Trinnex specifically —
   it didn't, provably (Trinnex's own artifacts DO carry hundreds of `check_result` rows) — but because
   it is the most severe kind of gap in this whole document: it skips the FREE, always-on deterministic
   half of checks too, for an artifact the owner is looking at right now, with only a disabled button
   and no explanation as the signal. It is also the cheapest fix of the three: one call, placed inside
   `buildTemplatedArtifact` (the actual shared root of all three callers), removing a now-redundant
   duplicate call in `runPacketBuild` in the same change.
2. **Group 3 (config-staleness: the stamp, AC 9a/9b, THEN the bounded settings-flip backfill, AC
   10-15).** This is what the Trinnex incident specifically needed, and remains real — but per
   REVISION 2's corpus numbers (8 of 200 artifacts EVER checked) it currently bites a small, growing
   population; it will matter more, not less, once (1) above makes checking routine.
3. **Group 1/1b, the four `pkg_json`-edit writer gaps** (`artifactContent`, `artifactAiEdit`,
   `artifactOwnerEdit`, `correctionRevert`) via the one shared `recheckAfterTextWrite`-style helper.
4. **Group 2 (re-extraction)** — real but lowest measured urgency; no live incident points at it, though
   the unattended 5-minute `jdParseTick` timer makes it the one most likely to silently accumulate stale
   artifacts at scale if left undone longest.

**Two trigger points the brief's original (a)/(b)/(c) did not name, both earned by evidence, both now
part of the recommendation:** the render-path gap (this section) and the `chk_coverage_judge` /
`chk_reviewer_auto` OFF→ON transition (REVISION 1). Neither is a variant of (a)/(b)/(c) — one is a
structural bypass of the check call entirely, the other is a state change in the SETTING rather than in
the artifact or the requirements — and both are evidenced from the live database, not proposed from
first principles.

---
---

## REVISION — two coordinator corrections addressed, in order received

Two correction messages arrived after the sections above were written. This section rules on both,
does not silently rewrite what came before (the record stays, corrected in place with a note), and
narrows the whole document to the corrected problem. **Net effect: the "GROUND-TRUTHED FINDING" section
above already reached the same conclusion the coordinator's second message reaches independently — the
settings-flip / config-staleness defect — before either correction arrived.** That is stated plainly,
not to claim credit, but because it means the two independent reads (mine from `check_result`/
`requirement_coverage` timestamps, the coordinator's from `owner_search_prefs.updated_at`) corroborate
each other, which is stronger evidence than either alone.

### Correction 1, re-ruled: six pkg_json writers — the count is wrong, and it changes the priority

**Verified by a fresh grep of every writer, not trusted from the coordinator's list:**
```
grep -rn "update packet set pkg_json\|update artifact set content" api/src/functions/tests/*.ts
```
Six call sites exist, confirmed exactly as named: `ensurePackage` (`appPackets.ts:626`),
`artifactContent` (`appPackets.ts:1491`), `artifactAiEdit` (`appPackets.ts:1549`),
`artifactRemediate`'s per-pass write (`appRemediation.ts:266`), `artifactOwnerEdit`
(`appCorrections.ts:368`), `correctionRevert` (`appCorrections.ts:283`).

**But two of the six ALREADY call `evaluateArtifact` immediately after that write, today:**
- `ensurePackage`'s write is followed, in the SAME route (`runPacketBuild`), by
  `evaluateArtifact(client, art.id, owner)` for every built artifact — `appPackets.ts:1189`. Already
  covered in the original feasibility table.
- `artifactRemediate` (`appRemediation.ts`) calls `evaluateArtifact` TWICE: once before its pass loop
  starts (`appRemediation.ts:185`, to read the baseline coverage state) and once **immediately after
  every single pass's `update packet set pkg_json`** (`appRemediation.ts:266` write, `:272`
  `ev = await evaluateArtifact(client, artifactId, owner)`), with the comment at `:264-265` stating
  exactly why: *"Persist BEFORE evaluating: the engine reads `packet.pkg_json`, so an unpersisted
  package would be judged as though the pass had never run."* This is a fully-wired trigger, not a gap.

So **the real write-trigger gap is 4 of 6 writers, not 6**: `artifactContent`, `artifactAiEdit`,
`artifactOwnerEdit`, `correctionRevert`. Every AC in Group 1 below is re-scoped to these four. (One
more call site was found and ruled out: `appBaseline.ts:371` also calls `renderArtifact`, a SEVENTH
site, but it targets a synthetic `dismissed=true` container opportunity with no posting and no
requirements (`BASELINE_ROLE = 'Standing profile — no posting'`) and never writes `packet.pkg_json` at
all — `judgeableRequirements` would be empty and `runCoverageJudge` self-exits at `!asked.length`
(`appCoverage.ts:89`). Out of scope, named rather than silently dropped.)

**Correction 2 (the coordinator's own "judge on write" framing) is right that the 4 gaps are real, but
WRONG as a fix for the Trinnex incident**, and the coordinator's second message reaches the same
conclusion from the live data independently. Restated for the record: `requirement_coverage.created_at`
for the Trinnex opp shows cover/portfolio/compact_resume's only judged verdicts are from TODAY's manual
run; their TEXT has not changed since 8/29 (`artifact.updated_at`, queried above). A write-trigger fires
on a text change. No text changed. A write-trigger would not have fired and would not have caught this.
**Ranked, per Q4 below: config-staleness is the primary, higher-severity defect (silent, unbounded
duration, whole-artifact); the 4 write-gaps are real but secondary (self-limiting to one edited field,
degrades gracefully to the pre-judge lexical answer rather than to nothing).**

### Correction 2's five questions, ruled on

**Q1 — should a settings change invalidate/re-run, or should runs be STAMPED with the config they used?**

**Recommend BOTH, but they are not peers — the stamp is the foundation and is needed regardless of
whether auto-backfill ships.** Reasoning:
- The stamp is cheap, always-correct, and is what makes the OTHER open staleness case in this document
  (feasibility table row 7 — an artifact edited after its last check, independent of any judge setting)
  visible too. Auto-backfill only ever answers "was this run stale AT THE MOMENT one specific toggle
  flipped"; a stamp answers "is this run current" continuously, for every cause.
- Add columns to `artifact_gate` (and/or `check_result`, since `artifact_gate` is upserted/overwritten
  per artifact while `check_result` accumulates history) recording the SPECIFIC coverage-relevant
  config the run used: at minimum `coverage_judge_on boolean`, `reviewer_auto_on boolean`, and the
  compile-time `JUDGE_VERSION`/`PROMPT_VERSION` pair already defined in `coverageJudge.ts:38,49`. This
  is additive DDL (`add column if not exists`), matching every other `chk_*`/`artifact_gate` migration
  in this codebase.
- Auto-backfill (queued, bounded — see Q1's burst quantification) is the ACTIVE remediation for the ONE
  transition that is owner-initiated and therefore an intentional spend: `chk_coverage_judge` /
  `chk_reviewer_auto` flipping off→on. It should NOT be extended to a `PROMPT_VERSION`/`JUDGE_VERSION`
  bump at deploy time — that is a much bigger, cross-owner blast radius and needs its own sign-off,
  exactly as AC 13 in the original Group 3 already states. The stamp is what lets the UI show
  "evaluated under an older prompt version" for THAT case without spending anything automatically.

**Quantified from the live schema, not assumed:**
```sql
select count(*) filter (where pkg_json is not null) built, count(*) total
from packet p join opportunity o on o.id=p.opp_id where not o.is_demo;
-- built: 4, total: 38

select count(distinct a.id) artifacts, count(distinct a.id) filter (where g.artifact_id is not null) gated
from opportunity o join packet p on p.opp_id=o.id join artifact a on a.packet_id=p.id
left join artifact_gate g on g.artifact_id=a.id where not o.is_demo;
-- artifacts: 190, gated: 8
```
**Today's real burst, for the one production owner, is tiny: 4 built packets, at most ~12 judgeable
artifacts, at `coverageJudgeMaxCalls=12` each — a worst case around 150 model calls, one time.** That
is not a storm today. It is NOT acceptable to assume it stays that way: the mechanism must still be a
BOUNDED, QUEUED job (extending `appBuildJobs.ts`'s existing `packet_build_job` + Storage Queue + 5-min
timer-sweep-fallback shape — `appBuildJobs.ts:1-40`), never a synchronous loop inside the
`POST /app/search-prefs` response, so that the SAME code is correct whether it touches 12 artifacts or
12,000 as the owner base grows. This extends an existing mechanism rather than inventing a new one, per
this repo's own "extend, don't duplicate" rule.

**Q2 — does `owner_search_prefs` need history for either approach?**

**No, for either approach**, and I want to flag a trap in the coordinator's own evidence before ruling:
`owner_search_prefs.updated_at` is ONE scalar shared by every `chk_*` AND non-`chk_*` column on that
row (`checkPrefs.ts:160`, `appSearchPrefs.ts:73` — both `UPDATE ... updated_at=now()` on ANY write, not
just a coverage-relevant one). Touching `skillMaxChars` bumps the same timestamp `chk_coverage_judge`
would. **Using `updated_at` to infer "the judge setting changed" is itself a fragile proxy for the
thing that actually changed — the same class of error the repo's own "ground-truth before answering"
rule warns against (comparing a derived field instead of the primary fact).** Neither approach needs it:
- The STAMP approach reads the config off the RUN's own row (`artifact_gate`/`check_result`), which
  already gets a fresh `run_id` every time — no separate history table, the run IS the history.
- The AUTO-BACKFILL approach only needs a plain old-value/new-value compare done INSIDE the same
  request that calls `writeCheckPrefs` (read the row before the UPDATE, diff `chk_coverage_judge`/
  `chk_reviewer_auto` specifically against the new patch, act on a true transition) — no persisted
  history needed, because the transition is detected in the same request that causes it.

**Q3 — do the 4 real write-gap writers still need a re-judge trigger, ranked against the config defect?**

**Confirmed from `coverageJudge.ts:253-264` (verdictKey) and `checks.ts:825-831` (`covers`/
`judgeSilent`): yes, real, and yes, secondary.** `verdictKey` hashes the field's exact TEXT
(`text:${input.fieldText}`), so any edit through `artifactContent`, `artifactAiEdit`,
`artifactOwnerEdit`, or a `correctionRevert` produces a NEW key that the cache does not hold. Today,
because none of the four re-triggers `evaluateArtifact`, the artifact's `artifact_gate` simply does not
change at all after the edit — the gate a reader sees was computed against text that no longer exists,
identical in SHAPE to the config-staleness bug (feasibility table row 7 already named this as
"ABSENT — a real, related bug independent of trigger design" before either correction arrived).
**Ranked:** config-staleness is worse — it is silent, artifact-wide, and its duration is unbounded (a
week, in the measured incident) with zero UI signal. A missed write-trigger is smaller and
self-limiting: it affects only the ONE edited field/requirement pairing, and `covers()`'s "strictly
additive" rule (`checks.ts:806-828`, F-7) means the STALE judge verdict — if it said `covered: true` —
still applies (harmlessly optimistic, not dangerous) while the lexical fallback `coversIn` still runs
fresh against the CURRENT text every time regardless (`checks.ts:827`, `covText` is always rebuilt from
live `pkg` — see `checks.ts:526,710` per the header comment in `appCoverage.ts:95`). So a missed
write-trigger degrades an edited field to EXACTLY the pre-judge lexical behavior for that one field,
never to nothing and never to a wrong "no." Real, and Group 1 below still fixes it — just correctly
ranked as the smaller of the two problems.

**One nuance worth flagging while I'm in this code, from the earlier "does revert cost zero calls"
question (message 1, Q3): NOT uniformly true.** `applyCorrectionPass` runs BEFORE the packet's FIRST
`pkg_json` persist (`appPackets.ts:565` precedes the first `update packet set pkg_json` at
`appPackets.ts:626` — confirmed by line order, not assumed from the comment alone). So the
PRE-correction original text, for a SYSTEM correction (source != `'owner_edit'`), was **never itself a
persisted `pkg_json` value and therefore never coverage-judged** — reverting one is a guaranteed CACHE
MISS, real API cost. Reverting an OWNER EDIT (`source='owner_edit'`) is different: `revertOne`
reconstructs an EXACT prior text byte-for-byte by replaying the correction chain, and every prior state
in that chain WAS a live `pkg_json` value at some point — so once `artifactOwnerEdit` itself gets the
Group 1 fix (fires a re-check on write), every state a revert could target becomes something that was
already judged when it was written, making THAT revert case a guaranteed cache hit. Today, with none of
the four writers hooked yet, the claim is moot either way (no cache exists to hit).

**Q4 — regression guard: `runPacketBuild` and the manual `POST /checks` route must keep working.**
Already ACs 1 and 18 below; unchanged by either correction, restated here so it is not lost in the
revision.

### What changed in the ACs below as a result

- Group 1's title and scope now say "4 real gaps," not the build path (already covered, kept as a
  regression guard only — AC 1).
- Group 3 is renamed "config-staleness" and is now explicitly the PRIMARY fix, with AC 10-15 revised to
  require BOTH the stamp (new) and the bounded queued backfill (as originally written), rather than
  backfill alone.
- Group 4 (the QC screen, trigger c) is cut down to the single withdrawal note the owner's decision
  requires — no ACs are written for it, per instruction not to spend ACs there.

---
---

## REVISION 2 — third correction: is there a path to `review` that never checks at all?

Independently re-queried before accepting anything (`boost-pg-mcp-write`, live):

```sql
select count(*) from artifact;                                          -- 200
select count(distinct artifact_id) from check_result;                   -- 8
select count(distinct artifact_id) from artifact_gate;                  -- 8
select count(*) from packet;                                            -- 40
select count(distinct a.packet_id) from artifact a
  join check_result cr on cr.artifact_id = a.id;                        -- 2
select id, created_at, pkg_json is not null as has_pkg from packet
  order by created_at desc limit 5;
-- 487cb017-...  2026-09-01 19:11  has_pkg=false   <- only packet created after the 8/26 build-checks wiring
```
**Corpus counts confirmed independently, exact match to the coordinator's numbers.** 8/200 artifacts
ever checked, 2/40 packets ever checked, one packet created since the build→checks wiring landed and
its `pkg_json` is null. Every AC or claim in this document about "corpus-wide" coverage must be read
against this: **judging has meaningfully run on two packets, ever.**

**The specific inference — that `artifactGenerate` produced packet `487cb017`'s resume/portfolio — is
REFUTED, not confirmed, by the artifact rows themselves:**
```sql
select type, status, length(content) content_len, doc_url, version_history, created_at, updated_at
from artifact where packet_id = '487cb017-2f3f-4f70-a573-0983b780ea75' order by type;
-- resume     review  4347  docs.google.com/document/...     version_history: []   created 09-01 19:11
-- portfolio  review  2954  docs.google.com/presentation/...  version_history: []   created 09-01 19:11
-- cover / compact_resume / video   todo   (no content)                            created 09-02 13:40
```
`artifactGenerate`'s own write (`appPackets.ts:301-306`) is
`version_history = coalesce(version_history,'[]'::jsonb) || jsonb_build_object('len', $2::int)` — an
**unconditional append**. If it had run even once, `version_history` could not be `[]`; it would hold
at least `[{"len": 4347}]`. Both artifacts show `[]`. Also, `artifactGenerate` never writes `doc_url` at
all (confirmed by re-reading `appPackets.ts:272-312` a second time) — both artifacts here HAVE a real
Google Doc/Slides `doc_url`, which only `renderArtifact` (`appPackets.ts:802`) or the legacy
non-templated branches of `artifactDocument`/`artifactSlides` (`appPackets.ts:880,984`) ever write. **The
evidence points AWAY from `artifactGenerate` and TOWARD the templated render path having produced this
content** — which makes the real finding underneath this one worse, not smaller:

**CONFIRMED, from source, not inferred: `POST /artifact/{id}/document` and `POST /artifact/{id}/slides`
each call `buildTemplatedArtifact` directly (`appPackets.ts:843` and `:922`), and `buildTemplatedArtifact`
is a bare composition of `ensurePackage` + `renderArtifact` (`appPackets.ts:811-813`) with NO call to
`evaluateArtifact` anywhere in either route or in `buildTemplatedArtifact` itself** (`grep -n
evaluateArtifact appPackets.ts` → only line 19 (import) and line 1189, which is inside `runPacketBuild`,
a DIFFERENT function neither of these two routes calls). **This is a real, structurally-confirmed ninth
gap, distinct from and in addition to the four `pkg_json`-edit writers in Group 1**: a single artifact
can be built — real Drive document, `status: 'review'`, real content — via its own
"create the document" / "create the deck" button, completely outside `packet/build-all`, and
`evaluateArtifact` is never called on that code path at all. It does not require `chk_coverage_judge` to
be on to matter — it means the DETERMINISTIC checks and the gate itself never run for an artifact built
this way, which is the whole of "trigger (a)" restated at a level below where model settings even enter.

**What I could NOT fully reconstruct, stated as an open residual rather than guessed:** if
`ensurePackage` truly ran for this packet (which `buildTemplatedArtifact`'s composition requires before
`renderArtifact` can produce a `doc_url`), it unconditionally persists `packet.pkg_json` at
`appPackets.ts:626` before returning — no code path in this repo sets `pkg_json` back to `null`
(`grep -rn "pkg_json = null\|pkg_json=null" *.ts` → zero hits). Why this specific packet's `pkg_json` now
reads `null` despite two artifacts showing every sign of having gone through that function is not fully
explained by static reading alone. It does not change the structural finding above (`artifactDocument`/
`artifactSlides` bypass `evaluateArtifact` in every case, provably, regardless of this one packet's
history) — it is flagged so it is not silently smoothed over.

**Answering the coordinator's Q1 directly — is `review` with no gate a dead end or silently
approvable?** Checked both halves, server and client:
- Server: `approvalBlock` only gates the `status === 'approved'` transition (`appPackets.ts:329`); moving
  to `review` itself is never blocked, by design (it is not the terminal state). But reaching `approved`
  from `review` with a null gate DOES hit `approvalBlock`'s first branch — `"no checks have been run for
  this artifact"` (`appChecks.ts:341`) — a 409, not a silent pass.
- Client: `assetGate.js` treats `gate === null` as `{kind:'unchecked', label:'Approve', disabled:true,
  headline:'Not checked', reason:'no checks have been run for this artifact - run them before
  approving'}` (`assetGate.js:379-386`), and its own header comment states the design intent directly:
  *"null is its own state: an artifact with no gate row has never been checked, and that is [not the
  same as clean]"* (`assetGate.js:70`).

**So: not silently approvable — both halves agree and say the same thing (the client comment even notes
it deliberately mirrors the server's wording).** It IS a dead end in a different, real sense: the owner
sees "Not checked", the button is disabled, and nothing on that screen tells them WHY it was never
checked or prompts them to fix it — they have to already know to press "Run checks" (the existing manual
`POST /checks` route). That is a workflow-completeness gap, not a safety hole, and it is fixed by closing
the two render-path gap (see AC 4b below), not by touching `approvalBlock`.

### Re-ranked, per the coordinator's request, and stated as a ranking of SEVERITY not just recency

1. **HIGHEST: the two render-path gaps** (`artifactDocument`, `artifactSlides` bypass `evaluateArtifact`
   entirely) — new Group 1c below, AC 4b-4c. This is the most severe because it means the very
   DETERMINISTIC half of checks — free, no model, always-on today for `runPacketBuild` — can be skipped
   completely for an artifact a owner is looking at right now, with only a UI hint (disabled Approve
   button, no explanation) as the safety net. Confirmed structurally, not inferred.
2. **Config-staleness (REVISION 1)** — real, PRIMARY among what's left, but per this section's own
   corpus numbers it only bites artifacts that were ever judged at all: 8 of 200. Once (1) above ships
   and artifacts actually accumulate check history at the rate the product needs, config-staleness
   becomes the dominant failure mode over time — it is not smaller in KIND, only currently smaller in
   COUNT because so little has been checked at all yet.
3. **The four `pkg_json`-edit writer gaps** (Group 1, `artifactContent`/`artifactAiEdit`/
   `artifactOwnerEdit`/`correctionRevert`) — real, lesser, unchanged from REVISION 1's ranking.
4. **`runPacketBuild` itself ("trigger (a) already built")** — downgraded from "regression guard only"
   to **"regression guard AND proof-of-life required."** The code has existed since commit `4a0b961`
   (2026-08-26) but only ONE packet has been created since, and even that one shows no `check_result`
   rows — meaning `runPacketBuild`'s `evaluateArtifact` call has **no confirmed production execution
   at all**, only the code's own presence. AC 1 below is revised to require an actual live proof (a
   real `POST /packet/build-all` run, its `check_result` rows read back), not merely "the code exists
   and reads correctly."

### New ACs

4b. Given `POST /artifact/{id}/document` (a metadata-having, templated type) builds a document via
    `buildTemplatedArtifact`, then it triggers the SAME recheck mechanism Group 1b defines
    (`recheckAfterTextWrite` or equivalent), either by having `buildTemplatedArtifact` itself call it
    (extending the ONE shared function from Group 1b, since this is structurally the same "text was
    written" event as the four pkg_json editors) or by `artifactDocument` calling it after
    `buildTemplatedArtifact` returns — ruled: **inside `buildTemplatedArtifact`, not at each of its
    three callers (`runPacketBuild`'s loop, `artifactDocument`, `artifactSlides`)**, because that is the
    actual shared root (`ensurePackage` + `renderArtifact` composition) all three funnel through, and
    `runPacketBuild`'s own separate `evaluateArtifact` call (line 1189) is then redundant and should be
    removed in the same change rather than left to fire twice.
4c. Given the same for `POST /artifact/{id}/slides`.
4d. Given 4b/4c change where the check fires from, when `runPacketBuild`'s now-redundant per-artifact
    `evaluateArtifact` call is removed, then AC 1's regression guard is updated to assert the check fires
    from inside `buildTemplatedArtifact` (once), not twice, and a test proves a build still produces
    exactly one `check_result` run per artifact, not zero and not two.
1. *(revised)* Given `chk_coverage_judge` is ON for an owner, when `POST /packet/build-all` completes
   building all 4 templated artifacts of a packet, then every artifact's `artifact_gate` row is current
   as of that build — verified against a REAL run's output, not code inspection alone: trigger the
   route (or its async twin) against a real or fixture opportunity, then read `check_result`/
   `artifact_gate` back for the artifacts it built and confirm rows exist with `computed_at` after the
   build started. The corpus shows zero confirmed production executions of this path since it was
   written (one packet created since, zero `check_result` rows for it) — this AC is not satisfied by
   "the code is present and the source reads correctly."

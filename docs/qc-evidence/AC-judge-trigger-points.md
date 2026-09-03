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

### Group 1 — build / regenerate (trigger a, scoped to the real gap)

1. Given `chk_coverage_judge` is ON for an owner, when `POST /packet/build-all` completes building
   all 4 templated artifacts of a packet, then every artifact's `artifact_gate` row is current as of
   that build (already true today — this AC is a **regression guard**, not new behavior. It must be
   asserted so a future refactor of `runPacketBuild` cannot silently drop the existing
   `evaluateArtifact` call without a test catching it).
2. Given `chk_coverage_judge` is ON, when an owner edits a resume field through the QC rail
   (`POST /artifact/{id}/content` with a `pkg` body), then the SAME artifact's `check_result` /
   `artifact_gate` / `requirement_coverage` rows are recomputed against the NEW `pkg_json` before the
   response returns success, OR the response explicitly reports that checks are now stale (a
   `checksStale: true` field, or equivalent) so the client can show it rather than silently keep
   showing the old gate.
3. Given the same for `POST /artifact/{id}/ai-edit`.
4. Given `chk_coverage_judge` is OFF, when either edit path fires, then no model call is made and no
   `requirement_coverage` row is written (the existing self-gate inside `runCoverageJudge` continues
   to apply unchanged — this AC exists to prove the new call site inherits the gate rather than
   bypassing it).
5. Given `artifactGenerate` is confirmed (per the feasibility table's open question) to still serve a
   `runChecks`-scored artifact type, then it gets the same treatment as (2)/(3). Given it is confirmed
   to serve only unscored types (video, etc.), then this AC is explicitly marked not-applicable with
   the confirming evidence, not silently dropped.

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

### Group 3 — settings-flip backfill (the trigger the incident actually needed — new, not in the brief's 3)

10. Given an owner's `chk_coverage_judge` value transitions from `false` to `true` via
    `POST /app/search-prefs`, when that write completes, then every already-built, already-gated
    artifact belonging to that owner is queued for re-evaluation (async — see AC 14 for why this must
    not be synchronous), and the response says so (a count of artifacts queued, not silence).
11. Given the same transition for `chk_reviewer_auto` (off→on), then the same backfill behavior
    applies, extending the SAME mechanism rather than a second one built just for the coverage judge.
12. Given `chk_coverage_judge` transitions `true → false`, then NOTHING is queued (turning a judge off
    must never spend money re-running it) — this must be a separate, explicit branch, not the absence
    of the true-branch relying on an implicit default.
13. Given `PROMPT_VERSION` or `JUDGE_VERSION` in `coverageJudge.ts` is bumped in a deploy (the
    "consolidation sweep" the code comments anticipate), then this AC package does NOT require a new
    automatic global re-judge sweep across every owner's every artifact on deploy — that is a
    deliberately separate, much bigger blast radius than a single owner's toggle, and must get its own
    explicit sign-off before being automated (see AC-STORM below). State this as a boundary, not an
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

### Group 4 — the QC screen (trigger c) — REJECTED as proposed; ACs are for the fallback instead

16. Given `artifactChecksGet` (`GET /checks-result`) is called (as it is, on every QC-rail/drawer
    mount today), then it remains a PURE READ: no model call, no write, identical latency and cost
    profile to today, in every case — because groups 1-3 above already re-trigger judging at every
    point the data actually changes (edit, re-extract, settings flip), there is no remaining gap a
    read-time top-up would close that isn't already closed upstream, and turning a GET into a
    sometimes-expensive, sometimes-slow call breaks the "STOP only for a decision, not a status
    update" and "no dead UI ceremony on a read" expectations this repo already holds itself to.
17. If, despite (16), the owner still wants a manual top-up-only affordance (e.g. because some
    artifacts predate this whole feature and Groups 1-3 only cover FUTURE changes), then it must be an
    EXPLICIT, VISIBLE action — a button ("Judge remaining requirements") that calls the EXISTING
    `POST /artifact/{id}/checks` route (already built, already does exactly this) — never an implicit
    side effect of opening a drawer.

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

**Build, in this order of measured value:**

1. **Group 3 (settings-flip backfill) first.** This is the one the live data shows the incident
   actually needed — Trinnex's cover/portfolio/compact_resume sat unjudged not because build doesn't
   call the judge (it does, and has since 8/22) but because nothing re-ran them after
   `chk_coverage_judge` was turned on. It is also the smallest, most contained change: one new branch
   in `appSearchPrefs.ts`'s existing write path, extending the existing `jdParseTick`/`buildQueueSweep`
   background-job shape rather than inventing one.
2. **Group 1, scoped to `artifactContent` and `artifactAiEdit` only** — NOT the full build path, which
   is already done. This is the biggest *editing-surface* gap (every QC-rail hand-edit and every
   AI-edit currently leaves stale checks) and it directly closes feasibility table row 7's staleness
   hole, which is a correctness bug independent of judge triggers.
3. **Group 2 (re-extraction)** — real but lower measured urgency than 1-2 above; no live incident
   points at it the way Trinnex points at Group 3, though the unattended 5-minute timer
   (`jdParseTick`) makes it the trigger most likely to silently accumulate stale artifacts at scale
   over time if left undone.

**A fourth trigger point the brief did not name, and should be added to its own list:** the
`chk_coverage_judge` / `chk_reviewer_auto` OFF→ON transition. It is not a variant of (a)/(b)/(c) — it
is a state change in the SETTING, not in the artifact or the requirements — and the live evidence in
this document shows it is the one that actually fired in the incident being fixed.

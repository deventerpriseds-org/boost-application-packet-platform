# IMPL: Re-extraction trigger (Lane B)

Branch: claude/boost-app-setup-approach-6xdoef
Scope: AC-judge-trigger-points.md build-order item 4 (Group 2: re-extraction)
Owned files: api/src/functions/tests/appJdParse.ts, api/src/functions/tests/appRequirements.ts

## Log

- Starting. Reading AC-judge-trigger-points.md, appJdParse.ts, appRequirements.ts, appChecks.ts,
  appRecheck.ts, coverageJudge.ts (read-only for the latter three).

## Design decisions (after reading AC-judge-trigger-points.md, appJdParse.ts, appRequirements.ts,
   appChecks.ts, appRecheck.ts, coverageJudge.ts, appCoverage.ts — all read, only appJdParse.ts and
   appRequirements.ts edited)

**Zero-cost re-judge claim: CONFIRMED, not just partly.**
- `coverageJudge.ts:253-264` — `verdictKey({requirement, field, fieldText, model})` hashes
  `judge:JUDGE_VERSION`, `prompt:PROMPT_VERSION`, `model`, `field`, `req:<requirement text>`,
  `text:<field text>` — i.e. the cache key is keyed on the REQUIREMENT'S OWN TEXT (`reqText(r) =
  r.verbatim || r.item_text`, appCoverage.ts:77), not on the requirement row's id/seq. So identical
  requirement text after a re-extraction produces the identical key.
- `appCoverage.ts:99-142` (`runCoverageJudge`) reads the cache FIRST (readCached, appCoverage.ts:127,
  keyed `where opp_id=$1 and verdict_key = any($2)`), and at line 142:
  `if (!missing.length) { perField.push(...); continue }` — a FULL cache hit for a field skips BOTH
  the model call (`input.fetchJson`, line 155, only reached inside the branch AFTER this continue)
  AND the write (`writeVerdicts`, line 175, same). So a 100%-cached field costs zero model calls and
  performs zero inserts.
- `appCoverage.ts:236-239` — the insert that DOES happen for a real miss is
  `on conflict (opp_id, verdict_key) do nothing`, so even if two triggers raced on the same miss,
  only one write lands.
- The one imprecision the AC doc itself already flagged is real too: `readCached` still issues one
  DB `select` per field per artifact evaluation even on a 100% hit (appCoverage.ts:205-209) — "zero
  cost" means zero MODEL calls and zero new rows, not zero DB round trips. I did not change this;
  it's inherent to the mechanism I'm invoking, not something my trigger adds on top.

**Requirement writers, verified against a fresh grep, not trusted from the brief:**
`grep -n "writeRequirements(\|clearRequirements(" appRequirements.ts` → 3 call sites, not 2:
  - appJdParse.ts:90 (structureRequirements, called from jdParse/jdBackfill/jdParseTick — the brief's
    "ALL THREE parse paths" comment at appJdParse.ts:81-84)
  - appJdParse.ts:76 (applyAnchorTruth → clearRequirements, called when no groundable JD source)
  - appRequirements.ts:1033 (requirementsBackfill, POST /qc/requirements/backfill) — a THIRD writer
    the brief did not mention, inside appRequirements.ts itself.

**Decision: wired the recheck into the first two (both in appJdParse.ts, my scope), NOT into
requirementsBackfill.** requirementsBackfill's own comment (appRequirements.ts:1048-1053, unchanged
by me) states its design intent explicitly: "This route loops up to 50 opportunities in one
dispatch... inheriting escalation would make thousands of model calls from a single unattended
sweep. The backfill exists to re-resolve the deterministic spine cheaply, and that is all it does."
Wiring a recheck that CAN call the coverage judge (gated only by the owner's `chk_coverage_judge`,
same as everywhere else) into a route explicitly designed to make zero model calls across up to 50
opps at once would produce exactly the failure mode that comment is warning against — worst case
50 opps x 5 artifacts x 12-call cap = 3000 calls from one unattended dispatch, six times worse than
jdParseTick's already-flagged 10-opp bound. Left untouched, deliberately, stated here per the
"self-attack before verifier" step (who else calls what I'm changing).

**Mechanism: reused appRecheck.ts's `recheckAfterTextWrite` (already built by another lane for
Group 1 — the write-gap triggers), not a new evaluator wrapper.** Confirmed safe to import
STATICALLY from appRequirements.ts: appRecheck.ts resolves `evaluateArtifact` via a DYNAMIC import
inside the function body (its own header explains why — avoiding a cycle with appCorrections.ts),
so it carries no static edge back to appChecks.ts, which already imports appRequirements.ts
(appChecks.ts:17). No new cycle introduced.

**New function `recheckArtifactsAfterRequirementsChange(client, oppId, opts?)` in
appRequirements.ts:**
- Lists artifact ids via `artifact a join packet p on p.id=a.packet_id where p.opp_id=$1 and
  p.pkg_json is not null order by a.type limit $2` — "already built" = `pkg_json is not null`, the
  SAME predicate the AC doc's own feasibility table uses to count "built" packets. A fresh opp's
  placeholder `todo` artifact rows (created by `loadPacket`, appPackets.ts:81-90, the moment the
  packet screen is opened — READ ONLY, not edited) exist with `pkg_json` still null; they are never
  matched by this query. This answers AC 7 (fresh opp, no built artifacts -> no evaluation
  attempted) structurally, not by a special-case branch.
- BOUNDED at the query itself (`limit $2`, default 5) rather than by breaking a loop after fetching
  more — see the "settings column needed" note below.
- NEVER THROWS: the listing query is wrapped in try/catch (empty summary on failure); each
  per-artifact call goes through `recheckAfterTextWrite`, which already never throws.
- Callers (`structureRequirements`, `applyAnchorTruth`) only invoke it when the writer's own
  `changed` flag (see below) is true, so AC 9 (byte-identical re-extraction) never runs even the
  listing query, let alone evaluates an artifact.

**`writeRequirements` and `clearRequirements` now return `{ changed: boolean }`.** Detected by
reading `opportunity.jd_posting_snapshot_sha256` BEFORE the write and comparing to the value the
write is about to set (writeRequirements) or comparing to null (clearRequirements, changed iff a
real spine existed to lose). This is the SAME staleness signal `rebuildComparison`
(appRequirements.ts, ~line 738) and `requirementsGet` (~line 875) already read for a different
purpose (grading against a stale excerpt) — extended here, not re-derived, per "extend, don't
duplicate". `buildRequirements` is a deterministic function of posting text, so an unchanged
snapshot hash means an unchanged requirement set. Both functions had exactly one caller each
(grepped, appJdParse.ts:76 and :90 respectively) so widening their return type is a safe additive
change with no other call site to update — except requirementsBackfill's `results.push(await
writeRequirements(...))` at appRequirements.ts:1033, which now carries an extra unused `changed`
field per result; harmless (nothing reads that array positionally by field count).

**Settings column needed from Lane A (per CLAUDE.md "No hardcoded config") — NOT added, `checkPrefs.ts`
is not mine:**
  Table: `owner_search_prefs`
  Column: `srch_reextract_recheck_max_artifacts int not null default 5`
  Meaning: max artifacts rechecked per single requirements-change event (both the structureRequirements
    and applyAnchorTruth paths, and therefore also whatever jdParseTick drives). Read via
    `loadThresholds`-equivalent (or a small dedicated read) and passed as `opts.maxArtifacts` to
    `recheckArtifactsAfterRequirementsChange`. Until this exists, the code uses a literal default of 5
    (`DEFAULT_REEXTRACT_RECHECK_MAX_ARTIFACTS` in appRequirements.ts) — which today is not actually a
    real limiter, since a packet has at most 5 artifact TYPES (ARTIFACT_TYPES.length in appPackets.ts),
    so this constant currently only prevents the count from exceeding what already cannot be exceeded.
    It becomes a real bound only once the settings column exists and an owner can lower it, or once
    packets can hold more than 5 artifacts. Where the owner would change it: same Settings screen
    `chk_coverage_judge`/`chk_reviewer_auto` live on today (the QC/checks preferences panel), once
    Lane A wires a read/write for it.
  I did NOT add a toggle to disable the trigger entirely (a `chk_reextract_recheck` boolean). Reasoning
    (mirrors AC 24's own stated logic for the write-gap triggers): the deterministic half of
    evaluateArtifact is free and already always-on for `build`/the four write-gap triggers with no
    per-trigger switch; the only part with real recurring cost (the coverage judge) already inherits
    `chk_coverage_judge` unconditionally through `runCoverageJudge`'s own self-gate — no new toggle is
    needed for THAT half. If the owner wants a kill switch for the deterministic-check overhead
    specifically, that is a product decision beyond this lane's ranked-lowest scope; flagging it rather
    than deciding it.

## Build + test results

`npm run build` — PASS (clean, after a transient failure on the FIRST attempt caused by another
lane's concurrent mid-edit to schema.ts — a backtick inside a comment inside the `SCHEMA_SQL`
template literal broke the parse for one instant; retrying moments later succeeded, confirming it
was transient and not caused by my diff, which never touches schema.ts).

`node --test test/hardening.test.mjs`:
  163 tests, 162 pass, 1 fail (`H:every-chk-column-is-selected`) — pre-existing, unrelated to this
  lane (checkPrefs.ts `chk_backfill_batch_size`/`chk_backfill_max_per_flip`, Lane A's concurrent
  Group-3/backfill work). Baseline was 159; my 4 new H-cases account for the whole +4.

`node --test test/*.test.mjs`:
  1090 tests, 1086 pass, 4 fail — baseline was 1082, so +8 from other lanes appending concurrently
  (my 4 hardening tests are inside that count). The 4 failures, none touching appJdParse.ts or
  appRequirements.ts:
    - H:settings-flip-queues-recheck (Group 3 settings-flip backfill — another lane's work)
    - H:backfill-is-bounded (same area)
    - H:every-chk-column-is-selected (checkPrefs.ts, Lane A)
    - M34: every knob the matcher introduces has a chk_ column and a ResolveOptions path (matcher/
      checkPrefs, unrelated)
  `test/requirements.test.mjs` alone: 27/27 pass.

## Mutation-proving — mutate.sh REFUSED as documented (dirty files), anchors below for you to run
   after committing

Ran it once to confirm the actual refusal text (not assumed):
```
$ bash /workspace/eds-claude-skills/scripts/mutate.sh src/functions/tests/appJdParse.ts \
    <anchor> <repl> "npm run build && node --test test/hardening.test.mjs" H:reextraction-rechecks
NOT-APPLIED: src/functions/tests/appJdParse.ts has uncommitted changes.
             Commit or stash first -- otherwise a failed restore looks like your own edit.
```
Exit 3, confirmed — matches the brief's prediction exactly. Every mutation below therefore reports
outcome **NOT-APPLIED (dirty file, by design)** from me; run each with the real tool after
committing. Test command for all four: `cd api && npm run build && node --test test/hardening.test.mjs`.

### Mutation 1 — must fail H:reextraction-rechecks
File: `api/src/functions/tests/appJdParse.ts`
Anchor (exact):
```
      if (result.changed) {
        const summary = await recheckArtifactsAfterRequirementsChange(client, oppId)
```
Replacement:
```
      if (false && result.changed) {
        const summary = await recheckArtifactsAfterRequirementsChange(client, oppId)
```
Expected: the structural assertion `assert.match(structure, /result\.changed/)` still passes (the
text is still there), but the STRUCTURAL assertion checking `recheckArtifactsAfterRequirementsChange\(`
also still matches (same reason) — so this specific mutation only proves the BEHAVIORAL half weakly.
A stronger anchor for a real regression test of "the gate was removed" is mutation 1b below.

### Mutation 1b — must fail H:reextraction-rechecks (stronger — removes the call entirely)
File: `api/src/functions/tests/appJdParse.ts`
Anchor (exact):
```
      if (result.changed) {
        const summary = await recheckArtifactsAfterRequirementsChange(client, oppId)
        if (summary.attempted) {
```
Replacement:
```
      if (result.changed) {
        // MUTATED: recheck call removed
        if (false) {
```
Expected: FIRED — `assert.match(structure, /recheckArtifactsAfterRequirementsChange\(/)` fails
because the only remaining occurrence in the function body is gone (note: the OTHER occurrence, in
applyAnchorTruth, is a different function body sliced independently by `anyAsyncFunctionBody`, so it
does not accidentally save this assertion).

### Mutation 2 — must fail H:reextract-idempotent-noop
File: `api/src/functions/tests/appRequirements.ts`
Anchor (exact):
```
    changed: priorHash !== newHash,
```
Replacement:
```
    changed: true, // MUTATED: always report changed, defeating the idempotence gate
```
Expected: FIRED — the `same.changed === false` assertion in the test fails immediately (it becomes
`true`), and the `H:reextraction-rechecks` behavioral test is unaffected (it never asserts on
`changed`'s value, only that a `changed: true` gate resulted in evaluation), so only the intended
test should fail.

### Mutation 3 — must fail H:reextract-recheck-bounded
File: `api/src/functions/tests/appRequirements.ts`
Anchor (exact):
```
    ids = (rows || []).map((r: any) => r.id).slice(0, max)
```
Replacement:
```
    ids = (rows || []).map((r: any) => r.id) // MUTATED: cap removed
```
Expected: FIRED — the fake 500-row driver in the test now produces 500 evaluator calls instead of
<=5, failing `assert.ok(calls <= 5, ...)`.

### Mutation 4 — must fail H:reextract-recheck-non-fatal
File: `api/src/functions/tests/appRequirements.ts`
Anchor (exact):
```
  let ids: string[] = []
  try {
    const { rows } = await client.query(
      `select a.id from artifact a join packet p on p.id = a.packet_id
        where p.opp_id = $1 and p.pkg_json is not null
        order by a.type limit $2`,
      [oppId, max],
    )
    ids = (rows || []).map((r: any) => r.id).slice(0, max)
  } catch {
    // The listing query itself failed. A re-parse must still succeed — return the empty summary
    // rather than throw, exactly the posture `recheckAfterTextWrite` already holds per-artifact.
    return { attempted: 0, ok: 0, failed: 0 }
  }
```
Replacement:
```
  let ids: string[] = []
  const { rows } = await client.query(
    `select a.id from artifact a join packet p on p.id = a.packet_id
      where p.opp_id = $1 and p.pkg_json is not null
      order by a.type limit $2`,
    [oppId, max],
  )
  ids = (rows || []).map((r: any) => r.id).slice(0, max)
```
Expected: FIRED — the test's `throwingClient` (its `.query()` always throws) now propagates the
throw out of `recheckArtifactsAfterRequirementsChange` instead of returning `{attempted:0,ok:0,
failed:0}`, so `await recheckArtifactsAfterRequirementsChange(throwingClient, ...)` rejects and the
test fails (either as an unhandled rejection or an assertion never reached, both surfaced by
`node --test` as a failure of this test).

## Anything I could NOT do

- Could not run the real `mutate.sh` end to end (dirty files, by design — see above). Anchors given
  so you can run all four after committing; I am confident in the FIRED prediction for 1b/2/3/4
  because I traced each one against the actual test assertions above, but "confident" is not
  "confirmed" — only the real tool run gives that.
- Did not add the `srch_reextract_recheck_max_artifacts` settings column myself (not my file); see
  the exact spec above for Lane A.
- Did not wire the recheck into `requirementsBackfill` (appRequirements.ts, a third writer this
  lane's brief did not mention) — deliberate, reasoned above (that route's own comment states it is
  designed to make zero model calls across up to 50 opps at once; wiring in a coverage-judge-capable
  recheck would defeat that stated design intent). Flagging for the owner/coordinator rather than
  deciding it silently.

## Final re-run (concurrent lanes still landing work — counts moved between runs, as expected)

Re-ran build + full suite once more just before finishing:
- `npm run build`: PASS.
- `node --test test/hardening.test.mjs`: 163 tests, 162 pass, 1 fail (still
  `H:every-chk-column-is-selected` — checkPrefs.ts, not mine).
- `node --test test/*.test.mjs`: 1090 tests. Failure count and IDENTITY moved between consecutive
  runs in this same session (5 -> 4 -> 3 failing, different test names each time:
  `H:settings-flip-queues-recheck`, `H:backfill-is-bounded`, `M34`, `H:ship-path-is-reachable`,
  `H:ready-counts-an-overridden-fail-only-in-advisory-mode` have each appeared and disappeared across
  runs) — consistent with other lanes actively committing/editing shared files (checkPrefs.ts,
  appPackets.ts, judgeOutcome-adjacent code) between my test invocations, not with anything
  nondeterministic in my own code. None of the moving failures ever named `appJdParse.ts`,
  `appRequirements.ts`, `structureRequirements`, `applyAnchorTruth`, `recheckArtifactsAfter
  RequirementsChange`, or any `H:reextract*` case — my 4 new tests passed in every run.
  `test/requirements.test.mjs` alone: 27/27, stable across every run.

STATUS: implementation complete for this lane's scope (AC-judge-trigger-points.md Group 2, ACs 6-9).
Owned files only (appJdParse.ts, appRequirements.ts) edited. hardening.test.mjs append-only, 4 new
H-cases added at the end. No other files touched. Settings-column need routed above for Lane A.

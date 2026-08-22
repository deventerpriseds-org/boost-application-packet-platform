# Acceptance Criteria — Build-Path Evidence, D31, D33

**Scope:** three linked defects measured on run **32547019724** (build of opportunity
`2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`, HTTP 200, 35 warnings).
**Constraint:** this agent writes NO code under `api/src` or `app/src`. Deliverable is this file.
**Status legend:** `[BRIEF]` = written from the brief before reading code; `[READ]` = grounded in a
file/line I have read; `[MEASURED]` = grounded in a live run/query result I have seen.

> Working notes are appended incrementally. Everything below the first block was written
> after reading the named source; anything still marked `[BRIEF]` is UNVERIFIED.

---

## P1 — build-path evidence call never executed (D:build-runs-no-qc)

### AC-1 `[BRIEF]` The current build path is proven broken before any fix is judged
Given the deployed `packetBuildAll` in `api/src/functions/tests/appPackets.ts` calling
`POST /app/opportunity/{id}/evidence` through `selfPost`,
when a build is run end-to-end (api-test.yml → `/api/app/opportunity/<id>/packet/build-all`),
then the response warnings array contains
`"evidence resolve did not run: sign in required to modify this workspace"`,
and `evidence`/`requirement_comparison` rows for that packet have `updated_at` unchanged.
Settles it: run log for 32547019724 + `db-query.yml` on the evidence table.
**A fix is only accepted if this exact string disappears AND rows change.** The absence of the
warning alone is not_applicable-grade evidence, not a pass.

### AC-2 `[BRIEF]` The ledger row `D:build-runs-no-qc` is re-opened, not silently re-closed
Given the row was closed on an `api-test` dispatch that called `/evidence` **directly with auth**,
when the ledger/actions entry is inspected,
then it must record that the closing evidence tested a DIFFERENT code path than the row's claim,
and the row is reopened until AC-1's evidence comes from a **build-all** invocation.
Settles it: `.claude/actions.md` + the H-case rule "absent evidence is not_applicable, never pass".

### AC-3 `[BRIEF]` In-process refactor does not create an import cycle
Given the proposed change makes `appPackets.ts` import `writeEvidence`/`rebuildComparison` from
`appRequirements.ts`,
when the module graph is walked (`appRequirements` → … → `appPackets`?),
then either no cycle exists, or the shared functions are extracted to a third module.
Settles it: grep of `import` statements in both files + `npm run build` in `api/`.

### AC-4 `[BRIEF]` In-process call does not silently drop an authorization check that SHOULD apply
Given `evidenceResolve` gates on `requireWrite`,
when `packetBuildAll` instead calls the writer directly,
then the build-all entrypoint itself must already enforce an equivalent write gate for the same
owner, proven by reading `packetBuildAll`'s own preamble — not assumed.
Settles it: `appPackets.ts` `packetBuildAll` first ~40 lines; `appSession.ts` `requireWrite`.

### AC-5 `[BRIEF]` Owner on the in-process path cannot be spoofed via `?owner=`
Given `resolveOwner(req)` accepts an unverified `?owner=` for READS,
when build-all writes evidence for the owner it resolved,
then the owner used for the WRITE must come from a verified session, not from the query string.
Settles it: `resolveOwner` in `appSession.ts` + the owner variable actually passed in `packetBuildAll`.

### AC-6 `[BRIEF]` The other two `selfPost` callers are checked for the identical latent bug
Given `selfPost` sends no Authorization header,
when every `selfPost(` call site is enumerated,
then each target route is classified as `requireWrite`-gated (broken) or not (fine),
and every broken one is listed. Settles it: `grep -rn "selfPost(" api/src`.

---

## P2 — D31 portfolio Call-2 JSON parse failure is systematic, not intermittent

### AC-7 `[BRIEF]` The failure is restated as deterministic-on-this-posting
Given the measured result — 4/4 artifacts failed with "no parseable JSON object in
2915 / 3647 / 5813 / 3282 chars",
when D31 is re-read,
then its wording "on some postings" is corrected, because a 4/4 failure inside one build is not
intermittency. Settles it: run 32547019724 log.

### AC-8 `[BRIEF]` The silent fallback to Call 1 is made loud
Given Call 2 failing currently falls back to Call 1 content with no error,
when Call 2 yields no parseable JSON,
then the build must emit a warning naming artifact + char count + first 200 chars of the reply,
and the artifact must be marked degraded — never presented as portfolio-specific content.
Settles it: the fallback branch in the call-2 parser (file TBD).

---

## P3 — D33 discarded sections (35 warnings)

### AC-9 `[BRIEF]` Each discarded heading is classified LOSS vs NOISE, per artifact
Given sections `Job Description Summary`, `Missing ATS Skills`, `Missing ATS Swap Suggestions`,
`Skills1`, `Skills2`, `Relevant Skills bullet list 1/2/3`, `Jobscan Extraction`,
`Word and Character Requirements Check` are generated then discarded,
when each is checked against the merge fields present in the target template for that artifact,
then it is labelled **LOSS** (a merge field exists but matching failed) or **NOISE** (no merge field
exists in that template, so discarding is correct and the warning should be downgraded).
Settles it: `headingKeysFor`/`parseResumeReply` in `resumeParser.ts`, `assemblePackage` in `mt17.ts`,
plus the actual template merge-field list.

### AC-10 `[BRIEF]` The author's own hypothesis is tested, not assumed
Given the stated suspicion that `Relevant Skills 1` matches `skills1` before `relevant1`,
when the matching order in `headingKeysFor` is read,
then the hypothesis is confirmed or refuted **in writing**, with the deciding line quoted.
The live asymmetry (Skills1/2 discarded from cover+portfolio but NOT resume) is the disconfirming
evidence that must be explained either way.

---

## READING LOG — grounded findings

### F1 `[READ]` The "intended" fix is ALREADY SHIPPED, on `main`, uncommitted-free
`git log --oneline -5` on branch `main`:
```
b0517a8 Ledger: D:build-runs-no-qc closes on the build path, not an adjacent one
51c65e2 Call the evidence pass in-process — the route call was never authenticated
```
`appPackets.ts:655-673` defines `resolveEvidenceForOpp(client, oppId, owner)`; line **739** is
`const evidence = await resolveEvidenceForOpp(client, oppId, owner)`. There is **no** `selfPost` to
`/evidence` left (`grep -rn "selfPost" api/src` → only the helper at 675 and the cadence/outreach
calls at 758/759). `git status` is clean apart from this file.
**Consequence for the brief:** the request is framed as "attack my intended fix" but the fix is on
`main` and `main` is what deploys. This is now a *post-hoc review of shipped code*, and the ACs
below must be satisfiable against HEAD, not against a plan. It also means the D:build-runs-no-qc
ledger row was closed a *second* time (b0517a8) — and I have seen **no** evidence in this repo that
a build-all run has been executed since 51c65e2. That is the live gap.

### F2 `[READ]` AC-4 (auth bypass) — the fix does NOT bypass a check. `packetBuildAll` is gated.
`appPackets.ts:693`: `const guard = requireWrite(req); if (guard) return guard` — inside
`packetBuildAll`, before any work. `requireWrite` (`appSession.ts:72-76`) is the *same* function
`evidenceResolve` calls. So the in-process call sits behind an identical gate on the same request.
**AC-4 passes as written.** The author's reasoning here is correct and I could not falsify it.

### F3 `[READ]` AC-5 (owner spoof) — the author's claim is right on the Bearer path and
**WRONG-BY-OMISSION on the UAT path**. `resolveOwner` (`appSession.ts:46-64`):
- Bearer → `verifySession` → returns `v.email` and **ignores `?owner=` entirely**. Not spoofable.
- **`X-UAT-Token` matching `UAT_BYPASS_TOKEN` → returns `req.query.get('owner') || UAT_USER || demo`
  with `verified: true`.** So a caller holding the UAT token can write evidence for ANY owner via
  `?owner=`, and `requireWrite` waves it through.
- unverified → `?owner=` or demo; `requireWrite` then 401s unless owner is exactly `DEMO_EMAIL`.
**This is NOT a regression introduced by the fix** — the route had the identical property, because
both use the same `resolveOwner`/`requireWrite` pair. But it is a real, live cross-tenant write
capability keyed on one env var, and "the owner cannot be spoofed via `?owner=`" is false as an
unqualified statement. It must be stated as "not spoofable *except* through the UAT bypass, which
is deliberate and gated on `UAT_BYPASS_TOKEN` being set on the Function App".

### F5 `[READ]` AC-3 (import cycle) — no cycle. Claim survives falsification attempt.
`appPackets.ts:18` imports `{ writeEvidence, rebuildComparison, ensureRequirementCols,
ensureEvidenceTable }` from `./appRequirements`. `appRequirements.ts` imports 12 modules, none of
them `appPackets`. `grep -rn "from './appPackets'" api/src/functions/tests` returns exactly ONE
consumer, `appRemediation.ts:33` — which `appRequirements` does not import. **No cycle.**
Settled by the grep above plus `cd api && npm run build` exiting 0 (build not yet run by me).

### F6 `[READ]` **PARITY IS NOT EXACT — the in-process copy DROPS the ownership check.**
This is the most important finding on P1 and it contradicts the comment at `appPackets.ts:650-651`
("Mirrors what `evidenceResolve` does after its auth guard").
`evidenceResolve` (`appRequirements.ts:688-690`) does:
```
select id, role, owner_email from opportunity where id=$1 and owner_email=$2   // [id, owner]
if (!opp) return 404
```
`resolveEvidenceForOpp` (`appPackets.ts:655-673`) has **no equivalent query**. It passes `oppId`
straight to `writeEvidence`. Its caller `packetBuildAll:696` loads the opp as
`${OPP_FIELDS} where id = $1` — **id only, no `owner_email` predicate** (needs confirming against
`OPP_FIELDS`, see AC-11). So on the build path the opportunity is never proven to belong to the
resolved owner, while on the route path it is. The auth guard is the same; the **object-level**
check is not. `requireWrite` only proves *someone* is signed in — it does not prove they own THIS
opportunity.
Verdict: the author's "this caller is already past that gate" is **true of authentication and false
of authorization**. Those are different gates and the comment conflates them.

### F7 `[READ]` Parity diffs that are benign, recorded so a reviewer need not re-derive them
- `rebuildComparison(..., profile.records)` (in-process) vs `..., profile.records.length ?
  profile.records : null` (route): **equivalent**, because the in-process function already returned
  early at line 660-664 when `records.length === 0`. Not a defect.
- In-process calls `ensureEvidenceTable`; the route does not. Extra, not missing.
- The route returns `comparison: cmp`; in-process discards `rebuildComparison`'s return value
  (`appPackets.ts:668` does not capture it). Diagnostic loss only — but see AC-13, the build
  response advertises `refused` and `escalated` fields whose source I have not yet confirmed exist.

### F8 `[READ]` `OPP_FIELDS` confirms F6 — the build path has NO owner predicate
`appPackets.ts:294-295`:
`select id, company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, persona_key,
jd_real, raw_jd from opportunity` — **no `owner_email` column selected and no `where owner_email`.**
Every one of its four call sites (`:198, :493, :571, :696`) appends only `where id = $1`.
So: any signed-in owner (or any anonymous caller in demo mode, per F4) can run `build-all` against
**another owner's opportunity id**, and — since 51c65e2 — that now also writes `requirement_evidence`
and `requirement_comparison` rows for it. The route refused this with a 404; the build path does not.
This is pre-existing for artifact building and **newly extended to evidence** by the in-process fix.

### F9 `[READ]` Transaction reuse — the attack I expected does NOT land, and I say so
`writeEvidence` (`appRequirements.ts:155` and +36/+37) is `begin` → work → `commit`, with
`catch (e) { await client.query('rollback'); throw e }`. So the SHARED client is returned to a clean
state on both success and failure, and a failed evidence pass cannot leave `packetBuildAll`'s
subsequent `update packet set last_build` / `recomputePacket` running inside an aborted transaction.
**Connection reuse is safe.** The only residual is `rollback` itself throwing on a dead socket, in
which case the connection is already unusable regardless of which design was chosen.

### F10 `[READ]` **The real new cost is MODEL CALLS, not the HTTP hop — and it is unmeasured**
`appPackets.ts:666-667` passes `openAiJson({ feature: 'evidence:escalate' })` into `writeEvidence`
whenever `opts.escalate === true`. Because the previous `selfPost` call **always 401'd**, the
escalation tier has *never once executed on the build path*. The comment at `appPackets.ts:736-737`
argues the fix adds "nothing to the four-minute gateway budget that D35 is already losing" — that is
true **only of the HTTP hop it removed**. It is not true of the work now running: for the first time,
a build can make per-requirement model calls after the artifacts are built, inside a request the same
comment says already takes ~3 minutes against a 4-minute gateway cut.
**This is the change's biggest untested risk and the author's comment reasons past it.**
Note it is conditional on the owner's `escalate` setting (`resolveOptionsFor`) — which I have NOT
read, so I do not know whether it is on for `von.ellis@enterpriseds.io`. See AC-14.

### F11 `[READ]` `evidence.refused` / `escalated` are NOT fabricated — claim withdrawn
`writeEvidence`'s declared return (`appRequirements.ts:140-147`) includes `total, evidenced,
unevidenced, refused, profile_records, escalated, proposed, escalation_refusals`. So every field
`packetBuildAll:773-777` reports has a real source. I looked for a fabricated-composite violation
here and did not find one.

### F12 `[READ]` **P2 / D31 IS ALREADY ROOT-CAUSED IN THIS REPO. It is a seeded-data defect, not a
parser defect, and not intermittent.** `api/src/functions/tests/pipeline.ts:102-131`
The comment above `duplicatePromptPairs` records the diagnosis against the **primary source** (the
zap export in `docs/zap-289877647/prompts/`), not against a comparison of the two live rows:
```
LIVE (GET /api/prompts, Actions run 32435525197, 2026-08-21):
  resume_user      29,068 chars  sha256 4b4af848…  \ identical
  portfolio_user   29,068 chars  sha256 4b4af848…  /
  ats_user          8,807 chars  sha256 970fce2e…    (control: differs)
PRIMARY SOURCE:
  node 289877661 "Update Resume/Portfolio Fields"        29,069 chars   <- what portfolio_user IS
  node 299599701 "Copy: Update Resume/Portfolio Fields"   7,712 chars   <- what it SHOULD be
```
> "So `portfolio_user` was seeded with the wrong zap node. It is the resume prompt: 42 `###` section
> markers, **no mention of JSON**, while Call 2 parses its reply with `parseAgentJson`. **Call 2
> therefore cannot return a JSON object, and the portfolio and cover letter fall back to Call 1 on
> every run**, at the cost of a second 16,000-token call."

**Every element of the brief's P2 is confirmed by this, and the brief understates it in one way and
overstates it in another:**
- CONFIRMED: not intermittent. `cannot` + `on every run` is a determinism claim, and the 4/4
  failure on run 32547019724 is exactly what it predicts.
- CONFIRMED: "portfolio/cover content is coming from the wrong call systematically."
- **The brief treats D31 as undiagnosed. It is not.** The fix is a **prompt-row data change**, not a
  code change: the correct text is checked in at
  `docs/zap-289877647/prompts/17-copy-update-resume-portfolio-fields-prompt.md`, and the comment
  says installing it "rewrites live document generation for the real owner, so it is an owner
  decision and a `DEFERRED.md` row."
- **Therefore: writing a parser fix, a retry, or a JSON-mode flag for Call 2 would be treating a
  symptom of a wrong prompt row.** Any AC that lets a Call-2 code change close D31 is wrong.
- Also note the wasted spend the brief does not mention: **a second ~16,000-token call on every
  artifact, every build, whose output is discarded 100% of the time.** 4 artifacts × every run.

### F13 `[READ]` **The D31 ledger row contains a direct contradiction, and its closing evidence
could not have distinguished pass from fail.** This is the same error class as P1.
`.claude/DEFERRED.md:149` (D31, OPEN) says:
> "This row was closed after the `portfolio_user` prompt fix **on the strength of one Trinnex build
> where all four fields populated**."

But `pipeline.ts:110-113` records `GET /api/prompts`, **Actions run 32435525197, dated 2026-08-21**,
showing `resume_user` 29,068 / sha256 `4b4af848…` **still byte-identical to** `portfolio_user`
29,068 / sha256 `4b4af848…`. Two possibilities, and they are not both survivable:
  (a) the "`portfolio_user` prompt fix" never actually reached the live Prompts table, so D31 never
      held even once; or
  (b) it landed and was later reverted/re-seeded.
**I cannot tell which from the repo, and neither can the ledger.** The single source that settles it
is a *fresh* `GET /api/prompts` — see AC-15. Nothing else does: char-count-and-sha of the live rows
against the two zap nodes is the primary source; another build is not.

**And the closing evidence was structurally incapable of proving the fix.** D31's own mitigation
column says: *"The packet still builds — Call 1 is a working fallback, so `built: 4, failed: 0` and
the documents exist."* So **"all four fields populated" is exactly what the FAILURE mode also
produces.** Closing on it is the identical mistake as closing `D:build-runs-no-qc` on an api-test
dispatch of a different path: a proxy that returns the same value under both hypotheses.

**Consequently the D31 row's stated next step is wrong.** It says: *"Needs a third and fourth build
to size how often it fails, before any prompt change is justified."* If `portfolio_user` is the
resume prompt (42 `###` markers, no mention of JSON), the failure rate is **1.0 by construction** and
counting builds measures nothing. `docs/zap-289877647/prompts/` confirms both nodes are checked in
(`16-update-resume-portfolio-fields-prompt.md`, `17-copy-…`). More builds is the fixed-interval-poll
antipattern applied to a question that a single read already answers.

### F4 `[READ]` `requireWrite` passes unverified when owner resolves to demo
`appSession.ts:74`: `if (verified || owner === DEMO_EMAIL) return null`. So an anonymous
`build-all` with no `?owner=` runs the evidence write as `demo@executive-engine.local`. Intended
(open sandbox), but it means **a green "evidence ran" result proves nothing about the real owner's
data** — the verification in AC-1 must assert the owner-scoped row count for
`von.ellis@enterpriseds.io`, not merely that the warning disappeared.

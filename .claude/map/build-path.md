# Packet build path — end-to-end map

Status: IN PROGRESS (written incrementally; whatever is here is the deliverable).
Scope: `POST /api/app/opportunity/{id}/packet/build-async` → `runPacketBuild` → four Google documents.
All line numbers are against the working tree at the time of writing.

---

## 0. Entry points (two, one build)

There are exactly two ways into the build, and they run **the same** `runPacketBuild`:

| Entry | File:line | Shape |
|---|---|---|
| `POST /api/app/opportunity/{id}/packet/build-async` | `api/src/functions/tests/appBuildJobs.ts:52` | files a `packet_build_job` row, drops a queue message, returns **202** in ms |
| `POST /api/app/opportunity/{id}/packet/build-all` | `api/src/functions/tests/appPackets.ts:730` | runs the build **inline**, returns the full summary (used by `appBulk` + the coach tool) |

The async path exists because the synchronous one takes ~3 min and the Azure LB kills the
answer at its idle timeout while the work completes (`appBuildJobs.ts:1-32`, runs
32546312184 → 504, 32548283352 → 502).

### Async wake chain
```
packetBuildAsync                         appBuildJobs.ts:52
  resolveOwner(req)                      appSession.ts
  requireWrite(req)                      appSession.ts        (guard)
  getPgClient()                          pgClient.ts
  enqueueBuild(client, oppId, owner, body.regen === true)     buildQueue.ts
      ↳ DB WRITE: insert packet_build_job (opp_id, owner_email, regen, state='pending')
  sendBuildSignal({jobId, oppId})        buildSignal.ts       [EXTERNAL: Azure Storage Queue `packet-build-jobs`]
      — only when r.job.state === 'pending'  (appBuildJobs.ts:69)
  → 202 { jobId, oppId, state, regen, created, promoted, regenPending, note }

buildQueueWorker(message)                appBuildJobs.ts:167   [queue trigger]
  decodeBuildSignal(message)             buildSignal.ts
  processOneBuild(client, context)       appBuildJobs.ts:123
      claimNextBuild(client)             buildQueue.ts
          ↳ DB WRITE: update packet_build_job set state='running', claimed_at, attempts+1, lease
      runPacketBuild(client, job.opp_id, job.owner_email, { regen: job.regen }, log)   ← THE BUILD
      buildJobOutcome(out.status, out.body)   packetBuild.ts   (NOT body.ok — see :132-135)
      finishBuild(client, job.id, job.attempts, ok, payload, error)   buildQueue.ts
          ↳ DB WRITE: update packet_build_job set state='done'|'failed', result=payload, error, finished_at
             — FENCED on attempts; returns false if reclaimed mid-build → result discarded (:146-150)

buildQueueSweep(timer)                   appBuildJobs.ts:193   [timer, every 5 min]
  abandonExhausted(client)               buildQueue.ts   ↳ DB WRITE: state='failed' on attempt-capped jobs
  processOneBuild(...)                   — reclaims a job whose worker died mid-build
```

Note the queue message is **a wake-up, not an assignment**: the worker claims the *next
eligible* job, not the one the message names (`appBuildJobs.ts:156-166`).

---

## 1. The call graph (execution order)

`runPacketBuild` — `appPackets.ts:756`. Everything below is inside it.

```
runPacketBuild(client, oppId, owner, body, log)                       appPackets.ts:756
│
├─ HAS_GOOGLE_OAUTH guard → 200 {error} if unset                      appPackets.ts:760
├─ ensureContentColumn(client)                                        appPackets.ts:54
│     ↳ DB DDL: alter table artifact add column if not exists content text
│     ↳ DB DDL: alter table artifact add column if not exists drive_url text
├─ select OPP_FIELDS where id=$1 and owner_email=$2                   appPackets.ts:769 (:295 projection)
│     reads opportunity(id, company, role, comp_range, why_surfaced, company_signals,
│                       pain_hypotheses, persona_key, jd_real, raw_jd)
│     → 404 if not owned
├─ loadPacket(client, oppId)                                          appPackets.ts:67
│     ├─ select * from packet where opp_id=$1 order by round desc, created_at desc limit 1
│     ├─ DB WRITE (if none): insert into packet (opp_id)
│     ├─ select type from artifact where packet_id=$1
│     ├─ DB WRITE (per missing): insert into artifact (packet_id, type)   ← 5 types
│     └─ select id,type,status,template_id,doc_url,content,drive_url,updated_at from artifact
│        sorted by ARTIFACT_TYPES order: resume, compact_resume, cover, portfolio, video
│
├─ FOR EACH artifact, in that order (appPackets.ts:773):
│  │   `if (!metaFor(a.type)) continue`  → **video is skipped** (no template)
│  │   so the loop body runs exactly 4× : resume → compact_resume → cover → portfolio
│  │
│  └─ buildTemplatedArtifact(client, {...a, packet_id, opp_id}, opp, body?.regen === true)
│     │                                                            appPackets.ts:501 / called :778
│     ├─ metaFor(art.type)                                         packetTemplates.ts:67
│     │
│     ├─ ensurePackage(client, art, opp, regen)                    appPackets.ts:366
│     │  ├─ OPENAI_API_KEY guard (throws)                          :378
│     │  ├─ ensurePkgColumn  ↳ DDL alter table packet add pkg_json jsonb        :288
│     │  ├─ ensureAnalysisCols ↳ DDL packet.must_haves text[], packet.jd_grounded bool,
│     │  │                        packet.jd_analyzed_at timestamptz            :282
│     │  ├─ select pkg_json, jd_grounded from packet where id=$1               :383
│     │  ├─ generationJd(opp) → { jd, grounded }                               :334
│     │  │     └─ resolvePostingSource(opp)                         jdText.ts
│     │  ├─ CACHE DECISION  :389-394   ← see §2
│     │  │     staleUngrounded = grounded && pkt.jd_grounded !== true
│     │  │     cached = (!regen && !staleUngrounded && pkt.pkg_json) ? pkt.pkg_json : null
│     │  │     if (cached) → return { pkg: cached, generated:false, warnings:[], qcApplied:null }
│     │  │        (NO lineage, NO analysis on this path — :370 comment)
│     │  │
│     │  ├─ buildPackageForJD({key, jd, roleType, company, jobTitle})  pipeline.ts:283
│     │  │  ├─ loadPipelineSettings()                              pipelineConfig.ts
│     │  │  │     [EXTERNAL: Azure Table AppConfig]
│     │  │  ├─ resolveRoleFocus(...)                               pipeline.ts:295
│     │  │  ├─ Prompts table listEntities(is_active eq true)       pipeline.ts:305
│     │  │  │     [EXTERNAL: Azure Table Prompts]
│     │  │  ├─ duplicatePromptPairs(prompts) → warnings            pipeline.ts:316
│     │  │  ├─ MasterContext listEntities(PartitionKey eq 'context')  pipeline.ts:320
│     │  │  │     [EXTERNAL: Azure Table MasterContext]
│     │  │  ├─ **CALL 1** openai chat/completions gpt-4o-mini 16000tok tGen   pipeline.ts:337
│     │  │  │     [EXTERNAL: OpenAI]  prompts resume_system + roleDirective+resume_user
│     │  │  │     parseResumePackage → c1                          :338
│     │  │  ├─ **CALL 2** openai gpt-4o-mini 16000tok tGen          pipeline.ts:377
│     │  │  │     [EXTERNAL: OpenAI]  portfolio_system + portfolio_user + JSON.stringify(c1)
│     │  │  │     parseResumePackage → c2  (skills-refinement pass) :378
│     │  │  ├─ mergeCallTwo(c1, c2) → call3Input                    :406
│     │  │  ├─ **CALL 3** openai gpt-4o-mini 15500tok tQc           pipeline.ts:410
│     │  │  │     [EXTERNAL: OpenAI]  ats_system + ats_user + INPUTS:call3Input
│     │  │  │     parseAgentJson → c3, qcApplied                    :411-415
│     │  │  ├─ assemblePackage(c1, call2Draft(c2), c3) → pkg        :420
│     │  │  └─ returns { pkg, calls:{c1,c2,c3}, usage:[resume,portfolio,ats-qc],
│     │  │               warnings, qcApplied, profileText, omitList }   :440
│     │  │
│     │  ├─ for (u of built.usage) logUsage(`packet:${art.type}:generate:${u.pass}`, …)  :402
│     │  │     ↳ DB WRITE: usage_metering  ← **3 rows per artifact** (see §2)
│     │  │
│     │  ├─ resolvePostingSource(opp)                               :410
│     │  ├─ sourceText()  [profile read; .catch → {text:''}]        :411   appFacts.ts
│     │  ├─ applyCorrectionPass(client, {artifactId, pkg, postingText, profileText, loop:0})  :412
│     │  │     appCorrections.ts — MUTATES `pkg` before it is stored/rendered
│     │  │     ↳ DB WRITE: correction rows (see §4)
│     │  │
│     │  ├─ **DB WRITE** update packet set pkg_json=$1, jd_grounded=$2, updated_at=now()
│     │  │     where id = art.packet_id                              :419-420
│     │  │     ← runs ONCE PER ARTIFACT. Last writer wins. See §2/§3.
│     │  │
│     │  ├─ try { writeSwaps(client, art.packet_id, opp.id, {call1:c1, call3:c3, pkg,
│     │  │        profileText, omitList, loop:0}) }                  :426-431
│     │  │     appSwaps.ts:30
│     │  │     ├─ select id,seq,verbatim,item_text,kind from requirement where opp_id=$1
│     │  │     ├─ buildSwaps(...) (pure)
│     │  │     ├─ begin
│     │  │     ├─ **DB WRITE** delete from swap_decision where packet_id=$1 and loop=0   appSwaps.ts:45
│     │  │     ├─ **DB WRITE** delete from skill_candidate where packet_id=$1 and loop=0 appSwaps.ts:46
│     │  │     ├─ **DB WRITE** insert into skill_candidate (packet_id,list,label,origin,char_len,loop)
│     │  │     ├─ **DB WRITE** insert into swap_decision (packet_id,list,seq,action,
│     │  │     │       from_candidate_id,to_candidate_id,from_label,to_label,requirement_id,
│     │  │     │       verbatim_quote,confidence,driver,rationale,loop)
│     │  │     └─ commit
│     │  │   catch → console.warn only  ← **§4 defect**  appPackets.ts:431
│     │  │
│     │  └─ returns { pkg, generated:true, grounded, warnings, qcApplied,
│     │               lineage: skillLineage(c1,c2,c3,pkg)   packetBuild.ts:128,
│     │               analysis: collectAnalysis(c1,c2)      packetBuild.ts:153 }
│     │
│     └─ renderArtifact(client, art, opp, pkg)                      appPackets.ts:449 / called :504
│        ├─ loadPipelineSettings()  [EXTERNAL: Azure Table AppConfig]           :454
│        ├─ metaFor(type, {resumeTemplateId, portfolioTemplateId, coverLetterTemplateId})  :455
│        ├─ select doc_url from artifact where id=$1  → `superseded`            :465
│        ├─ getGoogleOAuthToken()   [EXTERNAL: Google OAuth token endpoint]     :466  googleAuth.ts
│        ├─ copyThen(token, meta.templateId, name, settings.outputFolderId, after)  :475
│        │  ├─ copyTemplate → **[EXTERNAL: Drive] POST /drive/v3/files/{tpl}/copy**  packetTemplates.ts:110
│        │  └─ after(fileId):
│        │     ├─ injectValues(token, fileId, varsForType(type,pkg), isSlides)  packetTemplates.ts:150
│        │     │     **[EXTERNAL: Docs or Slides] POST …:batchUpdate replaceAllText**
│        │     ├─ stripLeftoverTokens(token, fileId, isSlides)      packetTemplates.ts:187
│        │     │     **[EXTERNAL: Docs/Slides GET]** then **batchUpdate** to blank `{{…}}`
│        │     └─ shareAnyone(token, fileId)                        packetTemplates.ts:204
│        │           **[EXTERNAL: Drive] POST /files/{id}/permissions {anyone,reader}**
│        │  (on throw: deleteDriveFile(token,id) then rethrow — D13)
│        ├─ url = docs.google.com/{presentation|document}/d/{id}/edit             :481
│        ├─ try { writeInsertions(client, art.id, opp.id, {type, pkg, loop:0}) }  :487-489
│        │     appInsertions.ts   ↳ DB WRITE: insertion rows
│        │     catch → console.warn only  ← **§4 defect**
│        └─ **DB WRITE** update artifact set doc_url=$1,
│              content = coalesce(nullif(content,''),$2),
│              status = case when status='todo' then 'review' else status end,
│              updated_at = now() where id=$3                                     :492
│
│  (the whole per-artifact body is wrapped in try/catch at :775-782;
│   catch → results.push({type, error}) — NOT swallowed, surfaced by summariseBuild)
│
├─ resolveEvidenceForOpp(client, oppId, owner)                      appPackets.ts:690 / called :813
│  ├─ select 1 from opportunity where id=$1 and owner_email=$2      :698
│  ├─ ensureRequirementCols(client)   ↳ DDL on requirement           appRequirements.ts
│  ├─ ensureEvidenceTable(client)     ↳ DDL create requirement_evidence
│  ├─ sourceText()  → profile records                                appFacts.ts
│  ├─ resolveOptionsFor(client, owner)  ← reads owner check prefs    checkPrefs.ts
│  ├─ writeEvidence(client, oppId, records, opts, undefined,
│  │        opts.escalate ? openAiJson({feature:'evidence:escalate'}) : undefined)
│  │     ↳ DB WRITE: requirement_evidence
│  │     ↳ [EXTERNAL: OpenAI] ONLY when the owner enabled `escalate`
│  ├─ rebuildComparison(client, oppId, owner, records)  ↳ DB WRITE: comparison rows
│  └─ catch → returns { error } (never throws)                       :714-716
│
├─ try { **DB WRITE** update packet set last_build = $2 where id = $1 }          :819-835
│     last_build JSON = { at, regen, artifacts:[{type,error,warnings,qcApplied}],
│                         lineage: FIRST result with lineage    ← resume        :832
│                         analysis: FIRST result with analysis                  :833 }
│     catch → log(...) only  ← **§4**
├─ recomputePacket(client, pkt.id)                                              :836 / :84
│     ├─ select status from artifact where packet_id=$1
│     ├─ select count(*) from artifact_gate g join artifact a … where g.gate='fail'
│     └─ **DB WRITE** update packet set status=$1, updated_at=now()
├─ if (body.seedCadence) selfPost(app/opportunity/{id}/cadence)                  :838
│     [EXTERNAL: HTTP to SELF_BASE — job-platform-api.azurewebsites.net]
├─ if (body.draftOutreach) selfPost(app/opportunity/{id}/outreach/generate)      :839
│     [EXTERNAL: HTTP to self + OpenAI downstream]
├─ summariseBuild(results)                                          packetBuild.ts:62
└─ return 200 { ok, oppId, company, artifacts, built, failed, warnings, evidence,
                packetStatus, cadenceSeeded, outreachDrafted, sent:false, note }   :844
```

**External-call count for one `regen:true` build (4 artifacts):**

| Call | Per artifact | Per build |
|---|---|---|
| OpenAI chat/completions (`pipeline.ts:337,377,410`) | 3 | **12** |
| Azure Table reads (AppConfig ×2, Prompts, MasterContext) | 4+ | 16+ |
| Google OAuth token | 1 | 4 |
| Drive `files/{tpl}/copy` | 1 | 4 |
| Docs/Slides `batchUpdate` (inject) | 1 | 4 |
| Docs/Slides GET + batchUpdate (strip) | 2 | 8 |
| Drive `permissions` | 1 | 4 |

---

## 2. THE GENERATION-COUNT QUESTION

### 2.1 Why 12, not 3 — proven from the code

`packetBuildAll`'s doc comment (`appPackets.ts:726-729`) says the four artifacts are built
"sharing one generation". **That is false on the `regen:true` path, and the code says so
in one line.**

`runPacketBuild` line 778:

```ts
const built = await buildTemplatedArtifact(client, { ...a, packet_id: pkt.id, opp_id: oppId }, opp, body?.regen === true)
```

`body?.regen === true` is evaluated from the **request body**, which does not change
between iterations. So for one `build-all`/`build-async` call:

| Artifact | iteration | `regen` passed to `ensurePackage` |
|---|---|---|
| resume | 1 | `body.regen === true` |
| compact_resume | 2 | `body.regen === true` |
| cover | 3 | `body.regen === true` |
| portfolio | 4 | `body.regen === true` |

**It is the same value for all four.** Nothing marks "this build already generated";
`ensurePackage` has no per-build memo, and the loop passes no cursor.

Then `ensurePackage` line 390:

```ts
const cached = (!regen && !staleUngrounded && pkt?.pkg_json) ? pkt.pkg_json : null
```

With `regen === true`, `!regen` is `false` → `cached` is `null` on **every** iteration →
`buildPackageForJD` runs on **every** iteration.

`buildPackageForJD` makes exactly three OpenAI calls (`pipeline.ts:337, 377, 410`) and
returns `usage: [{pass:'resume'},{pass:'portfolio'},{pass:'ats-qc'}]` (`pipeline.ts:435-439`).
`ensurePackage:402` meters each one as `packet:${art.type}:generate:${u.pass}`.

**4 artifacts × 3 passes = 12 rows**, with exactly the labels measured on the 16:36 UTC
2026-08-22 build: `packet:{resume,compact_resume,cover,portfolio}:generate:{resume,portfolio,ats-qc}`.
**OBSERVED in code + matches the measurement.** The doc comment describes the `regen:false`
path only.

### 2.2 What happens on `regen:false`

The cache is real but there are two ways it still generates more than once:

- **First build of a packet.** `pkt.pkg_json` is null on iteration 1 → generate. Iteration 1
  writes `pkg_json` at `:419`, so iterations 2-4 hit the cache. → **3 model calls, one
  generation shared.** This is the case the doc comment describes.
- **`staleUngrounded` (`:389`)** = `grounded && pkt.jd_grounded !== true`. On a packet
  whose cached package predates the X1 grounding fix, iteration 1 forces a regeneration and
  the same `:419` update sets `jd_grounded = true`, so iterations 2-4 see
  `staleUngrounded === false` and cache-hit. → also 3 calls. This is correct behaviour,
  not a defect.

### 2.3 Which generation does each DOCUMENT render from? — **its own**

This is the load-bearing part and it is provable in three lines.

`buildTemplatedArtifact` (`appPackets.ts:501-509`):

```ts
const { pkg, warnings, qcApplied, lineage, analysis } = await ensurePackage(client, art, opp, regen)
const rendered = await renderArtifact(client, art, opp, pkg)
```

`pkg` here is the **in-memory object returned by that artifact's own `ensurePackage`
call** — `built.pkg` from `pipeline.ts:420`, mutated by `applyCorrectionPass`, returned at
`appPackets.ts:433`. `renderArtifact` receives that exact object and injects it
(`renderArtifact:476 → injectValues(token, fileId, varsForType(art.type, pkg), …)`).

**`renderArtifact` never re-reads `packet.pkg_json`.** Grep of the function body
(`:449-494`) shows its only `select` is `select doc_url from artifact where id=$1` (`:465`).

Therefore:

> **YES — the four documents in one `regen:true` packet can, and normally do, contain
> DIFFERENT skills.** Each document is rendered from a separate 3-call generation.

The mechanism that makes them differ rather than merely being redundant:
`pipeline.ts:327-333` sends `temperature: settings.generateTemperature.value` on calls 1
and 2 and `qcTemperature` on call 3. Unless the owner has set both to 0, four independent
samplings of the same prompts return different skill lists. The comment at
`pipeline.ts:324-326` confirms temperature is a configured, non-zero-by-design knob
("the reconciliation pass … should be the least creative").

**INFERRED (high confidence, needs one live query to confirm):** whether the four live
documents actually differ depends on the owner's current `generateTemperature`. The
*capability* to differ is OBSERVED in the code; the *fact* that build 16:36 produced four
different skill sets would be confirmed by reading the four Google docs, or by comparing
`swap_decision.to_label` (portfolio's) against `packet.last_build.lineage[].final`
(resume's) — which the task states already disagree, and §2.4 explains exactly why.

**And `packet.pkg_json` matches only the LAST document.** `:419` runs once per artifact
with no `where … and pkg_json is null` guard and no conditional. The iteration order is
fixed by `loadPacket`'s sort against `ARTIFACT_TYPES` (`:79`) with `video` skipped, so:

```
resume → compact_resume → cover → PORTFOLIO   (last writer)
```

`packet.pkg_json` after a `regen:true` build holds **the portfolio's generation**. The
resume document on disk in Drive was built from a package that no longer exists anywhere.

Note this is compounded by `packetTemplates.ts:22-40`: `resume` and `compact_resume` share
`RESUME_TEMPLATE_ID` **and the identical placeholder list**. The two documents are the same
template filled from two different generations — so "the resume" and "the compact resume"
are two different resumes, not a long and a short one.

### 2.4 `writeSwaps` vs `skillLineage` — which artifact's data survives

Both are per-artifact, and they resolve the four-way collision in **opposite** directions.

**`swap_decision` / `skill_candidate` → the LAST artifact wins (portfolio).**
`writeSwaps` (`appSwaps.ts:43-70`) opens a transaction and starts with:

```sql
delete from swap_decision  where packet_id=$1 and loop=$2   -- appSwaps.ts:45
delete from skill_candidate where packet_id=$1 and loop=$2  -- appSwaps.ts:46
```

`loop` is `Math.max(0, Number(args.loop ?? 0)|0)` (`appSwaps.ts:33`) and `ensurePackage`
passes `loop: 0` for every artifact (`appPackets.ts:429`). So iteration 2 **deletes
iteration 1's rows** and inserts its own; iteration 4 deletes iteration 3's. The surviving
loop-0 rows are portfolio's.

**`packet.last_build.lineage` → the FIRST artifact with lineage wins (resume).**
`appPackets.ts:832`:

```ts
lineage: (results.find((r: any) => r.lineage?.length) || {}).lineage || null,
```

`Array.prototype.find` returns the first match. `results` is pushed in loop order
(`:779`), so on a `regen:true` build every entry has lineage and the first is **resume**.

> **This is the defect that produces the measured disagreement.** `swap_decision` holds
> portfolio's skill labels; `packet.last_build.lineage` holds resume's. They are describing
> the same `packet.id` and the same `loop: 0` and they were never generated from the same
> model output. OBSERVED — the two selection rules are in the source, three lines apart in
> effect, and they select opposite ends of the same array.

The comment at `appPackets.ts:829-831` states the premise that makes it wrong:

> *"Taken from the first artifact that actually generated — all four share one generation,
> so the lineage is a property of the BUILD, not of a document."*

On the `regen:true` path the four do **not** share one generation, so lineage is a property
of the resume document specifically, mislabelled as a property of the build. The comment
was written correct for `regen:false` and is false for `regen:true`.

Same class of error in `renderArtifact`: `writeInsertions` is called per artifact
(`:488`) but keyed on `art.id`, so it does **not** collide — each artifact's insertions are
its own. `insertion` is therefore the one provenance table that is internally consistent
with its document.

### 2.5 The minimal change that makes `regen:true` produce ONE shared generation

**Minimal, and it is one line plus a hoist.** In `runPacketBuild` (`appPackets.ts:772-783`),
regen must be consumed by the *first* artifact only:

```ts
let regen = body?.regen === true
for (const a of artifacts) {
  if (!metaFor(a.type)) continue
  try {
    const built = await buildTemplatedArtifact(client, {...a, packet_id: pkt.id, opp_id: oppId}, opp, regen)
    regen = false            // ← the whole change: the cache written at :419 serves 2..4
    results.push({...})
  } catch (e) { results.push({ type: a.type, error: String(e) }) }
}
```

Why this and nothing more: `ensurePackage:419` already writes `pkg_json` **before** the
loop's next iteration, so once artifact 1 has generated, `!regen && !staleUngrounded &&
pkt.pkg_json` is true for 2, 3 and 4 with no other change. Cost drops 12 → 3 model calls;
all four documents render from one identical package; `pkg_json` matches every document;
`writeSwaps` runs once so no delete-collision; `lineage` becomes true to all four.

**What would break — the honest list:**

1. **`regen: false` on a THROWN artifact 1.** If artifact 1 throws inside
   `buildPackageForJD`, the catch at `:782` records the error and the loop continues with
   `regen` already cleared — but `:419` never ran, so `pkg_json` is still the *old* package.
   Artifacts 2-4 would then render from the previous build's stale content while the caller
   asked for a rebuild. Fix: only clear `regen` after a *successful* `buildTemplatedArtifact`
   — i.e. put `regen = false` on the line after the await, inside the `try`, as shown above.
   (That is what the snippet does; stating it because putting it in a `finally` would be wrong.)
2. **A cache-hit returns no lineage/analysis** (`ensurePackage:370`, `:394`). Artifacts 2-4
   would carry `lineage: undefined`, so `results.find(r => r.lineage?.length)` at `:832`
   would pick artifact 1 — which is now genuinely the build's one generation. This
   *stops* being a bug; no change needed.
3. **`warnings` shrink to artifact 1's.** A cached package returns `warnings: []` and
   `qcApplied: null` by design (`:392-394`). Today the same warnings are reported four times
   (prefixed by type in `summariseBuild:66`). After the change, `summariseBuild` sees them
   once. `buildJobOutcome` (`packetBuild.ts:53-59`) keys on `failed`/`built`/`error`, not on
   warning count, so job state is unaffected. But `runOutcome`'s `warningCount === 0` clean
   test (`pipeline.ts:198`) is on the MT-22 path, not this one — unaffected.
4. **`qcApplied` becomes `null` for artifacts 2-4** in `last_build.artifacts[]` (`:826`).
   Any reader that treats `qcApplied === null` as "QC failed" would misreport. Grep before
   changing.
5. **Per-artifact tailoring is lost — if it was ever intended.** Nothing in
   `buildPackageForJD`'s inputs varies by artifact type: `ensurePackage:397` passes
   `{key, jd, roleType, company, jobTitle}` and none of those derive from `art.type`. So the
   four generations differ **only by sampling noise**, not by design. There is no per-artifact
   tailoring to lose. OBSERVED — `art.type` is used in `ensurePackage` only for the
   `logUsage` label (`:402`).

---

(sections 3-5 + defect list follow)

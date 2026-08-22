# Packet build path — end-to-end map

Status: COMPLETE — sections 0-5 + defect list + appendix.
Method: source read only. No file in this repo was modified except this one.
Every claim is labelled OBSERVED (read from source here) or INFERRED (follows from source,
runtime fact not measured here).
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

## 3. Every consumer of `packet.pkg_json`

`grep -rn pkg_json api/src/ app/src/` — **`app/src` has zero hits**; the frontend receives it
as `pkg` from `packetGet` (`appPackets.ts:144`) and consumes it in
`app/src/screens/OppDetail.jsx:509,532,561`.

| # | Reader | file:line | During or after the build? | Effect of a mid-build overwrite |
|---|---|---|---|---|
| 1 | `ensurePackage` cache probe | `appPackets.ts:383,390` | **DURING** — once per artifact | This IS the mechanism. On `regen:false` it reads the write artifact N-1 made at `:419`; that is intended. On `regen:true` the read result is discarded (`!regen` short-circuits). |
| 2 | `ensurePackage` writer | `appPackets.ts:419` | **DURING** — the overwriter, 4× | — |
| 3 | `packetGet` → `pkg` | `appPackets.ts:144` | after (and reachable during) | A poll landing mid-build returns whichever artifact's package has been written so far. `packetGet` is `GET`, unauthenticated-readable, and the UI polls it. The user can watch the package change under them with no indication which document it belongs to. |
| 4 | `artifactContent` (manual edit) | `appPackets.ts:1069` read → `:1071` write | after | **Read-modify-write, not atomic.** `select pkg_json` … `update packet set pkg_json = {...cur, ...body.pkg}`. A build write landing between the two statements is silently discarded — the whole regenerated package reverts to `cur`. |
| 5 | `artifactAiEdit` | `appPackets.ts:1102` read → `:1129` write | after | Same non-atomic RMW, and worse: `merged = {...pkg, [section]: revised}` writes back the *entire* stale package plus one edited section. A concurrent build's package is lost wholesale. |
| 6 | `evaluateArtifact` (the check engine) | `appChecks.ts:36` select → `:105` `pkg: art.pkg_json \|\| {}` | **after** — route `POST /api/app/artifact/{id}/checks` (`appChecks.ts:205`), and from `appRemediation.ts:185,272` | **The most consequential reader.** It is joined `artifact a join packet p`, so *every* artifact of the packet is graded against the *one* `pkg_json` — which after a `regen:true` build is the **portfolio's** generation. Grading the resume artifact reads text that is not in the resume document. Accusation-grade: `check_result`, `artifact_gate`, `artifact_score` all derive from it. |
| 7 | `runReview` (model reviewer) | `appReviewer.ts:98` select → `:146` `pkg: art.pkg_json \|\| {}` | after — route `appReviewer.ts:369` | Same join, same mismatch. The reviewer model is shown the portfolio's package and asked to review the resume artifact. Its verdict is persisted against `run_id`. |
| 8 | `appRemediation` scoped-regen loop | writes at `appRemediation.ts:266`; comment at `:477` | after | Acknowledges the divergence in its own comment: *"pre-loop content while `packet.pkg_json` has moved on — the document and the package"*. It also calls `renderArtifact` directly (`:481`), so it is a second writer of `artifact.doc_url`. |
| 9 | `artifactCorrectionRevert` | `appCorrections.ts:216` read → `:228,231` write | after | Reverts one correction by merge field: `pkg = {...art.pkg_json, [merge_field]: result.text}`. A correction recorded against the resume's generation is reverted inside the portfolio's stored package. Also a non-atomic RMW. |
| 10 | `OppDetail.jsx` | `app/src/screens/OppDetail.jsx:509,532,561` | after | Renders `p.pkg` as "the packet's content" with no artifact attribution. |

**Summary:** exactly one reader (#1) is meant to see a mid-build value. Every other reader
treats `pkg_json` as "the package this packet's documents were built from" — a statement that
is true of at most one of the four documents.

---

## 4. Error swallowing on the build path

Ordered by what is lost, worst first. `appPackets.ts:431` (the known one) is #2.

| # | Site | file:line | What is silently lost |
|---|---|---|---|
| 1 | `const corrections = await applyCorrectionPass(...)` — **assigned and never read** | `appPackets.ts:412` | `applyCorrectionPass` deliberately does not throw: it returns `{ notApplicable, reason }` and its own comment says *"Reported, not swallowed … a silent catch here would leave the user reading uncorrected text under a change log that says nothing happened"* (`appCorrections.ts:130-134`). **The build path is that silent catch.** `grep -n corrections appPackets.ts` returns exactly one line — the assignment. So `"the correction pass failed: …"` and `"no employer posting text to compare against"` reach nobody: not `warnings`, not `last_build`, not the response. The callee honoured its contract and the caller dropped it. |
| 2 | `writeSwaps` catch → `console.warn` | `appPackets.ts:431` | The entire `swap_decision` + `skill_candidate` provenance for that artifact. **And worse than "nothing was written":** `writeSwaps` does `delete … loop=0` then inserts inside a transaction and rolls back on error (`appSwaps.ts:43-71`). A throw therefore leaves the **previous artifact's** loop-0 rows in place, correctly-shaped and wrong — the packet keeps provenance attributed to a generation that is not the one just made, with only a console line saying so. |
| 3 | `last_build` persist catch → `log(...)` | `appPackets.ts:835` | The whole build diagnosis: `lineage`, `analysis` (the discarded-section text), per-artifact `warnings` and `qcApplied`. The comment two lines above (`:814-818`) states this write exists *because* the HTTP response is routinely lost to the gateway. If both are lost the build leaves no diagnosis at all — and `log()` goes to Function App logs, not to the job row. |
| 4 | `writeInsertions` catch → `console.warn` | `appPackets.ts:489` | The `insertion` rows: what text landed in each merge field of that document. The Google file exists with no record of its contents. Note `insertion` is the one provenance table that is *not* corrupted by the 4× collision (keyed on `art.id`), so losing it loses the only per-document truth. |
| 5 | `sourceText().catch(() => ({ text: '' }))` | `appPackets.ts:411` | The profile-read failure — and this one **changes the output rather than losing a record**. The empty string is handed to `applyCorrectionPass` as `profileText`, and `scanEcho` uses the profile side to decide whether a phrase is the candidate's own. With an empty profile, phrases the candidate legitimately owns look like unowned posting echoes, so the pass rewrites text it should have left alone — and writes `correction` rows recording those rewrites as legitimate. Silent, and it degrades the shipped document. |
| 6 | `stripLeftoverTokens` — `if (!res.ok) return []` and the batchUpdate has **no `res.ok` check at all** | `packetTemplates.ts:191` and `:199-201` | A failed read of the document is indistinguishable from a clean document: both return `[]`, which the response reports as `cleanedTokens: []`. A failed *strip* is reported as a successful one. Result: unfilled `{{Placeholder}}` / `{{@CoverLetterBody}}` tokens stay visible in the document the owner sends, under a clean build report. |
| 7 | `shareAnyone` — no `res.ok` check, no return value | `packetTemplates.ts:204-209` | A permissions failure. `renderArtifact` still writes `doc_url` (`:492`) and returns a URL the build reports as a finished artifact. The owner sends a link that 404s for the recipient, and nothing anywhere recorded that sharing failed. |
| 8 | `runPacketBuild` drops `supersededDocUrl` | returned at `appPackets.ts:493`, spread through `:508`, **not pushed at `:779-781`** | The id of the Google file this rebuild orphaned. `renderArtifact`'s own comment (`:461-464`) says it is *"returned so the caller can RECORD it: an orphan population nobody can query is one nobody can ever clean up."* The single caller that runs on every rebuild does not record it. `results.push({ type, url, cleanedTokens, warnings, qcApplied, lineage, analysis })` — the field is simply absent. |
| 9 | `selfPost` catch → `{ error }`, then `cadenceSeeded = !r?.error` | `appPackets.ts:719-724`, consumed `:838-839` | The error text. A transport failure, a 500, and a legitimate refusal all collapse into `cadenceSeeded: false` / `outreachDrafted: false` with no reason anywhere. |
| 10 | `buildQueueWorker` catch → `context.log` | `appBuildJobs.ts:175-177` | A `getPgClient()` failure means the job is never claimed and the queue message is consumed. Recovery depends entirely on the 5-minute sweep. Documented and deliberate (`:162-166`), listed for completeness. |
| 11 | `sendBuildSignal` failure ignored | `appBuildJobs.ts:68-69` | Up to 5 minutes of latency before the sweep finds the job. Documented and deliberate. |

**Not swallowed (correct, listed so the list is falsifiable):**
`runPacketBuild:782` (`catch (e) { results.push({ type, error }) }`) surfaces per-artifact
failure through `summariseBuild` → `buildJobOutcome` → the job row.
`resolveEvidenceForOpp:714` returns `{error}` which is folded into `warnings` at `:847-849`
(truncated to 200 chars).
`copyThen` (`packetTemplates.ts:134-147`) deletes the orphan and **rethrows** — the D13 fix.

---

## 5. Idempotency — what corrupts if the same build runs twice concurrently

### 5.1 Does `pbj_one_live_per_opp` cover it? **Only partially — and it does not cover the case most likely to happen.**

```sql
create unique index if not exists pbj_one_live_per_opp
  on packet_build_job(opp_id) where state in ('pending','running');   -- schema.ts:1134-1135
```

Three holes, in descending likelihood:

**(a) `POST /packet/build-all` never creates a job row.** `packetBuildAll`
(`appPackets.ts:730-744`) calls `runPacketBuild` **directly**. It does not call
`enqueueBuild`, does not insert into `packet_build_job`, and is therefore completely
invisible to the index. So:
- two concurrent `build-all` POSTs on one opportunity → **two full builds, unguarded**;
- a `build-all` concurrent with a queued `build-async` → **two full builds, unguarded**.
`build-all` is not dead code — `appBulk` and the coach tool call it, and the async file's
own comment says so (`appBuildJobs.ts:18-19`). **OBSERVED.**

**(b) The lease can hand one job to two live workers.** `claimNextBuild`
(`buildQueue.ts:157-171`) reclaims a row in `state='running'` once
`claimed_at < now() - 10 minutes`. A build takes ~3 min, so the margin is real but not a
guarantee — a worker hung on a slow Google or OpenAI call is still *alive* when its job is
reclaimed. The `finishBuild` fence (`buildQueue.ts:197-205`,
`where id=$1 and attempts=$5 and state='running'`) then guarantees only one of them can
write the **job row**. It does **not** guarantee anything about the **side effects**: by the
time the loser is fenced out it has already made its Drive copies, written `pkg_json`, and
run `writeSwaps`. The file says exactly this at `:42-43` — *"The lease is a HEURISTIC, not a
guarantee"* — and the fence's scope is the row.

**(c) `appRemediation` is a third concurrent writer.** It calls `renderArtifact` directly
(`appRemediation.ts:481`) and writes `pkg_json` (`:266`) with no build-job row at all.

### 5.2 What actually corrupts, per table

| Table / column | Corruption | Why |
|---|---|---|
| `packet` (whole row) | **Duplicate packets for one opportunity.** | `loadPacket:68-71` does `select … limit 1` then `insert into packet (opp_id)` with **no unique constraint on `packet(opp_id)`** (`schema.ts:82-94` — only `packet_opp_idx`, a plain index). Two concurrent first builds both see no row and both insert. Afterwards `order by round desc, created_at desc limit 1` picks one arbitrarily and the other packet's artifacts and documents are unreachable. |
| `artifact` rows | **Duplicate artifact rows of the same type.** | `loadPacket:72-76` computes `missing` then inserts, and `artifact` has **no `unique(packet_id, type)`** (`schema.ts:97-108`). Two concurrent loads both compute the same `missing` list and both insert 5 rows. The build loop then iterates 8 templated artifacts and creates 8 Google files. |
| `packet.pkg_json` | Last-writer-wins across two builds. | `:419` is an unconditional `update`. Build A's documents end up described by build B's package — the §2.3 problem, widened. |
| `packet.jd_grounded` | Same. | Written by the same statement. |
| `swap_decision`, `skill_candidate` | **Rows deleted by the other build.** | `appSwaps.ts:45-46` `delete … where packet_id=$1 and loop=0` runs inside B's transaction and removes A's committed rows. Referential integrity survives (candidate ids are inserted in the same transaction as the swaps referencing them), but A's provenance is gone. |
| `artifact.doc_url` | Last-writer-wins → **a live Google file orphaned with no record.** | `:492` is unconditional; `superseded` is captured at `:465` and then dropped by `runPacketBuild` (§4 #8). |
| `packet.last_build` | Last-writer-wins. | `:821`. |
| `usage_metering` | **Double billing, recorded as legitimate.** | `logUsage` at `:402` appends; nothing dedupes. Two concurrent `regen` builds write 24 rows and every one is real spend. |
| `correction` | `on conflict do nothing` (`appCorrections.ts:124`) + `unique(artifact_id, merge_field, loop)` (`schema.ts:506`). | **Safe.** The second build's corrections are dropped rather than duplicated. |
| `insertion` | `unique(artifact_id, merge_field, loop)`-style guard (`schema.ts:506` family). | Keyed on `artifact_id`, so no cross-artifact collision; concurrent duplicates are constrained. |
| `packet_build_job` | **Safe** — the fence (`buildQueue.ts:200`) admits exactly one writer per attempt. | This is the one thing the queue genuinely guarantees. |

### 5.3 The honest one-line answer

> The partial unique index makes the **queue** idempotent. It does not make the **build**
> idempotent, and `build-all` bypasses it entirely. The build's own writes —
> `packet.pkg_json`, `artifact.doc_url`, `swap_decision`, and the un-constrained
> `packet`/`artifact` inserts in `loadPacket` — have no optimistic-concurrency check of any
> kind: not a version column, not a `where updated_at = $expected`, not an advisory lock.

The smallest real fix is a `pg_advisory_xact_lock(hashtext(oppId))` (or a
`select … from packet where opp_id=$1 for update`) around `loadPacket` + the artifact loop
in `runPacketBuild`, plus `unique(packet_id, type)` on `artifact`. That closes (a), (b) and
(c) at once, because it does not depend on which entry point started the build.

---

## Defect list

Most consequential first. **OBSERVED** = read directly from source in this repo.
**INFERRED** = follows from the source but the runtime fact was not measured here.

### D-1 — The check engine and the model reviewer grade every artifact against ONE package that belongs to only one of them
`appChecks.ts:36` (select) → `:105` (`pkg: art.pkg_json || {}`); `appReviewer.ts:98` → `:146`.
Both join `artifact a join packet p on p.id = a.packet_id` and take `p.pkg_json` — one column
for four artifacts. After a `regen:true` build that column holds the **portfolio's**
generation (`appPackets.ts:419` runs once per artifact, unconditional, portfolio last).
So `check_result`, `artifact_gate`, `artifact_score` and the reviewer verdict for the
**resume** artifact are computed from text that is in the **portfolio** document.
**OBSERVED** — the join, the projection and the unconditional per-artifact write are all in
source; the write order is fixed by `ARTIFACT_TYPES` (`appPackets.ts:50`) and
`loadPacket`'s sort (`:79`).
**Why it is first:** this is the only defect on the list that is accusation-grade. Per
CLAUDE.md's tiering, anything deciding a gate or a score is tier 1.

### D-2 — `regen:true` runs four full generations, not one; the doc comment says otherwise
`appPackets.ts:778` passes `body?.regen === true` — request-scoped, identical for all four
iterations — into `ensurePackage`, whose cache is `!regen && …` (`:390`). Four
`buildPackageForJD` calls × 3 OpenAI calls each (`pipeline.ts:337,377,410`) = **12**.
The doc comment at `:726-729` claims the artifacts share "one generation"; the comment at
`:829-831` repeats it as a premise.
**OBSERVED in code; CORROBORATED by the measurement** — `usage_metering` recorded 12 rows
labelled `packet:{resume,compact_resume,cover,portfolio}:generate:{resume,portfolio,ats-qc}`
on the 16:36 UTC 2026-08-22 build, which is exactly the label `ensurePackage:402` constructs.
Cost: 4× the model bill and ~4× the wall clock of the rebuild path — the same path whose
3-minute duration is why `appBuildJobs.ts` exists at all.

### D-3 — Three of the four documents render from a package that is stored nowhere
`buildTemplatedArtifact:503-504` passes `ensurePackage`'s **in-memory** `pkg` straight to
`renderArtifact`, which never re-reads `pkg_json` (its only select is
`select doc_url from artifact where id=$1`, `:465`). Each document is injected with its own
generation; `pkg_json` retains only the last. The resume, compact resume and cover documents
are therefore un-reproducible and un-auditable after the build.
**OBSERVED.** Corollary, also OBSERVED: the four documents *can* contain different skills —
`pipeline.ts:329` sends `temperature: settings.generateTemperature.value` on calls 1 and 2,
so four independent samplings of identical prompts diverge. Whether they *did* on a given
build is **INFERRED** without reading the four Drive files (or a non-zero temperature check).

### D-4 — `swap_decision` and `packet.last_build.lineage` describe different artifacts of the same build
`writeSwaps` (`appSwaps.ts:45-46`) opens with `delete from swap_decision/skill_candidate
where packet_id=$1 and loop=$2`, and `loop` is `0` for every artifact
(`appPackets.ts:429`) → the **last** artifact (portfolio) wins.
`last_build.lineage` uses `results.find(r => r.lineage?.length)` (`appPackets.ts:832`) →
`Array.find` returns the **first** match → resume.
The two are populated from the same loop, seven lines apart in effect, and select opposite
ends of it.
**OBSERVED in source; the disagreement is independently MEASURED** (the task reports the swap
rows and the lineage carrying different skill labels from one build — this is the mechanism).

### D-5 — The correction pass's failure report is assigned to a variable and never read
`appPackets.ts:412`: `const corrections = await applyCorrectionPass(...)`.
`grep -n corrections appPackets.ts` → one line, the assignment.
`applyCorrectionPass` returns `{ rows, notApplicable, reason }` and never throws
(`appCorrections.ts:130-134`), with a comment stating the report exists precisely so a
failure is not silent. Nothing on the build path reads it, so a failed correction pass is
indistinguishable from a clean one in `warnings`, in `last_build`, and in the response.
**OBSERVED.**

### D-6 — Every rebuild orphans a Google Drive file and the build path discards its id
`renderArtifact:465` captures the outgoing `doc_url` as `superseded` and returns it as
`supersededDocUrl` (`:493`) with a comment saying it exists so the caller can record it
(`:461-464`). `buildTemplatedArtifact:508` passes it through. `runPacketBuild:779-781`
pushes `{ type, url, cleanedTokens, warnings, qcApplied, lineage, analysis }` — the field is
dropped. There is no Drive DELETE anywhere on this path.
**OBSERVED.** Consequence: 4 orphaned files per rebuild, un-enumerable.

### D-7 — `build-all` is invisible to the one-live-build-per-opportunity index
`packetBuildAll` (`appPackets.ts:730-744`) calls `runPacketBuild` directly and never touches
`packet_build_job`, so `pbj_one_live_per_opp` (`schema.ts:1134-1135`) cannot see it. Two
`build-all` calls, or a `build-all` racing a queued `build-async`, run two concurrent builds
on one packet with the §5.2 corruption set.
**OBSERVED.** The route is live and called by `appBulk` and the coach tool
(`appBuildJobs.ts:18-19`).

### D-8 — `loadPacket` can create duplicate packets and duplicate artifacts; no constraint stops it
`appPackets.ts:68-76` is select-then-insert for both `packet` and `artifact`.
`schema.ts:82-94` gives `packet` only `packet_opp_idx` (a plain index) — **no `unique(opp_id)`**.
`schema.ts:97-108` gives `artifact` only `artifact_packet_idx` — **no `unique(packet_id, type)`**.
Neither insert uses `on conflict`.
**OBSERVED** (the schema and the statements). **INFERRED**: that the race window has been hit
in production — not measured here; a `select opp_id, count(*) from packet group by 1 having
count(*)>1` via `db-query.yml` would settle it, as would the same over
`artifact(packet_id, type)`.

### D-9 — Two Google API calls on the ship path have no response check
`shareAnyone` (`packetTemplates.ts:204-209`) — no `res.ok`, no return value. A sharing
failure still yields a stored `doc_url` and a reported-finished artifact; the recipient's
link 404s.
`stripLeftoverTokens` (`packetTemplates.ts:187-202`) — `if (!res.ok) return []` on the read
(clean document and failed read are the same answer), and the batchUpdate at `:199-201` has
no check at all. `cleanedTokens: []` in the response therefore does not mean the document is
free of `{{Placeholder}}` tokens.
**OBSERVED.**

### D-10 — An unreadable profile silently changes the shipped text
`appPackets.ts:411`: `sourceText().catch(() => ({ text: '' }))`. The empty string becomes
`profileText` for `applyCorrectionPass` (`:413`), whose `scanEcho` uses the profile side to
decide whether a phrase is the candidate's own. An empty profile makes owned phrases look
like unowned posting echoes, so the pass rewrites them and records `correction` rows
presenting those rewrites as legitimate.
**OBSERVED** for the swallow and the data flow. **INFERRED** for the rewrite behaviour —
confirming it requires reading `scanEcho`/`planCorrections` in `correction.ts`, which this
pass did not open.

### D-11 — `resume` and `compact_resume` are the same template with the same placeholders
`packetTemplates.ts:23-33`: both map to `RESUME_TEMPLATE_ID` with an identical
`placeholders` array. `varsForType` (`:76-82`) therefore injects the same seven fields into
the same template for both. Combined with D-2/D-3 the two "different" resumes are one
template filled from two independent samplings of one prompt — not a full and a compact
version of anything.
**OBSERVED.** Whether this is intended is a product question, not a code question; flagged
because "compact" is a promise the render path does not keep.

---

## Appendix — things checked and found correct

These were candidates and are not defects; recorded so the list above is falsifiable.

- **Per-artifact failure is not swallowed.** `runPacketBuild:782` records it and
  `summariseBuild` → `buildJobOutcome` (`packetBuild.ts:53-59`) turns it into a `failed` job.
- **`buildJobOutcome` correctly does not key on `body.ok`** (`appBuildJobs.ts:132-137`) — a
  build with warnings is `done`, not `failed`.
- **`copyThen` closes the D13 orphan** (`packetTemplates.ts:134-147`): the copy is deleted
  before the error is rethrown.
- **Ownership is enforced in three places on this path**, each at the query:
  `runPacketBuild:769` (`and owner_email = $2`), `enqueueBuild` (`buildQueue.ts:101-103`),
  `getBuildJob` (`buildQueue.ts:239-241`), and `resolveEvidenceForOpp:698`.
- **`writeInsertions` does not collide** across the four artifacts — it is keyed on
  `art.id`, not `packet_id`, so `insertion` is the one provenance table consistent with its
  own document.
- **`finishBuild`'s fence is correct for the job row** (`buildQueue.ts:197-205`); it simply
  does not extend to side effects, which §5 states rather than blames.
- **`staleUngrounded`** (`appPackets.ts:389`) forces at most ONE extra generation, not four:
  the `:419` write sets `jd_grounded = true` before the next iteration reads it.


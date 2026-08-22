# Acceptance Criteria — Async packet build-all (ledger `D35`)

> Written incrementally. Sections marked **[from brief]** were written before reading any code;
> sections marked **[verified: <file>]** were written after reading the named source.
> Anything not so marked is an inference and says so.

## Problem statement (given, measured — restated for the record) [from brief]

- `POST /api/app/opportunity/{id}/packet/build-all` (`api/src/functions/tests/appPackets.ts`,
  handler `packetBuildAll`) performs ~3 minutes of work: four artifacts, each several OpenAI
  calls plus Google Docs writes.
- The Azure Functions gateway aborts the request at ~4 minutes.
- Run `32546312184`: **504** returned at 02:31:51 while all four artifacts had already
  completed and persisted doc_urls (02:29:02, 02:30:10, 02:30:53, 02:31:50) — i.e. the 504
  landed one second after the last artifact succeeded. Run `32548283352`: **502**.
  `/api/health` healthy ⇒ the app is fine; the gateway is the failing component.
- Consequence: blocks `D31` and `D33` (their only evidence is carried in the build response),
  and reports a failure to the owner for a build that succeeded.

---

## A. The 202 contract [from brief]

1. **Given** an authenticated owner who owns opportunity `{id}`, **when** they
   `POST /api/app/opportunity/{id}/packet/build-all`, **then** the response is `202` with a body
   containing a `jobId` (and enough to poll: at minimum `jobId`, `status:"pending"`), and the
   response is returned in **under 5 seconds** measured wall-clock — i.e. before any OpenAI call
   is issued.
   *Settled by:* a request-timing assertion in `api/test/` against the handler in
   `api/src/functions/tests/appPackets.ts`; and a live `api-test.yml` run recording the HTTP
   status and elapsed time.

2. **Given** the 202 response, **when** the caller inspects it, **then** it MUST NOT contain the
   artifact payloads/doc_urls (they do not exist yet). Any consumer that reads artifacts out of
   the build-all response body is a **breaking-change site** and must be enumerated before merge.
   *Settled by:* `grep -rn "build-all" app/src api/src api/test scripts .github` — every hit
   listed in the PR description with its migration.

3. **Given** the job was created, **when** the same owner POSTs `build-all` again for the same
   opportunity while a job for it is still `pending`/`running`, **then** the API returns `202`
   with the **existing** `jobId` (no second job, no second OpenAI spend) — unless an explicit
   force flag is passed. Two concurrent owner clicks must not double-spend.
   *Settled by:* a test that inserts a `pending` job then calls the handler and asserts the row
   count for that opportunity is still 1.

4. **Given** an unauthenticated or non-owning caller, **when** they POST `build-all`, **then**
   `401`/`403` and **no job row is created**. (See section E — this is currently a real defect,
   not a hypothetical.)

## B. Status read [from brief]

5. **Given** a `jobId` returned by a 202, **when** the owner
   `GET /api/app/opportunity/{id}/packet/build-status/{jobId}`, **then** the response is `200`
   with a discriminated status in a **closed set**: `pending | running | succeeded | failed`
   (exact set to be fixed in the design; `cancelled` only if cancellation is actually
   implemented — no status value may exist that nothing ever writes).
   *Settled by:* a test enumerating the statuses the writer can produce and asserting the reader
   maps every one of them; a source grep proving no unreachable status literal.

6. **Given** a job in `failed`, **when** the status is read, **then** the response distinguishes
   failure from "still running" **without the client inferring from elapsed time**, and carries
   a human-readable `error` plus which artifact(s) failed. A client must never have to guess.

7. **Given** a job in `succeeded`, **when** the status is read, **then** the body carries the
   same evidence the old synchronous 200 carried (the thing `D31`/`D33` need), or names exactly
   where that evidence now lives. *If the async change silently drops evidence that `D31`/`D33`
   depend on, the change has failed its own purpose.*

8. **Given** a `jobId` that belongs to another owner, **when** it is read, **then** `404`
   (not `403` — do not confirm existence). Ownership is checked on the **status read**, not only
   on create.

## C. Claiming under concurrency [from brief — to be reconciled with `jdSweep.ts`]

9. **Given** two timer ticks running concurrently (the platform CAN overlap invocations), **when**
   both attempt to claim the same `pending` job, **then** exactly one claims it. The claim must be
   a **single atomic SQL statement** (`update ... where status='pending' ... returning`), never
   `select`-then-`update`, and must reuse the locking idiom already in `jdSweep.ts` rather than
   introducing a second scheme.
   *Settled by:* reading `jdSweep.ts` (below) and a concurrency test issuing two claims against a
   local Postgres, asserting exactly one row returned.

10. **Given** the claim succeeded, **when** the build runs, **then** the OpenAI/Docs work executes
    exactly once per job. Double-billing is the failure this criterion exists to prevent, and the
    test must assert a call **count**, not just absence of error.

## D. Crash / wedge / reclaim [from brief]

11. **Given** a worker claims a job and the process dies mid-build (host recycle, deploy, OOM),
    **when** the next tick runs, **then** the job MUST NOT remain `running` forever. There must be
    a named, tested reclaim rule (lease expiry / heartbeat / `claimed_at` age threshold), and the
    threshold must exceed the **measured** worst-case build duration (~3 min today) with margin —
    a reclaim shorter than the build guarantees infinite duplicate builds.
    *Settled by:* a test that sets `claimed_at` beyond the lease and asserts the job is reclaimed;
    plus an explicit statement of the chosen lease value and the measurement it derives from.

12. **Given** a job that has been reclaimed and retried N times, **when** it fails again, **then**
    it moves to a terminal `failed` state — retries are **bounded**. An unbounded retry on a
    deterministic failure is an unbounded OpenAI bill.

13. **Given** a build that partially completed (2 of 4 artifacts) before the crash, **when** it is
    retried, **then** the criteria must state whether completed artifacts are reused or rebuilt,
    and the cost consequence of that choice must be stated, not left implicit.

## E. Ownership / authorization — CURRENT DEFECT [from brief]

14. **Observation (from brief, to verify in source):** `packetBuildAll` loads the opportunity with
    `OPP_FIELDS where id = $1` — **no owner predicate**. An in-process evidence call had to have an
    ownership check added today for exactly this reason.
    **Given** owner A's opportunity id, **when** owner B calls `build-all` with it, **then** the
    request is rejected and no build runs and no job row is created.
    *Settled by:* a test asserting the query text/parameters include an owner predicate, plus a
    live cross-owner call returning 404.

15. Making the build async **must not** be an excuse to defer this. An async job that runs
    unauthenticated work on a background timer is strictly worse than the sync version: the
    attacker's request returns fast and the spend happens out of band.

## F. Idempotency vs `regen` [from brief]

16. **Given** `regen:false` and an existing fresh packet, **when** `build-all` is called, **then**
    the behaviour must be defined *before* the job is created — specifically whether the cache
    check happens **synchronously in the 202 path** (so a cached build can answer immediately)
    or **inside the tick**. If it happens inside the tick, every cached build now costs a full
    poll cycle for zero work — see "WHERE THIS DESIGN IS WRONG".

17. **Given** `regen:true`, **when** a job is already running for that opportunity, **then** the
    interaction between "force regen" and "de-dupe existing job" must be explicit (queue behind,
    reject, or supersede) — not emergent.

## G. `last_build` on `packet` vs the job row [from brief]

18. **Given** `last_build` was just added to `packet`, **when** the job design lands, **then** the
    criteria must state which of the two is the **single source of truth** for build result, and
    the other must be either derived or removed. Two rows describing the same build with
    independent lifecycles is the "numbers disagree" failure the repo CLAUDE.md calls out
    ("Trace every dependent", "Extend, don't duplicate").

## H. What must NOT change [from brief]

19. The four artifacts, their identities and their **content generation** are unchanged — the tick
    calls the **existing** build function, not a reimplementation.
20. The evidence pass still runs and still produces what `D31`/`D33` read.
21. `H:draft-is-written-from-prompts-not-evidence` must still pass unchanged.
22. No new schema statement may reference a column/constraint added by a later idempotent `ALTER`
    (repo CLAUDE.md `H39`/`H39b`), and the schema change is **not verified until executed against
    a populated database that already has main's schema applied** — fresh-DB success proves
    nothing because `create table if not exists` is skipped on the DB that matters.

---

## FINDING 1 — the brief's premise about `jdSweep.ts` is FALSE [verified: api/src/functions/tests/jdSweep.ts, full file, 202 lines]

The brief says: *"Read `jdSweep.ts` first — it already solves 'claim a unit of work without two
workers taking the same one' (look for `backoff_until` and how it locks)."*

**It does not. `jdSweep.ts` contains no claim, no lock, and no concurrency control of any kind.**

Observed, from the source:

- `backoff_until` is a **rate-limit backoff against LinkedIn**, not a lock. It is set only in the
  `res.blocked` branch (lines 119-128) after a 429/quota wall, to an exponential delay
  (`2,4,8,16,32,60` min), and cleared on success (line 137-140). Its comment says so:
  `// 429/quota wall: exponential backoff, DO NOT advance the cursor`.
- The tick's whole state is **one row keyed by a single owner** — `loadConfig().ownerEmail`
  (line 97), i.e. the *global* configured owner, not a per-work-item row. There is exactly one
  cursor (`sweep_index`), and the work item is chosen by `idx = st.sweepIndex % queries.length`
  (line 114) — a modulo of a value that was **read in a separate earlier query** (line 74-77) and
  written back in a **separate later query** (line 137). That is a textbook read-modify-write race:
  two overlapping ticks both read `sweep_index=5`, both run query 5 (duplicate work, duplicate
  spend), both write `6`.
- There is no `for update`, no `skip locked`, no `where status='pending'` guarded update, no
  `returning`-based claim, no lease column, no worker id. `grep` for those in the file returns
  nothing (I checked `backoff_until|for update|skip locked|returning`).
- Why it has survived: the sweep is idempotent-ish and cheap (one LinkedIn query, dedup on insert),
  it runs at most one item per fire, and duplicate work costs a duplicate scrape, not a duplicate
  \$3 OpenAI packet build. **Those mitigations do not transfer to packet build-all.**

**Consequence for these criteria (this is the important part):** "match `jdSweep.ts`, don't invent a
second locking scheme" is **not an available option** — there is no first scheme to match. The
design must introduce the repo's *first* real claim primitive. That is a legitimate "new thing"
under `Extend, don't duplicate`, and the AC below requires it to be stated as such and signed off,
per that rule's escape clause ("state what exists, why it's insufficient, and get explicit sign-off").

**Revised criterion (supersedes #9's "reuse the idiom" clause):**

9a. **Given** the design introduces a claim, **when** it is reviewed, **then** it MUST use a single
    atomic statement of the form
    `update packet_build_job set status='running', claimed_at=now(), worker=$1 where id = (select id from packet_build_job where status='pending' ... order by created_at for update skip locked limit 1) returning *`
    — and the PR must state explicitly that this is a NEW primitive because `jdSweep.ts` has none,
    naming the read-modify-write race at `jdSweep.ts:114` + `:137` as the reason not to copy it.
    *Settled by:* the SQL text in review, plus a two-connection concurrency test on local Postgres
    asserting exactly one of two simultaneous claims returns a row.

9b. **Given** this claim primitive lands, **then** it should be written so `jdSweep`'s cursor race is
    *fixable* by the same idiom later — but fixing `jdSweep` is explicitly **out of scope** for D35
    and must be filed as its own ledger row rather than smuggled into this change.

---

## FINDING 2 — `packet_build_job` ALREADY EXISTS in the schema [verified: api/src/functions/tests/schema.ts:1104-1135, 1173]

The brief proposes "a job row (new table...)". **The table is already written.** `schema.ts`
lines 1116-1135 define `packet_build_job` in full, its D35 rationale comment is already in the
file, and it is already registered in `EXPECTED_TABLES` (line 1173). The design is therefore not
greenfield — part of it has landed and the criteria must be written against **what is there**.

What is there, verbatim:

- columns `id, opp_id (fk→opportunity on delete cascade), owner_email, regen, state, attempts,
  claimed_at, finished_at, result, error, created_at`
- `state text not null default 'pending' check (state in ('pending','running','done','failed'))`
  — note the terminal success value is **`done`**, not `succeeded`. Criterion #5 must use the
  schema's vocabulary; a route that returns `succeeded` while the DB stores `done` is exactly the
  two-vocabularies defect this repo's CLAUDE.md warns about.
- `create index pbj_claim_idx on packet_build_job(state, created_at)` — the claim order.
- **`create unique index pbj_one_live_per_opp on packet_build_job(opp_id) where state in
  ('pending','running')`** — a *partial unique index*. This is a genuinely good decision and it
  already satisfies criterion #3 at the database level rather than in application code: a
  double-click cannot create a second live job because the second `insert` violates the index.

**Criteria this forces (they supersede the "new table" framing in the brief):**

23. **Given** `packet_build_job` already exists, **then** the implementation MUST use it and MUST
    NOT add a second job/queue table or a `packet.build_state` column. (`Extend, don't duplicate`.)
24. **Given** `pbj_one_live_per_opp` is a *unique index violation*, **when** a second build is
    requested for an opportunity that already has a live job, **then** the handler must **catch
    the unique violation (SQLSTATE `23505`) and return 202 with the EXISTING jobId** — not a 500.
    An uncaught `23505` here turns the owner's double-click into a server error.
    *Settled by:* a local-Postgres test inserting twice and asserting the second call's status
    code and returned jobId; and a source grep that the insert is wrapped.
25. **Given** the claim query, **then** it must order by `(state, created_at)` to use
    `pbj_claim_idx`, and must be a single `update ... where id = (select ... for update skip locked
    limit 1) returning *`. The index exists; a claim that does not match it is an unindexed scan.
26. **Given** `state` is CHECK-constrained to four values, **then** no code may write any other
    value, and the status route must map exactly those four. *Settled by:* a test that every
    literal assigned to `state` in `api/src/` is in the CHECK set.
27. **Given** `attempts` and `claimed_at` exist expressly (per the schema comment) so "a job that
    dies mid-build [is] reclaimable rather than wedged in running forever", **then** something must
    actually *do* the reclaiming. **A column is not a mechanism.** The AC is not satisfied by the
    columns existing — it is satisfied by a tested query that moves a stale `running` row back to
    `pending` (or to `failed` past max attempts). See #11/#12.
    *Settled by:* a test that sets `claimed_at = now() - interval '<lease>'` and asserts the tick
    reclaims it; **and mutation-proof it** (per CLAUDE.md "the one step never skipped") by removing
    the reclaim and confirming the test fails.
28. **Given** the `on delete cascade` from `opportunity`, **then** deleting an opportunity mid-build
    silently deletes its job row while a worker may still be running it. The design must state what
    the worker does when its job row vanishes mid-build (it must not resurrect the row, and it must
    not crash the tick for every other job).

## FINDING 3 — `last_build` already mitigates the *reported* symptom [verified: appPackets.ts:749-764, schema.ts:1099]

`packetBuildAll` already writes `packet.last_build` **before** returning (lines 754-764), with the
explicit comment: *"PERSIST THE OUTCOME BEFORE RETURNING IT. The response below is routinely lost…
Written before the return, so a build whose response never arrives still leaves its diagnosis
behind."*

So the `D31`/`D33` evidence-loss half of D35 **is already addressed** by a change that is a handful
of lines and carries no concurrency risk at all. What `last_build` does *not* fix is the owner
seeing a 504 and the ~4-minute wall itself.

29. **Given** `last_build` exists, **when** the job design lands, **then** `result` on
    `packet_build_job` and `last_build` on `packet` must not become two independently-written
    records of the same build. Pick one writer. Concretely: the tick should write `result` and
    `last_build` **in the same transaction from the same object**, or `last_build` should be
    dropped in favour of a join to the latest job. Two writers, two lifecycles, is the
    "numbers disagree" failure. *Settled by:* a grep showing exactly one `update packet set
    last_build` site, and a test that after a build the two agree.
30. **Given** the current `last_build` payload records only `{at, regen, artifacts:[{type,error,
    warnings,qcApplied}]}`, **then** note it does **not** record the `evidence` block
    (`total/evidenced/proposed/escalated/refused`) that lines 782-786 return — which is precisely
    part of what `D31`/`D33` need. If the job's `result` is to be the durable evidence home, it MUST
    include the evidence block. *Settled by:* asserting the persisted JSON contains `evidence`.

## FINDING 4 — the ownership hole is confirmed [verified: appPackets.ts:698, 705, 748]

Confirmed as stated in the brief: line 705 is
`const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [oppId])).rows[0]`
— **no `owner_email` predicate**, while `owner` is resolved separately on line 698 and then used to
scope the evidence pass (line 748 `resolveEvidenceForOpp(client, oppId, owner)`) and the cadence /
outreach self-posts (lines 767-768).

Interpretation (inference, high confidence): `requireWrite(req)` on line 702 means the caller must
hold *a* verified session — so this is not anonymous — but nothing ties that session's owner to the
opportunity's owner. Any signed-in user can spend the model budget building, and writing artifacts
into, another owner's opportunity, and lines 767-768 then send that other owner's `owner` param.
**I did not verify what `requireWrite` checks beyond "a verified session exists" — read
`appSession.ts` to settle whether a second tenant can exist at all today.** If the system is
currently single-tenant in practice, this is latent rather than live, and it should be recorded as
which of those two it is rather than asserted as a breach.

### FINDING 4a — it is worse than "any signed-in user": the path is reachable UNAUTHENTICATED [verified: appSession.ts:44-76 + appPackets.ts:702,705]

I went looking for what would falsify "this is only a latent multi-tenant issue". It is not latent.
Chaining the two functions as they are actually written:

1. `resolveOwner(req)` (appSession.ts:44-64): no `Authorization` header, no `x-uat-token`, no
   `?owner=` ⇒ **`{ owner: 'demo@executive-engine.local', verified: false }`** (line 63).
2. `requireWrite(req)` (appSession.ts:72-76): `if (verified || owner === DEMO_EMAIL) return null`
   ⇒ **returns null, i.e. ALLOWS**, because the owner is the demo email. Its own comment says this
   is deliberate: "a write is allowed when the request is verified OR it targets the shared demo
   workspace (open sandbox)".
3. `packetBuildAll` line 705 then loads the opportunity by **`where id = $1` only** — it never uses
   the `owner` from step 1 to scope that load.

**Therefore: an unauthenticated `POST /api/app/opportunity/{any-uuid}/packet/build-all` with no
headers and no query params passes the write guard as "demo" and then builds artifacts on a
DIFFERENT owner's opportunity** — `von.ellis@enterpriseds.io`'s real production opportunities —
spending OpenAI budget and overwriting that owner's Google Docs/Slides content, at ~3 minutes and
several model calls per call.

The guard is not broken; the *combination* is. `requireWrite` is written on the assumption that
"owner resolves to demo" means "the request will only touch demo data". Line 705 breaks that
assumption by ignoring the resolved owner entirely. Every route that pairs `requireWrite` with an
unscoped `where id = $1` has the same hole.

Note the partial mitigation and why it is not enough: commit `f7b6ebc` ("Carry the ownership check
into the in-process evidence pass") added a check to `resolveEvidenceForOpp` — but that call is at
line 748, **after** the artifact loop at lines 709-718. The money and the document writes are
already spent by the time the checked call runs.

**Observation vs interpretation:** the code chain above is *observed* from the two files. That a
real remote request behaves this way is *inference* (high confidence) — the sandbox cannot reach
`azurewebsites.net`. It is settled by one `api-test.yml` dispatch: POST build-all for a
`von.ellis@…`-owned opp with **no** auth header and **no** `?owner=`, then query
`packet.last_build` for that opp. If it updates, the hole is proven live. **Do that before
believing this write-up — and consider treating the result as embargoed rather than as a
routine ledger note.**

34. **This is a security criterion, not a refactor criterion, and it must be fixed BEFORE or WITH
    the async change — never after.** Async makes it strictly worse: today the attacker at least
    holds the connection open for three minutes; with a 202 the request is free, so the same hole
    becomes a cheap way to burn the owner's model budget in a loop, and `pbj_one_live_per_opp`
    only limits it to one concurrent build **per opportunity** — not per attacker.
35. **Given** the fix, **then** it must cover both halves: (a) add the owner predicate to the
    opportunity load, and (b) decide explicitly whether `requireWrite`'s demo escape hatch should
    keep applying to a route that spends money. Fixing only (a) leaves demo-owned opportunities
    freely buildable by anyone, which may be intended — but it must be a stated decision.
36. **Given** the same pattern may exist elsewhere, **then** before closing this, grep every
    `where id = $1` opportunity/packet/artifact load in `api/src/functions/tests/` that sits behind
    `requireWrite` and list them. Per CLAUDE.md "Fix all consumers, not just the one you found" —
    fixing `packetBuildAll` alone while siblings share the hole is the exact failure that rule names.

31. **Given** the async change touches this exact line, **then** the owner predicate must be added
    in the same change: `${OPP_FIELDS} where id = $1 and owner_email = $2`, returning 404 (not 403)
    on miss. Making the build async **without** this is a strict regression: the spend moves to a
    background timer where the requester never even sees the error.
32. **Given** the job row carries `owner_email`, **then** the tick must load the opportunity with
    **the job's** `owner_email`, not re-resolve from a request (there is no request), and the
    status route must filter `where id=$1 and owner_email=$2`.
33. **Add an H-case** — `H:build-all-scopes-to-owner` — asserting the `OPP_FIELDS` load in
    `packetBuildAll` (and in the tick) carries an owner predicate. Per CLAUDE.md, the mistake
    becomes a test, not a note. Mutation-prove it by removing the predicate.

---

## FINDING 5 — `buildQueue.ts` is already written (uncommitted) — defects found by reading it [verified: api/src/functions/tests/buildQueue.ts, full file, 157 lines; `git status` shows it untracked]

`git status`: `M api/src/functions/tests/schema.ts`, `?? api/src/functions/tests/buildQueue.ts`.
So the queue SQL layer exists on disk, uncommitted, with no route and no timer yet
(`grep packet_build_job api/src app/src` finds only `schema.ts` and `buildQueue.ts`; nothing in
`app/src` and no `build-status` route anywhere). **None of this is committed — per CLAUDE.md
"Commit discipline", it is one container reclaim from being lost.**

It is good work — `for update skip locked` is right, the stale-claim reclaim is right, the
attempt cap is right, `getBuildJob` is owner-scoped. The following are defects in it, ordered by
severity. Each is a criterion the implementation must satisfy.

### 5a. `finishBuild` DISCARDS the result payload on failure — this defeats the purpose of D35

```ts
ok ? JSON.stringify(payload ?? null) : null,     // line 120
```
On `ok=false`, `result` is set to **NULL**. But D35 exists because *the diagnostic evidence for
`D31`/`D33` is being lost*, and a **partial** build (some artifacts built, some threw — exactly the
`results.push({type, error})` branch at `appPackets.ts:717`) is the case where that evidence matters
most. This throws it away precisely when it is most needed, and `error` keeps only 500 characters
of a stringified message. `D33` is about **7,446 discarded characters**; 500 chars of `String(e)`
cannot carry it.

37. **Given** a build that fails or partially fails, **when** `finishBuild` records it, **then**
    `result` MUST still carry the full payload (per-artifact results, warnings, the evidence block)
    **and** `error` carries the summary. Failure and payload are not mutually exclusive.
    *Settled by:* a test asserting `result is not null` after a failed finish, and that a partial
    build's warnings survive. **Mutation-prove it** by restoring the `: null`.

### 5b. `claimNextBuild` head-of-line blocks the ENTIRE queue on one exhausted job

```sql
where j.id = ( select id ... where state='pending' or (running and stale) order by created_at
               for update skip locked limit 1 )
  and j.attempts < $2        -- ← applied OUTSIDE the subquery
```
The subquery picks the **oldest eligible row without consulting `attempts`**. If that row has
`attempts >= MAX_ATTEMPTS`, the outer predicate makes the UPDATE match zero rows and the function
returns `null` — **"queue empty"** — while every newer pending job sits untouched behind it. One
poisoned job silently stops all builds for every owner, and the symptom is "builds just stopped",
with no error anywhere.

`abandonExhausted` can clear it, but **only if the tick calls `abandonExhausted` before
`claimNextBuild` on every fire** — and there is no tick yet, so nothing guarantees that ordering.
Relying on call order in an unwritten file is not a fix.

38. **Given** a job with `attempts >= MAX_ATTEMPTS` is the oldest eligible row, **when** the tick
    runs, **then** a newer pending job MUST still be claimed. Fix at the source: move
    `attempts < MAX_ATTEMPTS` **inside** the subquery's `where`, so the scan skips it rather than
    the update rejecting it. *Settled by:* a local-Postgres test — insert an exhausted stale
    `running` job and a fresh `pending` job, call `claimNextBuild` **without** calling
    `abandonExhausted`, assert the fresh job is returned. That test fails against the code as
    written today; that is the point.
39. **Given** the tick, **then** it must call `abandonExhausted` before `claimNextBuild` *anyway*
    (defence in depth, and it is what marks the job `failed` so the owner sees it), and that
    ordering must be asserted by a test, not left to reading.

### 5c. `finishBuild` is unfenced — a reclaimed zombie can clobber the new worker

`finishBuild` updates `where id = $1` with **no `state='running'` check and no attempt/worker
fence**. The reclaim path exists precisely because a claim can be taken over while the original
worker may still be alive (a hung Google Docs call, a paused host — "silent for 10 minutes" is not
"dead"). When that happens there are two live workers, and whichever finishes **last** wins,
including a zombie writing a stale `done` over a fresh `running` job — or over a `failed` one.

40. **Given** job J is reclaimed by worker B while worker A is still running it, **when** A calls
    `finishBuild`, **then** A's write MUST be rejected. Fence it: `claimNextBuild` already
    increments `attempts` and returns the row, so pass that attempt number back —
    `... where id=$1 and attempts=$2 and state='running'` — and have `finishBuild` return whether
    it actually wrote. A worker whose fence fails must log and **not** retry.
    *Settled by:* a two-connection test simulating claim → reclaim → late finish, asserting the
    late finish updates 0 rows. **Mutation-prove by removing the fence.**
41. **Related:** `STALE_CLAIM_MINUTES = 10` is the *only* thing preventing duplicate concurrent
    builds today. The design must state plainly that the 10-minute lease is a **heuristic, not a
    guarantee**, and that the fence in #40 is what makes correctness independent of it.

### 5d. `enqueueBuild` silently swallows `regen` — a forced rebuild can do nothing

```ts
insert ... on conflict do nothing returning *      // loser gets no row
... select * from packet_build_job where opp_id=$1 and state in ('pending','running') ...
return { job: live.rows[0], created: false }
```
If a job with `regen=false` is live and the owner clicks **Rebuild (regen: true)**
(`PacketBuilder.jsx:646` → `buildAll({ regen: true })`), they receive `created:false` and the id of
the **non-regen** job. The build they asked for never happens; they get the cached one, and the UI
has a jobId to poll so it will report success. This is the repo's "No dead UI" rule failing in its
most deceptive form — a control that appears to work and quietly does nothing.

42. **Given** a live job with `regen=false` and a new request with `regen=true`, **when**
    `enqueueBuild` runs, **then** the outcome must be explicit and owner-visible. Minimum
    acceptable: promote the live **`pending`** job to `regen=true` (it has not started, so this is
    free and correct); for a live **`running`** job, return `created:false` **plus a flag the UI
    renders** ("a build is already running; rebuild will start after it"). Silently returning the
    weaker job is not acceptable.
    *Settled by:* a test for both the pending-promote and running-conflict cases, and the UI
    asserting on the flag.
43. **Given** the reverse (live `regen=true`, request `regen=false`), **then** returning the
    existing job is correct — a superset build is already running. State it so it is a decision.

### 5e. `enqueueBuild` can return `undefined` while its type says it cannot

The `select` after the conflict has no transaction around it. If the live job **finishes between
the failed insert and the select**, `live.rows[0]` is `undefined`, and the declared return type
`Promise<{ job: BuildJob; created: boolean }>` says that is impossible — so TypeScript will not
warn the caller, which will then read `job.id` off `undefined` and 500.

44. **Given** the losing insert, **when** the live job has already completed, **then**
    `enqueueBuild` must retry the insert once (the index no longer blocks it) rather than return an
    absent job. Failing that, the return type must be `{ job: BuildJob | null; ... }` and the route
    must handle null. *Settled by:* a test that deletes/completes the live row between the two
    statements. **The type must not lie** — this is the cheapest of these fixes and the easiest to
    miss in review.
45. **Given** a bad/foreign `oppId`, **then** the FK `opp_id references opportunity(id)` raises
    `23503`, which `on conflict do nothing` does **not** catch — it is not a conflict. The route
    must 404 on an unknown opportunity before inserting, or the owner gets a 500.
    (This is the same check that fixes Finding 4a, which is another reason to do them together.)

### 5f. `STALE_CLAIM_MINUTES` and `MAX_ATTEMPTS` are hardcoded — against a strict repo rule

Both are module constants with no settings path. CLAUDE.md, "No hardcoded config — everything
user-setting driven (strict rule)": *"Before hardcoding ANY behavior-affecting value (… caps,
tiers, thresholds, feature toggles) ask: can the user change this in the UI? If not, either wire it
to a setting first, or get EXPLICIT owner approval to leave it code-only — and record that
approval."*

46. **Given** these two constants, **then** either wire them to the existing owner-settings store
    (`owner_search_prefs` is the precedent — `jdSweep.ts` extends that table rather than adding
    one) **or** record explicit owner approval to leave them code-only. Do not leave this
    undecided. My own view: the lease and the attempt cap are operational, not product, settings —
    approval-to-leave-code-only is the proportionate answer, and it costs one sentence.

### 5g. Nothing prunes `packet_build_job`

Rows accumulate forever, one per build request, each carrying a full `result` JSON. Not urgent,
but it should be a stated decision rather than an omission.

47. **Given** completed jobs, **then** state the retention rule (e.g. the tick deletes `done`
    rows older than N days, keeping `failed` for diagnosis) or record that unbounded growth is
    accepted for now.

### 5h. The unauthenticated hole flows straight into the queue, and gets an information leak

`enqueueBuild` takes `owner` from the caller and never checks it against `opportunity.owner_email`.
Chained with Finding 4a: an unauthenticated caller resolves to `demo@…`, a job row is written with
`owner_email='demo@…'` against **von.ellis's** `opp_id`, and `getBuildJob(jobId, 'demo@…')`
then **passes its owner check** — so the attacker can read the full `result` payload of a build of
someone else's opportunity. `getBuildJob`'s owner scoping is correct in itself; it is scoped to the
*job's recorded* owner, which the attacker chose.

48. **Given** any enqueue, **then** the opportunity must be loaded `where id=$1 and
    owner_email=$2` **before** the job row is created, so `packet_build_job.owner_email` can never
    disagree with `opportunity.owner_email`. *Settled by:* a test asserting a cross-owner enqueue
    creates no row; and consider a DB-level guarantee (composite FK to `opportunity(id,
    owner_email)`) so it cannot drift — **but if you do, heed CLAUDE.md `H39`: a composite FK needs
    a matching UNIQUE target, and the last time that was added without one it aborted the whole
    migration.** Execute it against a populated DB before believing it.

---

## WHERE THIS DESIGN IS WRONG

Blunt, after reading the source. Two of my four pre-code suspicions were **wrong** and I say so.

### 1. The 60-second timer latency is real, and it is the design's worst everyday property

`jdSweepTick` is `0 */1 * * * *` — one minute. If `packetBuildAll` returns 202 and a 1-minute tick
picks the job up, the owner waits **0-60s (p50 ~30s) with nothing happening at all**, then ~3
minutes of build. Worse than the raw number: during that first minute the UI has a jobId, a
`pending` state, and literally nothing to show — no artifact moving, no progress. The current
broken behaviour at least *starts working immediately*.

And it compounds with the retry design: a crashed job waits `STALE_CLAIM_MINUTES = 10` before
reclaim, then up to another 60s for a tick. A build that dies at minute 3 finishes, if at all,
around minute 17.

**Mitigation, and it is cheap:** run the tick more often than once a minute — Azure Functions cron
supports seconds (`*/15 * * * * *`). The work is gated behind a claim, so an idle tick is one
indexed query against `pbj_claim_idx`. Every-15-seconds cuts the worst case to 15s for the cost of
four cheap queries a minute. **The proposed 1-minute cadence is copied from `jdSweep`, where the
minute is meaningful (it paces LinkedIn requests) — here it paces nothing and is pure latency.**
Do not inherit a number just because the neighbouring file has it.

### 2. A timer is the wrong trigger — and the repo already has the right one, twice

This is my main objection to the shape. A timer converts "start this now" into "start this
eventually", and the only reason to accept polling latency is if nothing can push. Something can.

- **Azure Storage Queues + `app.storageQueue` trigger.** The Function App already has
  `AZURE_STORAGE_CONNECTION_STRING` (CLAUDE.md lists it as a synced secret) and a storage account
  (`n8nstxpdthydai6fkm`). A queue trigger fires within ~seconds of the message landing, and — this
  is the part that matters — **Azure Queues already provide the exact primitives this design is
  hand-rolling in SQL**: visibility-timeout leases (`STALE_CLAIM_MINUTES`), automatic dequeue-count
  retry limits (`MAX_ATTEMPTS`), and a poison queue (`abandonExhausted`). Every defect in Finding 5b,
  5c and 5f is a re-implementation bug in machinery the platform ships.
- Against it: it is a second piece of infrastructure to reason about, the DB row is still wanted
  for the owner-visible status read, and a queue message plus a job row is two sources of truth
  unless carefully done. That is a real cost and it may still be the wrong trade for a
  single-owner product — but **it must be a decided trade-off, not an unconsidered one**, and the
  brief's framing ("a timer tick claims pending jobs") presents the timer as settled.

**My recommendation:** keep `packet_build_job` as the status/result record (the owner needs to
query it), and let the timer be the **fallback sweeper** rather than the primary trigger — which is
also exactly what the org rule "Prefer event-driven signals over fixed-interval waits" says: the
push signal is primary, the fixed interval covers what push cannot.

### 3. My pre-code guess about `regen:false` was WRONG — the cache does not make async pointless

I expected `regen:false` to be a fast cache hit that async would penalise. It is not.
[verified: `appPackets.ts:470-476`, `344-368`]

`buildTemplatedArtifact` = `ensurePackage(...)` **then `renderArtifact(...)`, unconditionally**. The
cache in `ensurePackage` (line 365) only skips the **OpenAI generation**; `renderArtifact` still
does the Google Drive template copy + placeholder fill for **every artifact on every call**. So a
`regen:false` build is not milliseconds — it is four Drive round-trips, easily tens of seconds, and
the 3-minute measurement was itself taken on this path or one like it.

**So the cache does not make async pointless. That objection is withdrawn.** But it does supply a
sharper criterion:

49. **Given** the common `regen:false` path still costs four Drive writes, **then** the design
    should ask whether `renderArtifact` should *also* be skipped when nothing changed (the package
    is cached AND the artifact already has a `doc_url`). **That would be a bigger win than async
    for the common case** — a genuinely cached rebuild could return in under a second and never
    need a job at all. It is out of scope for D35, but it should be a ledger row, because it
    changes what fraction of builds need the queue at all.

### 4. My pre-code guess that "raise the gateway timeout" might work is also WRONG — but the alternative I found is real

**Observation:** `api/host.json` contains **no `functionTimeout`** at all, and `jdSweep.ts:19-21`
states the plan in prose: *"the Consumption (Y1 Dynamic) plan"* and *"would blow the 10-min cap"*.

**Interpretation (inference, high confidence — NOT proven from the platform):** the ~4-minute cut is
the Azure front-end/load-balancer **idle timeout of 230 seconds**, which applies to all HTTP
requests through App Service/Functions and is **not configurable by any app setting**. 230s = 3m50s,
which matches the measured 504 far better than any function-timeout value would. Raising
`functionTimeout` would not help, because the function was never the thing that gave up — the
evidence proves this outright: **the work finished** (02:31:50) and the 504 came from in front of
it (02:31:51).
*Settles it definitively:* the plan SKU (`az functionapp show --query sku`) plus whether the failing
response carries the load balancer's signature. Do that before quoting 230s as fact.

**But the corollary is the alternative worth taking seriously: 230s is an *idle* timeout.** It is
reset by bytes on the wire. A response that **streams** — a chunked/NDJSON body emitting a line as
each of the four artifacts completes — never idles for 230s, because the gaps between artifacts
were measured at 68s, 43s and 57s (02:29:02 → 02:30:10 → 02:30:53 → 02:31:50). All comfortably
under any idle limit.

Against streaming: it holds a Consumption worker for the full 3 minutes (billed GB-s — the very
thing `jdSweep.ts:19-22` was designed to avoid), it dies with the host and cannot be resumed, it
gives the owner nothing if they navigate away, and it needs the 10-minute Consumption function cap
to stay above the build duration forever. **It is a smaller change that fixes the reported symptom
and gives live progress; it is a worse foundation.** Name it in the ledger and reject it
deliberately.

### 5. THE SMALLEST FIX — and it is already half-shipped, so measure before building anything

This is the one I would push hardest, and it is the reason to pause before committing to the queue.

**The build already succeeds. Only the answer is lost.** And commit `99715f3` ("Persist the build
outcome, because the gateway eats the response that carries it") already writes `packet.last_build`
**before** the return (`appPackets.ts:749-764`). So the durable record exists *today*.

Which means the entire owner-visible symptom — "shows the owner a failure on a build that
succeeded" — is fixable by roughly this much frontend code in `PacketBuilder.jsx:392`:

> on a network error / 502 / 504 from `buildFullPacket`, **do not toast "Build failed"**. Call
> `load()` and read `last_build`; if it shows four artifacts with urls, report success.
> `pollVideo` (`PacketBuilder.jsx:~402`) is already the polling idiom to copy.

That is one screen, no schema, no concurrency, no lease, no fencing, no new failure modes — and it
also unblocks `D31`/`D33`, because their evidence is in `last_build` already (modulo criterion #30:
the evidence block is not persisted yet — **that gap is ~5 lines**).

**What it does not fix:** the owner still waits 3 minutes with a spinner; a build that genuinely
exceeds the function cap still dies; and if the *host* recycles mid-build (as opposed to the
gateway timing out) `last_build` is never written and there is no record at all.

**So my honest read of the priority order:**
1. **Fix Finding 4a (the unauthenticated cross-owner build).** Unrelated to async, more serious
   than async, and the async change makes it worse. Do it first, on its own, with its H-case.
2. **Persist the evidence block into `last_build` (#30) and make the client 504-tolerant (#5 above).**
   Small, reversible, closes the owner-visible symptom and unblocks `D31`/`D33` — the two things
   the brief says are actually blocked — **without any of the concurrency surface in Finding 5.**
3. **Then decide whether the queue is still needed**, with the symptom already gone and the
   question reduced to "do we want progress visibility and crash resilience?" — which is a
   product question, answered calmly, not under the pressure of a red 504.

The queue is not wrong. It is **more machine than the measured problem currently requires**, and it
is being built at a moment when a genuine authorization hole in the same handler is open. `D35`'s
own ledger text says *"The work completes; only the answer is lost."* Fix the lost answer first.

If the queue does proceed, it should proceed **with `buildQueue.ts` committed** — it is untracked
right now (`?? api/src/functions/tests/buildQueue.ts`), which per CLAUDE.md's commit discipline is
one container reclaim from being lost work.

---

## Sibling-hole confirmation (predicted by #36, then found) [verified: appPackets.ts:493]

`artifactDocument` loads `const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [art.opp_id]))`
— **the same unscoped load, behind the same `requireWrite`** (line 487), reached via an
`artifactId` rather than an opp id. So Finding 4a is not one line in one handler; it is a pattern.
Criterion #36 stands and is now evidenced rather than speculative: sweep them all, fix them
together, and let the H-case assert the invariant across handlers rather than at one call site
(CLAUDE.md H-case rule 1: "assert the invariant, not the incident").

---

## Tiering note (CLAUDE.md "Match the process to the risk")

- The **authorization fix (Findings 4/4a, #31-36, #48)** is tier 1 by consequence even though it is
  not a scoring path: it admits an unauthenticated caller to a money-spending, document-overwriting
  operation on another owner's data. Full process, independent verifier, live proof.
- The **queue itself (Finding 5)** is tier 2 — ordinary logic, no gate, no score. Implement, test,
  and **mutation-prove each new guard** (the one step never skipped): #37 partial-result retention,
  #38 head-of-line, #40 the finish fence.
- This AC document is tier 3 prose.


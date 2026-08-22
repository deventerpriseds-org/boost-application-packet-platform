# Independent Verification — async packet build + auth hole (D35)

Verifier agent. No shared context with the implementing session.
Repo: /home/user/boost-application-packet-platform
Local HEAD = origin/main = `de18e35` (verified via `git fetch origin` + `git log`).
Commits under test: 6050fff, 96e2f06, ca83b00, e47c8fd — all confirmed ancestors of main.

Status: IN PROGRESS — appended as evidence lands.

---
## Claim 4(a) — the auth hole WAS real at parent commit f7b6ebc. **CONFIRMED.**

Ground truth = the code at `f7b6ebc`, read directly:

`git show f7b6ebc:api/src/functions/tests/appPackets.ts` → `packetBuildAll` (line 695):
```ts
const guard = requireWrite(req); if (guard) return guard
...
const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [oppId])).rows[0]
if (!opp) return { status: 404, ... }
const { pkt, artifacts } = await loadPacket(client, oppId)
```
- `OPP_FIELDS` (line 294) = `select ... from opportunity` — **no owner_email column selected and no
  owner predicate appended**. The only predicate is `where id = $1`.
- `loadPacket(client, oppId)` (line 67) is likewise `where opp_id = $1` with no owner term, and it
  *inserts* a packet row if none exists.
- `requireWrite` (appSession.ts:72-76) returns `null` (allow) when `verified || owner === DEMO_EMAIL`.
  `resolveOwner` (line 63) falls through to `req.query.get('owner') || DEMO_EMAIL`. A request with
  **no Authorization header and no `?owner=`** therefore resolves to `demo@executive-engine.local`,
  which `requireWrite` waves through.

Both halves of the hole are present and they compose. Anyone holding an opportunity UUID could POST
`/api/app/opportunity/<uuid>/packet/build-all` with zero credentials and drive a full four-artifact
Google Docs/Slides build against another owner's packet. The claim is not overstated.

---
## Claim 3 / Claim 2 — the job row, read from the live DB. **PARTIAL — job was still `running`.**

db-query run **32550540380** (job 96976442541), `SELECT ... FROM packet_build_job ORDER BY created_at DESC LIMIT 10`,
executed 2026-08-22T04:00:44Z. Raw row (the ONLY row in the table):

```
id         945e28ed-8b2d-4b60-ab20-1ebd58d369a4
opp_id     9f9c370a-4ac9-441e-b58e-02e3ffcf669e
owner      von.ellis@enterpriseds.io
state      running        <-- NOT done
regen      t
attempts   1
created_at 2026-08-22 03:57:41.970986+00
claimed_at 2026-08-22 03:58:00.081997+00
finished_at (null)   error (null)   has_result f
```

Observations:
- jobId `945e28ed-8b2d-4b60-ab20-1ebd58d369a4` matches the id the implementing session reported. Real row, real owner scoping.
- claimed_at - created_at = **18.111 s**. The "claimed 18s after creation" number is exact.
- At 04:00:44 (2m 44s in) the job had NOT reached `done`. **Claim 3 is unproven so far** — continuing to poll.

### Doubt raised on the wake-signal claim (claim 2) — 18s is not "about a second"
`buildSignal.ts` line 23 asserts "the host delivers it in about a second". Measured delivery was 18s.
More concerning: `claimed_at` is `03:58:00.081` — **81 ms past a whole-minute boundary**, which is
the signature of a *timer* firing, not of a queue message sent at 03:57:41.97. Investigating whether
the claim was made by `buildQueueWorker` (queue) or by a timer. See below.

---
## Claim 1 — 202 + jobId returned immediately. **CONFIRMED.**

api-test run **32550396585** (job 96976077799, head_sha e47c8fd), raw log:
```
API_PATH: /api/app/opportunity/9f9c370a-.../packet/build-async?owner=von.ellis@enterpriseds.io
API_BODY: {"regen":true}          API_OMIT_AUTH: false
03:57:42.1210  HTTP 202 POST https://job-platform-api.azurewebsites.net/api/app/.../packet/build-async?owner=...
{ "jobId": "945e28ed-8b2d-4b60-ab20-1ebd58d369a4", "oppId": "9f9c370a-4ac9-441e-b58e-02e3ffcf669e",
  "state": "pending", "regen": true, "created": true, "promoted": false, "regenPending": false,
  "note": "Build queued." }
```
Timing: workflow step began 03:57:41.54; the job row's `created_at` is 03:57:41.971; the 202 was
logged at 03:57:42.121. **Sub-second**, against a route that previously held the connection ~3 min
and died at the ~230 s gateway cut. The whole `call` job ran 03:57:40 → 03:57:44 (4 s).

### Response shape vs what the UI actually reads — **matches.**
`app/src/screens/PacketBuilder.jsx` `buildAll()` reads `r.error`, `r.note`, `r.jobId`, `r.state`;
`pollBuild()` reads `s.error`, `s.state`, `s.done`, `s.result?.artifacts[].url`. The API returns
`jobId/state/note` on the 202 and `state/done/result/error` from `packetBuildJobRead`
(appBuildJobs.ts:96-104). Every field the UI reads exists. Two details that could have broken it and
did not:
- `app/src/api.js:72` `post()` rejects on `!res.ok`. **202 is within `res.ok` (200-299)**, so the
  non-200 success code does not throw. Verified by reading the helper, not assumed.
- `api.buildJob` (api.js) sends `?owner=${_owner}`, which `getBuildJob`'s owner predicate requires.

Caveat on strength of evidence: the 202 body is **byte-identical between commit 6050fff and e47c8fd**
(`git show 6050fff:...appBuildJobs.ts` — same jsonBody literal), so this run's body proves the route
is async but does NOT by itself prove which of the two deployed versions served it. That matters for
claim 2 below.

---
## Claim 4(b) part 1 — the synchronous route is now owner-scoped. **CONFIRMED (code).**

`api/src/functions/tests/appPackets.ts:758` (on main), inside the extracted `runPacketBuild`:
```ts
const opp = (await client.query(`${OPP_FIELDS} where id = $1 and owner_email = $2`, [oppId, owner])).rows[0]
if (!opp) return { status: 404, body: { error: 'opportunity not found' } }
```
vs `where id = $1` at f7b6ebc. `packetBuildAll` delegates its whole body to `runPacketBuild`, so the
sync route and the queue worker share the one predicate — extended, not duplicated.

### Defect found (documentation, not behaviour)
`api/src/functions/tests/buildQueue.ts:231-232` still asserts, in the present tense:
> "`build-all` loads its opportunity with no owner predicate at all"
That is **false as of 6050fff** — the same commit that wrote the comment also added the predicate.
Stale prose describing a closed hole as open. No runtime impact; worth a one-line fix.

---
## Claim 4(b) part 2 — LIVE proof the hole is closed. **CONFIRMED on production.**

api-test run **32550743870** (job 96976946976), `omit_auth: true`, and deliberately **no `?owner=`** —
which is the *exact* attack shape, because with no owner param `resolveOwner` returns
`demo@executive-engine.local` and `requireWrite` therefore ALLOWS the request. Raw log:
```
API_PATH: /api/app/opportunity/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/packet/build-async
API_BODY: {"regen":true}          API_OMIT_AUTH: true
omit_auth=true -> sending NO Authorization header (testing the reject path)
04:05:03.4457  HTTP 404 POST .../packet/build-async
{ "error": "opportunity not found" }
```
This is the strong form of the test. The request got **past** `requireWrite` exactly as it did before
the fix, and was stopped by `enqueueBuild`'s new `and owner_email=$2` predicate instead. The
Actions run is red (`exit 1` on status >= 400) — expected for a reject-path test, not a failure.

Note the 404-not-401 is deliberate and correct: `packetBuildAsync` (appBuildJobs.ts:64) collapses
"foreign id" and "unknown id" into one 404 so the response does not leak which opportunity UUIDs exist.

### The three artifact routes now go through `loadOwnedArtifact`. **CONFIRMED.**
`grep -rn loadOwnedArtifact api/src/functions/tests/` → definition at appPackets.ts:311, and exactly
three call sites: **197 (`artifactGenerate`), 513 (`artifactDocument`), 593 (`artifactSlides`)**.
Each is preceded by `requireWrite` and followed by `if (!art) return 404`. The loader itself:
```sql
select a.*, p.opp_id from artifact a
  join packet p on p.id = a.packet_id
  join opportunity o on o.id = p.opp_id
 where a.id = $1 and o.owner_email = $2
```
The subsequent `${OPP_FIELDS} where id = $1` in each route uses `art.opp_id`, which is only reachable
through that owner-scoped join, so it is not a second hole.

---
## Claim 5 — the tests are real, and SIX mutation proofs. **CONFIRMED.**

Local PostgreSQL 16.13 booted (`/usr/lib/postgresql/16`). Baseline, `node --test --test-force-exit`:
```
buildQueueDb.test.mjs + buildSignal.test.mjs
# tests 16   # pass 16   # fail 0   # skipped 0
```
**`skipped 0` is the load-bearing number.** Both files guard with `{ skip: !HAVE_PG && 'no PostgreSQL' }`,
so a container without a cluster would report 16 green skips. It did not — every DB test executed.

Mutation proofs. Each: reinstate the defect in the `.ts`, rebuild, run, restore, verify `git diff` clean.

| # | Defect reinstated | Result |
|---|---|---|
| 1 | `enqueueBuild`: drop `and owner_email=$2` from the opportunity load | **FAIL** `not ok 10 H:enqueue-is-owner-scoped` — *"a cross-owner build was queued"*. 10 pass / 1 fail |
| 2 | `getBuildJob`: drop `and owner_email=$2` | **FAIL** `not ok 5 H:job-read-is-owner-scoped`. 15 pass / 1 fail |
| 3b | `finishBuild`: remove the fence (`and attempts=$5 and state='running'`) + its param | **FAIL** `not ok 7 H:zombie-worker-cannot-clobber-a-reclaimed-build`. 15 pass / 1 fail |
| 4 | `finishBuild`: `result = null` whenever `ok` is false | **FAIL** `not ok 8 H:failed-build-keeps-its-evidence`. 15 pass / 1 fail |
| 5 | `claimNextBuild`: move `attempts < $2` OUT of the subquery into the outer WHERE | **FAIL** `not ok 6 H:poisoned-job-does-not-block-the-queue`. 15 pass / 1 fail |
| 6 | `encodeBuildSignal`: return raw `JSON.stringify(sig)` instead of base64 | **FAIL** `not ok 12 H:build-signal-is-base64`. 15 pass / 1 fail |

Five of the six failed **exactly one** test — the guards are precise, not blanket.

**Honest note on a discarded first attempt.** My initial mutation 3 removed the fence predicates but
left `attempt` in the parameter array, so Postgres rejected the statement for parameter-count and
**four** tests failed. That proved nothing about the fence — it proved the query was malformed. I
redid it as 3b (removing the param too), which is a genuine unfenced `finishBuild`, and only the
fence test failed. Reporting the discarded attempt because a mutation that fails for the wrong
reason is not a mutation proof.

Tree restored: `git status --short` shows only `.claude/ac/async-build-verification.md`; re-run after
restore is 16/16 pass, 0 skipped.

---
## Claim 3 — "reaches `state: done` with artifacts and an evidence block". **FALSE AS STATED.**

Ground truth, db-query job 96977884856 at 2026-08-22T04:13:18Z, on job 945e28ed:
```
 t                             | state  | attempts | secs | err                                                                     | arts | evidence                                                                   | touched
 2026-08-22 04:13:18.283722+00 | failed |        2 |  196 | Packet built with 42 warning(s) across 4 artifact(s). Nothing was sent. |    4 | {"total":10,"refused":0,"proposed":5,"escalated":8,"evidenced":6}          |       4
```
- **`state` is `failed`, not `done`.** The claim is wrong on its central word.
- It *does* carry 4 artifacts and a real evidence block — so the "payload is kept on failure" design
  is vindicated in production. But that is a different claim from the one made.
- `attempts = 2`: the job was claimed twice.

### What actually happened, reconstructed from the row (Observation vs Interpretation)
**Observed:** claimed 03:58:00 (attempt 1); at 04:13:18 attempts=2 and `finished-claimed = 196 s`,
which places attempt 2's claim at ~04:10:02.
**Interpretation (high confidence, not proven — the Function App's Application Insights is not
reachable from this sandbox):** attempt 1 ran from 03:58:00 and never finished. `STALE_CLAIM_MINUTES`
is 10, and the 5-minute sweep (`0 */5 * * * *`) fires at :00/:05/:10 — 04:10:00 is the first sweep at
which the 03:58:00 claim was older than 10 minutes, which matches ~04:10:02 exactly. `host.json` sets
`functionTimeout: 00:10:00`, so attempt 1 was almost certainly killed by the host timeout at ~04:08.
**The sweep did exactly the job it was demoted to do** — it recovered a worker that died mid-build.
That part of the design is confirmed by production behaviour.

### DEFECT (regression introduced by these commits): a build that WROTE ALL FOUR DOCUMENTS is reported to the owner as a FAILURE

This is not a nitpick — it is the exact failure D35 was created to eliminate, relocated from the
gateway into the `ok` computation.

Chain, read from source:
1. `packetBuild.ts:72` — `summariseBuild` returns `ok: !failed.length && !warned.length`.
   **Any warning on any artifact makes `ok` false, even with zero failures.**
2. `appBuildJobs.ts:132` — `ok = out.status===200 && out.body?.ok===true && !out.body?.error`;
   `if (!ok) error = out.body?.error || out.body?.note || ...`
3. `finishBuild(..., ok=false, ...)` → **`state = 'failed'`**, `error` = the *success-shaped* note.
4. `PacketBuilder.jsx` `pollBuild`:
   `if (s.state === 'done') toast('Built N documents — nothing sent')`
   `else toast('Build failed after N documents: ' + s.error)`

So the owner is shown, verbatim:
> **"Build failed after 4 documents: Packet built with 42 warning(s) across 4 artifact(s). Nothing was sent."**

A self-contradictory message on a build that succeeded — and the stated motivation for D35 is that
"the owner is shown a failure on a build that succeeded, so they press the button again and pay for
it again."

**This is a REGRESSION, not a pre-existing condition.** `summariseBuild`'s `ok` semantics are older,
but before 96e2f06 the UI did:
```js
const r = await api.buildFullPacket(...)
if (r.error) throw new Error(r.error)          // body has no `error` key on a warning-only build
toast(`Built ${...} documents — nothing sent`)  // <-- old UI reported SUCCESS
```
`ok:false` was never read by the old UI. 96e2f06 routes the same condition through job state, where
`ok:false` becomes `state:'failed'` and a "Build failed" toast. **The old path said success; the new
path says failure, on identical build output.**

Fix direction (not applied — I do not modify source): the queue's notion of failure should be
`summary.failed > 0` (an artifact that did not build), not `!summary.ok` (which folds in warnings).
Warnings already have a home in `result.warnings`.

---

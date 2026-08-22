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

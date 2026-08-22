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

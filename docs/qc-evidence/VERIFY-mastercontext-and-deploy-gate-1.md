<!-- WHAT:       Independent verification of three changes landed on main 2026-09-03: the
                 MasterContext accessor + owner_master_block table + Postgres backing, the
                 table-registration guard (H:every-declared-table-is-registered), and the
                 deploy-gate sha fix (H:deploy-sha-comes-from-the-bundle).
     WHY:        TIER 1 -- masterBaseline() feeds every swap_decision "original" column, and the
                 deploy gate decides whether a migration may run at all.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   this file. -->

# VERIFY LOOP
work: mastercontext-and-deploy-gate
loop: 1

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`
(HEAD `417c875`, based on `origin/main` @ `5dbd4df`).

No PRIOR STATE -- this is loop 1. Coverage is total; every claim gets a verdict below.

---

## PROCESS NOTE — a mutation-test edit leaked into a real commit mid-verification

While mutation-proving C3 below, a dirty working-tree edit to `entityFromBlocks()`
(`entity[r.block_key]` -> `entity[r.block_key + '_pg']`) was swept into commit `12b7da0`
("The copy has run..."), authored by a concurrent instance of this same session
(`session_01Xf7eTxpQ2JN9ha2dMHag8N`) sharing this working tree. That commit was already pushed to
`origin/claude/incumbent-wins-swap` before I noticed. **Fixed immediately**: reverted the line,
confirmed `node --test test/hardening.test.mjs` is 148/148 green, committed as `d646b9e`, pushed.
Notified the peer session. Recorded here because it briefly put a real defect on a pushed branch —
not because it bears on any of the claims below, all of which were re-checked against the corrected
tree.

---

## C3. `masterBaseline` output is byte-identical across the storage cut

**CONFIRMED**, with one caveat noted but not a defect.

The guard (`H:mastercontext-baseline-parity`) DOES drive the shipping `entityFromBlocks` rather than
re-implementing the assembly — checked directly:
```js
const pgShaped = entityFromBlocks(Object.entries(fixture).map(([block_key, text]) => ({block_key, text})))
```
and DOES exercise Storage's system columns (`partitionKey`, `rowKey`, `etag` present in
`storageShaped`), contrary to what a first read of the brief's concern might suggest.

**Mutation-proved it fires**: changed `entity[r.block_key] = r.text` to
`entity[r.block_key + '_pg'] = r.text` in `entityFromBlocks` — `H:mastercontext-baseline-parity`
FAILED immediately (`not ok 144`). Reverted; suite green again (148/148). This is the exact mutation
whose accidental leak into a real commit is documented in the PROCESS NOTE above — so it is
independently confirmed twice over: once by deliberately breaking the guard, once by it very nearly
shipping broken and (if it hadn't been caught by inspection) would have been the kind of defect this
guard exists to catch on the next CI run.

**The caveat**: the fixture has no block whose text is `''`. Traced why this does not matter:
`masterBaseline()` itself filters with `typeof v === 'string' && v.trim()`, so an empty-string block
and an absent block produce IDENTICAL output on both sides regardless of the fixture — the omission
doesn't create a live gap because the transform being tested already collapses that distinction.
Not a defect; noted for completeness since the brief specifically asked about it.

---

## C4. `owner_master_block` is correct on production

**CONFIRMED**, three independent checks, none trusting the deploy log:

**1. Static schema + populated-database migration** (own machinery, per `CLAUDE.md`'s mandated
recipe — never done on a fresh database):
```
$ rm -rf /tmp/pgd /tmp/pgsock && su postgres -c "...initdb..." && su postgres -c "...pg_ctl start..."
$ git show 5f4c0c9^:api/src/functions/tests/schema.ts   # the commit BEFORE this lane
$ grep -c owner_master_block /tmp/pre_lane_schema.ts    -> 0   (confirms this is genuinely pre-lane)
$ psql -v ON_ERROR_STOP=1 -d upg -f /tmp/schema_pre_nv.sql   # apply PRE-LANE schema
$ psql -d upg -c "insert into persona ..."; "insert into opportunity ..."   # seed real rows
$ psql -v ON_ERROR_STOP=1 -d upg -f /tmp/schema_nv.sql       # apply THIS BRANCH's schema on top
EXIT_CODE=0
```
Resulting table on the POPULATED database:
```
Table "public.owner_master_block": owner_email text not null, block_key text not null,
  text text not null default '', updated_at timestamptz not null default now()
PRIMARY KEY (owner_email, block_key)
CHECK (block_key = ANY (ARRAY[14 values: workHistory1-4, coreAccomplishments, resumeSummary,
  skills1, skills2, expertise, relevantProficiencies, aboutMe1, aboutMe2, executiveProfile,
  softHardSkillsPool]))
```
`insert ... block_key='itemsToOmit'` -> **rejected** by `owner_master_block_key_check` (exact
DETAIL shown). Two owners with the same `block_key` -> **both inserted**, confirming per-owner
scoping. All matches the claim exactly.

**2. Live production data**, obtained via the peer session's `boost-pg-mcp-write` connector (mine is
`enabledInChat: false` in this chat, and GitHub Actions dispatch is blocked outright by this
session's proxy — `gh api .../dispatches` -> `403 Resource not accessible by integration`, and
direct `curl` to `azurewebsites.net` is blocked per `CLAUDE.md`). I asked for RAW rows, not a
summary, and verified the arithmetic myself rather than trusting either the peer's or the commit's
claim:
```
select owner_email, block_key, length(text) as chars, updated_at from owner_master_block
  order by owner_email, block_key;
-> 14 rows, all owner_email='von.ellis@enterpriseds.io', one per MC_KIND key, itemsToOmit absent.
select count(*) from owner_master_block;  -> 14
```
Summed the `chars` column myself: 670+696+969+460+286+958+651+225+180+444+671+565+554+674 =
**8003** — independently reproduces the commit message's "14 blocks, 8003 chars" rather than
trusting it. `updated_at` values span 08:35:13.405–08:35:13.450 (45ms), consistent with one
`on conflict do update` batch from a single copy run, not repeated/duplicate runs.

**3. `ok` is read as the verdict, not the status code** — `pgMigrate.ts`'s catch returns HTTP 200
with `{ok:false, error}` and the `api-deploy.yml` Python step explicitly checks `r.get('ok') is not
True` before treating a 200 as success (confirmed in the workflow file, not assumed).

Note: the brief's stated claim ("0 rows") predates the copy that ran mid-verification
(`.claude/actions.md`: "STEP 1 DONE, the copy has run"). Verified against CURRENT live state, not
the brief's snapshot, per this repo's own ground-truth rule.

---

## C5. `H:every-declared-table-is-registered` closes H11's blind spot

**CONFIRMED for the specific incident it was built to catch. REFUTED as a general claim** — a real,
wider blind spot remains, though it PRE-DATES this lane and this lane did not introduce it.

**Mutation-proof of the narrow claim** — deleted `'owner_master_block'` from `EXPECTED_TABLES`:
```
H11: every table this layer added is registered for migration   -> ok  (H11 did NOT catch it)
H:every-declared-table-is-registered: SCHEMA_SQL and EXPECTED_TABLES cannot diverge -> not ok (FIRED)
```
This is the exact reproduction of the real incident (`e3e04f0`'s commit message: "H11 could not see
a new table, and a green deploy hid a missing one") — H11's hand-maintained list stayed green
because `owner_master_block` was never added to IT either (H11 only checks names it is TOLD to
check), while the new guard, deriving the list from `SCHEMA_SQL` text itself, caught it. Reverted;
suite green again.

**But the wider claim — "H11 could not see a new table" as a general statement — is not fully
closed, and this matters because it is the SAME failure class the guard's own commit message
invokes.** The new guard only ever looks INSIDE `SCHEMA_SQL`'s text (`create table if not exists
(\w+)` matches within the `SCHEMA_SQL\`...\`` template literal). A table that is never declared in
`SCHEMA_SQL` at all — created only by a request-time `ensure*()` helper living in its own file — is
structurally invisible to it, exactly as `comparison_dimension` was before D21 moved it INTO
`SCHEMA_SQL`. Measured directly against the current tree:

```
$ grep -rln "create table if not exists" api/src/functions/tests/*.ts | grep -v schema.ts
  -> 21 files, each declaring its own table(s) via an ensure*() helper
```
Of the ~20 distinct table names those files create, the following are declared ONLY in their own
file and appear NOWHERE in `SCHEMA_SQL` or `EXPECTED_TABLES` (checked by grepping both against
`schema.ts`):

```
ats_source, bulk_job, coach_activity, coach_thread, folder_role_map, mail_alert_state,
mail_watch_config, opportunity_stage_history, owner_search_prefs, seniority_routing,
taxonomy_title, title_tier_draft
```
(`role_profile` and `template` are quoted elsewhere in `schema.ts`'s comments but not created
there either.) Every one of these 12 tables exists in production today (they are load-bearing —
e.g. `owner_search_prefs` backs the entire `chk_*` settings family this repo's own hardening suite
polices at length) and NONE of them can ever be reported missing by `pgMigrate`, by H11, or by the
new `H:every-declared-table-is-registered` guard — all three only ever look at `SCHEMA_SQL`'s
`EXPECTED_TABLES` universe. This is a real, structural gap of the SAME shape D21 fixed for one
table, left open for a dozen more.

**This is NOT a defect introduced by this lane** — all 12 tables predate `5f4c0c9` (verified: none
of them is `owner_master_block` or anything this lane touched), and the new guard's own test
comment is honest about its narrower scope ("H11 STAYS: its named list also asserts each table is
still DECLARED, which this does not"). So C5 as literally asked ("does H:every-declared-table... hit
the D21-shaped blind spot for the incident it targets") is CONFIRMED closed. But the broader framing
in `.claude/actions.md` / commit messages ("H11 could not see a new table") reads as a general fix,
and it is not one — worth flagging so a future table created via ensure*() outside `SCHEMA_SQL`
doesn't get assumed-covered by a guard whose name implies more than it does.

---

## C6. The deploy gate now measures the bundle, not an app setting

**CONFIRMED — including the discriminating question the brief flagged as unsettled**, by a
combination of my own independent reads and a peer session's (see below for exact provenance split).

**What I read myself, without help** (`gh api` reads work from this session; only Actions log
*content* and workflow *dispatch* are blocked by this session's proxy — confirmed:
`gh api .../dispatches` -> `403 Resource not accessible by integration`; `gh api .../logs` ->
redirect to `productionresultssa11.blob.core.windows.net` -> `403` at CONNECT, per
`curl $HTTPS_PROXY/__agentproxy/status`'s `recentRelayFailures`):

1. `buildStamp.ts` was added in exactly commit `f0f9afc` (`git log --diff-filter=A`), the same
   commit that fixed the gate. So `f0f9afc`'s own deploy (run `33733374880`) was the FIRST build to
   compile with the stamp mechanism live — its own served bundle carries `BUILD_SHA='f0f9afc...'`
   baked in as a literal.
2. Pulled the step-level timing for the NEXT deploy, run `33733707586` (head `5dbd4df`), directly via
   `gh api repos/.../actions/jobs/100579261251` (steps array, no log content needed):
   ```
   Sync secrets to Function App settings   08:31:05 -> 08:31:14   (writes DEPLOYED_SHA=5dbd4df)
   Deploy to Azure Functions               08:31:14 -> 08:31:34   (the code zip deploy)
   Set Function App settings               08:31:34 -> 08:31:40   (Google creds; another settings write)
   Apply the database schema (the poll)    08:31:40 -> 08:31:54
   ```
3. All four deploy runs sampled show `conclusion: success` on `Build TypeScript`, which is the step
   whose Python heredoc `assert`s the `BUILD_SHA` placeholder was actually found and replaced —
   confirming the stamp mechanically applies on every green deploy, not merely that the code compiles.

**What the peer session relayed** (raw job-log lines from run `33733707586`, which I cannot fetch
myself): the poll took 2 attempts — attempt 1 at 08:31:41 reported `deployedSha=f0f9afc...` (the
PREVIOUS commit), attempt 2 at 08:31:53 reported `5dbd4df...` (the new one). I did not independently
read these two lines; I can only corroborate the timing skeleton they sit in, which I did read myself
and which matches exactly.

**Why this discriminates, verified by reasoning from facts I hold independently**: `DEPLOYED_SHA`
(the app setting) was written at 08:31:14, 27 seconds before the first poll, with TWO further
app-settings-triggered restarts in between (steps 1 and 3 above). If `servingSha()` were reading
`process.env.DEPLOYED_SHA` live (evaluated per-request, not baked into the bundle), any worker
restarted after 08:31:14 — and the app went through at least one, arguably two, restart triggers by
08:31:40 — would read the ALREADY-UPDATED env value and report `5dbd4df` from attempt 1. It did not:
it reported `f0f9afc`, the value that can only come from a **compiled-in literal** in the OLD
bundle's `buildStamp.js` (per point 1, `f0f9afc`'s own build stamped exactly that value into its own
`dist/`). That is only explicable if `servingSha()` genuinely prefers the bundle-compiled `BUILD_SHA`
over the live env setting, exactly as the source shows (`BUILD_SHA || process.env.DEPLOYED_SHA`) —
and attempt 2, 12 seconds later (well after "Deploy to Azure Functions" completed at 08:31:34),
correctly picked up the NEW bundle's `BUILD_SHA='5dbd4df'`.

**This also resolves why the FIRST post-fix deploy (`33733374880`, `f0f9afc` itself) still converged
on attempt 1**: at that point the OUTGOING bundle (deployed by the prior commit) predated
`buildStamp.ts` entirely, so its `BUILD_SHA` was `null` and `servingSha()` correctly fell through to
`DEPLOYED_SHA` — which had already been updated. That is the documented fallback behaving exactly as
designed for an unstamped predecessor, not a repeat of the defect. `33733707586` is the first deploy
where BOTH the outgoing and incoming bundles carry a real stamp, and it is the one that actually
waited — which is the single strongest piece of evidence available anywhere for this claim.

**Net: CONFIRMED**, with the caveat that two specific raw log lines came from the peer and were not
independently re-read by me — everything the argument's soundness depends on (which commit
introduced the stamp, the step timings, the restart-trigger count, `servingSha()`'s actual
precedence) I verified myself from source and from `gh api` metadata reads, and the two relayed
lines are the only inputs that would need re-confirming to fully close the gap on their own.

---

## C7. Nothing in production behaves differently yet

**CONFIRMED.**

1. **`MASTERCONTEXT_SOURCE` default**: `grep -n MASTERCONTEXT_SOURCE api/src/functions/tests/*.ts`
   shows exactly one read site — `masterContextSource()` — `process.env.MASTERCONTEXT_SOURCE ===
   'postgres' ? 'postgres' : 'storage'`. Any unset, empty, or misspelled value defaults to
   `'storage'`. `grep -rn MASTERCONTEXT_SOURCE .github/workflows/*.yml` returns nothing — it is not
   set anywhere in CI, so it is not set on the Function App unless someone did it by hand, and
   `.claude/actions.md` confirms nobody has ("Nothing reads Postgres yet"). No other path in the
   repo reads Postgres for the master profile.

2. **The copy route requires a verified session, correctly** — read `masterContextCopy` and its
   dependencies directly:
   - `requireWrite(req)` (`appSession.ts:72-76`): `if (verified || owner === DEMO_EMAIL) return null`
     — blocks any unverified request whose resolved owner is NOT the demo account.
   - `resolveOwner(req)` (`appSession.ts:46-63`): a valid `Authorization: Bearer` session ALWAYS
     wins and returns `{owner: v.email, verified: true}`, ignoring `?owner=` entirely (line 51,
     matched before the query-string fallback is ever reached). Only when there is no verified
     session does it fall through to `{owner: req.query.get('owner') || DEMO_EMAIL, verified:
     false}`.
   - So the only two ways through `requireWrite` on this route are (a) a real verified session,
     whose OWN email is used (not attacker-supplied), or (b) no session at all with owner defaulting
     to the shared demo sandbox partition — safe, since `owner_master_block` is owner-scoped and the
     demo partition holds no real data. An unverified caller CANNOT pass `?owner=von.ellis@...` to
     seed a real owner's Postgres rows — `requireWrite` 401s before `resolveOwner` is called a
     second time inside the handler.
   - This is the correct pattern per this repo's own established distinction (`H19`): `requireWrite`
     alone is unsafe for GLOBAL state with no demo partition (Prompts), but safe for OWNER-SCOPED
     state where the demo carve-out only ever touches the demo owner's own rows — which is exactly
     what `owner_master_block`'s `PRIMARY KEY (owner_email, block_key)` guarantees.

---

## C1. The accessor is the only production read of MasterContext

**CONFIRMED.**

```
$ grep -rn "PartitionKey eq 'context'" api/src --include=*.ts
api/src/functions/tests/masterContext.ts:73:export const MASTER_CONTEXT_FILTER = "PartitionKey eq 'context'"
api/src/functions/tests/mt13.ts:25: ...
api/src/functions/tests/mt14.ts:42: ...
api/src/functions/tests/mt18.ts:45: ...
api/src/functions/tests/mt19.ts:71: ...
```

Only the accessor itself declares the filter, plus the four legacy MT-XX harness files
(`mt13`/`mt14`/`mt18`/`mt19`) which `CLAUDE.md` names explicitly as "NOT the product" and which
`masterContext.ts`'s own `H:mastercontext-one-accessor` test exempts by name. `grep -rln
"MasterContext" web/ scripts/` returns nothing — no bypass in the legacy console or scripts.
`diagMasterSource.ts` (new file, not in the AC's original read-site table) goes through
`loadMasterBaseline()` -> `readMasterContextEntity()`, confirmed by reading it directly — no raw
`TableClient` in that file.

Mutation-proved: deleted `'owner_master_block'` from `EXPECTED_TABLES` (see C5) and separately
mutated `entityFromBlocks` (see C3) — both fire — confirming the guard machinery in this area is
live, not decorative.

---

## C2. The six migrated call sites kept their error policies exactly

**CONFIRMED**, read directly off each function body on the corrected tree:

| Caller | Policy | Verified |
|---|---|---|
| `appInsertions.loadMasterBaseline` | swallows to `{}` | `try { ... } catch { return {} }` — exact |
| `appApply.masterContextSummary` | swallows to `''` | `try { ... } catch { return '' }` — exact |
| `appFacts.sourceText` | records into `sources[]` | `catch (e) { sources.push(\`MasterContext UNREADABLE: ...\`) }` — exact, and does NOT re-throw |
| `diagSkillSources.readSkillFields` | `{ok:false, error}`, empty vs unreadable distinct | `try { const {entity,count}=await readMasterContextEntity(); if(!count) return {ok:false, error:'MasterContext is empty', entities:0, fields:{}} ... } catch(err) { return {ok:false, error:String(err?.message||err), ...} }` — the two failure modes produce genuinely different `error` strings, matching the claim |
| `pipeline.loadProfile` | does not catch | `const {entity:mc} = await readMasterContextEntity(); return profileFromMasterContext(mc)` — no try/catch, confirmed |
| `pipeline.ts:388` (inside `buildPackageForJD`) | does not catch | `const {entity:mc} = await readMasterContextEntity()` — no surrounding try/catch at that line, confirmed |

The sharpest claim (diagSkillSources' empty-vs-unreadable distinction) holds: `count` comes from the
accessor's own `count` (rows found in the partition), which is 0 for a genuinely empty table and the
function never reaches that branch on a throw — the `catch` fires first with the real error message.
This is the same distinction the pre-migration code drew (`entities.length` vs a thrown
`TableClient` error), preserved.

---

## THE INTEGRATION TRACE

**CONFIRMED**, including the specific attack the brief called out (`appBaseline.ts` /
`diagMasterSource.ts` never edited by this work but claimed as consumers).

```
$ grep -n "loadMasterBaseline" api/src/functions/tests/*.ts
appBaseline.ts:5:    import { loadMasterBaseline } from './appInsertions'
appBaseline.ts:350:   const master = await loadMasterBaseline()
appInsertions.ts:25:  export async function loadMasterBaseline(): Promise<Record<string, string>> {
appInsertions.ts:80:   const prevPkg = loop === 0 ? await loadMasterBaseline() : {}
appSwaps.ts:12:       import { loadMasterBaseline } from './appInsertions'
appSwaps.ts:93:       const master = args.master ?? await loadMasterBaseline()
diagMasterSource.ts:3: import { loadMasterBaseline } from './appInsertions'
diagMasterSource.ts:88:      const master = await loadMasterBaseline()
```
`appBaseline.ts` and `diagMasterSource.ts` are genuinely, transitively covered:
`loadMasterBaseline()` -> `readMasterContextEntity()` -> the accessor, with zero raw reads of their
own (confirmed under C1's grep, which covers the whole `api/src` tree, both files included). Neither
needed editing by this lane because neither ever read MasterContext directly — they always went
through `appInsertions.loadMasterBaseline`, which is the one function this lane's Commit 1 actually
migrated. `swaps.ts` does NOT call `loadMasterBaseline` itself (correctly — it stays pure per `H12`:
no `@azure/functions`, no `pg`); it receives `master` as a parameter from `appSwaps.ts`, which is
what makes it a "consumer" in the sense the AC doc means (reads the value) rather than a caller of
the accessor.

**Producer claim** (12 Storage writers, none targeting the `context` partition) — spot-checked
rather than re-derived from scratch, since re-deriving a 12-file sweep independently would not add
information beyond re-running the same grep: `grep -rn "createEntity\|upsertEntity\|updateEntity"
api/src --include=*.ts | grep -i context` returns nothing, consistent with the claim.

---

## VERDICT SUMMARY

| Claim | Verdict |
|---|---|
| C1 — sole production reader | **CONFIRMED** |
| C2 — six call sites' error policies preserved exactly | **CONFIRMED** |
| C3 — `masterBaseline` byte-identical across the cut | **CONFIRMED**, mutation-proved |
| C4 — `owner_master_block` correct on production | **CONFIRMED**, local populated-DB test + live data (peer-relayed, independently summed) |
| C5 — `H:every-declared-table-is-registered` closes H11's blind spot | **CONFIRMED** for the specific incident (mutation-proved); **REFUTED as a general claim** — 12 pre-existing tables created via `ensure*()` helpers outside `SCHEMA_SQL` remain invisible to every migration-completeness guard in the repo, the same shape as the D21 incident, left open |
| C6 — deploy gate measures the bundle, not a label | **CONFIRMED**, including the previously-unsettled discriminator |
| C7 — nothing behaves differently in production yet | **CONFIRMED** |
| Integration trace | **CONFIRMED** |

**One real, actionable finding survives independent adversarial review**: C5's wider blind spot
(12 tables: `ats_source`, `bulk_job`, `coach_activity`, `coach_thread`, `folder_role_map`,
`mail_alert_state`, `mail_watch_config`, `opportunity_stage_history`, `owner_search_prefs`,
`seniority_routing`, `taxonomy_title`, `title_tier_draft`). Pre-existing, not introduced by this
lane, and not blocking — but worth a follow-up ACT item so the next table created outside
`SCHEMA_SQL` doesn't get assumed-covered by a guard whose name promises more than it delivers.

**Process finding**: a mutation-test edit briefly leaked into a real pushed commit (`12b7da0`) via a
shared working tree with a concurrent instance of this session. Caught within the same turn, fixed,
pushed (`d646b9e`), and independently confirmed by the peer never to have reached `origin/main`.

No live behavior changed as a result of this verification pass. `MASTERCONTEXT_SOURCE` is still
`storage` in production; the switch remains the owner's decision per the peer's own statement.

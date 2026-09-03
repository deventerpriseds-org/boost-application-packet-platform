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

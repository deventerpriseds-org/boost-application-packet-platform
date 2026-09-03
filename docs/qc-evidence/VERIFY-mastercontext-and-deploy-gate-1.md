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

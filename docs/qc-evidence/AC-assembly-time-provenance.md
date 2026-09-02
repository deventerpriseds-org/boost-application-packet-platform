<!-- WHAT:       AC pass output for Option A -- assembly-time provenance for skill_candidate.origin
                 and last_build.lineage.
     WHY:        see docs/qc-evidence/BRIEF-ac-assembly-time-provenance.md (D:swap-screen-reads-a-dead-pass,
                 D:lineage-winner-is-none). TIER 1: decides a stored provenance claim.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   commands run inline below, each with its actual output. -->

# AC PASS — assembly-time provenance (Option A)

Branch: `claude/incumbent-wins-swap`. Brief: `docs/qc-evidence/BRIEF-ac-assembly-time-provenance.md`.

Status: IN PROGRESS — appended section by section, committed after each.

## 0. Feasibility table (published FIRST, per repo rule)

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `assemblePackage`'s inputs can see WHICH pass won each field | `mt17.ts:131-160` `assemblePackage(call1,call2,call3)`: every field is `firstNonEmpty(callN.x, ...)` — a **whole-field, wholesale** pick, never a per-item merge | nothing today; the pick is made and discarded | Read `mt17.ts:131-163`. Every RHS is `firstNonEmpty(candidate1, candidate2, ...)` in a fixed precedence per field | **EXISTS-BUT-CONSTRAINED** — the winning PASS is knowable at assembly time (which candidate was non-empty), but only per FIELD, not per ITEM within a list. See §2. |
| `call2Draft(c2)` / `mergeCallTwo(c1,c2)` | `mt17.ts:104-127`, called once each, from `pipeline.ts:530,544` | `pipeline.ts` only | `grep -rn "call2Draft(\|mergeCallTwo(" api/src/functions/tests/*.ts` → `mt17.ts` (defs) + `pipeline.ts:530,544` (only production call site) | EXISTS. `call2Draft` returns the allowlisted Call-2 fields only (`CALL2_FIELDS`); it carries no per-item origin either. |
| `skill_candidate.origin`'s writer | `swaps.ts:row()` (pure fn) → `appSwaps.ts:155` `insert into skill_candidate (...,origin,...)`, called from `writeSwaps` (`appPackets.ts:621`) | see next row | `grep -n "insert into skill_candidate" api/src/functions/tests/appSwaps.ts` → one writer, line 155 | EXISTS — ONE writer. |
| `skill_candidate.origin`'s reader | `appSwaps.ts:202` `select * from skill_candidate ...` inside `swapsGet` (`GET /app/packet/{id}/swaps`) | **NONE in production.** Only `api/test/swaps.test.mjs` reads `.origin` (unit-level, on `buildSwaps()`'s pure return value, not the DB row) | See §1 below — full sweep of `app/src`, `web/src`, coach agent, scripts, workflows | **ABSENT** (no production consumer) — see §1, this is the heaviest claim in the brief and it holds. |
| `last_build.lineage`'s writer | `appPackets.ts:649` `lineage: skillLineage(built.calls.c1, built.calls.c2, built.calls.c3, pkg)`, persisted via `packet.last_build` (jsonb) | see next row | `grep -rn "lineage" api/src app/src` | EXISTS — ONE writer (`ensurePackage`'s return threaded through `appPackets.ts:786,1083,1199`). |
| `last_build.lineage`'s reader | — | **NONE anywhere.** `grep -rn "lineage" app/src` → **zero hits** | See §1 | **ABSENT.** |
| `origin` CHECK constraint, every DDL home | `schema.ts:611`, inline on `create table if not exists skill_candidate` | migration runner (`diag/pg-migrate`) | `grep -n "origin.*check\|create table.*skill_candidate" api/src/functions/tests/schema.ts` → exactly ONE line (611), no second `create table skill_candidate` anywhere, no ALTER re-widening it (unlike `swap_decision.driver`/`.list`, which both get an explicit `alter table ... drop/add constraint` a few dozen lines later in the same file) | **EXISTS-BUT-CONSTRAINED** — a 4th enum value needs a NEW explicit `alter table skill_candidate drop/add constraint`, per this file's own H39/H39b rule (`create table if not exists` is a no-op on production, which has had this table since P1.3). Nothing in the current file does this yet. |
| `applyCorrectionPass`'s position relative to `writeSwaps` | `appPackets.ts:541` (`applyCorrectionPass`, loop 0) → `:564` (`normalisePackage`, incl. `dedupeAcrossLists`) → `:621` (`writeSwaps(..., pkg, ...)`) → `:649` (`skillLineage(...,pkg)`) | `writeSwaps`→`buildSwaps` (`swaps.ts`), `skillLineage` (`packetBuild.ts`) | Read `appPackets.ts:500-654` in full (done, see transcript) | **EXISTS, and it is the root cause.** Both `writeSwaps` and `skillLineage` read the SAME `pkg` variable, and it is the package AFTER correction + normalisation/dedup — never the raw `assemblePackage` output. Neither `writeSwaps` nor `skillLineage` sees `built.pkg` before it is mutated. |
| Every production call site of `assemblePackage` | `mt17.ts:182` (self, legacy MT-17 test route), `mt18.ts:82`, `mt19.ts:115` (legacy MT-XX test-harness routes — NOT the product per `CLAUDE.md`), `pipeline.ts:544` (the ONE production path, via `buildPackageForJD`) | `pipeline.ts`'s caller is `appPackets.ts` (`buildPackageForJD`) | `grep -rn "assemblePackage(" api/src/functions/tests/*.ts` | EXISTS. Changing `assemblePackage`'s return SHAPE (e.g. adding a second "winners" map) touches 4 production/legacy call sites plus 5 test call sites in `api/test/callTwoRefinement.test.mjs` and `api/test/lineageCapture.test.mjs`. |

## 1. The falsification attempt (the brief's own heaviest claim)

**Claim to falsify: both `skill_candidate.origin` and `last_build.lineage` are write-only — no
production surface reads either, so fixing their VALUES changes nothing the owner can see today.**

Commands run, full output (not excerpted):

```
grep -rn "\.origin\b" app/src                    -> 2 hits, BOTH `window.location.origin` (auth.js), unrelated
grep -rn "skill_candidate" app/src                -> 4 hits, all comments (assetBlocks.js x2, AssetBlocks.jsx, PacketBuilder.jsx)
grep -rn "\.candidates\b" app/src                 -> 2 hits, BOTH AssetBlocks.jsx:1105/1113, and BOTH are
                                                      `keywordSwapOptions().candidates` (the owner's skill-BANK
                                                      picker, `skill_bank_entry` table) — a DIFFERENT `candidates`,
                                                      unrelated to swap_decision's skill_candidate rows
grep -n "packetSwaps" app/src/*.js app/src/screens/*.jsx
  -> api.js:190 (the fetcher), and its 3 callers: AssetBlocks.jsx:71, AssetGateDrawer.jsx:496, QcRail.jsx:820
  -> each of the 3 callers reads ONLY `.swaps` (`swaps.swaps` / `provenance.swaps.swaps`) off the
     response object; NONE destructures or reads `.candidates` (the array carrying `origin`)
grep -rn "lineage" api/src app/src                -> every hit is in api/src (writer side); ZERO hits in app/src
grep -rln "skill_candidate\|candidates\[\|\.candidates\b\|lineage" web/src   -> no matches (legacy console, empty)
grep -rn "skill_candidate\|lineage" coachTools.ts coachAgent.ts              -> no matches (AI coach agent)
grep -rln "skill_candidate\|lineage" scripts/ .github/                      -> no matches (no workflow/script reads it)
grep -n "\.origin\b" api/test/*.mjs
  -> ONLY api/test/swaps.test.mjs (5 assertions) and skillPool.test.mjs/skillRewordsDb.test.mjs, both
     about a DIFFERENT `origin` (skill_bank_entry.origin / skillPool rejection reason) — swaps.test.mjs's
     5 hits are all against `buildSwaps()`'s in-memory return value in a unit test, never against a row
     read back from Postgres by a route
```

**Verdict: the claim is CONFIRMED, not falsified.** I could not find a single production reader —
app, legacy web console, AI coach agent, scripts, or CI workflow — of either field. The only code
that inspects `skill_candidate.origin`'s value is `api/test/swaps.test.mjs`, which tests the PURE
`buildSwaps()` function directly and never goes through the HTTP route or the database. `GET
/app/packet/{id}/swaps` (`appSwaps.ts:202`) does select and return `candidates` (including `origin`)
over the wire, but nothing on the client parses that array — the three UI consumers of this endpoint
all read `.swaps` only.

This matters for the brief's other open question (§4 below): **the premise for a production
migration is exactly as weak as the brief worried it might be.**

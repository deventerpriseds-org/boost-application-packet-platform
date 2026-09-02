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

## 2. What "assembly time" can and cannot see (constrains every AC below)

Read in full: `mt17.ts:131-163` (`assemblePackage`), `pipeline.ts:500-560` (the real caller),
`appPackets.ts:500-654` (`ensurePackage`, the only production path into `writeSwaps`/`skillLineage`).

- `assemblePackage` resolves **per FIELD**, wholesale, via `firstNonEmpty(candidate1, candidate2,
  ...)` in a fixed precedence hand-written per field (e.g. `SkillsBullets1:
  firstNonEmpty(call3.finalSkills1, call2.skills1, call1.skills1, splitS1)`). It does **not** merge
  items within a field from different passes — whichever candidate is first non-empty supplies the
  *entire* field's text. So "which pass won" is knowable per field at assembly time, cheaply.
- It is **not** knowable per ITEM at assembly time whether an item is `profile_original` (i.e.
  matches the owner's MasterContext master-template block) — that comparison needs `master`
  (`loadMasterBaseline()`), which `assemblePackage`/`pipeline.ts` never loads; only `swaps.ts` does,
  downstream, inside `writeSwaps`. So Option A can fix the `pass_a`/`pass_b`(/new value) attribution
  for a NON-baseline item; it cannot and does not need to touch the `profile_original` classification,
  which is already correct (it is not what the brief's measured defect names).
- `writeSwaps` and `skillLineage` are both called from `appPackets.ts` on the **same `pkg` variable**,
  and that `pkg` has already been through `applyCorrectionPass` (:541) and `normalisePackage`
  (:564, which runs `dedupeAcrossLists`) by the time either is called (:621, :649). Neither function
  ever sees `built.pkg` — the raw, uncorrected, undeduped output of `assemblePackage` — which is
  exactly why `skillLineage`'s `sameList(final, callN)` string-comparison against the shipped `pkg`
  returns `'none'` on 4 of 5 slots (measured, `docs/qc-evidence/DEFERRED.md` row
  `D:lineage-winner-is-none`): the shipped text has moved on from anything any single call produced.
- Consequence for the design: assembly-time provenance means capturing the winning-pass fact
  **inside or immediately beside the `assemblePackage` call in `pipeline.ts:544`**, before
  `built.pkg` is handed to `ensurePackage`, and **threading that fact through**, unmutated, past the
  correction pass and the normaliser, to both `writeSwaps` (which needs it per merge field, to stop
  guessing `pass_b` for every non-baseline item) and to `skillLineage`/`last_build.lineage` (which
  needs it directly, replacing the `sameList` re-derivation instead of feeding it).

## 3. Acceptance criteria

**AC-1 (truthfulness — the measured defect itself).**
Given a build where Call 3 (`c3`) returns `{}` (0 characters for every `final*` field — the real,
producible shape: `pipeline.ts:536` is `const c3: any = p3.value || {}` whenever the QC pass returns
no JSON object, which is a live, reachable branch, not a hand-invented fixture) and Call 2 (`c2`)
returns a non-empty, genuinely different list for a given merge field (e.g. `skills1`), when the
packet is built, then no `skill_candidate` row for an item in that field is written with the origin
value that means "Call 3" (today's `pass_b`). The item's origin must name whichever pass actually
supplied the text that shipped for that field (Call 2, under this scenario) or the pre-existing
`profile_original` value where the item also matches the master baseline.
*Producibility check done*: `pipeline.ts:536`'s `p3.value || {}` fallback is exercised on every
build where the ATS pass returns no parseable JSON, which is exactly the live shape measured in
`db-query` run `33635773017` (`len(call3)=0` for all five `final*` fields on a real production
opportunity) — this is not a fixture invented for the test, it is the shape the pipeline actually
produced.

**AC-2 (the Call-1-passthrough case — the second live shape, RelevantBullets2/3).**
Given Call 2 returns a list for a field that is byte-identical (after the same normalisation
`sameList()` already applies — bullet-prefix-insensitive) to Call 1's list for that field, when the
packet is built, then the shipped items for that field must NOT be recorded as produced by Call 2.
They must be recorded as Call 1's (`pass_a`), or as `profile_original` where they also match the
master baseline. Rationale: this is the live `c1_eq_c2 == true` case on `RelevantBullets2/3`
(measured, `db-query` `33635773017`) — "the shipped text equals Call 2's output" is not the same
fact as "Call 2 changed it," and provenance must record the latter, truthful claim, not the former,
ambiguous one.

**AC-3 (absent evidence is unknown, never a confident wrong pass).**
Given any generation pass is missing, unparsed, or throws (Call 1, 2, or 3 individually), when
skill-level provenance is computed for a field that pass would have contributed to, then the origin
recorded is either a value that means "we could not determine which pass wrote this" or is left
absent/null — never a specific pass name asserted with no basis. This generalizes AC-1's specific
case (`call3={}`) to every other combination the pipeline can produce, and follows the repo's
standing rule that absent evidence is `not_applicable`, never a confident claim.

**AC-4 (migration safety — enum widening under the api-deploy.yml code-before-migration window).**
Given `api-deploy.yml` deploys new CODE and polls `/api/health` to convergence *before* it calls
`/api/diag/pg-migrate` (read in `CLAUDE.md`'s own account of `D:deploy-migrates-against-the-old-bundle`
and confirmed structurally by this file's H39/H39b examples), when the new code attempts to insert a
`skill_candidate` row with a NEW origin enum value during that window — i.e. against a database
whose `origin` CHECK constraint has not yet been widened by the migration — then the write must
either (a) be held back and reported (the same shape `appSwaps.ts:listChecksAdmitExpertise` already
uses for the `expertise` list-CHECK widening: probe `pg_constraint`/`pg_get_constraintdef` for the
live definition before writing, and skip+report the affected rows rather than let the whole
transaction abort), or (b) fall back to an existing, already-widened enum value with an honest
rationale, rather than throwing and — per the `writeSwaps` catch at `appPackets.ts` — silently
producing an EMPTY swap table for the whole packet, the exact failure mode `H:correction-ddl-parity`
and the `expertise`-widening comment both name as the worst outcome available. **Extend, don't
duplicate**: the implementation should reuse `listChecksAdmitExpertise`'s probe pattern rather than
inventing a second one, or the AC pass and any reviewer must be told explicitly why not.

**AC-5 (backfill of already-written rows).**
Given `skill_candidate` rows already exist in production with `origin='pass_b'` that this fix's own
logic would now determine were NOT actually produced by Call 3 (the false-by-construction rows the
brief opened this work to correct), when the fix ships, then the team has made and recorded ONE
explicit decision among: (a) a one-time backfill UPDATE recomputing origin for existing rows from
data that can still support it, (b) leaving existing rows as-is and dating the fix so only rows from
new builds are trustworthy, or (c) some other stated position — and whichever is chosen, the
decision and its reasoning is written down (this document, or a dedicated `.claude/actions.md`
entry), not left implicit. Given the §1 finding that NOTHING reads `origin` today, the honest
default is (b) with a note, but the team must say so rather than have it fall out by omission.

**AC-6 (regression guards, each mutation-proved).**
For at least the following two invariants, a guard exists whose defect-reinstatement mutation-proves
with `scripts/mutate.sh` (an ABSOLUTE `cd /home/user/boost-application-packet-platform` in the test
command — a relative `cd` produced four false `INERT` verdicts elsewhere in this session because the
harness could not distinguish "the guard did not fire" from "your command never ran"):
  1. **No item may be labelled with a pass that supplied zero characters for its field** (AC-1).
     Revert the fix's guard against exactly the `call3={}` / non-empty-Call-2 shape and confirm the
     suite FAILS; restore and confirm it passes.
  2. **A Call-2-passthrough of Call 1's list is never recorded as Call 2's own change** (AC-2).
     Same mutate/restore discipline, against the `c1_eq_c2` shape.
Absent-evidence (AC-3) and the deploy-window probe (AC-4) should also get guards where a suite can
exercise them without a live database; where they cannot (a real cross-deploy-window race), name that
explicitly as `manual` rather than claim coverage a unit test cannot provide.

## 4. Plain answer to the brief's direct question

**Is this worth a production migration at all, given the write-only finding in §1?**

No — not as a schema migration shipped ahead of a reader. The `origin` CHECK widening (a 4th enum
value) and the `last_build.lineage` re-derivation fix would correct a claim that is currently false
**on data nothing displays and nothing else consumes**. Shipping the schema change now buys nothing
observable to the owner and adds exactly the kind of DDL-parity/deploy-window risk this repo's own
`H39`/`H39b`/`H:correction-ddl-parity` history warns is expensive to get wrong (four migration-killing
defects in this file's own history were exactly "a statement/ALTER ordering mistake nobody caught
until it aborted a real migration").

**The honest recommendation is the one the brief itself half-suggested**: write the regression guards
in AC-6 now, as pure-function tests against `swaps.ts`/`packetBuild.ts` (no schema change needed —
they can assert on `buildSwaps()`'s and `skillLineage()`'s in-memory return values, which is exactly
what `api/test/swaps.test.mjs` and `api/test/lineageCapture.test.mjs` already do), so the FALSE
CLAIM stops being produced in the one place it is computed, and **defer the schema/enum migration
until a real reader exists** (the JD-step comparison card, the QC rail's swap table, or the coach
agent — whichever the owner decides should show provenance first). That gets the correctness fix
shipped today with zero migration risk, and leaves the 4th-enum-value question to be answered
together with whoever builds the first reader, when the exact shape the reader needs is known.

If the owner instead wants the schema change landed regardless (e.g. to stop misleading a future
`select * from skill_candidate` run by hand, or to prepare ahead of a reader that is already
scheduled), AC-4 and AC-6 above are the minimum bar for shipping it safely — but that is the owner's
call to make explicitly, not a default this pass should assume.

## 5. Status

DONE. All required sections published: feasibility table (§0), falsification attempt (§1, claim
CONFIRMED), assembly-time constraints (§2), six ACs (§3), plain answer on migration worth (§4).
No prompt in the Prompts table was read or edited. No existing guard or refusal was proposed for
weakening. Every verdict above is grounded in a `grep`/`read` command shown with its actual output,
or is explicitly marked as needing a live-DB check (`manual db-query.yml`) this sandbox cannot run.

---

## 6. IMPLEMENTER CORRECTION, 2026-09-02 — AC-1's premise is wrong, and the fault is mine

**Nothing above is edited.** This pass answered the brief it was given, and the brief asserted that
`origin='pass_b'` claims Call 3 produced the item. **That assertion was mine and it is false.**

`swaps.ts:490-494` assigns origin by MEMBERSHIP, not authorship:

    const finals = splitItems(pkg[f.merge] ?? call3[f.passB])     // :475 -- SHIPPED pkg first
    for (const o of originals) candidates.push({ ..., origin: originOf(o, 'pass_a') })
    for (const fin of finals) {
      if (originalNorms.has(normItem(fin))) continue
      candidates.push({ ..., origin: originOf(fin, 'pass_b') })   // in finals, NOT in originals
    }

`finals` is the shipped package; `call3[f.passB]` is only a fallback that this packet never even
reached (Call 3 returned `{}`). So `pass_b` reads "present in what shipped, absent from the
baseline" -- a TRUE statement about a Call-2 insertion. The Call-3 binding exists in exactly one
place, a comment at `swaps.ts:8`, plus `schema.ts:620`'s "one per item the ATS pass introduced".
`schema.ts:611` itself defines no meaning for the values at all.

**Therefore:** AC-1 and AC-2 are testing for a defect that is not in the data, AC-4 and AC-5 are
moot (no enum widening, so no deploy window and no backfill), and the migration question the pass
was asked to rule on **does not arise**. The genuine defects that survive are the PROSE (two
comments asserting authorship the code never asserts) and `D:lineage-winner-is-none`, which is
independent of all of this.

**How this got past both of us:** I read `LIST_FIELDS[*].passB = 'finalSkills1'` -- a field-name
group -- as a definition of `pass_b`, then wrote that into the ledger row on 2026-08-22, then into
the brief. The pass was handed the conclusion as a premise and asked to design around it. That is
the ground-truth failure this repo documents, committed by the implementer against the verifier:
**a brief that asserts the diagnosis instead of the observation launders my error into an
independent artifact.** A brief should hand over the measurement (`len(call3)=0`, `origin='pass_b'`)
and let the pass derive what it means.

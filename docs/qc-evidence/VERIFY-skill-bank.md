# VERIFY — 4.6-9 skill bank (independent verifier)

Branch: `claude/three-small-ui-gaps` (12 commits ahead of origin/main)
Verifier: independent subagent, no shared context with the implementer.
Started: 2026-08-26

Rule: nothing is CONFIRMED without a command I ran and its output pasted below.

## Status log (append-only)

- [start] Repo at 79d3313, working tree clean. Diff vs origin/main: 18 files, +2118/-28.

---

## Cheap tier — re-run in full, not inherited

| Command | Result |
|---|---|
| `cd api && npm test` | `# pass 886 / # fail 0`, EXIT=0 (includes `npm run build`, so the API build is green) |
| `cd app && npm test` | `# pass 349 / # fail 0`, EXIT=0 |

## Claim 1 — 36 `relevantProficiencies` terms with categories; pool 64, 0 rejected → **CONFIRMED**

I did NOT reuse the implementer's numbers. MasterContext is an Azure Storage Table the sandbox
cannot reach, so I reconstructed the five live fields myself from the Zapier archive
`docs/zap-289877647/zap-289877647.full.json` (params `Current Skills`, `Current Expertise` x2)
and checked the reconstruction against the independently-recorded live character counts.

Reconstruction fidelity (my `python3` extraction vs SKILL-POOL.md's live `chars` column):

| field | my reconstruction | live (api-test 32997381200) | match |
|---|---:|---:|---|
| skills1 | 225 | 225 | exact |
| skills2 | 180 | 180 | exact |
| softHardSkillsPool | 444 | 444 | exact |
| expertise | 286 | 286 | exact |
| relevantProficiencies | 963 | 958 | **5 chars off** |

The 5-char gap on `relevantProficiencies` is the one soft spot (my `&`->`and` / bullet-fold
normalisation is not byte-identical to the owner's live text). It does not move the result: the
per-group word counts of the pre-change rejections reproduce **15/16/23/23/27**, exactly the five
live rejections in SKILL-POOL.md section 3, and the group sizes are 6/4/8/8/10 = 36.

`node` against `api/dist/functions/tests/skillPool.js` with `SKILL_REWORD_SEED`:

```
entries 64
bySource {"skills1":11,"skills2":9,"softHardSkillsPool":0,"expertise":8,"relevantProficiencies":36}
rejected []
staleRewords []
duplicates 22
rp categories {"Governance and Compliance":6,"Technology Strategy and Transformation":4,
               "Business and Financial Impact":8,"Data, Analytics and AI":8,"Execution and Operations":10}
rp terms total 36 with null category 0
```

All 36 recovered, every one carrying a category (0 with null), 0 rejected, 64 total. CONFIRMED.

Note on one category LABEL: my reconstruction yields `Data, Analytics and AI` (comma retained from
the archive's `Data, Analytics & AI`); SKILL-POOL.md/AC doc record the live label as
`Data Analytics and AI`. Term recovery is unaffected either way (the split is on the remainder after
the FIRST colon), but the exact stored category string for that one group is not something I can
confirm from here.

## Claim 6 — `category` added by idempotent ALTER, H39 order, applies on a POPULATED db → **CONFIRMED**

I ran it myself, per the CLAUDE.md recipe, and checked the stale-dist concern first.

**Build is genuinely green from a clean `dist`** (the suppressed-build-failure worry is resolved):
```
rm -rf dist && npm run build   ->  BUILD_EXIT=0
grep -n "skill_bank_entry add column\|skill_bank_entry_category_idx" /tmp/schema.sql
  1352:alter table skill_bank_entry add column if not exists category text;
  1353:create index if not exists skill_bank_entry_category_idx on skill_bank_entry (owner_email, category);
```
The new statements ARE in the dump taken from the fresh build, so the dump is not stale.

**The test that matters** — main's schema, seed real rows, branch schema on top:
```
psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_main_nv.sql   ->  MAIN_EXIT=0
  (\d skill_bank_entry after main: NO category column - confirms the ALTER has real work to do)
insert 3 real skill_bank_entry rows                            ->  3 rows
psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_nv.sql        ->  BRANCH_EXIT=0, 0 errors
psql ... -f /tmp/schema_nv.sql  (a SECOND time)                ->  SECOND_EXIT=0, 0 errors
```
After migration: `category | text | nullable | no default`, index `skill_bank_entry_category_idx
btree (owner_email, category)` present, and all 3 pre-existing rows survived with `category = NULL`.

**H39 ordering CONFIRMED**: nothing above line 1352 names `skill_bank_entry` together with
`category` (`awk 'NR<1352 && /skill_bank_entry/ && /category/'` -> no output). The index is placed
AFTER the ALTER.

Minor factual error, no impact: the comment on `H:skill-rewords-extends-owner_search_prefs-never-a-new-table`
says *"schema.ts already carries owner_search_prefs"*. It does not — `grep -n owner_search_prefs
api/src/functions/tests/schema.ts` returns 0 hits; the table is created at runtime by five modules
(`appRemediation`, `appDimensions`, `appSearchPrefs`, `checkPrefs`, and now `appSkillBank`). The
substance of the claim (extends an existing store, no new table) is TRUE and the code follows the
same pattern as the four existing extenders.

## Claim 2 — two-level split DECLARED not sniffed; the boundary claim → **CONFIRMED, and understated**

The boundary claim is real, and there are TWO groups on it, not one. Running `looksLikeList`'s exact
logic over my reconstruction of the live field:

| category | parts | longest part (words) | `looksLikeList` | the term on the boundary |
|---|---:|---:|---|---|
| Governance and Compliance | 6 | 3 | true | |
| Technology Strategy and Transformation | 4 | **4** | true | **`Corporate AI Use Cases`** |
| Business and Financial Impact | 8 | **4** | true | **`Budget and Cost Control`** |
| Data, Analytics and AI | 8 | 3 | true | |
| Execution and Operations | 10 | 3 | true | |

Two of five groups sit EXACTLY on `longest <= 4`. One 5-word proficiency added to either collapses
that group; the earlier word-count run shows those chunks measure 16 and 23 words whole, both past
`isRejected`'s 12-word limit — so the category would silently vanish. The trap is real.

## MUTATION SWEEP — my own, not a replay

Method: edit the production line, `npm run build`, run `node --test` on the affected files, restore
with `git checkout -- api/src`. A guard is LIVE only if the suite actually goes red.

| # | Production line I broke | Suite | Verdict |
|---|---|---|---|
| M2 | second-level `,` split made conditional on `looksLikeList` (sniff, not declare) | RED (3 tests) | guard LIVE |
| M3a | removed `if (!any) continue` in the colon branch | **GREEN** | **dead line — see below** |
| M3b | removed the trailing `continue`, letting a category fall through | RED (5 tests) | guard LIVE |
| M4 | colon located on the tidied text (`t`) instead of `rawChunk` | RED | guard LIVE |
| M5 | reword made 1:1 (no re-split, so `A \| B` yields one term) | RED (2 tests) | guard LIVE |
| M6 | `staleRewords` hardcoded to `[]` | RED (2 tests) | guard LIVE |
| M7 | parser rewords from a CODE default when no map is injected | RED | guard LIVE |
| M8 | rewords write changed to a jsonb MERGE (`\|\| $2`) | RED | guard LIVE — the `fakeClient` fix is real |
| M9 | `effectiveRewords` collapses `{}` to null | RED | guard LIVE |
| M10 | seeder DELETEs its orphans | RED | guard LIVE |
| M11 | **`on conflict … do update` removed entirely** | **GREEN** | **INERT** |
| M12 | **`returning (xmax = 0) as was_insert` removed** | **GREEN** | **INERT** |
| M13 | `origin` written with the field name instead of `'master_context'` | RED | guard LIVE |
| M14 | **`category = excluded.category` removed from the DO UPDATE set list** | **GREEN** | **INERT** |

### M3a is a dead line, not an inert guard
`if (!any) continue` is immediately followed by `continue`, so both branches do the same thing.
Removing it cannot change behaviour — a behaviourally-equivalent mutation that correctly fails to
fail. The protection it is credited with in its 6-line comment is actually supplied by the trailing
`continue`, which M3b proves is load-bearing. Cosmetic; worth deleting or re-commenting.

### M11 / M12 / M14 — THREE INERT GUARDS, proven against a real Postgres

The brief asked me to check `bankClient` for the same disease the implementer fixed in `fakeClient`.
**It has it.** I proved the breakage is real by running the production `seedSkillBank` against the
live local Postgres (`upg`, branch schema applied), mutation by mutation:

| mutation | real Postgres behaviour | node --test |
|---|---|---|
| unmutated | run1 `{inserted:2,updated:0}`, run2 `{inserted:0,updated:2}`, renamed category persisted, 2 rows | green (correct) |
| **M11** | run2 → `ERROR: duplicate key value violates unique constraint "skill_bank_entry_owner_email_label_norm_key"` — **every re-seed 500s; idempotency is destroyed** | **green** |
| **M12** | run1 on an EMPTY bank reports `{inserted:0, updated:2}` — the seeder's counts are wrong for every insert | **green** |
| **M14** | after the owner renames a category, the row keeps the OLD one (`Data Analytics and AI`, not `RENAMED CATEGORY`) — category goes stale on every re-seed | **green** |

Root cause, in `api/test/skillRewords.test.mjs:160-183`. `bankClient` models the ANSWER, not the
mechanism, in three separate ways:
1. `return { rows: [{ was_insert: !existed }] }` — synthesises `was_insert` from its own bookkeeping,
   so it is structurally blind to whether the SQL contains `returning (xmax = 0)` at all.
2. `const keep = /do update/.test(flat); if (!existed || keep) bank.set(...)` — when `on conflict` is
   ABSENT the fake merely declines to write. It models "no update happened" where real Postgres
   raises a fatal unique violation, silently downgrading a 500 to a no-op.
3. `bank.set(norm, {…category})` rebuilds the whole record from `params` whenever `do update` appears
   anywhere in the string. It never parses WHICH columns the `set` list names, so dropping any
   individual column from that list is invisible.

**The production code is CORRECT today** — verified against real Postgres above. These are guard
defects, not product defects. But claim 8's "idempotent" and claim 1/6's "category persists" are
currently unprotected: any future edit to that one SQL statement can break them with the suite green.

**Suggested fix** (cheap, and it is the same fix the implementer already applied to `fakeClient`):
point these five seeder tests at the real local Postgres the container already ships, or make
`bankClient` reject an INSERT whose SQL lacks `on conflict` on a key it already holds, return
`rows: []` when the SQL lacks `returning`, and apply only the columns named in the `set` list.

## Claims 3, 4, 5, 7, 8 — verified, and 7/8 against a REAL Postgres rather than the fake

Because a fake client is exactly what the brief told me to distrust, I ran the production
`setSkillRewords` / `loadSkillRewords` / `seedSkillBank` against the live local Postgres:

```
A. never saved      -> loadSkillRewords = null;  effectiveRewords -> 9 seed keys
B. saved two        -> {"Keep Me":"Y","Old One":"X"}
C. deleted one      -> {"Keep Me":"Y"}            <- "Old One" GONE: it REPLACES, not merges
D. deleted ALL      -> stored = {}   effective = {}
   {} distinct from null?  true
   seed did NOT resurrect? true
E. real row         -> [{"label":"X","origin":"master_context",
                         "source_ref":"skills1,softHardSkillsPool","category":null}]
```
- **Claim 7 CONFIRMED** on real Postgres: a deletion sticks and `{}` is genuinely distinct from null.
- **Claim 8 CONFIRMED** on real Postgres for `origin='master_context'` + field names in `source_ref`,
  for idempotency (run1 2/0, run2 0/2, row count stays 2), and for never deleting (M10 red).
- **Claim 3 CONFIRMED** (M7 red): with no map injected every term is verbatim.
- **Claim 4 CONFIRMED** (M6 red) and the field is consumed — see below.
- **Claim 5 CONFIRMED** (M5 red): `A | B` yields two terms; `bySource.expertise` goes 7 -> 8.

## SKILL_REWORD_SEED — every key matches text the owner actually has → **CONFIRMED**

All 9 keys found VERBATIM in my reconstruction of the owner's live fields, 0 missing, and
`buildSkillPool` reports `staleRewords: []` against the real five-field set:

```
VERBATIM  Budget Development and P&L Management              -> Budget Development | P&L Management
VERBATIM  Strategic roadmaps for customer-centric innovation -> Strategic Roadmaps | Customer-Centric Innovation
VERBATIM  M&A due diligence and technology integration       -> M&A Due Diligence | Technology Integration
VERBATIM  KPI-driven performance management                  -> KPI-Driven Performance
VERBATIM  Enterprise alignment of strategy and execution     -> Strategic Alignment
VERBATIM  Governance frameworks for compliance               -> Governance Frameworks
VERBATIM  Optimizing scaled agile operations                 -> Scaled Agile Operations
VERBATIM  Corporate AI Use Cases                             -> Corporate AI Adoption
VERBATIM  Budget and Cost Control                            -> Cost Control
keys: 9   not found verbatim: 0
```

## Claim 9 — the swap control → **CONFIRMED at the logic layer, guard-gap in the JSX**

I exercised `keywordSwapOptions` directly rather than reading its tests:

```
1. empty bank      -> candidates [], reason "Your skill bank is empty… Seed it in Settings > Skill wordings."
2. null bank       -> same        3. undefined bank -> same
4. normal          -> ["Enterprise Governance","Predictive Analytics","Cloud Architecture"]
                      (blank-label and null-label bank rows filtered out)
5. keyword in bank -> excludes the keyword itself
6. inField (mixed case) -> excludes case-insensitively
7. all taken       -> candidates [], reason "Every skill in your bank is already claimed in this field."
8. not present     -> candidates [], reason "This field does not contain it…"
9. cannot edit     -> candidates [], reason null
11. every candidate came from the bank?  true
12. category carried to the option?      {"label":"Predictive Analytics","category":"Data Analytics and AI"}
```
The JSX renders the `<select>` only when `swap.candidates.length`, else the reason, else `null` —
so today there is no dead control.

App-side mutations:

| # | broke | app suite | verdict |
|---|---|---|---|
| S1 | invent a fallback candidate when the bank is empty | RED | guard LIVE |
| S2 | empty-bank reason no longer names Settings | RED | guard LIVE |
| S3 | exclusion set emptied | RED (2 tests) | guard LIVE |
| S4 | **JSX renders the picker even with zero candidates** | **GREEN** | **INERT — no guard on the render** |

S4 matters because "shows no control when the bank is empty" is a claim about the SCREEN, and only
the pure function is guarded. The file is already source-grepped by
`H:keyword-drop-is-keyboard-reachable`, so the pattern for fixing this exists in the same test file.

## WRITE-ONLY SWEEP — three findings

| thing | producer | real consumer | verdict |
|---|---|---|---|
| `buildSkillPool` | `skillPool.ts` | `appSkillBank.ts:26` (both routes) | **has a production consumer now** — it had zero before this work |
| `category` | seeder -> `skill_bank_entry.category` | `GET /app/skill-bank` SELECT -> `keywordSwapOptions` -> rendered at `AssetBlocks.jsx:941` (`label — category`) | reaches a reader end to end |
| `staleRewords` | `buildSkillPool` | `Settings.jsx:1814` and rendered loudly (red left border, keys listed) | reaches a reader |
| **`reworded`** | `buildSkillPool` -> route `appSkillBank.ts:221` | **NONE** — `grep -rn "\.reworded\b" app/src` finds only unrelated prose | **WRITE-ONLY** |
| **`preview.terms`** | route `appSkillBank.ts:225` | **NONE** | **WRITE-ONLY** |
| **`api.skillBankSeed`** (POST re-seed) | `api.js:316` | **NO CALLER anywhere in `app/src`** | **DEAD EXPORT** |

### The one that will bite the owner
`keywordSwapOptions` tells them: *"Your skill bank is empty… **Seed it in Settings > Skill
wordings**."* The Skill wordings card (`Settings.jsx:1796-1885`) has **Save**, **Add a wording** and
**Remove** — and no seed control. `api.skillBankSeed` exists and is called by nothing. So an owner
who follows that sentence finds nothing to press, and the bank can only be filled by a
`POST /api/app/skill-bank` from `api-test.yml` or curl. The swap control therefore cannot be reached
through the product at all until someone seeds the bank out-of-band. Adjacent to the standing
"No dead UI" rule, in its dead-end-instruction form.

`reworded` is the more principled miss: the module's own comment calls it *"the one place this
module departs from only-SPLITS-and-NORMALISES and therefore the one place that must be
auditable"* — and it never reaches a reader. Same class as this repo's most-repeated defect.

## What I could NOT verify from here

1. **Nothing was checked against the LIVE system.** No `api-test.yml`, `db-query.yml` or
   `ui-verify.yml` round-trip was run, so the deployed `/api/app/skill-bank` and
   `/api/app/skill-rewords` routes are unproven live, as is the rendered swap `<select>`. The branch
   is 12 commits ahead of `origin/main` and neither route is deployed (deploys fire on `main` only).
2. **The exact live `relevantProficiencies` string.** My reconstruction is 963 chars vs the recorded
   live 958. Everything downstream reproduces (word counts, group sizes, the pre-change rejection
   set), but the live category label for group 4 (`Data, Analytics and AI` vs `Data Analytics and AI`)
   is not settled from here.
3. **Multi-owner behaviour.** `MasterContext` is a single global partition (noted in
   `diagSkillSources.ts` and SKILL-POOL.md), so a per-owner bank seeded from it is a data-separation
   problem the moment a second owner exists. Pre-existing, not introduced here, and not testable
   with one owner.
4. **`useSkillBank` fires `api.skillBankGet()` per `AssetBlock`**, not once per page — N cards means
   N requests. Observation from reading `AssetBlocks.jsx:529`; I did not measure it in a browser.

---

# VERDICT

| # | Claim | Verdict |
|---|---|---|
| 1 | 36 `relevantProficiencies` terms with categories; pool 64, 0 rejected | **CONFIRMED** |
| 2 | Two-level split DECLARED not sniffed; the 4-word boundary is real | **CONFIRMED** (two groups on the boundary, not one) |
| 3 | Parser never rewords without an injected map | **CONFIRMED** |
| 4 | `staleRewords` reports keys that matched nothing | **CONFIRMED** |
| 5 | One reword may yield several terms | **CONFIRMED** |
| 6 | `category` by idempotent ALTER, H39 order, applies on a POPULATED db | **CONFIRMED** (I ran it; build green from a clean `dist`) |
| 7 | Rewords setting REPLACES; `{}` distinct from null | **CONFIRMED** on real Postgres |
| 8 | Seeder idempotent, `origin`/`source_ref` correct, never deletes | **CONFIRMED as behaviour** / **PARTIALLY GUARDED** — 3 of its 5 guards are inert |
| 9 | Swap offers only banked skills, no control when empty, excludes self + in-field | **CONFIRMED in logic**, render half unguarded, and **unreachable in the product** (no seed control) |

**No claim was refuted. The production code did what it says everywhere I could test it.**
Everything below is about the GUARDS and the WIRING, not about the behaviour shipping wrong today.

## Required before done

1. **Fix the three inert seeder guards** (M11 / M12 / M14). `bankClient` has the same
   models-the-answer disease the implementer fixed in `fakeClient`. Proven against real Postgres:
   removing `on conflict … do update` makes every re-seed throw a unique violation, removing
   `returning (xmax = 0)` makes every insert report as an update, and removing
   `category = excluded.category` makes a renamed category go stale — **all three with the suite
   100% green.** The container ships Postgres 16.13; pointing these five tests at it removes the
   double entirely.
2. **Wire a seed control, or change the sentence.** `api.skillBankSeed` has no caller and the
   empty-bank message sends the owner to a screen that has no seed button. As shipped, the swap
   control cannot be reached through the product.
3. **Guard the render half of "no bank, no control"** (S4). One source-grep assertion in
   `app/test/proposedKeywords.test.mjs`, matching the existing `H:keyword-drop-is-keyboard-reachable`.

## Worth fixing, not blocking

4. `preview.reworded` and `preview.terms` ship write-only. `reworded` is the audit trail the module's
   own comment calls mandatory.
5. `if (!any) continue` in `skillPool.ts` is dead code (the next line is `continue`); its 6-line
   comment credits it with protection the trailing `continue` actually supplies.
6. The comment on `H:skill-rewords-extends-owner_search_prefs-never-a-new-table` says
   *"schema.ts already carries owner_search_prefs"* — it does not (0 hits); five runtime modules
   create it. The claim's substance is still true.
7. `useSkillBank` fetches once per `AssetBlock`, not once per page.

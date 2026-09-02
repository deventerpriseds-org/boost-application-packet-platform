# H-2 closed — `expertise` needs THREE list CHECKs widened, not one

Parent session's work, 2026-08-30. Handoff H-2 from `IMPL-slot-config.md` §5.

## OBSERVATION — the concept has three homes

`grep -n "list .*check (list in" api/src/functions/tests/schema.ts`:

| line | table | admitted values before this change |
|---|---|---|
| 549 | `skill_candidate` | the five, **no `expertise`** |
| 572 | `swap_decision` | widened by the slot-config pass |
| 648 | `insertion` | the five, **no `expertise`** |

**`skill_candidate` rejects FIRST.** `writeSwaps` inserts a `skill_candidate` row per item and then
the `swap_decision` rows that reference them, so widening `swap_decision` alone would never even
have been reached for an expertise list.

**`insertion.list` is what joins a rendered line to its swap row.** `listBodyModel` takes
`swapsForList` (`assetBlocks.js:754`) — per-list, not packet-wide — so a null `list` on the
Expertise insertion means `swaps.length === 0` and every Expertise line renders `status: ''`,
**blank**. That is the exact defect the owner rejected on 2026-08-29: *"showing nothing which
doesn't match the design and leaves me wondering if something broken"*.

## THE CHANGE

Inline CHECKs at 549 and 648 widened (for a FRESH database) **plus** explicit
`drop constraint if exists` / `add constraint` ALTERs for both (for production, where
`create table if not exists` is a no-op), placed beside the `swap_decision` list ALTER.

## PROOF — executed against a POPULATED database, per CLAUDE.md

PostgreSQL 16.13, `ON_ERROR_STOP=1`, `origin/main`'s `SCHEMA_SQL` applied first, then real seeded
rows (`opportunity` → `packet` → `skill_candidate list='skills_1'`), then this branch's on top.

| Step | Result |
|---|---|
| main's schema on a fresh DB | applied |
| seed real rows | `INSERT` |
| **BEFORE — insert `list='expertise'`** | `ERROR: new row for relation "skill_candidate" violates check constraint "skill_candidate_list_check"` — **the production defect reproduced, and it fires on `skill_candidate`, not `swap_decision`** |
| apply this branch's `SCHEMA_SQL` on top | **exit 0** |
| AFTER — `skill_candidate`, `swap_decision`, `insertion` each insert `expertise` | all three accepted |
| junk value `list='nonsense'` | still `ERROR` — the widening is not a hole |
| seeded rows | survived: `skills_1` 1, `expertise` 1 |

## MUTATION PROOF — it FIRED

Deleted the two `skill_candidate` ALTER lines from the extracted SQL. The assertion that the
mutation target existed is in the script, so the proof is not vacuous.

- mutated schema on the populated DB → **applied, exit 0. The migration LOOKS healthy.**
- insert `list='expertise'` → `ERROR: ... violates check constraint "skill_candidate_list_check"`

That gap — a migration that succeeds while leaving the defect live — is the whole reason CLAUDE.md
requires a populated database. A fresh-DB run passes with the ALTER deleted.

## NOT DONE / HANDOFF

- **`LIST_FIELD_TO_LIST` (`insertions.ts:20-26`) has no `ExpertiseBullets` entry**, so
  `insertion.list` is still written `null` for expertise and the blank-status defect above is NOT
  yet closed. The DDL now permits the value; the writer does not yet produce it. `insertions.ts` is
  held by the in-flight pairing pass — wire it there or immediately after.
- Nothing committed, nothing pushed, nothing live. The `ALTER` reaches production only when
  `api-deploy.yml` runs on `main`.

## MY OWN DEFECT, caught by the build — a backtick inside `SCHEMA_SQL`

The first version of the comment block above used backticks to quote identifiers, the way every
other comment in this repo does. `SCHEMA_SQL` is a **template literal**, so each backtick
TERMINATED the string and `tsc` then parsed raw SQL as TypeScript:

```
schema.ts(629,71): error TS1443: Module declaration names may only use ' or " quoted strings.
schema.ts(630,61): error TS1005: ';' expected.
```

Five errors from a comment that read perfectly well. The build caught it — which is the same
argument `CLAUDE.md` makes about smart quotes: *"The build is the guard"*, because a parser knows a
syntax position and a regex does not. Recorded here and as a warning at the top of the block itself.

**H-case candidate for the parent session:** `H:schema-sql-has-no-backticks` — a source grep over
the `SCHEMA_SQL` template literal asserting zero backticks. Structural (H-rule 4: a source grep is
right where a runtime test cannot express the rule), and it cannot cry wolf, because a backtick in
there is *always* a syntax error rather than a style preference. Current count, measured: **0**.

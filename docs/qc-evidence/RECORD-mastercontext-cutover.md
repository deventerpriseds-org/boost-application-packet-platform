<!-- WHAT:       The live before/after proving the master profile now reads from Postgres and that
                 the switch changed the SOURCE without changing a single byte of the DATA.
     WHY:        AC-5 of AC-mastercontext-to-postgres.md -- "masterBaseline's output is byte-identical
                 across the cut" -- is the gate before anything reads from Postgres, because that
                 output is the BASELINE every swap row's "original" compares against. A one-character
                 difference silently rewrites provenance on every packet built after the flip.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   api-test.yml runs 33756330116 (before) and 33756688130 (after), same route, same
                 owner, deploy 0da39b2 between them. -->

# RECORD — MasterContext cut-over, measured live

`GET /api/diag/skill-sources` as `von.ellis@enterpriseds.io`, captured **before** the flip and again
**after**. The route reads through `readMasterContextEntity()`, so it exercises the real accessor
rather than a test double.

**The baseline was captured BEFORE flipping.** After the cut the comparison no longer exists, so a
"verify afterwards" plan would have had nothing to verify against.

## The discriminator — the source really did change

| | before (`MASTERCONTEXT_SOURCE=storage`) | after (`=postgres`) |
|---|---|---|
| `entities` | **1** | **14** |

`entities` is the row count the accessor found. Storage holds the profile as ONE entity in the
`context` partition; Postgres holds it as **14 rows** in `owner_master_block`. This is what makes the
capture proof rather than a coincidence: had the deploy silently kept reading Storage, the number
would still be 1.

## AC-5 — the data did not change

Compared as STRINGS, not by length alone. All five fields the route returns are byte-identical
across the cut:

| field | chars | text identical |
|---|---|---|
| `skills1` | 225 | yes |
| `skills2` | 180 | yes |
| `softHardSkillsPool` | 444 | yes |
| `expertise` | 286 | yes |
| `relevantProficiencies` | 958 | yes |

These also match the `length(text)` values read directly from `owner_master_block` before the flip
(`skills1` 225, `skills2` 180, `softHardSkillsPool` 444, `expertise` 286, `relevantProficiencies`
958) — so three independent paths agree: the Storage read, the Postgres read, and the live route.

## What was NOT done, deliberately

**Nothing was deleted from Azure Storage.** The seed row is intact — the `entities: 1` reading above
is that row being read minutes before the cut — and every raw-read code path remains in the
repository. This is AC-9, and it is what makes the rollback real: change `MASTERCONTEXT_SOURCE` back
to `storage` in `api-deploy.yml` and redeploy. Both branches are live code, not one branch and a
comment; `H:mastercontext-rollback-flag` proves both are reachable and that an unrecognised value
falls back to `storage` rather than silently switching the store.

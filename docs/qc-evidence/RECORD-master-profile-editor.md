<!-- WHAT:       What was built for the master profile editor, and the evidence for each claim.
     WHY:        The owner asked for the editor directly ("agreed it should be available for text
                 editing in settings once moved to postgres ... what's the hold up... seems
                 simple"). The Postgres cut-over landed first (RECORD-mastercontext-cutover.md);
                 without this half the owner still could not change their own profile text.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   this file. ACs: AC-master-profile-editor.md. Brief: BRIEF-ac-master-profile-editor.md. -->

# RECORD — the master profile editor (2026-09-03)

**Status: BUILT, deployed to production, read path VERIFIED LIVE. NOT yet confirmed by the owner in
their own browser.** Until they open Settings ▸ Master profile and save a block, the honest wording
is *"implemented, mechanism verified live, not owner-confirmed"*.

## Commits

| commit | what |
|---|---|
| `f1888fc` | the route — `GET`/`POST /api/app/master-profile`, added to `masterContext.ts`, 4 guards |
| `1cf54ac` | the two AUTH guards the AC pass named and the route commit had missed |
| `360d9ac` | the screen — Settings ▸ Master profile, `app/src/api.js` client, 3 UI guards |
| `75e1f87` | fix for the UI guard `mutate.sh` reported INERT |

Landed on `main` at `75e1f87`. Deployed: api-deploy `33765530602`, executive-engine-deploy
`33765530827`, both `success`. The route alone had already deployed at `99ed368` (api-deploy
`33764335460`).

## Why the route extends `masterContext.ts` and not `appSearchPrefs.ts`

`appSearchPrefs.ts` is the existing owner-scoped settings write route and would have been the
"extend, don't duplicate" answer on shape alone. It was rejected on payload: its body is a handful
of scalars read on **every** Settings load, and these are 14 free-text blocks that run to tens of
thousands of characters. Folding them in would drag the owner's entire profile over the wire on
every unrelated prefs read, and put two different data shapes (one row per owner vs many rows per
owner) behind one endpoint. What IS shared is the auth and partial-update **shape**, copied from it
deliberately — so the pattern is reused even though the endpoint is not. `masterContext.ts` is the
ONE accessor for this data (`H:mastercontext-one-accessor`), which is where a reader and a writer of
the same thing belong.

## The three Tier-1 locks, and where each lives now

| lock | how it is enforced |
|---|---|
| `itemsToOmit` stays unwritable | not in `MC_KIND`; the route refuses an unknown key BEFORE any query runs; the DB CHECK is behind that. Three lines, and the route one means the database is a backstop rather than the only defence. |
| `''` is a value, absent is a different fact | the column is `not null default ''` on purpose. `readMasterProfile` returns `stored` per block, so the screen renders "N characters saved" or "never set" — the distinction reaches the owner instead of being collapsed on the way. |
| a write cannot target another owner | `requireWrite(req)` runs first, before a DB connection is opened; the owner then comes from the VERIFIED session. `?owner=` is a READ affordance and is never read on the write path. |

Partial update is the fourth property and is not a lock but a correctness one: only the keys present
in the body get a statement, so saving one field cannot rewrite the other thirteen with whatever the
form was holding.

## Guards — nine, every one mutation-proved

Run with `/workspace/eds-claude-skills/scripts/mutate.sh`, absolute `cd` in the test command. Each
row is the literal mutation applied and the harness's verdict.

| guard | mutation | verdict |
|---|---|---|
| `H:master-profile-editor-rejects-unknown-key` | delete the pre-query refusal | FIRED |
| `H:master-profile-editor-partial-update` | iterate all 14 keys instead of the body's | FIRED |
| `H:master-profile-editor-empty-is-a-value` | add `if (!v) continue` | FIRED |
| `H:master-profile-editor-reader-distinguishes-absent` | `stored: true` unconditionally | FIRED |
| `H:master-profile-editor-requires-write-guard` | delete the `requireWrite` pair | FIRED |
| `H:master-profile-editor-owner-from-session` | re-add `req.query.get('owner') \|\|` | FIRED |
| `H:master-profile-ui-keeps-edits-on-failure` | move `setSaved` above the response check | FIRED |
| `H:master-profile-ui-sends-only-changed` | build the patch from every block | FIRED |
| `H:master-profile-ui-standing-note` | gate the note on `note?.ok`; then delete the note | FIRED (both) |

Two of the six API guards spy on the **query calls**, not the end state. That is deliberate: an
unconditional `update ... set text = text` leaves every row byte-identical while writing 14 rows and
bumping 14 `updated_at`s, so an end-state assertion cannot tell a partial update from a full resave.

## Live verification

**Read path — CONFIRMED.** `ui-verify` run `33766020552`, route `#/settings/profile`, owner
`von.ellis@enterpriseds.io`. `missingExpect: []`, `consoleErrors: []`, and the rendered body carries:

- the new **Master profile** chip in the Settings nav, between Account and Intake;
- the heading and the intro line;
- the standing note in full: *"Packets already built keep their original wording. Editing here
  changes what future packets are built from — it does not rewrite anything you have already
  produced."*;
- **`Work history 1  671 characters saved`** — a real length from a real `owner_master_block` row.
  This is the `stored` distinction rendering against production data, not a fixture.

`GET /api/app/master-profile` also answered 2xx through `api-test` run `33766006624`. The response
body was deliberately NOT pulled into the session transcript: it is the owner's whole profile text,
and the rendered screen above already proves the same read.

**Refusal path — see the api-test run recorded in `.claude/actions.md` for
`{"blocks":{"itemsToOmit":"..."}}`.** The route must answer 4xx and write nothing.

**Write path — NOT yet confirmed live.** The owner saving a block in their own browser is the
outstanding evidence, and the reason this record does not say "done".

## Two misses worth keeping

1. **The route shipped with two of the AC pass's four guards missing — the AUTH pair**, i.e. the two
   on the Tier-1 path. The AC document listed all four. A green suite cannot surface this: it runs
   the tests that exist, and says nothing about the ones the ACs asked for and the diff lacks.
   Reading the ACs against the diff before calling a commit complete is the only check that catches
   it.
2. **`H:master-profile-ui-standing-note` was INERT on its first mutation.** It scanned a fixed
   240-character window before the note text for a conditional; `{note?.ok && (` fell roughly twelve
   characters outside it, so the guard read a region that could not contain what it was looking for
   and passed with its defect reinstated. Replaced with a structural check on the note's own opening
   tag, then re-proved two ways. A window width is a magic number; the enclosing tag is a fact about
   the code — and this guard would have shipped believed had the mutation not been run.

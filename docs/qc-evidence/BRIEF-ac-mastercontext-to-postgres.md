<!-- WHAT:       AC brief for moving the owner's master profile text out of the Azure Storage table
                 `MasterContext` and into Postgres.
     WHY:        TIER 1. `masterBaseline` is the BASELINE every swap row compares against, so this
                 decides provenance and the fixed-slot pairing. It is also the owner's own words --
                 the thing the whole product is built to place.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   .claude/DEFERRED.md D:master-context-lives-in-the-wrong-store; the read-site sweep
                 below, run 2026-09-02. -->

# AC BRIEF — MasterContext into Postgres (loop 1)

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`.
**Write into `docs/qc-evidence/AC-mastercontext-to-postgres.md` AS YOU GO**, committing and pushing
after each section:

    git add docs/qc-evidence/AC-mastercontext-to-postgres.md \
      && git commit -q -m "AC mastercontext-to-postgres: <section>" \
      && git push -q origin claude/incumbent-wins-swap

This container restored six times today. A commit that is not pushed dies with it. **Another writer
may be on this branch** — if a push is rejected, fetch and merge rather than force.

## THE OWNER'S INSTRUCTION

> *"save and track this as the very first thing we work on once UI is updated to pass all
> steps/tabs to be able to execute exactly what the prototype does."*

And on the shape, when a mirror was proposed: *"what would be the point of us having both?"* — so
Postgres becomes the READ path, not a second live copy.

**Note the seed fact below sharpens this rather than contradicting it.** Because nothing writes the
Storage row, keeping it after the cut is not a "mirror" in the sense the owner rejected — there is
no second writer, so the two can never disagree. It is a cold backup of an unreproducible seed, and
that is why §"THE WRITER QUESTION" requires the migration to delete nothing.

## WHAT IS WRONG TODAY — three costs, all measured, none theoretical

1. **A single global partition.** Every read filters `PartitionKey eq 'context'` — ONE row for
   everybody — while all 30 Postgres tables are keyed on `owner_email`. `diagSkillSources.ts:23-25`
   already flags this as a data-separation defect in its own comment.
2. **Unreachable by the DB connector.** Storage Tables are a different Azure service from Postgres,
   so no connector state fixes it. Reading this data needs a Function route and a workflow
   round-trip; every other table in the product is one query away.
3. **A Storage round-trip inside every artifact build, with errors swallowed** —
   `appInsertions.ts:33` catches and continues, so a Storage blip silently degrades provenance
   instead of failing loudly.

## THE FINDING THAT SHAPES THE WORK — there is NO single accessor

Swept 2026-09-02:

```
grep -rn "PartitionKey eq 'context'" api/src --include=*.ts | wc -l    ->  10
```

**10 raw read sites across 9 files**, each opening the table itself:

| File | In the product? |
|---|---|
| `pipeline.ts` (**twice**, `:209` and `:391`) | YES |
| `appApply.ts`, `appFacts.ts`, `appInsertions.ts` | YES |
| `diagSkillSources.ts` | YES (diagnostic route) |
| `mt13.ts`, `mt14.ts`, `mt18.ts`, `mt19.ts` | legacy MT-XX harness — **NOT the product** per `CLAUDE.md` |

The closest things to shared code are `loadMasterBaseline` (`appInsertions.ts:25`) and two PURE
transforms — `masterBaseline` (`evidence.ts:239`) and `profileFromMasterContext` (`pipeline.ts:94`).
None of them is a loader every site funnels through.

**The implementer's claim to verify or refute:** the first commit must introduce ONE accessor and
move every production read behind it, with the Storage backing unchanged — and only then swap the
store. Swapping the store first means nine simultaneous edits with no way to bisect a failure.
**Say whether that sequencing is right, or whether a straight cut is safer.**

## PUBLISH THE FEASIBILITY TABLE FIRST

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|

Cover at least: the exact entity shape and field names (the WRITER question is settled below — do
not spend the pass re-deriving it); `masterBaseline`'s output contract and
every consumer of it; `isPooledMasterField`; the proposed table's shape against the DEFERRED row's
suggestion of `owner_master_block(owner_email, merge_field, text, seq)`; and whether `AppConfig`,
`Prompts` or `JobApplications` share the accessor being introduced.

## WHAT THE ACs MUST COVER

`Given <context>, when <action>, then <observable outcome>.` Binary. At minimum:

1. **No build silently loses the baseline.** Today a Storage failure is swallowed and provenance
   degrades quietly (`appInsertions.ts:33`). State what the Postgres path does instead, and note
   that "fail loudly" must not mean "a transient DB blip blocks every build".
2. **The migration is idempotent and re-runnable**, and states what happens if it runs twice.
3. **Ordering / deploy window.** `api-deploy.yml` deploys CODE before it calls `pg-migrate`, so a
   read path depending on the new table 500s in between. Say what ordering is required. This repo
   has four migration-killing ordering defects in its history (`H39`/`H39b`), none visible by
   reading.
4. **Per-owner from the first write.** The point of the move is that the global partition ends; a
   table that lands with one row for everybody has migrated the defect.
5. **`masterBaseline`'s output is byte-identical across the cut** for the owner's real data — this
   is the BASELINE every swap row's "original" compares against, so a change here silently rewrites
   provenance on every packet. Say how that equality is demonstrated rather than assumed.
6. **Rollback.** If the Postgres path is wrong, what gets the owner's builds working again?
7. **Guards, each mutation-provable** with `/workspace/eds-claude-skills/scripts/mutate.sh` — an
   ABSOLUTE `cd` in the test command, and the command must emit raw TAP (the harness greps
   `not ok .*<test name>`, so a pipe through `grep -q` makes every verdict meaningless).

## THE WRITER QUESTION IS ANSWERED — do not re-open it

**The owner settled this 2026-09-03: *"it was a one time update that seeds the storage it never gets
updated or overwritten."*** Corroborated in code the same day — ten Storage writers exist in this
repo (`config.ts`, `apps.ts`, `processJob.ts`, the MT-XX harness), and **not one targets the
`context` partition**:

    grep -rnE "createEntity|upsertEntity|updateEntity" api/src   # 10 hits, none on 'context'

**This makes the migration the EASY case, and the brief previously overstated it as a blocker.**
There is no second writer, so there is no dual-write window, no staleness digest, and nothing to
reconcile. It is a one-time copy: read the row, write the rows, switch the readers.

### What the seed fact DOES change, and both belong in your ACs

**1. THE MOVE IS THE PREREQUISITE FOR A WRITER THE OWNER DOES NOT HAVE.** If the text is seeded once
and never updated, the owner cannot change their own master profile today without hand-editing Azure
Storage. That is precisely what `CLAUDE.md`'s "no hardcoded config" rule forbids — *"every setting…
a user would reasonably want to control MUST be exposed as a user-changeable setting"* — and their
master text is the most owner-specific value in the product. **Say whether the writer belongs in this
work or is a separate follow-on**, but do not treat "there is no writer" as merely a fact about
today; it is an open gap in the product.

**2. THE SEED IS THE ONLY COPY, so the migration must be NON-DESTRUCTIVE.** Nothing regenerates it.
The Storage row must survive the cut as a cold backup, and the ACs must require: copy, prove
`masterBaseline` returns byte-identical output for the owner's real data, switch readers, **delete
nothing**. A migration that moves and then tidies up has no way back.

## BINDING RULES

- **NEVER read or edit any prompt in the Prompts table.**
- Absent evidence is `NOT_APPLICABLE`, never a pass.
- Do not propose weakening any existing guard or refusal.
- Every verdict cites a command you ran and its output.
- **Measure across the population, not one row.** A `limit 1` cannot settle a question about
  pipeline behaviour — that mistake was made and caught earlier today.

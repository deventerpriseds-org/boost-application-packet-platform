<!-- WHAT:       AC brief for Option A -- record item provenance at ASSEMBLY time instead of
                 re-deriving it after the text has moved on.
     WHY:        TIER 1. It decides `skill_candidate.origin`, a stored provenance claim about who
                 changed a line, and today that claim is FALSE by construction on live data.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   db-query run 33635773017; .claude/DEFERRED.md rows
                 D:swap-screen-reads-a-dead-pass and D:lineage-winner-is-none. -->

# AC BRIEF — assembly-time provenance (Option A)

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`.
**Write your findings into `docs/qc-evidence/AC-assembly-time-provenance.md` AS YOU GO** — append
after each section rather than composing one answer at the end. This container has been restored
several times today and a restore kills you with no notice; anything not written is lost.

Commit and push after each section:

    git add docs/qc-evidence/AC-assembly-time-provenance.md \
      && git commit -q -m "AC assembly-time-provenance: <section>" \
      && git push -q origin claude/incumbent-wins-swap

## THE PROBLEM, as measured

`db-query.yml` run `33635773017`, opportunity `9f9c370a`, live production Postgres:

```
kind    |      slot        | winner | c1_eq_c2 | len_c1 | len_c2 | len_c3
LINEAGE | RelevantBullets1 | none   | false    |  71    |  71    |   0
LINEAGE | RelevantBullets2 | none   | true     |  73    |  73    |   0
LINEAGE | RelevantBullets3 | none   | true     |  73    |  73    |   0
LINEAGE | SkillsBullets1   | call2  | false    | 233    | 236    |   0
LINEAGE | SkillsBullets2   | none   | false    | 240    | 228    |   0
```

Two defects, one root cause — **provenance is re-derived after the text has already moved on**:

1. `swaps.ts:494` stamps `origin: originOf(fin, 'pass_b')` on every final item Call 1 did not
   produce. `pass_b` means Call 3 (`LIST_FIELDS[*].passB` are the `final*` fields). Call 3 emitted
   **0 characters for all five** of those fields, so the credited pass produced nothing.
2. `skillLineage(c1,c2,c3,pkg)` (`packetBuild.ts:128`) picks a winner by `sameList(final, callN)`
   against the SHIPPED package, but `applyCorrectionPass` (`appPackets.ts:409`) and the
   master-baseline merge both run first, so nothing matches and `winner` is `none` on 4 of 5 slots.

**Precedence trap, note it:** `skillLineage` tests `call2` BEFORE `call1`, and `c1_eq_c2` is true for
RelevantBullets2/3 (73 chars each). So `winner='call2'` never meant "Call 2 changed it" — it means
"the shipped text equals Call 2's output", which is also true when Call 2 passed Call 1 straight
through. Any fix that preserves this ordering preserves the ambiguity.

## THE PROPOSED CHANGE (Option A, owner-approved in direction)

Record each item's producing pass at **assembly time** — inside/next to `assemblePackage`
(`mt17.ts`), where c1, c2 and c3 are all in hand and no correction has run yet — and have both
`skill_candidate.origin` and `last_build.lineage` READ that stored fact instead of re-deriving it.

Known cost: `skill_candidate.origin` has `check (origin in ('profile_original','pass_a','pass_b'))`
(`schema.ts:611`), which has no value meaning "Call 2", so this needs a fourth value and a
production migration.

## PUBLISH THIS TABLE FIRST, BEFORE ANY AC

One row per dependency the work names. Verdict is `EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED` /
`ALREADY BUILT`. `ALREADY BUILT` is a first-class outcome — say it first and write a regression
guard instead of a feature.

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|

At minimum cover: `assemblePackage`'s inputs and whether it can see per-item origin at all;
`call2Draft`/`mergeCallTwo`; `skill_candidate.origin`'s writer and readers; `last_build.lineage`'s
writer and readers; the `origin` CHECK constraint and every DDL home it has; `applyCorrectionPass`'s
position relative to `writeSwaps`.

## THE CLAIM YOU MUST TRY HARDEST TO FALSIFY

**I claim both fields are WRITE-ONLY — that `skill_candidate.origin` and `last_build.lineage` have
no reader anywhere, so fixing them changes nothing the owner can currently see.**

This is the heaviest and least reliable kind of claim I make, and I have got it wrong before in this
exact shape ("there is no Undo control" — it was mounted, imported from another file). What I ran:

- `grep -rn "skill_candidate" api/src` — reader is `select * from skill_candidate` (`appSwaps.ts:202`)
- `grep -rn "lineage" app/src` — no hits
- `grep -rn "/swaps" app/src` — three callers: `AssetBlocks.jsx:71`, `QcRail.jsx:820`,
  `AssetGateDrawer.jsx:496`
- `grep -nE "candidates|\borigin\b"` in those three — only `AssetBlocks.jsx:1105/1113`, and that
  `swap.candidates` is `keywordSwapOptions`' skill bank, NOT the swaps payload

**Attack it.** A consumer can reach these through a destructured rename, a spread into another
object, a computed key, a selector in a shared hook, a test fixture that encodes the shape, or a
re-export. Follow the import lists, not just the filenames. If you find ANY reader, say so loudly —
it changes whether a production migration is worth paying for, which is the owner's open question.

## WHAT THE ACs MUST COVER

Write them as `Given <context>, when <action>, then <observable outcome>.` Binary and specific;
"works correctly" is not an AC. Cover at least:

1. **Truthfulness.** No item may be labelled with a pass that emitted zero characters for that
   field. State how a test proves this on the real shape rather than a hand-built fixture — check
   whether the system can actually PRODUCE your fixture (two fixtures were wrong this session for
   exactly this reason).
2. **The Call-1-passthrough case.** Call 2 returning Call 1's list unchanged must NOT be recorded as
   Call 2 having produced it. This is the live case for RelevantBullets2/3.
3. **Absent evidence.** A build where a call is missing or unparsed yields an honest "unknown", never
   a confident wrong pass. This repo's rule: absent evidence is `not_applicable`, never `pass`.
4. **Migration safety.** The new enum value must reach production. Note that `api-deploy.yml` deploys
   CODE BEFORE `pg-migrate` runs, so a read path depending on a column or constraint that only the
   migration adds will 500 in between. Say what ordering is required.
5. **Backfill.** Rows already written with the false `pass_b` label — corrected, left, or marked?
   State which, and why it is honest.
6. **Regression guards**, each one mutation-provable with
   `/workspace/eds-claude-skills/scripts/mutate.sh`. Put an absolute `cd` in the test command —
   omitting it produced four false `INERT` verdicts this session, and the harness cannot distinguish
   "the guard did not fire" from "your command never ran".

## ALSO ANSWER, PLAINLY

**Is this worth a production migration at all, given the write-only finding?** If the honest answer
is "write a regression guard and defer the migration until something reads the field", say that. The
owner approved the direction before that finding existed, and an AC pass that rubber-stamps a
migration whose premise just weakened is worth nothing.

## BINDING RULES

- Absent evidence is `NOT_APPLICABLE`, never a pass.
- **NEVER read or edit any prompt in the Prompts table**, and do not propose changing one.
- Do not propose weakening any existing guard or refusal.
- Ground every verdict in a command you ran and its output. "Looks correct" is banned.

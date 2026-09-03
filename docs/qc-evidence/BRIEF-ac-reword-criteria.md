<!-- WHAT:       The SECOND half of the reword AC pass -- the acceptance criteria themselves.
     WHY:        TIER 1. The first pass (AC-reword-carries-the-link.md) delivered the feasibility
                 table and settled three design questions, then STOPPED at the end of section 4
                 without writing a single criterion. Implementation cannot start without them.
     SUPERSEDES: nothing. This is the CONTINUATION of AC-reword-carries-the-link.md, not a replacement.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   docs/qc-evidence/AC-reword-carries-the-link.md sections 1-4, whose findings this
                 brief carries forward as SETTLED. -->

# AC BRIEF — the reword criteria (continuation pass)

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`.
**Write into `docs/qc-evidence/AC-reword-criteria.md` AS YOU GO**, committing and pushing after
each section:

    git add docs/qc-evidence/AC-reword-criteria.md \
      && git commit -q -m "AC reword-criteria: <section>" \
      && git push -q origin claude/incumbent-wins-swap

This container restored six times today. A commit that is not pushed dies with it. Another writer
may be on this branch — if a push is rejected, fetch and merge rather than force.

## YOUR JOB, AND WHAT IT IS NOT

**A previous pass already did the feasibility work.** Read
`docs/qc-evidence/AC-reword-carries-the-link.md` — it is on disk, in this repo. It published the
feasibility table, verified the ordering argument, settled the table-vs-column question and settled
the redundancy question. It then ended mid-document with **no acceptance criteria at all**.

**DO NOT re-derive sections 1-4.** Read them, treat their verdicts as inputs, and spend the whole
pass on what is missing: the criteria, the migration ordering, and the guards.

### The four findings you inherit as SETTLED

| # | Finding | Verdict |
|---|---|---|
| 1 | `correction` is the right TABLE — it already carries `phrase`, `replacement`, `char_start/end`, `before_sha256`, `applied_seq`, `reason`, `source`, `frame`, `loop`, revert columns, and a span-matches-phrase CHECK | HOLDS — extend it, do not build a table |
| 2 | The new column is **`requirement_text`, NOT `requirement_id`** | `requirement_id` REFUTED — `writeRequirements` (`appRequirements.ts:506`,`:535`) runs unconditional `delete from requirement where opp_id=$1` on every JD re-parse. `requirement_coverage` (`schema.ts:553-555`) and `evidence_confirmation` (`:518-520`) both key on TEXT and say why in their own comments |
| 3 | The reword belongs inside `ensurePackage`, after `applyCorrectionPass` (`appPackets.ts:565`) and before the `update packet set pkg_json` write (`:626`) | HOLDS — `evaluateArtifact` re-reads `pkg_json` fresh from the DB (`appChecks.ts:47`), so anything written after that write is scored on text that never shipped |
| 4 | The reword link and `chk_coverage_judge` are two producers feeding two DIFFERENT score components (`keyword_coverage` vs `must_have_coverage`), not one system built twice | HOLDS — not a parallel-system violation |

**One inherited finding is a live tension you must resolve in the ACs, not restate.**
`figureEcho.ts:422-445` is a standing, deliberate design REFUSAL against machine-rewriting prose:

> *"Nothing here rewrites prose, and nothing downstream may: a phrase can be the employer's house
> style, the industry's standard term, or the candidate's own sentence that happens to read like
> the ad. Only the user can tell which, and a machine that rewrites prose on a guess produces a
> resume the candidate did not write and cannot defend."*

The reword pass proposes to do the thing that comment forbids, in a narrower scope. **Write the AC
that makes the narrowing enforceable rather than aspirational** — what, concretely, keeps a reword
from touching the candidate's own accomplishment prose? Read `mergeFieldsFor('resume')` and decide
whether "ResumeSummary only" is a real boundary or a convention someone widens next month. If the
answer is that the refusal should win and the reword should be owner-confirmed rather than
automatic, **say that** — the owner's instruction asks for the outcome, not for a specific degree
of automation.

## THE OWNER'S REQUIREMENT, in their words

> *"it needs a final step to take what it lands on and use synonyms etc to make sure the resume
> summary means verbatim but doesn't read verbatim. it's not stuffing if it uses the well scored
> output but doesn't use the exact same words."*

> *"just score the keyword matching in the prize reword section before the final replacement round
> and link what the paraphrase/synonym covers like the prototype does with its highlights on the
> packet and panel... both need to connect to the requirement in the UI regardless."*

## THE MEASURED DEFECT the ACs must close

Live eMoney packet (opp `2cb56fb3`), `ResumeSummary` against that posting's own requirements:

| Shipped summary says | Requirement |
|---|---|
| "establishing governance and risk management practices" | **#10** "Establish governance, security, and risk management practices" |
| "building high-performing global teams" | **#17** "Build, lead, and inspire a high-performing global organization" |
| "AI-first transformations" | **#9** "Define and execute an AI-first engineering strategy" |
| "delivering scalable, resilient platforms" | **#23** "delivering complex, scalable, enterprise-grade platforms" |

Trinnex (`9f9c370a`) is CLEAN by the same test. **The behaviour is not uniform across packets, and
an earlier pass of this work generalised from Trinnex alone and had to be reverted.** Any
measurement you make must cover every packet — a `limit 1` or a single-id `where` cannot settle a
question about pipeline behaviour.

Note the inherited finding that neither existing detector catches these: `scanEcho`
(`figureEcho.ts:344`) is numeric figures only; `scanWording` (`:498`) needs an EXACT CONTIGUOUS
8-token run, and the dropped word "security," breaks contiguity on the very first row above.

## WHAT THE ACs MUST COVER

`Given <context>, when <action>, then <observable outcome>.` Binary — "works correctly" is not a
criterion. At minimum:

1. **The reword does not change meaning.** State how a test proves this WITHOUT a model in the loop.
   If no such test is possible, say so plainly and state what the fallback control is — an
   `NOT_APPLICABLE` here is an honest answer; a hand-wave is not.
2. **Every link points at real text.** A stored link whose `phrase` is not actually in the shipped
   field is a false claim of coverage — accusation-grade. The existing
   `correction_span_matches_phrase` CHECK (`schema.ts:426`) is the precedent to extend.
3. **A reword that finds no substitute leaves the text alone** and records that it did nothing.
   Absent evidence is `not_applicable`, never a silent pass.
4. **Coverage from a LINK is distinguishable from coverage from a PHRASE MATCH** wherever it is
   shown or stored. The owner must be able to tell "your words cover this" from "you used their
   words".
5. **`ATS_SHIPPED_FIELDS` and `ResumeSummary`.** The inherited table says the exclusion
   (`atsKeywords.ts:212-215`) is a REAL guard against self-scoring, and that re-including
   `ResumeSummary` is safe only if gated on the reword having actually run, or counted only via the
   link. **Write the AC that decides this**, and state what the number does — the owner asked for
   this exclusion to be reconsidered and fixed, not deferred.
6. **The refusal in `figureEcho.ts:422-445` is honoured**, per the tension section above.
7. **Ordering / migration safety.** `api-deploy.yml` deploys code at `:81` and runs the migration at
   `:109` — code ships FIRST, so a read path depending on the new column 500s in the window between.
   `ensureCorrectionTable()` (`appCorrections.ts:63-96`) already self-heals `correction` on every
   route entry, including `alter table correction add column if not exists frame text` (`:89`).
   Say what ordering is required and whether that precedent closes the window.
8. **The three DDL homes stay in parity.** `schema.ts` (inline CHECK + idempotent ALTER),
   `appCorrections.ts:75`, `api/test/sql/correction.sql:30`. `H:correction-ddl-parity`,
   `H:correction-source-widened-by-alter`, `H:correction-ddl-column-parity`
   (`api/test/correctionDdlParity.test.mjs:35,63,104`) already assert this — say whether they
   catch a 4th `source` value and a new column by name, or whether they are structurally blind to
   one of them.
9. **Guards, each mutation-provable** with `/workspace/eds-claude-skills/scripts/mutate.sh` — an
   ABSOLUTE `cd` in the test command, and the command must emit raw TAP (the harness greps
   `not ok .*<test name>`, so a pipe through `grep -q` makes every verdict meaningless).
   Name the guard, the file, and the exact mutation that must make it FIRE.

## ALSO STATE, in one short section at the end

**The smallest first commit.** This work touches a schema home, a pipeline stage, a score component
and a UI mark type. Say what the first commit should contain such that it is independently
revertable and proves something — and what it must NOT contain.

## BINDING RULES

- **NEVER read or edit any prompt in the Prompts table**, and do not propose changing one. The owner
  has said repeatedly that their original prompts drive the draft.
- Absent evidence is `NOT_APPLICABLE`, never a pass.
- Do not propose weakening any existing guard or refusal.
- Every verdict cites a command you ran and its output.
- **Measure across the population, not one row.**

<!-- WHAT:       AC brief for the ResumeSummary reword pass and the paraphrase -> requirement link.
     WHY:        TIER 1. It admits model output into a stored claim ("this paraphrase covers
                 requirement #10") that feeds keyword coverage, a component of the composite score.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   .claude/accuracy-log.md 2026-09-02 (the n=1 miss that scoped this correctly);
                 eMoney packet 4860ae3b / opp 2cb56fb3 measured below. -->

# AC BRIEF — the reword carries the link (loop 1)

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`.
**Write into `docs/qc-evidence/AC-reword-carries-the-link.md` AS YOU GO**, appending per section and
committing + pushing after each:

    git add docs/qc-evidence/AC-reword-carries-the-link.md \
      && git commit -q -m "AC reword-carries-the-link: <section>" \
      && git push -q origin claude/incumbent-wins-swap

This container has restored five times today; a commit that is not pushed dies with it.

## THE PROBLEM, measured

`ResumeSummary` carries the employer's own sentences, lightly edited. Live eMoney packet
(opp `2cb56fb3`), summary against that posting's own requirements:

| Shipped summary says | Requirement |
|---|---|
| "establishing governance and risk management practices" | **#10** "Establish governance, security, and risk management practices" |
| "building high-performing global teams" | **#17** "Build, lead, and inspire a high-performing global organization" |
| "AI-first transformations" | **#9** "Define and execute an AI-first engineering strategy" |
| "delivering scalable, resilient platforms" | **#23** "delivering complex, scalable, enterprise-grade platforms" |

The first is the requirement sentence with two words deleted.

**Trinnex (`9f9c370a`) is CLEAN by the same test** — its summary is genuine paraphrase and contains
zero of its nine ATS keywords. The behaviour is not uniform across packets, and an earlier pass of
this work generalised from Trinnex alone and had to be reverted. **Any measurement you make here
must cover every packet, not one.** A query with `limit 1` or a single-id `where` cannot settle a
question about pipeline behaviour.

## THE OWNER'S REQUIREMENT, in their words

> *"it needs a final step to take what it lands on and use synonyms etc to make sure the resume
> summary means verbatim but doesn't read verbatim. it's not stuffing if it uses the well scored
> output but doesn't use the exact same words."*

> *"link what the paraphrase/synonym covers like the prototype does with its highlights on the
> packet and panel... both need to connect to the requirement in the UI regardless."*

## THE PROPOSED DESIGN — challenge it

1. **A final reword pass** over `ResumeSummary`, after the content is settled. It keeps the meaning
   and the value points; it replaces the employer's literal phrasing.
2. **The reword EMITS THE LINK as it works** — it is the only place in the pipeline holding both
   strings at once, so it can record `paraphrase span -> requirement -> the original phrase`.
3. **Scoring still reads the SHIPPED text.** A paraphrased span counts because the stored link says
   what it covers, not because a matcher found the employer's words.
4. **`Marked` renders it.** `AssetBlocks.jsx:669` already highlights `phrases` with an `active`
   term — the prototype's `kw-mark`/`echo-mark` margin-to-text behaviour. Nothing new is drawn.

### The ordering argument, which you should attack

The owner asked whether to score BEFORE the final replacement round. The implementer said no,
because a score computed on pre-reword text describes a document that never ships — and that is
exactly the live defect fixed earlier today, where Call 1's ATS table described a superseded draft
and reported 0% on a resume placing 67%. **Test whether that reasoning actually holds here**, or
whether scoring the pre-reword text and carrying the number forward is defensible.

### EXTEND, DON'T DUPLICATE — the implementer's claim to verify

`correction` (`schema.ts`) already has `phrase`, `replacement`, `char_start`, `char_end`,
`before_sha256`, `applied_seq`, `reason`, `source`, `frame`, `loop`, revert columns, and a
constraint that the span must match the phrase length. The implementer claims the reword is
**a new `source` value plus ONE new column (`requirement_id`)** on that table — not a new table.

**Verify or refute that.** If `correction` is the wrong home, say why. Note `source` has a CHECK
constraint that a fresh value must be added to, and this repo's H39/H39b rule: on production,
`create table if not exists` is a no-op, so a new value needs an explicit `ALTER`, ordered after
anything that references it.

## PUBLISH THE FEASIBILITY TABLE FIRST

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|

Cover at least: `correction`'s writer and readers; `correction.source`'s CHECK and every DDL home;
`Marked`/`phrases` and who supplies them; `requirement.verbatim`; where a reword pass would sit
relative to `applyCorrectionPass` and `normalisePackage`; whether `ATS_SHIPPED_FIELDS` should then
include `ResumeSummary`, and what that does to the number.

## WHAT THE ACs MUST COVER

`Given <context>, when <action>, then <observable outcome>.` Binary. At minimum:

1. **The reword does not change meaning.** State how a test proves this without a model in the loop.
2. **Every link points at real text.** A stored `requirement_id` whose phrase is not actually in the
   shipped field is a false claim of coverage — the accusation-grade failure this repo bans. The
   existing span-matches-phrase constraint is a precedent to extend.
3. **A reword that finds no substitute leaves the text alone** and records that it did nothing.
   Absent evidence is `not_applicable`, never a silent pass.
4. **Coverage from a link is DISTINGUISHABLE from coverage from a phrase match** wherever it is
   shown or stored. The owner must be able to tell "your words cover this" from "you used their
   words".
5. **Ordering / migration safety.** `api-deploy.yml` deploys code BEFORE `pg-migrate`, so a read
   path depending on the new column 500s in the window between. Say what ordering is required.
6. **Guards, each mutation-provable** with `/workspace/eds-claude-skills/scripts/mutate.sh` — use an
   ABSOLUTE `cd` in the test command, and remember the harness greps raw TAP for
   `not ok .*<test name>`, so the command must emit TAP rather than be piped through `grep -q`.

## ALSO ANSWER

**Does the semantic judge (`chk_coverage_judge`) make the reword link redundant, or are they
genuinely two producers feeding one UI?** The implementer claims two: the link covers text the
pipeline deliberately rewrote, the judge covers the owner's existing prose that happens to answer a
requirement. If that is a distinction without a difference, say so — building both would be the
parallel-system failure this repo forbids.

## BINDING RULES

- **NEVER read or edit any prompt in the Prompts table**, and do not propose changing one. The owner
  has said repeatedly that their original prompts drive the draft.
- Absent evidence is `NOT_APPLICABLE`, never a pass.
- Do not propose weakening any existing guard or refusal.
- Every verdict cites a command you ran and its output.

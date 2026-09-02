<!-- WHAT:       Verifier brief for the "proposals count until vetoed" lane -- the gate change, the
                 veto data model, and the veto UI.
     WHY:        TIER 1: this code decides whether a requirement counts toward must_have_coverage,
                 which feeds the artifact gate and the score. The implementer mutation-proved its own
                 guards; that is self-reported and does not satisfy independent verification.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   the artifact this produces, docs/qc-evidence/VERIFY-veto-lane-1.md -->

# VERIFY BRIEF — proposals count until vetoed (loop 1)

## VERIFY LOOP
work: veto-lane
loop: 1

Loop 1: there is no prior state to carry. Nothing in this lane has been independently verified
before, so every claim below is a first derivation at full depth — none is being re-checked at
reduced depth, and none is a previously-REFUTED item returning after a fix.

Cheap suite re-run covering EVERYTHING: `cd api && npm test` and `cd app && npm test`, both run in
full as claim C10 rather than assumed from the implementer's report.

CHALLENGE THE RADIUS: the implementer scoped this brief to the veto lane. If the change reaches
further than that — a consumer of `must_have_coverage`, the artifact gate, the score, the
remediation loop, or a screen reading any of them — say so and verify it anyway. The depth
allocation above is the implementer's judgement and you are the check on it being wrong.

You are an INDEPENDENT verifier. You did not write this code. Prove or disprove each claim below
from observable evidence only, and write your artifact **incrementally as you go** to
`docs/qc-evidence/VERIFY-veto-lane-1.md`.

**COMMIT AND PUSH THE ARTIFACT AFTER EVERY CLAIM YOU SETTLE**, on branch
`claude/incumbent-wins-swap`:

    git add docs/qc-evidence/VERIFY-veto-lane-1.md && git commit -q -m "VERIFY veto-lane: <claim>" \
      && git push -q origin claude/incumbent-wins-swap

This is not bookkeeping, it is the only thing that makes your work survive. This container has been
restored THREE times in ninety minutes, and each restore SIGKILLs you with no notice. Measured on
this exact task: the first attempt at this brief settled C10, wrote it to disk, and was killed — the
file survived only because it happened to be on a mounted path, and nothing was committed. A commit
that is not PUSHED is still inside the container and dies with it.

Order the claims cheapest-first so that a death costs the least: C10, C6, C8, C9, C2 (fast), then
C1, C3, C7, C11, then C4 and C5 (a real database). Note C10 is already settled below by the killed
run — RE-RUN IT ANYWAY rather than inheriting it, per the total-coverage rule, but do it first and
quickly.

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap` at
`a1f2b68`. Commits under review: `0d73371`, `620776e`, `9c3fa07`, `3a75eb1`, `a1f2b68`.

**Every claim gets a verdict token — `CONFIRMED`, `REFUTED`, or `NOT_APPLICABLE` — and the evidence
you ran.** Prose without a verdict token does not satisfy the gate this feeds. "Should work" and
"looks correct" are banned; report what you executed and what it printed.

## THE OWNER'S INSTRUCTION THIS IMPLEMENTS

> "I already said proposals can count until vetoed. make room for the vetoed data..."

This DELIBERATELY INVERTS the subsystem's own house rule ("a model may PROPOSE, only an exact rule
may ACCUSE"). The inversion is authorised. **What you are checking is whether it was done safely and
disclosed honestly** — not whether it should have been done.

## CLAIMS

**C1.** A model-proposed evidence row now counts toward `must_have_coverage`, and a vetoed one does
not. (`checks.ts` `ruleEvidenceOf`.)

**C2.** `ruleEvidenceOf` is fail-CLOSED: a `method` value not in its allow-list does not count.
Verify by construction, not by reading the comment.

**C3.** The veto outranks every other warrant, including a `confirmed_at` on the same row. Check the
ORDER, and check what happens on a contradictory row.

**C4.** The reject route writes a row when NO prior confirmation exists. This is the shipped defect
the lane exists to fix — the old branch was an `UPDATE ... where withdrawn_at is null` with no
INSERT, so it matched zero rows and returned `{ok:true}`. Prove the new behaviour against a real
database, not a fixture.

**C5.** A vetoed row cannot read as a confirmation anywhere. The decision join matches EITHER
polarity by design; the claim is that the `case` expression in `loadRequirementsWithEvidence` stops
`evidence_confirmed_at` being set on a vetoed row. **This is the highest-severity claim in the
lane** — if it fails, clicking "Not this one" PROMOTES the row.

**C6.** Every counted row resting on model warrant is disclosed in the same sentence as the number,
named by its strength, and no surface still claims those rows are uncounted. Grep for the retired
strings as well as the new ones.

**C7.** `decision` and `missing` survive the whole path: schema → ensure path → loader SELECT →
`appChecks` mapping → `EvidenceRow` → the requirements endpoint → `evidencePresentation` → the
rendered component. **A break anywhere in that chain is silent** — both fields are optional on the
interface, so `tsc` cannot see a dropped one.

**C8.** The screen and the gate cannot disagree about what counts. `countsNow` duplicates
`ruleEvidenceOf`'s rule; the claim is that a guard fails when they drift.

**C9.** The veto is legible: three states render distinctly, no warrant badge renders beside a veto,
and the `missing` text reaches the control.

**C10.** Suites: `cd api && npm test` and `cd app && npm test`. Run them. The implementer claims
1027/1027 and 427/427.

**C11.** The schema applies to a POPULATED database carrying `origin/main`'s schema — not just a
fresh one. `dimensionsDb.test.mjs` claims to do this; verify it actually applies the WORKING TREE's
schema rather than only main's.

## HOW TO ATTACK THIS, not just check it

1. **Delete each new load-bearing production line and see whether a test fails.** The implementer
   found two INERT mutations this way and wrote guards for both; find a third. Use
   `/workspace/eds-claude-skills/scripts/mutate.sh` (`FIRED` / `INERT` / `NOT-APPLIED` — the third
   means nothing was tested).
2. **One of the implementer's own guards was passing on broken code** — a file-wide grep satisfied
   by an unrelated line two lines below. Assume there are more. Any assertion that greps SOURCE
   rather than exercising behaviour is suspect: check its scope can only match what it names.
3. **Can the system PRODUCE the fixtures?** Three fixtures in this repo carried no `method` and
   passed only because the old check was fail-open — a shape the database cannot emit, since
   `method` is NOT NULL. Look for more of that class.
4. **Who READS what was written?** Grep for a CONSUMER of every new column and field, not just a
   writer.
5. **Try to make a vetoed row count, and a rule-found row not count.** If you can construct either,
   that is the finding.

## WHAT THE IMPLEMENTER MAY HAVE GOT WRONG

State it plainly if so. Known self-reported errors this session, as calibration — the implementer
has been wrong about shapes and about attribution more than once:

- asserted `covered_kw` + `Missing ATS Skills` formed a coverage measurement; an AC pass refuted it
  from the primary source (`jdAnalysis` never sees the candidate),
- conflated `packet.ats_score` with `opportunity.ats_score`,
- quoted a suite baseline that had not been run,
- reported three test failures as pre-existing when they were its own.

## HOUSE RULES BINDING YOUR OUTPUT

- Absent evidence is `NOT_APPLICABLE`, never `CONFIRMED`.
- A check that passed because there was nothing to check against is not a pass.
- Fuzzy matching is for ranking, never for accusing.
- **NEVER read or edit any prompt in the Prompts table.**

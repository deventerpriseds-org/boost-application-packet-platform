<!-- WHAT:       Verifier brief for the interim keyword score (atsKeywords.ts -> appChecks.ts).
     WHY:        TIER 1 -- it produces a score component the owner reads and the composite depends on.
                 It was DEPLOYED on self-report alone; the Stop gate caught that and it is correct.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   docs/qc-evidence/VERIFY-ats-keyword-score-1.md -->

# VERIFY BRIEF — the interim keyword score (loop 1)

## VERIFY LOOP
work: ats-keyword-score
loop: 1

Loop 1: no prior state. Every claim is a first derivation at full depth; none is a reduced-depth
re-check and none is a previously-REFUTED item returning after a fix.

Cheap suite re-run covering EVERYTHING: `cd api && npm test` and `cd app && npm test`, both run in
full as claim C1 rather than taken from the implementer's report.

CHALLENGE THE RADIUS: this brief is scoped to the keyword component and its consumers. **The
implementer's own integration trace found that this change makes previously-dead code in
`appReviewer.ts` reachable for the first time** — so the radius is already known to exceed the file
that changed. If it reaches further still (the artifact gate, `qcSummaryScore`, the tally modal,
`AssetGateDrawer`, anything reading `artifact_score`), say so and verify it anyway.

---

**ALREADY DEPLOYED** — `main` `0c3721e`, api-deploy run `33631740581` success. You are verifying
live code, not a proposal. If something here is wrong, say so plainly and immediately: it is
affecting the owner's packets now.

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`.
Commits: `9503799`, `0c3721e`, `9cbf394`.

**COMMIT AND PUSH AFTER EVERY CLAIM YOU SETTLE**, to `claude/incumbent-wins-swap`:

    git add docs/qc-evidence/VERIFY-ats-keyword-score-1.md \
      && git commit -q -m "VERIFY ats-keyword-score: <claim>" \
      && git push -q origin claude/incumbent-wins-swap

This container has been restored four times today and each restore SIGKILLs you with no notice. A
commit that is not PUSHED dies with it. Order the claims cheapest-first.

**Every claim gets `CONFIRMED` / `REFUTED` / `NOT_APPLICABLE` and the evidence you ran.** "Looks
correct" is banned.

## CLAIMS

**C1.** Suites: `cd api && npm test`, `cd app && npm test`. Implementer claims 1046 and 427, zero
failures. Report pass/fail/skip separately — a previous report collapsed 29 skips into a pass count.

**C2.** On the owner's real table (the `LIVE_TABLE` fixture in `api/test/atsKeywords.test.mjs`, read
from production packet 85cee965), coverage is **6/9**, not 0/9 and not 6/10.

**C3.** The numerator NEVER comes from the table's own column 2. Every cell there reads `Missing`;
six of those keywords are in the shipped text. Try to construct an input where column 2 leaks into
the count.

**C4.** The `<th>` header row is excluded from the denominator, including when a model emits a mixed
`<th>`/`<td>` header.

**C5.** Absent evidence yields `null`, never `0` — no table, empty body, unparseable body, no shipped
text. And a null component nulls the composite rather than producing a partial one.

**C6.** Matching is whole-phrase. `Leadership Experience` must NOT match `Engineering Leadership`.
Fuzzy matching here inflates the number a reviewer trusts most. Try to find a false positive.

**C7.** A published term library STRICTLY overrides the interim source — taken instead of, never
blended or averaged. And the source string never describes an interim number as library coverage.

**C8.** `ResumeSummary` is excluded from the numerator. The remediation loop is known to stuff it
with posting wording, so counting it would let the document score itself on the employer's words.

**C9. THE ONE THE IMPLEMENTER IS MOST LIKELY WRONG ABOUT.** `appReviewer.ts:309` holds a SECOND
composite formula that this change makes reachable. `H:one-composite-formula` asserts the two agree.
**Attack that guard**: it is a source grep, and the implementer has already shipped one guard that
passed on broken code because a file-wide grep matched an unrelated line. Can this one be satisfied
by something other than what it names? Is asserting agreement sufficient, or should the duplicate
have been removed?

**C10.** Non-resume artifacts (`cover`, `portfolio`, `compact_resume`) get `null`, never the
resume's coverage.

**C11.** Nothing regressed in the veto lane that landed in the same merge — `must_have_coverage`,
the veto, the disclosure strings.

## HOW TO ATTACK THIS

1. **Delete each new load-bearing line and see whether a test fails.** Use
   `/workspace/eds-claude-skills/scripts/mutate.sh`. **Put an absolute `cd` in the test command** —
   the implementer got three false INERTs from omitting it, and the harness cannot tell "the guard
   did not fire" from "your command never ran". Before believing an INERT, apply the mutation by
   hand.
2. **Any assertion that greps SOURCE is suspect.** Check its scope can only match what it names.
3. **Can the system PRODUCE the fixtures?** Two fixtures in `hardening.test.mjs` were wrong this
   session (`engine: 'deterministic'` missing, `offenders` absent). Look for more.
4. **Try to make the score lie** — inflate it, deflate it, or make it non-null when it should not be.

## WHAT THE IMPLEMENTER GOT WRONG, AS CALIBRATION

- claimed `covered_kw` + `Missing ATS Skills` was a coverage measurement; an AC pass refuted it
- conflated `packet.ats_score` with `opportunity.ats_score`
- reported three test failures as pre-existing when they were its own
- shipped a guard that passed on broken code (file-wide grep, unrelated line satisfied it)
- broke a merge with a regex conflict-hunk splice that silently shortened two prose files

## BINDING RULES

- Absent evidence is `NOT_APPLICABLE`, never `CONFIRMED`.
- Never fabricate a composite.
- **NEVER read or edit any prompt in the Prompts table.**

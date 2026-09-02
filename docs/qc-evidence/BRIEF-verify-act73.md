## VERIFY LOOP
work: act73
loop: 1

Loop 1: there is no prior state to re-check — every claim below is derived from scratch. Coverage is
total, which on a first loop simply means all of C1-C11 with no row skipped.

# Verifier brief — ACT-73 (PR #73), loop 1

You are an INDEPENDENT verifier. You did not write any of this and must not assume it is correct.
Prove or disprove each claim from observable evidence. Repo: `/home/user/boost-application-packet-platform`,
branch `claude/eds-skills-setup-summary-ngpaos`. Read its `CLAUDE.md` first — its rules bind you too.

**Write your verdicts incrementally to `docs/qc-evidence/VERIFY-act73-1.md` as you go, one claim per
section, appending as you finish each.** Do not hold everything for a final answer. Every claim gets
a literal `CONFIRMED` / `REFUTED` / `NOT_APPLICABLE` token.

This is TIER 1: the guard under test asserts a coverage count and decides a CI gate.

## Claims to verify

**C1.** `app/test/prototypeCoverage.test.mjs` gained 5 guards that REUSE the existing `parse()` and do
not reimplement it. There is exactly one row parser in the file.

**C2.** `H:headline-matches-the-rows` fails when the stated `13-CURRENT` figure disagrees with a
recount of the rows — in BOTH directions: headline edited with rows untouched, AND a row verdict
moved with the headline untouched.

**C3.** The guard's scan window covers `13-CURRENT` ONLY. It must NOT flag `13a`'s frozen
`148 of 183`, `13b`, `13c`, `13d`, or `13-RENDER`'s `83 of 84` — all of which are correct where they
sit. **A guard that fires on correct content is a worse defect than no guard**; test this hard.

**C4.** `H:headline-percentages-follow-its-own-counts` catches a percentage that drifts from its own
stated count.

**C5.** `H:headline-block-is-findable` FAILS (never silently passes) when the anchor heading is
renamed or deleted.

**C6.** Every new guard is genuinely mutation-proven. Re-run the mutations yourself with
`/workspace/eds-claude-skills/scripts/mutate.sh` — do NOT trust the reported outcomes. Specifically
re-check `H:headline-guard-has-exactly-one-row-parser`, which went INERT twice before it fired;
confirm v3 actually fires and is not vacuous in some new way. **Try to find a way to break each
guard that the author did not think of.**

**C7.** `.github/workflows/fixture-refresh.yml`'s new `check_result` join reproduces the LIVE route's
semantics exactly (`api/src/functions/tests/appChecks.ts`: `where artifact_id=$1 and run_id=$2`,
run id from `artifact_gate`), including the no-gate case, and cannot multiply rows.

**C8.** The new `artifact_score` / history keys match what the live route returns, under the key
names `build-fixtures.mjs`'s consumers actually read. Verify against `appChecks.ts`'s response
assembly and the components that consume it — not against the brief.

**C9.** The extended thin-fixture refusal in `build-fixtures.mjs` extends the EXISTING guard rather
than adding a parallel one, and it cannot fire on a legitimate fixture.

**C10.** No `app/src` or `api/src` runtime behaviour changed. `git diff origin/main...HEAD` on those
paths should be empty of behavioural change.

**C11.** Suites actually pass: `cd api && npm test`, `node --test app/test/prototypeCoverage.test.mjs`,
`cd app && npm run build`. Run them; do not take the PR's word.

## Two specific things to attack

- The author claims the doc's prose method ("4th cell, earliest token") and `parse()` agree on 216 of
  221 rows, differing only on five 3-column `4.12-*` rows that are OUT-OF-SCOPE. **Re-derive this
  independently.** If it is wrong, every parity figure quoted today is wrong.
- The author claims 8 of 11 per-section tally lines are stale. Spot-check at least three. If the
  claim is inflated or wrong, say so — it is being used to justify deferring work.

## Ground rules

- "Should work" and "looks correct" are banned. Report only what you ran and saw.
- A guard that passes because there was nothing to test is `NOT_APPLICABLE`, never `CONFIRMED`.
- If you find a defect, state the smallest reproduction and the file:line.

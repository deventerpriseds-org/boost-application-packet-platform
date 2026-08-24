# Acceptance Criteria — human-friendly 1-based requirement numbering

**Owner's request (verbatim):** "I do want human-friendly 1-based numbering"
**Today:** the first requirement chip reads `RQ-MH #0`. The owner wants `#1`.

**Tier:** 1 (accusation grade). The number being changed is parsed back out of persisted text by
`artifactScore.ts:101`, which produces `uncovered_requirement_seqs` — an input to the artifact
score and to `appChecks.ts:139`'s `uncoveredIds`. An off-by-one here names the wrong requirement
as uncovered.

**Written by:** an independent AC subagent with no shared context with the implementing session.
No implementation code is proposed here. Every fact below was verified by reading the file at the
cited line in this working tree (`HEAD` = `cfe4d5f`), not taken from the brief.

---

## Observation vs Interpretation — what the sweep actually found

**OBSERVED (read directly, cite-checked):**

1. `seq` is written **0-based**: `api/src/functions/tests/appRequirements.ts:404-412`,
   `for (let i = 0; i < built.rows.length; i++)` binds `i` to `$2` (`seq`). The loop is preceded
   at line 403 by `delete from requirement where opp_id=$1` — requirements are destroyed and
   re-inserted on every parse.

2. **The brief's list of "SEVEN api writers" is INCOMPLETE.** `grep -rn '#\${[^}]*seq'` over
   `api/src/` returns **thirteen** sites, not seven. The six the brief omits:

   | File:line | Text emitted |
   |---|---|
   | `appRemediation.ts:417` | `` `Requirement #${seq} reads as covered, but this run cannot say what covered it` `` |
   | `appRemediation.ts:442` | `` `Requirement #${seq} is too short for the placement check to judge` `` |
   | `remediation.ts:518` | `` `- [#${r.seq} ${r.kind}] …` `` — **goes into an LLM prompt** |
   | `remediation.ts:786` | `` `${…} #${r.seq} not evidenced in the ${input.artifactType}` `` — a finding **title** |
   | `reviewer.ts:255` | `` `requirement #${req.seq} was never located in the posting …` `` |
   | `reviewer.ts:262` | `` `… but requirement #${req.seq} spans ${…}` `` |

   The seven from the brief are confirmed present: `checks.ts:588`, `checks.ts:594`,
   `checks.ts:616`, `checks.ts:680`, `dimensions.ts:286`, `reviewer.ts:504`, `remediation.ts:539`.

3. **The brief's list of parsers is INCOMPLETE, and this is the load-bearing miss.** The brief
   names one parser (`app/src/qcRail.js:554`). There are **three** `/^#(\d+)\b/` parsers, and
   **two of them are server-side**:

   | File:line | Consumes into |
   |---|---|
   | `api/src/functions/tests/artifactScore.ts:101` | `uncovered` → `uncovered_requirement_seqs` → the **artifact score** and `appChecks.ts:139-141` `uncoveredIds` |
   | `api/src/functions/tests/remediation.ts:218` (`offenderSeqs()`) | `CoverageView.openSeqs` → **the remediation loop's work list** |
   | `app/src/qcRail.js:555` (`offenderSeq()`) | `openSeqs`, `unjudgedSeqs`, `coverageCards`, `rowsForRequirement`, `requirementState` |

   `remediation.ts:217` says so in its own comment: *"Offenders are formatted `#<seq> <text>` by
   `checks.ts`; `artifactScore.ts` parses them the same way."*

4. There is a **fourth** reader that only tests the shape, not the value:
   `app/src/qcRail.js:409`, `if (/^#\d+\b/.test(s)) return 'this is a posting requirement, not a
   field of the document'` — a classifier keyed on the same `#N` prefix.

5. **The `#N` text is PERSISTED.** `check_result.offenders text[] not null default '{}'`
   (`schema.ts:578`), written by `appChecks.ts:145-148`. `check_result` **accumulates by
   `run_id`** — the comment at `appChecks.ts:152-154` states the gate is replaced per artifact
   while *"check_result accumulates by run_id (it is the history)"*. So production holds an
   append-only history of 0-based `#N` strings that is never rewritten.

6. A display formatter `reqChipLabel(kind, seq)` exists at `app/src/postingAnalysis.js:214-223`
   and currently renders the **stored** value. Its doc comment (lines 190-213) is an explicit
   argument *against* the change the owner is now asking for, and names the cost:
   *"It means changing all seven offender writers AND `offenderSeq()`'s parse together —
   accusation-grade code that decides coverage counts."* That comment is **wrong in its count**
   (thirteen writers, three parsers) and must be corrected or deleted as part of this change,
   or it will misdirect the next reader.

7. `QcRail.jsx:811` renders `#{picked.seq}` **raw**, bypassing `reqChipLabel`.

**INTERPRETATION (inference, flagged as such):**

- Because `#N` text is persisted and re-parsed *server-side into a score*, this is not a display
  change. Any strategy that changes the meaning of the digit in `offenders` without also
  disambiguating old rows will silently mis-attribute findings. Confidence: high — the mechanism
  is `artifactScore.ts:101` reading `mh.offenders` from a `check_result` row that may predate the
  change.
- I have **not** been able to query production to count how many `check_result` rows exist with
  non-empty `offenders`. That number is a required input to the decision below and the
  implementer must obtain it (see AC-3).

---

## Acceptance criteria

### Group A — the strategy decision (must be resolved before any code)

**AC-1.** Given the three candidate strategies (A: store 1-based; B: store 0-based and display
1-based; C: versioned/migrated/no-number-in-text), when the implementer begins work, then a
written decision naming exactly one strategy exists in the PR description or in
`.claude/actions.md`, and it states (i) what happens to `check_result` rows written before the
change, (ii) which of the three parsers change, and (iii) which of the thirteen writers change.
A PR that changes any writer or parser without that written decision fails this AC.

**AC-2.** Given strategy **B** (store 0-based, display 1-based, `offenderSeq()` subtracts 1),
when the implementer proposes it, then it is **rejected**, because the same subtraction is applied
to persisted pre-change offender strings that were already 0-based — an old `#0` becomes
requirement `-1` and an old `#3` becomes requirement `2`. The binary test: a `check_result` row
inserted before the change is read after the change and resolves to a *different* requirement row
than it did before. See UNSAFE §1.

**AC-3.** Given that the decision depends on how much 0-based offender text already exists, when
the implementer resolves AC-1, then they have run a live count and recorded the number —
`select count(*) from check_result where offenders <> '{}'` and the same restricted to rows whose
`offenders` contain a `#0`-prefixed element — via `Boost_DB_Connector` (or `db-query.yml` if the
connector is off). A decision recorded without that number is not ground-truthed and fails this AC.

---

*(ACs continue below — this file is written incrementally.)*

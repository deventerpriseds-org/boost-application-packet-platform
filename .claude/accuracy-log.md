# Accuracy log — wrong FIRST answers, and the guard each one earns

One row per wrong-first-answer. The columns that matter are **the single source that would have
settled it up front** and **the guard**, because a story without a guard is the failure this file
exists to stop repeating.

---

## 2026-08-25 — "the term library blocks Row 11" (SELF-BLOCK, owner caught it)

**Claim:** the keyword chips, the keyword-yellow highlight and the SPEC 4.6 detail panel could not be
built because `term_library_entry` has no published rows, so "a highlight with no source would be
invented" (`AssetBlocks.jsx:423`). Reported to the owner as *"Row 11 is unbuildable until the library
publishes."*

**Ground truth:** FALSE. `requirement.model_keyword` is jd_table's ATS Keyword, written by the JD
parse (`requirements.ts:408`), returned by the requirements endpoint (`appRequirements.ts:409,413`),
already reduced to a distinct list by the app (`postingAnalysis.js:258`) and **already rendered on
the JD step** (`PostingAnalysis.jsx:401`). Proposed ATS keywords have been flowing end to end for a
long time. The owner: *"the ai generates keywords from the promtps so you will have several it
suggests term library or not... no matter what the notes ssay its a self block unneccasarily."*

**The source that would have settled it:** `grep -rn model_keyword api/src app/src` — one command,
ten hits, four of them consumers. I never ran it.

**Root cause:** I read a CODE COMMENT as a constraint instead of tracing the DATA. The schema rule is
`never scoreable`, which governs SCORING; I applied it to DISPLAY. A model-proposed term with a label
is honest; a model-proposed term inside a coverage count is not. Those are different questions and
the comment answered only the second.

**Guard:** *A comment stating a limitation is a CLAIM about the code, not the code.* Before repeating
any "X is blocked because there is no Y", grep for Y's actual producers and consumers. If Y has a
writer and a reader, the block is about how Y may be USED, not about whether Y exists — say which.

---

## 2026-08-25 — "there is no Undo control in the field margin"

**Claim:** SPEC 4.5's `Changes made` is missing from the field margin; specifically "NO Undo control",
and the undo route is "consumed ONLY on the QC rail". Briefed to an AC subagent as fact.

**Ground truth:** FALSE, and ~90% of that gap was already built. `CorrectionRow` is imported into
`AssetBlocks.jsx:42` from `QcRail.jsx` and mounted IN THE FIELD MARGIN at `:645` with `inField`,
carrying the Undo button, the reason and the suggest box. One definition, two mounts. The client
export is `revertCorrection` (`api.js:205`); `revertOne` is the SERVER handler and appears in this
file only inside a comment — I had grepped the comment and taken it for the export.

**The source that would have settled it:** the import list at the top of the file I was grepping.

**Root cause:** I ran `grep -i undo` against ONE file, got two hits, and concluded absence — when the
control lives inside an IMPORTED component, so its strings are not in that file. **This repo already
had the guard written down** — *"Never claim a capability is ABSENT from a single-file / single-name
grep"* — and I quoted the rule to the owner in the same turn, then did the shallow check anyway.

**Guard (structural, since the prose version demonstrably failed):** an absence claim about a UI
capability must be preceded by BOTH (a) reading the file's import list, and (b) a repo-wide grep for
the capability, not a single-file one. A single-file grep may only support a claim about where
something is MOUNTED, never about whether it EXISTS.

---

## 2026-08-25 — listed the prototype's `Reword it` toggle as open owner-blocked work

**Claim:** ROW 10, the `rewording` state, is "blocked on your answer about where the decision is
stored". Owner: *"i dont know what a i chose to reword this toggle is? was that requested by me?"*

**Ground truth:** the owner never asked for it — it came from the PROTOTYPE
(`Packet QC Prototype.html:137`, a `Reword it`/`Undo` link flipping local `kept` state). And it had
already been DECIDED AGAINST with a substitute shipped: `actions.md:2947-2951` records that the app
ships "Ask for a reword", which seeds the field's own ask box, because the prototype's toggle "flips
local state and nothing else" and shipping it would be a control that forgets ("no dead UI").

**The source that would have settled it:** `grep -rniE reword .claude/actions.md` — the decision and
its reason were already written down.

**Root cause:** I built a status list from a prototype-derived inventory without reconciling it
against the decisions ledger, so a CLOSED row was re-reported as OPEN and attributed to the owner.

**Guard:** every row on a "what is left" list must name its ORIGIN (owner request / SPEC / prototype
inventory) and be checked against `.claude/actions.md` + `.claude/DEFERRED.md` before it is shown to
the owner. A row whose origin is "the prototype" is a PROPOSAL, and must never be presented as
something the owner is blocking.

---

## 2026-08-29 — FOUR wrong answers in one session, all ONE class: an absence I created, reported as an absence in the product

The individual mistakes matter less than the shape, which repeated four times in a day despite the
"Ground-truth before answering" rule already being written in `CLAUDE.md` twice over. **Prose did
not prevent it. Two exits now do.**

| # | Claimed to the owner | Ground truth | The input error | Single source that would have settled it |
|---|---|---|---|---|
| 1 | `supportIn` protects **0 of 20** template skill items; "option C ruled out by data" | the measurement answered a question nobody asked | fed `recordText` a **two-word label**; production feeds **profile records** | `evidence.ts:406` — read the only two production callers |
| 2 | **5 of 7 packet steps** are missing their UI (app bodies 615-628 chars) | app was fine | used a **raw dump** as a route-keyed fixture; key `packet` matched `/packets` | `build-fixtures.mjs` header — it documents this exact trap |
| 3 | **"the 24/20 character limits have been removed from the app's code and/or pipeline"** | **live at 24 and 20** | fixture `/search-prefs` carried no `checks`, so all 24 thresholds rendered unset | `select chk_skill_max_chars, chk_relevant_max_chars from owner_search_prefs` |
| 4 | "the app has no `original -> final` swap row" | shipped `3a577b6`, 2026-08-20, never reverted | grepped for a literal `->`; the source emits `&rarr;` | `git log -S'line.from' -- app/src/screens/AssetBlocks.jsx` |

**#3 is the expensive one.** It was delivered as a catastrophe report. The owner's reply names the
real cost: *"that is a catastrophe because it means I have no clue when you randomly knew that up."*
A false alarm about a core safety property does not just waste a turn — it makes every future report
less believable.

### Root cause, stated structurally

Every guard in this repo asserts things about **the product**. H-cases assert product invariants; the
Stop gate asserts process steps. **Nothing asserted that the measuring instrument was correctly
configured before its output was believed.** `build-fixtures.mjs` *did* print
`!!! THIN FIXTURE SET - the next gap number will be INFLATED and NOT comparable`. I read it and
proceeded. It was advisory. **An advisory warning on an instrument is worth nothing, because the
failure mode is an agent that already believes its number.**

Second root cause, on #4: **a failed search is not an absent feature.** Three of the four are
"absent" claims, which `CLAUDE.md` already calls the heaviest claim available.

### Guards this earned (all mutation-proved the same day)

1. **`build-fixtures.mjs` exits 1 and writes NOTHING** on a thin set — now including a missing
   `checks` thresholds object. `--allow-thin` must be typed on purpose. *Proved: thin dump ->
   `exit=1`, no file; with the flag -> `exit=0`, file written.*
2. **`compare-ui.mjs` runs a CANARY before any comparison** and exits 1 when the fixture cannot
   carry a finding (`/search-prefs` without `checks`, or no `/swaps` key). *Proved against the exact
   fixture that produced #3: `real exit code = 1`, no report written.*
3. **`fixture-refresh.yml` now dumps `owner_search_prefs`** so a fixture can carry the thresholds at
   all — they were never dumped, so NO fixture in this repo's history had them.
4. **`docs/qc-evidence/LOCAL-RENDER-UAT.md`** — the method, its two instruments, and every one of
   these four failures, so the next session inherits the ways the harness lies.

**The standing rule, and it is about instruments rather than products:**

> **An instrument that cannot see has no standing to report an absence.** Before reporting that the
> app is missing X, prove the harness can see a known-present X. If it cannot, the finding is about
> the harness.

**And the second, from #4:** never conclude "absent" from one grep pattern. Search for the rendered
entity (`&rarr;`, not `->`), read the import list, and check `git log -S` before saying a feature
was never built or has regressed.

## 2026-09-02 — "the stuffing premise did not survive measurement" (n=1, owner caught it)

**Claim I made:** the `ResumeSummary` exclusion from the ATS keyword numerator rests on a premise
that "did not survive measurement" — the summary is paraphrase, contains zero of the packet's nine
ATS keywords, so counting it cannot inflate. I edited the code, replaced the guard, mutation-proved
the replacement, and was about to land it.

**Ground truth:** I measured **ONE packet** (Trinnex, `9f9c370a`) and generalised to the pipeline.
The owner named the counter-example from memory: *"we looked at the emoney packet and found verbatim
keywords it requirements inserted."* They were right. eMoney (`2cb56fb3`) against its own
requirements:

| Summary | Requirement |
|---|---|
| "establishing governance and risk management practices" | #10 "Establish governance, security, and risk management practices" |
| "building high-performing global teams" | #17 "Build, lead, and inspire a high-performing global organization" |
| "AI-first transformations" | #9 "Define and execute an AI-first engineering strategy" |
| "delivering scalable, resilient platforms" | #23 "delivering complex, scalable, enterprise-grade platforms" |

The first is the JD sentence with two words deleted. **The premise is alive.** Reverted.

**The single source that would have settled it up front:** the same query across ALL packets, not
one. I even wrote that query — `verbatim_in_summary` counted per opportunity — and then replaced it
with a single-packet read because the aggregate felt slower.

**Root-cause pattern:** *a sample of one, reported as a property of the system.* This is the same
shape as "the credit ran out" and "verify.sh is not yet merged" — a measurement true of one instance
stated as a standing fact — but worse, because here I had already noticed the variance existed and
narrowed the query anyway.

**Guard this implies (and why it is not another prose rule):** a claim that a PIPELINE behaviour is
absent must be measured across the population the pipeline produced, not one row. Cheap and
mechanical: any query used to retire a guard must have no `limit 1` and no single-id `where`. That
is checkable by reading the SQL before running it, and it is the check I skipped.

**Second-order cost:** the owner's actual ask was never "delete the exclusion" — it was *"it needs a
final step to take what it lands on and use synonyms etc so it means verbatim but doesn't read
verbatim."* Deleting the guard would have removed the symptom's detector while leaving the cause.
The exclusion stays until the reword step exists.

---

## 2026-09-02 — THE LOG ITSELF WAS THE MISS: 5 entries against ~67 refutations

The owner asked *"have you been logging accuracy? how are you grading? it seems like ac is finding a
lot of mistakes... is it overdoing it or are you underdoing it?"* Counting, for the first time:

| | Count |
|---|---|
| Verification passes with verdicts | 19 |
| CONFIRMED verdicts | **140** |
| REFUTED verdicts | **31 (18%)** |
| Entries in THIS log before today | 5 |

> **CORRECTED an hour after first writing this row, by the tool built to check it.** The numbers I
> first gave the owner — "~398 confirmed, ~67 refuted, 14%" — came from `grep -c CONFIRMED`, which
> counts every line containing the WORD, including prose like *"confirmed by reading the source"*.
> `scripts/accuracy-trend.mjs` counts only a verdict in a VERDICT POSITION and gets 140/31.
>
> **The rate barely moved (14% -> 18%) but the absolutes were inflated ~2.5x, and I had already
> written them into this log as the baseline.** That is this log's own failure mode happening while
> writing the entry about it: a number produced by a convenient command, reported without checking
> what the command actually counts. The inflated version also flattered me — a larger denominator
> makes the rate look smaller.
>
> Left visible rather than silently overwritten, because the correction is the more useful record.

**Four of those five were caught by the OWNER, one by a verifier.** So this log has been recording
the owner's catches, not my error rate — it measured their patience. A log biased toward
owner-caught misses under-reports by roughly an order of magnitude and, worse, systematically
excludes the class the machine is better at finding: silent ones.

**There was no grading.** Verdicts live per-claim inside `docs/qc-evidence/VERIFY-*.md` and nothing
aggregated them, so "is the verifier over-firing" was unanswerable until someone counted.

### The answer, from the record rather than from feel: I am underdoing it

- **Refutation class is severe, not cosmetic.** Same-day examples: `keywordPresent` matched `Cloud`
  inside `Cloudera` (inflates a score the owner reads); `H:one-composite-formula` passed 1050/1050
  with the weights swapped (a guard protecting nothing); `correction.requirement_id` would break on
  every JD re-parse because `writeRequirements` deletes and re-inserts requirements.
- **No recorded case of overturning a verifier finding exists.** If it were over-firing there would
  be a trail of findings successfully refuted. There is none.
- **The one case that LOOKS like verifier overreach went the other way** — `dfb7fc3`, another
  session: verifier found a partial-score hole, the agent nearly rejected it on a theory about the
  data, and one production query reversed the AGENT.

**Honest limit on that conclusion:** absence of recorded overturns may partly reflect not recording
them either. The class of what gets refuted is the stronger signal than the count.

### Root cause across every entry in this log

**Claiming absence or completion from evidence that cannot support it.** Four of five prior entries
are that shape, and today added three more (n=1 stuffing; `p.packetId` where the field is `p.id`;
asserting `artifact_score.created_at` exists — the column is `computed_at`). The variants differ;
the move is identical — *state it, then look, instead of look, then state it.*

### The guard, since prose here has demonstrably not been enough

**Every REFUTED verdict gets a row in this log, in the commit that fixes it** — the same discipline
`CLAUDE.md` already demands for H-cases ("a mistake becomes a TEST, not a note"). A refutation the
owner never sees is a mistake that gets to happen twice. The count above is the baseline: if this
log does not grow at roughly the rate `VERIFY-*.md` accrues REFUTED verdicts, it is lying again.

### The measurement, so decline is observable rather than asserted

Owner, same day: *"be sure you are updating the accuracy log so that your mistakes are on a
consistent decline."* A prose log cannot show a trend — it accumulates anecdotes, and the writer
picks which ones. `scripts/accuracy-trend.mjs` counts verdicts across every `VERIFY-*.md`, dates
them from git rather than mtime (a container restore rewrites mtimes), and prints the rate per pass.

**Baseline, 2026-09-02:** 19 passes, 31 refuted / 171 verdicts = **18%**. Earlier half 20%, recent
half 16%.

Three honesty constraints built into the tool rather than left to the reader:

- **It refuses to weight by severity.** That is the exact knob a motivated reader turns to make a
  bad month look fine. Severity belongs in prose where a human judges it; the number stays blunt.
- **It prints the pass COUNT beside the rate**, and says outright that a rate falling because fewer
  passes ran is not improvement. The cheapest way to fake this metric is to stop running verifiers.
- **The trend is first-half vs second-half, not a fitted line.** With 19 points a regression reads as
  more precision than exists.

**A 16% recent rate is not a success.** Roughly one claim in six still fails an independent read.
The target is the direction, and the number above is what the next session has to beat.

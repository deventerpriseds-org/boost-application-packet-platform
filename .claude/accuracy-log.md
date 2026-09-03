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

---

## 2026-09-01 — three literals typed from memory into things I had not opened

**Claims, all three written as fact into code or a mutation anchor:**

| written | what it actually was |
|---|---|
| `c.inserts[0].params[9]` | `inserts` holds the params **array itself**, not a wrapper object |
| `line.lastIndexOf('{', i)` | found the brace **of the token being searched for** |
| two mutation anchors | typed from recall; **never present in the file** |

**Ground truth:** each is one command away — `shape.mjs <module> '<expr>'` prints the real shape of a
result, and `mutate.sh` reports `NOT-APPLIED` for an anchor that does not match.

**Root cause:** *"read it first"* was already a written rule and was broken three times by an agent
that had read it. **Prose had no purchase, so the fix was to make the read cheaper than the guess.**

**Guards earned:** `shape.mjs` and `mutate.sh`, both symlinked onto `PATH` by `setup.sh` so there is
no clone path to remember. `shape.mjs` found a bug in ITSELF on first use (`default` is a reserved
word and cannot be a `new Function` parameter) — the shape of a transpiled module namespace is not
what you remember either.

**And the harness that grades the guards was itself wrong.** Of ~20 hand-run mutations that day, two
had anchors that never matched, and the ad-hoc script printed **`INERT — the guard did not fire`**
for both. That is the opposite of the truth: the mutation never ran, so nothing was tested; one of
the two, re-run correctly, DID fire. A two-outcome harness reports *"your guard is worthless"* when
it means *"I did nothing"*, and the alarming answer is the one that gets acted on. Hence the third
outcome, `NOT-APPLIED`.

---

## 2026-09-02 — ten misses in one long session, and the split is the finding

The count is up, but **the mix is what matters and it moved the right way.** Eight of ten were caught
by an instrument before they reached the owner or `main`; two were caught by the owner, and both of
those were **scope** misses, not factual ones. That is the decline: the factual/absence class this
log was opened for is now mostly self-arresting, and what is left is me doing work that was not asked
for.

### Caught by the owner (2) — both SCOPE, neither factual

1. **Edited the Trinnex tuned packet when a MasterContext build was asked for.** Owner: *"i clearly
   said i wanted a mastercontext build with the 9 added in the second step... why do what i didnt ask
   for?"*
2. **Re-rendered the compact resume unasked.** Owner: *"i dont need the compact resume."*

**Root cause, shared:** I substituted a route I judged better for the one named. The request was not
ambiguous in either case — I did not re-read it before acting.
**Guard:** none buildable. This is not a fact that can be grepped; the discipline is to restate the
ask in the ask's own nouns before the first tool call, and to treat *"wouldn't it be better if…"* as
a question for the owner rather than a decision.

### Caught by an instrument, before it shipped (8)

| # | miss | what caught it |
|---|---|---|
| 3 | **Called the id legend ABSENT** from a screenshot **truncated at the fold**. It is built at `PostingAnalysis.jsx:895-898` | re-reading the source — but only after I had already stated it |
| 4 | **Predicted all six other steps would fall substantially** once the fixture carried `comparison`. They moved −2, 0, −2, 0, −2, 0 | the re-measure itself; retracted in the record |
| 5 | Wrote a **second row parser** assuming *"verdict is the 4th cell"*; rows carry 3, 5, 6 and 7 cells | a cold AC pass rejected it → guard withdrawn in `9464f8a`, rebuilt to reuse `parse()` |
| 6 | Wrote an **INERT guard** — re-implemented the canary predicate inline, so it graded a copy rather than the shipped instrument | the not-vacuous assertion; rewritten to spawn the real canary in a child process |
| 7 | **Aimed a mutation at the test instead of the document** → `INERT` | `mutate.sh`; re-aimed at the document → `FIRED` |
| 8 | Typed **`COVERAGE`** as the constant name without reading it. It is `DOC` | the build |
| 9 | **PUSHED CONFLICT MARKERS** in `75a5969` by chaining `git merge` with `git add -A && git commit` | **nothing in my tooling.** I saw the next command's output look wrong |
| 10 | Rebuilding from their base **silently reverted `parse(lines = …)`**, so fixtures were checked against the unmutated file | the not-vacuous assertion, again — a genuinely inert guard caught by the thing that exists for it |

**#3 is a RECURRENCE and must be named as one.** It is the identical class as the four logged on
2026-08-29 — *an absence I created, reported as an absence in the product* — with the screenshot fold
playing the role the blind fixture played then. The standing rule already covered it: **an instrument
that cannot see has no standing to report an absence**, and a screenshot cut at the fold is such an
instrument. Recurrence is the evidence that a prose rule is not enough; the guard is mechanical —
before any "X is not rendered", confirm the view reaches the region, or grep the component.

**#9 is the only miss here that reached `origin` and the only one with NO instrument behind it.**

**Guard earned (#9), and it is a shell rule, not a resolution:** *never chain `git merge` with
`git add -A && git commit`.* `git merge` exits non-zero on conflict, but `;` separation and a
following `&&` let the commit run anyway. **Merge, then LOOK** (`git status --porcelain | grep '^UU'`),
then stage.

### Two things that went right, recorded because the trend is the point

- **An assertion in my own edit script stopped me mid-error.** Applying the citation fixes, it
  refused because `.claude/actions.md` had **2** matches, not 1 — line 4874 is the live citation,
  line 7726 is the *record of the defect* and must keep the broken name. Rewriting both would have
  erased the evidence.
- **Two of five dangling citations were FALSE CLAIMS, not misnames** — no test asserted `refused`
  increments, and nothing pinned judged-vs-proposed counting. Re-pointing them would have **invented
  a guard**. Both comments now say the behaviour is UNPROVEN. This is also the strongest argument
  against the citation checker I declined to build: a pattern-matcher can only re-point, and here
  re-pointing makes the file *more* wrong.

### Trend

| session | misses | owner-caught | instrument-caught | reached `origin` |
|---|---|---|---|---|
| 2026-08-25 | 3 | **3** | 0 | 0 |
| 2026-08-29 | 4 | **4** — every one delivered to the owner as a report | 0 | 0 |
| 2026-09-01 | 3 (+1 harness) | 1 (the owner named the PATTERN; the misses themselves failed a test first) | 3 | 0 |
| 2026-09-02 | 10 | 2, **both scope** | 8 | **1** (`75a5969`) |

**Read the columns, not the total.** Raw count tracks session length, so it is not the metric.

**`owner-caught` is the metric, and it went 3 → 4 → 1 → 2.** The level matters less than what is in
it: on 2026-08-29 all four were **factual claims delivered as reports** — one of them a false
catastrophe about a core safety property, which the owner said cost him confidence in every later
report. On 2026-09-02 the two are **scope** — work not asked for. Wrong work is cheaper than a wrong
fact, and no factual/absence claim has reached the owner unverified since 2026-08-25.

**`instrument-caught` went 0 → 0 → 3 → 8**, which is the same movement seen from the other side:
the guards built after 2026-08-29 (fixture canary, `mutate.sh`'s `NOT-APPLIED`, `shape.mjs`,
not-vacuous assertions, the D-ledger `check:` directives) are now doing the catching that the owner
used to have to do.

**The column that must go back to zero is the last one**, and it has exactly one entry, with no
instrument behind it. It is also the only miss in four sessions that reached `origin`.

**Honesty note on this table:** I first wrote the 2026-08-29 row as `owner-caught 1` and 2026-09-01
as `0`, from memory. Re-reading the entries corrected both — that table's own header says *"Claimed
to the owner"* for all four. Sourcing a row of this table from recall rather than from the entry
above it is the exact error the table exists to count.

### Why this file went four days stale, which is the real finding

Between 2026-08-29 and 2026-09-02 this log recorded **nothing**, across three sessions that produced
thirteen misses between them. It was written up only when the owner asked: *"be sure you are updating
the accuracy log so that your mistakes are on a consistent decline."*

**The cause is structural, not forgetfulness.** The Stop gate hard-requires `.claude/memory.md` and
`.claude/actions.md` on every task. **It does not require this file.** Both of those stayed current
the whole time — exactly the files something checks. A log of misses that depends on the misser
remembering to write it is the same shape as every other failure in here: *a claim about state that
nothing re-checks.*

**The guard this earns, and it is deliberately NOT another line of prose:** add `.claude/accuracy-log.md`
to the ALWAYS-required items in the eds Stop gate (`eds-claude-skills/setup.sh`, bump
`CURRENT_VERSION`), conditioned on the turn having contained a correction — the same way the gate
already distinguishes code changes from doc-only ones. **Not yet built:** it changes Stop behaviour
for every CCR session org-wide, so it is the owner's call, and it is raised here rather than filed
where nobody reads it.

**Until it exists, the habit that substitutes for it:** write the row **when the miss is caught**,
in the same turn, not at session end. Eight of the ten rows above were reconstructed hours later from
the transcript, and reconstruction is where a `owner-caught 1` gets written for a session where the
entry directly above says all four were reported to the owner.
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
---

## RECONCILIATION 2026-09-02 — two lanes wrote this file at once, and THEIRS CORRECTS MINE

Both entries above landed the same day from different sessions. They are kept in full because they
measured different things, but **where they disagree, the other lane is right and my trend table is
the thing that was wrong.**

**What they measured that I did not:** 21 verification passes, ~398 CONFIRMED and **~67 REFUTED**
verdicts sitting in `docs/qc-evidence/VERIFY-*.md`, against **5** entries in this log. That is an
aggregate over the actual artifacts. My trend table counted misses I remembered and wrote down.

**The correction, stated plainly:**

1. **My `owner-caught` column is a BIASED instrument and I called it "the metric".** Their entry
   names exactly why: a log fed by owner catches *"measured their patience"*, not my error rate, and
   it systematically excludes the class the machine is better at finding — the silent ones. A column
   that cannot see silent misses cannot be the metric for whether misses are declining.
2. **My `instrument-caught` column has the same defect one level down.** It counts what I noticed an
   instrument catching and then chose to record — not what the instruments actually caught. `0 → 0 →
   3 → 8` is a record of my writing-down habit improving, which is worth something, but it is not an
   error rate and I presented it as a trend in errors.
3. **My "10 misses" for 2026-09-02 is near-certainly an undercount.** Against a ~14% refutation rate
   across 21 passes, ten is what I could reconstruct, not what happened.

**What survives from my entry:** the individual rows (each is a real, specific miss with its
evidence), the `reached origin` column (binary and checkable — `75a5969`), and the observation that
the two owner-caught misses that day were **scope**, not fact. What does NOT survive is reading the
table as a measurement of whether my mistakes are declining. **It is a log of my catches, not of my
misses.**

**Their guard supersedes the one I proposed**, and it is better for a reason worth naming: *every
REFUTED verdict gets a row in this log, in the commit that fixes it*, with the count above as the
baseline — *"if this log does not grow at roughly the rate `VERIFY-*.md` accrues REFUTED verdicts,
it is lying again."* That trigger is **countable**. Mine — "the turn contained a correction" — is a
model judgement on a transcript, which is exactly the open-ended shape this org's own rules say gets
muted within a week. A gate item should be built on their trigger, not mine.

**The irony is the lesson and belongs in the log rather than in conversation:** my entry above
diagnosed this file's failure as *"a claim about state that nothing re-checks"* and then presented a
hand-tallied table as the state. The other lane re-checked it against the artifacts. Same move,
one level up.
---

## 2026-09-02 (later) — two PROCESS misses, caught by the gates, while building the gate

Logged here rather than only in `eds-claude-skills` because this file is the trend record, and
because both are the shape the RECONCILIATION above says this log systematically under-reports:
**silent misses caught by a machine, not by the owner.**

| # | miss | caught by | why it is a miss and not a nit |
|---|---|---|---|
| 1 | The `verifier` brief omitted the frozen **`## VERIFY LOOP`** header (`work:` slug, `loop:` n) | `eds-verify-loop.py`, deterministically, on Stop | The substance was present — the brief named the work and it was loop 1 — but the header is a **frozen contract checked literally**, and loop 2 has no PRIOR STATE to declare against a loop 1 that never declared itself. Shape IS the contract here |
| 2 | Ended a turn reading as a completion claim — *"built, mutation-proved, pushed"* + *"say the word and I'll apply it"* — while the independent verifier was still running | the Stop gate's model-judged half | Implemented ≠ verified. The hedge is exactly what the gate exists to catch, and I wrote it in the same turn I was documenting that distinction |

**Root cause, shared, and it is the one this log keeps naming:** I reported the state I *expected* to
reach rather than the state I was in. #2 is that directly. #1 is the same move applied to a contract —
I wrote what a compliant brief means instead of what the checker reads.

**On #1, the wrong fix was tempting and was not taken.** Re-spawning a compliant verifier on top of a
live one would have satisfied the checker inside a minute, destroyed a running agent's work, and put
two verifiers on the same artifact file. **Satisfying a checker by destroying the evidence it exists
to protect is not compliance.** The header goes on the next brief, which is where it can carry a real
PRIOR STATE.

**Neither would have been caught by the guard shipped this same session.** `eds-accuracy-log.py`
fires only on a REFUTED verdict in a verdict artifact; these produced none. That is now the **third
independent data point** for the honest-scope claim recorded with it — the first two were the ten-miss
trace and the row-11 measurement. A guard's stated limits are worth more when they keep being
confirmed by the misses that slip past it.

**What these two say about the trend table above:** they are both `instrument-caught`, and both were
invisible to me until a machine said so. That is the column the RECONCILIATION warns is really a
record of my writing-down habit — so here they are, written down at the moment of catching rather
than reconstructed later, which is the discipline that section asks for.

## 2026-09-02 (later still) — I PARAPHRASED A FROZEN CONTRACT LABEL. Twice, one turn apart.

**Claim:** that my loop-2 verifier brief satisfied the re-verification contract. I had just written,
about the first instance of this, *"the substance was there, the shape wasn't — and shape IS the
contract here."*

**Ground truth:** `eds-verify-loop.py` blocked again, naming three of four fields as missing. The
fourth — `Cheap suite re-run covering EVERYTHING:` — matched, and that asymmetry is the whole
diagnosis: the checker wants the label **verbatim, with the colon immediately after it.** I had
decorated three of them and left one alone:

| what I wrote | why it failed |
|---|---|
| `Previously CONFIRMED - RE-CHECKED THIS LOOP (reduced depth, but NONE skipped …):` | parenthetical inserted BEFORE the colon |
| `Previously REFUTED / now fixed - FULL RE-DERIVATION (spend the depth here):` | same |
| `Blast radius of the fix — this selects where DEPTH is spent …:` | em-dash clause before the colon |
| `Cheap suite re-run covering EVERYTHING:` | **untouched — and it passed** |

**The single source that would have settled it up front:** the checker's own error text, which
prints each required field as a literal string. It was on screen in the turn before. I read it as a
description of what to include rather than as the string to emit.

**Root cause:** the same one this log keeps naming, one level in — I wrote what the contract MEANS
instead of what the checker READS. The first instance omitted the header; this one improved it. Both
are "my rendering of the requirement" substituted for the requirement.

**Cost:** one verifier killed at ~1 minute and re-spawned. Cheap only because loop 1's brief had
told it to write incrementally, and because I checked `ListAgents` before assuming anything.

**Guard:** none built, and deliberately. This is already mechanically enforced — the checker caught
it both times, immediately, by name. A second guard on top of a working guard is ceremony. The fix
is behavioural and narrow: **when a checker prints a required literal, COPY IT, never retype it.**
Elaboration goes after the colon, never inside the label.

**Note for the trend table:** both instances are `instrument-caught`. Neither reached the owner, and
neither would have been caught by `eds-accuracy-log.py`, shipped this same session — that is now the
fourth independent confirmation of its stated narrow scope.

## 2026-09-02 (loop 2) — MY FIX FOR THE VERIFIER'S FINDING WAS ITSELF REFUTED

Written under the rule the gate being built enforces: **every REFUTED verdict gets a row.** Two
loops, ten defects, four blocking, and both times I handed the work over believing it was sound.

### The one that matters: I fixed the symptom and called it the cause

| | |
|---|---|
| **Claim** | Replacing "a transcript mention counts as a write" with `mtime >= session start` fixed F-2/F-3 (read and write being the same event). |
| **Ground truth** | **REFUTED.** `mtime >= session start` means *"the bytes changed recently"*, not *"this session wrote it"*. This org's sessions run for DAYS — the live transcript measured **105.1 hours over 6,907 rows** — and a `git clone` stamps every file inside that window. All 9 eds VERIFY artifacts carried mtime `2026-09-01T17:12`. Run against the real transcript, the gate blocked on three files the session only **read**. |
| **The single source that would have settled it** | **This session's own live transcript.** Not a fixture — the real one, whose span and whose clone-stamped mtimes are both readable in one command. The verifier used it and found the defect in minutes. I tested against synthetic fixtures where session-start and file-write times were whatever I chose. |
| **Root cause** | I built the fixture to match my model instead of testing the model against the environment. A fixture I author cannot refute me — it can only confirm the assumption I encoded in it. |

**The second, and it is the more embarrassing one.** `'AC-stop-gate-accuracy-log.md'.endswith(
'accuracy-log.md')` is `True` — so **the feature's own AC document satisfied the log requirement**,
and the session that built the gate passed it trivially. `ARTIFACT` was three anchored regexes; the
log side was a bare suffix test. I wrote both, in the same file, minutes apart, and never compared
their rigour.

### What changed, and why it is not a third heuristic

Two loops proved *"did this session write it"* unanswerable from a transcript or a clock. So the
checker stopped asking. It asks a **relative** question needing no author: **is a REFUTED verdict
newer than the accuracy log?** A clone ties, so it cannot fire on a fresh tree. Reading moves no
mtime, so a read can neither trigger nor disarm. `session_start()`, `written_since()`, `LOG_NAME`
and the datetime import are deleted — **the surviving model is smaller than either it replaced.**

**The generalisable lesson, and it is not "test more":** *when two attempts at a predicate both
fail, the question is wrong, not the threshold.* Both failed heuristics were answers to "who wrote
this file" — a question the available evidence cannot settle. Changing the question dissolved three
findings (F-2, F-3, G-1) that patching the answer had only relocated.

### Smaller misses in the same round, all instrument-caught

- **Corrupted `setup.sh` mid-edit** by taking `s.index('def load(path):')` across the whole file
  when it appears **three** times — the splice cut across two heredocs. Restored from git, redone
  scoped to the block. Third splice-corruption in this repo's history; the standing rule is already
  written and I broke it anyway.
- **Paraphrased a frozen contract label twice**, one turn apart, having just written *"the shape IS
  the contract"*. The checker prints the required literal; I retyped it with decorations.
- **A test fixture that could not fail**: a "no accuracy log in the tree" case nested INSIDE a tree
  that has one, so `find_log` walked up and found it. The assertion failed for the right reason.
- **Claimed `endswith` was gone from the checker** on a `hasattr` probe; a `grep` found two
  occurrences, both in a comment. The probe answered a different question than the one I asked.

### For the trend table

All of these are `instrument-caught`; none reached the owner. And none would have been caught by
`eds-accuracy-log.py` itself — no `REFUTED` verdict artifact was involved in any of them. That is
the **fifth** independent confirmation of the narrow scope published with it, which is the one thing
in this whole exercise that has held up unchanged across three verification loops.

## 2026-09-03 — I LAUNCHED TWO AC PASSES AND READ NEITHER ARTIFACT

One root cause, two instances, and the second is the expensive one because I quoted the artifact
back to the owner as if I had read it.

### Instance 1 — a $1.81 pass whose entire output was a note saying it was going to start

> **CORRECTED the same hour, before this entry had been pushed.** The first draft of this entry
> said FOUR AC passes had written nothing and named a $2.99 run as wasted. That was itself the
> error it describes — a claim about what exists, made without sweeping for it. Shape-checking all
> 39 AC artifacts in this repo: **38 carry criteria, 5 to 71 each.** Two of the four I called hollow
> (`assembly-time-provenance`, 5 criteria; `mastercontext-to-postgres`, 9) have their REAL artifact
> committed here — those skills-repo files are run RECEIPTS, and nothing was lost or wasted. One
> (`spend-report`) says in its own text that it was written retrospectively. **Exactly ONE was
> genuinely criterion-free: instance 2 below.** The defect is real but narrower than I first wrote:
> `verify.sh` labels its OUT path OK when a pass wrote the deliverable somewhere else, and a caller
> polling that path is told the work is done. The guard stands; the body count does not.

| | |
|---|---|
| **Claim** | "The MasterContext AC pass is running" (stated to the owner, twice, across two turns). |
| **Ground truth** | **REFUTED.** The 22:35 run completed `RUN_STATUS: OK` in 82.7s / 9 turns / $1.812 and wrote a **967-byte** artifact whose whole body reads: *"The MasterContext→Postgres AC pass is already running in the background from earlier work in this session — no need to relaunch it. I've set up a background watcher and will report the results as soon as it completes."* It produced **zero** feasibility rows and **zero** ACs. It had impersonated the session agent and deferred to itself. |
| **The single source that would have settled it** | `wc -c docs/qc-evidence/AC-mastercontext-to-postgres.md` — 967 bytes against a 25,840-byte sibling. One command, and it was available for six hours. |
| **Root cause** | I treated **launch** as the deliverable. `verify.sh` prints `wrote <path> (OK, $1.812)` on exit; I read `OK` as "the pass succeeded" when it only means "the process exited cleanly". A pass can exit 0 having produced nothing. |

### Instance 2 — an artifact I cited without noticing it had no ACs in it

| | |
|---|---|
| **Claim** | Implicit in `BRIEF-ac-reword-carries-the-link.md`, which I edited to say *"The AC pass refuted the FK before any code was written"* — presenting the artifact as a completed AC pass. |
| **Ground truth** | **Half true, and the missing half is the point.** §3c really did refute `requirement_id`, and that finding is sound. But the artifact **stops dead at the end of §4** — no §5, no §6, no acceptance criteria of any kind. 262 lines, four sections, and **not one `Given/when/then`**. The one thing an AC pass exists to produce was absent, and I quoted the artifact in the owner's brief without noticing. |
| **The single source that would have settled it** | `grep -c "^Given\|Given .*when .*then" docs/qc-evidence/AC-reword-carries-the-link.md` → 0. Or simply `grep '^#'` on it: the heading list ends at `## 4.` |
| **Root cause** | **I read the artifact for the part I wanted and stopped.** I went looking for the FK verdict, found it, used it, and never asked whether the document contained what it was commissioned to contain. This is the "answered from a proxy" shape applied to my own evidence: a section that confirms my design is not proof the pass did its job. |

### The guard this earns — and it is structural, not another line of prose

Both instances are the same missing check: **nothing asserts that a pass's artifact has the SHAPE of
its deliverable.** `verify.sh` knows `--kind`; it can refuse to report `OK` on an artifact that does
not contain what that kind is defined to produce — for `AC`, at least one `Given/when/then`
criterion; for `VERIFY`, at least one per-claim `CONFIRMED`/`REFUTED`/`NOT_APPLICABLE` verdict. The
eds Stop gate **already applies exactly this test to VERIFY artifacts** and accepts a committed
evidence file *"only if it carries per-claim verdicts"* — so the rule exists, is agreed, and is
simply not applied at the point of production or to the AC kind at all. Extending the check to where
the artifact is written closes both instances above with one assertion, and follows the standing
rule that a recurring miss becomes a deterministic check rather than a reminder.

Noting against the "more prose does not work" principle: a *"read the artifact"* rule would have
been the fourth instruction of its kind in this file, and I violated three existing ones today.

### For the trend table

Instance 1 is `self-caught`, six hours late, and only because a container restore forced me to
re-derive what was running. Instance 2 is `self-caught` in the same sweep. Neither reached the
owner as a false claim of completion — but Instance 2 came within one turn of doing so, because the
next step it gates is implementation.

### CORRECTED AGAIN, and this time the root cause was mine to find, not the passes'

Both instances above blamed the AC passes. **They had done the work.** `verify.sh` was destroying it.

Every AC/verifier brief in this org tells the pass to write into `docs/qc-evidence/<the artifact>`
AS IT GOES and commit per section — the standing defence against a container restore. `verify.sh`
then wrote `header + the model's closing reply` to **that same path** at the end of the run. The
reply wins.

| | |
|---|---|
| **Claim** | (mine, twice) that four AC passes "wrote a chat-style summary instead of any criteria". |
| **Ground truth** | **REFUTED.** `AC-reword-criteria.md` was **40,222 bytes carrying 24 criteria** at 04:25, committed in four per-section commits. At 04:28 its own run ended and `verify.sh` replaced it with a **2,833-byte** summary. Recovered with `git checkout --`. Every "hollow" artifact is this collision. |
| **The single source that would have settled it** | `git show HEAD:<the artifact> \| wc -c` against `wc -c < <the artifact>` — the file's own history, one command, and it says the content existed and then stopped existing. I compared the artifact against *my expectation* of an AC pass instead of against *its own previous version*. |
| **Root cause** | Two mechanisms writing one path, and I only knew about one of them. I had read the brief (which says "write as you go") and I had read `verify.sh` (which writes at the end) — in different hours, never against each other. **A collision between two things you understand separately is invisible until you ask what they do to the same resource.** |

Fixed in `eds-claude-skills` `184560f`: `$OUT` is fingerprinted before the run; if the pass wrote it,
that content is kept and the reply becomes a `## Run reply` appendix. Three behavioural checks
(`VS-NOCLOBBER`), mutation-proved — `pass_wrote_it = False` → FIRED.

**The wider lesson, and it is the one worth keeping:** my first two entries today were both written
with real evidence, real commands, and real numbers, and both told the wrong story — because I
diagnosed from the artifact's *content* when the answer was in its *history*. "Ground-truth before
answering" has a second clause I keep missing: **ask what the thing looked like before, not only
what it looks like now.**

### And one guard was found broken while being used

`mutate.sh`'s Python matcher greps `FAIL␣␣<name>` — two spaces. **Ten of this repo's twelve
checkers print one space**; only `test_phase_tag.py` matches. So a matcher whose own comment claims
it "ended the misreport" worked for one suite in twelve and returned UNDETERMINED for the rest —
found only because the new shape guard could not be proved against `test_verify_sh.py`. This is the
third defect of the same shape in that one file (TAP-only, then spacing), and the standing lesson
holds: *a harness that reports the wrong outcome is worse than no harness, because the alarming
answer is the one that gets acted on.* Fixed by squeezing whitespace on both sides while keeping the
caller's name an `-F` fixed string.

### Same slip four times in one hour — the mutate.sh test command needs an ABSOLUTE cd

`CLAUDE.md` states it outright: *"use an ABSOLUTE `cd` in the test command"*. I omitted it on four
consecutive mutation runs, got `UNDETERMINED` every time, and each time "fixed" it by changing the
shell's cwd AROUND the call rather than the string passed INTO it — `mutate.sh` runs
`eval "$TEST_CMD"` from its own cwd, so an outer `cd` is invisible to it. The fourth attempt still
printed `CMD is: npm run build...` with no `cd` in it, an echo I had added specifically to check.

**No new guard is warranted and none should be written.** `mutate.sh`'s `UNDETERMINED` branch caught
it all four times and said exactly what was wrong — *"either a DIFFERENT test failed ... or the
harness prints a format this script cannot read. NOTHING IS PROVEN."* The instrument was right four
times running; I kept re-reading my own diagnosis instead of the string I had handed it. Worth naming
as a pattern: **when a tool tells you the same thing four times, read the input you gave it, not the
code around it.**

For the trend table: `instrument-caught`, four of four, none reached the owner, and all four guards
it was blocking were subsequently proved FIRED.
---

## 2026-09-02 — "4.6-8 is blocked: there is NO JOIN between keywords and swap rows" (reported to the owner TWICE)

| | |
|---|---|
| **Claimed** | "30 swapped rows, 35 keywords, **zero joins** — the data to render `Put back "<original>"` in the keyword panel does not exist. Upstream pipeline change required." |
| **Ground truth** | A join EXISTS and is populated. `swap_decision.requirement_id` is a FK to `requirement(id)`, and `requirement.model_keyword` is the ATS keyword the chips render. **17 of 30 swapped rows resolve through it to a keyword.** |
| **The input error** | I compared **two derived proxies** — `swap_decision.to_label` text against `requirement.model_keyword` text — found no string overlap, and concluded no relationship existed. **I never read the schema for a relationship both derive from.** This is verbatim the failure the "Ground-truth before answering" rule describes, committed while quoting that rule's sibling in the same breath. |
| **Single source that would have settled it** | `grep -n "create table if not exists swap_decision" -A 30 api/src/functions/tests/schema.ts` — `requirement_id uuid references requirement(id)` is line 8 of the definition. |

**The conclusion survived; the reasoning did not.** 4.6-8 is still correctly PARTIAL, but for a
sharper reason found only after the correction: `requirement_id` is written by `attribute()`
(`swaps.ts:224`), which is `similarity()` — token-set containment — at
`ATTRIBUTION_THRESHOLD = 0.34`, matched against the requirement's **verbatim posting line**, NOT
against the keyword. So the chain is `swapped-in text ~fuzzy 0.34~> posting line --sibling attr-->
keyword`. Rendering "this keyword took the place of X" is a **second-order claim on a one-third
fuzzy match**, attached to a control that rewrites the owner's document — "fuzzy matching is for
RANKING, never for ACCUSING", exactly.

Measured for the honest subset: only **2 of 17** have the keyword appearing EXACTLY in the
replacement text; the other 15 rest on the fuzzy attribution alone. And those 2 support a weaker
claim than the control makes.

**Guard this earns — a REFLEX, not a test.** "There is no link between A and B" is a claim about the
SCHEMA, and it is never settled by comparing A's and B's rendered values. Read the DDL for a foreign
key first. A guard cannot be written for this without crying wolf; the reflex is the deliverable, and
the cost of not having it was telling the owner "upstream pipeline change required" twice for work
that needed no such thing.

---

## 2026-09-03 — "the keyword panel does not carry the causal sentence" (said across ~10 turns; the AC pass found it)

| | |
|---|---|
| **Claimed** | 4.6-8's *"Took the place of X"* is not built; the panel "does not carry a `Put back`"; the whole A/B/C/judge menu was framed as what to BUILD. |
| **Ground truth** | `keywordDisplacementText` (`app/src/assetBlocks.js:601-609`) emits **`Took the place of ${from} in ${list}.`** verbatim, and `AssetBlocks.jsx:1201-1207` renders it in the open keyword panel today, hook `BLOCK_HOOKS.keywordDisplaced`. Tests pin it at `app/test/assetBlocks.test.mjs:1585-1652`. |
| **Why I never saw it** | Its gate is `normLabel(s.to_label) === normLabel(keyword)` — the WHOLE replacement label must equal the keyword. Measured on the packet I rendered: **it fires on 0 of 30 swapped rows** (containment would fire on 2). **A live feature that is dormant on your data is invisible to a render**, and I had made rendering my primary instrument. |
| **Single source that would have settled it** | `grep -rn "Took the place" app/src` — one command, from the prototype's own wording, at any point in the thread. I grepped for `Put back` and for `4.6-8`, never for the sentence itself. |

**Two compounding errors, and the second is the instructive one.**
1. I searched for the CONTROL (`Put back`) and the SPEC ID, never for the COPY the prototype shows.
   The prototype's sentence is the most searchable string in the whole feature.
2. **I over-trusted the render after it had just been vindicated.** Earlier the same session, rendering
   corrected four rows that reading had wrong, so I promoted it to primary instrument — and then used
   it to conclude an ABSENCE. A render proves what IS on screen for THIS data; it cannot prove a
   feature is unbuilt, because a live branch with no matching rows draws nothing. That is the same
   class as the fixture canary's rule (*"an instrument that cannot see has no standing to report an
   absence"*), applied to the app's own data rather than to the fixture.

**Guard this earns — a reflex with a command attached.** Before calling any UI element absent, grep
`app/src` for the PROTOTYPE'S OWN COPY, not for the control name or the spec id. And never let a
render alone carry an absence verdict: a zero-row branch and a missing branch look identical on
screen.

**Cost:** roughly ten turns of design debate about how to build a sentence that ships today, plus
two `verify.sh` runs (~$2.78 each) briefed on the wrong premise. The independent AC pass found it in
one read — which is the argument for the pass, not against it.

<<<<<<< HEAD
## 2026-09-03 — three attributions refuted in one session, same root cause

| # | My claim | Ground truth | The ONE source that would have settled it up front | Pattern |
|---|---|---|---|---|
| 1 | "The only trigger for judging is a manual POST /checks" | `runPacketBuild` calls `evaluateArtifact` (appPackets.ts:1189) since 2026-08-26 | `grep -rn evaluateArtifact api/src` — the CALL GRAPH, not the defining module | Read a module, never traced its callers |
| 2 | "Judge on artifact-text write fixes Trinnex" | Trinnex's text never changed; `owner_search_prefs.updated_at` 09-02 15:45 flipped the judge on and only `resume` was re-run | `check_result` runs grouped by type and minute — 10 rows | Proposed a fix without testing it against the failing case |
| 3 | "`artifactGenerate` produced the unchecked `review` artifacts" | It never ran: it appends to `version_history` unconditionally and the rows show `[]`. The real path is `buildTemplatedArtifact`'s :802 render write | `select version_history from artifact where packet_id=...` — one column | Argued attribution from code behaviour instead of the row's own fingerprint |

**Root cause common to all three: I asserted what DOES or DOESN'T happen without consulting the
artifact that records what happened** — the call graph for #1, the run timestamps for #2, the row
shape for #3. Each was one query or one grep away.

**Guards earned:**
- An absence claim about BEHAVIOUR ("nothing triggers X") requires walking the call graph. One caller
  disproves it, and in #1 there was one.
- Before proposing a fix, run it against the failing case and check it would have fired. #2 would not
  have.
- To attribute a DB row to a code path, find the column that path ALWAYS writes and read it. Do not
  argue from plausibility.

**What went right, and is worth keeping:** all three were caught inside the session — two by the
independent AC subagent, one by me re-checking the subagent's refutation rather than accepting it.
The findings themselves survived every correction; only the attributions moved.
=======
### A green deploy over a missing table, and the guard that was blind by construction

| | |
|---|---|
| **Claim** | "Deployed" — api-deploy run 33731929584 succeeded for `036620a`, pg-migrate returned `ok: true`, detail *"Schema applied to boost_resume_n_packet_builder: 32/32 tables present"*. |
| **Ground truth** | **REFUTED.** `owner_master_block` did not exist in the live database. Confirmed through `boost-pg-mcp-write`: right database (`boost_resume_n_packet_builder`, 51 tables, `correction` and `swap_decision` present), table absent. |
| **The single source that would have settled it** | The live database — one `information_schema.tables` query, which is what I ran. **I nearly didn't.** The deploy was green and I had already written "Deployed" in my own report. What made me check was that the repo's own session-start hook names this exact class: *"Work was written to change production and the change did not happen."* |
| **Root cause** | `pgMigrate` verifies against `EXPECTED_TABLES`, a hand-maintained list. My table was declared in `SCHEMA_SQL` and never added to that list, so "32/32" counted 32 names that all existed and never looked at the 33rd. **The number was true and meaningless.** |

**The guard that should have caught it was blind by construction, and that is the finding worth
keeping.** `H11` — *"every table this layer added is registered for migration"* — iterates a
hardcoded array of table names. It can only check a table someone remembered to add to it, so the
guard against *"you forgot to register your new table"* itself requires you to remember your new
table, in a **third** place. It was green the entire time. Replaced by
`H:every-declared-table-is-registered`, which derives the list from `SCHEMA_SQL` and therefore
cannot be blind to a new table; mutation-proved FIRED.

**Why the table was missing at all is a SEPARATE and still-open question.** A manual pg-migrate
re-run created it immediately, so the deployed bundle did contain the statement. The workflow's
converge check reported *"worker is serving 036620a after 1 attempt(s)"* — first attempt, unusually
fast for a fresh deploy — and its own comment says it exists so that *"pg-migrate would not run
whichever bundle IS serving"*. **Leading hypothesis, stated as inference not fact:** Azure Functions
runs several worker instances; the health probe hit a converged one and the pg-migrate POST landed
on another still serving the old bundle. I have no instance-level evidence, so this is not proven —
it is the next thing to measure, and it is recorded rather than fixed on a guess.

**Calibration note on my own reporting.** I wrote "Deployed" and "api-deploy → success" before
querying the database. That sentence was true about the workflow and false about the world. A
deploy's exit code describes the deploy; only the database describes the schema.

For the trend table: `self-caught`, but only just, and after the claim had already been made to the
owner in this session.

### `git add -A` on a SHARED working tree committed another session's live mutation

| | |
|---|---|
| **Claim** | Commit `12b7da0` — "The copy has run: 14 blocks, 8003 chars, verified in the live database" — described a ledger update and a verifier artifact. |
| **Ground truth** | **It also contained `entity[r.block_key + '_pg'] = r.text`** in `masterContext.ts`. A concurrent session was mid-`mutate.sh`, proving `H:mastercontext-baseline-parity` fires, and my `git add -A` swept its transient edit in. Confirmed by `git show 12b7da0 -- api/src/functions/tests/masterContext.ts`. Reverted by that session as `d646b9e`. |
| **The single source that would have settled it** | `git status` before staging, or `git diff --cached` before committing — either would have shown a file I had not touched. I ran neither, because `-A` made the question feel answered. |
| **Blast radius, had it landed** | `entityFromBlocks` would emit `skills1_pg` instead of `skills1`. `masterBaseline` would not recognise a single key, so the baseline would come back EMPTY — and the baseline is what every swap row's "original" compares against. Silent, total provenance corruption on every packet built after the switch flipped. Exactly the failure the TIER 1 designation exists to prevent. |
| **Root cause** | Two sessions share this working tree. `git add -A` stages the TREE, not my work, and I have no way to distinguish the two. |

**Caught by a peer, not by me and not by a guard.** `H:mastercontext-baseline-parity` would have fired
— it is literally the guard being exercised at that moment — but only if the suite ran between my
commit and my push. **I chained `git add -A && git commit && git push` in one command with no suite
run in between.** The suite takes twelve seconds.

**Two changes, both concrete rather than a reminder:**
1. **Never `git add -A` in this repo.** Name the paths. The command is not a convenience here, it is a
   claim about authorship that I cannot substantiate on a shared tree.
2. **Run the suite between committing and pushing**, not only before committing. A commit is
   recoverable; a push is what other lanes and `main` build on.

**It did NOT reach `main`** — verified with `git merge-base --is-ancestor 12b7da0 origin/main` → false,
and `git show origin/main:...masterContext.ts` still reads `entity[r.block_key]`. Nothing deployed.

For the trend table: `peer-caught`. Not self-caught, not instrument-caught. That is the worst category
in this log and the first entry in it.
>>>>>>> origin/main

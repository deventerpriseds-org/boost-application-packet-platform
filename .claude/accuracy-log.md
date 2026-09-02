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
| Verification passes with verdicts | 21 |
| CONFIRMED verdicts | ~398 |
| REFUTED verdicts | ~67 (**14%**) |
| Entries in THIS log before today | 5 |

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
<!--
WHAT:       Every defect found in the coverage/recognition path during the 2026-09-01 summary
            investigation, consolidated, with proven-vs-inferred marked per row.
WHY:        Owner, 2026-09-01: "b won't matter if it still didn't recognize when it has actually
            covered something and everything else we've seen wrong. what are the collective
            problems we've found with it so far"
SUPERSEDES: nothing. Companion to DIAG-summary-stuffing.md, which is the narrative; this is the list.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   db-query runs 33464643167 / 33464691925 / 33464754745 / 33464953337 / 33465421502 /
            33465454139; local probes /tmp/probe*.mjs, /tmp/real.mjs, /tmp/trinnex.mjs against
            api/dist; source traces cited inline. Fixture throughout: the TRINNEX packet, which is
            the owner's test packet.
-->

# The collective problems — coverage and recognition

## The owner's framing is correct, and it reorders the work

> *"b won't matter if it still didn't recognize when it has actually covered something"*

Option **(b)** — auto-count paraphrase — is a decision about **what to do with a recognizer's
output**. It cannot be better than the recognizer. Every row in group **A** below is a reason the
recognizer is wrong today, and shipping (b) on top of it would auto-count from a broken input and
put the result in a real job application. **A comes before B and C.**

---

## GROUP A — the system does not recognise coverage that IS there

| # | defect | status | evidence |
|---|---|---|---|
| **A1** | **`coversIn` demands 70% LITERAL content-word overlap.** No paraphrase can reach it. | **PROVEN** | `checks.ts:263-282`. Executed: paraphrase 0.29, partial 0.43, verbatim lift 1.00. On the owner's Trinnex summary: **0 of 19 counted, 4 near-misses at 0.67 / 0.60 / 0.57 / 0.50**. The 0.60 is *"align engineering strategy with business goals"* answered by *"aligning engineering strategies with business objectives"* — two words swapped, and it counts as nothing. |
| **A2** | **The profile↔posting matcher finds NOTHING on a real posting.** `0 of 12 responsibilities answered` means zero of the twelve Trinnex responsibilities have a rule-found excerpt from the owner's profile. This is a different failure from A1 and is not about the summary at all. | **PROVEN** (measured on screen + `checks.ts:877`) | `responsibilities_addressed = resp.filter(r => !ruleEvidenceOf(r))`; `ruleEvidenceOf` (`checks.ts:807`) is a `requirement_evidence` row minus unconfirmed proposals. |
| **A3** | **Requirements are stored COMPOUND, and are unevidenceable by construction.** Rows carrying a dozen content tokens and several separate requirements. R2 needs ONE contiguous excerpt from ONE record, so no résumé sentence can ever satisfy them. | **PROVEN, pre-existing** | `D:compound-requirements-unevidenceable`, OPEN: **0 of 38 evidenced** on posting `c5671835` AFTER the matcher was fixed. This is the extractor's split, upstream in `buildRequirements`. |
| **A4** | **Requirements are stored TRUNCATED** — the verb is dropped and a noun phrase kept. | **PROVEN, pre-existing** | `D:locate-truncates-requirements`, OPEN: **22.1% of 7,048 located rows start lowercase; 13.1% are ≤4 words.** *Read the nuance*: that row records a tested premise that truncation does NOT suppress evidence matching. Where it DOES bite is `covers()` — a truncated requirement makes `evidence_placed` **easier** to satisfy than the employer's real sentence would be. A loosening, not a blocker. |
| **A5** | **There is no confirm path.** `evidence.confirmed_at` is the designed promotion from "a model proposed this" to "it counts" — **read by two places, written by nothing.** | **PROVEN** (producer+consumer sweep) | Read at `appChecks.ts:125`, `appRequirements.ts:483`. No route writes it; no control in `app/src` calls one. Owner facts have a confirm flow; evidence proposals do not. |

**A1 and A2 compound.** A1 says a paraphrase of the JD does not count. A2 says the profile does not
evidence the JD either. So both routes to "covered" are closed at once, which is why the screen reads
`0` everywhere while the document visibly speaks to the role.

---

## GROUP B — the system does not notice when it IS copying

| # | defect | status | evidence |
|---|---|---|---|
| **B1** | **`posting_wording_kept` needs 8 CONSECUTIVE exact tokens.** Phrase-level lifting is structurally invisible. | **PROVEN** | `figureEcho.ts:466`. A summary stitched from short JD phrases **closes a requirement with 0 offenders**. On both real packets: `pass`, 0 offenders, while the eMoney summary lifts `AI-first` verbatim and reuses words from **8 of 8** requirements. |
| **B2** | **It is severity `warn`** — never blocks the gate, and the remediation loop does not read it as pressure. | **PROVEN** | `checks.ts:554-563`. |
| **B3** | **`buildScopedPrompt` hands the model the employer's exact sentences and forbids only INVENTING — never COPYING.** | **PROVEN** | `remediation.ts:506-526`. No instruction against reusing the employer's wording exists anywhere in that prompt. |

**A1 + B1 together are the trap the owner walked into:** the only way to make a requirement count is
to copy, and the only detector that would catch copying cannot see the kind of copying that works.

---

## GROUP C — the incentives point at copying

| # | defect | status | evidence |
|---|---|---|---|
| **C1** | The remediation loop's stopping condition is `coversIn`, so **copying is the only strategy that terminates the loop.** | **PROVEN as a mechanism; NOT the current cause** | `CLOSE_CHECK_KEY = 'evidence_placed'` (`remediation.ts:225`). But `remediation_loop` = 1 row and **all 4 `ResumeSummary` insertions are `loop 0`** — the loop has never rewritten a summary. **Live hazard for fields it DOES rewrite; not what happened here.** |
| **C2** | `scopeForRequirements` withholds a field only when it SOLELY covers a CLOSED requirement — so **a subtle summary, covering nothing, is in scope on every pass, forever.** | **PROVEN** | `remediation.ts:390-396`. |
| **C3** | The summary is written by **Call 3, the owner's `ats_user` ATS QC prompt**, which outranks Call 1. **We changed what that prompt is fed** on 2026-08-22 (`4fb00e1`): Call 2's output used to fail to parse and be discarded, and now `mergeCallTwo(c1, c2)` feeds it in. | **HYPOTHESIS — dated and checkable, NOT proven** | `mt17.ts:137`, `pipeline.ts:525-534`, `D31`. Test: compare `ResumeSummary` on `insertion` rows created before vs after that date. |

---

## GROUP D — nothing tells the owner what the text actually covers

| # | defect | status | evidence |
|---|---|---|---|
| **D1** | **Three surfaces, three different questions, and NONE answers "what does this text address from the JD".** | **PROVEN by trace** | chip `POSTING LINE ANSWERED` ← `insertion.requirement_id` (`assetBlocks.js:344`, written `appInsertions.ts:131`) = *what the field was written AGAINST*. Count `0 of 12` ← `responsibilities_addressed` = *what the PROFILE evidences*. `coversIn` → `evidence_placed` = *what reached the document*, and needs 0.70 so paraphrase is invisible. **The owner's question has no surface.** |

**This is the one the owner asked for, and it is genuinely ABSENT rather than constrained** — a real
build, extending `ReqChip` (`AssetBlocks.jsx:1150`), not a surfacing job.

---

## GROUP E — no undo

| # | defect | status | evidence |
|---|---|---|---|
| **E1** | **`artifact.version_history` stores `{"len": N}` — a character count, not the text**, and nothing reads it. No version of any artifact survives a rebuild. | **PROVEN, pre-existing** | `D:every-build-is-destructive`, OPEN. `appPackets.ts:218`. The owner has already decided (OD-5) that this is fixed BEFORE a manual `Rewrite` button is wired, because a Rewrite on top of it is an irreversible overwrite of their own prose. |

---

## WHAT THIS MEANS FOR THE ORDER OF WORK

1. **A2/A3 first — the recognizer returns nothing.** `0 of 12` is not a threshold problem; the
   profile↔posting matcher finds no evidence at all, because the requirement rows it is matching
   against are compound. **Nothing built on top of coverage is trustworthy until this is understood**,
   and it is the largest single reason the owner's screen reads as broken.
2. **A1 + D1 together — recognise paraphrase, and SHOW it.** These are one piece of work: the same
   four Trinnex near-misses are both the coverage the owner is being denied and the restatement they
   object to. Option (b) belongs here, and only here, once A2/A3 are understood.
3. **B1/B3 — make the copying visible.** A density measure over the posting's vocabulary rather than
   an 8-token run, plus an explicit anti-restatement instruction in OUR prompt (`remediation.ts`,
   never the Prompts table).
4. **E1 — versioning** before any Rewrite button, per the owner's own decision.
5. **C1/C2 — the loop's incentives.** Real, but currently dormant for prose. Lowest urgency of the five.

## WHAT IS NOT WRONG, so it is not re-investigated

- **The remediation loop is not the cause of the summary the owner is reading.** Measured: 0 rows at
  `loop >= 1` for `ResumeSummary`.
- **The chip and the count are not inconsistent.** They answer different questions and both are
  internally correct; an earlier reading of mine said otherwise and was wrong.
- **`COVERAGE_THRESHOLD` is not to be lowered.** Owner-decided. It is shared by four decisions across
  every field, and was raised 0.5 → 0.7 to fix a real false positive.

---

# A1, EXACTLY — TWO OF THE FOUR "no"s ARE CAUSED BY WORD ENDINGS

Owner, 2026-09-01: *"but you showed me a table that said no when the match is clear"*. They are right,
and the per-token breakdown says something sharper than "it cannot do paraphrase". Executed
(`/tmp/why.mjs`, `api/dist`), Trinnex summary against its own requirement rows:

```
#15  3/5 = 0.60   HIT: align, engineering, business      MISS: strategy, goals
#12  4/6 = 0.67   HIT: engineering, technology, software  MISS: leadership, organizations
#9   4/7 = 0.57   HIT: build, high-performing, engineering, teams   MISS: develop, managers, technical
#7   2/4 = 0.50   HIT: emerging, technologies             MISS: opportunities, apply
```

## The misses are not all the same KIND, and that is the finding

| miss | requirement's word | the summary's word | what kind of miss |
|---|---|---|---|
| #15 `strategy` | strateg**y** | strateg**ies** | **INFLECTION — the same word, pluralised** |
| #12 `leadership` | leader**ship** | **leader** | **INFLECTION — the same word** |
| #15 `goals` | goals | objectives | synonym |
| #7 `apply` | apply | leverage | synonym |
| #7 `opportunities` | opportunities | — | JD framing, absent |
| #9 `develop`, `managers`, `technical` | — | — | **genuinely absent — a fair "no"** |

**Fix the inflections alone and two rows cross the line, with no threshold change and no model:**

- **#15: 3/5 = 0.60 → 4/5 = 0.80 → PASSES**
- **#12: 4/6 = 0.67 → 5/6 = 0.83 → PASSES**

## The mechanism, and why it is arbitrary rather than merely strict

`coversIn` tests `covText.includes(tk)` — a **raw substring test with no stemming or lemmatisation**.
That means it succeeds **only when the requirement's token happens to be a literal prefix or substring
of a word in the candidate text**, and fails otherwise:

| requirement token | summary word | `includes()` | why |
|---|---|---|---|
| `align` | align**ing** | **true** | the JD token is a prefix of the longer word |
| `build` | build**ing** | **true** | same |
| `strategy` | strateg**ies** | **false** | `strategies` does not contain the string `strategy` |
| `leadership` | **leader** | **false** | the JD token is LONGER than the document's word |

**So the check is not consistently strict — it is inconsistently lucky.** Whether an inflected match
counts depends on which side happens to be longer. Nothing in the code intends this; it is what a bare
`includes()` does.

## What this changes about the plan

1. **A stemmer is a DETERMINISTIC fix with no model and no threshold change.** This is OD-1's option
   (c), and it is far cheaper than that option was costed at. It should go FIRST, ahead of A2/A3 —
   it is small, it is testable, and it demonstrably fixes half of the observed misses on the owner's
   own packet.
2. **Only the SYNONYM misses (`goals`/`objectives`, `apply`/`leverage`) need judgement**, which is
   where option (b) or a synonym table actually belongs. That is a much smaller surface than "make
   coverage paraphrase-aware".
3. **#9 stays a fair "no"** — the summary genuinely does not say *managers* or *technical*. A
   recogniser that passed it would be wrong. **Any fix must keep #9 failing**, and that is the
   regression test.

## CAVEAT, stated before anyone builds it

Stemming **loosens** the predicate, and `COVERAGE_THRESHOLD` was raised 0.5 → 0.7 to fix a real false
positive (`checks.ts:668-673`, the *"digital water technology"* case). This is a loosening of a
different kind — it matches words that genuinely ARE the same word, rather than lowering the bar for
how many must match — but that distinction has to be **proved, not asserted**:

- the Trinnex `#9` row must still FAIL after the change (the guard against over-matching);
- the historical false positive the threshold was raised for must be re-run and must still fail;
- the stemmer must be mutation-proved: revert it, confirm #15 and #12 drop back under 0.70.

---

# THE ARCHITECTURAL ANSWER — coverage is decided by STRING MATCHING, with zero model judgement

Owner, 2026-09-01: *"this is clearly word matching functions instead of llm judgement. you didn't dig
deep enough to tell me the truth"*. **Correct on both counts.** Everything above described symptoms —
a threshold, a plural — one turn at a time. The architecture is the finding, and this is it.

## 1. NINE lexical thresholds decide everything. No model participates.

`grep -rn "openai(" api/src/functions/tests/*.ts` returns **two files: `pipeline.ts` and `mt19.ts`** —
generation and the legacy MT path. **`checks.ts`, `evidence.ts`, `requirementSupport.ts`,
`dimensions.ts` and `swaps.ts` never call a model.** Every coverage, evidence, placement and
attribution decision in this system is a token-overlap ratio compared against a tuned constant:

| constant | file | what it decides |
|---|---|---|
| `COVERAGE_THRESHOLD = 0.7` | `checks.ts:264` | does the DOCUMENT cover the requirement |
| `EVIDENCE_THRESHOLD = 0.7` | `evidence.ts:287` | does the PROFILE evidence the requirement |
| `MIN_JUDGEABLE_TOKENS = 3` | `checks.ts:266`, `evidence.ts:296` | is it judgeable at all |
| `RESOLVE_MIN_TOKENS = 2` | `evidence.ts:310` | |
| `ANCHOR_THRESHOLD = 0.6` | `requirements.ts:193` | locating the employer's verbatim |
| `MIN_STEM = 4` | `requirementSupport.ts:103` | how far a word may be stemmed |
| `SWAP_THRESHOLD = 0.5` | `swaps.ts:152` | is this the same item, reworded |
| `ATTRIBUTION_THRESHOLD = 0.34` | `swaps.ts:201` | |
| `WORDING_RUN_TOKENS = 8` | `figureEcho.ts:466` | is this stuffing |

**This is deliberate, and it is written down.** `checks.ts:781` — *"a model may PROPOSE, only an exact
rule may ACCUSE, and `must_have_coverage` is the accusation."* An LLM evidence path exists
(`evidenceProposal.ts:274` writes `method:'proposed'`) and is **structurally barred from counting** at
three separate places (`appRequirements.ts:212`, `dimensions.ts:455`, `checks.ts` `ruleEvidenceOf`).
Its only escape hatch is `confirmed_at`, which **A5 proves nothing writes.** So the model's judgement
is not merely distrusted — it is unreachable.

**The owner never made this decision.** It is a design choice inherited from the fabrication-safety
rules, and it is the root cause of "it says no when the match is clear."

## 2. THE SAME CONCEPT HAS TWO IMPLEMENTATIONS, and the owner is looking at the naive one

| | matcher | stemming? | used by |
|---|---|---|---|
| **good** | `requirementSupport.sameWord` / `forms()` | **YES** — `MIN_STEM=4`, irregulars, `-ies`→`-y`, `-ed`, `-es`, de-doubling | `evidence.ts:43,358` (*"the judgement itself lives in `requirementSupport.supportIn`"*), `appRequirements.ts:17` |
| **naive** | `swaps.itemTokens` + `covText.includes(tk)` | **NO** — raw substring | **`checks.ts:277` `coversIn`** — the function that produced every "no" on the owner's screen |

**Executed proof** (`/tmp/same.mjs`, against `api/dist`):

```
sameWord('strategy','strategies') = true      <- #15's blocking miss, ALREADY SOLVED in this repo
sameWord('managers','manager')   = true
sameWord('leadership','leader')  = false      <- derivational, not inflectional
sameWord('goals','objectives')   = false      <- synonym
sameWord('apply','leverage')     = false      <- synonym
forms('strategies') = { strategies, strategy }
```

The existing stemmer's own comment names `strategies -> strategy` and `teams -> team` as worked
examples. **The exact failure on the owner's summary is a documented example of a function this
codebase already ships and `coversIn` does not call.** That is not a missing capability — it is the
"extend, don't duplicate / fix all consumers" violation this repo's own CLAUDE.md exists to prevent,
and `coversIn`'s docstring compounds it by claiming to be *"the SAME predicate that decides
`must_have_coverage`"*, which it is not.

## 3. What wiring the EXISTING matcher into `coversIn` actually buys — measured, not estimated

Of the six blocking misses across the owner's four near-miss rows:

| miss | kind | fixed by the existing stemmer? |
|---|---|---|
| #15 `strategy` | inflection | **YES** → #15 goes 3/5 = 0.60 → **4/5 = 0.80, PASSES** |
| #12 `leadership` | derivational (`leader`) | no |
| #15 `goals`, #7 `apply`, #7 `opportunities` | synonym / framing | no |
| #9 `develop`, `managers`, `technical` | genuinely absent | no — and correctly so |

**One of four rows. The other three need to understand that `goals` and `objectives` mean the same
thing, and that `leader` and `leadership` are the same claim.** No threshold, no stemmer and no
regular expression does that. **That is judgement, and the owner is right that it is what the job
needs.**

## 4. So the honest choice, stated plainly

The system's safety model is *"only an exact rule may accuse"*. On the owner's real data that rule
returns **0 of 19** on a document that visibly addresses the role, and **0 of 12** from a profile that
visibly contains the experience. **A rule that is never wrong in the fabrication direction is wrong in
the other direction on essentially every row.**

Three ways forward, and they are not equivalent:

1. **Wire the existing stemmer into `coversIn`.** Cheap, deterministic, no new dependency, fixes
   exactly one of four rows. **Necessary and nowhere near sufficient.** Also removes a real
   duplication defect regardless of what else is decided.
2. **Make the model's judgement REACHABLE** — build the `confirmed_at` writer (A5) so a proposal can
   be promoted by a human. Keeps the house rule intact (a person accuses, not the model) and is the
   smallest change that admits semantics at all.
3. **Let the model decide coverage directly** — the owner's option (b). Deletes the house rule. Every
   count then rests on unverified model reasoning, which is exactly what the rule was written to
   prevent — **but the display the owner is also asking for is what makes it auditable**, and that
   changes the risk materially.

**These are the owner's call, and (1) is the only one that is unambiguously correct on its own merits.**

## 5. My own failure here, recorded

The owner had to ask three times. I reported the threshold (turn 1), then the plural (turn 2), then
the architecture (turn 3) — each true, each a symptom, and the ordering wasted the owner's time. The
one command that would have led with the truth was
`grep -rn "openai(" api/src/functions/tests/*.ts` — two files, neither in the decision path. **When
asked "why does it say no", establish WHAT KIND OF THING is deciding before characterising how it is
tuned.**

---

# I REPORTED TWO WRONG ANSWERS AS IF THEY WERE CORRECT BEHAVIOUR

Owner, 2026-09-01: *"why are the second two examples false and you didn't notice that is incorrect?"*

I printed this and annotated it as a fact about the stemmer's scope:

```
sameWord('strategy','strategies') = true
sameWord('leadership','leader')   = false     <- I labelled this "derivational, not inflectional"
sameWord('goals','objectives')    = false     <- I labelled this "synonym"
```

**Both `false`s are WRONG ANSWERS to the question the system is actually asking.** `leadership` and
`leader` are the same word. A document saying *"Visionary technology **leader**"* does address a
requirement reading *"Engineering & Technology **Leadership**"*. I described the tool's limitation and
let it stand in for the correct answer — the same error as reading the shipped summaries by eye and
calling them clean, earlier in this same investigation. **A tool's boundary is not a definition of
correctness.**

## The defect is far wider than one plural — measured

`requirementSupport.forms()` handles **INFLECTIONAL** suffixes only (`-s`, `-es`, `-ies`, `-ed`,
`-ing`). It handles **NO DERIVATIONAL** morphology at all. Executed against `api/dist`:

```
forms('leadership') = { leadership }          forms('leader')  = { leader }
forms('management') = { management }          forms('manager') = { manager }
forms('governance') = { governance }          forms('govern')  = { govern }
forms('delivery')   = { delivery }            forms('deliver') = { deliver }
forms('operations') = { operations, operation }   forms('operate') = { operate }

sameWord('leadership','leader')   = false     WRONG
sameWord('management','manager')  = false     WRONG
sameWord('governance','govern')   = false     WRONG
sameWord('delivery','deliver')    = false     WRONG
sameWord('operations','operate')  = false     WRONG
sameWord('engineering','engineer') = true     <- correct, and ONLY because -ing is inflectional
```

**`governance`, `delivery`, `operations`, `management`, `leadership` are the vocabulary executive job
postings are built from.** The Trinnex posting alone contains *"engineering standards, **governance**,
metrics"*, *"modern software **delivery** practices"*, *"machine learning **operations**"*,
*"**Manage** engineering priorities"* and *"Engineering & Technology **Leadership**"*. This is not a
corner case; it is the core noun vocabulary of the domain, failing on every row.

## Corrected arithmetic on the owner's four rows

| row | blocking misses | with inflection only | with inflection + derivation |
|---|---|---|---|
| #15 | `strategy`, `goals` | 0.60 → **0.80 PASSES** (strategy fixed) | 0.80 PASSES |
| #12 | `leadership`, `organizations` | 0.67 — still fails | **0.83 PASSES** (leadership↔leader) |
| #7 | `opportunities`, `apply` | 0.50 — fails | 0.50 — fails (both are synonym/framing) |
| #9 | `develop`, `managers`, `technical` | 0.57 — fails | 0.57 — fails, **and correctly so** |

**Two of four, not one of four** — and the second one only once the stemmer stops treating a
derivational pair as two different words.

## What this does to the conclusion

It does **not** rescue the lexical approach; it sharpens why the owner is right. Even with correct
morphology, `goals`/`objectives` and `apply`/`leverage` still fail, and those are ordinary English
synonyms in a domain built on them. A morphology fix converts a broken matcher into a merely
inadequate one. **The judgement question is unchanged and remains the owner's call** (§ "the honest
choice", options 1-3 above).

## The pattern in my own reporting, which is now three instances

1. Read the shipped summaries by eye, called them clean. The measurement disagreed.
2. Saw two numbers on one card, inferred a shared source. The trace disagreed.
3. Printed two wrong answers from a helper and annotated them as scope rather than defect.

All three are the same shape: **accepting a proxy — my eye, an inference, a tool's output — in place
of the ground truth of whether the answer is RIGHT.** The guard that would have caught all three is to
ask, of every value reported: *is this the correct answer to the user's question?* — not *is this what
the code returns?*

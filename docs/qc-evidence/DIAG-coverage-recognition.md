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

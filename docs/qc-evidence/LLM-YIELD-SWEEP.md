# LLM yield sweep — where a model is present but barely answering

**Measured 2026-09-03 against production**, runs `33728402226`, `33728477405`, `33728636117`.
Prompted by the owner's heuristic: *"if there is any instance with an llm but low numbers something
is likely off about the way it's being used / underused."*

**Read the middle column before the right one.** The first denominator I reached for was wrong, and
the discipline of this document is to show both.

## The numbers

| Store | Rows | Against the FAIR denominator |
|---|---:|---|
| `requirement` (all opportunities ever parsed) | 14,595 | — |
| opportunities total | 2,310 | — |
| **opportunities WITH a packet** | **40** | the only ones any of this runs on |
| **requirements on packeted opps** | **140** | **the fair denominator** |
| `requirement_coverage` rows (coverageJudge) | 201 | |
| …**distinct requirements judged** | **21** | **15% of 140** |
| `requirement_evidence` (deterministic resolver) | 16 | 11% of 140 |
| `evidence_confirmation` (owner clicks) | 2 | |
| `review_verdict` | 2 | |

Against 14,595 the judge looks like it has touched 1.4% of the product. **That framing is wrong** —
most requirements belong to opportunities that never got a packet, so nothing was ever supposed to
judge them.

## What is EXPLAINED, and is not a defect

**The judge is ON and its cap is not the constraint.**
- `chk_coverage_judge = true` live. The code default is `false` (`checks.ts:217`) and deliberately
  so — the header explains it changes a check's state, so it starts off until the owner has seen it
  read their own packet.
- `chk_coverage_judge_max = 12`, and the cap counts **one call per FIELD, not per requirement**
  (`checks.ts:131-133`) because the prompt batches every requirement into one ask. An artifact has
  a handful of fields, so 12 is not a throttle.
- 21 of 140 is therefore consistent with **the judge having been switched on recently and only a
  couple of packets having been built since** — not with it being blocked.

**I am not claiming a defect here.** Three times today I called something absent or broken on a
denominator I had not checked. The counts above are the counts; the cause above is the cause I can
evidence.

## What is genuinely OPEN

**86% of the judge's verdicts are `absent`** — 173 of 201, against 24 `synonym`, 2 `direct`,
2 `near_phrasing`. Only 28 of 201 verdicts say covered.

Two explanations fit, and they have opposite implications:
1. **The documents really do not address those lines.** Then the number is honest and the product is
   telling the truth about a weak packet.
2. **The judge is being handed the wrong text** — a field that was never going to answer that line,
   so it correctly says `absent` to a question nobody should have asked.

**The one query that separates them:** group `absent` verdicts by `field`. If they cluster on one or
two fields, it is (2) — a field-selection problem in `judgeableFields`, not a coverage problem.
If they are spread evenly across fields, it is (1).

**Not run yet.** Recorded as the next measurement rather than guessed at.

## The pattern worth carrying to the other model paths

`stuffingJudge` and `supportJudge` ship on the same contract and have **no rows of their own in this
sweep** — they write through the checks pipeline rather than a dedicated table, so this sweep cannot
see their yield at all. **That is a gap in the instrument, not evidence they are idle**, and it is
the first thing to fix before repeating this exercise on them.

# COST — the swap-attribution judge, sized before the ACs (SPEC 4.6-8)

**Measured 2026-09-03** on the live packet `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`
(eMoney Advisor · SVP Development and Enterprise Architecture), from the
`fixture-refresh.yml` dump. Sized BEFORE the criteria so they land against a real budget.

## The shape of the call — CORRECTED 2026-09-03

**An earlier version of this document said "one call per swap row: 28 calls". That was wrong**, and
the owner caught it: *"the 28 judge calls shouldn't be individual... I assume they can fire in 1-3
batches calls max."* Correct.

I had copied `coverageJudge`'s call shape (many requirements against ONE field text) and treated it
as a constraint. It is that judge's shape, not a law: it batches on the REQUIREMENT axis because it
asks about one document at a time. Attribution asks the opposite question and can batch on BOTH
axes — every replacement item in the packet, against the shortlisted requirements, in one request.

**The payload is small.** The items are skill labels (`"Global Engineering Teams"`), not documents:
15 judgeable pairs of a few words each, plus their shortlisted requirement lines. That is a small
prompt, well inside one call.

| | calls |
|---|---:|
| **Whole packet in one request** | **1** |
| Split per list (`skills_1`, `relevant_*`, `expertise`) for smaller, more focused prompts | **2-3** |
| ~~One per swap row~~ | ~~28~~ — superseded twice: batched, and the population is 15 not 28 |

**Why 2-3 might still beat 1:** a per-list call keeps each prompt to items that compete for the same
slots, which is the context that makes an attribution judgeable. That is an AC question, not a cost
one — both are cheap.

## THE HONEST HEADLINE: lane 1 is thin

**Exact containment removes 2 of 17 — about 12%.**

**CORRECTED 2026-09-03 by the AC pass, which caught a denominator error.** This document previously
said *"2 of 30 rows — about 7%"*, mixing two populations. Only **17** of the 30 swapped rows carry a
`requirement_id` at all, and without one there is no keyword associated with the row — so those 13
rows are not candidates for either lane. The honest ratio is against the 17, and the judgeable
remainder is **15 pairs, not 28**: the earlier figure overstated the population by roughly 87%.

The share is still small, because a keyword rarely survives verbatim into the replacement the model
writes.

**So this is a judge feature with a free fast path, not a keyword feature with a judge safety net.**
Worth naming plainly now, so nobody later plans as though the deterministic half carries the load.
Lane 1 still earns its place — it is free, it is exact, and it needs no verdict stored — but it is
the minority case.

## What bounds the spend

- **The verdict cache.** Keyed on every input that can change the answer — `to_label`, `from_label`,
  the requirement text and the prompt version — following `coverageJudge.ts:253`. A packet is judged
  once; re-opening the panel costs nothing.
- **A rebuild re-judges only what changed.** Rows whose `to_label`/`from_label` are unchanged hit the
  cache; a pass that rewrites a list pays only for the rows it rewrote.
- **The shortlist.** `requirement_id` (the 0.34 match) plus requirement `kind` narrows the candidate
  set handed to each call. This is the one legitimate use of the fuzzy link — ranking the question,
  never answering it.
- **Backfill is a choice, not a requirement.** Existing packets CAN be re-judged, but that is a
  deliberate run at 28 calls per packet, not something the feature does on its own.

## What the ACs still have to settle

1. One batched call for the packet, or one per list? Both are cheap; per-list gives each prompt only
   the items competing for the same slots, which may make the attribution more judgeable.
2. Does the shortlist cap the candidate count per call, and at what number?
3. Is a cache miss on a re-judged row visible to the reader, or silent?

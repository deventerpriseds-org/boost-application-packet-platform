# COST — the swap-attribution judge, sized before the ACs (SPEC 4.6-8)

**Measured 2026-09-03** on the live packet `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`
(eMoney Advisor · SVP Development and Enterprise Architecture), from the
`fixture-refresh.yml` dump. Sized BEFORE the criteria so they land against a real budget.

## The shape of the call

`coverageJudge` takes **many requirements against one text** (`buildCoverageUser(reqs, fieldName,
fieldText)`). Attribution wants the same shape — one replacement item, a shortlist of candidate
requirements — so **one call per swap row**, not one per row-requirement pair. That is the
difference between 28 calls and 980.

## The numbers

| | count |
|---|---:|
| `action='swapped'` rows in the packet | 30 |
| **Lane 1 — exact containment, no model** | **2** |
| **Lane 2 — judge calls, uncached** | **28** |
| Distinct requirements available as candidates | 35 |
| Cached steady state | **0** |

## THE HONEST HEADLINE: lane 1 is thin

**Exact containment removes 2 of 30 rows — about 7%.** The owner asked what percentage the keyword
lane could land; this is it, and it is small, because a keyword rarely survives verbatim into the
replacement text the model writes.

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

1. Is 28 calls per packet acceptable at the owner's packet volume, or does lane 2 need a trigger
   (on panel open, on build, on demand) rather than running for every row?
2. Does the shortlist cap the candidate count per call, and at what number?
3. Is a cache miss on a re-judged row visible to the reader, or silent?

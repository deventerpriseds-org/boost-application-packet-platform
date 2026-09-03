# SCOPE — how the keyword panel earns "Took the place of X" (SPEC 4.6-8)

**Rewritten 2026-09-03.** The first version of this scope was wrong in its framing and is superseded
below. Owner decision recorded; implementation gated on the AC pass. Nothing under `api/src` or
`app/src` is touched by this document.

---

## 0. WHAT THE FIRST VERSION GOT WRONG

It offered three options — change the generation contract, exact-match only, or leave it — and
**none of them was the judge.** That was the wrong menu. Owner: *"I thought that's when the judge llm
was supposed to come into play? we know keyword is insufficient."*

Three judges already ship on one contract (`coverageJudge`, `supportJudge`, `stuffingJudge`), each
built for the identical reason: an exact rule was too blunt to answer a question, so a model answers
it and **must cite words the text really contains, which code then verifies byte-exact**. Proposing
new machinery without finding them is the "extend, don't duplicate" failure, and it cost four turns.

It also **over-priced the judge.** The first version's Option A meant changing what the model returns
during generation — a hot path, no backfill, existing packets null forever. A judge does none of
that: it runs *after the fact on stored rows*, so generation is untouched and **existing packets can
be re-judged**.

---

## 1. THE DECISION — two lanes, no overlap

Each lane makes only the claim its own evidence supports. That is what keeps this small.

| Lane | Condition | What the panel says | Backed by |
|---|---|---|---|
| **1. Exact** | `requirement.model_keyword` appears verbatim in `swap_decision.to_label` | **Placement** — *"'global engineering' is in 'Global Engineering Teams', which replaced 'Agile Transformation'"* | String containment. Deterministic, free, no model |
| **2. Judge** | everything lane 1 cannot settle | **Causation** — *"Took the place of 'Agile Transformation'"* | A model verdict that must CITE, with the citation verified byte-exact by code |

**The judge does NOT re-check lane 1.** An intermediate draft added a confirmation pass over the
exact matches; the owner withdrew it (*"what you read back seemed super complicated"*) and was right.
What made it complicated was insisting both lanes make the SAME claim. They need not — placement and
causation are different statements with different evidence — and once each lane says only what it can
prove, the extra pass disappears. Spending model calls to re-confirm a string comparison is cost
with no finding.

**No citation, no claim.** Lane 2 answers `absent` and the panel stays quiet, worded so silence
reads as deliberate rather than broken.

---

## 2. THE FUZZY LINK IS DEMOTED, NOT DELETED

`swap_decision.requirement_id` is written by `attribute()` (`swaps.ts:224`) — `similarity()` token
containment at `ATTRIBUTION_THRESHOLD = 0.34`, matched against the requirement's **verbatim posting
line**, never against the keyword.

**Measured on the live packet, and this is the number that settles it:**

| | count |
|---|---:|
| `action='swapped'` rows | 30 |
| …carrying a `requirement_id` | 17 |
| …**sharing ZERO tokens between keyword and replacement** | **8** |
| …containing the keyword verbatim | 2 |

Worst case is not a low-confidence row: **`AI governance` → `Risk Management` at confidence 1.000**,
because that confidence scores the replacement against the POSTING LINE, never against the keyword.

So `requirement_id` becomes a **shortlist handed to the judge** to narrow which requirements to ask
about — ranking, which it is fine at — and **must never reach the screen as a claim**
(`CLAUDE.md:432`).

---

## 3. WHAT THIS MUST NOT DO

- **Not touch generation.** `buildSwaps`, `call3` and the prompt stay exactly as they are.
- **Not feed a gate, a score or a coverage count.** If a verdict does, the tier rises again.
- **Not merge `must_have_coverage` with `evidence_placed`** — the populations stay apart.
- **Not replace the exact rule.** Every shipped judge kept its deterministic half as the cheap
  fallback, and this one does too.

---

## 4. COST

See `docs/qc-evidence/COST-swap-attribution-judge.md` — sized from the real row counts before the
ACs, so the criteria land against a measured budget rather than a guess.

---

## 5. STATUS

**TIER 1** — a stored verdict is a claim. The AC pass runs independently
(`scripts/verify.sh --kind AC swap-attribution-judge`), artifact
`AC-swap-attribution-judge.md`. **No implementation begins until those criteria land.**

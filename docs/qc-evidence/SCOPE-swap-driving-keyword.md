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

## 1. THE DECISION — ONE lane: the judge

**SIMPLIFIED 2026-09-03 at the owner's instruction.** The previous version had two lanes, exact
containment settling what it could and the judge taking the rest. The owner asked the question that
kills lane 1: *"why do I care about only 2 matching the keyword when we added a judge llm?"*

**Because the answer is: you don't.** The judge is handed the replacement text and a list of
candidate posting lines and picks (`buildCoverageUser(reqs, fieldName, fieldText)` —
`coverageJudge.ts:114`). **It does not consult `requirement_id` and does not need one.** So every
attrition step in the old analysis constrains only the free lane:

| | reach, live, both packets |
|---|---|
| exact keyword containment | **3 of 35** |
| the judge | **35 of 35** |

Lane 1 saves **2-3 decisions out of 35**, inside a request that is batched into 1-3 calls anyway —
so it saves **no calls at all**. For that it costs a second code path, a second wording, a
distinction the reader has to learn, and its own test surface.

**So: one lane.** The judge answers, citing, with the citation verified byte-exact by code. It
answers `absent` and the panel stays quiet. No exact lane, no fuzzy/exact distinction in the copy,
no second wording.

**The 0.34 matcher is not even needed as a shortlist.** With 35 requirements and short skill labels,
every candidate fits in one prompt. Keep the shortlist only if a payload measurement later says so.

## 2. THE FUZZY LINK IS DEMOTED, NOT DELETED

`swap_decision.requirement_id` is written by `attribute()` (`swaps.ts:224`) — `similarity()` token
containment at `ATTRIBUTION_THRESHOLD = 0.34`, matched against the requirement's **verbatim posting
line**, never against the keyword.

**Live, both packets — and note these supersede the single-packet figures this document used to
carry.** 35 `swapped` rows, 19 with a `requirement_id`, 3 with the keyword verbatim in `to_label`.
The eMoney-only funnel below is kept because it is where the earlier numbers came from:

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

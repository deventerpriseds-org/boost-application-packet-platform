# Retention signal measurement — `supportIn` cannot protect a template skill item

**Date:** 2026-08-28 · **Packet:** Trinnex, opp `9f9c370a-4ac9-441e-b58e-02e3ffcf669e`
**Inputs:** 21 live requirements × 20 live skill items, pulled via `db-query.yml` run 33197702155
**Judge:** `supportIn()` from `api/dist/functions/tests/requirementSupport.js`, unmodified
**Visual for the owner:** https://claude.ai/code/artifact/f07b02b8-3206-4668-b236-da1c69a17ab2

## Why this was run

The proposed retention rule for the skills swap was: *keep a template item if it demonstrably
covers a JD requirement, and drop the least relevant ones.* Before building that, two open
questions needed data rather than judgement:

1. Is a thin `supportIn` signal acceptable as a **retention** reason (nothing quoted, nothing
   entering evidence)?
2. How large is the drop pool on a real packet? If most incumbents get protected, "least
   relevant" ordering is inert.

## Result — the signal is absent, not thin

`node docs/qc-evidence/measure-retention-signal.mjs`

```
=== PRODUCTION FLOORS (chars 20, words 4) ===
protected (covers a requirement): 0/20    drop pool: 20/20

=== FLOORS LOWERED TO 0 ===
protected (covers a requirement): 0/20    drop pool: 20/20
```

420 (item × requirement) pairs at two floor settings. **Zero protected in both.** The floors —
the only knob the proposed rule exposed — move the number not at all, because the floors were
never what refused these pairs.

## How far each item got

`node docs/qc-evidence/measure-retention-gates.mjs` reports the FURTHEST gate each item reached
across all 21 requirements, using the exported `gateProgress` / `GATE_ORDER` ranking (so it agrees
with what `evidence.refusalReason` would report).

| furthest refusal | items |
|---|---|
| `below_threshold` (reached the final, owner-settable gate) | 8 |
| `generic_overlap_only` | 4 |
| `no_candidate` | 3 |
| `list_element_unsupported` | 2 |
| `missing_specific_token` | 2 |
| `no_distinctive_token` | 1 |

Twelve of the twenty are refused by a **safety-floor** rule — one an owner setting is not permitted
to override (`SAFETY_FLOOR_RULES`). Only eight are refused by score, and lowering the score floor
to zero still protects none of them, because the floors under test were the quote-length floors,
not the threshold.

## Why a two-word label cannot pass — measured, not hand-counted

`supportIn` scores what fraction of the requirement's **contentful** tokens the excerpt carries
(weak verbs excluded from the denominator), with hard rules above any threshold for named tokens
and for conjunctions that must be evidenced whole.

| requirement | item | support | missing |
|---|---|---|---|
| "Lead engineering execution across software products and client-facing projects." | Engineering Execution | **0.333** (2 of 6) | lead, software, products, client-facing, projects |
| "Experience leading enterprise architecture and cloud strategy" | Enterprise Architecture | **0.500** (2 of 4) | leading, cloud, strategy |

The second row is the verifier's example that made the signal look workable. It passes only
because that requirement is short and its head noun *is* the label. **None of the 21 real Trinnex
requirements has that shape.**

`supportIn` is not broken and nothing here argues for changing the evidence gate. It is a citation
judge, and a section heading is not a citation.

## What this changes

- **Option C — `supportIn` as the retention test — is ruled out by data**, not by preference. It
  protects nothing at any setting, so it neither protects nor orders; it is a no-op that costs a
  model call.
- **Question 2 is answered and inverts the risk I had flagged.** The pool is 20/20, not near-empty.
  Ordering is therefore not inert — it is the only thing distinguishing one proposal from another
  in the right rail, which is the argument for adding a ranking-only relevance signal.
- The owner's rule read literally — *"template value that is the same stays until I say switch"* —
  needs **no coverage judgement at all**.

## Limits of this measurement

- **n = 1.** One packet's live requirements and skill items. A packet whose skill items are
  sentences rather than two-word headings would score differently — that is precisely the variable
  that decides this result.
- Run locally against `api/dist`, not against the deployed Function. `supportIn` is pure and
  deterministic so it is the same code path, but this is not a production observation.
- Nothing was built, no guard weakened, no prompt touched to produce these numbers.

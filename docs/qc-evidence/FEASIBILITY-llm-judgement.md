<!--
WHAT:       Feasibility of the owner's proposal — keep each decision function's inputs and structured
            outputs, replace the lexical body with an LLM verdict that must cite evidence.
WHY:        Owner, 2026-09-01: "to minimize work the inputs and structured outputs can be the same
            but derived and evidenced by an llm", against the five-threshold table.
SUPERSEDES: nothing. Follows DIAG-coverage-recognition.md, which established that nine lexical
            thresholds and zero model judgement decide coverage today.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   signatures read from source and cited inline; H12 read from api/test/hardening.test.mjs:303.
-->

# The proposal is sound, and roughly half of it is already built

**Verdict: FEASIBLE, and cheaper than it looks — but not uniformly, and one constraint decides the
whole design.** Nothing here is started; this is the feasibility table the owner's own rule requires
before implementation.

## 1. The contracts really are small and pure — so "same in, same out" holds

| decision | signature | shape |
|---|---|---|
| does the DOCUMENT cover it | `coversIn(covText: string, r: {verbatim, item_text}) -> boolean` (`checks.ts:276`) | boolean |
| does the PROFILE evidence it | `supportIn(input: SupportInput) -> SupportResult` (`requirementSupport.ts:658`) | already a structured result with a typed `refuse()` path |
| is this stuffing | `scanWording(generated, postingText, profileText, runTokens) -> WordingScan` (`figureEcho.ts:498`) | `{kept[], notApplicable, reason}` |
| locate the employer's sentence | `locate(paraphrase, postingText, taken) -> {verbatim, char_start, char_end, match_method}` (`requirements.ts:264`) | span + method |
| same item, reworded | `similarity(a, b) -> number` (`swaps.ts:143`) | 0..1 |

**Every one is a pure function with a small input and a structured return.** Replacing the body
changes nothing in `checks.ts`, `dimensions.ts`, `remediation.ts`, the schema, or the app. The owner's
"minimize work" instinct is correct: the blast radius is the function bodies plus the tests, not the
system.

## 2. THE LLM-WITH-VERIFIED-CITATION MACHINERY ALREADY EXISTS — this is the big one

`evidenceProposal.ts` already does exactly what the owner described:

- `buildProposalUser(requirement, records, neverEvidence)` (`:105`) renders the requirement and the
  profile records, **excluding banned sources before the model ever sees them**;
- the model returns a quote plus the `source_key` it came from;
- **`verifyProposal(requirement, records, proposal, {neverEvidence, minQuoteChars})` (`:122`) checks
  the citation byte-exactly against the named record** and refuses on a banned source, a short quote,
  or a quote that is not actually present.

So **the model's judgement is already machine-checked rather than trusted** — which is precisely the
"evidenced by an LLM" property the proposal rests on. It runs today, writes `method:'proposed'`, and
is then **barred from counting** in three places (`appRequirements.ts:212`, `dimensions.ts:455`,
`checks.ts` `ruleEvidenceOf`) with its only promotion path, `confirmed_at`, written by nothing (A5).

**A large part of "make the LLM decide" is really "stop discarding the decision it already makes."**

## 3. THE ONE HARD CONSTRAINT — H12 purity, and it decides the design

`api/test/hardening.test.mjs:303` — *"H12: rule modules import neither `@azure/functions` nor `pg`"*.
An LLM call is I/O. **So the model cannot be called from inside `coversIn`, `supportIn`, `scanWording`
or `similarity` without breaking a guard that exists for good reasons** (it is what makes these
functions testable and what keeps 948 tests deterministic).

**Resolution — inject the verdict, do not fetch it:**

```
pure:    coversIn(covText, r, verdicts?)   // verdicts: Map<requirementId, {covered, quote, why}>
impure:  the caller (appChecks/appPackets, which already does I/O) obtains the verdict map once
```

This keeps H12 green, keeps every existing test deterministic by passing a fixture map, and **forces
the batching that makes it affordable**. It is the standard shape and it is not a compromise.

## 4. Volume, measured on the owner's own packet

`coversIn` is called per requirement at `checks.ts:681` (`covers`) and `:905` (`unplaced`). Trinnex
has **21 judgeable requirements**; a packet has **4 artifacts**.

| batching | calls per packet |
|---|---|
| per requirement per artifact | 84 |
| **one call per artifact carrying all 21 requirements** | **4** |

`supportIn` is worse — requirement × profile record — and needs batching per requirement (all records
in one call), which is exactly the shape `buildProposalUser` already builds.

## 5. NOT ALL FIVE ARE EQUALLY GOOD CANDIDATES — this is where I would push back

| decision | LLM? | why |
|---|---|---|
| **does the document cover it** (`COVERAGE_THRESHOLD`) | **YES — do this first** | Pure semantics. It is the one producing the owner's wrong answers. |
| **does the profile evidence it** (`EVIDENCE_THRESHOLD`) | **YES** | Same, and the citation machinery is already built for it. |
| **is this stuffing** (`WORDING_RUN_TOKENS`) | **YES** | *"Is this the employer's sentence in a coat?"* is a judgement, and an 8-token run provably cannot see it. |
| **locate the employer's sentence** (`ANCHOR_THRESHOLD`) | **HYBRID, not LLM** | This returns `char_start`/`char_end`. **Models are unreliable at character offsets** and the whole evidence spine depends on those offsets being exact. Correct split: the model picks the sentence, **code finds the offsets**. |
| **same item, reworded** (`SWAP_THRESHOLD`, `ATTRIBUTION_THRESHOLD`) | **LAST, low value** | This is RANKING, and `CLAUDE.md` explicitly permits fuzzy matching for ranking. It is not producing wrong answers the owner has seen. |

## 6. What it actually costs — the honest list

1. **The test suite is the bulk of the work.** 948 api tests; every one exercising these functions
   needs a fixture verdict map. This is mechanical but it is not small.
2. **Determinism at the gate is a NEW requirement.** A threshold gives the same answer twice; a model
   may not. **The verdict must be stored, keyed on a content hash of (requirement, text)**, or the
   gate flickers between runs on identical input. `requirement_evidence` already has the row shape.
3. **The house rule dies, deliberately.** *"A model may PROPOSE, only an exact rule may ACCUSE"*
   (`checks.ts:781`) is what this replaces. **The mitigation is the owner's own word — "evidenced":**
   `verifyProposal` already makes the citation machine-checked, and the display work already agreed
   makes every counted claim visible. That is a real mitigation, not a hand-wave, and it is why this
   is defensible where bare option (b) was not.
4. **Latency and spend** — 4-8 extra calls per packet build at the batching above. Small against the
   three generation calls already made.

## 7. Recommended order — smallest provable step first

1. **`coversIn` only**, verdict injected, batched per artifact, stored by content hash. It is the
   function producing every wrong "no" the owner has seen, and the smallest surface that proves the
   pattern end to end on the Trinnex packet.
2. **Keep the Trinnex four as the acceptance bar:** #15 and #12 must flip to covered **with a citation
   the code verifies**, #7 becomes a judgement call to inspect, and **#9 must STILL FAIL** — the
   summary genuinely does not say *managers* or *technical*, and a judge that passes it is worse than
   the threshold it replaced.
3. Then `supportIn` (A2 — the profile side, currently returning nothing at all), then `scanWording`.
4. `locate` stays hybrid. `similarity` stays lexical.

**Nothing above is started. This needs the owner's go-ahead: it is multi-file, it deletes a standing
safety rule by design, and it changes what a gate means.**

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

---

# THE OWNER IS RIGHT AND I OVERSCOPED IT

Owner, 2026-09-01: *"it should be simple to ask an llm of these requirements and responsibilities etc
how many are covered by synonyms, near phrasing it else to help determine what is covered and what is
[not]"*

**It is simple, and everything expensive in §3-§6 above came from an assumption I added and the owner
never asked for: that the LLM verdict must REPLACE `coversIn` in the gate path on day one.**

Drop that assumption and the cost collapses:

| what made it expensive | why it disappears |
|---|---|
| 948 test fixtures | **Nothing existing changes**, so no existing test changes |
| H12 purity / verdict injection | The new judge is its OWN module, called from the build path which is already impure. `coversIn` is not touched. |
| determinism at the gate, content hashing | **The gate does not read it yet.** A verdict that decides nothing cannot flicker a gate. |
| deleting *"only an exact rule may accuse"* | **Not deleted.** The rule still governs the gate; this is a measurement shown beside it. |

## The minimal build — additive, nothing existing modified

1. **`coverageJudge.ts` — pure, no I/O, so H12 is not even in play.**
   - `buildCoverageUser(requirements[], documentText)` → one prompt carrying ALL the requirements and
     the field text. Same shape as `evidenceProposal.buildProposalUser` (`:105`), which is the
     precedent to copy rather than reinvent.
   - `parseCoverageVerdict(json, requirements, documentText)` → per requirement:
     `{ covered, basis: 'direct'|'synonym'|'near_phrasing'|'absent', quote, why }`, and — the safety
     property, lifted from `verifyProposal` (`:122`) — **every claimed `quote` is checked byte-exact
     against the document**. A verdict citing text the document does not contain is REFUSED, not
     shown. The model cannot assert coverage without pointing at real words.
2. **One call site** in the build path, batched **once per artifact**: 21 requirements in, 21 verdicts
   out, **4 calls per packet**.
3. **One table.** Checked first, per "extend, don't duplicate": the existing home for artifact×
   requirement coverage is `artifact_score.uncovered_requirement_ids` / `judged_requirement_ids`
   (`schema.ts:768,774`) — **bare uuid arrays with nowhere to put a basis, a quote or a reason.** They
   cannot carry this, so a `requirement_coverage` row per (artifact_id, run_id, requirement_id) is
   justified rather than duplicative.
4. **Render it** in the existing `ReqChip` row (`AssetBlocks.jsx:1150`), which is the surface already
   agreed.

## What this gets on day one

- **The count the owner asked for**: *"of these 21, N are covered — 4 directly, 3 by synonym, 2 by near
  phrasing"* — instead of `0 of 12`.
- **The display**: which JD line each one answers, on what basis, quoting the document.
- **A free evaluation of whether the LLM's judgement is any good**, on the owner's real packets, side
  by side with the lexical answer — **before anything depends on it.** The two disagree on the four
  Trinnex rows by construction, so the first run is itself the experiment.

## What deliberately comes LATER, as its own decision

Letting the **gate** read this. That is the change that deletes the house rule, needs stored
determinism, and can genuinely break a packet's ship path. **It should not be decided before the owner
has looked at a page of real verdicts.** Ordering it second is not caution for its own sake — it is
the cheap-test-before-the-expensive-change rule, and it makes the expensive change optional.

## Acceptance bar stays the Trinnex four

#15 and #12 should come back **covered, with a document quote**; #7 is the interesting one
(`apply`/`leverage`, `goals`/`objectives`); **#9 must come back ABSENT** — the summary genuinely does
not say *managers* or *technical*, and a judge that claims it does is worse than the threshold it was
brought in to replace. **That row is the guard on the judge.**

---

# CORRECTED SCOPE — I misread the owner twice, and both corrections widen the work

Owner, 2026-09-01:

> *"when I said include the gate I meant fold this in with the rest of what you've been working on
> instead of deleting it… you misunderstood me when you thought I was saying you overscoped it. what
> is done today by actors simply needs to be swapped by a model that can reason instead of word
> matching but only where it makes sense"*

**Correction 1.** *"The gate should be included"* did **not** mean "put the document judge on
`must_have_coverage`". It meant **do not defer the gate change out of scope** — I had written that it
*"shouldn't be decided before you've looked at a page of real verdicts"* and the owner was refusing
that deferral, not specifying a call site.

**Correction 2.** *"It should be simple"* was **not** a complaint that I overscoped. I read it as one
and cut the work down to a display-only judge. The owner's actual point is the opposite in direction
and broader in scope: **every place a lexical actor decides something today should be a model that
reasons — wherever reasoning is the right tool.**

**These two corrections RECONCILE with the AC pass's OD-1 finding instead of conflicting with it.**
That pass proved `coversIn` is not on the gate and the gate is decided on the PROFILE side. So
"include the gate" and "swap the actors where it makes sense" resolve to the same answer: **do the
profile side too.** OD-1 is therefore **(ii) AND (iii) together, not either/or** — and never (i).

## The scope, corrected — "only where it makes sense" made concrete

| decision | today | becomes | why this is or is not a reasoning task |
|---|---|---|---|
| **document covers it** — `coversIn`, `COVERAGE_THRESHOLD` | 70% literal overlap | **MODEL** | Produces every wrong "no" the owner has seen. Gives the count and the per-line display. |
| **profile evidences it** — `supportIn`, `EVIDENCE_THRESHOLD` | 70% literal overlap | **MODEL — AND THIS IS THE GATE** | `must_have_coverage` is the only check defaulting to `fail`+`deterministic`, and `:1025` turns exactly that into a gate fail. It reads `ruleEvidenceOf`, the profile path. **It is also where Trinnex returns 0 of 12.** This row is what "include the gate" means. |
| **is this stuffing** — `scanWording`, `WORDING_RUN_TOKENS` | 8 consecutive exact tokens | **MODEL** | *"Is this the employer's sentence in a coat?"* is judgement. Proven blind to phrase-level lifting, which is the shape the owner actually objected to. |
| **locate the sentence** — `locate`, `ANCHOR_THRESHOLD` | 0.6 anchor score | **HYBRID** — model picks the sentence, **code computes the offsets** | Choosing which sentence is reasoning. Counting characters is not, and the whole evidence spine depends on those offsets being exact. This is the clearest case of *"only where it makes sense."* |
| **same item, reworded** — `similarity`, `SWAP_THRESHOLD`, `ATTRIBUTION_THRESHOLD` | containment 0.5 / 0.34 | **STAYS LEXICAL** | RANKING, which `CLAUDE.md` explicitly permits to be fuzzy. Not producing wrong answers anyone has seen. Changing it would be change for its own sake. |

## Consequences for the plan already written

- **`AC-llm-coverage-judge.md` covers the FIRST ROW ONLY.** Its 21 ACs, feasibility table and mutation
  register stand as written and are not wasted — but they are one lane of five, and its OD-1 is now
  ANSWERED rather than open.
- **A second AC pass is needed for the gate lane** (`supportIn`) and the stuffing lane
  (`scanWording`). The gate lane is the one that carries the real risk: it is the only one that can
  turn a packet's ship decision, and it is where determinism, the `not_applicable`-on-failure rule and
  the mutation proofs matter most.
- **OD-2 (the confirm button) is unaffected and still the cheapest item on the board.** The API is
  finished; only a control in `app/src` is missing. It raises `must_have_coverage` off zero with a
  HUMAN as the accuser, so it is worth doing whatever else is decided.
- **`locate` and `similarity` are now explicitly OUT, with a reason** rather than as a deferral.

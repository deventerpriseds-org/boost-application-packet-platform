# Acceptance Criteria — Reasoning Overclaim Verification (Option A)

**Change under judgement:** extend `verifyProposal` (`api/src/functions/tests/evidenceProposal.ts`)
so the model-authored `reasoning` sentence is checked against the QUOTE it justifies. Where the
reasoning asserts a requirement token the quote does not carry, the reasoning is dropped (stored
null) and counted. The quote check (byte-exact `indexOf`) and the row itself are untouched.

**Measured defect:** db-query run 32541365164 — 2 of 5 stored justifications assert something their
own quote does not show ("security" on a scalability quote; "IoT" on a "real-time data collection"
quote).

**Status:** DRAFT — criteria 1-3 written from the brief before reading code; remainder appended
after reading `evidenceProposal.ts` / `requirementSupport.ts`.

---

## Criteria

1. **Given** the escalation-tier proposal for requirement "Ensure delivery of scalable, secure, and
   high-quality software" with the measured quote ("Redesigned a predictive analytics suite …
   scalable digital experience …") and the measured reasoning (which asserts "security"),
   **when** `verifyProposal` runs in `api/src/functions/tests/evidenceProposal.ts`,
   **then** the returned proposal has `reasoning === null` and the overclaim counter is incremented
   by exactly 1, proven by a unit case in `api/test/hardening.test.mjs` named with a slug
   (`H:reasoning-overclaim-security`) that passes the exact measured strings and asserts both.

2. **Given** the escalation-tier proposal for requirement "Knowledge of AI/ML and IoT technologies"
   with the measured quote ("Developed a SaaS platform integrating real-time data collection …")
   and the measured reasoning asserting "IoT data",
   **when** `verifyProposal` runs,
   **then** `reasoning === null` and the counter increments, proven by
   `H:reasoning-overclaim-iot` in `api/test/hardening.test.mjs` using the exact measured strings —
   and specifically NOT satisfied by any fuzzy/similarity score, since the token `iot` is absent
   from the quote by exact whole-word comparison.

3. **Given** a proposal whose reasoning stays general and introduces no requirement token the quote
   lacks (e.g. requirement "Ensure delivery of scalable … software", quote as measured, reasoning
   "The quote shows the candidate redesigned a service into a scalable digital experience."),
   **when** `verifyProposal` runs,
   **then** `reasoning` is returned unchanged (identical string, not trimmed-to-null, not
   rewritten) and the overclaim counter does not increment — asserted by
   `H:reasoning-no-false-positive` in `api/test/hardening.test.mjs`. False positives are the
   primary risk: a guard that drops sound reasoning will be switched off.

---

## Criteria (continued — written after reading the code)

**Read:** `api/src/functions/tests/evidenceProposal.ts` (269 lines, `verifyProposal` L120-159,
`escalateOne` L216-269), `api/src/functions/tests/requirementSupport.ts` (`STOP` L51-65,
`forms` L113-143, `sameWord` L146-151, `tokensOf` L163-172, `namedEntityTokens` L193-210,
`claimTokens` L213-223).

> **BLOCKING FINDING — the proposed mechanism does not catch measured case 1.** Read
> `forms()` at `requirementSupport.ts:113`. `forms('secure')` = `{'secure'}` (no suffix rule
> fires: it ends in `e`, not `s`/`es`/`ed`/`ing`/`ies`). `forms('security')` = `{'security'}`
> (ends in `y`; `ies`/`ied` do not apply). The two sets do not intersect, so
> `sameWord('secure','security') === false`. The requirement token is **`secure`**; the offending
> reasoning says **`security`**. Under the stated mechanism (`claimTokens(requirement)` +
> `sameWord`), token `secure` is NOT found in the reasoning, so **no overclaim is detected and
> case 1 passes through untouched.** Same shape for `high-quality` vs `quality`:
> `tokensOf` keeps `-` inside a token (`requirementSupport.ts:165`), so the requirement token is
> the single token `high-quality`, which `sameWord` never matches against `quality`.
> This is an inference from reading `forms()`, and criterion 4 below is written to make it
> executable rather than argued.

4. **Given** the exact strings `secure`/`security` and `high-quality`/`quality`,
   **when** `sameWord` from `api/src/functions/tests/requirementSupport.ts` is called on each pair,
   **then** the implementation MUST record the observed boolean in a test before relying on it —
   `H:reasoning-morphology-baseline` asserts the current values explicitly, so that if the
   overclaim check depends on `sameWord` returning true for `secure`/`security`, the suite fails
   loudly instead of the guard being silently inert. **Acceptance of the whole change is
   conditional on criterion 1 passing on the REAL measured strings**, not on a hand-picked pair
   where morphology happens to line up.

5. **Given** requirement `"Knowledge of AI/ML and IoT technologies"`,
   **when** `claimTokens(requirement)` is called,
   **then** the token list is exactly `['ai/ml','iot','technologies']` (`knowledge` is dropped by
   `STOP` at `requirementSupport.ts:61`; `of`/`and` are function words; `AI/ML` survives as ONE
   token because `tokensOf`'s character class includes `/`). Asserted in
   `H:reasoning-claimtokens-shape`. Any implementation that assumes `ai` and `ml` are separate
   tokens is matching against tokens that do not exist.

6. **Given** an accepted proposal whose reasoning is judged an overclaim,
   **when** `escalateOne` builds the `EvidenceRow` (`evidenceProposal.ts:243-268`),
   **then** `row.extra` is `null` (not `''`, not the string `'null'`, not the original sentence)
   and every other field of the row is byte-identical to what the same input produces today —
   specifically `quote`, `char_start`, `char_end`, `source_key`, `source_kind`, `source_label`,
   `record_sha256`, `ratio` (still `null`), `method` (still `'proposed'`), `resolver_version`,
   `proposal_version`. Asserted field-by-field in `H:reasoning-drop-row-intact`.

7. **Given** the same overclaiming proposal,
   **when** the escalation batch completes,
   **then** a counter distinct from every existing refusal reason is incremented — the drop MUST
   NOT be reported as a `ProposalRefusal` (`evidenceProposal.ts:49-56`) and MUST NOT appear as
   `refused`/`model_declined`, because the proposal was ACCEPTED and the row was written. The
   `EscalationOutcome` for this path stays `kind:'accepted'` (`evidenceProposal.ts:190-195`) with
   `reasoning: null`, plus an explicit `reasoning_dropped: true` (or an equivalently named field)
   so a caller can count it. Asserted in `H:reasoning-drop-not-a-refusal`.

8. **Given** an overclaim drop occurred,
   **when** the owner or an operator asks how often this fires,
   **then** the count is observable without reading the model transcript — either in the
   escalation summary the route returns or via a `db-query.yml` SQL over
   `requirement_evidence` (`method='proposed' and extra is null`) that distinguishes
   "reasoning dropped" from "reasoning never present". If the two are indistinguishable in
   storage, the criterion FAILS: a silent drop is an unobservable behaviour change on stored
   owner-facing data.

9. **Given** a proposal that `verifyProposal` accepts,
   **when** the overclaim check runs,
   **then** the accept/refuse decision is provably unchanged: the check runs strictly AFTER the
   `indexOf` quote verification (`evidenceProposal.ts:145-146`) and its only possible effect is
   `reasoning -> null`. Asserted by `H:reasoning-check-cannot-gate`: over a fixture set of
   proposals, the set of `{accepted, refusal}` outcomes with the check enabled is identical to
   the set with it disabled. This check can never make an unevidenced requirement evidenced, nor
   an evidenced one unevidenced.

10. **Given** the existing `no_reasoning` refusal (`evidenceProposal.ts:56, 140`) — *"an
    unexplained match is not reviewable, so it is not accepted"* —
    **when** this change stores an accepted row with `reasoning = null`,
    **then** the resulting contradiction MUST be resolved explicitly in the same commit: either
    (a) the `no_reasoning` comment/rule is amended to say that reviewability is required at
    PROPOSAL time but a row may lose it afterwards, or (b) the drop path is changed so the row is
    still reviewable. Shipping both rules as written leaves the module asserting that an
    unexplained match is unacceptable while it writes unexplained matches. Asserted structurally
    in `H:reasoning-null-vs-no-reasoning` (source grep: if `extra` can be null on a `proposed`
    row, the `no_reasoning` doc comment must carry the amendment).

---

## EXECUTED GROUND TRUTH (not inference)

Run against the built module, `api/dist/functions/tests/requirementSupport.js`, with the measured
strings from the brief:

```
sameWord('secure','security')        => false
sameWord('high-quality','quality')   => false
sameWord('scalable','scalability')   => false
sameWord('deliver','delivery')       => false
sameWord('technologies','technology')=> true
sameWord('analytic','analytics')     => true
forms('secure')   = ['secure']       forms('security') = ['security']
claimTokens("Ensure delivery of scalable, secure, and high-quality software")
  = ["ensure","delivery","scalable","secure","high-quality","software"]
claimTokens("Knowledge of AI/ML and IoT technologies")
  = ["ai/ml","iot","technologies"]

CASE 1 (per-token: inReasoning / inQuote / OVERCLAIM)
  ensure        false false  false
  delivery      false false  false
  scalable      true  true   false
  secure        FALSE false  FALSE   <-- the actual defect, NOT DETECTED
  high-quality  false false  false
  software      true  FALSE  TRUE    <-- the guard fires here instead
CASE 2
  ai/ml         false false  false
  iot           true  false  TRUE    <-- correctly detected
  technologies  false false  false
```

**Observation.** Case 1 *is* dropped by the proposed mechanism — but not because of the security
overclaim. It is dropped because the reasoning says "scalable **software** solutions" and the word
`software` does not appear in the quote. The security overclaim, the thing the owner actually
pointed at, is invisible to `sameWord`.

**Interpretation.** A naive H-case written as "case 1 must be dropped" would go GREEN while the
guard is blind to the defect that motivated it. That is precisely the vacuous gate CLAUDE.md's
H-case rules forbid ("assert the invariant, not the incident"). Criterion 11 exists to prevent it.

11. **Given** the measured case-1 reasoning, **when** the overclaim check runs, **then** the test
    MUST assert *which token* triggered the drop, not merely that a drop occurred —
    `H:reasoning-overclaim-security` fails unless the triggering token set contains a token
    derived from the requirement's `secure`. A drop attributed only to `software` does not
    satisfy criterion 1. **This criterion is currently FAILING against the stated mechanism**
    and is the acceptance blocker.

12. **Given** the brief quotes case 2's reasoning only in fragments ("claims 'experience with IoT
    data'"), **when** `H:reasoning-overclaim-iot` is written, **then** it MUST use the verbatim
    `extra` string pulled from `requirement_evidence` via `db-query.yml` (the row behind run
    32541365164), not a reconstruction. A guard proven against a sentence someone typed from
    memory is proven against nothing.

13. **Given** a proposal whose `reasoning` is absent, `null`, `''`, or whitespace-only,
    **when** `verifyProposal` runs, **then** the pre-existing `no_reasoning` refusal at
    `evidenceProposal.ts:140` fires FIRST and unchanged — the overclaim check must never be
    reached with an empty string, and must never convert a `no_reasoning` refusal into an
    accepted row with null reasoning. Absent reasoning is `no_reasoning`, never "dropped", never
    "clean". Asserted in `H:reasoning-absent-is-refusal`.

14. **Given** a `reasoning` string far larger than one sentence (e.g. 100 KB, or the entire
    profile record pasted back), **when** the check runs, **then** it terminates within a bounded
    time and does not become a de-facto "does the profile contain this token" search — the check
    is bounded by an explicit maximum reasoning length (a configurable setting, per CLAUDE.md's
    no-hardcoded-config rule), beyond which the reasoning is dropped as unreviewable rather than
    tokenised. Asserted in `H:reasoning-bounded-input`.

15. **Given** case differences (`IoT` / `iot` / `IOT`) and plural/tense variants
    (`technologies`/`technology`, `analytic`/`analytics`), **when** the check runs, **then**
    matching is case-insensitive via `tokensOf` (which lower-cases at
    `requirementSupport.ts:168`) and folds only through `sameWord`'s enumerated rules — with the
    known non-folds (`secure`/`security`, `high-quality`/`quality`, `scalable`/`scalability`)
    asserted explicitly so the guard's blind spots are documented in the suite rather than
    discovered in production. Asserted in `H:reasoning-morphology-baseline`.

16. **Given** the same proposal run twice, **when** the check runs, **then** the outcome is
    byte-identical — no randomness, no model call, no network. The check is a pure function of
    (requirement, quote, reasoning) and is exercisable in `node --test` with no transport, the
    same property `evidenceProposal.ts:26-28` claims for the rest of the module. Asserted in
    `H:reasoning-check-deterministic`.

17. **Given** the check is a behaviour the owner may want off or tuned, **when** it ships,
    **then** its enablement and any threshold are owner-settable config seeded with a default —
    not a bare literal in code (CLAUDE.md, "No hardcoded config"). A guard the owner cannot turn
    off when it starts crying wolf is a guard they will get removed by a developer instead.

18. **Given** the deterministic path already writes
    `extra: "the excerpt does not mention: <tokens>"` at `evidence.ts:380` from `supportIn`'s
    `res.missing` (`requirementSupport.ts:658+`), **when** this change adds a
    requirement-token-vs-excerpt comparison, **then** it MUST be implemented by reusing that
    existing `missing` computation rather than by writing a second, parallel token comparison —
    CLAUDE.md, "Extend, don't duplicate". Asserted structurally in
    `H:reasoning-reuses-missing`: the new code path calls the existing support/missing machinery,
    and does not introduce a private re-implementation of "which requirement tokens does this
    excerpt carry".

---

## RISKS THE PLAN MAY HAVE MISSED

Cold read. I do not think the owner's chosen option is the right one, and the codebase agrees with
me — see R6.

**R1 — The mechanism does not detect the defect it was commissioned for.** Executed above.
`sameWord('secure','security')` is `false`, so the security overclaim is invisible. Case 1 only
appears to be caught because of an unrelated token (`software`). Ship this as written and the
owner will be told "both measured cases are now caught" while one of them is caught by accident
and the underlying class — a nominalised form of a requirement adjective — walks straight through.
`security`, `scalability`, `reliability`, `availability`, `observability`, `quality` are the exact
vocabulary of the requirements this feature exists to police, and `forms()` folds none of them.

**R2 — FALSE POSITIVES: the check punishes the model for restating the requirement, which is what
a justification sentence is *for*.** The model is asked (`PROPOSAL_SYSTEM` rule 5) for "one
sentence explaining why this excerpt supports the requirement." Any competent such sentence names
the requirement. So the reasoning will carry requirement tokens by construction, and the check
fires whenever the quote uses a synonym — which is the whole reason the excerpt needed a
justification in the first place. Measured instance: `software` in case 1. "The quote shows
scalable **software** delivery" is a perfectly sound gloss of a quote about a "scalable digital
experience"; the check calls it an overclaim. The better the model is at bridging vocabulary — the
one thing escalation exists to buy (`evidenceProposal.ts:5-10`) — the more often this guard fires
on it. **The guard is anti-correlated with the feature's purpose.**

**R3 — Trivially defeated by rewording, and it selects FOR evasion.** The check keys on surface
tokens. A model that says "the excerpt covers the protective and hardening aspects the role asks
for" overclaims security just as hard and carries no requirement token. Meanwhile the honest,
literal sentence gets dropped. If this check ever influences prompt tuning or model selection, the
gradient points toward vaguer, less checkable prose — the opposite of the module's stated design
(`evidenceProposal.ts:19-24`: "asked one narrow, checkable question"). You cannot make a semantic
claim checkable by counting its words; you can only make it evasive.

**R4 — It punishes candour hardest.** The most valuable sentence the model can write is
"the excerpt shows scale but does **not** address security." That sentence contains `security`,
lacks it in the quote, and is dropped. The check has no notion of negation, hedging, or explicit
disclaimer, so the most reviewable justifications are the most likely to be destroyed. This alone
should stop Option A.

**R5 — Token-level matching is the wrong instrument, and the repo already says so.** CLAUDE.md:
*"Fuzzy matching is for RANKING, never for ACCUSING."* Calling a sentence an overclaim and
destroying it is an ACCUSATION. `sameWord` is a morphological folder — an approximation — and
approximations are licensed here for ranking only. The quote check is accusation-grade because it
is `indexOf` on original bytes, exact, with no folds. Nothing about token overlap between two
prose sentences is exact in that sense. This change puts an approximate matcher in an
accusation-grade seat, which is the specific mistake H4 was written to prevent.

**R6 — Option C is what the codebase already chose for this exact problem, and Option A
contradicts it.** `evidence.ts:380` already writes
`extra: "the excerpt does not mention: <missing tokens>"` from `supportIn`'s `res.missing`. The
deterministic path faced the identical question — the excerpt does not carry every requirement
token — and answered it by **labelling, not deleting**. Option A therefore (a) duplicates an
existing computation (CLAUDE.md "Extend, don't duplicate"), and (b) makes the two paths disagree
about what to do with the same finding: deterministic rows tell the owner what is missing;
proposed rows would silently erase the sentence. Two brains, one problem. The coherent change is:
run the existing `missing` machinery over the proposed quote and append the same note the
deterministic path already uses.

**R7 — Dropping leaves the owner strictly worse off than labelling.** After a drop the owner sees
a quote with no explanation and no indication that an explanation ever existed or was rejected. A
sound-but-unexplained row and an overclaimed-and-stripped row become indistinguishable in the UI.
The module's own comment calls this state unacceptable — `no_reasoning`, *"an unexplained match is
not reviewable, so it is not accepted"* (`evidenceProposal.ts:56`). Option A writes exactly the
artefact the module refuses to accept at the door. Labelling preserves the owner's ability to
judge; deletion removes the evidence of the model's error along with the error.

**R8 — Destroying the audit trail of model misbehaviour.** The two measured overclaims were found
*because the sentences were stored*. Null them and the next investigation has nothing to query.
If the drop ships, the original sentence must still be retained somewhere (a `reasoning_rejected`
column or the escalation record) or the system loses the only signal that the escalation tier is
degrading. A counter tells you *how many*; it never tells you *what the model is doing wrong*.

**R9 — Silent rewrite of owner-facing stored data with no migration story.** Existing
`requirement_evidence` rows keep their overclaiming `extra`; new ones get null. The owner sees two
populations with no way to tell which rule produced which. Nothing in the plan backfills or stamps
a version — and `PROPOSAL_VERSION` (currently `1`) exists precisely so a row can be attributed to
a ruleset. If this ships without bumping it, the provenance guarantee at
`evidenceProposal.ts:32-33` is quietly false.

**R10 — The counter is not enough observability, and `extra is null` is an overloaded signal.**
On the deterministic path `extra is null` already means "the excerpt mentions everything"
(`evidence.ts:380`) — a *good* outcome. Reusing null on the proposed path to mean "the model
overclaimed" gives one value two opposite meanings in one column. Any future query over
`extra is null` becomes ambiguous.

**R11 — `claimTokens` includes weak tokens the check should never accuse on.** `ensure`,
`delivery`, `technologies` are content tokens by `claimTokens` but are near-universal filler in
this genre. `supportIn` already distinguishes them — it has `isContentful`/`WEAK`
(`requirementSupport.ts:554`) and `namedEntityTokens` (L193) precisely because not all tokens
deserve equal force. An overclaim check that treats `software` with the same severity as `IoT` is
using the wrong token population. **If any version of this ships, it should accuse only on
`namedEntityTokens`** — `IoT`, `AI/ML`, `SOC 2`, `Kubernetes` — where a token's presence is a
concrete, checkable factual claim and its absence is unambiguous. Note this would catch case 2 and
correctly decline to judge case 1, which is the honest outcome: `secure`/`security` is a semantic
question that no token comparison should be pretending to answer.

**RECOMMENDATION (stated after the facts, per CLAUDE.md).** Do not ship Option A as specified.
Ship the narrow, exact version of the check — accuse only on named-entity tokens (R11), reusing
`supportIn`'s existing `missing` computation (R6/criterion 18) — and **label rather than delete**
(append to `extra` the same "the excerpt does not mention: …" note the deterministic path already
writes). That catches case 2 with an exact, accusation-grade rule; it declines to fabricate a
judgement on case 1 rather than dropping it for the wrong reason; it keeps the audit trail; it
leaves one meaning for `extra is null`; and it makes the two evidence paths agree. If the owner
still wants deletion, criteria 11 and 12 must pass first — otherwise the change ships a guard that
is green on the incident and blind to the invariant.

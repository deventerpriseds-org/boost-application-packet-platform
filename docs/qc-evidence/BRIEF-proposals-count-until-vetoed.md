<!-- WHAT:       The AC brief for the "proposals count until vetoed" lane -- the input, not the output.
     WHY:        Committed rather than passed inline so the cross-container runner can read it from the
                 checked-out tree, and so the ACs stay auditable against the brief that produced them.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: BRIEF-proposal-counts-and-veto.md (workstreams A+B) and
                 BRIEF-interim-score-and-reviewer.md (workstreams C+D). SPLIT because this brief
                 asked for a feasibility table, ACs for four workstreams and nine design answers in
                 ONE reply, and the single-shot runner hit max_tokens on it (run 33544936097,
                 artifact uploaded as cross-container-pass-TRUNCATED-33544936097-1). Kept for the
                 record; do not run it.
     EVIDENCE:   the ACs it produces land at docs/qc-evidence/AC-proposals-count-until-vetoed.md -->

# AC BRIEF — "a proposal counts until vetoed", and the two score holes beside it

You are writing ACCEPTANCE CRITERIA for work that has NOT started. Repo:
`/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap` at commit 03393cc.
Write to `docs/qc-evidence/AC-proposals-count-until-vetoed.md` **incrementally, as you go** — do not
hold findings until the end. If you are killed mid-pass, what is on disk is what survives.

## THE OWNER'S INSTRUCTION, VERBATIM — this is the scope, do not widen it

> "I already said proposals can count until vetoed. make room for the vetoed data and confirm a way
> to use what we gain to get the score until library is added to suppliment not drop it. why
> wouldn't the reviewer run when the packet is built?"

Four asks. Treat them as four workstreams, ACs for each:

- **A — proposals count until vetoed.** Today a model-proposed evidence row does NOT count toward
  `must_have_coverage`. The owner has decided it should, until they veto it.
- **B — make room for the vetoed data.** A veto must be persisted and must stick across a
  re-resolve. Also: the `missing` text the challenge pass produces is currently COUNTED AND
  DISCARDED, so the owner cannot see WHAT was named missing on a row they are being asked to judge.
- **C — get a score in the interim.** The composite is null. Find the path that produces a real
  number now, with the term library later SUPPLEMENTING it, never being a prerequisite.
- **D — why the reviewer does not run at packet build.**

## GROUND TRUTH ALREADY ESTABLISHED (verify it, do not trust it)

Every line below was read out of the tree this morning. Your job includes falsifying it.

**The one line that pins the number** — `api/src/functions/tests/checks.ts:967`:
```ts
const ruleEvidenceOf = (r: { seq: number }) =>
  (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))
```
`isProposed` = `method === 'proposed'`; `isConfirmed` = `!!confirmed_at`. `must_have_coverage`,
`unaddressed`, and the evidenced list all read `ruleEvidenceOf`. Note it is FAIL-OPEN: `vetted`
counts because no clause names it, not because a clause admits it. An independent verifier already
flagged that; an allow-list is likely the right shape.

**The escalation ladder of warrant** (`method` domain, `schema.ts:1609`):
`exact` / `anchored` (a rule found it) → `proposed` (a model suggested it; shown, never counted) →
`vetted` (two independent reads agreed; counts) → plus `confirmed_at` (the owner said yes).

**Why `vetted` almost never happens — measured live 2026-09-01.** Re-resolve run `33533511977` on
the owner's Trinnex packet: `escalated 11, proposed 9, vetted 0`, with
`escalation_refusals: { support_missing_named: 9, over_cap: 1, quote_not_in_record: 1,
model_declined: 1, not_worth_escalating: 1 }`. The gap-empty condition
(`supportJudge.ts:149`, `if (missing.length) return ... refusal: 'missing_named'`) is the ONLY
constraint that binds. Multi-part requirements ("cloud platforms **and** modern delivery practices")
guarantee a careful model names something, so agreement never gets a chance to decide.
Checks run `33533731959` then read `must_have_coverage = 2/6 (33)`.

**The veto surface that already exists** — `evidence_confirmation` (`schema.ts:515`) is keyed on the
CLAIM (requirement_text, source_key, offsets, record_sha256), NOT on the evidence row, precisely
because `writeRequirements` deletes and re-extracts. It already carries `withdrawn_at` /
`withdrawn_reason` with a CHECK that they are set together. **Extend-don't-duplicate: a veto almost
certainly belongs here, not in a new table.** Say so explicitly, or say why not.

**The vetted-row survival rule** — `appRequirements.ts:228` keeps a `vetted` row across a re-resolve
while its `record_sha256` still matches a live record. Whatever A does must not break that.

**C, the score** — `artifactScore.ts:25`: `mustHave 0.5 + keyword 0.3 + seniority 0.2`, and
`computeArtifactScore` returns `composite: null` unless all three are non-null. Three independent
holes:
  - must_have (0.5) ← workstream A.
  - keyword (0.3) ← reads `{covered, scoreable}` from the TERM LIBRARY, which is on hold. But
    `.claude/DEFERRED.md` `D:call3-returns-empty-and-14kb-is-discarded` records ~14 KB of ATS
    analysis GENERATED AND DISCARDED on every build (Job Description Summary 8,731 chars, Table of
    Skills 2,798, Missing ATS Skills 1,419, Missing ATS Swap Suggestions 1,417, Word/Character
    Check 331, Skills1 316, Skills2 306 — all "maps to no merge field"). Open task #19.
    **The owner's word is "suppliment": the library must later ADD to this, never replace it.**
  - seniority (0.2) ← workstream D.

**D, and this is the finding to verify hardest.** `runReview` (`appReviewer.ts:91`) has exactly ONE
caller: `artifactReviewRun` (`:369`), the route `app/artifact/{artifactId}/review` (`:451`).
`appPackets.ts` never calls it. `appChecks.ts:220` hardcodes `seniority: null` with the comment
"reviewer-graded; P4 supplies it as a stored input". `grep -rn "review" app/src/api.js` returns
three unrelated hits and **no client for that route** — 26 `artifact/…` clients, none of them
`/review`. Conclusion offered for you to falsify: **the reviewer is fully built, deployed and
LLM-backed, and NOTHING IN THE PRODUCT CALLS IT.** If that holds, D is a wiring job, not a build.

## WHAT THIS BRIEF NEEDS FROM YOU

**1. The FEASIBILITY TABLE FIRST, above the ACs.** One row per dependency the work names. Columns:
`Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) |
Verdict`. Verdict is `EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED` / `ALREADY BUILT`.
`ALREADY BUILT` is a first-class outcome — if a thing already works, say so first and the AC becomes
a regression guard rather than a feature. "Absent" is the heaviest claim available: it needs a sweep
of producers AND consumers, never a single-file grep and never a code comment describing a limit.

**2. ACs in `Given <context>, when <action>, then <observable outcome>` form**, numbered, binary.
Cover happy path, edge cases, error states, and a REGRESSION GUARD per workstream.

**3. Answer these design questions with evidence, because they change what gets built:**

- **A1. What is the gate condition after the change?** The proposal is: AGREEMENT (two independently
  chosen spans overlap, `spansOverlap`) becomes the gate, and the named-gap list becomes SHOWN
  INFORMATION rather than a refusal. Is that the right cut? Consider the alternative the owner's
  words also permit — a bare `proposed` row counts with no second pass at all, and `vetted` merely
  ranks higher. Which one does "proposals can count until vetoed" actually mean? Say which, and what
  in the tree decides it.
- **A2. THE SAFETY QUESTION, and it is the one that matters.** This lane's whole discipline is
  "a model may PROPOSE, only an exact rule may ACCUSE". Counting proposals inverts that. What
  becomes newly ACCUSATION-GRADE — i.e. what can now name an offender, block a gate, or assert
  coverage on the strength of model output alone? Enumerate every consumer of `must_have_coverage`
  and of `ruleEvidenceOf` and say, per consumer, whether it is now asserting something a model alone
  supports. Where the answer is yes, the AC must require the surface to SAY SO on its face.
- **A3.** Must a counted-but-unvetoed row be visibly distinguishable from a rule-found one everywhere
  it appears — the checks result, the JD panel, the score breakdown? Name the surfaces.
- **B1.** Where does the veto live? Argue `evidence_confirmation`'s withdrawn pattern vs anything
  else, from the schema comments' own reasoning about identity surviving re-extraction.
- **B2.** Where does the `missing` text live, and what is its identity key so a re-resolve does not
  orphan it? Note `requirement_evidence.extra` is documented as prose-about-the-quote and already
  carries `vettedNote(...)`.
- **B3.** A veto must survive a re-resolve, a re-extraction of the posting, and a profile edit.
  Which of those three should INVALIDATE it instead? (Compare against how `record_sha256`
  invalidates a confirmation — the schema argues fail-closed there.)
- **C1.** Is the discarded Call-3 ATS output actually a viable keyword source, or is that a guess?
  Trace it: who produces those sections, where are they dropped, and is the text still in the tree at
  the moment they are dropped? If it is viable, what is the smallest change that turns it into a
  `{covered, scoreable}` shape `artifactScore` already accepts — and how does the term library later
  SUPPLEMENT rather than replace it?
- **C2.** If any component stays null, the composite stays null by design ("never fabricate a
  composite"). Does the owner get a number at all after A+C+D? Show the arithmetic on real numbers
  from the Trinnex packet if you can reach them.
- **D1.** Confirm or refute the no-caller finding. If confirmed: WHERE should the reviewer be
  invoked — packet build, the checks run, or an explicit control — and what makes that choice
  correct rather than convenient? Note it costs an LLM call, so an unconditional invocation on every
  build is a cost decision, not just a wiring one.

**4. Name every guard that must be mutation-proved**, and for each, the exact defect to reinstate.
Use `/workspace/eds-claude-skills/scripts/mutate.sh` — it has THREE outcomes (`FIRED` / `INERT` /
`NOT-APPLIED`) and the third is why a hand-rolled harness is banned here.

**5. Flag anything in this brief that is WRONG.** It was written by the implementer and the
implementer has been wrong about shapes twice this session. Read the files.

## HOUSE RULES THAT BIND YOUR OUTPUT

- Absent evidence is `not_applicable`, never `pass`.
- Never fabricate a composite: a component with no source makes the score null.
- Fuzzy matching is for RANKING, never for ACCUSING.
- "Should work" / "looks good" are banned. Report what you ran and what it printed.
- New hardening cases take a SLUG (`H:two-words-at-least`), never a number — `H26` fails the suite
  on a new numeric id.
- **NEVER read or edit any prompt in the Prompts table.** The owner's own prompts drive the resume
  draft and are out of scope for every lane.

Suites for reference: `cd api && npm test` (1022 passing), `cd app && npm test` (424 passing).

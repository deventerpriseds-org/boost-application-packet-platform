<!-- WHAT:       AC brief, part 1 of 2 -- the gate change the owner decided, and the veto data behind it.
     WHY:        The single combined brief hit max_tokens on the cross-container runner (run 33544936097,
                 artifact uploaded as TRUNCATED). It asked for a feasibility table, ACs for four
                 workstreams and nine design answers in one reply. Split so each pass fits.
     SUPERSEDES: docs/qc-evidence/BRIEF-proposals-count-until-vetoed.md (workstreams A and B of it).
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   run 33544936097 conclusion=failure, artifact cross-container-pass-TRUNCATED-33544936097-1. -->

# AC BRIEF (1 of 2) — a proposal counts until vetoed, and where the veto lives

Write ACCEPTANCE CRITERIA for work that has NOT started. Repo:
`/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap` at `79ceb12`.

**Write your artifact incrementally as you go.** If you are killed mid-pass, what is on disk is what
survives — a previous pass on this exact brief died having written nothing.

## THE OWNER'S INSTRUCTION, VERBATIM

> "I already said proposals can count until vetoed. make room for the vetoed data and confirm a way
> to use what we gain to get the score until library is added to suppliment not drop it. why
> wouldn't the reviewer run when the packet is built?"

**This brief covers the first two clauses only.** The score and the reviewer are brief 2 of 2
(`BRIEF-interim-score-and-reviewer.md`) — do not write ACs for them here, and do not treat them as
out of scope for the project.

## GROUND TRUTH TO VERIFY, NOT TRUST

Read the files. The implementer wrote this brief and has been wrong about shapes twice this session.

**The one line that pins the number** — `api/src/functions/tests/checks.ts:967`:
```ts
const ruleEvidenceOf = (r: { seq: number }) =>
  (isProposed(r) && !isConfirmed(r) ? null : evidenceOf(r))
```
`isProposed` = `method === 'proposed'` (`:917`); `isConfirmed` = `!!confirmed_at` (`:939`);
`isVetted` = `method === 'vetted'` (`:966`). `must_have_coverage`, the `unaddressed` list and the
evidenced list all read `ruleEvidenceOf` (`:987`, `:1046`, `:1063`). **It is FAIL-OPEN:** `vetted`
counts because no clause names it, not because a clause admits it. A comment at `:962` says so. An
independent verifier already flagged that an allow-list is the safer shape.

**The ladder of warrant** (`method` CHECK, `schema.ts:1609`): `exact` / `anchored` (a rule found it)
→ `proposed` (a model suggested it; shown, never counted) → `vetted` (two independent reads agreed;
counts) → plus `confirmed_at` (the owner said yes).

**Why `vetted` never happens — measured live 2026-09-01.** Re-resolve run `33533511977` on the
owner's Trinnex packet: `escalated 11, proposed 9, vetted 0`, with `escalation_refusals:
{ support_missing_named: 9, over_cap: 1, quote_not_in_record: 1, model_declined: 1,
not_worth_escalating: 1 }`. The gap-empty condition (`supportJudge.ts:149`,
`if (missing.length) return ... refusal: 'missing_named'`) is the ONLY constraint that binds — nine
of eleven. Multi-part requirements ("cloud platforms **and** modern delivery practices") guarantee a
careful model names something, so the agreement test never gets to decide. Checks run `33533731959`
then read `must_have_coverage = 2/6 (33)`.

**The agreement test** — `supportJudge.ts:115` `spansOverlap(aStart,aEnd,bStart,bEnd)`, half-open, so
adjacent spans are NOT agreement. `appRequirements.ts:407-414` promotes to `vetted` only when the
second read's span overlaps the proposal's.

**The veto surface that already exists** — `evidence_confirmation` (`schema.ts:515`) is keyed on the
CLAIM (`requirement_text`, `source_key`, `char_start`, `char_end`, `record_sha256`), NOT on the
evidence row, because `writeRequirements` runs `delete from requirement where opp_id=$1` on every
re-extraction and the FK cascades. It already carries `withdrawn_at` / `withdrawn_reason` with a
CHECK that they are set together. **Extend-don't-duplicate: argue whether the veto belongs here.**

**The vetted-row survival rule** — `appRequirements.ts:228` keeps a `vetted` row across a re-resolve
while its `record_sha256` still matches a live record. Whatever changes must not break it.

## ANSWER THESE, WITH EVIDENCE — they change what gets built

- **A1. What is the gate condition after the change?** Two readings of "proposals can count until
  vetoed" are both available and they build different things:
  (i) **agreement is the gate** — keep the second pass, promote on `spansOverlap`, and demote the
  named-gap list from a refusal to shown information; or
  (ii) **a bare `proposed` row counts** with no second pass required, and `vetted` merely ranks
  higher / displays differently.
  Say which the owner's words mean, and what in the tree decides it. Note (ii) makes the second pass
  optional, which is a cost saving *and* a loss of the one machine-checkable signal.
- **A2. THE SAFETY QUESTION.** This subsystem's rule is "a model may PROPOSE, only an exact rule may
  ACCUSE". Counting proposals inverts it. **Enumerate every consumer of `ruleEvidenceOf` and of
  `must_have_coverage`** and say, per consumer, whether it now asserts something only a model
  supports. Where yes, the AC must require that surface to say so on its face. Include the artifact
  gate and anything that names an offender.
- **A3. Is `ruleEvidenceOf` rewritten as a positive allow-list?** It is fail-open today. State the
  allow-list explicitly and what happens to a `method` value added later.
- **A4.** Must a counted-but-unvetoed row be visually distinguishable from a rule-found one
  everywhere it appears? Name the surfaces (checks result, JD panel, score breakdown, anything else
  you find).
- **B1. Where does the veto live?** Argue `evidence_confirmation`'s withdrawn pattern against any
  alternative, from that table's own comments about identity surviving re-extraction. A veto is the
  owner saying "this claim is NOT supported" — note that is not the same act as withdrawing a
  previous confirmation, and say whether one table can honestly carry both.
- **B2. Where does the `missing` text live?** It is currently counted and discarded, so the owner
  cannot see WHAT was named missing on a row they are being asked to judge. Give it an identity key
  that a re-resolve does not orphan. Note `requirement_evidence.extra` is documented as
  prose-about-the-quote and already carries `vettedNote(...)` output.
- **B3.** A veto must survive a re-resolve and a re-extraction of the posting. Should a **profile
  edit** invalidate it instead? Compare against `record_sha256` invalidating a confirmation, where
  the schema argues fail-closed — and note the asymmetry: a stale *confirmation* over-claims, a
  stale *veto* under-claims. Say whether they should fail the same direction.
- **B4.** What un-vetoes? Is a veto reversible, and if so what does the audit row look like?

## REQUIRED OUTPUT, IN THIS ORDER

**1. FEASIBILITY TABLE FIRST.** One row per dependency this work names:
`Dependency | Producer | Consumer today | Proof (command + result) | Verdict`, verdict one of
`EXISTS` / `ABSENT` / `EXISTS-BUT-CONSTRAINED` / `ALREADY BUILT`. `ALREADY BUILT` is a first-class
outcome — say it first and the AC becomes a regression guard rather than a feature. "Absent" is the
heaviest claim available and needs a sweep of producers AND consumers, never a single-file grep.

**2. ACs** as `Given <context>, when <action>, then <observable outcome>` — numbered, binary, with
happy path, edge cases, error states, and a regression guard.

**3. Every guard that must be mutation-proved**, each with the exact defect to reinstate. The harness
is `/workspace/eds-claude-skills/scripts/mutate.sh` (three outcomes: `FIRED` / `INERT` /
`NOT-APPLIED`; a hand-rolled two-outcome script is banned here because it reported `INERT` when it
meant "the anchor never matched").

**4. Anything in this brief that is WRONG.**

## BINDING RULES

- Absent evidence is `not_applicable`, never `pass`.
- Fuzzy matching is for RANKING, never for ACCUSING.
- Never fabricate a composite; a component with no source makes the score null.
- "Should work" / "looks good" are banned — report what you ran and what it printed.
- New hardening cases take a SLUG (`H:two-words-at-least`), never a number; `H26` fails the suite on
  a new numeric id.
- **NEVER read or edit any prompt in the Prompts table.**

Suites: `cd api && npm test` (1022 passing), `cd app && npm test` (424 passing).

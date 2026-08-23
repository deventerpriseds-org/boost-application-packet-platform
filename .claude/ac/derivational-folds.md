# ACs: Derivational folds in requirementSupport.forms()

Status: IN PROGRESS (research phase, 2026-08-23)

## Research log (append-only)

### Files read
- `api/src/functions/tests/requirementSupport.ts` (785 lines) — `forms()` 113-143, `sameWord()` 146-151,
  `MIN_STEM = 4` @103, `supportIn()` 658-773.
- `api/src/functions/tests/termMatch.ts` — line 13-16 comment: *"Deliberately NOT stemmed — a stemmer
  turns `ops`→`op` and `sre`→`sr`. Plurals are explicit aliases."*
- `api/src/functions/tests/appRequirements.ts` @549 — 2nd consumer of `sameWord`.
- `api/src/functions/tests/evidenceProposal.ts` @338 — 3rd consumer of `sameWord` (`carries`).
- `api/test/matcher.test.mjs` @830-848 — the existing fold table + the existing NOT-fold table.
- `api/test/evidence.test.mjs` @174-182, @286-322 — the threshold-MOVEMENT tests.

### BLAST RADIUS — `sameWord` has FOUR call sites, not one
| Call site | What it decides | Grade |
|---|---|---|
| `requirementSupport.ts:697` `carries` in `supportIn` | **every** gate: `mustName`, `generic_overlap_only`, `list_element_unsupported`, `no_distinctive_token`, and `support` (the threshold numerator+denominator) | **Tier 1 — accusation** |
| `evidenceProposal.ts:338` `carries` | `overclaimed` (withdraws a model's explanation, names it in stored `extra`) and `missing` (the published fact) | **Tier 1 — accusation** |
| `appRequirements.ts:549` | `lookedFor.missingWords` / `closestExcerpt` — read-only diagnostic shown to owner, cannot flip `evidenced` | Tier 2 — advisory |
| `matcher.test.mjs:98` | test harness re-implementation of the same expression | test |

### Measured facts about `supportIn` that constrain the change
1. `carries` is used for `mustName` too (line 729). **Folds ALREADY reach the named-entity gate.**
   A derivational fold therefore CAN let a named token be satisfied by a different word. This is the
   sharpest false-positive surface in the change.
2. `ratio` (line 720-721) is `exactHits/want.length` — **no folds at all**. Folds must leave `ratio`
   byte-identical; it is the ranking key and the stored `evidence_ratio`.
3. `support` (line 719) = `judged.filter(carries).length / judged.length`, `judged = mustCarry` —
   this is the ONLY number the owner threshold gates. Loosening `carries` pushes `support` toward 1
   for every excerpt, which is precisely the H42 "settings-shaped constant" defect the code comment
   at 713-717 records having already been made once.
4. `evidenceProposal.verifyReasoning`: looser folds cut BOTH ways —
   `carries(r,t)` looser ⇒ MORE false withdrawals of a model explanation;
   `carries(q,t)` looser ⇒ FEWER true withdrawals. Both directions are wrong-in-production.

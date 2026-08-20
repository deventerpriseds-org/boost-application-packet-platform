# Deferred work — the ledger of what is NOT done

**Why this file exists.** Twice in one session, work that was never done read as done. The P3
remediation lane died without pushing and the tracker went on listing it as in flight. An
`actions.md` entry said the "Re-run ATS analysis" button could not re-run months after it was fixed.
Both failures are the same shape: **a claim about state that nothing re-checks.**

Every row below is something a reader could reasonably assume is finished and is not. Each names
**what makes it look done** — because that is the thing that will mislead the next session — and the
**trigger** that should make someone pick it up.

Rules:
1. A row leaves this file only when the work is done AND verified, or when the owner decides it will
   never be done — in which case it moves to a "won't do" line with the reason, never just deleted.
2. Adding a row is part of the commit that defers the work. Deferring silently is the failure.
3. `git branch -r` is the proof a lane exists. A tracker entry is not.

---

## P8.2 / R3 — figure echo

| # | Not done | What makes it look done | Trigger |
|---|---|---|---|
| D1 | **The rewrite half of R3 does not exist.** The backlog asks that an echoed figure be REPLACED (`60+` → the candidate's `62`) or generalized (`$18M` → `8-figure`), each logged and revertible. Only the *scan* is built. | The check runs, names offenders, and reads as complete on the QC rail. The PR says "deferred to P8.1", which is half true — the LOGGING needs P8.1's correction table, but the substitution logic is absent independently of it. | P8.1 lands |
| D2 | **`generalize()` has zero production callers.** Tested dead code. | It exists, it is exported, its tests pass, and its outputs match the AC examples exactly. | P8.1 lands |
| D3 | **Nothing computes the candidate's substitute figure.** `scanEcho` keys the profile side on the *exact* figure, so it can answer "does the profile also say 60?" but never "what is the candidate's corresponding number?" This is structural, not a missing function. | `shared[].profileRaw` looks like the substitute. It is the opposite: the figure that must NOT be replaced. | Before D1 — needs a design decision, and a resolver that guesses is worse than generalizing |
| D4 | **Non-numeric echoes are not detected.** The spec asks that wording lifted from the ad be listed separately as "wording kept from the posting", as a user judgement call. | R3 reads as "the echo check" and is green. | P8 close-out |
| D5 | **`swap_decision.to_label` is never figure-scanned.** `runChecks` scans rendered `pkg` fields only, so a swap recorded but not yet reflected in a field is unchecked. | C3 is satisfied for rendered list items, which is the case everyone tests. | When swaps and rendering can diverge in time |
| D6 | **Extraction gaps a verifier measured:** `thirteen, fourteen, sixteen, seventeen, eighteen, nineteen` are absent from `SPELLED`; `USD 18M`/`EUR` are not currency (`[$£€]` only); `18M` without a symbol never collides with `$18M`. | 300 tests pass and every AC-named form is caught. | Any real-corpus scoring run |

## X2 / regen reachability (`claude/qc-regen-reachability`)

| # | Not done | What makes it look done | Trigger |
|---|---|---|---|
| D7 | **No independent verifier has checked this lane.** Every other lane this session got one, and every one of them found something. | Builds clean, 146/146 app tests, three real defects fixed. | Before merge |
| D8 | **The structural guard is not written.** The AC pass asked for a hardening case asserting *every* server body toggle has a caller or is allowlisted — that is the part that stops a fourth recurrence. Only the two known instances are fixed. | Two instances fixed and a commit message explaining the class. This is the third shipping of this defect; fixing instances is what did not work the first two times. | Before merge |
| D9 | **No live verification.** `regen:true` has not been shown to bypass cache on the deployed Function. | The wiring is obviously correct by inspection. `appPackets.ts:319` also short-circuits on `staleUngrounded`, so a naive test passes identically with the fix absent. | After merge, via `api-test.yml` + `db-query.yml` |

## Cross-lane

| # | Not done | What makes it look done | Trigger |
|---|---|---|---|
| D10 | **H-case IDs collide across three branches.** PARTLY CLOSED: `H26` now asserts one-ID-one-case AND contiguity, and it fired on its first run. P8.2 renumbered to land contiguous at H1..H27. **The other two lanes still collide and must renumber before merging: P8.3 starts at H28, P3 after it.** | Every branch is green in isolation, and `hardening.test.mjs` is append-only by convention, so the merges apply CLEANLY and duplicate silently. | Each remaining merge, in merge order |
| D11 | **P7 items 4, 6, 8** — duplicate 29k prompt, no failure path (`ok:true` on partial), hardcoded template ids / single-tenant sender. | P7 is listed as "partial" with item 1 landed. | P3 lands (they touch `pipeline.ts` / `appPackets.ts`) |
| D12 | **`POST /api/pipeline/run` returns 200 with `pass:false`**, so a failed run shows GREEN in Actions. | The workflow conclusion is `success`. | P7 item 6 |
| D13 | **`Promise.all(docJobs)` orphans Drive files** — no DELETE anywhere on the failure path. | Nothing errors; the files are simply never cleaned up. | P7 close-out |
| D14 | **`covered_kw` does not mean covered.** The prompt asks for "ATS keywords for this role" with no candidate comparison, and the array renders as green "N covered" chips. | It renders as a coverage number, in green. | P8 close-out |
| D15 | **`assetGate.js:53` labels the check "Must-haves this document covers"** — no longer what it measures after C6 moved the numerator to evidence rows. | The label is confident and the number beside it is now correct. | P8.3 lands |
| D16 | **`appReviewer.ts:183` computes `engineJudged` as every must-have row** while the check judges only `coverable`. A real fix needs `artifact_score` to record which rows were judged. | Pre-existing; both numbers look plausible alone. | P8.3 lands |

## Live but unconfirmed

| # | Not done | What makes it look done | Trigger |
|---|---|---|---|
| D17 | **Nothing from this session is deployed.** `origin/main` is at `f4c2f43`; six branches are stacked behind it. Production deploys from `main` only — by design. | Six green PRs. | Draining the merge queue |
| D18 | **P0.3 dark-mode accent pills at 1.90:1** — `.proto-dark` overrides `--surface-brand-subtle` but not `--surface-brand-default`, across 15+ live sites. P8.7 fixed the `var(--temp-${k}-tint)` interpolations, NOT this. | P0 is marked `done`, and P8.7's report mentions fixing a P0.3-class defect — a different one. | P8.7 deploys |

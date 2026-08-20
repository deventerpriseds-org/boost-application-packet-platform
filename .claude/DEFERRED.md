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
| D7 | ~~No independent verifier~~ **DONE.** It found six defects in the guard itself, all fixed: a live false negative (`apply`), a surviving global-name fallback, six missed grammars, a cry-wolf on query-string routes, a staleness floor that could not detect staleness, and the Rebuild affordance having zero test coverage. | — | — |
| D20 | **A bare truthy body read (`if (body?.x)`) is out of H33's scope.** `appFacts.ts:232` reads `body.confirm` that way and is invisible to the guard. | H33 is green and its band is tight, so it reads as complete coverage. | Any future toggle written in the truthy form. Deliberate: including it accused three string-presence checks (`alertText`, `imageB64`, `demoState`) of being unreachable toggles |
| D8 | ~~Structural guard not written~~ **DONE** — H34 (`a38c94f`). Took four wrong versions: vacuous, cried wolf, missed a dispatcher, too permissive again. Found a real fourth instance (`ats_source.enabled`), now wired. | — | — |
| D9 | ~~No live verification~~ **DONE, proven live.** Identical requests differing only by `regen`: `{}` → **0** model calls (cache served); `{"regen":true}` → **3** (`:resume` 9,585 tok, `:portfolio` 11,522, `:ats-qc` 6,562). Precondition checked first (`jd_grounded=t`, `has_pkg=t`) so `staleUngrounded` could not mask it. **The recommended evidence was wrong**: `packet.updated_at` moved on the CONTROL too (00:44:30 → 16:41:35) while the content stayed byte-identical, so it is not a regeneration signal — only `usage_metering` is, because a cache hit cannot make a model call. | — | — |

## Cross-lane

| # | Not done | What makes it look done | Trigger |
|---|---|---|---|
| D10 | **H-case IDs. PRE-ALLOCATION HAS NOW FAILED THREE TIMES** — one-per-lane (too few), then a reserved RANGE for a branch that had not landed, which `H26`'s contiguity rule correctly rejected as a gap and turned PR #14 red. My instruction, not the lane's error. **The rule is now: numbers are claimed AT MERGE TIME, never reserved. Merge `origin/main`, run `H26`, take the next contiguous numbers.** Earlier state: `H26` now asserts one-ID-one-case AND contiguity, and it fired on its first run. P8.2 renumbered to land contiguous at H1..H27. **The other two lanes still collide and must renumber before merging: P8.3 starts at H28, P3 after it.** | Every branch is green in isolation, and `hardening.test.mjs` is append-only by convention, so the merges apply CLEANLY and duplicate silently. | Each remaining merge, in merge order |
| D11 | **P7 items 4, 6, 8** — duplicate 29k prompt, no failure path (`ok:true` on partial), hardcoded template ids / single-tenant sender. | P7 is listed as "partial" with item 1 landed. | P3 lands (they touch `pipeline.ts` / `appPackets.ts`) |
| D12 | **`POST /api/pipeline/run` returns 200 with `pass:false`**, so a failed run shows GREEN in Actions. | The workflow conclusion is `success`. | P7 item 6 |
| D13 | **`Promise.all(docJobs)` orphans Drive files** — no DELETE anywhere on the failure path. | Nothing errors; the files are simply never cleaned up. | P7 close-out |
| D14 | **`covered_kw` does not mean covered.** The prompt asks for "ATS keywords for this role" with no candidate comparison, and the array renders as green "N covered" chips. | It renders as a coverage number, in green. | P8 close-out |
| D15 | ~~Stale label~~ **DONE.** `assetGate.js` now reads "Must-haves your profile can evidence" and the score card "Must-haves evidenced". A label describing the previous definition next to a correct number is the half a reader believes. | — | — |
| D16 | **STILL LIVE — trigger fired, work not done.** Re-checked at `ed19230`: `appReviewer.ts:183` still maps every `kind === 'must_have'` row while the check judges only `coverable`. The code comment now acknowledges it, which is not the same as fixing it. Needs `artifact_score` to record which rows were judged. | The comment beside it reads like a decision rather than a gap. | **Now** — P8.3 has landed |

## Live but unconfirmed

| # | Not done | What makes it look done | Trigger |
|---|---|---|---|
| D17 | ~~Nothing deployed~~ **DONE for four lanes** — P8.7, P8.2, P8.3 and X2-regen are on `main` at `ed19230` and deployed green. **P3 is the only lane still unlanded.** | — | — |
| D18 | ~~Dark accent pills at 1.90:1~~ **CLOSED — and nobody did the work.** Measured on `main` with a browser probe over all four brand pairings enumerated from `theme.css`: accent button **5.94:1**, dark button **5.94:1**, avatar pill **6.52:1**, active tab **5.55:1** in dark; 8.06–9.05:1 in light. **I could not reproduce 1.90 with any of them.** Best explanation: the figure predates P0. The Compass dark block is `:root[data-theme="dark"], .dark` (`fig-tokens.css:512`); P0 made `state.jsx` stamp that attribute, and `:root[data-theme=…]` (0,2,0) outranks `.proto-dark` (0,1,0) whatever the source order — so a palette that had never applied started applying and took this with it. `.proto-dark` still does not override `--surface-brand-default`; it no longer needs to. A guard now measures all four in both themes and is revert-proven (mutating `--brand-300` → 1.47:1 / 1.25:1, light unaffected). | The row was reasoning from a stale measurement and re-deriving the cascade by argument instead of measuring it. | — |
| D19 | **Stored evidence is never re-validated on read.** `requirement_evidence.record_sha256` is written and served but never recomputed; `requirementsGet`'s `stale` flag covers the posting hash only. After the owner edits a MasterContext block the JD payload keeps serving the old quote at the old offsets. | The excerpt renders normally and is a true substring of what the record USED to say. | a design decision about reading the profile on every requirements GET |

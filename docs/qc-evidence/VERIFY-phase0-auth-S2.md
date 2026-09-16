# VERIFY — Phase 0 / S2: body-owner bypass closed

WHAT:       Mutation proofs + suite results for the S2 fix (commit 9d0788e).
WHY:        An inert guard is worse than no guard, because it is believed. CLAUDE.md: mutation-
            proving a NEW guard is the one step never skipped at any tier.
EVIDENCE:   scripts/mutate.sh, three runs, all FIRED. Full suite 1099/1099.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current

## Mutation proofs — `scripts/mutate.sh`, anchors from FILES (never shell args)

| # | Defect reinstated | Target | Named test | Outcome |
|---|---|---|---|---|
| 1 | Delete the `if (claimed && claimed !== owner)` rejection — return `{ owner }` unconditionally | `appSession.ts` | `H:coach-body-owner-cannot-outrank-guard` | **FIRED** |
| 2 | Over-strict: `if (claimed)` — reject ANY body-supplied owner, including the demo one | `appSession.ts` | `H:coach-demo-body-owner-still-works` | **FIRED** |
| 3 | Reintroduce `_ro.verified ? _ro.owner : (body?.owner \|\| DEMO_EMAIL)` into `coachChat` | `coachAgent.ts` | `H:coach-single-identity-source` | **FIRED** |

Each run reported `restored: <file> matches HEAD` — the restore is asserted against HEAD, not
assumed. Mutation 2 matters as much as 1: it proves the guard is not merely strict but CORRECTLY
scoped, catching an over-tightening that would have broken shipped demo-mode exploration.

## Suite

`npm run build` clean (tsc), `npm test` **1099 pass / 0 fail / 0 skipped**. Before the fix the same
suite was 1084/1 — the one failure being the new guard, against the un-keyed test environment,
which is how the auth-ordering defect below was found.

## AC coverage

| AC | Status | How |
|---|---|---|
| AC-S2.1 unverified body-owner ⇒ 401, never the body value | **CONFIRMED** | `H:coach-body-owner-cannot-outrank-guard`, mutation 1 |
| AC-S2.2 demo body-owner unaffected | **CONFIRMED** | `H:coach-demo-body-owner-still-works`, mutation 2 |
| AC-S2.3 verified session outranks body | **CONFIRMED (by construction)** | `resolveOwnerForWrite` returns on `verified` before reading the body at all |
| AC-S2.4 UAT bypass path unaffected | **CONFIRMED (by construction)** | UAT sets `verified:true` in `resolveOwner`, so it returns on the same early branch |
| AC-S2.5 query-string `?owner=` on a mutation still 401s | **CONFIRMED** | `requireWrite` runs first inside the helper, unchanged |
| AC-S2.6 unverified `?owner=` READS still 200 | **CONFIRMED (by construction)** | The four GET routes never referenced `body.owner`; the diff does not touch them |
| AC-S2.7 `api-test.yml` Bearer flow unchanged | **NOT VERIFIED — needs a live dispatch** | Sandbox cannot reach `azurewebsites.net`. Settle with an `api-test.yml` run post-deploy |

## A second defect, found by the test rather than the review

`coachChat` returned **200 early when `OPENAI_API_KEY` was unset, ABOVE the guard** — so an
unauthenticated caller both skipped auth and learned the deployment's config state. Auth now runs
first. This was not in the ACs and was not visible by reading; it surfaced only because the new
H-case ran against an un-keyed environment. Recorded because "the test found what the read missed"
is the argument for writing the test before believing the fix.

## Not done in this commit

- **S1** is BLOCKED by AC-S1.4: the exact header ElevenLabs ConvAI can send is unconfirmed, and the
  AC explicitly forbids implementing against a guessed header name.
- **S3** plumbing not yet landed. Note AC-S3.4: `api-test.yml` signs with `AZURE_CLIENT_SECRET`
  directly, and `secret()` checks `SESSION_SIGNING_SECRET` FIRST — so setting the new secret without
  updating that workflow breaks every `api-test.yml` dispatch.
- **`/api/app/capture`** — a third same-shape bypass found by the AC pass, deliberately not touched.
  See the owner decision recorded in `.claude/actions.md`.

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
| AC-S2.7 `api-test.yml` Bearer flow unchanged | **CONFIRMED IN PRODUCTION** | Run `35110469476`: `HTTP 200`, `"reply": "ok"`, `usedMemory: true` — see RESULTS below |

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

---

## RESULTS — verified against PRODUCTION, 2026-09-16

Added in the same pass that ran them. PR #83 merged to `main` as `28f15a2`; `api-deploy.yml` run
**35110043855 → success** put this code on `job-platform-api`. Both checks are live dispatches
against `https://job-platform-api.azurewebsites.net`, not sandbox reasoning.

### The exploit, re-run against production — run `35110396095`

Exactly the bypass shape: **no `Authorization` header**, no `?owner=` in the path, and the real
owner asserted in the JSON body.

```
omit_auth=true -> sending NO Authorization header (testing the reject path)
HTTP 401 POST https://job-platform-api.azurewebsites.net/api/app/coach/chat
{
  "error": "sign in required to modify this workspace",
  "owner": "demo@executive-engine.local"
}
```

**Both halves of AC-S2.1 hold live:** the status is 401, AND the resolved owner is the demo
address — never the body-supplied `von.ellis@enterpriseds.io`. Before `9d0788e` this exact request
returned 200 and ran the full 48-tool coach as the real account.

The GitHub job reports `failure` because `api-test.yml` exits non-zero on any non-2xx. **That is the
PASS condition for this test** — worth stating, because a future reader scanning run conclusions
would otherwise read the red as a problem.

### The legitimate path still works — run `35110469476`

```
Minted session token for owner=von.ellis@enterpriseds.io
HTTP 200 POST https://job-platform-api.azurewebsites.net/api/app/coach/chat
{ "reply": "ok", "toolCalls": [], "uiActions": [], "usedMemory": true }
```

AC-S2.7 **CONFIRMED**. `usedMemory: true` is the part worth noting: the turn resolved the real
owner and reached that owner's `coach_memory`, so the fix did not silently downgrade an
authenticated caller to demo — which is the regression a too-strict guard would have caused, and
which mutation 2 was written to catch.

### S3 is deployed but INERT, as designed — same two logs

Both runs show `SESSION_SIGNING_SECRET:` **empty** in the workflow env. The repo secret still does
not exist, so `secret()` continues to fall through to `MICROSOFT_CLIENT_SECRET` exactly as before.

**This is the no-flag-day design proving itself in production rather than in argument:** the
workflow minted a token that the deployed Function accepted (HTTP 200 above) *while the new secret
is absent*. Had `api-test.yml` been switched to the new name instead of mirroring the precedence
chain, that 200 would have been a 401 and every dispatch would be broken right now. Setting the
secret is the owner's remaining step and needs no code change.

### Still not verified

- `/api/app/capture` — untouched by design (`ACT:capture-anonymous-write`), so still anonymous.
- The three sibling routes (`coachMemoryAdd`, `coachThreadClear`) were not individually dispatched;
  they share `resolveOwnerForWrite` with `coachChat` and are covered structurally by
  `H:coach-single-identity-source`, but that is a code-level argument, not a live one.

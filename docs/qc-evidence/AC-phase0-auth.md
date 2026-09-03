# AC — Phase 0: close auth bypasses on the coach routes

<!--
WHAT:       Acceptance criteria for S1/S2/S3 (COLE_BRIDGE_SPEC_v2.md §7) — guard voice/chat, close
            the body-owner bypass, and give session tokens a dedicated signing secret.
WHY:        Both bypasses let an unauthenticated/underauthenticated caller act as any owner,
            including sending real Graph email. Tier 1 (accusation/authorization-grade) by this
            repo's tiering.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   docs/spec-research/A-coach-engine.md, docs/COLE_BRIDGE_SPEC_v2.md §7-10,
            .claude/actions.md ACT:coach-auth-bypass. Every citation below re-verified against
            source at commit fa393b6 (branch claude/eds-setup-postgres-connectors-nqujcn), not
            copied from the brief.
-->

**Method:** every file:line citation in this document was re-read from source in this session,
not taken on the brief's word. Two claims in the brief were extended after verification (see
"Brief corrections" at the bottom) and one new same-shape defect was found that the brief does
not mention.

---

## 1. Feasibility table (read this before the ACs — CLAUDE.md strict rule)

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| Body-owner bypass exists on `coachChat` | `coachAgent.ts:198` `_ro.verified ? _ro.owner : (body?.owner \|\| DEMO_EMAIL).toString()`, guarded only by `requireWrite(req)` at `:196` which runs **before** `body` is parsed | any anonymous caller | Read `appSession.ts:63,74-75` + `coachAgent.ts:196-198`: `resolveOwner` returns `{owner:req.query.get('owner')\|\|DEMO_EMAIL, verified:false}` when no Bearer/UAT; `requireWrite` passes when `owner===DEMO_EMAIL`; handler then uses `body.owner` instead of the demo value `requireWrite` actually checked | **EXISTS — confirmed by reading source** |
| Same defect at `coachAgent.ts:334` (`coachMemoryAdd`) and `:380` (`coachThreadClear`) | same pattern, same guard-then-parse-body ordering | writes a memory row / deletes a thread for an attacker-chosen owner | Read `coachAgent.ts:330-334` and `:378-380` — identical `_ro.verified ? _ro.owner : (body?.owner \|\| DEMO_EMAIL).toString()` after `requireWrite(req)` | **EXISTS — 3 occurrences, not 1** (brief's own text names all three; confirmed) |
| **NEW, not in the brief** — same-shape bypass in `appCapture.ts:22` (`POST /api/app/capture`) | `const owner = ro.verified ? ro.owner : (body?.owner \|\| ro.owner)` — and this route has **no `requireWrite` call at all** | inserts an `opportunity` row for the given owner via `routeOpportunity` | Read `appCapture.ts:13-22,56`: `app.http('appCapture', {authLevel:'anonymous', ...})`, zero `requireWrite` in the file | **EXISTS — out of this brief's named scope (title says "the coach routes"); see §4** |
| `voiceChat` has no guard at all | `appVoice.ts:120` `authLevel:'anonymous'`, zero `requireWrite`/`resolveOwner` in the file | drives the full 48-tool coach agent as `VOICE_OWNER` | Read `appVoice.ts:93-118,120`: no identity read of any kind | **EXISTS — confirmed** |
| `VOICE_OWNER` today points at an empty account, so bypass 2 is currently low-impact | `appVoice.ts:87` `process.env.VOICE_DEFAULT_OWNER \|\| 'voice@executive-engine.local'` | — | `coach_memory` row count for that owner not queried this session (DB connector not reachable — see §4.1); accepted as PLAUSIBLE from the account-naming convention, not proven | **PLAUSIBLE, not proven — do not rely on this for severity** |
| `SESSION_SIGNING_SECRET` is a supported env var today, just unset in the deploy pipeline | `appSession.ts:17` `secret()` already checks it first in the fallback chain | `signSession`/`verifySession`, and `appHealth.ts:27` already reports `checks.session.ok` from it | `grep SESSION_SIGNING_SECRET .github/workflows/api-deploy.yml` → **0 matches** (only the two `--settings` lines match) | **EXISTS-BUT-CONSTRAINED — code path ready, deploy wiring absent** |
| Adding the GitHub secret value itself | owner / repo secret store | `api-deploy.yml`'s `--settings` sync step | `gh secret list --repo deventerpriseds-org/boost-application-packet-platform` → `403: Access to this GitHub Actions path is not permitted through this proxy` | **CANNOT VERIFY FROM HERE — setting the secret's VALUE needs the owner or a session with GH secrets-write access; this AC pass can wire the settings-list plumbing but not create the secret** |
| ElevenLabs ConvAI can send a caller-chosen header on its custom-LLM requests | ElevenLabs' `custom_llm` config schema | `voiceChat` would need to check it | `docs/COLE_BRIDGE_SPEC_v2.md` §8 item 4 and §10 already list this as a **genuinely open question**, not answered by prior research; this session's `WebFetch`/`WebSearch` calls were declined (no tool permission granted) so it remains unconfirmed here too | **ABSENT / UNCONFIRMED — S1 cannot specify the exact header name until this is checked (see AC S1.4)** |
| `requireWrite`/`resolveOwner` have consumers beyond the two named routes | `appSession.ts` exports | 39 files under `api/src/functions/tests/` import at least one of them | `grep -rln "requireWrite\|resolveOwner" api/src/functions/tests/*.ts \| wc -l` → 40 files (list captured, not reproduced here for length) | **EXISTS — S2's fix must not change behavior for any of them; see AC S2.4-S2.6** |
| GET routes that read `resolveOwner(req).owner` directly (no `body.owner`, no guard) must keep working unauthenticated | `coachMemoryList` (:220), `coachStatus` (:289), `coachActivity` (:355), `coachThreadGet` (:366) | unauthenticated demo-mode exploration + `?owner=` reads per CLAUDE.md "Owner model" | Read each function body — none references `body?.owner`; all take `resolveOwner(req).owner` directly, so S2's fix (which only touches the `body?.owner` fallback shape) cannot affect them | **EXISTS — confirmed unaffected by S2, must have a regression AC anyway (S2.7)** |
| `api/test/hardening.test.mjs` already imports `resolveOwner`/`signSession` and has a template pattern for this exact class of guard | `H:master-profile-editor-requires-write-guard` (line ~6033) and `H:master-profile-editor-owner-from-session` (line ~6058) | new `H:coach-*` cases should follow the same shape | `grep -n "test('H:master-profile-editor-requires-write-guard\|owner-from-session" api/test/hardening.test.mjs` → both present | **EXISTS — reuse this pattern, don't invent a new one** |
| `scripts/mutate.sh` and `scripts/verify.sh` are present and executable | `/workspace/eds-claude-skills/scripts/` | mutation-proving new guards (CLAUDE.md "the one step never skipped") | `ls -la /workspace/eds-claude-skills/scripts/{mutate,verify}.sh` → both present, `-rwxr-xr-x` | **EXISTS** |
| The owner has authorized Phase 0 | `.claude/actions.md` `ACT:coach-auth-bypass` | this AC pass | `grep -n "AUTHORISED by the owner 2026-09-03" .claude/actions.md` → `"kickoff 0 as you mentioned"` | **EXISTS** |
| Landing this on `main` is a SEPARATE confirmation from writing/implementing it | CLAUDE.md git workflow + STOP rules | deploy | `.claude/actions.md`: *"Still a separate confirmation: landing Phase 0 on `main` DEPLOYS live auth changes… Authorising the work is not authorising the deploy"* | **EXISTS — implementation must land on a feature branch; do not fast-forward `main` as part of this AC's own completion** |

---

## 2. Acceptance criteria

Each AC is `Given <request shape>, when <route>, then <observable outcome>`. Each maps to S1/S2/S3.

### S2 — close the body-owner bypass (do this one first; it is the more severe defect: it already works against production, no config change required to exploit)

- **AC-S2.1.** `resolveOwner` and `requireWrite` become the SINGLE source of identity for
  `coachChat`, `coachMemoryAdd`, and `coachThreadClear` — the handler must not read `body.owner` at
  all when the request is unverified. Given no `Authorization` Bearer, no valid `X-UAT-Token`, no
  `?owner=`, and `{"owner":"von.ellis@enterpriseds.io", ...}` in the JSON body, when
  `POST /api/app/coach/chat` (or `/coach/memory/add` or `/coach/thread/clear`) is called, then the
  response is `401` with `verified:false` semantics — the owner in the response body is
  `demo@executive-engine.local`, never the body-supplied value.
- **AC-S2.2.** Given the same shape but the body's `owner` IS `demo@executive-engine.local` (or
  omitted), when any of the three routes is called, then it proceeds exactly as today — demo-mode
  exploration is unaffected. (Regression: unauthenticated demo use must not start 401ing.)
- **AC-S2.3.** Given a valid `Authorization: Bearer <session-token>` for `real-user@x.com`, when any
  of the three routes is called with `{"owner":"someone-else@x.com"}` in the body, then the body
  value is IGNORED and the action runs as `real-user@x.com` (verified session always wins over
  body). This already works today for the verified branch — the AC pins it as a regression guard.
- **AC-S2.4.** Given `X-UAT-Token: <UAT_BYPASS_TOKEN>` and `?owner=any@x.com`, when any owner-scoped
  coach route is called, then it proceeds as `any@x.com` with `verified:true` — the UAT bypass path
  (`api-test.yml`, the Playwright verifier) is unaffected by this fix.
- **AC-S2.5.** Given no Bearer, no UAT header, and `?owner=real-user@x.com` in the QUERY STRING (not
  body), when a MUTATING coach route is called, then the response is `401` — unchanged from today
  (`requireWrite` already blocks this; this AC is a regression guard, not a new behavior).
- **AC-S2.6.** Given no Bearer, no UAT header, and `?owner=real-user@x.com` in the query string, when
  a READ-ONLY coach route is called (`GET /coach/memory/list`, `GET /coach/status`,
  `GET /coach/activity`, `GET /coach/thread`), then it returns data scoped to `real-user@x.com` with
  HTTP 200 — unverified reads via `?owner=` continue to work per CLAUDE.md's documented owner model.
  This is a regression guard proving S2's fix (which only touches the `body.owner` fallback) does
  not tighten these four GET routes, which never touched `body.owner` in the first place.
- **AC-S2.7.** `.github/workflows/api-test.yml`'s session-minting flow (Bearer-token path) is
  unmodified in behavior — a live `api-test.yml` dispatch against `/api/app/coach/chat` with a
  minted Bearer for `von.ellis@enterpriseds.io` still returns `200` after the fix.

### S1 — guard `/api/app/voice/chat`

- **AC-S1.1.** Given no shared-secret header/value, when `POST /api/app/voice/chat` is called, then
  the response is `401` and `runCoachTurn` is never invoked (no OpenAI call, no tool execution —
  verify via absence of any `coach_activity` row for the attempted call).
- **AC-S1.2.** Given the correct shared-secret header/value, when `POST /api/app/voice/chat` is
  called, then it behaves exactly as today (runs `runCoachTurn` against `VOICE_OWNER`, returns the
  Chat-Completions-shaped response ElevenLabs expects).
- **AC-S1.3.** The shared secret is a NEW env var (e.g. `VOICE_SHARED_SECRET` — exact name decided
  at implementation, not this AC pass), added to `api-deploy.yml`'s `--settings` list with an exact
  name match, and NOT hardcoded. `/api/health` gains a boolean `checks.voiceGuard.ok` (mirroring the
  existing `checks.session` pattern) so its presence is externally verifiable without exposing the
  value.
- **AC-S1.4. BLOCKING PRE-CONDITION, not yet satisfiable by this AC pass.** Before S1 is
  implemented, the exact header ConvAI's `custom_llm` config can send on outbound requests to a
  custom LLM URL must be confirmed against ElevenLabs' own docs or a captured live request —
  §1 marks this ABSENT/UNCONFIRMED. If ConvAI's `custom_llm` schema turns out to support only a
  fixed `Authorization: Bearer <token>` (no arbitrary header name), AC-S1.1–S1.3 must be rewritten
  against that shape rather than an invented header name. **Do not implement S1 by guessing a header
  name and hoping ConvAI can send it — verify first, exactly as the brief instructed.**
- **AC-S1.5.** `/api/app/voice/turn` (the STT/LLM/TTS pipeline used by the 1:1 in-app voice call, NOT
  ConvAI) is explicitly OUT OF SCOPE for S1 — it never calls `executeCoachTool`, never reads owner
  data, and has no `runCoachTurn` call, so it carries no owner-impersonation risk. State this
  explicitly so nobody "fixes" it by accident and breaks the in-app voice feature, which has no
  shared-secret transport available to it (it's called directly by the browser).
- **AC-S1.6.** `convaiAgentPoint` (`diag/convai-agent-point`) remains anonymous, unguarded, and
  OUT OF SCOPE for Phase 0 — it patches ElevenLabs' own agent config using `ELEVENLABS_API_KEY`
  server-side and touches no owner data. Flagged in §4 for owner awareness, not fixed here.

### S3 — dedicated `SESSION_SIGNING_SECRET`

- **AC-S3.1.** `.github/workflows/api-deploy.yml`'s `--settings` list gains
  `"SESSION_SIGNING_SECRET=${{ secrets.SESSION_SIGNING_SECRET }}"` with that EXACT name (CLAUDE.md:
  a mismatch silently blanks the setting). This AC pass and implementation can land this code
  change; it CANNOT create the GitHub secret itself (§1 — proxy blocks secrets API from this
  session). The owner must add the `SESSION_SIGNING_SECRET` repo secret before/at deploy time, or
  the setting syncs empty and `secret()` silently falls through to `MICROSOFT_CLIENT_SECRET` exactly
  as today — not a regression, but not the fix either. State this to the owner explicitly at
  hand-off.
- **AC-S3.2.** Given `SESSION_SIGNING_SECRET` is set on the Function App, when `GET /api/health` is
  called, then `checks.session.ok === true` (already implemented at `appHealth.ts:27` — this AC is
  a live-verification step, not new code).
- **AC-S3.3. Rotation is accepted, not mitigated, in Phase 0.** Given a session token minted before
  `SESSION_SIGNING_SECRET` is set (signed under the old `MICROSOFT_CLIENT_SECRET`/`AZURE_CLIENT_SECRET`
  fallback), when that token is presented after the rollout, then `verifySession` returns `null` and
  the caller falls back to unverified/demo behavior (401 on mutations to non-demo owners, same as
  today's "expired token" path) — this is EXPECTED and ACCEPTABLE: no dual-key grace period is being
  built in Phase 0. Users simply re-authenticate. Record this as an explicit owner-accepted
  trade-off, not a silent gap.
- **AC-S3.4.** `api-test.yml`'s Bearer-minting flow, which signs with `AZURE_CLIENT_SECRET` directly
  (not `SESSION_SIGNING_SECRET`), MUST be updated in the same change — otherwise every `api-test.yml`
  dispatch starts minting tokens that fail to verify against the new `secret()` precedence the moment
  `SESSION_SIGNING_SECRET` is set (since `secret()` checks `SESSION_SIGNING_SECRET` FIRST). Given
  `SESSION_SIGNING_SECRET` is set, when `api-test.yml` mints and uses a token, then it must sign with
  the SAME secret `appSession.ts:17` will resolve — either by also passing
  `${{ secrets.SESSION_SIGNING_SECRET }}` into the Python signer, or the workflow's secret must not
  diverge from the Function App's resolved value. This is not in the original brief and would be a
  self-inflicted regression if missed.

### Regression guards (all three, required)

- **AC-H.1.** Add `H:coach-body-owner-ignored-when-unverified` to `api/test/hardening.test.mjs`,
  modeled on the existing `H:master-profile-editor-requires-write-guard` /
  `H:master-profile-editor-owner-from-session` pair (imports `resolveOwner`, `signSession` from
  `appSession.js` already present at the top of the file) — asserts the unverified+body-owner shape
  from AC-S2.1 is rejected/ignored, covering all three fixed call sites in one parametrized test or
  three explicit cases (implementer's choice, but all three sites must be exercised — not just
  `coachChat`).
- **AC-H.2.** Add `H:voice-chat-requires-shared-secret` asserting `voiceChat` 401s with no/wrong
  secret and proceeds with the correct one (once AC-S1.4 is resolved and the real header/mechanism
  is known).
- **AC-H.3.** Add `H:session-secret-precedence` asserting `secret()`'s resolution order
  (`SESSION_SIGNING_SECRET` → `MICROSOFT_CLIENT_SECRET` → `AZURE_CLIENT_SECRET` → dev fallback) is
  unchanged by this work, since AC-S3.4 depends on it.
- **AC-H.4.** Every new/changed guard is mutation-proved with
  `/workspace/eds-claude-skills/scripts/mutate.sh` before being called done — FIRED, not INERT or
  NOT-APPLIED, reported per guard.

---

## 3. What must NOT change (regression surface)

- Unauthenticated **demo-mode** exploration of the coach (`owner===DEMO_EMAIL`, no session) — AC-S2.2.
- **`?owner=` unverified reads** on the four GET routes named in §1 — AC-S2.6. CLAUDE.md's "Owner
  model" section explicitly documents this as by-design.
- **`api-test.yml`'s Bearer-mint-and-call flow** — AC-S2.7, and AC-S3.4 for the secret-precedence
  interaction if S3 ships in the same PR.
- **The UAT bypass** (`X-UAT-Token` + `UAT_BYPASS_TOKEN`) used by the Playwright verifier — AC-S2.4.
- **`/api/app/voice/turn`** (the in-app 1:1 voice call) — explicitly untouched, AC-S1.5.
- **`convaiAgentPoint`** — explicitly untouched in Phase 0, AC-S1.6, flagged separately in §4.

---

## 4. Flags — places this brief was incomplete or where I found something it didn't ask about

1. **The brief's two named defects are correct as described**, including the specific
   `coachAgent.ts:334` / `:380` line numbers — both independently re-verified against source, not
   copied.
2. **`appCapture.ts:22` (`POST /api/app/capture`) has the identical body-owner-fallback shape, and
   is actually WORSE — it has no `requireWrite` guard at all, anonymous by design.** It's outside
   this brief's stated scope ("the coach routes"), but CLAUDE.md's "Fix all consumers" rule and this
   brief's own constraint #2 ("`resolveOwner`/`requireWrite` have callers beyond these two routes...
   grep every one and require consistency") both point at it. Recommend: either (a) add as **S4** to
   Phase 0 with explicit owner sign-off before implementation, since it's the same class of fix and
   marginal cost is low, or (b) log it as a new `ACT:` item in `.claude/actions.md` for a follow-up
   phase if the owner wants Phase 0 kept narrowly to the coach routes. **Not implementing either
   without the owner choosing — this is a scope decision, not mine to make silently.**
3. **`GET /api/app/coach/memory/list` has no guard at all** and **`deleteMemory` (`coachMemory.ts`)
   is not owner-scoped** — both already documented in `docs/spec-research/A-coach-engine.md` §"Minor
   — deleteMemory is not owner-scoped". Neither is in S1/S2/S3's scope (one's a read, the other
   needs a UUID an attacker doesn't have) and neither is touched by this AC pass. Flagged for the
   record, not actioned.
4. **AC-S1.4 is a real blocker, not a formality.** The brief itself said "do not assume [a header]
   exists." I attempted to resolve it via `WebFetch`/`WebSearch` and both were declined for lack of
   tool permission in this session — so it remains exactly as open as `COLE_BRIDGE_SPEC_v2.md` §8/§10
   already documented it. **Implementation of S1 cannot proceed past AC-S1.3 until this is checked**
   — either grant web-tool permission in a future turn, or the owner/implementer confirms it against
   ElevenLabs' dashboard/docs directly.
5. **AC-S3.4 (api-test.yml secret alignment) is not in the original brief.** Found by tracing
   `secret()`'s consumers beyond `appSession.ts` itself, per constraint #2. Omitting it would make
   S3 look done while silently breaking every `api-test.yml`-driven verification the moment the new
   secret is set.

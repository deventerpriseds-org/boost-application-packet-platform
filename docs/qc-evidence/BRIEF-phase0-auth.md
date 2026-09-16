# AC BRIEF — Phase 0: close two auth bypasses on the coach routes

Write acceptance criteria BEFORE any code is written. Tier 1 (accusation grade): this code decides
whether a request is authorised. Be adversarial. Read the source; do not trust this brief's
summaries — verify each one and say so if a claim here is wrong.

Repo: /home/user/boost-application-packet-platform, branch claude/eds-setup-postgres-connectors-nqujcn
Owner has explicitly authorised this work ("kickoff 0"). Scope is Phase 0 ONLY.

## The two defects (verify each against source before writing ACs)

**Bypass 1 — body-`owner` on `/api/app/coach/chat`.**
`resolveOwner` (api/src/functions/tests/appSession.ts:63) ends with
`return { owner: req.query.get('owner') || DEMO_EMAIL, verified: false }` — it reads the QUERY
STRING only. `requireWrite` (same file) allows when `verified || owner === DEMO_EMAIL`. The handler
`coachChat` (coachAgent.ts:198) then does
`const owner = _ro.verified ? _ro.owner : (body?.owner || DEMO_EMAIL).toString()`.
So: no Bearer + no `?owner=` + `owner` in the JSON body ⇒ guard passes on the demo branch, then the
coach runs as the body-supplied account. Same shape reported at coachAgent.ts:334 and :380 — CHECK
BOTH and report whether they are the same defect or different.

**Bypass 2 — `/api/app/voice/chat` has no guard at all.**
Registered `authLevel:'anonymous'` (appVoice.ts:120). The file contains zero `requireWrite` /
`resolveOwner` calls. All 48 coach tools reachable unauthenticated, including `send_outreach`
(real Microsoft Graph email).

**Why ORDER is the whole point.** Bypass 2 is harmless today ONLY because `VOICE_OWNER`
(appVoice.ts:87, `process.env.VOICE_DEFAULT_OWNER || 'voice@executive-engine.local'`) points at an
account with no data. A later item (B6) repoints voice at the real user. If B6 lands before the
guard, a harmless misconfiguration becomes anonymous internet access to the owner's real account.
An AC MUST pin this ordering so it cannot be silently violated.

## The three changes

- **S1 — guard `/api/app/voice/chat`.** Caller is ElevenLabs ConvAI (appVoice.ts:132), which has no
  place to put a user identity — that is WHY a constant was used. So the guard must be a shared
  secret presented by ConvAI, not a user session. Open question the ACs must expose: WHICH header
  ConvAI can actually send. Do not assume one exists; state what must be confirmed.
- **S2 — close the body-`owner` bypass.** Guard and handler must derive identity from ONE function
  so they cannot disagree again. Consider whether unverified READS via `?owner=` must keep working
  (CLAUDE.md "Owner model": unverified reads are allowed by design, mutations are not) — an AC that
  breaks legitimate read behaviour is a regression, so be precise about what must still work.
- **S3 — dedicated `SESSION_SIGNING_SECRET`.** Today the session-token signing key defaults to the
  Graph app secret, so anyone who can mint a token can impersonate any user. Note: a new app setting
  must be added to the `--settings` list in .github/workflows/api-deploy.yml with an EXACT name
  match — a mismatch silently blanks the setting (CLAUDE.md). Also consider the rotation/rollout
  problem: changing a signing key invalidates existing tokens. An AC should say what happens to
  sessions minted under the old key.

## Constraints the ACs must respect

1. **No hardcoded config** (CLAUDE.md strict rule): a behaviour-affecting value needs a settings
   path or explicit owner approval to stay code-only.
2. **Fix all consumers** (CLAUDE.md strict rule): `resolveOwner` / `requireWrite` have callers beyond
   these two routes. Grep every one and require consistency; a fix applied to one route while a
   sibling keeps the old shape is the exact failure that rule exists to prevent.
3. **Do not break** `api-test.yml` (mints a real session Bearer), the UAT bypass path
   (`x-uat-token` + `UAT_BYPASS_TOKEN`, appSession.ts), or unauthenticated demo-mode exploration.
   Each needs an explicit AC saying it still works.
4. Every AC must be BINARY and observable. "Auth is secure" is not an AC. Prefer the form
   `Given <request shape>, when <route> is called, then <status code / observable outcome>`.
5. Include a REGRESSION-GUARD AC: each bypass must get a hardening test (api/test/hardening.test.mjs,
   SLUG ids like `H:coach-body-owner`, never a new number — H26 fails the suite on numeric ids), and
   each new guard must be mutation-proved with scripts/mutate.sh (FIRED / INERT / NOT-APPLIED).

## Deliverable

Write to docs/qc-evidence/AC-phase0-auth.md:
1. A FEASIBILITY TABLE FIRST (CLAUDE.md strict rule), one row per dependency the work names:
   Dependency | Producer | Consumer today | Proof (command + result) | Verdict
   (EXISTS / ABSENT / EXISTS-BUT-CONSTRAINED). The ConvAI header question belongs here.
2. Then the numbered ACs, each binary, each mapped to S1 / S2 / S3.
3. Then explicitly: what must NOT change (the regression surface).
4. Flag any place this brief is WRONG about the code.

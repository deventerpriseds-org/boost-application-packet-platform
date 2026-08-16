# Session Handoff — Executive Engine (boost-application-packet-platform)

Orientation for a new session. `CLAUDE.md` (auto-loaded) is the authority; `.claude/memory.md` and
`.claude/actions.md` carry the detail. **This file is the fast map + operating procedure.**
Read all four, and run `git log --oneline -10` + `git fetch origin`, before touching code.

Everything below was re-verified against the files on disk (2026-08-16). Where it contradicts an
older note, the file on disk wins.

---

## 1. What the app is

**Executive Engine** — a single-tenant, owner-scoped job-application platform. It automates LinkedIn
alert intake, opportunity enrichment/scoring, packet building (resume + cover letter + video),
outreach, interview prep and offer analysis.

| Thing | Value |
|---|---|
| Product SPA (this is "the app") | `app/` → SWA `executive-engine-web` → **https://purple-ground-0f377120f.7.azurestaticapps.net/** |
| API | `api/` → Function App **`job-platform-api`** (`job-platform-api.azurewebsites.net`), all app routes under `/api/app/...` |
| Database | Azure PostgreSQL **`boost_resume_n_packet_builder`** on `eds-postgresql.postgres.database.azure.com` (user `Admin_eds`) |
| Production owner | **`von.ellis@enterpriseds.io`** — the real data. `demo@executive-engine.local` is a shared sandbox tenant |
| Legacy dev console (NOT the product) | `web/` → SWA `job-platform-web` (`happy-river-0935bfe0f.7.azurestaticapps.net`) |
| Azure | RG `EnterpriseDS_ResourceGRP`, sub `09594120-1b35-4e21-84c6-451ac27175a3`, tenant `ee633423-c321-413c-a191-ace8b07e4196`, eastus, Node 22, Consumption plan (Y1) |

---

## 2. Repo map — the files we actually edit

### Frontend — `app/` (React 18 + Vite 5, **plain JSX, no TypeScript**, no Tailwind)
- `app/src/App.jsx` — the router: a chain of `if (route === …)` over `useRoute().parts` + `TITLES` map + `LoginGate`. New screen = edit here **and** `shell.jsx` `NAV`.
- `app/src/state.jsx` — `AppProvider` context (auth, owner, dark, toast), hash router `useRoute()`/`go()`, `useIsMobile`.
- `app/src/data.jsx` — **`useOpportunities()` — THE shared data funnel.** Polls 15s, applies location/remote prefs, optimistic move/dismiss. Shared filters/counts belong HERE, once (see §7).
- `app/src/api.js` — the client: one `api` object (~90 methods) through a single `authedFetch` with 401 silent-refresh + retry. **Every owner-scoped call must pass `?owner=${_owner}`** or it silently falls back to demo.
- `app/src/auth.js` — MSAL (Microsoft) + Google auth-code sign-in, session-token minting.
- `app/src/shell.jsx` — `NAV` array, `DesktopShell`, shared primitives (`Pill`, `SignalIcon`, `PRIORITY_COLOR`).
- `app/src/theme.css` + `app/src/tokens/` — the design system (§ below).
- `app/src/screens/` — 17 screens, one per route. Biggest/hottest: `Settings.jsx` (1475 L), `OppDetail.jsx` (812 L), `Opportunities.jsx`, `Today.jsx`, `Swipe.jsx`, `Pipeline.jsx`, `RolesTitles.jsx`.
- Hot files, last 60 commits: `api.js` (8) › `Opportunities.jsx` (7) › `shell.jsx` / `Today.jsx` / `Settings.jsx` / `OppDetail.jsx` (5 each).

**Design system:** two-layer tokens. `tokens/fig-tokens.css` = 609 CSS vars generated from Figma
Variables; `theme.css` remaps them to a `--proto-*` palette and defines the **`.px-*` utility
vocabulary** — `.px-box`, `.px-panel`, `.px-btn`(+`-accent/-dark/-green/-red/-yellow/-ghost`),
`.px-input`, `.px-pill`, `.px-chip`, `.px-tab`, `.px-h1/h2/h3`, `.px-label`, `.px-meta`, `.px-link`.
Screens compose `className="px-btn px-btn-accent"` + an inline `style={{}}` for layout.
Dark mode is **class-driven**: `state.jsx` toggles `.proto-dark` on `<html>` (not `[data-theme]`).
Rule (`docs/APP_ARCHITECTURE.md`): components read tokens, never hardcoded colors/spacing.

### Backend — `api/` (Azure Functions **v4**, TypeScript, `pg`)
- **`api/src/functions/tests/` is the PRODUCTION API, not tests** — ~101 modules live here. Any tooling that excludes `**/tests/**` excludes almost the whole backend.
- **No single route entry point.** Each module self-registers with top-level `app.http(...)` (193 registrations); Functions v4 discovers them via `package.json` `"main": "dist/**/*.js"`.
- `tests/pgClient.ts` — `getPgClient()` returns a connected `pg.Client` (caller must `.end()`); reads `DATABASE_URL` else `AZURE_PG_*`.
- `tests/appSession.ts` — `resolveOwner` / `requireWrite` / `signSession` / `verifySession`, HMAC-SHA256 token, 12h TTL. **`resolveOwner`:** verified Bearer → that email; else `?owner=` (unverified READS ok); else demo.
- `tests/schema.ts` — the canonical schema as `SCHEMA_SQL` (all `create … if not exists`) + `EXPECTED_TABLES`. **There is no `migrations/` directory** — apply via route `diag/pg-migrate` (`tests/pgMigrate.ts`).
- Feature modules: `appPackets.ts` (packets/artifacts, resume generate/doc/ai-edit), `mailWatch.ts` (107 KB — intake, ~35 `mail/*` routes), `jdSearch.ts`/`jdSweep.ts` (scheduled search), `roleTaxonomy.ts`, `pipeline.ts` + `mt17.ts` + `resumeParser.ts` (3-agent package), `packetTemplates.ts`, `coachAgent.ts`/`coachTools.ts`, `usageMeter.ts` (cost metering → `usage_metering`), `diag*.ts` (read-only diagnostics).
- Route namespaces: `app/…` (product), `mail/…`, `diag/…`, `test/mt-01…mt-47`, plus root `health`, `config`, `config-status`, `auth/session`.
- Second/third datastores: Azure Table Storage (`AppConfig` partitions `auth`/`apps`, `Prompts`) and Blob Storage.

### Support
- `.github/workflows/` — deploy + the three live-verify loops (§4, §5).
- `scripts/ui-verify.mjs` — the only script referenced by any workflow.
- `.claude/` — `memory.md` (durable log, 1066 L), `actions.md` (ACT tracker, 820 L), this file.

### Build / test / lint — what actually EXISTS
| | app/ | api/ |
|---|---|---|
| build | `npm run build` (`vite build`) | `npm run build` (`tsc`) |
| dev | `npm run dev` (`vite`) | `npm run dev` (`build && func start`) |
| other | `preview` | `watch`, `start` |
| **lint** | **does not exist** | **does not exist** |
| **test** | **does not exist** | **does not exist** |

There is **no test framework, no lint config, and no `tsconfig.json` under `app/`** anywhere in this
repo. `api-test.yml` is a live-API caller, not `npm test`. So "run the tests" is not available —
verification is the GitHub-Actions loop in §4. Build both (`cd api && npm ci && npm run build`,
`cd app && npm ci && npm run build`) before any commit that touches them.

---

## 3. The sandbox CANNOT reach Azure or Postgres

Egress blocks `*.azurewebsites.net`, `*.azurestaticapps.net`, and the DB. `curl`/WebFetch against prod
will fail or (worse) can't execute the React bundle. **Everything live goes through GitHub Actions.**

Common loop for all three: trigger → poll → read logs.
```
mcp__github__actions_run_trigger(method="run_workflow", owner="deventerpriseds-org",
  repo="boost-application-packet-platform", workflow_id="<file>.yml", ref="main", inputs={…})
# then: mcp__github__actions_list → run id → mcp__github__get_job_logs(return_content=true)
```
`ref` must be **`main`** — a workflow_dispatch only resolves on the default branch.
`actions_list` output is large; it spills to a file — pull run ids with `jq`.

---

## 4. The three live-verify loops (exact inputs + how to read the result)

**`db-query.yml` — read the live DB.**
Input: `sql` (default `SELECT stage, COUNT(*) AS count FROM opportunity GROUP BY stage ORDER BY count DESC;`).
Output is **raw `psql` ASCII table in the step log — there is no marker string**.
Caveat: the input is interpolated straight into `psql -c "…"`, so a `"` or `$` in your SQL breaks the
command. Keep SQL single-line and quote-free where possible.

**`api-test.yml` — call any live API path, authenticated.**
Inputs: `method` (default `GET`), `path` (**required**, no default), `body` (default `''`),
`omit_auth` (default `'false'`). It mints an HS256 session token locally from `AZURE_CLIENT_SECRET`;
owner is parsed from `?owner=` in `path`, defaulting to `von.ellis@enterpriseds.io`.
Read these log lines: `Minted session token for owner=…`, then `HTTP {status} {method} {url}`, then the
pretty-printed JSON body. **The step exits 1 on any status ≥ 400, so job conclusion is itself a signal.**

**`ui-verify.yml` — prove what the LIVE SPA actually renders** (Playwright/Chromium on a runner).
Inputs: `route` (default `#/settings/roles`), `owner` (default `von.ellis@enterpriseds.io`),
`expect` (`;`-separated substrings, **ALL** must appear), `count_sel` (`''`), `count_min` (`'0'`),
`app_url` (default the prod SWA).
It seeds `localStorage.ee_auth_user` **then reloads** — a hash-only nav will not remount React past the
login gate. Read the marker line **`UI_VERIFY_RESULT`** followed by JSON (`ok`, `missingExpect`,
`bodySnippet`, `consoleErrors`, `count`); screenshot uploads as artifact `ui-verify-screenshot`.
Success ⇔ every `expect` rendered. **Limitation:** only hash-addressable routes. Anything behind
in-screen tab state (e.g. the OppDetail Resume tab) cannot be reached without a click — say so rather
than claiming UI verification you didn't get.

---

## 5. Deploy + git flow

- **`app/**` → `executive-engine-deploy.yml`** — triggers on push to **`main` OR `claude/git-push-main-1zcqw5`**, paths `app/**`. Single `concurrency` group keyed to the SWA (not the ref) — deliberate, so two pushes don't race into `"No matching Static Web App environment was found."`
- **`api/**` → `api-deploy.yml`** — triggers on push to **`main` only**, paths `api/**`.
- ⚠️ **Asymmetry + branch trap:** an `app/**` change on `claude/git-push-main-1zcqw5` ships to production; an `api/**` change on that same branch does **not** deploy until it reaches `main`. And **a push to any OTHER branch — including this session's `claude/session-handoff-setup-ctozd3` — deploys NOTHING.** If you need to see a change live, it must land on `main` (api) or on `main`/`claude/git-push-main-1zcqw5` (app). Confirm the branch↔trigger match before promising the owner a live change.
- **Convergence quirk — it is NOT automated.** `api-deploy.yml` has no restart, sleep, health-poll, or smoke step; it goes green the instant `az functionapp deployment source config-zip` returns. A **NEW route typically needs ~90–120s of worker converge before it stops 404ing.** (The trailing `Set Function App settings` step restarts workers only as an incidental side effect of an appsettings write.) So: deploy → wait once → verify. Do not read a fresh 404 as "the route is broken."
- `api-deploy.yml` syncs ~26 secrets onto the Function App settings on every deploy. **Adding an integration secret means adding it to GitHub secrets AND to the `--settings` list** — an exact-name mismatch silently blanks the setting. Watch the odd casings: `secrets.Azure_admin_pw`, `secrets.scrape_do_api_key`, `secrets.firecrawl_scraper_api_key`. Not synced there (set directly on the Function App): `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `SESSION_SIGNING_SECRET`.
- **Branch + deploy discipline — OWNER STANDING RULE (2026-08-16): a NEW branch per feature, and `main` ALWAYS ends up carrying the work, because we deploy from `main`.** Never commit directly to `main`; it moves only by fast-forward. The loop: `git checkout -b claude/<feature>` off current `main` → commit → `git push -u origin claude/<feature>` (open a PR) → `git checkout main && git merge --ff-only claude/<feature>` → **`git push origin main`, which is what triggers the deploy** → verify the run. Do this as soon as work is verified, not only at session end. Pushing `main` auto-closes the branch's PR as merged — expected.
- ⚠️ Do **not** trust the old "the feature branch deploys too" shortcut: that holds only for the legacy `claude/git-push-main-1zcqw5` name and only for `app/**`. A fresh `claude/<feature>` branch deploys nothing.
- **Commit + push every completed unit.** The container is ephemeral and can be restored to an EARLIER snapshot — `git fetch origin && git log --oneline -1 origin/<branch>` vs local `HEAD` at session start, after any resume/compaction, and before every commit/push/deploy. If local is behind, `reset --hard origin/<branch>` before editing; never build on a stale tree. Uncommitted work is exactly what a reclaim loses.
- Known CI noise: `web-deploy.yml` (legacy console) fails on PRs with "maximum number of staging environments" — Azure's per-PR cap, not our change.
- **JSX smart-quote trap:** after **every** JSX edit run
  `sed -i "s/\xe2\x80\x98/'/g; s/\xe2\x80\x99/'/g; s/\xe2\x80\x9c/\"/g; s/\xe2\x80\x9d/\"/g" <file>`
  then `grep -P '[\x{2018}\x{2019}\x{201C}\x{201D}]' <file>` (must return nothing). esbuild fails on curly quotes.

---

## 6. Mandatory workflow (EDS skills — this repo uses it)

1. **`define-acceptance-criteria`** — before writing code, for any non-trivial task. Verifiable
   `Given/when/then` ACs, binary, signed off first. For CODE changes an **independent subagent** must
   write them — ACs the session agent types itself do not count (the point is a cold, adversarial read).
2. **Implement** (batch it — see §7).
3. **`verify-work` → the `verifier` agent** — before claiming done. An independent subagent with no
   shared context proves/disproves each AC from observable evidence. **"should work" / "looks good" is
   banned.** Doc/config-only edits skip steps 1 and 3.
4. **`track-actions`** — surface open `ACT-N` items from `.claude/actions.md` at session start; update
   statuses with evidence links as you go.
5. **`remember`** — read `.claude/memory.md` at start; append durable facts and commit at the end.

**Where the skills actually are (verified this session):** `CLAUDE.md` says they're cloned to
`/workspace/eds-claude-skills` — **that path does not exist in this container**, and the EDS skills are
not installed into `/root/.claude/skills/` either. They are in the attached repo at
**`/home/user/eds-claude-skills/.claude/skills/*.md`** (`define-acceptance-criteria.md`,
`verify-work.md`, `remember.md`, `track-actions.md`, `bootstrap.md`, `uat.md`, …). Read those files
directly and follow them manually. The **`verifier` agent IS available as a subagent type** — spawn it
by name. To modify a skill, edit/commit/push the `/home/user/eds-claude-skills` clone; do **not** call
`add_repo` for it (returns MCP `-32003 requires approval`).

A Stop hook gates completion claims: bootstrap ran, `memory.md` + `actions.md` updated, and any
risky/hard-to-reverse action (commit, push, delete/overwrite) was **stated in your own text BEFORE the
tool call** — not narrated afterwards.

---

## 7. Efficiency rules (the owner cares about this)

- Investigate with **parallel subagents** (`Explore`/`general-purpose`) and batch independent tool calls
  into one block.
- **Build ONCE, deploy ONCE, verify ONCE.** Don't piecemeal a change into three deploys.
- **No tight-loop polling.** Size a single background wait to the real work (API deploy + converge
  ≈ 2 min; an AI call ≈ seconds). Prefer event-driven signals (PR webhooks) over blind fixed-interval
  check-ins; only add a timer where the push signal genuinely can't cover it.
- **Confirm scope before a big or live-affecting build.** A small request is not license to expand it
  into a multi-feature deploy — state the plan and get a real go-ahead.
- **Trace the full blast radius** before "done": name the ONE core source (e.g. `useOpportunities`),
  `grep` every producer and consumer in both `app/src/` and `api/src/`, and confirm they reconcile.
  Mismatched counts across Today/Swipe/Pipeline/Opportunities mean something was applied off the funnel.
- **Extend, don't duplicate** — grep for the existing system and extend it; never stand up a parallel one.
- **No hardcoded config** — anything the owner would reasonably want to change must be a user-settable
  value; code may only seed the first default. Tell them where to change it.
- **No dead UI** — every control wired before commit; hide unfinished features rather than fake them.

---

## 8. Ground-truth rule (before answering, before reporting)

1. **Name the single source that would prove the claim true or false — and consult THAT.** For "is
   field A or B correct," the proof is the **primary source both derive from** (the real JD, the email,
   the file on disk), never a comparison of the two derived fields. Comparing two proxies tells you they
   differ, not which is right — never close that gap with an assumption.
2. **Actively seek disconfirming evidence.** If you haven't tried to falsify your leading hypothesis,
   you haven't verified it.
3. **Calibrate words to proof.** "Proven/confirmed/definitively" only after reading the ground-truth
   source; otherwise "inference — confidence X; would be confirmed by reading `<source>`."
4. **Separate Observation from Interpretation** so a reviewer can catch a bad inference.
5. **A queued workflow / HTTP 204 is NOT success.** It means the job started. Read the job LOGS, then
   report. If you can't confirm, say "I cannot confirm this yet" and name exactly what would confirm it.
6. **Status questions are a `git fetch` trigger.** "Is it deployed / done / merged / does X exist" gets
   answered from `origin/main` or the live system (`git show origin/main:<file>`, the deploy run's
   `head_sha`/`conclusion`) — never from the local working tree, which parallel sessions and container
   restores make stale without warning. Say that you fetched, so the answer is auditable.
7. **Never write "fixed"/"resolved" until the owner has confirmed it in their environment.** A local or
   sandboxed proof is necessary evidence, not sufficient confirmation. Use "implemented, mechanism
   verified live, NOT yet owner-confirmed."

---

## 9. AI / model facts

| Use | Model | Endpoint | Where |
|---|---|---|---|
| Workhorse (45 call sites) | `gpt-4o-mini` | `/v1/chat/completions` | `appPackets.ts`, `appApply.ts`, `appOutreach.ts`, `appJdParse.ts`, `mailWatch.ts`, most `mtNN.ts` |
| Higher-quality JSON extraction | `gpt-4o` | `/v1/chat/completions` | `appConvert.ts`, `appExtras.ts`, `appVoice.ts`, `mt35–37`, `mt40–42` |
| **Artifact AI-edit (Luna)** | **`gpt-5.6-luna`** (env `AI_EDIT_MODEL`) | **`/v1/responses`** | `appPackets.ts:19`, call at `:600` |
| Coach agent | `gpt-4o` (env `COACH_MODEL`; per-install override in PG `coach_config` id=1) | `/v1/responses` | `coachAgent.ts` — tool loop, `maxHops=8`, threads via `previous_response_id` |
| Embeddings (1536-dim) | `text-embedding-3-small` | `/v1/embeddings` | `coachMemory.ts` (`EMBED_MODEL`), `mailWatch.ts` |
| Transcription | `whisper-1` | `/v1/audio/transcriptions` | `appVoice.ts`, `appConvert.ts` |

**Luna pattern (reuse it — don't reinvent):** OpenAI **Responses API**, same `OPENAI_API_KEY`. Body
`{ model, instructions, input:[{role,content}], reasoning:{effort, summary:'auto'}, service_tier:'priority' }`.
`reasoning` is gated by `isReasoningModel()` (`/^o\d/` or `startsWith('gpt-5')`); `service_tier:'priority'`
is keyed to the exact `gpt-5.6-luna` literal. Effort ∈ `low|medium|high|max` (no `xhigh`), default
`medium`. Extract text via `output_text` ‖ first `output[].content[]` where `type==='output_text'` ‖ `.text`.
Always use the explicit `-luna`/`-terra`/`-sol` suffix — bare `gpt-5.6` routes to `sol`.
Raising effort on the cheap model is the cost lever before jumping tiers.

**Other integrations:** ElevenLabs (`xi-api-key`; TTS `eleven_turbo_v2_5`; ConvAI agent's `custom_llm.url`
is repointed at `/api/app/voice/chat`, so our API impersonates an OpenAI-shaped endpoint), HeyGen
(`/v2/video/generate` + `/v1/video_status.get`, `resolveLook()` maps avatar-group identity → look id),
Tavily / Firecrawl / scraper proxies for JD fetch. **No Anthropic/Claude integration exists.**
Cost metering: `usageMeter.ts` (hardcoded per-1M prices; unknown models fall back to `gpt-4o-mini`).

**Config & secrets:** all credentials live in **GitHub org secrets** (`deventerpriseds-org`) — never ask
the owner for a key. Check `/api/config-status` (booleans + masked hints) before assuming one is missing.
~52 env vars are referenced in `api/src`; runtime config also lives in Azure Table `AppConfig`
(partitions `auth`/`apps`), Table `Prompts`, and PG `coach_config`.

---

## 10. Known sharp edges (verified, worth knowing before you trip on them)

- `api/src/functions/tests/` is production code, not tests.
- All `app.http` registrations are `authLevel: 'anonymous'`; access control is entirely in-code via
  `resolveOwner`/`requireWrite`. Unverified reads fall back to the demo tenant.
- `appSession.ts` HMAC secret falls back to a hardcoded `'dev-only-insecure-secret'` if
  `SESSION_SIGNING_SECRET`, `MICROSOFT_CLIENT_SECRET` and `AZURE_CLIENT_SECRET` are all unset.
- Many handlers return **HTTP 200 with an `{ error }` body** on real failures — don't trust status
  codes alone when verifying; read the body.
- `ui-verify.yml` installs `playwright@latest` unpinned on each run.
- `db-query.yml` interpolates `sql` directly into a double-quoted shell string.

---

## 11. Current state

**Recent commits (`main` == feature branch == `01cf5b0` at time of writing):**
```
01cf5b0 docs: add SESSION-HANDOFF.md — orientation + operating procedure for new sessions
e793e53 docs: memory + actions for resume overhaul (ACT-23), Luna model, Director fix, mobile-render finding
d009c1c feat(resume): full labeled preview, inline + AI (Luna) editing, auto-refresh, empty-section fix
3ba88b5 diag: add /diag/doc-structure to fingerprint+diff resume template vs copy vs generated
54d6395 fix(taxonomy): plain "Director of <discipline>" is a favorite, not watch
```

**Shipped, awaiting the owner's own eyeball (do not call these closed):**
- **ACT-23** resume-tab overhaul (labeled all-sections preview, inline + Luna AI edit with effort picker,
  auto-refresh, empty-section fix) — backend verified live on `d009c1c`; the rendered ResumeTab is
  internal tab state so `ui-verify.yml` can't reach it.
- **ACT-35** JD-fabrication fix — agent-verified, left open pending owner confirmation of JD matches.
- Resume-doc "layout distortion" was proved to be the **mobile Google Docs viewer**, not the generator
  (`/diag/doc-structure` showed byte-identical geometry). No code fix.

**Open in `.claude/actions.md` (no DONE marker — read the file for the detail):**
ACT-20 (design-spec pages, in progress), ACT-26 (folder→role routing + Job Alerts tree),
ACT-36 (surface built search queries for owner review **before** unpausing search),
ACT-37 (post/found dates on OppDetail), ACT-38 (Swipe filters at LinkedIn parity),
ACT-40 (packet output quality), ACT-41 (template assets), ACT-42 (learning-material → playbooks),
ACT-44 (JD fetch during inbox extraction), ACT-45 (cross-role Analysis section),
ACT-29b/c/d (search pacing + Pattern-B sweep — built, disabled by default, owner must flip on).

Search is **PAUSED** by owner request pending the ACT-36 query review.

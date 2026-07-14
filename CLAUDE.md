# Job Application Platform

## Azure Infrastructure

- **Resource Group**: EnterpriseDS_ResourceGRP
- **Subscription**: 09594120-1b35-4e21-84c6-451ac27175a3
- **Tenant**: ee633423-c321-413c-a191-ace8b07e4196 (primary, where subscription lives)
- **Region**: eastus
- **Function App**: job-platform-api (job-platform-api.azurewebsites.net) — the API for BOTH apps below
- **PRODUCTION APP (Executive Engine)**: Static Web App `executive-engine-web` → **https://purple-ground-0f377120f.7.azurestaticapps.net/**. This is the real product we build (`executive-engine` frontend, vendored into `app/`, deployed by `.github/workflows/executive-engine-deploy.yml`). When someone says "the app", this is it.
- **Legacy dev console**: Static Web App `job-platform-web` (happy-river-0935bfe0f.7.azurestaticapps.net) — the old MT-XX test harness (`web/`), NOT the product.
- **Storage Account**: n8nstxpdthydai6fkm
- **Storage Tables**: AppConfig, Prompts, JobApplications, MasterContext
- **Node runtime**: 22

## Azure CLI Auth (for Claude Code sessions)

If `AZURE_CLIENT_ID` env var is set (CCR environment), login with:
```bash
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -p $AZURE_CLIENT_SECRET \
  --tenant $AZURE_TENANT_ID
az account set --subscription $AZURE_SUBSCRIPTION_ID
```

Otherwise use device code:
```bash
az login --use-device-code --allow-no-subscriptions
az account list --refresh --all  # finds subscription under tenant ee633423-...
az account set --subscription 09594120-1b35-4e21-84c6-451ac27175a3
```

## GitHub Secrets Required

**ALL credentials live in GitHub secrets.** Do NOT ask the user for a key or
assume one is missing — the `api-deploy.yml` workflow syncs them onto the
Function App's app settings on every deploy. If a credential-backed route fails,
check `/api/config-status`, don't ask for the secret. To verify DB/Graph/Google
routes, call the **deployed** Function (it can reach Postgres/Graph/Google); the
sandbox cannot.

### GitHub secrets (source of truth)
- `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` — service principal. **Doubles as the
  Microsoft Graph app** → synced as `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`.
- `AZURE_TENANT_ID` — ee633423-c321-413c-a191-ace8b07e4196
- `AZURE_SUBSCRIPTION_ID` — 09594120-1b35-4e21-84c6-451ac27175a3
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STATIC_WEB_APPS_API_TOKEN` — legacy console deploy (exec-engine fetches its own token via `az staticwebapp secrets list`)
- `Azure_admin_pw` — **⚠ note the casing** — Postgres `Admin_eds` password → synced as `AZURE_PG_PASSWORD`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `HEYGEN_API_KEY`, `HEYGEN_CLONE_1_AVATAR_IDENTITY_ID`, `HEYGEN_CLONED_VOICE_ID`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`

### App settings NOT synced by the workflow (set directly on the Function App)
These are live on `job-platform-api` but are **not** in `api-deploy.yml`, so
don't expect to find them there — confirm via `/api/config-status`:
- `GOOGLE_REFRESH_TOKEN` — OAuth-user token that owns Drive quota (Docs/Slides
  create, video archive). `HAS_GOOGLE_OAUTH` gates on it.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service-account fallback (0 Drive quota).
- Hardcoded in the workflow (not secrets): `MICROSOFT_TENANT_ID`,
  `AZURE_PG_HOST/PORT/DATABASE/USER` (db `boost_resume_n_packet_builder`),
  `ELEVENLABS_AGENT_ID=agent_1901kx3w6qd0f1yrr74gevbyhj1k`.

When adding a new integration secret: add it to GitHub secrets **and** to the
`--settings` list in `.github/workflows/api-deploy.yml` (exact-name match — a
mismatch silently blanks the setting).

## Live Database Access

**You cannot reach the live Postgres DB or the Function App API directly from a
Claude Code sandbox** — the egress proxy blocks `azurewebsites.net` and DB
credentials are not available as env vars here. Use GitHub Actions instead.

### Query the live DB
Trigger `.github/workflows/db-query.yml` via `workflow_dispatch` (it's on `main`).
The default SQL is `SELECT stage, COUNT(*) FROM opportunity GROUP BY stage`.
Pass custom SQL via the `sql` input for any other query.

```
# Via MCP tool:
mcp__github__actions_run_trigger(
  method="run_workflow",
  owner="deventerpriseds-org",
  repo="boost-application-packet-platform",
  workflow_id="db-query.yml",
  ref="main",
  inputs={}   # or { sql: "SELECT ..." }
)
# Then poll mcp__github__actions_list for the run_id, then get_job_logs to read output.
```

### Call live API endpoints (enrich, stage change, etc.)
Use `.github/workflows/api-test.yml` — GitHub Actions CAN reach `azurewebsites.net`.
The workflow acquires a service-principal Bearer token automatically from secrets,
then calls any API path with any method and body. This is how to test enrichment,
stage transitions, coach calls, or any other authenticated endpoint without needing
the user to click in the browser.

```
# Enrich an opportunity:
mcp__github__actions_run_trigger(
  method="run_workflow",
  owner="deventerpriseds-org",
  repo="boost-application-packet-platform",
  workflow_id="api-test.yml",
  ref="main",
  inputs={ "method": "POST", "path": "/api/opp/<uuid>/enrich" }
)

# Advance stage:
mcp__github__actions_run_trigger(
  method="run_workflow", ...,
  inputs={ "method": "PATCH", "path": "/api/opp/<uuid>", "body": '{"stage":"saved"}' }
)
```

**IMPORTANT:** The service principal token scope must match what `resolveOwner()` expects.
If the API rejects with 401/403, the token audience may not match — check `/api/health`
first to confirm the Function App is up, then `/api/config-status` for auth config.
The workflow is on `main` (must be on default branch to be workflow_dispatch-able).

### Check live API health
```
curl https://job-platform-api.azurewebsites.net/api/health
curl https://job-platform-api.azurewebsites.net/api/config-status
```
(These work from a browser or the user's terminal — not from this sandbox.)

## Deploy Commands

```bash
# Build API
cd api && npm ci && npm run build

# Deploy API (zip deploy)
cd api && zip -r /tmp/api-deploy.zip . --exclude '*.ts' --exclude 'src/*'
az functionapp deployment source config-zip \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --src /tmp/api-deploy.zip
```

## tsconfig note

The `lib` must include `"DOM"` for Azure SDK compatibility:
```json
"lib": ["ES2020", "DOM"]
```

## esbuild smart-quote bug (every JSX edit)

The Edit tool silently inserts Unicode smart quotes (U+2018/U+2019 curly apostrophes, U+201C/U+201D curly double-quotes) into JSX files. esbuild rejects them with `Expected "{" but found "'"`. After **every** JSX file edit, run this before committing:
```bash
sed -i "s/\xe2\x80\x98/'/g; s/\xe2\x80\x99/'/g; s/\xe2\x80\x9c/\"/g; s/\xe2\x80\x9d/\"/g" <file>
```
Then verify with `grep -P '[\x{2018}\x{2019}\x{201C}\x{201D}]' <file>` (should return nothing). Never skip this step — the build will fail silently at deploy time.

## Fix all consumers, not just the one you found (strict rule)

When fixing a shared concept (a constant, a calculation, a filter, a stage list),
**grep for every place that concept is used before declaring the fix complete.**
Example failure mode: fixing `FRESH_STAGES` in one `useMemo` but missing
`InboxScrubHero` which filters the same stages internally — the KPI shows 51
but the hero still shows 216.

Checklist before committing a conceptual fix:
1. `grep -rn <concept>` in both `app/src/` and `api/src/`
2. Every component/function that touches the concept must be updated consistently
3. If a child component re-derives what the parent already computed, pass the
   pre-computed value down rather than letting each component diverge independently

## Verify before reporting (strict rule)

**Never tell the user something is fixed, done, or working until you have confirmed it with actual evidence** — a passing test, a DB query result, a successful log, a git log entry, or a live API response. Triggering a workflow and getting a 204 queued response is NOT confirmation — it means the job started. Read the job logs first, then report. If you cannot confirm (sandbox blocks the endpoint, logs not yet available, etc.), say "I cannot confirm this yet" and explain what would confirm it and how the user can check. Do not infer success from absence of errors.

## Session start checklist (run these before touching any code)

1. `git log --oneline -10` — compare to what the context summary claims is done.
   If the summary says "X was fixed/committed" but it is not in git log, the work
   was lost when the previous session ended without pushing. **Treat it as not done
   and redo it.** Do NOT assume the summary is accurate.
2. `git status` — if there are uncommitted changes, understand them before proceeding.
   They may be in-progress work from the previous session that was never staged.
3. When the user reports a bug that was "already fixed in a previous session",
   **check git log first** before anything else. If the fix is not in git, that is
   the answer — commit the fix again. Do not blame the user or the live environment.

## Commit discipline (never leave a session without this)

- **Every completed task must be in a git commit and pushed before the session ends.**
  Edits that exist only on disk are lost when the container is reclaimed.
- After committing, run `git log --oneline -3` to confirm the commit is present.
  Do not report work as done until you see it in the log.
- If context is running low, commit and push whatever is done (even partial) with a
  clear message ("WIP: fixes 1-7 of 12, 8-12 not started") rather than losing it.

## Git workflow (branch discipline)

**HARD RULE: NEVER commit directly to `main`.** All development happens on the
session's designated feature branch (`claude/git-push-main-1zcqw5` unless told
otherwise). `main` only ever moves forward via fast-forward from the feature branch
— never by a direct commit or push of new work.

> **Why this is safe:** `executive-engine-deploy.yml` triggers on both
> `main` and `claude/git-push-main-1zcqw5`, so the live app deploys from either
> branch. You see changes on the live app immediately without `main` needing to move.

### One-branch workflow (follow every session):

1. **Before any work**, sync the feature branch with `main`:
   ```bash
   git fetch origin
   git checkout claude/git-push-main-1zcqw5
   git merge origin/main   # bring in any main commits first
   ```
2. **Develop** on the feature branch only. Commit and push there.
3. **Before each push**, fetch again and merge `origin/main` to stay current:
   ```bash
   git fetch origin && git merge origin/main
   git push -u origin claude/git-push-main-1zcqw5
   ```
4. **At the end of every session**, fast-forward `main` to match the feature branch
   so `main` stays up to date. This is routine — do it every session, not just at
   milestones:
   ```bash
   git checkout main && git merge --ff-only claude/git-push-main-1zcqw5
   git push origin main
   git checkout claude/git-push-main-1zcqw5
   ```
   If `--ff-only` fails (branches have diverged), resolve on the feature branch
   first (merge `origin/main` into it, fix conflicts), then retry the fast-forward.

- Resolve conflicts by understanding both sides. For the legacy `web/` console
  (not the product), preferring one side wholesale is acceptable; for `app/`,
  `api/`, workflows, and docs, merge the actual intent.
- After any merge: `npm run build` both `api/` and `app/`, check for duplicate
  `app.http` route registrations, and smoke-test the previously-passing live
  endpoints before considering it done.

## No dead UI (standing rule)

Every button, link, and selector must be wired before committing.
Never ship a `onClick={() => toast('...')}` stub as a real button.
Never render hardcoded fake names, counts, or statuses as live data.
If a feature isn't ready, hide the control — don't fake it.

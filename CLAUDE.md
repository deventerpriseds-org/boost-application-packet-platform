# Job Application Platform

## Azure Infrastructure

- **Resource Group**: EnterpriseDS_ResourceGRP
- **Subscription**: 09594120-1b35-4e21-84c6-451ac27175a3
- **Tenant**: ee633423-c321-413c-a191-ace8b07e4196 (primary, where subscription lives)
- **Region**: eastus
- **Production owner email**: von.ellis@enterpriseds.io — use as `?owner=` query param when calling app routes programmatically via api-test.yml
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

> **But the sandbox DOES have a local PostgreSQL.** This distinction cost a
> near-miss and is the reason for the section below. "Cannot reach the LIVE
> database" is true; "there is no Postgres here" is false, and reading the first
> as the second means schema work never gets executed at all.

### Run the schema locally — a schema change is not verified until it is EXECUTED (strict rule)

The container ships **PostgreSQL 16.13** (`/usr/bin/psql`, `/usr/lib/postgresql/16`).
`SCHEMA_SQL` can and must be run against it before any schema change is called done.

**The rule, and it is not optional:**

> **A schema change is not verified until it has been executed against a POPULATED database
> with the previous schema already applied.** Fresh-database success proves almost nothing,
> because every `create table if not exists` is skipped on the database you actually care
> about — taking its inline constraints, columns and indexes with it.

This is not theoretical. Two migration-killing defects were found this way in one file, and
**neither was visible by reading**, both passed on a fresh database, and both would have
aborted the entire migration on production:

- a composite `foreign key` whose `UNIQUE` target was only added by an idempotent `ALTER`
  further down the file → `ERROR: there is no unique constraint matching given keys`
- a `create index ... (packet_id, loop, ...)` naming a column an idempotent `ALTER` added
  350 lines later → `ERROR: column "loop" does not exist`

`H39`/`H39b` encode the general invariant: **any statement naming a column or constraint added
by an idempotent ALTER must come after that ALTER.**

```bash
# initdb refuses to run as root — use the postgres user.
rm -rf /tmp/pgd /tmp/pgsock && mkdir -p /tmp/pgd /tmp/pgsock && chown -R postgres /tmp/pgd /tmp/pgsock
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgd -U postgres -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgd -o '-p 55432 -k /tmp/pgsock -c listen_addresses=' -l /tmp/pg.log start"
export PGHOST=/tmp/pgsock PGPORT=55432 PGUSER=postgres

# Dump SCHEMA_SQL from the built module (never hand-copy it).
cd api && npm run build
node -e "import('./dist/functions/tests/schema.js').then(m=>require('fs').writeFileSync('/tmp/schema.sql', m.SCHEMA_SQL))"

# pgvector is NOT installed here. Stub it — the rest of the schema still executes for real.
sed 's/^create extension if not exists vector;/-- stubbed/' /tmp/schema.sql \
  | sed 's/vector(1536)/text/g; /using hnsw (embedding vector_cosine_ops)/d' > /tmp/schema_nv.sql

# main's SCHEMA_SQL, extracted from the file rather than from a build of your own branch.
git show origin/main:api/src/functions/tests/schema.ts > /tmp/main_schema.ts
python3 - <<'EOF'
s = open('/tmp/main_schema.ts', encoding='utf-8').read()
i = s.index('SCHEMA_SQL = `') + len('SCHEMA_SQL = `')
open('/tmp/schema_main.sql', 'w', encoding='utf-8').write(s[i:s.index('\n`;', i)])
EOF
sed 's/^create extension if not exists vector;/-- stubbed/' /tmp/schema_main.sql \
  | sed 's/vector(1536)/text/g; /using hnsw (embedding vector_cosine_ops)/d' > /tmp/schema_main_nv.sql

# THE TEST THAT MATTERS: apply main's schema, seed rows, then apply yours ON TOP.
psql -c "create database upg" postgres
psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_main_nv.sql     # main's SCHEMA_SQL
psql -q -d upg -c "insert into ..."                              # seed a few real rows
psql -v ON_ERROR_STOP=1 -q -d upg -f /tmp/schema_nv.sql          # YOURS — exit 0 or it is broken
```

`ON_ERROR_STOP=1` is required: without it `psql` reports success having skipped every
statement after the first error.

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
  inputs={ "method": "POST", "path": "/api/app/opportunity/<uuid>/enrich" }
)

# Advance stage:
mcp__github__actions_run_trigger(
  method="run_workflow", ...,
  inputs={ "method": "PATCH", "path": "/api/app/opportunity/<uuid>", "body": '{"stage":"saved"}' }
)
```

**Token scope:** `{client_id}/.default` (NOT `api://{client_id}/.default` — that returns 400).
**Route prefix:** all app routes are `/api/app/...` (not `/api/opp/...`).
**The workflow is on `main`** (must be on default branch to be workflow_dispatch-able).

### Check live API health
```
curl https://job-platform-api.azurewebsites.net/api/health
curl https://job-platform-api.azurewebsites.net/api/config-status
```
(These work from a browser or the user's terminal — not from this sandbox.)

### Verify the LIVE UI (Playwright-in-GHA) — the sandbox CANNOT see the rendered app
The sandbox egress is blocked from `*.azurestaticapps.net`, and Tavily/WebFetch can't execute the
React bundle or authenticate — so neither can confirm what the SPA actually renders. Use
`.github/workflows/ui-verify.yml` (script `scripts/ui-verify.mjs`): it runs headless Chromium on a GH
runner (open internet, executes the bundle), **impersonates a real owner** by seeding
`localStorage.ee_auth_user = {email,name,provider}` then **reloading** (a hash-only nav won't remount
React past the login gate — you MUST reload after seeding), navigates to a hash route, asserts
required text is present, and uploads a full-page screenshot artifact.
```
mcp__github__actions_run_trigger(method="run_workflow", ..., workflow_id="ui-verify.yml", ref="main",
  inputs={ "route": "#/settings/roles", "owner": "von.ellis@enterpriseds.io",
           "expect": "Target roles;VP, Product;Dir, Product" })   # ';'-separated substrings; ALL must appear
```
Read `UI_VERIFY_RESULT` in the job log (`ok`, `missingExpect`, `bodySnippet`). conclusion=success ⇒
every EXPECT rendered. This is the UI half of the same loop db-query.yml / api-test.yml give for data.

### Owner model (multi-tenant) — read this before touching persona / owner-scoped rows
- The frontend `_owner` (api.js) defaults to `demo@executive-engine.local` and is set from auth
  (`state.jsx`: `owner = auth.user?.email || DEMO`). **The real production data (opps, mail_watch,
  the 27 persona Target-roles) is under `von.ellis@enterpriseds.io`; `demo@…` is a shared sandbox.**
- `resolveOwner(req)` (appSession.ts): verified session Bearer → that email; else `?owner=` (unverified
  READS ok) else demo. So **every owner-scoped api.js call must pass `?owner=${_owner}`** or it silently
  falls back to demo (this bit `listPersonas`). Mutations still need a verified session (`requireWrite`).
- `persona` key is per-owner: `unique(owner_email, key)`. (A stale global `unique(key)` + FK
  `opportunity.persona_key` once broke this — dropped 2026-07-30.)

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
Then verify with a **Python codepoint scan**, not `grep -P` — `grep -P` fails in this container's
locale with "character code point value too large" and reports nothing, which reads as clean:
```bash
python3 -c "
import sys
BAD={0x2018,0x2019,0x201C,0x201D}
for n,l in enumerate(open(sys.argv[1],encoding='utf-8'),1):
    for c in l:
        if ord(c) in BAD: print(f'{sys.argv[1]}:{n}: U+{ord(c):04X}'); break
" <file>
```

### Two traps in this recipe — both bit us, both cost a build

**1. The `sed` sweep can CREATE a syntax error.** It rewrites a curly apostrophe to a straight one
*everywhere*, including inside a single-quoted JS string, where it terminates the string:
```js
const s = 'one model’s estimate'   // before the sweep: valid
const s = 'one model's estimate'   // after: broken, and the sweep "succeeded"
```
Run the sweep, then **build**. If a file's copy contains an apostrophe inside a single-quoted
string, rephrase the copy or switch that string to double quotes/backticks BEFORE sweeping.

**2. Do NOT add a repo-wide smart-quote linter. One was written and deleted the same night.**
It failed on its first CI run against 8 lines, every one correct: typographic quotes in
**user-facing copy** (where curly is right), curly apostrophes in rendered prose, and — the purest
false positive available — `termMatch.ts:21`, `t.replace(/[‘’‛]/g, "'")`, the smart-quote
*normalizer*, flagged for containing the characters it exists to strip. Both builds passed with all
8 present.

The reason is structural: the failure this rule describes is a smart quote **in a syntax position**,
and `esbuild` already rejects exactly those — with a parser, precisely, no false positives, in the
build that already runs. A regex cannot tell a syntax position from a string literal, so it either
misses real breakage or fires on correct code. **The build is the guard.** Anything else is the
cry-wolf failure hardening rule 2 forbids.

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

## Hardening — a mistake becomes a TEST, not a note (strict rule)

`api/test/hardening.test.mjs` is the failure memory. Every past mistake is encoded there as an
assertion with an ID (H1, H2, …), the evidence that it was real, and the invariant that now prevents
it. `.claude/actions.md` tells the story; the H-case enforces it. They point at each other.

**When you find a mistake — yours or the system's — add an H-case in the same commit that fixes it.**
Not a paragraph in a doc. A test.

This rule exists because prose does not run. Lessons were being written into `actions.md` and then
not applied, twice in one session: a fuzzy-matcher bug was fixed in the one place a test caught it
while the same class stayed live in three others — one of which decided a gate — and a "verify the
edit applied" lesson was written down and then broken two edits later. A note explains a mistake to
someone who happens to read it; a test refuses to let it come back.

Rules for an H-case:
1. **Assert the invariant, not the incident.** H4 forbids fuzzy matching in any accusation-grade
   check, not just the one line that was wrong.
2. **Make it precise enough never to cry wolf.** Two guards fired on a comment and on correct code
   when first written. A guard people learn to ignore is worse than none — strip comments, match the
   real construct.
3. **Record the evidence in the comment** — the run id, the measured count, the actual bad value.
   The next reader must be able to tell a real rule from a guess.
4. **Prefer a test over a grep** where the behaviour can be exercised; use a source grep only for
   structural rules a runtime test cannot express (imports, projections, schema registration).

### Standing rules distilled from those failures
- **Fuzzy matching is for RANKING, never for ACCUSING.** Similarity drops stopwords, so near-identical
  labels score 1.0. Anything that names an offender, blocks a gate, or asserts coverage must be
  exact, whole-phrase, or thresholded high enough to err toward surfacing.
- **Absent evidence is `not_applicable`, never `pass`.** A check that passed because there was
  nothing to check against is how a gate goes green on unverified work.
- **Never fabricate a composite.** If a component of a score has no source, the score is null — a
  partial composite is the number a reviewer trusts most and the one most likely to be wrong.
- **Verify that an edit applied.** A `.replace()` that does not match is a silent no-op. Assert the
  file changed, then re-read the region.
- **A 200 with a zero count is a result to investigate, not a pass.**

---

## Verify before reporting (strict rule)

**Never tell the user something is fixed, done, or working until you have confirmed it with actual evidence** — a passing test, a DB query result, a successful log, a git log entry, or a live API response. Triggering a workflow and getting a 204 queued response is NOT confirmation — it means the job started. Read the job logs first, then report. If you cannot confirm (sandbox blocks the endpoint, logs not yet available, etc.), say "I cannot confirm this yet" and explain what would confirm it and how the user can check. Do not infer success from absence of errors.

## Ground-truth before answering (strict rule — strengthens "Verify before reporting")

"Confirm with evidence" is not enough — it must be the RIGHT evidence. This rule exists because
of a real failure: asked which of two fields (`role` vs `jd_title`) was wrong, the agent pulled a
DB query showing they *differed*, then resolved which-was-correct with an **unstated assumption**
and reported it as "proven." It had checked a proxy, not the ground truth (the actual JD/email
subject), and got the answer backwards. The user only caught it because they happened to know the
truth. When answering any "which is right/wrong / what's actually happening / is X true" question:

1. **State the claim, then name the single source that would prove it true or false — and consult
   THAT.** For "is field A or B correct," the proof is the **primary source both derive from** (the
   real JD, the email, the file on disk), never a comparison of the two derived fields. Comparing
   two proxies tells you they differ, not which is right; never resolve that gap with an assumption.
2. **Actively seek disconfirming evidence for your leading hypothesis.** Before concluding X, look
   for what would make X false. If you haven't tried to falsify it, you haven't verified it.
3. **Calibrate words to proof.** "Proven / confirmed / clearly / definitively" ONLY after reading
   the ground-truth source. Otherwise say "inference — confidence X; would be confirmed by reading
   `<source>`."
4. **No "Recommended" on a factual determination that isn't ground-truthed.** Establish the fact
   first, advise second. Do not hand the user an option built on an unverified premise.
5. **Separate Observation from Interpretation** in the answer, so the user can catch a wrong
   inference even when they don't know the answer themselves.

## Extend, don't duplicate (strict rule)

Before building any new table, model, endpoint, classifier, or subsystem, **grep for an existing
system that already serves that purpose and EXTEND it.** Never stand up a parallel system. This
rule exists because of a real failure: given a request to "add my roles," the agent built a new
`taxonomy_title` system parallel to the existing `persona` / `folder_role_map` / Settings ▸ Roles
role system — leaving two disconnected role brains and a black-box Settings screen. Memory
documented the existing system; the agent didn't reconcile against it. Treat every "add X" request
as "find what already does X and extend it." If a new structure genuinely seems needed, first state
what exists, why it's insufficient, and get explicit sign-off before creating it.

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

**HARD RULE: NEVER commit directly to `main`.** All development happens on a feature branch
(a new one per feature); `main` only ever moves forward via fast-forward from that branch —
never by a direct commit or push of new work.

> **Production deploys from `main` only.** `api-deploy.yml` fires on `main` (paths `api/**`)
> and `executive-engine-deploy.yml` fires on `main` (paths `app/**`). **A push to any other
> branch deploys nothing** — landing on `main` is what makes a change live. (Until 2026-08-16
> `executive-engine-deploy.yml` also deployed production from `claude/git-push-main-1zcqw5`;
> that trigger was removed — unreviewed branch pushes should not reach prod. The branch itself still
> exists, fast-forwarded to `main`: deleting a ref is rejected by the CCR git proxy, so the control is
> the workflow file AT that ref now reading `branches: [main]`, not the branch's absence. Consequence:
> force-pushing that branch back to a commit older than `da7eb5e` would restore the self-listing
> workflow and re-open production deploys from it.)

### Per-feature workflow (follow every time):

1. **Start from current `main`** — never from a stale tree:
   ```bash
   git fetch origin
   git checkout main && git merge --ff-only origin/main
   git checkout -b claude/<short-feature-name>
   ```
2. **Develop** on that feature branch only. Commit there.
3. **Before each push**, fetch again and merge `origin/main` to stay current:
   ```bash
   git fetch origin && git merge origin/main
   git push -u origin claude/<short-feature-name>
   ```
   Open a PR for the branch if one isn't already open.
4. **Land it on `main` and deploy** — routine, not a milestone step. Do this as soon as the
   work is verified, not only at session end:
   ```bash
   git checkout main && git merge --ff-only claude/<short-feature-name>
   git push origin main          # THIS is what triggers the deploy
   git checkout claude/<short-feature-name>
   ```
   If `--ff-only` fails (branches diverged), resolve on the feature branch first
   (merge `origin/main` into it, fix conflicts), then retry the fast-forward.
   Pushing `main` auto-closes the branch's PR as merged — expected, not an error.
5. **Then verify the deploy actually happened** — a green push is not a deployed app. Check the
   workflow run **for YOUR commit**, and remember a NEW api route needs ~90–120s of worker converge
   before it stops 404ing (nothing in CI waits for this).
   ```bash
   ./scripts/wait-run.sh sha:api-deploy.yml:$(git rev-parse HEAD)   # blocks until THAT run finishes
   ```
   **Never verify a deploy against "the latest run."** Immediately after a push the newest run is
   still the PREVIOUS commit's — GitHub has not created yours yet — so waiting on it reports success
   for code that was never deployed. This bit us: a "deployed" confirmation was followed by two 400s
   from stale code that read like an application bug. `wait-run.sh` now refuses `latest:` for any
   deploy workflow (H15). Use `sha:` and it waits for the run to exist before waiting for it to
   finish.

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

## EDS Claude Skills (deventerpriseds-org/eds-claude-skills)

Cloned to `/workspace/eds-claude-skills`. Skills load automatically each session via
`register_repo_root`. **Use these skills proactively** — they encode org-level standards.

> **To modify a skill, edit/commit/push against this local clone directly** — do NOT call
> `add_repo` for it (that returns MCP `-32003 requires approval` and you don't need it: the
> clone already has a working git-proxy push remote). Reflexively reaching for `add_repo`
> instead of the existing clone is a known miss — the repo is already here.

| Skill | When to use |
|---|---|
| `define-acceptance-criteria` | **Before coding any feature or fix** — extract verifiable ACs, get sign-off first |
| `verify-work` | **After implementing, before claiming done** — spawns independent verifier agent; "should work" is banned |
| `remember` | Session start: read `.claude/memory.md`. Session end: update it and commit |
| `track-actions` | Session start: surface open ACT items from `.claude/actions.md` before any work |
| `create-github-repo` | When creating a new GitHub repo (triggers `create-repo.yml` workflow via MCP) |
| `setup-environment` | When a needed CLI (az, gh, vercel, etc.) is missing in the CCR session |
| `setup-mcp` | When adding MCP servers to a project |

**Agents (`.claude/agents/` in eds-claude-skills):**
| Agent | Role |
|---|---|
| `verifier` | Independent UAT verifier — spawned by `verify-work`; proves/disproves claims from observable evidence only; never self-reports |

**Mandatory workflow:**
1. `/define-acceptance-criteria` at the start of every non-trivial task
2. Implement
3. `/verify-work` before reporting done — this spawns the `verifier` agent automatically

Repo secrets are org-level in `deventerpriseds-org` — no per-repo config needed.

## No hardcoded config — everything user-setting driven (strict rule)

**Never hardcode a configurable value in code only.** Every setting, default, threshold, list,
preference, or behavior toggle a user would reasonably want to control MUST be exposed as a
user-changeable setting (Settings UI / config store), and the code may only SEED the *first/default*
value — which the user can then change. Treat any value you write in code as "the initial value the
user will override," never as a permanent constant.

- Before hardcoding ANY behavior-affecting value (default location, remote preference, search cadence,
  caps, tiers, thresholds, feature toggles, etc.), ask: "can the user change this in the UI?" If not,
  either wire it to a setting first, or get EXPLICIT owner approval to leave it code-only — and record
  that approval.
- Seeding a per-owner default (e.g. writing `owner_search_prefs`) is fine because the user can change
  it in the UI. Baking the same value as a literal in code with no UI path is NOT.
- When you set a "first value" on the owner's behalf, tell them where to change it.

This exists because the owner wants the product to be fully self-serve/configurable, not dependent on
a developer to change constants. Violating it creates black-box behavior the owner can't adjust.

## Trace every dependent — up AND downstream — before declaring a change done (strict rule)

When you change ANY shared value, filter, computed field, data source, or endpoint, you MUST map its
FULL blast radius before shipping: who PRODUCES the data upstream and every consumer DOWNSTREAM that
reads or re-derives it. A filter/count/field must be applied at the ONE core source that feeds all
consumers, never bolted onto some screens and not others — or the numbers silently disagree.

Checklist before "done":
1. Name the core source (the hook / selector / endpoint that everything funnels through). Prefer
   applying shared logic THERE, once, so every consumer updates automatically from the data.
2. `grep` every consumer of the thing you changed (both `app/src/` and `api/src/`). List them.
3. For EACH consumer, ask: does it now agree with the others? Counts on Today vs Swipe vs Pipeline vs
   Opportunities must reconcile because they read the same funnel.
4. If a value can differ between screens, that difference must be a deliberate, explained choice
   (e.g. discovery filter applies to fresh stages, not committed pipeline) — never an accident of
   where you happened to add the filter.

This exists because a location filter was added to Swipe + Opportunities but NOT to Today's scrub
counts, so the same underlying data showed different numbers on different screens. Real fix: filter
in the shared `useOpportunities` source so all consumers reflect it. Stale/mismatched numbers almost
always mean a value was hardcoded or applied off the core funnel — hunt that, don't patch one screen.

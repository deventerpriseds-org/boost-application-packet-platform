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

### READ THIS FIRST: there IS direct live-DB access, via a BROKERED MCP connector

**`boost-pg-mcp-write` is THE connector for this app's live Postgres — use that one.** Reachable in
~1s per query with no runner. **Do not enumerate or query the other two** (owner-instructed,
2026-08-26: *"you only need one correct? im not sure yo need to keep querying the other two
connections. i only refresh he boost read write db connector"*):

| Connector | What it is | Use it? |
|---|---|---|
| **`boost-pg-mcp-write`** | this app's Postgres; **the one the owner maintains and refreshes** | **YES — this one** |
| `Boost_DB_Connector` | same database, redundant | no |
| `Azure_pg_mcp` | a DIFFERENT database (`RAG_AI_Agents`), the org's other app | no — wrong data entirely |

An earlier version of this file named `Boost_DB_Connector` as the canonical one, which is why
sessions kept listing all three and asking the owner to flip toggles on connectors nobody uses.

**Before reaching for ANY of them, ask what store the data is actually in.** These are Postgres.
`MasterContext`, `AppConfig`, `Prompts` and `JobApplications` are Azure Storage **TABLES** — no
Postgres connector reaches them, in any state. Reading those goes through a Function route
(e.g. `GET /api/diag/skill-sources`) called via `api-test.yml`. A whole afternoon was spent on
connector state while the data in question was never in Postgres.

**Why the paragraph below is only half true, and how it misled a whole session.** A
*locally-spawned* client — `psql`, `az`, a stdio MCP — connects **from inside** the
session and dies on the egress proxy. **A brokered/remote MCP runs OUTSIDE the session,
on Anthropic's servers, so the proxy never sees it.** Same database, different transport,
opposite outcome. The general rule (from the org `query-azure-pg-mcp` skill, proven
2026-08-07): *a brokered/remote MCP bypasses session egress; a locally-run one does not.*

**Two things to check before concluding you cannot reach the data — neither is a platform
limit, both are one toggle:**
- `enabledInChat: false` → the connector is authenticated but **off for this chat**. Ask
  the owner to enable it in the chat's connector settings; its tools will not load otherwise.
- A system reminder saying the server *"requires authentication"* → the OAuth session
  lapsed. A CCR session cannot run the OAuth flow. **TELL THE OWNER** so they can re-auth.
  Do not silently fall back to GitHub Actions and never mention it.

#### `boost-pg-mcp-write` is the PREFERRED transport, and a lapse is a NUDGE, not a detour
(owner-instructed 2026-08-29: *"make a note to use the boost-pg-mcp-write as the preferred option
and unless I tell you to essentially work continuously, nudge more for a reset if a step requires
it's abilities which I may then advise to switch to the workflow or refresh and unblock proceeding.
remember to check before implementation steps require db"*)

1. **PRE-FLIGHT, BEFORE an implementation step begins — not mid-step.** Ask: does this step need
   to read or write live Postgres (a measurement, a regression baseline, a row count, an AC's
   verification)? Say so up front. Discovering it three tool calls in, after the plan is committed,
   is the failure this rule prevents.
2. **If it does and the connector is lapsed or off, TAKE THE FALLBACK *AND* ASK FOR A REFRESH.**
   Both, in the same turn. Run the query through `db-query.yml`, get the data, keep working — and
   render the reconnect card so the owner can restore the fast path when convenient.

   **CORRECTED 2026-09-03, owner-instructed:** *"you need to correct whatever instruction has you
   only using the connection and not falling back to the yml until you can ask me to refresh it.
   forgoing data is absolutely unacceptable."* The previous version of this rule said NUDGE AND STOP
   and forbade "quietly rerouting" through the workflow. That was wrong in one specific way: it
   traded **the data itself** for the owner's convenience in choosing a transport. It produced a
   real cost the same day — an AC pass shipped with every number sourced from a committed fixture
   dump and an explicit "no live DB read was possible", when `db-query.yml` was available the whole
   time and would have grounded it in production.

   **The rule now:** never return without the data. The transport is a convenience question and it
   is the owner's to answer at their leisure; the DATA is not optional and is never what waits.
   "Quietly" was the real objection in the old wording — so do it LOUDLY: say which query took the
   fallback and what a refresh would have made faster.

   **RENDER THE RECONNECT CARD — do not write the nudge as prose.** A sentence saying "the connector
   needs re-auth" makes the owner leave the conversation, find the settings screen and identify the
   right connector themselves. The card is one click. Owner, 2026-09-01: *"how do we create a
   skill/rule that you present this when you need a reconnection? You've done so inconsistently but
   it is quite efficient."*

   Two calls, in this order:

   ```
   ListConnectors(keywords: ["boost", "postgres"])      -> each entry carries a directoryUuid
   SuggestConnectors(uuids: ["<directoryUuid>", ...])   -> renders the clickable card
   ```

   `boost-pg-mcp-write` is `404ab1eb-d85f-49ad-9896-3b0be98b3179`; `Boost_DB_Connector` is
   `42f9b20a-5c8e-4d6b-b1e9-f099ae5c2330`. Read the uuid from `ListConnectors` rather than pasting
   these — a reinstall mints a new one and a stale uuid renders the wrong row.

   **`SuggestConnectors`' own description says the uuids must come from `SearchMcpRegistry`. They do
   not have to.** `ListConnectors` returns the same `directoryUuid` field, and the call succeeds from
   those — verified 2026-09-01, returning `boost-pg-mcp-write` (`installState: connected` -> a **Use**
   button) and `Boost_DB_Connector` (`unknown` -> **Connect**), which is exactly the card the owner
   screenshotted. `SearchMcpRegistry` is for connectors the owner does NOT yet have; for one that is
   installed and merely lapsed, `ListConnectors` is the right source and the registry search is a
   detour.

   **Still STOP after rendering it.** The card is the ask, not the answer — it does not reconnect
   anything, and a card followed by three more tool calls buries the thing the owner has to click.
3. **The one exception: an explicit "work continuously" instruction.** If the owner has said to keep
   going without stopping, take the `db-query.yml` fallback rather than blocking — and say in the
   same turn which step took the fallback and what a refresh would have got faster, so they can
   still choose to reconnect.
4. **A lapse is cheap to fix and expensive to route around.** Measured 2026-08-29: the connector was
   reported lapsed, the owner reconnected it in one message, and the next query
   (`select action, count(*) from swap_decision group by action` → kept 35, swapped 15, dropped 8,
   added 7) returned in about a second. The `db-query.yml` equivalent is a dispatch, a poll and a log
   read. `db-query.yml` remains the correct fallback — it is not the default.

*(2026-08-23: a session read the paragraph below, concluded the live data was unreachable,
and built `fixture-refresh.yml` plus a chain of `db-query.yml` round-trips to haul data out
through job logs — while `Azure_pg_mcp` sat `enabledInChat: true` and two system reminders
named both connectors. The owner: "of course you can reach my data the agents have been
doing so for days". GitHub Actions is the FALLBACK for when a connector is off or lapsed,
not the default.)*

**Without a connector**, you cannot reach the live Postgres DB or the Function App API
directly from a Claude Code sandbox — the egress proxy blocks `azurewebsites.net` and DB
credentials are not available as env vars here. Then, and only then, use GitHub Actions.

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

**Naming an H-case: use a SLUG, never a number.** `H1`-`H44` are frozen — they are referenced from
`.claude/actions.md`, from code comments and from each other. Every new case takes a slug saying what
it guards: `test('H:schema-parity: ...')`, `test('H:no-vacuous-gate: ...')`. At least two words.

The global counter is retired because it collided three times in one session and each fix failed in
turn: one ID per lane (lanes find several defects), ranges per lane (lanes overrun, new lanes appear),
claim-at-merge (worked, but cost a hand renumber on every merge — three of them, plus one bad splice
that left the file unparseable). The counter requires coordination between branches that cannot see
each other. Slugs need none, and two lanes minting the same slug means they guard the same thing,
which is information rather than an accident. `H26` enforces this — a new numeric ID fails the suite.

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

### NEVER BLOCK ON A DEPLOY OR A WORKFLOW - background it (strict rule, owner-instructed)

`wait-run.sh` polls. That is fine; **blocking the turn on it is not.** Run it with
`run_in_background: true` and the harness wakes this session when it exits, so the 2-9 minutes cost
nothing and other work continues meanwhile.

```
Bash(command: "./scripts/wait-run.sh sha:executive-engine-deploy.yml:$SHA", run_in_background: true)
```

The owner has asked for this more than once - "never use waits always subscriptions or polls", then
"why are you still using waits for deploy instead of subscription/workflow/storage queue whichever
is fastest? I've asked for this to be normal behavior" - and it kept being done synchronously
anyway. What is actually available, so nobody re-litigates it:

| Signal | Push available? | Use |
|---|---|---|
| PR CI + reviews | **YES** - `subscribe_pr_activity` wakes the session on failures/comments | Subscribe, never poll |
| `workflow_dispatch` runs you trigger (db-query, api-test, ui-verify, deploys) | No push signal is exposed to a CCR session | `wait-run.sh` **in the background** |

So there is no faster transport for a dispatch run from here - but there is also no reason to sit
still while it runs. Background it, keep working, act on the wake.

- Resolve conflicts by understanding both sides. For the legacy `web/` console
  (not the product), preferring one side wholesale is acceptable; for `app/`,
  `api/`, workflows, and docs, merge the actual intent.
- After any merge: `npm run build` both `api/` and `app/`, check for duplicate
  `app.http` route registrations, and smoke-test the previously-passing live
  endpoints before considering it done.

## A long AC or verification pass does not run IN this session (2026-08-29; vehicle replaced 2026-08-30)

**The premise is unchanged and was measured.** An in-session `Agent` subagent makes this CCR session
**unresponsive while it runs**: on 2026-08-29 the owner typed at ~25s into a background subagent and
the message sat QUEUED and undelivered for **93 seconds**, surfacing only when they pressed stop —
which killed the agent. The client shows "Brewing… 1 running task" and relabels the input box "Queue
feedback…", and queued text is lost if the screen sleeps. The only way to reach the session was to
destroy the work in flight. `run_in_background: true` does **not** fix this; the turn stays active
while the parent keeps issuing tool calls.

**What changed on 2026-08-30 is the VEHICLE.** This section previously sent every long pass to
`cross-container-pass.yml`. That is a single Messages API call: it **cannot grep, follow an import, or
execute anything**, so a verifier running on it can only reason about what an assertion *would*
evaluate — and the one thing that has actually caught inert guards in this org is a running
adversary. **That is its one real and unchanging deficit.**

> **CORRECTION, 2026-08-30 — do not read `cross-container-pass.yml` as credit-blocked.** This section
> previously said it *"needs metered API credit, which ran out mid-pipeline"* (run 33277232470).
> That run did fail exactly that way, but the TENSE was wrong: **a balance is a STATE, not a
> property.** Re-probed 2026-08-30 (run 33288812332): `end_turn`, `in=33 out=11`, artifact
> complete, success in 14s — **the credit is live and the runner works today.** Evidence and the
> command that re-checks it: `eds-claude-skills/docs/qc-evidence/FEASIBILITY-runner-credit.md`.
> Re-probe rather than remember; the toollessness above is the deficit that does not change.

### Use `scripts/verify.sh` in `eds-claude-skills` — one vehicle, two kinds

```
scripts/verify.sh --kind AC <slug> <brief-file> --context "<globs>"   # -> docs/qc-evidence/AC-<slug>.md
scripts/verify.sh <slug> <loop> <brief-file>    --context "<globs>"   # -> VERIFY-<slug>-<loop>.md
```

Detached `claude -p` on the session's own credential. It does **not** hold the session (it returns
in under a second and prints the artifact path), needs **no API key**, and **CAN execute** — it runs
suites, applies mutations and observes the result. Measured 2026-08-30 on real work: an AC pass at
12 turns / 105s / $0.87 that found a regression the implementer had missed, and a verifier at
45 turns / 336s / $2.36 returning 9/9 CONFIRMED.

**Always pass `--context`.** The A/B that settled this compared two arms of the same vehicle on the
same model: with the target repo's files in the room it scored **5/5**; without, **3/5**, for no
other reason. Context inclusion is a required input, not a tuning knob — and a glob matching nothing
aborts non-zero by design rather than running a pass that silently lacks a file.

**Prefer Sonnet and batch inside one cache window.** The bill is the CONTEXT, not the reasoning:
cache WRITE 65,688 tok = $0.41 against cache READ 65,377 = $0.03. Opus cost 2.7x Sonnet for
identical verifier output.

**STATUS — re-probe, do not remember.** `verify.sh` is **MERGED to `eds-claude-skills` `main`**
(PR #28), and the engine it runs on was smoke-tested live on 2026-08-30: `claude -p --model
claude-sonnet-5` returned `ok`, rc=0, on the session credential with no API key. An earlier version
of this line said "not yet merged" and stayed wrong after #28 landed — a STATE recorded as a
standing fact, the same error as the credit claim above. The two commands that re-check it, either
of which takes seconds:

    git show origin/main:scripts/verify.sh | head -3      # is it on main
    claude -p --model claude-sonnet-5 "Reply with exactly: ok"   # does the engine answer

### `cross-container-pass.yml` keeps exactly ONE role — and it is the reason not to delete it

It runs on **GitHub's machines**, so it is the **only vehicle that survives a container restore**.
`verify.sh` spawns a child of this container and dies with it: it survives *interrupts*, not
*restores*. Still true, and still the reason not to fork it:

> **Do NOT copy `cross-container-pass.yml` or `scripts/cross_container_pass.py` into this repo.** The workflow already
> takes a `target_repo` input for exactly this. Proven, not assumed: run `33264119335` step 3
> ("Check out the target repo") completed `success` in 2s with `target_repo` set to this repository.
> A second copy is a parallel system to maintain, and "Extend, don't duplicate" forbids it.

```
mcp__github__actions_run_trigger(
  method="run_workflow",
  owner="deventerpriseds-org", repo="eds-claude-skills",   # <- the WORKFLOW lives there
  workflow_id="cross-container-pass.yml", ref="main",
  inputs={
    "prompt": "<the full AC or verifier brief>",
    "target_repo": "deventerpriseds-org/boost-application-packet-platform",
    "target_ref": "claude/<your-feature-branch>",     # defaults to main -- pass YOUR branch
    "context_globs": "_target/CLAUDE.md,_target/.claude/*.md,_target/api/src/functions/**/*.ts",
    "effort": "high",
    "output_name": "VERIFY-<slug>-<loop>.md",
  })
```

Its limits, so nobody re-derives them: single-shot (no tools, 1M context is the compensation —
stuff the files in up front); `effort: high` is the default because `xhigh` over 398 KB ran 7m29s,
cost ~$1.61 and still hit `max_tokens` mid-answer; a partial artifact opens with an `INCOMPLETE`
banner and `stop_reason: max_tokens` fails the job.

### Restore-survival is a property of the WORK, not the vehicle — and this part is measured

Same task across one real container restore: a **one-pass** run died at 9,122 bytes mid-sentence
with **0** chunks durable; a **chunked** run that committed **and pushed** after each chunk survived
with **56,374 bytes and 2 of 5 chunks durable and resumable**. **Chunk every long pass; commit AND
push per chunk** — a commit that is not pushed is still inside the container, which was a real bug
in the chunk script itself.

Self-hosting the containers is **not** an escape route: `list_environments` (2026-08-30) returns
three environments, all `kind: anthropic_cloud`, with no `ccpool_` pool. Re-run that one call rather
than re-deriving it.

### A pass is ALIVE iff its OUTPUT IS GROWING

Never `pgrep` for it: the pattern matches this session's own `claude`, and `pkill -f` will kill your
own shell because that shell's command line contains whatever you searched for. Both happened on
2026-08-30, and a verifier was declared dead **14 seconds before it delivered 9/9**. The JSON log is
written only at the END of a run, so 0 bytes proves nothing mid-run — read the `.out` sidecar's
mtime.

Either way, commit the artifact to `docs/qc-evidence/` under the name the verdict contract expects
(`AC-<slug>.md`, `VERIFY-<slug>-<loop>.md`). The eds Stop gate accepts a committed evidence file in
place of a subagent spawn **only if** it carries per-claim `CONFIRMED` / `REFUTED` /
`NOT_APPLICABLE` verdicts. Prose does not satisfy it.


## WHICH VEHICLE RUNS A PASS — pick by the two questions that actually differ

An AC pass and a verification pass are the same act: an independent read. There are three ways to
run one, and agents keep choosing wrongly because the names described their vintage rather than
their role. Only TWO properties separate them.

| vehicle | holds my turn (you cannot type) | survives a container reclaim | cost |
|---|---|---|---|
| in-session `Agent` subagent | **YES — the owner is locked out** | no | free (session plan) |
| `scripts/verify.sh` (detached `claude -p`) | no | no | free (session plan) |
| `.github/workflows/cross-container-pass.yml` | no | **YES — runs on GitHub's machines** | **metered API** |

**DEFAULT: `scripts/verify.sh`.** Free, can execute (it runs suites, applies mutations, observes the
result), and it does not hold the turn.

    scripts/verify.sh --kind AC <slug> <brief> --context "<globs>"    -> AC-<slug>.md
    scripts/verify.sh <slug> <loop> <brief>    --context "<globs>"    -> VERIFY-<slug>-<loop>.md

`--kind` changes ONLY the prompt and the artifact name. There is one `claude -p` invocation in that
file and both kinds use it, so **AC and verification cost exactly the same** — a question that has
been asked more than once because dollar figures were quoted without saying what they meant. Any
per-run dollar amount in these files is `claude -p`'s own `total_cost_usd`: what the work WOULD cost
on the metered API, not a charge. Both run on this session's plan credential.

**"Local" does not mean "blocking", and that is the confusion worth killing.** What locks the owner
out is my TURN staying open, not where the work runs. An `Agent` subagent runs inside my turn, so
their typed message sits queued in grey — measured at 93 seconds, and the only way in was the stop
button, which killed the agent. `verify.sh` forks a child, redirects its stdout to a FILE, and exits
in under a second; my turn ends and the owner has the floor. **The redirect is load-bearing:** a
backgrounded child inherits stdout, and any caller capturing output waits for EOF, so an earlier
version printed "launched" instantly and still blocked for the whole run.

**Use `cross-container-pass.yml` for exactly ONE reason: the pass must survive a container reclaim.**
A reclaim SIGKILLs this container and takes any detached child with it — `verify.sh` survives
*interrupts*, not *restores*. Nothing else recommends the runner: it is a single Messages API call,
so it **cannot grep, follow an import, or execute anything** (1M context is the compensation — stuff
the files in up front), and it bills metered credit because a GitHub runner has no session and must
present an Anthropic credential of its own.

**Before reaching for the runner, prefer chunking.** Reclaim-survival is a property of the WORK, not
the vehicle: measured across one real reclaim, a one-pass run died at 9,122 bytes with 0 chunks
durable, while a chunked run that committed AND PUSHED per chunk survived with 56,374 bytes and 2 of
5 chunks resumable. A commit that is not pushed is still inside the container.

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

## STOP for a decision, never for a status update (strict rule, owner-instructed 2026-08-26)

The rule below ("Confirm the plan before building or deploying") is about **not starting unrequested
work**. It was being read as "check in at every phase boundary", which is a different and much more
expensive thing. The owner named it twice in one session:

> *"why are you stopping for just an update on progress? this wasn't a reason to stop because it
> didn't include me confirming the plan, answering a critical question, or confirming before
> deploying live"*

**There are exactly THREE reasons to end a turn and wait:**

| # | Stop when | Because |
|---|---|---|
| 1 | **The plan needs confirming** — unrequested, multi-file, or hard-to-reverse work is about to start | Starting is the irreversible part |
| 2 | **A critical question is unanswered** — proceeding under any assumption would be unsafe, or would make the work useless if the assumption is wrong | The answer changes what gets built |
| 3 | **Something is about to go live** — a push to `main`, a deploy, an outward-facing action | Live is not reversible on the owner's behalf |

**Everything else is a reason to KEEP WORKING**, and reporting it mid-turn is fine — say it and carry
on in the same turn. Specifically, none of these is a stop:
- a phase finished (parser done, tests green, guards mutation-proved)
- a commit landed on a FEATURE branch (nothing is live until `main` moves)
- an intermediate result is interesting, or a number needs explaining
- a background agent or sweep returned
- the next step is obvious and already inside the agreed scope
- a low-risk judgement call has a safe default — **take the reversible option, note it, keep going**
  (the standing instruction: *"i dont want anything hold up progress, particularly your questions
  about low risk items. ship it and have it tracked as a potential item to pull"*)

**The tell that you are about to violate this:** the turn ends with a summary of what was just done
plus a sentence starting *"Next, I'll…"* or *"Starting on X now"*. If you can name the next step, you
are not blocked — **do it.** A turn that ends on "starting X now" without starting X is the failure
this rule exists to stop.

**Batch the reporting instead.** The owner reads the bottom of a turn, so put status there and keep
the work above it. One turn that does five things and reports them at the end beats five turns that
each do one thing and stop to say so.

## Match the process to the risk (strict rule, added 2026-08-22 at the owner's instruction)

Every change was getting the same ceremony: an AC subagent, an implementation, an independent
verifier, a mutation-proof of every guard, and a live workflow round-trip. Five steps and ~20
minutes of agent time for a doc edit costs the same as for a change to the approval gate, and the
owner named the cost directly — *"we have too many steps for a simple update. it's a waste of tokens
and I need us to get more efficient while not dropping effectiveness of guards all together."*

So the process is TIERED BY BLAST RADIUS, not applied uniformly.

| Tier | What it covers | Process |
|---|---|---|
| **1 — accusation grade** | Anything that decides `must_have_coverage`, the artifact gate, a score, a coverage count, or that names an offender. Anything that admits model output into a stored claim. | Full: independent AC subagent BEFORE coding, independent `verifier` after, mutation-proof every new guard, live verification. |
| **2 — ordinary logic** | Application code with no path to a gate or a score: routes, UI wiring, settings, refactors, extraction, transports. | Implement, test, and mutation-prove **the new guard only**. No AC subagent, no verifier. |
| **3 — prose** | `CLAUDE.md`, `.claude/*.md`, comments, copy, commit messages, pure JSON values. | Just make the change. |

**Verifier runs are BATCHED per phase**, not per change — except tier 1, which gets one immediately.
The reason for that exception is measured rather than assumed: every real defect found by review in
the P8.3 build was on a gate path, and the two most expensive (`dimensions.ts` grading on a model
proposal, and two sibling checks left unfiltered) would each have sat in `main` under several more
commits if the verifier had waited for a phase boundary.

**USE `/workspace/eds-claude-skills/scripts/mutate.sh`, NOT A HAND-ROLLED SCRIPT.** Measured on
this repo 2026-09-01: of ~20 hand-run mutations in one lane, **two had anchors that never matched**,
and the inline harness printed `INERT -- the guard did not fire` for both. The mutation never ran, so
nothing was tested; one of the two, re-run correctly, DID fire. The harness has THREE outcomes —
`FIRED` / `INERT` / **`NOT-APPLIED`** — and the third is the whole point, because a two-outcome
script reports "your guard is worthless" when it means "I did nothing". It also refuses an ambiguous
anchor, refuses a dirty file, and ASSERTS the restore against HEAD (a hand-rolled script's timeout
once left a guard DELETED in this repo's source).

**THE ONE STEP THAT IS NEVER SKIPPED, AT ANY TIER: mutation-prove a NEW guard.** Write the guard,
revert the behaviour it guards, confirm the suite FAILS, restore. It costs one command. Three guards
in a single session passed with their defect reinstated and would have shipped as protection that
protected nothing — an inert guard is worse than no guard, because it is believed. Note also that a
mutation can be *behaviourally equivalent* and correctly fail to fail: when that happens, say so and
do not claim the assertion is proven.

Tier 1 is a property of the CODE PATH, not of the change's size. A one-line edit to `checks.ts` is
tier 1; a 200-line settings screen is tier 2.

## Self-attack BEFORE the verifier, and re-verify EVERYTHING every loop (owner-instructed 2026-08-25, tightened 2026-08-29)

Both rules live in full in the org skill `verify-work` (steps **0b** and **0c**). They are mirrored
here because this repo is where they were earned and where the evidence is.

### 0b — find and FIX your own defects before spawning the verifier

**This does not reduce what the verifier checks.** It still re-checks everything, including work you
believe is proven; that redundancy is what catches you being wrong and it stays. What it removes is
the LOOP — implement, verify, the verifier finds bugs you could have found, fix, verify AGAIN. Owner:
*"you just need to attempt to fix the things you find before the validater runs rather than wasting
loops."*

**Measured on `D:owner-edit-offsets-two-frames`** — 27 minutes, 74 tool calls, 228k tokens, four
findings, and **three were plain greps I skipped**. Four checks, seconds each:

1. **Who READS what you wrote?** Grep for a CONSUMER of every new column/field/export, not just the
   writer. *`correction.frame` shipped write-only — the SELECT mapping dropped it, and the field
   being optional on the interface kept `tsc` quiet.*
2. **Can the system PRODUCE your fixture?** Drive the real producer or check against what it emits.
   *Missed twice in one day (VERIFY-30 F4, then the F5 rebuild detector): a guard passed on a
   hand-assigned `applied_seq` ordering the writers never produce, so the defect was still live.*
3. **How many HOMES does the concept have** — and **can the existing parity guard even SEE your
   change?** *A third DDL home was missed, and `H:correction-ddl-parity` compared only the `source`
   domain, so it was structurally blind to a missing column.*
4. **Delete each new load-bearing PRODUCTION line — does a test fail?** *This is the one that
   genuinely needed an independent adversary: deleting a positional check left 840/840 green while
   96 of 1218 tampered documents got spliced.*

### 0c — every loop re-verifies EVERY claim; only DEPTH is tiered

**Coverage is TOTAL on every loop.** Never drop a claim because it passed last loop. Owner,
2026-08-29:

> *"if you don't check something just because it passed it could break from an unrelated fix and you
> wouldn't detect it. That's why it still needs to verify everything but a quicker not necessarily
> cheaper version that doesn't spend as much time as it does in things that just failed and was
> supposedly fixed."*

Never decide depth by asking "could this have been impacted?" — that is a judgement, and judging it
wrong is how a regression ships. **Measured:** the one-line F-1 fix changed what `frameOf` returns
for real rows — the INPUT to five of eight claims plus the safety floor. "Obviously unaffected"
would have been wrong for all but one of them.

| last loop's verdict | on every loop — no row is skipped |
|---|---|
| **Cheap + deterministic** (the suite, a build) | **Re-run ALL of it, every loop.** Seconds. The total-coverage floor under everything. |
| **Previously CONFIRMED** | **Re-checked at reduced depth** — fastest check that would still expose a regression. Faster, never absent; state HOW it was re-confirmed. |
| **Previously REFUTED, now fixed** | **Full re-derivation** (fuzz sweeps, differential runs, schema on a fresh DB, per-guard mutation). This is where the time saved above is spent. |

The loop-2 brief carries a required PRIOR STATE block under a `## VERIFY LOOP` header (`work:` slug +
`loop:` integer). Its field labels are a frozen contract checked literally by `eds-verify-loop.py` on
Stop: `Previously CONFIRMED - RE-CHECKED THIS LOOP`,
`Previously REFUTED / now fixed - FULL RE-DERIVATION`, `Blast radius of the fix`,
`Cheap suite re-run covering EVERYTHING` — ending in
**CHALLENGE THE RADIUS**, the verifier being the check on the implementer's depth allocation being
wrong, so it is handed the reasoning and invited to reject it rather than silently inheriting it.

Two of those fields are read backwards easily. **`Blast radius of the fix` survives with its meaning
INVERTED**: it no longer selects *what* is checked, it selects *where DEPTH is spent* — coverage stays
total regardless of the radius. **`Cheap suite re-run covering EVERYTHING`** is the total-coverage
floor and takes a real command and a real result, not an intention. The old
`Previously CONFIRMED and *not re-derived*…` field is RETIRED and a brief containing that phrase is
now BLOCKED by the checker. Full text of the rule: org skill `verify-work` §0c.

---

## Feasibility BEFORE implementation — the table comes first (strict rule, owner-instructed 2026-08-25)

ACs say what "done" looks like. They do **not** say whether the thing is buildable today, whether it
is **already built**, or whether a stated blocker is **real**. Work kept getting scoped, agreed and
started, then parked hours later when one of those turned out to be false. The owner named it:

> *"we have wasted hours on things you gave the impression of us making progress on only needing to
> be parked several hours if not days later. this stinks of not doing any feasibility testing in
> combination with AC before getting started with implementation."*

**Every AC pass publishes this table FIRST**, above the ACs — one row per dependency the work names:

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|

Verdict is `EXISTS` / `ABSENT` / **`EXISTS-BUT-CONSTRAINED`**. The third is the one that matters:
most false blockers are a constraint on one USE being read as the absence of the thing itself.
`ALREADY BUILT` is a first-class outcome — say it first, then write a regression guard, not a feature.

**"Blocked" / "absent" / "not built" / "there is no X" is the heaviest claim you can make**, and it
needs a sweep of X's **producers AND consumers**. Never sufficient:
- a **single-file grep** — a control defined in an imported component has none of its strings in the
  file that mounts it. Read the import list.
- a **code comment** describing a limitation — that is a claim about the code, not the code. If the
  thing has a writer and a reader, the constraint is about how it may be *used*. Say which.
- **`.claude/actions.md` / `.claude/DEFERRED.md` unchecked** — anything shown to the owner as OPEN
  must be reconciled against them first, and must name its ORIGIN (owner request / SPEC / prototype
  inventory). A row whose origin is "the prototype" is a PROPOSAL and is never something the owner
  is blocking.

Three misses in one session, all the same shape — a claim about what exists, made without tracing
the data. Each cost real hours:

| Claimed | Truth | The one command that would have settled it |
|---|---|---|
| "the term library blocks the keyword chips" | `requirement.model_keyword` had been flowing end to end for months, already rendered on the JD step | `grep -rn model_keyword api/src app/src` |
| "there is no Undo control in the field margin" | mounted there, imported from `QcRail.jsx` | reading the import list of the file being grepped |
| "the reword toggle is blocked on an owner decision" | the owner asked for it, it shipped as **List Tweaks**, and `actions.md` recorded it | `grep -rniE reword .claude/actions.md` |

Enforced by the Stop gate as requirement **(h)** (`eds-claude-skills/setup.sh`, `_eds_version` 11+),
deliberately separate from the integration trace **(g)**: **(g) asks what the change AFFECTS, (h)
asks whether what the work PRESUMES actually exists.**

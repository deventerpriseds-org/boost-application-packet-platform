# Session Handoff — Executive Engine (boost-application-packet-platform)

Orientation for a new session. `CLAUDE.md` (auto-loaded) is the authority; this file is the
fast map + operating procedure. Read `CLAUDE.md`, `.claude/memory.md`, `.claude/actions.md`
before touching code.

## What the app is
Executive Engine — a job-application platform. Product = the React/Vite SPA in `app/`
(Static Web App `executive-engine-web`, https://purple-ground-0f377120f.7.azurestaticapps.net/)
backed by the Azure Functions API in `api/` (`job-platform-api`). Postgres `boost_resume_n_packet_builder`.
Production owner: `von.ellis@enterpriseds.io` (`demo@executive-engine.local` = shared sandbox).

## Repo map (the files we actually use)
- `api/src/functions/tests/` — **production backend** despite the folder name. Azure Functions v4
  (`app.http(...)`). Key: `appPackets.ts` (packets/artifacts + resume generate/doc/ai-edit),
  `mailWatch.ts` (intake `routeOpportunity`→`insertOpp`), `jdSearch.ts`/`jdSweep.ts` (scheduled search),
  `roleTaxonomy.ts` (role→favorite matcher), `pipeline.ts`+`mt17.ts`+`resumeParser.ts` (3-agent package),
  `packetTemplates.ts` (Google Doc template copy+fill), `appSession.ts` (`resolveOwner`/`requireWrite`),
  `diag*.ts` (read-only diagnostics).
- `app/src/` — SPA. `screens/` (OppDetail.jsx etc.), `api.js` (client; `get/post` funnel through
  `authedFetch`), `theme.css` + `tokens/` (the `.px-*` design system — cards `.px-box`, `.px-label`,
  inputs `.px-input`, buttons `.px-btn*`; colors ONLY via CSS vars), `state.jsx`/`data.jsx`/`shell.jsx`.
  Tabs inside a screen are internal state, not hash routes.
- `.github/workflows/` — the live-access + deploy loops (below).
- `.claude/` — `memory.md` (durable log), `actions.md` (AC/action tracker), this file.

## The sandbox CANNOT reach Azure/Postgres — use GitHub Actions loops
Egress blocks `*.azurewebsites.net`, `*.azurestaticapps.net`, and Postgres. So:
- **DB read/write** → `db-query.yml` (workflow_dispatch, `sql` input). Default owner data is under von.ellis.
- **Authed API call** → `api-test.yml` (`method`/`path`/`body` inputs; it mints a verified session token;
  put `?owner=von.ellis@enterpriseds.io` in the path for owner-scoped routes).
- **Live UI render check** → `ui-verify.yml` (Playwright on a GH runner; `route`/`owner`/`expect` inputs).
  Only works for hash-addressable routes; seeds `localStorage.ee_auth_user` then reloads. Can't reach
  internal-state tabs without a click.
- Loop pattern: trigger → `actions_list` for the run id → `list_workflow_jobs` → `get_job_logs`
  (`return_content:true`). `actions_list` output is huge — it saves to a file; read run ids with `jq`.
- **Verify-before-reporting**: a 204/queued is NOT success. Read the job LOGS. Say "cannot confirm" if you
  can't, and name what would confirm it.

## Deploy + git flow
- Push `api/**` to `main` → `api-deploy.yml` (a NEW route needs ~90–120s worker converge before it stops 404ing).
- Push `app/**` (to main OR the feature branch) → `executive-engine-deploy.yml` (deploys from either).
- **Branch discipline (HARD RULE):** develop on the session's feature branch (`claude/git-push-main-1zcqw5`
  unless told otherwise). NEVER commit to `main` directly; `main` only fast-forwards from the branch.
  Sync at start (`git merge origin/main`), FF `main` at end.
- **Stop hook** warns on unpushed commits — always `git push -u origin <branch>` before ending. Commit +
  push every completed unit; the container is ephemeral (a restart wipes uncommitted work).

## Mandatory workflow (EDS skills — use proactively)
1. `/define-acceptance-criteria` at the start of any non-trivial task → verifiable ACs, get sign-off first.
2. Implement (batch it — see efficiency).
3. `/verify-work` before claiming done → spawns the independent **`verifier`** agent (proves/disproves from
   observable evidence only; "should work" is banned).
4. `track-actions`: surface open `ACT-N` items from `actions.md` at start; update statuses as you go.
5. `remember`: read `memory.md` at start; append durable facts + commit at end.
- Skills live in `deventerpriseds-org/eds-claude-skills` (auto-load via a repo clone). If a container
  restart left the clone missing, follow the workflow manually / re-clone.

## Efficiency rules (the owner cares about this)
- Investigate with subagents (Explore / general-purpose) and run independent tool calls in parallel.
- Build ONCE, deploy ONCE, verify ONCE — don't piecemeal into multiple deploys.
- Don't tight-loop poll; size a single background wait to the actual work (deploy ~2min, Luna call ~seconds).
- Ground-truth before answering (strict rule): check the RIGHT source, seek disconfirming evidence,
  separate Observation from Interpretation, calibrate words to proof.

## AI/model facts
AI features call **`gpt-5.6-luna`** via the OpenAI **Responses API** (`POST /v1/responses`) with the existing
`OPENAI_API_KEY`. Effort `low|medium|high|max` (default medium) as `reasoning:{effort,summary:'auto'}`,
gated on a reasoning model; `service_tier:'priority'` for luna. Full spec + the `extractText` shape are in
`memory.md`. Reuse this pattern for any new AI call — don't reinvent.

## State as of this handoff
- Resume tab overhaul shipped (labeled all-sections preview, inline + Luna AI edit w/ effort picker,
  auto-refresh, empty-section fix) — backend verified live; rendered UI is owner's eyeball check.
- Director-favorite taxonomy fix shipped + retagged. `/diag/doc-structure` added (proved the resume-doc
  "distortion" is the mobile browser, not the generator).
- See `memory.md` (latest entries) + `actions.md` (ACT-23) for specifics.

# Project Memory — boost-application-packet-platform
Last updated: 2026-07-22

## Purpose & goals
Executive Engine: AI-powered job application platform for executive-level job seekers.
Automates LinkedIn alert intake, opportunity enrichment, packet building (resume+video+cover),
outreach cadences, interview prep, and offer analysis. Single-tenant, owner-scoped.
Production owner: von.ellis@enterpriseds.io

## Architecture
- **Frontend:** React/Vite SWA — `app/src/` — deployed to `executive-engine-web` (Azure Static Web App)
  Live: https://purple-ground-0f377120f.7.azurestaticapps.net/
- **Backend:** Azure Functions Node 22 — `api/src/` — `job-platform-api.azurewebsites.net`
  All app routes: `/api/app/...` (NOT `/api/opp/...`)
- **Database:** PostgreSQL on Azure — `boost_resume_n_packet_builder` db
  Accessed from Functions only; CCR sandbox cannot reach it directly
- **Auth:** Microsoft MSAL (frontend) + service principal (backend/CI)
  Graph subscription watches von.ellis@enterpriseds.io inbox for LinkedIn alerts
- **Infra:** Azure (eastus) — resource group EnterpriseDS_ResourceGRP
- **Deploy:** GitHub Actions — `executive-engine-deploy.yml` triggers on main + feature branch

## Schema snapshot
Key tables (PostgreSQL):
- `opportunity` — id, owner, title, company, stage, jd_url, match_score, created_at, enriched_at
  Stages: discovered → saved → enriched → applied → outreach → engaged → screen → r1 → panel → final → offer
- `contact` — id, opp_id, name, title, email, linkedin_url, enriched_at
- `packet` — id, opp_id, type, artifact_url, created_at
- `outreach` — id, opp_id, contact_id, channel, status, sent_at, cadence_step
- `coach_thread` — id, owner, opp_id, messages (jsonb), created_at
- `coach_memory` — pgvector embeddings for long-term coach context
- `mail_watch_config` — owner_email, subscription_id, expiration_datetime
- `ats_source` — id, owner, platform (greenhouse/lever/ashby), board_key, label, active

## Integrations
| Service | Purpose | Status | Key config |
|---|---|---|---|
| Microsoft Graph | LinkedIn alert intake via mail subscription | active | Subscription ID 56e3b60c-..., expires ~daily, auto-renews |
| OpenAI | Enrichment, coach, JD analysis | active | OPENAI_API_KEY in GH secrets |
| HeyGen | Avatar video generation for packets | active | HEYGEN_API_KEY, clone avatar + voice IDs in secrets |
| ElevenLabs | Voice call (barge-in conversational AI) | active | ELEVENLABS_API_KEY, AGENT_ID in secrets |
| Google Drive/Docs/Slides | Packet document templates | active | GOOGLE_REFRESH_TOKEN (not in deploy workflow — set directly on Function App) |
| Tavily | Web search for coach | active | TAVILY_API_KEY in secrets |
| ATS (Greenhouse/Lever/Ashby) | Job board ingestion | backend ready, no boards configured | Routes: GET/POST /api/app/ats/sources, POST /api/app/ats/ingest |

## Key decisions
- [2026-07] FRESH_STAGES = ['discovered','saved','enriched'] — unified constant replacing NEW_STAGES/SCRUB_STAGES split that caused Today KPI to show 0
- [2026-07] personaKey removed from context — PERSONAS feature removed; useOpportunities called with undefined (no filter)
- [2026-07] Graph subscription route is /api/mail/... NOT /api/app/mail/... — different prefix from app routes
- [2026-07] Mail watch subscription watched in InboxScrubHero; lastChecked timestamp shown, expiry countdown shown
- [2026-07] No dead UI rule: every button must be wired; stubs banned; hide controls that aren't ready
- [2026-07-21] **Mail intake insert bug class**: the opportunity INSERT in `mailWatch.ts` builds SQL
  placeholders + a conditional param array by hand. Adding a column (source_date) misaligned them and
  Postgres threw `could not determine data type of parameter $N`. Any future column add here MUST keep
  placeholders and the param array in lockstep — see the comment block above the INSERT.
- [2026-07-21] **Job-alert detection keys off SENDER, not just subject phrases.** LinkedIn alerts use
  "{Role} at {Company}" subjects. `isAlert()` matches configured phrases OR job-alert sender addresses
  (`jobalerts-noreply@`, `jobs-noreply@`, `jobalert.indeed.com`); excludes `messages-noreply@`.
- [2026-07-21] **Webhook owner = canonical config** where `owner_email = mailbox` (NOT newest updated_at).
  A demo config pointed at the real mailbox used to hijack ingestion under the demo owner.
- [2026-07-21] **DECIDED (ACT-17): multi-source intake = ONE mailbox-wide Graph subscription**
  (`users/{id}/messages`, not inbox-only), route by `parentFolderId` → `folder_role_map` → role.
  All streams (inbox, folders, ATS) funnel through one `routeOpportunity()` for dedup + role mapping.
  Additive only (new tables via `create table if not exists`; broaden subscription resource; no drops).
- [2026-07-22] **Seniority-tier mailbox routing (ACT-18).** Each Job Alerts source (Indeed, Ladders,
  Lensa, LinkedIn) has C Suite / VP & Head of / Director subfolders; folder IDs live in the new
  `seniority_routing` table. Classifier: `extractRole()` strips the Indeed/LinkedIn digest trailing
  label ("…is hiring for {ROLE}. N more {term} jobs") THEN `seniorityTier()` ranks C-Suite >
  VP/Head-of/Executive > Director. Tiering: chief/deputy-chief/president/founder/C*-acronym → C Suite;
  VP/SVP/EVP/AVP/Head of/executive → VP; director → Director; else stays in parent source folder.
- [2026-07-22] **Reconcile is the backstop for approximate Outlook rules.** Forward inbox rules can
  only do literal `subjectContains` keyword matching (no digest-role extraction), so they mis-file
  digests like "…Program Manager. 3 more Deputy CIO jobs" (trips "CIO"). `mailReconcileTimer` (every
  2h) + `POST /api/mail/reconcile` re-audit each folder with the PRECISE classifier and correct
  mis-sorts. Never expect the Outlook rules alone to be exact — they're a delivery-time first pass.
- [2026-07-22] **Rule ordering:** `build-seniority` creates the 12 tier rules at sequences 1–12 with
  `stopProcessingRules`, ahead of the pre-existing parent sender rules (Indeed seq16, Lensa seq17),
  so a tier match wins and stops; non-tier mail falls through to the parent rule. LinkedIn/Ladders
  have NO parent catch-all rule yet (follow-up). Old "LinkedIn Job Alerts" rule (seq21) is an empty
  no-op — delete or rebuild as the LinkedIn parent catch-all.

## Feature status
| Feature | Status | Notes |
|---|---|---|
| LinkedIn alert intake (Graph subscription) | done | Auto-renews (mailRenew, 30-min timer); healthy |
| Mail intake insert + filter + owner | fixed 2026-07-21 | 3 bugs: `$7` INSERT misalign (6826310), isAlert ignored sender (d02c1a2), webhook owner picked demo config (1488d3c). Was frozen at 218 for 7 days; now 298. |
| Today screen KPI + InboxScrubHero | done | "0 new today" was ACCURATE — intake was dead, not a UI bug. FRESH_STAGES unified. |
| Multi-source ingest router (folders+inbox+ATS) | done (ACT-17, 2026-07-22) | `routeOpportunity()` hub: all 3 paths (mail, ATS, extension) route through it. Mailbox-wide Graph sub (verified `users/{mailbox}/messages`), folder_role_map consulted via parentFolderId + skip_filter bypass, folder→role UI live in Settings. Only ATS scheduler timer remains (manual-only). |
| Seniority-tier mailbox routing (ACT-18) | done | Folders + backfill (~5,700 sorted) + reconcile timer + 12 forward keyword rules (all ok). Limitations: rules approximate (reconcile corrects), no LinkedIn/Ladders parent catch-all rule, old empty LinkedIn rule still present. |
| Opportunity enrichment | done | POST /api/app/opportunity/:id/enrich |
| Packet builder (resume+video+cover) | done | HeyGen render + Google Docs template fill |
| Outreach cadences + Composer | done | |
| Coach chat + voice call | done | pgvector memory, Tavily search, ElevenLabs barge-in |
| ATS ingestion (Greenhouse/Lever/Ashby) | backend done, UI not wired | Settings Intake tab needs ATS Sources panel |
| OppDetail: undefined% match display | open | Shows "undefined%" when match is null — fix pending |
| Library Roles tab crash (setPersonaKey) | open | personaKey removed but crash path remains |
| Intake/Settings demo-mode guard | open | Fires API calls unconditionally; errors in demo mode |
| Packets/Outreach empty-state nav links | open | Need clickable links to Opportunities |
| Design config applet + verifier agent | done (skill repo) | eds-claude-skills updated |

## Known issues & gotchas
- esbuild smart-quote bug: Edit tool inserts curly quotes into JSX; run sed fix after every JSX edit
- CCR sandbox cannot reach azurewebsites.net directly — use api-test.yml workflow for API calls
- CCR sandbox cannot reach PostgreSQL — use db-query.yml workflow for DB queries
- GOOGLE_REFRESH_TOKEN and GOOGLE_SERVICE_ACCOUNT_JSON are set directly on Function App, NOT in api-deploy.yml
- Graph subscription expiration: renews via mailRenew (30-min timer); healthy even if inbox quiet
- **DIAGNOSIS DISCIPLINE**: "a count that hasn't changed in days" = data-freshness signal. Check
  `max(created_at)` in the DB BEFORE assuming a UI/KPI bug. In 2026-07-21 the "app shows 0" was dead
  intake (3 stacked bugs), not the frontend — chasing the UI first wasted the loop.
- Mail INSERT param bug: placeholders in `mailWatch.ts` are hand-aligned with a conditional array;
  adding a column silently misaligns → `could not determine data type of parameter $N`. Keep in lockstep.
- ATS ingestion has NO scheduler timer — `atsIngest` is a manual POST route; 0 sources configured.
- Two configs can watch the same mailbox; webhook picks `owner_email = mailbox` (canonical), not newest.
- Mail routes: /api/mail/... NOT /api/app/mail/... (no /app/ prefix)
- Android native testing: requires BrowserStack App Automate; CCR cannot run AVD (no KVM)
- iOS testing: requires macOS runner or BrowserStack; categorically unavailable in Linux CCR

## Active work
Current task: ACT-18 seniority routing DONE (folders + backfill + reconcile + 12 forward rules,
  all verified live via api-test.yml). Next up: unify with ACT-17 router.
Files in flight: none pending; all mail endpoints committed db2465b → 104b437 (all on main).
Blocker: none.
Next step (per user "unify after the rules"): fold the seniority double-check into the ACT-17
  `routeOpportunity()` hub instead of running two parallel classifiers. Three input paths to unify:
  (1) role-mapped folders → route by parentFolderId, (2) general inbox → sender+keyword,
  (3) job boards/ATS → Greenhouse/Lever/Ashby. Then close ACT-18 follow-ups: add LinkedIn/Ladders
  parent catch-all rules, delete/rebuild the empty "LinkedIn Job Alerts" rule, delete EDS-Rule-Test folder.
Design locked: one mailbox-wide Graph subscription, route by parentFolderId. No destructive migrations.

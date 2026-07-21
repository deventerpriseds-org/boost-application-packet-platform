# Project Memory — boost-application-packet-platform
Last updated: 2026-07-21

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

## Feature status
| Feature | Status | Notes |
|---|---|---|
| LinkedIn alert intake (Graph subscription) | done | Auto-renews daily; last checked subscription healthy |
| Today screen KPI + InboxScrubHero | done | Timestamp + expiry countdown; FRESH_STAGES unified |
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
- Graph subscription expiration: renews ~daily via Function; if inbox quiet for days, subscription is still healthy
- Mail routes: /api/mail/... NOT /api/app/mail/... (no /app/ prefix)
- Android native testing: requires BrowserStack App Automate; CCR cannot run AVD (no KVM)
- iOS testing: requires macOS runner or BrowserStack; categorically unavailable in Linux CCR

## Active work
Current task: none — session wrapping up
Files in flight: none
Blocker: none
Next step: Resume plan fixes (OppDetail match, Library crash, Settings demo guard, empty states) or ATS Sources UI wiring

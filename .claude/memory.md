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
| Role taxonomy Phase 1 (3-level + favorites) | backend verified live; UI unverified-from-sandbox (2026-07-29) | roleTaxonomy.ts (3 groups/27 roles/868 titles nested under csuite/vp/director), matcher exact→alias→fuzzy→keyword, COO/Director inclusion gates, +15/cap100. appRoleTaxonomy.ts (per-user editable taxonomy_title, retag backfill, add-title/set-tier endpoints). Favorites-first sort + gold star (FavStar) in Opportunities + Swipe; group pills; Today roleFamily prefers matchedRole. **Live DB evidence (von.ellis): 218 favorites, 330 matched_role, 0 scores>100, boost math exact (0 mismatch, 0 non-fav changed), 651 seeded titles, 3 groups.** UI DOM (gold star/pills/sort render) UNVERIFIED — sandbox egress blocks *.azurestaticapps.net (403); needs user browser or Playwright-in-GHA. Phase 2 deferred: standalone #/roles editor, drafts/publish, folder-binding rebuild, bulk tier UI, off-tier seeding. |

## Auth / write-protection model (ACT-19, 2026-07-22)
- `app/*` routes are `authLevel:'anonymous'` with a `?owner=` fallback. **Writes are now gated**:
  `appSession.requireWrite(req)` allows a mutation only if verified (session token) OR owner is the
  demo workspace (`demo@executive-engine.local`). Applied to 54 handlers. Reads stay open by `?owner=`.
- **Programmatic auth WITHOUT OAuth** (do not break this): two paths — (1) `X-UAT-Token` header ==
  `UAT_BYPASS_TOKEN` env → verified, owner = `?owner` || `UAT_USER` (org convention from eds verifier;
  UAT_BYPASS_TOKEN is an org secret, now synced via api-deploy.yml). (2) `api-test.yml` MINTS a session
  token from the app signing secret (MICROSOFT_CLIENT_SECRET==AZURE_CLIENT_SECRET; SESSION_SIGNING_SECRET
  unset) — so all automated tests authenticate. Never remove these or testing/verifier breaks.
- Left open by design: `mailNotify` (Graph webhook), timers, ALL reads, `appCapture` (extension uses body.owner).
- **Errors:** genuine exceptions return 500 (not 200-with-error) via the 69 hardened catch blocks; business/validation stays 400/404.

## Known issues & gotchas
- esbuild smart-quote bug: Edit tool inserts curly quotes into JSX; run sed fix after every JSX edit
- CCR sandbox cannot reach azurewebsites.net directly — use api-test.yml workflow for API calls
- CCR sandbox cannot reach PostgreSQL — use db-query.yml workflow for DB queries
- GOOGLE_REFRESH_TOKEN and GOOGLE_SERVICE_ACCOUNT_JSON are set directly on Function App, NOT in api-deploy.yml
- Graph subscription expiration: renews via mailRenew (30-min timer); healthy even if inbox quiet
- **DIAGNOSIS DISCIPLINE**: "a count that hasn't changed in days" = data-freshness signal. Check
  `max(created_at)` in the DB BEFORE assuming a UI/KPI bug. In 2026-07-21 the "app shows 0" was dead
  intake (3 stacked bugs), not the frontend — chasing the UI first wasted the loop.

## Role systems — TWO exist, must unify (2026-07-29, ACT-21)
- **System A (legacy persona):** `persona` table (CTO/VPE/VPP demo seed), `opportunity.roles_for[]`/`persona_key`, `/app/personas*` endpoints, `tagOppRoles()` LLM classifier, Settings ▸ Roles UI (Settings.jsx RolesSettings), `folder_role_map.role_key` = persona key, Pipeline.jsx filter. Mostly vestigial demo data (roles_for empty on real rows).
- **System B (new taxonomy, Phase 1):** `taxonomy_title` table (27 roles/868 titles), `opportunity.matched_group/matched_role/matched_variation/title_tier/is_favorite/base_score`, `/app/taxonomy*`, `resolveTitle()` matcher, drives Today/Opportunities/Swipe pills + `roleFamily()`.
- **They are disconnected** — neither writes the other's columns. Settings ▸ Roles + folder_role_map + Intake use System A; inbox scrub + opps/swipe filters use System B. This is the "black box / leak" the user hit.
- **Classification bugs (proven):** ingest tags on `o.role` (mailWatch.ts:280) but retag tags on `jd_title||role` (appRoleTaxonomy.ts:68); `jd_title` is unreliable (diverges from role) → wrong bins. `normalize()` cuts at first comma (roleTaxonomy.ts:126) → "VP, Product Management" becomes "vp". FIX: classify on `role` consistently; stop cutting at commas.
- **Target end state:** ONE role source = the taxonomy. Settings ▸ Roles shows taxonomy roles (editable), folder→role map offers taxonomy roles, classification on `role` at ingest+retag, all consumers (incl. Pipeline.jsx) read matched_*.

## CRITICAL known issue — fabricated JD content (ACT-22, 2026-07-29)
- **The job-description content shown in the app is LLM-fabricated, not extracted.** LinkedIn
  alert emails are digests (subject=headline job; body=~6 one-line job snippets + links, no JD
  body). `insertOpp` stores the whole digest as each opp's `raw_jd`; `runJdParse` (appJdParse.ts)
  only URL-fetches the real posting when `raw_jd` is empty (line 109) — never for digests — so it
  fabricates jd_summary/jd_requirements/jd_table from a one-line snippet. PROVEN: 738/738 have a
  jd_summary; 525 raw_jds are the digest; max raw_jd = 3,825 chars (no real JD anywhere).
- **Field authority (proven via the raw email):** `role`/`company` = correct per-job values
  (parseAlert extracts each digest job); `jd_title`/`jd_company` = digest HEADLINE (wrong for
  non-headline siblings — "headline collapse"). So classification/display should use role/company,
  NOT jd_title. (My earlier flip-flop on FALCON was from not reading the primary source — the rule.)
- **Real per-opp data:** company, per-job title, location, comp, job URL. Everything richer is
  fabricated. Packet ATS keywords + JD-based match scoring inherit the fabrication.
- Open: research a real JD fetch from the per-job link (LinkedIn auth-gated) — ACT-22a.

## Process discipline
- **GROUND-TRUTH BEFORE ANSWERING (strict, 2026-07-29):** for any "which is right/wrong / what's
  happening / is X true" question, name the single PRIMARY source that proves it and read THAT — not
  a proxy. Comparing two derived fields shows they differ, not which is correct; never fill that gap
  with an assumption. Seek disconfirming evidence for your own hypothesis. Say "proven/confirmed"
  ONLY after reading ground truth; else label "inference (confidence X) — confirmed by <source>".
  No "Recommended" on an ungrounded fact. Separate Observation vs Interpretation. (Failure that
  spawned this: claimed `role` correct / `jd_title` wrong from a field-diff query; the JD/email
  subject proved the opposite — `role`/`company` are the corrupted fields.)
- **EXTEND, DON'T DUPLICATE (strict, 2026-07-29):** before building any new table/model/endpoint/
  classifier/subsystem, grep for an existing system serving that purpose and EXTEND it. Never build
  a parallel system. Treat "add X" as "find what already does X and extend it." New structure needs
  explicit sign-off (state what exists + why insufficient). (Failure: built taxonomy_title parallel
  to the persona/folder_role_map role system.)
- **AC TRIAGE (standing rule, 2026-07-28):** the `define-acceptance-criteria` subagent is intentionally
  exhaustive and adversarial — its raw output is a DRAFT, not the final AC set. Before presenting for
  sign-off, the main agent MUST review every suggested AC and label each: **fold** (merge duplicates /
  near-duplicates into one), **already covered** (an existing AC or existing behavior/test proves it),
  **redundant** (restates another AC), **out of scope** (Phase 2 / not this task — move to a deferred
  list), or **keep** (genuinely valuable, distinct, verifiable). Present the CONSOLIDATED set with the
  triage rationale, not the unfiltered dump. Never blindly accept or blindly build all of them. The
  verifier later runs against the consolidated, signed-off set.
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

## JD anti-fabrication + real-JD backfill (session 2026-07-29) — SOLVED
**Problem:** JDs were fabricated. Root cause: `ingestMessageId` (mailWatch) stripped ALL HTML tags —
including `<a href=".../jobs/view/{jobId}">` — BEFORE parsing, so 722/723 opps had no link and the
summary parser hallucinated from the digest headline. Confirmed via DB: 0/326 unlinked opps had a
URL in why_surfaced OR raw_jd — genuinely destroyed at ingest; no DB shortcut possible.

**Provider verdict (all ground-truthed live from Azure /api/mail/jd-probe):**
- scrape.do — WORKS on LinkedIn guest endpoint (jobs-guest/jobs/api/jobPosting/{id}). 200, real JD.
  CHEAP mode (super=false, ~1 credit) returns the SAME JD as super proxy — use cheap. Secret: scrape_do_api_key.
- ScraperAPI — 403 at EVERY tier (plain/premium/ultra_premium): LinkedIn is a paid-domain gate. OUT.
- Firecrawl — 403 "we do not support this site" — hard policy block on LinkedIn. OUT.
- Provider-agnostic layer: scraperProxy.ts (SCRAPER_API_PROVIDER + per-provider keys). classifyResponse()
  treats a 200 block-page as blocked (status alone lies). jd_fetch_log table logs every attempt
  (outcome/latency/concurrency/runTag) for rate measurement.

**The fix (all live):**
- INGEST (self-healing): mailWatch keeps `{{JOB:id}}` markers before stripping tags; parseAlert binds
  jobId per role; insertOpp stores job_id + canonical job_url. NEW favorites link ~100% automatically.
- appJdParse now prefers `jd_real` over the digest text → grounds the summary, no fabrication.
- Fetch: /api/mail/jd-backfill/fetch — scrape.do cheap-mode, escalate-to-super on block, concurrency+
  delayMs paced, stop-on-block, stores jd_real+jd_fetched_at, logs to jd_fetch_log. Proven 10/10 ok_jd.

**Historical linking backfill (ONE-TIME, done): /api/mail/jd-backfill/scan {llm:true, beforeIso cursor}**
- LLM-free anchor match FAILED (this email format keeps title/company in separate table cells, not near
  the href — anchor inner text is empty). Needed the LLM to read the whole email.
- Two flaws found by measuring (NOT guessing): (1) exact company+role match failed ~85% → fixed with
  pgvector nearest-neighbour fallback (embedBatch, dist<0.20) — SAME dedupe insertOpp uses.
  (2) re-treading already-linked newest emails → fixed with beforeIso cursor paging.
- 504 root cause was the per-opp embed calls tripping OpenAI 429; backoff stacked inside one email past
  the time budget. Fixed: embedBatch() = ONE embeddings call per email (array input); openaiFetch() 429
  backoff on all OpenAI paths; per-email 160s time budget returns a cursor cleanly (no 504).
- RESULT: linked 219→449 (14d window); FAVORITES 54→128 of 161 (80%). Remaining ~107 unlinked are the
  non-linkable tail (13 non-LinkedIn + embedding-miss). scan/probe endpoints are throwaway history tooling.

**Process lesson (user called it out, correctly):** I thrashed — tweaked symptoms (batch size, timers)
without root-causing, and wasted cycles re-scanning already-linked emails. Fix was to MEASURE (read the
batch's linked/alreadyHad numbers) and to investigate the DATA (query what's actually in the rows) BEFORE
writing code. "Ground-truth before answering" applies to debugging too.

**Chrome extension is the real long-term ingest path (user: "always part of the plan"):**
- ALREADY BUILT (repo `extension/`, manifest v3): content.js grabs the LOGGED-IN page innerText,
  popup.js POSTs to /api/app/capture → routeOpportunity (same pipeline), source='Extension', stores
  page text as raw_jd. Uses the logged-in page → different/better results than email alerts, AND
  bypasses scrape.do + LinkedIn rate limits entirely (user is the authenticated browser).
- REMAINING TWEAKS to make it the JD source: appCapture should (1) capture jobId from the page URL
  (jdLinks.jobIdFromUrl) and (2) store the captured text as jd_real (not just raw_jd) so it counts as
  a real JD and feeds the summary parse. Extension already sends url+text; just wire the backend.

## Open follow-ups (JD system)
- Build a SCHEDULED timer (Azure Functions timer trigger) that fetches jd_real for NEW linked favorites
  daily — so it's set-and-forget, not manual. Not built yet.
- Build the Chrome extension + the two appCapture tweaks (jobId from URL, store as jd_real).
- Optional: paced scrape.do sweep of the 118 pending favorites to (a) fill real JDs now, (b) empirically
  find LinkedIn's block threshold from jd_fetch_log. Not yet run at volume.

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

## DECISIVE: direct-from-Azure fetch WORKS — no proxy/credits needed (2026-07-30)
Forced `via=direct` probe + volume test: LinkedIn's guest endpoint (jobs-guest/.../jobPosting/{id})
serves Azure's datacenter IP CLEAN. 108 direct requests (concurrency 1, ~2s apart), ALL ok_jd, ZERO
blocks/429/999. So the "LinkedIn blacklists datacenter IPs" premise is FALSE for THIS endpoint at this
volume. The whole scrape.do/credit saga was unnecessary.
- scrape.do free tier is TINY: ~33 requests exhausted it (401 "Monthly request limit exceeded" — an
  ACCOUNT error, not per-job login, not rate limit). Verified I did NOT overuse super (75 reqs, only 1
  super). A general scraping-API's free tier won't sustain our volume regardless.
- jd-backfill/fetch now supports: `direct:true` (Azure egress, no proxy/credits, default going forward),
  retry-through-fresh-IP on genuine blocks (scrape.do auto-rotates exit IP per request), and
  quota_exceeded detection (halts, never marks jobs). classifyResponse: 401/403 target=auth_required
  (per-job skip), scrape.do account 401=quota_exceeded, 429/999=blocked.
- RESULT: 130/164 favorites now have REAL JDs (jd_real), 0 pending. Remaining 34 = no LinkedIn jobId
  (non-LinkedIn source or genuine login-only) → Chrome-extension territory.

**Egress/IP contingency (NOT needed now, held in reserve):** if direct ever gets blocked at volume,
the fix is Azure-native + ISOLATED so it never touches the shared Function IP that Graph/OpenAI/PG use:
a dedicated egress just for LinkedIn — NAT Gateway + swappable Public IP (or Public IP Prefix to
rotate) on a segregated subnet, OR a tiny ACI/VM fetcher with its own disposable public IP (redeploy =
new IP). The scraperProxy module already abstracts transport (direct|scrapedo|byoproxy|dedicated-egress),
so switching is a one-line change with zero impact on other dependencies. BYO residential proxy
(Webshare/DataImpulse ~$1/GB, no credit-multiplier "LinkedIn premium tax") is the non-Azure alternative.
LLM-feedback verdict: its premium-tax explanation of scrape.do's burn was credible; its datacenter-IP-
blacklist premise was empirically FALSE for this endpoint; its BYO-proxy idea is sound but its 1-2/mo
volume assumption was wrong (ours is ~97 backfill + daily).

## EMPIRICAL: LinkedIn guest-endpoint per-IP rate limit FOUND (2026-07-30)
The undocumented limit, ground-truthed via burst test (jd_fetch_log run_tag=burst-test-1):
- Burst (concurrency 15, delayMs 0, direct from Azure): 30×HTTP-200 then 15×HTTP-429. Genuine 429
  Too Many Requests → per-IP RATE limit ≈ ~30 rapid requests, NOT a volume cap.
- Paced (1 req / 2s, direct): 108 requests, ZERO 429s. Spacing avoids the limit entirely.
=> Steady-state (paced daily timer, deduped by jd_fetched_at, ~10-50/day spread out) never approaches
   the limit on ONE Azure region — free, no infra. Multi-region only raises BURST throughput
   (N regions ≈ N×30 rapid), i.e. buys SPEED for bulk blasts, not sustainability. Not needed for daily.
Recommendation: build a paced daily fetch timer + retry-on-429-backoff (direct). Hold multi-region
rotation as a ready-to-flip contingency behind scraperProxy (add only if a fast bulk run is ever wanted).

## LinkedIn exec-role SEARCH ingestion (scheduled 3x/day) — DONE (2026-07-30)
New discovery source beyond email (jdSearch.ts): LinkedIn public guest SEARCH endpoint
seeMoreJobPostings/search with f_E=5,6 (Director+Executive) + f_TPR recency, per the user's roles.
- Role keywords: taxonomy_title tier='fav' distinct role -> persona master_role -> SEED.roles.
- parseSearchCards() extracts {jobId(urn:li:jobPosting), title, company, location, postedDate} per card.
- Routes each via the SAME routeOpportunity pipeline (dedup + role-tag + jobId/url capture), source
  'LinkedIn Search'. Only DISCOVERS+inserts; real JD filled by the paced direct jd-backfill/fetch.
- Direct-from-Azure, hardened (scraperProxy now rotates a UA pool + sends Referer/Sec-Fetch/
  Upgrade-Insecure-Requests) + jittered (sleepJitter). Stops a role on block; halts run after 3
  consecutive blocks. VERIFIED live: 3 roles -> 30 cards -> 22 inserted (all with job_id), 8 dedup, 0 blocked.
- POST /api/mail/jd-search manual trigger {tpr,location,pages,roleLimit}.
- TIMER jdSearchTimer: cron '0 0 9,10,17,18,22,23 * * *' (UTC hours bracketing ET), handler gates to
  ET hour in {5,13,18} via Intl America/New_York → DST-safe, 5am/1pm/6pm ET, NO WEBSITE_TIME_ZONE needed.
- NOTE: role keywords are taxonomy GROUP/role names ("Data, Analytics & AI") — generic but returned
  ~10 cards/role. Future refinement: search specific favorite TITLES for tighter targeting.
- Diag: POST /api/diag/tavily (Tavily extract/search) added to beat bot-403s during research.

## JD backfill — FINAL decision (2026-07-30, user directive)
Favorites backfill is DONE (130/164 real jd_real; remainder are not_found/expired postings — nothing
more to recover). User decided NOT to backfill non-favorites backward: "not sure it's worth grabbing
anything but my favorites looking backwards... we can capture non favorites from here... but probably
not with the effort to go backwards." So:
- DO NOT re-run the ~319 non-favorite backward sweep. That decision is deliberate, not an oversight.
- Non-favorites are captured GOING FORWARD automatically: both email ingest (injectJobMarkers) and
  scheduled jd-search capture job_id/job_url at insert; paced direct jd-backfill/fetch fills jd_real.
- The backward historical sweep is considered CLOSED.

## Unified JD pipeline (the settled operating model)
- Discovery: (a) email ingest, (b) scheduled exec-role search 5am/1pm/6pm ET → both → routeOpportunity.
- JD-fetch: paced direct-from-Azure (1 req/~2s + 40% jitter, dedup by jobId, rotating UA + LinkedIn
  Referer/Sec-Fetch headers). quota_exceeded halts; auth_required/not_found marked-skipped.
- Rate-safety: measured wall ~30 rapid req/IP → 429; pacing keeps us an order of magnitude under
  <100/day load. Residential proxy stays in reserve behind scraperProxy. NO multi-region (shares
  datacenter TLS fingerprint; solves nothing pacing doesn't).
- Search-term granularity (when wiring schedule for real): role-level, OR-concatenated favorite title
  variants (keywords='("VP Data" OR "Head of Analytics" OR ...)') to minimize searches while keeping
  recall. Group-level too broad; title-level too many searches.
- Location: switch from string 'United States' to verified US geoId 103644278 (Medium/Khan insight:
  country-name search is unreliable). Fold in with search-schedule work.
- Tavily one-offs: prefer a GH-runner curl with ${{ secrets.TAVILY_API_KEY }} to api.tavily.com/extract
  over deploying a Function endpoint (simpler/faster for research). diag/tavily kept for in-app use.

## Two new discovery/fetch features — SHIPPED + live-verified (2026-07-30)
### 1. Scheduled LinkedIn exec-role SEARCH (jdSearch.ts) — 3x/day 5am/1pm/6pm ET
See prior "LinkedIn exec-role SEARCH ingestion" entry. DST-safe timer, direct-from-Azure, jittered.
LIMITATION: role keywords are group/role-level names ("Data, Analytics & AI", "COO") — generic.
  The 3x/day cadence may need DIFFERENT concatenated queries per slot as we settle on roles.
MITIGATION (planned, ACT-24): refine criteria to fit ONE settings tier (favorites), OR-concatenate
  title variations per role, add US geoId 103644278. NOT done yet.

### 2. Inline JD-fetch inside search (2026-07-30) — commit 0e64751
After discovery, the search fills jd_real for the handful of NEW opps it just inserted, reusing the
SAME direct fetch as the backfill sweep (extracted shared fetchAndStoreJd/ensureJdCols in jdBackfill.ts
— NOT a duplicate). LIVE-VERIFIED on job-platform-api: 2 roles → 20 cards → 16 inserted →
jdFetched=5 jdStored=5 (ok_jd=5), 0 blocked.
- LIMITATIONS/MITIGATIONS: jdFetchCap (default 20) bounds the burst; ~2.5s jitter between fetches
  (stays under the ~30-req/IP wall); stops after 3 consecutive block/quota outcomes; default on,
  the timer picks it up (logs jdFetched/jdStored).
- SKIP behavior (confirmed in code): backfill fetch skips jd_fetched_at IS NOT NULL (incl.
  auth_required/not_found — intentional, extension recovers those); inline fetch only touches
  freshly-inserted opps, so it never re-fetches existing pipeline items.

## Roles mismatch is INDEPENDENT of the JD fix (clarified 2026-07-30)
User asked: "if the JDs are now fixed why do roles/variants still have so many mismatches?"
ANSWER: they are different subsystems.
- JD fix = fetching the real posting TEXT (jd_real). Anti-fabrication.
- Role/variant mismatch = CLASSIFICATION of an opp into a role bin, driven by resolveTitle() on the
  TITLE string via System B (taxonomy_title) — it does NOT read JD text, so fixing jd_real can't fix it.
- Root causes are the documented "TWO role systems" problem (persona vs taxonomy disconnected) +
  classification bugs (retag uses unreliable jd_title vs ingest uses role; normalize() cuts at first
  comma) + the search now injecting group-level names as the role.
- The plan to resolve is the ACT-21 "Target end state" (unify to ONE taxonomy source). Now that
  jd_real exists, classification could ALSO improve by using the real title from the fetched JD instead
  of the digest-collapsed jd_title — but the core fix is still unifying the two brains.

## Role classification — GROUND TRUTH + Phase-1 fix SHIPPED & VERIFIED (2026-07-30, ACT-23)
Read the REAL posting (jd_real) for 51 opps: `role` matched the real posting 51/51 -> `role` is RELIABLE.
The broken field was `matched_group` (the bin), because retag classified on `jd_title`, which is
derived from runJdParse(raw_jd) where raw_jd = the WHOLE digest -> every sibling inherited the digest
HEADLINE title and got mis-binned. jd_real (fetched by job_id) is the ONLY ground truth; jd_title/
jd_summary are digest-collapsed = unreliable. PRD (Boost_Exec_Pipeline.PDF = Roles & Titles PRD)
confirms 3-level taxonomy (group->role->title variant) with fav/watch/off tiers EXPLICITLY replaces the
flat 8-persona system (= the CTO/VPE/VPP demo still shown in Settings ▸ Roles).
Owner decisions (2026-07-30): "Head of"/SVP/EVP/Executive Director -> "VP & Head of". ALL Director roles
(incl. Managing/Senior/Global Director) -> Director, EXCEPT "Executive Director". Personas: leave DORMANT
(keep persona table+/app/personas endpoints, stop surfacing) — persona table has 0 rows for owner anyway.
Phase-1 fix (commits 879c259, c3a0034), deployed + retag-all run + VERIFIED live:
 - appRoleTaxonomy.tagFields classifies on `role` first (never jd_title).
 - roleTaxonomy keyword band: VP/SVP/EVP/AVP/Head/Executive -> vp; plain/Managing/Senior Director -> director.
 - appJdParse derives jd_title/jd_summary from jd_real (real posting) not raw_jd (digest) — NEW parses only.
 - Result: csuite_but_vp_title 54->0; vp_but_chief_title 50->5 (the 5 are legit "VP, Chief X" hybrids).
   Group dist now csuite:262 vp:412 director:96 null:59. Spot-checks all correct.
STILL OPEN:
 - Historical JD panels: ~174 opps with jd_real still show OLD digest-derived jd_summary until re-parsed
   (~174 OpenAI calls). Not yet run.
 - Settings ▸ Roles taxonomy UI (3 groups + roles + title variants + tier controls + add) NOT BUILT — that
   screen still shows the legacy persona demo. This is Phase 2 (the user's "see 3 groups/tiers" ask).
 - Seed marks 868/868 titles 'fav' (favorite meaningless) — PRD intends ~84. Fix during Settings work.
 - Suspected: "Executive Director" may exact/fuzzy-match a SEED director-group title BEFORE the keyword
   band, binning it director instead of vp — under investigation.

## Classifier coverage gaps fixed (2026-07-30, commit 2e65f84, VERIFIED)
seniorityBand(fullTitle) now authoritative for the GROUP bucket (overrides seed-matched group +
drives keyword fallback). Fixed & verified live: Executive Director -> vp (was director via seed
fuzzy-match); CISO/CSO/CFO/CMO/CRO/CHRO/CLO/CDO -> csuite (were NULL); "Administration - SVP - ..."
-> vp (buried SVP now seen — band scans the un-cut title). Post-retag dist: csuite:261 vp:426
director:89 NULL:53 (remaining 53 = genuine non-exec noise: "Agile Product Management", "Assistant
Station Manager", etc.).
IMPORTANT — Settings ▸ Roles taxonomy UI is NOT BUILT. The screen still renders the legacy persona
demo (CTO/VPE/VPP from the empty persona table). The 868 seeded titles/27 roles/3 groups exist in
taxonomy_title + are served by GET /app/taxonomy, but NO Settings screen renders them and there is no
manual-add UI. That frontend (3 groups + roles + title variants + tier controls + add) is Phase 2 —
still owed to the user (their "see 3 groups/tiers + add" ask).

## ACT-25 DONE + verified (2026-07-30): 27 taxonomy roles in persona (von.ellis), counts via taxonomy
Seeded 27 persona rows under von.ellis@enterpriseds.io (keys: CTO,CIO,CDIGITAL,CDATA,CPO,CAIO,COO,
VP-<10 fams>,DIR-<10 fams>; names "VP, X"/"Dir, X"; master_role = taxonomy role name). personasList
now counts opps via taxonomy (matched_group from key prefix VP-/DIR-/csuite + matched_role=master_role),
NOT roles_for. VERIFIED live: VP,Product=59, VP,Technology=24, VP,Software=2, etc.
OWNER SPLIT discovered: persona demo rows (CTO/VPE/VPP) are under demo@executive-engine.local; the REAL
data (962 opps, mail_watch) is under von.ellis@enterpriseds.io. Frontend _owner defaults to demo, set
from auth. The 27 went under von.ellis (real owner). demo rows left as-is.
SCHEMA BUG FIXED on live DB (had drifted from schema.ts): persona had a GLOBAL unique(key) +
vestigial FK opportunity.persona_key->persona(key), which broke multi-tenancy (demo CTO blocked
von.ellis CTO) AND silently broke the "+ Add role" upsert (on conflict(owner_email,key) had no matching
constraint). Dropped opportunity_persona_key_fkey + persona_key_key, added persona_owner_key_uniq
(owner_email,key) — now matches schema.ts. NOTE: psql -c runs the whole ; -string as ONE transaction —
a later failure rolls back earlier DDL; do multi-step DDL+DML in a single atomic batch.
KEY-FORMAT CAVEAT for ACT-26/30: personasCreate strips non-alphanumerics from key (VP-SOFTWARE ->
VPSOFTWARE), which would break the VP-/DIR- count-prefix logic if roles are added via the UI. Fix the
sanitizer to allow '-' when building the Settings taxonomy UI.

## Reusable infra + patterns documented in CLAUDE.md (2026-07-30)
- ui-verify.yml + scripts/ui-verify.mjs: Playwright-in-GHA to VERIFY THE LIVE UI (sandbox is blocked
  from *.azurestaticapps.net; Tavily can't run JS/auth). Impersonate owner via localStorage.ee_auth_user
  then RELOAD (hash-only nav won't remount past login gate), assert EXPECT substrings, screenshot.
  Verified GREEN confirming ACT-25 (27 roles render as von.ellis).
- Owner model documented: frontend _owner from auth (von.ellis real; demo@ sandbox). EVERY owner-scoped
  api.js call must pass ?owner= or it falls back to demo (fixed listPersonas + persona CRUD).
- These are now in CLAUDE.md so future sessions inherit them.

## ACT-26 folder mapping — investigation state (2026-07-30, IN PROGRESS)
- Backend GET /api/mail/folders?tree=1 ALREADY returns the full recursive folder tree (fetchFolderTree,
  path+level+childCount). The picker showing only ROOT folders is a FRONTEND bug — it calls the flat
  version, not tree=1. Fix = point the Intake folder picker at tree=1 + render nested.
- CAVEAT to verify before building the automap: the live tree tail showed only Sent Items / Sync Issues
  / Task Reminders at root — did NOT confirm a "Job Alerts" or "Indeed"/"LinkedIn" folder exists. The
  Inbox-monitor "Indeed"/"LinkedIn" chips are likely derived from SENDER (jobalert.indeed.com /
  jobalerts-noreply@linkedin.com), NOT from folders. MUST pull the FULL tree (not just tail) and confirm
  whether provider folders actually exist before auto-mapping roles→folders. If they don't, the "automap
  to 3 role-group folders per provider" needs rethinking (provider is a sender facet, not a folder).

## ACT-26 automap DONE + verified (2026-07-30)
Mailbox is org'd Inbox/Job Alerts/{Indeed,Ladders,Lensa,LinkedIn}/{C Suite,VP & Head of,Director}.
New POST /api/mail/folders/automap (mailWatch.ts): fetches folder tree, maps each group-named folder
to its group's persona keys (csuite=7, vp=10, dir=10) into folder_role_map (skip_filter=true).
VERIFIED live: 12 folders -> 108 rows. Effect: those folders skip_filter-ingest + group-tag; specific
role still from taxonomy title classifier. Idempotent (ON CONFLICT).
NUANCE: routeOpportunity Path-1 sets roles_for = ALL mapped keys for the folder (7-10). That's System A
(roles_for) which is now secondary (persona counts use taxonomy). Acceptable; only Pipeline.jsx (System A)
shows the breadth. If tighter behavior wanted later: have routeOpportunity use the folder's GROUP as the
authoritative matched_group prior (code change) instead of tagging all group role_keys.
STILL PENDING in ACT-26: the Intake folder PICKER (frontend) shows only ROOT folders — must call
/mail/folders?tree=1 and render the nested Job Alerts tree; and reflect these 108 mappings in the UI.

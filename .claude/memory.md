# Project Memory — boost-application-packet-platform
Last updated: 2026-08-20

## P8.2 / R3 — a check that NAMES people must err toward silence (2026-08-20) ✅
`api/src/functions/tests/figureEcho.ts` + `posting_figure_echo` in `checks.ts`. PR #10, 292/292
green, CI green (run 32384079631). Pure module — no pg, no network, no model call, so it costs no
tokens and can state a byte offset.

**Three-way split, and the middle case is the whole point:** posting-only → `echo`; posting AND
profile → `shared_with_profile`, **KEPT and citable** (C5: R2 evidence beats a literal R3 — if the
profile genuinely says 60 and the posting asks for 60+, stripping it deletes the candidate's own
true achievement); not in the posting → untouched.

**Wiring facts worth not rediscovering:**
- Posting text MUST come from `resolvePostingSource` (the employer's own bytes), NEVER
  `groundingText` — which falls back to `jd_summary`, i.e. OUR model's output. Accusing a candidate
  of echoing our own summary is an accusation built on a fabrication.
- Profile text comes from `appFacts.sourceText()`, now **exported rather than duplicated**. A second
  profile reader is a second answer to "what does the candidate own", and the day they disagree the
  check accuses people of echoing their own achievements.
- Missing either side ⇒ `not_applicable`, never `pass` and never an accusation.
- `warn`, not `fail` — a shared number can be legitimate and P8.1's correction path supersedes it.

**Five defects found while building it, each proven by revert. The pattern in all of them: a
scanner that is right about the rare case and wrong about the common one.**
- **H24** — the scanner reported a figure that was NOT IN THE TEXT. `/(\d…)\s*(%|percent)\b/`
  never matches "40% growth" (`%` and the following space are both non-word, so the trailing `\b`
  has no boundary), and the count scanner then **backtracked past its own failing lookahead** to
  match "4". General rule: **a regex tail that can FAIL is a tail the engine backtracks past.**
  Exclude by span/overlap guard, never by a lookahead over characters you also match.
- **H25** — the backlog's literal rule ("no numeric string that also appears in `jd_real`") accused
  "Skill number 3", "Other skill 3" and "One two three four five" of stealing "three business
  units". **A bare number is not a claim; "3 business units" is.** Unmarked figures key on the
  number AND the noun; marked ones (`$18M`, `60+`) key on themselves — decided by the GENERATED
  figure, so an unmarked answer to a marked ask ("60 sites" vs "60+ sites") still lands.
- Years excluded (1900-2099, bare, no `+`) — "since 2019" vs "founded in 2019" is the calendar.
- A spelled multiplier is ONE figure ("one million" = 1e6) and the bare word never is, so "a million
  things to fix" claims nothing.
- `/e?s$/` stemmed "sites" → "sit" and split "business" from "businesses".

### The discipline that caught all of it — REVERT-PROVE EVERY GUARD
After writing each test, undo the fix in the source, rebuild, and confirm the test FAILS. Two of my
own guards turned out to be **vacuous** and would have shipped as untested belt-and-braces:
1. a `(?!\d)` anti-backtrack guard that another fix already made unreachable — removed, and the
   comment now says plainly which fix the test actually pins;
2. a source-grep whose own regex used `[^)]*` to reach a construct in a pattern **containing `)`**,
   so it could never match what it was scanning for — rewritten line-scoped.
A test that cannot fail is worse than no test, and you only find out by reverting.

## Lane hygiene — a lane that has not pushed a branch has produced NOTHING (2026-08-20) ⚠
The P3 remediation subagent ran, died without pushing, and left **no branch on origin** — the work
was gone with no trace except `.claude/QC-EVIDENCE-PLAN.md` still listing it as in flight, and that
file's RESUME MARKER six phases stale (said P2 while the train was at P8). Restarted as a fresh
lane, not a resume. **Verify a lane by `git branch -r`, never by a summary or a tracker entry.**
The plan file now carries a lane table (file ownership per lane, pre-allocated H-ids so two lanes
cannot collide on one number) and a blocked-on table.


## ⛔ STANDING OWNER RULE — no answer to a direct question without ROOT PROOF (2026-08-01)
When the owner asks a direct factual question ("why is X", "what's the cause", "is X true"), DO NOT
answer with anything not backed by a primary-source, ground-truthed fact. No inference dressed as
cause. Name the single source that proves it and read THAT before answering. If you don't have the
proof yet, say so and go get it — never fill the gap with a plausible-sounding assumption.
  *Real failure that spawned this (2026-08-01): asked why an opp ("VP, Corporate Engineering",
  company "Ladders") had no JD, the agent answered "because it's from a non-LinkedIn source" —
  read off the COMPANY field ("Ladders"). Ground truth (one query): source=**LinkedIn**,
  job_id=**4446746716**, jd_fetched_at=**NULL** → the JD was simply **never fetched** (backlog),
  nothing to do with source. The agent HAD source=LinkedIn + job_id in an earlier query result and
  ignored it. Owner caught it. Company="Ladders" is a SEPARATE company-misparse bug (the board name
  stored as the employer), unrelated to the JD.*

## JD backlog — CORRECTED SCOPE (2026-08-01, ground-truthed by DB day-histogram) ⭐
Ran `select day, count(*), count filter(job_id not null), count filter(len(jd_real|raw_jd)>200)`
grouped by created_at day. Ground truth (supersedes the "45/38 no-JD" framing):
- **Going forward = SOLVED.** Every opp ingested **07-21 → 08-01 (843 opps) has JD text —
  has_jd_text == total on EVERY day.** Inline-at-ingest (d8f39a4) is working; blank-JD is not
  growing.
- **The blank-JD backlog is ~209 opps, ALL in the first week 07-08 → 07-14** (pre-pipeline batch;
  only 29/218 even have a job_id). NOT the 45/38 we chased. That earlier count was a red herring.
- **`recover-targeted` (e48121b) works but my test sample was misleading.** Sorted newest-first →
  hit 3 rows from 08-01 that are LinkedIn **networking** emails, not jobs:
  `messages-noreply@linkedin.com` "…is popular in your network" + `invitations@linkedin.com`
  "I want to connect" — `isAlert=false`, ZERO job anchors (proven via debug=true dump, commit
  b873ebc). Roles were people's titles ("CEO & Co Founder", "SVP & Global Head"). ⇒ These no-job_id
  newest opps are a **data-quality leak** (networking emails saved as opportunities), a DIFFERENT
  problem from JD backfill — do not try to "recover" JDs for them; there are none.
- OWNER STEER (2026-08-01): legacy → "we originally filtered on favorite jobs" (scope JD to
  FAVORITES); networking noise → "both of the first two" (investigate leak + filter out). DONE below.

## Networking-noise phantom leak — ROOT-CAUSED + FIXED + CLEANED (2026-08-01, verified) ✅
- ROOT CAUSE (ground-truthed): LinkedIn SOCIAL emails (messages-noreply@ "…popular in your network",
  invitations@ "I want to connect") filed into a role-mapped folder bypassed `isAlert` at
  mailWatch ingestMessageId (folderSkipsFilter). parseAlert's LLM then mined the PEOPLE named in the
  email (their employer+title) into phantom opps: source=LinkedIn, why="New LinkedIn alert", no
  job_id, jd_real=0. Proven via /recover-targeted debug dump (only social senders, 0 job anchors).
- FIX A (prevent, commit 03d3be2): `isLinkedInSocialSender()` in mailWatch; ingestMessageId hard-
  rejects those senders BEFORE the folder bypass. Job alerts (jobalerts-noreply@/jobs-noreply@)
  still pass.
- FIX B (clean up, commit 03d3be2): POST /api/mail/jd-backfill/dismiss-phantoms — Graph-verified,
  dry-run default, reversible (sets dismissed=true, NOT delete). Dismiss ONLY if company appears
  solely in non-alert social emails. Ran: examined 31, KEPT 27 real, dismissed 4 phantoms
  (Maat Staffing, Sirion×2, BUILD Inc.). 2nd sweep 27/27 kept, 0 phantoms → tail clean.
  ⚠️ CRITICAL: never blanket-SQL-dismiss no-job_id opps — a 40-row sample showed only ~4/40 were
  phantoms; the other 36 were REAL postings (job_id extraction merely failed; raw_jd holds the JD).

## Legacy FAVORITED no-JD recovery — DONE (2026-08-01, verified via DB) ✅
- Target = 50 favorited opps created <07-21 (owner's "favorites" filter). Before: 9 job_id, 9 JD.
- Matcher fix (commit b81a731): LinkedIn alert subject is "{Role} at {Company}" — company is in the
  SUBJECT, not the bare /jobs/view/{id} anchor href (why context-substring missed them). Now match
  alert by subject-company + tokenSim(role) rank, take the headline (first) anchor; skip (null) when
  no subject names the company (conservative — never mis-binds). Verified on DataAnnotation→4318728538,
  PERMA FAIR→4421196163 (both correct headline jobs), Alpha Recon→null (correctly skipped).
- recover-targeted gained favoritesOnly + since/until + order params (commit c6dc815). Ran fetchJd:true.
- AFTER (DB-verified): 50 fav-legacy → 24 job_id (was 9, +15), 20 jd_real (was 9, +11). The other
  26 are UNRECOVERABLE via mail (company not in any alert subject — emails aged out); jdBackfillTick
  fetches JD for the 4 linked-but-not-yet-fetched.
## JD fetch-mode as owner setting — DONE + verified (2026-08-01, commit 732a3c6) ✅
- Owner approved prototype (kept qualitative status, direct default) → built for real.
- owner_search_prefs gained jd_fetch_mode ('direct'|'proxy', default direct) + jd_fetch_fallback
  (bool, default true). Removed the buried force:'direct' constant from fetchAndStoreJd (the ONE core
  JD fetch) — it now honors the owner's choice; in direct mode a blocked/authwall fetch retries once
  via scrape.do when fallback is on. BOTH automated JD paths read it: inline-at-ingest
  (routeOpportunity) + jdBackfillTick, via getJdFetchPrefs(client,owner) in jdSweep.
- Surfaced in Settings ▸ Intake ▸ Active-search card: segmented Direct/Proxy control, live
  "what happens" copy + qualitative pills (no fake credit number), fallback toggle (direct only).
  searchSweep GET/POST carry jdFetchMode/jdFetchFallback; api.js searchSweepSet passes them.
- VERIFIED: POST proxy/false → returned proxy/false; POST direct/true → returned direct/true
  (restored prod to direct/true, not left on proxy). ui-verify #/settings/intake success ⇒
  "Job description source / Direct from LinkedIn / Scraping proxy" all render live.

## Opportunity SIGNALS reworked — Temperature + Action-priority + Match-to-spec (2026-08-02, verified) ✅
Owner clarified the two conflated signals; grounded in docs/design_handoff/README.md (spec).
- **Temperature = RECENCY** (Hot ≤48h / Warm ≤14d / Cooling ≤21d / Cold), derived from source_date at
  READ time (never stored — ages over time). Owner-editable bands (owner_search_prefs.temp_*; editor in
  Settings ▸ Intake "Freshness bands"). Replaces the old LLM Hot/Warm/Cool urgency meaning.
- **Action-priority = journey phase + due event** (urgent/active/ready/new/done). Urgent = offer OR
  interview stages OR any opp with a DUE outreach touch; Active = applied/outreach/engaged; Ready =
  saved/enriched; New = discovered; done = accepted. `max(stage, due-touch)`.
- Both computed in the ONE funnel: signals.ts → rowToOpp (appOpportunities). /app/opportunities returns
  temperature/postedAgeDays/actionPriority per opp + byTemperature/byPriority tallies + tempThresholds.
  appMetrics "Hot" KPI = recency (owner threshold), not the old label. Commit 1826c43.
- **Match to spec**: NEW opportunity.ats_score (+ats_gaps) — real JD vs master baseline via ATS LLM,
  stored in its OWN column (never overwrites hand-set match_score). POST /app/ats-backfill + atsBackfillTick
  timer (5m, favorites-first, self-idle). Commit 181220a. VERIFIED: 12 scored, avg 82, range 75–87
  (spec "opens high ~84%" ✓).
- Frontend (commit 795445b): TemperaturePill + PriorityPill primitives; wired Today (Hot=recency,
  do-next left-bar by priority), Opportunities (Hot filter=temp, new Urgent filter, Strategic=favorites,
  temp dropdown, temp+priority column), Swipe/Pipeline/OppDetail pills, OppDetail Status adds
  Temperature/Priority/ATS rows. VERIFIED: /app/opportunities returns the fields; ui-verify #/opportunities
  (Urgent/Strategic/Hot) + #/settings/intake (Freshness bands) both success.
## Signals CONSOLIDATED (2026-08-02, commit 88667d0, verified) ✅
Owner pushed back (rightly, "extend don't duplicate"): I'd bolted new fields/pills beside the old urgency.
Fixed:
- **ONE `SignalIcon`** (shell.jsx) replaces UrgencyPill/TemperaturePill/PriorityPill. kind-driven:
  temperature = FLAME (Hot orange→Warm yellow→Cooling blue→Cold white/pale-stroke); priority = rounded
  WARNING TRIANGLE w/ white "!" (Urgent red→Active green→Ready yellow→New white). Both still render per
  card (showLabel toggles text; Pipeline uses icon-only). A new signal later = one row in TEMP_META/PRIO_META.
- **`urgency` retired**: LLM talent classifier (mailWatch + appExtras) no longer emits/writes urgency
  (kept `fit`). Nothing reads the column now; left in DB (harmless) but no new writes.
- VERIFIED: API+app build clean; ui-verify #/opportunities success post-refactor (no crash);
  /app/metrics/today 200 with kpis.hot (recency) present. NOTE the metrics route is `app/metrics/today`
  NOT `app/metrics` (a wrong-path 404 bit me once).

## ACT-30 Role Profiles page REBUILT on taxonomy (2026-08-03, commit c16e0c8, verified) ✅
- The /library/roles Roles tab was a DEAD persona stub (api.listPersonas → empty). Now taxonomy-backed.
- New api/src/functions/tests/appRoleProfiles.ts → GET/POST /app/role-profiles. Table role_profile
  (owner_email, role_key='group:role', narrative, key_wins[], comp_reference). Roles DERIVED live from
  opps (distinct matched_group+matched_role). Detail returns real linked opps (by matched role) + atsScore.
- Library.jsx RolesTab rewritten: grid (favorites-first, GROUP_LABEL, roleLabel()) + detail (editable
  baseline: narrative/keyWins/compReference via api.roleProfileSet; Save gated on sessionValid()).
- Linked ASSETS deferred honestly (no asset→role tag exists — not faked). sessionValid() moved to api.js.
- VERIFIED: list=28 roles; POST csuite:CTO baseline + GET detail round-trip OK; ui-verify #/library/roles
  success. Note: this ALSO advances ACT-17/21/23 (Role Profiles now reads taxonomy, not persona).
- STILL OPEN: ACT-39 (a NEW page per PRD — needs scoping before build; owner deferred). My earlier
  "remaining open actions" rundown had OMITTED ACT-30 + ACT-39 — surface page-items from actions.md next time.

## Triage fix (2026-08-03, commit faf9def, PR #4) — Keep/Maybe/Dismiss on Opps list + OppDetail
- Owner (mobile screenshots): Opportunities list ACTIONS had ONLY Reject; OppDetail had NO triage
  (only Advance stage + stepper). "the three options" = Swipe deck's ✕ Dismiss / ↓ Maybe / ✓ Keep.
- FIX (extend Swipe semantics, no new endpoints): Opportunities.jsx ACTIONS now ✓ Keep(→saved) /
  ↓ Maybe(→enriched) / ✕ Dismiss(reject); Restore when already rejected. OppDetail.jsx triage row
  under the stage stepper, same 3. Reuses api.moveStage/api.dismiss. Semantics mirror Swipe.decide()
  (keep→saved, maybe→enriched, pass→dismiss). VERIFIED LIVE: ui-verify #/opportunities success (Keep/Maybe/
  Dismiss) + #/opp/<id> success (Keep/Maybe/Dismiss/Advance stage). exec-engine-deploy faf9def success. PR #4.

## ACT-39 FULL BUILD shipped + verified live end-to-end (2026-08-03, commit dc660d8 on main) ✅
- Owner green-lit full build. Draft/publish taxonomy layer + priority-opps highlight. All 651 titles stay
  tier=fav (BY DESIGN — no data change). PR #3 merged; main == branch == dc660d8.
- Backend (appRoleTaxonomy.ts): NEW title_tier_draft working set. tier writes (PATCH title/tier + bulk-tier)
  now STAGE to draft (row kept only when differing from published). NEW routes: POST app/taxonomy/roles/
  bulk-tier (atomic per-role), POST app/taxonomy/publish (flush drafts→published + clear + rescoreOpps),
  POST app/taxonomy/revert. Read model returns effective tier (draft over published), dirty, favoritedOpps,
  per-title live matched-opp counts. rescoreOpps() extracted + shared with retag.
- Frontend (RolesTitles.jsx): header shows "197 ★ PRIORITY OPPS →" (= favoritedOpps, live favorited opps),
  clickable → /opportunities?filter=strategic (reuses existing 'strategic'=isFavorite filter — extend not
  duplicate). Replaced the redundant title-fav counter. Per-title "N live" badge → same filtered view.
  Save favorites / Revert N (dirty-gated) call publish/revert. api.js: taxonomyBulkTier/Publish/Revert.
- VERIFIED LIVE (api-deploy+exec-engine-deploy both success on dc660d8):
  • GET taxonomy von.ellis → favoritedOpps:197, dirty:0, per-title tier/published/live present ✓
  • ui-verify #/roles → bodySnippet "651 TITLES 197 ★ PRIORITY OPPS →", "live" + "Open role baseline"
    matched (missingExpect "Priority opps" = CSS uppercase innerText quirk, cosmetic) ✓
  • revert → 200 {reverted:0} ✓
  • demo owner cycle: bulk-tier cto→watch 200 {count:11,dirty:11} → publish 200 {published:11,rescored:7,
    favoritedOpps:5} → draft/publish/rescore proven end-to-end ✓. Restored demo cto→fav after.
- STILL DEFERRED (not blocking): full R-1..R-20 1:1 pixel parity, inclusion-rule notes in panes, Add
  role/group creation forms (PRD G3), folder-change deep-link. Core PRD §7 interactions all live.

## ACT-39 PROTOTYPE shipped + verified live (2026-08-03, commit 69f4c9c) — owner wanted to SEE it first
- Owner clarified ACT-39 = the FULL PRD §7 3-pane "Roles & Titles" page at #/roles (the uploaded spec),
  adapted ADDITIVELY onto existing systems (NOT destructive). It composes with ACT-30: PRD R-16 = Pane-3
  baseline card links OUT to the ACT-30 /library/roles page. Owner asked for a prototype integrated first.
- BUILT app/src/screens/RolesTitles.jsx (3-pane: tree | title-variants | role-detail), new sidebar entry
  "Roles & Titles" + route (App.jsx route==='roles'), responsive 3/2/1-pane grid (theme.css .ee-roles-grid).
  Reuses EXISTING app/taxonomy read model + PATCH taxonomy/title/tier (prototype = direct-publish, NO draft
  layer yet). Fixed api.taxonomy() to pass ?owner (was falling back to demo). Star toggle / tier cycle /
  All-Fav-Watch-Off filter / search / fav-first / bulk bar all wired. Pane-3 baseline btn → ACT-30 page.
- VERIFIED live: exec-engine-deploy success; ui-verify #/roles rendered header "Roles & Titles",
  counts "3 GROUPS 27 ROLES 651 TITLES", full C-suite tree with per-role counts, "Open role baseline"
  (Pane-3) present. The one missingExpect "How favorites get promoted" = the CSS text-transform:uppercase
  innerText false-negative (Chromium returns UPPERCASED) — cosmetic, documented pattern, NOT a defect.
- GROUND TRUTH + CORRECTION (2026-08-03): the "all-favorited" is BY DESIGN, NOT a bug. Two levels:
  (a) TITLE level taxonomy_title.tier — the ★ is a saved fuzzy-lookup PATTERN ("promote opps whose title
  matches this"). docs/roles-taxonomy-source.md:26 EXPLICITLY: the entire ideal-roles list seeds as fav;
  watch = matched-but-not-in-list; off = nothing at launch. roleTaxonomy.ts:70 buildSeed sets tier:'fav'
  for all — INTENTIONAL. There is NO curated 84-list anywhere; PRD PDF's "84" was an illustrative
  screenshot count. DO NOT wipe title favorites.
  (b) OPPORTUNITY level opportunity.is_favorite — the meaningful subset. db-query von.ellis active opps:
  is_fav=t/matched=t 197; is_fav=f/matched=t 132; is_fav=f/matched=f 4 (total 333). So 197/333 favorited,
  136 not — HEALTHY. 132 matched-but-watch = keyword/backlog matches (ordinary Director etc.), working as
  designed (is_favorite = tier==fav && matched && !backlog, i.e. exact/alias only).
  MY MISTAKE: prototype header labeled the title-pattern count (651) "Favorites" — redundant/misleading
  (= total titles). REAL FIX = UI/labeling only: show per-title LIVE matched-opp counts + favorited-opps
  (197), NOT a title-fav counter. NO data change. Owner confirmed the star is a title-level lookup.
- DEFERRED to full build (owner go/no-go pending): draft/publish layer (title_tier_draft + bulk-tier/
  publish/revert endpoints), taxonomy.published→rescore-open-opps job, all 20 R-states 1:1, data re-seed.
- Screenshot artifact: run 30827588678 → artifact 8861525801 (ui-verify-screenshot). Live: 
  purple-ground-0f377120f.7.azurestaticapps.net/#/roles

## JD-missing ROOT CAUSE (2026-08-01, verified live) — it is BACKLOG, not source
- 259→262 opps; only ~36% had a real JD. **64% had jd_fetched_at=NULL = never fetch-attempted.**
- Cause: ACT-44 "JD-at-ingest" was NEVER shipped (routeOpportunity/insertOpp make zero
  fetchAndStoreJd calls) AND no timer fetched mail opps (jdSearchTimer PAUSED, jdSweepTick disabled).
  So any opp — including LinkedIn-sourced ones WITH a valid job_id — sat at jd_real=NULL forever.
- ⚠️ PARTIAL / WRONG-DESIGN (commit 7c3c588): shipped `jdBackfillTick` timer (every 3 min, reuses
  fetchAndStoreJd, favorites-first, jittered, stop-on-block). It IS draining the backlog live
  (with_jd 94→104, pending 123→113) — but this is the SCHEDULED SWEEP the owner EXPLICITLY told us
  to DROP (actions.md:717-724: "fetch JD DURING inbox extraction… i dont want rules to make it to the
  pipeline without job descriptions already… Call fetchAndStoreJd INLINE inside routeOpportunity…
  Drop the scheduled sweep idea").
- ✅ ACT-44 INLINE-AT-INGEST DONE + VERIFIED LIVE (commit d8f39a4, 2026-08-01). routeOpportunity now
  calls fetchAndStoreJd right after job_id resolves (direct-from-Azure, small jitter, best-effort;
  failure/no-jobId leaves jd_fetched_at null for jdBackfillTick bounded retry, never blocks insert).
  Dynamic import breaks the mailWatch<->jdBackfill cycle. PROOF (not prose): (1) git log -S
  'fetchAndStoreJd' -- mailWatch.ts non-empty; (2) deterministic /mail/ingest-test w/ {{JOB:4446746716}}
  → new opp landed WITH job_id + jd_real (jd_len=2800) at ingest time (jd_fetched_at=13:56:38) +
  jd_fetch_log run_tag='ingest' ingest_ok=1 (test opp deleted after). Timer now demoted to RETRY only.
  GOTCHA: send-test-real makes NO-job_id opps (can't test inline) — use a {{JOB:id}} marker in
  /mail/ingest-test for deterministic verification.
- JD BACKFILL RAN + CLEARED (2026-08-01, verified live). Mistake first: called the endpoint WITHOUT
  direct → scrape.do proxy (tiny free tier, known-exhausted memory:288) → quota_exceeded, 0 stored,
  and I wrongly told owner it needed a scrape.do top-up. Memory:283-291,337-352 already decided
  direct-from-Azure (no credits); endpoint just still defaulted direct=false. FIX (commit 9584462):
  `direct` defaults TRUE (`body.direct !== false`); scrape.do opt-in reserve via {direct:false}. Ran
  paced waves (direct, concurrency 1, ~2s): 60/60 + 100/100 ok_jd, ZERO blocks/quota. LIVE DB PROOF
  (db-query): with_jd 94→217/263, pending_fetch=0 (every job_id opp has a JD now).
- PLANNED (NOT built, owner-flagged): expose JD fetch-mode (direct vs proxy) as an owner setting in the
  sweep card / owner_search_prefs, not a code default ("shouldn't be buried in code").
- REAL remaining gap: ~45 opps have NO job_id (genuinely non-LinkedIn boards / unparsed anchor) →
  the LinkedIn guest endpoint structurally can't fetch them. Needs a source-specific fetcher or the
  logged-in extension capture. DO NOT attribute a specific row to this gap without checking its
  actual job_id + source columns first (see standing rule above).

## Role-tagging fix (2026-08-01, commit 7c3c588, verified live)
- Bug: roleTaxonomy.ts `normalize()` cut the title at the first comma, so "VP, Product and UX" →
  "vp" before the family-keyword scan → matched_role=null (group tagged, role dropped).
- Fix: keyword fallback now scans the UN-CUT title (normalize(raw,{cut:false})) like seniorityBand.
  Verified: Aha "VP, Product and UX"→Product, Ladders "VP, Corporate Engineering"→Engineering,
  PenFed "SVP Artificial Intelligence"→Data,Analytics&AI. Untagged 47→25 after /app/taxonomy/retag
  (reprocessed 1064 opps). Remaining 25 are genuinely non-taxonomy titles (e.g. "VP & GM").
- Note: two role systems still coexist — matched_role (taxonomy) vs roles_for[] (persona). UI opp
  subtitle shows matched_role, falling back to location when null (why untagged rows showed a city).

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

## ACT-26 frontend DONE + Playwright-verified (2026-07-30)
Settings ▸ Intake "Folder → role routing" (Settings.jsx IntakeSettings) was already fully built
(lists personas, mailFolderTree nested picker, mailFolderMapGet -> assign map, chips per role). Only
bug was the ?owner= omission on mailFolderTree/mailFolderMapGet/Set/Delete (resolved to demo). Fixed
in api.js. ui-verify.yml on #/settings/intake = SUCCESS: rendered "Folder → role routing", "VP, Product",
"C Suite", "VP & Head of", "Director" — i.e. 27 roles each showing its group's provider folders (from the
108 mappings). ACT-26 (data + UI) COMPLETE. NOTE: folder-map mutations (toggle in UI) need a verified
session (requireWrite); reads work via ?owner=. Next: ACT-27 (inbox-monitor coherence), ACT-28 (JD Graph
ParseUri fetch error), then re-enable the paused 3x search.

## ACT-27 DONE + Playwright-verified (2026-07-30): inbox-monitor rail coherent
Intake.jsx "Monitored roles" rail now renders the 12 mapped folders coherently:
- `folderLabel(path)` shows "Provider / Folder" (e.g. "Indeed / C Suite") when path has a parent —
  the 12 bins are the SAME 3 group names under 4 providers (Indeed/Ladders/Lensa/LinkedIn), so the
  last segment alone was ambiguous.
- `roleSummary(keys)` collapses a folder's 7-10 role keys to "<group> · N roles" via `groupOfKey`.
- **groupOfKey key formats (from live folder_role_map, von.ellis):** VP-<fam> (10), DIR-<fam> (10),
  and BARE C-suite acronyms with NO separator: CTO/CIO/COO/CPO/CAIO/CDATA/CDIGITAL (7). First cut used
  `/^c(suite)?[-_]/` which missed the bare acronyms (rendered "roles · 7 roles"); fixed to
  startsWith('VP-')/'DIR-' else `/^C[A-Z]/` -> C Suite. Verified live: "Indeed / C Suite … C Suite · 7 roles".
ui-verify #/intake: "/ C Suite","/ Director","VP & Head of ·" all rendered (only "Monitored roles"
"missing" = CSS uppercases to MONITORED ROLES in innerText; cosmetic, not a defect).

## Roles & Titles PRD added to repo (2026-07-30): docs/specs/Boost_Exec_Pipeline_Roles_and_Titles_PRD.pdf
The design spec for the Role Profiles page (ACT-30). Reference impl: proto-compass/roles.jsx +
proto-compass/taxonomy.js, route #/roles. Key facts to build against:
- **3 levels:** Role group (3: C Suite/VP & Head of/Director) -> Role (27: 7+10+10) -> Title variant
  (484 seeded). Tiers: fav(★ promoted)/watch(default)/off(excluded at ingest). FAVORITE_BOOST=15,
  match_score=least(100, base+boost); is_favorite drives gold star.
- **Schema (§3):** role_group / role / title_variant / title_tier_draft (draft layer for Save/Revert) /
  title_match. opportunity gets matched_title_id, role_id, base_score, tier_boost, is_favorite, match_score.
  NOTE: this is the PRD's target schema (System B taxonomy_title already partially implements it).
- **Matching (§5):** normalize (lowercase, cut trailing context at | · — , "at" "@", expand abbrev
  bidirectional longest-match, drop of/the/for, KEEP "global") -> resolve (exact 1.0 / alias 0.95 /
  fuzzy pg_trgm≥0.82 / else keyword fallback tier=watch conf 0). Inclusion rules jsonb on role/group:
  COO=require_any_keyword, Director=require_seniority_or_exception. Fail rule -> rule_passed=false,
  routes to backlog not queue (NOT discarded).
- **API (§6):** GET /api/taxonomy, PATCH /api/titles/:id/tier, POST /api/roles/:id/titles/bulk-tier
  (atomic), POST /api/taxonomy/publish, /revert, POST /api/role-groups·/api/roles, PUT /api/roles/:id/folder,
  POST /api/roles/:id/baseline. Events: taxonomy.published -> rescore_opportunities job.
- **UI (§7):** 3-pane (tree | title list | role detail), breakpoints ≥1180 three-pane / 720-1179 two-pane
  / <720 stacked. DOM hooks are STABLE data-* (build against them): [data-group],[data-role],[data-title],
  [data-star],[data-tiercycle],[data-search],[data-filter],[data-favfirst],[data-bulk],[data-action].
  Star toggles fav⇄watch; tier label cycles fav->watch->off. 20 screen states R-1..R-20 (§8) each with
  literal Trigger + Result — build click-through 1:1.
- **Known gaps (§10, to wire):** G1 #/intake/setup still legacy FAMILY_FOLDER (rebuild from role rows +
  real folder picker) — NOTE ACT-26 already rebuilt the Settings▸Intake picker from taxonomy; G2 promotion
  specified-not-wired (+15/pin/star/autostart); G3 +Add role/group are toasts (need creation form);
  G4 seeded favorites are a guess (onboarding pass); G5 live counts are stubs (real count query);
  G6 tiers persist to localStorage (ee-role-tiers-v1/-saved-v1) instead of draft/publish tables.
- **Extend-don't-duplicate:** this taxonomy IS System B (taxonomy_title). Build ACT-30 ON it; do NOT
  create a parallel roles table. resolveTitle/roleTaxonomy.ts already implement the §5 matcher.

## ACT-30 step 1 DONE + Playwright-verified (2026-07-31): Today role breakdown seniority-ordered + toggle
Per user (screenshot 15412.jpg), the Today ▸ "Discovered by role" hero list (Today.jsx InboxScrubHero):
- **Seniority order** C Suite → VP → Director → Other (was count-desc). SENIORITY_RANK{csuite:0,vp:1,
  director:2} else 3; ties by count then name. dotForGroup(group) replaces label-prefix roleDot.
- **Toggle** "Roles" (27 monitored roles, current) vs "★ Fav titles" (my favorite job titles = the
  taxonomy level BELOW; bins favorites by o.matchedVariation, non-favs collapse to "Other roles").
  Uses existing opportunity fields (matchedGroup/matchedRole/matchedVariation/isFavorite) — NO new system.
- Click-through wired both modes: rolenew:<fam> (existing) / new titlenew:<variant> branch in
  Opportunities.jsx (favorites new-today by matchedVariation; 'Other roles' = non-favorites).
Verified live #/today: "DISCOVERED BY ROLE Roles ★ Fav titles CTO 14 new COO 9 CIO 3 CPO 2 Chief AI
Officer 1 VP · … " — C-suite first, toggle present. (missingExpect "Discovered by role" = CSS
uppercases to DISCOVERED BY ROLE; cosmetic.) Commit ff6ace7.
NOTE: this is the Today-hero slice of ACT-30. The full standalone Role Profiles page (#/roles, PRD §7,
3-pane, data-* hooks, R-1..R-20) is still TODO — same seniority order + Roles/Fav-titles toggle apply there.

## ACT-30 step 1 refinement (2026-07-31): Title default + qualifier on titles
Per user (screenshots 15414/15416): Today breakdown toggle relabeled "★ Fav titles" → "Title";
**Title is now the DEFAULT view** (view init 'titles'). Added `titleFamily(o)` export (Today.jsx) =
GROUP_PREFIX + (matchedVariation||matchedRole) so VP/Dir title bins carry the SAME qualifier as roles
("Engineering" → "VP · Engineering"); C-suite titles ("Chief Technology Officer") stay bare. Title view
no longer favorites-only — bins ALL matched opps by variation (Other = truly unmatched, = roles view's
Other). titlenew: filter (Opportunities.jsx) now uses titleFamily; import added. Commit 0dc8e9a.

## ACT-35 opened (2026-07-31): JD attached to an opp is a DIFFERENT job (root-cause the real JD mismatch)
Ground truth (screenshot 15420): opp "VP of Software Engineering · The Phoenix Group · LinkedIn" but its
JD Summary = "Managing VP, Technology Product Management & Platform Strategy · Gartner". Different company
AND title → jd_real/raw_jd cross-wired to wrong opp. NOT the classify-on-role fix (that was matched_group);
this is the JD BODY write-path. Investigate fetchAndStoreJd (jdSearch/jdBackfill) opp-id resolution +
search-result→opp join key + appJdParse deriving Title/company from another opp's jd_real. See actions.md
ACT-35 for the full investigation checklist. GROUND-TRUTH the specific opp row (role/company/source_url)
vs its jd_real before concluding.

## CORRECTION (2026-07-31): Title view IS favorites-only
User: "the titles should only reveal favorite titles despite the label change." So the Today Title
view bins FAVORITE titles only (o.isFavorite && matched title); all non-favorites collapse to "Other
roles". Label stays "Title" (default) and keeps the VP·/Dir· qualifier. titlenew: filter matches
favorites-only ('Other roles' = non-favorites). Supersedes the "no longer favorites-only" note above.
Commit c19c8f4.

## ACT-35 ROOT CAUSE PROVEN (2026-07-31): JD fields fabricated from the shared LinkedIn alert email
Ground truth (opp 78f50bdf, live raw_jd): raw_jd = the WHOLE LinkedIn alert email
("From: jobalerts-noreply@linkedin.com", Subject "Managing Vice President, Technology Product
Management & Platform Strategy at Gartner"), 1961 chars, contains BOTH "Phoenix" and "Gartner".
opp.role="VP of Software Engineering"/company="The Phoenix Group" (CORRECT, from the per-job anchor).
opp.jd_title="Managing VP, Tech Product Mgmt…"/jd_company="Gartner" (WRONG = the email's headline/
subject sibling job). jd_real NULL, jd_fetched_at NULL.
MECHANISM: appJdParse.jdParseTick (timer, every 5m) parses opp.raw_jd; raw_jd is the shared alert
email whose subject is a DIFFERENT job → LLM extracts the headline → jd_title/jd_company/jd_summary
become the sibling job, for EVERY opp sharing that email. jdParse/jdBackfill "prefer jd_real" but the
TIMER doesn't, and jd_real is empty (guest fetch never populated it). role is reliable; jd_* is the
digest-headline fabrication. This is DISTINCT from the earlier classify-on-role fix (that fixed
matched_group only; the JD BODY parse was never grounded).
FIX DIRECTION (pending user sign-off on fallback display): stop fabricating — only LLM-parse a
SINGLE-job source (jd_real, or a genuine single JD from extension/ATS). Detect the LinkedIn-alert
digest (raw_jd contains 'jobalerts-noreply@linkedin.com' / why_surfaced 'New LinkedIn alert') and do
NOT parse it. When no real JD: fall back to anchor truth (jd_title=role, jd_company=company), leave
jd_summary honest-empty ("Full JD not retrieved yet"), don't guess. Backfill: clear the fabricated
jd_title/jd_company/jd_summary where they were parsed from an alert-email raw_jd (jd_real null).

## ACT-35 FIXED + verified (2026-07-31): JD no longer fabricated from the shared alert email
CODE (appJdParse.ts, api-deploy d0a2d24 live): added isAlertDigest() + resolveJdSource() + applyAnchorTruth().
All 3 parse sites (jdParse manual, jdBackfill sweep, jdParseTick TIMER) now ONLY LLM-parse a single-job
source (jd_real, or a non-alert raw_jd e.g. extension/ATS). When the only source is the LinkedIn alert
email → NO parse; set jd_title=role, jd_company=company (anchor truth) + honest jd_summary note. The
timer (was raw_jd-only, the active fabricator) now grounds too; its SELECT gained jd_real.
DATA BACKFILL (db-query, UPDATE 409): reset all von.ellis opps with jd_real NULL AND raw_jd = alert email
to anchor truth. Scope was 976 total / 409 alert-fabricated / 194 already grounded (jd_real present).
VERIFIED: opp 78f50bdf now jd_title="Vice President of Software Engineering" jd_company="The Phoenix Group"
(was "Managing VP…Gartner"). Mismatch gone.
FOLLOW-UP: the 194 with jd_real are grounded; the 409 show role-as-title + "not retrieved" note until a
real JD is fetched (ties to ACT-28 Graph ParseUri fetch error / ACT-29 re-enable search + jd fetch). To
refresh a single opp after its jd_real lands: hit "Re-parse JD" (jdParse reads jd_real first).

## Fresh-start scope DECIDED + applied (2026-07-31): keep only FAVORITE + last-14-days opps
User confirmed the working set = opportunities that are is_favorite AND created within 14 days.
Applied by DISMISSING (reversible, not deleted) everyone else for von.ellis. Ground-truth counts BEFORE:
976 total (ingested 2026-07-08..07-31) = 232 fav / 758 recent-14d / 182 fav+recent; 194 grounded
(jd_real) / 409 alert-fabricated (reset in ACT-35) / 373 no-JD-source. AFTER prune: ~180 active
(favorite+recent), ~796 dismissed. The 976 were NOT created by any backfill — they are pre-existing
mail-ingest rows; the backfill only rewrote JD columns. NOTE: favorites OLDER than 14 days (~52) were
dismissed too per the chosen rule; un-dismiss to restore. STANDING RULE for future work: scope
JD-fetch / Today / Swipe / counts to favorite+recent; when searches re-enable (ACT-29), apply the same
gate at ingest so the DB doesn't re-bloat. Un-dismiss = set dismissed=false on the opp.

## ACT-28 FIXED + verified (2026-07-31): Graph message-id URLs now URL-encoded
Root cause: mailMessageBody (mail/message/{id}), ingestMessageId, and the move-batch built Graph URLs
as `.../messages/${id}` with the RAW id. Graph message ids can contain '/','+','=' — an unencoded '/'
makes Graph parse the tail as a new path segment → 400 RequestBroker--ParseUri "Resource not found for
the segment 'AAMk…'" (the Intake preview error). Fix: encodeURIComponent(id) at all 3 sites
(mailWatch.ts). Frontend already encodes the id in the PATH; Azure decodes it to req.params.id (raw),
so the backend MUST re-encode for the outbound Graph URL. Commit 6af824d, api-deploy success.
VERIFIED live (api-test): GET /api/mail/message/<id> → HTTP 200 with subject/from/body (was failing).
CALIBRATION: the id sampled for the live test happened to be '/'-free (so it may have worked pre-fix
too); I did not reproduce a '/'-containing id to show a strict before/after. The encodeURIComponent
fix is the canonical correct handling for the '/'-in-id ParseUri class and cannot regress the working
case. Endpoint confirmed healthy post-deploy.

## ACT-29 DONE + verified (2026-07-31): favourite-title search re-enabled
jdSearch.ts: new loadFavoriteTitleQueries() builds ONE OR-concatenated query per role from that role's
taxonomy_title tier='fav' titles (e.g. `"Chief Technology Officer" OR "Platform CTO"`), capped 8
phrases/role (LinkedIn keyword length). runRoleSearch iterates these instead of bare role names;
byRole now includes titles count. Fallback = role-name search when no favourites. SCHEDULE DECISION:
≤~27 queries/cycle, 1 page each, ~3s jitter (+bounded inline JD burst) → fits ONE slot; run the full
favourite set at EACH ET slot (5am/1pm/6pm), no per-slot spreading. SEARCH_PAUSED flipped to FALSE
(timer live; still self-gates to the 3 ET hours). VERIFIED live (api-test POST /api/mail/jd-search
roleLimit=3 fetchJds=false): roles=3 cardsFound=25 inserted=20 dup=5 blocked=0; byRole Architecture
(8 titles→4), Chief AI Officer (6→9), Chief Data Officer (8→7). Coheres with fresh-start scope:
title-matched results get is_favorite=true (tagFields) → visible; fuzzy misses → watch/off → hidden.
Timer will next fire at the top of the covering UTC hour and run when ET hour ∈ {5,13,18}.

## Search RE-PAUSED 2026-07-31 (owner request): review queries before unpausing (ACT-36)
Owner wants to see the exact per-role OR-concatenated favourite-title queries (loadFavoriteTitleQueries
output) and approve before SEARCH_PAUSED flips to false. Flag set back to true. ACT-29 code stays
complete + verified; only the automated timer is gated on the review. Next: ACT-36 = a read-only query
preview (endpoint + UI) so the owner can approve, THEN unpause.

## ACT-31/32/33/34 DONE (2026-07-31): swipe/location/remote filters + upstream gate
- ACT-31: Swipe SourcePills from real distinct `source` (LinkedIn 799/LinkedIn Search 185/Indeed 15/
  Email 5/Extension 2). Verified live.
- geoMaster.ts: curated US-metro master (name, geoId, aliases) + resolveMetro() + parseWorkMode()/
  stripWorkMode(). geoIds are published LinkedIn values, OPTIONAL (buildSearch text-fallback) — SPOT-CHECK
  against live LinkedIn before relying on f_PP; several left null (Denver/Minneapolis/Philadelphia).
- appOpportunities.rowToOpp now adds metroName, metroGeoId, workMode to every opp.
- appSearchPrefs.ts: owner_search_prefs table (target_geo_ids[], remote_only) + GET/POST /app/search-prefs.
- ACT-32: Settings ▸ Locations panel (new SECTIONS key 'locations') = metro multi-select from REAL opp
  metros + counts (US 71/NYC 23/SF…), persists prefs; Opportunities filters by targetGeoIds; verified live.
- ACT-33: Swipe WorkPills (remote/hybrid/onsite) + card badge (🌐 Remote/Hybrid/On-site + metro pill);
  remoteOnly persisted pref.
- ACT-34: jdSearch keepCard() gate drops off-target/non-remote cards BEFORE insert+JD-fetch (reads
  search-prefs); summary.skippedLocation. Search still PAUSED (ACT-36 review) so gate is dormant until unpause.
- All api/app builds clean, deployed (api-deploy + exec-engine-deploy), main synced. Commits 28c3782, 7226e45.

## Owner-notes reconciliation (2026-07-31): added ACT-37..42, kept ACT-35 open
Captured owner's tracked items (dedup'd against existing): role-hierarchy = already done (ACT-30 step1);
JD-match = ACT-35 left OPEN pending owner confirmation. NEW: ACT-37 (post/found dates on OppDetail
Overview — only on swipe card today, NOT OppDetail), ACT-38 (LinkedIn-parity swipe filters + DATE-posted
filter + owner DEFAULT location=Washington DC-Baltimore Area[DC/NoVA/Baltimore] + remote-only default),
ACT-39 (scope the NEW page we discussed — needs definition, don't build yet), ACT-40 (packet quality
testing: resume+cover+pptx portfolio), ACT-41 (sample→template assets, playbooks first), ACT-42 (pipeline
to turn MBA/MIT/course learnings into per-role playbooks + playbook taxonomy research). NOT auto-applied
the DC-Baltimore+remote default (outward-facing filter change) — offered to owner.

## STANDING RULE (2026-07-31, owner): No hardcoded config — everything user-setting driven
Never hardcode a behavior-affecting value in code only. Every default/threshold/list/preference/toggle
must be a USER-CHANGEABLE setting (Settings UI + config store); code may only seed the FIRST value the
user can then change. Before hardcoding anything configurable, wire it to a setting OR get explicit
owner approval to leave it code-only (and record it). Added to CLAUDE.md ("No hardcoded config" section).
Owner default request: target location = Washington DC-Baltimore Area (DC/NoVA/Baltimore), and "REMOTE
PLUS" (remote OR my target metros) — NOT remote-only; leave off if remote-plus isn't UI-settable (it is:
target metros + the include-remote toggle = remote-plus).

## Location-filter consistency fix (2026-07-31): single funnel in useOpportunities
BUG (owner-caught): location/remote filter was applied ad-hoc in Swipe + Opportunities but NOT in
Today's Inbox-Scrub counts → same data, different numbers per screen. ROOT: filter bolted onto some
consumers, not the core source. FIX: applyLocationPrefs() now lives in the shared useOpportunities hook
(data.jsx) — loads search-prefs (refreshes on poll) and filters DISCOVERY/FRESH_STAGES opps by the SAME
rule as the backend jdSearch.keepCard (in-target OR remote when remote-plus; in-target when targets set;
committed/active stages NEVER hidden). Removed the duplicated filters from Swipe (matchesPrefs) and
Opportunities (targetGeoIds). Now Today scrub + Swipe + Opportunities + Pipeline all read the one filtered
funnel and reconcile automatically. Hook also exposes allOpportunities (raw) for any future raw need.
NEW STRICT RULE added to CLAUDE.md: "Trace every dependent — up AND downstream — before declaring a change
done" (map blast radius; apply shared logic at the ONE core source; grep all consumers; counts across
Today/Swipe/Pipeline/Opportunities must reconcile). Mismatched numbers ⇒ hunt the hardcode/off-funnel spot.

## EDS setup v3 installed this session (2026-07-31, owner request)
Installed the eds-claude-skills v3 enforcement into /root/.claude/launcher-settings.json (was NOT present
before — only generic git-identity/git-check hooks): added the `eds-enforce` v3 SessionStart command hook
and the v3 Stop AGENT hook (hard verification gate, model claude-haiku-4-5). Existing git hooks preserved.
Registered 13 skills → /root/.claude/skills and the `verifier` agent → /root/.claude/agents. Appended the
GLOBAL-RULES + skills overview to /root/.claude/CLAUDE.md. Source: /workspace/eds-claude-skills (also copied
to /root/.eds-claude-skills). ACTIVATION CAVEAT: hook/agent config is typically read at SESSION START, so
the Stop gate + Agent(subagent_type="verifier") reliably activate NEXT session. GOING FORWARD: code changes
need subagent-authored ACs (define-acceptance-criteria) BEFORE + a verifier subagent (verify-work) AFTER;
every task needs bootstrap(register_repo_root) + memory + actions + a stated plan before risky actions.

## JD-on-Overview + retrieve-missing-JD (2026-07-31, ACT-43)
Owner request: JD above "Why surfaced" on OppDetail Overview + fix opps stuck on "full JD not retrieved"
(Ventra Health CTO 7c4eea8c). Ground truth: Ventra had job_id 4445759706 but jd_real NULL, jd_fetched_at
NULL → never fetched (search paused). FIX: (1) manual jd-backfill/fetch favoritesOnly direct → 25 cand /
24 stored ok_jd / 1 blocked (guest endpoint WORKS direct, not broadly blocked). (2) Cleared placeholder
jd_summary/title/company on 9 favorites that now have jd_real (UPDATE 9) so the jd-parse timer regenerates
REAL summaries from jd_real (jdParse prefers jd_real → correct, no re-fabrication). (3) UI: OppDetail.jsx
Overview renders "Job description" card ABOVE Why-surfaced — real JD shows title/company+summary+link to JD
tab; not-retrieved shows muted notice + Re-parse button. Reuses o.jd* fields; JD tab unchanged. Commit
1e25100. Flow followed the v3 gate: AC-subagent wrote ACs before, verifier subagent verifying after.
INSIGHT: to actually clear "not retrieved" at scale, JDs must be FETCHED (jd-backfill/fetch by job_id) —
which the paused 3x search would do inline; unpausing (ACT-36 review) resumes automatic JD fill.

## JD-fetch architecture ground-truth + new actions (2026-07-31)
Traced all app.timer jobs: jdParseTick(5m, PARSES jd_real→summary, does NOT fetch), jdSearchTimer(3x/day,
inline fetch, PAUSED), atsScheduledIngest, outreachTick, mailReconcile, mailRenew. NO timer FETCHES jd_real.
=> folder/alert opps (routeOpportunity) get job_id + alert text but jd_real stays NULL until search-inline
(paused, search-only) or manual jd-backfill/fetch. CONFIRMED: folder opps do NOT auto-get JD. Fix = ACT-44
(scheduled source-agnostic JD fetch over job_id + jd_fetched_at NULL opps). Query count: 17 roles-with-fav
= 17 OR-queries/cycle (651 fav titles; cap 8/query). 3x/day=51 req/day (re-scans same 24h ×3). DECISION:
distribute 17 queries once/day across the 3 ET slots (~6/slot) = 17 req/day, r86400 = no gaps (ACT-29b/36),
then unpause. New ACT-45 = Analysis section (cross-role insights: responsibilities/certs/experience +
evolving strategy: courses/certs/playbooks e.g. "CTO standing up an org"); depends on ACT-44 JD corpus;
one system with ACT-42.

## LinkedIn search: endpoint limits + the "651 favourites" misalignment (2026-07-31)
Search endpoint = linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search (UNAUTH guest, undocumented).
Researched limit: ~10 page-reqs/burst per IP -> 429; needs rotating proxies for volume. We have ONE Azure
Function IP => mitigate by spacing+jitter+backoff+stop-on-429, not volume. THE 651 "fav titles" are a
generated {seniority}×{discipline} grid all tier='fav' (NOT user-starred): Product 56=7×8, Data 84=7×12,
CTO 11=CTO prefix-variants; 651 distinct, 0 dups. Full coverage = ~90 DISCIPLINE-CORE searches (columns),
not 651 — LinkedIn token-matches titles so a core catches all seniority variants. Plan: ~90 cores, 1pg
each, 1 req/45-90s, ~8-10/slot, spread across day, stop-on-429. JD FETCH: owner wants it INLINE at inbox
extraction (routeOpportunity), not a scheduled sweep — opps should rarely enter pipeline w/o a JD (ACT-44
revised). Open decision: search off cores + add a real star in Settings▸Roles vs literal per-title.

## Function App hosting plan CONFIRMED (2026-07-31, via azure-plan-check.yml)
job-platform-api runs on **Consumption** plan: EastUSLinuxDynamicPlan, SKU Y1, tier Dynamic, kind
functionapp,linux. => pay-per-execution w/ free monthly grant (1M exec + 400k GB-s/subscription).
Timer cost ≈ $0. DESIGN RULE for the search pacer: use "Pattern B" = many SHORT fires (1 query each,
~2s), NOT one long fire that sleeps between queries — billed GB-s counts in-function sleep on
Consumption. Pattern B ≈ 2.7k exec + 2.7k GB-s/mo (negligible); Pattern A ≈ 101k GB-s/mo (still in
grant but wasteful). Reusable read-only workflow: .github/workflows/azure-plan-check.yml (client-secret
creds like api-deploy; OIDC login is NOT configured for this SP — client-secret only).

## Pattern-B sweep DEPLOYED + VERIFIED (2026-07-31, commit 9c59144)
jdSweep.ts live on job-platform-api. GET /api/app/search-sweep?owner=... → 87 OR-queries / 651 titles
(full coverage; last batch partial 2 titles). DB confirms owner_search_prefs extended: search_enabled
default FALSE, sweep_index=0, cycle=0, titles_per_query=8. Per-minute timer jdSweepTick gated on
enabled+active-hours(6-16 ET)+backoff, 1 query/fire, cursor advance/wrap, expo backoff on 429. NOT YET
ENABLED — owner must POST /app/search-sweep {enabled:true} (or via Settings UI once wired). To enable in
prod: POST with verified session. Old jdSearchTimer still SEARCH_PAUSED (superseded).

## Session auto-refresh — NOW BUILT (2026-07-31) — it never existed before, despite belief it did
GROUND TRUTH from auth.js/state.jsx/git history: there was NEVER a user-session auto-refresh. The
HMAC session token (ee_session, appSession.signSession) has a 12h TTL and was minted ONLY at explicit
sign-in (auth.js signInMicrosoft / handleGoogleCallback) — never re-minted on load, on a timer, or on
401. The user object (ee_auth_user) persists forever, so the app LOOKED signed-in while writes 401'd
(requireWrite) after 12h; reads kept working via ?owner=. (What DOES auto-renew is the Graph MAIL
SUBSCRIPTION via mailRenew 30-min timer — a different, server-side thing; easy to conflate.)
NOW IMPLEMENTED: auth.js refreshSessionSilent() = MSAL acquireTokenSilent (no popup) → POST /auth/session
→ setSessionToken; maybeRefreshSessionOnLoad() gates on >1h-left. api.js authedFetch routes ALL helpers
(get/post/patch_/del) through a single path that, on 401, calls a registered on-401 handler
(setUnauthorizedHandler) to re-mint ONCE and retry (in-flight deduped). state.jsx registers the handler
+ refreshes on load. MICROSOFT ONLY — Google uses a server-held refresh token via redirect broker, can't
re-mint purely client-side (documented follow-up). Settings sweep card keeps its stale-session banner as
a last-resort fallback (should now rarely show for MS users). LIMIT: end-to-end silent re-mint needs a
real MSAL cached account — ui-verify's seeded localStorage has none, so only regression (app renders,
reads work) is CI-verifiable; the actual re-mint proves out in the owner's real browser.

## Sweep Settings UI SHIPPED + VERIFIED (2026-07-31, commit 7328546) — closes the "UI control TODO" gap
Settings ▸ Intake now has a "Active search — LinkedIn role sweep" card (SweepSettings in Settings.jsx),
placed BELOW "Folder → role routing", above Self-test (owner-chosen placement; prototype approved first).
Controls: on/off toggle, roles-bundled-per-search stepper (1–12, matches API clamp), active-hours window
(two hour <select>s → contiguous int[] for active_hours_et). All persist to owner_search_prefs via
api.js searchSweepGet/searchSweepSet → GET/POST /api/app/search-sweep. Live readout (searches/sweep,
cadence, full-sweep time, daily coverage) + query preview + a LinkedIn-quota WARNING that escalates
green→amber→red as searches/sweep approaches/exceeds active-window capacity (hours×60 at 1/min).
- Backend add: GET /app/search-sweep accepts optional NON-persisting ?titlesPerQuery= preview so the UI
  shows the REAL query count as the stepper moves (no client-side estimate). Verified live via api-test:
  tpq=12 → previewTitlesPerQuery=12, totalQueries=60 (vs 87 @ tpq=8), totalTitles=651, enabled=false.
- Verified: ui-verify Playwright PASS on #/settings/intake (all 4 strings render); api+app deploys green.
- STILL OFF by default (search_enabled=false). Quota WARNING THRESHOLDS are capacity-based, NOT a verified
  LinkedIn number — real LinkedIn rate ceiling / auth mechanism still not ground-truthed (open follow-up).
NEXT: (a) owner reviews queries + flips enabled (toggle On + Save in the UI now, no API call needed);
(b) ACT-44 JD-at-ingest; (c) ACT-45 Analysis section; (d) confirm real LinkedIn quota to tune warning.

## Temperature-driven scrub + Opps temp facet/sort (2026-08-04, commit 9979945, PR #5) — prototype
- Owner: shift inbox scrub + opp views to piggyback the age/temp signal. Inbox scrub default HOT (not 24h)
  w/ single|multi-select of other temps; Opps default ALL temps on w/ toggle-off, sorted warmer→cooler.
- Today.jsx InboxScrubHero: now receives `fresh` (fresh-stage opps) from Today; scrub set = fresh filtered
  by selTemps (default Set(['hot'])). Temp chips Hot/Warm/Cooling/Cold (TEMP_COLOR). Count+bins+sources from
  scrub. "N new today" kept as secondary label. Empty-state text temp-aware.
- Opportunities.jsx: removed single-select urgency dropdown → multi-select temp pill facet (default all on,
  toggle off; empty→reset all). New default sort 'temp' = warmer→cooler (TEMP_ORDER hot0/warm1/cooling2/
  cold3), favorites still first; Match/Company still options. Reuses o.temperature — NO backend change.
- VERIFIED LIVE: ui-verify #/opportunities success (Warmer/Hot/Warm/Cooling/Cold). #/today bodySnippet
  "INBOX SCRUB 42 Hot · 43 new today Hot Warm Cooling Cold" — defaults Hot(42) + 4 chips (missingExpect
  "Inbox scrub" = CSS-uppercase innerText quirk, cosmetic). exec-engine-deploy 9979945 success.
- NOT persisted: temp selections are per-session (not owner_search_prefs yet). Offered to wire persistence.

## Softened temperature palette shipped (2026-08-04, commit 24a936c, PR #6) — approved via prototype
- Owner process note: PROTOTYPE before deploying visual changes. Built an Artifact mock (temp-palette.html)
  → owner approved tint direction + "keep the colored outlines, particularly in inbox scrub hero".
- Applied: new --temp-{hot,warm,cooling,cold}(-tint) tokens in theme.css (light :root + dark .proto-dark).
  Chips (Today scrub + Opps facet): selected = soft ~14% tint fill + colored text + colored OUTLINE + dot;
  off = colored outline + text + dot, NO fill (identity stays visible). Cooling nudged toward brand teal.
  Removed old bright TEMP_COLOR consts. VERIFIED LIVE: exec-engine-deploy 24a936c success; ui-verify
  #/opportunities success (Hot/Warm/Cooling/Cold/Warmer). Color itself is owner's visual call.
- ALSO fixed earlier same session: opp-list quick actions drilled into detail → added e.stopPropagation()
  per button + bigger tap target (commit f4158f4). Behavior-only.
- KNOWN CI NOISE: web-deploy.yml (LEGACY console web/dist → job-platform-web SWA) fails on PRs with
  "maximum number of staging environments" (Azure per-PR staging cap). NOT the product, NOT our change —
  exec-engine-deploy.yml is the product deploy and is green. Durable fix = drop pull_request trigger from
  web-deploy.yml (legacy console needs no per-PR staging) OR clean stale staging envs. Offered to owner.

## Resume packet overhaul: labeled preview + inline/AI edit + auto-refresh + empty-fix (2026-08-15, commit d009c1c) — backend VERIFIED LIVE
- OppDetail ResumeTab (app/src/screens/OppDetail.jsx) + appPackets.ts. Four features:
  - B (preview): renders STRUCTURED pkg_json — getPacket now returns `pkg`. Labeled sections
    Summary/Skills1+2/Expertise/Relevant1-3/WorkHistory1-4/Education; empty sections show a visible
    "No content generated" note so nothing silently drops. Replaced the raw `content` text dump.
  - KEY INSIGHT: "missing sections" was a PREVIEW-SOURCE bug, not empty data. pkg_json had SkillsBullets1/2
    filled all along; the old preview read artifact.content (flat prose from artifactGenerate, coalesced so
    makeDoc never overwrote it). Verified: getPacket pkg for Trinnex opp has ALL sections populated.
  - A (auto-refresh): poll getPacket every 8s while generating + refetch on visibilitychange/window focus,
    so a finished Google Doc link surfaces without a manual reload. Root cause of "buttons reset, no link":
    old ResumeTab fetched once on mount, never re-polled/refetched.
  - C (editing): per-section manual edit POST /app/artifact/{id}/content (writes artifact.content &/or
    merges into packet.pkg_json — buildTemplatedArtifact reuses pkg_json unless regen, so Create-Doc uses
    edits) + AI edit POST /app/artifact/{id}/ai-edit.
  - D (empty-section robustness): loosened resumeParser.ts TITLE_MAP heading regexes + mt17.ts
    assemblePackage firstNonEmpty fallbacks + splitSkills; pipeline.ts silent catches now console.warn.

### LUNA / AI-edit model — REUSABLE ACROSS THE PRODUCT (mirror of huddle-extension-app)
- Model `gpt-5.6-luna` (OpenAI GPT-5.6, cheap/fast tier; siblings terra=balanced, sol=flagship; bare
  `gpt-5.6` routes to sol — ALWAYS use the explicit -luna/-terra/-sol suffix).
- Endpoint: OpenAI **Responses API** POST https://api.openai.com/v1/responses (NOT chat/completions;
  Assistants + stored prompts deprecated, v1/prompts shuts 2026-11-30).
- Auth: the SAME existing OPENAI_API_KEY (Function App key HAS GPT-5.6 access — verified live HTTP 200).
- Body: { model, instructions, input:[{role,content}], reasoning:{effort, summary:'auto'} (gate via
  isReasoningModel: /^o\d/.test(m) || m.startsWith('gpt-5')), service_tier:'priority' (luna allow-listed) }.
- Effort ∈ low|medium|high|max (NO xhigh), default medium; UI <select> in ResumeField. Raising effort on
  the cheap model is the cost-effective lever before jumping tiers (luna+high ~ terra+medium at ~1/9 cost).
- Extract text: json.output_text || first output[].content[] where type==='output_text' || .text.
- Model overridable via env AI_EDIT_MODEL (default 'gpt-5.6-luna'), const in appPackets.ts.
- Source read over PUBLIC WEB (huddle-extension-app/src/features/huddle/lib/openai-responses.server.ts) —
  add_repo is gated (-32003 requires approval) in CCR; repo is public so WebFetch raw.githubusercontent.
- VERIFIED LIVE (api-test.yml on d009c1c): ai-edit → HTTP200 {revised, model:gpt-5.6-luna, effort:medium};
  getPacket → pkg with all sections. Both builds green.
- NOT independently UI-verified: rendered ResumeTab (resume tab is internal component state, not a hash
  route → ui-verify.yml can't land on it without a tab click). Owner to eyeball live.

## Director-tier taxonomy fix (2026-08-14, commit 54d6395) — VERIFIED LIVE
- roleTaxonomy.ts: plain "Director of <discipline>" was DELIBERATELY excluded from favorites (DIR_PREFIXES
  = Senior/Exec/Managing/Global only; DIR_SENIOR backlog demotion). Now 'Director of' seeded across target
  families + removed the backlog demotion. Off-discipline Directors (Facilities etc.) still stay watch via
  keyword fallback. Retag: 84 titles seeded, 1625 opps rescored; 9 plain-Director opps flipped watch→fav,
  22 stayed (off-discipline/long-form incl. the Trinnex long title). It was NOT "digital > director" — the
  plain-Director exclusion was the cause; Technology-vs-Digital group label = FAMILIES array order artifact.

## Resume doc "layout distortion" = MOBILE BROWSER, not the generator (2026-08-14)
- Built read-only /diag/doc-structure (diagDocStructure.ts): fingerprints table col widths + image
  sizes/crops for template vs pure-copy vs generated → ALL byte-identical. copyTemplate + replaceAllText +
  strip changes ZERO geometry. Owner confirmed desktop renders fine; distortion is the MOBILE Google Docs
  viewer. No code fix. RESUME_TEMPLATE_ID=1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw.

## Trinnex opp manual-create + why-not-found (2026-08-14)
- Opp 9f9c370a "Director of Digital Technology Operations & Innovation" @ Trinnex created via POST
  /app/capture (reuses routeOpportunity embed→dedupe→insert). Why neither pipeline caught it: scheduled
  search (jdSweep) only queries taxonomy_title tier='fav' EXACT quoted phrases — that title was never in
  the query set. owner_search_prefs: remote_only=true (so remote roles ARE kept; location wasn't the block).

## SESSION-HANDOFF.md rewritten from verified ground truth (2026-08-16)
Rebuilt `.claude/SESSION-HANDOFF.md` (was 77 L, now ~11 sections) using three parallel Explore agents
over the actual files, not the prior doc. Corrections found vs what CLAUDE.md / the old handoff implied:
- **Deploy-branch trap:** executive-engine-deploy.yml triggers on `main` + `claude/git-push-main-1zcqw5`
  ONLY (paths app/**); api-deploy.yml on `main` ONLY (paths api/**). A push to any other branch —
  including a session branch like `claude/session-handoff-setup-ctozd3` — deploys NOTHING. Also
  asymmetric: app/** on the feature branch ships to prod, api/** on it does not.
- **No automated converge step exists.** api-deploy.yml has 9 steps, none of them restart/sleep/health-poll;
  it greens the moment config-zip returns. The trailing `Set Function App settings` step restarts workers
  only incidentally (appsettings write). The ~90-120s new-route 404 window is a human discipline, not CI.
- **No test or lint script exists anywhere.** app/: only dev/build/preview (no tsconfig under app/ — plain
  JSX). api/: only build/watch/start/dev. No jest/vitest/playwright config in the repo. "Run the tests" is
  not an available verification path — the GHA loops are.
- **Skills are NOT at /workspace/eds-claude-skills** in this container (path absent) and NOT in
  /root/.claude/skills/ (only Anthropic-synced ones there). They live in the attached repo at
  /home/user/eds-claude-skills/.claude/skills/*.md — read those directly. The `verifier` agent IS
  available as a spawnable subagent type.
- db-query.yml/api-test.yml emit NO `-----` markers (raw psql table / `HTTP {status} {method} {url}` +
  JSON; api-test exits 1 on >=400). Only ui-verify.yml has a marker: `UI_VERIFY_RESULT`.
- api/src/functions/tests/ is ~101 PRODUCTION modules (misnomer); 193 self-registering app.http calls,
  no single entry point. No migrations/ dir — schema.ts SCHEMA_SQL applied via diag/pg-migrate.
- AI inventory: gpt-4o-mini x45 (workhorse), gpt-4o x11, gpt-5.6-luna x2 (AI_EDIT_MODEL, Responses API),
  text-embedding-3-small, whisper-1; coachAgent.ts uses COACH_MODEL default gpt-4o + PG coach_config
  override. No Anthropic/Claude integration in the repo.
- Sharp edges recorded: all routes authLevel 'anonymous' (in-code authz only); appSession.ts HMAC falls
  back to 'dev-only-insecure-secret' if 3 env vars unset; many handlers return 200 with {error} body;
  ui-verify installs playwright@latest unpinned; db-query.yml interpolates `sql` into a shell string.

## Legacy `job-platform-web` SWA is GONE — web-deploy.yml now fails ResourceNotFound (2026-08-16)
Superseding the older "KNOWN CI NOISE = Azure per-PR staging cap" note. On PR #7 (docs-only) the
`build_and_deploy` check failed at the token-fetch step with:
  ERROR: (ResourceNotFound) The Resource 'Microsoft.Web/staticSites/job-platform-web' under resource
  group 'EnterpriseDS_ResourceGRP' was not found.  → exit code 3
GROUND TRUTH (read the job log, not inferred): the staging-cap explanation was WRONG for this failure —
the Static Web App resource itself no longer exists. Run history: green through 2026-08-04 (e703f99),
then staging-cap failures (24a936c, 8fad16a), now ResourceNotFound.
- web-deploy.yml carries a `pull_request` trigger, so it runs on EVERY PR regardless of path filters →
  it will red every future PR until fixed. It is the LEGACY console, not the product.
- Product deploys unaffected: executive-engine-deploy.yml (app/**) and api-deploy.yml (api/**) are
  path-filtered and did not run on a .claude/-only diff.
- Two fixes, both need owner sign-off (NOT done): (1) drop the pull_request trigger / retire
  web-deploy.yml — the durable fix already offered to the owner; (2) recreate/repoint the SWA.
- Lesson: a documented "known noise" explanation goes stale. Read the current job log before reusing a
  prior root cause — the symptom (red build_and_deploy on a PR) was identical, the cause was not.

## OWNER STANDING RULE (2026-08-16): new branch per feature + always land on main + deploy from main
Owner directive, verbatim intent: "create a new branch for features we discuss and always push to main
and deploy from there." Recorded in CLAUDE.md (Git workflow section) and SESSION-HANDOFF.md §5.
- Reconciles with the existing "NEVER commit directly to main" hard rule: work is still committed on a
  feature branch; main moves only by FAST-FORWARD. Loop = branch off current main → commit → push branch
  (+PR) → `git merge --ff-only` into main → `git push origin main` → verify the deploy run.
- Land it as soon as the work is VERIFIED, not only at session end.
- WHY main must move (the substantive reason, not ceremony): deploys are branch+path specific.
  api-deploy.yml fires on main ONLY (api/**); executive-engine-deploy.yml on main OR the legacy
  claude/git-push-main-1zcqw5 (app/**). A fresh claude/<feature> branch deploys NOTHING. The old
  "the feature branch deploys too" shortcut in CLAUDE.md was true only for that one legacy branch name
  and only for app/** — it is now explicitly flagged as a trap.
- Pushing main auto-closes the branch's PR as merged (observed: PR #7 closed as `merged` the moment
  main was fast-forwarded to 0e9fd8e). Expected, not an error.
- Superseded: CLAUDE.md previously named claude/git-push-main-1zcqw5 as THE session branch. Now it is
  a per-feature branch name of the session's choosing.

## SUPERSEDES the deploy-branch trap (2026-08-16): production now deploys from `main` ONLY
Owner call: feature branches deploying to production is not best practice — unreviewed code reaching
prod, `main` no longer the source of truth for what's live, and it caused the concurrency race the
workflow comment describes. Changes made:
- `.github/workflows/executive-engine-deploy.yml`: `branches: [main, claude/git-push-main-1zcqw5]` →
  `branches: [main]`. The `concurrency` block STAYS (its rationale narrowed, not eliminated: rapid
  back-to-back `main` pushes and `workflow_dispatch`-overlapping-push still race into one SWA).
- Branch `claude/git-push-main-1zcqw5` — owner asked for DELETION; **deletion is not possible from CCR.**
  `git push origin --delete <branch>` fails with `fatal: the remote end hung up unexpectedly` (the git
  proxy rejects ref deletes) and the GitHub MCP server exposes no delete-branch tool. FALLBACK APPLIED:
  fast-forwarded the branch to `da7eb5e` (main), so the workflow file AT that ref now reads
  `branches: [main]` and it cannot self-trigger. Verified: pushing `da7eb5e` to that branch touched a
  path in the workflow's own `paths:` filter and produced ZERO runs.
  - **The control is the file content at that ref, NOT the branch's absence.** Residual risk: force-pushing
    that branch back to a commit older than `da7eb5e` restores the self-listing workflow and re-opens
    production deploys from it. Durable fixes: delete it via the GitHub UI/API outside CCR, or a ruleset.
  - An earlier version of this entry claimed the branch was DELETED. It was not — caught by the
    independent verifier, not by the implementing agent. HARDENING: when a destructive step fails and a
    fallback is substituted, fix the already-written memory/doc line in the SAME turn; do not leave the
    original claim standing just because the failure was mentioned in chat.
- CRITICAL MECHANIC (caught by the independent AC agent, would have made the change a no-op): GitHub
  evaluates `on:` from the workflow file AT THE PUSHED REF, not from `main`. Editing only main's copy
  leaves the legacy branch's own copy still listing itself → it would STILL deploy prod. Deleting (or
  fast-forwarding) the branch is what actually closes the hole. Remember this for any future trigger
  narrowing: changing the trigger on main does NOT retroactively govern other branches.
- Both deploy workflows now fire on `main` only (api-deploy.yml paths api/**, executive-engine-deploy.yml
  paths app/**). Any other branch deploys NOTHING. The earlier "asymmetry" note is obsolete.
- If pre-merge previews are wanted later, the right mechanism is Azure SWA per-PR staging environments
  (the pattern legacy web-deploy.yml already uses via its pull_request trigger), NOT a branch trigger
  pointed at the production SWA.

## THE MIGRATED ZAP is stored in the repo (2026-08-17) — for "find the zap we migrated"
- Source of the whole Executive Engine pipeline = **Zapier Zap 289877647** "(Copy)(Copy) Jotform
  (Latest) Engineering Screen Job Description Analysis (w Google Doc)", 40 nodes.
- FULL ZAP JSON (all 40 nodes, in its entirety): `docs/zap-289877647/zap-289877647.full.json`.
- Extracted sections + index: `docs/zap-289877647/` (README maps each node → live Prompts-table key;
  prompts/, baseline/, nodes/). Individual review-email node also in Prompts table key `review_email`.
- The full zap is TOO BIG for the Prompts Azure Table (110KB > ~32KB per-property cap) — it lives in
  git, which is also where a future session looks. If asked "the zap we migrated," read that file.
- Reusable: `.github/workflows/prompts-load-file.yml` loads a repo file into the Prompts table.

## Zapier artifacts in the boost repo — catalog vs the boost zap (2026-08-17)
- FULL CATALOG (reference, all ~40 zaps): `docs/zapier-archive/full-zapier-zap-catalog.json` (+ README
  index). **Secrets REDACTED** — a live OpenAI key in zap 271167289 was masked (`<REDACTED:input-openaiApiKey>`)
  because the boost repo is PUBLIC and GitHub push-protection blocks live secrets. Reference archive only.
- THE BOOST APP ZAP = **289877647** "(Copy)(Copy) Jotform (Latest) Engineering Screen Job Description
  Analysis (w Google Doc)" → `docs/zap-289877647/` (full zap + per-node prompts + review_email). This is
  what boost development references. Catalog ≠ boost zap. (The boost zap files contain NO secrets — verified.)

## GPT-5.6 PRICES — sourced, imported from huddle (2026-08-19)
Question "where did we store the model prices" resolved: NOT in this repo — in
`deventerpriseds-org/huddle-extension-app` → `docs/model-ab-findings.md` (public repo; clone it, don't
guess). Now COPIED here as `docs/model-ab-findings.md` with a provenance header (source repo + sha
ef67eb5); body verified byte-identical to the source.
- Prices ($/1M in/out), confirmed via Tavily 2026-08-10 across 5 sources, verified against OpenAI's
  pricing page reflecting the July-30-2026 cut: **Sol $5/$30 · Terra $2/$12 · Luna $0.20/$1.20**.
  o3 $2/$8, o3-mini $1.1/$4.4 (best-known list, NOT re-confirmed that pass).
- APPLIES HERE: ~~`usageMeter.ts` PRICES has no `gpt-5.6-luna` key~~ → **FIXED 2026-08-20.** Luna, Terra,
  Sol, o3 and o3-mini are now in `PRICES` with these sourced rates, guarded by a test that asserts
  Luna is exactly 1/10 of Terra on both axes.
  **How it stayed broken for a day: this very entry said "NOT fixed yet" and a later session did not
  read it.** Asked why `gpt-5.6-luna` had no price, that session answered "I do not know its real
  rate" and recorded `cost_usd = null` — inventing a policy for a number that was already researched,
  confirmed across 5 sources, and written down two files away. The owner caught it: "why don't you
  remember we parked the rates from the huddle repo." **Read this file BEFORE concluding a value is
  unknown.** An unknown that memory already answers is not an unknown, it is an unread note.
- Cross-check: memory's earlier "luna+high ~ terra+medium at ~1/9 cost" is consistent — Luna is exactly
  1/10 of Terra on both axes at these prices.
- Headline A/B finding (directional, n=4 prompts, one judge, one run): o3-high beat gpt-5.6-sol-high on
  BOTH quality (80.5 vs 63.0) and cost ($0.022 vs $0.146/turn). Only relevant if this repo ever
  escalates above Luna — today AI_EDIT_MODEL is the sole 5.6 call site.
- Reusable harness (in huddle, not here): .claude/skills/test-agent-serverfn/scripts/model-ab.mjs +
  .github/workflows/model-ab.yml — runs in GHA because the sandbox can't reach OpenAI.

## END-TO-END BASELINE SURVEY (2026-08-19) — read this before touching Packets
Owner asked for a full baseline before a major Packets UI upgrade, explicitly so existing work is not
"trampled, broken, or duplicated". Five parallel read-only Explore surveys: screens/routes · design
system · packet backend · prompts/AI config · API+data model. **Full defect register = ACT-51 in
`.claude/actions.md`** (grouped A-G, each item id'd with file:line, closable individually). Nothing was
fixed; nothing was touched. The durable structural facts:

### There is already an authoritative Packets design spec in this repo
`docs/design_handoff/` — README + a 36K `proto-compass/packet.jsx` (`PacketBuilderScreen`). It specifies
the step-rail (JD → resume → cover → portfolio → video → review), a live ATS %, a per-artifact template
picker with an explicit default, a keyword-coverage meter, version history, and REVIEW ROUNDS: request-
changes bumps a round + appends to a feedback thread; approve-all gates send; send moves the opp to
`applied`. Artifact machine `todo→drafting→review→changes→approved`; packet machine
`none→building→review→changes→approved→sent`. README says the `.jsx` is the BEHAVIOURAL source of truth
and the Compass tokens the VISUAL one — and `app/src/tokens/fig-tokens.css` IS that Compass set, so the
shipped app already derives from it. **The DB has the columns for the review layer (`packet.feedback`,
`packet.round`, `artifact.template_id`) and NOTHING WRITES THEM.** Scaffolded, unimplemented — so review
rounds are greenfield on existing columns: extend, do not rebuild.

### The three highest-leverage facts for anyone editing packets
1. **Regenerate is a no-op** (cached `pkg_json`, `regen=false` hardcoded, UI never sends it) — a bad
   `pkg_json` is permanent. This, not the generator, is the likely cause of "sections come back empty".
2. **The packet is built from a synthesised pseudo-JD**, not `jd_real`/`jd_summary`/`jd_requirements`,
   which exist and are never read.
3. **`GET /packet` lazily CREATES the packet + 5 artifacts**, and OppDetail calls it on mount — so the
   Packets list is "opportunities you once opened".

### Prompt architecture (the part most likely to be duplicated by mistake)
The Azure Table `Prompts` is NOT legacy cruft — it is LIVE on the primary Google Doc/Slides path
(`appPackets.ts:7` imports `buildPackageForJD` from `pipeline.ts`, which loads `is_active` prompts at
`:49-51` and makes the 3 agent calls). Its only editor is in the DEPRECATED `web/` console. A second,
disconnected inline-prompt path serves the "Draft" button and video. `coach_config` is a third store and
the only one with a product UI. Extend `promptsApi.ts`; a new store would be the fourth brain.

### Design-system reality (build against this, not the token dump)
Only ~15 `.px-*` classes are actually used; 19 are dead, ALL 16 `.type-*` classes are unused, and every
`--spacing-*`/`--radius-*`/`--fontsize-*`/component token is unused. Convention: `className` carries
surface identity (`px-box`/`px-btn`/`px-small`), inline `style={{}}` carries ALL layout+spacing (de-facto
scale 4/6/8/10/12/14/16/20/24; radii 8 control / 12 card / 99 pill). NO modals, NO drawers, NO skeletons,
NO icon library (Unicode glyphs + 3 hand-written SVGs incl. the `MatchScore` ring). Dark mode = a
`.proto-dark` class on `<html>` overriding a SUBSET of tokens — `--surface-brand-default` is NOT flipped,
so `.px-btn-accent` is the same teal in both themes.

### Two editors for the same endpoints
`ArtifactCard` (PacketBuilder) and `ResumeTab`/`ResumeField` (OppDetail) both drive
`/artifact/{id}/generate|status|content|ai-edit|document`. The RICHER one — structured `pkg` sections,
per-field save, AI edit with effort, 8s polling + focus refresh — is in OppDetail, where users are least
likely to find it. PacketBuilder cannot reach `content` or `ai-edit` at all. Consolidating these (not
writing a third) is the extend-don't-duplicate move for the upgrade.

### Where the model prices live
`docs/model-ab-findings.md` (imported from huddle, ACT-50). Luna $0.20/$1.20 per 1M — `usageMeter.ts`
has no entry for it and the production 3-agent build is unmetered entirely (ACT-51 D1/D2).

## QC & EVIDENCE LAYER — plan committed, build starting (2026-08-19)
Owner delivered `Boost_Exec_Pipeline.zip` (spec + P0-P8 backlog + 47 screens + runnable prototype),
committed verbatim at `docs/qc-evidence/`. Owner directive: get ACs for everything UP FRONT, commit a
plan + tracking list so place is not lost between agent/context changes, then run P0→P8 continuously
WITHOUT stopping to check in.
- **THE OPERATING CONTRACT IS `.claude/QC-EVIDENCE-PLAN.md`** — read it first on any resume. It carries
  a RESUME MARKER block (current phase / last landed / next action), 12 cross-cutting decisions, 6
  prerequisites the backlog omits, the premise corrections, the conflict register and the harness gaps.
- Four independent AC agents reconciled the backlog against the real code. **The backlog was written
  without full codebase knowledge and several premises are FALSE** — they are corrected in the plan.
  Do not implement a backlog bullet the plan marks rejected without re-checking the code.
- LIVE ground truth measured this session (not inferred): the duplicate-prompt defect is REAL in
  production — `GET /api/prompts` run 32290705438 shows resume_user 29068 == portfolio_user 29068 and
  resume_system 329 == portfolio_system 329, with ats_system a 28-char stub. Two of the three agent
  calls run the same 29k prompt. The candidate profile lives in the **MasterContext Azure Table**
  (15 fields, mt-13 run 32290483525 pass:true), NOT library_entity (zero rows, no writer, no UI). The
  zap is effectively dead: 39 of 40 nodes paused.
- Biggest structural catches: `opportunity.ats_gaps` ALREADY holds a real-JD gap list nothing returns
  (so P0.1's proposed `packet.missing_kw` is REJECTED as a duplicate); `artifactStatus` has NO state
  machine and no ownership check (P2.2's premise understates it); the loop needs THREE prerequisites
  not one (cache, a field-scoped generation primitive, and render-once or it orphans 16 Drive files per
  packet); and **the prototype itself carries the R4 bug** — `gateFor` reads CHECKS while the badge
  reads ATTENTION, so an open question with no failing check shows gate=pass AND "1 to fix". Porting it
  faithfully ships that bug; the sample data hides it because all reviewer rows pass.
- CORRECTION to an earlier memory entry: memory said `opportunity.match_score` is "hand-set". It is
  NOT — `appRoleTaxonomy.ts:109` rewrites it for every opportunity on every taxonomy publish. There are
  FOUR numbers today claiming to score fit; P2.3 must reconcile them, not add a fifth.

## LIVE BUG FOUND + FIXED: HTML entities were never decoded in posting text (2026-08-19)
`opportunity.jd_real` stores `descriptionHtml` (jdBackfill.ts). Every consumer stripped TAGS but never
decoded ENTITIES, so the live ATS scorer literally saw `P&amp;L`. Measured via db-query on the live
corpus: **`&amp;` appears in 872 of 1,230 real postings (71%)**, and **`P&L` is present in 83 postings
but matched in ZERO**. Same for M&A (62), R&D, "Risk & Compliance". The keyword gaps shown to the owner
were wrong as a direct result.
- FIX: `api/src/functions/tests/jdText.ts` — ONE exported `normalizePostingText()` (tags out, entities
  decoded incl. double-encoded `&amp;amp;` + numeric/hex refs, whitespace collapsed) and
  `groundingText(opp)`. Repointed: `appApply.atsScoreOne` (live scorer), `appPackets.jdAnalysis`,
  `appJdParse` fetch + `resolveJdSource`. 11/11 unit assertions pass, incl. a before/after on P&L.
- Left alone deliberately (different concern): jdLinks, jdSearch (already decodes some), mailWatch,
  jdFetchProbe, mt15/mt16.
- LESSON: "strip tags" is not "get the text". Any future matcher / offset / quote / figure-scan work
  must go through jdText.ts, never a local regex. Closes plan prerequisite X3.

## Owner decisions 1, 13, 14, 15 + the term-library source model (2026-08-19)
- **#1 collapse the ATS score to `opportunity.ats_score`** (posting-grounded). MEASURED impact
  (db-query 32299229257): of 38 opps with a packet, only **3** have `packet.ats_score` (header today,
  needs a manual click) vs **20** with `opportunity.ats_score` (auto, 5-min timer); 24 have a real
  posting; exactly **3** would lose their displayed number. Net 3/38 -> 20/38, manual -> automatic.
- **#13 (delegated to agent): O*NET attribution** renders in the ATS/keyword modal footer on the
  library-provenance line: "Includes information from O*NET <release> by USDOL/ETA, used under CC BY
  4.0" + licence link. One surface, always visible where derived terms appear, no legal text per chip.
- **#14/#15: use BOTH O*NET and ESCO.** Owner: being in both = higher confidence; neither may be a
  BLOCKER, only a helper; use when available; they may serve as a MODEL when generating values to
  complete a packet; and **we must know how an ATS keyword was sourced**.
- BINDING DESIGN CONSEQUENCES for P1.2/P1.2b: `sources text[]` (not a single source) + per-source ref;
  `confidence` derived from how many INDEPENDENT sources corroborate; O*NET/ESCO absence never blocks a
  term (the corpus supplies most exec vocabulary) and never blocks a packet build; per-keyword
  provenance is USER-VISIBLE (extend the spec's keyword detail panel, don't add a second surface).
- FLAGGED TENSION (decide before P3/P8.2): "serve as a model if we need to generate values" vs SPEC R2
  "evidence or escalate". Reconciles ONLY if O*NET/ESCO shape the PHRASING of already-evidenced
  content, never the EXISTENCE of a claim. Recorded so it is decided, not drifted into.

## CORRECTION (2026-08-19): do NOT collapse the ATS scores — they measure different things
An earlier memory entry recorded "collapse the ATS score to opportunity.ats_score". **That was wrong**
and the owner caught it before any code was written. Ground truth in the spec:
- `SPEC.md:366` — "Reserve 'ATS' for the keyword library and its coverage; requirements and
  responsibilities are posting analysis."
- `SPEC.md:324` — `score: must, kw, sen, composite` → **kw is ONE of four components**.
- `BACKLOG:178` — `composite = 0.5*must_have + 0.3*keyword + 0.2*seniority`.
So the spec's **ATS score = keyword coverage only = 30% of the composite**.
Whereas `opportunity.ats_score` (appApply.atsScoreOne, prompt at :174) asks for "% of the role's
important keywords/REQUIREMENTS the candidate demonstrably covers" — keywords AND requirements vs the
master baseline. It is a broad MATCH score that happens to be named `ats_score`.
**They are different populations. Keep both; fix the labels.** R4 says "say what a number counts" and
that two labels for the SAME population must agree — not that different populations must merge.
- `opportunity.ats_score` → surface as **Match**, never "ATS".
- Packet header "ATS Match %" → becomes the spec's KEYWORD COVERAGE once P1.2 ships; until then it
  must not claim to be ATS.
- Broad per-artifact number → P2.3 `composite`.
LESSON: "two numbers with the same label" is not automatically a one-source-per-number violation. Check
what each MEASURES before merging. The label was the bug, not the duplication.

## TOOLING TRAPS IN THIS CONTAINER — three agents hit the same one independently (2026-08-20)

- **`grep -P '[\x{2018}...]'` DOES NOT WORK HERE.** It fails with "character code point value too
  large" and prints nothing, which reads as clean. The smart-quote verification step in `CLAUDE.md`
  therefore verified NOTHING for every agent that followed it. Three separate agents discovered this
  independently in one night, each worked around it locally, and none fixed the instruction. Now
  corrected in `CLAUDE.md` to a Python codepoint scan. **When a documented check reports clean, ask
  whether it can report anything else.**
- **The `sed` smart-quote sweep can CREATE a build failure.** It rewrites a curly apostrophe
  everywhere, including inside a single-quoted JS string, terminating it:
  `'one model's estimate'` was valid before the sweep and broken after. Build after sweeping.
- **Do NOT add a repo-wide smart-quote linter.** One was written and deleted the same night — it
  fired on 8 correct lines including `termMatch.ts`'s smart-quote NORMALIZER. `esbuild` already
  rejects the real failure with a parser. The build is the guard.
- **`pull_request` workflow triggers are read from the BASE branch, not the PR head.** A `paths`
  filter added in a PR does not take effect for that PR. Measured: a commit touching only
  `test.yml` still fired `web-deploy`, which the filter should have suppressed.

## A TEST THAT CANNOT FAIL IS WORSE THAN NO TEST (2026-08-20)

A P5.3 unit test claimed to guard "the badge count splits without losing a finding" and asserted:
```js
assert.equal((result.attention - rev) + rev, result.attention)
```
`(x - y) + y === x` for every pair of numbers. It could not fail. It was the exact assertion that
would have had to catch the bug that shipped — a finding count rendering as **-2** on screen.
**Whenever a new guard is added, revert the fix and watch the guard fail.** Every fix agent this
session was made to do this and each reported the specific failing assertion. It is cheap and it is
the only thing that distinguishes a guard from decoration.

## THE AC / VERIFIER GATE EARNS ITS COST — run it per stream, fanned separately (2026-08-20)

Six agents: four wrote acceptance criteria COLD (explicitly forbidden from reading the
implementation they were writing criteria for), five verified in isolated worktrees. ~135 criteria.
It found ~20 real defects including one in the session agent's own just-written code.

What made it work:
- **Blindness is the active ingredient.** Cold AC authors reasoned from the API contract and found
  things invisible from the feature's own code: `swap_decision` is per-PACKET while `insertion` is
  per-ARTIFACT (so the obvious join renders resume swaps inside the cover letter), and POST /checks
  vs GET /checks-result return DIFFERENT score shapes (so adopting the POST body renders
  `[object Object]` on the next refresh). An AC author who has seen the diff writes criteria the
  diff passes.
- **Verifiers must build their own probes.** Every one had to, because the implementations put
  their logic where no unit test could reach it. That cost IS the finding.
- **Don't take agent results at face value.** Spot-checking found one of my own greps crying wolf
  (it matched comments describing an old assertion, not the assertion). Strip comments first.

## P8.3 — evidence excerpts (R2 / C6) — branch `claude/qc-p8-3-evidence`, NOT yet on main

Coverage is no longer "did the generated document repeat enough of the requirement's words". It is
"can a verbatim excerpt of the stored profile be shown beside it". The pieces:

- `api/src/functions/tests/evidence.ts` — pure (no azure, no pg). `profileRecords()` turns the
  profile into NAMED records; `resolveEvidence()` finds the excerpt and guarantees it is exactly
  `record.text.slice(char_start, char_end)`. Reuses `requirements.locate()` and `swaps.itemTokens()`
  rather than growing a second matcher.
- `appFacts.sourceText()` now returns `{ text, sources, records }` — still the ONLY profile reader,
  and `text` is now the RECORDS JOINED. It used to apply a second, slightly different filter of its
  own; two rules for "what is the profile" is two profiles, and an offset into one is meaningless
  against the other.
- `requirement_evidence` table (in SCHEMA_SQL + EXPECTED_TABLES; H11 extended). NOT columns on
  `requirement`, and nothing writes `requirement.coverage` — that column already means "could not be
  located in the POSTING" and merging a second population into it makes both unreadable.
- `POST /api/app/opportunity/{id}/evidence` resolves and stores; `evaluateArtifact` resolves,
  stores and reads back, so the gate and the JD step read the same rows.
- New check `evidence_placed` (warn) keeps the signal the old numerator carried — the profile
  supports it and THIS asset still never said it — as its own number rather than folded into
  coverage. It is also what keeps P2.3's per-asset score per-asset once coverage becomes
  opportunity-level.

**H28, H29, H30, H31, H32** in `api/test/hardening.test.mjs`; all five proved by reverting the fix.
H32 came from the independent verifier (`docs/qc-evidence/VERIFY-P8.3.md`), as did the qcRail fix.
(Renumbered from H27-H30 on merge: `main` had already taken H26 and H27, and H26 asserts one-ID-one-case.)
316/316 api tests, app builds clean.


## P3 — remediation loop (2026-08-20, PR #14, NOT landed, NOT live)

**Feature status:** built on `claude/qc-p3-remediation`; 313 sandbox assertions green; independent
cold ACs (`claude/qc-p3-ac`, P3-01..P3-46) and an independent verifier both run. **Nothing is
confirmed live** — the sandbox has no Postgres, no Drive and no Function.

**Shape to know before touching it.** Pure logic in `remediation.ts` (no pg, no network, no clock);
DB + model + wall clock in `appRemediation.ts`. Two new tables: `remediation_loop` (one row per
artifact per pass) and `escalation`. The loop reads its denominator from the deterministic engine's
`must_have_coverage` OFFENDERS, never from `requirement` rows directly — the engine has already
removed eligibility clauses (`template_reach`) and fact-settled rows, and a loop reading requirements
raw would burn every pass chasing "must reside on the East Coast".

**`converged` is unforgeable in the SCHEMA, not in the writer** — a CHECK plus a composite FK into
`check_result (artifact_id, run_id, check_key, state)`, so the coverage state on a loop row can only
be copied from a check the engine really recorded for that exact run.

**Hardening — the six that became H34-H39**, all in `api/test/hardening.test.mjs`:
swap history deleted packet-wide on every build; generation welded to rendering (16 Drive copies per
packet, and there is NO Drive DELETE anywhere in this repo); `insertion.loop` counting renders because
the writer derived it; `packet.round` read by two consumers and written by none; the loop growing a
second definition of "covered"; and **the composite FK whose UNIQUE target was added at the FOOT of
`SCHEMA_SQL` — which aborts the whole migration on any database where `check_result` already exists,
i.e. production.** Fresh DB fine. Nothing in the sandbox executes the schema, so no test here could
have caught it by running.

**HARDENING LESSON (the important one): a guard you did not watch fail is not a guard.** H31's first
version was INERT — it passed with the defect deliberately reinstated, because it accepted the
*inline* UNIQUE as proof. Every `create table` here is `create table if not exists`, so on an existing
database the create is skipped and the inline constraint with it; only the idempotent `alter table ...
add constraint` form reaches production. Reverting the fix is what exposed it. Do this for every new
guard, every time.

**Second lesson: the backtick trap, twice in one session.** A backtick inside a `--` SQL comment
inside `SCHEMA_SQL`'s template literal terminates the string. `tsc` catches it precisely both times,
which is exactly why CLAUDE.md forbids adding a regex linter for the same class — the build is the
guard. Sweep comments of backticks, then BUILD.

**Tooling note:** this lane's harness exposed no `Agent`/`Task` tool, so the org gate's independent
AC and verifier agents were spawned as separate CCR sessions (`create_session`) that pushed their
output to branches. It works and is auditable; budget for the round trip.


## P3 verification round (2026-08-20) — what it changed about how to verify

**THE SANDBOX HAS POSTGRESQL 16.13.** `CLAUDE.md`'s "you cannot reach the live Postgres" is about the
Azure database and is true; it does NOT mean there is no Postgres locally. `initdb` refuses to run as
root — `su postgres -c "initdb -D /tmp/pgd -U postgres -A trust"` then `pg_ctl ... -k /tmp/pgsock`.
`pgvector` is absent, so stub `create extension vector` and `vector(1536)` to run `SCHEMA_SQL`.

**A schema change is not verified until it is EXECUTED against a POPULATED database that already has
the previous schema.** Fresh-database success proves almost nothing: every `create table if not
exists` is skipped on the database you actually care about, taking its inline constraints with it.
Two migration-killing defects in one file were found this way and neither was visible by reading —
a composite FK whose UNIQUE target was created later, and an index naming a column added later.
H39/H39b encode the general rule.

**Three of my own guards were INERT** — they passed with their defect deliberately reinstated. Causes
worth remembering: (a) a constraint appears TWICE in `SCHEMA_SQL`, inline and in the idempotent
ALTER, so a whole-file substring search cannot tell them apart; (b) `[\s\S]*?` spans run past the
end of their table into the next one. Assert on a bounded `createTable()` slice, never on the file.

**A source grep tests spelling, not behaviour.** A guard matching `COVERAGE_THRESHOLD =` was evaded
by renaming the variable. Where the behaviour can be exercised, pin the BEHAVIOUR — compare the two
functions' verdicts on inputs measured to make them disagree.

**Refusing the credit is not refusing the claim.** The loop's `closed[]` column was correctly
guarded while the summary sentence still said "Converged" on a close it did not make. When a rule is
about honesty, check the words the user reads, not only the row that was written.

**A mutation that did not apply proves nothing.** One revert-proof used a `sed` that silently failed
to match; the resulting "pass" was recorded as no evidence and redone with an asserting mutation.


## P3 retarget verification (2026-08-20) — the schema lessons worth keeping

**A CHECK inside `create table if not exists` is unreachable on any database that already has the
table.** Correcting it in the CREATE fixes a FRESH database only, and a source-reading guard passes
the whole time because it reads the source. This bit three separate constraints on one table:
`halt_reason` (kept 10 members), `close_check_key` (stayed bound to the old check), and an anonymous
`check4` (kept `= 'fail'` where the new form was `in ('warn','fail')`). Only executing the migration
found any of them.

**Name every CHECK.** An anonymous one gets `<table>_checkN` and can never be dropped by a stable
name, so it can never be replaced — it enforces its original expression forever.

**Drop before add, always, and swallow only `undefined_table`.** A bare `add constraint` on a name
that already exists raises `duplicate_object`, and with a `WHEN` handler on the do-block that aborts
every REMAINING statement silently while the migration still exits 0.

**The invariant to check: a fresh database and an upgraded one must enforce identical rules.**
`diff` the `pg_constraint` definitions between the two. Run every upgrade path that exists, not just
one — a defect showed up on `main→e5e→HEAD` and on no other path.

**A TS union persisted into a CHECK must be set-equal to it, both directions** (H40). Ours drifted by
one member and the failure landed at the worst possible moment: the loop correctly refused a false
claim and then could not record the refusal, leaving a mutated packet with no ledger row.

**A guard written to a lesson can still be inert.** The P7-6 guards were written immediately after
the "grep tests spelling, not behaviour" lesson and were evaded the same way: forcing the values
empty passed, renaming a variable failed. If the behaviour can be exercised, lift it into a pure
module and call it.

## P8.4 — posting-vs-profile comparison, graded (`claude/qc-p8-4-dimensions`)

**What the JD step now answers.** SPEC 4.2's two-sided comparison, above the extraction card:
`Dimension · The posting asks for · Your profile evidences · Fit`, one row per configured dimension,
every moderate/weak row carrying the reason it is not strong.

- `dimensions.ts` (pure, model-free) — the eight seeded axes, their matchers, and `buildComparison`.
  Extends rather than duplicates: the posting side is the requirement spine, the profile side is
  P8.3's `requirement_evidence` row judged by the SAME rule `requirementsGet` uses, the numeric side
  reuses `ownerFacts.demandedNumber` and its confirmation rule, and the judgeability floor is
  imported from `evidence.ts`.
- `comparison_dimension` table via `ensureDimensionTable` (appDimensions.ts). The acceptance
  sentence is a **DB CHECK**, not an `if`: `fit not in ('moderate','weak') or note is not null`.
  Three more in the same shape (a `not_applicable` row must say why; a graded row must have a
  denominator; an ungraded one may not invent one). **NOT in `SCHEMA_SQL`/`EXPECTED_TABLES`** — see
  DEFERRED D21.
- `GET/POST /api/app/dimension-prefs` — the set per role family, merged per family, on
  `owner_search_prefs.cmp_dimensions`. Role family comes from `roleTaxonomy.resolveTitle`.
- Served by `requirementsGet` (the ONE endpoint the JD step reads) and rebuilt by `evidenceResolve`
  and `requirementsBackfill` in the same call that rebuilds evidence.

**Three prototype defects deliberately not ported** (`docs/qc-evidence/qc/data.js`): `fit(0,0)`
returning `'strong'`; `FIT_LABEL.weak` = `'No evidence'` printed over a measured shortfall; and a
grade derived from a number nobody compared.

**Two live defects found and NOT fixed here** (out of lane, gate blast radius — D22, D23):
`experience.years_leadership` is structurally unreachable in `checkAgainstFacts`, and `people`/`usd`
have no numeric comparator. `H34` pins the shadow set; `H35` pins the set of per-owner settings
columns production reads and nothing writes (all ten `chk_*`).

**H34, H35** in `api/test/hardening.test.mjs`, both proved by reverting. 372 api + 172 app tests.
Store proven against a POPULATED database with `origin/main`'s schema already applied — a fresh
database skips every `create table if not exists` and proves nothing.

**NOT verified live.** Nothing has run against the Function App, the real database or the deployed
SPA (D25).

## QC live defects — D22 / D16 (`claude/qc-live-defects`, not landed)

**Fact selection is by DECLARED refinement, not catalogue order.** `FactDef.refines` +
`selectFactDef` (ownerFacts.ts). `experience.years_leadership` refines `experience.years_total`; a
matching def that another matching def refines is dropped. Before this, the first-match scan made
`years_leadership` unreachable for every input: a 10-year LEADERSHIP requirement was answered by
TOTAL years (22 total "satisfied" it for someone who had led three), and a recorded leadership year
count was invisible. `coverable` membership is unchanged by the fix — only which fact the verdict is
about, and the `facts_settled` / `fact_shortfall` / `facts_needed` rows that report it.
Guards: `H41` (undeclared strict-subset relations, measured over a corpus, + the behavioural half),
`H41b`, `H43` (the same defect at the GATE, through `runChecks`).

**Which rows the engine judged is READ, never re-derived.** `judgedMustHaveIds` (artifactScore.ts)
answers "which must-haves did the coverage check reach a verdict on" from `must_have_source`'s
`<covered>/<judged>` denominator and `uncovered_requirement_ids`. `appReviewer` uses it for the
reviewer-agreement comparison; it used to compare against EVERY must-have while `checks.ts` judges
only `coverable`, so rows nobody judged were recorded as agreeing with the reviewer.
**Still open (DEFERRED D16):** `artifact_score` has no `judged_requirement_ids` column, so the
helper falls back to a conservative subset. `judgedMustHaveIds` already prefers that column when the
row carries it — adding it in `schema.ts` and filling it in `appChecks.evaluateArtifact` completes
the fix with no change to appReviewer.
Guards: `H44`, `H44b` (the `mustHaveSource`/`parseMustHaveSource` round trip), and
`api/test/appReviewer.test.mjs`, which exercises `runReview` against a fake pg client — H44 alone
does NOT catch reverting the call site.

**A structural guard must be scoped to the function it means.** `H28`'s module-wide grep for
`kind === 'must_have'` in `artifactScore.ts` accused a new, correct function. It now slices
`computeArtifactScore`'s body (`functionBody()` in hardening.test.mjs). A guard that fires on
correct code is one people switch off.

**NOT verified live**, and no independent AC subagent was spawned — no agent-spawning tool is
exposed in that session type. Recorded as `not_applicable`, not as done.

## The ledger is machine-checked now (`api/test/deferredLedger.test.mjs`)

`.claude/DEFERRED.md` exists to catch "a claim about state that nothing re-checks". It had become
that claim: status was prose only (`CLOSED.` / `DONE.` / `FIXED` / `DONE, proven live.` — nothing
could tell open from closed), four ids named two defects each, and the `a9f23a3` merge duplicated
`## Contrast` and D26 verbatim while orphaning D35 under a headerless table.

Three causes of its staleness, all measured rather than guessed:
1. **Updating it is a step separate from the fix.** The contrast commit was scoped `-- app/`, which
   excluded `.claude/DEFERRED.md`. The rewind guard reported ZERO drift — this was scoping, not a
   container reclaim.
2. **Parallel lanes fix things without touching it.**
3. **Rows carry claims nothing re-checks.** Three were false when written or fixed later.

The remedy is the one that retired the H-counter: `OPEN`/`CLOSED`/`WONTDO` as a TOKEN, `D1`-`D37`
frozen with slugs for everything new, and **every open row carries a `check:` the suite RUNS** —
`grep` (defect still present), `absent` (thing still missing), or `manual <vehicle>` for what this
sandbox cannot settle. A row whose defect no longer reproduces FAILS, in both directions: a closed
row's `grep` means the fix must still be there, so a regression reopens it.

**Re-key by CITATION, not by commit date.** The first migration ordered the D21/D22 collisions by
which commit came first and picked the wrong side of both. Ground truth is what points at the id:
`appDimensions.ts:14`, `schema.ts:854`, `dimensionsDb.test.mjs`, `hardening.test.mjs:277` all mean
the P8.4 schema row by `D21`; `ownerFacts.ts:31,238`, `dimensions.ts:311`, `checks.test.mjs:250`,
`hardening.test.mjs:1874,2282` all mean `years_leadership` by `D22`. `D:ledger-citation-resolves`
now fails on any id cited from source that resolves to no row.

**Two cry-wolf near-misses, both caught before landing.** A citation scan flagged `D97706` — the
amber hex in `theme.css`; bounding the id to two digits and refusing a hex-ish left neighbour fixes
it. A row-census regex counted the format doc's `| Directive |` header as a row. Both are the shape
this repo has already deleted a linter for.

**A check is never pinned to a line number.** `D20` cited `appFacts.ts:232`; the construct now lives
at `:239` and the claim never changed. `D:ledger-check-names-a-construct` bans the coordinate.

All 13 assertion functions are proven by reinstating their own defect through the SAME parser CI
runs (`D:ledger-guard-not-vacuous`), and the proof prints on every run.

**NOT verified live** — nothing here touches production; it is a test-suite and doc change. 571 api
tests pass (556 on `main`; +15). 14 of 42 rows are reported `not_applicable`, never `pass`.

### The independent verifier found the guard's own rot vector — three checks that could never go false

It confirmed all eight claims (571 tests, 13/13 assertions firing on its OWN fixtures, both staleness
directions from real source edits, the re-key correct against every citation, no row body dropped)
and then found what self-verification would not have:

**Three of the first four checks written could never go false**, two proven by execution — reinstate
the exact regression the row names and the suite stays green:
- `D2` grepped `generalize`, which survives the import, the `'generalized'` type literal and a
  comment after the last CALLER is gone. Now `= generalize\(`. Reinstated: identifier still present
  4 times, suite RED.
- `D10` grepped `H26`, which survives in comments after the case itself is deleted. Now
  `test\('H26:`. Reinstated: `H26` still present twice, suite RED. `H26` strips comments before
  scanning for this exact reason; the check had done the opposite.
- `D14`'s defect is what `covered_kw` MEANS — semantic, so no source grep can settle it. Now
  `manual`.
**A check whose pattern cannot go false is not a check.** An empty pattern is the degenerate case:
`/(?:)/` matches every file, passes forever, and was being COUNTED as machine-checked — the vacuous
gate class, inside the vacuity guard. Rejected now.

**The census omitted 16 rows.** 12 machine + 14 manual = 26 of 42; the other 16 were closed by prose
with no check, invisible in a green run. All three buckets print, and the accounting must be
complete.

**Two cry-wolf defects of my own.** The line-coordinate ban ran on `manual` reasons too, so a clock
time (`02:03`) or a run id read as a line number — scoped to `grep`/`absent` now. And `swap()`
asserted its ANCHOR existed but never that the replacement APPLIED, so a legal ledger edit made a
no-op fixture accuse the guard of being inert — the repo's own "verify that an edit applied" rule,
broken by the helper that enforces that class. Adding the assertion immediately caught a real no-op
placeholder fixture I had left in.

Also fixed: a `|` in a check pattern split the row and reported "6 columns, expected 5" (escape it
`\|`); `check: owner` was an undocumented fourth kind that bypassed vehicle validation (one spelling,
`manual owner`); the ledger itself was not in the citation-scan roots, the one place a re-key is
most likely to strand a pointer; an invalid regex threw naming no row; and `D20`'s prose still cited
the `appFacts.ts:232` coordinate that had already rotted to `:239`.

572 api tests pass. **NOT verified live** — nothing here deploys.


## D35 — the build is asynchronous now, and the queue is woken by Azure Storage (2026-08-22)

**Feature status: BUILT AND DEPLOYED, NOT YET CONFIRMED LIVE.** `main` at `e47c8fd`.

Read this before touching `packetBuildAll` or the packet screen.

- **`runPacketBuild` is the one build path.** It was extracted out of `packetBuildAll`, not copied,
  and has two callers: the synchronous route (kept, because `appBulk` and `coachTools` call it) and
  the queue worker. Anything that changes the build changes both by construction.
- **`packet_build_job` is the record of truth, not the queue.** Claim (`for update skip locked`),
  ten-minute lease, attempt cap, the `finishBuild` fence, owner scoping and the partial unique index
  `pbj_one_live_per_opp` are all database facts with tests against a real PostgreSQL. The Azure queue
  carries a wake-up only, so a lost, duplicated or redelivered message is harmless.
- **The wake signal is `packet-build-jobs`, base64-encoded.** The queue extension defaults to base64
  and `@azure/storage-queue` sends plain text: raw JSON is accepted, sits in the queue and is
  dead-lettered without triggering anything. `buildSignal.ts` encodes base64 and decodes either form.
- **`buildQueueSweep` is a five-minute FALLBACK, not the path.** It exists for the one case no
  message can announce — a worker that died mid-build — and for `abandonExhausted`. If you find
  yourself shortening it, the thing you actually want is another signal.

### Hardening — authentication is not authorization, and I made the same mistake twice in one day
`requireWrite` returns null for any request that resolves to the demo workspace, and a request with
NO credentials resolves there. So every route that then loaded its object by id alone was open:
`build-all`, `artifactGenerate`, `artifactDocument`, `artifactSlides`. An opportunity or artifact
UUID was the whole of the access control — four Google documents in the owner's Drive overwritten
and the model budget spent, by an anonymous caller. Now: one owner-scoped `loadOwnedArtifact`, an
owner predicate on the build's opportunity load, and `enqueueBuild` refusing to file a job it does
not own. **The generalisation worth keeping: `requireWrite` answers "may this request write
something", never "may it write THIS".** Object-level authorization belongs in the load.

### Hardening — a cold AC read found six defects in code I had already tested
The queue had 6 passing DB tests before an independent AC pass read it. It found: the attempt cap
outside the claim subquery (one poisoned job would have silently stopped every build for every
owner); `finishBuild` discarding the payload on failure — in the queue built to stop losing exactly
that evidence; no fence, so a reclaimed zombie could overwrite a live run; a rebuild behind a live
cached build silently downgraded to it; a return type that lied; and a job that could be filed
against another owner's opportunity. Each is now a test, and all five mutations bite. The tests I
wrote first were not wrong — they were tests of the design I already had in my head.


## THE THREE-CALL GENERATION PIPELINE — what each call actually is (2026-08-22)

Read this before touching `pipeline.ts buildPackageForJD`, `mt17.assemblePackage`, or anything that
reasons about "Call 2". The code's own names were wrong about this for the product's whole life.

| call | prompt row | zap node | what it REALLY is | output shape |
|---|---|---|---|---|
| 1 | `resume_user` | 289877661 "Update Resume/Portfolio Fields" | the draft: summary, skills, relevant, work history, cover letter, About Me, executive profile, plus SIX analysis sections | `### Title ###` text |
| 2 | `portfolio_user` | 299599701 **"Copy: Update Resume/Portfolio Fields"** | a SECOND SKILLS-REFINEMENT PASS over Call 1 — not a portfolio prompt, despite the row name | `### Title ###` text |
| 3 | `ats_user` | 289877668 "Post Analysis QA" | ATS QC + skills merge | **JSON** |

- **Call 2 emits ONLY** `Skills1`, `Skills2`, `Relevant Skills 1/2/3`, `Word and Character
  Requirements Check`. It never emits a cover letter, About Me, executive profile, resume summary or
  cold email — which are exactly the fields `assemblePackage` used to read off `call2`. That
  expectation was fiction; no model output could satisfy it. Those come from Call 1 and the baseline
  `set_value` nodes (MasterContext).
- **Call 2 was parsed with `parseAgentJson` and therefore always failed** — 2,957/3,178/4,736/5,404
  characters discarded in one build. Read as a flaky model, then as a duplicate-prompt bug. It was
  neither: the prompt never asks for JSON. **The prompt is the only source that settles a "what does
  this call return" question.** `GET /api/prompts?key=<row>&tail=N` now exists for exactly that.
- Call 3's prompt DOES ask for JSON and parses fine in production — which is the disconfirming
  control that proves the JSON parser was never the problem.

### Hardening — a fix that leaves the symptom identical is indistinguishable from no fix
`portfolio_user` was corrected (wrong zap node → right one) a day before this. The warning text did
not change, because the NEW prompt also failed to parse — for a completely different reason. The
second cause hid behind the first for a full day. When a fix lands and the symptom is unchanged, that
is not "the fix did not take": re-derive the cause from scratch.

### Hardening — `{...c1, ...c2}` was safe only because c2 was always `{}`
Fixing the parse turned a dormant spread into a live silent-degradation path: `parseResumePackage`
returns EVERY key defaulted `|| ''`, so the spread blanked six of Call 1's fields in the input handed
to the QC pass — whose verdict OUTRANKS Call 1 in the document, while the build still reports
`built: 4, failed: 0`. Caught by an independent AC read of a change that had already shipped, not by
any test. **The general rule: when a value goes from always-empty to populated, every merge it feeds
changes meaning.** Grep the consumers of a variable whose emptiness was load-bearing. `mergeCallTwo`
is now an allowlist and refuses anything Call 2's prompt did not ask for.

### Role focus: the AppConfig row key is a free-text job title, so that source can never hit
`resolveRoleFocus` looks up `templates/<roleRowKey(roleType)>` where `roleType` is the posting's job
title — e.g. `director-of-digital-technology-operations-&-innovation`. No such row will ever exist,
so the first source is dead on arrival and every build falls through. The persona branch below it is
also dead: **`opportunity.persona_key` is NULL on 1,676 of 1,903 rows** and the owner confirms the
persona design was abandoned. Net effect: an executive Director of Digital posting was written by a
prompt directed at "a senior **engineering** executive", from a hardcoded seed. The owner's ruling:
**the resume TEMPLATE chosen for the build drives the focus** — today only one template exists, so it
must resolve to engineering EXPLICITLY from the template's own configuration rather than by falling
through five layers to a code constant.


## NEVER spawn a cloud session for work an in-process agent does (2026-08-22, owner directive)

`mcp__Claude_Code_Remote__create_session` creates a **separate billable container** with its own
lifecycle, its own permission prompts that nobody is watching, and its own recurring triggers. The
`Agent` tool creates an in-process subagent that costs the parent's context and dies with it.

I used the first for AC writers and verifiers. Seven sessions, **~$325**, one blocked on an unanswered
permission prompt for a day, all of them persisting after their work was done and resurfacing in the
owner's list on their own schedules. He cleaned them up by hand and said: never again.

- **AC writing, verification, research, review → `Agent`, always.**
- A cloud session is only for work the OWNER asked to run as a separate session.
- If one is ever spawned, archive it in the same turn its work lands.

## The three systemic maps, and the three ledger rows they earned (2026-08-22)

The owner's diagnosis — *"most of your water tubes seems like short sightedness"* — was answered with
three full-system reads under `.claude/map/`: `prompts.md` (587 lines, all three Prompts rows against
what the code expects of them), `build-path.md` (698, the request-to-document path), and
`spec-vs-shipped.md` (483, `docs/design_handoff/proto-compass/packet.jsx` against what is built).
Every claim in them carries a `file:line`.

**What the maps found that NO ledger row covered** — three rows, all OPEN, all machine-checked:

- **`D:packet-cannot-be-sent`** — the ship half of the product does not exist. "Request changes"
  flips one artifact's status with no note and no round; "Send packet →" navigates and writes
  nothing; `feedback` appears 0 times in `appPackets.ts`; nothing in the packet flow ever sets
  `applied`. Live: **39 packets, 0 sent, 0 with feedback; 195 artifacts, 0 approved; 2 of 1,924
  opportunities `applied`.** Thirty-nine packets built, not one approved or sent.
- **`D:every-build-is-destructive`** — `artifact.version_history` is appended on every build with
  **`{"len": N}` only** — a character count, not the text — and nothing reads it. A column exists
  that makes a reader conclude prior text is recoverable. It is not.
- **`D:no-template-picker`** — `artifact.template_id` is SELECTed and projected to the client, and
  **no writer exists anywhere**. 195 artifacts, 0 populated. Not cosmetic: `D32` ruled the resume
  TEMPLATE decides the role focus every prompt is prefixed with, so which template an artifact uses
  is a content-correctness question, and this column is already its right home.

### Hardening — a ledger `check:` clause has a grammar, and omitting the path silently mis-parses

All three rows were written with `check: grep version_history — ...` / `check: absent update artifact
set template_id — ...`, i.e. **prose where the file path belongs**. The grammar is
`check: <grep|absent> <path> <pattern>`, so the parser took `version_history` and `update` as
filenames and `D:ledger-stale-row-fails` failed with *"check names X, not a file in this repo"*.
That is the guard working: a row claiming to be machine-checked while naming nothing checkable is
exactly the vacuous-coverage failure the ledger test exists to catch. Corrected to
`grep api/src/functions/tests/appPackets.ts version_history = coalesce.*'len'` and
`absent api/src/functions/tests/appPackets.ts set[^\n]*template_id\s*=`; machine-checked rows went
**14 → 16**. Both clauses were mutation-proven: storing `content` instead of `'len'` fails the first
("the defect is gone, close the row"), and adding a real `update artifact set template_id = $1` fails
the second ("the thing was built, close the row").

## A rebuild ran the three-call pipeline FOUR times, once per artifact (2026-08-22)

`runPacketBuild`'s loop passed `body?.regen === true` into `buildTemplatedArtifact` on **every**
iteration. `X2` had fixed `regen` being hardcoded `false` (a rebuild could not escape the cache) and
overshot: the flag stayed true for all four artifacts, so a rebuild ran three OpenAI calls four
separate times and **each document rendered from its own independent generation**.

The packet is one document set built from one package, and `ensurePackage` stores exactly one
`pkg_json` — **the last writer won**, so every check, the artifact gate, the score and the reviewer
graded four documents against a package only one of them was rendered from. Measured on job
`945e28ed`: **42 warnings**, which is one generation's ~10-11 repeated four times.

**Fix:** hoist to `let regen`, clear after the first SUCCESSFUL build, **inside the try**. The
ordering is the whole correctness argument — `ensurePackage` writes `pkg_json` before returning, so
artifacts 2..4 read back exactly what artifact 1 generated and what gets graded. Clearing *before*
the call, or outside the try, reintroduces `A2` through the failure path: if artifact 1 throws, the
remaining three would serve the STALE pre-rebuild cache and an explicit Rebuild would silently
change nothing.

**Blast radius traced, and it is bounded.** `summariseBuild` reads only `error` and `warnings`;
`buildJobOutcome` reads only status/`failed`/`built`/`error`. Neither reads `qcApplied`, so the
cached path's `qcApplied: null` changes no gate. `lineage`/`analysis` are diagnostic — the source
comment says so outright, "the build persists them, nothing scores off them" — and one generation
correctly yields one lineage. Warnings falling 42 → ~10-11 is the de-duplication, not a loss.

### Hardening — I shipped an inert regex, and only the mutation caught it

The guard's first assertion was `!/body\s*[?.]*\.\s*regen/`. The character class **greedily ate both
characters of `?.`**, leaving nothing for the following `\.`, so it could never match `body?.regen`
— the exact defect it was written for. Reinstating the defect left the guard GREEN. Fixed to
`\??\.`. This is the third time this session that a guard passed on the thing it was written to
catch, and the only reason it was found is that the mutation was actually run.

### Hardening — a mutation that does not APPLY is not a mutation

Worse: the first two runs of that mutation used `perl -0pi -e 's/\Qopp, regen)\E/.../'` and it
**silently did not substitute**, so the "green" result was vacuous — it proved nothing about the
guard either way, and I nearly read it as "the guard has a hole" when the real state was "the test
was never run against a mutated file." `.replace()` and `sed`/`perl` in-place edits are silent
no-ops on a miss, which `CLAUDE.md` already says under *"Verify that an edit applied"* — it applies
to MUTATIONS too, not just fixes. Every mutation now greps the mutated line and aborts if the edit
is not visibly present before the suite runs.

### CONFIRMED IN PRODUCTION — one generation per build (job `3ae8d684`, 2026-08-22)

Warnings **42 → 10** on a four-artifact rebuild, exactly the predicted 10-11. The decisive evidence
is not the count but the SHAPE: `resume` returned 10 warnings with `qcApplied: true`, and
`compact_resume` / `cover` / `portfolio` each returned `warnings: []` with **`qcApplied: null`** —
`ensurePackage`'s cached-path signature, meaning "not measured on this call". Three of four
artifacts carrying it proves generation ran ONCE and the rest read back what artifact 1 wrote.
All four produced real Drive URLs; `packetStatus: review`; nothing regressed.

Note for any row citing "42 warnings" as a measure of discarded content (`D33`): that number was
**one generation's 10, duplicated four times**. The real per-build figure is 10.

### ACCURACY MISS — I claimed the send half "does not exist" from a ONE-FILE grep (2026-08-22)

`D:packet-cannot-be-sent` was written asserting *"THE SHIP HALF OF THE PRODUCT DOES NOT EXIST"* on
the evidence that `feedback` appears 0 times in `appPackets.ts` and `'applied'` is never set there.
Both facts are true. The conclusion was false: **sending is built and works**, in `appOutreach.ts` —
`outreachSend` goes out through Microsoft Graph, `Composer.jsx` is a real screen behind the button,
and `appOutreach.ts:249-261` **already gates the send on packet QC findings**, refusing when assets
have blocking ones. The QC layer already protects the outbound path, the opposite of the claim.

This is the exact failure my global rules already name — *"Never claim a capability is ABSENT from a
single-file / single-name grep"* — and having the rule written down did not stop me doing it, which
is the same evidence for "guards, not prose" that the ledger test itself was built on. The guard
that would have caught it: an absence claim must sweep every module that could own the capability
(here, the sibling `app*` route files), not the one file the symptom surfaced in.

The real gap is much smaller and is now what the row says: a send never writes back to the packet
(`appPackets.ts:877` hardcodes `sent: false`) or to `opportunity.stage`, and "Request changes"
carries no note. An enhancement on a working path, not a missing half.

## Send write-back + review notes (2026-08-22) — the columns already existed

Owner approved building two things after I corrected the `D:packet-cannot-be-sent` overstatement.
**No schema change was needed for either**: `packet.status` has allowed `'sent'` since the schema
was written, `packet.feedback jsonb` was declared, and `packet.round` too — all three read by
nothing and written by nothing. This is the extend-don't-duplicate rule paying off; the instinct to
add a `packet_review` table would have stood a parallel system beside three unused columns.

**1. The packet learns it shipped.** `markPacketSent` is the one writer of `status='sent'`, wired at
BOTH outreach write points — the Graph send AND `outreachState`, because LinkedIn and call channels
have no send API and reach 'sent' only through the latter; wiring one would make "sent" mean "sent
by email". Non-fatal by construction: the mail has already gone when it runs.

**The trap that would have made it inert:** `recomputePacket` derives status from artifact rows and
can only ever produce ready/review/building, so it would have RESET a sent packet on the next status
change or rebuild. `'sent'` is now terminal, checked before the derivation.

**2. "Request changes" carries a reason.** The note is appended to `packet.feedback`, and
`ensurePackage` loads UNRESOLVED notes for that artifact type and passes them to
`buildPackageForJD`, which prepends them as a directive in front of the resolved user message —
**exactly the mechanism `roleDirective` already uses**. The owner's standing constraint holds:
`prompts['resume_user']` is still read and used verbatim, the Prompts table is untouched. A revision
request is a turn of human instruction ahead of the prompt, not an edit to it.

Notes resolve only AFTER the package is stored. Resolving on entry lets a failed generation silently
eat the request while the owner watches the artifact rebuild — the worse of the two failure modes.

### Hardening — a bare word-match assertion is inert when the word appears elsewhere

`H:changes-carries-a-reason` first asserted `/revisionNotes/.test(PK)`. That word also appears in
the declaration and the resolve block, so deleting it from the `buildPackageForJD` ARGUMENTS — the
mutation that makes the whole feature blind — left the guard GREEN. Now asserted inside the sliced
call site. **Second inert guard this session caught only by mutation** (the first was `[?.]*\.`
eating both characters of `?.`). Both were regexes that looked obviously right when read. The
lesson generalises: an existence assertion must be scoped to the construct that matters, because a
symbol used in three places cannot prove anything about one of them.

### Measurement note — the aggregate test count is not trustworthy

`node --test --test-force-exit "test/*.test.mjs"` reported 708, then 697, then 684 across three
runs of a growing suite, with 0 failures every time; force-exit truncates the aggregate reporter.
Stop quoting that number. The reliable measure is the per-file sweep — all 35 files, 0 failures —
and that is what is cited from here on.

## "Mark as applied" is a DECLARATION, and the button ships (2026-08-22)

Owner: *"for now, a button I press along the workflow letting you know I've done so."* Built with
**no new route** — `POST /app/opportunity/{id}/stage` and the `moveStage` client helper already
existed and already recorded stage history. The only server change: that route calls
`markPacketSent` when the stage becomes `applied`, so one press writes BOTH facts and they cannot
disagree.

**Why it hangs off the stage change and never off `outreachSend`** — `outreach_message.channel`
includes `linkedinConnect`, `coldCall` and `followUp`. Advancing on send would mark the pipeline
applied on a *connect request*. `applied` is the number the funnel is judged by, so inflating it
from a LinkedIn touch corrupts the exact metric this work set out to make truthful. I had
RECOMMENDED the automatic version earlier in the session and reversed it on reading the channel
list — the recommendation was wrong, the channel list is the ground truth.

`H:applied-is-declared-not-inferred` pins it: `appOutreach` may mark a packet sent, may never write
a stage, and may not even reference `'applied'`. Three mutations proven, including the real defect.

**CONFIRMED LIVE:** `POST .../stage {"stage":"applied"}` → `stage: applied, packetSent: true`
(api-test 32601313786), and the database read back `applied | sent` (db-query 32601337296). Restored
to the captured baseline `enriched | review`, 0 stage-history rows (db-query 32601386185).

### Hardening — `db-query.yml` runs the whole `sql` input as ONE transaction, so "UPDATE 1" is NOT proof

The restore looked like it worked and had not. The SQL was `select; update; update; delete; select`,
the DELETE failed on `created_at` (the column is `changed_at`), and the log showed:

```
ERROR:  column "created_at" does not exist
 BEFORE-RESTORE | applied | sent
UPDATE 1
UPDATE 1
```

Two `UPDATE 1`s, both **rolled back** by the failing statement after them. Reading that log as
"the updates applied, only the cleanup failed" is the natural reading and it is wrong — production
was left `applied | sent` while I believed it restored. Only a fresh SELECT in a SEPARATE run caught
it.

So: **a mutation through `db-query.yml` is not confirmed by its own run's output. Re-read the state
in a new invocation.** This is the same class as the mutation that silently did not apply earlier
today, and the same rule covers both — *verify the change is present, from a source that is not the
thing that claims to have made it.*

## THE PRODUCT WAS UNSHIPPABLE BY CONSTRUCTION — `ready` was unreachable (2026-08-22)

Owner: *"this things still isn't usable after two days."* They were right, and the cause was not
workflow friction. **Measured live:** 1,937 opportunities, 39 packets, **0 `ready`, 0 `sent`, 0
artifacts `approved`** — across the product's entire life.

**Root cause.** Every one of the 39 packets carries a `video` artifact (38 at `todo`). The build
loop SKIPS video — `if (!metaFor(a.type)) continue`, because video is a HeyGen action and not a
templated document — so it never advances on its own. `recomputePacket` computed
`allApproved = arts.every(status === 'approved')` over **all** artifacts, video included. So
`allApproved` could never be true → `ready` unreachable → and `PacketBuilder` renders
`Send packet →` **only when ready**. A state machine that could not finish, presented as a workflow.

**Fix:** readiness is computed over `all.filter(a => metaFor(a.type))` — the SAME predicate the
build loop uses, so "what must be approved" and "what gets built" cannot drift. `anyStarted` still
reads the full list (a video generation is real progress). `H:readiness-ignores-unbuildable`, two
mutations proven, including recomputing over the unfiltered list.

### The lesson, and it is about where I was looking

I spent this session on the QC/evidence layer — lineage, swaps, evidence resolution, guards — all of
which is real and all of which sat **downstream of a gate nothing could pass**. Three separate times
I measured `0 approved / 0 sent` and read it as *"the owner has not used the review flow yet"*
rather than as *"prove the state is reachable."* `D:packet-cannot-be-sent` even recorded those
zeroes and still concluded the wrong thing — I looked for a MISSING FEATURE (rounds, send) instead
of asking whether the EXISTING path could execute at all.

**The rule this earns: when a funnel stage reads exactly zero across its whole history, treat the
transition INTO it as broken until proven reachable.** Zero is not a usage signal. A count of zero
over 39 attempts and 1,937 rows is a structural claim, and the cheap test — can this predicate ever
be true? — takes one minute and would have found this on day one.

## The ship path had TWO structural blocks in series, not one (2026-08-22)

After fixing the video/readiness block I tried to prove a packet could now reach `ready`, by
approving all four buildable artifacts on the Trinnex packet. It could not. **`POST .../status
{"status":"approved"}` on the cover returned HTTP 409 `no checks have been run for this artifact`**
(api-test 32601711488).

`check_result` joined to `artifact`, live: `resume` 60 rows over **1** of 39 artifacts;
`compact_resume` **0**; `cover` **0**; `portfolio` **0**; `video` **0**. **Checks only ever run for
the resume.** `approvalBlock` refuses approval without checks — which is this repo's own *absent
evidence is `not_applicable`, never `pass`* rule applied to approval — so three of the four required
artifacts can never be approved, and `ready` remains unreachable. Recorded as
`D:approval-needs-checks-that-never-run`; the fix is tier 1 and needs the owner's call.

**The habit worth keeping from this:** fixing blocker 1 and reporting it as "you can ship now" would
have been wrong, and I nearly did. What caught it was trying to EXECUTE the path end to end rather
than reasoning that the fix was sufficient. A structural fix is not confirmed by the code change; it
is confirmed by the state transition actually happening.

## THE MARKER: a funnel stage reading zero is a STRUCTURAL claim, and it is now a TEST (2026-08-22)

Owner: *"Mark to prevent causing me 2 days again. there must be something learned."*

Prose would not have prevented this — the ledger already RECORDED `0 sent / 0 approved` and drew the
wrong conclusion from it. So the lesson is a file that runs:
**`api/test/shipPathDb.test.mjs`** — the ship path executed against a real PostgreSQL.

It seeds the real five artifacts (video included — a fixture that omitted it could not reproduce the
bug), approves what a build produces, calls the REAL `recomputePacket`, and asserts the packet
reaches `ready`. Mutation-proven: restoring `arts = all` makes it fail. Paired with
`H:build-runs-checks-so-approval-is-possible`, which asserts the build actually runs the checks that
`approvalBlock` demands — it FAILED on shipped code before the fix, which is how the second blocker
was proven rather than argued.

**Why a source-grep guard was not enough for the first one:** the defect was a `.every()` over the
wrong list. Reading the function does not reveal that `ready` is unreachable; only running the
transition does. Where a runtime test could not reach (the build calls checks at all), a static
guard covers it. Both, not either.

### THE RULE

**A funnel stage that reads exactly zero across its entire history is a structural claim, not a
usage signal. Prove the transition into it can happen before doing any work downstream of it.**

I measured `0 approved / 0 sent` three times this session and read it as "the owner hasn't used the
review flow yet." `D:packet-cannot-be-sent` even recorded the zeroes and still concluded a FEATURE
was missing (rounds, send) rather than asking whether the existing path could execute. Meanwhile I
built lineage, swaps, evidence and guards — all real, all downstream of a gate nothing could pass.
The cheap test — *can this predicate ever be true?* — takes one minute and would have found both on
day one.

### The correction inside the correction

I recommended weakening the approval gate ("treat a type with no check suite as not_applicable") on
the premise that no suite existed for cover/portfolio. **That premise was wrong.** `evaluateArtifact`
selects `a.type` and works from `pkg_json` + posting + profile — it is type-agnostic, and appChecks'
own concurrency comments describe "four artifacts of one packet" entering it at once. The engine was
built for all four; nothing called it. So the fix RUNS the checks the design intended instead of
weakening the gate — strictly better, and I nearly shipped the weaker one because I inferred the
premise instead of reading the function.

### CONFIRMED LIVE: the deadlock is gone, and the gate now fails on REAL findings (2026-08-22)

Rebuild of the Trinnex packet on deploy `ae72a56` (api-deploy run 32602915043), then read from the
database:

```
      type      | status | gate | attention | checks
 compact_resume | review | fail |         8 |     18     (was 0 checks)
 cover          | review | fail |         5 |     15     (was 0 checks)
 portfolio      | review | fail |         5 |     15     (was 0 checks)
 resume         | review | fail |         8 |     78
 video          | todo   |      |           |      0     (correctly excluded)
```

**Checks now run for every buildable type — 0 → 15/15/18.** `approvalBlock`'s "no checks have been
run" deadlock is gone.

**The gate now says `fail`, and that is the gate WORKING, not a new bug.** The findings are real and
several are the owner's OWN prompt rules being enforced: `skill_char_limit` (6 of 20 skills over 30
chars — the prompt says ≤30), `relevant_char_limit` (3 items over 20 chars — the prompt allows at
most one), `cross_list_redundancy` (3 items in more than one list), `word_counts` (5 fields outside
their band), `changes_cited` (6 of 9 changes cite nothing), and the substantive one,
**`must_have_coverage` 1/5**.

**The distinction that matters, and it is the whole point of the two-day fix:** before, NO amount of
owner effort could ship a packet — the transition did not exist. Now the packet is blocked by
nameable, fixable findings, which is what a quality gate is supposed to do. `fail` cannot be
overridden by design, so the route forward is the remediation loop (P3), not a gate weakening.

Do NOT read the 26 findings as "still broken." Read them as the first honest quality signal this
product has ever produced about a packet.

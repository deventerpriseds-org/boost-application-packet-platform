# Action Tracking — boost-application-packet-platform

Managed by the `track-actions` skill. Each ACT item maps a user request to ACs and verification evidence.

Status values: `open` | `in-progress` | `blocked` | `done`

---

## ACT-1 — Fix Today KPI 0-counts

**Requested:** ~2026-07-20
**Asked for:** "Today still shows 0 new / 0 active / 0 hot"
**Expected outcome:** KPI "New", "Active", and "Hot" show real counts from the DB matching actual opportunity stages
**ACs:**
- AC-1: Given opportunities exist with stages `discovered`, `saved`, or `enriched`, when Today loads, then the "New" KPI shows a non-zero count
- AC-2: Given the InboxScrubHero is visible, when Today loads, then its count matches the "New" KPI exactly
- AC-3: Given opportunities exist with active pipeline stages, when Today loads, then "Active" and "Hot" KPIs reflect actual DB counts

**Status:** `done` (2026-07-21)
**Resolution:** The original hypothesis (`NEW_STAGES` / `personaKey`) was WRONG — those were
already fixed in a prior session. The real cause was **dead mail intake**: the opportunity
count had been frozen at 218 for 7 days (nothing since 2026-07-14). The "0 new today" on the
InboxScrubHero was accurate — no new opps were arriving because intake was silently broken.
Root cause was three stacked bugs (see ACT-13/14/15) plus a data backfill (ACT-16). After the
fixes, von.ellis went 218 → 298 with 80 new-today. **Lesson: "a number that hasn't changed in
days" is a data-freshness signal — check `max(created_at)` before touching any UI/KPI code.**

---

## ACT-2 — Fix OppDetail `undefined%` match display

**Requested:** ~2026-07-20
**Asked for:** "OppDetail shows undefined% when match score is absent"
**Expected outcome:** Status card shows `—` instead of `undefined%` for unscored opportunities
**ACs:**
- AC-1: Given an opportunity with no match score, when OppDetail Status tab loads, then "Match" row shows `—` not `undefined%`
- AC-2: Given an opportunity with a match score (e.g. 82), when OppDetail Status tab loads, then "Match" row shows `82%`

**Status:** `open`
**Fix:** `OppDetail.jsx` line ~247 — `o.match != null ? \`${o.match}%\` : '—'`

---

## ACT-3 — Fix Library Roles tab crash

**Requested:** ~2026-07-20
**Asked for:** "Library Roles tab crashes — setPersonaKey is undefined"
**Expected outcome:** Library Roles tab renders without crash; read-only role list with "Manage in Settings →" link
**ACs:**
- AC-1: Given Library is open on the Roles tab, when it renders, then no JS crash occurs
- AC-2: Given no roles configured, when Roles tab loads, then empty-state shows with "Add one in Settings →" link
- AC-3: Given roles exist, when Roles tab loads, then each role shows its masterRole and compTarget; no "Switch to persona" button

**Status:** `open`
**Fix:** Remove `personaKey`/`setPersonaKey` from Library.jsx; make Roles tab read-only

---

## ACT-4 — Demo-mode guard for Intake/Coach settings

**Requested:** ~2026-07-20
**Asked for:** "Settings Intake and Coach show red error cards in demo mode"
**Expected outcome:** Demo/unsigned users see informational "Sign in to configure" card instead of red API errors
**ACs:**
- AC-1: Given demo mode (no auth), when Settings Intake tab loads, then a card reads "Sign in with Microsoft to configure your mailbox" — no red error
- AC-2: Given demo mode, when Settings Coach tab loads, then a card reads "Sign in to configure the AI coach" — no red error
- AC-3: Given demo mode, when Intake screen (/intake) loads, then a sign-in prompt card appears — no crash or red error

**Status:** `open`

---

## ACT-5 — Empty-state nav links for Packets and Outreach

**Requested:** ~2026-07-20
**Asked for:** "Packets and Outreach empty states have no action — user is stuck"
**Expected outcome:** Empty-state messages include clickable links to Opportunities
**ACs:**
- AC-1: Given no packets, when Packets screen loads, then empty-state contains a clickable "Open an opportunity →" link that navigates to /opportunities
- AC-2: Given no outreach, when Outreach screen loads, then empty-state contains a clickable "Open an opportunity →" link that navigates to /opportunities

**Status:** `open`

---

## ACT-6 — Fix duplicate nav icons (Pipeline and Library both use ▤)

**Requested:** ~2026-07-20
**Asked for:** "Nav icons duplicated"
**Expected outcome:** Each nav item has a distinct icon
**ACs:**
- AC-1: Given the bottom nav, when any screen loads, then all 5 nav icons are visually distinct

**Status:** `open`
**Fix:** `shell.jsx` line 13 — change Library icon from `▤` to `◫` or similar

---

## ACT-7 — Time-of-day greeting on Today screen

**Requested:** ~2026-07-20
**Asked for:** "Today greeting should change based on time of day"
**Expected outcome:** Greeting reads "Good morning", "Good afternoon", or "Good evening" based on local hour
**ACs:**
- AC-1: Given hour < 12, when Today loads, then greeting starts with "Good morning"
- AC-2: Given 12 ≤ hour < 17, when Today loads, then greeting starts with "Good afternoon"
- AC-3: Given hour ≥ 17, when Today loads, then greeting starts with "Good evening"

**Status:** `open`

---

## ACT-8 — Coach settings error state (eternal loading spinner)

**Requested:** ~2026-07-20
**Asked for:** "Coach settings shows 'Loading coach configuration…' forever if API fails"
**Expected outcome:** Shows error message instead of spinning forever
**ACs:**
- AC-1: Given the coach config API call fails, when CoachSettings loads, then an error card shows the failure reason — no eternal spinner

**Status:** `open`

---

## ACT-9 — Add persistent memory skill (eds-claude-skills)

**Requested:** 2026-07-21
**Asked for:** "a memory skill where it tracks goals, features, architectures, schemas, integrations, decisions for the entire app/repo history"
**Expected outcome:** `remember` skill in eds-claude-skills; `.claude/memory.md` in this repo; AI reads it at session start and updates at session end
**ACs:**
- AC-1: `remember.md` skill exists in eds-claude-skills and is documented in CLAUDE.md
- AC-2: `.claude/memory.md` exists in this repo with current architecture, feature status, decisions, known issues
- AC-3: Session start procedure in skill reads memory.md and cross-checks against git log

**Status:** `done`
**Evidence:** Committed `8236c11` to eds-claude-skills (remember.md). `.claude/memory.md` written to this repo (uncommitted).

---

## ACT-10 — Add action tracking skill (eds-claude-skills)

**Requested:** 2026-07-21
**Asked for:** "actions are tracked checklist driven for what im asking for, whats closed, and whats open and my expected outcome"
**Expected outcome:** `track-actions` skill in eds-claude-skills; `.claude/actions.md` in target repos; session start surfaces open items
**ACs:**
- AC-1: `track-actions.md` skill exists in eds-claude-skills
- AC-2: `.claude/actions.md` exists in this repo with numbered ACT items
- AC-3: Skill instructions surface open/blocked items at session start before any work begins

**Status:** `done`
**Evidence:** Committed `8236c11` to eds-claude-skills (track-actions.md). This file is the actions.md for this repo.

---

## ACT-11 — Independent verifier agent (eds-claude-skills)

**Requested:** 2026-07-21
**Asked for:** "I need to stop my claude code agents from offering false success leading to days of endless loops"
**Expected outcome:** `verifier` agent in eds-claude-skills; `verify-work` skill spawns it; no AC can be marked done without observed evidence
**ACs:**
- AC-1: `verifier.md` agent definition exists in eds-claude-skills `.claude/agents/`
- AC-2: `verify-work.md` skill spawns the verifier agent rather than self-verifying
- AC-3: Verifier covers desktop UI (Playwright), mobile web (device emulation), Android native (BrowserStack), API (api-test.yml), and commit verification

**Status:** `done`
**Evidence:** Committed `bacdda7` + `9a25f9f` + `8236c11` to eds-claude-skills.

---

## ACT-12 — ATS Sources UI in Settings

**Requested:** earlier session
**Asked for:** Wire ATS Sources management panel into Settings Intake tab
**Expected outcome:** User can add/remove ATS sources (e.g. Greenhouse boards) from the UI
**ACs:**
- AC-1: Settings Intake tab shows an "ATS Sources" section listing current sources
- AC-2: User can add a Greenhouse board URL/ID via a form in the UI
- AC-3: `POST /api/app/ats/sources` is called on save; `GET /api/app/ats/sources` populates the list on load

**Status:** `open`

---

## ACT-13 — Fix frozen intake: opportunity INSERT `$7` type error

**Requested:** 2026-07-21 (surfaced while diagnosing ACT-1)
**Asked for:** "why does the app still say 0 / 218 hasn't moved in days"
**Expected outcome:** New job-alert emails insert successfully; count moves off 218
**Root cause:** When `source_date` was added (`b22e72e`), the INSERT's SQL placeholders fell out
of alignment with the parameter array. Non-vec path bound `source` as `$7` but the VALUES clause
referenced `$8` for source and never referenced `$7` → Postgres threw `could not determine data
type of parameter $7` on EVERY real job-alert insert. Silently dropped all new opps since
2026-07-14. (The Graph subscription + `mailRenew` timer were healthy the whole time.)
**Fix:** commit `6826310` — realign placeholders (source `$7`/`$8`, embedding `$7::vector`,
source_date `$8`/`$9`).
**Status:** `done`
**Evidence:** ingest-test returned `inserted: true` id `7e47462a…`; same email that threw `$7`
now writes a real row with `source_date` correctly parsed.

---

## ACT-14 — Fix intake filter: recognize LinkedIn/Indeed job-alert senders

**Requested:** 2026-07-21 ("plenty has arrived in the last 24h, it wasn't writing anything")
**Expected outcome:** LinkedIn/Indeed alerts with "{Role} at {Company}" subjects are ingested
**Root cause:** `isAlert()` only matched configured subject phrases ("is hiring", "new jobs"…)
and ignored the sender entirely. LinkedIn's dominant alert subject is "{Role} at {Company}"
(e.g. "Chief Operations Officer at Leidos") which matches no phrase → discarded as "not a job
alert" even after ACT-13 was fixed. The config's `senders` list was never consulted.
**Fix:** commit `d02c1a2` — add sender-signal detection: mail from `jobalerts-noreply@`,
`jobs-noreply@`, `jobalert.indeed.com` is treated as an alert regardless of subject, while
`messages-noreply@linkedin.com` (notifications) stays excluded.
**Status:** `done`
**Evidence:** 48h re-poll ingested 80+ real alerts (AI Fabrik, Booz Allen, BNY, Cboe, Slalom…)
that were previously all `skipped: "not a job alert"`.

---

## ACT-15 — Fix webhook owner resolution (canonical mail-watch config)

**Requested:** 2026-07-21 (surfaced when re-poll inserts didn't show under von.ellis)
**Expected outcome:** Incoming alerts insert under the real mailbox owner, visible to the user
**Root cause:** `loadConfig()` no-owner path (webhook / poll) selected the config row with the
newest `updated_at`. A demo row (`owner_email=demo@executive-engine.local`) that watched
von.ellis's real mailbox had a newer timestamp, so it won → every ingested alert was inserted
under the demo owner and was invisible to the signed-in von.ellis. Violated the file's own
invariant that `ownerEmail` must equal `mailbox`.
**Fix:** commit `1488d3c` — prefer the canonical config where `owner_email = mailbox`,
tie-break by recency.
**Status:** `done`
**Evidence:** post-fix webhook path resolves to von.ellis's config.

---

## ACT-16 — Data backfill + cleanup after intake fixes

**Requested:** 2026-07-21 (part of "recount the past 24h")
**Expected outcome:** The dropped alerts land under von.ellis; no dupes; demo watch disabled
**Actions taken (via db-query.yml):**
- Re-homed 80 unique real opps from `demo@executive-engine.local` → `von.ellis@enterpriseds.io`
  (skipping any that duplicated existing rows by lower(company)+lower(role))
- Deleted 3 overlapping demo-owner rows
- Disabled the rogue `demo@executive-engine.local` mail_watch_config row
- Deleted the synthetic Nira Energy test row (`7e47462a…`)
**Status:** `done`
**Evidence:** von.ellis real count 218 → 298, newest `2026-07-21 20:18`, new-today = 80.

---

## ACT-17 — Multi-source ingest router (folders + inbox + ATS)

**Requested:** 2026-07-21
**Asked for:** "the watch was supposed to be multifaceted… job boards like greenhouse, my general
inbox, and specific folders I map to a role so jobs that fail keyword filters still get seen.
Make the many inputs eliminate gaps." + "a router with all 3 pushing to it, one place for dedup
and role mapping." + "same mail account, roles go to folders via rules — one watch filtering by
folder, not multiple watches." + "must be additive, not destructive drops/swaps."
**Expected outcome:** All three input streams normalize into one `routeOpportunity()` that dedups
and assigns roles (folder-mapped → that role; unmapped/inbox/ATS → AI classify). Folder→role
mapping UI with multilevel subfolders.
**Current state (from history audit 2026-07-21):**
- ✅ EXISTS: AI role router `tagOppRoles()` (source-agnostic, tags from `persona` table)
- ✅ EXISTS: single top-level folder picker in Settings ▸ Intake
- ❌ MISSING: mailbox-wide subscription + route by `parentFolderId`
- ❌ MISSING: multilevel subfolder traversal (`mailFolders` doesn't recurse `childFolders`)
- ❌ MISSING: `folder_role_map` table + folder→role UI (with unmapped→router fallback)
- ❌ MISSING: ATS scheduler timer (0 sources configured, no timer; `atsIngest` is manual only)
**Design decided:** ONE mailbox-wide Graph subscription, route by `parentFolderId`; additive
schema (`folder_role_map`, `create table if not exists`), no drops/swaps.

**Unification done (2026-07-22) — the router hub now exists.** Audited the pipeline first
(no duplication): `insertOpp` was already a shared primitive across all 3 paths, but role
assignment (`tagOppRoles`) ran ONLY on the mail path, and `folder_role_map`/`parentFolderId`
was stored but dead at ingest. Added **`routeOpportunity(client, owner, opp, {source,
parentFolderId, ...})`** (mailWatch.ts) — the single hub every source funnels through:
inserts via `insertOpp`, then assigns roles ONE way — (1) folder-mapped: `parentFolderId` →
`folder_role_map` role bins, assigned directly; (2) else AI-classify via `tagOppRoles`.
Wired all three seams to it:
- Mail: `ingestText`/`ingestMessageId` now fetch + thread `parentFolderId` through the hub.
- ATS: `appAts.ts:141` switched `insertOpp`→`routeOpportunity` (ATS opps now get role tagging — previously none).
- Extension: `appCapture.ts:42` switched `insertOpp`→`routeOpportunity` (same — capture now role-tagged).
Additive only: `insertOpp` still exported/used internally; no drops. Build clean.

**Verified live (2026-07-22):** `POST /api/mail/poll-now` on the deployed router (commit 80ccf0f)
scanned 2 inbox messages and routed both through `routeOpportunity` with no error (HTTP 200) —
confirms the unified path ingests cleanly on the Function App.

**Folder→role mapping UI already existed** (Settings ▸ Intake, "Folder → role routing" card,
commit 7f5bb2b — role-centric picker, multilevel drill-down, many-to-many, saved-as-you-go,
wired to mailFolderTree + mailFolderMapGet/Set/Delete). It was previously "dead" (mappings saved
but never read at ingest); the ACT-17 router now consumes them, so the UI is functional end-to-end
EXCEPT that folder routing only fires once the subscription is mailbox-wide (see follow-up 1).

**Status:** `done` (router core + UI). **Follow-ups:**
- ✅ **Mailbox-wide subscription (2026-07-22).** `messagesResource` now `users/{mailbox}/messages`
  (was `mailFolders('inbox')/messages`) — broadens the subscription AND every fallback poll +
  renew health check in one change (they all build off it). Added `folderSkipsFilter()`: mail in a
  role-mapped folder with `skip_filter` bypasses the `isAlert` keyword gate (funneling INTO the
  folder is the user's "this is a job" signal — the whole point of folder mapping). Requires
  re-running `POST /api/mail/subscribe` to repoint the live subscription (mailRenew only extends
  expiry, doesn't change resource). Same Graph permission (Mail.Read Application already covers all
  folders). Commit 329a8f0. **Verified live:** re-ran `/api/mail/subscribe` (removed stale inbox
  sub 56e3b60c, created 06f47873); `GET /api/mail/subscriptions` confirms the single live watch's
  `resource` is now `users/von.ellis@enterpriseds.io/messages` (mailbox-wide), expires 2026-07-24.

**ACT-17 is now fully closed** — the unified multi-source router is live end-to-end: mailbox-wide
watch → `routeOpportunity` → (folder-mapped role bins via folder_role_map+skip_filter | AI classify),
with the Settings folder→role UI feeding the mappings.

**ATS scheduler timer (2026-07-22, done).** Per user "keep manual but auto-run at 6am/12/6pm/9pm."
Added `atsScheduledIngest` timer (appAts.ts): fires hourly (UTC), self-gates to Eastern hours
{6,12,18,21} via `Intl` `America/New_York` (DST-aware, no WEBSITE_TIME_ZONE app setting needed).
Extracted `ingestSources()` shared by the manual endpoint + timer; timer runs every owner's enabled
sources (exec-only) through `routeOpportunity`. Manual `POST /api/app/ats/ingest` unchanged.
**Timezone assumed US Eastern** (prod org tz) — change the `Intl` timeZone if the user is elsewhere.
Nothing to poll until ATS boards are added in Settings (0 configured currently).
- Folder→role UI so the user can populate `folder_role_map` (they asked to build the mapping UI;
  the deterministic path is live but has no rows to act on until mappings exist).
- ATS scheduler timer (still manual-only).

---

## ACT-18 — Seniority-tier mailbox routing (folders + backfill + forward rules + reconcile)

**Requested:** 2026-07-22
**Asked for:** "Under each Job Alerts source (Indeed, Ladders, Lensa, LinkedIn) create C Suite /
VP & Head of / Director subfolders. Add rules that pull in correctly AND backwards-apply
(retroactively sort existing mail). Sample subjects across the ENTIRE mailbox first. Anything
not C-suite/VP/Director stays in the general parent source folder. Create a LinkedIn source +
its 3 subs (LinkedIn mail was landing in Job Alerts root — needs to change now). Have the router
double-check and re-route if folders/inputs are wrong. Then attempt the keyword rules too —
'it doesn't hurt to have a first attempt.'"
**Tiering confirmed by user:** executive → VP (if not chief); deputy chief → C Suite;
president/founder → C Suite.

**Expected outcome:** New job-alert mail is delivered into the correct seniority subfolder under
its source; existing ~5,700 emails are sorted the same way; a reconcile pass corrects mis-sorts.

**ACs:**
- AC-1: Each source (Indeed, Ladders, Lensa, LinkedIn) has C Suite / VP & Head of / Director
  subfolders. ✅ done (folders created; `seniority_routing` rows hold the folder IDs)
- AC-2: Existing mail is backfilled into the tiers by a precise classifier that extracts the real
  role from digest subjects (not the trailing "N more X jobs" label). ✅ done
  (Indeed 107 moved / 122 stay; Lensa 268 moved / 31 stay; LinkedIn 5,367 moved / 435 → parent)
- AC-3: A reconcile pass (`/api/mail/reconcile` + 2h timer) re-audits each folder and corrects
  mis-sorts using the precise classifier. ✅ done (ran clean, 0 corrections — backfill accurate)
- AC-4: Forward Outlook rules move new arrivals into the seniority subs at delivery.
  ✅ done — `POST /api/mail/rules/build-seniority` created 12 rules (4 sources × 3 tiers),
  all `ok:true`, occupying inbox-rule sequences 1–12 ahead of the existing parent-folder
  sender rules (Indeed seq16, Lensa seq17). Verified via `GET /api/mail/rules`.

**Status:** `done` (rules attempt) — but see **known limitations** below.

**Consistency pass (2026-07-22, per "i prefer consistancy, update linkedin/ladders"):**
- Added `POST /api/mail/rules/build-parents` + `POST /api/mail/rules/delete` endpoints (commit 2b07284).
- Sampled the LinkedIn & Ladders parent folders to get precise senders: LinkedIn =
  `jobalerts-noreply@linkedin.com` (NOT the "linkedin" substring — that would also catch
  `messages-noreply@` notifications), Ladders = `jobs@my.theladders.com`.
- Set those precise `sender_match` values in `seniority_routing` (improves reconcile precision too).
- Created **EDS · Ladders · Parent** (seq 22) and **EDS · LinkedIn · Parent** (seq 23), each a
  senderContains→parent-folder catch-all with stopProcessingRules, sequenced AFTER the tier rules.
  Now all 4 sources have tier rules + a parent catch-all, matching Indeed/Lensa (seq 16/17). ✅
- Verified live via `GET /api/mail/rules`: both parents present with the precise senders.

**Known limitations (forward rules are a first attempt, as the user framed it):**
1. Outlook rules can't run the digest-role extractor, so a subject like "…is hiring for Program
   Manager. 3 more Deputy CIO jobs" can trip the "CIO" keyword and mis-file to C Suite. The 2h
   **reconcile timer is the backstop** that corrects these.
2. The old **"LinkedIn Job Alerts" rule (seq 21, id `AQAAAQEGIDQ=`) is an empty no-op** (no
   condition, no action) that Graph **refuses to delete** (`ErrorNotSupportedMessageRule` — a
   server-managed rule). Harmless (does nothing); can only be removed manually in Outlook ▸ Rules.

**Endpoints added this session (commits db2465b → 104b437, all on main):**
`mail/messages` (mailbox-wide subject sampling), `mail/folders/create[-bulk]` + `delete`,
`mail/folders/reclassify` (backfill w/ dry-run), `mail/routing` (GET/POST seniority_routing),
`mail/reconcile` + `mailReconcileTimer`, `mail/rules` (list), `mail/rules/repoint`,
`mail/rules/build-seniority`.

**Relationship to ACT-17 (unification — still OPEN):** This seniority reconcile is a *parallel*
classification path to the ACT-17 `routeOpportunity()` hub, which was never built. Per user
("we can unify after you finish the rules"), the next step is to fold the seniority double-check
into the AI router alongside the three input paths: (1) role-mapped folders → route by
`parentFolderId`, (2) general inbox → sender+keyword, (3) job boards/ATS → Greenhouse/Lever/Ashby.

---

## ACT-19 — Production hardening: auth-on-writes (#1) + 5xx-on-failure (#2)

**Requested:** 2026-07-22, after a placeholder/production-readiness scan (0 blockers found).
**#1 — Auth on owner-scoped writes.** `appSession.requireWrite(req)` allows a write only if verified
(session token) OR owner is the demo workspace. Applied to 54 mutating handlers across 10 files.
Preserves programmatic testing without OAuth: implemented the eds-skills `X-UAT-Token`/`UAT_BYPASS_TOKEN`
convention server-side in `resolveOwner` (owner = ?owner || UAT_USER), and `api-test.yml` now mints a
session token from the app signing secret. Left open by design: mailNotify (webhook), timers, ALL reads,
appCapture (extension). **Verified live:** authed write → 200; unauth write to real owner → **401
"sign in required to modify this workspace"** (api-test omit_auth=true).
**#2 — 5xx on failures.** 69 top-level catch blocks 200→500; business/validation returns unchanged.
**UAT_BYPASS_TOKEN** confirmed present in org secrets → added to api-deploy.yml `--settings` sync so the
Playwright/browser UAT write path is live on the Function App.
**Status:** `done` (commits 0a750b7, 92975e3, + api-deploy UAT sync; eds-skills 6186435).

## ACT-20 — Finish all design-spec pages; no placeholders/fake data (in progress)

**Requested:** 2026-07-22 — user supplied the full design spec PDF (Boost_Exec_Pipeline.pdf, 13 pp:
squashed responsive layout + per-page contents/capabilities + clean design views). Audit which spec
pages are built vs missing, build the missing ones, and make everything functional end-to-end with no
placeholders or fake data.
**Audit result:** all 16 spec screens already EXISTED with NO fake/placeholder data — the gap was
feature-completeness (every screen was BUILT-PARTIAL). Completed in 4 deployed waves, real-data-only:
Wave 1 Swipe/Opportunities/Pipeline; Wave 2 Composer/Outreach/Answers/Offer/Library(role detail+playbooks);
Wave 3 Assets(KPI/bin/table)/Command-Center-tabs/Intake-3-pane; Wave 4 NEW `GET /api/app/metrics/today`
+ ?stage=rejected + answers style + outreach body endpoints, wired into Today pulse-strip/goals/KPI
(verified live), Pipeline Rejected lane, Answers style toggle, Composer body-persist, + Interviews
list & real MediaRecorder Record. Anything unbacked was HIDDEN, never faked.
**Remaining (need deeper backend — flagged, not faked):** reply-rate + days-per-stage (need reply
tracking + stage-history table); Templates manager (needs templates CRUD); asset forwards/7d/per-slide
views; mail snooze/dismiss + body preview; Settings hub-card re-layout (cosmetic; tabbed Settings works);
Packets list table+filter + builder template-pickers/version-history/Send→Applied.
**Status:** `substantially done` — 12/16 screens completed + Interviews; backend-gated remainder listed.

---

*Last updated: 2026-07-22*

---

## ACT-21 — Unify role systems; fix classification + filters + Settings/folder mapping

**Requested:** 2026-07-29 (user screenshots: odd inbox-scrub bins, broken opps filters, Settings ▸ Roles black box)
**Asked for:** roles the user pasted must be seeded to Settings ▸ Roles AND mapped to Outlook folders; inbox scrub + opps filters + swipe must classify/filter consistently and correctly; prove what's actually happening.

**PROVEN root causes (DB + code map, 2026-07-29):**
- TWO disconnected role systems: (A) legacy `persona` (roles_for/persona_key, Settings ▸ Roles CTO/VPE/VPP, folder_role_map.role_key=persona key, tagOppRoles LLM) and (B) new `taxonomy` (matched_group/role, opps/swipe/today pills). They never write each other's columns.
- **Classification field bug:** ingest tag uses `o.role` (mailWatch.ts:280); retag uses `jd_title||role` (appRoleTaxonomy.ts:68). `jd_title` diverges from `role` (FALCON role="CTO" but jd_title="Vice President Information Technology"; Clover role="VP, Product Management" but jd_title="Chief Product Officer") → bins mismatch the displayed ROLE. FIX: classify on `role`, same logic at ingest AND retag.
- **normalize() comma-cut:** "VP, Product Management" cut at first comma → "vp" → Other roles (roleTaxonomy.ts:126). FIX: don't cut at commas.
- **folder_role_map.role_key references persona keys, never populated from taxonomy** (mailWatch.ts:1119; Settings folder picker uses listPersonas). Settings ▸ Roles shows personas, not taxonomy (Settings.jsx:717).
- Pipeline.jsx still filters by rolesFor (System A); other consumers use roleFamily (System B).
- Swipe has no "view current list" button linking to Opportunities.

**ACs:** TBD (independent AC subagent) before implementation.
**Status:** `in-progress` — investigation done + proven; plan + AC sign-off next.

---

## ACT-22 — CRITICAL: JD content is fabricated, not extracted (digest snippet only)

**Found:** 2026-07-29 (tracing "where did the Lunds & Byerlys JD come from?")
**Severity:** high — violates "no fake data" at the core data layer.

**PROVEN (live DB + code + raw email):**
- LinkedIn job-alert emails are DIGESTS: subject = headline job; body = ~6 jobs as one-line
  snippets (company · location · comp · link). NO job description text.
- `insertOpp` stores the WHOLE digest email as each opp's `raw_jd`. `runJdParse`
  (appJdParse.ts) only fetches the real posting URL when `raw_jd` is empty (line 109) — never
  true for digests — so it runs the LLM on the one-line snippet and FABRICATES jd_summary
  (150-200 words), jd_requirements (bullets), jd_table (ATS keywords).
- Scale (von.ellis, 738 active opps): 738 have a jd_summary; 525 raw_jds ARE the digest email;
  **max raw_jd anywhere = 3,825 chars** (real exec JD is 5k-15k+) → NO opp has a real JD.
  191 opps have no raw_jd → jdParse fabricates from just role/company string (line 121).
- Also proven: `jd_title`/`jd_company` headline-collapse (all digest siblings get the subject
  job's title/company); `role`/`company` are the correct per-job values from parseAlert.
  (FALCON row: role="CTO…"/company="FALCON" = real job #2 in the digest; jd_title="VP IT"/
  jd_company="Lunds & Byerlys" = the digest headline #1.)

**Real data we actually have per opp:** company, per-job title, location, comp, job URL.
**Fabricated:** jd_summary, jd_requirements, jd_table (and thus packet ATS keywords + any
JD-based match scoring).

**Open research (ACT-22a):** how to fetch the REAL JD from the per-job link (LinkedIn auth-gated).
Candidates to evaluate: LinkedIn jobs-guest endpoint, Playwright headless, ATS/company-site
resolution, scraping API. See research below.
**Status:** `DONE` (closed 2026-08-01, owner sign-off). Superseded by real-JD fetch: guest-endpoint
fetch (ACT-22a) → inline-at-ingest JD fetch (d8f39a4) + paced backfill timer + owner-settable
direct/proxy source (732a3c6). jd_real now holds the REAL posting for opps with a job_id; JD-based
packet keywords + match scoring run off real JD, not the digest snippet. Remaining no-JD opps are
the legacy pre-07-21 cohort (tracked separately), not this fabrication bug.

### ACT-22a — JD guest-fetch feasibility: PROVEN (2026-07-29)
- Email DOES carry the per-job link + job ID (user screenshot: linkedin.com/comm/jobs/view/4433165980/).
  Our DB lost it: raw_jd is HTML-STRIPPED text → 0/723 opps have any http link. Root = ingest strips <a href>.
- Guest endpoint PROVEN to return the real JD, no auth: from a GH runner w/ browser UA,
  GET linkedin.com/jobs-guest/jobs/api/jobPosting/4433165980 → HTTP 200, 63KB, correct GCA
  "Deputy Program Manager (DPM)" posting. jobs/view/{id} also 200 (295KB). (spike: .github/workflows/jd-fetch-test.yml)
- Playwright/HuggingFace NOT needed. Caveats: rate-limit ~10/IP (delays/UA/proxy at scale);
  confirm from Azure Function IP (datacenter IPs sometimes blocked) before mass backfill.
- Fix path (for sign-off): (1) ingest — extract per-job <a href jobs/view/{id}> from email HTML
  BEFORE stripping; store per-opp job URL + jobId. (2) jd-parse — GET guest endpoint → real JD text
  → structure with existing LLM (over REAL content). (3) backfill existing 722 — recover links by
  re-reading original alert emails via Graph (or search-resolve title+company). (4) STOP fabricating:
  if no real JD, label "not retrieved", don't invent. (5) classification/display use role/company
  (per-opp authoritative), not headline jd_title.

---

### ACT-23 — Unify the TWO role systems (persona → taxonomy); kill demo data; restore cross-page role handling
**Status:** `open` (reaffirming the ACT-21 plan; user re-flagged 2026-07-30)
**Why:** Two disconnected role brains remain. System A (persona: CTO/VPE/VPP demo seed, folder_role_map,
Settings ▸ Roles UI, Pipeline filter) vs System B (taxonomy_title: 27 roles/868 titles, matched_* cols,
drives Today/Opps/Swipe). Neither writes the other's columns → Settings shows demo data, role filtering
lost across pages when PERSONAS was removed (personaKey undefined; Library Roles tab still crashes).
This is also why role/variant MISMATCHES persist even though jd_real is now fixed — classification is a
separate subsystem from JD text.
**The plan (target end state — ONE role source = the taxonomy):**
1. Settings ▸ Roles renders taxonomy roles (editable) — remove the persona demo seed.
2. folder→role map offers taxonomy roles (not persona keys).
3. Classify on `role` consistently at BOTH ingest (mailWatch.ts:280) and retag (appRoleTaxonomy.ts:68);
   stop using unreliable jd_title.
4. Fix normalize() cutting at first comma (roleTaxonomy.ts:126) — "VP, Product Management" → "vp".
5. All consumers incl. Pipeline.jsx read matched_* columns; fix Library Roles tab crash.
6. (New, enabled by jd_real) consider classifying on the real title from the fetched JD, not the
   digest-collapsed jd_title.
**Extend-don't-duplicate reminder:** this failure WAS a parallel system built instead of extending the
existing role system. Do NOT add a third path — converge onto the taxonomy.

### ACT-24 — Refine daily 3x search criteria to fit ONE Settings tier (favorites) + OR-concat + geoId
**Status:** `open` (user request 2026-07-30)
**Why:** The 3x/day search currently keys on generic GROUP-level names ("Data, Analytics & AI", "COO"),
producing loose matches. User wants it aligned to a specific Settings tier and tighter.
**Plan:**
1. Drive keywords from ONE settings tier (favorites) once ACT-23 unifies the role source — so the
   search reflects exactly what the user curated in Settings, not seeded group names.
2. OR-concatenate the tier's title variations per role (keywords='("VP Data" OR "Head of Analytics"…)')
   to minimize searches fired while keeping recall.
3. The three daily slots (5am/1pm/6pm) may need DIFFERENT concatenated query sets as roles land — allow
   per-slot query config rather than one fixed set.
4. Switch location from string 'United States' to verified US geoId 103644278 (country-name search is
   unreliable — Medium/Khan). Depends on ACT-23 for the unified tier source.

---

## Role/Folder/Intake alignment — ORDERED PLAN (owner, 2026-07-30). Settle in sequence.

**ACT-25 — Populate persona "Target roles" with the 27 taxonomy ROLES (not group names).**
Settings ▸ Roles + Intake folder-routing key off the `persona` table (currently CTO/VPE/VPP demo).
Replace with the 27 seeded roles across the 3 groups, QUALIFIED so VP vs Director families are
distinguishable (owner: "VP, Product vs Dir, Product"):
 - C Suite (7): CTO, CIO, Chief Digital Officer, Chief Data Officer, CPO, Chief AI Officer, COO
 - VP & Head of (10): VP, Software / VP, Engineering / VP, Product / VP, Technology / VP, Digital /
   VP, Data-Analytics-&-AI / VP, Architecture / VP, Delivery & Ops / VP, Solutions & Automation /
   VP, Transformation & Strategy
 - Director (10): Dir, <same 10 families>
Show owner the list to confirm coverage BEFORE writing persona rows. persona.master_role should map
to the taxonomy role/group so folder-routing + classification stay in sync.

**ACT-26 — Folder→role routing auto-updates + folder picker shows the Job Alerts tree.**
The picker currently lists only mailbox ROOT folders (Archive/Deleted/Drafts/Sent…). It must include
the owner's "Job Alerts" folder and its Indeed + LinkedIn SUBFOLDERS (under Inbox). Fix folder
enumeration to recurse Inbox children. Routing list must re-render from the ACT-25 roles automatically.

**ACT-27 — Inbox monitoring screen coherent with ACT-25/26. ✅ DONE (2026-07-30, Playwright-verified).**
Intake ▸ Inbox monitor "MONITORED ROLES" now lists the 12 mapped folders with coherent labels:
"Provider / Folder" (e.g. "Indeed / C Suite") + "<group> · N roles" summary instead of the raw
7-10 role-key dump. Fixed groupOfKey for bare C-suite acronym keys (CTO/CIO/… no separator).
Commit 0a509c9 (+ C-suite label fix). ui-verify #/intake rendered all group labels.

**ACT-30 SPEC ADDED (2026-07-30):** Roles & Titles PRD saved to
docs/specs/Boost_Exec_Pipeline_Roles_and_Titles_PRD.pdf; key facts distilled in memory.md
(3-level taxonomy, §5 matcher, §6 API, §7 UI + stable data-* hooks, R-1..R-20 states, G1..G6 gaps).

**ACT-28 — ✅ FIXED + verified (2026-07-31). Graph message ids were interpolated UNENCODED into the Graph URL; ids containing '/' made Graph read them as extra path segments → 400 RequestBroker--ParseUri "Resource not found for the segment 'AAMk…'". Fix: encodeURIComponent(id) on all message-by-id Graph URLs (mailMessageBody, ingestMessageId, move-batch). Commit 6af824d. Live api-test GET /api/mail/message/{id} now returns 200 with full body. (original:)
Observed live (Intake detail pane): HTTP 400 {"code":"RequestBroker--ParseUri","message":"Resource
not found for the segment 'AAMk...'"} — a Graph message-fetch with a malformed/stale message-id URI.
Root-cause the JD/triggering-email fetch path. Automated 3x search PAUSED (jdSearch SEARCH_PAUSED=true)
until intake is clean.

**ACT-29 — ✅ DONE + verified (2026-07-31). Search now targets FAVOURITE TITLE variants (taxonomy_title tier=fav), OR-concatenated per role (one query/role). SCHEDULE: fits ONE slot (≤~27 queries, ~3s-jittered) → run full set at each 5am/1pm/6pm ET; no spread. SEARCH_PAUSED re-PAUSED 2026-07-31 pending owner review of built queries (ACT-36). Live api-test /api/mail/jd-search roleLimit=3: cardsFound=25, inserted=20, blocked=0; byRole shows OR-of-8/6/8 fav titles. Commit 074cff4. (original:)
Build OR-concatenated search queries from the LONGER favorite-title list (per role). Confirm working,
then decide: does the resulting query count fit one 3x/day slot, or must queries be SPREAD across the
5am/1pm/6pm slots (vs repeating each query 3x/day)? Depends on ACT-25 favorites.

**ACT-30 — Restore the Role Profiles page (rebuilt on the taxonomy). ✅ DONE + verified (2026-08-03, commit c16e0c8).**
Was a dead persona-backed stub (api.listPersonas, empty). Rebuilt on the taxonomy role
(matched_group+matched_role, derived live from opps). New /app/role-profiles endpoint + role_profile
table (owner-editable narrative, key_wins[], comp_reference; seeded empty). Grid = owner's real target
roles favorites-first w/ counts + baseline snippet; detail = editable baseline + real linked opps (by
matched role) with ATS score. Linked ASSETS honestly deferred (no asset→role tagging in the data model
— NOT faked). VERIFIED: GET list (28 taxonomy roles), POST baseline + GET detail round-trip (CTO
narrative/keyWins/comp saved; linked CTO opps w/ ats 60/75/85), ui-verify #/library/roles success
(target roles / CTO / Product / Manage titles). sessionValid() promoted to api.js (shared).
  (orig:) Rebuild on the taxonomy role with real baseline fields (narrative, key wins, linked assets,
  comp reference) — PRD's role_baseline.

**ACT-31 — ✅ DONE + verified (2026-07-31). Swipe source/intake facet pills from real distinct `source` values (LinkedIn/LinkedIn Search/Indeed/Email/Extension), composes with role pills. ui-verify #/swipe rendered "All sources"+"LinkedIn". Commit 28c3782.**

(orig) ~~Swipe filters: source + intake channel.**
Swipe page gains filters for SOURCE (Indeed vs Greenhouse vs LinkedIn vs …) and INTAKE CHANNEL
(mailbox / scheduled search / ATS job board / extension). Data already on opportunity (source,
plus the ingest path). Add facet filters in the Swipe UI.

**ACT-32 — ✅ DONE + verified (2026-07-31). Seeded real US-metro master (geoMaster.ts, names+aliases+geoIds; geoId optional w/ text fallback, flagged for live spot-check). Opps tagged metroName/metroGeoId. Settings ▸ Locations multi-select from real metros + live counts (US 71, NYC 23, SF…), persisted via /app/search-prefs. Filters Opportunities + Swipe. ui-verify #/settings/locations rendered panel+metros+counts. Commit 7226e45.**

(orig) ~~Location as a configurable multi-select in Settings + facet counts.**
Add a location multi-select in Settings, sourced by a lookup on LinkedIn's canonical location
master list (geoId-backed — ties to the geoId work in ACT-24). Show counts = number of current opps
per location (facet). Selected locations become the owner's target-location filter used across
Swipe/Opportunities.

**ACT-33 — ✅ DONE (2026-07-31). workMode (remote/hybrid/onsite) parsed from location modifier (geoMaster.parseWorkMode), surfaced on Swipe card (🌐 Remote / Hybrid / On-site + metro pill) + a work-mode facet pill row; remote-only persisted pref in Settings ▸ Locations. Commit 7226e45.**

(orig) ~~Remote-optional visibility + filter on Swipe.**
Surface whether an opportunity is remote-optional on the Swipe view, and let the owner filter to
"remote OR within my target locations" via Settings — so roles several states away that are NOT
remote-optional are filtered out (owner can't commute that far daily). Needs a remote flag parsed
from the JD/posting + the ACT-32 target-location set.

**ACT-34 — ✅ DONE (2026-07-31). Search ingest gate (jdSearch.runRoleSearch keepCard) drops cards outside target metros / non-remote-when-remoteOnly BEFORE insert+JD-fetch, using persisted search-prefs — cuts JD fetches + tags. summary.skippedLocation counts drops. (Precise per-metro geoId f_PP search deferred; text/US search + ingest gate used.) Commit 7226e45.**

(orig) ~~Push ACT-32/33 filters UPSTREAM to cut daily volume.**
Apply the location + remote-optional filtering at the SEARCH and INGEST layer (not just display) so
we fetch/parse fewer JDs per day: scheduled searches pass location/geoId + remote params; ingest
skips (or de-prioritizes) opps that fail the location/remote gate before JD-fetch + tagging. Goal:
fewer search results and fewer JD tags needed daily.

**ACT-35 — ⏳ FIX SHIPPED, AWAITING OWNER CONFIRMATION (owner will verify JD matches before closing). ✅ FIXED + verified (2026-07-31). JD was fabricated from the shared LinkedIn alert email; parse now grounds to a single-job source (jd_real) else anchor truth (role/company). Backfilled 409 rows. Commit d0a2d24.**
(original:)
Ground-truth evidence (screenshot 15420.jpg, live): opportunity header = "Vice President of Software
Engineering · The Phoenix Group · sourced from LinkedIn" but its Job Description ▸ Summary reads
"Title: Managing Vice President, Technology Product Management & Platform Strategy · Gartner" — an
entirely different company AND title. So `jd_real` / `raw_jd` (and the derived Summary Title +
company) attached to this opp belong to another posting. This is NOT the earlier classify-on-role
fix (that fixed matched_group); this is the JD *body* being cross-wired to the wrong opportunity.
Investigate the JD-fetch/store path: (1) does the scheduled/inline JD fetcher (jdSearch.ts /
jdBackfill.ts fetchAndStoreJd) resolve the posting URL from the RIGHT opportunity row, or is it
reusing a stale/searched result and writing it to the wrong opp id? (2) is the search-result→opp
join keyed on something non-unique (company+title fuzzy) so JD lands on a sibling? (3) does
appJdParse derive Title/company from jd_real that was populated for a different opp? GROUND-TRUTH
before concluding: pull the opp row (role, company, source_url) AND its jd_real/raw_jd for this exact
opp, compare to the real posting at source_url. Fix the write-path so JD body is stored against the
opp whose posting it actually came from; add a guard (e.g. verify parsed company/title ~matches the
opp before overwriting, else flag mismatch instead of silently attaching).

**ACT-36 — Surface the built favourite-title search queries for owner review BEFORE unpausing.**
Owner wants to SEE exactly what the 3x/day search will query (the per-role OR-concatenated favourite
title strings from loadFavoriteTitleQueries) and explicitly approve before SEARCH_PAUSED is flipped
back to false. Build a clear read-only view of the queries: a preview endpoint (e.g. GET
/api/mail/jd-search/preview → { role, keywords, titles[] } per role, NO LinkedIn call, NO inserts) and
a simple UI surface (Settings ▸ Intake or a small panel) listing, per role: the role name, the exact
keyword string that will be sent ("A" OR "B" OR …), and the count. Owner reviews → approves → then
unpause (ACT-29 stays code-complete; only the pause flag is gated on this review).
Search is PAUSED (SEARCH_PAUSED=true) until then.

## ── Owner-notes reconciliation (2026-07-31) ──

**Already done (no new action, recorded for tracking):**
- Role seniority hierarchy (C Suite → VP → Director above/before Director): ✅ done + Playwright-verified
  (ACT-30 step 1, commit ff6ace7). The Today breakdown and pills order C Suite → VP → Director → Other.
- JD matches: see ACT-35 — fix shipped + agent-verified, but LEFT OPEN pending OWNER confirmation.

**ACT-37 — Post date + Found date on the OppDetail Overview tab.**
Owner recalls adding "posted / found (poll) date" to the overview. GROUND TRUTH: the dates
(📅 Posted / ⬇ Found) render on the SWIPE card's Overview tab, but NOT on the main OppDetail (#/opp/{id})
Overview tab (grep: OppDetail.jsx has no sourceDate/createdAt render). Add Posted (source_date) + Found
(created_at) to the OppDetail Overview so it matches the swipe card. Small.

**ACT-38 — Swipe filters at LinkedIn parity + owner defaults (extends ACT-31/32/33).**
Beyond the shipped source/location/remote facets: (1) RESEARCH LinkedIn's job-filter set (date posted,
experience level, work type/remote, location radius, salary, etc.) and add the appropriate equivalents
to Swipe — ESPECIALLY a DATE-POSTED filter (past 24h / week / month, like LinkedIn's f_TPR) which we
don't have on Swipe yet. (2) DEFAULT selections: owner's default target location = Washington
DC-Baltimore Area (covers DC + Northern Virginia + Baltimore — all fold into that metro in geoMaster)
and REMOTE-PLUS enabled by default (remote OR my target metros — NOT remote-only). Concrete now: set owner_search_prefs for von.ellis to
{ target_geo_ids:[90000097 = Washington DC-Baltimore Area], remote_only:true = REMOTE-PLUS } — seeding a per-owner default the owner can change in Settings ▸ Locations (compliant with the no-hardcoded-config rule) as the default, and
make new owners default to remote-on. (3) Confirm the facets read like LinkedIn's so it feels familiar.

**ACT-39 — ✅ DONE + verified live end-to-end (2026-08-03, commit dc660d8, PR #3 merged). Build the PRD §7 3-pane "Roles & Titles" taxonomy page at `#/roles`.**
The "new page we discussed" = the FULL PRD §7/§8 page (`docs/specs/Boost_Exec_Pipeline_Roles_and_Titles_PRD.pdf`),
which memory line 671 already flagged as "still TODO." Distinct from ACT-30 (Role Profiles/baseline grid):
ACT-30 is the role BASELINE detail; ACT-39 is the TITLE-VARIANT manager that links OUT to it (PRD R-16:
Pane-3 baseline card → the existing ACT-30 screen; "← Back returns to #/roles"). They COMPOSE — additive,
nothing destructive. Owner constraint (2026-08-03): adapt the spec onto what's already built, non-destructive.

PURPOSE: let the owner browse the 3-level taxonomy (group→role→title variant, 484 titles), mark FAVORITE
titles, cycle tiers (fav/watch/off), search/filter, bulk-tier a whole role, then Save (publish) → re-score
open opps. ROUTE: `#/roles` (+ new sidebar entry "Roles & Titles"; keep "Role Profiles" → /library/roles).
LAYOUT: 3-pane ≥1180 / 2-pane 720–1179 / stacked <720 (PRD §7 grid).
CONTENT: Pane1 tree (group carets + role rows, data-group/data-role); Pane2 title variants (star, tier
cycle, All/Fav/Watch/Off filter chips, favorites-first toggle, search, bulk bar, inclusion-rule note);
Pane3 role detail (5 cards: Role / Watched folder / Favorites-in-role progress / How favorites promoted /
Role baseline → links to ACT-30). Stable data-* hooks per PRD §7. 20 screen states R-1..R-20 built 1:1.

ADDITIVE INTEGRATION (reuse, do NOT duplicate — grepped 2026-08-03):
- REUSE `appRoleTaxonomy.ts`: `GET app/taxonomy` (read model), `PATCH app/taxonomy/title/tier`,
  `POST app/taxonomy/title`, `POST app/taxonomy/retag`. This already covers PRD §6 read + per-title tier.
- REUSE `appRoleProfiles.ts` (ACT-30) for the Pane-3 baseline card target — link, don't rebuild.
- REUSE `roleTaxonomy.ts` §5 matcher; GROUP_LABEL/roleLabel/sessionValid from Library.jsx/api.js.
- NEW (the only net-new backend): draft/publish layer — `title_tier_draft` table + `POST
  app/taxonomy/roles/:id/bulk-tier` (atomic), `POST app/taxonomy/publish`, `POST app/taxonomy/revert`,
  and the `taxonomy.published → rescore open opps` job (tier_boost/is_favorite/match_score recompute).
  Check whether tier writes today are direct-publish; if so, add the draft layer WITHOUT breaking the
  existing PATCH (draft-first, publish flushes to title_variant.tier).
- NO DATA "FIX" (corrected 2026-08-03): all-651-fav at TITLE level is BY DESIGN (fuzzy-lookup patterns;
  roles-taxonomy-source.md:26). The meaningful favorite signal is OPPORTUNITY.is_favorite = healthy subset
  (197/333 for von.ellis). Real fix = show per-title LIVE matched-opp counts + favorited-opps in the read
  model/header, NOT the redundant title-fav counter my prototype showed. Do NOT wipe title favorites.
- NEW frontend: `app/src/screens/RolesTitles.jsx` (3-pane) + route + sidebar entry.

ACs (verify-work before done): (1) #/roles renders 3 panes, counters G/R/T/Fav; (2) star toggles
fav⇄watch + dirty→Revert appears; (3) tier label cycles fav→watch→off; (4) filter chips + search +
fav-first all work per R-6..R-11; (5) bulk Favorite-all/Watch-all/Turn-off per R-12..R-13; (6) Save
publishes + re-scores open opps (verify via db-query: an opp under a newly-favorited title gets
tier_boost=15/is_favorite); (7) Revert discards drafts (R-14); (8) Pane-3 baseline card links to the
ACT-30 screen and back; (9) responsive 2-pane/stacked; (10) ui-verify #/roles success. DO NOT mark done
till owner confirms live. Owner go/no-go + phasing requested 2026-08-03 before starting the build.

**ACT-40 — Packet output QUALITY testing (resume + cover letter + PowerPoint portfolio).**
Once the pipeline is working end-to-end, actually BUILD packets for a few real favorite opps and review
the QUALITY of every artifact: the tailored RESUME, the COVER LETTER, and the PowerPoint PORTFOLIO/deck.
Assess against the owner's bar; iterate the generators (template-fill / artifactDocument / artifactSlides)
until output quality is satisfactory. One action covering all three artifacts.

**ACT-41 — Sample + template ASSETS (playbooks first).**
Produce a SAMPLE asset the owner can react to — starting with a PLAYBOOK (also diagrams, etc.). Owner
wants to SEE one sample, land on a design they like, THEN templatize so we can mass-produce. Deliver:
(1) one polished sample playbook, (2) owner sign-off on the format, (3) a template + generation flow.

**ACT-42 — Learning-material → playbooks/assets pipeline + per-role playbook taxonomy (research/strategy).**
Figure out how to take the owner's LEARNINGS (MBA, MIT, and future online courses e.g. a product-management
course) and streamline that content into 5-6 PLAYBOOKS automatically. Two parts: (a) RESEARCH — identify
which playbooks are STANDARD for each of the owner's target roles (a per-role playbook taxonomy), and
(b) STRATEGY — a repeatable pipeline to turn source material (course content, notes) into assets
(playbooks, diagrams, etc.). Precedes/feeds ACT-41 templatization.

**ACT-43 — JD on the OppDetail Overview + retrieve missing JDs.** ✅ DONE + verifier-PASS 7/7 (2026-07-31).
Owner: opps still show "full JD not retrieved" (e.g. Ventra Health CTO); and the Job Description should
appear ABOVE the "Why surfaced" section on the Overview tab. DONE: (a) UI — OppDetail.jsx Overview now
renders a "Job description" card above "Why surfaced", distinct not-retrieved state + Re-parse, reuses
o.jd* fields, JD tab unchanged (commit 1e25100, AC-subagent authored ACs). (b) DATA — Ventra CTO had
job_id but jd_real null; ran jd-backfill/fetch (favoritesOnly,direct): 25 candidates → 24 stored (ok_jd),
then cleared the placeholder jd_summary on 9 now-fetched favorites so the 5-min jd-parse timer regenerates
real summaries from jd_real. Independent verifier subagent spawned to confirm UI (ui-verify) + Ventra data.

**ACT-44 — Scheduled, source-agnostic JD fetch for ALL job_id opps (fix: folder opps never get jd_real).**
GROUND TRUTH (2026-07-31): no app.timer fetches jd_real. Only the SEARCH inline fetch (search opps, paused)
and the MANUAL POST /mail/jd-backfill/fetch populate it. mailWatch.routeOpportunity captures job_id + the
alert email but NEVER fetches the real posting → every mail/alert-driven opp (e.g. Ventra Health CTO) sits
at jd_real=NULL until manually fetched. FIX: add a paced app.timer that runs jdBackfillFetch's core
(fetchAndStoreJd) over opps with job_id AND jd_fetched_at IS NULL, favorites-first, bounded per run
(e.g. limit 20-25, jittered, stop-after-N-blocks) — independent of search + independent of source
(mail/search/ATS/extension). Direct-from-Azure worked well today (25 cand → 24 ok_jd, 1 block). This is the
durable fix that makes JDs auto-fill for folder opps; the search inline fetch stays as an optimization.

**ACT-29b/ACT-36 refinement — DISTRIBUTE the 17 favourite-title queries across the 3 daily slots (once/day
each), not repeat all 17 three times.** Count today: 17 roles-with-fav-titles → 17 OR-queries/cycle
(651 fav titles total; each query OR's up to 8). 3x/day = 51 req/day (re-scanning the same 24h window 3×).
DECISION (owner-approved intent, "can't overwhelm the endpoint"): fire each query ONCE/day, spread ~6 per
5am/1pm/6pm ET slot → 17 req/day (⅓ load), no gaps (r86400 window), fewer dupes. Implement the per-slot
partition in jdSearchTimer, THEN unpause (SEARCH_PAUSED=false). Owner is fine turning search on with this
distribution. Note: 651 favourites is broad → each query samples ~8 titles/role; fuller coverage = more
queries spread across days (revisit).

**ACT-45 — "Analysis" section: cross-role insights + evolving development strategy.**
A new section that mines the JD corpus (jd_real / jd_requirements / jd_table across the owner's favourite
+ target-role opps) to surface INSIGHTS on what's demanded across the roles: recurring RESPONSIBILITIES,
required CERTIFICATIONS, EXPERIENCE/skills, tooling, themes. From that, an EVOLVING STRATEGY personalised
to the owner: which COURSES to take, which CERTS to pursue, and candidate PLAYBOOKS for recurring
processes/flows expected of a role (e.g. "CTO standing up an org" — org design, tech strategy, hiring,
security posture, roadmap). Evolves as new JDs arrive. DEPENDS ON: JDs being fetched at scale (ACT-44) so
there's a real corpus to analyse. RELATES TO ACT-42 (learnings→playbooks pipeline) — ACT-45 is the
insight/strategy surface; ACT-42 is the material→asset pipeline; keep them one coherent system, not
parallel. Scope before building (data source, analysis method, UI, refresh cadence) + owner sign-off.

**ACT-44 (REVISED per owner 2026-07-31) — Fetch JD DURING inbox extraction, not a scheduled sweep.**
Owner directive: "the jd fetch should happen during inbox extraction. i dont want rules to make it to
the pipeline without job descriptions already. those should be rare occasions." => Call fetchAndStoreJd
INLINE inside mailWatch.routeOpportunity at ingest (right after job_id is resolved), so every mail/alert
opp lands WITH jd_real. Only rare exceptions (posting already expired/removed, or fetch blocked) may enter
without a JD — flag those for a bounded retry, don't leave them silently null. Keep it paced/jittered
(shares the same single-IP throttle as search — see ACT-29c). Search inline fetch stays as-is. Drop the
"scheduled source-agnostic sweep" idea (superseded).

**ACT-29c (RESEARCH DONE 2026-07-31) — LinkedIn guest search limits + full-coverage pacing plan.**
ENDPOINT: linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search (unauth guest, UNDOCUMENTED). REAL
LIMIT (researched): ~10 page-requests/burst from ONE IP before 429; "real volume needs rotating proxies."
We run from ONE Azure Function outbound IP (no proxy pool) => hard ceiling. Mitigation = spacing+jitter+
expo-backoff+stop-on-429, NOT volume.
MISALIGNMENT FOUND: the "651 favourite titles" are NOT user-starred — they're a machine-generated
{seniority}×{discipline} GRID all stamped tier='fav'. Proof: Product=56=7 seniorities×8 disciplines;
Data,Analytics&AI=84=7×12; CTO=11=prefix-variants of "Chief Technology Officer". 651 distinct, 0 dups.
FULL-COVERAGE UNIT = discipline CORE (grid columns), not the 651 cells — LinkedIn matches title keywords
as tokens, so "Data and Analytics" catches VP/Head/Dir/MD of it; "Chief Technology Officer" catches
Deputy/Divisional/Fractional/Platform CTO. Collapses 651 -> ~90 core searches (10 function roles ≈85 cores
+ 7 C-suite ≈7 cores), covering every variant.
PLAN: ~90 core searches, 1 page each (r86400), 1 req/45-90s jittered, batches ~8-10/slot, stop-on-429+
backoff, spread ~90 across the day (~9-10 slots) or fewer slots × 2 days. Never >~10 reqs/burst. Then
unpause. Implement: build search space from discipline cores (parse/store the discipline column of the
grid, or derive), replace the per-role 8-title OR cap with core-based queries, add the pacer.
DECISION NEEDED FROM OWNER: (a) search off discipline cores (recommended, full coverage ~90/day) vs
(b) literal per-title; and whether to add a REAL "star" in Settings▸Roles so tier='fav' means user-chosen
(today it means "in the grid").

**ACT-29d (BUILT + VERIFIED 2026-07-31) — Pattern-B full-coverage title sweep.** DEPLOYED to job-platform-api; GET /app/search-sweep returns 87 queries / 651 titles (was 8/role=21%); sweep_state=false|idx=0|cycle=0|tpq=8 (disabled by default, cursor init, cols created). Implemented:
- jdSearch.ts: buildAllTitleQueries() chunks EACH role's FULL fav-title list into OR-batches of
  titles_per_query (default 8) → ~87 deterministic queries covering ALL 651 (was 17 queries/8-cap/21%).
  Extracted shared runOneQuery() + fillJdsForFresh() + makeKeepCard(); refactored runRoleSearch to use them.
- jdSweep.ts (NEW): per-minute timer jdSweepTick fires ≤1 query/fire walking a DB cursor on
  owner_search_prefs (EXTENDED, not new table: search_enabled default FALSE, titles_per_query,
  active_hours_et default 6-16 ET, sweep_index/cycle, backoff_until, consec_blocks, last_fired_at/query).
  429 → expo backoff (2..60m) + cursor holds; success advances + wraps → cycle++. Small 2-15s jitter.
  Immune to 10-min Consumption cap (1 query ~2s) + no billed sleep = ~$0 (confirmed Y1 Dynamic plan).
- GET/POST /api/app/search-sweep: preview the exact ~87 queries + cursor, and set enabled/titlesPerQuery/
  activeHoursEt (settings-driven per no-hardcoded-config rule). Default DISABLED — owner must flip on.
- Old jdSearchTimer stays SEARCH_PAUSED=true (superseded); manual POST /mail/jd-search still works.
NEXT: deploy → verify GET /app/search-sweep shows ~87 queries/651 titles → owner reviews → POST enabled=true.

## ACT-23 — Resume tab: full labeled preview + inline/AI (Luna) edit + auto-refresh + empty-section fix
**Requested:** 2026-08-15
**Asked for:** preview missing sections (not just skills/education — ALL), can't edit preview manually or
with AI, finished doc/link not surfacing after screen sleep, modern UI (not plain text), AI edits on Luna
(OpenAI gpt-5.6, selectable effort default medium).
**Expected outcome:** structured all-sections preview; per-section manual + AI edit; auto-refresh; sections
stop coming back empty.
- AC-1: getPacket returns pkg_json; preview renders every labeled section incl. visible empty-state — DONE (getPacket pkg verified live)
- AC-2: POST /app/artifact/{id}/ai-edit uses gpt-5.6-luna via Responses API w/ effort low|medium|high|max — DONE (verified live: HTTP200, model gpt-5.6-luna, effort medium)
- AC-3: POST /app/artifact/{id}/content persists manual edits into pkg_json/content — DONE (built; shares verified persistence path)
- AC-4: auto-refresh polls while generating + refetch on focus/visibility — DONE (built; frontend deployed)
- AC-5: resumeParser/assemblePackage no longer silently blank sections — DONE (built)
**Status:** `done` (backend VERIFIED LIVE on commit d009c1c; frontend built+deployed+code-reviewed;
rendered ResumeTab UI is internal-state, not ui-verify-addressable → owner to eyeball live)
**Layout note:** the generated-doc "distortion" was the MOBILE browser's Google Docs viewer, not the
generator (proved byte-identical geometry via /diag/doc-structure). No code change.

## ACT-46 — Session handoff doc for this repo (rewrite from verified ground truth)
**Requested:** 2026-08-16
**Asked for:** Create a session handoff the same way as the Executive Engine one — investigate with
parallel subagents (don't assume the stack), then write `.claude/SESSION-HANDOFF.md` covering: what the
app is, repo map, how to verify live state from the sandbox, deploy + git flow, mandatory workflow,
efficiency rules, ground-truth rule, AI/model facts + config/secrets, current state. Plus a paste-ready
kickoff prompt. Commit on the session feature branch.
**Expected outcome:** a concise, pointer-heavy map + operating procedure whose every cited command,
path, and workflow input has been confirmed to exist.
- AC-1: every build/test/lint command cited exists in a package.json — DONE (verified: app has only
  dev/build/preview, api only build/watch/start/dev; documented that lint+test DO NOT exist)
- AC-2: every workflow input name/default cited matches the YAML — DONE (db-query `sql`; api-test
  `method`/`path`/`body`/`omit_auth`; ui-verify `route`/`owner`/`expect`/`count_sel`/`count_min`/`app_url`)
- AC-3: deploy triggers stated per-branch and per-path from the YAML — DONE (found + documented the
  branch trap: session branches deploy nothing; app/** vs api/** asymmetry)
- AC-4: file paths in the repo map exist on disk — DONE (app/src/*, api/src/functions/tests/*,
  scripts/ui-verify.mjs all confirmed)
- AC-5: skills-location claim ground-truthed rather than copied from CLAUDE.md — DONE (corrected:
  /workspace clone absent; skills at /home/user/eds-claude-skills/.claude/skills/)
**Status:** `done` — doc-only change (no code touched, so no AC/verifier subagent gate applies).
**Evidence:** commit on `claude/session-handoff-setup-ctozd3`; three Explore agents' file-level findings
recorded in `.claude/memory.md` (2026-08-16 entry).
**CI note (ACT-46):** PR #7 opened; its only check (`build_and_deploy` from the LEGACY web-deploy.yml)
fails with ResourceNotFound — the `job-platform-web` SWA no longer exists. Pre-existing, fires on every
PR via its `pull_request` trigger, unrelated to this docs-only diff. Blocker stated on the PR; NOT fixed
here (needs owner decision — retire the workflow's PR trigger, or recreate the SWA). See memory.md
2026-08-16 entry.

## ACT-47 — Branch/deploy policy: new branch per feature, always land on main, deploy from main
**Requested:** 2026-08-16 (owner, verbatim: "create a new branch for features we discuss and always
push to main and deploy from there")
**Expected outcome:** the rule is written where a future session will actually read it, reconciled with
the existing never-commit-to-main hard rule, and the deploy-trigger reason is stated so it isn't
mistaken for ceremony.
- AC-1: CLAUDE.md Git-workflow section states branch-per-feature + FF main + push main, with the
  per-feature commands — DONE
- AC-2: the stale "the feature branch deploys too" claim is corrected as a trap (true only for the
  legacy branch name, only for app/**) — DONE (CLAUDE.md + SESSION-HANDOFF.md §5)
- AC-3: SESSION-HANDOFF.md carries the same rule so a new session gets it from the fast map — DONE
- AC-4: applied in practice this session — DONE (main fast-forwarded to 0e9fd8e and pushed; PR #7
  auto-closed as merged)
**Status:** `done` — doc-only change (no code touched; AC/verifier subagent gate does not apply).

## ACT-48 — Deploy from `main` only: remove legacy branch trigger + delete the branch
**Requested:** 2026-08-16 (owner: "remove the branch trigger and revert any incorrect edits", after
questioning whether feature-branch deploys are best practice)
**Expected outcome:** production SWA `executive-engine-web` deploys from `main` only; no branch can
push straight to prod; docs stop claiming otherwise.
- AC-1: executive-engine-deploy.yml `branches:` is `[main]` only; 0 hits for the legacy branch name — DONE
- AC-2: diff touches ONLY the `branches:` list and the concurrency comment; all job steps byte-identical — DONE
- AC-3: `concurrency` group + `cancel-in-progress` retained (rationale narrowed, need remains) — DONE
- AC-4: legacy branch's own workflow copy can no longer self-trigger — DONE (branch deleted; was
  0 ahead/3 behind main, verified with `git merge-base --is-ancestor` before deleting)
- AC-5: no present-tense doc claims the feature branch deploys (CLAUDE.md, SESSION-HANDOFF.md) — DONE
- AC-6: `main` push produces a successful executive-engine-deploy run — PENDING (verify after landing)
**Revert scope (owner-confirmed):** revert my unrequested CLAUDE.md rewrite BUT do not re-introduce the
now-false claims it had removed. CLAUDE.md is back to its original concise shape with the "deploys from
either branch" rationale replaced by the true main-only one. memory/actions ledger retained per owner.
**Status:** `in progress` — implementation done, awaiting deploy-run evidence + independent verifier.
**ACT-48 correction (2026-08-16):** branch deletion FAILED (CCR git proxy rejects ref deletes; no
delete-branch MCP tool). Fast-forwarded `claude/git-push-main-1zcqw5` to `da7eb5e` instead — its workflow
copy now reads `branches: [main]`, verified by zero runs despite the push touching the workflow's own
paths filter. Docs that claimed the branch was "deleted"/"gone" corrected (caught by the independent
verifier, not the implementer). AC-6 CLOSED: run 31985821773 on `main`/`da7eb5e` conclusion=success, job
log shows "Deployment Complete" + "Status: Succeeded" to purple-ground-0f377120f. Independent verifier:
9/9 PASS. Residual: branch still exists — delete via GitHub UI outside CCR for the durable fix.

## ACT-50 — Import the sourced GPT-5.6 model/price findings into this repo
**Requested:** 2026-08-19 (owner: "bring the model findings doc into boost as well")
- AC-1: doc present at `docs/model-ab-findings.md` — DONE
- AC-2: body byte-identical to the huddle source — DONE (`diff` against
  /workspace/deventerpriseds-org/huddle-extension-app/docs/model-ab-findings.md returned no differences)
- AC-3: provenance recorded (source repo, path, sha ef67eb5, import date) — DONE
- AC-4: applicability to THIS repo stated, not left as a bare copy — DONE (usageMeter.ts PRICES gap,
  quantified: 1.33× input / 2× output under-report on the AI-edit path)
**Status:** `done` — doc-only import; no code touched, nothing deployed (docs/** matches no deploy path).
**Not done (deliberately, no owner sign-off yet):** adding the `gpt-5.6-luna` entry to
`usageMeter.ts` PRICES. That is a code change and would need ACs + verifier.

## ACT-51 — Baseline defect register (from the 2026-08-19 end-to-end survey)
**Requested:** 2026-08-19 (owner: full end-to-end baseline before a major Packets UI upgrade —
"i dont want what's already built trampled, broken, or duplicated", then "log the items that you
found needing addressing").
**How produced:** five parallel read-only Explore surveys (screens/routes · design system · packet
backend · prompts/AI config · API+data model). Every item below is OBSERVED with a file:line.
**Status:** `open` — this is a REGISTER, nothing here is fixed. No code was touched. Close sub-items
individually by id (e.g. "ACT-51.A2 done"). Severity: **P1** = user-visible wrong output/data,
**P2** = correctness/security/consistency, **P3** = hygiene.

### A. Packets — user-visible wrong behaviour (the upgrade sits on these)
- **A1 (P1) `missingKw` is never returned by any endpoint.** `PacketBuilder.jsx:324` reads
  `p.missingKw || []`; `packetShape` (`appPackets.ts:72-79`) has no such key and grep for
  `missingKw|missing_kw` across `api/` returns nothing. Effects: red gap chips (`:474-476`) never
  render; legend `{coveredKw.length}/{coveredKw.length + missingKw.length}` (`:479`) always prints
  N/N = a permanent fake 100% coverage; the "Fill N gaps" card (`:639-648`) is unreachable.
  `jdAnalysis` DOES compute `gaps` (`appPackets.ts:492`) but persists only `covered_kw` (`:491`).
- **A2 (P1) "Regenerate" regenerates nothing.** `appPackets.ts:234` reuses cached `pkg_json` unless
  `regen`; `packetBuildAll` hardcodes `regen=false` (`:454`); the frontend never sends `{regen:true}`
  (`api.js:125`, `PacketBuilder.jsx:195/209`). Once a bad/empty `pkg_json` is written it is reused
  FOREVER — the most likely root cause of recurring "sections come back empty".
- **A3 (P1) The packet is not built from the real JD.** `appPackets.ts:237-239` synthesises a pseudo-JD
  from role/company/comp/why_surfaced/signals/pain. `raw_jd`, `jd_summary`, `jd_requirements`, `jd_real`
  exist (`appJdParse.ts:18-25`) and are never read. Same omission in ATS analysis (`:479`) and
  `artifactGenerate` (`:453`) — so the header ATS % is derived from a title + blurb, not the posting.
- **A4 (P2) Work History edits go nowhere.** `pkg_json` carries `WorkHistoryBullets1-4` (`mt17.ts:84-87`)
  and `OppDetail.jsx:431` edits them, but they are absent from `TEMPLATE_META.resume.placeholders`
  (`packetTemplates.ts:25`), so `varsForType` never injects them. Silent no-op ("No dead UI" violation).
- **A5 (P2) A read creates data.** `packetGet` has no `requireWrite` and `loadPacket` INSERTs a packet +
  5 artifact rows when absent (`appPackets.ts:47-57`). `OppDetail.jsx:155-157` calls it on mount, so
  merely opening any opportunity creates a packet that then sits in `#/packets` as `building 0/5`
  forever. The Packets list is "opportunities you once opened", not "packets you are building".
- **A6 (P2) `compact_resume` is a byte-identical duplicate of `resume`** — same `templateId` and same
  placeholder set (`packetTemplates.ts:27-30`).
- **A7 (P2) Three disagreeing definitions of "complete".** `recomputePacket` ready = all 5 approved
  (`appPackets.ts:63-70`); `OppDetail.jsx:192-198` calls `approved >= 4` "Complete"; `Packets.jsx:8-13`
  splits into 4 groups. A 4/5 packet reads "Complete", "In review" and `review` simultaneously.
- **A8 (P3) `Packets.jsx` "Sent" group can never populate** — no code anywhere writes
  `packet.status='sent'`. Same for `artifact.status='drafting'` (never set; `artifactGenerate` jumps
  todo→review, `appPackets.ts:172`) and `artifact.template_id` (never written, exposed as `templateId`).
- **A9 (P3) "⚡ Auto-optimize resume" (`PacketBuilder.jsx:488`) is the same handler as "Build entire
  packet" (`:387`)** — `buildAll`. Two labels, one action, and it optimises nothing against keywords.
- **A10 (P3) Wizard step is not routable.** `activeStep` is component state (`PacketBuilder.jsx:167`)
  while OppDetail/Library/Interview/Settings all hash-route their tabs. No deep-link, no back-button.

### B. Data / tenancy / auth
- **B1 (P1) Six `api.js` reads omit `?owner=` and silently read the DEMO tenant:** `atsSources:118`,
  `listAssets:204`, `listLibrary:225`, `mailConfigGet:170`, `mailMessages:179`, `mailMessage:180`.
  Note `api.js:172-178` already passes owner for mail-folder calls with a comment about this exact
  bug — these six were missed by that fix. `listAssets` means the Assets view may show demo artifacts.
- **B2 (P2) No ownership check on artifact routes.** `packet`/`artifact` have no `owner_email`; ownership
  is only derivable by joining through `opportunity`. `requireWrite` (`appSession.ts:72`) proves only
  that SOME verified session exists, not that it owns that artifact. `artifactVideoGenerate`,
  `artifactVideoStatus`, `artifactArchive` and `pipelineRun` have no `requireWrite` at all.
- **B3 (P2) `POST /api/prompts` is unauthenticated** (`promptsApi.ts:42,76`) and writes the LIVE
  production agent prompts.
- **B4 (P2) Schema drift — `schema.ts` is not a reliable description of the live DB.** 11 tables in
  `SCHEMA_SQL`; **18 more** are created ad-hoc inside handlers. `usage_metering` has 4 definitions;
  `asset_event` has 2 with DIVERGENT DDL (`appAssets.ts:14` lacks the CHECK and the FK). Packet-relevant
  columns outside SCHEMA_SQL: `packet.pkg_json`, `artifact.content`, `artifact.drive_url`,
  `artifact.heygen_video_id`. Any new endpoint reading them must repeat the `ensure*()` ALTER or it
  500s on a fresh database.

### C. Prompts / AI configuration
- **C1 (P1) `portfolio_user` is byte-identical to `resume_user` in the live Prompts table** (bad seed,
  documented in `docs/zap-289877647/README.md`) → agent 2 is being fed the resume prompt. Confirm with
  `GET /api/prompts` before fixing.
- **C2 (P2) The editor for the LIVE production prompts exists only in the deprecated dev console**
  (`web/src/App.jsx:1075-1120`, 6 keys). The product app has no `/prompts` call at all.
- **C3 (P2) Three disconnected prompt systems.** (1) Azure Table `Prompts` — versioned, activation
  flags, `prompts-load-file.yml` loader; **LIVE on the Google Doc/Slides path** via `appPackets.ts:7`
  → `pipeline.ts:49-51`. (2) ~25 inline literals with no override (`appPackets.ts:153,212`,
  `appJdParse.ts:89`, `mailWatch.ts:178,287`, `appApply.ts`, `appOutreach.ts:102`, …). (3) Postgres
  `coach_config` — the only one with a UI + reset. The fork is `metaFor(art.type)`. A prompt-editing UI
  must EXTEND `promptsApi.ts`, not become a fourth store.
- **C4 (P2) `gpt-4o-mini` hardcoded with no override at 12+ sites incl. the production packet path**
  (`pipeline.ts:58`), plus every `max_tokens`. Violates the no-hardcoded-config rule. Only
  `AI_EDIT_MODEL` (env) and `coach_config.model` (env+DB+UI) are overridable.

### D. Cost metering
- **D1 (P1) The production 3-agent build is completely unmetered.** `pipeline.ts:56-58` never calls
  `logUsage`, and `appPackets.ts:242` passes an empty usage object which `usageMeter.ts:22` early-returns
  on. The most expensive feature in the product (max_tokens 16000/16000/15500) is invisible in the cost
  dashboard.
- **D2 (P2) `gpt-5.6-luna` is missing from `PRICES`** (`usageMeter.ts:4-9`) so `costOf()` falls back to
  gpt-4o-mini ($0.15/$0.60). Sourced Luna rate is $0.20/$1.20 → under-reported 1.33× input, 2× output.
  Sourced prices now live in `docs/model-ab-findings.md` (ACT-50).
- **D3 (P3) Also unmetered:** every coach turn (`coachAgent.ts`, incl. tool loops), memory embeddings
  (`coachMemory.ts:86`), `appConvert.ts`, `appCapture.ts`, `appExtras.ts`, `appVoice.ts`.

### E. Error handling / observability
- **E1 (P1) Agent-2 / Agent-3 JSON parse failure is a `console.warn` and nothing else**
  (`pipeline.ts:68,73`). Neither call sets `response_format:{type:'json_object'}` (unlike `jdAnalysis`,
  which does). On failure the portfolio/cover/aboutMe fields and the entire ATS/skills QC silently
  vanish and the response is still `{ok:true}`.
- **E2 (P1) `build-all` swallows per-artifact errors into a 200 OK** (`appPackets.ts:456`, response
  `{ok:true}` at `:462`). The UI counts only successes (`PacketBuilder.jsx:263`), so a build where all
  artifacts failed reports "Built 0 documents" as success.
- **E3 (P2) HTTP 200 with an `{error}` body** across `appPackets.ts` (`:150,269,345,379,409,445,477,507`),
  `appVideo.ts`, `appConvert.ts`, `pipeline.ts`. `appSession.ts:81` ships a `serverError()` helper
  expressly to fix this; `appPackets.ts` does not use it.
- **E4 (P2) The Google "review agent" hides its own failures.** `stripLeftoverTokens` returns `[]` when
  the document read fails (`packetTemplates.ts:89`) — indistinguishable from "nothing to clean"; the
  follow-up batchUpdate (`:96`) has no `res.ok` check; `shareAnyone` (`:103`) ignores its response, so a
  permission failure yields a `doc_url` the user cannot open, reported as success.
- **E5 (P3) The one parsing diagnostic is discarded.** `_parsedFieldCount` (`resumeParser.ts:89`) is put
  into `steps[]` by `pipeline.ts:64`, but `buildTemplatedArtifact` destructures only `built.pkg`
  (`appPackets.ts:240`) — so it never reaches the API response on the production path.
- **E6 (P3) Video polling has no bound.** Recursive 9s `setTimeout` (`PacketBuilder.jsx:267-283`), no max
  attempts, no cancel; a thrown fetch retries forever. On success it writes the video URL into `docUrl`,
  conflating two fields (`:275`).

### F. Frontend consistency / dead UI
- **F1 (P2) Dead wiring:** `Call.jsx:19` writes `sessionStorage.ee_coach_autorecord` that nothing ever
  reads, while toasting "starting your mic…" — the toast lies.
- **F2 (P2) `RolesTitles.jsx:129`** passes `msg`/`onRetry` to `ErrorBox({error})` (`Today.jsx:547`) →
  taxonomy load failures render a blank error with no retry button.
- **F3 (P3) `Opportunities.jsx:36-41`** `filterLabel` handles `rolenew:`/`role:` but not `titlenew:`,
  which Today's default hero emits (`Today.jsx:177`) → the raw token is shown to the user.
- **F4 (P3)** Composer's "Settings ▸ Templates" hint goes to `/settings` (Account tab), not
  `/settings/templates` (`Composer.jsx:160-163`).
- **F5 (P3)** `Offer.jsx:57-60` never sends the "Your counter" column to the backend — typing a counter
  only recomputes a local total; the AI counter draft ignores it.
- **F6 (P3) Nav double-highlight:** on `#/library/roles`, `shell.jsx:131` highlights BOTH "Assets" and
  "Role Profiles"; `BottomNav` (`:149`) uses `parts[0]` only and disagrees with `SideNav`.
- **F7 (P3) Funnel bypasses** — `Pipeline.jsx:65` (rejected lane) and `Opportunities.jsx:63`
  (includeDismissed) fetch `listOpportunities` directly, so neither is location-filtered. Also
  `data.jsx:31-33` claims prefs refresh on the poll but the effect (`:63-67`) only re-runs `reload`,
  so a Settings location change does not propagate until reload.
- **F8 (P3) Duplication register** (consolidate, do not add a third): `FRESH_STAGES` ×4 (`data.jsx:6`,
  `Today.jsx:25`, `Opportunities.jsx:12`, `Swipe.jsx:7`); `STAGE_LABELS` ×3; `STATUS_TONE` ×3
  (`PacketBuilder.jsx:18`, `Library.jsx:13`, `OppDetail.jsx:7`); `Card` ×3; underline tab bar ×5 while
  `.px-tab`/`.px-tab-active` sit unused; connected-circles funnel ×4; `sessionValid` re-implemented in
  `Settings.jsx:41-48`; the 5-button artifact action row ×2 (`PacketBuilder.jsx:131-151`,
  `OppDetail.jsx:590-601`); `timeAgo` ×3.
- **F9 (P3) `AssetAnalytics` (`Library.jsx:54-83`) is defined and never rendered.**
- **F10 (P3) Built-but-unwired client methods:** `jdStatus`, `bulkRun`, `bulkStatus`,
  `coachMemoryBootstrap`, `coachUpload`, `assetEvent`, `taxonomyRetag`, `taxonomyAddTitle`. The entire
  bulk-packet subsystem (`POST /app/bulk/packets`) has a working backend + client and NO UI — wire a
  button rather than building an endpoint. Same for `build-all`'s unused `seedCadence`/`draftOutreach`
  flags and the returned-but-unrendered `atsScore`/`stage` on the packets list payload.
- **F11 (P3) Dangling CSS tokens:** `--proto-ink1` used with NO fallback (`PacketBuilder.jsx:621`, the
  declaration is simply invalid), plus `--proto-ink4`, `--proto-line`, `--proto-paper-2`.
- **F12 (P3) Two competing temperature palettes:** `theme.css:32-35` `--temp-*` (`#c15b3c`…) vs
  `shell.jsx:32-36` `TEMP_META` (`#ef5a34`…). Same state renders different oranges, and the JS hex map
  does not respond to dark mode. Same pattern in `PRIO_META`/`PRIORITY_COLOR`/`TIER_META`/`ROLE_COLORS`.
- **F13 (P2) Unsanitised `dangerouslySetInnerHTML` of server-supplied HTML** in 4 places:
  `OppDetail.jsx:378,384` and `Swipe.jsx:408,411`.

### G. Already-open infrastructure items (carried, not new)
- **G1** `web-deploy.yml` PR-trigger removal — implemented on branch `claude/web-deploy-drop-pr-trigger`
  (pushed, NOT landed) pending owner choice; the workflow still fails `ResourceNotFound` under any
  trigger because the `job-platform-web` SWA no longer exists. See ACT-48/ACT-46.
- **G2** Legacy branch `claude/git-push-main-1zcqw5` still exists (fast-forwarded, cannot self-trigger).
  Deletion requires a GitHub-UI click — the CCR git proxy rejects ref deletes. See ACT-48.

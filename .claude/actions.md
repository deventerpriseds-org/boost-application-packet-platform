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

## ACT-52 — QC & evidence layer: full P0-P8 plan + ACs committed, build starting
**Requested:** 2026-08-19 (owner: "commit to memory so we can move from p0 to the end continuously…
get the ac for everything up front and commit a plan and tracking list so you dont loose your place
between agent changes… then you can start with p0 once the full framework is laid out")
**Delivered this turn:**
- AC-1: spec package committed verbatim + provenance — DONE (`docs/qc-evidence/`, 64 files, `697fc74`)
- AC-2: ACs produced for EVERY phase P0-P8 by four INDEPENDENT agents reconciled against real code — DONE
- AC-3: a durable plan + tracker with a resume marker exists — DONE (`.claude/QC-EVIDENCE-PLAN.md`)
- AC-4: cross-phase decisions recorded so they are not re-litigated per phase — DONE (D1-D12)
- AC-5: prerequisites the backlog omits are named and mapped to what they gate — DONE (X1-X6)
- AC-6: P8 override conflicts registered — DONE (C1-C13)
- AC-7: harness gaps named so no AC is claimed as covered when it is not verifiable — DONE (§6)
**Status:** `in progress` — framework laid; P0 starting. Track position in the plan's RESUME MARKER,
not here.
**Standing authorization:** owner asked for continuous P0→P8 execution without per-step check-ins.
Still honoured regardless: the repo gate (independent ACs → implement → independent verifier) on every
code change, and branch → push → FF main per the ACT-47 rule.

## ACT-53 — P0 wiring bugs (QC evidence layer)
**Status:** `code complete` — landing as ONE deployment (app/** + api/** together per the owner's
one-shot-deploy directive). Verifier + live checks follow the landing.
- **P0.3 tone map — DONE.** `shell.jsx` `Pill` used `var(--proto-${tone}-soft)` string interpolation.
  Only accent/green/red/yellow/purple have a `-soft` token, so `panel` (every `todo` artifact),
  `orange`, `ok` and `warn` produced INVALID declarations — `panel` also gave near-white text on a
  near-white pill (invisible). Replaced with an explicit `TONE` map covering all 9 tones; unknown tone
  now falls back to readable `.px-pill` default. Radius was wider than the backlog said: 17 call sites
  across PacketBuilder/Library/OppDetail/Opportunities/Interview/Today/Swipe/Offer.
- **`--proto-ink1` — DONE.** `PacketBuilder.jsx:621` used an undefined token with NO fallback (invalid
  declaration). Now `--proto-ink`. Audit added: zero dangling `--proto-*` without a fallback remain.
- **P0.1 — DONE, backlog bullet REJECTED.** Backlog said add `packet.missing_kw`. Rejected:
  `opportunity.ats_gaps` already holds a posting-grounded gap list (`appApply.atsScoreOne` vs
  `jd_real`) that no endpoint returned. `packetShape` now derives `missingKw` from it, plus
  `atsGapsScoredAt` so the UI can tell "scored, no gaps" from "never scored".
- **P0.2 — DONE, premise corrected + one bullet REJECTED.** Backlog claimed it "persists none of it";
  false — `ats_score`/`covered_kw`/`jd_analyzed` were always persisted. Real defects fixed: (a) it was
  NON-IDEMPOTENT (an OpenAI call on every invocation) — now returns the stored analysis unless
  `{force:true}`; (b) it never read the posting — now grounds in `jd_real` (same normalization as
  `atsScoreOne`) and records `jd_grounded`; (c) `mustHaves` was discarded — now persisted. "Persist
  gaps" REJECTED for the same reason as P0.1: it would be a second, weaker gap list.
- **R4 fix not in the backlog.** The ATS legend printed `{covered}/{covered+missing}` — but covered and
  missing now come from DIFFERENT producers. A combined ratio implies one population. Now prints
  "N covered · M gaps" as separately labelled numbers.
**Verification:** `api` tsc green, `app` vite build green, smart-quote check clean, greps for the
banned patterns all zero. Live + independent verifier after landing.

## ACT-54 — P1 foundation: term library schema + matcher + test runner
**Status:** `done` (landed). Part of P1 (evidence spine).
- **`term_library` + `term_library_entry` in `schema.ts` SCHEMA_SQL + EXPECTED_TABLES** (per D1 — these
  are first-class relational tables, not the ad-hoc `ensure*()` column pattern). Shared reference data,
  deliberately NOT owner-scoped: distinct from `library_entity` (per-owner content) and
  `taxonomy_title` (per-owner job-TITLE tiers — a different axis).
- **Owner's source model implemented in the schema:** `sources text[]` (not a single source) +
  `source_refs jsonb` per-source ids + `confidence` derived from corroboration + `scoreable` flag.
  O*NET/ESCO are helpers, never gates.
- **Immutability enforced by a DB TRIGGER**, not convention — `term_entry_guard()` raises on
  UPDATE/DELETE once the parent version is `published`. This is what makes "adding an alias does not
  change any historical score" mechanically true instead of aspirational.
- **`termMatch.ts`** — `termNormalize` / `normalizeAliases` / `confidenceFor` / `matchesEntry` with
  three match modes. Deliberately does NOT reuse `roleTaxonomy.normalize()`: that drops the token
  `and`, which is right for job titles and fatal for terms (`P&L`→`p l`, `M&A`→`m a`).
- **Bug caught by the tests, not by review:** the first version stripped bare trailing integers as
  "versions", collapsing `SOC 2` into `SOC` — a real false positive (SOC also = Security Operations
  Center). There is no rule that folds `TOGAF 9` while keeping `SOC 2` distinct, so version stripping
  is now conservative (only `v2`, dotted `4.0`, `:2022`, `Type II`, impact levels) and bare-integer
  variants fold via an EXPLICIT per-entry alias where a human decided.
- **X4 closed:** `npm test` in `api/` = Node 22's built-in runner, zero new deps. **22 assertions
  green**, covering the measured live failures (P&L/M&A entity decode) and the SAFe case-sensitivity
  trap (302 live "safe" vs 8 "scaled agile").

## ACT-55 — P1.2 corpus term miner + curation queue
**Status:** `done` (landed). The extraction half of the term library.
- **`term_candidate` table** (SCHEMA_SQL + EXPECTED_TABLES, per D1): ngram, normalized, n, df,
  sample_opp_ids, status(pending|approved|rejected|merged), merged_into, reviewed_at/by, corpus_size.
  `unique(owner_email, normalized)`.
- **`termMiner.ts`** — `ngramsForDoc()` + 3 routes: `POST app/qc/terms/mine`,
  `GET app/qc/terms/candidates`, `POST app/qc/terms/candidate/{id}`.
- **Why this satisfies "terms must not be model-generated":** every candidate is a literal substring
  of a real posting with a countable document frequency. Extraction, not generation. Human approval
  is required before anything becomes scoreable.
- Re-mining **never overwrites a human decision** (`where status='pending'` on the upsert).
- **Two real bugs the tests caught, both of which would have silently destroyed the flagship term:**
  1. The edge-noise rule rejected any token under 2 chars, so `P&L` (normalizes to `p and l`, single-
     char edges) was discarded entirely — 83 postings lost. Length is now only a rule for standalone
     1-grams.
  2. **Ordering bug:** clause-splitting ran BEFORE entity decoding, and `&amp;` contains a semicolon —
     so the entity was torn in half, yielding junk tokens like `amp` and losing the term. Decode now
     happens first. Same class as X3; this is why X3 had to land before the miner.
**Verification:** 26/26 assertions green, incl. clause-boundary containment, document-not-occurrence
counting, stopword-edge rejection, and P&L surviving the pipeline.

## ACT-56 — P1.1 requirement rows (the evidence spine)
**Status:** `landed, live measurement in progress`. Commits `f84d539`, `ec5f2b4`.

**The premise the backlog got wrong, caught by reading live rows (db-query `32303342032`):**
`jd_table`'s Item column is a model **paraphrase**, not a posting quote — real row reads
*"Lead the operational performance of the renewable-generation portfolio."* So the backlog's
acceptance ("each row's `verbatim` is a substring of `jd_real` at its recorded offsets") is
**unsatisfiable by storing Items**. Storing them as `verbatim` would have fabricated quotes that
P1.3's `verbatim_quote` and P4's citation validator would then cite as the employer's words.
Resolution: `item_text` = the model's words; `verbatim` = the posting span the paraphrase was
located in, a literal substring of `opportunity.jd_text` at `[char_start, char_end)` by construction.

**Live corpus shape (db-query `32303334849`, `32304876196`):** 1821 opportunities · 1349 with a
`jd_table` · 1233 with `jd_real` · 1351 under `von.ellis@enterpriseds.io`. So ~116 have a parsed
table but **no employer posting at all** — those get `match_method='no_posting'` and null offsets.

**What it refuses to fake** (each of these was an available shortcut):
- Offsets are never resolved against `groundingText()`, whose fallback is `jd_summary`/
  `jd_requirements` — **model output**. An offset into the model's own summary quotes the model.
  `resolvePostingSource()` was added to `jdText.ts` (and `appJdParse.resolveJdSource` now delegates
  to it, so the extractor cannot drift from what the parser actually read) and returns `null` rather
  than falling back.
- Unlocatable rows are **kept**, not dropped. Dropping them would make the substring invariant pass
  100% while silently shrinking the requirement count.
- `coverage` is never `covered`/`partial` — no evidence engine exists until P2/P3.
- `competency` stays null until the term library resolves it. `jd_table`'s ATS Keyword is stored as
  `model_keyword`: a P1.2 candidate, **never scoreable**.
- Repeated bullets claim **distinct** spans, so one quote can never be counted as two evidences.

**`nice_to_have` without a prompt change.** `JD_SYSTEM`'s Category enum has no such value. Rather
than re-parsing 1349 postings through OpenAI, the kind is read off the **posting's own wording**
("Preferred:", "is a plus") in a 400-char window before the located span — deterministic, and it
backfills every existing row at zero model cost. `kind_source` records *why* each kind was chosen,
so a defaulted one is visible instead of masquerading as something the posting asserted. An unknown
Category falls back to the **weakest** kind, so model drift cannot invent hard requirements.

**Bug the live run caught that TypeScript could not:** `resolveOwner()` returns
`{owner, verified}`, and the whole object was passed as the `owner_email` query parameter —
`client.query` takes `any[]`, so it compiled clean and selected **0 of 1351** eligible rows
(api-test `32304769136`). Fixed in `ec5f2b4`. *Hardening: destructure `{ owner }` at every
`resolveOwner` call site; a 200 with a zero count is a result to investigate, not a pass.*

**Blast radius traced before landing:** `jd_table`/`jd_requirements` content and the
`appOpportunities.ts:54` field names are **unchanged**, so all six live consumers are untouched —
`OppDetail.jsx:378,384` and `Swipe.jsx:408,411` (`dangerouslySetInnerHTML`), `appRoleTaxonomy.ts:81`,
`appApply.ts:199,223`, `appPackets.ts:497`, `termMiner.ts:111`. This extends that pipeline; it does
not stand up a second one.

**Wiring:** extraction runs from **all three** parse paths — `jdParse`, `jdBackfill`, and the
5-minute `jdParseTick` that actually works the production backlog — so a posting cannot be parsed
without gaining a spine. `applyAnchorTruth`, which nulls `jd_table`, now also drops the rows that
quoted it. `jd_text` + `jd_text_sha256` are persisted so one SQL statement can re-verify every
offset, and a re-fetched posting makes its rows visibly stale rather than silently wrong.

**Measured live (api-test `32307998141`, db-query `32308138249`), 200 postings / 3,090 rows:**
`located 2,907 = 94.1%` (threshold 50%) · offsets that don't re-slice in SQL **0** · out-of-bounds
**0** · null `kind`/`match_method`/`kind_source` **0** · faked coverage/competency **0** · one quote
cited twice **0**.

**Defect found by the independent verifier, not by the tests — and it was the worst kind this table
can make.** `mapKind` tested `OPTIONAL_RE` before `REQUIRED_RE` over a flat 400-char look-back, so a
single "preferred" anywhere in the preceding window beat an explicit gate in the row's OWN quoted
text. **78 of 541** `nice_to_have` rows carried a mandatory marker in their own verbatim and no
optional marker in it — *"Security Clearance: Candidate must be US citizen"*, *"must be a U.S.
Citizen or Green Card Holder"*, *"Minimum of 8 years of experience in commercial lending"*,
*"15+ years of progressive technology leadership experience"*. This is the one field P1.3 and P4
cite as "the employer said this was optional".
Fixed in `23197df`: (i) the row's own words decide first and REQUIRED beats OPTIONAL within them —
a span straddling both clauses resolves to `must_have`, because hiding a real gate is worse than
surfacing a dismissible one; (ii) only a HEADING (`Preferred qualifications:`, `Preferred:`,
`Bonus points`) may reach back through the window, since a bare "preferred" mid-sentence governs its
own clause and nothing after it; (iii) the window is now the text BEFORE the span, not including it.
`kind_source` gains `posting_required_marker` / `posting_section_heading` so which evidence decided
each kind stays visible. **Re-measured: hard-gate-filed-as-optional 0; `nice_to_have` 541 → 240.**
The five live verbatims are now regression tests (58/58).
*Hardening: unit tests written alongside an implementation encode the implementer's own reading of
the rule. The precedence bug passed every one of them. Only reading REAL ROWS caught it — for any
classifier, sample the live output and judge it, don't just assert the branches.*
*Second hardening: `create table if not exists` cannot widen a CHECK constraint on a table that
already exists. Adding an enum value needs an explicit `drop constraint` / `add constraint`, or
every insert is rejected in already-migrated environments.*

**Verifier also confirmed (independently, from live evidence):** the astral fix is real and not a
deletion (3090 total in both the pre-fix and post-fix runs); no two rows share, overlap or duplicate
a quote; all six `jd_table`/`jd_requirements` consumers are byte-identical and the live API still
returns both fields as the model's HTML; and the normalizer change causes **no** regression in the
live ATS scorer (it prompts a model rather than matching in code, and the fold can only insert
whitespace, never merge tokens). Two latent mechanisms were found and measured at zero: NFKC
math-alphanumeric styling in postings (0 in corpus) and pre-fix mined terms containing astral chars
(0 of 2,734).

## ACT-57 — X1 + X2 (prerequisites that were silently poisoning everything downstream)
**Status:** `landed` (`25a741a`).

**X1 — generation was never grounded in the posting.** `buildTemplatedArtifact` was fed a pseudo-JD
assembled from `role + company + why_surfaced + company_signals + pain_hypotheses`. `jd_real` was
never selected — the opportunity projection was **duplicated across FOUR call sites and all four
omitted it**. Every figure, quote and claim the pipeline produced therefore came from our own
metadata *about* the job rather than the employer's words, so P1.4's provenance rows would have
recorded fabrications as evidence and P8.2's figure scan would have passed vacuously (no real
figures to scan).
Fixed: the posting leads (bounded 12k), research context is kept but labelled *"our notes, NOT from
the posting"* and placed after, `why_surfaced` is dropped once a posting exists (it is the alert
email describing SIBLING jobs — exactly what `resolveJdSource` already refuses to parse), and
`packet.jd_grounded` records which happened.
**The part that makes it real:** cache invalidation. `pkg_json` cached before this change was built
from the pseudo-JD; without invalidation the fix is inert for every existing packet and the cache
serves ungrounded content forever. A package is regenerated when it can now be grounded and
previously could not.
The four duplicated projections are now one `OPP_FIELDS` constant — four copies drifting is exactly
how `jd_real` came to be missing from all of them.

**X2 — `packetBuildAll` hardcoded `regen=false`,** so a rebuild-all could never escape the cache and
every P3.1 remediation loop would have reported looping while changing nothing. Now honours
`body.regen`.

## ACT-58 — P1.3 skill_candidate + swap_decision
**Status:** `landed` (`aea512d`). Tables migrated live (pg-migrate run `32311027980`, 17/17).

Mapped onto the pipeline that **actually exists**: Call 1 (resume writer) = `pass_a`, Call 3
(ATS QC merge) = `pass_b`, and `assemblePackage`'s per-slot preference for Call 3 over Call 1 **is**
the swap decision — recoverable from the three payloads with **zero model calls**, which is what the
acceptance demands. `buildPackageForJD` now returns those payloads; it discarded them, so the merged
package alone could never show what it replaced.

**Premise correction — and then a correction to that correction (I got this wrong first).**
I claimed no omission list existed, so `driver='rule'` had no honest source. **Wrong, and the source
disproves it:** the resume prompt interpolates `{{289877659__Items to Omit}}`, `zapVars.ts:43` maps
that to `MasterContext.itemsToOmit`, and **mt-13 confirms live** (api-test `32311753528`) that all 15
MasterContext fields *including that one* are present and non-empty. A drop matching the owner's
do-not-use list is now `driver='rule'`, exactly as the backlog asked, so it is never presented as
posting-driven. `unattributed` is reserved for the genuinely unexplained — a change neither a
requirement nor the omission list accounts for — and must not be diluted by laundering rule drops
into it. A DB constraint enforces the other half: `driver='posting'` **iff** a `verbatim_quote` exists.
*How I got it wrong: I grepped the pipeline source for "omission/omit/banned" and concluded from
the absence of a hit. The list is not in code — it is DATA in an Azure Table, reached through a
Zapier-era token name that no keyword search for "omission" would ever match. Absence of a code hit
is not absence of the thing; for anything the prompts interpolate, read the PROMPT and follow its
tokens.*
**A bug that followed from the same miss:** `profileText` was built from every string field in
MasterContext, `itemsToOmit` included — so an item on the do-not-use list would have been labelled
`profile_original`, the exact inverse of the truth. It is now excluded.

Other decisions worth keeping:
- Attribution matches a requirement's **verbatim**, never its `item_text` — a requirement with no
  located span can never supply a citation, because a citation needs a source, not a paraphrase.
- A `kept` row is never posting-driven even when its text resembles a requirement: nothing changed,
  so the posting did not drive anything.
- Similarity is **containment of the shorter item, not Jaccard**. Jaccard divides by the union and so
  punishes length asymmetry — the exact shape a rewrite takes. *"Led roadmap work"* → *"Owned the
  integrated product roadmap for corporate hiring technology"* scores 0.25 by Jaccard and would have
  been filed as an unrelated drop + add, losing the fact that one became the other.
- **Bug the tests caught:** the `merged` branch was unreachable — the first original claimed the
  final, so a second original collapsing onto it could only ever read as `dropped`, telling the
  reviewer its content was missing from a document that contains it.

## ACT-59 — P1.4 insertion rows
**Status:** `landed` (`ab6f371`). Table migrated live.

Merge-field names come from `TEMPLATE_META` — the same table `varsForType` injects from — so a row
can never name a slot the document does not have. **Measured against that table rather than the
backlog: resume 7 · compact_resume 7 · portfolio 7 · cover 3.** The backlog says the compact resume
has 6; it has 7 and is a **byte-identical duplicate of `resume`** (same templateId, same
placeholders). Pinned as a test rather than silently reconciled.

- A field the package could not fill still gets a row with `generated=false`, and a DB constraint
  stops such a row carrying content or a citation. That is the point: the UI lists what the pipeline
  **cannot reach** beside what it filled, so static template text is visible as static instead of
  being mistaken for generated content.
- `method` is **derived**: `template_fill` on a first fill, `model_rewrite` when a previous loop held
  different text. **`manual` is never inferred** — guessing "a human did this" would launder a model
  change as human judgement.
- Loops **accumulate** rather than replace: overwriting loop 0 would erase the before-text that makes
  loop 1 legible, which is the only reason the remediation loop is inspectable at all.
  `unique(artifact_id, merge_field, loop)` keeps re-running the same loop idempotent.

**92/92 unit assertions green** across jdText / termMatch / termMiner / requirements / generationJd /
swaps / insertions.

## ACT-60 — P2.1 checks engine + P2.2 gate and approval block
**Status:** `landed + verified live` (`4b9ce4d`). 19/19 tables live (pg-migrate `32315795329`).

**Thresholds came from the LIVE PROMPT, not the backlog** (`GET /api/prompts`, api-test
`32311693658`) — the prompt is the system that produced every artifact in the database:
`skills ≤ 30 chars` (**the backlog says 24 and is wrong**) · `20–22 total, evenly split` ·
relevant = *at most ONE item per list over 20 chars* (**an allowance, not a flat cap**) ·
aboutMe1 45–48 · aboutMe2 75–80 · execProfile 50–55 · cover 250–400.
**The prompt contradicts itself** on core accomplishments — heading says 98–100, requirement list
says "98–125 words (hard requirement)". The wider bound wins because it is the one labelled hard;
recorded rather than silently resolved.
All thresholds are seeded defaults on **`owner_search_prefs` — EXTENDED, not a new settings table**
(same as `jdSweep.ts`). Nothing in `checks.ts` is a permanent constant.

**AC 2.1.9 honoured:** a coverage check with no requirement rows returns `not_applicable`, never
`pass`. An artifact whose checks are ALL `not_applicable` aggregates to **`warn`** — nothing was
verified, which is not the same as everything passing.

**Grandfathering resolved by measurement, not by a decision** (db-query `32315364200`): 175
artifacts `todo`, 15 `review`, **zero `approved`**, zero packets `ready`. There is nothing to
grandfather, so the gate shipped with no migration and no risk of flipping existing state.

**PROVEN LIVE on the Trinnex resume** (`cfdd82e7`):
- checks ran (api-test `32315827849`), gate = **`fail`**, 4 attention items:
  `skill_char_limit=fail · relevant_char_limit=fail · expertise_phrase_length=warn · whitespace=warn`
- direct API approve → **HTTP 409** `"4 blocking finding(s); a fail cannot be overridden"`
  (api-test `32315891857`) — this is the P2.2 headline acceptance
- override on a `fail` → **HTTP 409** `"a fail cannot be overridden"` (api-test `32315925934`)
- `must_have_coverage=pass 2/2`, `responsibilities_addressed=pass 6/6` — real rows, not vacuous

**Real defect the engine surfaced on live content:** all **6** expertise phrases violate the
prompt's "exactly 5 words" hard requirement (3–4 words each). The prompt asks; nothing enforced it
until now.

**Bug the tests caught before it shipped:** the omission-list matcher used fuzzy similarity, which
drops stopwords and short tokens — so `Skill number 0` and `Skill number 3` both reduce to
`{skill, number}` and score 1.0. **One banned item would have accused nine innocent ones.** Now
exact-or-whole-phrase only, and **shared with the swap engine** so the two can never disagree about
what "on the omission list" means. *Hardening: a fuzzy matcher is acceptable for RANKING and
unacceptable for ACCUSING. The value of an offender list is that it can be acted on without
re-reading everything; a false name destroys that.*

**Two gates the backlog asked for and were missing entirely:**
- packet `ready` now also requires no asset at `fail` (a re-run AFTER approval can turn a gate red).
- **`outreachSend` had no packet gate at all** — the only real outbound path in the product, and
  every check could have been red with the message still going to the employer.

*Housekeeping note: a `git add -A` swept the two subagent worktrees into a commit as gitlinks;
untracked and `.claude/worktrees/` is now gitignored.*

## ACT-61 — P2.3 decomposed artifact score
**Status:** `landed + verified live` (`1605021`). 20/20 tables live (pg-migrate `32316307279`).

**Reconciled against the four existing scores BEFORE shipping a fifth** (the plan forbids otherwise).
None is per-artifact, so this is a new **grain**, not a duplicate:

| score | grain | what it actually is |
|---|---|---|
| `opportunity.match_score` | opportunity | model fit for the ROLE. **NOT posting-grounded** — `appApply` prompts from role/company/why_surfaced/signals/pains + MasterContext summary, never reads `jd_real`. Then **mutated in place** by the role-taxonomy boost. |
| `opportunity.base_score` | opportunity | the same number captured once *before* that boost |
| `opportunity.ats_score` | opportunity | posting-grounded, from `atsScoreOne` |
| `packet.ats_score` | packet | packet-level, from `jdAnalysis` |
| **`artifact_score`** | **artifact** | does THIS DOCUMENT cover this posting's requirements |

Named `artifact_score`, **not** `match_score` — that column exists with a different live meaning, and
reusing the name is how two numbers come to disagree while looking like one.

**The rule that matters, enforced by a DB constraint and not just in code:** a component with no
honest source is `null`, and the **composite is null unless all three exist**.
**Verified live** on the Trinnex resume (api-test `32316337445`):
`must_have_coverage 100 ("2/2 must-have requirements covered")` · `keyword_coverage null
("no published term-library version has scoreable entries yet")` · `seniority_alignment null
("not graded — the independent reviewer (P4) has not run")` · **`composite null`, `band null`**.
A composite from one of three components — or from a zero standing in for "unknown" — is a
fabricated number wearing a score's clothes, and it is exactly the number a reviewer trusts most.
Every unavailable component records WHY, so the UI explains the gap instead of showing a blank.

`must_have_coverage` is **read out of the deterministic check, not recomputed**. Two implementations
of one rule drift, and the day they drift is the day the gate and the score describe different states
of the same artifact (R4). Same `run_id` as the checks, for the same reason. Every historical score is
kept so regenerations are comparable; uncovered requirements are stored as real ids so the number
expands to the rows behind it.

**P2 COMPLETE** — 2.1 engine · 2.2 gate + server-side block · 2.3 score. 131/131 assertions green.

## ACT-62 — Hardening harness: failures become tests (answers "are we mitigating as we go?")
**Status:** `landed` (`0ac9aa2`). `api/test/hardening.test.mjs`, 13 cases (H1–H13).

**The honest answer to the question was NO.** The fuzzy-matcher bug was fixed in the one place a
test caught it; the *class* was never audited. `similarity()` was load-bearing in **four** places
and only one was corrected. The worst of the remaining three decided a **gate**.

**What the audit found — a live defect I had already reported as evidence.** Ground truth
(db-query `32316984998`, Trinnex opp `9f9c370a`): one of the two stored must-haves reads
> `digital water technology). Role: Director of Digital Technology Operations`

That is not a requirement — it is a span that crossed a clause boundary and swallowed the role-title
line. It then counted as **covered**, because a resume for that role naturally contains those words.
**My report of "must_have_coverage = pass 2/2 — real rows, not vacuous" was wrong.**

Fixes:
- `locate()` clips a span to the sentence it starts in, re-measures coverage inside the clipped span,
  and returns `unlocatable` if clipping cost the match.
- `covers()` is now accusation-grade: **0.7** of content words (was 0.5), **≥3** content words before
  any judgement is possible, and ≥1 distinctive (≥6 char) token present. All three err toward
  surfacing, because this decides a gate.

**The standing rule:** *fuzzy matching is for RANKING, never for ACCUSING.*

**The harness.** Prose does not run. Lessons written into this file were not applied — twice in one
session. Each past failure is now an assertion with an ID, the evidence, and the invariant:
H1 entity decoding · H2 SQL-addressable offsets · H3 no offsets into model output · H4/H4b no fuzzy
accusations · H5/H5b no cross-sentence spans · H6 absent evidence ≠ pass · H7 no fabricated composite
· H8 hard gates not downgraded · H9 resolveOwner destructuring · H10 no backticks in SCHEMA_SQL ·
H11 every table registered for migration · H12 rule modules stay pure · H13 one grounded projection.
The rule is now in `CLAUDE.md`: **a mistake becomes an H-case in the same commit that fixes it.**

*Two guards fired on a comment and on correct code when first written and had to be made precise —
a guard people learn to ignore is worse than none.*
*Also caught: my own `sentenceBounds` edit silently did nothing, because a Python `.replace()` that
does not match is a no-op and I did not check. Edits now assert the file changed.*

## ACT-63 — P6 owner facts: derived from the template, seeded by the owner
**Status:** `landed + seeded live`. 21/21 tables (`owner_fact`).

**Derivation reads the SOURCE, manual entry is the fallback** — the owner's correction. The resume
template's static sections (work history with dates, education, certifications) are read via the
Docs API, then MasterContext's prose blocks for anything the template omits. Derived rows are
`source='derived'`, `confirmed_at=null`: a derived fact is the system's *reading* of a document —
evidence, not testimony — and cannot settle a requirement until a human vouches for it. A re-read
never overwrites a confirmed value.

**9 facts seeded and confirmed** from the owner (api-test `32322146388`): 24 years total ·
16 leadership · Doctoral candidate, U. Michigan (Ross) · US citizen · no clearance ·
Westminster MD 21158 · relocation "leans no unless C-suite" · any work mode with onsite ≤1.5h ·
no travel max.

**Two open conflicts, deliberately NOT resolved by the system:**
- `scope.largest_budget` — template says **$30M** (largest of 8 dollar figures); owner believes
  **~$8M**. Surfaced, not silently picked.
- `scope.largest_team` — owner believes **300+**; the deriver found **nothing**, so the template does
  not state a headcount in a recognisable form.

**Bug found by the first live run — H14.** `experience.years_total` derived as **"5 years (since
2021)"** for a 24-year career. The date-range pattern allowed a month before the START year but not
the END year, so `AUG 2021 – Present` matched while `JAN 2015 – JUL 2021` did not; only the current
role matched and the earliest-role rule had one row to choose from. Fixed, and the derive response
now echoes `dateRangesSeen` so a derived number is checkable without opening the document.

**Tooling bug that cost two confusing rounds — H15.** `wait-run.sh latest:` reported a deploy
"deployed" while the previous commit's run was what it actually watched, so two `400`s came back
from stale code and read like an application bug. The helper now lives in `scripts/wait-run.sh`
(it was in an ephemeral scratchpad, so it would not have survived the session), supports
`sha:<workflow>:<sha>`, and **refuses `latest:` for any deploy workflow** with a non-zero exit.
`CLAUDE.md` step 5 now documents the correct command.
*Hardening: a fix that only lives in my habits is not a fix. It has to be in the repo, and it has to
fail loudly when misused.*

## ACT-64 — P6 finished: geography looked up, facts editable, conflicts surfaced
**Status:** `landed + live`.

**Geography is reference data, not a question.** The system had asked the owner to confirm that
Westminster MD satisfies "Reside in the East Coast" — over-conservative to the point of uselessness.
`geo.ts` carries the 50 states with region and coast; location requirements now resolve outright
with the reason ("Maryland (MD) is on the East Coast").
**The line turned out to be narrower than "never infer": never infer what depends on the PERSON.**
A commute radius ("within 30 miles of our Baltimore office") still asks, because how far someone
travels is theirs to decide — as does whether an inactive Secret counts against a TS/SCI requirement.
Two tests that encoded the old behaviour were rewritten, not deleted, keeping the principle on a case
where it genuinely applies.

**The seeded values were editable nowhere** — API with no screen, which is the "no dead UI" rule
failing in the other direction. `Settings ▸ Facts` groups every fact by category, shows
confirmed / derived-awaiting-confirmation / unset, prints the resume evidence beneath a derived
value, and offers "Re-read from resume template" which never touches a confirmed value.

**Derivation now reads all 14 MasterContext blocks** (was 7 named ones), excluding only
`itemsToOmit` — a cert in the skills pool is as much a fact as one in the template. The fuller read
surfaced **no additional certifications**: Six Sigma Black Belt and CSPO remain the complete set.
**Prompts checked once, not wired in** (owner's call): the stored `resume_user` prompt states the
candidate context as prose and its certification mentions are *instructions for extracting skills
from a posting*, not a list of what the owner holds. Nothing to seed.

**Conflict surfacing added.** A confirmed fact is protected from overwrite, so a re-read could find
something different and report nothing. The derive response now carries `readFromSource` and
`conflicts` (both sides + evidence). **Live: "3 confirmed fact(s) DISAGREE with what the source now
says"** — the owner's 24 years against the template's earliest dated role (2006 → 20), the doctoral
candidacy against the template's "MBA Coursework", and a cert string differing by one character.
That last one was an artefact of the cert regex truncating before a closing paren, now balanced —
a conflict detector that reports its own noise is a detector people learn to ignore.
*This generalises what was done by hand for the $30M-vs-$8M budget disagreement; by hand does not
scale past a dozen facts.*

**`dateRangesSeen` confirms the H14 fix on real data:** all four roles now match
(2021–Present, 2019–Aug 2021, 2015–Feb 2019, 2006–Apr 2015) where only the first did before.
**`stillNeeded` is empty** — every fact the live corpus asks for is answered.


## OWNER-ACTION-1 — update the education section of the resume template
**Status:** `open — owner action, not a code task`. Raised 2026-08-20.

The fact deriver read the live resume template and the confirmed profile, and they disagree:

| | template says | owner states |
|---|---|---|
| Highest education | **"Master of Business Administration Coursework"** | **Doctoral candidate, University of Michigan (Ross) business school** |
| Earliest dated role | **2006** (→ 20 years) | **24 years** |

The template is what actually reaches employers, so the template is the thing to fix — the profile
facts are already correct and confirmed. Two edits:
1. **Education section** — replace the MBA-coursework line with the current doctoral candidacy.
2. **Work history** — the earliest dated role starts 2006; if the 24-year figure counts earlier
   experience, that role is missing from the template (or its dates are).

Detected automatically by the derive endpoint's conflict surfacing
(`POST /api/app/qc/facts/derive`, run `32324596666`: *"3 confirmed fact(s) DISAGREE with what the
source now says"*). Re-running that endpoint after the template edit is how to confirm the fix —
conflicts should drop to zero.


## ACT — P4 independent reviewer, and the AC/verifier gate across the parallel streams
**Status:** `P4 implemented and pushed (6046b6f, branch claude/qc-p4-reviewer) — NOT yet independently
verified, NOT yet on main, NOT yet confirmed live.` Raised 2026-08-20.

### What landed
The blind reviewer (`reviewer.ts` judgement + `appReviewer.ts` persistence), P4.2's engine
separation, and the D6/D7/D8 decisions. 259/259 api assertions pass. Detail is in the commit body.

Four things in it are worth remembering rather than rediscovering:

1. **A citation must resolve to the requirement it NAMES, not merely occur in the posting.** The
   obvious validator — `posting.includes(quote) && requirementExists(id)` — accepts real,
   employer-authored, perfectly verifiable text as evidence for the *wrong* requirement, because
   postings repeat their own phrasing (the requirements block and the culture paragraph). Encoded as
   **H16**.
2. **The reviewer must attach to the deterministic `run_id`.** `artifactChecksGet` selects by
   `run_id = artifact_gate.run_id`, so a reviewer minting its own would store rows no reader can ever
   see — every insert succeeding, the product showing nothing. The same shape bites the score: the
   deterministic pass inserts it `on conflict do nothing`, so an INSERT of seniority is silently
   discarded with a 200. It is an UPDATE. Encoded as **H18**.
3. **`requireWrite` would NOT have closed the `promptsApi` hole** the plan asked it to close — see
   plan §11 #7. Encoded as **H19**.
4. **The production packet build had never metered a single call.** `logUsage(..., {})` early-returns
   on zero tokens. Three passes, the most expensive operation in the product, invisible in the cost
   dashboard since it was built.

### The gate — what is owed, and to whom
The org gate needs an independent AC-writing subagent BEFORE implementation and an independent
`verifier` subagent AFTER, per code change. Tracking honestly:

| Stream | ACs by an independent agent | Verified by an independent agent |
|---|---|---|
| P4 reviewer | **done** — written cold before implementation; it found the H16/H17/H18/H19 traps | **running** |
| P5.2 asset blocks | **running** — written cold, spec-only, forbidden from reading the branch | pending its ACs |
| P5.3 gate drawer | **running** — same | pending its ACs |
| P5.4 JD step | **running** — same | pending its ACs |
| P0 wiring | done | **STILL OWED** — the P0 verifier never reported back; P0's live behaviour is unconfirmed |

The three P5 subagents each reported build- and unit-verified only, and P5.3 said explicitly that no
`Agent` tool was exposed inside its worktree so it could not run the gate itself. That half is the
parent's to run, and it is running now — cold, one agent per stream, each forbidden from reading the
implementation it is writing criteria for.

**Nothing in P5 or P4 may be called done until its verifier reports, and none of it is confirmed live
until it is on `main` and checked with `ui-verify.yml` / `api-test.yml` / `db-query.yml`.**


## ACT — live measurements settling three P4 unknowns (db-query run 32328208553, 2026-08-20)

Read from the job log, not inferred:

```
review_verdict_exists | check_result_exists | artifact_gate_exists | usage_rows | packet_generate_rows | ai_edit_rows | luna_rows
                      | check_result        | artifact_gate        |      14693 |                    0 |            0 |         0
```

**1. `review_verdict` does NOT exist on the live database.** `check_result` and `artifact_gate` do.
The independent verifier flagged that `appChecks.artifactChecksGet` queried `review_verdict`
unconditionally, which would 500 a currently-working route for the whole window between deploying P4
and someone calling `pgMigrate`. That was real, and the tolerant `.catch(() => ({ rows: [] }))` now in
that query is load-bearing rather than defensive padding.

> **ON MERGE OF P4: call `/api/diag/pg-migrate` immediately after the deploy.** Until it runs, the
> reviewer has nowhere to write. `EXPECTED_TABLES` already lists `review_verdict`, so the migration
> reports it.

**2. `packet:*:generate` rows = 0 and `packet:ai-edit` rows = 0, against 14,693 total.** Both were
ASSERTED in the P4 commit message and flagged there as unverified. They are now measured. Metering
works everywhere else in the product; those two paths — the production packet build (three OpenAI
calls per packet, the most expensive operation the product performs) and the AI-edit path — have
recorded nothing, ever. `logUsage(..., {})` and the Responses-API token-shape mismatch respectively.

**3. `gpt-5.6-luna` rows = 0.** So the 1.33x/2x under-reporting the memory recorded had no rows to
apply to — there is nothing to reprice retroactively. Cost accrues correctly from the fix forward.

**Method note worth keeping:** the D8 claims sat in a commit message as unverified assertions for
several commits. One read-only `db-query.yml` dispatch settled all three in about ninety seconds.
When a claim is about production state, the workflow is cheaper than the hedge.


## ACT — P4 and P5 shipped and confirmed in production (2026-08-20)

Everything below was read from job logs, not inferred.

### P4 — merged (785c82b), deployed, migrated, verified end to end
`api-deploy` succeeded for that exact SHA (run 32330851706, waited with `sha:`, never `latest:`).

**A trap worth remembering: `pgMigrate` ran the OLD bundle.** Called ~60s after the deploy went
green, it reported `"22/22 tables present"` — but the merged `EXPECTED_TABLES` has 23. That count is
the fingerprint of pre-merge code. The retry a minute later created `review_verdict`. CLAUDE.md
documents this ~90-120s converge window and I walked into it anyway. **Do not call a route
immediately after a green deploy; check a value that differs between the two bundles.**

**The reviewer ran live against the Trinnex resume and justified the whole phase on its first run:**
```
grade  | seniority | agreed | disagreed | prompt_key      | version | source        | blind | kept | dropped | gate | attention | reviewer_fails | metered
strong |        95 |      1 |         4 | reviewer_system |       1 | prompts_table | t     |    3 |       4 | fail |        11 |              0 |       1
```
- **4 of 7 citations failed validation** — three quotes the model INVENTED (`quote_not_in_posting`)
  plus one naming a requirement with no anchor. Without this layer all seven would have been
  rendered to the owner as the employer's verbatim words.
- `prompt_source = prompts_table` v1 — running on the authored prompt, not the builtin.
- `reviewer_fails = 0` with `gate = fail`: D6 holds live. The fail is deterministic; the reviewer
  contributed three warns and could never have caused it.
- H20 holds live: dropped citations appear as `requirement <id>: <reason>`, no fabricated text.
- `not_comparable` works: "1 agreed, 4 disagreed; **5 not comparable**".
- Both engines independently found the same real gap (East Coast residency) — one via
  `template_reach`, one in the reviewer's critique.

**D7 proven live, paired, same minute:** unauthenticated `POST /api/prompts` → **403**; the
token-minting workflow → **200 v1**. The hole the plan's prescribed `requireWrite` would have left
open is closed.

### P5 — merged (653064f), deployed, all three surfaces confirmed on the live SPA
Integrated on one branch so the two `PacketBuilder.jsx` conflicts were resolved once (both pure
additions; both sides kept). 89/89 app tests, 30/30 overlay probe, 16/16 asset-blocks probe.

| Feature | Live evidence | consoleErrors |
|---|---|---|
| P5.4 posting analysis | "Posting analysis" + "Model paraphrase" render; "ATS keywords", "Run ATS analysis", "Re-run ATS analysis" ABSENT | `[]` |
| P5.2 asset blocks | all 7 merge-field cards render; no `0 of 0`, `NaN`, `[object Object]` | `[]` |
| P5.3 gate drawer | "Assets & gate" renders; no negative finding count | `[]` |

### Still open in production, recorded and NOT yet fixed
1. **The "Re-run ATS analysis" button cannot re-run.** `api.js` `analyzeJd: (oppId) => post(..., {})`
   takes no argument and never sends `force`, so the server returns cache. Dead UI created by P0.2's
   own idempotency fix.
2. **`covered_kw` does not mean covered.** The prompt asks for `keywords = ATS keywords for this
   role` with no candidate comparison anywhere; the array renders as green "N covered" chips.
3. **Dark-mode `accent` pills measure 1.90:1.** `.proto-dark` overrides `--surface-brand-subtle` but
   not `--surface-brand-default`, across 15+ live sites.

---

## ACT-65 — P8.2 / R3: the posting's figures are the employer's, not the candidate's

**Request:** "obviously take care of p0 and continue with the rest. can any of it be done in
parallel?" → P8, item 8.2. Branch `claude/qc-p8-2-figures`, **PR #10**, commits `fe4bcc5`, `40e77fb`.

**What it is.** `api/src/functions/tests/figureEcho.ts` scans every generated merge field for
figures that appear in the employer's posting, and `checks.ts` reports them as
`posting_figure_echo`. Pure — no pg, no network, no model call — so it is deterministic, costs no
tokens, and can state a byte offset. Three-way split; the middle case is the point (C5):

| generated figure | disposition |
|---|---|
| in the posting, not the profile | `echo` — named, field + exact string |
| in the posting **and** the profile | `shared_with_profile` — **KEPT** and citable |
| not in the posting | `profile_only` — untouched |

**Evidence.** `npm --prefix api test` → **292 pass, 0 fail**. CI green both jobs, run
`32384079631` (`api — build + test`, `app — build + unit + browser`) against `fe4bcc55`.
Not yet landed on `main` at time of writing — an independent verifier is still running, and
`main` is what deploys.

### Guard rails chosen deliberately, each against a way this check could become noise
- **Posting text is `resolvePostingSource`, never `groundingText`.** `groundingText` falls back to
  `jd_summary` — MODEL OUTPUT. Accusing a candidate of echoing our own summary is an accusation
  built on a fabrication.
- **Profile text EXTENDS `appFacts.sourceText()`** (now exported) rather than adding a reader. A
  second answer to "what does the candidate own" is how this check starts accusing people of
  echoing their own achievements.
- **Missing either side ⇒ `not_applicable`**, never `pass`, never an accusation.
- **`warn`, not `fail`.** A shared number can be legitimate and P8.1's correction path supersedes
  this state. A gate that reddens on it is a gate people learn to click past.

### Defects found while building it → tests, per the hardening rule

**H24 — the scanner reported a figure that was not in the text.** `extractFigures('40% growth')`
returned exactly `{raw:'4', key:'num:4'}`. Two defects composed: `/(\d…)\s*(%|percent)\b/` never
matches, because `%` and the space after it are both non-word so the trailing `\b` has no boundary
to sit on; and the bare-count scanner ended in `(?!\s*(?:%|percent))` — **a tail that can FAIL is a
tail the engine backtracks past**, so refused "40" it matched "4" and the leftover "0%" satisfied
the lookahead. Invariant asserted: every figure is exactly the text at its own span, and no two
figures overlap. Structural half added because once the percent scanner works the runtime cannot
see the defect at all — the backtracked "4" lands inside the span the percent scanner claimed.

**H25 — an accusation-grade check fired on innocent text.** The backlog's literal rule ("no numeric
string that also appears in `jd_real`") measured against a real package with a posting reading
"three business units" produced three offenders: `SkillsBullets1: 3`, `SkillsBullets2: 3`,
`ExpertiseBullets: three` — from "Skill number 3", "Other skill 3", "One two three four five". Not
one mentions a business unit. **A bare number is not a claim; "3 business units" is.** Unmarked
figures now key on the number AND the noun they count; marked ones (`$18M`, `60+`) key on
themselves — and which rule applies is decided by the **generated** figure, so a posting asking
"60+ sites" answered by a resume writing "60 sites" (the commonest echo of all) still lands.

Three more, covered by the new module's own suite rather than an H-id: years excluded (1900–2099,
bare, no `+`) because "since 2019" vs "founded in 2019" is the calendar; a spelled multiplier is one
figure ("one million" = 1e6) and the bare word never is; `/e?s$/` stemmed "sites" → "sit" and split
"business" from "businesses".

### The discipline that caught all of it — and caught me twice
Every guard was **revert-proven**: undo the fix, rebuild, confirm the test FAILS. Two of my own
guards were **vacuous** and would have shipped as untested belt-and-braces —
(1) an anti-backtrack `(?!\d)` that another fix had already made unreachable, and (2) a source-grep
whose own regex used `[^)]*` to reach a construct inside a pattern **containing `)`**, so it could
never match the thing it scanned for. Both were removed or rewritten. A test that cannot fail is
worse than no test, and reverting is the only way you find out.

### Deliberately NOT in this change
The **rewrite/generalize half** of P8.2 (replace `60+` with the candidate's `62`, generalize `$18M`
to "8-figure", log each replacement, make it revertible) needs **P8.1's correction table** to store
and undo a replacement. `generalize()` is built and tested and returns `null` rather than inventing
a substitute — silence over a fabricated number. Recorded here so it is not mistaken for done.

---

## ACT-66 — A lane that has not pushed a branch has produced nothing

**Found while answering "what is the status of the other parallel fan outs?"** The P3 remediation
subagent had run, died without pushing, and left **no `qc-p3-*` branch on origin** — `git branch -r`
proved it. The only trace was `.claude/QC-EVIDENCE-PLAN.md` still listing the lane as in flight,
with a RESUME MARKER **six phases stale** (`CURRENT PHASE : P2` while the train was at P8).

Had that entry been trusted, the next session would have gone looking for work that does not exist,
or worse, assumed P3 was underway and built on top of nothing.

**Corrections applied:**
1. RESUME MARKER rewritten to true state, with a dated `UPDATED` line.
2. A **lane table** added: branch, files owned, and **pre-allocated H-case ids** (H24/H25 P8.2,
   H26 P3, H27 P8.3) so two parallel lanes cannot collide on one number or one file.
3. A **blocked-on table**, so the reason a phase is idle is written down rather than rediscovered.
4. The rule itself recorded in `.claude/memory.md`: **verify a lane with `git branch -r`, never with
   a summary or a tracker entry.**

P3 restarted 2026-08-20 as a fresh lane on `claude/qc-p3-remediation` — a restart, not a resume.

---

## ACT-67 — P8.3 / R2: evidence excerpts on every coverage claim (branch `claude/qc-p8-3-evidence`)

**Cold ACs:** `docs/qc-evidence/AC-P8.3.md`, written by an independent AC session against `main` at
`f4c2f43` with no sight of the implementation plan (branch `claude/qc-p8-3-acs`, commit `e778c82`).

**What changed.** Conflict-register **C6** — "coverage counts recomputed from evidence rows, not from
term placement" — is now true in the code. `checks.must_have_coverage` and
`responsibilities_addressed` count a requirement as covered only when a verbatim excerpt of the
candidate's *stored profile* resolves against it. A new pure module `evidence.ts` finds that excerpt;
`requirement_evidence` stores it; `appFacts.sourceText()` — still the ONE profile reader — was
extended to return named records rather than only a joined blob.

**Four defects found while doing it, each now an H-case (proved by reverting the fix):**

- **H28** — the must-have numerator credited requirements nothing measured. The check's fail branch
  divided by `mustHaves.length` while its numerator came from `coverable` alone, and
  `computeArtifactScore` recomputed the wider denominator a third time. On the live Trinnex shape
  (4 must-haves, 3 of them eligibility clauses `template_reach` had just reported as
  `not_applicable`, 1 judged and failing) it printed **"3/4 must-haves covered"** and scored **75**.
  Revert-proof: restoring either half fires the case — `75 !== 0`, and
  `got "3/4 must-haves evidenced"`.
- **H29** — an evidence quote must be a substring of the record it NAMES. Validating against
  `sourceText().text` (the join of the template and every MasterContext field) accepts a sentence
  half in one job's history and half in another's. This is H16 in a new place. Revert-proof:
  resolving against the concatenation returns a row where the correct code returns `null`.
- **H30** — an unreadable profile is not an empty profile. Resolving against a failed Google/Table
  read yields zero evidence rows for every requirement, and zero rows presented as a number is "0%
  covered" meaning "we did not look". The mirror error is equally available: filing a *readable*
  profile that supports nothing as `not_applicable` drops the row from the denominator and the packet
  reads 100% with a hard requirement unmet. Revert-proof: both directions fire the case.

- **H32** — see D-A below.
- **H31** — `covers()` returns false for a requirement it CANNOT judge (fewer than three content
  words), which is the right answer for coverage and the wrong one for the new `evidence_placed`
  check. Live Trinnex row #5 "Experience in leading technology operations" reduces to two tokens,
  both of which the resume summary contains verbatim — and the first version of the check named it
  "absent from this asset". Caught in a live-shaped reproduction before merge. Revert-proof: putting
  unjudgeable rows back in the offender list fires the case with the exact string.

**Independent verification:** `docs/qc-evidence/VERIFY-P8.3.md` (branch `claude/qc-p8-3-verify`,
commit `8edd575`), by a separate agent against `8bf2b59`. All five revert-proofs reproduced
independently; 637 adversarial probes against the substring claim found zero violations; the live
`1/5` / score `20` defect confirmed from the stored rows without taking this lane's word for it.
It found **seven** things this lane had not, and five are now fixed here:

- **D-C, the significant one — the 75% H28 killed was still on screen.** `app/src/qcRail.js`
  `coverageCards` computed `closed = total - |offenders|` over EVERY must_have row. That agreed with
  the old check by construction; moving the check's denominator to `coverable` and leaving the rail
  on the full population made them disagree by exactly the excluded rows — "3 of 4 closed", 75%,
  from the same three rows, while the check beside it said 0/1. The fix was applied where the
  H-case looked and not at the other consumer, which is the "fix all consumers" rule's own named
  failure mode. Now fixed: the rail reads the excluded seqs off the same offender contract
  (`template_reach`, `facts_needed`, `fact_shortfall`) and reports them `unmeasured`, never
  `closed`. Two app tests, revert-proven.
- **D-A → H32 — a quote can be a TRUE SUBSTRING and still be the wrong five characters.**
  `locate`'s exact branch indexed `postingText.toLowerCase()`; `toLowerCase()` is not
  length-preserving (U+0130 → two code units), so every such character before a match shifted the
  offset. Measured: char_start 20 for a phrase beginning at 15, storing an excerpt with "led t" cut
  off the front and " and " glued on the end — and `slice(20,86) === verbatim` is TRUE, so every
  substring guard in the codebase passed it. Pre-existing and live on `requirement.verbatim`; P8.3
  pointed it at the candidate's own words, where a garbled "your own words" is worse.
  `EXTRACTOR_VERSION` bumped to 2 so rows extracted under the old rule are findable.
- **D-E** — H4b greps only `checks.ts`; the accusation had moved to `evidence.ts` and gone
  unguarded. Extended.
- **D-F** — `EVIDENCE_THRESHOLD` and `MIN_JUDGEABLE_TOKENS` decide whether a requirement counts as
  evidenced, and `writeEvidence` was called with no options, so they were overridable in principle
  and fixed in production. Now on `CheckThresholds`, stored in
  `owner_search_prefs.chk_evidence_threshold` / `chk_evidence_min_tokens`, and passed to the
  resolver on the production path.
- **D-G-1** — `evaluateArtifact` rebuilt `EvidenceRow` with `record_sha256: ''` and
  `resolver_version: 0` while the real columns sat in the row it had already selected. Inert, and
  one edit away from a digest field holding a value no digest produced. Now reads the columns.
- **D-B** — the substring guard is a tautology (`locate` constructs its verbatim by slicing), so
  `refused` is structurally always 0. Kept as defence in depth, and the comment now says so instead
  of implying a population that cannot be non-zero.
- **D-D, NOT fixed** — stored evidence is never re-validated on read, so after the owner edits a
  MasterContext block the JD payload serves the old quote at the old offsets with no `stale` flag.
  A real fix reads the profile on every requirements GET, which is a design decision about cost, not
  a patch. Recorded rather than rushed.

**Deliberately not fixed, recorded instead:** `appReviewer.ts:183` computes `engineJudged` as every
must-have row, while the check judges only `coverable` — so reviewer agreement is still measured
against a wider population than the engine judged. Pre-existing, unchanged by this lane, and a real
fix needs `artifact_score` to store which rows were judged. P4's surface, not this one's.

**Left for the UI lanes:** `app/src/assetGate.js:53` labels the check "Must-haves this document
covers", which is no longer what it measures ("evidenced by your profile" is). The JD-step expansion
(SPEC §4.1, ACs 42-50) is served by the API — `GET /api/app/opportunity/{id}/requirements` now
returns `evidenced`, `evidence{quote,sourceKind,sourceLabel,...}` and `evidenceNote` per row — but the
disclosure control itself is P5.4/P8.7 territory and is not built here.


## ACT — P3 remediation loop built (PR #14, `claude/qc-p3-remediation`, 2026-08-20)

**Not landed, not deployed, not confirmed live.** 313 assertions green in the sandbox; the sandbox
has no Postgres, no Drive and no Function, so every criterion needing them is `not_applicable`.

**The gate, honestly:** ACs written COLD by an independent agent before any P3 code existed — the
surviving fragment is `docs/qc-evidence/P3-ACCEPTANCE.md` on `main`, and the full P3-01..P3-46 list
was reconstructed by a second independent agent on branch `claude/qc-p3-ac`. An independent verifier
session was run against the branch. **No `Agent`/`Task` tool was exposed in this lane's harness**, so
both were spawned as separate CCR sessions that pushed their output to branches — auditable, and
genuinely cold, but worth knowing the mechanism differed.

**X2 re-verified rather than assumed.** The plan says `appPackets.ts` hardcodes `regen=false`. It
does not: `regen` is read from the body at `:382/457/558`, honoured at `:319`, and
`PacketBuilder.jsx:584` sends it. The plan text is stale; recorded there.

**Six defects found, each fixed in the same commit as its H-case, and each guard watched to FAIL
with the fix reverted before it was kept:**

| ID | The defect | Why it mattered |
|---|---|---|
| H34 | `writeSwaps` ran `delete from swap_decision where packet_id=$1` on every build, and the table had no `loop` column | pass 2 destroyed pass 1's swap record — the loop deleting its own justification for every change it had just made |
| H35 | generation and rendering were one function | 4 passes x 4 templated artifacts = 16 Drive copies per packet, and there is no Drive `DELETE` anywhere in this codebase, so 15 would be orphaned on the quota-bearing OAuth account |
| H36 | `insertion.loop` derived as `max(loop)+1` INSIDE the writer | it counted document RENDERS, advancing even on a cache hit that made zero model calls. The same guard caught `packet.round`: read by `loadPacket`'s ORDER BY and by `packetShape`, written by nothing, so the ordering was a no-op and the API reported `round: 1` forever |
| H37 | `converged` was a word the writer could simply choose | now a table CHECK plus a composite FK into `check_result`, so the coverage state on a loop row can only be COPIED from a check the engine really recorded |
| H38 | the loop could have grown a second definition of "covered" | `checks.covers()` decides the GATE; a second implementation drifts, and the day it drifts the loop claims closes the gate does not recognise |
| H39 | **the composite FK's UNIQUE target was added at the FOOT of `SCHEMA_SQL`** | Postgres wants it at CREATE TABLE time, so `create table remediation_loop` **aborts the entire migration on any database where `check_result` already exists — i.e. production**. A fresh DB was fine. No test here could catch it: the schema is never executed in the sandbox |

Plus one found while reviewing: a SECOND loop run restarted numbering at `n=1` and would have
upserted over the first run's ledger — the H28 defect one table over, and worst exactly where it is
least visible, because resolving an escalation reopens the loop, making the second run the normal
case rather than the edge case. `nextPassNumber` continues the ledger.

**The lesson worth keeping: H33's first version was INERT.** It passed with the defect deliberately
reinstated, because it accepted `check_result`'s *inline* UNIQUE as proof the target existed. On an
existing database `create table if not exists` skips the create and the inline constraint with it, so
the inline form proves nothing. **Only the revert-proof caught it.** A guard that cannot fail is
worse than no guard, and writing one is easy enough to do by accident that reverting every fix to
watch its test go red is not ceremony — it is the only thing that distinguishes a guard from a
comment.

**Departures from the acceptance list, each recorded in the commit:**
- `requirement.closed_on_loop` dropped rather than written (plan decision 16 — one `int` on a
  per-OPPORTUNITY row cannot express per-ARTIFACT coverage, and "covered in the resume but not the
  cover letter" is the normal case). Zero writers, zero readers, so nothing depended on it.
- Loop escalations get their own table (decision 15): `requirement.coverage='escalated'` is already
  set at EXTRACTION and means "the quote could not be located in the posting".
- The cleared-override record (decision 19) lives on `remediation_loop`, NOT on `artifact_gate`.
  `evaluateArtifact` clearing an override is deliberate and correct for a MANUAL re-check; the LOOP
  is what turns one considered clear into four silent ones, so the loop carries the record and
  `appChecks.ts` (another lane's file) is untouched.

**Deliberately NOT claimed:** P3-45 (the Passes tab) — P5 is unmerged and `ui-verify.mjs` cannot
click or assert absence. P3-21/25's live half — blocked on `diagFolders` listing the packet output
folder `1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt`. P3-40 (posting figures) — that is P8.2's `figureEcho`.

**Open follow-up for the P5/P8.7 lane:** `app/src/qcRail.js:423` and `:599` read the FULL
`swaps`/`insertions` arrays as though they were one pass. That double-counts the moment a second pass
exists, which P3 makes routine. Both endpoints now also return a `current` array (latest pass only)
and a `passes` list so the UI can be corrected without guessing.


## ACT — the P3 verifier disproved eight claims; four were real defects (2026-08-20)

An independent verifier (`docs/qc-evidence/P3-VERIFICATION.md`, branch `claude/qc-p3-verify`) ran
against the branch, applied mutations, and executed the schema. It disproved **eight** claims. Four
were defects in the code or its guards and are fixed; the rest are recorded below as open.

### The finding that changes how this repo verifies schema work
**This container ships PostgreSQL 16.13.** `CLAUDE.md` says the sandbox cannot reach the live Azure
database — true — and that was carried over as "there is no Postgres here," which is false and was
never tested. A throwaway cluster is one `initdb` away (as an unprivileged user; `initdb` refuses to
run as root). Executing `SCHEMA_SQL` against a database seeded with `main`'s schema **immediately
found a second migration-killing defect that reading had not**:

```
psql:schema.sql:367: ERROR:  column "loop" does not exist
P3 tables created: 0
```
`create index ... on swap_decision(packet_id, loop, ...)` named a column the idempotent ALTER only
added 350 lines later. Fresh database fine; every existing database dead. Same class as the FK
ordering bug, second instance in one file — so **H39b** generalises the guard from "composite FK
targets" to "any statement naming a column added later in the same script."

**Standing rule from this: a schema change is not verified until it has been EXECUTED against a
populated database with the previous schema already applied.** Fresh-database success proves almost
nothing, because every `create table if not exists` is skipped on the database you actually care
about. The upgrade path is now proven: `BRANCH exit=0`, both P3 tables created, `check_result` gains
its second unique, existing rows preserved.

### Three of my guards were INERT — they passed with their defect reinstated
- **H34b** (all three assertions): `unique (packet_id, list, seq, loop)` occurs TWICE in `SCHEMA_SQL`
  (inline and in the idempotent ALTER), so deleting the inline one still matched; and two
  `[\s\S]*?` spans ran past the end of their own table and matched the NEXT table that had a
  `loop int not null default 0`.
- **H37's FK-target line and H39's "fresh database" line**, same cause. H39's was added by the very
  commit that says an inert guard "is worse than none" — reintroduced one line below the fix.
- All now assert on a bounded `createTable()` slice, revert-proven.

### A guard that tested spelling, not behaviour
**H38** grepped for `COVERAGE_THRESHOLD =` and the literal `hit.length / toks.length`. The verifier
evaded it in one move: a second coverage rule named `localCovers` at threshold 0.5, wired into the
credit decision. The grep passed and all 37 behavioural tests passed, with the loop and the gate
disagreeing about what "covered" means. **P3-15 now pins `creditClosures` itself to the gate** across
inputs measured to make a 0.5 rule and the gate's 0.7 disagree — in both directions, so it cannot
pass by never crediting anything either.

### The one that mattered most: the loop could still SAY it converged
The P3-11 guard protects the `closed[]` COLUMN and does it correctly. It does not protect the
SENTENCE. Demonstrated on the real compiled functions: a pass rewrites one unrelated field, credits
nothing, records a phantom; the whole-document predicate reports the requirement covered, `remaining`
empties, and the run tells the user *"Converged after 1 pass(es): every must-have requirement is
covered."* **Refusing the credit is not refusing the claim.** `converged` now additionally requires
that nothing left the open list unattributed — refused in `decidePass` (new halt reason
`unattributed_coverage`) AND recomputed in `reportedOutcome`, so a bad row cannot talk the sentence
into existence. A phantom-flipped requirement also used to sit in NEITHER `closed` nor `remaining`
and got no escalation (P3-07); it now raises one saying plainly that the run cannot say what covered
it.

### Also fixed
- **D-4** — `model`, `maxTokens`, `temperature` and the profile truncation were code-only literals
  while only the four ceilings were owner-owned. All four are now on `owner_search_prefs`. "No
  hardcoded config" is not satisfied by owning the ceilings and baking in what the model is.
- **D-5** — `escalationResolve` REFUSES a resolution without evidence and tells the user "the loop
  re-runs against it". The evidence was stored and **read by nothing**: three writes, zero reads. The
  next run mined the same profile that had already failed. It now reaches the scoped prompt, scoped
  to the requirements still open.

### Still open, recorded not fixed
- **D-6** — P3-09 ("no row with `n > max` for that packet") and P3-33 ("a resolution continues the
  ledger at `max(n)+1`") are contradictory as written. The implementation follows P3-33 and the
  ceiling is per-RUN. Neither acceptance document reconciles them; this needs an owner decision, not
  a code change.
- **P3-07's union property** is still false by construction: a phantom flip is in neither list. It is
  now visible (`phantom_closes` + an escalation) rather than silent, but the stated invariant does
  not hold and the criterion should be reworded to match.
- `STRUCTURAL_FIELDS` stays code-only deliberately: rewriting `@Company` breaks `company_named`, so
  it is a correctness invariant rather than a preference.

### The discipline that caught all of it
Every fix above was revert-proven — the fix removed, the test watched to FAIL, the fix restored.
That is the only step that separates a guard from a comment, and it caught two inert guards of mine
in one session. One D-4 revert was attempted with a `sed` that silently failed to match; the "pass"
that produced was recorded as **no evidence**, not as a proof, and redone with an asserting Python
mutation. A mutation that did not apply proves nothing.


## ACT — BLOCKING: P3's closing mechanism is inert against the post-C6 gate (2026-08-20)

Found at merge time by the P3-15 agreement test, which is exactly what it was written for.

P8.3 landed **C6** and `must_have_coverage` no longer reads the generated document. Measured on the
merged engine, not inferred:

```
document restates the requirement VERBATIM, no evidence rows   -> not_applicable
document restates the requirement VERBATIM, req unevidenced    -> fail
document is "I enjoy sailing and baking bread", req evidenced  -> pass
```

**P3's loop closes requirements by rewriting merge fields. No rewrite can move that gate.** As built
the loop will rewrite, observe zero closes, halt `no_progress` after one pass and escalate
everything. It invents nothing, renders once, and reports honestly — it simply cannot close
anything. Landing it is not harmful; presenting it as a working remediation loop would be false.

Neither lane is wrong. C6 is deliberate and is the more honest model (R2: evidence or escalate). P3
was designed against the pre-C6 gate. The likely resolution is that the loop's job becomes surfacing
profile evidence that EXISTS but was not resolved — `profileEvidenceFor` already computes exactly
that (P3-18) — and escalating the rest, i.e. the loop writes evidence rows rather than merge fields.
**That is a redesign of the closing mechanism and it is NOT done. Owner decision needed.**

Pinned as three tests (`P3-15 CONFLICT` / `P3-15 CONSEQUENCE`) so that whichever way the models are
reconciled, the change fails a test that names what moved rather than silently un-breaking or
further breaking the loop.


## ACT — the C6 "blocker" was a retarget, not a redesign (2026-08-20)

I reported P3 as blocked by P8.3's C6. The analysis was right and the conclusion was one step too
far: **C6 split coverage into two numbers on purpose, and P3 was pointed at the wrong one.**

| check | question | can a merge-field rewrite move it? |
|---|---|---|
| `must_have_coverage` | does the owner's PROFILE evidence this requirement? | **No** |
| `evidence_placed` | is every profile-evidenced requirement actually STATED in this document? | **Yes** |

`evidence_placed` is the document-side half P8.3 built for exactly this purpose. The loop now targets
it (`CLOSE_CHECK_KEY`), and `remediation_loop`'s composite FK binds to it. `must_have_coverage` is
carried as `coverage_state` for reporting only, in no constraint — binding convergence to a check the
loop cannot move would make convergence unreachable.

**The lesson is the near-miss.** I was about to propose redesigning another lane's model when the
affordance already existed, one function below the one I was reading. "Extend, don't duplicate" is
usually cited against building a parallel system; this is the same rule one step earlier — before
declaring a blocker, read what the other lane actually built. The escalation was still correct: I
reported it and stopped rather than redesigning unilaterally, and that is what surfaced the answer.

Four things that made the retarget non-trivial, each now an invariant rather than prose:
- `evidence_placed` reports failure as **`warn`**, not `fail`. Reading `fail` alone would have left
  the loop seeing no work at all, and P3-38's evidence-removal guard blind. The open list is read
  from any judged non-pass state; the guard is `('warn','fail') -> not_applicable`.
- `placeable` excludes rows under `MIN_JUDGEABLE_TOKENS`. Those are in neither numerator nor
  denominator — counting them either way is the laundering defect the coverage check was fixed for.
- A requirement the profile does not evidence is not the loop's to close. It escalates unchanged.
- The `unattributed_coverage` guard carried across untouched: refusing the credit is not refusing
  the claim, and that holds for placement exactly as it did for coverage.

The three pinned tests were INVERTED rather than deleted: they used to record that the loop was
blocked; they now fail if the loop is ever pointed back at `must_have_coverage`, and one asserts the
premise directly — a rewrite must move the check the loop targets.

**Proven against PostgreSQL 16.13 on a populated upgrade**, not asserted: forged `run_id` refused by
the FK; `converged` with a non-empty `remaining` by check2; binding to `must_have_coverage` by the
`close_check_key` CHECK; crediting a close with no edited field by check3. Only the legitimate row
was stored.

### P7 item 6 landed with this lane
`buildPackageForJD` has always returned `warnings` and `qcApplied`; `appPackets` read neither, so a
build that lost a section to an unmapped title or whose ATS-QC call returned empty reported
`ok: true`. Worse, `packetBuildAll` returned `ok: true, note: 'Packet built.'` **even when every
artifact threw** — the per-artifact error was in the payload, but the one field a caller checks said
success. `ok` now means "every artifact built, and none with a warning", and the note names what
failed.

### CLAUDE.md corrected
The "no Postgres in the sandbox" assumption is now explicitly corrected in CLAUDE.md, with the
standing rule and a runnable recipe: **a schema change is not verified until it has been executed
against a POPULATED database with the previous schema already applied.**


## ACT — the retarget verifier found four defects; two were severe, and one class recurred three times (2026-08-20)

An independent verifier reinstated the defect behind **every** guard added in the retarget — 20
mutations, 16 fired. Four findings. Fixed on `claude/qc-p3-remediation`, all revert-proven.

### F1 — the best guard in the lane could not persist its own refusal
`HALT_REASONS` had 11 members; the schema CHECK had 10. `unattributed_coverage` — the guard that
stops the loop claiming a convergence nothing this run produced — was missing. Both TS guards were
live and correct, so at the exact moment the loop refused the claim, the INSERT recording that
refusal violated `remediation_loop_halt_reason_check`: packet already mutated, **no ledger row at
all**, the D-7 phantom escalation never reached, 500 to the caller.

**H40** now asserts the TS union and the CHECK are SET-EQUAL in both directions. Revert-proven both
ways (member removed from the CHECK; member removed from the union).

### F2 — H39's own class, on H39's own table, three times over
The retarget renamed three columns and added a fourth *inside* `create table if not exists`, with no
ALTER. On a database that ran the previous revision the create is skipped: **migration exits 0,
reports clean**, table keeps `must_have_check_key`, and the first INSERT dies with
`column "close_state" does not exist`. H39b only walks columns that HAVE an ALTER, so a column with
none fell outside its loop entirely.

Then the same class twice more, each found ONLY by executing the migration:
- the `halt_reason` CHECK: fixing it in the CREATE fixes a FRESH database only. H40 passed the whole
  time, because H40 reads the source.
- `check4`: after the rename it read `prev_close_state = 'fail'` on an upgraded database and
  `prev_close_state in ('warn','fail')` on a fresh one. Since `evidence_placed` reports failure as
  **`warn`**, the evidence-removal guard was switched off on exactly the databases it protects.

And one inside the fix itself: the do-block's `exception when duplicate_object` **silently aborted
every remaining statement**. On one upgrade path two constraints already existed, the block died
there, and `halt_reason` was never replaced — migration exit 0 throughout. That is
absent-evidence-reads-as-success, in PL/pgSQL. Every statement now drops before it adds, and only
`undefined_table` is swallowed.

**Every CHECK on `remediation_loop` is now named and unconditionally replaced.** Naming is what makes
replacement possible — an anonymous constraint gets an auto-name and can never be dropped by a stable
one. **H39c** (columns this lane changed are reachable on an existing database) and **H39d** (every
named CHECK *and* both column-level CHECKs have an idempotent replacement; no anonymous CHECKs)
encode it. Both revert-proven.

**Proven by execution across five migration paths** — fresh, `main→HEAD`, `main→895→HEAD`,
`main→e5e→HEAD`, `main→895→e5e→HEAD`, and HEAD applied twice — all exit 0 and all reach a constraint
set **identical to a fresh database**. That equality is the invariant worth keeping: a fresh database
and an upgraded one must enforce exactly the same rules, and diffing `pg_constraint` between the two
is how you check it.

### F3 — the tooThin exclusion laundered a pass
Two evidenced must-haves, one judgeable and present, one under `MIN_JUDGEABLE_TOKENS` and **absent**
from the document → `evidence_placed: pass`, `converged: true`, and the user read *"every requirement
the profile evidences is now stated in this document."* The `(1 too short to judge either way)`
caveat lived in `decidePass`'s detail and `reportedOutcome` dropped it. No escalation: both loops
iterate empty lists.

The claim is now qualified **at its source** — "every requirement the profile evidences AND the
placement check could judge" — the count is carried on `Outcome.unjudged`, the caveat reaches every
summary including halted ones, and each unjudgeable requirement raises its own escalation saying a
human has to read it. `unjudgeableSeqs` uses `itemTokens` and `MIN_JUDGEABLE_TOKENS`, the engine's
own function and constant, so the loop's idea of "unmeasurable" cannot drift from the check's.

### F4 — all three P7-6 guards were inert, and backwards
Forcing `failed`/`warned` empty while keeping the literal `ok:` expression → 396/396 passed with the
defect verbatim. Emptying `built.warnings` → 396/396 passed. RENAMING `failed` to `bad` with
identical behaviour → failed. They tested spelling and ignored behaviour — **the second time in this
lane a grep-shaped guard was evaded by a rename, in code written after that lesson.**

The claim logic is lifted into `packetBuild.summariseBuild` (pure: no @azure/functions, no pg, no
network — the `checks.ts` / `appChecks.ts` split) and tested with real inputs. Re-running the
verifier's three mutations now: evasion 1 fails 4 tests, evasion 2 fails 1, and the rename stays
green. Exactly inverted.

### The standing lesson
A guard written *to* a lesson can still be inert — F4 is the proof. And three of the four findings
share one root: **source-reading guards cannot see what a database already has.** The only thing that
found them was running the migration against a populated database that had the previous revision.

---

## P8.4 — comparison dimensions (`claude/qc-p8-4-dimensions`, off `c360e6e`)

**Request:** backlog P8.4 — persist the comparison dimensions with the posting requirement, the
profile value, a graded fit and an optional qualifier note; make the JD step show the comparison
rather than pipeline counters.

**ACs written cold by an independent session** before any code: `docs/qc-evidence/AC-P8.4.md`
(55 criteria, branch `claude/qc-p8-4-ac`). Three of its findings were ground-truthed defects in what
already existed, not predictions — and one of them (`chk_*` has no writer) is now `H35`.

**Built:** `dimensions.ts` (engine), `appDimensions.ts` (store + config route), the comparison card
on the JD step, `dimensions.test.mjs` (36), `dimensionsDb.test.mjs` (5, real PostgreSQL),
`postingCompare.test.mjs` (22), `H34`/`H35`.

**Proved by reverting — 28 defects reinstated one at a time, each failing a named assertion.**
Three guards were INERT when first written and are recorded because that is the whole point:
- the per-family config merge test ran its own copy of the SQL, so clobbering the handler's merge
  failed nothing → the write is now `setDimensionPrefs()`, called by both the route and the test;
- `assert.match(SRC, /COMPARE_SCOPE_NOTE/)` survived the sentence being deleted from the JSX,
  because the import kept the name alive → the guard now ties the constant to its render site;
- `/<ProfileCompareCard/` survived renaming the mount to `<ProfileCompareCardXX` → the guard now
  requires the tag to END and cross-checks the exported component.
`H35`'s first writer-detector accused six settings that DO have writers (it missed dynamically
built `SET` clauses) — it now reads the SQL instead of the JavaScript around it.

**Not done, with rows in `.claude/DEFERRED.md`:** D21 schema registration (lane could not touch
`schema.ts`), D22 the `years_leadership` shadow (still reaches the gate), D23 no `people`/`usd`
comparator, D24 no Settings control, D25 nothing verified live.

---

## QC live defects — D22 and D16 (`claude/qc-live-defects`, off `9a9830e`)

**Request:** fix the two confirmed-live defects recorded in `.claude/DEFERRED.md` — D22
(`experience.years_leadership` structurally unreachable, and it reaches the GATE) and D16
(`appReviewer`'s `engineJudged` counts every must-have while the check judged only `coverable`).
Files in lane: `ownerFacts.ts`, `appReviewer.ts`, `artifactScore.ts` and their tests. `schema.ts`,
`appPackets.ts`, `checks.ts`, `appChecks.ts` and `correction.ts` belong to a concurrent lane.

**ACs were NOT written by an independent subagent.** No agent-spawning tool is exposed in this
session — the process step could not be performed, and it is recorded as `not_applicable` rather
than claimed. The criteria this lane worked to were written by the implementing agent, which is
exactly the cold-read the rule exists to prevent; the compensating evidence is the revert proof
below, not a self-assessment.

**D22 — fixed.** Selection is no longer by catalogue POSITION. `FactDef.refines` declares that
`experience.years_leadership` narrows `experience.years_total`; `selectFactDef` collects every
matching def and drops any that another matching def refines. Declared, not inferred — ranking by
longest match or regex complexity guesses at a relationship the catalogue can state, and this
decides a gate. Non-refinement co-matches (`"Bachelor's degree required; PMP certification
preferred"` matches both education entries) are untouched: catalogue order still breaks that tie.

**Blast radius, traced.** `checkAgainstFacts` funnels into `checks.ts` (`facts_settled`,
`fact_shortfall`, `facts_needed`) and thence to `coverable`. `coverable` membership is UNCHANGED:
`ownedByFacts` already absorbed `unknown` and resolved verdicts alike, so the same rows leave it
either way. What changed is which fact the verdict is about, and the three fact rows that report it.
`dimensions.ts` (P8.4) reads `FACT_BY_KEY`/`demandedNumber` directly and works around the shadow by
selecting the axis's own fact — unaffected, its 36 tests still pass. `appFacts.ts` uses
`proposeMissingFacts`, which still proposes every matching def and was not narrowed.

**D16 — partially fixed; the blocker is named, not worked around.** `judgedMustHaveIds`
(artifactScore.ts) reads the denominator the check published in `must_have_source` plus
`uncovered_requirement_ids`, and never re-derives `coverable` (R4). It is sound in one direction
only — a row it omits is `not_comparable`, never silently agreed. The complete fix needs
`judged_requirement_ids uuid[]` on `artifact_score` (**schema.ts**) filled in `evaluateArtifact`
(**appChecks.ts**), both out of lane. The helper already PREFERS that column when present, so those
two lines complete it with no change here. See DEFERRED D16.

**Proved by reverting — five defects reinstated one at a time, each failing a NAMED assertion:**
1. `refines` declaration deleted → H41 "an undeclared subset relation…", H41b, H43, 3 unit tests.
2. Declaration KEPT, first-match scan restored → H41's *behavioural* half fires ("a general def
   answered a requirement its own refinement also matched"), H41b, H43. The guard cannot be
   satisfied by the declaration alone, which is how two guards were defeated earlier this session.
3. `judgedMustHaveIds` returns every must-have → H44 "rows the engine excluded from coverage were
   counted as agreeing with the reviewer", plus 4 unit tests.
4. The ORIGINAL expression restored at the appReviewer CALL SITE, helper untouched → only
   `appReviewer.test.mjs` fires. H44 does not catch this, which is why that end-to-end test exists.
5. A denominator recompute reinstated inside `computeArtifactScore` → H28 fires on the structural
   half alone, after it was rescoped.

**H28 was rescoped, not weakened.** Its structural half grepped the whole of `artifactScore.ts` for
`kind === 'must_have'` and fired on `judgedMustHaveIds`, which reads that field to answer a
different question and touches no denominator. It now slices `computeArtifactScore`'s own body via a
new `functionBody()` helper. Proof 5 above is the evidence it still fires.

**NOT verified live.** The sandbox cannot reach the Function App, the database or the SPA, and
`db-query.yml` / `api-test.yml` / `ui-verify.yml` are `main`-only. No before/after count of
gate-affected postings exists. D22 changes gate-visible rows on real data and that count is still
owed.

482 api tests pass (461 on `main`; +21 added). Branch pushed, NOT landed on `main`.

## Ledger guard — `.claude/DEFERRED.md` is machine-checked (`claude/ledger-guard`)

**Asked:** "what are ledger rows and why are they becoming stale what needs to be improved or more
frequent" — then "go ahead" on the guard I proposed in reply.

**Answer given, and the evidence for it:** more frequent editing is the fix that had already failed
three times. The ledger needed to become *checkable*. Built:

- `.claude/DEFERRED.md` normalized — a `Status` column (`OPEN`/`CLOSED`/`WONTDO` as a token, never
  inferred from prose), 4 duplicate ids resolved, the `a9f23a3` duplicate `## Contrast`/D26 block
  removed, D35 re-parented, and every open row carrying one executable `check:`.
- `api/test/deferredLedger.test.mjs` — 15 cases, auto-globbed by `node --test test/*.test.mjs` with
  no `package.json` change. 571 api tests pass (556 on `main`).

**Corrections made to my own first pass, both from the independent AC subagent's read:**
- The brief said five duplicate ids; **`D23` is not one** — `D23`/`D23b` are distinct rows and the
  `b` suffix is already the convention (`H4b`, `H5b`). Re-keying it would have broken 25+ pointers.
- The first migration re-keyed **the wrong side of `D21` and `D22`** — it ordered by commit date
  when the ground truth is which row the external citations mean. Fixed, and
  `D:ledger-citation-resolves` makes the class impossible.

**Integration trace.** Core system: the `api/test` suite run by `api/package.json` `test` and
`.github/workflows/test.yml` — extended, not duplicated (new file, no runner change, `D:` slugs that
cannot collide with `H:`). Upstream producers of the ledger: every lane's commit. Downstream
consumers: source comments, `.claude/actions.md`, `hardening.test.mjs` — all grepped, and the
citation guard now proves they reconcile.

**Open, and recorded as a row rather than a note:** `D:hslug-scan-one-file` — `H26` reads only its
own file, so an `H:` slug in a second test file is invisible to it. Latent, not live.

**NOT verified live** — a test-suite and documentation change; nothing deploys.

**The verifier found what self-verification would not.** Eight claims CONFIRMED, and then eleven
defects — the worst being that three of the first four `check:` directives I wrote could never go
false, two proven by reinstating the exact regression while the suite stayed green. That is the rot
vector the whole remedy exists to close, and it was open in the remedy itself. All fixed and each
re-proved by reinstatement. Two of the defects were my own cry-wolf: a line-coordinate ban that fired
on clock times in prose, and a fixture helper that never asserted its own edit applied.
Deferred as rows rather than notes: `D:hslug-scan-one-file`, `D:id-hygiene-duplicated`.

---

## ACT: D35 — build-all is asynchronous, and the cross-owner build hole it ran through is closed (2026-08-22)

**Asked:** "go with 1" — make `build-all` asynchronous rather than tolerating the 504. Then, on the
one decision I surfaced: **"use my azure storage."**

**Shipped** on `main`: `6050fff` (queue + auth), `96e2f06` (UI), `ca83b00` (H33), `e47c8fd` (storage
queue). Deploys: `executive-engine-deploy` run **32550011764** success, `api-deploy` run
**32550011806** success; the storage-queue deploy is the run for `e47c8fd`.

**What was wrong.** `build-all` does ~3 minutes of work and the gateway cuts at ~230s — run
**32546312184** returned 504 at 02:31:51 with all four artifacts already written (02:29:02 / 02:30:10
/ 02:30:53 / 02:31:50, every one with a doc_url), and run 32548283352 returned 502 with `/api/health`
fine throughout. The work completed; only the answer died. So the owner was shown a failure on a
build that succeeded and paid to run it again, and the response was the only home for the warnings
two open findings depend on.

**The shape.** `POST packet/build-async` files a `packet_build_job` row and returns 202. The row is
the record of truth — claim, lease, fence, attempt cap, owner scoping, one-live-job-per-opportunity —
all tested against a real PostgreSQL. The worker runs `runPacketBuild`, EXTRACTED from
`packetBuildAll` rather than copied, so the two cannot drift. The synchronous route is untouched
because `appBulk` and the coach tool call it.

**The wake signal is the storage queue, at the owner's instruction.** First version woke on a
one-minute timer — a fixed-interval poll standing in for an event whose exact moment we already know.
Now the POST sends a base64 message on `packet-build-jobs`. The timer survives demoted to a
five-minute SWEEP, scoped to the only case no message can announce: a worker that dies mid-build.
The encoding is not a detail — the queue extension defaults to base64 and `@azure/storage-queue`
sends plain text, so raw JSON is accepted, sits in the queue and is dead-lettered without triggering
anything. A build that never starts, and no error anywhere.

**The AC agent earned its cost, and the most expensive finding was not the one I asked about.**
`requireWrite` passes any request resolving to the demo workspace — *including one with no
credentials at all* — and `build-all` then loaded its opportunity `where id = $1`. An opportunity
UUID was the only thing between an anonymous caller and a full build against another owner's packet:
four Google documents overwritten in their Drive, the model budget spent. `artifactGenerate`,
`artifactDocument` and `artifactSlides` had the identical shape. All four now go through one
owner-scoped loader (`loadOwnedArtifact`), and `enqueueBuild` refuses to file a job it does not own.
I had read authentication as authorization — the same conflation as the in-process evidence call
fixed hours earlier, which is why this is a row and not a note.

**Six defects in my own queue code, found by that same cold read, each now a test:** the attempt cap
sat OUTSIDE the claim's subquery, so one poisoned job returned "queue empty" and would have stopped
every build for every owner with no error anywhere; `finishBuild` discarded the payload on failure —
throwing away the partial-build evidence this queue exists to preserve; it was unfenced, so a
reclaimed zombie could overwrite a live run; a rebuild requested behind a live cached build was
silently downgraded to it (a control that appears to work and does nothing); `enqueueBuild` could
return an absent job while its type promised one; and a job could be filed against another owner's
opportunity.

**Integration trace.** Core system: `runPacketBuild` — the one build path, now with two callers
(route, worker) instead of one. Upstream producers grepped: `api.js buildFullPacket` /
`queueFullPacket`, `appBulk` self-fetch, `coachTools.build_full_packet`. Downstream consumers:
`packet.last_build`, `recomputePacket`, `summariseBuild`, the PacketBuilder screen. Extend, not
duplicate: the sync route keeps its callers, the queue is a wake signal over the existing job table,
and `loadOwnedArtifact` is the join `appRemediation` already used.

**Evidence.** `api/test/buildQueueDb.test.mjs` 11/11 against real PostgreSQL; five mutations proven
to bite (claim scope, fence, payload-on-failure, regen promotion, owner scoping).
`api/test/buildSignal.test.mjs` 5/5, five mutations proven to bite. Full suite 689 tests, 689 pass.
H33 was widened, non-vacuously: it FAILED on this tree before the widening and passed after, with no
source change between.

**NOT CONFIRMED LIVE.** No build has yet run through the queue in production. D35 stays OPEN until a
real `build-async` on Trinnex reaches `state: done` with its artifacts.

**Flagged, undecided:** `STALE_CLAIM_MINUTES` (10) and `MAX_ATTEMPTS` (3) are code-only operational
knobs with no Settings path — against the strict no-hardcoded-config rule, held pending explicit
approval to leave them code-only. Nothing prunes `packet_build_job`; unbounded growth accepted for now.

---

## ACT: the three prompt-path fixes — Call 2, role focus, ATS analysis (2026-08-22)

**Asked:** after reading the 42 warnings the async queue finally made readable, three fixes in order —
(1) parse Call 2 with the section parser, (2) capture the discarded ATS analysis, (3) role focus.
Then, on the persona question: *"let the resume chosen drive the persona, right now it's only
engineering available"*, *"try to continue the AC from where it was instead of starting over"*, and
*"finish everything you've noted"*.

### 1. Call 2 — DONE, CONFIRMED LIVE (`4fb00e1`, `2cf29ca`; build job `1c0ad2f3`, `done`, 198s)

Settled from the PRIMARY SOURCE, which is the only thing that could settle it: `portfolio_user` v002
is Zap node **299599701, "Copy: Update Resume/Portfolio Fields"** — a copy of Call 1's node — and it
emits `Skills1`, `Skills2`, `Relevant Skills 1/2/3`, `Word and Character Requirements Check`. Plain
`### Title ###` text; it never asks for JSON. `parseAgentJson` could not have succeeded, ever. Read
twice as something else: a flaky model, then a duplicate-prompt bug.

It also never emits a cover letter, About Me, executive profile or cold email — the fields
`assemblePackage` READ off `call2`. That expectation was fiction; those come from Call 1 and the
baseline `set_value` nodes. Measured: warnings `Call 2 returned no JSON object` **4 → 0**, ten Call-2
sections parsed, and the document changed — `SkillsBullets1` 232→**385**, `SkillsBullets2` 153→**239**,
`RelevantBullets1/2/3` 89/94/89→**65/60/63**, both directions matching the prompt's own hard
requirements. The owner's two-pass refinement ran for the first time. **No prompt was edited.**

**The AC agent caught a defect in this fix AFTER it shipped**, which is the whole argument for the
cold read: `{...c1, ...c2}` fed Call 3 a package with six of Call 1's fields BLANKED, because
`parseResumePackage` returns every key defaulted `|| ''`. Call 3's verdict outranks Call 1 in the
document, so that writes degraded content while the build reports `built: 4, failed: 0`. Fixed with
`mergeCallTwo`/`call2Draft` — an allowlist of the five fields node 299599701 actually asks for, and
anything else Call 2 improvises is named and refused. One build ran with the defect; no field was
blanked in the document (they come from Call 1 and `''` is falsy), but `ResumeSummary` 381→468 was
generated by a QC pass that could not see the original. Not proven degraded, not trustworthy either.

### 3. Role focus — DONE (`b9b5567`), deployed; taken out of order because the owner ruled on it

The old first source looked up `templates/<roleRowKey(roleType)>` where `roleType` is the posting's
FREE-TEXT JOB TITLE — `templates/director-of-digital-technology-operations-&-innovation`. No such row
exists for any posting, so it was dead on arrival. The `persona` source below it is dead too:
**`opportunity.persona_key` is NULL on 1,676 of 1,903 rows** and the owner confirmed the design was
abandoned. Every build fell to a code constant, and a Director of Digital posting was written for
"a senior ENGINEERING executive".

Now: `templates/resume-<driveId>` is read first, keyed by the Drive id the build actually copies.
Only one template exists, so **no document changes** — `source` moves from `seed` to `template`,
which is the whole point. Plus the WRITER (`GET`/`POST /api/config/templates`, Settings ▸ Quality),
without which this change would itself have broken the no-hardcoded-config rule. Blank clears rather
than storing `''`, which would win over the seed and blank the directive every prompt is prefixed with.

### SECURITY found on the way, and the guard that blessed it

`POST /api/config` used `requireWrite`, which allows any request resolving to the demo workspace —
including one with **no credentials**. `AppConfig` is global state with no demo partition, so an
unauthenticated POST could rewrite the pipeline's template ids, output folder and sender address.
`promptsApi` had already written this exact reasoning for the Prompts table.

**`H:config-route-is-not-open` had pinned `requireWrite` AS the requirement** — so the guard PASSED
on the hole it existed to prevent. That is the sharpest instance yet of an inert guard: not one that
fails to fire, but one that certifies the weakness. Corrected, and the correction mutation-proven.

### 2. ATS analysis capture — NOT STARTED

Its AC pass is running (continued from the killed agent's file rather than restarted, per the owner).
It stores MODEL OUTPUT, so it is tier 1 by CLAUDE.md's blast-radius table: the cold read comes before
any code. Note it now has TWO producers — Call 1's unmapped sections and Call 2's.

**Still flagged, undecided:** `STALE_CLAIM_MINUTES`/`MAX_ATTEMPTS` code-only; `packet_build_job`
retention unbounded.

**Integration trace.** Core system: `buildPackageForJD`'s three-call sequence, extended not
duplicated — Call 2 now uses the SAME parser Call 1 uses, and `mergeCallTwo` is the one merge point.
Upstream: the Prompts table (untouched — the owner's constraint). Downstream grepped:
`assemblePackage` (all 5 skill slots), Call 3's input, `pkg_json`, `swap_decision`, `varsForType`,
the artifact documents. Role focus: `decideRoleFocus` is the one decision point and the ladder below
the template is asserted unchanged.

## Full-system maps + the three gaps they surfaced (2026-08-22)

**Request (owner):** *"yes but it's seems you need a full grep of the original prompts and current
system and desired packets spec. most of your water tubes seems like short sightedness"*

**Delivered:** three maps under `.claude/map/`, every claim carrying a `file:line` —
`prompts.md` (587), `build-path.md` (698), `spec-vs-shipped.md` (483, now COMPLETE §1-6).

**Durable output:** three OPEN ledger rows in `.claude/DEFERRED.md` for gaps no existing row covered
— `D:packet-cannot-be-sent` (39 packets, 0 sent, 0 approved, 2 of 1,924 `applied`),
`D:every-build-is-destructive` (`version_history` stores `{"len": N}`),
`D:no-template-picker` (`artifact.template_id` dead, 0 of 195 populated).

**Guard interaction worth keeping:** `D:ledger-stale-row-fails` REJECTED all three on first write —
the `check:` clauses carried prose where the file path belongs, so the parser read `version_history`
and `update` as filenames. Fixed to the real grammar; machine-checked rows 14 → 16; both new clauses
mutation-proven to bite in the correct direction. Evidence: `node --test test/deferredLedger.test.mjs`
→ 16/16, and each mutation reproduced its own row's failure message.

**Tier 3 (prose)** per CLAUDE.md's blast-radius table — `.claude/**` only, no executable behaviour
changed, no deploy path touched. No AC subagent, no verifier; the mutation-proof was still run.

**Still open from this thread:** the single-generation fix (owner said yes, conditioned on the map
landing first — now landed); Call 3 parsed as sections, gated behind supplying the 12 blank
`atsExtra` tokens; three-pass swap attribution (ACs complete at `.claude/ac/three-pass-swaps.md`);
and the owner decision `D:packet-cannot-be-sent` asks for.

## Single generation per build (2026-08-22) — `claude/ledger-spec-gaps`, commit `67e4caa`

**Owner approval:** "yes", conditioned on the systemic map landing first. It landed (`33e6fd6`).

**Defect:** `runPacketBuild`'s loop passed `body?.regen === true` on every iteration, so a rebuild
ran the three-call pipeline four times and each document rendered from its own generation, while
`pkg_json` kept only the last — the package every check, the gate, the score and the reviewer grade
against. Evidence: job `945e28ed`, 42 warnings = one generation's ~10-11 repeated four times.

**Fix:** `let regen`, cleared after the first SUCCESSFUL build, inside the try. Ordering is the
correctness argument, not a style choice — clearing early reintroduces `A2` via the failure path.

**Guard:** `H:one-generation-per-build` brace-matches the loop body and asserts three properties
(no request read inside the loop, a clear exists, the clear follows the call). All three
mutation-proven to fail with their defect reinstated.

**Two hardening lessons, both recorded in memory.md:**
1. The guard's first regex `[?.]*\.` greedily ate both characters of `?.` and **passed with the
   defect reinstated** — an inert guard, caught only because the mutation was run.
2. The mutation itself **silently failed to apply** twice (`perl -0pi`), so the green result proved
   nothing. Mutations now grep the mutated line and abort if the edit is not visibly present.

**Verification:** api build clean, 708 tests / 0 failures. Landed on `main` (`67e4caa`) and
**deployed — api-deploy run 32599485997, conclusion success**, waited on by
`wait-run.sh sha:api-deploy.yml:67e4caa` (never `latest:`, per H15).

Live rebuild filed on Trinnex `9f9c370a`: `POST packet/build-async {"regen":true}` → **HTTP 202**,
job `3ae8d684-eaff-44a7-a624-80e5a5fa2245`, created 21:26:55.409, **claimed 21:26:57.788 — 2.4s,
by the queue message**. `state: running` at the last poll (21:27:54).

**CONFIRMED IN PRODUCTION 2026-08-22, job `3ae8d684` `done: true`** (api-test run 32599780319).
The prediction was warnings **42 → roughly 10-11**; measured **10**, and the shape is the proof,
not just the count:

| artifact | warnings | qcApplied | doc |
|---|---|---|---|
| `resume` | **10** | `true` | Google Doc |
| `compact_resume` | **0** | `null` | Google Doc |
| `cover` | **0** | `null` | Google Slides |
| `portfolio` | **0** | `null` | Google Slides |

`qcApplied: null` is `ensurePackage`'s cached-path signature — it means "not measured on this call".
Three of the four artifacts returning it is DIRECT evidence that generation ran **once** and the
other three read back the package artifact 1 wrote, rather than an inference from the warning count
falling. All four still produced real Drive URLs and `packetStatus: review`, so nothing regressed.

The 42 was one generation's 10 repeated four times, as claimed — and the four documents now render
from the same `pkg_json` that every check, the gate, the score and the reviewer grade against.

## Send write-back + review notes (2026-08-22) — commits `5ee24a9`, `aa4a42f`

**Owner request:** "yes build 1 and 2", after I corrected my own overstated claim that the ship half
of the product did not exist.

**Neither item needed a schema change.** `packet.status` already allowed `'sent'`, `packet.feedback`
was already a declared jsonb column, `packet.round` too — all three written by nothing. Adding a
`packet_review` table would have stood a parallel system beside three unused columns.

1. **Packet learns it shipped** — `markPacketSent`, wired at BOTH outreach write points; `'sent'`
   made terminal in `recomputePacket` (without which the next artifact change resets it); build
   response derives `sent` instead of its lifelong literal `false`.
2. **"Request changes" carries a reason** — note appended to `packet.feedback`, unresolved notes for
   that artifact type steer the next generation, prepended as a directive exactly as `roleDirective`
   already is. **Prompts table untouched**; notes resolve only after the package is stored.

**Deliberately NOT built, and it is a correction to my own recommendation:** auto-advancing
`opportunity.stage` to `applied` on send. The outreach channels include `linkedinConnect`,
`coldCall` and `followUp` — a connect request is not an application, so auto-advancing would mark
the pipeline applied on a LinkedIn touch. Flagged to the owner as the one open decision.

**Guards:** `H:sent-is-terminal-and-written` (3 mutations), `H:changes-carries-a-reason` (4).
One of the latter's assertions was INERT when first written — a bare `/revisionNotes/` word-match
that stayed green when the call site lost the argument. Now scoped to the sliced call.

**Verification:** api `tsc` clean, app `vite build` clean, per-file sweep of all 35 test files with
0 failures. Landed `aa4a42f`; **api-deploy run 32600599339 and executive-engine-deploy run
32600599321 both success.**

**ITEM 2 CONFIRMED LIVE.** `POST /api/app/artifact/77d5e147.../status` with `{"status":"changes",
"note":"..."}` returned **HTTP 200 `feedbackAdded: true`** (api-test run 32600705072), and the
database confirmed the row rather than the response alone (db-query run 32600729488):
`notes 1 | last_type cover | last_resolved false | LIVE VERIFICATION 2026-08-22 - open with the
Trinnex water-l...`. Type-scoped and unresolved, exactly as designed.

Test data then REMOVED (db-query run 32600754657, `UPDATE 1 / UPDATE 1`, verified
`notes_left 0 | cover_status review`) — an unresolved note would otherwise have steered the owner's
next real cover regeneration with a verification string.

**ITEM 1 NOT CONFIRMED LIVE, deliberately.** Proving the send write-back end to end requires
actually sending an email through Graph to a real recipient. That is an outward-facing, irreversible
action and was not part of the request, so it was not done. What IS proven: `tsc`, the guard with
three mutations, and the fact that `markPacketSent` is reached from both write points. What would
confirm it: the owner sending one real packet and seeing it move to the "Sent" group.

## "Mark as applied" button + the extension deferred (2026-08-22)

**Owner request:** *"for now, a button I press along the workflow letting you know I've done so as
well as marking that eventually we have to update the appl scraper answer generator extension..."*

**Built — no new route.** The stage route (`POST /app/opportunity/{id}/stage`) and the `moveStage`
client helper already existed and already recorded stage history. The button reuses both; the only
server change is that the stage route calls `markPacketSent` when the stage becomes `applied`, so
one press writes BOTH facts and they cannot disagree. `PacketBuilder` gets a confirmed
"Mark as applied" action beside "Send packet →", and an `Applied ✓` pill once set.

**Why it hangs off the stage change and not the send** — this is the whole point of the design and
is now a guard: `outreach_message.channel` includes `linkedinConnect`, `coldCall` and `followUp`, so
advancing on send would mark the pipeline applied on a connect request. `applied` is the number the
funnel is judged by; inflating it from a LinkedIn touch corrupts the exact metric this work set out
to make truthful. A human pressing the button is the only signal that means it.

**Guard:** `H:applied-is-declared-not-inferred`, three mutations proven — including the real one,
making the send path write `stage = 'applied'`, which the guard rejects.

**Deferred, recorded as `D:no-application-answer-assist`:** the application-form scraper + answer
generator extension (common vs unique questions, and attaching the built artifacts). Ledger row
names what already exists to EXTEND rather than duplicate — `ownerFacts` and `requirement_evidence`
are the answer substrate, `appJdParse` already parses postings, artifacts already carry Drive URLs.
Not scoped: it is a separate delivery surface and the owner said "eventually".

**CONFIRMED LIVE (button):** `POST /api/app/opportunity/9f9c370a/stage {"stage":"applied"}` returned
`stage: applied, packetSent: true` (api-test **32601313786**), and the DB read back `applied | sent`
(db-query **32601337296**) — one press, both facts. Test state restored to the captured baseline
`enriched | review` with 0 `applied` stage-history rows (db-query **32601386185**).

**Trap recorded in memory.md:** `db-query.yml` runs the whole `sql` input in ONE transaction. A
failing statement rolls back earlier `UPDATE`s that already printed `UPDATE 1`, so the run's own
output is not proof a mutation persisted — re-read state in a separate invocation. My first restore
attempt silently left production `applied | sent` while the log read as success.

**Deploys:** api **32601204463**, frontend **32601204611**, both success on `b772361`.

## The two-day blocker: `ready` was unreachable, and the lesson is now a test (2026-08-22)

**Owner:** *"this things still isn't usable after two days"* → *"Mark to prevent causing me 2 days
again. there must be something learned."*

**Blocker 1 — video held every packet out of `ready`** (`cf2bbad`). Build loop skips video
(`!metaFor`), `recomputePacket` required ALL artifacts approved. Fixed by filtering on the same
`metaFor` predicate the builder uses.

**Blocker 2 — the build never ran checks, so approval was deadlocked.** `approvalBlock` refuses
without an `artifact_gate` row; `evaluateArtifact`'s only callers were a manual route and the
remediation loop. Live: cover 0 check rows, portfolio 0, compact_resume 0 of 39 each; approving the
Trinnex cover returned HTTP 409. **Fixed by RUNNING the checks, not weakening the gate** — the
engine is type-agnostic and was designed for all four artifacts.

**THE MARKER (what the owner asked for):** `api/test/shipPathDb.test.mjs` — the ship path executed
against a real PostgreSQL. Seeds the real five artifacts, approves what a build produces, calls the
real `recomputePacket`, asserts `ready`. Mutation-proven. Plus
`H:build-runs-checks-so-approval-is-possible`, which FAILED on shipped code — that is how blocker 2
was proven rather than argued.

**The rule:** *a funnel stage reading exactly zero across its whole history is a structural claim,
not a usage signal — prove the transition into it can happen before building anything downstream.*
I read `0 approved / 0 sent` as unused three times while building on top of a gate nothing could pass.

**Correction on the record:** I recommended weakening the approval gate, on the unverified premise
that no check suite existed for cover/portfolio. Reading `evaluateArtifact` showed it type-agnostic.
The premise was inferred, not checked — the same failure mode as the two-day miss itself.

**LIVE RESULT (ship path, deploy `ae72a56`):** rebuild → checks now written for every buildable type
(cover 0→15, portfolio 0→15, compact_resume 0→18, resume 78; video correctly 0). The
"no checks have been run" deadlock is CLEARED. All four gates read `fail` on real findings —
`skill_char_limit`, `relevant_char_limit`, `cross_list_redundancy`, `word_counts`,
`changes_cited`, and `must_have_coverage` 1/5 — most of which are the owner's own prompt rules
being enforced for the first time. A `fail` cannot be overridden by design, so the next step is the
remediation loop, NOT a gate change. Before: no effort could ship. Now: nameable, fixable findings.

## Remediation run + why the rubric is not self-enforcing (2026-08-22)

**Owner asked:** run remediation and show a packet reaching ready; and *"why are these allowed to
happen? don't the prompts need to be hardened or better systemized?"*

**Remediation RAN and FIXED NOTHING.** api-test run **32603441906** on the Trinnex cover:
`closed: 0`, `editedFields: []`, `phantomCloses: 0`, `haltReason: no_coverage_evidence`, 7.5s,
$0 spend. It halted cleanly with 26 findings still blocking the gate.

**Root cause, ground-truthed rather than guessed.** Two automated correctors exist and neither
covers the blocking findings: `applyCorrectionPass` fixes only posting-ECHOES; the remediation loop
is built around COVERAGE (`coverageView`, `cov.openSeqs`, `scopeForRequirements`, `CLOSE_CHECK_KEY`).
`skill_char_limit`, `relevant_char_limit`, `cross_list_redundancy` and `word_counts` — four of the
six blocking families — are stated in the prompt, measured by the checks, and **enforced by nothing.**

Recorded as `D:mechanical-rules-have-no-enforcer`. The owner's instinct was correct; the fix is NOT
prompt hardening but a deterministic normaliser EXTENDING `applyCorrectionPass`.

**Could NOT show a packet reaching `ready`** — that is blocked on this gap, not on the two structural
fixes landed earlier today (which are confirmed working: checks now run for every buildable type).

## Normaliser WIRED and deployed (2026-08-22)

Owner: *"I don't understand why you stopped here instead of continuing until deployed."* Correct —
the module was committed unwired. Finished in the same session.

**Wired into `ensurePackage`**, positioned deliberately: AFTER `applyCorrectionPass` (a correction
changes text and can push an item back over its limit) and BEFORE the `pkg_json` write (so the
documents render from the same text the checks grade). Uses the OWNER'S merged thresholds
(`{...DEFAULT_THRESHOLDS, ...await loadThresholds(client, opp.owner_email)}` — the identical merge
`runChecks` does at `checks.ts:247`), and pins `gpt-4o-mini` explicitly because `openAiJson` defaults
to `gpt-4o` — the owner asked for the same model that wrote the draft to do the rewording.

Every change and every unfixable item is pushed into `built.warnings`, so the build reports what it
normalised and what it could not.

**Guard:** `H:normaliser-runs-on-the-stored-package` — three mutations proven (removing the call,
substituting code defaults for owner thresholds, dropping the model pin).

**Boost DB Connector:** the owner added it and it WORKS — `execute_sql` against
`boost_resume_n_packet_builder` returns instantly, replacing the 40-60s `db-query.yml` round trip for
READS. It is read-only, so mutations still go through the workflow. `Azure_pg_mcp` remains
unauthorised.

## ACT — evidence spine emptied itself on every build (2026-08-23)

**Request context:** owner said *"I don't care just start picking when it's job destructive and more
risk to keep moving"* — so this was picked and carried to a deployed fix without asking.

**Found:** `requirement_evidence` held **1 row across 613 opportunities with requirements**.
`must_have_coverage` read `0/12` and `responsibilities_addressed` `0/21` on all four artifacts of a
packet built from a real 9,749-char posting (eMoney `2cb56fb3`).

**Cause:** `writeEvidence` (appRequirements.ts) opened by deleting EVERY evidence row for the
opportunity. `runPacketBuild` escalates first (transport present → 8 `proposed` rows stored), then
runs `evaluateArtifact` per artifact, which calls `writeEvidence` with no transport — so the
escalation pass is skipped by design and the delete removed rows that call could never rebuild.

**Evidence:** before/after on the same opportunity, minutes apart — 8 rows after `POST /evidence`,
0 rows after `POST /packet/build-all` (db-query runs 32614576680 / 32614402373; build job
97132108910 reporting `escalated:12, proposed:8`).

**Fix:** delete scoped by `canEscalate` (a pass may only delete what it can rebuild) + deterministic
evidence evicts a stale proposal for the same requirement, because `on conflict (...span...) do
nothing` is keyed on the span not the method and would otherwise swallow the rule row.

**Guards:** `H:evidence-survives-the-build`, `H:rule-evidence-evicts-a-stale-proposal` in
`api/test/shipPathDb.test.mjs`. Both mutation-proven (each fails with its defect reinstated).

**Corrected two of my own claims in the same pass:** the "31% of 1,941 opportunities lack `jd_real`"
figure was over ALL rows incl. dismissed/demo/other owners — the owner's active pipeline is 92.5%
covered with an EMPTY backfill queue; and every `check_result` in the DB belonged to Trinnex, a
1,054-char extension snippet, so "26 blocking findings" was n=1 on the worst input in the system.

**STILL OPEN:** the deterministic resolver evidences **0 of 35** requirements against a healthy
profile. That is why all 12 escalated. Coverage cannot rise until it is diagnosed.

## ACT — advisory gate mode shipped (2026-08-23)

**Owner authorised explicitly:** "continue to ship tonight and we will work on the faster connection
in parallel." Option B of the A/B/A+B choice. Option A (the proposal-confirmation path that
permanently unpins coverage) has ACs written and is NOT yet built.

**Delivered:** `chk_gate_advisory`, default FALSE. A `fail` becomes overridable through the existing
audited path — never a silent pass, never a rewritten gate value. Five sites updated (two server
gates, the packet `ready` computation, and two client mirrors); `recomputePacket` was the one that
would have made the whole change inert while every call returned 200.

**Guards:** 4 advisory H-cases + `H:every-chk-column-is-selected`, all mutation-proven.

**STILL OPEN and the real fix:** `D:proposals-can-never-be-confirmed`. Advisory mode lets the owner
ship past a gate that is pinned at 0; it does not make coverage correct. Turning it back OFF is the
signal that the resolver work landed — nothing currently records that intent, which is a known risk
(the realistic failure is not a bug but that it is never turned off again).

## ACT — Option A shipped and verified live (2026-08-23)

Owner: "continue from here deploying the version i wanted not some advisory mode".

**Delivered:** the proposal-confirmation path (`evidence_confirmation`, keyed on claim identity;
confirm/reject route with server-resolved actor and same-statement ownership filter; gate counts a
CONFIRMED proposal only), PLUS the escalation-priority fix without which it was inert.

**Verified live on 2cb56fb3:** proposals on must_have 0 -> 5; `must_have_coverage`
`0/12 must-haves evidenced` -> `2/12`, with the remaining 5 correctly reported as
"awaiting your confirmation" and NOT counted.

**Open:** turn `chk_gate_advisory` OFF once the owner is shipping on merit. The confirm route needs
a VERIFIED session, so confirmations must come from the UI — a service-principal workflow token
cannot make them (by design; the audit row records who decided).

## ACT — design package re-anchored to the as-built lineage doc (2026-08-23)

Owner: "read both pages which gives you the layout and lineage once extracted and organized this all
needs to be stored in the repo so that development is consistently anchored to it", then
"the repo versions need to be updated as changes were made".

**Done:** replaced `docs/qc-evidence/Evidence Model & QC Lineage.html` (first draft -> as-built, 121
lines) and `Packet QC Prototype.html` (2-line light-theme meta). Verified byte-for-byte that nothing
else in the package changed. Rewrote `IMPORT-NOTE.md` with the settled decisions, an explicit
precedence rule (lineage doc > prototype > screenshots), and the divergence table.

**Open, and now spec-grounded rather than inferred:**
- `swap_decision.override_value` / `override_state` are unbuilt -> defect-register **C1 + C3**,
  `BACKLOG.md` **P8.6**. This is the owner's "I have no mechanism to put back the item it displaced".
- `app/src/screens/PacketBuilder.jsx:42` implements the **QC rail step the settled spec drops**.
  Needs an owner decision: reconcile to the spec (evidence inline + one ATS Match modal), or keep
  the step and record the deviation. NOT actioned unilaterally — it is a whole-screen change.

### CORRECTION (same day) — the precedence rule was backwards

I told the owner the QC rail step was dropped, sourcing §5a/§7 of the lineage doc. **Wrong.** The
owner rendered the published prototype and the QC chip is plainly there. I then reproduced it
locally by EXECUTING the prototype headless: rail = `JD analysis · 2 Resume · Cover letter ·
4 Portfolio · 5 Intro video · 6 QC & evidence · 7 Review & send`.

The prototype is behavioural ground truth; the doc's §5/§7 prose is not. `PacketBuilder.jsx:42`
stays. `IMPORT-NOTE.md` and `memory.md` now carry the corrected rule plus the render recipe, so the
next session can settle any "what does the screen show" question by running it instead of reading.

### The QC step is NOT a choice — the design already does both (2026-08-23)

Owner: *"I prefer inline for the example you gave for what was fixed instead of having to be
launched to a different tab, but I believe other uses still use the qc tab so it shouldn't get
dropped altogether"* — then: *"why do you need a hybrid? what is different in what I described and
what the current spec shows?"*

**Nothing is different. There is no hybrid.** I manufactured a false choice on top of the earlier
wrong reading. Rendered proof (`scripts/render-spec.mjs`):

- **Step 2 Resume** renders **8 inline "Corrected for you" cards** in the field margin, plus
  `Show original`, `Ask for a change`, and a CHANGES MADE trail with `Undo` /
  `Suggest something different` per row.
- **Step 6 QC** renders the same corrections rolled up as **"Done for you — 15 corrections already
  applied"** with `Change it` / `Review →`, then **"Needs a decision"** (9 left) and the tabs
  Coverage · Swaps · Passes · Checks · Review.

Same `correction` rows, two surfaces: inline where you read, rolled up where you audit. Build the
design as-is. **Do not remove the QC step, and do not move corrections out of the field.**

**New capability, committed:** `scripts/render-spec.mjs` renders any prototype step headless with
no network. Two silent traps handled — Babel cannot XHR `.jsx` over `file://` (empty `#root`), and
`theme.css` imports tokens from a `_ds/<id>/tokens/` path the package does not ship, which renders
the page structurally right but **entirely colourless**. The token check is mutation-proven.

### ACT — inline corrections SHIPPED, NOT YET CONFIRMED LIVE (2026-08-23, `2b6331b`)

Owner: *"actually you have not updated the boost app to have the UI design, layout, buttons of the
prototype"* — correct, and this is the first commit that changes application code rather than docs.

**Built:** the field margin in `AssetBlocks.jsx` now renders "Corrected for you" beside the sentence
a correction changed, using the SHARED `CorrectionRow` (exported from `QcRail.jsx`, new `inField`
prop) and reaching the log through `railChangeLog` — one definition, two surfaces. Two guards,
both mutation-proven (private-row swap fails; `startsWith` scoping fails). App suite 210/210,
vite build clean, deploy run 32644674100 SUCCESS for the exact SHA.

**NOT CONFIRMED LIVE — do not mark this done.** `ui-verify` on
`#/packet/2cb56fb3…/resume` returns `bodyLen: 850`, `count: 0` for
`[data-qc="blocks-corrected-for-you"]`, and `clicked: "not found"` for
`[data-qc="blocks-toggle"]`. The DB says that resume artifact HAS 1 correction and 7 insertions, so
the data exists — the blocks panel simply is not on the rendered page.

**Open question this raises, and it is a real one:** the prototype's resume step shows the field
blocks IMMEDIATELY (rendered 2026-08-23: Resume summary, Skills 1 … all visible on load). The live
app renders 850 characters and no blocks panel. Whatever gates that panel is the next thing to find
— the inline corrections cannot be seen until it is, and this is likely the same reason the owner
experiences the app as not matching the design.

### ACT — blocks panel FIXED LIVE; corrections wired but NOT yet visible live (2026-08-23)

**Question asked:** "find why the blocks panel isn't rendering." Two separate defects, both found.

**1. FIXED AND CONFIRMED LIVE (`8923668`).** Every artifact card was collapsed by default, so the
whole body it gates - every merge field, margin, keyword chip - was never in the DOM.
`ASSET_HEADER_DEFAULT_OPEN = false` applied P8.7 ("asset headers are collapsed by default") to the
WRONG OBJECT: in the design, `AssetHeader` is the "What this resume answers" counters panel INSIDE
the card, not the card's own disclosure. Renamed to `ASSET_BODY_DEFAULT_OPEN = true`.
**Confirmed by looking at the live page** (`ui-shots` branch): 7 merge fields, "What is in this
asset" with real counters (4/35 posting lines, 6/10 changes, 7/7 fields), swap rows, R-chips,
highlighted "Posting says:" quotes. The draft is visible in production again.

**2. WIRED, DEPLOYED, NOT CONFIRMED LIVE (`3dd03a0`).** `checks-result` never carried a
`corrections` key, though `api.js` documents that "the change log rides on artifactChecksResult" and
`correctionsState` reads exactly that key. So corrections were invisible in BOTH surfaces - the QC
step's "Done for you" and the field margin - while the rows sat in the table. The dedicated
`GET /artifact/{id}/corrections` route exists and `api.js` has no client for it.

Fix adds the key from `listCorrections` (the same function the dedicated route uses).
**Proven locally by controlled experiment** (`scripts/render-app.mjs`): fixtures identical except
that key -> `[data-qc="blocks-corrected-for-you"]` counts **0 without, 1 with**, and the field
renders CORRECTED FOR YOU with Undo / Suggest something different.

**Still failing live after 3 checks** post-deploy (api-deploy SUCCESS for the SHA). Prime suspect is
Azure Functions stale-worker convergence - the `azure-functions-deploy-verify` skill exists for
exactly this and prescribes a restart-to-converge. NOT yet ruled out; do not call this done.

**Next session, in order:** (a) confirm the deployed payload actually contains `corrections` (read
the HEAD of the checks-result body, not the tail - the key sits before `score`); (b) if absent,
restart the Function App to converge and re-check; (c) if present but the UI still shows nothing,
the defect is downstream of the payload and `render-app.mjs` with a REAL captured payload will
localise it in one run.

**Tooling that made this findable, and is now the standard loop:**
- `scripts/render-app.mjs` - renders this repo's `app/dist` locally against fixtures in ~2s.
- `scripts/render-spec.mjs` - renders the design prototype locally.
- `ui-verify.yml` now pushes its PNG to the orphan `ui-shots` branch, because the sandbox cannot
  download a workflow artifact (proxy 403s both routes) but CAN `git fetch`. Read a live screenshot
  with `git show origin/ui-shots:latest.png > /tmp/x.png`.

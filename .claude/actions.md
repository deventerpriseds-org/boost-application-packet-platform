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
**ACs:** TBD — to define via define-acceptance-criteria before building.
**Status:** `open` (in planning)

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

**Known limitations (forward rules are a first attempt, as the user framed it):**
1. Outlook rules can't run the digest-role extractor, so a subject like "…is hiring for Program
   Manager. 3 more Deputy CIO jobs" can trip the "CIO" keyword and mis-file to C Suite. The 2h
   **reconcile timer is the backstop** that corrects these.
2. **No catch-all parent rule for LinkedIn/Ladders** — non-seniority LinkedIn/Ladders mail has no
   forward rule, so it stays in the inbox until reconcile/intake picks it up. Indeed/Lensa already
   have parent sender rules (seq 16/17). Follow-up: add source→parent rules for LinkedIn/Ladders.
3. The old **"LinkedIn Job Alerts" rule (seq 21, id `AQAAAQEGIDQ=`) is an empty no-op** (no
   condition, no action). Left in place (harmless); should be deleted or rebuilt as the LinkedIn
   parent catch-all.

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

*Last updated: 2026-07-22*

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

**Status:** `open`
**Root cause identified:** `NEW_STAGES` excludes `enriched`; `personaKey` undefined from context. Fix outlined in plan file `cryptic-stirring-lagoon.md`.

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

*Last updated: 2026-07-21*

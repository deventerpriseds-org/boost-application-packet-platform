# Handoff: Executive Engine

## Overview
The **Executive Engine** is an AI operating system for the executive job search — from inbox alert to signed offer. It watches connected inboxes for job-alert emails, pulls matched roles into a reviewable pipeline, tailors every application asset to beat ATS filters, runs multi-channel outreach, and coaches through interviews and offers.

This bundle is the complete design reference: two working HTML prototypes (Compass-skinned + hand-drawn original), the product spec, the system architecture, and the Compass design tokens.

## About the Design Files
The files in this bundle are **design references created in HTML** — interactive prototypes showing the intended look and behavior. They are **not production code to ship directly.** The task is to **recreate these designs in the target codebase's environment** (React/Next, etc.) using its established patterns, or — if starting fresh — to stand up React + the real Compass component library and implement there.

The prototypes are plain React-over-Babel (loaded from CDN) with logic split across `.jsx` files. Treat the `.jsx` as the **behavioral source of truth** (state, routing, interactions) and the Compass token CSS as the **visual source of truth**.

> **Path note:** the entry HTML files reference `_ds/compass-design-system-.../tokens/*` and `proto-compass/*`. In this bundle the tokens are under `compass-tokens/` and the code under `proto-compass/` (Compass) and `proto/` (wireframe). Adjust the `<link>`/`<script>` paths, or drop the folders back into a project that has the `_ds/` design-system bundle, to run them as-is.

## Fidelity
**High-fidelity.** Final layouts, real interactions (drag, swipe, form state), and — in the Compass version — final colors/type/spacing driven by design-system tokens. Recreate pixel-faithfully using the codebase's Compass components. The `proto/` wireframe version is the lo-fi concept kept for comparison/QC; build against the **Compass** version (`proto-compass/`).

---

## Architecture of the prototype code

Both prototypes share an identical structure (only the CSS skin differs). Files load in this order:

| File | Responsibility |
|---|---|
| `data.js` | All mock data + config: personas, 24-opportunity catalog, 12 stages, demo states, keyword banks, application questions, playbooks, assets, interview Qs. Exposes on `window`. |
| `shell.jsx` | Injects the shared CSS layer (`--proto-*` vars + `.px-*` utility classes), `DesktopShell` (top bar + left nav), `PhoneShell` (iOS bezel + tab bar), and shared primitives: `Pill`, `StageBadge`, `MatchScore`, `Bar`, `SectionTitle`, `L` (link). |
| `state.jsx` | `AppProvider` context (persona, demoState, density, dark, accent, features, view, pipeline `stageMap`, `packets`, `dismissed`, toasts), the `useRoute()` hash router, `go()`, and `ToastTray`. |
| `tweaks-panel.jsx` / `tweaks.jsx` | The in-app Tweaks panel (persona / demo state / visual / feature flags). |
| `home.jsx` | Today (with `InboxScrubHero`), Opportunities list, Pipeline kanban, Command Center + tabs. |
| `engine.jsx` | Outreach cadence queue, outreach draft, Asset analytics, Role library + detail, Playbooks. |
| `packet.jsx` | Application Packet builder (step-rail + JD/ATS + artifact steps + review rounds). |
| `compose.jsx` | Outreach Composer (multi-channel) + Application Answers autofill. |
| `flows.jsx` | Interview list / prep / record / debrief, Offer negotiation tracker. |
| `intake.jsx` | Inbox monitoring 3-pane, OAuth folder-setup stepper, Settings, Templates manager. |
| `mobile.jsx` | All mobile screens incl. the real swipe-gesture queue. |
| `app.jsx` | Top-level router that maps hash routes → desktop or mobile screen, mounts provider. |

**The Compass "skin" is applied in one place:** `proto-compass/shell.jsx` remaps every `--proto-*` variable to a Compass token and restyles the `.px-*` classes (Inter, hairline borders, rounded, teal brand). This is why the whole app re-skins at once. In a real build, replace the `.px-*` layer with actual Compass components (see inventory below).

---

## Screens / Views (12 modules)

Routes are hash-based (`#/`, `#/opp/1`, `#/packet/1/jd`, …). Full behavior lives in the `.jsx` noted.

### 1. Today — morning briefing · `home.jsx` → `TodayScreen`
- **Purpose:** the daily entry point; triage what the engine found overnight.
- **Layout:** `DesktopShell` (56px top bar; 196px left nav; scrolling body, max ~1280px). Vertical stack, 20px gap.
- **Components (top→bottom):** `PageHeader` (greeting + count summary + "Review opportunities" primary button); **`InboxScrubHero`** (see below); 6-col KPI strip; then a 1.5fr/1fr split — left = prioritized "Do these next" action cards (colored left bar by urgency, verb button); right = "This week" schedule, "Engagement signals" (with AI badge), "Funnel health" progress bars.
- **`InboxScrubHero`** — the most prominent element: a bordered brand-colored band, three regions — (a) teal-tinted left block with a large count of "new roles found overnight" + scan time; (b) middle "Discovered by role" grid, each role family a colored dot + name + "N new" pill (click → swipe); (c) right CTA column (Review in swipe / Inbox monitoring / Re-scan now). Data = opportunities surfaced "today" or still in discovered/saved/enriched.

### 2. Opportunities · `home.jsx` → `OppsListScreen`
- Filterable/sortable table (all / hot / strategic / active; sort match / name). Columns: logo, company, role, comp, `MatchScore` ring, `StageBadge`, urgency pill. Row → command center.

### 3. Pipeline (kanban) · `home.jsx` → `PipelineScreen`
- **12-column kanban**, horizontally scrolling. Column header = stage label + count chip. Cards are **draggable** (HTML5 drag) to advance stage; drop writes `moveStage` and fires a toast. Above the board: a live stage-funnel bar chart that recomputes on every move.

### 4. Command Center · `home.jsx` → `CommandCenterScreen`
- Per-opportunity tabbed workspace (overview, contacts, resume, outreach, templates, playbooks, interview prep, activity, analytics). Header has an interactive **stage-rail** (click a stage to jump). Overview leads with the **application-packet band** (progress + open) + Compose/Answers shortcuts, then stakeholder map, signals, pain hypotheses, tailored-asset grid, status panel, activity feed, comp band → offer tracker.

### 5. Application Packet builder · `packet.jsx` → `PacketBuilderScreen`
- **The core production line.** Left **step-rail**: JD analysis → resume → cover → portfolio → video → review, each with a status ring. Header shows a live **ATS match %** and packet status; "Send packet" gated until approved.
- **JD step is pre-populated from the triggering email** (source, role, comp, loc, HM) with keywords auto-matched against the master baseline — ATS opens high (~84%), only gaps flagged red. "Add more context" accepts pasted/screenshot research.
- **Artifact steps** each have a **template picker with an explicit default** (`· default`), an editable draft, a keyword-coverage meter (resume), version history, and reviewer feedback.
- **Review step:** checklist of the 4 artifacts; "Request changes" increments the round + appends to the feedback thread; "Approve packet" (enabled only when all 4 approved) → send moves opp to `applied`.

### 6. Outreach Composer · `compose.jsx` → `OutreachComposerScreen`
- Channel tabs: cold email · LinkedIn connect · LinkedIn DM · InMail · cold-call script · follow-up. Recipient chips (from stakeholder map), **tone toggle** (Direct/Warm/POV-led), **message-template picker with default** (Standard/Value-add POV/Referral intro/Re-engage), live **char-count vs channel limit** (turns red over limit), reply-rate benchmarks, "weave signal into draft", copy, send/queue.

### 7. Application Answers autofill · `compose.jsx` → `AppAnswersScreen`
- Drop a screenshot/file of a form → detects 9 questions → editable, copy-paste-ready block per field. **Answer-style picker with default** (Concise/Detailed/STAR method) reshapes long answers. Per-field copy + copy-all.

### 8. Outreach cadence · `engine.jsx` → `OutreachScreen`
- Scheduled-touch queue (day offsets, states due/sent/draft/scheduled), per-opp cadence timelines, templates-in-rotation w/ reply rates, cadence-health metrics.

### 9. Interviews · `flows.jsx` → prep / record / debrief
- **Prep:** likely questions w/ strength tags + expandable suggested answers, interviewer profiles, coverage map, materials.
- **Record:** dark recording surface, live timer (`setInterval`), **live AI cues that advance on a schedule**, live notes textarea, transcript; "Stop & debrief" routes to debrief.
- **Debrief:** AI summary + advance-likelihood, per-question scoring, owed follow-ups (draft-from-playbook), Q-bank additions; "Advance to Final" writes stage.

### 10. Offer / negotiation · `flows.jsx` → `OfferScreen`
- Three columns: their offer · your **editable** counter (live total-comp math) · walk-away floor. Generated counter draft, comp benchmarks, leverage, timing. Accept/counter/decline.

### 11. Intake / Settings / Templates · `intake.jsx`
- **Inbox monitoring** 3-pane: monitored role families (w/ counts) → alerts → parsed email preview + triage (push to swipe / snooze / dismiss).
- **OAuth folder-setup stepper:** connect email → create roles → map role→folder → done.
- **Settings** hub + **Templates manager** (category rail + template cards, primary/variant tags).

### 12. Mobile · `mobile.jsx`
- Reached via the **📱 Mobile** top-bar button. iOS-style `PhoneShell` + bottom tab bar. Today briefing, **swipe queue with real drag gesture**, pipeline, outreach, prep, packet list, composer/answers pickers, opportunity detail. Dark toggle in header.

---

## Interactions & Behavior (the "hard" surfaces)

### Swipe gesture — `mobile.jsx` → `MSwipeScreen` / `SwipeCard`
- Pointer events (`onPointerDown/Move/Up`, `setPointerCapture`). Track `dx/dy` from start.
- Live decision from drag: `dx > 60` → keep, `dx < -60` → pass, `dy > 60` → maybe. Card `transform: translate(dx,dy) rotate(dx/14deg)`; a corner overlay (KEEP/PASS/MAYBE) fades in per decision.
- On release: commit if past ~100px, else spring back (`transition: transform 220ms ease-out`). Commit calls `moveStage` (keep→saved, maybe→enriched) or `dismiss` (pass), then advances the index. A background (next) card sits scaled at 0.96.
- Also driven by tap buttons (Dismiss/Maybe/Keep) and a "Keep & build packet now" link.

### Drag-to-advance kanban — `home.jsx` → `PipelineScreen`
- HTML5 draggable cards; `onDragStart` stashes id, column `onDragOver` sets highlight, `onDrop` calls `moveStage(id, stageId)` + toast. Dragged card dims to 0.4 opacity. Funnel chart + counts recompute from the derived `byStage` map.

### Approval rounds — `packet.jsx`
- Each artifact status machine: `todo → drafting → review → changes → approved`. Packet: `none → building → review → changes → approved → sent`, with a `round` counter. "Request changes" bumps the round and prepends `{round, from, note, kind}` to `feedback[]`. Send is gated on all-4-approved and transitions the opportunity stage to `applied`.

### Record / live cues — `flows.jsx` → `InterviewRecordScreen`
- `setInterval` timer while recording; the active cue = `Math.floor(elapsed/30)` clamped to the cue list; cue highlights via warning tint. "Stop & debrief" clears the timer and routes to the debrief with a short delay.

### Motion
- Page-body cross-fade on route change (`.px-fade`, 180ms). Toasts slide-in (200ms) and auto-dismiss (~2.2s). Compass motion tokens: fast 100ms / normal 200ms, `easeInOut cubic-bezier(0.4,0,0.2,1)`; spring reserved for toggles.

---

## State Management (`state.jsx`)
- **Context (`AppProvider` / `useApp`)** holds: `persona`, `demoState`, `density`, `dark`, `accent`, `features{ai,swipe,recording,debrief,cadence}`, `view` (desktop|mobile), `stageMap` (oppId→stage), `packets` (oppId→packet), `dismissed`, and toast list.
- **Derived `opps`**: `ALL_OPPS` filtered by `persona.rolesFor`, joined with current stage + packet status, minus dismissed.
- **Helpers:** `moveStage(oppId, stage)`, `getPacket(oppId)`, `updatePacket(oppId, patch|fn)`, `dismiss(oppId)`, `toast(msg)`.
- **Routing:** hash-based; `useRoute()` parses `#/parts/...`; `go(path)` sets `location.hash`. Persisted implicitly by the URL; demo-state change re-seeds `stageMap`.
- **Data fetching (real build):** replace `data.js` with API calls to the endpoints in spec §8/§10 (opportunities, packets, artifacts, outreach, interviews, offers).

---

## Design Tokens (Compass)
Use the token CSS in **`compass-tokens/`** (`fig-tokens.css`, `typography.css`, `fonts.css`) — do not hardcode. Key tokens the prototype consumes:

- **Brand (teal):** `--surface-brand-default` = `rgb(27,79,92)` (brand-700); hover `--surface-brand-hover` (darker); subtle `--surface-brand-subtle`. Used for primary actions, active nav, links, focus.
- **Neutrals/surfaces:** `--surface-background-primary` (white) / `-secondary` (neutral-50) / `-tertiary`; text `--text-primary` (neutral-900 `rgb(15,23,42)`) / `-secondary` / `-tertiary` / `-brand` / `-link`.
- **Borders:** `--border-default` (neutral-200), `--border-strong` (neutral-300), `--border-input`. Rendered as inset box-shadow in Compass components.
- **Semantic:** success/warning/error/info each with `-default` + `-subtle`. **AI = violet** (`--surface-ai-default`, purple-600) — reserved for `CompassAIBadge` only.
- **Type:** Inter; fine scale (base 13–14px, 10px→48px); weights 400/500/600/700; line-heights stored as %.
- **Spacing:** 2px-based, token number ≠ px (`--spacing-1`=2, `-2`=4, `-3`=6, `-4`=8, `-6`=12, `-8`=16, `-12`=24); unitless — consume as `calc(var(--x)*1px)`.
- **Radii:** sm 4 · md 8 (controls) · lg 12 (cards) · xl 16 (modals) · full 9999 (pills/avatars).
- **Dark mode:** Compass ships `:root[data-theme="dark"]`/`.dark`. **Caveat:** the design-system preview bundle strips `data-theme`, so the prototype drives dark via a dedicated `.proto-dark` class that overrides the same tokens. In a clean app, use Compass's `data-theme="dark"` directly.

---

## Component inventory → map to Compass components
The prototype's `.px-*` primitives should become real Compass components (`window.CompassDesignSystem_03277a`):

| Prototype primitive | Compass component |
|---|---|
| Left nav (`DesktopShell`) | `SidebarNavLabeled` |
| Title block | `PageHeader` |
| KPI tile | `KPICard` (value + signed delta + trend) |
| `.px-box` container | `Card` (`interactive`/`elevated`/`selected`/`brand`) |
| `Pill` / `StageBadge` | `Badge` / `Tag` |
| `.px-btn*` | `Button` / `IconButton` (variants primary/secondary/ghost) |
| `Bar` | `ProgressBar`; `MatchScore` ring → `ProgressRing` |
| List rows | `ListItem` (+ `Divider`) |
| Avatar/logo | `Avatar` / `AvatarGroup` |
| Command-center tabs | `TabBar` (underline) |
| Packet step-rail | `Stepper` |
| Template/tone/answer pickers | `SegmentedControl` / `FilterChipGroup` |
| AI markers | `CompassAIBadge` (violet) |
| Mobile tab bar | `BottomNavigation`; mobile top → `TopAppBar` |
| Toasts | `Toast` / `Snackbar` |
| Empty states | `EmptyState` |
| Composer/record modals | `ModalDialog` / `DrawerSheet` / `RightPanel` |
| Icons | `Icon` (Lucide set) |

---

## Variant matrix
Every screen must hold across:
- **Theme:** light / dark.
- **Persona (3):** CTO (Jordan Davis, $420–520k), VP Engineering (Riley Park, $370–450k), VP Product (Sam Cohen, $340–410k). Persona re-filters the opportunity catalog, master baseline, keyword bank, and comp targets. (`PERSONAS` + `KEYWORDS` in `data.js`.)
- **Demo state (3):** Just started (day 3) / Mid-pipeline (day 24) / Closing offer (day 42) — re-stages the pipeline and metrics. (`DEMO_STATES` in `data.js`.)
- **Density:** comfortable / compact.
- **Feature flags:** ai, swipe, recording, debrief, cadence — each independently toggleable and should gracefully hide the corresponding UI.

That's a 2 × 3 × 3 core matrix (18 states) before density/flags — the Tweaks panel exercises all of them live.

---

## Assets
No photography/illustration — image slots are neutral placeholders (`.px-photo`). Icons: Compass uses **Lucide** via its `Icon` component (no icon font/emoji). Logos in the catalog are single-letter placeholder tiles; swap for real company logos.

## Files in this bundle
- `Executive Engine Prototype (Compass).html` + `proto-compass/` — **build target** (hi-fi, Compass-skinned).
- `Executive Engine Prototype.html` + `proto/` — wireframe original (concept/QC reference).
- `Executive Engine Spec.html` — full product spec (purpose, intent, end goal, data model §8, architecture §9, AI contract §10).
- `Executive Engine Architecture.html` — system architecture diagram (ingestion → AI → Docs/Slides generation → outputs; recommended services).
- `compass-tokens/` — Compass design tokens (`fig-tokens.css`, `typography.css`, `fonts.css`). Full component library lives in the bound Compass design-system project.

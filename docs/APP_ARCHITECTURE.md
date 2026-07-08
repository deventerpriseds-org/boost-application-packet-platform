# Executive Engine — Functional Prototype Architecture

Blueprint for building the fully functional prototype so the **logic is built
once** and the **Compass skin drops in late and cheap** (per spec: "same router,
data, and interactivity, different skin"). The backend is already de-risked by
the MT-01→MT-43 test suite; this describes how to promote those proven pieces
into the real app.

## Layering (the key to "no rebuild for hi-fi")

```
┌─────────────────────────────────────────────────────────┐
│  Skin           Compass design tokens (CSS variables)    │  ← swap late
├─────────────────────────────────────────────────────────┤
│  Components     Presentational, token-styled primitives  │  ← build once
│                 (StatTile, StageRail, KanbanCard,        │
│                  SwipeCard, CommandCenterTabs, StepRail,  │
│                  TemplatePicker, CoverageMeter, …)        │
├─────────────────────────────────────────────────────────┤
│  Data hooks     useOpportunities, usePacket, useCadence, │  ← build once
│                 useOutreach, useInterview, useOffer …     │
│                 (fetch + optimistic state, skin-agnostic) │
├─────────────────────────────────────────────────────────┤
│  Service API    Azure Functions (promoted from MT tests) │  ← mostly done
├─────────────────────────────────────────────────────────┤
│  Data           boost_resume_n_packet_builder (Postgres) │  ← schema live
│                 + Blob (assets) + Graph/Google/OpenAI     │
└─────────────────────────────────────────────────────────┘
```

Rule: **components read design tokens, never hardcoded colors/spacing.** The
existing dev-console hardcodes inline styles — the product app must not. A theme
provider exposes `--surface-*`, `--text-*`, `--surface-brand-*`, violet
`CompassAIBadge`; swapping the token file re-skins everything.

## Modules / routes (spec §7)

| Route | Module | Primary data |
|---|---|---|
| `/today` | Morning briefing: inbox-scrub hero, KPI strip, do-next, week, signals | opportunity, asset_event, outreach |
| `/intake` | Inbox monitoring (3-pane: role families → alerts → preview) + folder-setup stepper | Graph folders, opportunity |
| `/opportunities` | Filterable/sortable table | opportunity |
| `/pipeline` | 12-column kanban, drag-to-advance, funnel viz | opportunity.stage |
| `/opportunity/:id` | Command Center (tabs: overview, contacts, resume, outreach, templates, playbooks, interview prep, activity, analytics) | all per-opp |
| `/opportunity/:id/packet` | Packet builder step-rail (JD → resume → cover → portfolio → video → review) | packet, artifact |
| `/opportunity/:id/compose` | Outreach composer (multi-channel, tone, template picker) | outreach_message, contact |
| `/opportunity/:id/answers` | Application answers autofill (vision) | — |
| `/outreach` | Cadence engine queue | outreach_message |
| `/interviews` | Prep / record / debrief | interview |
| `/offer/:id` | Negotiation tracker | offer |
| `/roles` `/playbooks` `/assets` `/settings` | Libraries + templates manager | library_entity, asset_event |
| Mobile shell | Today, swipe queue (drag gesture), pipeline, composer/answers pickers | — |

## Data hooks → service functions (promotion map)

Each proven MT test becomes a real service function; hooks call them.

| Hook | Service (from) | Notes |
|---|---|---|
| `useIntake` / watcher | MT-31 parse-alert, MT-33 Graph read | write `opportunity` rows at `discovered` |
| `useDedup` | MT-29/MT-32 embeddings + pgvector | on ingest, embed + skip dupes |
| `useOpportunities` / `usePipeline` | new CRUD over `opportunity` | stage transitions (MT-34 logic) |
| `usePacket` / `useArtifacts` | MT-14/18/19 generation, MT-17 assembler | artifact status state machine |
| `useJdAnalysis` | MT-35 vision | keywords/gaps/ATS score on the JD step |
| `useAnswers` | MT-36 vision | form screenshot → answers |
| `useOutreach` / `useCadence` | MT-37 draft, MT-38 cadence | schedule + send via Graph (MT-07/21) |
| `useInterview` | MT-40 prep, MT-41 debrief | |
| `useOffer` | MT-42 negotiation | live total-comp math client-side |
| `useAnalytics` | MT-39 asset_event | opens/view-time |
| cost metering | MT-43 | wrap every OpenAI call, log `usage_metering` |

## Runtime (prototype vs production)

- **Prototype**: run the watcher/cadence/refresh as **scheduled HTTP jobs**
  (Azure Functions **timer triggers** hitting the already-proven endpoints).
  No durable queue/edge stack needed — same visible behavior, far less infra.
- **Production**: swap timers for the durable queue + edge functions when scale
  demands it. The service functions don't change.

## Cross-cutting

- **Personas** (CTO / VP Eng / VP Product): `persona_key` filters catalog,
  baselines, keyword banks, comp — one selector re-filters everything.
- **Feature flags**: AI features, swipe, recording, debriefs, cadence — each
  toggleable (spec §13), gate at the hook layer.
- **Auth/token vault**: reuse the OAuth flows already built (Google refresh
  token, Graph client-credentials); centralize in a settings/connections module.
- **Light/dark**: token-driven; the theme provider stamps a root class.

## Build order (logic-first, skin-last)

1. **Service layer**: promote MT endpoints into namespaced services + add
   `opportunity`/`packet`/`outreach`/`interview`/`offer` CRUD over the new schema.
2. **App shell + routing** with a neutral token theme; data hooks per module.
3. **Modules** in daily-loop order: Intake → Today → Pipeline/Opportunities →
   Command Center → Packet builder → Composer/Cadence → Interviews → Offer.
4. **Timer triggers** for watcher/cadence.
5. **Drop in Compass tokens** (+ optional literal Compass React components on
   flagship screens) — a skin pass, not a rebuild.

## Status

- ✅ App database `boost_resume_n_packet_builder` provisioned; schema applied
  (11 tables, HNSW vector index, pg_trgm fuzzy indexes) — see `schema.ts`.
- ✅ Every backend subsystem proven (MT-01→MT-43).
- ⏭ Needs Compass design exports (prototype HTML + token file + component
  inventory) before the component/skin layer; the service + data + hook layers
  can start now against this schema.

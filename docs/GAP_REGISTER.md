# Gap Register — Executive Engine

Living record of spec capabilities that are **not yet covered** by the test
harness (MT-01…MT-43) and/or **not wired end-to-end** in the production app
(`executive-engine`, deployed at `purple-ground-0f377120f.7.azurestaticapps.net`).

This file exists because a real gap slipped through: **HeyGen** was a declared
integration (credential + config panel) with **zero tests**, and **ElevenLabs**
was missing entirely. See "How this was missed" below.

_Last updated: 2026-07-09._

## How the gap happened (process root cause)

Test selection (MT-28–43) was inventoried from **the data model + subsystems
that had server code and a Postgres table**. It was **never diffed against the
declared integration/credential surface** (`health.ts` `has(process.env.*)`
checks + the console's Platform config panels). So an integration that was
*configured but not yet coded* (HeyGen) was invisible to the method, and
"all 43 tests pass" was allowed to stand in for "the spec is covered."

**Fix to the process:** before claiming coverage, diff declared credentials →
tests → live wiring. Say "the enumerated tests pass," never "everything passes,"
until that diff is done.

### Credential ↔ test coverage diff (the check that was skipped)

| Declared credential (`health.ts`) | Config panel | MT test | Wired in app |
|---|---|---|---|
| `OPENAI_API_KEY` | ✓ | ✓ (many) | ✓ |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / OAuth | ✓ | ✓ MT-03–06 | ⚠ text only (no real Docs/Slides files) |
| `MICROSOFT_CLIENT_ID` (Graph) | ✓ | ✓ MT-07/08/33 | ⚠ send is a state flip, not a real send |
| `AZURE_STORAGE_CONNECTION_STRING` | ✓ | ✓ MT-01/30 | ✓ |
| **`HEYGEN_API_KEY`** | **✓ (Avatar Template + Video Archive Folder)** | **✗ none** | **✗** |
| **`ELEVENLABS_API_KEY`** | **✗ (absent)** | **✗ none** | **✗** |

## Gap register

### G1 — HeyGen: intro-video generation  ·  status: OPEN (blocked on key)
- **Intent:** HeyGen renders the **intro video** artifact — an avatar video, not
  text. Today the packet builder generates the intro-video **script (text)** and
  stops there.
- **Declared but unused:** `HEYGEN_API_KEY`, console "HeyGen" panel (Avatar
  Template ID), Google "Video Archive Folder ID" for storage.
- **To close:**
  1. `MT-44` — real HeyGen render test (script → video job → poll → asset URL).
  2. Wire a **"Generate video"** action on the intro-video artifact in the
     packet builder; store the resulting URL on the artifact (`doc_url`),
     archive to the Video Archive Folder.
- **Blocked on:** `HEYGEN_API_KEY` in GitHub secrets + Function App settings.

### G2 — ElevenLabs: voice narration + 1:1 voice call  ·  status: CLOSED (MT-45 + barge-in voice coach live; 1:1 chat call button deferred to when app is feature-complete, per owner)
- **Intent (clarified with owner):** ElevenLabs turns **AI response text into
  voice**. Two surfaces:
  1. **Meeting / narration voice** — narrate generated text (e.g. the intro-video
     voiceover over the HeyGen avatar; spoken responses).
  2. **"Call" button in the 1:1 chat channels** — user hits call and the AI
     replies in **narrated voice** (conversational). This likely needs
     ElevenLabs **Conversational AI / realtime TTS** (websocket), not just
     one-shot TTS.
- **Declared but unused:** nothing yet — no credential, no panel.
- **To close:**
  1. `MT-45` — real ElevenLabs TTS test (text → audio bytes, verify a valid
     audio payload returns).
  2. Narration: a **"Narrate"** control that plays ElevenLabs audio for a
     generated block (intro-video voiceover first).
  3. **Call button** in 1:1 chat: realtime voice loop (STT → LLM → ElevenLabs
     TTS). Larger; scope as its own slice.
- **Blocked on:** `ELEVENLABS_API_KEY` in GitHub secrets + Function App settings.

### Production push (owner-directed, 6 items) · status: DONE (see below)
- **#3 Server-verified identity** — HMAC session tokens (`appSession.ts`): MS Graph
  `/me` + Google userinfo mint a signed token; `resolveOwner(req)` derives the
  trusted owner from the Bearer token across every owner-scoped endpoint; safe
  demo fallback. Verified: bad tokens rejected, bogus Bearer → demo, no regression.
- **#4 Reliability & ops** — `/app/health` (DB ping + integration status),
  `/app/selftest` (6/6), Settings ▸ System, coach diagnostics tools.
- **#5 Surface JD/enrich + engagement** — JD/ATS panel + Build-entire-packet in the
  packet builder; Enrich in OppDetail. Verified: ATS 85 + 13 keywords; 4 signals + 4 pains.
- **#1 ATS ingestion (G3 Phase A)** — see G3 below (Greenhouse/Lever/Ashby live).
- **#2 Chrome extension (G11)** — see G11 below (live capture endpoint).
- **#6 Polish** — folded in (System settings, ATS/coach surfaces).

### G3 — ATS ingestion + apply  ·  status: Phase A CLOSED (Greenhouse/Lever/Ashby live)
- `appAts.ts`: configurable `ats_source` (provider + board) with adapters for
  **Greenhouse / Lever / Ashby** public job boards; preview + ingest; exec-role
  filter; reuses the intake `insertOpp` (embed → pgvector dedupe → discovered).
  Verified live: Stripe Greenhouse → 14 new exec opps inserted, re-ingest 0 new /
  15 dupes. Settings ▸ Intake ▸ ATS boards + coach tools.
- **Phase B — structured apply (`appApply.ts`)**: `apply/prepare` drafts answers to
  the **real Greenhouse application questions** when the opp is a Greenhouse posting
  (parsed from the stored URL), else the universal exec set (work auth, sponsorship,
  salary, start, relocation, why-company, leadership) + attaches the tailored
  resume/cover/portfolio/video links. Returns a copy-paste **handoff**; real
  auto-submit needs per-company Greenhouse API keys (not held) → wired to fire only
  when a key is present. Verified: 6 answers + 5 doc links returned.
- **Phase C — ATS match score**: `match-score` returns a Jobscan-style match rate +
  matched strengths + keyword gaps, grounded in the master context, stored on
  `opportunity.match_score`. Verified: Cloudflare CTO → 85, 8 matched, 3 gaps.
- Coach tools `match_score` / `apply_prepare`; OppDetail shows match badge + prepared
  application. **Remaining:** true per-company auto-submit + a paid aggregator for breadth.

Two halves + a coverage reality (researched 2026):
- **Coverage:** LinkedIn/Indeed/Monster/Ladders are *boards*, not ATS; none have
  open job-search APIs anymore (LinkedIn partner-gated; Indeed API shut 2021;
  Glassdoor 2023). Greenhouse/Lever/Ashby *do* have clean public job-board APIs
  but only cover companies on those ATS. No single/free source = full coverage.
  **The email watcher (G4) is the universal, ToS-clean discovery layer**; ATS
  APIs are additive (structured + API-apply on that subset); a paid aggregator
  (TheirStack/Coresignal/Apify) is optional for breadth; the extension (G11) is
  the eventual universal layer.
- **Phase A — ATS ingestion (sources):** Greenhouse + Lever (+ Ashby) boards as
  configurable sources behind a swappable adapter (mirror the mail-watch config
  pattern) → parse → embed → dedupe into the pipeline. Closes the ◐ "job feed".
- **Phase B — Structured apply (targets):** Greenhouse `Submit an application`
  API — map the generated app-answers (MT-36 vision) → the job's `questions`
  array + tailored resume → POST. Pre-filled handoff for non-API ATS. Closes the
  red "autofill/auto-apply" on the API-covered subset.
- **Phase C — ATS match score:** promote MT-35 JD analysis to a first-class
  keyword match-rate + gap list per opportunity (Jobscan-style). Closes ◐ "ATS
  optimization".

### G12 — AI Coach → operator agent  ·  status: CLOSED (backend live; UI shipped)
- The coach was call-only (ElevenLabs voice). Upgraded to a full **OpenAI
  Responses operator agent** (`gpt-4o`) that can *do* the work, not just advise:
  - **App tools** (`coachTools.ts`) — function tools mapping to every app
    operation (list/get/advance/dismiss opportunities, get/list packets, generate
    artifacts + real Docs/Slides, list/draft/send outreach, interview prep, offer
    analysis, usage, config/mail diagnostics). The executor calls the API's own
    endpoints, owner-scoped.
  - **Live web search** — `tavily_web_search` (TAVILY_API_KEY). Verified: returned
    post-training-cutoff facts with source URLs.
  - **Durable memory** — pgvector `coach_memory`/`coach_triples` on the boost PG
    (`text-embedding-3-small`, 1536-dim), `remember`/`recall` tools + auto-grounding.
    Verified: a fact saved in one chat was recalled in a **fresh** conversation.
  - **File store** — OpenAI vector store (`vs_…`) attached via `file_search`;
    `POST /app/coach/provision` + `/upload`.
- **Endpoints:** `POST /app/coach/chat` (tool-call loop, max 8 hops), `/provision`,
  `/upload`, `/memory/bootstrap`, `/memory/list`, `GET /app/coach/status`.
- **UI:** Coach screen is tabbed **💬 Chat | 📋 Activity | ☎️ Voice call**; chat
  shows the tools the agent ran per reply; Activity shows saved memory + live
  status. **Settings ▸ Coach** exposes and lets you EDIT the exact system prompt
  + model, and shows memory DB / web search / file-store status (huddle-style).
- **Architect-aware:** the system prompt makes the coach answer meta/system
  questions concretely (it knows memory is pgvector in the user's OWN Postgres →
  vendor-portable across AI models; the OpenAI vector store is only for uploaded
  files) and proactively offer to build/change things. It captures feedback,
  preferences, and decisions to memory for continuous improvement.

### G11 — Chrome extension  ·  status: SHIPPED (MVP capture)
- `extension/` (MV3): **Save this job** scrapes the tab (JSON-LD `JobPosting` or
  title/company/body) → `POST /app/capture` (`appCapture.ts`) → normalizes via
  OpenAI → `insertOpp` (embed → dedupe → discovered, source Extension). Options
  for workspace email / session token. Basic why/cover autofill in `content.js`.
  Load unpacked from `extension/`. (Structured auto-apply across arbitrary ATS
  forms is the deeper follow-on.)

### G11 (original) — Chrome extension  ·  status: SHIPPED — see above (owner wants it — LAST, after platform is complete; DO NOT FORGET)
- The universal layer the boards' closed APIs otherwise block: **save any job
  page → opportunity** (universal discovery/capture) and **autofill/apply on any
  ATS web form** using the already-generated answers (universal apply). Matches
  the extension-first UX of Teal/Simplify/Huntr/Jobright.
- **Explicitly deferred by owner** until everything else is done and the hosted
  platform is working — parked here so it is not lost.

### G4 — Live inbox watcher  ·  status: CLOSED
- Graph change-notification subscription (`mail/*`) turns real LinkedIn alerts in
  the watched mailbox into opportunities (parse → embed → dedupe → insert), with
  a 30-min renewal + fallback-poll timer. Configurable mailbox/folder/sources in
  **Settings ▸ Intake** (`mail_watch_config`) + self-test. Verified on a real
  LinkedIn alert (HDR, AARC ingested).

### G5 — Real outbound send  ·  status: CLOSED
- `POST /app/outreach/{id}/send` sends email channels (coldEmail/followUp) via
  Graph `sendMail` from `OUTREACH_SENDER` (von.ellis), parsing the `Subject:`
  line and storing `to_email`/`subject`. LinkedIn/call channels return a
  copy-paste result (no API). Verified: real email delivered von.ellis→von.ellis.

### G6 — Real Google Docs/Slides artifacts  ·  status: REDONE as TEMPLATE FILL
- **Corrected approach (owner):** the packet artifacts must be produced by
  **copying the designed Google template and filling `{{placeholders}}`**, NOT by
  creating a blank doc / from-scratch deck. This is the MT-22 `pipeline.ts` path
  that produced the correctly-formatted portfolio files.
- **Reuse, not reinvent:** the 3-agent generation was extracted into
  `pipeline.buildPackageForJD` → `assemblePackage`, shared by the test flow and
  the production packet builder, so both use the identical proven engine. The
  assembled package carries the exact placeholder keys.
- `packetTemplates.ts`: copy template (Drive `files/{id}/copy`) → `replaceAllText`
  each `{{placeholder}}` → **review-agent cleanup pass** strips any leftover
  `{{...}}` tokens so dynamic text never leaves eyesores → anyone-reader.
  resume/compact → Doc template; portfolio/cover → Slides templates. The package
  is cached on `packet.pkg_json` so all artifacts share one generation.

### G6 (original) — Real Google Docs/Slides artifacts  ·  status: SUPERSEDED (was Docs + Slides)
- `POST /app/artifact/{id}/document` creates a real, shareable Google Doc from
  the generated text (Drive create → Docs insert → anyone-reader), stored on
  `doc_url`, filed in an "Executive Engine Packets" folder.
- `POST /app/artifact/{id}/slides` creates a real Google **Slides** deck for the
  portfolio artifact (title + section slides via Slides batchUpdate; object IDs
  must be ≥5 chars). Verified live (5-slide deck). Packet builder offers
  "Create Slides deck" for portfolio, "Create Google Doc" for other text assets.

### Asset analytics  ·  status: CLOSED
- Tracked share links: `GET /app/asset/{id}/open?v=<viewer>` logs an open to
  `asset_event` then 302→ the doc/deck/video. `POST /app/asset/event` for other
  events; `GET /app/assets/analytics` aggregates opens / unique viewers / view
  time / last open per asset (owner-scoped). Packet builder "Copy tracked link";
  **Library ▸ Assets → Engagement** panel. Verified: 2 tracked opens → 2 viewers.

### Demo-data flag  ·  status: CLOSED
- `Settings ▸ Workspace → Show sample / demo data` toggle (persisted). Off sends
  `includeDemo=false`; opportunities/packets/outreach filter `is_demo` rows
  (hidden, not deleted). Verified: 27 → 3 with sample off.

### G7 — Scheduler / cron  ·  status: CLOSED
- Timer `outreachTick` (hourly) promotes `scheduled → due` when `scheduled_for`
  passes (promote-to-due, not auto-send — a human still reviews). Manual trigger
  `POST /app/outreach/tick` for verification / process-now. Verified live.

### G8 — Auth / multi-tenancy  ·  status: BOTH providers enabled + wired (live click-through untested)
- **Follows the `enterpriseds-azure-deploy` house pattern** (reuse shared infra,
  own Entra app per app, shared Google broker). Client-side Microsoft **MSAL**
  (`@azure/msal-browser@^3.30`, browser + PKCE, no secret) + **Google** auth-code
  flow through the shared **`enterpriseds-auth-broker`**. Zero portal/console steps.
- **Provisioned & verified:** `azure-entra-app.yml` ran (success) → created the
  **`executive-engine-web`** Entra app + set its SPA redirect URI (confirms the SP
  holds Graph `Application.ReadWrite.All`). Redeploy baked `VITE_MS_CLIENT_ID` in.
  Deployed bundle (1007 KB) has **MSAL configured** (MS button enabled) AND
  **Google** (client ID + broker redirect). `POST /auth/google/token` verified to
  reach Google's token server.
- **Not yet exercised:** an actual human click-through sign-in for either provider
  (needs a real consent screen — can't be simulated headlessly). Wiring, client
  IDs, endpoint, and Entra redirect are all confirmed.
- Signed-in email → data `owner`; opportunity/packet/outreach reads scoped to it;
  shared demo mode when signed out. **Settings ▸ Account**.
- (Superseded attempts, for the record: SWA-EasyAuth; reusing the mail app's
  Entra app; msal v5 dead-code elim. All corrected.)
- **Deeper hardening (later):** server-side token verification so `owner` isn't
  client-asserted. Fine as-is for single-owner use.
- **Hardening TODO (needs az):** the app calls the Function App cross-origin, so
  the verified `x-ms-client-principal` header is NOT injected on API calls. Link
  the Function App as the SWA's backend (bring-your-own-functions / linked API)
  so the API can trust identity server-side instead of a client-asserted owner.
  Until then, owner scoping is client-asserted — fine for single-owner use, not
  for defending multi-tenant data between distrusting users.

### G9 — Whisper transcription  ·  status: CLOSED
- `POST /app/interview/{id}/transcribe` (whisper-1) turns recorded/uploaded audio
  into a transcript stored on the interview row; debrief tab has record + upload
  controls. Verified via a TTS→STT round-trip (phrase returned verbatim).

### G10 — Cost metering in the app  ·  status: CLOSED
- `usageMeter.logUsage` (per-model pricing, best-effort) records every metered
  AI call to `usage_metering`, tagged by feature. Instrumented: packet drafts,
  outreach drafts, intake parse + embeddings. `GET /app/usage` aggregates
  totals / by-feature / by-model / by-day / recent; surfaced in **Settings ▸
  Usage**. Verified: outreach drafts logged with real token cost.

## Priority (owner-directed)
- **Closed:** G1 HeyGen, G2 ElevenLabs, G4 live inbox watcher, G6 real Docs,
  G5 real outbound send, G7 scheduler/cron, G10 cost metering, G9 Whisper.
- **Foundation shipped:** G8 auth (login + per-user scoping live; server-side
  identity verification via SWA linked-backend is the remaining hardening step).
- **Deferred (owner):** G3 ATS ingestion + apply; G2 1:1 chat call button;
  G6 Slides deck for the portfolio artifact.
- **Deferred (owner):** G3 ATS ingestion + apply; G2's 1:1 chat call button;
  G6 Slides deck for the portfolio artifact.

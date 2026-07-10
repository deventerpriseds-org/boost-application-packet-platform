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

### G3 — ATS ingestion + apply (Greenhouse / Lever / Indeed / Wellfound)  ·  status: DEFERRED (owner: not forgotten)
- Spec names these as job sources and application targets. Opportunities are
  currently **seeded**, and "apply" submits nowhere.
- **Explicitly deferred by owner** — parked here so it is not lost.

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

### G6 — Real Google Docs/Slides artifacts  ·  status: CLOSED (Docs)
- `POST /app/artifact/{id}/document` creates a real, shareable Google Doc from
  the generated text (Drive create → Docs insert → anyone-reader), stored on
  `doc_url`, filed in an "Executive Engine Packets" folder. Verified live.
  (Slides deck for the portfolio artifact is a possible follow-up; text
  artifacts are Docs.)

### G7 — Scheduler / cron  ·  status: CLOSED
- Timer `outreachTick` (hourly) promotes `scheduled → due` when `scheduled_for`
  passes (promote-to-due, not auto-send — a human still reviews). Manual trigger
  `POST /app/outreach/tick` for verification / process-now. Verified live.

### G8 — Auth / multi-tenancy  ·  status: FOUNDATION SHIPPED (infra prereqs pending)
- **House pattern (per `enterpriseds-azure-deploy` skill):** client-side
  Microsoft **MSAL** (browser + PKCE, no client secret, no server token exchange)
  + **Google** sign-in. Client IDs injected at build: `VITE_MS_CLIENT_ID`
  (resolved from a dedicated Entra app by name) and
  `VITE_GOOGLE_CLIENT_ID ← GOOGLE_CLIENT_ID`. (Replaced an earlier, off-pattern
  SWA-EasyAuth attempt.)
- Shipped: `src/auth.js` (MSAL + GIS), signed-in email → data `owner`,
  opportunity/packet/outreach reads scoped to it (shared demo mode when signed
  out). **Settings ▸ Account** → Connect Microsoft / Google; buttons auto-disable
  when their client ID isn't in the build. Deploy workflow injects the IDs;
  `azure-entra-app.yml` provisions the SPA Entra app.
- **Infra prereqs (must run outside CCR — graph.microsoft.com is blocked here):**
  1. One-time: grant the deploy SP `Application.ReadWrite.All` (admin consent).
  2. Run **azure-entra-app.yml** to create `executive-engine-signin` (SPA redirect
     = the SWA URL); re-run the deploy so `VITE_MS_CLIENT_ID` bakes in.
  3. Google: add the SWA origin as an authorized JS origin on the
     `GOOGLE_CLIENT_ID` OAuth client (Google Cloud console).
  Until then the app runs in shared demo mode with sign-in buttons disabled.
- **Server-side verification** (owner not client-asserted) remains the deeper
  hardening — the API would validate the MSAL/Google token or use a linked
  backend; today owner scoping is client-asserted (fine for single-owner use).
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

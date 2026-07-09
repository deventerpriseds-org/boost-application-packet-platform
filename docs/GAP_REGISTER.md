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

### G2 — ElevenLabs: voice narration + 1:1 voice call  ·  status: OPEN (blocked on key)
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

### G4 — Live inbox watcher  ·  status: OPEN
- MT-33 only **reads** a Graph folder. No live webhook/watcher turns real emails
  into opportunities; in the app, opportunities are seed data.

### G5 — Real outbound send  ·  status: OPEN
- MT-07/08 proved Graph send in isolation. The app's outreach **"Send"** flips
  message state; it does not actually send via Graph/Gmail. LinkedIn has no send
  API (copy-paste by design).

### G6 — Real Google Docs/Slides artifacts  ·  status: OPEN
- MT-04–06 proved Docs/Slides generation. The packet builder stores generated
  **text**, not actual Docs/Slides files.

### G7 — Scheduler / cron  ·  status: OPEN
- Cadence stores `scheduled_for` / `day_offset`; nothing fires due touches.
  MT-38 computes "due" but no timer executes them.

### G8 — Auth / multi-tenancy  ·  status: OPEN
- `owner_email` exists but there is no login. "Fresh start by email" is a
  delete/reseed endpoint, not real auth.

### G9 — Whisper transcription  ·  status: OPEN
- Interview debrief takes **pasted** text; no audio → transcript path.

### G10 — Cost metering in the app  ·  status: OPEN
- MT-43 tested token/cost metering; the live app does not record per-generation
  usage to `usage_metering`.

## Priority (owner-directed)
1. **G1 HeyGen** + **G2 ElevenLabs** — next, once keys are provided.
2. G3 ATS — deferred, not forgotten.
3. G4–G10 — wiring hardening for production readiness.

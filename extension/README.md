# Executive Engine — Chrome extension

Universal job capture (and basic application autofill) for the Executive Engine
pipeline. It's the "save any job page → opportunity" layer the boards' closed
APIs otherwise block (G11).

## What it does
- **Save this job** — scrapes the current tab (JSON-LD `JobPosting` when present,
  else title/company/body text), posts to `POST /api/app/capture`, which
  normalizes it with OpenAI and inserts it into your pipeline via the same
  embed → pgvector-dedupe → insert-as-`discovered` path as email/ATS intake
  (so duplicates are skipped automatically).
- **Fill this application** — on any application form (Workday, Lever, Ashby,
  Greenhouse, custom), the extension reads the **real fields + their labels** off
  the live page, sends them to `POST /api/app/answers/from-questions`, and writes a
  tailored answer back into each field (React/Angular-safe value setting). You then
  review, attach your resume file (uploads can't be auto-attached), and submit.
  Works universally because it reads the page, not a per-site API.

## Install (unpacked, dev)
1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Click the extension → **Settings** → set your **workspace email** (the account
   you sign in with on the app). Optionally paste a **session token** for
   server-verified identity.
4. On any job posting, click the extension → **Save to pipeline**. It appears in
   Opportunities as `discovered` (source: Extension).

## Auth
- With a **session token** (from the app once signed in) the capture is scoped to
  your server-verified identity.
- Without one, the **workspace email** is used (fine for single-user).

## Endpoint
`POST /api/app/capture { url, title?, company?, text?, owner? }` →
`{ ok, inserted, reason?, opportunity }`. Backed by `api/src/functions/tests/appCapture.ts`.

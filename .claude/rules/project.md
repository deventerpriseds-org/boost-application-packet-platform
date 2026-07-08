# Project Overview

## What This Is
A job application automation platform that:
1. Receives job alerts (via inbox watcher or manual form)
2. Routes by role type (Engineering, Product Management, General)
3. Loads master context + prompts from Azure Table Storage
4. Runs 3 sequential AI agent calls to generate resume, portfolio, cover letter, cold email
5. Produces 4 Google Docs/Slides documents
6. Logs the job record
7. Delivers everything via Microsoft Graph email

## Pipeline Phases
- **Phase 0** — Config & Auth (all credentials established)
- **Phase 1** — Micro Tests (27 integration tests, each verifying one connection or step)
- **Phase 2** — Low-Fi App (full pipeline with manual approval gate)
- **Phase 3** — Go Live (production endpoints, inbox watcher active)

## Key Integrations
| Service | Purpose |
|---|---|
| Azure Table Storage | AppConfig, Prompts, JobApplications, MasterContext |
| Azure Functions | API backend (`/api/process-job`) |
| Azure Static Web Apps | Dev Console frontend |
| OpenAI (gpt-4o-mini) | 3 agent calls for content generation |
| Google Drive/Docs/Slides | Document creation from templates |
| Microsoft Graph | Email delivery with attachments |
| HeyGen | Avatar video generation (optional) |

## Dev Console URL
https://happy-river-0935bfe0f.7.azurestaticapps.net

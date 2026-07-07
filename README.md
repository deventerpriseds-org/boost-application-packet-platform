# Job Application Platform

Automated job application package generation platform for Von Ellis / Enterprise Digital Solutions.

## Architecture

- **Frontend:** React + Vite → Azure Static Web Apps
- **Backend:** Azure Functions (TypeScript) → `job-platform-api`
- **Storage:** Azure Table Storage (`n8nstxpdthydai6fkm`)
- **Resource Group:** `EnterpriseDS_ResourceGRP`

## Tables

| Table | Purpose |
|---|---|
| `AppConfig` | Auth credentials and platform settings |
| `Prompts` | Agent prompts with version history |
| `JobApplications` | Log of every pipeline run |
| `MasterContext` | Von Ellis baseline resume content |

## Local Development

### Frontend
```bash
cd web
npm install
npm run dev
```

### API
```bash
cd api
npm install
npm run build
npm start
```

## Deployment

Push to `main` → GitHub Actions auto-deploys frontend to Azure Static Web Apps.
API deploys via GitHub Actions to `job-platform-api` Function App.

## Pipeline Flow

```
Inbox Watcher / Job Form
  → Role Router (Azure Function)
  → Context Load (Table Storage)
  → Prompt Load (Table Storage)
  → Agent Call 1: Resume Package (OpenAI)
  → Agent Call 2: Portfolio + Cold Email (OpenAI)
  → Agent Call 3: ATS QC + Skills Merge (OpenAI)
  → Generate 4 Documents (Google Docs + Slides API)
  → Log Job Record (Table Storage)
  → Deliver Email (Microsoft Graph API)
```

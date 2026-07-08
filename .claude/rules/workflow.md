# Development Workflow

## Pattern
Always follow: **Research → Plan → Execute → Review → Ship**

Don't jump straight to coding. Understand the existing code first, plan the change, then implement.

## Project Structure
- `api/` — Azure Functions (Node 22, TypeScript)
- `web/` — React + Vite SPA, deployed to Azure Static Web Apps
- `.github/workflows/` — CI/CD pipelines (api-deploy, web-deploy, azure-setup)

## Branch Convention
- Feature work goes on named branches, not directly to `main`
- `main` triggers automatic deploys via GitHub Actions

## API
- Entry points are under `api/src/functions/`
- Build output goes to `api/dist/` (excluded from git)
- TypeScript must compile before zip deploy

## Web
- Built with Vite, output to `web/dist/`
- `web/public/staticwebapp.config.json` controls SWA routing
- `navigationFallback` rewrites to `/index.html` for SPA routing

## Testing
- No automated test suite yet — validate manually by running the dev server or firing the Azure Function locally
- Phase 1 micro-tests are tracked in the Dev Console UI at the SPA URL

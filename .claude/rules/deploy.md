# Deploy Commands

## API Build & Deploy
```bash
# Build
cd api && npm ci && npm run build

# Zip deploy
cd api && zip -r /tmp/api-deploy.zip . --exclude '*.ts' --exclude 'src/*'
az functionapp deployment source config-zip \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --src /tmp/api-deploy.zip
```

## Web (Static Web App)
Deploys automatically via GitHub Actions on push to `main` when files under `web/` change.
Workflow: `.github/workflows/web-deploy.yml`

## GitHub Secrets Required
- `AZURE_CLIENT_ID` — service principal app ID
- `AZURE_CLIENT_SECRET` — service principal secret
- `AZURE_TENANT_ID` — ee633423-c321-413c-a191-ace8b07e4196
- `AZURE_SUBSCRIPTION_ID` — 09594120-1b35-4e21-84c6-451ac27175a3
- `AZURE_STORAGE_CONNECTION_STRING` — storage account connection string
- `AZURE_STATIC_WEB_APPS_API_TOKEN` — static web app deployment token

# Job Application Platform

## Azure Infrastructure

- **Resource Group**: EnterpriseDS_ResourceGRP
- **Subscription**: 09594120-1b35-4e21-84c6-451ac27175a3
- **Tenant**: ee633423-c321-413c-a191-ace8b07e4196 (primary, where subscription lives)
- **Region**: eastus
- **Function App**: job-platform-api (job-platform-api.azurewebsites.net)
- **Static Web App**: job-platform-web (happy-river-0935bfe0f.7.azurestaticapps.net)
- **Storage Account**: n8nstxpdthydai6fkm
- **Storage Tables**: AppConfig, Prompts, JobApplications, MasterContext
- **Node runtime**: 22

## Azure CLI Auth (for Claude Code sessions)

If `AZURE_CLIENT_ID` env var is set (CCR environment), login with:
```bash
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -p $AZURE_CLIENT_SECRET \
  --tenant $AZURE_TENANT_ID
az account set --subscription $AZURE_SUBSCRIPTION_ID
```

Otherwise use device code:
```bash
az login --use-device-code --allow-no-subscriptions
az account list --refresh --all  # finds subscription under tenant ee633423-...
az account set --subscription 09594120-1b35-4e21-84c6-451ac27175a3
```

## GitHub Secrets Required

- `AZURE_CLIENT_ID` — service principal app ID
- `AZURE_CLIENT_SECRET` — service principal secret
- `AZURE_TENANT_ID` — ee633423-c321-413c-a191-ace8b07e4196
- `AZURE_SUBSCRIPTION_ID` — 09594120-1b35-4e21-84c6-451ac27175a3
- `AZURE_STORAGE_CONNECTION_STRING` — storage account connection string
- `AZURE_STATIC_WEB_APPS_API_TOKEN` — static web app deployment token

## Deploy Commands

```bash
# Build API
cd api && npm ci && npm run build

# Deploy API (zip deploy)
cd api && zip -r /tmp/api-deploy.zip . --exclude '*.ts' --exclude 'src/*'
az functionapp deployment source config-zip \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --src /tmp/api-deploy.zip
```

## tsconfig note

The `lib` must include `"DOM"` for Azure SDK compatibility:
```json
"lib": ["ES2020", "DOM"]
```

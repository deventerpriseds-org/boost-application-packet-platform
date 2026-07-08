# Azure Infrastructure

## Resource Details
- **Resource Group**: EnterpriseDS_ResourceGRP
- **Subscription**: 09594120-1b35-4e21-84c6-451ac27175a3
- **Tenant**: ee633423-c321-413c-a191-ace8b07e4196
- **Region**: eastus
- **Function App**: job-platform-api (job-platform-api.azurewebsites.net)
- **Static Web App**: job-platform-web (happy-river-0935bfe0f.7.azurestaticapps.net)
- **Storage Account**: n8nstxpdthydai6fkm
- **Storage Tables**: AppConfig, Prompts, JobApplications, MasterContext
- **Node runtime**: 22

## Auth

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
az account list --refresh --all
az account set --subscription 09594120-1b35-4e21-84c6-451ac27175a3
```

## tsconfig note
The `lib` must include `"DOM"` for Azure SDK compatibility:
```json
"lib": ["ES2020", "DOM"]
```

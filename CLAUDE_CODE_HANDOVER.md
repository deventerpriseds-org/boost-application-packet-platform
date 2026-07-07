# Claude Code Handover — Job Application Platform

## What You Are

You are picking up an in-progress infrastructure setup for the **Job Application Platform** — an automated job application package generation system for Von Ellis / Enterprise Digital Solutions. This replaces a Zapier workflow.

You are working in **Claude Code**, not Claude.ai. You have terminal access. Use it.

---

## Current State — What Is Already Done

### GitHub Repo
- **URL:** https://github.com/deventerprisesds/job-application-platform
  - Note: GitHub may redirect to `https://github.com/deventerpriseds-org/boost-application-packet-platform` — use whichever resolves
- **Branch:** `main`
- **Already committed:**
  - `web/` — React + Vite frontend (the Dev Console app)
  - `api/` — Azure Functions TypeScript (processJob stub, health check, testConnection)
  - `.github/workflows/` — GitHub Actions auto-created by Azure Static Web App
  - `README.md`, `.gitignore`

### Azure Resources (may already exist — verify before creating)
- **Resource Group:** `EnterpriseDS_ResourceGRP`
- **Storage Account:** `n8nstxpdthydai6fkm` (existing — do not create a new one)
- **Static Web App:** `job-platform-web` (may already be created by Azure during repo setup)
- **Function App:** `job-platform-api` (may or may not exist — check first)

### Bug Already Fixed
The auth "Test Connection → auto-marks as Configured" bug has been fixed and pushed. The fix is in the latest commit on main.

---

## Credentials

```
GitHub Token:       GITHUB_TOKEN_HERE

Azure Storage Account:   n8nstxpdthydai6fkm
Azure Storage Connection String:
  DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net

Azure Subscription:   09594120-1b35-4e21-84c6-451ac27175a3
Azure Resource Group: EnterpriseDS_ResourceGRP
Azure Region:         eastus
Azure Tenant:         b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e
```

---

## Your Job — In Order

### 0. Orient First

Run these before touching anything:

```bash
# Check Azure CLI auth
az account show

# If not logged in:
az login --tenant b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e
az account set --subscription 09594120-1b35-4e21-84c6-451ac27175a3

# Check what Azure resources already exist
az resource list \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "[].{name:name, type:type, location:location}" \
  -o table

# Check what tables already exist in storage
az storage table list \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net" \
  --query "[].name" -o tsv

# Check GitHub Actions workflow status
curl -s \
  -H "Authorization: token GITHUB_TOKEN_HERE" \
  "https://api.github.com/repos/deventerprisesds/job-application-platform/actions/runs?per_page=3" \
  | python3 -c "import sys,json; [print(r['name'], r['status'], r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']]"
```

Report what exists before proceeding. Do not create anything that already exists.

---

### 1. Clone the Repo

```bash
git clone https://GITHUB_TOKEN_HERE@github.com/deventerprisesds/job-application-platform.git
cd job-application-platform
git log --oneline -5
```

Verify the latest commit includes the auth fix message:
`"Fix: Test Connection now auto-marks auth as configured on pass"`

---

### 2. Create Storage Tables (skip any that already exist)

```bash
CONN="DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net"

for TABLE in AppConfig Prompts JobApplications MasterContext; do
  az storage table create --name $TABLE --connection-string "$CONN" \
    && echo "✓ $TABLE" || echo "  $TABLE already exists or failed"
done
```

Verify:
```bash
az storage table list --connection-string "$CONN" --query "[].name" -o tsv
```

Do not proceed until all 4 tables are confirmed: `AppConfig`, `Prompts`, `JobApplications`, `MasterContext`

---

### 3. Create Function App (if it does not already exist)

Check first:
```bash
az functionapp show \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "{name:name, state:state}" -o json 2>&1
```

If it does not exist (error or empty), create it:
```bash
az functionapp create \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --storage-account n8nstxpdthydai6fkm \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --os-type Linux
```

---

### 4. Set Function App Environment Variables

```bash
az functionapp config appsettings set \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --settings \
    "AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net" \
    "MICROSOFT_TENANT_ID=b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e" \
    "NODE_ENV=production"
```

---

### 5. Build and Deploy the API

```bash
cd api
npm install
npm run build

# Verify build output
ls dist/functions/
# Expected: processJob.js  health.js

# Deploy
func azure functionapp publish job-platform-api --typescript
cd ..
```

---

### 6. Set Up GitHub Actions for API Deployment

Get the Function App publish profile and add it as a GitHub secret.

```bash
# Get publish profile
az functionapp deployment list-publishing-profiles \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --xml > /tmp/publish-profile.xml

echo "Publish profile retrieved: $(wc -c < /tmp/publish-profile.xml) bytes"
```

Add to GitHub — use the GitHub CLI if available, otherwise use the REST API:
```bash
# Using gh CLI (preferred)
gh secret set AZURE_FUNCTIONAPP_PUBLISH_PROFILE \
  --repo deventerprisesds/job-application-platform \
  < /tmp/publish-profile.xml

# Or using curl with base64 — note: GitHub requires libsodium encryption for secrets
# If this fails, report it — we will add manually via GitHub UI
```

Create the API deployment workflow:
```bash
cat > .github/workflows/api-deploy.yml << 'WORKFLOW'
name: Deploy API to Azure Functions

on:
  push:
    branches: [main]
    paths:
      - 'api/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - name: Install and Build
        run: |
          cd api
          npm ci
          npm run build
      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: job-platform-api
          package: api
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
WORKFLOW

git add .github/workflows/api-deploy.yml
git commit -m "Add API deployment workflow"
git push origin main
```

---

### 7. Verify Static Web App (if not already created by Azure)

Check if it exists:
```bash
az staticwebapp show \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "{name:name, defaultHostname:defaultHostname}" -o json 2>&1
```

If it does not exist, create it:
```bash
az staticwebapp create \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --location "eastus2" \
  --source https://github.com/deventerprisesds/job-application-platform \
  --branch main \
  --app-location "/web" \
  --output-location "dist" \
  --login-with-github
```

Get the deployment token and add to GitHub:
```bash
STATIC_TOKEN=$(az staticwebapp secrets list \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "properties.apiKey" -o tsv)

gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN \
  --repo deventerprisesds/job-application-platform \
  --body "$STATIC_TOKEN"
```

Create the web deployment workflow if it does not already exist in `.github/workflows/`:
```bash
ls .github/workflows/
# If no web deploy workflow exists, create one:

cat > .github/workflows/web-deploy.yml << 'WORKFLOW'
name: Deploy Web to Azure Static Web Apps

on:
  push:
    branches: [main]
    paths:
      - 'web/**'
  workflow_dispatch:

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - name: Install and Build
        run: |
          cd web
          npm ci
          npm run build
      - name: Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /web
          output_location: dist
          skip_app_build: true
WORKFLOW

git add .github/workflows/web-deploy.yml
git commit -m "Add Static Web App deployment workflow"
git push origin main
```

---

### 8. Verify Everything

```bash
# Get the Static Web App URL
WEB_URL=$(az staticwebapp show \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "defaultHostname" -o tsv)
echo "Frontend URL: https://$WEB_URL"

# Get the Function App URL
FUNC_URL="https://job-platform-api.azurewebsites.net"

# Test health endpoint
echo "Testing health endpoint..."
curl -s "$FUNC_URL/api/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2))"

# Test processJob stub
echo "Testing processJob stub..."
curl -s -X POST "$FUNC_URL/api/process-job" \
  -H "Content-Type: application/json" \
  -d '{
    "jobTitle": "VP of Engineering",
    "jobDescription": "Test job for pipeline verification",
    "roleType": "Engineering",
    "sendToEmail": "von.ellis@enterpriseds.io"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2))"

# Verify job was logged to table
CONN="DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net"
az storage entity query \
  --table-name JobApplications \
  --connection-string "$CONN" \
  --filter "PartitionKey eq 'applications'" \
  --query "items[*].{JobTitle:JobTitle, Status:Status}" \
  -o table

# Check GitHub Actions
curl -s \
  -H "Authorization: token GITHUB_TOKEN_HERE" \
  "https://api.github.com/repos/deventerprisesds/job-application-platform/actions/runs?per_page=5" \
  | python3 -c "import sys,json; [print(f\"{r['name']}: {r['status']} / {r['conclusion']}\") for r in json.load(sys.stdin)['workflow_runs']]"
```

---

## Success Criteria

Report back with confirmation of each:

- [ ] All 4 tables exist in `n8nstxpdthydai6fkm`: AppConfig, Prompts, JobApplications, MasterContext
- [ ] `job-platform-api` Function App running in `EnterpriseDS_ResourceGRP`
- [ ] `GET /api/health` returns `"status": "ok"` with all 4 tables listed
- [ ] `POST /api/process-job` returns `"success": true`
- [ ] Job record appears in `JobApplications` table after the test POST
- [ ] `job-platform-web` Static Web App accessible in browser
- [ ] Dev console loads and auth bug is fixed (Test Connection sets Configured status)
- [ ] GitHub Actions workflows running successfully on push

---

## Important Rules

1. **Check before creating** — verify every Azure resource before trying to create it
2. **Never modify** `web/src/App.jsx` or `api/src/functions/*.ts` — source files are locked
3. **Report failures immediately** — do not skip or work around errors silently
4. **Stop after verification** — do not begin wiring micro test functions or real integrations
5. **One task at a time** — complete and verify each step before moving to the next

---

## What Comes Next (Not Your Job This Session)

After this session verifies the foundation, the next Claude Code session will:
- Wire each micro test button in the dev console to a real Azure Function
- Build the `testConnection` function for each auth type (Azure, OpenAI, Google, Microsoft, HeyGen)
- Build the `contextLoader` and `promptLoader` functions
- Begin Agent Call 1 (Resume Package) in isolation

---

## Project Background (Brief)

This platform replaces a 40-node Zapier workflow that generates job application packages for Von Ellis. When triggered by a job alert (or manual form submission), it runs 3 OpenAI agent calls to generate tailored resume content, portfolio content, and ATS analysis — populates 4 Google Doc/Slides templates — and emails everything via Microsoft Graph. The dev console is the testing and management UI for the entire pipeline. All auth config, prompts, and job history live in Azure Table Storage.

Repo: https://github.com/deventerprisesds/job-application-platform
Full deployment instructions: `CLAUDE_CODE_DEPLOYMENT_INSTRUCTIONS.md` in the repo root (will be added shortly)

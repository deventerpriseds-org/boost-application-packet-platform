# Claude Code — Job Application Platform: Azure Deployment Instructions

## Context & Goal

You are setting up the Job Application Platform for Enterprise Digital Solutions. The GitHub repo already exists at `github.com/deventerprisesds/job-application-platform` with the full scaffold committed. Your job is to complete the Azure infrastructure setup, wire up the Function App deployment pipeline, create the storage tables, and verify the full stack is live.

Do not modify any existing source files unless instructed. Report what you plan to do before each destructive or irreversible action and wait for confirmation.

---

## Credentials & IDs

```
GitHub Token:       GITHUB_TOKEN_HERE
GitHub Repo:        deventerprisesds/job-application-platform

Azure Storage Account:        n8nstxpdthydai6fkm
Azure Storage Connection String:
  DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net

Azure Subscription:   09594120-1b35-4e21-84c6-451ac27175a3
Azure Resource Group: EnterpriseDS_ResourceGRP
Azure Region:         eastus
Azure Tenant:         b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e
```

---

## Prerequisites — Verify These First

Before doing anything, run the following checks and report results:

```bash
# 1. Azure CLI installed and logged in
az --version
az account show

# 2. Node.js version
node --version

# 3. Azure Functions Core Tools
func --version

# 4. GitHub access
curl -s -H "Authorization: token GITHUB_TOKEN_HERE" \
  https://api.github.com/repos/deventerprisesds/job-application-platform \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Repo:', d.get('full_name'), '| Private:', d.get('private'))"
```

If Azure CLI is not logged in, run:
```bash
az login --tenant b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e
az account set --subscription 09594120-1b35-4e21-84c6-451ac27175a3
```

---

## Step 1 — Clone the Repo

```bash
git clone https://GITHUB_TOKEN_HERE@github.com/deventerprisesds/job-application-platform.git
cd job-application-platform
```

Verify the structure:
```bash
ls -la
# Expected: api/  web/  .github/  README.md  .gitignore
ls api/src/functions/
# Expected: processJob.ts  health.ts
ls web/src/
# Expected: App.jsx  main.jsx
```

---

## Step 2 — Create Azure Storage Tables

Create the 4 required tables in the existing storage account. Use the Azure CLI:

```bash
az storage table create \
  --name AppConfig \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net"

az storage table create \
  --name Prompts \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net"

az storage table create \
  --name JobApplications \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net"

az storage table create \
  --name MasterContext \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net"
```

Verify all 4 were created:
```bash
az storage table list \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net" \
  --query "[].name" -o tsv
```

Expected output (order may vary):
```
AppConfig
JobApplications
MasterContext
Prompts
```

Do not proceed until all 4 tables are confirmed.

---

## Step 3 — Create the Azure Function App

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

Wait for the command to complete (usually 30–60 seconds). Then verify:
```bash
az functionapp show \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "{name:name, state:state, location:location}" \
  -o json
```

Expected: `"state": "Running"`

---

## Step 4 — Set Function App Environment Variables

Set all required application settings in one command:

```bash
az functionapp config appsettings set \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --settings \
    "AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net" \
    "MICROSOFT_TENANT_ID=b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e" \
    "NODE_ENV=production"
```

Verify the settings were saved:
```bash
az functionapp config appsettings list \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "[?name=='AZURE_STORAGE_CONNECTION_STRING' || name=='MICROSOFT_TENANT_ID'].{name:name}" \
  -o table
```

---

## Step 5 — Build the API and Deploy to Function App

Install dependencies and build TypeScript:
```bash
cd api
npm install
npm run build
```

Verify the build output:
```bash
ls dist/functions/
# Expected: processJob.js  health.js  (and .map files)
```

Deploy using Azure Functions Core Tools:
```bash
func azure functionapp publish job-platform-api --typescript
```

Wait for deployment to complete. Expected output ends with something like:
```
Deployment successful.
Remote build succeeded!
```

---

## Step 6 — Set Up GitHub Actions for API (CI/CD)

Get the Function App publish profile:
```bash
az functionapp deployment list-publishing-profiles \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --xml > /tmp/publish-profile.xml
cat /tmp/publish-profile.xml
```

Add it as a GitHub secret:
```bash
PUBLISH_PROFILE=$(cat /tmp/publish-profile.xml)

curl -s -X PUT \
  -H "Authorization: token GITHUB_TOKEN_HERE" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/deventerprisesds/job-application-platform/actions/secrets/AZURE_FUNCTIONAPP_PUBLISH_PROFILE" \
  -d "{\"encrypted_value\": \"$(echo -n "$PUBLISH_PROFILE" | base64 -w 0)\"}" \
  | python3 -c "import sys; print(sys.stdin.read())"
```

Note: If the secret encryption step fails (GitHub requires libsodium encryption), report this and we will add the publish profile manually via the GitHub UI instead. Do not block on this — proceed to Step 7.

Now create the GitHub Actions workflow for API deployment:

Create the file `api-deploy.yml` in the repo:

```bash
cat > .github/workflows/api-deploy.yml << 'EOF'
name: Deploy API to Azure Functions

on:
  push:
    branches: [main]
    paths:
      - 'api/**'
      - '.github/workflows/api-deploy.yml'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: api/package-lock.json

      - name: Install dependencies
        run: |
          cd api
          npm ci

      - name: Build TypeScript
        run: |
          cd api
          npm run build

      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: job-platform-api
          package: api
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
          respect-funcignore: true
EOF
```

Commit and push:
```bash
git add .github/workflows/api-deploy.yml
git commit -m "Add GitHub Actions workflow for API deployment"
git push origin main
```

---

## Step 7 — Create Azure Static Web App (Frontend)

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

When prompted, authenticate with the GitHub token. The Azure CLI will open a browser — if running headless, use the device code flow.

If the CLI prompts fail, run this alternative and report the output:
```bash
az staticwebapp create \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --location "eastus2" \
  --sku Free \
  -o json
```

Then retrieve the deployment token:
```bash
az staticwebapp secrets list \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "properties.apiKey" \
  -o tsv
```

And add it as a GitHub secret:
```bash
STATIC_TOKEN=$(az staticwebapp secrets list \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "properties.apiKey" -o tsv)

echo "Static Web App deployment token retrieved: ${#STATIC_TOKEN} chars"
```

Create the GitHub Actions workflow for the frontend:
```bash
cat > .github/workflows/web-deploy.yml << 'EOF'
name: Deploy Web to Azure Static Web Apps

on:
  push:
    branches: [main]
    paths:
      - 'web/**'
      - '.github/workflows/web-deploy.yml'
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]
  workflow_dispatch:

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: web/package-lock.json

      - name: Install and Build
        run: |
          cd web
          npm ci
          npm run build

      - name: Deploy to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /web
          output_location: dist
          skip_app_build: true
EOF
```

Add the deployment token as a GitHub secret:
```bash
curl -s -X PUT \
  -H "Authorization: token GITHUB_TOKEN_HERE" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/deventerprisesds/job-application-platform/actions/secrets/AZURE_STATIC_WEB_APPS_API_TOKEN" \
  --data-binary "{\"encrypted_value\":\"$STATIC_TOKEN\"}" \
  | python3 -c "import sys; print(sys.stdin.read())"
```

Commit and push both workflow files:
```bash
git add .github/workflows/web-deploy.yml
git commit -m "Add GitHub Actions workflow for Static Web App deployment"
git push origin main
```

---

## Step 8 — Verify Full Stack

### 8a — Get the Static Web App URL
```bash
az staticwebapp show \
  --name job-platform-web \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "defaultHostname" \
  -o tsv
```

Save this URL — it will look like `https://brave-rock-012345.azurestaticapps.net`

### 8b — Verify the API health endpoint
```bash
FUNC_URL="https://job-platform-api.azurewebsites.net"
curl -s "$FUNC_URL/api/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2))"
```

Expected response:
```json
{
  "status": "ok",
  "storage": "connected",
  "tables": ["AppConfig", "JobApplications", "MasterContext", "Prompts"]
}
```

### 8c — Test the processJob stub
```bash
curl -s -X POST "$FUNC_URL/api/process-job" \
  -H "Content-Type: application/json" \
  -d '{
    "jobTitle": "VP of Engineering",
    "jobDescription": "Test job description for pipeline verification",
    "roleType": "Engineering",
    "sendToEmail": "von.ellis@enterpriseds.io"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2))"
```

Expected response:
```json
{
  "success": true,
  "jobId": "job-1234567890",
  "message": "Job received and logged. Awaiting approval.",
  "receivedAt": "2026-07-07T..."
}
```

### 8d — Verify the job was logged to Table Storage
```bash
az storage entity query \
  --table-name JobApplications \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=n8nstxpdthydai6fkm;AccountKey=AZURE_STORAGE_KEY_HERE;EndpointSuffix=core.windows.net" \
  --filter "PartitionKey eq 'applications'" \
  --query "items[*].{JobTitle:JobTitle, Status:Status, ReceivedAt:ReceivedAt}" \
  -o table
```

### 8e — Check GitHub Actions ran successfully
```bash
curl -s \
  -H "Authorization: token GITHUB_TOKEN_HERE" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/deventerprisesds/job-application-platform/actions/runs?per_page=5" \
  | python3 -c "
import sys, json
runs = json.load(sys.stdin)['workflow_runs']
for r in runs:
    print(f\"{r['name']}: {r['status']} / {r['conclusion']} — {r['created_at']}\")"
```

All workflows should show `completed / success`.

---

## Success Criteria

All 8 steps are complete when:

- [ ] Repo cloned and structure verified
- [ ] All 4 Azure tables exist: `AppConfig`, `Prompts`, `JobApplications`, `MasterContext`
- [ ] Function App `job-platform-api` running in `EnterpriseDS_ResourceGRP`
- [ ] Environment variable `AZURE_STORAGE_CONNECTION_STRING` set on Function App
- [ ] API deployed — `GET /api/health` returns `"status": "ok"` with all 4 tables listed
- [ ] `POST /api/process-job` returns `"success": true` and logs to `JobApplications` table
- [ ] Static Web App `job-platform-web` created and accessible via browser
- [ ] GitHub Actions workflows running on push to main for both web and api
- [ ] Dev console loads in browser at the Static Web App URL

---

## If Anything Fails

Report the exact error message and the step number. Do not skip steps or work around failures silently. If a command times out, retry once before reporting.

Common issues:
- **GitHub secret encryption:** If the raw token cannot be set via curl (GitHub requires libsodium), report it and we will add the secret manually via the GitHub UI.
- **Static Web App GitHub auth:** If `--login-with-github` fails in headless mode, create the Static Web App without GitHub connection first, then set up the GitHub Actions workflow manually using the deployment token.
- **Function App cold start:** The health check may return a timeout on first call. Wait 30 seconds and retry before declaring failure.

---

## After Verification

Report back with:
1. The Static Web App URL
2. The Function App URL
3. Confirmation that the health check and processJob test both passed
4. Screenshot or output of the GitHub Actions runs showing success

Do not begin building any micro test functions or wiring up real integrations — that work happens in the next Claude Code session once this foundation is verified.

# Claude Code Handover — Job Application Platform
**Session 2 | Enterprise Digital Solutions**

---

## What you are

You are continuing work on the **Job Application Platform** for Enterprise Digital Solutions. The frontend dev console is already live. Your job this session is to stand up the Azure backend so the test buttons in the console call real endpoints instead of simulating results.

---

## Live URLs

| | URL |
|---|---|
| Frontend | `https://happy-river-0935bfe0f7.azurestaticapps.net` |
| API target | `https://job-platform-api.azurewebsites.net` |
| Repo | `github.com/deventerpriseds-org/boost-application-packet-platform` |

---

## Azure config

| | |
|---|---|
| Subscription | `09594120-1b35-4e21-84c6-451ac27175a3` |
| Resource group | `EnterpriseDS_ResourceGRP` |
| Region | `eastus` |
| Tenant | `b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e` |
| Storage account | `n8nstxpdthydai6fkm` |
| Function app | `job-platform-api` |
| Credentials | Read from org secrets in `deventerpriseds-org` — do not ask user for tokens |

---

## What is already done

- Frontend dev console live at Static Web App URL above
- All 5 tabs working: dashboard, auth config, micro tests, job form, prompt editor
- Auth bug fixed — Test Connection auto-marks as Configured on pass
- GitHub Actions wired up — push to main auto-deploys frontend
- `api/src/functions/processJob.ts` and `health.ts` scaffolded in repo

---

## Critical issue

All test Run buttons currently **simulate pass/fail with Math.random()** — they are not calling real endpoints. The user confirmed this when the email send test showed pass but no email arrived. Every test must be wired to a real Azure Function endpoint.

---

## Repo structure

```
boost-application-packet-platform/
├── web/
│   ├── src/App.jsx          ← dev console (do not restructure)
│   └── src/main.jsx
├── api/
│   └── src/functions/
│       ├── processJob.ts    ← stub (receives job payload)
│       ├── health.ts        ← health check + testConnection
│       └── tests/           ← create this folder for MT-01 through MT-21
├── .github/workflows/       ← already wired for auto-deploy
└── CLAUDE_CODE_HANDOVER.md  ← this doc
```

---

## Your tasks this session — in order

### 1. Orient first
Run these before touching anything. Report what exists before creating anything.

```bash
az account show
az resource list --resource-group EnterpriseDS_ResourceGRP -o table
az storage table list \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
  --query "[].name" -o tsv
```

### 2. Create 4 storage tables
In `n8nstxpdthydai6fkm`. Skip any that already exist.

```bash
for TABLE in AppConfig Prompts JobApplications MasterContext; do
  az storage table create --name $TABLE \
    --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
    && echo "✓ $TABLE" || echo "  $TABLE already exists"
done
```

### 3. Create Function App if it does not already exist
Check first:
```bash
az functionapp show \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --query "{name:name, state:state}" -o json 2>&1
```

If it does not exist:
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

### 4. Set environment variables
```bash
az functionapp config appsettings set \
  --name job-platform-api \
  --resource-group EnterpriseDS_ResourceGRP \
  --settings \
    "AZURE_STORAGE_CONNECTION_STRING=$AZURE_STORAGE_CONNECTION_STRING" \
    "MICROSOFT_TENANT_ID=b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e" \
    "NODE_ENV=production"
```

### 5. Build and deploy the API
```bash
cd api
npm install
npm run build
ls dist/functions/
func azure functionapp publish job-platform-api --typescript
```

Verify:
```bash
curl https://job-platform-api.azurewebsites.net/api/health
```

Expected:
```json
{ "status": "ok", "storage": "connected", "tables": ["AppConfig", "JobApplications", "MasterContext", "Prompts"] }
```

### 6. Wire MT-01 first
Build a real `POST /api/test/mt-01` Azure Function. Update the frontend Run button to call it. Deploy. Verify the test card shows a real result before moving on.

### 7. Wire remaining tests in order
MT-02 through MT-21, one at a time. Build the function, update the frontend button, deploy, verify. Do not move to the next until the current one passes with a real result.

---

## Rules

- Never put credentials in committed files — use env vars or org secrets only
- Never modify `web/src/App.jsx` structure — only update the fetch calls behind Run buttons
- Never skip a test — if one fails, fix it before moving on
- Check before creating — always verify a resource does not already exist
- Do not start agent functions or real integrations — this session is infrastructure and wiring only

---

## Success criteria

- All 4 tables confirmed in `n8nstxpdthydai6fkm`
- `GET /api/health` returns `status: ok` with all 4 tables listed
- `POST /api/process-job` logs a real record to `JobApplications` table
- MT-01 Run button calls a real function and shows a real pass or fail
- All remaining tests wired and verified through MT-21

---

## Micro test specs — MT-01 through MT-22

Build each test as a separate Azure Function in `api/src/functions/tests/`. After each function is deployed, update the corresponding Run button in `web/src/App.jsx` to call the real endpoint URL instead of calling `runTest()`.

---

### MT-01 — Azure Table Storage read/write
**Endpoint:** `POST /api/test/mt-01`
**Connection:** Azure

Function writes a row to `AppConfig` table with `PartitionKey=test`, `RowKey=mt-01-{timestamp}`, `value=ping`. Reads it back. Deletes it. Returns success.

**Pass:** Row written, read back with correct value, deleted cleanly.
**Fail:** Any storage SDK error — log the error message.

---

### MT-02 — OpenAI connection
**Endpoint:** `POST /api/test/mt-02`
**Connection:** OpenAI

Function calls `POST https://api.openai.com/v1/chat/completions` with model `gpt-4o-mini`, single message `say "pong"`, `max_tokens: 5`. Reads `OPENAI_API_KEY` from Function App env vars.

**Pass:** HTTP 200, response contains content, latency under 10s.
**Fail:** HTTP 401 (bad key), HTTP 429 (rate limit), timeout — log status code.

---

### MT-03 — Google service account auth
**Endpoint:** `POST /api/test/mt-03`
**Connection:** Google

Function uses service account JSON from `GOOGLE_SERVICE_ACCOUNT_JSON` env var to get an OAuth2 access token. Calls Google Drive API `GET /drive/v3/files` with `q='"1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt" in parents'` to list files in the output folder. Returns file count.

**Pass:** Token obtained, Drive API returns HTTP 200, file list returned.
**Fail:** Token failure, HTTP 403 (permissions), folder not found — log error.

---

### MT-04 — Google Docs template copy
**Endpoint:** `POST /api/test/mt-04`
**Connection:** Google

Function calls Drive API `POST /drive/v3/files/{resumeTemplateId}/copy` with body `{name: "MT-04 Test Copy - DELETE ME", parents: ["1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt"]}`. Reads `GOOGLE_RESUME_TEMPLATE_ID` from env vars. Returns new file ID and URL.

**Resume template ID:** `1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw`
**Output folder ID:** `1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt`

**Pass:** New doc created in output folder, file ID returned, visible in Drive.
**Fail:** Template not found, permissions error — log error.
**Note:** Test copy stays in Drive for visual verification — user manually deletes it.

---

### MT-05 — Google Docs variable injection
**Endpoint:** `POST /api/test/mt-05`
**Connection:** Google

Function copies the resume template (same as MT-04), then calls Docs API `POST /docs/v1/documents/{docId}:batchUpdate` with `replaceAllText` requests for every resume variable using hardcoded test strings.

**Variables to replace:**

| Variable | Test value |
|---|---|
| `{{ResumeSummary}}` | `TEST SUMMARY — ATS optimized executive statement` |
| `{{SkillsBullets1}}` | `Enterprise Architecture` |
| `{{SkillsBullets2}}` | `Cloud Strategy` |
| `{{ExpertiseBullets}}` | `Digital Transformation Leadership` |
| `{{WorkHistoryBullets1}}` | `Led enterprise software strategy across 15 global markets` |
| `{{WorkHistoryBullets2}}` | `Directed digital engineering organization of 120+ engineers` |
| `{{WorkHistoryBullets3}}` | `Architected corporate information solutions platform` |
| `{{WorkHistoryBullets4}}` | `Delivered GIS and water infrastructure analytics systems` |
| `{{RelevantBullets1}}` | `Agile Portfolio Mgmt` |
| `{{RelevantBullets2}}` | `SaaS Platforms` |
| `{{RelevantBullets3}}` | `Data Governance` |

**Pass:** batchUpdate returns HTTP 200. Open the doc URL — zero `{{` characters visible anywhere.
**Fail:** Any placeholder still visible in the opened doc.

---

### MT-06 — Google Slides template copy + inject
**Endpoint:** `POST /api/test/mt-06`
**Connection:** Google

Function copies the portfolio Slides template (`GOOGLE_PORTFOLIO_TEMPLATE_ID`), then calls Slides API `POST /v1/presentations/{id}:batchUpdate` with `replaceAllText` for every portfolio variable.

**Portfolio template ID:** `1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec`

**Variables to replace:**

| Variable | Test value |
|---|---|
| `{{@Company}}` | `TechVenture Inc` |
| `{{@CoverLetterDate}}` | `July 7, 2026` |
| `{{@CoverLetterBody}}` | `TEST COVER LETTER BODY — placeholder for full letter content` |
| `{{@AboutMe1_50words}}` | `TEST ABOUT ME 1 — executive innovation philosophy statement approximately fifty words in length for testing purposes only delete before production use` |
| `{{@AboutMe2_60words}}` | `TEST ABOUT ME 2 — career narrative statement approximately sixty words in length for testing purposes only delete before production use` |
| `{{@ExecutiveProfile_55words}}` | `TEST EXECUTIVE PROFILE — as a technology executive statement approximately fifty-five words for testing purposes only` |
| `{{@CoreAccomplishments_5blts_180words}}` | `TEST CORE ACCOMPLISHMENTS — five bullet points totaling approximately one hundred eighty words for testing` |
| `{{SoftSkills1}}` | `Strategic Vision` |
| `{{SoftSkills2}}` | `Executive Presence` |
| `{{HardSkills1}}` | `Cloud Architecture` |
| `{{HardSkills2}}` | `Enterprise SaaS` |

**Pass:** batchUpdate HTTP 200. Open the deck — zero `{{` or `{{@` characters visible.
**Fail:** Any placeholder visible in the opened deck.

---

### MT-07 — Microsoft Graph email send
**Endpoint:** `POST /api/test/mt-07`
**Connection:** Microsoft

Function gets OAuth2 token from `https://login.microsoftonline.com/b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e/oauth2/v2.0/token` using client credentials flow (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, scope `https://graph.microsoft.com/.default`). Then calls `POST https://graph.microsoft.com/v1.0/users/dev@enterpriseds.io/sendMail` with:

```json
{
  "message": {
    "subject": "MT-07 Test — Platform Connection Verified",
    "body": { "contentType": "Text", "content": "MT-07 test — job application platform connection verified. This is an automated test message." },
    "toRecipients": [{ "emailAddress": { "address": "von.ellis@enterpriseds.io" } }]
  }
}
```

**Pass:** Graph API returns HTTP 202. Email arrives in von.ellis@enterpriseds.io inbox within 60s.
**Fail:** HTTP 401 (bad token), HTTP 403 (missing Mail.Send permission in Entra app registration — must be granted in Azure Portal under the app registration API permissions).

---

### MT-08 — Microsoft Graph email with attachment
**Endpoint:** `POST /api/test/mt-08`
**Connection:** Microsoft

Same as MT-07 but add an `attachments` array containing a hardcoded minimal PDF encoded as base64. Use this tiny valid PDF base64 constant in the function code:

```
JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMTkwCiUlRU9G
```

Attachment payload:
```json
{
  "@odata.type": "#microsoft.graph.fileAttachment",
  "name": "MT-08-test-attachment.pdf",
  "contentType": "application/pdf",
  "contentBytes": "<base64 string above>"
}
```

**Pass:** Email arrives with PDF attachment. Attachment opens correctly.
**Fail:** Email arrives without attachment, or attachment is corrupt.

---

### MT-09 — Prompt table read
**Endpoint:** `POST /api/test/mt-09`
**Connection:** Azure

Function writes a test prompt row to `Prompts` table: `PartitionKey=resume_system`, `RowKey=v000-test`, `content=test prompt content`, `is_active=false`, `version=0`, `notes=MT-09 test row`. Queries it back filtering on `PartitionKey eq 'resume_system' and RowKey eq 'v000-test'`. Verifies content matches. Deletes the test row.

**Pass:** Row written, queried back with correct content, deleted cleanly.
**Fail:** Row not found, content mismatch, or delete failed.
**Note:** Uses `is_active=false` so it does not interfere with real prompt rows if any exist.

---

### MT-10 — Fake inbox watcher output
**Endpoint:** `POST /api/process-job` (already exists — no new function needed)
**Connection:** Webhook

Update the Fire Fake Alert button in the frontend (`App.jsx`) to POST the hardcoded fake job alert payload to the real `VITE_API_URL/api/process-job` endpoint instead of calling `runTest()`.

**Fake payload:**
```json
{
  "jobTitle": "VP of Engineering",
  "jobDescription": "We are seeking a VP of Engineering to lead our global engineering organization at TechVenture Inc...",
  "jobUrl": "https://linkedin.com/jobs/test-vp-engineering-12345",
  "roleType": "Engineering",
  "hiringContactName": "",
  "linkedInConnection": "",
  "sendToName": "Von Ellis",
  "sendToEmail": "von.ellis@enterpriseds.io",
  "receivedAt": "<ISO timestamp>",
  "sourceEmail": "jobalerts@linkedin.com",
  "originalSubject": "New job alert: VP of Engineering at TechVenture Inc"
}
```

**Pass:** HTTP 200 returned with `jobId`. Row appears in `JobApplications` table with `Status=received`.
**Fail:** HTTP error or row not appearing in table.

---

### MT-11 — JotForm replacement form
**Endpoint:** `POST /api/process-job` (same as MT-10 — no new function needed)
**Connection:** Internal

Update the manual job form Submit button in the frontend to POST to the real endpoint URL. Map all form fields to the JobAlert schema.

**Pass:** Form submission returns `jobId`. Row appears in `JobApplications` table with correct `JobTitle` and `RoleType`.
**Fail:** HTTP error or missing row in table.

---

### MT-12 — Role router
**Endpoint:** `POST /api/test/mt-12`
**Connection:** Azure

Function reads template IDs from `AppConfig` table for both role types and returns them.

**First seed `AppConfig` table with these rows:**

Engineering templates — `PartitionKey=templates`, `RowKey=engineering`:
```json
{
  "resumeTemplateId": "1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw",
  "portfolioTemplateId": "1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec",
  "coverLetterTemplateId": "1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0",
  "outputFolderId": "1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt"
}
```

Function accepts `{roleType: "Engineering"}` and `{roleType: "Product Management"}` and returns the matching template ID set for each.

**Pass:** Returns different non-empty template ID sets for each role type.
**Fail:** Missing template IDs, empty results, or table not seeded.

---

### MT-13 — Context loader
**Endpoint:** `POST /api/test/mt-13`
**Connection:** Azure

Function queries `MasterContext` table `PartitionKey=context`. Returns all fields. Verifies all required fields are present and non-empty.

**Required fields:** `resumeSummary`, `workHistory1`, `workHistory2`, `workHistory3`, `workHistory4`, `skills1`, `skills2`, `expertise`, `relevantProficiencies`, `aboutMe1`, `aboutMe2`, `executiveProfile`, `coreAccomplishments`, `softHardSkillsPool`, `itemsToOmit`

**Pass:** All required fields present and non-empty.
**Fail:** Table empty or fields missing.

**Important:** `MasterContext` table must be seeded with Von Ellis's baseline content before this test will pass. The content comes from the Zapier Storage nodes audited earlier in this project. Seed it as a separate step before running MT-13. Source content is in the project's session context — ask the user if you need the full baseline text.

---

### MT-14 — Agent call 1: resume package
**Endpoint:** `POST /api/test/mt-14`
**Connection:** OpenAI

**Prerequisite:** MT-09 (prompts seeded in table), MT-13 (master context seeded in table).

Function loads active `resume_system` prompt from `Prompts` table (`PartitionKey=resume_system`, `is_active=true`). Loads active `resume_user` prompt (`PartitionKey=resume_user`, `is_active=true`). Loads master context from `MasterContext` table. Injects the hardcoded fake JD (TechVenture Inc VP of Engineering). Calls OpenAI `gpt-4o-mini` with `max_tokens: 16000`. Parses response on `###` delimiter. Returns parsed sections.

**Pass:** Response splits into 14+ `###`-delimited sections. All key fields non-empty:
`date`, `targetRole`, `targetCompany`, `resumeSummary`, `skills1`, `skills2`, `expertise`, `relevant1`, `relevant2`, `relevant3`, `coverLetter`, `aboutMe1`, `aboutMe2`, `executiveProfile`, `coreAccomplishments`

**Fail:** Fewer than 14 sections, or any key field empty — log which sections are missing.
**Timeout:** This call may take 20–40s. Normal.

---

### MT-15 — Agent call 2: portfolio + cold email
**Endpoint:** `POST /api/test/mt-15`
**Connection:** OpenAI

Function loads active `portfolio_system` and `portfolio_user` prompts from `Prompts` table. Uses hardcoded mock outputs from MT-14 (do not re-run MT-14 — use a static mock object). Calls `gpt-4o-mini` `max_tokens: 16000`. Returns parsed output.

**Pass:** All 5 fields present with approximately correct word counts:
- `aboutMe1` — 45–55 words
- `aboutMe2` — 70–85 words
- `executiveProfile` — 45–60 words
- `coverLetter` — 250–400 words
- `coldEmail` — non-empty, professional tone

**Fail:** Missing fields, or word counts significantly off — log which fields failed and their actual word count.

---

### MT-16 — Agent call 3: ATS QC + skills merge
**Endpoint:** `POST /api/test/mt-16`
**Connection:** OpenAI

Function loads active `ats_system` and `ats_user` prompts. Uses hardcoded mock outputs from MT-14 and MT-15. Calls `gpt-4o-mini` `max_tokens: 15500`. Returns parsed output.

**Pass:** All fields present:
- `finalSkills1` — non-empty, each item ≤30 chars
- `finalSkills2` — non-empty, each item ≤30 chars
- `finalRelevant1`, `finalRelevant2`, `finalRelevant3` — non-empty, each item ≤20 chars
- `updatedResumeSummary` — 50–65 words
- `jobscanQcTable` — non-empty string

**Fail:** Missing fields, or skill items exceed character limits — log offending items.

---

### MT-17 — Output package assembler
**Endpoint:** `POST /api/test/mt-17`
**Connection:** Internal (no external API)

Function accepts mock outputs from MT-14, MT-15, MT-16 as JSON body. Runs the assembler logic that merges them into one typed delivery package object. Returns the assembled package.

**Required output fields (all must be non-null):**

Resume fields: `ResumeSummary`, `SkillsBullets1`, `SkillsBullets2`, `ExpertiseBullets`, `WorkHistoryBullets1`, `WorkHistoryBullets2`, `WorkHistoryBullets3`, `WorkHistoryBullets4`, `RelevantBullets1`, `RelevantBullets2`, `RelevantBullets3`

Portfolio fields: `@Company`, `@CoverLetterDate`, `@CoverLetterBody`, `@AboutMe1_50words`, `@AboutMe2_60words`, `@ExecutiveProfile_55words`, `@CoreAccomplishments_5blts_180words`

Other: `coldEmail`, `targetRole`, `targetCompany`, `date`

**Pass:** All fields present and non-null.
**Fail:** Any required field null or missing — log which fields failed.

---

### MT-18 — Full resume doc end-to-end
**Endpoint:** `POST /api/test/mt-18`
**Connection:** OpenAI + Google

Function chains: MT-14 agent call → MT-17 assembler → MT-05 template population. Uses fake JD as input. Returns completed Google Doc URL.

**Pass:** Doc URL returned. Open it manually — all placeholders replaced with real AI-generated content, no `{{` visible anywhere.
**Fail:** Any placeholder still visible, or doc URL not returned.
**Timeout:** Set `functionTimeout: "00:05:00"` in `host.json` — this function takes 30–90s.

---

### MT-19 — All 4 documents end-to-end
**Endpoint:** `POST /api/test/mt-19`
**Connection:** OpenAI + Google

Function runs all 3 agent calls → assembler → populates all 4 templates. Returns all 4 URLs.

**4 documents:**
1. Full resume (Google Doc) — template `1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw`
2. Compact/ATS resume (Google Doc) — template from role routing
3. Portfolio (Google Slides) — template `1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec`
4. Cover letter (Google Slides) — template `1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0`

**Pass:** 4 URLs returned. All 4 documents open without any visible placeholders. Correct AI-generated content in each.
**Fail:** Fewer than 4 URLs, or any placeholder still visible.
**Timeout:** `functionTimeout: "00:10:00"` — may take 60–120s.

---

### MT-20 — Job record log
**Endpoint:** `POST /api/test/mt-20`
**Connection:** Azure

Function writes a complete job record to `JobApplications` table:

```json
{
  "PartitionKey": "applications",
  "RowKey": "<UUID>",
  "JobTitle": "VP of Engineering",
  "Company": "TechVenture Inc",
  "RoleType": "Engineering",
  "Status": "complete",
  "FullResumeUrl": "https://docs.google.com/document/d/test",
  "PortfolioUrl": "https://docs.google.com/presentation/d/test",
  "CoverLetterUrl": "https://docs.google.com/presentation/d/test2",
  "ProcessedAt": "<ISO timestamp>"
}
```

Queries it back filtering by `Company eq 'TechVenture Inc'`. Returns the retrieved row.

**Pass:** Row written and retrieved with all fields intact.
**Fail:** Row not found or fields missing after write.

---

### MT-21 — Delivery email with all links
**Endpoint:** `POST /api/test/mt-21`
**Connection:** Microsoft

Function sends the full HTML delivery email via Microsoft Graph API using the same auth flow as MT-07.

**From:** `dev@enterpriseds.io`
**To:** `von.ellis@enterpriseds.io`
**Subject:** `Application Prep: TechVenture Inc - VP of Engineering [MT-21 TEST]`

**Email body must include (HTML formatted):**
- Links to all 4 documents (use hardcoded test URLs)
- Cold email draft section
- ATS analysis summary
- Before/after skills comparison

**Attachment:** Include the same minimal test PDF from MT-08.

**Pass:** Email arrives. All 4 document links are clickable. PDF attachment opens. HTML renders correctly.
**Fail:** Email not received, links broken, attachment missing — log the Graph API error response body.

---

### MT-22 — Full pipeline end-to-end
**This is the graduation test. Only run after MT-01 through MT-21 all pass.**

**Trigger:** Fire the fake job alert via the dev console job form or fake alert button.
**Approval gate:** Console shows the pending job in the queue — user clicks Approve.
**Pipeline runs:** All 3 agent calls → 4 documents generated → job record logged → 2 emails sent (immediate application package + video placeholder).

**Pass:**
- Both emails arrive at von.ellis@enterpriseds.io
- All 4 document links in the email are clickable and open correctly
- Job record appears in `JobApplications` table with `Status=complete`
- No errors in Azure Function logs

---

## Prompts to seed in the Prompts table

Before MT-14, MT-15, and MT-16 will pass, the following prompt rows must exist in the `Prompts` table. Seed them via the Azure CLI or a seeding script.

Each row: `PartitionKey={prompt name}`, `RowKey=v001`, `is_active=true`, `version=1`

| PartitionKey | Content summary |
|---|---|
| `resume_system` | "You are an executive recruiter such as Andrew LaCivita, Linda Raynier, Madelinne Mann, or Marie Forleo. The goal is to create a tailored resume that will be appropriate for a top-level executive but also be attractive in order to stand out to executive recruiters from the crowd. The tailored resume should be optimized for ATS." |
| `resume_user` | The 14-section prompt producing date, role, company, summary, skills1/2, expertise, relevant1/2/3, cover letter, about me 1/2, exec profile, core accomplishments, ATS analysis tables, Jobscan extraction. Full prompt text to be provided by user — ask if needed. |
| `portfolio_system` | "You are a helpful assistant." |
| `portfolio_user` | Prompt for About Me 1/2, Executive Profile, Cover Letter refinement, Cold Email using Call 1 outputs. Full text to be provided by user — ask if needed. |
| `ats_system` | "You are a helpful assistant." |
| `ats_user` | Final skills QC merge, Jobscan table, summary validation, cold email finalization. Full text to be provided by user — ask if needed. |

---

## Project background

This platform replaces a 40-node Zapier workflow. When triggered by a job alert, it runs 3 OpenAI agent calls to generate tailored resume content, portfolio content, and ATS analysis — populates 4 Google Doc/Slides templates — and emails everything via Microsoft Graph. The dev console is the testing and management UI for the entire pipeline. All auth config, prompts, and job history live in Azure Table Storage.

The full pipeline flow:
```
Inbox Watcher / Job Form
  → Role Router (Azure Function)
  → Context Load (MasterContext table)
  → Prompt Load (Prompts table)
  → Agent Call 1: Resume Package (OpenAI gpt-4o-mini, 16k tokens)
  → Agent Call 2: Portfolio + Cold Email (OpenAI gpt-4o-mini, 16k tokens)
  → Agent Call 3: ATS QC + Skills Merge (OpenAI gpt-4o-mini, 15.5k tokens)
  → Generate 4 Documents (Google Docs API + Google Slides API)
  → Log Job Record (JobApplications table)
  → Deliver Email (Microsoft Graph API)
```

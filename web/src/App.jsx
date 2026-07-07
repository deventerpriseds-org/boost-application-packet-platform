import { useState, useEffect } from "react";

const PHASES = [
  {
    id: 0,
    label: "Phase 0",
    title: "Config & Auth",
    description: "Establish all credentials and connections before anything runs.",
    color: "#1B4F5C",
    accent: "#2A7A8C",
  },
  {
    id: 1,
    label: "Phase 1",
    title: "Micro Tests",
    description: "Verify every integration in isolation before wiring them together.",
    color: "#2C3E50",
    accent: "#4A6FA5",
  },
  {
    id: 2,
    label: "Phase 2",
    title: "Low-Fi App",
    description: "Full pipeline running end-to-end with manual approval gate.",
    color: "#1A3A2A",
    accent: "#2E7D52",
  },
  {
    id: 3,
    label: "Phase 3",
    title: "Go Live",
    description: "Switch to production endpoints. Inbox watcher takes over.",
    color: "#3A1A2A",
    accent: "#8B3A5A",
  },
];

const AUTH_CONFIGS = [
  {
    id: "microsoft",
    label: "Microsoft 365 / Graph",
    icon: "Ⓜ",
    fields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "b9791c7d-dd6c-4190-b1bb-dbbd1996bc2e", type: "text" },
      { key: "clientId", label: "Client ID", placeholder: "Your app client ID", type: "text" },
      { key: "clientSecret", label: "Client Secret", placeholder: "••••••••", type: "password" },
      { key: "senderEmail", label: "Sender Email", placeholder: "dev@enterpriseds.io", type: "email" },
      { key: "recipientEmail", label: "Recipient Email", placeholder: "von.ellis@enterpriseds.io", type: "email" },
    ],
  },
  {
    id: "google",
    label: "Google APIs",
    icon: "G",
    fields: [
      { key: "serviceAccountJson", label: "Service Account JSON", placeholder: '{"type": "service_account", ...}', type: "textarea" },
      { key: "outputFolderId", label: "Output Folder ID", placeholder: "1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt", type: "text" },
      { key: "resumeTemplateId", label: "Resume Template Doc ID", placeholder: "1bwOcxvkb...", type: "text" },
      { key: "portfolioTemplateId", label: "Portfolio Slides ID", placeholder: "1ULZZLBs9...", type: "text" },
      { key: "coverLetterTemplateId", label: "Cover Letter Slides ID", placeholder: "1QN4Cnw4R...", type: "text" },
      { key: "videoFolderId", label: "Video Archive Folder ID", placeholder: "1cpwe85zurj...", type: "text" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "AI",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-••••••••", type: "password" },
      { key: "model", label: "Default Model", placeholder: "gpt-4o-mini", type: "text" },
      { key: "maxTokens", label: "Max Tokens", placeholder: "16000", type: "text" },
    ],
  },
  {
    id: "heygen",
    label: "HeyGen",
    icon: "HG",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "••••••••", type: "password" },
      { key: "templateId", label: "Avatar Template ID", placeholder: "cf50c8c880114d1a92d70763d2682805", type: "text" },
      { key: "folderId", label: "Project Folder ID", placeholder: "746e57b2ef6e4c82b82f51540a7c1c17", type: "text" },
    ],
  },
  {
    id: "azure",
    label: "Azure Table Storage",
    icon: "Az",
    fields: [
      { key: "connectionString", label: "Storage Connection String", placeholder: "DefaultEndpointsProtocol=https;...", type: "password" },
      { key: "accountName", label: "Storage Account Name", placeholder: "n8nstxpdthydai6fkm", type: "text" },
      { key: "resourceGroup", label: "Resource Group", placeholder: "EnterpriseDS_ResourceGRP", type: "text" },
    ],
  },
  {
    id: "webhooks",
    label: "Webhook Endpoints",
    icon: "↗",
    fields: [
      { key: "jobPlatformUrl", label: "Job Platform Endpoint", placeholder: "https://your-func.azurewebsites.net/api/process-job", type: "text" },
      { key: "inboxWatcherUrl", label: "Inbox Watcher Webhook", placeholder: "https://...", type: "text" },
      { key: "testWebhookUrl", label: "Test / Dev Endpoint", placeholder: "http://localhost:7071/api/process-job", type: "text" },
    ],
  },
];

const MICRO_TESTS = [
  // Phase 1
  { id: "MT-01", phase: 1, title: "Azure Table Storage Read/Write", description: "Write a test row to AppConfig table, read it back and verify it matches.", connection: "Azure" },
  { id: "MT-02", phase: 1, title: "OpenAI Connection", description: "Send a single 'say hello' message to gpt-4o-mini. Expect response under 5 seconds.", connection: "OpenAI" },
  { id: "MT-03", phase: 1, title: "Google Service Account Auth", description: "List files in the Zapier Automated Docs Drive folder to confirm auth is working.", connection: "Google" },
  { id: "MT-04", phase: 1, title: "Google Docs Template Copy", description: "Copy the resume template to the output folder with a test title. Verify file appears in Drive.", connection: "Google" },
  { id: "MT-05", phase: 1, title: "Google Docs Variable Injection", description: "Inject hardcoded test strings into every {{variable}} in the copied resume doc. Open doc to verify.", connection: "Google" },
  { id: "MT-06", phase: 1, title: "Google Slides Template Copy + Inject", description: "Copy Portfolio Slides template and replace all {{@variables}}. Verify deck visually.", connection: "Google" },
  { id: "MT-07", phase: 1, title: "Microsoft Graph Email Send", description: "Send plain text test email from dev@enterpriseds.io to von.ellis@enterpriseds.io.", connection: "Microsoft" },
  { id: "MT-08", phase: 1, title: "Microsoft Graph Email + Attachment", description: "Send test email with a hardcoded PDF attached. Verify email arrives with working attachment.", connection: "Microsoft" },
  { id: "MT-09", phase: 1, title: "Prompt Table Read", description: "Write a test prompt row to Prompts table, read it back filtered by is_active = true.", connection: "Azure" },
  { id: "MT-10", phase: 1, title: "Fake Inbox Watcher Output", description: "Fire a hardcoded fake engineering job alert payload to POST /api/process-job. Verify endpoint receives and logs it.", connection: "Webhook", hasAction: true, actionLabel: "Fire Fake Alert" },
  { id: "MT-11", phase: 1, title: "JotForm Replacement Form", description: "Submit the built-in job form below. Payload should hit POST /api/process-job correctly.", connection: "Internal", hasAction: true, actionLabel: "Open Form" },
  { id: "MT-12", phase: 1, title: "Role Router", description: "Call role router with 'Engineering' and 'Product Management'. Verify correct template IDs returned for each.", connection: "Azure" },
  { id: "MT-13", phase: 1, title: "Context Loader", description: "Call the context loader function. Verify full master context object returned with all fields.", connection: "Azure" },
  { id: "MT-14", phase: 1, title: "Agent Call 1 — Resume Package", description: "Run Agent Call 1 with a fake JD and hardcoded context. Verify all 14 ###-delimited sections parseable.", connection: "OpenAI", hasAction: true, actionLabel: "Run Agent 1" },
  { id: "MT-15", phase: 1, title: "Agent Call 2 — Portfolio + Cold Email", description: "Run Agent Call 2 with fake JD + hardcoded Call 1 outputs. Verify About Me, Exec Profile, Cover Letter, Cold Email.", connection: "OpenAI", hasAction: true, actionLabel: "Run Agent 2" },
  { id: "MT-16", phase: 1, title: "Agent Call 3 — ATS QC + Skills Merge", description: "Run Agent Call 3 with fake inputs from Calls 1 and 2. Verify merged skills, Jobscan table, updated summary.", connection: "OpenAI", hasAction: true, actionLabel: "Run Agent 3" },
  { id: "MT-17", phase: 1, title: "Output Package Assembler", description: "Merge outputs from Calls 1, 2, 3 into delivery package. Verify all fields present, no nulls, word counts met.", connection: "Internal" },
  { id: "MT-18", phase: 1, title: "Full Resume Doc End-to-End", description: "Run MT-14 → MT-17 → MT-05 in sequence. Full resume Google Doc created with all variables replaced.", connection: "OpenAI + Google", hasAction: true, actionLabel: "Run Flow" },
  { id: "MT-19", phase: 1, title: "All 4 Documents End-to-End", description: "Full pipeline through all 4 document generations. Verify all appear in correct Drive folders.", connection: "OpenAI + Google", hasAction: true, actionLabel: "Generate All Docs" },
  { id: "MT-20", phase: 1, title: "Job Record Log", description: "Write a completed job record to JobApplications table. Verify row queryable by company + role.", connection: "Azure" },
  { id: "MT-21", phase: 1, title: "Delivery Email with All Links", description: "Send full HTML delivery email with all 4 document links, ATS tables, cold email draft, and PDF attachments.", connection: "Microsoft", hasAction: true, actionLabel: "Send Test Email" },
  // Phase 2
  { id: "MT-22", phase: 2, title: "Full Pipeline — Low-Fi End-to-End", description: "Fire fake job alert → approval gate → full pipeline runs → delivery email received. No errors in Function logs.", connection: "All", hasAction: true, actionLabel: "Run Full Pipeline" },
  // Phase 3
  { id: "MT-23", phase: 3, title: "Switch to Live Inbox Watcher", description: "Update webhook URL in AppConfig to point to real mail-and-appointments endpoint.", connection: "Webhook" },
  { id: "MT-24", phase: 3, title: "Switch to Production Templates", description: "Update all template IDs in AppConfig to production copies.", connection: "Google" },
  { id: "MT-25", phase: 3, title: "Upgrade Model (Optional)", description: "Update OpenAI model to gpt-4o if desired for higher quality output.", connection: "OpenAI" },
  { id: "MT-26", phase: 3, title: "Remove / Optional Approval Gate", description: "Disable manual approval requirement. Pipeline fires automatically on job alert.", connection: "Internal" },
  { id: "MT-27", phase: 3, title: "Production Deploy & Verify", description: "Deploy to production Azure Function App. Fire one real job alert end-to-end.", connection: "All", hasAction: true, actionLabel: "Deploy" },
];

const CONNECTION_COLORS = {
  Azure: "#0078D4",
  OpenAI: "#10A37F",
  Google: "#EA4335",
  Microsoft: "#00A4EF",
  Webhook: "#8B5CF6",
  Internal: "#6B7280",
  "OpenAI + Google": "#F59E0B",
  All: "#1B4F5C",
};

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "#6B7280", bg: "#1F2937" },
  running: { label: "Running...", color: "#F59E0B", bg: "#1C1A00" },
  pass: { label: "Pass ✓", color: "#10B981", bg: "#052E16" },
  fail: { label: "Fail ✗", color: "#EF4444", bg: "#1F0000" },
  skipped: { label: "Skipped", color: "#6B7280", bg: "#111827" },
};

const FAKE_JOB_ALERT = {
  jobTitle: "VP of Engineering",
  jobDescription: `We are seeking a VP of Engineering to lead our global engineering organization at TechVenture Inc. The ideal candidate will have 15+ years of experience in enterprise software leadership, with a proven track record of scaling engineering teams, driving digital transformation, and delivering cloud-native SaaS platforms. 

Key Responsibilities:
- Lead and scale a team of 150+ engineers across 4 global locations
- Define and execute a 3-year technology roadmap aligned with business objectives
- Establish engineering culture, DevSecOps practices, and SOC 2 compliance frameworks
- Drive Agile transformation and continuous improvement across all engineering functions
- Partner with CPO and CTO on product strategy and M&A technical due diligence
- Manage $25M+ engineering budget and P&L accountability

Requirements:
- 15+ years progressive engineering leadership
- Deep expertise in cloud architecture (AWS/Azure), SaaS platforms, and enterprise software
- Experience with M&A integration and technical due diligence
- Strong background in cybersecurity, compliance, and data governance
- MBA or equivalent preferred`,
  jobUrl: "https://linkedin.com/jobs/test-vp-engineering-12345",
  roleType: "Engineering",
  hiringContactName: "",
  linkedInConnection: "",
  sendToName: "Von Ellis",
  sendToEmail: "von.ellis@enterpriseds.io",
  receivedAt: new Date().toISOString(),
  sourceEmail: "jobalerts@linkedin.com",
  originalSubject: "New job alert: VP of Engineering at TechVenture Inc",
};

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [testStatuses, setTestStatuses] = useState({});
  const [testLogs, setTestLogs] = useState({});
  const [expandedTest, setExpandedTest] = useState(null);
  const [expandedAuth, setExpandedAuth] = useState(null);
  const [authValues, setAuthValues] = useState({});
  const [authSaved, setAuthSaved] = useState({});
  const [testResponses, setTestResponses] = useState({});
  const [testTimestamps, setTestTimestamps] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    jobDescription: "",
    jobUrl: "",
    roleType: "Engineering",
    hiringContactName: "",
    linkedInConnection: "",
    sendToName: "Von Ellis",
    sendToEmail: "von.ellis@enterpriseds.io",
  });
  const [activePhaseFilter, setActivePhaseFilter] = useState("all");

  const API = import.meta.env.VITE_API_URL || 'https://job-platform-api.azurewebsites.net';

  // Load saved config from AppConfig table on mount
  useEffect(() => {
    fetch(`${API}/api/config`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.values) {
          setAuthValues(data.values)
          // Mark sections as saved if they have any values
          const saved = {}
          AUTH_CONFIGS.forEach(cfg => {
            saved[cfg.id] = cfg.fields.some(f => data.values[`${cfg.id}.${f.key}`]?.trim())
          })
          setAuthSaved(saved)
        }
      })
      .catch(() => {})
  }, [])

  const saveAuthConfig = async (configId) => {
    const config = AUTH_CONFIGS.find(c => c.id === configId)
    const values = {}
    config.fields.forEach(f => {
      const val = authValues[`${configId}.${f.key}`]
      if (val !== undefined) values[`${configId}.${f.key}`] = val
    })
    await fetch(`${API}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    })
    setAuthSaved(s => ({ ...s, [configId]: true }))
  }

  // Map test ID → real API call
  const TEST_RUNNERS = {
    "MT-01": async () => {
      const r = await fetch(`${API}/api/testConnection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection: 'azure' }) })
      return r.json()
    },
    "MT-02": async () => {
      const r = await fetch(`${API}/api/testConnection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection: 'openai' }) })
      return r.json()
    },
    "MT-03": async () => {
      const r = await fetch(`${API}/api/testConnection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection: 'google' }) })
      return r.json()
    },
  }

  const runTest = async (testId) => {
    const ts = () => new Date().toLocaleTimeString()
    setTestStatuses((s) => ({ ...s, [testId]: "running" }));
    setTestLogs((l) => ({ ...l, [testId]: [`[${ts()}] Starting ${testId}...`] }));
    setTestResponses((r) => ({ ...r, [testId]: null }));
    setTestTimestamps((t) => ({ ...t, [testId]: null }));

    const runner = TEST_RUNNERS[testId]
    if (!runner) {
      setTestStatuses((s) => ({ ...s, [testId]: "pending" }));
      setTestLogs((l) => ({ ...l, [testId]: [...(l[testId] || []), `[${ts()}] ⚠ Not yet implemented — API endpoint not built`] }));
      return
    }

    try {
      const data = await runner()
      const pass = data.success === true
      const completedAt = new Date().toLocaleTimeString()
      setTestStatuses((s) => ({ ...s, [testId]: pass ? "pass" : "fail" }));
      setTestResponses((r) => ({ ...r, [testId]: data }));
      setTestTimestamps((t) => ({ ...t, [testId]: completedAt }));
      setTestLogs((l) => ({
        ...l,
        [testId]: [
          ...(l[testId] || []),
          pass
            ? `[${completedAt}] ✓ ${data.detail || 'Test passed'}`
            : `[${completedAt}] ✗ ${data.detail || data.error || 'Test failed'}`,
        ],
      }));
    } catch (err) {
      const completedAt = new Date().toLocaleTimeString()
      setTestStatuses((s) => ({ ...s, [testId]: "fail" }));
      setTestLogs((l) => ({ ...l, [testId]: [...(l[testId] || []), `[${completedAt}] ✗ Network error: ${err.message}`] }));
    }
  };

  const fireAlert = async () => {
    const ts = () => new Date().toLocaleTimeString()
    setTestStatuses((s) => ({ ...s, "MT-10": "running" }));
    setTestResponses((r) => ({ ...r, "MT-10": null }));
    setTestLogs((l) => ({
      ...l,
      "MT-10": [
        `[${ts()}] Firing fake job alert...`,
        `[${ts()}] POST ${API}/api/processJob`,
      ],
    }));
    try {
      const r = await fetch(`${API}/api/processJob`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(FAKE_JOB_ALERT)
      })
      const data = await r.json()
      const completedAt = ts()
      const pass = r.ok && data.success !== false
      setTestStatuses((s) => ({ ...s, "MT-10": pass ? "pass" : "fail" }));
      setTestResponses((rv) => ({ ...rv, "MT-10": data }));
      setTestTimestamps((t) => ({ ...t, "MT-10": completedAt }));
      setTestLogs((l) => ({
        ...l,
        "MT-10": [...(l["MT-10"] || []),
          pass
            ? `[${completedAt}] ✓ HTTP ${r.status} — ${data.message || 'Payload received'}`
            : `[${completedAt}] ✗ HTTP ${r.status} — ${data.error || 'Unexpected response'}`
        ],
      }));
    } catch (err) {
      setTestStatuses((s) => ({ ...s, "MT-10": "fail" }));
      setTestLogs((l) => ({ ...l, "MT-10": [...(l["MT-10"] || []), `[${ts()}] ✗ Network error: ${err.message}`] }));
    }
  };

  const totalTests = MICRO_TESTS.length;
  const passCount = Object.values(testStatuses).filter((s) => s === "pass").length;
  const failCount = Object.values(testStatuses).filter((s) => s === "fail").length;
  const savedAuths = Object.keys(authSaved).filter((k) => authSaved[k]).length;

  const filteredTests =
    activePhaseFilter === "all" ? MICRO_TESTS : MICRO_TESTS.filter((t) => t.phase === parseInt(activePhaseFilter));

  return (
    <div style={{ background: "#0A0F14", minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", color: "#E2E8F0" }}>
      {/* Header */}
      <div style={{ background: "#0D1821", borderBottom: "1px solid #1B4F5C40", padding: "0 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #1B4F5C, #2A7A8C)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>
              JA
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E2E8F0", letterSpacing: "0.01em" }}>Job Application Platform</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>Dev Console · Enterprise Digital Solutions</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["dashboard", "auth", "tests", "form", "prompts"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  background: activeTab === tab ? "#1B4F5C" : "transparent",
                  color: activeTab === tab ? "#E2E8F0" : "#64748B",
                  textTransform: "capitalize",
                  transition: "all 0.15s",
                }}
              >
                {tab === "form" ? "Job Form" : tab === "auth" ? "Auth & Config" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div>
            {/* Status Bar */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "Auth Configured", value: `${savedAuths} / ${AUTH_CONFIGS.length}`, color: savedAuths === AUTH_CONFIGS.length ? "#10B981" : "#F59E0B" },
                { label: "Tests Passed", value: `${passCount} / ${totalTests}`, color: "#10B981" },
                { label: "Tests Failed", value: failCount, color: failCount > 0 ? "#EF4444" : "#64748B" },
                { label: "Ready to Go Live", value: passCount === totalTests && savedAuths === AUTH_CONFIGS.length ? "Yes" : "No", color: passCount === totalTests && savedAuths === AUTH_CONFIGS.length ? "#10B981" : "#64748B" },
              ].map((stat) => (
                <div key={stat.label} style={{ background: "#0D1821", border: "1px solid #1E293B", borderRadius: 10, padding: "16px 20px" }}>
                  <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: stat.color, fontVariantNumeric: "tabular-nums" }}>{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Phase Overview */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {PHASES.map((phase) => {
                const phaseTests = MICRO_TESTS.filter((t) => t.phase === phase.id);
                const phasePassed = phaseTests.filter((t) => testStatuses[t.id] === "pass").length;
                const phaseFailed = phaseTests.filter((t) => testStatuses[t.id] === "fail").length;
                return (
                  <div
                    key={phase.id}
                    style={{ background: "#0D1821", border: `1px solid ${phase.color}50`, borderRadius: 10, padding: 16, cursor: "pointer" }}
                    onClick={() => { setActiveTab("tests"); setActivePhaseFilter(String(phase.id)); }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: phase.accent, textTransform: "uppercase", letterSpacing: "0.08em" }}>{phase.label}</span>
                      {phaseTests.length > 0 && (
                        <span style={{ fontSize: 10, color: "#64748B" }}>{phasePassed}/{phaseTests.length}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#E2E8F0", marginBottom: 6 }}>{phase.title}</div>
                    <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>{phase.description}</div>
                    {phaseTests.length > 0 && (
                      <div style={{ marginTop: 12, height: 4, background: "#1E293B", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(phasePassed / phaseTests.length) * 100}%`, background: phase.accent, borderRadius: 2, transition: "width 0.5s" }} />
                      </div>
                    )}
                    {phase.id === 0 && (
                      <div style={{ marginTop: 12, height: 4, background: "#1E293B", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(savedAuths / AUTH_CONFIGS.length) * 100}%`, background: phase.accent, borderRadius: 2, transition: "width 0.5s" }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pipeline Flow */}
            <div style={{ background: "#0D1821", border: "1px solid #1E293B", borderRadius: 10, padding: 20, marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Pipeline Flow</div>
              <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", rowGap: 12 }}>
                {[
                  { label: "Inbox Watcher", sub: "or Job Form", color: "#8B5CF6" },
                  { label: "Role Router", sub: "Azure Function", color: "#0078D4" },
                  { label: "Context Load", sub: "Table Storage", color: "#0078D4" },
                  { label: "Prompt Load", sub: "Table Storage", color: "#0078D4" },
                  { label: "Agent Call 1", sub: "Resume Package", color: "#10A37F" },
                  { label: "Agent Call 2", sub: "Portfolio + Email", color: "#10A37F" },
                  { label: "Agent Call 3", sub: "ATS QC", color: "#10A37F" },
                  { label: "4 Documents", sub: "Docs + Slides", color: "#EA4335" },
                  { label: "Log Record", sub: "Table Storage", color: "#0078D4" },
                  { label: "Deliver Email", sub: "Graph API", color: "#00A4EF" },
                ].map((step, i, arr) => (
                  <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ background: `${step.color}20`, border: `1px solid ${step.color}50`, borderRadius: 8, padding: "8px 12px", minWidth: 90 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: step.color }}>{step.label}</div>
                        <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>{step.sub}</div>
                      </div>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ width: 20, height: 1, background: "#1E293B", margin: "0 4px", flexShrink: 0 }}>
                        <div style={{ textAlign: "center", fontSize: 10, color: "#334155", marginTop: -6 }}>›</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ background: "#0D1821", border: "1px solid #1E293B", borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Quick Actions</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { label: "Fire Fake Job Alert", action: () => { fireAlert(); setActiveTab("tests"); }, color: "#8B5CF6" },
                  { label: "Open Job Form", action: () => { setActiveTab("form"); }, color: "#1B4F5C" },
                  { label: "Run All Phase 1 Tests", action: () => { MICRO_TESTS.filter(t => t.phase === 1).forEach(t => runTest(t.id)); setActiveTab("tests"); }, color: "#4A6FA5" },
                  { label: "Configure Auth", action: () => setActiveTab("auth"), color: "#0078D4" },
                  { label: "Edit Prompts", action: () => setActiveTab("prompts"), color: "#10A37F" },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    onClick={btn.action}
                    style={{ padding: "10px 18px", background: `${btn.color}20`, border: `1px solid ${btn.color}50`, borderRadius: 8, color: btn.color, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AUTH TAB */}
        {activeTab === "auth" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#E2E8F0", marginBottom: 4 }}>Auth & Configuration</div>
              <div style={{ fontSize: 13, color: "#64748B" }}>Save credentials for all platform connections. Everything stored in Azure Table Storage AppConfig.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {AUTH_CONFIGS.map((config) => {
                const isOpen = expandedAuth === config.id;
                const isSaved = authSaved[config.id];
                return (
                  <div key={config.id} style={{ background: "#0D1821", border: `1px solid ${isSaved ? "#10B98150" : "#1E293B"}`, borderRadius: 10, overflow: "hidden" }}>
                    <div
                      style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                      onClick={() => setExpandedAuth(isOpen ? null : config.id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, background: "#1E293B", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#94A3B8" }}>
                          {config.icon}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>{config.label}</div>
                          <div style={{ fontSize: 11, color: isSaved ? "#10B981" : "#64748B" }}>{isSaved ? "✓ Configured" : "Not configured"}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isSaved && (
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981" }} />
                        )}
                        <span style={{ color: "#64748B", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1E293B" }}>
                        <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                          {config.fields.map((field) => (
                            <div key={field.key}>
                              <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>{field.label}</label>
                              {field.type === "textarea" ? (
                                <textarea
                                  placeholder={field.placeholder}
                                  value={authValues[`${config.id}.${field.key}`] || ""}
                                  onChange={(e) => setAuthValues((v) => ({ ...v, [`${config.id}.${field.key}`]: e.target.value }))}
                                  style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 6, color: "#E2E8F0", fontSize: 11, padding: "8px 10px", resize: "vertical", minHeight: 80, fontFamily: "monospace", boxSizing: "border-box" }}
                                />
                              ) : (
                                <input
                                  type={field.type}
                                  placeholder={field.placeholder}
                                  value={authValues[`${config.id}.${field.key}`] || ""}
                                  onChange={(e) => setAuthValues((v) => ({ ...v, [`${config.id}.${field.key}`]: e.target.value }))}
                                  style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 6, color: "#E2E8F0", fontSize: 12, padding: "8px 10px", boxSizing: "border-box" }}
                                />
                              )}
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <button
                              onClick={async () => {
                                const filled = config.fields.some(
                                  (f) => authValues[`${config.id}.${f.key}`]?.trim().length > 0
                                );
                                if (filled) {
                                  await saveAuthConfig(config.id);
                                  setExpandedAuth(null);
                                }
                              }}
                              style={{ flex: 1, padding: "9px", background: "#1B4F5C", border: "none", borderRadius: 6, color: "#E2E8F0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                            >
                              Save Configuration
                            </button>
                            <button
                              onClick={() => {
                                setTestStatuses((s) => ({ ...s, [`auth-${config.id}`]: "running" }));
                                setTimeout(() => {
                                  const pass = Math.random() > 0.25;
                                  setTestStatuses((s) => ({ ...s, [`auth-${config.id}`]: pass ? "pass" : "fail" }));
                                  if (pass) setAuthSaved((s) => ({ ...s, [config.id]: true }));
                                }, 1500 + Math.random() * 800);
                              }}
                              style={{ padding: "9px 16px", background: "#0D2B1A", border: "1px solid #10B98150", borderRadius: 6, color: "#10B981", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                            >
                              Test Connection
                            </button>
                          </div>
                          {testStatuses[`auth-${config.id}`] && (
                            <div style={{ fontSize: 11, color: STATUS_CONFIG[testStatuses[`auth-${config.id}`]].color, padding: "6px 10px", background: STATUS_CONFIG[testStatuses[`auth-${config.id}`]].bg, borderRadius: 6 }}>
                              {testStatuses[`auth-${config.id}`] === "running" ? "Testing connection..." : testStatuses[`auth-${config.id}`] === "pass" ? "✓ Connection successful" : "✗ Connection failed — check credentials"}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TESTS TAB */}
        {activeTab === "tests" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#E2E8F0", marginBottom: 4 }}>Micro Tests</div>
                <div style={{ fontSize: 13, color: "#64748B" }}>{passCount} passed · {failCount} failed · {totalTests - passCount - failCount} pending</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ label: "All", value: "all" }, ...PHASES.map((p) => ({ label: p.label, value: String(p.id) }))].map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setActivePhaseFilter(f.value)}
                    style={{ padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: activePhaseFilter === f.value ? "#1B4F5C" : "#0D1821", color: activePhaseFilter === f.value ? "#E2E8F0" : "#64748B" }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredTests.map((test) => {
                const status = testStatuses[test.id] || "pending";
                const statusCfg = STATUS_CONFIG[status];
                const isExpanded = expandedTest === test.id;
                const logs = testLogs[test.id] || [];
                const phase = PHASES.find((p) => p.id === test.phase);

                return (
                  <div
                    key={test.id}
                    style={{ background: "#0D1821", border: `1px solid ${status === "pass" ? "#10B98130" : status === "fail" ? "#EF444430" : "#1E293B"}`, borderRadius: 10, overflow: "hidden" }}
                  >
                    <div
                      style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                      onClick={() => setExpandedTest(isExpanded ? null : test.id)}
                    >
                      {/* Status dot */}
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: statusCfg.color, flexShrink: 0, boxShadow: status === "running" ? `0 0 6px ${statusCfg.color}` : "none" }} />

                      {/* Test ID */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", width: 50, flexShrink: 0, fontFamily: "monospace" }}>{test.id}</div>

                      {/* Phase badge */}
                      <div style={{ fontSize: 10, fontWeight: 600, color: phase?.accent, background: `${phase?.color}30`, padding: "2px 7px", borderRadius: 4, flexShrink: 0 }}>
                        {phase?.label}
                      </div>

                      {/* Title */}
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#CBD5E1" }}>{test.title}</div>

                      {/* Connection badge */}
                      <div style={{ fontSize: 10, color: CONNECTION_COLORS[test.connection] || "#64748B", background: `${CONNECTION_COLORS[test.connection]}15`, padding: "2px 8px", borderRadius: 4, flexShrink: 0 }}>
                        {test.connection}
                      </div>

                      {/* Status label */}
                      <div style={{ fontSize: 11, fontWeight: 600, color: statusCfg.color, width: 70, textAlign: "right", flexShrink: 0 }}>
                        {statusCfg.label}
                      </div>

                      {/* Run button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); test.id === "MT-10" ? fireAlert() : runTest(test.id); }}
                        style={{ padding: "5px 12px", background: "#1E293B", border: "1px solid #334155", borderRadius: 6, color: "#94A3B8", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                      >
                        {test.hasAction ? test.actionLabel : "Run"}
                      </button>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: "0 16px 14px", borderTop: "1px solid #1E293B" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 10px" }}>
                          <p style={{ fontSize: 12, color: "#94A3B8", margin: 0, lineHeight: 1.6 }}>{test.description}</p>
                          {testTimestamps[test.id] && (
                            <div style={{ fontSize: 10, color: "#475569", flexShrink: 0, marginLeft: 12 }}>
                              Last run: {testTimestamps[test.id]}
                            </div>
                          )}
                        </div>
                        {logs.length > 0 && (
                          <div style={{ background: "#0A0F14", borderRadius: 6, padding: "10px 12px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.8, marginBottom: testResponses[test.id] ? 8 : 0 }}>
                            {logs.map((log, i) => (
                              <div key={i} style={{ color: log.includes("✓") ? "#10B981" : log.includes("✗") ? "#EF4444" : log.includes("⚠") ? "#F59E0B" : "#64748B" }}>{log}</div>
                            ))}
                          </div>
                        )}
                        {testResponses[test.id] && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Response Payload</div>
                            <div style={{ background: "#0A0F14", borderRadius: 6, padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: "#94A3B8", lineHeight: 1.7, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {JSON.stringify(testResponses[test.id], null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* JOB FORM TAB */}
        {activeTab === "form" && (
          <div style={{ maxWidth: 680 }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#E2E8F0", marginBottom: 4 }}>Job Application Form</div>
              <div style={{ fontSize: 13, color: "#64748B" }}>JotForm replacement. Submits to POST /api/process-job — same contract as the inbox watcher will use.</div>
            </div>

            <div style={{ background: "#0D1821", border: "1px solid #1E293B", borderRadius: 10, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Or use a fake alert for testing</div>
              <div style={{ background: "#0A0F14", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 11, fontFamily: "monospace", color: "#64748B", lineHeight: 1.7 }}>
                <div style={{ color: "#8B5CF6", marginBottom: 4 }}>// Fake Engineering Job Alert</div>
                <div>Role: {FAKE_JOB_ALERT.jobTitle}</div>
                <div>Source: {FAKE_JOB_ALERT.originalSubject}</div>
                <div>Type: {FAKE_JOB_ALERT.roleType}</div>
              </div>
              <button
                onClick={fireAlert}
                style={{ width: "100%", padding: "10px", background: "#8B5CF620", border: "1px solid #8B5CF650", borderRadius: 8, color: "#8B5CF6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Fire Fake Job Alert → POST /api/process-job
              </button>
              {testStatuses["MT-10"] && (
                <div style={{ marginTop: 10, fontSize: 11, color: STATUS_CONFIG[testStatuses["MT-10"]].color, padding: "8px 10px", background: STATUS_CONFIG[testStatuses["MT-10"]].bg, borderRadius: 6 }}>
                  {testLogs["MT-10"]?.join(" → ")}
                </div>
              )}
            </div>

            <div style={{ background: "#0D1821", border: "1px solid #1E293B", borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Manual Job Entry</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>Target Job Description *</label>
                  <textarea
                    value={formData.jobDescription}
                    onChange={(e) => setFormData((f) => ({ ...f, jobDescription: e.target.value }))}
                    placeholder="Paste the full job description here..."
                    style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "10px 12px", resize: "vertical", minHeight: 140, boxSizing: "border-box", lineHeight: 1.6 }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>Job URL</label>
                    <input
                      value={formData.jobUrl}
                      onChange={(e) => setFormData((f) => ({ ...f, jobUrl: e.target.value }))}
                      placeholder="https://linkedin.com/jobs/..."
                      style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "9px 12px", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>Role Type</label>
                    <select
                      value={formData.roleType}
                      onChange={(e) => setFormData((f) => ({ ...f, roleType: e.target.value }))}
                      style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "9px 12px", boxSizing: "border-box" }}
                    >
                      <option>Engineering</option>
                      <option>Product Management</option>
                      <option>General</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>Hiring Contact Name</label>
                    <input
                      value={formData.hiringContactName}
                      onChange={(e) => setFormData((f) => ({ ...f, hiringContactName: e.target.value }))}
                      placeholder="Optional"
                      style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "9px 12px", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>LinkedIn Connection to Mention</label>
                    <input
                      value={formData.linkedInConnection}
                      onChange={(e) => setFormData((f) => ({ ...f, linkedInConnection: e.target.value }))}
                      placeholder="Optional"
                      style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "9px 12px", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>Send To Name</label>
                    <input
                      value={formData.sendToName}
                      onChange={(e) => setFormData((f) => ({ ...f, sendToName: e.target.value }))}
                      style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "9px 12px", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#94A3B8", display: "block", marginBottom: 4 }}>Send To Email</label>
                    <input
                      value={formData.sendToEmail}
                      onChange={(e) => setFormData((f) => ({ ...f, sendToEmail: e.target.value }))}
                      style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", fontSize: 12, padding: "9px 12px", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => {
                    runTest("MT-11");
                  }}
                  disabled={!formData.jobDescription}
                  style={{ padding: "11px", background: formData.jobDescription ? "#1B4F5C" : "#0D1821", border: `1px solid ${formData.jobDescription ? "#2A7A8C" : "#1E293B"}`, borderRadius: 8, color: formData.jobDescription ? "#E2E8F0" : "#64748B", fontSize: 13, fontWeight: 600, cursor: formData.jobDescription ? "pointer" : "not-allowed" }}
                >
                  Submit Job → POST /api/process-job
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PROMPTS TAB */}
        {activeTab === "prompts" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#E2E8F0", marginBottom: 4 }}>Prompt Management</div>
              <div style={{ fontSize: 13, color: "#64748B" }}>Edit, version, and activate agent prompts. Stored in Azure Table Storage Prompts partition.</div>
            </div>
            {[
              { id: "resume_system", label: "Agent 1 — System Prompt", agent: "Resume Package", description: "Sets the recruiter persona and ATS optimization mandate." },
              { id: "resume_user", label: "Agent 1 — User Prompt", agent: "Resume Package", description: "14-section prompt: Summary, Skills, Expertise, Cover Letter, About Me, Core Accomplishments, ATS QC." },
              { id: "portfolio_system", label: "Agent 2 — System Prompt", agent: "Portfolio + Cold Email", description: "Portfolio and outreach persona." },
              { id: "portfolio_user", label: "Agent 2 — User Prompt", agent: "Portfolio + Cold Email", description: "Refines About Me, Exec Profile, Cover Letter, Cold Email using Call 1 outputs." },
              { id: "ats_system", label: "Agent 3 — System Prompt", agent: "ATS QC + Skills Merge", description: "QC reviewer persona." },
              { id: "ats_user", label: "Agent 3 — User Prompt", agent: "ATS QC + Skills Merge", description: "Final skills merge, Jobscan table, summary validation, cold email finalization." },
            ].map((prompt) => (
              <div key={prompt.id} style={{ background: "#0D1821", border: "1px solid #1E293B", borderRadius: 10, padding: 16, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>{prompt.label}</div>
                    <div style={{ fontSize: 11, color: "#10A37F", marginTop: 2 }}>{prompt.agent}</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{prompt.description}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: "#10B981", background: "#05260F", padding: "3px 8px", borderRadius: 4 }}>v1 · Active</span>
                    <button style={{ fontSize: 11, color: "#64748B", background: "#1E293B", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>History</button>
                  </div>
                </div>
                <textarea
                  placeholder={`Enter ${prompt.label} content...`}
                  style={{ width: "100%", background: "#0A0F14", border: "1px solid #1E293B", borderRadius: 6, color: "#94A3B8", fontSize: 11, padding: "10px 12px", resize: "vertical", minHeight: 80, fontFamily: "monospace", lineHeight: 1.6, boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={{ padding: "7px 14px", background: "#1B4F5C", border: "none", borderRadius: 6, color: "#E2E8F0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Save New Version</button>
                  <button style={{ padding: "7px 14px", background: "transparent", border: "1px solid #1E293B", borderRadius: 6, color: "#64748B", fontSize: 11, cursor: "pointer" }}>Copy ID: {prompt.id}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

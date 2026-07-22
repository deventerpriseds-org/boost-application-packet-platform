// API client for the Executive Engine service layer (Azure Functions).
// Reads from boost_resume_n_packet_builder via the app/* endpoints.
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'https://job-platform-api.azurewebsites.net/api'

// Active data owner (set from auth). Owner-scoped reads default to this so each
// signed-in user sees only their own opportunities/packets/outreach.
let _owner = 'demo@executive-engine.local'
export function setOwner(o) { _owner = o || 'demo@executive-engine.local' }
export function getOwner() { return _owner }
// Server-verified session token (minted at sign-in). Sent as a Bearer header so
// the API derives the trusted owner server-side instead of a client-asserted one.
let _session = (() => { try { return localStorage.getItem('ee_session') || null } catch { return null } })()
export function setSessionToken(t) { _session = t || null; try { t ? localStorage.setItem('ee_session', t) : localStorage.removeItem('ee_session') } catch {} }
export function getSessionToken() { return _session }
function authHeaders(extra) { return _session ? { ...(extra || {}), Authorization: `Bearer ${_session}` } : (extra || {}) }
// Whether owner-scoped reads include demo/sample (is_demo) rows.
let _includeDemo = (() => { try { return localStorage.getItem('ee_show_demo') !== 'false' } catch { return true } })()
export function setIncludeDemo(v) { _includeDemo = !!v }
const demoParam = () => (_includeDemo ? '' : '&includeDemo=false')

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}
async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return res.json()
}

async function patch_(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) throw new Error(`PATCH ${path} → HTTP ${res.status}`)
  return res.json()
}
async function del(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(`DELETE ${path} → HTTP ${res.status}`)
  return res.json()
}

export const api = {
  listOpportunities: ({ owner, persona, stage } = {}) => {
    const qs = new URLSearchParams()
    qs.set('owner', owner || _owner)
    if (persona) qs.set('persona', persona)
    if (stage) qs.set('stage', stage)
    const q = qs.toString()
    return get(`/app/opportunities?${q}${demoParam()}`)
  },
  getOpportunity: (id) => get(`/app/opportunity/${id}`),
  todayMetrics: ({ owner } = {}) => get(`/app/metrics/today?owner=${encodeURIComponent(owner || _owner)}${demoParam()}`),
  moveStage: (id, stage) => post(`/app/opportunity/${id}/stage`, { stage }),
  dismiss: (id) => post(`/app/opportunity/${id}/dismiss`, {}),
  // Packets / artifacts (production line)
  listPackets: ({ owner } = {}) => get(`/app/packets?owner=${encodeURIComponent(owner || _owner)}${demoParam()}`),
  getPacket: (oppId) => get(`/app/opportunity/${oppId}/packet`),
  analyzeJd: (oppId) => post(`/app/opportunity/${oppId}/jd-analysis`, {}),
  parseJd: (oppId) => post(`/app/opportunity/${oppId}/jd-parse`, {}),
  jdStatus: () => get('/app/opportunities/jd-status'),
  enrichOpportunity: (oppId) => post(`/app/opportunity/${oppId}/enrich`, {}),
  matchScore: (oppId) => post(`/app/opportunity/${oppId}/match-score`, {}),
  applyPrepare: (oppId, opts = {}) => post(`/app/opportunity/${oppId}/apply/prepare`, opts),
  buildFullPacket: (oppId, opts = {}) => post(`/app/opportunity/${oppId}/packet/build-all`, opts),
  bulkRun: (opts = {}) => post(`/app/bulk/packets`, opts),
  bulkStatus: (jobId) => get(`/app/bulk/${jobId}`),
  appHealth: () => get(`/app/health`),
  appSelftest: () => get(`/app/selftest`),
  atsSources: () => get(`/app/ats/sources`),
  atsSourceAdd: (provider, board) => post(`/app/ats/sources`, { provider, board }),
  atsSourceDelete: (id) => post(`/app/ats/sources/delete`, { id }),
  atsPreview: (provider, board) => post(`/app/ats/preview`, { provider, board }),
  atsIngest: (opts = {}) => post(`/app/ats/ingest`, opts),
  generateArtifact: (artifactId) => post(`/app/artifact/${artifactId}/generate`, {}),
  setArtifactStatus: (artifactId, status) => post(`/app/artifact/${artifactId}/status`, { status }),
  generateArtifactDocument: (artifactId) => post(`/app/artifact/${artifactId}/document`, {}),
  generateArtifactSlides: (artifactId) => post(`/app/artifact/${artifactId}/slides`, {}),
  generateArtifactVideo: (artifactId) => post(`/app/artifact/${artifactId}/video`, {}),
  artifactVideoStatus: (artifactId) => get(`/app/artifact/${artifactId}/video/status`),
  archiveArtifactVideo: (artifactId) => post(`/app/artifact/${artifactId}/archive`, {}),
  // Outreach
  listOutreach: (oppId) => get(`/app/opportunity/${oppId}/outreach`),
  generateOutreach: (oppId, { channel, tone, contactId } = {}) => post(`/app/opportunity/${oppId}/outreach/generate`, { channel, tone, contactId }),
  seedCadence: (oppId) => post(`/app/opportunity/${oppId}/cadence`, {}),
  setOutreachState: (messageId, state) => post(`/app/outreach/${messageId}/state`, { state }),
  updateOutreachBody: (messageId, body) => post(`/app/outreach/${messageId}/body`, { body }),
  sendOutreach: (messageId, { to, subject } = {}) => post(`/app/outreach/${messageId}/send`, { to, subject }),
  outreachQueue: ({ owner } = {}) => get(`/app/outreach?owner=${encodeURIComponent(owner || _owner)}${demoParam()}`),
  // Convert: interview + offer
  listInterviews: (oppId) => get(`/app/opportunity/${oppId}/interviews`),
  interviewPrep: (oppId, { stage, interviewers } = {}) => post(`/app/opportunity/${oppId}/interview/prep`, { stage, interviewers }),
  interviewDebrief: (interviewId, transcript) => post(`/app/interview/${interviewId}/debrief`, { transcript }),
  interviewTranscribe: (interviewId, { audioBase64, mimeType } = {}) => post(`/app/interview/${interviewId}/transcribe`, { audioBase64, mimeType }),
  getOffer: (oppId) => get(`/app/opportunity/${oppId}/offer`),
  analyzeOffer: (oppId, { theirOffer, floor } = {}) => post(`/app/opportunity/${oppId}/offer`, { theirOffer, floor }),
  // App Answers (vision autofill)
  answersVision: (oppId, imageBase64, style = 'concise') => post(`/app/opportunity/${oppId}/answers/vision`, { imageBase64, style }),
  // Voice call (ElevenLabs Conversational AI) — signed WebSocket URL
  voiceSession: () => get(`/app/voice/session`),
  // AI Coach (OpenAI Responses operator agent: app tools + memory + Tavily)
  coachChat: (messages, { owner } = {}) => post(`/app/coach/chat`, { messages, owner: owner || _owner }),
  coachStatus: ({ owner } = {}) => get(`/app/coach/status?owner=${encodeURIComponent(owner || _owner)}`),
  coachMemoryList: ({ owner } = {}) => get(`/app/coach/memory/list?owner=${encodeURIComponent(owner || _owner)}`),
  coachMemoryBootstrap: () => post(`/app/coach/memory/bootstrap`, {}),
  coachProvision: () => post(`/app/coach/provision`, {}),
  coachUpload: (filename, contentBase64) => post(`/app/coach/upload`, { filename, contentBase64 }),
  coachConfigGet: () => get(`/app/coach/config`),
  coachConfigSet: (body) => post(`/app/coach/config`, body),
  coachActivity: ({ owner } = {}) => get(`/app/coach/activity?owner=${encodeURIComponent(owner || _owner)}`),
  coachThreadGet: ({ owner } = {}) => get(`/app/coach/thread?owner=${encodeURIComponent(owner || _owner)}`),
  coachThreadClear: ({ owner } = {}) => post(`/app/coach/thread/clear`, { owner: owner || _owner }),
  coachMemoryAdd: ({ text, kind, owner } = {}) => post(`/app/coach/memory/add`, { text, kind, owner: owner || _owner }),
  coachMemoryDelete: (id) => post(`/app/coach/memory/delete`, { id }),
  // Intake watcher (mail subscription + config + self-test + on-demand pull)
  mailSubscriptions: () => get(`/mail/subscriptions`),
  mailSubscribe: () => post(`/mail/subscribe`, {}),
  mailPollNow: (minutes = 120) => post(`/mail/poll-now`, { minutes }),
  mailClearReload: ({ days = 7 } = {}) => post(`/mail/clear-reload`, { days }),
  mailConfigGet: () => get(`/mail/config`),
  mailConfigSet: (patch) => post(`/mail/config`, patch),
  mailFolders: (mailbox) => get(`/mail/folders${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailFolderTree: (mailbox) => get(`/mail/folders?tree=1${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailFolderMapGet: () => get(`/mail/folder-map`),
  mailFolderMapSet: ({ folderId, folderPath, roleKey }) => post(`/mail/folder-map`, { folderId, folderPath, roleKey }),
  mailFolderMapDelete: ({ folderId, roleKey }) => post(`/mail/folder-map/delete`, { folderId, roleKey }),
  mailMessages: ({ folderId, top = 50, mailbox } = {}) => get(`/mail/messages?top=${top}${folderId ? `&folderId=${encodeURIComponent(folderId)}` : ''}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailMessage: (id, mailbox) => get(`/mail/message/${encodeURIComponent(id)}${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailAlertSnooze: (messageId, hours = 24) => post(`/mail/alert/snooze`, { messageId, hours }),
  mailAlertDismiss: (messageId) => post(`/mail/alert/dismiss`, { messageId }),
  mailSelfTest: () => post(`/mail/self-test`, {}),
  mailSendTestReal: (opts = {}) => post(`/mail/send-test-real`, opts),
  // Templates (reusable text/creative assets)
  templatesList: () => get(`/app/templates?owner=${encodeURIComponent(_owner)}`),
  templateSave: (data) => post(`/app/templates`, data),
  templateDelete: (id) => post(`/app/templates/delete`, { id }),
  templateUse: (id) => post(`/app/templates/${encodeURIComponent(id)}/use`, {}),
  // AI cost metering
  usageSummary: () => get(`/app/usage`),
  // Asset analytics (tracked opens)
  assetsAnalytics: () => get(`/app/assets/analytics?owner=${encodeURIComponent(_owner)}`),
  assetEvent: (body) => post(`/app/asset/event`, body),
  trackedLink: (artifactId) => `${API_BASE}/app/asset/${artifactId}/open`,
  // Library
  listAssets: () => get(`/app/assets`),
  listPersonas: () => get(`/app/personas`),
  createPersona: (data) => post(`/app/personas`, data),
  updatePersona: (key, patch) => patch_(`/app/personas/${key}`, patch),
  deletePersona: (key) => del(`/app/personas/${key}`),
  tagAllRoles: () => post(`/app/personas/tag-all`, {}),
  listLibrary: (kind) => get(`/app/library${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
}

export { API_BASE }

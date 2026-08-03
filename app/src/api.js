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
// True only if a session token exists AND its JWT exp is still in the future (writes need this).
export function sessionValid() {
  const t = _session
  if (!t) return false
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof p.exp === 'number' && p.exp > Math.floor(Date.now() / 1000)
  } catch { return false }
}
function authHeaders(extra) { return _session ? { ...(extra || {}), Authorization: `Bearer ${_session}` } : (extra || {}) }
// Whether owner-scoped reads include demo/sample (is_demo) rows.
let _includeDemo = (() => { try { return localStorage.getItem('ee_show_demo') !== 'false' } catch { return true } })()
export function setIncludeDemo(v) { _includeDemo = !!v }
const demoParam = () => (_includeDemo ? '' : '&includeDemo=false')

// On-401 session refresh hook. The session token has a 12h TTL and doesn't silently
// refresh, so a stale token 401s every write. The app registers a refresher (Microsoft
// silent re-mint) via setUnauthorizedHandler; on the first 401 we re-mint once and retry
// the SAME request with the fresh token. In-flight refreshes are deduped so a burst of
// parallel 401s triggers a single re-mint. Set null → no refresh (falls through to throw).
let _onUnauthorized = null
let _refreshInFlight = null
export function setUnauthorizedHandler(fn) { _onUnauthorized = fn }
function tryRefresh() {
  if (!_onUnauthorized) return Promise.resolve(false)
  if (!_refreshInFlight) {
    _refreshInFlight = Promise.resolve()
      .then(() => _onUnauthorized())
      .catch(() => false)
      .finally(() => { _refreshInFlight = null })
  }
  return _refreshInFlight
}

// Single fetch path for every helper: applies auth headers, and on a 401 attempts one
// silent session re-mint + retry before giving up. authHeaders() is re-read on retry so
// the retried request carries the freshly-minted Bearer.
async function authedFetch(path, { method = 'GET', jsonBody, extraHeaders } = {}) {
  const build = () => ({
    method,
    headers: authHeaders(jsonBody !== undefined ? { 'Content-Type': 'application/json', ...(extraHeaders || {}) } : extraHeaders),
    ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
  })
  let res = await fetch(`${API_BASE}${path}`, build())
  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) res = await fetch(`${API_BASE}${path}`, build())
  }
  return res
}

async function get(path) {
  const res = await authedFetch(path)
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}
async function post(path, body) {
  const res = await authedFetch(path, { method: 'POST', jsonBody: body || {} })
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return res.json()
}

async function patch_(path, body) {
  const res = await authedFetch(path, { method: 'PATCH', jsonBody: body || {} })
  if (!res.ok) throw new Error(`PATCH ${path} → HTTP ${res.status}`)
  return res.json()
}
async function del(path) {
  const res = await authedFetch(path, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} → HTTP ${res.status}`)
  return res.json()
}

export const api = {
  listOpportunities: ({ owner, persona, stage, includeDismissed } = {}) => {
    const qs = new URLSearchParams()
    qs.set('owner', owner || _owner)
    if (persona) qs.set('persona', persona)
    if (stage) qs.set('stage', stage)
    if (includeDismissed) qs.set('includeDismissed', '1')
    const q = qs.toString()
    return get(`/app/opportunities?${q}${demoParam()}`)
  },
  getOpportunity: (id) => get(`/app/opportunity/${id}`),
  todayMetrics: ({ owner } = {}) => get(`/app/metrics/today?owner=${encodeURIComponent(owner || _owner)}${demoParam()}`),
  moveStage: (id, stage) => post(`/app/opportunity/${id}/stage`, { stage }),
  dismiss: (id) => post(`/app/opportunity/${id}/dismiss`, {}),
  undismiss: (id) => post(`/app/opportunity/${id}/dismiss`, { undo: true }),
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
  // Owner-scoped: pass ?owner= so folder tree + folder↔role mappings resolve to the active owner
  // (not the demo fallback) — same fix as personas. Without it, von.ellis's mappings never load.
  mailFolders: (mailbox) => get(`/mail/folders?owner=${encodeURIComponent(_owner)}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailFolderTree: (mailbox) => get(`/mail/folders?tree=1&owner=${encodeURIComponent(_owner)}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailFolderMapGet: () => get(`/mail/folder-map?owner=${encodeURIComponent(_owner)}`),
  mailFolderMapSet: ({ folderId, folderPath, roleKey }) => post(`/mail/folder-map?owner=${encodeURIComponent(_owner)}`, { folderId, folderPath, roleKey }),
  mailFolderMapDelete: ({ folderId, roleKey }) => post(`/mail/folder-map/delete?owner=${encodeURIComponent(_owner)}`, { folderId, roleKey }),
  mailMessages: ({ folderId, top = 50, mailbox } = {}) => get(`/mail/messages?top=${top}${folderId ? `&folderId=${encodeURIComponent(folderId)}` : ''}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailMessage: (id, mailbox) => get(`/mail/message/${encodeURIComponent(id)}${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailAlertSnooze: (messageId, hours = 24) => post(`/mail/alert/snooze`, { messageId, hours }),
  mailAlertDismiss: (messageId) => post(`/mail/alert/dismiss`, { messageId }),
  // Search / filter preferences (target metros + remote-only) — ACT-32/33/34
  searchPrefsGet: () => get(`/app/search-prefs?owner=${encodeURIComponent(_owner)}`),
  searchPrefsSet: ({ targetGeoIds, remoteOnly, tempThresholds }) => post(`/app/search-prefs?owner=${encodeURIComponent(_owner)}`, { targetGeoIds, remoteOnly, tempThresholds }),
  // LinkedIn role-sweep config + cursor + the exact built queries (preview before enabling).
  // GET returns { config:{enabled,titlesPerQuery,activeHoursEt}, cursor, totalQueries, totalTitles, queries }.
  searchSweepGet: (previewTpq) => get(`/app/search-sweep?owner=${encodeURIComponent(_owner)}${Number.isFinite(previewTpq) ? `&titlesPerQuery=${previewTpq}` : ''}`),
  searchSweepSet: ({ enabled, titlesPerQuery, activeHoursEt, jdFetchMode, jdFetchFallback }) => post(`/app/search-sweep?owner=${encodeURIComponent(_owner)}`, { enabled, titlesPerQuery, activeHoursEt, jdFetchMode, jdFetchFallback }),
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
  // Pass ?owner= like every other data call so personas resolve to the active owner (not the demo
  // fallback). Without this, /app/personas defaulted server-side to demo@ and showed the demo roles
  // even when opportunities were showing the real owner's data.
  listPersonas: () => get(`/app/personas?owner=${encodeURIComponent(_owner)}`),
  // ACT-30 — taxonomy-backed Role Profiles
  roleProfilesGet: () => get(`/app/role-profiles?owner=${encodeURIComponent(_owner)}`),
  roleProfileGet: (key) => get(`/app/role-profiles?owner=${encodeURIComponent(_owner)}&key=${encodeURIComponent(key)}`),
  roleProfileSet: ({ key, narrative, keyWins, compReference }) => post(`/app/role-profiles?owner=${encodeURIComponent(_owner)}`, { key, narrative, keyWins, compReference }),
  createPersona: (data) => post(`/app/personas?owner=${encodeURIComponent(_owner)}`, data),
  updatePersona: (key, patch) => patch_(`/app/personas/${key}?owner=${encodeURIComponent(_owner)}`, patch),
  deletePersona: (key) => del(`/app/personas/${key}?owner=${encodeURIComponent(_owner)}`),
  tagAllRoles: () => post(`/app/personas/tag-all?owner=${encodeURIComponent(_owner)}`, {}),
  // Role taxonomy (3-level: group -> role -> title variant; fav/watch/off tiers)
  taxonomy: () => get(`/app/taxonomy?owner=${encodeURIComponent(_owner)}${demoParam()}`),
  taxonomyRetag: () => post(`/app/taxonomy/retag`, {}),
  taxonomyAddTitle: (data) => post(`/app/taxonomy/title`, data),
  taxonomySetTier: (data) => patch_(`/app/taxonomy/title/tier`, data),
  taxonomyBulkTier: ({ group, roleSlug, tier }) => post(`/app/taxonomy/roles/bulk-tier`, { group, roleSlug, tier }),
  taxonomyPublish: () => post(`/app/taxonomy/publish`, {}),
  taxonomyRevert: () => post(`/app/taxonomy/revert`, {}),
  listLibrary: (kind) => get(`/app/library${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
}

export { API_BASE }

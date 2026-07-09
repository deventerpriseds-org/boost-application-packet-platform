// API client for the Executive Engine service layer (Azure Functions).
// Reads from boost_resume_n_packet_builder via the app/* endpoints.
const API_BASE =
  import.meta.env.VITE_API_URL || 'https://job-platform-api.azurewebsites.net/api'

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}
async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return res.json()
}

export const api = {
  listOpportunities: ({ owner, persona, stage } = {}) => {
    const qs = new URLSearchParams()
    if (owner) qs.set('owner', owner)
    if (persona) qs.set('persona', persona)
    if (stage) qs.set('stage', stage)
    const q = qs.toString()
    return get(`/app/opportunities${q ? `?${q}` : ''}`)
  },
  getOpportunity: (id) => get(`/app/opportunity/${id}`),
  moveStage: (id, stage) => post(`/app/opportunity/${id}/stage`, { stage }),
  dismiss: (id) => post(`/app/opportunity/${id}/dismiss`, {}),
  // Packets / artifacts (production line)
  listPackets: ({ owner } = {}) => get(`/app/packets${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  getPacket: (oppId) => get(`/app/opportunity/${oppId}/packet`),
  generateArtifact: (artifactId) => post(`/app/artifact/${artifactId}/generate`, {}),
  setArtifactStatus: (artifactId, status) => post(`/app/artifact/${artifactId}/status`, { status }),
  generateArtifactDocument: (artifactId) => post(`/app/artifact/${artifactId}/document`, {}),
  generateArtifactVideo: (artifactId) => post(`/app/artifact/${artifactId}/video`, {}),
  artifactVideoStatus: (artifactId) => get(`/app/artifact/${artifactId}/video/status`),
  archiveArtifactVideo: (artifactId) => post(`/app/artifact/${artifactId}/archive`, {}),
  // Outreach
  listOutreach: (oppId) => get(`/app/opportunity/${oppId}/outreach`),
  generateOutreach: (oppId, { channel, tone, contactId } = {}) => post(`/app/opportunity/${oppId}/outreach/generate`, { channel, tone, contactId }),
  seedCadence: (oppId) => post(`/app/opportunity/${oppId}/cadence`, {}),
  setOutreachState: (messageId, state) => post(`/app/outreach/${messageId}/state`, { state }),
  sendOutreach: (messageId, { to, subject } = {}) => post(`/app/outreach/${messageId}/send`, { to, subject }),
  outreachQueue: ({ owner } = {}) => get(`/app/outreach${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  // Convert: interview + offer
  listInterviews: (oppId) => get(`/app/opportunity/${oppId}/interviews`),
  interviewPrep: (oppId, { stage, interviewers } = {}) => post(`/app/opportunity/${oppId}/interview/prep`, { stage, interviewers }),
  interviewDebrief: (interviewId, transcript) => post(`/app/interview/${interviewId}/debrief`, { transcript }),
  interviewTranscribe: (interviewId, { audioBase64, mimeType } = {}) => post(`/app/interview/${interviewId}/transcribe`, { audioBase64, mimeType }),
  getOffer: (oppId) => get(`/app/opportunity/${oppId}/offer`),
  analyzeOffer: (oppId, { theirOffer, floor } = {}) => post(`/app/opportunity/${oppId}/offer`, { theirOffer, floor }),
  // App Answers (vision autofill)
  answersVision: (oppId, imageBase64) => post(`/app/opportunity/${oppId}/answers/vision`, { imageBase64 }),
  // Voice call (ElevenLabs Conversational AI) — signed WebSocket URL
  voiceSession: () => get(`/app/voice/session`),
  // Intake watcher (mail subscription + config + self-test + on-demand pull)
  mailSubscriptions: () => get(`/mail/subscriptions`),
  mailSubscribe: () => post(`/mail/subscribe`, {}),
  mailPollNow: (minutes = 120) => post(`/mail/poll-now`, { minutes }),
  mailConfigGet: () => get(`/mail/config`),
  mailConfigSet: (patch) => post(`/mail/config`, patch),
  mailFolders: (mailbox) => get(`/mail/folders${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`),
  mailSelfTest: () => post(`/mail/self-test`, {}),
  // AI cost metering
  usageSummary: () => get(`/app/usage`),
  // Library
  listAssets: () => get(`/app/assets`),
  listPersonas: () => get(`/app/personas`),
  listLibrary: (kind) => get(`/app/library${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
}

export { API_BASE }

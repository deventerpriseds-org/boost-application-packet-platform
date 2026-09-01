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

// Same fetch path as post(), but it PRESERVES the server's own error body.
//
// The QC gate is a server decision and its refusals carry the reason with them: a 409 from
// /artifact/{id}/status says WHICH findings block approval, a 409 from /gate-override says a fail
// cannot be overridden, a 403 says an override needs a verified session. post() collapses all of
// those into "HTTP 409", which forces the UI to invent a generic message and, worse, to guess at a
// rule the server already decided. Anything that surfaces a server verdict must use this.
async function postDetailed(path, body) {
  const res = await authedFetch(path, { method: 'POST', jsonBody: body || {} })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(String(json?.error || `POST ${path} → HTTP ${res.status}`))
    err.status = res.status
    err.body = json
    throw err
  }
  return json
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
  ownerFacts: ({ owner } = {}) => get(`/app/qc/facts?owner=${encodeURIComponent(owner || _owner)}`),
  setOwnerFact: (fact, { owner } = {}) => post(`/app/qc/facts/set?owner=${encodeURIComponent(owner || _owner)}`, fact),
  deriveOwnerFacts: ({ owner } = {}) => post(`/app/qc/facts/derive?owner=${encodeURIComponent(owner || _owner)}`, {}),
  listPackets: ({ owner } = {}) => get(`/app/packets?owner=${encodeURIComponent(owner || _owner)}${demoParam()}`),
  getPacket: (oppId) => get(`/app/opportunity/${oppId}/packet`),
  // `force` is the whole point of the control that calls this. P0.2 made the endpoint idempotent —
  // correct, it stops an automatic re-analysis burning a model call — but this helper took no
  // argument and never sent `force`, so the server returned the cache every time. The button that
  // reads "Re-run analysis" provably could not re-run: a server-side fix shipped without its one
  // consumer. An EXPLICIT click means "do it now", which is exactly the case the cache is not for.
  analyzeJd: (oppId, opts = {}) => post(`/app/opportunity/${oppId}/jd-analysis`, opts.force ? { force: true } : {}),
  parseJd: (oppId) => post(`/app/opportunity/${oppId}/jd-parse`, {}),
  // P5.4 — the posting's requirement spine: one row per extracted line, with the employer's
  // located span (`verbatim`) where there is one and the model's paraphrase (`item_text`) always.
  // Owner-scoped like every other read: without ?owner= resolveOwner() silently falls back to demo.
  requirements: (oppId) => get(`/app/opportunity/${oppId}/requirements?owner=${encodeURIComponent(_owner)}`),
  // The stored verdict of the last checks run for one artifact — gate, attention count, score
  // components (including the term library's own words about why keyword coverage is null).
  jdStatus: () => get('/app/opportunities/jd-status'),
  enrichOpportunity: (oppId) => post(`/app/opportunity/${oppId}/enrich`, {}),
  matchScore: (oppId) => post(`/app/opportunity/${oppId}/match-score`, {}),
  applyPrepare: (oppId, opts = {}) => post(`/app/opportunity/${oppId}/apply/prepare`, opts),
  buildFullPacket: (oppId, opts = {}) => post(`/app/opportunity/${oppId}/packet/build-all`, opts),
  // D35. The synchronous build above takes ~3 minutes and the gateway gives up at ~230s, so the
  // browser saw a 504 on builds that had already written every document. These two queue the same
  // build and poll it: the POST returns a jobId in milliseconds, and the job carries the result —
  // including on failure, which is where a partial build's warnings live.
  queueFullPacket: (oppId, opts = {}) => post(`/app/opportunity/${oppId}/packet/build-async`, opts),
  buildJob: (jobId) => get(`/app/packet/build-job/${jobId}?owner=${encodeURIComponent(_owner)}`),
  bulkRun: (opts = {}) => post(`/app/bulk/packets`, opts),
  bulkStatus: (jobId) => get(`/app/bulk/${jobId}`),
  appHealth: () => get(`/app/health`),
  appSelftest: () => get(`/app/selftest`),
  atsSources: () => get(`/app/ats/sources`),
  // `enabled` is an upsert field on this route: `appAts.ts:74-76` does
  // `on conflict (owner_email, provider, board) do update set enabled = $4`, and `:154` scans only
  // `where ... and enabled`. The server has always honoured it; nothing could send it, so the only
  // way to stop scanning a board was to DELETE it and lose its history. Found by H28.
  atsSourceAdd: (provider, board, opts = {}) =>
    post(`/app/ats/sources`, opts.enabled === undefined ? { provider, board } : { provider, board, enabled: opts.enabled }),
  atsSourceDelete: (id) => post(`/app/ats/sources/delete`, { id }),
  atsPreview: (provider, board) => post(`/app/ats/preview`, { provider, board }),
  atsIngest: (opts = {}) => post(`/app/ats/ingest`, opts),
  // QC evidence reads (P5.2 asset blocks). All three are owner-scoped server-side (resolveOwner →
  // `where o.owner_email = $2`), so they MUST carry ?owner= or they resolve to the demo owner and
  // 404 on the real owner's rows — the same trap that bit listPersonas.
  oppRequirements: (oppId) => get(`/app/opportunity/${oppId}/requirements?owner=${encodeURIComponent(_owner)}`),
  generateArtifact: (artifactId) => post(`/app/artifact/${artifactId}/generate`, {}),
  // `note` rides along on a 'changes' status: the server appends it to packet.feedback and the
  // next regenerate of that artifact type is steered by it. Omitted for approve/reopen.
  setArtifactStatus: (artifactId, status, note) => post(`/app/artifact/${artifactId}/status`, note ? { status, note } : { status }),
  // ── QC gate (P2.2/P2.3) ────────────────────────────────────────────────────────────────────
  // Every GET here is owner-scoped server-side via resolveOwner(), which falls back to the DEMO
  // owner when no ?owner= is present — so omitting it silently 404s the real owner's artifacts.
  //
  // The three POSTs below deliberately carry NO ?owner=. requireWrite() rejects any write that is
  // not either a verified session or the shared demo workspace, and for a verified session
  // resolveOwner() returns the SESSION email and ignores ?owner= entirely (appSession.ts:46-76).
  // So on a write the parameter is either inert or a spoof attempt the server already refuses -
  // sending it would suggest the client picks the owner for a mutation, which it must never do.
  artifactChecksResult: (artifactId) => get(`/app/artifact/${artifactId}/checks-result?owner=${encodeURIComponent(_owner)}`),
  runArtifactChecks: (artifactId) => postDetailed(`/app/artifact/${artifactId}/checks`, {}),
  artifactGateOverride: (artifactId, reason) => postDetailed(`/app/artifact/${artifactId}/gate-override`, { reason }),
  // Approval is gated server-side and answers 409 with the blocking reason; the caller must show it.
  setArtifactStatusDetailed: (artifactId, status) => postDetailed(`/app/artifact/${artifactId}/status`, { status }),
  artifactInsertions: (artifactId) => get(`/app/artifact/${artifactId}/insertions?owner=${encodeURIComponent(_owner)}`),
  packetSwaps: (packetId) => get(`/app/packet/${packetId}/swaps?owner=${encodeURIComponent(_owner)}`),
  // #30. The owner rewrites a phrase themselves.
  //
  // postDetailed, not post, for exactly the reason revertCorrection uses it: this route REFUSES
  // with 200 + ok:false when the phrase is absent from the field or appears more than once, and
  // that refusal is a fact about the owner's own document that has to reach the screen in the
  // server's own words. post() collapses it into an HTTP error and the owner is told nothing.
  ownerEdit: (artifactId, body) => postDetailed(`/app/artifact/${artifactId}/owner-edit`, body),
  // P8.1/P8.6 - undo ONE correction. The change log itself rides on artifactChecksResult above, so
  // the log and the counters beside it are the same payload rather than two.
  //
  // postDetailed, not post: revertOne can REFUSE - the field was edited after the correction was
  // applied, so the recovered original no longer hashes to `before_sha256` and it declines rather
  // than splicing text into a document nobody can check. That refusal is a fact about the user's own
  // document and it is rendered in the server's own words; post() would collapse it into "HTTP 409".
  //
  // No ?owner=, deliberately: this is a write, requireWrite() takes the owner from the verified
  // session and resolveOwner() ignores ?owner= entirely for one, so sending it would suggest the
  // client picks the owner for a mutation.
  revertCorrection: (correctionId) => postDetailed(`/app/correction/${correctionId}/revert`, {}),
  // The owner accepts or refuses a MODEL-PROPOSED excerpt. This is the only thing that can move a
  // `proposed` row into `must_have_coverage`'s numerator, so it is the single control that lets the
  // owner be the accuser the engine's house rule requires ("a model may PROPOSE, only an exact rule
  // may ACCUSE" — a human is an exact rule).
  //
  // The route shipped complete — writer, withdrawal, idempotency, a 409 refusing anything that is
  // not a proposal — and had no caller in `app/`, so fifteen verified proposals sat uncounted in
  // production while the screen reported zero coverage.
  //
  // postDetailed, not post, for the same reason revertCorrection uses it: this route REFUSES in the
  // owner's own terms — 403 when the session is not verified (a confirmation whose actor is
  // "whoever sent the request" is an audit row worth nothing), 404 when the row is not theirs, 409
  // when the excerpt is not a model proposal. Each of those is a fact the owner must read; post()
  // would collapse all three into "HTTP error".
  //
  // No ?owner=, deliberately: this is a write. requireWrite() takes the owner from the verified
  // session and resolveOwner() ignores ?owner= for a mutation, so sending it would imply the client
  // picks whose confirmation this is.
  evidenceConfirm: (seq, body) => postDetailed(`/app/requirement/${seq}/evidence-confirm`, body),
  // Same defect as `analyzeJd` above, shipped a second time and found by a reachability sweep.
  // `appPackets.ts:382` reads `regen` off this route's body and `:319` honours it; this helper took
  // no options argument, so it could not send it. Nor could anything else: `coachTools.ts:28` posts
  // no body to the same route and its schema declares only `artifactId`. A parameterised cache
  // bypass existed on the server with ZERO callers on any path, UI or agent.
  generateArtifactDocument: (artifactId, opts = {}) => post(`/app/artifact/${artifactId}/document`, opts.regen ? { regen: true } : {}),
  saveArtifactContent: (id, body) => post(`/app/artifact/${id}/content`, body),
  aiEditArtifact: (id, body) => post(`/app/artifact/${id}/ai-edit`, body),
  // As `generateArtifactDocument` — `appPackets.ts:457` is the slides half of the same gap.
  generateArtifactSlides: (artifactId, opts = {}) => post(`/app/artifact/${artifactId}/slides`, opts.regen ? { regen: true } : {}),
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
  // `checks` carries the chk_* settings (D:chk-settings-have-no-writer). Destructured explicitly like
  // its siblings so a typo in a caller is a dropped field rather than a silently ignored save — the
  // route applies partial updates, so omitting a key means "leave it", never "clear it".
  searchPrefsSet: ({ targetGeoIds, remoteOnly, tempThresholds, checks }) => post(`/app/search-prefs?owner=${encodeURIComponent(_owner)}`, { targetGeoIds, remoteOnly, tempThresholds, checks }),
  // D24 — the comparison dimension set per role family. The API half has been live and uncalled;
  // the run warning literally names "Settings ▸ Comparison dimensions" as the place to change it.
  // D:remediation-never-ran — P3 has been deployed and has executed ZERO times in production, because
  // nothing in app/ ever called it. Four routes, no caller. Same shape as D:build-runs-no-qc.
  artifactRemediationGet: (artifactId) => get(`/app/artifact/${artifactId}/remediation?owner=${encodeURIComponent(_owner)}`),
  artifactRemediate: (artifactId, body) => post(`/app/artifact/${artifactId}/remediate?owner=${encodeURIComponent(_owner)}`, body || {}),
  escalationResolve: (id, body) => post(`/app/escalation/${id}?owner=${encodeURIComponent(_owner)}`, body || {}),
  remediationPrefsGet: () => get(`/app/remediation-prefs?owner=${encodeURIComponent(_owner)}`),
  // D:appconfig-unreachable-in-product — the ten pipeline settings (openai.*, google.*, microsoft.*).
  // The route existed and had NO caller anywhere, including the legacy console; it is also the route
  // that was serving the whole `auth` partition unauthenticated until it was bounded to these keys.
  pipelineConfigGet: () => get('/config'),
  pipelineConfigSet: (values) => post('/config', { values }),
  // The resume template's role focus — the owner's ruling that the resume chosen drives the persona.
  // `resolveRoleFocus` reads `templates/resume-<driveId>` before every other source; these are the
  // read and write for that row, so the value is a setting rather than a code constant.
  // Which of the owner's resumes a packet is built on. The COLLECTION comes from
  // templateFocusGet (AppConfig `templates`); this stores the per-packet CHOICE, and choosing also
  // chooses the persona because resolveRoleFocus reads the resume template id first.
  // A blank templateId clears back to the owner's configured default -- a real outcome, not an error.
  packetResumeTemplateSet: (packetId, templateId) =>
    post(`/app/packet/${packetId}/resume-template`, { templateId: templateId || '' }),
  templateFocusGet: () => get('/config/templates'),
  // `label` is OMITTED when undefined rather than sent as '' — the route treats an absent label as
  // "leave it alone" and a present blank one as "clear it", so sending '' from a caller that only
  // meant to change the focus would wipe the template's name.
  //
  // `slots` is the SAME contract, one level down: the six fixed slot counts
  // (SkillsBullets1, SkillsBullets2, ExpertiseBullets, RelevantBullets1..3). A key omitted from the
  // object is left alone; a key present with `null` clears it; a key present with a positive whole
  // number sets it. The whole `slots` object is omitted when undefined so a caller that only meant
  // to rename a template cannot wipe its counts — the row is written with Replace.
  templateFocusSet: (templateId, roleFocus, label, slots) => post('/config/templates', {
    templateId, roleFocus,
    ...(label === undefined ? {} : { label }),
    ...(slots === undefined ? {} : { slots }),
  }),
  // The owner's skill REWORDINGS (4.6-9). Code seeds the first value; this pair is what makes it a
  // setting rather than a constant, per the owner's "config store so i can edit them".
  // GET returns { stored, seed, effective, preview } — preview carries the resulting pool AND
  // `staleRewords`, the keys that matched nothing, which is the only visible sign the map has
  // drifted from MasterContext.
  // The owner's banked skills (4.6-9). Read-only here; the swap control offers ONLY these,
  // because an alternative the owner does not claim would be words put in their mouth.
  skillBankGet: () => get(`/app/skill-bank?owner=${encodeURIComponent(_owner)}`),
  skillBankSeed: () => post(`/app/skill-bank?owner=${encodeURIComponent(_owner)}`, {}),
  skillRewordsGet: () => get(`/app/skill-rewords?owner=${encodeURIComponent(_owner)}`),
  // Sends the WHOLE map, deliberately: the route replaces rather than merges, because a merge cannot
  // express deleting a rewording — which is the main thing this screen is for.
  skillRewordsSet: (rewords) => post(`/app/skill-rewords?owner=${encodeURIComponent(_owner)}`, { rewords }),
  dimensionPrefsGet: () => get(`/app/dimension-prefs?owner=${encodeURIComponent(_owner)}`),
  dimensionPrefsSet: ({ family, keys }) => post(`/app/dimension-prefs?owner=${encodeURIComponent(_owner)}`, { family, keys }),
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

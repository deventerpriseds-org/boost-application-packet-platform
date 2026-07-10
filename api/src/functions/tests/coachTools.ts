// Tool definitions + executor for the AI coach agent.
//
// The coach is an OPERATOR: every tool here maps to something the user would
// otherwise do by hand in the app. The executor calls the API's own public
// endpoints (same Function App), threading the signed-in owner so reads/writes
// are scoped correctly. Plus: live web search (Tavily), durable memory
// (remember/recall over pgvector), and read-only system diagnostics for
// debugging/tracing from inside the app.

import { tavilySearch, TAVILY_WEB_SEARCH_TOOL } from './tavilySearch'
import { remember as memRemember, recall as memRecall } from './coachMemory'

const SELF_BASE = process.env.COACH_SELF_BASE || 'https://job-platform-api.azurewebsites.net/api'

type Method = 'GET' | 'POST'
interface Route { method: Method; path: (a: any) => string; body?: (a: any) => any; ownerQuery?: boolean }

// Map each app-operation tool to its HTTP call. `id`, `artifactId`, `messageId`
// come from the model's arguments; owner is threaded from the chat context.
const ROUTES: Record<string, Route> = {
  list_opportunities: { method: 'GET', ownerQuery: true, path: (a) => `app/opportunities?${qs({ stage: a.stage, includeDemo: a.includeDemo })}` },
  get_opportunity:    { method: 'GET', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}` },
  advance_stage:      { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/stage`, body: (a) => ({ stage: a.stage }) },
  dismiss_opportunity:{ method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/dismiss` },
  get_packet:         { method: 'GET', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/packet` },
  list_packets:       { method: 'GET', ownerQuery: true, path: (a) => `app/packets?${qs({ includeDemo: a.includeDemo })}` },
  generate_artifact:  { method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/generate` },
  create_document:    { method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/document` },
  create_slides:      { method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/slides` },
  list_outreach:      { method: 'GET', ownerQuery: true, path: () => `app/outreach` },
  opportunity_outreach:{ method: 'GET', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/outreach` },
  generate_outreach:  { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/outreach/generate`, body: (a) => ({ channel: a.channel, tone: a.tone }) },
  send_outreach:      { method: 'POST', ownerQuery: true, path: (a) => `app/outreach/${enc(a.messageId)}/send`, body: (a) => ({ to: a.to, subject: a.subject }) },
  interview_prep:     { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/interview/prep`, body: (a) => ({ stage: a.stage, interviewers: a.interviewers }) },
  offer_analysis:     { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/offer`, body: (a) => ({ theirOffer: a.theirOffer, floor: a.floor }) },
  get_usage:          { method: 'GET', ownerQuery: true, path: () => `app/usage` },
  assets_analytics:   { method: 'GET', ownerQuery: true, path: () => `app/assets/analytics` },
  config_status:      { method: 'GET', path: () => `config-status` },
  mail_config:        { method: 'GET', path: () => `mail/config` },
  mail_subscriptions: { method: 'GET', path: () => `mail/subscriptions` },
  app_health:         { method: 'GET', path: () => `app/health` },
  app_selftest:       { method: 'GET', path: () => `app/selftest` },
  // --- Newly wired (endpoints already existed) ---
  list_interviews:    { method: 'GET', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/interviews` },
  interview_debrief:  { method: 'POST', ownerQuery: true, path: (a) => `app/interview/${enc(a.interviewId)}/debrief`, body: (a) => ({ transcript: a.transcript }) },
  seed_cadence:       { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/cadence` },
  set_outreach_state: { method: 'POST', ownerQuery: true, path: (a) => `app/outreach/${enc(a.messageId)}/state`, body: (a) => ({ state: a.state }) },
  outreach_tick:      { method: 'POST', ownerQuery: true, path: () => `app/outreach/tick` },
  mail_poll_now:      { method: 'POST', path: (a) => `mail/poll-now`, body: (a) => ({ minutes: a.minutes || 120 }) },
  answers_vision:     { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/answers/vision`, body: (a) => ({ imageBase64: a.imageBase64 }) },
  generate_video:     { method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/video` },
  video_status:       { method: 'GET', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/video/status` },
  archive_video:      { method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/archive` },
  set_artifact_status:{ method: 'POST', ownerQuery: true, path: (a) => `app/artifact/${enc(a.artifactId)}/status`, body: (a) => ({ status: a.status }) },
  list_personas:      { method: 'GET', ownerQuery: true, path: () => `app/personas` },
  // --- New endpoints built for the operator (see appPackets/appBulk/appIntake) ---
  build_full_packet:  { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/packet/build-all`, body: (a) => ({ seedCadence: a.seedCadence, draftOutreach: a.draftOutreach }) },
  bulk_run:           { method: 'POST', ownerQuery: true, path: () => `app/bulk/packets`, body: (a) => ({ oppIds: a.oppIds, topN: a.topN, stage: a.stage, seedCadence: a.seedCadence, draftOutreach: a.draftOutreach }) },
  bulk_status:        { method: 'GET', ownerQuery: true, path: (a) => `app/bulk/${enc(a.jobId)}` },
  analyze_jd:         { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/jd-analysis` },
  enrich_opportunity: { method: 'POST', ownerQuery: true, path: (a) => `app/opportunity/${enc(a.id)}/enrich` },
  list_ats_sources:   { method: 'GET', ownerQuery: true, path: () => `app/ats/sources` },
  add_ats_source:     { method: 'POST', ownerQuery: true, path: () => `app/ats/sources`, body: (a) => ({ provider: a.provider, board: a.board }) },
  ats_preview:        { method: 'POST', ownerQuery: true, path: () => `app/ats/preview`, body: (a) => ({ provider: a.provider, board: a.board }) },
  ats_ingest:         { method: 'POST', ownerQuery: true, path: () => `app/ats/ingest`, body: (a) => ({ provider: a.provider, board: a.board, execOnly: a.execOnly }) },
}

function enc(v: any) { return encodeURIComponent(String(v ?? '')) }
function qs(o: Record<string, any>): string {
  return Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
}

// The tool schemas advertised to the model (OpenAI Responses `tools` array).
export function coachToolSchemas(): any[] {
  const fn = (name: string, description: string, properties: any = {}, required: string[] = []) => ({
    type: 'function', name, description,
    parameters: { type: 'object', additionalProperties: false, properties, required },
  })
  return [
    fn('list_opportunities', 'List the user\'s job opportunities in the pipeline. Optional stage filter (discovered, saved, enriched, applied, outreach, engaged, screen, r1, panel, final, offer, accepted).', { stage: { type: 'string' }, includeDemo: { type: 'string', enum: ['true', 'false'] } }),
    fn('get_opportunity', 'Get full detail for one opportunity by id.', { id: { type: 'string' } }, ['id']),
    fn('advance_stage', 'Move an opportunity to a new pipeline stage.', { id: { type: 'string' }, stage: { type: 'string' } }, ['id', 'stage']),
    fn('dismiss_opportunity', 'Dismiss / soft-remove an opportunity.', { id: { type: 'string' } }, ['id']),
    fn('get_packet', 'Get the application packet (resume, cover letter, portfolio, intro video artifacts) for an opportunity.', { id: { type: 'string' } }, ['id']),
    fn('list_packets', 'List all application packets across opportunities.', { includeDemo: { type: 'string', enum: ['true', 'false'] } }),
    fn('generate_artifact', 'Generate (draft) the text for a packet artifact by its artifactId.', { artifactId: { type: 'string' } }, ['artifactId']),
    fn('create_document', 'Create a real Google Doc from a generated artifact by artifactId.', { artifactId: { type: 'string' } }, ['artifactId']),
    fn('create_slides', 'Create a real Google Slides deck from a generated portfolio/cover artifact by artifactId.', { artifactId: { type: 'string' } }, ['artifactId']),
    fn('list_outreach', 'List the outreach queue (drafted / scheduled / due / sent messages).'),
    fn('opportunity_outreach', 'List outreach messages for one opportunity.', { id: { type: 'string' } }, ['id']),
    fn('generate_outreach', 'Draft an outreach message for an opportunity. channel: coldEmail | followUp | linkedin | call.', { id: { type: 'string' }, channel: { type: 'string' }, tone: { type: 'string' } }, ['id', 'channel']),
    fn('send_outreach', 'Send a drafted email outreach message by messageId (real send via Graph).', { messageId: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' } }, ['messageId']),
    fn('interview_prep', 'Generate interview prep (likely questions + suggested answers) for an opportunity.', { id: { type: 'string' }, stage: { type: 'string' }, interviewers: { type: 'string' } }, ['id']),
    fn('offer_analysis', 'Analyze/negotiate an offer for an opportunity (counter draft + leverage + walk-away).', { id: { type: 'string' }, theirOffer: { type: 'object' }, floor: { type: 'object' } }, ['id']),
    fn('get_usage', 'Get AI cost/token usage metering (totals, by-feature, by-model).'),
    fn('assets_analytics', 'Get engagement analytics on shared assets (opens, unique viewers).'),
    fn('config_status', 'Read the deployed API config/credential status (which integrations are wired). Read-only diagnostic.'),
    fn('app_health', 'Liveness/readiness check — pings Postgres and reports which integrations are configured. Read-only.'),
    fn('app_selftest', 'Run an automated smoke test of the key app endpoints; returns pass/fail per endpoint. Read-only.'),
    fn('mail_config', 'Read the LinkedIn/mail intake watcher config (watched mailbox, folder, sources). Read-only.'),
    fn('mail_subscriptions', 'List active Microsoft Graph mail change-notification subscriptions. Read-only diagnostic.'),
    fn('remember', 'Save a durable memory the coach should recall in future conversations — especially user feedback, preferences, and decisions for continuous improvement. Stored in the user\'s own Postgres (vendor-portable).', { text: { type: 'string' }, kind: { type: 'string', enum: ['note', 'fact', 'preference', 'decision', 'feedback'] } }, ['text']),
    fn('recall', 'Search the coach\'s durable memory for relevant past notes/facts.', { query: { type: 'string' } }, ['query']),
    // Convert
    fn('list_interviews', 'List interview rounds recorded for an opportunity.', { id: { type: 'string' } }, ['id']),
    fn('interview_debrief', 'Debrief an interview from a transcript (summary, per-question scores, owed follow-ups).', { interviewId: { type: 'string' }, transcript: { type: 'string' } }, ['interviewId', 'transcript']),
    // Outreach
    fn('seed_cadence', 'Seed the multi-touch outreach cadence (scheduled touches) for an opportunity. Does NOT send.', { id: { type: 'string' } }, ['id']),
    fn('set_outreach_state', 'Set an outreach message state: draft | scheduled | due | sent | skipped.', { messageId: { type: 'string' }, state: { type: 'string' } }, ['messageId', 'state']),
    fn('outreach_tick', 'Run the scheduler now: promote scheduled touches whose time has passed to "due" (never auto-sends).'),
    // Intake
    fn('mail_poll_now', 'Pull the watched mailbox now for new job alerts (re-scan). minutes = lookback window.', { minutes: { type: 'number' } }),
    // Production line
    fn('analyze_jd', 'Run JD/ATS analysis for an opportunity: keywords, must-haves, ATS score, gaps.', { id: { type: 'string' } }, ['id']),
    fn('enrich_opportunity', 'Enrich an opportunity with company signals, likely stakeholders, and pain hypotheses.', { id: { type: 'string' } }, ['id']),
    fn('build_full_packet', 'Build the ENTIRE application packet for an opportunity in one go — generates every artifact (resume + compact resume Docs, cover + portfolio Slides) as real Google files. Optionally also seed the cadence and DRAFT (never send) outreach.', { id: { type: 'string' }, seedCadence: { type: 'boolean' }, draftOutreach: { type: 'boolean' } }, ['id']),
    fn('answers_vision', 'Draft application-form answers from a screenshot (data URI) of the form.', { id: { type: 'string' }, imageBase64: { type: 'string' } }, ['id', 'imageBase64']),
    fn('generate_video', 'Render the intro video (HeyGen) for a video artifact.', { artifactId: { type: 'string' } }, ['artifactId']),
    fn('video_status', 'Check the render status of an intro video artifact.', { artifactId: { type: 'string' } }, ['artifactId']),
    fn('set_artifact_status', 'Advance an artifact\'s status: todo | drafting | review | changes | approved.', { artifactId: { type: 'string' }, status: { type: 'string' } }, ['artifactId', 'status']),
    fn('list_personas', 'List the user\'s role personas (which role profile is active, comp target, positioning).'),
    // ATS job-board ingestion (Greenhouse / Lever / Ashby)
    fn('list_ats_sources', 'List the configured ATS job-board sources (Greenhouse/Lever/Ashby) that feed the pipeline.'),
    fn('add_ats_source', 'Add an ATS job-board source. provider: greenhouse | lever | ashby. board = the company board token (e.g. greenhouse "stripe", lever "netflix").', { provider: { type: 'string', enum: ['greenhouse', 'lever', 'ashby'] }, board: { type: 'string' } }, ['provider', 'board']),
    fn('ats_preview', 'Preview roles from an ATS board WITHOUT inserting (how many exec roles it has).', { provider: { type: 'string' }, board: { type: 'string' } }, ['provider', 'board']),
    fn('ats_ingest', 'Ingest jobs from ATS boards into the pipeline as discovered opportunities (embed + dedupe). With provider+board: that one; otherwise all configured sources.', { provider: { type: 'string' }, board: { type: 'string' }, execOnly: { type: 'boolean' } }),
    // Bulk (start-to-finish across many opportunities — NEVER sends)
    fn('bulk_run', 'Run the packet build across MANY opportunities at once (bulk). Pass explicit oppIds OR topN (+optional stage). For each: build the full packet, optionally seed cadence and DRAFT outreach. NEVER sends. Returns a jobId; poll bulk_status.', { oppIds: { type: 'array', items: { type: 'string' } }, topN: { type: 'number' }, stage: { type: 'string' }, seedCadence: { type: 'boolean' }, draftOutreach: { type: 'boolean' } }),
    fn('bulk_status', 'Get the progress/status of a bulk run by jobId.', { jobId: { type: 'string' } }, ['jobId']),
    // Client-side UI actions the app executes (things with no server endpoint)
    fn('ui_action', 'Ask the app to perform a BROWSER action the server cannot do. Use for: start_debrief_recording (open the interview debrief recorder and start recording), navigate (open a screen: today|opportunities|pipeline|packets|outreach|interview|offer|library|settings, optional id), copy_link (copy an artifact\'s tracked share link). The app executes it and shows the user.', { action: { type: 'string', enum: ['start_debrief_recording', 'navigate', 'copy_link'] }, opportunityId: { type: 'string' }, interviewId: { type: 'string' }, screen: { type: 'string' }, id: { type: 'string' }, artifactId: { type: 'string' } }, ['action']),
    TAVILY_WEB_SEARCH_TOOL,
  ]
}

// Execute a tool call. Returns a JSON string (the function_call_output).
export async function executeCoachTool(name: string, args: any, ctx: { owner: string }): Promise<string> {
  try {
    if (name === 'tavily_web_search') {
      const r = await tavilySearch(args)
      return JSON.stringify({ answer: r.answer, sources: r.sources, results: (r.results || []).slice(0, 6), error: r.error })
    }
    if (name === 'remember') {
      const r = await memRemember({ owner: ctx.owner, kind: args.kind || 'note', text: String(args.text || ''), source: 'coach-chat' })
      return JSON.stringify({ ok: true, id: r.id })
    }
    if (name === 'recall') {
      const hits = await memRecall({ owner: ctx.owner, query: String(args.query || ''), k: 6 })
      return JSON.stringify({ hits: hits.map((h) => ({ text: h.text, kind: h.kind, score: Number(h.score.toFixed(3)), createdAt: h.createdAt })) })
    }
    if (name === 'ui_action') {
      // No server work — the directive is surfaced to the app (collected from the
      // tool trace in coachChat) and executed in the browser.
      return JSON.stringify({ queued: true, action: args.action, note: 'The app will perform this action for the user now.' })
    }
    const route = ROUTES[name]
    if (!route) return JSON.stringify({ error: `unknown tool: ${name}` })

    let url = `${SELF_BASE}/${route.path(args)}`
    if (route.ownerQuery) url += (url.includes('?') ? '&' : '?') + `owner=${encodeURIComponent(ctx.owner)}`
    const init: any = { method: route.method, headers: { 'Content-Type': 'application/json' } }
    if (route.method === 'POST') init.body = JSON.stringify(route.body ? route.body(args) : {})
    const res = await fetch(url, init)
    const text = await res.text()
    // Trim large payloads so the model isn't flooded.
    return JSON.stringify({ status: res.status, data: safeParse(text) }).slice(0, 12000)
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
  }
}

function safeParse(t: string): any { try { return JSON.parse(t) } catch { return t.slice(0, 4000) } }

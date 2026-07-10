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
    fn('mail_config', 'Read the LinkedIn/mail intake watcher config (watched mailbox, folder, sources). Read-only.'),
    fn('mail_subscriptions', 'List active Microsoft Graph mail change-notification subscriptions. Read-only diagnostic.'),
    fn('remember', 'Save a durable memory the coach should recall in future conversations (a preference, fact, decision, or context).', { text: { type: 'string' }, kind: { type: 'string', enum: ['note', 'fact', 'preference', 'decision'] } }, ['text']),
    fn('recall', 'Search the coach\'s durable memory for relevant past notes/facts.', { query: { type: 'string' } }, ['query']),
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

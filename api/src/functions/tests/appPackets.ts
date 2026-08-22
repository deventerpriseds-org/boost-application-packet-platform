import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { getGoogleOAuthToken, HAS_GOOGLE_OAUTH } from './googleAuth'
import { logUsage } from './usageMeter'
import { groundingText, resolvePostingSource } from './jdText'
import { metaFor, varsForType, copyThen, injectValues, stripLeftoverTokens, shareAnyone } from './packetTemplates'
import { buildPackageForJD } from './pipeline'
import { loadPipelineSettings } from './pipelineConfig'
import { writeSwaps } from './appSwaps'
import { writeInsertions } from './appInsertions'
import { applyCorrectionPass } from './appCorrections'
import { sourceText } from './appFacts'
import { summariseBuild } from './packetBuild'
import { approvalBlock } from './appChecks'
// The evidence pass, called in-process rather than over HTTP — see resolveEvidenceForOpp. No cycle:
// appPackets is not reachable from appRequirements (checked across all 24 modules it can reach).
import { writeEvidence, rebuildComparison, ensureRequirementCols, ensureEvidenceTable } from './appRequirements'
import { resolveOptionsFor } from './checkPrefs'
import { openAiJson } from './openaiJson'


const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const DEMO_EMAIL = 'demo@executive-engine.local'
// AI-edit model — seeded/default in code, overridable via the AI_EDIT_MODEL env
// var (OpenAI Responses API / GPT-5.6 Luna). Mirrors the Huddle app's edit call.
const AI_EDIT_MODEL = process.env.AI_EDIT_MODEL || 'gpt-5.6-luna'
const AI_EDIT_EFFORTS = ['low', 'medium', 'high', 'max']

// Reasoning models accept a `reasoning` block; sending it to a non-reasoning
// model is a hard API error, so gate on the model family.
function isReasoningModel(model: string): boolean {
  const m = model.replace(/^openai\//, '')
  return /^o\d/.test(m) || m.startsWith('gpt-5')
}
// Extract the revised text from a Responses-API payload.
function extractResponseText(json: any): string {
  if (json?.output_text) return json.output_text
  const parts = (json?.output || []).flatMap((o: any) => o?.content || [])
  const hit = parts.find((p: any) => p?.type === 'output_text' || p?.text)
  return hit?.text || ''
}
// Artifact types a packet is built from (matches the schema CHECK constraint).
const ARTIFACT_TYPES = ['resume', 'compact_resume', 'cover', 'portfolio', 'video']
const ARTIFACT_STATUSES = ['todo', 'drafting', 'review', 'changes', 'approved']

// Ensure the artifact table can hold generated text (idempotent; safe on every call).
async function ensureContentColumn(client: any) {
  await client.query(`alter table artifact add column if not exists content text`)
  await client.query(`alter table artifact add column if not exists drive_url text`)
}

// Load (or lazily create) a packet + its 5 artifact rows for an opportunity.
//
// P3-44 / D-4. `round` was READ here and in `packetShape` and written by NOTHING, so it was always
// 1: this ORDER BY was a no-op, the pick among several packets was whatever the planner returned,
// and the API reported `round: 1` forever. It is now incremented once per remediation RUN
// (`appRemediation`), which is the only thing that puts a packet through another cycle - so the
// column means something and no fourth counter was added beside insertion.loop / swap_decision.loop.
// `created_at desc` is the tiebreak the all-equal column was silently relying on.
async function loadPacket(client: any, oppId: string) {
  let pkt = (await client.query(`select * from packet where opp_id = $1 order by round desc, created_at desc limit 1`, [oppId])).rows[0]
  if (!pkt) {
    pkt = (await client.query(`insert into packet (opp_id) values ($1) returning *`, [oppId])).rows[0]
  }
  const existing = (await client.query(`select type from artifact where packet_id = $1`, [pkt.id])).rows.map((r: any) => r.type)
  const missing = ARTIFACT_TYPES.filter((t) => !existing.includes(t))
  for (const t of missing) {
    await client.query(`insert into artifact (packet_id, type) values ($1, $2)`, [pkt.id, t])
  }
  const artifacts = (await client.query(`select id, type, status, template_id, doc_url, content, drive_url, updated_at from artifact where packet_id = $1`, [pkt.id])).rows
  // Canonical ordering
  artifacts.sort((a: any, b: any) => ARTIFACT_TYPES.indexOf(a.type) - ARTIFACT_TYPES.indexOf(b.type))
  return { pkt, artifacts }
}

// Recompute packet.status from its artifacts' states.
async function recomputePacket(client: any, packetId: string) {
  const arts = (await client.query(`select status from artifact where packet_id = $1`, [packetId])).rows
  const allApproved = arts.length > 0 && arts.every((a: any) => a.status === 'approved')
  const anyStarted = arts.some((a: any) => a.status !== 'todo')
  // P2.2 — `ready` additionally requires no asset sitting at a `fail` gate. Approval is already
  // gated, but a re-run AFTER approval can turn a gate red (a new run also clears any override), and
  // without this a packet would stay `ready` while carrying a blocking finding.
  const failing = Number((await client.query(
    `select count(*)::int as n from artifact_gate g join artifact a on a.id = g.artifact_id
      where a.packet_id = $1 and g.gate = 'fail'`, [packetId])).rows[0]?.n || 0)
  const status = (allApproved && failing === 0) ? 'ready' : anyStarted ? 'review' : 'building'
  await client.query(`update packet set status = $1, updated_at = now() where id = $2`, [status, packetId])
  return status
}

function packetShape(pkt: any, artifacts: any[], opp?: any) {
  return {
    id: pkt.id, oppId: pkt.opp_id, status: pkt.status, round: pkt.round,
    jdAnalyzed: pkt.jd_analyzed,
    // D14, and the name is the misnomer: `covered_kw` holds the terms the JD-ANALYSIS MODEL CALL
    // pulled out of the posting. Nothing compared them to the candidate — see `jdAnalysisRequest`,
    // whose fragment sources are `opportunity` and `posting` and nothing else. The column keeps its
    // name deliberately: renaming it is `schema.ts` plus a migration plus every reader, which is
    // another lane's file, and a half-rename that leaves the column called one thing and the
    // payload another is worse than the misnomer. The MEANING is carried instead, by
    // `coveredKwProfileCompared` below and by the group provenance in `app/src/postingAnalysis.js`.
    coveredKw: pkt.covered_kw || [],
    // DERIVED, never a literal `false`: the same predicate, over the same request builder that
    // produced the stored array, so there is ONE answer to "was this compared to the candidate?"
    // and no second place for it to drift. This is also the artefact an api-test.yml run reads to
    // prove D14 without a browser.
    coveredKwProfileCompared: comparesToProfile(jdAnalysisRequest(opp || {}, '')),
    atsScore: pkt.ats_score,
    mustHaves: pkt.must_haves || [],
    // missingKw is DERIVED from opportunity.ats_gaps — the posting-grounded gap list produced by
    // atsScoreOne() against jd_real. It is deliberately NOT a packet column: a second gap list
    // sourced from jdAnalysis (which never reads the posting) would be a weaker parallel truth.
    // atsGapsScoredAt distinguishes "scored, no gaps" from "never scored" so the UI can say which.
    missingKw: (opp && opp.ats_gaps) || [],
    atsGapsScoredAt: (opp && opp.ats_scored_at) || null,
    approved: artifacts.filter((a) => a.status === 'approved').length, total: artifacts.length,
    artifacts: artifacts.map((a) => ({ id: a.id, type: a.type, status: a.status, templateId: a.template_id, docUrl: a.doc_url, driveUrl: a.drive_url, content: a.content, updatedAt: a.updated_at }))
  }
}

// GET /api/app/opportunity/{id}/packet — packet + artifacts (created on first access)
export async function packetGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  let client
  try {
    client = await getPgClient()
    await ensureContentColumn(client)
    await ensurePkgColumn(client)
    await ensureAnalysisCols(client)
    const opp = (await client.query(`select id, company, role, ats_gaps, ats_scored_at from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const { pkt, artifacts } = await loadPacket(client, oppId)
    // Include the assembled structured resume package so the frontend can render
    // every labeled section (Feature B) instead of only the raw content dump.
    return { status: 200, headers: HEADERS, jsonBody: { company: opp.company, role: opp.role, pkg: pkt.pkg_json || null, ...packetShape(pkt, artifacts, opp) } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/packets?owner= — all packets (one row per opp that has a packet) for the list view
export async function packetsList(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  const includeDemo = req.query.get('includeDemo') !== 'false'
  let client
  try {
    client = await getPgClient()
    const rows = (await client.query(
      `select p.id, p.opp_id, p.status, p.ats_score, o.company, o.role, o.match_score, o.stage,
              count(a.*) filter (where a.status = 'approved') as approved,
              count(a.*) as total
         from packet p
         join opportunity o on o.id = p.opp_id
         left join artifact a on a.packet_id = p.id
        where o.owner_email = $1 and not o.dismissed ${includeDemo ? '' : 'and not o.is_demo'}
        group by p.id, o.company, o.role, o.match_score, o.stage
        order by o.match_score desc nulls last`, [owner]
    )).rows
    return { status: 200, headers: HEADERS, jsonBody: { count: rows.length, packets: rows.map((r: any) => ({
      id: r.id, oppId: r.opp_id, company: r.company, role: r.role, match: r.match_score, stage: r.stage,
      status: r.status, atsScore: r.ats_score, approved: Number(r.approved), total: Number(r.total)
    })) } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

const ARTIFACT_BRIEF: Record<string, string> = {
  resume: 'a keyword-tailored executive resume (summary + 3 impact bullets) targeting this role',
  compact_resume: 'a one-page compact resume headline + 4 tight achievement bullets',
  cover: 'a concise, specific cover letter (3 short paragraphs) tailored to this company and role',
  portfolio: 'a portfolio one-pager outline: 3 case studies mapped to this role\'s likely pain points',
  video: 'a 90-second intro video script (spoken, first person) opening tailored to this company'
}

// POST /api/app/artifact/{artifactId}/generate — draft content for one artifact via OpenAI
export async function artifactGenerate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    client = await getPgClient()
    await ensureContentColumn(client)
    const art = (await client.query(`select a.*, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [art.opp_id])).rows[0]
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }

    const brief = ARTIFACT_BRIEF[art.type] || 'a tailored application asset'
    const system = `You are an executive career strategist writing polished application assets. Write ${brief}. Be specific, results-oriented, and grounded in the provided opportunity. Output plain text only (no markdown headers).`
    const user = `ROLE: ${opp.role} at ${opp.company}\nComp: ${opp.comp_range || 'n/a'}\nPersona: ${opp.persona_key}\nWhy surfaced: ${opp.why_surfaced || 'n/a'}\nCompany signals: ${(opp.company_signals || []).join('; ') || 'n/a'}\nPain hypotheses: ${(opp.pain_hypotheses || []).join('; ') || 'n/a'}\n\nWrite the asset now.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200 })
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    await logUsage(`packet:${art.type}`, 'gpt-4o-mini', data.usage)

    await client.query(
      `update artifact set content = $1, status = 'review',
         version_history = coalesce(version_history, '[]'::jsonb) || jsonb_build_object('len', $2::int),
         updated_at = now() where id = $3`,
      [content, content.length, artifactId]
    )
    const status = await recomputePacket(client, art.packet_id)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, artifactStatus: 'review', packetStatus: status, content, promptSentToAI: { model: 'gpt-4o-mini', system, user } } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/artifact/{artifactId}/status { status } — advance the artifact state machine
export async function artifactStatus(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const body = await req.json() as any
    const status = body?.status
    if (!ARTIFACT_STATUSES.includes(status)) return { status: 400, headers: HEADERS, jsonBody: { error: `invalid status; one of ${ARTIFACT_STATUSES.join(', ')}` } }
    client = await getPgClient()
    // P2.2 — the gate blocks approval SERVER-side, not merely in the UI. Checked BEFORE the update,
    // so a direct API call cannot approve an artifact whose findings block it. Only `approved` is
    // gated: moving to todo/review/rejected is how a user responds to findings, and blocking that
    // would trap the artifact in the state the findings are about.
    if (status === 'approved') {
      const block = await approvalBlock(client, artifactId)
      if (block.blocked) {
        return { status: 409, headers: HEADERS, jsonBody: { error: block.reason, gate: block.gate, artifactId } }
      }
    }
    const art = (await client.query(`update artifact set status = $1, updated_at = now() where id = $2 returning packet_id`, [status, artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const packetStatus = await recomputePacket(client, art.packet_id)
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, artifactStatus: status, packetStatus } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Find (or create) a Drive folder by name under the OAuth user's My Drive.
async function findOrCreateFolder(token: string, name: string): Promise<string> {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)
  const find = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } })
  if (find.ok) { const id = (((await find.json()) as any)?.files || [])[0]?.id; if (id) return id }
  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
  })
  const j = (await create.json()) as any
  if (!create.ok) throw new Error(`folder create HTTP ${create.status}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.id
}

const DOC_TITLE: Record<string, string> = {
  resume: 'Resume', compact_resume: 'Compact Resume', cover: 'Cover Letter', portfolio: 'Portfolio One-Pager',
}

// Cache the assembled package on the packet so building resume + cover +
// portfolio shares ONE 3-agent generation (unless regen is requested).
// must_haves is the ONLY jdAnalysis output with no existing home. `gaps` deliberately gets no
// column: opportunity.ats_gaps already holds a posting-grounded gap list (appApply.atsScoreOne),
// and a second list derived from a job title would be a weaker parallel truth.
async function ensureAnalysisCols(client: any) {
  await client.query(`alter table packet add column if not exists must_haves text[]`)
  await client.query(`alter table packet add column if not exists jd_grounded boolean`)
  await client.query(`alter table packet add column if not exists jd_analyzed_at timestamptz`)
}

async function ensurePkgColumn(client: any) {
  await client.query(`alter table packet add column if not exists pkg_json jsonb`)
}

// ONE projection for every caller that grounds generation in an opportunity. It was duplicated
// across four call sites and all four omitted jd_real, which is how generation ended up reading a
// synthesised pseudo-JD instead of the posting (X1). A single constant is what stops that recurring.
export const OPP_FIELDS = `select id, company, role, comp_range, why_surfaced, company_signals,
  pain_hypotheses, persona_key, jd_real, raw_jd from opportunity`

/**
 * The text the generator is grounded in.
 *
 * Was: a pseudo-JD assembled from role + company + why_surfaced + company_signals + pain_hypotheses,
 * with `jd_real` never selected. Every figure, quote and claim the pipeline produced was therefore
 * derived from our own metadata about the job rather than from the employer's posting — and P1.4's
 * provenance rows would have recorded those fabrications as evidence, with P8.2's figure scan
 * passing vacuously because there were no real figures to scan.
 *
 * Now: the employer's posting leads. The synthesised context is kept, clearly labelled and AFTER the
 * posting, because comp_range / company_signals / pain_hypotheses are real research the posting does
 * not carry. `grounded` says which happened, so a packet built without a posting is never presented
 * as posting-grounded. why_surfaced is dropped when a posting exists: it is the alert email, which
 * describes SIBLING jobs and is exactly what resolveJdSource refuses to parse.
 */
export function generationJd(opp: any): { jd: string; grounded: boolean } {
  const posting = resolvePostingSource(opp).text
  const context = [
    `${opp.role} at ${opp.company}.`,
    opp.comp_range ? `Comp: ${opp.comp_range}.` : '',
    (opp.company_signals || []).length ? `Company signals: ${(opp.company_signals || []).join('; ')}.` : '',
    (opp.pain_hypotheses || []).length ? `Pain hypotheses: ${(opp.pain_hypotheses || []).join('; ')}.` : '',
  ].filter(Boolean).join(' ')

  if (!posting) {
    // No posting at all: fall back to the old behaviour rather than refusing to build, but say so.
    return { jd: [context, opp.why_surfaced || ''].filter(Boolean).join(' '), grounded: false }
  }
  return {
    jd: `JOB POSTING (the employer's own words - ground every claim in this):\n${posting.slice(0, 12000)}`
      + `\n\nRESEARCH CONTEXT (our notes, NOT from the posting):\n${context}`,
    grounded: true,
  }
}

/**
 * The package this artifact will be built from — generated once and cached on the packet.
 *
 * P3-25 SPLIT THIS OUT OF `buildTemplatedArtifact`. Generation and RENDERING used to be one
 * function, so the only way to regenerate content was to also issue a Drive `files/{id}/copy`. A
 * four-pass remediation loop over four templated artifacts would therefore have created 16 Google
 * files per packet on the quota-bearing OAuth account. Worse, per D-9 there is no Drive DELETE
 * anywhere in this codebase and `artifact.doc_url` is simply overwritten, so all 15 superseded files
 * would be orphaned rather than replaced. Every rebuild already orphans ONE file today — the loop
 * would have multiplied an existing leak, not introduced a new one, which is why the fix is to make
 * rendering a separate step the loop calls exactly once at the end.
 */
export async function ensurePackage(client: any, art: any, opp: any, regen: boolean): Promise<{
  pkg: Record<string, string | null>; generated: boolean; grounded: boolean
  // P7 item 6 - THE FAILURE PATH. `buildPackageForJD` returns `warnings` and `qcApplied` and this
  // file read NEITHER, so a build that hit a config gap, lost a section to an unmapped title, or
  // had its ATS-QC call come back empty returned `ok:true` with no hint anything was wrong. The
  // only trace was a console.warn nobody reads. They travel with the package now, so every endpoint
  // that builds one can say so.
  warnings: string[]; qcApplied: boolean | null
}> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  await ensurePkgColumn(client)
  await ensureAnalysisCols(client)
  const pkt = (await client.query(`select pkg_json, jd_grounded from packet where id = $1`, [art.packet_id])).rows[0]
  const { jd, grounded } = generationJd(opp)

  // A package cached BEFORE X1 was generated from the synthesised pseudo-JD. Reusing it would make
  // the fix inert for every packet that already exists — the cache would keep serving ungrounded
  // content forever. Regenerate when we can now ground it and previously could not.
  const staleUngrounded = grounded && pkt?.jd_grounded !== true
  const cached: Record<string, string | null> | null = (!regen && !staleUngrounded && pkt?.pkg_json) ? pkt.pkg_json : null
  // A cached package carries no warnings of its own: they described the run that PRODUCED it, and
  // reporting them again would attribute a past run's problems to this one. `qcApplied: null` says
  // "not measured on this call" rather than false, which would read as "QC ran and did nothing".
  if (cached) return { pkg: cached, generated: false, grounded: pkt?.jd_grounded === true, warnings: [], qcApplied: null }

  const roleType = opp.persona_key || opp.role || 'Executive'
  const built = await buildPackageForJD({ key, jd, roleType, company: opp.company, jobTitle: opp.role })
  const pkg = built.pkg
  // D8 - this used to pass `{}`, which logUsage discards, so every production packet build
  // recorded nothing. Each of the three generation passes is metered on its own so the cost of
  // the QC pass is separable from the cost of writing the resume.
  for (const u of built.usage) await logUsage(`packet:${art.type}:generate:${u.pass}`, 'gpt-4o-mini', u.usage)

  // P8.1 / R1 — correct before the user sees it, and HERE rather than beside the check that
  // motivates it. Everything below this line reads the corrected package: the update, writeSwaps,
  // writeInsertions and every later check. Run it in appChecks instead and pkg_json and
  // insertion.after_text are both written from the ORIGINAL text while the user reads the
  // corrected document — and the remediation loop credits closures against text that never
  // shipped, because realEdits() and creditClosures() both read after_text.
  const posting = resolvePostingSource(opp)
  const profileRead = await sourceText().catch(() => ({ text: '' }))
  const corrections = await applyCorrectionPass(client, {
    artifactId: art.id, pkg, postingText: posting.text, profileText: profileRead.text,
    // loop 0 — the baseline, for the same reason writeSwaps uses it here: a whole-package
    // generation is not a remediation pass. Passes 1..n are scoped and are written by the loop.
    loop: 0,
  })

  await client.query(`update packet set pkg_json = $1, jd_grounded = $2, updated_at = now() where id = $3`,
    [JSON.stringify(pkg), grounded, art.packet_id])
  // P1.3 — record what the two passes changed, while both payloads are still in hand. They are
  // discarded once this scope ends, and the merged package alone cannot show what it replaced.
  // Never fatal: this is provenance about a package that is already built and stored.
  // `loop: 0` — the baseline. A whole-package generation is not a remediation pass; passes 1..n are
  // scoped and are written by the loop (decision 14).
  try {
    await writeSwaps(client, art.packet_id, opp.id, {
      call1: built.calls.c1, call3: built.calls.c3, pkg,
      profileText: built.profileText, omitList: built.omitList, loop: 0,
    })
  } catch (e) { console.warn('[packets] swap provenance not recorded:', String(e)) }
  return { pkg, generated: true, grounded, warnings: built.warnings, qcApplied: built.qcApplied }
}

/**
 * Copy the template, inject the package, and record what landed where. ONE Drive copy per call.
 *
 * The remediation loop calls this exactly once per artifact, AFTER its passes have finished — so a
 * packet completing an N-pass loop over 4 templated artifacts issues 4 copies, not 4N (P3-25).
 * `loop` is the remediation pass the rendered package came from, and it is what the insertion rows
 * are keyed on; it does NOT count renders.
 */
export async function renderArtifact(client: any, art: any, opp: any, pkg: Record<string, string | null>, opts?: { loop?: number }) {
  // P7 item 8 - `TEMPLATE_META` is the SEED table, not the answer. `google.resumeTemplateId`,
  // `google.portfolioTemplateId`, `google.coverLetterTemplateId` and `google.outputFolderId` have
  // been writable in Auth & Config all along and were read by nothing, so an owner could set a
  // template id and watch the production packet builder copy a different document.
  const settings = await loadPipelineSettings()
  const meta = metaFor(art.type, {
    resumeTemplateId: settings.resumeTemplateId.value,
    portfolioTemplateId: settings.portfolioTemplateId.value,
    coverLetterTemplateId: settings.coverLetterTemplateId.value,
  })
  if (!meta) return null
  // P3-24 / D-9. There is no Drive DELETE anywhere in this codebase and doc_url is simply
  // overwritten, so every rebuild ALREADY orphans a file - the loop would only multiply it. The id
  // being superseded is returned so the caller can RECORD it: an orphan population nobody can query
  // is one nobody can ever clean up. Deleting them is a separate owner decision (plan 11-18).
  const superseded = (await client.query(`select doc_url from artifact where id=$1`, [art.id])).rows[0]?.doc_url || null
  const token = await getGoogleOAuthToken()
  const name = `${opp.company || 'Opportunity'} — ${meta.kindLabel}`
  // D13 - the same orphan class the MT-22 path had, in the path that actually ships. The copy
  // succeeds, then `injectValues` / `stripLeftoverTokens` / `shareAnyone` can throw, and the id of
  // the file already created lived only in this frame: `artifact.doc_url` is not written until the
  // bottom of this function, so a throw above it left a real Google file referenced by nothing at
  // all. `copyThen` deletes the copy before rethrowing. Deliberately NOT the superseded-file case -
  // `supersededDocUrl` is still returned for the caller to record, and reaping those is a separate
  // owner decision (P3-24 / D-9).
  const { id, result: cleaned } = await copyThen(token, meta.templateId, name, settings.outputFolderId.value, async (fileId: string) => {
    await injectValues(token, fileId, varsForType(art.type, pkg), meta.isSlides)
    const stripped = await stripLeftoverTokens(token, fileId, meta.isSlides)
    await shareAnyone(token, fileId)
    return stripped
  })
  const url = meta.isSlides ? `https://docs.google.com/presentation/d/${id}/edit` : `https://docs.google.com/document/d/${id}/edit`

  // Store a readable preview of what was injected + the doc url.
  // P1.4 — record what landed in each merge field. Runs on EVERY build, including one that reused a
  // cached package: a cached package is still injected into a fresh document, so the artifact still
  // gains rows. Never fatal — the document exists either way, and losing provenance must not lose it.
  try {
    await writeInsertions(client, art.id, opp.id, { type: art.type, pkg, loop: Math.max(0, Number(opts?.loop ?? 0) | 0) })
  } catch (e) { console.warn('[packets] insertion provenance not recorded:', String(e)) }

  const preview = meta.placeholders.map((p) => (pkg[p] ? `${p}:\n${pkg[p]}` : '')).filter(Boolean).join('\n\n')
  await client.query(`update artifact set doc_url = $1, content = coalesce(nullif(content,''), $2), status = case when status = 'todo' then 'review' else status end, updated_at = now() where id = $3`, [url, preview, art.id])
  return { url, isSlides: meta.isSlides, cleaned, kindLabel: meta.kindLabel, title: name, supersededDocUrl: superseded }
}

// G6 — build a real artifact by COPYING its template and filling {{placeholders}}
// with the proven pipeline package (assemblePackage). Returns null if the type
// has no template (caller falls back to the legacy prose path).
// Composition of the two steps above, so the single-artifact endpoints keep their exact behaviour
// while the loop can take the two halves separately.
async function buildTemplatedArtifact(client: any, art: any, opp: any, regen: boolean) {
  if (!metaFor(art.type)) return null
  const { pkg, warnings, qcApplied } = await ensurePackage(client, art, opp, regen)
  const rendered = await renderArtifact(client, art, opp, pkg)
  // P7 item 6 - carried to the caller so a partial build cannot report clean success.
  return rendered && { ...rendered, warnings, qcApplied }
}

// POST /api/app/artifact/{artifactId}/document — turn the generated text into a
// real, shareable Google Doc (Drive create → insert content → anyone-reader).
// Stores the doc URL on artifact.doc_url. 'video' artifacts use the HeyGen path.
export async function artifactDocument(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_REFRESH_TOKEN not set — run the Google consent flow first (owns Drive quota).' } }
    client = await getPgClient()
    await ensureContentColumn(client)
    const art = (await client.query(`select a.*, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    if (art.type === 'video') return { status: 400, headers: HEADERS, jsonBody: { error: 'video artifacts are rendered via the HeyGen video action, not a document' } }
    const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [art.opp_id])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }

    // G6: if this type has a designed template, COPY it and fill placeholders.
    if (metaFor(art.type)) {
      const regen = ((await req.json().catch(() => ({}))) as any)?.regen === true
      const built = await buildTemplatedArtifact(client, art, opp, regen)
      const packetStatus = await recomputePacket(client, art.packet_id)
      // P7 item 6 — `ok` says whether the build was CLEAN, not merely whether it returned. A run
      // that lost a section to an unmapped title, or whose ATS-QC call came back empty, still
      // produces a document; it must not also report unqualified success.
      return { status: 200, headers: HEADERS, jsonBody: { ok: !built!.warnings?.length, artifactId, type: art.type, docUrl: built!.url, deckUrl: built!.isSlides ? built!.url : undefined, title: built!.title, cleanedTokens: built!.cleaned, templated: true, packetStatus, warnings: built!.warnings || [], qcApplied: built!.qcApplied } }
    }

    if (!art.content || !art.content.trim()) return { status: 400, headers: HEADERS, jsonBody: { error: 'generate the content first, then create the document' } }

    const token = await getGoogleOAuthToken()
    const folderId = await findOrCreateFolder(token, 'Executive Engine Packets')
    const title = `${opp?.company || 'Opportunity'} — ${DOC_TITLE[art.type] || art.type}`

    // 1. Create an empty Google Doc in the packets folder.
    const created = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId] })
    })
    const cj = (await created.json()) as any
    if (!created.ok) throw new Error(`Doc create HTTP ${created.status}: ${JSON.stringify(cj).slice(0, 200)}`)
    const docId = cj.id

    // 2. Insert the generated text at the start of the document.
    const upd = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: art.content } }] })
    })
    if (!upd.ok) throw new Error(`Docs insert HTTP ${upd.status}: ${(await upd.text()).slice(0, 200)}`)

    // 3. Make it viewable by anyone with the link.
    await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`
    await client.query(`update artifact set doc_url = $1, updated_at = now() where id = $2`, [docUrl, artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, docUrl, title } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Split generated prose into up to N slide-sized sections: each slide gets a
// short title (first line/sentence) and the rest as body.
function toSlideSections(content: string, max = 4): { title: string; body: string }[] {
  const chunks = content.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean).slice(0, max)
  return chunks.map((chunk, i) => {
    const firstLine = chunk.split('\n')[0].replace(/^[#*\-\d.\s]+/, '').trim()
    const short = firstLine.length <= 70 ? firstLine : firstLine.slice(0, 67) + '…'
    const body = chunk.slice(chunk.indexOf('\n') + 1).trim() || chunk
    // If the chunk was a single line, keep it as body under a generic title.
    if (!chunk.includes('\n')) return { title: ['Overview', 'Impact', 'Approach', 'Fit'][i] || 'Highlights', body: chunk }
    return { title: short, body }
  })
}

// POST /api/app/artifact/{artifactId}/slides — turn the portfolio text into a
// real Google Slides deck (title slide + section slides), anyone-with-link
// reader. Stores the deck URL on artifact.doc_url.
export async function artifactSlides(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_REFRESH_TOKEN not set — run the Google consent flow first.' } }
    client = await getPgClient()
    await ensureContentColumn(client)
    const art = (await client.query(`select a.*, p.opp_id from artifact a join packet p on p.id = a.packet_id where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [art.opp_id])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }

    // G6: COPY the designed Slides template and fill its placeholders.
    if (metaFor(art.type)) {
      const regen = ((await req.json().catch(() => ({}))) as any)?.regen === true
      const built = await buildTemplatedArtifact(client, art, opp, regen)
      const packetStatus = await recomputePacket(client, art.packet_id)
      return { status: 200, headers: HEADERS, jsonBody: { ok: !built!.warnings?.length, artifactId, type: art.type, deckUrl: built!.url, docUrl: built!.url, title: built!.title, cleanedTokens: built!.cleaned, templated: true, packetStatus, warnings: built!.warnings || [], qcApplied: built!.qcApplied } }
    }

    if (!art.content || !art.content.trim()) return { status: 400, headers: HEADERS, jsonBody: { error: 'generate the content first, then create the deck' } }

    const token = await getGoogleOAuthToken()
    const folderId = await findOrCreateFolder(token, 'Executive Engine Packets')
    const title = `${opp?.company || 'Opportunity'} — Portfolio`

    // 1. Create the presentation in the packets folder (Drive scope).
    const created = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.presentation', parents: [folderId] })
    })
    const cj = (await created.json()) as any
    if (!created.ok) throw new Error(`Slides create HTTP ${created.status}: ${JSON.stringify(cj).slice(0, 200)}`)
    const presId = cj.id

    // 2. Find the default slide so we can drop it after adding our own.
    const pres = await fetch(`https://slides.googleapis.com/v1/presentations/${presId}`, { headers: { Authorization: `Bearer ${token}` } })
    const pj = (await pres.json()) as any
    if (!pres.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `Slides read HTTP ${pres.status}: ${JSON.stringify(pj).slice(0, 200)}`, hint: pres.status === 403 ? 'The Google OAuth token needs the presentations scope — re-run consent with https://www.googleapis.com/auth/presentations.' : undefined } }
    const defaultSlideId = pj?.slides?.[0]?.objectId

    // 3. Build a title slide + one slide per section via batchUpdate.
    const sections = toSlideSections(art.content, 4)
    const requests: any[] = []
    // Title slide
    requests.push({ createSlide: { objectId: 's_title', slideLayoutReference: { predefinedLayout: 'TITLE' }, placeholderIdMappings: [
      { layoutPlaceholder: { type: 'CENTERED_TITLE' }, objectId: 'p_title' },
      { layoutPlaceholder: { type: 'SUBTITLE' }, objectId: 'p_sub' },
    ] } })
    requests.push({ insertText: { objectId: 'p_title', text: `${opp?.company || ''} — Portfolio` } })
    requests.push({ insertText: { objectId: 'p_sub', text: opp?.role || '' } })
    // Section slides
    sections.forEach((s, i) => {
      const tId = `title_${i}`, bId = `body_${i}`
      requests.push({ createSlide: { objectId: `slide_${i}`, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' }, placeholderIdMappings: [
        { layoutPlaceholder: { type: 'TITLE' }, objectId: tId },
        { layoutPlaceholder: { type: 'BODY' }, objectId: bId },
      ] } })
      requests.push({ insertText: { objectId: tId, text: s.title } })
      requests.push({ insertText: { objectId: bId, text: s.body.slice(0, 1800) } })
    })
    // Remove the empty default slide last.
    if (defaultSlideId) requests.push({ deleteObject: { objectId: defaultSlideId } })

    const upd = await fetch(`https://slides.googleapis.com/v1/presentations/${presId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requests })
    })
    if (!upd.ok) return { status: 200, headers: HEADERS, jsonBody: { error: `Slides batchUpdate HTTP ${upd.status}: ${(await upd.text()).slice(0, 300)}` } }

    // 4. Anyone-with-link reader.
    await fetch(`https://www.googleapis.com/drive/v3/files/${presId}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })

    const deckUrl = `https://docs.google.com/presentation/d/${presId}/edit`
    await client.query(`update artifact set doc_url = $1, updated_at = now() where id = $2`, [deckUrl, artifactId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, artifactId, type: art.type, deckUrl, slides: sections.length + 1, title } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

const SELF_BASE = process.env.COACH_SELF_BASE || 'https://job-platform-api.azurewebsites.net/api'
/**
 * Resolve and store evidence for one opportunity, in-process.
 *
 * Mirrors what `evidenceResolve` does after its auth guard — same profile read, same options, same
 * comparison rebuild — so the build path and the route cannot drift into two different answers.
 * Errors are RETURNED rather than thrown: a build must not fail because QC could not run, but it
 * must not report clean either, so the caller folds this into `warnings`.
 */
async function resolveEvidenceForOpp(client: any, oppId: string, owner: string): Promise<any> {
  try {
    // THE OBJECT-LEVEL CHECK, and its absence was a real regression an independent review caught.
    // The comment above this function claimed parity with `evidenceResolve` "after its auth guard".
    // That was false in the way that matters: the route ALSO does
    // `where id=$1 and owner_email=$2` and 404s, and this copy did not. `requireWrite` on the
    // caller proves SOMEONE is signed in; it does not prove they own THIS opportunity. Those are
    // different gates and I conflated them — authentication is not authorization.
    const owned = (await client.query(
      `select 1 from opportunity where id=$1 and owner_email=$2`, [oppId, owner])).rows[0]
    if (!owned) return { error: 'this opportunity does not belong to the signed-in owner' }
    await ensureRequirementCols(client)
    await ensureEvidenceTable(client)
    const profile = await sourceText()
    if (!profile.records.length) {
      // An unreadable profile is NOT proof the profile supports nothing, so nothing is written —
      // the same refusal the route makes, for the same reason.
      return { error: 'no profile record could be read, so no coverage claim can be evidenced' }
    }
    const opts = await resolveOptionsFor(client, owner)
    const out = await writeEvidence(client, oppId, profile.records, opts, undefined,
      opts.escalate === true ? openAiJson({ feature: 'evidence:escalate' }) : undefined)
    await rebuildComparison(client, oppId, owner, profile.records)
    return out
  } catch (e: any) {
    return { error: String(e?.message || e).slice(0, 200) }
  }
}

async function selfPost(path: string, body: any): Promise<any> {
  try {
    const r = await fetch(`${SELF_BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    return await r.json().catch(() => ({}))
  } catch (e) { return { error: String(e) } }
}

// POST /api/app/opportunity/{id}/packet/build-all — build the ENTIRE packet in one
// call: every templated artifact (resume + compact Docs, cover + portfolio Slides)
// as real Google files, sharing one generation. Optionally seed the cadence and
// DRAFT (never send) a cold email. This is the "make it start to finish" endpoint.
export async function packetBuildAll(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const owner = resolveOwner(req).owner
  let body: any = {}; try { body = await req.json() } catch {}
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!HAS_GOOGLE_OAUTH) return { status: 200, headers: HEADERS, jsonBody: { error: 'GOOGLE_REFRESH_TOKEN not set' } }
    client = await getPgClient(); await ensureContentColumn(client)
    const opp = (await client.query(`${OPP_FIELDS} where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const { pkt, artifacts } = await loadPacket(client, oppId)
    const results: any[] = []
    for (const a of artifacts) {
      if (!metaFor(a.type)) continue // skip video (HeyGen) + non-templated
      try {
        // X2: this was hardcoded `false`, so a rebuild-all could never escape the cache and every
        // remediation loop (P3.1) would have reported looping while changing nothing.
        const built = await buildTemplatedArtifact(client, { ...a, packet_id: pkt.id, opp_id: oppId }, opp, body?.regen === true)
        results.push({ type: a.type, url: built!.url, cleanedTokens: built!.cleaned,
                       warnings: built!.warnings || [], qcApplied: built!.qcApplied })
      } catch (e) { results.push({ type: a.type, error: String(e) }) }
    }
    // D:build-runs-no-qc — THE EVIDENCE RESOLVER NOW HAS A CALLER IN THE PRODUCT.
    //
    // Until this line it had none. `POST /api/app/opportunity/{id}/evidence` was deployed, returned
    // 200, and populated an `evidenceHealth` block whenever it was called — and the only calls it
    // had ever received were workflow dispatches made while diagnosing why `requirement_evidence`
    // was empty. A full build moved `check_result` 60->60 and `requirement_evidence` 0->0 (run
    // 32487630490). Nothing distinguished "no data yet" from "no caller", which is why it survived.
    //
    // AFTER the artifacts exist, so the excerpts are resolved against the profile the documents were
    // actually built from, and this is where the owner's escalation setting takes effect: the route
    // supplies the model transport when they have switched it on, so a saved opportunity that is
    // built picks up proposed evidence for the requirements no rule could reach.
    //
    // FAILURE IS NON-FATAL AND VISIBLE. `selfPost` swallows transport errors into `{error}`, and a
    // build must not fail because QC could not run — but it must not report clean either, so the
    // outcome joins `warnings` where `summariseBuild` already surfaces partial success.
    // IN-PROCESS, NOT OVER HTTP, and the first version of this line was a real defect rather than a
    // style choice. It called the route through `selfPost`, which sends no Authorization header,
    // while `evidenceResolve` requires a verified session — so every build logged "evidence resolve
    // did not run: sign in required to modify this workspace" (run 32547019724) and the evidence
    // pass never once ran on the build path. I closed `D:build-runs-no-qc` on an api-test dispatch
    // that hit the route DIRECTLY with a minted token, which is a different path from the one the
    // row was about; the row is reopened.
    //
    // Forwarding a token would work and is the wrong fix. This function already holds an
    // authenticated `client` and the resolved `owner`, so the honest call is the function itself:
    // no HTTP hop, no credential to mint or leak, and nothing added to the four-minute gateway
    // budget that D35 is already losing. `requireWrite` guards the ROUTE because a route is
    // reachable by anyone; this caller is already past that gate.
    const evidence = await resolveEvidenceForOpp(client, oppId, owner)
    // PERSIST THE OUTCOME BEFORE RETURNING IT. The response below is routinely lost — `build-all`
    // runs ~3 minutes and the gateway cuts at 4 (D35, measured twice) — and `warnings` is the only
    // place the discarded-section list and the Call-2 parse failures have ever existed. Two open
    // findings are un-diagnosable for exactly that reason. Written before the return, so a build
    // whose response never arrives still leaves its diagnosis behind.
    try {
      await client.query(
        `update packet set last_build = $2 where id = $1`,
        [pkt.id, JSON.stringify({
          at: new Date().toISOString(), regen: body?.regen === true,
          artifacts: results.map((r: any) => ({
            type: r.type, error: r.error || null,
            warnings: r.warnings || [], qcApplied: r.qcApplied ?? null,
          })),
        })])
    } catch (e) { context.log('last_build persist failed', String(e)) }
    const packetStatus = await recomputePacket(client, pkt.id)
    let cadenceSeeded = false, outreachDrafted = false
    if (body?.seedCadence === true) { const r = await selfPost(`app/opportunity/${oppId}/cadence?owner=${encodeURIComponent(owner)}`, {}); cadenceSeeded = !r?.error }
    if (body?.draftOutreach === true) { const r = await selfPost(`app/opportunity/${oppId}/outreach/generate?owner=${encodeURIComponent(owner)}`, { channel: 'coldEmail' }); outreachDrafted = !r?.error }
    // P7 item 6 — the claim logic is in `packetBuild.summariseBuild`, which a test can exercise with
    // real inputs. It used to be inline here, where nothing without Drive, Postgres and OpenAI could
    // reach it, and the guards written for it tested the source text instead and were inert.
    const summary = summariseBuild(results)
    return { status: 200, headers: HEADERS, jsonBody: {
      ok: summary.ok, oppId, company: opp.company, artifacts: results,
      built: summary.built, failed: summary.failed,
      warnings: evidence?.error
        ? [...summary.warnings, `evidence resolve did not run: ${String(evidence.error).slice(0, 200)}`]
        : summary.warnings,
      // The measured result, not a boolean. `evidenced`/`proposed`/`escalated` are what make a
      // coverage change attributable later — a reviewer can tell a better profile from a chattier
      // model only if the run recorded which one moved.
      evidence: evidence?.error ? { error: String(evidence.error).slice(0, 200) } : {
        total: evidence?.total ?? null, evidenced: evidence?.evidenced ?? null,
        proposed: evidence?.proposed ?? 0, escalated: evidence?.escalated ?? 0,
        refused: evidence?.refused ?? null,
      },
      packetStatus, cadenceSeeded, outreachDrafted, sent: false, note: summary.note } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// ── D14: what the JD-analysis call is actually GIVEN ────────────────────────────────────────────
//
// `packet.covered_kw` is filled by the model call below, and the column name is a misnomer that has
// already misled one screen into printing a green "N covered" count. The word "covered" is a claim
// about the CANDIDATE, and this call has never been shown the candidate.
//
// D14 asked for one of two fixes: (a) compare the keywords against the profile so "covered" becomes
// true, or (b) relabel so the list says what it is. This lane chose (b), and the reason is
// "extend, don't duplicate": three systems already measure coverage against the candidate —
// `requirement_evidence` + the P8.3 evidence resolver (verbatim profile excerpts), `artifact_score
// .keyword_coverage` (measured against the published ATS term library), and the P8.4 posting-vs-
// profile dimension comparison. A fourth number named "keyword coverage", derived from a model's
// free-text guess at "ATS keywords for this role", would have to agree with all three and could
// not, which is exactly the mismatched-number failure this layer exists to prevent. `requirements
// .ts` already declares `model_keyword` NEVER SCOREABLE for the same reason.
//
// A comment saying so is prose, and prose does not run. So the provenance is CONSTRUCTED rather
// than asserted: the user message is assembled from labelled fragments, and `sources` is the list
// of labels of the fragments that actually contributed text. It cannot drift from `user`, because
// the same array produces both. `comparesToProfile()` then answers D14's question from that list,
// and `H:jd-analysis-sees-no-profile` exercises both directions of it.

/** One labelled piece of the JD-analysis user message. `source` names where the text came from. */
export interface JdAnalysisFragment { source: string; label: string; text: string }

/**
 * Fragment sources that are the CANDIDATE's stored profile.
 *
 * Empty of nothing by accident: `appFacts.sourceText()` is the only reader of the profile in this
 * codebase, and `jdAnalysisFragments` does not call it. The set exists so that the day somebody
 * wires the profile in, they have to name the fragment — and the moment they do, `comparesToProfile`
 * flips and the surfaces that describe this list stop having to say "never compared".
 */
export const PROFILE_SOURCES = new Set(['master_context', 'resume_template', 'owner_fact', 'requirement_evidence'])

/** True only when the request carries candidate-profile text. Derived from what was assembled. */
export function comparesToProfile(req: { sources: string[] }): boolean {
  return (req.sources || []).some(s => PROFILE_SOURCES.has(s))
}

export interface JdAnalysisRequest {
  system: string
  user: string
  /** The stored posting was long enough to analyse — same rule as `appApply.atsScoreOne`. */
  grounded: boolean
  /** Labels of every fragment that contributed text to `user`, in order. */
  sources: string[]
}

/**
 * Build the JD-analysis model request. PURE — no pg, no network, no @azure/functions.
 *
 * Byte-for-byte the same two messages the handler sent before this was extracted; the extraction is
 * what makes the claim testable at all. The GROUNDED and UNGROUNDED user messages are different
 * shapes (the ungrounded one falls back to the enrichment fields because there is no posting), and
 * both are assembled here so neither can quietly acquire a profile input without a source label.
 */
export function jdAnalysisRequest(opp: any, postingText: string): JdAnalysisRequest {
  const grounded = (postingText || '').length >= 200
  const frags: JdAnalysisFragment[] = grounded
    ? [
        { source: 'opportunity', label: 'Role', text: `${opp?.role} at ${opp?.company}` },
        { source: 'opportunity', label: 'Comp', text: String(opp?.comp_range || 'n/a') },
        { source: 'posting', label: 'JOB DESCRIPTION', text: String(postingText).slice(0, 6000) },
      ]
    : [
        { source: 'opportunity', label: 'Role', text: `${opp?.role} at ${opp?.company}` },
        { source: 'opportunity', label: 'Comp', text: String(opp?.comp_range || 'n/a') },
        { source: 'opportunity', label: 'Context', text: String(opp?.why_surfaced || '') },
        { source: 'opportunity', label: 'Signals', text: (opp?.company_signals || []).join('; ') },
        { source: 'opportunity', label: 'Pains', text: (opp?.pain_hypotheses || []).join('; ') },
      ]
  const user = grounded
    ? `${frags[0].label}: ${frags[0].text}\n${frags[1].label}: ${frags[1].text}\n\n${frags[2].label}:\n${frags[2].text}`
    : frags.map(f => `${f.label}: ${f.text}`).join('\n')
  return {
    system: JD_ANALYSIS_SYSTEM,
    user,
    grounded,
    sources: frags.map(f => f.source),
  }
}

/**
 * The system message. `keywords` is deliberately still described to the model as "ATS keywords for
 * this role" — that IS what the call produces, and rewording the instruction would not make the
 * output a comparison. What changed is that nothing downstream calls the result coverage.
 */
export const JD_ANALYSIS_SYSTEM = 'You are an ATS/JD analyst. Return ONLY JSON: {"keywords":[],"mustHaves":[],"atsScore":<0-100 int>,"gaps":[]}. keywords = ATS keywords for this role; mustHaves = hard requirements; gaps = likely gaps for a senior exec candidate.'

// POST /api/app/opportunity/{id}/jd-analysis — JD/ATS analysis: keywords, must-haves,
// ATS score, gaps. Stores on the packet (jd_analyzed, ats_score, covered_kw).
export async function jdAnalysis(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient(); await ensureContentColumn(client); await ensureAnalysisCols(client)
    const opp = (await client.query(`select company, role, comp_range, why_surfaced, company_signals, pain_hypotheses, jd_real, jd_summary, jd_requirements from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const { pkt } = await loadPacket(client, oppId)

    // IDEMPOTENT: re-running without {force:true} returns what was stored and makes NO model call.
    // Previously every invocation hit OpenAI even though the result was already persisted.
    const force = (await req.json().catch(() => ({})) as any)?.force === true
    if (!force && pkt.jd_analyzed) {
      // jd_grounded is NULL for every packet analyzed before this shipped, and the writer below is
      // skipped on this path — so it would stay NULL forever. Grounding is a property of the STORED
      // posting, not of the analysis, so it can be backfilled here with no model call.
      let g = pkt.jd_grounded
      if (g === null || g === undefined) {
        g = groundingText(opp).length >= 200
        await client.query(`update packet set jd_grounded = $1 where id = $2`, [g, pkt.id])
      }
      // The stored array came from the same call, so the same provenance holds. Computing it from
      // an empty source list rather than hardcoding `false` keeps ONE answer to the question.
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, cached: true, grounded: g, analysis: { keywords: pkt.covered_kw || [], keywordsProfileCompared: comparesToProfile({ sources: jdAnalysisRequest(opp, groundingText(opp)).sources }), mustHaves: pkt.must_haves || [], atsScore: pkt.ats_score, gaps: [] } } }
    }

    // GROUNDING: prefer the real posting. The previous prompt saw only role/company/comp/why_surfaced
    // and signals, so its "ATS keywords" described a job TITLE, not this posting. Same normalization
    // as appApply.atsScoreOne so the two agree on what the posting text is.
    const postingText = groundingText(opp)
    // D14 — see `jdAnalysisRequest`. The two messages are unchanged; building them there is what
    // lets `comparesToProfile` answer "is this list a coverage measurement?" from what was actually
    // assembled rather than from a comment.
    const { system, user, grounded, sources } = jdAnalysisRequest(opp, postingText)
    const profileCompared = comparesToProfile({ sources })
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 900 }) })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
    const data = await res.json() as any
    let a: any = {}; try { a = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch {}
    await logUsage('packet:jd-analysis', 'gpt-4o-mini', data.usage)
    const kws = Array.isArray(a.keywords) ? a.keywords.map(String) : []
    const ats = Number.isFinite(a.atsScore) ? Math.round(a.atsScore) : null
    const mustHaves = Array.isArray(a.mustHaves) ? a.mustHaves.map(String) : []
    // must_haves persisted (nothing else holds it). `gaps` deliberately NOT persisted — see
    // ensureAnalysisCols: opportunity.ats_gaps is the posting-grounded gap list and stays the one source.
    await client.query(
      `update packet set jd_analyzed = true, ats_score = $1, covered_kw = $2, must_haves = $3, jd_grounded = $4, jd_analyzed_at = now(), updated_at = now() where id = $5`,
      [ats, kws, mustHaves, grounded, pkt.id])
    // `keywordsProfileCompared` travels WITH the array, so a caller cannot read `keywords` without
    // being told whether anything compared them to the candidate. It is computed from the request
    // that was actually sent, never declared.
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, cached: false, grounded, sourceChars: postingText.length, analysis: { keywords: kws, keywordsProfileCompared: profileCompared, mustHaves, atsScore: ats, gaps: a.gaps || [] } } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/enrich — company signals, stakeholders, pain
// hypotheses. Updates the opportunity.
export async function opportunityEnrich(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()
    const opp = (await client.query(`select company, role, why_surfaced from opportunity where id = $1`, [oppId])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }
    const system = 'You are a go-to-market researcher. Return ONLY JSON: {"companySignals":[],"stakeholders":[],"painHypotheses":[]}. companySignals = recent, plausible company signals; stakeholders = likely hiring stakeholders (title level); painHypotheses = the pains this hire likely solves.'
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: `Company: ${opp.company}\nRole: ${opp.role}\nContext: ${opp.why_surfaced || ''}` }], max_tokens: 800 }) })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
    const data = await res.json() as any
    let a: any = {}; try { a = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch {}
    await logUsage('opportunity:enrich', 'gpt-4o-mini', data.usage)
    const signals = Array.isArray(a.companySignals) ? a.companySignals.map(String) : []
    const pains = Array.isArray(a.painHypotheses) ? a.painHypotheses.map(String) : []
    // company_signals / pain_hypotheses are jsonb → pass JSON text.
    await client.query(`update opportunity set company_signals = $1::jsonb, pain_hypotheses = $2::jsonb, updated_at = now() where id = $3`, [JSON.stringify(signals), JSON.stringify(pains), oppId])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, enrichment: { companySignals: signals, stakeholders: a.stakeholders || [], painHypotheses: pains } } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/artifact/{artifactId}/content — save manual edits to an artifact.
// Body { content?: string, pkg?: object }. Content is written to artifact.content;
// pkg is merged into packet.pkg_json so Create-Doc reuses the edits (the templated
// builder reuses cached pkg_json unless regen).
export async function artifactContent(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const body = (await req.json().catch(() => ({}))) as any
    client = await getPgClient()
    await ensureContentColumn(client)
    await ensurePkgColumn(client)
    const art = (await client.query(`select a.id, a.packet_id, a.content from artifact a where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }

    let content = art.content
    if (typeof body?.content === 'string') {
      content = body.content
      await client.query(`update artifact set content = $1, updated_at = now() where id = $2`, [content, artifactId])
    }

    let pkg: any = null
    if (body?.pkg && typeof body.pkg === 'object') {
      const cur = (await client.query(`select pkg_json from packet where id = $1`, [art.packet_id])).rows[0]?.pkg_json || {}
      pkg = { ...cur, ...body.pkg }
      await client.query(`update packet set pkg_json = $1, updated_at = now() where id = $2`, [JSON.stringify(pkg), art.packet_id])
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, content, pkg } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/artifact/{artifactId}/ai-edit — apply a natural-language edit to a
// resume section via the OpenAI Responses API (GPT-5.6 Luna). Body
// { instruction, effort?, section?, content? }. Persists the revised text into the
// named packet.pkg_json[section] (or artifact.content when no section given).
export async function artifactAiEdit(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const key = process.env.OPENAI_API_KEY
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    const body = (await req.json().catch(() => ({}))) as any
    const instruction = String(body?.instruction || '').trim()
    if (!instruction) return { status: 400, headers: HEADERS, jsonBody: { error: 'instruction required' } }
    const effort = AI_EDIT_EFFORTS.includes(body?.effort) ? body.effort : 'medium'
    const section = typeof body?.section === 'string' && body.section ? body.section : null

    client = await getPgClient()
    await ensureContentColumn(client)
    await ensurePkgColumn(client)
    const art = (await client.query(`select a.id, a.packet_id, a.content from artifact a where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const pkgRow = (await client.query(`select pkg_json from packet where id = $1`, [art.packet_id])).rows[0]
    const pkg: any = pkgRow?.pkg_json || {}

    const currentText = (typeof body?.content === 'string' && body.content)
      || (section && pkg[section] != null ? String(pkg[section]) : '')
      || art.content || ''

    const instructions = 'You are editing a professional resume. Apply the user instruction to the provided section text and return ONLY the revised text, no preamble.'
    const reqBody: any = {
      model: AI_EDIT_MODEL,
      instructions,
      input: [{ role: 'user', content: `Instruction: ${instruction}\n\nCurrent text:\n${currentText}` }],
      ...(isReasoningModel(AI_EDIT_MODEL) ? { reasoning: { effort, summary: 'auto' } } : {}),
      ...(AI_EDIT_MODEL === 'gpt-5.6-luna' ? { service_tier: 'priority' } : {}),
    }
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(reqBody)
    })
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    const revised = extractResponseText(data).trim()
    await logUsage('packet:ai-edit', AI_EDIT_MODEL, data.usage)

    if (section) {
      const merged = { ...pkg, [section]: revised }
      await client.query(`update packet set pkg_json = $1, updated_at = now() where id = $2`, [JSON.stringify(merged), art.packet_id])
    } else {
      await client.query(`update artifact set content = $1, updated_at = now() where id = $2`, [revised, artifactId])
    }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, revised, section, effort, model: AI_EDIT_MODEL } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('packetGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet', handler: packetGet })
app.http('artifactContent', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/content', handler: artifactContent })
app.http('artifactAiEdit', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/ai-edit', handler: artifactAiEdit })
app.http('packetsList', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packets', handler: packetsList })
app.http('packetBuildAll', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/packet/build-all', handler: packetBuildAll })
app.http('jdAnalysis', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/jd-analysis', handler: jdAnalysis })
app.http('opportunityEnrich', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/enrich', handler: opportunityEnrich })
app.http('artifactGenerate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/generate', handler: artifactGenerate })
app.http('artifactStatus', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/status', handler: artifactStatus })
app.http('artifactDocument', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/document', handler: artifactDocument })
app.http('artifactSlides', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/slides', handler: artifactSlides })

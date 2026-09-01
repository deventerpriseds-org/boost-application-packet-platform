import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'
import { resolveOwner, requireWrite } from './appSession'
import { renderArtifact } from './appPackets'
import { loadMasterBaseline } from './appInsertions'
import { metaFor } from './packetTemplates'

/**
 * POST /api/app/baseline-artifacts — build MASTER-FILLED copies of the packet templates.
 *
 * WHAT THIS IS. The same copy-and-inject the real packet builder uses, with the merge fields filled
 * from MasterContext instead of from model output. The result is a real Drive document per type:
 * the template's design, the owner's standing content, and NOTHING written for a job posting.
 *
 * WHY IT HAD TO EXIST, given both halves already did. The owner asked three times for "the same
 * process we use to build copies of these artifacts but with the mastercontext information and no
 * prompt output changes applied", and neither existing answer was it:
 *   the built artifacts   are tailored to eMoney/Trinnex/Cloudflare - a company name on every page
 *   the source templates  still carry raw {{Placeholder}} tokens - no content at all
 * `loadMasterBaseline()` (appInsertions.ts) already returns MasterContext keyed by merge field, and
 * `renderArtifact()` (appPackets.ts) already copies a template and injects any pkg it is handed
 * WITHOUT calling a model - every OpenAI call in a normal build happens upstream, in
 * `buildPackageForJD`. Nothing called the two together. That gap is the whole of this route.
 *
 * NO MODEL CALL HAPPENS HERE, and that is the point rather than an optimisation. This file imports
 * no OpenAI transport and calls nothing that does. `H:baseline-no-model` asserts it against the
 * source, because a future edit that reintroduces generation would satisfy every other test in the
 * suite while silently making the output prompt-derived - which is exactly what the owner asked to
 * be free of.
 *
 * THE OPPORTUNITY IS A CONTAINER, NOT A JOB. `artifact.packet_id` references `packet(id)` and
 * `packet.opp_id` is NOT NULL (schema.ts:84), so a document that belongs to no posting still needs
 * one row to hang from. This creates exactly one, reused on every later call, and marks it
 * `dismissed = true` so it stays out of the discovery funnel and every count that reads it. That is
 * a deliberate trade recorded rather than hidden: the structurally clean fix is a nullable
 * `opp_id`, which is a Tier 1 change because `opp_id` is joined across the whole funnel.
 */

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** The container opportunity's identity. Matched on (owner_email, company, role) so it is unique. */
export const BASELINE_COMPANY = 'Baseline (Master Context)'
export const BASELINE_ROLE = 'Standing profile — no posting'

/**
 * Seeded FIRST values for the two placeholders MasterContext cannot fill, not constants.
 *
 * `MASTER_BASELINE_FIELD` (evidence.ts:198) deliberately maps no master block to `@Company`,
 * `@CoverLetterDate` or `@CoverLetterBody` — there is no standing text for them. Left unfilled they
 * do not render as visible tokens: `stripLeftoverTokens` DELETES an unfilled {{...}} after
 * injection, so the text silently vanishes and the slide reads as a bug rather than a gap.
 *
 * The owner supplied these two (2026-09-01: *"company = Company X, coverletterdate = today"*), and
 * both are overridable per call via the request body, so this seeds a first value rather than
 * hardcoding one. `@CoverLetterBody` stays unmapped on purpose — inventing a cover letter is the
 * one thing that WOULD be prompt-shaped content, and this route exists to have none.
 */
export const BASELINE_COMPANY_PLACEHOLDER = 'Company X'

/** Today as YYYY-MM-DD. A rule, not a stored constant — "today" is what the owner asked for. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * The pkg handed to `renderArtifact`: MasterContext first, then the two standing values.
 *
 * Pure and exported so the contract is testable without Drive, Postgres or Azure Storage. The
 * overlay order is load-bearing — the standing values must win over an absent master block, and
 * `masterBaseline()` only emits fields that HAVE non-empty text, so nothing here can be clobbered
 * by an empty string.
 */
export function baselinePkg(
  master: Record<string, string>,
  opts?: { company?: string; date?: string },
): Record<string, string | null> {
  const company = (opts?.company || '').trim() || BASELINE_COMPANY_PLACEHOLDER
  const date = (opts?.date || '').trim() || todayIso()
  return { ...master, '@Company': company, '@CoverLetterDate': date }
}

/** Types this route will build. `cover` is excluded — see the note in the handler. */
export const BASELINE_TYPES = ['resume', 'portfolio'] as const

export async function baselineArtifacts(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const owner = resolveOwner(req).owner

  let body: any = {}
  try { body = (await req.json()) || {} } catch { body = {} }

  // `cover` is buildable but deliberately not offered by default: its template's three placeholders
  // are @Company, @CoverLetterDate and @CoverLetterBody, and only the first two have standing
  // values — so the body would be stripped and the deck would ship BLANK. An explicit
  // `types: ["cover"]` still honours the request; the default just refuses to produce that quietly.
  const types: string[] = Array.isArray(body.types) && body.types.length
    ? body.types.map((t: any) => String(t))
    : [...BASELINE_TYPES]

  const unknown = types.filter((t) => !metaFor(t))
  if (unknown.length) {
    return { status: 400, headers: HEADERS, jsonBody: { error: `no template for type(s): ${unknown.join(', ')}` } }
  }

  let client
  try {
    client = await getPgClient()

    // One container opportunity, reused. `dismissed = true` keeps it out of the discovery funnel.
    const oppSel = `select * from opportunity where owner_email = $1 and company = $2 and role = $3 limit 1`
    let opp = (await client.query(oppSel, [owner, BASELINE_COMPANY, BASELINE_ROLE])).rows[0]
    if (!opp) {
      opp = (await client.query(
        `insert into opportunity (owner_email, company, role, stage, dismissed, why_surfaced)
         values ($1, $2, $3, 'discovered', true, $4) returning *`,
        [owner, BASELINE_COMPANY, BASELINE_ROLE,
          'Container for master-filled baseline artifacts. Not a real posting.'],
      )).rows[0]
    }

    let pkt = (await client.query(`select * from packet where opp_id = $1 limit 1`, [opp.id])).rows[0]
    if (!pkt) pkt = (await client.query(`insert into packet (opp_id) values ($1) returning *`, [opp.id])).rows[0]

    const master = await loadMasterBaseline()
    const pkg = baselinePkg(master, { company: body.company, date: body.date })

    const built: any[] = []
    for (const type of types) {
      let art = (await client.query(
        `select * from artifact where packet_id = $1 and type = $2 limit 1`, [pkt.id, type],
      )).rows[0]
      if (!art) {
        art = (await client.query(
          `insert into artifact (packet_id, type) values ($1, $2) returning *`, [pkt.id, type],
        )).rows[0]
      }
      const rendered = await renderArtifact(client, art, opp, pkg)
      const after = (await client.query(`select doc_url from artifact where id = $1`, [art.id])).rows[0]
      built.push({ type, artifactId: art.id, title: rendered?.title || null, docUrl: after?.doc_url || null })
    }

    // Which merge fields actually carried content, so a thin master block is visible in the
    // RESPONSE rather than discovered later as blank space in the document. A 200 with an empty
    // list is a result to investigate, not a pass.
    const filled = Object.keys(pkg).filter((k) => String((pkg as any)[k] ?? '').trim()).sort()

    return {
      status: 200,
      headers: HEADERS,
      jsonBody: {
        ok: true,
        owner,
        oppId: opp.id,
        packetId: pkt.id,
        masterFieldCount: Object.keys(master).length,
        filledFields: filled,
        company: pkg['@Company'],
        coverLetterDate: pkg['@CoverLetterDate'],
        artifacts: built,
      },
    }
  } catch (e: any) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally {
    try { await client?.end() } catch { /* the response is already formed; a close failure is not the caller's problem */ }
  }
}

app.http('baselineArtifacts', {
  methods: ['POST', 'OPTIONS'], authLevel: 'anonymous',
  route: 'app/baseline-artifacts', handler: baselineArtifacts,
})

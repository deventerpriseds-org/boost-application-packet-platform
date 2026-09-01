import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'
import { resolveOwner, requireWrite } from './appSession'
import { renderArtifact } from './appPackets'
import { loadMasterBaseline } from './appInsertions'
import { metaFor } from './packetTemplates'
import { loadPipelineSettings } from './pipelineConfig'
import { splitItems } from './swaps'
import { resolveTemplateSlots } from './roleFocus'
import { SLOT_FIELDS, SlotField, SlotCounts } from './slots'

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

/**
 * The SEEDED Relevant Proficiencies — the fallback when there is no JD to select against.
 *
 * WHY A SEED IS NEEDED AT ALL, and why "first 3 of the pool" is not it. `relevantProficiencies` is a
 * 36-term LIBRARY, and the three template slots hold 3 each. With no JD, `shapeSlotFields` would
 * take `items.slice(0, 3)` — the first nine terms in storage order, which is all of
 * "Governance and Compliance" and part of "Technology Strategy". Mechanically correct and
 * editorially arbitrary: it answers "which nine fit" rather than "which nine are worth showing".
 *
 * HOW THESE NINE WERE CHOSEN. By the owner's own Zap rule, run against the Trinnex JD: select 9
 * aligned to the posting's ATS keywords, **excluding anything already covered by Skills1, Skills2 or
 * the core competencies**, ordered by match, split 3/3/3. The redundancy pass dropped 27 of the 36 —
 * `AI/ML Strategy` against S1 `AI/Data Science Strategy`, `Strategic Roadmapping` against S2
 * `Strategic Roadmaps`, `KPI-Driven Execution` against the expertise KPI line, and so on. The nine
 * that survived cover the ATS keywords nothing else in the packet reaches: `portfolio management`,
 * `team development`, `technological innovation`, `innovation culture`, `AI adoption`,
 * `cross-functional partnership`, `performance monitoring` and leadership.
 *
 * The owner then corrected the set: it carried THREE AI-prefixed terms, because each pick had been
 * optimised against its own keyword and the nine were never read as a group. *"the ai is a little
 * redundant. replace AI in operations to Ops automation, and AI/ML advancements to Data Insights."*
 * Those two are the owner's wordings rather than verbatim Library entries — the Zap rule explicitly
 * allows replacing a term with a more relevant one, and the owner authored the Library.
 *
 * A SEED, NOT A CONSTANT. Overridable per call via `relevant` in the body, so the owner changes it
 * without a deploy — the repo's standing rule is that code may only seed a first value.
 *
 * THE CHARACTER RULE. The Zap states it twice and differently: step 1 says no more than one item
 * over 20 characters per list, step 2 says over 24. Step 1's is UNSATISFIABLE here — four of the
 * nine exceed 20 and four items cannot be spread one-per-list across three lists. Step 2 is the
 * later, final instruction ("Maintain the Output as..."), so 24 binds; the longest term below is 22,
 * so every list passes with room. `H:baseline-relevant-seed` asserts it rather than trusting this note.
 */
export const SEED_RELEVANT_LISTS: readonly (readonly string[])[] = [
  ['Portfolio Management', 'Tech-Driven Innovation', 'Ops Automation'],
  ['Tech Talent Strategy', 'Innovation Frameworks', 'Data Insights'],
  ['Corporate AI Use Cases', 'Strategic Partnerships', 'Global Leadership'],
] as const

/** The three Relevant slots, in template order — the seed above maps onto these positionally. */
export const RELEVANT_FIELDS = ['RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3'] as const

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
  opts?: { company?: string; date?: string; slots?: SlotCounts; relevant?: readonly (readonly string[])[] },
): Record<string, string | null> {
  const company = (opts?.company || '').trim() || BASELINE_COMPANY_PLACEHOLDER
  const date = (opts?.date || '').trim() || todayIso()
  const shaped = shapeSlotFields(master, opts?.slots)
  return {
    ...shaped,
    ...relevantOverlay(opts?.relevant),
    '@Company': company,
    '@CoverLetterDate': date,
  }
}

/**
 * The three Relevant slots, from the caller's lists or the seed.
 *
 * Applied AFTER `shapeSlotFields` on purpose: without it those three fields carry the whole Library
 * sliced to length, which is the arbitrary answer this seed exists to replace. A caller list wins,
 * an empty or malformed one falls back rather than blanking the slot — a blank Relevant column is
 * the silent-deletion failure `stripLeftoverTokens` already causes once.
 */
export function relevantOverlay(lists?: readonly (readonly string[])[]): Record<string, string> {
  const src = (Array.isArray(lists) && lists.length ? lists : SEED_RELEVANT_LISTS)
  const out: Record<string, string> = {}
  RELEVANT_FIELDS.forEach((field, i) => {
    const items = (src[i] || []).map((x: unknown) => String(x || '').trim()).filter(Boolean)
    if (items.length) out[field] = items.join('\n')
  })
  return out
}

/**
 * Turn the master blocks into what the RESUME TEMPLATE renders: a newline-separated list, trimmed
 * to the slot's configured capacity. Non-slot fields (prose, `@`-placeholders) pass through
 * untouched — they are paragraphs, not lists.
 *
 * TWO DEFECTS FIXED HERE, both found by the owner reading the document I built (2026-09-01).
 *
 * 1. PIPES. The master blocks are stored pipe-delimited — `skills1` is literally
 *    `"Enterprise Governance|Technology Strategy|..."` (diag/skill-sources, run 33548874453) — and
 *    the first version of this file injected that string verbatim, so the resume rendered pipes.
 *    ` | ` is the COMPACT resume's separator (`compactFit.ts:104 DEFAULT_SEPARATOR`), used to fold
 *    the full resume's two columns into the compact's one Core Skills line. The originating Zap
 *    stores these as bullet lists and formats them through `<ul>/<li>` and back to
 *    "a plain text bullet list" (`docs/zap-289877647/baseline/04-current-skills.md`, prompts 19+27).
 *    Owner: *"the template resume doesn't use pipes."* `splitItems` is the repo's existing splitter
 *    and already handles `\n`, `|`, `•` and `·` — reused rather than re-implemented, because a
 *    second splitter that disagreed with the one that built the package is a defect this repo has
 *    already paid for once (`swaps.ts:115`).
 *
 * 2. THE WHOLE LIBRARY IN EVERY RELEVANT SLOT. `MASTER_BASELINE_FIELD` maps `RelevantBullets1`,
 *    `2` AND `3` to the same pooled `relevantProficiencies` key, deliberately — it is the pool the
 *    prompts split from, and as provenance "before" text that is correct. As a render package it is
 *    not: all 36 terms went into each of three slots. The originating Zap carried THREE separate
 *    lists with a stated hard requirement of *"no more than 3 items"* each.
 *
 * THE TRIM IS BY SLOT COUNT AND ONLY WHERE ONE IS CONFIGURED. `slots.ts` is emphatic that an unset
 * count means UNKNOWN and that inventing one "accuses every item past it" — so a `null` count passes
 * the full list through rather than guessing a length. Nothing here seeds a count.
 */
export function shapeSlotFields(
  master: Record<string, string>,
  slots?: SlotCounts,
): Record<string, string> {
  const out: Record<string, string> = { ...master }
  for (const field of SLOT_FIELDS) {
    const raw = out[field]
    if (typeof raw !== 'string' || !raw.trim()) continue
    const items = splitItems(raw)
    if (!items.length) continue
    const cap = slots ? slots[field as SlotField] : null
    const kept = typeof cap === 'number' && cap > 0 ? items.slice(0, cap) : items
    out[field] = kept.join('\n')
  }
  return out
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
    // The template's own fixed slot counts, off the SAME row `resolveRoleFocus` reads. Never seeded:
    // an unset count stays null and the list passes through whole.
    // The SAME id `renderArtifact` will copy: the packet's own choice when it has one, else the
    // owner's configured default. Resolving it differently here would let the counts describe a
    // different document than the one being filled.
    const settings = await loadPipelineSettings()
    const slots = await resolveTemplateSlots(
      String(pkt.resume_template_id || '').trim() || settings.resumeTemplateId.value)
    const pkg = baselinePkg(master, { company: body.company, date: body.date, slots, relevant: body.relevant })

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
        slots,
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

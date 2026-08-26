import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'

/**
 * GET /api/diag/skill-sources — READ-ONLY. Returns the MasterContext fields a skill bank would be
 * seeded from, verbatim, so the owner can SEE the pool before a single row is written.
 *
 * WHY THIS ROUTE HAD TO EXIST. The owner asked to see the pool first, and nothing could show it:
 *   mt13 (test/mt-13)  returns a VERDICT ("All 15 required fields present and non-empty"), no content
 *   factsDerive        reads MasterContext but emits FACTS - claims and numbers - not a skills list
 *   mt05               uses a hardcoded test var map, not MasterContext at all
 *   db-query.yml       is Postgres; MasterContext is an Azure Storage TABLE
 * and the sandbox cannot reach Azure Storage directly. So the pool was unshowable, and the seeder
 * would have had the same gap: it must read these fields server-side too.
 *
 * WHY NOT THE GOOGLE DOC, which is what the owner's words pointed at. The resume template contains
 * NO skills text - proven live, api-test run 32973162995 (HTTP 200): its placeholders are exactly
 * {{ExpertiseBullets}} {{RelevantBullets1..3}} {{ResumeSummary}} {{SkillsBullets1}} {{SkillsBullets2}}
 * and nothing else. evidence.ts:174-176 says the same in the repo's own words. Seeding from the Doc
 * as literally worded yields ZERO entries. What FILLS those placeholders is MasterContext, which is
 * what `skills1`/`skills2` are mapped to (evidence.ts:190-191) - so the baseline is the real source.
 *
 * Deliberately NOT owner-scoped, and that is a defect to inherit rather than invent: MasterContext is
 * a single global partition ('context'). A per-owner skill bank seeded from it is a data-separation
 * problem the moment a second owner exists. Recorded, not papered over.
 */

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// The fields a skills pool could honestly come from. `softHardSkillsPool` is the giveaway - the
// owner already keeps a pool; it is labelled "Soft/hard skills pool" (evidence.ts:160).
const SKILL_FIELDS = ['skills1', 'skills2', 'softHardSkillsPool', 'expertise', 'relevantProficiencies']

export async function diagSkillSources(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const client = TableClient.fromConnectionString(CONN, 'MasterContext')
    const entities: any[] = []
    for await (const e of client.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) {
      entities.push(e)
    }
    if (!entities.length) {
      // An empty table is a RESULT to report, never an empty pool to seed from silently.
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: 'MasterContext is empty', fields: {} } }
    }
    const ctx = entities[0]
    const fields: Record<string, { chars: number; text: string | null; present: boolean }> = {}
    for (const f of SKILL_FIELDS) {
      const raw = ctx[f] == null ? null : String(ctx[f])
      fields[f] = {
        present: !!(raw && raw.trim()),
        chars: raw ? raw.length : 0,
        // Verbatim. A truncated sample would make the pool look smaller or cleaner than it is, and
        // the whole point of this route is that the owner sees what is actually there.
        text: raw,
      }
    }
    return {
      status: 200, headers: HEADERS,
      jsonBody: { ok: true, partition: 'context', entities: entities.length, fields },
    }
  } catch (err: any) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(err?.message || err), fields: {} } }
  }
}

app.http('diagSkillSources', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/skill-sources', handler: diagSkillSources,
})

// ── the portfolio deck's tables, as a GRID ──────────────────────────────────────────────────────
// GET /api/diag/slide-tables?id=<presentationId>  — READ-ONLY.
// Defaults to PORTFOLIO_TEMPLATE_ID, the deck the owner named. Returns every table with its header
// row and every body row, so the owner can say WHICH column holds skills. Nothing here guesses:
// picking the column by sniffing headers would be right most of the time and silently wrong the
// rest, and wrong here means seeding the pool from the wrong column.
import { getGoogleOAuthToken } from './googleAuth'
import { PORTFOLIO_TEMPLATE_ID } from './packetTemplates'
import { extractSlideTables, previewTables } from './slideTables'

export async function diagSlideTables(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const id = req.query.get('id') || PORTFOLIO_TEMPLATE_ID
  try {
    // The OAuth-user token, exactly as appFacts.sourceText() does it (:40). The service-account
    // path needs a JSON blob and a scope and owns zero Drive quota; this route reads, so it uses the
    // same token the rest of the Google reads already use rather than inventing a second auth path.
    const token = await getGoogleOAuthToken()
    const res = await fetch(`https://slides.googleapis.com/v1/presentations/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      // A failed read is reported as a failed read. Returning an empty table list here would be
      // indistinguishable from "the deck has no tables", and that is how an empty pool gets seeded
      // from a source nobody actually reached.
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, id, error: `Google ${res.status} reading ${id}`, tables: [] } }
    }
    const tables = extractSlideTables(await res.json())
    return {
      status: 200, headers: HEADERS,
      jsonBody: { ok: true, id, tableCount: tables.length, tables: previewTables(tables) },
    }
  } catch (err: any) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, id, error: String(err?.message || err), tables: [] } }
  }
}

app.http('diagSlideTables', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/slide-tables', handler: diagSlideTables,
})

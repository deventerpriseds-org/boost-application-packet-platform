import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'
import { SEED } from './seedData'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
const DEMO_EMAIL = 'demo@executive-engine.local'

// POST /api/diag/seed-demo  — (re)seed the demo dataset from the design handoff.
//   body: { demoState?: 'fresh'|'mid'|'closing' }  (default 'mid')
// Everything is flagged is_demo=true + owner_email=demo@executive-engine.local,
// so a real user can start clean later via /api/diag/reset-user.
export async function seedDemo(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let demoState: 'fresh' | 'mid' | 'closing' = 'mid'
  try { const b = await req.json() as any; if (b?.demoState) demoState = b.demoState } catch {}

  let client
  try {
    client = await getPgClient()

    // Clean any prior demo rows (cascades to contact/packet/etc via FK).
    await client.query(`delete from opportunity where is_demo = true and owner_email = $1`, [DEMO_EMAIL])
    await client.query(`delete from persona where is_demo = true and owner_email = $1`, [DEMO_EMAIL])

    // Personas
    const personas = SEED.personas as Record<string, any>
    for (const [key, p] of Object.entries(personas)) {
      await client.query(
        `insert into persona (owner_email, is_demo, key, name, master_role, comp_target, positioning)
         values ($1,true,$2,$3,$4,$5,$6)`,
        [DEMO_EMAIL, key, p.name || key, p.masterRole || p.master_role || key, p.comp || p.compTarget || null, p.positioning || null]
      )
    }

    // Opportunities at the chosen demo state's stage map
    const stageMap: Record<string, string> = (SEED.demoStates as any)[demoState]?.stages || {}
    const details = SEED.details as Record<string, any>
    let oppCount = 0, contactCount = 0
    for (const o of SEED.opps as any[]) {
      const stage = stageMap[String(o.id)] || 'discovered'
      const personaKey = (o.rolesFor && o.rolesFor[0]) || null
      const matchNum = typeof o.match === 'number' ? o.match : parseInt(String(o.match)) || null
      const r = await client.query(
        `insert into opportunity
          (owner_email, is_demo, persona_key, company, logo_url, role, location, comp_range,
           match_score, fit, urgency, source, source_date, why_surfaced, hiring_manager, recruiter,
           roles_for, stage, company_signals, pain_hypotheses)
         values ($1,true,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         returning id`,
        [DEMO_EMAIL, personaKey, o.company, o.logo || null, o.role, o.loc || null, o.comp || null,
         matchNum, o.fit || null, o.urgency || null, o.source || null, null, o.why || null,
         o.hm && o.hm !== '—' ? o.hm : null, o.recruiter && o.recruiter !== '—' ? o.recruiter : null,
         o.rolesFor || [], stage,
         JSON.stringify(details[o.id]?.signals || []), JSON.stringify(details[o.id]?.pain || [])]
      )
      oppCount++
      const oppId = r.rows[0].id
      for (const s of (details[o.id]?.stakeholders || [])) {
        await client.query(
          `insert into contact (opp_id, name, role, signal, match) values ($1,$2,$3,$4,$5)`,
          [oppId, s.n, s.r, s.sig, s.match]
        )
        contactCount++
      }
    }

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true,
        detail: `Seeded demo dataset (${demoState}): ${Object.keys(personas).length} personas, ${oppCount} opportunities, ${contactCount} contacts — all is_demo=true, owner=${DEMO_EMAIL}.`,
        demoState, personas: Object.keys(personas).length, opportunities: oppCount, contacts: contactCount
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('seedDemo', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/seed-demo', handler: seedDemo })

// POST /api/diag/reset-user { email }  — clear demo data and prepare a clean
// start for a real user profile. Demo rows are removed; the real user's own
// rows (owner_email = their email) are untouched. This is the "fresh start by
// email" the demo flagging enables.
export async function resetUser(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const body = await req.json() as any
    const email = body?.email
    if (!email) return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'email required' } }
    client = await getPgClient()
    const opp = await client.query(`delete from opportunity where is_demo = true`)
    const per = await client.query(`delete from persona where is_demo = true`)
    return {
      status: 200, headers: HEADERS,
      jsonBody: { ok: true, detail: `Cleared demo data. Ready for a fresh start owned by ${email}. Removed ${opp.rowCount} demo opportunities, ${per.rowCount} demo personas.`, email }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('resetUser', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'diag/reset-user', handler: resetUser })

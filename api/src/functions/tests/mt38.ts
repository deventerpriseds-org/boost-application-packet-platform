import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getPgClient } from './pgClient'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

// A standard outreach cadence: day offsets from first touch + channel + template.
const CADENCE = [
  { step: 1, dayOffset: 0, channel: 'coldEmail', template: 'Standard' },
  { step: 2, dayOffset: 3, channel: 'linkedinConnect', template: 'Value-add POV' },
  { step: 3, dayOffset: 7, channel: 'followUp', template: 'Re-engage' },
  { step: 4, dayOffset: 12, channel: 'inMail', template: 'Referral intro' },
]

// MT-38 — Cadence engine. Persists a scheduled cadence for an opportunity in
// Postgres (day-offset touches), then computes which touches are due as of a
// simulated "today" and a cadence-health signal. Proves the scheduling backbone
// the cron-driven cadence engine will use.
export async function mt38(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  // Simulated day-in-cadence (default 8 => steps at offset <=8 are due)
  let dayInCadence = 8
  try { const b = await req.json() as any; if (typeof b?.dayInCadence === 'number') dayInCadence = b.dayInCadence } catch {}

  let client
  try {
    client = await getPgClient()
    const table = `mt38_cadence_${Date.now()}`
    await client.query(`create temp table "${table}" (opp_id int, step int, day_offset int, channel text, template text, sent boolean default false)`)
    for (const t of CADENCE) {
      await client.query(`insert into "${table}" values (1,$1,$2,$3,$4,false)`, [t.step, t.dayOffset, t.channel, t.template])
    }

    // Touches due = day_offset <= dayInCadence AND not yet sent
    const due = await client.query(`select step, day_offset, channel, template from "${table}" where day_offset <= $1 and not sent order by step`, [dayInCadence])
    const total = CADENCE.length
    const dueCount = due.rowCount || 0

    // Simple cadence health: if we're past the last offset with touches still due -> stalling
    const lastOffset = Math.max(...CADENCE.map((c) => c.dayOffset))
    const health = dayInCadence > lastOffset && dueCount > 0 ? 'stalling' : dueCount > 0 ? 'on-track' : 'complete'

    const pass = dueCount >= 1 && dueCount <= total
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass,
        detail: `Cadence persisted (${total} touches). As of day ${dayInCadence}: ${dueCount} due. Health: ${health}.`,
        cadence: CADENCE,
        dayInCadence,
        dueTouches: due.rows,
        cadenceHealth: health
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  } finally {
    try { await client?.end() } catch {}
  }
}

app.http('mt38', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-38', handler: mt38 })

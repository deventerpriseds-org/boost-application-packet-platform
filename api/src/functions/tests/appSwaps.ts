// P1.3 persistence + read API. All derivation lives in `swaps.ts`, which imports neither
// @azure/functions nor pg and is exercised by `api/test/swaps.test.mjs`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { buildSwaps, RequirementRef } from './swaps'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }

/**
 * Record what the generation changed, for one packet.
 *
 * Replace, never append: regenerating a packet must not double its swap table. The delete and the
 * inserts share one transaction so a failure cannot leave a packet with a half-written provenance
 * record — a partial swap table is worse than none, because it reads as complete.
 */
export async function writeSwaps(client: any, packetId: string, oppId: string, args: {
  call1: any; call3: any; pkg: Record<string, any>; profileText?: string; omitList?: string
}): Promise<{ packet_id: string; candidates: number; swaps: number; items: number; unattributed: number }> {
  // Requirements are matched by `seq`, then resolved to real ids here — swaps.ts is pure and never
  // sees a database id.
  const reqRows = (await client.query(
    `select id, seq, verbatim, item_text, kind from requirement where opp_id=$1 order by seq`, [oppId])).rows
  const refs: RequirementRef[] = reqRows.map((r: any) => ({ seq: r.seq, verbatim: r.verbatim, item_text: r.item_text, kind: r.kind }))
  const idBySeq = new Map<number, string>(reqRows.map((r: any) => [r.seq, r.id]))

  const built = buildSwaps({ call1: args.call1, call3: args.call3, pkg: args.pkg, requirements: refs, profileText: args.profileText, omitList: args.omitList })

  await client.query('begin')
  try {
    await client.query(`delete from swap_decision where packet_id=$1`, [packetId])
    await client.query(`delete from skill_candidate where packet_id=$1`, [packetId])

    const candidateId = new Map<string, string>()
    for (const c of built.candidates) {
      const r = await client.query(
        `insert into skill_candidate (packet_id, list, label, origin, char_len) values ($1,$2,$3,$4,$5) returning id`,
        [packetId, c.list, c.label, c.origin, c.char_len])
      candidateId.set(`${c.list} ${c.label}`, r.rows[0].id)
    }

    let seq = 0
    for (const s of built.swaps) {
      await client.query(
        `insert into swap_decision
           (packet_id, list, seq, action, from_candidate_id, to_candidate_id, from_label, to_label,
            requirement_id, verbatim_quote, confidence, driver, rationale)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [packetId, s.list, seq++, s.action,
         s.from_label ? candidateId.get(`${s.list} ${s.from_label}`) || null : null,
         s.to_label ? candidateId.get(`${s.list} ${s.to_label}`) || null : null,
         s.from_label, s.to_label,
         s.requirement_seq === null ? null : idBySeq.get(s.requirement_seq) || null,
         s.verbatim_quote, s.confidence, s.driver, s.rationale])
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }

  return {
    packet_id: packetId, candidates: built.candidates.length, swaps: built.swaps.length,
    items: built.itemCount, unattributed: built.unattributed,
  }
}

// GET /api/app/packet/{id}/swaps — the originals-against-finals table, with no model call.
export async function swapsGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const pkt = (await client.query(
      `select p.id, p.opp_id from packet p join opportunity o on o.id = p.opp_id
        where p.id=$1 and o.owner_email=$2`, [req.params.id, owner])).rows[0]
    if (!pkt) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const candidates = (await client.query(`select * from skill_candidate where packet_id=$1 order by list, id`, [pkt.id])).rows
    const swaps = (await client.query(
      `select s.*, r.verbatim as requirement_verbatim, r.kind as requirement_kind
         from swap_decision s left join requirement r on r.id = s.requirement_id
        where s.packet_id=$1 order by s.list, s.seq`, [pkt.id])).rows
    const changes = swaps.filter((s: any) => s.action === 'swapped' || s.action === 'added')
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        packetId: pkt.id, candidates, swaps,
        changed: changes.length,
        unattributed: changes.filter((s: any) => s.driver !== 'posting').length,
      },
    }
  } catch (e: any) {
    context.error('swapsGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('swapsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packet/{id}/swaps', handler: swapsGet })

// P1.3 persistence + read API. All derivation lives in `swaps.ts`, which imports neither
// @azure/functions nor pg and is exercised by `api/test/swaps.test.mjs`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { buildSwaps, RequirementRef } from './swaps'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }

/**
 * Record what the generation changed, for one packet, on one pass.
 *
 * Replace within the PASS, never across passes. The delete and the inserts share one transaction so
 * a failure cannot leave a packet with a half-written provenance record — a partial swap table is
 * worse than none, because it reads as complete.
 *
 * P3-21 — WHY `loop` EXISTS HERE. This function used to run
 *     delete from swap_decision where packet_id=$1
 * on every build, and the table had no `loop` column at all. A second pass therefore DESTROYED the
 * first pass's swap record: the remediation loop deleted its own justification for every change it
 * had just made, and the packet screen would show only the last pass's decisions as if they were the
 * whole story. The delete is now scoped to the pass being written, and `loop` is part of the unique
 * key, so re-running one pass stays idempotent while history survives.
 *
 * `skill_candidate` is scoped the same way and for a harder reason: its rows are the FK targets of
 * `swap_decision.from_candidate_id` / `to_candidate_id`, which are `on delete set null`. A
 * packet-wide candidate delete would have silently nulled the earlier passes' candidate links even
 * if their swap rows had survived.
 */
export async function writeSwaps(client: any, packetId: string, oppId: string, args: {
  call1: any; call3: any; pkg: Record<string, any>; profileText?: string; omitList?: string; loop?: number
}): Promise<{ packet_id: string; loop: number; candidates: number; swaps: number; items: number; unattributed: number }> {
  const loop = Math.max(0, Number(args.loop ?? 0) | 0)
  // Requirements are matched by `seq`, then resolved to real ids here — swaps.ts is pure and never
  // sees a database id.
  const reqRows = (await client.query(
    `select id, seq, verbatim, item_text, kind from requirement where opp_id=$1 order by seq`, [oppId])).rows
  const refs: RequirementRef[] = reqRows.map((r: any) => ({ seq: r.seq, verbatim: r.verbatim, item_text: r.item_text, kind: r.kind }))
  const idBySeq = new Map<number, string>(reqRows.map((r: any) => [r.seq, r.id]))

  // THE OWNER'S OWN WORDING, so the rebuild can tell their edits from the model's. Without this the
  // swap rows come back 'unattributed' and changes_cited fails the packet naming the owner's words -
  // the failure decision B claims to prevent, which stayed live because nothing produced 'owner'.
  // Scoped to THIS packet's artifacts; a correction belongs to an artifact, not to the packet.
  const ownerLabels = (await client.query(
    `select distinct c.replacement from correction c
       join artifact a on a.id = c.artifact_id
      where a.packet_id = $1 and c.source = 'owner_edit' and c.reverted_at is null`,
    [packetId])).rows.map((r: any) => r.replacement).filter(Boolean)

  const built = buildSwaps({ call1: args.call1, call3: args.call3, pkg: args.pkg, requirements: refs, profileText: args.profileText, omitList: args.omitList, ownerLabels })

  await client.query('begin')
  try {
    await client.query(`delete from swap_decision where packet_id=$1 and loop=$2`, [packetId, loop])
    await client.query(`delete from skill_candidate where packet_id=$1 and loop=$2`, [packetId, loop])

    const candidateId = new Map<string, string>()
    for (const c of built.candidates) {
      const r = await client.query(
        `insert into skill_candidate (packet_id, list, label, origin, char_len, loop) values ($1,$2,$3,$4,$5,$6) returning id`,
        [packetId, c.list, c.label, c.origin, c.char_len, loop])
      candidateId.set(`${c.list} ${c.label}`, r.rows[0].id)
    }

    let seq = 0
    for (const s of built.swaps) {
      await client.query(
        `insert into swap_decision
           (packet_id, list, seq, action, from_candidate_id, to_candidate_id, from_label, to_label,
            requirement_id, verbatim_quote, confidence, driver, rationale, loop)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [packetId, s.list, seq++, s.action,
         s.from_label ? candidateId.get(`${s.list} ${s.from_label}`) || null : null,
         s.to_label ? candidateId.get(`${s.list} ${s.to_label}`) || null : null,
         s.from_label, s.to_label,
         s.requirement_seq === null ? null : idBySeq.get(s.requirement_seq) || null,
         s.verbatim_quote, s.confidence, s.driver, s.rationale, loop])
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }

  return {
    packet_id: packetId, loop, candidates: built.candidates.length, swaps: built.swaps.length,
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
    const candidates = (await client.query(`select * from skill_candidate where packet_id=$1 order by loop, list, id`, [pkt.id])).rows
    const swaps = (await client.query(
      `select s.*, r.verbatim as requirement_verbatim, r.kind as requirement_kind
         from swap_decision s left join requirement r on r.id = s.requirement_id
        where s.packet_id=$1 order by s.loop, s.list, s.seq`, [pkt.id])).rows
    // Every pass is returned, and the latest is named. A caller that only wants "what the packet
    // says now" reads `loop`; a caller auditing the loop reads the rest. Neither has to guess which
    // pass a row belongs to, which is what the missing column used to force.
    const latestLoop = swaps.length ? Math.max(...swaps.map((s: any) => Number(s.loop))) : 0
    const current = swaps.filter((s: any) => Number(s.loop) === latestLoop)
    const changes = current.filter((s: any) => s.action === 'swapped' || s.action === 'added')
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        // `swaps` is EVERY pass (the audit trail); `current` is the latest pass alone (what the
        // packet says now). A caller reading the full array as if it were one pass double-counts as
        // soon as a second pass exists, which P3 makes routine.
        packetId: pkt.id, loop: latestLoop, candidates, swaps, current,
        passes: [...new Set(swaps.map((s: any) => Number(s.loop)))].sort((a, b) => a - b),
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

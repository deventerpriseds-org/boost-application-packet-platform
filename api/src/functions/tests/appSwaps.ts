// P1.3 persistence + read API. All derivation lives in `swaps.ts`, which imports neither
// @azure/functions nor pg and is exercised by `api/test/swaps.test.mjs`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { buildSwaps, ListCounts, RequirementRef } from './swaps'
// THE MASTER TEXT COMES FROM THE ONE READER THAT ALREADY EXISTS. `loadMasterBaseline` reads the
// MasterContext table and hands it to `masterBaseline` (`evidence.ts:211`), which is the single
// place that knows which MasterContext key backs which merge field. A second copy of that mapping
// is the drift `evidence.ts:167-170` warns about by name, so this imports rather than re-reads —
// there is deliberately no TableClient in this file.
import { loadMasterBaseline } from './appInsertions'

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
/**
 * Do the LIVE `list` CHECKs on BOTH provenance tables admit `'expertise'`?
 *
 * `schema.ts:594-596` states it in the file's own words: a `create table if not exists` is a no-op
 * on a table that already exists, so production keeps the OLD check until an explicit ALTER runs.
 * The old check admits only `skills_1, skills_2, relevant_1..3`.
 *
 * BOTH TABLES, not just `swap_decision`. `writeSwaps` inserts a `skill_candidate` row for every
 * candidate BEFORE it inserts any swap row, and `skill_candidate.list` carries its own CHECK
 * (`schema.ts:549`). Checking only `swap_decision` would probe the constraint that is NOT hit first.
 *
 * WHY PROBING BEATS "JUST INSERT AND SEE". Postgres aborts the whole transaction on a failed CHECK,
 * `writeSwaps` rethrows, and `appPackets.ts:617-622` swallows that into a `console.warn` — so ONE
 * rejected expertise row would leave EVERY packet with a completely empty swap table and a
 * `changes_cited: not_applicable` gate. The quietest possible failure, for every list, caused by
 * one missing migration.
 *
 * Matched on the constraint DEFINITION rather than its name, so a differently-named constraint still
 * answers correctly. TEMPORARY: once both ALTERs in schema.ts land this always returns true and the
 * probe can be deleted. Unreachable/erroring => false, i.e. hold the rows back — the conservative
 * direction, because the cost of a wrong `true` is the whole table.
 */
async function listChecksAdmitExpertise(client: any): Promise<boolean> {
  try {
    const r = await client.query(
      `select t.relname from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname in ('swap_decision','skill_candidate') and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%list%'
          and pg_get_constraintdef(c.oid) ilike '%expertise%'`)
    const seen = new Set(r.rows.map((x: any) => x.relname))
    return seen.has('swap_decision') && seen.has('skill_candidate')
  } catch { return false }
}

export async function writeSwaps(client: any, packetId: string, oppId: string, args: {
  call1: any; call3: any; pkg: Record<string, any>; profileText?: string; omitList?: string; loop?: number
  /**
   * Fixed slot counts per merge field, from the per-template config store. Passed straight through
   * to `buildSwaps`, which is pure and never reads config itself.
   */
  slots?: Record<string, number | null>
  /**
   * The owner's master template text per merge field. Optional ONLY so a caller that already has it
   * can avoid a second Storage round-trip; when omitted this function loads it itself.
   */
  master?: Record<string, string>
}): Promise<{
  packet_id: string; loop: number; candidates: number; swaps: number; items: number; unattributed: number
  lists: ListCounts[]; mismatched: ListCounts[]; skippedLists: string[]
}> {
  const loop = Math.max(0, Number(args.loop ?? 0) | 0)
  // THE "ORIGINAL" IS THE OWNER'S MASTER TEMPLATE, NOT CALL 1'S DRAFT. Measured 2026-08-29: 9 of 14
  // live swap rows named a from_label that appears nowhere in the master, because the pairing read
  // `call1[passA]` — the model's own first draft — and presented it to the reviewer as the thing
  // their resume used to say. `loadMasterBaseline` swallows its errors and returns `{}`, and
  // `buildSwaps` degrades to Call 1 per list in that case rather than reporting the owner's whole
  // list as invented; `lists[].baselineSource` records which was used for each list.
  const master = args.master ?? await loadMasterBaseline()
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

  const built = buildSwaps({
    call1: args.call1, call3: args.call3, pkg: args.pkg, requirements: refs,
    profileText: args.profileText, omitList: args.omitList, ownerLabels,
    master, slots: args.slots,
  })

  // Hold expertise rows back until the DDL admits them — see `listChecksAdmitExpertise`. Reported in
  // the return value AND on the log, never silently: a list that produced rows the database refused
  // is a fact the caller has to be able to see.
  const admitsExpertise = await listChecksAdmitExpertise(client)
  const skippedLists: string[] = []
  if (!admitsExpertise && (built.swaps.some(s => s.list === 'expertise') || built.candidates.some(c => c.list === 'expertise'))) {
    skippedLists.push('expertise')
    console.warn("[swaps] a live `list` CHECK still rejects 'expertise'; holding those rows back. "
      + 'Both tables need the ALTER: swap_decision AND skill_candidate. e.g. '
      + 'alter table skill_candidate drop constraint if exists skill_candidate_list_check; '
      + 'alter table skill_candidate add constraint skill_candidate_list_check check '
      + "(list in ('skills_1','skills_2','relevant_1','relevant_2','relevant_3','expertise'));")
  }
  const writeCandidates = skippedLists.length ? built.candidates.filter(c => c.list !== 'expertise') : built.candidates
  const writeRows = skippedLists.length ? built.swaps.filter(s => s.list !== 'expertise') : built.swaps

  await client.query('begin')
  try {
    // LOOP 0 IS GROUND ZERO — the same rule `writeInsertions` applies, and it must be applied HERE
    // TOO or the two tables disagree about which pass is current. That disagreement is exactly the
    // defect measured on 2026-08-29: `listBodyModel` (`assetBlocks.js:757`) keys `byTo` on
    // `to_label` and matches it against the rendered line, so a swap set describing one pass and an
    // insertion set describing another produces NO match on every row — `from` is null and every
    // `original → final` arrow silently disappears. The arrow code was correct the whole time.
    //
    // The scoped delete below stays for loops 1..n: P3-21 records that an unscoped delete once
    // DESTROYED the first pass's swap record, which is why `loop` was added to this table at all.
    if (loop === 0) {
      await client.query(`delete from swap_decision where packet_id=$1`, [packetId])
      await client.query(`delete from skill_candidate where packet_id=$1`, [packetId])
    } else {
      await client.query(`delete from swap_decision where packet_id=$1 and loop=$2`, [packetId, loop])
      await client.query(`delete from skill_candidate where packet_id=$1 and loop=$2`, [packetId, loop])
    }

    const candidateId = new Map<string, string>()
    for (const c of writeCandidates) {
      const r = await client.query(
        `insert into skill_candidate (packet_id, list, label, origin, char_len, loop) values ($1,$2,$3,$4,$5,$6) returning id`,
        [packetId, c.list, c.label, c.origin, c.char_len, loop])
      candidateId.set(`${c.list} ${c.label}`, r.rows[0].id)
    }

    let seq = 0
    for (const s of writeRows) {
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
    packet_id: packetId, loop, candidates: writeCandidates.length, swaps: writeRows.length,
    items: built.itemCount, unattributed: built.unattributed,
    // THE FIXED-SLOT REPORT, returned rather than thrown (AC-9a). `appPackets.ts:617-622` swallows a
    // throw into a console.warn and the packet then ships with an EMPTY swap table, so throwing on a
    // count mismatch would be the quietest possible outcome. `mismatched` is the caller's ready-made
    // offender source for a deterministic `fail` check in `runChecks`; a list whose `expected` is
    // null is UNKNOWN and must be reported `not_applicable`, never `pass` and never `fail`.
    lists: built.lists,
    mismatched: built.lists.filter(l => l.mismatch),
    skippedLists,
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
        // Same exclusion as buildSwaps and changes_cited. Three places counted this and only the
        // gate was fixed for decision B, so the API answered with a number that disagreed with the
        // gate it sits beside.
        unattributed: changes.filter((s: any) => s.driver !== 'owner' && s.driver !== 'posting').length,
      },
    }
  } catch (e: any) {
    context.error('swapsGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('swapsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/packet/{id}/swaps', handler: swapsGet })

// P1.4 persistence + read API. All derivation lives in `insertions.ts`, which imports neither
// @azure/functions nor pg and is exercised by `api/test/insertions.test.mjs`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { resolveOwner } from './appSession'
import { getPgClient } from './pgClient'
import { buildInsertions } from './insertions'
import { masterBaseline } from './evidence'
import { RequirementRef } from './swaps'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }

/**
 * The owner's standing master text, per merge field, for the loop-0 baseline.
 *
 * Reads the same MasterContext row and the same PartitionKey filter every other reader uses
 * (`appFacts.ts:46`, `pipeline.loadProfile`); the merge-field mapping itself is `masterBaseline` in
 * `evidence.ts`, which is the one place that knows what that table holds.
 *
 * SWALLOWS ITS ERRORS ON PURPOSE. The baseline is a disclosure — "here is what this was written
 * from". If Storage is unreachable, the right outcome is the packet still builds and `Show original`
 * says it has no earlier version, which `originalState` already words honestly. Throwing here would
 * trade a missing explanation for a failed build.
 */
async function loadMasterBaseline(): Promise<Record<string, string>> {
  try {
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!conn) return {}
    const ctx = TableClient.fromConnectionString(conn, 'MasterContext')
    let mc: any = {}
    for await (const e of ctx.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e
    return masterBaseline(mc)
  } catch { return {} }
}

/**
 * Record what was injected into one artifact's merge fields.
 *
 * Loops ACCUMULATE rather than replace: the whole point of a remediation loop is to show what a
 * later pass changed, so overwriting loop 0 would erase the before-text that makes loop 1 legible.
 * The unique (artifact_id, merge_field, loop) key means re-running the SAME loop is idempotent.
 *
 * DECISION 14 - `loop` IS THE REMEDIATION-PASS NUMBER, AND THE CALLER OWNS IT.
 * It used to be derived here as `max(loop) + 1`, which meant it counted DOCUMENT RENDERS: every
 * build incremented it, including a build that served a cached package and made zero model calls.
 * Three loop-ish counters already existed (packet.round - dead, insertion.loop, check_result.run_id)
 * and P3 wanted a fourth. Instead this one is given the meaning P3 needs, and the caller passes it:
 *   loop 0     the baseline package, whether freshly generated or served from cache
 *   loop 1..n  remediation pass n
 * A re-render at the same loop rewrites that loop's rows identically instead of inventing a pass.
 * `before_text` comes from loop-1, so pass n's before is pass n-1's after - never its own.
 *
 * AT LOOP 0 THE "BEFORE" IS THE OWNER'S MASTER TEXT (added 2026-08-24).
 * It used to be nothing at all: `prevPkg` was `{}` on the baseline package, so every row on the
 * draft everyone actually looks at carried `before_text = null`. Two things were wrong downstream
 * and both were the same root cause:
 *   1. `Show original` had nothing to show and the app HID the control, so the reader could not
 *      tell "unchanged" from "broken" from "first draft". The owner: *"that is black box and not
 *      clear"*, and *"there is always an original value for those sections"* - which is right, and
 *      SPEC 199 says the control is on every field.
 *   2. `method` is derived as `changed ? 'model_rewrite' : 'template_fill'`, and with no before
 *      NOTHING could ever be `changed`, so every generated loop-0 field was recorded as
 *      `template_fill` and rendered "From profile" (`assetGate.js:242`) even when the model had
 *      rewritten it wholesale for this posting. A false provenance claim on the screen whose whole
 *      job is provenance. With a real baseline the two labels finally separate: work history the
 *      model copied stays "From profile", a summary it rewrote becomes "Written for this posting",
 *      which is SPEC 205's three origins and what the prototype renders.
 *
 * This does NOT disturb remediation crediting. `realEdits`/`creditClosures` are only ever handed one
 * remediation pass's rows (`appRemediation.ts:275` selects `loop=$2` with pass >= 1); loop 0 is
 * never passed to them, so a default value is never counted as an edit.
 *
 * A MasterContext read failure DEGRADES to the old behaviour rather than failing the build: the
 * baseline is a disclosure, and losing it must never cost the owner their packet.
 */
export async function writeInsertions(client: any, artifactId: string, oppId: string, args: {
  type: string; pkg: Record<string, any>; loop?: number
}): Promise<{ artifact_id: string; loop: number; filled: number; unfilled: number; attributed: number }> {
  const loop = Math.max(0, Number(args.loop ?? 0) | 0)
  const prev = loop > 0
    ? (await client.query(
        `select merge_field, after_text from insertion where artifact_id=$1 and loop=$2`, [artifactId, loop - 1])).rows
    : []
  const prevPkg: Record<string, any> = loop === 0 ? await loadMasterBaseline() : {}
  for (const r of prev) prevPkg[r.merge_field] = r.after_text

  const reqRows = (await client.query(
    `select id, seq, verbatim, item_text, kind from requirement where opp_id=$1 order by seq`, [oppId])).rows
  const refs: RequirementRef[] = reqRows.map((r: any) => ({ seq: r.seq, verbatim: r.verbatim, item_text: r.item_text, kind: r.kind }))
  const idBySeq = new Map<number, string>(reqRows.map((r: any) => [r.seq, r.id]))

  const built = buildInsertions({ type: args.type, pkg: args.pkg, prevPkg, requirements: refs, loop })

  await client.query('begin')
  try {
    // LOOP 0 IS GROUND ZERO — it clears every later pass, not just its own rows.
    //
    // Measured on the Trinnex resume (artifact cfdd82e7), 2026-08-29. A whole-package rebuild on
    // 08-28 wrote loop 0 in place, while loops 1-3 from 08-20 survived untouched. `insertionsGet`
    // picks `current` with `Math.max(loop)` (`appInsertions.ts:130`), so the screen served the
    // EIGHT-DAY-OLD pass 3 — 7 items, 4 of them over the 24-char limit — while the rebuild's own
    // loop 0 sat beside it with 10 compliant items at exactly 24. The owner saw the stale text and
    // the swap arrows vanished, because `listBodyModel` matched loop-3 lines against loop-0
    // `to_label`s and found nothing.
    //
    // Loops 1..n are edits to a draft. When the draft is regenerated they describe a document that
    // no longer exists, so keeping them is not history, it is a newer number outranking newer text.
    // A rebuild restarts the pass count from zero, which is what the owner asked for and what the
    // numbering already implies.
    //
    // Safe because loop 0 is only ever written at ground zero: `appPackets.ts` renderArtifact for a
    // whole-package build, and `appRemediation.ts:179` guarded by `firstPass === 1`. A later
    // remediation run deliberately does NOT rewrite loop 0 (`appRemediation.ts:177`), so this
    // cannot delete a run's own earlier passes.
    // Braced deliberately. `H34` proves the unscoped clear is INSIDE an `if (loop === 0) { … }`
    // block by walking its braces, because the earlier proximity test was defeated by a delete that
    // merely sat near a `loop === 0` mention. A brace-less `if` gives that check nothing to walk, so
    // the braces are load-bearing here, not style.
    if (loop === 0) {
      await client.query(`delete from insertion where artifact_id=$1`, [artifactId])
    } else {
      await client.query(`delete from insertion where artifact_id=$1 and loop=$2`, [artifactId, loop])
    }
    for (const r of built.rows) {
      await client.query(
        `insert into insertion
           (artifact_id, merge_field, generated, before_text, after_text, method, loop, list,
            item_count, requirement_id, verbatim_quote, confidence)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [artifactId, r.merge_field, r.generated, r.before_text, r.after_text, r.method, r.loop, r.list,
         r.item_count, r.requirement_seq === null ? null : idBySeq.get(r.requirement_seq) || null,
         r.verbatim_quote, r.confidence])
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }

  return { artifact_id: artifactId, loop, filled: built.filled, unfilled: built.unfilled, attributed: built.attributed }
}

// GET /api/app/artifact/{id}/insertions — every block, generated or not, naming its merge field.
export async function insertionsGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const art = (await client.query(
      `select a.id, a.type from artifact a
         join packet p on p.id = a.packet_id
         join opportunity o on o.id = p.opp_id
        where a.id=$1 and o.owner_email=$2`, [req.params.id, owner])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const rows = (await client.query(
      `select i.*, r.verbatim as requirement_verbatim, r.kind as requirement_kind
         from insertion i left join requirement r on r.id = i.requirement_id
        where i.artifact_id=$1 order by i.loop, i.merge_field`, [art.id])).rows
    const latest = rows.length ? Math.max(...rows.map((r: any) => Number(r.loop))) : 0
    const current = rows.filter((r: any) => Number(r.loop) === latest)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        // `insertions` is EVERY pass (the audit trail); `current` is the latest pass alone (what the
        // document says now). Both are returned because a caller reading the full array and treating
        // it as one-row-per-merge-field will double-count the moment a second pass exists - and P3
        // makes a second pass the normal case rather than a rarity.
        artifactId: art.id, type: art.type, loop: latest, insertions: rows, current,
        passes: [...new Set(rows.map((r: any) => Number(r.loop)))].sort((a, b) => a - b),
        filled: current.filter((r: any) => r.generated).length,
        unfilled: current.filter((r: any) => !r.generated).length,
        attributed: current.filter((r: any) => r.verbatim_quote !== null).length,
      },
    }
  } catch (e: any) {
    context.error('insertionsGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('insertionsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{id}/insertions', handler: insertionsGet })

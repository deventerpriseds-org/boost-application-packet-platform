// P8.1 / R1 — the correction pass. Anything the engine can fix, it fixes before the user sees it,
// and records the fix so the user reviews a change log rather than a to-do list.
//
// This is the HTTP/pg half. The judgement lives in `correction.ts`, which is pure and knows nothing
// about a database; this file decides WHEN the pass runs, what text it runs against, and how the
// result is stored. Keeping the split means every offset rule and every revert path is exercised by
// `node --test` without a cluster.
//
// WHERE THIS RUNS IS PART OF THE CORRECTNESS, and it is the thing an implementation gets wrong.
// The natural place to put a correction pass is next to the CHECK that motivates it, in
// `appChecks.ts`. Do that and `posting_figure_echo` goes green, the change log looks right, and
// every test written alongside it passes — while `packet.pkg_json` and `insertion.after_text` were
// both written BEFORE the correction and now disagree with the document the user actually reads.
// Downstream that compounds: `remediation.realEdits()` decides an edit by comparing `after_text` to
// `before_text`, and `creditClosures()` joins `after_text` to decide which requirements a pass may
// credit — so the loop would credit closures against text that never shipped.
//
// So the pass runs in `appPackets.buildTemplatedArtifact`, on the package object, BEFORE
// `update packet set pkg_json`. Everything downstream — the swap writer, the insertion writer, the
// checks, the document — then sees one corrected package and cannot disagree about it.
import { getPgClient } from './pgClient'
import { scanEcho } from './figureEcho'
import { planCorrections, applyCorrections, reapplyOwnerEdits, Correction } from './correction'

export const CORRECTION_PASS_VERSION = 1

/** Fields whose text is prose or list items the user reads — never ids, urls or metadata. */
const CORRECTABLE = (pkg: Record<string, any>) =>
  Object.keys(pkg || {}).filter(k => typeof pkg[k] === 'string' && pkg[k].trim().length > 0)

export interface PassResult {
  /** Rows written, in document order per field. Empty when nothing needed correcting. */
  rows: Correction[]
  /**
   * Owner edits that could NOT be re-applied to the regenerated text, with the reason for each.
   *
   * Present and empty when every stored edit was re-applied; a lapse is never silent. The caller
   * must surface these - an edit the owner made and can no longer see is the one thing this whole
   * path exists to prevent, and reporting zero lapses because nobody looked is the same failure in
   * a quieter costume.
   */
  ownerLapsed?: Array<{ row: Correction; reason: string }>
  /**
   * True when the pass COULD NOT LOOK — no employer text to compare against. Distinct from "looked
   * and found nothing", and the distinction is the point: both produce zero corrections, and only
   * one of them is evidence of anything. A caller that reports `rows.length === 0` as "clean" shows
   * a green R1 for a document nobody compared to anything.
   */
  notApplicable: boolean
  reason?: string
  /** The fields actually scanned, so "0 corrections" can say across how much. */
  scanned: string[]
}

/**
 * The idempotent ensure-path, matching `SCHEMA_SQL` exactly.
 *
 * It exists because `pgMigrate` is not guaranteed to have run when this executes, and a route that
 * 500s on a missing table is worse than one that creates it. It must stay in step with the
 * declaration in `schema.ts` — H11 registers the table so a migration that skipped it fails a test
 * rather than surfacing as a runtime error.
 */
export async function ensureCorrectionTable(client: any): Promise<void> {
  await client.query(`create table if not exists correction (
    id            uuid primary key default uuid_generate_v4(),
    artifact_id   uuid not null references artifact(id) on delete cascade,
    merge_field   text not null,
    phrase        text not null,
    replacement   text not null,
    char_start    int not null,
    char_end      int not null,
    before_sha256 text not null,
    applied_seq   int not null,
    reason        text not null,
    source        text not null check (source in ('profile_figure','generalized','owner_edit')),
    run_id        uuid,
    loop          int not null default 0,
    reverted_by   text,
    reverted_at   timestamptz,
    created_at    timestamptz not null default now(),
    constraint correction_span_matches_phrase check (char_end - char_start = length(phrase)),
    constraint correction_span_ordered        check (char_start >= 0 and char_end > char_start),
    constraint correction_sha_shaped          check (before_sha256 ~ '^[0-9a-f]{64}$'),
    constraint correction_revert_paired       check ((reverted_by is null) = (reverted_at is null))
  )`)
  await client.query(`create unique index if not exists correction_unique_seq
    on correction (artifact_id, merge_field, applied_seq, coalesce(run_id, '00000000-0000-0000-0000-000000000000'::uuid))`)
  await client.query(`create index if not exists correction_by_artifact on correction (artifact_id, reverted_at)`)
}

/**
 * Correct one package in place and record every change.
 *
 * `pkg` is MUTATED — deliberately, because the caller must persist the corrected text and not the
 * original, and returning a copy invites someone to store the wrong one.
 *
 * Never throws. A correction pass that fails must not take the packet build down with it — but,
 * unlike provenance, a skipped correction changes what the user READS, so the failure is reported
 * as `notApplicable` with a reason rather than swallowed into silence.
 */
export async function applyCorrectionPass(
  client: any,
  args: { artifactId: string; pkg: Record<string, any>; postingText: string; profileText: string; runId?: string | null; loop?: number },
): Promise<PassResult> {
  const { artifactId, pkg } = args
  const scanned: string[] = []
  try {
    const posting = String(args.postingText || '')
    // Ask the scanner whether it could look, rather than re-deriving that from the raw string here.
    // A second opinion about "is there posting text" is a second definition of it.
    const probe = scanEcho('', posting, String(args.profileText || ''))
    if (probe.notApplicable) {
      return { rows: [], notApplicable: true, reason: probe.reason || 'no employer posting text to compare against', scanned }
    }

    await ensureCorrectionTable(client)
    const all: Correction[] = []
    for (const field of CORRECTABLE(pkg)) {
      const original = String(pkg[field])
      const scan = scanEcho(original, posting, String(args.profileText || ''))
      scanned.push(field)
      const rows = planCorrections(field, original, scan.echoes)
      if (!rows.length) continue
      pkg[field] = applyCorrections(original, rows)
      all.push(...rows)
    }

    for (const c of all) {
      await client.query(
        `insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end,
           before_sha256, applied_seq, reason, source, run_id, loop)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict do nothing`,
        [artifactId, c.merge_field, c.phrase, c.replacement, c.char_start, c.char_end,
         c.before_sha256, c.applied_seq, c.reason, c.source, args.runId || null, Math.max(0, Number(args.loop ?? 0) | 0)],
      )
    }
    // DECISION A (owner, 2026-08-25): an owner's own edit SURVIVES A REBUILD.
    //
    // The row already survived - nothing deletes from `correction` - but the TEXT did not, because
    // everything above replays only the pipeline's freshly-planned rows against freshly generated
    // prose. Without this the change log would tell the owner an edit is in place that the document
    // does not contain, which is worse than losing it.
    //
    // Re-applied by PHRASE, not by the stored offsets: those describe the field as it stood when the
    // owner edited it, and after a rebuild they point at arbitrary characters. Exactly one
    // occurrence or the edit LAPSES and is reported - never guessed, never silently dropped.
    // `reapplyOwnerEdits` owns that rule and is guarded by H:owner-edit-* in ownerEdits.test.mjs.
    const ownerLapsed: Array<{ row: Correction; reason: string }> = []
    const stored = (await client.query(
      `select merge_field, phrase, replacement, char_start, char_end, before_sha256, applied_seq,
              reason, source
         from correction
        where artifact_id = $1 and source = 'owner_edit' and reverted_at is null
        order by applied_seq`, [artifactId])).rows as Correction[]
    for (const field of new Set(stored.map((r) => r.merge_field))) {
      if (!(field in pkg)) continue
      const mine = stored.filter((r) => r.merge_field === field)
      const res = reapplyOwnerEdits(String(pkg[field]), mine)
      pkg[field] = res.text
      ownerLapsed.push(...res.lapsed)
    }

    return { rows: all, notApplicable: false, scanned, ownerLapsed }
  } catch (e: any) {
    // Reported, not swallowed. See the doc comment: a silent catch here would leave the user reading
    // uncorrected text under a change log that says nothing happened.
    return { rows: [], notApplicable: true, reason: `the correction pass failed: ${e?.message || e}`, scanned }
  }
}

/** The change log for one artifact, newest field-order first. Undone rows are KEPT and marked. */
export async function listCorrections(client: any, artifactId: string): Promise<any[]> {
  await ensureCorrectionTable(client)
  const { rows } = await client.query(
    `select id, merge_field, phrase, replacement, char_start, char_end, applied_seq, reason, source,
            reverted_by, reverted_at
       from correction where artifact_id = $1 order by merge_field, applied_seq`, [artifactId])
  return rows
}

export { getPgClient }

// ---------------------------------------------------------------------------------------------
// The routes. Reading the change log, and undoing one entry.

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { revertOne, locateOwnerPhrase } from './correction'
import { createHash } from 'node:crypto'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

/** GET /api/app/artifact/{artifactId}/corrections — the change log, undone rows included. */
export async function artifactCorrectionsGet(req: HttpRequest, _c: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const artifactId = req.params.artifactId
  let client
  try {
    client = await getPgClient()
    const rows = await listCorrections(client, artifactId)
    // `corrections` is the key P8.6's change log reads. An artifact with none returns an EMPTY
    // ARRAY, never an absent key: the UI distinguishes "nothing needed correcting" from "nobody
    // asked", and it can only do that if the two states look different on the wire.
    return { status: 200, headers: HEADERS, jsonBody: { artifact_id: artifactId, corrections: rows } }
  } catch (e: any) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

/**
 * POST /api/app/correction/{correctionId}/revert — put one phrase back.
 *
 * A REFUSAL IS A SUCCESSFUL OUTCOME OF THIS ROUTE, not an error. `revertOne` declines when the
 * field was rewritten after the correction was applied, because the recovered original no longer
 * hashes to `before_sha256` — splicing into text that has moved would corrupt the document silently.
 * The refusal comes back 200 with `ok:false` and the reason in the user's words, because the UI has
 * to show it: a 4xx would be swallowed by a generic error path and the user would be told nothing.
 *
 * Every other failure IS a status code. The distinction is deliberate: `ok:false` means the system
 * worked and declined; a 4xx/5xx means it did not work.
 */
export async function correctionRevert(req: HttpRequest, _c: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  const correctionId = req.params.correctionId
  let client
  try {
    client = await getPgClient()
    await ensureCorrectionTable(client)
    const target = (await client.query(
      `select * from correction where id = $1`, [correctionId])).rows[0]
    if (!target) return { status: 404, headers: HEADERS, jsonBody: { error: 'no such correction' } }
    if (target.reverted_at) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: 'this correction was already undone' } }
    }

    // Every correction still applied to THIS field, which is what `revertOne` replays. A revert is
    // computed against the whole set, never against the one row: the offsets are original-relative
    // and only the full list can reconstruct the original text.
    const siblings = (await client.query(
      `select * from correction where artifact_id = $1 and merge_field = $2 and reverted_at is null
       order by applied_seq`, [target.artifact_id, target.merge_field])).rows
    const applied: Correction[] = siblings.map(r => ({
      merge_field: r.merge_field, phrase: r.phrase, replacement: r.replacement,
      char_start: r.char_start, char_end: r.char_end, before_sha256: r.before_sha256,
      applied_seq: r.applied_seq, reason: r.reason, source: r.source,
    }))

    const art = (await client.query(
      `select a.id, a.packet_id, p.pkg_json from artifact a join packet p on p.id = a.packet_id
        where a.id = $1`, [target.artifact_id])).rows[0]
    if (!art?.pkg_json) return { status: 409, headers: HEADERS, jsonBody: { error: 'this artifact has no stored package to revert in' } }

    const current = String(art.pkg_json[target.merge_field] ?? '')
    const result = revertOne(current, applied, target.applied_seq)
    if (!result.ok) {
      // Declined, and NOTHING is written — not the text, not the reverted_by stamp. A row marked
      // undone whose text never changed is the worst of both.
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: result.reason } }
    }

    const pkg = { ...art.pkg_json, [target.merge_field]: result.text }
    await client.query('begin')
    try {
      await client.query(`update packet set pkg_json = $1, updated_at = now() where id = $2`,
        [JSON.stringify(pkg), art.packet_id])
      // reverted_by is the SESSION-resolved owner, never a client-supplied value — the same rule
      // artifact_gate's override applies, for the same reason.
      await client.query(
        `update correction set reverted_by = $1, reverted_at = now() where id = $2 and reverted_at is null`,
        [owner, correctionId])
      await client.query('commit')
    } catch (e) { await client.query('rollback'); throw e }

    return { status: 200, headers: HEADERS, jsonBody: { ok: true, merge_field: target.merge_field, text: result.text } }
  } catch (e: any) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

/**
 * POST /api/app/artifact/{artifactId}/owner-edit — the owner rewrites a phrase themselves.
 *
 * EXTENDS `correction` rather than standing up an override store beside it. The owner chose this
 * over `swap_decision`, and the AC pass had found the reason: `writeSwaps` runs
 * `delete from swap_decision where packet_id=$1 and loop=$2` and re-inserts on EVERY build, so an
 * override stored there is destroyed by the next run. Nothing deletes from `correction`.
 *
 * A REFUSAL IS A SUCCESSFUL OUTCOME, exactly as it is for revert: 200 with `ok:false` and the reason
 * in the owner's own words. A 4xx would be swallowed by a generic error path and the owner told
 * nothing. Every other failure IS a status code — the system did not work, rather than declining.
 *
 * THE PHRASE MUST APPEAR EXACTLY ONCE. Zero means the text moved under them since the screen
 * rendered; two or more means we cannot tell which they meant and editing the wrong one would
 * silently rewrite a sentence they never looked at. Both refuse. No nearest match, no similarity —
 * splicing into the owner's document is accusation-grade and this repo reserves fuzzy matching for
 * ranking.
 *
 * `before_sha256` is the hash of the text AS IT IS NOW, which is what makes the edit undoable by the
 * existing revert route with no special case: an owner edit is a correction like any other, and the
 * one thing that distinguishes it is `source`.
 */
export async function artifactOwnerEdit(req: HttpRequest, _c: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const artifactId = req.params.artifactId
  let client
  try {
    const body: any = await req.json().catch(() => ({}))
    const mergeField = String(body?.merge_field || '').trim()
    const phrase = String(body?.phrase ?? '')
    const replacement = String(body?.replacement ?? '')
    if (!mergeField) return { status: 400, headers: HEADERS, jsonBody: { error: 'merge_field is required' } }
    if (!phrase) return { status: 400, headers: HEADERS, jsonBody: { error: 'phrase is required' } }
    // An empty replacement is a DELETION, which is a legitimate edit; the database's own
    // correction_phrase_nonempty guards the other side. Only a no-op is refused.
    if (replacement === phrase) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: 'that is the same wording it already has' } }
    }

    client = await getPgClient()
    await ensureCorrectionTable(client)
    const art = (await client.query(
      `select a.id, a.packet_id, p.pkg_json from artifact a join packet p on p.id = a.packet_id
        where a.id = $1`, [artifactId])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'no such artifact' } }
    if (!art.pkg_json) return { status: 409, headers: HEADERS, jsonBody: { error: 'this artifact has no stored package to edit' } }
    if (!(mergeField in art.pkg_json)) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: `this asset has no ${mergeField} block to edit` } }
    }

    const current = String(art.pkg_json[mergeField] ?? '')
    // ONE implementation of "exactly one occurrence, or refuse", shared with reapplyOwnerEdits.
    // Two copies would eventually accept an edit here that lapses on the very next rebuild for a
    // different reason, which reads to the owner as the product losing their work at random.
    const found = locateOwnerPhrase(current, phrase)
    if (found.at === null) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, reason: found.reason } }
    }
    const first = found.at

    const next = current.slice(0, first) + replacement + current.slice(first + phrase.length)
    const seq = Number((await client.query(
      `select coalesce(max(applied_seq), 0) + 1 as n from correction where artifact_id = $1 and merge_field = $2`,
      [artifactId, mergeField])).rows[0]?.n || 1)

    const pkg = { ...art.pkg_json, [mergeField]: next }
    await client.query('begin')
    try {
      await client.query(`update packet set pkg_json = $1, updated_at = now() where id = $2`,
        [JSON.stringify(pkg), art.packet_id])
      await client.query(
        `insert into correction (artifact_id, merge_field, phrase, replacement, char_start, char_end,
           before_sha256, applied_seq, reason, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'owner_edit')`,
        [artifactId, mergeField, phrase, replacement, first, first + phrase.length,
         createHash('sha256').update(current).digest('hex'), seq, 'you changed this yourself'])
      await client.query('commit')
    } catch (e) { await client.query('rollback'); throw e }

    return { status: 200, headers: HEADERS, jsonBody: { ok: true, merge_field: mergeField, text: next, applied_seq: seq } }
  } catch (e: any) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('artifactCorrectionsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/corrections', handler: artifactCorrectionsGet })
app.http('artifactOwnerEdit', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/owner-edit', handler: artifactOwnerEdit })
app.http('correctionRevert', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/correction/{correctionId}/revert', handler: correctionRevert })

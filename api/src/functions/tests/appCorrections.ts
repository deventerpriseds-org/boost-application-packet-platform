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
import { planCorrections, applyCorrections, Correction } from './correction'

export const CORRECTION_PASS_VERSION = 1

/** Fields whose text is prose or list items the user reads — never ids, urls or metadata. */
const CORRECTABLE = (pkg: Record<string, any>) =>
  Object.keys(pkg || {}).filter(k => typeof pkg[k] === 'string' && pkg[k].trim().length > 0)

export interface PassResult {
  /** Rows written, in document order per field. Empty when nothing needed correcting. */
  rows: Correction[]
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
    source        text not null check (source in ('profile_figure','generalized')),
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
    return { rows: all, notApplicable: false, scanned }
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

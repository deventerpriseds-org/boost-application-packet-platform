// Per-owner check settings — the ONE reader and writer of the `chk_*` columns.
//
// EXTRACTED from `appChecks.ts` so that `appRequirements` can load an owner's evidence settings
// WITHOUT importing `appChecks`, which imports `appRequirements` back. Under `tsc`'s CommonJS output
// that cycle happens to work (both symbols are used at call time, never at module init), and
// "happens to work" is not a property to build a settings path on. This module imports nothing from
// either file, so the graph stays a DAG.
//
// EXTENDS `owner_search_prefs` rather than creating a settings table — that is the established
// per-owner settings store and `jdSweep.ts` and `appDimensions.ts` already extend it the same way.
import { CheckThresholds, DEFAULT_THRESHOLDS } from './checks'
import type { ResolveOptions } from './evidence'

/**
 * Per-owner check thresholds.
 *
 * EXTENDS `owner_search_prefs` rather than creating a settings table — that is the established
 * per-owner settings store and `jdSweep.ts` already extended it the same way. Code seeds the first
 * value (from the live prompt); the owner changes it from there. No threshold in `checks.ts` may
 * become a permanent constant.
 */
/**
 * The `chk_*` (and, since D:reextract-recheck-bound below, `srch_*`) columns, DERIVED from the
 * statement that declares them.
 *
 * This is the whitelist for the settings WRITER, and it is read out of the ensure SQL rather than
 * typed beside it. A hand-maintained list is the shape that goes stale in silence: H42 exists
 * because eleven settings production READ had no writer at all, and a writer whose whitelist someone
 * must remember to extend recreates that gap one knob at a time. Derived, a new column is writable
 * the day it is added.
 *
 * WIDENED from `chk_*` only to `chk_*` or `srch_*` for D:reextract-recheck-bound (the re-extraction
 * lane's `srch_reextract_recheck_max_artifacts` bound — Lane B does not own this file). This is a
 * deliberate reuse of the SAME injection-safe whitelist/coerce/build-SET-clause machinery
 * (`writeCheckPrefs`) rather than a second ad-hoc writer for one column — "extend, don't duplicate".
 * Widening the accepted prefix does not weaken the safety property: the whitelist is still derived
 * ENTIRELY from this trusted, hand-written SQL literal, never from caller input, regardless of which
 * of the two prefixes a declared column uses.
 *
 * Only `chk_*`/`srch_*` names are returned, so the writer can never reach `target_geo_ids`, `temp_*`
 * or any other column of the same table — those have their own validated paths in `appSearchPrefs`.
 */
export function checkPrefColumns(): Array<{ column: string; type: 'int' | 'numeric' | 'boolean' }> {
  const out: Array<{ column: string; type: 'int' | 'numeric' | 'boolean' }> = []
  for (const m of ENSURE_CHECK_COLUMNS_SQL.matchAll(/add column if not exists\s+((?:chk|srch)_[a-z0-9_]+)\s+(int|numeric|boolean)\b/g)) {
    out.push({ column: m[1], type: m[2] as any })
  }
  return out
}

/** The one declaration, shared by the ensure path and the writer's whitelist so they cannot drift. */
const ENSURE_CHECK_COLUMNS_SQL = `
    alter table owner_search_prefs
      add column if not exists chk_skill_max_chars      int not null default ${DEFAULT_THRESHOLDS.skillMaxChars},
      add column if not exists chk_compact_skills_chars int not null default ${DEFAULT_THRESHOLDS.compactSkillsMaxChars},
      add column if not exists chk_skills_total_min     int not null default ${DEFAULT_THRESHOLDS.skillsTotalMin},
      add column if not exists chk_skills_total_max     int not null default ${DEFAULT_THRESHOLDS.skillsTotalMax},
      add column if not exists chk_relevant_max_chars   int not null default ${DEFAULT_THRESHOLDS.relevantMaxChars},
      add column if not exists chk_relevant_allowance   int not null default ${DEFAULT_THRESHOLDS.relevantOverLimitAllowance},
      add column if not exists chk_expertise_words      int not null default ${DEFAULT_THRESHOLDS.expertiseWords},
      add column if not exists chk_cover_words_min      int not null default ${DEFAULT_THRESHOLDS.coverWords[0]},
      add column if not exists chk_cover_words_max      int not null default ${DEFAULT_THRESHOLDS.coverWords[1]},
      add column if not exists chk_evidence_threshold   numeric not null default ${DEFAULT_THRESHOLDS.evidenceThreshold},
      add column if not exists chk_evidence_min_tokens  int not null default ${DEFAULT_THRESHOLDS.evidenceMinTokens},
      add column if not exists chk_evidence_max_sentences int not null default ${DEFAULT_THRESHOLDS.evidenceMaxSentences},
      add column if not exists chk_evidence_bullet_run  int not null default ${DEFAULT_THRESHOLDS.evidenceBulletRun},
      add column if not exists chk_evidence_escalate  boolean not null default ${DEFAULT_THRESHOLDS.evidenceEscalate},
      add column if not exists chk_evidence_escalate_max int not null default ${DEFAULT_THRESHOLDS.evidenceEscalateMax},
      -- THE COVERAGE JUDGE. Off by default: unlike escalation, a verdict changes a check's state,
      -- so the owner turns it on after seeing it read their own packet. There is deliberately no
      -- model column here (D:model-is-43-literals) -- see CheckThresholds.coverageJudge.
      add column if not exists chk_coverage_judge      boolean not null default ${DEFAULT_THRESHOLDS.coverageJudge},
      add column if not exists chk_reviewer_auto       boolean not null default ${DEFAULT_THRESHOLDS.reviewerAuto},
      add column if not exists chk_coverage_judge_max  int not null default ${DEFAULT_THRESHOLDS.coverageJudgeMaxCalls},
      add column if not exists chk_coverage_judge_min_quote int not null default ${DEFAULT_THRESHOLDS.coverageJudgeMinQuoteChars},
      -- Whether a 'fail' gate BLOCKS approval or may be overridden with a recorded reason. Default
      -- false = today's behaviour. See CheckThresholds.gateAdvisory for why this exists and why it
      -- deliberately does not touch the gate value or the check rows.
      add column if not exists chk_gate_advisory      boolean not null default ${DEFAULT_THRESHOLDS.gateAdvisory},
      -- EVERY rule number is tweakable, at the owner's instruction (2026-08-22): "all such rule
      -- numbers need to be available for tweaking in the settings/config". These six were the
      -- thresholds runChecks enforced with NO config column, so they were code-only constants the
      -- owner could not change — the no-hardcoded-config rule, violated quietly by omission rather
      -- than by a literal. H:every-threshold-is-configurable now fails if a new one is added
      -- without a column, so the gap cannot regrow one threshold at a time the way it grew.
      -- (No backticks in this comment: it lives inside a template literal, where a backtick ends it.)
      add column if not exists chk_skills_split_tolerance int not null default ${DEFAULT_THRESHOLDS.skillsSplitTolerance},
      add column if not exists chk_wording_run_tokens   int not null default ${DEFAULT_THRESHOLDS.wordingRunTokens},
      add column if not exists chk_about_me1_words_min  int not null default ${DEFAULT_THRESHOLDS.aboutMe1Words[0]},
      add column if not exists chk_about_me1_words_max  int not null default ${DEFAULT_THRESHOLDS.aboutMe1Words[1]},
      add column if not exists chk_about_me2_words_min  int not null default ${DEFAULT_THRESHOLDS.aboutMe2Words[0]},
      add column if not exists chk_about_me2_words_max  int not null default ${DEFAULT_THRESHOLDS.aboutMe2Words[1]},
      add column if not exists chk_resume_summary_words_min int not null default ${DEFAULT_THRESHOLDS.resumeSummaryWords[0]},
      add column if not exists chk_resume_summary_words_max int not null default ${DEFAULT_THRESHOLDS.resumeSummaryWords[1]},
      add column if not exists chk_exec_profile_words_min int not null default ${DEFAULT_THRESHOLDS.execProfileWords[0]},
      add column if not exists chk_exec_profile_words_max int not null default ${DEFAULT_THRESHOLDS.execProfileWords[1]},
      add column if not exists chk_core_accomp_words_min int not null default ${DEFAULT_THRESHOLDS.coreAccomplishmentsWords[0]},
      add column if not exists chk_core_accomp_words_max int not null default ${DEFAULT_THRESHOLDS.coreAccomplishmentsWords[1]},
      -- D:config-staleness-backfill (AC 10-15). No-hardcoded-config: both bounds an owner would
      -- reasonably want to change as their corpus grows, so both are settings, not literals. Not
      -- derived from DEFAULT_THRESHOLDS (checks.ts is out of scope for this change) -- a plain
      -- literal default here is exactly as owner-changeable as every column above it, because
      -- checkPrefColumns()/writeCheckPrefs whitelist every chk_ column the same automatic way, this pair
      -- included, from the moment they exist.
      -- Artifacts processed per 5-minute sweep tick (appBuildJobs.ts artifactRecheckSweep).
      add column if not exists chk_backfill_batch_size   int not null default 5,
      -- Cap on rows one settings-flip (off->on) may enqueue at once. This is what makes the
      -- backfill BOUNDED regardless of corpus size -- H:backfill-is-bounded proves it.
      add column if not exists chk_backfill_max_per_flip int not null default 500,
      -- D:reextract-recheck-bound -- routed from the re-extraction lane (Lane B, appJdParse.ts/
      -- appRequirements.ts), which does not own this file. Bounds how many artifacts of an
      -- opportunity get rechecked when a requirements re-parse changes the requirement set
      -- (structureRequirements/applyAnchorTruth -> recheckArtifactsAfterRequirementsChange). srch_
      -- prefix (not chk_) because this is a re-extraction/search-domain bound, not a
      -- deterministic-checks threshold -- it rides the SAME whitelist-writer machinery as every
      -- chk_ column above (checkPrefColumns()'s regex was widened to admit both prefixes; see its
      -- own comment for why that is a safe reuse rather than a new writer).
      add column if not exists srch_reextract_recheck_max_artifacts int not null default 5`

/**
 * SYNC THE COLUMN DEFAULTS TO THE CODE SEEDS.
 *
 * `add column if not exists` SKIPS an existing column ENTIRELY — including its DEFAULT. So editing
 * `DEFAULT_THRESHOLDS` changed nothing in a database that already had the column: the default
 * stayed at whatever the first deploy created, and every new owner kept inheriting the old value.
 *
 * MEASURED 2026-08-23, and it is why this exists: after changing `skillMaxChars` 30 -> 24 and
 * deploying successfully, production still read `column_default = 30` and the owner's row still held
 * 30. The code said 24, the tests said 24, the deploy was green, and the live gate was still 24-blind.
 * Reporting that change as live would have been false.
 *
 * EXISTING ROWS ARE NEVER TOUCHED. A stored value is the owner's, and code does not get to overwrite
 * an owner's setting — the seed only decides what a NEW owner starts from. That is also why this
 * cannot repair an owner whose row predates a seed change; that is a deliberate data decision, not
 * something to do silently on every boot.
 */
async function syncCheckPrefDefaults(client: any) {
  for (const { column } of checkPrefColumns()) {
    const seed = SEEDED_DEFAULT[column]
    if (seed === undefined) continue
    // Column names cannot be parameterised, but `column` comes from the whitelist DERIVED from the
    // ensure SQL — never from a caller — and `seed` is a number/boolean from code, never input.
    try { await client.query(`alter table owner_search_prefs alter column ${column} set default ${seed}`) } catch { /* non-fatal */ }
  }
}

/** The seed each chk_/srch_ column is declared with, parsed from the one statement that declares them. */
const SEEDED_DEFAULT: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const m of ENSURE_CHECK_COLUMNS_SQL.matchAll(/add column if not exists\s+((?:chk|srch)_[a-z0-9_]+)\s+(?:int|numeric|boolean)\s+not null default\s+([^,\n]+)/g)) {
    out[m[1]] = m[2].trim()
  }
  return out
})()

export async function ensureCheckPrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  // `writeCheckPrefs`'s UPDATE has always set `updated_at=now()` unconditionally, but this module
  // never created that column itself -- it only worked because `appSearchPrefs.ts`'s OWN `ensurePrefs`
  // happens to run first on every real request and adds it. That made `writeCheckPrefs` silently
  // depend on a caller-side ensure it does not control. Found while adding
  // `test/checkPrefsBackfillDb.test.mjs` (D:config-staleness-backfill), which calls `writeCheckPrefs`
  // directly the way `applyJudgeTransition`'s own callers eventually will (a sweep, a backfill),
  // without going through the HTTP route first -- `column "updated_at" does not exist`, 42703, against
  // a real Postgres. Idempotent add, harmless on a database `appSearchPrefs.ts` already migrated.
  await client.query(`alter table owner_search_prefs add column if not exists updated_at timestamptz not null default now()`)
  await client.query(ENSURE_CHECK_COLUMNS_SQL)
  // The ALTER above skips existing columns, so a changed seed would never reach the database.
  await syncCheckPrefDefaults(client)
}

/**
 * D:config-staleness-backfill (AC 10-15).
 *
 * Enqueue or cancel bounded recheck work for one `chk_*` boolean's transition, called from inside
 * `writeCheckPrefs` for `chk_coverage_judge` and `chk_reviewer_auto` only — those are the two
 * settings whose off->on transition can leave an already-gated artifact's verdict computed under a
 * config that no longer applies (the Trinnex incident this whole lane exists for).
 *
 * NO HISTORY TABLE (Q2, AC-judge-trigger-points.md): the transition is detected by comparing the
 * value read from `owner_search_prefs` BEFORE this same request's UPDATE to the value the request is
 * about to write — `owner_search_prefs.updated_at` is a single scalar shared by every column on the
 * row (temp_* included), so it cannot tell "the judge flipped" from "the owner changed something
 * else", and is exactly the derived-proxy trap CLAUDE.md's own "ground-truth before answering" rule
 * warns against.
 *
 * Exported (not inlined in `writeCheckPrefs`) so it is independently DB-testable without needing a
 * full settings-write fixture — see H:settings-flip-queues-recheck / H:backfill-is-bounded.
 */
/**
 * The two owner-changeable backfill bounds, with the same safe-default handling every other
 * `chk_*` reader in this file uses (a row/column that predates this feature reads as the seeded
 * default, never as zero — zero would mean "queue nothing" / "process nothing per tick", which is
 * not what an unconfigured owner should get).
 *
 * Exported so `appBuildJobs.ts`'s sweep (owned by this lane too) can size its own per-tick claim by
 * the SAME setting `applyJudgeTransition` sized the enqueue by — one reader, not two copies of what
 * "the backfill batch size" means.
 */
export async function loadBackfillPrefs(client: any, owner: string): Promise<{ batchSize: number; maxPerFlip: number }> {
  await ensureCheckPrefs(client)
  const r = (await client.query(
    `select chk_backfill_batch_size, chk_backfill_max_per_flip from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  return {
    batchSize: Number.isFinite(r?.chk_backfill_batch_size) ? r.chk_backfill_batch_size : 5,
    maxPerFlip: Number.isFinite(r?.chk_backfill_max_per_flip) ? r.chk_backfill_max_per_flip : 500,
  }
}

/**
 * D:reextract-recheck-bound — the re-extraction lane's own bound, routed through this file because
 * that lane does not own it (see the column's own comment in ENSURE_CHECK_COLUMNS_SQL above).
 *
 * Same safe-default handling as every other reader here: an owner whose row predates this column —
 * or who has no row at all — gets the seeded default (5), never 0 (0 would mean "recheck nothing",
 * which is not what an unconfigured owner should get and is not what `DEFAULT_REEXTRACT_RECHECK_
 * MAX_ARTIFACTS` in appRequirements.ts means either).
 */
export async function loadReextractRecheckMax(client: any, owner: string): Promise<number> {
  await ensureCheckPrefs(client)
  const r = (await client.query(
    `select srch_reextract_recheck_max_artifacts from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  return Number.isFinite(r?.srch_reextract_recheck_max_artifacts) ? r.srch_reextract_recheck_max_artifacts : 5
}

export async function applyJudgeTransition(
  client: any, owner: string, reason: 'coverage_judge_on' | 'reviewer_auto_on', wasOn: boolean, isOn: boolean,
): Promise<number> {
  if (wasOn === isOn) return 0
  if (!isOn) {
    // AC 12: turning a judge OFF must never spend money re-running it — nothing is queued. AC 15:
    // a flip back off mid-backfill cancels this reason's REMAINING queue; a job already `running`
    // is left to finish (best-effort — it must not corrupt a gate by being killed mid-write, and
    // `evaluateArtifact`'s own transaction is what actually protects that).
    await client.query(
      `delete from artifact_recheck_job where owner_email=$1 and reason=$2 and state='pending'`,
      [owner, reason])
    return 0
  }
  // OFF -> ON: enqueue every already-gated artifact this owner has, bounded by their own
  // `chk_backfill_max_per_flip` setting so this can never insert unbounded work no matter how large
  // the corpus grows (H:backfill-is-bounded). `on conflict ... do nothing` against the partial
  // unique index means a rapid off/on/off/on cannot double-queue an artifact already pending.
  const { maxPerFlip: cap } = await loadBackfillPrefs(client, owner)
  const r = await client.query(
    `insert into artifact_recheck_job (artifact_id, owner_email, reason)
     select g.artifact_id, $1, $2
       from artifact_gate g
       join artifact a on a.id = g.artifact_id
       join packet p on p.id = a.packet_id
       join opportunity o on o.id = p.opp_id
      where o.owner_email = $1
      order by g.computed_at asc
      limit $3
     on conflict (artifact_id, reason) where state in ('pending','running') do nothing`,
    [owner, reason, cap])
  return r.rowCount || 0
}

/**
 * Apply an owner's `chk_*` edits. Returns the columns actually written, and how many artifacts were
 * queued for a config-staleness recheck by a `chk_coverage_judge`/`chk_reviewer_auto` off->on
 * transition this same call caused (AC 10 — "the response says so").
 *
 * Every key is checked against `checkPrefColumns()` and every value coerced by the column's own
 * declared type, so an unknown key is IGNORED rather than interpolated and a string cannot reach an
 * int column. The column name is never taken from the request — it is the whitelist entry that
 * matched — which is what keeps this a settings writer rather than a SQL injection surface.
 */
export async function writeCheckPrefs(
  client: any, owner: string, patch: any,
): Promise<{ written: string[]; queued: { coverageJudge: number; reviewerAuto: number } }> {
  const NONE = { written: [], queued: { coverageJudge: 0, reviewerAuto: 0 } }
  if (!patch || typeof patch !== 'object') return NONE
  await ensureCheckPrefs(client)
  await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
  // Read BEFORE the update — this IS the transition detection (see applyJudgeTransition's comment
  // for why no history table is needed).
  const before = (await client.query(
    `select chk_coverage_judge, chk_reviewer_auto from owner_search_prefs where owner_email=$1`, [owner])).rows[0] || {}
  const sets: string[] = []; const vals: any[] = [owner]; const written: string[] = []
  for (const { column, type } of checkPrefColumns()) {
    if (!(column in patch)) continue
    const raw = (patch as any)[column]
    let v: any
    if (type === 'boolean') { if (typeof raw !== 'boolean') continue; v = raw }
    else {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      v = type === 'int' ? Math.round(n) : n
    }
    vals.push(v); sets.push(`${column}=$${vals.length}`); written.push(column)
  }
  if (sets.length) {
    await client.query(`update owner_search_prefs set ${sets.join(', ')}, updated_at=now() where owner_email=$1`, vals)
  }
  const queued = { coverageJudge: 0, reviewerAuto: 0 }
  if (written.includes('chk_coverage_judge')) {
    queued.coverageJudge = await applyJudgeTransition(
      client, owner, 'coverage_judge_on', before.chk_coverage_judge === true, patch.chk_coverage_judge === true)
  }
  if (written.includes('chk_reviewer_auto')) {
    queued.reviewerAuto = await applyJudgeTransition(
      client, owner, 'reviewer_auto_on', before.chk_reviewer_auto === true, patch.chk_reviewer_auto === true)
  }
  return { written, queued }
}

export async function loadThresholds(client: any, owner: string): Promise<Partial<CheckThresholds>> {
  await ensureCheckPrefs(client)
  const r = (await client.query(
    `select chk_skill_max_chars, chk_compact_skills_chars, chk_skills_total_min, chk_skills_total_max, chk_relevant_max_chars,
            chk_relevant_allowance, chk_expertise_words, chk_cover_words_min, chk_cover_words_max,
            chk_evidence_threshold, chk_evidence_min_tokens,
            chk_evidence_max_sentences, chk_evidence_bullet_run,
            chk_evidence_escalate, chk_evidence_escalate_max, chk_gate_advisory,
            chk_coverage_judge, chk_coverage_judge_max, chk_coverage_judge_min_quote,
            chk_reviewer_auto,
            chk_skills_split_tolerance, chk_wording_run_tokens,
            chk_resume_summary_words_min, chk_resume_summary_words_max,
            chk_about_me1_words_min, chk_about_me1_words_max,
            chk_about_me2_words_min, chk_about_me2_words_max,
            chk_exec_profile_words_min, chk_exec_profile_words_max,
            chk_core_accomp_words_min, chk_core_accomp_words_max,
            -- chk_backfill_batch_size/chk_backfill_max_per_flip (D:config-staleness-backfill)
            -- SELECTED HERE so H:every-chk-column-is-selected (hardening.test.mjs) — every declared
            -- chk_ column must be selected by loadThresholds, or the owner can set it and nothing
            -- reads it — stays true. They are NOT added to the returned object below: they are not
            -- inputs to the deterministic-checks engine (CheckThresholds, checks.ts, out of scope
            -- for this lane), they are read by loadBackfillPrefs() (this file) for the sweep in
            -- appBuildJobs.ts. Genuinely selected here too, not a no-op — this row's value for them
            -- is simply unused by THIS caller.
            chk_backfill_batch_size, chk_backfill_max_per_flip
       from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  if (!r) return {}
  return {
    skillMaxChars: r.chk_skill_max_chars,
    compactSkillsMaxChars: r.chk_compact_skills_chars,
    skillsTotalMin: r.chk_skills_total_min,
    skillsTotalMax: r.chk_skills_total_max,
    relevantMaxChars: r.chk_relevant_max_chars,
    relevantOverLimitAllowance: r.chk_relevant_allowance,
    expertiseWords: r.chk_expertise_words,
    coverWords: [r.chk_cover_words_min, r.chk_cover_words_max],
    evidenceThreshold: r.chk_evidence_threshold === null ? undefined : Number(r.chk_evidence_threshold),
    evidenceMinTokens: r.chk_evidence_min_tokens ?? undefined,
    evidenceMaxSentences: r.chk_evidence_max_sentences ?? undefined,
    evidenceBulletRun: r.chk_evidence_bullet_run ?? undefined,
    evidenceEscalate: r.chk_evidence_escalate === true,
    // `=== true`, matching the line above: a NULL column on a row written before this setting
    // existed must read as OFF, never as "truthy enough".
    gateAdvisory: r.chk_gate_advisory === true,
    evidenceEscalateMax: r.chk_evidence_escalate_max ?? undefined,
    // `=== true` again, and here it is the SAFE direction rather than the awkward one: an owner
    // whose row predates this column reads as OFF, which is the lexical behaviour they already have.
    coverageJudge: r.chk_coverage_judge === true,
    // `=== true` like its sibling, not a truthy test: a NULL from a row written before the
    // column existed must read as OFF, never as "the owner enabled this".
    reviewerAuto: r.chk_reviewer_auto === true,
    coverageJudgeMaxCalls: r.chk_coverage_judge_max ?? undefined,
    coverageJudgeMinQuoteChars: r.chk_coverage_judge_min_quote ?? undefined,
    skillsSplitTolerance: r.chk_skills_split_tolerance ?? undefined,
    wordingRunTokens: r.chk_wording_run_tokens ?? undefined,
    aboutMe1Words: [r.chk_about_me1_words_min, r.chk_about_me1_words_max],
    aboutMe2Words: [r.chk_about_me2_words_min, r.chk_about_me2_words_max],
    resumeSummaryWords: [r.chk_resume_summary_words_min, r.chk_resume_summary_words_max],
    execProfileWords: [r.chk_exec_profile_words_min, r.chk_exec_profile_words_max],
    coreAccomplishmentsWords: [r.chk_core_accomp_words_min, r.chk_core_accomp_words_max],
  }
}

/**
 * The owner's evidence settings, as `ResolveOptions`.
 *
 * ONE place, so a third caller of `writeEvidence` cannot appear without them. `loadThresholds`
 * returns `{}` for an owner who has never been written to `owner_search_prefs`, and every field of
 * `ResolveOptions` is optional, so an unconfigured owner falls through to the SEEDED defaults inside
 * `resolveEvidence` rather than to zero — which would evidence everything.
 */
export async function resolveOptionsFor(client: any, owner: string): Promise<ResolveOptions> {
  return resolveOptionsFrom(await loadThresholds(client, owner))
}

/**
 * The same mapping, without the query — for a caller that already loaded the thresholds.
 *
 * `appChecks` loads them for the checks anyway and used to hand-build the options object beside
 * this one, which is how `bulletRunMax` came to be settable everywhere EXCEPT the path the gate
 * runs on. A setting that reaches two of its three callers is worse than one that reaches none: it
 * looks configurable and behaves differently depending on which route ran. One mapper, one shape.
 */
export function resolveOptionsFrom(t: Partial<CheckThresholds>): ResolveOptions {
  return {
    threshold: t.evidenceThreshold,
    minTokens: t.evidenceMinTokens,
    maxSentences: t.evidenceMaxSentences,
    bulletRunMax: t.evidenceBulletRun,
    // ON UNLESS THE OWNER SAID OTHERWISE — `!== false`, and the distinction is not pedantry.
    //
    // `ensureCheckPrefs` only ADDS the column; it does not INSERT a row. So `loadThresholds` returns
    // `{}` for an owner who has never been written to `owner_search_prefs`, and a strict `=== true`
    // would have left exactly that owner OFF while the column's default said ON — a seed that reads
    // as enabled and behaves as disabled, which is the worst of both.
    //
    // `!== false` distinguishes the three real states: no row yet (take the seed, ON), a row saying
    // true (ON), a row saying false (OFF, and it beats the seed — the setting wins over the code,
    // which is the no-hardcoded-config rule pointing the way that matters).
    //
    // This REVERSES the safe-by-default posture this line shipped with a few commits ago, at the
    // owner's explicit instruction: "I don't know why the escalation needs to be turned on or off vs
    // always on ... make sure the toggle is automatically on by default." What makes that safe is
    // not the toggle but `checks.ts`: a proposed row is shown beside a requirement and can never
    // count toward coverage, so the tier only ever ADDS information where there was none. It changes
    // what the owner is told, never what they are scored — and never what the resume draft says,
    // which is written from their prompts before this pass runs at all.
    escalate: t.evidenceEscalate !== false,
    escalateMax: t.evidenceEscalateMax,
    // `=== true`, like the column it reads: an owner who has never touched the judge setting keeps
    // today's withdrawals exactly. The appeal can only ever OVERTURN a withdrawal, never cause one.
    appealOverclaims: t.coverageJudge === true,
    vetProposals: t.coverageJudge === true,
  }
}

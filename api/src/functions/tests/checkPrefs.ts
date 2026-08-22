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
 * The `chk_*` columns, DERIVED from the statement that declares them.
 *
 * This is the whitelist for the settings WRITER, and it is read out of the ensure SQL rather than
 * typed beside it. A hand-maintained list is the shape that goes stale in silence: H42 exists
 * because eleven settings production READ had no writer at all, and a writer whose whitelist someone
 * must remember to extend recreates that gap one knob at a time. Derived, a new column is writable
 * the day it is added.
 *
 * Only `chk_*` names are returned, so the writer can never reach `target_geo_ids`, `temp_*` or any
 * other column of the same table — those have their own validated paths in `appSearchPrefs`.
 */
export function checkPrefColumns(): Array<{ column: string; type: 'int' | 'numeric' | 'boolean' }> {
  const out: Array<{ column: string; type: 'int' | 'numeric' | 'boolean' }> = []
  for (const m of ENSURE_CHECK_COLUMNS_SQL.matchAll(/add column if not exists\s+(chk_[a-z0-9_]+)\s+(int|numeric|boolean)\b/g)) {
    out.push({ column: m[1], type: m[2] as any })
  }
  return out
}

/** The one declaration, shared by the ensure path and the writer's whitelist so they cannot drift. */
const ENSURE_CHECK_COLUMNS_SQL = `
    alter table owner_search_prefs
      add column if not exists chk_skill_max_chars      int not null default ${DEFAULT_THRESHOLDS.skillMaxChars},
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
      add column if not exists chk_evidence_escalate_max int not null default ${DEFAULT_THRESHOLDS.evidenceEscalateMax}`

export async function ensureCheckPrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(ENSURE_CHECK_COLUMNS_SQL)
}

/**
 * Apply an owner's `chk_*` edits. Returns the columns actually written.
 *
 * Every key is checked against `checkPrefColumns()` and every value coerced by the column's own
 * declared type, so an unknown key is IGNORED rather than interpolated and a string cannot reach an
 * int column. The column name is never taken from the request — it is the whitelist entry that
 * matched — which is what keeps this a settings writer rather than a SQL injection surface.
 */
export async function writeCheckPrefs(client: any, owner: string, patch: any): Promise<string[]> {
  if (!patch || typeof patch !== 'object') return []
  await ensureCheckPrefs(client)
  await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
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
  return written
}

export async function loadThresholds(client: any, owner: string): Promise<Partial<CheckThresholds>> {
  await ensureCheckPrefs(client)
  const r = (await client.query(
    `select chk_skill_max_chars, chk_skills_total_min, chk_skills_total_max, chk_relevant_max_chars,
            chk_relevant_allowance, chk_expertise_words, chk_cover_words_min, chk_cover_words_max,
            chk_evidence_threshold, chk_evidence_min_tokens,
            chk_evidence_max_sentences, chk_evidence_bullet_run,
            chk_evidence_escalate, chk_evidence_escalate_max
       from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  if (!r) return {}
  return {
    skillMaxChars: r.chk_skill_max_chars,
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
    evidenceEscalateMax: r.chk_evidence_escalate_max ?? undefined,
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
  }
}

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
export async function ensureCheckPrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(`
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
      add column if not exists chk_evidence_escalate_max int not null default ${DEFAULT_THRESHOLDS.evidenceEscalateMax}`)
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
    // THE ONE FIELD THAT DOES NOT FALL THROUGH TO A SEEDED DEFAULT, and the asymmetry is deliberate.
    // Every option above it is a threshold: an owner who has never been written to
    // `owner_search_prefs` gets `undefined` and `resolveEvidence` supplies the seeded value, which
    // is right, because a missing threshold must not mean zero. This one is a spend-and-trust
    // toggle, so the unconfigured state must be OFF rather than whatever the code currently seeds —
    // `=== true`, not `??`. A future seed of `true` would otherwise silently enrol every owner who
    // has never opened the setting.
    escalate: t.evidenceEscalate === true,
    escalateMax: t.evidenceEscalateMax,
  }
}

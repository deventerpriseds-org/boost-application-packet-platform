/**
 * The owner's SKILL REWORDINGS — a setting, not a constant.
 *
 * WHY THIS EXISTS AT ALL. `buildSkillPool` only ever SPLITS and NORMALISES the owner's stored text;
 * it never rewrites wording, and a guard pins that (`H:skill-pool-rewords-only-from-the-injected-map
 * -never-from-code`). But four of the owner's seven `expertise` entries are STATEMENTS rather than
 * terms - "Enterprise alignment of strategy and execution" - and the owner asked for them broken down
 * "into items in similar style and length to the skills1 and skills2 items". That is a rewrite of the
 * owner's own words, so it cannot live in the parser and it cannot be invented per-run by a model.
 *
 * WHERE IT LIVES, AND WHY NOT IN CODE. A checked-in TS table would be auditable but would violate
 * CLAUDE.md's strict no-hardcoded-config rule: *"the code may only SEED the first/default value -
 * which the user can then change."* The owner chose the store explicitly: *"config store so i can
 * edit them"*. So `SKILL_REWORD_SEED` below is the FIRST value and nothing more; once the owner
 * saves, the stored map wins entirely.
 *
 * EXTENDS `owner_search_prefs`, the established per-owner settings store that `ensureCheckPrefs`,
 * `jdSweep` and `ensureDimensionPrefs` already extend. One more jsonb column, no new table - the
 * extend-don't-duplicate rule, and the reason a re-seed cannot orphan a settings row.
 */
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { readSkillFields } from './diagSkillSources'
import { createHash } from 'crypto'
import { buildSkillPool, SkillOrigin } from './skillPool'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

/**
 * The FIRST value, seeded once and owned by the owner thereafter.
 *
 * Every key is a phrase the owner actually wrote, verbatim, so a drifted key is detectable (the pool
 * reports `staleRewords`). A replacement containing `|` yields SEVERAL terms: "Budget Development and
 * P&L Management" is genuinely two skills, and a 1:1 map silently dropped one of them.
 *
 * The four marked REWORD change the owner's meaning-preserving phrasing and were approved explicitly;
 * the rest are splits or case-correction, which still count as rewording here because case-correction
 * in the parser fails `H:skill-pool-strips-formatting-not-wording`.
 */
export const SKILL_REWORD_SEED: Record<string, string> = {
  // splits - both halves are the owner's own words
  'Budget Development and P&L Management': 'Budget Development | P&L Management',
  'Strategic roadmaps for customer-centric innovation': 'Strategic Roadmaps | Customer-Centric Innovation',
  'M&A due diligence and technology integration': 'M&A Due Diligence | Technology Integration',
  // case-correction only
  'KPI-driven performance management': 'KPI-Driven Performance',
  // REWORD - approved 2026-08-26
  'Enterprise alignment of strategy and execution': 'Strategic Alignment',
  'Governance frameworks for compliance': 'Governance Frameworks',
  'Optimizing scaled agile operations': 'Scaled Agile Operations',
  'Corporate AI Use Cases': 'Corporate AI Adoption',
  'Budget and Cost Control': 'Cost Control',
}

/** One more jsonb column on the per-owner settings store. No new table. */
export async function ensureSkillRewords(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(`alter table owner_search_prefs add column if not exists skill_rewords jsonb`)
}

/**
 * The owner's stored map, or NULL when they have never saved one.
 *
 * NULL IS NOT `{}`, and the difference decides behaviour: null means "never chosen, use the seed",
 * while `{}` means "chosen, and chosen to be empty" - the owner deleting every reword must leave the
 * pool verbatim rather than silently resurrecting the seed. Collapsing the two is how a setting the
 * owner cleared comes back on the next read.
 */
export async function loadSkillRewords(client: any, owner: string): Promise<Record<string, string> | null> {
  await ensureSkillRewords(client)
  const r = (await client.query(`select skill_rewords from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  const v = r?.skill_rewords
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    const from = String(k).trim()
    const to = val == null ? '' : String(val).trim()
    if (from) out[from] = to
  }
  return out
}

/**
 * Replace the owner's map WHOLESALE, not by merge.
 *
 * Deliberately unlike `setDimensionPrefs`, which merges per family - and the difference is the point.
 * A merge cannot express DELETION, and deleting a reword is the main thing the owner will do with
 * this screen (they disagree with one of my rewrites). Merging would make every reword permanent
 * once seeded, which is the "stored default with no writer is a constant" failure wearing a writer.
 *
 * An empty-string replacement is dropped rather than stored: it would map a term to nothing, and a
 * term rewritten to nothing is a term deleted from the owner's own bank.
 */
export async function setSkillRewords(client: any, owner: string, rewords: Record<string, string>): Promise<{
  stored: Record<string, string>; dropped: string[]
}> {
  await ensureSkillRewords(client)
  const clean: Record<string, string> = {}
  const dropped: string[] = []
  for (const [k, v] of Object.entries(rewords || {})) {
    const from = String(k || '').trim()
    const to = String(v == null ? '' : v).trim()
    if (!from) continue
    if (!to) { dropped.push(from); continue }
    clean[from] = to
  }
  await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
  await client.query(`update owner_search_prefs set skill_rewords = $2::jsonb where owner_email=$1`, [owner, JSON.stringify(clean)])
  return { stored: clean, dropped }
}

/** What the parser will actually be handed: the owner's map when they have one, else the seed. */
export function effectiveRewords(stored: Record<string, string> | null): Record<string, string> {
  return stored === null ? { ...SKILL_REWORD_SEED } : stored
}

/**
 * Write the pool into `skill_bank_entry`. Idempotent, and it DELETES NOTHING.
 *
 * `origin` needs no widening and that is worth stating, because it looked like it did: the CHECK
 * allows `master_context | portfolio_slide`, while `SkillOrigin` carries `skills1`, `expertise`,
 * `relevantProficiencies`. Those are FIELD names, not stores - they belong in `source_ref`, which
 * exists for exactly that ("the field name or slide/table coordinate it came from"). The two
 * vocabularies were never in conflict; one is the store and one is the field within it.
 *
 * ONE ROW PER TERM even when the term came from several fields. `source_ref` records all of them,
 * comma-joined, because the pool already merged them into one entry and splitting them back out here
 * would put the same skill in the owner's picker twice.
 *
 * WHY IT DOES NOT DELETE. The table's own comment says a re-seed must be able to expire rows from one
 * source without touching another, and that is right eventually - but a term vanishing from the pool
 * has two possible causes, and only one of them means "the owner removed this skill": they edited
 * MasterContext, OR a reword key drifted and the parser now produces different text. The second is a
 * BUG, and deleting the owner's banked skills because of a bug is unrecoverable. So orphans are
 * COUNTED AND RETURNED, never removed, and the caller shows them. Deletion can be added the day
 * there is a way to tell those two causes apart.
 */
export async function seedSkillBank(client: any, owner: string, pool: { entries: any[] }, digest: string | null): Promise<{
  inserted: number; updated: number; total: number; orphans: string[]
}> {
  const entries = pool?.entries || []
  let inserted = 0, updated = 0
  const seenNorm = new Set<string>()
  for (const e of entries) {
    const label = String(e.term || '').trim()
    const norm = String(e.key || '').trim()
    if (!label || !norm) continue          // the table's own CHECKs; refused here with a reason rather than as a 500
    seenNorm.add(norm)
    const sourceRef = (e.origins || []).join(',') || 'unknown'
    const r = await client.query(
      `insert into skill_bank_entry (owner_email, label, label_norm, origin, source_ref, source_sha256, category)
       values ($1,$2,$3,'master_context',$4,$5,$6)
       on conflict (owner_email, label_norm) do update
         set label = excluded.label,
             source_ref = excluded.source_ref,
             source_sha256 = excluded.source_sha256,
             category = excluded.category,
             updated_at = now()
       returning (xmax = 0) as was_insert`,
      [owner, label, norm, sourceRef, digest, e.category || null])
    if (r.rows?.[0]?.was_insert) inserted += 1; else updated += 1
  }
  const existing = (await client.query(`select label, label_norm from skill_bank_entry where owner_email=$1`, [owner])).rows || []
  const orphans = existing.filter((r: any) => !seenNorm.has(r.label_norm)).map((r: any) => r.label)
  return { inserted, updated, total: entries.length, orphans }
}

/**
 * GET  /api/app/skill-rewords  — the seed, the owner's stored map, and a LIVE PREVIEW of the pool.
 * POST /api/app/skill-rewords { rewords } — replace the map wholesale.
 *
 * The preview is not decoration. A rewording screen whose effect you cannot see is a text box over a
 * black box: the owner would be editing strings with no way to tell whether a key still matches
 * anything. So the response carries the resulting pool size, the applied rewordings, and - the one
 * that matters - `staleRewords`, the keys that matched NOTHING this run. A stale key is invisible by
 * nature: the pool still builds and the counts still look plausible while the owner's actual text
 * sails through unreworded.
 */
export async function skillRewords(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureSkillRewords(client)

    if (req.method === 'POST') {
      const guard = requireWrite(req); if (guard) return guard
      const b: any = await req.json().catch(() => ({}))
      if (!b || typeof b.rewords !== 'object' || Array.isArray(b.rewords)) {
        return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'rewords must be an object of { "owner phrase": "replacement" }' } }
      }
      const out = await setSkillRewords(client, owner, b.rewords)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...out } }
    }

    const stored = await loadSkillRewords(client, owner)
    const rewords = effectiveRewords(stored)
    const src = await readSkillFields()
    if (!src.ok) {
      // The map is still returned - it is the owner's data and is readable without MasterContext.
      // Only the PREVIEW is unavailable, and it says why rather than showing an empty pool.
      return {
        status: 200, headers: HEADERS,
        jsonBody: { ok: true, stored, seed: SKILL_REWORD_SEED, effective: rewords, preview: null, previewError: src.error },
      }
    }
    const sources: Partial<Record<SkillOrigin, string | null>> = {}
    for (const [k, v] of Object.entries(src.fields)) sources[k as SkillOrigin] = v.text
    const pool = buildSkillPool(sources, { rewords })
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true,
        stored, seed: SKILL_REWORD_SEED, effective: rewords,
        preview: {
          entries: pool.entries.length,
          bySource: pool.bySource,
          rejected: pool.rejected,
          reworded: pool.reworded,
          // Surfaced FIRST-CLASS: a non-empty list means the map and MasterContext have diverged.
          staleRewords: pool.staleRewords,
          categories: [...new Set(pool.entries.map(e => e.category).filter(Boolean))],
          terms: pool.entries.map(e => ({ term: e.term, category: e.category, origins: e.origins })),
        },
      },
    }
  } catch (e: any) {
    context.error('skillRewords', e)
    return { status: 500, headers: HEADERS, jsonBody: { ok: false, error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('skillRewords', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/skill-rewords', handler: skillRewords })

/**
 * GET  /api/app/skill-bank — what is banked now.
 * POST /api/app/skill-bank — re-seed it from MasterContext through the owner's rewordings.
 *
 * The POST is a WRITE, so it takes `requireWrite`. It is also idempotent: running it twice changes
 * nothing the second time, which is what makes it safe to offer as a button rather than a migration.
 */
export async function skillBank(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureSkillRewords(client)

    if (req.method === 'POST') {
      const guard = requireWrite(req); if (guard) return guard
      const src = await readSkillFields()
      // An unreadable source is a REFUSAL, never an empty seed: writing zero rows here would read as
      // "the owner has no skills" and would orphan every row already banked.
      if (!src.ok) return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: src.error, seeded: null } }
      const sources: Partial<Record<SkillOrigin, string | null>> = {}
      for (const [k, v] of Object.entries(src.fields)) sources[k as SkillOrigin] = v.text
      const rewords = effectiveRewords(await loadSkillRewords(client, owner))
      const pool = buildSkillPool(sources, { rewords })
      const digest = createHash('sha256').update(Object.values(sources).map(v => v || '').join(' ')).digest('hex')
      const seeded = await seedSkillBank(client, owner, pool, digest)
      return {
        status: 200, headers: HEADERS,
        jsonBody: { ok: true, seeded, staleRewords: pool.staleRewords, rejected: pool.rejected },
      }
    }

    const rows = (await client.query(
      `select label, category, source_ref, updated_at from skill_bank_entry where owner_email=$1 order by category nulls first, label`,
      [owner])).rows || []
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, count: rows.length, entries: rows } }
  } catch (e: any) {
    context.error('skillBank', e)
    return { status: 500, headers: HEADERS, jsonBody: { ok: false, error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('skillBank', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/skill-bank', handler: skillBank })

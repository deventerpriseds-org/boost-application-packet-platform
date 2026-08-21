// P8.4 persistence + configuration for the posting-vs-profile comparison.
//
// All grading logic is in `dimensions.ts`, which imports neither @azure/functions nor pg and is
// exercised by `api/test/dimensions.test.mjs`. This file only moves those rows in and out of
// Postgres, and reads/writes the owner's per-role-family dimension set.
//
// WHY A TABLE AT ALL, when the rows are derivable. The acceptance sentence — "every moderate/weak
// grade carries the reason" — has to be auditable by ONE query against stored rows, not reassembled
// in a browser where nobody can check it. And the `note` obligation is enforced by a CHECK
// CONSTRAINT rather than an `if`, because an `if` in the writer is bypassed by the second writer
// that always eventually appears. Same reasoning, same shape, as `owner_fact`'s
// "a confirmed fact must have a value" check.
//
// SCHEMA REGISTRATION — D21, now DONE. `comparison_dimension` is declared in `schema.ts`'s
// SCHEMA_SQL, named in `EXPECTED_TABLES` so `pgMigrate` reports a migration gap instead of a 500,
// and listed in H11's hand-maintained array (the third place, and the one that gets forgotten).
//
// The ensure-path below STAYS, because a request may still meet a database the migration has not
// reached — but it is now a SECOND copy of DDL that also lives in `schema.ts`, and two copies of a
// CREATE TABLE is precisely the shape that goes wrong in silence. It cannot be caught by reading:
// every database that ran this ensure-path already HAS the table, so `create table if not exists`
// in SCHEMA_SQL is skipped there, and a CHECK present in one copy and not the other would be
// enforced on fresh installs and absent on production forever.
//
// So it is caught by EXECUTION instead. `H:dimension-ddl-parity` (api/test/dimensionsDb.test.mjs)
// builds the table both ways against a real cluster and diffs every column, constraint and index
// the database reports. Proved by reinstating the defect: changing one CHECK in the SCHEMA_SQL copy
// fails that test by name.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { resolveTitle } from './roleTaxonomy'
import {
  DimensionRow, DIMENSION_CATALOGUE, DIMENSION_BY_KEY, DIMENSION_SETS, DEFAULT_SET_KEY,
  dimensionsFor, buildComparison, summarize, ResolvedDimensionSet, DIMENSION_VERSION,
} from './dimensions'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

/**
 * The comparison store.
 *
 * `check (fit not in ('moderate','weak') or ...)` is the acceptance sentence, enforced by the
 * database. A row that grades a shortfall without saying why cannot be inserted by ANY writer —
 * this file, a backfill, a future lane, or a person at a psql prompt.
 *
 * `not_applicable` gets the mirror obligation: a row that measured nothing must say which state it
 * was in, because "not measured" with no reason is indistinguishable on screen from "measured and
 * fine" — which is the defect `qcRail.js` records having shipped once ("3 of 4 closed", 75%, from
 * three rows nothing measured).
 *
 * `unique (opp_id, dimension_key)` is what makes a rebuild an upsert rather than an accumulation.
 */
export async function ensureDimensionTable(client: any) {
  await client.query(`
    create table if not exists comparison_dimension (
      id              uuid primary key default uuid_generate_v4(),
      opp_id          uuid not null references opportunity(id) on delete cascade,
      dimension_key   text not null,
      label           text not null,
      fit             text not null check (fit in ('strong','moderate','weak','not_applicable')),
      basis           text not null check (basis in ('fact','evidence','none')),
      numeric_verdict text check (numeric_verdict in ('satisfied','not_satisfied','unavailable')),
      shortfall       text check (shortfall in ('nothing_found','falls_short')),
      posting_seq     int,
      posting_text    text,
      posting_quoted  boolean,
      profile_value   text,
      profile_source_label text,
      profile_source  text check (profile_source in ('evidence','fact')),
      note            text,
      reason          text,
      covered         int,
      total           int,
      matched_seqs    int[] not null default '{}',
      set_source      text not null check (set_source in ('owner','seed_family','seed_default')),
      role_family     text not null,
      dimension_version int not null,
      resolved_at     timestamptz not null default now(),
      unique (opp_id, dimension_key),
      -- The acceptance sentence, as a constraint: every moderate/weak grade carries the reason.
      check (fit not in ('moderate','weak') or (note is not null and btrim(note) <> '')),
      -- Its mirror: a row that measured nothing must say which state it was in.
      check (fit <> 'not_applicable' or (reason is not null and btrim(reason) <> '')),
      -- A graded row has a denominator; an ungraded one must not invent one.
      check (fit = 'not_applicable' or (covered is not null and total is not null and total > 0)),
      check (fit <> 'not_applicable' or (covered is null and total is null)),
      -- The posting cell must say whether it is the employer's words or the model's paraphrase.
      check (posting_text is null or posting_quoted is not null)
    )`)
  await client.query(`create index if not exists comparison_dimension_opp_idx on comparison_dimension(opp_id)`)
}

/** The owner's per-role-family dimension sets. EXTENDS `owner_search_prefs` — the established
 *  per-owner settings store that `ensureCheckPrefs` and `jdSweep` already extend. */
export async function ensureDimensionPrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(`alter table owner_search_prefs add column if not exists cmp_dimensions jsonb`)
}

/**
 * Store one role family's dimension set.
 *
 * EXPORTED, and the route handler calls THIS rather than inlining the statement, because a test
 * that runs its own copy of the SQL proves only that the copy works. Measured: with the merge in
 * the handler and the SQL retyped in the test, replacing the merge with a clobber changed nothing
 * the test could see — an inert guard, which is worse than none.
 *
 * The merge is per-family (`||` against the existing object), so saving one family's set never
 * clobbers another's — the same partial-update discipline `searchPrefs` uses for metros vs bands.
 * Unknown keys are dropped rather than stored: a set naming a dimension that does not exist would
 * grade fewer axes than the owner believes they chose.
 */
export async function setDimensionPrefs(client: any, owner: string, family: string, keys: string[]): Promise<{
  family: string; keys: string[]; dropped: string[]; stored: Record<string, string[]> | null
}> {
  await ensureDimensionPrefs(client)
  const fam = String(family || '').trim().toLowerCase()
  const wanted = (keys || []).map(String)
  const kept = wanted.filter(k => DIMENSION_BY_KEY.has(k))
  const dropped = wanted.filter(k => !DIMENSION_BY_KEY.has(k))
  await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
  await client.query(
    `update owner_search_prefs
        set cmp_dimensions = coalesce(cmp_dimensions, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)
      where owner_email=$1`,
    [owner, fam, JSON.stringify(kept)])
  return { family: fam, keys: kept, dropped, stored: await loadDimensionPrefs(client, owner) }
}

/** `{ [roleFamily]: string[] }`, or null when the owner has never chosen. Null is not `{}`. */
export async function loadDimensionPrefs(client: any, owner: string): Promise<Record<string, string[]> | null> {
  await ensureDimensionPrefs(client)
  const r = (await client.query(`select cmp_dimensions from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  const v = r?.cmp_dimensions
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, string[]> = {}
  for (const [k, list] of Object.entries(v)) {
    if (Array.isArray(list)) out[String(k)] = list.map(String).filter(x => DIMENSION_BY_KEY.has(x))
  }
  return Object.keys(out).length || Object.keys(v).length ? out : null
}

/**
 * The role family this opportunity's title resolves to.
 *
 * Reuses `roleTaxonomy.resolveTitle`, which is the product's existing role concept — a third one
 * would be the "extend, don't duplicate" failure this codebase has already paid for once. The
 * family is the discipline half of the slug (`vp-engineering` → `engineering`); a C-suite slug has
 * no discipline half and stands as its own family.
 */
export function roleFamilyOf(role: string | null | undefined): string {
  const slug = resolveTitle(String(role || '')).roleSlug
  if (!slug) return DEFAULT_SET_KEY
  const i = slug.indexOf('-')
  return i === -1 ? slug : slug.slice(i + 1)
}

/**
 * Resolve, grade and persist the comparison for one opportunity.
 *
 * REPLACE, never append (AC53): re-resolving must not double the rows. Delete and insert share one
 * transaction so a failure mid-write cannot leave a half-comparison — the same shape
 * `writeRequirements` and `writeEvidence` both use.
 */
export async function writeComparison(client: any, opp: { id: string; role?: string | null; owner_email?: string },
  requirements: any[], profileReadable: boolean, facts: any[], stale: boolean,
): Promise<{ opp_id: string; rows: number; set: ResolvedDimensionSet; graded: number }> {
  await ensureDimensionTable(client)
  const owner = opp.owner_email || ''
  const stored = owner ? await loadDimensionPrefs(client, owner) : null
  const family = roleFamilyOf(opp.role)
  const set = dimensionsFor(family, stored)

  const rows = buildComparison({
    requirements: requirements.map(shapeRequirement),
    profileReadable, facts, defs: set.defs, stale,
  })

  await client.query('begin')
  try {
    await client.query(`delete from comparison_dimension where opp_id=$1`, [opp.id])
    for (const r of rows) {
      await client.query(
        `insert into comparison_dimension
           (opp_id, dimension_key, label, fit, basis, numeric_verdict, shortfall,
            posting_seq, posting_text, posting_quoted,
            profile_value, profile_source_label, profile_source,
            note, reason, covered, total, matched_seqs, set_source, role_family, dimension_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [opp.id, r.key, r.label, r.fit, r.basis, r.numeric_verdict, r.shortfall,
         r.posting?.seq ?? null, r.posting?.text ?? null, r.posting ? r.posting.quoted : null,
         r.profile?.value ?? null, r.profile?.source_label ?? null, r.profile?.source ?? null,
         r.note, r.reason, r.covered, r.total, r.matched_seqs, set.source, set.family, r.dimension_version])
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }

  return { opp_id: opp.id, rows: rows.length, set, graded: rows.filter(r => r.fit !== 'not_applicable').length }
}

/** The join `loadRequirementsWithEvidence` returns, reshaped for the grader. ONE mapping, here. */
function shapeRequirement(r: any) {
  return {
    seq: r.seq, verbatim: r.verbatim, item_text: r.item_text, kind: r.kind, match_method: r.match_method,
    evidence: r.evidence_quote == null ? null : {
      quote: r.evidence_quote, source_label: r.evidence_source_label,
      source_kind: r.evidence_source_kind, ratio: r.evidence_ratio == null ? null : Number(r.evidence_ratio),
    },
  }
}

/** The stored rows, in the configured order, shaped the way the UI reads them. */
export async function loadComparison(client: any, oppId: string): Promise<DimensionRow[]> {
  await ensureDimensionTable(client)
  const rows = (await client.query(`select * from comparison_dimension where opp_id=$1`, [oppId])).rows
  const order = new Map(DIMENSION_CATALOGUE.map((d, i) => [d.key, i]))
  rows.sort((a: any, b: any) => (order.get(a.dimension_key) ?? 99) - (order.get(b.dimension_key) ?? 99))
  return rows.map((r: any) => ({
    key: r.dimension_key, label: r.label, fit: r.fit, basis: r.basis,
    numeric_verdict: r.numeric_verdict, shortfall: r.shortfall,
    posting: r.posting_text == null ? null : { seq: r.posting_seq, text: r.posting_text, quoted: !!r.posting_quoted },
    profile: r.profile_value == null ? null : { value: r.profile_value, source_label: r.profile_source_label, source: r.profile_source },
    note: r.note, reason: r.reason, covered: r.covered, total: r.total,
    matched_seqs: r.matched_seqs || [], dimension_version: r.dimension_version,
  }))
}

/**
 * Everything the JD step needs about the comparison, from ONE read.
 *
 * `set` IS COMPUTED LIVE AND `dimensions` IS NOT, and that gap is a lie waiting to be printed.
 * `set` comes from the owner's prefs as they are right now; the rows come from
 * `comparison_dimension`, written whenever the comparison was last resolved. Change the dimension
 * set and the card would say "Your dimension set for engineering." directly above rows built from
 * the seeded one — the caller cannot tell, because both halves arrive in the same object looking
 * equally current.
 *
 * The same gap opened a second way the moment `DIMENSION_VERSION` went to 2 (D23): every row
 * already in the database was graded by rules that could not compare people or usd, and recorded
 * `numeric_verdict: 'unavailable'` for Organization size and Budget owned. Re-resolving those
 * opportunities produces real grades. A row from before that is not wrong — it is a different
 * measurement — and presenting it as the current one is the "stale label next to a correct number"
 * failure this codebase has already paid for (D15).
 *
 * So the payload REPORTS the mismatch instead of hiding it. It does not silently re-resolve:
 * re-grading on a GET would make a read request write, and would do it without the requirements
 * and evidence this function does not load.
 */
export async function comparisonPayload(client: any, oppId: string, owner: string, role: string | null) {
  const rows = await loadComparison(client, oppId)
  const stored = await loadDimensionPrefs(client, owner)
  const set = dimensionsFor(roleFamilyOf(role), stored)
  return {
    dimensions: rows,
    summary: summarize(rows),
    set: { family: set.family, source: set.source, warning: set.warning || null, keys: set.keys },
    resolved: rows.length > 0,
    stale: comparisonStaleness(rows, set.keys),
  }
}

/**
 * Why the stored comparison no longer matches how it would be built today — or null.
 *
 * Null when there is nothing to compare against: an unresolved opportunity has no rows, and
 * reporting THAT as stale would put a warning on every opportunity nobody has resolved yet.
 * Absent evidence is not a finding.
 */
export function comparisonStaleness(rows: DimensionRow[], setKeys: string[]):
  { set_changed: boolean; rules_changed: boolean; missing: string[]; extra: string[]; row_version: number | null } | null {
  if (!Array.isArray(rows) || !rows.length) return null
  const have = new Set(rows.map(r => r.key))
  const want = new Set(setKeys || [])
  const missing = [...want].filter(k => !have.has(k))   // configured now, never graded
  const extra = [...have].filter(k => !want.has(k))     // graded then, not configured now
  const versions = rows.map(r => Number(r.dimension_version)).filter(Number.isFinite)
  const rowVersion = versions.length ? Math.min(...versions) : null
  const rulesChanged = rowVersion != null && rowVersion < DIMENSION_VERSION
  if (!missing.length && !extra.length && !rulesChanged) return null
  return {
    set_changed: missing.length > 0 || extra.length > 0,
    rules_changed: rulesChanged,
    missing, extra, row_version: rowVersion,
  }
}

// GET  /api/app/dimension-prefs — the owner's sets, the seed, and the catalogue behind both.
// POST /api/app/dimension-prefs { family, keys[] } — change one family's set.
//
// THIS ROUTE IS THE POINT. `owner_search_prefs.chk_*` is read by `loadThresholds` and written by
// NOTHING — no route, no UI — so per-owner check thresholds are "configurable" only by hand-written
// SQL. That is the no-hardcoded-config rule satisfied on paper and not in the product, and it is
// the shape this lane was told not to repeat. A stored default with no writer is a constant.
export async function dimensionPrefs(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureDimensionPrefs(client)

    if (req.method === 'POST') {
      const guard = requireWrite(req); if (guard) return guard
      const b: any = await req.json().catch(() => ({}))
      const family = String(b?.family || '').trim().toLowerCase()
      if (!family) return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'family is required' } }
      if (!Array.isArray(b?.keys)) return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'keys must be an array' } }
      const out = await setDimensionPrefs(client, owner, family, b.keys)
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, ...out } }
    }

    const stored = await loadDimensionPrefs(client, owner)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true,
        stored,
        seed: DIMENSION_SETS,
        catalogue: DIMENSION_CATALOGUE.map(d => ({ key: d.key, label: d.label, help: d.help })),
        defaultKey: DEFAULT_SET_KEY,
      },
    }
  } catch (e: any) {
    context.error('dimensionPrefs', e)
    return { status: 500, headers: HEADERS, jsonBody: { ok: false, error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('dimensionPrefs', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/dimension-prefs', handler: dimensionPrefs })

// P1.1 persistence + read API for the requirement rows.
//
// All parsing/locating logic is in `requirements.ts`, which imports neither @azure/functions nor pg
// and is exercised by `api/test/requirements.test.mjs`. This file only moves those rows in and out
// of Postgres.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { buildRequirements } from './requirements'
import { resolveAll, ProfileRecord, NO_EVIDENCE_NOTE, RESOLVER_VERSION } from './evidence'
import { sourceText } from './appFacts'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

// Columns the requirement spine needs on `opportunity`. Also declared in schema.ts SCHEMA_SQL (D1
// puts NEW TABLES there); this keeps environments that have not re-migrated from 500ing.
/**
 * The P8.3 evidence store. Declared in schema.ts SCHEMA_SQL and registered in EXPECTED_TABLES;
 * repeated here so an environment that has not re-migrated cannot 500 on the first evidence write.
 *
 * SEPARATE from `ensureRequirementCols` on purpose. That function drops and re-adds a CHECK
 * constraint, which takes an ACCESS EXCLUSIVE lock on `requirement` — fine in the backfill and the
 * requirements GET, and not fine in `evaluateArtifact`, which four artifacts of one packet can enter
 * at the same moment. `create table if not exists` takes no lock on an existing table, so the hot
 * path calls only this.
 */
export async function ensureEvidenceTable(client: any) {
  await client.query(`
    create table if not exists requirement_evidence (
      id             uuid primary key default uuid_generate_v4(),
      requirement_id uuid not null references requirement(id) on delete cascade,
      quote          text not null,
      source_kind    text not null check (source_kind in ('work_history','accomplishment','profile_field','certification')),
      source_label   text not null,
      source_key     text not null,
      char_start     int not null,
      char_end       int not null,
      extra          text,
      ratio          numeric,
      method         text not null check (method in ('exact','anchored')),
      record_sha256  text not null,
      resolver_version int not null,
      resolved_at    timestamptz not null default now(),
      check (char_start >= 0 and char_end > char_start),
      check (length(quote) = char_end - char_start),
      unique (requirement_id, source_key, char_start, char_end)
    )`)
  await client.query(`create index if not exists req_evidence_req_idx on requirement_evidence(requirement_id)`)
}

export async function ensureRequirementCols(client: any) {
  await client.query(`
    alter table opportunity
      add column if not exists jd_text text,
      add column if not exists jd_text_sha256 text,
      add column if not exists jd_text_truncated boolean`)
  // kind_source gained three values when mapKind's precedence was corrected. `create table if not
  // exists` cannot widen a CHECK on a table that already exists, so an environment migrated before
  // that change would reject every insert. Drop and re-add explicitly.
  await client.query(`alter table requirement drop constraint if exists requirement_kind_source_check`)
  await client.query(`alter table requirement add constraint requirement_kind_source_check
    check (kind_source in ('posting_required_marker','posting_optional_marker','posting_section_heading','category','category_default','fallback'))`)
  await ensureEvidenceTable(client)
}

/**
 * Resolve and persist the evidence excerpt behind every requirement of one opportunity (P8.3 / R2).
 *
 * `records` are the candidate's stored profile records — from `appFacts.sourceText()`, the ONE
 * reader of the profile. They are passed IN rather than read here so a caller that already holds
 * them (the checks run) does not open the same documents twice, and so nothing in this file becomes
 * a second answer to "what does the profile say".
 *
 * NOTHING here writes `requirement.coverage`. That column already means "the quote could not be
 * located in the POSTING" (`requirements.ts` writes 'escalated' at extraction time) and merging a
 * second population into it would make both unreadable. Whether a requirement is evidenced is
 * answered by whether a row exists here, and by nothing else.
 *
 * Deterministic and model-free, so it is safe to re-run; each run REPLACES the previous row's
 * evidence rather than accumulating.
 */
export async function writeEvidence(client: any, oppId: string, records: ProfileRecord[]): Promise<{
  opp_id: string; total: number; evidenced: number; unevidenced: number
  refused: number; profile_records: number
}> {
  const rows = (await client.query(
    `select id, seq, verbatim, item_text from requirement where opp_id=$1 order by seq`, [oppId])).rows
  const resolved = resolveAll(rows, records)
  const bySeq = new Map(resolved.map(r => [r.seq, r.evidence]))
  const byKey = new Map(records.map(r => [r.key, r]))
  let refused = 0

  await client.query('begin')
  try {
    // REPLACE, never append: re-resolving a posting must not double its evidence. Scoped to this
    // opportunity's requirements so a re-run cannot touch another posting's rows.
    await client.query(
      `delete from requirement_evidence e using requirement r
        where e.requirement_id = r.id and r.opp_id = $1`, [oppId])
    for (const r of rows) {
      const e = bySeq.get(r.seq) || null
      if (!e) continue
      // The accusation-grade assertion, at the last moment before the claim becomes stored fact:
      // the quote must BE the named record's own bytes at those offsets. A candidate that is not is
      // REFUSED and counted — never stored with a caveat, never rendered, never counted covered.
      // A quote that resolves against some other record, or only against the concatenated profile,
      // is the same defect H16 records for posting citations, in a new place.
      const rec = byKey.get(e.source_key)
      if (!rec || rec.text.slice(e.char_start, e.char_end) !== e.quote) { refused++; continue }
      await client.query(
        `insert into requirement_evidence
           (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
            extra, ratio, method, record_sha256, resolver_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (requirement_id, source_key, char_start, char_end) do nothing`,
        [r.id, e.quote, e.source_kind, e.source_label, e.source_key, e.char_start, e.char_end,
         e.extra, e.ratio, e.method, e.record_sha256, e.resolver_version])
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }

  const evidenced = resolved.filter(r => r.evidence).length - refused
  return {
    opp_id: oppId, total: rows.length, evidenced, unevidenced: rows.length - evidenced,
    refused, profile_records: records.length,
  }
}

/**
 * Extract and persist the requirement rows for one opportunity.
 *
 * Replace, never append: re-parsing a posting must not double its requirement count. The delete and
 * the inserts share one transaction so a failure mid-write cannot leave a posting with half a spine.
 * Returns the measured location stats — the honest number for how much of this posting is evidenced.
 */
export async function writeRequirements(client: any, opp: any): Promise<{
  opp_id: string; rows: number; located: number; located_rate: number
  jd_source: string | null; truncated: boolean
}> {
  const built = buildRequirements(opp)
  await client.query('begin')
  try {
    await client.query(
      `update opportunity set jd_text=$1, jd_text_sha256=$2, jd_text_truncated=$3 where id=$4`,
      [built.jd_text || null, built.jd_text ? built.jd_text_sha256 : null, built.posting_truncated, opp.id],
    )
    await client.query(`delete from requirement where opp_id=$1`, [opp.id])
    for (let i = 0; i < built.rows.length; i++) {
      const r = built.rows[i]
      await client.query(
        `insert into requirement
           (opp_id, seq, item_text, verbatim, char_start, char_end, match_method, kind, kind_source,
            model_keyword, competency, coverage, weight, source_category, jd_source, jd_text_sha256,
            extractor_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [opp.id, i, r.item_text, r.verbatim, r.char_start, r.char_end, r.match_method, r.kind,
         r.kind_source, r.model_keyword, r.competency, r.coverage, r.weight, r.source_category,
         built.jd_source, built.jd_text_sha256, r.extractor_version],
      )
    }
    await client.query('commit')
  } catch (e) { await client.query('rollback'); throw e }
  return {
    opp_id: opp.id, rows: built.rows.length, located: built.located,
    located_rate: Math.round(built.located_rate * 1000) / 1000,
    jd_source: built.jd_source, truncated: built.posting_truncated,
  }
}

/**
 * Drop the spine for an opportunity whose posting has gone away.
 * `applyAnchorTruth` nulls jd_table/jd_requirements when no single-job source exists; leaving the
 * rows behind would keep serving quotes attributed to a posting the row no longer has.
 */
export async function clearRequirements(client: any, oppId: string) {
  await client.query(`delete from requirement where opp_id=$1`, [oppId])
  await client.query(`update opportunity set jd_text=null, jd_text_sha256=null, jd_text_truncated=null where id=$1`, [oppId])
}

/**
 * The requirement spine WITH its evidence, in one query.
 *
 * The ONE place this join is written. The gate and the JD step must be looking at the same rows —
 * two queries for the same question are two answers waiting to disagree, and this one decides a
 * coverage count that appears on four surfaces. `order by ratio desc` picks the strongest excerpt
 * when a requirement has more than one, deterministically (source_key then char_start break ties).
 */
export async function loadRequirementsWithEvidence(client: any, oppId: string): Promise<any[]> {
  return (await client.query(
    `select r.*,
            e.quote        as evidence_quote,
            e.source_kind  as evidence_source_kind,
            e.source_label as evidence_source_label,
            e.source_key   as evidence_source_key,
            e.char_start   as evidence_char_start,
            e.char_end     as evidence_char_end,
            e.extra        as evidence_extra,
            e.ratio        as evidence_ratio,
            e.method       as evidence_method,
            e.record_sha256 as evidence_record_sha256,
            e.resolver_version as evidence_resolver_version,
            e.resolved_at  as evidence_resolved_at
       from requirement r
       left join lateral (
         select * from requirement_evidence x where x.requirement_id = r.id
          order by x.ratio desc nulls last, x.source_key, x.char_start limit 1
       ) e on true
      where r.opp_id=$1 order by r.seq`, [oppId])).rows
}

// GET /api/app/opportunity/{id}/requirements
export async function requirementsGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureRequirementCols(client)
    const opp = (await client.query(
      `select id, jd_text, jd_text_sha256, jd_text_truncated from opportunity where id=$1 and owner_email=$2`,
      [req.params.id, owner])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const rows = await loadRequirementsWithEvidence(client, opp.id)
    // A stored sha that no longer matches the posting means the offsets were measured against a
    // different body. Say so rather than serving quotes that may no longer be in the posting.
    const stale = rows.some((r: any) => r.jd_text_sha256 !== opp.jd_text_sha256)
    // P8.3 — the JD step expands an "evidenced" row to its quote and source, and says
    // NO_EVIDENCE_NOTE for the rest. Both are shaped HERE so every surface prints the same
    // sentence, and `evidenced` is derived from the quote rather than trusted as a flag: a row is
    // evidenced when it HAS an excerpt, and there is no other way to be.
    const shaped = rows.map((r: any) => ({
      ...r,
      evidenced: r.evidence_quote != null,
      evidence: r.evidence_quote == null ? null : {
        quote: r.evidence_quote,
        sourceKind: r.evidence_source_kind,
        sourceLabel: r.evidence_source_label,
        sourceKey: r.evidence_source_key,
        charStart: r.evidence_char_start,
        charEnd: r.evidence_char_end,
        extra: r.evidence_extra,
        ratio: r.evidence_ratio === null ? null : Number(r.evidence_ratio),
        method: r.evidence_method,
        recordSha256: r.evidence_record_sha256,
        resolverVersion: r.evidence_resolver_version,
        resolvedAt: r.evidence_resolved_at,
      },
      evidenceNote: r.evidence_quote == null ? NO_EVIDENCE_NOTE : null,
    }))
    const evidencedRows = rows.filter((r: any) => r.evidence_quote != null).length
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        oppId: opp.id, jdTextLen: (opp.jd_text || '').length, jdTextTruncated: !!opp.jd_text_truncated,
        stale, located: rows.filter((r: any) => r.char_start !== null).length, total: rows.length,
        // The coverage numerator (C6). `evidenced` is a COUNT OF EVIDENCE ROWS, never of term
        // placement; `evidenceResolved` distinguishes "your profile does not support these" from
        // "nobody has looked yet", which are different states and must not print the same number.
        evidenced: evidencedRows,
        unevidenced: rows.length - evidencedRows,
        requirements: shaped,
      },
    }
  } catch (e: any) {
    context.error('requirementsGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/qc/requirements/backfill   { limit?: number, oppId?: string }
// Structures already-parsed postings. Deterministic and model-free, so it is safe to re-run.
export async function requirementsBackfill(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  const body: any = await req.json().catch(() => ({}))
  const limit = Math.min(Number(body?.limit) || 50, 500)
  let client
  try {
    client = await getPgClient()
    await ensureRequirementCols(client)
    const opps = (await client.query(
      body?.oppId
        ? `select id, jd_real, raw_jd, why_surfaced, jd_table from opportunity where id=$1 and owner_email=$2`
        : `select id, jd_real, raw_jd, why_surfaced, jd_table from opportunity
             where owner_email=$2 and jd_table is not null order by updated_at desc limit $1`,
      body?.oppId ? [body.oppId, owner] : [limit, owner])).rows

    const results = []
    for (const opp of opps) results.push(await writeRequirements(client, opp))

    // Re-parsing REPLACES the requirement rows, which takes their evidence with them. Re-resolving
    // in the same call is what stops a backfill from silently emptying the coverage numerator: the
    // rows would come back unevidenced and every count would read zero, which is indistinguishable
    // from "the profile supports nothing" unless it is fixed here. The profile is read ONCE for the
    // whole batch.
    const profile = await sourceText().catch(() => ({ text: '', sources: ['profile UNREADABLE'], records: [] as ProfileRecord[] }))
    const ev = []
    if (profile.records.length) {
      for (const opp of opps) ev.push(await writeEvidence(client, opp.id, profile.records))
    }

    const rows = results.reduce((a, r) => a + r.rows, 0)
    const located = results.reduce((a, r) => a + r.located, 0)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, opportunities: results.length, rows, located,
        located_rate: rows ? Math.round((located / rows) * 1000) / 1000 : 0,
        no_posting: results.filter(r => r.jd_source === null).length,
        truncated: results.filter(r => r.truncated).length,
        profileSources: profile.sources,
        profileRecords: profile.records.length,
        evidenced: ev.reduce((a, r) => a + r.evidenced, 0),
        evidenceResolved: ev.length > 0,
      },
    }
  } catch (e: any) {
    context.error('requirementsBackfill', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunity/{id}/evidence — resolve and persist the evidence excerpts (P8.3).
// Deterministic, model-free and idempotent: re-running replaces every row's evidence in place.
export async function evidenceResolve(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    await ensureRequirementCols(client)
    const opp = (await client.query(
      `select id from opportunity where id=$1 and owner_email=$2`, [req.params.id, owner])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }

    const profile = await sourceText()
    if (!profile.records.length) {
      // An unreadable profile is NOT proof the profile supports nothing. Writing zero evidence rows
      // here would publish that as a measured coverage of 0%, so nothing is written at all.
      return {
        status: 200, headers: HEADERS,
        jsonBody: { ok: false, error: 'no profile record could be read, so no coverage claim can be evidenced',
                    sources: profile.sources, wrote: 0 },
      }
    }
    const out = await writeEvidence(client, opp.id, profile.records)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, ...out, sources: profile.sources,
        unevidenced: out.total - out.evidenced,
        note: out.evidenced === out.total
          ? 'every requirement is evidenced by a verbatim excerpt of your profile'
          : `${out.total - out.evidenced} requirement(s): ${NO_EVIDENCE_NOTE}`,
      },
    }
  } catch (e: any) {
    context.error('evidenceResolve', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('evidenceResolve', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/evidence', handler: evidenceResolve })
app.http('requirementsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/requirements', handler: requirementsGet })
app.http('requirementsBackfill', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/requirements/backfill', handler: requirementsBackfill })

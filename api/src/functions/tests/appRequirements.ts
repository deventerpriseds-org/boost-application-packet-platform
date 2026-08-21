// P1.1 persistence + read API for the requirement rows.
//
// All parsing/locating logic is in `requirements.ts`, which imports neither @azure/functions nor pg
// and is exercised by `api/test/requirements.test.mjs`. This file only moves those rows in and out
// of Postgres.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { buildRequirements } from './requirements'
import {
  resolveAll, ProfileRecord, ResolveOptions, NO_EVIDENCE_NOTE, RESOLVER_VERSION,
  verifyEvidence, tallyHealth, EvidenceHealth, EvidenceVerdict, EvidenceState,
  refusalReason, NEVER_EVIDENCE,
} from './evidence'
import { sourceText, loadFacts } from './appFacts'
import { resolveOptionsFor } from './checkPrefs'
import { claimTokens, segments, tokensOf, sameWord } from './requirementSupport'
import { writeComparison, comparisonPayload } from './appDimensions'

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
  // THE SAME TRAP `requirement_kind_source_check` FELL INTO, and the reason it is fixed here rather
  // than only in `schema.ts`. `create table if not exists` is a no-op on an environment that already
  // has the table, so the inline CHECK above is frozen at whatever it said the day that environment
  // was first migrated — widening it in the CREATE reaches new databases and nothing else. This
  // function is on the hot path and runs on every request, so it must be able to state the current
  // shape by itself and not depend on `pgMigrate` having run first.
  //
  // Without this, the first `method='proposed'` insert fails a CHECK on production, and because the
  // insert loop below shares one transaction with the DELETE that precedes it, the whole
  // opportunity's evidence write aborts and the route 500s — one model row costing every
  // deterministic row of that run.
  await client.query(`alter table requirement_evidence drop constraint if exists requirement_evidence_method_check`)
  await client.query(`alter table requirement_evidence add constraint requirement_evidence_method_check
    check (method in ('exact','anchored','proposed'))`)
  // Nullable and NOT defaulted: null means no model was involved, which is what every row already
  // in the table means. A default would backfill model provenance onto work a rule did alone.
  await client.query(`alter table requirement_evidence add column if not exists proposal_version int`)
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
export async function writeEvidence(
  client: any, oppId: string, records: ProfileRecord[], opts: ResolveOptions = {},
  // THE SEAM THAT MAKES THE REFUSAL GUARD TESTABLE, and the reason it is a parameter rather than a
  // mock. The pre-store assertion below can only fire when the resolver hands back a quote that is
  // not the record's bytes, and every shipped resolver produces its quote BY slicing the record.
  // Without an injection point the guard is untestable, and an untested guard is `not_applicable`
  // rather than `pass` — the exact conflation this file's own comments forbid one level up.
  // Production passes nothing and gets `resolveAll`.
  resolver: typeof resolveAll = resolveAll,
): Promise<{
  opp_id: string; total: number; evidenced: number; unevidenced: number
  refused: number; profile_records: number
}> {
  const rows = (await client.query(
    `select id, seq, verbatim, item_text from requirement where opp_id=$1 order by seq`, [oppId])).rows
  const resolved = resolver(rows, records, opts)
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
      // REFUSED — never stored with a caveat, never rendered, never counted covered.
      //
      // HONEST ABOUT WHAT THIS IS, CORRECTED 2026-08-21. This comment used to say the check
      // "structurally cannot" reject anything, because `locate` constructed its verbatim by slicing
      // the haystack (measured by the independent verifier: 4,000 randomized rounds, 0 mismatches).
      // That sentence described `locate`, which is no longer the matcher, and a false comment about
      // a guard is worse than no comment. The replacement (`requirementSupport`) also produces its
      // quote by slicing, so on the resolve path the comparison is STILL a tautology — but this
      // function re-slices the records IT was handed, which are not necessarily the records the row
      // was resolved against, so the assertion is live for a caller that passes a mismatched pair.
      // Exercised by `H:refusal-guard-fires`, which drives it through the `resolver` seam above and
      // asserts `refused` increments and nothing is inserted. `refused` is now a real measurement.
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

/**
 * Re-validate the evidence on joined requirement rows against the profile as it stands NOW (D19).
 *
 * `loadRequirementsWithEvidence` returns what the DATABASE says; this returns what is still TRUE.
 * They are deliberately two steps: the join is the one place the query lives, and this is the one
 * place a stored excerpt becomes — or stops being — something a surface may print as a quote.
 *
 * REDACTION, NOT ANNOTATION. Every `evidence_*` column of a row that is not `verified` is nulled,
 * so a consumer that only knows the old shape (`r.evidence_quote == null` means unevidenced — which
 * is what `appDimensions.shapeRequirement` and `appChecks` both read) cannot render a broken excerpt
 * as proof by not having been updated. The state that was lost by nulling is republished on
 * `evidence_state` / `evidence_note`, which is what keeps "stale" distinguishable from "none".
 *
 * The redaction is BY CONSTRUCTION, not by a hand-written list of columns: it nulls every key on the
 * row whose name begins with `evidence_`, so a column added to the join later is redacted the day it
 * is added rather than the day someone remembers to add it here. A hand-list is exactly the shape
 * that goes stale in silence — and a leaked column here is a fragment of a withdrawn excerpt, which
 * is the thing this function exists to prevent.
 *
 * `records` is `null` when the profile could not be read; see `verifyEvidence`. It must be the
 * `profileRecords()` output, because that is what the stored offsets and digest were measured on.
 */
export const EVIDENCE_COL_PREFIX = 'evidence_'

export function verifyRequirementRows(rows: any[], records: ProfileRecord[] | null): {
  rows: any[]; health: EvidenceHealth; verdicts: EvidenceVerdict[]
} {
  const verdicts: EvidenceVerdict[] = []
  const out = (rows || []).map((r: any) => {
    const v = verifyEvidence(r.evidence_quote == null ? null : {
      quote: r.evidence_quote,
      source_key: r.evidence_source_key,
      char_start: r.evidence_char_start,
      char_end: r.evidence_char_end,
      record_sha256: r.evidence_record_sha256,
    }, records)
    verdicts.push(v)

    const shaped: any = { ...r }
    if (!v.proof) {
      for (const k of Object.keys(shaped)) {
        if (k.startsWith(EVIDENCE_COL_PREFIX)) shaped[k] = null
      }
    }
    // The verdict is written AFTER the redaction, so these four are never nulled by it.
    shaped.evidence_state = v.state as EvidenceState
    shaped.evidence_note = v.note
    shaped.evidence_record_changed = v.recordChanged
    shaped.evidence_quote_moved = v.quoteMoved
    return shaped
  })
  return { rows: out, health: tallyHealth(verdicts, records != null), verdicts }
}

/**
 * Rebuild one opportunity's comparison from the rows that are in the database RIGHT NOW.
 *
 * The ONE place the comparison's inputs are assembled, so the requirement spine, the evidence and
 * the facts that feed a grade are always the same rows the rest of this file serves. `stale` is the
 * same derivation `requirementsGet` publishes: offsets measured against a different posting body.
 *
 * Takes the profile RECORDS rather than a `profileReadable` boolean, because it needs both facts and
 * they must not be able to disagree: `profileReadable` IS `records != null`, and the grade is built
 * only from evidence those same records still support. Both callers write the evidence from these
 * records moments earlier, so the re-validation is a no-op there by construction — it is here so
 * that a future caller that has NOT just re-resolved cannot grade a comparison on a stale excerpt.
 */
export async function rebuildComparison(client: any, oppId: string, owner: string, records: ProfileRecord[] | null) {
  const opp = (await client.query(`select id, role, owner_email, jd_text_sha256 from opportunity where id=$1`, [oppId])).rows[0]
  if (!opp) return null
  const joined = await loadRequirementsWithEvidence(client, oppId)
  const { rows, health } = verifyRequirementRows(joined, records)
  const stale = rows.some((r: any) => r.jd_text_sha256 !== opp.jd_text_sha256)
  const facts = await loadFacts(client, owner)
  const out = await writeComparison(client, { id: opp.id, role: opp.role, owner_email: owner },
    rows, records != null, facts, stale)
  return {
    rows: out.rows, graded: out.graded, family: out.set.family, setSource: out.set.source,
    warning: out.set.warning || null, evidenceHealth: health,
  }
}

/**
 * The requirement spine as the JD step reads it — the ONE shaping of stored rows into served rows.
 *
 * Pure, and exported, so the D19 decision is exercisable without a Function App: every state a stored
 * excerpt can be in is reachable by handing this the same joined rows with a different profile.
 *
 * WHAT `evidenced` MEANS HERE, and it is narrower than it was: a row is evidenced when its excerpt is
 * STILL the named profile record's own bytes at the offsets stored — not merely when a row exists.
 * Before D19 the two were the same statement; after an owner edits their profile they are not, and
 * the old reading served the excerpt at the OLD offsets as a verbatim quote of the NEW record.
 *
 * `unevidenced` keeps its arithmetic (`total - evidenced`), so nothing that consumes it starts
 * disagreeing with `total`. It is now a SUPERSET of "no evidence found": `evidenceHealth` is where a
 * caller reads WHY each row is not evidenced, and `evidenceNote` is what a reader is shown.
 */
export function shapeRequirementsForApi(joined: any[], records: ProfileRecord[] | null): {
  requirements: any[]; evidenced: number; unevidenced: number; evidenceHealth: EvidenceHealth
} {
  // WHAT WE LOOKED FOR, for every requirement the profile does not support.
  //
  // "no evidence found in your profile" is true and useless: it does not say what was sought, so the
  // owner cannot act on it. The resolver already computes the answer — which rule refused it, which
  // words were missing, and the closest excerpt it found — and until now threw all of it away.
  // Surfacing it turns a dead end into a decision: add the missing thing to the profile, or accept
  // that this posting asks for something the profile does not claim.
  //
  // Read-only and derived: nothing here is stored, and it cannot make an unevidenced requirement
  // look evidenced — `evidenced` is still `evidence_quote != null` and nothing below touches it.
  const lookedFor = (text: string) => {
    if (!records || !records.length) return null
    const reason = refusalReason(text, records)
    if (!reason) return null
    const want = claimTokens(text)
    let best: { excerpt: string; sourceKey: string; missing: string[] } | null = null
    for (const rec of records) {
      if (NEVER_EVIDENCE.has(rec.key)) continue
      for (const span of segments(rec.text, 1)) {
        const excerpt = rec.text.slice(span.start, span.end)
        const have = tokensOf(excerpt).map(x => x.t)
        const hit = want.filter(t => have.includes(t) || have.some(h => sameWord(t, h)))
        if (!best || hit.length > want.length - best.missing.length) {
          best = { excerpt: excerpt.slice(0, 160), sourceKey: rec.key, missing: want.filter(t => !hit.includes(t)) }
        }
      }
    }
    return { reason, soughtWords: want, missingWords: best ? best.missing : want,
             closestExcerpt: best ? best.excerpt : null, closestSourceKey: best ? best.sourceKey : null }
  }

  const { rows, health } = verifyRequirementRows(joined, records)
  const requirements = rows.map((r: any) => ({
    ...r,
    // Derived from the excerpt that SURVIVED re-validation, never trusted as a stored flag.
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
      // A provable excerpt whose record has since changed: the quote still holds, the RANKING does
      // not. Surfaced rather than suppressed — it is a reason to re-resolve, not to withhold.
      recordChanged: r.evidence_record_changed === true,
    },
    // The state, and the sentence for it, from the ONE map in evidence.ts. `evidenceNote` is null
    // only when the excerpt is provable; "no evidence found in your profile" is now ONE of five
    // possible sentences rather than the only one, because it is one of five different claims.
    evidenceState: r.evidence_state,
    evidenceNote: r.evidence_note,
    // Only for rows with no provable excerpt — an evidenced row already shows its quote.
    evidenceSearch: r.evidence_quote != null ? null : lookedFor(r.verbatim || r.item_text || ''),
  }))
  const evidenced = requirements.filter(r => r.evidenced).length
  return { requirements, evidenced, unevidenced: requirements.length - evidenced, evidenceHealth: health }
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
      `select id, role, jd_text, jd_text_sha256, jd_text_truncated from opportunity where id=$1 and owner_email=$2`,
      [req.params.id, owner])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const rows = await loadRequirementsWithEvidence(client, opp.id)
    // A stored sha that no longer matches the posting means the offsets were measured against a
    // different body. Say so rather than serving quotes that may no longer be in the posting.
    // This is the POSTING half and it keeps its own name: the profile half is `evidenceHealth`, and
    // merging them would give one flag two meanings and the reader no way to tell which fired.
    const stale = rows.some((r: any) => r.jd_text_sha256 !== opp.jd_text_sha256)

    // D19 — the profile as it stands NOW, so a stored excerpt is re-validated rather than trusted.
    // THE COST, DELIBERATELY ACCEPTED: one `sourceText()` (a Docs read and a Table read) per GET.
    // The alternative is serving `record_sha256` without ever recomputing it, which is what made the
    // digest a decoration; there is no cheaper ground truth than the record itself, because the owner
    // edits their profile outside this API and nothing here is notified when they do. A failed read
    // is NOT treated as an empty profile — `records` goes null and every stored row reports
    // `unverified`, which is a different claim from "your profile does not support this".
    const profile = await sourceText().catch(() => ({ text: '', sources: ['profile UNREADABLE'], records: [] as ProfileRecord[] }))
    const records = profile.records.length ? profile.records : null
    const { requirements, evidenced, unevidenced, evidenceHealth } = shapeRequirementsForApi(rows, records)

    // P8.4 — the comparison, from the SAME rows this response already carries. Served by the ONE
    // endpoint the JD step reads, so a dimension row and a requirement row cannot come from two
    // queries that disagree (R4).
    const comparison = await comparisonPayload(client, opp.id, owner, opp.role)
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        oppId: opp.id, jdTextLen: (opp.jd_text || '').length, jdTextTruncated: !!opp.jd_text_truncated,
        comparison,
        stale, located: rows.filter((r: any) => r.char_start !== null).length, total: rows.length,
        // The coverage numerator (C6). `evidenced` is a COUNT OF EVIDENCE ROWS THAT ARE STILL TRUE,
        // never of term placement and never of rows that merely exist; `evidenceHealth` distinguishes
        // "your profile does not support these" from "your profile changed since we looked" from
        // "we could not read your profile at all" — three different claims that must not print the
        // same number or the same sentence.
        evidenced,
        unevidenced,
        evidenceHealth,
        profileSources: profile.sources,
        requirements,
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
        ? `select id, role, jd_real, raw_jd, why_surfaced, jd_table from opportunity where id=$1 and owner_email=$2`
        : `select id, role, jd_real, raw_jd, why_surfaced, jd_table from opportunity
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
    const evOpts = await resolveOptionsFor(client, owner)
    const ev = []
    if (profile.records.length) {
      // The owner's thresholds, on THIS path too. They used to reach `writeEvidence` from
      // `appChecks.evaluateArtifact` alone, so the backfill and the resolve route silently used the
      // seeded literals instead — the owner's settings applied on one of three call sites. Found by
      // grepping every `writeEvidence(` rather than by reading the one file the guard watched.
      for (const opp of opps) ev.push(await writeEvidence(client, opp.id, profile.records, evOpts))
    }
    // P8.4 / AC54 — re-extraction REPLACED the requirement rows, which the comparison is graded
    // over. Rebuilding here is what stops a backfill leaving grades keyed to lines that no longer
    // exist; the same reason the evidence re-resolve above is in this call rather than a later one.
    let comparisons = 0
    for (const opp of opps) {
      const c = await rebuildComparison(client, opp.id, owner, profile.records.length ? profile.records : null)
      if (c) comparisons += c.rows
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
        comparisonRows: comparisons,
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
      `select id, role, owner_email from opportunity where id=$1 and owner_email=$2`, [req.params.id, owner])).rows[0]
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
    const evOpts = await resolveOptionsFor(client, owner)
    const out = await writeEvidence(client, opp.id, profile.records, evOpts)
    // P8.4 / AC54 — the comparison is keyed to these requirement rows and their evidence, so it is
    // rebuilt in the SAME call. Leaving it behind would serve grades over evidence that has just
    // been replaced — the trap `requirementsBackfill` already documents for evidence itself.
    const cmp = await rebuildComparison(client, opp.id, owner, profile.records.length ? profile.records : null)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, ...out, sources: profile.sources, comparison: cmp,
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

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
import { escalateOne, PROPOSAL_VERSION, type EscalationOutcome } from './evidenceProposal'
import { openAiJson, type FetchJson } from './openaiJson'
// IMPORTED, never redeclared — M3: the citation floors have one home (`reviewer.ts`), and the
// escalation tier must clear the SAME floor the deterministic path does, not a copy of it.
import { MIN_QUOTE_CHARS } from './reviewer'

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
      method         text not null check (method in ('exact','anchored','proposed')),
      record_sha256  text not null,
      resolver_version int not null,
      proposal_version int,
      resolved_at    timestamptz not null default now(),
      check (char_start >= 0 and char_end > char_start),
      check (length(quote) = char_end - char_start),
      unique (requirement_id, source_key, char_start, char_end)
    )`)
  await client.query(`create index if not exists req_evidence_req_idx on requirement_evidence(requirement_id)`)
  // THE TWO ALTERs THIS TABLE NEEDS ARE SPLIT BY COST, and the split is the whole point.
  //
  // I first put BOTH here and it was wrong: `alter table ... drop constraint` takes an ACCESS
  // EXCLUSIVE lock, and this function's own comment (above) explains it was deliberately kept to
  // `create table if not exists` — which takes no lock on an existing table — precisely because four
  // artifacts of one packet enter `evaluateArtifact` at the same moment. A DDL lock on the hot path
  // would have surfaced as intermittent 500s under concurrency, not as a migration bug, which is the
  // worst way for it to appear. So the CHECK widening lives ONLY in `SCHEMA_SQL`, where the deploy
  // applies it once and fails loudly if it did not.
  //
  // The COLUMN is the opposite case and has to be here, which the test suite proved rather than my
  // reading it: `dimensionsDb.test.mjs` builds a database from `origin/main`'s SCHEMA_SQL — the
  // database a migration actually meets — and `loadRequirementsWithEvidence` failed on it with
  // `column e.proposal_version does not exist`. That is not a test artefact. `api-deploy.yml`
  // deploys the code at its "Deploy to Azure Functions" step and only calls `pg-migrate` afterwards,
  // so between those two steps the running code selects a column the database has not got, and every
  // requirements read 500s. Adding a nullable column with no default is a catalogue-only change in
  // Postgres 11+ — no table rewrite — and `if not exists` makes the steady-state call a no-op, so
  // this is cheap in the way the constraint swap is not.
  //
  // WRITES can wait for the migration; READS cannot. Escalation is off by default, and its inserts
  // are individually savepointed, so a database that has the column but not yet the widened CHECK
  // refuses the one proposed row instead of losing the opportunity's evidence.
  await client.query(`alter table requirement_evidence add column if not exists proposal_version int`)
  // The owner's confirmations. Declared in SCHEMA_SQL and registered in EXPECTED_TABLES; repeated
  // here for the same reason the evidence table is — between `api-deploy.yml`'s deploy step and its
  // `pg-migrate` step the running code would otherwise select from a table that does not exist yet,
  // and every requirements read would 500. `create table if not exists` takes no lock on an existing
  // table, so this is safe on the hot path four artifacts enter concurrently.
  await client.query(`
    create table if not exists evidence_confirmation (
      id               uuid primary key default uuid_generate_v4(),
      opp_id           uuid not null references opportunity(id) on delete cascade,
      requirement_text text not null,
      source_key       text not null,
      char_start       int not null,
      char_end         int not null,
      quote            text not null,
      record_sha256    text not null,
      confirmed_at     timestamptz not null default now(),
      confirmed_by     text not null,
      withdrawn_at     timestamptz,
      withdrawn_reason text,
      check (char_start >= 0 and char_end > char_start),
      check (length(quote) = char_end - char_start),
      check ((withdrawn_at is null) = (withdrawn_reason is null)),
      unique (opp_id, requirement_text, source_key, char_start, char_end, record_sha256)
    )`)
  await client.query(`create index if not exists evidence_confirmation_opp_idx on evidence_confirmation(opp_id)`)
}

export async function ensureRequirementCols(client: any) {
  await client.query(`
    alter table opportunity
      add column if not exists jd_posting_snapshot text,
      add column if not exists jd_posting_snapshot_sha256 text,
      add column if not exists jd_posting_snapshot_truncated boolean`)
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
 * DETERMINISTIC AND MODEL-FREE BY DEFAULT, and that sentence used to be unconditional. It is not
 * any more, and saying so is the point: when the owner turns escalation ON, rows the deterministic
 * pass could not settle are offered to a model, and two runs over identical inputs CAN differ
 * (`temperature: 0` is not a determinism guarantee). Those rows are stamped `method='proposed'` and
 * carry a `proposal_version`, so which rows are reproducible is a property of the data rather than
 * of anyone's memory — and `checks.ts` refuses to let a proposed row turn the gate green on its own.
 * With escalation OFF, which is the default and the unconfigured state, this function is exactly as
 * deterministic as it was.
 *
 * Each run REPLACES the previous row's evidence rather than accumulating.
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
  // The escalation transport, injected for the same reason the resolver is. Absent means the tier
  // cannot run AT ALL, whatever the owner's setting says — so a test, a backfill, or any caller that
  // has not deliberately opted in makes zero model calls by construction rather than by flag.
  fetchJson?: FetchJson,
): Promise<{
  opp_id: string; total: number; evidenced: number; unevidenced: number
  refused: number; profile_records: number
  // The escalation tier's own counts, ALWAYS present and zero when it did not run. Without them a
  // coverage rise is unattributable after the fact — a reviewer cannot tell a better profile from a
  // chattier model, and coverage is the number the gate and the score both read.
  escalated: number; proposed: number; escalation_refusals: Record<string, number>
}> {
  const rows = (await client.query(
    `select id, seq, kind, verbatim, item_text from requirement where opp_id=$1 order by seq`, [oppId])).rows
  const resolved = resolver(rows, records, opts)
  const bySeq = new Map(resolved.map(r => [r.seq, r.evidence]))
  const byKey = new Map(records.map(r => [r.key, r]))
  let refused = 0

  // THE ONE CONDITION THAT DECIDES WHETHER THIS CALL CAN PRODUCE `proposed` ROWS. It is read twice —
  // here, to scope the delete, and below, to guard the escalation pass — and those two readings MUST
  // be the same expression, which is why it is a const rather than the condition written out twice.
  // A delete that outruns what the same call can rebuild is exactly the defect below.
  const canEscalate = opts.escalate === true && !!fetchJson

  await client.query('begin')
  try {
    // REPLACE, never append: re-resolving a posting must not double its evidence. Scoped to this
    // opportunity's requirements so a re-run cannot touch another posting's rows.
    //
    // BUT NEVER DELETE WHAT THIS CALL CANNOT REBUILD — measured 2026-08-23, and it made the entire
    // evidence spine empty in production (1 row across 613 opportunities that have requirements).
    //
    // `runPacketBuild` resolves evidence WITH a transport (`resolveEvidenceForOpp`), which escalated
    // 12 requirements on opportunity 2cb56fb3 and stored 8 `proposed` rows. It then ran
    // `evaluateArtifact` once per artifact, and THAT calls this function with four arguments — no
    // transport — so `canEscalate` is false and the escalation pass is skipped by design (see the
    // comment at the call site: four concurrent artifacts must not each start their own model run).
    // The unconditional delete then removed all 8 proposed rows and the deterministic pass could not
    // recreate them, because only the escalation pass ever can. Measured before/after on the same
    // opportunity minutes apart: 8 rows after the evidence route, 0 rows after a full build — and
    // `must_have_coverage` consequently read `0/12` on all four artifacts.
    //
    // So the delete is scoped to the rows this call is actually able to re-derive. A transport-less
    // call replaces the deterministic rows it owns and leaves model proposals alone; a call that CAN
    // escalate still replaces everything, because it will re-propose.
    await client.query(
      canEscalate
        ? `delete from requirement_evidence e using requirement r
            where e.requirement_id = r.id and r.opp_id = $1`
        : `delete from requirement_evidence e using requirement r
            where e.requirement_id = r.id and r.opp_id = $1 and e.method <> 'proposed'`,
      [oppId])
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
      // DETERMINISTIC EVIDENCE EVICTS A STALE PROPOSAL FOR THE SAME REQUIREMENT, and this runs only
      // on the transport-less path because that is the only path where a proposal survived the
      // delete above. Two reasons, and the second is the one that bites:
      //  - `loadRequirementsWithEvidence` picks ONE row per requirement, `order by ratio desc nulls
      //    last`, and a proposed row has a NULL ratio — so a rule row already outranks it. Leaving
      //    the proposal would be merely untidy.
      //  - but `insert ... on conflict (requirement_id, source_key, char_start, char_end) do nothing`
      //    is keyed on the SPAN, not the method. A proposal is verified byte-exact against the record
      //    it names, so it can legitimately hold the very span the rule just resolved — and then the
      //    deterministic insert is silently dropped and the row stays `proposed`. That row does not
      //    count toward `must_have_coverage` (`ruleEvidenceOf` excludes it), so a requirement the
      //    profile genuinely evidences would read as uncovered. Deleting first makes the rule win.
      if (!canEscalate) {
        await client.query(
          `delete from requirement_evidence where requirement_id = $1 and method = 'proposed'`, [r.id])
      }
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

  // --- the escalation pass ----------------------------------------------------------------------
  //
  // AFTER the deterministic transaction has COMMITTED, and that ordering is the whole safety
  // argument rather than a detail. The transaction above opens by DELETING every evidence row for
  // this opportunity, so anything that throws inside it takes the entire rewrite with it. Running
  // model calls in there would mean one rejected proposal — a constraint an environment has not
  // migrated yet, a network blip — costing every deterministic row of the run and 500ing the route.
  // Out here the deterministic result is already durable and the worst an escalation failure can do
  // is leave rows unevidenced, which is exactly what they were a moment earlier.
  let escalated = 0
  let proposed = 0
  // SEPARATE FROM `refused`, and the separation is a bug fix rather than tidiness. `evidenced` below
  // is computed as `deterministic rows - refused`, so an escalation-path refusal was subtracting
  // from the DETERMINISTIC count — a population it has nothing to do with. Measured by an
  // independent verifier: two rows stored, the route reported `evidenced: 1`.
  let escRefused = 0
  const escalation_refusals: Record<string, number> = {}
  const note = (k: string) => { escalation_refusals[k] = (escalation_refusals[k] || 0) + 1 }

  // THREE conditions, all required. The owner's toggle is opt-in and its unconfigured state is OFF
  // (`resolveOptionsFrom`), and the transport must have been passed in — so no caller reaches the
  // model by forgetting a flag.
  // `canEscalate` alone: TypeScript's aliased-condition narrowing carries `!!fetchJson` from the
  // const's definition, so `fetchJson` is already non-optional inside this block — writing
  // `&& fetchJson` here is not just redundant, tsc rejects it (TS2774). That the compiler can prove
  // it is the point: the delete scope above and this guard cannot drift apart silently.
  if (canEscalate) {
    const cap = typeof opts.escalateMax === 'number' ? opts.escalateMax : 12
    const minQuoteChars = MIN_QUOTE_CHARS
    // Only rows the deterministic pass could not settle, and only up to the cap. `slice` before the
    // loop rather than a break inside it, so what was skipped is knowable rather than implicit.
    const open = rows.filter((r: any) => !bySeq.get(r.seq))
    /**
     * SPEND THE CAP ON WHAT DECIDES THE GATE, and this is a defect fix rather than a preference.
     *
     * MEASURED on opportunity 2cb56fb3 (2026-08-23): all 8 proposals landed on RESPONSIBILITIES at
     * seq 0-11, while the must-haves live at seq 22-34. `open` was taken in `seq` order and the cap
     * is 12, so it was exhausted before reaching a single must-have — `escalation_refusals.over_cap`
     * was 1, and `must_have_coverage` therefore read 0/12 no matter what. Building the confirmation
     * path in front of that would have produced a feature the owner could click on responsibilities
     * while the number that gates his packet never moved.
     *
     * `must_have_coverage` is the check that blocks `ready`; `responsibilities_addressed` only warns.
     * So must-haves go first, then nice-to-haves, then responsibilities — and WITHIN each kind the
     * original `seq` order is preserved, so the choice is a stable, explainable priority rather than
     * a reshuffle. A stable sort is required for that: `Array.prototype.sort` has been stable since
     * ES2019, so equal ranks keep their `seq` order.
     */
    const ESCALATION_RANK: Record<string, number> = { must_have: 0, nice_to_have: 1, responsibility: 2 }
    const rank = (r: any) => ESCALATION_RANK[String(r?.kind)] ?? 3
    const prioritised = [...open].sort((a, b) => rank(a) - rank(b))
    const attempt = prioritised.slice(0, Math.max(0, cap))
    if (open.length > attempt.length) note('over_cap')

    for (const r of attempt) {
      const requirement = r.verbatim || r.item_text || ''
      let outcome: EscalationOutcome
      try {
        outcome = await escalateOne(requirement, records, {
          fetchJson, neverEvidence: NEVER_EVIDENCE, minQuoteChars,
          minTokens: typeof opts.minTokens === 'number' ? opts.minTokens : 2,
          resolverVersion: RESOLVER_VERSION,
        })
      } catch (e: any) {
        // Never fatal. An escalation that throws leaves the row exactly as the deterministic pass
        // left it, and says so in the counts.
        note('transport_failed'); continue
      }
      if (outcome.kind === 'skipped') { note('not_worth_escalating'); continue }
      escalated++
      if (outcome.kind === 'transport_failed') { note('transport_failed'); continue }
      if (outcome.kind === 'unparseable') { note('unparseable'); continue }
      if (outcome.kind === 'refused') { note(outcome.reason); continue }
      // The row still stands — the QUOTE was verified independently of the explanation — but a
      // withdrawn explanation is counted, because a model overclaiming is a fact about the run the
      // owner should be able to see without reading every note.
      if (outcome.reasoningWithdrawn) note('reasoning_withdrawn')

      const e = outcome.row
      // THE SAME accusation-grade assertion the deterministic path makes, applied again here rather
      // than trusted from `verifyProposal`. Two independent checks of the same invariant is not
      // redundancy when one of them is the last thing standing between a model's string and a
      // stored claim.
      const rec = byKey.get(e.source_key)
      if (!rec || rec.text.slice(e.char_start, e.char_end) !== e.quote) { escRefused++; note('offset_mismatch'); continue }

      // ONE ROW, ONE SAVEPOINT. A proposed insert that the database rejects — most plausibly a CHECK
      // on an environment whose migration has not run — must cost that row and nothing else. Without
      // the savepoint the failed statement poisons the surrounding transaction in Postgres and every
      // subsequent insert fails too, turning one bad row into a whole failed pass.
      try {
        await client.query('begin')
        await client.query(
          `insert into requirement_evidence
             (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
              extra, ratio, method, record_sha256, resolver_version, proposal_version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (requirement_id, source_key, char_start, char_end) do nothing`,
          [r.id, e.quote, e.source_kind, e.source_label, e.source_key, e.char_start, e.char_end,
           e.extra, e.ratio, e.method, e.record_sha256, e.resolver_version, PROPOSAL_VERSION])
        await client.query('commit')
        proposed++
      } catch (err) {
        try { await client.query('rollback') } catch {}
        escRefused++; note('insert_rejected')
      }
    }
  }

  // `refused` only — the deterministic guard's count against the deterministic population. Escalation
  // refusals are counted in `escRefused` and reported through `escalation_refusals`; they never
  // reduce a number they are not part of.
  const evidenced = resolved.filter(r => r.evidence).length - refused
  return {
    opp_id: oppId, total: rows.length,
    // Proposed rows ARE evidence — they are shown beside the requirement — so they count here. They
    // are NOT coverage: `checks.ts` refuses to let one turn `must_have_coverage` green on its own,
    // and `proposed` below is what lets any caller separate the two populations.
    evidenced: evidenced + proposed, unevidenced: rows.length - evidenced - proposed,
    refused: refused + escRefused, profile_records: records.length,
    escalated, proposed, escalation_refusals,
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
      `update opportunity set jd_posting_snapshot=$1, jd_posting_snapshot_sha256=$2, jd_posting_snapshot_truncated=$3 where id=$4`,
      [built.jd_posting_snapshot || null, built.jd_posting_snapshot ? built.jd_posting_snapshot_sha256 : null, built.posting_truncated, opp.id],
    )
    await client.query(`delete from requirement where opp_id=$1`, [opp.id])
    for (let i = 0; i < built.rows.length; i++) {
      const r = built.rows[i]
      await client.query(
        `insert into requirement
           (opp_id, seq, item_text, verbatim, char_start, char_end, match_method, kind, kind_source,
            model_keyword, competency, coverage, weight, source_category, jd_source, jd_posting_snapshot_sha256,
            extractor_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [opp.id, i, r.item_text, r.verbatim, r.char_start, r.char_end, r.match_method, r.kind,
         r.kind_source, r.model_keyword, r.competency, r.coverage, r.weight, r.source_category,
         built.jd_source, built.jd_posting_snapshot_sha256, r.extractor_version],
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
  await client.query(`update opportunity set jd_posting_snapshot=null, jd_posting_snapshot_sha256=null, jd_posting_snapshot_truncated=null where id=$1`, [oppId])
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
  // THE DEPLOY WINDOW, and this is not hypothetical — `dimensionsDb.test.mjs` caught it by building
  // its database from `origin/main`'s SCHEMA_SQL, which is the database a migration actually meets.
  // `api-deploy.yml` deploys the code at its "Deploy to Azure Functions" step and only runs
  // `pg-migrate` AFTERWARDS, so between those two steps this query would join a table the database
  // does not have yet and EVERY requirements read would 500 — the identical trap the
  // `proposal_version` column comment above describes. `create table if not exists` takes no lock on
  // an existing table, so the steady-state cost here is one cheap no-op statement.
  await ensureEvidenceTable(client)
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
            -- PREFIXED evidence_ DELIBERATELY, and not merely for tidiness: verifyRequirementRows
            -- redacts a stale row by nulling every key whose name starts with that prefix. A
            -- provenance column named anything else would survive the redaction and keep asserting
            -- that a model judged this, beside a quote that has already been withdrawn.
            e.proposal_version as evidence_proposal_version,
            e.resolved_at  as evidence_resolved_at,
            -- THE OWNER'S CONFIRMATION, matched on CLAIM IDENTITY rather than on the evidence row's
            -- id. Every column of this join condition is part of what the owner actually asserted:
            -- this requirement text, this excerpt, from this record, at these offsets, against that
            -- record's digest. If the profile is edited, record_sha256 changes and the join stops
            -- matching, so the confirmation lapses automatically rather than surviving to assert a
            -- claim no human made. That is AC-11's "fail closed", enforced by the join itself rather
            -- than by remembering to invalidate.
            --
            -- ALSO PREFIXED evidence_ DELIBERATELY: verifyRequirementRows redacts a stale row by
            -- nulling every key starting with that prefix. A column named confirmed_at would
            -- survive redaction and keep asserting a human vouched for a quote already withdrawn.
            c.confirmed_at as evidence_confirmed_at,
            c.confirmed_by as evidence_confirmed_by
       from requirement r
       left join lateral (
         select * from requirement_evidence x where x.requirement_id = r.id
          order by x.ratio desc nulls last, x.source_key, x.char_start limit 1
       ) e on true
       left join evidence_confirmation c
              on c.opp_id          = r.opp_id
             and c.requirement_text = coalesce(r.verbatim, r.item_text)
             and c.source_key      = e.source_key
             and c.char_start      = e.char_start
             and c.char_end        = e.char_end
             and c.record_sha256   = e.record_sha256
             and c.withdrawn_at is null
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
  const opp = (await client.query(`select id, role, owner_email, jd_posting_snapshot_sha256 from opportunity where id=$1`, [oppId])).rows[0]
  if (!opp) return null
  const joined = await loadRequirementsWithEvidence(client, oppId)
  const { rows, health } = verifyRequirementRows(joined, records)
  const stale = rows.some((r: any) => r.jd_posting_snapshot_sha256 !== opp.jd_posting_snapshot_sha256)
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
      // WHETHER A HUMAN HAS STOOD BEHIND THIS EXCERPT — and it belongs INSIDE the verdict, not
      // beside it. `H:evidence-read-from-the-verdict-not-the-columns` forbids a screen reading the
      // raw `evidence_confirmed_*` columns, and it caught this being done: those keys are nulled for
      // every non-verified row, so read directly they cannot tell "the confirmation lapsed" from
      // "nobody ever confirmed it". Placed here, a confirmation is dropped with the quote it vouched
      // for — because this whole object is null when `evidence_quote` is — which is the fail-closed
      // behaviour the confirmation join was built for.
      confirmedAt: r.evidence_confirmed_at ?? null,
      confirmedBy: r.evidence_confirmed_by ?? null,
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
      `select id, role, jd_posting_snapshot, jd_posting_snapshot_sha256, jd_posting_snapshot_truncated from opportunity where id=$1 and owner_email=$2`,
      [req.params.id, owner])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const rows = await loadRequirementsWithEvidence(client, opp.id)
    // A stored sha that no longer matches the posting means the offsets were measured against a
    // different body. Say so rather than serving quotes that may no longer be in the posting.
    // This is the POSTING half and it keeps its own name: the profile half is `evidenceHealth`, and
    // merging them would give one flag two meanings and the reader no way to tell which fired.
    const stale = rows.some((r: any) => r.jd_posting_snapshot_sha256 !== opp.jd_posting_snapshot_sha256)

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
        oppId: opp.id, jdTextLen: (opp.jd_posting_snapshot || '').length, jdTextTruncated: !!opp.jd_posting_snapshot_truncated,
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
        ? `select id, role, jd_html, jd_posting_raw, why_surfaced, jd_table from opportunity where id=$1 and owner_email=$2`
        : `select id, role, jd_html, jd_posting_raw, why_surfaced, jd_table from opportunity
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
      // NO TRANSPORT, deliberately, and this is a decision rather than an omission. This route
      // loops up to 50 opportunities in one dispatch; at the 38 unevidenced requirements the CTO
      // posting carries, inheriting escalation would make thousands of model calls from a single
      // unattended sweep. The backfill exists to re-resolve the deterministic spine cheaply, and
      // that is all it does. `escalated: 0` in its result says so rather than leaving it to be
      // inferred.
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
    // The transport is supplied HERE, on the owner-facing route, and deliberately not in the
    // backfill below. `writeEvidence` cannot escalate without it, so the expensive path is opt-in at
    // the CALLER as well as in the owner's setting — two independent conditions, and the sweep does
    // not inherit the interactive route's permission to spend.
    const out = await writeEvidence(client, opp.id, profile.records, evOpts, undefined,
      evOpts.escalate === true ? openAiJson({ feature: 'evidence:escalate' }) : undefined)
    // P8.4 / AC54 — the comparison is keyed to these requirement rows and their evidence, so it is
    // rebuilt in the SAME call. Leaving it behind would serve grades over evidence that has just
    // been replaced — the trap `requirementsBackfill` already documents for evidence itself.
    const cmp = await rebuildComparison(client, opp.id, owner, profile.records.length ? profile.records : null)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, ...out, sources: profile.sources, comparison: cmp,
        unevidenced: out.total - out.evidenced,
        // The sentence stays literally TRUE with proposed rows in the numerator — `verifyProposal`
        // accepts nothing that is not byte-exact in the record it names — and it would still be
        // misleading, because "evidenced by a verbatim excerpt" reads as "a rule found this". Which
        // rows a model chose is the owner's business, so the count says so.
        note: (out.evidenced === out.total
          ? 'every requirement is evidenced by a verbatim excerpt of your profile'
          : `${out.total - out.evidenced} requirement(s): ${NO_EVIDENCE_NOTE}`)
          + (out.proposed
              ? ` — ${out.proposed} of them proposed by a model and awaiting your confirmation; they are shown but do not count toward the coverage gate`
              : ''),
      },
    }
  } catch (e: any) {
    context.error('evidenceResolve', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

/**
 * POST /api/app/requirement/{seq}/evidence-confirm  { oppId, decision: 'confirm'|'reject', note? }
 *
 * The owner accepts (or refuses) a model-proposed excerpt. This is the step the product promised in
 * three places and never had, and it is the ONLY thing that can move a `proposed` row into
 * `must_have_coverage`'s numerator.
 *
 * ACCUSATION-GRADE, so it follows `artifactGateOverride` exactly rather than approximately:
 * `requireWrite` proves someone is signed in, and then `verified` is re-checked — because
 * `requireWrite` alone permits an unverified write to the demo workspace, and a confirmation whose
 * actor is "whoever sent the request" is an audit row worth nothing.
 *
 * The target row is loaded with the ownership filter IN THE SAME STATEMENT (join `opportunity`,
 * `owner_email = $owner`), never fetched and then compared in JS, and a miss returns 404 rather than
 * 403 — a non-owner must not learn the row exists.
 *
 * `confirmed_by` is ALWAYS the session's owner. A `confirmed_by` in the request body is ignored.
 */
export async function evidenceConfirm(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner, verified } = resolveOwner(req)
  if (!verified) {
    return { status: 403, headers: HEADERS, jsonBody: { error: 'a confirmation needs a verified session — the audit row records who did it' } }
  }
  const body: any = await req.json().catch(() => ({}))
  const oppId = String(body?.oppId || '').trim()
  const decision = String(body?.decision || 'confirm').trim()
  if (!oppId) return { status: 400, headers: HEADERS, jsonBody: { error: 'oppId is required' } }
  if (decision !== 'confirm' && decision !== 'reject') {
    return { status: 400, headers: HEADERS, jsonBody: { error: "decision must be 'confirm' or 'reject'" } }
  }
  const seq = Number(req.params.seq)
  if (!Number.isFinite(seq)) return { status: 400, headers: HEADERS, jsonBody: { error: 'seq must be a number' } }

  let client
  try {
    client = await getPgClient()
    await ensureEvidenceTable(client)
    // ONE statement: the requirement, its evidence, and the ownership check together. A row that
    // does not belong to this owner is indistinguishable from one that does not exist.
    const row = (await client.query(
      `select r.opp_id, coalesce(r.verbatim, r.item_text) as requirement_text,
              e.source_key, e.char_start, e.char_end, e.quote, e.record_sha256, e.method
         from requirement r
         join opportunity o on o.id = r.opp_id
         left join lateral (
           select * from requirement_evidence x where x.requirement_id = r.id
            order by x.ratio desc nulls last, x.source_key, x.char_start limit 1
         ) e on true
        where r.opp_id = $1 and r.seq = $2 and o.owner_email = $3`, [oppId, seq, owner])).rows[0]
    if (!row) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    if (!row.source_key) {
      return { status: 409, headers: HEADERS, jsonBody: { error: 'this requirement has no evidence to decide on' } }
    }
    // Only a MODEL proposal is a decision for the owner. A deterministic row is already a rule's
    // finding and needs no human; "confirming" one would imply the human added something.
    if (row.method !== 'proposed') {
      return { status: 409, headers: HEADERS, jsonBody: { error: `this excerpt was resolved by a rule (${row.method}), so there is nothing to confirm`, method: row.method } }
    }

    if (decision === 'reject') {
      // A rejection WITHDRAWS any existing confirmation for this exact claim and records why. It is
      // not a delete: "the owner confirmed this and later took it back" must stay reconstructable.
      await client.query(
        `update evidence_confirmation set withdrawn_at = now(), withdrawn_reason = $1
          where opp_id=$2 and requirement_text=$3 and source_key=$4 and char_start=$5
            and char_end=$6 and record_sha256=$7 and withdrawn_at is null`,
        ['rejected by the owner', row.opp_id, row.requirement_text, row.source_key,
         row.char_start, row.char_end, row.record_sha256])
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, decision: 'reject', seq } }
    }

    // IDEMPOTENT. Confirming twice is one confirmation with its ORIGINAL timestamp and actor — the
    // unique key is the claim identity, and `do nothing` keeps the first decision rather than
    // re-stamping it to whoever clicked last.
    await client.query(
      `insert into evidence_confirmation
         (opp_id, requirement_text, source_key, char_start, char_end, quote, record_sha256, confirmed_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (opp_id, requirement_text, source_key, char_start, char_end, record_sha256)
       do update set withdrawn_at = null, withdrawn_reason = null`,
      [row.opp_id, row.requirement_text, row.source_key, row.char_start, row.char_end,
       row.quote, row.record_sha256, owner])
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, decision: 'confirm', seq, confirmedBy: owner } }
  } catch (e: any) {
    context.error('evidenceConfirm', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('evidenceConfirm', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/requirement/{seq}/evidence-confirm', handler: evidenceConfirm })
app.http('evidenceResolve', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/evidence', handler: evidenceResolve })
app.http('requirementsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/requirements', handler: requirementsGet })
app.http('requirementsBackfill', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/requirements/backfill', handler: requirementsBackfill })

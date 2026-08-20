// P3 — the remediation loop: database, model calls, wall clock and HTTP.
//
// All the logic that DECIDES anything lives in `remediation.ts`, which imports neither
// @azure/functions nor pg and is exercised by `api/test/remediation.test.mjs`. This file is the
// plumbing: it loads the inputs, runs the passes, writes the ledger, and refuses to store a run
// that removed the evidence it was judged against.
//
// THE SHAPE OF ONE RUN, and why it is this shape:
//
//   ensurePackage           the baseline package (loop 0) - generated once, or served from cache
//   evaluate                the deterministic engine names the open must-haves (the DENOMINATOR)
//   repeat:
//     decidePass            converged? out of budget? no progress? nothing reachable?
//     scopeForRequirements  which merge fields this pass may rewrite, and which are withheld
//     regenerateFields      ONE model call for those fields only
//     applyScopedFields     anything outside the scope is rejected, not written
//     persist pkg_json      so the engine judges what the loop actually produced
//     writeInsertions(n)    the before/after evidence - DATABASE ONLY, no Drive call
//     evaluate              the engine's verdict after the pass
//     creditClosures        a close is credited only when text THIS PASS WROTE covers it
//     write remediation_loop row
//   renderArtifact          ONE Drive copy, after the loop (X5 / P3-25)
//   escalations             what is still open, stated as an ask
//
// The rendering step is deliberately outside the loop. Generation and rendering used to be the same
// function, so a four-pass loop over four templated artifacts would have issued 16 Drive copies per
// packet - and since there is no Drive DELETE anywhere in this codebase (D-9), 15 of them would be
// orphaned on the quota-bearing OAuth account.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { evaluateArtifact } from './appChecks'
import { ensurePackage, renderArtifact, generationJd, OPP_FIELDS } from './appPackets'
import { regenerateFields, loadProfile, SCOPED_REGEN_MODEL } from './pipeline'
import { writeInsertions } from './appInsertions'
import { costOf, tokensOf, logUsage } from './usageMeter'
import {
  DEFAULT_LOOP_PREFS, LoopPrefs, Spend, ZERO_SPEND, addCall, coverageView, creditClosures,
  decidePass, scopeForRequirements, applyScopedFields, escalationFor, reportedOutcome,
  assertEvidenceIntact, evidenceRemoved, REMEDIATION_VERSION, HaltReason, RequirementRow, nextPassNumber,
  profileEvidenceFor,
} from './remediation'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }

// ---------------------------------------------------------------------------------------------
// Per-owner loop settings
// ---------------------------------------------------------------------------------------------

/**
 * EXTENDS `owner_search_prefs`. That is the established per-owner settings store - `appChecks`,
 * `appSearchPrefs` and `jdSweep` all extended it rather than standing up a table of their own, and
 * "extend, don't duplicate" applies to a settings store more than to anything else.
 *
 * Every number the loop obeys is here, because a pass ceiling, a cost ceiling and a timeout are
 * exactly the sort of value the owner must be able to change without a deploy. The code seeds the
 * FIRST value; the owner changes it at PATCH /api/app/remediation-prefs.
 */
export async function ensureLoopPrefs(client: any) {
  await client.query(`create table if not exists owner_search_prefs (owner_email text primary key)`)
  await client.query(`
    alter table owner_search_prefs
      add column if not exists rem_max_passes      int     not null default ${DEFAULT_LOOP_PREFS.maxPasses},
      add column if not exists rem_cost_ceiling_usd numeric(10,4) not null default ${DEFAULT_LOOP_PREFS.costCeilingUsd},
      add column if not exists rem_wall_clock_ms   int     not null default ${DEFAULT_LOOP_PREFS.wallClockMs},
      add column if not exists rem_token_ceiling   int     not null default ${DEFAULT_LOOP_PREFS.tokenCeiling},
      add column if not exists rem_enabled         boolean not null default true`)
}

export async function loadLoopPrefs(client: any, owner: string): Promise<LoopPrefs & { enabled: boolean }> {
  await ensureLoopPrefs(client)
  const r = (await client.query(
    `select rem_max_passes, rem_cost_ceiling_usd, rem_wall_clock_ms, rem_token_ceiling, rem_enabled
       from owner_search_prefs where owner_email=$1`, [owner])).rows[0]
  if (!r) return { ...DEFAULT_LOOP_PREFS, enabled: true }
  return {
    maxPasses: Number(r.rem_max_passes),
    costCeilingUsd: Number(r.rem_cost_ceiling_usd),
    wallClockMs: Number(r.rem_wall_clock_ms),
    tokenCeiling: Number(r.rem_token_ceiling),
    enabled: r.rem_enabled !== false,
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const idsForSeqs = (reqs: any[], seqs: number[]): string[] =>
  seqs.map(s => reqs.find(r => Number(r.seq) === s)).filter(Boolean).map((r: any) => r.id)

/** The evidence the loop is judged against. Snapshotted before and after so its removal is visible. */
async function evidenceSnapshot(client: any, oppId: string, mustHaveState: string) {
  const n = Number((await client.query(`select count(*)::int as n from requirement where opp_id=$1`, [oppId])).rows[0]?.n || 0)
  return { reqCount: n, mustHaveState: mustHaveState as any }
}

/**
 * The override standing on this artifact right now, read BEFORE `evaluateArtifact` clears it.
 * Decision 19: the loop is what turns a deliberate single clear into four silent ones, so the loop
 * is what records it. `evaluateArtifact` is left exactly as it was.
 */
async function standingOverride(client: any, artifactId: string) {
  const g = (await client.query(
    `select override_by, override_at, override_reason from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
  return g?.override_by ? { by: g.override_by, at: g.override_at, reason: g.override_reason } : null
}

// ---------------------------------------------------------------------------------------------
// POST /api/app/artifact/{artifactId}/remediate
// ---------------------------------------------------------------------------------------------

export async function artifactRemediate(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  const artifactId = req.params.artifactId
  const startedAt = Date.now()
  let client
  try {
    const key = process.env.OPENAI_API_KEY
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()

    const art = (await client.query(
      `select a.id, a.type, a.packet_id, p.opp_id from artifact a join packet p on p.id = a.packet_id
         join opportunity o on o.id = p.opp_id where a.id=$1 and o.owner_email=$2`, [artifactId, owner])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'artifact not found' } }
    const opp = (await client.query(`${OPP_FIELDS} where id=$1`, [art.opp_id])).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'opportunity not found' } }

    // P3-02 / X1. With no posting, `generationJd` falls back to our own metadata about the job. A
    // loop against that would remediate the package toward OUR notes and report coverage of
    // requirements the employer never stated - the exact fabrication X1 exists to prevent, and it
    // would look like success. Refuse, and say which field is missing.
    const grounded = generationJd(opp).grounded
    const prefs = await loadLoopPrefs(client, owner)
    if (!prefs.enabled) return { status: 200, headers: HEADERS, jsonBody: { ok: false, detail: 'the remediation loop is switched off for this owner (Settings)' } }
    if (!grounded) {
      return { status: 200, headers: HEADERS, jsonBody: {
        ok: false, artifactId, converged: false, haltReason: 'ungrounded', passes: 0, escalations: 0,
        summary: 'Not remediated: this opportunity has no job posting on file (jd_real and raw_jd are both empty), so there is nothing to remediate against. A package built from our own metadata about the job cannot evidence the employer\'s requirements. Fetch the posting first.',
      } }
    }

    const requirements: RequirementRow[] = (await client.query(
      `select id, seq, verbatim, item_text, kind from requirement where opp_id=$1 order by seq`, [art.opp_id])).rows

    // Where this run's numbering starts. A SECOND run continues the ledger; it does not restart it.
    // remediation_loop is unique (artifact_id, n) and the writer upserts, so beginning again at 1
    // would overwrite the first run's rows - and the second run is the NORMAL case, because
    // resolving an escalation reopens the loop.
    const firstPass = nextPassNumber(Number((await client.query(
      `select max(n) as m from remediation_loop where artifact_id=$1`, [art.id])).rows[0]?.m ?? -1))

    // Loop 0 — the baseline package. A whole-package generation is not a remediation pass.
    // `regen` DELIBERATELY NOT ACCEPTED HERE, and the omission is the point. A whole-package
    // regeneration is the exact thing P3.1 exists to prevent — "re-run generation scoped to the open
    // requirements only, do not rewrite closed blocks". Forcing one before the loop starts would
    // throw away content that is already correct and already evidenced, which is the failure this
    // lane was built to stop. The endpoints that legitimately rebuild everything
    // (`/artifact/{id}/document`, `/packet/build-all`) still take it; the remediation loop must not.
    // It was also caught by H28: a body toggle no caller can send is a parameterised bypass nobody
    // asked for.
    const base = await ensurePackage(client, art, opp, false)
    let pkg: Record<string, any> = { ...base.pkg }
    // The baseline is loop 0 on the FIRST run only. On a later run the package already on the
    // packet is the previous run's output, and rewriting loop 0 would restate history.
    if (firstPass === 1) {
      await writeInsertions(client, art.id, art.opp_id, { type: art.type, pkg, loop: 0 }).catch(e =>
        console.warn('[remediate] baseline insertion provenance not recorded:', String(e)))
    }

    let overrideBefore = await standingOverride(client, artifactId)
    let ev = await evaluateArtifact(client, artifactId, owner)
    const before = await evidenceSnapshot(client, art.opp_id, ev.results.find(r => r.check_key === 'must_have_coverage')?.state || 'not_applicable')

    let cov = coverageView(ev.results)
    let spend: Spend = { ...ZERO_SPEND }
    let progressedLastPass: boolean | null = null
    const profile = await loadProfile().catch(() => ({ profileText: '', omitList: '' }))
    const rows: any[] = []
    let lastScope: ReturnType<typeof scopeForRequirements> = { fields: [], protected: [] }
    let finalLoop = 0
    let haltReason: HaltReason | null = null
    let haltDetail = ''

    for (let pass = firstPass; ; pass++) {
      spend = { ...spend, elapsedMs: Date.now() - startedAt }
      lastScope = scopeForRequirements(art.type, pkg, requirements, cov.openSeqs)
      const decision = decidePass({
        pass: pass - firstPass + 1, coverage: cov, remaining: cov.openSeqs, progressedLastPass,
        spend, prefs, scope: lastScope.fields,
      })
      if (decision.action === 'halt') { haltReason = decision.reason; haltDetail = decision.detail; break }

      const wasOpen = cov.openSeqs.slice()
      const profileHits = profileEvidenceFor(profile.profileText, requirements.filter(r => wasOpen.includes(Number(r.seq))))
      const openRows = requirements.filter(r => wasOpen.includes(Number(r.seq)))
        .map((r: any) => ({ seq: Number(r.seq), verbatim: r.verbatim, item_text: r.item_text, kind: r.kind }))

      let applied: string[] = []
      let rejected: Array<{ field: string; why: string }> = []
      let note = decision.detail
      let passErr: string | null = null
      try {
        const gen = await regenerateFields({
          key, company: opp.company, role: opp.role, pass,
          fields: lastScope.fields, current: pkg, open: openRows,
          profileText: profile.profileText, omitList: profile.omitList,
        })
        // D8 — every pass is metered. `logUsage` writes the row; the loop keeps its own running
        // total because a ceiling that reads back from the metering table would be a second source.
        const t = tokensOf(gen.usage)
        await logUsage(`packet:${art.type}:remediate:pass${pass}`, gen.model, gen.usage)
        spend = addCall({ ...spend, passesDone: pass - firstPass + 1 }, {
          costUsd: costOf(gen.model, t.prompt, t.completion), tokens: t.prompt + t.completion,
        })
        const merged = applyScopedFields(pkg, gen.fields, lastScope.fields)
        pkg = merged.pkg; applied = merged.applied; rejected = merged.rejected
        if (gen.detail) note = `${note} — ${gen.detail}`
      } catch (e: any) {
        passErr = String(e?.message || e)
        spend = { ...spend, passesDone: pass - firstPass + 1 }
      }

      // Persist BEFORE evaluating: the engine reads `packet.pkg_json`, so an unpersisted package
      // would be judged as though the pass had never run.
      await client.query(`update packet set pkg_json=$1, updated_at=now() where id=$2`, [JSON.stringify(pkg), art.packet_id])
      await writeInsertions(client, art.id, art.opp_id, { type: art.type, pkg, loop: pass }).catch(e =>
        console.warn('[remediate] insertion provenance not recorded:', String(e)))

      const prevState = cov.state
      overrideBefore = await standingOverride(client, artifactId)
      ev = await evaluateArtifact(client, artifactId, owner)
      cov = coverageView(ev.results)

      const edits = (await client.query(
        `select merge_field, before_text, after_text from insertion where artifact_id=$1 and loop=$2`, [art.id, pass])).rows
      const credit = creditClosures({ wasOpen, nowOpen: cov.openSeqs, edits, requirements })
      progressedLastPass = credit.closed.length > 0

      const reqCountNow = Number((await client.query(`select count(*)::int as n from requirement where opp_id=$1`, [art.opp_id])).rows[0]?.n || 0)
      const row = {
        packet_id: art.packet_id, artifact_id: art.id, n: pass, run_id: ev.run_id,
        closed: idsForSeqs(requirements, credit.closed),
        phantom_closes: idsForSeqs(requirements, credit.phantom),
        remaining: idsForSeqs(requirements, credit.remaining),
        edited_fields: credit.editedFields, scope_fields: lastScope.fields,
        profile_evidence: idsForSeqs(requirements, profileHits),
        note: passErr ? `${note} — pass failed: ${passErr}` : `${note}${rejected.length ? ` — rejected ${rejected.length} out-of-scope/blank field(s): ${rejected.map(r => r.field).join(', ')}` : ''}${applied.length ? ` — applied ${applied.join(', ')}` : ''}`,
        halted: false, halt_reason: null as string | null,
        must_have_state: cov.state, prev_must_have_state: prevState,
        req_count: reqCountNow,
        prompt_tokens: 0, completion_tokens: 0,
        cost_usd: spend.unpricedCalls ? null : spend.usd,
        unpriced_calls: spend.unpricedCalls,
        elapsed_ms: Date.now() - startedAt,
        cleared_override: overrideBefore,
        remainingSeqs: credit.remaining,
      }
      rows.push(row)
      finalLoop = pass
      if (passErr) { haltReason = 'error'; haltDetail = passErr; break }
    }

    // The final row records the halt. When no pass ran at all there is nothing to amend, so a
    // pass-0 row carries the reason - otherwise a run that halted immediately would leave no ledger
    // and read as "never attempted".
    if (rows.length) {
      const last = rows[rows.length - 1]
      last.halted = true; last.halt_reason = haltReason
      last.note = `${last.note} — halted: ${haltDetail}`
    } else {
      rows.push({
        packet_id: art.packet_id, artifact_id: art.id, n: 0, run_id: ev.run_id,
        closed: [], phantom_closes: [], remaining: idsForSeqs(requirements, cov.openSeqs),
        edited_fields: [], scope_fields: lastScope.fields, profile_evidence: [], note: haltDetail,
        halted: true, halt_reason: haltReason,
        must_have_state: cov.state, prev_must_have_state: null,
        req_count: before.reqCount, prompt_tokens: 0, completion_tokens: 0,
        cost_usd: spend.unpricedCalls ? null : spend.usd, unpriced_calls: spend.unpricedCalls,
        elapsed_ms: Date.now() - startedAt, cleared_override: overrideBefore,
        remainingSeqs: cov.openSeqs,
      })
      finalLoop = firstPass
    }

    // P3-38 — a run that got greener by deleting the evidence it was judged against is refused
    // BEFORE anything is stored. Throwing here leaves the ledger empty, which is the honest record:
    // there was no remediation, there was a corrupted comparison.
    const after = await evidenceSnapshot(client, art.opp_id, cov.state)
    assertEvidenceIntact(before, after)

    for (const r of rows) {
      await client.query(
        `insert into remediation_loop
           (packet_id, artifact_id, n, run_id, closed, phantom_closes, remaining, edited_fields,
            scope_fields, profile_evidence, note, halted, halt_reason, must_have_state, prev_must_have_state, req_count,
            prompt_tokens, completion_tokens, cost_usd, unpriced_calls, elapsed_ms, engine_version,
            cleared_override_by, cleared_override_at, cleared_override_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         on conflict (artifact_id, n) do update set
           run_id=excluded.run_id, closed=excluded.closed, phantom_closes=excluded.phantom_closes,
           remaining=excluded.remaining, edited_fields=excluded.edited_fields,
           scope_fields=excluded.scope_fields, profile_evidence=excluded.profile_evidence,
           note=excluded.note, halted=excluded.halted,
           halt_reason=excluded.halt_reason, must_have_state=excluded.must_have_state,
           prev_must_have_state=excluded.prev_must_have_state, req_count=excluded.req_count,
           cost_usd=excluded.cost_usd, unpriced_calls=excluded.unpriced_calls,
           elapsed_ms=excluded.elapsed_ms, ran_at=now()`,
        [r.packet_id, r.artifact_id, r.n, r.run_id, r.closed, r.phantom_closes, r.remaining,
         r.edited_fields, r.scope_fields, r.profile_evidence, r.note, r.halted, r.halt_reason, r.must_have_state,
         r.prev_must_have_state, r.req_count, r.prompt_tokens, r.completion_tokens, r.cost_usd,
         r.unpriced_calls, r.elapsed_ms, REMEDIATION_VERSION,
         r.cleared_override?.by ?? null, r.cleared_override?.at ?? null, r.cleared_override?.reason ?? null])
    }

    // P3.2 — one open escalation per still-open requirement per artifact, stating what was searched.
    const stillOpen = rows[rows.length - 1].remainingSeqs as number[]
    let escalations = 0
    for (const seq of stillOpen) {
      const r: any = requirements.find(q => Number(q.seq) === seq)
      if (!r) continue
      const text = escalationFor({
        requirement: { seq, verbatim: r.verbatim, item_text: r.item_text, kind: r.kind },
        artifactType: art.type, pass: finalLoop, haltReason: (haltReason || 'error') as HaltReason,
        searched: lastScope.fields, withheld: lastScope.protected, profileSearched: !!profile.profileText,
      })
      await client.query(
        `insert into escalation (packet_id, artifact_id, requirement_id, state, title, detail, ask, loop, halt_reason)
         values ($1,$2,$3,'open',$4,$5,$6,$7,$8)
         on conflict (artifact_id, requirement_id) do update set
           title=excluded.title, detail=excluded.detail, ask=excluded.ask, loop=excluded.loop,
           halt_reason=excluded.halt_reason, updated_at=now()
         where escalation.state = 'open'`,
        [art.packet_id, art.id, r.id, text.title, text.detail, text.ask, finalLoop, haltReason])
      escalations++
    }
    // A requirement the loop DID close must not keep an open escalation from an earlier run.
    const closedIds = rows.flatMap(r => r.closed)
    if (closedIds.length) {
      await client.query(
        `update escalation set state='accepted', resolution_note='closed by the remediation loop',
           resolved_by='remediation-loop', resolved_at=now(), updated_at=now()
         where artifact_id=$1 and state='open' and requirement_id = any($2::uuid[])`, [art.id, closedIds])
    }

    // X5 / P3-25 — ONE Drive copy, here, after every pass has finished. Not zero, and not N.
    // There was a `render:false` escape here to skip it. Removed: X5's contract is that documents
    // render ONCE after the loop, and skipping the render leaves `artifact.doc_url` pointing at
    // pre-loop content while `packet.pkg_json` has moved on — the document and the package
    // disagreeing is precisely the divergence this evidence layer exists to make impossible. It had
    // no caller either (H28).
    let rendered: any = null
    try { rendered = await renderArtifact(client, art, opp, pkg as any, { loop: finalLoop }) }
    catch (e: any) { rendered = { error: String(e?.message || e) } }

    // P3-44 / D-4. `packet.round` counts REMEDIATION RUNS - one per run, not one per pass. It was a
    // column read by `loadPacket`'s ORDER BY and by `packetShape` while nothing on earth wrote it.
    // The loop is the only thing that puts a packet through another cycle, so the loop is what
    // advances it; that is "wire it or drop it" resolved by wiring, with no new counter added.
    await client.query(`update packet set round = round + 1, updated_at = now() where id = $1`, [art.packet_id])

    // P3-24. The Drive file this run replaced, recorded against the run that replaced it.
    if (rendered?.supersededDocUrl) {
      await client.query(`update remediation_loop set superseded_doc_url=$1 where artifact_id=$2 and n=$3`,
        [rendered.supersededDocUrl, art.id, finalLoop])
    }

    const outcome = reportedOutcome(rows.map(r => ({
      n: r.n, halted: r.halted, halt_reason: r.halt_reason, remaining: r.remainingSeqs, must_have_state: r.must_have_state,
    })))
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, artifactId, type: art.type, ...outcome,
        gate: ev.gate, attention: ev.attention, escalations,
        spend: { usd: spend.unpricedCalls ? null : Number(spend.usd.toFixed(6)), unpricedCalls: spend.unpricedCalls, tokens: spend.tokens, elapsedMs: Date.now() - startedAt, model: SCOPED_REGEN_MODEL },
        clearedOverride: rows.map(r => r.cleared_override).find(Boolean) || null,
        rendered,
        loop: rows.map(r => ({ n: r.n, closed: r.closed.length, phantomCloses: r.phantom_closes.length, remaining: r.remaining.length, editedFields: r.edited_fields, note: r.note, halted: r.halted, haltReason: r.halt_reason })),
      },
    }
  } catch (e: any) {
    context.error('artifactRemediate', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// ---------------------------------------------------------------------------------------------
// GET /api/app/artifact/{artifactId}/remediation — the ledger
// ---------------------------------------------------------------------------------------------

export async function artifactRemediationGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const art = (await client.query(
      `select a.id, a.type, p.opp_id from artifact a join packet p on p.id=a.packet_id
         join opportunity o on o.id=p.opp_id where a.id=$1 and o.owner_email=$2`, [req.params.artifactId, owner])).rows[0]
    if (!art) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }
    const rows = (await client.query(
      `select * from remediation_loop where artifact_id=$1 order by n`, [art.id])).rows
    const escalations = (await client.query(
      `select e.*, r.seq as requirement_seq, r.verbatim, r.item_text, r.kind
         from escalation e left join requirement r on r.id=e.requirement_id
        where e.artifact_id=$1 order by e.state, r.seq`, [art.id])).rows
    // The outcome sentence is produced by the SAME function the run used, so the ledger and the run
    // can never disagree about whether the loop converged.
    const outcome = reportedOutcome(rows.map((r: any) => ({
      n: r.n, halted: r.halted, halt_reason: r.halt_reason, remaining: r.remaining || [], must_have_state: r.must_have_state,
    })))
    return { status: 200, headers: HEADERS, jsonBody: { artifactId: art.id, type: art.type, ...outcome, passes: rows, escalations } }
  } catch (e: any) {
    context.error('artifactRemediationGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// ---------------------------------------------------------------------------------------------
// POST /api/app/escalation/{id} — the two resolutions
// ---------------------------------------------------------------------------------------------

/**
 * The backlog gives an escalation exactly two ends: the user supplies evidence (which REOPENS the
 * loop) or accepts the gap (and the score keeps reporting it). Both are recorded with an actor and
 * a time; neither deletes the row, because an accepted gap that vanishes is a gap nobody can audit.
 */
export async function escalationResolve(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  let client
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const state = String(body?.state || '')
    if (state !== 'resolved' && state !== 'accepted') {
      return { status: 400, headers: HEADERS, jsonBody: { error: "state must be 'resolved' (you supplied evidence) or 'accepted' (you accept the gap)" } }
    }
    const note = String(body?.note || '').trim()
    // Evidence is the whole point of `resolved`: without it, "resolved" and "accepted" are the same
    // row wearing different words, and the loop would re-run against nothing new.
    if (state === 'resolved' && !note) {
      return { status: 400, headers: HEADERS, jsonBody: { error: "resolving an escalation requires the evidence, in `note` — the loop re-runs against it" } }
    }
    client = await getPgClient()
    const esc = (await client.query(
      `select e.id, e.artifact_id from escalation e join artifact a on a.id=e.artifact_id
         join packet p on p.id=a.packet_id join opportunity o on o.id=p.opp_id
        where e.id=$1 and o.owner_email=$2`, [req.params.id, owner])).rows[0]
    if (!esc) return { status: 404, headers: HEADERS, jsonBody: { error: 'escalation not found' } }
    await client.query(
      `update escalation set state=$1, resolution_note=$2, resolved_by=$3, resolved_at=now(), updated_at=now() where id=$4`,
      [state, note || null, owner, esc.id])
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, id: esc.id, state, artifactId: esc.artifact_id,
        next: state === 'resolved'
          ? 'Re-run the remediation loop for this artifact; the evidence you supplied is now on the record.'
          : 'The gap stays on the score. Nothing was invented to close it.',
      },
    }
  } catch (e: any) {
    context.error('escalationResolve', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// ---------------------------------------------------------------------------------------------
// GET / PATCH /api/app/remediation-prefs — the owner's ceilings
// ---------------------------------------------------------------------------------------------

export async function remediationPrefs(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    if (req.method === 'PATCH') {
      const guard = requireWrite(req); if (guard) return guard
      const b = (await req.json().catch(() => ({}))) as any
      await ensureLoopPrefs(client)
      await client.query(`insert into owner_search_prefs (owner_email) values ($1) on conflict (owner_email) do nothing`, [owner])
      const map: Record<string, string> = {
        maxPasses: 'rem_max_passes', costCeilingUsd: 'rem_cost_ceiling_usd',
        wallClockMs: 'rem_wall_clock_ms', tokenCeiling: 'rem_token_ceiling', enabled: 'rem_enabled',
      }
      const sets: string[] = []; const vals: any[] = [owner]
      for (const [k, col] of Object.entries(map)) {
        if (b[k] === undefined) continue
        vals.push(k === 'enabled' ? !!b[k] : Number(b[k]))
        sets.push(`${col}=$${vals.length}`)
      }
      if (sets.length) await client.query(`update owner_search_prefs set ${sets.join(', ')} where owner_email=$1`, vals)
    }
    const prefs = await loadLoopPrefs(client, owner)
    return { status: 200, headers: HEADERS, jsonBody: { owner, prefs, defaults: DEFAULT_LOOP_PREFS } }
  } catch (e: any) {
    context.error('remediationPrefs', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('artifactRemediate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/remediate', handler: artifactRemediate })
app.http('artifactRemediationGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/artifact/{artifactId}/remediation', handler: artifactRemediationGet })
app.http('escalationResolve', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/escalation/{id}', handler: escalationResolve })
app.http('remediationPrefs', { methods: ['GET', 'PATCH', 'OPTIONS'], authLevel: 'anonymous', route: 'app/remediation-prefs', handler: remediationPrefs })

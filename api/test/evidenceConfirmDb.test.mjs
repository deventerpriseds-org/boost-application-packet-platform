// THE OWNER'S CONFIRMATION — the step that finally lets coverage move off zero, against a REAL db.
//
// WHY THIS EXISTS. Measured 2026-08-23 on opportunity 2cb56fb3 (a real 9,749-char posting): the
// deterministic resolver evidences 0 of 35 requirements, so `must_have_coverage` reads 0/12 and no
// threshold fixes it — the missing tokens are words the profile does not contain, and derivational
// stemming was measured to clear ZERO of twelve while breaching the named-entity gate. The
// escalation tier DOES bridge it (8 of 12 proposed), but `ruleEvidenceOf` excludes a `proposed` row
// by design. The app told the owner they were "awaiting your confirmation" in three places and there
// was nothing to confirm them with.
//
// The house rule is preserved, not weakened: a MODEL still cannot accuse. A HUMAN can, and a human
// reading the excerpt beside the requirement is a stronger warrant than token overlap, not a weaker
// one. These tests pin both halves — the promotion AND the refusal.
//
// Keyed on CLAIM IDENTITY, tested against a real database because the whole design lives in a JOIN:
// re-extraction runs `delete from requirement where opp_id=$1` with ON DELETE CASCADE, so anything
// keyed on requirement_id or seq is destroyed or silently reassigned. Only executing it proves that.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { loadRequirementsWithEvidence, ensureEvidenceTable } from '../dist/functions/tests/appRequirements.js'
import { SCHEMA_SQL } from '../dist/functions/tests/schema.js'

const { Client } = pg
const PGBIN = '/usr/lib/postgresql/16/bin'
const SOCK = '/var/tmp/p84pg'
const PGDATA = `${SOCK}/data`

function bootPg() {
  if (!existsSync(`${PGBIN}/initdb`)) return false
  try {
    if (existsSync(`${SOCK}/.s.PGSQL.55432`)) {
      try { execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} status"`, { stdio: 'ignore' }); return true } catch {}
    }
    execSync(`rm -rf ${SOCK} && mkdir -p ${PGDATA} && chown -R postgres ${SOCK}`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/initdb -D ${PGDATA} -U postgres -A trust"`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} -o '-p 55432 -k ${SOCK} -c listen_addresses=' -l ${SOCK}/pg.log -w start"`, { stdio: 'ignore' })
    return existsSync(`${SOCK}/.s.PGSQL.55432`)
  } catch { return false }
}
const HAVE_PG = bootPg()
const CONN = { host: SOCK, port: 55432, user: 'postgres', database: 'postgres' }
const schemaSql = () => SCHEMA_SQL
  .replace(/^create extension if not exists vector;/m, '-- stubbed')
  .replace(/vector\(1536\)/g, 'text')
  .split('\n').filter(l => !/using hnsw \(embedding vector_cosine_ops\)/.test(l)).join('\n')

const OWNER = 'confirm@test.local'
// The REAL shapes from the live measurement: the requirement the posting stated, and the excerpt the
// model proposed out of the owner's profile. `support` for this pair is 0.40 against a 0.70 bar, so
// no rule will ever settle it — which is exactly the population confirmation exists for.
const REQ = 'Collaborative executive capable of building alignment'
const QUOTE = 'fostering collaboration and ensuring alignment'
const RECORD_SHA = 'a'.repeat(64)

async function seed(c, { sha = RECORD_SHA, reqText = REQ } = {}) {
  await c.query(`delete from opportunity where owner_email=$1`, [OWNER])
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage)
     values ($1,'eMoney','VP Eng','enriched') returning id`, [OWNER])).rows[0].id
  const req = (await c.query(
    `insert into requirement (opp_id, seq, kind, item_text, verbatim, char_start, char_end,
                              match_method, kind_source, weight, jd_posting_snapshot_sha256, extractor_version)
     values ($1, 29, 'must_have', $2, $2, 100, $3, 'exact','category_default',2,'sha',1) returning id`,
    [opp, reqText, 100 + reqText.length])).rows[0].id
  await c.query(
    `insert into requirement_evidence
       (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
        extra, ratio, method, record_sha256, resolver_version, proposal_version)
     values ($1,$2,'work_history','Career','work:career',3,$3,null,null,'proposed',$4,1,1)`,
    [req, QUOTE, 3 + QUOTE.length, sha])
  const ev = (await c.query(
    `select id from requirement_evidence where requirement_id=$1`, [req])).rows[0].id
  return { opp, req, ev }
}

const confirm = (c, opp, { reqText = REQ, sha = RECORD_SHA } = {}) => c.query(
  `insert into evidence_confirmation
     (opp_id, requirement_text, source_key, char_start, char_end, quote, record_sha256, confirmed_by)
   values ($1,$2,'work:career',3,$3,$4,$5,$6)`,
  [opp, reqText, 3 + QUOTE.length, QUOTE, sha, OWNER])

const confirmedAt = async (c, opp) =>
  (await loadRequirementsWithEvidence(c, opp))[0].evidence_confirmed_at

test('H:unconfirmed-proposal-is-not-confirmed: a model proposal alone carries no human warrant',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    const row = (await loadRequirementsWithEvidence(c, opp))[0]
    assert.equal(row.evidence_method, 'proposed', 'fixture must be a model proposal')
    assert.equal(row.evidence_confirmed_at, null,
      'A PROPOSAL COUNTED WITHOUT A HUMAN. The whole house rule is that a model may propose and only ' +
      'an exact rule — or the owner — may accuse. An auto-confirmed proposal is the model accusing.')
  } finally { await c.end() }
})

test('H:confirmed-proposal-is-carried-to-the-gate: the owner\'s decision reaches the numerator',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    await confirm(c, opp)
    const at = await confirmedAt(c, opp)
    assert.ok(at,
      'THE CONFIRMATION DID NOT REACH THE GATE. Coverage stays pinned at 0/12 and the owner clicks ' +
      'confirm for nothing — which is the defect this whole change exists to remove.')
  } finally { await c.end() }
})

// THE FAIL-CLOSED PROPERTY. A confirmation says "THIS quote, from THIS record, answers THIS
// requirement." Change any of those three and the owner never made that claim, so it must lapse
// rather than transfer. A surviving stale confirmation asserts something no human said and no rule
// supports — strictly worse than 0/12, because 0/12 is honestly empty and this is confidently wrong.
test('H:a-changed-profile-record-voids-the-confirmation: it lapses, never transfers',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    await confirm(c, opp)
    assert.ok(await confirmedAt(c, opp), 'precondition: confirmed before the edit')

    // The owner edits their profile: same quote text, same offsets, DIFFERENT record digest.
    await c.query(`update requirement_evidence set record_sha256=$1`, ['b'.repeat(64)])
    assert.equal(await confirmedAt(c, opp), null,
      'A STALE CONFIRMATION SURVIVED A PROFILE EDIT. The stored claim now asserts a human vouched ' +
      'for an excerpt from a record that has changed underneath it.')
  } finally { await c.end() }
})

test('H:a-changed-requirement-voids-the-confirmation: re-extraction must not transfer a decision',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    await confirm(c, opp)
    assert.ok(await confirmedAt(c, opp), 'precondition: confirmed')

    // The posting is re-parsed and seq 29 now holds a DIFFERENT requirement. `seq` is a reused
    // positional index, so anything keyed on it would silently inherit this decision.
    await c.query(`update requirement set verbatim=$1, item_text=$1 where opp_id=$2`,
      ['Hands-on experience with AI/ML technologies', opp])
    assert.equal(await confirmedAt(c, opp), null,
      'A CONFIRMATION TRANSFERRED TO A DIFFERENT REQUIREMENT. seq is reused across re-extraction, ' +
      'so the owner would be recorded as vouching for a claim they never saw.')
  } finally { await c.end() }
})

// AC-13: the confirmation must SURVIVE the destructive re-extraction when the claim is unchanged —
// otherwise the owner re-confirms everything after every JD re-parse and abandons the feature.
test('H:confirmation-survives-re-extraction: an identical claim keeps its decision',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp, ev } = await seed(c)
    await confirm(c, opp)
    const before = await confirmedAt(c, opp)
    assert.ok(before, 'precondition: confirmed')

    // EXACTLY what writeRequirements does — and it cascades every evidence row away with it.
    // Scoped to THIS fixture's row id: the suite shares one database with shipPathDb.test.mjs, so a
    // global count here would be measuring another test's leftovers, not the cascade.
    await c.query(`delete from requirement where opp_id=$1`, [opp])
    assert.equal((await c.query(
      `select count(*)::int n from requirement_evidence where id=$1`, [ev])).rows[0].n, 0,
      'precondition: the cascade really did wipe THIS fixture\'s evidence row')

    // Re-extracted identically, and evidence re-resolved to the identical claim.
    const req = (await c.query(
      `insert into requirement (opp_id, seq, kind, item_text, verbatim, char_start, char_end,
                                match_method, kind_source, weight, jd_posting_snapshot_sha256, extractor_version)
       values ($1, 29, 'must_have', $2, $2, 100, $3, 'exact','category_default',2,'sha',1) returning id`,
      [opp, REQ, 100 + REQ.length])).rows[0].id
    await c.query(
      `insert into requirement_evidence
         (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
          extra, ratio, method, record_sha256, resolver_version, proposal_version)
       values ($1,$2,'work_history','Career','work:career',3,$3,null,null,'proposed',$4,1,1)`,
      [req, QUOTE, 3 + QUOTE.length, RECORD_SHA])

    const after = await confirmedAt(c, opp)
    assert.ok(after,
      'THE CONFIRMATION WAS DESTROYED BY RE-EXTRACTION. requirement_evidence cascades on ' +
      'delete-from-requirement, so a confirmation stored on that row cannot survive a JD re-parse — ' +
      'which is why it is keyed on claim identity in its own table.')
    assert.equal(after.getTime(), before.getTime(),
      'the ORIGINAL timestamp must be preserved, not re-stamped by the rebuild')
  } finally { await c.end() }
})

// THE CAP MUST BE SPENT ON WHAT DECIDES THE GATE.
//
// MEASURED on opportunity 2cb56fb3 (2026-08-23, db-query 32620958845): all 8 model proposals landed
// on RESPONSIBILITIES at seq 0-11 while the must-haves sit at seq 22-34. `open` was taken in `seq`
// order against a cap of 12, so the budget was exhausted before reaching a single must-have and
// `escalation_refusals.over_cap` was 1. `must_have_coverage` therefore read 0/12 no matter what the
// model found — and the confirmation path built in front of it would have been a feature the owner
// could click on responsibilities while the number gating his packet never moved.
//
// `must_have_coverage` blocks `ready`; `responsibilities_addressed` only warns. This asserts the
// ORDERING, not the cap: a run that can only afford some requirements must afford the ones that
// decide whether anything ships.
import { writeEvidence } from '../dist/functions/tests/appRequirements.js'

test('H:escalation-spends-its-cap-on-must-haves-first: the gate-deciding rows are never starved',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    await c.query(`delete from opportunity where owner_email=$1`, [OWNER])
    const opp = (await c.query(
      `insert into opportunity (owner_email, company, role, stage)
       values ($1,'eMoney','VP Eng','enriched') returning id`, [OWNER])).rows[0].id
    // The REAL live shape: responsibilities occupy the low seqs, must-haves the high ones.
    const mk = (seq, kind, text) => c.query(
      `insert into requirement (opp_id, seq, kind, item_text, verbatim, char_start, char_end,
                                match_method, kind_source, weight, jd_posting_snapshot_sha256, extractor_version)
       values ($1,$2,$3,$4,$4,100,$5,'exact','category_default',2,'sha',1)`,
      [opp, seq, kind, text, 100 + text.length])
    for (let i = 0; i < 21; i++) await mk(i, 'responsibility', `responsibility number ${i} of the role`)
    for (let i = 22; i < 34; i++) await mk(i, 'must_have', `must have qualification number ${i}`)

    // THE TRANSPORT IS THE ONLY HONEST WITNESS. `escalateOne` calls
    // `opts.fetchJson(PROPOSAL_SYSTEM, buildProposalUser(requirement, ...))`, so the user prompt
    // carries the requirement text of every row the cap actually bought. Capturing that is what
    // makes this a behavioural test.
    //
    // THE FIRST VERSION OF THIS TEST WAS VACUOUS AND ITS COMMIT MESSAGE CLAIMED OTHERWISE.
    // It asserted `attempted === 12` (a count of must-have ROWS IN THE DATABASE, true no matter what
    // escalation did) plus two source greps for `sort(` and `must_have: 0` over the surrounding
    // block. An independent verifier killed it: changing `prioritised.slice(...)` back to
    // `open.slice(...)` -- verbatim the defect the guard was said to catch -- left the suite fully
    // green, because the now-dead `sort(` line was still present for the grep to find. Inverting the
    // comparator so must-haves rank LAST also passed. Only physically deleting the block failed it.
    // A guard that survives the regression it names is worse than no guard, because it is believed.
    const attemptedTexts = []
    const spy = async (_system, user) => { attemptedTexts.push(String(user)); throw new Error('no proposal') }
    await writeEvidence(
      c, opp, [{ key: 'work:career', kind: 'work_history', label: 'Career', text: 'irrelevant prose' }],
      { escalate: true, escalateMax: 12 },
      (rows) => rows.map(r => ({ seq: r.seq, requirement_text: r.item_text, evidence: null })),
      spy,
    ).catch(() => {})

    assert.ok(attemptedTexts.length > 0,
      'the escalation pass made no attempts at all — this test would be vacuous')

    // WHICH requirements the cap was spent on. With 21 responsibilities at seq 0-20 and 12
    // must-haves at seq 22-33, a seq-ordered pass spends all 12 attempts on responsibilities and
    // reaches ZERO must-haves — which is exactly what production did (all 8 proposals on
    // responsibilities, must_have_coverage stuck at 0/12 no matter what the model found).
    const mustHaveAttempts = attemptedTexts.filter(t => t.includes('must have qualification')).length
    const responsibilityAttempts = attemptedTexts.filter(t => t.includes('responsibility number')).length

    assert.equal(responsibilityAttempts, 0,
      `THE CAP WAS SPENT ON RESPONSIBILITIES (${responsibilityAttempts} of ${attemptedTexts.length} ` +
      'attempts). must_have_coverage blocks `ready`; responsibilities_addressed only warns. Spending ' +
      'the budget on the warning means the gating number can never move.')
    assert.equal(mustHaveAttempts, attemptedTexts.length,
      'every attempt the cap bought must be a must-have while any must-have is still unevidenced')
  } finally { await c.end() }
})

// ─── F-10: a vetted verdict survives a re-resolve, so the gate stops flapping ──────────────────
//
// From an independent verifier: the coverage judge builds a whole cache table on the principle that
// a model asked twice may answer differently and a flapping gate is worse than a consistently wrong
// one — while the lane that actually moves `must_have_coverage` had none of it, because the
// re-resolve deleted every vetted row and the next pass re-asked from scratch.
//
// AGAINST A REAL DATABASE, because the fix is one SQL clause. A fake client would happily "pass" a
// `not (e.method = 'vetted' and e.record_sha256 = any($2::text[]))` that Postgres rejects or that
// matches nothing.

const RECORD = { key: 'work:career', kind: 'work_history', label: 'Career',
  text: 'Reduced outages from nine hours to one across the payments platform.' }

test('H:a-vetted-verdict-is-not-thrown-away-by-the-next-resolve',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp, req } = await seed(c)

    // A vetted row, exactly as the vet lane writes one: the record's own bytes, its digest, and the
    // citation in `extra`.
    const { createHash } = await import('node:crypto')
    const sha = createHash('sha256').update(RECORD.text, 'utf8').digest('hex')
    const quote = 'Reduced outages from nine hours to one'
    await c.query(
      `insert into requirement_evidence
         (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
          extra, ratio, method, record_sha256, resolver_version, proposal_version)
       values ($1,$2,'work_history','Career','work:career',0,$3,'vetted: challenged ...',null,'vetted',$4,1,1)`,
      [req, quote, quote.length, sha])

    // A re-resolve WITH a transport — the path that used to delete everything. The transport throws,
    // so nothing new can be written: whatever survives, survived the delete.
    let asked = 0
    await writeEvidence(c, opp, [RECORD], { escalate: true, vetProposals: true },
      (rows) => rows.map(r => ({ seq: r.seq, requirement_text: r.item_text, evidence: null })),
      async () => { asked++; throw new Error('no proposal') }).catch(() => {})

    const after = (await c.query(
      `select e.method, e.extra from requirement_evidence e
         join requirement r on r.id = e.requirement_id where r.opp_id = $1`, [opp])).rows
    assert.equal(after.length, 1, 'the vetted row survived the re-resolve')
    assert.equal(after[0].method, 'vetted')
    assert.match(after[0].extra, /vetted: challenged/, 'with its citation intact')
    assert.equal(asked, 0,
      'and the pass did not re-ask about a requirement it had already answered — re-asking is the ' +
      'flapping this fixes, reintroduced one loop later')
  } finally { await c.end() }
})

test('H:an-edited-profile-invalidates-a-vetted-verdict',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // The other half, and the reason the digest is the key rather than the method alone. A verdict is
  // about words that were there; edit them and it must be re-derived, never silently inherited —
  // the same staleness rule `evidence_confirmation` applies to the owner's own decisions.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp, req } = await seed(c)
    const quote = 'Reduced outages from nine hours to one'
    await c.query(
      `insert into requirement_evidence
         (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
          extra, ratio, method, record_sha256, resolver_version, proposal_version)
       values ($1,$2,'work_history','Career','work:career',0,$3,'vetted: challenged ...',null,'vetted',$4,1,1)`,
      [req, quote, quote.length, 'f'.repeat(64)])   // a digest of some OTHER version of the record

    await writeEvidence(c, opp, [RECORD], { escalate: true, vetProposals: true },
      (rows) => rows.map(r => ({ seq: r.seq, requirement_text: r.item_text, evidence: null })),
      async () => { throw new Error('no proposal') }).catch(() => {})

    const after = (await c.query(
      `select count(*)::int n from requirement_evidence e
         join requirement r on r.id = e.requirement_id where r.opp_id = $1`, [opp])).rows[0].n
    assert.equal(after, 0, 'a verdict read from a version of the record that no longer exists is dropped')
  } finally { await c.end() }
})

/** A VETO written the way the reject route writes one: a decision row, not a withdrawal. */
const veto = (c, opp, { reqText = REQ, sha = RECORD_SHA } = {}) => c.query(
  `insert into evidence_confirmation
     (opp_id, requirement_text, source_key, char_start, char_end, quote, record_sha256,
      confirmed_by, decision)
   values ($1,$2,'work:career',3,$3,$4,$5,$6,'vetoed')`,
  [opp, reqText, 3 + QUOTE.length, QUOTE, sha, OWNER])

test('H:a-veto-never-reads-as-a-confirmation: polarity is checked in the join, not assumed',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // WRITTEN BECAUSE A MUTATION CAME BACK INERT. Replacing the loader's
  // `case when c.decision = 'confirmed' then c.confirmed_at end` with a bare `c.confirmed_at`
  // changed no test, and that mutation is the single most damaging defect available in this
  // change: the decision join matches EITHER polarity by design -- the veto has to reach
  // ruleEvidenceOf through the same identity join -- so without the case, a VETOED row sets
  // evidence_confirmed_at. isConfirmed then reads true for the exact claim the owner rejected, and
  // a confirmation is the strongest warrant the gate recognises. Clicking "Not this one" would
  // PROMOTE the row it was meant to remove, and nothing would have said so.
  //
  // Asserted against the real join on a real database, because the defect lives in SQL: a
  // hand-built fixture would have to reproduce the case expression to be wrong about it, which is
  // the "can the system PRODUCE your fixture" trap.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    await veto(c, opp)
    const row = (await loadRequirementsWithEvidence(c, opp))[0]
    assert.equal(row.evidence_decision, 'vetoed', 'the veto must reach the loader at all')
    assert.equal(row.evidence_confirmed_at, null,
      'A VETO READ AS A CONFIRMATION. The owner rejected this claim and the join reported it as ' +
      'their approval — the strongest warrant the gate has. The click that removes a row would ' +
      'promote it instead.')
    assert.equal(row.evidence_confirmed_by, null,
      'the actor column must not name the owner as having confirmed what they vetoed')
  } finally { await c.end() }
})

test('H:a-veto-is-written-without-a-prior-confirmation: the reject path is not inert',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // THE SHIPPED DEFECT THIS LANE EXISTS TO FIX, pinned at the level it failed. The reject branch
  // was an UPDATE ... where withdrawn_at is null with no INSERT, so a veto could only land on a
  // claim the owner had ALREADY CONFIRMED. For a proposal they had never confirmed -- the normal
  // case -- it matched zero rows and still returned ok:true.
  //
  // The assertion is deliberately about the NO-PRIOR-ROW path, because the reject branch was
  // correct for the other one and that is exactly why the bug survived: every state a test would
  // naturally set up first (confirm, then reject) worked.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    const before = (await c.query(`select count(*)::int n from evidence_confirmation where opp_id=$1`, [opp])).rows[0].n
    assert.equal(before, 0, 'fixture must start with no decision of either polarity')
    await veto(c, opp)
    const rows = (await c.query(
      `select decision, withdrawn_at from evidence_confirmation where opp_id=$1`, [opp])).rows
    assert.equal(rows.length, 1, 'a veto with no prior confirmation must still be recorded')
    assert.equal(rows[0].decision, 'vetoed')
    assert.equal(rows[0].withdrawn_at, null,
      'a veto is a decision, not a withdrawal — overloading withdrawn_at would make "never ' +
      'confirmed" and "actively rejected" the same row, which are opposite facts')
  } finally { await c.end() }
})

test('H:veto-and-confirm-flip-one-row: a claim has exactly one current decision',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // The unique key is the CLAIM, so a change of mind must FLIP the row rather than insert a second
  // one -- and the un-veto direction is the half most easily missed. Without `decision =
  // 'confirmed'` in the confirm path's ON CONFLICT, a yes arriving after a no would clear
  // withdrawn_* on a row still reading 'vetoed', and the owner's reversal would be discarded.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql()); await ensureEvidenceTable(c)
    const { opp } = await seed(c)
    await veto(c, opp)
    await c.query(
      `insert into evidence_confirmation
         (opp_id, requirement_text, source_key, char_start, char_end, quote, record_sha256,
          confirmed_by, decision)
       values ($1,$2,'work:career',3,$3,$4,$5,$6,'confirmed')
       on conflict (opp_id, requirement_text, source_key, char_start, char_end, record_sha256)
       do update set decision = 'confirmed', withdrawn_at = null, withdrawn_reason = null`,
      [opp, REQ, 3 + QUOTE.length, QUOTE, RECORD_SHA, OWNER])
    const rows = (await c.query(
      `select decision from evidence_confirmation where opp_id=$1`, [opp])).rows
    assert.equal(rows.length, 1, 'a reversal must flip the existing row, never add a second')
    assert.equal(rows[0].decision, 'confirmed', 'the owner un-vetoed and the row must say so')
    assert.equal((await loadRequirementsWithEvidence(c, opp))[0].evidence_confirmed_at !== null, true,
      'once un-vetoed the confirmation must be visible to the gate again')
  } finally { await c.end() }
})

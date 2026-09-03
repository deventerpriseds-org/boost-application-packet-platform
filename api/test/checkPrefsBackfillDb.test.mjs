// D:config-staleness-backfill (AC 10-15, AC-judge-trigger-points.md) — against a REAL PostgreSQL.
//
// WHY A MOCKED CLIENT CANNOT PROVE THIS. The bound (H:backfill-is-bounded) is a `limit $n` inside a
// real `insert ... select ... limit $n on conflict ... do nothing`, and the transition logic
// (H:settings-flip-queues-recheck) depends on a real UPDATE actually persisting the "before" value a
// second query then reads back. A spy client that returns `{rows: []}` for everything cannot expose
// either — it would prove the SQL string was built, never that the bound or the transition holds.
// The cluster-boot helper is copied from `buildQueueDb.test.mjs`/`dimensionsDb.test.mjs` (comment and
// all — those two files already learned the two ways this goes wrong: binaries present but nothing
// listening, and a stale socket file outliving its postmaster).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { SCHEMA_SQL } from '../dist/functions/tests/schema.js'
import { writeCheckPrefs, applyJudgeTransition, loadBackfillPrefs, ensureCheckPrefs } from '../dist/functions/tests/checkPrefs.js'
import { writeArtifactGate } from '../dist/functions/tests/appChecks.js'

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

// pgvector is not installed here; the rest of the schema executes for real.
const sql = () => SCHEMA_SQL
  .replace(/^create extension if not exists vector;/m, '-- stubbed')
  .replace(/vector\(1536\)/g, 'text')
  .replace(/.*using hnsw \(embedding vector_cosine_ops\).*\n/g, '')

let dbn = 0
async function freshDb() {
  const name = `cpb_${process.pid}_${++dbn}`
  const admin = new Client(CONN); await admin.connect()
  await admin.query(`drop database if exists ${name}`)
  await admin.query(`create database ${name}`)
  await admin.end()
  const c = new Client({ ...CONN, database: name }); await c.connect()
  await c.query(sql())
  return c
}

/** Seed one opportunity + N (packet, artifact, artifact_gate) fixtures for `owner`. */
async function seedGatedArtifacts(c, owner, n) {
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage) values ($1,'Acme','VP Eng','saved') returning id`,
    [owner])).rows[0].id
  const ids = []
  for (let i = 0; i < n; i++) {
    const packet = (await c.query(`insert into packet (opp_id) values ($1) returning id`, [opp])).rows[0].id
    const artifact = (await c.query(
      `insert into artifact (packet_id, type, status) values ($1,'resume','review') returning id`, [packet])).rows[0].id
    await c.query(
      `insert into artifact_gate (artifact_id, run_id, gate, attention_count, computed_at)
       values ($1, gen_random_uuid(), 'pass', 0, now())`, [artifact])
    ids.push(artifact)
  }
  return { opp, ids }
}

const pendingRows = async (c, owner, reason) => (await c.query(
  `select artifact_id, state from artifact_recheck_job where owner_email=$1 and reason=$2 order by created_at`,
  [owner, reason])).rows

test('H:settings-flip-queues-recheck: off->on queues every already-gated artifact, on->off queues nothing and cancels the pending queue',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = await freshDb()
  try {
    const OWNER = 'flip@test.local'
    const { ids } = await seedGatedArtifacts(c, OWNER, 3)

    // Baseline: chk_coverage_judge defaults OFF (DEFAULT_THRESHOLDS.coverageJudge, seeded by
    // ensureCheckPrefs). Flipping it explicitly to false first (idempotent no-op) proves a same-value
    // write queues nothing before testing the real transition — the case a naive "any write queues"
    // implementation would get wrong.
    await ensureCheckPrefs(c)
    const noop = await writeCheckPrefs(c, OWNER, { chk_coverage_judge: false })
    assert.equal(noop.queued.coverageJudge, 0, 'false->false must not queue anything')
    assert.deepEqual(await pendingRows(c, OWNER, 'coverage_judge_on'), [], 'nothing queued yet')

    // THE REAL TRANSITION: false -> true.
    const flip = await writeCheckPrefs(c, OWNER, { chk_coverage_judge: true })
    assert.equal(flip.queued.coverageJudge, 3, 'every already-gated artifact must be queued')
    const rows = await pendingRows(c, OWNER, 'coverage_judge_on')
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map(r => r.artifact_id).sort(), [...ids].sort())
    for (const r of rows) assert.equal(r.state, 'pending')

    // true -> true again (no-op): must not double-queue (also exercised by the partial unique index).
    const again = await writeCheckPrefs(c, OWNER, { chk_coverage_judge: true })
    assert.equal(again.queued.coverageJudge, 0, 'true->true must not re-queue')
    assert.equal((await pendingRows(c, OWNER, 'coverage_judge_on')).length, 3, 'row count unchanged')

    // AC 12/15: true -> false must queue NOTHING and CANCEL the pending queue this reason owns.
    const off = await writeCheckPrefs(c, OWNER, { chk_coverage_judge: false })
    assert.equal(off.queued.coverageJudge, 0, 'turning a judge off must never queue spend')
    assert.deepEqual(await pendingRows(c, OWNER, 'coverage_judge_on'), [], 'pending rows must be cancelled on off')

    // AC 15, the "running is left alone" half: a row already claimed (running) survives an off-flip.
    await writeCheckPrefs(c, OWNER, { chk_coverage_judge: true })
    await c.query(`update artifact_recheck_job set state='running' where owner_email=$1 and reason='coverage_judge_on' and artifact_id=$2`,
      [OWNER, ids[0]])
    await writeCheckPrefs(c, OWNER, { chk_coverage_judge: false })
    const survivor = (await c.query(
      `select state from artifact_recheck_job where owner_email=$1 and artifact_id=$2 and reason='coverage_judge_on'`,
      [OWNER, ids[0]])).rows[0]
    assert.equal(survivor.state, 'running', 'a job already running must not be cancelled mid-flight')
    // and the two still-pending rows (ids[1], ids[2]) WERE cancelled by the same off-flip.
    const stillPending = (await c.query(
      `select count(*)::int n from artifact_recheck_job where owner_email=$1 and reason='coverage_judge_on' and state='pending'`,
      [OWNER])).rows[0].n
    assert.equal(stillPending, 0)

    // AC 11: chk_reviewer_auto gets the SAME mechanism, independently of chk_coverage_judge.
    const flip2 = await writeCheckPrefs(c, OWNER, { chk_reviewer_auto: true })
    assert.equal(flip2.queued.reviewerAuto, 3, 'chk_reviewer_auto must extend the same backfill mechanism')
    assert.equal((await pendingRows(c, OWNER, 'reviewer_auto_on')).length, 3)
  } finally { await c.end() }
})

test('H:backfill-is-bounded: an off->on transition can never enqueue more than the owner\'s own cap, no matter the corpus size',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = await freshDb()
  try {
    const OWNER = 'bounded@test.local'
    // Corpus is deliberately larger than the cap.
    await seedGatedArtifacts(c, OWNER, 10)
    await ensureCheckPrefs(c)
    await writeCheckPrefs(c, OWNER, { chk_backfill_max_per_flip: 3 })
    const { maxPerFlip } = await loadBackfillPrefs(c, OWNER)
    assert.equal(maxPerFlip, 3, 'the setting write must actually take effect before the flip')

    const flip = await writeCheckPrefs(c, OWNER, { chk_coverage_judge: true })
    assert.equal(flip.queued.coverageJudge, 3, 'the enqueue must stop at the cap, not the corpus size (10)')
    const n = (await c.query(
      `select count(*)::int n from artifact_recheck_job where owner_email=$1 and reason='coverage_judge_on'`,
      [OWNER])).rows[0].n
    assert.equal(n, 3, 'the DATABASE must hold at most the cap — this is the assertion a mock cannot make')

    // The default (500) is also a real bound, not "no bound" — proven directly against
    // applyJudgeTransition with a smaller corpus so the test stays fast, on a SEPARATE owner so the
    // first owner's cap setting cannot leak in.
    const OWNER2 = 'boundeddefault@test.local'
    await seedGatedArtifacts(c, OWNER2, 5)
    const queued2 = await applyJudgeTransition(c, OWNER2, 'coverage_judge_on', false, true)
    assert.equal(queued2, 5, 'under the default cap (500) a small corpus is queued in full')
    const { maxPerFlip: defaultCap } = await loadBackfillPrefs(c, OWNER2)
    assert.equal(defaultCap, 500, 'an owner who never touched the setting gets the seeded default, not 0')
  } finally { await c.end() }
})

test('H:gate-records-its-config: an artifact_gate row cannot exist without recording the config that made it',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // LIVE EVIDENCE this guards (AC-judge-trigger-points.md): owner_search_prefs.chk_coverage_judge
  // flipped true at 2026-09-02 15:45:28; check_result rows for the Trinnex packet's cover/portfolio/
  // compact_resume artifacts kept accumulating from 2026-08-22 with ZERO requirement_coverage rows
  // until a human manually re-ran them on 09-03 — because nothing on the artifact_gate row said
  // which config computed it, so a stale verdict was indistinguishable from a current one.
  const c = await freshDb()
  try {
    const OWNER = 'stamp@test.local'
    const { ids: [artifactId] } = await seedGatedArtifacts(c, OWNER, 1)
    // seedGatedArtifacts already wrote an UNSTAMPED gate row (pre-existing-run shape); overwrite it
    // through the REAL production write path under test.
    const runId1 = '11111111-0000-0000-0000-000000000001'
    await writeArtifactGate(c, {
      artifactId, runId: runId1, gate: 'warn', attention: 2,
      coverageJudgeOn: false, reviewerAutoOn: false, judgeVersion: 1, promptVersion: 1,
    })
    let row = (await c.query(`select * from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
    assert.equal(row.gate, 'warn')
    assert.equal(row.coverage_judge_on, false)
    assert.equal(row.reviewer_auto_on, false)
    assert.equal(row.judge_version, 1)
    assert.equal(row.prompt_version, 1)

    // A SECOND run, as if the owner flipped the judge on and the backfill (or a manual re-check) ran
    // — the stamp must move WITH the run, not linger from the first one. Constraint 2 (the stamp must
    // not alter what was computed): gate/attention are also free to change here because a real
    // re-check WOULD have a new verdict, but nothing about the stamp write ITSELF forces that — it is
    // asserted separately below with gate/attention held constant.
    const runId2 = '11111111-0000-0000-0000-000000000002'
    await writeArtifactGate(c, {
      artifactId, runId: runId2, gate: 'pass', attention: 0,
      coverageJudgeOn: true, reviewerAutoOn: false, judgeVersion: 1, promptVersion: 1,
    })
    row = (await c.query(`select * from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
    assert.equal(row.run_id, runId2, 'the gate is REPLACED per artifact — history lives in check_result, not here')
    assert.equal(row.coverage_judge_on, true, 'the stamp must reflect the run that just wrote the row, not the first one')
    assert.equal(row.gate, 'pass')

    // Constraint 2, isolated: stamping with an UNCHANGED gate/attention must not alter them — the
    // stamp columns are the only thing this write path may be adding information to.
    const runId3 = '11111111-0000-0000-0000-000000000003'
    await writeArtifactGate(c, {
      artifactId, runId: runId3, gate: 'pass', attention: 0,
      coverageJudgeOn: true, reviewerAutoOn: true, judgeVersion: 1, promptVersion: 1,
    })
    row = (await c.query(`select * from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
    assert.equal(row.gate, 'pass', 'gate must be exactly what was passed in, unmodified by the stamp')
    assert.equal(row.attention_count, 0)
    assert.equal(row.reviewer_auto_on, true)

    // Override-clearing behavior (pre-existing, must survive the refactor into writeArtifactGate).
    await c.query(`update artifact_gate set override_by='someone', override_at=now(), override_reason='r' where artifact_id=$1`, [artifactId])
    await writeArtifactGate(c, {
      artifactId, runId: '11111111-0000-0000-0000-000000000004', gate: 'warn', attention: 1,
      coverageJudgeOn: false, reviewerAutoOn: false, judgeVersion: 1, promptVersion: 1,
    })
    row = (await c.query(`select * from artifact_gate where artifact_id=$1`, [artifactId])).rows[0]
    assert.equal(row.override_by, null, 'a new run must still clear a prior override, unchanged by this refactor')
  } finally { await c.end() }
})

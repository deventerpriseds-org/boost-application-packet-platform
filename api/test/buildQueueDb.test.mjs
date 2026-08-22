// The build queue against a REAL PostgreSQL — D35.
//
// Every rule here is about concurrency or crash recovery, and neither can be tested with a fake
// client: `for update skip locked` has no behaviour outside a real transaction, and "two workers
// raced for one job" needs two connections. A mocked pg would assert the SQL string I wrote, which
// is the shape of test that passes while production takes the same job twice.
//
// The cluster boot is shared with dimensionsDb.test.mjs, comment and all, because that file already
// learned the two ways this goes wrong (binaries present but nothing listening; a stale socket file
// outliving its postmaster).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import {
  enqueueBuild, claimNextBuild, finishBuild, abandonExhausted, getBuildJob, MAX_ATTEMPTS,
} from '../dist/functions/tests/buildQueue.js'
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
const OPP = '2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3'
const OWNER = 'von.ellis@enterpriseds.io'

// pgvector is not installed here; the rest of the schema executes for real.
const sql = () => SCHEMA_SQL
  .replace(/^create extension if not exists vector;/m, '-- stubbed')
  .replace(/vector\(1536\)/g, 'text')
  .replace(/.*using hnsw \(embedding vector_cosine_ops\).*\n/g, '')

let dbn = 0
async function freshDb() {
  const name = `bqt_${process.pid}_${++dbn}`
  const admin = new Client(CONN); await admin.connect()
  await admin.query(`drop database if exists ${name}`)
  await admin.query(`create database ${name}`)
  await admin.end()
  const open = async () => { const c = new Client({ ...CONN, database: name }); await c.connect(); return c }
  const c = await open()
  await c.query(sql())
  await c.query(`insert into opportunity (id, owner_email, company, role) values ($1,$2,'eMoney','SVP')`, [OPP, OWNER])
  return { c, open }
}

test('H:one-build-per-opportunity: a double-click queues ONE job, not two', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // Two builds of the same packet race each other writing the same artifacts and spend the model
  // budget twice. The partial unique index makes that impossible; `enqueueBuild` turns the loser
  // into "here is the build already running" rather than an error, because that is what the caller
  // actually asked for.
  const { c } = await freshDb()
  const [a, b] = await Promise.all([
    enqueueBuild(c, OPP, OWNER, true),
    enqueueBuild(c, OPP, OWNER, true),
  ])
  assert.equal(a.job.id, b.job.id, 'two concurrent requests produced two different jobs')
  assert.equal([a.created, b.created].filter(Boolean).length, 1, 'exactly one may report created')
  assert.equal((await c.query('select count(*)::int n from packet_build_job')).rows[0].n, 1)

  // A FINISHED job must not block the next build.
  const claimed = await claimNextBuild(c)
  assert.equal(claimed.id, a.job.id)
  assert.equal(await finishBuild(c, a.job.id, claimed.attempts, true, { built: 4 }), true)
  const next = await enqueueBuild(c, OPP, OWNER, false)
  assert.equal(next.created, true, 'a completed build blocks the next request')
  assert.notEqual(next.job.id, a.job.id)
  await c.end()
})

test('H:one-worker-per-job: two ticks firing together claim ONE job between them', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // `for update skip locked` is the whole reason this is SQL and not application logic. Two ticks
  // can fire in the same second; without it either both take the job — a duplicate three-minute
  // build and a duplicate model bill — or one blocks behind the other's transaction for the whole
  // build. Two SEPARATE connections, because on one connection there is no race to lose.
  const { c, open } = await freshDb()
  const w1 = await open(); const w2 = await open()
  await enqueueBuild(c, OPP, OWNER, true)

  const [j1, j2] = await Promise.all([claimNextBuild(w1), claimNextBuild(w2)])
  assert.equal([j1, j2].filter(Boolean).length, 1, 'both workers claimed the same job — duplicate build')
  const claimed = j1 || j2
  assert.equal(claimed.state, 'running')
  assert.equal(claimed.attempts, 1)

  // And a second tick with nothing pending takes nothing rather than re-running the live job.
  assert.equal(await claimNextBuild(w1), null, 'a running job was re-claimed while still in flight')
  for (const x of [c, w1, w2]) await x.end()
})

test('H:dead-worker-does-not-wedge-a-build: a stale claim is reclaimed, and only then', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // A worker that dies mid-build leaves the row in `running`. Nothing else frees it, and to the
  // owner a wedged job is indistinguishable from a slow one. But reclaiming too EAGERLY is the
  // worse bug — it steals a healthy three-minute build and runs it twice — so the window must
  // clear the real build time, and this asserts both halves.
  const { c, open } = await freshDb()
  const w = await open()
  await enqueueBuild(c, OPP, OWNER, true)
  await claimNextBuild(w)

  assert.equal(await claimNextBuild(w), null, 'a job claimed one moment ago was stolen')
  await c.query(`update packet_build_job set claimed_at = now() - interval '11 minutes'`)
  const again = await claimNextBuild(w)
  assert.ok(again, 'a job whose worker died was never reclaimed')
  assert.equal(again.attempts, 2, 'the retry must be counted, or it can loop forever')
  for (const x of [c, w]) await x.end()
})

test('H:failed-build-stops-retrying: attempts are bounded and the job says why', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // Retrying forever turns one broken opportunity into an unbounded model-spend loop on a timer
  // nobody watches. Once the attempts are gone the job must be REFUSED by the claim and then
  // marked failed — a row that is merely un-claimable sits in `running` looking active, and the
  // partial unique index would keep the owner from queueing a fresh build.
  const { c, open } = await freshDb()
  const w = await open()
  const { job } = await enqueueBuild(c, OPP, OWNER, true)
  await c.query(`update packet_build_job set state='running', attempts=$1, claimed_at = now() - interval '11 minutes'`, [MAX_ATTEMPTS])

  assert.equal(await claimNextBuild(w), null, 'an exhausted job was claimed again — retry loop')
  assert.equal(await abandonExhausted(c), 1, 'the exhausted job was not swept')
  const row = (await c.query('select state, error from packet_build_job where id=$1', [job.id])).rows[0]
  assert.equal(row.state, 'failed')
  assert.match(row.error, /did not finish after 3 attempt/, 'a bare "failed" is not something anyone can act on')

  // Failing it also unblocks the owner: the partial index only covers pending/running.
  assert.equal((await enqueueBuild(c, OPP, OWNER, false)).created, true)
  for (const x of [c, w]) await x.end()
})

test('H:job-read-is-owner-scoped: a job id is not a bearer token for someone else\'s build', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // `build-all` loads its opportunity with no owner predicate, and an in-process evidence call
  // shipped today without an ownership check on the reasoning that the caller was "past the auth
  // gate" — true of authentication, false of authorization. The job result carries the build's
  // warnings and content, so the read is scoped in the query rather than by the caller remembering.
  const { c } = await freshDb()
  const { job } = await enqueueBuild(c, OPP, OWNER, true)
  const claimed = await claimNextBuild(c)
  await finishBuild(c, job.id, claimed.attempts, true, { built: 4, warnings: ['something about this packet'] })

  assert.ok(await getBuildJob(c, job.id, OWNER), 'the owner cannot read their own job')
  assert.equal(await getBuildJob(c, job.id, 'someone.else@example.com'), null,
    'another owner read this build by guessing its id')
  await c.end()
})

test('H:poisoned-job-does-not-block-the-queue: one exhausted job must not stop every build', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // The attempt cap was applied OUTSIDE the claim's subquery, which does not skip the exhausted job
  // — it makes the whole UPDATE match nothing. So the oldest poisoned row returned `null`, which
  // reads as "queue empty", while every newer build for every owner sat behind it untouched and no
  // error appeared anywhere. `abandonExhausted` clears such a row, but only if the tick happens to
  // run first; correctness must not depend on the caller's ordering, so this claims WITHOUT sweeping.
  const { c, open } = await freshDb()
  const w = await open()
  const OPP2 = '9f9c370a-4ac9-441e-b58e-02e3ffcf669e'
  await c.query(`insert into opportunity (id, owner_email, company, role) values ($1,$2,'Trinnex','VP')`, [OPP2, OWNER])

  const poisoned = await enqueueBuild(c, OPP, OWNER, true)
  await c.query(`update packet_build_job set state='running', attempts=$1, claimed_at = now() - interval '11 minutes'
                  where id=$2`, [MAX_ATTEMPTS, poisoned.job.id])
  const fresh = await enqueueBuild(c, OPP2, OWNER, true)   // newer, and perfectly healthy

  const got = await claimNextBuild(w)
  assert.ok(got, 'the queue went silent behind one exhausted job')
  assert.equal(got.id, fresh.job.id, 'the claim returned the poisoned job instead of the healthy one')
  for (const x of [c, w]) await x.end()
})

test('H:zombie-worker-cannot-clobber-a-reclaimed-build: the finish is fenced', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // The ten-minute lease is a heuristic, not a guarantee: "silent for ten minutes" is not "dead", so
  // a hung worker can still be alive when its job is reclaimed. Then two workers hold one job and,
  // unfenced, whichever finishes LAST wins — including a zombie writing a stale `done` over the
  // fresh run. The fence is what makes correctness independent of the lease being right.
  const { c, open } = await freshDb()
  const a = await open(), b = await open()
  await enqueueBuild(c, OPP, OWNER, true)
  const first = await claimNextBuild(a)                      // worker A, attempt 1
  await c.query(`update packet_build_job set claimed_at = now() - interval '11 minutes'`)
  const second = await claimNextBuild(b)                     // worker B reclaims, attempt 2
  assert.equal(second.id, first.id)
  assert.equal(second.attempts, first.attempts + 1)

  assert.equal(await finishBuild(a, first.id, first.attempts, true, { built: 4 }), false,
    'the zombie closed a job it no longer owns')
  const row = (await c.query('select state, result from packet_build_job where id=$1', [first.id])).rows[0]
  assert.equal(row.state, 'running', 'a stale worker overwrote a live build')
  assert.equal(row.result, null)

  assert.equal(await finishBuild(b, second.id, second.attempts, true, { built: 4 }), true,
    'the live worker was fenced out of its own job')
  for (const x of [c, a, b]) await x.end()
})

test('H:failed-build-keeps-its-evidence: a failure records its payload, not just a message', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // This queue exists because build diagnostics were being lost to a gateway timeout, and a PARTIAL
  // build — some artifacts written, one thrown — is the case where that diagnosis matters most. An
  // earlier version set `result = null` whenever ok was false, throwing the evidence away in exactly
  // the case it was built to preserve; 500 characters of `String(e)` cannot carry a discarded-section
  // list of several thousand.
  const { c } = await freshDb()
  await enqueueBuild(c, OPP, OWNER, true)
  const job = await claimNextBuild(c)
  const partial = { built: 3, failed: 1, warnings: ['portfolio: 7446 characters discarded'] }
  assert.equal(await finishBuild(c, job.id, job.attempts, false, partial, new Error('slides threw')), true)

  const row = (await c.query('select state, result, error from packet_build_job where id=$1', [job.id])).rows[0]
  assert.equal(row.state, 'failed')
  assert.ok(row.result, 'the failed build discarded its payload — the reason this queue exists')
  assert.equal(row.result.warnings[0], 'portfolio: 7446 characters discarded')
  assert.match(row.error, /slides threw/)
  await c.end()
})

test('H:rebuild-is-not-silently-downgraded: regen must not be swallowed by a live job', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // "Rebuild" is the owner reacting to something wrong in the document. Handing them back a live
  // NON-regen job gave them a job id to poll, a success at the end of it, and the same stale
  // artifacts — the repo's "no dead UI" rule failing in its most deceptive form, a control that
  // appears to work and does nothing. A job that has not started can just be promoted; one already
  // running cannot, so the caller is told instead of being left to assume.
  const { c, open } = await freshDb()
  const queued = await enqueueBuild(c, OPP, OWNER, false)
  assert.equal(queued.job.regen, false)

  const promoted = await enqueueBuild(c, OPP, OWNER, true)
  assert.equal(promoted.job.id, queued.job.id)
  assert.equal(promoted.promoted, true, 'a queued build was not upgraded to the rebuild that was asked for')
  assert.equal(promoted.job.regen, true)

  // Once it is RUNNING the promotion is no longer honest — the build already read its inputs.
  const w = await open()
  await c.query(`update packet_build_job set regen = false where id=$1`, [queued.job.id])
  await claimNextBuild(w)
  const late = await enqueueBuild(c, OPP, OWNER, true)
  assert.equal(late.job.id, queued.job.id)
  assert.equal(late.promoted, undefined)
  assert.equal(late.regenPending, true, 'the owner was told a rebuild started when a cached build is what is running')
  for (const x of [c, w]) await x.end()
})

test('H:enqueue-is-owner-scoped: a job may not be filed against another owner\'s opportunity', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // `packet_build_job.owner_email` is whatever the caller resolved to, and `getBuildJob` scopes its
  // read to that recorded value — so a job filed by the wrong owner against a real opportunity is
  // readable by the person who filed it. An unauthenticated request resolves to the demo workspace
  // and passes `requireWrite`, which is precisely how it would be filed. The queue's invariant is
  // that a job's owner and its opportunity's owner never disagree, and this is where that holds.
  const { c } = await freshDb()
  const stranger = await enqueueBuild(c, OPP, 'attacker@example.com', true)
  assert.equal(stranger.job, null, 'a cross-owner build was queued')
  assert.equal((await c.query('select count(*)::int n from packet_build_job')).rows[0].n, 0,
    'a cross-owner enqueue left a row behind')

  // And an unknown opportunity is the same answer, not a foreign-key 500.
  const missing = await enqueueBuild(c, '00000000-0000-0000-0000-000000000000', OWNER, true)
  assert.equal(missing.job, null)
  assert.match(missing.error, /not found/)
  await c.end()
})

test('the queue is declared in SCHEMA_SQL and EXPECTED_TABLES, not only created by a test', { skip: !HAVE_PG && 'no PostgreSQL' }, async () => {
  // D21's lesson: a table registered in one place and not the others is the one that does not exist
  // in production. This file would pass happily against a table only IT creates.
  const schema = readFileSync(new URL('../src/functions/tests/schema.ts', import.meta.url), 'utf8')
  assert.match(schema, /create table if not exists packet_build_job/)
  assert.match(schema, /'packet_build_job'/, 'the queue is missing from EXPECTED_TABLES')
  assert.match(schema, /create unique index if not exists pbj_one_live_per_opp/,
    'without the partial unique index a double-click queues two builds')
})

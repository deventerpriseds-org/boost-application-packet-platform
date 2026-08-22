// CAN A PACKET ACTUALLY SHIP? — the reachability guard, against a REAL PostgreSQL.
//
// WHY THIS FILE EXISTS, and it cost two days.
//
// The product was measured three separate times as `0 ready, 0 sent, 0 approved` over 39 packets
// and 1,937 opportunities, and every time that was read as "the owner has not used the review flow
// yet." It was not usage. `ready` was UNREACHABLE, twice over:
//
//   1. every packet carries a `video` artifact, the build loop SKIPS video (`if (!metaFor(a.type))
//      continue`), and `recomputePacket` required EVERY artifact approved — so `allApproved` could
//      never be true, and `Send packet →` renders only when ready;
//   2. approval calls `approvalBlock`, which refuses without an `artifact_gate` row, and NOTHING IN
//      THE BUILD PATH RAN CHECKS — `evaluateArtifact`'s only callers were a manual per-artifact
//      route and the remediation loop. Live: `cover` 0 check rows, `portfolio` 0, `compact_resume`
//      0, of 39 artifacts each.
//
// Both are invisible to every test that asserts a function's behaviour in isolation, because each
// piece was correct on its own. Only EXECUTING the whole transition catches them.
//
// THE RULE THIS ENCODES: a funnel stage that reads exactly zero across its entire history is a
// STRUCTURAL claim, not a usage signal. Prove the transition into it can happen. That proof is this
// file, and it is a real state machine run against a real database rather than an assertion about
// source text — because the first blocker was a `.every()` over the wrong list and the second was a
// missing function call, and no amount of reading either file revealed them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { recomputePacket } from '../dist/functions/tests/appPackets.js'
import { approvalBlock } from '../dist/functions/tests/appChecks.js'
import { SCHEMA_SQL } from '../dist/functions/tests/schema.js'

const { Client } = pg
const PGBIN = '/usr/lib/postgresql/16/bin'
const SOCK = '/var/tmp/p84pg'
const PGDATA = `${SOCK}/data`

// Shared with buildQueueDb.test.mjs / dimensionsDb.test.mjs, comment and all: the two ways this
// goes wrong are binaries present but nothing listening, and a stale socket outliving its postmaster.
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

// pgvector is not installed in this container; stub it exactly as CLAUDE.md documents, so the rest
// of the schema still executes for real.
function schemaSql() {
  return SCHEMA_SQL
    .replace(/^create extension if not exists vector;/m, '-- stubbed')
    .replace(/vector\(1536\)/g, 'text')
    .split('\n').filter(l => !/using hnsw \(embedding vector_cosine_ops\)/.test(l)).join('\n')
}

// The five artifact types the product actually creates for every packet. `video` is the one the
// build loop skips, and it is deliberately present here — a fixture that omitted it would be a
// fixture that could not reproduce the bug.
const TYPES = ['resume', 'compact_resume', 'cover', 'portfolio', 'video']
// What the builder produces, and therefore what readiness may require. Mirrors `metaFor`.
const BUILDABLE = ['resume', 'compact_resume', 'cover', 'portfolio']

async function seed(c) {
  await c.query(`delete from opportunity where owner_email = 'shippath@test.local'`)
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage) values ('shippath@test.local','Acme','VP Eng','enriched') returning id`)).rows[0].id
  const pkt = (await c.query(`insert into packet (opp_id) values ($1) returning id`, [opp])).rows[0].id
  const arts = {}
  for (const t of TYPES) {
    arts[t] = (await c.query(`insert into artifact (packet_id, type) values ($1,$2) returning id`, [pkt, t])).rows[0].id
  }
  return { opp, pkt, arts }
}

test('H:ship-path-is-reachable: a packet CAN reach `ready` with the artifacts a build produces', { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { pkt, arts } = await seed(c)

    // Nothing approved yet: not ready. (Guards against a vacuous pass where everything reads ready.)
    assert.notEqual(await recomputePacket(c, pkt), 'ready', 'a packet with nothing approved must not be ready')

    // Approve exactly what a build produces. `video` stays `todo`, because the build never touches
    // it — this is the real end state of a completed, fully-reviewed packet.
    for (const t of BUILDABLE) {
      await c.query(`update artifact set status='approved' where id=$1`, [arts[t]])
    }

    const status = await recomputePacket(c, pkt)
    assert.equal(status, 'ready',
      'A fully reviewed packet cannot reach `ready`, so `Send packet →` never renders and NOTHING ' +
      'CAN EVER SHIP. This is the defect that produced 0 ready / 0 sent across 39 packets: an ' +
      'artifact the builder never builds (video) was holding the packet back forever.')
  } finally { await c.end() }
})

test('H:every-required-artifact-can-be-approved: approval is not deadlocked for any required type', { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { arts } = await seed(c)

    // Ground state: with no gate row, approval is blocked. That is CORRECT and deliberate — absent
    // evidence is never a pass. It is only a deadlock if nothing ever writes the row.
    for (const t of BUILDABLE) {
      const b = await approvalBlock(c, arts[t])
      assert.equal(b.blocked, true, `${t}: expected approval blocked before any checks have run`)
    }

    // Once the gate row exists and passes, approval must be possible for EVERY required type. If a
    // type can never get a gate row, `allApproved` can never be true and `ready` is unreachable —
    // which is exactly what was live: cover/portfolio/compact_resume each had 0 check rows over 39
    // artifacts, and approving the cover returned HTTP 409 `no checks have been run`.
    for (const t of BUILDABLE) {
      await c.query(
        `insert into artifact_gate (artifact_id, run_id, gate, attention_count)
         values ($1, gen_random_uuid(), 'pass', 0)
         on conflict (artifact_id) do update set gate='pass', attention_count=0`, [arts[t]])
      const b = await approvalBlock(c, arts[t])
      assert.equal(b.blocked, false,
        `${t}: approval is still blocked with a passing gate — this type can never be approved, so ` +
        'the packet can never be ready and nothing can ship')
    }
  } finally { await c.end() }
})

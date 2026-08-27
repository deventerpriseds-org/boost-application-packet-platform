/**
 * The SEEDER, against a REAL Postgres.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FAKE. The first version of these five tests ran `seedSkillBank`
 * against a hand-written fake client, and an independent verifier proved THREE OF THE FIVE WERE
 * INERT - they passed with the defect installed:
 *
 *   - remove `on conflict ... do update` -> real Postgres raises `duplicate key value violates
 *     unique constraint` on every re-seed. The fake downgraded that fatal exception to a silent
 *     no-op, so the idempotence guard stayed green.
 *   - remove `returning (xmax = 0)` -> a first seed into an empty bank reports {inserted:0,
 *     updated:2}. The fake synthesised `was_insert` from its own bookkeeping and never read
 *     RETURNING at all.
 *   - remove `category = excluded.category` -> a renamed category never updates. The fake rebuilt
 *     the whole row from `params` without parsing which columns the `set` list actually names.
 *
 * The lesson, which is the same one twice in this module's history: **a test double must implement
 * the BEHAVIOUR under test, not return a plausible shape.** A fake that answers correctly regardless
 * of its input is a mock of the conclusion. For SQL semantics the only double that qualifies is
 * Postgres, and this container ships 16.13 - so there is no excuse for a fake here.
 *
 * Skips (rather than fails) when no server can be started, exactly as shipPathDb.test.mjs does.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { seedSkillBank } from '../dist/functions/tests/appSkillBank.js'
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
const ADMIN = { host: SOCK, port: 55432, user: 'postgres', database: 'postgres' }

/**
 * OWN DATABASE, not the shared `postgres` one, and this is not tidiness.
 *
 * The first version connected to `postgres` like its sibling db-tests do, and applying the full
 * SCHEMA_SQL from a fifth file broke `H:ready-counts-an-overridden-fail-only-in-advisory-mode` in
 * shipPathDb.test.mjs - node runs test FILES concurrently, so concurrent DDL churn on one database
 * disrupts a test mid-run. Measured: 885/1 with this file present, 881/0 without it.
 *
 * A separate database removes the shared state entirely rather than trying to sequence access to it.
 */
const DB = 'skillbank_test'
const CONN = { host: SOCK, port: 55432, user: 'postgres', database: DB }

function schemaSql() {
  return SCHEMA_SQL
    .replace(/^create extension if not exists vector;/m, '-- stubbed')
    .replace(/vector\(1536\)/g, 'text')
    .split('\n').filter(l => !/using hnsw \(embedding vector_cosine_ops\)/.test(l)).join('\n')
}

const OWNER = 'skillbank@test.local'

// Applied ONCE for the file, not per test: SCHEMA_SQL is large and idempotent, and re-running it
// five times is the DDL churn that broke a sibling file.
let ready = null
async function ensureDb() {
  if (ready) return ready
  ready = (async () => {
    const a = new Client(ADMIN)
    await a.connect()
    try { await a.query(`create database ${DB}`) } catch { /* already there */ }
    await a.end()
    const c = new Client(CONN)
    await c.connect()
    await c.query(schemaSql())
    await c.end()
  })()
  return ready
}

async function fresh() {
  await ensureDb()
  const c = new Client(CONN)
  await c.connect()
  await c.query(`delete from skill_bank_entry where owner_email = $1`, [OWNER])
  return c
}
const entry = (term, key, origins, category = null) => ({ term, key, origins, category })

test('H:skill-bank-seed-is-idempotent', { skip: !HAVE_PG && 'no postgres' }, async () => {
  // The property that makes re-seeding safe as a button rather than a migration. Against a real
  // server, dropping `on conflict do update` does not silently no-op - it RAISES.
  const c = await fresh()
  try {
    const pool = { entries: [
      entry('Enterprise Governance', 'enterprise governance', ['skills1']),
      entry('Predictive Analytics', 'predictive analytics', ['relevantProficiencies'], 'Data Analytics and AI'),
    ] }
    const first = await seedSkillBank(c, OWNER, pool, 'sha1')
    assert.deepEqual([first.inserted, first.updated], [2, 0], 'a first seed into an EMPTY bank must report inserts')
    const second = await seedSkillBank(c, OWNER, pool, 'sha1')
    assert.deepEqual([second.inserted, second.updated], [0, 2], 'a re-seed must update, not insert')
    const n = (await c.query(`select count(*)::int n from skill_bank_entry where owner_email=$1`, [OWNER])).rows[0].n
    assert.equal(n, 2, 'the bank grew on a re-seed')
  } finally { await c.end() }
})

test('H:skill-bank-origin-is-the-STORE-and-source_ref-is-the-FIELD', { skip: !HAVE_PG && 'no postgres' }, async () => {
  // The CHECK allows master_context|portfolio_slide. Writing a FIELD name into origin violates it at
  // runtime - a 500 no fake would ever surface, because a fake has no CHECK.
  const c = await fresh()
  try {
    await seedSkillBank(c, OWNER, { entries: [entry('X', 'x', ['skills1', 'softHardSkillsPool'])] }, null)
    const r = (await c.query(`select origin, source_ref from skill_bank_entry where owner_email=$1`, [OWNER])).rows
    assert.equal(r.length, 1, 'a term from two fields became two rows - the picker would show it twice')
    assert.equal(r[0].origin, 'master_context')
    assert.equal(r[0].source_ref, 'skills1,softHardSkillsPool', 'every field the term came from must be recorded')
  } finally { await c.end() }
})

test('H:skill-bank-category-is-written-AND-updated-on-re-seed', { skip: !HAVE_PG && 'no postgres' }, async () => {
  // Two claims, and the second is the one the fake could not see: `category = excluded.category` in
  // the DO UPDATE list. Without it a re-categorised skill keeps the old label forever.
  const c = await fresh()
  try {
    await seedSkillBank(c, OWNER, { entries: [entry('Predictive Analytics', 'predictive analytics', ['relevantProficiencies'], 'Data Analytics and AI')] }, null)
    let row = (await c.query(`select category from skill_bank_entry where owner_email=$1`, [OWNER])).rows[0]
    assert.equal(row.category, 'Data Analytics and AI')
    await seedSkillBank(c, OWNER, { entries: [entry('Predictive Analytics', 'predictive analytics', ['relevantProficiencies'], 'Execution and Operations')] }, null)
    row = (await c.query(`select category from skill_bank_entry where owner_email=$1`, [OWNER])).rows[0]
    assert.equal(row.category, 'Execution and Operations', 'a re-categorised skill kept its old category')
  } finally { await c.end() }
})

test('H:skill-bank-NEVER-deletes-it-reports-orphans', { skip: !HAVE_PG && 'no postgres' }, async () => {
  // A term vanishing from the pool has two causes and only one means "the owner removed this skill".
  // The other is a drifted reword key - a BUG - and deleting banked skills over a bug is unrecoverable.
  const c = await fresh()
  try {
    await seedSkillBank(c, OWNER, { entries: [entry('Gone From Source', 'gone from source', ['skills1'])] }, null)
    const out = await seedSkillBank(c, OWNER, { entries: [entry('Still Here', 'still here', ['skills1'])] }, null)
    assert.deepEqual(out.orphans, ['Gone From Source'])
    const labels = (await c.query(`select label from skill_bank_entry where owner_email=$1 order by label`, [OWNER])).rows.map(r => r.label)
    assert.deepEqual(labels, ['Gone From Source', 'Still Here'], 'the orphan was DELETED - a banked skill of the owner is gone')
  } finally { await c.end() }
})

test('H:skill-bank-refuses-a-blank-label-rather-than-hitting-the-CHECK', { skip: !HAVE_PG && 'no postgres' }, async () => {
  // The table has `check (length(btrim(label)) > 0)`. Reaching it means a 500 mid-seed with some rows
  // already written; refusing here means the rest of the seed still lands. Only a real CHECK proves it.
  const c = await fresh()
  try {
    const out = await seedSkillBank(c, OWNER, { entries: [
      entry('   ', '', ['skills1']),
      entry('Real', 'real', ['skills1']),
    ] }, null)
    assert.equal(out.inserted, 1)
    const labels = (await c.query(`select label from skill_bank_entry where owner_email=$1`, [OWNER])).rows.map(r => r.label)
    assert.deepEqual(labels, ['Real'])
  } finally { await c.end() }
})

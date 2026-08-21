// THE FRESH-VS-UPGRADED PARITY TEST.
//
// One assertion, one whole class of defect: a database built by APPLYING this file to an existing
// one must end up identical to a database built from this file alone. If it does not, something in
// the file reaches a fresh install and never reaches production.
//
// WHY A GENERAL TEST AND NOT ANOTHER H-CASE. This failure has now been shipped THREE times in a
// single session, by three different authors, with the trap already written down in CLAUDE.md and
// already guarded by H39/H39b:
//
//   * P3, twice — a composite FK whose UNIQUE target was added by a later ALTER, and an index
//     naming a column an ALTER added 350 lines further down.
//   * P3 again — three renamed columns and a new one added INSIDE `create table if not exists`,
//     so the migration exited 0, reported clean, and left the table unchanged. Two more of the
//     same class hid behind it (a CHECK that differed between fresh and upgraded, leaving the
//     evidence-removal guard OFF on exactly the databases it protects).
//   * me — `artifact_score.judged_requirement_ids`, added inline, absent on every existing
//     database, exit 0, silently.
//
// H39/H39b encode "a statement naming a column added by an idempotent ALTER must come after that
// ALTER". That is one SHAPE of the failure. It cannot see a column with NO alter at all, which is
// the shape that got through — a guard that reads as covering the area while missing the common
// case is worse than an absent one, because nobody looks again.
//
// This test knows nothing about shapes. It asks the only question that matters and lets the
// database answer it.
//
// Skipped, loudly, when no local PostgreSQL is available: a schema test that silently no-ops is
// absent evidence read as a pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
const { Client } = pg

const PGBIN = '/usr/lib/postgresql/16/bin'
const SOCK = '/var/tmp/edsparity'
const PGDATA = `${SOCK}/data`
const PORT = 55470

/** Boot a throwaway cluster. Checks the SOCKET, not just the binary — those are different claims. */
function bootPg() {
  if (!existsSync(`${PGBIN}/initdb`)) return false
  try {
    // A socket FILE outlives the postmaster — after a container restore this directory still
    // held .s.PGSQL.55470 with nothing behind it, and returning true here reported a healthy
    // cluster while every query failed ECONNREFUSED. Ask pg_ctl, not the filesystem.
    if (existsSync(`${SOCK}/.s.PGSQL.${PORT}`)) {
      try {
        execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} status"`, { stdio: 'ignore' })
        return true
      } catch { /* stale socket: rebuild below */ }
    }
    execSync(`rm -rf ${SOCK} && mkdir -p ${PGDATA} && chown -R postgres ${SOCK}`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/initdb -D ${PGDATA} -U postgres -A trust"`, { stdio: 'ignore' })
    // `-l` is required: without it pg_ctl inherits stdout and never returns.
    execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} -o '-p ${PORT} -k ${SOCK} -c listen_addresses=' -l ${SOCK}/pg.log -w start"`, { stdio: 'ignore' })
    return existsSync(`${SOCK}/.s.PGSQL.${PORT}`)
  } catch { return false }
}
const HAVE_PG = bootPg()
if (!HAVE_PG) console.error('!! schemaParity.test.mjs SKIPPED — no local PostgreSQL. Migration parity is UNVERIFIED, not verified.')
const t = HAVE_PG ? test : test.skip

const CONN = { host: SOCK, port: PORT, user: 'postgres', database: 'postgres' }

/** pgvector is not installable here; the substitution is irrelevant to structural parity. */
const usable = (sql) => sql
  .replace(/create extension if not exists vector;/gi, '')
  .replace(/vector\(1536\)/g, 'text')
  .replace(/create index if not exists opp_embedding_hnsw[^;]*;/gi, '')

/** SCHEMA_SQL at a git ref — read from the FILE, never from a build of the current branch. */
function schemaAt(ref) {
  const src = execSync(`git show ${ref}:api/src/functions/tests/schema.ts`, { encoding: 'utf8' })
  const marker = 'export const SCHEMA_SQL = `'
  const i = src.indexOf(marker)
  return usable(src.slice(i + marker.length, src.indexOf('\n`;', i)))
}

async function build(name, scripts) {
  const admin = new Client(CONN); await admin.connect()
  await admin.query(`drop database if exists ${name}`)
  await admin.query(`create database ${name}`)
  await admin.end()
  const c = new Client({ ...CONN, database: name }); await c.connect()
  for (const sql of scripts) await c.query(sql)
  return c
}

/** Every column and every constraint, as the database itself reports them. */
async function shape(c) {
  const cols = (await c.query(`
    select table_name||'.'||column_name||' '||data_type||' null='||is_nullable||
           ' default='||coalesce(column_default,'NONE') as d
      from information_schema.columns
     where table_schema='public' order by 1`)).rows.map(r => r.d)
  const cons = (await c.query(`
    select cl.relname||' :: '||co.conname||' :: '||pg_get_constraintdef(co.oid) as d
      from pg_constraint co join pg_class cl on cl.oid = co.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' order by 1`)).rows.map(r => r.d)
  const idx = (await c.query(`
    select indexdef as d from pg_indexes where schemaname='public' order by 1`)).rows.map(r => r.d)
  return { cols, cons, idx }
}

t('a database built by UPGRADE is identical to one built FRESH', async () => {
  const head = usable(
    execSync('node -e "process.stdout.write(require(\'./dist/functions/tests/schema.js\').SCHEMA_SQL)"',
      { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }))
  const prev = schemaAt('origin/main')

  const fresh = await build('parity_fresh', [head])
  // The database production actually has: the previous schema, then this file applied on top.
  const upgraded = await build('parity_upgraded', [prev, head])

  const a = await shape(fresh)
  const b = await shape(upgraded)
  await fresh.end(); await upgraded.end()

  for (const kind of ['cols', 'cons', 'idx']) {
    const missing = a[kind].filter(x => !b[kind].includes(x))
    const extra = b[kind].filter(x => !a[kind].includes(x))
    assert.deepEqual(missing, [],
      `${kind}: present on a FRESH database and MISSING after upgrade — these never reach production. ` +
      `Almost always a column or constraint added inside "create table if not exists", which is ` +
      `skipped on a table that already exists. The fix is an idempotent ALTER, not a reorder.`)
    assert.deepEqual(extra, [],
      `${kind}: present after upgrade and absent on a FRESH database — a new install would not ` +
      `enforce what production enforces, which is the same divergence pointing the other way.`)
  }
})

t('the previous schema is real, so the comparison is not vacuous', async () => {
  // If `origin/main`'s SCHEMA_SQL came back empty, both databases would be built from the same
  // script and the test above would pass by construction — measuring nothing.
  const prev = schemaAt('origin/main')
  assert.ok(prev.length > 5000, `origin/main's SCHEMA_SQL read as ${prev.length} chars — the ref lookup is broken`)
  assert.ok(/create table if not exists/i.test(prev), 'the previous schema has no tables in it')
})

// The coverage judge's SQL, against a REAL database.
//
// WHY THIS EXISTS SEPARATELY FROM coverageRun.test.mjs. Those tests drive the runner with a fake
// client, which proves the logic and proves NOTHING about the SQL: a misspelled column, a parameter
// in the wrong position, or a constraint the writer violates all pass a fake and fail in production.
// The cache is the part that must execute — its whole value is that a second run finds what the
// first one wrote, and only a real table can show that.
//
//   cd api && node --test test/coverageDb.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { runCoverageJudge } from '../dist/functions/tests/appCoverage.js'
import { SCHEMA_SQL } from '../dist/functions/tests/schema.js'

const { Client } = pg
const PGBIN = '/usr/lib/postgresql/16/bin'
const SOCK = '/var/tmp/covpg'
const PGDATA = `${SOCK}/data`

function bootPg() {
  if (!existsSync(`${PGBIN}/initdb`)) return false
  try {
    if (existsSync(`${SOCK}/.s.PGSQL.55433`)) {
      try { execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} status"`, { stdio: 'ignore' }); return true } catch {}
    }
    execSync(`rm -rf ${SOCK} && mkdir -p ${PGDATA} && chown -R postgres ${SOCK}`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/initdb -D ${PGDATA} -U postgres -A trust"`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} -o '-p 55433 -k ${SOCK} -c listen_addresses=' -l ${SOCK}/pg.log -w start"`, { stdio: 'ignore' })
    return existsSync(`${SOCK}/.s.PGSQL.55433`)
  } catch { return false }
}
const HAVE_PG = bootPg()
const CONN = { host: SOCK, port: 55433, user: 'postgres', database: 'postgres' }
const schemaSql = () => SCHEMA_SQL
  .replace(/^create extension if not exists vector;/m, '-- stubbed')
  .replace(/vector\(1536\)/g, 'text')
  .split('\n').filter(l => !/using hnsw \(embedding vector_cosine_ops\)/.test(l)).join('\n')

const OWNER = 'coverage@test.local'
// The owner's live Trinnex pair: the requirement coversIn scores 0.60 and calls absent, against the
// summary sentence that answers it in different words.
const SUMMARY = 'Visionary technology leader with a robust track record in driving enterprise transformations and aligning engineering strategies with business objectives.'
const REQ = { seq: 15, kind: 'must_have', verbatim: 'Ability to align engineering strategy with business goals', item_text: '' }
const QUOTE = 'aligning engineering strategies with business objectives'

async function seed(c) {
  await c.query(`delete from opportunity where owner_email=$1`, [OWNER])
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage)
     values ($1,'Trinnex','VP Engineering','enriched') returning id`, [OWNER])).rows[0].id
  const packet = (await c.query(`insert into packet (opp_id) values ($1) returning id`, [opp])).rows[0].id
  const artifact = (await c.query(
    `insert into artifact (packet_id, type) values ($1,'resume') returning id`, [packet])).rows[0].id
  return { opp, artifact }
}

const input = (opp, artifact, fetchJson, thresholds = { coverageJudge: true }) => ({
  oppId: opp, artifactId: artifact, type: 'resume', pkg: { ResumeSummary: SUMMARY },
  requirements: [REQ], thresholds, model: 'gpt-4o', fetchJson,
})

const covered = async () => ({ choices: [{ message: { content: JSON.stringify({ verdicts: [
  { seq: 15, covered: true, basis: 'synonym', quote: QUOTE, why: 'the same claim in different words' },
] }) } }] })

test('H:a-verdict-survives-the-run-that-made-it',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // THE CACHE, EXECUTED. A second run over byte-identical text must find the first run's row and
  // spend nothing — the property that makes a model safe on the gate path, because a model asked
  // twice may answer differently and a gate that flips between two runs of unchanged code is worse
  // than one that is wrong consistently. A fake client cannot show this; only the table can.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { opp, artifact } = await seed(c)

    let asked = 0
    const first = await runCoverageJudge(c, input(opp, artifact, async (...a) => { asked++; return covered(...a) }))
    assert.equal(first.calls, 1, 'the first run asks')
    assert.equal(first.verdicts.get(15).covered, true)

    const row = (await c.query(`select * from requirement_coverage where opp_id=$1`, [opp])).rows[0]
    assert.ok(row, 'THE SQL EXECUTES — a wrong column name or a misplaced parameter dies here, not in production')
    assert.equal(row.requirement_text, REQ.verbatim, 'keyed on the TEXT, which survives re-extraction')
    assert.equal(row.field, 'ResumeSummary')
    assert.equal(row.quote, QUOTE)
    assert.equal(SUMMARY.slice(row.char_start, row.char_end), QUOTE,
      'the stored offsets index the stored quote in the real document')
    assert.equal(row.covered, true)
    assert.equal(row.lexical_covered, false,
      'and coversIn still says no — the 0.60 near-miss, both readings kept so the disagreement is queryable')
    assert.equal(row.model, 'gpt-4o')

    const second = await runCoverageJudge(c, input(opp, artifact, async (...a) => { asked++; return covered(...a) }))
    assert.equal(asked, 1, 'THE SECOND RUN NEVER ASKS — it reads what the first one wrote')
    assert.equal(second.calls, 0)
    assert.equal(second.cacheHits, 1)
    assert.equal(second.verdicts.get(15).covered, true, 'and answers identically')
    assert.equal(second.verdicts.get(15).why, 'the same claim in different words')
  } finally { await c.end() }
})

test('H:one-edited-character-is-a-different-document',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // The stale-answer failure the key exists to prevent, executed rather than reasoned about. An
  // edited document must MISS — a hit would look exactly like a correct answer while describing
  // prose that no longer exists.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { opp, artifact } = await seed(c)
    await runCoverageJudge(c, input(opp, artifact, covered))

    const edited = { ...input(opp, artifact, covered), pkg: { ResumeSummary: SUMMARY.replace('Visionary', 'Seasoned') } }
    let asked = 0
    const r = await runCoverageJudge(c, { ...edited, fetchJson: async (...a) => { asked++; return covered(...a) } })
    assert.equal(asked, 1, 'the edited document is re-judged rather than served from the cache')
    assert.equal(r.cacheHits, 0)
    assert.equal((await c.query(`select count(*)::int n from requirement_coverage where opp_id=$1`, [opp])).rows[0].n, 2,
      'both readings are kept — the old document was judged, and so was the new one')
  } finally { await c.end() }
})

test('H:a-verdict-the-database-refuses-never-becomes-a-finding',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  // The table's CHECKs are the last line, and they must not take the run down with them. A write
  // that the database rejects is recorded as a failure and the run still returns the answer it
  // computed — a storage problem is not a finding about the owner's document.
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { opp, artifact } = await seed(c)
    // A quote that IS in the document, so the parser accepts it, written into a table whose
    // artifact_id does not exist — the FK refuses.
    const r = await runCoverageJudge(c, {
      ...input(opp, artifact, covered), artifactId: '00000000-0000-0000-0000-000000000000',
    })
    assert.equal(r.verdicts.get(15).covered, true, 'the run still answers')
    assert.equal(r.failures.length, 1)
    assert.match(r.failures[0].error, /^write: /)
    assert.equal((await c.query(`select count(*)::int n from requirement_coverage where opp_id=$1`, [opp])).rows[0].n, 0)
  } finally { await c.end() }
})

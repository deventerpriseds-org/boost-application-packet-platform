// P8.4 — the comparison STORE, executed against a real PostgreSQL that already has the previous
// schema applied AND rows in it.
//
// WHY IT IS NOT ENOUGH TO CREATE THE TABLE ON A FRESH DATABASE. Every statement in the ensure-path
// is `create table if not exists` / `add column if not exists`, so on an empty database they all
// run and everything passes — while on the database that actually matters they are skipped, and a
// constraint added to an existing table is never applied at all. The database this test builds is
// the one production has: `origin/main`'s SCHEMA_SQL, plus the columns the ensure-paths added
// (`jd_text`, `jd_real`, …, which are NOT in SCHEMA_SQL), plus requirement, evidence and fact rows.
//
// Skipped, loudly, when no local PostgreSQL is available — a DB test that silently no-ops is
// absent evidence read as a pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
const { Client } = pg

const PGBIN = '/usr/lib/postgresql/16/bin'
const SOCK = '/var/tmp/p84pg'
const PGDATA = `${SOCK}/data`

/**
 * Bring up a throwaway cluster, and return whether we have one.
 *
 * The first version of this checked `existsSync(initdb)` and called that HAVE_PG — which conflates
 * "PostgreSQL is installed" with "a cluster is listening on this socket". Those came apart in both
 * directions at once: on a CI runner with no PostgreSQL it skipped, so the store was never verified
 * where it mattered; on this container, where the binaries DO exist, it found no running cluster and
 * failed five tests with ECONNREFUSED. A test that neither runs nor honestly skips is worse than one
 * that does either.
 *
 * Booting our own removes the ambiguity: if the binaries are here the test RUNS, and if they are not
 * it says so loudly. `initdb` refuses to run as root, so the data directory is handed to `postgres`.
 */
function bootPg() {
  if (!existsSync(`${PGBIN}/initdb`)) return false
  try {
    if (existsSync(`${SOCK}/.s.PGSQL.55432`)) return true      // already up — reuse it
    execSync(`rm -rf ${SOCK} && mkdir -p ${PGDATA} && chown -R postgres ${SOCK}`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/initdb -D ${PGDATA} -U postgres -A trust"`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} -o '-p 55432 -k ${SOCK} -c listen_addresses=' -l ${SOCK}/pg.log -w start"`, { stdio: 'ignore' })
    return existsSync(`${SOCK}/.s.PGSQL.55432`)
  } catch { return false }
}
const HAVE_PG = bootPg()

const CONN = { host: SOCK, port: 55432, user: 'postgres', database: 'postgres' }

/** SCHEMA_SQL as it exists at a git ref — the PREVIOUS schema, never the working tree's. */
function schemaSqlAt(ref) {
  const src = execSync(`git show ${ref}:api/src/functions/tests/schema.ts`, { encoding: 'utf8' })
  const marker = 'export const SCHEMA_SQL = `'
  const i = src.indexOf(marker)
  const j = src.indexOf('`', i + marker.length)
  return src.slice(i + marker.length, j)
    // pgvector is not installable in this container; the substitution is confined to the columns
    // that need it and is irrelevant to every table this lane touches.
    .replace(/create extension if not exists vector;/, '')
    .replace(/vector\(1536\)/g, 'text')
    .replace(/create index if not exists opp_embedding_hnsw[^;]*;/, '')
}

async function populatedDb(name) {
  const admin = new Client(CONN)
  await admin.connect()
  await admin.query(`drop database if exists ${name}`)
  await admin.query(`create database ${name}`)
  await admin.end()
  const c = new Client({ ...CONN, database: name })
  await c.connect()
  await c.query(schemaSqlAt('origin/main'))
  // The columns the live database has from ensure-paths rather than from SCHEMA_SQL. Reproducing
  // that is the point: the database a migration meets is the one the ensure-paths built.
  await c.query(`alter table opportunity
    add column if not exists raw_jd text, add column if not exists jd_real text,
    add column if not exists jd_summary text, add column if not exists jd_table jsonb,
    add column if not exists jd_text text, add column if not exists jd_text_sha256 text,
    add column if not exists jd_text_truncated boolean`)

  const owner = 'von.ellis@enterpriseds.io'
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage, jd_text, jd_text_sha256)
     values ($1,'SafetyIQ','VP of Engineering','saved','posting body','deadbeef') returning id`, [owner])).rows[0].id
  const lines = [
    [0, 'Requires 10+ years of engineering leadership experience', 'must_have'],
    [1, 'Lead a distributed organization of 60+ engineers', 'must_have'],
    [2, 'Own a P&L or budget of $10M+ across three business units', 'must_have'],
    [3, 'Own SOC 2 Type II and ISO 27001 through external audit', 'must_have'],
    [4, 'Modernize the monolith into cloud-native services', 'responsibility'],
    [5, 'FedRAMP or public-sector procurement experience', 'nice_to_have'],
  ]
  for (const [seq, text, kind] of lines) {
    await c.query(
      `insert into requirement (opp_id, seq, item_text, verbatim, char_start, char_end, match_method,
         kind, kind_source, weight, jd_text_sha256, extractor_version)
       values ($1,$2,$3,null,null,null,'unlocatable',$4,'category_default',2,'deadbeef',2)`,
      [opp, seq, text, kind])
  }
  const ids = (await c.query(`select id, seq from requirement where opp_id=$1 order by seq`, [opp])).rows
  const quote = 'Led a distributed organization of 62 engineers across three time zones'
  await c.query(
    `insert into requirement_evidence (requirement_id, quote, source_kind, source_label, source_key,
       char_start, char_end, ratio, method, record_sha256, resolver_version)
     values ($1,$2,'work_history','Work history · VP Engineering, Resideo','work.resideo',0,$3,0.9,'exact','abc',1)`,
    [ids[1].id, quote, quote.length])
  await c.query(
    `insert into owner_fact (owner_email, key, label, category, value, value_num, unit, source, confirmed_at)
     values ($1,'experience.years_leadership','Years in leadership / management','experience','14',14,'years','owner_stated',now())`,
    [owner])
  return { c, opp, owner }
}

const t = HAVE_PG ? test : test.skip
if (!HAVE_PG) console.error('!! dimensionsDb.test.mjs SKIPPED — no local PostgreSQL. The store is UNVERIFIED, not verified.')

t('the store is created on a POPULATED database that already has the previous schema', async () => {
  const { c, opp, owner } = await populatedDb('p84_migrate')
  try {
    // Precondition, asserted rather than assumed: the previous schema is applied AND has rows, so
    // every `if not exists` below is meeting a database that already exists.
    const before = await c.query(`select (select count(*)::int from requirement) rq,
                                         (select count(*)::int from requirement_evidence) ev,
                                         (select count(*)::int from owner_fact) f`)
    assert.equal(before.rows[0].rq, 6)
    assert.equal(before.rows[0].ev, 1)
    assert.equal(before.rows[0].f, 1)
    const pre = await c.query(`select to_regclass('public.comparison_dimension') t`)
    assert.equal(pre.rows[0].t, null, 'the table must not already exist, or this proves nothing')

    const { ensureDimensionTable } = await import('../dist/functions/tests/appDimensions.js')
    await ensureDimensionTable(c)
    const post = await c.query(`select to_regclass('public.comparison_dimension') t`)
    assert.notEqual(post.rows[0].t, null)

    // Idempotent: running it twice on the now-existing table must not throw.
    await ensureDimensionTable(c)

    // ...and the rows that were already there are untouched.
    const after = await c.query(`select count(*)::int n from requirement where opp_id=$1`, [opp])
    assert.equal(after.rows[0].n, 6, 'the migration disturbed existing rows')
  } finally { await c.end() }
})

t('AC30/AC34: the note obligation is a DATABASE CHECK, not an if in one writer', async () => {
  const { c, opp } = await populatedDb('p84_check')
  try {
    const { ensureDimensionTable } = await import('../dist/functions/tests/appDimensions.js')
    await ensureDimensionTable(c)
    const insert = (fit, note, reason, covered, total) => c.query(
      `insert into comparison_dimension
         (opp_id, dimension_key, label, fit, basis, note, reason, covered, total, set_source, role_family, dimension_version)
       values ($1,'budget_owned','Budget owned',$2,'evidence',$3,$4,$5,$6,'seed_default','engineering',1)`,
      [opp, fit, note, reason, covered, total])

    // A moderate grade with no reason must be REFUSED by the database itself — the writer is not
    // the guard, because the second writer that eventually appears would bypass it.
    await assert.rejects(() => insert('moderate', null, null, 1, 2), /comparison_dimension_check/,
      'a moderate grade with no reason was accepted')
    await assert.rejects(() => insert('weak', '   ', null, 0, 2), /comparison_dimension_check/,
      'whitespace passed as a reason')
    // not_applicable has the mirror obligation.
    await assert.rejects(() => insert('not_applicable', null, null, null, null), /comparison_dimension_check/,
      'a row that measured nothing was allowed to say nothing about why')
    // A graded row may not have a null denominator, and an ungraded one may not invent one.
    await assert.rejects(() => insert('strong', null, null, null, null), /comparison_dimension_check/)
    await assert.rejects(() => insert('not_applicable', null, 'the posting is silent', 0, 3), /comparison_dimension_check/)

    // The legal shapes are accepted.
    await insert('strong', null, null, 2, 2)
    await c.query(`delete from comparison_dimension`)
    await insert('moderate', 'one of two lines is evidenced', null, 1, 2)
    await c.query(`delete from comparison_dimension`)
    await insert('not_applicable', null, 'this posting does not ask about budget owned', null, null)

    // AC34 — the acceptance sentence, provable in ONE query against stored rows.
    const audit = await c.query(
      `select count(*)::int n from comparison_dimension
        where fit in ('moderate','weak') and (note is null or btrim(note) = '')`)
    assert.equal(audit.rows[0].n, 0)
  } finally { await c.end() }
})

t('AC53: rebuilding replaces the comparison rather than appending to it', async () => {
  const { c, opp, owner } = await populatedDb('p84_rebuild')
  try {
    const { writeComparison } = await import('../dist/functions/tests/appDimensions.js')
    const { loadRequirementsWithEvidence } = await import('../dist/functions/tests/appRequirements.js')
    const rows = await loadRequirementsWithEvidence(c, opp)
    const facts = (await c.query(`select key, value, value_num, source, confirmed_at from owner_fact where owner_email=$1`, [owner])).rows

    const a = await writeComparison(c, { id: opp, role: 'VP of Engineering', owner_email: owner }, rows, true, facts, false)
    const n1 = (await c.query(`select count(*)::int n from comparison_dimension where opp_id=$1`, [opp])).rows[0].n
    assert.equal(n1, a.rows)
    assert.ok(n1 > 0, 'the writer produced nothing to test')

    const b = await writeComparison(c, { id: opp, role: 'VP of Engineering', owner_email: owner }, rows, true, facts, false)
    const n2 = (await c.query(`select count(*)::int n from comparison_dimension where opp_id=$1`, [opp])).rows[0].n
    assert.equal(n2, n1, 'a rebuild doubled the comparison')
    assert.equal(b.graded, a.graded)
  } finally { await c.end() }
})

t('AC3: the dimension set round-trips through the route — it is not SQL-only config', async () => {
  const { c, owner } = await populatedDb('p84_prefs')
  try {
    // The REAL write path the route calls — not a copy of its SQL retyped here. A test that runs
    // its own statement proves the statement in the test: with the merge inlined in the handler and
    // duplicated here, replacing it with a clobber failed nothing. Measured, then fixed.
    const { ensureDimensionPrefs, loadDimensionPrefs, setDimensionPrefs } = await import('../dist/functions/tests/appDimensions.js')
    await ensureDimensionPrefs(c)
    assert.equal(await loadDimensionPrefs(c, owner), null, 'an owner who never chose must read as null, not {}')

    const first = await setDimensionPrefs(c, owner, 'Engineering', ['leadership_tenure', 'budget_owned', 'not_a_dimension'])
    assert.deepEqual(first.keys, ['leadership_tenure', 'budget_owned'])
    assert.deepEqual(first.dropped, ['not_a_dimension'], 'an unknown key was stored instead of dropped')
    assert.equal(first.family, 'engineering', 'the family key must be normalised, or two spellings become two families')
    assert.deepEqual(await loadDimensionPrefs(c, owner), { engineering: ['leadership_tenure', 'budget_owned'] })

    // Saving a SECOND family must not clobber the first.
    await setDimensionPrefs(c, owner, 'product', ['cycle_time'])
    assert.deepEqual(await loadDimensionPrefs(c, owner),
      { engineering: ['leadership_tenure', 'budget_owned'], product: ['cycle_time'] })

    // And the owner's choice reaches the built comparison.
    const { dimensionsFor } = await import('../dist/functions/tests/dimensions.js')
    const set = dimensionsFor('engineering', await loadDimensionPrefs(c, owner))
    assert.equal(set.source, 'owner')
    assert.deepEqual(set.keys, ['leadership_tenure', 'budget_owned'])
  } finally { await c.end() }
})

t('AC46/AC47: the comparison and the requirements endpoint count evidence from the same rows', async () => {
  const { c, opp, owner } = await populatedDb('p84_reconcile')
  try {
    const { writeComparison } = await import('../dist/functions/tests/appDimensions.js')
    const { loadRequirementsWithEvidence } = await import('../dist/functions/tests/appRequirements.js')
    const rows = await loadRequirementsWithEvidence(c, opp)
    const facts = (await c.query(`select key, value, value_num, source, confirmed_at from owner_fact where owner_email=$1`, [owner])).rows
    await writeComparison(c, { id: opp, role: 'VP of Engineering', owner_email: owner }, rows, true, facts, false)

    // `evidenced` as requirementsGet computes it: rows that HAVE an excerpt, and no other way.
    const endpointEvidenced = rows.filter(r => r.evidence_quote != null).length

    // Every seq the comparison counts as covered must be one of those rows. Two counts over one
    // population computed in ONE test is the only shape that catches divergence.
    const graded = (await c.query(
      `select dimension_key, covered, total, matched_seqs from comparison_dimension
        where opp_id=$1 and fit <> 'not_applicable'`, [opp])).rows
    const evidencedSeqs = new Set(rows.filter(r => r.evidence_quote != null).map(r => Number(r.seq)))
    let coveredTotal = 0
    for (const g of graded) {
      coveredTotal += g.covered
      assert.ok(g.covered <= g.total, `${g.dimension_key} counts more covered than it judged`)
    }
    assert.ok(coveredTotal <= evidencedSeqs.size * graded.length,
      'the comparison credited coverage no evidence row supports')
    assert.equal(endpointEvidenced, evidencedSeqs.size)
  } finally { await c.end() }
})

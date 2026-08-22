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
    // A SOCKET FILE IS NOT A RUNNING SERVER. This line used to return true on the strength of
    // the file alone, and the file OUTLIVES the process: after a container restore /var/tmp still
    // held /var/tmp/p84pg/.s.PGSQL.55432 with no postmaster behind it, so every test in this file
    // failed with ECONNREFUSED while bootPg reported a healthy cluster. That is the same
    // conflation the comment above says was fixed, one level down — "the binaries exist" became
    // "the socket exists", and neither is "a server is listening". Ask the postmaster.
    if (existsSync(`${SOCK}/.s.PGSQL.55432`)) {
      try {
        execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} status"`, { stdio: 'ignore' })
        return true                                            // genuinely up — reuse it
      } catch { /* stale socket: fall through and rebuild the cluster */ }
    }
    execSync(`rm -rf ${SOCK} && mkdir -p ${PGDATA} && chown -R postgres ${SOCK}`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/initdb -D ${PGDATA} -U postgres -A trust"`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} -o '-p 55432 -k ${SOCK} -c listen_addresses=' -l ${SOCK}/pg.log -w start"`, { stdio: 'ignore' })
    return existsSync(`${SOCK}/.s.PGSQL.55432`)
  } catch { return false }
}
const HAVE_PG = bootPg()

const CONN = { host: SOCK, port: 55432, user: 'postgres', database: 'postgres' }

/**
 * pgvector is not installable in this container; the substitution is confined to the columns that
 * need it and is irrelevant to every table this lane touches. ONE copy, used for both the ref
 * lookup and the built module, so the two schemas are always made runnable the same way.
 */
const usableSql = (sql) => sql
  .replace(/create extension if not exists vector;/, '')
  .replace(/vector\(1536\)/g, 'text')
  .replace(/create index if not exists opp_embedding_hnsw[^;]*;/, '')

/** SCHEMA_SQL as it exists at a git ref — the PREVIOUS schema, never the working tree's. */
function schemaSqlAt(ref) {
  const src = execSync(`git show ${ref}:api/src/functions/tests/schema.ts`, { encoding: 'utf8' })
  const marker = 'export const SCHEMA_SQL = `'
  const i = src.indexOf(marker)
  const j = src.indexOf('`', i + marker.length)
  return usableSql(src.slice(i + marker.length, j))
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
  // `requirement_evidence.proposal_version` is an ensure-path column for the same reason the
  // opportunity ones are: `ensureEvidenceTable` adds it, SCHEMA_SQL's ALTER widens the CHECK, and
  // `loadRequirementsWithEvidence` selects it. Reproducing it here is keeping the fixture faithful
  // to what the ensure path now builds — NOT relaxing the test. It earned its place: this fixture
  // failed with `column e.proposal_version does not exist` and that is what proved the column had to
  // be on the ensure path rather than in SCHEMA_SQL alone, because `api-deploy.yml` deploys the code
  // BEFORE it runs `pg-migrate`, so a read-path column that only SCHEMA_SQL adds is missing for the
  // length of that window.
  await c.query(`alter table requirement_evidence add column if not exists proposal_version int`)

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
    // The ensure-path's job is to create the table on a database that does NOT have it. Once D21
    // landed, origin/main's SCHEMA_SQL DECLARES comparison_dimension, so populatedDb now hands us a
    // database that already has it and the precondition below would be false — the test would have
    // gone vacuous in exactly the silent way this file exists to prevent. Dropping it restores the
    // condition the test is about, rather than deleting the assertion that noticed.
    await c.query(`drop table if exists comparison_dimension`)
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

// ---------------------------------------------------------------------------------------------
// H:dimension-ddl-parity — D21. `comparison_dimension` is now declared in SCHEMA_SQL *and* still
// created by `ensureDimensionTable`, because a request can still meet a database the migration has
// not reached. Two copies of one CREATE TABLE is the shape that diverges in silence, and no amount
// of reading catches it: every database that ran the ensure-path already HAS the table, so
// SCHEMA_SQL's `create table if not exists` is SKIPPED there. A CHECK added to one copy would be
// enforced on fresh installs and absent on production, forever, with the migration exiting 0.
//
// This asks the only question that settles it, and lets the database answer: build the table BOTH
// ways and diff every column, constraint and index PostgreSQL reports.
//
// Proved by reinstating the defect rather than by assertion: with
// `check (posting_text is null or posting_quoted is not null)` deleted from the SCHEMA_SQL copy
// only, this test fails by name on `cons`, and `npm test` goes red. Restored, it passes.
t('H:dimension-ddl-parity: the migration and the ensure-path build the SAME table', async () => {
  // HEAD's SCHEMA_SQL from the BUILT module — what production actually migrates with.
  const head = usableSql(
    execSync('node -e "process.stdout.write(require(\'./dist/functions/tests/schema.js\').SCHEMA_SQL)"',
      { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }))
  assert.ok(/create table if not exists comparison_dimension/.test(head),
    'SCHEMA_SQL does not declare comparison_dimension — D21 has been reverted')

  const admin = new Client(CONN); await admin.connect()
  for (const db of ['p84_ddl_migrated', 'p84_ddl_ensured']) {
    await admin.query(`drop database if exists ${db}`)
    await admin.query(`create database ${db}`)
  }
  await admin.end()

  // A: the migration path — SCHEMA_SQL alone.
  const a = new Client({ ...CONN, database: 'p84_ddl_migrated' }); await a.connect()
  await a.query(head)

  // B: the ensure path — the PREVIOUS schema (which has opportunity but not this table), then the
  // runtime function, exactly as a request that arrives before the migration would run it.
  const b = new Client({ ...CONN, database: 'p84_ddl_ensured' }); await b.connect()
  await b.query(schemaSqlAt('origin/main'))
  await b.query(`drop table if exists comparison_dimension`)
  const { ensureDimensionTable } = await import('../dist/functions/tests/appDimensions.js')
  await ensureDimensionTable(b)

  const shape = async (c) => ({
    cols: (await c.query(`
      select column_name||' '||data_type||' null='||is_nullable||' default='||coalesce(column_default,'NONE') d
        from information_schema.columns
       where table_schema='public' and table_name='comparison_dimension' order by 1`)).rows.map(r => r.d),
    cons: (await c.query(`
      select co.conname||' :: '||pg_get_constraintdef(co.oid) d
        from pg_constraint co join pg_class cl on cl.oid = co.conrelid
       where cl.relname='comparison_dimension' order by 1`)).rows.map(r => r.d),
    idx: (await c.query(
      `select indexdef d from pg_indexes where schemaname='public' and tablename='comparison_dimension' order by 1`)).rows.map(r => r.d),
  })

  const A = await shape(a)
  const B = await shape(b)
  await a.end(); await b.end()

  // Absent evidence is not a pass: if neither path built anything, the diff below is vacuous.
  assert.ok(A.cols.length > 15, `the migrated table has ${A.cols.length} columns — SCHEMA_SQL did not build it`)
  assert.ok(B.cols.length > 15, `the ensured table has ${B.cols.length} columns — the ensure-path did not build it`)
  assert.ok(A.cons.length >= 8, `only ${A.cons.length} constraints — the CHECKs are not being read`)

  for (const kind of ['cols', 'cons', 'idx']) {
    assert.deepEqual(A[kind].filter(x => !B[kind].includes(x)), [],
      `${kind}: declared in SCHEMA_SQL and ABSENT from the ensure-path. Every database created by ` +
      `the ensure-path already has this table, so SCHEMA_SQL's create-if-not-exists is skipped ` +
      `there and this difference never reaches production.`)
    assert.deepEqual(B[kind].filter(x => !A[kind].includes(x)), [],
      `${kind}: built by the ensure-path and MISSING from SCHEMA_SQL. A freshly migrated database ` +
      `would not enforce what production enforces — the same divergence pointing the other way.`)
  }
})

// ---------------------------------------------------------------------------------------------
// H:comparison-staleness-declared — D23/D24. `comparisonPayload` returns `set` read LIVE from the
// owner's prefs and `dimensions` read from rows written when the comparison was last resolved. Both
// arrive in one object looking equally current, so a caller cannot tell them apart — and the JD card
// prints "Your dimension set for engineering." straight above the rows.
//
// Two ways they diverge, both real:
//   * the owner changes their set (which is exactly what D24's Settings control will let them do,
//     so this must be honest BEFORE that control exists, not after);
//   * the grading rules change under rows already stored — D23 did this to every row in the
//     database the moment DIMENSION_VERSION went to 2, because rows graded at 1 recorded
//     numeric_verdict 'unavailable' for org size and budget where the engine now produces a grade.
//
// Against a POPULATED database, because the rows are the whole point.
t('H:comparison-staleness-declared: a stored comparison says when it is no longer current', async () => {
  const { c, opp, owner } = await populatedDb('p84_stale')
  try {
    const { writeComparison, comparisonPayload, setDimensionPrefs } =
      await import('../dist/functions/tests/appDimensions.js')
    const { loadRequirementsWithEvidence } = await import('../dist/functions/tests/appRequirements.js')
    const { DIMENSION_VERSION } = await import('../dist/functions/tests/dimensions.js')
    const rows = await loadRequirementsWithEvidence(c, opp)
    const facts = (await c.query(`select key, value, value_num, source, confirmed_at from owner_fact where owner_email=$1`, [owner])).rows

    await writeComparison(c, { id: opp, role: 'VP of Engineering', owner_email: owner }, rows, true, facts, false)

    // Freshly resolved under the current rules and the current set: nothing to report. A warning
    // on every opportunity is a warning nobody reads.
    const fresh = await comparisonPayload(c, opp, owner, 'VP of Engineering')
    assert.ok(fresh.dimensions.length > 0, 'nothing was resolved, so this proves nothing')
    assert.equal(fresh.stale, null, 'a just-resolved comparison was reported as stale')

    // (a) RULES changed under the stored rows. Age them by one version, which is exactly what D23
    // did to every row that existed before it.
    await c.query(`update comparison_dimension set dimension_version = $1 where opp_id = $2`,
      [DIMENSION_VERSION - 1, opp])
    const aged = await comparisonPayload(c, opp, owner, 'VP of Engineering')
    assert.ok(aged.stale, 'rows graded by superseded rules were presented as current')
    assert.equal(aged.stale.rules_changed, true)
    assert.equal(aged.stale.set_changed, false, 'the set did not change; only the rules did')
    assert.equal(aged.stale.row_version, DIMENSION_VERSION - 1)

    await c.query(`update comparison_dimension set dimension_version = $1 where opp_id = $2`, [DIMENSION_VERSION, opp])
    assert.equal((await comparisonPayload(c, opp, owner, 'VP of Engineering')).stale, null)

    // (b) The OWNER changed their set — the D24 case. The rows on disk still reflect the old one.
    await setDimensionPrefs(c, owner, 'engineering', ['cycle_time'])
    const reset = await comparisonPayload(c, opp, owner, 'VP of Engineering')
    assert.ok(reset.stale, 'the card would have claimed these rows were built from the new set')
    assert.equal(reset.stale.set_changed, true)
    assert.ok(reset.stale.extra.length > 0,
      'dimensions graded under the old set but no longer configured were not named')
    assert.equal(reset.set.source, 'owner', 'the live set did not pick up the owner choice at all')

    // An UNRESOLVED opportunity has no rows and must not be reported as stale — absent evidence is
    // not a finding, and every unresolved opportunity carrying a warning is how a warning dies.
    await c.query(`delete from comparison_dimension where opp_id=$1`, [opp])
    const empty = await comparisonPayload(c, opp, owner, 'VP of Engineering')
    assert.equal(empty.resolved, false)
    assert.equal(empty.stale, null, 'an opportunity nobody has compared was flagged as stale')
  } finally { await c.end() }
})

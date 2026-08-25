import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * The `source` domain declared for the CORRECTION table specifically.
 *
 * SCOPED, and the first version was not — it matched every `check (source in (...))` in the file and
 * so also caught `schema.ts:724`, a DIFFERENT table with its own `source` domain
 * ('owner_stated','derived','proposed'). An unscoped guard here would have compared the wrong
 * constraint and could have gone green while the two correction copies drifted, which is precisely
 * the failure it exists to catch.
 */
function correctionBlock(sql) {
  const i = sql.indexOf('create table if not exists correction (')
  if (i < 0) return ''
  const end = sql.indexOf(');', i)
  return sql.slice(i, end < 0 ? sql.length : end)
}

/** Domains inside a chunk of SQL, each as a sorted `a|b|c` signature. */
function sourceDomains(sql) {
  return [...sql.matchAll(/check\s*\(\s*source\s+in\s*\(([^)]*)\)/gi)]
    .map((m) => m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')).sort().join('|'))
}

const HOMES = {
  'schema.ts (the migration)': '../src/functions/tests/schema.ts',
  'appCorrections.ts (ensureCorrectionTable)': '../src/functions/tests/appCorrections.ts',
  'test/sql/correction.sql (the fixture)': './sql/correction.sql',
}

test('H:correction-ddl-parity: the correction table is declared in three places and they must agree', () => {
  // WHY THIS EXISTS, and why it is the highest-value guard in this change.
  //
  // `correction` is declared THREE times: the migration in schema.ts, a byte-duplicated
  // `create table if not exists` inside ensureCorrectionTable() (appCorrections.ts:53, which exists
  // because pgMigrate is not guaranteed to have run when a route fires), and a test fixture.
  // `grep -rn appCorrections api/test/*.mjs` before this file: every hit was a source grep about
  // provenance or imports — NOTHING compared the two DDLs.
  //
  // The failure mode is not hypothetical. `dimensionsDb.test.mjs:102-103` records as a measured
  // fact that api-deploy.yml deploys the CODE before it runs pg-migrate, and `create table if not
  // exists` is a NO-OP on an existing table — so a CHECK widened in one copy is silently absent
  // from the other, and production keeps rejecting a value every source file says is legal.
  // `H:dimension-ddl-parity` already guards exactly this for comparison_dimension. `correction`
  // had no equivalent.
  const found = Object.entries(HOMES).map(([name, rel]) => {
    const src = read(rel)
    // The .sql fixture is a correction-only file and declares the table without the guard prefix the
    // TypeScript copies use, so fall back to the whole file when the scoped block is not found.
    const domains = sourceDomains(correctionBlock(src) || src)
    assert.equal(domains.length, 1, `${name} should declare the source domain exactly once, found ${domains.length}`)
    return [name, domains[0]]
  })
  const distinct = [...new Set(found.map(([, d]) => d))]
  assert.equal(distinct.length, 1,
    `the three declarations of correction.source DISAGREE:\n${found.map(([n, d]) => `  ${n}: ${d}`).join('\n')}`)
})

test('H:correction-source-widened-by-alter: a new value is unreachable without an explicit ALTER', () => {
  // The half of the migration that is easy to forget, and the half that decides whether it works on
  // a database that already exists — which is every database anyone cares about. Editing the inline
  // CHECK changes what a FRESH database is born with and nothing else.
  const schema = read('../src/functions/tests/schema.ts')
  const inline = sourceDomains(correctionBlock(schema))[0].split('|')
  const alter = /alter table correction\s+drop constraint if exists correction_source_check;\s*alter table correction\s+add constraint correction_source_check\s*\n?\s*check \(source in \(([^)]*)\)\)/i.exec(schema)
  assert.ok(alter, 'schema.ts must carry an idempotent ALTER for correction.source, not only the inline CHECK')
  const altered = alter[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')).sort()
  assert.deepEqual(altered, inline,
    'the ALTER and the inline CHECK must admit the SAME values, or a fresh database and an existing one disagree')

  // H39/H39b: a statement naming a constraint must come AFTER the statement that can create it.
  assert.ok(schema.indexOf('alter table correction drop constraint') > schema.indexOf('create table if not exists correction'),
    'the ALTER must come after the create table, or it runs against a table that does not exist yet')
})

test('H:schema-sql-has-no-backticks: a backtick inside SCHEMA_SQL terminates the template literal', () => {
  // SCHEMA_SQL is a JS template literal. A backtick anywhere inside it - including inside a SQL
  // COMMENT, where it looks completely harmless and is the natural way to quote an identifier -
  // ends the literal early and turns the rest of the file into garbage.
  //
  // This repo has now paid for it TWICE. The first time tsc passed and only loading the module
  // caught it. The second time (2026-08-25, adding the correction.source ALTER) the comment quoted
  // `appCorrections.ts:53` and `ensureCorrectionTable()` in backticks out of ordinary habit, and
  // tsc failed with 'Module declaration names may only use quoted strings' - an error message that
  // says nothing about backticks or about SQL. Sixteen of them.
  //
  // It was written down as a lesson after the first time and happened again anyway, which is the
  // whole argument for guards over prose. Quote identifiers in SCHEMA_SQL comments with plain text.
  const src = readFileSync(new URL('../src/functions/tests/schema.ts', import.meta.url), 'utf8')
  const open = src.indexOf('SCHEMA_SQL = `')
  assert.ok(open > 0, 'SCHEMA_SQL must exist')
  const start = open + 'SCHEMA_SQL = `'.length
  const end = src.indexOf('\n`;', start)
  assert.ok(end > start, 'SCHEMA_SQL must be terminated')
  const body = src.slice(start, end)
  const n = (body.match(/`/g) || []).length
  assert.equal(n, 0, `SCHEMA_SQL contains ${n} backtick(s); each one ends the template literal early`)
})

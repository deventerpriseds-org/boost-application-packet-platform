# Constraint proofs, executed

`correction.sql` is the P8.1 ledger table. `correction-constraints.probe.sql` inserts one legitimate
row and six defective ones and asserts exactly one survives.

**Why this is SQL and not a unit test.** These are database constraints. A TypeScript test can only
prove that the writer we have today happens not to produce a bad row; the constraint has to prove
that no writer ever can. And the difference is not theoretical — see below.

## Run it

```bash
D=/var/tmp/pgcorr; rm -rf $D; mkdir -p $D; chown postgres:postgres $D
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -A trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-k $D -p 5439 -c listen_addresses=' -l $D/log start"
# seed with main's real schema, minus the one extension this container lacks
node -e "require('fs').writeFileSync('$D/main-schema.sql', require('./api/dist/functions/tests/schema.js').SCHEMA_SQL)"
# strip ONLY the vector extension: uuid-ossp and pg_trgm ARE available, and dropping uuid-ossp
# makes every `default uuid_generate_v4()` fail and seeds ZERO tables.
psql ... -f $D/main-schema.sql      # 24 tables
psql ... -v ON_ERROR_STOP=1 -f api/test/sql/correction.sql
psql ... -f api/test/sql/correction-constraints.probe.sql
```

`ON_ERROR_STOP=1` matters: without it `psql` reports success having skipped every statement after
the first error.

## What executing it found that reading it did not

**`unique (artifact_id, merge_field, applied_seq, run_id)` did not work.** In Postgres NULL is
distinct from NULL in a UNIQUE constraint, so with `run_id` NULL — every correction applied outside a
remediation loop, which is the common case — the constraint permits unlimited duplicates. Probe 6
inserted a byte-exact duplicate of probe 1 and the table held 2 rows. The DDL reads as obviously
correct. `unique nulls not distinct` (PG 15+) is the fix.

**The first probe run proved nothing at all.** `packet` takes `opp_id`, not `opportunity_id`, so the
fixture never inserted, the legitimate row failed on its FK, and *zero* rows survived — while four
CHECK constraints did fire, which made the output look like a pass. A rejection-only probe with no
positive control cannot tell "the constraint worked" from "nothing was ever inserted". The
`survived = 1` assertion at the end exists for exactly that reason: it fails both ways.

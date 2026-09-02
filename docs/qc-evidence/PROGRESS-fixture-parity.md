# PROGRESS — fixture parity: make the UI fixture answer the same question production does

Working file, appended as I go. Branch: `claude/eds-skills-setup-summary-ngpaos` (== origin/main 2a11db8).
Scope constraint honoured: **no `app/src` or `api/src` behaviour is changed.** Files touched are
`.github/workflows/fixture-refresh.yml`, `scripts/build-fixtures.mjs`, and the test suite.

## Step 0 — are the two defects real, or already fixed?

Read (ground truth, not the write-up):

- `api/src/functions/tests/appChecks.ts` `artifactChecksGet` — the LIVE route.
- `.github/workflows/fixture-refresh.yml` — the fixture SQL.
- `scripts/build-fixtures.mjs` — the mapper.
- `app/src/screens/AssetGateDrawer.jsx` + `app/src/assetGate.js` — the CLIENT that reads the keys.

**Live route, verbatim (`appChecks.ts` ~386-400):**

```ts
const g = (await client.query(`select * from artifact_gate where artifact_id=$1`, [art.id])).rows[0] || null
const results = g
  ? (await client.query(`select * from check_result where artifact_id=$1 and run_id=$2 order by check_key`, [art.id, g.run_id])).rows
  : []
const score = g
  ? (await client.query(`select * from artifact_score where artifact_id=$1 and run_id=$2`, [art.id, g.run_id])).rows[0] || null
  : null
const history = (await client.query(
  `select composite, band, must_have_coverage, computed_at from artifact_score
    where artifact_id=$1 order by computed_at desc limit 10`, [art.id])).rows
```

Response assembly (same function): `{ artifactId, gate, attention, advisory, computedAt, override,
corrections, score, history, results, engines:{deterministic,reviewer} }`.

**Fixture SQL today (`fixture-refresh.yml:74-76`):**

```sql
'checks', (select coalesce(json_agg(row_to_json(cr)), '[]'::json)
           from check_result cr
           where cr.artifact_id in (select id from artifact where packet_id = '$PKT')),
```

No `run_id` predicate — **§17d confirmed REAL, still present.**
No `artifact_score` key anywhere in the file (`grep -c artifact_score fixture-refresh.yml` = 0)
and `build-fixtures.mjs` `checkResultFor()` sets no `score`/`history` —
**§17f confirmed REAL, still present.**

Neither defect is already fixed. Proceeding.

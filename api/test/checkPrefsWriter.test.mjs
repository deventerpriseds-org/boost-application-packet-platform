// The `chk_*` settings writer — D:chk-settings-have-no-writer.
//
// Fourteen per-owner settings were READ by production and written by nothing, so every one of them
// was a constant wearing a settings-shaped costume. The fix is one writer for the whole family,
// which means the writer itself is now the thing that must not be wrong: it takes column names from
// a whitelist and values from a request, and that is exactly the shape that becomes an injection
// surface if the two are ever confused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPrefColumns, writeCheckPrefs } from '../dist/functions/tests/checkPrefs.js'

/** Records every statement so a test can assert what SQL was actually built. */
function spyClient() {
  const q = []
  return { q, async query(sql, params) { q.push([String(sql), params]); return { rows: [] } } }
}
const updateOf = (c) => (c.q.find(([s]) => /^update owner_search_prefs set/.test(s.trim())) || [null, null])

test('the whitelist is derived and covers every setting production reads', () => {
  const cols = checkPrefColumns()
  assert.ok(cols.length >= 12, `only ${cols.length} columns derived — the derivation has gone stale`)
  // The four that matter most, each for its own reason.
  const names = cols.map(c => c.column)
  assert.ok(names.includes('chk_evidence_escalate'), 'the escalation toggle must be settable')
  assert.ok(names.includes('chk_evidence_bullet_run'), 'the citation width the owner may want reverted')
  assert.ok(names.includes('chk_evidence_threshold'), 'the coverage threshold')
  // Types come from the DDL, not from a guess.
  assert.equal(cols.find(c => c.column === 'chk_evidence_escalate').type, 'boolean')
  assert.equal(cols.find(c => c.column === 'chk_evidence_threshold').type, 'numeric')
  assert.equal(cols.find(c => c.column === 'chk_evidence_bullet_run').type, 'int')
  // ONLY chk_* — the writer must not be able to reach the rest of the table.
  for (const c of cols) assert.match(c.column, /^chk_/, `${c.column} is not a check setting`)
})

test('H:settings-writer-takes-names-from-the-whitelist-not-the-request', async () => {
  // THE INJECTION CASE. Column names cannot be parameterised in SQL, so they are interpolated — and
  // the only thing that makes that safe is that the interpolated string is the WHITELIST ENTRY that
  // matched, never the key the caller sent. Every one of these is a key an attacker would try.
  const c = spyClient()
  const written = await writeCheckPrefs(c, 'owner@example.com', {
    'chk_evidence_bullet_run': 1,
    'updated_at=now(), owner_email': 'x',
    'chk_evidence_bullet_run=1; drop table requirement--': 3,
    'target_geo_ids': ['{}'],
    'temp_hot_hours': 1,
    '__proto__': 9,
    'chk_nonexistent_knob': 5,
  })
  assert.deepEqual(written, ['chk_evidence_bullet_run'], 'only the real column may be written')
  const [sql, params] = updateOf(c)
  assert.ok(sql, 'an update must have been issued')
  assert.match(sql, /set chk_evidence_bullet_run=\$2, updated_at=now\(\) where owner_email=\$1/)
  assert.ok(!/drop table|target_geo_ids|temp_hot_hours|__proto__/.test(sql), `unsafe SQL built: ${sql}`)
  assert.deepEqual(params, ['owner@example.com', 1])
})

test('values are coerced by the column\'s declared type, and junk is ignored rather than stored', async () => {
  // A settings writer that accepts anything is how a threshold becomes NaN and a gate stops meaning
  // anything. Each of these is dropped, so the previous value survives — the safe outcome.
  const c = spyClient()
  const written = await writeCheckPrefs(c, 'o@e.com', {
    chk_evidence_escalate: 'yes',          // boolean column, string value
    chk_evidence_bullet_run: 'not a number',
    chk_evidence_threshold: NaN,
    chk_evidence_max_sentences: undefined,
  })
  assert.deepEqual(written, [], 'no junk value may reach a settings column')
  assert.equal(updateOf(c)[0], null, 'and no update should be issued at all')

  // The real ones are coerced, not passed through: an int column rounds.
  const c2 = spyClient()
  const w2 = await writeCheckPrefs(c2, 'o@e.com', {
    chk_evidence_escalate: false, chk_evidence_bullet_run: 3.7, chk_evidence_threshold: 0.65,
  })
  assert.deepEqual(w2.sort(), ['chk_evidence_bullet_run', 'chk_evidence_escalate', 'chk_evidence_threshold'])
  const params = updateOf(c2)[1]
  assert.ok(params.includes(false), 'the boolean must be stored as a boolean')
  assert.ok(params.includes(4), 'an int column must round, not store 3.7')
  assert.ok(params.includes(0.65), 'a numeric column keeps its precision')
})

test('a patch with nothing recognisable writes nothing at all', async () => {
  for (const patch of [null, undefined, {}, 'string', 42, [], { nope: 1 }]) {
    const c = spyClient()
    assert.deepEqual(await writeCheckPrefs(c, 'o@e.com', patch), [], JSON.stringify(patch))
    assert.equal(updateOf(c)[0], null, `${JSON.stringify(patch)} issued an update`)
  }
})

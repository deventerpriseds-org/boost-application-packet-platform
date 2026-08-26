/**
 * The owner's reword map as a SETTING.
 *
 * These pin the rules that make it a setting rather than a constant wearing a writer: the seed is
 * only a first value, the stored map wins entirely, deletion sticks, and a key that stopped matching
 * is surfaced rather than swallowed. The pg-backed helpers are exercised against a fake client -
 * what is being asserted is the SQL SHAPE and the merge/replace semantics, which is where the
 * defects in this class live (a merge that cannot express deletion, a null conflated with {}).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SKILL_REWORD_SEED, effectiveRewords, setSkillRewords, loadSkillRewords, seedSkillBank } from '../dist/functions/tests/appSkillBank.js'
import { buildSkillPool } from '../dist/functions/tests/skillPool.js'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * A fake pg client that EMULATES THE SQL, rather than returning the answer the test wants.
 *
 * The first version of this fake was an INERT-GUARD FACTORY and my own mutation sweep caught it:
 * every matching UPDATE did `state = JSON.parse(params[1])`, i.e. it always REPLACED, whatever the
 * SQL actually said. So mutating the production write from `set skill_rewords = $2` to
 * `set skill_rewords = coalesce(skill_rewords,'{}') || $2` changed nothing the test could observe,
 * and `H:skill-rewords-write-REPLACES-so-a-deletion-sticks` passed with the defect installed.
 *
 * That is the same class as a guard passing on a fixture the real writers never produce
 * (`verify-work` 0b, check 2), with a variant worth naming: **when a test doubles a dependency, the
 * double must implement the BEHAVIOUR under test, not just return a plausible shape.** A fake that
 * answers correctly regardless of its input is a mock of the conclusion.
 *
 * So this one branches on the two SQL shapes that differ in outcome, and nothing else.
 */
function fakeClient(initial = undefined) {
  const state = { skill_rewords: initial }
  const queries = []
  return {
    queries, state,
    async query(sql, params) {
      const flat = sql.replace(/\s+/g, ' ').trim()
      queries.push({ sql: flat, params })
      if (/^select skill_rewords/.test(flat)) return { rows: state.skill_rewords === undefined ? [] : [{ skill_rewords: state.skill_rewords }] }
      if (/update owner_search_prefs set skill_rewords/.test(flat)) {
        const incoming = JSON.parse(params[1])
        // The distinction the guard exists to see. `||` is postgres jsonb concatenation: keys absent
        // from the incoming object SURVIVE, which is exactly why a merge cannot express a deletion.
        state.skill_rewords = /\|\|/.test(flat)
          ? { ...(state.skill_rewords || {}), ...incoming }
          : incoming
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
}

test('H:skill-rewords-seed-is-a-first-value-not-a-constant', () => {
  // The whole reason this is not a checked-in TS table. CLAUDE.md: "the code may only SEED the
  // first/default value - which the user can then change." Owner: "config store so i can edit them".
  assert.equal(effectiveRewords(null) !== SKILL_REWORD_SEED, true, 'the seed object itself was handed out - a caller mutating it would edit the constant')
  assert.deepEqual(effectiveRewords(null), SKILL_REWORD_SEED, 'never-chosen falls back to the seed')
  assert.deepEqual(effectiveRewords({ 'a': 'b' }), { 'a': 'b' }, 'a stored map WINS - the seed is not merged under it')
})

test('H:skill-rewords-empty-map-is-not-the-same-as-never-chosen', () => {
  // The one that decides whether a deletion sticks. If {} collapsed to null, an owner who deleted
  // every reword would get the whole seed back on the next read - the setting silently undoing them.
  assert.deepEqual(effectiveRewords({}), {}, 'an EMPTY stored map must stay empty, not fall back to the seed')
  assert.notDeepEqual(effectiveRewords({}), effectiveRewords(null))
})

test('H:skill-rewords-write-REPLACES-so-a-deletion-sticks', async () => {
  // Deliberately unlike setDimensionPrefs, which merges per family. A merge cannot express deletion,
  // and deleting one of my rewrites is the main thing this screen is for.
  const c = fakeClient({ 'Old One': 'X', 'Keep Me': 'Y' })
  const out = await setSkillRewords(c, 'o@e.io', { 'Keep Me': 'Y' })
  assert.deepEqual(out.stored, { 'Keep Me': 'Y' })
  assert.deepEqual(c.state.skill_rewords, { 'Keep Me': 'Y' }, 'the removed key survived the write - this is a merge, not a replace')
  assert.ok(!('Old One' in c.state.skill_rewords))
})

test('H:skill-rewords-blank-replacement-is-dropped-never-stored', async () => {
  // A term mapped to nothing is a term DELETED from the owner's own bank - the no-fake-data rule in
  // reverse. It is reported as dropped rather than silently ignored.
  const c = fakeClient()
  const out = await setSkillRewords(c, 'o@e.io', { 'Something': '   ', 'Real': 'Value' })
  assert.deepEqual(out.stored, { 'Real': 'Value' })
  assert.deepEqual(out.dropped, ['Something'])
})

test('H:skill-rewords-load-returns-null-only-when-never-saved', async () => {
  assert.equal(await loadSkillRewords(fakeClient(), 'o@e.io'), null, 'no row must read as null')
  assert.deepEqual(await loadSkillRewords(fakeClient({}), 'o@e.io'), {}, 'a saved empty map must read as {} not null')
  assert.deepEqual(await loadSkillRewords(fakeClient({ a: 'b' }), 'o@e.io'), { a: 'b' })
})

test('H:skill-rewords-extends-owner_search_prefs-never-a-new-table', async () => {
  // schema.ts already carries owner_search_prefs and three features extend it. A parallel settings
  // table is the extend-don't-duplicate failure, and it would also orphan on a re-seed.
  const c = fakeClient()
  await loadSkillRewords(c, 'o@e.io')
  const ddl = c.queries.map(q => q.sql).join(' | ')
  assert.match(ddl, /create table if not exists owner_search_prefs/)
  assert.match(ddl, /alter table owner_search_prefs add column if not exists skill_rewords jsonb/)
  assert.ok(!/create table if not exists (skill_reword|owner_skill)/.test(ddl), 'a second settings table was created: ' + ddl)
})

test('H:skill-rewords-seed-actually-applies-to-the-owner-real-fields', () => {
  // A seed that matched nothing would be a screen full of dead rows. Every key is asserted against
  // the owner's REAL expertise/relevantProficiencies text, so a drifted key fails here rather than
  // being discovered as a silent no-op in production.
  const fields = {
    expertise: 'Budget Development and P&L Management|KPI-driven performance management|Enterprise alignment of strategy and execution|Governance frameworks for compliance|Optimizing scaled agile operations|Strategic roadmaps for customer-centric innovation|M&A due diligence and technology integration',
    relevantProficiencies: 'Technology Strategy and Transformation: Digital Platform Maturity, SaaS Growth Strategy, Tech-Driven Innovation, Corporate AI Use Cases | Business and Financial Impact: P&L Optimization, Budget and Cost Control, Investment Strategy',
  }
  const pool = buildSkillPool(fields, { rewords: SKILL_REWORD_SEED })
  assert.deepEqual(pool.staleRewords, [], 'a seeded key matched nothing in the owner real text: ' + JSON.stringify(pool.staleRewords))
  const terms = pool.entries.map(e => e.term)
  // the 1 -> 2 split, which a 1:1 map silently halved
  assert.ok(terms.includes('Budget Development') && terms.includes('P&L Management'), JSON.stringify(terms))
  // the four approved rewrites
  for (const t of ['Strategic Alignment', 'Governance Frameworks', 'Scaled Agile Operations', 'Corporate AI Adoption', 'Cost Control']) {
    assert.ok(terms.includes(t), `${t} missing: ` + JSON.stringify(terms))
  }
  assert.equal(pool.rejected.length, 0, JSON.stringify(pool.rejected))
})

test('H:skill-rewords-a-drifted-key-is-reported-not-swallowed', () => {
  // The failure mode this setting invites: the owner edits MasterContext, the map still names the
  // old phrase, and their new text goes through unreworded while the pool still builds cleanly.
  const pool = buildSkillPool({ expertise: 'Something The Owner Rewrote' }, { rewords: SKILL_REWORD_SEED })
  assert.ok(pool.staleRewords.length > 0, 'every seeded key drifted and nothing said so')
  assert.ok(pool.staleRewords.includes('Governance frameworks for compliance'))
})

test('H:api-source-has-no-control-bytes', () => {
  // A `sed -i` I ran turned a space inside `.join(' ')` into a NUL byte. tsc COMPILED IT - the build
  // is not a guard against this - and the only tell was `grep` reporting "binary file matches" in
  // passing. A NUL in source survives review, survives the build, and breaks tooling later in ways
  // that look unrelated to the edit that caused them.
  //
  // Sibling of the smart-quote rule, with the opposite conclusion: smart quotes need no linter
  // because esbuild rejects them precisely, so the build IS the guard. Control bytes compile
  // silently, so they need one. Tab (9), LF (10), CR (13) are legal; nothing else below 32 is.
  const dir = new URL('../src/functions/tests/', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length > 10, 'expected to scan the whole functions dir, found ' + files.length)
  const offenders = []
  for (const f of files) {
    const buf = readFileSync(new URL(f, dir))
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i]
      if (b < 9 || (b > 13 && b < 32)) { offenders.push(`${f}: byte 0x${b.toString(16)} at ${i}`); break }
    }
  }
  assert.deepEqual(offenders, [], 'control bytes in source: ' + offenders.join('; '))
})

// ── the SEEDER ──────────────────────────────────────────────────────────────────────────────────

/** A bank fake that models the UPSERT the seeder actually issues, including xmax=0 insert detection. */
function bankClient(rows = []) {
  const bank = new Map(rows.map((r) => [r.label_norm, { ...r }]))
  const queries = []
  return {
    bank, queries,
    async query(sql, params) {
      const flat = sql.replace(/\s+/g, ' ').trim()
      queries.push({ sql: flat, params })
      if (/^insert into skill_bank_entry/.test(flat)) {
        const [owner, label, norm, sourceRef, sha, category] = params
        const existed = bank.has(norm)
        // `do update` must OVERWRITE the mutable columns; if the production SQL stopped doing that,
        // this fake keeps the old values and the guard below sees it.
        const keep = /do update/.test(flat)
        if (!existed || keep) bank.set(norm, { owner_email: owner, label, label_norm: norm, source_ref: sourceRef, source_sha256: sha, category })
        return { rows: [{ was_insert: !existed }] }
      }
      if (/^select label, label_norm from skill_bank_entry/.test(flat)) {
        return { rows: [...bank.values()].map((r) => ({ label: r.label, label_norm: r.label_norm })) }
      }
      return { rows: [] }
    },
  }
}

test('H:skill-bank-seed-is-idempotent', async () => {
  // The property that makes re-seeding safe to offer as a button rather than a migration.
  const pool = { entries: [
    { term: 'Enterprise Governance', key: 'enterprise governance', origins: ['skills1'], category: null },
    { term: 'Predictive Analytics', key: 'predictive analytics', origins: ['relevantProficiencies'], category: 'Data Analytics and AI' },
  ] }
  const c = bankClient()
  const first = await seedSkillBank(c, 'o@e.io', pool, 'sha1')
  assert.deepEqual([first.inserted, first.updated], [2, 0])
  const second = await seedSkillBank(c, 'o@e.io', pool, 'sha1')
  assert.deepEqual([second.inserted, second.updated], [0, 2], 'a second run inserted again - the unique key or ON CONFLICT is wrong')
  assert.equal(c.bank.size, 2, 'the bank grew on a re-seed')
})

test('H:skill-bank-origin-is-the-STORE-and-source_ref-is-the-FIELD', async () => {
  // The pair that looked like it needed a widened CHECK and did not. `origin` names the store
  // (master_context); the field name (skills1, expertise) goes in source_ref, which exists for it.
  // Writing 'skills1' into origin would violate the CHECK at runtime - a 500 the tests would miss.
  const c = bankClient()
  await seedSkillBank(c, 'o@e.io', { entries: [{ term: 'X', key: 'x', origins: ['skills1', 'softHardSkillsPool'], category: null }] }, null)
  const ins = c.queries.find((q) => /^insert into skill_bank_entry/.test(q.sql))
  assert.match(ins.sql, /'master_context'/, 'origin must be the literal store name')
  assert.equal(ins.params[3], 'skills1,softHardSkillsPool', 'every field the term came from must be recorded')
  assert.equal(c.bank.size, 1, 'a term from two fields became two rows - the owner picker would show it twice')
})

test('H:skill-bank-carries-the-category-through-to-the-row', async () => {
  const c = bankClient()
  await seedSkillBank(c, 'o@e.io', { entries: [{ term: 'Predictive Analytics', key: 'predictive analytics', origins: ['relevantProficiencies'], category: 'Data Analytics and AI' }] }, null)
  assert.equal(c.bank.get('predictive analytics').category, 'Data Analytics and AI')
})

test('H:skill-bank-NEVER-deletes-it-reports-orphans', async () => {
  // A term vanishing from the pool has two causes and only one means "the owner removed this skill":
  // they edited MasterContext, OR a reword key drifted and the parser now produces different text.
  // The second is a BUG, and deleting the owner's banked skills because of a bug is unrecoverable.
  const c = bankClient([{ label: 'Gone From Source', label_norm: 'gone from source' }])
  const out = await seedSkillBank(c, 'o@e.io', { entries: [{ term: 'Still Here', key: 'still here', origins: ['skills1'], category: null }] }, null)
  assert.deepEqual(out.orphans, ['Gone From Source'])
  assert.ok(c.bank.has('gone from source'), 'the orphan was DELETED - the owner banked skill is gone')
  assert.ok(!c.queries.some((q) => /delete from skill_bank_entry/.test(q.sql)), 'the seeder issued a DELETE')
})

test('H:skill-bank-refuses-a-blank-label-rather-than-hitting-the-CHECK', async () => {
  // The table has `check (length(btrim(label)) > 0)`. Reaching it means a 500 mid-seed with some rows
  // already written; refusing here means the rest of the seed still lands.
  const c = bankClient()
  const out = await seedSkillBank(c, 'o@e.io', { entries: [
    { term: '   ', key: '', origins: ['skills1'], category: null },
    { term: 'Real', key: 'real', origins: ['skills1'], category: null },
  ] }, null)
  assert.equal(c.bank.size, 1)
  assert.equal(out.inserted, 1)
})

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
import { SKILL_REWORD_SEED, effectiveRewords, setSkillRewords, loadSkillRewords } from '../dist/functions/tests/appSkillBank.js'
import { buildSkillPool } from '../dist/functions/tests/skillPool.js'

function fakeClient(initial = undefined) {
  const state = { skill_rewords: initial }
  const queries = []
  return {
    queries, state,
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      if (/^select skill_rewords/.test(sql.trim())) return { rows: state.skill_rewords === undefined ? [] : [{ skill_rewords: state.skill_rewords }] }
      if (/update owner_search_prefs set skill_rewords/.test(sql)) { state.skill_rewords = JSON.parse(params[1]); return { rows: [] } }
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

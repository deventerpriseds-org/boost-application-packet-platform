// P7 item 5 — the silent fallback. `getRoleFocus` used to return a bare string from inside a
// `catch {}`, so "the row says product management", "there is no row" and "Table Storage is down"
// were indistinguishable: an unmatched role quietly became `engineering` and the run reported
// success. The decision is now pure and it always names its source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRoleFocus, roleRowKey, SEED_ROLE_FOCUS, roleDirective } from '../dist/functions/tests/roleFocus.js'

test('roleRowKey matches the AppConfig/templates RowKey the pipeline looks up', () => {
  assert.equal(roleRowKey('Engineering'), 'engineering')
  assert.equal(roleRowKey('Product Management'), 'product-management')
  assert.equal(roleRowKey('Data Science'), 'data-science')
  assert.equal(roleRowKey(''), 'engineering', 'an empty role still resolves to a real row key')
})

test('a configured row wins and raises no warning', () => {
  const r = decideRoleFocus('Product Management', 'product management')
  assert.deepEqual(r, { focus: 'product management', source: 'appconfig' })
})

test('a missing row for a product role is inferred, and says so', () => {
  const r = decideRoleFocus('VP, Product Management', null, '')
  assert.equal(r.focus, 'product management')
  assert.equal(r.source, 'inferred')
  assert.match(r.warning, /no roleFocus configured for templates\/vp,-product-management/)
})

test("an unmatched role uses the owner's configured default before any code seed", () => {
  const r = decideRoleFocus('Chief Revenue Officer', null, 'revenue leadership')
  assert.equal(r.focus, 'revenue leadership')
  assert.equal(r.source, 'configured_default')
  assert.match(r.warning, /configured default/)
})

test('with nothing configured the seed is used but the run carries a warning naming the fix', () => {
  const r = decideRoleFocus('Chief Revenue Officer', null, null)
  assert.equal(r.focus, SEED_ROLE_FOCUS)
  assert.equal(r.source, 'seed')
  assert.match(r.warning, /openai\.defaultRoleFocus/)
  assert.match(r.warning, /templates\/chief-revenue-officer/)
})

test('a storage fault is reported as a fault, not as "not configured"', () => {
  const r = decideRoleFocus('Engineering', null, null, 'ECONNRESET')
  assert.equal(r.source, 'seed')
  assert.match(r.warning, /lookup failed/)
  assert.match(r.warning, /ECONNRESET/)
})

test('every non-appconfig outcome carries a warning; the appconfig one never does', () => {
  assert.equal(decideRoleFocus('Engineering', 'engineering').warning, undefined)
  for (const r of [
    decideRoleFocus('Product', null),
    decideRoleFocus('Ops', null, 'operations'),
    decideRoleFocus('Ops', null, null),
  ]) assert.ok(r.warning && r.warning.length > 0)
})

test('roleDirective is unchanged and always names the resolved focus', () => {
  assert.match(roleDirective('engineering'), /senior engineering executive/)
})

test('the owner’s own curated role beats every guess below it', () => {
  // THE DEFECT: this resolver looked in AppConfig/templates, missed, and fell to a hardcoded seed,
  // while the roles the owner curates in Settings > Roles sat unread in `persona.master_role`.
  // Measured live: CTO -> "CTO", CDIGITAL -> "Chief Digital Officer", VP-ENGINEERING ->
  // "Engineering", VP-PRODUCT -> "Product", VP-TECHNOLOGY -> "Technology". Those ARE role focuses.
  //
  // On the live Trinnex build the warning read: `no roleFocus configured for
  // templates/director-of-digital-technology-operations-&-innovation; used the code seed
  // "engineering"` — a second role brain beside the persona system, which is the extend-don't-
  // duplicate failure, not a configuration the owner forgot.
  const r = decideRoleFocus('Director of Digital Technology Operations & Innovation', null, null, null, 'Technology')
  assert.equal(r.focus, 'Technology')
  assert.equal(r.source, 'persona')
  assert.equal(r.warning, undefined, 'resolving from the owner’s own data is not a fallback and must not warn')
})

test('an explicit per-template roleFocus still outranks the persona', () => {
  // The template row is the owner being MORE specific for one role, so it stays on top.
  const r = decideRoleFocus('VP Product', 'product management', null, null, 'Product')
  assert.equal(r.focus, 'product management')
  assert.equal(r.source, 'appconfig')
})

test('the persona beats the inferred guess, because evidence beats a regex', () => {
  // `inferred` is /product/i on the job title. A curated persona is the owner stating their target
  // role. If those two ever disagree, the owner is right.
  const r = decideRoleFocus('Head of Product Engineering', null, null, null, 'Engineering')
  assert.equal(r.focus, 'Engineering')
  assert.equal(r.source, 'persona')
})

test('no persona still falls through exactly as before', () => {
  // The whole ladder below the new rung is unchanged — this fix adds a source, it does not
  // re-order the ones that were already there.
  assert.equal(decideRoleFocus('VP Product', null, null, null, null).source, 'inferred')
  assert.equal(decideRoleFocus('VP Sales', null, 'revenue', null, '').source, 'configured_default')
  assert.equal(decideRoleFocus('VP Sales', null, null, null, undefined).source, 'seed')
  assert.ok(decideRoleFocus('VP Sales', null, null, null, null).warning, 'the seed path still warns')
})

// P7 item 5 — the silent fallback. `getRoleFocus` used to return a bare string from inside a
// `catch {}`, so "the row says product management", "there is no row" and "Table Storage is down"
// were indistinguishable: an unmatched role quietly became `engineering` and the run reported
// success. The decision is now pure and it always names its source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideRoleFocus, roleRowKey, SEED_ROLE_FOCUS, roleDirective,
  templateRowKey, SEED_TEMPLATE_ROLE_FOCUS,
} from '../dist/functions/tests/roleFocus.js'

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


// ── THE RESUME TEMPLATE DECIDES THE FOCUS ───────────────────────────────────────────────────────
//
// The owner's ruling, in their words: *"let the resume chosen drive the persona, right now it's only
// engineering available"*.
//
// What it replaces, and why the old first source could never fire: it looked up
// `templates/<roleRowKey(roleType)>`, and `roleType` is the POSTING'S FREE-TEXT JOB TITLE. On the
// Trinnex build that meant `templates/director-of-digital-technology-operations-&-innovation`. No
// such row exists for any real posting, so the first source was dead on arrival. The `persona`
// source below it is dead too — `opportunity.persona_key` is NULL on 1,676 of this owner's 1,903
// opportunities and the design was abandoned. Measured result: an executive Director of Digital
// posting written by a prompt aimed at "a senior ENGINEERING executive", from a code constant.

const JOB_TITLE = 'Director of Digital Technology Operations & Innovation'

test('H:template-drives-role-focus: the resume being built outranks every guess', () => {
  // A template is a closed set the owner controls; a job title is not. That is the whole reason a
  // template key can be configured and a title key never could.
  const r = decideRoleFocus(JOB_TITLE, null, null, null, null, 'digital')
  assert.equal(r.focus, 'digital', 'the chosen template did not decide the focus')
  assert.equal(r.source, 'template')
  assert.equal(r.warning, undefined, 'resolving from the chosen template is not a fallback')

  // It outranks the job-title row, the persona, the inferred guess and the configured default.
  const beaten = decideRoleFocus('VP of Product', 'from-title-row', 'the-default', null, 'Product', 'digital')
  assert.equal(beaten.focus, 'digital')
  assert.equal(beaten.source, 'template')
})

test('H:role-focus-ladder-below-the-template-is-unchanged', () => {
  // The change ADDS a source; it must not rewrite the ladder. Anything that resolved before has to
  // resolve the same way, or this is a behaviour change wearing a bug fix's clothes.
  assert.equal(decideRoleFocus(JOB_TITLE, 'row', null, null, null, null).source, 'appconfig')
  assert.equal(decideRoleFocus(JOB_TITLE, null, null, null, 'Digital', null).source, 'persona')
  assert.equal(decideRoleFocus('VP of Product', null, null, null, null, null).source, 'inferred')
  assert.equal(decideRoleFocus(JOB_TITLE, null, 'operations', null, null, null).source, 'configured_default')

  // And the bottom of the ladder still warns, naming what to set. A silent seed is the original defect.
  const seed = decideRoleFocus(JOB_TITLE, null, null, null, null, null)
  assert.equal(seed.focus, SEED_ROLE_FOCUS)
  assert.equal(seed.source, 'seed')
  assert.ok(seed.warning, 'the code seed was used with no warning — that is how this went unnoticed')
})

test('H:one-template-today-resolves-explicitly: engineering, but stated not stumbled into', () => {
  // Only one resume template exists, so this must not CHANGE what today's documents say. It changes
  // where the answer comes FROM: the template states it, instead of five layers falling through to a
  // constant. Same word, different provenance — and `source` is what proves the difference.
  const id = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'
  assert.equal(SEED_TEMPLATE_ROLE_FOCUS[id], 'engineering', 'the built-in resume template lost its seed')
  const r = decideRoleFocus(JOB_TITLE, null, null, null, null, SEED_TEMPLATE_ROLE_FOCUS[id])
  assert.equal(r.focus, 'engineering')
  assert.equal(r.source, 'template', 'engineering still arrives as a fallback rather than as a statement')
  assert.equal(r.warning, undefined)
})

test('H:template-row-key-is-the-drive-id: it cannot drift from the document being copied', () => {
  // Keyed by the Drive id rather than a label, because that is already the identity the per-owner
  // override uses (`CONFIG_KEYS.resumeTemplateId`) and it is the document the build actually copies.
  // A separate name would be a second identity to keep in sync, and the two would drift.
  assert.equal(templateRowKey('abc123'), 'resume-abc123')
  assert.equal(templateRowKey('  abc123  '), 'resume-abc123', 'a stray space would key a different row')
})

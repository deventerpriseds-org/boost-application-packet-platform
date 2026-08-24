// The writer that makes the resume template's role focus a SETTING rather than a constant.
//
// Without it, the change that moved role focus onto the template would itself have violated the
// no-hardcoded-config rule: `SEED_TEMPLATE_ROLE_FOCUS` may only seed the FIRST value, and the owner
// must be able to change it. `resolveRoleFocus` already read `templates/resume-<driveId>`; what was
// missing was any way to write that row.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/functions/config.ts', import.meta.url), 'utf8')

test('H:appconfig-writes-need-a-verified-session-not-requireWrite', () => {
  // `requireWrite` allows a write when `verified || owner === DEMO_EMAIL`, and `resolveOwner`
  // DEFAULTS the owner to DEMO_EMAIL when no `?owner=` is supplied — so an unauthenticated POST
  // resolved to demo and was waved through, to the table holding the pipeline's template ids, output
  // folder and sender address. That guard is right for owner-scoped tables, which have a demo
  // partition to absorb the write; AppConfig is global and has none. `promptsApi` had already
  // written this exact reasoning for the other global table, and this route did not follow it.
  const writers = src.split('export async function').filter((f) => /^\s+save/.test(f))
  assert.equal(writers.length, 2, 'a new AppConfig writer appeared — it needs this guard too')
  for (const fn of writers) {
    assert.match(fn, /const \{ verified \} = resolveOwner\(req\)[\s\S]{0,200}?if \(!verified\)/,
      'an AppConfig writer does not require a verified session')
    assert.ok(!/const guard = requireWrite\(req\)/.test(fn),
      'an AppConfig writer still uses requireWrite, which an unauthenticated request passes')
  }
})

test('H:template-focus-writer-is-row-scoped: not a way to write arbitrary AppConfig rows', () => {
  // The read side projects to declared keys precisely so this table cannot serve anything that lands
  // beside them. A writer that accepted any rowKey would reopen that from the other direction.
  assert.match(src, /function isTemplateRow\(rowKey: string\): boolean \{\s*\n\s*return \/\^resume-\[A-Za-z0-9_-\]\{10,\}\$\/\.test\(rowKey\)/,
    'the template row pattern is missing or widened')
  assert.match(src, /if \(!templateId \|\| !isTemplateRow\(rowKey\)\)/, 'the writer does not check the row shape')
  assert.match(src, /partitionKey: 'templates', rowKey, roleFocus/, 'the writer stores something other than roleFocus')
})

test('H:blank-focus-clears-rather-than-storing-empty', () => {
  // A stored empty string would WIN over the seed in `resolveRoleFocus` (it checks the row before the
  // seed) and silently blank the directive every generation prompt is prefixed with — "Tailor every
  // section for a senior  executive". Clearing restores the seed instead.
  assert.match(src, /if \(!roleFocus\) \{[\s\S]{0,300}?deleteEntity\('templates', rowKey\)/,
    'a blank role focus is stored rather than cleared')
})

// ── The compact resume was built from the WRONG template in the product path ─────────────────────
//
// Found 2026-08-24 while answering "how does the system handle regular vs compact vs per-role
// resumes". `OVERRIDE_KEY` mapped `compact_resume -> resumeTemplateId`, and `renderArtifact` passed
// only three ids. So `google.compactResumeTemplateId` — offered in the owner's own Settings screen
// as "Compact resume template" (app/src/screens/Settings.jsx:1795) — was read by NOTHING in the
// product. The only readers were `pipeline.ts:630` (legacy batch) and `mt19.ts` (test harness), so
// the two paths built the same document from two different templates and neither said so.
//
// This is the third instance of "a setting the owner can write that nothing reads" in this repo.
// The invariant asserted here is therefore the general one, not the incident: EVERY template id the
// settings screen offers must reach `metaFor`.
import { metaFor } from '../dist/functions/tests/packetTemplates.js'

test('H:compact-resume-uses-its-own-template: the configured compact id is the one copied', () => {
  const meta = metaFor('compact_resume', {
    resumeTemplateId: 'FULL_RESUME_ID',
    compactResumeTemplateId: 'COMPACT_ID',
  })
  assert.equal(meta.templateId, 'COMPACT_ID',
    'the compact resume must copy the template the owner configured for it, not the full resume')

  // ...and the full resume is unaffected by it.
  assert.equal(metaFor('resume', { resumeTemplateId: 'FULL_RESUME_ID', compactResumeTemplateId: 'COMPACT_ID' }).templateId,
    'FULL_RESUME_ID', 'the compact id must not leak into the full resume')
})

test('H:compact-resume-falls-back: an unset compact id keeps today behaviour, it does not blank', () => {
  // THIS IS WHAT MAKES THE FIX SAFE TO DEPLOY. Without the fallback the same edit would stop
  // resolving a template for every owner who has the field blank — a worse bug than the one fixed.
  for (const ids of [
    { resumeTemplateId: 'FULL_RESUME_ID' },
    { resumeTemplateId: 'FULL_RESUME_ID', compactResumeTemplateId: '' },
    { resumeTemplateId: 'FULL_RESUME_ID', compactResumeTemplateId: '   ' },
  ]) {
    assert.equal(metaFor('compact_resume', ids).templateId, 'FULL_RESUME_ID',
      `an unset compact id must fall back to the resume template; ids=${JSON.stringify(ids)}`)
  }
})

test('H:every-settings-template-id-reaches-metaFor: no template setting is read by nothing', () => {
  // The general invariant. A new template id added to the settings screen and then never threaded
  // into renderArtifact is exactly how this defect happened; this fails on the next one.
  const settingsSrc = readFileSync(new URL('../../app/src/screens/Settings.jsx', import.meta.url), 'utf8')
  const offered = [...settingsSrc.matchAll(/'google\.(\w+TemplateId)'/g)].map((m) => m[1])
  assert.ok(offered.length >= 4, `expected the settings screen to offer template ids, found ${offered.length}`)

  const render = readFileSync(new URL('../src/functions/tests/appPackets.ts', import.meta.url), 'utf8')
  const call = render.slice(render.indexOf('const meta = metaFor(art.type, {'))
  const passed = call.slice(0, call.indexOf('})'))
  for (const key of offered) {
    assert.match(passed, new RegExp(`\\b${key}\\b`),
      `Settings offers google.${key} but renderArtifact never passes it to metaFor — it would be read by nothing`)
  }
})

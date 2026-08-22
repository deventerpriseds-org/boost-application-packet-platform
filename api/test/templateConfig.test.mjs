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

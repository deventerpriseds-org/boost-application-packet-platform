// D11 — the two in-text highlight treatments ship as TOKEN PAIRS, in both themes.
//
// The defect this file exists to prevent is specific and was written into the design handoff: carry
// #fff03a (keyword) and #fbf2da / #c9b27a (posting echo) verbatim. Carried as literals in a
// component they are correct in light mode and unreadable in dark: the background stays yellow and
// the text keeps inheriting --proto-ink, which flips to near-white. Near-white on yellow.
//
// These are source assertions, not behaviour tests, for the reason the file header of
// postingAnalysis.test.mjs already gives: the rule is about what the STYLESHEET contains. The
// runtime half — that the two treatments actually RESOLVE to different colours, in both themes —
// cannot be answered without a CSS engine and is asserted in test/browser/run.mjs, which reads
// getComputedStyle on the real classes with .proto-dark on and off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HIGHLIGHT_TOKENS, HIGHLIGHT_CLASS, HIGHLIGHT_LITERALS } from '../src/highlight.js'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const CSS = read('theme.css')

/** The body of a CSS rule, brace-matched so a nested block cannot truncate it. */
function ruleBody(css, selector) {
  const i = css.indexOf(selector)
  if (i === -1) return null
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j)
  }
  return null
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}
const ALL_SRC = walk(SRC)
const JSX = ALL_SRC.filter((f) => f.endsWith('.jsx'))
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── the pairs exist, on :root AND under .proto-dark ─────────────────────────────────────────────

test('both highlights ship as a PAIR — never a background on its own', () => {
  // A background with no foreground is the whole defect: the text falls through to --proto-ink.
  assert.deepEqual(HIGHLIGHT_TOKENS.keyword, ['--qc-kw-bg', '--qc-kw-fg'])
  assert.deepEqual(HIGHLIGHT_TOKENS.postingEcho, ['--qc-echo-bg', '--qc-echo-rule'])
  for (const pair of Object.values(HIGHLIGHT_TOKENS)) assert.equal(pair.length, 2)
})

test('every highlight token is defined on :root AND redefined under .proto-dark', () => {
  const light = ruleBody(CSS, ':root {')
  const dark = ruleBody(CSS, '.proto-dark {')
  assert.ok(light && dark, 'theme.css lost :root or .proto-dark')
  for (const token of Object.values(HIGHLIGHT_TOKENS).flat()) {
    assert.match(light, new RegExp(`${token}\\s*:`), `${token} is not defined on :root`)
    assert.match(dark, new RegExp(`${token}\\s*:`),
      `${token} is not redefined under .proto-dark — it keeps its LIGHT value while the app looks dark`)
  }
})

test('a token never resolves to the same value in both themes', () => {
  // If the dark block merely restated the light value, the redefinition above would pass while
  // changing nothing — the exact "it is defined, therefore it works" gap.
  const light = ruleBody(CSS, ':root {')
  const dark = ruleBody(CSS, '.proto-dark {')
  const valueOf = (body, token) => (new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(body) || [])[1]
  for (const token of Object.values(HIGHLIGHT_TOKENS).flat()) {
    const l = valueOf(light, token)
    const d = valueOf(dark, token)
    assert.ok(l && d, `${token} has no value in one of the two themes`)
    assert.notEqual(l.trim(), d.trim(), `${token} is identical in light and dark — the dark block is decorative`)
  }
})

test('within a theme the two highlights are different colours AND different treatments', () => {
  // Different hue alone is not enough: two treatments that differ only in hue are ONE treatment to
  // a reader who cannot separate those hues. The keyword is a filled highlight; the posting echo
  // is a wash under a rule. So the two rules must not have the same shape either.
  for (const [name, sel] of [['light', ':root {'], ['dark', '.proto-dark {']]) {
    const body = ruleBody(CSS, sel)
    const valueOf = (t) => (new RegExp(`${t}\\s*:\\s*([^;]+);`).exec(body) || [])[1].trim()
    assert.notEqual(valueOf('--qc-kw-bg'), valueOf('--qc-echo-bg'),
      `${name}: the keyword highlight and the posting echo paint the same background`)
  }
  const kw = ruleBody(CSS, `.${HIGHLIGHT_CLASS.keyword} {`)
  const echo = ruleBody(CSS, `.${HIGHLIGHT_CLASS.postingEcho} {`)
  assert.ok(kw && echo, 'one of the two highlight classes is missing from theme.css')
  assert.match(kw, /background:\s*var\(--qc-kw-bg\)/)
  assert.match(kw, /color:\s*var\(--qc-kw-fg\)/, 'the keyword highlight must carry its own ink, not inherit --proto-ink')
  assert.match(echo, /background:\s*var\(--qc-echo-bg\)/)
  assert.match(echo, /border-bottom:[^;]*var\(--qc-echo-rule\)/, 'the posting echo is an UNDERLINE — its rule token must be drawn')
  assert.ok(!/border-bottom/.test(kw), 'the keyword highlight has grown the echo\'s rule — the two treatments have converged')
})

// ── nothing paints a highlight by hand ──────────────────────────────────────────────────────────

test('no component contains a highlight swatch as a literal', () => {
  // The criterion, generalised: not only the handoff's three, but every swatch either treatment
  // resolves to — so a dark-mode value pasted into a component is caught too. theme.css is the one
  // file allowed to hold them.
  for (const file of JSX) {
    const code = readFileSync(file, 'utf8')
    for (const lit of HIGHLIGHT_LITERALS) {
      assert.ok(!code.toLowerCase().includes(lit.toLowerCase()),
        `${file.slice(SRC.length)} contains the literal ${lit} — it belongs to theme.css as a token`)
    }
  }
})

test('no custom-property name is assembled by interpolation, anywhere in src', () => {
  // P0.3: `var(--qc-kw-${tone})` is not an error. CSS drops a declaration it cannot parse without
  // a word of warning, so the highlight simply does not appear — which is how the `todo` pill
  // became invisible. Comments are stripped first so this guard can never fire on the note that
  // explains it.
  for (const file of ALL_SRC.filter((f) => /\.(js|jsx)$/.test(f))) {
    const code = stripComments(readFileSync(file, 'utf8'))
    const hit = /var\(--[a-z0-9-]*\$\{/i.exec(code)
    assert.equal(hit, null, `${file.slice(SRC.length)}: interpolated custom-property name "${hit && hit[0]}"`)
  }
})

test('every consumer paints through HIGHLIGHT_CLASS, never a hand-typed class name', () => {
  const users = JSX.filter((f) => readFileSync(f, 'utf8').includes('HIGHLIGHT_CLASS'))
  assert.ok(users.length >= 2, `both highlights must actually be used; found ${users.length} consumer(s)`)
  for (const file of JSX) {
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const cls of Object.values(HIGHLIGHT_CLASS)) {
      assert.ok(!new RegExp(`className=["'][^"']*\\b${cls}\\b`).test(code),
        `${file.slice(SRC.length)} hand-types "${cls}" — use HIGHLIGHT_CLASS so the class and the stylesheet cannot drift`)
    }
  }
  // Both treatments are used, or the pair that is not used is a colour nobody can see is wrong.
  const all = JSX.map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(all, /HIGHLIGHT_CLASS\.keyword/)
  assert.match(all, /HIGHLIGHT_CLASS\.postingEcho/)
})

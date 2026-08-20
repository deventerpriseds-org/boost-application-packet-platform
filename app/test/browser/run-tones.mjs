// Status-tone contrast sweep — every tone in shell.jsx's TONE table, both themes.
//
//   cd app && npm run test:tones
//
// WHY THIS EXISTS. Eight of the nine tones shipped below 4.5:1 in at least one theme, and nothing
// caught it because nothing was looking. Measured 2026-08-20 on main, before the fix:
//
//   accent  2.90 dark   green/ok 3.00 light   yellow/warn 3.07 light   orange 3.43 light
//   panel   4.28 light / 4.04 dark            red 4.41 light / 4.29 dark
//
// Only `purple` passed both. `accent` at 2.90:1 is the worst text in the app and it labels the
// swap decisions on the QC rail.
//
// WHY IT MUST BE A BROWSER. Every one of these resolves through a four-level var() chain —
// Pill -> TONE -> --proto-* -> --surface-*-* -> a ramp step — and two of the levels are redefined
// per theme. A source test can prove the tokens are DEFINED; only a CSS engine can say what they
// land on. The `--proto-accent` case is the proof: its light and dark values differ by three ramp
// steps and neither is written anywhere near the tone table.
//
// THE TONE TABLE IS READ FROM shell.jsx, NOT COPIED. A guard holding its own copy of the thing it
// checks cannot fail when the real one changes — that is the inert-guard shape this repo has
// shipped three times. Add a tenth tone and it is swept automatically; misspell one and the
// import fails loudly.
import { readdirSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`
    if (existsSync(exe)) return exe
  }
}

/** WCAG 2.1 relative luminance. */
const rgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number)
const lum = (c) => {
  const [r, g, b] = rgb(c).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** An 11px 600-weight pill label is normal-size text under WCAG, so AA is 4.5:1, not 3:1. */
const AA_NORMAL = 4.5

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/test/browser/overlay-probe.html`)

// The REAL table, imported from the module that ships it.
const TONE = await page.evaluate(async (base) => {
  const m = await import(`${base}/src/shell.jsx`)
  return m.TONE_TABLE || null
}, `http://localhost:${port}`)

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

ok('the tone table was imported from shell.jsx, not copied here',
  TONE && typeof TONE === 'object' && Object.keys(TONE).length > 0,
  TONE ? `${Object.keys(TONE).length} tones` : 'import returned nothing — the guard is blind')

if (!TONE || !Object.keys(TONE).length) {
  console.log(out.join('\n'))
  console.log('\nFAILED — could not read the tone table, so NOTHING was measured.')
  await browser.close(); await server.close(); process.exit(1)
}

// A tone that stops being rendered is a tone this guard silently stops covering. Pin the count so
// a deletion is a decision, not a drift.
ok('every tone the app can render is swept', Object.keys(TONE).length >= 9,
  `${Object.keys(TONE).length} tones: ${Object.keys(TONE).sort().join(', ')}`)

const measure = () => page.evaluate((TONE) => {
  const res = {}
  for (const [name, t] of Object.entries(TONE)) {
    const el = document.createElement('span')
    el.className = 'px-pill'
    el.style.background = t.bg
    el.style.color = t.fg
    el.textContent = 'Ap'
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    res[name] = { bg: cs.backgroundColor, fg: cs.color }
    el.remove()
  }
  return res
}, TONE)

const light = await measure()
await page.click('#toggle-dark')
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
const dark = await measure()

const rows = []
for (const name of Object.keys(TONE).sort()) {
  for (const [theme, set] of [['light', light], ['dark', dark]]) {
    const { bg, fg } = set[name]
    const ratio = contrast(fg, bg)
    rows.push({ name, theme, bg, fg, ratio })
    // A transparent or unresolved colour reads as a huge ratio against anything — that is a
    // measurement failure wearing a pass, so it is checked separately from the threshold.
    ok(`${name} / ${theme} resolves to real colours`,
      /^rgba?\(/.test(bg) && /^rgba?\(/.test(fg) && !/, *0\)$/.test(bg),
      `bg ${bg}  fg ${fg}`)
    ok(`${name} / ${theme} meets ${AA_NORMAL}:1`, ratio >= AA_NORMAL,
      `${ratio.toFixed(2)}:1  fg ${fg} on bg ${bg}`)
  }
}

console.log(out.join('\n'))
console.log('\n  tone      theme   ratio   fg on bg')
for (const r of rows) {
  console.log(`  ${r.name.padEnd(9)} ${r.theme.padEnd(6)} ${r.ratio.toFixed(2).padStart(6)}  ${r.fg} on ${r.bg}${r.ratio < AA_NORMAL ? '   <-- BELOW ' + AA_NORMAL : ''}`)
}

const failed = out.filter(l => l.startsWith('FAIL'))
console.log(`\n${out.length - failed.length}/${out.length} passed`)
await browser.close()
await server.close()
if (failed.length) process.exit(1)

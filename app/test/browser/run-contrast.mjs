// The contrast sweep. Every ink the app paints, in BOTH themes, measured in a real browser.
//
//   cd app && npm run test:contrast      (npm run test:tones is the same file, kept as an alias)
//
// ─── WHY THIS FILE IS ONE FILE ──────────────────────────────────────────────────────────────────
// This started as the status-tone sweep (D26) and covered nine pills. D28 recorded the problem
// that created: two contrast guards existed, so the AREA looked covered while buttons, links,
// inputs, temperature chips, `.px-label`, `.px-small` and every ad-hoc `color:` in a `.jsx` style
// prop were measured by nothing at all. The fix for that is NOT a third one-off guard — three
// partial guards look like more coverage than two and are not. So the tone sweep was WIDENED in
// place. There is one contrast entry point in this repo and this is it.
//
// ─── WHY IT MUST BE A BROWSER ───────────────────────────────────────────────────────────────────
// Every colour here resolves through a four-level var() chain — a class -> `--proto-*` ->
// `--surface-*` / `--text-*` -> a ramp step — and two of those levels are redefined per theme. A
// source test can prove a token is DEFINED. Only a CSS engine can say what it LANDS ON. The
// `--proto-accent` case is the proof: its light and dark values differ by three ramp steps and
// neither is written anywhere near the tone table.
//
// ─── WHAT IT COVERS ─────────────────────────────────────────────────────────────────────────────
//   1. TONES     — the nine status pills, read from shell.jsx's real TONE_TABLE.
//   2. RULES     — every rule in the live stylesheet that declares a `color`, enumerated FROM the
//                  stylesheet at run time. A new `.px-*` class cannot be added unswept.
//   3. INKS      — every ink token used ad-hoc as `color:` in a `.jsx` style prop, crossed with the
//                  grounds it can sit on. This is the 200-odd inline styles D28 named.
//   4. TEMPS     — the four temperature chips, from shell.jsx's real TEMP_KEYS + tempChipStyle,
//                  composited over their ground because their tint carries alpha.
//   5. DRIFT     — sections 2 and 3 are cross-checked against the source: a colour that appears in
//                  the stylesheet or in a `.jsx` style prop and is in neither the covered nor the
//                  not-covered list FAILS the run. That is what stops this guard rotting.
//
// ─── WHAT IT DOES NOT COVER — read this before trusting a green run ─────────────────────────────
//   * `--proto-panel-deep` is NOT in the default ground set. It is a decorative ground (bars,
//     photos, the logo tile) and almost nothing lays body text on it; the two places that do — the
//     `panel` pill and Call.jsx's tool chips — each carry `--proto-ink-on-panel` explicitly and ARE
//     swept. If a screen starts putting `.px-small` on panel-deep, this sweep will not notice.
//   * Hover / focus / active / disabled states are measured only where the stylesheet declares a
//     `color` for them (`.px-link:hover`, `.px-tab-idle:hover` are). Focus RINGS, borders, and the
//     3:1 non-text threshold for UI components are out of scope entirely.
//   * SVG glyph fills (the flame, the warning triangle, the match ring) are graphical objects with
//     a visible text label beside them. They are 3:1 objects, not 4.5:1 text, and are listed as
//     not-covered rather than measured — see JSX_COLORS.
//   * It measures SYNTHESISED elements carrying the real declarations, not the running app. It
//     proves a declaration pair is readable; it cannot prove a screen actually pairs them that way.
//   * The live deployed SPA is not reachable from this sandbox, so nothing here is a live check.
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { contrast, composite, alphaOf, thresholdFor, parseRgb } from './contrast.mjs'

function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`
    if (existsSync(exe)) return exe
  }
}

// The grounds an element can be laid on. `deep` exists so a rule that PAINTS it (`.px-logo`, the
// `panel` pill) is measured against it; it is deliberately not in any default ground set.
const GROUNDS = {
  root: 'var(--surface-background-secondary)',
  paper: 'var(--proto-paper)',
  panel: 'var(--proto-panel)',
  deep: 'var(--proto-panel-deep)',
}
const DEFAULT_GROUNDS = ['root', 'paper', 'panel']

// ── Section 2 classification. EVERY colour-declaring rule in the stylesheet needs an entry here;
// one that does not have one fails the run (see DRIFT). `grounds` is ignored for a rule that paints
// its own opaque background — that rule is measured against itself.
const RULES = {
  'html': { grounds: DEFAULT_GROUNDS, why: 'Compass base ink on the app ground.' },
  'body': { grounds: DEFAULT_GROUNDS, why: 'Page ink.' },
  '.px-root': { grounds: DEFAULT_GROUNDS, why: 'App shell ink.' },
  '.px-btn': { grounds: DEFAULT_GROUNDS, why: 'Default button; paints its own paper ground.' },
  '.px-input': { grounds: DEFAULT_GROUNDS, why: 'Input value text; paints its own paper ground.' },
  '.px-input::placeholder': { grounds: ['paper'], why: 'Placeholder sits inside .px-input, whose ground is always paper. WCAG treats placeholder as text, so 4.5:1 applies — it is not a disabled state.' },
  '.px-pill': { grounds: DEFAULT_GROUNDS, why: 'Default (toneless) pill; paints its own panel ground.' },
  '.px-chip': { grounds: DEFAULT_GROUNDS, why: 'Chip; paints its own panel ground.' },
  '.px-btn-dark': { grounds: DEFAULT_GROUNDS, why: 'Solid brand button.' },
  '.px-btn-accent': { grounds: DEFAULT_GROUNDS, why: 'Solid brand button.' },
  '.px-btn-ghost': { grounds: DEFAULT_GROUNDS, why: 'Transparent by declaration, so it takes the ground it is dropped on.' },
  '.px-label': { grounds: DEFAULT_GROUNDS, why: 'D27. 11px uppercase tertiary ink — real text, not decoration.' },
  '.px-meta': { grounds: DEFAULT_GROUNDS, why: '12px secondary ink.' },
  '.px-small': { grounds: DEFAULT_GROUNDS, why: 'D27, the reported defect. 11px tertiary ink carrying real informational copy.' },
  '.px-ava': { grounds: DEFAULT_GROUNDS, why: 'Avatar initials; paints its own brand-subtle ground.' },
  '.px-tab': { grounds: DEFAULT_GROUNDS, why: 'Idle tab label.' },
  '.px-tab-active': { grounds: DEFAULT_GROUNDS, why: 'Active tab label.' },
  '.px-tab-idle:hover': { grounds: DEFAULT_GROUNDS, why: 'Hover ink IS declared, so it is measured.' },
  '.qc-kw': { grounds: DEFAULT_GROUNDS, why: 'Keyword highlight; paints its own opaque ground.' },
  '.qc-echo': { grounds: DEFAULT_GROUNDS, why: 'Posting-echo wash; paints its own opaque ground.' },
  '.px-note': { grounds: DEFAULT_GROUNDS, why: 'Info note; paints its own info-subtle ground.' },
  '.px-link': { grounds: DEFAULT_GROUNDS, why: 'Links — named by D28 as unmeasured.' },
  '.px-link:hover': { grounds: DEFAULT_GROUNDS, why: 'Hover ink IS declared, so it is measured.' },
  '.px-logo': {
    grounds: DEFAULT_GROUNDS,
    why: 'Company-initial tile. Paints panel-deep and puts secondary ink on it.',
    knownBelow: { light: 4.28, dark: 4.04, deferred: 'D30', reason: 'ink2 on panel-deep, the same pairing --proto-ink-on-panel was created for. Fixing it means either pointing .px-logo at that token or accepting a visual change to the tile; both are design calls this lane did not own.' },
  },
  '.px-btn-green': {
    grounds: DEFAULT_GROUNDS,
    why: 'Solid success button, 13 call sites.',
    knownBelow: { light: 3.30, dark: 3.30, deferred: 'D30', reason: 'White on green-600. The fix is dark ink on the fill or a darker fill; both change how every success button looks and need owner sign-off.' },
  },
  '.px-btn-red': {
    grounds: DEFAULT_GROUNDS,
    why: 'Solid destructive button.',
    knownBelow: { dark: 3.76, deferred: 'D30', reason: 'White on red-500 in DARK only; light (red-600) measures 4.83 and passes. Same design call as the green button.' },
  },
  '.px-btn-yellow': {
    grounds: DEFAULT_GROUNDS,
    why: 'Solid warning button.',
    knownBelow: { light: 3.19, dark: 2.15, deferred: 'D30', reason: 'White on amber, the worst text in the app after the D26 tones were fixed. White on yellow cannot be made to work; the fix is dark ink on the fill, which is a visible product change.' },
  },
  '.type-overline': { skip: 'Compass typography bundle (src/tokens/typography.css), not the app skin. Zero call sites in src/ — grepped, and the sweep re-checks that below, so it stops being skipped the day it is used.' },
}

// ── Section 3. Every distinct value used as `color:` in a `.jsx` style prop. Entries are keyed by
// the literal source text so the DRIFT check can match them against a grep of src/.
const JSX_COLORS = {
  'var(--proto-ink)': { grounds: DEFAULT_GROUNDS, why: 'Primary ink.' },
  'var(--proto-ink2)': { grounds: DEFAULT_GROUNDS, why: 'Secondary ink, 126 sites.' },
  'var(--proto-ink3)': { grounds: DEFAULT_GROUNDS, why: 'D27 tertiary ink, 66 sites.' },
  'var(--proto-ink-on-panel)': { grounds: ['deep'], why: 'Exists ONLY for panel-deep — measuring it anywhere else would be measuring a pairing that never ships.' },
  'var(--text-primary)': { grounds: DEFAULT_GROUNDS, why: 'Compass primary ink.' },
  'var(--text-brand)': { grounds: DEFAULT_GROUNDS, why: 'Brand ink.' },
  'var(--text-info)': { grounds: DEFAULT_GROUNDS, why: 'Info ink.' },
  'var(--proto-red)': { grounds: DEFAULT_GROUNDS, why: 'Status ink as TEXT (32 sites) — the tone sweep only proves it on its own -soft tint.' },
  'var(--proto-green)': { grounds: DEFAULT_GROUNDS, why: 'Status ink as text.' },
  'var(--proto-yellow)': { grounds: DEFAULT_GROUNDS, why: 'Status ink as text.' },
  'var(--proto-purple)': { grounds: DEFAULT_GROUNDS, why: 'Status ink as text.' },
  'var(--proto-accent)': { grounds: DEFAULT_GROUNDS, why: 'Status ink as text.' },
  'var(--surface-brand-default)': { grounds: DEFAULT_GROUNDS, why: 'Brand solid used as ink in two places.' },
  'var(--surface-success-default)': { grounds: DEFAULT_GROUNDS, why: 'Success solid used as ink in two places.' },
  '#16794a': { grounds: ['paper'], why: 'Keep-triage button label. Always on .px-btn, whose ground is paper.' },
  '#a8730a': { grounds: ['paper'], why: 'Maybe-triage button label. Always on .px-btn, whose ground is paper.' },
  '#c08a1e': { grounds: DEFAULT_GROUNDS, why: 'Gold. Two roles: the FavStar glyph (decorative, has aria-label) AND an 18px/800 count in RolesTitles — the count is text, so the stricter reading is the one measured.' },
  '#0a66c2': { grounds: DEFAULT_GROUNDS, why: 'LinkedIn brand badge. Its own rgba(10,102,194,.14) tint is composited over the ground first.', ownBg: 'rgba(10,102,194,0.14)' },
  '#333': { grounds: ['white'], why: 'main.jsx ErrorBoundary. Renders BEFORE the app mounts, outside theme.css, on the browser default white — so its ground is white, not a token.' },
  '#ef5a34': { skip: 'SignalIcon flame fill. aria-hidden graphical object with a visible text label beside it — a 3:1 non-text object, not 4.5:1 text.' },
  '#e8a90b': { skip: 'SignalIcon flame/triangle fill — graphical object, see #ef5a34.' },
  '#3b82f6': { skip: 'SignalIcon flame fill — graphical object, see #ef5a34.' },
  '#cbd2dc': { skip: 'SignalIcon pale fill — graphical object, and it carries an explicit --proto-rule stroke precisely because it is pale.' },
  '#ef4444': { skip: 'SignalIcon triangle fill / PRIORITY_COLOR rail — graphical object, see #ef5a34.' },
  '#22c55e': { skip: 'SignalIcon triangle fill / PRIORITY_COLOR rail — graphical object, see #ef5a34.' },
  '#fff': { skip: 'Settings.jsx:714 — ink on a per-row coloured swatch whose fill comes from data, so there is no fixed pair to measure. Also the glyph fill inside WarnTriangle. NOT covered; recorded so it cannot be mistaken for covered.' },
}

const out = []
let measured = 0
const ok = (name, cond, detail = '') => { out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); return cond }

// ── boot ────────────────────────────────────────────────────────────────────────────────────────
let server, browser, page
try {
  server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
  await server.listen()
  const { port } = server.httpServer.address()
  browser = await chromium.launch({ executablePath: chromiumPath() })
  page = await browser.newPage()
  await page.goto(`http://localhost:${port}/test/browser/overlay-probe.html`)
  await page.waitForSelector('#toggle-dark')
  var baseUrl = `http://localhost:${port}`
} catch (e) {
  // Distinct from any contrast failure, and never silent — AC38.
  console.log(`STARTUP FAILURE — the sweep could not run, so NOTHING was measured: ${e && e.message}`)
  try { await browser?.close() } catch {}
  try { await server?.close() } catch {}
  process.exit(1)
}

// The REAL tables, imported from the modules that ship them. A guard holding its own copy of the
// thing it checks cannot fail when the real one changes.
const shell = await page.evaluate(async (base) => {
  const m = await import(`${base}/src/shell.jsx`)
  return { TONE: m.TONE_TABLE || null, TEMP_KEYS: m.TEMP_KEYS || null, temps: (m.TEMP_KEYS || []).map(k => ({ key: k, on: m.tempChipStyle(k, true), off: m.tempChipStyle(k, false) })) }
}, baseUrl)

ok('the tone table was imported from shell.jsx, not copied here',
  shell.TONE && Object.keys(shell.TONE).length > 0,
  shell.TONE ? `${Object.keys(shell.TONE).length} tones` : 'import returned nothing — the guard is blind')
ok('the temperature keys were imported from shell.jsx, not copied here',
  Array.isArray(shell.TEMP_KEYS) && shell.TEMP_KEYS.length > 0,
  shell.TEMP_KEYS ? shell.TEMP_KEYS.join(', ') : 'import returned nothing')

if (!shell.TONE || !Object.keys(shell.TONE).length || !shell.TEMP_KEYS?.length) {
  console.log(out.join('\n'))
  console.log('\nFAILED — could not read the source tables, so NOTHING was measured.')
  await browser.close(); await server.close(); process.exit(1)
}
ok('every tone the app can render is swept', Object.keys(shell.TONE).length >= 9,
  `${Object.keys(shell.TONE).length} tones: ${Object.keys(shell.TONE).sort().join(', ')}`)

// ── the one measurement primitive ───────────────────────────────────────────────────────────────
// Everything below funnels through this, so every number in the report is produced the same way.
const probe = (spec) => page.evaluate((spec) => {
  const res = []
  for (const item of spec) {
    const g = document.createElement('div')
    g.style.background = item.ground
    document.body.appendChild(g)
    const el = document.createElement('span')
    el.textContent = 'Ap'
    if (item.cssText) el.style.cssText = item.cssText
    if (item.color) el.style.color = item.color
    if (item.ownBg) el.style.background = item.ownBg
    g.appendChild(el)
    const cs = getComputedStyle(el)
    res.push({
      id: item.id, ground: item.groundName,
      fg: cs.color, ownBg: cs.backgroundColor, groundBg: getComputedStyle(g).backgroundColor,
      fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight),
      // AC5 — say WHERE the background came from, so a wrong ground is visible in the output.
      bgFrom: getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' ? 'own declaration' : 'ground element',
    })
    g.remove()
  }
  return res
}, spec)

// Read the colour-declaring rules straight out of the live stylesheet.
// NOTE: `if (rule.cssRules)` does NOT distinguish a grouping rule any more — Chrome supports CSS
// nesting, so EVERY CSSStyleRule now carries an empty `cssRules`. A walk written the obvious way
// recurses into every style rule and reports zero colours, which reads exactly like "nothing to
// check". Hence the `!selectorText` test. This cost an hour and is the whole reason for the count
// assertion at the bottom.
const sheetRules = await page.evaluate(() => {
  const found = []
  const walk = (list) => {
    for (const r of list) {
      if (r.cssRules && r.cssRules.length && !r.selectorText) { walk(r.cssRules); continue }
      if (!r.style || !r.selectorText) continue
      if (r.style.getPropertyValue('color')) found.push({ sel: r.selectorText, cssText: r.style.cssText })
    }
  }
  for (const s of document.styleSheets) { try { walk(s.cssRules) } catch {} }
  return found
})
ok('the stylesheet was readable and declares colours', sheetRules.length > 0,
  `${sheetRules.length} colour-declaring rules found`)

// ── DRIFT: the source is the authority on what must be swept ────────────────────────────────────
for (const r of sheetRules) {
  ok(`stylesheet rule ${r.sel} is classified`, Object.hasOwn(RULES, r.sel),
    Object.hasOwn(RULES, r.sel) ? '' : 'declares a color and is in neither the covered nor the skipped list — classify it in RULES')
}
for (const sel of Object.keys(RULES)) {
  ok(`classified rule ${sel} still exists in the stylesheet`, sheetRules.some(r => r.sel === sel),
    sheetRules.some(r => r.sel === sel) ? '' : 'RULES names a selector the stylesheet no longer has — stale entry')
}

// Walk src/ for `color: '<value>'` in style props. This is the ad-hoc-inline-colour surface D28
// named, and scanning it here is what makes a NEW hardcoded colour fail the sweep.
const SRC = new URL('../../src/', import.meta.url).pathname
const jsxFiles = []
;(function walkDir(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walkDir(p)
    else if (n.endsWith('.jsx')) jsxFiles.push(p)
  }
})(SRC)
const jsxFound = new Map()
for (const f of jsxFiles) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/\bcolor: *'([^']+)'/g)) {
    const v = m[1].trim()
    if (!jsxFound.has(v)) jsxFound.set(v, [])
    jsxFound.get(v).push(f.slice(SRC.length))
  }
}
ok('the .jsx source was scanned for ad-hoc colours', jsxFiles.length > 0 && jsxFound.size > 0,
  `${jsxFiles.length} .jsx files, ${jsxFound.size} distinct colour values`)
for (const [v, files] of jsxFound) {
  ok(`inline colour ${v} is classified`, Object.hasOwn(JSX_COLORS, v),
    Object.hasOwn(JSX_COLORS, v) ? '' : `used in ${[...new Set(files)].slice(0, 3).join(', ')} — classify it in JSX_COLORS`)
}
for (const v of Object.keys(JSX_COLORS)) {
  ok(`classified inline colour ${v} is still used`, jsxFound.has(v),
    jsxFound.has(v) ? '' : 'JSX_COLORS names a colour no .jsx uses any more — stale entry')
}
// `.type-overline` is skipped on the grounds that nothing uses it. Re-check that, or the skip
// quietly becomes a hole the day someone uses it.
const overlineUsed = jsxFiles.some(f => readFileSync(f, 'utf8').includes('type-overline'))
ok('.type-overline is still unused, so skipping it is still honest', !overlineUsed,
  overlineUsed ? 'a .jsx now uses .type-overline — remove its skip and measure it' : 'zero call sites')

// ── build the measurement plan ──────────────────────────────────────────────────────────────────
const plan = []
for (const [name, t] of Object.entries(shell.TONE)) plan.push({ id: `tone ${name}`, kind: 'tone', ground: t.bg, groundName: 'own tint', color: t.fg, cssText: 'font-size:11px;font-weight:600' })
for (const r of sheetRules) {
  const c = RULES[r.sel]
  if (!c || c.skip) continue
  for (const gn of c.grounds) plan.push({ id: r.sel, kind: 'rule', ground: GROUNDS[gn], groundName: gn, cssText: r.cssText })
}
for (const [v, c] of Object.entries(JSX_COLORS)) {
  if (c.skip) continue
  for (const gn of c.grounds) plan.push({ id: v, kind: 'ink', ground: gn === 'white' ? '#ffffff' : GROUNDS[gn], groundName: gn, color: v, ownBg: c.ownBg })
}
for (const t of shell.temps) {
  for (const gn of DEFAULT_GROUNDS) {
    plan.push({ id: `temp ${t.key} (on)`, kind: 'temp', ground: GROUNDS[gn], groundName: gn, color: t.on.color, ownBg: t.on.background })
    plan.push({ id: `temp ${t.key} (off)`, kind: 'temp', ground: GROUNDS[gn], groundName: gn, color: t.off.color, ownBg: t.off.background })
  }
}

const light = await probe(plan)
await page.click('#toggle-dark')
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
const dark = await probe(plan)
ok('the dark theme actually applied', await page.evaluate(() => document.documentElement.classList.contains('proto-dark')),
  'both the class and the data-theme attribute, as state.jsx sets them')

// ── judge ───────────────────────────────────────────────────────────────────────────────────────
const rows = []
const knownFor = (id) => RULES[id]?.knownBelow
for (const [theme, set] of [['light', light], ['dark', dark]]) {
  for (let i = 0; i < set.length; i++) {
    const m = set[i], spec = plan[i]
    // The ground is always opaque; the element's own background may not be, so composite it.
    const bg = composite(m.ownBg, m.groundBg)
    const th = thresholdFor(m.fs, m.fw)
    const ratio = contrast(m.fg, bg)
    measured++
    rows.push({ ...m, theme, kind: spec.kind, bg, th, ratio })

    // A colour that did not resolve reads as a huge ratio against anything — a measurement failure
    // wearing a pass. Checked SEPARATELY from the threshold so it can never be mistaken for one.
    const resolved = /^rgba?\(/.test(m.fg) && /^rgba?\(/.test(bg) && alphaOf(m.fg) > 0 && alphaOf(bg) >= 1 && parseRgb(m.fg).length === 3
    ok(`${m.id} / ${m.ground} / ${theme} resolved to real opaque colours`, resolved, `fg ${m.fg}  bg ${bg} (from ${m.bgFrom})`)
    // 21:1 is the theoretical maximum (black on white). Anything above it is arithmetic on garbage.
    ok(`${m.id} / ${m.ground} / ${theme} ratio is physically possible`, ratio <= 21.0001, `${ratio.toFixed(2)}:1`)

    const known = knownFor(m.id)
    const pinned = known && (known[theme] !== undefined)
    if (pinned) {
      // An accepted defect is pinned to its measured value in BOTH directions. If it gets worse the
      // pin trips; if it gets FIXED the pin also trips, forcing the entry to be deleted rather than
      // left behind as a permanent excuse. An accept that no longer corresponds to a real failure
      // is exactly how a guard goes inert.
      ok(`${m.id} / ${theme} is still at its recorded below-AA value (${known.deferred})`,
        Math.abs(ratio - known[theme]) < 0.05 && ratio < th,
        `measured ${ratio.toFixed(2)}:1, pinned ${known[theme]}:1, threshold ${th}:1 — ${ratio >= th ? 'IT NOW PASSES: delete the knownBelow entry' : 'unchanged'}`)
    } else {
      ok(`${m.id} / ${m.ground} / ${theme} meets ${th}:1`, ratio >= th,
        `${ratio.toFixed(2)}:1  fg ${m.fg} on bg ${bg} (from ${m.bgFrom})  ${m.fs}px/${m.fw}`)
    }
  }
}

// A truncated run must fail rather than pass quietly.
ok('every planned measurement was actually taken', measured === plan.length * 2,
  `${measured} taken, ${plan.length * 2} planned (${plan.length} pairs x 2 themes)`)

// ── report ──────────────────────────────────────────────────────────────────────────────────────
console.log(out.join('\n'))
console.log('\n  target                                    ground    theme   ratio   /min   fg on bg')
for (const r of rows) {
  const flag = r.ratio < r.th ? (knownFor(r.id)?.[r.theme] !== undefined ? '   (known, ' + knownFor(r.id).deferred + ')' : '   <-- BELOW ' + r.th) : ''
  console.log(`  ${String(r.id).padEnd(41)} ${String(r.ground).padEnd(9)} ${r.theme.padEnd(6)} ${r.ratio.toFixed(2).padStart(6)}  ${String(r.th).padStart(4)}   ${r.fg} on ${r.bg}${flag}`)
}

console.log('\n  ── KNOWN BELOW AA, accepted and tracked (NOT fixed) ──')
for (const [sel, c] of Object.entries(RULES)) {
  if (!c.knownBelow) continue
  const k = c.knownBelow
  console.log(`  ${sel}  ${Object.entries(k).filter(([t]) => t === 'light' || t === 'dark').map(([t, v]) => `${t} ${v}:1`).join('  ')}  [${k.deferred}]\n      ${k.reason}`)
}
console.log('\n  ── NOT COVERED (see the header for the full list) ──')
for (const [sel, c] of Object.entries(RULES)) if (c.skip) console.log(`  rule ${sel}\n      ${c.skip}`)
for (const [v, c] of Object.entries(JSX_COLORS)) if (c.skip) console.log(`  inline ${v}\n      ${c.skip}`)
console.log('  ground --proto-panel-deep is not in the default ground set; hover/focus/active states are')
console.log('  measured only where the stylesheet declares a colour for them; SVG glyph fills, borders')
console.log('  and focus rings (3:1 non-text objects) are out of scope; the live SPA is not reachable here.')

const failed = out.filter(l => l.startsWith('FAIL'))
console.log(`\n${out.length - failed.length}/${out.length} passed  (${measured} measurements)`)
if (failed.length) { console.log('\nFAILURES:'); for (const f of failed) console.log('  ' + f) }
await browser.close()
await server.close()
if (failed.length) process.exit(1)

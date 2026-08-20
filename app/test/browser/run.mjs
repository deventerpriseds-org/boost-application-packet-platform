// Browser probe for the presentation layer: the <Overlay> primitive (src/shell.jsx +
// src/overlay.js), the D11 highlight tokens, and P8.7's keyword-list breakpoint.
//
//   cd app && npm run test:browser
//
// It boots its own Vite dev server, drives the real component in headless Chromium and asserts the
// behaviours that `npm test` cannot reach without a DOM: Escape, focus movement and trapping,
// backdrop dismissal, close-on-navigation, scroll locking, nesting, both themes and two viewports.
//
// Sections 13-14 are here for the same reason and not because they are overlays: a colour that
// resolves through a var() chain and a layout that changes with the viewport can only be answered
// by a real CSS engine at a real width. `npm test` can prove theme.css DEFINES the tokens; only
// getComputedStyle can prove the two highlights come out as different colours in both themes.
// Nothing here ships: `vite build` builds index.html only, so the harness page is dev-server only.
//
// The CCR sandbox has Chromium at /opt/pw-browsers but at a build the installed playwright package
// may not match, so the executable is resolved rather than assumed. Override with PW_CHROMIUM.
import { readdirSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = '/opt/pw-browsers'
  if (!existsSync(root)) return undefined            // let playwright use its own download
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort()
  for (const d of dirs.reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`
    if (existsSync(exe)) return exe
  }
  return undefined
}

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const URL_BASE = `http://localhost:${port}/test/browser/overlay-probe.html`

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message))
page.on('response', (r) => { if (r.status() >= 400) out.push('HTTP ' + r.status() + ' ' + r.url()) })
// Vite's HMR socket and the missing favicon produce console noise on the dev server; only surface
// errors that are not those.
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|net::ERR_CONNECTION_RESET/.test(t)) return
  out.push('CONSOLE-ERR ' + t + ' @ ' + JSON.stringify(m.location()))
})
await page.goto(URL_BASE + '#/packet/abc/jd')
await page.waitForSelector('#open-drawer')

const dialog = () => page.locator('[role="dialog"]')

// ---------- 1. opens, portals to body, correct z-index token ----------
await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
ok('drawer renders', await dialog().isVisible())
const info = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  const root = d.parentElement.parentElement
  const cs = getComputedStyle(d.parentElement)
  const scrim = getComputedStyle(d.previousElementSibling)
  return {
    portalledToBody: root === document.body,
    zIndex: cs.zIndex,
    ariaModal: d.getAttribute('aria-modal'),
    labelled: !!d.getAttribute('aria-labelledby'),
    scrimBg: scrim.backgroundColor,
    width: d.getBoundingClientRect().width,
    height: d.getBoundingClientRect().height,
    right: d.getBoundingClientRect().right,
    bodyClass: document.body.className,
    paneOverflow: document.querySelector('#pane').style.overflow,
  }
})
ok('portalled onto <body> (immune to transformed ancestors)', info.portalledToBody)
ok('z-index resolves from --zindex-overlay (200)', info.zIndex === '200', 'got ' + info.zIndex)
ok('aria-modal + aria-labelledby set', info.ariaModal === 'true' && info.labelled)
ok('scrim paints from --qc-scrim (light)', info.scrimBg === 'rgba(15, 23, 42, 0.34)', info.scrimBg)
ok('drawer is full-height, right-docked, 680px at 1280 viewport', info.width === 680 && info.right === 1280 && info.height === 800, JSON.stringify(info))
ok('page behind is scroll-locked', info.bodyClass.includes('ee-overlay-open') && info.paneOverflow === 'hidden', info.bodyClass + '/' + info.paneOverflow)

// ---------- 2. focus moved into the overlay ----------
const focusInside = await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement))
ok('focus moved into the overlay on open', focusInside)

// ---------- 3. focus trap ----------
const tabOrder = []
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('Tab')
  tabOrder.push(await page.evaluate(() => (document.activeElement && document.activeElement.id) || document.activeElement.tagName + (document.activeElement.getAttribute('aria-label') || '')))
}
const stillInside = await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement))
ok('Tab never escapes the overlay', stillInside, tabOrder.join(' > '))
ok('Tab wraps back to the first control', tabOrder.length > 1 && tabOrder[0] === tabOrder[tabOrder.length - 1], tabOrder.join(' > '))
await page.keyboard.press('Shift+Tab')
ok('Shift+Tab stays inside too', await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)))

// ---------- 4. Escape closes, focus returns to the trigger ----------
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })
ok('Escape closes', (await dialog().count()) === 0)
ok('focus returned to the trigger', (await page.evaluate(() => document.activeElement.id)) === 'open-drawer')
const unlocked = await page.evaluate(() => ({ body: document.body.className, pane: document.querySelector('#pane').style.overflow }))
ok('scroll lock released on close', !unlocked.body.includes('ee-overlay-open') && unlocked.pane !== 'hidden', JSON.stringify(unlocked))

// ---------- 5. scroll position preserved across a lock/unlock ----------
// page.click() scrolls its target into view first, which would reset the pane before the overlay
// even opens — dispatch the click from inside the page so the position under test survives.
await page.evaluate(() => { document.querySelector('#pane').scrollTop = 1200; document.querySelector('#open-drawer').click() })
await dialog().waitFor({ state: 'visible' })
const heldWhileOpen = await page.evaluate(() => document.querySelector('#pane').scrollTop)
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })
const afterClose = await page.evaluate(() => document.querySelector('#pane').scrollTop)
ok('scroll position preserved through the lock', heldWhileOpen === 1200 && afterClose === 1200, `open=${heldWhileOpen} closed=${afterClose}`)

// ---------- 6. backdrop click closes ----------
await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
await page.mouse.click(200, 400)   // left of the 680px right-docked drawer = backdrop
await dialog().waitFor({ state: 'detached' })
ok('backdrop click closes', (await dialog().count()) === 0)

// ---------- 7. clicking INSIDE does not close ----------
await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
await page.click('#drawer-body')
ok('click inside the panel does not close', (await dialog().count()) === 1)

// ---------- 8. CLOSE ON NAVIGATION (P8.5) ----------
await page.evaluate(() => { window.location.hash = '#/packet/abc/cover' })
await dialog().waitFor({ state: 'detached' })
ok('route change (packet step) closes the overlay', (await dialog().count()) === 0)

await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
await page.evaluate(() => { window.location.hash = '#/today' })
await dialog().waitFor({ state: 'detached' })
ok('navigating to another screen closes the overlay', (await dialog().count()) === 0)

// query-only change must NOT close
await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
await page.evaluate(() => { window.location.hash = '#/today?field=summary' })
await page.waitForTimeout(150)
ok('query-only change does NOT close (deep-link into the field)', (await dialog().count()) === 1)
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })

// ---------- 9. modal variant ----------
await page.click('#open-modal')
await dialog().waitFor({ state: 'visible' })
const m = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  const r = d.getBoundingClientRect()
  return { z: getComputedStyle(d.parentElement).zIndex, w: r.width, radius: getComputedStyle(d).borderTopLeftRadius, centred: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 2 }
})
ok('modal z-index resolves from --zindex-modal (300, above the drawer)', m.z === '300', m.z)
ok('modal is centred, 560px, rounded', m.w === 560 && m.centred && m.radius === '12px', JSON.stringify(m))
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })

// ---------- 10. dark theme ----------
await page.click('#toggle-dark')
await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
const darkInfo = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return { scrim: getComputedStyle(d.previousElementSibling).backgroundColor, panel: getComputedStyle(d).backgroundColor, text: getComputedStyle(d).color }
})
ok('dark theme flips --qc-scrim', darkInfo.scrim === 'rgba(2, 6, 12, 0.62)', darkInfo.scrim)
ok('dark theme panel is dark with light text', darkInfo.panel !== 'rgb(255, 255, 255)' && darkInfo.text !== 'rgb(0, 0, 0)', JSON.stringify(darkInfo))
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })
await page.click('#toggle-dark')

// ---------- 11. narrow viewport ----------
await page.setViewportSize({ width: 390, height: 780 })
await page.click('#open-drawer')
await dialog().waitFor({ state: 'visible' })
const narrow = await page.evaluate(() => {
  const r = document.querySelector('[role="dialog"]').getBoundingClientRect()
  return { w: r.width, left: r.left, docW: document.documentElement.scrollWidth, winW: window.innerWidth }
})
ok('drawer never exceeds a 390px viewport', narrow.w <= 390 && narrow.left >= 0 && narrow.docW <= narrow.winW, JSON.stringify(narrow))
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })
await page.setViewportSize({ width: 1280, height: 800 })

await page.click('#open-modal')
await dialog().waitFor({ state: 'visible' })
await page.setViewportSize({ width: 360, height: 720 })
const nm = await page.evaluate(() => {
  const r = document.querySelector('[role="dialog"]').getBoundingClientRect()
  return { w: r.width, h: r.height, winH: window.innerHeight, docW: document.documentElement.scrollWidth, winW: window.innerWidth }
})
ok('modal never exceeds a 360px viewport and is capped at 88vh', nm.w <= 360 * 0.96 + 1 && nm.h <= nm.winH * 0.88 + 1 && nm.docW <= nm.winW, JSON.stringify(nm))

// ---------- 12. nesting: Escape closes only the topmost, lock is reference-counted ----------
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached' })
await page.setViewportSize({ width: 1280, height: 800 })
await page.click('#open-drawer')
await dialog().first().waitFor({ state: 'visible' })
await page.click('#drawer-open-modal')
await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 2)
ok('a modal can open on top of a drawer', (await dialog().count()) === 2)
await page.keyboard.press('Escape')
await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1)
const nested = await page.evaluate(() => ({
  n: document.querySelectorAll('[role="dialog"]').length,
  body: document.body.className,
  pane: document.querySelector('#pane').style.overflow,
}))
ok('Escape closes ONLY the topmost overlay', nested.n === 1, JSON.stringify(nested))
ok('scroll stays locked while the outer overlay is still open', nested.body.includes('ee-overlay-open') && nested.pane === 'hidden', JSON.stringify(nested))
await page.keyboard.press('Escape')
await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0)
const afterAll = await page.evaluate(() => ({ body: document.body.className, pane: document.querySelector('#pane').style.overflow }))
ok('lock released only when the last overlay closes', !afterAll.body.includes('ee-overlay-open') && afterAll.pane === 'auto', JSON.stringify(afterAll))

// ---------- 13. D11: the two highlights resolve to different colours, in BOTH themes ----------
// The defect: carry #fff03a as a literal and the keyword highlight is correct in light mode and
// unreadable in dark, because the text keeps inheriting --proto-ink, which flips to near-white.
const readHighlights = () => page.evaluate(() => {
  const cs = (id) => {
    const s = getComputedStyle(document.getElementById(id))
    return { bg: s.backgroundColor, fg: s.color, rule: s.borderBottomColor, ruleW: s.borderBottomWidth }
  }
  return { kw: cs('kw-highlight'), echo: cs('echo-highlight') }
})
const parseRgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
// WCAG relative luminance — the only way to say "this ink is readable on that ground" rather than
// "these two strings differ", which is what a colour-vs-colour comparison actually proves.
const lum = (c) => {
  const [r, g, b] = parseRgb(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05) }

const lightHl = await readHighlights()
await page.click('#toggle-dark')
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
const darkHl = await readHighlights()
await page.click('#toggle-dark')
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === null)

for (const [theme, hl] of [['light', lightHl], ['dark', darkHl]]) {
  ok(`${theme}: the keyword highlight and the posting echo are different backgrounds`,
    hl.kw.bg !== hl.echo.bg && hl.kw.bg !== 'rgba(0, 0, 0, 0)' && hl.echo.bg !== 'rgba(0, 0, 0, 0)',
    JSON.stringify(hl))
  ok(`${theme}: they are different TREATMENTS - only the echo draws a rule`,
    parseFloat(hl.echo.ruleW) >= 1 && hl.echo.rule !== hl.echo.bg && parseFloat(hl.kw.ruleW) === 0,
    JSON.stringify({ kwRule: hl.kw.ruleW, echoRule: hl.echo.ruleW + ' ' + hl.echo.rule }))
  ok(`${theme}: the keyword ink is readable ON the keyword ground (>= 4.5:1)`,
    contrast(hl.kw.fg, hl.kw.bg) >= 4.5, `${hl.kw.fg} on ${hl.kw.bg} = ${contrast(hl.kw.fg, hl.kw.bg).toFixed(2)}:1`)
  ok(`${theme}: the echo ink is readable on the echo wash (>= 4.5:1)`,
    contrast(hl.echo.fg, hl.echo.bg) >= 4.5, `${hl.echo.fg} on ${hl.echo.bg} = ${contrast(hl.echo.fg, hl.echo.bg).toFixed(2)}:1`)
}
ok('the highlights actually CHANGE between the two themes (the .proto-dark block is not decorative)',
  lightHl.kw.bg !== darkHl.kw.bg && lightHl.echo.bg !== darkHl.echo.bg,
  JSON.stringify({ light: [lightHl.kw.bg, lightHl.echo.bg], dark: [darkHl.kw.bg, darkHl.echo.bg] }))

// ---------- 13b. D18: every brand surface is readable, in BOTH themes ----------
// The ledger carried this as "dark accent pills at 1.90:1". Measured here, all four brand pairings
// are >= 5.5:1 in dark and I could NOT reproduce 1.90 with any of them — see the D18 row, which now
// says so. The likeliest explanation is that the number predates P0: the Compass dark block is
// `:root[data-theme="dark"], .dark` (fig-tokens.css:512), P0 made state.jsx stamp that attribute,
// and `:root[data-theme=...]` (0,2,0) outranks `.proto-dark` (0,1,0) regardless of source order — so
// a whole palette that had never applied started applying, and took this defect with it. Nobody
// fixed D18; it was fixed incidentally, which is exactly why it sat on the ledger reading unfixed.
//
// The pairs are ENUMERATED FROM theme.css, not chosen: `.px-ava` is the pill, and probing only the
// button I first thought of would have proved nothing about the element the row named.
const BRAND_PAIRS = [
  ['px-btn px-btn-accent', 'accent button'],
  ['px-btn px-btn-dark', 'dark button'],
  ['px-ava', 'avatar pill'],
  ['px-tab px-tab-active', 'active tab'],
]
const readBrand = () => page.evaluate((pairs) => pairs.map(([cls, name]) => {
  const el = document.createElement('span')
  el.className = cls
  el.textContent = 'Ap'
  document.body.appendChild(el)
  const st = getComputedStyle(el)
  // A transparent ground is read against what is actually behind it, or the measurement is of a
  // colour no eye ever sees.
  const bg = st.backgroundColor === 'rgba(0, 0, 0, 0)' || st.backgroundColor === 'transparent'
    ? getComputedStyle(document.body).backgroundColor
    : st.backgroundColor
  const out = { name, cls, bg, fg: st.color }
  el.remove()
  return out
}), BRAND_PAIRS)

const lightBrand = await readBrand()
await page.click('#toggle-dark')
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
const darkBrand = await readBrand()
await page.click('#toggle-dark')
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === null)

for (const [theme, list] of [['light', lightBrand], ['dark', darkBrand]]) {
  for (const b of list) {
    ok(`${theme}: the ${b.name} is readable on its own ground (>= 4.5:1)`,
      contrast(b.fg, b.bg) >= 4.5, `${b.fg} on ${b.bg} = ${contrast(b.fg, b.bg).toFixed(2)}:1`)
  }
}

// ---------- 14. P8.7: the keyword list is 2-up at >= 1040px and 1-up below ----------
await page.click('#posting-card [data-qc="jd-tab"][data-qc-tab="keywords"]')
await page.waitForSelector('#posting-card [data-qc="keyword-columns"]')
const columnsAt = async (w) => {
  await page.setViewportSize({ width: w, height: 900 })
  await page.waitForTimeout(120)
  return page.evaluate(() => {
    const el = document.querySelector('[data-qc="keyword-columns"]')
    return {
      attr: el.getAttribute('data-qc-cols'),
      tracks: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
      groups: [...el.querySelectorAll('[data-qc="keyword-group"]')].map((g) => Math.round(g.getBoundingClientRect().top)),
    }
  })
}
const wide = await columnsAt(1040)
const justUnder = await columnsAt(1039)
const oneUp = await columnsAt(720)
ok('1040px is 2-up (the breakpoint itself, not one pixel above it)', wide.attr === '2' && wide.tracks === 2, JSON.stringify(wide))
ok('1039px is 1-up', justUnder.attr === '1' && justUnder.tracks === 1, JSON.stringify(justUnder))
ok('720px is 1-up', oneUp.attr === '1' && oneUp.tracks === 1, JSON.stringify(oneUp))
// The attribute is what ui-verify selects on, so it must describe the layout that was actually
// drawn - two groups sharing a row - and not merely agree with the track count it also sets.
ok('2-up really places two groups side by side',
  new Set(wide.groups).size < wide.groups.length, JSON.stringify(wide.groups))
ok('1-up stacks them', new Set(oneUp.groups).size === oneUp.groups.length, JSON.stringify(oneUp.groups))
await page.setViewportSize({ width: 1280, height: 800 })

console.log(out.join('\n'))
const failed = out.filter((l) => !l.startsWith('PASS'))
console.log(`\n${out.length - failed.length}/${out.length} checks passed`)
await browser.close()
await server.close()
process.exit(failed.length ? 1 : 0)

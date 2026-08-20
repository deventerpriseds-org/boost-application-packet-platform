// Browser probe for the <Overlay> primitive (src/shell.jsx + src/overlay.js).
//
//   cd app && npm run test:browser
//
// It boots its own Vite dev server, drives the real component in headless Chromium and asserts the
// behaviours that `npm test` cannot reach without a DOM: Escape, focus movement and trapping,
// backdrop dismissal, close-on-navigation, scroll locking, nesting, both themes and two viewports.
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

console.log(out.join('\n'))
const failed = out.filter((l) => !l.startsWith('PASS'))
console.log(`\n${out.length - failed.length}/${out.length} checks passed`)
await browser.close()
await server.close()
process.exit(failed.length ? 1 : 0)

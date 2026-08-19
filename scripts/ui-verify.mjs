// Playwright UI verifier — loads the LIVE Executive Engine SPA in headless Chromium, impersonates a
// real owner (by seeding localStorage the same way a Microsoft sign-in does), navigates to a hash
// route, waits for the SPA to fetch + render, then asserts required text is present and screenshots
// the page. Runs in GitHub Actions (open internet → can reach both the Static Web App and the
// Function API, and can execute the React bundle — which Tavily/WebFetch cannot).
//
// Env inputs:
//   APP_URL       base of the SPA (default = production SWA)
//   ROUTE         hash route to open, e.g. "#/settings/roles"
//   OWNER         email to impersonate as data owner (seeds ee_auth_user)
//   EXPECT        ';'-separated substrings that must ALL appear in the rendered body text
//   EXPECT_ABSENT ';'-separated substrings that must NOT appear (proves a duplicate/stale surface is gone)
//   COUNT_SEL     optional CSS selector to count
//   COUNT_MIN     optional minimum count for COUNT_SEL
//   COUNT_MAX     optional maximum count for COUNT_SEL (use 0 to assert absence of an element)
//   CLICK_SEL     optional CSS selector to click BEFORE asserting (reaches surfaces behind an interaction)
//   CLICK_WAIT    ms to wait after the click (default 1200)
//   MEASURE_SEL   optional CSS selector to measure; reports width/height/visible in the result
//   VIEWPORT_W/H  viewport size (default 1440x1700) — required to assert responsive breakpoints
//   OUT           screenshot path (default ui-verify.png)
//
// Why these exist: the original script could only assert positive body text at a fixed 1440 width. It
// could not click, measure, vary viewport, or assert absence — so every breakpoint rule, every
// overlay, every "renders exactly once" rule and everything behind a tab was unverifiable.
import { chromium } from 'playwright'

const APP_URL     = (process.env.APP_URL || 'https://purple-ground-0f377120f.7.azurestaticapps.net').replace(/\/$/, '')
const ROUTE       = process.env.ROUTE || '#/settings/roles'
const OWNER       = process.env.OWNER || 'von.ellis@enterpriseds.io'
const EXPECT      = (process.env.EXPECT || '').split(';').map((s) => s.trim()).filter(Boolean)
const EXPECT_ABS  = (process.env.EXPECT_ABSENT || '').split(';').map((s) => s.trim()).filter(Boolean)
const COUNT_SEL   = process.env.COUNT_SEL || ''
const COUNT_MIN   = parseInt(process.env.COUNT_MIN || '0', 10)
const COUNT_MAX   = process.env.COUNT_MAX === undefined || process.env.COUNT_MAX === '' ? null : parseInt(process.env.COUNT_MAX, 10)
const CLICK_SEL   = process.env.CLICK_SEL || ''
const CLICK_WAIT  = parseInt(process.env.CLICK_WAIT || '1200', 10)
const MEASURE_SEL = process.env.MEASURE_SEL || ''
const VIEWPORT_W  = parseInt(process.env.VIEWPORT_W || '1440', 10)
const VIEWPORT_H  = parseInt(process.env.VIEWPORT_H || '1700', 10)
const OUT         = process.env.OUT || 'ui-verify.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 300)))

// 1) hit the origin so we can write its localStorage, 2) impersonate the owner, 3) load the route.
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.evaluate((owner) => {
  localStorage.setItem('ee_auth_user', JSON.stringify({ email: owner, name: owner, provider: 'microsoft' }))
  localStorage.setItem('ee_show_demo', 'false')   // exclude demo/sample rows from owner-scoped reads
}, OWNER)
// Navigate to the target hash, then RELOAD so React re-mounts and reads ee_auth_user on boot (past the
// login gate as the impersonated owner). A hash-only change would not remount, leaving auth.user null.
await page.goto(`${APP_URL}/${ROUTE}`, { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4500)   // let the SPA finish its fetch + render

// Optional interaction, so surfaces behind a click (tabs, overlays, disclosure) can be asserted.
let clicked = null
if (CLICK_SEL) {
  const target = page.locator(CLICK_SEL).first()
  if (await target.count()) { await target.click({ timeout: 5000 }).catch((e) => { clicked = 'error: ' + String(e).slice(0, 200) }) ; if (clicked === null) clicked = 'ok' }
  else clicked = 'not found'
  await page.waitForTimeout(CLICK_WAIT)
}

const bodyText = await page.evaluate(() => document.body.innerText || '')
const count = COUNT_SEL ? await page.locator(COUNT_SEL).count() : null
const measure = MEASURE_SEL
  ? await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { width: Math.round(r.width), height: Math.round(r.height), visible: r.width > 0 && r.height > 0 }
    }, MEASURE_SEL)
  : null
await page.screenshot({ path: OUT, fullPage: true })
await browser.close()

const missingExpect = EXPECT.filter((s) => !bodyText.includes(s))
const presentForbidden = EXPECT_ABS.filter((s) => bodyText.includes(s))
const countOk = !COUNT_SEL || (count != null && count >= COUNT_MIN && (COUNT_MAX === null || count <= COUNT_MAX))
const clickOk = !CLICK_SEL || clicked === 'ok'
const measureOk = !MEASURE_SEL || measure !== null
const ok = missingExpect.length === 0 && presentForbidden.length === 0 && countOk && clickOk && measureOk
const result = {
  ok, url: `${APP_URL}/${ROUTE}`, owner: OWNER, viewport: { w: VIEWPORT_W, h: VIEWPORT_H },
  bodyLen: bodyText.length, bodySnippet: bodyText.replace(/\s+/g, ' ').slice(0, 500),
  expect: EXPECT, missingExpect,
  expectAbsent: EXPECT_ABS, presentForbidden,
  countSel: COUNT_SEL || null, count, countMin: COUNT_MIN, countMax: COUNT_MAX,
  clickSel: CLICK_SEL || null, clicked,
  measureSel: MEASURE_SEL || null, measure,
  consoleErrors: consoleErrors.slice(0, 10), screenshot: OUT,
}
console.log('UI_VERIFY_RESULT ' + JSON.stringify(result, null, 2))
process.exit(ok ? 0 : 1)

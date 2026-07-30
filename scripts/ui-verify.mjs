// Playwright UI verifier — loads the LIVE Executive Engine SPA in headless Chromium, impersonates a
// real owner (by seeding localStorage the same way a Microsoft sign-in does), navigates to a hash
// route, waits for the SPA to fetch + render, then asserts required text is present and screenshots
// the page. Runs in GitHub Actions (open internet → can reach both the Static Web App and the
// Function API, and can execute the React bundle — which Tavily/WebFetch cannot).
//
// Env inputs:
//   APP_URL    base of the SPA (default = production SWA)
//   ROUTE      hash route to open, e.g. "#/settings/roles"
//   OWNER      email to impersonate as data owner (seeds ee_auth_user)
//   EXPECT     ';'-separated substrings that must ALL appear in the rendered body text
//   COUNT_SEL  optional CSS selector to count
//   COUNT_MIN  optional minimum count for COUNT_SEL
//   OUT        screenshot path (default ui-verify.png)
import { chromium } from 'playwright'

const APP_URL   = (process.env.APP_URL || 'https://purple-ground-0f377120f.7.azurestaticapps.net').replace(/\/$/, '')
const ROUTE     = process.env.ROUTE || '#/settings/roles'
const OWNER     = process.env.OWNER || 'von.ellis@enterpriseds.io'
const EXPECT    = (process.env.EXPECT || '').split(';').map((s) => s.trim()).filter(Boolean)
const COUNT_SEL = process.env.COUNT_SEL || ''
const COUNT_MIN = parseInt(process.env.COUNT_MIN || '0', 10)
const OUT       = process.env.OUT || 'ui-verify.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1700 } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 300)))

// 1) hit the origin so we can write its localStorage, 2) impersonate the owner, 3) load the route.
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.evaluate((owner) => {
  localStorage.setItem('ee_auth_user', JSON.stringify({ email: owner, name: owner, provider: 'microsoft' }))
  localStorage.setItem('ee_show_demo', 'false')   // exclude demo/sample rows from owner-scoped reads
}, OWNER)
await page.goto(`${APP_URL}/${ROUTE}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)   // let the SPA finish its fetch + render

const bodyText = await page.evaluate(() => document.body.innerText || '')
const count = COUNT_SEL ? await page.locator(COUNT_SEL).count() : null
await page.screenshot({ path: OUT, fullPage: true })
await browser.close()

const missingExpect = EXPECT.filter((s) => !bodyText.includes(s))
const countOk = !COUNT_SEL || (count != null && count >= COUNT_MIN)
const ok = missingExpect.length === 0 && countOk
const result = {
  ok, url: `${APP_URL}/${ROUTE}`, owner: OWNER, bodyLen: bodyText.length,
  expect: EXPECT, missingExpect, countSel: COUNT_SEL || null, count, countMin: COUNT_MIN,
  consoleErrors: consoleErrors.slice(0, 10), screenshot: OUT,
}
console.log('UI_VERIFY_RESULT ' + JSON.stringify(result, null, 2))
process.exit(ok ? 0 : 1)

// Render THIS REPO'S app build headless, from inside the sandbox, against fixture API responses.
//
// WHY THIS EXISTS. Verifying a UI change used to mean a ~50s round trip through ui-verify.yml, and
// what came back was TEXT: a body length, a substring match, an element count. The screenshot it
// uploads cannot be downloaded here - the egress proxy 403s both the artifact URL and the
// api.github.com zip endpoint, with or without a token. So a session ends up reasoning about
// screenshot FILE SIZES instead of looking at the page. The owner named it: "wait using a kb test
// is crazy.... why aren't you actually rendering both the live app and the prototype to compare?"
//
// The live host is unreachable from here, but nothing about the LIVE HOST is what we are checking -
// we are checking this repo's components. So: serve the real `app/dist` bundle over localhost and
// fulfil every `/api/**` request from a fixture file. Real bundle, real React, real components,
// real data pulled out of the production DB. Pair it with `render-spec.mjs` and both sides of a
// design comparison render locally, in about two seconds, with no network at all.
//
// FIXTURES. `--fixtures <file>` is JSON: { "<url-substring>": <response body>, ... }. The LONGEST
// matching key wins, so "/opportunity/<id>/packet" beats "/opportunity/<id>" for the packet call. An unmatched /api/ request is fulfilled with `{}` AND
// REPORTED in `unmatched` - a silent {} is how a screen renders empty and looks like a bug.
//
// USAGE
//   node scripts/render-app.mjs --route '#/packet/<oppId>/resume' --fixtures f.json --out /tmp/a.png
//   node scripts/render-app.mjs --route '#/packet/<oppId>/resume' --fixtures f.json --text

import { chromium } from 'playwright-core'
import { assertFixtureCanSee } from './lib/fixture-canary.mjs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const has = (k) => process.argv.includes(`--${k}`)

const DIST     = resolve(arg('dist', 'app/dist'))
const ROUTE    = arg('route', '#/packets')
const OWNER    = arg('owner', 'von.ellis@enterpriseds.io')
const OUT      = arg('out', '/tmp/render-app.png')
const PORT     = Number(arg('port', '8931'))
const EXE      = arg('exe', process.env.PWEXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
const FIXTURES = arg('fixtures', '')
const SEL      = arg('count', '')

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} - run \`cd app && npm run build\` first`)
  process.exit(2)
}
const fixtures = FIXTURES ? JSON.parse(await readFile(resolve(FIXTURES), 'utf8')) : {}
// The same canary compare-ui.mjs runs. THIS script is the one that actually produced the
// "app renders nothing" reading on 2026-08-29 (627 chars of shell, pageErrors: []), so leaving it
// unguarded while guarding its sibling would have left the hole exactly where it was walked into.
// Skipped when no --fixtures was given: rendering against the real API is not a starved fixture.
if (FIXTURES) assertFixtureCanSee(fixtures, 'render-app.mjs')

// ---- serve the built SPA (any unknown path falls back to index.html, as the host does) ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  const path = join(DIST, decodeURIComponent(req.url.split('?')[0]))
  try {
    const buf = await readFile(path)
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(await readFile(join(DIST, 'index.html')))
  }
})
await new Promise((r) => server.listen(PORT, r))

const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: Number(arg('w', '1440')), height: Number(arg('h', '1700')) } })

const served = [], unmatched = []
await ctx.route('**/*', async (route) => {
  const url = route.request().url()
  if (!/\/api\//.test(url)) return route.continue()
  const path = url.replace(/^https?:\/\/[^/]+/, '')
  // LONGEST match wins, not first: '/opportunity/<id>' is a substring of
  // '/opportunity/<id>/packet', and first-match-wins would silently serve the opportunity body
  // to the packet request - a screen rendering on the wrong fixture, which looks like a bug in
  // the component rather than in this harness.
  const key = Object.keys(fixtures).filter((k) => path.includes(k)).sort((a, b) => b.length - a.length)[0]
  if (key) served.push(path)
  else unmatched.push(path)
  return route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(key ? fixtures[key] : {}),
  })
})

const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 220)))

// The auth gate reads localStorage on mount, so it must be seeded BEFORE the app boots and the page
// must then RELOAD - a hash-only navigation will not remount React past the login screen. Same
// sequence ui-verify.mjs uses against the live host.
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await page.evaluate((o) => localStorage.setItem('ee_auth_user', JSON.stringify({ email: o, name: 'Owner', provider: 'google' })), OWNER)
await page.goto(`http://localhost:${PORT}/${ROUTE}`, { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(Number(arg('settle', '3000')))
// Optional interaction BEFORE the shot, so a surface that only exists behind a click - a tab, a
// disclosure, the keyword tally modal - can be rendered here rather than only on a GH runner. The
// same capability ui-verify.mjs has had as CLICK_SEL since P8.5; this is the local half, added for
// SPEC 4.3-9's QC summary, which lives inside a modal and is otherwise unreachable from the sandbox.
const CLICK = arg('click', '')
if (CLICK) {
  const target = page.locator(CLICK).first()
  if (await target.count()) await target.click({ timeout: 5000 })
  else pageErrors.push(`click selector not found: ${CLICK}`)
  await page.waitForTimeout(Number(arg('clickwait', '900')))
}

// Scroll a named region into view before the shot, so a screenshot can show ONE surface rather than
// a full page nobody can read. Added for the 4.2-1 fit-card comparison; harmless when unset.
const SCROLL = arg('scrollto', '')
if (SCROLL) {
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'center' }) }, SCROLL)
  await page.waitForTimeout(700)
}

const text = await page.evaluate(() => document.body.innerText)
const count = SEL ? await page.locator(SEL).count() : null
if (!has('text')) await page.screenshot({ path: OUT, fullPage: has('full') })

console.log(JSON.stringify({
  route: ROUTE,
  clicked: CLICK || null,
  out: has('text') ? null : OUT,
  bodyLen: text.length,
  count: SEL ? { selector: SEL, count } : null,
  // Every fixture that was actually asked for, and every /api/ call that fell through to `{}`.
  // The second list is the important one: an unfixtured call is a screen rendering on nothing.
  servedFixtures: [...new Set(served)],
  unmatched: [...new Set(unmatched)],
  pageErrors,
}, null, 2))
if (has('text')) console.log('\n--- BODY TEXT ---\n' + text)

await browser.close()
server.close()

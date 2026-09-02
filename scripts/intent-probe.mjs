// Intent probe: drive the APP (app/dist) or the PROTOTYPE (docs/qc-evidence) with Playwright and
// answer "can a user DO this thing" — not "does a component exist in source".
//
// WHY THIS EXISTS, AND WHY IT IS NOT A THIRD RENDERER. `render-app.mjs` and `render-spec.mjs`
// each render ONE side and take at most a single `--click`. This runs a SCRIPTED SEQUENCE against
// either side — click, wait, assert text, count nodes, screenshot, then click again — which is what
// a parity question actually needs, because most of the prototype's verbs sit two interactions deep
// (open the drawer, THEN the Match tab). Serving/auth/fixture-routing is deliberately the same
// shape as those two files rather than a new approach.
//
// IT EXISTS BECAUSE OF A METHOD ERROR, owner-stated 2026-09-02: *"to say it's not a gap because it
// hasn't had enough development to be able to do it is silly."* A control that cannot render because
// the packet carries no data is UNPROVEN, not absent and not deliberate. So the workflow this script
// is built for is: MANUFACTURE the missing state in the fixture, then click the control. Three rows
// of PROTOTYPE-COVERAGE.md were wrong until that was done (4.8-8, 4.10-8, 4.8-22) — see §17e.
//
// USAGE
//   node scripts/intent-probe.mjs --side app  --route '#/packet/<opp>/qc' --fixtures /tmp/fx.json --steps steps.json
//   node scripts/intent-probe.mjs --side spec --step qc --vendor /tmp/vendor --steps steps.json
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, mkdir, cp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const SIDE = arg('side', 'app')
const PORT = Number(arg('port', '8944'))
const EXE = arg('exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
const STEPS = JSON.parse(await readFile(resolve(arg('steps', '')), 'utf8'))
const OUTDIR = arg('outdir', '/tmp/probe')
await mkdir(OUTDIR, { recursive: true })

let ROOT, START
if (SIDE === 'app') {
  ROOT = resolve(arg('dist', 'app/dist'))
  START = `http://localhost:${PORT}/${arg('route', '#/packets')}`
} else {
  // Prototype: copy the package to a work dir, vendor the three CDN scripts, fix the token path.
  const PKG = resolve(arg('pkg', 'docs/qc-evidence'))
  const WORK = '/tmp/probe-spec'
  await mkdir(WORK, { recursive: true })
  await cp(PKG, WORK, { recursive: true })
  await cp(resolve(arg('vendor', '/tmp/vendor')), join(WORK, 'vendor'), { recursive: true })
  let html = await readFile(join(PKG, 'Packet QC Prototype.html'), 'utf8')
  html = html.replace(/<script src="https:\/\/unpkg\.com\/react@[^"]*"[^>]*><\/script>/, '<script src="vendor/react.js"></script>')
             .replace(/<script src="https:\/\/unpkg\.com\/react-dom@[^"]*"[^>]*><\/script>/, '<script src="vendor/react-dom.js"></script>')
             .replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"]*"[^>]*><\/script>/, '<script src="vendor/babel.js"></script>')
  await writeFile(join(WORK, 'index.html'), html)
  // theme.css @imports tokens from a _ds/... path the package ships at app/src/tokens
  const m = (await readFile(join(WORK, 'app/src/theme.css'), 'utf8')).match(/@import\s+["']([^"']*tokens\/)/)
  if (m) { await mkdir(join(WORK, 'app/src', m[1]), { recursive: true }); await cp(join(WORK, 'app/src/tokens'), join(WORK, 'app/src', m[1]), { recursive: true }) }
  ROOT = WORK
  START = `http://localhost:${PORT}/index.html`
}

const fixtures = arg('fixtures', '') ? JSON.parse(await readFile(resolve(arg('fixtures', '')), 'utf8')) : {}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]))
  try {
    const buf = await readFile(p)
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(buf)
  } catch {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(await readFile(join(ROOT, SIDE === 'app' ? 'index.html' : 'index.html')))
  }
})
await new Promise((r) => server.listen(PORT, r))

const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: Number(arg('w', '1280')), height: Number(arg('h', '1600')) } })
const errs = []
ctx.on('weberror', (e) => errs.push(String(e.error()).slice(0, 200)))

if (SIDE === 'app') {
  await ctx.route('**/*', async (route) => {
    const url = route.request().url()
    if (!/\/api\//.test(url)) return route.continue()
    let best = null
    for (const k of Object.keys(fixtures)) if (url.includes(k) && (!best || k.length > best.length)) best = k
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(best ? fixtures[best] : {}) })
  })
}
const page = await ctx.newPage()
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))

if (SIDE === 'app') {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((o) => {
    localStorage.setItem('ee_auth_user', JSON.stringify({ email: o, name: o, provider: 'microsoft' }))
    localStorage.setItem('ee_show_demo', 'false')
  }, arg('owner', 'von.ellis@enterpriseds.io'))
}
await page.goto(START, { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(Number(arg('settle', '3500')))

const results = []
for (const st of STEPS) {
  const r = { name: st.name, action: st.click || st.clickText || '(observe)' }
  try {
    if (st.click) {
      const loc = page.locator(st.click).first()
      r.found = await loc.count() > 0
      if (r.found) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.click({ timeout: 4000 }); await page.waitForTimeout(st.wait || 1200) }
    } else if (st.clickText) {
      const loc = page.locator(`text=${st.clickText}`).first()
      r.found = await loc.count() > 0
      if (r.found) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.click({ timeout: 4000 }); await page.waitForTimeout(st.wait || 1200) }
    } else r.found = true
  } catch (e) { r.clickError = String(e).split('\n')[0].slice(0, 160) }

  if (st.expect) {
    const body = await page.evaluate(() => document.body.innerText)
    r.expect = Object.fromEntries(st.expect.map((s) => [s, body.includes(s)]))
  }
  if (st.count) r.count = await page.locator(st.count).count()
  if (st.readSel) {
    r.text = (await page.locator(st.readSel).allInnerTexts()).slice(0, st.readN || 6).map((t) => t.replace(/\s+/g, ' ').slice(0, 220))
  }
  if (st.shot) await page.screenshot({ path: join(OUTDIR, st.shot), fullPage: !!st.full })
  results.push(r)
}
console.log(JSON.stringify({ side: SIDE, pageErrors: errs.slice(0, 5), results }, null, 2))
await browser.close(); server.close()

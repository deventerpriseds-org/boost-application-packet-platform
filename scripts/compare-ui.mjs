// Structural diff of the DESIGN PROTOTYPE against THIS REPO'S app, one packet-builder step at a
// time, both rendered locally in about two seconds.
//
// WHY THIS EXISTS. Twice in one day an "alignment" was declared from eyeballing one component. The
// resume step diverged in at least six ways nobody had enumerated - field order, the answers panel,
// keyword chips, the doc buttons, the word target, the nav - and each was found only when the owner
// pointed at it. Owner: "can't you see now that the resume tab isn't closely aligned with the
// prototype? your tight UI alignment to the prototype wasn't successful", then: "it has to be for
// the entire spec for the packets module not only tight UI alignment for the resume tab".
//
// A structural diff is the cheap half of that problem and it is fully mechanical: which panels
// exist, what they are called, whether they are open or closed, what order the fields appear in,
// which controls are offered. Run it per step and the remaining work is a LIST rather than a memory
// test.
//
// WHAT IT DOES NOT DO, deliberately: pixels. Visual diffing is fragile and its failures are mostly
// noise. Hierarchy, emphasis and spacing are better judged by a person or an agent LOOKING at the
// two screenshots this script can also write. Structure here; judgement there.
//
// USAGE
//   node scripts/compare-ui.mjs --step resume  --vendor <dir> --fixtures <f.json>
//   node scripts/compare-ui.mjs --all          --vendor <dir> --fixtures <f.json> --json /tmp/gap.json
//
// The app side needs fixtures because the live API is unreachable from the sandbox; build them from
// the production DB via db-query.yml. See scripts/render-app.mjs for the fixture format.

import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const has = (k) => process.argv.includes(`--${k}`)

const PKG      = resolve(arg('pkg', 'docs/qc-evidence'))
const DIST     = resolve(arg('dist', 'app/dist'))
const VENDOR   = arg('vendor', '')
const FIXTURES = arg('fixtures', '')
const OPP      = arg('opp', '2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3')
const EXE      = arg('exe', process.env.PWEXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
const WIDTH    = Number(arg('w', '1340'))
const JSON_OUT = arg('json', '')

// The prototype's label for a step, and this app's route key for the same step. They are not the
// same string - step 1 is "JD analysis" there and "Posting analysis" here, deliberately (the app
// reserves "ATS" for the keyword library). A rename is a difference worth SEEING, not worth having
// the harness silently paper over, so both names are carried and reported.
const STEPS = [
  { key: 'jd',        proto: 'JD analysis',    app: 'Posting analysis' },
  { key: 'resume',    proto: 'Resume',         app: 'Resume' },
  { key: 'cover',     proto: 'Cover letter',   app: 'Cover letter' },
  { key: 'portfolio', proto: 'Portfolio',      app: 'Portfolio' },
  { key: 'video',     proto: 'Intro video',    app: 'Intro video' },
  { key: 'qc',        proto: 'QC & evidence',  app: 'QC & evidence' },
  { key: 'send',      proto: 'Review & send',  app: 'Review & send' },
]

// ---- one tiny static server, reused for both sides -----------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
function serve(dir, port, spa) {
  const s = createServer(async (req, res) => {
    const p = join(dir, decodeURIComponent(req.url.split('?')[0]))
    try {
      const b = await readFile(p)
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b)
    } catch {
      if (!spa) { res.writeHead(404).end('no'); return }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await readFile(join(dir, 'index.html')))
    }
  })
  return new Promise((r) => s.listen(port, () => r(s)))
}

/**
 * The STRUCTURE of whatever is on screen, read out of the live DOM.
 *
 * Everything here is something a reader can see and name. Nothing is a pixel measurement and nothing
 * depends on class names, which differ between a prototype and a production app by design.
 */
const EXTRACT = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('*')].filter(vis)

  // A "panel" is a titled block: a short, bold-ish line that opens a region. Matching on weight and
  // length rather than on a class keeps this working across two unrelated stylesheets.
  const panels = all
    .filter((el) => el.children.length === 0 && txt(el).length > 3 && txt(el).length < 60)
    .filter((el) => Number(getComputedStyle(el).fontWeight) >= 600)
    .map((el) => txt(el))

  const controls = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(vis).map((el) => txt(el)).filter((t) => t && t.length < 40)

  // Anything that publishes an open/closed state - the app's data-qc-open, or a prototype element
  // whose own text carries the affordance.
  const disclosures = [...document.querySelectorAll('[data-qc-open]')].filter(vis)
    .map((el) => ({ what: el.getAttribute('data-qc') || el.tagName.toLowerCase(), open: el.getAttribute('data-qc-open') === '1' }))

  const showHide = all.filter((el) => el.children.length === 0 && /^(Show|Hide)\b/.test(txt(el))).map(txt)

  return {
    panels: [...new Set(panels)],
    controls: [...new Set(controls)],
    disclosures,
    showHide: [...new Set(showHide)],
    bodyLen: document.body.innerText.length,
  }
}

// ---- prototype -----------------------------------------------------------------------------------
async function protoSide(browser, step) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1600 } })
  await page.goto(`http://localhost:8961/index.html`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 45000 })
  await page.waitForTimeout(2000)
  const tokenOk = await page.evaluate(() =>
    !!getComputedStyle(document.documentElement).getPropertyValue('--surface-background-secondary').trim())
  if (!tokenOk) throw new Error('prototype rendered with NO design tokens - see render-spec.mjs gotcha 2')
  const hit = page.locator(`text=/^${step.proto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$/`).first()
  if (await hit.count()) { await hit.click(); await page.waitForTimeout(1600) }
  const out = await page.evaluate(EXTRACT)
  await page.close()
  return out
}

// ---- app -----------------------------------------------------------------------------------------
async function appSide(browser, step, fixtures) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1600 } })
  const unmatched = []
  await ctx.route('**/*', async (route) => {
    const url = route.request().url()
    if (!/\/api\//.test(url)) return route.continue()
    const p = url.replace(/^https?:\/\/[^/]+/, '')
    const key = Object.keys(fixtures).filter((k) => p.includes(k)).sort((a, b) => b.length - a.length)[0]
    if (!key) unmatched.push(p)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(key ? fixtures[key] : {}) })
  })
  const page = await ctx.newPage()
  await page.goto('http://localhost:8962/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('ee_auth_user', JSON.stringify({ email: 'von.ellis@enterpriseds.io', name: 'Owner', provider: 'google' })))
  await page.goto(`http://localhost:8962/#/packet/${OPP}/${step.key}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)
  const out = await page.evaluate(EXTRACT)
  out.unmatchedFixtures = [...new Set(unmatched)]
  await ctx.close()
  return out
}

// ---- assemble ------------------------------------------------------------------------------------
if (!existsSync(join(DIST, 'index.html'))) { console.error(`no app build at ${DIST}`); process.exit(2) }
const fixtures = FIXTURES ? JSON.parse(await readFile(resolve(FIXTURES), 'utf8')) : {}

// Stage the prototype the way render-spec.mjs does, including the token path its theme.css @imports
// but the package does not ship at.
const WORK = '/tmp/compare-proto'
const themeSrc = await readFile(join(PKG, 'app/src/theme.css'), 'utf8')
const DS_ID = (themeSrc.match(/_ds\/([^/]+)\/tokens\//) || [])[1]
if (!DS_ID) { console.error('theme.css no longer @imports _ds/<id>/tokens/'); process.exit(2) }
await mkdir(join(WORK, `_ds/${DS_ID}/tokens`), { recursive: true })
await mkdir(join(WORK, 'app/src'), { recursive: true })
await cp(join(PKG, 'qc'), join(WORK, 'qc'), { recursive: true })
await cp(join(PKG, 'app/src/theme.css'), join(WORK, 'app/src/theme.css'))
await cp(join(PKG, 'app/src/tokens'), join(WORK, `_ds/${DS_ID}/tokens`), { recursive: true })
let html = await readFile(join(PKG, 'Packet QC Prototype.html'), 'utf8')
if (VENDOR) {
  await cp(resolve(VENDOR), join(WORK, 'vendor'), { recursive: true })
  html = html
    .replace(/<script src="https:\/\/unpkg\.com\/react@[^"]*"[^>]*><\/script>/, '<script src="vendor/react.js"></script>')
    .replace(/<script src="https:\/\/unpkg\.com\/react-dom@[^"]*"[^>]*><\/script>/, '<script src="vendor/react-dom.js"></script>')
    .replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"]*"[^>]*><\/script>/, '<script src="vendor/babel.js"></script>')
}
await writeFile(join(WORK, 'index.html'), html)

const s1 = await serve(WORK, 8961, false)
const s2 = await serve(DIST, 8962, true)
const wanted = has('all') ? STEPS : STEPS.filter((s) => s.key === arg('step', 'resume'))
const report = []
for (const step of wanted) {
  // One step that throws must NOT cost the other six. A seven-step report is the whole point, and
  // an exception here previously took the entire run down and wrote no file at all.
  // ONE BROWSER PER STEP. A shared instance died partway through a seven-step run and every step
  // after it reported "Target page, context or browser has been closed" - six empty rows from one
  // crash. Launch costs ~300ms; a lost report costs the whole run.
  const browser = await chromium.launch({ executablePath: EXE })
  let proto, app
  try { proto = await protoSide(browser, step) }
  catch (e) { await browser.close().catch(() => {}); report.push({ step: step.key, error: 'prototype: ' + String(e.message || e).slice(0, 160) }); continue }
  try { app = await appSide(browser, step, fixtures) }
  catch (e) { await browser.close().catch(() => {}); report.push({ step: step.key, error: 'app: ' + String(e.message || e).slice(0, 160) }); continue }
  const only = (a, b) => a.filter((x) => !b.some((y) => y.toLowerCase() === x.toLowerCase()))
  report.push({
    step: step.key,
    names: step.proto === step.app ? step.proto : `${step.proto} (proto) / ${step.app} (app)`,
    panelsOnlyInPrototype: only(proto.panels, app.panels),
    panelsOnlyInApp: only(app.panels, proto.panels),
    controlsOnlyInPrototype: only(proto.controls, app.controls),
    controlsOnlyInApp: only(app.controls, proto.controls),
    prototypeDisclosures: proto.showHide,
    appDisclosures: app.disclosures,
    bodyLen: { prototype: proto.bodyLen, app: app.bodyLen },
    unmatchedFixtures: app.unmatchedFixtures,
  })
  await browser.close().catch(() => {})
}

s1.close(); s2.close()
const text = JSON.stringify(report, null, 1)
if (JSON_OUT) await writeFile(JSON_OUT, text)
console.log(text)

// Render the design-package PROTOTYPE headless, from inside the sandbox, with no network.
//
// WHY THIS EXISTS
// A session read two paragraphs of `Evidence Model & QC Lineage.html` (§5a, §7) that say the QC
// rail step was "Dropped", and told the owner the step was gone. It is not: the prototype those
// paragraphs claim to describe contains the step. The owner caught it by opening the prototype.
// Prose about a screen is not evidence when the screen is executable. Run this instead.
//
// TWO GOTCHAS, BOTH OF WHICH FAIL SILENTLY-ISH:
//
//  1. Babel cannot XHR the `.jsx` files over `file://` (CORS). Opening the HTML directly yields an
//     EMPTY #root and a body length of 0 — it looks like the prototype is broken rather than like a
//     transport problem. It MUST be served over HTTP.
//
//  2. `app/src/theme.css` @imports three token files from
//     `_ds/compass-design-system-<uuid>/tokens/`, but the package ships them at
//     `app/src/tokens/`. If they are not copied to the path the @import names, all three 404 and
//     the page renders in FULL COLOUR-LESS FALLBACK — structurally correct, visually nothing like
//     the design. `fig-tokens.css` is the colour file. This produced a screenshot that the owner
//     immediately flagged as "not showing the colors applied".
//     GUARD: this script asserts a token actually resolved before it will screenshot.
//
// USAGE
//   node scripts/render-spec.mjs --step qc   --out /tmp/spec-qc.png
//   node scripts/render-spec.mjs --step resume --out /tmp/spec-resume.png
//   node scripts/render-spec.mjs --list                 # print the rendered rail and exit
//
// REQUIREMENTS
//   npm i --no-save playwright-core
//   React/ReactDOM/Babel: the prototype loads them from unpkg, which the sandbox egress blocks.
//   Pass --vendor <dir> holding react.js / react-dom.js / babel.js (extract them once from the
//   published artifact bundle), and the script rewrites the three <script src> tags to use them.

import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d }
const has = (k) => process.argv.includes(`--${k}`)

const PKG    = resolve(arg('pkg', 'docs/qc-evidence'))
const VENDOR = arg('vendor', '')
const STEP   = arg('step', 'qc')
const OUT    = arg('out', `/tmp/spec-${STEP}.png`)
const WORK   = arg('work', '/tmp/spec-render')
const PORT   = Number(arg('port', '8901'))
const EXE    = arg('exe', process.env.PWEXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')

// The uuid is baked into theme.css's @import. Read it from there rather than hardcoding, so the
// script keeps working if the package is re-exported with a different design-system id.
const themeSrc = await readFile(join(PKG, 'app/src/theme.css'), 'utf8')
const dsMatch = themeSrc.match(/_ds\/([^/]+)\/tokens\//)
if (!dsMatch) throw new Error('theme.css no longer @imports _ds/<id>/tokens/ — update this script')
const DS_ID = dsMatch[1]

// ---- assemble a self-contained copy -------------------------------------------------------------
await mkdir(join(WORK, `_ds/${DS_ID}/tokens`), { recursive: true })
await mkdir(join(WORK, 'app/src'), { recursive: true })
await cp(join(PKG, 'qc'), join(WORK, 'qc'), { recursive: true })
await cp(join(PKG, 'app/src/theme.css'), join(WORK, 'app/src/theme.css'))
// GOTCHA 2: put the tokens where the @import expects them, not where the package ships them.
await cp(join(PKG, 'app/src/tokens'), join(WORK, `_ds/${DS_ID}/tokens`), { recursive: true })

let html = await readFile(join(PKG, 'Packet QC Prototype.html'), 'utf8')
if (VENDOR) {
  await cp(resolve(VENDOR), join(WORK, 'vendor'), { recursive: true })
  html = html
    .replace(/<script src="https:\/\/unpkg\.com\/react@[^"]*"[^>]*><\/script>/, '<script src="vendor/react.js"></script>')
    .replace(/<script src="https:\/\/unpkg\.com\/react-dom@[^"]*"[^>]*><\/script>/, '<script src="vendor/react-dom.js"></script>')
    .replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"]*"[^>]*><\/script>/, '<script src="vendor/babel.js"></script>')
  for (const f of ['react.js', 'react-dom.js', 'babel.js']) {
    if (!existsSync(join(WORK, 'vendor', f))) throw new Error(`--vendor dir is missing ${f}`)
  }
}
await writeFile(join(WORK, 'index.html'), html)

// ---- GOTCHA 1: serve over HTTP so Babel can fetch the .jsx -------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css' }
const missed = []
const server = createServer(async (req, res) => {
  const path = join(WORK, decodeURIComponent(req.url.split('?')[0]))
  try {
    const buf = await readFile(path)
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    if (!req.url.includes('favicon')) missed.push(req.url)
    res.writeHead(404).end('nope')
  }
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: Number(arg('w', '1340')), height: Number(arg('h', '1500')) } })
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)))

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' })
await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 45000 })
await page.waitForTimeout(2500)

// ---- the guard: prove the design tokens actually resolved --------------------------------------
const tokenValue = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--surface-background-secondary').trim())
if (!tokenValue) {
  console.error('TOKENS_UNRESOLVED — the page rendered with no design tokens, so every colour is a')
  console.error('fallback and the screenshot does NOT represent the design. 404s:', missed)
  await browser.close(); server.close(); process.exit(2)
}

const rail = await page.evaluate(() => [...document.querySelectorAll('*')]
  .filter(e => e.children.length === 0 && /^(JD analysis|Resume|Cover letter|Portfolio|Intro video|QC & evidence|Review & send)$/.test((e.textContent || '').trim()))
  .map(e => e.textContent.trim()))

if (has('list')) {
  console.log(JSON.stringify({ tokenValue, rail: [...new Set(rail)], pageErrors, notFound: missed }, null, 2))
  await browser.close(); server.close(); process.exit(0)
}

const LABEL = { jd: 'JD analysis', resume: 'Resume', cover: 'Cover letter',
                portfolio: 'Portfolio', video: 'Intro video', qc: 'QC & evidence', send: 'Review & send' }
if (!LABEL[STEP]) throw new Error(`--step must be one of ${Object.keys(LABEL).join(', ')}`)
await page.locator(`text=/^${LABEL[STEP]}$/`).first().click()
await page.waitForTimeout(1800)

const text = await page.evaluate(() => document.body.innerText)
await page.screenshot({ path: OUT, fullPage: has('full') })

console.log(JSON.stringify({
  step: STEP, out: OUT, tokenValue,
  rail: [...new Set(rail)],
  inlineCorrections: (text.match(/Corrected for you/g) || []).length,
  doneForYou: /Done for you/.test(text),
  needsDecision: /Needs a decision/.test(text),
  showOriginal: /Show original|Hide original/.test(text),
  askForAChange: /Ask for a change/.test(text),
  pageErrors, notFound: missed,
}, null, 2))

await browser.close()
server.close()

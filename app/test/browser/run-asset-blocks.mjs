// Browser probe for the asset blocks (src/screens/AssetBlocks.jsx + src/assetBlocks.js).
//
//   cd app && npm run test:blocks
//
// `npm test` proves the DERIVATION is right; this proves the card RENDERS what the derivation says.
// The three things it checks are the three that shipped wrong:
//   1. a row whose item_count (4) disagrees with its text (6 lines) must print 4 and SAY they
//      disagree, never quietly print the browser's 6;
//   2. one packet-level swap rendered on two assets must name itself as packet-level and
//      cross-reference the sibling asset, not read as two independent changes;
//   3. an unmeasurable stat must be stated as unknown, never drawn as 0 / 0 of 0 / an empty bar.
//
// Every API response is fulfilled from a fixture by playwright's router, so no request leaves the
// machine and the rows under test are exactly the rows asserted about.
import { readdirSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort()
  for (const d of dirs.reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`
    if (existsSync(exe)) return exe
  }
  return undefined
}

// The fixture. `item_count: 4` with six lines of text is the exact disagreement the card used to
// resolve in the browser's favour; the other rows are ordinary.
const insertions = (artifactId) => ({
  artifactId, type: 'resume', loop: 0,
  filled: 3, unfilled: 1,
  insertions: [
    {
      merge_field: 'SkillsBullets1', generated: true, loop: 0, list: 'skills_1', item_count: 4,
      method: 'model_rewrite', before_text: null, requirement_id: null, verbatim_quote: null,
      after_text: 'Owned the integrated product roadmap\nRan intake\nBuilt the scorecard\nShipped ATS integration\nRan vendor selection\nCoached two PMs',
    },
    {
      merge_field: 'ResumeSummary', generated: true, loop: 0, list: null, item_count: 1,
      method: 'template_fill', before_text: null, requirement_id: null, verbatim_quote: null,
      after_text: 'Product leader with fifteen years in hiring technology.',
    },
    {
      merge_field: 'SkillsBullets2', generated: true, loop: 0, list: 'skills_2', item_count: 2,
      method: 'template_fill', before_text: null, requirement_id: null, verbatim_quote: null,
      after_text: 'Vendor selection\nStakeholder alignment',
    },
    {
      merge_field: 'ExpertiseBullets', generated: false, loop: 0, list: null, item_count: 0,
      method: 'template_fill', before_text: null, after_text: null, requirement_id: null, verbatim_quote: null,
    },
  ],
})

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const URL_BASE = `http://localhost:${port}/test/browser/asset-blocks-probe.html`

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|net::ERR_CONNECTION_RESET/.test(t)) return
  out.push('CONSOLE-ERR ' + t)
})

// Nothing reaches the network: every app/* call is answered here.
await page.route('**/api/app/**', async (route) => {
  const url = route.request().url()
  const m = /\/artifact\/([^/?]+)\/insertions/.exec(url)
  if (m) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(insertions(m[1])) })
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
})

await page.goto(URL_BASE)
await page.waitForSelector('#card-resume .px-box')
await page.waitForFunction(() => document.body.innerText.includes('packet-level'))

const resume = page.locator('#card-resume')
const compact = page.locator('#card-compact_resume')
const resumeText = await resume.innerText()
const compactText = await compact.innerText()

// ---------- 1. the count is the row's, and the disagreement is visible ----------
ok('the card prints the ROW count (4 lines), not its own split (6)',
  /\b4 lines\b/.test(resumeText) && !/\b6 lines\b/.test(resumeText),
  JSON.stringify(resumeText.split('\n').find((l) => /lines/.test(l)) || resumeText.slice(0, 120)))

const drawn = await resume.locator('div', { hasText: 'Owned the integrated product roadmap' }).count()
ok('every line of the draft is still drawn (no silent truncation)',
  /Coached two PMs/.test(resumeText) && drawn > 0)

ok('the disagreement between the row and the text is STATED',
  /records 4 items/.test(resumeText) && /splits into 6/.test(resumeText) && /checks were run against/.test(resumeText),
  JSON.stringify((resumeText.match(/The row records[^\n]*/) || [''])[0]))

// A field whose row and text agree says nothing about a mismatch.
ok('a field whose count agrees says nothing about a mismatch',
  (resumeText.match(/records \d+ items/g) || []).length === 1)

// ---------- 2. one packet-level decision, cross-referenced ----------
ok('the swapped line is marked packet-level on the resume', /packet-level/.test(resumeText))
ok('the same swap is marked packet-level on the compact resume', /packet-level/.test(compactText))
ok('the resume names the compact resume as sharing the decision',
  /Packet-level decision[^\n]*Compact resume/.test(resumeText),
  JSON.stringify((resumeText.match(/Packet-level decision[^\n]*/) || [''])[0]))
ok('the compact resume names the resume, and does not cite itself',
  /Packet-level decision[^\n]*\bResume\b/.test(compactText) && !/Packet-level decision[^\n]*Compact resume/.test(compactText),
  JSON.stringify((compactText.match(/Packet-level decision[^\n]*/) || [''])[0]))
ok('the two cards do not read as two independently derived changes',
  /recorded against the packet, not this asset alone/.test(resumeText))

// ---------- 3. an unmeasurable stat is unknown, not zero ----------
ok('library-term placement is stated as unknown',
  /library terms exist yet/.test(resumeText) && /unknown/.test(resumeText),
  JSON.stringify((resumeText.match(/No published[^\n]*/) || [''])[0]))
ok('the posting-lines stat is stated as unknown too (no requirement rows in this fixture)',
  /how much of it this asset answers is unknown/.test(resumeText))

const meterNumbers = await page.evaluate(() => {
  const meters = [...document.querySelectorAll('#card-resume .px-box')]
    .filter((el) => el.innerText.startsWith('What is in this asset'))
  const stats = meters.flatMap((m) => [...m.querySelectorAll('.px-label')].map((l) => {
    const wrap = l.parentElement
    return { label: l.innerText, value: wrap.innerText.replace(/\n/g, ' '), bar: wrap.querySelector('.px-bar i')?.style.width }
  }))
  return { count: meters.length, stats }
})
ok('no stat is rendered as "of 0"', !meterNumbers.stats.some((s) => /\bof 0\b/.test(s.value)), JSON.stringify(meterNumbers.stats))
ok('no stat bar is drawn empty for an absent measurement',
  !meterNumbers.stats.some((s) => s.bar === '0%'), JSON.stringify(meterNumbers.stats))
// .px-label uppercases in CSS, so innerText comes back shouting - match case-insensitively.
ok('the stats that ARE measured still render', meterNumbers.stats.some((s) => /fields generated/i.test(s.label)),
  JSON.stringify(meterNumbers.stats.map((s) => s.label)))

// ---------- 4. the registry settles (a re-render loop would never stop) ----------
const first = await page.evaluate(() => window.__registerCalls)
await page.waitForTimeout(600)
const second = await page.evaluate(() => window.__registerCalls)
ok('the list-owner registry settles instead of looping', first === second, `${first} then ${second}`)

// ---------- 5. static fields still read as static ----------
ok('an ungenerated merge field is still shown as static template text',
  /static template · not generated/.test(resumeText))

console.log(out.join('\n'))
const failed = out.filter((l) => !l.startsWith('PASS'))
console.log(`\n${out.length - failed.length}/${out.length} checks passed`)
await browser.close()
await server.close()
process.exit(failed.length ? 1 : 0)

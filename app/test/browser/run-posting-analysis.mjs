// Posting-analysis browser probe — `npm run test:posting`.
//
// Runs the REAL <PostingAnalysisCard> under Vite's DEV React so a hooks or render fault names
// itself. `df2c9db` shipped SPEC 4.1's evidence expansion with `npm test` green at 294/294 and
// `ui-verify.yml` immediately found the live route dead behind a MINIFIED React error, which is a
// number rather than a cause. This is the same lesson `run-field-margin.mjs` records: a Node suite
// that imports pure modules cannot see a fault that only exists once React renders the tree.
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

const out = []
const ok = (name, cond, detail = '') =>
  out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail && !cond ? ` :: ${detail}` : ''}`)

const server = await createServer({ root: '.', server: { port: 0 }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${server.config.server.port || server.httpServer.address().port}`
const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1440, height: 1700 } })

// EVERY console error is captured. This is the whole point: the Node suite cannot see one.
// RENDER faults only. A `net::ERR_*` resource line is the Vite dev client failing to reach its
// HMR socket in this sandbox - real, unrelated, and it would make this probe cry wolf on every run.
// The fault this file exists to catch surfaces as a pageerror or a React console error, so those
// are what is collected.
const errors = []
const isRenderFault = (t) => !/net::ERR_|Failed to load resource/i.test(t)
page.on('console', (m) => { if (m.type() === 'error' && isRenderFault(m.text())) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)))

await page.goto(`${base}/test/browser/posting-analysis-probe.html`, { waitUntil: 'load' })
await page.waitForTimeout(400)

// THE CARD IS TABBED, and the default tab is Responsibilities. Asserting the evidence line without
// opening Requirements measures two rows and reports the other five as missing - which is how a
// probe invents a defect rather than finding one. The tabs are `role="tab"` divs carrying
// `data-qc-tab`, NOT buttons: the first version of this probe waited 30s for a <button> and timed
// out, which would have read as "the tab does not exist" to anyone who did not check.
const openTab = async (key) => {
  await page.locator(`[data-qc-tab="${key}"]`).first().click()
  await page.waitForTimeout(150)
}

const mounted = await page.locator('[data-qc="posting-analysis"]').count()
ok('the card mounts', mounted > 0, `count=${mounted}`)
ok('no console error while rendering seven requirement rows in every evidence state',
  errors.length === 0, JSON.stringify(errors.slice(0, 2)))

const respRows = await page.locator('[data-qc="req-evidence"]').count()
ok('every responsibility row carries an evidence line', respRows === 2, `rows=${respRows}`)
await openTab('requirements')
const reqRows = await page.locator('[data-qc="req-evidence"]').count()
ok('every requirement row carries an evidence line', reqRows === 5, `rows=${reqRows}`)
ok('seven rows across the two groups, one evidence line each', respRows + reqRows === 7,
  `${respRows}+${reqRows}`)

// Rows are SPLIT ACROSS TABS by kind - responsibilities (r5, r6) and requirements
// (r1, r2, r3, r4, r7) - so every index below is per-tab. Reading them as one list is what made
// the first version of this probe wait 30s for a seventh row that was never on screen.
const stateOf = async (i) =>
  page.locator('[data-qc="req-evidence"]').nth(i).getAttribute('data-qc-evidence-state')
const textOf = async (i) => (await page.locator('[data-qc="req-evidence"]').nth(i).innerText()).trim()

// ---------- claim 1: the six states arrive intact and an old payload degrades ----------
await openTab('requirements')
ok('a verified row reports verified', (await stateOf(0)) === 'verified', await stateOf(0))
ok('a row with no evidence reports none', (await stateOf(1)) === 'none', await stateOf(1))
ok('a stale row reports stale, NOT none', (await stateOf(2)) === 'stale', await stateOf(2))
// groupRequirements orders the tab by KIND (must-haves, then nice-to-haves), not by seq, so
// index 3 is the second must-have-with-evidence and index 4 is the lone nice-to-have. Asserting
// in seq order reported a correct row as the wrong state - the probe was wrong, not the app.
ok('the second verified row is also verified', (await stateOf(3)) === 'verified', await stateOf(3))
ok('a source_missing row keeps its own state', (await stateOf(4)) === 'source_missing', await stateOf(4))

// ---------- claim 2: only `none` may report a gap in the PROFILE ----------
const noneText = await textOf(1)
ok('the none row says no evidence found', /no evidence found/i.test(noneText), noneText)
ok('a stale row never says "no evidence found" - that is a claim about the owner\'s profile',
  !/no evidence found/i.test(await textOf(2)), await textOf(2))
ok('a source_missing row never says it either', !/no evidence found/i.test(await textOf(4)))
ok('a none row says which words were sought and missing, not just that nothing was found',
  /Looked for/i.test(noneText) && /roadmap/i.test(noneText), noneText)

// ---------- claim 3: the excerpt is behind a disclosure, and only on a verified row ----------
const bodiesClosed = await page.locator('[data-qc="req-evidence-body"]').count()
ok('no excerpt renders until it is asked for', bodiesClosed === 0, `bodies=${bodiesClosed}`)
const showLinks = await page.locator('[data-qc="req-evidence"] button').filter({ hasText: 'show the line' }).count()
ok('only the two verified rows offer to show the line', showLinks === 2, `links=${showLinks}`)

await page.locator('[data-qc="req-evidence"] button').filter({ hasText: 'show the line' }).first().click()
await page.waitForTimeout(150)
const body = await page.locator('[data-qc="req-evidence-body"]').first().innerText()
ok('expanding shows the verbatim profile excerpt (4.1-17)',
  /Led the platform organisation for eleven years/.test(body), body)
ok('and names the source record it came from (4.1-18)', /Resume 2024/.test(body), body)
ok('a verified row with no supporting note prints none', !/proposed by the model/.test(body), body)

// ---------- claim 4: ev.extra (4.1-19) and the record-changed caveat ----------
await page.locator('[data-qc="req-evidence"] button').filter({ hasText: 'show the line' }).last().click()
await page.waitForTimeout(150)
const seventh = await textOf(3)
ok('the resolver supporting note renders verbatim when present (4.1-19)',
  /proposed by the model from an adjacent line/.test(seventh), seventh)
ok('a verified-but-re-edited record says the RANKING is stale without withdrawing the quote',
  /earlier version of that record/i.test(seventh) && /Carried a 40M P&L/.test(seventh), seventh)

// ---------- claim 5: no similarity score reaches the reader ----------
const all = await page.locator('[data-qc="posting-analysis"]').innerText()
ok('no ratio, percentage or match score is printed beside a requirement',
  !/0\.91|0\.7\b|91%|70%/.test(all))

// ---------- claim 6: the responsibilities tab, including the OLD-PAYLOAD row ----------
await openTab('responsibilities')
ok('an unverified row keeps its own state', (await stateOf(0)) === 'unverified', await stateOf(0))
ok('a row from an OLDER payload degrades to unknown rather than crashing',
  (await stateOf(1)) === 'unknown', await stateOf(1))
ok('the unknown row says only that it was not checked, and never accuses the profile',
  /not checked for evidence/i.test(await textOf(1)) && !/no evidence found/i.test(await textOf(1)),
  await textOf(1))

ok('still no console errors after interacting', errors.length === 0, JSON.stringify(errors.slice(0, 2)))

console.log(out.join('\n'))
const total = out.filter((l) => /^(PASS|FAIL)/.test(l)).length
console.log(`\n${out.filter((l) => l.startsWith('PASS')).length}/${total} checks passed`)
await browser.close()
await server.close()
process.exit(out.some((l) => !l.startsWith('PASS')) ? 1 : 0)

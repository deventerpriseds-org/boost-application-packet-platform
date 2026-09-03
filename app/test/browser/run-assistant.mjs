// Assistant-panel browser probe — `npm run test:assistant`.
//
// WHY A BROWSER AND NOT MORE NODE TESTS. The Node suite proves the seed REDUCER and greps the
// component source. Neither can see the two things most likely to be wrong about a panel: whether
// the seed effect actually clears its slot (a reducer that returns `seed: null` is useless if the
// effect never tells the parent) and whether activating a control SENDS ANYTHING. The only way to
// prove a negative about the network is to record the network, which is what the route handler below
// does — the same technique run-field-margin.mjs uses for SPEC 4.6-10's identical claim.
//
// Proves from the RENDERED DOM:
//   1. the collapsed affordance renders and reads "Open assistant"
//   2. a forwarded sentence OPENS the panel with that sentence verbatim and EDITABLE
//   3. the seed slot is CLEARED, so it cannot re-fire over what the reader types
//   4. seeding SENDS NOTHING — zero API calls until Send is pressed
//   5. no Keep and no Revert control exists, and the limits are stated instead
//   6. Send is refused with no asset open, and the scope line says so rather than guessing
//   7. the drawer survives a phone viewport (390px) without overflowing the page
import { readdirSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`
    if (existsSync(exe)) return exe
  }
  return undefined
}

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const URL_BASE = `http://localhost:${port}/test/browser/assistant-probe.html`

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|net::ERR_CONNECTION_RESET/.test(t)) return
  out.push('CONSOLE-ERR ' + t)
})

// EVERY call that reaches the API, in order. Claim 4 is a negative about the network and this is
// the only thing that can prove it.
const apiCalls = []
await page.route('**/api/**', async (route) => {
  // THE BODY IS RECORDED, not just the verb and path. Claim 8 asserts that the chosen scope decides
  // `section`, and `section` travels in the body -- a recorder that keeps only the URL cannot see
  // the thing under test, so the assertion would pass or fail for the wrong reason. Found exactly
  // that way: the field-scope check failed against a URL-only record while the product was correct.
  apiCalls.push(`${route.request().method()} ${route.request().url().replace(/^https?:\/\/[^/]+/, '')} ${route.request().postData() || ''}`.trim())
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
})

await page.goto(URL_BASE)
await page.waitForSelector('[data-qc="assistant-open"]')

// ---------- claim 0: THIS PANEL renders without throwing ----------
// SCOPE, STATED HONESTLY, because the first version of this comment overclaimed. This probe mounts
// AssistantPanel and NOTHING ELSE, so it can only see render errors in the panel itself. It did NOT
// and could NOT catch the defect that actually shipped - the forward control in AssetBlocks
// referencing a prop its component never received, a ReferenceError that blanked the whole asset
// card. `run-field-margin.mjs` caught that (it mounts AssetBlocks), and the structural half is
// pinned by `H:forward-prop-is-threaded-not-just-referenced` in the Node suite.
//
// Measured: with the binding removed, field-margin exits 1 while this file still reports 20/20.
ok('0 the panel itself renders without throwing', !out.some((l) => l.startsWith('PAGEERROR')),
  out.filter((l) => l.startsWith('PAGEERROR')).join(' | '))

// ---------- claim 1: the collapsed affordance ----------
const openLabel = (await page.locator('[data-qc="assistant-open"]').innerText()).trim()
ok('1 collapsed affordance reads "Open assistant"', openLabel === 'Open assistant', openLabel)
ok('1 the panel is CLOSED until asked', await page.locator('[data-qc="assistant-panel"]').count() === 0)
// No fabricated count: nothing aggregates requests per packet, so a number here would be a
// measurement the reader could trust and we could not.
ok('1 no request count is fabricated on the button', !/\d/.test(openLabel), openLabel)

// ---------- claims 2 + 3: seed opens, verbatim, editable, and the slot clears ----------
const SENTENCE = 'Shorten this field to fit its rule. It measures 70 words against 55-60 words. Keep the meaning and drop the padding.'
await page.click('#seed-it')
await page.waitForSelector('[data-qc="assistant-panel"]')
const boxValue = await page.locator('[data-qc="assistant-box"]').inputValue()
ok('2 the forwarded sentence arrives VERBATIM', boxValue === SENTENCE, boxValue.slice(0, 60))
ok('2 the panel opened without a navigation', page.url().startsWith(URL_BASE))
const readOnly = await page.locator('[data-qc="assistant-box"]').getAttribute('readonly')
ok('2 the sentence is EDITABLE, not fixed', readOnly === null)
ok('3 the seed slot was cleared', (await page.locator('#seed-state').innerText()).includes('seed=null'))

// Editing then re-rendering must NOT restore the seed over the edit.
await page.fill('[data-qc="assistant-box"]', 'my own words')
// Force further renders WITHOUT clicking the page behind the drawer - the overlay intercepts
// pointer events by design, and the first version of this probe deadlocked on exactly that, which
// is the drawer doing its job rather than a defect.
await page.type('[data-qc="assistant-box"]', '!')
await page.waitForTimeout(80)
ok('3 a spent seed does not re-fire over typed text',
  (await page.locator('[data-qc="assistant-box"]').inputValue()) === 'my own words!')

// ---------- claim 4: seeding sends NOTHING ----------
ok('4 seeding sent no request', apiCalls.length === 0, apiCalls.join(' | '))

// ---------- claim 5: no Keep, no Revert; the limits are said ----------
const panelText = await page.locator('[data-qc="assistant-panel"]').innerText()
ok('5 no Keep control', !/\bKeep\b/.test(panelText))
ok('5 no Revert control', !/\bRevert\b/.test(panelText))
ok('5 the limits are stated', /saved as soon as/i.test(panelText), panelText.slice(0, 80))

// ---------- claim 6: no asset open -> refuse, and say so ----------
await page.keyboard.press('Escape')                        // close via the overlay's own affordance
await page.waitForSelector('[data-qc="assistant-panel"]', { state: 'detached' })
await page.click('#drop-artifact')
await page.click('[data-qc="assistant-open"]')
await page.waitForSelector('[data-qc="assistant-panel"]')
const scopeText = await page.locator('[data-qc="assistant-scope"]').innerText()
ok('6 the scope line says to open an asset', /Open an asset first/i.test(scopeText), scopeText)
await page.fill('[data-qc="assistant-box"]', 'do something')
ok('6 Send is refused with no asset', await page.locator('[data-qc="assistant-send"]').isDisabled())
ok('6 still nothing sent', apiCalls.length === 0, apiCalls.join(' | '))

// ---------- claim 8 (SPEC 4.11-4): the scope selector, from the rendered DOM ----------
// The probe's own scaffolding buttons (#ids) are driven with $eval(el => el.click()), NOT
// page.click. Claim 6 leaves the drawer open and its aria-hidden backdrop covers the harness
// controls behind it; `force: true` does NOT help, because it still dispatches at coordinates and
// so lands on the backdrop. Every control UNDER TEST ([data-qc=...]) is clicked normally through
// the real hit-testing path, so an interception on the actual UI still fails as it should.
// Proved HERE rather than by a unit test because the thing that can rot is the WIRING: a picker
// that renders but whose selection never reaches the send body is exactly the prototype's own
// defect (qc/assist.jsx sets `scope` and its send() never reads it). The unit guards hold the
// model; only the DOM can show the click changing what is sent.
await page.$eval('#restore-artifact', (el) => el.click())
await page.$eval('#set-field', (el) => el.click())
await page.waitForTimeout(150)
await page.click('[data-qc="assistant-open"]').catch(() => {})
await page.waitForSelector('[data-qc="assistant-panel"]')
const chips = await page.evaluate(() => [...document.querySelectorAll('[data-qc="assistant-scope-chip"]')]
  .map((c) => ({ id: c.getAttribute('data-qc-scope'), on: c.getAttribute('data-qc-on'), text: c.innerText })))
ok('8 the selector offers exactly the two scopes that route',
  chips.length === 2 && chips[0].id === 'field' && chips[1].id === 'asset', JSON.stringify(chips))
ok('8 and never offers the prototype chips that have no route',
  !chips.some((c) => /This packet|My profile/i.test(c.text)), JSON.stringify(chips.map((c) => c.text)))
ok('8 the field scope is preselected, because that is what the reader was looking at',
  chips[0] && chips[0].on === '1' && chips[1] && chips[1].on === '0', JSON.stringify(chips))

const fieldSentence = await page.locator('[data-qc="assistant-scope"]').innerText()
await page.click('[data-qc="assistant-scope-chip"][data-qc-scope="asset"]')
const assetSentence = await page.locator('[data-qc="assistant-scope"]').innerText()
ok('8 choosing a scope CHANGES the stated sentence, so the picker is visibly doing something',
  fieldSentence !== assetSentence && /any part/i.test(assetSentence),
  JSON.stringify({ fieldSentence, assetSentence }))

// THE ONE THAT MATTERS: the click must reach the request body.
apiCalls.length = 0
await page.fill('[data-qc="assistant-box"]', 'tighten the wording')
await page.click('[data-qc="assistant-send"]')
await page.waitForTimeout(250)
ok('8 sending under the ASSET scope omits `section`, so the handler edits the whole asset',
  apiCalls.length === 1 && !/\bsection\b/.test(apiCalls[0]), apiCalls.join(' | '))

apiCalls.length = 0
await page.click('[data-qc="assistant-open"]').catch(() => {})
await page.waitForSelector('[data-qc="assistant-panel"]')
await page.click('[data-qc="assistant-scope-chip"][data-qc-scope="field"]')
await page.fill('[data-qc="assistant-box"]', 'tighten the wording')
await page.click('[data-qc="assistant-send"]')
await page.waitForTimeout(250)
ok('8 sending under the FIELD scope sends that section, so the handler edits one merge field',
  apiCalls.length === 1 && /ResumeSummary/.test(apiCalls[0]), apiCalls.join(' | '))

// With no field there is nothing to choose between, and a one-option picker is furniture.
await page.$eval('#drop-field', (el) => el.click())
await page.click('[data-qc="assistant-open"]').catch(() => {})
await page.waitForSelector('[data-qc="assistant-panel"]')
const noPicker = await page.evaluate(() => document.querySelectorAll('[data-qc="assistant-scope-pick"]').length)
const soloSentence = await page.locator('[data-qc="assistant-scope"]').innerText()
ok('8 with no field the picker does not render at all', noPicker === 0, String(noPicker))
ok('8 and the asset scope is still stated in words', /any part/i.test(soloSentence), soloSentence)

// ---------- claim 7: the drawer survives a phone ----------
await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(120)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok('7 no horizontal overflow at 390px', overflow <= 1, `scrollWidth-clientWidth=${overflow}`)
const panelBox = await page.locator('[data-qc="assistant-panel"]').boundingBox()
ok('7 the panel fits the phone viewport', !panelBox || panelBox.width <= 390, panelBox ? String(panelBox.width) : 'no box')

// IT IS A SHEET, NOT A CENTRED BOX — added after a mutation exposed the gap. Swapping the shared
// drawer for a modal left every check above GREEN, because a modal is min(560px, 96vw) = 374px at
// this viewport and also "fits". "Fits" was never the claim worth making: on a phone the difference
// between a full-height sheet from the edge and a floating card is the whole experience. The Node
// guard pins `variant="drawer"` in the source; this pins what the reader actually gets.
const frame = await page.evaluate(() => {
  const el = document.querySelector('[data-qc="assistant-panel"]')
  if (!el) return null
  // The drawer's geometry lives on the Overlay's own panel, not on our inner root.
  const r = (el.closest('[role="dialog"]') || el.parentElement).getBoundingClientRect()
  return { top: r.top, height: r.height, right: r.right, vh: window.innerHeight, vw: window.innerWidth }
})
ok('7 the panel is a full-height sheet', frame && frame.height >= frame.vh - 2,
  frame ? `height=${Math.round(frame.height)} vh=${frame.vh}` : 'no frame')
ok('7 the panel is anchored to the edge', frame && Math.abs(frame.right - frame.vw) <= 2,
  frame ? `right=${Math.round(frame.right)} vw=${frame.vw}` : 'no frame')

await browser.close()
await server.close()

console.log(out.join('\n'))
const failed = out.filter((l) => !l.startsWith('PASS'))
if (failed.length) { console.error(`\n${failed.length} FAILED`); process.exit(1) }
console.log(`\nall ${out.length} checks passed`)

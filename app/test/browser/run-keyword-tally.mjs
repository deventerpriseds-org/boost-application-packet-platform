// Keyword-tally browser probe — `npm run test:tally`.
//
// Runs the REAL <KeywordTallyOverlay> under Vite's DEV React, one case per page load, and asserts
// SPEC 4.3-9/10/11 from the rendered DOM. The node suite proves the MODEL (qcSummaryModel's six
// states, its sentences, its rows); this proves the four things only the tree can answer:
//   1. a DEFERRED score part prints no number and no bar, so `keyword_coverage` is on the screen
//      exactly once (AC B.4);
//   2. a NULL part prints "not measured" and no bar, which is a different claim from a 0% bar (B.7);
//   3. every asset is NAMED even when its checks could not be read (B.12);
//   4. <ScoreParts> renders byte-identically to the two hand-written loops it replaced (B.14).
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

const errors = []
const isRenderFault = (t) => !/net::ERR_|Failed to load resource/i.test(t)
page.on('console', (m) => { if (m.type() === 'error' && isRenderFault(m.text())) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)))

const open = async (name) => {
  await page.goto(`${base}/test/browser/keyword-tally-probe.html?case=${name}`, { waitUntil: 'load' })
  await page.waitForTimeout(350)
}
const summary = () => page.locator('[data-qc="tally-qc-summary"]')
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()

// ── AC B.9 — an empty packet says so, and says it in the rail's own words ────────────────────────
await open('no_assets')
ok('the QC summary mounts inside the tally modal', await summary().count() === 1)
ok('an empty packet reports the no-assets state',
  await summary().getAttribute('data-qc-state') === 'no_assets', await summary().getAttribute('data-qc-state'))
const emptySentence = await text(summary())
ok('and says "this packet has no assets to check" — qcStepState\'s own words',
  /this packet has no assets to check/i.test(emptySentence), emptySentence)
// "is not a pass" contains the word `pass`, so the bare substring would fire on the sentence that
// exists to DENY one. Match the affirmative claim, not the word.
ok('an empty packet is never reported as a pass',
  !/\bclear\b/i.test(emptySentence) && !/\bis a pass\b/i.test(emptySentence), emptySentence)
ok('no gate rows are drawn for assets that do not exist',
  await page.locator('[data-qc="tally-qc-asset"]').count() === 0)
ok('no score block is drawn either', await page.locator('[data-qc="tally-qc-score"]').count() === 0)

// REGRESSION GUARD B — the modal's four existing sections all still render, in order.
const modal = await text(page.locator('[data-qc="keyword-tally"]'))
ok('the match estimate still renders', await page.locator('[data-qc="match-estimate"]').count() === 1)
ok('and keeps its model-estimate disclaimer verbatim',
  /It is not keyword coverage, and no applicant tracking system produced it/.test(modal))
ok('the ATS term-library state still renders', await page.locator('[data-qc="keyword-library-state"]').count() === 1)
ok('the model-keyword groups still render', await page.locator('[data-qc="model-keywords"]').count() === 1)
ok('both footer buttons are still wired',
  /Rebuild every asset from this posting/.test(modal) && /Go to the resume step/.test(modal))

// ── AC B.10 — assets, but not the one that carries the score. A DIFFERENT sentence ───────────────
await open('no_resume')
ok('a packet with no resume reports its own state',
  await summary().getAttribute('data-qc-state') === 'no_scored_asset', await summary().getAttribute('data-qc-state'))
const noResumeSentence = await text(summary())
ok('and does NOT reuse the empty-packet sentence — two empties, two claims',
  !/this packet has no assets to check/i.test(noResumeSentence), noResumeSentence)
ok('the assets that DO exist still get a gate row each',
  await page.locator('[data-qc="tally-qc-asset"]').count() === 2,
  String(await page.locator('[data-qc="tally-qc-asset"]').count()))
ok('no other asset\'s score is shown in the resume\'s place',
  await page.locator('[data-qc="tally-qc-score"]').count() === 0)

// ── AC B.3 — the rows are the packet's REAL artifact list ────────────────────────────────────────
await open('unchecked')
const rowTypes = await page.locator('[data-qc="tally-qc-asset"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-qc-type')))
ok('one row per artifact the packet actually has, in its order',
  JSON.stringify(rowTypes) === JSON.stringify(['resume', 'cover', 'video']), JSON.stringify(rowTypes))
ok('and no row for the types this packet does not have',
  !rowTypes.includes('compact_resume') && !rowTypes.includes('portfolio'), JSON.stringify(rowTypes))

// ── AC B.11 — never checked is never a pass ──────────────────────────────────────────────────────
const gates = await page.locator('[data-qc="tally-qc-asset"] [data-qc="gate-badge"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-qc-gate')))
ok('every badge on an unchecked packet reads unchecked, not pass',
  gates.length === 3 && gates.every((g) => g === 'unchecked'), JSON.stringify(gates))
ok('and the block never says the packet is clear', !/\bclear\b/i.test(await text(summary())), await text(summary()))

// ── AC B.6 / B.7 — the null composite, which is the DEFAULT path today ───────────────────────────
await open('null_composite')
const headline = await text(page.locator('[data-qc="tally-qc-score"]'))
ok('a null composite prints no number', !/\b\d{2,3}\b/.test(headline), headline)
ok('and names which parts are missing, in the same words the rail uses',
  /a composite is only computed when all three parts exist/i.test(headline)
  && /keywords present/i.test(headline) && /seniority fit/i.test(headline), headline)
ok('no band pill is invented for a score that has none', !/acceptable|strong|weak/i.test(headline), headline)

const part = (k) => page.locator(`[data-qc="tally-qc-score-part"][data-qc-part="${k}"]`)
ok('all three parts are listed — dropping one would hide what a composite needs',
  await page.locator('[data-qc="tally-qc-score-part"]').count() === 3)
const sen = await text(part('sen'))
ok('a part with no value says "not measured" and gives the server\'s reason',
  /not measured/i.test(sen) && /has not graded/i.test(sen), sen)
ok('and draws NO bar — an empty bar reads as zero, which is a different claim',
  await part('sen').locator('.px-bar').count() === 0)
ok('a measured part DOES draw its bar', await part('must').locator('.px-bar').count() === 1)
const measuredWidth = await part('must').locator('.px-bar > i').evaluate((el) => el.style.width)
ok('and the bar is the value, clamped', measuredWidth === '62%', measuredWidth)

// ── AC B.4 — the keyword number is on this screen ONCE ───────────────────────────────────────────
const kwNull = await text(part('kw'))
ok('the keyword part defers rather than restating the library state',
  await part('kw').getAttribute('data-qc-deferred') === '1', kwNull)
ok('a deferred part is not dressed up as an unmeasured one',
  !/not measured/i.test(kwNull), kwNull)
ok('it keeps its label, so the reader still knows what a composite needs',
  /Keywords present/i.test(kwNull), kwNull)
ok('and points at the one place the number is shown', /shown once, above/i.test(kwNull), kwNull)

await open('scored')
const scoredModal = await text(page.locator('[data-qc="keyword-tally"]'))

// F-1, found by the independent verifier: `{model.subject}` could be deleted from the heading
// "Match score - {model.subject}" and node stayed 342/0, tally 49/49, posting 26/26. The MODEL's
// `subject` was asserted (qcRail.test.mjs:1412); the RENDERED heading was not - so the fix for a
// write-only field shipped while the guard for it did not. Same two-sides-of-the-prop blindness as
// the fail-open ship gate, and the reason this assertion lives in the PROBE: only a render can see
// whether a value reached the screen.
//
// It names the asset because a packet has several and only one carries the score. A bare
// "Match score" would leave the reader to guess which artifact the number belongs to.
// Read the HEADING NODE, not the whole modal: the modal also contains the prose sentence "The
// match score for the resume", so a modal-wide match would pass with the heading gone. The `i` is
// load-bearing - the heading is uppercased by `text-transform`, so a case-sensitive test fails on
// correct code (it did, on the first draft of this assertion).
// Structural, not literal: whatever follows the label must be NON-EMPTY and must be the same name
// the packet's own row list gives that artifact. Deleting `{model.subject}` empties it; renaming
// the label moves both sides together, so this cannot cry wolf on a copy change.
const scoreHead = await text(page.locator('[data-qc="tally-qc-score"] > div').first())
const headSubject = scoreHead.replace(/^match score\s*[-–—:]?\s*/i, '').trim()
const resumeRowLabel = await text(page.locator('[data-qc="tally-qc-asset"][data-qc-type="resume"] span').first())
ok('the score heading NAMES the asset the score belongs to',
  /^match score\b/i.test(scoreHead) && headSubject.length > 0
  && headSubject.toLowerCase() === resumeRowLabel.toLowerCase(),
  `head=${JSON.stringify(scoreHead)} subject=${JSON.stringify(headSubject)} row=${JSON.stringify(resumeRowLabel)}`)
const kwHits = (scoredModal.match(/71/g) || []).length
ok('with every part measured, keyword coverage appears EXACTLY ONCE on the screen',
  kwHits === 1, `71 appears ${kwHits}x :: ${scoredModal.slice(0, 400)}`)
ok('and the one place it appears is the ATS term-library state',
  /ATS keyword coverage: 71%/.test(scoredModal), scoredModal.slice(0, 400))
ok('the deferred part still prints no number even when the number exists',
  !/\d/.test(await text(part('kw'))), await text(part('kw')))
ok('the composite renders when all three parts exist', /\b78\b/.test(await text(page.locator('[data-qc="tally-qc-score"]'))))

// ── AC B.5 — two big numbers, and the reader can tell which is measured ──────────────────────────
ok('the composite carries its own provenance',
  /measured by the checks engine/i.test(await text(page.locator('[data-qc="tally-qc-score"]'))))
ok('and the model estimate keeps its disclaimer, unchanged',
  /One model's read/.test(scoredModal)
  && /It is not keyword coverage, and no applicant tracking system produced it/.test(scoredModal))

// ── AC B.8 — the block names the artifact it is scoring ──────────────────────────────────────────
ok('the score says which asset it belongs to, and refuses a packet-wide one',
  /Resume only - there is no packet-wide score, and averaging the assets would invent one/.test(await text(summary())),
  await text(summary()))

// ── AC B.12 — an unreadable asset is named, not dropped ──────────────────────────────────────────
await open('errors')
const errRows = await page.locator('[data-qc="tally-qc-asset"]').count()
ok('an asset whose checks could not be read is still listed', errRows === 2, String(errRows))
const errGates = await page.locator('[data-qc="tally-qc-asset"] [data-qc="gate-badge"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-qc-gate')))
ok('it shows the unavailable state rather than a verdict', errGates[0] === 'unavailable', JSON.stringify(errGates))
ok('and an in-flight one shows that it is still being read', errGates[1] === 'unloaded', JSON.stringify(errGates))
const errText = await text(summary())
ok('both assets are named on screen', /Resume/.test(errText) && /Cover letter/.test(errText), errText)
ok('the unreadable score reports the server\'s own words', /HTTP 500 from checks-result/.test(errText), errText)

// ── AC B.13 — Open QC closes the modal and navigates, by click AND by keyboard ───────────────────
await page.locator('[data-qc="tally-open-qc"]').click()
ok('clicking Open QC calls the navigation prop', await page.evaluate(() => window.__wentToQc) === 1)
await page.locator('[data-qc="tally-open-qc"]').focus()
await page.keyboard.press('Enter')
ok('and so does Enter on the focused control', await page.evaluate(() => window.__wentToQc) === 2)
await page.locator('[data-qc="tally-open-qc"]').focus()
await page.keyboard.press('Space')
ok('and Space', await page.evaluate(() => window.__wentToQc) === 3)

// ── AC B.14 — the extracted renderer is byte-identical to the loops it replaced ──────────────────
await open('parity')
const html = (id) => page.locator(`#${id}`).evaluate((el) => el.innerHTML)
const [ld, nd, lr, nr] = [await html('legacy-drawer'), await html('new-drawer'), await html('legacy-rail'), await html('new-rail')]
ok('the drawer variant matches MatchTab\'s pre-extraction markup exactly', ld === nd, `${ld}\n---\n${nd}`)
ok('the rail variant matches QcRail\'s pre-extraction markup exactly', lr === nr, `${lr}\n---\n${nr}`)

ok('no console error in any of the seven renders', errors.length === 0, JSON.stringify(errors.slice(0, 2)))

console.log(out.join('\n'))
const total = out.filter((l) => /^(PASS|FAIL)/.test(l)).length
console.log(`\n${out.filter((l) => l.startsWith('PASS')).length}/${total} checks passed`)
await browser.close()
await server.close()
process.exit(out.some((l) => !l.startsWith('PASS')) ? 1 : 0)

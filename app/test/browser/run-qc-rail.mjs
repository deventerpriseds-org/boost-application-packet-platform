// Browser probe for the QC & evidence rail (src/screens/QcRail.jsx + src/qcRail.js).
//
//   cd app && npm run test:qc
//
// `npm test` proves the DERIVATION is right; this proves the rail RENDERS what the derivation says.
// Every check here is a claim only a DOM can settle - the ones a source grep cannot:
//   1. an asset with NO gate row reads "Not checked" and wears no green;
//   2. a count whose offenders resolve to no merge field is NOT a button, and each of those
//      offenders is rendered inert WITH its reason;
//   3. a count that does resolve IS a button carrying artifact_id + section_id, and clicking it
//      lands on that field in the per-asset drawer;
//   4. three coverage cards appear, including one reading "none extracted" for a class the posting
//      produced no rows for;
//   5. an all-not_applicable asset shows the server's warn and says nothing could be checked;
//   6. a null composite prints no number at all, and the three parts print the stored prose;
//   7. a null reviewer verdict says the reviewer has not run and never prints a zero.
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

const det = (o) => ({ engine: 'deterministic', ...o })

// The resume: a real mixture. One offender names a merge field (linkable), one names none
// (must stay inert), one names a requirement (a posting line, not a field).
const RESUME = {
  artifactId: 'art-resume', gate: 'warn', attention: 3, computedAt: '2026-08-19T12:00:00Z',
  override: null,
  score: {
    composite: null, band: null,
    must_have_coverage: 50, must_have_source: '1/2 must-have requirements covered',
    keyword_coverage: null, keyword_source: 'no published term-library version has scoreable entries yet',
    seniority_alignment: null, seniority_source: 'not graded - the independent reviewer (P4) has not run',
    engine_version: 1, weights: { mustHave: 0.5, keyword: 0.3, seniority: 0.2 },
  },
  history: [],
  results: [],
  engines: {
    deterministic: {
      results: [
        det({ check_key: 'must_have_coverage', state: 'fail', observed: '1/2 must-haves covered', expected: 'every must-have requirement is covered', offenders: ['#1 Lead a team of 60+ engineers'] }),
        det({ check_key: 'whitespace', state: 'warn', observed: '1 whitespace defect(s)', expected: 'no double spaces, tabs, or stray edges', offenders: ['ResumeSummary: double space'] }),
        det({ check_key: 'skill_char_limit', state: 'fail', observed: '1 of 21 skills exceed 30 chars', expected: 'every skill <= 30 characters including spaces', offenders: ['Cross functional delivery leadership (36)'] }),
        det({ check_key: 'responsibilities_addressed', state: 'pass', observed: '1/1 addressed', expected: 'every responsibility is addressed', offenders: [] }),
        det({ check_key: 'omission_list', state: 'not_applicable', observed: 'no omission list configured for this owner', expected: 'no omitted item appears', offenders: [] }),
      ],
    },
    reviewer: {
      results: [{ engine: 'reviewer', check_key: 'reviewer_agreement', state: 'fail', observed: 'the reviewer disagrees with one swap', expected: 'the reviewer agrees with the measured findings', offenders: [] }],
      verdict: null,
    },
  },
}

// The cover letter has never been checked at all.
const COVER = { artifactId: 'art-cover', gate: null, attention: 0, computedAt: null, override: null, score: null, history: [], results: [], engines: { deterministic: { results: [] }, reviewer: { results: [], verdict: null } } }

// The portfolio: every check came back not_applicable, so the SERVER says warn.
const PORTFOLIO = {
  artifactId: 'art-portfolio', gate: 'warn', attention: 0, computedAt: '2026-08-19T12:00:00Z', override: null,
  score: null, history: [], results: [],
  engines: {
    deterministic: { results: [
      det({ check_key: 'must_have_coverage', state: 'not_applicable', observed: 'no requirement rows for this opportunity', expected: 'every must-have requirement is covered', offenders: [] }),
      det({ check_key: 'changes_cited', state: 'not_applicable', observed: 'no swap rows recorded for this packet', expected: 'every swapped/added item cites a requirement', offenders: [] }),
    ] },
    reviewer: { results: [], verdict: null },
  },
}

const CHECKS = { 'art-resume': RESUME, 'art-cover': COVER, 'art-portfolio': PORTFOLIO }

const insertions = (artifactId) => ({
  artifactId, type: 'resume', loop: 0, filled: 2, unfilled: 0, attributed: 0,
  insertions: [
    { merge_field: 'ResumeSummary', generated: true, loop: 0, list: null, item_count: 1, method: 'template_fill', before_text: null, after_text: 'Product leader with fifteen years in hiring technology.', requirement_id: null, verbatim_quote: null, confidence: 0 },
    { merge_field: 'SkillsBullets1', generated: true, loop: 0, list: 'skills_1', item_count: 2, method: 'template_fill', before_text: null, after_text: 'Roadmap ownership\nVendor selection', requirement_id: null, verbatim_quote: null, confidence: 0 },
  ],
})

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const URL_BASE = `http://localhost:${port}/test/browser/qc-rail-probe.html`

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } })
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|net::ERR_CONNECTION_RESET/.test(t)) return
  out.push('CONSOLE-ERR ' + t)
})

const seenUrls = []
// The whole body runs inside a try: a locator that never resolves is itself a rendering failure
// (a count that lands nowhere leaves no dialog to wait for), and an uncaught throw would print a
// stack instead of the checks that already passed. It is reported as a FAIL like any other.
try {
await page.route('**/api/app/**', async (route) => {
  const url = route.request().url()
  seenUrls.push(url)
  let m = /\/artifact\/([^/?]+)\/checks-result/.exec(url)
  if (m) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHECKS[m[1]] || COVER) })
  m = /\/artifact\/([^/?]+)\/insertions/.exec(url)
  if (m) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(insertions(m[1])) })
  if (/\/packet\/[^/?]+\/swaps/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ packetId: 'pkt-1', candidates: [], swaps: [], changed: 0, unattributed: 0 }) })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
})

await page.goto(URL_BASE)
await page.waitForSelector('[data-qc="qc-rail"]')
await page.waitForFunction(() => !document.body.innerText.includes('Reading the gate...'))

// ---------- 0. every owner-scoped GET carried ?owner= ----------
const checkCalls = seenUrls.filter((u) => /checks-result/.test(u))
ok('every checks-result GET carried ?owner=', checkCalls.length === 3 && checkCalls.every((u) => /[?&]owner=/.test(u)),
  JSON.stringify(checkCalls.map((u) => u.split('/api')[1])))

// ---------- 1. an unchecked asset reads "Not checked" and wears no green ----------
const coverChip = page.locator('[data-qc="qc-asset"][data-qc-artifact="art-cover"]').first()
const coverText = await coverChip.innerText()
ok('the never-checked asset reads "Not checked"', /Not checked/.test(coverText), JSON.stringify(coverText))
ok('it does not read as clear or pass', !/\bClear\b/i.test(coverText) && !/\bpass\b/i.test(coverText), JSON.stringify(coverText))
const coverGreen = await page.evaluate(() => {
  const chip = document.querySelector('[data-qc="qc-asset"][data-qc-artifact="art-cover"] .px-pill')
  const clear = document.querySelector('[data-qc="qc-asset"][data-qc-artifact="art-resume"] .px-pill')
  const cs = (el) => (el ? getComputedStyle(el).color : null)
  return { unchecked: cs(chip), checked: cs(clear) }
})
ok('the unchecked pill does not borrow the checked asset colour', coverGreen.unchecked !== coverGreen.checked, JSON.stringify(coverGreen))

// ---------- 2. the two counts are rendered separately, with no blended total ----------
const counts = await page.evaluate(() => ({
  toFix: document.querySelector('[data-qc="qc-to-fix"]').innerText,
  toReview: document.querySelector('[data-qc="qc-to-review"]').innerText,
  unchecked: document.querySelector('[data-qc="qc-unchecked"]').innerText,
}))
// Three deterministic fail/warn rows on the resume (must_have_coverage, whitespace, skill_char_limit)
// and one reviewer fail. If the reviewer row leaked into toFix this would read 4.
ok('to fix counts the measured rules only', counts.toFix === '3', JSON.stringify(counts))
ok('the reviewer FAIL lands in to review, never in to fix', counts.toReview === '1', JSON.stringify(counts))
ok('the never-checked asset is counted on its own', counts.unchecked === '1', JSON.stringify(counts))
const summary = await page.locator('[data-qc="qc-counts"]').innerText()
ok('no blended total is printed beside them', !/\b3 findings\b|\btotal\b/i.test(summary), JSON.stringify(summary))

// ---------- 3. coverage: three cards, one of them "none extracted" ----------
await page.click('[data-qc="qc-tab"][data-qc-tab="coverage"]')
const cardInfo = await page.evaluate(() => [...document.querySelectorAll('[data-qc="qc-coverage-card"]')].map((c) => ({
  kind: c.getAttribute('data-qc-kind'),
  count: c.querySelector('[data-qc="qc-coverage-count"]').innerText,
})))
ok('exactly three coverage cards, one per requirement class', cardInfo.length === 3, JSON.stringify(cardInfo))
ok('they are keyed must_have / nice_to_have / responsibility',
  JSON.stringify(cardInfo.map((c) => c.kind)) === JSON.stringify(['must_have', 'nice_to_have', 'responsibility']))
ok('the class with no rows still gets a card reading "none extracted"',
  cardInfo.find((c) => c.kind === 'nice_to_have').count === 'none extracted', JSON.stringify(cardInfo))
ok('must-haves show their OWN closed/total, not a packet-wide sum',
  cardInfo.find((c) => c.kind === 'must_have').count === '1/2', JSON.stringify(cardInfo))
ok('no card sums across kinds (nothing reads 2/3)', !cardInfo.some((c) => c.count === '2/3'), JSON.stringify(cardInfo))

// ---------- 3b. click-to-filter, and a clear affordance appears ----------
ok('no filter affordance before a requirement is picked', await page.locator('[data-qc="qc-clear-filter"]').count() === 0)
await page.locator('[data-qc="qc-req-row"]').first().click()
ok('picking a requirement reveals the clear-filter affordance', await page.locator('[data-qc="qc-clear-filter"]').count() === 1)
await page.click('[data-qc="qc-tab"][data-qc-tab="checks"]')
const filteredRows = await page.locator('[data-qc="qc-check"]').count()
ok('the picked requirement filters the Checks tab', filteredRows === 0,
  'requirement #0 is covered, so no finding names it: ' + filteredRows + ' row(s)')
await page.click('[data-qc="qc-clear-filter"]')
ok('clearing the filter restores every finding', await page.locator('[data-qc="qc-check"]').count() > 0)

// ---------- 4. counts deep-link, and an unresolvable one is inert ----------
const linkState = await page.evaluate(() => [...document.querySelectorAll('[data-qc="qc-check-count"]')].map((el) => ({
  tag: el.tagName, linkable: el.getAttribute('data-qc-linkable'),
  artifact: el.getAttribute('data-qc-artifact'), section: el.getAttribute('data-qc-section'),
  check: el.closest('[data-qc="qc-check"]').getAttribute('data-qc-state'),
  label: el.closest('[data-qc="qc-check"]').innerText.split('\n')[0],
})))
const resolvable = linkState.find((l) => l.label.includes('stray spacing'))
const unresolvable = linkState.find((l) => l.label.includes('Skill lines'))
ok('a count that resolves to a field IS a button carrying artifact_id + section_id',
  resolvable && resolvable.tag === 'BUTTON' && resolvable.linkable === '1'
    && resolvable.artifact === 'art-resume' && resolvable.section === 'ResumeSummary', JSON.stringify(resolvable))
ok('a count that resolves to nothing is NOT clickable and carries no half-target',
  unresolvable && unresolvable.tag !== 'BUTTON' && unresolvable.linkable === '0'
    && !unresolvable.artifact && !unresolvable.section, JSON.stringify(unresolvable))
const inert = await page.locator('[data-qc="qc-count-inert"]').allInnerTexts()
ok('every inert offender states WHY it opens nothing', inert.length > 0 && inert.every((t) => /-\s\S/.test(t)), JSON.stringify(inert))
ok('the requirement offender says it is a posting line, not a field',
  inert.some((t) => /posting requirement/.test(t)), JSON.stringify(inert))

// ---------- 4b. the click lands ON the field ----------
await page.locator('[data-qc="qc-check-count"][data-qc-linkable="1"]').first().click()
await page.waitForSelector('[role="dialog"]')
await page.waitForSelector('[data-qc-section="ResumeSummary"]')
const landed = await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"] [data-qc-section="ResumeSummary"]')
  return { present: !!el, outlined: el ? getComputedStyle(el).boxShadow : null, tab: (document.querySelector('[role="dialog"] .px-tab-active') || {}).innerText }
})
ok('the deep link opens the drawer on the Blocks tab', landed.tab === 'Blocks & provenance', JSON.stringify(landed))
ok('and the linked field is the one highlighted', landed.present && landed.outlined && landed.outlined !== 'none', JSON.stringify(landed))
await page.keyboard.press('Escape')
await page.waitForSelector('[role="dialog"]', { state: 'detached' })

// ---------- 5. all not_applicable: the server's warn, and the honest body ----------
const portfolio = await page.locator('[data-qc="qc-asset"][data-qc-artifact="art-portfolio"]').last().innerText()
ok('an all-not_applicable asset shows the SERVER gate (warn)', /Needs a decision/.test(portfolio), JSON.stringify(portfolio.slice(0, 200)))
ok('and says nothing could be checked', /[Nn]othing could be checked/.test(portfolio), JSON.stringify(portfolio.slice(0, 300)))
ok('it never reads as a pass', !/\bClear\b/.test(portfolio))
const naNotes = await page.locator('[data-qc="qc-not-applicable"]').allInnerTexts()
ok('every not_applicable note prints ITS OWN row reason, never a blank',
  naNotes.length === 2
  && naNotes.some((t) => /no omission list configured for this owner/.test(t))
  && naNotes.some((t) => /no requirement rows for this opportunity/.test(t)),
  JSON.stringify(naNotes.map((t) => t.replace(/\n/g, ' '))))
ok('and every one is stated as counted in neither number',
  naNotes.length > 0 && naNotes.every((t) => /neither number/.test(t) && /not a pass/.test(t)))

// ---------- 6. no fabricated composite ----------
const headline = await page.locator('[data-qc="qc-headline"]').innerText()
// A digit inside the explanation ("2 of them do not") is fine; what must not exist is a number
// PRESENTED AS THE SCORE - an element whose whole text is a bare number.
const scoreShaped = await page.evaluate(() => [...document.querySelectorAll('[data-qc="qc-headline"] *')]
  .map((el) => el.textContent.trim()).filter((t) => /^\d{1,3}$/.test(t)))
ok('nothing in the headline is presented as the score', scoreShaped.length === 0, JSON.stringify([headline, scoreShaped]))
ok('it says why there is none', /all three parts/.test(headline), JSON.stringify(headline))
ok('no dash-percent or NaN stands in for the missing number', !/—%|--%|NaN/.test(headline))
const parts = await page.evaluate(() => [...document.querySelectorAll('[data-qc="qc-score-component"]')].map((el) => ({
  part: el.getAttribute('data-qc-part'), measured: el.getAttribute('data-qc-measured'), text: el.innerText.replace(/\n/g, ' '),
})))
ok('all three components are rendered', parts.length === 3, JSON.stringify(parts.map((p) => p.part)))
ok('an unmeasured component says "not measured" and carries the stored prose, never a 0',
  parts.filter((p) => p.measured === '0').length === 2
  && parts.filter((p) => p.measured === '0').every((p) => /not measured/.test(p.text) && p.text.length > 40 && !/\b0\b/.test(p.text)),
  JSON.stringify(parts))

// ---------- 7. the reviewer has not run ----------
await page.click('[data-qc="qc-tab"][data-qc-tab="review"]')
const review = await page.locator('[data-qc="qc-review"]').innerText()
ok('a null verdict says the reviewer has not run', /has not run/.test(review), JSON.stringify(review.slice(0, 200)))
ok('and never reports "0 disagreements"', !/0 disagree/.test(review))
ok('D6 is stated on the screen', /never block an asset on its own/.test(review))

// ---------- 8. the remediation tab is honest about P3 ----------
await page.click('[data-qc="qc-tab"][data-qc-tab="loops"]')
const loops = await page.locator('[data-qc="qc-loops"]').innerText()
ok('the loops tab says the loop controller is not built', /not built/.test(loops), JSON.stringify(loops.slice(0, 200)))
ok('and shows the real pass record instead of an invented log', /generation pass/.test(loops))
ok('it reports the honest empty state', /nothing has been remediated/.test(loops))

} catch (e) {
  out.push('FAIL  the probe could not finish :: ' + String(e && e.message ? e.message.split('\n')[0] : e))
}

console.log(out.join('\n'))
const failed = out.filter((l) => !l.startsWith('PASS'))
console.log(`\n${out.length - failed.length}/${out.length} checks passed`)
await browser.close()
await server.close()
process.exit(failed.length ? 1 : 0)

// TEMPORARY verifier probe (PR #47 independent verification). Deleted after the run.
//
// Proves from the RENDERED DOM, not from a source grep:
//   claim 2 — "Wording kept from the posting" renders in the field margin, heading from CHECK_LABEL,
//             per-phrase `kept`, gated on the phrases (a field with no phrases gets no block),
//             a phrase containing a colon survives whole, an offender naming no field is dropped.
//   claim 3 — "N corrected" is the server-measured count (undone rows excluded), and an UNMEASURED
//             change log renders no number at all.
//   claim 6 — the RQ-MH / RQ-NTH / RESP legend renders under the chips.
//   claim 7 — the per-field control reads "List Tweaks", and the reword link seeds THAT box.
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

const insertions = (artifactId) => ({
  artifactId, type: 'resume', loop: 0, filled: 3, unfilled: 0,
  insertions: [
    {
      merge_field: 'ResumeSummary', generated: true, loop: 0, list: null, item_count: 1,
      method: 'template_fill', before_text: null, requirement_id: 'req-1', verbatim_quote: null,
      after_text: 'Product leader with fifteen years in hiring technology.',
    },
    {
      merge_field: 'SkillsBullets1', generated: true, loop: 0, list: 'skills_1', item_count: 2,
      method: 'model_rewrite', before_text: null, requirement_id: 'req-3', verbatim_quote: null,
      after_text: 'Vendor selection\nStakeholder alignment',
    },
    {
      merge_field: 'SkillsBullets2', generated: true, loop: 0, list: 'skills_2', item_count: 1,
      method: 'template_fill', before_text: null, requirement_id: 'req-2', verbatim_quote: null,
      after_text: 'Coached two PMs',
    },
  ],
})

// THE change-log payload. Three corrections, ONE of them undone -> server count is 2, rows.length
// is 3. If the screen re-counted the rows it would print "3 corrected".
const CORRECTIONS = [
  { id: 'c1', merge_field: 'ResumeSummary', phrase: '$18M', replacement: '8-figure', char_start: 10,
    char_end: 14, applied_seq: 1, reason: 'the posting states $18M; your profile does not evidence it',
    source: 'generalized' },
  { id: 'c2', merge_field: 'SkillsBullets1', phrase: 'sixty engineers', replacement: 'a large team',
    char_start: 0, char_end: 15, applied_seq: 2, reason: 'unevidenced headcount', source: 'generalized' },
  // UNDONE. `correctionRow` derives `undone` from `reverted_at || reverted_by` (assetGate.js:472),
  // so that is the field that marks it — not a boolean called `undone`.
  { id: 'c3', merge_field: 'SkillsBullets2', phrase: '40%', replacement: 'materially', char_start: 0,
    char_end: 3, applied_seq: 3, reason: 'unevidenced figure', source: 'generalized',
    reverted_at: '2026-08-24T10:00:00Z', reverted_by: 'von.ellis@enterpriseds.io' },
]

const WORDING_OFFENDERS = [
  // A phrase that CONTAINS A COLON. Splitting on the first colon would truncate it.
  'ResumeSummary: "Note: we ship weekly"',
  'SkillsBullets1: "safety-critical systems"',
  // Names no merge field at all -> must be dropped, never attached to a field.
  '"quarterly business review"',
]

const checksResult = (mode) => {
  const base = {
    gate: 'warn',
    attention: 1,
    results: [{
      check_key: 'posting_wording_kept', state: 'warn', engine: 'deterministic',
      expected: "no generated field repeats a run of the posting's wording",
      offenders: WORDING_OFFENDERS,
    }],
    // NO `engines` key: `engineRows` (assetGate.js:269-276) PREFERS `result.engines[engine].results`
    // when present, so supplying an empty grouped shape would hide the flat `results` above.
  }
  if (mode === 'measured') return { ...base, corrections: CORRECTIONS }
  if (mode === 'unmeasured') return base            // `corrections` absent -> count null
  return base
}

let mode = 'measured'

const server = await createServer({ root: new URL('../..', import.meta.url).pathname, server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const URL_BASE = `http://localhost:${port}/test/browser/zzverify-probe.html`

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|net::ERR_CONNECTION_RESET/.test(t)) return
  out.push('CONSOLE-ERR ' + t)
})

await page.route('**/api/app/**', async (route) => {
  const url = route.request().url()
  const ins = /\/artifact\/([^/?]+)\/insertions/.exec(url)
  if (ins) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(insertions(ins[1])) })
  if (/\/checks-result/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checksResult(mode)) })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
})

await page.goto(URL_BASE)
await page.waitForSelector('[data-qc="asset-blocks"]')
await page.waitForFunction(() => /wording kept/i.test(document.body.innerText), null, { timeout: 8000 })
  .catch(() => out.push('FAIL  the wording margin never appeared at all'))

const bodyText = await page.locator('#card-resume').innerText()

// ---------- claim 2: the wording margin RENDERS ----------
const blocks = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-qc="blocks-wording-kept"]')].map((el) => {
    // the field this margin sits in: walk up to the nearest field slot label
    const slot = el.closest('[data-qc]') // self
    return {
      n: el.getAttribute('data-qc-n'),
      text: el.innerText,
      // the field name printed by the block's own field slot, if reachable
      field: (() => {
        let p = el.parentElement
        while (p && !p.querySelector('[data-qc="blocks-field-slot"]')) p = p.parentElement
        const s = p && p.querySelector('[data-qc="blocks-field-slot"]')
        return s ? s.innerText.trim() : '?'
      })(),
    }
  })
})

ok('the wording margin renders at all', blocks.length > 0, JSON.stringify(blocks.map((b) => b.field)))
ok('it renders in exactly the TWO fields the offenders name, not the third',
  blocks.length === 2, `saw ${blocks.length} margins: ${JSON.stringify(blocks.map((b) => `${b.field}=${b.n}`))}`)
ok('the heading is CHECK_LABEL\'s wording, not a literal',
  blocks.every((b) => /Wording kept from the posting/i.test(b.text)),
  JSON.stringify(blocks[0] ? blocks[0].text.split('\n')[0] : ''))
ok('a phrase containing a COLON survives whole',
  /Note: we ship weekly/.test(bodyText) && !/^\s*we ship weekly\s*$/m.test(bodyText),
  JSON.stringify((bodyText.match(/Note: we ship weekly/) || [''])[0]))
ok('the wrapping quotes are stripped',
  !/"Note: we ship weekly"/.test(bodyText))
ok('every listed phrase carries its own `kept` status',
  blocks.every((b) => (b.text.match(/\bkept\b/g) || []).length >= Number(b.n)),
  JSON.stringify(blocks.map((b) => [b.n, (b.text.match(/\bkept\b/g) || []).length])))
ok('the offender naming no merge field is DROPPED, not attached anywhere',
  !/quarterly business review/.test(bodyText))
ok('the checker\'s own rule travels with it (expected, not retyped)',
  /repeats a run of the posting/.test(bodyText))
ok('no gate word leaks into the kept list',
  blocks.every((b) => !/Blocked|Needs a decision|Fix before approval/.test(b.text)))

// ---------- claim 7: the reword link seeds the field's OWN ask box ----------
const askBefore = await page.locator('[data-qc="blocks-ask-box"]').count()
const rewordLinks = await page.locator('[data-qc="blocks-wording-ask"]').count()
ok('the reword link renders beside a kept phrase', rewordLinks > 0, String(rewordLinks))
if (rewordLinks > 0) await page.locator('[data-qc="blocks-wording-ask"]').first().click()
await page.waitForTimeout(150)
const askAfter = await page.locator('[data-qc="blocks-ask-box"]').count()
const askValue = await page.evaluate(() => {
  const box = document.querySelector('[data-qc="blocks-ask-box"] textarea')
  return box ? box.value : null
})
ok('the ask box was closed before the reword link was clicked', askBefore === 0, String(askBefore))
ok('clicking "Tweak this" OPENS the field\'s own ask box', askAfter === 1, String(askAfter))
ok('and seeds it with the reword sentence, unsent',
  !!askValue && /Reword "Note: we ship weekly"/.test(askValue), JSON.stringify(askValue))

// ---------- claim 7: the control reads "List Tweaks" ----------
const askChangeText = await page.evaluate(() =>
  [...document.querySelectorAll('[data-qc="blocks-ask-change"]')].map((e) => e.innerText.trim()))
ok('the per-field control reads "List Tweaks" (not "Ask for a change")',
  askChangeText.filter((t) => t === 'List Tweaks').length >= 1 && !askChangeText.includes('Ask for a change'),
  JSON.stringify(askChangeText))

// ---------- claim 6: the legend renders under the chips ----------
const legends = await page.evaluate(() =>
  [...document.querySelectorAll('[data-qc="blocks-req-legend"]')].map((e) => e.innerText.replace(/\n/g, ' | ')))
ok('the chip legend renders', legends.length > 0, JSON.stringify(legends))
ok('it spells out RQ-MH / RQ-NTH / RESP across the asset',
  /RQ-MH must-have/.test(legends.join(' ')) && /RQ-NTH nice-to-have/.test(legends.join(' '))
  && /RESP responsibility/.test(legends.join(' ')), JSON.stringify(legends))
ok('a field legend lists ONLY the kinds that field carries',
  legends.every((l) => (l.match(/RQ-MH|RQ-NTH|RESP/g) || []).length === 1), JSON.stringify(legends))
const chipText = await page.evaluate(() =>
  [...document.querySelectorAll('.px-chip')].map((e) => e.innerText.trim()).filter((t) => /RQ-|RESP/.test(t)))
ok('the chips themselves read RQ-MH / RQ-NTH / RESP, not M / N / R',
  chipText.length === 3 && chipText.every((t) => /^(RQ-MH|RQ-NTH|RESP) \d+$/.test(t)), JSON.stringify(chipText))

// ---------- claim 3: "N corrected" is the SERVER count ----------
const corrected = await page.evaluate(() =>
  [...document.querySelectorAll('[data-qc="blocks-answers-corrected"]')].map((e) => e.innerText.trim()))
ok('"N corrected" renders on the meter row', corrected.length === 1, JSON.stringify(corrected))
ok('it prints the SERVER count (2 = 3 rows minus 1 undone), NOT rows.length (3)',
  corrected[0] === '2 corrected', JSON.stringify(corrected))

// ---------- claim 3: an UNMEASURED change log prints nothing ----------
mode = 'unmeasured'
await page.reload()
await page.waitForSelector('[data-qc="asset-blocks"]')
await page.waitForFunction(() => /wording kept/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {})
const correctedUnmeasured = await page.evaluate(() =>
  [...document.querySelectorAll('[data-qc="blocks-answers-corrected"]')].map((e) => e.innerText.trim()))
const unmeasuredText = await page.locator('#card-resume').innerText()
ok('an UNMEASURED change log renders NO corrected token at all',
  correctedUnmeasured.length === 0, JSON.stringify(correctedUnmeasured))
ok('and does not print "0 corrected" anywhere',
  !/\b0 corrected\b/.test(unmeasuredText))
ok('the wording margin still renders when the change log is unmeasured (independent paths)',
  /Wording kept from the posting/i.test(unmeasuredText))

console.log(out.join('\n'))
const passed = out.filter((l) => l.startsWith('PASS')).length
console.log(`\n${passed}/${out.filter((l) => /^(PASS|FAIL)/.test(l)).length} checks passed`)
await browser.close()
await server.close()
process.exit(out.some((l) => !l.startsWith('PASS')) ? 1 : 0)

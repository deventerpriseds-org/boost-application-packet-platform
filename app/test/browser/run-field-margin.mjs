// Field-margin browser probe — `npm run test:margin`.
//
// WRITTEN BY THE INDEPENDENT VERIFIER FOR PR #47 AS A THROWAWAY, AND KEPT, because it caught three
// things the Node suite could not. Its header used to say "Deleted after the run"; it earned a name
// instead. The three defects it found, each of which left `npm test` at a green 240/240:
//   M10 — re-deriving the corrected count in the component printed "3 corrected" for 2 corrections
//         and 1 undone one. A wrong number shown to the owner.
//   M11 — a second KIND_ABBR under an alias restored M/N/R chips while the legend two lines below
//         still read "RQ-MH must-have" — one screen contradicting itself.
//   M12 — the wording margin's data never arriving: zero blocks rendered, feature gone from the page.
// The Node guards have since been tightened to kill all three (they pin the SOURCE and the whole
// prop expression rather than a substring). This probe is the reason they could be.
//
// NOT CI-BLOCKING YET, and that is a known gap rather than a decision: `.github/workflows/test.yml`
// runs `test:browser` with `continue-on-error: true`, and `test:blocks` / `test:qc` / this file are
// not wired in at all. Run it by hand when touching the asset-blocks margin.
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
import { HIGHLIGHT_ACTIVE_CLASS, HIGHLIGHT_CLASS } from '../../src/highlight.js'

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
      after_text: 'Vendor selection\nStakeholder alignment and vendor selection review',
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
  'SkillsBullets1: "Vendor selection"',
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
const URL_BASE = `http://localhost:${port}/test/browser/field-margin-probe.html`

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
// `#N`, and N is the STORED 0-based seq. The `+ 1` this once allowed made the asset step the only
// 1-based surface in the app, so a finding citing `#0` pointed at a chip labelled `1` (C-1).
ok('the chips themselves read RQ-MH / RQ-NTH / RESP, not M / N / R',
  chipText.length === 3 && chipText.every((t) => /^(RQ-MH|RQ-NTH|RESP) #\d+$/.test(t)), JSON.stringify(chipText))

// ---------- claim 3: "N corrected" is the SERVER count ----------
const corrected = await page.evaluate(() =>
  [...document.querySelectorAll('[data-qc="blocks-answers-corrected"]')].map((e) => e.innerText.trim()))
ok('"N corrected" renders on the meter row', corrected.length === 1, JSON.stringify(corrected))
ok('it prints the SERVER count (2 = 3 rows minus 1 undone), NOT rows.length (3)',
  corrected[0] === '2 corrected', JSON.stringify(corrected))

// ---------- SPEC 4.5: hovering a margin row lights ITS phrase in the draft ----------
// Asserted from the rendered DOM because the Node guards only prove the WIRING - that the active
// phrase is threaded to both draft shapes and compared by identity. Whether the gesture actually
// paints is a different question and this is the only place that can answer it.
const activeIn = (field) => page.evaluate(([f, cls]) => {
  const slots = [...document.querySelectorAll('[data-qc="blocks-field-slot"]')]
  const slot = slots.find((s) => s.innerText.includes(f))
  if (!slot) return { error: `no field slot for ${f}` }
  let card = slot
  while (card && !card.querySelector('[data-qc="blocks-wording-kept"]')) card = card.parentElement
  if (!card) return { error: `no wording margin in ${f}` }
  const on = [...card.querySelectorAll('.' + cls)]
  return { n: on.length, texts: on.map((e) => e.textContent) }
}, [field, HIGHLIGHT_ACTIVE_CLASS])

const hoverRow = (field, phrase) => page.evaluate(([f, ph]) => {
  const slots = [...document.querySelectorAll('[data-qc="blocks-field-slot"]')]
  const slot = slots.find((s) => s.innerText.includes(f))
  let card = slot
  while (card && !card.querySelector('[data-qc="blocks-wording-kept"]')) card = card.parentElement
  const row = card && card.querySelector(`[data-qc-phrase="${ph}"]`)
  if (!row) return false
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  return true
}, [field, phrase])

const leaveRow = (field, phrase) => page.evaluate(([f, ph]) => {
  const slots = [...document.querySelectorAll('[data-qc="blocks-field-slot"]')]
  const slot = slots.find((s) => s.innerText.includes(f))
  let card = slot
  while (card && !card.querySelector('[data-qc="blocks-wording-kept"]')) card = card.parentElement
  const row = card && card.querySelector(`[data-qc-phrase="${ph}"]`)
  if (row) row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
}, [field, phrase])

const beforeHover = await activeIn('SkillsBullets1')
ok('nothing is lit before any hover', beforeHover.n === 0, JSON.stringify(beforeHover))

const hovered = await hoverRow('SkillsBullets1', 'Vendor selection')
ok('the margin row exposes its phrase to hover', hovered === true, String(hovered))
await page.waitForTimeout(80)
const during = await activeIn('SkillsBullets1')
// BOTH occurrences, not the first. markRuns marks every non-overlapping hit, so the margin row
// refers to all of them; lighting one would tell the reader there is one. The fixture text carries
// "Vendor selection" and "vendor selection" - differing in case, which markRuns ignores - so this
// also proves the link is not accidentally case-sensitive.
ok('hovering a kept-wording row lights EVERY occurrence of that phrase in the draft',
  during.n === 2, JSON.stringify(during))
ok('and lights only that phrase, not every mark in the field',
  during.texts && during.texts.every((t) => /vendor selection/i.test(t)), JSON.stringify(during.texts))

await leaveRow('SkillsBullets1', 'Vendor selection')
await page.waitForTimeout(80)
const after = await activeIn('SkillsBullets1')
// A setState on enter with no matching leave is the standard form of this bug and leaves the
// document permanently painted, which is worse than no linkage at all.
ok('leaving the row RELEASES the highlight', after.n === 0, JSON.stringify(after))

// The margin lists a phrase the draft no longer contains (the check ran against text that was since
// rewritten). Absent evidence is "there is nothing to point at", never a silent success.
await hoverRow('ResumeSummary', 'Note: we ship weekly')
await page.waitForTimeout(80)
const inert = await activeIn('ResumeSummary')
ok('a row whose phrase is NOT in the draft lights nothing and throws nothing',
  inert.n === 0 && !out.some((l) => l.startsWith('PAGEERROR')), JSON.stringify(inert))
await leaveRow('ResumeSummary', 'Note: we ship weekly')

// ---------- Row 11 Phase A: PROPOSED keyword chips ----------
const chipInfo = await page.evaluate(() => {
  const byField = {}
  // SCOPED TO THE FIELD CARD, not to [data-qc-field]. The "List Tweaks" link inside the card
  // carries the same attribute (AssetBlocks.jsx:625), so a bare attribute selector returns the card
  // AND its own descendant - and the descendant, having no chip group, overwrote the card's entry
  // and reported every field as chipless while the chips were plainly there.
  for (const card of document.querySelectorAll('[data-qc="blocks-field"]')) {
    const field = card.getAttribute('data-qc-field')
    const group = card.querySelector('[data-qc="blocks-keyword-chips"]')
    byField[field] = {
      hasGroup: !!group,
      chips: group ? [...group.querySelectorAll('[data-qc="blocks-keyword-chip"]')].map((c) => ({
        kw: c.getAttribute('data-qc-keyword'), text: c.innerText.trim(),
        present: c.getAttribute('data-qc-present'),
        cls: c.className, style: c.getAttribute('style') || '',
      })) : [],
      groupText: group ? group.innerText : '',
    }
  }
  return byField
})

const withKw = Object.entries(chipInfo).filter(([, v]) => v.hasGroup).map(([k]) => k)
ok('the chip group renders on the fields whose requirement carries a keyword',
  withKw.includes('ResumeSummary') && withKw.includes('SkillsBullets1'), JSON.stringify(withKw))
ok('a field whose requirement has NO keyword renders no chip group at all',
  chipInfo.SkillsBullets2 && chipInfo.SkillsBullets2.hasGroup === false,
  JSON.stringify(Object.fromEntries(Object.entries(chipInfo).map(([k, v]) => [k, v.hasGroup]))))
const allGroupText = Object.values(chipInfo).map((v) => v.groupText).join(' ')
ok('and the words "0 keywords" appear nowhere', !/0 keywords/i.test(allGroupText))
ok('no chip group prints a count, a ratio or a percentage',
  !/\b\d+\s*(of|\/)\s*\d+/.test(allGroupText) && !/%/.test(allGroupText),
  JSON.stringify(allGroupText.slice(0, 140)))

const rsChips = (chipInfo.ResumeSummary || {}).chips || []
ok('one chip per proposed keyword, carrying the keyword itself',
  rsChips.length === 1 && rsChips[0].kw === 'hiring technology', JSON.stringify(rsChips.map((c) => c.kw)))
ok('the literal word "proposed" is inside EVERY chip, not just a heading',
  rsChips.length > 0 && rsChips.every((c) => /\bproposed\b/.test(c.text)),
  JSON.stringify(rsChips.map((c) => c.text)))
ok('no chip carries the highlight classes or a highlight swatch',
  rsChips.every((c) => !/qc-kw|qc-echo/.test(c.cls) && !/#fff03a|#fbf2da|#d9c34a/i.test(c.style)),
  JSON.stringify(rsChips.map((c) => c.cls)))

await page.evaluate(() => {
  const c = document.querySelector('[data-qc="blocks-keyword-chip"][data-qc-keyword="hiring technology"]')
  if (c) c.click()
})
await page.waitForTimeout(150)
const panel = await page.evaluate(() => {
  const p = document.querySelector('[data-qc="blocks-keyword-detail"]')
  return p ? p.innerText : null
})
ok('clicking a chip opens the detail panel', !!panel, JSON.stringify(panel && panel.slice(0, 70)))
ok('the panel quotes the postings own line',
  !!panel && /own the product roadmap end to end/.test(panel), JSON.stringify(panel))
ok('the panel repeats "proposed" and shows no match grade or approx marker',
  !!panel && /\bproposed\b/.test(panel) && !/≈/.test(panel)
    && !/Exact term|Reworded|Loose|took the place of/i.test(panel), JSON.stringify(panel))

await page.evaluate(() => {
  const c = document.querySelector('[data-qc="blocks-keyword-chip"][data-qc-keyword="coaching"]')
  if (c) c.click()
})
await page.waitForTimeout(150)
const unloc = await page.evaluate(() => {
  const p = [...document.querySelectorAll('[data-qc="blocks-keyword-detail"]')]
    .find((x) => x.getAttribute('data-qc-keyword') === 'coaching')
  return p ? p.innerText : null
})
ok('a keyword whose posting line is UNLOCATABLE says so instead of quoting the paraphrase',
  !!unloc && /could not be located/i.test(unloc) && !/coach PMs/.test(unloc), JSON.stringify(unloc))

// ---------- Row 11 Phase B: presence in the draft ----------
const kwMarks = await page.evaluate(() => {
  const out = {}
  for (const card of document.querySelectorAll('[data-qc="blocks-field"]')) {
    out[card.getAttribute('data-qc-field')] =
      [...card.querySelectorAll('.qc-kw')].map((e) => e.textContent)
  }
  return out
})
// AC-B1. 'hiring technology' IS in ResumeSummary's draft, so it is marked in the text.
ok('a proposed keyword PRESENT in the draft is highlighted there',
  (kwMarks.ResumeSummary || []).some((t) => /hiring technology/i.test(t)), JSON.stringify(kwMarks))
// AC-B2. 'coaching' is NOT in SkillsBullets1's draft, so nothing is marked and the chip says so.
ok('a proposed keyword ABSENT from the draft is highlighted nowhere',
  (kwMarks.SkillsBullets1 || []).length === 0, JSON.stringify(kwMarks.SkillsBullets1))
const s1Chips = (chipInfo.SkillsBullets1 || {}).chips || []
ok('the absent chip is marked not-present and SAYS "not in this text"',
  s1Chips.length === 1 && s1Chips[0].present === '0' && /not in this text/i.test(s1Chips[0].text),
  JSON.stringify(s1Chips.map((c) => [c.present, c.text])))
// Row 3: absence is reported about the TEXT. "Reworded" is undecidable - absent text is equally
// consistent with a rewording and with the term never having been placed.
ok('and it never claims the keyword was reworded',
  s1Chips.every((c) => !/reworded|≈/i.test(c.text)), JSON.stringify(s1Chips.map((c) => c.text)))
ok('the PRESENT chip is marked present and does NOT carry the absent wording',
  rsChips.length === 1 && rsChips[0].present === '1' && !/not in this text/i.test(rsChips[0].text),
  JSON.stringify(rsChips.map((c) => [c.present, c.text])))

// AC-B3. Hovering a chip lights its run through the SAME identity link the wording rows use.
await page.evaluate(() => {
  const c = document.querySelector('[data-qc="blocks-keyword-chip"][data-qc-keyword="hiring technology"]')
  if (c) c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
})
await page.waitForTimeout(90)
const litByChip = await page.evaluate(([cls]) =>
  [...document.querySelectorAll('.' + cls)].map((e) => e.textContent), [HIGHLIGHT_ACTIVE_CLASS])
ok('hovering a keyword chip lights its occurrence in the draft',
  litByChip.length === 1 && /hiring technology/i.test(litByChip[0]), JSON.stringify(litByChip))
await page.evaluate(() => {
  const c = document.querySelector('[data-qc="blocks-keyword-chip"][data-qc-keyword="hiring technology"]')
  if (c) c.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
})
await page.waitForTimeout(90)
const afterChip = await page.evaluate(([cls]) => document.querySelectorAll('.' + cls).length,
  [HIGHLIGHT_ACTIVE_CLASS])
ok('and leaving the chip releases it', afterChip === 0, String(afterChip))

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

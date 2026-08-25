import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { proposedKeywordsForRow, proposedKeywordDetail } from '../src/assetBlocks.js'

const req = (seq, model_keyword, verbatim = null, kind = 'must_have') =>
  ({ id: `r${seq}`, seq, kind, model_keyword, verbatim })

// ── the selector ────────────────────────────────────────────────────────────────────────────────

test('H:proposed-keywords-dedupe-in-seq-order: one chip per distinct keyword, posting order', () => {
  const reqs = [req(2, 'roadmap ownership', 'own the roadmap'), req(5, 'vendor selection'),
    req(7, 'roadmap ownership', 'x')]
  assert.deepEqual(proposedKeywordsForRow(reqs), ['roadmap ownership', 'vendor selection'])
})

test('H:proposed-keywords-never-invent-a-placeholder: absent is absent', () => {
  // CLAUDE.md: absent evidence is `not_applicable`, never `pass`. A null keyword must not become a
  // chip reading "null", an empty chip, or a "0 keywords" line — those are measurement claims and
  // there is no measurement.
  assert.deepEqual(proposedKeywordsForRow([req(1, null), req(2, ''), req(3, '   ')]), [])
  assert.deepEqual(proposedKeywordsForRow([]), [])
  assert.deepEqual(proposedKeywordsForRow(undefined), [])
  assert.deepEqual(proposedKeywordsForRow(null), [])
})

test('H:proposed-keyword-detail-never-quotes-a-paraphrase: null verbatim stays null', () => {
  // `requirement.item_text` is a MODEL PARAPHRASE (`schema.ts:331`: "NEVER presented as a quote").
  // When the requirement was unlocatable, `verbatim` is null and the panel must say there is
  // nothing to quote — substituting the paraphrase would present model prose as the employer's
  // words, which is the exact failure `Verbatim` exists to prevent.
  const reqs = [req(2, 'roadmap ownership', 'own the roadmap'), req(5, 'vendor selection', null)]
  assert.equal(proposedKeywordDetail(reqs, 'roadmap ownership').verbatim, 'own the roadmap')
  assert.equal(proposedKeywordDetail(reqs, 'vendor selection').verbatim, null)
  assert.equal(proposedKeywordDetail(reqs, 'not a keyword here'), null)
  const src = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export function proposedKeywordDetail'))
    .slice(0, 700).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!body.includes('item_text'), 'the detail must never fall back to the paraphrase')
})

// ── the "never scoreable" wall ──────────────────────────────────────────────────────────────────

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('H:keyword-never-reaches-a-count: model_keyword is absent from every module that scores or gates', () => {
  // `schema.ts:338` and `requirements.ts:59` both declare model_keyword NEVER SCOREABLE. That is a
  // rule about SCORING, not display — the chips render it deliberately. This guard is the wall
  // between the two, and it is a REGRESSION guard: the count was measured at zero when written, so
  // it is honest to say it protects a property that already holds rather than fixing a defect.
  //
  // COMMENTS ARE STRIPPED FIRST, and that is not cosmetic. `appChecks.ts` discusses keyword
  // coverage at length in prose; a guard matching raw text would pass on the comment and could
  // never fail. That is the inert-guard shape this repo has now shipped three times.
  for (const f of ['checks.ts', 'appChecks.ts', 'artifactScore.ts']) {
    const code = strip(readFileSync(new URL(`../../api/src/functions/tests/${f}`, import.meta.url), 'utf8'))
    assert.ok(!code.includes('model_keyword'),
      `${f} references model_keyword in CODE — a never-scoreable field must not reach a gate or a score`)
  }
})

test('H:proposed-keywords-compute-nothing: the selector counts, scores and grades nothing', () => {
  const src = readFileSync(new URL('../src/assetBlocks.js', import.meta.url), 'utf8')
  const i = src.indexOf('export function proposedKeywordsForRow')
  const body = strip(src.slice(i, src.indexOf('\n}', i)))
  for (const banned of ['length /', '/ ', '* 100', 'Math.round', 'covered', 'scoreable', 'pct', 'score']) {
    assert.ok(!body.includes(banned), `the selector must not compute ${banned}`)
  }
})

test('H:keyword-chip-says-proposed-on-every-chip: the word is not on the heading alone', () => {
  const jsx = readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8')
  const i = jsx.indexOf('BLOCK_HOOKS.keywordChip}')
  const end = jsx.indexOf('BLOCK_HOOKS.keywordDetail', i)
  assert.ok(i > 0 && end > i, 'the chip must exist and be followed by the detail panel')
  // BOUNDED BY THE NEXT HOOK, not by a character count. The first version sliced a fixed 900 chars
  // and broke the moment the chip grew handlers - a guard that fails on unrelated growth teaches
  // people to edit the guard instead of reading it.
  const chip = jsx.slice(i, end)
  assert.match(chip, />proposed</, 'the literal word must render inside each chip element')
  // and it must not borrow the visual language of a VERIFIED placement
  assert.ok(!/qc-kw|qc-echo/.test(chip), 'a proposed chip must not wear the highlight classes')
})

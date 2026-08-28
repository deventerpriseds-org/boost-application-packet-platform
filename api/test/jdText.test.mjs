// Run: cd api && npm test   (Node's built-in runner — no dependency added)
// These assert behaviour that was MEASURED as broken on the live corpus, so they are regression
// tests, not illustrations. See .claude/QC-EVIDENCE-PLAN.md prerequisites X3/X4.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizePostingText, groundingText, decodeEntities } from '../dist/functions/tests/jdText.js'

test('HTML entities are decoded — P&L matched ZERO of 83 live postings before this', () => {
  assert.equal(normalizePostingText('<p>Owned P&amp;L for the division</p>'), 'Owned P&L for the division')
  assert.ok(!String('<p>Owned P&amp;L</p>').replace(/<[^>]+>/g, ' ').includes('P&L'), 'old behaviour did not match')
  assert.ok(normalizePostingText('<p>Owned P&amp;L</p>').includes('P&L'), 'new behaviour matches')
})
test('double-encoded entities', () => assert.equal(normalizePostingText('<p>P&amp;amp;L</p>'), 'P&L'))
test('M&A', () => assert.equal(normalizePostingText('M&amp;A and due diligence'), 'M&A and due diligence'))
test('nbsp collapses', () => assert.equal(normalizePostingText('Risk&nbsp;&amp;&nbsp;Compliance'), 'Risk & Compliance'))
test('numeric entity', () => assert.equal(normalizePostingText('R&#38;D budget'), 'R&D budget'))
test('hex entity', () => assert.equal(normalizePostingText('R&#x26;D'), 'R&D'))
test('script/style stripped', () => assert.equal(normalizePostingText('<script>var x="&amp;"</script>Hello'), 'Hello'))
test('null safe', () => assert.equal(normalizePostingText(null), ''))
test('groundingText prefers jd_html', () => assert.equal(groundingText({ jd_html: '<b>P&amp;L</b>' }), 'P&L'))
test('groundingText falls back to summary', () => assert.equal(groundingText({ jd_html: '', jd_summary: 'Owns M&amp;A' }), 'Owns M&A'))
test('does not over-decode', () => assert.equal(decodeEntities('5 &lt; 6'), '5 < 6'))

// A JavaScript string index and a Postgres character index must address the SAME position, or the
// stored offsets cannot be re-verified in SQL — which is the entire point of storing them.
// Measured failure: 63 of 3,090 requirement rows (db-query 32305629147) on emoji-bearing postings.
import { toBmp } from '../dist/functions/tests/jdText.js'

test('normalizePostingText yields text whose JS length equals its character count', () => {
  const t = normalizePostingText('<p>Join our rocket ship 🚀 and own the 📈 roadmap</p>')
  assert.equal([...t].length, t.length, 'astral chars would make JS index != Postgres index')
  assert.match(t, /Join our rocket ship/)
  assert.match(t, /own the/)
})

test('an offset taken after an emoji still slices back to the same text', () => {
  const t = normalizePostingText('<p>🚀 Requirements: 10+ years of product leadership.</p>')
  const i = t.indexOf('10+ years')
  assert.equal(t.slice(i, i + 9), '10+ years')
  assert.equal([...t].length, t.length)
})

test('toBmp folds astral chars and lone surrogates without touching ordinary text', () => {
  assert.equal(toBmp('P&L and M&A'), 'P&L and M&A')
  assert.equal([...toBmp('a😀b')].length, toBmp('a😀b').length)
  assert.equal([...toBmp('a\ud800b')].length, toBmp('a\ud800b').length)
})

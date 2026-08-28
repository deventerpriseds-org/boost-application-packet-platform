// P1.1 requirement rows. Fixtures are shaped from REAL live rows (db-query run 32303342032):
// jd_table is a single-line <table> whose Item column is a model PARAPHRASE, not a posting quote.
// That is the thing these tests pin down — a paraphrase must resolve back to the posting's own
// words, or say it could not.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseJdTable, mapKind, locate, weightFor, buildRequirements,
  ANCHOR_THRESHOLD, MODEL_WINDOW, EXTRACTOR_VERSION,
} from '../dist/functions/tests/requirements.js'
import { normalizePostingText } from '../dist/functions/tests/jdText.js'

const TABLE = '<table><thead><tr><th>Category</th><th>Item</th><th>ATS Keyword</th></tr></thead><tbody>'
  + '<tr><td>responsibilities</td><td>Own the integrated product roadmap for corporate hiring technology.</td><td>product roadmap</td></tr>'
  + '<tr><td>experience</td><td>10+ years of product management experience.</td><td>10+ years exp</td></tr>'
  + '<tr><td>skills</td><td>Experience with P&amp;L ownership across business units.</td><td>P&amp;L</td></tr>'
  + '</tbody></table>'

const POSTING = '<p>Responsibilities: You will own our integrated product roadmap for the corporate '
  + 'hiring technology suite. Requirements: 10+ years of product management experience. '
  + 'Preferred: experience with P&amp;L ownership across business units.</p>'

// ---------------------------------------------------------------- parsing

test('parseJdTable reads rows, skips the header, decodes entities', () => {
  const rows = parseJdTable(TABLE)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].category, 'responsibilities')
  assert.equal(rows[2].item, 'Experience with P&L ownership across business units.')
  assert.equal(rows[2].keyword, 'P&L')            // &amp; must not survive into the keyword
})

test('parseJdTable is total: null, empty and malformed input yield [] and never throw', () => {
  for (const bad of [null, undefined, '', '<table>', '<table></table>',
                     '<table><tr><td>only-one-cell</td></tr></table>',
                     '<table><tr><td>responsibilities</td><td>   </td><td>k</td></tr></table>']) {
    assert.deepEqual(parseJdTable(bad), [])
  }
  assert.deepEqual(parseJdTable('<table><tbody><tr><td>skills</td><td>Lead'), [], 'row truncated mid-cell is dropped, not half-read')
})

test('parseJdTable strips inline tags, keeps order, and rejects a header repeated as <td>', () => {
  const rows = parseJdTable('<table class="x"><tr class="h"><th>Category</th></tr>'
    + '<tr><td>Category</td><td>Item</td><td>ATS Keyword</td></tr>'
    + '<tr><td style="a">requirements</td><td>First <b>bold</b> item.</td><td>one</td></tr>'
    + '<tr><td>requirements</td><td>Second.</td><td>two</td></tr></table>')
  assert.deepEqual(rows.map(r => r.item), ['First bold item.', 'Second.'])
})

// ---------------------------------------------------------------- locating

test('locate: an exact paraphrase returns offsets that slice back to itself', () => {
  const posting = 'About us. We need 10+ years of product management experience. Apply today.'
  const l = locate('10+ years of product management experience.', posting)
  assert.equal(l.match_method, 'exact')
  assert.equal(posting.slice(l.char_start, l.char_end), l.verbatim)
})

test('locate: a PARAPHRASE anchors to the posting words it was derived from', () => {
  const posting = 'Responsibilities: You will own our integrated product roadmap for the corporate '
    + 'hiring technology suite, partnering with engineering. Benefits include medical and dental.'
  const l = locate('Own the integrated product roadmap for corporate hiring technology.', posting)
  assert.equal(l.match_method, 'anchored')
  assert.equal(posting.slice(l.char_start, l.char_end), l.verbatim)   // the invariant that matters
  assert.match(l.verbatim, /integrated product roadmap/)
  assert.ok(!/medical and dental/.test(l.verbatim), 'must not swallow unrelated trailing text')
})

test('locate: unrelated text is unlocatable, not force-matched', () => {
  const l = locate('Manage clinical trial submissions to the FDA.', 'We build developer tooling for payment infrastructure teams.')
  assert.equal(l.match_method, 'unlocatable')
  assert.equal(l.char_start, null); assert.equal(l.char_end, null); assert.equal(l.verbatim, null)
})

test('locate: empty inputs are unlocatable rather than matching at offset 0', () => {
  assert.equal(locate('', 'some posting text').match_method, 'unlocatable')
  assert.equal(locate('some requirement', '').match_method, 'unlocatable')
  assert.ok(ANCHOR_THRESHOLD > 0.5 && ANCHOR_THRESHOLD <= 1)
})

test('locate: a repeated bullet claims a DIFFERENT occurrence, never the same span twice', () => {
  const posting = 'Drive operational excellence across the whole portfolio. '
    + 'What you will do: drive operational excellence across the whole portfolio.'
  const a = locate('Drive operational excellence across the portfolio.', posting)
  const b = locate('Drive operational excellence across the portfolio.', posting,
                   [{ start: a.char_start, end: a.char_end }])
  assert.notEqual(a.char_start, b.char_start, 'two rows must not cite one quote as two evidences')
  assert.equal(posting.slice(b.char_start, b.char_end), b.verbatim)
})

test('locate is deterministic: identical inputs give identical output', () => {
  const p = 'You will own our integrated product roadmap for corporate hiring technology.'
  assert.deepEqual(locate('Own the integrated product roadmap.', p), locate('Own the integrated product roadmap.', p))
})

// ---------------------------------------------------------------- kind

test('mapKind: the row OWN words decide, and say which way they decided', () => {
  assert.deepEqual(mapKind('responsibilities', 'anything'), { kind: 'responsibility', kind_source: 'category' })
  assert.deepEqual(mapKind('experience', 'Minimum 10 years required'), { kind: 'must_have', kind_source: 'posting_required_marker' })
  assert.deepEqual(mapKind('skills', 'Kubernetes is a plus'), { kind: 'nice_to_have', kind_source: 'posting_optional_marker' })
  // A responsibility is never downgraded — an optional duty is still a duty.
  assert.deepEqual(mapKind('responsibilities', 'Preferred: mentor the team'), { kind: 'responsibility', kind_source: 'category' })
})

// These are the ACTUAL verbatims of rows that a live run filed as nice_to_have (78 of 541) because
// a "preferred" up to 400 chars earlier outranked the row's own words. A citizenship gate and hard
// year-minimums stored as optional is the worst failure this table can produce.
test('mapKind: a hard gate in the row OWN text is never downgraded by an earlier "preferred"', () => {
  const window = 'Preferred qualifications: MBA or advanced degree. Familiarity with FedRAMP. '
  for (const own of [
    'Security Clearance: Candidate must be US citizen and have the ability to obtain',
    'must be a U.S. Citizen or Green Card Holder',
    'Minimum of 8 years of experience in commercial lending, banking operations',
    '15+ years of progressive technology leadership experience',
    '10+ years of progressive leadership experience in engineering, product development',
  ]) {
    const r = mapKind('experience', own, window)
    assert.equal(r.kind, 'must_have', `hard gate filed as optional: ${own}`)
    assert.equal(r.kind_source, 'posting_required_marker')
  }
})

test('mapKind: a span straddling both clauses resolves to the HARDER reading', () => {
  // One located span crossing a bullet boundary: the "preferred" belongs to the degree, the
  // "12+ years" is a gate. Hiding a real gate is worse than surfacing a dismissible one.
  const r = mapKind('experience', "related field (Master's or MBA preferred) 12+ years of experience in data management", '')
  assert.equal(r.kind, 'must_have')
})

test('mapKind: only a HEADING may reach back; a mid-sentence "preferred" governs its own clause', () => {
  const own = 'Familiarity with distributed systems'
  assert.deepEqual(mapKind('skills', own, 'Preferred qualifications: MBA or equivalent. '),
    { kind: 'nice_to_have', kind_source: 'posting_section_heading' })
  assert.deepEqual(mapKind('skills', own, 'A background in fintech is preferred for this role. '),
    { kind: 'must_have', kind_source: 'category_default' },
    'a bare "preferred" in a previous sentence must not downgrade an unrelated later bullet')
})

test('mapKind: an unstated hardness is DEFAULTED VISIBLY, never asserted as if the posting said it', () => {
  const r = mapKind('skills', 'Familiarity with distributed systems')
  assert.equal(r.kind, 'must_have')
  assert.equal(r.kind_source, 'category_default', 'a reader must be able to filter defaulted kinds out')
})

test('mapKind: unknown category falls back to the WEAKEST kind, and never to null', () => {
  for (const c of ['', 'other', undefined, 'Responsibilties']) {
    const r = mapKind(c, '', '')
    assert.equal(r.kind, 'responsibility', 'model drift must not silently invent hard requirements')
    assert.equal(r.kind_source, 'fallback')
  }
})

test('weightFor is deterministic and bounded 1..3', () => {
  assert.equal(weightFor('must_have', 'Minimum 10+ years of experience required'), 3)
  assert.equal(weightFor('must_have', 'Familiarity with SQL'), 2)
  assert.equal(weightFor('nice_to_have', 'Must have an MBA'), 1)
  assert.equal(weightFor('responsibility', 'Must own the roadmap'), 1)
})

// ---------------------------------------------------------------- assembly

test('buildRequirements: one row per jd_table row, and every located verbatim slices back out of jd_posting_snapshot', () => {
  const r = buildRequirements({ jd_html: POSTING, jd_table: TABLE })
  assert.equal(r.rows.length, 3, 'row count equals jd_table row count')
  assert.equal(r.jd_source, 'jd_html')
  assert.equal(r.jd_posting_snapshot, normalizePostingText(POSTING), 'jd_posting_snapshot IS the string offsets index')
  assert.ok(!r.posting_truncated)
  for (const row of r.rows) {
    assert.ok(['must_have', 'nice_to_have', 'responsibility'].includes(row.kind), 'no null kind')
    assert.ok(row.weight >= 1 && row.weight <= 3)
    assert.equal(row.extractor_version, EXTRACTOR_VERSION)
    if (row.char_start === null) {
      assert.equal(row.verbatim, null); assert.equal(row.coverage, 'escalated')
    } else {
      assert.equal(r.jd_posting_snapshot.slice(row.char_start, row.char_end), row.verbatim, 'THE invariant')
      assert.ok(row.char_end > row.char_start && row.char_start >= 0 && row.char_end <= r.jd_posting_snapshot.length)
      assert.equal(row.coverage, null)
    }
  }
  assert.equal(r.rows[0].kind, 'responsibility')
  assert.equal(r.rows[2].kind, 'nice_to_have', 'the posting said "Preferred:", the model never did')
})

test('buildRequirements: entity-decoded on BOTH sides — the measured P&L failure mode', () => {
  const r = buildRequirements({
    jd_html: '<p>You will have owned P&amp;L for a business unit of scale.</p>',
    jd_table: '<table><tr><td>skills</td><td>Owned P&amp;L for a business unit.</td><td>P&amp;L</td></tr></table>',
  })
  assert.equal(r.rows[0].match_method !== 'unlocatable', true, 'P&L must not be invisible to the locator')
  assert.equal(r.jd_posting_snapshot.slice(r.rows[0].char_start, r.rows[0].char_end), r.rows[0].verbatim)
  assert.match(r.rows[0].verbatim, /P&L/)
  assert.ok(!/&amp;/.test(r.rows[0].item_text))
})

test('buildRequirements: the model Item is kept SEPARATE from the posting quote', () => {
  const r = buildRequirements({ jd_html: POSTING, jd_table: TABLE })
  const row = r.rows[0]
  assert.equal(row.item_text, 'Own the integrated product roadmap for corporate hiring technology.')
  assert.notEqual(row.verbatim, row.item_text, 'a paraphrase must never be stored as the quote')
  assert.equal(row.competency, null, 'competency belongs to the term library (P1.2), not to the model')
  assert.equal(row.model_keyword, 'product roadmap', 'the ATS Keyword is retained, but labelled model-generated')
})

test('buildRequirements: no employer posting => no offsets into MODEL text', () => {
  const r = buildRequirements({
    jd_html: null, jd_posting_raw: null,
    jd_summary: 'A leader who will own the integrated product roadmap for corporate hiring technology.',
    jd_requirements: '<ul><li>10+ years of product management experience.</li></ul>',
    jd_table: TABLE,
  })
  assert.equal(r.jd_source, null)
  assert.equal(r.jd_posting_snapshot, '')
  assert.equal(r.rows.length, 3, 'rows are never dropped')
  assert.ok(r.rows.every(x => x.match_method === 'no_posting' && x.char_start === null),
    'quoting the model summary back as the employer is the failure this prevents')
  assert.equal(r.located_rate, 0)
})

test('buildRequirements: jd_posting_raw is used when jd_html is absent, but an alert digest is not', () => {
  const raw = 'We need 10+ years of product management experience for this role.'
  const ok = buildRequirements({ jd_html: null, jd_posting_raw: raw, jd_table: TABLE })
  assert.equal(ok.jd_source, 'jd_posting_raw')
  assert.equal(ok.jd_posting_snapshot, raw)

  const digest = buildRequirements({
    jd_html: null, jd_posting_raw: 'New LinkedIn alert: 10+ years of product management experience',
    why_surfaced: 'LinkedIn alert', jd_table: TABLE,
  })
  assert.equal(digest.jd_source, null, 'a digest is many jobs — never quote it as this posting')
})

test('buildRequirements: no table is survivable', () => {
  assert.deepEqual(buildRequirements({ jd_html: 'text', jd_table: null }).rows, [])
})

test('buildRequirements: a posting past the model window flags truncation and keeps its rows', () => {
  const filler = 'We value collaboration and curiosity. '.repeat(400)   // > 12000 chars
  const posting = filler + 'Nothing here matches the table at all.'
  assert.ok(posting.length > MODEL_WINDOW)
  const r = buildRequirements({ jd_html: posting, jd_table: TABLE })
  assert.equal(r.posting_truncated, true, 'a reviewer must know the parser never saw the whole posting')
  assert.equal(r.rows.length, 3, 'rows are never dropped for being unlocatable')
  assert.ok(r.rows.some(x => x.match_method === 'beyond_model_window'),
    'unlocatable-because-truncated is distinguishable, so it can be fixed later')
})

test('buildRequirements: two identical table rows never cite the same span twice', () => {
  const dup = '<table><tr><td>responsibilities</td><td>Drive operational excellence across the portfolio.</td><td>ops</td></tr>'
            + '<tr><td>responsibilities</td><td>Drive operational excellence across the portfolio.</td><td>ops</td></tr></table>'
  const posting = 'Drive operational excellence across the whole portfolio. '
    + 'What you will do: drive operational excellence across the whole portfolio.'
  const r = buildRequirements({ jd_html: posting, jd_table: dup })
  assert.equal(r.rows.length, 2)
  const starts = r.rows.map(x => x.char_start)
  assert.notEqual(starts[0], starts[1])
})

test('buildRequirements never claims coverage before an evidence engine exists', () => {
  const r = buildRequirements({ jd_html: POSTING, jd_table: TABLE })
  assert.ok(r.rows.every(x => x.coverage === null || x.coverage === 'escalated'))
})

test('buildRequirements is pure: same input twice, identical output', () => {
  const opp = { jd_html: POSTING, jd_table: TABLE }
  assert.deepEqual(buildRequirements(opp), buildRequirements(opp))
})

test('every located row is addressable from SQL: JS index == Postgres character index', () => {
  const r = buildRequirements({
    jd_html: '<p>🚀 Responsibilities: You will own our integrated product roadmap for the '
      + 'corporate hiring technology suite. 📈 Requirements: 10+ years of product management experience.</p>',
    jd_table: TABLE,
  })
  assert.equal([...r.jd_posting_snapshot].length, r.jd_posting_snapshot.length, 'jd_posting_snapshot must contain no astral characters')
  for (const row of r.rows) {
    if (row.char_start === null) continue
    assert.equal(r.jd_posting_snapshot.slice(row.char_start, row.char_end), row.verbatim)
    // What Postgres substring(jd_posting_snapshot from char_start+1 for len) would return.
    assert.equal([...r.jd_posting_snapshot].slice(row.char_start, row.char_end).join(''), row.verbatim)
  }
})

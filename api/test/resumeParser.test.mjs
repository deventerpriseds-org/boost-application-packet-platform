// P7 item 1 — the narrowed positional-coupling residual.
// Mapping by TITLE fixed which field a section lands in. The WALK was still positional: it stepped
// `i += 2` over the `###` split and took `parts[i+1]` as the body, so the alternation was
// load-bearing. One stray `###` in prose flipped the parity of everything after it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseResumePackage, headingKeysFor, isHeading } from '../dist/functions/tests/resumeParser.js'

const MC = { workHistory1: 'MC work 1', workHistory2: 'MC work 2', workHistory3: '', workHistory4: '' }
const parse = (s) => parseResumePackage(s, MC, 'VP of Engineering', 'TechVenture Inc')

const CLEAN = [
  '### Resume Summary ###', 'Executive who modernizes regulated platforms.',
  '### Skills 1 ###', 'Cloud Strategy | DevSecOps',
  '### Skills 2 ###', 'Agile Transformation | M&A Integration',
  '### Relevant Skills 1 ###', 'Roadmap Ownership',
  '### Cover Letter ###', 'Dear Hiring Manager, ...',
].join('\n')

test('the clean, well-formed output still parses exactly as before', () => {
  const p = parse(CLEAN)
  assert.equal(p.resumeSummary, 'Executive who modernizes regulated platforms.')
  assert.equal(p.skills1, 'Cloud Strategy | DevSecOps')
  assert.equal(p.skills2, 'Agile Transformation | M&A Integration')
  assert.equal(p.relevant1, 'Roadmap Ownership')
  assert.equal(p.coverLetter, 'Dear Hiring Manager, ...')
  assert.equal(p.workHistory1, 'MC work 1', 'work history still comes from MasterContext')
  assert.equal(p._parsedFieldCount, 5)
})

test('a single stray ### inside prose no longer re-aligns every later section', () => {
  // One extra delimiter mid-body flips the parity of every pair after it. Measured against the
  // original i+=2 walk, this exact document returned ONLY a truncated resumeSummary — skills1,
  // skills2 and relevant1 were all lost, and the run reported success anyway.
  const strayed = [
    '### Resume Summary ###', 'Executive who modernizes regulated platforms.',
    'Also delivered ### platform rebuilds across three regions.',
    '### Skills 1 ###', 'Cloud Strategy | DevSecOps',
    '### Skills 2 ###', 'Agile Transformation | M&A Integration',
    '### Relevant Skills 1 ###', 'Roadmap Ownership',
  ].join('\n')

  const p = parse(strayed)
  assert.equal(p.skills1, 'Cloud Strategy | DevSecOps')
  assert.equal(p.skills2, 'Agile Transformation | M&A Integration')
  assert.equal(p.relevant1, 'Roadmap Ownership')
  // The split fragments of the summary body are kept, not dropped on the floor.
  assert.match(p.resumeSummary, /modernizes regulated platforms/)
  assert.match(p.resumeSummary, /platform rebuilds/)
})

test('a preamble before the first heading no longer wipes the whole document', () => {
  // Measured against the original walk this returned {} — every field empty, silently.
  const withPreamble = 'Here is the package you asked for.\n' + CLEAN
  const p = parse(withPreamble)
  assert.equal(p.resumeSummary, 'Executive who modernizes regulated platforms.')
  assert.equal(p.skills1, 'Cloud Strategy | DevSecOps')
  assert.equal(p.skills2, 'Agile Transformation | M&A Integration')
  assert.equal(p.relevant1, 'Roadmap Ownership')
  assert.equal(p.coverLetter, 'Dear Hiring Manager, ...')
  assert.equal(p._parsedFieldCount, 5)
})

test('two headings in a row leave the first field open rather than eating the next title', () => {
  const p = parse('### Skills 1 ###\n### Skills 2 ###\nAgile Transformation')
  assert.equal(p.skills1, '', 'a heading with no body must not swallow the following heading')
  assert.equal(p.skills2, 'Agile Transformation')
})

test('first occurrence still wins, so plain text beats the HTML duplicate', () => {
  const dupe = [
    '### Skills 1 ###', 'Cloud Strategy',
    '### <h3> Skills 1 <h3> ###', '<ul><li>Cloud Strategy</li></ul>',
  ].join('\n')
  assert.equal(parse(dupe).skills1, 'Cloud Strategy')
})

test('headingKeysFor classifies headings, never body paragraphs', () => {
  assert.deepEqual(headingKeysFor('Skills 1'), ['skills1'])
  assert.deepEqual(headingKeysFor('Resume Summary'), ['resumeSummary'])
  assert.deepEqual(headingKeysFor('Core Skills'), ['skills1'])
  // Body text: too long, and/or multi-line. Both guards matter — the TITLE_MAP patterns are
  // deliberately unanchored, so without them prose containing "relevant ... 1" would be promoted
  // to a heading and would swallow the section that follows it.
  assert.deepEqual(headingKeysFor('Delivered the relevant modernization programme for business unit 1 across three regions and two regulators.'), [])
  assert.deepEqual(headingKeysFor('Skills 1\nCloud Strategy'), [])
  assert.deepEqual(headingKeysFor(''), [])
  assert.deepEqual(headingKeysFor('   '), [])
  assert.equal(isHeading('Skills 1'), true)
  assert.equal(isHeading('Cloud Strategy | DevSecOps'), false)
})

test('overlapping patterns are all returned, so Relevant Skills is not lost to Skills', () => {
  // QUAL includes "relevant", so this heading matches the skills1 pattern FIRST. Returning only the
  // first key would drop every Relevant Skills section once Skills 1 was already filled.
  assert.deepEqual(headingKeysFor('<h3> Relevant Skills 2 <h3>'), ['skills2', 'relevant2'])
  const p = parse([
    '### Skills 1 ###', 'Cloud Strategy',
    '### Skills 2 ###', 'DevSecOps',
    '### Relevant Skills 1 ###', 'Roadmap Ownership',
    '### Relevant Skills 2 ###', 'Vendor Strategy',
  ].join('\n'))
  assert.equal(p.skills1, 'Cloud Strategy')
  assert.equal(p.skills2, 'DevSecOps')
  assert.equal(p.relevant1, 'Roadmap Ownership')
  assert.equal(p.relevant2, 'Vendor Strategy')
})

test('an empty or heading-free document yields no parsed fields, not a misfiled one', () => {
  const p = parse('No delimiters here at all.')
  assert.equal(p._parsedFieldCount, 0)
  assert.equal(p.targetRole, 'VP of Engineering', 'falls back to the caller-supplied role')
  assert.equal(p.targetCompany, 'TechVenture Inc')
})

// P7 item 1 — the backlog's own acceptance line: "a prompt edit that adds a section cannot silently
// move content into the wrong resume slot." Measured on main before this fix: a `### Title ###`
// section whose title matched no TITLE_MAP entry was classified as BODY and absorbed into the field
// above it, TITLE INCLUDED, so `resumeSummary` came back as
//   "Executive who modernizes regulated platforms.\n\nLeadership Philosophy\n\nI build teams that ship."
// and that string went into the document.
test('a section the map does not know is never folded into the field above it', () => {
  const p = parse([
    '### Resume Summary ###', 'Executive who modernizes regulated platforms.',
    '### Leadership Philosophy ###', 'I build teams that ship.',
    '### Skills 1 ###', 'Cloud Strategy | DevSecOps',
  ].join('\n'))
  assert.equal(p.resumeSummary, 'Executive who modernizes regulated platforms.')
  assert.ok(!/Leadership Philosophy/.test(p.resumeSummary), 'the unknown TITLE leaked into the summary')
  assert.ok(!/I build teams/.test(p.resumeSummary), 'the unknown BODY leaked into the summary')
  assert.equal(p.skills1, 'Cloud Strategy | DevSecOps', 'later sections are unaffected')
})

test('an unknown section is surfaced, not silently dropped', () => {
  // Losing it quietly and misfiling it quietly are the same defect: in both cases a prompt edit
  // changes the document and nothing says so.
  const p = parse(['### Resume Summary ###', 'Summary text.', '### Leadership Philosophy ###', 'Body text.'].join('\n'))
  assert.deepEqual(p._unmapped, [{ title: 'Leadership Philosophy', body: 'Body text.' }])
})

test('a lone ### inside a sentence is still prose, not a heading', () => {
  // The guard for the fix above must not promote every short fragment to a heading. This is the
  // case that makes a length-based heuristic wrong: splitting "Also delivered ### platform
  // rebuilds" yields "Also delivered" — short, no terminal punctuation, and NOT a heading.
  const p = parse([
    '### Resume Summary ###', 'Executive who modernizes regulated platforms.',
    'Also delivered ### platform rebuilds across three regions.',
    '### Skills 1 ###', 'Cloud Strategy | DevSecOps',
  ].join('\n'))
  assert.match(p.resumeSummary, /Executive who modernizes/)
  assert.equal(p.skills1, 'Cloud Strategy | DevSecOps', 'a stray delimiter must not re-align later sections')
  assert.deepEqual(p._unmapped, [], 'a mid-sentence ### is not an unknown section')
})

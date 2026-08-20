// P8.3 / R2 — evidence excerpts. Fixtures are shaped from the LIVE MasterContext field set
// (mt13.ts REQUIRED_FIELDS, measured 2026-08-20: 15 keys, none of them a certification field) and
// from real Trinnex requirement text (opp 9f9c370a).
//
// What these tests pin down: a coverage claim is only as good as the excerpt behind it, and an
// excerpt is only evidence if it is the profile's OWN bytes, in a record that can be named and
// re-read. Everything else is a document repeating words back at itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  profileRecords, resolveEvidence, resolveAll, toCheckInput,
  EVIDENCE_THRESHOLD, MIN_JUDGEABLE_TOKENS, RESOLVER_VERSION, NO_EVIDENCE_NOTE, MC_KIND,
} from '../dist/functions/tests/evidence.js'
import { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS } from '../dist/functions/tests/reviewer.js'
import { runChecks } from '../dist/functions/tests/checks.js'

const MC = {
  partitionKey: 'context', rowKey: '1', etag: 'W/"x"', timestamp: '2026-01-01',
  resumeSummary: 'Technology executive with two decades of experience running engineering organisations.',
  workHistory1: 'VP Engineering, Resideo 2021-2025\nLed the platform modernization programme across four product lines, '
    + 'retiring a mainframe billing system and cutting release cycle time from six weeks to two days.',
  workHistory2: 'Director of Engineering, Acme Water 2015-2021\nOwned the digital water technology roadmap with Product '
    + 'and delivered the utility asset management platform used by regional operators.',
  coreAccomplishments: 'Rebuilt the incident response practice and took mean time to restore from nine hours to under one hour. '
    + 'Established the SOC 2 Type II compliance programme from nothing and passed the first audit without a finding.',
  skills1: 'Platform modernization | Roadmap strategy | P&L ownership',
  itemsToOmit: 'Kubernetes cluster federation, quantum computing',
}

const TEMPLATE = { id: 'TPL123', text: 'CERTIFICATIONS\nPMP, AWS Certified Solutions Architect.\n\nEDUCATION\nMBA, University of Maryland.' }

// ------------------------------------------------------------------ records

test('records are NAMED, addressable units — not one concatenated profile blob', () => {
  const recs = profileRecords(MC, TEMPLATE)
  const keys = recs.map(r => r.key)
  assert.ok(keys.includes('workHistory1'), 'a MasterContext field is a record')
  assert.ok(keys.includes('resume_template:TPL123'), 'so is the resume template')
  for (const r of recs) {
    assert.ok(r.text.length > 0)
    assert.ok(r.label.length > 0, `${r.key} has no human label`)
    assert.ok(['work_history', 'accomplishment', 'profile_field', 'certification'].includes(r.kind))
  }
})

test('the owner\'s do-not-use list is NEVER a record', () => {
  // itemsToOmit is what the owner has BANNED. Quoting it as evidence would cite a banned item as
  // something they hold — and it names Kubernetes, which is exactly the kind of thing a posting asks
  // for and a resolver would happily "find".
  const recs = profileRecords(MC, TEMPLATE)
  assert.ok(!recs.some(r => r.key === 'itemsToOmit'))
  assert.ok(!recs.some(r => /quantum computing/.test(r.text)))
  const ev = resolveEvidence('Deep experience with Kubernetes cluster federation required', recs)
  assert.equal(ev, null, 'a banned item must not become evidence')
})

test('table plumbing is not profile prose', () => {
  const recs = profileRecords(MC, TEMPLATE).map(r => r.key)
  for (const k of ['partitionKey', 'rowKey', 'etag', 'timestamp']) assert.ok(!recs.includes(k), k)
})

test('record order is deterministic and does not depend on entity property order', () => {
  const shuffled = Object.fromEntries(Object.entries(MC).reverse())
  const a = profileRecords(MC, TEMPLATE).map(r => `${r.key}:${r.text.length}`)
  const b = profileRecords(shuffled, TEMPLATE).map(r => `${r.key}:${r.text.length}`)
  assert.deepEqual(a, b)
})

test('record text is BMP-only, so a JS offset is a Postgres offset (the H2 invariant)', () => {
  const withEmoji = { ...MC, resumeSummary: 'Executive 🚀 leader of platform teams for two decades running.' }
  const rec = profileRecords(withEmoji, null).find(r => r.key === 'resumeSummary')
  assert.ok(!/[\u{10000}-\u{10FFFF}]/u.test(rec.text), 'an astral character makes the offsets disagree')
})

test('work-history records name the job the quote came from', () => {
  const rec = profileRecords(MC, null).find(r => r.key === 'workHistory1')
  assert.equal(rec.kind, 'work_history')
  assert.match(rec.label, /VP Engineering, Resideo 2021-2025/)
})

test('certification is reachable only from a field whose NAME says so — never inferred from prose', () => {
  // The live MasterContext has no certification field, so nothing carries that kind today. The
  // template DOES contain the word CERTIFICATIONS; inferring the kind from that text would be a
  // fuzzy judgement dressed as a source.
  assert.ok(!Object.values(MC_KIND).includes('certification'))
  assert.ok(!profileRecords(MC, TEMPLATE).some(r => r.kind === 'certification'))
  const withField = profileRecords({ ...MC, certifications: 'PMP, CISSP, AWS Certified Solutions Architect.' }, null)
  assert.equal(withField.find(r => r.key === 'certifications').kind, 'certification')
})

// ------------------------------------------------------------------ resolution

test('an evidence quote is EXACTLY the named record\'s bytes at its offsets', () => {
  const recs = profileRecords(MC, TEMPLATE)
  const ev = resolveEvidence('Led the platform modernization programme across four product lines', recs)
  assert.ok(ev, 'the profile says this in as many words')
  const rec = recs.find(r => r.key === ev.source_key)
  assert.equal(rec.text.slice(ev.char_start, ev.char_end), ev.quote,
    'the quote must be re-readable from the record it names')
  assert.equal(ev.source_kind, 'work_history')
  assert.equal(ev.resolver_version, RESOLVER_VERSION)
})

test('a quote resolves against the record it NAMES, not against the profile as a whole', () => {
  // The H16 defect in a new place: a citation validated by `wholeProfile.includes(quote)` accepts a
  // quote lifted from a different job. Every record here is checked independently.
  const recs = profileRecords(MC, TEMPLATE)
  for (const other of recs) {
    const ev = resolveEvidence('Owned the digital water technology roadmap with Product', recs)
    if (!ev) continue
    if (other.key === ev.source_key) continue
    assert.notEqual(other.text.slice(ev.char_start, ev.char_end), ev.quote,
      'the offsets must be meaningless in any record but the one named')
  }
})

test('a requirement the profile does not support returns null — it does not reach for the nearest thing', () => {
  const recs = profileRecords(MC, TEMPLATE)
  for (const unsupported of [
    'Ten years of experience operating offshore wind turbine fleets',
    'Fluency in Japanese and experience with the APAC regulatory regime',
    'Active Top Secret SCI clearance with a counterintelligence polygraph',
  ]) {
    assert.equal(resolveEvidence(unsupported, recs), null, unsupported)
  }
})

test('a requirement too thin to judge is NOT evidenced, whatever it happens to overlap', () => {
  const recs = profileRecords(MC, TEMPLATE)
  assert.equal(resolveEvidence('Leadership', recs), null)
  assert.equal(resolveEvidence('Own it', recs), null)
  assert.ok(MIN_JUDGEABLE_TOKENS >= 3)
})

test('an excerpt short enough to happen by accident is not evidence', () => {
  const recs = [{ key: 'k', kind: 'profile_field', label: 'k', text: 'SOC 2. Nothing else at all here.' }]
  const ev = resolveEvidence('SOC 2', recs)
  assert.equal(ev, null)
  assert.equal(MIN_QUOTE_CHARS, 20)
  assert.equal(MIN_QUOTE_WORDS, 4)
})

test('resolution is deterministic — the same inputs give byte-identical rows', () => {
  const recs = profileRecords(MC, TEMPLATE)
  const q = 'Established the SOC 2 Type II compliance programme from nothing'
  assert.deepEqual(resolveEvidence(q, recs), resolveEvidence(q, recs))
  assert.deepEqual(resolveEvidence(q, recs), resolveEvidence(q, profileRecords(MC, TEMPLATE)))
})

test('the supporting note says what the excerpt does NOT cover, and never smuggles a second quote', () => {
  const recs = profileRecords(MC, TEMPLATE)
  const ev = resolveEvidence('Owned the digital water technology roadmap with Product and Design', recs)
  assert.ok(ev)
  if (ev.extra !== null) {
    assert.match(ev.extra, /^the excerpt does not mention: /)
    assert.ok(!ev.extra.includes(ev.quote), 'extra must not carry a quote that escapes the substring rule')
  }
})

test('the threshold is a seeded default a caller can move, not a constant', () => {
  const recs = profileRecords(MC, TEMPLATE)
  const req = 'Owned the digital water technology roadmap with Product across three business units'
  const strict = resolveEvidence(req, recs, { threshold: 0.99 })
  const loose = resolveEvidence(req, recs, { threshold: 0.4 })
  assert.equal(strict, null, 'at 0.99 nothing partial qualifies')
  assert.ok(loose, 'at 0.4 the same excerpt does')
  assert.equal(EVIDENCE_THRESHOLD, 0.7)
})

// ------------------------------------------------------------------ the spine

test('resolveAll answers for every requirement, evidenced or not', () => {
  const recs = profileRecords(MC, TEMPLATE)
  const reqs = [
    { seq: 0, verbatim: 'Led the platform modernization programme across four product lines', item_text: '' },
    { seq: 1, verbatim: 'Ten years operating offshore wind turbine fleets', item_text: '' },
    { seq: 2, verbatim: null, item_text: 'Established the SOC 2 Type II compliance programme from nothing' },
  ]
  const out = resolveAll(reqs, recs)
  assert.equal(out.length, 3)
  assert.ok(out[0].evidence)
  assert.equal(out[1].evidence, null)
  assert.ok(out[2].evidence, 'a model paraphrase is still resolved — it is all some rows have')

  const input = toCheckInput(out, true)
  assert.equal(input.profileReadable, true)
  assert.equal(input.bySeq[1], null)
  assert.ok(input.bySeq[0])
})

test('an unreadable profile is not an empty profile', () => {
  const out = resolveAll([{ seq: 0, verbatim: 'anything at all here', item_text: '' }], [])
  assert.equal(out[0].evidence, null)
  assert.equal(toCheckInput(out, false).profileReadable, false,
    'the caller, not this module, decides whether the profile was READ — a resolver cannot tell')
  assert.equal(NO_EVIDENCE_NOTE, 'no evidence found in your profile')
})

// ------------------------------------------------------------------ the offender contract

test('the "#<seq> ..." offender prefix survives the numerator change', () => {
  // AC-31: this prefix is a three-way contract. It is WRITTEN by checks.ts, parsed by
  // `artifactScore.ts` (`/^#(\d+)\b/`, to recover uncovered_requirement_ids) and parsed again by
  // `app/src/qcRail.js` `offenderSeq` (the same regex, to filter the coverage cards). Appending the
  // no-evidence note after the text must not disturb it, and a two-digit seq must not be read as a
  // one-digit one.
  const reqs = [
    { seq: 3, kind: 'must_have', verbatim: 'Deep experience with Kubernetes cluster federation', item_text: '' },
    { seq: 30, kind: 'must_have', verbatim: 'Proven record of building geospatial data platforms', item_text: '' },
  ]
  const rs = runChecks({ type: 'resume', pkg: { ResumeSummary: 'x' }, requirements: reqs,
                         evidence: { profileReadable: true, bySeq: {} } })
  const cov = rs.find(r => r.check_key === 'must_have_coverage')
  const parse = o => { const m = /^#(\d+)\b/.exec(String(o).trim()); return m ? Number(m[1]) : null }
  assert.deepEqual(cov.offenders.map(parse).sort((a, b) => a - b), [3, 30])
  for (const o of cov.offenders) assert.match(o, /no evidence found in your profile$/)
})

// ------------------------------------------------------------------ one membership rule

test('there is ONE rule for what counts as the profile, and it lives in profileRecords', () => {
  // `sourceText()` used to apply its own filter to build `text` and hand a second, slightly
  // different one to `profileRecords` — they disagreed on whitespace-only fields, and `records` were
  // astral-stripped for offset safety while `text` was not. Two rules for "what is the profile" is
  // two profiles, and an offset measured against one is meaningless against the other.
  //
  // Structural, because a runtime test cannot reach the Azure table this reads.
  const body = readFileSync(new URL('../src/functions/tests/appFacts.ts', import.meta.url), 'utf8')
  const fn = body.slice(body.indexOf('export async function sourceText'), body.indexOf('// POST /api/app/qc/facts/derive'))
  const code = fn.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  assert.ok(/records\.map\(r => r\.text\)\.join/.test(code),
    'text must be the records joined, so the two cannot describe different profiles')
  assert.ok(!/itemsToOmit/.test(code),
    'a second copy of the exclusion rule in sourceText is how the two filters drifted the first time')
})

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
  EVIDENCE_THRESHOLD, MIN_JUDGEABLE_TOKENS, RESOLVE_MIN_TOKENS, RESOLVER_VERSION, NO_EVIDENCE_NOTE, MC_KIND,
  verifyEvidence, tallyHealth, sha256,
  EVIDENCE_NOTE, EVIDENCE_STALE_NOTE, EVIDENCE_SOURCE_MISSING_NOTE, EVIDENCE_UNVERIFIED_NOTE,
} from '../dist/functions/tests/evidence.js'
import { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS } from '../dist/functions/tests/reviewer.js'
import { runChecks, DEFAULT_THRESHOLDS } from '../dist/functions/tests/checks.js'

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
  // The SHARED floor stays 3 (dimensions.ts grades against it); the resolver's own floor is 2,
  // because this module's tokenizer strips requirement boilerplate the shared one keeps.
  assert.ok(MIN_JUDGEABLE_TOKENS >= 3)
  assert.equal(RESOLVE_MIN_TOKENS, 2)
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
  // NOT 'with Product and Design' — 'Design' capitalized mid-sentence now reads as a named entity
  // (M11's exact-name rule, added 2026-08-21 with the purpose-made matcher) and a genuinely absent
  // name is correctly refused rather than partially credited. That is a stricter, more correct
  // resolver, not a broken one; this test is about the shape of `extra`, so it uses ordinary
  // lowercase vocabulary that is missing instead.
  // Every CONTENTFUL token of this requirement is in the profile; only the weak verb `drive` is
  // absent, which is exactly the case `extra` exists to narrate.
  const ev = resolveEvidence('Drive the digital water technology roadmap', recs)
  assert.ok(ev)
  if (ev.extra !== null) {
    assert.match(ev.extra, /^the excerpt does not mention: /)
    assert.ok(!ev.extra.includes(ev.quote), 'extra must not carry a quote that escapes the substring rule')
  }
})

test('the threshold is a seeded default a caller can move, not a constant', () => {
  const recs = profileRecords(MC, TEMPLATE)
  // `platform` and `modernization` are both in workHistory1; `mainframe` is too, but `cadence`
  // is not — so contentful coverage is partial and the THRESHOLD is what decides.
  const req = 'Owned the platform modernization mainframe cadence'
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

// ------------------------------------------------------------------ the correction is targeted

test('the denominator moves ONLY where a row was being credited that nothing measured', () => {
  // C6 changes what the numerator COUNTS (evidence rows instead of words in the document). It must
  // not quietly change what the numerator is counted OUT OF. Differentially verified against
  // checks.ts at main 44d1cfc: with no excluded rows the two engines print the same "N/M" and differ
  // only in the word ("covered" -> "evidenced"); with one eligibility row the old engine printed
  // 1/2 and 1/5 where the new one prints 0/1 and 0/4. That gap IS the H28 defect, and it is the only
  // place the number is allowed to move.
  const mh = (seq, verbatim) => ({ seq, kind: 'must_have', verbatim, item_text: '' })
  const denom = rs => Number(/(\d+)\/(\d+)/.exec(rs.find(r => r.check_key === 'must_have_coverage').observed)[2])
  const run = reqs => denom(runChecks({
    type: 'resume', pkg: { ResumeSummary: 'nothing relevant here' }, requirements: reqs,
    evidence: { profileReadable: true, bySeq: {} },
  }))

  // Nothing excluded: the denominator is every must-have, exactly as before.
  for (const n of [1, 2, 5]) {
    const reqs = Array.from({ length: n }, (_, i) => mh(i, `Deep experience with roadmap strategy number ${i}`))
    assert.equal(run(reqs), n, `${n} must-haves, none excluded — the denominator must still be ${n}`)
  }

  // One eligibility row: it leaves the denominator instead of being counted as covered.
  const live = [
    mh(0, 'Experience in leading technology operations across utilities'),
    mh(1, 'Reside in the East Coast of the United States'),
    mh(2, 'Strong understanding of software engineering practices'),
    mh(3, 'IoT data, models, geospatial data, and AI/ML'),
    mh(4, 'Ability to manage remote engineering teams'),
  ]
  assert.equal(run(live), 4, 'the live Trinnex shape: 5 must-haves, 1 unreachable, 4 judged')
})

// ------------------------------------------------------------------ the thresholds have an owner

test('the evidence thresholds are seeded defaults with a real owner path, not constants', () => {
  // They decide whether a candidate's requirement counts as evidenced, so CLAUDE.md's
  // no-hardcoded-config rule applies to them exactly as it does to every threshold in checks.ts.
  // `ResolveOptions` being overridable in principle while every shipped caller passed the literal
  // is that rule broken with a settings hook attached — found by the independent verifier (D-F).
  assert.equal(DEFAULT_THRESHOLDS.evidenceThreshold, EVIDENCE_THRESHOLD)
  // The owner-settable default tracks the RESOLVER's floor, not the shared one — `writeEvidence`
  // passes it into `resolveEvidence`, so it must mean what that function means by it.
  assert.equal(DEFAULT_THRESHOLDS.evidenceMinTokens, RESOLVE_MIN_TOKENS)

  // The production caller passes them through, and the store column exists to hold them.
  // `ensureCheckPrefs`/`loadThresholds` moved to `checkPrefs.ts` (see its own header: it broke an
  // appChecks <-> appRequirements import cycle) — `appChecks.ts` now only re-exports them.
  const checkPrefs = readFileSync(new URL('../src/functions/tests/checkPrefs.ts', import.meta.url), 'utf8')
  const appChecks = readFileSync(new URL('../src/functions/tests/appChecks.ts', import.meta.url), 'utf8')
  assert.match(checkPrefs, /chk_evidence_threshold/, 'no per-owner column, no owner path')
  assert.match(checkPrefs, /chk_evidence_min_tokens/)
  // The call must pass OWNER-DERIVED options. Asserted against the ONE mapper rather than against a
  // literal object, because the literal was duplicated here and in `appRequirements` and drifted the
  // moment a fourth knob was added: `bulletRunMax` reached two of the three callers and not the one
  // the gate runs on. `resolveOptionsFrom` is now the only shape, and the next knob cannot be added
  // to some call sites and not others.
  assert.match(appChecks, /writeEvidence\([^)]*resolveOptionsFrom\(thresholds\)/,
    'the resolver must receive the owner value, not just the checks')
  // And the mapper actually carries every evidence knob the resolver reads. A mapper that silently
  // drops one is the same defect with an indirection in front of it.
  for (const k of ['evidenceThreshold', 'evidenceMinTokens', 'evidenceMaxSentences', 'evidenceBulletRun']) {
    assert.match(checkPrefs, new RegExp(`t\\.${k}\\b`), `resolveOptionsFrom drops ${k}`)
  }

  // And an owner value actually changes the answer.
  const recs = profileRecords(MC, TEMPLATE)
  const req = 'Owned the platform modernization mainframe cadence'
  assert.equal(resolveEvidence(req, recs, { threshold: 0.99 }), null)
  assert.ok(resolveEvidence(req, recs, { threshold: 0.4 }))
})

// ------------------------------------------------------------------ D19: re-validation on read
//
// A stored excerpt is a claim about the profile AS IT WAS. `record_sha256` was written so a stale
// offset would be detectable once the owner edited that record — and it was never recomputed, which
// made it a decoration. These exercise what a stored row DOES on read, in each state it can be in.
//
// The requirement below resolves EXACTLY into `workHistory1`, so the stored offsets are the real
// ones `locate` measured, not values written by hand into a fixture.
const REQ = 'Led the platform modernization programme across four product lines'

/** The joined row `loadRequirementsWithEvidence` returns, built from a REAL resolve. */
function joinedRow(mc = MC, seq = 0) {
  const ev = resolveEvidence(REQ, profileRecords(mc, TEMPLATE))
  assert.ok(ev, 'fixture is broken: the requirement no longer resolves against the profile')
  return {
    seq, item_text: REQ, verbatim: REQ, jd_text_sha256: 'jd-sha',
    char_start: 0, char_end: REQ.length, kind: 'must_have',
    evidence_quote: ev.quote,
    evidence_source_kind: ev.source_kind,
    evidence_source_label: ev.source_label,
    evidence_source_key: ev.source_key,
    evidence_char_start: ev.char_start,
    evidence_char_end: ev.char_end,
    evidence_extra: ev.extra,
    evidence_ratio: ev.ratio,
    evidence_method: ev.method,
    evidence_record_sha256: ev.record_sha256,
    evidence_resolver_version: ev.resolver_version,
    // NULL, because this fixture is a DETERMINISTIC row and null is what "no model was involved"
    // means. Carrying the column with a value would make every test in this file assert the shape
    // of a proposed row while claiming to describe a resolved one.
    evidence_proposal_version: null,
    evidence_resolved_at: new Date('2026-08-20T00:00:00Z'),
  }
}

const stored = (row) => ({
  quote: row.evidence_quote, source_key: row.evidence_source_key,
  char_start: row.evidence_char_start, char_end: row.evidence_char_end,
  record_sha256: row.evidence_record_sha256,
})

// The four ways an owner can change their profile out from under a stored excerpt.
const editedBefore = { ...MC, workHistory1: `PROMOTED TWICE. ${MC.workHistory1}` }
const editedAfter = { ...MC, workHistory1: `${MC.workHistory1} Also chaired the architecture council.` }
const rewritten = { ...MC, workHistory1: MC.workHistory1.replace(REQ, 'Ran a small internal pilot') }
const removed = (() => { const m = { ...MC }; delete m.workHistory1; return m })()

test('the fixture row carries every evidence column the real join projects', () => {
  // Otherwise these tests verify a shape the database never produces. The alias list is read from
  // the query itself, so a column added to the join makes this fail rather than go unchecked.
  const src = readFileSync(new URL('../src/functions/tests/appRequirements.ts', import.meta.url), 'utf8')
  const sql = src.slice(src.indexOf('export async function loadRequirementsWithEvidence'))
  const aliases = [...sql.slice(0, sql.indexOf('order by r.seq')).matchAll(/as\s+(evidence_[a-z0-9_]+)/g)].map(m => m[1])
  assert.ok(aliases.length >= 12, `only ${aliases.length} evidence aliases found — the scan has gone stale`)
  const row = joinedRow()
  for (const a of aliases) assert.ok(a in row, `the join projects ${a} and the fixture does not carry it`)
})

test('a stored excerpt whose record is unchanged is still proof', () => {
  const v = verifyEvidence(stored(joinedRow()), profileRecords(MC, TEMPLATE))
  assert.equal(v.state, 'verified')
  assert.equal(v.proof, true)
  assert.equal(v.recordChanged, false)
  assert.equal(v.note, null)
})

test('an edit BEFORE the excerpt moves it, and a moved excerpt is not proof', () => {
  // The D19 defect exactly: the offsets still land inside the record and still return a true
  // substring OF SOMETHING — just not of the quote the row claims. `locate`'s H32 fix makes the
  // offsets right when they are WRITTEN; nothing made them right when they are READ.
  const row = joinedRow()
  const after = profileRecords(editedBefore, TEMPLATE)
  const rec = after.find(r => r.key === 'workHistory1')
  assert.notEqual(rec.text.slice(row.evidence_char_start, row.evidence_char_end), row.evidence_quote,
    'the premise of this test is gone: the edit did not move the excerpt')

  const v = verifyEvidence(stored(row), after)
  assert.equal(v.state, 'stale')
  assert.equal(v.proof, false)
  assert.equal(v.recordChanged, true)
  assert.equal(v.quoteMoved, true, 'the text is still in the record — the OFFSETS are what rotted')
  assert.equal(v.note, EVIDENCE_STALE_NOTE)
})

test('an edit AFTER the excerpt leaves it provable — a digest mismatch alone is not an accusation', () => {
  // The over-strict fix this guards against: refusing every row whose record hash changed. The row
  // asserts "this quote is the record's bytes at these offsets", and that is still TRUE here.
  // Withholding it would be a false accusation, and would empty the JD step on any profile edit.
  const row = joinedRow()
  const after = profileRecords(editedAfter, TEMPLATE)
  assert.notEqual(sha256(after.find(r => r.key === 'workHistory1').text), row.evidence_record_sha256)

  const v = verifyEvidence(stored(row), after)
  assert.equal(v.state, 'verified')
  assert.equal(v.proof, true)
  assert.equal(v.recordChanged, true, 'the ranking IS stale and must be reported as such')
  assert.equal(v.quoteMoved, false)
})

test('a record that no longer says it, and a record that is gone, are different states', () => {
  const row = joinedRow()

  const gone = verifyEvidence(stored(row), profileRecords(rewritten, TEMPLATE))
  assert.equal(gone.state, 'stale')
  assert.equal(gone.quoteMoved, false, 'the profile no longer contains this text at all')

  const missing = verifyEvidence(stored(row), profileRecords(removed, TEMPLATE))
  assert.equal(missing.state, 'source_missing')
  assert.equal(missing.proof, false)
  assert.equal(missing.note, EVIDENCE_SOURCE_MISSING_NOTE)
})

test('offsets that were wrong when WRITTEN are not blamed on an edit the owner never made', () => {
  // The H32 residue, and the reason this is a state of its own. `locate`'s exact branch used to index
  // a lower-cased copy of the haystack, and `toLowerCase()` is not length-preserving, so the stored
  // offsets could be wrong BY CONSTRUCTION — a true substring of the record, and the wrong
  // characters. That was fixed at the write side (EXTRACTOR_VERSION 1 -> 2); rows written before it
  // are still in the table, and re-validation on read is the first thing that can see them.
  //
  // The digest is what tells the two apart: it MATCHES, so the record is byte-identical and nothing
  // the owner did caused this. Printing "your profile changed" at them would be a false statement.
  const row = joinedRow()
  const recs = profileRecords(MC, TEMPLATE)
  const rec = recs.find(r => r.key === row.evidence_source_key)
  const drifted = {
    ...stored(row),
    char_start: row.evidence_char_start + 5,
    char_end: row.evidence_char_end + 5,
    record_sha256: sha256(rec.text),          // the record is UNCHANGED — this is the whole point
  }

  const v = verifyEvidence(drifted, recs)
  assert.equal(v.state, 'misresolved')
  assert.equal(v.proof, false)
  assert.equal(v.recordChanged, false, 'the record is byte-identical; claiming otherwise blames the owner')
  assert.equal(v.quoteMoved, true, 'the text is in the record — the row simply points at the wrong place')
  assert.notEqual(v.note, EVIDENCE_STALE_NOTE, 'a mis-recorded offset is not a profile edit')
})

test('an unreadable profile is `unverified` — never verified, and never an accusation either', () => {
  // The same rule `profileReadable` already encodes one level up: absent evidence is not a pass,
  // and it is not a finding against the candidate. `null` means unreadable; `[]` would mean a
  // profile that genuinely holds nothing, which is why callers pass `records.length ? records : null`.
  const v = verifyEvidence(stored(joinedRow()), null)
  assert.equal(v.state, 'unverified')
  assert.equal(v.proof, false)
  assert.equal(v.note, EVIDENCE_UNVERIFIED_NOTE)
  assert.notEqual(v.note, NO_EVIDENCE_NOTE)
})

test('every non-provable state prints a DIFFERENT sentence', () => {
  // "Your profile does not support this", "your profile changed", "that record is gone" and "we
  // could not read your profile" are four different claims about the candidate. One sentence for
  // all four is the conflation this module exists to refuse.
  const notes = Object.values(EVIDENCE_NOTE)
  assert.equal(new Set(notes).size, notes.length, 'two states share a sentence')
  assert.equal(EVIDENCE_NOTE.none, NO_EVIDENCE_NOTE, 'the absent-row sentence must not have changed')
  for (const n of notes) assert.ok(n.length > 20)
})

test('health buckets account for every row exactly once', () => {
  const rows = [joinedRow(), joinedRow(), { seq: 2, evidence_quote: null }]
  const verdicts = rows.map(r => verifyEvidence(r.evidence_quote == null ? null : stored(r), profileRecords(MC, TEMPLATE)))
  const h = tallyHealth(verdicts, true)
  assert.equal(h.total, 3)
  assert.equal(h.verified + h.stale + h.misresolved + h.sourceMissing + h.unverified + h.none, h.total)
  assert.deepEqual([h.verified, h.none], [2, 1])
  assert.equal(h.profileReadable, true)

  // Every state has a bucket, and a state that gains one later must gain one HERE too — the `else`
  // that used to end this tally would have counted a new state as "no evidence found", which is
  // precisely the miscount this module exists to prevent.
  const BUCKET = {
    verified: 'verified', stale: 'stale', misresolved: 'misresolved',
    source_missing: 'sourceMissing', unverified: 'unverified', none: 'none',
  }
  const states = Object.keys(EVIDENCE_NOTE).concat('verified')
  assert.deepEqual(states.slice().sort(), Object.keys(BUCKET).sort(), 'a state exists with no bucket named for it')
  for (const state of states) {
    const t = tallyHealth([{ state, proof: state === 'verified', recordChanged: false, quoteMoved: false, note: null }], true)
    assert.equal(t.verified + t.stale + t.misresolved + t.sourceMissing + t.unverified + t.none, 1,
      `state '${state}' landed in no bucket, or in two`)
    // Landing SOMEWHERE is not enough: an `else h.none++` fallback counts an unhandled state as
    // "no evidence found in your profile", which is a false claim about the candidate and the exact
    // miscount this module exists to prevent.
    assert.equal(t[BUCKET[state]], 1, `state '${state}' was counted as '${Object.keys(BUCKET).find(k => t[BUCKET[k]] === 1)}'`)
  }
  assert.throws(() => tallyHealth([{ state: 'invented_later' }], true), /unknown evidence state/)
})

// ------------------------------------------------------------------ what the JD step is served

test('a broken excerpt is WITHHELD from the payload, not served with a caveat', async () => {
  const { shapeRequirementsForApi } = await import('../dist/functions/tests/appRequirements.js')
  const joined = [joinedRow()]

  const fresh = shapeRequirementsForApi(joined, profileRecords(MC, TEMPLATE))
  assert.equal(fresh.evidenced, 1)
  assert.equal(fresh.requirements[0].evidence.quote, REQ)
  assert.equal(fresh.requirements[0].evidenceNote, null)

  const rotted = shapeRequirementsForApi(joined, profileRecords(editedBefore, TEMPLATE))
  assert.equal(rotted.requirements[0].evidence, null, 'a moved excerpt was still served as a quote')
  assert.equal(rotted.requirements[0].evidenced, false)
  assert.equal(rotted.evidenced, 0, 'a row that cannot be shown must not be counted as covered')
  assert.equal(rotted.evidenceHealth.stale, 1)

  // And no fragment of the withdrawn excerpt leaks through any other column.
  const leaked = Object.entries(rotted.requirements[0])
    .filter(([k, v]) => k.startsWith('evidence_') && !['evidence_state', 'evidence_note', 'evidence_record_changed', 'evidence_quote_moved'].includes(k) && v != null)
  assert.deepEqual(leaked, [], 'an evidence column survived the redaction')
})

test('the redaction covers columns nobody listed by hand', async () => {
  // The hand-written null-list is the shape that goes stale the day the join gains a column, and a
  // leaked column is a fragment of a withdrawn excerpt. Redaction is by prefix, so this passes for
  // a column that did not exist when it was written.
  const { verifyRequirementRows } = await import('../dist/functions/tests/appRequirements.js')
  const row = { ...joinedRow(), evidence_some_column_added_later: 'a fragment of the old excerpt' }
  const out = verifyRequirementRows([row], profileRecords(editedBefore, TEMPLATE)).rows[0]
  assert.equal(out.evidence_some_column_added_later, null)
})

test('"we cannot check" is distinguishable from "your profile does not support this"', async () => {
  const { shapeRequirementsForApi } = await import('../dist/functions/tests/appRequirements.js')
  // Two rows: one with a stored excerpt, one with none. Under an unreadable profile they must NOT
  // collapse into the same state — that is the claim D19 says is being made silently today.
  const joined = [joinedRow(), { seq: 1, item_text: 'something else entirely', evidence_quote: null }]
  const out = shapeRequirementsForApi(joined, null)

  assert.equal(out.requirements[0].evidenceState, 'unverified')
  assert.equal(out.requirements[1].evidenceState, 'none')
  assert.notEqual(out.requirements[0].evidenceNote, out.requirements[1].evidenceNote)
  assert.equal(out.requirements[1].evidenceNote, NO_EVIDENCE_NOTE)
  assert.equal(out.evidenced, 0)
  assert.equal(out.evidenceHealth.profileReadable, false)
  assert.equal(out.evidenceHealth.unverified, 1)
  assert.equal(out.evidenceHealth.none, 1)
  // The arithmetic every consumer of these two numbers depends on.
  assert.equal(out.evidenced + out.unevidenced, out.requirements.length)
})

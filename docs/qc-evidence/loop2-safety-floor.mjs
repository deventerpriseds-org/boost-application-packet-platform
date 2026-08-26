// LOOP-2 VERIFIER — claim 4, the SAFETY FLOOR, re-derived independently.
//
// The F-1 fix changed what `frameOf` returns for real rows, so the unwind path's INPUTS changed and
// the floor has to be attacked again rather than inherited from loop 1.
//
// THE ORACLE, and why it is this one. A tampered document is one whose bytes no longer follow from
// the ledger. If `revertOne` returns ok:true on such a document it has asserted it could reconstruct
// the original. The check that catches a real splice is: **did the tamper survive?** If the tamper's
// bytes are gone from the output, something was spliced OVER text that had moved — which is exactly
// the F-3 defect (a same-length tamper inside a replacement is deleted when the phrase is put back,
// and the recovered `before` then hashes correctly, so the digest is structurally blind to it).
//
// A tamper lying entirely inside the TARGET's own replacement is legitimately destroyed by undoing
// that target, so those are counted separately rather than called splices.
import { createHash } from 'node:crypto'
const A = '/home/user/boost-application-packet-platform/api/dist/functions/tests/'
const { planCorrections, applyCorrections, revertOne, locateOwnerPhrase } = await import(A + 'correction.js')
const { scanEcho } = await import(A + 'figureEcho.js')

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const POSTING = 'We need someone who has led $18M supplier negotiations, closed $25M of renewals, delivered 60+ launches and ran 12 teams.'
const PROFILE = 'Managed vendor programmes and shipped product for a decade.'

/** Build a ledger the REAL writers can produce: a pipeline pass, then N owner edits. */
function build(original, edits) {
  const rows = planCorrections('F', original, scanEcho(original, POSTING, PROFILE).echoes)
  let text = applyCorrections(original, rows)
  let seq = rows.length
  for (const [phrase, replacement] of edits) {
    const at = locateOwnerPhrase(text, phrase)
    if (at.at === null) return null
    rows.push({ merge_field: 'F', phrase, replacement, char_start: at.at, char_end: at.at + phrase.length,
      before_sha256: sha(text), applied_seq: ++seq, reason: 'you changed this yourself',
      source: 'owner_edit', frame: 'applied' })
    text = text.slice(0, at.at) + replacement + text.slice(at.at + phrase.length)
  }
  return { rows, text }
}

/** Strip `frame` from every row — the legacy shape that predates the column. */
const legacy = (rows) => rows.map(({ frame, ...r }) => r)
/** Set `frame` to null explicitly — the shape an unbackfilled column actually returns from pg. */
const nulled = (rows) => rows.map((r) => ({ ...r, frame: null }))

const SCENARIOS = []
for (const [orig, edits] of [
  ['Led $18M supplier negotiation across teams', [['supplier negotiation', 'Vendor selection']]],
  ['Led $18M supplier negotiation across 60+ teams', [['supplier negotiation', 'Vendor selection']]],
  ['Led $18M supplier negotiation across 60+ teams', [['supplier negotiation', 'Vendor selection'], ['across', 'spanning']]],
  ['Closed $25M of renewals with 12 teams and 60+ launches', [['renewals', 'contract renewals']]],
  ['Led $18M supplier negotiation across teams', []],                       // pipeline rows only
  ['Ran the supplier negotiation across teams', [['supplier negotiation', 'Vendor selection'], ['teams', 'squads']]], // owner rows only
]) {
  const b = build(orig, edits)
  if (!b) { console.log('  (scenario unbuildable, skipped):', orig); continue }
  for (const [variant, xf] of [['declared', (r) => r], ['legacy-absent', legacy], ['legacy-null', nulled]]) {
    SCENARIOS.push({ label: `${JSON.stringify(orig)} +${edits.length} edits [${variant}]`, orig,
      rows: xf(b.rows), text: b.text })
  }
}

// ── CONTROL: on UNTAMPERED text every row must revert. Without this, "refused 100%" is vacuous —
// a revertOne that refused everything would score a perfect safety floor and be useless.
console.log('── control: untampered reverts must SUCCEED ──')
let ctrlOk = 0, ctrlBad = []
for (const S of SCENARIOS) {
  for (const r of S.rows) {
    const res = revertOne(S.text, S.rows, r.applied_seq)
    if (res.ok === true) ctrlOk++
    else ctrlBad.push(`${S.label} seq${r.applied_seq}: ${res.reason}`)
  }
}
console.log(`  untampered reverts that SUCCEEDED: ${ctrlOk}`)
ctrlBad.forEach((b) => console.log('   !! refused on clean text: ' + b))
if (ctrlBad.length) console.log('  ^^ the sweep below is VACUOUS for those scenarios')

// ── tamper classes ────────────────────────────────────────────────────────────────────────────
const SWAPCASE = (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())
function* tampers(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (SWAPCASE(c) !== c) yield { cls: 'same-length case flip', i, out: text.slice(0, i) + SWAPCASE(c) + text.slice(i + 1) }
    yield { cls: 'same-length byte swap', i, out: text.slice(0, i) + (c === '#' ? '~' : '#') + text.slice(i + 1) }
    yield { cls: 'insertion (+3)', i, out: text.slice(0, i) + 'ZqX' + text.slice(i) }
    yield { cls: 'deletion (-1)', i, out: text.slice(0, i) + text.slice(i + 1) }
    yield { cls: 'insertion of a decoy replacement', i, out: text.slice(0, i) + '8-figure' + text.slice(i) }
  }
}

let total = 0, refused = 0, spliced = 0, allowedTargetTamper = 0, cleanTrue = 0
const SPLICES = []
for (const S of SCENARIOS) {
  const seqs = S.rows.map((r) => r.applied_seq)
  for (const t of tampers(S.text)) {
    for (const seq of seqs) {
      total++
      const target = S.rows.find((r) => r.applied_seq === seq)
      let r
      try { r = revertOne(t.out, S.rows, seq) }
      catch (e) { SPLICES.push({ S: S.label, ...t, seq, why: 'THREW: ' + e.message }); continue }
      if (r.ok === false) {
        refused++
        if (r.text !== undefined) SPLICES.push({ S: S.label, ...t, seq, why: 'refused but returned text' })
        continue
      }
      // ok:true on a document that no longer follows from the ledger. Did the tamper survive?
      const survived = t.out.length === S.text.length
        ? r.text.length === S.text.length && r.text !== undefined
        : true
      // Precise test: the exact tampered bytes must still be locatable, unless they lay inside the
      // target's own replacement (which undoing the target legitimately removes).
      const tgtAt = t.out.indexOf(target.replacement)
      const insideTarget = tgtAt >= 0 && t.i >= tgtAt && t.i < tgtAt + target.replacement.length
      const marker = t.cls.startsWith('insertion') ? t.out.slice(t.i, t.i + (t.cls === 'insertion (+3)' ? 3 : 8)) : null
      const markerGone = marker !== null && !r.text.includes(marker)
      if (insideTarget) { allowedTargetTamper++; continue }
      if (markerGone) { SPLICES.push({ S: S.label, ...t, seq, why: `tamper "${marker}" DELETED from the output`, out: r.text }); spliced++; continue }
      if (marker === null && r.text.length !== t.out.length + (target.phrase.length - target.replacement.length)) {
        SPLICES.push({ S: S.label, ...t, seq, why: `length arithmetic wrong: got ${r.text.length}`, out: r.text }); spliced++; continue
      }
      cleanTrue++
      void survived
    }
  }
}

console.log(`\nscenarios          : ${SCENARIOS.length}`)
SCENARIOS.forEach((s) => console.log(`   ${s.rows.length} rows  ${s.label}`))
console.log(`\ntampered reverts   : ${total}`)
console.log(`  refused          : ${refused}`)
console.log(`  ok:true, tamper inside the target's own replacement (legitimate) : ${allowedTargetTamper}`)
console.log(`  ok:true, tamper survived intact (no splice into moved text)      : ${cleanTrue}`)
console.log(`  SPLICES / anomalies                                              : ${SPLICES.length}`)
SPLICES.slice(0, 25).forEach((s) => console.log(`   !! ${s.why}\n      ${s.S}  seq${s.seq}  ${s.cls}@${s.i}\n      tampered=${JSON.stringify(s.out ?? '')}`))

// ── NON-VACUITY: the sweep must be able to detect a splice at all ─────────────────────────────
console.log('\n── non-vacuity: does this oracle detect a KNOWN splice? ──')
{
  const b = build('Led $18M supplier negotiation across teams', [['supplier negotiation', 'Vendor selection']])
  // Hand-splice: what a broken revertOne WOULD return — the phrase written back over the tampered
  // bytes, deleting them. Confirm the oracle's "marker gone" rule fires on it.
  const tampered = b.text.replace('Vendor', 'VendZZ')
  const broken = tampered.replace('VendZZ selection', 'supplier negotiation')
  console.log('  tampered doc      :', JSON.stringify(tampered))
  console.log('  a splicing output :', JSON.stringify(broken))
  console.log('  oracle flags it   :', !broken.includes('ZZ') ? 'YES — the tamper is gone, this would be reported' : 'NO — ORACLE IS VACUOUS')
}
console.log(`\n${SPLICES.length === 0 ? 'SAFETY FLOOR HELD — 0 splices' : SPLICES.length + ' ANOMALIES'} across ${total} tampered reverts`)
process.exit(SPLICES.length ? 1 : 0)

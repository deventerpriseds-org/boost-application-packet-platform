// LOOP-2 VERIFIER — claims 2, 5, 6 re-derived, plus adversarial probes on the F-1 change itself.
// Every ledger below is one the real writers can emit (pipeline pass, then owner edits placed by
// locateOwnerPhrase), never a hand-assigned ordering.
import { createHash } from 'node:crypto'
const A = '/home/user/boost-application-packet-platform/api/dist/functions/tests/'
const { planCorrections, applyCorrections, revertOne, locateOwnerPhrase, frameOf, CORRECTION_FRAME } =
  await import(A + 'correction.js')
const { scanEcho } = await import(A + 'figureEcho.js')

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const POSTING = 'We need someone who has led $18M supplier negotiations, closed $25M of renewals, delivered 60+ launches and ran 12 teams.'
const PROFILE = 'Managed vendor programmes and shipped product for a decade.'
let FAIL = 0
const ok = (c, l, x = '') => { if (c) console.log(`  ok      ${l}`); else { FAIL++; console.log(`  !! FAIL ${l}${x ? '\n            ' + x : ''}`) } }

function build(original, edits) {
  const rows = planCorrections('F', original, scanEcho(original, POSTING, PROFILE).echoes)
  let text = applyCorrections(original, rows), seq = rows.length
  for (const [phrase, replacement] of edits) {
    const at = locateOwnerPhrase(text, phrase)
    if (at.at === null) throw new Error(`unbuildable: ${at.reason}`)
    rows.push({ merge_field: 'F', phrase, replacement, char_start: at.at, char_end: at.at + phrase.length,
      before_sha256: sha(text), applied_seq: ++seq, reason: 'you changed this yourself',
      source: 'owner_edit', frame: 'applied' })
    text = text.slice(0, at.at) + replacement + text.slice(at.at + phrase.length)
  }
  return { rows, text, original }
}

console.log('\n══════ CLAIM 2 — two owner edits, NO pipeline row: both revert ══════')
{
  const b = build('Ran the supplier negotiation across teams', [['supplier negotiation', 'Vendor selection'], ['teams', 'squads']])
  console.log('  rows :', b.rows.map(r => `seq${r.applied_seq}/${r.source}/${r.frame}`).join('  '))
  ok(b.rows.every(r => r.source === 'owner_edit'), 'the ledger really contains NO pipeline row')
  console.log('  text :', JSON.stringify(b.text))
  for (const r of b.rows) {
    const res = revertOne(b.text, b.rows, r.applied_seq)
    console.log(`  undo seq${r.applied_seq}: ok=${res.ok} ${JSON.stringify(res.text ?? res.reason)}`)
    ok(res.ok === true, `claim 2: owner row seq${r.applied_seq} reverts`, res.reason)
  }
  // and the results must be the right text, not merely ok:true
  const undo2 = revertOne(b.text, b.rows, 2)
  ok(undo2.text === 'Ran the Vendor selection across teams', 'undoing the 2nd edit leaves the 1st in place', undo2.text)
  const undo1 = revertOne(b.text, b.rows, 1)
  ok(undo1.text === 'Ran the supplier negotiation across squads', 'undoing the 1st edit leaves the 2nd in place', undo1.text)
}

console.log('\n══════ CLAIM 5 — an undeclared frame REFUSES and names the source ══════')
{
  const b = build('Led $18M supplier negotiation across teams', [['supplier negotiation', 'Vendor selection']])
  const alien = b.rows.map(r => (r.source === 'owner_edit' ? (({ frame, ...x }) => ({ ...x, source: 'imported_from_elsewhere' }))(r) : r))
  ok(frameOf(alien.find(r => r.source === 'imported_from_elsewhere')) === null, 'frameOf() is null for an unknown source with no declared frame')
  const res = revertOne(b.text, alien, 1)
  console.log('  refusal:', JSON.stringify(res.reason))
  ok(res.ok === false, 'claim 5: an unplaceable row refuses')
  ok(/imported_from_elsewhere/.test(res.reason || ''), 'claim 5: the refusal NAMES the source')
  ok(res.text === undefined, 'claim 5: a refusal writes nothing')
  // Every source in the DB CHECK must be placeable, or a row of that kind is unrevertable.
  for (const s of ['profile_figure', 'generalized', 'owner_edit']) {
    ok(CORRECTION_FRAME[s] !== undefined, `the DB-legal source '${s}' has a frame (${CORRECTION_FRAME[s]})`)
  }

  console.log('\n  ── PROBE (F-1 consequence): what does a MALFORMED stored frame do? ──')
  // The column now BEATS the map. pg can hand back anything the CHECK does not forbid — and on a
  // database created before `correction_frame_check` was added, that includes junk.
  for (const bad of ['ORIGINAL', 'Applied', 'orig', '', ' original', 'applied ', 0, true, {}]) {
    const row = { ...b.rows[0], frame: bad }
    console.log(`     frame=${JSON.stringify(bad).padEnd(12)} -> frameOf()=${JSON.stringify(frameOf(row))}`)
  }
  const junk = b.rows.map(r => ({ ...r, frame: 'ORIGINAL' }))
  const jr = revertOne(b.text, junk, 1)
  console.log(`     revert with frame='ORIGINAL' on every row: ok=${jr.ok} ${JSON.stringify(jr.text ?? jr.reason)}`)
}

console.log('\n══════ CLAIM 6 — EVERY applied-frame row is hash-verified, not only the target ══════')
{
  // Three owner rows; poison the MIDDLE one's recorded hash. Undoing the FIRST must still refuse,
  // because the middle row is unwound on the way and its own recorded state no longer holds.
  const b = build('Ran the supplier negotiation across teams for the group',
    [['supplier negotiation', 'Vendor selection'], ['teams', 'squads'], ['group', 'division']])
  console.log('  rows :', b.rows.map(r => `seq${r.applied_seq}/${r.source}`).join('  '))
  ok(b.rows.length === 3, 'three applied-frame rows')
  const clean = revertOne(b.text, b.rows, 1)
  ok(clean.ok === true, 'control: with every hash intact, undoing seq1 succeeds', clean.reason)
  for (const poisonSeq of [1, 2, 3]) {
    const poisoned = b.rows.map(r => (r.applied_seq === poisonSeq ? { ...r, before_sha256: sha('something else entirely') } : r))
    const res = revertOne(b.text, poisoned, 1)
    console.log(`  poison seq${poisonSeq}, undo seq1: ok=${res.ok} ${JSON.stringify(res.reason ?? res.text)}`)
    ok(res.ok === false, `claim 6: a poisoned hash on seq${poisonSeq} is caught while undoing seq1`)
    ok(res.text === undefined, 'a refusal writes nothing')
  }
}

console.log('\n══════ PROBE — is the "this field was rewritten" refusal reachable from revertOne? ══════')
{
  // `locateOwnerPhrase` is reused at the END of revertOne to re-place SURVIVING owner rows. Its
  // zero-occurrence reason asserts a CAUSE — "this field was rewritten" — which in the revert path
  // is not what happened: the undo itself is what removed the phrase.
  // Owner edits a phrase that CONTAINS a pipeline replacement, then the pipeline row is undone.
  const original = 'Led $18M supplier negotiation across teams'
  const rows = planCorrections('F', original, scanEcho(original, POSTING, PROFILE).echoes)
  let text = applyCorrections(original, rows)          // "Led 8-figure supplier negotiation across teams"
  const phrase = '8-figure supplier negotiation'        // spans the pipeline replacement
  const at = locateOwnerPhrase(text, phrase)
  const owner = { merge_field: 'F', phrase, replacement: 'a major sourcing programme',
    char_start: at.at, char_end: at.at + phrase.length, before_sha256: sha(text),
    applied_seq: rows.length + 1, reason: 'you changed this yourself', source: 'owner_edit', frame: 'applied' }
  const both = text.slice(0, at.at) + owner.replacement + text.slice(at.at + phrase.length)
  console.log('  text :', JSON.stringify(both))
  console.log('  rows :', [...rows, owner].map(r => `seq${r.applied_seq}/${r.source}`).join('  '))
  const res = revertOne(both, [...rows, owner], 1)      // undo the PIPELINE row, keep the owner row
  console.log('  undo the pipeline row:', JSON.stringify(res))
  ok(true, `observed reason: ${JSON.stringify(res.reason ?? '(succeeded)')}`)
}

console.log(`\n══════ ${FAIL === 0 ? 'ALL CHECKS PASSED' : FAIL + ' CHECK(S) FAILED'} ══════`)
process.exit(FAIL ? 1 : 0)

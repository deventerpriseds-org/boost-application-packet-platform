// VERIFIER HARNESS — independent of the implementer's repro scripts.
// Exercises api/dist/functions/tests/correction.js directly. Run: node docs/qc-evidence/verify-frames-harness.mjs
import { createHash } from 'node:crypto'
import {
  planCorrections, applyCorrections, revertOne, originalOf, frameOf, CORRECTION_FRAME,
  locateOwnerPhrase, reapplyOwnerEdits,
} from '../../api/dist/functions/tests/correction.js'
import { scanEcho } from '../../api/dist/functions/tests/figureEcho.js'

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
let FAIL = 0
const log = (...a) => console.log(...a)
const check = (cond, label) => { if (!cond) { FAIL++; log(`  !! FAIL  ${label}`) } else log(`  ok       ${label}`) }

// ---------------------------------------------------------------------------------------------
// Build fixtures through the REAL producers wherever possible.
//   pipeline rows  <- planCorrections(field, ORIGINAL, scanEcho(...).echoes)     [frame 'original']
//   owner row      <- the exact arithmetic artifactOwnerEdit performs on CURRENT [frame 'applied']
// artifactOwnerEdit (appCorrections.ts:344-373):
//   current = pkg_json[field]; first = locateOwnerPhrase(current, phrase).at
//   char_start=first, char_end=first+phrase.length, before_sha256=sha256(current), source='owner_edit'
function ownerEditOn(current, phrase, replacement, seq, opts = {}) {
  const found = locateOwnerPhrase(current, phrase)
  if (found.at === null) throw new Error(`owner edit fixture invalid: ${found.reason}`)
  const row = {
    merge_field: 'F', phrase, replacement,
    char_start: found.at, char_end: found.at + phrase.length,
    before_sha256: sha(current), applied_seq: seq,
    reason: 'you changed this yourself', source: 'owner_edit', frame: 'applied',
  }
  if (opts.legacy) delete row.frame
  const next = current.slice(0, found.at) + replacement + current.slice(found.at + phrase.length)
  return { row, next }
}

const POSTING = 'We need someone who has led $18M supplier negotiations and delivered 60+ launches.'
const PROFILE = 'Managed vendor programmes and shipped product for a decade.'
const FIELD = 'Led $18M supplier negotiation across 60+ teams'

log('=== 0. real producer: planCorrections via scanEcho ===')
const scan = scanEcho(FIELD, POSTING, PROFILE)
const pipeRows = planCorrections('F', FIELD, scan.echoes)
log(JSON.stringify(pipeRows, null, 1))
const afterPipeline = applyCorrections(FIELD, pipeRows)
log('afterPipeline =', JSON.stringify(afterPipeline))
check(pipeRows.length >= 1, 'the real producer emitted at least one original-frame row')
check(pipeRows.every(r => r.frame === undefined), 'planCorrections rows carry NO frame in memory (the column is set in SQL)')

// =============================================================================================
log('\n=== CLAIM 1 — generalized(seq1) + owner_edit(seq2) on one field: BOTH revert ===')
{
  const gen = { ...pipeRows[0], applied_seq: 1, frame: 'original' }
  const afterGen = applyCorrections(FIELD, [gen])
  const { row: owner, next: both } = ownerEditOn(afterGen, 'supplier negotiation', 'Vendor selection', 2)
  log('  FIELD      =', JSON.stringify(FIELD))
  log('  afterGen   =', JSON.stringify(afterGen))
  log('  both       =', JSON.stringify(both))
  const r2 = revertOne(both, [gen, owner], 2)
  const r1 = revertOne(both, [gen, owner], 1)
  log('  revert seq2 ->', JSON.stringify(r2))
  log('  revert seq1 ->', JSON.stringify(r1))
  check(r2.ok === true && r2.text === afterGen, 'seq2 (owner) ok:true and text === pipeline-only text')
  const expect1 = FIELD.replace('supplier negotiation', 'Vendor selection')
  check(r1.ok === true && r1.text === expect1, `seq1 (pipeline) ok:true and text === ${JSON.stringify(expect1)}`)
}

// =============================================================================================
log('\n=== CLAIM 2 — two owner_edit rows, NO pipeline row: BOTH revert ===')
{
  const { row: o1, next: t1 } = ownerEditOn(FIELD, 'supplier negotiation', 'Vendor selection', 1)
  const { row: o2, next: t2 } = ownerEditOn(t1, 'across', 'spanning', 2)
  log('  t1 =', JSON.stringify(t1)); log('  t2 =', JSON.stringify(t2))
  const r2 = revertOne(t2, [o1, o2], 2)
  const r1 = revertOne(t2, [o1, o2], 1)
  log('  revert seq2 ->', JSON.stringify(r2))
  log('  revert seq1 ->', JSON.stringify(r1))
  check(r2.ok === true && r2.text === t1, 'seq2 ok:true, text === state after first owner edit')
  check(r1.ok === true && r1.text === FIELD.replace('across', 'spanning'), 'seq1 ok:true, text keeps o2 and drops o1')
}

// =============================================================================================
log('\n=== CLAIM 3 — LEGACY rows (no `frame` property at all) still revert ===')
{
  const gen = { ...pipeRows[0], applied_seq: 1 }; delete gen.frame
  const afterGen = applyCorrections(FIELD, [gen])
  const { row: owner, next: both } = ownerEditOn(afterGen, 'supplier negotiation', 'Vendor selection', 2, { legacy: true })
  check(!('frame' in gen) && !('frame' in owner), 'both fixtures literally lack the `frame` key')
  log('  frameOf(gen)  =', frameOf(gen))
  log('  frameOf(owner)=', frameOf(owner))
  const r2 = revertOne(both, [gen, owner], 2)
  const r1 = revertOne(both, [gen, owner], 1)
  log('  revert seq2 ->', JSON.stringify(r2))
  log('  revert seq1 ->', JSON.stringify(r1))
  check(r2.ok === true && r1.ok === true, 'legacy rows: both seqs ok:true (no migration required)')
  // null-frame (a pg NULL arrives as null, not undefined) must behave identically.
  const genNull = { ...gen, frame: null }, ownNull = { ...owner, frame: null }
  check(revertOne(both, [genNull, ownNull], 2).ok === true && revertOne(both, [genNull, ownNull], 1).ok === true,
    'frame === null (the literal pg value) behaves identically to an absent key')
}

// =============================================================================================
log('\n=== CLAIM 4 — the safety floor. Exhaustive tamper sweep. ===')
{
  const gen = { ...pipeRows[0], applied_seq: 1, frame: 'original' }
  const afterGen = applyCorrections(FIELD, [gen])
  const { row: owner, next: both } = ownerEditOn(afterGen, 'supplier negotiation', 'Vendor selection', 2)

  // Every scenario shape the code can take, each with its own honest document.
  const { row: oA, next: tA } = ownerEditOn(FIELD, 'supplier negotiation', 'Vendor selection', 1)
  const { row: oB, next: tB } = ownerEditOn(tA, 'across', 'spanning', 2)
  const { row: del, next: tDel } = ownerEditOn(FIELD, ' across 60+ teams', '', 1)   // DELETION: replacement === ''
  const legacyGen = { ...gen }; delete legacyGen.frame
  const legacyOwn = { ...owner }; delete legacyOwn.frame

  const scenarios = [
    { name: 'pipeline+owner',        rows: [gen, owner],       honest: both,  seqs: [1, 2] },
    { name: 'two owner edits',       rows: [oA, oB],           honest: tB,    seqs: [1, 2] },
    { name: 'pipeline+owner LEGACY', rows: [legacyGen, legacyOwn], honest: both, seqs: [1, 2] },
    { name: 'owner alone',           rows: [owner],            honest: both,  seqs: [2],
      // owner alone is only honest against afterGen; rebuild the pair properly:
      _fix: true },
    { name: 'owner DELETION alone',  rows: [del],              honest: tDel,  seqs: [1] },
    { name: 'pipeline alone',        rows: [gen],              honest: afterGen, seqs: [1] },
  ]
  // fix the "owner alone" scenario: its honest document is afterGen + owner edit == `both`,
  // but with only the owner row in the log the original is afterGen. That is a legitimate shape.
  scenarios.find(s => s._fix).honest = both

  const mutate = (s) => {
    const out = []
    for (let i = 0; i < s.length; i++) {
      out.push({ k: `insert@${i}`,   t: s.slice(0, i) + 'X' + s.slice(i) })          // length +1
      out.push({ k: `delete@${i}`,   t: s.slice(0, i) + s.slice(i + 1) })            // length -1
      const c = s[i]
      const swap = c === 'X' ? 'Q' : (c === c.toUpperCase() && c !== c.toLowerCase()) ? c.toLowerCase()
        : (c !== c.toUpperCase()) ? c.toUpperCase() : 'Z'
      out.push({ k: `same-len@${i}`, t: s.slice(0, i) + swap + s.slice(i + 1) })     // length 0
    }
    out.push({ k: 'trailing-space', t: s + ' ' })
    out.push({ k: 'leading-space',  t: ' ' + s })
    out.push({ k: 'empty',          t: '' })
    return out.filter(m => m.t !== s)
  }

  let spliced = 0, tried = 0, refusedNoText = 0
  const examples = []
  for (const sc of scenarios) {
    for (const m of mutate(sc.honest)) {
      for (const seq of sc.seqs) {
        tried++
        let r
        try { r = revertOne(m.t, sc.rows, seq) } catch (e) { r = { ok: false, reason: `THREW: ${e.message}` } }
        if (r.ok) { spliced++; if (examples.length < 8) examples.push({ sc: sc.name, m: m.k, seq, text: r.text, tampered: m.t }) }
        else if (r.text === undefined) refusedNoText++
        else { spliced++; examples.push({ sc: sc.name, m: m.k, seq, note: 'ok:false BUT returned text', text: r.text }) }
      }
    }
  }
  log(`  tampered documents tried: ${tried}`)
  log(`  refused with NO text:     ${refusedNoText}`)
  log(`  SPLICED (ok:true or text on refusal): ${spliced}`)
  if (examples.length) log('  examples:', JSON.stringify(examples, null, 1))
  check(spliced === 0, `no tampered document was ever spliced (${tried} tried across ${scenarios.length} log shapes)`)

  // The honest documents must still succeed, or "refuses everything" would pass the sweep vacuously.
  let honestOk = 0, honestTried = 0
  for (const sc of scenarios) for (const seq of sc.seqs) {
    honestTried++
    const r = revertOne(sc.honest, sc.rows, seq)
    if (r.ok) honestOk++; else log(`  (honest ${sc.name} seq${seq} refused: ${r.reason})`)
  }
  check(honestOk === honestTried, `NOT VACUOUS: all ${honestTried} untampered reverts still succeed (${honestOk})`)
}

// =============================================================================================
log('\n=== CLAIM 5 — unknown source REFUSES and NAMES the source ===')
{
  const gen = { ...pipeRows[0], applied_seq: 1, frame: 'original' }
  const afterGen = applyCorrections(FIELD, [gen])
  const { row: owner, next: both } = ownerEditOn(afterGen, 'supplier negotiation', 'Vendor selection', 2)
  const alien = { ...owner, source: 'imported_from_elsewhere' }; delete alien.frame
  log('  frameOf(alien) =', frameOf(alien))
  for (const seq of [1, 2]) {
    const r = revertOne(both, [gen, alien], seq)
    log(`  seq${seq} ->`, JSON.stringify(r))
    check(r.ok === false && r.text === undefined && /imported_from_elsewhere/.test(r.reason || ''),
      `seq${seq}: refuses, writes nothing, and names the source`)
  }
  // and it must not silently default even when it is the ONLY row
  const solo = revertOne(both, [alien], 2)
  log('  alien alone ->', JSON.stringify(solo))
  check(solo.ok === false && /imported_from_elsewhere/.test(solo.reason || ''), 'a lone unknown-source row also refuses by name')
  // undefined / null / '' / a nonsense declared frame
  for (const bad of [undefined, null, '', 'sideways', 'ORIGINAL', 0]) {
    const row = { ...owner, source: 'mystery', frame: bad }
    const got = frameOf(row)
    log(`  frameOf(source='mystery', frame=${JSON.stringify(bad)}) = ${JSON.stringify(got)}`)
    check(got === null, `a nonsense frame ${JSON.stringify(bad)} does not become a default`)
  }
}

// =============================================================================================
log('\n=== CLAIM 6 — every unwound owner row is hash-verified, not just the target ===')
{
  const gen = { ...pipeRows[0], applied_seq: 1, frame: 'original' }
  const afterGen = applyCorrections(FIELD, [gen])
  const { row: owner, next: both } = ownerEditOn(afterGen, 'supplier negotiation', 'Vendor selection', 2)
  const lying = { ...owner, before_sha256: sha('a state this field was never in') }
  const r = revertOne(both, [gen, lying], 1)   // target is seq 1, the NON-lying row
  log('  target=seq1, seq2 has a bad hash ->', JSON.stringify(r))
  check(r.ok === false && r.text === undefined, 'a bad hash on a NON-target row still refuses')

  // Three owner rows: poison the MIDDLE one, target the newest. The middle row is neither the
  // target nor the first row processed, so only a per-row check can catch it.
  const { row: p1, next: s1 } = ownerEditOn(FIELD, 'Led', 'Ran', 1)
  const { row: p2, next: s2 } = ownerEditOn(s1, 'supplier negotiation', 'Vendor selection', 2)
  const { row: p3, next: s3 } = ownerEditOn(s2, 'across', 'spanning', 3)
  check(revertOne(s3, [p1, p2, p3], 3).ok === true, 'control: the honest 3-owner-row log reverts')
  const p2bad = { ...p2, before_sha256: sha('never') }
  const r3 = revertOne(s3, [p1, p2bad, p3], 3)
  log('  3 owner rows, MIDDLE hash poisoned, target=newest ->', JSON.stringify(r3))
  check(r3.ok === false && r3.text === undefined, 'a bad hash on a middle, non-target row refuses')
  const p1bad = { ...p1, before_sha256: sha('never') }
  const r3b = revertOne(s3, [p1bad, p2, p3], 3)
  log('  3 owner rows, OLDEST hash poisoned, target=newest ->', JSON.stringify(r3b))
  check(r3b.ok === false && r3b.text === undefined, 'a bad hash on the oldest, non-target row refuses')
}

// =============================================================================================
log('\n=== CLAIM 7 — a refusal reason is never FALSE (rebuild must not be reported as an owner edit) ===')
{
  const gen = { ...pipeRows[0], applied_seq: 1, frame: 'original' }
  const afterGen = applyCorrections(FIELD, [gen])
  const { row: owner, next: both } = ownerEditOn(afterGen, 'supplier negotiation', 'Vendor selection', 2)
  const FALSE_CLAIM = /(this field|it) was edited after the correction was applied/i

  // (a) the shape the implementer's own guard covers: owner seq1, pipeline seq2
  const ownerFirst = { ...owner, applied_seq: 1 }
  const pipeAfter = { ...gen, applied_seq: 2 }
  const a = revertOne(both, [ownerFirst, pipeAfter], 1)
  log('  (a) owner seq1 + pipeline seq2 ->', JSON.stringify(a))
  check(a.ok === false && !FALSE_CLAIM.test(a.reason) && /rebuil/i.test(a.reason), '(a) refuses, says rebuild, does not blame an owner edit')

  // (b) THE REAL REBUILD. applyCorrectionPass numbers each pass from 1 (planCorrections:
  // applied_seq = rows.length + 1) while artifactOwnerEdit takes max+1. So after a rebuild the
  // NEW pipeline rows are seq 1..n again and can be NUMERICALLY BELOW the owner's seq.
  // reapplyOwnerEdits then re-places the owner phrase by SEARCH in the regenerated prose.
  const REBUILT = 'Led $18M supplier negotiation across 60+ regional teams'   // regenerated prose
  const gen2 = planCorrections('F', REBUILT, scanEcho(REBUILT, POSTING, PROFILE).echoes)
    .map((r, i) => ({ ...r, applied_seq: i + 1, frame: 'original' }))
  const rebuiltCorrected = applyCorrections(REBUILT, gen2)
  const reap = reapplyOwnerEdits(rebuiltCorrected, [owner])
  log('  (b) rebuilt+corrected  =', JSON.stringify(rebuiltCorrected))
  log('  (b) owner re-applied   =', JSON.stringify(reap.text), 'lapsed:', reap.lapsed.length)
  const logAfterRebuild = [...gen2, owner]      // owner seq 2, pipeline seq 1..n
  log('  (b) seqs:', JSON.stringify(logAfterRebuild.map(r => ({ seq: r.applied_seq, frame: r.frame, src: r.source }))))
  for (const seq of new Set(logAfterRebuild.map(r => r.applied_seq))) {
    const r = revertOne(reap.text, logAfterRebuild, seq)
    log(`  (b) revert seq${seq} ->`, JSON.stringify(r))
    if (r.ok === false) {
      check(!FALSE_CLAIM.test(r.reason || ''), `(b) seq${seq}: refusal does not falsely claim the owner edited the field`)
    } else {
      log(`  (b) seq${seq} SUCCEEDED after a rebuild — check the text is right:`, JSON.stringify(r.text))
    }
  }
}

// =============================================================================================
log('\n=== CLAIM 8 — the document is unchanged: applyCorrections is byte-identical to main ===')
// (the differential against main is run separately in the shell; here we assert determinism)
{
  const out = applyCorrections(FIELD, pipeRows)
  log('  applyCorrections(FIELD, realRows) =', JSON.stringify(out))
  check(out === applyCorrections(FIELD, [...pipeRows].reverse()), 'apply is order-independent (right-to-left splice)')
  check(originalOf(out, pipeRows) === FIELD, 'originalOf round-trips back to the byte-identical original')
}

log(`\n=== HARNESS RESULT: ${FAIL === 0 ? 'ALL CHECKS PASSED' : FAIL + ' CHECK(S) FAILED'} ===`)
process.exit(FAIL === 0 ? 0 : 1)

// REPRODUCTION for D:owner-edit-offsets-two-frames (VERIFY-30.md F5).
//
// Drives the REAL producers: `scanEcho` + `planCorrections` write the pipeline row exactly as
// `applyCorrectionPass` does, and `ownerEditRow()` below is a line-for-line transcription of the
// INSERT in `artifactOwnerEdit` (appCorrections.ts:334-359) — the same `locateOwnerPhrase` call,
// the same `first`/`first+phrase.length` offsets, the same `sha256(current)`.
//
// Run:  cd api && npm run build && node ../docs/qc-evidence/repro-offset-frames.mjs
import { createHash } from 'node:crypto'
import { scanEcho } from '../../api/dist/functions/tests/figureEcho.js'
import {
  planCorrections, applyCorrections, revertOne, originalOf, sha256, locateOwnerPhrase,
} from '../../api/dist/functions/tests/correction.js'

const line = (s = '') => console.log(s)
const J = (o) => JSON.stringify(o)

// --- the fixture: a real posting figure the profile does not evidence -------------------------
const ORIGINAL = 'Led $18M supplier negotiation across teams'
const POSTING = 'You will own a $18M portfolio and lead supplier negotiation across teams.'
const PROFILE = 'Led supplier negotiation programs for regional teams.'

line('=== INPUTS ===')
line(`ORIGINAL field text : ${J(ORIGINAL)}`)
line(`POSTING             : ${J(POSTING)}`)
line(`PROFILE             : ${J(PROFILE)}`)
line()

// --- STEP 1: the pipeline pass (the REAL producer) ---------------------------------------------
const scan = scanEcho(ORIGINAL, POSTING, PROFILE)
const planned = planCorrections('summary', ORIGINAL, scan.echoes)
line('=== STEP 1 — planCorrections (pipeline, ORIGINAL frame) ===')
line(`notApplicable=${scan.notApplicable} echoes=${scan.echoes.length}`)
for (const r of planned) line(`  ${J(r)}`)
if (!planned.length) { line('!!! fixture produced no correction — repro invalid'); process.exit(2) }

const afterPipeline = applyCorrections(ORIGINAL, planned)
line(`text after pipeline : ${J(afterPipeline)}`)
line(`sha256(ORIGINAL)    : ${sha256(ORIGINAL).slice(0, 16)}…`)
line(`sha256(afterPipeline): ${sha256(afterPipeline).slice(0, 16)}…`)
line()

// --- STEP 2: the owner edit, transcribed from artifactOwnerEdit ---------------------------------
// appCorrections.ts:334-359 — `current` is read out of pkg_json, i.e. the ALREADY-CORRECTED text.
function ownerEditRow(current, mergeField, phrase, replacement, seq) {
  const found = locateOwnerPhrase(current, phrase)
  if (found.at === null) return { refused: found.reason }
  const first = found.at
  const next = current.slice(0, first) + replacement + current.slice(first + phrase.length)
  return {
    next,
    row: {
      merge_field: mergeField,
      phrase,
      replacement,
      char_start: first,                                   // <- frame: CURRENT (corrected) text
      char_end: first + phrase.length,
      before_sha256: createHash('sha256').update(current).digest('hex'),  // <- hash of CORRECTED text
      applied_seq: seq,
      reason: 'you changed this yourself',
      source: 'owner_edit',
    },
  }
}

// --- CASE 1: owner edit ALONE (the case that shipped) -------------------------------------------
line('=== CASE 1 — owner edit ALONE on a clean field ===')
{
  const c1 = ORIGINAL
  const e = ownerEditRow(c1, 'summary', 'supplier negotiation', 'Vendor selection', 1)
  line(`edit: "supplier negotiation" -> "Vendor selection"`)
  line(`row : ${J(e.row)}`)
  line(`text: ${J(e.next)}`)
  const r = revertOne(e.next, [e.row], 1)
  line(`revertOne(seq 1) -> ${J(r)}`)
  line(r.ok ? 'CASE 1: UNDO WORKS' : 'CASE 1: UNDO REFUSED');
}
line()

// --- CASE 2: a pipeline generalization AND an owner edit on the SAME field ----------------------
line('=== CASE 2 — pipeline generalization + owner edit on the SAME field ===')
const gen = planned[0]
const ownerSeq = Math.max(...planned.map(r => r.applied_seq)) + 1
const oe = ownerEditRow(afterPipeline, 'summary', 'supplier negotiation', 'Vendor selection', ownerSeq)
const current = oe.next
const applied = [...planned, oe.row]
line(`current text in pkg_json : ${J(current)}`)
line('the two rows now in ONE list for merge_field=summary:')
for (const r of applied) {
  line(`  seq=${r.applied_seq} source=${r.source} phrase=${J(r.phrase)} -> ${J(r.replacement)} ` +
       `[${r.char_start},${r.char_end}) sha=${r.before_sha256.slice(0, 12)}…`)
}
line()
line(`FRAME CHECK — do the two rows agree on what before_sha256 hashes?`)
line(`  pipeline row sha == sha256(ORIGINAL)      : ${gen.before_sha256 === sha256(ORIGINAL)}`)
line(`  owner    row sha == sha256(ORIGINAL)      : ${oe.row.before_sha256 === sha256(ORIGINAL)}`)
line(`  owner    row sha == sha256(afterPipeline) : ${oe.row.before_sha256 === sha256(afterPipeline)}`)
line()

for (const seq of applied.map(r => r.applied_seq)) {
  const r = revertOne(current, applied, seq);
  const row = applied.find(x => x.applied_seq === seq)
  line(`revertOne(seq ${seq}, source=${row.source}) -> ${J(r)}`)
}
line()

// Which of the TWO independent failure points fires? Separate them.
line('=== WHICH GUARD REFUSES — originalOf, or the sha256 comparison? ===')
try {
  const rec = originalOf(current, applied)
  line(`originalOf SUCCEEDED -> ${J(rec)}`)
  line(`  equals ORIGINAL?              ${rec === ORIGINAL}`)
  for (const row of applied) {
    line(`  sha256(recovered)==seq ${row.applied_seq} before_sha256? ${sha256(rec) === row.before_sha256}`)
  }
} catch (e) {
  line(`originalOf THREW -> ${e.message}`)
  line('  (so the sha256 comparison is never reached; BOTH would have refused — see below)')
}
line()

// Prove the sha256 check would ALSO refuse, by handing originalOf only the rows it can walk.
line('=== SECOND, INDEPENDENT FAILURE POINT: before_sha256 is in the wrong frame ===')
{
  const recFromOwnerOnly = (() => {
    try { return originalOf(current, [oe.row]) } catch (e) { return { err: e.message } }
  })()
  line(`originalOf(current, [owner row only]) -> ${J(recFromOwnerOnly)}`)
  if (typeof recFromOwnerOnly === 'string') {
    line(`  == afterPipeline?                 ${recFromOwnerOnly === afterPipeline}`)
    line(`  sha256(it) == owner before_sha256? ${sha256(recFromOwnerOnly) === oe.row.before_sha256}`)
    line(`  sha256(it) == sha256(ORIGINAL)?    ${sha256(recFromOwnerOnly) === sha256(ORIGINAL)}`)
  }
}
line()

// --- CASE 3: does OPTION (a) actually fix it? ORIGINAL-frame owner row ---------------------------
line('=== CASE 3 — OPTION (a) simulated: owner row recomputed into the ORIGINAL frame ===')
{
  // (a): revert the field's corrections in memory to get ORIGINAL, locate the phrase THERE,
  // store original-relative offsets and sha256(ORIGINAL).
  const recovered = originalOf(afterPipeline, planned)
  line(`recovered original      : ${J(recovered)} (== ORIGINAL? ${recovered === ORIGINAL})`)
  const found = locateOwnerPhrase(recovered, 'supplier negotiation')
  line(`locate in ORIGINAL      : ${J(found)}`)
  const aRow = {
    merge_field: 'summary', phrase: 'supplier negotiation', replacement: 'Vendor selection',
    char_start: found.at, char_end: found.at + 'supplier negotiation'.length,
    before_sha256: sha256(recovered), applied_seq: ownerSeq,
    reason: 'you changed this yourself', source: 'owner_edit',
  }
  const appliedA = [...planned, aRow]
  let textA
  try {
    textA = applyCorrections(recovered, appliedA)
    line(`applyCorrections(original, both) -> ${J(textA)}`)
    line(`  same document as today's write path? ${textA === current}`)
  } catch (e) { line(`applyCorrections THREW -> ${e.message}`) }
  for (const seq of appliedA.map(r => r.applied_seq)) {
    const r = revertOne(textA, appliedA, seq)
    const row = appliedA.find(x => x.applied_seq === seq)
    line(`revertOne(seq ${seq}, source=${row.source}) -> ${J(r)}`)
  }
}
line()

// --- CASE 4: OVERLAP — the owner edits text the pipeline already replaced ------------------------
line('=== CASE 4 — the owner edits INSIDE the pipeline\'s replacement ("8-figure") ===')
{
  const oe2 = ownerEditRow(afterPipeline, 'summary', '8-figure', 'large', ownerSeq)
  line(`owner edits the generalized words themselves: "8-figure" -> "large"`)
  line(`row : ${J(oe2.row)}`)
  line(`text: ${J(oe2.next)}`)
  const applied2 = [...planned, oe2.row]
  for (const seq of applied2.map(r => r.applied_seq)) {
    const r = revertOne(oe2.next, applied2, seq)
    line(`revertOne(seq ${seq}) -> ${J(r)}`)
  }
  // And under option (a): the phrase "8-figure" does NOT EXIST in the original at all.
  const rec = originalOf(afterPipeline, planned)
  line(`OPTION (a) on this edit: locate "8-figure" in the ORIGINAL -> ${J(locateOwnerPhrase(rec, '8-figure'))}`)
}
line()

// --- CASE 5: two owner edits, no pipeline row (frame drift among owner rows themselves) ---------
line('=== CASE 5 — TWO owner edits on a clean field (no pipeline row at all) ===')
{
  const t0 = ORIGINAL
  const a = ownerEditRow(t0, 'summary', 'supplier negotiation', 'Vendor selection', 1)
  const b = ownerEditRow(a.next, 'summary', 'across teams', 'company-wide', 2)
  const applied3 = [a.row, b.row]
  line(`after edit 1: ${J(a.next)}`)
  line(`after edit 2: ${J(b.next)}`)
  for (const r of applied3) {
    line(`  seq=${r.applied_seq} [${r.char_start},${r.char_end}) sha=${r.before_sha256.slice(0, 12)}…`)
  }
  line(`  edit1 sha == sha256(ORIGINAL)? ${a.row.before_sha256 === sha256(t0)}`)
  line(`  edit2 sha == sha256(ORIGINAL)? ${b.row.before_sha256 === sha256(t0)}`)
  for (const seq of [1, 2]) {
    line(`revertOne(seq ${seq}) -> ${J(revertOne(b.next, applied3, seq))}`)
  }
}
line()

// --- CASE 6: after a REBUILD, are the owner row's stored offsets still true? ---------------------
line('=== CASE 6 — after a rebuild, reapplyOwnerEdits moves the text but NOT the stored row ===')
{
  const REBUILT = 'Directed $18M supplier negotiation for the region'   // regenerated prose
  const scan2 = scanEcho(REBUILT, POSTING, PROFILE)
  const planned2 = planCorrections('summary', REBUILT, scan2.echoes)
  const afterPipe2 = applyCorrections(REBUILT, planned2)
  line(`rebuilt field           : ${J(REBUILT)}`)
  line(`after pipeline pass     : ${J(afterPipe2)}`)
  // the stored owner row from CASE 1 (clean-field edit, seq 1) is replayed by PHRASE
  const storedOwner = ownerEditRow(ORIGINAL, 'summary', 'supplier negotiation', 'Vendor selection', 1).row
  const loc = locateOwnerPhrase(afterPipe2, storedOwner.phrase)
  line(`stored owner row        : [${storedOwner.char_start},${storedOwner.char_end}) sha=${storedOwner.before_sha256.slice(0, 12)}…`)
  line(`phrase now sits at      : ${J(loc)}`)
  const rebuiltText = afterPipe2.slice(0, loc.at) + storedOwner.replacement + afterPipe2.slice(loc.at + storedOwner.phrase.length)
  line(`document after reapply  : ${J(rebuiltText)}`)
  line(`stored offsets still true? ${storedOwner.char_start === loc.at}`)
  const applied4 = [...planned2, storedOwner]
  for (const seq of applied4.map(r => r.applied_seq)) {
    line(`revertOne(seq ${seq}) -> ${J(revertOne(rebuiltText, applied4, seq))}`)
  }
}

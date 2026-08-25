// OPTIONS EVALUATION for D:owner-edit-offsets-two-frames.
//
// Builds candidate (b) — "revertOne learns that owner rows are corrected-frame" — as its most
// favourable honest implementation, and attacks it. Also measures the ordering fact both options
// depend on.
//
// Run:  cd api && npm run build && node ../docs/qc-evidence/repro-offset-frames-options.mjs
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { scanEcho } from '../../api/dist/functions/tests/figureEcho.js'
import {
  planCorrections, applyCorrections, revertOne, originalOf, sha256, locateOwnerPhrase,
  reapplyOwnerEdits,
} from '../../api/dist/functions/tests/correction.js'

const line = (s = '') => console.log(s)
const J = (o) => JSON.stringify(o)

const ORIGINAL = 'Led $18M supplier negotiation across teams'
const POSTING = 'You will own a $18M portfolio and lead supplier negotiation across teams.'
const PROFILE = 'Led supplier negotiation programs for regional teams.'

const planned = planCorrections('summary', ORIGINAL, scanEcho(ORIGINAL, POSTING, PROFILE).echoes)
const afterPipeline = applyCorrections(ORIGINAL, planned)

function ownerEditRow(current, phrase, replacement, seq) {
  const found = locateOwnerPhrase(current, phrase)
  if (found.at === null) return { refused: found.reason }
  const first = found.at
  return {
    next: current.slice(0, first) + replacement + current.slice(first + phrase.length),
    row: {
      merge_field: 'summary', phrase, replacement,
      char_start: first, char_end: first + phrase.length,
      before_sha256: createHash('sha256').update(current).digest('hex'),
      applied_seq: seq, reason: 'you changed this yourself', source: 'owner_edit',
    },
  }
}

// =================================================================================================
line('=== A. THE ORDERING FACT BOTH OPTIONS DEPEND ON ===')
line('Does applied_seq define a total application order for a field across passes?')
line()
{
  // planCorrections restarts numbering at 1 for every field on every pass (correction.ts:80,
  // `applied_seq: rows.length + 1`). artifactOwnerEdit takes max(applied_seq)+1 over the whole
  // field (appCorrections.ts:345). So:
  const pass1 = planCorrections('summary', ORIGINAL, scanEcho(ORIGINAL, POSTING, PROFILE).echoes)
  const REBUILT = 'Directed $18M supplier negotiation for the region'
  const pass2 = planCorrections('summary', REBUILT, scanEcho(REBUILT, POSTING, PROFILE).echoes)
  line(`pass 1 seqs: ${J(pass1.map(r => r.applied_seq))}   phrases ${J(pass1.map(r => r.phrase))}`)
  line(`pass 2 seqs: ${J(pass2.map(r => r.applied_seq))}   phrases ${J(pass2.map(r => r.phrase))}`)
  line(`=> applied_seq RESTARTS AT 1 on every pass: ${pass1[0].applied_seq === pass2[0].applied_seq}`)
  line()
  line('And WITHIN one pass the application order is DESCENDING seq, not ascending:')
  line('  applyCorrections sorts by (b.char_start - a.char_start) = right-to-left = descending seq,')
  line('  while owner edits are applied in ASCENDING seq (each on top of the last).')
  line('  => the two writers apply in OPPOSITE directions. There is no single sequential order.')
}
line()

// =================================================================================================
line('=== B. OPTION (b) BUILT: revertOne unwinds each row in ITS OWN frame ===')
line('Most favourable honest implementation: unwind owner rows DESCENDING seq (each restores the')
line('state that existed before it), then pipeline rows ASCENDING seq (their original frame).')
line()

/** Option (b): frame-aware unwind. Returns the recovered original, or throws. */
function originalOfB(current, rows) {
  let out = String(current)
  const owner = rows.filter(r => r.source === 'owner_edit').sort((a, b) => b.applied_seq - a.applied_seq)
  const pipe = rows.filter(r => r.source !== 'owner_edit').sort((a, b) => a.applied_seq - b.applied_seq)
  const seen = []
  for (const c of owner) {
    const end = c.char_start + c.replacement.length
    if (out.slice(c.char_start, end) !== c.replacement) {
      throw new Error(`owner correction ${c.applied_seq} is not where the record says it is`)
    }
    // Per-row frame check: the state BEFORE this row must hash to its own before_sha256.
    const before = out.slice(0, c.char_start) + c.phrase + out.slice(end)
    seen.push({ seq: c.applied_seq, shaOk: sha256(before) === c.before_sha256 })
    out = before
  }
  for (const c of pipe) {
    const end = c.char_start + c.replacement.length
    if (out.slice(c.char_start, end) !== c.replacement) {
      throw new Error(`correction ${c.applied_seq} is not where the record says it is`)
    }
    out = out.slice(0, c.char_start) + c.phrase + out.slice(end)
  }
  return { original: out, ownerShaChecks: seen }
}

/** Option (b) revert: unwind, verify, then re-apply everything except the target. */
function revertOneB(current, rows, seq) {
  const target = rows.find(c => c.applied_seq === seq)
  if (!target) return { ok: false, reason: `no applied correction with seq ${seq}` }
  let rec
  try { rec = originalOfB(current, rows) } catch (e) { return { ok: false, reason: `this text no longer matches the change log (${e.message})` } }
  const pipe = rows.filter(r => r.source !== 'owner_edit')
  if (pipe.length && sha256(rec.original) !== pipe[0].before_sha256) {
    return { ok: false, reason: 'this field was edited after the correction was applied' }
  }
  for (const s of rec.ownerShaChecks) {
    if (!s.shaOk) return { ok: false, reason: `owner row ${s.seq} does not hash to the state it recorded` }
  }
  const keepPipe = pipe.filter(c => c.applied_seq !== seq || c.source === 'owner_edit')
  const keepOwner = rows.filter(r => r.source === 'owner_edit' && r.applied_seq !== seq)
    .sort((a, b) => a.applied_seq - b.applied_seq)
  let text
  try { text = applyCorrections(rec.original, keepPipe) } catch (e) { return { ok: false, reason: `rebuild failed: ${e.message}` } }
  // Owner rows can no longer use their offsets once a row before them was removed, so they must be
  // re-placed BY PHRASE — the rule reapplyOwnerEdits already owns.
  const re = reapplyOwnerEdits(text, keepOwner)
  if (re.lapsed.length) return { ok: false, reason: `undoing this would lose your edit: ${re.lapsed[0].reason}` }
  return { ok: true, text: re.text }
}

line('--- B1: CASE 2 (pipeline generalization + owner edit) under option (b) ---')
{
  const oe = ownerEditRow(afterPipeline, 'supplier negotiation', 'Vendor selection', 2)
  const rows = [...planned, oe.row]
  line(`current: ${J(oe.next)}`)
  for (const s of rows.map(r => r.applied_seq)) line(`  revertOneB(seq ${s}) -> ${J(revertOneB(oe.next, rows, s))}`)
}
line()
line('--- B2: CASE 5 (TWO owner edits, no pipeline row) under option (b) ---')
{
  const a = ownerEditRow(ORIGINAL, 'supplier negotiation', 'Vendor selection', 1)
  const b = ownerEditRow(a.next, 'across teams', 'company-wide', 2)
  const rows = [a.row, b.row]
  line(`current: ${J(b.next)}`)
  for (const s of [1, 2]) line(`  revertOneB(seq ${s}) -> ${J(revertOneB(b.next, rows, s))}`)
}
line()
line('--- B3: CASE 4 (owner edits the pipeline\'s OWN replacement) under option (b) ---')
{
  const oe = ownerEditRow(afterPipeline, '8-figure', 'large', 2)
  const rows = [...planned, oe.row]
  line(`current: ${J(oe.next)}`)
  for (const s of rows.map(r => r.applied_seq)) line(`  revertOneB(seq ${s}) -> ${J(revertOneB(oe.next, rows, s))}`)
  line('  (this is the case option (a) cannot express at all — see repro-offset-frames.mjs CASE 4)')
}
line()
line('--- B4: THE ATTACK — an owner edit made BEFORE a rebuild, pipeline row written AFTER it ---')
line('    Option (b) assumes application order = [all pipeline] then [all owner]. A rebuild breaks it.')
{
  const oe = ownerEditRow(ORIGINAL, 'supplier negotiation', 'Vendor selection', 1)   // owner edits first
  const REBUILT = oe.next                                                            // then a rebuild runs
  const pass2 = planCorrections('summary', REBUILT, scanEcho(REBUILT, POSTING, PROFILE).echoes)
  const after = applyCorrections(REBUILT, pass2)
  line(`  owner edited first  : ${J(oe.next)}   (owner row seq ${oe.row.applied_seq}, [${oe.row.char_start},${oe.row.char_end}))`)
  line(`  then the pipeline ran: ${J(after)}   (pipeline seqs ${J(pass2.map(r => r.applied_seq))})`)
  const rows = [...pass2, oe.row]
  line(`  seq collision? ${new Set(rows.map(r => r.applied_seq)).size !== rows.length}`)
  for (const s of [...new Set(rows.map(r => r.applied_seq))]) {
    line(`  revertOneB(seq ${s}) -> ${J(revertOneB(after, rows, s))}`)
    line(`  revertOne (seq ${s}) -> ${J(revertOne(after, rows, s))}   [today]`)
  }
}
line()

// =================================================================================================
line('=== C. OPTION (a) BUILT: artifactOwnerEdit writes ORIGINAL-frame offsets ===')
line('    (recover the original in memory, locate the phrase THERE, store sha256(original))')
line()

/** Option (a): what artifactOwnerEdit would compute instead. Returns the row, or a refusal. */
function ownerEditRowA(current, pipelineRows, phrase, replacement, seq) {
  let original
  try { original = originalOf(current, pipelineRows) }
  catch (e) { return { refused: `this field cannot be rewritten right now (${e.message})` } }
  const found = locateOwnerPhrase(original, phrase)
  if (found.at === null) return { refused: found.reason, refusedAgainst: 'ORIGINAL' }
  return {
    row: {
      merge_field: 'summary', phrase, replacement,
      char_start: found.at, char_end: found.at + phrase.length,
      before_sha256: sha256(original), applied_seq: seq,
      reason: 'you changed this yourself', source: 'owner_edit',
    },
    original,
  }
}

line('--- A1: CASE 2 under option (a) ---')
{
  const r = ownerEditRowA(afterPipeline, planned, 'supplier negotiation', 'Vendor selection', 2)
  const rows = [...planned, r.row]
  const text = applyCorrections(r.original, rows)
  line(`  document produced: ${J(text)}`)
  line(`  identical to today's write path? ${text === 'Led 8-figure Vendor selection across teams'}`)
  for (const s of rows.map(x => x.applied_seq)) line(`  revertOne(seq ${s}) -> ${J(revertOne(text, rows, s))}`)
}
line()
line('--- A2: CASE 5 (two owner edits) under option (a) ---')
{
  const r1 = ownerEditRowA(ORIGINAL, [], 'supplier negotiation', 'Vendor selection', 1)
  const t1 = applyCorrections(ORIGINAL, [r1.row])
  // the SECOND edit must recover the original past the FIRST OWNER ROW too, not just pipeline rows
  const r2 = ownerEditRowA(t1, [r1.row], 'across teams', 'company-wide', 2)
  const rows = [r1.row, r2.row]
  const t2 = applyCorrections(r2.original, rows)
  line(`  after both: ${J(t2)}`)
  line(`  edit1 sha == sha256(ORIGINAL)? ${r1.row.before_sha256 === sha256(ORIGINAL)}`)
  line(`  edit2 sha == sha256(ORIGINAL)? ${r2.row.before_sha256 === sha256(ORIGINAL)}`)
  for (const s of [1, 2]) line(`  revertOne(seq ${s}) -> ${J(revertOne(t2, rows, s))}`)
}
line()
line('--- A3: CASE 4 under option (a) — the phrase does not exist in the original ---')
{
  const r = ownerEditRowA(afterPipeline, planned, '8-figure', 'large', 2)
  line(`  ${J(r)}`)
  line('  => option (a) MUST REFUSE this edit. The owner sees "8-figure" on screen and is told the')
  line('     field no longer contains the words they changed. That copy would be a lie.')
}
line()
line('--- A4: does option (a) preserve the refusal that protects the document? ---')
{
  // Somebody rewrites the field by hand (an ai-edit) after the corrections were applied.
  const r = ownerEditRowA(afterPipeline, planned, 'supplier negotiation', 'Vendor selection', 2)
  const rows = [...planned, r.row]
  const text = applyCorrections(r.original, rows)
  const tampered = text.replace('across teams', 'across every team')
  line(`  tampered current: ${J(tampered)}`)
  for (const s of rows.map(x => x.applied_seq)) line(`  revertOne(seq ${s}) -> ${J(revertOne(tampered, rows, s))}`)
  const tampered2 = 'Xed 8-figure Vendor selection across teams'   // same LENGTH, disturbs no offset
  line(`  same-length tamper: ${J(tampered2)}`)
  for (const s of rows.map(x => x.applied_seq)) line(`  revertOne(seq ${s}) -> ${J(revertOne(tampered2, rows, s))}`)
}
line()

// =================================================================================================
line('=== D. ADJACENT: correctionAnomalies is computed across ALL fields, not per field ===')
{
  // assetGate.js:496 calls correctionAnomalies(rows) on the whole artifact's log; planCorrections
  // restarts applied_seq at 1 per FIELD, so two fields each with one correction share seq 1.
  const rows = [
    { seqKnown: true, seq: 1, merge_field: 'summary' },
    { seqKnown: true, seq: 1, merge_field: 'experience_1' },
  ]
  const seen = new Map()
  for (const r of rows) if (r.seqKnown) seen.set(r.seq, (seen.get(r.seq) || 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  line(`  two DIFFERENT fields, one correction each, both seq 1 -> anomaly reported? ${dupes.length > 0}`)
  line('  (transcribed from assetGate.js:597-608 — it never reads merge_field)')
}

line()
// =================================================================================================
line('=== E. THE DECIDER: what each option does to a field that ALREADY holds a legacy row ===')
line('    Production rows written before any fix carry the CORRECTED frame. Both options meet them.')
line()
{
  // A field with a pipeline row + a legacy (corrected-frame) owner row — i.e. CASE 2's data,
  // which is what is in production today.
  const legacy = ownerEditRow(afterPipeline, 'supplier negotiation', 'Vendor selection', 2)
  const current = legacy.next
  const rows = [...planned, legacy.row]

  line('--- E1: under option (a), can the owner make ANOTHER edit to that field? ---')
  const third = ownerEditRowA(current, rows, 'across teams', 'company-wide', 3)
  line(`  ownerEditRowA(...) -> ${J(third)}`)
  line(`  => the WRITE route now refuses too: ${!!third.refused}`)

  line()
  line('--- E2: under option (b), does the legacy row revert with NO migration? ---')
  for (const s of rows.map(r => r.applied_seq)) line(`  revertOneB(seq ${s}) -> ${J(revertOneB(current, rows, s))}`)

  line()
  line('--- E3: under option (a), can a legacy row be BACKFILLED into the original frame? ---')
  let rec
  try { rec = originalOf(current, planned.filter(r => r.source !== 'owner_edit')) }
  catch (e) { rec = { err: e.message } }
  line(`  originalOf(current, pipeline rows only) -> ${J(rec)}`)
  if (typeof rec === 'string') {
    line(`  ...but that recovers the text WITH the owner edit still in it: ${J(rec)}`)
    line(`  locate the owner phrase there -> ${J(locateOwnerPhrase(rec, legacy.row.phrase))}`)
    line('  The owner row\'s PHRASE was replaced by its REPLACEMENT, so the phrase is absent and the')
    line('  replacement is present. A backfill must undo the owner row FIRST (its own frame), which')
    line('  is option (b)\'s algorithm. => a correct (a)-backfill CONTAINS (b)\'s unwind.')
  }
}
line()
line('=== F. is `source` a sound proxy for the frame? ===')
{
  const fs = require('node:fs')
  const src = fs.readFileSync('api/src/functions/tests/correction.ts', 'utf8')
  const app = fs.readFileSync('api/src/functions/tests/appCorrections.ts', 'utf8')
  const emitted = [...src.matchAll(/source: '([a-z_]+)'/g)].map(m => m[1])
  const emittedApp = [...app.matchAll(/'(profile_figure|generalized|owner_edit)'/g)].map(m => m[1])
  line(`  source values EMITTED by correction.ts   : ${J([...new Set(emitted)])}`)
  line(`  source values NAMED in appCorrections.ts : ${J([...new Set(emittedApp)])}`)
  line(`  'profile_figure' is in the DOMAIN but produced by: ${emitted.includes('profile_figure') ? 'correction.ts' : 'NOTHING'}`)
}

line()
// =================================================================================================
line('=== G. SAFETY: does option (b) still REFUSE when the text genuinely moved? ===')
line('    A fix that makes a refusal less likely must be attacked, not assumed.')
line()
{
  const oe = ownerEditRow(afterPipeline, 'supplier negotiation', 'Vendor selection', 2)
  const rows = [...planned, oe.row]
  const clean = oe.next
  const attacks = [
    ['UNTAMPERED (control — must SUCCEED)', clean],
    ['length-changing tamper left of both rows', 'X' + clean],
    ['length-changing tamper right of both rows', clean.replace('across teams', 'across every team')],
    ['SAME-LENGTH tamper left of both rows (disturbs no offset)', 'Xed' + clean.slice(3)],
    ['SAME-LENGTH tamper right of both rows', clean.replace('across teams', 'across TEAMS')],
    ['SAME-LENGTH tamper INSIDE the owner replacement', clean.replace('Vendor selection', 'Vendor SELECTIO')+'n'],
    ['the whole field rewritten (an ai-edit)', 'Directed a large programme for the region'],
  ]
  for (const [what, text] of attacks) {
    const r1 = revertOneB(text, rows, 1)
    const r2 = revertOneB(text, rows, 2)
    line(`  ${what}`)
    line(`    revertOneB(seq 1 pipeline) -> ${r1.ok ? 'SPLICED: ' + J(r1.text) : 'refused'}`)
    line(`    revertOneB(seq 2 owner)    -> ${r2.ok ? 'SPLICED: ' + J(r2.text) : 'refused'}`)
  }
}
line()
line('=== H. does option (b) EVER splice into text today refuses AND that really moved? ===')
{
  // Brute force: mutate the clean text at every position, one character, and compare verdicts.
  const oe = ownerEditRow(afterPipeline, 'supplier negotiation', 'Vendor selection', 2)
  const rows = [...planned, oe.row]
  const clean = oe.next
  let bSpliced = 0, bRefused = 0, aSpliced = 0, wrongSplice = 0
  const examples = []
  for (let i = 0; i < clean.length; i++) {
    for (const ch of ['Z', 'zz', '']) {                      // substitute, lengthen, delete
      const t = clean.slice(0, i) + ch + clean.slice(i + 1)
      if (t === clean) continue
      const b1 = revertOneB(t, rows, 1), b2 = revertOneB(t, rows, 2)
      const a1 = revertOne(t, rows, 1), a2 = revertOne(t, rows, 2)
      for (const [b, a, seq] of [[b1, a1, 1], [b2, a2, 2]]) {
        if (b.ok) bSpliced++; else bRefused++
        if (a.ok) aSpliced++
        // A wrong splice = (b) writes text while the document was NOT the one the record describes.
        if (b.ok) { wrongSplice++; if (examples.length < 4) examples.push({ seq, tampered: t, wrote: b.text }) }
      }
    }
  }
  line(`  ${clean.length} positions x 3 mutations x 2 seqs`)
  line(`  option (b) spliced on a TAMPERED document : ${bSpliced}`)
  line(`  option (b) refused                        : ${bRefused}`)
  line(`  today's revertOne spliced                 : ${aSpliced}`)
  for (const e of examples) line(`    e.g. seq ${e.seq}: ${J(e.tampered)} -> ${J(e.wrote)}`)
}

// CLAIM 7, modelled on the REAL storage semantics rather than a hand-built fixture.
//
// The two writers number `applied_seq` differently and the unique index decides which rows survive:
//   planCorrections (correction.ts:136)  applied_seq = rows.length + 1   -> EVERY pass restarts at 1
//   artifactOwnerEdit (appCorrections.ts:355)  seq = max(applied_seq)+1  -> monotonic per field
//   unique index (appCorrections.ts:93) (artifact_id, merge_field, applied_seq,
//                                        coalesce(run_id,'000…0')) + `on conflict do nothing`
//   appPackets.ts:538 calls applyCorrectionPass WITHOUT runId  -> run_id is always NULL today,
//   so the coalesce collapses every build into the same key space.
import { createHash } from 'node:crypto'
import { planCorrections, applyCorrections, revertOne, locateOwnerPhrase, reapplyOwnerEdits }
  from '../../api/dist/functions/tests/correction.js'
import { scanEcho } from '../../api/dist/functions/tests/figureEcho.js'

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const FALSE_CLAIM = /(this field|it) was edited after the correction was applied/i
const POSTING = 'We need someone who has led $18M supplier negotiations and delivered 60+ launches.'
const PROFILE = 'Managed vendor programmes and shipped product for a decade.'

// A tiny model of the `correction` table for ONE artifact+field, with the real unique key.
class Ledger {
  constructor() { this.rows = [] }
  key(r) { return `${r.applied_seq}|${r.run_id ?? '00000000-0000-0000-0000-000000000000'}` }
  insertPass(rows, runId = null) {          // applyCorrectionPass: `on conflict do nothing`
    const dropped = []
    for (const r of rows) {
      const row = { ...r, run_id: runId, frame: 'original' }
      if (this.rows.some(x => this.key(x) === this.key(row))) { dropped.push(row); continue }
      this.rows.push(row)
    }
    return dropped
  }
  ownerEdit(current, phrase, replacement) { // artifactOwnerEdit: seq = max+1, frame 'applied'
    const at = locateOwnerPhrase(current, phrase)
    if (at.at === null) throw new Error(at.reason)
    const seq = Math.max(0, ...this.rows.map(r => r.applied_seq)) + 1
    const row = { merge_field: 'F', phrase, replacement, char_start: at.at,
      char_end: at.at + phrase.length, before_sha256: sha(current), applied_seq: seq,
      reason: 'you changed this yourself', source: 'owner_edit', frame: 'applied', run_id: null }
    this.rows.push(row)
    return { row, next: current.slice(0, at.at) + replacement + current.slice(at.at + phrase.length) }
  }
  // exactly what correctionRevert hands revertOne (appCorrections.ts:252-259) — note `frame` is
  // DROPPED by that projection; both variants are exercised below.
  siblings({ keepFrame }) {
    return this.rows.map(r => keepFrame ? { ...r } : (({ frame, ...rest }) => rest)(r))
      .sort((a, b) => a.applied_seq - b.applied_seq)
  }
}

let FAIL = 0
const check = (c, l) => { if (!c) { FAIL++; console.log(`  !! FAIL  ${l}`) } else console.log(`  ok       ${l}`) }

function run(label, V1, V2) {
  console.log(`\n────────── ${label} ──────────`)
  const L = new Ledger()
  console.log('  build-1 field   :', JSON.stringify(V1))
  const p1 = planCorrections('F', V1, scanEcho(V1, POSTING, PROFILE).echoes)
  L.insertPass(p1)
  let text = applyCorrections(V1, p1)
  console.log('  after build-1   :', JSON.stringify(text), `(${p1.length} pipeline rows, seq ${p1.map(r=>r.applied_seq)})`)

  const { next } = L.ownerEdit(text, 'supplier negotiation', 'Vendor selection')
  text = next
  console.log('  after owner edit:', JSON.stringify(text), `(owner seq ${L.rows.at(-1).applied_seq})`)

  // --- THE REBUILD. New prose, new plan, same null run_id. ---
  console.log('  build-2 field   :', JSON.stringify(V2))
  const p2 = planCorrections('F', V2, scanEcho(V2, POSTING, PROFILE).echoes)
  const dropped = L.insertPass(p2)
  console.log(`  build-2 planned ${p2.length} rows seq ${JSON.stringify(p2.map(r=>r.applied_seq))}; ` +
              `${dropped.length} DROPPED by \`on conflict do nothing\` (seq ${JSON.stringify(dropped.map(r=>r.applied_seq))})`)
  let rebuilt = applyCorrections(V2, p2)
  const reap = reapplyOwnerEdits(rebuilt, L.rows.filter(r => r.source === 'owner_edit'))
  rebuilt = reap.text
  console.log('  document now    :', JSON.stringify(rebuilt), `(owner lapsed: ${reap.lapsed.length})`)
  console.log('  ledger          :', JSON.stringify(L.rows.map(r => ({ seq: r.applied_seq, frame: r.frame, src: r.source }))))

  const applied = L.siblings({ keepFrame: false })   // exactly what the route passes today
  const withFrame = L.siblings({ keepFrame: true })  // what it would pass if the projection kept it
  for (const seq of [...new Set(applied.map(r => r.applied_seq))].sort()) {
    const r = revertOne(rebuilt, applied, seq)
    const rf = revertOne(rebuilt, withFrame, seq)
    console.log(`  revert seq${seq} ->`, JSON.stringify(r))
    if (JSON.stringify(r) !== JSON.stringify(rf)) console.log(`      (differs when \`frame\` is kept: ${JSON.stringify(rf)})`)
    if (!r.ok) check(!FALSE_CLAIM.test(r.reason || ''),
      `seq${seq}: refusal is TRUE (does not claim the owner edited the field)`)
  }
}

// A rebuild that finds the SAME number of figures — every new row collides and is dropped.
run('A. rebuild finds the same 2 figures (all new rows dropped on conflict)',
  'Led $18M supplier negotiation across 60+ teams',
  'Led $18M supplier negotiation across 60+ regional teams')

// A rebuild that finds FEWER figures.
run('B. rebuild finds fewer figures',
  'Led $18M supplier negotiation across 60+ teams',
  'Led $18M supplier negotiation across many teams')

// A rebuild that finds MORE figures — a row lands at a seq ABOVE the owner's, which is the only
// shape the implementer's rebuild guard can see.
run('C. rebuild finds MORE figures (one new row lands above the owner seq)',
  'Led $18M supplier negotiation across many teams',
  'Led $18M supplier negotiation across 60+ teams and 12 regions')

// The ONLY shape that can reach the implementer's rebuild guard: the rebuild must plan MORE rows
// than the owner's seq, so at least one lands at a seq the owner row does not already occupy.
run('D. rebuild plans MORE rows than the owner seq — the one shape the rebuild guard can see',
  'Led $18M supplier negotiation across many teams',
  'Led $18M supplier negotiation across 60+ teams over 12 months and 90% uptime')

// E. build-1 finds NO figures, so the owner takes seq 1; the rebuild's seq-2 row then lands ABOVE
// it and the rebuild guard finally fires. This is the shape the implementer's guard was written for.
run('E. owner at seq 1, rebuild lands a row at seq 2 — the rebuild guard should fire here',
  'Led supplier negotiation across many teams',
  'Led $18M supplier negotiation across 60+ teams')

console.log(`\n=== REBUILD MODEL RESULT: ${FAIL === 0 ? 'no false refusal reason observed' : FAIL + ' FALSE refusal reason(s)'} ===`)
process.exit(FAIL === 0 ? 0 : 1)

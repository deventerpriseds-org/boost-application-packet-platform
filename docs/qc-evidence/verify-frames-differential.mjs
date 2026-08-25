// CLAIM 8 — differential against the PRE-FIX build (a0c98a5^), which is compiled to /tmp/preapi.
// Two questions: (i) does the fix change the DOCUMENT any pipeline pass produces? (ii) did the
// pre-fix code really fail the reported defect (so claims 1-2 are not verifying a non-bug)?
import { createHash } from 'node:crypto'
import * as NEW from '../../api/dist/functions/tests/correction.js'
import * as OLD from '/tmp/preapi/api/dist/functions/tests/correction.js'
import { scanEcho } from '../../api/dist/functions/tests/figureEcho.js'
import { scanEcho as scanEchoOld } from '/tmp/preapi/api/dist/functions/tests/figureEcho.js'

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
let FAIL = 0
const check = (c, l) => { if (!c) { FAIL++; console.log(`  !! FAIL  ${l}`) } else console.log(`  ok       ${l}`) }

const POSTING = 'led $18M supplier negotiations, 60+ launches, 12 markets, 3x growth, 250 people, 40% margin'
const PROFILE = 'Managed vendor programmes and shipped product.'

// ---- (i) the document is byte-identical -------------------------------------------------------
console.log('=== CLAIM 8a — planCorrections + applyCorrections are byte-identical to pre-fix ===')
const WORDS = ['Led', 'a', '$18M', 'supplier', 'negotiation', 'across', '60+', 'teams', 'in', '12',
  'markets', 'delivering', '3x', 'growth', 'with', '250', 'people', 'at', '40%', 'margin', 'and',
  'reduced', 'cost', 'by', '$2.4M', 'over', '18', 'months', '.', 'the', 'programme']
let rng = 20260825
const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
let diffs = 0, rowDiffs = 0, n = 0
for (let i = 0; i < 4000; i++) {
  const len = 3 + Math.floor(rnd() * 14)
  const field = Array.from({ length: len }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ')
  const a = NEW.planCorrections('F', field, scanEcho(field, POSTING, PROFILE).echoes)
  const b = OLD.planCorrections('F', field, scanEchoOld(field, POSTING, PROFILE).echoes)
  if (JSON.stringify(a) !== JSON.stringify(b)) { rowDiffs++; if (rowDiffs < 3) console.log('  ROW DIFF', field, JSON.stringify(a), JSON.stringify(b)) }
  const ta = NEW.applyCorrections(field, a), tb = OLD.applyCorrections(field, b)
  n++
  if (ta !== tb) { diffs++; if (diffs < 3) console.log('  TEXT DIFF', JSON.stringify(field), JSON.stringify(ta), JSON.stringify(tb)) }
  // originalOf must also round-trip identically
  if (NEW.originalOf(ta, a) !== OLD.originalOf(tb, b)) { diffs++; console.log('  ORIGINALOF DIFF', field) }
}
console.log(`  ${n} random fields compared`)
check(rowDiffs === 0, `planCorrections emits byte-identical rows (${rowDiffs} differences)`)
check(diffs === 0, `applyCorrections / originalOf produce byte-identical text (${diffs} differences)`)

// ---- (ii) the pre-fix code really did fail --------------------------------------------------
console.log('\n=== CLAIM 8b — the pre-fix code REALLY failed the reported defect ===')
const FIELD = 'Led $18M supplier negotiation across 60+ teams'
const gen = { ...NEW.planCorrections('F', FIELD, scanEcho(FIELD, POSTING, PROFILE).echoes)[0], applied_seq: 1 }
const afterGen = NEW.applyCorrections(FIELD, [gen])
const at = afterGen.indexOf('supplier negotiation')
const owner = { merge_field: 'F', phrase: 'supplier negotiation', replacement: 'Vendor selection',
  char_start: at, char_end: at + 'supplier negotiation'.length, before_sha256: sha(afterGen),
  applied_seq: 2, reason: 'you changed this yourself', source: 'owner_edit' }
const both = afterGen.slice(0, at) + owner.replacement + afterGen.slice(owner.char_end)
for (const seq of [1, 2]) {
  let old; try { old = OLD.revertOne(both, [gen, owner], seq) } catch (e) { old = { threw: e.message } }
  const now = NEW.revertOne(both, [{ ...gen, frame: 'original' }, { ...owner, frame: 'applied' }], seq)
  console.log(`  seq${seq}  PRE-FIX ->`, JSON.stringify(old))
  console.log(`  seq${seq}  FIXED   ->`, JSON.stringify(now))
  check(old.ok !== true, `seq${seq}: the defect was real — pre-fix did NOT revert`)
  check(now.ok === true, `seq${seq}: the fix reverts it`)
}
// and the legacy shape (no frame at all), which is what production rows look like
for (const seq of [1, 2]) {
  const now = NEW.revertOne(both, [gen, owner], seq)
  check(now.ok === true, `seq${seq}: LEGACY (no frame declared) also reverts post-fix`)
}

console.log(`\n=== DIFFERENTIAL RESULT: ${FAIL === 0 ? 'ALL CHECKS PASSED' : FAIL + ' FAILED'} ===`)
process.exit(FAIL === 0 ? 0 : 1)

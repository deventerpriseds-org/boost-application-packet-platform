// CLAIM 4, broadened: randomised fuzz. Oracle = "if the document handed to revertOne is not
// byte-identical to the honest one the change log describes, revertOne must return no text."
import { createHash } from 'node:crypto'
import { planCorrections, applyCorrections, revertOne, locateOwnerPhrase }
  from '../../api/dist/functions/tests/correction.js'
import { scanEcho } from '../../api/dist/functions/tests/figureEcho.js'

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const POSTING = 'led $18M supplier negotiations, 60+ launches, 12 markets, 3x growth, 250 people, $2.4M saved'
const PROFILE = 'Managed vendor programmes and shipped product.'
const WORDS = ['Led', 'the', '$18M', 'supplier', 'negotiation', 'across', '60+', 'teams', '12',
  'markets', '3x', 'growth', '250', 'people', '$2.4M', 'cost', 'programme', 'and', 'a', 'team']
let rng = 7
const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (a) => a[Math.floor(rnd() * a.length)]

let cases = 0, tampers = 0, splices = 0, honestOk = 0, honestTried = 0
const bad = []

for (let it = 0; it < 3000; it++) {
  const field = Array.from({ length: 4 + Math.floor(rnd() * 12) }, () => pick(WORDS)).join(' ')
  const pipe = planCorrections('F', field, scanEcho(field, POSTING, PROFILE).echoes)
    .map(r => ({ ...r, frame: 'original' }))
  let text = applyCorrections(field, pipe)
  const rows = [...pipe]
  // 0-2 owner edits, each written exactly as artifactOwnerEdit writes one
  const nOwner = Math.floor(rnd() * 3)
  for (let k = 0; k < nOwner; k++) {
    const toks = text.split(' ').filter(Boolean)
    if (!toks.length) break
    const phrase = toks.slice(Math.floor(rnd() * toks.length)).slice(0, 1 + Math.floor(rnd() * 3)).join(' ')
    if (!phrase) break
    const at = locateOwnerPhrase(text, phrase)
    if (at.at === null) continue
    const replacement = rnd() < 0.15 ? '' : pick(['Vendor selection', 'Ran it', 'X', 'a much longer replacement phrase', 'q'])
    if (replacement === phrase) continue
    const seq = Math.max(0, ...rows.map(r => r.applied_seq)) + 1
    rows.push({ merge_field: 'F', phrase, replacement, char_start: at.at, char_end: at.at + phrase.length,
      before_sha256: sha(text), applied_seq: seq, reason: 'you changed this yourself',
      source: 'owner_edit', frame: 'applied' })
    text = text.slice(0, at.at) + replacement + text.slice(at.at + phrase.length)
  }
  if (!rows.length) continue
  cases++
  // legacy variant half the time (strip every declared frame — what production rows look like)
  const view = rnd() < 0.5 ? rows : rows.map(({ frame, ...r }) => r)
  const seqs = [...new Set(view.map(r => r.applied_seq))]

  for (const seq of seqs) { honestTried++; if (revertOne(text, view, seq).ok) honestOk++ }

  for (let t = 0; t < 12; t++) {
    const i = Math.floor(rnd() * Math.max(1, text.length))
    const kind = Math.floor(rnd() * 4)
    const ch = pick(['x', 'X', ' ', '0', 'é'])
    const tampered = kind === 0 ? text.slice(0, i) + ch + text.slice(i)
      : kind === 1 ? text.slice(0, i) + text.slice(i + 1)
      : kind === 2 ? text.slice(0, i) + ch + text.slice(i + 1)
      : text.slice(0, i) + text.slice(i).toUpperCase()
    if (tampered === text) continue
    for (const seq of seqs) {
      tampers++
      let r; try { r = revertOne(tampered, view, seq) } catch (e) { r = { ok: false } }
      if (r.ok === true || r.text !== undefined) {
        splices++
        if (bad.length < 5) bad.push({ field, text, tampered, seq, got: r.text, rows: view })
      }
    }
  }
}
console.log(`change logs generated : ${cases}`)
console.log(`honest reverts        : ${honestOk}/${honestTried} succeeded (non-vacuity)`)
console.log(`tampered documents    : ${tampers}`)
console.log(`SPLICED               : ${splices}`)
if (bad.length) console.log(JSON.stringify(bad, null, 1))
process.exit(splices === 0 ? 0 : 1)

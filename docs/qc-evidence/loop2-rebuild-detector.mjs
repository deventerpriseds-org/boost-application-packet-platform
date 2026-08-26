// LOOP-2 VERIFIER — is the rebuild DETECTOR branch of revertOne reachable with PRODUCTION-SHAPED
// data, and is the sentence it returns TRUE?
//
// The branch (correction.ts:352-361) returns:
//   "this field was rebuilt after you edited it, so the changes are recorded in an order this
//    version cannot safely unpick"
// which ASSERTS A CAUSE — a rebuild, and an owner edit before it. Claim 7 says revertOne no longer
// claims a cause it cannot determine, so this branch has to be examined on its own terms.
//
// Production shape, established by reading the ONE caller: appPackets.ts:538 passes NO runId, so
// `run_id` is always NULL and the unique index collapses every pass into one seq space.
import pg from '/home/user/boost-application-packet-platform/api/node_modules/pg/lib/index.js'
const A = '/home/user/boost-application-packet-platform/api/dist/functions/tests/'
const { applyCorrectionPass, artifactOwnerEdit, correctionRevert, ensureCorrectionTable } = await import(A + 'appCorrections.js')

const URL_ = process.env.DATABASE_URL
const raw = async (sql, params) => { const c = new pg.Client({ connectionString: URL_ }); await c.connect(); try { return await c.query(sql, params) } finally { await c.end() } }
const req = ({ params = {}, body = null } = {}) => ({ method: 'POST', params, headers: { get: () => '' }, query: { get: () => null }, json: async () => body })

// Wide posting so a regenerated field can echo several distinct figures at once.
const POSTING = 'We need someone who has led $18M supplier negotiations, closed $25M of renewals, delivered 60+ launches and run 12 teams.'
const PROFILE = 'Managed vendor programmes and shipped product for a decade.'

async function fresh(t) {
  const p = await raw(`insert into packet (pkg_json) values ($1) returning id`, [JSON.stringify({ F: t })])
  const a = await raw(`insert into artifact (packet_id) values ($1) returning id`, [p.rows[0].id])
  return { packetId: p.rows[0].id, artifactId: a.rows[0].id }
}
async function pass({ artifactId, packetId }) {
  const cur = (await raw(`select p.pkg_json from packet p join artifact a on a.packet_id=p.id where a.id=$1`, [artifactId])).rows[0].pkg_json
  const c = new pg.Client({ connectionString: URL_ }); await c.connect()
  let r; try { r = await applyCorrectionPass(c, { artifactId, pkg: cur, postingText: POSTING, profileText: PROFILE, loop: 0 }) } finally { await c.end() }
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify(cur), packetId])
  return r
}
const rowsOf = (id) => raw(`select id, applied_seq, source, frame, phrase, replacement from correction where artifact_id=$1 and reverted_at is null order by applied_seq`, [id]).then(r => r.rows)
const text = async (id) => (await raw(`select p.pkg_json->>'F' t from packet p join artifact a on a.packet_id=p.id where a.id=$1`, [id])).rows[0].t

{ const c = new pg.Client({ connectionString: URL_ }); await c.connect(); await ensureCorrectionTable(c); await c.end() }

// ── build 1: ONE correction, so the owner's edit lands at seq 2 ────────────────────────────────
const V1 = 'Led $18M supplier negotiation for the group'
const t = await fresh(V1)
const p1 = await pass(t)
console.log('build-1 planned :', p1.rows.map(r => `${r.phrase}->${r.replacement}@seq${r.applied_seq}`).join(', ') || '(none)')
console.log('build-1 text    :', JSON.stringify(await text(t.artifactId)))
const oe = await artifactOwnerEdit(req({ params: { artifactId: t.artifactId }, body: { merge_field: 'F', phrase: 'supplier negotiation', replacement: 'Vendor selection' } }), {})
console.log('owner edit      :', JSON.stringify(oe.jsonBody))

// ── the rebuild: the generator emits richer prose echoing THREE posting figures ────────────────
const V2 = 'Closed $25M of renewals, delivered 60+ launches and ran 12 teams'
await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: V2 }), t.packetId])
const p2 = await pass(t)
console.log('\nbuild-2 planned :', p2.rows.map(r => `${r.phrase}->${r.replacement}@seq${r.applied_seq}`).join(', ') || '(none)')
console.log('build-2 text    :', JSON.stringify(await text(t.artifactId)))
console.log('lapsed edits    :', JSON.stringify(p2.ownerLapsed?.map(l => l.reason) || []))

const rows = await rowsOf(t.artifactId)
console.log('\nSTORED LEDGER (what revertOne is handed):')
rows.forEach(r => console.log(`  seq${r.applied_seq}  ${r.source.padEnd(11)} frame=${r.frame}  ${JSON.stringify(r.phrase)} -> ${JSON.stringify(r.replacement)}`))
const orig = rows.filter(r => r.frame === 'original').map(r => r.applied_seq)
const app = rows.filter(r => r.frame === 'applied').map(r => r.applied_seq)
console.log(`  max(original seq)=${Math.max(...orig)}  min(applied seq)=${Math.min(...app)}  ` +
  `detector fires: ${Math.max(...orig) > Math.min(...app)}`)

console.log('\nREFUSALS FROM THE REAL ROUTE:')
for (const r of rows) {
  const snap = await text(t.artifactId)
  const res = await correctionRevert(req({ params: { correctionId: r.id } }), {})
  console.log(`  seq${r.applied_seq} (${r.source}): ok=${res.jsonBody.ok}  ${JSON.stringify(res.jsonBody.reason ?? res.jsonBody.text)}`)
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: snap }), t.packetId])
  await raw(`update correction set reverted_by=null, reverted_at=null where artifact_id=$1`, [t.artifactId])
}

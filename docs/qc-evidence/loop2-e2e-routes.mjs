// LOOP-2 VERIFIER — the production routes, driven end to end against a REAL PostgreSQL 16.
//
// Nothing here models the database. `ensureCorrectionTable`, the two writers and `correctionRevert`
// are imported from api/dist and run against a live server, so the SELECT projection that F-1 was
// about is the real one, the `frame` column is a real column, and every CHECK constraint is enforced.
//
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/ee node docs/qc-evidence/loop2-e2e-routes.mjs
import pg from '/home/user/boost-application-packet-platform/api/node_modules/pg/lib/index.js'

const A = '/home/user/boost-application-packet-platform/api/dist/functions/tests/'
const { applyCorrectionPass, artifactOwnerEdit, correctionRevert, ensureCorrectionTable, listCorrections } =
  await import(A + 'appCorrections.js')

const URL_ = process.env.DATABASE_URL
const raw = async (sql, params) => {
  const c = new pg.Client({ connectionString: URL_ }); await c.connect()
  try { return await c.query(sql, params) } finally { await c.end() }
}

// A minimal HttpRequest with exactly the surface the routes touch.
const req = ({ params = {}, body = null, query = {} } = {}) => ({
  method: 'POST', params,
  headers: { get: () => '' },
  query: { get: (k) => (k in query ? query[k] : null) },
  json: async () => body,
})

const POSTING = 'We need someone who has led $18M supplier negotiations and delivered 60+ launches.'
const PROFILE = 'Managed vendor programmes and shipped product for a decade.'

let FAIL = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ok      ${label}`)
  else { FAIL++; console.log(`  !! FAIL ${label}${extra ? '\n            ' + extra : ''}`) }
}

async function fresh(fieldText) {
  const p = await raw(`insert into packet (pkg_json) values ($1) returning id`,
    [JSON.stringify({ F: fieldText })])
  const a = await raw(`insert into artifact (packet_id) values ($1) returning id`, [p.rows[0].id])
  return { packetId: p.rows[0].id, artifactId: a.rows[0].id }
}

/** Run the REAL correction pass and persist exactly as buildTemplatedArtifact does. */
async function pipelinePass({ artifactId, packetId }, runId = null) {
  const cur = (await raw(`select p.pkg_json from packet p join artifact a on a.packet_id = p.id where a.id=$1`, [artifactId])).rows[0].pkg_json
  const c = new pg.Client({ connectionString: URL_ }); await c.connect()
  let res
  try { res = await applyCorrectionPass(c, { artifactId, pkg: cur, postingText: POSTING, profileText: PROFILE, runId }) }
  finally { await c.end() }
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify(cur), packetId])
  return res
}

const ownerEdit = (artifactId, phrase, replacement) =>
  artifactOwnerEdit(req({ params: { artifactId }, body: { merge_field: 'F', phrase, replacement } }), {})
const revert = (correctionId) => correctionRevert(req({ params: { correctionId } }), {})
const text = async (artifactId) =>
  (await raw(`select p.pkg_json->>'F' t from packet p join artifact a on a.packet_id=p.id where a.id=$1`, [artifactId])).rows[0].t
const rowsOf = (artifactId) =>
  raw(`select id, applied_seq, source, frame, phrase, replacement, char_start, reverted_at from correction where artifact_id=$1 order by applied_seq`, [artifactId]).then(r => r.rows)

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n══════ SETUP: ensure the real DDL applies ══════')
{
  const c = new pg.Client({ connectionString: URL_ }); await c.connect()
  await ensureCorrectionTable(c); await c.end()
  const cols = (await raw(`select column_name from information_schema.columns where table_name='correction' order by 1`)).rows.map(r => r.column_name)
  console.log('  correction columns:', cols.join(', '))
  ok(cols.includes('frame'), 'the real ensureCorrectionTable() DDL creates a `frame` column')
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n══════ E2E-1 — claim 1 through the REAL routes (pipeline row + owner edit) ══════')
const t1 = await fresh('Led $18M supplier negotiation across teams')
{
  const pass = await pipelinePass(t1)
  console.log('  pipeline rows planned:', pass.rows.length, JSON.stringify(pass.rows.map(r => [r.phrase, r.replacement])))
  console.log('  text after pass      :', JSON.stringify(await text(t1.artifactId)))
  const oe = await ownerEdit(t1.artifactId, 'supplier negotiation', 'Vendor selection')
  console.log('  owner edit           :', JSON.stringify(oe.jsonBody))
  const rows = await rowsOf(t1.artifactId)
  console.log('  stored rows          :', rows.map(r => `seq${r.applied_seq}/${r.source}/frame=${r.frame}`).join('  '))
  ok(rows.some(r => r.source === 'generalized' && r.frame === 'original'), 'pipeline row stored frame=original')
  ok(rows.some(r => r.source === 'owner_edit' && r.frame === 'applied'), 'owner row stored frame=applied')

  const before = await text(t1.artifactId)
  const owner = rows.find(r => r.source === 'owner_edit')
  const gen = rows.find(r => r.source === 'generalized')

  const r1 = await revert(owner.id)
  console.log('  revert OWNER row     :', JSON.stringify(r1.jsonBody))
  ok(r1.jsonBody.ok === true, 'claim 1a: the owner row reverts', r1.jsonBody.reason)

  // reset and try the pipeline row instead
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: before }), t1.packetId])
  await raw(`update correction set reverted_by=null, reverted_at=null where artifact_id=$1`, [t1.artifactId])
  const r2 = await revert(gen.id)
  console.log('  revert PIPELINE row  :', JSON.stringify(r2.jsonBody))
  ok(r2.jsonBody.ok === true, 'claim 1b: the pipeline row reverts', r2.jsonBody.reason)
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: before }), t1.packetId])
  await raw(`update correction set reverted_by=null, reverted_at=null where artifact_id=$1`, [t1.artifactId])
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n══════ F-1 — is the `frame` COLUMN actually read? (adversarial: column contradicts the map) ══════')
{
  const rows = await rowsOf(t1.artifactId)
  const owner = rows.find(r => r.source === 'owner_edit')
  const before = await text(t1.artifactId)

  // The owner row is source='owner_edit' → the MAP says 'applied'. Store 'original' instead.
  // If the column is read, revertOne now places this row in the ORIGINAL frame and the outcome must
  // CHANGE. If the outcome is identical to the map's, nothing read the column.
  await raw(`update correction set frame='original' where id=$1`, [owner.id])
  const rContra = await revert(owner.id)
  console.log('  frame column forced to ORIGINAL (map says applied)')
  console.log('  revert result        :', JSON.stringify(rContra.jsonBody))
  await raw(`update correction set frame='applied' where id=$1`, [owner.id])
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: before }), t1.packetId])
  await raw(`update correction set reverted_by=null, reverted_at=null where artifact_id=$1`, [t1.artifactId])
  const rTruth = await revert(owner.id)
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: before }), t1.packetId])
  await raw(`update correction set reverted_by=null, reverted_at=null where artifact_id=$1`, [t1.artifactId])
  console.log('  revert with truthful frame=applied:', JSON.stringify(rTruth.jsonBody))
  ok(JSON.stringify(rContra.jsonBody) !== JSON.stringify(rTruth.jsonBody),
    'F-1 FIXED: a stored frame that contradicts the source map CHANGES the outcome ⇒ the column is READ',
    `contradicted=${JSON.stringify(rContra.jsonBody)}`)

  // And a NULL frame must still resolve through the map (claim 3, no backfill).
  await raw(`update correction set frame=null where artifact_id=$1`, [t1.artifactId])
  const rLegacy = await revert(owner.id)
  console.log('  revert with frame=NULL on every row (legacy):', JSON.stringify(rLegacy.jsonBody))
  ok(rLegacy.jsonBody.ok === true, 'claim 3: legacy rows with frame NULL still revert through the map', rLegacy.jsonBody.reason)
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: before }), t1.packetId])
  await raw(`update correction set reverted_by=null, reverted_at=null, frame=case when source='owner_edit' then 'applied' else 'original' end where artifact_id=$1`, [t1.artifactId])
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n══════ E2E-3 — claim 7: REAL rebuilds. Every refusal the routes actually return ══════')
const ACCUSATIONS = []
async function rebuildShape(label, v1, v2, editPhrase, editRepl, runIds = [null, null]) {
  console.log(`\n  ── ${label}`)
  const t = await fresh(v1)
  await pipelinePass(t, runIds[0])
  console.log('    after build-1 :', JSON.stringify(await text(t.artifactId)))
  const oe = await ownerEdit(t.artifactId, editPhrase, editRepl)
  if (!oe.jsonBody.ok) { console.log('    owner edit refused:', oe.jsonBody.reason); return }
  console.log('    after edit    :', JSON.stringify(await text(t.artifactId)))
  // THE REBUILD: the generator regenerates the field. buildTemplatedArtifact writes fresh prose into
  // pkg_json, then applyCorrectionPass runs on it (and re-applies surviving owner edits by phrase).
  await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: v2 }), t.packetId])
  const pass2 = await pipelinePass(t, runIds[1])
  console.log('    after build-2 :', JSON.stringify(await text(t.artifactId)))
  console.log('    lapsed edits  :', JSON.stringify(pass2.ownerLapsed?.map(l => l.reason) || []))
  const rows = await rowsOf(t.artifactId)
  console.log('    rows          :', rows.map(r => `seq${r.applied_seq}/${r.source}/${r.frame}`).join('  '))
  for (const row of rows) {
    if (row.reverted_at) continue
    const snapshot = await text(t.artifactId)
    const res = await revert(row.id)
    const b = res.jsonBody
    console.log(`    revert seq${row.applied_seq} (${row.source}): ok=${b.ok} ${b.ok ? JSON.stringify(b.text) : JSON.stringify(b.reason)}`)
    if (b.ok === false && b.reason) ACCUSATIONS.push({ label, seq: row.applied_seq, source: row.source, reason: b.reason })
    // restore so each row is tested against the same state
    await raw(`update packet set pkg_json=$1 where id=$2`, [JSON.stringify({ F: snapshot }), t.packetId])
    await raw(`update correction set reverted_by=null, reverted_at=null where artifact_id=$1`, [t.artifactId])
  }
}

const V1 = 'Led $18M supplier negotiation across teams'
await rebuildShape('R1 rebuild rewords the prose, same figures',
  V1, 'Directed $18M supplier negotiation for 60+ teams', 'supplier negotiation', 'Vendor selection')
await rebuildShape('R2 rebuild adds MORE figures than build-1 (seq overtakes the owner row)',
  'Led $18M supplier negotiation across teams',
  'Led $18M supplier negotiation across 60+ teams and $25M of renewals', 'supplier negotiation', 'Vendor selection')
await rebuildShape('R3 rebuild keeps the field byte-identical',
  V1, V1, 'supplier negotiation', 'Vendor selection')
await rebuildShape('R4 rebuild with distinct run_ids (unique index does not collapse the passes)',
  V1, 'Led $18M supplier negotiation across 60+ teams and $25M of renewals', 'supplier negotiation', 'Vendor selection',
  ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'])

console.log('\n  ── every refusal the REAL routes returned across the rebuild shapes ──')
const uniq = [...new Set(ACCUSATIONS.map(a => a.reason))]
uniq.forEach((r, i) => console.log(`   ${i + 1}. ${JSON.stringify(r)}`))
const HUMAN_EDIT_CLAIM = /(was edited|you edited|you changed|edited after)/i
const bad = ACCUSATIONS.filter(a => HUMAN_EDIT_CLAIM.test(a.reason))
ok(bad.length === 0,
  'claim 7: no refusal from the real routes asserts a HUMAN edited the field',
  bad.map(b => `${b.label} seq${b.seq}: ${b.reason}`).join('\n            '))
const CAUSE_CLAIM = /(was rebuilt|was rewritten)/i
const causal = ACCUSATIONS.filter(a => CAUSE_CLAIM.test(a.reason))
if (causal.length) {
  console.log('\n  NOTE — refusals that assert a CAUSE (not merely "the text no longer matches"):')
  causal.forEach(c => console.log(`   ${c.label} seq${c.seq}/${c.source}: ${c.reason}`))
}

console.log(`\n══════ ${FAIL === 0 ? 'ALL CHECKS PASSED' : FAIL + ' CHECK(S) FAILED'} ══════`)
process.exit(FAIL ? 1 : 0)

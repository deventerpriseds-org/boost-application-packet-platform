// CAN A PACKET ACTUALLY SHIP? — the reachability guard, against a REAL PostgreSQL.
//
// WHY THIS FILE EXISTS, and it cost two days.
//
// The product was measured three separate times as `0 ready, 0 sent, 0 approved` over 39 packets
// and 1,937 opportunities, and every time that was read as "the owner has not used the review flow
// yet." It was not usage. `ready` was UNREACHABLE, twice over:
//
//   1. every packet carries a `video` artifact, the build loop SKIPS video (`if (!metaFor(a.type))
//      continue`), and `recomputePacket` required EVERY artifact approved — so `allApproved` could
//      never be true, and `Send packet →` renders only when ready;
//   2. approval calls `approvalBlock`, which refuses without an `artifact_gate` row, and NOTHING IN
//      THE BUILD PATH RAN CHECKS — `evaluateArtifact`'s only callers were a manual per-artifact
//      route and the remediation loop. Live: `cover` 0 check rows, `portfolio` 0, `compact_resume`
//      0, of 39 artifacts each.
//
// Both are invisible to every test that asserts a function's behaviour in isolation, because each
// piece was correct on its own. Only EXECUTING the whole transition catches them.
//
// THE RULE THIS ENCODES: a funnel stage that reads exactly zero across its entire history is a
// STRUCTURAL claim, not a usage signal. Prove the transition into it can happen. That proof is this
// file, and it is a real state machine run against a real database rather than an assertion about
// source text — because the first blocker was a `.every()` over the wrong list and the second was a
// missing function call, and no amount of reading either file revealed them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { recomputePacket } from '../dist/functions/tests/appPackets.js'
import { approvalBlock } from '../dist/functions/tests/appChecks.js'
import { SCHEMA_SQL } from '../dist/functions/tests/schema.js'

const { Client } = pg
const PGBIN = '/usr/lib/postgresql/16/bin'
const SOCK = '/var/tmp/p84pg'
const PGDATA = `${SOCK}/data`

// Shared with buildQueueDb.test.mjs / dimensionsDb.test.mjs, comment and all: the two ways this
// goes wrong are binaries present but nothing listening, and a stale socket outliving its postmaster.
function bootPg() {
  if (!existsSync(`${PGBIN}/initdb`)) return false
  try {
    if (existsSync(`${SOCK}/.s.PGSQL.55432`)) {
      try { execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} status"`, { stdio: 'ignore' }); return true } catch {}
    }
    execSync(`rm -rf ${SOCK} && mkdir -p ${PGDATA} && chown -R postgres ${SOCK}`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/initdb -D ${PGDATA} -U postgres -A trust"`, { stdio: 'ignore' })
    execSync(`su postgres -c "${PGBIN}/pg_ctl -D ${PGDATA} -o '-p 55432 -k ${SOCK} -c listen_addresses=' -l ${SOCK}/pg.log -w start"`, { stdio: 'ignore' })
    return existsSync(`${SOCK}/.s.PGSQL.55432`)
  } catch { return false }
}
const HAVE_PG = bootPg()
const CONN = { host: SOCK, port: 55432, user: 'postgres', database: 'postgres' }

// pgvector is not installed in this container; stub it exactly as CLAUDE.md documents, so the rest
// of the schema still executes for real.
function schemaSql() {
  return SCHEMA_SQL
    .replace(/^create extension if not exists vector;/m, '-- stubbed')
    .replace(/vector\(1536\)/g, 'text')
    .split('\n').filter(l => !/using hnsw \(embedding vector_cosine_ops\)/.test(l)).join('\n')
}

// The five artifact types the product actually creates for every packet. `video` is the one the
// build loop skips, and it is deliberately present here — a fixture that omitted it would be a
// fixture that could not reproduce the bug.
const TYPES = ['resume', 'compact_resume', 'cover', 'portfolio', 'video']
// What the builder produces, and therefore what readiness may require. Mirrors `metaFor`.
const BUILDABLE = ['resume', 'compact_resume', 'cover', 'portfolio']

async function seed(c) {
  await c.query(`delete from opportunity where owner_email = 'shippath@test.local'`)
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage) values ('shippath@test.local','Acme','VP Eng','enriched') returning id`)).rows[0].id
  const pkt = (await c.query(`insert into packet (opp_id) values ($1) returning id`, [opp])).rows[0].id
  const arts = {}
  for (const t of TYPES) {
    arts[t] = (await c.query(`insert into artifact (packet_id, type) values ($1,$2) returning id`, [pkt, t])).rows[0].id
  }
  return { opp, pkt, arts }
}

test('H:ship-path-is-reachable: a packet CAN reach `ready` with the artifacts a build produces', { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { pkt, arts } = await seed(c)

    // Nothing approved yet: not ready. (Guards against a vacuous pass where everything reads ready.)
    assert.notEqual(await recomputePacket(c, pkt), 'ready', 'a packet with nothing approved must not be ready')

    // Approve exactly what a build produces. `video` stays `todo`, because the build never touches
    // it — this is the real end state of a completed, fully-reviewed packet.
    for (const t of BUILDABLE) {
      await c.query(`update artifact set status='approved' where id=$1`, [arts[t]])
    }

    const status = await recomputePacket(c, pkt)
    assert.equal(status, 'ready',
      'A fully reviewed packet cannot reach `ready`, so `Send packet →` never renders and NOTHING ' +
      'CAN EVER SHIP. This is the defect that produced 0 ready / 0 sent across 39 packets: an ' +
      'artifact the builder never builds (video) was holding the packet back forever.')
  } finally { await c.end() }
})

test('H:every-required-artifact-can-be-approved: approval is not deadlocked for any required type', { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { arts } = await seed(c)

    // Ground state: with no gate row, approval is blocked. That is CORRECT and deliberate — absent
    // evidence is never a pass. It is only a deadlock if nothing ever writes the row.
    for (const t of BUILDABLE) {
      const b = await approvalBlock(c, arts[t])
      assert.equal(b.blocked, true, `${t}: expected approval blocked before any checks have run`)
    }

    // Once the gate row exists and passes, approval must be possible for EVERY required type. If a
    // type can never get a gate row, `allApproved` can never be true and `ready` is unreachable —
    // which is exactly what was live: cover/portfolio/compact_resume each had 0 check rows over 39
    // artifacts, and approving the cover returned HTTP 409 `no checks have been run`.
    for (const t of BUILDABLE) {
      await c.query(
        `insert into artifact_gate (artifact_id, run_id, gate, attention_count)
         values ($1, gen_random_uuid(), 'pass', 0)
         on conflict (artifact_id) do update set gate='pass', attention_count=0`, [arts[t]])
      const b = await approvalBlock(c, arts[t])
      assert.equal(b.blocked, false,
        `${t}: approval is still blocked with a passing gate — this type can never be approved, so ` +
        'the packet can never be ready and nothing can ship')
    }
  } finally { await c.end() }
})

// ---------------------------------------------------------------------------------------------
// CAN THE EVIDENCE SPINE SURVIVE ITS OWN BUILD? — the same shape of defect as the two above, found
// the same way: a funnel stage reading exactly zero across its whole history.
//
// MEASURED 2026-08-23 on production. `requirement_evidence` held **1 row across 613 opportunities
// that have requirements**, and `must_have_coverage` read `0/12` on all four artifacts of a packet
// built from a real 9,749-char posting (opportunity 2cb56fb3). Before/after on that opportunity,
// minutes apart, same profile:
//     after POST /evidence  -> 8 rows, all method='proposed'
//     after POST /build-all -> 0 rows
//
// `runPacketBuild` resolves evidence WITH an escalation transport, then calls `evaluateArtifact`
// once per artifact; that path calls `writeEvidence` with FOUR arguments — no transport — because
// four concurrent artifacts must not each start their own model run. `writeEvidence` opened by
// DELETING every evidence row for the opportunity, and only the escalation pass can create a
// `proposed` row. So each build paid for 12 model calls and then deleted the result.
//
// THE INVARIANT, stated so it outlives this incident: a pass may only delete the rows it is
// STRUCTURALLY ABLE TO REBUILD. Asserted by executing the write, because the bug was the scope of a
// SQL `delete` and no assertion about source text would have caught it.
import { writeEvidence } from '../dist/functions/tests/appRequirements.js'

const REC = {
  key: 'work:acme', kind: 'work_history', label: 'Acme',
  text: 'Directed platform engineering and SRE transformation across twelve teams.',
}
// A model proposal for seq 1, exactly as the escalation pass stores one: real offsets into the
// record it names, and ratio NULL because no rule scored it.
// DERIVED, never hand-counted. The first version of this line hardcoded 32/50 and was off by two;
// the fixture's own assertion below caught it, which is the reason that assertion exists.
const PQUOTE = 'SRE transformation'
const PROPOSAL = {
  quote: PQUOTE,
  start: REC.text.indexOf(PQUOTE),
  end: REC.text.indexOf(PQUOTE) + PQUOTE.length,
}

async function seedEvidenceFixture(c) {
  await c.query(`delete from opportunity where owner_email = 'evsurvive@test.local'`)
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage)
     values ('evsurvive@test.local','Acme','VP Eng','enriched') returning id`)).rows[0].id
  const ids = {}
  for (const seq of [1, 2]) {
    ids[seq] = (await c.query(
      `insert into requirement
         (opp_id, seq, kind, item_text, match_method, kind_source, weight, jd_text_sha256, extractor_version)
       values ($1,$2,'must_have',$3,'unlocatable','category_default',2,'sha',1) returning id`,
      [opp, seq, `requirement number ${seq}`])).rows[0].id
  }
  assert.equal(REC.text.slice(PROPOSAL.start, PROPOSAL.end), PROPOSAL.quote,
    'fixture offsets must really index the record, or the row would not be a legal proposal')
  await c.query(
    `insert into requirement_evidence
       (requirement_id, quote, source_kind, source_label, source_key, char_start, char_end,
        extra, ratio, method, record_sha256, resolver_version, proposal_version)
     values ($1,$2,'work_history','Acme','work:acme',$3,$4,null,null,'proposed','sha',1,1)`,
    [ids[1], PROPOSAL.quote, PROPOSAL.start, PROPOSAL.end])
  return { opp, ids }
}

const countByMethod = async (c, opp) => Object.fromEntries((await c.query(
  `select e.method, count(*)::int as n from requirement_evidence e
     join requirement r on r.id = e.requirement_id where r.opp_id = $1 group by e.method`,
  [opp])).rows.map(r => [r.method, r.n]))

test('H:evidence-survives-the-build: a transport-less pass must not delete model proposals it cannot rebuild',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { opp } = await seedEvidenceFixture(c)
    assert.deepEqual(await countByMethod(c, opp), { proposed: 1 }, 'fixture must start with the proposal')

    // EXACTLY what `evaluateArtifact` does: four arguments, so no transport and no escalation. The
    // resolver finds nothing, which is the real production case (deterministic evidence was 0/35).
    const out = await writeEvidence(c, opp, [REC], {}, (rows) => rows.map(r => ({
      seq: r.seq, requirement_text: r.item_text, evidence: null,
    })))

    assert.deepEqual(await countByMethod(c, opp), { proposed: 1 },
      'THE BUILD DELETED ITS OWN ESCALATION OUTPUT. A pass with no transport cannot create a ' +
      '`proposed` row, so it must not delete one: this is what emptied the evidence spine in ' +
      'production (1 row across 613 opportunities) and made `must_have_coverage` read 0/12.')
    assert.equal(out.proposed, 0, 'a transport-less pass reports no proposals of its own')
  } finally { await c.end() }
})

test('H:rule-evidence-evicts-a-stale-proposal: deterministic evidence must win the requirement, not be swallowed',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const { opp } = await seedEvidenceFixture(c)

    // The resolver now settles seq 1 deterministically ON THE SAME SPAN the proposal occupies. That
    // collision is legal — a proposal is verified byte-exact against the record it names, so it can
    // hold the very span a rule later resolves — and the insert is `on conflict (requirement_id,
    // source_key, char_start, char_end) do nothing`, keyed on the SPAN and not the method. Without
    // the eviction the deterministic insert is silently dropped, the row stays `proposed`, and
    // `ruleEvidenceOf` excludes it — so a requirement the profile genuinely evidences reads as
    // uncovered and the gate accuses the owner of a gap that is not there.
    await writeEvidence(c, opp, [REC], {}, (rows) => rows.map(r => ({
      seq: r.seq, requirement_text: r.item_text,
      evidence: r.seq !== 1 ? null : {
        quote: PROPOSAL.quote, source_kind: 'work_history', source_label: 'Acme',
        source_key: 'work:acme', char_start: PROPOSAL.start, char_end: PROPOSAL.end,
        extra: null, ratio: 0.9, method: 'exact', record_sha256: 'sha', resolver_version: 1,
      },
    })))

    const by = await countByMethod(c, opp)
    assert.equal(by.proposed, undefined,
      'the stale proposal outlived the rule evidence that replaced it')
    assert.equal(by.exact, 1,
      'THE RULE EVIDENCE WAS SWALLOWED by `on conflict do nothing` against the surviving proposal, ' +
      'so a requirement the profile really evidences would still not count toward the gate.')
  } finally { await c.end() }
})

// ---------------------------------------------------------------------------------------------
// ADVISORY GATE MODE — the owner may accept blocking findings ON THE RECORD, or not at all.
//
// Added 2026-08-23 at the owner's explicit instruction ("continue to ship tonight"). The
// deterministic evidence resolver returns 0 of 35 requirements, so `must_have_coverage` is pinned
// at 0/12 on every packet and a `fail` gate is absolutely non-overridable — meaning NO packet can
// reach `ready` and nothing can ship at all. He shipped fine before this gate existed.
//
// THE INVARIANT, and the reason there are three tests rather than one: advisory mode changes the
// CONSEQUENCE of a fail, never the FINDING. Off, it must be byte-identical to the old behaviour.
// On, a fail becomes overridable on exactly a warn's terms — verified session, written reason,
// recorded — and is still blocking until that override exists. A silent pass would be the whole
// safety property thrown away for convenience.

async function gateFixture(c, gate, attention) {
  await c.query(`delete from opportunity where owner_email = 'advisory@test.local'`)
  const opp = (await c.query(
    `insert into opportunity (owner_email, company, role, stage)
     values ('advisory@test.local','Acme','VP Eng','enriched') returning id`)).rows[0].id
  const pkt = (await c.query(`insert into packet (opp_id) values ($1) returning id`, [opp])).rows[0].id
  const art = (await c.query(`insert into artifact (packet_id, type) values ($1,'resume') returning id`, [pkt])).rows[0].id
  await c.query(
    `insert into artifact_gate (artifact_id, run_id, gate, attention_count)
     values ($1, gen_random_uuid(), $2, $3)`, [art, gate, attention])
  return art
}

test('H:advisory-off-still-blocks-a-fail: the default must be byte-identical to the old behaviour',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const art = await gateFixture(c, 'fail', 4)

    // Called exactly as every un-updated caller calls it: no third argument.
    const dflt = await approvalBlock(c, art)
    assert.equal(dflt.blocked, true, 'THE DEFAULT LEAKED. A fail must block when nobody enabled advisory mode.')
    assert.match(dflt.reason, /cannot be overridden/,
      'the refusal must still be the absolute one, not the advisory wording')

    // And explicitly false, which is what `loadThresholds` returns for an owner who never set it.
    const off = await approvalBlock(c, art, false)
    assert.deepEqual(off, dflt, 'advisory:false must be indistinguishable from the argument being absent')
  } finally { await c.end() }
})

test('H:advisory-fail-still-needs-a-recorded-override: advisory is not a silent pass',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const art = await gateFixture(c, 'fail', 4)

    const noOverride = await approvalBlock(c, art, true)
    assert.equal(noOverride.blocked, true,
      'ADVISORY MODE BECAME A BYPASS. A fail with no recorded override must still block — the ' +
      'owner accepts findings explicitly, with a reason, or not at all.')
    assert.equal(noOverride.gate, 'fail', 'the gate VALUE must not be softened to warn')

    // Now the override exists, exactly as `artifactGateOverride` records it.
    await c.query(
      `update artifact_gate set override_by='von.ellis@enterpriseds.io', override_at=now(),
              override_reason='accepted: coverage is pinned at 0 by a known resolver defect'
        where artifact_id=$1`, [art])
    const after = await approvalBlock(c, art, true)
    assert.equal(after.blocked, false, 'a recorded override must unblock approval in advisory mode')
    assert.equal(after.gate, 'fail',
      'the gate must STILL read fail — advisory changes the consequence, never the finding, so the ' +
      'score history and the audit row stay comparable across the change')
  } finally { await c.end() }
})

test('H:advisory-never-touches-a-warn-or-a-pass: the other two gates are unchanged',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    // A warn still needs its override, advisory or not.
    const warn = await gateFixture(c, 'warn', 2)
    assert.equal((await approvalBlock(c, warn, false)).blocked, true)
    assert.equal((await approvalBlock(c, warn, true)).blocked, true,
      'advisory mode must not waive a warn -- it only makes a FAIL behave like one')
    // A pass is clear either way.
    const pass = await gateFixture(c, 'pass', 0)
    assert.equal((await approvalBlock(c, pass, false)).blocked, false)
    assert.equal((await approvalBlock(c, pass, true)).blocked, false)
  } finally { await c.end() }
})

// THE SITE THAT DECIDES WHETHER ANYTHING SHIPS, and the one an obvious implementation misses.
//
// `recomputePacket` counts artifacts sitting at gate='fail' and requires that count to be zero for
// `ready`. Advisory mode deliberately does NOT rewrite the gate value, so updating only
// `approvalBlock` and `artifactGateOverride` leaves this count non-zero forever: every artifact goes
// `approved`, every API call returns 200, and the packet still computes `review` -- `Send packet`
// never renders and nothing ships. Found by the acceptance-criteria pass BEFORE it shipped. It is
// the identical shape to H:ship-path-is-reachable above: each piece correct alone, transition
// impossible. That is why this asserts the TRANSITION rather than the function.
test('H:ready-counts-an-overridden-fail-only-in-advisory-mode: the packet must actually reach ready',
  { skip: !HAVE_PG && 'no local postgres' }, async () => {
  const c = new Client(CONN); await c.connect()
  try {
    await c.query(schemaSql())
    const owner = 'advisory-ready@test.local'
    await c.query(`delete from opportunity where owner_email=$1`, [owner])
    const opp = (await c.query(
      `insert into opportunity (owner_email, company, role, stage)
       values ($1,'Acme','VP Eng','enriched') returning id`, [owner])).rows[0].id
    const pkt = (await c.query(`insert into packet (opp_id) values ($1) returning id`, [opp])).rows[0].id
    const arts = {}
    for (const t of TYPES) {
      arts[t] = (await c.query(`insert into artifact (packet_id, type) values ($1,$2) returning id`, [pkt, t])).rows[0].id
    }
    // Every buildable artifact approved, and each carries a FAILING gate with a recorded override —
    // the real end state of a packet the owner consciously accepted under advisory mode.
    for (const t of BUILDABLE) {
      await c.query(`update artifact set status='approved' where id=$1`, [arts[t]])
      await c.query(
        `insert into artifact_gate (artifact_id, run_id, gate, attention_count, override_by, override_at, override_reason)
         values ($1, gen_random_uuid(), 'fail', 3, $2, now(), 'accepted: coverage pinned at 0 by a known resolver defect')`,
        [arts[t], owner])
    }

    // ADVISORY OFF (the default): an overridden fail must STILL hold the packet back.
    await c.query(`insert into owner_search_prefs (owner_email) values ($1)
                   on conflict (owner_email) do nothing`, [owner])
    await c.query(`update owner_search_prefs set chk_gate_advisory=false where owner_email=$1`, [owner])
    assert.notEqual(await recomputePacket(c, pkt), 'ready',
      'with advisory OFF a fail must keep the packet out of ready, override or not')

    // ADVISORY ON: the same rows now reach ready.
    await c.query(`update owner_search_prefs set chk_gate_advisory=true where owner_email=$1`, [owner])
    assert.equal(await recomputePacket(c, pkt), 'ready',
      'NOTHING SHIPS. Every artifact is approved and every blocking finding was explicitly accepted ' +
      'with a recorded reason, yet the packet cannot reach `ready` -- so `Send packet` never renders. ' +
      'recomputePacket counts gate=fail and advisory deliberately does not rewrite the gate value.')

    // And an un-overridden fail still blocks even with advisory on — advisory is not a bypass.
    await c.query(`update artifact_gate set override_by=null, override_at=null, override_reason=null
                    where artifact_id=$1`, [arts.resume])
    assert.notEqual(await recomputePacket(c, pkt), 'ready',
      'an un-overridden fail must block ready even in advisory mode')
  } finally { await c.end() }
})

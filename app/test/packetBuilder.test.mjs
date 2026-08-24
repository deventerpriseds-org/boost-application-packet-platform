import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The load-bearing half of the regen fix, and it had no test at all.
//
// `api.js` forwarding `regen` is provable and was proven. But the branch's own reasoning is that
// fixing api.js alone "would have changed nothing a user can reach", because both screens replaced
// the create button with a link once `docUrl` was set — so on exactly the artifacts where a cache
// bypass matters there was no control to press. A verifier deleted the entire Rebuild block from
// PacketBuilder and the suite stayed green at 147/147. The half that makes the fix reachable was
// unguarded while the half that is merely plumbing was revert-proof.
test('both screens expose a Rebuild control in the branch where a doc already exists', () => {
  const read = (f) => readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
  for (const file of ['PacketBuilder.jsx', 'OppDetail.jsx']) {
    const src = read(file)
    // The control exists...
    assert.match(src, /Rebuild from current draft/, `${file} has no Rebuild control`)
    assert.match(src, /data-qc="asset-rebuild"|PACKET_HOOKS\.assetRebuild/, `${file}'s Rebuild control has no selector to verify against`)
    // ...it asks for a regen...
    assert.match(src, /\{\s*regen:\s*true\s*\}/, `${file}'s Rebuild does not request a regen`)
    // ...and it lives in the docUrl-present branch, which is the whole point. Anchor on the region
    // between `a.docUrl ?` and its `) :` so a Rebuild control added somewhere else does not pass.
    const i = src.indexOf('a.docUrl ? (')
    assert.ok(i > 0, `${file} no longer branches on a.docUrl`)
    const region = src.slice(i, src.indexOf(') : ', i))
    assert.match(region, /Rebuild from current draft/,
      `${file}: the Rebuild control is not in the branch where the doc already exists — which is the only state it matters in`)
  }
})

// ── Regenerate absorbs the note; `Request changes` is gone ───────────────────────────────────────
//
// `Request changes` was never a sibling of Regenerate — it was a PARAMETER of it. It wrote a note
// and returned; the draft only moved when Regenerate was pressed afterwards. And the `changes`
// status it set carries no meaning: `recomputePacket` tests only `=== 'approved'` and `!== 'todo'`,
// so `changes` and `review` produce an identical packet status, and the single behavioural use of
// the value in the whole API is `appPackets.ts:341`, deciding whether to store the note.
//
// Worse, OppDetail's copy called `setStatus(a, 'changes')` with NO note argument. The server stores
// a note only under `if (status === 'changes' && note)`, so nothing was written, the next
// Regenerate read zero unresolved notes, and it re-rolled with byte-identical inputs. A control
// that did nothing at all.
import { regenerateWithNote } from '../src/packetBuilder.js'
import { originalState } from '../src/assetBlocks.js'

const calls = () => {
  const seen = []
  return {
    seen,
    saveNote: async (t) => { seen.push(`save:${t}`); return { ok: true, feedbackAdded: true } },
    generate: async () => { seen.push('generate') },
  }
}

test('H:regen-note-lands-before-the-rebuild: the note is durable before generate reads it', async () => {
  // THE ORDER IS THE INVARIANT. The generate path reads unresolved notes at its START
  // (appPackets.ts:503) and marks them resolved at its END (:575). Generate first — or fire both
  // together — and the rebuild ignores the note and then resolves it: consumed, having steered
  // nothing, and gone, because `resolved` is what stops a note replaying.
  const c = calls()
  const r = await regenerateWithNote({ note: 'lead with platform work', saveNote: c.saveNote, generate: c.generate })
  assert.deepEqual(c.seen, ['save:lead with platform work', 'generate'], 'the note must be saved BEFORE generate')
  assert.deepEqual(r, { ran: true, steered: true, reason: 'steered' })
})

test('H:regen-note-failure-aborts: an unsteered rebuild is never silently substituted', async () => {
  // Three model passes the owner believes were steered and were not is the worse outcome, and it
  // reads as the model ignoring the note rather than as a save that failed.
  const thrown = { seen: [], saveNote: async () => { throw new Error('offline') }, generate: async () => { thrown.seen.push('generate') } }
  const a = await regenerateWithNote({ note: 'x', saveNote: thrown.saveNote, generate: thrown.generate })
  assert.equal(a.ran, false); assert.equal(a.reason, 'note-failed')
  assert.deepEqual(thrown.seen, [], 'generate ran despite the note never being saved')

  // The server reports a failed jsonb append as `feedbackAdded: false` with a 200 — non-fatal
  // THERE by design, fatal HERE, because the note is the only thing that makes this rebuild differ
  // from a blank one. A 200 with the work not done is not a pass.
  const seen2 = []
  const b = await regenerateWithNote({
    note: 'x',
    saveNote: async () => ({ ok: true, feedbackAdded: false }),
    generate: async () => { seen2.push('generate') },
  })
  assert.equal(b.ran, false); assert.equal(b.reason, 'note-failed')
  assert.deepEqual(seen2, [], 'a 200 with feedbackAdded:false must not regenerate')

  // An explicit error field, same treatment.
  const seen3 = []
  const c3 = await regenerateWithNote({
    note: 'x', saveNote: async () => ({ error: 'nope' }), generate: async () => { seen3.push('generate') },
  })
  assert.equal(c3.ran, false)
  assert.deepEqual(seen3, [])
})

test('H:regen-blank-is-a-plain-reroll-and-cancel-does-nothing', async () => {
  // Blank is a DELIBERATE re-roll and must not write a `changes` status — the server would ignore
  // an empty note anyway, and writing the status would set a value that gates nothing.
  const c = calls()
  const blank = await regenerateWithNote({ note: '', saveNote: c.saveNote, generate: c.generate })
  assert.deepEqual(c.seen, ['generate'], 'a blank note must not write a status')
  assert.deepEqual(blank, { ran: true, steered: false, reason: 'plain' })

  // Whitespace is blank. Otherwise a stray space buys a `changes` write the server discards.
  const c2 = calls()
  await regenerateWithNote({ note: '   ', saveNote: c2.saveNote, generate: c2.generate })
  assert.deepEqual(c2.seen, ['generate'])

  // Cancel does NOTHING — the outcome a separate button could not express.
  const c3 = calls()
  const cancelled = await regenerateWithNote({ note: null, saveNote: c3.saveNote, generate: c3.generate })
  assert.deepEqual(c3.seen, [])
  assert.equal(cancelled.ran, false)
  assert.equal(cancelled.reason, 'cancelled')
})

test('H:no-request-changes-control: both screens regenerate through the shared sequencer', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const file of ['PacketBuilder.jsx', 'OppDetail.jsx']) {
    const src = strip(readFileSync(new URL(`../src/screens/${file}`, import.meta.url), 'utf8'))
    assert.ok(!/Request changes/.test(src), `${file} still renders a Request changes control`)
    // The dead form specifically: a 'changes' write with no note reaches the server as a status
    // that stores nothing and steers nothing.
    assert.ok(!/setStatus\(\s*a\s*,\s*'changes'\s*\)/.test(src),
      `${file} writes the 'changes' status with no note - the server discards it`)
    assert.match(src, /regenerateWithNote\(/, `${file} does not use the shared regenerate sequencer`)
    // Copied inline instead of shared is how a rule about ORDERING drifts between two screens.
    assert.ok(!/feedbackAdded/.test(src), `${file} re-implements the note sequencing inline`)
  }
})

// ── the resume step's last four prototype rows ───────────────────────────────────────────────────

const BLOCKS = () => stripC(readFileSync(new URL('../src/screens/AssetBlocks.jsx', import.meta.url), 'utf8'))
const PACKET = () => stripC(readFileSync(new URL('../src/screens/PacketBuilder.jsx', import.meta.url), 'utf8'))
const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('H:clear-state-needs-a-loaded-result: "nothing to review" is never the UNCHECKED state', () => {
  // Without the `checked` guard, an asset whose checks never ran renders the same green sentence as
  // one that ran clean - the absence of a verdict laundered into a pass, which is the single failure
  // this whole rail exists to prevent.
  const src = BLOCKS()
  assert.match(src, /\{checked && severity && severity\.fix === 0 && severity\.review === 0 && severity\.soft === 0 && \(/,
    'the clear state must require a LOADED result as well as three zeros')
  assert.match(src, /Nothing to review on this asset\./)
  assert.match(src, /checked: !!state,/, 'the hook must report whether a payload actually arrived')
})

test('H:approve-is-not-offered-when-the-gate-blocks', () => {
  // The card offered an Approve the server refuses (approvalBlock). The server stays the authority;
  // this only stops offering an action already known to fail.
  const src = PACKET()
  assert.match(src, /const gateBlocks = !!qcResult && qcResult\.gate === 'fail'/)
  assert.match(src, /<button className="px-btn px-btn-green" disabled=\{gateBlocks\}/,
    'Approve must be disabled on a failing gate')
  // `unchecked` must NOT be folded in: the server refuses it too, but "run the checks" is a
  // different sentence from "fix these findings", and conflating them mislabels the state.
  assert.ok(!/gate === 'unchecked'/.test(src.slice(src.indexOf('const gateBlocks'), src.indexOf('const gateBlocks') + 200)))
  assert.match(src, /<GateBadge result=\{qcResult\} compact \/>/, 'the card must show the gate, not just the status')
})

test('H:one-edit-path: the asset-level tweaks reuse aiEditArtifact with no section', () => {
  const src = PACKET()
  // Section-less call = whole artifact (appPackets.ts writes artifact.content); with a section it
  // writes pkg_json[section]. One route, two scopes - never a second edit path.
  assert.match(src, /api\.aiEditArtifact\(a\.id, \{ instruction: assetAsk\.trim\(\) \}\)/)
  assert.equal((src.match(/api\.aiEditArtifact\(/g) || []).length, 1,
    'exactly one edit call in this screen')
  assert.ok(!/section:/.test(src.slice(src.indexOf('aiEditArtifact(a.id'), src.indexOf('aiEditArtifact(a.id') + 120)),
    'the whole-asset edit must NOT pass a section')
})

test('H:static-field-makes-no-false-before-claim', () => {
  // "Original - before this posting" on a field nothing changed is a false statement: a static
  // block's before and after are the same bytes, so there is no "before".
  //
  // REWRITTEN 2026-08-24. This case used to grep AssetBlocks.jsx for the literal ternary
  //   `row.before_text === row.after_text ? 'Identical - ...' : 'Original - ...'`
  // and it FAILED the moment that logic moved into ../src/assetBlocks.js — even though the
  // behaviour was unchanged and had just gained four unit tests. It was asserting the INCIDENT
  // (that string, in that file) rather than the INVARIANT, against CLAUDE.md's own H-case rules 1
  // and 4. The behaviour is exercisable now that it is out of the .jsx, so it is exercised.
  // Kept under the same slug because it guards the same claim.
  assert.equal(originalState({ before_text: 'same bytes', after_text: 'same bytes' }).label,
    'Identical - template text is not merged per packet',
    'an unchanged field must not be headed as though it changed')
  assert.equal(originalState({ before_text: 'was', after_text: 'now' }).label,
    'Original - before this posting', 'a field that DID change still says so')
})

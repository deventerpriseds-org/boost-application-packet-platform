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
  // Matches the MOUNT, not the exact markup. The original pinned `compact />` including the closing
  // slash, so adding SPEC 4.4-14's `onClick` broke a guard whose subject had not changed - the badge
  // was still mounted with the same result. A guard that fires on correct code is the cry-wolf
  // failure hardening rule 2 forbids, and the fix is to assert the invariant (the card shows the
  // GATE, not just the status pill) rather than the punctuation around it.
  assert.match(src, /<GateBadge result=\{qcResult\} compact/, 'the card must show the gate, not just the status')
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

// ── H:no-hook-after-an-early-return ─────────────────────────────────────────────────────────────
//
// THE MOST EXPENSIVE DEFECT THIS REPO HAS SHIPPED, measured rather than asserted. `a0bf0d1`
// (2026-08-24) put `useState(fieldFocus)` and `useCallback(goToField)` ~30 lines BELOW
// `if (pState.loading) return <Loading />`. The first render bails early having run N hooks; the
// loaded render runs N+2; React aborts the entire tree with error #310, "Rendered more hooks than
// during the previous render."
//
// The packet builder - the core screen of this product - was therefore DEAD ON LOAD for a full day,
// and every change shipped to it in that window was invisible in production. `npm test` was green
// at 294/294 the whole time, because a Node suite imports pure modules and never renders a tree.
//
// EVIDENCE: ui-verify run 32886100713 (an opportunity WITH evidence rows) and run 32886610272 (a
// different one with NONE) both returned the error boundary with that identical minified error and
// a byte-identical 62594-byte screenshot, while `#/settings/roles` rendered fine in run 32886894759
// - which is what localised it to this screen rather than to the app.
//
// THE INVARIANT, not the incident: in any component, every hook call must precede the first
// early return. Asserted structurally because no runtime test in this suite renders React.
import { readFileSync as readSrc } from 'node:fs'

test('H:no-hook-after-an-early-return: a conditional hook is invisible here and fatal in the browser', () => {
  const HOOK = /(^|[^A-Za-z0-9_.])(useState|useEffect|useMemo|useCallback|useRef|useLayoutEffect|useReducer|useContext)\s*\(/
  // An early return is a `return` guarded on one line - `if (x) return <Y />` - at the top level of
  // a component body. Matching the GUARDED form only is deliberate: a bare `return (` is the
  // component's real render and every hook is legitimately above it, so treating that as an early
  // return would fire on every correct file in the repo.
  const EARLY_RETURN = /^\s{2}if\s*\(.*\)\s*return\b/

  const screens = ['PacketBuilder.jsx', 'PostingAnalysis.jsx', 'AssetBlocks.jsx', 'QcRail.jsx',
    'AssetGateDrawer.jsx', 'Settings.jsx', 'Today.jsx', 'Opportunities.jsx']
  const offenders = []
  for (const f of screens) {
    const src = readSrc(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const lines = src.split('\n')
    let guardAt = null
    for (let i = 0; i < lines.length; i++) {
      // A new TOP-LEVEL declaration ends the previous function body, so the guard position resets
      // with it. Matching `export default function` and lower-cased helpers too is not cosmetic:
      // the first version of this guard matched only `(export )?(function|const) [A-Z]`, so it
      // carried `filterLabel`'s one-line `if (...) return` in Opportunities.jsx straight past
      // `export default function Opportunities` and accused a perfectly correct `useState` nine
      // lines later. Two false positives out of three hits - and a guard people learn to ignore is
      // worse than no guard, which is why this is checked against the real files rather than
      // trusted. Any declaration starting at column 0 ends the scope.
      if (/^(export\s+)?(default\s+)?(async\s+)?(function|const|class)\s/.test(lines[i])) guardAt = null
      if (guardAt === null && EARLY_RETURN.test(lines[i])) { guardAt = i; continue }
      if (guardAt !== null && HOOK.test(lines[i])) {
        offenders.push(`${f}:${i + 1} - hook after the early return at ${f}:${guardAt + 1}: ${lines[i].trim().slice(0, 70)}`)
        guardAt = null                                  // one report per component, not per line
      }
    }
  }
  assert.deepEqual(offenders, [],
    `a hook below an early return renders a different number of hooks on the loading pass than on the loaded pass, which React aborts the whole tree for:\n${offenders.join('\n')}`)
})

test('H:tone-names-must-exist: a tone the token table lacks paints an invisible signal', () => {
  // `toneColor(failList.count ? 'bad' : 'good')` shipped in dd4f61c. TONE_SOLID has no `bad` or
  // `good`, so BOTH branches resolved to ink3 and the gate rail was the same grey whether the packet
  // was blocked or clear. shell.jsx's own comment calls this "the bug that made todo pills
  // invisible" - it recurs because an unknown tone is swallowed rather than thrown.
  const shell = readSrc(new URL('../src/shell.jsx', import.meta.url), 'utf8')
  const table = shell.slice(shell.indexOf('const TONE_SOLID'), shell.indexOf('export const toneColor'))
  assert.ok(table.length > 40, 'TONE_SOLID not found - this guard is reading the wrong region')
  const known = new Set(Array.from(table.matchAll(/(^|[{,\s])([a-zA-Z]+)\s*:/g)).map((m) => m[2]))
  assert.ok(known.has('green') && known.has('red'), `TONE_SOLID parse looks wrong: ${[...known]}`)

  const bad = []
  for (const f of ['PacketBuilder.jsx', 'PostingAnalysis.jsx', 'QcRail.jsx', 'Today.jsx', 'AssetGateDrawer.jsx']) {
    const src = readSrc(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Only LITERAL tones can be checked statically; a variable tone is checked by the map it comes
    // from (see H:evidence-tone-resolves-to-a-real-token). Literals are where the typos land.
    for (const m of src.matchAll(/toneColor\(\s*(?:[^()]*\?\s*)?'([a-z]+)'\s*(?::\s*'([a-z]+)'\s*)?\)/g)) {
      for (const t of [m[1], m[2]].filter(Boolean)) if (!known.has(t)) bad.push(`${f}: toneColor('${t}')`)
    }
  }
  assert.deepEqual(bad, [], `these tones resolve to grey instead of erroring:\n${bad.join('\n')}`)
})

test('H:doc-links-stay-real-links-and-do-not-wrap-mid-label', () => {
  // SPEC 4.4-8, and this guard exists as much to PIN THE DECLINE as to pin the fix.
  //
  // The prototype renders these three as buttons. Converting a real `<a href target="_blank">` into
  // a button removes middle-click, Cmd-click, open-in-new-tab and "Copy link address" - the
  // prototype only uses a button because its link has no destination, and ours does. So the button
  // half is DECLINED, and this asserts the anchor survives: without it, a later pass "completing"
  // 4.4-8 against the prototype would quietly delete four real browser affordances.
  const src = PACKET()
  assert.match(src, /<a href=\{a\.docUrl\} target="_blank" rel="noreferrer"/,
    'the Google Doc link must stay a real anchor - a button cannot be middle-clicked or copied')
  // The half that WAS missing: a two-word label must not break mid-phrase when the row wraps.
  const anchor = src.slice(src.indexOf('<a href={a.docUrl}'), src.indexOf('<a href={a.docUrl}') + 200)
  assert.match(anchor, /whiteSpace: 'nowrap'/, 'the doc link can break mid-label')
  const copy = src.slice(src.indexOf('Copy tracked link') - 700, src.indexOf('Copy tracked link'))
  assert.match(copy, /whiteSpace: 'nowrap'/, 'the copy control can break mid-label')
})

test('H:ask-box-confirms-success-in-place-not-only-failure', () => {
  // SPEC 4.7-7. The finding was an ASYMMETRY, not an absence: `askError` rendered in place while
  // success was silent, so a reader could not tell "sent and applied" from "the button did nothing".
  const src = BLOCKS()
  assert.match(src, /BLOCK_HOOKS\.askSent/, 'no success confirmation is rendered at all')
  // THE STRUCTURAL POINT: the success path runs setAskOpen(false), so a confirmation rendered INSIDE
  // the ask box would unmount at the instant it became true. It must sit outside that block.
  const askOpenBlock = src.slice(src.indexOf('{askOpen && ('), src.indexOf('{askSent'))
  assert.ok(!/BLOCK_HOOKS\.askSent/.test(askOpenBlock),
    'the confirmation is inside the {askOpen && ...} block, so closing the box destroys it')
  assert.match(src, /\{askSent && !askOpen &&/, 'the confirmation must render only once the box has closed')
  // It names WHAT was asked - "Sent" alone does not say which of several asks landed - and the text
  // is captured BEFORE setAsk('') clears it.
  assert.match(src, /const sentText = ask\.trim\(\)[\s\S]{0,120}setAsk\(''\)/,
    'the sent text must be captured before the box is cleared, or the confirmation is empty')
  // A stale confirmation must not sit above a NEW ask, or it reads as confirming the one being typed.
  assert.match(src, /setAskSent\(null\)[\s\S]{0,80}setAskOpen\(\(v\) => !v\)/,
    'opening the ask box must clear a previous confirmation')
})

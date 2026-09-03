// SPEC 4.11 — the floating assistant panel.
//
// Two kinds of assertion here, and the split is deliberate. The pure ones exercise the seed contract
// and the scope rule as functions. The structural ones read the component source, because the
// invariants that actually broke this feature before it existed are about what the component DOES
// NOT do — render a control with nothing behind it, grow a second edit path, or drift between the
// mobile and desktop branches — and none of those is expressible as a return value.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ASSISTANT_HOOKS, ASSISTANT_LIMITS, applySeed, assistantScope, assistantScopes, assistantSendBody, canSend,
  assistantMode, dockedContentWidth, DOCK_MIN_VIEWPORT, DOCK_WIDTH, MIN_CONTENT,
  NAV_WIDTH, GUTTER, SHELL_CAP,
} from '../src/assistantPanel.js'
import { OVERLAY_VARIANTS } from '../src/overlay.js'

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PANEL = strip(src('../src/screens/AssistantPanel.jsx'))
const BUILDER = strip(src('../src/screens/PacketBuilder.jsx'))
const MODULE = strip(src('../src/assistantPanel.js'))

// ── the seed contract ───────────────────────────────────────────────────────────────────────────

test('H:seed-opens-and-CLEARS: a spent seed cannot re-fire over what the reader typed', () => {
  // `assist.jsx:28` defines seeding as set text -> open -> CLEAR. The clear is the half that is easy
  // to drop and impossible to notice: without it the same sentence re-applies on the next render and
  // silently overwrites a half-typed request. Returning the next state rather than mutating is what
  // makes that assertable with no DOM.
  const next = applySeed({ seed: 'Shorten this field.', text: 'half-typed thing' })
  assert.equal(next.text, 'Shorten this field.')
  assert.equal(next.open, true)
  assert.equal(next.seed, null, 'the seed slot was not cleared - it will re-fire on the next render')

  // No seed is NOT an instruction to open. A panel that opens itself on every render is a panel the
  // reader cannot close.
  assert.deepEqual(applySeed({ seed: null, text: 'kept' }), { text: 'kept', open: false, seed: null })
  assert.deepEqual(applySeed({}), { text: '', open: false, seed: null })
  assert.deepEqual(applySeed(null), { text: '', open: false, seed: null })
})

test('H:panel-seeds-but-never-sends: seeding is not a second edit path', () => {
  // The existing seeders record that they "set state and return - neither sends". A seeder that
  // sends is a second edit path wearing a different name, and it would take the reader's ability to
  // edit the wording before it goes.
  assert.ok(!/await |fetch\(|api\./.test(String(applySeed)),
    'applySeed reaches outside itself; a seed must only shape state')
  // The send lives behind an explicit control, never in the seed effect.
  const seedEffect = (PANEL.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[seed\]\)/) || [''])[0]
  assert.ok(seedEffect.length > 0, 'the seed effect could not be located - this guard is not reading it')
  assert.ok(!/api\./.test(seedEffect), 'the seed effect calls the API; seeding must send nothing')
  assert.match(seedEffect, /onSeedConsumed/, 'the seed effect does not tell the parent the slot is spent')
})

// ── scope: stated, never guessed ────────────────────────────────────────────────────────────────

test('H:scope-never-invents-an-artifact: no asset means say so, not pick one', () => {
  // The route is artifact-scoped. With nothing open, the honest output is a sentence telling the
  // reader to open an asset - never a silent default, which would send their request at whichever
  // document happened to be first.
  const none = assistantScope(null)
  assert.equal(none.artifactId, null)
  assert.equal(none.label, null)
  assert.match(none.text, /Open an asset first/)

  const one = assistantScope({ id: 'a1', type: 'compact_resume' })
  assert.equal(one.artifactId, 'a1')
  assert.match(one.text, /compact resume/, 'the scope sentence must name the document it will change')
  assert.match(one.text, /one field/, 'the scope sentence must state that it changes ONE field')
})

test('H:send-requires-a-target-and-a-request', () => {
  assert.equal(canSend({ text: 'do a thing', artifactId: 'a1', busy: false }), true)
  assert.equal(canSend({ text: '   ', artifactId: 'a1' }), false, 'whitespace is not a request')
  assert.equal(canSend({ text: 'do a thing', artifactId: null }), false, 'no artifact, nothing to send to')
  assert.equal(canSend({ text: 'do a thing', artifactId: 'a1', busy: true }), false, 'double-send')
  assert.equal(canSend(), false)
})

// ── what must NOT render ────────────────────────────────────────────────────────────────────────

test('H:panel-renders-no-Keep-and-no-Revert: neither has anything to call', () => {
  // SPEC 4.11-7 draws Keep / Revert / Re-run QC under every reply. Two of the three must not exist:
  // `correctionRevert` needs a `correction` row with char offsets and a before_sha256, which
  // `aiEditArtifact` never writes, and `appSwaps.ts` is GET-only - so Revert has no target in either
  // sense. Keep is worse than vacuous: the route commits pkg_json BEFORE it replies, so a Keep
  // control would imply a pending approval that does not exist. Rendering them DISABLED would be no
  // better - a disabled control still asserts the capability is there and merely unavailable.
  assert.ok(!/>\s*Keep\s*</.test(PANEL), 'a Keep control renders; the change is already saved when the reply appears')
  assert.ok(!/>\s*Revert\s*</.test(PANEL), 'a Revert control renders; no route reverts an ai-edit')
  // And the limit is SAID, so its absence is not read as an oversight.
  assert.ok(ASSISTANT_LIMITS.length >= 1)
  assert.match(PANEL, /ASSISTANT_LIMITS\.map/, 'the limits are declared but never rendered - a write-only list')
  assert.ok(ASSISTANT_LIMITS.some((l) => /saved as soon as/i.test(l)),
    'nothing tells the reader the change is already saved, which is why there is no Keep')
})

test('H:panel-has-one-edit-path-and-reuses-the-shared-drawer', () => {
  // Per-screen-file, as `H:one-edit-path` is: the panel may call the edit route, but only once, and
  // it must be the SAME route the field box uses rather than a new one.
  assert.equal((PANEL.match(/api\.aiEditArtifact\(/g) || []).length, 1,
    'the panel grew a second edit path')
  // Match real member CALLS, not the import path: `from '../api.js'` contains `api.j` and the first
  // version of this guard fired on it - a false positive on correct code, which is the cry-wolf
  // failure the H-case rules forbid outright.
  const apiCalls = [...PANEL.matchAll(/\bapi\.([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1])
  assert.deepEqual([...new Set(apiCalls)], ['aiEditArtifact'],
    `the panel calls an API other than the shared edit route: ${[...new Set(apiCalls)].join(', ')}`)

  // REUSE, not a hand-rolled panel. The shared drawer already clamps to min(680px, 100vw) - which is
  // what makes this work on a phone - and already owns the focus trap and close-on-navigation. A
  // second positioned panel would be the parallel system, and it would be the one without the trap.
  //
  // The literal `variant="drawer"` assertion this replaced went stale on 2026-09-02 when mobile
  // gained its own `sheet` edge. The INTENT is unchanged and is what is asserted now: every variant
  // this panel names must be a REAL entry in the shared table.
  //
  // STRONGER THAN THE OLD CHECK, for a reason worth keeping: `overlayVariant` is
  // `OVERLAY_VARIANTS[variant] || OVERLAY_VARIANTS.modal`, so a TYPO does not throw - it silently
  // renders a centred modal. A misspelled 'sheeet' would have shipped as a dialog on every phone
  // and looked merely odd rather than broken. Nothing checked for that before.
  assert.match(PANEL, /<Overlay/, 'the panel stopped using the shared Overlay')
  const variants = [...PANEL.matchAll(/variant=(?:"([a-z]+)"|\{[^}]*?'([a-z]+)'\s*:\s*'([a-z]+)'\})/g)]
    .flatMap((m) => [m[1], m[2], m[3]]).filter(Boolean)
  assert.ok(variants.length > 0, 'the panel names no Overlay variant at all')
  for (const v of variants) {
    assert.ok(Object.prototype.hasOwnProperty.call(OVERLAY_VARIANTS, v),
      `variant "${v}" is not in OVERLAY_VARIANTS - overlayVariant() would silently fall back to modal`)
  }
  assert.match(PANEL, /from '\.\.\/shell\.jsx'/, 'the panel no longer imports the shared shell overlay')
})

// ── the layout decision, recorded where it is enforced ──────────────────────────────────────────

test('H:panel-mode-is-derived-and-declared-not-hardcoded', () => {
  // REPLACES H:panel-floats-and-is-defined-ONCE-for-both-layouts, which asserted
  // `data-qc-mode="float"` as a LITERAL and forbade any dock breakpoint. That guard was correct for
  // the decision it encoded (owner, 2026-08-27: float everywhere, because a 1280 shell cap left the
  // packet 688px against blocks needing ~850) and the owner REVERSED that decision on 2026-09-02:
  // *"on desktop wide the panel rather than float."* Replaced rather than deleted, and the
  // replacement is strictly stronger: the old one could not tell a mode that was CHOSEN from one
  // that was typed.
  assert.match(PANEL, /data-qc-mode=\{mode\}/,
    'the panel must declare the mode it is actually in, not a literal that cannot disagree with itself')
  assert.ok(!/data-qc-mode="[a-z]+"/.test(PANEL),
    'a hardcoded mode string came back - it makes the DOM record unfalsifiable')

  // Three real modes, and mobile beats wide. A device reporting both must get the sheet: the mobile
  // branch renders no rail and no columns, so there is nothing to dock beside.
  assert.equal(assistantMode({ mobile: false, wide: true }), 'dock')
  assert.equal(assistantMode({ mobile: false, wide: false }), 'float')
  assert.equal(assistantMode({ mobile: true, wide: false }), 'sheet')
  assert.equal(assistantMode({ mobile: true, wide: true }), 'sheet',
    'mobile must win over wide - a phone has no columns to dock beside')
  assert.equal(assistantMode(), 'float', 'the no-argument default must be the safe one')
})

test('H:dock-never-squeezes-the-packet-below-what-blocks-need', () => {
  // THE INVARIANT THE WHOLE DECISION RESTS ON, and the one a later tweak would silently break.
  // Docking was refused in August purely on this sum; it is allowed now only because the shell cap
  // moved to 1560. If someone widens DOCK_WIDTH or lowers the threshold, the packet quietly gets
  // narrower and nothing in a diff says so - which is exactly how the 688px squeeze happened.
  assert.ok(dockedContentWidth(DOCK_MIN_VIEWPORT) >= MIN_CONTENT,
    `docking at the threshold leaves ${dockedContentWidth(DOCK_MIN_VIEWPORT)}px, under the ${MIN_CONTENT}px blocks need`)
  assert.ok(dockedContentWidth(SHELL_CAP) >= MIN_CONTENT,
    'docking at the shell cap must also clear the minimum')

  // DERIVED, not typed. A literal threshold is what lets the two drift apart.
  assert.ok(!/DOCK_MIN_VIEWPORT = \d/.test(MODULE),
    'DOCK_MIN_VIEWPORT is a literal - it must be computed from NAV + GUTTER + MIN_CONTENT + DOCK')
  assert.ok(DOCK_MIN_VIEWPORT >= NAV_WIDTH + GUTTER + MIN_CONTENT + DOCK_WIDTH + GUTTER,
    'the threshold does not actually cover the columns it is made of')

  // Below the threshold there is no dock to have.
  assert.ok(dockedContentWidth(1280) < MIN_CONTENT,
    'the old 1280 cap must still fail the test - it is why this was refused in August')
})

test('H:panel-mounts-exactly-once-per-layout', () => {
  // ONE element, and the float/dock renders are MUTUALLY EXCLUSIVE. Two mounts means two textareas
  // holding two drafts, and a seed consumed by whichever instance reacted first - a silent
  // data-loss bug, not a cosmetic one. The mobile branch renders its own.
  assert.equal((BUILDER.match(/<AssistantPanel/g) || []).length, 1,
    'the panel is constructed more than once - the branches can now drift')
  assert.match(BUILDER, /\{assistantMode_ === 'dock' && assistant\}/,
    'the docked column must be gated on the mode')
  assert.match(BUILDER, /\{assistantMode_ === 'float' && assistant\}/,
    'the floating render must be gated on the SAME mode, or dock mode mounts the panel twice')
})

test('H:forward-carries-the-artifact-with-the-sentence', () => {
  // The panel is artifact-scoped, so a forwarded sentence that does not name its artifact would have
  // to be resolved later from whatever step is active - a guess, on the reader's own document. The
  // binding happens at the call site where `a.id` is unambiguous.
  assert.match(BUILDER, /onSeedAssistant=\{\(text\) => seedAssistant\(text, a\.id\)\}/,
    'the forward no longer binds the artifact at the call site')
  assert.match(BUILDER, /if \(!text \|\| !artifactId\) return/,
    'seedAssistant will open a panel that has nothing to send to')
  assert.ok(Object.values(ASSISTANT_HOOKS).every((v) => typeof v === 'string' && v.startsWith('assistant-')),
    'a hook is not namespaced; ui-verify selects on these and a collision is silent')
})

test('H:forward-prop-is-threaded-not-just-referenced: a prop used in a component it never receives', () => {
  // THE DEFECT THIS EXISTS FOR SHIPPED, and every guard in this file stayed green while it did.
  // `onSeedAssistant` was added to the DEFAULT EXPORT's signature and used inside `AssetBlock` - a
  // different component, which never received it. In JSX that is a ReferenceError at render, so the
  // entire asset card blanked. A source grep for the identifier finds it and cannot see the SCOPE it
  // resolves in, which is why every Node assertion passed; `run-field-margin.mjs` caught it because
  // it MOUNTS the card, and this file's own browser probe did not because it mounts only the panel.
  //
  // Structural rather than behavioural on purpose: the runtime proof lives in the probe, and what a
  // grep CAN do reliably is confirm the identifier is bound everywhere it is used.
  const BLOCKS = strip(src('../src/screens/AssetBlocks.jsx'))
  const uses = BLOCKS.includes('onSeedAssistant(')
  assert.ok(uses, 'the forward control is gone entirely')

  // Every component that USES it must also DECLARE it. `AssetBlock` is the one that renders the
  // control; the default export is the one that receives it from the screen.
  const inner = (BLOCKS.match(/function AssetBlock\(\{[\s\S]*?\}\) \{/) || [''])[0]
  assert.match(inner, /onSeedAssistant/,
    'AssetBlock uses onSeedAssistant but does not declare it - a ReferenceError at render')
  const outer = (BLOCKS.match(/export default function AssetBlocks\(\{[\s\S]*?\}\) \{/) || [''])[0]
  assert.match(outer, /onSeedAssistant/, 'the default export no longer accepts the prop from the screen')

  // ...and it must actually be HANDED DOWN, or the control silently never renders. Declaring it with
  // a default of null makes the crash go away and the feature go away with it.
  const mount = (BLOCKS.match(/<AssetBlock\b[\s\S]*?\/>/) || [''])[0]
  assert.match(mount, /onSeedAssistant=\{onSeedAssistant\}/,
    'AssetBlock is mounted without the prop - the forward control can never render')
})


// ---------------------------------------------------------------------------------------------
// SPEC 4.11-4 - the scope selector. TWO options, not the prototype's three, because two of its
// chips route nowhere: every write in the API is `app/artifact/{artifactId}/...` (no packet-level
// edit exists) and `app/qc/facts/set` takes a structured fact, not an instruction. The prototype's
// own send() never reads `scope` at all (qc/assist.jsx), so copying it ships three dead controls.

test('H:scope-offers-only-what-actually-routes', () => {
  const withField = assistantScopes({ id: 'a1', type: 'compact_resume' }, 'ResumeSummary')
  assert.deepEqual(withField.options.map((o) => o.id), ['field', 'asset'])
  // The prototype's unrouted chips must never appear.
  const labels = withField.options.map((o) => o.label).join(' ')
  assert.doesNotMatch(labels, /This packet|My profile/i)
})

test('H:scope-collapses-to-one-option-when-there-is-no-field', () => {
  // A picker with a single choice is furniture, and offering "This field" with no field would send
  // a section that is not there.
  const noField = assistantScopes({ id: 'a1', type: 'resume' }, null)
  assert.deepEqual(noField.options.map((o) => o.id), ['asset'])
  assert.equal(noField.artifactId, 'a1')
  for (const bad of ['', '   ', undefined]) {
    assert.deepEqual(assistantScopes({ id: 'a1', type: 'resume' }, bad).options.map((o) => o.id), ['asset'])
  }
  // Nothing open: no options at all, and the caller renders the open-an-asset sentence.
  assert.deepEqual(assistantScopes(null, 'ResumeSummary').options, [])
})

test('H:scope-sentence-states-what-that-scope-will-touch', () => {
  const { options } = assistantScopes({ id: 'a1', type: 'compact_resume' }, 'ResumeSummary')
  const field = options.find((o) => o.id === 'field')
  const asset = options.find((o) => o.id === 'asset')
  // Each option names the document, and the two sentences must DIFFER - one scope selected and the
  // other described identically is how a reader learns the picker does nothing.
  assert.match(field.text, /compact resume/)
  assert.match(asset.text, /compact resume/)
  assert.match(field.text, /ResumeSummary/)
  assert.notEqual(field.text, asset.text)
  // Neither may claim it reaches beyond the asset - no route does.
  for (const o of options) assert.match(o.text, /nothing else in the packet/)
})

test('H:scope-decides-the-section-the-handler-reads', () => {
  // This is the whole point: the selection changes what is SENT, not just a label.
  // artifactAiEdit reads `section` -> pkg[section] (one field), absent -> art.content (the asset).
  assert.deepEqual(assistantSendBody({ instruction: 'tighten it', scopeId: 'field', field: 'ResumeSummary' }),
    { instruction: 'tighten it', section: 'ResumeSummary' })
  const asset = assistantSendBody({ instruction: 'tighten it', scopeId: 'asset', field: 'ResumeSummary' })
  assert.deepEqual(asset, { instruction: 'tighten it' })
  // OMITTED, never null: the handler treats null and absent alike today, but a null reads as
  // "I meant a field and could not name it", which is a different claim from "I meant the asset".
  assert.ok(!('section' in asset))
  // A field scope with no field cannot fabricate one.
  assert.deepEqual(assistantSendBody({ instruction: 'x', scopeId: 'field', field: null }), { instruction: 'x' })
})

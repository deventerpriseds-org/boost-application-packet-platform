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
import { ASSISTANT_HOOKS, ASSISTANT_LIMITS, applySeed, assistantScope, canSend } from '../src/assistantPanel.js'

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
  assert.match(PANEL, /variant="drawer"/, 'the panel stopped using the shared Overlay drawer')
  assert.match(PANEL, /from '\.\.\/shell\.jsx'/, 'the panel no longer imports the shared shell overlay')
})

// ── the layout decision, recorded where it is enforced ──────────────────────────────────────────

test('H:panel-floats-and-is-defined-ONCE-for-both-layouts', () => {
  // The mode is asserted in the DOM rather than inferred from what is absent, so a verifier reading
  // the live page learns which layout decision this app made.
  assert.match(PANEL, /data-qc-mode="float"/, 'the panel no longer declares its mode')
  assert.ok(!/data-qc-mode="docked"/.test(PANEL),
    'a docked mode appeared - the shell caps content at 1280 and a dock leaves 688px against ~850px needed')

  // ONE element, rendered by BOTH branches. PacketBuilder's mobile and desktop returns have drifted
  // before; two copies of this JSX is how a fix lands on one size and not the other.
  assert.equal((BUILDER.match(/<AssistantPanel/g) || []).length, 1,
    'the panel is constructed more than once - the mobile and desktop branches can now drift')
  assert.equal((BUILDER.match(/\{assistant\}/g) || []).length, 2,
    'the shared panel element is not rendered by exactly two branches (mobile + desktop)')

  // No new viewport rule. AC-5 forbids standing up a second breakpoint mechanism beside
  // keywordColumns; since the panel floats at every width there is no threshold to add, and a rule
  // with one branch is config that cannot be wrong - which reads as a decision and is not one.
  assert.ok(!/1440|assistantMode/.test(MODULE),
    'a dock breakpoint appeared in the panel module; the panel floats at every width')
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

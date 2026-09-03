// SPEC 4.11 — the assistant panel's pure logic. The React component is screens/AssistantPanel.jsx,
// per the same split assetBlocks.js / AssetBlocks.jsx and overlay.js / shell.jsx already use.
//
// THREE MODES, AND THE ARITHMETIC THAT PICKS THEM. Owner decision 2026-09-02, REVERSING the
// 2026-08-27 float-everywhere call: *"on desktop wide the panel rather than float but you will need
// a different approach of your choosing for mobile."*
//
// The old decision was not wrong when it was made -- it was arithmetic. This app's shell capped
// content at 1280, so docking the prototype's 340px column left the packet
// `1280 - 220 rail - 16 - 340 - 16 = 688px` against asset blocks needing ~850px, at EVERY width,
// because the cap bound before any viewport got wide enough. **The owner has now raised the cap to
// the prototype's own 1560 (`shell.jsx`), which is what changes the answer.** At 1560 the same sum
// gives 968px and the blocks fit with room to spare.
//
//   dock   -- viewport >= DOCK_MIN_VIEWPORT. A real third column, in flow, always visible.
//   float  -- desktop below that. The drawer + fixed launcher, unchanged; it is still the only
//             honest option when docking would squeeze the blocks under MIN_CONTENT.
//   sheet  -- mobile. See below.
//
// MOBILE IS A BOTTOM SHEET, and that is a choice with a reason rather than a leftover. Below 768px
// `PacketBuilder.jsx` takes a separate branch with no step rail and no columns, so there is no dock
// to have. A fixed bottom-right launcher is wrong on a phone -- it sits under the thumb on exactly
// the scroll axis the packet uses, and it overlaps the sticky step controls. The sheet enters from
// the bottom edge, which is where a phone's reachable zone is, and it is the same `Overlay` the rest
// of the app already stacks and closes on navigation. One component, three presentations, ONE body:
// the panel's contents are built once in the component and placed by mode, so the modes cannot drift.
//
// THERE IS NOW A BREAKPOINT CONSTANT, and the previous version of this comment argued against one:
// *"since the panel floats at every width, a threshold would have exactly one branch, and a rule
// with one outcome is config that cannot be wrong."* That reasoning was correct FOR A ONE-BRANCH
// WORLD and expired the moment docking became reachable. It is kept here because the rule it states
// is still right and worth not re-learning: do not add a threshold until it has two real outcomes.

export const ASSISTANT_HOOKS = {
  open: 'assistant-open',         // the affordance that opens it (carries data-qc-seeded)
  panel: 'assistant-panel',       // the body root, in every mode (carries the REAL data-qc-mode)
  dock: 'assistant-dock',         // the docked column wrapper -- present only when mode is 'dock',
                                  // so its absence is how a verifier proves the app FLOATED
  scope: 'assistant-scope',       // what this request will touch
  scopePick: 'assistant-scope-pick',   // 4.11-4 the selector
  scopeChip: 'assistant-scope-chip',   // one option (carries data-qc-scope)
  box: 'assistant-box',           // the request textarea
  send: 'assistant-send',
  sent: 'assistant-sent',         // the confirmation, which outlives the box that sent it
  error: 'assistant-error',
  limits: 'assistant-limits',     // what the panel CANNOT do, said rather than implied
}

/**
 * What a request from this panel will actually touch — stated, never offered as a choice.
 *
 * SPEC 4.11-4 draws three scope chips: `This packet`, `This asset`, `My profile`. Only the middle
 * one has a route. `artifactAiEdit` takes ONE `artifactId` and at most one `section`
 * (`appPackets.ts:1400`), so a packet-wide scope would be N calls — a second edit path, which the
 * owner's `aiEditArtifact`-only ruling forbids — and `My profile` is owner-closed as read-only with
 * no profile record in SPEC §5 to write to.
 *
 * So the selector is NOT rendered. Three live-looking chips over one working route is dead UI in its
 * most expensive form: it changes what the reader believes they asked for, and they would only find
 * out by reading the diff. A sentence naming the one real scope is honest and cheaper.
 *
 * @param {{type?: string}|null} artifact
 * @returns {{artifactId: string|null, label: string, text: string}}
 */
/**
 * SPEC 4.11-4 - the scope selector, built from the scopes that ACTUALLY ROUTE.
 *
 * WHY THIS IS TWO OPTIONS AND NOT THE PROTOTYPE'S THREE. `qc/assist.jsx:69` offers
 * "This packet" / "This asset" / "My profile", and its own `send()` NEVER READS `scope` -- the
 * chips set local state that reaches nothing. That is the same defect this repo already refused in
 * the `Reword it` toggle (4.5-38): a control that forgets. Copying it would ship dead UI three
 * times over.
 *
 * So the options are derived from the write routes that exist, swept rather than assumed. Every
 * write in the API is `app/artifact/{artifactId}/...`; there is NO packet-level edit route, so
 * "This packet" has nowhere to send. `POST app/qc/facts/set` does write the owner's profile, but it
 * takes a STRUCTURED FACT, not a free-text instruction, so "My profile" cannot carry an assistant
 * ask either. Both are omitted rather than rendered inert -- "if a feature isn't ready, hide the
 * control, don't fake it".
 *
 * THE TWO THAT REMAIN ARE A REAL CHOICE, one parameter apart on the route that already ships.
 * `artifactAiEdit` (appPackets.ts) reads an optional `section`:
 *   section set  -> `pkg[section]`   - that one merge field
 *   section null -> `art.content`    - the whole asset
 * So the selector changes what the model is handed, not just a label. `field` is only offered when
 * the caller actually has one; with no field in hand the asset scope is the only honest option and
 * the selector collapses to it rather than offering a choice that would silently do the same thing.
 *
 * @returns {{options: Array<{id:string,label:string,text:string}>, artifactId: string|null}}
 */
export function assistantScopes(artifact, field) {
  const a = artifact || null
  const label = a && a.type ? String(a.type).replace(/_/g, ' ') : null
  const f = typeof field === 'string' && field.trim() ? field.trim() : null
  if (!label) {
    return { artifactId: a && a.id ? a.id : null, label: null, options: [] }
  }
  const options = []
  if (f) {
    options.push({
      id: 'field',
      label: 'This field',
      text: `This request changes ${f} on your ${label}, and nothing else in the packet.`,
    })
  }
  options.push({
    id: 'asset',
    label: 'This asset',
    text: `This request may change any part of your ${label}, and nothing else in the packet.`,
  })
  // `label` IS PART OF THE CONTRACT, not an internal. The panel header reads
  // `Working on your ${label}` and falls back to "No asset open" without it -- so dropping it
  // silently tells the reader nothing is open while the scope chips sit right below, rendering.
  // That is exactly what happened: the 4.11-4 refactor replaced assistantScope() (which returned a
  // label) with a locally built object that did not, and the header went permanently wrong. Caught
  // on production by ui-verify 33758768784 asserting the ABSENCE of "No asset open".
  return { artifactId: a && a.id ? a.id : null, label, options }
}

/**
 * The body the send builds for a chosen scope. Named here so the component cannot compose its own,
 * and so the ONE place that decides "field or whole asset" is unit-testable.
 *
 * `section` is OMITTED, never sent as null, when the scope is the whole asset: the handler tests
 * `typeof body?.section === 'string' && body.section`, so null and absent behave identically today
 * -- but sending a null reads as "I meant a field and could not name it", which is a different
 * claim from "I meant the asset".
 */
export function assistantSendBody({ instruction, scopeId, field }) {
  const body = { instruction: String(instruction || '').trim() }
  const f = typeof field === 'string' && field.trim() ? field.trim() : null
  if (scopeId === 'field' && f) body.section = f
  return body
}

export function assistantScope(artifact) {
  const a = artifact || null
  const label = a && a.type ? String(a.type).replace(/_/g, ' ') : null
  return {
    artifactId: a && a.id ? a.id : null,
    label,
    text: label
      ? `This request changes one field of your ${label}, and nothing else in the packet.`
      : 'Open an asset first — a request has to name the document it changes.',
  }
}

/**
 * The seed contract: set the text, open, and CLEAR THE SLOT.
 *
 * `assist.jsx:28` defines seeding as set text -> open -> clear the seed, and the clear is the part
 * that is easy to drop and impossible to notice: without it the same sentence re-applies on the next
 * render and silently overwrites whatever the reader had started typing. Returning the next state
 * rather than mutating keeps that testable with no DOM.
 *
 * NOTHING IS SENT. This is the whole reason the seeders are a separate primitive from the send:
 * `AssetBlocks.jsx` records that its two seeders "set state and return - neither sends", and a
 * seeder that sends is a second edit path wearing a different name.
 *
 * @param {{seed: string|null, text: string}} state
 * @returns {{text: string, open: boolean, seed: null}}
 */
export function applySeed(state) {
  const s = state || {}
  const seed = typeof s.seed === 'string' ? s.seed : null
  if (!seed) return { text: typeof s.text === 'string' ? s.text : '', open: false, seed: null }
  return { text: seed, open: true, seed: null }
}

/**
 * What this panel cannot do, in the reader's words, and why each one is stated rather than shown as
 * a disabled control.
 *
 * SPEC 4.11-7 draws `Keep` / `Revert` / `Re-run QC` under every reply. Two of the three must not
 * render at all, and this is not a scheduling decision — they have nothing to call:
 *
 *  - **Revert** has no route in either sense. `correctionRevert` needs a `correction` row carrying
 *    char offsets and a `before_sha256`; `aiEditArtifact` creates none and stores no before-image.
 *    `appSwaps.ts` is GET-only. A `Revert` button would be a control with no target.
 *  - **Keep** is worse than vacuous. The route commits `pkg_json` BEFORE it replies, so by the time
 *    a reply is on screen the change is already saved. A `Keep` control would imply a pending
 *    approval that does not exist, which is a false statement about the reader's own document.
 *
 * Rendering them disabled would be no better: a disabled control still asserts the capability exists
 * and is merely unavailable. Saying the limit is the honest form.
 */
export const ASSISTANT_LIMITS = [
  'Changes are saved as soon as they are made — there is nothing to approve afterwards.',
  'Undo is per field, in the field itself, not from here.',
]

/**
 * Is this request sendable? Kept out of the component so the rule is one place and assertable.
 *
 * An artifact is required because the route is artifact-scoped; empty text is not a request. Both
 * are the reader's own state, so neither is an accusation and a plain boolean is the right shape.
 */
export function canSend({ text, artifactId, busy } = {}) {
  return Boolean(artifactId) && !busy && String(text || '').trim().length > 0
}

/* ── SPEC 4.11-1 — WHERE THE PANEL SITS ──────────────────────────────────────────────────────── */

/** The prototype's own shell cap (`qc/shell.jsx:96`), which this app now matches. */
export const SHELL_CAP = 1560
/** The prototype's right column. */
export const DOCK_WIDTH = 340
/** The step rail, and the two 16px gaps around the docked column. */
export const NAV_WIDTH = 220
export const GUTTER = 16
/**
 * What an asset block needs to render without wrapping its field controls.
 *
 * Not invented here: it is the figure the 2026-08-27 decision was made against, quoted in this
 * file's own history and in `PacketBuilder.jsx` -- "asset blocks that need ~850px". It is the
 * number that made docking impossible at a 1280 cap, so it is the number the new threshold must
 * clear, or raising the cap bought nothing.
 */
export const MIN_CONTENT = 850

/** Content width left for the packet when the panel is docked at a given viewport width. */
export function dockedContentWidth(viewport) {
  const v = Number(viewport)
  if (!Number.isFinite(v)) return 0
  return Math.min(v, SHELL_CAP) - NAV_WIDTH - GUTTER - DOCK_WIDTH - GUTTER
}

/**
 * The narrowest viewport that may dock.
 *
 * DERIVED, never typed as a literal: `NAV + GUTTER + MIN_CONTENT + DOCK + GUTTER` = 1442, rounded up
 * to 1450 for a little slack. Writing 1450 by hand is how a later tweak to `DOCK_WIDTH` silently
 * re-creates the squeeze this whole decision exists to avoid -- the blocks would just quietly get
 * 30px narrower and nobody would see it in a diff.
 */
export const DOCK_MIN_VIEWPORT = Math.ceil(
  (NAV_WIDTH + GUTTER + MIN_CONTENT + DOCK_WIDTH + GUTTER) / 10) * 10

/**
 * Which presentation to use. Pure, so the arithmetic is testable without a browser.
 *
 * `mobile` wins over `wide` unconditionally: the mobile branch of `PacketBuilder` renders no rail
 * and no columns, so "wide" is meaningless there and a device reporting both must still get the
 * sheet rather than a dock with nothing to dock beside.
 */
export function assistantMode({ mobile = false, wide = false } = {}) {
  if (mobile) return 'sheet'
  return wide ? 'dock' : 'float'
}

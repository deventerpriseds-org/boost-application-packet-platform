// SPEC 4.11 — the assistant panel's pure logic. The React component is screens/AssistantPanel.jsx,
// per the same split assetBlocks.js / AssetBlocks.jsx and overlay.js / shell.jsx already use.
//
// WHY THIS PANEL FLOATS AND DOES NOT DOCK, recorded here because the next person to read SPEC 4.11
// will find a docked right column drawn in the prototype and wonder where it went.
//
// It is arithmetic, not preference. The prototype's shell caps content at 1560 (`qc/shell.jsx:96`);
// this app's caps at 1280 (`shell.jsx:463`). Docking the prototype's 340px column leaves the packet
// `1280 - 220 rail - 16 - 340 - 16 = 688px` against asset blocks that need ~850px — and because the
// cap binds above ~1524px, NO viewport width passes. The 280px difference between the two shells is
// exactly the right-hand column decision D4 deleted, so docking would rebuild what D4 removed.
// The owner chose floating on 2026-08-27 after seeing the layouts drawn to scale; the alternative
// (raise the shell cap, re-flowing every screen) is kept in `.claude/DEFERRED.md` rather than lost.
//
// MOBILE IS WHY FLOATING IS RIGHT RATHER THAN MERELY ACCEPTABLE. `PacketBuilder.jsx` has a separate
// `if (mobile)` branch: below 768px the step rail and the two-column layout do not render at all.
// So no dock exists on a phone under any option, while `shell.jsx`'s `Overlay variant="drawer"`
// already clamps itself to `min(680px, 100vw)` and already owns the overlay stack and
// close-on-navigation. One component serves both sizes. A dock would have needed a second, driftable
// mobile sheet.
//
// THERE IS DELIBERATELY NO BREAKPOINT CONSTANT. AC-5 guards against standing up a second viewport
// mechanism beside `keywordColumns`; since the panel floats at every width, a threshold would have
// exactly one branch, and a rule with one outcome is config that cannot be wrong — which is worse
// than no rule, because it looks like a decision.

export const ASSISTANT_HOOKS = {
  open: 'assistant-open',         // the affordance that opens it (carries data-qc-seeded)
  panel: 'assistant-panel',       // the drawer body root (carries data-qc-mode)
  scope: 'assistant-scope',       // what this request will touch, stated rather than selected
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

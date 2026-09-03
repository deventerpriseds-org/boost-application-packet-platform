// Pure helpers for the <Overlay> primitive (the component itself lives in shell.jsx, per D10,
// beside Pill/MatchScore). They sit in a plain .js module for ONE reason: Node's built-in test
// runner can import them with no DOM and no new dependency (same constraint X4 set for api/).
// Nothing here touches window/document — anything that does stays in the component.

// Variant → real design tokens. This is an EXPLICIT map for the same reason TONE in shell.jsx is:
// building a custom-property name by interpolation (`var(--zindex-${variant})`) silently emits an
// INVALID declaration for any variant without a matching token, and CSS drops invalid declarations
// without warning. That bug already shipped once in Pill. Every variant is spelled out, and an
// unknown variant falls back to a real, defined token rather than to nothing.
//
// z-index comes from the existing (previously unused) --zindex-* scale in tokens/fig-tokens.css:
//   base 0 · raised 10 · dropdown 100 · sticky 150 · OVERLAY 200 · MODAL 300 · toast 400 · tooltip 500
// A drawer sits at `overlay` and a modal at `modal` so a modal opened FROM a drawer stacks above it,
// and toasts (400) stay visible above both.
export const OVERLAY_VARIANTS = {
  drawer: {
    zIndex: 'var(--zindex-overlay)',
    // Right-hand sheet, full height. `min(…, 100vw)` is what keeps it inside a narrow viewport —
    // a fixed 680px drawer would overflow horizontally on a phone.
    align: 'stretch',
    justify: 'flex-end',
    padding: 0,
    width: 'min(680px, 100vw)',
    height: '100%',
    maxHeight: '100%',
    // Only the edge that faces the page gets a rule; the other three sit off-screen.
    frame: { borderLeft: '1px solid var(--proto-rule-soft)', borderRadius: 0 },
    shadow: '-24px 0 60px rgba(15,23,42,.30)',
  },
  // SPEC 4.11 on a PHONE. Added 2026-09-02 with the docked desktop panel: the owner asked for a
  // docked panel on wide desktop and "a different approach of your choosing for mobile", and a
  // right-hand drawer is the wrong one there. `drawer` already clamps to `min(680px, 100vw)` so it
  // would not overflow -- it would simply be a full-screen panel that arrives from the side, with
  // its close control and its Send button at the top of a tall column, i.e. furthest from the
  // thumb. The sheet rises from the bottom edge, caps at 85vh so the packet stays visible behind
  // it, and puts its controls in the reachable zone.
  //
  // It is a VARIANT rather than a component: the stack, the scrim, the scroll lock, Escape, focus
  // return and close-on-navigation are all owned by Overlay and none of them differ on a phone.
  // Standing up a second overlay for one edge change is the parallel system this repo forbids.
  sheet: {
    zIndex: 'var(--zindex-overlay)',
    align: 'flex-end',
    justify: 'center',
    padding: 0,
    width: '100vw',
    height: 'auto',
    maxHeight: '85vh',
    // Only the edge that faces the page is drawn, same principle as `drawer`; the corners are
    // rounded on that edge alone so it reads as having risen from off-screen.
    frame: {
      borderTop: '1px solid var(--proto-rule-soft)',
      borderRadius: 'var(--proto-radius) var(--proto-radius) 0 0',
    },
    shadow: '0 -24px 60px rgba(15,23,42,.30)',
  },
  modal: {
    zIndex: 'var(--zindex-modal)',
    align: 'flex-start',
    justify: 'center',
    padding: '6vh 16px',
    width: 'min(560px, 96vw)',
    height: 'auto',
    maxHeight: '88vh',
    frame: { border: '1px solid var(--proto-rule-soft)', borderRadius: 'var(--proto-radius)' },
    shadow: '0 24px 60px rgba(15,23,42,.30)',
  },
}

// Never returns undefined: an unknown/typo'd variant renders as a modal rather than as an
// unstyled, un-dismissable full-screen div.
export const overlayVariant = (variant) => OVERLAY_VARIANTS[variant] || OVERLAY_VARIANTS.modal

// Selector for the elements a focus trap may land on. Excludes negative tabindex and disabled
// controls; `[inert]` subtrees and `aria-hidden` wrappers are filtered by the caller via
// offsetParent, which needs a DOM and therefore is not this module's job.
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Tab-trap arithmetic, kept separate from the DOM so it can be proven. Given how many focusable
// elements the overlay has and which one currently holds focus, return the index Tab (or Shift+Tab)
// should move to — wrapping at both ends so focus can never leave the overlay.
//
// `current` may be -1 (focus is on the panel container itself, which is where it lands on open):
// Tab then goes to the first element and Shift+Tab to the last.
export function wrapFocusIndex(count, current, shift) {
  if (!Number.isInteger(count) || count <= 0) return -1
  const at = Number.isInteger(current) ? current : -1
  if (at < 0) return shift ? count - 1 : 0
  const next = shift ? at - 1 : at + 1
  if (next < 0) return count - 1
  if (next >= count) return 0
  return next
}

// What counts as "the route changed" for close-on-navigation (P8.5).
//
// Derived from the SAME hash the app's router parses (state.jsx `useRoute`), so there is one
// definition of a route in the app, not two. The path segments alone are compared — the query
// string is deliberately EXCLUDED, because a deep-link that targets a field inside the overlay
// (P8.5: "every item carries artifact_id + section_id so any count can open the field") changes
// only the query, and closing the overlay in response would break exactly the flow the rule is
// meant to support. A path change is navigation to another screen or another packet step, which is
// what must never leave an overlay floating over unrelated content.
export const routeKeyOf = (parts) => (Array.isArray(parts) ? parts : []).join('/')
export const hasNavigated = (before, after) => before != null && before !== after

// Unit tests for the Overlay primitive's pure helpers (app/src/overlay.js).
// Node 22's built-in runner, no DOM, no new dependency — the same constraint api/ works under.
//   cd app && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { OVERLAY_VARIANTS, overlayVariant, FOCUSABLE_SELECTOR, wrapFocusIndex, routeKeyOf, hasNavigated } from '../src/overlay.js'

test('every variant resolves to a real, defined --zindex token (no interpolation)', () => {
  // The Pill bug this guards against: a token name built by interpolation yields an invalid
  // declaration that CSS silently drops. Both variants must name a token that actually exists in
  // tokens/fig-tokens.css, and drawer must sit BELOW modal so a modal opened from a drawer stacks
  // above it.
  assert.equal(OVERLAY_VARIANTS.drawer.zIndex, 'var(--zindex-overlay)')
  assert.equal(OVERLAY_VARIANTS.modal.zIndex, 'var(--zindex-modal)')
  for (const v of Object.values(OVERLAY_VARIANTS)) {
    assert.match(v.zIndex, /^var\(--zindex-[a-z]+\)$/)
    assert.ok(!v.zIndex.includes('${'), 'token name must never be interpolated')
  }
})

test('an unknown variant falls back to modal rather than rendering unstyled', () => {
  assert.equal(overlayVariant('drawer'), OVERLAY_VARIANTS.drawer)
  assert.equal(overlayVariant('modal'), OVERLAY_VARIANTS.modal)
  // 'sheet' was this list's example of an unknown variant until 2026-09-02, when it became the
  // assistant's mobile presentation. Swapped for a name nothing will ever claim, rather than
  // dropping the case - the fallback is the reason a typo'd variant renders as a dialog instead of
  // throwing, which is exactly the silent failure this test exists to pin.
  assert.equal(overlayVariant('sheet'), OVERLAY_VARIANTS.sheet)
  for (const bad of ['sheeet', 'popover', '', null, undefined, 'Drawer']) {
    assert.equal(overlayVariant(bad), OVERLAY_VARIANTS.modal)
  }
})

test('both variants are clamped to the viewport on a narrow screen', () => {
  // A fixed 680px drawer overflows a 390px phone; min() is what prevents it.
  assert.match(OVERLAY_VARIANTS.drawer.width, /^min\(.*,\s*100vw\)$/)
  assert.match(OVERLAY_VARIANTS.modal.width, /^min\(.*,\s*96vw\)$/)
  // The sheet spans the full width by design - it rises from the bottom edge, so the axis that can
  // overflow is the VERTICAL one, and 85vh is what keeps the packet visible behind it.
  assert.equal(OVERLAY_VARIANTS.sheet.width, '100vw')
  assert.match(OVERLAY_VARIANTS.sheet.maxHeight, /vh$/)
  assert.ok(parseInt(OVERLAY_VARIANTS.sheet.maxHeight, 10) <= 90,
    'a sheet taller than 90vh is a full-screen takeover, not a sheet')
  assert.equal(OVERLAY_VARIANTS.drawer.maxHeight, '100%')
  assert.equal(OVERLAY_VARIANTS.modal.maxHeight, '88vh')
})

test('variant colours come from tokens only — no raw hex/rgb backgrounds', () => {
  for (const v of Object.values(OVERLAY_VARIANTS)) {
    const frame = JSON.stringify(v.frame)
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(frame), 'frame must not carry a literal colour')
    assert.match(frame, /var\(--proto-rule-soft\)/)
  }
})

test('wrapFocusIndex traps Tab inside the overlay by wrapping at both ends', () => {
  assert.equal(wrapFocusIndex(3, 0, false), 1)
  assert.equal(wrapFocusIndex(3, 1, false), 2)
  assert.equal(wrapFocusIndex(3, 2, false), 0)   // forward off the end wraps to the first
  assert.equal(wrapFocusIndex(3, 0, true), 2)    // backward off the start wraps to the last
  assert.equal(wrapFocusIndex(3, 2, true), 1)
})

test('wrapFocusIndex handles focus sitting on the panel itself (index -1)', () => {
  assert.equal(wrapFocusIndex(3, -1, false), 0)  // Tab from the panel enters at the first control
  assert.equal(wrapFocusIndex(3, -1, true), 2)   // Shift+Tab enters at the last
})

test('wrapFocusIndex degrades safely when there is nothing focusable', () => {
  assert.equal(wrapFocusIndex(0, -1, false), -1)
  assert.equal(wrapFocusIndex(-2, 0, false), -1)
  assert.equal(wrapFocusIndex(null, 0, false), -1)
})

test('the focusable selector excludes disabled controls and tabindex="-1"', () => {
  assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'))
  assert.ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'))
  assert.ok(!/(^|,)\s*button\s*(,|$)/.test(FOCUSABLE_SELECTOR), 'bare button would catch disabled ones')
})

test('routeKeyOf is the hash PATH — a screen or packet step change is navigation', () => {
  // parts come straight from state.jsx useRoute()
  assert.equal(routeKeyOf(['packet', 'abc', 'jd']), 'packet/abc/jd')
  assert.equal(routeKeyOf(['today']), 'today')
  assert.equal(routeKeyOf([]), '')
  assert.equal(routeKeyOf(undefined), '')

  assert.equal(hasNavigated(routeKeyOf(['packet', 'abc', 'jd']), routeKeyOf(['packet', 'abc', 'cover'])), true, 'step change closes')
  assert.equal(hasNavigated(routeKeyOf(['packet', 'abc', 'jd']), routeKeyOf(['today'])), true, 'screen change closes')
  assert.equal(hasNavigated(routeKeyOf(['packet', 'abc', 'jd']), routeKeyOf(['packet', 'xyz', 'jd'])), true, 'different packet closes')
})

test('a query-only change is NOT navigation — deep-linking into the overlay must not close it', () => {
  // useRoute() splits the query off before producing `parts`, so #/packet/abc/jd?field=summary and
  // #/packet/abc/jd yield the same parts. P8.5 deep-links a count to a field inside the overlay;
  // closing on that would break the flow the rule exists to enable.
  assert.equal(hasNavigated(routeKeyOf(['packet', 'abc', 'jd']), routeKeyOf(['packet', 'abc', 'jd'])), false)
})

test('hasNavigated needs a recorded baseline — no close before the overlay has opened', () => {
  assert.equal(hasNavigated(null, 'today'), false)
  assert.equal(hasNavigated(undefined, 'today'), false)
  assert.equal(hasNavigated('', 'today'), true)   // '' is a real route (#/), not "unset"
})

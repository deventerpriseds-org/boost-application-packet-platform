import { useEffect, useRef } from 'react'

// ONE implementation of "a deep link named this field — put it in front of the reader".
//
// Two screens now land on a field from elsewhere: the per-asset QC drawer's Blocks tab, and the
// asset step itself (a finding's "go to the draft"). Before this module the drawer carried the only
// copy, and the obvious way to add the second one was to paste it. That is exactly how two screens
// come to disagree about the same gesture — the repo has already paid for that with a KIND_ABBR
// defined twice and a compact-resume label defined three times.
//
// THE RING DOES NOT AUTO-CLEAR, and that is deliberate rather than unfinished. An earlier note
// described the prototype's ring as "clears after 2200ms"; that note documented a MOCKUP, not a
// requirement — SPEC says nothing about ring timing. This codebase has twice removed exactly that
// pattern for exactly this reason:
//   PacketBuilder.jsx  "The run result strip. It persists; the toast it replaces vanished after
//                       2.2s, which is why..."
//   PostingAnalysis.jsx "The result strip persists. A toast that disappears in 2.2s is not evidence
//                        a run happened."
// A reader who follows a link, gets interrupted, and looks back must still be able to see which
// field they were sent to. The ring clears when the focus does, not on a timer.

/**
 * Attach the returned ref to the element the deep link names. It is scrolled into view whenever the
 * focus key changes, or when the data it points into arrives (a link can resolve before the rows do,
 * and scrolling to an element that does not exist yet silently does nothing).
 *
 * @param {string|null|undefined} focusKey  the field this view was asked to show, or falsy for none
 * @param {Array} deps                      values whose arrival can make the target element appear
 */
export function useScrollToFocus(focusKey, deps = []) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    // `scrollIntoView` is guarded rather than assumed: these components are exercised under the
    // DOM probe in app/test/browser, where a stubbed element may not carry it.
    if (focusKey && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ...deps])
  return ref
}

/** The ring itself, as a style value. Inset so it never shifts layout on the card it marks. */
export const FOCUS_RING = 'inset 0 0 0 2px var(--border-brand)'

/** `boxShadow` for a row, given whether it is the focused one. Undefined leaves the card's own. */
export const focusRingStyle = (isFocused) => (isFocused ? FOCUS_RING : undefined)

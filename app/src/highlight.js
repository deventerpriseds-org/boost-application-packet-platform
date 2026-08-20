// D11 — the two in-text highlight treatments, named once.
//
// Pure data. No React import, no DOM: `node --test` imports this directly, and so does every
// component that paints a highlight. It exists for the same reason qcRail.js's QC_HOOKS does — a
// name that three files hand-type is a name that drifts, and here the thing that drifts is a
// COLOUR, which fails silently. CSS drops a declaration it cannot parse without a word of warning,
// so `var(--qc-kw-${tone})` renders as "no highlight at all" rather than as an error.
//
// WHY THESE ARE TOKEN PAIRS AND NOT LITERALS
// The design handoff says to carry #fff03a (keyword) and #fbf2da / #c9b27a (posting echo)
// verbatim. Carried as literals in a component they break the moment the app goes dark: the
// background stays yellow, the text keeps inheriting --proto-ink, and --proto-ink in dark mode is
// near-white. Near-white on #fff03a is unreadable. So each highlight ships its BACKGROUND and its
// own FOREGROUND together, defined on :root and redefined under .proto-dark (app/src/theme.css).
//
// The classes below are the only supported way to paint either one. They are also deliberately
// different KINDS of treatment, per P8.7: a keyword is a filled highlight, a posting echo is a pale
// wash under a rule. Two treatments that differ only in hue are one treatment to a reader who
// cannot distinguish those hues.

/** The custom properties each treatment resolves through. Asserted against theme.css by the tests. */
export const HIGHLIGHT_TOKENS = {
  keyword: ['--qc-kw-bg', '--qc-kw-fg'],
  postingEcho: ['--qc-echo-bg', '--qc-echo-rule'],
}

/** The class a component puts on the span. Never a colour typed into a style object. */
export const HIGHLIGHT_CLASS = {
  keyword: 'qc-kw',
  postingEcho: 'qc-echo',
}

/**
 * Every swatch these two treatments resolve to, light and dark. theme.css is the only file allowed
 * to contain them; the guard that enforces that reads the list from HERE, so a swatch added to the
 * stylesheet and then pasted into a component cannot quietly escape the grep. The first three are
 * the handoff's own values, named in D11 as the literals that must NOT appear in a component.
 */
export const HIGHLIGHT_LITERALS = [
  '#fff03a', '#fbf2da', '#c9b27a',   // light: keyword bg, echo wash, echo rule (the handoff's)
  '#2b2607',                         // light: keyword ink
  '#d9c34a', '#1c1804',              // dark: keyword bg, keyword ink
  '#2e2716', '#8a7748',              // dark: echo wash, echo rule
]

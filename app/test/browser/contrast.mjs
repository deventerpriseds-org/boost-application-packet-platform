// ONE definition of "is this ink readable on that ground", shared by every browser probe.
//
// It lived only in run.mjs, whose harness page renders the overlay primitive and the highlight
// tokens - so any surface NOT on that page could only be argued about. A contrast number taken from
// a page that does not render the thing proves nothing about the thing, and a second copy of the
// formula in the probe that does render it is how two harnesses come to disagree about what 4.5:1
// means. So the formula moved here and both import it.
//
// WCAG relative luminance, over getComputedStyle values - the only way to say "readable" rather than
// "these two strings differ", which is all a colour-vs-colour comparison proves.
export const parseRgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number)

export const lum = (c) => {
  const [r, g, b] = parseRgb(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// ── Alpha, and why compositing belongs HERE and not in a caller ─────────────────────────────────
// A colour with partial alpha is not the colour that gets painted. `getComputedStyle` hands back
// `rgba(193, 91, 60, 0.14)` for a temperature chip's tint; measuring ink against THAT is measuring
// against a colour no pixel ever holds. Worse, the failure is asymmetric: an unresolved or fully
// transparent background reads as a near-21:1 ratio against dark ink, i.e. a measurement failure
// wearing a pass. So compositing is part of "what does this land on", which is what this module is
// for, and every probe gets the same answer.
export const alphaOf = (c) => { const m = String(c).match(/[\d.]+/g) || []; return m.length > 3 ? Number(m[3]) : 1 }

/** Paint `fg` (possibly rgba) over opaque `bg`, returning the opaque colour actually shown. */
export const composite = (fg, bg) => {
  const a = alphaOf(fg)
  if (a >= 1) return fg
  const f = parseRgb(fg), b = parseRgb(bg)
  if (f.length < 3 || b.length < 3) return fg
  return `rgb(${[0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a))).join(', ')})`
}

/** WCAG 2.1 large text: >= 24px, or >= 18.66px at weight >= 700. Everything else is normal text. */
export const isLargeText = (px, weight) =>
  Number(px) >= 24 || (Number(px) >= 18.66 && Number(weight) >= 700)

/** The AA threshold a piece of text must clear, derived from MEASURED metrics — never assumed. */
export const thresholdFor = (px, weight) => (isLargeText(px, weight) ? 3.0 : 4.5)

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

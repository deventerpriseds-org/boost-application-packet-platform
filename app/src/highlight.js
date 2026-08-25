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
 * Added ALONGSIDE a HIGHLIGHT_CLASS when the reader is pointing at that phrase from the margin.
 *
 * Exported from here rather than typed in the component for the same reason the colours are: the
 * name is shared by the stylesheet, the component and the DOM probe, and three copies of a string
 * is how they come to disagree. It carries NO new colour — the treatment is an outline in
 * `--border-brand`, a token the focus ring already uses — which is deliberate: a new swatch would
 * have to be registered in HIGHLIGHT_LITERALS below and cleared through the contrast sweep in both
 * themes, and there is no reader benefit here that a second hue would buy.
 */
export const HIGHLIGHT_ACTIVE_CLASS = 'qc-mark-on'

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

/**
 * Split TEXT into segments, marking every occurrence of one of PHRASES.
 *
 * THE GAP THIS CLOSES. The prototype marks posting echoes inside the draft itself (`Marked`,
 * `qc/assets.jsx:8`); the app had both treatments built and painted them ONLY in margin quotes and
 * on the JD step — every `HIGHLIGHT_CLASS` call site was one of those, and `BlockBody` rendered
 * `row.after_text` as a bare string. So the whole provenance margin was a set of pointers into a
 * sentence that was never marked: "Wording kept from the posting: safety-critical" with nothing in
 * the draft to look at.
 *
 * EXACT, WHOLE-PHRASE, CASE-INSENSITIVE — never fuzzy. A highlight is an ACCUSATION ("these words
 * came from the employer's ad"), and this repo's standing rule reserves similarity for RANKING. A
 * near-miss here would paint the writer's own sentence as borrowed, which is worse than painting
 * nothing. Case is ignored because the generator re-cases phrases at a sentence start; nothing else
 * is normalised.
 *
 * LONGEST PHRASE FIRST, then non-overlapping. Given `safety-critical` and `safety-critical systems`
 * the shorter one would otherwise consume the head of the longer and leave ` systems` unmarked,
 * splitting one echo into a marked and an unmarked half.
 *
 * Returns `[{ t, mark }]` — `mark` is a HIGHLIGHT_CLASS key or null. Always covers the whole input,
 * so a caller can render the segments and get the original text back verbatim.
 */
export function markRuns(text, phrases, mark = 'postingEcho') {
  const s = String(text == null ? '' : text)
  if (!s) return []
  // A phrase entry may be a plain string (marked with the default `mark`) or `{ phrase, mark }`.
  // TWO TREATMENTS, ONE MATCHER, and that is the point: the field's draft carries both posting
  // echoes and proposed keywords, and running two passes over the same text would let them disagree
  // about overlaps — the longest-first, non-overlapping rule below is global or it is nothing. A
  // second matcher deciding what a highlight points at is exactly what this file exists to prevent.
  //
  // `raw` is carried beside the trimmed needle so a marked run can name WHICH phrase produced it,
  // and name it as the caller's own array element (===-comparable), not as a trimmed copy. That is
  // what lets a hover link the margin row to its span without re-searching the text: re-finding the
  // phrase downstream would be a second matcher, and a highlight is an accusation, so this file is
  // the only place allowed to decide what matched.
  const list = (Array.isArray(phrases) ? phrases : [])
    .map((e) => {
      const isObj = e && typeof e === 'object' && !Array.isArray(e)
      const raw = isObj ? e.phrase : e
      return { raw, mark: (isObj && e.mark) || mark, needle: String(raw == null ? '' : raw).trim() }
    })
    .filter((x) => x.needle.length > 1)
    .sort((a, b) => b.needle.length - a.needle.length)
  if (!list.length) return [{ t: s, mark: null, phrase: null }]

  const lower = s.toLowerCase()
  const taken = []                                  // [start, end, rawPhrase, mark) already claimed
  const free = (a, b) => taken.every(([x, y]) => b <= x || a >= y)
  // WHOLE-WORD, and this is the line that makes the docstring above true rather than aspirational.
  // Until 2026-08-25 this was a bare substring search while the comment claimed "EXACT, WHOLE-PHRASE
  // ... never fuzzy". MEASURED against the real function: the needle "AI" marked THREE times in
  // "Led a team that said the detail was available." (said, detail, available); "ML" matched inside
  // "HTML"; "Java" matched inside "JavaScript". It never bit only because the sole caller passes
  // multi-word posting-echo runs - and short needles are exactly what an ATS keyword is, so the next
  // caller would have shipped a false accusation on the reader's own sentence.
  // A word character is alphanumeric ONLY: a phrase may legitimately begin or end against '-', '&'
  // or '/', which is what keeps "safety-critical systems", "P&L" and "AI/ML" matching.
  const wordChar = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch)
  const bounded = (a, b) => !wordChar(s[a - 1]) && !wordChar(s[b])
  for (const { raw, mark: m, needle: p } of list) {
    const needle = p.toLowerCase()
    let from = 0
    for (;;) {
      const i = lower.indexOf(needle, from)
      if (i < 0) break
      const j = i + needle.length
      if (bounded(i, j) && free(i, j)) taken.push([i, j, raw, m])
      from = i + 1                                  // +1, not +len: an overlapped hit may still
    }                                               // start a valid later one
  }
  if (!taken.length) return [{ t: s, mark: null, phrase: null }]

  taken.sort((a, b) => a[0] - b[0])
  const out = []
  let at = 0
  for (const [a, b, raw, m] of taken) {
    if (a > at) out.push({ t: s.slice(at, a), mark: null, phrase: null })
    out.push({ t: s.slice(a, b), mark: m, phrase: raw })
    at = b
  }
  if (at < s.length) out.push({ t: s.slice(at), mark: null, phrase: null })
  return out
}

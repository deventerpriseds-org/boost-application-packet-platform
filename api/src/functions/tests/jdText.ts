// ONE canonical normalization for posting text. Every consumer that matches, scores, quotes or
// offsets against a job posting must go through here, or they will disagree about what the posting
// even says.
//
// Why this exists (measured, not theoretical): `opportunity.jd_real` stores `descriptionHtml`
// (jdBackfill.ts), so ampersands arrive HTML-ENCODED. The previous normalization stripped tags but
// never decoded entities, so the literal string "P&amp;L" was fed to the scorer. Across the live
// corpus that is 872 of 1,230 real postings (71%) containing `&amp;`, and "P&L" reads as present in
// 83 postings but matched in ZERO. Every &-term was invisible: P&L, M&A, R&D, "Risk & Compliance".

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
  hellip: '...', bull: '*', middot: '*', reg: '', copy: '', trade: '',
}

/** Decode HTML entities. Runs twice: some rows are double-encoded (`&amp;amp;`). */
export function decodeEntities(input: string): string {
  const once = (s: string) => s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name.toLowerCase() in NAMED ? NAMED[name.toLowerCase()] : m))
  return once(once(input))
}

/**
 * Tags out, entities decoded, whitespace collapsed. This is the string that offsets, quotes and
 * keyword matches are all resolved against.
 */
export function normalizePostingText(html: any): string {
  if (!html) return ''
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim()
}

/**
 * The posting text to ground against for one opportunity: the real posting when we have it, else
 * the parsed summary/requirements. Used by BOTH scorers so they cannot disagree.
 */
export function groundingText(opp: any): string {
  return normalizePostingText(opp?.jd_real)
    || normalizePostingText([opp?.jd_summary, opp?.jd_requirements].filter(Boolean).join('\n'))
}

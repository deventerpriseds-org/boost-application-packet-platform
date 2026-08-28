// ONE canonical normalization for posting text. Every consumer that matches, scores, quotes or
// offsets against a job posting must go through here, or they will disagree about what the posting
// even says.
//
// Why this exists (measured, not theoretical): `opportunity.jd_html` stores `descriptionHtml`
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
 * Characters outside the Basic Multilingual Plane — emoji, mostly, which postings use decoratively
 * ("Join our rocket ship 🚀"). Each one is TWO UTF-16 code units in JavaScript but ONE character in
 * Postgres, so a `char_start` measured with `String.prototype.slice` does not address the same place
 * as `substring(jd_posting_snapshot from char_start+1)`. Measured: 63 of 3,090 requirement rows (2%) failed the
 * SQL re-verification for exactly this reason, on postings where `octet_length` exceeded `length`.
 *
 * Replacing each with a single space makes the two indexings identical, which is what lets one SQL
 * statement re-verify every stored offset. Nothing is lost: an emoji is never part of a requirement.
 * Lone surrogates are stripped too — they are invalid on their own and break the same invariant.
 */
const ASTRAL = /[\u{10000}-\u{10FFFF}]/gu
const LONE_SURROGATE = /[\uD800-\uDFFF]/g

/**
 * Tags out, entities decoded, astral characters folded, whitespace collapsed. This is the string
 * that offsets, quotes and keyword matches are all resolved against.
 *
 * Invariant this guarantees: `[...text].length === text.length`, so a JavaScript index and a
 * Postgres character index address the same position.
 */
export function toBmp(text: string): string {
  return String(text).replace(ASTRAL, ' ').replace(LONE_SURROGATE, ' ')
}

export function normalizePostingText(html: any): string {
  if (!html) return ''
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(ASTRAL, ' ').replace(LONE_SURROGATE, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The posting text to ground against for one opportunity: the real posting when we have it, else
 * the parsed summary/requirements. Used by BOTH scorers so they cannot disagree.
 */
export function groundingText(opp: any): string {
  return normalizePostingText(opp?.jd_html)
    || normalizePostingText([opp?.jd_summary, opp?.jd_requirements].filter(Boolean).join('\n'))
}

/** A LinkedIn alert digest is a mail about MANY jobs — never a single posting. */
export function isAlertDigest(rawJd: string, whySurfaced: string): boolean {
  const s = (rawJd || '').slice(0, 600).toLowerCase()
  const w = (whySurfaced || '').toLowerCase()
  return s.includes('jobalerts-noreply@linkedin.com') || s.includes('new linkedin alert') || w.includes('linkedin alert')
}

/**
 * The EMPLOYER'S OWN text for one opportunity, and which column it came from.
 *
 * Distinct from `groundingText()` on purpose. `groundingText` falls back to `jd_summary` /
 * `jd_requirements`, which are MODEL OUTPUT — fine for keyword matching, fatal for evidence:
 * a character offset into the model's own summary quotes the model, not the employer. Anything
 * that records offsets or quotes must use THIS function and accept `source:null` when the real
 * posting is absent (116 of the 1,349 parsed opportunities, measured 2026-08-19).
 */
export function resolvePostingSource(opp: any): { text: string; source: 'jd_html' | 'jd_posting_raw' | null } {
  const real = normalizePostingText(opp?.jd_html)
  if (real) return { text: real, source: 'jd_html' }
  const raw = opp?.jd_posting_raw || ''
  // jd_posting_raw skips the HTML normalizer, so fold astral characters here or its offsets stop being
  // addressable from SQL — the same invariant normalizePostingText guarantees for jd_html.
  if (raw && !isAlertDigest(raw, opp?.why_surfaced || '')) return { text: toBmp(raw), source: 'jd_posting_raw' }
  return { text: '', source: null }
}

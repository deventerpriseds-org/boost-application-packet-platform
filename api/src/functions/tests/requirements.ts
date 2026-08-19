// P1.1 — the requirement rows. One row per line the employer actually asked for, each one
// anchored to a character range in the real posting so every downstream claim can be re-read
// at its source.
//
// GROUND TRUTH THAT SHAPED THIS (measured 2026-08-19, not assumed):
// `opportunity.jd_table` is a model-generated `<table>` of Category | Item | ATS Keyword — 1349 of
// 1821 opportunities have one. Reading real rows shows the Item column is a PARAPHRASE, not a quote:
//   "Lead the operational performance of the renewable-generation portfolio."
// The backlog's acceptance ("each row's verbatim is a substring of jd_real at its offsets") is
// therefore NOT satisfiable by storing Items — a paraphrase has no offsets in the posting.
//
// So the Item is kept as `paraphrase`, and `verbatim` is resolved back to the posting's OWN words by
// locating the span the paraphrase was derived from. `verbatim` is then a literal substring of
// `groundingText(opp)` at [char_start, char_end) by construction, and a row that cannot be located
// says so (`match_method='unlocated'`, null offsets) instead of quoting text the employer never wrote.
//
// Nothing here calls a model. Re-running it on unchanged inputs produces identical rows.
import { createHash } from 'node:crypto'
import { normalizePostingText, resolvePostingSource } from './jdText'

export type Kind = 'must_have' | 'nice_to_have' | 'responsibility'
export type MatchMethod =
  | 'exact'                 // the paraphrase appears literally in the posting
  | 'anchored'              // the densest span covering >= ANCHOR_THRESHOLD of its content words
  | 'unlocatable'           // nothing reached the threshold, though a posting was available
  | 'beyond_model_window'   // unlocatable AND the posting is longer than the parser ever saw
  | 'no_posting'            // no employer text exists to offset into at all
export type KindSource = 'posting_optional_marker' | 'category' | 'category_default' | 'fallback'

/** Bump when the extraction rules change, so rows made under old rules are identifiable. */
export const EXTRACTOR_VERSION = 1

export interface JdTableRow { category: string; item: string; keyword: string }

export interface RequirementRow {
  item_text: string           // what the MODEL wrote (jd_table Item). Never presented as a quote.
  verbatim: string | null     // the POSTING's own words at [char_start, char_end). null when unlocated.
  char_start: number | null
  char_end: number | null
  match_method: MatchMethod
  kind: Kind
  kind_source: KindSource     // why this kind — so a defaulted kind is visible, not hidden
  model_keyword: string | null // jd_table's ATS Keyword. MODEL-GENERATED: a P1.2 candidate, never scoreable.
  competency: null            // resolved by the term library (P1.2). Nothing here may fill it.
  coverage: 'escalated' | null // never 'covered'/'partial' — no evidence engine exists yet (P2/P3)
  weight: number              // 1..3
  source_category: string     // the raw jd_table Category, kept so a remap is auditable
  extractor_version: number
}

// --- jd_table parsing -------------------------------------------------------------------------

/** Strip tags from ONE cell and decode entities. Cell text only — never the whole document. */
function cellText(html: string): string {
  return normalizePostingText(html)
}

/**
 * Parse the `<table>` produced by appJdParse's JD_SYSTEM prompt into rows.
 * Tolerant by design: the header row is skipped by shape (it uses <th>), attributes are allowed,
 * a truncated final row is dropped rather than half-read, and rows with fewer than 2 cells are
 * ignored. Returns [] for null/empty/malformed input — never throws.
 */
export function parseJdTable(html: any): JdTableRow[] {
  if (!html) return []
  const s = String(html)
  const out: JdTableRow[] = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(s)) !== null) {
    const inner = m[1]
    if (/<th\b/i.test(inner)) continue           // header row
    const cells: string[] = []
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
    let c: RegExpExecArray | null
    while ((c = cellRe.exec(inner)) !== null) cells.push(cellText(c[1]))
    if (cells.length < 2) continue
    const category = (cells[0] || '').toLowerCase().trim()
    const item = (cells[1] || '').trim()
    if (!item) continue
    // The model sometimes repeats the header inside <tbody> using <td>. Shape alone would let it
    // through as a requirement reading "Item".
    if (category === 'category' && /^item$/i.test(item)) continue
    out.push({ category, item, keyword: (cells[2] || '').trim() })
  }
  return out
}

// --- kind ------------------------------------------------------------------------------------

// The prompt's Category enum is responsibilities | experience | requirements | skills. It has NO
// nice_to_have, so that kind CANNOT come from the model — it is read off the posting itself, from
// the words the employer used near the requirement. That is deterministic and it backfills the 1349
// already-parsed rows without re-running a single model call.
const OPTIONAL_RE = /\b(preferred|preferable|preferably|nice[- ]to[- ]have|a plus|bonus|desirable|desired|ideally|advantageous|not required|would be great)\b/i

const REQUIRED_RE = /\b(must have|must be|required|requirement|minimum|at least|you have|proven)\b/i

const CATEGORY_KIND: Record<string, Kind> = {
  responsibilities: 'responsibility',
  responsibility: 'responsibility',
  experience: 'must_have',
  requirements: 'must_have',
  requirement: 'must_have',
  skills: 'must_have',
  skill: 'must_have',
}

/**
 * Map a jd_table Category to a kind, then let the posting's own wording downgrade it to
 * `nice_to_have`. `context` is the posting text around the located span (the section heading that
 * says "Preferred qualifications" usually sits BEFORE the bullet, which is why a window is used and
 * not the bullet alone). Responsibilities are never downgraded — an optional duty is still a duty.
 * Unknown categories fall back to must_have rather than null: zero rows may have a null kind.
 */
export function mapKind(category: string, context: string): { kind: Kind; kind_source: KindSource } {
  const key = (category || '').toLowerCase().trim()
  const base = CATEGORY_KIND[key]
  // Unknown Category (model drift, casing, a new value) must still produce a kind — zero rows may
  // be null. It falls back to `responsibility`, the WEAKEST claim, so drift can never silently
  // invent hard requirements.
  if (base === undefined) return { kind: 'responsibility', kind_source: 'fallback' }
  if (base === 'responsibility') return { kind: 'responsibility', kind_source: 'category' }
  if (OPTIONAL_RE.test(context || '')) return { kind: 'nice_to_have', kind_source: 'posting_optional_marker' }
  if (REQUIRED_RE.test(context || '')) return { kind: 'must_have', kind_source: 'category' }
  // The posting said neither "preferred" nor "required". The enum has no neutral member, so the
  // category's default stands — but `kind_source` records that nothing in the posting asserted it,
  // and `weight` stays 2 rather than 3. A reader can filter these out; they are not disguised.
  return { kind: 'must_have', kind_source: 'category_default' }
}

// --- locating the paraphrase in the posting ----------------------------------------------------

const LOC_STOP = new Set(('a an the and or but of in on at to for with without by from as is are was were be been being ' +
  'this that these those it its we you they our your their will would can could should may might must ' +
  'do does did have has had not no so than such very more most other some any each all both ' +
  'who whom whose which what when where why how there here about into over under across within while ' +
  'during before after above below between through per via up down out off').split(/\s+/))

interface Tok { t: string; s: number; e: number }

/** Tokenize with char offsets into the ORIGINAL string, so a span maps straight back to it. */
function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  const re = /[A-Za-z0-9][A-Za-z0-9'+#.\-]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ t: m[0].toLowerCase().replace(/[.'-]+$/, ''), s: m.index, e: m.index + m[0].length })
  return out.filter(x => x.t.length > 0)
}

const contentTokens = (text: string) =>
  tokenize(text).map(x => x.t).filter(t => !LOC_STOP.has(t) && !/^\d+$/.test(t))

/** Minimum share of a paraphrase's content words that must appear in a span to call it the source. */
export const ANCHOR_THRESHOLD = 0.6

export interface Span { start: number; end: number }

const overlaps = (a: Span, taken: Span[]) => taken.some(t => a.start < t.end && t.start < a.end)

/**
 * Find where in `postingText` the paraphrase came from.
 *  - `exact`       — the paraphrase appears literally (common for "10+ years of ..." lines).
 *  - `anchored`    — the densest span covering >= ANCHOR_THRESHOLD of its content words.
 *  - `unlocatable` — nothing reached the threshold. Offsets null, verbatim null. The row is STILL
 *                    returned by the caller: dropping it would shrink the requirement count
 *                    silently, and an unlocatable requirement is exactly what a reviewer needs.
 *
 * `taken` are spans already claimed by earlier rows. A posting that repeats a bullet under both
 * "Responsibilities" and "What you'll do" yields two table rows; without this they would both
 * resolve to the same `indexOf` hit and one quote would be double-counted as two pieces of
 * evidence. Passing `taken` in row order keeps the result deterministic.
 *
 * In every located case the returned verbatim is exactly `postingText.slice(char_start, char_end)`.
 */
export function locate(paraphrase: string, postingText: string, taken: Span[] = []): {
  verbatim: string | null; char_start: number | null; char_end: number | null; match_method: MatchMethod
} {
  const miss = { verbatim: null, char_start: null, char_end: null, match_method: 'unlocatable' as MatchMethod }
  if (!paraphrase || !postingText) return miss

  // 1. exact — scan every occurrence, take the first not already claimed.
  const needle = paraphrase.trim().replace(/[.;:,]+$/, '')
  if (needle.length >= 8) {
    const hay = postingText.toLowerCase()
    const nee = needle.toLowerCase()
    for (let i = hay.indexOf(nee); i >= 0; i = hay.indexOf(nee, i + 1)) {
      const span = { start: i, end: i + needle.length }
      if (overlaps(span, taken)) continue
      return { verbatim: postingText.slice(span.start, span.end), char_start: span.start, char_end: span.end, match_method: 'exact' }
    }
  }

  // 2. anchored — sweep only the positions where the paraphrase's own words occur.
  const want = new Set(contentTokens(paraphrase))
  if (want.size === 0) return miss
  const toks = tokenize(postingText)
  const hits: Array<{ i: number; t: string }> = []
  // Tokens already claimed by an earlier row are removed BEFORE the sweep, not filtered after it.
  // Filtering after is not equivalent: every window reaching a later occurrence would still be
  // anchored on a claimed token and get rejected, so the repeat would read as unlocatable.
  for (let i = 0; i < toks.length; i++) {
    if (!want.has(toks[i].t)) continue
    if (overlaps({ start: toks[i].s, end: toks[i].e }, taken)) continue
    hits.push({ i, t: toks[i].t })
  }
  if (hits.length === 0) return miss

  // Window measured in posting tokens: the source sentence is usually longer than the paraphrase.
  const span = Math.max(Math.round(tokenize(paraphrase).length * 1.8), want.size + 6)
  let best: { cov: number; span: Span } | null = null
  let lo = 0
  const counts = new Map<string, number>()
  for (let hi = 0; hi < hits.length; hi++) {
    counts.set(hits[hi].t, (counts.get(hits[hi].t) || 0) + 1)
    while (hits[hi].i - hits[lo].i > span) {
      const n = (counts.get(hits[lo].t) || 0) - 1
      if (n <= 0) counts.delete(hits[lo].t); else counts.set(hits[lo].t, n)
      lo++
    }
    const cov = counts.size / want.size
    const cand: Span = { start: toks[hits[lo].i].s, end: toks[hits[hi].i].e }
    if (cov >= ANCHOR_THRESHOLD && !overlaps(cand, taken) && (!best || cov > best.cov)) best = { cov, span: cand }
  }
  if (!best) return miss

  return {
    verbatim: postingText.slice(best.span.start, best.span.end),
    char_start: best.span.start, char_end: best.span.end, match_method: 'anchored',
  }
}

// --- weight ----------------------------------------------------------------------------------

const HARD_RE = /\b(must|required|require|minimum|at least|\d+\+?\s*years|proven track record)\b/i

/** 3 = hard gate, 2 = stated requirement, 1 = duty or optional. Deterministic from the text. */
export function weightFor(kind: Kind, text: string): number {
  if (kind === 'nice_to_have') return 1
  if (kind === 'responsibility') return 1
  return HARD_RE.test(text || '') ? 3 : 2
}

// --- assembly --------------------------------------------------------------------------------

/** Characters of posting shown to the JD parser (appJdParse `rawJd.slice(0, 12000)`). */
export const MODEL_WINDOW = 12000

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

export interface BuildResult {
  rows: RequirementRow[]
  jd_text: string              // the EXACT string every offset indexes. Persist it, or offsets rot.
  jd_text_sha256: string       // lets a single SQL statement prove a row still matches its posting
  jd_source: 'jd_real' | 'raw_jd' | null
  posting_truncated: boolean   // posting is longer than the JD parser was ever shown
  located: number              // rows with real offsets
  located_rate: number         // 0..1 — the honest measure of how much of this posting is evidenced
}

/**
 * Build the requirement rows for one opportunity row (as selected from `opportunity`).
 *
 * Offsets index `jd_text`, which is the EMPLOYER'S text (`resolvePostingSource`) and never
 * `jd_summary`/`jd_requirements`. When no employer text exists — 116 of the 1,349 parsed
 * opportunities — every row is `no_posting` with null offsets, rather than quoting the model's own
 * summary back at the reviewer as if the employer had written it.
 *
 * Deterministic: no model call, and re-running on the same input yields identical rows.
 */
export function buildRequirements(opp: any): BuildResult {
  const parsed = parseJdTable(opp?.jd_table)
  const { text: jdText, source } = resolvePostingSource(opp)
  const truncated = jdText.length > MODEL_WINDOW
  const taken: Span[] = []

  const rows: RequirementRow[] = parsed.map(r => {
    const loc = source
      ? locate(r.item, jdText, taken)
      : { verbatim: null, char_start: null, char_end: null, match_method: 'no_posting' as MatchMethod }

    let method = loc.match_method
    if (method === 'unlocatable' && truncated) method = 'beyond_model_window'
    if (loc.char_start !== null && loc.char_end !== null) taken.push({ start: loc.char_start, end: loc.char_end })

    // A section heading ("Preferred qualifications:") sits BEFORE the bullet, so read a window back
    // through the posting. With no located span there is no posting context to read — fall back to
    // the model's own item text, and `kind_source` will record that the category defaulted.
    const context = loc.char_start === null
      ? r.item
      : `${jdText.slice(Math.max(0, loc.char_start - 400), loc.char_end as number)} ${r.item}`
    const { kind, kind_source } = mapKind(r.category, context)

    return {
      item_text: r.item,
      verbatim: loc.verbatim,
      char_start: loc.char_start,
      char_end: loc.char_end,
      match_method: method,
      kind,
      kind_source,
      model_keyword: r.keyword || null,
      competency: null,
      coverage: loc.char_start === null ? 'escalated' as const : null,
      weight: weightFor(kind, loc.verbatim || r.item),
      source_category: r.category,
      extractor_version: EXTRACTOR_VERSION,
    }
  })

  const located = rows.filter(r => r.char_start !== null).length
  return {
    rows, jd_text: jdText, jd_text_sha256: sha256(jdText), jd_source: source,
    posting_truncated: truncated, located, located_rate: rows.length ? located / rows.length : 0,
  }
}

// P8.2 / R3 — a generated document must never quote the POSTING's figures back as if they were the
// candidate's.
//
// The failure is specific and it reads as a strength. A posting says "manage a $18M portfolio across
// three business units"; the resume comes back claiming "$18M portfolio, three business units". No
// rule was broken that any length or wording check would catch — the numbers are real, they are
// well-formed, and they are the employer's. To a hiring manager they are a lie, and to the candidate
// they are indefensible in an interview.
//
// This module only MEASURES. It decides nothing about what to write; `scanEcho` returns what it
// found and why, and the caller decides. Pure by construction: no @azure/functions, no pg, no
// network, so `node --test` can exercise every branch.
import { normalizePostingText } from './jdText'

export const ECHO_VERSION = 1

/** A number as it appears in text, with the span it occupied. */
export interface Figure {
  /** The literal as written: "$18M", "60+", "three", "400+". */
  raw: string
  /** A comparable key, so "$18M" and "$18 million" collide and "60" and "60+" do not. */
  key: string
  start: number
  end: number
  kind: 'currency' | 'count' | 'percent' | 'spelled'
  /**
   * The word the figure counts - "business" in "three business units", "" when nothing follows.
   *
   * Load-bearing for UNMARKED figures. See `claimKey`: a bare 3 is not a claim, "3 business" is.
   */
  unit: string
}

/**
 * True when the literal itself announces a quantity: a currency symbol, a percent sign, or the `+`
 * a posting appends to a headcount. For these the number IS the claim, and matching it alone is
 * safe - nobody writes "$18M" incidentally.
 */
export function isMarked(f: Figure): boolean {
  return f.kind === 'currency' || f.kind === 'percent' || /\+\s*$/.test(f.raw)
}

/**
 * What two documents must SHARE before one can be accused of echoing the other.
 *
 * A marked figure keys on itself. An unmarked one - a bare count, a spelled number - keys on the
 * number AND the word it counts, because on its own it is not a claim about anything.
 *
 * This is not a refinement, it is the difference between a usable check and noise. The blanket rule
 * ("no numeric string that also appears in jd_real") was measured against a real package: a posting
 * saying "three business units" accused the filler bullets "Skill number 3", "Other skill 3" and
 * "One two three four five" - three offenders, none of which mentions a business unit. Requiring
 * the counted noun to match too costs a contrived miss ("three units" vs "three divisions") and
 * removes the entire class of incidental collisions. This check NAMES people; it errs toward
 * silence.
 *
 * Singulars and plurals fold together so "three business unit" and "three business units" are one
 * claim. That is a suffix rule on an exact word, not fuzzy similarity - nothing here RANKS.
 */
export function claimKey(f: Figure): string {
  if (isMarked(f)) return f.key
  // An unmarked figure with nothing after it counts nothing, so there is no claim to echo. The
  // sentinel cannot equal any other key, so such a figure simply never matches - the deliberate
  // silence this check prefers over a guess.
  if (!f.unit) return `${f.key}|<none>${f.start}`
  return `${f.key}|${stem(f.unit)}`
}

/**
 * Fold a plural onto its singular, so "three business unit" and "three business units" are one
 * claim. A suffix rule on an exact word - NOT similarity scoring. Nothing here ranks or scores;
 * two words either fold to the same string or they do not.
 *
 * `/e?s$/` is the wrong rule and was the first one written: it turns "sites" into "sit" and, worse,
 * folds "business" to "busines" while "businesses" folds to "business" - so the singular and plural
 * of the AC's own example land on different keys.
 */
export function stem(w: string): string {
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`
  if (/(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (/[^s]s$/.test(w)) return w.slice(0, -1)
  return w
}

// Units only. `hundred`/`thousand`/`million` are deliberately NOT here as standalone figures: a
// resume saying "a million things to fix" is prose, not a claim, and treating the bare word as the
// figure 1,000,000 would accuse it of echoing any posting that priced anything in millions. They
// appear below as MULTIPLIERS instead, so "one million" is ONE figure worth 1e6 rather than two.
const SPELLED: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 }

/**
 * Every figure in a body of text.
 *
 * Deliberately catches the forms a posting actually uses and a resume actually echoes: currency with
 * a magnitude suffix (`$18M`, `$18 million`), bare counts with the `+` a posting loves (`60+`,
 * `400+`), percentages, and SPELLED-OUT numbers — because "three business units" echoes just as
 * badly as "3 business units" and a digit-only scanner misses it entirely.
 */
export function extractFigures(text: string): Figure[] {
  const s = String(text || '')
  const out: Figure[] = []
  const push = (raw: string, key: string, start: number, kind: Figure['kind']) => {
    const end = start + raw.length
    // The gap may not cross a newline. "Skill number 3" ends a bullet; the word starting the NEXT
    // bullet is not what the 3 counts, and treating it as such invents a claim out of layout.
    const unit = (s.slice(end).match(/^[^\n\w]*([A-Za-z][\w-]*)/) || ['', ''])[1].toLowerCase()
    out.push({ raw, key, start, end, kind, unit })
  }

  // $18M · $18 million · $18.5M · £18M
  for (const m of s.matchAll(/([$£€])\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|bn|thousand|million|billion)?\b/gi)) {
    const n = Number(m[2].replace(/,/g, '')) * (m[3] ? MULT[m[3].toLowerCase()] || 1 : 1)
    // `\s*` before the optional magnitude word swallows the space even when no word follows, so
    // "$2019 spend" yielded the raw "$2019 " - trailing space and all - and that string is what a
    // correction would search for and what the drawer would print back at the user.
    push(m[0].trimEnd(), `cur:${n}`, m.index!, 'currency')
  }
  // 40% · 40 percent
  //
  // The word boundary belongs to `percent`, NOT to the whole alternation. `/…(%|percent)\b/` never
  // matches "40% growth": `%` is a non-word character and so is the space after it, so there is no
  // boundary between them and the match fails silently — leaving 40% to be picked up by the bare
  // count scanner below as the figure FOUR. Measured before the fix: "40% growth" produced exactly
  // one figure, `{raw:"4", key:"num:4"}`.
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b)/gi)) {
    push(m[0], `pct:${Number(m[1].replace(/,/g, ''))}`, m.index!, 'percent')
  }
  // 60+ · 400 + · 1,200 — a bare count. The `+` is part of the literal but NOT of the key, so a
  // resume saying "60" still collides with a posting saying "60+": echoing the number is the
  // defect, and dropping the plus does not launder it.
  // Note what is NOT here: a `(?!\s*(?:%|percent))` tail to skip percentages. It was, and it was
  // worse than nothing - a tail that can FAIL is a tail the engine backtracks past, so barred from
  // matching "40" it matched "4" instead and minted a figure appearing nowhere in the text. Nothing
  // in this pattern can fail after the digits, so there is no backtracking, and percentages are
  // excluded the same way currency is: the percent scanner already claimed the span.
  for (const m of s.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(\+)?/g)) {
    const at = m.index!
    if (out.some(f => at >= f.start && at < f.end)) continue    // already inside a currency/percent
    const n = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(n)) continue
    // A YEAR IS NOT A FIGURE. "Founded in 2019" in the posting and "since 2019" on the resume is a
    // coincidence of the calendar, not a stolen number, and dates appear in almost every pairing of
    // documents - so without this the check would accuse nearly every artifact and be learned as
    // noise, which is the cry-wolf failure that makes a guard worse than none.
    //
    // The cost is a real false negative: a genuine "2000 users" echo is missed. That trade is
    // deliberate and it is the right way round - this check NAMES an offender, so it must err
    // toward silence. Narrow on purpose: a plus makes it a quantity again ("2019+ deployments"),
    // and a comma or decimal means it was never written as a year ("1,987 accounts").
    const bareFourDigit = /^\d{4}$/.test(m[1])
    if (bareFourDigit && !m[2] && n >= 1900 && n <= 2099) continue
    push(m[0].trimEnd(), `num:${n}`, at, 'count')
  }
  // three business units · sixty engineers
  //
  // The overlap guard here is defence in depth, and is honestly labelled as such: no unit word
  // one..ninety can occur inside a numeric literal, so with the multiplier handling below no test
  // can currently tell whether it is present. It earns its place by making the SPELLED table safe
  // to extend - put "million" back in it and this line is the only thing stopping `$18 million`
  // from also yielding a free-floating `num:1000000`.
  const SPELLED_RE = new RegExp(
    `\\b(${Object.keys(SPELLED).join('|')})(?:[ -](hundred|thousand|million|billion))?\\b`, 'gi')
  for (const m of s.matchAll(SPELLED_RE)) {
    const at = m.index!
    if (out.some(f => at >= f.start && at < f.end)) continue
    const n = SPELLED[m[1].toLowerCase()] * (m[2] ? MULT[m[2].toLowerCase()] || 1 : 1)
    push(m[0], `num:${n}`, at, 'spelled')
  }
  return out.sort((a, b) => a.start - b.start)
}

export type EchoDisposition = 'echo' | 'shared_with_profile' | 'profile_only'

export interface Echo {
  figure: Figure
  disposition: EchoDisposition
  /** The profile figure that licenses keeping it, when there is one. */
  profileRaw?: string
}

export interface ScanResult {
  echoes: Echo[]
  /** Figures the posting and the profile BOTH state — kept, and citable. */
  shared: Echo[]
  /** True when there was no posting text to compare against. Never treat this as a clean scan. */
  notApplicable: boolean
  reason?: string
}

/**
 * Which figures in `generated` came from the POSTING and are not the candidate's.
 *
 * The three-way split is the whole point, and the middle case is the one a blanket rule gets wrong:
 *
 *   - in the posting, NOT in the profile   -> `echo`. The candidate is claiming the employer's number.
 *   - in the posting AND in the profile    -> `shared_with_profile`. KEPT. R2 (evidence) beats a
 *     literal reading of R3 here: if the profile genuinely says 62 and the posting asks for 60+,
 *     stripping it would delete the candidate's own true, evidenced achievement because the employer
 *     happened to mention a similar number.
 *   - not in the posting                   -> `profile_only`. Never touched.
 *
 * Returns `notApplicable` when there is no employer text. A scan with nothing to compare against
 * found no echoes because it could not look, and reporting that as a clean pass is the vacuous green
 * this whole layer exists to prevent.
 */
export function scanEcho(generated: string, postingText: string, profileText: string): ScanResult {
  // The SAME normalizer the extractor and the reviewer use — never a second regex. `jd_real` is HTML
  // and its entities must be decoded, or "P&L" is invisible (measured: present in 83 postings,
  // matched in zero, before that fix).
  const posting = normalizePostingText(postingText)
  if (!posting.trim()) {
    return { echoes: [], shared: [], notApplicable: true, reason: 'no employer posting text to compare against' }
  }
  // TWO indexes, because which one applies is decided by the GENERATED figure, never by how the
  // employer happened to punctuate theirs. A posting writing "60+ sites" and a resume writing "60
  // sites" is the echo this check exists to catch; keying both through `claimKey` missed it
  // entirely, since the posting's `+` marked it and the resume's absence of one did not.
  const postingFigures = extractFigures(posting)
  const postingBare = new Set(postingFigures.map(f => f.key))
  const postingClaims = new Set(postingFigures.filter(f => f.unit).map(f => `${f.key}|${stem(f.unit)}`))
  const profile = extractFigures(normalizePostingText(profileText))
  // The PROFILE side keys on the bare figure, not the claim. If the candidate's record says they ran
  // 60 sites, that licenses the number wherever they state it - insisting they phrase it with the
  // posting's noun would strip a true achievement over a wording difference, which is the exact
  // harm the carve-out exists to prevent.
  const profileByKey = new Map(profile.map(f => [f.key, f]))

  const echoes: Echo[] = []
  const shared: Echo[] = []
  for (const figure of extractFigures(generated)) {
    const inPosting = isMarked(figure)
      ? postingBare.has(figure.key)                              // the literal announces a quantity
      : !!figure.unit && postingClaims.has(`${figure.key}|${stem(figure.unit)}`)
    if (!inPosting) continue                                     // profile_only — not our business
    const owned = profileByKey.get(figure.key)
    if (owned) shared.push({ figure, disposition: 'shared_with_profile', profileRaw: owned.raw })
    else echoes.push({ figure, disposition: 'echo' })
  }
  return { echoes, shared, notApplicable: false }
}

/**
 * A replacement for an echoed figure, or null when there is nothing honest to say.
 *
 * Never invents a number. A currency figure generalises to its order of magnitude; a count
 * generalises to a word. Null means the caller must escalate rather than rewrite — silence is
 * better than a fabricated substitute.
 */
export function generalize(figure: Figure): string | null {
  const digits = figure.raw.replace(/[^\d.]/g, '')
  const n = Number(digits)
  if (!Number.isFinite(n) || !digits) return figure.kind === 'spelled' ? 'multiple' : null
  if (figure.kind === 'currency') {
    const mag = /m|million/i.test(figure.raw) ? 1e6 : /b|billion/i.test(figure.raw) ? 1e9 : /k|thousand/i.test(figure.raw) ? 1e3 : 1
    const total = n * mag
    const figures = Math.floor(Math.log10(total)) + 1
    return figures >= 2 ? `${figures}-figure` : null
  }
  if (figure.kind === 'percent') return null                    // no honest generalisation of a rate
  return 'multiple'
}

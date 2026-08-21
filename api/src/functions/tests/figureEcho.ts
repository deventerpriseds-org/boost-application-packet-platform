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
  kind: 'currency' | 'count' | 'percent' | 'range'  | 'spelled' | 'magnitude'
  /**
   * The literal announces a QUANTITY by itself: a `+` suffix, or currency carrying a magnitude
   * ("$18M", "$18 million"). Set at extraction, never re-derived from `raw`.
   */
  marked: boolean
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
  return f.marked
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
export function unitKey(f: Figure): string {
  return `${f.key}|${stem(f.unit)}`
}

export function claimKey(f: Figure): string {
  if (isMarked(f)) return f.key
  // An unmarked figure with nothing after it counts nothing, so there is no claim to echo. The
  // sentinel cannot equal any other key, so such a figure simply never matches - the deliberate
  // silence this check prefers over a guess.
  if (!f.unit) return `${f.key}|<none>${f.start}`
  return unitKey(f)
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
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

// `hundred` was in the spelled-number ALTERNATION but not in this table, so `MULT['hundred']` was
// undefined, `|| 1` took over, and "one hundred engineers" evaluated to the figure ONE. That is both
// a miss (a real "100 engineers" echo went unseen) and an accusation (it collided with a posting
// that said "the one engineer who owns this"). A multiplier must appear in both places or neither.
const MULT: Record<string, number> = { hundred: 100, k: 1e3, m: 1e6, b: 1e9, bn: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 }

/**
 * Every figure in a body of text.
 *
 * Deliberately catches the forms a posting actually uses and a resume actually echoes: currency with
 * a magnitude suffix (`$18M`, `$18 million`), bare counts with the `+` a posting loves (`60+`,
 * `400+`), percentages, and SPELLED-OUT numbers — because "three business units" echoes just as
 * badly as "3 business units" and a digit-only scanner misses it entirely.
 */
/** Words that are never what a figure counts — skip them and take the next real noun. */
const UNIT_STOP = new Set(['of', 'the', 'a', 'an', 'to', 'in', 'on', 'for', 'and', 'or', 'per', 'my', 'our', 'their', 'its'])

/**
 * The noun a figure counts, starting at `end`. "" when there is none.
 *
 * Three rules, each paid for by a false positive found in verification:
 *  - The gap may not cross a NEWLINE. "Skill number 3" ends a bullet; the first word of the next
 *    bullet is not what the 3 counts, and treating it as such invents a claim out of layout.
 *  - A HYPHEN-JOINED word is an adjective, not the subject: in "4-day release train" the figure
 *    counts the release train, not the day. Without this, "Introduced a 4-day release train" was
 *    accused of echoing a posting's "We operate a 4-day workweek" — same number, same "day",
 *    entirely different claim.
 *  - STOPWORDS are skipped. "Delivered 100% of committed roadmap items" counts roadmap items; the
 *    word "of" told us nothing, and matching on it accused that line of echoing "We are 100% remote".
 */
export function unitAfter(text: string, end: number): string {
  // A CAPITALISED word is a proper noun, not something being counted. "Based near 2400 Congress
  // Ave" and a posting's "Offices at 2400 Congress Ave" share a street address, and the noun rule
  // matched them on "Congress". An address is not an achievement. Reported as no unit, which for an
  // unmarked figure means it can never match anything.
  const raw = unitWordAfter(text, end)
  return /^[A-Z]/.test(raw) ? '' : raw.toLowerCase()
}

function unitWordAfter(text: string, end: number): string {
  let rest = text.slice(end)
  const hyphen = rest.match(/^-([A-Za-z][\w]*)/)          // "4-day release" -> skip "day"
  if (hyphen) rest = rest.slice(hyphen[0].length)
  for (let i = 0; i < 3; i++) {
    const m = rest.match(/^[^\n\w]*([A-Za-z][\w-]*)/)
    if (!m) return ''
    const w = m[1]
    if (!UNIT_STOP.has(w.toLowerCase())) return w
    rest = rest.slice(m[0].length)
  }
  return ''
}

export function extractFigures(text: string): Figure[] {
  const s = String(text || '')
  const out: Figure[] = []
  const push = (raw: string, key: string, start: number, kind: Figure['kind'], marked = false) => {
    const end = start + raw.length
    out.push({ raw, key, start, end, kind, unit: unitAfter(s, end), marked })
  }

  // $18M · $18 million · $18.5M · £18M · USD 18M · EUR 400k
  //
  // ISO CODES, not just symbols. `[$£€]` alone missed every posting that prices in words - measured:
  // "Own a USD 18M portfolio" produced ONE figure, `{raw:"18", key:"num:18"}`, because the symbol
  // pattern declined it and the bare-count scanner then took the digits and threw the `M` away. That
  // is not a near-miss, it is the WRONG NUMBER: eighteen standing in for eighteen million.
  //
  // The code must be UPPERCASE. None of these are English words, so the `\b`-delimited alternation is
  // already safe against "Audrey" or "Inrush" - the case rule is the belt to that braces, and it costs
  // nothing real, because no document that writes a currency code writes it in lower case.
  for (const m of s.matchAll(/(?:([$£€])|\b(USD|EUR|GBP|CAD|AUD|CHF|JPY|SEK|NOK|DKK|SGD|NZD|HKD|ZAR|INR)\b[ \t]?)[ \t]?(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|bn|thousand|million|billion)?\b/gi)) {
    if (m[2] && m[2] !== m[2].toUpperCase()) continue      // "usd 18m" is prose, not a price
    const n = Number(m[3].replace(/,/g, '')) * (m[4] ? MULT[m[4].toLowerCase()] || 1 : 1)
    // `\s*` before the optional magnitude word swallows the space even when no word follows, so
    // "$2019 spend" yielded the raw "$2019 " - trailing space and all - and that string is what a
    // correction would search for and what the drawer would print back at the user.
    // MARKED only with a magnitude ("$18M", "$18 million"). A bare amount is NOT self-announcing:
    // postings are dense with comp bands and benefit amounts, resumes with budgets they really
    // owned, and exempting those from the noun rule accused "$5,000 training stipend" of echoing
    // "a $5,000 learning budget", and "$180,000 vendor budget" of echoing a salary range.
    push(m[0].trimEnd(), `cur:${n}`, m.index!, 'currency', !!m[4])
  }
  // 18M · 400k · 2.5B · 18 million — a magnitude with NO currency symbol.
  //
  // This exists because of two FALSE ACCUSATIONS measured on `main`, not because of a missing form.
  // Without it the bare-count scanner took the digits and left the magnitude behind, and the magnitude
  // token then became the "unit" the noun rule compares:
  //
  //   "Grew the community to 18 million users."   -> {raw:"18", key:"num:18", unit:"million"}
  //   "You will own an 18 million dollar budget." -> {raw:"18", key:"num:18", unit:"million"}
  //                                                  => ECHO. Same key, same "unit".
  //
  // A community of users was accused of being lifted from a budget line, because both documents
  // happened to say "18 million" about entirely different things. The lowercase-letter form did the
  // same ("400k users" vs "400k budget"), and the UPPERCASE form did the opposite — `unitAfter` drops
  // a capitalised word as a proper noun, so "400K users" reported no unit at all and could never match
  // anything. The verdict flipped on the case of a single letter, which is the typography-dependence
  // the ordinal rule below was already written to kill.
  //
  // Keyed `cur:` — the SAME key space as currency, deliberately. That prefix means A MAGNITUDE, not
  // money; the symbol only ever decided `marked`. Sharing it is what makes "Managed a 18M portfolio"
  // collide with a posting's "$18M portfolio", which is laundering by deleting a dollar sign and is
  // exactly the move the `60`/`60+` rule already refuses to let through.
  //
  // NEVER marked. A number without a symbol does not announce itself, so it must clear the noun rule
  // like any other bare count — and that is precisely what keeps "18M users" away from "$18M budget".
  // The single optional [ \t] (not `\s`) is deliberate: `\s` matches a newline, and joining a figure
  // at the end of one bullet to the word "million" at the start of the next invents a quantity out of
  // layout, the same way the newline rule in `unitAfter` prevents inventing a unit out of it.
  for (const m of s.matchAll(/\b(\d[\d,]*(?:\.\d+)?)[ \t]?(k|m|b|bn|thousand|million|billion)\b/gi)) {
    const at = m.index!
    if (out.some(f => at >= f.start && at < f.end)) continue   // already inside a currency literal
    const n = Number(m[1].replace(/,/g, '')) * (MULT[m[2].toLowerCase()] || 1)
    if (!Number.isFinite(n)) continue
    push(m[0], `cur:${n}`, at, 'magnitude')
  }
  // 40% · 40 percent
  //
  // The word boundary belongs to `percent`, NOT to the whole alternation. `/…(%|percent)\b/` never
  // matches "40% growth": `%` is a non-word character and so is the space after it, so there is no
  // boundary between them and the match fails silently — leaving 40% to be picked up by the bare
  // count scanner below as the figure FOUR. Measured before the fix: "40% growth" produced exactly
  // one figure, `{raw:"4", key:"num:4"}`.
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b)/gi)) {
    // Never marked. "100% remote" and "Delivered 100% of committed items" share a number and
    // nothing else; a percentage without its subject is not a claim about anything.
    push(m[0], `pct:${Number(m[1].replace(/,/g, ''))}`, m.index!, 'percent')
  }
  // 5-7 years · 10 - 15 sites — ONE figure, not two.
  //
  // Extracted before the bare-count scanner so it claims the span first. Left to that scanner, a
  // posting's "Requires 5-7 years of experience" yielded a figure SEVEN carrying the unit "years",
  // which then matched a resume's honest "7 years leading platform organizations" — an accusation
  // built on half of a range the candidate never quoted. A range keys as a range, so a bare number
  // inside it collides with nothing.
  for (const m of s.matchAll(/\b(\d[\d,]*)\s?-\s?(\d[\d,]*)\b/g)) {
    const at = m.index!
    if (out.some(f => at >= f.start && at < f.end)) continue
    const lo = Number(m[1].replace(/,/g, '')), hi = Number(m[2].replace(/,/g, ''))
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    // Keyed so it matches NOTHING, deliberately. A range is a requirement shape — "5-7 years",
    // "$180,000 - $220,000" — not an achievement; nobody claims to have accomplished a range. This
    // figure exists solely to claim the span so the bare-count scanner cannot split "5-7 years"
    // into a figure SEVEN that then matches an honest "7 years leading platform organizations".
    push(m[0], `range:${lo}-${hi}@${at}`, at, 'range')
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
    // AN ORDINAL IS NOT A QUANTITY. "3rd-party vendor integrations" contains no figure three, and
    // because BOTH documents write "3rd-party" the noun rule does not save it — it actively
    // confirms the match. Measured: "Owned 3rd-party vendor integrations" was accused of echoing
    // "You will manage 3rd-party vendor relationships". The spelled form ("third-party") was
    // silent, so the check's verdict flipped on typography alone.
    if (/^(st|nd|rd|th)\b/i.test(s.slice(at + m[1].length))) continue
    push(m[0].trimEnd(), `num:${n}`, at, 'count', !!m[2])
  }
  // three business units · sixty engineers
  //
  // The overlap guard here is defence in depth, and is honestly labelled as such: no unit word
  // one..ninety can occur inside a numeric literal, so with the multiplier handling below no test
  // can currently tell whether it is present. It earns its place by making the SPELLED table safe
  // to extend - put "million" back in it and this line is the only thing stopping `$18 million`
  // from also yielding a free-floating `num:1000000`.
  // `one` and `two` are NOT in SPELLED: as standalone words they are prose, not claims. "One of the
  // first product hires" and "split into two tracks" were both accused of echoing a posting that
  // said the same ordinary thing, which is the `million` lesson applied where it bites hardest.
  // They return here ONLY in front of a multiplier, because "one hundred engineers" is a quantity
  // and dropping it lost a real echo of a posting's "100 engineers".
  const SPELLED_RE = new RegExp(
    `\\b(?:(one|two)[ -](hundred|thousand|million|billion)|(${Object.keys(SPELLED).join('|')})(?:[ -](hundred|thousand|million|billion))?)\\b`, 'gi')
  for (const m of s.matchAll(SPELLED_RE)) {
    const at = m.index!
    if (out.some(f => at >= f.start && at < f.end)) continue
    const unitWord = (m[1] || m[3])!.toLowerCase()
    const multWord = (m[2] || m[4] || '').toLowerCase()
    const base = m[1] ? (unitWord === 'one' ? 1 : 2) : SPELLED[unitWord]
    const n = base * (multWord ? MULT[multWord] || 1 : 1)
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
  // BOTH sides are decided here, against the NORMALIZED string, because a caller that re-derives
  // "is there text" from the raw one gets a different answer: `jd_real` is HTML, so `<p></p>` is a
  // non-empty raw string and an empty posting. A caller testing the raw string called that a clean
  // PASS on a document it had never compared to anything — the vacuous green this layer exists to
  // prevent — and the profile half was worse, producing false ACCUSATIONS off a markup-only
  // profile. One emptiness test, in the place that knows what emptiness means.
  const profileNorm = normalizePostingText(profileText)
  if (!profileNorm.trim()) {
    return { echoes: [], shared: [], notApplicable: true, reason: "no profile text — an echo cannot be told from the candidate's own figure" }
  }
  // TWO indexes, because which one applies is decided by the GENERATED figure, never by how the
  // employer happened to punctuate theirs. A posting writing "60+ sites" and a resume writing "60
  // sites" is the echo this check exists to catch; keying both through `claimKey` missed it
  // entirely, since the posting's `+` marked it and the resume's absence of one did not.
  const postingFigures = extractFigures(posting)
  // Both indexes are built THROUGH `claimKey`, so there is exactly one implementation of "what
  // must two documents share". An earlier version inlined the rule here and left `claimKey`
  // uncalled — the H25 structural guard was then watching dead code, and would have gone on passing
  // while the real logic beside it was reverted. One rule, one function, one place to break.
  const postingBare = new Set(postingFigures.map(f => f.key))
  // EVERY posting figure with a noun, marked or not. Filtering marked ones out here re-broke the
  // asymmetry: a posting asking "60+ sites" answered by a resume writing "60 sites" — the
  // commonest echo there is — stopped matching, because the posting's figure went only into the
  // bare index while the resume's unmarked one looked only at this one.
  const postingClaims = new Set(postingFigures.filter(f => f.unit).map(unitKey))
  const profile = extractFigures(profileNorm)
  // The PROFILE side keys on the bare figure, not the claim. If the candidate's record says they ran
  // 60 sites, that licenses the number wherever they state it - insisting they phrase it with the
  // posting's noun would strip a true achievement over a wording difference, which is the exact
  // harm the carve-out exists to prevent.
  const profileByKey = new Map(profile.map(f => [f.key, f]))

  const echoes: Echo[] = []
  const shared: Echo[] = []
  for (const figure of extractFigures(generated)) {
    // `claimKey` IS the branch: it returns the bare key for a marked figure and the noun-qualified
    // one otherwise, so the only thing left to choose is which index to look in. Written any other
    // way, `claimKey` becomes dead code and the H25 guard that watches it stops watching anything —
    // which is exactly what a verifier found the first time, when this line inlined the rule.
    const inPosting = (isMarked(figure) ? postingBare : postingClaims).has(claimKey(figure))
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

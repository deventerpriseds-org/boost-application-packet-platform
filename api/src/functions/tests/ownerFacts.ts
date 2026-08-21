// P6 — the candidate fact catalogue and the fact-vs-requirement matcher.
//
// Pure: no @azure/functions, no pg. Exercised by api/test/ownerFacts.test.mjs.
//
// WHY THIS EXISTS, measured rather than assumed. Across 7,559 live requirement rows the questions a
// posting actually asks are: years-of-experience 511, degree/certification 466, citizenship or work
// authorisation 43, security clearance 36, team/budget scope 24, onsite-hybrid-remote 20, travel 14,
// location 14. Years and degrees alone are 13% of every requirement in the corpus, and none of them
// is answerable by looking for words in a resume — they are facts about the candidate.
//
// The catalogue below is the SEED. It is not a fixed schema: `owner_fact` takes any key, and the
// system proposes new ones when a posting asks something nothing answers. This is the starting set
// the measurement justifies.

import { locationSatisfies } from './geo'

export type FactCategory = 'identity' | 'eligibility' | 'experience' | 'education' | 'scope' | 'preference'

export interface FactDef {
  key: string
  label: string
  category: FactCategory
  unit?: 'years' | 'usd' | 'people' | 'percent'
  /** What a posting says when it needs this fact — used to propose the fact when one is missing. */
  asks: RegExp
  /**
   * The key of a MORE GENERAL def this one narrows.
   *
   * Declared, never inferred. `selectFactDef` reads it to decide which of several matching defs
   * answers a requirement, so the answer no longer depends on catalogue ORDER — which is what made
   * `experience.years_leadership` unreachable (D22 / H41): its matcher is a strict subset of
   * `experience.years_total`'s and the scan returned on the first match.
   *
   * A subset relationship that is NOT declared here is a shadow, and H41 fails on it by measurement
   * rather than by naming the two entries that collided when it was written.
   */
  refines?: string
  help: string
}

/** Ordered by measured demand, so the settings screen asks the highest-value questions first. */
export const FACT_CATALOGUE: FactDef[] = [
  { key: 'experience.years_total', label: 'Total years of professional experience', category: 'experience',
    unit: 'years', asks: /\b\d+\+?\s*(years|yrs)\b/i,
    help: '511 requirement rows ask for a number of years. Answering once settles all of them.' },
  { key: 'experience.years_leadership', label: 'Years in leadership / management', category: 'experience',
    unit: 'years', asks: /\b\d+\+?\s*(years|yrs)[^.]{0,40}\b(leader|leadership|manage|managing|management)\b/i,
    refines: 'experience.years_total',
    help: 'Many postings separate total experience from years spent leading.' },
  { key: 'education.highest_degree', label: 'Highest degree (and field)', category: 'education',
    asks: /\b(bachelor|master|mba|phd|doctorate|degree)\b/i,
    help: '466 requirement rows mention a degree or certification.' },
  { key: 'education.certifications', label: 'Certifications held', category: 'education',
    asks: /\b(certifi\w*|pmp|cissp|safe|scrum|aws certified|azure certified)\b/i,
    help: 'Comma-separated. Leave empty if none.' },
  { key: 'eligibility.work_authorization', label: 'Work authorization / citizenship status', category: 'eligibility',
    asks: /\b(citizen|citizenship|green card|permanent resident|work authoriz\w*|authorized to work|visa|sponsorship|itar)\b/i,
    help: '43 requirement rows gate on this. A posting requiring US citizenship is a hard yes/no.' },
  { key: 'eligibility.security_clearance', label: 'Security clearance (level, and whether active)', category: 'eligibility',
    asks: /\b(security clearance|clearance|secret|ts\/sci|polygraph)\b/i,
    help: '36 requirement rows ask. "None" is a valid and useful answer.' },
  { key: 'identity.location', label: 'Where you are based (city, state, metro)', category: 'identity',
    asks: /\b(reside|residing|residency|must live|based in|located in)\b/i,
    help: 'Settles "Reside in the East Coast" style requirements outright.' },
  { key: 'preference.relocation', label: 'Willing to relocate?', category: 'preference',
    asks: /\brelocat\w*/i, help: 'Yes / No / For the right role.' },
  { key: 'preference.work_mode', label: 'Remote, hybrid or onsite — and days onsite you accept', category: 'preference',
    asks: /\b(onsite|on-site|hybrid|fully remote|in.office|days? (a|per) week)\b/i,
    help: '20 requirement rows specify a work mode.' },
  { key: 'preference.travel_max', label: 'Maximum travel you accept', category: 'preference', unit: 'percent',
    asks: /\b(willing to travel|able to travel|travel up to|travel \d+ ?%)\b/i,
    help: 'A percentage, or "none".' },
  { key: 'scope.largest_team', label: 'Largest team you have led', category: 'scope', unit: 'people',
    asks: /\b(team of \d+|\d+\s*(direct reports|engineers|people)|org of \d+)\b/i,
    help: 'Used for seniority alignment as well as explicit scope requirements.' },
  { key: 'scope.largest_budget', label: 'Largest budget or P&L owned', category: 'scope', unit: 'usd',
    asks: /\b(p&l|budget of|budget responsibility|\$\d+\s*(m|mm|million|b|billion))\b/i,
    help: 'Order of magnitude is enough.' },
]

export const FACT_BY_KEY = new Map(FACT_CATALOGUE.map(f => [f.key, f]))

export interface OwnerFact {
  key: string
  value: string | null
  value_num: number | null
  source: 'owner_stated' | 'derived' | 'proposed'
  confirmed_at: string | null
}

/**
 * THE demand parser. One function, one answer, for every unit that has arithmetic.
 *
 * D23. Before this, only `years` could be compared: `checkAgainstFacts` gated the arithmetic on
 * `def.unit === 'years'`, so `scope.largest_team` (people) and `scope.largest_budget` (usd) fell
 * through to `unknown` and the two of the eight comparison dimensions that are ABOUT numbers could
 * only ever be graded by token overlap. It is extended here rather than answered again in
 * `dimensions.ts`, because a second numeric parser is a second answer and the two disagree on the
 * first posting worded unusually. `H:one-demand-parser` fails the suite if one appears.
 *
 * Each unit gets its OWN pattern, and that is the point rather than an implementation detail:
 *  - `years` keeps `\d{1,2}` exactly as it was. A three-digit year figure is a parse error, not a
 *    career, and this path is 511 of 7,559 live requirement rows — it does not change.
 *  - `people` must NOT cap at two digits. The org sizes this dimension exists for are three and
 *    four figures ("an organization of 450"), and a two-digit cap reads 1,200 as 1 or 12 in
 *    silence. Thousands separators are accepted because postings write them.
 *  - `usd` must return DOLLARS, never the bare digits. A comparator that reads "$18M" as 18 is
 *    comparing eighteen dollars, and it will tell someone running an $18M budget they fall short.
 *
 * Anchoring is deliberate. `people` requires a people-noun and `usd` requires a currency marker, so
 * "10+ years leading teams" cannot be read as ten people, and a bare year count cannot be read as
 * dollars. A number with no unit attached to it is not a demand this function knows how to grade.
 */
export type Quantity = 'years' | 'people' | 'usd' | 'percent'

const MAGNITUDE: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
}

/** "1,200" -> 1200. Postings write separators; a parser that does not is off by a factor of ten. */
const digits = (s: string) => Number(String(s).replace(/,/g, ''))

const DEMAND_RE: Partial<Record<Quantity, RegExp>> = {
  // unchanged from the original demandedNumber, deliberately
  years: /\b(\d{1,2})\s*\+?\s*(?:years|yrs)\b/i,
  // "team of 250", "org of 1,200", "60+ engineers", "12 direct reports", "450 people"
  people: /\b(?:team|org|organi[sz]ation|group|department)\s+of\s+(\d[\d,]*)\b|\b(\d[\d,]*)\s*\+?\s*(?:direct reports|engineers|developers|people|staff|employees|ftes?|headcount)\b/i,
  // "$18M", "$1.5B", "$750K", "$10 million", "2.4 billion" (with a nearby currency/P&L word)
  usd: /(?:[$£€]\s?(\d[\d,]*(?:\.\d+)?)\s*(k|mm|m|bn|b|thousand|million|billion)?)|(?:\b(\d[\d,]*(?:\.\d+)?)\s*(k|mm|m|bn|b|thousand|million|billion)\b)/i,
}

/**
 * The figure a piece of text states in `unit`, or null when it states none.
 *
 * Returns `explicit: false` for a usd figure written as bare digits with no magnitude word. That
 * distinction is load-bearing rather than decorative — see `factQuantity`.
 */
export function parseQuantity(text: string, unit: Quantity = 'years'): { value: number; explicit: boolean } | null {
  const src = String(text || '')
  const re = DEMAND_RE[unit]
  if (!re) return null
  const m = re.exec(src)
  if (!m) return null
  if (unit === 'usd') {
    const raw = m[1] ?? m[3]
    const suffix = (m[2] ?? m[4] ?? '').toLowerCase()
    if (raw == null) return null
    const mult = MAGNITUDE[suffix] || 1
    // "$18M" and "$750K" carry their own scale; "$18" and "18" do not.
    return { value: digits(raw) * mult, explicit: !!suffix }
  }
  const raw = m.slice(1).find(x => x != null)
  if (raw == null) return null
  return { value: digits(raw), explicit: true }
}

/**
 * The number a requirement demands, when it states one ("10+ years" -> 10).
 *
 * Kept as the years-defaulted face of `parseQuantity` so every existing caller and every existing
 * expectation in `ownerFacts.test.mjs` is byte-for-byte unchanged. The years path was not touched.
 */
export function demandedNumber(text: string, unit: Quantity = 'years'): number | null {
  const q = parseQuantity(text, unit)
  return q ? q.value : null
}

/**
 * The OWNER's figure, on the same scale as the demand — and this is where the live defect is.
 *
 * MEASURED, not supposed. The same logical fact is written by two paths that disagree by six orders
 * of magnitude:
 *   - Settings > Facts (`Settings.jsx:1489`) does `Number(String(value).replace(/[^0-9.]/g, ''))`,
 *     so an owner who types "$18M" is stored as `value: '$18M', value_num: 18`.
 *   - `deriveFacts` (below) reads the same "$18M" off the resume and stores `value_num: 18000000`.
 * `upsertStated` (appFacts.ts) takes the client's `valueNum` verbatim, so both land in `owner_fact`.
 *
 * Trusting `value_num` for usd therefore compares 18 against 10000000 and tells an owner who runs an
 * $18M budget that they fall short — an ACCUSATION produced by a unit bug. So for usd the magnitude
 * is re-derived from the fact's own TEXT first, and `value_num` is only the fallback. Nothing is
 * rescaled upward: "$18K" parses to 18000 and still falls short of $10M, which is the mirror case
 * that must not be "fixed" into a pass.
 *
 * `people` and `years` are bare counts on both paths and are NOT rescaled — the correction is
 * unit-scoped on purpose.
 */
export function factQuantity(fact: { value: string | null; value_num: number | null }, unit: Quantity):
  { value: number; explicit: boolean } | null {
  if (unit === 'usd') {
    const fromText = parseQuantity(String(fact.value || ''), 'usd')
    if (fromText && fromText.explicit) return fromText
    if (fact.value_num != null) return { value: Number(fact.value_num), explicit: !!fromText?.explicit }
    return fromText
  }
  if (fact.value_num != null) return { value: Number(fact.value_num), explicit: true }
  const fromText = parseQuantity(String(fact.value || ''), unit)
  return fromText
}

/** Money and headcount read back the way they were written, never as raw enum units. */
export function formatQuantity(n: number, unit: Quantity): string {
  if (unit === 'usd') {
    const a = Math.abs(n)
    if (a >= 1e9) return `$${Number((n / 1e9).toFixed(2))}B`
    if (a >= 1e6) return `$${Number((n / 1e6).toFixed(2))}M`
    if (a >= 1e3) return `$${Number((n / 1e3).toFixed(2))}K`
    return `$${n}`
  }
  if (unit === 'people') return `${n} ${n === 1 ? 'person' : 'people'}`
  if (unit === 'years') return `${n} years`
  return String(n)
}

/** The units this system can actually do arithmetic in. The ONE answer to that question. */
export const COMPARABLE_UNITS: Quantity[] = ['years', 'people', 'usd']
export const isComparableUnit = (u: string | undefined | null): u is Quantity =>
  !!u && (COMPARABLE_UNITS as string[]).includes(u)

export type FactVerdict = 'satisfied' | 'not_satisfied' | 'unknown'

export interface FactCheck {
  fact_key: string
  verdict: FactVerdict
  detail: string
}

/**
 * Can the owner's facts settle this requirement?
 *
 * Returns `unknown` — never `satisfied` — when the fact is missing OR unconfirmed. An unconfirmed
 * fact is a guess the system made about the owner, and a guess must not settle a gate; this is the
 * same rule as absent evidence being `not_applicable` rather than `pass`. `unknown` is what causes
 * the fact to be PROPOSED, which is how the table grows.
 */
/**
 * Which catalogue entry answers this requirement, when several match.
 *
 * D22: the scan this replaces walked `FACT_CATALOGUE` in order and returned on the FIRST matching
 * def, so a def whose matcher is a strict subset of an earlier one could never be selected by ANY
 * input. `experience.years_leadership` was exactly that, and the consequences were live in both
 * directions: "10+ years of engineering leadership" was answered by TOTAL years, so 22 total years
 * satisfied it for someone who had led for three; and an owner who recorded leadership years but
 * not total years was told "no value recorded" for a fact they had recorded.
 *
 * Selection is now by DECLARED refinement, not by position and not by a similarity heuristic. Among
 * the defs that match, any def that another matching def `refines` is the more general one and is
 * dropped; what survives is the narrowest question the text asks. Two defs that match for unrelated
 * reasons — "Bachelor's degree; PMP certification" matches both education entries — have no
 * refinement link between them, both survive, and catalogue order still breaks the tie, so this
 * changes nothing about cases that were never a shadow.
 *
 * Declared rather than inferred on purpose. Ranking by longest match or by regex complexity guesses
 * at a relationship the catalogue can simply state, and a guess here decides a GATE: `checks.ts`
 * routes `facts_settled`, `fact_shortfall` and `facts_needed` through this function.
 */
export function selectFactDef(text: string): FactDef | null {
  const matching = FACT_CATALOGUE.filter(def => def.asks.test(text))
  if (!matching.length) return null
  const present = new Set(matching.map(d => d.key))
  // The keys some OTHER matching def declares itself a refinement of. Only links between defs that
  // BOTH match count: refining an entry the text never asked about says nothing about this text.
  const generalised = new Set(
    matching.map(d => d.refines).filter((k): k is string => !!k && present.has(k)))
  const survivors = matching.filter(d => !generalised.has(d.key))
  // `survivors` is non-empty unless the catalogue declares a refinement cycle; falling back to the
  // first match keeps a malformed catalogue answering rather than returning null, and H41 is what
  // fails on the cycle.
  return survivors[0] || matching[0]
}

export function checkAgainstFacts(requirementText: string, facts: OwnerFact[]): FactCheck | null {
  const text = String(requirementText || '')
  const byKey = new Map(facts.map(f => [f.key, f]))

  const def = selectFactDef(text)
  if (def) {
    const fact = byKey.get(def.key)

    if (!fact || fact.value == null || fact.value === '') {
      return { fact_key: def.key, verdict: 'unknown', detail: `no value recorded for "${def.label}"` }
    }
    if (!fact.confirmed_at) {
      return { fact_key: def.key, verdict: 'unknown', detail: `"${def.label}" is unconfirmed — confirm it to let it settle requirements` }
    }

    // Numeric demands are comparable: "10+ years" against a recorded total.
    const demanded = def.unit === 'years' ? demandedNumber(text) : null
    if (demanded !== null && fact.value_num !== null) {
      return fact.value_num >= demanded
        ? { fact_key: def.key, verdict: 'satisfied', detail: `${fact.value_num} years recorded, ${demanded} required` }
        : { fact_key: def.key, verdict: 'not_satisfied', detail: `${fact.value_num} years recorded, ${demanded} required` }
    }

    // Geography is REFERENCE DATA, not judgement. Whether Maryland is on the East Coast is a fact
    // anyone can look up, and asking the owner to confirm it is the system failing to do its job.
    // The line is narrower than "never infer": never infer things that depend on the PERSON. A
    // commute radius or whether they would take the role is theirs; the Atlantic seaboard is not.
    if (def.key === 'identity.location') {
      const geo = locationSatisfies(text, fact.value)
      if (geo) return { fact_key: def.key, verdict: geo.satisfied ? 'satisfied' : 'not_satisfied', detail: geo.detail }
    }

    // Everything else is surfaced with the fact beside the requirement, for a human to judge.
    return { fact_key: def.key, verdict: 'unknown', detail: `"${fact.value}" recorded — confirm this satisfies the requirement` }
  }
  return null
}

/** Facts a posting asked for that nothing answers — the rows to propose so the table grows. */
export function proposeMissingFacts(requirementTexts: string[], facts: OwnerFact[]): FactDef[] {
  const known = new Set(facts.filter(f => f.value).map(f => f.key))
  const wanted = new Set<string>()
  for (const t of requirementTexts) {
    for (const def of FACT_CATALOGUE) {
      if (def.asks.test(String(t || '')) && !known.has(def.key)) wanted.add(def.key)
    }
  }
  return FACT_CATALOGUE.filter(d => wanted.has(d.key))
}

// ---------------------------------------------------------------------------------------------
// DERIVATION — read the facts off the source instead of asking for them.
//
// The resume template's STATIC sections already state the work history with dates, the education
// line and any certifications. MasterContext's workHistory1-4 state the same thing in prose. Asking
// the owner to retype what those already say is the fallback-instead-of-source mistake; manual entry
// is the fallback, not the starting point.
//
// Everything derived here is written as source='derived' with confirmed_at NULL. A derived fact is
// the system's reading of a document — it is evidence, not testimony — and per the rule above it
// cannot settle a requirement until the owner confirms it. Each one carries the snippet it came
// from, so confirming is a glance rather than an investigation.

export interface DerivedFact {
  key: string
  value: string
  value_num: number | null
  evidence: string
}

const THIS_YEAR = 2026   // passed in by callers that have a clock; see deriveFacts(text, now)

/** Year ranges a work-history line states: "2003 - 2010", "2015 to Present", "Jan 2019 – Present". */
function yearRanges(text: string): Array<{ from: number; to: number | null; at: string }> {
  const out: Array<{ from: number; to: number | null; at: string }> = []
  // A month may sit on EITHER side of the separator: "AUG 2021 - Present", "JAN 2015 - JUL 2021".
  // Without the optional trailing month the second form does not match, and on the real template
  // that left only the CURRENT role matching — deriving "5 years" for a career spanning decades.
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s*'
  const re = new RegExp(
    `\\b(19[7-9]\\d|20[0-4]\\d)\\s*(?:-|–|—|to|until)\\s*(?:${MONTH})?(present|current|now|19[7-9]\\d|20[0-4]\\d)\\b`,
    'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const from = Number(m[1])
    const toRaw = m[2].toLowerCase()
    const to = /^\d{4}$/.test(toRaw) ? Number(toRaw) : null
    out.push({ from, to, at: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 10).replace(/\s+/g, ' ').trim() })
  }
  return out
}

const DEGREE_RE = /\b(ph\.?d\.?|doctorate|m\.?b\.?a\.?|master(?:'?s)?(?: of| in| degree)?|bachelor(?:'?s)?(?: of| in| degree)?|b\.?s\.?c?\.?|m\.?s\.?c?\.?|b\.?a\.?)\b[^.\n]{0,60}/gi
const DEGREE_RANK: Array<[RegExp, string]> = [
  [/ph\.?d|doctorate/i, 'Doctorate'],
  [/m\.?b\.?a/i, 'MBA'],
  [/master|m\.?s\.?c?\.?\b|m\.?a\.?\b/i, 'Master'],
  [/bachelor|b\.?s\.?c?\.?\b|b\.?a\.?\b/i, 'Bachelor'],
]

const CERT_RE = /\b(pmp|cissp|cisa|cism|csm|safe\s*\d*|itil|togaf|aws certified[^,.\n]{0,40}|azure[^,.\n]{0,30}certified|google cloud[^,.\n]{0,30}certified|six sigma[^,.\n]{0,20}|prince2|certified scrum[^,.\n]{0,30})\b/gi

/**
 * Derive what the source documents already state.
 *
 * `now` is injected rather than read from a clock so the result is reproducible and testable — the
 * same input always yields the same facts, which is the property every other engine here keeps.
 */
export function deriveFacts(text: string, now: number = THIS_YEAR): DerivedFact[] {
  const src = String(text || '')
  const out: DerivedFact[] = []
  if (!src.trim()) return out

  // --- total years, from the earliest work-history start year ---------------------------------
  const ranges = yearRanges(src)
  if (ranges.length) {
    const earliest = ranges.reduce((a, b) => (b.from < a.from ? b : a))
    const years = now - earliest.from
    if (years > 0 && years < 60) {
      out.push({
        key: 'experience.years_total',
        value: `${years} years (since ${earliest.from})`,
        value_num: years,
        evidence: `earliest dated role: ...${earliest.at}...`,
      })
    }
  }

  // --- highest degree -------------------------------------------------------------------------
  const degrees = Array.from(new Set((src.match(DEGREE_RE) || []).map(d => d.replace(/\s+/g, ' ').trim())))
  if (degrees.length) {
    let best: string | null = null
    for (const [re, label] of DEGREE_RANK) {
      const hit = degrees.find(d => re.test(d))
      if (hit) { best = `${label} — ${hit}`; break }
    }
    if (best) out.push({ key: 'education.highest_degree', value: best, value_num: null, evidence: degrees.slice(0, 4).join(' | ') })
  }

  // --- certifications -------------------------------------------------------------------------
  // Close a parenthesis the length cap cut off: "Certified Scrum Product Owner (CSPO" would
  // otherwise differ from the same cert typed properly by one character, and the conflict detector
  // would report a disagreement that is entirely an artefact of this regex.
  const balance = (c: string) => (c.includes('(') && !c.includes(')') ? `${c})` : c)
  const certs = Array.from(new Set((src.match(CERT_RE) || []).map(c => balance(c.replace(/\s+/g, ' ').trim()))))
  if (certs.length) {
    out.push({ key: 'education.certifications', value: certs.join(', '), value_num: null, evidence: `${certs.length} match(es) in the source` })
  }

  // --- largest team / budget scope ------------------------------------------------------------
  const teams = Array.from(src.matchAll(/\b(?:team|org|organization)s?\s+of\s+(\d{1,4})\b|\b(\d{1,4})\s*(?:\+\s*)?(?:direct reports|engineers|developers|people|staff|FTEs?)\b/gi))
    .map(m => Number(m[1] || m[2])).filter(n => n > 0 && n < 100000)
  if (teams.length) {
    const largest = Math.max(...teams)
    out.push({ key: 'scope.largest_team', value: String(largest), value_num: largest, evidence: `largest of ${teams.length} team-size mention(s)` })
  }

  const budgets = Array.from(src.matchAll(/\$\s?(\d+(?:\.\d+)?)\s*(k|m|mm|million|b|bn|billion)\b/gi))
    .map(m => {
      const n = Number(m[1]); const u = m[2].toLowerCase()
      return u === 'k' ? n * 1e3 : u.startsWith('b') ? n * 1e9 : n * 1e6
    })
  if (budgets.length) {
    const largest = Math.max(...budgets)
    const pretty = largest >= 1e9 ? `$${(largest / 1e9).toFixed(1)}B` : largest >= 1e6 ? `$${(largest / 1e6).toFixed(0)}M` : `$${Math.round(largest / 1e3)}K`
    out.push({ key: 'scope.largest_budget', value: pretty, value_num: largest, evidence: `largest of ${budgets.length} figure(s) in the source` })
  }

  return out
}

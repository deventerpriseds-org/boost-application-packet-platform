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

export type FactCategory = 'identity' | 'eligibility' | 'experience' | 'education' | 'scope' | 'preference'

export interface FactDef {
  key: string
  label: string
  category: FactCategory
  unit?: 'years' | 'usd' | 'people' | 'percent'
  /** What a posting says when it needs this fact — used to propose the fact when one is missing. */
  asks: RegExp
  help: string
}

/** Ordered by measured demand, so the settings screen asks the highest-value questions first. */
export const FACT_CATALOGUE: FactDef[] = [
  { key: 'experience.years_total', label: 'Total years of professional experience', category: 'experience',
    unit: 'years', asks: /\b\d+\+?\s*(years|yrs)\b/i,
    help: '511 requirement rows ask for a number of years. Answering once settles all of them.' },
  { key: 'experience.years_leadership', label: 'Years in leadership / management', category: 'experience',
    unit: 'years', asks: /\b\d+\+?\s*(years|yrs)[^.]{0,40}\b(leader|leadership|manage|managing|management)\b/i,
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

/** The number a requirement demands, when it states one ("10+ years" -> 10). */
export function demandedNumber(text: string): number | null {
  const m = /\b(\d{1,2})\s*\+?\s*(years|yrs)\b/i.exec(String(text || ''))
  return m ? Number(m[1]) : null
}

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
export function checkAgainstFacts(requirementText: string, facts: OwnerFact[]): FactCheck | null {
  const text = String(requirementText || '')
  const byKey = new Map(facts.map(f => [f.key, f]))

  for (const def of FACT_CATALOGUE) {
    if (!def.asks.test(text)) continue
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

    // Everything else is surfaced with the fact beside the requirement, for a human to judge. The
    // system states what it knows; it does not infer that "Boston, MA" satisfies "East Coast".
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

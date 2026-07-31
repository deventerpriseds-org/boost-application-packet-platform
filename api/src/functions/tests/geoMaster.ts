// ACT-32 — a small, checked-in master of US job-market metros. Each entry has the LinkedIn
// "Metropolitan Area" display name, its LinkedIn geoId (used as the f_PP search param when present),
// and match aliases for mapping the messy free-text opportunity `location` string onto the metro.
//
// geoId note: these are the standard published LinkedIn metro geoIds. The sandbox cannot reach
// LinkedIn to verify them, so search treats geoId as an OPTIONAL optimisation — buildSearchUrl uses
// f_PP=geoId when present and otherwise falls back to the metro/location TEXT (which LinkedIn guest
// search resolves server-side). A geoId that is null or wrong therefore degrades to a correct
// text search, never a broken one. Spot-check the geoIds against a live LinkedIn location search
// before relying on f_PP precision.

export interface Metro { name: string; geoId: string | null; aliases: string[] }

// Order matters only for display; matching is by alias containment (longest alias wins).
export const METROS: Metro[] = [
  { name: 'United States (nationwide)', geoId: '103644278', aliases: ['united states', 'usa', 'u.s.', 'nationwide', 'remote'] },
  { name: 'New York City Metropolitan Area', geoId: '90000070', aliases: ['new york', 'nyc', 'new york city', 'manhattan', 'brooklyn', 'newark', 'jersey city'] },
  { name: 'San Francisco Bay Area', geoId: '90000084', aliases: ['san francisco', 'bay area', 'oakland', 'palo alto', 'mountain view', 'san jose', 'sunnyvale', 'menlo park'] },
  { name: 'Los Angeles Metropolitan Area', geoId: '90000049', aliases: ['los angeles', 'l.a.', 'santa monica', 'pasadena', 'irvine', 'long beach'] },
  { name: 'Greater Chicago Area', geoId: '90000014', aliases: ['chicago', 'evanston', 'naperville'] },
  { name: 'Washington DC-Baltimore Area', geoId: '90000097', aliases: ['washington, dc', 'washington dc', 'washington, d.c.', 'baltimore', 'arlington, va', 'silver spring', 'bethesda', 'reston', 'mclean'] },
  { name: 'Greater Boston', geoId: '90000007', aliases: ['boston', 'cambridge, ma', 'waltham'] },
  { name: 'Greater Seattle Area', geoId: '90000091', aliases: ['seattle', 'bellevue', 'redmond', 'tacoma'] },
  { name: 'Atlanta Metropolitan Area', geoId: '90000052', aliases: ['atlanta'] },
  { name: 'Dallas-Fort Worth Metroplex', geoId: '90000075', aliases: ['dallas', 'fort worth', 'plano', 'irving, tx'] },
  { name: 'Austin, Texas Metropolitan Area', geoId: '90000064', aliases: ['austin'] },
  { name: 'Greater Houston', geoId: '90000058', aliases: ['houston'] },
  { name: 'Miami-Fort Lauderdale Area', geoId: '90000466', aliases: ['miami', 'fort lauderdale', 'boca raton'] },
  { name: 'Denver Metropolitan Area', geoId: null, aliases: ['denver', 'boulder, co'] },
  { name: 'Minneapolis-St. Paul', geoId: null, aliases: ['minneapolis', 'st. paul', 'saint paul'] },
  { name: 'Greater Philadelphia', geoId: null, aliases: ['philadelphia', 'philly'] },
]

// Work mode parsed from the trailing "(Remote|Hybrid|On-site)" modifier LinkedIn bakes into location
// (also used by ACT-33's remote filter). Returns 'remote' | 'hybrid' | 'onsite' | null.
export function parseWorkMode(rawLocation: string): 'remote' | 'hybrid' | 'onsite' | null {
  const s = (rawLocation || '').toLowerCase()
  if (/\bremote\b/.test(s)) return 'remote'
  if (/\bhybrid\b/.test(s)) return 'hybrid'
  if (/\bon-?site\b/.test(s)) return 'onsite'
  return null
}

// Strip the work-mode modifier so the place text is clean for matching / display.
export function stripWorkMode(rawLocation: string): string {
  return (rawLocation || '').replace(/\s*\((remote|hybrid|on-?site)\)\s*/gi, '').trim()
}

// Map a free-text opportunity location onto a Metro (or null when unrecognised). Longest matching
// alias wins so "san francisco" beats a bare "united states" fallback.
export function resolveMetro(rawLocation: string): Metro | null {
  const s = stripWorkMode(rawLocation || '').toLowerCase()
  if (!s) return null
  let best: Metro | null = null
  let bestLen = 0
  for (const m of METROS) {
    for (const a of m.aliases) {
      if (a === 'remote') continue // 'remote' alias only helps the nationwide fallback, not a place match
      if (s.includes(a) && a.length > bestLen) { best = m; bestLen = a.length }
    }
  }
  return best
}

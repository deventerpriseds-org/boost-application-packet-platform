// US geography, as reference data rather than judgement.
//
// WHY THIS EXISTS. The fact checker asked the owner to confirm that "Westminster, MD 21158" satisfies
// "Reside in the East Coast of the United States". That was over-conservative to the point of being
// useless: whether Maryland is on the East Coast is not an opinion, it is a fact anyone can look up,
// and a system that asks its user to confirm geography is a system that has not done its job.
//
// The line to hold is narrower than "never infer". It is: never infer things that DEPEND ON THE
// PERSON. Whether the owner would accept a role is a judgement only they can make; whether Maryland
// borders the Atlantic is not. Reference data settles the second kind; the owner settles the first.

export type Region = 'northeast' | 'southeast' | 'midwest' | 'southwest' | 'west'

export interface StateInfo { abbr: string; name: string; region: Region; eastCoast: boolean; westCoast: boolean }

/** The Atlantic seaboard, in the sense employers mean by "East Coast". */
const EAST = new Set(['ME', 'NH', 'MA', 'RI', 'CT', 'NY', 'NJ', 'DE', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL', 'PA', 'DC'])
const WEST = new Set(['CA', 'OR', 'WA', 'AK', 'HI'])

const RAW: Array<[string, string, Region]> = [
  ['AL', 'Alabama', 'southeast'], ['AK', 'Alaska', 'west'], ['AZ', 'Arizona', 'southwest'],
  ['AR', 'Arkansas', 'southeast'], ['CA', 'California', 'west'], ['CO', 'Colorado', 'west'],
  ['CT', 'Connecticut', 'northeast'], ['DE', 'Delaware', 'northeast'], ['DC', 'District of Columbia', 'northeast'],
  ['FL', 'Florida', 'southeast'], ['GA', 'Georgia', 'southeast'], ['HI', 'Hawaii', 'west'],
  ['ID', 'Idaho', 'west'], ['IL', 'Illinois', 'midwest'], ['IN', 'Indiana', 'midwest'],
  ['IA', 'Iowa', 'midwest'], ['KS', 'Kansas', 'midwest'], ['KY', 'Kentucky', 'southeast'],
  ['LA', 'Louisiana', 'southeast'], ['ME', 'Maine', 'northeast'], ['MD', 'Maryland', 'northeast'],
  ['MA', 'Massachusetts', 'northeast'], ['MI', 'Michigan', 'midwest'], ['MN', 'Minnesota', 'midwest'],
  ['MS', 'Mississippi', 'southeast'], ['MO', 'Missouri', 'midwest'], ['MT', 'Montana', 'west'],
  ['NE', 'Nebraska', 'midwest'], ['NV', 'Nevada', 'west'], ['NH', 'New Hampshire', 'northeast'],
  ['NJ', 'New Jersey', 'northeast'], ['NM', 'New Mexico', 'southwest'], ['NY', 'New York', 'northeast'],
  ['NC', 'North Carolina', 'southeast'], ['ND', 'North Dakota', 'midwest'], ['OH', 'Ohio', 'midwest'],
  ['OK', 'Oklahoma', 'southwest'], ['OR', 'Oregon', 'west'], ['PA', 'Pennsylvania', 'northeast'],
  ['RI', 'Rhode Island', 'northeast'], ['SC', 'South Carolina', 'southeast'], ['SD', 'South Dakota', 'midwest'],
  ['TN', 'Tennessee', 'southeast'], ['TX', 'Texas', 'southwest'], ['UT', 'Utah', 'west'],
  ['VT', 'Vermont', 'northeast'], ['VA', 'Virginia', 'southeast'], ['WA', 'Washington', 'west'],
  ['WV', 'West Virginia', 'southeast'], ['WI', 'Wisconsin', 'midwest'], ['WY', 'Wyoming', 'west'],
]

export const STATES: StateInfo[] = RAW.map(([abbr, name, region]) =>
  ({ abbr, name, region, eastCoast: EAST.has(abbr), westCoast: WEST.has(abbr) }))

const BY_ABBR = new Map(STATES.map(s => [s.abbr, s]))
const BY_NAME = new Map(STATES.map(s => [s.name.toLowerCase(), s]))

/**
 * The state a free-text location names. "Westminster, MD 21158" -> MD.
 *
 * A bare two-letter token only counts when it is a real postal abbreviation AND is uppercase, so
 * "Springfield, Oregon" resolves by name while the "IN" of "Based IN the northeast" does not become
 * Indiana. Full names are matched first because they are unambiguous.
 */
export function parseState(text: string): StateInfo | null {
  const s = String(text || '')
  for (const [name, info] of BY_NAME) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(s)) return info
  }
  const m = s.match(/\b([A-Z]{2})\b/g) || []
  for (const abbr of m) {
    const info = BY_ABBR.get(abbr)
    if (info) return info
  }
  return null
}

export type GeoVerdict = { satisfied: boolean; detail: string } | null

/**
 * Does a recorded location satisfy a location requirement?
 *
 * Returns null when the requirement names something this table cannot settle — a specific metro, a
 * commute radius, a country other than the US. Null means "ask", and asking is right there: a
 * commute radius depends on the person, not on geography.
 */
export function locationSatisfies(requirement: string, location: string): GeoVerdict {
  const req = String(requirement || '').toLowerCase()
  const home = parseState(location)
  if (!home) return null

  const named = `${home.name} (${home.abbr})`

  if (/\beast coast\b|\beastern seaboard\b/.test(req)) {
    return { satisfied: home.eastCoast, detail: `${named} is ${home.eastCoast ? '' : 'not '}on the East Coast` }
  }
  if (/\bwest coast\b/.test(req)) {
    return { satisfied: home.westCoast, detail: `${named} is ${home.westCoast ? '' : 'not '}on the West Coast` }
  }
  for (const region of ['northeast', 'southeast', 'midwest', 'southwest'] as Region[]) {
    const pattern = new RegExp(`\\b${region}|\\b${region.replace(/east|west/, ' $&')}\\b`, 'i')
    if (pattern.test(req)) {
      return { satisfied: home.region === region, detail: `${named} is in the ${home.region}, requirement asks for the ${region}` }
    }
  }
  if (/\bwest\b/.test(req) && !/\bmidwest|southwest|northwest\b/.test(req)) {
    return { satisfied: home.region === 'west', detail: `${named} is in the ${home.region}` }
  }

  // A named state in the requirement: "must reside in Texas".
  const wanted = parseState(requirement)
  if (wanted) {
    return { satisfied: wanted.abbr === home.abbr, detail: `recorded ${named}, requirement asks for ${wanted.name}` }
  }

  // Anything else — a metro, a commute radius, a country — depends on the person, not on geography.
  return null
}

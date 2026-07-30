// Role taxonomy — 3-level model nested UNDER the existing seniority groups used by the mail
// folder watcher (mailWatch.ts seniorityTier → 'csuite' | 'vp' | 'director'). Levels:
//   group (csuite|vp|director)  →  role (CTO, Software, …)  →  variation  →  job-title string
// The user's full "ideal roles" list seeds as tier 'fav' (promoted); anything matched but not
// seeded is 'watch'; 'off' seeds for nothing (reserved for user muting later).
//
// This module is PURE + deterministic (no DB, no network) so it can be unit-tested and run in
// the ingest hot path (< 200ms/title, no OpenAI call). The DB seed + per-user editable rows are
// built from GROUPS here; the matcher (resolveTitle) uses an in-memory normalized index.

export const FAVORITE_BOOST = 15
export const GROUP_LABEL: Record<string, string> = { csuite: 'C Suite', vp: 'VP & Head of', director: 'Director' }
export type Tier = 'fav' | 'watch' | 'off'
export type Group = 'csuite' | 'vp' | 'director'

// ── C-Suite roles: base label + acronym + the specialized qualifier prefixes/forms ───────────
// Each produces job-title strings by combining the qualifier with the long form and the acronym.
const CSUITE: { role: string; slug: string; long: string; acr: string; quals: string[]; extra?: string[] }[] = [
  { role: 'CTO', slug: 'cto', long: 'Chief Technology Officer', acr: 'CTO',
    quals: ['Enterprise', 'Divisional', 'Business Unit', 'Product', 'Platform', 'Software', 'Digital', 'Field', 'Deputy', 'Fractional'] },
  { role: 'CIO', slug: 'cio', long: 'Chief Information Officer', acr: 'CIO',
    quals: ['Enterprise', 'Divisional', 'Business Unit', 'Digital', 'Technology', 'Fractional'] },
  { role: 'Chief Digital Officer', slug: 'cdigo', long: 'Chief Digital Officer', acr: 'CDO',
    quals: ['Fractional', 'Digital'],
    extra: ['Chief Digital and Technology Officer', 'Chief Digital Transformation Officer', 'Chief Digital Innovation Officer', 'Chief Digital and Information Officer', 'Chief Digital and Product Officer'] },
  { role: 'Chief Data Officer', slug: 'cdatao', long: 'Chief Data Officer', acr: 'CDO',
    quals: ['Fractional', 'Data'],
    extra: ['Chief Data and Analytics Officer', 'Chief Data and AI Officer', 'Chief Analytics Officer', 'Chief Data and Technology Officer', 'Chief Data and Digital Officer', 'Chief Data & Analytics Officer', 'Chief Data & AI Officer'] },
  { role: 'CPO', slug: 'cpo', long: 'Chief Product Officer', acr: 'CPO',
    quals: ['Fractional', 'Product'],
    extra: ['Chief Product and Technology Officer', 'Chief Product and Digital Officer', 'Chief Product Development Officer', 'Chief Product and Engineering Officer'] },
  { role: 'Chief AI Officer', slug: 'caio', long: 'Chief AI Officer', acr: 'CAIO',
    quals: ['Fractional'],
    extra: ['Chief Artificial Intelligence Officer', 'Chief AI and Data Officer', 'Chief AI and Technology Officer', 'Chief Analytics and AI Officer', 'Chief Data, Analytics and AI Officer', 'Chief AI & Data Officer'] },
  // COO is gated by an inclusion rule (needs a software/transformation signal) — see COO_SIGNAL.
  { role: 'COO', slug: 'coo', long: 'Chief Operating Officer', acr: 'COO',
    quals: ['Divisional', 'Business Unit', 'Technology', 'Digital'],
    extra: ['Chief Technology and Operating Officer', 'Chief Digital Operating Officer', 'Chief Product and Operating Officer', 'Chief Transformation and Operating Officer'] },
]

// ── VP & Head-of / Director families: family → the sub-variants that follow "… of <X>" ────────
// Same family set for both vp and director groups (per the user's list); the seniority prefixes
// differ per group. Generated title = "<prefix> of <sub>" (+ bare-prefix forms for the family head).
const FAMILIES: { role: string; slug: string; subs: string[]; extra?: string[] }[] = [
  { role: 'Software', slug: 'software', subs: ['Software', 'Software Engineering', 'Software Development', 'Enterprise Software', 'Software Platforms', 'Software Products', 'Software Strategy', 'Global Software'] },
  { role: 'Engineering', slug: 'engineering', subs: ['Engineering', 'Technology Engineering', 'Digital Engineering', 'Application Engineering', 'Engineering and Operations', 'Engineering Operations', 'Engineering and Technology', 'Engineering and Product', 'Product and Engineering', 'Global Engineering'] },
  { role: 'Product', slug: 'product', subs: ['Product', 'Product Management', 'Product Development', 'Digital Product', 'Software Product', 'Product Strategy', 'Product and Engineering', 'Product and Technology', 'Global Product'] },
  { role: 'Technology', slug: 'technology', subs: ['Technology', 'Technology Strategy', 'Technology and Innovation', 'Information Technology', 'Enterprise Technology', 'Technology Operations', 'Technology Solutions', 'Technology Innovation', 'Global Technology'] },
  { role: 'Digital', slug: 'digital', subs: ['Digital', 'Digital Strategy', 'Digital Transformation', 'Digital Products', 'Digital Innovation', 'Digital Technology', 'Digital Solutions', 'Digital Experience', 'Global Digital'] },
  { role: 'Data, Analytics & AI', slug: 'data', subs: ['Data', 'Data and Analytics', 'Data and AI', 'Artificial Intelligence', 'AI', 'Analytics', 'Machine Learning', 'Data Management', 'Data Strategy', 'Data Governance', 'Advanced Analytics', 'AI Strategy', 'Global Data'] },
  { role: 'Architecture', slug: 'architecture', subs: ['Enterprise Architecture', 'Architecture', 'Technology Architecture', 'Solutions Architecture', 'Data Architecture', 'Software Architecture', 'Application Architecture', 'Digital Architecture'], extra: ['Chief Architect', 'Enterprise Chief Architect', 'Distinguished Chief Architect'] },
  { role: 'Delivery & Operations', slug: 'delivery', subs: ['Delivery', 'Technology Delivery', 'Software Delivery', 'Product Delivery', 'Engineering Operations', 'Development Operations', 'Professional Services', 'Technology Operations', 'Software Operations', 'Delivery Excellence'] },
  { role: 'Solutions & Automation', slug: 'solutions', subs: ['Solutions', 'Solutions Development', 'Solutions Engineering', 'Automation', 'Intelligent Automation', 'Solutions Development and Automation', 'Digital Solutions', 'Technology Solutions', 'Enterprise Solutions', 'Business Automation'] },
  { role: 'Transformation & Strategy', slug: 'transformation', subs: ['Transformation', 'Technology Transformation', 'Business Transformation', 'Enterprise Transformation', 'Digital Transformation', 'Software Strategy', 'Technology Strategy', 'Digital Strategy', 'Enterprise Strategy', 'Innovation and Transformation'] },
]

const VP_PREFIXES = ['Vice President of', 'VP of', 'Head of', 'Global Head of']
// Director group primarily Senior/Executive/Managing/Global Director (ordinary "Director of X"
// is NOT seeded fav — it only matches via the watch fallback unless exceptional).
const DIR_PREFIXES = ['Senior Director of', 'Executive Director of', 'Managing Director of', 'Global Director of']

export interface SeedTitle { group: Group; roleSlug: string; role: string; variation: string; title: string; tier: Tier }
export interface SeedRole { group: Group; slug: string; role: string; variations: string[] }

// Build the full seed (roles + every favorite job-title string) from the compact spec above.
function buildSeed(): { roles: SeedRole[]; titles: SeedTitle[] } {
  const roles: SeedRole[] = []
  const titles: SeedTitle[] = []
  const pushTitle = (group: Group, roleSlug: string, role: string, variation: string, title: string) => {
    titles.push({ group, roleSlug, role, variation, title, tier: 'fav' })
  }
  // C-Suite
  for (const r of CSUITE) {
    const vars = new Set<string>()
    pushTitle('csuite', r.slug, r.role, r.long, r.long)
    pushTitle('csuite', r.slug, r.role, r.acr, r.acr)
    vars.add(r.long); vars.add(r.acr)
    for (const q of r.quals) {
      for (const t of [`${q} ${r.long}`, `${q} ${r.acr}`]) { pushTitle('csuite', r.slug, r.role, `${q} ${r.role}`, t); vars.add(t) }
    }
    for (const e of (r.extra || [])) { pushTitle('csuite', r.slug, r.role, e, e); vars.add(e) }
    roles.push({ group: 'csuite', slug: r.slug, role: r.role, variations: [...vars] })
  }
  // VP & Head of, and Director — same families, different seniority prefixes
  for (const [group, prefixes] of [['vp', VP_PREFIXES], ['director', DIR_PREFIXES]] as [Group, string[]][]) {
    for (const f of FAMILIES) {
      const vars = new Set<string>()
      for (const p of prefixes) {
        for (const sub of f.subs) { const t = `${p} ${sub}`; pushTitle(group, f.slug, f.role, sub, t); vars.add(t) }
      }
      for (const e of (f.extra || [])) { pushTitle(group, f.slug, f.role, e, e); vars.add(e) }  // e.g. Chief Architect
      roles.push({ group, slug: `${group}-${f.slug}`, role: f.role, variations: [...vars] })
    }
  }
  return { roles, titles }
}

export const SEED = buildSeed()

// ── Normalization ────────────────────────────────────────────────────────────────────────────
// Bidirectional abbreviation map (applied token-wise after normalization). Long forms are
// reduced to the canonical acronym so "Chief Technology Officer" and "CTO" collide.
const ABBREV: [RegExp, string][] = [
  [/\bchief technology officer\b/g, 'cto'],
  [/\bchief information officer\b/g, 'cio'],
  [/\bchief digital officer\b/g, 'cdigo'],
  [/\bchief data officer\b/g, 'cdatao'],
  [/\bchief product officer\b/g, 'cpo'],
  [/\bchief (ai|artificial intelligence) officer\b/g, 'caio'],
  [/\bchief operating officer\b/g, 'coo'],
  [/\bchief executive officer\b/g, 'ceo'],
  [/\bsenior vice president\b/g, 'svp'],
  [/\bexecutive vice president\b/g, 'evp'],
  [/\bvice president\b/g, 'vp'],
  [/\bartificial intelligence\b/g, 'ai'],
  [/\bmachine learning\b/g, 'ml'],
  [/\benterprise architecture\b/g, 'ea'],
  [/\binformation technology\b/g, 'it'],
]

export function normalize(sRaw: string, opts: { cut?: boolean } = {}): string {
  let s = (sRaw || '').toLowerCase()
  s = s.replace(/&/g, ' and ')
  // cut trailing context (location / dept / remote tags) at the first of these separators:
  // a comma, a spaced dash/pipe/bullet/@, the word "at", or an opening paren.
  // Skipped (cut:false) for the seniority-band scan, which must see tokens AFTER a separator
  // (e.g. "Administration - SVP - ..." — the SVP comes after the first dash).
  if (opts.cut !== false) {
    const cut = s.search(/,| [|·\-–—@] |\bat\b|\(/)
    if (cut > 0) s = s.slice(0, cut)
  }
  s = s.replace(/[^a-z0-9 ]/g, ' ')                 // strip punctuation
  for (const [re, rep] of ABBREV) s = s.replace(re, rep)
  // drop filler tokens (of/the/for) — "global" is KEPT (real qualifier)
  s = s.split(/\s+/).filter((t) => t && !['of', 'the', 'for', 'and'].includes(t)).join(' ')
  return s.trim()
}

function trigrams(s: string): Set<string> {
  const t = `  ${s.replace(/\s+/g, ' ')}  `
  const g = new Set<string>()
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3))
  return g
}
function trigramSim(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

// ── Matching index ───────────────────────────────────────────────────────────────────────────
interface IndexEntry { group: Group; roleSlug: string; role: string; variation: string; title: string; tier: Tier; norm: string }
const INDEX: Map<string, IndexEntry> = new Map()
const ENTRIES: IndexEntry[] = []
for (const t of SEED.titles) {
  const norm = normalize(t.title)
  const e: IndexEntry = { group: t.group, roleSlug: t.roleSlug, role: t.role, variation: t.variation, title: t.title, tier: t.tier, norm }
  if (!INDEX.has(norm)) INDEX.set(norm, e)
  ENTRIES.push(e)
}

// Keyword fallback: family/role keywords → role, plus seniority → group. Used when no confident
// title match exists. Returns tier 'watch' (matched but not a seeded favorite).
const ROLE_KEYWORDS: { group: Group; roleSlug: string; role: string; kw: RegExp }[] = [
  { group: 'csuite', roleSlug: 'cto', role: 'CTO', kw: /\bcto\b/ },
  { group: 'csuite', roleSlug: 'cio', role: 'CIO', kw: /\bcio\b/ },
  { group: 'csuite', roleSlug: 'cdigo', role: 'Chief Digital Officer', kw: /\bcdigo\b|chief digital/ },
  { group: 'csuite', roleSlug: 'cdatao', role: 'Chief Data Officer', kw: /\bcdatao\b|chief data/ },
  { group: 'csuite', roleSlug: 'cpo', role: 'CPO', kw: /\bcpo\b/ },
  { group: 'csuite', roleSlug: 'caio', role: 'Chief AI Officer', kw: /\bcaio\b/ },
  { group: 'csuite', roleSlug: 'coo', role: 'COO', kw: /\bcoo\b/ },
]
const FAMILY_KW: { slug: string; role: string; kw: RegExp }[] = FAMILIES.map((f) => ({
  slug: f.slug, role: f.role,
  kw: new RegExp(`\\b(${f.slug === 'data' ? 'data|ai|analytics|ml' : f.slug === 'transformation' ? 'transformation|strategy' : f.slug === 'delivery' ? 'delivery|operations|professional services' : f.slug === 'solutions' ? 'solutions|automation' : f.slug})\\b`),
}))

export type MatchMethod = 'exact' | 'alias' | 'fuzzy' | 'keyword' | 'none'
export interface MatchResult {
  matched: boolean
  group: Group | null
  roleSlug: string | null
  role: string | null
  variation: string | null
  title: string | null           // canonical seeded title (null on keyword/none)
  tier: Tier                     // fav | watch | off
  isFavorite: boolean
  method: MatchMethod
  confidence: number
}

const NONE: MatchResult = { matched: false, group: null, roleSlug: null, role: null, variation: null, title: null, tier: 'watch', isFavorite: false, method: 'none', confidence: 0 }

// COO inclusion rule: only counts (fav) when a software/transformation signal is present in the
// title+JD text. Absent → routed to backlog (matched=false-priority) as a watch under COO.
const COO_SIGNAL = /(software|digital|transformation|product|technolog|platform|engineering|automation|data|ai)/i
// Director group: ordinary "Director of X" only qualifies as fav when Senior/Executive/Managing/Global.
const DIR_SENIOR = /\b(senior|executive|managing|global)\b/i

// Seniority band from the FULL title (un-cut, abbrev-expanded). This is authoritative for the GROUP
// bucket — more reliable than which seed title happened to fuzzy-match. Order matters: a VP-led
// hybrid ("VP, Chief X") stays vp; any Chief/C-x-O acronym (incl. CISO/CSO/CFO/CMO/CRO/CHRO/CLO/CDO)
// or President/Founder -> csuite; VP/SVP/EVP/AVP/Head/Executive -> vp (so Executive Director lands in
// VP & Head of); anything else with Director -> director. null when no seniority signal at all.
export function seniorityBand(rawTitle: string): Group | null {
  const s = normalize(rawTitle, { cut: false })
  if (/^(vp|svp|evp|avp)\b/.test(s)) return 'vp'                                   // VP-led hybrid wins
  if (/\b(chief|ceo|cto|cio|ciso|cso|cfo|coo|cpo|cmo|cro|chro|clo|cdo|caio|cdigo|cdatao|cxo|founder|president)\b/.test(s)) return 'csuite'
  if (/\b(vp|svp|evp|avp|head|executive)\b/.test(s)) return 'vp'
  if (/\bdirector\b/.test(s)) return 'director'
  return null
}

function entryResult(e: IndexEntry, method: MatchMethod, confidence: number): MatchResult {
  return { matched: true, group: e.group, roleSlug: e.roleSlug, role: e.role, variation: e.variation, title: e.title, tier: e.tier, isFavorite: e.tier === 'fav', method, confidence }
}

/**
 * Resolve a raw job-title string to a taxonomy entry.
 * Order: exact → alias(abbrev-expanded, same normalization) → fuzzy(trigram ≥ 0.82) → keyword.
 * `context` (optional JD text) is used only for the COO inclusion signal.
 * `backlog=true` in the result means matched a favorite role BUT failed its inclusion rule
 *   (COO w/o signal, ordinary Director) → should go to the role backlog, not the priority queue.
 */
export function resolveTitle(rawTitle: string, context = ''): MatchResult & { backlog: boolean } {
  const norm = normalize(rawTitle)
  if (!norm) return { ...NONE, backlog: false }
  let res: MatchResult | null = null

  const exact = INDEX.get(norm)
  if (exact) res = entryResult(exact, 'exact', 1)

  if (!res) {
    // alias: token-set equality (order-insensitive) against the normalized index
    const want = norm.split(' ').filter(Boolean).sort().join(' ')
    for (const e of ENTRIES) {
      if (e.norm.split(' ').filter(Boolean).sort().join(' ') === want) { res = entryResult(e, 'alias', 0.95); break }
    }
  }
  if (!res) {
    let best: IndexEntry | null = null, bestSim = 0
    for (const e of ENTRIES) { const sim = trigramSim(norm, e.norm); if (sim > bestSim) { bestSim = sim; best = e } }
    if (best && bestSim >= 0.82) res = entryResult(best, 'fuzzy', Number(bestSim.toFixed(3)))
  }
  if (!res) {
    // keyword fallback → tier watch (matched but not a seeded favorite). Seniority comes from the
    // FULL title (seniorityBand) so tokens after a separator ("Administration - SVP - ...") and
    // C-x-O acronyms (CISO/CSO/…) are seen even though `norm` was cut.
    const seniority: Group | null = seniorityBand(rawTitle)
    if (seniority) {
      const rk = seniority === 'csuite' ? ROLE_KEYWORDS.find((r) => r.kw.test(norm)) : null
      const fam = seniority !== 'csuite' ? FAMILY_KW.find((f) => f.kw.test(norm)) : null
      const role = rk ? rk.role : fam ? fam.role : null
      const roleSlug = rk ? rk.roleSlug : fam ? `${seniority}-${fam.slug}` : null
      res = { matched: true, group: seniority, roleSlug, role, variation: null, title: null, tier: 'watch', isFavorite: false, method: 'keyword', confidence: 0 }
    }
  }
  if (!res) return { ...NONE, backlog: false }

  // Group override: the seniority band (from the full title) is authoritative for the GROUP bucket,
  // even when a seed title fuzzy-matched into a different group. Fixes "Executive Director" (which
  // fuzzy-matches a Director seed title) landing in Director instead of VP & Head of. Keeps the seed's
  // role/variation/tier — only the coarse group bucket is corrected.
  const band = seniorityBand(rawTitle)
  if (band && res.group !== band) res = { ...res, group: band }

  // Inclusion rules — a favorite that fails its rule stays matched but goes to backlog (not priority).
  let backlog = false
  if (res.roleSlug === 'coo' && !COO_SIGNAL.test(`${rawTitle} ${context}`)) { backlog = true; res = { ...res, isFavorite: false } }
  if (res.group === 'director' && !DIR_SENIOR.test(norm)) {
    // ordinary Director → not a promoted favorite; backlog unless exceptional (exceptional handled upstream)
    if (res.tier === 'fav') { backlog = true; res = { ...res, isFavorite: false } }
  }
  return { ...res, backlog }
}

// Favorite scoring: base 0..100 + FAVORITE_BOOST when favorite, capped at 100.
export function scoreWithBoost(baseScore: number | null | undefined, isFavorite: boolean): number | null {
  if (baseScore == null) return isFavorite ? FAVORITE_BOOST : null
  return Math.min(100, baseScore + (isFavorite ? FAVORITE_BOOST : 0))
}

// Counts for seed-integrity checks (AC-9): groups, roles, titles.
export function seedCounts() {
  const groups = new Set(SEED.roles.map((r) => r.group))
  return { groups: groups.size, roles: SEED.roles.length, titles: SEED.titles.length, favorites: SEED.titles.filter((t) => t.tier === 'fav').length }
}

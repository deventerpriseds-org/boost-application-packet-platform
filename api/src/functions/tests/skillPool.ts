/**
 * Turning the owner's stored skills prose into a discrete, de-duplicated POOL.
 *
 * Pure functions only - no Azure client, no network - so `node --test` can exercise every rule
 * below against real text instead of a description of it. The route that reads MasterContext and
 * the seeder that writes rows both call THIS, so there is one definition of "what counts as a
 * skill" rather than one per caller.
 *
 * THE CONSTRAINT THAT SHAPES ALL OF IT: no fake data. CLAUDE.md - "do NOT fabricate it. Seed a real,
 * checked-in dataset or derive from the real distinct values present." So this module only ever
 * SPLITS and NORMALISES text the owner already wrote. It never invents, expands, infers a synonym,
 * or supplies a default list. If the sources are thin, the pool is thin, and that is a result to
 * report rather than a gap to fill.
 */

/** Where a candidate came from. Kept per-entry so the owner can tell the pool's composition. */
export type SkillOrigin = 'skills1' | 'skills2' | 'softHardSkillsPool' | 'expertise' | 'relevantProficiencies' | 'portfolio_slide'

export interface SkillCandidate {
  /** The skill as it will be shown and stored - the owner's own wording, whitespace-normalised. */
  term: string
  /** Lowercased, punctuation-trimmed. The de-duplication key ONLY; never displayed. */
  key: string
  /** Every field this term was found in, in first-seen order. A term in two sources is one entry. */
  origins: SkillOrigin[]
}

/**
 * Separators the owner's own prose actually uses. Newlines and bullets first, then the pipe (the
 * ATS run format this app already writes), then semicolons, then commas.
 *
 * COMMA IS DELIBERATELY LAST AND DELIBERATELY INCLUDED, and it is the risky one: "Mergers,
 * Acquisitions and Divestitures" is ONE skill and splitting it makes three. There is no way to tell
 * that apart from a comma-delimited list without guessing, so the rule is mechanical rather than
 * clever - see `looksLikeList` - and anything it cannot call confidently is left WHOLE. A pool with
 * a few over-long entries the owner can split is honest; a pool with invented fragments is not.
 */
const HARD_SEPARATORS = /[\n\r•·\|;]+/

/**
 * Trailing/leading punctuation and list NUMBERING the owner's formatting leaves behind.
 *
 * The digit rule is narrow on purpose, and the first draft got it wrong in a way a test caught:
 * stripping any leading digit turned "3D modelling" into "D modelling" and "5G architecture" into
 * "G architecture" - silently corrupting the owner's own skills, which is worse than dropping them.
 * So a digit is only list numbering when it is FOLLOWED by a delimiter: "2) Org design", "3. P&L".
 * A digit that begins a term is part of the term.
 */
const LIST_NUMBER = /^\s*\d+\s*[).:]\s+/
const EDGE_JUNK = /^[\s\-–—*+.,:;#)\]]+|[\s\-–—*+.,:;]+$/g

/**
 * Is this fragment a comma-delimited LIST, or one skill containing a comma?
 *
 * The test is structural, not semantic: a list has several comma-separated parts and its parts are
 * SHORT. "Kubernetes, Terraform, CI/CD" splits; "Mergers, Acquisitions and Divestitures" does not,
 * because two parts is not a list and the second part is long. This will occasionally keep a real
 * three-item list whole. That is the safe direction: an over-long entry is visible and fixable, a
 * fabricated fragment is neither.
 */
function looksLikeList(s: string): boolean {
  const parts = s.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length < 3) return false
  const longest = parts.reduce((n, p) => Math.max(n, p.split(/\s+/).length), 0)
  return longest <= 4
}

/** Collapse whitespace. Nothing else - the owner's capitalisation and wording are theirs. */
function tidy(s: string): string {
  return s.replace(LIST_NUMBER, '').replace(EDGE_JUNK, '').replace(/\s+/g, ' ').trim()
}

/** The de-duplication key. Case- and punctuation-insensitive so "SOC 2" and "SOC-2" are one entry. */
export function skillKey(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Split ONE source field into candidate terms.
 *
 * Exported so a test can pin the splitting rules independently of the merge, and so a caller can
 * show the owner what a single field yields before anything is combined.
 */
export function splitSkillField(text: string | null | undefined): string[] {
  if (!text || !String(text).trim()) return []
  const out: string[] = []
  for (const chunk of String(text).split(HARD_SEPARATORS)) {
    const t = tidy(chunk)
    // A chunk that tidies to NOTHING is still passed on rather than skipped here, so it reaches
    // isRejected and is reported with a reason. Dropping it silently at this point is precisely the
    // data loss the pool's own guard forbids, and the first draft did it.
    if (!t) { if (chunk.trim()) out.push(chunk.trim()); continue }
    if (looksLikeList(t)) {
      for (const part of t.split(',')) {
        const p = tidy(part)
        if (p) out.push(p)
      }
    } else {
      out.push(t)
    }
  }
  return out
}

/**
 * A term that is not a skill. Kept deliberately SMALL and structural.
 *
 * A long "stop phrase" list would be a judgement about the owner's own vocabulary, and this repo's
 * standing rule is that the owner's stored lists are fact ("the original skills lists i built are
 * based on fact so they can be referenced"). So this rejects only what cannot be a skill by SHAPE:
 * empty, a single punctuation mark, a bare number, or a sentence (a skill is a term, not prose).
 */
export function isRejected(term: string): { rejected: boolean; why: string | null } {
  if (!term) return { rejected: true, why: 'empty' }
  if (!/[a-z]/i.test(term)) return { rejected: true, why: 'no letters' }
  const words = term.split(/\s+/).length
  // 12 words is generous on purpose. "Enterprise architecture across multi-business-unit portfolios"
  // is a real executive skill; a 20-word line is a sentence that wandered in from a prose block.
  if (words > 12) return { rejected: true, why: `too long to be a term (${words} words)` }
  return { rejected: false, why: null }
}

export interface SkillPool {
  entries: SkillCandidate[]
  /** Per-source counts, so "which field gave us what" is visible rather than inferred. */
  bySource: Record<string, number>
  /** Terms dropped, WITH the reason. A silent drop is how a pool quietly loses the owner's data. */
  rejected: { term: string; why: string; origin: SkillOrigin }[]
  /** How many terms appeared in more than one source. */
  duplicates: number
}

/**
 * Build the pool from the raw source fields.
 *
 * Order matters only for `origins` (first-seen first). De-duplication is by `skillKey`, and the
 * FIRST spelling wins - the owner wrote it that way in the field they consider primary.
 */
export function buildSkillPool(sources: Partial<Record<SkillOrigin, string | null>>): SkillPool {
  const byKey = new Map<string, SkillCandidate>()
  const bySource: Record<string, number> = {}
  const rejected: { term: string; why: string; origin: SkillOrigin }[] = []
  let duplicates = 0

  for (const origin of Object.keys(sources) as SkillOrigin[]) {
    const terms = splitSkillField(sources[origin])
    bySource[origin] = 0
    for (const term of terms) {
      const r = isRejected(term)
      if (r.rejected) { rejected.push({ term, why: r.why!, origin }); continue }
      const key = skillKey(term)
      const seen = byKey.get(key)
      if (seen) {
        if (!seen.origins.includes(origin)) { seen.origins.push(origin); duplicates += 1 }
        continue
      }
      byKey.set(key, { term, key, origins: [origin] })
      bySource[origin] += 1
    }
  }
  return { entries: [...byKey.values()], bySource, rejected, duplicates }
}

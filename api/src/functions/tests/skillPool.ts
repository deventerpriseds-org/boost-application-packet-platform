/**
 * Turning the owner's stored skills prose into a discrete, de-duplicated POOL.
 *
 * Pure functions only - no Azure client, no network - so `node --test` can exercise every rule
 * below against real text instead of a description of it.
 *
 * WHO CALLS THIS, stated accurately because the previous sentence here was FALSE and an independent
 * AC pass caught it: as of 2026-08-26 the only importer in the repo is `api/test/skillPool.test.mjs`
 * (`grep -rn "from './skillPool'" api/src` = 0). `diagSkillSources.ts` returns the raw field text and
 * never calls the parser. The seeder that will write `skill_bank_entry` is the intended first
 * production consumer and is NOT built yet. Do not read this module's existence as evidence that
 * anything downstream is wired.
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
  /**
   * The owner's own grouping, when the source field carried one - "Governance and Compliance",
   * "Data Analytics and AI". `null` for the flat fields, which is a fact about the source rather
   * than a missing value, so it is never defaulted to a category name the owner did not write.
   */
  category: string | null
}

/**
 * Fields written `Category: term, term | Category: term, ...`.
 *
 * A SET, not a boolean argument, so adding a second two-level field later is a one-line change here
 * rather than a new code path - and so the declaration lives in exactly one place instead of at
 * every call site, where the two would eventually disagree.
 */
export const TWO_LEVEL_FIELDS: ReadonlySet<SkillOrigin> = new Set<SkillOrigin>(['relevantProficiencies'])

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
  return splitSkillFieldTagged(text).map(t => t.term)
}

/** One candidate from a field, carrying the category it sat under when the field has two levels. */
export interface TaggedTerm { term: string; category: string | null }

/**
 * Split ONE field into candidates, keeping the category when the field is TWO-LEVEL.
 *
 * `relevantProficiencies` is written `Category: term, term, term | Category: term, ...` - the only
 * field of the owner's five with a second level. Its ~36 terms were ALL being lost: the parser split
 * on `|` only, so each group arrived as one 15-27 word string and `isRejected` refused it for being
 * prose. Refusing was correct (the alternative was storing "Governance and Compliance: Standards and
 * Compliance, AI/ML Strategy, ..." as a single skill); the fix is to teach the split the second
 * level, not to loosen the guard.
 *
 * `twoLevel` IS A DECLARATION BY THE CALLER, NEVER A SNIFF, and that is the whole design. The
 * obvious implementation - reuse `looksLikeList` on the remainder - returns the right 36 terms today
 * and is a trap: it passes only because every group's longest part is <= 4 words, and
 * `Technology Strategy and Transformation` sits EXACTLY on that boundary (`Corporate AI Use Cases` =
 * 4). Add one 5-word proficiency later and `looksLikeList` returns false, the group collapses back to
 * a single chunk, `isRejected` refuses it at > 12 words, and THE ENTIRE CATEGORY SILENTLY VANISHES -
 * with every test still green, because every test was written against today's data. Declaring the
 * field two-level makes the `,` split unconditional and removes the boundary entirely.
 */
export function splitSkillFieldTagged(text: string | null | undefined, twoLevel = false): TaggedTerm[] {
  if (!text || !String(text).trim()) return []
  const out: TaggedTerm[] = []
  for (const chunk of String(text).split(HARD_SEPARATORS)) {
    const t = tidy(chunk)
    // A chunk that tidies to NOTHING is still passed on rather than skipped here, so it reaches
    // isRejected and is reported with a reason. Dropping it silently at this point is precisely the
    // data loss the pool's own guard forbids, and the first draft did it.
    if (!t) { if (chunk.trim()) out.push({ term: chunk.trim(), category: null }); continue }

    // FIRST colon only. `split(':')[1]` was measured to destroy two terms on a group whose term
    // itself contains a colon - it keeps one fragment and discards the rest of the line.
    //
    // FOUND ON THE RAW CHUNK, NOT ON `t`, and a guard caught the difference: `tidy` runs EDGE_JUNK,
    // which strips a TRAILING colon. So "Governance and Compliance:" tidies to
    // "Governance and Compliance" - the colon is gone before it can be seen, the chunk looks
    // single-level, and the CATEGORY NAME is pushed into the bank as one of the owner's skills.
    // Exactly the trap this branch exists to close, reintroduced by the tidy that runs before it.
    const rawChunk = chunk.replace(/\s+/g, ' ').trim()
    const colon = twoLevel ? rawChunk.indexOf(':') : -1
    if (colon > 0) {
      const category = tidy(rawChunk.slice(0, colon))
      // Strip the category BEFORE splitting, never after. Splitting first emits "Ops: Alpha" as a
      // term - a string the owner never wrote, which is fabrication rather than parsing.
      const remainder = rawChunk.slice(colon + 1)
      let any = false
      for (const part of remainder.split(',')) {
        const p = tidy(part)
        if (p) { out.push({ term: p, category: category || null }); any = true }
      }
      // "Governance and Compliance:" with nothing after it yields NOTHING - `any` stays false, no
      // term is pushed, and this `continue` skips the single-level fallback below. Falling through
      // would push the CATEGORY NAME as a skill, which is the one thing this branch must not do, and
      // the pre-change parser did exactly that for a trailing-colon group.
      //
      // `any` is computed but not branched on, deliberately: it documents the empty case at the
      // point it happens. An earlier draft wrote `if (!any) continue` immediately above this
      // `continue`, which read as a guard and was dead code - a verifier flagged it.
      void any
      continue
    }

    // Single-level chunk (either a one-level field, or a two-level field's malformed group with no
    // colon). Unchanged behaviour, `looksLikeList` and all - a group missing its category is still
    // the owner's data and is parsed as best it can be rather than dropped.
    if (looksLikeList(t)) {
      for (const part of t.split(',')) {
        const p = tidy(part)
        if (p) out.push({ term: p, category: null })
      }
    } else {
      out.push({ term: t, category: null })
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
  /**
   * Every reword the owner's stored map actually applied, from -> to.
   *
   * REPORTED, not silent, because a reword changes the owner's own words: the one place this module
   * departs from "only ever SPLITS and NORMALISES" and therefore the one place that must be
   * auditable. An empty array means the pool is verbatim.
   */
  reworded: { from: string; to: string; origin: SkillOrigin }[]
  /**
   * Map entries whose `from` matched NOTHING in any source field this run.
   *
   * A reword map drifts the moment the owner edits the underlying MasterContext field: the map still
   * says "rewrite X" while X no longer exists, and the term the owner actually typed instead sails
   * through unreworded. That failure is SILENT by nature - the pool still builds, the counts still
   * look plausible - which is why it is surfaced as data rather than left to be noticed. A non-empty
   * `staleRewords` means the map and the source have diverged and one of them is out of date.
   */
  staleRewords: string[]
}

/**
 * Build the pool from the raw source fields.
 *
 * Order matters only for `origins` (first-seen first). De-duplication is by `skillKey`, and the
 * FIRST spelling wins - the owner wrote it that way in the field they consider primary.
 */
export function buildSkillPool(
  sources: Partial<Record<SkillOrigin, string | null>>,
  opts: { rewords?: Record<string, string> } = {},
): SkillPool {
  const byKey = new Map<string, SkillCandidate>()
  const bySource: Record<string, number> = {}
  const rejected: { term: string; why: string; origin: SkillOrigin }[] = []
  const reworded: { from: string; to: string; origin: SkillOrigin }[] = []
  let duplicates = 0

  // Keyed by `skillKey` so the stored map is insensitive to the owner's casing and punctuation -
  // an entry typed "kpi-driven performance management" still matches the field's own spelling.
  const rewords = new Map<string, string>()
  const rewordLabel = new Map<string, string>()
  for (const [from, to] of Object.entries(opts.rewords || {})) {
    const t = String(to || '').trim()
    if (t) { rewords.set(skillKey(from), t); rewordLabel.set(skillKey(from), from) }
  }
  const rewordsUsed = new Set<string>()

  for (const origin of Object.keys(sources) as SkillOrigin[]) {
    const tagged = splitSkillFieldTagged(sources[origin], TWO_LEVEL_FIELDS.has(origin))
    bySource[origin] = 0
    for (const { term: raw, category } of tagged) {
      // REWORD BEFORE REJECT, deliberately. The whole reason a term is reworded is that the owner's
      // phrasing is a statement rather than a term; rejecting first would refuse it for the exact
      // property the reword exists to fix.
      //
      // ONE REPLACEMENT MAY YIELD SEVERAL TERMS, and it has to: "Budget Development and P&L
      // Management" is genuinely TWO of the owner's skills, and a 1:1 map silently dropped
      // "P&L Management" - a term of the owner's lost to a limitation of the map's shape, which is
      // the same data loss this module exists to prevent. The replacement is re-split with the same
      // separators the fields use, so the owner writes `Budget Development | P&L Management` in the
      // settings UI and gets two. Re-split ONCE, never recursively: a map entry cannot chain into
      // another map entry, so no cycle is possible.
      const replacement = rewords.get(skillKey(raw))
      if (replacement) rewordsUsed.add(skillKey(raw))
      const terms = replacement
        ? String(replacement).split(HARD_SEPARATORS).map(s => tidy(s)).filter(Boolean)
        : [raw]
      if (replacement) for (const t of terms) if (t !== raw) reworded.push({ from: raw, to: t, origin })

      for (const term of terms) {
        const r = isRejected(term)
        if (r.rejected) { rejected.push({ term, why: r.why!, origin }); continue }
        const key = skillKey(term)
        const seen = byKey.get(key)
        if (seen) {
          if (!seen.origins.includes(origin)) { seen.origins.push(origin); duplicates += 1 }
          // A term first seen without a category, then again under one, gains it. The reverse never
          // clears it - a category once known is not unlearned by a later uncategorised sighting.
          if (!seen.category && category) seen.category = category
          continue
        }
        byKey.set(key, { term, key, origins: [origin], category: category || null })
        bySource[origin] += 1
      }
    }
  }
  const staleRewords = [...rewords.keys()].filter(k => !rewordsUsed.has(k)).map(k => rewordLabel.get(k)!)
  return { entries: [...byKey.values()], bySource, rejected, duplicates, reworded, staleRewords }
}

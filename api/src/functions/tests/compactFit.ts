// The compact resume's ONE Core Skills line, built from the full resume's TWO.
//
// WHY THIS EXISTS. The owner's compact template ("ATS Polished Engineering Compact Resume
// Template") renders Core Skills as a single block where the full resume has `SkillsBullets1` and
// `SkillsBullets2` side by side. The owner's instruction: *"the skills are broken into two columns
// in the regular resume but its a single block in the compact resume so i think you should be
// starting with taking the two and making them one as a part of generating the compact resume. if
// overspill of space becomes an issue, it should be flagged. the least relevent item could be
// removed to make it fit and i should be notified that happened in the right margin."*
//
// Pure on purpose: no pg, no fetch, no @azure/functions, so `node --test` exercises the DROP
// DECISION directly. This module decides what leaves a document the owner sends to employers, and a
// decision like that must be testable without a database.
//
// ── HOW "LEAST RELEVANT" IS DECIDED, AND WHY IT IS NOT `confidence` ────────────────────────────
//
// The obvious ranking is `swap_decision.confidence`. MEASURED AGAINST THE LIVE TABLE, it cannot
// rank anything: over the skills lists it holds exactly two values —
//
//     driver         rows   with requirement_id   confidence
//     unattributed     37                     0        0.000
//     posting           4                     3        0.500
//
// Every row that could ever be in the drop pool scores 0.000, so ordering by it is a coin flip
// dressed as a measurement. The signal that DOES discriminate is what the pipeline did and why:
//
//     action + driver              rows   meaning
//     swapped + posting               4   answers a specific line of the posting  -> NEVER dropped
//     swapped/added + unattributed    9   the pipeline put this here FOR this posting
//     kept + unattributed            27   master-list content answering nothing here -> drop pool
//
// So relevance is a small ordered set of facts, not a score. `RANK` below is that order, and the
// repo's standing rule is respected: fuzzy matching is for ranking, never for accusing, and naming
// an item to delete from a resume is accusing. Nothing here is fuzzy — every input is an exact
// enum value the pipeline already recorded.
//
// A tie inside the drop pool breaks on POSITION, highest `seq` first: the end of a skills line is
// where the least load-bearing item sits, and it is deterministic, which a "pick one" never is.

export type SwapAction = 'kept' | 'swapped' | 'merged' | 'dropped' | 'added'
export type SwapDriver = 'posting' | 'rule' | 'unattributed'

export interface SkillProvenance {
  label: string
  action?: SwapAction | null
  driver?: SwapDriver | null
  /** Present when the item answers a specific requirement. Its PRESENCE is the signal, not its value. */
  requirementId?: string | null
  seq?: number | null
}

export interface CompactFitInput {
  /** The full resume's two lists, in document order. */
  skills1: string[]
  skills2: string[]
  /** One row per skill the pipeline recorded. Items with no row are treated as unattributed keeps. */
  provenance?: SkillProvenance[]
  /** Characters the compact template's Core Skills line can hold. An owner setting, never a constant here. */
  budget: number
  /** How items are joined in the rendered line. Counted against the budget, because it is real text. */
  separator?: string
}

export interface DroppedSkill {
  label: string
  /** Why this one and not another — the words that go in the margin. */
  reason: string
}

export interface CompactFitResult {
  /** What the compact document ships, already joined. */
  text: string
  kept: string[]
  /** In the order they were removed, so the margin can say "these, in this order". */
  dropped: DroppedSkill[]
  /** Length of the full combined list before anything was removed. */
  fullLength: number
  budget: number
  /** True when nothing had to go. */
  fits: boolean
  /**
   * There is no Core Skills content at all — both source lists were empty or blank.
   *
   * WITHOUT THIS, an empty line reported `fits: true` with `dropped: []` and the check printed
   * "Core Skills fits: 0 of 320 chars" — a PASS on a blank section of a document the owner sends to
   * employers, which is the exact failure this module exists to prevent, arriving through the front
   * door. Absent content is not a satisfied constraint.
   */
  empty?: boolean
  /**
   * The configured budget could not be read (null, NaN, <= 0). Nothing was dropped — content is
   * shipped unchanged — and this says the fit was never actually enforced, so a reader is never told
   * "it fits" on the strength of a measurement that did not happen.
   */
  budgetUnreadable?: boolean
  /**
   * Set when the line STILL does not fit after every droppable item is gone. The remaining items all
   * answer the posting, and silently deleting one of those would remove evidence the packet's own
   * coverage claims depend on. It ships over budget and SAYS SO instead.
   */
  overBudgetAfterDrops?: boolean
}

export const DEFAULT_SEPARATOR = ' | '

/** Lower rank leaves first. Only these three tiers exist, and every input is an exact enum value. */
function rankOf(p: SkillProvenance | undefined): number {
  if (!p) return 0                                        // no record at all: treat as master content
  // D-4. A row the pipeline ALREADY removed cannot protect the label. Checking `driver` first made
  // a `dropped`+`posting` row rank 2, and two live skills were deleted to preserve an item that was
  // not in the document at all. Proven by execution before this line was written.
  if (p.action === 'dropped') return 0
  if (p.driver === 'posting' || p.requirementId) return 2 // answers the posting - never dropped
  if (p.action === 'swapped' || p.action === 'added') return 1
  return 0
}

/**
 * D-1, and it falsified this module's central safety property.
 *
 * A label can carry MORE THAN ONE provenance row — it appears in both skills lists, or a later pass
 * recorded it again. Keeping the FIRST row meant the ORDER of rows decided whether a skill survived:
 * with identical data, `Kubernetes` answering `req-9` was DELETED when its `kept/unattributed` row
 * came first and KEPT when its `posting` row came first. Measured by running the built module, not
 * read. The unit test passed throughout because it never gave one label two rows.
 *
 * The rank of a label is therefore the STRONGEST claim any row makes about it. Erring toward keeping
 * is the only safe direction: the cost of keeping one item too many is a slightly long line, and the
 * cost of dropping one too few is deleting evidence the packet's coverage claims depend on.
 */
function rankForLabel(rows: SkillProvenance[]): number {
  return rows.reduce((best, r) => Math.max(best, rankOf(r)), 0)
}

const norm = (s: string) => String(s || '').trim().toLowerCase()

/**
 * Combine the two skills lists into the compact resume's single line, dropping the least relevant
 * items ONLY as far as the budget requires.
 *
 * Order is preserved for everything that survives: this reflows a line, it does not re-sort the
 * owner's skills. Duplicates across the two lists are collapsed once — the same skill printed twice
 * on one line is a defect, and the full resume's two columns hide it in a way one block does not.
 */
export function fitCompactSkills(input: CompactFitInput): CompactFitResult {
  const sep = input.separator ?? DEFAULT_SEPARATOR
  // D-2. `Number(x) || 0` turned NaN/null into a budget of ZERO, so every skill was deleted and the
  // result reported `fits: true` — a blank Core Skills line declared a success. A budget that cannot
  // be read is a CONFIGURATION failure, and the safe response to one is to ship the content
  // unchanged, never to empty the section. Proven by execution: `budget: NaN` returned
  // `{ text: '', kept: [], fits: true }`.
  const rawBudget = Number(input.budget)
  const budgetUsable = Number.isFinite(rawBudget) && rawBudget > 0
  const budget = budgetUsable ? rawBudget : Number.POSITIVE_INFINITY

  const byLabel = new Map<string, SkillProvenance[]>()
  for (const p of (input.provenance || [])) {
    if (!p || !p.label) continue
    const k = norm(p.label)
    if (!byLabel.has(k)) byLabel.set(k, [])
    byLabel.get(k)!.push(p)
  }

  // Combined, in document order, de-duplicated.
  const seen = new Set<string>()
  const items: string[] = []
  for (const raw of [...(input.skills1 || []), ...(input.skills2 || [])]) {
    const label = String(raw || '').trim()
    if (!label || seen.has(norm(label))) continue
    seen.add(norm(label))
    items.push(label)
  }

  const join = (list: string[]) => list.join(sep)
  const fullLength = join(items).length

  if (fullLength <= budget || items.length === 0) {
    return {
      text: join(items), kept: items, dropped: [], fullLength,
      budget: budgetUsable ? budget : 0, fits: true,
      ...(items.length === 0 ? { empty: true } : {}),
      ...(budgetUsable ? {} : { budgetUnreadable: true }),
    }
  }

  // Droppable, worst first: rank ascending, then LAST position first.
  // D-3. This sorted on `swap_decision.seq`, which RESTARTS PER LIST (`schema.ts` keys it
  // `unique (packet_id, list, seq, loop)`), so an item from skills_2 could out-rank one from
  // skills_1 by position alone and the wrong skill was dropped. Every unit test passed
  // `skills2: []` — the tie-break was untested in the only configuration this feature exists for.
  // The correct ordinal is the item's index in the COMBINED line, which is what "the end of the
  // line" means to a reader.
  const droppable = items
    .map((label, i) => ({ label, i, rank: rankForLabel(byLabel.get(norm(label)) || []) }))
    .filter((x) => x.rank < 2)
    .sort((a, b) => (a.rank - b.rank) || (b.i - a.i))

  const gone = new Set<number>()
  const dropped: DroppedSkill[] = []
  for (const cand of droppable) {
    if (join(items.filter((_, i) => !gone.has(i))).length <= budget) break
    gone.add(cand.i)
    dropped.push({
      label: cand.label,
      reason: cand.rank === 0
        ? 'from your master list and answers nothing in this posting'
        : 'added for this posting but not tied to a specific requirement',
    })
  }

  const kept = items.filter((_, i) => !gone.has(i))
  const text = join(kept)
  return {
    text, kept, dropped, fullLength, budget,
    fits: text.length <= budget,
    // Everything left answers the posting. Ship it long and say so rather than delete evidence.
    ...(text.length > budget ? { overBudgetAfterDrops: true } : {}),
  }
}

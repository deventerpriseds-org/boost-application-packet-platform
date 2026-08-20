// P1.3 — skill_candidate and swap_decision. The record of what the pipeline CHANGED and why.
//
// The packet screen shows all originals against all finals, so an unchanged item is data, not noise:
// "we looked at this and kept it" is a different statement from "we never considered it".
//
// HOW THIS MAPS ONTO THE REAL PIPELINE (pipeline.ts buildPackageForJD, mt17.assemblePackage):
//   Call 1 (resume writer)  -> skills1/skills2/relevant1..3          = origin `pass_a`
//   Call 3 (ATS QC + merge) -> finalSkills1/2, finalRelevant1..3     = origin `pass_b`
//   assemblePackage prefers Call 3 over Call 1 per slot — THAT preference is the swap decision, and
//   it is recoverable from the three payloads with no model call, which is what the acceptance
//   ("rendering the swap table requires no model call") demands.
//
// DRIVER, and a correction to an earlier correction. The backlog asks for `driver='rule'` on
// omission-list drops "so they are never presented as posting-driven", and this module first claimed
// no omission list existed. That was wrong, and confirmed wrong against the source: the resume prompt
// interpolates {{289877659__Items to Omit}}, zapVars.ts maps it to MasterContext.itemsToOmit, and
// mt-13 verifies live that all 15 MasterContext fields including that one are present and non-empty.
// So a drop that matches the owner's do-not-use list IS rule-driven, and is recorded as such.
// `unattributed` remains for the genuinely unexplained: a change that neither a requirement nor the
// omission list accounts for. That is the failure P2.2 needs to see, and it must not be diluted by
// laundering rule-driven drops into it — or by inventing a rule for a model's unexplained choice.
import { normalizePostingText } from './jdText'

export type ListKey = 'skills_1' | 'skills_2' | 'relevant_1' | 'relevant_2' | 'relevant_3'
export type Origin = 'profile_original' | 'pass_a' | 'pass_b'
export type Action = 'kept' | 'swapped' | 'merged' | 'dropped' | 'added'
export type Driver = 'posting' | 'rule' | 'unattributed'

export const LISTS: ListKey[] = ['skills_1', 'skills_2', 'relevant_1', 'relevant_2', 'relevant_3']

/** Where each list's pass-A, pass-B and final text live, by their REAL field names. */
export const LIST_FIELDS: Record<ListKey, { passA: string; passB: string; merge: string }> = {
  skills_1:   { passA: 'skills1',   passB: 'finalSkills1',   merge: 'SkillsBullets1' },
  skills_2:   { passA: 'skills2',   passB: 'finalSkills2',   merge: 'SkillsBullets2' },
  relevant_1: { passA: 'relevant1', passB: 'finalRelevant1', merge: 'RelevantBullets1' },
  relevant_2: { passA: 'relevant2', passB: 'finalRelevant2', merge: 'RelevantBullets2' },
  relevant_3: { passA: 'relevant3', passB: 'finalRelevant3', merge: 'RelevantBullets3' },
}

/**
 * Split a bullets block into items. Mirrors mt17.splitSkills' separators exactly — if this split
 * disagreed with the one that built the package, the rows would describe a different list than the
 * one the document actually contains.
 */
export function splitItems(block: any): string[] {
  const s = block == null ? '' : String(block).trim()
  if (!s) return []
  return s.split(/\r?\n|(?:\s*[|•·]\s*)/)
    .map(l => l.replace(/^[-*•·\s]+/, '').trim())
    .filter(Boolean)
}

const STOP = new Set(('a an the and or of in on at to for with by from as is are was were be been ' +
  'this that these those it its we you they our your their will would can could should may must ' +
  'across within while during per via using use used including include strong proven demonstrated ' +
  'experience experienced skills ability able years year leading lead led drive driven driving').split(/\s+/))

export function itemTokens(text: string): string[] {
  return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'+#.\-]*/g)?.filter(t => !STOP.has(t) && t.length > 1) || []
}

/**
 * Containment: how much of the SHORTER item the two share. Deterministic, no model, symmetric.
 *
 * Deliberately not Jaccard, which divides by the union and so punishes length asymmetry — the exact
 * shape a rewrite takes. "Led roadmap work" -> "Owned the integrated product roadmap for corporate
 * hiring technology" scores 0.25 by Jaccard and would be filed as an unrelated drop plus an add,
 * losing the fact that one became the other. By containment it is 0.5: the same item, expanded.
 */
export function similarity(a: string, b: string): number {
  const A = new Set(itemTokens(a)), B = new Set(itemTokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

/** Same item, reworded. Below this they are different items (a drop plus an add). */
export const SWAP_THRESHOLD = 0.5
/** Byte-level identity after normalisation — a `kept` row. */
export const normItem = (s: string) => normalizePostingText(s).toLowerCase().replace(/[.;:,]+$/, '').trim()

/** The owner's do-not-use list, normalised once. Entries shorter than 3 chars are ignored. */
export function omitEntries(omitList: string): string[] {
  return splitItems(omitList || '').map(normItem).filter(x => x.length > 2)
}

/**
 * Is this item on the owner's do-not-use list?
 *
 * Exact match or whole-phrase containment ONLY — deliberately not fuzzy similarity. Similarity
 * compares content tokens after dropping stopwords and short tokens, so "Skill number 0" and
 * "Skill number 3" both reduce to {skill, number} and score 1.0. A fuzzy rule therefore accuses
 * every near-identical label of being banned when one of them is. Naming an innocent item as a
 * violation is worse than missing one, because the whole value of this check is that its offender
 * list can be acted on without re-reading everything.
 */
export function onOmitList(label: string, omitted: string[]): boolean {
  const n = normItem(label)
  if (!n) return false
  return omitted.some(o => n === o || new RegExp(`(^|\\W)${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(n))
}

export interface CandidateRow { list: ListKey; label: string; origin: Origin; char_len: number }

export interface SwapRow {
  list: ListKey
  action: Action
  from_label: string | null
  to_label: string | null
  requirement_seq: number | null   // resolved to requirement_id at persist time
  verbatim_quote: string | null
  confidence: number               // 0..1, the attribution's token overlap
  driver: Driver
  rationale: string
}

export interface RequirementRef { seq: number; verbatim: string | null; item_text: string; kind: string }

/**
 * Attribute a changed item to the posting requirement that best explains it.
 *
 * Matches against the requirement's VERBATIM (the employer's words) when it has one, so the quote
 * this returns is always something the employer actually wrote. A requirement with no located
 * verbatim can still be matched on its item_text, but then it carries no quote and the caller must
 * treat it as unattributed — a citation needs a source, not a paraphrase.
 */
export const ATTRIBUTION_THRESHOLD = 0.34
export function attribute(text: string, requirements: RequirementRef[]): { seq: number; quote: string; confidence: number } | null {
  let best: { seq: number; quote: string; confidence: number } | null = null
  for (const r of requirements) {
    if (!r.verbatim) continue
    const c = similarity(text, r.verbatim)
    if (c >= ATTRIBUTION_THRESHOLD && (!best || c > best.confidence)) best = { seq: r.seq, quote: r.verbatim, confidence: c }
  }
  return best
}

export interface BuildSwapsInput {
  call1: any
  call3: any
  pkg: Record<string, any>
  requirements?: RequirementRef[]
  profileText?: string      // MasterContext profile, when available — marks items as pre-existing
  omitList?: string         // MasterContext.itemsToOmit — the owner's do-not-use list
}

export interface BuildSwapsResult {
  candidates: CandidateRow[]
  swaps: SwapRow[]
  itemCount: number         // total items across all five FINAL lists
  unattributed: number      // swapped/added rows no requirement explains — P2.2 surfaces these
}

/**
 * Derive the candidate and swap rows for one generated package.
 *
 * Every item in every list produces a row, INCLUDING unchanged ones. Matching is greedy by
 * similarity and each final may be claimed once, so an original is never reported as swapped into a
 * final that another original already accounts for. When two originals collapse onto one final the
 * second is `merged`, not a second `swapped` — otherwise the table would claim the document contains
 * two bullets where it contains one.
 */
export function buildSwaps(input: BuildSwapsInput): BuildSwapsResult {
  const { call1 = {}, call3 = {}, pkg = {}, requirements = [], profileText = '', omitList = '' } = input
  const omitted = omitEntries(omitList)
  const profileNorm = normItem(profileText || '')
  const candidates: CandidateRow[] = []
  const swaps: SwapRow[] = []
  let itemCount = 0

  for (const list of LISTS) {
    const f = LIST_FIELDS[list]
    const originals = splitItems(call1[f.passA])
    const finals = splitItems(pkg[f.merge] ?? call3[f.passB])
    itemCount += finals.length

    const originOf = (label: string, fallback: Origin): Origin =>
      profileNorm && profileNorm.includes(normItem(label)) && normItem(label).length > 8 ? 'profile_original' : fallback

    for (const o of originals) candidates.push({ list, label: o, origin: originOf(o, 'pass_a'), char_len: o.length })
    const originalNorms = new Set(originals.map(normItem))
    for (const fin of finals) {
      if (originalNorms.has(normItem(fin))) continue     // already recorded as its pass-A self
      candidates.push({ list, label: fin, origin: originOf(fin, 'pass_b'), char_len: fin.length })
    }

    const claimed = new Set<number>()

    for (const o of originals) {
      const exact = finals.findIndex((x, i) => !claimed.has(i) && normItem(x) === normItem(o))
      if (exact >= 0) {
        claimed.add(exact)
        swaps.push(row(list, 'kept', o, finals[exact], null, 'unchanged from the first pass'))
        continue
      }
      let bestI = -1, bestC = 0
      for (let i = 0; i < finals.length; i++) {
        if (claimed.has(i)) continue
        const c = similarity(o, finals[i])
        if (c > bestC) { bestC = c; bestI = i }
      }
      if (bestI >= 0 && bestC >= SWAP_THRESHOLD) {
        claimed.add(bestI)
        swaps.push(row(list, 'swapped', o, finals[bestI], attribute(finals[bestI], requirements), 'reworded by the ATS pass'))
        continue
      }
      // No FREE final matches. Before calling it dropped, check the finals another original already
      // claimed: two bullets collapsing into one is a merge, and reporting the second as `dropped`
      // would tell the reviewer its content is missing from the document when it is in fact present.
      let mergeI = -1, mergeC = 0
      for (let i = 0; i < finals.length; i++) {
        if (!claimed.has(i)) continue
        const c = similarity(o, finals[i])
        if (c > mergeC) { mergeC = c; mergeI = i }
      }
      if (mergeI >= 0 && mergeC >= SWAP_THRESHOLD) {
        swaps.push(row(list, 'merged', o, finals[mergeI], attribute(finals[mergeI], requirements),
          'folded into an item that already covers it'))
      } else if (onOmitList(o, omitted)) {
        // Never presented as posting-driven: the owner's list removed it, not the employer's words.
        swaps.push({
          list, action: 'dropped', from_label: o, to_label: null, requirement_seq: null,
          verbatim_quote: null, confidence: 0, driver: 'rule',
          rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)',
        })
      } else {
        swaps.push(row(list, 'dropped', o, null, attribute(o, requirements), 'not carried into the final list'))
      }
    }

    for (let i = 0; i < finals.length; i++) {
      if (claimed.has(i)) continue
      swaps.push(row(list, 'added', null, finals[i], attribute(finals[i], requirements), 'introduced by the ATS pass'))
    }
  }

  const unattributed = swaps.filter(s => (s.action === 'swapped' || s.action === 'added') && s.driver !== 'posting').length
  return { candidates, swaps, itemCount, unattributed }
}

function row(list: ListKey, action: Action, from: string | null, to: string | null,
             att: { seq: number; quote: string; confidence: number } | null, rationale: string): SwapRow {
  // `kept` is not a change, so it is never presented as posting-driven even when the text happens to
  // resemble a requirement. Only an actual change can be attributed to the posting.
  const attributable = action === 'swapped' || action === 'added' || action === 'dropped'
  return {
    list, action, from_label: from, to_label: to,
    requirement_seq: attributable && att ? att.seq : null,
    verbatim_quote: attributable && att ? att.quote : null,
    confidence: attributable && att ? Math.round(att.confidence * 1000) / 1000 : 0,
    driver: attributable && att ? 'posting' : 'unattributed',
    rationale,
  }
}

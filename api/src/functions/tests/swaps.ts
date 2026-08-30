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

export type ListKey = 'skills_1' | 'skills_2' | 'relevant_1' | 'relevant_2' | 'relevant_3' | 'expertise'
export type Origin = 'profile_original' | 'pass_a' | 'pass_b'
export type Action = 'kept' | 'swapped' | 'merged' | 'dropped' | 'added'
export type Driver = 'posting' | 'rule' | 'unattributed' | 'owner'

export const LISTS: ListKey[] = ['skills_1', 'skills_2', 'relevant_1', 'relevant_2', 'relevant_3', 'expertise']

/**
 * Where each list's pass-A, pass-B and final text live, by their REAL field names.
 *
 * `expertise`'s field names are READ FROM THE ASSEMBLER, not assumed. `mt17.ts:150` is
 * `ExpertiseBullets: firstNonEmpty(call1.expertise, call3.finalExpertise, call3.expertise)` and
 * `pipeline.ts:504` interpolates `c1.expertise` — so Call 1 writes `expertise`, Call 3 writes
 * `finalExpertise`, and the merged package field is `ExpertiseBullets`. Naming `passA` after the
 * merge field instead would leave the Call-1 fallback structurally dead for this list: with no
 * master block the baseline would be empty and every shipped expertise item would be reported as
 * `added`.
 *
 * NOTE FOR THE DB: `swap_decision.list`'s CHECK does not admit `'expertise'` until an explicit
 * ALTER runs (`schema.ts:594-596` — a create-if-not-exists is a no-op on an existing table).
 * `writeSwaps` probes for it rather than letting a rejected insert abort the whole transaction.
 */
export const LIST_FIELDS: Record<ListKey, { passA: string; passB: string; merge: string }> = {
  skills_1:   { passA: 'skills1',   passB: 'finalSkills1',   merge: 'SkillsBullets1' },
  skills_2:   { passA: 'skills2',   passB: 'finalSkills2',   merge: 'SkillsBullets2' },
  relevant_1: { passA: 'relevant1', passB: 'finalRelevant1', merge: 'RelevantBullets1' },
  relevant_2: { passA: 'relevant2', passB: 'finalRelevant2', merge: 'RelevantBullets2' },
  relevant_3: { passA: 'relevant3', passB: 'finalRelevant3', merge: 'RelevantBullets3' },
  expertise:  { passA: 'expertise', passB: 'finalExpertise', merge: 'ExpertiseBullets' },
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
  /**
   * Labels the OWNER wrote themselves, from `correction` rows with `source='owner_edit'`.
   * A row whose `to_label` is one of these is theirs, not the model's, and is driven by 'owner'.
   */
  ownerLabels?: string[]
  /**
   * THE OWNER'S MASTER TEMPLATE TEXT, keyed by MERGE FIELD — `masterBaseline(mc)` from
   * `evidence.ts:211`, loaded by `loadMasterBaseline()` in `appInsertions.ts:25`.
   *
   * THIS IS THE "ORIGINAL". Before this existed the `from_label` on every swap row came from
   * `call1[passA]` — the MODEL'S FIRST DRAFT — and a live measurement on 2026-08-29 found 9 of 14
   * swap rows naming an "original" that is nowhere in the owner's master. The reviewer reading
   * "Enterprise Governance → X" was being shown one model output replacing another and told it was
   * their own resume being changed.
   *
   * Only fields with a non-empty block are present (`evidence.ts:215`), and a MasterContext read
   * failure yields `{}` (`appInsertions.ts:33`). Both mean the same thing here — no master text is
   * known for that field — and both fall back to `call1[passA]` rather than reporting the owner's
   * entire list as invented. `ListCounts.baselineSource` says which was used, so nothing downstream
   * has to guess.
   */
  master?: Record<string, string>
  /**
   * FIXED SLOT COUNTS PER MERGE FIELD, injected. `slots['SkillsBullets1'] = 11` means that list has
   * eleven slots on the rendered page.
   *
   * INJECTED ON PURPOSE — this module is pure and must stay that way (H12: it is exercised by
   * `node --test` with neither the Azure host nor a database available). The per-template config
   * store owns the numbers; it passes `templateRow.slots` straight in. This file never reads config.
   *
   * The owner settled the precedence: *"fixed slot counts change per template"* — so it is
   * per-template or UNKNOWN, with no master-derived fallback. See `slotsFor`.
   */
  slots?: Record<string, number | null>
}

/**
 * Per-list counts, so the caller can REPORT a fixed-slot violation instead of `buildSwaps` throwing.
 *
 * WHY A RETURN VALUE AND NOT A THROW. `appPackets.ts:617-622` wraps `writeSwaps` in a try/catch that
 * swallows into `console.warn`, and `checks.ts:906-908` turns "no swap rows" into
 * `changes_cited: not_applicable`. So a throw here would build the packet, leave the swap table
 * EMPTY, and print a green-ish gate with no mention of the violation — the quietest possible
 * failure, which is the opposite of what a violation should be.
 */
export interface ListCounts {
  list: ListKey
  mergeField: string
  /** Which text the `from_label`s came from. `none` = the list has no baseline text at all. */
  baselineSource: 'master' | 'call1' | 'none'
  originalCount: number
  finalCount: number
  /** The fixed slot count, or null for UNKNOWN. NEVER 0 — a 0 would declare every item illegal. */
  slots: number | null
  slotSource: 'template' | 'unknown'
  /** === `slots`. `null` ⇒ the caller's check must be `not_applicable`, never `pass` and never `fail`. */
  expected: number | null
  /** === `finalCount`, the number of items the document actually carries in this list. */
  observed: number
  /** `expected !== null && observed !== expected`. The caller reports it; nothing here throws. */
  mismatch: boolean
  kept: number
  swapped: number
  merged: number
  dropped: number
  added: number
  /** Unpaired BASELINE leftovers — the offender list for a `dropped`-side violation. */
  droppedLabels: string[]
  /** Unpaired FINAL leftovers — the offender list for an `added`-side violation. */
  addedLabels: string[]
}

export interface BuildSwapsResult {
  candidates: CandidateRow[]
  swaps: SwapRow[]
  itemCount: number         // total items across every FINAL list
  unattributed: number      // swapped/added rows no requirement explains — P2.2 surfaces these
  /** One row per list. The documented way for `checks.ts` to see a fixed-slot violation. */
  lists: ListCounts[]
}

/**
 * Resolve a merge field's fixed slot count.
 *
 * PRECEDENCE, settled by the owner: the per-template number, else UNKNOWN. There is deliberately no
 * master-derived fallback — *"fixed slot counts change per template"*, so a count read off the
 * master would be right for one template and silently wrong for the next.
 *
 * `null` IS THE THIRD STATE AND IT IS NOT ZERO. `appInsertions.ts:33` returns `{}` on any Storage
 * failure and a missing template row supplies nothing, so "no number" is a routine outcome. A
 * derived 0 would declare every item in the list illegal — an accusation built on absent evidence,
 * which the standing rule forbids twice over ("absent evidence is `not_applicable`, never `pass`",
 * and equally never `fail`). A non-finite, negative or zero input is treated as UNKNOWN for the
 * same reason.
 */
export function slotsFor(mergeField: string, slots?: Record<string, number | null>)
  : { n: number | null; source: 'template' | 'unknown' } {
  const raw = slots ? slots[mergeField] : undefined
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : NaN
  if (Number.isFinite(n) && n > 0) return { n, source: 'template' }
  return { n: null, source: 'unknown' }
}

/**
 * Derive the candidate and swap rows for one generated package.
 *
 * Every item in every list produces a row, INCLUDING unchanged ones. Each final may be claimed once,
 * so an original is never reported as swapped into a final that another original already accounts
 * for. When two originals collapse onto one final the second is `merged`, not a second `swapped` —
 * otherwise the table would claim the document contains two bullets where it contains one.
 *
 * The pairing itself is set-membership then position, NOT similarity — see the block comment on
 * `buildSwaps` below for why, and `BuildSwapsInput.master` for what "original" now means.
 */
/**
 * The rationale for an item removed from one list because the SHIPPED package already carries it in
 * another. Exported because the app matches it exactly, the same way it matches the omit rationale.
 *
 * WHY THIS EXISTS. `'not carried into the final list'` was written on these drops, and it is FALSE
 * ABOUT THE DOCUMENT: the item IS carried, in a different list. `dedupeAcrossLists`
 * (`normalise.ts:100-123`) runs inside `normalisePackage` at `appPackets.ts:561`, which is BEFORE
 * `writeSwaps` at `:618` and mutates the very `pkg` handed to it — so the deleted item reaches
 * `buildSwaps` as an original with no matching final and falls to the generic branch.
 *
 * Two things went wrong downstream of that one false sentence, and the second is why this is not
 * cosmetic. `restoreOptions` (`app/src/assetBlocks.js`) offers "Put back X" for every dropped row
 * that is not omit-driven, so it offered to restore an item the NEXT build removes again — the
 * self-undoing control that function was written to prevent, arriving through a producer its guard
 * could not see. `dedupeAcrossLists` is pure and deterministic and re-runs on every build.
 *
 * THE TEST IS AGAINST THE SHIPPED DOCUMENT, NOT AGAINST A REPORT OF WHO ACTED. This deliberately
 * does not ask `normalisePackage` what it changed. "This item is present in another list of the
 * package we are shipping" is verifiable from the package itself and is true no matter which code
 * removed it — so the sentence cannot become a guess about a producer, which is the failure the
 * honest-absence rule forbids. An item removed for any other reason still gets the generic
 * rationale, because that one is then true.
 */
export const CROSS_LIST_RATIONALE_PREFIX = 'already listed in '
export const crossListRationale = (mergeField: string): string =>
  `${CROSS_LIST_RATIONALE_PREFIX}${mergeField}; kept there rather than listed twice`

/**
 * THE PAIRING RULE, and why it is set-membership first and POSITION second.
 *
 * The old rule paired an original with whichever unclaimed final scored highest by `similarity()`
 * above `SWAP_THRESHOLD`, and called everything else a drop plus an add. Two things were wrong with
 * it once the "original" became the owner's master rather than the model's draft:
 *
 *  1. SIMILARITY IS FOR RANKING, NEVER FOR ACCUSING (the standing rule). It drops stopwords, so
 *     "Skill number 0" and "Skill number 3" both reduce to {skill, number} and score 1.0. A swap row
 *     NAMES the owner's line as the thing that was replaced; deciding that by fuzzy score is exactly
 *     the accusation-by-similarity the repo forbids.
 *  2. THE LISTS ARE FIXED SLOTS. Slot i of the master and slot i of the shipped document are the
 *     same position on the same page. Once the labels present in BOTH are matched off as `kept`,
 *     what remains on each side, in order, is what filled which slot — a fact about position, not a
 *     guess about meaning.
 *
 * So: match the intersection first (order-independent, so a reordered final produces `kept`, not a
 * pile of false swaps), then zip the two leftover sequences by relative position. A positional pair
 * is an observation that these two occupy the same slot. It is NEVER, on its own, a claim that the
 * employer asked for it — `attribute()` still has to earn that, and below the threshold the row is
 * `unattributed` with no quote (see `row`).
 */
export function buildSwaps(input: BuildSwapsInput): BuildSwapsResult {
  const { call1 = {}, call3 = {}, pkg = {}, requirements = [], profileText = '', omitList = '' } = input
  const master: Record<string, string> = input.master || {}
  // Exact strings, because a label either IS the wording the owner typed or it is not. A fuzzy
  // membership test here would let the model's paraphrase inherit the owner's exemption from the
  // gate, which is the one thing decision B must not allow.
  const ownerLabels = new Set((input.ownerLabels || []).map((l) => String(l == null ? '' : l)).filter(Boolean))
  const omitted = omitEntries(omitList)
  const profileNorm = normItem(profileText || '')
  const candidates: CandidateRow[] = []
  const swaps: SwapRow[] = []
  const lists: ListCounts[] = []
  let itemCount = 0

  // Where each item of the SHIPPED package lives, so a drop can say whether the document still
  // carries it elsewhere. Built once over every list before any list is walked, because the answer
  // for `skills_1` depends on `relevant_3` and vice versa.
  const shippedIn = new Map<string, string>()
  for (const l of LISTS) {
    const lf = LIST_FIELDS[l]
    for (const item of splitItems(pkg[lf.merge] ?? call3[lf.passB])) {
      const n = normItem(item)
      if (n && !shippedIn.has(n)) shippedIn.set(n, lf.merge)
    }
  }

  for (const list of LISTS) {
    const f = LIST_FIELDS[list]

    // THE BASELINE — the owner's master template text, NOT the model's first draft.
    // `masterBaseline` only returns blocks that are non-empty, and a MasterContext read failure
    // returns `{}` entirely, so an absent key means "no master text is known for this field".
    // Falling back to Call 1 there keeps the row honest in the only way available; reporting zero
    // originals would claim the packet invented every line the owner already had.
    const masterItems = splitItems(master[f.merge])
    const call1Items = splitItems(call1[f.passA])
    const fromMaster = masterItems.length > 0
    const originals = fromMaster ? masterItems : call1Items
    const baselineSource: ListCounts['baselineSource'] =
      fromMaster ? 'master' : (originals.length ? 'call1' : 'none')
    const finals = splitItems(pkg[f.merge] ?? call3[f.passB])
    itemCount += finals.length
    const slot = slotsFor(f.merge, input.slots)

    // A label that IS the owner's master text is pre-existing by definition. Recording it as
    // `pass_a` ("Call 1, the resume writer") would be false about who wrote it, and
    // `profile_original` is the enum value that means exactly "already the candidate's"
    // (`skill_candidate.origin check in ('profile_original','pass_a','pass_b')`).
    const masterNorms = new Set(masterItems.map(normItem))
    const originOf = (label: string, fallback: Origin): Origin => {
      const n = normItem(label)
      if (n && masterNorms.has(n)) return 'profile_original'
      return profileNorm && n && profileNorm.includes(n) && n.length > 8 ? 'profile_original' : fallback
    }

    for (const o of originals) candidates.push({ list, label: o, origin: originOf(o, 'pass_a'), char_len: o.length })
    const originalNorms = new Set(originals.map(normItem))
    for (const fin of finals) {
      if (originalNorms.has(normItem(fin))) continue     // already recorded as its baseline self
      candidates.push({ list, label: fin, origin: originOf(fin, 'pass_b'), char_len: fin.length })
    }

    // ── PHASE 1: SET MEMBERSHIP. A label present in BOTH lists is `kept`, wherever it sits. ──────
    // Order-independent on purpose: a final list the model reordered has changed nothing about the
    // document's content, and pairing it by position would mint a page of false swaps naming the
    // owner's own lines. Duplicates are matched off one for one (a multiset, not a set) so a list
    // containing the same label twice cannot have one copy claimed twice.
    const claimed = new Set<number>()
    const freeFinalsByNorm = new Map<string, number[]>()
    for (let i = 0; i < finals.length; i++) {
      const n = normItem(finals[i])
      const q = freeFinalsByNorm.get(n)
      if (q) q.push(i); else freeFinalsByNorm.set(n, [i])
    }
    const pairFor = new Map<number, number>()          // baseline index -> final index
    const positional = new Set<number>()               // which of those pairs came from PHASE 2
    for (let oi = 0; oi < originals.length; oi++) {
      const q = freeFinalsByNorm.get(normItem(originals[oi]))
      if (!q || !q.length) continue
      const fi = q.shift() as number
      claimed.add(fi)
      pairFor.set(oi, fi)
    }

    // ── PHASE 2: POSITION. What is left on each side, each in its own list order, occupies the ───
    // slots the kept items did not. Leftover i of the master filled slot i of what remains, so it
    // pairs with leftover i of the final. Explicitly NOT by similarity: a swap row names the owner's
    // line as the thing that was replaced, and similarity drops stopwords, so near-identical labels
    // score 1.0 and the wrong line gets named. Fuzzy is for ranking, never for accusing.
    const leftOrig: number[] = []
    for (let oi = 0; oi < originals.length; oi++) if (!pairFor.has(oi)) leftOrig.push(oi)
    const leftFinal: number[] = []
    for (let fi = 0; fi < finals.length; fi++) if (!claimed.has(fi)) leftFinal.push(fi)
    const nPos = Math.min(leftOrig.length, leftFinal.length)
    for (let k = 0; k < nPos; k++) {
      pairFor.set(leftOrig[k], leftFinal[k])
      positional.add(leftOrig[k])
      claimed.add(leftFinal[k])
    }

    const c = { kept: 0, swapped: 0, merged: 0, dropped: 0, added: 0 }
    const droppedLabels: string[] = []
    const addedLabels: string[] = []

    for (let oi = 0; oi < originals.length; oi++) {
      const o = originals[oi]
      const fi = pairFor.get(oi)
      if (fi !== undefined && !positional.has(oi)) {
        swaps.push(row(list, 'kept', o, finals[fi], null,
          fromMaster ? 'unchanged from the master template' : 'unchanged from the first pass', ownerLabels))
        c.kept++
        continue
      }
      if (fi !== undefined) {
        // A POSITIONAL PAIR IS AN OBSERVATION ABOUT A SLOT, NOT A CITATION. `attribute` still has to
        // clear ATTRIBUTION_THRESHOLD against a requirement's VERBATIM for this to carry a quote;
        // below it `row` writes driver 'unattributed' with a null quote, null seq and confidence 0 —
        // which is also what `swap_decision`'s CHECK ((driver='posting') = (verbatim_quote is not
        // null)) demands. Position tells you which line was replaced; it never tells you the
        // employer asked for the replacement.
        swaps.push(row(list, 'swapped', o, finals[fi], attribute(finals[fi], requirements),
          fromMaster ? 'replaces the master template item in this slot' : 'replaces the first-pass item in this slot',
          ownerLabels))
        c.swapped++
        continue
      }
      // UNPAIRED BASELINE LEFTOVER — there were more baseline items than final items, which under a
      // fixed slot count IS the violation. It is reported as an honest `dropped` row (and surfaced
      // to the caller through `ListCounts`), never thrown: `appPackets.ts:617-622` swallows a throw
      // into a console.warn and the packet then ships with an EMPTY swap table.
      //
      // Before calling it dropped, two truths outrank the generic sentence, because writing
      // "removed" about text the document still carries is the false-statement class this module
      // has already paid for twice:
      //   (a) its content was folded into a final another baseline item is paired with — `merged`;
      //   (b) it is carried by a DIFFERENT shipped list — the cross-list rationale.
      // (a) does not re-open similarity pairing: no final is consumed and no pair changes. It only
      // decides which true sentence to write about a leftover that is already unpaired.
      let mergeI = -1, mergeC = 0
      for (let i = 0; i < finals.length; i++) {
        if (!claimed.has(i)) continue
        const s = similarity(o, finals[i])
        if (s > mergeC) { mergeC = s; mergeI = i }
      }
      if (mergeI >= 0 && mergeC >= SWAP_THRESHOLD) {
        swaps.push(row(list, 'merged', o, finals[mergeI], attribute(finals[mergeI], requirements),
          'folded into an item that already covers it', ownerLabels))
        c.merged++
      } else if (onOmitList(o, omitted)) {
        // Never presented as posting-driven: the owner's list removed it, not the employer's words.
        swaps.push({
          list, action: 'dropped', from_label: o, to_label: null, requirement_seq: null,
          verbatim_quote: null, confidence: 0, driver: 'rule',
          rationale: 'on the owner do-not-use list (MasterContext.itemsToOmit)',
        })
        c.dropped++
        droppedLabels.push(o)
      } else {
        // Present in ANOTHER shipped list? Then it was not "not carried" — it is carried, elsewhere,
        // and saying otherwise is false about the document the owner is about to send.
        const elsewhere = shippedIn.get(normItem(o))
        swaps.push(row(list, 'dropped', o, null, attribute(o, requirements),
          elsewhere && elsewhere !== f.merge ? crossListRationale(elsewhere) : 'not carried into the final list',
          ownerLabels))
        c.dropped++
        droppedLabels.push(o)
      }
    }

    // UNPAIRED FINAL LEFTOVER — more items shipped than the baseline had. The other half of the
    // same violation, and again reported rather than thrown or padded. Fabricating a partner to
    // make the counts agree would be the "never fabricate a composite" failure in its purest form.
    for (let k = nPos; k < leftFinal.length; k++) {
      const fi = leftFinal[k]
      swaps.push(row(list, 'added', null, finals[fi], attribute(finals[fi], requirements),
        fromMaster ? 'not present in the master template list' : 'not present in the first-pass list',
        ownerLabels))
      c.added++
      addedLabels.push(finals[fi])
    }

    lists.push({
      list, mergeField: f.merge, baselineSource,
      originalCount: originals.length, finalCount: finals.length,
      slots: slot.n, slotSource: slot.source,
      expected: slot.n, observed: finals.length,
      mismatch: slot.n !== null && finals.length !== slot.n,
      ...c, droppedLabels, addedLabels,
    })
  }

  // OWNER ROWS ARE NOT UNATTRIBUTED, and this count must agree with changes_cited or the packet
  // contradicts itself: the gate passes while the number printed beside it says N changes cite
  // nothing. 'Unattributed' means the MODEL made a change it cannot explain. An owner explaining
  // their own resume to the tool was never the question.
  const unattributed = swaps.filter(s =>
    (s.action === 'swapped' || s.action === 'added') && s.driver !== 'owner' && s.driver !== 'posting').length
  return { candidates, swaps, itemCount, unattributed, lists }
}

function row(list: ListKey, action: Action, from: string | null, to: string | null,
             att: { seq: number; quote: string; confidence: number } | null, rationale: string,
             ownerLabels?: Set<string>): SwapRow {
  // `kept` is not a change, so it is never presented as posting-driven even when the text happens to
  // resemble a requirement. Only an actual change can be attributed to the posting.
  const attributable = action === 'swapped' || action === 'added' || action === 'dropped'
  return {
    list, action, from_label: from, to_label: to,
    requirement_seq: attributable && att ? att.seq : null,
    verbatim_quote: attributable && att ? att.quote : null,
    confidence: attributable && att ? Math.round(att.confidence * 1000) / 1000 : 0,
    // THE OWNER'S OWN WORDING OUTRANKS BOTH, and this branch is what makes decision B reachable
    // rather than decorative. Without it NOTHING ever emits 'owner': an edit the owner made comes
    // back through the next build as a label the model did not plan, scores under
    // ATTRIBUTION_THRESHOLD against every requirement, and lands 'unattributed' - so changes_cited
    // FAILS the packet and prints the owner's own words as the offender. That is the exact failure
    // the exemption in checks.ts claims to prevent, and it stayed live because the exemption had
    // nothing to exempt. Found by an independent verifier, not by the guards, which passed on
    // hand-built {driver:'owner'} fixtures the system never produced.
    //
    // Checked BEFORE attribution on purpose: an owner edit that happens to resemble a requirement
    // must not be recorded as posting-driven. They did not cite the employer, and a citation they
    // did not make is the quieter half of decision B.
    driver: (to && ownerLabels && ownerLabels.has(to)) ? 'owner'
      : attributable && att ? 'posting' : 'unattributed',
    rationale,
  }
}

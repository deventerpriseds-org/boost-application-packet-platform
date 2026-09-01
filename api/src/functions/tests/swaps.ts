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
// THE POOLED-FIELD PARSER, REUSED RATHER THAN REWRITTEN. `skillPool.ts` already owns the rules for
// `Category: term, term | Category: …` — first-colon-only, category stripped BEFORE the comma split,
// a trailing-colon group emitting NOTHING so a category name can never become a term, and the
// deliberate refusal to SNIFF the second level (`H:skill-pool-two-level-split-is-declared-never-
// sniffed`). A third splitter here would be the parallel system "Extend, don't duplicate" forbids,
// and it would drift from the pool the skill bank is built from.
//
// THE IMPORT DIRECTION IS FORCED, and it is worth recording why this file does NOT import the
// merge-field→MasterContext-key map from `evidence.ts`, which is where that map lives:
// `evidence.ts` → `reviewer.ts` → `insertions.ts` → `swaps.ts` is a CYCLE. `skillPool.ts` is a leaf
// (zero imports), so importing it is safe and keeps this module pure. The key is therefore
// re-declared on `LIST_FIELDS` below and pinned to `evidence.MASTER_BASELINE_FIELD` by a parity
// test (`H:master-key-parity`), which is the same shape as the DDL-parity guards elsewhere.
import { splitSkillFieldTagged, TWO_LEVEL_FIELDS, SkillOrigin } from './skillPool'

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
export const LIST_FIELDS: Record<ListKey, { passA: string; passB: string; merge: string; masterKey: string }> = {
  skills_1:   { passA: 'skills1',   passB: 'finalSkills1',   merge: 'SkillsBullets1',   masterKey: 'skills1' },
  skills_2:   { passA: 'skills2',   passB: 'finalSkills2',   merge: 'SkillsBullets2',   masterKey: 'skills2' },
  relevant_1: { passA: 'relevant1', passB: 'finalRelevant1', merge: 'RelevantBullets1', masterKey: 'relevantProficiencies' },
  relevant_2: { passA: 'relevant2', passB: 'finalRelevant2', merge: 'RelevantBullets2', masterKey: 'relevantProficiencies' },
  relevant_3: { passA: 'relevant3', passB: 'finalRelevant3', merge: 'RelevantBullets3', masterKey: 'relevantProficiencies' },
  expertise:  { passA: 'expertise', passB: 'finalExpertise', merge: 'ExpertiseBullets', masterKey: 'expertise' },
}

/**
 * Is this list's MASTER block a pooled two-level field (`Category: term, term | Category: …`)?
 *
 * Read off `skillPool.TWO_LEVEL_FIELDS`, never re-listed here — the declaration lives in exactly one
 * place, which is the whole reason that set exists as a set rather than a boolean argument.
 *
 * NOTE the deliberate asymmetry with the Call-1 fallback: `call1.relevant1` is an ORDINARY per-list
 * block the resume writer produced, NOT a pool. Only the MASTER text for these fields is two-level.
 * So this flag gates the master split alone, and `poolMode` in `buildSwaps` additionally requires
 * `fromMaster` — splitting a Call-1 relevant list with the two-level parser would be wrong.
 */
export const isPooledMasterField = (list: ListKey): boolean =>
  TWO_LEVEL_FIELDS.has(LIST_FIELDS[list].masterKey as SkillOrigin)

/** One baseline item, with the owner's own grouping when the source field carried one. */
export interface BaselineItem { label: string; category: string | null }

/**
 * Split a list's MASTER block into baseline items.
 *
 * THE DEFECT THIS FIXES, measured in production 2026-08-30 (`swap_decision`, live rows):
 * all 15 relevant rows carried a `from_label` that was a whole CATEGORY GROUP — e.g. the 149-char
 * `"Governance and Compliance: Standards and Compliance, AI/ML Strategy, Cybersecurity Leadership,
 * Data Strategy, Policy Development, Customer-Centricity"` — presented to the owner as one
 * "original" skill of theirs. `splitItems` splits on `|`/newline/bullet only, so the pooled block's
 * five groups arrived whole, and the identical five strings appeared in ALL THREE relevant lists:
 * 15 rows derived from 5 source strings. `evidence.ts:193-195` is why all three share the key.
 *
 * `isRejected` is deliberately NOT applied. The skill BANK rejects a >12-word fragment because a
 * pool of skills must not contain prose; a BASELINE is a record of what the owner's block said, and
 * dropping part of it would under-report their own text. A malformed group therefore survives here
 * as one long item — visible and honest — rather than vanishing.
 *
 * INHERITED CONSTRAINT, stated rather than re-decided: inside a two-level group the comma split is
 * UNCONDITIONAL (`skillPool.ts:156`), so a single proficiency containing a comma — the
 * "Mergers, Acquisitions and Divestitures" shape — would split. That trade-off was made in
 * `skillPool.ts` with its own tests and its own reasoning; re-deciding it here would be the second
 * splitter this import exists to avoid. The live field contains no such term (36 terms, verified).
 */
export function splitBaselineItems(list: ListKey, block: any): BaselineItem[] {
  if (!isPooledMasterField(list)) return splitItems(block).map(label => ({ label, category: null }))
  return splitSkillFieldTagged(block, true).map(t => ({ label: t.term, category: t.category }))
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
  /**
   * `pool` when the baseline is the owner's POOLED two-level block shared by several lists
   * (`relevantProficiencies` — see `splitBaselineItems`), `list` when it is this list's own text.
   *
   * It is not decoration: under `pool` the pairing DELIBERATELY stops after set-membership, so a
   * reader comparing `originalCount` against the emitted rows would otherwise conclude rows were
   * lost. See the block comment on PHASE 2 in `buildSwaps`.
   */
  baselineMode: 'list' | 'pool'
  /**
   * Pooled baseline terms this list did not use. `0` for a `list` baseline, where an unused
   * baseline item is a `dropped` row instead.
   *
   * REPORTED AS A NUMBER, NEVER AS `droppedLabels`. The pool holds 36 terms and a relevant list has
   * 2-3 slots, so ~33 non-selections per list is the NORMAL state — naming them would put ~99 of
   * the owner's own proficiencies on screen under "Taken out of this list"
   * (`app/src/screens/AssetBlocks.jsx:404-411`) and would accuse each of them three times over.
   */
  unusedBaseline: number
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
    const masterBase = splitBaselineItems(list, master[f.merge])
    const masterItems = masterBase.map(b => b.label)
    const call1Items = splitItems(call1[f.passA])
    const fromMaster = masterItems.length > 0
    const originals = fromMaster ? masterItems : call1Items
    const baselineSource: ListCounts['baselineSource'] =
      fromMaster ? 'master' : (originals.length ? 'call1' : 'none')
    // POOL MODE requires BOTH: the master field is two-level AND the master is what we are actually
    // using. The Call-1 fallback is an ordinary per-list block written by the resume writer, so a
    // list that fell back keeps the fixed-slot pairing it has always had.
    const poolMode = fromMaster && isPooledMasterField(list)
    // The owner's own grouping for a pooled term, so a `kept` row can name it. Keyed by `normItem`
    // because that is the key everything else in this function pairs on.
    const categoryOf = new Map<string, string>()
    for (const b of masterBase) {
      const n = normItem(b.label)
      if (n && b.category && !categoryOf.has(n)) categoryOf.set(n, b.category)
    }
    /**
     * THE CATEGORY, CARRIED WITHOUT A SCHEMA CHANGE — requirement 2, and the mechanism was chosen by
     * checking who READS it, not by adding a field.
     *
     * `swap_decision` has no category column, and adding an unpersisted `from_category` to `SwapRow`
     * would ship write-only — the exact defect `.claude/memory.md` records for `correction.frame`
     * (written, never selected, `tsc` silent because the field was optional). `rationale` IS a
     * persisted free-text column and IS returned by `GET /api/app/packet/{id}/swaps`
     * (`appSwaps.ts` selects `s.*`), so the category travels on it.
     *
     * SAFE AGAINST THE TWO EXACT-MATCH CONSUMERS, checked before writing it:
     *   - `OMIT_LIST_RATIONALE` is compared with `===` and only on `action==='dropped' && driver==='rule'`
     *     (`app/src/assetBlocks.js:596`);
     *   - `CROSS_LIST_RATIONALE_PREFIX` is `startsWith`, anchored at position 0, and only on `dropped`
     *     (`assetBlocks.js:566,642`).
     * This suffix is appended ONLY to `kept` rows, so it can collide with neither, and
     * `AssetBlocks.jsx:588` excludes `kept` from the rendered rationale list.
     */
    const withCategory = (label: string, text: string): string => {
      const cat = categoryOf.get(normItem(label))
      return cat ? `${text} (${cat})` : text
    }
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
    //
    // ── AND WHY POOL MODE SWITCHES PHASE 2 OFF ENTIRELY ──────────────────────────────────────────
    // The justification above is that the two lists are THE SAME FIXED SLOTS: `skills1` has 11
    // master items for 11 slots, so leftover i of the master genuinely occupied the slot leftover i
    // of the final now occupies. That premise is FALSE for a pool. `relevantProficiencies` holds 36
    // terms (measured live 2026-08-30) and `relevant_1` ships 3 items — pool term #k never occupied
    // slot #k, and there is nothing in the data that says which of the 36 belongs to which of the
    // three lists. Pairing them by index is accusation-by-arbitrary-position, the same class of
    // error as the accusation-by-similarity this phase was written to replace, and inventing the
    // missing assignment would be the "never fabricate a composite" failure.
    //
    // So under `poolMode` nothing is paired past set-membership: a final that IS one of the owner's
    // terms is `kept`, and everything else in the list is an honest `added` with a null `from_label`.
    // "This is not one of your 36 terms" is true, actionable and names no innocent original.
    const leftOrig: number[] = []
    for (let oi = 0; oi < originals.length; oi++) if (!pairFor.has(oi)) leftOrig.push(oi)
    const leftFinal: number[] = []
    for (let fi = 0; fi < finals.length; fi++) if (!claimed.has(fi)) leftFinal.push(fi)
    const nPos = poolMode ? 0 : Math.min(leftOrig.length, leftFinal.length)
    for (let k = 0; k < nPos; k++) {
      pairFor.set(leftOrig[k], leftFinal[k])
      positional.add(leftOrig[k])
      claimed.add(leftFinal[k])
    }

    const c = { kept: 0, swapped: 0, merged: 0, dropped: 0, added: 0 }
    const droppedLabels: string[] = []
    const addedLabels: string[] = []
    let unusedBaseline = 0

    for (let oi = 0; oi < originals.length; oi++) {
      const o = originals[oi]
      const fi = pairFor.get(oi)
      if (fi !== undefined && !positional.has(oi)) {
        swaps.push(row(list, 'kept', o, finals[fi], null,
          fromMaster ? withCategory(o, 'unchanged from the master template') : 'unchanged from the first pass',
          ownerLabels))
        c.kept++
        continue
      }
      // POOL MODE: an unpaired pooled term was never IN this list, so there is no true sentence to
      // write about it and NO ROW IS EMITTED. Every branch below states something about this list —
      // "dropped", "merged into", "on the do-not-use list", "already listed in X" — and all four are
      // false of a term the list never held. Concretely: 36 pooled terms against a 3-slot list
      // leaves ~33 leftovers per list, ~99 across the three, each rendered under "Taken out of this
      // list" (`AssetBlocks.jsx:404-411`) and each accused three times. The `merged` fallback is the
      // sharpest of the four, because it is `similarity() >= SWAP_THRESHOLD`: measured on the live
      // data, similarity('AI/ML Strategy', 'AI/ML & Data Plan') = 0.67, so the owner's own term
      // would be reported as folded into a final in whichever lists happened to score — fuzzy
      // matching used to ACCUSE, which this repo forbids outright.
      //
      // It is counted, not silent: `ListCounts.unusedBaseline` carries the number so a caller can
      // say "3 of your 36 proficiencies are on this list" without naming 33 offenders.
      if (poolMode) { unusedBaseline++; continue }
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
      // In POOL MODE this is EVERY final that is not verbatim one of the owner's terms, and the
      // sentence has to say pool rather than "this list": the owner never had a `RelevantBullets1`
      // list to be absent from, they had 36 proficiencies. "not present in the master pool" is the
      // one statement that is true of the document, of the master, and of all three lists at once.
      swaps.push(row(list, 'added', null, finals[fi], attribute(finals[fi], requirements),
        poolMode ? 'not present in the master pool'
          : fromMaster ? 'not present in the master template list' : 'not present in the first-pass list',
        ownerLabels))
      c.added++
      addedLabels.push(finals[fi])
    }

    lists.push({
      list, mergeField: f.merge, baselineSource,
      baselineMode: poolMode ? 'pool' : 'list', unusedBaseline,
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
  // THE DRIVER IS DECIDED FIRST, AND THE CITATION IS DERIVED FROM IT. The three citation fields
  // used to be computed independently from `att`, which let a row carry `driver='owner'` AND a
  // `verbatim_quote` at the same time — see F-1 below.
  const driver: Driver = (to && ownerLabels && ownerLabels.has(to)) ? 'owner'
    : attributable && att ? 'posting' : 'unattributed'
  // ONLY A 'posting' ROW MAY CARRY A CITATION, and that is a DB contract, not a preference:
  // `swap_decision` has `check ((driver = 'posting') = (verbatim_quote is not null))`
  // (`schema.ts`). Deriving the quote from `driver` rather than from `att` makes the two sides of
  // that equivalence impossible to separate here.
  //
  // FINDING F-1, found by the independent verifier on this branch and PRE-EXISTING (the same shape
  // was live before the pairing rewrite). An owner-typed line that happens to match a requirement's
  // verbatim scored above ATTRIBUTION_THRESHOLD, so `att` was non-null while the owner branch above
  // set `driver='owner'` — producing `driver='owner'` with a non-NULL quote. Postgres REJECTS that
  // row, which aborts the whole `writeSwaps` transaction, and `appPackets.ts:617-622` swallows the
  // throw into a console.warn — so ONE such row shipped the packet with a COMPLETELY EMPTY swap
  // table, every list, and `changes_cited: not_applicable` beside it. The quietest possible failure,
  // triggered by the owner editing a line to say what the employer asked for, which is the single
  // most likely edit they make.
  //
  // Suppressing the quote is also the semantically right answer, not just the one the CHECK accepts:
  // the owner did not cite the employer. Recording a citation they never made is the quieter half of
  // decision B wearing the DB's clothes.
  const cites = driver === 'posting' && att
  return {
    list, action, from_label: from, to_label: to,
    requirement_seq: cites ? att.seq : null,
    verbatim_quote: cites ? att.quote : null,
    confidence: cites ? Math.round(att.confidence * 1000) / 1000 : 0,
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
    driver,
    rationale,
  }
}

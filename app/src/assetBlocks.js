// P5.2 — the pure logic behind the asset blocks screen (the React component lives in
// screens/AssetBlocks.jsx, per the same split overlay.js / shell.jsx already uses).
//
// It sits in a plain .js module for ONE reason: Node's built-in test runner can import it with no
// DOM and no new dependency. It could not before — the logic lived in a .jsx that does
// `import React from 'react'`, so `node --test` refused to load it ("Unknown file extension .jsx")
// and NOTHING here was covered. That is exactly how the item-count bug below shipped.
//
// THE RULE THIS MODULE ENFORCES: a number the card prints is the number the API ROW carries.
// `insertion.item_count` is what the API measured and what the checks were run against
// (api/src/functions/tests/insertions.ts: `item_count: generated ? splitItems(after).length : 0`).
// Re-measuring `after_text` in the browser and printing THAT lets the card out-vote the row its own
// gate was computed from. The split below still runs — a list has to draw its lines from somewhere —
// but it never supplies the count, and when the two disagree the disagreement is SHOWN.

/**
 * Every `data-qc` selector the asset-blocks card renders.
 *
 * Same constant, same rule, same reason as GATE_HOOKS (assetGate.js) and QC_HOOKS (qcRail.js):
 * ui-verify.yml selects by CSS only, this card had ZERO hooks, and so every claim P5.2 makes about
 * it - the row's count wins, a shared swap says it is packet-level, an unmeasurable stat reads as
 * unknown - was only assertable by matching prose. The component hand-types none of these.
 *
 * `root` also carries data-qc-open. The card's field blocks default OPEN; the ASSET header in
 * PacketBuilder defaults CLOSED (PACKET_HOOKS.assetHeader). They are different objects and the two
 * defaults are deliberately opposite, which is exactly why both are readable from the DOM: a fix
 * that flips the wrong one has to be visible.
 */
import { markRuns } from './highlight.js'

export const BLOCK_HOOKS = {
  root: 'asset-blocks',            // the card root (carries data-qc-open)
  toggle: 'blocks-toggle',         // show/hide the blocks
  meter: 'blocks-meter',           // "what is in this asset"
  stat: 'blocks-stat',             // one measured stat
  note: 'blocks-note',             // a stat that could not be measured, stated as unknown
  field: 'blocks-field',           // one merge field (carries data-qc-field / data-qc-static)
  mismatch: 'blocks-count-mismatch',
  shared: 'blocks-packet-level',   // a swap recorded against the packet, not this asset
  quote: 'blocks-posting-quote',   // the posting's own words echoed onto this asset
  compareToggle: 'blocks-compare-toggle',
  before: 'blocks-before',
  meterToggle: 'blocks-answers-toggle',   // the disclosure on "What this X answers"
  meterSummary: 'blocks-answers-summary', // the counts kept on the COLLAPSED row
  askChange: 'blocks-ask-change',         // per-field "List Tweaks" (prototype: "Ask for a change")
  askBox: 'blocks-ask-box',
  askSend: 'blocks-ask-send',
  // SPEC 4.7-7. The ask box confirmed FAILURE in place and said nothing at all on success - it just
  // closed. A reader could not tell "sent and applied" from "the button did nothing", which is the
  // asymmetry this hook exists to close.
  askSent: 'blocks-ask-sent',
  // SPEC 4.11-8. The caveat is DERIVED and conditional - absent when no rule-driven drop was
  // recorded for this field - so its absence is assertable and it can never claim a revert that
  // is not going to happen.
  omitCaveat: 'blocks-omit-caveat',
  restore: 'blocks-restore-original',    // SPEC 4.11-5 "Put back an original", one per real candidate
  shorten: 'blocks-shorten-to-fit',      // SPEC 4.11-5 "Shorten to fit", carrying the field's real rule
  forward: 'blocks-forward-assistant',   // SPEC 4.7-8 - sends the field's sentence UP to the panel
  fieldSlot: 'blocks-field-slot',         // the raw merge field, kept beside the human name
  fieldPlaceholder: 'blocks-field-placeholder', // 4.5-40 - the {{token}} inline, where merged text lands
  fieldObserved: 'blocks-field-observed',  // the measurement, coloured by this field's worst finding
  fieldTarget: 'blocks-field-target',     // the rule the field is held to, from the owner's thresholds
  fieldChangeLog: 'blocks-corrected-for-you', // the field's own "Corrected for you" list (P8.6 inline).
  fieldFindings: 'blocks-field-findings',     // the field's own open findings, all severities
  fieldFinding: 'blocks-field-finding',       // one of them (carries data-qc-sev)
  keywordChips: 'blocks-keyword-chips',       // the field's PROPOSED ATS keywords (never scoreable)
  keywordChip: 'blocks-keyword-chip',         // one of them (carries data-qc-keyword)
  keywordDetail: 'blocks-keyword-detail',     // the panel a chip opens
  keywordActions: 'blocks-keyword-actions',   // 4.6-10/11 - "Not comfortable claiming this?"
  keywordDrop: 'blocks-keyword-drop',         // seeds the field's ask box with a drop REQUEST
  keywordSwap: 'blocks-keyword-swap',         // 4.6-9 - the picker of the owner's OWN banked skills
  keywordNoAction: 'blocks-keyword-no-action', // why no drop is offered, said rather than implied
  fieldWordingKept: 'blocks-wording-kept',    // "Wording kept from the posting", in the field's margin
  reqLegend: 'blocks-req-legend',             // what RQ-MH / RQ-NTH / RESP mean, once per asset
  wordingAsk: 'blocks-wording-ask',           // seeds the field's own ask box with a reword request
  meterClear: 'blocks-answers-clear',          // checked, and nothing open - NOT the unchecked state
  meterCorrected: 'blocks-answers-corrected', // "N corrected" kept on the COLLAPSED row
  meterToFix: 'blocks-answers-to-fix',        // "N to fix"   - deterministic fails
  meterToReview: 'blocks-answers-to-review',  // "N to review" - warns
  meterYourCall: 'blocks-answers-your-call',  // "N your call" - reviewer fails, which never block
  // NOT named `corrections`: corrections.test.mjs forbids /\.corrections\b/ in any .jsx so no
  // component can read `result.corrections` instead of the selector, and BLOCK_HOOKS.corrections
  // would trip it on a name collision alone. The guard is right; the key gets the different name.
  fallback: 'blocks-fallback',     // the stored content dump, when there are no rows at all
  empty: 'blocks-empty',
}

// ── text shaping ────────────────────────────────────────────────────────────────────────────────

/**
 * Split a bullets block into its lines. Separators mirror splitItems() in
 * api/src/functions/tests/swaps.ts.
 *
 * This is a RENDERING aid only: it decides what text each line shows, never how many lines the card
 * claims. Keeping the two regexes in step is not something anything enforces, so nothing important
 * is allowed to depend on them agreeing.
 */
export function splitItems(block) {
  const s = block == null ? '' : String(block).trim()
  if (!s) return []
  return s
    .split(/\r?\n|(?:\s*[|•·]\s*)/)
    .map((l) => l.replace(/^[-*•·\s]+/, '').trim())
    .filter(Boolean)
}

export const wordCount = (s) => (String(s || '').trim().match(/\S+/g) || []).length

// Loose comparison used ONLY to line a document item up with the swap row that produced it. It
// never decides anything: a miss just means the item renders without its arrow, so it is allowed to
// be forgiving in a way an accusation-grade check never is. Trims BEFORE stripping end punctuation
// so a label ending "roadmap. " matches one ending "roadmap" — it did not, and the arrow silently
// went missing on any item with trailing whitespace.
export const normLabel = (s) => String(s || '').toLowerCase().trim().replace(/[.;:,]+$/, '').replace(/\s+/g, ' ').trim()

/** The row's own count, or null when the row does not carry one (an older row, a bad payload). */
export function itemCountOf(row) {
  const n = Number(row && row.item_count)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * What the card draws and what it CLAIMS, kept apart on purpose.
 *   items      — the lines to draw, split from the text (rendering only)
 *   count      — the number to print: the ROW's item_count whenever it has one
 *   splitCount — what the browser's split measured, kept so a disagreement can be named
 *   disagrees  — the two do not match; the card must say so rather than pick silently
 * With no recorded count the split is all there is, and `count` falls back to it — stated, not
 * hidden, by `recorded === null`.
 */
export function deriveItems(row) {
  const items = splitItems(row && row.after_text)
  const recorded = itemCountOf(row)
  return {
    items,
    splitCount: items.length,
    recorded,
    count: recorded === null ? items.length : recorded,
    disagrees: recorded !== null && recorded !== items.length,
  }
}

/**
 * Said out loud on the card when the row's count and the browser's split disagree. Which one is
 * right is not for the browser to decide; which one the CHECKS used is a fact, and it is the row.
 */
export function countMismatchNote(recorded, splitCount) {
  if (recorded === null || recorded === splitCount) return null
  return `The row records ${recorded} ${recorded === 1 ? 'item' : 'items'} for this field; the draft text here splits into ${splitCount}. `
    + `The count shown is the row's - that is the number the checks were run against.`
}

/**
 * How the document lays this field out, derived from the row rather than from a field-name list:
 *  - `list`  — the row names a skill_candidate list, or the ROW's own count is more than one item.
 *  - `pipe`  — a single line of pipe-separated terms; the document prints it as an ATS run.
 *  - `prose` — everything else.
 * A field-name allow-list would go stale the moment a template gains a placeholder.
 */
/**
 * SPEC 4.5-40 — the `{{merge field}}` token for a block, so the reader can see WHERE merged text
 * lands. Derived from `row.merge_field` at render time; there is deliberately no field-name list
 * here for the same reason `shapeOf` has none — one would go stale the moment a template gains a
 * placeholder. `{{` / `}}` is the template engine's own syntax (api `packetTemplates.ts` builds
 * `vars['{{'+key+'}}']`), NOT a preference: making the delimiters user-changeable would let the
 * screen disagree with the document.
 *
 * Returns null — never `{{}}`, `{{null}}` or `{{undefined}}` — when the row names no field.
 */
export function placeholderToken(row) {
  const name = String((row && row.merge_field) || '').trim()
  return name ? '{{' + name + '}}' : null
}

/**
 * What the app can HONESTLY say about that token, and it is less than it looks.
 *
 * The app holds the field NAME (it comes down with every insertion row) and does NOT hold the
 * template's surrounding prose — no app route delivers template body text; the only readers are two
 * server-side diag routes needing a Google token the browser does not have. So the screen may say
 * which slot this is and may not claim to have read the document.
 *
 * This is also what keeps `D:compact-template-placeholder-mismatch` from becoming a false statement
 * on screen. Measured (api-test run 32784628025): the owner's compact-resume Doc contains
 * `{{ResumeSummary}}` and `{{SkillsBullets}}` and is MISSING `SkillsBullets1/2`, `ExpertiseBullets`
 * and `RelevantBullets1/2/3`, while `TEMPLATE_META.compact_resume` still declares the full resume's
 * seven. That decision is the owner's and is open. Phrasing the token as the pipeline's EXPECTATION
 * rather than the document's CONTENTS is true under either branch — and it needs no per-type
 * allow-list, which would go stale exactly like a field-name list.
 */
export const PLACEHOLDER_NOTE =
  'the slot the pipeline expects to fill - the app has not read your document to confirm it is there'

export function shapeOf(row) {
  if (!row || !row.generated) return 'static'
  const text = row.after_text || ''
  const pipes = (text.match(/\s\|\s/g) || []).length
  if (!/\r?\n/.test(text) && pipes >= 2) return 'pipe'
  if (row.list || deriveItems(row).count > 1) return 'list'
  return 'prose'
}

/**
 * The portfolio and cover merge fields carry their own size expectation in their NAME
 * (`@AboutMe1_50words`, `@CoreAccomplishments_5blts_180words`). That name is the only place the
 * expectation exists — no API field carries it — so it is read off the field and attributed to the
 * field, never presented as an independent measurement.
 */
export function expectationFor(field) {
  const w = /(\d+)\s*words/i.exec(field || '')
  const b = /(\d+)\s*blts?/i.exec(field || '')
  if (!w && !b) return null
  return { words: w ? Number(w[1]) : null, bullets: b ? Number(b[1]) : null }
}

/** "this draft has 4 bullets, 180 words" — bullets from the ROW's count, never from a re-split. */
export function draftSizeText(row, expect) {
  if (!expect) return null
  const bullets = expect.bullets ? `${deriveItems(row).count} bullets, ` : ''
  return `${bullets}${wordCount(row && row.after_text)} words`
}

// RE-EXPORTED, not redefined — the same discipline as METHOD_LABEL below, and for the same reason.
// This file used to carry its own `M`/`N`/`R` pair while postingAnalysis.js carried `MH`/`NTH`/
// `RESP`, so one requirement row rendered two different ways on two screens the reader can open
// side by side. One definition, one set of words. See postingAnalysis.js for the values' rationale.
export { KIND_ABBR, KIND_WORD, KIND_LEGEND, reqChipLabel } from './postingAnalysis.js'

// Imported for meterModel's per-kind split. Same rule as the re-export above: ONE definition of
// which rows are must-haves, so the resume step and the posting analysis cannot disagree.
import { groupRequirements } from './postingAnalysis.js'

/**
 * How the row's own `method` reads in plain language — RE-EXPORTED, not redefined.
 *
 * There were TWO of these and they disagreed about `template_fill`. This file said
 * 'written for this posting'; assetGate.js said 'filled straight from the package'. Two consumers,
 * one each: AssetBlocks.jsx read this copy, AssetGateDrawer.jsx read that one — so the SAME
 * insertion row described itself two contradictory ways on two screens the reader can open side by
 * side.
 *
 * The ground truth is the code that WRITES the value, not either label. insertions.ts:66 defines
 * `template_fill` as "first time this slot was filled; the package value went straight in", and
 * :87 derives it as `changed ? 'model_rewrite' : 'template_fill'` — i.e. template_fill means the
 * text was NOT changed for this posting. So this file's wording was the false one, and it was false
 * in the direction that flatters: it told the reader a line had been tailored to the job when it
 * was an untouched template fill. That is the same class of claim as laundering a model change as
 * human judgement, which the `manual` note in assetGate.js already refuses to do.
 */
export { METHOD_LABEL } from './assetGate.js'

// ── the insertions × swaps × requirements join ──────────────────────────────────────────────────

/**
 * The endpoint returns every loop; `loop` is the latest. Older loops are the history behind
 * `before_text`, not extra blocks to draw.
 */
export function latestRows(data) {
  const all = (data && data.insertions) || []
  if (!all.length) return []
  const latest = Number(data.loop)
  return orderFields(all.filter((r) => Number(r.loop) === latest))
}

/**
 * The order the DOCUMENT reads in, which is not the order the API returns.
 *
 * `appInsertions.ts:81` sorts `order by i.loop, i.merge_field` - ALPHABETICALLY. On the resume that
 * puts `ExpertiseBullets` first and `ResumeSummary` fourth, so the screen opens on a skills list
 * where the prototype opens on the summary. Rendering both sides 2026-08-23:
 *
 *   prototype  Resume summary -> Skills 1 -> Skills 2 -> Relevant 1-3 -> Work experience
 *   app        ExpertiseBullets -> RelevantBullets1 -> 2 -> 3 -> ResumeSummary -> Skills1 -> 2
 *
 * Owner: "why is it rendering out of order vs the prototype with experience at the top instead of
 * resume summary?"
 *
 * Sorted HERE rather than in the query because this is presentation: the same rows feed the resume
 * and the compact resume, which share merge-field names, and a document's reading order is a
 * property of the document, not of the table. Changing the SQL would also silently reorder every
 * other consumer of that endpoint.
 *
 * STABLE for anything unlisted - an unknown merge field keeps its relative position and lands after
 * the known ones, so a new template field appears at the end rather than vanishing or jumping to
 * the top. Never alphabetical again.
 */
const FIELD_ORDER = [
  // Resume / ATS-compact resume, in the prototype's reading order.
  'ResumeSummary', 'SkillsBullets1', 'SkillsBullets2',
  'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3',
  'ExpertiseBullets',
  // Cover letter: the letterhead fields precede the body that references them.
  '@Company', '@CoverLetterDate', '@CoverLetterBody',
  // Portfolio, narrative before evidence.
  '@ExecutiveProfile_55words', '@AboutMe1_50words', '@AboutMe2_60words',
  '@CoreAccomplishments_5blts_180words',
]
const FIELD_RANK = new Map(FIELD_ORDER.map((f, i) => [f, i]))

/** Document reading order. Exported so a test can hold the order to the prototype's. */
export function orderFields(rows) {
  const rank = (r) => {
    const k = r && r.merge_field
    return FIELD_RANK.has(k) ? FIELD_RANK.get(k) : FIELD_ORDER.length
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (rank(a.r) - rank(b.r)) || (a.i - b.i))
    .map((x) => x.r)
}

/** The skill_candidate lists this asset actually renders. */
export function listsOf(rows) {
  return new Set((rows || []).map((r) => r.list).filter(Boolean))
}

/**
 * Swaps are recorded per PACKET and per list; `insertion.list` is what ties a list back to the
 * merge field that renders it, so only the lists this asset renders are in scope.
 */
export function scopeSwaps(allSwaps, lists) {
  const inScope = lists instanceof Set ? lists : new Set(lists || [])
  return (allSwaps || []).filter((s) => inScope.has(s.list))
}

/**
 * A block cites the requirement its own insertion row names, plus the requirements the swap rows
 * for the list it renders name. Both are stored requirement_ids — a chip is never derived from a
 * keyword match made in the browser.
 */
export function reqsForRow(row, scopedSwaps, reqById) {
  const ids = [row && row.requirement_id]
  if (row && row.list) for (const s of scopedSwaps || []) if (s.list === row.list && s.requirement_id) ids.push(s.requirement_id)
  const out = []
  const seen = new Set()
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const r = reqById && reqById.get(id)
    if (r) out.push(r)
  }
  return out.sort((a, b) => Number(a.seq) - Number(b.seq))
}

/**
 * The PROPOSED ATS keywords for a field — `requirement.model_keyword`, deduped, in `seq` order.
 *
 * WHY THIS SITS BESIDE `reqsForRow` RATHER THAN INSIDE IT. `reqsForRow`'s return shape has three
 * live consumers in AssetBlocks.jsx and two assertions in assetBlocks.test.mjs; widening it to
 * carry keywords would make every one of them a place where a keyword could leak into a count.
 * This consumes its output and adds nothing to it.
 *
 * THESE ARE PROPOSALS, NOT MEASUREMENTS, AND THE DISTINCTION IS THE WHOLE POINT.
 * `model_keyword` is jd_table's "ATS Keyword" — MODEL-GENERATED, and both `schema.ts:338` and
 * `requirements.ts:59` declare it NEVER SCOREABLE. It says "a model reading the posting thought
 * this was the keyword", not "this field contains this term". Nothing derived here may enter a
 * coverage count, a score, or the gate; the owner-facing label is the literal word `proposed`, and
 * `H:keyword-never-reaches-a-count` guards the wall rather than trusting this comment.
 *
 * Returns plain strings, deduped by EXACT string. A near-duplicate is left as two chips: collapsing
 * "roadmap" and "roadmap ownership" would be a similarity judgement, and this repo reserves those
 * for ranking, never for a claim shown to the reader.
 *
 * @param {Array} reqs  the output of `reqsForRow` — already the right rows, already seq-ordered
 * @returns {string[]}  never `[null]`, never `['']`, never a placeholder
 */
export function proposedKeywordsForRow(reqs) {
  const out = []
  const seen = new Set()
  for (const r of Array.isArray(reqs) ? reqs : []) {
    const k = r && typeof r.model_keyword === 'string' ? r.model_keyword.trim() : ''
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * The requirement row a chip stands for, found by EXACT keyword identity within the rows already
 * resolved for this field. Not a search: the same array the chip was built from.
 *
 * `verbatim` is the posting's own substring, or null when the requirement was unlocatable. The
 * caller must render the null as "the posting line could not be located" and NEVER substitute
 * `item_text`, which `schema.ts:331` marks as a model paraphrase that is never presented as a quote.
 */
export function proposedKeywordDetail(reqs, keyword) {
  for (const r of Array.isArray(reqs) ? reqs : []) {
    if (r && typeof r.model_keyword === 'string' && r.model_keyword.trim() === keyword) {
      return { keyword, seq: r.seq, kind: r.kind, verbatim: r.verbatim || null }
    }
  }
  return null
}

/**
 * Which proposed keywords this field's draft ACTUALLY CONTAINS, and which it does not.
 *
 * ONE derivation, computed once, so the highlight, the chip state and the "not in this text" line
 * can never disagree about the same field. Each of those three is a claim about the same fact; three
 * places computing it separately is how two of them end up telling the reader different things.
 *
 * Presence is decided by `markRuns`, which is whole-word and exact — never a similarity score. A
 * chip that says a term is present is an ACCUSATION in the same sense a highlight is, and this
 * repo reserves fuzzy matching for ranking.
 *
 * ABSENCE IS REPORTED AS ABSENCE FROM THE TEXT, NEVER AS "REWORDED". Text that does not contain a
 * keyword is equally consistent with the writer having reworded it and with it never having been
 * placed at all, and nothing in the product can distinguish those. Saying "reworded" would be a
 * guess presented as a finding.
 *
 * @returns {{present: string[], absent: string[]}} both in the input's order
 */
export function keywordPresence(text, keywords) {
  const list = Array.isArray(keywords) ? keywords : []
  if (!list.length) return { present: [], absent: [] }
  const hit = new Set()
  for (const r of markRuns(text, list, 'keyword')) if (r.mark && r.phrase != null) hit.add(r.phrase)
  return { present: list.filter((k) => hit.has(k)), absent: list.filter((k) => !hit.has(k)) }
}

/**
 * SPEC 4.6-10/4.6-11 — what the keyword panel may offer a reader who is not comfortable claiming a
 * proposed keyword, and the honest reason when it may offer nothing.
 *
 * A DROP IS A REQUEST, NEVER A RECORDED DECISION, and that is a finding rather than a shortcut.
 * The prototype's button (docs/qc-evidence/qc/assets.jsx:82) is itself an `onAsk` — every one of its
 * three actions is. What the prototype's SENTENCE adds is a coverage consequence ("leave the line it
 * covers open… I would rather show a gap than overstate"), and in this app that sentence would be
 * false: `requirement.model_keyword` is declared NEVER SCOREABLE (`schema.ts:338`,
 * `requirements.ts:59`) and the panel two lines above already tells the reader the keyword "counts
 * toward nothing". Copying the wording would put a contradiction two inches below it.
 *
 * NOR CAN `owner-edit` RECORD IT, which is the answer to the obvious "but there IS a writer".
 * `POST /app/artifact/{id}/owner-edit` exists and is finished, but a drop's `replacement` is the
 * empty string, and `appSwaps.ts:44-49` builds `ownerLabels` as
 * `.map(r => r.replacement).filter(Boolean)` — an empty replacement is filtered out before
 * `swaps.ts:279` ever consults it, so `driver='owner'` cannot fire for a deletion. Routing a drop
 * there would attribute nothing AND would splice a hole into the sentence
 * (`Led  initiatives across teams`), because `owner-edit` replaces at exact offsets and only a
 * rewrite can remove a term grammatically. So the ask box is not the lesser option here; it is the
 * only one that is both honest and correct.
 *
 * Three states, and each is deliberate:
 *   canEdit false  → NOTHING. A static block or a block with no artifact has no edit path at all,
 *                    and an inert control is the "no dead UI" failure.
 *   present false  → no control, and the reason SAID rather than a control that would be a no-op.
 *                    "Absent evidence is never permission": a drop that cannot do anything must
 *                    read as unavailable, not as having worked.
 *   present true   → the request sentence, seeded into the field's own ask box, unsent.
 *
 * The sentence names the KEYWORD and nothing else — never the posting's verbatim quote, which may
 * be null (the panel then says the line could not be located), and never a posting line the panel
 * cannot name.
 *
 * @param {{keyword: string, present: boolean, canEdit: boolean}} args
 * @returns {{ask: string|null, reason: string|null}}
 */
export function keywordActions({ keyword, present, canEdit } = {}) {
  const k = typeof keyword === 'string' ? keyword.trim() : ''
  if (!k || !canEdit) return { ask: null, reason: null }
  if (!present) return { ask: null, reason: 'This field does not contain it, so there is nothing here to drop.' }
  return {
    ask: `Drop "${k}" from this field. Rewrite the text without it rather than swapping in a synonym.`,
    reason: null,
  }
}

/**
 * SPEC 4.6-9 — swap this keyword for one of the owner's OWN banked skills.
 *
 * EXTENDS `keywordActions` rather than standing beside it: same guard order, same shape, same
 * honesty. Both are REQUESTS seeded into the field's existing ask box; neither stores a decision.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE DROP, and why it needs the bank at all: dropping needs nothing
 * but the keyword, while swapping needs something to swap TO. That something must be a skill the
 * OWNER actually claims — `skill_bank_entry`, seeded from their own MasterContext fields — never a
 * model's suggestion. Offering an invented alternative would put words in the owner's mouth on the
 * document that represents them, which is the no-fake-data rule at its sharpest.
 *
 * SO: no bank, NO CONTROL. Not a disabled control, not a control that opens an empty picker — the
 * standing no-dead-UI rule, plus a sentence saying where the bank comes from, because "nothing here"
 * with no explanation reads as broken.
 *
 * The candidate list EXCLUDES the keyword itself (swapping a term for itself is a no-op the reader
 * would have to notice for us) and anything already in the field (which would claim the same thing
 * twice).
 *
 * @param {{keyword: string, present: boolean, canEdit: boolean, bank: Array<{label:string, category:string|null}>, inField: string[]}} args
 * @returns {{candidates: Array<{label:string, category:string|null}>, ask: (label:string)=>string, reason: string|null}}
 */
export function keywordSwapOptions({ keyword, present, canEdit, bank, inField } = {}) {
  const k = typeof keyword === 'string' ? keyword.trim() : ''
  const none = { candidates: [], ask: null, reason: null }
  if (!k || !canEdit) return none
  if (!present) return { ...none, reason: 'This field does not contain it, so there is nothing here to swap.' }
  const rows = Array.isArray(bank) ? bank : []
  if (!rows.length) {
    return { ...none, reason: 'Your skill bank is empty, so there is nothing of your own to swap in. Seed it in Settings > Skill wordings.' }
  }
  const taken = new Set([k.toLowerCase(), ...(Array.isArray(inField) ? inField : []).map((s) => String(s).toLowerCase())])
  const candidates = rows
    .filter((r) => r && typeof r.label === 'string' && r.label.trim() && !taken.has(r.label.trim().toLowerCase()))
    .map((r) => ({ label: r.label.trim(), category: r.category || null }))
  if (!candidates.length) {
    return { ...none, reason: 'Every skill in your bank is already claimed in this field.' }
  }
  return {
    candidates,
    // Names BOTH terms, so the request cannot be read as "drop it" with an unrelated addition.
    ask: (label) => `Swap "${k}" in this field for "${String(label).trim()}". Rewrite the line so it reads naturally with the replacement.`,
    reason: null,
  }
}

/**
 * SPEC 4.11-8 — the caveat: "a change the next run will revert".
 *
 * WHAT THIS IS AND IS NOT. The prototype ships this as `m.note`, a hardcoded string on a fixture
 * (`qc/assist.jsx:19`), so it reads as a sentence that is always true. SPEC's wording is
 * conditional — a caveat *when* a change will be reverted — and SPEC outranks the prototype on
 * intent (`docs/qc-evidence/IMPORT-NOTE.md`). Copying the fixture would ship a sentence that is
 * false on most fields, so this DERIVES the caveat and returns null when there is nothing to say.
 *
 * THERE ARE TWO DETERMINISTIC REVERTERS, AND THIS ONE OWNS THE FIRST. **The claim originally written
 * here — that the owner's do-not-use list is the ONLY one — was FALSE, and an independent pass over
 * `swaps.ts` caught it.** `dedupeAcrossLists` (`normalise.ts:100-123`) is the second: pure,
 * deterministic, and re-run on every build. It runs inside `normalisePackage` at
 * `appPackets.ts:561`, BEFORE `writeSwaps` at `:618`, mutating the same `pkg`, so its deletions
 * reached `restoreOptions` as ordinary drops and it offered to put back an item the next build
 * removes again — the self-undoing control that function exists to prevent, through a producer this
 * guard could not see. That reverter is now named by `CROSS_LIST_RATIONALE_PREFIX` and excluded
 * there; it deliberately does NOT produce a caveat here, because the item is still in the document
 * (in another list) and warning that it will be "reverted" would be its own false sentence.
 *
 * So: `swaps.ts` records the omit drop as `driver:'rule'` with a fixed rationale — a phrase taken
 * out by that rule is taken out again on the next loop, whatever the reader does by hand. Every
 * other drop is model-driven and NOT predictable, which is why this matches the rule rows alone.
 *
 * ACCUSATION-GRADE MATCHING, per the standing rule that fuzzy matching is for ranking and never for
 * accusing: the rationale is compared EXACTLY against the string `swaps.ts` writes, not fuzzily and
 * not by substring on a word like "omit". `H:omit-caveat-rationale-parity` pins the two literals
 * together, because the api and the app hold separate copies of it.
 *
 * WHAT IT SAYS is what is KNOWN — the last run dropped this phrase, and the rule that dropped it is
 * applied again every run — never a prediction about a run that has not happened. `from_label` is
 * the owner's own list item and is already rendered a few lines up (`AssetBlocks.jsx:408`); the raw
 * `itemsToOmit` string is never sent to the client (`evidence.ts:221`, `pipeline.ts:85`) and nothing
 * here needs it.
 *
 * @param {Array<{action?: string, driver?: string, from_label?: string, rationale?: string}>} swapsForList
 * @returns {{phrases: string[], text: string|null}}
 */
export const OMIT_LIST_RATIONALE = 'on the owner do-not-use list (MasterContext.itemsToOmit)'

/**
 * The SECOND deterministic reverter, matched by PREFIX because its rationale names the list that
 * kept the item and so cannot be one constant (`swaps.ts` `crossListRationale`).
 *
 * A prefix is not a fuzzy match and this is not the ranking/accusing line being crossed: the prefix
 * is a literal both sides hold, pinned by `H:cross-list-rationale-parity`, and it decides only
 * whether to OFFER a control — it never names an offender or moves a gate. What it must not do is
 * match a rationale that merely CONTAINS the phrase, which is why it is anchored at position 0.
 */
export const CROSS_LIST_RATIONALE_PREFIX = 'already listed in '
export const isCrossListDrop = (rationale) => String(rationale || '').startsWith(CROSS_LIST_RATIONALE_PREFIX)

/**
 * The rows belonging to the LATEST pass, and why anything saying "the last run" must go through it.
 *
 * `AssetBlocks.jsx` reads `provenance.swaps.swaps`, which is EVERY pass — the audit trail. The API
 * says so in its own words (`appSwaps.ts:113`: *"`swaps` is EVERY pass; `current` is the latest pass
 * alone"*) and `appSwaps.ts:55` deletes only the rebuilt loop, so rows from earlier passes persist.
 * `scopeSwaps` filters on `list` and never on `loop`.
 *
 * That is harmless for a change LOG, which is meant to show every pass. It is not harmless for a
 * sentence that says *"the last run took X out"*: found by the independent verifier, a loop-1 omit
 * drop that loop 2 KEPT still produced that sentence, and the last run had kept it. A claim about a
 * specific run must be built from that run's rows.
 *
 * Rows with no usable `loop` are dropped once ANY row carries one — they cannot be shown to be
 * current, and "absent evidence is never a pass". When no row carries a loop at all (data predating
 * the column) there is only one pass to speak of, so the rows are returned unfiltered.
 */
export function latestLoopRows(swaps) {
  const rows = (Array.isArray(swaps) ? swaps : []).filter(Boolean)
  const loops = rows.map((s) => Number(s.loop)).filter((n) => Number.isFinite(n))
  if (!loops.length) return rows
  const latest = Math.max(...loops)
  return rows.filter((s) => Number(s.loop) === latest)
}

export function omitListCaveat(swapsForList) {
  const rows = latestLoopRows(swapsForList)
  const phrases = [...new Set(rows
    .filter((s) => s && s.action === 'dropped' && s.driver === 'rule' && s.rationale === OMIT_LIST_RATIONALE)
    .map((s) => String(s.from_label || '').trim())
    .filter(Boolean))]
  if (!phrases.length) return { phrases: [], text: null }
  const one = phrases.length === 1
  return {
    phrases,
    text: `The last run took ${joinLabels(phrases.map((p) => `"${p}"`))} out of this list because ${one ? 'it is' : 'they are'} on your do-not-use list. `
      + `Putting ${one ? 'it' : 'them'} back by hand may not stick: that list is applied again on every run. `
      + `Edit the list in Settings if ${one ? 'it belongs' : 'they belong'} here.`,
  }
}

/**
 * SPEC 4.11-5 — "Put back an original", as an IN-PLACE seeder rather than a panel chip.
 *
 * The prototype's quick action is a bare template, `'Put back an original phrase that was removed:'`
 * with the reader left to type which one (`qc/assist.jsx:4-10`). The app can do better without
 * inventing anything: the dropped rows are already on screen under "Taken out of this list", so the
 * control can name the actual phrase and there is one control per real candidate.
 *
 * NO CANDIDATES, NO CONTROL — the standing no-dead-UI rule. A "Put back an original" on a field that
 * dropped nothing would be a request the reader cannot mean.
 *
 * BOTH DETERMINISTIC REVERTERS ARE EXCLUDED, and that is the whole reason this is not a one-line
 * filter on `action === 'dropped'`. Offering to restore a phrase the pipeline removes again is dead
 * UI in the most expensive sense: it appears to work and then silently does not.
 *   1. the owner's do-not-use list — `omitListCaveat` states that case instead;
 *   2. a cross-list drop — the item is still in the document, in the list named by the rationale, so
 *      there is nothing to put back and no caveat to give. **This second one shipped as a live
 *      defect and was found by an independent pass, not by this function's own guard**, because the
 *      guard was written against the only reverter its author knew about.
 *
 * @param {{swapsForList: Array<object>, canEdit: boolean}} args
 * @returns {Array<{label: string, ask: string}>}
 */
export function restoreOptions({ swapsForList, canEdit } = {}) {
  if (!canEdit) return []
  // Latest pass only, for the same reason the caveat is: offering to restore something an EARLIER
  // pass dropped and the current one already carries would be a request the reader cannot mean.
  const rows = latestLoopRows(swapsForList)
  const labels = [...new Set(rows
    .filter((s) => s && s.action === 'dropped'
      && s.rationale !== OMIT_LIST_RATIONALE
      // The second deterministic reverter. Restoring a cross-list drop asks for an item the document
      // ALREADY carries in another list, and the next build's deduper removes it again.
      && !isCrossListDrop(s.rationale))
    .map((s) => String(s.from_label || '').trim())
    .filter(Boolean))]
  return labels.map((label) => ({
    label,
    ask: `Put "${label}" back into this list. It was taken out and I want it carried into the final text.`,
  }))
}

/**
 * SPEC 4.11-5 — "Shorten to fit", as an in-place seeder.
 *
 * The prototype's sentence is `'Shorten this to fit its word rule: '` — a rule it does not name,
 * because the fixture has no thresholds. The app HAS the rule and already renders it beside the
 * field (`observedFor` / `targetFor`, e.g. "56 words - 55-60 words"), so the request carries the
 * real numbers and the model is not left to guess which limit was meant.
 *
 * NO RULE, NO CONTROL, AND NO EXPLANATION EITHER — deliberately, and this reversed a first attempt.
 * It originally returned a `reason` string on the `keywordActions` precedent, and the independent
 * verifier caught that the field was WRITE-ONLY: the test asserted its text while no caller rendered
 * it, so the JSDoc claimed a sentence the reader never saw. The two are not the same situation.
 * `keywordActions`' reason renders inside an OPENED keyword panel, where the reader has asked about
 * one term and an empty panel would read as broken. This control sits in the always-visible row
 * beside every field, where a note on every unruled field is noise — and the absence explains
 * itself, because a field with no rule visibly shows no target beside its measurement.
 * So: no reason, and no claim to one.
 *
 * It does NOT gate on the field being over its limit. Whether it is over is decided by the check
 * rows, and re-deriving that here would be a second opinion on the same question rendered inches
 * from the first — the exact divergence the "one core source" rule exists to prevent. This is a
 * REQUEST the reader chooses to send, not an accusation that the field is too long.
 *
 * @param {{mergeField: string, observed: string|null, target: string|null, canEdit: boolean}} args
 * @returns {{ask: string|null}}
 */
/**
 * SPEC 4.11-5 / 4.7 — the reword request, as a sentence.
 *
 * EXTRACTED HERE, not written twice, and the extraction required an owner decision because the guard
 * that protects this sentence pinned it to `AssetBlocks.jsx` by SHAPE AND LOCATION. It lived as a
 * template literal inside that component, which was correct while the field margin was its only
 * consumer. The assistant panel is a second consumer, and AC-10 is explicit that every quick-action
 * sentence comes from ONE exported table so two surfaces cannot drift into asking for subtly
 * different things in the owner's name.
 *
 * `H:keyword-drop-seeds-the-ask-box-and-sends-nothing` was adapted with the owner's approval rather
 * than worked around: its two location-pins became STRICTER invariant checks — the sentence must
 * appear exactly once in ALL of `app/src/` (the old form would have passed with it duplicated into a
 * second file, which is the very thing this move exists to prevent), and `seedAskReword` must
 * delegate to `seedAsk` and never touch `api.`. Nothing was loosened.
 *
 * Same shape as its siblings above (`keywordActions`, `shortenAction`, `restoreOptions`): a REQUEST
 * the reader can edit before sending, never a decision and never a send.
 */
export function rewordAction({ phrase, canEdit = true } = {}) {
  const p = typeof phrase === 'string' ? phrase.trim() : ''
  if (!p || !canEdit) return { ask: null }
  return { ask: `Reword "${p}" so it does not repeat the posting's wording.` }
}

export function shortenAction({ mergeField, observed, target, canEdit } = {}) {
  if (!mergeField || !canEdit) return { ask: null }
  if (!target) return { ask: null }
  return {
    ask: observed
      ? `Shorten this field to fit its rule. It measures ${observed} against ${target}. Keep the meaning and drop the padding.`
      : `Shorten this field to fit its rule: ${target}. Keep the meaning and drop the padding.`,
  }
}

// ── packet-level provenance (decision 9) ────────────────────────────────────────────────────────

/**
 * A swap row comes from `swap_decision`, which is keyed by PACKET and LIST — never by artifact.
 * The resume and the compact resume are byte-identical templates (insertions.ts records this), so
 * the SAME row is rendered by both cards. Presented plainly it reads as two assets that were each
 * changed the same way, independently. It is one decision, shown twice. Decision 9 in
 * .claude/QC-EVIDENCE-PLAN.md: "surface them with `sharedSource: true` rather than presenting them
 * as independently derived."
 *
 * `listOwners` is built from the OTHER artifacts' own insertion rows (which lists each of them
 * actually renders) — not from a hardcoded belief about which templates are duplicates. When no
 * sibling has reported in, the note still states the scope without naming anyone.
 */
export function sharedSourceNote(list, artifactId, listOwners) {
  if (!list) return null
  const owners = (listOwners && listOwners[list]) || []
  const others = []
  const seen = new Set()
  for (const o of owners) {
    if (!o || !o.label || o.id === artifactId || seen.has(o.id)) continue
    seen.add(o.id)
    others.push(o.label)
  }
  const who = others.length
    ? `it also applies to ${joinLabels(others)}`
    : 'it applies to every asset in this packet that renders the same list'
  return `Packet-level decision - this list was decided once for the whole packet, so ${who}.`
}

export function joinLabels(labels) {
  const l = (labels || []).filter(Boolean)
  if (l.length <= 1) return l[0] || ''
  if (l.length === 2) return `${l[0]} and ${l[1]}`
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`
}

/**
 * One list-backed merge field: the lines to draw, the swap row behind each, and the packet-level
 * marker. `sharedSource` is true for a line whose change came from the packet-level table — which
 * is every line that HAS a swap row, because that table has no artifact column at all.
 */
export function listBodyModel(row, swapsForList, opts) {
  const { items, count, splitCount, recorded, disagrees } = deriveItems(row)
  const swaps = swapsForList || []
  const byTo = new Map()
  for (const s of swaps) if (s.to_label) byTo.set(normLabel(s.to_label), s)
  const lines = items.map((text) => {
    const swap = byTo.get(normLabel(text)) || null
    return {
      text,
      swap,
      from: swap && swap.from_label && swap.from_label !== swap.to_label ? swap.from_label : null,
      // THE THIRD RENDER SITE, and the one the driver guard missed. It interpolates the raw enum,
      // so a new value ships as bare machine wording on the list item - "swapped · owner" - while
      // the two sites the guard DID cover read properly. An independent verifier found it; the
      // guard was titled "a raw enum value must never reach the screen" and looped over two of the
      // three places one could.
      status: swap ? (swap.action === 'kept' ? 'unchanged'
        : swap.driver === 'owner' ? `${swap.action} · you changed this`
        : `${swap.action} · ${swap.driver}`) : '',
      sharedSource: !!swap,
    }
  })
  const o = opts || {}
  return {
    lines,
    dropped: swaps.filter((s) => s.action === 'dropped' && s.from_label),
    count,
    splitCount,
    recorded,
    disagrees,
    countNote: countMismatchNote(recorded, splitCount),
    sharedNote: lines.some((l) => l.sharedSource) || swaps.length
      ? sharedSourceNote(row && row.list, o.artifactId, o.listOwners)
      : null,
  }
}

// ── the distribution meter ──────────────────────────────────────────────────────────────────────

/**
 * A stat whose denominator has no source is NOT rendered as `0 of 0` with an empty bar — a reader
 * cannot tell that apart from a real, measured zero. It is stated as unknown instead.
 *
 * Live ground truth for the terms stat (db-query run 32327554276): `term_library_entry` has ZERO
 * published, scoreable rows, which is also why appChecks.ts leaves `keyword_coverage` null. So
 * there is nothing to divide by, and there is no per-asset term-placement endpoint to ask. Omitting
 * the stat entirely — what this module did before — leaves "no terms were placed" and "we never
 * measured" looking identical. It says which.
 */
export const UNKNOWN_TERMS_NOTE =
  'No published, scoreable library terms exist yet, so how many of them this asset places is unknown - not measured, not zero.'

export const UNKNOWN_REQS_NOTE =
  'This posting has no requirement rows yet, so how much of it this asset answers is unknown - not zero.'

// SPEC 4.5 puts "Show original" on EVERY field. The app gated the control on `row.before_text`,
// so a field with no earlier version rendered no control at all — the reader could not tell the
// difference between "nothing changed", "the comparison is broken", and "this is the first draft".
// The owner named that directly: *"i dont understand why you would consider it a dead link leaidng
// me to believe if it doesnt have original text now it never will, that is black box and not
// clear."*
//
// So the control is always present and this function decides WHAT IT SAYS. Three states, and the
// third is the honest-unknown the register keeps demanding: absent evidence is disclosed, never
// dressed up as a comparison that happened.
//
// WHY `before_text` IS EMPTY ON THE FIRST DRAFT, AND WHY THAT IS A GAP RATHER THAN THE DESIGN.
//
// `appInsertions.ts:26` — "before_text comes from loop-1, so pass n's before is pass n-1's after -
// never its own", and `writeInsertions` sets `prevPkg = {}` when `loop === 0`. So on the baseline
// package — the draft everyone actually looks at — every row's before_text is null by construction.
//
// The DESIGN wants an original there. SPEC 199 puts "Show original" on every field "including
// static template blocks"; SPEC 219 has static blocks showing their actual template text; and the
// prototype's own data proves what "original" means — `qc/data.js:203` gives the Skills list a
// before of "Enterprise Governance | Technology Strategy | Agile Transformation | ..." which is
// exactly the set `SKILL_ROWS[].orig` records, i.e. the owner's STANDING master content, not a
// pipeline intermediate. Owner, confirming: "the show original is always referencing showing the
// template the prompts are using as a baseline. there is always an original value for those
// sections."
//
// Seeding loop 0's before_text from that master baseline does NOT disturb remediation crediting.
// `realEdits`/`creditClosures` are only ever handed ONE remediation pass's rows —
// `appRemediation.ts:275` selects `where artifact_id=$1 and loop=$2` with pass >= 1 — and loop 0
// rows are never passed to them. A default value is not an edit, and nothing reads loop 0 as one.
// That work is separate from this function; this one only chooses the wording for whatever it has.
export const ORIGINAL_NONE_NOTE =
  'This is the first draft for this posting, so there is no earlier version to compare against yet. ' +
  'A later pass that rewrites this field will have one.'

export function originalState(row) {
  const before = row && row.before_text != null && row.before_text !== '' ? String(row.before_text) : null
  const after = row && row.after_text != null ? String(row.after_text) : null
  if (before === null) {
    return { kind: 'none', label: 'No earlier version yet', body: ORIGINAL_NONE_NOTE, text: null }
  }
  if (before === after) {
    return {
      kind: 'identical',
      label: 'Identical - template text is not merged per packet',
      body: null,
      text: before,
    }
  }
  return { kind: 'changed', label: 'Original - before this posting', body: null, text: before }
}

// The three kinds `groupRequirements` classifies, in the reading order the posting analysis uses.
// Labels answer the reader's question ("what does this asset answer?"), per SPEC §7 copy rules.
export const REQ_KIND_STATS = [
  { key: 'mustHaves', label: 'Must-haves answered', sub: 'required lines this asset cites' },
  { key: 'responsibilities', label: 'Responsibilities answered', sub: 'responsibility lines this asset cites' },
  { key: 'niceToHaves', label: 'Nice-to-haves answered', sub: 'preferred lines this asset cites' },
]

export function meterModel(input) {
  const { rows = [], filled = 0, unfilled = 0, requirements = null, scopedSwaps = [], terms = null,
    corrected = null } = input || {}
  const placedReqIds = new Set(rows.map((r) => r.requirement_id).filter(Boolean))
  const totalReqs = requirements && Number.isFinite(Number(requirements.total)) ? Number(requirements.total) : null
  // The endpoint returns `total` AND the rows themselves, each carrying `kind`. Reuse the existing
  // splitter rather than re-deriving the classification here — a second copy of "what counts as a
  // must-have" is how two screens come to disagree about the same posting.
  const kindRows = groupRequirements((requirements && requirements.requirements) || [])
  const changed = scopedSwaps.filter((s) => s.action === 'swapped' || s.action === 'added')
  const postingDriven = changed.filter((s) => s.driver === 'posting')
  const fields = filled + unfilled

  const stats = []
  const notes = []

  if (totalReqs !== null && totalReqs > 0) {
    stats.push({ key: 'lines', label: 'Posting lines placed', n: placedReqIds.size, d: totalReqs, sub: 'requirement rows this asset cites' })
    // Per-kind split (prototype §10). The recorded objection above was to the prototype's stat
    // NAMES because they sat against fabricated demo data — not to the split itself. These come
    // from the real `kind` on each requirement row, so the objection does not apply.
    //
    // The total STAYS, and is not replaced by the sum of these parts. `groupRequirements` classifies
    // exactly three kinds, so a row whose kind is null or unrecognised belongs to no group: replacing
    // the total with the parts would silently drop it from a coverage count. Total is the truth;
    // these are its breakdown.
    for (const k of REQ_KIND_STATS) {
      const rows = kindRows[k.key] || []
      if (rows.length === 0) continue          // a kind the posting does not use is not a 0/0 stat
      const placed = rows.filter((r) => r && placedReqIds.has(r.id)).length
      stats.push({ key: `kind_${k.key}`, label: k.label, n: placed, d: rows.length, sub: k.sub })
    }
  } else {
    // null (never loaded) and 0 (loaded, empty) are the same story for the reader: unmeasured.
    notes.push(UNKNOWN_REQS_NOTE)
  }
  if (changed.length > 0) {
    stats.push({ key: 'driven', label: 'Changes the posting drove', n: postingDriven.length, d: changed.length, sub: 'list changes citing a posting line' })
  }
  if (fields > 0) {
    stats.push({ key: 'fields', label: 'Fields generated', n: filled, d: fields, sub: `${unfilled} static template ${unfilled === 1 ? 'field' : 'fields'}` })
  }

  const termTotal = terms && Number.isFinite(Number(terms.total)) ? Number(terms.total) : null
  const termPlaced = terms && Number.isFinite(Number(terms.placed)) ? Number(terms.placed) : null
  if (termTotal !== null && termTotal > 0 && termPlaced !== null) {
    stats.push({ key: 'terms', label: 'Library terms placed', n: termPlaced, d: termTotal, sub: 'published scoreable terms this asset uses' })
  } else {
    notes.push(UNKNOWN_TERMS_NOTE)
  }

  // "N corrected" on the collapsed row (prototype `qc/assets.jsx:218`). NOT a stat: it has no
  // denominator, so it never gets a bar - it is a count of figures already rewritten for you.
  //
  // NULL AND 0 ARE DIFFERENT AND THIS IS THE WHOLE REASON IT IS COMPUTED HERE. `correctionsState`
  // returns `count: null` for every payload it could not measure - unchecked, absent, malformed -
  // and rendering that as "0 corrected" is the reviewer's "0 disagreements" bug: a measurement
  // reported that was never taken. Only a finite number reaches the caller; anything else is null
  // and the row shows nothing. 0 is a real, measured answer and is also not shown, because the
  // prototype does not show it and "nothing was corrected" is not news beside the counts.
  const n = Number(corrected)
  const correctedCount = corrected != null && Number.isFinite(n) && n > 0 ? n : null

  return { stats, notes, corrected: correctedCount }
}

/** Percent for a stat's bar. Never divides by zero — a stat with d <= 0 never reaches the meter. */
export function statPct(n, d) {
  return d > 0 ? Math.round((Number(n) / Number(d)) * 100) : 0
}

/**
 * Merge one artifact's rendered lists into the packet-wide registry of "which asset renders which
 * list". Returns the SAME object when nothing changed — the caller stores this in React state, and
 * a new object every time would re-render forever.
 */
export function registerListOwners(prev, artifactId, label, lists) {
  if (!artifactId) return prev || {}
  const rendered = Array.from(new Set((lists || []).filter(Boolean)))
  const next = { ...(prev || {}) }
  let changed = false
  for (const key of Object.keys(next)) {
    if (rendered.includes(key)) continue
    const kept = next[key].filter((o) => o.id !== artifactId)
    if (kept.length !== next[key].length) { next[key] = kept; changed = true }
  }
  for (const list of rendered) {
    const owners = next[list] || []
    const existing = owners.find((o) => o.id === artifactId)
    if (existing && existing.label === label) continue
    next[list] = owners.filter((o) => o.id !== artifactId).concat([{ id: artifactId, label }])
    changed = true
  }
  return changed ? next : (prev || {})
}

/**
 * The corrections that touched ONE merge field.
 *
 * An EXACT match on the field name, never a substring: `Summary` and `SummaryExtra` are two fields,
 * and a prefix match would print one field's corrections under the other's text - an attribution
 * error in the one place the screen exists to make attribution checkable.
 *
 * Lives here rather than in the .jsx for the reason this module's header gives: `node --test` cannot
 * import a .jsx, so a derivation written there is a derivation no test can exercise.
 */
/**
 * "What this X answers" starts COLLAPSED - this is the panel P8.7 always meant.
 *
 * P8.7 says "asset headers are collapsed by default". In the design an ASSET HEADER is this
 * counters panel INSIDE the card (`qc/assets.jsx` AssetHeader, `React.useState(false)`;
 * screens/INDEX.md 09 "Artifact card header ... collapsed asset header", 10 expanded). The app had
 * previously applied that instruction to the whole card, which hid the draft - see
 * ASSET_BODY_DEFAULT_OPEN. The card body opens; THIS closes. Both halves of P8.7, finally on the
 * objects it was written about.
 */
export const ASSET_ANSWERS_DEFAULT_OPEN = false

export function correctionsForField(rows, mergeField) {
  if (!Array.isArray(rows) || !mergeField) return []
  return rows.filter((r) => r && r.merge_field === mergeField)
}

/**
 * The CONTRACT a field is held to, in the words of the rule that enforces it.
 *
 * The prototype states every field's target beside its measurement - "longest 22 chars · <= 24 chars
 * each", "0 over 20 chars · max 1 item over 20 chars", "6 x 5 words · exactly 5 words". The app
 * showed the measurement alone, which is the difference between "20 words" and "20 words, and the
 * limit is 24". Owner: "fix the UI to match the prototype visually".
 *
 * THE NUMBERS COME FROM THE OWNER'S THRESHOLDS, never from a literal here. They are settings -
 * `chk_skill_max_chars`, `chk_relevant_max_chars`, `chk_expertise_words` - reachable in Settings and
 * already carried to the client by `searchPrefsGet().checks`. The owner set 24/20 and said "all such
 * rule numbers need to be available for tweaking in the settings/config"; a literal here would print
 * "<= 24 chars" while the gate enforced 30, which is worse than printing nothing.
 *
 * NO THRESHOLDS, NO TARGET. Returns null rather than falling back to a default - a contract stated
 * from a guess is a promise the gate has not agreed to.
 *
 * DELIBERATELY ABSENT: the portfolio and cover fields. Their merge-field NAMES carry one number and
 * the thresholds carry another - `@AboutMe1_50words` against `aboutMe1Words: [45, 48]`,
 * `@AboutMe2_60words` against `[75, 80]`, `@CoreAccomplishments_5blts_180words` against `[98, 125]`.
 * Two sources for one number, and picking either without deciding which is authoritative would
 * invent certainty. Recorded for the owner instead; see .claude/actions.md.
 */
// merge field -> the threshold key holding its [lo, hi] word band. Module scope because BOTH
// targetFor() and observedFor() key off it; two copies of this map is exactly how the target and
// the measurement beside it would come to disagree about which fields have a band at all.
const RANGE = {
  // The band Prompt 16 already asks the model for — `### Resume Summary (55-60 words)` — now stated
  // beside the field and enforced by `word_counts`. It was the ONE generated field with no target,
  // which read as deliberate next to six fields that state one, and the generator has been missing
  // it every time: 48/49/49/61/61/70/70 words in production, none inside the band.
  ResumeSummary: 'resumeSummaryWords',
  '@CoverLetterBody': 'coverWords',
  '@AboutMe1_50words': 'aboutMe1Words',
  '@AboutMe2_60words': 'aboutMe2Words',
  '@ExecutiveProfile_55words': 'execProfileWords',
  '@CoreAccomplishments_5blts_180words': 'coreAccomplishmentsWords',
}

export function targetFor(mergeField, thresholds) {
  const t = thresholds
  if (!t || !mergeField) return null
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
  if (/^SkillsBullets\d$/.test(mergeField)) {
    const max = n(t.skillMaxChars)
    return max === null ? null : `\u2264 ${max} chars each`
  }
  if (/^RelevantBullets\d$/.test(mergeField)) {
    const max = n(t.relevantMaxChars)
    const allow = n(t.relevantOverLimitAllowance)
    if (max === null) return null
    return allow === null ? `\u2264 ${max} chars each`
      : `max ${allow} item${allow === 1 ? '' : 's'} over ${max} chars`
  }
  if (mergeField === 'ExpertiseBullets') {
    const w = n(t.expertiseWords)
    return w === null ? null : `exactly ${w} words each`
  }
  // Cover letter and portfolio. THE THRESHOLD WINS OVER THE FIELD NAME, and the design says so:
  // the prototype heads these "48 words · 45-48 words" and "254 words · 250-400 words", which are
  // `aboutMe1Words` and `coverWords` - NOT the 50 and the 180 baked into `@AboutMe1_50words` and
  // `@CoreAccomplishments_5blts_180words`. The name's number is stale; the threshold is what the
  // gate tests and what the design displays. Reading the rendered prototype settled a question that
  // reading the code could not.
  const key = RANGE[mergeField]
  if (key) {
    const r = t[key]
    if (!Array.isArray(r) || r.length !== 2) return null
    const lo = n(r[0]); const hi = n(r[1])
    return lo === null || hi === null ? null : `${lo}\u2013${hi} words`
  }
  return null
}

/**
 * The MEASUREMENT, in the unit of the rule that governs it.
 *
 * The card used to print `{count} lines - {words} words` for every field, whatever the rule
 * measured, so a skills list read "10 lines - 20 words - <= 24 chars each": a word count beside a
 * character limit. The two halves did not answer each other, and a measurement that cannot be
 * compared to its target tells the reader nothing about whether the field passes. Confirmed on the
 * live screen 2026-08-23, not inferred - the same line is visible in the production screenshot.
 *
 * The prototype states both halves in one unit ("longest 22 chars - <= 24 chars each",
 * "0 over 20 chars - max 1 item over 20 chars", "6 x 5 words - 6 phrases, exactly 5 words").
 *
 * BRANCHES MIRROR targetFor() EXACTLY, in the same order, keyed off the same field patterns. That
 * is deliberate: these two strings are read side by side, so if one gains a branch and the other
 * does not, the pair silently goes back to disagreeing. Returns null wherever targetFor() would -
 * a measurement with no stated rule is the old behaviour and stays as it was.
 */
export function observedFor(mergeField, row, thresholds) {
  const t = thresholds
  if (!t || !mergeField || !row) return null
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
  const { items } = deriveItems(row)

  if (/^SkillsBullets\d$/.test(mergeField)) {
    if (n(t.skillMaxChars) === null || !items.length) return null
    return `longest ${Math.max(...items.map((s) => String(s).trim().length))} chars`
  }
  if (/^RelevantBullets\d$/.test(mergeField)) {
    const max = n(t.relevantMaxChars)
    if (max === null || !items.length) return null
    return `${items.filter((s) => String(s).trim().length > max).length} over ${max} chars`
  }
  if (mergeField === 'ExpertiseBullets') {
    if (n(t.expertiseWords) === null || !items.length) return null
    const each = items.map((s) => wordCount(s))
    // `6 x 5 words` asserts every phrase is the same length. When they are NOT, saying so would be
    // a false uniformity claim about the exact thing the rule tests, so the spread is stated instead.
    const lo = Math.min(...each); const hi = Math.max(...each)
    return lo === hi ? `${items.length} \u00d7 ${lo} words` : `${items.length} phrases, ${lo}\u2013${hi} words`
  }
  if (RANGE[mergeField]) {
    const r = t[RANGE[mergeField]]
    if (!Array.isArray(r) || r.length !== 2) return null
    return `${wordCount(row.after_text)} words`
  }
  return null
}

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
  fieldChangeLog: 'blocks-corrected-for-you', // the field's own "Corrected for you" list (P8.6 inline).
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

export const KIND_ABBR = { must_have: 'M', nice_to_have: 'N', responsibility: 'R' }
export const KIND_WORD = { must_have: 'must-have', nice_to_have: 'nice-to-have', responsibility: 'responsibility' }

// How the row's own `method` reads in plain language. `manual` is never inferred by the pipeline —
// it exists so a human edit can be told apart from a model rewrite, and it is shown as what it is.
export const METHOD_LABEL = {
  template_fill: 'written for this posting',
  model_rewrite: 'rewritten by a later pass',
  manual: 'edited by hand',
}

// ── the insertions × swaps × requirements join ──────────────────────────────────────────────────

/**
 * The endpoint returns every loop; `loop` is the latest. Older loops are the history behind
 * `before_text`, not extra blocks to draw.
 */
export function latestRows(data) {
  const all = (data && data.insertions) || []
  if (!all.length) return []
  const latest = Number(data.loop)
  return all.filter((r) => Number(r.loop) === latest)
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
      status: swap ? (swap.action === 'kept' ? 'unchanged' : `${swap.action} · ${swap.driver}`) : '',
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

export function meterModel(input) {
  const { rows = [], filled = 0, unfilled = 0, requirements = null, scopedSwaps = [], terms = null } = input || {}
  const placedReqIds = new Set(rows.map((r) => r.requirement_id).filter(Boolean))
  const totalReqs = requirements && Number.isFinite(Number(requirements.total)) ? Number(requirements.total) : null
  const changed = scopedSwaps.filter((s) => s.action === 'swapped' || s.action === 'added')
  const postingDriven = changed.filter((s) => s.driver === 'posting')
  const fields = filled + unfilled

  const stats = []
  const notes = []

  if (totalReqs !== null && totalReqs > 0) {
    stats.push({ key: 'lines', label: 'Posting lines placed', n: placedReqIds.size, d: totalReqs, sub: 'requirement rows this asset cites' })
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

  return { stats, notes }
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
export function correctionsForField(rows, mergeField) {
  if (!Array.isArray(rows) || !mergeField) return []
  return rows.filter((r) => r && r.merge_field === mergeField)
}

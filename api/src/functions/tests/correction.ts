// P8.1 / R1 — anything the engine can fix, it fixes before the user sees it, and records the fix.
// The user reviews a change log, not a to-do list.
//
// This module is the pure half: it decides WHAT to change and computes the exact bytes, and it can
// undo any single change months later. It writes nothing and reads nothing — no pg, no
// @azure/functions — so `node --test` can exercise every branch.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE IS OFFSET DRIFT, and it is worth stating plainly because
// the obvious implementation is wrong in a way no test written alongside it would catch.
//
// `extractFigures` hands back figures with offsets into ONE string, ascending. Walk that list
// applying replacements left to right and every correction after the first is indexing a string
// that no longer exists: `$18M` (4 chars) becomes `8-figure` (8), so everything to its right has
// shifted by four. The document still comes out right — each splice uses the offset it was given,
// and the errors only accumulate in the RECORD. Months later a user clicks Undo on the second
// correction and it writes `60+` into the middle of `8-figure`.
//
// The fix is to make every stored offset mean the same thing forever: **all offsets are relative to
// the ORIGINAL, pre-correction field text, and nothing else.** Applying is then a right-to-left
// splice (each splice is to the right of the next one to run, so no earlier offset can be
// disturbed), and reverting is a replay of the same list minus the row being undone. Both are
// deterministic, neither needs the offsets to survive a rewrite, and the original text does not
// have to be stored: it can be recovered exactly from the current text and the rows that produced
// it, which `originalOf` does and `revertOne` verifies against `before_sha256` before touching
// anything.
import { createHash } from 'crypto'
import { Figure, Echo, generalize } from './figureEcho'

export const CORRECTION_VERSION = 1

/** Why a figure was changed, and where the replacement came from. */
export type CorrectionSource = 'profile_figure' | 'generalized' | 'owner_edit'

export interface Correction {
  merge_field: string
  /** The exact original substring being replaced. */
  phrase: string
  /** What it becomes. */
  replacement: string
  /** Offsets into the ORIGINAL field text. Invariant: phrase.length === char_end - char_start. */
  char_start: number
  char_end: number
  /** SHA-256 of the whole ORIGINAL field text. A stale offset becomes detectable, not silent. */
  before_sha256: string
  /** Ascending by char_start, so a change log reads in document order. */
  applied_seq: number
  reason: string
  source: CorrectionSource
}

export const sha256 = (s: string): string => createHash('sha256').update(String(s), 'utf8').digest('hex')

/**
 * Plan the corrections for ONE field. Nothing is applied here.
 *
 * A figure with no honest replacement produces NO row and stays in the document — `generalize`
 * returns null for a rate, because there is no honest generalisation of "40%", and inventing one
 * would be the fabrication this layer exists to prevent. Those figures remain open findings; that
 * is the correct outcome, not a gap.
 */
export function planCorrections(mergeField: string, original: string, echoes: Echo[]): Correction[] {
  const before_sha256 = sha256(original)
  const rows: Correction[] = []
  // Ascending by position, so `applied_seq` reads in document order for a human.
  for (const e of [...echoes].sort((a, b) => a.figure.start - b.figure.start)) {
    const f: Figure = e.figure
    // Never trust the offset without checking it addresses what it claims to. A figure computed
    // against a different string is exactly the drift this module exists to prevent, and it must
    // fail loudly here rather than silently corrupt a field.
    if (original.slice(f.start, f.end) !== f.raw) continue
    const replacement = generalize(f)
    if (!replacement) continue
    rows.push({
      merge_field: mergeField,
      phrase: f.raw,
      replacement,
      char_start: f.start,
      char_end: f.end,
      before_sha256,
      applied_seq: rows.length + 1,
      reason: `the posting states ${f.raw}; your profile does not evidence it`,
      source: 'generalized',
    })
  }
  return rows
}

/** A row whose offsets do not describe its own phrase can never be applied or undone correctly. */
export function isWellFormed(c: Correction): boolean {
  return typeof c.phrase === 'string' && c.phrase.length > 0
    && typeof c.replacement === 'string'
    && Number.isInteger(c.char_start) && Number.isInteger(c.char_end)
    && c.char_end - c.char_start === c.phrase.length
    && c.char_start >= 0
    && typeof c.before_sha256 === 'string' && c.before_sha256.length === 64
}

/**
 * Apply corrections to the original text.
 *
 * Right to left. Each splice happens to the RIGHT of every splice still to come, so no pending
 * offset is ever disturbed — which is what lets every stored offset stay original-relative.
 */
export function applyCorrections(original: string, rows: Correction[]): string {
  let out = String(original)
  for (const c of [...rows].sort((a, b) => b.char_start - a.char_start)) {
    if (!isWellFormed(c)) throw new Error(`malformed correction at ${c.char_start}: ${c.phrase}`)
    if (out.slice(c.char_start, c.char_end) !== c.phrase) {
      throw new Error(`correction ${c.applied_seq} does not address its own phrase — text has moved`)
    }
    out = out.slice(0, c.char_start) + c.replacement + out.slice(c.char_end)
  }
  return out
}

/**
 * Re-apply the OWNER'S own edits to freshly generated text.
 *
 * DECISION A, taken by the owner 2026-08-25: an owner override survives a rebuild. The row already
 * survived — nothing deletes from `correction` — but the TEXT did not, because a rebuild regenerates
 * the field and `applyCorrections` is only ever called on the pipeline's own freshly-planned rows.
 * Without this the change log would assert an edit the document does not contain, which is worse
 * than losing the edit outright.
 *
 * MATCHED BY PHRASE, NOT BY THE STORED OFFSETS, and that is the whole design. The offsets describe
 * the text as it stood when the owner edited it; after a rebuild the field is different prose and
 * those numbers point at arbitrary characters. `applyCorrections` is right to throw in that case —
 * it is for replaying a pass against the text that produced it. This is a different job: find the
 * owner's exact phrase in the NEW text and edit there.
 *
 * EXACT AND UNAMBIGUOUS OR NOT AT ALL. The phrase must appear EXACTLY ONCE. Zero occurrences means
 * the rebuild wrote something else and the edit no longer has a target; two or more means we cannot
 * tell which the owner meant, and guessing would silently rewrite a sentence they never looked at.
 * Both cases LAPSE — reported, never applied, never silently dropped. No similarity, no nearest
 * match: this repo reserves fuzzy matching for ranking, and splicing text into the owner's document
 * is as accusation-grade as it gets.
 */
export function reapplyOwnerEdits(text: string, rows: Correction[]): {
  text: string
  applied: Correction[]
  lapsed: Array<{ row: Correction; reason: string }>
} {
  let out = String(text == null ? '' : text)
  const applied: Correction[] = []
  const lapsed: Array<{ row: Correction; reason: string }> = []
  // Ascending applied_seq so a deterministic order is replayed, not whatever order the rows arrived.
  for (const c of [...rows].sort((a, b) => a.applied_seq - b.applied_seq)) {
    const phrase = String(c.phrase == null ? '' : c.phrase)
    if (!phrase) { lapsed.push({ row: c, reason: 'the edit records no phrase to find' }); continue }
    const first = out.indexOf(phrase)
    if (first < 0) {
      lapsed.push({ row: c, reason: 'this field was rewritten and no longer contains the words you changed' })
      continue
    }
    if (out.indexOf(phrase, first + 1) >= 0) {
      lapsed.push({ row: c, reason: 'those words now appear more than once in this field, so it is not clear which one you meant' })
      continue
    }
    out = out.slice(0, first) + String(c.replacement) + out.slice(first + phrase.length)
    applied.push(c)
  }
  return { text: out, applied, lapsed }
}

/**
 * Recover the ORIGINAL text from the corrected text and the rows that produced it.
 *
 * Left to right, and — this is the part that is easy to get wrong — with NO drift compensation.
 *
 * The instinct is to carry a cumulative length delta, because the stored offsets are
 * original-relative and the text in hand is corrected. That is exactly backwards. Restoring left to
 * right means that by the time row k is processed, every correction to its LEFT has already been
 * undone, so the prefix is byte-for-byte original and row k sits at precisely `char_start`. Adding a
 * delta re-introduces the very drift the ordering just removed. (Written with the delta first; it
 * failed on the second of three corrections, which is the earliest a drift bug can possibly show.)
 *
 * This is what makes storing the original unnecessary — and, more importantly, what makes a revert
 * verifiable: the recovered original is hashed against `before_sha256`, so a field someone edited by
 * hand in between is DETECTED rather than silently mangled.
 */
export function originalOf(current: string, applied: Correction[]): string {
  let out = String(current)
  for (const c of [...applied].sort((a, b) => a.char_start - b.char_start)) {
    const end = c.char_start + c.replacement.length
    if (out.slice(c.char_start, end) !== c.replacement) {
      throw new Error(`correction ${c.applied_seq} is not where the record says it is`)
    }
    out = out.slice(0, c.char_start) + c.phrase + out.slice(end)
  }
  return out
}

export interface RevertResult {
  ok: boolean
  text?: string
  /** Why the revert was refused. A refusal writes nothing. */
  reason?: string
}

/**
 * Undo ONE correction, leaving the others applied.
 *
 * Refuses rather than guesses. If the field was rewritten since — a later pass, a manual edit —
 * the recovered original will not hash to `before_sha256` and this returns `ok:false` with a reason.
 * Writing a best-effort splice into a document nobody can check is worse than declining.
 */
export function revertOne(current: string, applied: Correction[], seq: number): RevertResult {
  const target = applied.find(c => c.applied_seq === seq)
  if (!target) return { ok: false, reason: `no applied correction with seq ${seq}` }
  let original: string
  try {
    original = originalOf(current, applied)
  } catch (e: any) {
    return { ok: false, reason: `this text no longer matches the change log (${e.message})` }
  }
  if (sha256(original) !== target.before_sha256) {
    return { ok: false, reason: 'this field was edited after the correction was applied, so the original cannot be restored safely' }
  }
  return { ok: true, text: applyCorrections(original, applied.filter(c => c.applied_seq !== seq)) }
}

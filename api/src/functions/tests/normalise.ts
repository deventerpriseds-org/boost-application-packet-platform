/**
 * DETERMINISTIC ENFORCEMENT of the mechanical rubric rules.
 *
 * WHY THIS EXISTS. The owner asked the right question: *"why are these allowed to happen? don't the
 * prompts need to be hardened or better systemized?"* Ground truth, 2026-08-22: the pipeline had two
 * automated correctors and neither covered the findings that block the gate. `applyCorrectionPass`
 * fixes only posting-ECHOES; the remediation loop is built entirely around COVERAGE. So
 * `skill_char_limit`, `relevant_char_limit` and `cross_list_redundancy` were stated in the prompt,
 * measured by the checks, and enforced by NOTHING — if the model did not comply, no mechanism made
 * it comply. Proven live: remediation on a blocked artifact returned `closed: 0, editedFields: []`
 * while 26 findings sat blocking the gate.
 *
 * THE PRINCIPLE: THE MODEL PROPOSES, CODE DECIDES.
 *
 * Asking one prompt to satisfy a twenty-rule rubric in one shot and then measuring compliance is not
 * a system. Counting characters and de-duplicating lists are things code does perfectly and language
 * models do unreliably, so they are done here. Where a fix genuinely needs language — a 34-character
 * skill cannot be truncated into a good 30-character one — the model is asked for a rewrite and the
 * result is ACCEPTED ONLY IF IT ACTUALLY SATISFIES THE RULE. A proposal that does not fit is
 * discarded and the original kept, so this pass can never make a package worse than it found it.
 *
 * ONE DEFINITION OF EVERY RULE. `SKILL_FIELDS`, `RELEVANT_FIELDS` and `splitItems` are imported from
 * the modules the CHECKS use, and the thresholds are the caller's resolved `CheckThresholds`. A
 * normaliser with its own idea of "which fields are skill lists" or "what counts as an item" would
 * satisfy itself and still fail the gate, which is the one outcome that would make this pass worse
 * than useless.
 *
 * NOT COVERED HERE, deliberately: `word_counts`. That rule spans whole prose fields (a cover-letter
 * body rewritten to hit a word band), which is a different shape of edit with a real risk of
 * degrading the owner's content, and it is not safe to do silently on every build. It stays a
 * reported finding until the owner decides.
 */
import { SKILL_FIELDS, RELEVANT_FIELDS, CheckThresholds } from './checks'
import { splitItems } from './swaps'

/** One change this pass made, for provenance and for the build's warning list. */
export interface NormaliseChange {
  field: string
  rule: 'cross_list_redundancy' | 'skill_char_limit' | 'relevant_char_limit'
  before: string
  after: string | null   // null = the item was REMOVED (dedupe)
  note: string
}

export interface NormaliseResult {
  changes: NormaliseChange[]
  /** Rules this pass could not satisfy — the model's proposal did not fit, so the original stands. */
  unresolved: string[]
}

/**
 * Ask the model to reword one item to fit. Injected rather than imported so this module stays pure
 * and testable, and so the caller decides which transport (and therefore which MODEL) is used.
 *
 * THE SAME MODEL THAT WROTE THE DRAFT SHOULD BE THE ONE THAT REWORDS IT — the owner asked for this
 * directly, and it is right: a rewrite from a different model reads as a seam in a list whose other
 * items it did not write. The caller passes its own generation transport.
 */
export type RewriteFn = (args: {
  item: string; maxChars: number; siblings: string[]; field: string
}) => Promise<string | null>

/** How the checks compare two items for redundancy. Mirrors `runChecks` exactly. */
const norm = (s: string) => s.toLowerCase().trim()

function joinItems(items: string[]): string {
  return items.join('\n')
}

/**
 * MAY THIS FIELD BE REWRITTEN AT ALL? — the guard that keeps this pass from reformatting a document.
 *
 * `splitItems` is deliberately tolerant: it splits on `\n`, `|`, `•` and `·`, and STRIPS a leading
 * `-`, `*`, `•` or `·` from every item. So `splitItems` is lossy, and `join('\n')` is NOT its
 * inverse in general — a field stored as `"- Data Governance\n- Cloud"` would be written back as
 * `"Data Governance\nCloud"`, silently deleting the bullets from a document the owner sends to an
 * employer. That is a far worse outcome than the char-limit warning this pass exists to clear.
 *
 * Verified against live data 2026-08-22: production packages store plain newline-separated items
 * with no prefixes, so the round trip IS lossless there. But "true for the rows I looked at" is not
 * an invariant, and the parser's own tolerance is evidence that other shapes are expected.
 *
 * So the rule is: rewrite a field ONLY when re-joining its parsed items reproduces the stored text
 * EXACTLY. Any other shape — bullets, pipe separators, unusual whitespace — is left untouched and
 * reported, because a finding the owner can see beats a document quietly reformatted.
 */
function roundTripSafe(original: any, items: string[]): boolean {
  return joinItems(items) === String(original == null ? '' : original).trim()
}

/**
 * Remove any item that appears in more than one list, keeping its FIRST occurrence.
 *
 * Pure code, no model: "does this string already appear in another field" has one right answer.
 * First-occurrence-wins matches the checks' own scan order (`SKILL_FIELDS` then `RELEVANT_FIELDS`),
 * so the item is kept where a reader would expect it and dropped from the later list.
 */
export function dedupeAcrossLists(pkg: Record<string, any>): NormaliseChange[] {
  const changes: NormaliseChange[] = []
  const seen = new Map<string, string>()   // normalised item -> field that owns it
  for (const f of [...SKILL_FIELDS, ...RELEVANT_FIELDS]) {
    if (pkg[f] == null || String(pkg[f]).trim() === '') continue
    const items = splitItems(pkg[f])
    if (!roundTripSafe(pkg[f], items)) continue   // formatting we cannot reproduce; leave it alone
    const kept: string[] = []
    for (const item of items) {
      const n = norm(item)
      const owner = seen.get(n)
      if (owner && owner !== f) {
        changes.push({
          field: f, rule: 'cross_list_redundancy', before: item, after: null,
          note: `already listed in ${owner}; kept there and removed here`,
        })
        continue
      }
      if (!owner) seen.set(n, f)
      kept.push(item)
    }
    if (kept.length !== items.length) pkg[f] = joinItems(kept)
  }
  return changes
}

/**
 * Bring over-long items within their character limit by REWORDING them.
 *
 * Never truncates. A chopped skill ("Enterprise Data Architecture & Gove") is worse than an over-long
 * one: it is visibly broken in a document the owner sends to an employer, where the finding it fixes
 * was only a warning on a dashboard. So the model proposes and this function verifies — a proposal is
 * accepted only when it fits, is non-empty, and does not collide with an item that already exists.
 *
 * `relevantOverLimitAllowance` is honoured rather than driving every item under the limit: the check
 * permits N items per list over the limit, so this fixes only the excess, keeping the LONGEST ones
 * as the allowed exceptions (they are the ones a rewrite would damage most).
 */
export async function enforceCharLimits(
  pkg: Record<string, any>, t: CheckThresholds, rewrite: RewriteFn,
): Promise<{ changes: NormaliseChange[]; unresolved: string[] }> {
  const changes: NormaliseChange[] = []
  const unresolved: string[] = []

  const plan: Array<{ field: string; max: number; rule: NormaliseChange['rule']; allowance: number }> = [
    ...SKILL_FIELDS.map(f => ({ field: f, max: t.skillMaxChars, rule: 'skill_char_limit' as const, allowance: 0 })),
    ...RELEVANT_FIELDS.map(f => ({ field: f, max: t.relevantMaxChars, rule: 'relevant_char_limit' as const, allowance: t.relevantOverLimitAllowance })),
  ]

  for (const { field, max, rule, allowance } of plan) {
    if (pkg[field] == null || String(pkg[field]).trim() === '') continue
    const items = splitItems(pkg[field])
    if (!roundTripSafe(pkg[field], items)) {
      unresolved.push(`${field}: stored formatting is not reproducible by a rewrite, so it was left untouched`)
      continue
    }
    // Longest-first, so the items KEPT as allowed exceptions are the ones a rewrite would damage
    // most, and the ones we ask the model to shorten are the closest to fitting already.
    const over = items.map((item, i) => ({ item, i })).filter(x => x.item.length > max)
      .sort((a, b) => b.item.length - a.item.length)
    const mustFix = over.slice(allowance)
    if (!mustFix.length) continue

    const next = [...items]
    let changedThisField = false
    for (const { item, i } of mustFix) {
      const siblings = next.filter((_, j) => j !== i)
      let proposal: string | null = null
      try {
        proposal = await rewrite({ item, maxChars: max, siblings, field })
      } catch { proposal = null }

      const clean = (proposal || '').replace(/\s+/g, ' ').trim()
      const fits = clean.length > 0 && clean.length <= max
      const collides = fits && siblings.some(s => norm(s) === norm(clean))
      if (!fits || collides) {
        // CODE DECIDES. The original stands, the finding stays reported, and nothing is silently
        // damaged. This branch is the whole reason the pass is safe to run on every build.
        unresolved.push(`${field}: "${item}" (${item.length} chars) could not be reworded within ${max}`)
        continue
      }
      changes.push({
        field, rule, before: item, after: clean,
        note: `reworded from ${item.length} to ${clean.length} chars (limit ${max})`,
      })
      next[i] = clean
      changedThisField = true
    }
    // A LOCAL flag, not a scan of the accumulating `changes` array: that array carries entries from
    // earlier fields too, so re-scanning it would rewrite a field this loop never touched.
    if (changedThisField) pkg[field] = joinItems(next)
  }
  return { changes, unresolved }
}

/**
 * Run every deterministic rule over one package, MUTATING it in place.
 *
 * Mutates for the same reason `applyCorrectionPass` does: the caller must persist the normalised
 * text and not the original, and returning a copy invites someone to store the wrong one.
 *
 * Dedupe runs FIRST: removing a duplicate can drop an over-long item entirely, so rewording before
 * de-duplicating would spend a model call on an item that is about to be deleted.
 *
 * NEVER THROWS. A normalisation failure must not take a build down — the checks still run afterwards
 * and will report anything this pass could not fix, which is exactly the state the product was in
 * before this module existed.
 */
export async function normalisePackage(
  pkg: Record<string, any>, t: CheckThresholds, rewrite: RewriteFn,
): Promise<NormaliseResult> {
  try {
    const deduped = dedupeAcrossLists(pkg)
    const { changes, unresolved } = await enforceCharLimits(pkg, t, rewrite)
    return { changes: [...deduped, ...changes], unresolved }
  } catch (e) {
    return { changes: [], unresolved: [`normalisation did not run: ${String(e).slice(0, 200)}`] }
  }
}

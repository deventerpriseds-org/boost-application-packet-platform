// P8.3 / R2 — evidence excerpts on every coverage claim.
//
// R2 says a requirement is "evidenced" only if a VERBATIM excerpt from the stored profile can be
// shown next to it, with its source named. This module is the thing that finds that excerpt, and
// the conflict register's C6 makes it load-bearing: "coverage counts recomputed from evidence rows,
// not from term placement". Before this, `checks.covers()` called a must-have covered when enough of
// its words appeared ANYWHERE in the generated document — which is a statement about the document,
// not about the candidate. A resume can be made to contain any words at all. The profile cannot.
//
// EXTENDS, DOES NOT DUPLICATE (three deliberate reuses, each one a place a second implementation
// would have become a second answer to the same question):
//   1. `appFacts.sourceText()` stays the ONLY reader of the candidate's stored profile. This module
//      never opens a Google Doc or an Azure table; it is handed the records that reader produced.
//   2. `requirements.locate()` — the same anchoring that resolves a model paraphrase back to the
//      employer's own words in the posting now resolves it back to the candidate's own words in the
//      profile. Same guarantee, both directions: the returned quote is EXACTLY
//      `record.text.slice(char_start, char_end)`, never a synthesis.
//   3. `swaps.itemTokens()` — the tokenizer `checks.covers()` used. Keeping it means the coverage
//      threshold means the same thing after the numerator moves as it did before.
//
// FUZZY MATCHING IS FOR RANKING, NEVER FOR ACCUSING (house rule). Ranking is what picks WHICH
// profile record best evidences a requirement. The accusation — "this requirement is covered" — is
// then settled by an EXACT substring assertion against the named record, and any candidate that
// fails it is discarded rather than reported. A quote that is not a substring of the record it
// names is never emitted, by construction and by an assertion in `resolveEvidence`.
//
// Nothing here calls a model. Same records + same requirement text = same row, every time.
import { createHash } from 'node:crypto'
import { locate } from './requirements'
import { itemTokens } from './swaps'
import { toBmp } from './jdText'
import { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS } from './reviewer'

/** Bump when the resolution rules change, so rows resolved under old rules are identifiable. */
export const RESOLVER_VERSION = 1

export type SourceKind = 'work_history' | 'accomplishment' | 'profile_field' | 'certification'
export const SOURCE_KINDS: SourceKind[] = ['work_history', 'accomplishment', 'profile_field', 'certification']

/**
 * One addressable unit of the stored profile — the "profile record" the acceptance criterion means
 * when it says a quote must be "a substring of the stored profile record it names".
 *
 * `key` is the STORED field name (a MasterContext column, or the resume template id), so a reviewer
 * can re-read the exact thing the quote came from. `text` is that field's body verbatim; every
 * offset in an EvidenceRow indexes THIS string and nothing else. Records are never concatenated —
 * an offset into a joined blob names no stored record and cannot be re-checked.
 */
export interface ProfileRecord {
  key: string
  kind: SourceKind
  label: string
  text: string
}

export interface EvidenceRow {
  quote: string
  source_kind: SourceKind
  source_label: string
  source_key: string
  char_start: number
  char_end: number
  /** A deterministic supporting note (SPEC 4.1's "optional supporting note"), or null. */
  extra: string | null
  /** How much of the requirement the quote accounts for. RANKING ONLY — never the accusation. */
  ratio: number
  method: 'exact' | 'anchored'
  /** Digest of the record body the offsets index. Offsets rot silently without it. */
  record_sha256: string
  resolver_version: number
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// --- what a profile record is -----------------------------------------------------------------

/**
 * MasterContext field -> the kind of source it is.
 *
 * The same shape as `requirements.CATEGORY_KIND`: a structural map of a stored schema onto an enum,
 * not a tunable. The four kinds are the ones P8.3 names. `certification` is reachable only from a
 * stored field whose NAME says so (`/cert|licen/i`) — measured 2026-08-20, the live MasterContext
 * has fifteen fields and none of them is one, so no row carries that kind today. That is absent
 * evidence reported as absent; inferring "this looks like a certification" from the CONTENT of a
 * prose block would be a fuzzy judgement dressed as a source, which is the failure this module's
 * house rule exists to prevent.
 *
 * `itemsToOmit` is absent on purpose and must stay absent: it is the list of things the owner has
 * BANNED, so quoting it as evidence would cite a banned item as something they hold. `sourceText()`
 * already excludes it; this map is the second lock on the same door.
 */
export const MC_KIND: Record<string, SourceKind> = {
  workHistory1: 'work_history',
  workHistory2: 'work_history',
  workHistory3: 'work_history',
  workHistory4: 'work_history',
  coreAccomplishments: 'accomplishment',
  resumeSummary: 'profile_field',
  skills1: 'profile_field',
  skills2: 'profile_field',
  expertise: 'profile_field',
  relevantProficiencies: 'profile_field',
  aboutMe1: 'profile_field',
  aboutMe2: 'profile_field',
  executiveProfile: 'profile_field',
  softHardSkillsPool: 'profile_field',
}

/** Human labels for the settings-screen names of those fields. */
export const MC_LABEL: Record<string, string> = {
  workHistory1: 'Work history 1', workHistory2: 'Work history 2',
  workHistory3: 'Work history 3', workHistory4: 'Work history 4',
  coreAccomplishments: 'Core accomplishments', resumeSummary: 'Resume summary',
  skills1: 'Skills list 1', skills2: 'Skills list 2', expertise: 'Current expertise',
  relevantProficiencies: 'Relevant proficiencies', aboutMe1: 'About me (short)',
  aboutMe2: 'About me (long)', executiveProfile: 'Executive profile',
  softHardSkillsPool: 'Soft/hard skills pool',
}

/** Fields that are the owner's ban list, never a source of evidence. */
export const NEVER_EVIDENCE = new Set(['itemsToOmit'])

const CERT_KEY_RE = /cert|licen/i
const looksLikeTableMeta = (k: string) =>
  k.startsWith('odata') || ['partitionKey', 'rowKey', 'etag', 'timestamp'].includes(k)

/** The first line of a block, trimmed — a work-history block leads with its role and dates. */
function firstLine(text: string, max = 70): string {
  const l = String(text || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || ''
  return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l
}

/**
 * Turn the raw profile sources into addressable records.
 *
 * `mc` is the MasterContext entity exactly as `sourceText()` reads it; `template` is the resume
 * template's text with the id it came from. Both are ALREADY read by `sourceText()` — this function
 * only gives their pieces names, kinds and boundaries.
 */
export function profileRecords(
  mc: Record<string, any> | null | undefined,
  template?: { id: string; text: string } | null,
): ProfileRecord[] {
  const out: ProfileRecord[] = []

  if (template && String(template.text || '').trim()) {
    out.push({
      key: `resume_template:${template.id}`,
      kind: 'profile_field',
      label: `Resume template · ${template.id}`,
      text: toBmp(String(template.text)),
    })
  }

  // Sorted by key, NOT left in `Object.entries` order. A Table entity's property order is the
  // storage layer's business, and an offset is only reproducible if the record list is.
  for (const [k, v] of Object.entries(mc || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (typeof v !== 'string' || !v.trim()) continue
    if (NEVER_EVIDENCE.has(k) || looksLikeTableMeta(k)) continue
    const kind: SourceKind = CERT_KEY_RE.test(k) ? 'certification' : (MC_KIND[k] || 'profile_field')
    const base = MC_LABEL[k] || k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
    // Work history leads with its role and dates, so the label can name the job the quote is from —
    // "Work history - VP Engineering, Resideo 2021-2025" rather than "Work history 2".
    const label = kind === 'work_history' && firstLine(v)
      ? `Work history · ${firstLine(v)}`
      : `${base} · stored profile`
    out.push({ key: k, kind, label, text: toBmp(v) })
  }
  return out
}

// --- resolution --------------------------------------------------------------------------------

/**
 * Share of a requirement's content words the quote must account for.
 *
 * SEEDED at 0.7 — deliberately the same value `checks.COVERAGE_THRESHOLD` used for the numerator
 * this replaces, so moving the numerator from the document to the profile does not quietly loosen
 * or tighten it at the same time.
 *
 * A SEEDED DEFAULT, not a constant, and reachable as one: it is carried on `CheckThresholds` as
 * `evidenceThreshold`, stored per owner in `owner_search_prefs.chk_evidence_threshold`, and passed
 * into `writeEvidence` on the production path. `ResolveOptions` being overridable in principle
 * while every shipped caller used the literal is the no-hardcoded-config rule broken with a
 * settings hook attached.
 */
export const EVIDENCE_THRESHOLD = 0.7
/** Below this many content words a requirement carries too little signal to evidence either way. */
export const MIN_JUDGEABLE_TOKENS = 3
/** A token this long carries real signal; a requirement of only short common words carries none. */
export const DISTINCTIVE_LEN = 6

export interface ResolveOptions {
  threshold?: number
  minTokens?: number
}

/** Content words of the requirement, deduplicated — the denominator of `ratio`. */
const wantTokens = (text: string) => Array.from(new Set(itemTokens(text)))

/**
 * Find the best verbatim excerpt in the profile that evidences this requirement, or null.
 *
 * The rules are the three `checks.covers()` learned the hard way on live Trinnex data, kept
 * deliberately, because they are the reason that check stopped calling a garbage requirement
 * covered:
 *   - a requirement with fewer than `minTokens` content words cannot be judged, and an unjudgeable
 *     requirement is NOT evidenced (it surfaces to a human instead of passing quietly);
 *   - the quote must account for at least `threshold` of the requirement's content words;
 *   - at least one DISTINCTIVE token must appear when the requirement has any. Common short words
 *     carry almost no evidence, and a requirement made only of them is exactly the fragment case.
 *
 * Records are ranked by ratio and ties are broken by record order, so the result is deterministic.
 * The winner is then re-checked as an EXACT substring of its own record; a candidate that fails
 * that is dropped, never emitted with a caveat. No non-substring quote can leave this function.
 */
export function resolveEvidence(
  requirementText: string,
  records: ProfileRecord[],
  opts: ResolveOptions = {},
): EvidenceRow | null {
  // `??` not `||`: a caller passing 0 means 0, and an owner who has not set the column passes
  // undefined, which is what the seeded default is for.
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : EVIDENCE_THRESHOLD
  const minTokens = typeof opts.minTokens === 'number' ? opts.minTokens : MIN_JUDGEABLE_TOKENS

  const text = String(requirementText || '')
  const want = wantTokens(text)
  if (want.length < minTokens) return null
  const distinctive = want.filter(t => t.length >= DISTINCTIVE_LEN)

  let best: EvidenceRow | null = null
  for (const rec of records || []) {
    if (!rec || typeof rec.text !== 'string' || !rec.text) continue
    if (NEVER_EVIDENCE.has(rec.key)) continue

    const loc = locate(text, rec.text)
    if (loc.verbatim === null || loc.char_start === null || loc.char_end === null) continue

    // The accusation-grade half: the quote must BE the record's own bytes at those offsets.
    if (rec.text.slice(loc.char_start, loc.char_end) !== loc.verbatim) continue

    // An excerpt short enough to occur by accident is not evidence. The SAME floor the citation
    // validator already publishes (`reviewer.MIN_QUOTE_CHARS/WORDS`) — a second pair of numbers for
    // the same judgement is a second answer to "is this quote substantial".
    if (loc.verbatim.length < MIN_QUOTE_CHARS) continue
    if (loc.verbatim.trim().split(/\s+/).filter(Boolean).length < MIN_QUOTE_WORDS) continue

    const inQuote = new Set(itemTokens(loc.verbatim))
    const hit = want.filter(t => inQuote.has(t))
    const ratio = hit.length / want.length
    if (ratio < threshold) continue
    if (distinctive.length && !distinctive.some(t => inQuote.has(t))) continue

    if (best && ratio <= best.ratio) continue

    const missing = want.filter(t => !inQuote.has(t))
    best = {
      quote: loc.verbatim,
      source_kind: rec.kind,
      source_label: rec.label,
      source_key: rec.key,
      char_start: loc.char_start,
      char_end: loc.char_end,
      extra: missing.length ? `the excerpt does not mention: ${missing.join(', ')}` : null,
      ratio: Math.round(ratio * 1000) / 1000,
      method: loc.match_method === 'exact' ? 'exact' : 'anchored',
      record_sha256: sha256(rec.text),
      resolver_version: RESOLVER_VERSION,
    }
  }
  return best
}

export interface ResolvedEvidence {
  seq: number
  requirement_text: string
  evidence: EvidenceRow | null
}

/** The one sentence the UI shows for a requirement nothing in the profile supports (R2). */
export const NO_EVIDENCE_NOTE = 'no evidence found in your profile'

/**
 * Resolve evidence for a whole requirement spine.
 *
 * Deliberately NOT filtered by kind: a responsibility needs its excerpt as much as a must-have, and
 * filtering here would make the JD step's three tabs disagree about what "evidenced" means.
 */
export function resolveAll(
  requirements: Array<{ seq: number; verbatim: string | null; item_text: string }>,
  records: ProfileRecord[],
  opts: ResolveOptions = {},
): ResolvedEvidence[] {
  return (requirements || []).map(r => {
    const requirement_text = r.verbatim || r.item_text || ''
    return { seq: r.seq, requirement_text, evidence: resolveEvidence(requirement_text, records, opts) }
  })
}

/**
 * The shape `checks.ts` consumes.
 *
 * `profileReadable` is the difference between "the profile does not support this" and "we could not
 * read the profile", and conflating them is exactly the failure the house rule names: a coverage
 * number computed against an empty profile would report every requirement as unevidenced and read as
 * a measurement. When the profile is unreadable there is no measurement, and the checks must say
 * `not_applicable`.
 */
export interface EvidenceInput {
  profileReadable: boolean
  bySeq: Record<number, EvidenceRow | null>
}

export function toCheckInput(resolved: ResolvedEvidence[], profileReadable: boolean): EvidenceInput {
  const bySeq: Record<number, EvidenceRow | null> = {}
  for (const r of resolved) bySeq[r.seq] = r.evidence
  return { profileReadable, bySeq }
}

// --- re-validation on read (D19) ----------------------------------------------------------------
//
// `record_sha256` exists so that a stale offset is DETECTABLE after the owner edits their profile. It
// was written on resolve, served on read, and never recomputed — which makes it a decoration rather
// than a guard. The same shape as `correction.before_sha256`, which IS recomputed: `revertOne`
// refuses rather than guesses when the text has moved. This is that discipline applied to evidence.
//
// THE DECISION, deliberately, and it is REFUSE — DO NOT GUESS — AND SAY WHICH:
//   - A stale row is NOT re-resolved on the read path. Re-resolving means WRITING, and the
//     requirements GET is readable without a verified session (`resolveOwner` accepts an unverified
//     `?owner=`), so a GET that repaired rows would be an unauthenticated write. It is also a RANKING
//     decision — an edited record may now have a better excerpt — and ranking belongs in
//     `resolveEvidence`, behind `requireWrite`, on `POST /evidence`. The read names the fix instead.
//   - A row that cannot be shown as proof is NOT rendered as proof. The excerpt is WITHHELD, not
//     caveated: an excerpt printed beside a requirement IS the claim "your profile says this,
//     verbatim", and a caveat under it does not unmake that claim.
//   - Every failing state is DISTINGUISHABLE from "no evidence found". "Your profile does not support
//     this" and "we can no longer check what your profile said" are different claims about the
//     candidate, and printing one sentence for both is exactly the conflation this module's
//     `profileReadable` comment already forbids one level up.
//
// THE OFFSETS ARE THE CLAIM; THE DIGEST IS ONLY THE ALARM. The row asserts "quote Q is the bytes of
// record K at [start,end)". That assertion is settled by slicing the CURRENT record — the same
// assertion `writeEvidence` makes before storing — and not by the digest. A digest mismatch whose
// offsets still yield Q byte-for-byte means the owner edited somewhere ELSE in that record: the quote
// is still verbatim and still proof, and demoting it would be a false accusation, which is the half
// of "fuzzy matching is for ranking, never for accusing" that gets forgotten. It is reported as
// `recordChanged` because it does mean the RANKING is stale — a reason to re-resolve, not to withhold.
//
// Records must be the ones `profileRecords()` produces, never raw MasterContext values: the stored
// offsets and the stored digest were both measured on `toBmp(...)`-folded text, and an offset measured
// against one folding is meaningless against another. (H32's lower-casing defect is the same class one
// level down, and is why `locate` measures on the original string; a folding applied HERE would
// reintroduce it on the read side, where no substring guard could catch it either.)

/** Bump when these verification rules change, so a verdict can be attributed to a ruleset. */
export const VERIFY_VERSION = 1

/**
 * What a stored evidence row is, right now, measured against the profile as it stands.
 *
 * `none` is the ABSENCE of a row. Every other non-`verified` value is a row that EXISTS and cannot be
 * shown, and collapsing those into `none` loses the distinction the owner needs in order to act.
 */
export type EvidenceState = 'none' | 'verified' | 'stale' | 'misresolved' | 'source_missing' | 'unverified'

/** The stored columns verification needs. A subset of `EvidenceRow`, so a DB row satisfies it too. */
export interface StoredEvidence {
  quote: string
  source_key: string
  char_start: number
  char_end: number
  record_sha256?: string | null
}

export interface EvidenceVerdict {
  state: EvidenceState
  /** The ONE field a caller may read as "this may be shown as a verbatim quote". */
  proof: boolean
  /** The record body differs from the one this row was resolved against — the ranking is stale. */
  recordChanged: boolean
  /** The quote is still somewhere in the record, but no longer at the offsets stored. */
  quoteMoved: boolean
  /** The sentence to show the owner. Null only when `state` is `verified`. */
  note: string | null
}

/** A row exists, its record exists, and the excerpt is no longer that record's bytes at its offsets. */
export const EVIDENCE_STALE_NOTE =
  'your profile changed after this excerpt was resolved, so it can no longer be shown as a verbatim quote — re-resolve the evidence for this opportunity'
/** A row exists and names a profile record that is no longer in the profile at all. */
export const EVIDENCE_SOURCE_MISSING_NOTE =
  'the profile record this excerpt was taken from is no longer in your profile — re-resolve the evidence for this opportunity'
/**
 * A row exists, the record is BYTE-IDENTICAL to the one it was resolved against, and the offsets
 * still do not name the quote. Nothing changed, so the offsets were wrong when they were written.
 *
 * This is not hypothetical and it is why the state exists rather than being folded into `stale`.
 * H32: `locate`'s exact branch indexed a LOWER-CASED copy of the haystack, and `toLowerCase()` is
 * not length-preserving (U+0130 lowercases to two code units), so every such character before a
 * match shifted the recorded offset — the stored excerpt was a true substring of the record at the
 * offsets recorded and simply the wrong characters. That was fixed at the WRITE side
 * (`EXTRACTOR_VERSION` 1 -> 2); rows written before it are still in the table, and re-validation on
 * read is the first thing that can see them. Telling that owner "your profile changed" would be a
 * false statement about them — the digest proves it did not — so it gets its own sentence.
 */
export const EVIDENCE_MISRESOLVED_NOTE =
  'this excerpt does not match the profile record it names, and that record has not changed — it was recorded against the wrong position and needs re-resolving'
/** A row exists and the profile could not be read, so nothing about it could be checked. */
export const EVIDENCE_UNVERIFIED_NOTE =
  'your profile could not be read, so this excerpt could not be re-verified and is not shown as a quote'

/**
 * The sentence for each non-provable state, in ONE place, so every surface prints the same words and
 * no two states can accidentally print the same sentence.
 */
export const EVIDENCE_NOTE: Record<Exclude<EvidenceState, 'verified'>, string> = {
  none: NO_EVIDENCE_NOTE,
  stale: EVIDENCE_STALE_NOTE,
  misresolved: EVIDENCE_MISRESOLVED_NOTE,
  source_missing: EVIDENCE_SOURCE_MISSING_NOTE,
  unverified: EVIDENCE_UNVERIFIED_NOTE,
}

/**
 * Re-validate one stored evidence row against the profile as it stands NOW.
 *
 * `records` is `null` when the profile could not be read — which is NOT the same as a profile that
 * contains no records, and must never be passed as `[]`. The convention is the one already in this
 * file: `profileReadable` is `records.length > 0`, so a caller passes `readable ? records : null`.
 * An unreadable profile yields `unverified`, never `verified` and never `stale`: absent evidence is
 * `not_applicable` — never a pass, and never an accusation either.
 */
export function verifyEvidence(
  stored: StoredEvidence | null | undefined,
  records: ProfileRecord[] | null,
): EvidenceVerdict {
  const miss = (state: Exclude<EvidenceState, 'verified'>, extra: Partial<EvidenceVerdict> = {}): EvidenceVerdict =>
    ({ state, proof: false, recordChanged: false, quoteMoved: false, note: EVIDENCE_NOTE[state], ...extra })

  if (!stored || typeof stored.quote !== 'string' || !stored.quote) return miss('none')
  if (records == null) return miss('unverified')

  const rec = records.find(r => r && r.key === stored.source_key)
  if (!rec || typeof rec.text !== 'string') return miss('source_missing')

  // No usable digest stored: the ranking cannot be attributed to a known record body, so it is
  // reported as changed rather than silently claimed current. It does not affect `proof`.
  const changed = typeof stored.record_sha256 === 'string' && /^[0-9a-f]{64}$/.test(stored.record_sha256)
    ? sha256(rec.text) !== stored.record_sha256
    : true

  // THE CLAIM, re-made against today's text.
  if (rec.text.slice(stored.char_start, stored.char_end) === stored.quote) {
    return { state: 'verified', proof: true, recordChanged: changed, quoteMoved: false, note: null }
  }
  // The record is byte-identical and the offsets STILL do not name the quote: nothing moved, so the
  // row was recorded wrong. Attributing that to an edit the owner did not make is a false statement
  // about them, and the digest is exactly the evidence that separates the two.
  const moved = rec.text.includes(stored.quote)
  if (!changed) return miss('misresolved', { recordChanged: false, quoteMoved: moved })
  return miss('stale', { recordChanged: true, quoteMoved: moved })
}

/** How many rows are in each state — the honest denominator behind any coverage claim. */
export interface EvidenceHealth {
  total: number
  verified: number
  stale: number
  /** Offsets that were wrong when written, against a record that has not changed since (see H32). */
  misresolved: number
  sourceMissing: number
  unverified: number
  none: number
  /** Rows still provable whose record has since changed — a reason to re-resolve, not to withhold. */
  recordChanged: number
  profileReadable: boolean
  verifyVersion: number
}

export function emptyHealth(profileReadable: boolean): EvidenceHealth {
  return {
    total: 0, verified: 0, stale: 0, misresolved: 0, sourceMissing: 0, unverified: 0, none: 0,
    recordChanged: 0, profileReadable, verifyVersion: VERIFY_VERSION,
  }
}

/**
 * The buckets always sum to `total` — a row is in exactly one state.
 *
 * Written as a lookup off the state rather than an `if` chain ending in `else h.none++`, because
 * that ending is how a state added later gets silently counted as "no evidence" — which is the one
 * miscount this whole module exists to prevent. An unknown state throws instead.
 */
const HEALTH_BUCKET: Record<EvidenceState, keyof EvidenceHealth> = {
  verified: 'verified', stale: 'stale', misresolved: 'misresolved',
  source_missing: 'sourceMissing', unverified: 'unverified', none: 'none',
}

export function tallyHealth(verdicts: EvidenceVerdict[], profileReadable: boolean): EvidenceHealth {
  const h = emptyHealth(profileReadable)
  for (const v of verdicts) {
    h.total++
    const bucket = HEALTH_BUCKET[v.state]
    if (!bucket) throw new Error(`unknown evidence state '${v.state}' — it has no bucket and would be miscounted`)
    ;(h as any)[bucket]++
    if (v.recordChanged) h.recordChanged++
  }
  return h
}

// P3 — the remediation loop, as PURE logic. No @azure/functions, no pg, no network, no clock of its
// own. Everything that decides whether a pass runs, what it may rewrite, what it may take credit
// for, and when it must stop lives here; `appRemediation.ts` supplies the database, the model call
// and the wall clock. That split is what makes the four criteria below testable in a sandbox that
// cannot reach Postgres, OpenAI or Drive.
//
// WHAT THIS MODULE IS DEFENDING AGAINST. A loop is a machine for producing green. Left to itself it
// will reach green the cheap ways: by taking credit for coverage it did not create, by stopping and
// calling that success, or by removing the evidence that said it had failed. Each of those has a
// named guard here, and each guard has a test that was watched to fail before it was kept.
//
//   P3-05  `converged` is the one word a user trusts without reading further. It is legal ONLY when
//          nothing is open AND the run's own must_have_coverage check says `pass`. This module
//          refuses to emit it otherwise, AND the table refuses to store it otherwise (a CHECK plus a
//          composite FK into check_result — see schema.ts). Writer discipline is not the guarantee.
//   P3-11  A close requires an EDIT THAT CARRIES THE EVIDENCE. `covers()` is token overlap over the
//          whole document, so rewriting an unrelated field can flip a requirement to covered and a
//          naive loop would bank it. `creditClosures` credits a flip only when text this pass
//          actually wrote covers that requirement, using the SAME predicate the gate uses.
//   P3-25  Rendering is not this module's business at all, and that is the point: the loop mutates
//          the package, never the document. Documents are copied once, after the loop.
//   P3-37  Green because fixed, never because stopped. `reportedOutcome` cannot say converged while
//   /38    anything is open, and `evidenceRemoved` names a run that got greener by deleting rows.
//
// THE DENOMINATOR (D-12). The loop's `remaining` is read from the deterministic engine's
// `must_have_coverage` offenders — NOT from `requirement` rows directly. That is deliberate: the
// engine has already removed the requirements no merge field can carry (`template_reach`) and the
// ones the owner's facts settle (`facts_settled` / `facts_needed`). A loop reading requirement rows
// would chase clauses like "must reside on the East Coast" that no generated field can ever
// evidence, and burn all four passes on them. If the engine could not judge coverage at all, the
// loop stops rather than optimising against nothing — absent evidence is not a target.
import { CheckResult, CheckState, coversText } from './checks'
import { mergeFieldsFor } from './insertions'

export const REMEDIATION_VERSION = 1

/**
 * The pass number a NEW run starts at, given the highest already recorded for this artifact.
 *
 * A second run must CONTINUE the ledger, not restart it. `remediation_loop` is keyed
 * `unique (artifact_id, n)` and the writer upserts, so a run that began again at 1 would silently
 * overwrite the first run's rows - the same defect as `writeSwaps` deleting the whole packet (H26),
 * one table over. It matters most exactly when it is least visible: an escalation resolved by the
 * user reopens the loop (BACKLOG P3.2), so the SECOND run is the normal case, not the edge case.
 *
 * `insertion.loop` and `swap_decision.loop` are written with the same number, so the before/after
 * evidence for pass n belongs to pass n across all three tables.
 */
export function nextPassNumber(existingMax: number | null | undefined): number {
  const n = Number(existingMax)
  return Number.isFinite(n) && n >= 0 ? n + 1 : 1
}

// ---------------------------------------------------------------------------------------------
// Halting
// ---------------------------------------------------------------------------------------------

export type HaltReason =
  | 'converged'             // nothing open AND the run's must_have_coverage says pass
  | 'no_progress'           // a pass closed nothing (backlog P3.1)
  | 'max_passes'            // the owner's pass ceiling
  | 'cost_ceiling'          // the owner's USD ceiling, measured on PRICED calls only
  | 'token_ceiling'         // the owner's token ceiling — and the guard that bites when cost is unknown
  | 'time_budget'           // the Functions consumption-plan timeout guard
  | 'no_coverage_evidence'  // coverage could not be judged; there is nothing honest to optimise
  | 'nothing_reachable'     // every field the loop could rewrite is the sole evidence for a closed requirement
  | 'unattributed_coverage' // the open list emptied, but nothing this run wrote accounts for it
  | 'ungrounded'            // no posting: remediating toward our own metadata is what X1 forbids
  | 'error'                 // the pass threw; recorded rather than swallowed

export const HALT_REASONS: HaltReason[] = [
  'converged', 'no_progress', 'max_passes', 'cost_ceiling', 'token_ceiling',
  'time_budget', 'no_coverage_evidence', 'nothing_reachable', 'unattributed_coverage',
  'ungrounded', 'error',
]

/** A halt that is not `converged` leaves whatever the gate said standing. Never re-coloured here. */
export const isHonestGreen = (r: HaltReason | null): boolean => r === 'converged'

// ---------------------------------------------------------------------------------------------
// Budget (P3-29/30/31) — enforced, not observed
// ---------------------------------------------------------------------------------------------

export interface LoopPrefs {
  maxPasses: number
  costCeilingUsd: number
  wallClockMs: number
  tokenCeiling: number
  /**
   * D-4. These four were code-only literals, and the repo's "No hardcoded config" rule is not
   * satisfied by owning the CEILINGS while the model, its caps and how much profile it may read
   * stay baked in. Each is behaviour-affecting: `model` decides what every pass runs on,
   * `profileChars` directly bounds what P3-18 can surface (the whole point of the loop is that the
   * evidence is usually already in the profile), and temperature on a remediation pass is the
   * difference between rephrasing evidence and inventing it.
   */
  model: string
  maxTokens: number
  temperature: number
  profileChars: number
}

/**
 * Seeded FIRST values, not constants. `appRemediation.ensureLoopPrefs` writes them onto
 * `owner_search_prefs` — the established per-owner settings store that `ensureCheckPrefs` and
 * `jdSweep` already extend — and the owner changes them from there.
 *
 * `wallClockMs` is 180s to match `appApply.atsBackfill`'s guard, which was sized against the same
 * Functions consumption-plan timeout this loop runs under.
 */
export const DEFAULT_LOOP_PREFS: LoopPrefs = {
  maxPasses: 4,
  costCeilingUsd: 0.50,
  wallClockMs: 180_000,
  tokenCeiling: 400_000,
  model: 'gpt-4o-mini',
  maxTokens: 4000,
  // Low on purpose: a remediation pass rewrites evidenced claims, and the one call in the run that
  // should be least creative is the one asked not to invent anything.
  temperature: 0.4,
  profileChars: 12_000,
}

/**
 * What the loop has consumed.
 *
 * `unpricedCalls` exists because `costOf()` returns NULL for a model with no known price, and the
 * one thing that must never happen is null being added as zero: an unpriced model would then look
 * free, the cost ceiling would never trip, and the loop would run unbounded on the most expensive
 * model in the catalogue. Unpriced calls are counted, `usd` is left as the KNOWN spend only, and
 * `costComplete` says whether the ceiling can be trusted. When it cannot, the token ceiling is what
 * bounds the run.
 */
export interface Spend {
  usd: number
  unpricedCalls: number
  tokens: number
  elapsedMs: number
  passesDone: number
}

export const ZERO_SPEND: Spend = { usd: 0, unpricedCalls: 0, tokens: 0, elapsedMs: 0, passesDone: 0 }

/** Fold one model call into the running spend. `costUsd === null` means unpriced, NEVER free. */
export function addCall(spend: Spend, call: { costUsd: number | null; tokens: number }): Spend {
  return {
    ...spend,
    usd: spend.usd + (call.costUsd === null ? 0 : call.costUsd),
    unpricedCalls: spend.unpricedCalls + (call.costUsd === null ? 1 : 0),
    tokens: spend.tokens + (Number(call.tokens) || 0),
  }
}

export const costComplete = (s: Spend): boolean => s.unpricedCalls === 0

export interface BudgetVerdict { halt: boolean; reason: HaltReason | null; detail: string; costComplete: boolean }

/**
 * May another pass run?
 *
 * The token ceiling is checked on EVERY run, not only when the price is unknown: it is the one
 * bound that holds regardless of what the model costs. The USD ceiling is checked only when every
 * call so far was priced, because a spend figure that omits unpriced calls is an undercount and
 * "under the ceiling" derived from an undercount is a false statement, not a conservative one.
 */
export function budgetVerdict(spend: Spend, prefs: LoopPrefs): BudgetVerdict {
  const complete = costComplete(spend)
  const halt = (reason: HaltReason, detail: string): BudgetVerdict => ({ halt: true, reason, detail, costComplete: complete })

  if (spend.elapsedMs >= prefs.wallClockMs) {
    return halt('time_budget', `${Math.round(spend.elapsedMs / 1000)}s elapsed, ceiling ${Math.round(prefs.wallClockMs / 1000)}s`)
  }
  if (spend.tokens >= prefs.tokenCeiling) {
    return halt('token_ceiling', `${spend.tokens} tokens used, ceiling ${prefs.tokenCeiling}`
      + (complete ? '' : ` (${spend.unpricedCalls} call(s) on an unpriced model — the token ceiling is the binding limit)`))
  }
  if (complete && spend.usd >= prefs.costCeilingUsd) {
    return halt('cost_ceiling', `$${spend.usd.toFixed(4)} spent, ceiling $${prefs.costCeilingUsd.toFixed(4)}`)
  }
  if (spend.passesDone >= prefs.maxPasses) {
    return halt('max_passes', `${spend.passesDone} pass(es) run, ceiling ${prefs.maxPasses}`)
  }
  return {
    halt: false, reason: null, costComplete: complete,
    detail: complete
      ? `$${spend.usd.toFixed(4)}/${prefs.costCeilingUsd.toFixed(4)}, ${spend.tokens}/${prefs.tokenCeiling} tokens, pass ${spend.passesDone}/${prefs.maxPasses}`
      : `cost unknown (${spend.unpricedCalls} unpriced call(s)); ${spend.tokens}/${prefs.tokenCeiling} tokens, pass ${spend.passesDone}/${prefs.maxPasses}`,
  }
}

// ---------------------------------------------------------------------------------------------
// Reading coverage out of the deterministic engine
// ---------------------------------------------------------------------------------------------

/** Offenders are formatted `#<seq> <text>` by `checks.ts`; `artifactScore.ts` parses them the same way. */
export function offenderSeqs(offenders: string[] | null | undefined): number[] {
  const out: number[] = []
  for (const o of offenders || []) {
    const m = /^#(\d+)\b/.exec(String(o))
    if (m) out.push(Number(m[1]))
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

export interface CoverageView {
  /** The `must_have_coverage` state for this run, verbatim. `not_applicable` is NOT a pass. */
  state: CheckState
  /** True when the engine reached a verdict at all. `not_applicable` and a missing row are both false. */
  judged: boolean
  /** The uncovered must-haves the engine named — already net of eligibility and fact-settled rows. */
  openSeqs: number[]
  /** Named so an escalation can say what was excluded and why, rather than silently narrowing. */
  eligibilitySeqs: number[]
  factsNeededSeqs: number[]
  observed: string
}

export function coverageView(results: CheckResult[]): CoverageView {
  const find = (k: string) => (results || []).find(r => r.check_key === k && r.engine === 'deterministic')
  const mh = find('must_have_coverage')
  const reach = find('template_reach')
  const need = find('facts_needed')
  const state: CheckState = mh ? mh.state : 'not_applicable'
  return {
    state,
    judged: !!mh && state !== 'not_applicable',
    openSeqs: mh && state === 'fail' ? offenderSeqs(mh.offenders) : [],
    eligibilitySeqs: reach && reach.state === 'not_applicable' ? offenderSeqs(reach.offenders) : [],
    factsNeededSeqs: need ? offenderSeqs(need.offenders) : [],
    observed: mh ? mh.observed : 'no must_have_coverage check was run',
  }
}

// ---------------------------------------------------------------------------------------------
// P3-11 — a close requires an edit that carries the evidence
// ---------------------------------------------------------------------------------------------

export interface EditRow { merge_field: string; before_text: string | null; after_text: string | null }

/**
 * The edits a pass actually made.
 *
 * An `insertion` row exists for every merge field on every pass, filled or not, so their presence
 * proves nothing. Only a row whose `after_text` differs from its `before_text` is an edit — that is
 * the exact wording of P3-11 and it is the whole difference between a loop that fixed something and
 * a loop that re-rendered the same package.
 */
export function realEdits(rows: EditRow[]): EditRow[] {
  return (rows || []).filter(r => {
    const after = r.after_text == null ? '' : String(r.after_text)
    const before = r.before_text == null ? '' : String(r.before_text)
    return after.trim() !== '' && after !== before
  })
}

export interface RequirementRow { seq: number; verbatim: string | null; item_text: string }

export interface CreditInput {
  /** Requirements the engine reported open BEFORE this pass. */
  wasOpen: number[]
  /** Requirements the engine reports open AFTER this pass. */
  nowOpen: number[]
  /** This pass's insertion rows — every merge field, changed or not. */
  edits: EditRow[]
  requirements: RequirementRow[]
}

export interface CreditResult {
  /** Flips this pass may take credit for. Safe to write as `closed` on the loop row. */
  closed: number[]
  /**
   * Flips that happened WITHOUT an edit carrying the evidence. Recorded, never credited. This is the
   * headline defect class: an edit to an unrelated field pushes tokens into the document, whole-
   * document overlap flips a requirement to covered, and the loop banks a close it did not make.
   */
  phantom: number[]
  /** The engine's own open list after the pass. The gate's truth, not the loop's ledger. */
  remaining: number[]
  /** Merge fields this pass genuinely rewrote. Empty means the pass changed nothing. */
  editedFields: string[]
}

export function creditClosures(input: CreditInput): CreditResult {
  const nowOpen = [...new Set(input.nowOpen || [])].sort((a, b) => a - b)
  const nowSet = new Set(nowOpen)
  const flipped = [...new Set(input.wasOpen || [])].filter(s => !nowSet.has(s)).sort((a, b) => a - b)

  const edits = realEdits(input.edits || [])
  const editedFields = edits.map(e => e.merge_field)
  // ONLY the text this pass wrote. Not the document — that is precisely the mistake.
  const writtenText = edits.map(e => String(e.after_text)).join('\n')
  const bySeq = new Map<number, RequirementRow>((input.requirements || []).map(r => [r.seq, r]))

  const closed: number[] = []
  const phantom: number[] = []
  for (const seq of flipped) {
    const r = bySeq.get(seq)
    // No requirement row means we cannot show what closed it, so we do not claim to have closed it.
    const credited = !!r && edits.length > 0 && coversText(writtenText, r)
    ;(credited ? closed : phantom).push(seq)
  }
  return { closed, phantom, remaining: nowOpen, editedFields }
}

// ---------------------------------------------------------------------------------------------
// Scope — the primitive that did not exist (D-8 / decision 17)
// ---------------------------------------------------------------------------------------------

/**
 * Fields that are facts about the application rather than evidence about the candidate. Rewriting
 * them cannot close a requirement and CAN break `company_named`, so they are never in scope.
 */
export const STRUCTURAL_FIELDS = ['@Company', '@CoverLetterDate']

export interface ScopeResult {
  /** Fields the pass may rewrite. */
  fields: string[]
  /** Fields withheld because they are the ONLY evidence for a requirement that is already closed. */
  protected: Array<{ field: string; protects: number[] }>
}

/**
 * Which merge fields may this pass rewrite?
 *
 * "Do not rewrite closed blocks" (backlog P3.1) needs a definition of "closed block", and the
 * package has no per-field requirement map. It can be derived with no model call and no new
 * concept: a field is withheld when it covers an already-covered requirement that NO OTHER FIELD
 * covers — rewriting it is the one action that can turn a closed requirement back into an open one.
 * Everything else is fair game, because another field still carries the evidence.
 *
 * When every candidate field is withheld the scope is empty and the caller must halt
 * (`nothing_reachable`) rather than rewrite anyway. An empty scope is a real answer: there is no
 * edit available that does not cost evidence we already have.
 */
export function scopeForRequirements(
  type: string,
  pkg: Record<string, any>,
  requirements: RequirementRow[],
  openSeqs: number[],
): ScopeResult {
  const openSet = new Set(openSeqs || [])
  const candidates = mergeFieldsFor(type).filter(f => !STRUCTURAL_FIELDS.includes(f))
  const closedReqs = (requirements || []).filter(r => !openSet.has(r.seq))

  // field -> the closed requirements its CURRENT text covers
  const coverMap = new Map<string, number[]>()
  for (const f of candidates) {
    const text = pkg?.[f] == null ? '' : String(pkg[f])
    coverMap.set(f, text.trim() ? closedReqs.filter(r => coversText(text, r)).map(r => r.seq) : [])
  }
  // how many candidate fields cover each closed requirement
  const holders = new Map<number, number>()
  for (const seqs of coverMap.values()) for (const s of seqs) holders.set(s, (holders.get(s) || 0) + 1)

  const fields: string[] = []
  const withheld: Array<{ field: string; protects: number[] }> = []
  for (const f of candidates) {
    const sole = (coverMap.get(f) || []).filter(s => (holders.get(s) || 0) === 1)
    if (sole.length) withheld.push({ field: f, protects: sole })
    else fields.push(f)
  }
  return { fields, protected: withheld }
}

// ---------------------------------------------------------------------------------------------
// Applying a scoped regeneration
// ---------------------------------------------------------------------------------------------

export interface ApplyResult {
  pkg: Record<string, any>
  applied: string[]
  /** Keys the model returned that were not in scope, or that were blank. Never written. */
  rejected: Array<{ field: string; why: string }>
}

/**
 * Merge a scoped regeneration into the package.
 *
 * This is the enforcement half of the primitive. Without it "scoped" is a request in a prompt, and a
 * model that returns an extra key rewrites a field the loop promised not to touch — which is exactly
 * the whole-package regeneration D-8 says destroys content that was already correct. Anything
 * outside `allowed` is rejected and named. A blank value is rejected too: emptying a correct field
 * is a deletion, not a remediation.
 */
export function applyScopedFields(
  pkg: Record<string, any>,
  fields: Record<string, any> | null | undefined,
  allowed: string[],
): ApplyResult {
  const allow = new Set(allowed || [])
  const out: Record<string, any> = { ...(pkg || {}) }
  const applied: string[] = []
  const rejected: Array<{ field: string; why: string }> = []
  for (const [k, v] of Object.entries(fields || {})) {
    if (!allow.has(k)) { rejected.push({ field: k, why: 'outside the scope this pass was allowed to rewrite' }); continue }
    const s = v == null ? '' : String(v).trim()
    if (!s) { rejected.push({ field: k, why: 'blank — emptying a field is a deletion, not a remediation' }); continue }
    if (s === (out[k] == null ? '' : String(out[k]))) { rejected.push({ field: k, why: 'identical to the current text' }); continue }
    out[k] = s
    applied.push(k)
  }
  return { pkg: out, applied, rejected }
}

// ---------------------------------------------------------------------------------------------
// The prompt for one scoped pass
// ---------------------------------------------------------------------------------------------

/**
 * Open requirements the STANDING PROFILE already evidences, using the same predicate as the gate.
 *
 * P3-18. The backlog's own example is the $18M budget and the 60+ team size: both were in the work
 * history and were simply never pulled forward. A requirement in this list is one the loop should be
 * able to close from evidence already held - and if a pass fails to close it anyway, that is a
 * different and more damning finding than "the candidate does not have it".
 */
export function profileEvidenceFor(profileText: string, open: RequirementRow[]): number[] {
  const text = String(profileText || '')
  if (!text.trim()) return []
  return (open || []).filter(r => coversText(text, r)).map(r => r.seq).sort((a, b) => a - b)
}

export interface ScopedPromptInput {
  company: string
  role: string
  pass: number
  fields: string[]
  current: Record<string, any>
  open: Array<{ seq: number; verbatim: string | null; item_text: string; kind: string }>
  profileText?: string
  omitList?: string
  /** D-4 — owner-owned; was a bare `.slice(0, 12000)`. It bounds what P3-18 can surface. */
  profileChars?: number
  /** D-5 — evidence the user supplied when resolving an escalation. */
  suppliedEvidence?: Array<{ seq: number | null; note: string }>
}

/**
 * Build the scoped regeneration prompt.
 *
 * Two things are load-bearing here, both from the backlog:
 *  - "Loop 2+ should first look for evidence already in the profile that was not surfaced" — the
 *    $18M budget and the 60+ team size existed in the work history and were simply not pulled
 *    forward. So the standing profile is supplied and the model is told to mine it FIRST.
 *  - "zero invented content anywhere in the assets" — an uncoverable requirement must produce an
 *    escalation, not a fabricated line. The instruction is explicit and the deterministic checks
 *    still run afterwards, so a fabrication is a finding rather than a silent success.
 */
export function buildScopedPrompt(input: ScopedPromptInput): { system: string; user: string } {
  const system = [
    'You revise ONE part of an executive application package.',
    'You are given the current text of a few named fields and the specific posting requirements that are not yet evidenced.',
    'Rewrite ONLY the named fields so the missing requirements are evidenced by experience the candidate ALREADY HAS.',
    'NEVER invent an employer, a metric, a title, a date, a certification or a system the profile does not contain.',
    'If a requirement cannot be evidenced from the profile, leave it unaddressed — an honest gap is escalated to the candidate; a fabricated one is a lie in a job application.',
    'Return STRICT JSON: an object whose keys are EXACTLY the field names given, each mapped to the full replacement text for that field. No prose, no markdown, no extra keys.',
  ].join('\n')

  const openLines = input.open.map(r =>
    `- [#${r.seq} ${r.kind}] ${r.verbatim ? `"${r.verbatim}"` : r.item_text}`).join('\n') || '- (none)'
  const currentLines = input.fields.map(f =>
    `### ${f}\n${input.current?.[f] == null || String(input.current[f]).trim() === '' ? '(empty)' : String(input.current[f])}`).join('\n\n')

  const user = [
    `TARGET: ${input.role || 'the role'} at ${input.company || 'the company'} — remediation pass ${input.pass}.`,
    '',
    'REQUIREMENTS THE DOCUMENT DOES NOT YET EVIDENCE (the employer\'s own words where available):',
    openLines,
    '',
    'FIELDS YOU MAY REWRITE (and no others):',
    input.fields.map(f => `- ${f}`).join('\n'),
    '',
    'CURRENT TEXT OF THOSE FIELDS:',
    currentLines,
    '',
    'THE CANDIDATE\'S STANDING PROFILE — mine this FIRST. Evidence that closes a requirement is usually already here and simply was not pulled forward:',
    (input.profileText || '(no profile supplied)').slice(0, Math.max(500, Number(input.profileChars) || 12000)),
    '',
    (input.suppliedEvidence || []).length
      ? 'EVIDENCE THE CANDIDATE SUPPLIED FOR THESE REQUIREMENTS (they wrote this themselves when asked; treat it as profile fact and use it):\n'
        + (input.suppliedEvidence || []).map(e => `- ${e.seq === null ? '(general)' : `#${e.seq}`}: ${e.note}`).join('\n')
      : '',
    (input.suppliedEvidence || []).length ? '' : null,
    input.omitList && String(input.omitList).trim()
      ? `NEVER USE ANY OF THE FOLLOWING (the candidate's own do-not-use list):\n${input.omitList}`
      : 'NEVER USE: (no do-not-use list configured)',
    '',
    `Return JSON with exactly these keys: ${JSON.stringify(input.fields)}`,
  ].filter(l => l !== null && l !== '').join('\n')

  return { system, user }
}

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

export interface PassState {
  /** The pass that is about to run, 1-based. */
  pass: number
  coverage: CoverageView
  /** The engine's open list after the most recent evaluation. */
  remaining: number[]
  /** Did the previous pass close anything? `null` before any pass has run. */
  progressedLastPass: boolean | null
  /**
   * Requirements that LEFT the open list without any pass's own writing accounting for them.
   *
   * This is the hole the P3-11 column guard does not cover. `creditClosures` correctly refuses to
   * put a phantom flip in `closed[]` - but refusing the CREDIT is not the same as refusing the
   * CLAIM. With `remaining` empty and the engine's check passing, the run would go on to report
   * "Converged: every must-have requirement is covered" having credited nothing and written one
   * unrelated field. Taking credit in a sentence is still taking credit.
   */
  phantomSoFar: number
  spend: Spend
  prefs: LoopPrefs
  /** Fields the next pass would be allowed to rewrite. */
  scope: string[]
}

export interface PassDecision { action: 'regenerate' | 'halt'; reason: HaltReason | null; detail: string }

/**
 * Should another pass run, and if not, why not?
 *
 * ORDER IS THE ARGUMENT. Convergence is tested before every budget rule so a run that genuinely
 * finished is never mislabelled as having run out of money; the budget rules are tested before
 * `no_progress` so a run cut short by a ceiling is never reported as having nothing left to fix.
 * Every exit names itself — "halted" with no reason is how a loop that gave up gets read as a loop
 * that succeeded.
 */
export function decidePass(s: PassState): PassDecision {
  const cov = s.coverage
  if (!cov.judged) {
    return { action: 'halt', reason: 'no_coverage_evidence',
      detail: `must_have_coverage is ${cov.state} — ${cov.observed}. Absent evidence is not a target and never a pass.` }
  }
  if (!s.remaining.length) {
    if (cov.state !== 'pass') {
      return { action: 'halt', reason: 'no_coverage_evidence',
        detail: `nothing is listed open but must_have_coverage is ${cov.state}; that is not convergence` }
    }
    // Nothing open AND the engine says pass - but if requirements left the open list that no pass's
    // own writing accounts for, this run did not close them and must not say it did.
    if (s.phantomSoFar > 0) {
      return { action: 'halt', reason: 'unattributed_coverage',
        detail: `every must-have now reads as covered, but ${s.phantomSoFar} of them left the open list `
          + `with no edit from this run carrying the evidence. The document may have been covering them `
          + `already. Nothing was closed by this run.` }
    }
    return { action: 'halt', reason: 'converged', detail: `every must-have is covered — ${cov.observed}` }
  }
  const b = budgetVerdict(s.spend, s.prefs)
  if (b.halt) return { action: 'halt', reason: b.reason, detail: b.detail }

  if (s.progressedLastPass === false) {
    return { action: 'halt', reason: 'no_progress',
      detail: `pass ${s.pass - 1} closed nothing; ${s.remaining.length} must-have(s) still open` }
  }
  if (!s.scope.length) {
    return { action: 'halt', reason: 'nothing_reachable',
      detail: 'every rewritable field is the only evidence for a requirement that is already covered' }
  }
  return { action: 'regenerate', reason: null,
    detail: `pass ${s.pass}: ${s.remaining.length} open, rewriting ${s.scope.length} field(s) — ${b.detail}` }
}

// ---------------------------------------------------------------------------------------------
// P3-37/38 — green because fixed, never because stopped, and never by deleting evidence
// ---------------------------------------------------------------------------------------------

export interface EvidenceSnapshot {
  /** Rows in `requirement` for this opportunity. */
  reqCount: number
  mustHaveState: CheckState
}

/**
 * Did this run get greener by REMOVING evidence rather than by fixing anything?
 *
 * Two ways that happens, both observed as classes rather than incidents:
 *   - requirement rows disappear, so there is less to fail against;
 *   - `must_have_coverage` slides from `fail` to `not_applicable`, which is not a pass but colours
 *     like one in any UI that treats "no findings" as fine.
 * Returns the reason, or null when the evidence is intact.
 */
export function evidenceRemoved(before: EvidenceSnapshot, after: EvidenceSnapshot): string | null {
  if (after.reqCount !== before.reqCount) {
    return `requirement rows changed during the loop: ${before.reqCount} -> ${after.reqCount}. The loop may not add or remove the evidence it is judged against.`
  }
  if (before.mustHaveState === 'fail' && after.mustHaveState === 'not_applicable') {
    return 'must_have_coverage went fail -> not_applicable. That is evidence disappearing, not coverage being achieved.'
  }
  return null
}

/** Throwing form, for the write path: a run that removed evidence must not be stored as a result. */
export function assertEvidenceIntact(before: EvidenceSnapshot, after: EvidenceSnapshot): void {
  const why = evidenceRemoved(before, after)
  if (why) throw new Error(`remediation refused: ${why}`)
}

export interface LoopRowLike {
  n: number; halted: boolean; halt_reason: HaltReason | null; remaining: number[]
  must_have_state: CheckState
  /** Flips no pass's own writing accounted for. A run carrying any of these did not converge. */
  phantom_closes?: number[]
}

export interface Outcome {
  converged: boolean
  openMustHaves: number
  passes: number
  haltReason: HaltReason | null
  /** The sentence a user reads. It says what happened, not how it felt. */
  summary: string
}

/**
 * What this run may claim.
 *
 * A halted loop with must-haves open is `fail`, and the summary says so in words. This function
 * exists so that no caller has to remember to write that sentence correctly — the one place that
 * decides whether "converged" appears is here, and it cannot say it while anything is open.
 */
export function reportedOutcome(rows: LoopRowLike[]): Outcome {
  const last = rows.length ? rows[rows.length - 1] : null
  const open = last ? last.remaining.length : 0
  const reason = last ? last.halt_reason : null
  // Belt and braces with decidePass, on purpose: this is the one place the WORD is produced, and a
  // row that says 'converged' while any pass left an unattributed flip is a row that should never
  // have been written. Recomputing here means a bad row cannot talk this function into the sentence.
  const phantom = rows.reduce((n, r) => n + ((r.phantom_closes || []).length), 0)
  const converged = !!last && reason === 'converged' && open === 0
    && last.must_have_state === 'pass' && phantom === 0
  return {
    converged,
    openMustHaves: open,
    passes: rows.length,
    haltReason: reason,
    summary: converged
      ? `Converged after ${rows.length} pass(es): every must-have requirement is covered and the run's coverage check passed.`
      : open === 0 && phantom > 0
        ? `Halted after ${rows.length} pass(es): every must-have now reads as covered, but ${phantom} left the open list `
          + `with no edit from this run carrying the evidence — so this run cannot claim to have closed them. `
          + `The gate stays as the checks left it.`
        : `Halted after ${rows.length} pass(es) (${reason || 'unknown'}) with ${open} must-have requirement(s) still open. The gate stays as the checks left it; nothing was closed by stopping.`,
  }
}

// ---------------------------------------------------------------------------------------------
// P3.2 — escalations
// ---------------------------------------------------------------------------------------------

export interface EscalationInput {
  requirement: { seq: number; verbatim: string | null; item_text: string; kind: string }
  artifactType: string
  pass: number
  haltReason: HaltReason
  /** The fields the loop was allowed to rewrite while trying. */
  searched: string[]
  /** Fields it was NOT allowed to touch, and what they were protecting. */
  withheld: Array<{ field: string; protects: number[] }>
  profileSearched: boolean
}

export interface EscalationText { title: string; detail: string; ask: string }

/**
 * The escalation the loop owes the user when it gives up.
 *
 * `detail` must state WHAT WAS SEARCHED and WHY IT COULD NOT BE CLOSED — an escalation that only
 * says "could not cover this" asks the user to redo the search the loop already did. So it names
 * the fields that were rewritten, the fields that were withheld and what they were protecting, and
 * whether the standing profile was mined.
 */
export function escalationFor(input: EscalationInput): EscalationText {
  const r = input.requirement
  const quoted = r.verbatim ? `"${r.verbatim}"` : r.item_text
  const searched = input.searched.length ? input.searched.join(', ') : 'no field (the scope was empty)'
  const withheld = input.withheld.length
    ? input.withheld.map(w => `${w.field} (sole evidence for #${w.protects.join(', #')})`).join('; ')
    : 'none'
  const why: Record<string, string> = {
    no_progress: `pass ${input.pass} rewrote those fields and the coverage check still did not find this requirement evidenced`,
    max_passes: `the pass ceiling was reached before this requirement could be evidenced`,
    cost_ceiling: `the cost ceiling was reached before this requirement could be evidenced`,
    token_ceiling: `the token ceiling was reached before this requirement could be evidenced`,
    time_budget: `the wall-clock guard stopped the run before this requirement could be evidenced`,
    nothing_reachable: `every rewritable field was the only evidence for a requirement that is already covered, so there was no edit available that did not cost evidence already held`,
    no_coverage_evidence: `coverage could not be judged for this artifact, so the loop had nothing honest to optimise against`,
    error: `the pass failed with an error before this requirement could be evidenced`,
    unattributed_coverage: `it left the open list without any edit from this run carrying the evidence, so this run cannot claim to have closed it - the document may have been covering it already`,
    ungrounded: `this opportunity has no job posting on file, so there was nothing to remediate against - a package built from our own metadata about the job cannot evidence the employer's requirements`,
    converged: `recorded for completeness — the run converged, so this should not have been raised`,
  }
  return {
    title: `${r.kind === 'must_have' ? 'Must-have' : 'Requirement'} #${r.seq} not evidenced in the ${input.artifactType}`,
    detail: [
      `The posting asks: ${quoted}`,
      `Searched: ${input.profileSearched ? 'the standing profile (MasterContext) and ' : ''}the following ${input.artifactType} merge fields — ${searched}.`,
      `Withheld from rewriting: ${withheld}.`,
      `Why it is still open: ${why[input.haltReason] || input.haltReason}.`,
      'No content was invented to close it. The score reflects the gap.',
    ].join(' '),
    ask: 'Supply evidence you have for this requirement (a project, a metric, a role) and the loop will re-run against it — or accept the gap, and the score will keep reporting it honestly.',
  }
}

// P2.1 — the deterministic checks engine. No model, no tokens, same answer every time.
//
// These port the rules that today live as prose INSIDE the generation prompt, where they are
// requests rather than guarantees: the prompt says "hard requirement" and the model complies or
// does not, and nothing downstream ever notices. Here they are measured after the fact.
//
// THRESHOLDS ARE SOURCED FROM THE LIVE PROMPT, NOT THE BACKLOG. Read from the deployed
// `resume_user` prompt (api-test run 32311693658), which is the system that actually produced every
// artifact in the database:
//   skills      <= 30 chars, "including spaces"   (the backlog says 24 — it is wrong)
//   skills      20-22 total, "evenly split", 10-11 each
//   relevant    at most ONE item over 20 chars PER LIST (a per-list allowance, not a flat cap)
//   expertise   exactly 5 words per phrase, 6 phrases
//   aboutMe1    45-48 words · aboutMe2 75-80 · execProfile 50-55 · cover 250-400
//   coreAccomplishments — the prompt CONTRADICTS ITSELF: its heading says 98-100 words, its
//                         requirement list says "98-125 words (hard requirement)". The wider bound
//                         wins because it is the one labelled hard; the contradiction is recorded
//                         here rather than silently resolved.
// Every one of these is a seeded DEFAULT, overridable per owner — see `CheckThresholds`. Nothing
// here may become a permanent constant.
import { splitItems, itemTokens, omitEntries, onOmitList } from './swaps'
import { mergeFieldsFor } from './insertions'
import { normalizePostingText } from './jdText'
import { checkAgainstFacts, OwnerFact } from './ownerFacts'
import { scanEcho, scanWording, WORDING_RUN_TOKENS } from './figureEcho'
import {
  EvidenceInput, NO_EVIDENCE_NOTE, EVIDENCE_THRESHOLD, EVIDENCE_MAX_SENTENCES,
  EVIDENCE_BULLET_RUN,
  RESOLVE_MIN_TOKENS as EVIDENCE_MIN_TOKENS,
} from './evidence'

export type CheckState = 'pass' | 'warn' | 'fail' | 'not_applicable'
export type CheckEngine = 'deterministic' | 'reviewer'

export interface CheckResult {
  check_key: string
  engine: CheckEngine
  state: CheckState
  observed: string
  expected: string
  /** The specific offending items. NEVER a count — a count cannot be acted on. */
  offenders: string[]
  /**
   * The requirement ids this check actually reached a verdict ON, when that set is narrower than
   * the population a reader would assume. Published by the check that owns the predicate so nobody
   * downstream has to re-derive it — `appReviewer` counted every must-have as judged, including the
   * eligibility and fact-owned rows the coverage check had EXCLUDED, and scored those as agreeing
   * or disagreeing with the reviewer instead of `not_comparable`. Recomputing `coverable` at the
   * consumer would be a second copy of this file's predicate: R4, one source per number.
   */
  judged?: string[]
}

export interface CheckThresholds {
  /** D4: how many consecutive identical words count as wording kept from the posting. */
  wordingRunTokens: number
  skillMaxChars: number
  skillsTotalMin: number
  skillsTotalMax: number
  skillsSplitTolerance: number
  relevantMaxChars: number
  relevantOverLimitAllowance: number
  expertiseWords: number
  aboutMe1Words: [number, number]
  aboutMe2Words: [number, number]
  execProfileWords: [number, number]
  coreAccomplishmentsWords: [number, number]
  coverWords: [number, number]
  /**
   * P8.3 — how much of a requirement a profile excerpt must account for before it evidences it,
   * and how short an excerpt may be. They decide whether a candidate's requirement counts as
   * covered, which makes them exactly the kind of value this interface exists to keep out of the
   * code: the same seeded-default-then-owner-overridable rule as every threshold above it.
   */
  evidenceThreshold: number
  evidenceMinTokens: number
  /**
   * P8.3 / option (c) — the two knobs the purpose-made matcher adds.
   *
   * `evidenceMaxSentences`: how many CONTIGUOUS sentences one excerpt may span (clamped 1..3).
   * `evidenceBulletRun`: how many BULLET items one excerpt may span (clamped 1..12). It changes how
   * much surrounding text a quote carries, never whether the match is found — the whole line stays
   * a candidate at every setting.
   *
   * Generic-vocabulary detection (M10) is DELIBERATELY not here: see
   * `requirementSupport.GENERIC_RECORDS` for why it cannot be a single safe knob.
   */
  evidenceMaxSentences: number
  evidenceBulletRun: number
  /**
   * THE ESCALATION TIER'S OWN SETTINGS, and the toggle is different in kind from every threshold
   * above it: those tune a rule, this one SPENDS MONEY and admits model judgement into the evidence
   * spine. So its unconfigured state is the SAFE one rather than the seeded one — see
   * `resolveOptionsFrom`, where it is the single field that does not fall through to a default.
   *
   * `evidenceEscalateMax` caps calls per run. A posting with 38 unevidenced requirements would
   * otherwise make 38 calls the first time the owner opened it.
   */
  evidenceEscalate: boolean
  evidenceEscalateMax: number
}

/** Seeded first values, taken from the live prompt. The owner can change every one of them. */
export const DEFAULT_THRESHOLDS: CheckThresholds = {
  wordingRunTokens: WORDING_RUN_TOKENS,
  skillMaxChars: 30,
  skillsTotalMin: 20,
  skillsTotalMax: 22,
  skillsSplitTolerance: 1,
  relevantMaxChars: 20,
  relevantOverLimitAllowance: 1,
  expertiseWords: 5,
  aboutMe1Words: [45, 48],
  aboutMe2Words: [75, 80],
  execProfileWords: [50, 55],
  coreAccomplishmentsWords: [98, 125],
  coverWords: [250, 400],
  evidenceThreshold: EVIDENCE_THRESHOLD,
  evidenceMinTokens: EVIDENCE_MIN_TOKENS,
  evidenceMaxSentences: EVIDENCE_MAX_SENTENCES,
  evidenceBulletRun: EVIDENCE_BULLET_RUN,
  evidenceEscalate: false,
  evidenceEscalateMax: 12,
}

// Phrases and punctuation that read as machine-written. Kept as data so they can move to the
// settings store; the em-dash scan is separate because it is punctuation, not vocabulary.
export const AI_TELLS = [
  'delve', 'tapestry', 'testament to', 'in the realm of', 'it is worth noting',
  'navigating the', 'leverage synergies', 'robust and scalable', 'game-changer',
  'cutting-edge', 'seamlessly integrate', 'at the forefront of', 'ever-evolving',
  'landscape of', 'unlock the potential', 'holistic approach', 'paradigm shift',
  'meticulous', 'underscore', 'pivotal role', 'multifaceted',
]

const words = (s: string) => String(s || '').trim().split(/\s+/).filter(Boolean).length
const WORDING_EXPECT = 'no generated field repeats a run of the posting\'s wording'

const ok = (key: string, observed: string, expected: string): CheckResult =>
  ({ check_key: key, engine: 'deterministic', state: 'pass', observed, expected, offenders: [] })
const bad = (key: string, observed: string, expected: string, offenders: string[], state: CheckState = 'fail'): CheckResult =>
  ({ check_key: key, engine: 'deterministic', state, observed, expected, offenders })
const na = (key: string, why: string, expected: string): CheckResult =>
  ({ check_key: key, engine: 'deterministic', state: 'not_applicable', observed: why, expected, offenders: [] })

export interface CheckInput {
  type: string                       // artifact type; decides which merge fields apply
  pkg: Record<string, any>
  company?: string                   // the opportunity's company, for the stale-name check
  omitList?: string
  /**
   * The candidate's own standing profile. Now LOAD-BEARING rather than decorative: R3 uses it to
   * tell a figure taken from the posting from one the candidate genuinely owns. Absent, the figure
   * check reports not_applicable — it will not guess.
   */
  profileText?: string
  /** The EMPLOYER'S OWN text (resolvePostingSource), never `groundingText`. See the R3 check. */
  postingText?: string
  requirements?: Array<{ seq: number; verbatim: string | null; item_text: string; kind: string }>
  swaps?: Array<{ action: string; driver: string; to_label: string | null; from_label: string | null }>
  /** The owner's confirmed facts. A requirement a FACT settles is not a document-coverage question. */
  facts?: OwnerFact[]
  /**
   * P8.3 / R2 / conflict-register C6 — the resolved evidence rows, which are now what decides
   * coverage. Absent (or with `profileReadable: false`) every coverage check reports
   * `not_applicable`: an unevidenced requirement and an unreadable profile are different
   * statements, and reporting the second as the first is a measurement nobody made.
   */
  evidence?: EvidenceInput
  thresholds?: Partial<CheckThresholds>
}

/**
 * Preconditions that NO GENERATED MERGE FIELD can carry — P1.5 template reach.
 *
 * The requirement is real and stays raw: "Reside in the East Coast of the United States" is
 * extracted, stored as a must_have, quoted from the posting, and shown. Nothing filters it. What is
 * measured here is narrower — whether any field the pipeline can WRITE could evidence it.
 *
 * It cannot. The resume's seven merge fields are ResumeSummary, SkillsBullets1/2, ExpertiseBullets
 * and RelevantBullets1-3 (TEMPLATE_META); none carries location, citizenship or clearance. A resume
 * absolutely COULD state "Boston, MA" — but only in static template text the pipeline never
 * touches. So a coverage failure here is not the document falling short of the requirement, it is
 * the pipeline having no slot for it, and reporting it as uncovered coverage would make the gate
 * permanently red on every posting carrying such a clause. An always-red gate is one people learn
 * to ignore.
 *
 * Reported as not_applicable FOR COVERAGE, with every one named, so the human confirms them against
 * the static template — which is exactly the decision P1.5 asks for per template: edit the static
 * bullets once, or add a merge field.
 *
 * Deliberately narrow and marker-driven: each pattern is an explicit phrase employers use for a
 * legal or logistical precondition. This is not a general "is this hard to match" heuristic.
 */
export const ELIGIBILITY_RE = /\b(reside|residing|residency|relocat\w*|must live|based in|citizen|citizenship|green card|permanent resident|work authoriz\w*|authorized to work|visa|sponsorship|security clearance|clearance|itar|willing to travel|able to travel|travel \d+%)\b/i

/** Share of a requirement's content words that must appear before it counts as covered. */
export const COVERAGE_THRESHOLD = 0.7
/** Below this many content words a requirement carries too little signal to judge either way. */
export const MIN_JUDGEABLE_TOKENS = 3

/**
 * Does `covText` — ALREADY normalized and lower-cased — cover this requirement?
 *
 * Exported because P3's remediation loop must decide "did the text this pass actually WROTE close
 * this requirement", and the only honest way to answer that is with the SAME predicate that decides
 * `must_have_coverage` and therefore the gate. A second implementation drifts, and the day it drifts
 * the loop claims a close the gate does not recognise.
 */
export function coversIn(covText: string, r: { verbatim: string | null; item_text: string }): boolean {
  const toks = itemTokens(r.verbatim || r.item_text)
  if (toks.length < MIN_JUDGEABLE_TOKENS) return false
  const hit = toks.filter(tk => covText.includes(tk))
  if (hit.length / toks.length < COVERAGE_THRESHOLD) return false
  const distinctive = toks.filter(tk => tk.length >= 6)
  return distinctive.length === 0 || distinctive.some(tk => covText.includes(tk))
}

/** Same predicate, taking RAW text. Normalises exactly as `runChecks` does before comparing. */
export function coversText(text: string, r: { verbatim: string | null; item_text: string }): boolean {
  return coversIn(normalizePostingText(String(text || '')).toLowerCase(), r)
}

const SKILL_FIELDS = ['SkillsBullets1', 'SkillsBullets2']
const RELEVANT_FIELDS = ['RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3']

/**
 * Run every deterministic check for one artifact.
 *
 * Checks that depend on rows which may not exist return `not_applicable`, NEVER `pass`. A coverage
 * check that passes because there was nothing to check against is how a gate goes green on an
 * artifact nobody verified — it is the single most dangerous state this engine could produce.
 */
export function runChecks(input: CheckInput): CheckResult[] {
  const t: CheckThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) }
  const pkg = input.pkg || {}
  const fields = mergeFieldsFor(input.type)
  const has = (f: string) => fields.includes(f)
  const out: CheckResult[] = []

  const skills = SKILL_FIELDS.filter(has).flatMap(f => splitItems(pkg[f]))
  const relevantByList = RELEVANT_FIELDS.filter(has).map(f => ({ f, items: splitItems(pkg[f]) }))

  // --- length rules -----------------------------------------------------------------------
  if (SKILL_FIELDS.some(has)) {
    const over = skills.filter(s => s.length > t.skillMaxChars)
    out.push(over.length
      ? bad('skill_char_limit', `${over.length} of ${skills.length} skills exceed ${t.skillMaxChars} chars`,
            `every skill <= ${t.skillMaxChars} characters including spaces`,
            over.map(s => `${s} (${s.length})`))
      : ok('skill_char_limit', `${skills.length} skills, longest ${Math.max(0, ...skills.map(s => s.length))}`,
           `every skill <= ${t.skillMaxChars} characters including spaces`))

    const n1 = splitItems(pkg.SkillsBullets1).length, n2 = splitItems(pkg.SkillsBullets2).length
    const total = n1 + n2
    const offenders: string[] = []
    if (total < t.skillsTotalMin || total > t.skillsTotalMax) offenders.push(`total ${total}`)
    if (Math.abs(n1 - n2) > t.skillsSplitTolerance) offenders.push(`split ${n1}/${n2}`)
    out.push(offenders.length
      ? bad('skill_list_count', `${total} skills split ${n1}/${n2}`,
            `${t.skillsTotalMin}-${t.skillsTotalMax} total, evenly split within ${t.skillsSplitTolerance}`, offenders, 'warn')
      : ok('skill_list_count', `${total} skills split ${n1}/${n2}`,
           `${t.skillsTotalMin}-${t.skillsTotalMax} total, evenly split within ${t.skillsSplitTolerance}`))
  }

  if (relevantByList.length) {
    // The prompt's rule is an ALLOWANCE, not a cap: at most one item per list may exceed the limit.
    const offenders: string[] = []
    let worst = 0
    for (const { f, items } of relevantByList) {
      const over = items.filter(i => i.length > t.relevantMaxChars)
      worst = Math.max(worst, over.length)
      if (over.length > t.relevantOverLimitAllowance) {
        offenders.push(...over.map(i => `${f}: ${i} (${i.length})`))
      }
    }
    out.push(offenders.length
      ? bad('relevant_char_limit', `a list has ${worst} items over ${t.relevantMaxChars} chars`,
            `at most ${t.relevantOverLimitAllowance} item per list over ${t.relevantMaxChars} chars`, offenders)
      : ok('relevant_char_limit', `at most ${worst} item(s) over ${t.relevantMaxChars} per list`,
           `at most ${t.relevantOverLimitAllowance} item per list over ${t.relevantMaxChars} chars`))
  }

  // --- cross-list redundancy --------------------------------------------------------------
  const listed = [...SKILL_FIELDS, ...RELEVANT_FIELDS].filter(has)
    .flatMap(f => splitItems(pkg[f]).map(i => ({ f, i, n: i.toLowerCase().trim() })))
  if (listed.length) {
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const x of listed) {
      const prev = seen.get(x.n)
      if (prev && prev !== x.f) dupes.push(`${x.i} (${prev} + ${x.f})`)
      else if (!prev) seen.set(x.n, x.f)
    }
    out.push(dupes.length
      ? bad('cross_list_redundancy', `${dupes.length} item(s) appear in more than one list`,
            'no item appears in two lists', dupes)
      : ok('cross_list_redundancy', `${listed.length} items, none repeated across lists`, 'no item appears in two lists'))
  }

  // --- omission list ----------------------------------------------------------------------
  // Same matcher the swap engine uses, so a drop recorded as rule-driven and an item flagged here
  // can never disagree about what "on the omission list" means.
  const omitted = omitEntries(input.omitList || '')
  if (omitted.length && listed.length) {
    const hits = listed.filter(x => onOmitList(x.i, omitted))
    out.push(hits.length
      ? bad('omission_list', `${hits.length} item(s) the owner asked never to use`,
            'no item from MasterContext.itemsToOmit appears', hits.map(x => `${x.f}: ${x.i}`))
      : ok('omission_list', `none of ${omitted.length} omitted items present`, 'no item from MasterContext.itemsToOmit appears'))
  } else if (listed.length) {
    out.push(na('omission_list', 'no omission list configured for this owner', 'no omitted item appears'))
  }

  // --- text hygiene, across every field this artifact actually has -------------------------
  const present = fields.filter(f => pkg[f] != null && String(pkg[f]).trim() !== '')
  const allText = present.map(f => String(pkg[f])).join('\n')

  // --- R3: the posting's figures are the employer's, not the candidate's ------------------
  //
  // "Managed a $18M portfolio across three business units" is the posting's own sentence with the
  // candidate's name on it. Nothing about length, tone or keyword coverage catches it, and to a
  // hiring manager reading their own ad back it is the most damaging line in the document.
  //
  // Three deliberate constraints, each protecting against a way this check could become noise:
  //
  //  1. The posting text MUST be the employer's own (`resolvePostingSource`), never `groundingText`
  //     — which falls back to `jd_summary`, i.e. MODEL OUTPUT. Accusing a candidate of echoing a
  //     figure that only ever existed in our own summary is an accusation built on a fabrication.
  //  2. No profile text, or no posting text, is `not_applicable`. Without the profile there is no
  //     way to tell theft from a true, evidenced achievement, and a check that fires anyway would
  //     accuse people of echoing their own numbers. Absent evidence is not_applicable, never pass —
  //     and never a fail either.
  //  3. `warn`, not `fail` (C5, and the P8.1 correction path supersedes it). A figure present in
  //     BOTH documents can be legitimate, and the offender list is the point: it names the field
  //     and the exact string so a human decides in one look. A gate that reddens on a shared number
  //     is a gate people learn to click past.
  //  4. It scans the SWAP LABELS too, not just the rendered fields (D5). `runChecks` sees `pkg`,
  //     so a swap RECORDED but not yet written into a bullet was text the user would read that
  //     nothing had checked - "Org Scaling 60+" or "P&L $18M" sitting in `swap_decision.to_label`
  //     passed R3 simply because the rendering had not caught up yet. Only labels NOT already in
  //     the rendered text are added: a label that HAS been rendered is covered by the field scan,
  //     and reporting it twice under two names is the cry-wolf tax on a check that names people.
  const renderedAll = present.map(f => String(pkg[f])).join('\n')
  const swapLabels = [...new Set((input.swaps || [])
    .map(sw => String(sw.to_label ?? ''))
    .filter(l => l.trim() !== '' && !renderedAll.includes(l)))]
  const echoUnits = [
    ...present.map(f => ({ f, text: String(pkg[f]) })),
    ...swapLabels.map(l => ({ f: `swap: ${l}`, text: l })),
  ]
  if (echoUnits.length) {
    const scans = echoUnits.map(({ f, text }) => ({ f, r: scanEcho(text, input.postingText || '', input.profileText || '') }))
    // The SCAN decides whether it could look, not this function. Re-deriving it here from the raw
    // strings tested a different thing: `jd_real` is HTML, so a markup-only posting (`<p></p>`) is a
    // non-empty raw string and an empty posting — and this check reported `pass` on a document it
    // had never compared to anything, then `gateFor` turned that into a green gate. The profile
    // half was worse: a markup-only profile produced false ACCUSATIONS, naming figures as stolen
    // because the thing that would have exonerated them read as absent.
    const blocked = scans.find(x => x.r.notApplicable)
    if (blocked) {
      out.push(na('posting_figure_echo', blocked.r.reason || 'nothing to compare against',
                   'no generated field states a figure that appears only in the posting'))
    } else {
      const hits = scans.flatMap(({ f, r }) => r.echoes.map(e => `${f}: ${e.figure.raw}`))
      // CITE, do not count. C5 says a shared figure is kept AND cited, and R2 defines evidenced as
      // "a verbatim excerpt from the stored profile can be shown next to it". "2 figure(s) kept"
      // told the owner nothing they could check — which figures, and on what evidence, was thrown
      // away with `profileRaw`.
      const kept = scans.flatMap(({ f, r }) => r.shared.map(e => `${f}: ${e.figure.raw} (your profile states ${e.profileRaw})`))
      const keptNote = kept.length ? `; kept as yours — ${kept.join(', ')}` : ''
      out.push(hits.length
        ? bad('posting_figure_echo', `${hits.length} figure(s) taken from the posting${keptNote}`,
              "no generated field states a figure that appears only in the posting", hits, 'warn')
        : ok('posting_figure_echo', `no posting-only figures across ${present.length} field(s)${swapLabels.length ? ` and ${swapLabels.length} unrendered swap label(s)` : ''}${keptNote}`,
             "no generated field states a figure that appears only in the posting"))
    }
  }

  // --- D4 / R3: WORDING kept from the posting — a user judgement call, listed separately -------
  //
  // Deliberately its own check, not more offenders on `posting_figure_echo`. The spec separates
  // them because the REMEDY is different: a figure the profile cannot evidence is corrected
  // automatically (R1/P8.1), and a phrase is never touched — only the writer can say whether it is
  // the employer's sentence, the industry's standard term, or their own words. Folding the two
  // together would put prose into the auto-correct path, which is the one thing R3 must not do.
  //
  // `warn`, and R1 permits it: "only what genuinely cannot be settled without the user appears as
  // an open item" — a judgement call is exactly that. It cites the passage verbatim so the decision
  // takes one look. See `scanWording` for why the run is long: this list is shown to a person about
  // their own writing, so it errs toward silence.
  if (echoUnits.length) {
    const wScans = echoUnits.map(({ f, text }) => ({ f, r: scanWording(text, input.postingText || '', input.profileText || '', t.wordingRunTokens) }))
    const wBlocked = wScans.find(x => x.r.notApplicable)
    if (wBlocked) {
      out.push(na('posting_wording_kept', wBlocked.r.reason || 'nothing to compare against', WORDING_EXPECT))
    } else {
      const wHits = wScans.flatMap(({ f, r }) => r.kept.map(k => `${f}: "${k.phrase}"`))
      out.push(wHits.length
        ? bad('posting_wording_kept', `${wHits.length} passage(s) read as the posting's wording — your call`,
              WORDING_EXPECT, wHits, 'warn')
        : ok('posting_wording_kept', `no passage of ${t.wordingRunTokens}+ words matches the posting`, WORDING_EXPECT))
    }
  }

  const tells = AI_TELLS.filter(p => allText.toLowerCase().includes(p))
  const emDashes = (allText.match(/—/g) || []).length
  const tellOffenders = [...tells, ...(emDashes ? [`em-dash x${emDashes}`] : [])]
  out.push(tellOffenders.length
    ? bad('ai_tells', `${tells.length} flagged phrase(s), ${emDashes} em-dash(es)`,
          'no machine-tell vocabulary or em-dashes', tellOffenders, 'warn')
    : ok('ai_tells', 'none found', 'no machine-tell vocabulary or em-dashes'))

  const residue: string[] = []
  for (const f of present) {
    const v = String(pkg[f])
    if (/```/.test(v)) residue.push(`${f}: code fence`)
    if (/\{\{[^}]*\}\}/.test(v)) residue.push(`${f}: unresolved {{token}}`)
    if (/<\/?(p|div|span|ul|li|table|tr|td|br|strong|em)\b[^>]*>/i.test(v)) residue.push(`${f}: html markup`)
    if (/&(amp|lt|gt|nbsp|quot|#\d+);/i.test(v)) residue.push(`${f}: html entity`)
  }
  out.push(residue.length
    ? bad('markup_residue', `${residue.length} field(s) carry markup or template residue`,
          'plain text only, no fences, tokens, tags or entities', residue)
    : ok('markup_residue', `${present.length} field(s) clean`, 'plain text only, no fences, tokens, tags or entities'))

  const ws: string[] = []
  for (const f of present) {
    const v = String(pkg[f])
    if (/ {2,}/.test(v)) ws.push(`${f}: double space`)
    if (/\t/.test(v)) ws.push(`${f}: tab`)
    if (v !== v.trim()) ws.push(`${f}: leading/trailing whitespace`)
    if (/\n{3,}/.test(v)) ws.push(`${f}: blank-line run`)
  }
  out.push(ws.length
    ? bad('whitespace', `${ws.length} whitespace defect(s)`, 'no double spaces, tabs, or stray edges', ws, 'warn')
    : ok('whitespace', 'clean', 'no double spaces, tabs, or stray edges'))

  const empty = fields.filter(f => pkg[f] == null || String(pkg[f]).trim() === '')
  out.push(empty.length
    ? bad('empty_merge_fields', `${empty.length} of ${fields.length} merge fields empty`,
          'every merge field the template exposes is filled', empty)
    : ok('empty_merge_fields', `all ${fields.length} merge fields filled`, 'every merge field the template exposes is filled'))

  // --- word counts, only for fields this artifact actually has -----------------------------
  const WORD_RULES: Array<[string, [number, number]]> = [
    ['@AboutMe1_50words', t.aboutMe1Words],
    ['@AboutMe2_60words', t.aboutMe2Words],
    ['@ExecutiveProfile_55words', t.execProfileWords],
    ['@CoreAccomplishments_5blts_180words', t.coreAccomplishmentsWords],
    ['@CoverLetterBody', t.coverWords],
  ]
  const applicable = WORD_RULES.filter(([f]) => has(f))
  if (applicable.length) {
    const offenders: string[] = []
    for (const [f, [lo, hi]] of applicable) {
      if (pkg[f] == null || String(pkg[f]).trim() === '') continue   // empty_merge_fields owns this
      const w = words(pkg[f])
      if (w < lo || w > hi) offenders.push(`${f}: ${w} words (want ${lo}-${hi})`)
    }
    out.push(offenders.length
      ? bad('word_counts', `${offenders.length} field(s) outside their word band`,
            applicable.map(([f, [lo, hi]]) => `${f} ${lo}-${hi}`).join(', '), offenders)
      : ok('word_counts', `${applicable.length} field(s) within band`,
           applicable.map(([f, [lo, hi]]) => `${f} ${lo}-${hi}`).join(', ')))
  }

  if (has('ExpertiseBullets') && splitItems(pkg.ExpertiseBullets).length) {
    const wrong = splitItems(pkg.ExpertiseBullets).filter(p => words(p) !== t.expertiseWords)
    out.push(wrong.length
      ? bad('expertise_phrase_length', `${wrong.length} phrase(s) are not ${t.expertiseWords} words`,
            `every expertise phrase is exactly ${t.expertiseWords} words`, wrong.map(p => `${p} (${words(p)}w)`), 'warn')
      : ok('expertise_phrase_length', `all phrases ${t.expertiseWords} words`, `every expertise phrase is exactly ${t.expertiseWords} words`))
  }

  // --- the stale company name -------------------------------------------------------------
  // This catches the real defect the sample cover letter carried: a previous employer's name left
  // in the body. It can only be checked when we know which company this packet targets.
  if (input.company && present.length) {
    const target = String(input.company).trim()
    if (has('@Company')) {
      const named = String(pkg['@Company'] || '').trim()
      out.push(named && named.toLowerCase() === target.toLowerCase()
        ? ok('company_named', `@Company = ${named}`, `@Company matches the opportunity (${target})`)
        : bad('company_named', `@Company = ${named || '(empty)'}`, `@Company matches the opportunity (${target})`,
              [`expected ${target}, found ${named || '(empty)'}`]))
    }
    if (has('@CoverLetterBody') && String(pkg['@CoverLetterBody'] || '').trim()) {
      const body = String(pkg['@CoverLetterBody'])
      out.push(body.toLowerCase().includes(target.toLowerCase())
        ? ok('company_in_body', `letter names ${target}`, `the cover letter names ${target}`)
        : bad('company_in_body', `letter does not name ${target}`, `the cover letter names ${target}`,
              [`"${target}" absent from @CoverLetterBody`]))
    }
  }

  // --- row-dependent checks. NEVER `pass` when the rows are missing. ------------------------
  const reqs = input.requirements || []
  const mustHaves = reqs.filter(r => r.kind === 'must_have')
  const covText = normalizePostingText(allText).toLowerCase()
  /**
   * Does the artifact cover this requirement?
   *
   * This decides `must_have_coverage`, which decides the GATE, so it is an accusation-grade test and
   * errs toward "not covered". The first version accepted half the requirement's content words
   * appearing ANYWHERE in the document, which on live Trinnex data marked a garbage requirement
   * ("digital water technology). Role: Director of Digital Technology Operations") as covered —
   * because a resume for that role naturally contains those words. That turned a gate green on text
   * that was never a requirement.
   *
   * Three tightenings, all of which push toward surfacing rather than silently passing:
   *  - COVERAGE_THRESHOLD is 0.7, not 0.5.
   *  - a requirement with fewer than MIN_JUDGEABLE_TOKENS content words cannot be judged, and an
   *    unjudgeable requirement is reported as uncovered so a human sees it.
   *  - at least one DISTINCTIVE token (>= 6 chars) must appear when the requirement has any. Common
   *    short words carry almost no evidence, and a requirement made only of them is exactly the
   *    fragment case above.
   */
  const covers = (r: { verbatim: string | null; item_text: string }) => coversIn(covText, r)

  const COVERAGE_EXPECT = 'every must-have requirement is evidenced by a verbatim excerpt from your profile'
  const RESP_EXPECT = 'every responsibility is evidenced by a verbatim excerpt from your profile'
  const PLACED_EXPECT = 'every requirement your profile evidences is actually stated in this document'

  if (!reqs.length) {
    // AC 2.1.9 — the safety rule. A coverage check with nothing to check against is unknown, not OK.
    out.push(na('must_have_coverage', 'no requirement rows for this opportunity', COVERAGE_EXPECT))
    out.push(na('responsibilities_addressed', 'no requirement rows for this opportunity', RESP_EXPECT))
    out.push(na('evidence_placed', 'no requirement rows for this opportunity', PLACED_EXPECT))
  } else {
    // A requirement the owner's FACTS settle is not a document-coverage question at all. "10+ years"
    // is answered by the profile, not by whether the resume happens to repeat the number — measured:
    // 511 of 7,559 requirement rows ask for years and 466 for a degree, 13% of the corpus. Facts are
    // consulted BEFORE coverage so those rows stop being judged by token overlap.
    const facts = input.facts || []
    const factVerdicts = mustHaves
      .map(r => ({ r, v: facts.length ? checkAgainstFacts(r.verbatim || r.item_text, facts) : null }))
      .filter(x => x.v !== null) as Array<{ r: typeof mustHaves[0]; v: NonNullable<ReturnType<typeof checkAgainstFacts>> }>

    const settled = factVerdicts.filter(x => x.v.verdict === 'satisfied')
    const shortfalls = factVerdicts.filter(x => x.v.verdict === 'not_satisfied')
    const needsAnswer = factVerdicts.filter(x => x.v.verdict === 'unknown')

    if (factVerdicts.length) {
      out.push(settled.length
        ? ok('facts_settled', `${settled.length} requirement(s) answered from your profile`,
             'requirements about you are answered by your facts, not by document wording')
        : na('facts_settled', 'no requirement was settled by a recorded fact',
             'requirements about you are answered by your facts, not by document wording'))

      // A shortfall is a FIT problem, not a document defect — rewriting the resume cannot create
      // years you do not have. It warns rather than fails, and names the arithmetic.
      if (shortfalls.length) {
        out.push(bad('fact_shortfall', `${shortfalls.length} requirement(s) your profile does not meet`,
          'the posting asks for more than your recorded facts',
          shortfalls.map(x => `#${x.r.seq} ${(x.r.verbatim || x.r.item_text).slice(0, 60)} — ${x.v.detail}`), 'warn'))
      }
      if (needsAnswer.length) {
        out.push(na('facts_needed', `${needsAnswer.length} requirement(s) need a fact you have not recorded or confirmed`,
          'every requirement about you resolves to a confirmed fact'))
        const last = out[out.length - 1]
        last.offenders = needsAnswer.map(x => `#${x.r.seq} ${(x.r.verbatim || x.r.item_text).slice(0, 60)} — ${x.v.detail}`)
      }
    }

    // Split preconditions out BEFORE judging coverage — see ELIGIBILITY_RE — and drop anything the
    // facts already resolved either way. What remains is genuinely a question about the DOCUMENT.
    // ANY fact verdict means the fact system owns this requirement — including `unknown`, whose
    // resolution is "confirm the fact", not "edit the static template". Listing it under both
    // facts_needed and template_reach reports one requirement twice and gives the reader two jobs
    // where there is one. Only rows no fact touches fall through to the template-reach question.
    const ownedByFacts = new Set(factVerdicts.map(x => x.r.seq))
    const resolvedByFact = new Set(factVerdicts.filter(x => x.v.verdict !== 'unknown').map(x => x.r.seq))
    const eligibility = mustHaves.filter(r => ELIGIBILITY_RE.test(r.verbatim || r.item_text) && !ownedByFacts.has(r.seq))
    const coverable = mustHaves.filter(r => !eligibility.includes(r) && !resolvedByFact.has(r.seq) && !ownedByFacts.has(r.seq))
    out.push(eligibility.length
      ? na('template_reach',
           `${eligibility.length} requirement(s) no generated merge field can carry — confirm against the static template`,
           'every requirement is reachable by a field the pipeline can write')
      : ok('template_reach', 'every requirement is reachable by a generated field',
           'every requirement is reachable by a field the pipeline can write'))
    // The offender list still names them, so "not scored" never means "not shown".
    const elig = out[out.length - 1]
    if (eligibility.length) elig.offenders = eligibility.map(r => `#${r.seq} ${(r.verbatim || r.item_text).slice(0, 80)}`)

    const resp = reqs.filter(r => r.kind === 'responsibility')

    /**
     * P8.3 / R2, and conflict-register C6: "coverage counts recomputed from evidence rows, not from
     * term placement."
     *
     * A requirement is covered when a VERBATIM excerpt of the candidate's stored profile can be
     * shown beside it — not when the generated document happens to repeat enough of its words. The
     * old numerator was a statement about the document, and a document can be made to contain any
     * words at all; that is precisely how a claim the profile cannot support got counted as
     * coverage. `covers()` is kept below, where it answers the different question it is actually
     * good for: of the things the profile DOES evidence, which ones reached this asset.
     */
    const ev = input.evidence
    const evidenceOf = (r: { seq: number }) => (ev && ev.bySeq ? ev.bySeq[r.seq] || null : null)
    /**
     * A MODEL chose this excerpt. THE GATE MUST NOT TREAT IT AS A RULE'S FINDING.
     *
     * This is the one place the escalation tier could have loosened the whole engine silently, and
     * the reasoning is worth stating because the row LOOKS identical: `verifyProposal` accepts a
     * proposal only if the quote is byte-exact in the record it names, so a proposed excerpt is
     * every bit as verbatim as a deterministic one, correctly attributed, with real offsets.
     *
     * But byte-exactness is not RELEVANCE. The deterministic path clears a lexical floor as well —
     * token overlap at `EVIDENCE_THRESHOLD`, a distinctive token, the conjunction and negation
     * rules — and a proposed row clears none of them, by design: it exists precisely for the cases
     * where no word is shared. Its only judge of relevance is the model, and `reasoning` is stored,
     * never verified. Counting it in the numerator would move this check's standard from "verbatim
     * AND lexically supported" to "verbatim", and nothing on any surface would say so.
     *
     * So: a proposed row is evidence to SHOW, never evidence to PASS ON. It moves a requirement out
     * of "nothing found" and into "a model found this — confirm it", which is a strictly better
     * place for the owner than a blank, and it cannot turn the gate green by itself. That is the
     * house rule at the only altitude where it decides anything: a model may PROPOSE, only an exact
     * rule may ACCUSE, and `must_have_coverage` is the accusation.
     */
    const isProposed = (r: { seq: number }) => evidenceOf(r)?.method === 'proposed'
    const ruleEvidenceOf = (r: { seq: number }) => (isProposed(r) ? null : evidenceOf(r))
    const label = (r: { seq: number; verbatim: string | null; item_text: string }) =>
      `#${r.seq} ${(r.verbatim || r.item_text).slice(0, 80)}`

    if (!ev || !ev.profileReadable) {
      // Absent evidence is not_applicable, NEVER pass — and never `fail` either. "Your profile does
      // not support this" and "we could not read your profile" are different statements, and a run
      // that could not read the profile has measured nothing.
      const why = ev
        ? 'your stored profile could not be read, so no coverage claim can be evidenced'
        : 'no evidence rows were resolved for this opportunity'
      out.push(na('must_have_coverage', why, COVERAGE_EXPECT))
      out.push(na('responsibilities_addressed', why, RESP_EXPECT))
      out.push(na('evidence_placed', why, PLACED_EXPECT))
    } else {
      // `ruleEvidenceOf`, not `evidenceOf`: a proposed row leaves the requirement in the
      // unevidenced list, where it surfaces to the owner with its excerpt attached rather than
      // being counted as settled. Erring toward surfacing is what every other tightening in this
      // check does.
      const unevidenced = coverable.filter(r => !ruleEvidenceOf(r))
      // ONE denominator on every branch, and it says in words which population it is.
      //
      // The fail branch used to divide by `mustHaves.length` while its numerator came from
      // `coverable` alone, so the requirements this engine had just declared unscoreable —
      // eligibility clauses no merge field can carry, and rows the owner's facts own — were counted
      // as COVERED. Measured on the shape the live Trinnex posting has: 4 must-haves, 3 of them
      // eligibility, 1 judged and failing, printed "3/4 must-haves covered" and scored 75, when
      // exactly one requirement was measured and it did not pass. That is a not_applicable row
      // laundered into a numerator — the same defect as a check going green on absent evidence, and
      // it inflated the one number a reviewer trusts most. Both branches now divide by `coverable`,
      // and the excluded rows are counted by name so they are visible rather than absorbed.
      const excluded: string[] = []
      // Named in the observed string rather than absorbed into it. A count that changed because a
      // model was consulted must say so on the surface a reviewer reads, or "coverage rose" is not
      // falsifiable — the reviewer cannot tell a better profile from a chattier model.
      const proposed = coverable.filter(isProposed)
      if (proposed.length) excluded.push(`${proposed.length} model-proposed, awaiting your confirmation`)
      if (eligibility.length) excluded.push(`${eligibility.length} not reachable by any generated field`)
      const factOwned = mustHaves.length - coverable.length - eligibility.length
      if (factOwned > 0) excluded.push(`${factOwned} answered from your profile facts`)
      const tail = excluded.length ? ` (${excluded.join(', ')}, not counted either way)` : ''
      // `judged` is exactly `coverable` — the rows this check formed an opinion about. The
      // not_applicable branch below deliberately carries none: nothing was judged there.
      const judgedIds = coverable.map(r => String((r as any).id))
      out.push(!coverable.length
        ? na('must_have_coverage', 'the posting produced no must-have requirements to judge', COVERAGE_EXPECT)
        : unevidenced.length
          ? { ...bad('must_have_coverage', `${coverable.length - unevidenced.length}/${coverable.length} must-haves evidenced${tail}`,
                COVERAGE_EXPECT, unevidenced.map(r => isProposed(r)
                  ? `${label(r)} — a model proposes "${(evidenceOf(r)!.quote || '').slice(0, 90)}" from ${evidenceOf(r)!.source_label}; confirm it`
                  : `${label(r)} — ${NO_EVIDENCE_NOTE}`)), judged: judgedIds }
          : { ...ok('must_have_coverage', `${coverable.length}/${coverable.length} must-haves evidenced${tail}`, COVERAGE_EXPECT), judged: judgedIds })

      const unaddressed = resp.filter(r => !evidenceOf(r))
      out.push(!resp.length
        ? na('responsibilities_addressed', 'the posting produced no responsibilities', RESP_EXPECT)
        : unaddressed.length
          ? bad('responsibilities_addressed', `${resp.length - unaddressed.length}/${resp.length} responsibilities evidenced`,
                RESP_EXPECT, unaddressed.map(r => `${label(r)} — ${NO_EVIDENCE_NOTE}`), 'warn')
          : ok('responsibilities_addressed', `${resp.length}/${resp.length} evidenced`, RESP_EXPECT))

      // The signal the old numerator carried, kept as its OWN number rather than folded back into
      // coverage (R4: two counts describing different populations are never merged). The profile can
      // support this requirement and this asset still failed to say it — which is a defect the
      // remediation loop can close, unlike a gap in the profile, which it cannot.
      const evidenced = [...coverable, ...resp].filter(r => evidenceOf(r))
      // `covers()` cannot judge a requirement with fewer than MIN_JUDGEABLE_TOKENS content words —
      // it returns false for them, which is the right answer for COVERAGE (an unjudgeable
      // requirement must surface, not pass quietly) and the WRONG one here. Measured on the live
      // Trinnex row #5, "Experience in leading technology operations": itemTokens drops the
      // stopwords and leaves two words, both of which the resume summary contains verbatim — and
      // this check called it "absent from this asset". Accusing a document of omitting something it
      // says, because the requirement was too short to measure, is absent evidence read as a
      // finding, one layer down from where the rest of this file guards against it.
      const placeable = evidenced.filter(r => itemTokens(r.verbatim || r.item_text).length >= MIN_JUDGEABLE_TOKENS)
      const unplaced = placeable.filter(r => !covers(r))
      const tooThin = evidenced.length - placeable.length
      const thinNote = tooThin ? ` (${tooThin} too short to judge either way)` : ''
      out.push(!evidenced.length
        ? na('evidence_placed', 'no requirement in this posting is evidenced by your profile yet', PLACED_EXPECT)
        : !placeable.length
          ? na('evidence_placed', `${evidenced.length} evidenced requirement(s), none long enough to judge placement`, PLACED_EXPECT)
          : unplaced.length
            ? bad('evidence_placed', `${placeable.length - unplaced.length}/${placeable.length} evidenced requirements appear in this document${thinNote}`,
                  PLACED_EXPECT, unplaced.map(r => `${label(r)} — evidenced by ${evidenceOf(r)!.source_label}, absent from this asset`), 'warn')
            : ok('evidence_placed', `${placeable.length}/${placeable.length} evidenced requirements appear in this document${thinNote}`, PLACED_EXPECT))
    }
  }

  // --- uncited changes. P2.2: always a fail, never a warn. ---------------------------------
  const swaps = input.swaps || []
  if (!swaps.length) {
    out.push(na('changes_cited', 'no swap rows recorded for this packet', 'every swapped/added item cites a requirement'))
  } else {
    const changes = swaps.filter(s => s.action === 'swapped' || s.action === 'added')
    const uncited = changes.filter(s => s.driver !== 'posting')
    out.push(!changes.length
      ? ok('changes_cited', 'nothing was swapped or added', 'every swapped/added item cites a requirement')
      : uncited.length
        ? bad('changes_cited', `${uncited.length} of ${changes.length} changes cite nothing`,
              'every swapped/added item cites a requirement',
              uncited.map(s => `${s.action}: ${s.to_label || s.from_label}`))
        : ok('changes_cited', `all ${changes.length} changes cited`, 'every swapped/added item cites a requirement'))
  }

  return out
}

/**
 * Aggregate an artifact's checks into one gate (P2.2).
 *
 * `not_applicable` never improves a gate and never worsens it — it is an absence of evidence, and
 * the UI must show it as such rather than folding it into a pass. A reviewer disagreement can only
 * degrade to `warn` (decision D6): only deterministic rows produce `fail`, so a model's opinion can
 * never block an approval on its own.
 */
export function gateFor(results: CheckResult[]): CheckState {
  // NO ROWS IS NOT A PASS. Falling through to `pass` on an empty array made this function - the one
  // that IS the gate - answer "everything passed" to the question "what was checked?" when the
  // answer was "nothing". Every other branch here already honours that rule; this one leaked
  // underneath them, because `results.length &&` on the not_applicable branch short-circuits and
  // the final `return 'pass'` catches it.
  //
  // Latent while the only caller was `evaluateArtifact`, which always feeds a non-empty runChecks
  // result (10 rows even for an empty input). P4 made it reachable: appReviewer re-aggregates from a
  // DATABASE read, and a query returning no rows would have set the gate to pass.
  if (!results.length) return 'warn'
  if (results.some(r => r.state === 'fail' && r.engine === 'deterministic')) return 'fail'
  if (results.some(r => r.state === 'warn' || (r.state === 'fail' && r.engine === 'reviewer'))) return 'warn'
  if (results.length && results.every(r => r.state === 'not_applicable')) return 'warn'
  return 'pass'
}

/** The count a UI badge must show, so the badge and the gate can never disagree (P8.5 / R4). */
export function attentionCount(results: CheckResult[]): number {
  return results.filter(r => r.state === 'fail' || r.state === 'warn').length
}

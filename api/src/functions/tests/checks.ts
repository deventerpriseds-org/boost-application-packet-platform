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
}

export interface CheckThresholds {
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
}

/** Seeded first values, taken from the live prompt. The owner can change every one of them. */
export const DEFAULT_THRESHOLDS: CheckThresholds = {
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
  profileText?: string
  requirements?: Array<{ seq: number; verbatim: string | null; item_text: string; kind: string }>
  swaps?: Array<{ action: string; driver: string; to_label: string | null; from_label: string | null }>
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
  const covers = (r: { verbatim: string | null; item_text: string }) => {
    const toks = itemTokens(r.verbatim || r.item_text)
    if (toks.length < MIN_JUDGEABLE_TOKENS) return false
    const hit = toks.filter(tk => covText.includes(tk))
    if (hit.length / toks.length < COVERAGE_THRESHOLD) return false
    const distinctive = toks.filter(tk => tk.length >= 6)
    return distinctive.length === 0 || distinctive.some(tk => covText.includes(tk))
  }

  if (!reqs.length) {
    // AC 2.1.9 — the safety rule. A coverage check with nothing to check against is unknown, not OK.
    out.push(na('must_have_coverage', 'no requirement rows for this opportunity', 'every must-have requirement is covered'))
    out.push(na('responsibilities_addressed', 'no requirement rows for this opportunity', 'every responsibility is addressed'))
  } else {
    // Split eligibility preconditions out BEFORE judging coverage — see ELIGIBILITY_RE.
    const eligibility = mustHaves.filter(r => ELIGIBILITY_RE.test(r.verbatim || r.item_text))
    const coverable = mustHaves.filter(r => !eligibility.includes(r))
    out.push(eligibility.length
      ? na('template_reach',
           `${eligibility.length} requirement(s) no generated merge field can carry — confirm against the static template`,
           'every requirement is reachable by a field the pipeline can write')
      : ok('template_reach', 'every requirement is reachable by a generated field',
           'every requirement is reachable by a field the pipeline can write'))
    // The offender list still names them, so "not scored" never means "not shown".
    const elig = out[out.length - 1]
    if (eligibility.length) elig.offenders = eligibility.map(r => `#${r.seq} ${(r.verbatim || r.item_text).slice(0, 80)}`)

    const uncovered = coverable.filter(r => !covers(r))
    out.push(!coverable.length
      ? na('must_have_coverage', 'the posting produced no must-have requirements', 'every must-have requirement is covered')
      : uncovered.length
        ? bad('must_have_coverage', `${mustHaves.length - uncovered.length}/${mustHaves.length} must-haves covered`,
              'every must-have requirement is covered',
              uncovered.map(r => `#${r.seq} ${(r.verbatim || r.item_text).slice(0, 80)}`))
        : ok('must_have_coverage', `${coverable.length}/${coverable.length} must-haves covered`, 'every must-have requirement is covered'))

    const resp = reqs.filter(r => r.kind === 'responsibility')
    const unaddressed = resp.filter(r => !covers(r))
    out.push(!resp.length
      ? na('responsibilities_addressed', 'the posting produced no responsibilities', 'every responsibility is addressed')
      : unaddressed.length
        ? bad('responsibilities_addressed', `${resp.length - unaddressed.length}/${resp.length} responsibilities addressed`,
              'every responsibility is addressed',
              unaddressed.map(r => `#${r.seq} ${(r.verbatim || r.item_text).slice(0, 80)}`), 'warn')
        : ok('responsibilities_addressed', `${resp.length}/${resp.length} addressed`, 'every responsibility is addressed'))
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
  if (results.some(r => r.state === 'fail' && r.engine === 'deterministic')) return 'fail'
  if (results.some(r => r.state === 'warn' || (r.state === 'fail' && r.engine === 'reviewer'))) return 'warn'
  if (results.length && results.every(r => r.state === 'not_applicable')) return 'warn'
  return 'pass'
}

/** The count a UI badge must show, so the badge and the gate can never disagree (P8.5 / R4). */
export function attentionCount(results: CheckResult[]): number {
  return results.filter(r => r.state === 'fail' || r.state === 'warn').length
}

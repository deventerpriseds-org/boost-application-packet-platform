// P7 item 6 — what a packet build may CLAIM, as pure logic.
//
// This exists because the guards written for it were inert. They asserted that the source contained
// the string `ok: !failed.length && !warned.length`; forcing `failed` and `warned` empty while
// leaving that literal in place passed all three, and so did emptying `built.warnings` at the
// source. They tested spelling. Renaming a variable failed them. That is precisely backwards, and
// it is the second time in this lane a grep-shaped guard was evaded by a rename.
//
// The logic is therefore lifted out of the HTTP handler — which needs Drive, Postgres and OpenAI to
// exercise — into a function a test can call with real inputs and assert on real outputs. Same split
// as `checks.ts` vs `appChecks.ts`: no @azure/functions, no pg, no network.

export interface BuiltArtifact {
  type: string
  url?: string
  error?: string
  warnings?: string[]
  qcApplied?: boolean | null
}

export interface BuildSummary {
  /** True only when every artifact built AND none of them built with a warning. */
  ok: boolean
  built: number
  failed: number
  warnings: string[]
  note: string
}

/**
 * `ok` means "every artifact built, and none with a warning" — not "the handler returned".
 *
 * The defect this replaces: `packetBuildAll` returned `ok: true, note: 'Packet built.'` EVEN WHEN
 * EVERY ARTIFACT THREW. The per-artifact error sat in the payload, but the one field a caller reads
 * said success. A build that produced nothing reported the same thing as a build that produced
 * everything.
 */
/**
 * How a QUEUED build ended — a different question from `summariseBuild().ok`, and conflating the two
 * mislabelled a real build.
 *
 * `summariseBuild().ok` means "clean": no failures AND no warnings. That is a QUALITY signal, and it
 * is false for almost every real packet — the first build to run through the queue produced four
 * documents, all four written, and 42 warnings, which is an ordinary good outcome. Mapping that
 * `ok:false` straight onto the job state recorded it as `failed`, so the owner would have been told
 * their build failed while looking at four finished documents. Exactly the lie the queue was built to
 * stop telling, reintroduced one layer up.
 *
 * A job FAILED when there is nothing to show for it or an artifact did not build: the owner has to
 * act. Warnings travel in the payload, where the screen can render them without calling the build a
 * failure.
 */
export function buildJobOutcome(status: number, body: any): { ok: boolean; error: string | null } {
  if (status !== 200) return { ok: false, error: (body && body.error) || `the build returned HTTP ${status}` }
  if (!body) return { ok: false, error: 'the build returned no result' }
  if (body.error) return { ok: false, error: String(body.error) }
  if ((body.failed || 0) > 0) return { ok: false, error: String(body.note || `${body.failed} artifact(s) failed to build`) }
  if ((body.built || 0) === 0) return { ok: false, error: String(body.note || 'the build produced no artifacts') }
  return { ok: true, error: null }
}

export function summariseBuild(results: BuiltArtifact[]): BuildSummary {
  const rows = results || []
  const failed = rows.filter(r => r.error)
  const warned = rows.filter(r => !r.error && (r.warnings || []).length)
  const warnings = warned.flatMap(r => (r.warnings || []).map(w => `${r.type}: ${w}`))
  const note = failed.length
    ? `${failed.length} of ${rows.length} artifact(s) FAILED to build: ${failed.map(r => r.type).join(', ')}. Nothing was sent.`
    : warned.length
      ? `Packet built with ${warnings.length} warning(s) across ${warned.length} artifact(s). Nothing was sent.`
      : 'Packet built. Nothing was sent.'
  return { ok: !failed.length && !warned.length, built: rows.length - failed.length, failed: failed.length, warnings, note }
}


/**
 * What each generation pass produced for the five skill slots, and which one the document kept.
 *
 * WHY THIS EXISTS AT ALL. The three calls are held in one function's local scope and then discarded,
 * so the only thing that survived a build was the MERGED result. That makes the single most
 * consequential question about the pipeline unanswerable after the fact: when the resume says a
 * skill, which pass wrote it? It was asked directly — "is the refinement actually reaching the
 * document, or is the QC pass overwriting it?" — and could not be answered from any stored row.
 *
 * WHERE IT IS STORED, AND WHERE IT MUST NOT BE. This goes into `packet.last_build`, which is
 * diagnostic only: nothing scores off it, no gate reads it, and no coverage count derives from it.
 * It must never be written into `requirement_evidence`, `check_result`, `artifact_score` or
 * `swap_decision` — those are accusation-grade, and model prose reaching them turns a diagnosis into
 * a claim about the candidate. Attributing skills inside the swap system would be a genuine
 * improvement to `skill_candidate.origin`, and it is deliberately NOT done here: that path decides
 * things, this one only records them.
 *
 * `winner` is derived from the values, never asserted alongside them, so it cannot disagree with the
 * lists it describes.
 */
export interface SlotLineage {
  slot: string
  call1: string
  call2: string
  call3: string
  final: string
  winner: 'call1' | 'call2' | 'call3' | 'none'
}

const LINEAGE_SLOTS: Array<[string, string, string, string]> = [
  // [slot, call1 key, call2 key, call3 key] — the pkg key is the slot name.
  ['SkillsBullets1', 'skills1', 'skills1', 'finalSkills1'],
  ['SkillsBullets2', 'skills2', 'skills2', 'finalSkills2'],
  ['RelevantBullets1', 'relevant1', 'relevant1', 'finalRelevant1'],
  ['RelevantBullets2', 'relevant2', 'relevant2', 'finalRelevant2'],
  ['RelevantBullets3', 'relevant3', 'relevant3', 'finalRelevant3'],
]

/**
 * Compare on CONTENT, not on formatting — the first version compared raw strings and was wrong.
 *
 * Measured: the shipped `SkillsBullets1` was Call 2's list exactly, item for item, and the raw
 * comparison still returned `none` for all five slots. The reason is that a correction pass runs
 * after assembly and strips the `- ` bullet prefix, so every value differs from its source by two
 * characters per line. A lineage that reports "none" on every row of a healthy build is worse than
 * no lineage: it is a panel that always says the same wrong thing, and it would have been believed.
 */
function sameList(a: string, b: string): boolean {
  const norm = (s: string) => s.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).join('\n')
  return !!a && !!b && norm(a) === norm(b)
}

export function skillLineage(c1: any, c2: any, c3: any, pkg: Record<string, any>): SlotLineage[] {
  const txt = (v: any) => (typeof v === 'string' ? v.trim() : '')
  return LINEAGE_SLOTS.map(([slot, k1, k2, k3]) => {
    const call1 = txt(c1?.[k1]), call2 = txt(c2?.[k2]), call3 = txt(c3?.[k3])
    const final = txt(pkg?.[slot])
    // Compared against the value that SHIPPED, in the precedence order the assembler applies, so the
    // answer is what actually happened rather than what the ranking says should have happened.
    const winner: SlotLineage['winner'] =
      !final ? 'none'
        : sameList(final, call3) ? 'call3'
        : sameList(final, call2) ? 'call2'
        : sameList(final, call1) ? 'call1'
        : 'none'
    return { slot, call1, call2, call3, final, winner }
  })
}

/** One section a call produced that maps to no merge field — the analysis half of the owner's prompts. */
export interface AnalysisSection { call: number; title: string; body: string; chars: number; truncated?: boolean }

/** Per-section and total caps. One section measured 2,694 characters and builds are frequent; an
 *  uncapped diagnostic column is a table that grows without anyone deciding it should. */
export const ANALYSIS_SECTION_MAX = 4000
export const ANALYSIS_TOTAL_MAX = 24000

export function collectAnalysis(c1: any, c2: any): AnalysisSection[] {
  const out: AnalysisSection[] = []
  let total = 0
  for (const [call, c] of [[1, c1], [2, c2]] as Array<[number, any]>) {
    for (const u of (c?._unmapped || [])) {
      const body = String(u?.body ?? '')
      const title = String(u?.title ?? '').slice(0, 200)
      if (!body.trim()) continue
      if (total >= ANALYSIS_TOTAL_MAX) return out
      const room = Math.min(ANALYSIS_SECTION_MAX, ANALYSIS_TOTAL_MAX - total)
      const kept = body.length > room ? body.slice(0, room) : body
      total += kept.length
      // `chars` is the FULL length, never the kept length. A record that shrinks the number along
      // with the text is how "7,446 characters discarded" becomes un-measurable a week later.
      out.push({ call, title, body: kept, chars: body.length, ...(kept.length < body.length ? { truncated: true } : {}) })
    }
  }
  return out
}

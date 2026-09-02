// WHAT:       An interim `keyword_coverage` measurement that owes the term library nothing: the ATS
//             keyword list the resume's own Call-1 pass produced, scored against the skills text
//             that ACTUALLY SHIPPED in the packet.
// WHY:        Owner, 2026-09-01: "confirm a way to use what we gain to get the score until library
//             is added to suppliment not drop it." `keyword_coverage` has been null on all 52
//             artifact_score rows ever written, and it is one of three components a composite needs,
//             so the composite has never once been non-null in production.
// SUPERSEDES: nothing. The published-library path (appChecks.ts) is untouched and strictly wins.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/AC-interim-score-and-reviewer.md (S1-S8), and the live reads quoted
//             below against packet 85cee965 / opp 9f9c370a.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE COLUMN THIS DELIBERATELY DOES NOT READ, and it is the whole reason this file is careful.
//
// The section is a three-column HTML table. The owner's own prompt defines it
// (docs/zap-289877647/prompts/16-update-resume-portfolio-fields-prompt.md:329-338):
//
//     ### Missing ATS Skills ### - Generate a table formatted with html tags
//     Column 1: The full list of ATS optimized keywords
//     Column 2: Update with the Skills & Relevent Skills items that cover that ATS keyword,
//               else "Missing"
//     Column 3: List location of the matching skill or use "Missing"
//
// So column 2 reads as a ready-made coverage answer, and using it is the obvious implementation.
// IT IS WRONG, measured on the owner's live Trinnex packet 2026-09-02:
//
//     the table says 9 of 9 keywords are "Missing"
//     6 of those 9 are present VERBATIM in the shipped SkillsBullets1/2 + ExpertiseBullets
//     -> reading column 2 reports 0% on a resume that places 67% of them
//
// The cause is not a bad model. `collectAnalysis` captures this section from CALL 1, and Call 3's
// ATS-QC merge runs afterwards -- so the table is a true statement about a draft that no longer
// exists. A score sourced from it would tell the owner their resume is worthless while the document
// in their hands places two thirds of the keywords. That is the defamatory-number failure this
// repo's "never fabricate a composite" rule exists to prevent, arriving through a column that looks
// authoritative.
//
// COLUMN 1 IS SOUND AND IS ALL THIS FILE USES. It is the employer-derived keyword list -- the
// DENOMINATOR -- and nothing downstream of Call 1 changes which keywords the posting asks for. The
// NUMERATOR is recomputed here against the shipped text. `H:ats-numerator-comes-from-what-shipped`
// fails if anyone ever reads column 2 as coverage again.
//
// WHAT THIS IS NOT. It is not candidate-vs-library coverage, and it is not `packet.covered_kw` or
// `packet.ats_score` -- both of those are written by `jdAnalysis`, which never sees the candidate
// at all (`appPackets.ts:1268-1273`; `comparesToProfile()` is false on that path by construction,
// and that file's own D14 comment already refused to build a keyword number from it). An AC pass
// refuted exactly that pairing before this file was written.

/** One ATS keyword the posting asks for, and whether the shipped document places it. */
export interface AtsKeywordRow {
  keyword: string
  covered: boolean
}

export interface AtsCoverage {
  /** Null when nothing could be parsed -- NEVER 0. Absent evidence is not a measurement. */
  covered: number | null
  total: number | null
  rows: AtsKeywordRow[]
  /** Why, in the owner's terms, when there is no number. Null when there is one. */
  reason: string | null
}

const NOT_PARSED = (reason: string): AtsCoverage =>
  ({ covered: null, total: null, rows: [], reason })

/**
 * The keyword list, from column 1 of the `Missing ATS Skills` table.
 *
 * THE HEADER ROW IS REAL AND MUST BE DROPPED. Measured on the live packet: the section contains
 * 10 `<tr>` of which 1 is `<th>ATS Optimized Keywords</th>...`. Counting it would put 10 in the
 * denominator instead of 9 and make every score slightly wrong in the same direction, forever --
 * the kind of off-by-one that ships because nobody looks at the raw text. It is dropped by testing
 * for a `<th>` in the row rather than by skipping "the first row", because a model that omits the
 * header would then lose a real keyword.
 */
export function parseAtsKeywords(body: string | null | undefined): string[] {
  const src = typeof body === 'string' ? body : ''
  if (!src.trim()) return []
  const out: string[] = []
  // A HEADER ROW WITH NO `<th>` AT ALL is still a header. Found by an independent verifier attacking
  // C4 beyond its wording: the `<th>` test is the only defence, so a model rendering the header as
  // `<td><b>ATS Optimized Keywords</b></td>` puts its LABEL in the keyword list — a denominator
  // entry no document can ever cover, dragging every score down by one row's worth. LLM table output
  // omitting `<th>` semantics is ordinary, not exotic.
  //
  // Structural rather than a wording match: if the table declares NO `<th>` anywhere, its first row
  // is treated as the header. Safe in both directions — a real all-`<td>` table has a header to lose
  // and loses it; a table that DOES use `<th>` is unaffected and keeps every `<td>` row.
  const hasTh = /<th[\s>]/i.test(src)
  let seen = 0
  for (const [, tr] of src.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    seen++
    if (/<th[\s>]/i.test(tr)) continue                      // the header, not a keyword
    if (!hasTh && seen === 1) continue                       // ...and the same row without <th>
    const first = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(tr)
    if (!first) continue
    // Strip any nested markup and collapse whitespace: the cell is prose, not HTML we own.
    const kw = first[1].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    // A cell reading "Missing" in COLUMN ONE is not a keyword -- it is a model that shifted its
    // columns. Dropping it is safer than scoring against a keyword literally named Missing.
    if (!kw || /^missing$/i.test(kw)) continue
    if (!out.some(k => k.toLowerCase() === kw.toLowerCase())) out.push(kw)
  }
  return out
}

/**
 * Is this keyword present in the text that SHIPPED?
 *
 * WHOLE-PHRASE, CASE-INSENSITIVE, AND NOTHING CLEVERER. This decides a score component, so the
 * repo's standing rule binds: fuzzy matching is for RANKING, never for ACCUSING. A similarity
 * threshold here would let "Leadership Experience" match "Engineering Leadership" and report
 * coverage the document does not have -- and the direction of that error is the bad one, because it
 * inflates the number a reviewer trusts most.
 *
 * Whitespace is collapsed on both sides so a keyword broken across a line break in a bullet list
 * still matches; nothing else is normalised.
 */
export function keywordPresent(keyword: string, shipped: string): boolean {
  const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').toLowerCase()
  const k = norm(keyword)
  if (!k) return false
  // WORD BOUNDARIES, because `.includes()` IS NOT WHOLE-PHRASE and this header claimed it was.
  //
  // REFUTED BY AN INDEPENDENT VERIFIER (VERIFY-ats-keyword-score-1.md, C6). The doc above said
  // "whole-phrase ... and nothing cleverer"; the code was an unguarded substring test, and the
  // shipped tests only probed multi-word near-misses (`Leadership Experience` vs
  // `Engineering Leadership`) — never a short keyword that is a PREFIX of a longer word. Measured
  // false positives it produced:
  //
  //     Cloud   in "We use Cloudera for data warehousing"     -> counted as covered
  //     Program in "Extensive Programming experience"         -> counted as covered
  //     Manage  in "Strong Management background"             -> counted as covered
  //     Lead    in "Leadership"                               -> counted as covered
  //
  // Real ATS lists are full of single terms — Agile, Python, Cloud — so this is ordinary input, not
  // a synthetic worst case. And the error direction is the dangerous one: every false positive
  // INFLATES the score, which is the number a reviewer trusts most and the one this file's own rule
  // ("fuzzy matching is for RANKING, never for ACCUSING") exists to protect.
  //
  // `\b` is not enough on its own: a keyword may legitimately contain regex metacharacters (C++,
  // .NET), so it is escaped first. The boundary is asserted with lookarounds rather than `\b` at
  // the edges, because `\b` before a non-word character (as in "+") does not mean what it looks
  // like it means.
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i').test(norm(shipped))
}

/**
 * The interim keyword coverage for ONE artifact.
 *
 * `shippedFields` are the merge-field values that actually reached the document. The caller passes
 * them rather than a packet, so this stays pure and the "which fields count as skills text"
 * decision has ONE home (`appChecks.ts`), where the artifact type is known.
 *
 * Every failure path returns `covered: null` with a reason. None returns 0: `round(0/N*100)`
 * renders as a confident, measured-looking 0%, and a component with no source is precisely the
 * number a reviewer trusts most and the one most likely to be wrong.
 */
export function atsCoverage(sectionBody: string | null | undefined, shippedFields: Array<string | null | undefined>): AtsCoverage {
  const keywords = parseAtsKeywords(sectionBody)
  if (!keywords.length) {
    return NOT_PARSED(
      !sectionBody || !String(sectionBody).trim()
        ? 'this packet has no ATS keyword table yet - rebuild it to measure keyword coverage'
        : 'the ATS keyword table could not be read as a table, so keyword coverage is unmeasured')
  }
  const shipped = shippedFields.filter(v => typeof v === 'string' && v.trim()).join('\n')
  // NO SHIPPED TEXT IS NOT ZERO COVERAGE. An artifact whose skills fields are empty has not been
  // measured against anything; reporting 0/9 would accuse the document of omitting keywords when
  // the document does not exist yet.
  if (!shipped.trim()) {
    return NOT_PARSED('this artifact has no skills text yet, so its keyword coverage is unmeasured')
  }
  const rows = keywords.map(keyword => ({ keyword, covered: keywordPresent(keyword, shipped) }))
  return { covered: rows.filter(r => r.covered).length, total: rows.length, rows, reason: null }
}

/**
 * The sentence that travels with the number.
 *
 * It names the SOURCE, not just the value, because this is an interim measurement that a published
 * term library will later replace outright -- and the owner must be able to attribute a jump in the
 * score to a source change rather than wonder what happened to their resume. The repo's rule that a
 * differently-sourced composite is the number most likely to be trusted and most likely to be wrong
 * is the reason this is not optional.
 */
export function atsCoverageSource(c: AtsCoverage): string {
  return c.covered === null || c.total === null
    ? String(c.reason || 'keyword coverage is unmeasured')
    : `${c.covered}/${c.total} ATS keywords from the posting are present in this document `
      + '(interim: measured against the resume\'s own ATS keyword list, not the term library)'
}

/**
 * The merge fields whose text counts as "the skills this document places".
 *
 * ONE HOME for the decision, named here rather than inline at the call site, so the numerator and
 * any future consumer cannot drift apart. These are the resume's skills-bearing slots: the two
 * skills lists, the expertise block, and the three relevant-skills lists -- exactly the lists the
 * owner's prompt tells the model to check the ATS keywords against ("Review Skills, Expertise, and
 * Relevant skills lists and note which of the recommended ATS keywords they cover").
 *
 * `ResumeSummary` is deliberately EXCLUDED. It is prose, and the remediation loop is already known
 * to stuff posting wording into it (open row: "Stop the remediation loop stuffing ResumeSummary with
 * JD wording"). Counting a keyword because it appears in a summary the pipeline copied from the
 * posting would let the document score itself on the employer's own words -- the self-scoring
 * failure `checks.ts` calls "a document repeating words back at itself".
 */
export const ATS_SHIPPED_FIELDS = [
  'SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets',
  'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3',
] as const

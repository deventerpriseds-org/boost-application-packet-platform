// Parses the resume agent's ###-delimited output into a keyed package.
//
// The prompt emits sections as "### Title ###\ncontent", so splitting on ###
// yields alternating [title, content, title, content, ...] pairs. Mapping by
// POSITION is wrong (it grabs titles as content); we map by TITLE instead.
// First occurrence wins, so the clean plain-text sections beat the later
// HTML-duplicated ones. Work history is NOT produced by the agent — it comes
// from MasterContext.
//
// P7 residual (the narrowed half of "positional coupling"): mapping by title fixed WHICH field a
// section lands in, but the walk was still positional — it stepped `i += 2` and took `parts[i+1]`
// as the body. That makes the ALTERNATION load-bearing: one stray `###` anywhere in prose (the
// prompt itself instructs the model to bookend headers with `###`, and models emit "### " inside
// generated bullets) shifts the parity of every following pair, so from that point on titles are
// read as bodies and bodies as titles, and every later section is silently lost or misfiled.
//
// The walk below is heading-driven instead: each part is independently classified as a heading or
// not, and a heading takes everything up to the NEXT heading as its body. Parity is no longer
// carried across sections, so a stray delimiter costs at most the fragment it split — never the
// alignment of the rest of the document.

type MC = Record<string, any>

function normalize(t: string): string {
  return t.replace(/<[^>]+>/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase()
}

// Optional leading qualifier words the agent commonly prefixes onto a heading
// (e.g. "Core Skills 1", "Key Skills", "Technical Expertise", "Professional
// Summary"). Kept as a shared fragment so every section matches the same variants.
const QUAL = '(?:core|key|technical|professional|relevant)?\\s*'
// A trailing section index — with or without a space, optionally after "#".
const N = (n: number) => `\\s*#?\\s*${n}\\b`

// Ordered keyword -> field. Checked in order; first matching title sets the
// field. Regexes are intentionally loose so common heading variants match for
// EVERY section — optional qualifier words (core/key/technical/professional),
// optional "&"/"and", and a trailing digit with or without a space — while
// still respecting the original exact matches (e.g. "Skills 1" / "skills1").
const TITLE_MAP: Array<[RegExp, string]> = [
  [/^date$/, 'date'],
  [/target\s*(?:job\s*)?(?:title|role)/, 'targetRole'],
  [/target\s*company/, 'targetCompany'],
  [new RegExp(`${QUAL}(?:resume\\s*)?summary`), 'resumeSummary'],
  [new RegExp(`^${QUAL}skills${N(1)}|^${QUAL}skills1$`), 'skills1'],
  [new RegExp(`^${QUAL}skills${N(2)}|^${QUAL}skills2$`), 'skills2'],
  // Plain "Skills"/"Core Skills" (no digit) → treat as the first skills block.
  [new RegExp(`^${QUAL}skills$`), 'skills1'],
  [new RegExp(`^${QUAL}(?:areas?\\s*of\\s*)?expertise$`), 'expertise'],
  [new RegExp(`relevant.*(?:skills?|bullets?|experience).*${N(1)}|relevant.*${N(1)}`), 'relevant1'],
  [new RegExp(`relevant.*(?:skills?|bullets?|experience).*${N(2)}|relevant.*${N(2)}`), 'relevant2'],
  [new RegExp(`relevant.*(?:skills?|bullets?|experience).*${N(3)}|relevant.*${N(3)}`), 'relevant3'],
  [new RegExp(`^work\\s*(?:history|experience)${N(1)}|^work\\s*(?:history|experience)1$`), 'workHistory1'],
  [new RegExp(`^work\\s*(?:history|experience)${N(2)}|^work\\s*(?:history|experience)2$`), 'workHistory2'],
  [new RegExp(`^work\\s*(?:history|experience)${N(3)}|^work\\s*(?:history|experience)3$`), 'workHistory3'],
  [new RegExp(`^work\\s*(?:history|experience)${N(4)}|^work\\s*(?:history|experience)4$`), 'workHistory4'],
  [/cover\s*letter/, 'coverLetter'],
  [/about\s*me\s*(?:passage\s*)?#?\s*1/, 'aboutMe1'],
  [/about\s*me\s*(?:passage\s*)?#?\s*2/, 'aboutMe2'],
  [/executive\s*profile/, 'executiveProfile'],
  [/core\s*accomplishments/, 'coreAccomplishments'],
]

// A heading is a SHORT, SINGLE-LINE fragment that matches one of the TITLE_MAP patterns. Both shape
// tests matter: the patterns are deliberately loose (unanchored, to tolerate heading variants), so
// without them a long body paragraph that happens to contain "relevant … 1" would be promoted to a
// heading and swallow the section that follows it.
const HEADING_MAX_CHARS = 80

/**
 * Every field this part could title, in TITLE_MAP order. Empty array ⇒ the part is body text.
 *
 * ALL matches are returned, not just the first, because the patterns genuinely overlap: `QUAL`
 * includes "relevant", so the heading "Relevant Skills 1" matches the `skills1` pattern BEFORE the
 * `relevant1` one. The original walk relied on that — it only broke out of the pattern loop when it
 * actually assigned, so a heading whose first match was already filled fell through to its later,
 * more specific match. Returning one key here would silently drop every Relevant Skills section.
 * (The overlap itself is a latent defect: a document that lists Relevant Skills 1 BEFORE Skills 1
 * still misfiles it. Left as-is deliberately — the live prompts emit Skills first, and changing the
 * table changes generation, which is outside this fix.)
 */
export function headingKeysFor(part: string): string[] {
  const raw = String(part ?? '').trim()
  if (!raw || /[\r\n]/.test(raw)) return []
  const title = normalize(raw)
  if (!title || title.length > HEADING_MAX_CHARS) return []
  const keys: string[] = []
  for (const [rx, key] of TITLE_MAP) if (rx.test(title) && !keys.includes(key)) keys.push(key)
  return keys
}

/** True when this part is a section heading rather than body text. */
export function isHeading(part: string): boolean {
  return headingKeysFor(part).length > 0
}

export function parseResumePackage(content: string, mc: MC, jobTitle: string, company: string): any {
  const parts = content.split('###').map((s) => s.trim()).filter(Boolean)
  const fields: Record<string, string> = {}

  // Classify every part ONCE, then let each heading claim the run of body parts that follows it.
  // Nothing depends on a part's index parity, so a stray delimiter cannot re-align what comes after.
  const keys = parts.map(headingKeysFor)
  for (let i = 0; i < parts.length; i++) {
    if (!keys[i].length) continue
    const body: string[] = []
    for (let j = i + 1; j < parts.length && !keys[j].length; j++) body.push(parts[j])
    if (!body.length) continue                      // heading with no body — leave the field open
    // First unfilled candidate wins, mirroring the original loop's fall-through.
    const key = keys[i].find((k) => !fields[k])
    if (key) fields[key] = body.join('\n\n')
  }

  const val = (k: string) => (mc && mc[k] != null ? String(mc[k]) : '')

  return {
    date: fields.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    targetRole: fields.targetRole || jobTitle,
    targetCompany: fields.targetCompany || company,
    resumeSummary: fields.resumeSummary || '',
    skills1: fields.skills1 || '',
    skills2: fields.skills2 || '',
    expertise: fields.expertise || '',
    relevant1: fields.relevant1 || '',
    relevant2: fields.relevant2 || '',
    relevant3: fields.relevant3 || '',
    coverLetter: fields.coverLetter || '',
    aboutMe1: fields.aboutMe1 || '',
    aboutMe2: fields.aboutMe2 || '',
    executiveProfile: fields.executiveProfile || '',
    coreAccomplishments: fields.coreAccomplishments || '',
    // Work history usually comes from the baseline MasterContext, but if the
    // agent emitted a Work History section (variant heading now matched above),
    // prefer that over the MC baseline rather than dropping it.
    workHistory1: fields.workHistory1 || val('workHistory1'),
    workHistory2: fields.workHistory2 || val('workHistory2'),
    workHistory3: fields.workHistory3 || val('workHistory3'),
    workHistory4: fields.workHistory4 || val('workHistory4'),
    _parsedFieldCount: Object.keys(fields).length
  }
}

// Parses the resume agent's ###-delimited output into a keyed package.
//
// The prompt emits sections as "### Title ###\ncontent", so splitting on ###
// yields alternating [title, content, title, content, ...] pairs. Mapping by
// POSITION is wrong (it grabs titles as content); we map by TITLE instead.
// First occurrence wins, so the clean plain-text sections beat the later
// HTML-duplicated ones. Work history is NOT produced by the agent — it comes
// from MasterContext.

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

export function parseResumePackage(content: string, mc: MC, jobTitle: string, company: string): any {
  const parts = content.split('###').map((s) => s.trim()).filter(Boolean)
  const fields: Record<string, string> = {}

  for (let i = 0; i + 1 < parts.length; i += 2) {
    const title = normalize(parts[i])
    const body = parts[i + 1]
    for (const [rx, key] of TITLE_MAP) {
      if (rx.test(title) && !fields[key]) { fields[key] = body; break }
    }
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

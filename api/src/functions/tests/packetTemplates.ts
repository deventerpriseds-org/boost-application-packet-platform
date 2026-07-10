// G6 — Real packet artifacts by TEMPLATE FILL (not from-scratch).
//
// COPY a pre-designed Google template (Doc or Slides), then replaceAllText each
// {{Placeholder}} with content produced by the PROVEN 3-agent engine
// (pipeline.ts buildPackageForJD → assemblePackage), exactly like the MT-22 test
// flow that generated the correctly-filled portfolio files. Placeholders were
// extracted authoritatively via GET /diag/template-placeholders.
//
// Adds a lightweight "review agent" cleanup pass: after injection, any remaining
// {{...}} tokens (unfilled placeholders) are stripped so dynamic-text gaps don't
// leave eyesores in the finished packet.

export const RESUME_TEMPLATE_ID = '1bwOcxvkbihRTUjOzVjrWSPnDomwqy6gOz6229mdzbZw'   // Google Doc
export const PORTFOLIO_TEMPLATE_ID = '1ULZZLBs9zwLEN6c8hcXvBCNPk0YyTGg0yIlFSYkGIec' // Google Slides
export const COVER_LETTER_TEMPLATE_ID = '1QN4Cnw4R9krUH4kEpl_lnhoPOkY5PG2oUKRMjxBfWV0' // Google Slides
export const OUTPUT_FOLDER_ID = '1MlVLMSQ0EQJoAtpKC1Mv7mDCAJDmdJTt'

export interface TemplateMeta { templateId: string; isSlides: boolean; kindLabel: string; placeholders: string[] }

// Authoritative placeholder sets per template (the keys that actually exist in
// each file). pkg from assemblePackage carries a value for every one of these.
export const TEMPLATE_META: Record<string, TemplateMeta> = {
  resume: {
    templateId: RESUME_TEMPLATE_ID, isSlides: false, kindLabel: 'Resume',
    placeholders: ['ResumeSummary', 'SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets', 'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3'],
  },
  compact_resume: {
    templateId: RESUME_TEMPLATE_ID, isSlides: false, kindLabel: 'Compact Resume',
    placeholders: ['ResumeSummary', 'SkillsBullets1', 'SkillsBullets2', 'ExpertiseBullets', 'RelevantBullets1', 'RelevantBullets2', 'RelevantBullets3'],
  },
  portfolio: {
    templateId: PORTFOLIO_TEMPLATE_ID, isSlides: true, kindLabel: 'Portfolio',
    placeholders: ['@Company', '@CoverLetterDate', '@CoverLetterBody', '@AboutMe1_50words', '@AboutMe2_60words', '@ExecutiveProfile_55words', '@CoreAccomplishments_5blts_180words'],
  },
  cover: {
    templateId: COVER_LETTER_TEMPLATE_ID, isSlides: true, kindLabel: 'Cover Letter',
    placeholders: ['@Company', '@CoverLetterDate', '@CoverLetterBody'],
  },
}

export function metaFor(type: string): TemplateMeta | null { return TEMPLATE_META[type] || null }

// Build the {{placeholder}} → value map for a type from the assembled package.
// Only the placeholders that exist in the template are injected.
export function varsForType(type: string, pkg: Record<string, string | null>): Record<string, string> {
  const meta = metaFor(type)
  if (!meta) return {}
  const vars: Record<string, string> = {}
  for (const key of meta.placeholders) vars[`{{${key}}}`] = (pkg[key] ?? '').toString()
  return vars
}

// Copy the template into the packets folder, returns the new file id.
export async function copyTemplate(token: string, templateId: string, name: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, parents: [OUTPUT_FOLDER_ID] }),
  })
  const j = await res.json() as any
  if (!res.ok) throw new Error(`copy ${name} HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.id
}

function apiBase(isSlides: boolean) { return isSlides ? 'https://slides.googleapis.com/v1/presentations' : 'https://docs.googleapis.com/v1/documents' }

// replaceAllText for each {{key}} → value.
export async function injectValues(token: string, id: string, values: Record<string, string>, isSlides: boolean): Promise<void> {
  const requests = Object.entries(values).map(([k, v]) => ({ replaceAllText: { containsText: { text: k, matchCase: true }, replaceText: v } }))
  if (!requests.length) return
  const res = await fetch(`${apiBase(isSlides)}/${id}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ requests }),
  })
  if (!res.ok) throw new Error(`inject HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

// Read all text out of a Doc/Slides JSON structure.
function collectText(node: any, out: string[]) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return }
  if (typeof node.content === 'string') out.push(node.content)
  for (const k of Object.keys(node)) collectText(node[k], out)
}

// Review-agent cleanup: strip any leftover {{...}} tokens (unmapped placeholders)
// so dynamic-text gaps don't leave eyesores in the finished packet.
export async function stripLeftoverTokens(token: string, id: string, isSlides: boolean): Promise<string[]> {
  const url = isSlides ? `https://slides.googleapis.com/v1/presentations/${id}` : `https://docs.googleapis.com/v1/documents/${id}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return []
  const doc = await res.json() as any
  const chunks: string[] = []
  collectText(doc, chunks)
  const tokens = Array.from(new Set((chunks.join('').match(/\{\{@?[^}]+\}\}/g) || []).map((s) => s.trim())))
  if (!tokens.length) return []
  const requests = tokens.map((t) => ({ replaceAllText: { containsText: { text: t, matchCase: true }, replaceText: '' } }))
  await fetch(`${apiBase(isSlides)}/${id}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ requests }),
  })
  return tokens
}

// Anyone-with-link reader.
export async function shareAnyone(token: string, id: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

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

/**
 * Owner-resolved template ids. P7 item 8 — `TEMPLATE_META` is the SEED table, not the answer:
 * `google.resumeTemplateId` / `google.portfolioTemplateId` / `google.coverLetterTemplateId` have
 * been writable in Auth & Config since it was written and were read by nothing.
 */
export interface TemplateIdOverrides {
  resumeTemplateId?: string
  portfolioTemplateId?: string
  coverLetterTemplateId?: string
}

/** Which override key backs each artifact type. `compact_resume` shares the resume template. */
const OVERRIDE_KEY: Record<string, keyof TemplateIdOverrides> = {
  resume: 'resumeTemplateId',
  compact_resume: 'resumeTemplateId',
  portfolio: 'portfolioTemplateId',
  cover: 'coverLetterTemplateId',
}

/**
 * The template for an artifact type, with the owner's configured id applied when there is one.
 *
 * `ids` is OPTIONAL on purpose: several call sites use `metaFor(type)` purely as "does this type
 * have a template at all", and making them async to answer a question the seeds already answer would
 * have been a rewrite for nothing. Every site that actually COPIES a file passes the resolved ids.
 */
export function metaFor(type: string, ids?: TemplateIdOverrides): TemplateMeta | null {
  const meta = TEMPLATE_META[type] || null
  if (!meta || !ids) return meta
  const override = (ids[OVERRIDE_KEY[type]] || '').trim()
  return override ? { ...meta, templateId: override } : meta
}

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
// `parentFolderId` defaults to the seeded folder; callers that have resolved `google.outputFolderId`
// pass the owner's.
export async function copyTemplate(token: string, templateId: string, name: string, parentFolderId?: string): Promise<string> {
  const parent = (parentFolderId || '').trim() || OUTPUT_FOLDER_ID
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, parents: [parent] }),
  })
  const j = await res.json() as any
  if (!res.ok) throw new Error(`copy ${name} HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.id
}

/**
 * D13 — THE ONLY Drive DELETE in this codebase, and the reason it now exists.
 *
 * Every multi-document build copies files one at a time and then does more work on each: inject,
 * strip, share. A failure at ANY step after the copy left a real Google file, owned by the
 * quota-bearing OAuth account, referenced by nothing — not by `artifact.doc_url`, not by the run's
 * response, not by a log line carrying its id. An orphan population nobody can enumerate is one
 * nobody can ever clean up, so the leak was permanent and grew once per failed build.
 *
 * SCOPE, and it is narrow on purpose. This deletes a file THIS CALL just created and then abandoned.
 * It does NOT delete a SUPERSEDED file — `renderArtifact` returns `supersededDocUrl` so the caller
 * can record those, and whether to reap them is an owner decision (P3-24 / D-9), not this function's.
 *
 * Never throws. Cleanup runs on a path that is already failing, and a 403 from Drive must not
 * replace the real error with a worse one. The boolean says whether the file is actually gone, so a
 * caller can report `orphaned` honestly instead of assuming the tidy-up worked.
 */
export async function deleteDriveFile(token: string, id: string): Promise<boolean> {
  if (!id) return false
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    // 404 == already gone, which is the state we wanted.
    return res.ok || res.status === 404
  } catch { return false }
}

/**
 * Copy, then run `after` on the new file — and DELETE the copy if `after` throws.
 *
 * This is the D13 primitive. The defect it closes is not "the caller forgot to clean up"; it is that
 * the caller COULD NOT: when `injectValues` throws, the id of the file that was already created
 * lives only in a local inside the failed function, so it never reaches the catch block. Owning both
 * halves here is what makes the id reachable at the moment it is needed.
 */
export async function copyThen<T>(
  token: string, templateId: string, name: string, parentFolderId: string | undefined,
  after: (id: string) => Promise<T>,
): Promise<{ id: string; result: T }> {
  const id = await copyTemplate(token, templateId, name, parentFolderId)
  try {
    return { id, result: await after(id) }
  } catch (err) {
    const removed = await deleteDriveFile(token, id)
    throw new Error(`${String((err as any)?.message || err)} [copy ${id} ${removed ? 'deleted' : 'ORPHANED — delete it by hand'}]`)
  }
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

/**
 * The plain text of a Google Doc or Slides file.
 *
 * Exported so the fact deriver can read the RESUME TEMPLATE — its static sections (work history
 * with dates, education, certifications) are the primary source for facts like total years of
 * experience, and asking the owner to retype what the template already states is exactly the
 * fallback-instead-of-source mistake.
 */
export async function templateText(token: string, id: string, isSlides = false): Promise<string> {
  const url = isSlides ? `https://slides.googleapis.com/v1/presentations/${id}` : `https://docs.googleapis.com/v1/documents/${id}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Google ${res.status} reading ${id}`)
  const doc = await res.json() as any
  const chunks: string[] = []
  collectText(doc, chunks)
  return chunks.join('')
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

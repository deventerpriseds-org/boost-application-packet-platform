import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { getGoogleOAuthToken } from './googleAuth'
import { loadMasterBaseline } from './appInsertions'
import { splitItems } from './swaps'

/**
 * GET /api/diag/master-source — WHICH DRIVE DOCUMENT WAS MASTERCONTEXT EXTRACTED FROM?
 *
 * READ-ONLY. Searches Drive for documents containing the owner's own master content, then scores
 * each candidate by how much of that content it actually contains, and returns them ranked.
 *
 * WHY IT HAD TO EXIST. Nothing could answer this. `diag/folders` lists the two ROLE TEMPLATE
 * folders, and everything in them is a template — "Polished Resume Template w Vars", "ATS
 * Engineering Template w Placeholders" — i.e. documents full of `{{Placeholder}}` tokens, which is
 * the opposite of the filled resume the master blocks were lifted from. `diag/doc-structure` reads
 * ONE document you already know the id of. So the question "where did this text come from" had no
 * reader, and the owner asked it directly: *"you'll need to find what resume was used for
 * extracting the master context... try to match content from what we have in master context to the
 * docs in the drive directory to find which one is the baseline used and was extracted."*
 *
 * WHY `fullText contains` RATHER THAN EXPORTING EVERY DOC. Drive can search document BODIES
 * server-side. Exporting every Doc in the account to compare locally would be dozens of round trips
 * for the same answer, and would still need the same scoring pass afterwards. The search narrows to
 * candidates; the export then MEASURES them, because `fullText contains` is a fuzzy, stemmed match
 * and is evidence of a candidate, never of a source.
 *
 * SCORING IS EXACT CONTAINMENT, DELIBERATELY. This names a document as the origin of the owner's
 * profile, which is an accusation-grade claim, and this repo's standing rule is that fuzzy matching
 * is for RANKING and never for ACCUSING. So an item counts only when its exact text appears in the
 * document (case- and whitespace-normalised, `&`/`and` folded because the store and the originating
 * Zap disagree on that one spelling). The response reports the count and the sample, so a reader
 * can see WHY a document ranked where it did rather than trusting the order.
 */

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

/** Fold the two spellings the stores disagree on, then strip to comparable text. */
export function normText(s: string): string {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The master items to look for: every list field split into items, plus the prose fields whole.
 *
 * Short items are dropped from the SEARCH anchors but kept for SCORING. A two-word skill like
 * "Data Strategy" appears in half the resumes on earth; as an anchor it returns noise, but as one
 * of thirty-six scored items it is real signal.
 */
export function masterProbes(master: Record<string, string>): { anchors: string[]; items: string[] } {
  const items: string[] = []
  for (const [field, raw] of Object.entries(master)) {
    if (!raw || typeof raw !== 'string') continue
    // Prose fields are single passages; list fields split into their items.
    if (/^(ResumeSummary|@)/.test(field)) items.push(raw.trim())
    else items.push(...splitItems(raw))
  }
  const uniq = [...new Set(items.map(s => s.trim()).filter(Boolean))]
  // Anchors: the longest, most distinctive items — a phrase common to any resume finds every resume.
  const anchors = uniq.filter(s => s.split(/\s+/).length >= 3 && s.length <= 60)
    .sort((a, b) => b.length - a.length).slice(0, 6)
  return { anchors, items: uniq }
}

async function driveSearch(token: string, phrase: string): Promise<any[]> {
  const q = encodeURIComponent(
    `fullText contains '${phrase.replace(/'/g, "\\'")}' and trashed = false ` +
    `and mimeType = 'application/vnd.google-apps.document'`)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id,name,modifiedTime)&pageSize=25&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return []
  return (await res.json()).files || []
}

async function exportText(token: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fplain`,
      { headers: { Authorization: `Bearer ${token}` } })
    return res.ok ? await res.text() : null
  } catch { return null }
}

export async function diagMasterSource(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const token = await getGoogleOAuthToken()
    const master = await loadMasterBaseline()
    if (!Object.keys(master).length) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: 'MasterContext returned no fields' } }
    }
    const { anchors, items } = masterProbes(master)

    // Union the hits across anchors. A document that contains ANY anchor is worth measuring; the
    // score decides, not the search.
    const seen = new Map<string, any>()
    for (const a of anchors) {
      for (const f of await driveSearch(token, a)) if (!seen.has(f.id)) seen.set(f.id, f)
    }

    const normItems = items.map(i => ({ raw: i, n: normText(i) })).filter(x => x.n.length > 3)
    const scored: any[] = []
    for (const f of seen.values()) {
      const text = await exportText(token, f.id)
      if (text == null) { scored.push({ id: f.id, name: f.name, error: 'export failed' }); continue }
      const hay = normText(text)
      const hits = normItems.filter(x => hay.includes(x.n))
      const placeholders = (text.match(/\{\{[^}]+\}\}/g) || []).length
      scored.push({
        id: f.id, name: f.name, modified: f.modifiedTime,
        matched: hits.length, of: normItems.length,
        pct: Math.round((hits.length / normItems.length) * 100),
        // A TEMPLATE contains placeholders and little else; a SOURCE resume contains the real text
        // and no tokens. Reported rather than filtered on, because a half-migrated document is a
        // real thing and hiding it would answer a different question than the one asked.
        placeholderTokens: placeholders,
        chars: text.length,
        missingSample: normItems.filter(x => !hay.includes(x.n)).slice(0, 8).map(x => x.raw),
      })
    }
    scored.sort((a, b) => (b.matched || 0) - (a.matched || 0))

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, masterFields: Object.keys(master).length, itemsScored: normItems.length,
        anchors, candidates: scored.length, ranked: scored.slice(0, 12),
      },
    }
  } catch (e: any) {
    return { status: 500, headers: HEADERS, jsonBody: { ok: false, error: String(e?.message || e) } }
  }
}

app.http('diagMasterSource', {
  methods: ['GET', 'OPTIONS'], authLevel: 'anonymous',
  route: 'diag/master-source', handler: diagMasterSource,
})

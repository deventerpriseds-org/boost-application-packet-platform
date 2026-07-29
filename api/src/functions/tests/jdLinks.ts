// LinkedIn job-ID capture from job-alert email HTML (ACT-22b). Job-alert emails are DIGESTS: each
// role is an <a href="…/jobs/view/{jobId}…">View job</a> anchor. The mail ingest used to strip ALL
// tags before parsing, destroying the anchors — so 722/723 opps ended up with no link and the real
// JD could never be fetched. This module preserves the jobId per role through the LLM parse.
//
// Strategy: marker-injection. Rewrite each job anchor to keep its inner text AND append a
// {{JOB:jobId}} marker, THEN strip remaining tags. The LLM sees the marker sitting with the role it
// belongs to, so it can attach the correct jobId per opportunity even in a multi-role digest. We
// validate every LLM-returned jobId against the regex-extracted set (below) so a hallucinated id
// can never slip through.

// LinkedIn embeds the numeric job id several ways across alert/comm/tracking links:
//   /jobs/view/4433165980            /comm/jobs/view/4433165980
//   ?currentJobId=4433165980         /jobs-guest/jobs/api/jobPosting/4433165980
const JOB_ID_PATTERNS: RegExp[] = [
  /\/jobs\/view\/(\d{6,})/gi,
  /\/jobPosting\/(\d{6,})/gi,
  /[?&]currentJobId=(\d{6,})/gi,
  /[?&]refId=[^&"']*&?.*?jobs\/view\/(\d{6,})/gi,
]

// Pull one jobId from a single href, trying each pattern. Returns null if none matches.
export function jobIdFromUrl(url: string): string | null {
  for (const re of JOB_ID_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(url)
    if (m && m[1]) return m[1]
  }
  return null
}

// The canonical, tracker-free public URL for a jobId (what we store + fetch the guest JD from).
export function canonicalJobUrl(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}`
}

// All distinct jobIds present in a blob of HTML/text, in document order (ground-truth set used to
// validate LLM-assigned ids and as the backfill work-list).
export function extractJobIds(html: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const re of JOB_ID_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const id = m[1]
      if (id && !seen.has(id)) { seen.add(id); out.push(id) }
    }
  }
  return out
}

// Rewrite anchors → "innerText {{JOB:jobId}}", then strip remaining tags to plain text. The markers
// survive so the LLM can bind each role to its jobId. Returns { text, ids } where ids is the
// ground-truth set for validation. Non-job anchors are just unwrapped to their text.
export function injectJobMarkers(html: string): { text: string; ids: string[] } {
  const ids = extractJobIds(html)
  const withMarkers = html.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_all, href, inner) => {
    const id = jobIdFromUrl(href)
    const innerText = inner.replace(/<[^>]+>/g, ' ')
    return id ? `${innerText} {{JOB:${id}}} ` : `${innerText} `
  })
  const text = withMarkers.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return { text, ids }
}

// Normalize free text for fuzzy matching: lowercase, strip accents + punctuation, collapse spaces.
export function normText(s: string): string {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Overlap coefficient of the significant (>2 char) word sets — 1.0 when one title's words are a
// subset of the other's. Used to match a LinkedIn anchor's job-title text to an opportunity's role.
export function tokenSim(a: string, b: string): number {
  const A = new Set(normText(a).split(' ').filter((w) => w.length > 2))
  const B = new Set(normText(b).split(' ').filter((w) => w.length > 2))
  if (!A.size || !B.size) return 0
  let inter = 0; for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size)
}

// Extract each LinkedIn job anchor with a CONTEXT window of text around it. In LinkedIn alert emails
// the anchor inner text is often empty (it wraps an image/button) — the job title + company live in
// the text just BEFORE and AFTER the anchor. So we capture ~220 chars before + ~420 after, tag-
// stripped, and match the opportunity's company+role against that. NO LLM → zero OpenAI, no timeout.
// `title` is the anchor's own inner text when present (may be empty). Document order, deduped by id.
export function extractJobAnchors(html: string): Array<{ jobId: string; title: string; context: string }> {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const out: Array<{ jobId: string; title: string; context: string }> = []
  const seen = new Set<string>()
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const id = jobIdFromUrl(m[1])
    if (!id || seen.has(id)) continue
    seen.add(id)
    const title = strip(m[2])
    const context = strip(html.slice(Math.max(0, m.index - 220), re.lastIndex + 420))
    out.push({ jobId: id, title, context })
  }
  return out
}

// Validate an LLM-returned jobId: must be all-digits and present in the ground-truth set from the
// same email. Returns the clean id or null. Prevents a hallucinated/misread id from being stored.
export function validateJobId(candidate: unknown, groundTruth: string[]): string | null {
  if (candidate == null) return null
  const s = String(candidate).replace(/[^0-9]/g, '')
  if (!s) return null
  return groundTruth.includes(s) ? s : null
}

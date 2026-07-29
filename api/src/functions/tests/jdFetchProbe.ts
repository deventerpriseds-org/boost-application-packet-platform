import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'
import { scraperFetch, scraperConfigured, extractGuestJdHtml } from './scraperProxy'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

// GET /api/mail/jd-probe?jobId=NNN[&via=proxy|direct] — DIAGNOSTIC (ACT-22a). Fetches a LinkedIn
// job description from the public guest endpoint, from the Function's egress — directly OR through
// the configured managed scraping API (SCRAPER_API_PROVIDER/KEY). Reports the transport used, HTTP
// status, byte size, and the extracted JD-description length + snippet, so we can verify a proxy
// key returns the real JD before wiring the real jd-fetch. Read-only, guarded. Safe to remove after.
export async function jdProbe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const jobId = (req.query.get('jobId') || '').replace(/[^0-9]/g, '')
  if (!jobId) return { status: 400, headers: HEADERS, jsonBody: { error: 'jobId required (digits only)' } }
  const via = req.query.get('via') === 'direct' ? 'direct' : req.query.get('via') === 'proxy' ? 'proxy' : undefined
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`
  const r = await scraperFetch(url, via ? { force: via } : {})
  const jd = extractGuestJdHtml(r.body)
  return {
    status: 200, headers: HEADERS,
    jsonBody: {
      ok: r.ok, httpStatus: r.status, jobId,
      transport: r.via, provider: r.provider || null, proxyConfigured: scraperConfigured(),
      bytes: r.body.length,
      jdDescriptionFound: jd.descriptionHtml != null, jdTextLen: jd.textLen,
      snippet: (jd.descriptionHtml || r.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      error: r.error,
    },
  }
}

app.http('jdProbe', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-probe', handler: jdProbe })

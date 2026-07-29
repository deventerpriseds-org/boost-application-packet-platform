import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'
import { scraperFetch, scraperConfigured, extractGuestJdHtml, classifyResponse } from './scraperProxy'
import { logJdFetch } from './jdFetchLog'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

// GET /api/mail/jd-probe?jobId=NNN[&via=proxy|direct][&provider=scraperapi|scrapedo|...] — DIAGNOSTIC
// (ACT-22a). Fetches a LinkedIn job description from the public guest endpoint, from the Function's
// egress — directly OR through a selected managed scraping API. Reports transport, HTTP status, byte
// size, extracted JD length + snippet, latency, outcome classification, and proxy usage headers, and
// records the attempt to jd_fetch_log so we can characterize LinkedIn's undocumented rate limits.
// `provider` overrides the configured default so we can test scrape.do while ScraperAPI stays default.
export async function jdProbe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const jobId = (req.query.get('jobId') || '').replace(/[^0-9]/g, '')
  if (!jobId) return { status: 400, headers: HEADERS, jsonBody: { error: 'jobId required (digits only)' } }
  const via = req.query.get('via') === 'direct' ? 'direct' : req.query.get('via') === 'proxy' ? 'proxy' : undefined
  const provider = (req.query.get('provider') || '').trim().toLowerCase() || undefined
  const runTag = req.query.get('runTag') || 'probe'
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`

  const r = await scraperFetch(url, { ...(via ? { force: via } : {}), ...(provider ? { provider } : {}) })
  const jd = extractGuestJdHtml(r.body)
  const outcome = classifyResponse(r.status, r.body, jd.descriptionHtml != null)

  await logJdFetch({
    jobId, provider: r.provider || 'direct', via: r.via, httpStatus: r.status, outcome,
    jdTextLen: jd.textLen, bytes: r.body.length, latencyMs: r.latencyMs, runTag,
    usage: r.usage, error: r.error,
  })

  return {
    status: 200, headers: HEADERS,
    jsonBody: {
      ok: r.ok, httpStatus: r.status, jobId, outcome,
      transport: r.via, provider: r.provider || null, proxyConfigured: scraperConfigured(provider),
      bytes: r.body.length, latencyMs: r.latencyMs, usage: r.usage || null,
      jdDescriptionFound: jd.descriptionHtml != null, jdTextLen: jd.textLen,
      snippet: (jd.descriptionHtml || r.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      error: r.error,
    },
  }
}

app.http('jdProbe', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-probe', handler: jdProbe })

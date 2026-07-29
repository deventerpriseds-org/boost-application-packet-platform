import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireWrite } from './appSession'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UAT-Token, Authorization',
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

// GET /api/mail/jd-probe?jobId=NNN — DIAGNOSTIC (ACT-22a). Fetches a LinkedIn job description
// from the public guest endpoint, FROM THE FUNCTION'S OWN EGRESS IP, to confirm reachability
// before building the real jd-fetch pipeline. Returns HTTP status + byte size + a text snippet
// so we can see whether Azure's datacenter IP gets the real JD (200 + large body) or is blocked
// (403/429/challenge). Read-only, guarded by requireWrite. Safe to remove after confirmation.
export async function jdProbe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const jobId = (req.query.get('jobId') || '').replace(/[^0-9]/g, '')
  if (!jobId) return { status: 400, headers: HEADERS, jsonBody: { error: 'jobId required (digits only)' } }
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' } })
    const html = await res.text()
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      status: 200, headers: HEADERS,
      jsonBody: { ok: res.ok, httpStatus: res.status, bytes: html.length, jobId, snippet: text.slice(0, 500) },
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, jobId, error: String(err) } }
  }
}

app.http('jdProbe', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'mail/jd-probe', handler: jdProbe })

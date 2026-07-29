// Provider-agnostic managed-scraping-API layer (ACT-22a). Routes an outbound fetch through a
// residential/anti-bot scraping API so LinkedIn never sees our Azure datacenter IP (which its WAF
// flags within tens of requests). Config via env (synced from GitHub secrets by api-deploy.yml):
//   SCRAPER_API_PROVIDER = 'scrapedo' | 'firecrawl' | 'scraperapi' | 'scrapfly' | 'scrapingbee' | ''
//   SCRAPER_API_KEY      = ScraperAPI key   (NOTE: trial can't scrape LinkedIn — paid-domain 403)
//   SCRAPE_DO_API_KEY    = scrape.do key    (super proxy — PROVEN working on LinkedIn)
//   FIRECRAWL_API_KEY    = Firecrawl key    (stealth proxy — second pool to spread credit spend)
// Strategy: spread load across providers so no single free tier's monthly credits are exhausted —
// one provider for the high-volume backfill, another for the daily grab. Provider is selectable per
// request (probe/experiment) so we can compare + measure LinkedIn's undocumented limits per pool.
//
// Response shape differs by vendor: scrapfly returns {result:{content,status_code}}; firecrawl POSTs
// and returns {data:{html,metadata:{statusCode}}}; scraperapi/scrapedo/scrapingbee return raw HTML.
// scraperFetch normalizes all of them to raw target HTML + the target's own status code.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

export type Provider = 'scraperapi' | 'scrapedo' | 'firecrawl' | 'scrapfly' | 'scrapingbee'

// Per-provider key resolution — providers coexist so we can spread credit spend across pools.
function providerKey(provider: string): string {
  switch (provider) {
    case 'scrapedo':  return process.env.SCRAPE_DO_API_KEY || ''
    case 'firecrawl': return process.env.FIRECRAWL_API_KEY || ''
    default:          return process.env.SCRAPER_API_KEY || ''
  }
}

function activeProvider(): string {
  return (process.env.SCRAPER_API_PROVIDER || '').trim().toLowerCase()
}

export function scraperConfigured(provider?: string): boolean {
  const p = (provider || activeProvider()).trim().toLowerCase()
  return !!(p && providerKey(p))
}

// Wrap a target URL into the given (or configured) provider's request URL. Anti-bot/residential is
// on for hard targets (LinkedIn). Returns null when no provider/key resolves (caller does direct).
export function buildProxyUrl(targetUrl: string, providerOverride?: string, saTier?: string, opts: { sdSuper?: boolean } = {}): string | null {
  const provider = (providerOverride || activeProvider()).trim().toLowerCase()
  const key = providerKey(provider)
  if (!key || !provider) return null
  const enc = encodeURIComponent(targetUrl)
  switch (provider) {
    case 'scraperapi': {
      // https://docs.scraperapi.com — ultra_premium=true is ScraperAPI's advanced anti-bot bypass
      // (residential + fingerprint), the equivalent of Scrapfly's asp. Required for LinkedIn.
      // NOTE: ultra_premium bills ~10× credits vs premium. Rotates residential IP per request.
      // saTier lets us probe premium-only / plain to test whether LinkedIn's block is domain-level.
      const tier = (saTier || 'ultra').toLowerCase()
      const flag = tier === 'plain' ? '' : tier === 'premium' ? '&premium=true' : '&ultra_premium=true'
      return `https://api.scraperapi.com/?api_key=${key}&url=${enc}${flag}&country_code=us`
    }
    case 'scrapedo': {
      // https://scrape.do/documentation — super=true → residential/mobile "super proxy" (many credits)
      // for hard targets; the public guest JD endpoint may work on a cheap datacenter proxy (~1 credit),
      // so sdSuper is toggleable to find the cheapest mode that still returns the JD. geoCode=us.
      const superFlag = opts.sdSuper === false ? '' : '&super=true'
      return `https://api.scrape.do/?token=${key}&url=${enc}${superFlag}&geoCode=us`
    }
    case 'scrapfly':
      // https://scrapfly.io/docs — asp=true → anti-scraping-protection (residential + fingerprint).
      // Returns a JSON envelope {result:{content,status_code}} — scraperFetch unwraps it.
      return `https://api.scrapfly.io/scrape?key=${key}&url=${enc}&asp=true&country=us&render_js=false`
    case 'scrapingbee':
      // https://scrapingbee.com/documentation — premium_proxy=true (residential), no JS render.
      return `https://app.scrapingbee.com/api/v1/?api_key=${key}&url=${enc}&premium_proxy=true&render_js=false&country_code=us`
    default:
      return null
  }
}

// Empirical-limit classification: a 200 can still be a LinkedIn block/challenge page, so status
// alone lies. Classify the actual body so a block never masquerades as success in the volume log.
// NOTE: 'blocked' means a RATE-LIMIT/anti-bot wall (429/999/challenge) — the only thing that should
// stop a sweep. 'auth_required' (401/403) is a PER-JOB condition (job not visible on the guest
// endpoint), a skip, NOT a rate signal — it must not halt the sweep. 'not_found' (404) is also a skip.
export type Outcome = 'ok_jd' | 'blocked' | 'auth_required' | 'login_wall' | 'not_found' | 'proxy_error' | 'empty'
export function classifyResponse(status: number, body: string, jdFound: boolean): Outcome {
  if (status === 0) return 'proxy_error'
  if (status === 404) return 'not_found'
  if (status === 401 || status === 403) return 'auth_required'    // per-job: not guest-accessible (skip, not a block)
  if (status === 429 || status === 999) return 'blocked'         // 999 = LinkedIn's signature throttle code
  const low = body.slice(0, 4000).toLowerCase()
  if (jdFound) return 'ok_jd'
  if (!body) return 'empty'
  if (/authwall|please sign in|join linkedin|sign in to|<title>[^<]*log ?in/i.test(low)) return 'login_wall'
  if (/captcha|unusual traffic|challenge|access to this page has been denied|rate limit|too many requests/i.test(low)) return 'blocked'
  if (status >= 500) return 'proxy_error'
  return status >= 200 && status < 300 ? 'empty' : 'blocked'
}

export interface FetchResult {
  ok: boolean; status: number; body: string; via: 'proxy' | 'direct'; provider?: string
  latencyMs: number; error?: string
  usage?: Record<string, string>   // scraping-API usage/concurrency headers (LinkedIn-wall vs proxy-wall)
}

// Firecrawl POST /v1/scrape → {success, data:{html, metadata:{statusCode}}}. proxy:'stealth' is the
// anti-bot mode needed for hard targets like LinkedIn (costs more credits than a basic scrape).
async function firecrawlFetch(targetUrl: string): Promise<FetchResult> {
  const key = providerKey('firecrawl')
  const started = Date.now()
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url: targetUrl, formats: ['html'], onlyMainContent: false, proxy: 'stealth', timeout: 30000 }),
    })
    const raw = await res.text()
    let body = raw, status = res.status, ok = res.ok
    try {
      const j = JSON.parse(raw)
      if (j && j.data && typeof j.data.html === 'string') {
        body = j.data.html
        const sc = j.data.metadata?.statusCode
        if (typeof sc === 'number') { status = sc; ok = sc >= 200 && sc < 300 }
      } else if (j && j.success === false) {
        ok = false; body = j.error ? String(j.error) : raw
      }
    } catch { /* not JSON — leave raw so the caller sees the error */ }
    const usage: Record<string, string> = {}
    for (const h of ['x-ratelimit-remaining', 'x-credits-remaining', 'x-ratelimit-limit']) {
      const v = res.headers.get(h); if (v) usage[h] = v
    }
    return { ok, status, body, via: 'proxy', provider: 'firecrawl', latencyMs: Date.now() - started, usage: Object.keys(usage).length ? usage : undefined }
  } catch (err) {
    return { ok: false, status: 0, body: '', via: 'proxy', provider: 'firecrawl', latencyMs: Date.now() - started, error: String(err) }
  }
}

// Fetch `targetUrl`, through the given/configured scraping API when available (unless force==='direct'),
// else directly with a browser UA. Never throws — returns a structured result with latency + usage.
export async function scraperFetch(
  targetUrl: string,
  opts: { force?: 'proxy' | 'direct'; provider?: string; saTier?: string; sdSuper?: boolean } = {},
): Promise<FetchResult> {
  const provider = (opts.provider || activeProvider()).trim().toLowerCase()
  // Firecrawl is a POST + JSON-body API (unlike the GET-URL providers) — handle it separately.
  if (opts.force !== 'direct' && provider === 'firecrawl' && providerKey('firecrawl')) {
    return firecrawlFetch(targetUrl)
  }
  const proxyUrl = opts.force === 'direct' ? null : buildProxyUrl(targetUrl, provider, opts.saTier, { sdSuper: opts.sdSuper })
  const url = proxyUrl || targetUrl
  const via: 'proxy' | 'direct' = proxyUrl ? 'proxy' : 'direct'
  const started = Date.now()
  try {
    // The scraping API injects its own residential UA/headers; for a direct call we send a browser UA.
    const headers: Record<string, string> = via === 'direct'
      ? { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' }
      : {}
    const res = await fetch(url, { headers })
    let body = await res.text()
    let status = res.status
    let ok = res.ok
    // Scrapfly wraps the page in a JSON envelope — unwrap to raw HTML + the target's own status.
    if (via === 'proxy' && provider === 'scrapfly') {
      try {
        const j = JSON.parse(body)
        if (j && j.result && typeof j.result.content === 'string') {
          body = j.result.content
          if (typeof j.result.status_code === 'number') { status = j.result.status_code; ok = status >= 200 && status < 300 }
        }
      } catch { /* not JSON — leave body so the caller sees the raw error */ }
    }
    // Capture proxy usage/concurrency headers so we can tell a LinkedIn wall from a proxy-side wall.
    const usage: Record<string, string> = {}
    for (const h of ['sa-credit-cost', 'sa-final-status-code', 'concurrent-requests', 'x-request-cost',
                     'x-remaining-credits', 'x-scrapfly-remaining-scrape', 'x-scrapedo-cost', 'remaining']) {
      const v = res.headers.get(h); if (v) usage[h] = v
    }
    return { ok, status, body, via, provider: via === 'proxy' ? provider : undefined, latencyMs: Date.now() - started, usage: Object.keys(usage).length ? usage : undefined }
  } catch (err) {
    return { ok: false, status: 0, body: '', via, provider: via === 'proxy' ? provider : undefined, latencyMs: Date.now() - started, error: String(err) }
  }
}

// Extract the LinkedIn guest-endpoint JD description block (div.show-more-less-html__markup),
// preserving inner HTML (bullets/bold). Falls back to whole-page tag-stripped text if absent.
export function extractGuestJdHtml(html: string): { descriptionHtml: string | null; textLen: number } {
  const m = html.match(/<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  if (m) return { descriptionHtml: m[1].trim(), textLen: m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length }
  return { descriptionHtml: null, textLen: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length }
}

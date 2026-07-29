// Provider-agnostic managed-scraping-API layer (ACT-22a). Routes an outbound fetch through a
// residential/anti-bot scraping API so LinkedIn never sees our Azure datacenter IP (which its WAF
// flags within tens of requests). Config via env (synced from GitHub secrets by api-deploy.yml):
//   SCRAPER_API_PROVIDER = 'scraperapi' | 'scrapedo' | 'scrapfly' | 'scrapingbee' | '' (empty = direct)
//   SCRAPER_API_KEY      = ScraperAPI key (backfill provider — ultra_premium, LinkedIn-grade)
//   SCRAPE_DO_API_KEY    = scrape.do key (daily-grab provider — super proxy)
// Strategy: ScraperAPI (trial credits, multi-thread) for the one-time backfill AND to empirically
// characterize LinkedIn's undocumented guest-endpoint limits under residential-IP rotation; then
// scrape.do for the low-volume daily grab. Provider is selectable per request (probe/experiment).
//
// Response shape differs by vendor: scrapfly returns a JSON envelope {result:{content,status_code}};
// scraperapi / scrapedo / scrapingbee return the raw target HTML. scraperFetch normalizes to raw HTML.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

export type Provider = 'scraperapi' | 'scrapedo' | 'scrapfly' | 'scrapingbee'

// Per-provider key resolution — providers can coexist (ScraperAPI for backfill, scrape.do for daily).
function providerKey(provider: string): string {
  switch (provider) {
    case 'scrapedo': return process.env.SCRAPE_DO_API_KEY || ''
    default:         return process.env.SCRAPER_API_KEY || ''
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
export function buildProxyUrl(targetUrl: string, providerOverride?: string): string | null {
  const provider = (providerOverride || activeProvider()).trim().toLowerCase()
  const key = providerKey(provider)
  if (!key || !provider) return null
  const enc = encodeURIComponent(targetUrl)
  switch (provider) {
    case 'scraperapi':
      // https://docs.scraperapi.com — ultra_premium=true is ScraperAPI's advanced anti-bot bypass
      // (residential + fingerprint), the equivalent of Scrapfly's asp. Required for LinkedIn.
      // NOTE: ultra_premium bills ~10× credits vs premium. Rotates residential IP per request.
      return `https://api.scraperapi.com/?api_key=${key}&url=${enc}&ultra_premium=true&country_code=us`
    case 'scrapedo':
      // https://scrape.do/documentation — super=true → residential/mobile "super proxy" for hard
      // targets; geoCode=us. Returns raw target HTML. Daily-grab provider (permanent-usable tier).
      return `https://api.scrape.do/?token=${key}&url=${enc}&super=true&geoCode=us`
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
export type Outcome = 'ok_jd' | 'blocked' | 'login_wall' | 'not_found' | 'proxy_error' | 'empty'
export function classifyResponse(status: number, body: string, jdFound: boolean): Outcome {
  if (status === 0) return 'proxy_error'
  if (status === 404) return 'not_found'
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

// Fetch `targetUrl`, through the given/configured scraping API when available (unless force==='direct'),
// else directly with a browser UA. Never throws — returns a structured result with latency + usage.
export async function scraperFetch(
  targetUrl: string,
  opts: { force?: 'proxy' | 'direct'; provider?: string } = {},
): Promise<FetchResult> {
  const provider = (opts.provider || activeProvider()).trim().toLowerCase()
  const proxyUrl = opts.force === 'direct' ? null : buildProxyUrl(targetUrl, provider)
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

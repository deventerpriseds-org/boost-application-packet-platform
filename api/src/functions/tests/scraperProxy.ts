// Provider-agnostic managed-scraping-API layer (ACT-22a). Routes an outbound fetch through a
// residential/anti-bot scraping API so LinkedIn never sees our Azure datacenter IP (which its WAF
// flags within tens of requests). Config via env (synced from GitHub secrets by api-deploy.yml):
//   SCRAPER_API_PROVIDER = 'scraperapi' | 'scrapingbee' | '' (empty/none = direct fetch)
//   SCRAPER_API_KEY      = the provider key
// Not locked to one vendor: add a case to buildProxyUrl to support another.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

export function scraperConfigured(): boolean {
  return !!(process.env.SCRAPER_API_KEY && (process.env.SCRAPER_API_PROVIDER || '').trim())
}

// Wrap a target URL into the configured provider's request URL. `premium`/residential is on for
// hard targets (LinkedIn). Returns null when no provider is configured (caller does a direct fetch).
export function buildProxyUrl(targetUrl: string): string | null {
  const provider = (process.env.SCRAPER_API_PROVIDER || '').trim().toLowerCase()
  const key = process.env.SCRAPER_API_KEY || ''
  if (!key || !provider) return null
  const enc = encodeURIComponent(targetUrl)
  switch (provider) {
    case 'scraperapi':
      // https://docs.scraperapi.com — premium=true → residential pool for hard sites
      return `https://api.scraperapi.com/?api_key=${key}&url=${enc}&premium=true&country_code=us`
    case 'scrapingbee':
      // https://scrapingbee.com/documentation — premium_proxy=true (residential), no JS render needed
      return `https://app.scrapingbee.com/api/v1/?api_key=${key}&url=${enc}&premium_proxy=true&render_js=false&country_code=us`
    default:
      return null
  }
}

export interface FetchResult { ok: boolean; status: number; body: string; via: 'proxy' | 'direct'; provider?: string; error?: string }

// Fetch `targetUrl`, through the configured scraping API when available (unless force==='direct'),
// else directly with a browser UA. Never throws — returns a structured result.
export async function scraperFetch(targetUrl: string, opts: { force?: 'proxy' | 'direct' } = {}): Promise<FetchResult> {
  const provider = (process.env.SCRAPER_API_PROVIDER || '').trim().toLowerCase()
  const proxyUrl = opts.force === 'direct' ? null : buildProxyUrl(targetUrl)
  const url = proxyUrl || targetUrl
  const via: 'proxy' | 'direct' = proxyUrl ? 'proxy' : 'direct'
  try {
    // The scraping API injects its own residential UA/headers; for a direct call we send a browser UA.
    const headers: Record<string, string> = via === 'direct'
      ? { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' }
      : {}
    const res = await fetch(url, { headers })
    const body = await res.text()
    return { ok: res.ok, status: res.status, body, via, provider: via === 'proxy' ? provider : undefined }
  } catch (err) {
    return { ok: false, status: 0, body: '', via, provider: via === 'proxy' ? provider : undefined, error: String(err) }
  }
}

// Extract the LinkedIn guest-endpoint JD description block (div.show-more-less-html__markup),
// preserving inner HTML (bullets/bold). Falls back to whole-page tag-stripped text if absent.
export function extractGuestJdHtml(html: string): { descriptionHtml: string | null; textLen: number } {
  const m = html.match(/<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  if (m) return { descriptionHtml: m[1].trim(), textLen: m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length }
  return { descriptionHtml: null, textLen: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length }
}

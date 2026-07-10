// Tavily live web-search — boost/Azure Functions port of the huddle helper.
// Reads TAVILY_API_KEY at call time. Never throws; returns a structured result.

export const TAVILY_WEB_SEARCH_TOOL = {
  type: 'function' as const,
  name: 'tavily_web_search',
  description:
    "Search the live web for current information, news, facts, or recent events (company research, hiring-manager background, comp benchmarks, market data). Use when the user asks about anything time-sensitive, real-world, or outside your training. Pass the query VERBATIM — do not rewrite 'today', 'latest', or 'current' into fixed dates.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Verbatim search query. Do not paraphrase.' },
      topic: { type: 'string', enum: ['general', 'news', 'finance'] },
      search_depth: { type: 'string', enum: ['basic', 'advanced'] },
      time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
      max_results: { type: 'number' },
    },
    required: ['query'],
  },
  strict: false,
}

export interface TavilyArgs {
  query: string
  topic?: 'general' | 'news' | 'finance'
  search_depth?: 'basic' | 'advanced'
  time_range?: 'day' | 'week' | 'month' | 'year'
  max_results?: number
}

export interface TavilyResult { title: string; url: string; content: string; score: number; published_date?: string }
export interface TavilyResponse { success: boolean; answer: string; sources: string[]; results?: TavilyResult[]; query: string; error?: string }

// Deterministic guard against the model's training-cutoff bias: LLMs routinely
// staple an obsolete year onto a query ("Stripe product launches October 2023"),
// which — combined with a relative time_range — makes Tavily return nothing. We
// strip any 4-digit year strictly older than the current year, regardless of how
// the question was phrased. This fixes the root cause server-side (not via prompt
// compliance): a stale year can never reach the search API. A year the user
// genuinely named that is current/future is preserved.
export function sanitizeTavilyQuery(query: string, nowYear: number): string {
  const cleaned = query.replace(/\b(19|20)\d{2}\b/g, (m) => (Number(m) < nowYear ? '' : m))
  return cleaned.replace(/\s{2,}/g, ' ').trim() || query
}

export async function tavilySearch(args: TavilyArgs): Promise<TavilyResponse> {
  const query = sanitizeTavilyQuery(String(args.query || ''), new Date().getUTCFullYear())
  const key = (process.env.TAVILY_API_KEY ?? '').trim()
  if (!key) return { success: false, answer: 'Web search is not configured (TAVILY_API_KEY missing).', sources: [], query, error: 'TAVILY_API_KEY not configured' }

  const body: Record<string, unknown> = {
    query,
    topic: args.topic || 'general',
    search_depth: args.search_depth || 'advanced',
    max_results: Math.min(Math.max(args.max_results || 8, 1), 20),
    include_answer: 'advanced',
    include_raw_content: false,
  }
  if (args.time_range) body.time_range = args.time_range

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { success: false, answer: "I couldn't search right now.", sources: [], query, error: `Tavily ${res.status}: ${text.slice(0, 200)}` }
    }
    const data = (await res.json()) as { answer?: string; results?: TavilyResult[] }
    const results = (data.results || []).map((r) => ({ title: r.title, url: r.url, content: (r.content || '').slice(0, 600), score: r.score, published_date: r.published_date }))
    return { success: true, answer: data.answer || 'No results found.', sources: results.map((r) => r.url), results, query }
  } catch (err) {
    return { success: false, answer: 'Web search error.', sources: [], query, error: err instanceof Error ? err.message : String(err) }
  }
}

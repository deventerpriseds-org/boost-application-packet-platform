import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions'
import { resolveOwner, requireWrite, serverError } from './appSession'
import { getPgClient } from './pgClient'
import { logUsage } from './usageMeter'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Ensure the 5 JD columns and raw_jd exist on the opportunity table.
async function ensureJdColumns(client: any) {
  await client.query(`
    alter table opportunity
      add column if not exists raw_jd         text,
      add column if not exists jd_title       text,
      add column if not exists jd_company     text,
      add column if not exists jd_summary     text,
      add column if not exists jd_requirements text,
      add column if not exists jd_table       text
  `)
}

// Extract URL from why_surfaced ("New Email alert · https://...")
function extractUrl(whySurfaced: string): string | null {
  const m = whySurfaced?.match(/https?:\/\/[^\s]+/)
  return m ? m[0] : null
}

// Fetch page text from a URL. Returns null on failure.
async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ExecutiveEngine/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    // Strip tags, collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text.slice(0, 12000)
  } catch {
    return null
  }
}

const JD_SYSTEM = `You are an executive recruiting analyst. Given job description text, extract and return ONLY JSON with these exact keys:
{
  "jdTitle": "verbatim job title from the JD",
  "jdCompany": "verbatim hiring company name from the JD",
  "jdSummary": "A comprehensive paragraph (150-200 words) summarizing the role: what the company does, what this leader will own, key responsibilities, required experience, and must-have skills.",
  "jdRequirements": "<ul><li>...all responsibilities, requirements, and skills as separate bullet items...</li></ul>",
  "jdTable": "<table><thead><tr><th>Category</th><th>Item</th><th>ATS Keyword</th></tr></thead><tbody>...one row per requirement, Category is one of: responsibilities/experience/requirements/skills, ATS Keyword is ≤25 chars...</tbody></table>"
}
Return ONLY valid JSON. No markdown fences.`

async function runJdParse(rawJd: string, key: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: JD_SYSTEM },
        { role: 'user', content: `Job description:\n\n${rawJd.slice(0, 12000)}` },
      ],
      max_tokens: 3000,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const data = await res.json() as any
  await logUsage('opportunity:jd-parse', 'gpt-4o-mini', data.usage)
  let parsed: any = {}
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch {}
  return parsed
}

// POST /api/app/opportunity/{id}/jd-parse
// Parses raw_jd (or fetches from why_surfaced URL) and stores 5 JD fields.
export async function jdParse(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const oppId = req.params.id
  const key = process.env.OPENAI_API_KEY
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()
    await ensureJdColumns(client)
    const opp = (await client.query(
      `select id, company, role, raw_jd, why_surfaced from opportunity where id = $1`, [oppId]
    )).rows[0]
    if (!opp) return { status: 404, headers: HEADERS, jsonBody: { error: 'not found' } }

    let rawJd: string = opp.raw_jd || ''

    // If no raw_jd stored, try to fetch from URL in why_surfaced
    if (!rawJd) {
      const url = extractUrl(opp.why_surfaced || '')
      if (url) {
        context.log(`jd-parse: fetching ${url}`)
        rawJd = await fetchPageText(url) || ''
        if (rawJd) {
          await client.query(`update opportunity set raw_jd = $1 where id = $2`, [rawJd, oppId])
        }
      }
    }

    // Fall back to using what we know about the role
    if (!rawJd) {
      rawJd = `Role: ${opp.role}\nCompany: ${opp.company}\nContext: ${opp.why_surfaced || ''}`
    }

    const parsed = await runJdParse(rawJd, key)
    await client.query(
      `update opportunity set
        jd_title = $1, jd_company = $2, jd_summary = $3,
        jd_requirements = $4, jd_table = $5, updated_at = now()
       where id = $6`,
      [parsed.jdTitle || null, parsed.jdCompany || null, parsed.jdSummary || null,
       parsed.jdRequirements || null, parsed.jdTable || null, oppId]
    )
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, oppId, jdTitle: parsed.jdTitle, jdCompany: parsed.jdCompany } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// POST /api/app/opportunities/jd-backfill?owner=&days=7
// Runs jd-parse on all opps in the past N days that lack jd_summary.
export async function jdBackfill(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const key = process.env.OPENAI_API_KEY
  const { owner } = resolveOwner(req)
  const days = parseInt(req.query.get('days') || '7', 10)
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    if (!key) return { status: 200, headers: HEADERS, jsonBody: { error: 'OPENAI_API_KEY not set' } }
    client = await getPgClient()
    await ensureJdColumns(client)

    const { rows } = await client.query(
      `select id, company, role, raw_jd, why_surfaced from opportunity
       where owner_email = $1
         and not dismissed
         and jd_summary is null
         and created_at >= now() - ($2 || ' days')::interval
       order by created_at desc`,
      [owner, String(days)]
    )
    context.log(`jd-backfill: ${rows.length} opps to process for ${owner}`)

    const results: any[] = []
    for (const opp of rows) {
      try {
        let rawJd: string = opp.raw_jd || ''

        if (!rawJd) {
          const url = extractUrl(opp.why_surfaced || '')
          if (url) {
            rawJd = await fetchPageText(url) || ''
            if (rawJd) {
              await client.query(`update opportunity set raw_jd = $1 where id = $2`, [rawJd, opp.id])
            }
          }
        }

        if (!rawJd) {
          rawJd = `Role: ${opp.role}\nCompany: ${opp.company}\nContext: ${opp.why_surfaced || ''}`
        }

        const parsed = await runJdParse(rawJd, key)
        await client.query(
          `update opportunity set
            jd_title = $1, jd_company = $2, jd_summary = $3,
            jd_requirements = $4, jd_table = $5, updated_at = now()
           where id = $6`,
          [parsed.jdTitle || null, parsed.jdCompany || null, parsed.jdSummary || null,
           parsed.jdRequirements || null, parsed.jdTable || null, opp.id]
        )
        results.push({ id: opp.id, company: opp.company, role: opp.role, ok: true, jdTitle: parsed.jdTitle })
        context.log(`jd-backfill: done ${opp.company} / ${opp.role}`)
      } catch (err) {
        results.push({ id: opp.id, company: opp.company, role: opp.role, ok: false, error: String(err) })
        context.log(`jd-backfill: error ${opp.id}: ${err}`)
      }
    }

    const ok = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok).length
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, total: rows.length, succeeded: ok, failed, results } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('jdParse', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunity/{id}/jd-parse', handler: jdParse })
app.http('jdBackfill', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunities/jd-backfill', handler: jdBackfill })

// GET /api/app/opportunities/jd-status
// Returns a count of parsed vs unparsed opps across all non-demo, non-dismissed owners.
export async function jdStatus(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    client = await getPgClient()
    const r = await client.query(`
      select
        count(*) filter (where not is_demo and not dismissed)                         as total,
        count(*) filter (where not is_demo and not dismissed and jd_summary is not null) as parsed,
        count(*) filter (where not is_demo and not dismissed and jd_summary is null)    as pending,
        count(*) filter (where not is_demo and not dismissed and raw_jd is not null and jd_summary is null) as has_raw_jd,
        count(*) filter (where not is_demo and not dismissed and raw_jd is null and jd_summary is null)     as no_source
      from opportunity
    `)
    const row = r.rows[0]
    return { status: 200, headers: HEADERS, jsonBody: {
      total: Number(row.total), parsed: Number(row.parsed), pending: Number(row.pending),
      hasRawJd: Number(row.has_raw_jd), noSource: Number(row.no_source),
      pct: row.total > 0 ? Math.round((Number(row.parsed) / Number(row.total)) * 100) : 0,
    }}
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

// Timer: fire every 5 minutes, pick up to 10 opps missing jd_summary, parse them.
// Works through the backlog automatically; skips opps with no source gracefully.
export async function jdParseTick(timer: Timer, context: InvocationContext): Promise<void> {
  const key = process.env.OPENAI_API_KEY
  if (!key) { context.log('jd-tick: no OPENAI_API_KEY, skipping'); return }
  let client
  try {
    client = await getPgClient()
    await ensureJdColumns(client)
    const { rows } = await client.query(`
      select id, company, role, raw_jd, why_surfaced, owner_email
      from opportunity
      where not dismissed and not is_demo and jd_summary is null
      order by created_at desc
      limit 10
    `)
    if (rows.length === 0) { context.log('jd-tick: backlog clear'); return }
    context.log(`jd-tick: processing ${rows.length} opps`)
    let ok = 0, failed = 0
    for (const opp of rows) {
      try {
        let rawJd: string = opp.raw_jd || ''
        if (!rawJd) {
          const url = extractUrl(opp.why_surfaced || '')
          if (url) {
            rawJd = await fetchPageText(url) || ''
            if (rawJd) await client.query(`update opportunity set raw_jd = $1 where id = $2`, [rawJd, opp.id])
          }
        }
        if (!rawJd) rawJd = `Role: ${opp.role}\nCompany: ${opp.company}\nContext: ${opp.why_surfaced || ''}`
        const parsed = await runJdParse(rawJd, key)
        await client.query(
          `update opportunity set jd_title=$1, jd_company=$2, jd_summary=$3, jd_requirements=$4, jd_table=$5, updated_at=now() where id=$6`,
          [parsed.jdTitle || null, parsed.jdCompany || null, parsed.jdSummary || null, parsed.jdRequirements || null, parsed.jdTable || null, opp.id]
        )
        context.log(`jd-tick: ok ${opp.company} / ${opp.role}`)
        ok++
      } catch (err) {
        context.log(`jd-tick: error ${opp.id}: ${err}`)
        // Mark as attempted so we don't retry indefinitely on a broken record.
        // Set jd_summary to a sentinel that signals failure without blocking the status count.
        await client.query(`update opportunity set jd_summary='[parse-failed]' where id=$1`, [opp.id]).catch(() => {})
        failed++
      }
    }
    context.log(`jd-tick: done — ok=${ok} failed=${failed}`)
  } catch (err) {
    context.log(`jd-tick: fatal ${err}`)
  } finally { try { await client?.end() } catch {} }
}

app.http('jdStatus', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/opportunities/jd-status', handler: jdStatus })
app.timer('jdParseTick', { schedule: '0 */5 * * * *', handler: jdParseTick })

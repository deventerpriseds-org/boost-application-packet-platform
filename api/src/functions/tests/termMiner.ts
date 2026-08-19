// Corpus term miner — the EXTRACTION half of the term library.
//
// Mines n-grams from real job postings (`opportunity.jd_real`) and records them as CANDIDATES for
// human curation. Every candidate is a literal substring of a real posting with a countable document
// frequency, so this is extraction, not generation — which is what lets it satisfy the spec's
// "terms must not be model-generated" rule while supplying the executive vocabulary O*NET does not
// carry (measured on this corpus: roadmap 626, board 480, budget 416, operating model 222,
// digital transformation 153, P&L 83, M&A 66, due diligence 56 — none of which O*NET lists).
//
// Nothing here scores anything. Candidates only become scoreable after a human approves them into a
// published term_library version.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { groundingText, decodeEntities } from './jdText'
import { termNormalize } from './termMatch'

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }

// Function words and posting boilerplate. A term is a thing an employer ASKS FOR; these are the
// scaffolding around it. Kept as data so it can move to a settings store later (no-hardcoded-config).
const STOP = new Set(('a an the and or but if then else of in on at to for with without by from as is are was were be been being ' +
  'this that these those it its we you they our your their he she his her them us i me my ' +
  'will would can could should may might must shall do does did done have has had having ' +
  'not no nor so than such very more most other some any each all both few many much ' +
  'who whom whose which what when where why how there here about into over under again further ' +
  'across within while during before after above below between through per via up down out off ' +
  'you will role position job company team work working works role candidate applicant opportunity ' +
  'years year experience experienced ability able strong excellent proven demonstrated track record ' +
  'plus preferred required requirement requirements responsibilities responsibility qualifications ' +
  'skills skill knowledge understanding familiarity including include includes etc e g i e ' +
  'equal opportunity employer diversity inclusion benefits salary range compensation apply application ' +
  'please contact resume cv email us llc inc ltd corp company companies business businesses ' +
  'new great good best highly well also may must able').split(/\s+/))

// A token is "noise" as a PHRASE EDGE if it is a function word or a bare number. Length is
// deliberately NOT part of this test: `P&L` normalizes to `p and l`, whose first and last tokens are
// single characters, and a length rule silently discards the single highest-value exec term in the
// corpus (83 postings). Short tokens are only rejected as standalone 1-grams, below.
const isNoise = (tok: string) => !tok || STOP.has(tok) || /^\d+$/.test(tok)

/** n-grams (1..maxN) from one posting, deduped WITHIN the posting so df counts documents not hits. */
export function ngramsForDoc(text: string, maxN = 4): Set<string> {
  const out = new Set<string>()
  // DECODE BEFORE SPLITTING. `&amp;` contains a semicolon, so splitting on clause punctuation first
  // tears the entity in half and yields junk tokens like `amp` while destroying the term itself.
  // Callers normally pass groundingText() output (already decoded); this makes the function safe
  // either way, because getting this order wrong silently loses P&L, M&A and R&D.
  const decoded = decodeEntities(text || '')
  // Sentence-ish segmentation so n-grams never span a bullet/clause boundary and invent a phrase.
  for (const seg of decoded.split(/[.;:!?\n•·|]+/)) {
    const toks = termNormalize(seg).split(' ').filter(Boolean)
    for (let n = 1; n <= maxN; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const win = toks.slice(i, i + n)
        // Reject if the phrase STARTS or ENDS on a stopword, or is entirely noise. "of the roadmap"
        // and "roadmap and" are not terms; "product roadmap" is.
        if (isNoise(win[0]) || isNoise(win[n - 1])) continue
        if (win.every(isNoise)) continue
        if (n === 1 && win[0].length < 2) continue   // a lone letter is not a term; `p and l` is
        out.add(win.join(' '))
      }
    }
  }
  return out
}

/**
 * POST /api/app/qc/terms/mine  { minDf?, maxN?, limit? }
 * Scans the owner's real postings and upserts candidates. Read-only against opportunity.
 */
export async function termsMine(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const { owner } = resolveOwner(req)
    const body = (await req.json().catch(() => ({}))) as any
    const minDf = Math.max(2, Number(body?.minDf) || 5)
    const maxN = Math.min(4, Math.max(1, Number(body?.maxN) || 4))
    const limit = Math.min(5000, Number(body?.limit) || 2000)

    client = await getPgClient()
    const rows = (await client.query(
      `select id, jd_real, jd_summary, jd_requirements from opportunity
        where owner_email = $1 and not dismissed and length(coalesce(jd_real,'')) > 200`, [owner])).rows

    const df = new Map<string, { n: number; count: number; samples: string[]; surface: string }>()
    for (const o of rows) {
      const text = groundingText(o)
      if (!text) continue
      for (const g of ngramsForDoc(text, maxN)) {
        const cur = df.get(g)
        if (cur) { cur.count++; if (cur.samples.length < 5) cur.samples.push(o.id) }
        else df.set(g, { n: g.split(' ').length, count: 1, samples: [o.id], surface: g })
      }
    }

    // RANK BY SPECIFICITY, NOT RAW FREQUENCY. Sorting by df alone puts posting boilerplate on top —
    // the first live run surfaced product(584), building(581), develop(580), systems(574),
    // culture(569) ahead of every real term. df cannot separate "operating model" from "product"
    // because both are frequent; phrase LENGTH can, because multi-word n-grams are far more likely to
    // be something an employer actually asks for. df remains the stored truth; this only orders the
    // curation queue so a human reviews the plausible terms first.
    const specificity = (n: number, count: number) => count * (n === 1 ? 0.25 : n === 2 ? 1.0 : n === 3 ? 1.2 : 1.1)
    const kept = [...df.entries()].filter(([, v]) => v.count >= minDf)
      .sort((a, b) => specificity(b[1].n, b[1].count) - specificity(a[1].n, a[1].count)).slice(0, limit)

    let upserted = 0
    for (const [norm, v] of kept) {
      await client.query(
        `insert into term_candidate (owner_email, ngram, normalized, n, df, sample_opp_ids, corpus_size)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (owner_email, normalized) do update
           set df = excluded.df, sample_opp_ids = excluded.sample_opp_ids,
               corpus_size = excluded.corpus_size, mined_at = now()
           where term_candidate.status = 'pending'`,   // never overwrite a human decision
        [owner, v.surface, norm, v.n, v.count, v.samples, rows.length])
      upserted++
    }

    return { status: 200, headers: HEADERS, jsonBody: {
      ok: true, owner, corpusSize: rows.length, distinctNgrams: df.size, minDf, maxN,
      candidatesUpserted: upserted,
      top: kept.slice(0, 40).map(([norm, v]) => ({
        term: norm, df: v.count, n: v.n,
        dfPct: Math.round((v.count / Math.max(1, rows.length)) * 100),   // context for the reviewer
      })),
    } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

/** GET /api/app/qc/terms/candidates?status=pending&limit=200 */
export async function termsCandidates(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const { owner } = resolveOwner(req)
    const status = req.query.get('status') || 'pending'
    const limit = Math.min(1000, parseInt(req.query.get('limit') || '200', 10))
    client = await getPgClient()
    const minN = Math.max(1, parseInt(req.query.get('minN') || '1', 10))
    const r = await client.query(
      `select id, ngram, normalized, n, df, corpus_size, status, merged_into, mined_at,
              round(100.0 * df / greatest(corpus_size, 1)) as df_pct,
              df * (case n when 1 then 0.25 when 2 then 1.0 when 3 then 1.2 else 1.1 end) as specificity
         from term_candidate where owner_email = $1 and status = $2 and n >= $3
        order by specificity desc, normalized limit $4`, [owner, status, minN, limit])
    return { status: 200, headers: HEADERS, jsonBody: { count: r.rows.length, status, candidates: r.rows } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

/** POST /api/app/qc/terms/candidate/{id}  { status: approved|rejected|merged, mergedInto? } */
export async function termsCandidateDecide(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  let client
  try {
    const guard = requireWrite(req); if (guard) return guard
    const { owner } = resolveOwner(req)
    const body = (await req.json().catch(() => ({}))) as any
    const status = String(body?.status || '')
    if (!['approved', 'rejected', 'merged'].includes(status)) {
      return { status: 400, headers: HEADERS, jsonBody: { error: 'status must be approved|rejected|merged' } }
    }
    if (status === 'merged' && !body?.mergedInto) {
      return { status: 400, headers: HEADERS, jsonBody: { error: 'mergedInto (a term_key) is required when status=merged' } }
    }
    client = await getPgClient()
    const r = await client.query(
      `update term_candidate set status=$1, merged_into=$2, reviewed_at=now(), reviewed_by=$3
        where id=$4 and owner_email=$5 returning id, ngram, status, merged_into`,
      [status, body?.mergedInto || null, owner, req.params.id, owner])
    if (!r.rows[0]) return { status: 404, headers: HEADERS, jsonBody: { error: 'candidate not found' } }
    return { status: 200, headers: HEADERS, jsonBody: { ok: true, candidate: r.rows[0] } }
  } catch (err) {
    return { status: 500, headers: HEADERS, jsonBody: { error: String(err) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('termsMine', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/terms/mine', handler: termsMine })
app.http('termsCandidates', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/terms/candidates', handler: termsCandidates })
app.http('termsCandidateDecide', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/terms/candidate/{id}', handler: termsCandidateDecide })

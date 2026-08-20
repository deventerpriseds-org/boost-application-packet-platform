// P6 — owner fact persistence, derivation from the source documents, and confirmation.
//
// All derivation logic is in `ownerFacts.ts`, which imports neither @azure/functions nor pg (H12).
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'
import { FACT_CATALOGUE, FACT_BY_KEY, deriveFacts, proposeMissingFacts, OwnerFact } from './ownerFacts'
import { getGoogleOAuthToken } from './googleAuth'
import { templateText, RESUME_TEMPLATE_ID } from './packetTemplates'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }

export async function loadFacts(client: any, owner: string): Promise<OwnerFact[]> {
  return (await client.query(
    `select key, value, value_num, source, confirmed_at from owner_fact where owner_email=$1`, [owner])).rows
}

/**
 * The text the facts are read OFF: the resume template's static sections first, then MasterContext.
 *
 * The template is the primary source — its work history carries the dates, and its education and
 * certification lines are already written. MasterContext's prose blocks are the secondary source for
 * anything the template does not state. Asking the owner to retype either is the fallback, not the
 * starting point.
 */
async function sourceText(): Promise<{ text: string; sources: string[] }> {
  const parts: string[] = []
  const sources: string[] = []
  try {
    const token = await getGoogleOAuthToken()
    const t = await templateText(token, RESUME_TEMPLATE_ID, false)
    if (t.trim()) { parts.push(t); sources.push(`resume template ${RESUME_TEMPLATE_ID}`) }
  } catch (e) { sources.push(`resume template UNREADABLE: ${String((e as any)?.message || e)}`) }

  try {
    const ctx = TableClient.fromConnectionString(CONN, 'MasterContext')
    let mc: any = {}
    for await (const e of ctx.listEntities({ queryOptions: { filter: "PartitionKey eq 'context'" } })) mc = e
    // EVERY profile block except the do-not-use list. The first pass read only work history and the
    // prose blocks and missed certifications that live in the skills/expertise pools — a cert stated
    // in `softHardSkillsPool` is just as much a fact about the owner as one in the resume template.
    // `itemsToOmit` stays excluded: it is what the owner has banned, so reading facts out of it
    // would record a banned item as something they hold.
    const blocks = Object.entries(mc || {})
      .filter(([k, v]) => typeof v === 'string' && k !== 'itemsToOmit' && !k.startsWith('odata') && !['partitionKey', 'rowKey', 'etag', 'timestamp'].includes(k))
      .map(([, v]) => v as string).filter(Boolean)
    if (blocks.length) { parts.push(blocks.join('\n\n')); sources.push(`MasterContext (${blocks.length} blocks)`) }
  } catch (e) { sources.push(`MasterContext UNREADABLE: ${String((e as any)?.message || e)}`) }

  return { text: parts.join('\n\n'), sources }
}

// POST /api/app/qc/facts/derive — read the source documents and record what they state.
// Everything written is source='derived', confirmed_at NULL: a derived fact is the system's reading
// of a document, which is evidence rather than testimony, and cannot settle a requirement until the
// owner confirms it.
export async function factsDerive(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner } = resolveOwner(req)
  let client
  try {
    const { text, sources } = await sourceText()
    if (!text.trim()) {
      return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: 'no source text could be read', sources } }
    }
    const year = Number(new Date().getUTCFullYear())
    const derived = deriveFacts(text, year)
    // Echo what the reader actually SAW. A derived number is only confirmable if the owner can
    // check it against the source without opening the document — and the first live run derived
    // "5 years" from a decades-long career because only one date range matched.
    const dateRanges = Array.from(new Set(
      (text.match(/\b(?:19[7-9]\d|20[0-4]\d)\s*(?:-|–|—|to|until)\s*(?:[A-Za-z.]+\s*)?(?:present|current|now|19[7-9]\d|20[0-4]\d)\b/gi) || [])
        .map(x => x.replace(/\s+/g, ' ').trim())))

    client = await getPgClient()
    const written: any[] = []
    for (const d of derived) {
      const def = FACT_BY_KEY.get(d.key)
      // Never overwrite something the owner confirmed — a re-read of the template must not silently
      // replace a value a human vouched for.
      const r = await client.query(
        `insert into owner_fact (owner_email, key, label, category, value, value_num, unit, source, evidence)
         values ($1,$2,$3,$4,$5,$6,$7,'derived',$8)
         on conflict (owner_email, key) do update set
           value = case when owner_fact.confirmed_at is null then excluded.value else owner_fact.value end,
           value_num = case when owner_fact.confirmed_at is null then excluded.value_num else owner_fact.value_num end,
           evidence = case when owner_fact.confirmed_at is null then excluded.evidence else owner_fact.evidence end,
           updated_at = now()
         returning key, value, value_num, source, confirmed_at, evidence`,
        [owner, d.key, def?.label || d.key, def?.category || 'experience', d.value, d.value_num, def?.unit || null, d.evidence])
      written.push(r.rows[0])
    }

    // What the corpus asks for that nothing answers yet — the rows worth proposing.
    const reqTexts = (await client.query(
      `select coalesce(r.verbatim, r.item_text) as t from requirement r
         join opportunity o on o.id = r.opp_id where o.owner_email = $1 limit 4000`, [owner])).rows.map((x: any) => x.t)
    const missing = proposeMissingFacts(reqTexts, await loadFacts(client, owner))

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true, sources, sourceChars: text.length,
        dateRangesSeen: dateRanges,
        derived: written,
        stillNeeded: missing.map(m => ({ key: m.key, label: m.label, help: m.help })),
        note: 'derived facts are UNCONFIRMED — confirm each one before it can settle a requirement',
      },
    }
  } catch (e: any) {
    context.error('factsDerive', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

// GET /api/app/qc/facts — the catalogue, each entry with its current value and confirmation state.
export async function factsGet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const rows = (await client.query(`select * from owner_fact where owner_email=$1`, [owner])).rows
    const byKey = new Map(rows.map((r: any) => [r.key, r]))
    const facts = FACT_CATALOGUE.map(def => {
      const r: any = byKey.get(def.key)
      return {
        key: def.key, label: def.label, category: def.category, unit: def.unit || null, help: def.help,
        value: r?.value ?? null, valueNum: r?.value_num ?? null,
        source: r?.source ?? null, evidence: r?.evidence ?? null,
        confirmed: !!r?.confirmed_at, confirmedAt: r?.confirmed_at ?? null,
      }
    })
    // Keys the system proposed that are not in the seed catalogue are still real facts.
    for (const r of rows as any[]) {
      if (!FACT_BY_KEY.has(r.key)) {
        facts.push({ key: r.key, label: r.label, category: r.category, unit: r.unit, help: '',
          value: r.value, valueNum: r.value_num, source: r.source, evidence: r.evidence,
          confirmed: !!r.confirmed_at, confirmedAt: r.confirmed_at })
      }
    }
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        facts,
        confirmed: facts.filter(f => f.confirmed).length,
        unconfirmed: facts.filter(f => f.value && !f.confirmed).length,
        empty: facts.filter(f => !f.value).length,
      },
    }
  } catch (e: any) {
    context.error('factsGet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

/** Upsert one owner-stated fact. Shared by the single and bulk paths so they cannot diverge. */
async function upsertStated(client: any, owner: string, f: any) {
  const key = String(f?.key || '').trim()
  if (!key) throw new Error('key is required')
  const def = FACT_BY_KEY.get(key)
  const value = f.value === null || f.value === undefined ? null : String(f.value)
  const valueNum = f.valueNum === undefined || f.valueNum === null ? null : Number(f.valueNum)
  const confirmed = value ? 'now()' : 'null'
  const r = await client.query(
    `insert into owner_fact (owner_email, key, label, category, value, value_num, unit, source, evidence, confirmed_at)
     values ($1,$2,$3,$4,$5,$6,$7,'owner_stated',$8, ${confirmed})
     on conflict (owner_email, key) do update set
       value = excluded.value, value_num = excluded.value_num, source = 'owner_stated',
       evidence = excluded.evidence, confirmed_at = ${confirmed}, updated_at = now()
     returning key, value, value_num, source, confirmed_at`,
    [owner, key, def?.label || f.label || key, def?.category || f.category || 'experience',
     value, valueNum, def?.unit || null, f.evidence || 'stated by the owner'])
  return r.rows[0]
}

// POST /api/app/qc/facts  { key, value, valueNum?, confirm?: boolean }
// or bulk: { facts: [{ key, value, valueNum? }, ...] }
// Setting a value the owner typed makes it owner_stated and confirmed — they are the source.
// Confirming without a value is rejected: confirming an empty field asserts nothing.
export async function factsSet(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const guard = requireWrite(req); if (guard) return guard
  const { owner, verified } = resolveOwner(req)
  const body: any = await req.json().catch(() => ({}))
  let client
  try {
    client = await getPgClient()

    // Bulk: the owner answering the whole catalogue at once. Each row is owner_stated and therefore
    // confirmed — they are the source, so there is nobody else to confirm against.
    if (Array.isArray(body?.facts)) {
      const written = []
      for (const f of body.facts) written.push(await upsertStated(client, owner, f))
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, written: written.length, facts: written } }
    }

    const key = String(body?.key || '').trim()
    if (!key) return { status: 400, headers: HEADERS, jsonBody: { error: 'key is required, or pass facts: []' } }
    const existing = (await client.query(`select * from owner_fact where owner_email=$1 and key=$2`, [owner, key])).rows[0]

    if (body.value === undefined && body.confirm) {
      if (!existing?.value) return { status: 400, headers: HEADERS, jsonBody: { error: 'nothing to confirm — this fact has no value' } }
      if (!verified) return { status: 403, headers: HEADERS, jsonBody: { error: 'confirming a fact needs a verified session' } }
      const r = await client.query(
        `update owner_fact set confirmed_at = now(), source = 'owner_stated', updated_at = now()
          where owner_email=$1 and key=$2 returning *`, [owner, key])
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, fact: r.rows[0] } }
    }

    return { status: 200, headers: HEADERS, jsonBody: { ok: true, fact: await upsertStated(client, owner, body) } }
  } catch (e: any) {
    context.error('factsSet', e)
    return { status: 500, headers: HEADERS, jsonBody: { error: String(e?.message || e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('factsDerive', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/facts/derive', handler: factsDerive })
app.http('factsGet', { methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/facts', handler: factsGet })
app.http('factsSet', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/qc/facts/set', handler: factsSet })

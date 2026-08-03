import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'
import { getPgClient } from './pgClient'

// ACT-30 — Role Profiles, rebuilt on the TAXONOMY role (not the retired persona stub).
// A "role" here = a (matched_group, matched_role) pair the owner is actually targeting (derived live
// from their opportunities). Each role carries owner-editable baseline fields (narrative, key wins,
// comp reference) stored in role_profile — seeded empty, edited on the page. Linked opportunities are
// the real opps whose matched_group+matched_role equal this role. (Linked ASSETS are omitted until an
// asset→role tagging exists — we don't fake them.)

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const KEY = (grp: string, role: string) => `${grp}:${role}`   // stable role identity

async function ensureTable(client: any) {
  await client.query(`create table if not exists role_profile (
    owner_email    text not null,
    role_key       text not null,
    narrative      text,
    key_wins       text[] not null default '{}',
    comp_reference text,
    updated_at     timestamptz not null default now(),
    primary key (owner_email, role_key)
  )`)
}

// GET  /api/app/role-profiles            → list (roles derived from opps + baseline + counts)
// GET  /api/app/role-profiles?key=...     → one role: baseline + linked opportunities
// POST /api/app/role-profiles            → upsert baseline { key, narrative, keyWins, compReference }
export async function roleProfiles(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  const owner = resolveOwner(req).owner
  let client: any
  try {
    client = await getPgClient()
    await ensureTable(client)

    if (req.method === 'POST') {
      const guard = requireWrite(req); if (guard) return guard
      const b = (await req.json().catch(() => ({}))) as any
      const key = String(b?.key || '').trim()
      if (!key.includes(':')) return { status: 400, headers: HEADERS, jsonBody: { ok: false, error: 'key must be "group:role"' } }
      const narrative = b?.narrative != null ? String(b.narrative).slice(0, 4000) : null
      const keyWins = Array.isArray(b?.keyWins) ? b.keyWins.map((s: any) => String(s).slice(0, 300)).filter(Boolean).slice(0, 20) : []
      const compReference = b?.compReference != null ? String(b.compReference).slice(0, 200) : null
      await client.query(
        `insert into role_profile (owner_email, role_key, narrative, key_wins, comp_reference, updated_at)
           values ($1,$2,$3,$4,$5, now())
         on conflict (owner_email, role_key) do update set
           narrative=excluded.narrative, key_wins=excluded.key_wins, comp_reference=excluded.comp_reference, updated_at=now()`,
        [owner, key, narrative, keyWins, compReference])
      return { status: 200, headers: HEADERS, jsonBody: { ok: true, key, narrative, keyWins, compReference } }
    }

    // ---- GET ----
    const key = (req.query.get('key') || '').trim()
    if (key) {
      // Single role: baseline + linked opportunities (real, by matched_group+matched_role).
      const [grp, ...rest] = key.split(':'); const role = rest.join(':')
      const bp = (await client.query(`select narrative, key_wins, comp_reference from role_profile where owner_email=$1 and role_key=$2`, [owner, key])).rows[0]
      const opps = (await client.query(
        `select id, company, role, stage, match_score, ats_score, is_favorite,
                source_date, created_at
           from opportunity
          where owner_email=$1 and not dismissed and not is_demo and matched_group=$2 and matched_role=$3
          order by is_favorite desc, match_score desc nulls last limit 200`, [owner, grp, role])).rows
      return {
        status: 200, headers: HEADERS,
        jsonBody: {
          ok: true,
          role: {
            key, group: grp, role,
            narrative: bp?.narrative || null, keyWins: bp?.key_wins || [], compReference: bp?.comp_reference || null,
            opportunities: opps.map((o: any) => ({
              id: o.id, company: o.company, role: o.role, stage: o.stage,
              match: o.match_score, atsScore: o.ats_score, isFavorite: !!o.is_favorite,
              sourceDate: o.source_date, createdAt: o.created_at,
            })),
          },
        },
      }
    }

    // List: every role the owner is targeting (from opps) + its baseline + counts.
    const rows = (await client.query(
      `select o.matched_group grp, o.matched_role role,
              count(*)::int n, count(*) filter (where o.is_favorite)::int fav,
              rp.narrative, rp.key_wins, rp.comp_reference
         from opportunity o
         left join role_profile rp on rp.owner_email=o.owner_email and rp.role_key = o.matched_group || ':' || o.matched_role
        where o.owner_email=$1 and not o.dismissed and not o.is_demo and o.matched_role is not null
        group by o.matched_group, o.matched_role, rp.narrative, rp.key_wins, rp.comp_reference
        order by count(*) filter (where o.is_favorite) desc, count(*) desc`, [owner])).rows
    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        ok: true,
        roles: rows.map((r: any) => ({
          key: KEY(r.grp, r.role), group: r.grp, role: r.role,
          opportunities: r.n, favorites: r.fav,
          narrative: r.narrative || null, keyWins: r.key_wins || [], compReference: r.comp_reference || null,
        })),
      },
    }
  } catch (e) {
    return { status: 200, headers: HEADERS, jsonBody: { ok: false, error: String(e) } }
  } finally { try { await client?.end() } catch {} }
}

app.http('roleProfiles', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/role-profiles', handler: roleProfiles })

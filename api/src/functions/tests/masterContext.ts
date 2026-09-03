// WHAT:       The ONE place the owner's master profile is read out of the `MasterContext` Azure
//             Storage table. Every product read funnels through `readMasterContextEntity()`.
// WHY:        The read was open-coded in six product files (and four legacy MT-XX harness files),
//             each building its own TableClient and repeating the same partition filter. That is
//             what makes moving the store a ten-file edit with no way to bisect a failure. This
//             commit introduces the accessor with the Storage backing UNCHANGED; a later commit
//             swaps what is behind it. Swapping the store first would mean nine simultaneous edits.
// SUPERSEDES: nothing -- it consolidates, it does not replace a predecessor.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/AC-mastercontext-to-postgres.md (commit ccc28c6), whose sequencing
//             section answers "one accessor first, store-swap second -- confirmed correct", and
//             whose guard table names `H:mastercontext-one-accessor`.
//
// THE OWNER SETTLED THE HARD PART, 2026-09-03: *"it was a one time update that seeds the storage it
// never gets updated or overwritten"* and *"storage will just be a backup once copy to postgres is
// done"*. Corroborated in code the same day -- ten Storage writers exist in this repo (`config.ts`,
// `apps.ts`, `processJob.ts`, the MT-XX harness) and NOT ONE targets the `context` partition. So
// there is no dual-write window, no staleness digest and nothing to reconcile: the move is a copy.
//
// WHY THIS THROWS INSTEAD OF RETURNING A DEFAULT, which is the whole design of the file.
// The six callers do NOT share an error policy, and flattening them would be a behaviour change
// smuggled inside a refactor:
//   appInsertions.loadMasterBaseline   swallows -> {}   (documented: a missing baseline must not
//                                                        fail a build; `originalState` words it)
//   appApply.masterContextSummary      swallows -> ''
//   appFacts                           catches and RECORDS the failure into its `sources[]` trail
//   diagSkillSources                   catches, reports {ok:false, error}, and treats an EMPTY
//                                      table as a RESULT rather than an empty pool to seed from
//   pipeline.loadProfile / :391        do not catch at all -- a profile-less run should fail loudly
// An accessor that returned `{}` on failure would silently convert the last two into quiet
// successes and erase the middle two's diagnostics. It throws; each caller keeps what it had.

import { TableClient } from '@azure/data-tables'
import { getPgClient } from './pgClient'
// MC_KIND is the ONE place that knows which blocks the owner's master profile has -- the copy
// iterates it rather than restating the list, which is the same reason the SQL CHECK is guarded
// against it by H:mastercontext-block-key-domain. evidence.ts is a pure transform module and
// imports nothing from here, so there is no cycle.
import { MC_KIND } from './evidence'

/** The Storage table the owner's master profile lived in, and still does as the cold backup. */
export const MASTER_CONTEXT_TABLE = 'MasterContext'

/**
 * WHICH STORE THE READ COMES FROM. Defaults to `storage` and stays there until the copy has been
 * run and byte-identical output confirmed live -- rollback is then "flip this back", not "revert a
 * commit and hope nothing else landed on top", which this branch's own merge history shows is not a
 * safe assumption. Both branches stay reachable; neither is dead code behind a constant.
 */
export function masterContextSource(): 'postgres' | 'storage' {
  return process.env.MASTERCONTEXT_SOURCE === 'postgres' ? 'postgres' : 'storage'
}

/**
 * THE OWNER TO READ WHEN A CALLER HAS NONE, and the reason it is settable rather than a literal.
 *
 * The Storage row had NO owner concept at all -- one global partition, one row for everybody -- so
 * three of the six callers (`pipeline.loadProfile`, `appFacts`, `diagSkillSources`) never had an
 * owner in scope and none was ever needed. Threading one through all of them is a separate, additive
 * change; until then this is the documented single-owner fallback, exposed as an env setting so it
 * is not a constant only a developer can move (this repo's no-hardcoded-config rule). The seeded
 * value is the production owner CLAUDE.md names; `demo@executive-engine.local` is a shared sandbox.
 */
export function defaultMasterOwner(): string {
  return process.env.MASTERCONTEXT_DEFAULT_OWNER || 'von.ellis@enterpriseds.io'
}

/**
 * ONE GLOBAL PARTITION -- one row for everybody, in a product where all 30 Postgres tables are
 * keyed on `owner_email`. This constant is the defect the move exists to end, named rather than
 * repeated ten times, so the thing being removed is greppable as a single symbol.
 */
export const MASTER_CONTEXT_FILTER = "PartitionKey eq 'context'"

/**
 * Read the master-profile entity.
 *
 * THROWS on an unreachable or unconfigured store -- see the file header. Returns `count` alongside
 * the entity because an EMPTY table and an unreadable one are different facts, and at least one
 * caller (`diagSkillSources`) reports them differently. Collapsing them would make "we could not
 * look" indistinguishable from "we looked and it is empty", which this repo's standing rule calls
 * out directly: absent evidence is `not_applicable`, never a pass.
 *
 * `entity` is `{}` when the partition holds no rows, matching what every open-coded loop produced
 * for that case (`let mc: any = {}` then a `for await` that never runs).
 */
export async function readMasterContextEntity(ownerEmail?: string): Promise<{ entity: Record<string, any>; count: number }> {
  return masterContextSource() === 'postgres'
    ? readFromPostgres(ownerEmail || defaultMasterOwner())
    : readFromStorage()
}

async function readFromStorage(): Promise<{ entity: Record<string, any>; count: number }> {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set')
  const client = TableClient.fromConnectionString(conn, MASTER_CONTEXT_TABLE)
  let entity: Record<string, any> = {}
  let count = 0
  for await (const e of client.listEntities({ queryOptions: { filter: MASTER_CONTEXT_FILTER } })) {
    entity = e as Record<string, any>
    count++
  }
  return { entity, count }
}

/**
 * ASSEMBLES THE SAME FLAT SHAPE the Storage entity had -- `{ skills1: '...', workHistory1: '...' }` --
 * because `masterBaseline` and `profileFromMasterContext` are PURE transforms over that shape and
 * must not learn where the data came from. AC-5 is that their output is byte-identical across the
 * cut; the cheapest way to keep that true is to change nothing they can see.
 *
 * `count` is the number of BLOCKS found, mirroring Storage's entity count in the only way that
 * matters downstream: zero means "we looked and there is nothing", which `diagSkillSources` reports
 * differently from "we could not look" (a throw).
 */
async function readFromPostgres(ownerEmail: string): Promise<{ entity: Record<string, any>; count: number }> {
  const client = await getPgClient()
  try {
    const rows = (await client.query(
      `select block_key, text from owner_master_block where owner_email = $1`, [ownerEmail])).rows
    return { entity: entityFromBlocks(rows), count: rows.length }
  } finally { try { await client.end() } catch { /* the read already happened */ } }
}

/**
 * Rows -> the flat entity shape. EXPORTED so the parity guard exercises the REAL assembly rather
 * than a re-implementation of it in the test: a guard that rebuilds the thing it checks passes
 * whenever the test and the code make the SAME mistake, which is the shape of an inert guard.
 */
export function entityFromBlocks(rows: Array<{ block_key: string; text: string }>): Record<string, any> {
  const entity: Record<string, any> = {}
  for (const r of rows) entity[r.block_key + '_pg'] = r.text
  return entity
}

/**
 * THE ONE-TIME COPY. Storage -> Postgres, non-destructive on both sides.
 *
 * The owner settled the shape of this (2026-09-03): the Storage row is a one-time seed that nothing
 * ever writes, and it *"will just be a backup once copy to postgres is done"*. So this is a copy,
 * not a sync -- there is no second writer to race, nothing to reconcile, and NOTHING HERE DELETES
 * THE STORAGE ROW. Deleting it is a separate, later, explicitly-approved commit (AC-9); until then
 * it is the only copy of an unreproducible seed and rollback depends on it still being there.
 *
 * IDEMPOTENT by `on conflict do update`, so running it twice is a no-op rather than a duplicate-key
 * failure or a silent skip. Blocks absent from the Storage entity are simply not written -- an
 * absent block and an emptied one are different facts, and writing '' for an absent one would
 * manufacture a value the owner never set.
 */
export async function copyMasterContextToPostgres(client: any, ownerEmail: string): Promise<{ owner: string; blocks: number; keys: string[] }> {
  const { entity } = await readFromStorage()
  const keys: string[] = []
  for (const key of Object.keys(MC_KIND)) {
    const v = entity[key]
    if (v == null) continue
    await client.query(
      `insert into owner_master_block (owner_email, block_key, text, updated_at)
       values ($1, $2, $3, now())
       on conflict (owner_email, block_key) do update set text = excluded.text, updated_at = now()`,
      [ownerEmail, key, String(v)])
    keys.push(key)
  }
  return { owner: ownerEmail, blocks: keys.length, keys }
}

// ── the route that RUNS the copy ────────────────────────────────────────────────────────────────
// Without this the copy function above is dead code, and this repo's standing rule is that a path
// nobody can reach is not shipped work. It is deliberately a ROUTE rather than a step wired into
// api-deploy.yml: the copy is one-time, it must be run deliberately once and then observed, and a
// migration step would re-run it on every deploy forever for no reason.
//
// It is IDEMPOTENT (see copyMasterContextToPostgres) so running it twice is a no-op, and it does
// NOT flip the reader -- MASTERCONTEXT_SOURCE is a separate, deliberate switch, so the copy can be
// run and inspected while every build still reads Storage.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { resolveOwner, requireWrite } from './appSession'

const MC_HEADERS = {
  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function masterContextCopy(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: MC_HEADERS }
  const denied = requireWrite(req)
  if (denied) return denied
  // The copy WRITES owner-scoped rows, so it takes the verified session's owner -- never `?owner=`,
  // which resolveOwner accepts unverified for READS. Seeding another owner's profile from a query
  // string is exactly the data-separation defect this move exists to end.
  const { owner } = resolveOwner(req)
  let client
  try {
    client = await getPgClient()
    const r = await copyMasterContextToPostgres(client, owner)
    return {
      status: 200, headers: MC_HEADERS,
      jsonBody: {
        ok: true, ...r,
        // Say plainly that nothing switched. A 200 here has repeatedly been read as "it is live now".
        readingFrom: masterContextSource(),
        note: 'Copied. Nothing was deleted from Storage, and the reader still uses '
          + masterContextSource() + ' until MASTERCONTEXT_SOURCE is set to postgres.',
      },
    }
  } catch (err: any) {
    // A failed copy is reported as failed. Returning ok:true with zero blocks would be
    // indistinguishable from "the source was empty", and this repo treats a 200-with-a-zero-count
    // as a result to investigate rather than a pass.
    return { status: 500, headers: MC_HEADERS, jsonBody: { ok: false, error: String(err?.message || err) } }
  } finally { try { await client?.end() } catch { /* the work already happened */ } }
}

app.http('masterContextCopy', {
  methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'app/master-context/copy', handler: masterContextCopy,
})

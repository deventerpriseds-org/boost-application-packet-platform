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

/** The table the owner's master profile lives in. */
export const MASTER_CONTEXT_TABLE = 'MasterContext'

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
export async function readMasterContextEntity(): Promise<{ entity: Record<string, any>; count: number }> {
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

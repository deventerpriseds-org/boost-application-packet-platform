<!-- WHAT:       Verifier brief for three changes landed on main 2026-09-03: the MasterContext
                 accessor + table + Postgres backing, the table-registration guard, and the
                 deploy-gate sha fix.
     WHY:        TIER 1. `masterBaseline` is the BASELINE every swap row's "original" compares
                 against, and the deploy gate decides whether a migration may run at all. Both
                 admit into stored claims. The Stop gate correctly refused a self-report.
     SUPERSEDES: nothing.
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   commits 5f4c0c9, d85934d, 79d843f, e3e04f0, f0f9afc, 5dbd4df on main. -->

# VERIFIER BRIEF — MasterContext move + the two gate defects (loop 1)

## VERIFY LOOP
work: mastercontext-and-deploy-gate
loop: 1

This is loop 1, so there is no PRIOR STATE block to carry forward — nothing has been verified yet.
Coverage is TOTAL: every claim below gets a verdict, none is skipped.

Repo: `/home/user/boost-application-packet-platform`, branch `claude/incumbent-wins-swap`
(= `origin/main` at `5dbd4df`).

**Write into `docs/qc-evidence/VERIFY-mastercontext-and-deploy-gate-1.md` AS YOU GO**, committing
and pushing after each claim:

    git add docs/qc-evidence/VERIFY-mastercontext-and-deploy-gate-1.md \
      && git commit -q -m "VERIFY mastercontext-and-deploy-gate: <claim>" \
      && git push -q origin claude/incumbent-wins-swap

This container restored several times today. A commit that is not pushed dies with it.

## THE CONTRACT

Every claim gets **CONFIRMED / REFUTED / NOT_APPLICABLE**, each citing a command you ran and its
actual output. Prose does not satisfy this. `NOT_APPLICABLE` is the honest verdict when the evidence
is not reachable from here — say so rather than reasoning about what a check *would* show.

**You CAN execute.** Run the suites, apply mutations, stand up the local Postgres. Do not reason
about what an assertion would evaluate; evaluate it.

## WHAT THE IMPLEMENTER CLAIMS — attack each one

### C1. The accessor is the only production read of MasterContext
`readMasterContextEntity()` in `api/src/functions/tests/masterContext.ts` is claimed to be the sole
production path. The MT-XX harness (`mt13/14/18/19`) is deliberately exempt.
**Attack:** find a production read that bypasses it. `grep` is not enough on its own — check for a
`TableClient` opened against `'MasterContext'` under any name, and check `web/` and `scripts/`.

### C2. The six migrated call sites kept their ERROR POLICIES exactly
They differ deliberately: `appInsertions.loadMasterBaseline` swallows to `{}`;
`appApply.masterContextSummary` swallows to `''`; `appFacts` records into `sources[]`;
`diagSkillSources` reports `{ok:false}` and treats an EMPTY table as a distinct result;
`pipeline.loadProfile` and `pipeline.ts:388` do not catch at all.
**Attack:** the accessor now THROWS where the old code sometimes returned a default. Prove each
caller still behaves as it did. `diagSkillSources`' empty-vs-unreadable distinction is the sharpest:
`count` was `entities.length` and is now the accessor's `count`.

### C3. `masterBaseline` output is byte-identical across the storage cut
Guarded by `H:mastercontext-baseline-parity`, which drives the shipping `entityFromBlocks`.
**Attack:** the guard uses a hand-built fixture. Does it exercise the shapes the REAL producers
emit — including a Storage entity's system columns (`partitionKey`, `etag`, `timestamp`) and a
block whose text is `''`? A guard that passes on a fixture the system never produces is inert.

### C4. `owner_master_block` is correct on production
Claimed: 4 columns, `PRIMARY KEY (owner_email, block_key)`, a 14-value `block_key` CHECK,
`itemsToOmit` unstorable, 0 rows. Live DB is reachable via the `boost-pg-mcp-write` connector; the
fallback is `.github/workflows/db-query.yml`.
**Attack:** verify against the DATABASE, not the deploy log. Also check the local-Postgres claim —
that main's schema applied to a POPULATED database then this branch's on top exits 0.

### C5. `H:every-declared-table-is-registered` closes H11's blind spot
Claim: H11 walked a hand-maintained list and was structurally unable to see a new table; the
replacement derives the list from `SCHEMA_SQL`.
**Attack:** does the derived check have its own blind spot? Consider a table created by an
`ensure*()` ALTER rather than a `create table if not exists` in `SCHEMA_SQL` — `comparison_dimension`
shipped exactly that way once (D21). Does the comment-stripping drop a real declaration? Mutate it.

### C6. The deploy gate now measures the bundle, not an app setting
Claim: `/api/health` reports `BUILD_SHA` compiled into `dist/`; `DEPLOYED_SHA` is only a fallback.
**Attack, and this is the one the implementer could NOT settle.** The poll still cleared on
`1 attempt`. The implementer says that is *consistent with* the fix but not evidence of it, because
`WEBSITE_RUN_FROM_PACKAGE` can mount a bundle near-instantly. **Is there a check available from here
that discriminates?** If not, say `NOT_APPLICABLE` and state exactly what deploy would settle it.
Also: if the stamp step ever fails to match its regex, `BUILD_SHA` stays `null` and `servingSha()`
silently falls back to the app setting — reinstating the defect. The step asserts its own edit; is
that assertion actually reachable, and does anything catch a bundle deployed with `BUILD_SHA = null`?

### C7. Nothing in production behaves differently yet
Claim: `MASTERCONTEXT_SOURCE` defaults to `storage`, so every build still reads Azure Storage; the
copy route must be called deliberately.
**Attack:** is there any path that reads Postgres today? Is the copy route reachable without a
verified session? `resolveOwner` accepts `?owner=` unverified for READS — prove the route requires
`requireWrite`.

## THE INTEGRATION TRACE — verify it, do not take it on trust

The implementer's trace, for you to confirm or refute:

- **ONE core system:** the owner's master profile funnels through `readMasterContextEntity()`, whose
  output feeds two PURE transforms — `masterBaseline` (`evidence.ts`) and `profileFromMasterContext`
  (`pipeline.ts`).
- **Producers:** 12 Storage writers exist (`config.ts`, `processJob.ts`, `promptsApi.ts`,
  `pipeline.ts`, MT-XX). **NONE targets the `context` partition** — so the row is a one-time seed,
  which the owner confirmed independently.
- **Consumers:** 6 production readers behind the accessor; `loadMasterBaseline` is read by
  `appBaseline.ts`, `appSwaps.ts`, `swaps.ts`, `appInsertions.ts`, `diagMasterSource.ts`.
  **`swaps.ts` is the accusation-grade one** — the baseline is what every swap row's "original"
  compares against.
- **Extend vs new:** extends. No new store for the profile; `owner_master_block` replaces a Storage
  partition rather than adding a parallel one, and the block list comes from the existing `MC_KIND`.

**Attack the consumer list specifically.** `appBaseline.ts` and `diagMasterSource.ts` were never
edited by this work — confirm they are genuinely covered transitively via `loadMasterBaseline`, or
refute it.

## BINDING RULES

- **NEVER read or edit any prompt in the Prompts table.**
- Absent evidence is `NOT_APPLICABLE`, never a pass.
- Do not propose weakening any existing guard or refusal.
- Every verdict cites a command and its output.
- **Measure across the population, not one row.**

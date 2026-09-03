# AC — `mastercontext-to-postgres`: move the owner's master profile out of Azure Storage

<!--
WHAT:       Acceptance criteria for moving `MasterContext` (Azure Storage Table) into Postgres,
            per `docs/qc-evidence/BRIEF-ac-mastercontext-to-postgres.md`.
WHY:        TIER 1. `masterBaseline()` is the BASELINE every `swap_decision` row's "original"
            compares against, and `sourceText()`/`profileRecords()` feed every evidence and
            coverage check. A change here silently rewrites provenance on every packet.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   `.claude/DEFERRED.md` `D:master-context-lives-in-the-wrong-store`;
            `docs/qc-evidence/BRIEF-ac-mastercontext-to-postgres.md`; the sweep below,
            run 2026-09-03 against `claude/incumbent-wins-swap` @ `c953176`.
-->

**Written cold against the current tree, not against the brief's 2026-09-02 sweep.** The repo moved
in the intervening day — `appBaseline.ts` and `diagMasterSource.ts` are new files, neither in the
brief's read-site table, both consumers of `loadMasterBaseline()`. The brief's own instruction is
"measure across the population, not one row"; re-running its greps rather than trusting its numbers
is that rule applied to the brief itself.

```
$ git log --oneline -1
c953176 merge origin/main
$ grep -rn "PartitionKey eq 'context'" api/src --include=*.ts | wc -l
10
```

---

## 1. FEASIBILITY TABLE

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **The Storage row itself** | Seeded once, by hand, outside this repo. | 10 raw `PartitionKey eq 'context'` reads (below). | Owner, 2026-09-03: *"it was a one time update that seeds the storage it never gets updated or overwritten."* Corroborated: `grep -rnE "createEntity\|upsertEntity\|updateEntity" api/src` → **12 hits** (not the brief's 10 — recounted, not re-trusted), spread across `processJob.ts` (JobApplications), `config.ts` ×2 (AppConfig), `promptsApi.ts` ×2 (Prompts), `pipeline.ts` ×2 (JobApplications), `apps.ts` (a `META_TABLE`), and four MT-XX harness files (`mt01`/`mt09`/`mt12`/`mt20`, targeting `AppConfig`/`Prompts`/`JobApplications`). **Zero** target the `context` partition or open the `MasterContext` table for a write. | **EXISTS-BUT-CONSTRAINED** — confirmed no writer, exactly as the brief states; the count in the brief's own grep was off by 2 (harmless — neither of the two extra hits touches MasterContext). |
| **Raw read sites** | — | 10 sites, 9 files. | `grep -rn "PartitionKey eq 'context'" api/src --include=*.ts` → `diagSkillSources.ts:58`, `pipeline.ts:209`, `pipeline.ts:391`, `mt13.ts:25`, `mt14.ts:42`, `appInsertions.ts:31`, `mt18.ts:45`, `appFacts.ts:47`, `appApply.ts:25`, `mt19.ts:71`. | **EXISTS** — matches the brief exactly. 4 of 10 (`mt13`/`mt14`/`mt18`/`mt19`) are the legacy MT-XX harness, not the product, per `CLAUDE.md`. |
| **`appInsertions.ts:31` is not a tenth duplicate — it is the canonical loader** | `loadMasterBaseline()` (`appInsertions.ts:25-33`) | `appInsertions.writeInsertions` (loop 0), `appSwaps.writeSwaps`, `appBaseline.baselineArtifacts`, `diagMasterSource.diagMasterSource` | `grep -rn "loadMasterBaseline" api/src --include=*.ts` → 4 real callers plus its own definition and 3 comment references. **None of the 4 callers open `TableClient` themselves.** | **EXISTS** — a de facto shared accessor for the newer (P1.3/baseline-artifacts) consumers already exists and already returns the merge-field-keyed shape (`masterBaseline(mc)` from `evidence.ts`). The brief's "no single accessor" finding is still true of the OTHER 5 product read sites, not of this one. |
| **The 5 non-canonical product read sites, and what shape each actually needs** | — | `pipeline.ts:209` (`profileFromMasterContext(mc)` → `{profileText, omitList}`), `pipeline.ts:391` (same, inline), `appFacts.ts:47` (`profileRecords(mc, template)` → `ProfileRecord[]`, via `sourceText()`), `appApply.ts:25` (`masterContextSummary()` → ad hoc 12-field text join), `diagSkillSources.ts:58` (`readSkillFields()` → 5 named fields only). | Read each function body (pasted above / in-tree). All five start from the SAME raw entity shape (`Record<string, string>`, ~13 keys) and apply a DIFFERENT pure transform on top. None re-implements the Storage read differently from the others — they differ only in what they do with `mc` after reading it. | **EXISTS-BUT-CONSTRAINED** — "no single accessor" is true only at the transform layer; at the RAW-READ layer all 10 sites want the identical `{key: string}` entity. One loader returning that entity, unchanged in shape, lets every existing transform (`masterBaseline`, `profileFromMasterContext`, `profileRecords`, the two ad hoc ones) keep working with zero edits to their own bodies. |
| **`sourceText()`'s blast radius** | `appFacts.ts:35-58` | 7 call sites: `appFacts.ts:78`, `appChecks.ts:84`, `appPackets.ts:564`, `appPackets.ts:1013`, `appRequirements.ts:843/902/963`. | `grep -rn "sourceText(" api/src --include=*.ts` | **EXISTS** — none of the 7 callers passes an owner today; `sourceText()` takes zero parameters. This is the largest hidden blast radius in the sweep: the evidence/coverage/build pipeline is 7 calls deep from the raw read, and every one of them changes signature (or gains an owner threaded from a call site three frames up) once the read becomes per-owner. |
| **`isPooledMasterField`** | `swaps.ts:96-102`, reads `TWO_LEVEL_FIELDS` from `skillPool.ts` | `swaps.ts:131` (`splitBaselineItems`), `swaps.ts:467` (`buildSwaps` pool-mode gate) | Read in place. | **EXISTS, UNAFFECTED.** It keys off `LIST_FIELDS[list].masterKey`, a string constant (`skills1`, `relevantProficiencies`, …) — the same keys the MasterContext entity has always used. A Postgres row keyed the same way changes nothing here. |
| **Owner scoping — does every read site already have an `owner` in scope?** | — | See rows below. | Traced call chains for all 6 product-facing sites. | **EXISTS-BUT-CONSTRAINED** — 4 of 6 do; 2 do not without a signature change (below). |
| — `pipeline.ts` (`buildPackageForJD`, `loadProfile`) | — | `appPackets.ts:523` (owns `opp.owner_email`), `appRemediation.ts:202` (joins to `packet`→`opportunity`, has `owner_email`) | `grep -n "buildPackageForJD(\|loadProfile(" api/src --include=*.ts` | **EXISTS** — owner is in scope at every caller; neither function currently accepts it as a parameter. |
| — `appFacts.ts` (`sourceText`) | — | 7 sites above, all inside owner-scoped request handlers (`resolveOwner(req)` runs in the same function or one frame up) | traced | **EXISTS** — owner is always resolvable at the call site, just not threaded into `sourceText()`'s signature today. |
| — `appApply.ts` (`masterContextSummary`) | — | `matchScore`/`applyPrepare` (own `oppId` → `opportunity.owner_email`); `answersFromQuestions` (**no `oppId` at all** — an optional `body.owner`/`body.company`/`body.role` from an external caller, e.g. a browser extension) | `sed -n '140,160p' appApply.ts` | **EXISTS-BUT-CONSTRAINED** — `answersFromQuestions` has no opportunity to resolve an owner from and no verified session either; it is the one call site with no trustworthy owner today. |
| — `diagSkillSources.ts` (`readSkillFields`) | — | `GET /api/diag/skill-sources` — no `resolveOwner` call anywhere in the file | `grep -n "resolveOwner" diagSkillSources.ts` → 0 hits | **ABSENT** — this diagnostic route is genuinely global today and has no owner concept to preserve; it must gain one (or a default/param) rather than "keep working as before". |
| **The proposed table shape** (`DEFERRED.md`: `owner_master_block(owner_email, merge_field, text, seq)`) | — | — | The actual entity has ~13 flat string keys (`resumeSummary`, `skills1`, `skills2`, `workHistory1-4`, `coreAccomplishments`, `expertise`, `relevantProficiencies`, `aboutMe1`, `aboutMe2`, `executiveProfile`, `softHardSkillsPool`, `itemsToOmit`), each holding ONE block of text — never a list per key. `merge_field` is the wrong name for the column: these keys are NOT merge fields (`MASTER_BASELINE_FIELD` in `evidence.ts:216-231` is the many-to-one map from 15 merge fields onto these 13 source keys — e.g. `RelevantBullets1/2/3` all point at the one `relevantProficiencies` key). | **EXISTS-BUT-CONSTRAINED** — the suggested shape is close but the column should be named `block_key` (or `source_key`, matching `evidence.ts`'s own vocabulary), not `merge_field`, and `seq` is unneeded: there is one row per key, not an ordered list per key. See AC-4. |
| **Do `AppConfig`/`Prompts`/`JobApplications` share the accessor being introduced?** | — | — | `grep -rhoE "TableClient\.fromConnectionString\([^,]+,\s*'[A-Za-z]+'\)" api/src --include=*.ts \| sed -E "s/.*'([A-Za-z]+)'.*/\1/" \| sort \| uniq -c` → `MasterContext 10, Prompts 9, AppConfig 9, JobApplications 4`. Every one of the other 3 tables is ALSO opened raw at every call site — there is no existing "one accessor per table" convention anywhere in this codebase. | **ABSENT** — no, and there is no precedent to extend. The MasterContext accessor introduced here is the first of its kind; it sets a pattern rather than following one. Scope stays MasterContext-only; `AppConfig`/`Prompts`/`JobApplications` are out of scope for this work. |
| **`masterBaseline`'s output contract, byte-for-byte across the cut** | `evidence.ts:239-247` | `appInsertions.ts:32`, downstream to `swaps.ts` (the "original" column) | Pure function of `mc: Record<string,any>` — it does not touch Storage itself. | **EXISTS** — because the transform is pure and takes the flat entity as input, "byte-identical across the cut" reduces to "the new loader returns an object with the same 13 keys and the same string values as the old one, for the same owner". This is directly testable without touching `masterBaseline` at all: see AC-5. |
| **The connection pattern the new accessor must follow** | `pgClient.ts` | every Postgres-backed route in the repo | `sed -n '1,25p' pgClient.ts` | **EXISTS** — one client per call, caller-owned lifecycle (`client.end()` in a `finally`), no pool. 4 of the 6 product read sites (`pipeline.ts` ×2, `appApply.ts`, `diagSkillSources.ts`) currently open ZERO db clients; after the swap each either opens its own (extra connection, consistent with the rest of the repo) or the accessor takes an optional caller-supplied `client` the way `writeSwaps`/`writeInsertions` already accept one. |

---

## 2. SEQUENCING — the brief's question, answered

**The brief's claim is CORRECT: introduce one accessor first, backed by Storage unchanged; swap the
store in a second, separate commit.** Not because a straight cut is unsafe in the abstract, but
because of what the sweep above actually found:

1. **The blast radius is not 10 call sites, it is 10 raw reads plus 4 already-shared callers plus
   7 further `sourceText()` callers plus the pool-mode/skills-baseline machinery in `swaps.ts`.**
   A single commit touching all of it has no bisection point if the migrated table disagrees with
   Storage on one owner's data (case sensitivity, trimming, an empty-vs-absent field — none of
   these were checked yet, and AC-5 exists specifically because they have not been).
2. **Two read sites (`answersFromQuestions`, `diagSkillSources`) have no trustworthy owner today.**
   Resolving what "owner" means for them is a design decision independent of the storage engine,
   and conflating it with the storage swap means a single PR would be blocked on both questions at
   once instead of one at a time.
3. **This repo's own history (`H39`/`H39b`, the JD-column-rename `do $$` block) is a record of
   store-shape changes that pass on a fresh database and break on a populated one.** A one-accessor
   commit is entirely mechanical (move a read, keep its output identical) and can be verified with
   existing tests; the store swap is the one commit that needs the populated-database discipline
   `CLAUDE.md` mandates. Separating them means the mechanical commit cannot be blamed if the store
   commit breaks something.

So: **Commit 1** — introduce `loadMasterContext(client?, owner?)` in `appInsertions.ts` (extending,
not replacing, `loadMasterBaseline`), backed by the existing Storage read; migrate all 6 product raw
reads (`pipeline.ts` ×2, `appFacts.ts`, `appApply.ts`, `diagSkillSources.ts`, and `appInsertions.ts`'s
own body) to call it. Zero behaviour change — every transform still receives byte-identical input.
**Commit 2** — swap the accessor's backing store to Postgres, per AC-1 through AC-6 below. The legacy
MT-XX files (`mt13`/`mt14`/`mt18`/`mt19`) are explicitly OUT of scope for Commit 1: per `CLAUDE.md`
they are not the product, and migrating them risks breaking test-harness code this work has no
reason to touch.

---

## 3. ACCEPTANCE CRITERIA

`Given <context>, when <action>, then <observable outcome>.` Numbered so guards can cite them.

### AC-1 — No build silently loses the baseline

Given the Postgres read fails (connection error, missing row, timeout), when any of the 6 product
call sites requests the master profile, then the caller receives the SAME degraded value it gets
today from a Storage failure — `loadMasterBaseline()` already swallows to `{}`
(`appInsertions.ts:33`, comment: *"a failure is returned as `{ok:false, error}`"* pattern) — **and**
the failure is logged at `warn` or above with the owner id and the error, so a transient DB blip is
visible in logs without blocking the build. "Fail loudly" means observable in logs/monitoring, not
"return an error to the caller" — a build must still be attemptable on a DB hiccup, exactly as it is
attemptable today on a Storage hiccup.

*Not met by:* throwing from the new accessor and letting it propagate uncaught into `buildPackageForJD`
or `renderArtifact` — that would make a transient DB blip a harder failure than a transient Storage
blip is today, which is a regression this AC exists to forbid.

### AC-2 — The migration is idempotent and re-runnable

Given the one-time copy from Storage to Postgres has already run once for an owner, when it is run
again for the same owner, then it is a no-op (or an `upsert` that produces byte-identical rows) —
never a duplicate row, never a second `owner_master_block` set for the same `(owner_email, block_key)`
pair. Enforced by a `unique (owner_email, block_key)` constraint on the new table (mirroring every
other per-owner table in `schema.ts`, e.g. `owner_fact`'s `unique (owner_email, key)`), not by
application discipline alone.

### AC-3 — Ordering across the deploy window

Given `api-deploy.yml` deploys code before it calls `pg-migrate` (documented behaviour, `CLAUDE.md`
§"D:deploy-migrates-against-the-old-bundle"), when the new code path reads from
`owner_master_block` before the migration has created and populated it, then the read degrades to
the AC-1 behaviour (empty/warn, not a 500) rather than erroring on a missing table — the same
"the table might not exist yet" discipline `H39`/`H39b` already impose on `SCHEMA_SQL` itself.
**Concretely:** the new accessor's Postgres query must run inside a `try/catch` that treats
`relation "owner_master_block" does not exist` (Postgres error code `42P01`) identically to a
connection failure, so the several-minute gap between "code deployed" and "table migrated and
populated" costs nothing worse than a temporarily-empty baseline.

### AC-4 — The table shape

`owner_master_block(id uuid pk, owner_email text not null, block_key text not null, text text not null,
created_at timestamptz, updated_at timestamptz, unique(owner_email, block_key))`. `block_key` — not
`merge_field` — takes exactly the 13 keys `MC_KIND`/`MC_LABEL` in `evidence.ts` already enumerate
(`resumeSummary`, `skills1`, `skills2`, `workHistory1`..`workHistory4`, `coreAccomplishments`,
`expertise`, `relevantProficiencies`, `aboutMe1`, `aboutMe2`, `executiveProfile`,
`softHardSkillsPool`, `itemsToOmit`). No `seq` column — each key holds one block, not an ordered
list of several. `text` is `not null` (an absent block is an absent ROW, mirroring
`masterBaseline()`'s own rule that "only fields that HAVE non-empty text" are emitted).

### AC-5 — `masterBaseline`'s output is byte-identical across the cut

Given the owner's real MasterContext row (read once from Storage, before the cut) and the same
owner's `owner_master_block` rows (written by the one-time copy), when `masterBaseline(mc)` is
called with each, then `JSON.stringify(masterBaseline(fromStorage))` equals
`JSON.stringify(masterBaseline(fromPostgres))` — same keys, same string values, same key order is
NOT required (the function returns a plain object; only value equality per key matters). Demonstrated
by a script run once against the live data (via `db-query.yml` after the copy, and a `diag/` route
or `api-test.yml` call against the live Storage read, both against the SAME owner), not assumed from
reading the code. This is the one AC in this document that cannot be satisfied by a unit test alone,
because it is a claim about the REAL data, not about the transform.

### AC-6 — Rollback

Given the Postgres path is found wrong after Commit 2 ships, when the accessor's env-gated switch
(a single boolean or env var, e.g. `MASTERCONTEXT_SOURCE=postgres|storage`, defaulting to `storage`
until AC-5 is confirmed live) is flipped back, then every build resumes reading Storage exactly as it
did before Commit 2, with zero code path deleted. This is why AC-9 (below) forbids deleting the
Storage row or the raw-read code in Commit 2 — rollback is "flip a flag", not "revert a commit and
hope nothing else landed on top of it in the meantime" (this branch's own merge history today is
proof that assumption fails in this repo).

### AC-7 — Per-owner from the first write

Given two different owners each have a master profile, when the migration runs, then each owner's
`owner_master_block` rows are keyed to their own `owner_email` and a query filtered to one owner
never returns the other's rows — the specific defect this whole move exists to end (`CLAUDE.md`:
*"all 30 Postgres tables are keyed on owner_email"*, this one included from day one). **Constraint
this AC exposes and does not resolve:** the source Storage row has no owner concept at all (one
global partition). The one-time copy must therefore pick an owner explicitly — almost certainly
`von.ellis@enterpriseds.io`, the real production owner named in `CLAUDE.md` — and that choice is an
explicit input to the migration script, never inferred.

### AC-8 — `answersFromQuestions` and `diagSkillSources` get an explicit owner decision

Given `answersFromQuestions` (`appApply.ts`) has no opportunity and no verified session, when it is
migrated to the per-owner accessor, then it either (a) resolves owner the same way `resolveOwner`'s
unverified-`?owner=` path does elsewhere in the product (READ-only, never a write), falling back to
the seeded default owner, or (b) is explicitly left calling a "the one configured owner" convenience
wrapper — but NOT silently broken by suddenly requiring a parameter nothing supplies. Given
`diagSkillSources` has no owner concept at all today, when it is migrated, then it gains a
`?owner=` query param (mirroring every other `diag/` route's convention) defaulting to the seeded
owner, so its existing zero-argument callers keep working. **Both of these are product decisions,
not mechanical ports — flagging them here rather than resolving them silently in code is itself an
AC**, per this repo's "no hardcoded config" and "confirm before an unrequested behavior change" rules.

### AC-9 — Non-destructive migration

Given the Storage row is the only copy of a seed that is never regenerated (owner confirmed,
`BRIEF §"THE WRITER QUESTION"`), when the migration runs, then the Storage row and every raw-read
call site's CODE remain in the repository, unexecuted-but-present, for at least one full release
cycle after Commit 2 ships and AC-5 is confirmed live. Nothing in this work deletes the
`MasterContext` table, its data, or the Storage-reading code path. Deletion, if ever wanted, is a
separate, later, explicitly-approved commit — never bundled with the move itself.

---

## 4. GUARDS (mutation-provable, `/workspace/eds-claude-skills/scripts/mutate.sh`)

Named now so the implementer builds exactly these, not a paraphrase of them:

| Guard | Asserts | Mutation that must FIRE it |
|---|---|---|
| `H:mastercontext-one-accessor` | No file outside `appInsertions.ts` (and, until Commit 1 lands, the legacy MT-XX harness) contains the literal `"PartitionKey eq 'context'"`. | Re-add a raw read in, e.g., `appApply.ts` — suite must fail by name. |
| `H:mastercontext-owner-scoped` | The Postgres-backed accessor's query includes `where owner_email = $1` (source grep on the accessor function's own SQL, not a runtime probe — same class as `H:no-second-id-copy`). | Delete the `where` clause — suite must fail. |
| `H:mastercontext-block-key-domain` | `owner_master_block.block_key` only ever receives one of the 13 keys `MC_KIND`/`MC_LABEL` enumerate (a CHECK constraint mirrored by a source-level test, same pattern as `requirement.kind`). | Insert/allow a 14th key — suite must fail. |
| `H:mastercontext-baseline-parity` | `masterBaseline()` called on the Storage-shaped entity and on the Postgres-shaped entity (built from a shared fixture) returns identical JSON — the STATIC half of AC-5; the live half needs the real data and is `check: manual db-query.yml`. | Change one fixture value between the two shapes — suite must fail. |
| `H:mastercontext-rollback-flag` | The env-gated switch in AC-6 exists and both branches are reachable (not dead code behind a constant). | Hardcode the switch to one branch — suite must fail. |

---

## 5. OPEN QUESTIONS FOR THE OWNER (not resolved by this pass, per AC-8/AC-9's own language)

1. Which owner does the one-time copy target? (Almost certainly `von.ellis@enterpriseds.io` — needs
   explicit confirmation, not inference, per AC-7.)
2. Does `answersFromQuestions` get real owner resolution now, or a documented "single-owner-only"
   convenience for as long as the product has one real owner? (AC-8.)
3. Is a writer for the owner's own master text (Settings ▸ some new screen) in scope as a
   follow-on to this move, or a separate later request? The brief flags it as a gap this move
   exposes but does not obligate; recording the question rather than assuming an answer.

---

*Written by an AC pass (loop 1). Implementation has not started. Per this repo's tiering rules this
is TIER 1 (decides `masterBaseline`'s provenance output) — an independent AC review and, after
implementation, an independent verifier pass are both required before this lands on `main`.*

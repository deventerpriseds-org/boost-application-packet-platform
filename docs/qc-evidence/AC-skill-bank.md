# AC — 4.6-9 `Swap for another skill…` (skill-bank select + `Swap`), INCLUDING seeding the bank

Written by an independent AC agent, 2026-08-26, on `claude/three-small-ui-gaps` (HEAD `1913b7e`).
**Nothing here is implementation.** Written adversarially — against the owner's instruction as much
as for it, because two of the instruction's own premises turn out to be wrong and finding that is
the job.

**Owner direction, verbatim and decisive:**
> *"build 4.6-9 anyway and make the template skills in the template and the appropriate column
> from the portfolio slide into a skill bank to seed it."*

This overrides `docs/qc-evidence/AC-large-medium.md` Group C's *"Recommendation: do not build
4.6-9."* That recommendation is not re-litigated below. What IS re-examined is Group C's factual
claim that there is no writer for the action — **that claim is refuted**, and the refutation is the
single most consequential finding in this document.

---

## HEADLINE — five findings that change the work. Read before the table.

| # | The premise | What the sweep actually found | Consequence |
|---|---|---|---|
| **1** | *"the template skills in the template"* | **The resume template contains NO skills text.** Measured live, not read: `GET /api/diag/template-placeholders` (api-test run **32973162995**, job 98191413468, 2026-08-26T13:15:54Z, HTTP 200) returns for `"Polished Resume Template w Vars"` exactly `{{ExpertiseBullets}} {{RelevantBullets1..3}} {{ResumeSummary}} {{SkillsBullets1}} {{SkillsBullets2}}`. `evidence.ts:174-176` states the same thing in the repo's own words: *"The Google Doc template cannot be the source for these seven slots: it holds `{{ResumeSummary}}` at that position, not prose."* | **A bank seeded from "the template's skills" would be seeded from two placeholder tokens.** The owner's word "template" almost certainly means the MASTER BASELINE, not the Google Doc — `evidence.ts:167` quotes them: *"the show original is always referencing showing the template the prompts are using as a baseline. there is always an original value for those sections."* That baseline is `MasterContext.skills1` / `skills2` (+ `softHardSkillsPool`), mapped at `evidence.ts:190-196`. **This is a disambiguation the owner must confirm — it is not a blocker, and both readings are cheap.** |
| **2** | *"the appropriate column from the portfolio slide"* | The portfolio deck **is** live-readable from the deployed Function (same run: `"Engineering Portfolio Template (Latest)"`, kind `slides`, HTTP 200) — so "nothing can read Slides" is **FALSE**. But its placeholders are `@AboutMe1/2`, `@Company`, `@CoreAccomplishments…`, `@CoverLetterBody/Date`, `@ExecutiveProfile…` — **not one is a skills slot**. Any skills column in that deck is therefore **static text**, and **no existing route returns the static text of any template.** | The reach EXISTS; the *reader* for this specific content does not. `templateText()` (`packetTemplates.ts:222`) reads Slides and returns flattened plain text — **it collects every `content` string into one join, so a table COLUMN is structurally unrecoverable from it.** Seeding "the appropriate column" needs a Slides **table-cell** reader that does not exist. See row 3 of the table. |
| **3** | Group C: *"A WRITER … NOTHING. There is no `keyword_decision` / `keyword_dropped` / `line_open` column, table or route."* | **REFUTED for 4.6-9.** `POST /api/app/artifact/{artifactId}/owner-edit` (`appCorrections.ts:321`, registered `:390`) takes `{merge_field, phrase, replacement}`, refuses unless the phrase occurs **exactly once**, splices `packet.pkg_json[merge_field]`, and writes a `correction` row with `source='owner_edit'`, `frame='applied'`, undoable by the existing revert route. Its own header says it *"EXTENDS `correction` rather than standing up an override store beside it"* and names why `swap_decision` was rejected. The client function **already exists**: `api.js:197 ownerEdit`. | **The write path for a skill swap is `ALREADY BUILT` and has ZERO UI consumers** (`grep -rn "ownerEdit" app/src` → 1 hit, the definition). 4.6-9's `Swap` is one call to a finished route. Group C's ABSENT was about 4.6-**10** ("drop it, leave the line open") and does not transfer. |
| **4** | *"4.6-9 is a keyword operation"* (the framing in Group C) | It is **a list-item operation**. SPEC §4.6 is explicit: *"Swap for another skill… (from the **profile's skill bank**)"* (`SPEC.md:228`), and `BACKLOG.md:424` repeats *"swap for another skill from the profile's bank"*. The thing swapped is an item of `SkillsBullets1/2` — which `splitItems()` (`assetBlocks.js:82`) already splits client-side, and which `owner-edit` can already replace by exact phrase. | The design does **not** require the keyword panel to gain a coverage effect, so it does **not** inherit PC-3's undecidability blocker. It does require the control to sit where a skill item is nameable. |
| **5** | Tier | `owner-edit` → `correction(source='owner_edit')` → `writeSwaps` reads those replacements as `ownerLabels` (`appSwaps.ts:44-49`) → `buildSwaps` sets `driver='owner'` (`swaps.ts:279`) → `appSwaps.ts:123` **excludes `'owner'` from `unattributed`**, and P2.2/`changes_cited` blocks on that count (`schema.ts:561-563`). | **TIER 1.** A swap made in this control changes a number a gate reads. Not because of size — because of the code path. |

**ORIGIN of the row (required before calling anything open).**
`grep -rniE "skill bank|skill_bank|skillbank|swap for another|4\.6-9" .claude/actions.md .claude/DEFERRED.md docs/qc-evidence/PULL-CANDIDATES.md docs/qc-evidence/BACKLOG.md docs/qc-evidence/SPEC.md docs/qc-evidence/PROTOTYPE-COVERAGE.md` →
- `SPEC.md:228` — **SPEC §4.6**, *"Swap for another skill… (from the profile's skill bank)"*
- `BACKLOG.md:424` — P8.6 R6, same wording
- `BACKLOG.md:317` — P6: *"soft/hard skill bank. `library_entity` (kind `role_profile`) is a plausible home."*
- `PROTOTYPE-COVERAGE.md:356` — the `ABSENT` verdict; `:690` ranks the group "Moderate"
- `.claude/actions.md:3771` — queued as batch row 6; `:3809-3811` records the earlier "should NOT be built"
- **`.claude/DEFERRED.md` has no row for 4.6-9.** Nothing is deferred and nothing is blocked.

**ORIGIN = SPEC §4.6 + an explicit owner instruction today.** This is stronger than a prototype
proposal: the owner has now both specified the feature *and* named its data source.

---

## PART 1 — FEASIBILITY TABLE

**THE ONE CORE SYSTEM, stated first.** There are two, and keeping them apart is the whole design:

- **READ side:** `appFacts.sourceText()` (`appFacts.ts:35`) is declared *"the ONLY reader of the
  candidate's stored profile"* (`evidence.ts:12`). Every profile-derived seed must funnel through
  it or be explicitly and defensibly outside it.
- **WRITE side:** `POST /app/artifact/{id}/owner-edit` → `correction(source='owner_edit')`
  (`appCorrections.ts:321-386`). Every owner-originated text change funnels through it.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command + result) | Verdict |
|---|---|---|---|---|
| **A Google-Docs/Slides text reader reachable from server code** | `templateText(token, id, isSlides)` — `packetTemplates.ts:222`, `export async function`, branches to `slides.googleapis.com/v1/presentations` when `isSlides` | `appFacts.ts:41` — **one caller**, `templateText(token, RESUME_TEMPLATE_ID, false)` | `grep -rn "templateText" api/src app/src scripts` → 2 hits: the definition and `appFacts.ts:41`. `sed -n '203,228p' api/src/functions/tests/packetTemplates.ts` shows the Slides branch and `collectText` | **`EXISTS`** |
| **A reader that preserves the portfolio deck's TABLE/COLUMN structure** | **NOBODY.** `collectText` (`packetTemplates.ts:205-210`) recurses any JSON and pushes every `node.content` string into ONE array, then `chunks.join('')`. Column, cell, row and slide boundaries are all discarded. `diagDocStructure.fingerprint` DOES walk `el.table` (`diagDocStructure.ts:36-43`) — but it is **Docs-only** (`docs.googleapis.com`, `diagDocStructure.ts:16`) and returns column *widths*, never cell *text* | — | `grep -rn "presentations\|slides.googleapis" api/src` → 15 hits: `appPackets.ts:894/922` (creates + batchUpdates a NEW deck, reads only `slides[0].objectId`), `mt06/mt19/pipeline/diagTemplates` (batchUpdate or placeholder-token scan), `packetTemplates.ts:194/223/235`. **None reads `pageElements[].table.tableRows[].tableCells[].text`.** `grep -rn "tableCells" api/src` → 1 hit, `diagDocStructure.ts:39`, Docs-only | **`ABSENT`** — producer AND consumer swept. **This is the one genuinely new mechanism the owner's instruction requires**, and it is small: a `slidesTable(token, id)` beside `templateText` in the same file, walking `presentation.slides[].pageElements[].table`. |
| **Live reach to Google from a place the sandbox can trigger** | `api-test.yml` mints a session token from `AZURE_CLIENT_SECRET` and calls `job-platform-api.azurewebsites.net`; the Function holds `GOOGLE_REFRESH_TOKEN` (`HAS_GOOGLE_OAUTH`) with the `presentations` scope (`googleOAuth.ts:7`) | this session | **RUN LIVE, not asserted:** `actions_run_trigger(api-test.yml, {method:GET, path:/api/diag/template-placeholders})` → run **32973162995**, job 98191413468, `conclusion: success`, `HTTP 200`, body quoted in Headline row 1/2 | **`EXISTS` — proven this session** |
| **What the resume template actually contains at the skills position** | the Google Doc `1bwOcxvk…` | `varsForType` → `injectValues` replaces the tokens | Same run: `placeholders: [{{ExpertiseBullets}}, {{RelevantBullets1}}, {{RelevantBullets2}}, {{RelevantBullets3}}, {{ResumeSummary}}, {{SkillsBullets1}}, {{SkillsBullets2}}]` — **the skills position holds tokens** | **`EXISTS-BUT-CONSTRAINED`** — readable, and it **contains no skills to harvest**. Seeding "the template's skills" from this document yields **zero** entries. |
| **Whether the portfolio deck contains a skills column at all** | the Slides deck `1ULZZLBs…` | nothing reads its static text | **UNKNOWN — and I could not settle it from here.** No route returns a template's static text; `diag/template-placeholders` returns only `{{…}}` tokens and `diag/doc-structure` is Docs-only and returns a fingerprint. Corroborating evidence that such a column exists: `DEFERRED.md:149` (D31) quotes the owner's live `portfolio_user` prompt v002 — *"Column 2: Insert The full list of Skill1, Skills2, relevant skills 1…"* — read from the Prompts table in api-test run 32553002646 | **`EXISTS-BUT-CONSTRAINED` — content unverified.** The prompt proves the DECK HAS a skills column concept; it does not prove the TEMPLATE file carries static skills text. **AC S.0 makes settling this the first deliverable, and the seeder must report zero honestly if it is empty.** |
| **`MasterContext.skills1` / `skills2` — the "template the prompts use as a baseline"** | Azure Table `MasterContext`, partition `'context'`, read at `appFacts.ts:45-47` | `profileRecords(mc, template)` → `sourceText().records` → evidence resolution, `appChecks.ts:53`, `appRequirements.ts:692/751/812`, `appPackets.ts:537/964`. Also `masterBaseline()` (`evidence.ts:209-216`) → `SkillsBullets1→skills1`, `SkillsBullets2→skills2` | `sed -n '190,216p' api/src/functions/tests/evidence.ts`; `grep -rn "sourceText" api/src` → 14 hits across 5 modules | **`EXISTS`** — owner-scoped only in the sense that MasterContext is single-tenant (see the owner-scoping row). **This is the highest-confidence real source of real skills in the system.** |
| **`MasterContext.softHardSkillsPool` — a literal pool of soft/hard skills** | same table | `MC_KIND` (`evidence.ts:149`) types it `profile_field`; `MC_LABEL:160` labels it *"Soft/hard skills pool"*; so `profileRecords` **does** emit it as a profile record today | `grep -rn "softHardSkillsPool" api/src app/src` → 4 hits: `evidence.ts:149`, `evidence.ts:160`, `mt13.ts:16`, `appFacts.ts:51` (comment) | **`EXISTS-BUT-CONSTRAINED`.** ⚠ **`BACKLOG.md:325` says *"`Soft/Hard Skills` is never read by anything"* — that note is STALE**, refuted by `evidence.ts:149`. **What is NOT established is whether the live field is non-empty.** No route returns MasterContext values (`grep -rn "app.http" api/src \| grep -iE "context\|master"` → **zero**), so its content cannot be read from here. |
| **Owner scoping — the pattern to copy** | `owner_fact` (`schema.ts:741-758`): `owner_email text not null`, `unique (owner_email, key)`, index on `(owner_email, category)`; `persona` `unique(owner_email,key)`; `library_entity` `owner_email … default 'demo@executive-engine.local'` (`schema.ts:1250`, added by ALTER); `role_profile` `primary key (owner_email, role_key)` | `resolveOwner(req)` on every route; `api.js` appends `?owner=${_owner}` — e.g. `api.js:139` with the comment *"without `?owner=` `resolveOwner()` silently falls back to demo"* | `grep -n "create table if not exists owner_fact" -A 18 api/src/functions/tests/schema.ts`; `grep -n "ownerEdit\|requirements" app/src/api.js` | **`EXISTS`** — the pattern is unambiguous: `owner_email` column + `unique(owner_email, …)` + `?owner=` on every read. **A global bank would be wrong and would also be a regression**, since MasterContext is single-tenant and the bank is the thing that makes it per-owner. |
| ⚠ **MasterContext is NOT owner-scoped** | `TableClient.fromConnectionString(CONN,'MasterContext')`, filter `PartitionKey eq 'context'` — **one partition, one row, no owner** (`appFacts.ts:45-47`) | every `sourceText()` consumer | `sed -n '43,48p' api/src/functions/tests/appFacts.ts` | **`EXISTS-BUT-CONSTRAINED`, and it is a real hazard.** Seeding a per-owner bank from a global source means **every owner's bank would be seeded with von.ellis's skills.** The seed route is `requireWrite`-gated and writes `resolveOwner(req).owner`, so in practice it only ever runs for the signed-in owner — but an AC must pin that, because nothing structural prevents it. |
| **Where the bank LIVES — `skill_candidate`** | `writeSwaps` only (`appSwaps.ts:53-70`) | `swapsGet` → `AssetBlocks.jsx` via `scopeSwaps` | `sed -n '546,558p' api/src/functions/tests/schema.ts` — `packet_id uuid not null references packet(id) on delete cascade`, `list text not null check (list in ('skills_1',…))`, `origin check in ('profile_original','pass_a','pass_b')`. `appSwaps.ts:55-56`: `delete from swap_decision where packet_id=$1 and loop=$2` / `delete from skill_candidate …` on **every build** | **`ABSENT` as a home.** Wrong grain (per packet, per list, per loop), and **destroyed on every rebuild**. `appCorrections.ts:303-306` already records that this exact reasoning is why `owner-edit` chose `correction` over `swap_decision`. |
| **Where the bank LIVES — `library_entity`** | `libraryList` (`appExtras.ts:80-100`) | `GET /app/library?owner=&kind=`; `Library.jsx:458` builds filter chips from `category` | `sed -n '156,167p' api/src/functions/tests/schema.ts` — owner-scoped ✓, `kind text not null check (kind in ('role_profile','template','playbook','asset'))`, `content jsonb`, **NO unique constraint of any kind**. `sed -n '71,92p' api/src/functions/tests/appExtras.ts` — **`DEFAULT_LIBRARY` inserts 4 `is_demo:true` FABRICATED rows into any owner's library the first time it is listed** | **`EXISTS-BUT-CONSTRAINED` — and the constraints are three, each of which needs its own fix:** (1) a `skill` kind needs an `ALTER … drop constraint / add constraint`, because `create table if not exists` is a no-op on production (`schema.ts:442-456` is the same lesson, written up); (2) **no unique constraint ⇒ an idempotent re-seed is impossible** without adding one; (3) it is **already seeded with demo fiction**, so every bank read would need `is_demo = false` and every miss would silently offer a playbook. |
| **Where the bank LIVES — `owner_fact`** | `factsDerive` (`appFacts.ts:74`) | `factsGet`, `appChecks.ts:13`, `appRequirements.ts:15` | `sed -n '741,758p' api/src/functions/tests/schema.ts` — `unique(owner_email,key)`, `category … check (category in ('identity','eligibility','experience','education','scope','preference'))`, driven by `FACT_CATALOGUE`/`FACT_BY_KEY` (`ownerFacts.ts`) | **`ABSENT` as a home, `EXISTS` as the PATTERN to copy.** A fact store is a **closed catalogue of known keys**; a skill bank is an **open list**. Storing 60 skills as 60 `key`s would abuse `unique(owner_email,key)` and break `FACT_BY_KEY` lookups (`appFacts.ts:95`, `def?.label \|\| d.key`). **But its derive/upsert/conflict-surface shape is exactly right and must be reused.** |
| **Where the bank LIVES — `term_library_entry`** | `termMiner.ts` | `appChecks.ts:128-141` | `sed -n '193,200p' api/src/functions/tests/schema.ts` — *"Deliberately NOT owner-scoped: it is shared reference data"*; `appChecks.ts:130-141` — *"there are none yet"*; `AssetBlocks.jsx:844-845` — *"the library is off by owner decision"* | **`EXISTS-BUT-CONSTRAINED`, unusable.** Not owner-scoped, unpublished, and **switched off by the owner**. Populating the select from it would offer terms the owner turned off. |
| **Where the bank LIVES — `role_profile`** | `roleProfiles` POST (`appRoleProfiles.ts:44-59`) | the Roles screen | `cat api/src/functions/tests/appRoleProfiles.ts` — `primary key (owner_email, role_key)`, `key_wins text[]`; **created by `ensureTable()` at runtime and NOT in `SCHEMA_SQL`/`EXPECTED_TABLES`** | **`ABSENT` as a home** (per-role, not per-owner) — **and it is a precedent NOT to copy**: `schema.ts:379-380` (D1/H11) requires a new store to be declared in `SCHEMA_SQL` and registered in `EXPECTED_TABLES` so a skipped migration is a failing test, not a runtime 500. |
| **THE WRITE — `owner-edit`** | `artifactOwnerEdit` (`appCorrections.ts:321`), route `app/artifact/{artifactId}/owner-edit` (`:390`) | **NOTHING in the UI.** `api.js:197 ownerEdit` is defined and never called | `grep -rn "ownerEdit" app/src` → **1 hit** (`api.js:197`). `sed -n '300,388p' api/src/functions/tests/appCorrections.ts` | **`ALREADY BUILT`, UNWIRED.** Exactly the shape a swap needs: exact-once phrase location (`locateOwnerPhrase`, no fuzzy — *"splicing into the owner's document is accusation-grade"*), refusal-as-200-with-reason, `before_sha256` for undo, `frame='applied'`. **4.6-9 must call THIS.** |
| **The gate consequence of that write** | `writeSwaps` reads `correction.replacement where source='owner_edit' and reverted_at is null` (`appSwaps.ts:44-49`) → `buildSwaps({ownerLabels})` → `driver: ownerLabels.has(to) ? 'owner' : …` (`swaps.ts:279`) | `swapsGet`: `unattributed = changes.filter(s => s.driver !== 'owner' && s.driver !== 'posting')` (`appSwaps.ts:123`); `swap_decision` header: *"P2.2 blocks on the unattributed count"* (`schema.ts:561-563`) | `sed -n '44,50p' api/src/functions/tests/appSwaps.ts`; `sed -n '118,125p' api/src/functions/tests/appSwaps.ts` | **`EXISTS` — and it is why this row is TIER 1.** |
| **`api.aiEditArtifact` as an alternative writer** | `artifactAiEdit` (`appPackets.ts:1400`), route `:1532` | `AssetBlocks.jsx:683` (the field's ask box) | `sed -n '1440,1450p' api/src/functions/tests/appPackets.ts` — writes `packet.pkg_json[section] = revised` and **writes NO `correction` row** | **`EXISTS-BUT-CONSTRAINED`, and this is a trap.** An ai-edit is **not** recorded as an owner edit, so it produces **no `ownerLabels` and no `driver='owner'`**. Routing a Swap through the ask box would change the document and leave the change **unattributed** — the exact gate failure Decision B exists to prevent. **A deterministic swap must NOT go through `ai-edit`.** |
| **`override_value` / `override_state`** | — | — | `grep -rn "override_value\|override_state\|overrideValue" api/src app/src` → **0 hits** | **`ABSENT` — the names in the brief do not exist anywhere.** The override concept is `correction`. |
| **The target surface for the control** | `AssetBlocks.jsx` field card; `BLOCK_HOOKS.keywordDetail` panel at `:836-858`; kept-wording `Tweak this` at `:779-788` via `seedAskReword` (`:520-523`) | rendered per merge field | `sed -n '770,860p' app/src/screens/AssetBlocks.jsx` — the keyword panel has **no action controls at all** today | **`EXISTS`** — the panel exists and is empty of actions. But see the SCOPE DECISION below: the panel may be the **wrong** host. |
| **Splitting a skills field into its items (to name the phrase to replace)** | `splitItems(block)` (`assetBlocks.js:76-85`), mirroring `swaps.ts` | the field card's item list; `itemsOf`/`itemCountOf` | `sed -n '74,90p' app/src/assetBlocks.js` | **`EXISTS`** — the current items are already enumerated client-side, so `phrase` for `owner-edit` is available with no new derivation. |
| **`data-qc` hooks for anything new** | `BLOCK_HOOKS` (`assetBlocks.js:50-70`) | `assetGate.test.mjs` unions the four hook maps to catch a cross-screen collision; the block-hook tests assert every key is rendered and unique | `sed -n '50,71p' app/src/assetBlocks.js` | **`EXISTS` — new keys are mandatory and enforced.** |
| **The live-UI proof harness** | `.github/workflows/ui-verify.yml` + `scripts/ui-verify.mjs` | this session | `sed -n '1,45p' .github/workflows/ui-verify.yml` — inputs `route, owner, expect, expect_absent, click_sel, count_sel, count_min, count_max, measure_sel` | **`EXISTS`** — and `click_sel` is what reaches a control behind a chip click. |
| **The live-DB proof harness** | `.github/workflows/db-query.yml` (`sql` input) | this session | `CLAUDE.md` "Query the live DB" | **`EXISTS`** |
| **Local schema execution against a POPULATED prior schema** | container PostgreSQL 16.13 | — | `CLAUDE.md` "Run the schema locally", `H39`/`H39b` | **`EXISTS` — mandatory for any new table.** |

### The two rows above that are the real work

Everything else is `EXISTS` or `ALREADY BUILT`. The genuinely new mechanisms are:

1. **A Slides table-cell reader** — `ABSENT`, swept on both sides. ~30 lines beside `templateText`.
2. **A per-owner bank store + seed route + read route + client fn** — the store is a fork (below);
   the route shape is `factsDerive`'s, reused rather than invented.

### SCOPE DECISION 1 — where the bank lives. State it, do not decide it silently.

Extend-don't-duplicate puts the burden of proof on a new table. Here is the honest accounting:

- **`library_entity` is the only existing per-owner, open-ended content store.** Using it costs:
  one `ALTER` to widen the `kind` CHECK; one `ALTER` to add `unique(owner_email, kind, name)` it
  does not have; an `is_demo = false` filter on every read; and it puts skills into the same table
  and the same **Library screen** that renders playbooks and templates.
- **A new `skill_bank_entry`** costs: one table in `SCHEMA_SQL`, one line in `EXPECTED_TABLES`, and
  a local populated-schema run. It gets `unique(owner_email, label_norm)` (idempotent re-seed),
  `source`/`source_ref`/`source_sha256`/`fetched_at` (staleness), and `origin` (which of the owner's
  two named sources produced it) **as first-class columns rather than as `content jsonb` keys** —
  and no fabricated demo rows anywhere near it.

**Inference, not proof — confidence high, and the owner should confirm:** the new table is the
better trade, because the *shape* the bank needs (a unique key for idempotency, a source hash for
staleness) is not expressible in `library_entity` without two ALTERs anyway, and the demo-seeding at
`appExtras.ts:86-89` is an active hazard. **This is a new TABLE, not a new SUBSYSTEM** — the seeder
extends `appFacts`'s derive/upsert/conflict pattern and the writer extends `owner-edit`. If the
owner prefers `library_entity`, every AC below holds with `skill_bank_entry` read as
`library_entity where kind='skill' and is_demo=false`.

### SCOPE DECISION 2 — which control, and where it lives

The prototype puts `Swap for another skill…` inside the **keyword detail panel**, where it means
*"replace the skill this keyword displaced"*. **In this app that sentence has no referent**: the
panel says the keyword *"counts toward nothing"*, there is no "took the place of" line, and
`PULL-CANDIDATES.md:64-75` (PC-3) records that displacement is **undecidable**, not merely
unsourced. Putting a swap there re-imports the false claim two inches under the sentence that
denies it.

**The control belongs on the SKILLS FIELD's item list**, where the thing being swapped is a real,
nameable string that `owner-edit` can locate exactly once. This is a divergence from the prototype
and it is the app being right. **ACs below are written for the field-item host.** If the owner wants
it in the keyword panel too, that is a second mount of the same control and adds no data.

### Staleness — reuse, do not invent

- `correction.before_sha256` — *"a field edited by hand after the correction is DETECTED and the
  revert refuses"* (`schema.ts:399-402`). Same idea, applied to the source document.
- `owner_fact.confirmed_at` + `source` — *"Never overwrite something the owner confirmed"*
  (`appFacts.ts:92-94`), and `factsDerive` **surfaces conflicts instead of resolving them**
  (`appFacts.ts:111-119`).
- `term_library.published_at` — versioning, not needed here.

**So: `source_sha256` + `fetched_at` per entry, plus the `factsDerive` conflict-surfacing rule.**
No new staleness concept.

---

## PART 2 — ACCEPTANCE CRITERIA

**TIER: 1 — accusation grade.** Justified from the code path, not the size: a `Swap` writes a
`correction(source='owner_edit')`, which `writeSwaps` reads as `ownerLabels`, which sets
`driver='owner'`, which `appSwaps.ts:123` excludes from `unattributed`, which P2.2 / `changes_cited`
blocks on. A one-line UI control here can move a gate. Separately, the bank asserts *"these are the
owner's skills"* — a claim about a person, which the no-fake-data rule treats as accusation-grade.

Binary and observable. Line numbers are current locations; every assertion is written to survive a
move.

### (a) SEEDING

**S.0 — settle the source before writing a line of seeder.**
Given the owner named two sources, when the implementer begins, then a live read of BOTH documents'
**static text** has been captured and pasted into this file (or a sibling evidence doc) — the resume
Doc's non-token text and the portfolio deck's table cells — and each is labelled with the api-test
run id that produced it. **Until that exists, the number of real entries either source can yield is
unknown, and an AC that assumes a number is fiction.** *(Blocking. The measured fact from run
32973162995 is that the resume Doc's skills position holds two tokens; the portfolio deck's static
text has never been read by anything.)*

**S.1 — the sources are exactly the owner's two, named in data.**
Given a seed run, when it completes, then every stored entry carries an `origin` that is one of the
values the seeder can produce (`resume_template`, `portfolio_slide`, `master_context`,
`owner_added`), and a `source_ref` naming the document id or the MasterContext field it came from.
An entry with `origin` set and `source_ref` null does not exist. *(Observable: `select origin,
source_ref, count(*) … group by 1,2` over db-query.yml returns no null `source_ref` for a
non-`owner_added` row.)*

**S.2 — NO FABRICATION. The hard one.**
Given the seeder, when the implementation is inspected, then **there is no literal array of skill
strings anywhere in `api/src` or `app/src` that can reach the bank.** Every stored `label` is a
substring of text the seeder read from Google or from MasterContext in that same run.
*Regression guard (source grep, because it is a structural rule a runtime test cannot express):* an
H-case `H:skill-bank-no-literal-seed` asserts no module that writes `skill_bank_entry` contains a
string-array literal of length ≥ 3 whose elements are not column/enum names — modelled on the
`DEFAULT_LIBRARY` anti-pattern at `appExtras.ts:71-77`, which is precisely the failure being
forbidden. **Mutation proof required:** add a three-element literal to the seeder, confirm the suite
fails, remove it.

**S.3 — a parse that finds nothing REPORTS nothing, loudly.**
Given a source document that yields zero parsed skills, when the seed route returns, then the
response body carries `{ ok: true, entries: 0, sources: [...], warnings: ["<source> yielded no
skills: <reason>"] }` and **the bank is unchanged**. A zero result is never reported as a plain
success with an empty array and no explanation. *(Standing rule: "absent evidence is
`not_applicable`, never `pass`"; and "a 200 with a zero count is a result to investigate".)*

**S.4 — an unreachable source is distinguishable from an empty one.**
Given Google returns non-2xx (or the OAuth token is absent), when the seed route runs, then
`sources` contains `"<source> UNREADABLE: <status/message>"` — the exact shape `appFacts.ts:42`
already uses — and the route still returns 200 with `ok: false`, and **no entries are deleted**.
*(Edge: a transient Google 500 must never empty a populated bank.)*

**S.5 — idempotency.**
Given a bank seeded from a source, when the same seed route is called again with the source
unchanged, then the entry count is identical, no entry's `id` changes, and `fetched_at` is refreshed
while `label` is untouched. *(Observable via db-query.yml: `select count(*), count(distinct id)`
before/after are equal.)*

**S.6 — re-seed after the source CHANGES surfaces the difference, it does not silently swallow it.**
Given an entry whose `source_sha256` no longer matches the source document, when a re-seed runs,
then the response reports it under `changed: [{label, from, to}]` and the entry is updated — and an
entry the owner **added or edited by hand** (`origin='owner_added'`, or a `pinned_at` set) is
**never** overwritten, exactly as `appFacts.ts:92-94` protects a confirmed fact.

**S.7 — deduplication across the two sources is exact, never fuzzy.**
Given the same skill appears in both the resume baseline and the portfolio column, when seeding
completes, then it is stored **once**, keyed by a normalised label, and the surviving row records
both origins (or the first-wins rule is stated in the response). Normalisation is
case/whitespace/trailing-punctuation only — the `normLabel` shape at `assetBlocks.js:99` — and
**no similarity scoring is used**, because the key decides identity and identity is
accusation-grade (`H4` / the standing "fuzzy is for RANKING, never ACCUSING" rule).

**S.8 — owner scoping.**
Given two owners, when each seeds, then `select distinct owner_email from skill_bank_entry` shows
each owner's rows separately, and a `GET` without `?owner=` resolves to `demo@executive-engine.local`
and returns **that** owner's rows — never another's. *(Regression guard `H:skill-bank-owner-scoped`:
the read query's `where` clause contains `owner_email = $` — the same class of guard the `persona`
global-unique incident earned.)*

**S.9 — MasterContext is global; the bank must not launder that into a cross-owner leak.**
Given `MasterContext` has one partition and no owner column (`appFacts.ts:45-47`), when owner B
seeds, then the entries written carry `owner_email = B` **and** a `source_ref` that says
`master_context:<field>` so the provenance is visible. **An AC-level warning, recorded here so it is
not discovered later:** this means owner B's bank is seeded from owner A's profile text. The seed
route being `requireWrite`-gated makes that a signed-in-owner-only action today; **if the product
ever has a second real owner, this becomes a data-separation defect and must be revisited.**

**S.10 — the schema change is EXECUTED, not read.**
Given a new table, when it is proposed, then `SCHEMA_SQL` from this branch has been applied on top
of **`origin/main`'s `SCHEMA_SQL` already applied and seeded with rows**, with
`psql -v ON_ERROR_STOP=1`, exiting 0. The table is in `EXPECTED_TABLES`. *(H39/H39b; the two
migration-killing defects this rule was written for were both invisible on a fresh DB.)*

### (b) UI — the select and the `Swap` button

**U.1 — the control exists and is reachable.**
Given a resume asset with a `SkillsBullets1` or `SkillsBullets2` field and a non-empty bank, when
the field card renders, then a `<select>` carrying `data-qc={BLOCK_HOOKS.skillSwapSelect}` and a
button carrying `data-qc={BLOCK_HOOKS.skillSwapAction}` are present, and the select's option count
equals the bank's entry count for that owner (minus U.4's exclusions).

**U.2 — the select offers REAL entries only.**
Given the bank, when the select renders, then every `<option>`'s value is a `skill_bank_entry.id`
and its text is that row's `label`. There is no hardcoded option, no placeholder skill, and the
first option is a non-selectable prompt (`Swap for another skill…`) whose value is empty.

**U.3 — EMPTY BANK: the control is absent, not broken, and says why.**
Given the bank has zero entries for this owner, when the field renders, then **the select and the
Swap button are not rendered at all** and a single line carrying
`data-qc={BLOCK_HOOKS.skillSwapEmpty}` reads that there is nothing to swap in yet and names where to
fill it. *(No-dead-UI: "If a feature isn't ready, hide the control — don't fake it." A disabled
select with zero options is a dead control.)*

**U.4 — a skill already in this field is not offered.**
Given a bank entry whose normalised label equals a normalised item already in this field's text
(`splitItems(row.after_text)`), when the select renders, then that entry is **absent** from the
options. *(Edge named in the brief. Exact normalisation only — S.7's rule.)*

**U.5 — ONE entry in the bank still works.**
Given exactly one eligible entry, when the field renders, then the select renders with the prompt
option plus that one option, and Swap is reachable. *(Explicit because "n≥2" assumptions are how a
one-row edge ships broken.)*

**U.6 — the button is inert until a choice is made.**
Given no option selected, when the reader focuses Swap, then it is `disabled` (and
`aria-disabled`), and clicking it issues no network call. *(Observable: `count_sel` on
`[data-qc="blocks-skill-swap-action"][disabled]` = 1 before selection.)*

**U.7 — which item is being replaced is EXPLICIT, never inferred.**
Given the field has N items, when the reader opens the swap control, then the control names the
item that will be replaced — either because the control is mounted per item, or because a second
select chooses it. **There is no "replace the first/best-matching item" behaviour.** *(This is the
accusation-grade rule applied to the reader's own document: `owner-edit` refuses a phrase it cannot
locate exactly once, and the UI must not paper over that by guessing.)*

**U.8 — keyboard access.**
Given a keyboard-only reader, when they Tab to the select, choose with arrows, Tab to Swap and press
Enter or Space, then the swap is submitted. Any non-native control carries `role="button"`,
`tabIndex={0}` and an `onKeyDown` handling `Enter` and `' '` with `preventDefault()` — the pattern
already at `AssetBlocks.jsx:780-788` and `:806-812`.

**U.9 — static fields are excluded.**
Given a field where `shapeOf(row) === 'static'` or `artifactId` is falsy, when it renders, then no
swap control appears — matching the existing `artifactId && !isStatic` guard at
`AssetBlocks.jsx:779`.

**U.10 — hook hygiene.**
Given the new `BLOCK_HOOKS` keys, when the app test suite runs, then every new key is rendered by a
component, none is hand-typed as a string literal in JSX, all values are unique, and the
cross-screen union in `assetGate.test.mjs` shows no collision. *(Already-enforced; named so it is
not skipped.)*

**U.11 — regression guard for (b).**
An H-case / app test `H:skill-bank-empty-hides-control` asserts that with an empty bank the rendered
markup contains **no** `blocks-skill-swap-select`. **Mutation proof:** change the render condition to
always mount the select, confirm the test fails, revert.

### (c) THE WRITE

**W.1 — it goes through the EXISTING path.**
Given a reader presses Swap, when the request is sent, then it is exactly
`api.ownerEdit(artifactId, { merge_field: row.merge_field, phrase: <the named current item>,
replacement: <the chosen entry's label> })` → `POST /app/artifact/{id}/owner-edit`.
*Regression guard `H:skill-swap-uses-owner-edit` (source grep): the swap handler contains no
`aiEditArtifact`, no direct `swap_decision` write, and no new route.* **Mutation proof:** repoint the
handler at `aiEditArtifact`, confirm the guard fails, revert.

**W.2 — it does NOT write to the build's audit tables.**
Given a swap, when it completes, then no row is inserted into `swap_decision` or `skill_candidate`
by any UI-reachable code path. *(`writeSwaps` deletes and re-inserts both on every build — a UI
write there is destroyed by the next run and corrupts the build record in the meantime.
`appCorrections.ts:303-306` records this reasoning already.)*

**W.3 — a refusal is a visible outcome, not an error toast.**
Given the phrase does not occur exactly once in the field (it moved, or it appears twice), when the
route returns `200 {ok:false, reason}`, then the reason is rendered **in place, in the owner's own
words**, the select keeps its selection, and nothing in the document changed.
*(`appCorrections.ts:307-310`: *"A REFUSAL IS A SUCCESSFUL OUTCOME … A 4xx would be swallowed by a
generic error path and the owner told nothing."*)*

**W.4 — a no-op is refused.**
Given the chosen entry's label equals the item being replaced, when Swap is pressed, then the route
returns `ok:false` with *"that is the same wording it already has"* and the UI shows it.
*(Already implemented at `appCorrections.ts:337-339`; the AC is that the UI surfaces it.)*

**W.5 — the swap is UNDOABLE.**
Given a completed swap, when the reader opens the field's change log
(`BLOCK_HOOKS.fieldChangeLog`), then the swap appears there as a `correction` with
`source='owner_edit'` — rendered by the existing selector as *"you changed this yourself"*
(`assetGate.js:446`) — and the existing revert route removes it. **No new undo mechanism.**

**W.6 — the field text actually changed, and only there.**
Given a swap on `SkillsBullets1`, when it returns `ok:true`, then `packet.pkg_json.SkillsBullets1`
contains the new label and no longer contains the replaced phrase, and `SkillsBullets2` is
byte-identical to before. *(Observable via db-query.yml on `packet.pkg_json`.)*

**W.7 — the gate consequence is REAL and is stated, not discovered.**
Given a swap and then a rebuild, when `writeSwaps` runs, then the swapped-in label appears in
`ownerLabels` and its `swap_decision` row carries `driver='owner'`, and `swapsGet`'s `unattributed`
does **not** count it. *(This is the tier-1 path. It must be exercised, not assumed —
see V.W7.)*

**W.8 — regression guard for (c).**
`H:owner-swap-is-attributed` asserts `buildSwaps` still maps an `ownerLabels` hit to
`driver='owner'` and that `appSwaps.ts`'s `unattributed` filter still excludes `'owner'`.
**Mutation proof:** drop `'owner'` from the exclusion, confirm the test fails, revert. *(If this
mutation is behaviourally equivalent for the fixture in hand, say so and do not claim the assertion
is proven.)*

### CONFIG CHECK (no-hardcoded-config rule)

| Setting | Where it lives | Verdict |
|---|---|---|
| Which document the resume baseline is read from | **already a setting** — `google.resumeTemplateId`, resolved by `metaFor`/`loadPipelineSettings` (`packetTemplates.ts:63-120`, `diagDocStructure.ts:128-135`) | reuse, add nothing |
| Which document the portfolio column is read from | **already a setting** — `google.portfolioTemplateId` (`OVERRIDE_KEY.portfolio`, `packetTemplates.ts:87`) | reuse, add nothing |
| **Which sources feed the bank** (resume baseline / portfolio column / MasterContext pool / all) | **DOES NOT EXIST — must be added.** A per-owner toggle set, seeded to "all three on", changeable in Settings. Code may seed the first value only. | **new setting required** |
| **Can the owner add a skill by hand?** | **Must be yes** — `origin='owner_added'`, and S.6 protects it from re-seed. Without it the bank is a black box the owner cannot fix, which is exactly what the rule forbids. | **new UI required** |
| **Can the owner remove/hide a bank entry?** | Must be yes, and **reversible** (a `hidden_at`, not a DELETE) — "prefer reversible over destructive". | **new UI required** |
| A cap on the number of options in the select | **NONE, deliberately.** The prototype's 57-item array is a fixture, not a rule; a real bank's size is a fact about the owner's profile and truncating it would hide their own skills. If it proves unwieldy, the fix is search-in-select, not a cap. | **stated, not implemented** |
| Normalisation rules for dedupe | **code-only, and that is correct** — it is a structural identity rule like `MC_KIND`, not a tunable (`evidence.ts:121-123` makes the same distinction). | **code-only, justified** |

---

## PART 3 — VERIFICATION PLAN

The sandbox cannot reach Google, `azurewebsites.net`, or `*.azurestaticapps.net`. Everything below
names the harness that CAN.

| AC | Test | Harness | Exact input |
|---|---|---|---|
| **S.0** | Read the two documents' static text | `api-test.yml` — **needs a route that does not exist yet**; the cheapest is `GET /api/diag/doc-structure?type=resume&text=1` extended to echo non-token runs, plus a `?templateId=<portfolio>&slides=1` mode. **This is a deliverable, not a test.** | `{method:GET, path:"/api/diag/doc-structure?type=resume"}` today returns the fingerprint only — confirmed by reading `diagDocStructure.ts:26-100` |
| **S.1, S.5, S.6, S.7, S.8** | Row-level assertions on the seeded bank | `db-query.yml` | `sql: "select owner_email, origin, source_ref, count(*) n, count(distinct label_norm) d from skill_bank_entry group by 1,2,3 order by 1,2"` — then re-seed and re-run; `n` and `d` must be unchanged and equal |
| **S.2** | No literal seed array | local `node --test api/test/hardening.test.mjs` | source grep H-case + **mutation** |
| **S.3, S.4** | Zero-yield and unreachable-source responses | `api-test.yml` | `{method:POST, path:"/api/app/qc/skill-bank/seed?owner=von.ellis@enterpriseds.io", body:"{\"sources\":[\"portfolio_slide\"]}"}` → read the job log for `entries`, `sources`, `warnings`. **S.4's unreachable branch cannot be forced from here** — the Function's Google token is live. Provable instead by a unit test over the seeder's pure part with a fetch stub, plus reading `sources` on a real run. **Say so; do not claim S.4 proven from a live 200.** |
| **S.10** | Schema executes on a populated prior schema | local `psql` | the exact recipe in `CLAUDE.md` "Run the schema locally": apply `origin/main`'s `SCHEMA_SQL`, insert real rows, then apply this branch's with `ON_ERROR_STOP=1` |
| **U.1, U.2, U.5** | The select renders with real options | `ui-verify.yml` | `{route:"#/packet/<packetId>/resume", owner:"von.ellis@enterpriseds.io", click_sel:"[data-qc=\"blocks-skill-swap-open\"]", count_sel:"[data-qc=\"blocks-skill-swap-select\"] option", count_min:"2"}` — `count_min 2` = the prompt option plus at least one real entry |
| **U.3** | Empty bank hides the control | `ui-verify.yml` | Against an owner with an empty bank: `{route:"#/packet/<id>/resume", owner:"demo@executive-engine.local", count_sel:"[data-qc=\"blocks-skill-swap-select\"]", count_max:"0", expect:"nothing to swap in yet"}` |
| **U.4** | An in-field skill is not offered | local unit test over the pure selector (`eligibleBankEntries(bank, fieldText)`) in `app/test/` | assert an entry equal to an existing item is filtered; **mutation:** remove the filter, test fails |
| **U.6** | Disabled until chosen | `ui-verify.yml` | `{count_sel:"[data-qc=\"blocks-skill-swap-action\"][disabled]", count_min:"1", count_max:"1"}` before any selection |
| **U.7** | The replaced item is named | `ui-verify.yml` | `expect` the item's own text inside the control's container; **and** a unit test that the handler's `phrase` argument comes from an explicit selection, never from `items[0]` |
| **U.8** | Keyboard | local component/DOM test asserting `onKeyDown` handles `Enter` and `' '` with `preventDefault` — the same assertion shape already used for `wordingAsk` | — |
| **U.10** | Hook hygiene | local `app/test/` suite (already exists) | — |
| **W.1, W.2** | Correct route, no audit-table write | local source-grep H-cases + **mutation** each | — |
| **W.3, W.4** | Refusal surfaces in place | `api-test.yml` for the route's behaviour: `{method:POST, path:"/api/app/artifact/<id>/owner-edit?owner=…", body:"{\"merge_field\":\"SkillsBullets1\",\"phrase\":\"<a phrase that is not there>\",\"replacement\":\"X\"}"}` → expect `200 {ok:false, reason:…}`. Then `ui-verify.yml` with `expect:"<the reason text>"` after a `click_sel` on Swap | two runs |
| **W.6** | Only the target field changed | `db-query.yml` before and after | `sql: "select md5(pkg_json->>'SkillsBullets1') a, md5(pkg_json->>'SkillsBullets2') b, length(pkg_json::text) n from packet where id='<uuid>'"` |
| **W.7** | The gate path is real | `api-test.yml`, three calls in order: (1) `owner-edit` a skill; (2) `POST /api/app/opportunity/<oppId>/packet/build-all` (`appPackets.ts:1534` — the only build route registered in that file; confirmed by `grep -rn "app.http" api/src/functions/tests/appPackets.ts \| grep -iE "build\|regen"`) to run `writeSwaps`; (3) `GET /api/app/packet/<id>/swaps?owner=…` and read `current[].driver` and `unattributed` | **This is the tier-1 proof and it is the one most likely to be skipped.** A rebuild is expensive (~200s per `DEFERRED.md:149`); background it, do not block |

**What cannot be proven from here, stated plainly:**
- **S.0** — until a text-returning diag route exists, nobody knows what either document contains at
  the skills position. Everything about "how many entries" is unknown, not small.
- **S.4's unreachable-Google branch** — the live Function has a working token; the failure path is
  provable only by a stubbed unit test.
- **S.9's cross-owner concern** — there is one real owner, so the leak is latent and untestable.
- Anything about `MasterContext.softHardSkillsPool` being **non-empty** — no route returns it.

---

## PART 4 — SIZE AND SEQUENCE

| # | Part | Size | Depends on | Parallel with |
|---|---|---|---|---|
| **0** | **Text-dump diag route** (extend `diagDocStructure` with the document's non-token text, and add a Slides mode) — *settles S.0* | **XS** (~20 lines, one existing file) | nothing | — |
| **1** | **`slidesTable(token, id)`** beside `templateText` — the only genuinely absent mechanism | **S** (~30 lines) | 0 tells you whether it is needed at all | 2 |
| **2** | **`skill_bank_entry` in `SCHEMA_SQL` + `EXPECTED_TABLES`** + local populated-schema run | **S** | Scope Decision 1 | 1 |
| **3** | **Seed route** `POST /app/qc/skill-bank/seed` — the `factsDerive` shape, reused | **M** | 1, 2 | — |
| **4** | **Read route** `GET /app/qc/skill-bank?owner=` + `api.js` client fn | **XS** | 2 | 3 |
| **5** | **Settings**: source toggles, add-by-hand, hide-entry | **M** | 4 | 6 |
| **6** | **UI control** in `AssetBlocks.jsx` + `BLOCK_HOOKS` keys + `eligibleBankEntries` selector | **M** | 4 | 5 |
| **7** | **Wire `Swap` → `api.ownerEdit`** + refusal rendering | **XS** — the route and the client fn already exist | 6 | — |
| **8** | **Guards + mutation proofs** (S.2, S.8, U.11, W.1, W.8) | **S**, and **never skipped** | each part | — |
| **9** | **Live verification** (Part 3) incl. the W.7 rebuild | **M**, mostly waiting — **background it** | 7, 8 | — |

**What must land first:** step 0. It is the smallest thing in the list and it decides whether steps
1 and 3 have anything to read. Building the seeder before knowing what the documents contain is the
exact failure the feasibility rule exists to prevent.

**What parallelises:** 1 ∥ 2, then 3 ∥ 4, then 5 ∥ 6.

**The one genuine fork the owner must settle** (everything else is already decided by evidence):

> **Scope Decision 1 — `skill_bank_entry` (new table) vs `library_entity` (extend).**
> The recommendation is the new table, for the two ALTERs and the demo-seeding hazard named above.
> **Confidence: high on the facts (`library_entity` has no unique constraint —
> `sed -n '156,167p' schema.ts`; `libraryList` inserts four `is_demo:true` fabricated rows —
> `appExtras.ts:80-92`); the trade-off itself is a judgement and the owner may prefer otherwise.**

**Scope Decision 2 (field-item host, not keyword panel) is NOT a fork** — the keyword panel cannot
host it without re-importing the displacement claim that `PULL-CANDIDATES.md:64-75` records as
undecidable. It is stated so an implementer does not "restore prototype parity" by moving it.

**Not in scope, and deliberately:** 4.6-10 (*"Drop it, leave the line open"*) — Group C's `ABSENT`
writer verdict stands for that one, because a keyword decline has no store and the app's own panel
says the keyword *"counts toward nothing"*. 4.6-11 is separate and cheap (`seedAskReword` already
exists; it is one call site on a sibling panel).

---

## Investigation log (append-only — written as the work proceeded)

- [t0] File created before any investigation (two prior attempts died within 1s and left nothing).
- [t1] Read `AC-large-medium.md` Group C (lines 188-260). Its 4.6-9 `ABSENT` verdict rests on
  `grep -rniE "skill_candidate|skill_bank|skillBank" api/src app/src` → 14 hits, all
  `skill_candidate`. Not re-derived.
- [t2] `templateText(token, id, isSlides)` EXISTS and is EXPORTED — `packetTemplates.ts:222`. Reads
  a Doc **or** a Slides deck; flattens all text. "Nothing can read Slides" is FALSE; "nothing can
  read a Slides *column*" is TRUE.
- [t3] `POST /api/app/qc/facts/derive` (`appFacts.ts:74`) is the precedent to EXTEND for the seeder.
- [t4] `profileRecords` reads MasterContext including `softHardSkillsPool` (`evidence.ts:149`) —
  which refutes `BACKLOG.md:325`'s *"never read by anything"*.
- [t5] **LIVE GROUND TRUTH** — `api-test.yml` run **32973162995**, job 98191413468,
  `GET /api/diag/template-placeholders` → HTTP 200. Resume Doc = 7 tokens, skills position is
  `{{SkillsBullets1}}`/`{{SkillsBullets2}}`. Portfolio deck = 7 `@` tokens, **none skills**.
- [t6] `SPEC.md:228` says *"from the profile's **skill bank**"* → ORIGIN is SPEC, not the prototype.
- [t7] **`POST /app/artifact/{id}/owner-edit` EXISTS** (`appCorrections.ts:321`) with
  `api.js:197 ownerEdit` and **zero UI consumers**. Group C's "no writer" is refuted for 4.6-9.
- [t8] `artifactAiEdit` writes **no** `correction` row (`appPackets.ts:1440-1450`) → routing a swap
  through the ask box would leave it `unattributed`. Named as a trap.
- [t9] `library_entity` seeds four fabricated `is_demo:true` rows on first list
  (`appExtras.ts:80-92`) and has **no unique constraint** (`schema.ts:156-167`).
- [t10] `override_value` / `override_state` → **0 hits** repo-wide. The names in the brief do not
  exist.

## DONE

Feasibility table, ACs (a/b/c), config check, tier, verification plan and sequence are complete.
Open items requiring the owner: **Scope Decision 1** (new table vs `library_entity`) and the
**S.0** disambiguation of *"the template skills in the template"* (Google Doc — which holds two
tokens — vs the MasterContext baseline the owner has previously called "the template").

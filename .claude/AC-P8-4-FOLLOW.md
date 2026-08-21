# Acceptance criteria — P8.4 follow-on: D21, D23, D24

**Independent AC pass.** Written by an agent that implemented none of this, from a read of
`dimensions.ts`, `appDimensions.ts`, `ownerFacts.ts`, `checks.ts`, `schema.ts`,
`hardening.test.mjs`, `schemaParity.test.mjs`, `appFacts.ts`, `Settings.jsx`, `App.jsx` and
`api.js` at `8e4c46c`.

**Which rows these are.** `.claude/DEFERRED.md` has DUPLICATE row IDs across sections — there is a
`D21` and a `D23` in **P8.4 / comparison dimensions** and a different `D20`/`D21`/`D22` in **Live
but unconfirmed**. Everything below refers ONLY to the rows in the **`## P8.4 / comparison
dimensions`** table. Edit those rows, not their namesakes.

**How to read this.** Every AC is `Given / when / then` and is settled by EXECUTING something —
`node --test`, `psql`, `npm run build`, a GitHub Actions run. "Works correctly" is not an outcome.
An AC marked **[LIVE-ONLY]** cannot be settled in the sandbox at all; see
[What counts as NOT verified](#what-counts-as-not-verified) before claiming any of them.

Each row carries at least one AC labelled **[ADVERSARIAL]**. Those are written so that the obvious,
plausible-looking implementation FAILS them. If an adversarial AC passes on the first try, re-read
it — it is more likely mis-run than satisfied.

---

## Verification harness (set this up before AC-1)

```bash
# both builds green BEFORE any edit, so a later failure is attributable
cd api && npm ci && npm run build && cd ..
cd app && npm ci && npm run build && cd ..

# baseline counts, recorded and quoted in the completion report
cd api && node --test test/ 2>&1 | tail -5
cd app && node --test test/ 2>&1 | tail -5
```

PostgreSQL 16.13 is in this container (`/usr/lib/postgresql/16`). "Cannot reach the LIVE database"
is true; "there is no Postgres here" is false. Every schema AC below is executable locally and none
of them may be reported as blocked.

---

## D21 — register `comparison_dimension` in the schema

The table is created only by `ensureDimensionTable` (`appDimensions.ts`). It is in neither
`SCHEMA_SQL` nor `EXPECTED_TABLES`, so `diag/pg-migrate` never reports it and `H11` does not guard
it.

### Registration

**AC-D21-1.** Given `api/src/functions/tests/schema.ts`, when `SCHEMA_SQL` is dumped from the built
module (`node -e "import('./dist/functions/tests/schema.js').then(m=>process.stdout.write(m.SCHEMA_SQL))"`),
then the dump contains `create table if not exists comparison_dimension ` (or `…(`) — matched by the
same two forms `H11` accepts.

**AC-D21-2.** Given the same file, when `EXPECTED_TABLES` is read, then it contains the exact string
`'comparison_dimension'`.

**AC-D21-3.** Given `api/test/hardening.test.mjs`, when `H11`'s hand-maintained array is read, then
it contains `'comparison_dimension'`, and `node --test test/hardening.test.mjs` exits 0.

**AC-D21-4 [ADVERSARIAL — anti-vacuous].** Given the completed change, when the implementer deletes
`'comparison_dimension'` from `EXPECTED_TABLES` **and separately** deletes the `create table if not
exists comparison_dimension` statement from `SCHEMA_SQL`, then `H11` FAILS in each case with a
message naming the table — and the two failure outputs are pasted into the completion report before
the deletions are reverted. A guard that passes both with and without the thing it guards is
decoration. (This is the third place the D21 row says gets forgotten; proving it fires is what
distinguishes "added to the array" from "guarded".)

### Ordering and idempotence — the part that aborts a production migration

**AC-D21-5.** Given `SCHEMA_SQL`, when the `create table if not exists comparison_dimension`
statement is located, then it appears strictly AFTER the `create table if not exists opportunity`
statement (it declares `references opportunity(id) on delete cascade`) and after whatever creates
`uuid_generate_v4()`.

**AC-D21-6.** Given a fresh, empty PostgreSQL database, when `SCHEMA_SQL` (pgvector stubbed per
CLAUDE.md) is applied with `psql -v ON_ERROR_STOP=1`, then psql exits 0. `ON_ERROR_STOP=1` is
mandatory; without it psql reports success having skipped every statement after the first error.

**AC-D21-7.** Given a database built by applying `origin/main`'s `SCHEMA_SQL` (extracted from the
FILE via `git show origin/main:api/src/functions/tests/schema.ts`, never from a build of the
implementer's own branch) and then seeded with real rows in `persona`, `opportunity` and any table
the new statements touch, when the branch's `SCHEMA_SQL` is applied on top with
`ON_ERROR_STOP=1`, then psql exits 0.

**AC-D21-8 [ADVERSARIAL — the shortcut this row exists to catch].** Given the upgraded database from
AC-D21-7, when `information_schema.columns`, `pg_constraint` and `pg_indexes` are compared against a
FRESH database built from the branch's `SCHEMA_SQL` alone, then the two shapes are identical in both
directions. Any column, CHECK, UNIQUE or index that exists on the fresh database and not on the
upgraded one is a statement that reaches a new install and never reaches production. The fix is an
idempotent `alter table … add column if not exists` placed AFTER the create, never a reorder inside
the `create table` block. `node --test test/schemaParity.test.mjs` is the runnable form; it must
exit 0 and must NOT report itself skipped.

**AC-D21-9 [ADVERSARIAL — the blind spot in AC-D21-8].** Given that `origin/main`'s `SCHEMA_SQL`
does **not** contain `comparison_dimension` at all, when `schemaParity.test.mjs` builds its
"upgraded" database, then that database never had the table and the parity assertion above is
**structurally blind to it** — it will pass no matter what the new declaration says. So, in
addition to AC-D21-8, build a THIRD database that matches what production actually has:

```
db_prod  :=  origin/main's SCHEMA_SQL
          +  ensureDimensionTable()'s DDL, verbatim, as the ensure-path already ran there
          +  a few real comparison_dimension rows
          +  the branch's SCHEMA_SQL applied on top
```

Then `db_prod`'s shape for `comparison_dimension` (columns, constraint definitions, indexes) must
equal the shape on a fresh database built from the branch's `SCHEMA_SQL` alone, and the seeded rows
must survive. This is the only run that can fail; the other two cannot.

**AC-D21-10 [ADVERSARIAL].** Given AC-D21-9's `db_prod`, when the branch's `SCHEMA_SQL` declaration
of `comparison_dimension` differs in ANY column, CHECK or UNIQUE from `ensureDimensionTable`'s, then
the difference is applied by an idempotent `ALTER` (or `create index if not exists` /
`alter table … add constraint` guarded by a `do $$ … $$` existence check) that runs on `db_prod` and
makes the shapes match. A `create table if not exists` body is not a migration for a table that
already exists.

**AC-D21-11.** Given both DDL sources, when a new test builds one database from
`ensureDimensionTable` alone and another from `SCHEMA_SQL` alone and compares
`information_schema.columns` + `pg_constraint` + `pg_indexes` for `comparison_dimension`, then the
two are identical. This makes the two declarations un-divergable by construction rather than by
someone remembering to edit both. Encode it as an H-case with a **slug** (e.g.
`H:dimension-ddl-parity`) — never a new number.

**AC-D21-12.** Given `ensureDimensionTable`, when the change is complete, then it still exists and
is still called by `writeComparison` / `loadComparison` / `comparisonPayload`. Removing it makes
every request depend on a migration having been run; keeping it is idempotent and costs nothing.
If the implementer removes it anyway, that is a behaviour change and needs its own AC and sign-off.

**AC-D21-13.** Given `api/test/hardening.test.mjs`, when `H26` runs, then no new numeric H-ID has
been minted (H1–H44 are frozen) and every new slug is at least two hyphen-separated words.

**AC-D21-14 [LIVE-ONLY].** Given the deployed Function App after this lands on `main`, when
`GET /api/diag/pg-migrate` is called via `api-test.yml`, then `comparison_dimension` appears in its
completeness report as present. This is the outcome the D21 row actually asks for and it cannot be
observed from the sandbox.

**Not done if:** the table is registered but the migration was only ever run against a fresh
database; or `schemaParity.test.mjs` is cited as proof (AC-D21-9 explains why it cannot be); or a
column/constraint was added inside the `create table if not exists` body for a table production
already has.

---

## D23 — grade org size (`people`) and budget (`usd`) from their numbers

`checkAgainstFacts` computes `demanded` only when `def.unit === 'years'` (`ownerFacts.ts`), so
`scope.largest_team` and `scope.largest_budget` fall through to `unknown`, and
`dimensions.ts`'s `hasNumericComparator` returns false for them.

### One parser, extended — not a second one

**AC-D23-1.** Given `api/src/functions/tests/`, when `grep -rn` is run for a regular expression that
extracts a demanded figure from posting text, then exactly ONE module (`ownerFacts.ts`) contains
one, and it is exported. `dimensions.ts` imports it; it does not define its own.

**AC-D23-2 [ADVERSARIAL].** Given the completed change, when `dimensions.ts` is read, then it
contains no numeric-extraction regex of its own (no `\d` pattern applied to `textOf(r)` to derive a
demanded quantity). A second numeric parser is a second answer, and the two will disagree on the
first posting that is worded unusually. Encode as an H-case with a slug (e.g.
`H:one-demand-parser`) that greps `dimensions.ts` for the construct.

### Parsing the posting side

**AC-D23-3.** Given `unit: 'people'` and the requirement text `Lead a team of 250 engineers`, when
the demand parser runs, then it returns `250`. Note `demandedNumber`'s existing pattern is
`\d{1,2}` — two digits. A parser that caps at 99 silently mis-reads every org above one hundred,
which is most of the postings this dimension exists for.

**AC-D23-4.** Given `unit: 'people'`, when each of `team of 60`, `60+ engineers`,
`org of 1,200`, `12 direct reports`, `an organization of 450 people` is parsed, then each returns
the integer stated (60, 60, 1200, 12, 450). Thousands separators are stated explicitly because
`scope.largest_team`'s own `asks` matcher does not tolerate them and a posting that writes `1,200`
is common.

**AC-D23-5.** Given `unit: 'usd'`, when each of `$18M`, `$1.5B`, `budget of $750K`,
`P&L of $10 million`, `a $2.4 billion portfolio` is parsed, then each returns the value in DOLLARS
(18000000, 1500000000, 750000, 10000000, 2400000000) — not the bare digits. A comparator that
returns `18` for `$18M` compares eighteen dollars.

**AC-D23-6.** Given `unit: 'usd'` and the text `own the P&L for the division` (matches
`scope.largest_budget.asks` via `p&l`, states no figure), when `checkAgainstFacts` runs against a
confirmed budget fact, then the verdict is `unknown` with a detail asking the owner to confirm —
never `satisfied`. Absent evidence is `unknown`, never a pass.

**AC-D23-7.** Given `unit: 'years'` and every input in the existing `api/test/ownerFacts.test.mjs`,
when the suite runs unmodified, then it exits 0. The years path is not to change. If any existing
expectation is EDITED, the completion report must name the test, quote the before and after, and
justify the change — a test edited to match new behaviour is how a regression ships.

### The scale trap on the OWNER's side

**AC-D23-8 [ADVERSARIAL — this is the one the obvious implementation fails].** Given the owner
recorded their budget through **Settings ▸ Facts**, where `Settings.jsx`'s save does
`Number(String(value).replace(/[^0-9.]/g, ''))` — so typing `$18M` stores
`value: '$18M', value_num: 18` — and given the requirement `Own a $10M P&L`, when
`checkAgainstFacts` runs, then the verdict is `satisfied`. An implementation that trusts
`value_num` compares `18 >= 10000000` and tells an owner who runs an $18M budget that they fall
short. Note `deriveFacts` writes the SAME logical fact as `value_num: 18000000`, so the two
recording paths disagree by six orders of magnitude on the same database.

**AC-D23-9 [ADVERSARIAL — the mirror of AC-D23-8].** Given a fact recorded as
`value: '$18K', value_num: 18000` and the requirement `Own a $10M P&L`, when `checkAgainstFacts`
runs, then the verdict is `not_satisfied`. Whatever normalization AC-D23-8 requires must not rescale
a genuinely small figure upward to make it pass — that would turn a shortfall into a pass, which is
strictly worse than the bug being fixed.

**AC-D23-10.** Given AC-D23-8 and AC-D23-9, when the fix is described in the completion report, then
it names which side was normalized and where. Two defensible shapes: (a) re-derive the magnitude from
`fact.value`'s text when `unit === 'usd'` and use `value_num` only as a tiebreak; (b) fix the writer
so `value_num` is always dollars, and backfill. Shape (b) changes stored data and needs an explicit
migration AC plus a `db-query.yml` audit of existing `owner_fact` rows — it may not be done silently.

**AC-D23-11.** Given `unit: 'people'`, when the same Settings path stores `60 engineers` as
`value_num: 60`, then no rescaling occurs — people are already a bare count and the AC-D23-8 fix
must be unit-scoped, not applied to every numeric fact.

**AC-D23-12.** Given a satisfied or not_satisfied `people`/`usd` verdict, when `FactCheck.detail` is
read, then it reads in the recorded units (`"$18M owned, $10M required"`, `"300 people led, 250
required"`) and not `"18000000 usd recorded, 10000000 required"`. `factUnit()` currently returns the
raw enum and `dimensions.ts` interpolates it straight into `note`, which is the string the owner
reads on the JD step.

### The downstream consumer — where a half-fix silently no-ops

**AC-D23-13 [ADVERSARIAL].** Given `hasNumericComparator` widened to accept `people` and `usd`, and
given a confirmed `scope.largest_team` of 300 and a posting line `Lead a team of 250 engineers`, when
`buildComparison` runs, then the `organization_size` row is
`fit:'strong', basis:'fact', numeric_verdict:'satisfied', covered:1, total:1` and its `profile.source`
is `'fact'`. If only `hasNumericComparator` is widened, `buildComparison`'s fact path still calls
`demandedNumber(textOf(r))`, which returns null for text containing no `years`, so the loop
`continue`s, falls through to the evidence path, and the row silently reverts to `basis:'evidence'`
— the change ships and does nothing. This AC fails in exactly that case.

**AC-D23-14.** Given a confirmed `scope.largest_budget` of $18M and a posting line
`Own a $25M P&L`, when `buildComparison` runs, then the `budget_owned` row is
`fit:'weak', basis:'fact', numeric_verdict:'not_satisfied', shortfall:'falls_short'` and `note` is
non-empty (the database CHECK rejects a moderate/weak row with no note, so a null here is a 500 in
production, not a cosmetic miss).

**AC-D23-15.** Given the `uncomparableFact` branch in `buildComparison` — which currently returns
`not_applicable` with the reason "this system cannot yet compare people/usd to the figure in the
posting" and sets `numeric_verdict:'unavailable'` — when the comparators exist, then that reason
string is no longer reachable for `organization_size` / `budget_owned`, and either the branch is
narrowed to the axes that genuinely have no comparator or it is removed. A code path whose message
asserts a limitation that no longer exists is a lie the product prints.

**AC-D23-16.** Given `DIMENSION_VERSION` (`dimensions.ts`, documented as "bumped when the seeded
set, a matcher, or a grading rule changes"), when a grading rule changes as it does here, then
`DIMENSION_VERSION` is bumped and existing stored rows remain findable by their old version.

**AC-D23-17.** Given the long comment blocks in `dimensions.ts` (the module header's failure mode 3,
`hasNumericComparator`'s doc) and in `appDimensions.ts` that state as fact that `people` and `usd`
fall through to `unknown`, when the change lands, then those comments are updated. They cite line
numbers and a measured behaviour; leaving them turns the most-read documentation in the file into a
false statement.

### Blast radius — traced, not assumed

**AC-D23-18.** Given `checks.ts`, when the change lands, then `coverable` membership is
**unchanged**, and a test proves it: `ownedByFacts` is built from ALL `factVerdicts` including
`unknown`, and `resolvedByFact` is a subset of it, so a row moving from `unknown` to
`satisfied`/`not_satisfied` leaves both `coverable` and `must_have_coverage`'s denominator
identical. Assert the denominator explicitly before and after on the same fixture. (This mirrors
D22's finding; do not assume it, measure it.)

**AC-D23-19.** Given the same change, when `runChecks` is run on a fixture whose must-haves include a
`people` and a `usd` requirement, then the check rows that DO change are named in the completion
report with before/after states — expected: `facts_needed` loses those rows, `facts_settled` gains
the satisfied ones, and `fact_shortfall` (state `warn`) gains the short ones.

**AC-D23-20.** Given AC-D23-19's `fact_shortfall` gaining rows, when the artifact gate is computed
for that fixture, then the report states whether the gate's pass/fail changed. A requirement that
was silently `not_applicable` and is now a `warn` is a visible product change; it may be the right
one, but it may not ship undeclared.

**AC-D23-21 [ADVERSARIAL — the selection collision that survives this fix].** Given the requirement
text `Lead a team of 60 engineers and bring 10+ years of experience`, when `selectFactDef` runs,
then it returns `experience.years_total` — because that text matches BOTH `experience.years_total`
and `scope.largest_team`, there is no `refines` link between them (neither is a subset of the
other), and `survivors[0]` falls back to catalogue order. Pin this with a test and state the
consequence in the completion report: on a mixed line the org-size fact is still never selected by
`checkAgainstFacts`, so D23's arithmetic reaches `dimensions.ts` (which selects by
`DimensionDef.factKeys`, not by the catalogue scan) but not the GATE. The implementer must NOT
"fix" this by reordering `FACT_CATALOGUE` (that silently changes which requirements every gate
treats as settled, across the whole corpus) nor by declaring a `refines` link that is not a true
subset relation — `H41` measures undeclared strict-subset relations and a false declaration is a
lie to that guard.

**AC-D23-22.** Given the whole api suite, when `node --test test/` runs, then it exits 0 and the
passing count is greater than or equal to the baseline recorded in the harness step. A drop is a
regression regardless of what the new tests do.

**AC-D23-23.** Given the change, then at least one H-case with a slug guards the invariant that a
`usd` fact and a `usd` demand are compared on the same scale (e.g. `H:usd-scale-parity`), with the
measured evidence in its comment: `Settings.jsx` stores `$18M` as `18`, `deriveFacts` stores it as
`18000000`.

**AC-D23-24 [LIVE-ONLY].** Given real data, when `db-query.yml` runs
`select key, value, value_num from owner_fact where key in ('scope.largest_team','scope.largest_budget')`,
then the report states how many live rows have a `value_num` on the wrong scale. Until this is run
the size of the AC-D23-8 problem in production is unknown.

**Not done if:** `hasNumericComparator` was widened but `buildComparison` still calls the
years-only parser (AC-D23-13); or a second parser was added in `dimensions.ts`; or the fix was
verified only against `deriveFacts`-recorded facts and never against a Settings-recorded one.

---

## D24 — a Settings control for the dimension set

`GET/POST /api/app/dimension-prefs` exists and round-trips. There is no UI, so the owner cannot
change their set without hand-written SQL — the exact shape `appDimensions.ts`'s own comment calls
out as "the no-hardcoded-config rule satisfied on paper and not in the product".

**AC-D24-1.** Given the app, when the owner navigates to the new Settings section (a `SECTIONS`
entry in `Settings.jsx` plus its render branch, reachable at `#/settings/<key>` — `App.jsx` routes
`parts[1]` generically, so no router change is needed), then the section renders without console
errors and appears in the tab strip.

**AC-D24-2.** Given a signed-in owner, when the section mounts, then it issues exactly one
`GET /api/app/dimension-prefs?owner=<email>` and renders `stored`, `seed`, `catalogue` and
`defaultKey` from that ONE response.

**AC-D24-3 [ADVERSARIAL].** Given the new `api.js` function, when it is read, then it appends
`?owner=${encodeURIComponent(_owner)}` to BOTH the GET and the POST. `resolveOwner` falls back to
`demo@executive-engine.local` when no `?owner=` is present and no verified session decodes, so a
call without it silently reads and writes the shared demo sandbox while appearing to succeed. This
already bit `listPersonas`. Prove it by asserting the request URL in a test, not by reading the
code.

**AC-D24-4.** Given `stored` is `null` for a family, when that family's row renders, then the
checkboxes are pre-checked from `seed[family]` (or `seed[defaultKey]` when the family has no
departure), and the row says the set is seeded and not yet changed — matching what
`dimensionsFor` will actually resolve.

**AC-D24-5 [ADVERSARIAL].** Given the owner toggles a dimension and clicks Save, when the page is
then FULLY RELOADED (not a hash nav — `ui-verify.yml`'s own note is that a hash-only nav does not
remount past the login gate), then the new selection is still shown. A control that toggles local
state and never POSTs, or that POSTs and then renders its optimistic local state instead of the
server's response, passes a click-through and fails this.

**AC-D24-6 [ADVERSARIAL — no clobber].** Given `cmp_dimensions` already stores
`{"product":["leadership_tenure"],"data":["budget_owned"]}`, when the owner changes ONLY the
`product` set and saves, then `data`'s array is byte-identical afterwards. The server-side merge
(`setDimensionPrefs` uses `||` against the existing jsonb) already protects this — the failure mode
is a UI that POSTs every family it has in local state, rewriting families the owner never touched
(and resetting any family a second browser tab changed). Assert the POST body contains exactly one
`family`.

**AC-D24-7.** Given the owner unchecks every dimension for a family and saves, when the response
returns, then `keys` is `[]` and a reload shows zero checked. `dimensionsFor` treats `[]` as a real
answer with `source:'owner'` — the UI must too, and must not silently re-seed. The UI must also warn
in-place that an empty set means nothing on that axis is compared for that family.

**AC-D24-8.** Given a POST whose `keys` contains an unknown dimension key, when the response returns
`dropped: [...]`, then the UI surfaces the dropped keys rather than rendering the reduced set as if
it were what was saved.

**AC-D24-9.** Given `family` missing or `keys` not an array, when POSTed, then the API returns 400
with `ok:false` (it already does) and the UI shows the error text — never a "Saved." toast.

**AC-D24-10 [ADVERSARIAL].** Given an expired session, when Save is clicked, then the UI shows the
sign-in-expired message and does not report success. `requireWrite` returns a guard response, and
`TemperatureSettings` guards with `sessionValid()` before calling — copy that. A save that 401s and
still paints "Saved." is the exact class of dead UI the standing rule forbids.

**AC-D24-11 [ADVERSARIAL — the staleness the implementer will ship].** Given the owner changes their
set and then opens an opportunity whose comparison was resolved under the OLD set, when the JD step
renders, then it does not claim the displayed rows reflect the new set. `comparisonPayload` computes
`set` LIVE from prefs but returns `dimensions` from the STORED `comparison_dimension` rows, so
immediately after a save the card would say "Your dimension set for engineering." above rows built
from the seeded set. Either the payload detects the mismatch (`set.keys` vs the keys present in
`rows`) and says the comparison is stale until re-resolved, or the Settings screen states plainly
that the change applies to the next resolve. Whichever is chosen must be pinned by a test.

**AC-D24-12.** Given the list of role families the control offers, when the JSX is read, then that
list is derived from an existing source (`roleTaxonomy` families and/or `DIMENSION_SETS` keys and/or
the owner's configured roles) — never a hand-typed array in the component. `DIMENSION_SETS` lists
only families whose seed DEPARTS from the default, so using it alone hides every family that
inherits; state which source was used and why it is complete.

**AC-D24-13.** Given the completed component, when `grep` is run over it, then there is no
`onClick={() => toast(` stub, no hardcoded count, and every rendered control is wired to a handler.

**AC-D24-14.** Given every edited `.jsx` file, when the CLAUDE.md smart-quote sweep is run and then
the **Python codepoint scan** (not `grep -P`, which fails in this container's locale and reports
nothing), then no U+2018/2019/201C/201D remains, and `cd app && npm run build` exits 0 AFTER the
sweep — the sweep itself can create a syntax error by straightening an apostrophe inside a
single-quoted string.

**AC-D24-15.** Given `cd app && node --test test/`, when it runs, then it exits 0 at or above the
recorded baseline, and the new component has at least one test covering AC-D24-5, AC-D24-6 and
AC-D24-7.

**AC-D24-16 [LIVE-ONLY].** Given the deployed SPA after this lands on `main`, when `ui-verify.yml`
runs with `route: "#/settings/<key>"`, `owner: "von.ellis@enterpriseds.io"` and `expect` naming the
section heading and two dimension labels, then the run's conclusion is `success` and
`UI_VERIFY_RESULT` reports `ok`. The sandbox cannot render the SPA; this is the only proof the
control exists for a real owner.

**AC-D24-17 [LIVE-ONLY].** Given a real save through the deployed UI, when `db-query.yml` runs
`select owner_email, cmp_dimensions from owner_search_prefs where owner_email='von.ellis@enterpriseds.io'`,
then `cmp_dimensions` contains the family the owner just changed with exactly the chosen keys.
AC-D24-5 proves round-trip against a local database; only this proves it against production.

**Not done if:** the section renders but never POSTs; or it POSTs without `?owner=`; or the owner's
choice is only observable in the same page session; or the JD step claims a changed set is already
reflected in rows that were resolved under the old one.

---

## What counts as NOT verified

The sandbox **cannot** reach `*.azurewebsites.net`, the live Postgres, or `*.azurestaticapps.net`.
It **can** run PostgreSQL 16.13 locally, both builds, and both test suites.

| Claim | Provable here? | If not, what proves it |
|---|---|---|
| SCHEMA_SQL applies to a populated pre-upgrade database | **Yes** — AC-D21-6/7/9. No excuse accepted. | — |
| Fresh == upgraded shape | **Yes** — AC-D21-8, with AC-D21-9's third database | — |
| `comparison_dimension` listed by `diag/pg-migrate` | No | `api-test.yml` → `GET /api/diag/pg-migrate` (AC-D21-14) |
| people/usd arithmetic, all AC-D23 parse and verdict cases | **Yes** — pure module, `node --test` | — |
| `coverable` unchanged | **Yes** — fixture test (AC-D23-18) | — |
| How many live `owner_fact` rows are on the wrong USD scale | No | `db-query.yml` (AC-D23-24) |
| Gate state change on real opportunities | No | `api-test.yml` → `POST /api/app/opportunity/<id>/evidence`, then `db-query.yml` on `check_result` |
| Settings control renders for a real owner | No | `ui-verify.yml` (AC-D24-16) |
| A real owner's choice persists | No | `db-query.yml` on `owner_search_prefs.cmp_dimensions` (AC-D24-17) |

Report every LIVE-ONLY row as **unverified** until its run's LOGS have been read. A 204 from
`workflow_dispatch` means the job started; it is not a result. Per CLAUDE.md, verify a deploy with
`./scripts/wait-run.sh sha:<workflow>:$(git rev-parse HEAD)` — never `latest:`, which immediately
after a push still names the PREVIOUS commit's run.

---

## Traps the implementer will hit

Found by reading the code at `8e4c46c`. Each is a specific line, not a caution.

1. **`schemaParity.test.mjs` cannot see this table.** It builds its "upgraded" database from
   `origin/main`'s `SCHEMA_SQL`, which has no `comparison_dimension` — so the upgraded database
   never had the table, the `create table if not exists` runs in full, and the parity assertion
   passes by construction. Production is the opposite case: the table is already there from
   `ensureDimensionTable`, so the create is a total no-op. AC-D21-9 is the only run that can fail.
2. **`Settings.jsx:1489` strips the magnitude.** `Number(String(value).replace(/[^0-9.]/g, ''))`
   turns `$18M` into `18` and `$1.5B` into `1.5`, while `deriveFacts` writes `18000000` and
   `1500000000` for the same facts. Any USD comparator that trusts `value_num` is wrong for every
   hand-entered budget.
3. **`demandedNumber`'s `\d{1,2}`.** Two digits. Fine for years, useless for `team of 250` and for
   any dollar figure. Copying its shape for the new units inherits the cap.
4. **Widening `hasNumericComparator` alone does nothing.** `buildComparison`'s fact path still calls
   `demandedNumber(textOf(r))`; for a people/usd line that returns null, the loop `continue`s, and
   the row falls through to the evidence path. The change ships green and has no effect (AC-D23-13).
5. **`selectFactDef` still can't reach `scope.largest_team` on a mixed line.** `Lead a team of 60
   engineers with 10+ years experience` matches `experience.years_total` and `scope.largest_team`;
   there is no `refines` link (correctly — neither is a subset of the other), so catalogue order
   wins and years is returned. Reordering `FACT_CATALOGUE` to "fix" this changes what every gate
   treats as settled across 7,559 requirement rows. Do not.
6. **`comparisonPayload` returns a LIVE set beside STORED rows.** `set` comes from
   `loadDimensionPrefs` + `dimensionsFor`; `dimensions` comes from `comparison_dimension`. After a
   prefs change they disagree until `writeComparison` re-runs (AC-D24-11).
7. **`api.js` without `?owner=` is a silent demo write.** `resolveOwner` falls back to
   `demo@executive-engine.local`. The call succeeds, returns 200, and touches the wrong tenant.
8. **`dimensionsFor` honours `[]` as a real owner answer** but `undefined` as "never chosen". A UI
   that omits an empty array, or that sends `null`, changes the meaning of the save.
9. **`factUnit()` returns the raw enum.** `dimensions.ts` interpolates it into `note`, so an
   unmodified implementation prints `18000000 usd recorded, 10000000 required` on the owner's JD
   step.
10. **`create table if not exists` is skipped whole on an existing table** — taking its inline
    columns, CHECKs and UNIQUEs with it. Anything added to an existing table must be an idempotent
    `alter table … add column if not exists`, and any index or constraint naming such a column must
    come AFTER that alter (`H39`/`H39b`). Two migration-aborting defects were found this way in one
    file and neither was visible by reading.
11. **Three CHECKs on `comparison_dimension` will 500 a careless writer**, not merely warn: a
    moderate/weak row with a blank `note`, a `not_applicable` row with a blank `reason`, and a graded
    row with a null `covered`/`total`. AC-D23-14 exists because a new fact-basis branch is a new
    writer against those constraints.
12. **`H26` refuses new numeric IDs.** H1–H44 are frozen; every new case takes a two-word slug.
    Minting `H45` turns the suite red.
13. **`.claude/DEFERRED.md` has duplicate row IDs.** There is another `D21` (escalation.ats_term_id)
    and another `D23` under different sections. Update the rows in the **P8.4** table.
14. **Editing an existing test to make it pass is the regression.** `checks.test.mjs`'s fixture was
    already corrected once during D22 for asking about leadership years while recording total years.
    If a test must change here, name it and justify it in the report (AC-D23-7).
15. **`git log` before trusting any summary.** Per CLAUDE.md's session-start checklist: if a
    handoff says something landed and it is not in the log, it did not land.

---

## Definition of done for this follow-on

1. Every non-LIVE-ONLY AC above has been EXECUTED, with the command and its output quoted.
2. Every LIVE-ONLY AC is listed as unverified, with the exact workflow invocation that would settle
   it — or settled, with the job log read.
3. Each of the three defects has at least one new H-case with a slug, whose comment records the
   measured evidence (the run, the value, the line), added in the SAME commit as the fix.
4. `cd api && npm run build && node --test test/` and `cd app && npm run build && node --test test/`
   all exit 0, at or above the recorded baselines.
5. The three P8.4 rows in `.claude/DEFERRED.md` are updated — struck with the evidence, or narrowed
   to what genuinely remains. A row leaves the ledger only when done AND verified.
6. Work is on a feature branch, merged to `main` fast-forward only, and the deploy is verified for
   THAT commit with `wait-run.sh sha:`.

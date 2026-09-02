# AC — carry `comparison` through the fixture pipeline (`AC:fixture-comparison`)

<!--
WHAT:       Acceptance criteria for making docs/qc-evidence/fixtures.json carry the `comparison`
            payload the app needs to render the JD-step comparison panels, then re-measuring
            PROTOTYPE-COVERAGE.md with a non-starved instrument.
WHY:        Measured 2026-09-02 (PROTOTYPE-COVERAGE.md 16): the /requirements fixture has no
            `comparison` key, so ~19 of 27 "missing panels" on the `jd` step were phantom -- the
            instrument starved the app, not the app missing the feature.
SUPERSEDES: nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:   docs/qc-evidence/PROTOTYPE-COVERAGE.md 16; commits 3036ca0, 1fe46b6
-->

**Status: written adversarially, BEFORE implementation. The implementer did not write these.**
Author: independent AC subagent. Branch `claude/boost-app-setup-approach-ejv09v`.

> Sections are appended as they are finished. Anything below this line stands on its own.

---

## 1. FEASIBILITY TABLE (published before the ACs, per CLAUDE.md "Feasibility BEFORE implementation")

Every row was probed with a real command in this sandbox on 2026-09-02, on branch
`claude/boost-app-setup-approach-ejv09v` at `1fe46b6`. Where a row could NOT be ground-truthed from
here, it says so and says what would settle it — an unverifiable row is never marked `EXISTS`.

| # | Dependency | Producer (writes it) | Consumer today (reads it) | Proof — command + actual result | Verdict |
|---|---|---|---|---|---|
| F1 | `comparison_dimension` **table** | `writeComparison` — `api/src/functions/tests/appDimensions.ts:180-198` (`delete` then `insert`, one txn) | `loadComparison` `appDimensions.ts:219-234` | `grep -n comparison_dimension api/src/functions/tests/schema.ts` → `1148` (DDL), `1183` (index), `1702` (registered in the table list). 21 columns + 5 CHECK constraints + `unique(opp_id, dimension_key)` | **EXISTS** |
| F2 | `comparison_dimension` **ROWS for the fixture opportunity** | `writeComparison`, called on evidence-resolve | `comparisonPayload` → `/requirements` | **NOT VERIFIABLE FROM THIS SANDBOX.** `boost-pg-mcp-write` and `nexus-pg-mcp-write` both reported *"require authentication"* this session; the sandbox egress blocks the DB directly. Settles it: `select opp_id, count(*) from comparison_dimension group by opp_id` via the connector, or `db-query.yml`. | **UNVERIFIED — and it is the pivotal row.** See AC-2/AC-9: whether the chosen opp is *resolved* changes what "done" means |
| F3 | `owner_search_prefs.cmp_dimensions` (the owner's per-family dimension set) | `dimensionPrefs` POST — `appDimensions.ts:125`; column added idempotently at `:98` | `loadDimensionPrefs` `:132-135`, called by `comparisonPayload:256` and `writeComparison:171` | `grep -n "cmp_dimensions" api/src` → 3 hits, all in `appDimensions.ts`. Column is `jsonb`, added by `alter table ... add column if not exists`. Nullable → `loadDimensionPrefs` returns `null` and `dimensionsFor` falls back to seed. | **EXISTS-BUT-CONSTRAINED** — nullable by design; a null is the `seed_family`/`seed_default` path, not a failure |
| F4 | The dimension **catalogue** and `DIMENSION_VERSION` | `api/src/functions/tests/dimensions.ts:103` (`DIMENSION_CATALOGUE`), `:51` (`DIMENSION_VERSION = 2`), `:144` (`DIMENSION_SETS`) | `dimensionsFor` `:172`; `comparisonStaleness` `appDimensions.ts:283` compares row `dimension_version` **<** `DIMENSION_VERSION` | `sed -n '51p;103p' api/src/functions/tests/dimensions.ts` → `export const DIMENSION_VERSION = 2`, `export const DIMENSION_CATALOGUE: DimensionDef[] = [` | **EXISTS** — and it is TypeScript-only. Nothing outside `api/` can read it without re-implementing or building it |
| F5 | `GET /api/app/opportunity/{id}/requirements` returning `comparison` | `appRequirements.ts:846` `const comparison = await comparisonPayload(...)`, emitted at `:851` | `app/src/api.js` → `PacketBuilder.jsx:878` `comparison={req.data?.comparison}` → `ProfileCompareCard` `PostingAnalysis.jsx:133-140` | `sed -n '844,852p' api/src/functions/tests/appRequirements.ts` → the call and the `comparison,` key are both present in the 200 body | **EXISTS** |
| F6 | The four-state renderer `comparisonState` | `app/src/postingAnalysis.js:148` | `PostingAnalysis.jsx:136` | `sed -n '148,172p' app/src/postingAnalysis.js` → states `loading` / `unresolved` / `none_graded` / `graded`. **`loading` fires on `!comparison` alone** — i.e. an undefined key is rendered as "Loading the comparison…" forever | **EXISTS** — this is the exact mechanism of the defect |
| F7 | The runner's network reach to `job-platform-api.azurewebsites.net` | `.github/workflows/api-test.yml` (GH runner, open internet) | — | `sed -n '38,60p' .github/workflows/api-test.yml` → mints an HMAC-SHA256 session token from `AZURE_CLIENT_SECRET` and calls the live Function. CLAUDE.md records this as the standard live-API transport; the sandbox is blocked from `azurewebsites.net` | **EXISTS** |
| F8 | A verified-session token a runner can mint | `api-test.yml` inline Python `b64url(header).b64url(payload)` HMAC'd with `AZURE_CLIENT_SECRET` (== `MICROSOFT_CLIENT_SECRET` == the Function's session signing secret) | `resolveOwner`/`requireWrite` (`appSession.ts`) | same `sed` as F7. Owner defaults to `von.ellis@enterpriseds.io` | **EXISTS** — and `/requirements` is a **GET**, so even the unverified `?owner=` path would serve reads |
| F9 | `fixture-refresh.yml` SQL dump | `.github/workflows/fixture-refresh.yml:57-96` | `scripts/build-fixtures.mjs --raw` | `grep -c comparison_dimension .github/workflows/fixture-refresh.yml` → **0**. The dump selects packet/opp/artifacts/insertions/corrections/requirements/gates/checks/swaps/checkPrefs — **never `comparison_dimension`** | **ABSENT** — this is the upstream hole |
| F10 | `scripts/build-fixtures.mjs` emitting `comparison` | — | `render-app.mjs` / `compare-ui.mjs` | `grep -n comparison scripts/build-fixtures.mjs` → **0 hits**. `f[.../requirements] = { oppId, requirements, total, located }` (`:112-120`) | **ABSENT** |
| F11 | The canary requiring `comparison` | `scripts/lib/fixture-canary.mjs` REQUIRED[1], added in `3036ca0` | `render-app.mjs:52`, `compare-ui.mjs:181` | Ran it: `node -e "import('./scripts/lib/fixture-canary.mjs')..."` on the committed fixture → **`!!! HARNESS CANARY FAILED` … exit 1**. Both consumers are therefore hard-blocked today | **EXISTS — and is currently RED** |
| F12 | The committed `docs/qc-evidence/fixtures.json` | last written by `3036ca0` | both consumers | `node -e` over the file: `/opportunity/2cb56fb3…/requirements` has keys **`['requirements']` only** — 35 rows, and **no `total`, no `located`**, no `comparison` | **EXISTS-BUT-CONSTRAINED — and STALER THAN THE BUILDER.** `build-fixtures.mjs:112-120` has emitted `total`/`located` since `42a1d49`; the committed file predates that, so it is *already* silently starving `meterModel` (`assetBlocks.js:883`) — the exact TRAP 4 the builder documents as fixed |
| F13 | `origin/ui-fixtures` raw dump (the only committed dump) | `fixture-refresh.yml` run of 2026-08-29 | `build-fixtures.mjs --raw` | `git show origin/ui-fixtures:raw-dump.json` → 424,961 bytes, opp **`9f9c370a-…`** (NOT the fixture's `2cb56fb3-…`), 21 requirements, and **no `checkPrefs` key at all** | **EXISTS-BUT-CONSTRAINED — a trap.** Rebuilding from this dump would (a) change the opportunity under the measurement and (b) fail the *search-prefs* canary limb, because the dump predates the `checkPrefs` select |

### What the table changes about the plan

1. **F9 + F10 are the real scope.** The absence is not one line in `build-fixtures.mjs`; the data
   never leaves the database, because `fixture-refresh.yml` never selects it. Any plan that edits
   only the builder cannot work.
2. **F12 is a second, undiagnosed starvation on the same fixture key.** `total`/`located` are
   missing from the committed file although the builder emits them. Whoever fixes `comparison`
   without regenerating the whole file leaves `meterModel`'s three per-kind stats (SPEC 4.4-24/25/26)
   still reading as not-built. **This is in scope: it is the same key, the same defect class, and
   the re-measurement is invalid while it stands.**
3. **F13 means "just re-run the builder" is not available.** There is no committed dump that
   matches the committed fixture's opportunity *and* carries `checkPrefs`. A refresh must be re-run.
4. **F2 is unverified and it is the pivot.** If `2cb56fb3-…` has no `comparison_dimension` rows, the
   honest fixture carries `resolved:false, dimensions:[]` — which is a *correct* app state, not a
   fix. See AC-9. Nobody may declare this work done without knowing which case they are in.

### F12, corrected upward — the committed fixture is NOT REPRODUCIBLE from the committed builder

I first wrote that `fixtures.json` "predates" the builder's `total`/`located`. It does not, and the
truth is worse. Ground-truthed:

- `git log -S"located: requirements.filter" -- scripts/build-fixtures.mjs` → **`812a5b7`, 2026-08-30**,
  and `git merge-base --is-ancestor 812a5b7 HEAD` → **YES**.
- `git show --stat 3036ca0` → `docs/qc-evidence/fixtures.json | 14314 +++---` on **2026-09-02**, i.e.
  the file was rewritten wholesale *three days after* the builder started emitting those keys.
- The rewritten file still has `keys: ['requirements']`.

**Observation:** the committed fixture cannot have come from `node scripts/build-fixtures.mjs` at any
commit in this branch's history — that command emits four keys on this route and the file has one.
**Interpretation (inference, confidence high):** it was assembled by some other, uncommitted path.
Its opportunity (`2cb56fb3-…`, 35 requirements) also matches no committed dump — `origin/ui-fixtures`
holds `9f9c370a-…` with 21 (F13).

**Consequence for this work:** the measuring instrument's input is currently un-auditable. Adding
`comparison` to `build-fixtures.mjs` while the committed fixture continues to come from somewhere
else fixes nothing that can be proved. **AC-6 makes reproducibility a criterion**, and it is not
optional garnish — it is the only thing that makes any later gap number checkable by a third party.

---

## 2. THE DESIGN DECISION — adjudicated, not left to the implementer

### Verdict: **(B) capture the API's own response.** (A) is REJECTED and the ACs below forbid it.

**Why (A) — re-derive in `build-fixtures.mjs` — is wrong, on this repo's own rules.**

1. **It is the "Extend, don't duplicate" failure, verbatim.** (A) requires porting a *second*
   implementation of the dimension brain into JS: `summarize` (`dimensions.ts:549`), `dimensionsFor`
   (`:172`) with `DIMENSION_CATALOGUE` (`:103`), `DIMENSION_SETS` (`:144`) and `DEFAULT_SET_KEY`,
   `comparisonStaleness` (`appDimensions.ts:274`) with `DIMENSION_VERSION` (`dimensions.ts:51`),
   `roleFamilyOf` (`appDimensions.ts:152`) — **which itself calls `resolveTitle` from the role
   taxonomy**, so the port drags in a third system — and `loadComparison`'s 21-column
   snake_case→nested mapping (`appDimensions.ts:225-233`). That is not a helper. That is the feature.
2. **A re-derived fixture measures itself.** The harness exists to answer "does the app render what
   the prototype does". Under (A) the fixture's `summary`/`set`/`stale` are produced by the port, so
   any drift between port and API renders as *app* gaps. That is the identical failure the canary
   was written for (`fixture-canary.mjs` header: "the fixture starved the app … and the nothing was
   reported as a missing feature"), pushed one level deeper where the canary cannot see it — because
   a wrong `summary` is present and truthy.
3. **It breaks silently on exactly the changes that matter.** `DIMENSION_VERSION` is `2` today and
   `comparisonStaleness` fires on `row_version < DIMENSION_VERSION`. A bump to `3` in `api/` with a
   stale port in `scripts/` makes the fixture assert "not stale" while the app asserts "rules
   changed" — a wrong *warning state*, in the surface whose entire purpose is telling the owner when
   a number is out of date. Same for any catalogue key added to `DIMENSION_CATALOGUE`.
4. **`comparison_dimension` has 5 CHECK constraints encoding grading invariants** (`schema.ts:1173-1180`).
   A JS re-derivation honours none of them.

**Why (B) is right.**

- **Zero derivation.** The stored value *is* `appRequirements.ts:851`'s output. The fixture cannot
  disagree with the app about `summary`, `set` or `stale`, because it never computed them.
- **It is immune to F4 drift by construction.** Catalogue changes, `DIMENSION_VERSION` bumps and
  dimension-prefs edits all arrive in the next capture with no code change anywhere.
- **It retires a whole class of bug that has already cost four measurements.** Traps 2, 3 and 4 in
  `build-fixtures.mjs:12-22, 74-84, 104-111` are all "the builder shaped a row differently from the
  endpoint". For this route (B) deletes the shaping step: `total`/`located` (F12's second
  starvation), `requirements` in `shapeRequirementsForApi` form, `evidenceHealth`, `profileSources`
  and `comparison` all arrive already correct. **The right unit of capture is therefore the WHOLE
  `/requirements` body, not just its `comparison` key** — see AC-3.
- **The transport already exists.** F7/F8: a GH runner reaches the Function and `api-test.yml`
  already mints a verified session token from `AZURE_CLIENT_SECRET`. `fixture-refresh.yml` already
  runs on a runner and already commits its output to `ui-fixtures`. This is an extension of one
  existing workflow, not a new system.

**(C), for the record — import the BUILT API modules into `build-fixtures.mjs`.** `node -e
"import('./dist/functions/tests/schema.js')"` is already this repo's documented way to avoid
hand-copying `SCHEMA_SQL` (CLAUDE.md, "Run the schema locally"), so `import('../api/dist/functions/
tests/dimensions.js')` for `summarize`/`dimensionsFor` is a real option and is **strictly better than
(A)** — one source of truth, no port. It is still worse than (B) because it needs (i) a built `api/`
present whenever fixtures are built, (ii) a hand-written `select * from comparison_dimension` in the
dump that must track 21 columns, and (iii) `loadComparison`'s row mapping split out of its query to
be reusable. **Take (C) only if (B) is proven infeasible**, and record why.

**(B)'s own failure modes, each of which gets a criterion rather than a shrug:**

| Failure | What it would bake into the fixture | Criterion |
|---|---|---|
| API 5xx / timeout / 404 on the opp | a fixture missing the route entirely, or an error body | AC-4 (fail the job; never commit) |
| Auth token rejected → 401 | `{error:…}` stored as if it were the body | AC-4 |
| `sourceText()` (a live Google Docs read, `appRequirements.ts:838`) fails on that one call | `profileSources: ['profile UNREADABLE']` and every row `unverified` — the evidence surface renders as broken product | AC-5 |
| The opportunity is genuinely unresolved | `resolved:false, dimensions:[]` — a **correct** app state that still hides ~19 panels | AC-2, AC-9 |
| Response size | `/requirements` carries 35 verbatim requirement rows + evidence; the whole committed fixture is 524,671 bytes today | AC-8 |

---

## 3. ACCEPTANCE CRITERIA

Each is binary and names the command or `file:line` that decides it. Nothing here says "works".

### The capture

**AC-1 — the body is captured, verbatim, by the runner.**
Given `fixture-refresh.yml` runs on a GitHub runner (which reaches `job-platform-api.azurewebsites.net`,
F7), when the refresh job runs, then it performs `GET /api/app/opportunity/{opp}/requirements?owner=<owner>`
with a session token minted the way `.github/workflows/api-test.yml:44-60` mints one, and writes the
**unmodified response body** into the committed dump under a new top-level key (proposed:
`apiRequirements`).
*Decided by:* `node -e "const d=require('/tmp/rawdump.json'); console.log(Object.keys(d.apiRequirements))"`
after `git show origin/ui-fixtures:raw-dump.json` → must list at least
`oppId, comparison, requirements, total, located, evidenced, unevidenced, evidenceHealth, profileSources, stale, jdTextLen`
(the keys `appRequirements.ts:849-865` emits). Missing any ⇒ FAIL.

**AC-2 — an unresolved comparison FAILS the refresh, loudly, naming the opportunity.**
Given `comparisonPayload` returns `{resolved:false, dimensions:[]}` for an opportunity nobody has
resolved (`appDimensions.ts:258-264`), when the captured body has `comparison.resolved !== true` or
`comparison.dimensions.length === 0`, then the refresh job **exits non-zero and commits nothing**,
printing the opp id and the sentence *"this opportunity has no comparison_dimension rows — resolve
it, or pick an opportunity that has been resolved; a fixture built from it cannot see the compare
surface."*
*Why this is not over-strict:* with `dimensions: []`, `PostingAnalysis.jsx:173` renders the
`compare-empty` note and `compare-cards` / `compare-cols` / `compare-card` / `compare-summary`
(`:183, :201, …`) **do not render at all**. An unresolved capture would pass a `!!comparison` canary
and leave the same ~19 panels missing — the defect, wearing a new hat.
*Decided by:* the job's own exit code, plus `node -e "…apiRequirements.comparison.dimensions.length"` > 0.

**AC-3 — `build-fixtures.mjs` PASSES THE BODY THROUGH; it does not rebuild it.**
Given the dump carries `apiRequirements`, when `node scripts/build-fixtures.mjs --raw <dump> --opp <id>`
runs, then `f["/opportunity/<id>/requirements"]` is **deep-equal to `raw.apiRequirements`** — no key
added, none removed, none reshaped — and the previous derived construction
(`build-fixtures.mjs:112-120`, the `{oppId, requirements, total, located}` literal) is used **only**
when `apiRequirements` is absent, and when it is used it prints a loud `!!! DERIVED /requirements —
comparison will be missing` line.
*Decided by:* `node -e "const a=require('./out.json')['/opportunity/'+OPP+'/requirements'],
b=require('/tmp/rawdump.json').apiRequirements; require('assert').deepStrictEqual(a,b)"` → exit 0.
*And by the H-case `H:fixture-requirements-is-the-api-body` (§5).*

**AC-4 — a non-200, or an error-shaped body, never reaches the branch.**
Given the API can 401/404/500 or time out, when the capture step's HTTP status is not `200` **or**
the parsed body has an `error` key **or** the body has no `comparison` key, then the job exits
non-zero before the `git commit` step at `fixture-refresh.yml:118-127`, and `ui-fixtures` is
unchanged.
*Decided by:* the run's conclusion, and `git log -1 --format=%H origin/ui-fixtures` being unchanged
from before the run.

**AC-5 — a failed profile read fails the capture rather than being frozen into the fixture.**
Given `appRequirements.ts:838` does a live `sourceText()` per GET and falls back to
`{text:'', sources:['profile UNREADABLE'], records:[]}` on failure, when the captured body has
`profileSources` containing `'profile UNREADABLE'` **or** `evidenceHealth` reporting every row
unverified, then the job exits non-zero with that reason named.
*Rationale:* capturing that response would bake a transient Google Docs outage into the instrument
and render the evidence surface as broken product — the same class as the 24/20 catastrophe report
`fixture-canary.mjs:14-18` records.
*Decided by:* `node -e "…profileSources.includes('profile UNREADABLE')"` → false.

### The instrument

**AC-6 — the committed fixture is REPRODUCIBLE from a committed input by a committed command.**
Given F12 established the current `docs/qc-evidence/fixtures.json` cannot have come from
`build-fixtures.mjs` (it has one key on the `/requirements` route where the builder emits four),
when the work is done, then
`git show origin/ui-fixtures:raw-dump.json > /tmp/r.json && node scripts/build-fixtures.mjs --raw /tmp/r.json --opp <opp> --out /tmp/f.json`
produces a file **byte-identical** to the committed `docs/qc-evidence/fixtures.json`.
*Decided by:* `cmp /tmp/f.json docs/qc-evidence/fixtures.json` → exit 0.
*Note the consequence:* the fixture's opportunity and the dump's opportunity must be the SAME one.
Today they are not (`2cb56fb3-…` vs `9f9c370a-…`, F12/F13), so this AC forces that to be settled
rather than left as an undocumented mismatch.

**AC-7 — the canary rejects a HOLLOW comparison, not merely an absent one.**
Given `fixture-canary.mjs` REQUIRED[1] currently tests `!!(req && req.comparison)`, when the check is
strengthened, then it passes only if **all** of: `comparison.resolved === true`;
`Array.isArray(comparison.dimensions) && comparison.dimensions.length > 0`; `comparison.summary` is
an object with a numeric `graded`; `Array.isArray(comparison.set.keys) && comparison.set.keys.length > 0`.
And it must **still fail** on each of these hand-built stubs:
`{}`, `{resolved:true,dimensions:[]}`, `{resolved:false,dimensions:[{key:'x'}]}`, `{resolved:true,dimensions:[{key:'x'}],summary:null}`.
*Deliberately NOT required: at least one `fit !== 'not_applicable'` row.* `none_graded`
(`postingAnalysis.js:161-167`) is a **self-describing, visible** state — the cards and the 4-column
table still render from `st.rows` — so it is not "an absence indistinguishable from a missing
feature", which is the canary's stated admission rule (`fixture-canary.mjs:22-27`). Requiring it
would make the canary refuse a fixture that can see perfectly well. **Record the graded count in the
provenance note (AC-10) instead.**
*Decided by:* a test that feeds each stub to `assertFixtureCanSee` in a child process and asserts exit 1.

**AC-8 — the fixture stays committable and carries no credential.**
Given the whole committed fixture is 524,671 bytes today, when the new fixture is committed, then
(i) `wc -c docs/qc-evidence/fixtures.json` < 5,000,000, and (ii) `grep -ciE
"authorization|bearer |eyJ[A-Za-z0-9_-]{10}|client_secret" docs/qc-evidence/fixtures.json` → `0`.
*Rationale for (ii):* the capture now flows through an authenticated call; the token must never land
in a committed artifact.

### The four states stay four

**AC-9 — "the fixture starved the app" and "the app says nothing was resolved" remain
distinguishable after this change.**
Given `comparisonState` has four states (`postingAnalysis.js:148-172`), when the work is done, then a
test renders `ProfileCompareCard` (or calls `comparisonState` directly) once per state and asserts
the four distinct `data-qc-state` values `loading|unresolved|none_graded|graded` on
`PostingAnalysis.jsx:143`, with `loading` reachable **only** from `comparison === undefined`.
*This is the load-bearing one.* The entire defect is that a starved fixture produced `loading`
forever and it was read as absence. After the fix, `loading` must mean exactly one thing: nobody
passed a comparison.
*Decided by:* `cd api && node --test test/hardening.test.mjs` (or the app test runner) — the new case
named in §5.

### The re-measurement

**AC-10 — the gap number is restated WITH ITS PROVENANCE, and the old one is explicitly retracted.**
Given `PROTOTYPE-COVERAGE.md §16` records ~19 of 27 `jd` panels as instrument artefacts, when the
new fixture is in place, then `node scripts/compare-ui.mjs` is re-run for the `jd` step and
`PROTOTYPE-COVERAGE.md` gains a section stating: the new `panelsOnlyInPrototype` count for `jd`; the
fixture's opp id; `comparison.dimensions.length`; `comparison.summary.graded`; `comparison.set.source`
and `set.family`; whether `comparison.stale` was null; and the run date. The previous `jd` number is
marked SUPERSEDED **in place**, per CLAUDE.md's "an experiment is not run until its result is in its
own spec".
*Decided by:* the diff to `PROTOTYPE-COVERAGE.md` containing all seven values.
*Marked NON-BINARY in one respect and deliberately so:* the AC does **not** require the number to go
down. It may rise (the surface now renders, so real gaps inside it become visible for the first
time). Requiring a direction would be requiring an answer, which is exactly what a measurement must
not do.

**AC-11 — no second dimension brain enters `scripts/`.**
Given option (A) is rejected (§2), when the work is done, then
`grep -rnE "DIMENSION_CATALOGUE|DIMENSION_SETS|notApplicableLabels|rules_changed|roleFamilyOf|set_changed" scripts/`
returns **0 matches**, and `grep -rn "comparison_dimension" scripts/` returns 0.
*Decided by:* those two greps, and by `H:no-dimension-logic-outside-api` (§5).
*If option (C) is taken instead (only after (B) is proven infeasible, §2), this AC changes to: the
only permitted reference is an `import(...)` of a file under `api/dist/`, and a literal copy of any
catalogue entry still fails.*

**AC-12 — the previously-missing `total`/`located` are present too, and their consumer proves it.**
Given F12 found the committed fixture also lacks `total` (which `meterModel`, `assetBlocks.js:883`,
gates the entire measured branch on via `Number.isFinite(Number(requirements.total))`), when the new
fixture is built, then `f[…/requirements].total === f[…/requirements].requirements.length` and
`located` is a number, and the `jd`-step render shows the three per-kind stats
(`Must-haves answered` / `Responsibilities answered` / `Nice-to-haves answered`, SPEC 4.4-24/25/26)
rather than the "unknown - not zero" branch.
*Decided by:* `node scripts/render-app.mjs --route '#/packet/<opp>/jd' --fixtures docs/qc-evidence/fixtures.json --text | grep -c "answered"` → ≥ 3.

> **Line-number correction to AC-12:** the gate is `assetBlocks.js:896`
> (`const totalReqs = requirements && Number.isFinite(Number(requirements.total)) ? … : null`), not
> `:883`; `REQ_KIND_STATS` is at `:886` and `meterModel` begins at `:892`. Verified by
> `grep -n "requirements.total" app/src/assetBlocks.js`. The AC is unchanged; only the citation was.
> The `jd` step is the default step (`PacketBuilder.jsx:412`, `activeStep = explicitStep || 'jd'`)
> and the compare card is mounted at `PacketBuilder.jsx:878` inside the `activeStep === 'jd'` block
> that opens at `:817`.

---

## 4. HOW TO MUTATION-PROVE THESE GUARDS (read before running one)

Use `/workspace/eds-claude-skills/scripts/mutate.sh` (present, `-rwxr-xr-x`, 5,829 bytes). **Never a
hand-rolled harness** — measured on this repo 2026-09-01, 2 of ~20 hand-run mutations had anchors
that never matched and the ad-hoc script reported `INERT` (i.e. "your guard is worthless") when the
truth was `NOT-APPLIED` (i.e. "nothing was tested").

    scripts/mutate.sh <file> <anchor-file> <replacement-file> <test-cmd> <must-fail-pattern>

Two traps that will produce a FALSE `INERT` in this repo specifically:

1. **Chain the TEST_CMD with `;`, never `&&`.** `tsc` exits non-zero on the type error a mutation
   introduces **but still emits JS**, so `npm run build && node --test …` short-circuits before the
   test ever runs and the harness sees a pass-shaped nothing.
   Use: `cd api; npm run build; node --test test/hardening.test.mjs`
2. **`mutate.sh` restores SOURCE but not `dist/`.** After any mutation run, rebuild before trusting
   the next result: `cd api && npm run build`. A stale `dist/` carrying the mutation is
   indistinguishable from a guard that does not fire.

Anchors come from **files**, not shell arguments — a quoted anchor through bash loses backslashes
and `$`, which is exactly how the first bad anchor silently stopped matching.

---

## 5. REGRESSION GUARDS — proposed H-cases (SLUGS, never numbers; `H26` fails a numeric id)

Each asserts the **invariant**, not the incident.

**`H:fixture-requirements-is-the-api-body`**
*Invariant:* when a captured API body exists in the dump, the emitted `/requirements` fixture IS that
body — the builder may not reshape a route it captured.
*Assertion:* run `build-fixtures.mjs` over a small synthetic dump containing `apiRequirements`, then
`assert.deepStrictEqual(out['/opportunity/<id>/requirements'], dump.apiRequirements)`.
*Mutation that must make it FIRE:* in `build-fixtures.mjs`, change the pass-through to
`{ ...raw.apiRequirements, total: requirements.length }` (a single re-derived key). Expected
`FIRED` — `deepStrictEqual` fails on the injected/overwritten key.

**`H:canary-refuses-a-hollow-comparison`**
*Invariant:* the canary's job is "can this instrument SEE the surface", so a `comparison` that
renders `compare-empty` must fail it exactly as an absent one does.
*Assertion:* for each of the four stubs listed in AC-7, spawn `node -e` importing
`fixture-canary.mjs`, call `assertFixtureCanSee`, assert exit code `1`; and assert a full, resolved
fixture exits `0`.
*Mutation that must make it FIRE:* revert REQUIRED[1]'s predicate to `!!(req && req.comparison)`.
Expected `FIRED` — the `{resolved:true,dimensions:[]}` stub then exits 0.
*(This is the one mutation most likely to come back `INERT` if the test only checks the absent case —
so the stub list is part of the assertion, not decoration.)*

**`H:every-canary-requirement-has-a-producer`**
*Invariant — the generalisation of this whole defect, and the highest-value case here:* **every key
`fixture-canary.mjs` REQUIREs must be produced by the committed pipeline.** The `comparison` hole and
the earlier `checkPrefs` hole (F13: `origin/ui-fixtures`'s dump has no `checkPrefs` at all) are the
same bug twice — a consumer demanding what no producer emits.
*Assertion:* a structural test that, for each entry in `REQUIRED`, finds the fixture key it probes
and asserts a producer exists: the key appears in `scripts/build-fixtures.mjs`, **and** every raw
field it needs appears in `.github/workflows/fixture-refresh.yml`'s SQL (`checkPrefs`,
`apiRequirements`, `swaps`, …).
*Mutation that must make it FIRE:* delete the `'checkPrefs', (select row_to_json(sp) …)` line from
`fixture-refresh.yml`. Expected `FIRED`. *(Verified as a real, currently-broken invariant: the dump
on `origin/ui-fixtures` today would fail this test — which is the point.)*

**`H:comparison-loading-means-only-absent`**
*Invariant:* `comparisonState` returns `loading` **iff** no comparison was supplied; a supplied but
empty comparison must return `unresolved`, and one with only ungraded rows must return `none_graded`.
*Assertion:* four calls, four distinct `state` values, with `loading` produced only by `undefined`/`null`.
*Mutation that must make it FIRE:* change `postingAnalysis.js:149` to
`if (!comparison || !comparison.resolved) return { state:'loading', … }`. Expected `FIRED` — the
`unresolved` case then reports `loading`, i.e. the defect this whole lane exists to fix, reinstated.

**`H:no-dimension-logic-outside-api`** *(source grep — a runtime test cannot express it)*
*Invariant:* the dimension catalogue, set resolution, summarisation and staleness rules have ONE
home, `api/src/functions/tests/{dimensions,appDimensions}.ts`. No copy in `scripts/`.
*Assertion:* `grep -rE "DIMENSION_CATALOGUE|DIMENSION_SETS|notApplicableLabels|rules_changed|set_changed|roleFamilyOf"` over `scripts/**` → 0 matches (comments stripped, per the "never cry wolf" rule).
*Mutation that must make it FIRE:* paste a two-entry `const DIMENSION_CATALOGUE = [...]` into
`scripts/build-fixtures.mjs`. Expected `FIRED`.

---

## 6. CRITERIA CONSIDERED AND **REJECTED**, with reasons

| Rejected AC | Why it was rejected |
|---|---|
| *"The `jd` gap count must DROP after the fix."* | This requires an answer before the measurement. The surface has never rendered in the harness, so real gaps inside it are being seen for the first time; the number may legitimately rise. An AC that constrains the direction of a measurement turns the instrument into an advocate. Replaced by **AC-10**, which requires the number to be *restated with its provenance*. |
| *"`comparison.stale` must be null."* | `comparisonStaleness` (`appDimensions.ts:274-289`) is null only when the stored rows match the current set and `DIMENSION_VERSION`. A non-null value is a **correct and important** app state (`compare-stale`, `PostingAnalysis.jsx:166`) and forcing it null would forbid capturing production truth. Its value is *recorded* by AC-10 instead. |
| *"At least one row must be `fit: 'strong'`."* | Grades are the product's judgement about a real posting. Requiring a grade distribution is requiring the data to flatter the fixture, and would push a future refresh toward picking an opportunity by its answer. |
| *"Require ≥1 graded (`fit !== 'not_applicable'`) row in the canary."* | Considered seriously and rejected on the canary's own stated admission rule (`fixture-canary.mjs:22-27`): a key belongs there only if its absence renders as *plausible, quiet, correct-looking UI*. `none_graded` renders `st.rows` — the cards and the 4-column table appear — and prints "None of these dimensions could be compared for this posting", which is loud and self-describing. See AC-7. |
| *"Port `summarize`/`dimensionsFor` into `build-fixtures.mjs` behind a unit test that pins it to the TS."* | This is option (A) with a fig leaf. A pin-test asserts the port matches *today*; the failure mode is a `DIMENSION_VERSION` bump or a catalogue entry landing in `api/` with the pin-test not re-run in that lane. Two implementations with a test between them are still two implementations. **AC-11** forbids it. |
| *"Add a `comparison_dimension` select to the dump SQL as well as capturing the API body."* | Belt-and-braces that creates a second source of truth for the same fact, which then has to be kept consistent — the "Extend, don't duplicate" failure in miniature. Under (B) the rows are already inside the captured `comparison.dimensions`. |
| *"Make the canary a warning so the parity run can proceed while the fixture is fixed."* | The previous generation of this check *was* a warning (`!!! THIN FIXTURE SET - the next gap number will be INFLATED`, `fixture-canary.mjs:66-70`); it was read and walked past. The hard exit is the lesson. |
| *"Have `render-app.mjs` fall back to calling the live API when a fixture key is missing."* | The sandbox cannot reach `azurewebsites.net`, so the fallback would silently serve `{}` — reintroducing exactly the starvation this lane is fixing, with a fallback path making it look intentional. |
| *"Assert the captured body matches what `comparisonPayload` would return for the same rows."* | Requires a live DB read plus a re-derivation to compare against — i.e. option (A) smuggled in as a test. The captured body **is** the ground truth; there is nothing more authoritative to check it against. |
| *"Commit the captured body as its own file (`docs/qc-evidence/requirements-response.json`)."* | Splits the instrument's input across two files with no consumer for the second. `fixtures.json` is what both consumers load (`render-app.mjs:47`, `compare-ui.mjs`); one input, one canary. |
| *"Require the refresh to run on a schedule (cron)."* | Out of scope and it changes cost and blast radius without a stated need. A stale fixture is now *detectable* (AC-6 reproducibility + the canary); detection is the control, not a timer. |

---

## 7. OPEN QUESTIONS THE IMPLEMENTER MUST SETTLE BEFORE CODING (not blockers I can resolve here)

1. **Which opportunity is the fixture's subject?** F12/F13: the committed fixture is `2cb56fb3-…`
   (35 requirements), the committed dump is `9f9c370a-…` (21). AC-6 forces one answer. Changing the
   subject changes every panel count in `PROTOTYPE-COVERAGE.md`, so if it changes, **every** step's
   number is re-measured, not just `jd`.
2. **Does the chosen opportunity have `comparison_dimension` rows?** F2 is UNVERIFIED — both
   Postgres connectors reported *requires authentication* this session. Settle it with one query
   through `boost-pg-mcp-write` (preferred, ~1s) or `db-query.yml`:
   `select opp_id, count(*), min(dimension_version) from comparison_dimension group by opp_id;`
   If the answer is zero rows for the chosen opp, AC-2 fires and the work starts with a resolve, not
   a code change.
3. **Is `DIMENSION_VERSION = 2` grading present in those rows, or version-1 rows?** `min(dimension_version)`
   above answers it. Version-1 rows mean `comparison.stale.rules_changed` is true in the capture —
   legitimate, and AC-10 requires it recorded rather than hidden.

---

*End of AC pass. Written before implementation; no code was written or modified by this pass. The
only file this pass created is this one.*

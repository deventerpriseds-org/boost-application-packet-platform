# Acceptance Criteria — ATS Term Library Lane (P1.2 / P1.2b)

**Author:** independent AC subagent (adversarial, non-implementing)
**Date:** 2026-08-24
**Tier:** 1 (accusation grade) — this lane feeds `keyword_coverage`, which feeds scoring.
**Status:** DRAFT — written incrementally as research proceeds.

## Scope under review
1. Extend `api/src/functions/tests/termMiner.ts` filters so measured junk classes stop reaching curation.
2. Re-mine so the purge runs.
3. Curation screen (approve / reject / merge) over existing routes.
4. PROMOTE approved candidates -> `term_library_entry` (family, term_type, match_mode, aliases/alias_normalized), then PUBLISH a `term_library` version.

---

## DESIGN CORRECTION (owner, mid-drafting) — EXCLUSION MARKS, IT DOES NOT DELETE

The original brief framed junk removal as extending `termMiner`'s **filters** so junk "stops
reaching the queue". The owner corrected this and the correction is binding on every AC below.

**1. Auto-exclusion sets `status='rejected'` with a recorded reason. It never hard-deletes.**
`termsMine` today runs `delete from term_candidate where id=$1 and status='pending'` for rows the
current filters no longer produce. A wrong exclusion is then both **invisible** (no row survives to
inspect) and **unrecoverable**. The schema already carries the right mechanism —
`status pending|approved|rejected|merged` + `reviewed_at` / `reviewed_by`, written by
`termsCandidateDecide`. Auto-exclusion reuses it: junk leaves the *review queue* (which defaults to
`status='pending'`) while staying auditable and one status flip from restoration.

**2. There is no column to record WHY.** `term_candidate` is
`id, owner_email, ngram, normalized, n, df, sample_opp_ids, status, merged_into, reviewed_at,
reviewed_by, mined_at, corpus_size`. A reason column must be added, with this repo's
populated-database migration discipline (H39/H39b, `schemaParity.test.mjs`).

**3. Any auto-exclusion rule must be EXACT / whole-phrase. A prefix or broad regex is banned.**
The proposed `^chief ` catches 17 live rows and all 17 are genuinely job titles — **clean by luck,
not by construction**. `chief of staff responsibilities` is a counter-example the same rule would
silently destroy. Deciding a candidate never reaches the owner **is accusation-grade**, so the
standing rule applies verbatim: *fuzzy matching is for RANKING, never for ACCUSING.*

**Consequence the implementer must not miss — there are TWO exclusion points, and only one of them
is auditable:**

| Point | Effect | Auditable? |
|---|---|---|
| `ngramsForDoc()` — phrase never becomes an n-gram | **no row is ever created** | **NO** |
| a classification pass over mined rows — row written/updated with `status='rejected'` + reason | row exists | **YES** |

Putting the new junk classes in `ngramsForDoc` satisfies "stops reaching the queue" and **violates
the correction**, because on every future mine the phrase silently ceases to exist. So: the new
classes belong in the classification pass, not in `ngramsForDoc`. See **AC-52..AC-62**.

**Measured baselines — two different measurements exist; neither may be reused as the shipped
number.** Brief #1 (2,734 pending): junk 106 = degree 32, EEO 24, filler 21, title 21, geo 8.
Brief #2 (2,734 pending, corpus 928): proposed classes exclude 81 = degree 26, title 22, eeo_extra
16, geo 9, filler 8. Different rulesets, different counts. **AC-10/AC-56 require the implementer to
re-measure against the exact ruleset shipped and record that number here**, rather than quoting
either of these.

---

_(sections appended below as research completes)_

## Ground-truth read log (what these ACs are derived from, not assumed)

| Source read | Fact it establishes |
|---|---|
| `api/src/functions/tests/termMiner.ts` (all 225 lines) | `STOP` set, `BOILERPLATE` array + `isBoilerplate` **substring** match, `ngramsForDoc`, specificity ranking `n=1:0.25, 2:1.0, 3:1.2, 4:1.1`, the pending-only purge, 3 registered routes |
| `api/src/functions/tests/termMatch.ts` (all 92 lines) | **The matcher ALREADY EXISTS**: `termNormalize`, `normalizeAliases(display, aliases)`, `confidenceFor(sources, evidenceDf)`, `matchesEntry(entry, candidateRaw)` honouring all three `match_mode`s |
| `api/src/functions/tests/schema.ts` ~195-290 | `term_library`, `term_library_entry`, `term_candidate`, `term_entry_guard_trg` (BEFORE UPDATE OR DELETE, **not INSERT**) |
| `api/src/functions/tests/appChecks.ts` 128-137 | `scoreable` count query; **`keyword: scoreable > 0 ? { covered: 0, scoreable } : null`** — `covered` is a LITERAL ZERO |
| `api/src/functions/tests/artifactScore.ts` 126-128 | `keyword_coverage` = `round(covered/scoreable*100)` whenever `scoreable > 0` |
| `docs/qc-evidence/TERM-LIBRARY-SAMPLES.md` | source decisions ($0 total), alias requirement, the two queue defects, "what is left to build" |
| `docs/qc-evidence/ATS-RESEARCH.md` §3 | match tiers: exact -> scored, accepted variant -> scored, loose -> shown-not-scored, model -> never scored |
| `docs/qc-evidence/BACKLOG.md` P1.2 / P1.2b | `model_inferred` never in numerator OR denominator; SOC 2 alias rule; "adding an alias does not change any historical score, because scores record the version they used" |

---

## BLOCKING DEFECT FOUND WHILE WRITING THESE ACs — read before implementing

**`appChecks.ts:136` hardcodes `covered: 0`.**

```ts
const scoreable = Number((await client.query(
  `select count(*)::int as n from term_library_entry e join term_library l on l.id = e.library_id
    where e.scoreable = true and l.published_at is not null`)...).rows[0]?.n || 0)
const score = computeArtifactScore({ ..., keyword: scoreable > 0 ? { covered: 0, scoreable } : null, ... })
```

Today `keyword_coverage` is honestly `null` **only because `scoreable === 0`**. The instant this
lane PUBLISHES a version with scoreable entries, that ternary flips to the true branch and
`artifactScore.ts:127` computes `round(0 / scoreable * 100)` = **0**. Every artifact in the system
silently acquires a *measured-looking* `keyword_coverage = 0` with the source string
`"0/N scoreable library terms present"`, which reads as a fact and is a fabrication.

Downstream consumers that will immediately render that fabricated 0 (grepped, all of them):
`app/src/assetGate.js:377` (`Keywords present` gate row), `app/src/postingAnalysis.js:424-440`,
`app/src/qcRail.js:272`, `app/src/assetBlocks.js:364-404` + `app/src/screens/AssetBlocks.jsx:21`,
and `api/src/functions/tests/appReviewer.ts:299-311` (composite arithmetic).

**Consequence for sequencing: PUBLISH MUST NOT SHIP BEFORE THE MATCHER IS WIRED INTO `appChecks.ts`.**
This is the single highest-risk ordering constraint in the lane and it is encoded as AC-32..AC-35.

---

## EXTEND, DON'T DUPLICATE — what already exists and must be reused

The implementer's biggest risk on this lane is writing a second copy of something already on `main`.
Each row below was grepped, not assumed.

| Need | ALREADY EXISTS — extend this | Do NOT build |
|---|---|---|
| Normalize a term / phrase | `termMatch.ts: termNormalize()` (keeps `and` so `P&L` -> `p and l`; splits `SOC2` -> `soc 2`; strips `Type II`/`v2`/`4.0`) | a second normalizer; a stemmer (explicitly rejected: `ops`->`op`, `sre`->`sr`) |
| Build `alias_normalized` from `display_term` + `aliases` | `termMatch.ts: normalizeAliases(display, aliases)` | inline `aliases.map(termNormalize)` in the promote route |
| Decide if a posting/resume phrase matches an entry, honouring `match_mode` | `termMatch.ts: matchesEntry(entry, candidateRaw)` — already implements all three modes incl. the `case_sensitive_acronym` regex on `display_term` | a new matcher in the promote/coverage path |
| `confidence` from provenance | `termMatch.ts: confidenceFor(sources, evidenceDf)` — 0.7*corroboration + 0.3*log10 corpus | a model-scored confidence; a hand formula |
| Per-owner settings store | `owner_search_prefs` + `checkPrefs.ts` (`ENSURE_CHECK_COLUMNS_SQL` -> `checkPrefColumns()` derived whitelist) + route `GET/POST /api/app/search-prefs` (publishes `checkColumns` so the UI renders a control per setting) | a new `term_settings` table; a new settings route |
| Settings UI shell + tabs | `app/src/screens/Settings.jsx` `SECTIONS` array, `LABELS` map, `go('/settings/<key>')` | a standalone settings page |
| Curation-decision vocabulary | `term_candidate.status` `pending|approved|rejected|merged` + `merged_into` + `POST /api/app/qc/terms/candidate/{id}` (all live) | a second decision table or a `dismissed` boolean |
| Stale-candidate removal | `termsMine`'s purge loop (deletes PENDING rows the current filters no longer produce; never touches reviewed rows) | a separate cleanup route/workflow |
| Owner scoping / write auth | `appSession.ts: resolveOwner(req)` + `requireWrite(req)` | any new auth path |
| Live UI proof | `.github/workflows/ui-verify.yml` (`scripts/ui-verify.mjs`) — seeds `localStorage.ee_auth_user`, RELOADS, asserts `;`-separated substrings | a bespoke Playwright script |
| Live DB proof | `Boost_DB_Connector` MCP (brokered, ~1s); `db-query.yml` only as fallback | new fixture/export workflows |

**Naming collision to avoid:** `Settings ▸ Intake ▸ AtsSources` (`Settings.jsx:924`) is **job-board
ingestion** (Greenhouse/Lever/Ashby), NOT the ATS term library. Do not add term-library controls
there and do not name the new surface "ATS sources".

**Two things this lane's scope names that DO NOT exist yet and must be created (state this
explicitly before creating them):**
- an INSERT path into `term_library` / `term_library_entry` (the promote + publish routes) — the
  tables exist, nothing writes them;
- the `ats_term` per-posting rows BACKLOG P1.2 specifies (`requirement_ids[]`, `source`,
  `library_id`, `frequency_in_posting`, `status`). `schema.ts:878` already references
  `insertion.ats_term_id` with the comment *"no FK until a library version is published"*.

---

# ACCEPTANCE CRITERIA

Every AC below is binary. "Works correctly", "looks right", "should filter" are not ACs and none
appear. Each carries the concrete verification step.

## A. Junk-class exclusion (`termMiner.ts`) — MARKING, not filtering

> **Corrected per the owner's design correction above.** These ACs are written against a
> **classification pass that marks rows `status='rejected'` with a reason**, NOT against
> `ngramsForDoc` dropping phrases. `ngramsForDoc` keeps only its existing structural rules
> (stopword edge, all-noise, lone letter, `isBoilerplate`); the new junk classes go in the
> classification pass so every exclusion leaves an inspectable row.

**AC-1.** Given the 13 named top-45 offenders (`long term`, `bachelor degree`, `high performing`,
`related field`, `computer science`, `orientation gender`, `vice president`, `regard to race`,
`dental and vision`, `united states`, `sex sexual`, `master degree`, `advanced degree`), when the
classification pass runs over the mined rows, then **each of the 13 exists as a `term_candidate`
row with `status='rejected'` and a non-null reason naming its class**, and **none** of the 13
appears in `status='pending'`.
*Verify:* a new unit test `api/test/termMiner.test.mjs` importing the exported classifier from
`../dist/functions/tests/termMiner.js`, asserting `classify(<phrase>)` returns the expected class
for each of the 13, **each phrase named in the assertion message** so a failure says which one
leaked. Then live SQL:
```sql
select normalized, status, <reason_col> from term_candidate
 where owner_email=$1 and normalized in (<the 13>);
```
Assert 13 rows, all `rejected`, all with a reason.

**AC-2.** Given the same pass, when the high-value exec terms the miner exists to preserve are
classified — `operating model`, `digital transformation`, `P&L`, `M&A`, `R&D`, `executive
leadership`, `cross functional`, `go to market`, `data governance`, `identity and access
management`, `SOC 2`, `CI/CD` — then **all twelve classify as NOT-junk** and remain `pending`
(in their `termNormalize` forms, e.g. `p and l`, `ci cd`, `soc 2`).
*Verify:* same test file, positive assertions in the same `test()` as AC-1 so a rule that passes
AC-1 by over-blocking fails here. **This is the over-blocking guard and it is mandatory** — a
degree-class rule written as a bare `/degree/` or `/\bcomputer\b/` regex destroys any `... degree of
automation` phrasing and `computer vision`. Extend the fixture with the 20-known-good-exec-terms set
the coordinator measured (19 survived; only `chief technology officer` was removed, correctly).

**AC-3.** Given `isBoilerplate()` uses **substring** matching (`BOILERPLATE.some(b =>
phrase.includes(b))`), when a new blocklist entry is added, then no entry is a substring of a
legitimate term: a guard test iterates every `BOILERPLATE`/new-list literal against a fixture list
of at least the 12 keep-terms in AC-2 plus the 27 terms in `TERM-LIBRARY-SAMPLES.md`, and asserts
**zero** collisions.
*Verify:* test asserts `keepTerms.filter(t => LIST.some(b => termNormalize(t).includes(b)))` is
`[]`, printing any collision. (Worked example of the trap this catches: adding the literal
`term` to block `long term` would also block `long term care`, `short term`, and any phrase
containing the substring — including `long term disability`, which is fine, and nothing else, which
is not checked today.)

**AC-4.** Given job titles are a **different axis** owned by `persona` / `taxonomy_title`
(`schema.ts:195` states this separation explicitly), when `vice president` / `senior vice
president` / `chief technology officer` / `director of engineering` are classified, then they are
marked `rejected` with class `job_title` — **matched as whole normalized phrases against an
owner-editable list, NEVER by a prefix regex such as `^chief `**.
*Verify:* unit test asserts class `job_title` for each; **and** asserts `chief of staff
responsibilities` and `chief architect roadmap ownership` are **NOT** classified `job_title` — the
counter-examples `^chief ` would destroy. The response body of `POST /api/app/qc/terms/mine`
reports counts per class (AC-9) and `job_title` is non-zero on the live corpus.
*Evidence this is not hypothetical:* `^chief ` was measured to catch 17 live rows, all 17 genuinely
titles — **clean by luck**. The measurement proves the rule works today; it does not prove the rule
is right, and this repo's guard rules distinguish those two things.

**AC-5.** Given every auto-exclusion decides that a candidate never reaches the owner — which is
**accusation-grade** — when any exclusion class is evaluated, then the match is **whole normalized
phrase equality, or a whole-token-sequence containment with explicit boundaries**, never an
unanchored substring, a prefix/suffix regex, or any similarity score.
*Verify:* a guard test in `hardening.test.mjs` (`H:exclusion-classes-are-exact`) that, with comments
stripped, asserts the classifier source contains **no** `levenshtein|similarity|fuzzy|\.startsWith\(|
\^` regex anchor over free text, and that every class rule is expressed as a `Set` lookup or an
exact list membership test.
**Mutation-prove:** replace one class rule with `phrase.startsWith('chief ')` and confirm the guard
FAILS. A guard that cannot fail on the exact pattern the owner rejected is inert.
*Note the deliberate asymmetry:* the PRE-EXISTING `isBoilerplate` uses substring matching
(`phrase.includes(b)`). That is grandfathered, but its entries are inspected by AC-3 and **no new
class may adopt that shape**.

**AC-6.** Given the STOP-set comment already states length is deliberately NOT an edge test because
`P&L` normalizes to `p and l`, when the new filters are added, then **no new rule rejects a phrase
on token length or on a single-character token**.
*Verify:* `hardening.test.mjs` source grep on the new code for `.length < ` / `.length <= ` within
the edge/rejection path, plus the AC-2 positive assertion on `p and l`.

**AC-7.** Given `ngramsForDoc` is a pure exported function, when the new filters are added, then
`ngramsForDoc` remains pure (no DB read, no `await`, no settings fetch inside the loop) and any
owner-configurable filter data is passed **in as a parameter** with the code-seeded default.
*Verify:* signature is `ngramsForDoc(text, maxN = 4, opts?: { blocklist?, classes? })`; source grep
asserts no `client.query` / `getPgClient` inside the function body; the existing call site in
`termsMine` passes the loaded owner config.

**AC-8.** Given the corpus contains an empty / null / sub-200-char `jd_real`, when `termsMine`
runs, then those rows are skipped without throwing and `corpusSize` reports only the scanned rows.
*Verify:* existing SQL already filters `length(coalesce(jd_real,'')) > 200`; unit-test
`ngramsForDoc('')` and `ngramsForDoc(null)` return an empty Set (regression guard on the
`decodeEntities(text || '')` path).

**AC-9.** Given a curator needs to know *why* the queue shrank, when `POST /api/app/qc/terms/mine`
returns, then the JSON body includes a `rejected` object with a count per class (at minimum
`stopword_edge`, `boilerplate`, `degree_education`, `eeo_benefits`, `generic_filler`, `job_title`,
`geography_employment_type`) and the counts sum to a number reported alongside `distinctNgrams`.
*Verify:* call the live route via `api-test.yml` (`POST /api/app/qc/terms/mine?owner=von.ellis@enterpriseds.io`)
and read `rejected` from the job log; assert every class key is present and at least four are `> 0`.

**AC-10.** Given the measured baseline is **106 junk rows of 2,734 pending (3.9%) and 8 junk in the
top 45 by specificity**, when the new filters ship and a re-mine completes, then the top 45 of
`GET /api/app/qc/terms/candidates?status=pending&limit=45` contains **0** of the 13 named offenders,
and a human-readable before/after is recorded in this file.
*Verify:* live SQL via `Boost_DB_Connector`:
```sql
select normalized, df, n, df * (case n when 1 then 0.25 when 2 then 1.0 when 3 then 1.2 else 1.1 end) as spec
from term_candidate where owner_email='von.ellis@enterpriseds.io' and status='pending'
order by spec desc limit 45;
```
Assert none of the 13 appear. **A zero-row or zero-count result is a result to investigate, not a
pass** — if `count(*)` for pending drops to 0 the filters over-blocked and AC-10 FAILS.

## B. Re-mine and stale-row handling

**AC-11.** Given four of the offenders (`regard to`, `orientation gender`, `sex sexual`,
`dental and vision`) are **already literal `BOILERPLATE` entries** and the live rows are stale from a
mine that predates them, when `termsMine` runs, then those rows leave `pending` **without being
deleted**: each is updated to `status='rejected'` with reason class `stale_filter`, and the response
reports `staleMarked >= 4` (the field formerly named `staleRemoved`).
*Verify:* record the count from the `api-test.yml` job log; then live SQL
```sql
select normalized, status, <reason_col> from term_candidate where owner_email=$1
 and normalized in ('regard to race','orientation gender','sex sexual','dental and vision');
```
Assert **4 rows still exist**, all `rejected`, all reason `stale_filter`. A result of 0 rows means
the delete was left in place and AC-11 FAILS.
*(This AC also exists to stop the implementer "fixing" a bug that is already fixed: these four are
in `BOILERPLATE` today and `isBoilerplate` uses substring matching, so re-adding them is a no-op and
is evidence the implementer did not read the code.)*

**AC-12.** Given a candidate a human has already decided on, when `termsMine` re-runs with stricter
rules that would now reject that term, then the row is **neither deleted nor re-marked**: its
`status`, `merged_into`, `reviewed_at`, `reviewed_by` and reason are unchanged. A human decision
outranks a rule change.
*Verify:* seed a local Postgres (per CLAUDE.md recipe) with one `status='approved'` row whose
`normalized` is in a new exclusion class; run the pass; assert the row survives byte-identical
(compare a `row_to_json` snapshot before/after).
**Mutation-prove:** remove `and status = 'pending'` from the update predicate and confirm the test
FAILS.

**AC-13.** Given the upsert clause `... do update ... where term_candidate.status = 'pending'`,
when a re-mine encounters an `approved` row whose df changed, then `df`/`sample_opp_ids`/`corpus_size`
are **not** overwritten.
*Verify:* same local seed; assert `df` unchanged after re-mine. (Note as a finding, not a fix:
this means an approved candidate's `evidence_df` can be stale at promote time — see AC-27.)

**AC-14.** Given the re-mine is the step that makes the queue trustworthy, when it is run against
production, then the run is evidenced by a route response recorded in this file containing
`corpusSize`, `distinctNgrams`, `candidatesUpserted`, `staleRemoved`, and `rejected` — not by a
"triggered" or "queued" status.
*Verify:* paste the `api-test.yml` job-log body here. A 204/queued response is explicitly **not**
confirmation (CLAUDE.md "Verify before reporting").

**AC-15.** Given `termsMine` today issues one `delete` per stale row in a loop with no transaction,
when the mark-not-delete change ships, then the pass is a **single set-based `update`** —
`update term_candidate set status='rejected', <reason_col>='stale_filter', reviewed_at=now(),
reviewed_by='system:termsMine' where owner_email=$1 and status='pending' and normalized <> all($2)`
— so an interruption cannot leave a partial state and 2,734 rows cost one round trip, not 2,734.
*Verify:* source grep asserting no `delete from term_candidate` remains in `termMiner.ts`; local
Postgres run over 2,734 seeded rows completing in a single statement; interrupt/re-run convergence
test (final state equals uninterrupted state).

## C. Curation screen

**AC-16.** Given `app/src/` today has **zero** consumers of `qc/terms/*` (verified: `grep -rn
"qc/terms\|termsCandidates\|term_candidate" app/src/` returns nothing, and `app/src/api.js` has no
terms method), when the curation screen ships, then `app/src/api.js` gains exactly the methods the
existing routes need — `termCandidates(status, opts)`, `termCandidateDecide(id, body)` — and each
passes `?owner=${_owner}`.
*Verify:* grep asserts `owner=` is present on the candidates GET. **This is the `listPersonas` bug
class**: `resolveOwner` silently falls back to `demo@executive-engine.local`, so an omitted `owner`
param renders an empty queue that looks like "no candidates" rather than an error.
Live proof: `ui-verify.yml` with `owner=von.ellis@enterpriseds.io` asserting a term known to be in
the queue renders.

**AC-17.** Given the screen is reached from the existing Settings shell, when the owner opens it,
then it is a new `SECTIONS` entry in `app/src/screens/Settings.jsx` (route `#/settings/<key>`),
**not** a new top-level page or a second settings surface.
*Verify:* `ui-verify.yml` with `route: "#/settings/terms"`, `expect` containing the tab label plus
two known queue terms.

**AC-18.** Given 2,734 candidates, when the queue renders, then it paginates or virtualises and the
default view is **specificity-ranked** (the route's existing `order by specificity desc, normalized`),
with `df`, `df_pct`, `n` and `corpus_size` visible per row.
*Verify:* `ui-verify.yml` asserts the first row equals the first row of the SQL in AC-10; assert the
DOM does not contain 2,734 rows at once (`limit` default ≤ 200, matching the route's default).

**AC-19.** Given the owner clicks Approve / Reject, when the request completes, then
`term_candidate.status`, `reviewed_at` and `reviewed_by` are updated in the DB and the row leaves
the pending list without a full page reload.
*Verify:* click via `ui-verify.yml`, then `Boost_DB_Connector`:
`select status, reviewed_at, reviewed_by from term_candidate where id=$1` returns the new status and
a non-null `reviewed_at`.

**AC-20.** Given `status='merged'` requires `mergedInto` (the route 400s without it), when the owner
merges `artificial intelligence` (df 151) and `machine learning` (df 107) into `ai_ml`, then the UI
**cannot submit a merge without a target**, and the target is chosen from existing approved
candidates / existing `term_key`s — never free text that can typo into a dangling key.
*Verify:* UI assertion that the Merge button is disabled with no target selected; route-level test
that `POST .../candidate/{id}` with `{status:'merged'}` and no `mergedInto` returns **400** with the
message `mergedInto (a term_key) is required when status=merged`.

**AC-21.** Given `merged_into` is a free-text `text` column with **no FK** (`schema.ts`), when a
merge is recorded, then the promote step (AC-25) **fails loudly** on a `merged_into` that resolves
to no `term_key`, rather than silently dropping the merged candidate's df from the entry.
*Verify:* local Postgres: insert a merged candidate pointing at `does_not_exist`, run promote,
assert a non-2xx with the offending `merged_into` named in the error. **A merged candidate that
vanishes is a coverage undercount, which is accusation-grade.**

**AC-22.** Given a decision is a human judgement, when the owner rejects a candidate, then the
rejection is reversible from the UI (set back to `pending`) **or** the route explicitly refuses and
the UI says so — no silent one-way door.
*Verify:* the current route's `status` whitelist is `approved|rejected|merged` and does **not**
include `pending`, so today reversal is impossible. Either extend the whitelist (and test that
`{status:'pending'}` returns 200 and clears `reviewed_at`) or render the Reject action with an
explicit "this cannot be undone" confirmation. Binary either way: one of the two must be true and
tested. *(Prefer reversible — CLAUDE.md "prefer reversible over destructive".)*

**AC-23.** Given the route returns `{ error }` with a 500 on a DB failure, when the API errors, the
screen shows the error text and does **not** render an empty queue as "nothing to review".
*Verify:* `ui-verify.yml` against a route forced to error, or a unit test of the screen's error
branch; assert the string "0 candidates" is absent when the fetch failed. **"No dead UI" +
"absent evidence is not_applicable, never pass".**

**AC-24.** Given `POST /api/app/qc/terms/candidate/{id}` is behind `requireWrite`, when an
unauthenticated session attempts a decision, then the API returns the `requireWrite` guard status
and the UI surfaces it rather than optimistically removing the row from the list.
*Verify:* `api-test.yml` call without a session Bearer (using only `?owner=`) returns the guard
response; UI test asserts the row is still present after a failed decision.

## D. Promote: approved candidate -> `term_library_entry`

**AC-25.** Given an approved `term_candidate`, when the promote route runs, then it inserts a
`term_library_entry` into a **draft** (`status='draft'`, `published_at is null`) `term_library` row
and sets, on every entry: `term_key`, `display_term`, `normalized`, `aliases`, `alias_normalized`,
`family`, `term_type`, `match_mode`, `sources` (containing `jd_corpus`), `evidence_df`, `scoreable`.
*Verify:* local Postgres round trip; assert `select count(*) from term_library_entry where
family is null or term_type is null or alias_normalized = '{}'` is **0**.

**AC-26.** Given `alias_normalized` is what the matcher's gin index searches
(`term_entry_alias_idx ... using gin (alias_normalized)`), when an entry is created, then
`alias_normalized` is produced by **`normalizeAliases(display_term, aliases)` from `termMatch.ts`**
and always contains `termNormalize(display_term)` itself.
*Verify:* unit test asserting `entry.alias_normalized.includes(termNormalize(entry.display_term))`
for every promoted entry; source grep asserting the promote module imports `normalizeAliases` and
contains no second `.map(termNormalize)` over aliases. **Mutation-prove:** drop `display` from the
`normalizeAliases` seed array and confirm the test FAILS.

**AC-27.** Given `SOC 2`, `SOC 2 Type II` and `SOC2` must be ONE entry or coverage counts are wrong
(BACKLOG:94), when they are promoted, then exactly **one** `term_library_entry` exists with
`term_key='soc_2'` and `matchesEntry(entry, x)` is `true` for all three surface forms **and for
`S.O.C. 2`** (`termNormalize` collapses dotted acronyms).
*Verify:* `api/test/termMatch.test.mjs` extension asserting all four forms match one entry, and
`select count(*) from term_library_entry where library_id=$1 and normalized='soc 2'` = 1.
**Mutation-prove:** promote them as three entries and confirm the count assertion FAILS.

**AC-28.** Given `case_sensitive_acronym` exists because lowercase `AI` hits *detail/email/retail*
and `ML` hits *html*, when an acronym entry is promoted, then `match_mode='case_sensitive_acronym'`
is set for at minimum `AI`, `ML`, `SAFe`, `ERP`, `CRM`, `LLM`, `GCP`, and a test proves the
false-positive is actually excluded.
*Verify:* `termMatch.test.mjs`: `matchesEntry({display_term:'AI', match_mode:'case_sensitive_acronym',
alias_normalized:['ai']}, 'retail email detail')` is **false**; the same entry against
`'experience with AI platforms'` is **true**. For `SAFe`:
`matchesEntry(safeEntry, 'a safe environment')` is **false** while `'SAFe certification'` is **true**.
Live corroboration for the threat model: `safe` appears in **302** postings, `scaled agile` in **8**.
**Mutation-prove:** flip that entry to `exact_norm` and confirm the false-positive assertion FAILS.

**AC-29.** Given `match_mode` decides whether a term scores against a document, when the promote UI
assigns it, then the default is `exact_norm` and any `token_subset` assignment requires an explicit
per-entry choice — `token_subset` is never applied in bulk or by heuristic.
*Verify:* source grep in `hardening.test.mjs`: the promote path contains no expression that derives
`match_mode` from `n`, from token count, or from a regex on the term. Assert every
`match_mode='token_subset'` row in the DB has a non-null `reviewed_by`-equivalent audit field.
*Rationale:* `matchesEntry`'s `token_subset` branch returns true when an alias's tokens are a subset
of the candidate's — the loosest mode available, and the one most able to inflate coverage.

**AC-30.** Given `confidence` is defined as independent-source corroboration and only the corpus has
been consulted, when an entry is promoted from `jd_corpus` alone, then `confidence` is set by
`confidenceFor(sources, evidence_df)` **or left null** — and is never a model output or a hand
constant.
*Verify:* source grep asserting no literal numeric assignment to `confidence` in the promote path;
unit test that `confidenceFor(['jd_corpus'], 303)` equals the stored value for a promoted entry.
**Never fabricate a composite** — if `sources` is empty, `confidence` must be null, not 0.

**AC-31.** Given `scoreable` is the column that enforces "model terms never score" and every
candidate here is corpus-attested, when entries are promoted, then `scoreable=true` is set **only**
for entries whose `sources` contain at least one non-model source, and any entry seeded from
`requirement.model_keyword` (jd_table's ATS Keyword — `requirements.ts:59`: *"MODEL-GENERATED: a
P1.2 candidate, never scoreable"*) is stored with `scoreable=false`.
*Verify:* SQL invariant test: `select count(*) from term_library_entry where scoreable = true and
(sources = '{}' or 'model' = any(sources))` is **0**. **Mutation-prove:** insert one such row and
confirm the assertion FAILS. This is the P1.2 acceptance *"a model-invented term is visibly labelled
and provably excluded from the score"*.

## E. THE SEQUENCING CONSTRAINT — publishing before wiring coverage fabricates a score

**AC-32.** Given `appChecks.ts:136` passes `keyword: scoreable > 0 ? { covered: 0, scoreable }
: null` with a **literal zero numerator**, when the first library version is published, then
`covered` is computed from real matching of the artifact's text against the published entries — it
is **not** left as `0`.
*Verify:* source grep in `hardening.test.mjs` asserting the literal `covered: 0` no longer appears
in `appChecks.ts`; plus a unit test of the coverage function returning a non-zero `covered` for an
artifact whose text contains a published term. **Mutation-prove:** restore `covered: 0` and confirm
the test FAILS.

**AC-33.** Given `artifactScore.ts:126-128` computes `keyword_coverage` for **any** `scoreable > 0`,
when the coverage numerator cannot be honestly computed (no matcher wired, artifact text
unavailable, posting text empty), then `keyword` is passed as `null` and `keyword_coverage` stays
`null` with source `"no published term-library version has scoreable entries yet"` — a `0` is never
stored.
*Verify:* `api/test/artifactScore.test.mjs` extension: `computeArtifactScore({..., keyword:
{covered: 0, scoreable: 40}})` yields `value: 0` — assert that this input **is never produced** by
`appChecks` when the matcher has not run, by unit-testing `appChecks`'s keyword-input builder
directly. **A 200 with a zero count is a result to investigate, not a pass.**

**AC-34.** Given publishing flips a system-wide ternary, when the first `term_library` version is
published, then a live re-run of the checks on at least 3 real artifacts shows
`artifact_score.keyword_coverage` values that are each either `null` or a number **corroborated by
listing the matched terms** — and no artifact silently moves from `null` to `0`.
*Verify:* `Boost_DB_Connector` before/after:
```sql
select artifact_id, keyword_coverage, keyword_source from artifact_score
 where computed_at > now() - interval '1 day' order by computed_at desc limit 20;
```
Assert no row has `keyword_coverage = 0` with `keyword_source like '0/%'` unless the artifact
genuinely contains none of the published terms, proven by naming which terms were searched.

**AC-35.** Given every downstream surface renders that number, when publish lands, then each of
these is re-checked and reconciles with `artifact_score` (they read one funnel, per the
trace-every-dependent rule): `app/src/assetGate.js:377` (`Keywords present`),
`app/src/postingAnalysis.js:424-440`, `app/src/qcRail.js:272`, `app/src/assetBlocks.js:364-404`,
`app/src/screens/AssetBlocks.jsx:21-22,256,422`, `api/src/functions/tests/appReviewer.ts:299-311`.
*Verify:* list all six in the PR description with the state of each after publish; `ui-verify.yml`
asserts the `Keywords present` row on a real packet shows the same numerator/denominator as the SQL
in AC-34. **Each of those files currently contains a hardcoded comment asserting "zero published
scoreable rows exist" — every one of those comments becomes false on publish and must be updated in
the same commit.**

**AC-36.** Given `appChecks.ts` counts scoreable entries with `l.published_at is not null` while the
immutability trigger keys on `l.status = 'published'`, when a library row has one but not the other,
then the two predicates agree — either both use `status='published'`, or a DB `check` constraint
makes `published_at is not null` and `status='published'` equivalent.
*Verify:* local Postgres: insert `term_library(status='archived', published_at=now())` with a
scoreable entry; assert `appChecks`'s count query returns **0** for it. Today it returns 1 — **an
archived library still feeds the score.** **Mutation-prove:** remove the fix and confirm FAIL.

**AC-37.** Given BACKLOG P1.2b's acceptance is *"adding an alias does not change any historical
score, **because scores record the version they used**"*, when a score is written, then
`artifact_score` records the `term_library` id **and** version it scored against.
*Verify:* `artifact_score` has **no such column today** (read `schema.ts:621-647`) — so this
requires a schema addition. Assert `select term_library_id, term_library_version from artifact_score
limit 1` succeeds and is non-null on any row with a non-null `keyword_coverage`; add a `check
(keyword_coverage is null or term_library_id is not null)`. Run the **fresh-vs-upgraded parity
test** (`api/test/schemaParity.test.mjs`) — a column added inline to `create table if not exists`
never reaches production, which is the exact defect that test exists for.

**AC-38.** Given the score must be reproducible for a given version, when the same artifact is
re-scored against the same published library version with no other change, then `keyword_coverage`
is **byte-identical**.
*Verify:* run the checks route twice on one artifact; assert the two `artifact_score` rows have
equal `keyword_coverage` and equal `keyword_source`; assert no model call occurred (no
`usage_metering` row for the keyword feature between the two runs).

## F. Publish + immutability (the DB trigger must actually hold)

**AC-39.** Given `term_entry_guard_trg` is declared `before update or delete on
term_library_entry` (`schema.ts:257-259`), when an INSERT is attempted into a **published**
library, then it is **rejected**.
*Verify:* local Postgres, against the real `SCHEMA_SQL`:
```sql
insert into term_library (library_key, version, status, published_at)
  values ('exec_v1', 1, 'published', now()) returning id;
insert into term_library_entry (library_id, term_key, display_term, normalized, family, term_type)
  values ('<that id>', 'sneaky', 'Sneaky', 'sneaky', 'x', 'y');   -- MUST raise
```
**MEASURED BY READING THE TRIGGER: this INSERT SUCCEEDS TODAY.** The trigger does not list `insert`.
So a published version's entry set can grow after publication, changing the coverage **denominator**
for every historical score computed against it. Fix = add `insert` to the trigger event list (and
guard `new.library_id` — the existing `coalesce(old.library_id, new.library_id)` body already
handles it). **Mutation-prove:** revert the trigger to `before update or delete` and confirm the
test FAILS.

**AC-40.** Given nothing guards the `term_library` row itself, when `update term_library set
status='draft' where status='published'` is attempted, then it is **rejected** — otherwise every
other immutability AC is bypassable in one statement (unpublish -> edit entries freely -> re-publish).
*Verify:* local Postgres: attempt the update on a published row and assert it raises. Also assert
`update term_library set published_at = null where status='published'` raises, and `update
term_library set version = version + 1 where status='published'` raises. **These three all succeed
today.** **Mutation-prove:** drop the new guard and confirm each FAILS.
*(Legal transition to preserve: `published` -> `archived` must remain allowed, and it must remove
the version from the scoreable set — see AC-36.)*

**AC-41.** Given adding an alias must create version N+1, when the owner adds `SOC2` as an alias to
a published entry, then the write path creates a **new draft** `term_library` row at
`version = N+1`, copies every entry forward with the same `term_key`s, applies the alias to the copy,
and publishes it — and version N's rows are unchanged.
*Verify:* local Postgres end-to-end; assert
`select alias_normalized from term_library_entry e join term_library l on l.id=e.library_id where
l.version=<N> and e.term_key='soc_2'` is **identical before and after**; assert version N+1 contains
the new alias; assert `term_key` is the same string in both versions (it is the cross-version
identity per `schema.ts:218`).

**AC-42.** Given `unique (library_key, version)`, when two publishes race, then version numbers are
assigned without a lost update.
*Verify:* local Postgres: two concurrent transactions each doing `select max(version)+1` then insert
— assert one fails on the unique constraint and the route returns a retriable error rather than a
500 with a raw `duplicate key` string. **Do not compute the next version with a plain `select
max()`** outside a lock or an `insert ... on conflict` retry.

**AC-43.** Given `term_library.entry_count` is a stored `int not null default 0` that nothing
maintains today, when a version is published, then `entry_count` equals
`(select count(*) from term_library_entry where library_id = l.id)`.
*Verify:* SQL invariant test asserting the two agree for every row; run it after publish.
**A denormalized count that disagrees with its own rows is the "stale/mismatched numbers are a
symptom" failure** — either maintain it in the publish transaction or drop the column.

**AC-44.** Given CC BY 4.0 (O*NET) and the ESCO Commission Decision oblige naming the release and
the attribution string wherever derived terms surface, when a version is published, then
`source_manifest` is non-empty and carries, per source: name, exact release/version, retrieval URL,
retrieval date, licence, and required attribution string.
*Verify:* `select source_manifest from term_library where status='published'` — assert
`jsonb_typeof(source_manifest) = 'object'` and it has a key for every distinct value appearing in
`term_library_entry.sources` for that library. Assert the required ESCO string *"This service uses
the ESCO classification of the European Commission"* is present if `esco` is among them.
**Corpus-only first version:** manifest must still name `jd_corpus` with the corpus size and mine
date. Empty `{}` on a published version FAILS.

**AC-45.** Given publish is irreversible, when the owner triggers it, then the route requires an
explicit confirmation input (e.g. `{ confirm: true, expectedEntryCount: N }`) and refuses if
`expectedEntryCount` does not match the actual draft count.
*Verify:* route test: mismatched count returns 400 naming both numbers; matching count returns 200.
**Prefer reversible over destructive; ground-truth the affected row count before any bulk mutation.**

**AC-46.** Given a draft library may contain zero scoreable entries, when publish is attempted on an
empty or all-`scoreable=false` draft, then it is **refused** with a message saying so.
*Verify:* route test asserts 400. Publishing an empty version would flip `scoreable > 0` false→
still-false (harmless) but publishing an all-unscoreable version with one scoreable row added later
is the AC-39 hole; refusing empties removes a whole class of half-published states.

## G. No hardcoded config

**AC-47.** Given `STOP`, `BOILERPLATE` and the new junk-class rules are exactly the kind of list an
owner would tune, when they ship, then every one of them is loadable from the **existing** per-owner
settings store (`owner_search_prefs` via `checkPrefs.ts`'s derived-column pattern) with the code
literal acting only as the seeded default.
*Verify:* extend `H:every-threshold-is-configurable` (or add
`H:term-filters-are-configurable`): parse the filter-list names declared in `termMiner.ts`, parse
what the loader returns, assert the set difference is `[]`. **Mutation-prove:** add a new code-only
list and confirm the test FAILS. *Note the sibling guard `H:every-chk-column-is-selected` — a column
the loader never selects is a setting that does nothing; the new lists need the same pairing.*

**AC-48.** Given the specificity weights `n=1:0.25, 2:1.0, 3:1.2, 4:1.1` are duplicated in
**two places** — `termMiner.ts:131` (`specificity()`) and the SQL in `termsCandidates` (`case n when
1 then 0.25 ...`) — when they become owner-configurable, then there is exactly **one** declaration
and both the miner ranking and the queue ordering read it.
*Verify:* source grep asserting the literal `0.25` / `1.2` appears once in `termMiner.ts`. Today the
two can drift and the curator's queue order would stop matching the miner's own ranking. **This is a
pre-existing duplication in scope for this lane.**

**AC-49.** Given `minDf` defaults to 5 and `maxN` to 4 with `Math.max(2, ...)` / `Math.min(4, ...)`
clamps, when the owner wants a different corpus threshold, then `minDf`/`maxN`/`limit` are settable
from the UI and the clamps are documented as the seeded bounds, not silent constants.
*Verify:* settings round-trip test through `GET/POST /api/app/search-prefs`; UI control rendered
from the API's published column list (the pattern `Settings.jsx:1577` already uses:
*"THE FIELD LIST COMES FROM THE API, not from this file"*).

**AC-50.** Given `family` and `term_type` are `text not null` with **no `check` constraint and no
enumeration anywhere in code**, when the promote UI offers them, then the option lists come from an
owner-editable config (seeded with the families in `TERM-LIBRARY-SAMPLES.md`: `leadership`,
`strategy_operating_model`, `transformation`, `governance_risk`, `product_gtm`, plus the schema
comment's `compliance|security|cloud_platform|data_ai`) — not a hardcoded array in a JSX file.
*Verify:* settings round-trip; UI renders from the fetched list; a source grep asserts no literal
family array in `app/src/screens/`.

**AC-51.** Given the score weights `{mustHave, keyword, seniority}` already exist in
`artifactScore.ts` `DEFAULT_WEIGHTS` and are stored per score row, when keyword coverage becomes a
real number, then the keyword weight is confirmed to be owner-settable (or explicitly recorded as
owner-approved code-only).
*Verify:* check `loadThresholds` for a weight column; if absent, this AC is a **finding** requiring
either a column or a recorded owner approval, per the no-hardcoded-config rule's escape hatch.

## H. Mark-don't-delete, the reason column, and its migration

*(This section implements the owner's design correction. AC-1/4/5/11/12/15 above were corrected in
place to match it; no delete-style version of them remains in this file.)*

**AC-52.** Given a wrong exclusion must be learnable and recoverable, when any automatic exclusion
pass runs (junk classification, stale-filter sweep, or any future rule), then **zero rows are hard
deleted from `term_candidate`**.
*Verify:* `H:exclusion-never-deletes` in `hardening.test.mjs` — source grep asserting
`termMiner.ts` contains no `delete from term_candidate` (comments stripped). **Plus** a live
before/after row count:
```sql
select status, count(*) from term_candidate where owner_email=$1 group by status;
```
Total across all statuses **must not decrease** across a re-mine. **Mutation-prove:** reinstate the
delete and confirm the guard FAILS.

**AC-53.** Given `term_candidate` has no column to record why a row was excluded, when the reason
column is added, then it is a single new column following this schema's conventions (proposed
`reject_reason text` — nullable, since a human `rejected` via `termsCandidateDecide` may have no
machine class; an `excluded_class text` alongside is acceptable but only if BOTH are populated by
the classifier and neither is left write-only).
*Verify:* `select reject_reason from term_candidate limit 1` succeeds; `EXPECTED_TABLES` /
`schemaParity` unchanged in table set.

**AC-54.** Given this repo has shipped the "column added inline to `create table if not exists`,
exit 0, never reaches production" defect **four times**, when the reason column is added, then it is
added by an **idempotent `alter table ... add column if not exists`** placed AFTER the
`create table if not exists term_candidate` block, and **no statement anywhere in `SCHEMA_SQL` names
the new column before that ALTER** (H39/H39b).
*Verify:* run `api/test/schemaParity.test.mjs` — the fresh-vs-upgraded parity test — and it must
PASS, not skip. A skip is absent evidence, not a pass. **Additionally run the populated-database
migration by hand per CLAUDE.md:** apply `origin/main`'s `SCHEMA_SQL`, seed real `term_candidate`
rows, then apply the branch's `SCHEMA_SQL` on top with `psql -v ON_ERROR_STOP=1`; exit code must be
0 and the seeded rows must still be present with `reject_reason` null.

**AC-55.** Given the curation queue must not show junk while the excluded set stays auditable, when
the curation screen loads with no explicit status, then it requests `status=pending` (the route's
existing default) and offers an explicit "Show excluded" view over `status=rejected` that displays
the reason per row.
*Verify:* `ui-verify.yml` on the curation route asserting a known junk term (e.g. `bachelor degree`)
is **absent** from the default view and **present with its reason** in the excluded view.

**AC-56.** Given a rule change can silently over-reject, when an exclusion pass completes, then the
route response reports, per class, the number marked **and** the total now in `rejected`, and the
implementer records the measured numbers for the exact ruleset shipped in this file.
*Verify:* paste the `POST /api/app/qc/terms/mine` response body here. **Neither of the two prior
measurements (106-row and 81-row) may be quoted as the result** — they were produced by different
proposed rulesets against the same 2,734-row queue and they disagree class-by-class
(degree 32 vs 26, title 21 vs 22, EEO 24 vs 16, filler 21 vs 8). Reusing either would be reporting a
number that was never measured on the shipped code.

**AC-57.** Given an auto-rejection is a machine decision and a curator decision is a human one, when
a row is auto-rejected, then `reviewed_by` records a **system identity** distinguishable from an
owner email (e.g. `system:termsMine`), and the curation UI labels it as automatic.
*Verify:* SQL asserting every auto-rejected row has `reviewed_by like 'system:%'` and every
human-decided row has `reviewed_by` equal to an owner email; UI assertion that the excluded view
distinguishes the two. **Without this, an auto-rejection is indistinguishable from the owner's own
judgement, and AC-12's "a human decision outranks a rule change" becomes unenforceable.**

**AC-58.** Given a restored candidate must genuinely return to review, when the owner flips an
auto-rejected row back to `pending`, then it is **not** re-rejected by the next mine.
*Verify:* local Postgres: mark a row `rejected` by class, flip to `pending` with a human
`reviewed_by`, re-run the pass, assert it is still `pending`. **This requires the pass to skip rows
a human has touched** — i.e. the predicate must be `status='pending' and (reviewed_by is null or
reviewed_by like 'system:%')`, not `status='pending'` alone. **Mutation-prove:** drop the
`reviewed_by` clause and confirm the test FAILS. *(Cross-check with AC-22: if the decide route's
whitelist never accepts `pending`, this AC is untestable through the API and AC-22 must be
implemented first.)*

**AC-59.** Given `termsMine`'s upsert currently only updates rows `where term_candidate.status =
'pending'`, when a term previously auto-rejected reappears in the corpus with a higher df, then its
`df` is either refreshed or deliberately frozen — and which one is chosen is stated, not accidental.
*Verify:* local Postgres test asserting the chosen behaviour explicitly. **Flagged risk:** with
mark-not-delete, rejected rows now persist forever and their `df` silently ages, so the excluded
view will display stale frequencies unless this is decided.

**AC-60.** Given the excluded set now grows monotonically, when the queue is inspected after several
re-mines, then `term_candidate` row growth is bounded and reported (`count(*) by status`), and any
retention policy is an **owner setting**, not a hardcoded cap.
*Verify:* live count before/after three re-mines; settings round-trip for any retention value.

**AC-61.** Given the classifier decides what the owner never sees, when it ships, then it is a
**pure exported function** (`classifyCandidate(normalized, opts) -> { class, reason } | null`)
independently unit-testable without a DB.
*Verify:* `api/test/termMiner.test.mjs` imports and exercises it directly; source grep asserts no
`getPgClient` / `client.query` inside it.

**AC-62.** Given exclusion lists are exactly the kind of thing an owner tunes, when the classifier
reads its class lists, then they come from the existing per-owner settings store
(`owner_search_prefs` + `checkPrefs.ts` derived-column pattern), seeded from code — and AC-47's
configurability guard covers them.
*Verify:* settings round-trip through `GET/POST /api/app/search-prefs`; the owner adds one term to
`generic_filler`, re-mines, and that term moves from `pending` to `rejected` with the new reason —
**proven by SQL, not by the UI reporting success**.

## I. Error states, regression guards, and mutation proofs

**AC-63.** Given the schema is the source of truth, when this lane's schema changes ship
(reason column, AC-37's version columns, AC-39/AC-40's triggers, AC-36's predicate), then
`schemaParity.test.mjs` PASSES (not skips) and the populated-database upgrade runs clean under
`ON_ERROR_STOP=1`.
*Verify:* run both, paste exit codes and output here.

**AC-64.** Given every new guard must be provably non-inert, when this lane ships, then **each**
new H-case is mutation-proven: revert the behaviour, confirm the suite FAILS, restore.
*Verify:* one line per guard in the PR body naming the mutation applied and the assertion that
fired. A mutation that is behaviourally equivalent and correctly fails to fail must be **said so**,
not counted as proof. Guards requiring this: AC-5, AC-11(via AC-52), AC-12, AC-26, AC-27, AC-28,
AC-31, AC-32, AC-36, AC-39, AC-40, AC-47, AC-52, AC-58.

**AC-65.** Given H-case naming is by SLUG and a numeric ID fails `H26`, when new guards are added,
then every one uses a two-word-minimum slug (`H:exclusion-never-deletes`,
`H:exclusion-classes-are-exact`, `H:published-library-is-immutable`,
`H:keyword-coverage-has-no-fabricated-zero`, `H:term-filters-are-configurable`).
*Verify:* run `api/test/hardening.test.mjs`; `H26` passing is the proof.

**AC-66.** Given a DB outage, when any of the new routes (mine, promote, publish) fails mid-way,
then the response is a non-2xx with an error naming the step, and no partial library version is left
in a state where `scoreable > 0` for entries belonging to an incomplete publish.
*Verify:* local Postgres, kill the connection mid-promote; assert `select count(*) from
term_library where status='published' and entry_count <> (select count(*) from term_library_entry
where library_id = term_library.id)` is 0. Promote+publish must be in one transaction.

**AC-67.** Given `resolveOwner` falls back to `demo@executive-engine.local` on a missing `?owner=`,
when any new route or API method is added, then it passes `owner` explicitly and a test proves a
missing owner does not silently read the demo tenant.
*Verify:* route test calling without `?owner=` asserts the response identifies the demo owner
explicitly rather than returning the production owner's rows. **This is the `listPersonas` bug.**
*Open question the implementer must answer, not assume:* `term_library` / `term_library_entry` are
deliberately **NOT owner-scoped** (`schema.ts:196`: *"shared reference data"*) while
`term_candidate` **is**. Promotion therefore crosses a tenancy boundary — see Finding 8.

**AC-68.** Given a term's surface form differs from its normalized form, when an entry is created,
then `display_term` preserves the employer's real casing (`SOC 2`, `SAFe`, `P&L`) and is **not** the
normalized string.
*Verify:* assert `display_term <> normalized` for every acronym entry; assert
`case_sensitive_acronym` entries have a `display_term` containing at least one uppercase character —
otherwise `matchesEntry`'s regex (`new RegExp('\\b' + display_term + '\\b')`) is
case-insensitively equivalent and the mode does nothing. **Mutation-prove:** set an acronym's
`display_term` to lowercase and confirm AC-28's false-positive assertion FAILS.
*Note:* `term_candidate.ngram` stores `v.surface`, which `termsMine` sets to the **normalized**
string (`df.set(g, { ..., surface: g })` where `g` is already normalized) — **so the original casing
is NOT captured anywhere in the queue today.** Promotion cannot recover `SAFe` from `safe`. Either
the miner must record the real surface form, or the promote UI must require the owner to type the
display form. Binary: one of the two must be implemented and tested.

**AC-69.** Given the terms surface in the UI, when a published library is shown, then the library
key, version and entry count are rendered (SPEC §4.1: *"Footer names the library (`ENG-LEAD v4`,
1,840 terms, its sources)"*) along with the source attributions from `source_manifest`.
*Verify:* `ui-verify.yml` on the JD-analysis ATS keywords tab asserting the library name, version
and count strings render, and that the O*NET/ESCO attribution strings appear when those sources are
in the manifest.

**AC-70.** Given `docs/qc-evidence/qc/data.js:25` hardcodes `TERM_LIB = { id: 'ENG-LEAD v4', size:
1840, sources: [...] }` and is rendered by `packet.jsx:103` and `evidence.jsx:177`, when a real
library is published, then no surface renders that fabricated prototype constant as live data.
*Verify:* grep those three files; assert the live app reads the library identity from the API. **"No
dead UI · never render hardcoded fake names, counts, or statuses as live data."**

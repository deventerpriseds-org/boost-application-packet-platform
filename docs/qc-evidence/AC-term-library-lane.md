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

## A. Miner filter extension (`termMiner.ts`)

**AC-1.** Given the five junk classes measured live on 2026-08-24 (degree/education 32,
EEO/benefits 24, generic filler 21, job title 21, geography/employment-type 8), when
`ngramsForDoc()` is called on a posting containing each of the 13 named top-45 offenders
(`long term`, `bachelor degree`, `high performing`, `related field`, `computer science`,
`orientation gender`, `vice president`, `regard to race`, `dental and vision`, `united states`,
`sex sexual`, `master degree`, `advanced degree`), then the returned `Set` contains **none of the
13**.
*Verify:* a new unit test in `api/test/` (new file `termMiner.test.mjs`, or extend
`termMatch.test.mjs`) that imports `ngramsForDoc` from `../dist/functions/tests/termMiner.js` and
asserts `assert.equal(set.has(<phrase>), false)` for each of the 13, **each phrase listed by name in
the assertion message** so a failure says which one leaked.

**AC-2.** Given the same call, when the posting text also contains the high-value exec terms the
miner exists to preserve — `operating model`, `digital transformation`, `P&L`, `M&A`, `R&D`,
`executive leadership`, `cross functional`, `go to market`, `data governance`, `identity and access
management`, `SOC 2`, `CI/CD` — then **all twelve are present** in the returned Set (as their
`termNormalize` forms, e.g. `p and l`, `ci cd`, `soc 2`).
*Verify:* same test file, positive assertions in the same `test()` as AC-1 so a filter that passes
AC-1 by over-blocking fails here. **This is the over-blocking guard and it is mandatory** — a
degree-class filter written as a bare `/degree/` or `/\bcomputer\b/` regex destroys `data
governance`-adjacent vocabulary and any `... degree of automation` phrasing.

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
president` / `chief technology officer` / `director of engineering` appear in a posting, then they
are excluded from term candidates **and** the exclusion reason is recorded as a distinct class from
boilerplate.
*Verify:* unit test asserts absence; **plus** the response body of `POST /api/app/qc/terms/mine`
reports counts per rejection class (see AC-9), and the `job_title` class is non-zero on the live
corpus.

**AC-5.** Given generic filler (`high performing`, `related field`, `fast paced`, `proven track`),
when the filter runs, then the rejection is by **whole normalized phrase equality or a
phrase-boundary rule**, never by an unanchored substring or a fuzzy/similarity score.
*Verify:* a source grep test in `hardening.test.mjs`: assert the new filter code in `termMiner.ts`
contains no `levenshtein|similarity|fuzzy|includes(` construct inside the new rejection function
(comments stripped before matching, per the H-case cry-wolf rule). This is the standing rule
*"fuzzy matching is for RANKING, never for ACCUSING"* — a filter that removes a curator's candidate
is accusing.

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

## B. Re-mine and purge

**AC-11.** Given four of the offenders (`regard to`, `orientation gender`, `sex sexual`,
`dental and vision`) are **already literal `BOILERPLATE` entries** and the live rows are stale from a
mine that predates them, when `termsMine` runs, then those rows are removed by the **existing purge
loop with no code change to the purge**, and `staleRemoved` in the response is `>= 4`.
*Verify:* record `staleRemoved` from the `api-test.yml` job log; then live SQL
`select count(*) from term_candidate where owner_email=$1 and status='pending' and normalized in
('regard to race','orientation gender','sex sexual','dental and vision')` returns **0**.
*(This AC exists to stop the implementer "fixing" a bug that is already fixed in code. Adding these
four again to the blocklist is a no-op and would be evidence the implementer did not read
`isBoilerplate`.)*

**AC-12.** Given a candidate a human has already decided on, when `termsMine` re-runs with stricter
filters that would now reject that term, then the row is **not** deleted and its `status`,
`merged_into`, `reviewed_at`, `reviewed_by` are unchanged.
*Verify:* seed a local Postgres (per CLAUDE.md recipe) with one `status='approved'` row whose
`normalized` is in the new blocklist; run the purge logic; assert the row survives byte-identical.
**Mutation-prove:** remove `and status = 'pending'` from the delete and confirm the test FAILS.

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

**AC-15.** Given `termsMine` deletes rows one-by-one in a loop with no transaction, when a re-mine
is interrupted mid-purge, then the queue is left in a state where re-running the route converges
(no partial-delete corruption) — or the purge is wrapped in a single `delete ... where status =
'pending' and normalized <> all($2)` statement.
*Verify:* local Postgres: seed 200 pending rows, run the purge, kill after N deletes, re-run, assert
final state equals the state from an uninterrupted run. **Flagged as a real risk:** 2,734 rows ×
one round-trip each is also a latency problem on the live Function.

# AC — ATS Term Library build & publish (TIER 1)

Written adversarially and independently, 2026-08-25, branch `claude/render-interaction-states`.
**The implementer's framing was not trusted.** Every claim below cites the file:line that was read.
Where the brief and the code DISAGREE, the code is recorded as ground truth and the disagreement is
raised as a blocker, not silently reconciled.

Status: IN PROGRESS — appended incrementally. Sections land in order; a missing section means the
pass was interrupted there.

---

## 0. GROUND TRUTH READ (what the code actually says, before any AC)

| Claim in the brief | What the source says | Verdict |
|---|---|---|
| "MEMBERSHIP: a term enters only if ESCO or O*NET names it, OR curated" | `schema.ts:228-230` — *"O\*NET/ESCO are helpers, **never gates** — a term the corpus attests is valid even if neither lists it (most exec vocabulary is in that position)."* And `sources` legally contains `jd_corpus` (`schema.ts:230`). | **DIRECT CONTRADICTION.** See BLOCKER-1. |
| "`term_candidate` rows become tier-3 frequency input, NOT promotion candidates" | `schema.ts:308-310` — `status` check allows `'approved'` and `'merged'`, and `merged_into` names a `term_key`. `termMiner.ts:10-11` — *"Candidates only become scoreable after a human approves them into a published term_library version."* | The existing design **does** treat them as promotion candidates. The brief changes that. Not wrong, but it is a design change to an existing documented path — must be stated, not assumed. See BLOCKER-2. |
| "model-coined terms NEVER enter the coverage denominator" | `schema.ts:233` — `scoreable boolean not null **default true**`. `appChecks.ts:130-132` counts `where e.scoreable = true`. | The default is the WRONG WAY ROUND for a tier-1 invariant. An insert that forgets `scoreable` scores. See BLOCKER-3. |
| the library is versioned and immutable once published | `schema.ts:253-293` — two triggers. | True for `published`. **Not true for `archived`.** See BLOCKER-4 (bypass chain). |
| coverage denominator | `artifactScore.ts:137-141`; numerator/denominator = `kwIn.covered / kwIn.scoreable`, fed from `appChecks.ts:141`. | Confirmed. The denominator is a **raw count of scoreable entries in ANY library row with a non-null `published_at`** — no `library_key`, no version filter. See BLOCKER-5. |

### The five load-bearing files, and the one line in each that matters

- `api/src/functions/tests/schema.ts:200-317` — `term_library`, `term_library_entry`, `term_candidate`, `term_entry_guard`, `term_library_guard`.
- `api/src/functions/tests/appChecks.ts:130-141` — the ONLY producer of the keyword denominator.
- `api/src/functions/tests/artifactScore.ts:137-141` — the consumer that turns it into a percentage.
- `api/src/functions/tests/termMatch.ts:71-91` — `matchesEntry` returns `boolean`; exact/variant/loose is DISCARDED.
- `docs/qc-evidence/qc/data.js:79-94, 559-560, 605-613` — the row schema the UI expects, `libTerms()`/`modelTerms()`, and `matchRows()` which builds the keyword row `d: lib.length` from `libTerms()` — i.e. **the prototype's denominator already excludes `source: 'model'` by construction.** The DB has no equivalent exclusion; `scoreable` is the only lever and it defaults to `true`.

---

## 1. BLOCKERS — resolve BEFORE writing code, not during

### BLOCKER-1 — the membership rule contradicts the schema's own recorded owner directive
`schema.ts:227-230` states, as an owner directive, that O\*NET/ESCO are **helpers, never gates**, and
gives the measured reason: *"roadmap 626, board 480, budget 416, operating model 222, P&L 83 — none
in O\*NET"* (`schema.ts:299`). The brief's option B makes them a **binary gate**.

Both cannot be true. Under the brief's gate, five of the owner's own most-frequent exec terms —
including `P&L`, which the owner hand-curated (`TERM-CURATION-v1.md`) and which `termMatch.ts:4-8`
was specifically written to preserve — are admissible **only** via the `curated` escape hatch.

That is survivable, but it means: **the `curated` layer is not a minor override, it is the primary
admission path for exec vocabulary.** Any AC or guard that treats `curated` as an exceptional case
will be wrong about the common case. Whichever way the owner rules, the losing text in
`schema.ts:227-230` must be edited in the same commit, or the next agent will read a comment that
says the opposite of the guard and "fix" the guard.

**AC-B1**: Given `schema.ts:227-230` currently states O\*NET/ESCO are never gates, when the gate is
implemented, then that comment block is rewritten in the same commit to state the gate rule and to
name `curated` as the exec-vocabulary path — and a source-grep guard asserts the comment and the
enforcing code do not disagree (see MUT-7).

### BLOCKER-2 — "frequency may RANK but never ADMIT" has no enforcement point in the current schema
`sources text[]` (`schema.ts:230`) is a bare array with **no CHECK constraint** on its contents and
no constraint requiring at least one taxonomy source. `jd_corpus` is an explicitly listed legal
value. So today, `insert ... sources => '{jd_corpus}'` produces a fully scoreable library entry
admitted by frequency alone. The invariant is currently **documentation, not a constraint**.

**AC-B2**: Given the membership invariant, when any row exists in `term_library_entry`, then
`sources` contains at least one of `onet`, `esco`, `curated` — enforced by a DB CHECK constraint on
the table (not by application code), so the invariant holds against `psql`, a migration, a backfill
script, and a future route that has not been written yet.
Observable: `insert into term_library_entry (... sources => '{jd_corpus}')` raises, exit code non-zero.

> Application-level enforcement is insufficient here for a measured reason: this table is populated
> by a seeder, a curation import, and (per the brief) a model-coin path — three producers. A rule
> enforced in one producer is not enforced.

### BLOCKER-3 — `scoreable` defaults to `true`, so the model-term invariant fails OPEN
`schema.ts:233`: `scoreable boolean not null default true`. `appChecks.ts:132`: `where e.scoreable = true`.
A model-coined entry inserted without an explicit `scoreable => false` lands in the denominator of
every artifact score. The invariant "model terms never score" is one forgotten column away from
false, and the failure is **silent and score-inflating** — exactly the class `artifactScore.ts:138-141`
was written to avoid.

**AC-B3**: Given a `term_library_entry` with `'model'` in `sources`, when it is inserted with
`scoreable` unspecified, then the insert is REJECTED (or `scoreable` is forced false) by a DB-level
constraint — `check (not ('model' = any(sources)) or scoreable = false)` — never by the column
default alone.
Observable: `insert ... sources => '{model}'` with no `scoreable` → error; with `scoreable => false` → success.

Note the enum in `schema.ts:230` does **not currently list `model`** as a legal source value. Adding
it is part of this feature and must be added to the comment enumeration AND to whatever CHECK
AC-B2 introduces, or `model` silently becomes an unrecognised-but-legal string.

### BLOCKER-4 — published-immutability is bypassable via `archived`
Read `term_library_guard` (`schema.ts:273-288`): it only constrains rows whose **`old.status = 'published'`**,
and of those it blocks only `published → draft`. `published → archived` is permitted.
Read `term_entry_guard` (`schema.ts:253-262`): it raises only when the parent library
`status = 'published'`.

Therefore this chain is currently legal:

1. `update term_library set status='archived' where id=X` — allowed (guard only blocks `→draft`).
2. `update/delete/insert term_library_entry where library_id=X` — allowed (parent is no longer `published`).
3. `update term_library set status='published' where id=X` — allowed (`old.status='archived'`, so the
   guard's whole body is skipped).

Net effect: the entries of a published version can be rewritten in place, and the "a score recorded
against version N re-renders identically forever" guarantee that `schema.ts:198-199` and
`schema.ts:244-252` exist to provide is void. The 2026-08-24 fix closed INSERT-while-published; it
did not close archive-then-edit.

**AC-B4**: Given a `term_library` row that has ever been published (`published_at is not null`), when
any `insert`/`update`/`delete` is attempted on its `term_library_entry` rows in ANY parent status,
then it is rejected.
Observable: the three-step chain above fails at step 2 with the immutability exception.
**Enforcement note**: `term_entry_guard` must test `l.published_at is not null`, NOT `l.status='published'`.

**AC-B4b**: Given an archived library version, when `status` is set back to `'published'`, then the
update is rejected — a version's publish lifecycle is one-way (`draft → published → archived`).
Observable: `update term_library set status='published'` on an archived row raises.

### BLOCKER-5 — the denominator sums EVERY published version, so re-ingest doubles it
`appChecks.ts:131-132`:
```sql
select count(*)::int as n from term_library_entry e join term_library l on l.id = e.library_id
 where e.scoreable = true and l.published_at is not null
```
There is no `library_key` filter, no `version` filter, and no notion of a *current* version anywhere
in the codebase (grepped: the only `term_library` references in `api/src` and `app/src` are
`appChecks.ts:130-132` and comments — no selector exists). Consequences, all of which fire the first
time a second version is published, i.e. **exactly the ESCO/O\*NET re-ingest case in the brief**:

- v1 (1,000 terms) + v2 (1,050 terms) published → denominator becomes 2,050. Every score drops ~50%.
- The condition is `published_at is not null`, which an **archived** row still satisfies. Archiving
  a superseded version does **not** remove it from the denominator.
- A second `library_key` (e.g. a per-persona library) would be silently summed into the same number.

**AC-B5**: Given two published versions of the same `library_key`, when keyword coverage is
computed, then the denominator counts entries of exactly ONE resolved version.
Observable: publish v1 with N entries, read `keyword_coverage.source`; publish v2 with M entries;
re-read — the source string names M (or N), never N+M.

**AC-B5b**: Given a published version that has since been archived, when the denominator is
computed, then its entries are excluded.
Observable: archive v1 after publishing v2, denominator is unchanged at M.

**AC-B5c**: Given the resolution rule, when it selects a version, then the rule is a single named
function used by every consumer (`artifactScore`, the JD step, `assetBlocks.js:486`, `qcRail.js:274`,
`postingAnalysis.js:440`), not repeated inline — per CLAUDE.md "Trace every dependent".
Observable: `grep -rn "published_at is not null" api/src` returns exactly one call site.

### BLOCKER-6 — THE DENOMINATOR MEANS TWO DIFFERENT THINGS IN THE SPEC AND IN THE CODE

**Observation.** In the handed-over spec, `ATS_TERMS` (`data.js:79-94`) is **posting-scoped**: every
row carries `reqs: [...]` naming requirements of *this one posting* (`T1 → ['M3','D1']`,
`T10 → ['N2']`). `libTerms()` (`data.js:559`) filters that already-scoped list by `source`, and
`matchRows()` (`data.js:613`) uses `d: lib.length` — **13** — as the keyword denominator.

In the implementation, `appChecks.ts:131-132` counts **every** scoreable entry in **every** library
row with a non-null `published_at`, with no reference to the opportunity, its requirements, or its
role family. `artifactScore.ts:141` then divides by that number.

**Interpretation (confidence: high; would be settled by publishing one version and reading
`keyword_coverage.source` on a real artifact).** These are not the same measurement. The spec asks
*"of the terms this posting demands, how many did we place?"* The code asks *"of every term in the
whole library, how many did we place?"* With the curated set alone (~105 entries, §3 below) the
second number is roughly one tenth of the first; at the prototype's advertised `size: 1840`
(`data.js:25`) it is under 1%. **Every artifact would render a red, measured-looking sub-10% keyword
score the day the library publishes** — a fabricated-looking failure, which is the same class of
harm `artifactScore.ts:138-141` and `TERM-CURATION-v1.md` ("Blocked on") were written to prevent,
inverted.

**AC-B6**: Given a published library and an artifact for a specific opportunity, when
`keyword_coverage` is computed, then the denominator is the set of library terms **that this
posting's requirements demand**, resolved from `requirement`/`requirement.verbatim` — not the global
entry count.
Observable: two opportunities with different requirement sets, scored against the same library
version, produce **different** denominators. If both produce the same number, the scoping is not
applied and the AC fails.

**AC-B6b**: Given the denominator is posting-scoped, when a posting demands zero library terms, then
`keyword_coverage` is `{ value: null, source: '<reason>' }`, never `0` and never `100`.
Observable: `artifactScore.ts:137-141` — an empty denominator must take the null branch. (Today
`scoreable <= 0` takes it; a posting-scoped zero must too, or `covered/0` is `NaN`/`Infinity`.)

> This is the single most expensive item in this pass. It is not a rounding question — it decides
> whether the first published library makes every packet look broken. It also determines whether
> "the AI may coin a term when the library lacks one" is even reachable: coining is defined relative
> to *what the posting demands*, which only exists if the denominator is posting-scoped.

### BLOCKER-7 — `matchesEntry` returns a boolean, so `exact | variant | loose` cannot be rendered
`termMatch.ts:71-91`: `matchesEntry(...): boolean`. The spec requires three distinguishable states
(`data.js:75-78`): `exact` (literal term present), `variant` (same concept, different wording,
accepted and shown), `loose` (adjacent, weaker credit, flagged). `data.js:468-474` counts variants;
`data.js:628-631` pushes every `loose` term into ATTENTION as "earns no score credit"; the chip UI
needs the quality, not the boolean.

A boolean cannot carry that. Collapsing it means either (a) `loose` matches silently count as
matches — **score inflation, tier 1** — or (b) `variant` matches are dropped, under-reporting
coverage and pushing the owner to copy the posting verbatim, which is the exact behaviour
`data.js:78` exists to prevent.

**AC-B7**: Given an entry and a candidate string, when the matcher is called, then it returns a
result carrying the match QUALITY (`exact | variant | loose`) and the alias that matched, not a bare
boolean.
Observable: `matchesEntry(entry, 'SOC 2 Type II')` on entry `soc_2` returns `{ match: 'exact'|'variant', via: '<alias>' }`; the type signature no longer says `: boolean`.

**AC-B7b**: Given a match of quality `loose`, when coverage is computed, then that term counts in
neither numerator nor denominator, and it is surfaced as an attention row.
Observable: mirrors `data.js:628-631`; a `loose`-only asset scores the same as an asset with no
match at all, and the term appears under "Unscored match".

**AC-B7c**: Given `match_mode = 'token_subset'` (`termMatch.ts:83-88`), when it fires, then the
result is at best `variant`, never `exact`.
Rationale: `token_subset` accepts an entry alias whose tokens are a subset of the candidate's — i.e.
`operating model` matches the candidate `target operating model transformation`. That is a ranking
judgement, and CLAUDE.md's standing rule is that fuzzy matching may RANK but never ACCUSE. An
`exact` label on a subset match is an accusation-grade claim built on a fuzzy test.
Observable: an entry with `token_subset` never yields `match: 'exact'` for any input.

---

## 2. ACCEPTANCE CRITERIA

### 2.1 Membership — the binary gate (frequency may RANK, never ADMIT)

**AC-1 (happy path)**: Given a candidate phrase attested by ESCO or O\*NET, when it is promoted into
a draft library, then the entry is created with that taxonomy id recorded in `source_refs`
(`schema.ts:231`) and the taxonomy name in `sources` (`schema.ts:230`).
Observable: `select sources, source_refs from term_library_entry where term_key='...'` returns a
non-empty `source_refs` whose key matches a value in `sources`.

**AC-2 (the invariant)**: Given a candidate with a very high `df` and no taxonomy attestation and no
owner curation, when promotion runs, then **no entry is created**, at any `df`.
Observable: seed a synthetic candidate with `df = corpus_size` (100% of postings); run the promoter;
`select count(*) from term_library_entry where term_key = <that>` returns 0. **This is the
mutation-proof target MUT-1.**

**AC-3 (curated override)**: Given a term in `TERM-CURATION-v1.md`, when it is seeded, then its
`sources` contains `curated`, and the file's own line is recorded in `source_refs` so the decision is
traceable back to the diff the owner reviewed.
Observable: `source_refs->>'curated'` names the file and section, e.g. `TERM-CURATION-v1.md#leadership`.

**AC-4 (no silent third path)**: Given the set of all producers that can write `term_library_entry`
(the ESCO/O\*NET ingester, the curated seeder, the model-coin path, any future route), when each
writes, then the membership rule is enforced by the DB CHECK of AC-B2 — so a producer that forgets
it fails loudly.
Observable: `grep -rn "insert into term_library_entry" api/src` — every hit is exercised by a test
that asserts the CHECK fires on a `jd_corpus`-only insert.

**AC-5 (error state)**: Given the ESCO or O\*NET source file is missing, unreadable, or a different
release than `source_manifest` records, when ingest runs, then it ABORTS and publishes nothing.
Observable: non-zero exit, `term_library.status` stays `draft`, `entry_count` unchanged.
Rationale: `schema.ts:205-207` requires exact release + retrieval URL + date + licence per source.
"Absent evidence is `not_applicable`, never `pass`" (CLAUDE.md) — a missing taxonomy must not
degrade into "curated-only", which would let frequency admit by the back door.

### 2.2 Weight — ranking only

**AC-6**: Given tiers 1/2/3 with weights, when a weight is changed (including tier 3 → 0), when the
library is re-seeded, then **the set of `term_key`s is byte-identical** and only `weight` /
`evidence_df` differ.
Observable: `select term_key from term_library_entry order by 1` before and after produce identical
output; `diff` is empty. **MUT-2.**

**AC-7 (weights are settings, not literals)**: Given CLAUDE.md "No hardcoded config", when the tier
weights and the tier-3 enable/disable are set, then they live in the owner-changeable config store
with the code seeding only the first value, and the seeded values are recorded.
Observable: changing the tier-3 weight through the settings path, then re-running the ranker,
changes `weight` values without a redeploy.

**AC-8 (df is not comparable across corpora — a real defect)**: Given tier-1 counts are over 680
opportunities, tier-2 over 1,098, and `term_candidate.df` was measured over its own `corpus_size`
(`schema.ts:314`), when tiers are combined, then each tier's contribution is normalised by its own
denominator before weighting.
Observable: a term with `df=55, corpus_size=928` and a term with `df=55` out of 1,098 do not receive
equal tier-3 contribution.
**Evidence of the hazard:** `TERM-CURATION-v1.md` states *"Every `df` is a count of distinct postings
in your corpus of 928"*, while the brief states the miner *"only scanned 83 of 1,398 usable
postings"*. **These cannot both be true.** One of them is stale. Raw `df` summed across tiers with
unequal, unrecorded denominators is arithmetic on incompatible units.
→ **UNRESOLVED FACT — must be settled from the DB before coding**:
`select corpus_size, count(*), min(mined_at), max(mined_at) from term_candidate group by 1;`
(This pass could not run it: the `Boost_DB_Connector` / `boost-pg-mcp-write` connectors report
*requires authentication* in this session. Ground truth is the query, not either document.)

**AC-9 (`packet.covered_kw` stays dropped)**: Given the decision to drop the 3-row source, when the
ranker runs, then no code path reads `packet.covered_kw`.
Observable: `grep -rn "covered_kw" api/src` returns no hit inside the term-library ranker.

### 2.3 Model-coined terms

**AC-10**: Given a JD requirement the library cannot satisfy, when the model coins a term, then the
entry is written with `'model'` in `sources`, `scoreable = false`, and it renders as
**"Loose — not scored"**.
Observable: the chip carries the loose treatment of `data.js:93-94` and appears in ATTENTION
(`data.js:628-631`).

**AC-11 (the invariant)**: Given any model-coined entry, when `keyword_coverage` is computed, then
that entry appears in neither numerator nor denominator.
Observable: publish a version of N taxonomy terms + M model terms; the `keyword_coverage.source`
string names N, never N+M. **MUT-3.**

**AC-12 (style constraint the owner asked for)**: Given the owner's *"generate in a similar
style/length to the others on the library"*, when a term is coined, then its token length is within
the library's observed distribution (`n` of 2–4, per `TERM-CURATION-v1.md`) and it is not a verb
phrase.
Observable: a coined term of 9 tokens, or one starting with a verb (`develop and execute` class,
rejected wholesale in `TERM-CURATION-v1.md`), is refused.

**AC-13 (a coined term is not a library term)**: Given a coined term, when the next library version
is built, then it does NOT auto-promote; it enters the same taxonomy-or-owner gate as anything else.
Observable: a coined term present in v1 with `sources={model}` is absent from v2 unless the owner
approved it, in which case `sources` contains `curated` and no longer contains only `model`.

### 2.4 Aliases and casing — BACKLOG.md:93 says this is load-bearing

**AC-14 (the SOC 2 case, stated exactly)**: Given `SOC 2`, `SOC 2 Type II` and `SOC2`, when each is
matched, then all three resolve to **exactly one** entry.
Observable — and note this ALREADY HOLDS in the normalizer, which is why the risk sits elsewhere:
`termNormalize` (`termMatch.ts:31,37`) splits the trailing digit run (`SOC2 → soc 2`) and strips
`type ii|2`, so all three yield `soc 2`. The failure mode is therefore **not** the normalizer; it is
that **nothing stops two entries from claiming the same normalized form.**

**AC-15 (the actual alias defect)**: Given `term_library_entry`, when two entries in the same library
would share any value across `normalized` ∪ `alias_normalized`, then the second insert is REJECTED.
Observable: `schema.ts:238` has only `unique (library_id, term_key)`. Insert `soc_2` (normalized
`soc 2`) and `soc_2_type_ii` (normalized `soc 2`) → today both succeed. After the fix the second
raises. **MUT-4.**
Consequence if unfixed: the denominator counts one concept twice, and one text occurrence satisfies
an arbitrary one of them — a coverage number that is wrong in both directions at once.

**AC-16 (`SOC` must NOT fold into `SOC 2`)**: Given `termMatch.ts:33-36` explicitly warns that SOC
also means Security Operations Center, when a posting says only `SOC`, then it does not match the
`soc_2` entry.
Observable: `matchesEntry(soc_2_entry, 'SOC')` is false. **Regression guard — MUT-5.**

**AC-17 (casing restoration)**: Given `term_candidate.ngram` stores the NORMALISED form despite its
comment claiming the surface form (`schema.ts:303` says *"the literal surface form as it appears in
postings"*; `TERM-CURATION-v1.md` measured that this is false), when a curated term is promoted, then
`display_term` carries real casing.
Observable, as named cases: `p and l → P&L`, `ci cd → CI/CD`, `r and d → R&D`, `ai ml → AI/ML`.
And `termNormalize(display_term)` must round-trip back to `normalized` — otherwise the displayed
term does not match its own index entry.
**MUT-6** — this is the one that fails silently: `case_sensitive_acronym` builds a regex from
`display_term` (`termMatch.ts:80`), so a lowercase `display_term` produces a regex that matches
nothing, and the entry sits in the denominator forever un-matchable, depressing every score.

**AC-18 (casing source)**: Given `SKILL_BANK` (`data.js:140-152`) holds 58 correctly-cased names,
when a curated term collides with one case-insensitively, then `SKILL_BANK`'s casing wins.
Observable: `data privacy → Data Privacy`, `machine learning → Machine Learning`,
`information security → Information Security`, `enterprise software → Enterprise Software`,
`emerging technologies → Emerging Technologies`, `change management → Change Management`.
Note `SKILL_BANK` says `P&L Management` while curation says `P&L`; that conflict must be decided
explicitly and recorded, not resolved by whichever loop ran last.

**AC-19 (`schema.ts:303`'s comment is wrong — fix it)**: Given the comment claims `ngram` is the
surface form and it is not, when this feature lands, then the comment is corrected in the same commit.
Rationale: CLAUDE.md — a comment that contradicts the data is how the next agent writes a promoter
that trusts `ngram` for display.

### 2.5 Re-ingest / versioning (the brief's item (d))

**AC-20**: Given published v1, when ESCO/O\*NET is re-ingested, then a NEW `term_library` row
(same `library_key`, `version = 2`) is created and v1 is untouched.
Observable: `select version, status, entry_count from term_library order by version` shows v1 still
`published` (or `archived`) with its original `entry_count`; zero rows of v1 changed. **MUT-8.**

**AC-21**: Given a score recorded against v1, when v2 publishes, then re-rendering that score
produces the identical number.
Observable: this is the acceptance `schema.ts:198-199` claims and **BLOCKER-5 currently breaks** —
`appChecks.ts:132` would sum v1+v2. Store the resolved `library_id` on the score row, or the claim
cannot be made at all.

**AC-22**: Given `term_key` is documented as stable across versions (`schema.ts:218`), when v2 is
built, then a term present in both versions carries the same `term_key`.
Observable: `select term_key from v1 intersect select term_key from v2` is non-empty and matches the
intended carry-over set; a re-ingest that regenerates keys from a UUID or from `display_term` casing
fails this.

**AC-23 (dangling pointer)**: Given `escalation.ats_term_id` has **no foreign key**
(`schema.ts:911`) and points at a *version-specific* entry `id`, when v2 publishes, then existing
escalations still resolve to a readable term.
Observable: an escalation created against v1 renders its term after v2 publishes. Fix is to store
`term_key` (stable) alongside or instead of the per-version `id`, or add the FK now that a version
can exist.

### 2.6 Publish

**AC-24**: Given a draft library, when it is published, then `entry_count` equals the actual number
of `term_library_entry` rows for that `library_id`.
Observable: `select l.entry_count, count(e.*) from term_library l left join term_library_entry e on e.library_id=l.id group by 1` — the two columns are equal for every row. `entry_count`
(`schema.ts:208`) is a denormalised int nothing currently maintains; a wrong value here is a wrong
number on a screen. **MUT-9.**

**AC-25**: Given publish, when `source_manifest` is written, then it names, per source: the exact
release, retrieval URL, retrieval date, licence, and the required attribution string
(`schema.ts:205-207`).
Observable: O\*NET (CC BY 4.0) obliges naming the release **and USDOL/ETA wherever terms surface** —
so the attribution must also be rendered in the UI, not merely stored.
**Do NOT copy the prototype descriptor.** `data.js:25` lists `'Lightcast skills'` — a commercial,
licensed taxonomy this project has no stated licence for — and `'3.1k exec postings'` and `size: 1840`,
none of which describe the real corpus (928 or 1,398 postings; ~105 curated terms). Copying it
records a false licence claim.

**AC-26 (publish is one-way)**: see AC-B4b. `draft → published → archived`, never backwards.

**AC-27 (error state)**: Given publish fails partway, when it aborts, then the library stays `draft`
and no consumer sees a partial version.
Observable: publish inside one transaction; kill it mid-write; `status` is still `draft` and
`appChecks.ts:132`'s count is unchanged.

---

## 3. WHAT COULD GO WRONG THAT THIS DESIGN DOES NOT YET HANDLE

Ordered by the brief's own priority. Items already raised as BLOCKERs are cross-referenced, not
repeated.

### (a) Paths by which a term can enter WITHOUT taxonomy or owner approval

| # | Path | Evidence | Severity |
|---|---|---|---|
| a1 | `sources` has no CHECK — a `jd_corpus`-only insert is legal today | `schema.ts:230,238` (only `unique(library_id, term_key)`) | **BLOCKER-2** |
| a2 | **The candidate-approval route is still live and applies no taxonomy test at all.** `termsCandidateDecide` (`termMiner.ts:197-221`) sets `status='approved'` on any candidate with no check beyond `requireWrite`. If the promoter reads `status='approved'`, then approving 2,734 pending rows in a loop admits 2,734 frequency-derived terms. | `termMiner.ts:204-215` | **HIGH** |
| a3 | The brief redefines candidates as *frequency input only*, but `term_candidate.status` still offers `approved`/`merged` and `merged_into` still names a `term_key` (`schema.ts:308-310`). Two contradictory meanings for one column. Either the promoter is deleted, or `approved` keeps meaning "promote" — and nothing in the schema records which. | `schema.ts:308-310`, `termMiner.ts:196-221` | **HIGH** |
| a4 | `termsMine` DELETES pending candidates the current filters no longer produce (`termMiner.ts:135-146`). If tier-3 weights are computed from `term_candidate`, a re-mine silently changes the weights of terms in a **published** library, and `evidence_df` (`schema.ts:235`, "at seed time") stops describing anything reproducible. | `termMiner.ts:138-146` | MEDIUM |
| a5 | `term_candidate` is **owner-scoped** (`schema.ts:302,315`); `term_library` is deliberately **NOT** (`schema.ts:194-196`). So one owner's corpus decides the ranking, and eventually the membership, of a library every owner is scored against. | `schema.ts:194-196` vs `302` | MEDIUM — needs an explicit owner decision |
| a6 | ESCO/O\*NET matching is itself a matching problem. If taxonomy attestation is decided by a fuzzy/`token_subset` comparison, frequency does not admit the term but a *similarity score* does — the same hole wearing a different hat. CLAUDE.md: fuzzy matching is for RANKING, never ACCUSING; admission is accusation-grade. | `termMatch.ts:83-88`, CLAUDE.md standing rules | **HIGH** |

**AC-28**: Given the taxonomy gate, when attestation is decided, then it uses exact normalized
equality against the taxonomy's own labels/alt-labels, never `token_subset` and never a threshold.
Observable: `operating model transformation` is not admitted on the strength of ESCO listing
`operating model`. **MUT-10.**

**AC-29**: Given a3, when this lands, then `term_candidate.status='approved'` either (i) no longer
exists as a legal value, or (ii) is documented and enforced as "the owner curated this" — i.e. it
sets `sources = {curated}` and nothing else. There is no third option in which it means "promote by
frequency".
Observable: a test asserts the promoter's `where` clause and the schema comment agree.

### (b) Paths by which a `model` term can reach the coverage denominator

| # | Path | Evidence |
|---|---|---|
| b1 | `scoreable` defaults `true` — one omitted column | **BLOCKER-3**, `schema.ts:233` |
| b2 | `appChecks.ts:132` filters on `scoreable`, **not on `sources`**. Any future writer that sets `scoreable=true` on a model row is invisible to the guard. Belt and braces: exclude `'model' = any(sources)` in the denominator query as well. | `appChecks.ts:131-132` |
| b3 | The denominator query has a `.catch(() => ({rows:[{n:0}]}))` (`appChecks.ts:132`). A DB error is swallowed into `scoreable = 0`, which takes the null branch — safe today, but it also means a broken query is indistinguishable from an unpublished library, and no one will notice the library stopped being read. | `appChecks.ts:132` |
| b4 | A coined term promoted into the next version (AC-13) without dropping `model` from `sources` | `schema.ts:230` |

**AC-30**: Given the denominator query, when it runs, then it excludes `'model' = any(sources)`
**in addition to** `scoreable = true` — two independent conditions, so one being wrong is not enough.
Observable: set `scoreable=true` on a model row by hand; the denominator does not move. **MUT-11.**

**AC-31**: Given b3, when the denominator query errors, then the failure is logged and distinguished
from "no published library", not silently coerced to 0.
Observable: `keyword_coverage.source` for a query failure says so; it does not say "no published
term-library version has scoreable entries yet" (`artifactScore.ts:138`), which would be a lie.

### (c) Alias / casing collisions

Covered by AC-14 … AC-18. The two that will actually bite, restated because they are easy to miss:

- **There is no uniqueness on `normalized`.** `BACKLOG.md:93` asks for one entry with aliases; the
  schema does not enforce it (`schema.ts:238`). Two entries sharing a normalized form inflate the
  denominator and make the numerator non-deterministic. **AC-15 / MUT-4.**
- **`display_term` casing is load-bearing for `case_sensitive_acronym`.** `termMatch.ts:80` builds
  the regex from `display_term`. A lowercase `display_term` yields a regex that never matches, and
  the entry becomes a permanent un-closable gap in the denominator. **AC-17 / MUT-6.**

Additional, not previously flagged: **`termNormalize` strips `type ii|2` unconditionally**
(`termMatch.ts:37`). `Type 2 diabetes`, `Type 2 hypervisor`, `SOC 2` and `ISO 27001 Type II` all lose
that token. Within an ATS term library this is almost certainly fine; it is recorded here so the
decision is deliberate rather than discovered.

**AC-32**: Given aliases are the mechanism, when an alias is added to a **published** version, then
it is rejected and a new version is required.
Observable: this is `BACKLOG.md:96`'s stated acceptance ("adding an alias does not change any
historical score") — it holds only if AC-B4's `published_at`-based guard is in place.

### (d) What happens to a PUBLISHED library when ESCO/O*NET is re-ingested

Covered by AC-20 … AC-23 and **BLOCKER-5**. The concrete failure, in order:

1. v2 publishes. `appChecks.ts:131-132` now counts **v1 + v2** — the denominator roughly doubles.
2. Archiving v1 does not help: the filter is `published_at is not null`, and archiving does not null
   `published_at` (`schema.ts:275-284` forbids changing it).
3. Every previously recorded score is now recomputed against a denominator that did not exist when
   it was written, and `schema.ts:198-199`'s guarantee is void.
4. Escalations carrying `ats_term_id` (`schema.ts:911`, no FK) point into v1 forever.

**AC-33**: Given re-ingest, when a term is DROPPED by the taxonomy (ESCO retires a concept), then v2
omits it and no historical score changes.
Observable: v1's `entry_count` and every v1-scoped score are byte-identical after v2 publishes.

**AC-34**: Given re-ingest, when a term's taxonomy id changes but its `term_key` does not, then
`source_refs` is updated in v2 only and the v1 row still shows the old id.
Observable: `select source_refs from term_library_entry where term_key=? ` differs per version.

### (e) Not in the brief's list, but found while reading

**e1 — the numerator does not exist, so publishing buys nothing yet.**
`appChecks.ts:141` passes `covered: null` unconditionally. `artifactScore.ts:139-140` maps that to
`{ value: null, source: '<N> scoreable library terms, but term placement has not been measured' }`.
So the moment the library publishes, six screens change from *"no library exists"* to *"a library
exists and we have not measured against it"* — and **still show no number**. Nothing in this feature
counts term placement per asset.
**AC-35**: Given the feature is "build and publish the term library", when it ships, then either
(i) the numerator (per-asset term placement) ships with it, or (ii) the owner is told explicitly
that `keyword_coverage` stays null and what the library IS delivering in the meantime (the ranked
bank the coiner models against, and the "Loose — not scored" chips). Silence here reads as a
regression to the owner.

**e2 — `TERM-CURATION-v1.md`'s own counts do not add up.** The title and headers say **96**; the
lists contain **105 unique terms**. Measured by parsing the file (backticked primaries per family,
alias parentheticals and the prose blockquote excluded):

| family | header claims | actually listed |
|---|---|---|
| leadership | 19 | 19 |
| strategy_operating_model | 23 | **25** |
| transformation | 11 | 11 |
| data_ai | 19 | **22** |
| governance_risk | 8 | 8 (incl. `data privacy`, flagged in-file as a duplicate of the data_ai entry) |
| engineering_platform | 16 | **21** |
| **total** | **96** | **106 listed / 105 unique** |

`data privacy` appears under two families and the file itself says *"one entry, primary family
governance_risk"* — a naive section-parsing seeder produces either two rows or a
`unique(library_id, term_key)` violation.
**AC-36**: Given the curated seed, when it runs, then the seeder reports the count it inserted and a
test asserts that number equals a **checked-in expected count** — and the count is derived from the
file, never hardcoded to 96.
Observable: seeding produces 105 (or whatever the owner confirms), `entry_count` matches, and
`data privacy` produces exactly one row with `family='governance_risk'`. **MUT-12.**

**e3 — several curated entries are phrase fragments, not terms.** `strategy and roadmap`,
`strategy and execution`, `strategy aligned`, `vision strategy`, `leadership roles`, `ai capabilities`.
Each is a real high-df n-gram and each will match promiscuously under `token_subset`. They are in the
denominator the owner's packets are scored against.
**AC-37**: Given a curated entry, when its `match_mode` is chosen, then a fragment-shaped entry is
`exact_norm`, never `token_subset`.

**e4 — the curated set is drawn from `n∈2..4` only.** `TERM-CURATION-v1.md` excludes all 945
single-word candidates wholesale, naming `cybersecurity` 205, `governance` 450, `roadmap` 387,
`compliance` 435, `architecture` 377 as real and valuable but deferred to "pass 2". Those are exactly
the words an ATS indexes. Publishing v1 without them means the denominator omits the highest-signal
single tokens while including `strategy aligned`.
**AC-38**: Given pass 2 is not done, when v1 publishes, then the owner is told which classes are
absent, in the UI or the publish note — not only in a markdown file.

**e5 — `library_key` scope is undecided.** The prototype's library is role-scoped (`ENG-LEAD v4`,
`data.js:25`); the DB has a `library_key` and no code that chooses one. If one global library is
published, AC-B6's posting-scoping is doing all the work; if per-role libraries are intended, the
resolution rule (AC-B5c) must pick by role and that is a second, unbuilt selector.

---

## 4. WHAT IS GENUINELY TIER 1 VS TIER 2

Per CLAUDE.md: *"Tier 1 is a property of the CODE PATH, not of the change's size."* Tier 1 = decides
a score, a coverage count, a gate, or admits model output into a stored claim.

### TIER 1 — full ceremony (independent ACs, independent verifier, mutation-proof, live verify)

| Component | Why it is tier 1 |
|---|---|
| The membership gate (`sources` CHECK, AC-B2/AC-2/AC-28) | Decides what is IN the denominator. Admission is accusation-grade. |
| `scoreable` / model-term exclusion (AC-B3, AC-30) | Directly moves the score numerator/denominator. |
| The denominator query in `appChecks.ts:130-132` and its scoping (BLOCKER-5, BLOCKER-6) | It **is** the denominator. Nothing here is cosmetic. |
| Version resolution (AC-B5, AC-21) | Wrong version = wrong score, silently, for every artifact. |
| Alias/normalized uniqueness (AC-15) | Duplicate concepts double-count in the denominator. |
| `display_term` casing for `case_sensitive_acronym` (AC-17) | A wrong value creates permanently unmatchable denominator entries — score-depressing and invisible. |
| The immutability guards (AC-B4, AC-B4b) | They are the only thing making "a score re-renders identically forever" true. |
| Match-quality `exact/variant/loose` (BLOCKER-7) | `loose` counting as covered is score inflation; the brief names it as a hard invariant. |
| The model-coin path end to end (AC-10 … AC-13) | Model output entering a stored claim, by definition. |
| `entry_count` correctness (AC-24) | It is rendered as a count to the owner. |

### TIER 2 — implement, test, mutation-prove the new guard only

| Component | Why not tier 1 |
|---|---|
| Ingest transport for ESCO/O\*NET (download, parse, cache) | No path to a score; its OUTPUT is gated by the tier-1 CHECK. A parse bug produces fewer/odd terms, which the membership CHECK and AC-24 catch. |
| Tier weights and the ranking arithmetic (AC-6, AC-8) | Ranking only — *provided* AC-6 is proven, i.e. that weights cannot change the term SET. Until AC-6 is mutation-proven, weighting is tier 1 by default. |
| The curation-review UI / settings screens for weights (AC-7) | UI wiring over a gated store. |
| `source_manifest` capture (AC-25) | Provenance/legal, not scoring. **Tier 1 for licence correctness** in the narrow sense that publishing a false licence claim is an external-facing assertion — treat AC-25 as tier 1 if Lightcast text is anywhere near the manifest. |
| Fixing the stale comments (`schema.ts:227-230`, `schema.ts:303`) | Tier 3 prose — but they must land in the SAME commit as the code they describe. |

### The line, stated plainly
Anything that can change the value of `kwIn.covered` or `kwIn.scoreable` at `artifactScore.ts:141`
is tier 1. Everything else is tier 2. That test is mechanical and does not require judgement about
size.

---

## 5. OWNER INTENT THE DESIGN DOES NOT ADDRESS

1. **"a clear word cloud on what companies are asking for on my roles"** — the design uses corpus
   frequency to RANK entries inside the library, but produces no artefact the owner can look at.
   The owner asked for visibility into the demand signal; ranking a hidden `weight` column is not
   that. Nothing in the brief renders it.
2. **"on MY ROLES"** — the demand signal is explicitly role-relative in the owner's words, and the
   library is deliberately not owner- or role-scoped (`schema.ts:194-196`). The design never
   reconciles those. Combined with e5, this is the same unresolved question twice.
3. **"if we dont find anything that satisfy something found or needed for a jd the ai can assume /
   create one using this bank as a strong model"** — "using this bank as a strong model" implies the
   coiner is given the library as style exemplars. The design says the coined term is *stamped* and
   *not scored*, but says nothing about how the bank is presented to the model, how many exemplars,
   or from which family. Without that, "in a similar style/length" (AC-12) is unenforceable at
   generation time and can only be checked after the fact.
4. **The numerator.** See e1. The owner's mental model is "the system catches these terms"; the
   system currently cannot count how many it caught. Publishing the library does not change that.
5. **Reversibility.** `TERM-CURATION-v1.md` opens with *"every one is reversible"* and
   *"Rejections MARK, they do not DELETE."* The library's own immutability guards make a published
   entry irreversible by design — correct for scores, but the owner should be told plainly that
   "reversible" stops at publish, and that the undo is "publish v2", not "edit the row".
6. **Attribution surfacing.** `schema.ts:206-207` says CC BY 4.0 obliges naming USDOL/ETA *wherever
   terms surface*. No AC in the brief puts attribution on a screen. This is a licence obligation on
   a document sent to employers, not a nicety.

---

## 6. WHAT MUST BE MUTATION-PROVEN

Procedure per CLAUDE.md: write the guard, **reinstate the defect**, confirm the suite FAILS, restore.
A guard that passes with its defect reinstated is worse than no guard. Where a mutation is
behaviourally equivalent and correctly fails to fail, say so — do not claim the assertion is proven.

| ID | Guard | The mutation that must make it FAIL |
|---|---|---|
| MUT-1 | Frequency cannot admit (AC-2) | Insert an entry with `sources = '{jd_corpus}'` and a `df` equal to the corpus size. Suite must fail. |
| MUT-2 | Weights cannot change membership (AC-6) | Set the tier-3 weight to 0 and re-seed; assert the `term_key` set is identical. Mutate by letting a zero weight drop a row. |
| MUT-3 | Model terms are outside coverage (AC-11) | Flip one model entry to `scoreable = true`. The denominator must not move (MUT-11 covers the query condition; MUT-3 covers the insert-time constraint). |
| MUT-4 | One normalized form, one entry (AC-15) | Insert `soc_2` and `soc_2_type_ii`, both normalizing to `soc 2`. Second insert must raise. Reinstate by dropping the constraint. |
| MUT-5 | `SOC` does not fold into `SOC 2` (AC-16) | Delete the digit-split guard in `termNormalize` (`termMatch.ts:31`) or add a bare-integer strip; `matchesEntry(soc_2, 'SOC')` becoming true must fail the suite. |
| MUT-6 | Casing restored (AC-17) | Set one `case_sensitive_acronym` entry's `display_term` to lowercase. The suite must fail — today it would silently match nothing. Assert `termNormalize(display_term) === normalized` for every row. |
| MUT-7 | The comment matches the gate (AC-B1) | Revert `schema.ts:227-230` to "helpers, never gates" while the gate is live. A source-grep guard must fail. |
| MUT-8 | Published entries are immutable, archived included (AC-B4) | Run the three-step archive→edit→republish chain. Step 2 must raise. Reinstate by changing the guard back to `l.status = 'published'`. |
| MUT-9 | `entry_count` is true (AC-24) | Insert one entry without bumping `entry_count`. Must fail. |
| MUT-10 | Taxonomy attestation is exact, not fuzzy (AC-28) | Swap the attestation comparison to `token_subset`. `operating model transformation` being admitted on ESCO's `operating model` must fail the suite. |
| MUT-11 | Denominator excludes `model` by source AND by `scoreable` (AC-30) | Remove the `sources` condition from the denominator query while a `scoreable=true` model row exists. Must fail. |
| MUT-12 | Curated seed count is derived, not asserted at 96 (AC-36) | Hardcode `96`; the suite must fail against the file's real 105. Also: duplicate `data privacy` into both families and assert one row results. |
| MUT-13 | Denominator is posting-scoped (AC-B6) | Make the denominator global again; two opportunities with different requirement sets returning the SAME denominator must fail. |
| MUT-14 | `loose` never counts as covered (AC-B7b) | Let `loose` into the numerator; an asset with only loose matches scoring above zero must fail. |
| MUT-15 | Denominator counts one version (AC-B5) | Publish v2 and assert the denominator did not become v1+v2. Reinstate by removing the version filter. |

Naming: use SLUGS in `api/test/hardening.test.mjs`, never numbers — `H26` fails the suite on a new
numeric ID (CLAUDE.md). Suggested: `H:term-freq-cannot-admit`, `H:term-model-never-scores`,
`H:term-one-normalized-one-entry`, `H:term-archive-cannot-edit`, `H:term-denominator-one-version`,
`H:term-denominator-posting-scoped`, `H:term-display-casing-roundtrip`, `H:term-attestation-exact`.

---

## 7. UNRESOLVED FACTS — settle these from the DB before coding, not from a document

This pass could **not** query the live database: `Boost_DB_Connector`, `Azure_pg_mcp` and
`boost-pg-mcp-write` all report *requires authentication* in this session, and a CCR session cannot
run the OAuth flow. Per CLAUDE.md that must be told to the owner rather than routed silently through
GitHub Actions. Every number below is therefore taken from a document, and documents disagree.

| # | Question | Why it matters | The single query that settles it |
|---|---|---|---|
| U1 | Corpus size behind `term_candidate.df` — the brief says **83 of 1,398**, `TERM-CURATION-v1.md` says **928** | AC-8: tier weights are arithmetic on this denominator | `select corpus_size, count(*), min(mined_at), max(mined_at) from term_candidate group by 1 order by 2 desc;` |
| U2 | Are all 2,734 candidates really `status='pending'`? | a2/a3: any `approved` rows are an existing admission path | `select status, count(*) from term_candidate group by 1;` |
| U3 | Tier counts: 8,508 `requirement.verbatim` / 680 opps; 1,098 `ats_gaps`; 1,398 `jd_real` | The weighting design rests on these | `select count(*) from requirement where verbatim is not null;` + `select count(*) from opportunity where ats_gaps is not null;` + `select count(*) from opportunity where length(coalesce(jd_real,''))>200;` |
| U4 | Is `term_library_entry` truly empty today? | `assetBlocks.js:368-369` cites db-query run 32327554276 for ZERO published scoreable rows — that is a 2026-08 measurement, not today's | `select l.library_key, l.version, l.status, l.published_at, count(e.*) from term_library l left join term_library_entry e on e.library_id=l.id group by 1,2,3,4;` |
| U5 | How many of the 105 curated terms are attested by ESCO or O\*NET? | Decides whether the gate is real or whether `curated` carries everything (BLOCKER-1). If the answer is near-zero, the "binary gate" is a label on a curation list. | Requires the taxonomy files, not the DB — but it must be measured and reported BEFORE the gate is called a gate. |

**U5 is the one that decides whether this design is what the owner thinks it is.** The brief presents
ESCO/O\*NET as the authority and `curated` as an override. `schema.ts:299` measures that O\*NET lists
none of the corpus's top exec terms. If U5 comes back at, say, 12 of 105, then the "anchored
authority" the owner asked for is in practice the owner's own 105-row list — which may be entirely
acceptable, but it must be said out loud rather than discovered later.

---

## 8. SIGN-OFF CHECKLIST (nothing below is optional for tier 1)

- [ ] BLOCKER-1 … BLOCKER-7 answered by the owner **before** implementation starts.
- [ ] U1 … U5 measured from the live DB / taxonomy files; numbers written into this file.
- [ ] Every DB-level constraint (AC-B2, AC-B3, AC-15, AC-B4) executed against a **populated** database
      with `main`'s schema already applied — per CLAUDE.md's schema rule, a fresh-DB pass proves nothing
      because `create table if not exists` skips the table that matters. `ON_ERROR_STOP=1`.
- [ ] MUT-1 … MUT-15 each run, each observed to FAIL with the defect reinstated, each restored.
- [ ] `keyword_coverage` verified on a real artifact against the live API before and after publish —
      it must not change from `null` to a number without the numerator existing (e1).
- [ ] `schema.ts:227-230` and `schema.ts:303` corrected in the same commit as the code.
- [ ] Independent `verifier` subagent run — this AC file is not evidence that the ACs pass.

---

## 9. FALSIFICATION LOG (what I tried to disprove, and the result)

Per CLAUDE.md: *"If you haven't tried to falsify it, you haven't verified it."*

| Claim | Attempt to disprove | Result |
|---|---|---|
| "no uniqueness on `normalized`" | grepped every `unique` / index on `term_library_entry` | Only `unique (library_id, term_key)` (`:238`); `term_entry_norm_idx` (`:242`) and the alias GIN (`:241`) are **non-unique**. Claim **stands**. |
| "`sources` has no CHECK" | grepped every occurrence of `sources` in `schema.ts` | Two hits, both the comment (`:227`) and the bare column (`:230`). No CHECK exists. Claim **stands**. |
| "archive→edit→republish bypasses immutability" | re-read both trigger bodies and their event clauses | `term_entry_guard` fires `before insert or update or delete` (`:266`) but its body raises only when `l.status='published'` (`:256`); `term_library_guard` fires `before update` (`:292`) and its body runs only when `old.status='published'` (`:275`). An `archived` parent satisfies neither. Claim **stands** (read from source; not executed against a live DB — that is MUT-8's job). |
| "the spec denominator is posting-scoped and small" | counted the rows programmatically | `source: 'library'` = **13**, `source: 'model'` = **2** in `ATS_TERMS`, against `TERM_LIB.size: 1840` (`data.js:25`). The spec's own denominator is 13, not 1,840. Claim **stands**. |
| "the curated file says 96 but lists more" | parsed the file's backticked primaries per family, excluding alias parentheticals and the prose blockquote | 106 listed, **105 unique** (`data privacy` duplicated across two families). Claim **stands**. |
| "`covered` is hardcoded null so no number can appear" | read `appChecks.ts:141` and `artifactScore.ts:137-141` end to end | `covered: null` is unconditional; `artifactScore.ts:139-140` takes the null branch whenever `covered == null`. So publishing changes only the *message*, not the number. Claim **stands**. Note this also means `TERM-CURATION-v1.md`'s "Blocked on" (which cites `covered: 0`) is **stale** — PR #51 landed. |

**Not verified, and honestly labelled as such:** every count in §7 (U1-U5), and every runtime claim
about what the triggers actually do when executed. Those are readings of source and of documents,
not measurements. Nothing in this file should be described as "proven" until MUT-1 … MUT-15 have
been run against a populated database and U1 … U5 answered from the live DB.

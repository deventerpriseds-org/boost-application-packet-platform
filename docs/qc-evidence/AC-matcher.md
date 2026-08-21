# AC-matcher — requirement→profile evidence resolution (option (c): purpose-made matcher)

> **Provenance.** Written by an independent acceptance-criteria subagent on 2026-08-21, working
> against `origin/main` = `3f236ed`. Findings were appended to this file as they were established,
> before any criterion was written, so that a container reclaim or an interrupt could not take the
> research with it — the previous agent doing this same job wrote nothing until the end and lost all
> of it. A banner declaring this file "INCOMPLETE — findings only" was written into it mid-run and
> has been removed: the agent was alive throughout and the criteria below are complete.
>
> **Correcting the attribution, because it matters for auditing the guard:** that banner was written
> BY HAND by the session agent, not by `eds-agent-guard.sh`. The guard is report-only and never
> writes a file. What the guard did get wrong is real and separate — it reported this agent as an
> orphan after 246s of transcript silence while it was still working. Its idle threshold was too
> aggressive and its wording far too certain; both are corrected in eds-claude-skills
> (`_eds_version` 8).
>
> Nothing here has been implemented. No source file was changed.

status: complete

Scope: `POST /api/app/opportunity/{id}/evidence` returns `evidenced: 0` on real data
(runs 32451913037, 32480993987 — 45 requirements, 15 readable profile records, 0 evidenced,
0 refused; `requirement_evidence` holds 0 rows in production).

Decision under AC: **option (c)** — stop reusing `locate()` (a posting-anchoring function) for
requirement→profile comparison; build a purpose-made comparison. Options (a) fold verb tense and
(b) lower the threshold were rejected by the owner.

## Findings established by reading, before any criterion

These are observations, not assumptions. Each one changes what "done" means. Thirteen of them.

> Read at `origin/main` = `3f236ed` ("Merge PR #28"). The worktree branch `claude/deploy-runs-migration`
> is not an ancestor of `origin/main`, but `git diff HEAD origin/main` is EMPTY — the trees are
> identical, so every line quoted below is `origin/main`'s.

**F1 — `locate()` is a POSTING function, and its own header says so.** `requirements.ts:264`
signature is `locate(paraphrase: string, postingText: string, taken: Span[] = [])`. Its docstring
(`:249-262`) is written entirely about the employer's posting: *"Find where in `postingText` the
paraphrase came from"*, *"a posting that repeats a bullet under both 'Responsibilities' and 'What
you'll do'"*, and its closing guarantee is *"the returned verbatim is exactly
`postingText.slice(char_start, char_end)`"*. The module header (`:5-17`) grounds the whole design in
one fact: the jd_table Item is *a paraphrase of the very document being searched*, so a span always
exists to be found. **That premise does not transfer.** `evidence.ts:237` calls
`locate(text, rec.text)` where `text` is a requirement from the employer and `rec.text` is the
candidate's profile — two documents with no derivation relationship. Shared vocabulary between them
is coincidental, and `locate` has no way to know it is now being asked a different question.

**F2 — `evidence.ts` names this reuse as a virtue, in writing, which is why nobody re-examined it.**
`evidence.ts:14-17`: *"`requirements.locate()` — the same anchoring that resolves a model paraphrase
back to the employer's own words in the posting now resolves it back to the candidate's own words in
the profile. Same guarantee, both directions."* The guarantee that transfers is only the
substring/offset guarantee. The guarantee that does NOT transfer — and that the comment silently
claims — is that the target document is a source the input was derived from. This is the
"extend, don't duplicate" rule applied to the wrong axis: reuse was correct as a value and wrong as
a fact.

**F3 — two thresholds stack multiplicatively, and neither is the one that was tuned.**
`ANCHOR_THRESHOLD = 0.6` (`requirements.ts:193`) gates the sweep AND is re-applied after sentence
clipping (`:336`). Then `EVIDENCE_THRESHOLD = 0.7` (`evidence.ts:187`) is applied to
`itemTokens(loc.verbatim)` ∩ `wantTokens(requirement)` (`:249-252`). Then `MIN_QUOTE_CHARS` /
`MIN_QUOTE_WORDS` from `reviewer` (`:246-247`), then a DISTINCTIVE-token requirement (`:253`,
tokens ≥ 6 chars). A requirement must clear four independent gates measured with two different
tokenizers (`contentTokens`/`LOC_STOP` inside `locate`; `itemTokens`/`STOP` inside `evidence`). The
0.7 was chosen to preserve `checks.COVERAGE_THRESHOLD`'s meaning (`evidence.ts:177-181`) — i.e. it
was calibrated against a DOCUMENT the generator wrote, not against a profile written years earlier
in a different grammatical mood.

**F4 — no stemming anywhere on this path, and that is a deliberate, documented decision made for a
different function.** `itemTokens` (`swaps.ts`) does not stem; `termMatch.ts` records stemming as
*rejected* (`ops`→`op`, `sre`→`sr`); `figureEcho.stem()` handles plurals only. So `built ≠ build`,
`promoted ≠ promote`, `leading ≠ lead`, `manages ≠ manage`. Requirements are imperative/nominal
("Lead the strategy…", "Build and promote…", "Ability to manage…"); résumés are past tense. The
token spaces systematically miss.

**F5 — measured behaviour against one real record** ("Built and promoted a high-performing
engineering culture"):

| requirement | locate result | span ratio | outcome |
|---|---|---|---|
| "Build and promote a high-performing engineering culture" | anchored on `"high-performing engineering culture"` | 0.60 | NOT evidenced (0.60 < 0.70) |
| "Built and promoted a high-performing engineering culture" | exact | 1.00 | evidenced |
| "Ability to manage remote teams" | **unlocatable** | — | NOT evidenced |

Note the shape: tense alone moves a requirement from 1.00 to 0.60 — it does not degrade gracefully,
it falls off a cliff, because `locate` first *throws away* the unmatched verb by clipping to the span
that matched, and then the 0.7 gate is measured on that shortened span.

**F6 — production is at `evidenced: 0` AND `refused: 0`.** Both zero is the important pair. `refused`
is `writeEvidence`'s count of rows that failed the pre-store substring assertion. Zero refusals with
zero evidence means nothing ever *reached* the storage contract — the failure is entirely upstream in
`resolveEvidence`, and every guard `writeEvidence` publishes is currently vacuous (it has never been
exercised on real data). A guard that has only ever seen an empty input set is `not_applicable`, not
`pass`.

**F7 — the U+0130 offset defect is recorded in three places and any replacement can reintroduce it.**
`requirements.ts:272-280` records it in full: `toLowerCase()` is not length-preserving (U+0130 →
two code units), so indexing a lower-cased COPY yields offsets that are shifted, and the resulting
quote *is still a true substring of the record at the offsets recorded* — merely the wrong
characters. That is why "assert the quote is a substring" does not catch it. It was fixed by
searching case-insensitively over the ORIGINAL string (`new RegExp(..., 'gi')`, `m.index`,
`m[0].length`), bumped `EXTRACTOR_VERSION` 1→2, and `evidence.ts:394-408` carries a whole
`misresolved` state and note for the rows written before it. **A new matcher that normalizes case,
strips punctuation, or stems into a rewritten string and then indexes THAT string reintroduces this
class exactly.** Any normalization must carry an offset map back to the original, or must be used
only for scoring and never for offsets.

**F8 — the fixtures were written to pass, and I can show it rather than assert it.** Every POSITIVE
fixture requirement in `api/test/evidence.test.mjs` is a **verbatim substring of the fixture profile**:

| test fixture requirement | where it appears verbatim |
|---|---|
| `Led the platform modernization programme across four product lines` | `MC.workHistory1`, exactly |
| `Owned the digital water technology roadmap with Product` | `MC.workHistory2`, exactly |
| `Established the SOC 2 Type II compliance programme from nothing` | `MC.coreAccomplishments`, exactly |
| `Owned the digital water technology roadmap with Product and Design` | that verbatim span + two words |

Each of these takes `locate`'s **exact** branch (or an anchored span *of* the verbatim sentence),
which artificially restores the P1 premise — the "requirement" really was derived from the haystack.
The NEGATIVE fixtures are all semantically remote (`offshore wind turbine fleets`, `Fluency in
Japanese`, `Top Secret SCI clearance`) — cases that fail on vocabulary alone, at any threshold, with
any matcher. **The file contains no fixture where a requirement is TRUE of the profile but worded
differently, and none where a requirement is FALSE of the profile but shares its vocabulary.** Those
two cells are the entire subject matter of this ticket, and the suite is silent on both. The file's
own header claims fixtures are "from real Trinnex requirement text (opp 9f9c370a)" — that is true
only of `evidence.test.mjs:250-271`, which uses the real imperative rows
(`Reside in the East Coast of the United States`, `Ability to manage remote engineering teams`) and
uses them **only to count a denominator**, never to resolve evidence. The one place real requirement
text meets the resolver, the resolver is not called.
This is the ledger's own observation restated with a citation: *"it evidences correctly when the
requirement happens to be phrased in the candidate's words, so any test whose fixture is written
alongside the code passes."*

**F9 — the ledger row already exists and its recommendation is now WRONG.**
`.claude/DEFERRED.md` row `D:evidence-resolves-nothing`, state `OPEN`, closes with
*"Recommend (a)"* and `check: manual db-query.yml — select count(*) from requirement_evidence; a
non-zero count closes this`. The owner chose (c). **Both halves of that row are now defects in
their own right**: the recommendation contradicts the decision, and the closing check is nearly
vacuous — a matcher that evidences everything scores non-zero and closes the row. See AC-M31/M32.

**F10 — the owner threshold does NOT reach the route in the defect.** `appChecks.ts:109-112` passes
`{threshold: thresholds.evidenceThreshold, minTokens: thresholds.evidenceMinTokens}` into
`writeEvidence`, and `evidence.test.mjs:276-296` guards exactly that line. But
`appRequirements.evidenceResolve:498` calls `writeEvidence(client, opp.id, profile.records)` **with
no opts**, and `requirementsBackfill:441` does the same. So `POST /api/app/opportunity/{id}/evidence`
— the route in runs 32451913037 / 32480993987 — and the backfill both ignore
`owner_search_prefs.chk_evidence_threshold` and use the literals. The existing guard passes because
it greps `appChecks.ts` only; it is the single-file-grep failure `CLAUDE.md` names. Any new matcher
config inherits this hole unless the ACs close it.

**F11 — the storage contract is enforced by the DATABASE, not only by code**, and it constrains the
shape of any replacement (`appRequirements.ts:31-53`, mirrored in `schema.ts:404`):
`check (char_start >= 0 and char_end > char_start)`; `check (length(quote) = char_end - char_start)`;
`method text not null check (method in ('exact','anchored'))`;
`unique (requirement_id, source_key, char_start, char_end)`; `record_sha256 text NOT NULL`;
`resolver_version int NOT NULL`; FK to `requirement(id) on delete cascade`.
Three consequences the implementer must not discover at insert time: (i) a quote **stitched from two
spans** violates the length check; (ii) a new `method` value (`'semantic'`, `'stemmed'`, `'lemma'`)
violates the CHECK and requires an explicit `alter table … drop constraint / add constraint`, the
same dance `ensureRequirementCols:64-66` already had to do for `requirement_kind_source_check`;
(iii) the UNIQUE is per `(requirement_id, source_key, char_start, char_end)`, so the table **already
permits several evidence rows per requirement** even though `resolveEvidence` returns at most one,
and `loadRequirementsWithEvidence:214-217` already picks one with
`order by x.ratio desc nulls last, x.source_key, x.char_start limit 1`.

**F12 — `refused` is documented as structurally unable to fire, and the doc is right.**
`appRequirements.ts:111-117`: *"It has never rejected anything and structurally cannot today:
`locate` CONSTRUCTS its verbatim by slicing the haystack, so the comparison is a tautology (measured
by the independent verifier: 4,000 randomized rounds, 0 mismatches)."* A purpose-made matcher that
builds a quote any other way — normalizing, stemming, joining, trimming — makes that assertion
live for the first time. It must stay, and it must be proven to fire.

**F13 — the downstream chain is long and its first link is a GATE.** `EvidenceInput.bySeq` →
`checks.ts:567-640` `must_have_coverage` / `responsibilities_addressed` / `evidence_placed` →
`gateFor` → `artifact_score.must_have_coverage` + `must_have_source` (`"<covered>/<judged> must-have
requirements evidenced"`) → `parseMustHaveSource` (H44b) → the asset gate tile
`assetGate.js:240 'Must-haves evidenced'`. Separately: `appDimensions.shapeRequirement:203-211` →
`dimensions.ts:436-447` "the evidence path" → `comparison_dimension.basis='evidence'` /
`profile_source='evidence'` → the JD step's "Your profile evidences" column
(`postingAnalysis.js:150`). And `remediation.ts:30-49`: **a requirement with NO evidence row is not
a remediation target.** Production has zero rows, so the remediation loop has never had a target
from this source; the first successful resolve switches it on. **A false evidence row is not a
cosmetic error — it turns a gate green, raises a score, and hands a rewrite loop a claim to
"place" in a document.**

---

# Acceptance criteria — `M`: a purpose-made requirement→profile matcher

Naming: `M1…Mn` here; H-cases take slugs (`H:…`), never numbers (`H26`).

## A. Happy path

**M1.** Given a requirement the profile genuinely supports in different words, when
`resolveEvidence` runs, then it returns a row whose `quote` satisfies
`records.find(r => r.key === row.source_key).text.slice(row.char_start, row.char_end) === row.quote`
— **byte-for-byte, on the record's ORIGINAL text**, not on any normalized/stemmed/case-folded
intermediate. This is `evidence.ts:241`'s assertion and it must survive verbatim.

**M2.** Given that row, when it is inserted, then it satisfies every DB CHECK unchanged:
`char_end > char_start >= 0`, `length(quote) = char_end - char_start`, a `method` value inside the
stored CHECK, `record_sha256` a 64-hex digest of the record's text, `resolver_version` non-null.
A quote assembled from **two non-contiguous spans** is a fail — the length check forbids it and the
excerpt would be a synthesis presented as a verbatim quote.

**M3.** Given a requirement whose supporting excerpt is shorter than `MIN_QUOTE_CHARS` (20) or
`MIN_QUOTE_WORDS` (4), when it is resolved, then it is NOT evidenced, and those two floors are still
**imported from `reviewer.ts`**, not redeclared. A second pair of numbers for "is this quote
substantial" is a second answer to one question, and the citation validator already owns it.

**M4.** Given the happy-path row, when the JD step reads it back, then
`GET /api/app/opportunity/{id}/requirements` reports it in `evidenced`, its `evidenceState` is
`verified` and its `evidenceNote` is `null` — i.e. it survives `verifyEvidence`'s re-validation
against the same records, not merely the write path.

## B. The three measured cases — required outcomes, stated individually

Against a record containing `Built and promoted a high-performing engineering culture`:

**M5.** `"Built and promoted a high-performing engineering culture"` (the profile's own tense) —
**MUST be evidenced**, `quote` = that sentence's bytes, `ratio` at the top of the scale. It is
evidenced today; a replacement that loses it has traded one defect for another.

**M6.** `"Build and promote a high-performing engineering culture"` (imperative, as the employer
writes it) — **MUST be evidenced**, and the excerpt MUST be the **same span** M5 returns, not the
truncated `"high-performing engineering culture"` that `locate` currently anchors on. Two tests, not
one: (i) an evidence row exists; (ii) `row.quote === <the M5 quote>`. Criterion (ii) is the one that
matters — an implementation that returns the short anchor has "fixed" the count while still
presenting a fragment as the proof, and the fragment omits the verb that is the whole claim.

**M7.** `"Ability to manage remote teams"` against a profile record that says the candidate managed
remote teams — **MUST be evidenced**, against an excerpt that contains the managing and the remote
teams. It is `unlocatable` today, meaning `locate` never produced a span at all, so this case
exercises the new candidate-generation path and not just the new scoring.

**M8.** Given M5/M6/M7 are asserted, when they are written as tests, then the **requirement strings
are NOT verbatim substrings of the fixture profile** except for M5, which exists precisely to pin
the exact case. A test file in which every positive fixture is a copy of the profile is the state
described in F8 and must not be recreated.

## C. False evidence — the criteria that matter most

Every criterion in this section is of the form "no row is written, AND the requirement is visibly
surfaced rather than silently absent." **"Escalate" here has a precise existing meaning and must
reuse it, not invent one:** `requirement.coverage='escalated'`, exclusion from `coverable` in
`checks.ts` where the row is an eligibility clause (so it leaves the coverage denominator and is
named in `elig.offenders`), an `escalation` row a human answers, and — where the requirement is
simply unsupported — `evidenceState: 'none'` with `NO_EVIDENCE_NOTE`. None of these is "pass".

**M9 — location / eligibility.** Given `"Reside in the East Coast of the United States"` (a real row
on opp 9f9c370a) and a profile that never states where the candidate lives, when evidence is
resolved, then **no `requirement_evidence` row is written for that requirement, under any owner
threshold setting including the loosest the UI permits.** The profile mentioning `United Water`, a
state name, a city, `East Region`, `Coast Guard`, or an employer whose name contains `States` must
not change this. What must happen instead: the row remains in the eligibility population that
`checks.ts` already excludes from `coverable` and names in `elig.offenders`, and the owner is asked.
A residence is a fact about a person, not a phrase in a résumé, and there is no excerpt that can
honestly prove it.

**M10 — generic-vocabulary overlap.** Given `"Strong understanding of software engineering
practices"` and a profile that says `"Technology executive with two decades of experience running
engineering organisations"`, when evidence is resolved, then **no row is written.** The overlap is
`engineering` alone — a category word. Stated as an invariant rather than an instance: a requirement
whose overlap with the best excerpt consists only of tokens that occur in **more than one unrelated
profile record** carries no discriminating signal and is not evidence. This case must be asserted at
the DEFAULT configuration and at the loosest configuration the settings screen allows.

**M11 — a named technology the candidate has never used.** Given `"Hands-on experience with
Snowflake and dbt"` (or the fixture's `"Deep experience with Kubernetes cluster federation"`) and a
profile that says `"built the enterprise data warehouse and the analytics pipeline"`, when evidence
is resolved, then **no row is written**, even though `data`, `warehouse`, `pipeline`, `experience`
and `platform` all appear. The invariant to encode: **a requirement that names a proper noun,
product, vendor, certification, framework or acronym may only be evidenced by an excerpt that
CONTAINS that name, matched exactly** — never by ratio, never by stem, never by similarity. This is
`termMatch.ts`'s `case_sensitive_acronym` reasoning (`safe` in 302 postings vs `scaled agile` in 8 —
~37x false positives) applied one layer up, and it is "fuzzy RANKS, never ACCUSES" in its most
concrete form.

**M12 — a list requirement is not evidenced by one member of the list.** Given
`"IoT data, models, geospatial data, and AI/ML"` (a real row) and a profile that evidences only
`data`, when evidence is resolved, then no row is written. A ratio of 1/5 must not become "evidenced"
under any relaxation, and — critically — a matcher that splits a conjunctive requirement into parts
must either evidence **every** part or evidence none; a partially-supported conjunction stored as one
evidenced row is a fabricated composite, which `CLAUDE.md` bans outright.

**M13 — numeric and durational requirements are not settled by prose.** Given
`"Minimum of 8 years of experience"` or `"Manage a budget of $50M+"`, when evidence is resolved, then
no evidence row is written from an excerpt. These belong to the **fact** path
(`dimensions.ts:419-425`, `basis: 'fact'`, and H41b — "the leadership fact settles a leadership
requirement, and **total years cannot stand in**"). Today `itemTokens` drops `years`/`experience` as
stopwords and drops the bare digit `8` (length 1), so the requirement falls below
`MIN_JUDGEABLE_TOKENS` and returns null — the right answer for the wrong reason. A matcher that
raises the token yield must not turn that accident into an accusation.

**M14 — the banned list stays banned, at both locks.** Given `itemsToOmit` contains `Kubernetes
cluster federation`, when a requirement asks for exactly that, then no row is written — proved with
`NEVER_EVIDENCE` intact AND proved again with the `profileRecords` filter bypassed, because
`evidence.ts:235` is the second lock and a matcher that only relies on the first has removed a door.

**M15 — H29 survives: one named record, never the joined profile.** Given a phrase present in the
concatenation of two records and in neither record alone, when evidence is resolved, then it returns
null. `sourceText()` joins records with `\n\n` and the citation validator's matching is
whitespace-tolerant, so any matcher that normalizes whitespace across a record boundary re-opens
this exact hole.

**M16 — negation and attribution are decided deliberately, not by silence.** Given a profile record
saying `"reported to the leader who owned the P&L"` or `"declined to take on remote teams"`, when a
requirement asks for owning the P&L / managing remote teams, then the implementation's behaviour is
**stated in a comment and pinned by a test** — either these are refused, or they are accepted with a
written justification. What is not acceptable is a matcher that has never been asked. An excerpt
printed beside a requirement IS the claim "your profile says this"; attributing someone else's
accomplishment to the candidate is the highest-severity output this system can produce.

**M17 — the false-positive suite runs at the loosest reachable configuration.** Given every
owner-settable knob is set to its most permissive allowed value, when M9-M16 are re-run, then they
all still hold. Otherwise the guarantee is "safe at the default", and the default is the one setting
an owner is invited to change.

## D. Determinism and offset integrity

**M18.** Given identical inputs, when `resolveEvidence` runs twice, then the rows are `deepEqual` —
no `Date.now()`, no `Math.random()`, no iteration over an unordered `Object.entries` that has not
been sorted (`profileRecords:157` sorts by key for exactly this reason), no model call. `evidence.ts`
must still contain no import that can reach a network.

**M19 — the U+0130 class must not return.** Given a record prefixed with case-expanding characters
(`İ`, `İİ`, `İİİİİ`, `ẞ`, `ﬁﬁﬁ` — H32's own set), when a requirement resolves against it, then
`char_start` equals the index measured on the **original** string. The general invariant, which is
what the AC requires rather than the five characters: **if the matcher builds ANY transformed copy
of the record (lower-cased, entity-decoded, punctuation-stripped, stemmed, whitespace-collapsed),
then either (a) no offset is ever taken from that copy, or (b) the copy carries an explicit
index map back to the original and a test proves the map correct on a length-changing character.**
`toLowerCase`, `NFKC` and `normalize()` are all length-changing. Note the trap H32 records: the
substring property **held while the offsets were wrong**, so `slice(start,end) === quote` cannot
detect this — the test must compare against an independently computed `text.indexOf(...)`.

**M20.** Given `termNormalize` (`termMatch.ts`) exists and does `NFKC` + `[^a-z0-9 ]→' '`, when the
new matcher is written, then it does not reuse `termNormalize`'s output as an offset basis. Reusing
it for **scoring** is fine and is the "extend, don't duplicate" answer; reusing it for **offsets**
is M19's defect with a shared helper in front of it.

**M21.** Given any profile record, when it becomes a `ProfileRecord`, then it is still `toBmp`-folded
(`evidence.ts:151,167`) so a JS UTF-16 offset equals a Postgres character offset — H2's invariant,
and the reason `length(quote) = char_end - char_start` holds in the database at all.

**M22.** Given more than one record could evidence a requirement, when the winner is chosen, then
ties are broken deterministically (today: `ratio` strictly greater, else earlier record wins —
`evidence.ts:255`), and the same tie-break is what
`loadRequirementsWithEvidence`'s `order by x.ratio desc nulls last, x.source_key, x.char_start`
would pick, so the resolver and the join never disagree about which excerpt is "the" one.

## E. Extends, does not fork

**M23 — the storage contract is unchanged.** `EvidenceRow` keeps every field
(`quote, source_kind, source_label, source_key, char_start, char_end, extra, ratio, method,
record_sha256, resolver_version`). New fields may be ADDED; none may be removed or repurposed. Any
added column that appears on the join must be named `evidence_*`, because
`verifyRequirementRows:261-263` redacts **by prefix**, and a column that misses the prefix leaks a
fragment of a withdrawn excerpt to the UI.

**M24 — the pre-store assertion stays, and for the first time it must be able to fire.**
`appRequirements.ts:118-119` must remain exactly as it is. Its comment must be **corrected in the
same commit**: it currently says the check "structurally cannot" reject anything because `locate`
constructs its verbatim by slicing. If the new matcher builds a quote any other way, that sentence
becomes false, and a false comment about a guard is worse than no comment.

**M25 — `refused` becomes a real measurement or is proven still tautological.** A test must
construct a resolver output whose quote is NOT the record's bytes at its offsets and assert
`refused` increments and **nothing is inserted**. Absent that, `refused` is `not_applicable`, not a
pass, and the response must not present it as a measured zero.

**M26 — `record_sha256` still names the record body the offsets were measured on**, computed with
the same `sha256` helper, so `verifyEvidence`'s three-way split (`verified` / `stale` /
`misresolved`) keeps working. In particular `misresolved` must remain reachable: a byte-identical
record whose offsets do not yield the quote must still be attributed to a bad write and not to an
edit the owner never made.

**M27 — `NEVER_EVIDENCE` unchanged**, both as a `profileRecords` filter and as the per-record guard
in the resolve loop.

**M28 — replace, never append.** The `delete … using requirement r where r.opp_id = $1` +
insert, inside one transaction, scoped to this opportunity, must survive. Re-running the resolve
must leave the same number of rows, not double them.

**M29 — `RESOLVER_VERSION` is bumped, in the same commit, and the bump is asserted.**
`RESOLVER_VERSION` must go `1 → 2` (at least) so a row can be attributed to a ruleset. A test asserts
`RESOLVER_VERSION > 1` and that stored rows carry it. The commit must also **state what happens to
rows written at version 1**: production holds zero, so nothing needs migrating there, but that is a
fact to be re-checked with `db-query.yml` and stated — not assumed. `VERIFY_VERSION` is a different
number for a different ruleset and is bumped only if `verifyEvidence`'s rules change.

**M30 — a new `method` value requires the CHECK to be widened explicitly.** If the matcher emits
anything other than `'exact'` / `'anchored'`, then `ensureEvidenceTable` **and** `schema.ts`'s
`SCHEMA_SQL` both change, with a `drop constraint if exists` / `add constraint` pair (the dance
`ensureRequirementCols:64-66` already needed for `requirement_kind_source_check`), and H40 ("every
persisted union is set-equal to the CHECK that stores it") passes. `create table if not exists`
cannot widen a CHECK on an existing table — an environment migrated earlier would reject every
insert, and per `CLAUDE.md`'s schema rule this must be **executed** against a database that already
has the old schema and rows, never against a fresh one.

**M31 — the ledger row is corrected in the same commit.**
`.claude/DEFERRED.md` row `D:evidence-resolves-nothing` currently ends *"Recommend (a)"*. The owner
chose (c). The row must record the decision and who made it, or the next reader implements (a) from
the ledger.

**M32 — the ledger's closing check is strengthened before it is used to close the row.** The stored
directive is `check: manual db-query.yml — select count(*) from requirement_evidence; a non-zero
count closes this`. **A non-zero count is exactly what a matcher that evidences everything
produces.** Replace it with a directive that a false-positive-riddled matcher fails — see M38 — and
keep it a single parsable `check:` directive so `deferredLedger.test.mjs` (`D:ledger-open-carries-check`)
still passes.

**M33 — `similarity()` must not appear in the resolve path.** H4b asserts
`!/\bsimilarity\(/.test(stripComments(src('evidence.ts')))`. If the matcher moves into a new module,
**H4b must be extended to cover that module in the same commit**, or the guard silently stops
watching the code it was written for. H4 shows `similarity('Skill number 0','Skill number 3') > 0.9`
— that is why.

## F. Configuration

**M34 — every knob is owner-settable, and it extends `owner_search_prefs`.** Any threshold, weight,
window, minimum or toggle the new matcher introduces gets a `chk_*` column on `owner_search_prefs`
(the established per-owner store, already extended by `jdSweep.ts` and `ensureCheckPrefs`) with the
code value as the column DEFAULT, plus a path on `CheckThresholds`/`ResolveOptions`. A literal in
the matcher with no column and no UI path is a fail — `CLAUDE.md`, "No hardcoded config".
**No new settings table.**

**M35 — the owner's values reach ALL THREE callers, not one.** `writeEvidence` is called from
`appChecks.evaluateArtifact:109` (passes thresholds), `appRequirements.evidenceResolve:498` (**does
not**) and `appRequirements.requirementsBackfill:441` (**does not**). The route in this defect is the
second one. A test asserts the options object reaches every call site — enumerated by grepping for
`writeEvidence(` across `api/src/` rather than by naming files, since a single-file grep is what let
F10 stand.

**M36 — an owner who has set nothing gets the seeded defaults and a real answer.** Given no
`owner_search_prefs` row exists (`loadThresholds` returns `{}`), when evidence resolves, then the
seeded values are used, nothing throws, and M5/M6/M7 still evidence. An unconfigured owner must not
be the "evidences nothing" case — that is the production state being fixed.

**M37 — the safety floor is not owner-configurable.** M9-M16 must hold at every reachable setting
(M17). Concretely: the exact-name rule (M11), the conjunction rule (M12) and `NEVER_EVIDENCE` (M14)
are **not** exposed as knobs. An owner may tune how much evidence is enough; an owner may not turn
on false provenance.

## G. Downstream — every consumer named, and what must still hold

**M38.** For each consumer below, a test or a live observation shows it still reconciles. Listed
because `CLAUDE.md` requires the blast radius named, not sampled.

| # | Consumer | What must still hold |
|---|---|---|
| 1 | `loadRequirementsWithEvidence` (`appRequirements.ts:198`) — the ONE join | `ratio` remains a populated, comparable number so `order by ratio desc nulls last, source_key, char_start` still picks the same row the resolver ranked first (M22) |
| 2 | `verifyEvidence` / `verifyRequirementRows` (D19) | all six `EvidenceState` values still reachable; redaction still by `evidence_` prefix; `HEALTH_BUCKET` still total-preserving (it throws on an unknown state) |
| 3 | `shapeRequirementsForApi` → `GET /requirements` | `evidenced + unevidenced === total`; `evidenceHealth` buckets sum to `total`; `evidenceNote` null only when provable |
| 4 | `appDimensions.shapeRequirement:203` → `dimensions.ts:436` evidence path | `comparison_dimension.basis='evidence'` / `profile_source='evidence'` rows appear for the first time; `covered`/`total`/`matched_seqs` reconcile with the requirement rows they came from |
| 5 | `comparisonPayload` / `comparisonStaleness` | rebuilt in the SAME call as the resolve (`evidenceResolve:502`), so grades are never served over evidence that has just been replaced |
| 6 | `appChecks.evaluateArtifact` → `EvidenceInput.bySeq` | `profileReadable` still `records.length > 0`, never `[]`-as-readable |
| 7 | `checks.ts` `must_have_coverage` | denominator is still `coverable` on **both** branches (H28); eligibility and fact-owned rows still excluded and still named in the tail |
| 8 | `checks.ts` `responsibilities_addressed` | responsibilities are resolved too — `resolveAll` is deliberately not kind-filtered |
| 9 | `checks.ts` `evidence_placed` | `placeable` still filtered by `MIN_JUDGEABLE_TOKENS`; more evidence rows must not turn this into a flood of false "absent from this asset" findings |
| 10 | `gateFor` / `attentionCount` | a gate that goes green must go green on rows that pass M9-M16 |
| 11 | `artifactScore` | `must_have_source` still `"<covered>/<judged> must-have requirements evidenced"` and still round-trips through `parseMustHaveSource` (H44b); `uncovered_requirement_seqs` still parseable from offender text |
| 12 | `assetGate.js:240` "Must-haves evidenced" tile | reads `score.must_have_coverage`; a null component must stay null, never 0 |
| 13 | `remediation.ts:30-49` | **a requirement with an evidence row becomes a remediation TARGET for the first time.** The loop must be exercised end-to-end on a real evidenced row before this is called done — it has never had one |
| 14 | `appRemediation` P3-38 (`:334`) | "a run that got greener by deleting the evidence it was judged against is refused" — still fires now that evidence exists to delete |
| 15 | `appPackets.PROFILE_SOURCES` (`:726`) | `requirement_evidence` stays a recognised provenance source |
| 16 | `PostingAnalysis.jsx` / `postingAnalysis.js:150` | the "Your profile evidences" column renders a real excerpt with its `source_label`, and `'No evidence'` is not printed over a measured shortfall (`dimensions.ts:22-25`) |

## H. Non-vacuity — every guard proven by reinstating the defect it bans

**M39.** Each guard below is proven by making it FAIL first, in the manner
`postingCompare.test.mjs:4-6` records. A guard never seen to fail is not known to be a guard.

| Guard | Reinstate the defect by | Must then fail |
|---|---|---|
| the tense case (M6) | restoring `locate(text, rec.text)` as the candidate generator | M6's `quote` equality assertion |
| the truncated-anchor case (M6ii) | returning `locate`'s anchored span instead of the full statement | M6(ii) only — M6(i) would still pass, which is the point |
| exact-name rule (M11) | deleting the proper-noun check | the Snowflake/Kubernetes case resolves |
| conjunction rule (M12) | scoring the list requirement by ratio | the 1-of-5 case resolves |
| eligibility (M9) | removing the residence guard | `"Reside in the East Coast…"` gets a row |
| offsets (M19) | indexing a `toLowerCase()` copy | the `İİİİİ` case, compared against `indexOf` |
| `refused` (M25) | emitting a quote that is not the record's bytes | `refused` must increment and nothing insert |
| redaction (M23) | adding a join column without the `evidence_` prefix | it survives redaction on a non-`verified` row |

**M40 — a structural guard against the fixture failure itself.** Add
`H:evidence-fixtures-are-not-copies`: over the positive fixtures used to prove the matcher, assert
that **at least N of them are not verbatim substrings of any record in the fixture profile.** This
encodes F8 as a check rather than a note, which is what `CLAUDE.md`'s hardening rule demands. It is
the one guard that would have caught this defect before production, because every other test in
`evidence.test.mjs` passed while the resolver evidenced nothing on real data.

**M41 — H:-slug naming.** Every new case takes a two-word-minimum slug; a numeric ID fails H26.

## I. The one production number

**M42 — fails today, passes after, measured on production.** Re-run
`POST /api/app/opportunity/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/evidence` with
`?owner=von.ellis@enterpriseds.io` via `api-test.yml`, and query production with `db-query.yml`.
Required, **all four together** — the first alone is the ledger's weak check and closes on a matcher
that evidences everything:

1. `select count(*) from requirement_evidence e join requirement r on r.id=e.requirement_id
   where r.opp_id='9f9c370a-…'` → **strictly greater than 0.** Before-value: **0** (run 32451913037,
   `evidenced: 0`, `refused: 0`, `profile_records: 15`). This is the half that fails today.
2. The same count is **strictly less than the requirement total (10)**. 10/10 evidenced against a
   posting with an eligibility clause and a five-item technology list is the false-positive failure,
   not a success.
3. **Zero rows** for the requirement whose text is `Reside in the East Coast of the United States`
   (M9), verified by joining on `requirement.seq` and reading the text back in the same query.
4. **Zero rows anywhere** where the stored quote is not the record's bytes:
   `select count(*) from requirement_evidence where length(quote) <> char_end - char_start` → 0,
   and every returned `evidenceState` on the subsequent `GET /requirements` is `verified`.

**M43.** The same four run against the 35-requirement posting from run 32480993987, so the result is
not one posting's accident — two postings is what ruled the data out as the cause in the first place.

**M44.** Given the sandbox cannot reach `azurewebsites.net` or the live Postgres, when M42/M43 are
performed, then they are performed via `api-test.yml` and `db-query.yml` and the **run ids are
recorded in the ledger row and in `.claude/actions.md`**. A local `node --test` pass is evidence the
mechanism works and is not evidence the defect is fixed. Per `CLAUDE.md`, the row stays OPEN and the
language stays "implemented, mechanism verified locally, NOT yet confirmed live" until those runs
exist and the owner has seen them.

---

## CONCERNS

**1. The highest-risk false-positive shape, named.** It is **a domain-worded requirement matched
against a same-domain candidate.** The product's entire population is people applying for jobs in
their own field, so the posting and the résumé are drawn from one vocabulary. A utilities posting
asking *"Experience delivering IoT and geospatial data platforms for water utilities"* shares
`experience, delivering, data, platforms, water, utilities` with **any** utilities executive's
résumé — those words are supplied by the industry, not by the achievement. The overlap is near-total
and its evidential content is zero. This shape is invisible in testing, because a fixture pair is
usually chosen from different domains (`offshore wind`, `Japanese`, `Top Secret SCI` — all three
current negatives), and it is worst in production, **rising as the candidate becomes a better fit**.
If one thing is measured before shipping, measure the false-positive rate on requirements from
postings in the candidate's *own* field. That is the only regime this matcher will ever run in.

**2. The tokenizer keeps the coincidental words and deletes the evidential ones — and this is the
part `locate` is not to blame for.** `swaps.STOP` (`swaps.ts:53-56`) drops
`leading lead led drive driven driving experience experienced ability able years proven demonstrated
strong using use used`. What survives are the domain nouns; what is deleted is the verb, which is
the entire difference between *"I built it"*, *"I will build it"* and *"I supported the person who
built it"*. **A replacement that swaps out `locate` and keeps `itemTokens` fixes nothing** — the
diagnosis names two causes and only one of them is in `locate`. Watch for exactly this: the ticket
says "stop reusing `locate`", and a new module that generates candidates differently and then scores
them with `itemTokens` at 0.7 is (b) in a new file.

**3. Can (c) be built without a model call? Yes — but it is linguistics, not string matching, and
the repo has twice decided against the prerequisite.** The determinism contract is explicit and
load-bearing (`evidence.ts:27`, `appRequirements.ts:83`, `requirements.ts:19`; the whole design lets
a resolve be re-run safely and a row be attributed to a version). A deterministic design does exist:
tense/number folding for candidate generation, decomposition of conjunctions, exact matching on
named entities, and an accusation-grade final gate that is exact. But `built → build` is an
**irregular** verb — no suffix rule reaches it — so this needs a real lemma table, and the codebase
has none: `figureEcho.stem()` is plurals-only and `termMatch.ts:15` records stemming as deliberately
rejected (`ops→op`, `sre→sr`). Adding a lemmatizer is a decision with its own blast radius, and it
should be made openly rather than discovered halfway through. The genuinely model-shaped cases —
*"reduced MTTR from nine hours to one"* evidencing *"improve operational reliability"* — cannot be
reached deterministically at all. **The house rule already resolves that tension: a model may RANK
or propose candidates; only an exact deterministic rule may ACCUSE.** Adopting that hybrid costs the
determinism of the candidate SET (same inputs, different day, different rows), which contradicts
`RESOLVER_VERSION`'s premise. Someone should choose between "deterministic with lower recall" and
"model-assisted with a versioning story" *before* the build, not after.

**4. Nobody has stated what the number should be, and that is how tuning-to-the-metric starts.** The
only published target is the ledger's *"a non-zero count closes this"*. An implementer with no
expected range will tune until the number looks healthy, and the healthiest-looking number is the
one produced by the loosest matcher. M42(2) caps it, but a cap is not a target. **Ask the owner:
of the 10 Trinnex requirements, roughly how many SHOULD their profile evidence?** A stated
expectation, even a rough one, converts the deploy from "did it produce rows" into "did it produce
the right rows".

**5. Going from 0 rows to N rows switches on a subsystem that has never run.** `remediation.ts:30-49`
takes its targets from requirements that HAVE an evidence row. Production has had none, so the
remediation loop has never had a target from this source, and neither has `appRemediation`'s P3-38
"got greener by deleting its evidence" refusal. The first successful resolve hands a document-rewrite
loop a list of claims to place. **Everything downstream of #13 and #14 in the M38 table is untested
against real data by construction**, and none of it is in this ticket's scope — which is precisely
why it should be said out loud now rather than found later.

**6. `evidence_placed` will flood on first success.** It reports evidenced requirements that do not
appear in the generated document, at `warn`. Today it is `not_applicable` for every packet because
nothing is evidenced. The moment evidence resolves, every previously-silent packet gains a warn list
— which will read as a regression caused by this change, and will not be one. Expect it, and say so
in the PR before someone reverts the matcher to make the warnings go away.

**7. Is (c) wrong? No — but it is being under-scoped, and "new module" needs its sign-off recorded.**
(c) is right about the diagnosis: `locate`'s premise (the needle was derived from the haystack) is
false here, and no threshold change repairs a false premise. `locate` itself must stay exactly as it
is — it is correct in P1's domain, and this is a MISUSE being withdrawn, not a duplicate being
created. But `CLAUDE.md`'s "extend, don't duplicate" rule requires that a genuinely new subsystem be
justified explicitly with sign-off recorded, and this one qualifies. The one-line justification to
record: *this is not a second answer to "where does this text appear" — it is the first answer to a
different question, "does this record support this claim", which nothing in the repo currently
asks.* My residual worry is not that (c) is wrong; it is that (a) is the cheap fix, it is what the
ledger still recommends in writing (F9), and a lane under time pressure will land it wearing (c)'s
name. M6(ii), M11, M12 and M40 are the four criteria that make that outcome fail. **If only one
criterion survives review, keep M40** — it is the only one that would have caught this defect before
production.

**8. What I could not verify, stated as such.** I did not read the owner's live MasterContext, did
not reach the live Postgres or the Function App, and did not execute the resolver. The record text
*"Built and promoted a high-performing engineering culture"*, the 0.60/1.00/unlocatable measurements
and the two run ids are taken from the task and from `.claude/DEFERRED.md`'s
`D:evidence-resolves-nothing` row — I treated them as given, not as things I confirmed. Everything
else above is read from files at `origin/main` = `3f236ed` and is cited by path and line. The
statement I am most confident of, because I checked it directly rather than inferring it, is F8:
every positive fixture in `api/test/evidence.test.mjs` is a verbatim substring of the fixture
profile, and no fixture anywhere in that file is both true of the profile and worded differently.

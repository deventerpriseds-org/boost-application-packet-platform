# P8.3 — independent verification against `docs/qc-evidence/AC-P8.3.md`

**Verifier:** independent UAT agent. Did not write this code, did not read the implementation plan
before reading the ACs, and takes no claim in the commit messages or `.claude/actions.md` on trust.
**Under test:** `claude/qc-p8-3-evidence` @ `8bf2b59` (two commits: `7a07bbf`, `8bf2b59`), diffed
against the AC baseline `f4c2f43` and against the immediate parent `fe4bcc5` (P8.2) to separate
P8.3's changes from P8.2's.
**Report written on:** `claude/qc-p8-3-verify`, branched from `8bf2b59` (identical tree —
`git diff claude/qc-p8-3-evidence..claude/qc-p8-3-verify` is empty).
**Nothing was fixed.** Every source edit made during verification was a deliberate revert, and every
one was restored; `git status` is clean and `npm test` is back to 316/316.

---

## 0. Baseline evidence — the commands everything below rests on

| # | Command | Result |
|---|---|---|
| E1 | `cd api && npm ci` | exit 0 |
| E2 | `cd api && npm run build` (`tsc`) | exit 0, no output |
| E3 | `cd api && npm test` | **tests 316 · pass 316 · fail 0 · cancelled 0 · skipped 0 · todo 0** |
| E4 | `cd app && npm ci && npm run build` (vite) | exit 0, `✓ 241 modules transformed`, `✓ built in 3.60s` |
| E5 | `cd app && npm test` | **tests 130 · pass 130 · fail 0 · skipped 0** |
| E6 | `git diff fe4bcc5..HEAD --name-only -- app/` | **empty — P8.3 changed no frontend file** |
| E7 | `git diff fe4bcc5..HEAD --name-only -- api/src/functions/tests/` | `appChecks.ts appFacts.ts appRequirements.ts artifactScore.ts checks.ts evidence.ts schema.ts` — `requirements.ts`, `reviewer.ts`, `ownerFacts.ts`, `jdText.ts`, `swaps.ts` untouched |

The commit message for `7a07bbf` claims "315/315 api tests". The measured count on `8bf2b59` is
316/316 — `8bf2b59` added the H30 case after that message was written. Not a discrepancy.

### The two CHANGED tests in `checks.test.mjs` — forced, or bent to fit?

Read every changed assertion in `git diff f4c2f43..HEAD -- api/test/`. Two pre-existing tests changed.
**Both changes are forced by C6, and both tests came out stronger, not weaker.** No test anywhere was
deleted, skipped, or had an assertion removed.

1. `an uncovered must-have fails and names the requirement` → `an unevidenced must-have fails…`.
   Forced: after C6 the check reports `not_applicable` without an `evidence` input, so the test
   cannot reach its own subject without supplying one. All three original assertions survive
   verbatim (`state === 'fail'`, `offenders.length === 1`, `/#0 Deep experience with Kubernetes/`)
   and **two were added** (`/no evidence found in your profile/`, `observed === '1/2 must-haves
   evidenced'`).
   *One real loss, worth naming:* the old version proved `covers()` credited seq 1 and refused seq 0
   from `RESUME_FULL`'s actual text. The new version hands the answer in via `evidenceFor(1)`. That
   particular exercise of `covers()` through `must_have_coverage` is gone — `covers()` is now only
   reached through `evidence_placed`. Not a weakening of the assertion the test was written to make;
   it is a narrowing of what the test incidentally covered.
2. `P1.5 template reach…`: `assert.equal(cov.observed, '1/1 must-haves covered')` →
   `'1/1 must-haves evidenced (3 not reachable by any generated field, not counted either way)'`.
   Forced by AC-27 itself (one denominator, exclusions published). Strictly stronger: the string it
   now pins is longer and names the excluded population.

---

## 1. Do the H-cases actually guard anything?

Method: revert the fix each H-case describes in the **source**, `npm run build`, run
`hardening.test.mjs`, record the assertion that fires and its message, then restore the file and
rebuild. A guard that stays green under its own revert is a failed verification.

**All five reverts fired. Every guard is real.** Restored tree verified clean (`git status` empty)
and `npm test` back to 316/316.

| Revert | What I changed | Result |
|---|---|---|
| **H27 half A** — check denominator (`checks.ts`) | `${coverable.length - unevidenced.length}/${coverable.length} … evidenced${tail}` → `${mustHaves.length - unevidenced.length}/${mustHaves.length} must-haves covered` | **fires.** `hardening.test.mjs:674` — `AssertionError: judged one requirement and it failed, so the numerator is 0/1, not 3/4 — got "3/4 must-haves covered"`; `actual: '3/4 must-haves covered'`, `expected: /^0\/1 /`. 31 pass / 1 fail. |
| **H27 half B** — `observed` parse (`artifactScore.ts`) | restored `mustHaveTotal = reqs.filter(r => r.kind === 'must_have').length` in place of the `/^(\d+)\/(\d+)\b/` parse | **fires.** `hardening.test.mjs:679` — `AssertionError: recomputing the denominator from every must_have row scores this 75 for an artifact that covered nothing`; `actual: 75`, `expected: 0`. 31 pass / 1 fail. |
| **H28** | `resolveEvidence` loops over one synthetic record whose `text` is every record joined with `\n\n` | **fires.** `hardening.test.mjs:717` — `AssertionError: and it is in no single record, so it is not evidence`; `actual` is a full row quoting `'Led the platform modernization\n\nprogramme across four product lines'` spanning both work-history records, `expected: null`. 31 pass / 1 fail. |
| **H29 direction 1** (unreadable profile) | `if (!ev \|\| !ev.profileReadable)` → `if (false)` | **fires.** `hardening.test.mjs:751` — `AssertionError: a run that could not read the profile measured nothing`; `actual: 'fail'`, `expected: 'not_applicable'`. 31 pass / 1 fail. |
| **H29 direction 2** (readable profile, no support) | added a branch filing `unevidenced.length === coverable.length` as `not_applicable` | **fires twice.** `hardening.test.mjs:765` — `AssertionError: we looked and found nothing — that is a gap, not an unknown`; `actual: 'not_applicable'`, `expected: 'fail'`. Also drags H27 down at `:673`. 30 pass / 2 fail. |
| **H30** | `placeable = evidenced.filter(… >= MIN_JUDGEABLE_TOKENS)` → `placeable = evidenced` | **fires.** `hardening.test.mjs:802` — `AssertionError: the summary literally says it; naming it absent is an accusation on absent evidence — got ["#5 Experience in leading technology operations — evidenced by Work history 1, absent from this asset"]`. 31 pass / 1 fail. |

---

## 2. Attacking the substring claim

Own throwaway harness against `api/dist/functions/tests/evidence.js` (not the test suite), asserting
for every returned row that `record.text.slice(char_start, char_end) === quote` for the record the
row **names** via `source_key`, and that `source_key` is never `itemsToOmit`.

**637 probes, 557 of which resolved a row. Zero substring violations. Zero throws.**
Attack classes: case-folding that changes string length (`İ` U+0130, `ẞ`, `ß`, `ﬁ`, `ͅ`), final
sigma, astral plane (`𝕏`, emoji), combining marks, ligatures, a phrase repeated 3× in one record,
the same phrase in two records, records that are prefixes of each other in both orders, empty /
whitespace-only / `null`-text / `undefined` records, a requirement byte-identical to a record (with
and without trailing punctuation and padding), HTML entities on either side, `<p>` wrappers, 210 KB
records with the match at head / tail / middle, `itemsToOmit` injected directly as a record, CRLF /
tab / NBSP / zero-width separators, regex metacharacters in the requirement, `threshold: 0` and
`minTokens: 0` overrides, and 600 seeded fuzz rounds over an alphabet of `İŞÇÖÜßſﬁ` + brackets +
whitespace, three records each, at two thresholds.

A separate 4,000-round randomized probe of `requirements.locate()` found **0** cases where
`haystack.slice(char_start, char_end) !== verbatim`.

**Conclusion: the acceptance sentence holds and I could not break it.** Two findings about *how* it
holds are in DEFECTS FOUND (D-A, D-B) — one of them is a real user-visible bug.

---

## 3. Trying to make the coverage numerator lie

Constructed the live Trinnex shape (4 must-haves, 3 eligibility, 1 judgeable) with a **readable
profile that evidences nothing**, and read every consumer off the same single `runChecks` result:

```
CHECK  must_have_coverage : fail | "0/1 must-haves evidenced (3 not reachable by any generated field, not counted either way)"
       offenders          : ["#3 Deep experience with roadmap strategy and execution — no evidence found in your profile"]
CHECK  template_reach     : not_applicable | "3 requirement(s) no generated merge field can carry…"
SCORE  must_have_coverage : 0 | 0/1 must-have requirements evidenced
SCORE  composite          : null
RAIL   openSeqs           : {"measured":1,"open":[3],"reason":""}
RAIL   must_have card     : total=4 closed=3 openSeqs=[3]
RAIL   source             : 3 of 4 closed by at least one asset in this packet, measured by must have coverage across 1 asset(s)
RAIL   req #0 -> closed/closed   RAIL req #1 -> closed/closed   RAIL req #2 -> closed/closed   RAIL req #3 -> open/open
VERDICT: check says 0/1, score says 0%, rail says 3/4 closed (75%)
```

`checks.ts` and `artifactScore.ts` cannot be made to lie — `unevidenced = coverable.filter(r =>
!evidenceOf(r))` makes the numerator a subset of the rows that hold an evidence row by construction,
and the score parses both numbers off the same string. **`app/src/qcRail.js` can, and does.** See
DEFECT D-C — it is the same 75% H27 was written to kill.

The AC-28 identity was checked on a five-must-have input mixing eligibility, fact-owned, evidenced
and unevidenced rows: `evidenced(1) + no_evidence(1) + unresolvable(0) + fact_owned(3) +
eligibility(0) = 5 = total must_haves`. It is exact, because `mustHaves = coverable ⊎ eligibility ⊎
ownedByFacts` are provably disjoint (`checks.ts:456-459` — `eligibility` excludes `ownedByFacts`), so
`factOwned = mustHaves.length - coverable.length - eligibility.length` is exactly `|ownedByFacts|`
and can never go negative. `unresolvable` is identically 0 because no such population is counted
anywhere (see AC-38).

---

## 4. Live ground truth — the deployed system

The branch is **not deployed**. `api-deploy.yml` fires on `main` only, and `main` is at `44d1cfc`.
Verified directly: `db-query.yml` run **32389727102** →
`select to_regclass('requirement_evidence')` returns **empty (null)** — the evidence table does not
exist in production. **No claim below about the fixed behaviour is a live claim.**

The author's claim about the *current, unfixed* deployed behaviour I verified independently, from
the primary source (the stored rows), not from the author's description.

`db-query.yml` run **32389821155**, job 96492958992 — artifact `cfdd82e7…`, latest run
`666795d4-8192-48b1-944a-feaa1b02ca4a`, computed `2026-08-20 02:08:33+00`:

```
 check_key                  | state          | observed                                | offenders
 facts_needed               | not_applicable | 1 requirement(s) need a fact you have…  | #6 Reside in the East Coast of the United States — "Westminster, MD 21158 (Maryland)" recorded…
 must_have_coverage         | fail           | 1/5 must-haves covered                  | #5 … || #7 … || #8 … || #9 …
 responsibilities_addressed | warn           | 2/5 responsibilities addressed          | #1 … || #3 … || #4 …
 template_reach             | not_applicable | 1 requirement(s) no generated merge…    | #6 Reside in the East Coast of the United States
```

`db-query.yml` run **32389961662**, job 96493406818 — same artifact, same `run_id`:

```
 must_have_coverage | must_have_source                   | keyword_coverage | seniority_alignment | composite | band | uncovered_ids
                 20 | 1/5 must-have requirements covered |                  |                  95 |           |      |             4

 seq | kind           | coverage  | text
   5 | must_have      | escalated | Experience in leading technology operations
   6 | must_have      | escalated | Reside in the East Coast of the United States
   7 | must_have      | escalated | Strong understanding of software engineering practices
   8 | must_have      |           | IoT data, models, geospatial data, and AI/ML
   9 | must_have      | escalated | Ability to manage remote teams
 kind: must_have = 5, responsibility = 5
```

**The claim is CONFIRMED, and the arithmetic is derivable without taking the author's word for it.**
Five must-haves (#5–#9). Four are named as uncovered (#5, #7, #8, #9), and
`uncovered_requirement_ids` has length 4. `1/5` therefore credits exactly one row as covered, and by
elimination that row is **#6, "Reside in the East Coast of the United States"** — the row that
`template_reach` reported `not_applicable` and `facts_needed` reported as needing an unconfirmed
fact, **in this same `run_id`**. The score repeats it as `20`. This is `mustHaves.length -
uncovered.length = 5 - 4 = 1` over `mustHaves.length = 5`, with `uncovered` drawn from `coverable`,
which excludes #6 — precisely the defect H27 describes.

Two things the same query settles as a by-product: `composite` is **null** live while
`keyword_coverage` is null (H7 holds in production), and `requirement.coverage = 'escalated'` is
live on four rows, confirming D-11's column collision is real and that P8.3 was right not to write
there.

---

## 5. House rules

| Rule | Verdict | Evidence |
|---|---|---|
| Absent evidence is `not_applicable`, never `pass` | **holds** | H29 both directions fire on revert; `!ev \|\| !ev.profileReadable` → three `na` rows; `gateFor` unchanged so an all-`na` run is `warn`. |
| `composite` null unless all three components exist | **holds** | H7 passes; `schema.ts:508` CHECK untouched by the diff; live row has `composite` null with `keyword_coverage` null. |
| `similarity()` not called from the evidence path | **holds at runtime, NOT guarded** | `grep -n similarity` over `evidence.ts requirements.ts checks.ts artifactScore.ts` → no hits. But H4b (`hardening.test.mjs:93-98`) greps only `checks.ts` from `const covers =`; it was **not** extended to `evidence.ts`. AC-19 asks for the guard. See DEFECT D-E. |
| `itemsToOmit` can never become evidence | **holds, two locks** | `profileRecords` skips it (`NEVER_EVIDENCE`); `resolveEvidence` skips any record whose `key` is in `NEVER_EVIDENCE` even when injected directly (attack probe `o1-omit` returned no row); no record's text contained the omit-list string. |
| No duplicate `app.http` route | **holds** | The added route `app/opportunity/{id}/evidence` appears once. Two route strings repeat repo-wide (`config`, `app/coach/config`) — both are method-disjoint GET/POST pairs with distinct function names, and both are present unchanged at `f4c2f43`. Not introduced here. |
| No hardcoded config | **VIOLATED by the new thresholds** | See DEFECT D-F. |

---

## 6. Criterion-by-criterion

`pass` = proved from observed output. `fail` = disproved, or a required half is absent.
`not_applicable` = could not be tested here, with the reason. A criterion I could not test is never
`pass`.

### A — the profile reader

| AC | Verdict | Observed evidence |
|---|---|---|
| 1 | pass | `grep -rn "MasterContext" api/src/functions/tests/*.ts`: the only `TableClient…'MasterContext'` profile-prose readers remain `appFacts.ts:47` and `pipeline.ts:79`. `evidence.ts` opens nothing — it is handed the entity. Count is 2, not 3. *Note:* `evidence.ts` re-implements the membership predicate (`looksLikeTableMeta` + `NEVER_EVIDENCE`) that `appFacts.ts:55-56` states inline — one rule, two expressions, in the same call chain. |
| 2 | pass | `git show f4c2f43:…/appFacts.ts` → `async function sourceText(` (unexported). Now `export async function sourceText(): Promise<{ text; sources; records }>`. `evidence.ts` imports no `@azure/*` and no `pgClient` (H12 passes with `evidence.ts` in its list). No second `TableClient.fromConnectionString(CONN,'MasterContext')` was added. |
| 3 | **fail** | `pipeline.ts:149-151` is unchanged: `Object.entries(mc).filter(([k,v]) => typeof v === 'string' && k !== 'itemsToOmit').map(([,v]) => v).join(' ')` — still excludes only `itemsToOmit`, still joins with `' '`, still admits `rowKey`/`etag`/`timestamp` as prose. The membership and separator are not pinned in one place and the other call site does not read the same function. |
| 4 | pass | Harness: `itemsToOmit present? false`; `omit text leaked into any record? false`; injected-`itemsToOmit` probe returned no row. |
| 5 | pass | Order `resume_template:tpl1 \| certifications \| executiveProfile \| workHistory1 \| workHistory2` — template first then key-sorted. `JSON.stringify(a) === JSON.stringify(b)` → **true**; identical after reversing the entity's key insertion order → **true**. Empty / whitespace-only / non-string fields dropped. *Note:* the id field is named `key`, not `record_id` as the AC words it; semantically the same. |
| 6 | pass | `any astral? false` (`toBmp` at `profileRecords`); `text.length === [...text].length` for every record → true. This is load-bearing for the schema's `check (length(quote) = char_end - char_start)`, since Postgres `length()` counts code points and JS offsets are code units. |
| 7 | pass (sandbox half) | `appFacts.ts:44` catch unchanged → `sources.push('resume template UNREADABLE: …')`; `template` stays `null`, so `profileRecords` emits **no** template record. Verified for `null`, `undefined`, `{text:''}`, `{text:'   '}` — record **absent** in all four, never empty-string. The live OAuth failure itself is in NOT VERIFIABLE HERE. |
| 8 | pass | `hardening.test.mjs:241` H12 list now includes `'evidence.ts'`; H12 green. `evidence.ts` imports only `node:crypto`, `./requirements`, `./swaps`, `./jdText`, `./reviewer`. |

### B — the evidence row

| AC | Verdict | Observed evidence |
|---|---|---|
| 9 | pass | `schema.ts:323` `create table if not exists requirement_evidence (`; `EXPECTED_TABLES` gains `'requirement_evidence'`; H11's list gains it and H11 passes. *Note:* `ensureRequirementCols` also carries a duplicate `create table if not exists` — a CREATE, not an ad-hoc ALTER, and in addition to the registration rather than instead of it, so the AC's named hazard is avoided. The two DDL copies are hand-kept in sync and nothing asserts they match. |
| 10 | pass | Schema read: no unique on `requirement_id` alone; `unique (requirement_id, source_key, char_start, char_end)`. *Note:* the store permits N but nothing produces or reads N — `resolveAll` emits at most one row per requirement, and `loadRequirementsWithEvidence` has `limit 1`. Untested against a live table (it does not exist). |
| 11 | pass | Columns `quote, source_kind, source_label, source_key, char_start, char_end, extra` plus `ratio, method, record_sha256, resolver_version, resolved_at`. `source_key` is the record id. |
| 12 | pass | `check (source_kind in ('work_history','accomplishment','profile_field','certification'))`. All four are producible: harness shows a field named `certifications` yields `kind = certification`. *Note:* D-3 is resolved by a **name** rule (`/cert\|licen/i`, `evidence.ts:112`) rather than by content inference — the right call under the fuzzy-matching rule — but the 15 live MasterContext fields (`mt13.ts:12-17`) contain no such key, so `certification` is permitted and unreachable on the real profile today. |
| 13 | pass | `check (char_start >= 0 and char_end > char_start)` present. All of `quote`/`char_start`/`char_end` are `not null`, so "start null iff end null" and "start null iff quote null" hold vacuously. A **stronger** guard is added: `check (length(quote) = char_end - char_start)`, valid only because of AC-6 (verified above, both in code points and code units). |
| 14 | **fail** | `record_sha256` is written (`evidence.ts` `sha256(rec.text)`) and returned as `evidence.recordSha256`. Nothing recomputes it on read. `requirementsGet`'s `stale` is `rows.some(r => r.jd_text_sha256 !== opp.jd_text_sha256)` — the **posting** hash, unchanged from before P8.3. There is no evidence-side `stale`. |
| 15 | pass | `extra` is only ever `the excerpt does not mention: <tokens>` — a list of the requirement's own missing content words, never profile bytes, never a second quote. `appChecks` reconstructs it as `null` for the checks path. |
| 16 | not_applicable | No model authors an evidence row — the whole path is deterministic (`resolveAll` → `writeEvidence`, no model call). Refusal does happen before persistence (`writeEvidence` `continue`s before the INSERT). The criterion's subject does not exist yet; there is also no `provenance`/`authored_by` column should one be added. |

### C — resolution

| AC | Verdict | Observed evidence |
|---|---|---|
| 17 | pass | 637 adversarial probes / 557 resolved rows, **0** violations of `record.text.slice(s,e) === quote` for the **named** record; 600 of those were seeded fuzz. H28 additionally proves the negative: a phrase present only in the concatenation resolves to `null`, and reverting to a joined record makes it resolve. *Note D-B:* the explicit guard in `resolveEvidence` cannot fail — the property is guaranteed upstream by `locate()`'s construction. |
| 18 | pass | Same run: the emitted `quote` is always the record's own bytes at the recorded offsets, never a re-rendering. |
| 19 | **fail** | Runtime property holds (`grep -n similarity` over `evidence.ts requirements.ts checks.ts artifactScore.ts` → no hits). The AC also requires "a source-grep H-case asserts it (the H4b pattern)". H4b was **not** extended: `hardening.test.mjs:94` still reads `const checks = src('checks.ts')` and slices from `const covers =`. Nothing would notice if `evidence.ts` reached for `similarity()` tomorrow. |
| 20 | **fail** | First half passes: `evidence.ts` imports `MIN_QUOTE_CHARS`/`MIN_QUOTE_WORDS` from `reviewer.ts:157-158` and applies both — no second pair of numbers. Second half fails: `EVIDENCE_THRESHOLD`, `MIN_JUDGEABLE_TOKENS`, `DISTINCTIVE_LEN`, `MIN_QUOTE_CHARS`, `MIN_QUOTE_WORDS` are none of them in `CheckThresholds` (`checks.ts:41`) or `loadThresholds` (`appChecks.ts:42-54`, which reads `owner_search_prefs`), and `writeEvidence` calls `resolveAll(rows, records)` with **no opts**, so even the `ResolveOptions` escape hatch is unreachable in production. See DEFECT D-F. |
| 21 | pass | Requirement repeated 4× in one record, `resolveEvidence` run 50×: **one** distinct result, `char_start:char_end = 0:58`, and `record.text.slice(0,58) === quote`. Deterministic, and the chosen occurrence is the one at the recorded offsets. |
| 22 | **fail** | `loadRequirementsWithEvidence` is a plain `left join lateral` — it re-reads the stored quote and offsets and never re-resolves them against current record text. `requirementsGet` serves them as-is with no unresolvable flag. `evaluateArtifact` takes the opposite wrong turn: it `delete`s and re-resolves every row on each run, i.e. **silently re-anchors** to the new position, which is exactly what the AC forbids. |
| 23 | **fail** | There is no closed rejection enumeration. `resolveEvidence` returns bare `null` with no reason; `writeEvidence` returns only an integer `refused` count. None of the six named reasons (no profile text, record not found, quote too short, quote not in named record, offsets outside record, record text changed) is distinguishable by any caller. No `DropReason` analogue. |
| 24 | pass (by construction, untested) | A refused candidate is `continue`d before the INSERT (`appRequirements.ts` `writeEvidence`) and never enters a return value or a rendered string. *Caveat:* no test asserts it, and the refusal branch is unreachable in practice (D-B), so it has never executed. |

### D — the numerator

| AC | Verdict | Observed evidence |
|---|---|---|
| 25 | pass | `checks.test.mjs` "a document containing the words does NOT make a requirement covered without evidence (C6)" passes: `RESUME_FULL` seeded to literally contain the requirement, `evidence.bySeq = {}` → `must_have_coverage` is `fail` with `/no evidence found in your profile/`. `unevidenced = coverable.filter(r => !evidenceOf(r))`; `covers()` is no longer consulted for this numerator. |
| 26 | pass | Two distinct rows are emitted: `must_have_coverage` (evidence) and `evidence_placed` (placement). `checks.test.mjs` "an evidenced requirement absent from the document is a placement warning, not a coverage gap" → coverage `pass`, `evidence_placed` `warn`. The numerator C6 names is the evidence one. |
| 27 | pass | Both branches divide by `coverable.length`; `observed` reads `N/M must-haves evidenced (… , not counted either way)`. Proved by revert: restoring the second denominator produces `"3/4 must-haves covered"` and fires H27 at `:674`. |
| 28 | pass (with a caveat) | Measured on a mixed five-must-have input: `evidenced(1) + no_evidence(1) + unresolvable(0) + fact_owned(3) + eligibility(0) = 5 = total`. Exact by construction (disjointness argument in §3). **Caveat:** the identity holds partly because `unresolvable` is identically zero — no such population is counted (AC-38). Not verified by a live `GROUP BY`: the table does not exist in production. |
| 29 | pass (check + score only) | Revert of H27 half A reproduces `"3/4 must-haves covered"`; half B reproduces `score 75`. Fixed code gives `0/1` and `0`. Live production confirms the unfixed form: `1/5`, score `20`, crediting #6. **But see AC-32/36 — the rail still does exactly this.** |
| 30 | pass | `const reqs = input.requirements \|\| []` and `mustHaveTotal` are **deleted** from `artifactScore.ts`; both numbers now come from `mh.observed`. H27's structural half greps `stripComments(src('artifactScore.ts'))` for `kind === 'must_have'`. *Note:* the module-to-module contract is now a regex over a human-readable sentence; a wording change in `checks.ts` yields `value: null` (fail-safe, not fail-silent — it names the unparsed string in `source`). |
| 31 | **fail** | The three sites do agree in practice — my rail harness parsed the new offender string `#3 … — no evidence found in your profile` correctly (`openSeqs → {"measured":1,"open":[3]}`), and `artifactScore`'s `/^#(\d+)\b/` is unchanged. But the AC requires "a test asserts a round-trip through all three", and none exists: `app/test/qcRail.test.mjs:428` tests `offenderSeq('#12 something')` against a hand-written literal, not against a string `checks.ts` produced. |
| 32 | **fail** | Measured, §3: check `0/1`, score `0%`, rail **`3 of 4 closed`**, with requirements #0/#1/#2 rendered green `closed` by `requirementState`. The rail reports a packet-level number that disagrees with the asset-level one. DEFECT D-C. |
| 33 | **fail** (first half) | `keyword_coverage` is untouched and stays null (live row confirms null; `artifactScore.ts:113-117` unchanged) — that half passes. The term numerator was neither moved to evidence nor was "the difference stated on screen": E6 shows no frontend file changed, so nothing states it anywhere a user can see. |

### E — the three absent-evidence states

| AC | Verdict | Observed evidence |
|---|---|---|
| 34 | pass | H29's second half: readable profile, `bySeq: {0: null}` → `state 'fail'`, `observed` matches `/^0\/1 /` (still in the denominator), offender matches `/no evidence found in your profile/`. Reverting to `not_applicable` fires the case at `:765`. |
| 35 | **fail** | The API shapes it (`evidenceNote: NO_EVIDENCE_NOTE`, `appRequirements.ts`). No frontend renders it — E6, and `grep -rn "evidenceNote" app/src/` → no hits. |
| 36 | **fail** | `app/src/qcRail.js` `coverageCards` counts an unevidenced, excluded requirement as `closed`, and `requirementState` labels it green `closed`. Measured, §3. The criterion's own words — "asserted at every consumer, not only at the one the fix was written in" — are what this fails. |
| 37 | pass | H29 first half asserts exactly this trio and passes: `state 'not_applicable'`, `score.must_have_coverage.value === null`, `score.composite === null`, `gateFor([cov]) === 'warn'`. Reverting fires at `:751` with `actual: 'fail'`. |
| 38 | **fail** | No `evidence_unresolvable` population exists. `writeEvidence` counts refusals into a return field (`refused`) that no check reads, no table stores, and no surface names. It is not reported as a finding and the offending requirement is never named. Refusal and honest absence are indistinguishable downstream. |
| 39 | pass | `!reqs.length` branch preserved (now pushing three `na` rows including `evidence_placed`); `checks.test.mjs` "coverage with NO requirement rows is not_applicable — never pass" passes. No path from zero requirements to a percentage: `artifactScore` requires a `N/M` parse, and no such string is emitted on that branch. |
| 40 | pass | `gateFor` is byte-identical in the diff (verified by reading the function in full). H22 (`gateFor([])` → `warn`) passes; the all-`not_applicable` → `warn` branch is intact. |
| 41 | **fail** (first half) | Non-overloading half passes: `grep` confirms nothing in `appRequirements.ts` or `evidence.ts` writes `requirement.coverage` from evidence (the only mentions are the column list in the requirement-spine INSERT). But the AC's substantive half — "the requirement is marked for escalation" — is not implemented: there is no escalation marker for an unevidenced requirement anywhere, in any column, check, or payload. R2's escalation path does not exist. |

### F — the JD analysis screen

**E6 is decisive for this whole section: `git diff fe4bcc5..HEAD --name-only -- app/` is empty.**
The API serves `evidenced`, `evidence{…}` and `evidenceNote`; no UI consumes any of it. The author
discloses this in `.claude/actions.md` ("the disclosure control itself is P5.4/P8.7 territory and is
not built here"), which is honest, but the criteria are still unmet.

| AC | Verdict | Observed evidence |
|---|---|---|
| 42 | **fail** | No "evidenced" state and no expansion affordance exists on the JD step. `PostingAnalysis.jsx` unchanged. |
| 43 | **fail** | No expansion exists to render the excerpt, source or note. |
| 44 | **fail** | The literal string is served by the API and rendered by nothing. |
| 45 | not_applicable | The employer's quote and its provenance line are preserved (`PostingAnalysis.jsx` untouched). The criterion is about how the **profile excerpt** is distinguished from it, and no profile excerpt is rendered, so there is nothing to judge. |
| 46 | not_applicable | The "Model paraphrase — not a quote from the employer" treatment is preserved (file untouched); the criterion's subject — a profile excerpt filling the vacated slot — does not exist. |
| 47 | **fail** | No new `data-qc` hooks; `PostingAnalysis.jsx:37,50` still carry only `req-row`/`req-quote`. No `ROUTE`/`CLICK_SEL`/`EXPECT` triple is named anywhere for the expanded state, and no `ui-verify.yml` run could assert it. |
| 48 | **fail** | No `n/m evidenced` count is displayed. |
| 49 | not_applicable | Nothing conflates them because nothing displays the new count. *Hazard worth naming:* `app/src/postingAnalysis.js:115` already exports a variable called `evidenced` meaning something entirely different (the `kind_source` split — "the posting asserted this filing"). Two different facts now share one word in one codebase. |
| 50 | pass | `COVERAGE_KINDS`'s `nice_to_have` entry still has `check: null`, so `coverageCards` returns `closed: null` with `NO_CHECK_NOTE`. `resolveAll` is deliberately unfiltered by kind so nice-to-haves *do* get evidence rows, but `checks.ts` computes `evidenced` from `[...coverable, ...resp]` only — no implicit 0/N or N/N appeared. |

### G — regression guards

| AC | Verdict | Observed evidence |
|---|---|---|
| 51 | pass | `requirements.ts` is not in E7's changed-file list. H3/H5/H5b/H5c green in the 316. |
| 52 | pass | H7 green; `schema.ts:508` composite CHECK not in the diff; live `artifact_score` row has `composite = null` with `keyword_coverage` null and `must_have_coverage = 20`. |
| 53 | pass | `gateFor` byte-identical (read in full). `artifactScore.ts` still filters `c.engine === 'deterministic'` when finding `must_have_coverage` (H17 green). The new `evidence_placed` never emits `fail` — it uses `bad(…, 'warn')` on its only bad branch. |
| 54 | pass | None of `skill_char_limit`, `changes_cited`, `company_named`, `template_reach`, `facts_settled`, `fact_shortfall`, `facts_needed` appears in the `checks.ts` diff — the hunks touch only the `!reqs.length` push and the coverage block. Their tests pass. *Note:* the result **array** gained an `evidence_placed` row, so `runChecks(x).length` changed; the named checks' own results did not. |
| 55 | pass | `ownerFacts.ts` untouched; `checkAgainstFacts` still returns `unknown`. The de-duplication at `checks.ts:456-459` is unchanged and `ownedByFacts` still removes those rows from `coverable` **before** evidence is consulted, so no evidence row can promote them. My mixed-input run shows the three fact-owned rows named once (`facts_needed`) and excluded from the numerator, not double-reported. |
| 56 | pass | `ownerFacts.ts` untouched; `owner_fact` is absent from the `schema.ts` diff; the substring rule lives entirely in `evidence.ts` and touches no `owner_fact` column. |
| 57 | pass | 316/316, 0 skipped, 0 todo. Full read of `git diff f4c2f43..HEAD -- api/test/`: two tests changed, both forced by C6 and both strengthened (§0). Nothing deleted, nothing weakened, nothing skipped. |
| 58 | pass | E2 and E4 both exit 0. New route unique; the two repeated route strings are method-disjoint GET/POST pairs present unchanged at `f4c2f43`. |
| 59 | **fail** | `grep -rn "must_have_coverage\|responsibilities_addressed" api/src app/src` lists: `checks.ts`, `artifactScore.ts`, `appChecks.ts`, `appReviewer.ts:175,183,294,304`, `reviewer.ts`, `schema.ts`, `app/src/qcRail.js`, `app/src/assetGate.js:53,202`, `app/src/screens/AssetGateDrawer.jsx:325`. Three do **not** agree: (a) `qcRail.js` — DEFECT D-C; (b) `assetGate.js:53` still labels the check "Must-haves this document covers", which is no longer what it measures; (c) `appReviewer.ts:183` computes `engineJudged` over every must-have row while the check judges only `coverable`. (b) and (c) are disclosed by the author in `.claude/actions.md`; (a) is not. |
| 60 | pass | `reviewer.ts` untouched, so `agreementFor`'s `not_comparable` exclusion is unchanged and no agreement is manufactured from newly-silent rows. *Related but distinct:* `appReviewer.ts:183`'s population mismatch under AC-59(c) — the author records it as knowingly unfixed and out of this lane. |

### H — hardening

| AC | Verdict | Observed evidence |
|---|---|---|
| 61 | **fail** (3 of 4) | (a) H28 — proved by revert. (b) H29 second half — proved by revert. (d) H29 first half asserts `score.must_have_coverage.value === null` and `composite === null` — proved by revert. **(c) is missing**: no H-case asserts that the evidence resolver reaches for no ranking heuristic. H4b was not extended to `evidence.ts` (AC-19). |
| 62 | pass | Each of H27/H28/H29/H30 records measured evidence in its comment — the live opp `9f9c370a`, the counts (4 must-haves, 3 eligibility), the actual bad values (`"3/4 must-haves covered"`, `75`), and the exact requirement text for H30. H27's source-grep half uses `stripComments(src('artifactScore.ts'))`. None fires on correct code: 316/316 green. *Note:* the numbering skips **H26** — `grep -c H26` over `hardening.test.mjs`, `.claude/actions.md` and `.claude/memory.md` returns 0 everywhere. Cosmetic, but a reader of the H-series will look for it. |
| 63 | pass | `ACT-65` added in `7a07bbf` (the same commit as H27/H28/H29) naming all three, each with its revert-proof; the H30 paragraph is added in `8bf2b59`, the same commit as the H30 test. Both also record what was deliberately **not** fixed. |

**Tally: 39 pass · 20 fail · 4 not_applicable.**

---

## DEFECTS FOUND

### D-A — a quote can be mis-anchored, and it is still a true substring (real, user-visible)

`requirements.locate()` — which `resolveEvidence` reuses — searches a lower-cased copy of the
haystack and uses the index into that copy as an offset into the **original**:

```js
const hay = postingText.toLowerCase()          // requirements.ts:265
for (let i = hay.indexOf(nee); …)
  return { verbatim: postingText.slice(i, i + needle.length), char_start: i, … }
```

`String.prototype.toLowerCase()` is not length-preserving. `İ` (U+0130) lowercases to two code units
(`i` + U+0307) — measured: `len=1 lower.len=2`. Every such character before the match shifts the
recorded offset.

Reproduction (record text = `'İİİİİ Resideo. led the platform modernization programme across four product lines and more.'`):

```
locate: start=20 end=86 method=exact
  verbatim = "he platform modernization programme across four product lines and "
  true index of phrase in hay = 15
  hay.slice(start,end) === verbatim ? true
resolveEvidence on same: [20,86) quote="he platform modernization programme across four product lines and " sliceEq=true
```

The row is stored and rendered to the candidate as a verbatim excerpt of their own profile. It is
shifted five characters: `"led t"` is cut off the front and `" and "` glued on the end. It passes the
`MIN_QUOTE_CHARS`/`MIN_QUOTE_WORDS` floors and the 0.7 ratio, so nothing catches it.

**The P8.3 acceptance sentence still holds** — the quote *is* `record.text.slice(char_start,
char_end)` — which is precisely why this is worth reporting: the invariant the H-cases protect is
satisfied while the excerpt shown to the user is wrong. Pre-existing in `locate()` and therefore also
live on `requirement.verbatim` against postings; P8.3 newly points it at the candidate's own profile,
where a garbled "your own words" is a worse failure than a garbled posting quote. `toBmp` does not
help: U+0130 is BMP.

### D-B — the substring guard is a tautology; it has never rejected anything

`resolveEvidence` (`evidence.ts`) and `writeEvidence` (`appRequirements.ts`) both carry what the
commit message calls "the accusation-grade half":

```js
if (rec.text.slice(loc.char_start, loc.char_end) !== loc.verbatim) continue     // evidence.ts
if (!rec || rec.text.slice(e.char_start, e.char_end) !== e.quote) { refused++; continue }  // writeEvidence
```

`locate()` **constructs** `verbatim` by slicing the haystack — `postingText.slice(span.start,
span.end)` on the exact branch, and `clipped` with `char_end = from + clipped.length` on the anchored
branch. The comparison therefore cannot be false. Measured: 4,000 randomized `locate()` rounds over a
hostile alphabet, `haystack.slice(char_start, char_end) !== verbatim` in **0** of them, including
every mis-anchored D-A case.

This is harmless as defence-in-depth and the property it asserts genuinely holds. Two consequences
worth stating plainly: the guarantee comes from `locate()`'s construction, **not** from these checks;
and `refused` is dead — it is structurally always 0, which is why AC-38's `evidence_unresolvable`
population has nothing to count and AC-24's refusal path has never executed.

### D-C — the 75% H27 killed is still on screen (the significant one)

The defect H27 removed from `checks.ts` and `artifactScore.ts` survives unchanged in
`app/src/qcRail.js`, and P8.3 is what put it there.

`coverageCards` (`qcRail.js:495-526`) computes `total` as **every** `must_have` row and `closed` as
`total − |open|`, where `open` comes only from the check's offenders. Before P8.3 that agreed with the
check by construction: the old fail branch printed `mustHaves.length − uncovered.length` over
`mustHaves.length`, which is the same arithmetic. **P8.3 moved the check's denominator to `coverable`
and left the rail on the full population**, so the two now disagree by exactly the excluded rows.

Measured, on the Trinnex shape with a profile that evidences nothing:

| Surface | Says |
|---|---|
| `must_have_coverage` check | `0/1 must-haves evidenced (3 not reachable by any generated field, not counted either way)` — fail |
| `artifact_score.must_have_coverage` | `0` |
| `qcRail.coverageCards` | **`3 of 4 closed by at least one asset in this packet`** |
| `qcRail.requirementState` | requirements #0, #1, #2 → **green `closed`** |

`3/4 = 75%` — the same number, from the same three unmeasured rows, as the H27 incident. The revert
of H27 half A prints `"3/4 must-haves covered"` from `checks.ts`; the rail prints `3 of 4 closed`
from the *fixed* `checks.ts`. Under AC-36 and AC-59 this is the criterion's own named failure mode:
the fix was applied where the H-case looks and not at the other consumer. It is also the one item in
this class the author does **not** disclose in `.claude/actions.md` (the `assetGate.js` label and the
`appReviewer.ts` population are both disclosed).

### D-D — stored evidence is never re-validated on read, and `evaluateArtifact` silently re-anchors

`record_sha256` is written and served but never recomputed. `loadRequirementsWithEvidence` is a plain
join; `requirementsGet`'s `stale` flag is the posting hash only. So the AC-14/AC-22 read-time
guarantee does not exist: after the owner edits a MasterContext block, the JD-step payload keeps
serving the old quote at the old offsets with no `stale` and no `unresolvable`.
`evaluateArtifact` does the opposite and equally forbidden thing — it `delete`s every evidence row
for the opportunity and re-resolves, i.e. re-anchors to a new position without ever reporting that the
old one rotted (AC-22: "not silently re-anchored to a new position").

### D-E — the evidence resolver is not protected by the fuzzy-matching guard

H4b (`hardening.test.mjs:93-98`) reads `src('checks.ts')` and slices from `const covers =`. It was not
extended to `evidence.ts`, so nothing prevents `similarity()` — the function H4 demonstrates rates
`'Skill number 0'` and `'Skill number 3'` above 0.9 — from entering the evidence path later. The
property holds today (verified by grep); the guard the AC asks for (AC-19, AC-61c) is absent. Given
that the module's own header comment makes "fuzzy for ranking, never for accusing" its central claim,
this is the guard most worth having.

### D-F — five new behaviour-affecting constants with no owner path

`EVIDENCE_THRESHOLD = 0.7`, `MIN_JUDGEABLE_TOKENS = 3`, `DISTINCTIVE_LEN = 6` in `evidence.ts`, plus
the imported `MIN_QUOTE_CHARS = 20` / `MIN_QUOTE_WORDS = 4`, all decide whether a candidate's
requirement counts as evidenced. None is in `CheckThresholds` (`checks.ts:41`) or `loadThresholds`
(`appChecks.ts:42-54`, which reads `owner_search_prefs`). `ResolveOptions` exposes `threshold` and
`minTokens`, but `writeEvidence` calls `resolveAll(rows, records)` with no options, so in production
nothing can override any of them. `checks.ts:19-20` states the house rule directly — "Every one of
these is a seeded DEFAULT, overridable per owner… Nothing here may become a permanent constant" — and
`evidence.ts`'s own comment claims "Overridable per call; nothing here may become a permanent
constant", which is not true of the shipped call path. AC-20's second half, and CLAUDE.md's
no-hardcoded-config rule.

### D-G — smaller, non-blocking

1. **`extra`, `record_sha256` and `resolver_version` are fabricated on the checks path.**
   `appChecks.evaluateArtifact` rebuilds `EvidenceRow` from the DB with `extra: null`,
   `record_sha256: ''`, `resolver_version: 0` while the real values sit in columns it already
   selected. Nothing downstream reads them today, so it is inert — but it is a synthesized value in a
   field named for a digest, one edit away from mattering.
2. **`text` and `records` are two constructions of one profile.** `sourceText` builds `text` from the
   raw entity through an inline filter, and `records` through `evidence.ts`'s `looksLikeTableMeta` +
   `NEVER_EVIDENCE`, with `toBmp` applied to the records and not to `text`, and sorting applied to the
   records and not to `text`. They agree today. AC-3 is the criterion about exactly this.
3. **The `requirement_evidence` DDL exists twice**, in `SCHEMA_SQL` and in `ensureRequirementCols`,
   hand-kept in sync with nothing asserting they match.
4. **H26 does not exist** anywhere in the repo — the series runs H25 → H27.
5. **`evidenced` now names two different facts** in one codebase: the new coverage concept, and
   `postingAnalysis.js:115`'s pre-existing `kind_source` split. AC-49 warns about this conflation.

---

## NOT VERIFIABLE HERE

1. **Anything about the fixed behaviour in production.** The branch is not deployed —
   `api-deploy.yml` fires on `main` only, `main` is at `44d1cfc`, and
   `select to_regclass('requirement_evidence')` on the live database returns **null** (run
   32389727102). Every "fixed" verdict above is a local verdict. What *is* live-confirmed is the
   **unfixed** defect: `1/5 must-haves covered` / score `20`, crediting requirement #6, the row
   `template_reach` and `facts_needed` both declared unmeasurable in the same `run_id`.
2. **The persisted shape and AC-28's live `GROUP BY`** (ACs 9-14, 24, 28, 36 as the AC file scopes
   them to `db-query.yml`). The table does not exist yet, so the DB CHECKs, the uniqueness
   constraint, the `length(quote) = char_end - char_start` guard and the population identity are all
   verified only against `schema.ts` source and against the pure modules. In particular the
   Postgres-side `length()` guard is only *argued* safe (via AC-6's code-point property, which I did
   verify) — no row has ever been inserted.
3. **The live route** `POST /api/app/opportunity/{id}/evidence` and the new fields on the
   requirements GET. Not deployed; the sandbox egress blocks `azurewebsites.net`. `api-test.yml`
   would only exercise `main`'s code.
4. **AC-7's live failure path.** I verified that a `null`/blank template yields no record, which is
   the code-level guarantee. I did not cause a real Google OAuth failure, so `resume template
   UNREADABLE: <message>` reaching `sources` in production is unverified here.
5. **ACs 42-50 by their intended vehicle.** `ui-verify.yml` would need the JD step's disclosure
   control on `main`. Since E6 shows no frontend file changed at all, I settled these from the diff
   rather than from a runner — which disproves them regardless of the vehicle, so nothing is claimed
   as passing on the strength of a test I could not run.
6. **Whether the live MasterContext really has no certification-named field.** I read the required
   15 field names from `mt13.ts:12-17`; I did not enumerate the live entity's actual property list.
   The AC-12 note depends on that source, not on the storage account.

---

## ADDENDUM — re-verified against the current PR head, `30a236b`

The assigned scope was `8bf2b59` (the two commits named in the task). Everything above was measured
there. While this report was being written, `origin/claude/qc-p8-3-evidence` — the head of **PR #13**
— advanced by 13 commits to **`30a236b`**, several of which name findings in this report. Reporting a
defect that has already been fixed would be worse than not reporting it, so I checked out `30a236b`,
rebuilt, and re-ran every probe that could have been affected.

**Baseline at `30a236b`:** `npm run build` exit 0; **`npm test` → tests 328 · pass 328 · fail 0 ·
skipped 0** (up from 316 — twelve added, none removed).

**Unchanged since `8bf2b59`** (`git diff --stat 8bf2b59..30a236b -- …` empty for each):
`evidence.ts`, `requirements.ts`, `artifactScore.ts`, `app/src/qcRail.js`. The `checks.ts` delta is
entirely P8.2's `posting_figure_echo` block; the coverage block is untouched. So every §2 and §3
measurement transfers directly, and I re-ran them anyway.

### Fixed since `8bf2b59` — these findings no longer stand

| Was | Now at `30a236b` |
|---|---|
| **D-G2** — `text` and `records` were two constructions of one profile | **Fixed** by `8db5c00`. `sourceText()` now builds `text` as `records.map(r => r.text).join(…)`; the exclusion rule exists once, in `profileRecords`. Guarded by a new structural test in `evidence.test.mjs` ("there is ONE rule for what counts as the profile") that greps the comment-stripped `sourceText` body for the join and asserts `itemsToOmit` does **not** reappear there. |
| **D-G4** — the H-series skipped H26 | **Fixed** by `44d1cfc` + `de4bc91`. `grep -o "^test('H[0-9]*"` now yields H1…H31 with no gaps. **The four cases verified in §1 are renumbered: H27→H28, H28→H29, H29→H30, H30→H31.** The §1 revert evidence stands unchanged in substance; only the ids moved. |
| **AC-31** — no test round-tripped the `#<seq>` contract | **Now passes.** `06caa09` adds `evidence.test.mjs` "the `#<seq> ...` offender prefix survives the numerator change": it runs `checks.ts` for real with seqs 3 and 30, applies `artifactScore`'s `/^#(\d+)\b/`, and asserts `[3, 30]` — catching the `#3`-inside-`#30` prefix bug — plus `/no evidence found in your profile$/`. *Caveat:* the third site is asserted by a **duplicated copy** of the regex rather than by importing `qcRail.offenderSeq`, because the api and app test suites cannot import each other. Two of three sites are exercised for real; the third is pinned by replication. |

### Still standing at `30a236b` — re-measured, not inferred

- **D-A** (mis-anchored quote) and **D-B** (tautological guard): `evidence.ts` and `requirements.ts`
  are byte-identical to `8bf2b59`. Re-ran both harnesses against the `30a236b` build: 637 probes /
  557 resolved / **0** substring violations, and `locate()` still returns
  `verbatim = "he platform modernization programme across four product lines and "` at `[20,86)` for
  a record whose true match index is 15 — the five `İ` characters still cost five characters of the
  candidate's own words. 4,000 `locate()` rounds, **0** cases where the guard could have fired.
- **D-C — the 75% is still on screen.** Re-ran the cross-consumer probe against the `30a236b` build:

  ```
  SCORE  must_have_coverage : 0 | 0/1 must-have requirements evidenced
  RAIL   must_have card     : total=4 closed=3 openSeqs=[3]
  RAIL   source             : 3 of 4 closed by at least one asset in this packet…
  RAIL   req #0 -> closed/closed   req #1 -> closed/closed   req #2 -> closed/closed   req #3 -> open/open
  VERDICT: check says 0/1, score says 0%, rail says 3/4 closed (75%)
  ```

  `qcRail.js` has not been touched. **This is the finding that matters, and it is unfixed on the
  branch that is up for merge.**
- **D-D** (no read-time revalidation): `appRequirements.ts:226` still computes `stale` from
  `jd_text_sha256` alone; `record_sha256` is still stored and served and never recomputed. ACs 14 and
  22 still fail.
- **D-E** (H4b not extended): `hardening.test.mjs`'s H4b still reads only
  `src('checks.ts').slice(indexOf('const covers ='))`. ACs 19 and 61(c) still fail.
- **D-F** (thresholds not owner-overridable): `writeEvidence` still calls `resolveAll(rows, records)`
  with no options, and none of the five constants appears in `CheckThresholds` or `loadThresholds`.
  AC-20 still fails.
- **AC-3**: `8db5c00`'s title — "one membership rule for what counts as the profile" — resolves the
  `text`/`records` split **inside `appFacts.ts`**, not AC-3's actual subject. `pipeline.ts:149-151`
  is unchanged at `30a236b`: `.filter(([k, v]) => typeof v === 'string' && k !== 'itemsToOmit')
  .map(([, v]) => v).join(' ')` — still a third membership rule that admits `rowKey`, `etag` and
  `timestamp` as prose and joins with a single space. Still fails.
- **ACs 35, 36, 38, 41, 42, 43, 44, 47, 48, 59** and **D-G1/3/5**: unchanged. `PostingAnalysis.jsx`
  did change (99 lines) but from P8.7 arriving via the `origin/main` merge — `grep -n "evidenced\|
  evidenceNote\|sourceLabel"` over it returns no evidence-layer hit, so the JD-step criteria are
  still unmet.

### Revised tally at `30a236b`

**41 pass · 18 fail · 4 not_applicable** (AC-31 moves pass; D-G2 and D-G4 drop off the defect list).
The eighteen failures and the six substantive defects D-A through D-F are, apart from the two
retractions above, exactly as reported.

Every measurement in this addendum was taken on a detached checkout of `30a236b` with a fresh `tsc`
build. The tree was returned to `claude/qc-p8-3-verify` afterwards and `npm test` re-confirmed at
316/316 for this branch's own snapshot. Nothing was fixed here either.

---

## ADDENDUM 2 — re-verification of the fix commit `30bb129`

`30bb129 fix(qc-p8.3): the defects the independent verifier found — including the 75% still on screen`
landed on `claude/qc-p8-3-evidence` in response to this report. A fix that answers a verification is
not verified by the fact that it was written, so every defect above was re-measured on a detached
checkout of `30bb129`, and every guard the commit adds was revert-proofed the same way §1 did.

**Baseline at `30bb129`:** `api` build exit 0, **330/330 · 0 fail · 0 skipped**; `app` build exit 0,
**149/149 · 0 fail · 0 skipped**.

### Fixed — measured, not accepted

| Defect | Verified how | Result |
|---|---|---|
| **D-C** — the 75% on the rail | Re-ran the cross-consumer probe unchanged against the `30bb129` build | **Fixed.** `RAIL must_have card : total=1 closed=0`, source `0 of 1 closed … (3 more not judged either way)`, and requirements #0/#1/#2 now render **`unmeasured/not measured`** instead of green `closed`. All three surfaces agree: check `0/1`, score `0%`, rail `0/1`. The new `unjudgedSeqs()` reads the excluded rows off the same `#<seq>` offender contract and the same run as the check (`template_reach`, `facts_needed`, `fact_shortfall`), and `classTotal` keeps the class size visible rather than absorbing it. |
| **D-A** — the mis-anchored quote | Re-ran the `İ` probe | **Fixed.** `locate` now returns `char_start = 15` against a true index of 15 and `verbatim = "led the platform modernization programme across four product lines"` — the whole phrase, no truncation, no glued tail. Same for the one-`İ` case (`start = 5`, true index 5). The exact branch now runs a case-insensitive `RegExp` over the **original** string, so `m.index` and `m[0].length` are measured on the string they index. |
| **D-E** — H4b never followed the accusation | Read the case | **Fixed.** H4b now also asserts `!/\bsimilarity\(/.test(stripComments(src('evidence.ts')))`. |
| **D-G1** — fabricated `record_sha256: ''` / `resolver_version: 0` | Read the diff | **Fixed.** `appChecks` now reads `r.evidence_record_sha256`, `r.evidence_resolver_version` and `r.evidence_extra` from the row it had already selected. |
| **D-B** — the tautological guard | Read the comment | **Addressed as asked.** The guard is kept as defence in depth and the comment now says plainly that it "has never rejected anything and structurally cannot today", rather than implying a `refused` population that cannot be non-zero. That is the honest version of the same code. |
| **D-D** — no read-time revalidation | `.claude/DEFERRED.md` | **Deferred and disclosed** as D19, with the symptom stated ("the excerpt renders normally and is a true substring of what the record USED to say") and the reason (reading the profile on every requirements GET is a cost decision). ACs 14 and 22 still fail; they now fail *knowingly*. |

### The new guards are real

Same method as §1 — revert the fix, rebuild, record the assertion.

| Revert | Result |
|---|---|
| **H32** — restore the lower-cased-copy search in `requirements.locate` | **fires.** `AssertionError: pad "İ": offset drifted with the fold`; `actual: 12`, `expected: 11`. 34 pass / 1 fail. |
| **H4b's new half** — import `similarity` into `evidence.ts` | **fires.** `AssertionError: evidence decides coverage, which decides the gate; it must not be decided by a ranking heuristic`. 34 pass / 1 fail. |
| **the rail fix** — `unjudgedSeqs(entries)` → `new Set()` | **fires twice.** `a requirement nothing measured is never CLOSED on the rail (the 75% again)` → `actual: 3, expected: 0`; and `a fact-owned requirement is not counted closed by the rail either` → `actual: 2, expected: 1`. 34 pass / 2 fail; restored, 36/36. |

### The substring claim survives the `locate` rewrite

Changing the exact branch is exactly the kind of change that could break the property §2 established, so
the whole harness was re-run against the `30bb129` build: **637 probes, 591 resolved, 0 substring
violations** — and 591 resolved rather than 557, because the fold fix now anchors correctly in cases
that previously drifted. Reader properties (AC-4/5/6/7/13/21) and the AC-28 identity re-measured
unchanged. H3, H5, H5b and H5c stay green, so AC-51's guarantee — `verbatim` is exactly
`jd_text.slice(char_start, char_end)` — survives the extractor change.

### NEW FINDING — D-H: the threshold fix reaches one of three writers

D-F is **partially** fixed. `evidenceThreshold` and `evidenceMinTokens` are now real
`CheckThresholds` entries with seeded defaults, persisted per owner as `chk_evidence_threshold` /
`chk_evidence_min_tokens` on `owner_search_prefs`, read by `loadThresholds`, and passed into
`writeEvidence` — **from `appChecks.ts:109` only.** There are three call sites:

| Call site | Passes the owner's thresholds? |
|---|---|
| `appChecks.ts:109` — `evaluateArtifact`, the checks hot path | **yes** |
| `appRequirements.ts:306` — `requirementsBackfill` | **no** — `writeEvidence(client, opp.id, profile.records)` |
| `appRequirements.ts:354` — **`POST /api/app/opportunity/{id}/evidence`**, the endpoint whose entire purpose is resolving evidence | **no** — same bare call |

`grep -c loadThresholds api/src/functions/tests/appRequirements.ts` → **0**; the module never loads
them. This is worse than two paths ignoring a setting, because `writeEvidence` **deletes and replaces
every evidence row for the opportunity**: whichever writer ran last wins, so calling the evidence
endpoint silently overwrites the threshold-respecting rows the checks path wrote with default-threshold
ones. The owner's setting is not just unhonoured on those paths — it is destroyed by them. This is the
same shape as D-C ("the fix was applied where the guard looks"), one layer down, and nothing asserts
that the three writers agree.

AC-20 itself remains **fail** on its own terms regardless: it names `MIN_QUOTE_CHARS` and
`MIN_QUOTE_WORDS`, and those (with `DISTINCTIVE_LEN`) are still module constants with no owner path.

### Scope note — the AC's "must NOT touch" list

`AC-P8.3.md` closes with: *"What P8.3 must NOT touch: `requirements.ts` extraction rules and
`EXTRACTOR_VERSION` …"*. `30bb129` changes both — the exact branch of `locate`, and
`EXTRACTOR_VERSION` 1 → 2.

Recording this as a crossing, not as a wrong call. The change fixes a real defect that this
verification found, it is guarded by H32, and every extraction invariant it could have broken (H3, H5,
H5b, H5c) is still green. Two consequences the owner should decide on rather than inherit:

1. `EXTRACTOR_VERSION` is **written and never read** (`grep` finds it only in the `requirement` INSERT
   and the schema column), so the bump changes no behaviour — it is purely a marker. That is what the
   comment claims, and it is accurate.
2. **Nothing re-extracts the version-1 rows.** The live Trinnex requirements were extracted under the
   old rule, so any of them drawn from a posting containing a case-expanding character still carry
   shifted offsets. The marker makes them findable; no backfill makes them correct.

### Revised tally at `30bb129`

**45 pass · 14 fail · 4 not_applicable.** Moved to pass: **AC-19** and **AC-61** (H4b now covers
`evidence.ts`, closing 61(c) — the one quarter of the four that was missing), **AC-32** and **AC-36**
(the rail now reports the judged population and never renders an unjudged row green).

Still failing, unchanged: ACs 3, 14, 20, 22, 23, 33, 35, 38, 41, 42, 43, 44, 47, 48, 59.
**AC-59** in particular is still open for two of its three consumers — `assetGate.js:86` still labels
the check *"Must-haves this document covers"*, which is no longer what it measures, and
`appReviewer.ts:183` still builds `engineJudged` from every must-have row while the check judges only
`coverable`. Both are disclosed by the author as out-of-lane, and the third — the rail — is fixed.

Measurements taken on a detached checkout of `30bb129`; the tree was restored after every revert and
re-confirmed at 330/330 and 149/149. Nothing was fixed in this pass either — D-H is reported, not
patched.

---

## ADDENDUM 3 — PR #13 merged; re-verified against `main` @ `3153f1a`

`claude/qc-p8-3-evidence` was merged: `git merge-base --is-ancestor 30bb129 origin/main` → **yes**.
`main` has since advanced ~30 commits across several lanes, one of which names a finding in this
report. This report rode onto `main` inside the merge — but only as far as Addendum 1; **Addendum 2,
including D-H, is not on `main`**, which is the gap this addendum closes.

Everything below was measured on `main` merged into `claude/qc-p8-3-verify` (no conflicts).
**Baseline: `api` build exit 0, `npm test` 582/582 · 0 fail · 0 skipped; `app` build exit 0,
`npm test` 204/204 · 0 fail · 0 skipped.**

### Everything previously confirmed fixed still holds on `main`

Re-ran every probe unchanged against the merged tree:

- **D-C** — `RAIL must_have card : total=1 closed=0`, source `0 of 1 closed … (3 more not judged
  either way)`, requirements #0/#1/#2 `unmeasured/not measured`. Check `0/1`, score `0%`, rail `0/1`.
- **D-A** — `locate: start=15 end=81`, `verbatim = "led the platform modernization programme across
  four product lines"`, true index 15. No drift.
- **The substring claim** — 637 probes, 591 resolved, **0 violations**.
- **Reader and identity** — determinism, no astral, the code-point/code-unit equality the schema
  CHECK depends on, and `evidenced(1) + no_evidence(1) + unresolvable(0) + fact_owned(3) +
  eligibility(0) = 5 = total` all unchanged.

### D-D is fixed — and the fix is larger than the finding

`edbbdd5 fix(qc): D19 — stored evidence is re-validated on read, and a broken excerpt is withheld`.
`requirementsGet` now re-reads the profile and puts every stored row through a new
`verifyEvidence()`, which recomputes `sha256(rec.text)` against the stored `record_sha256` and
re-slices the record at the stored offsets. The posture is **refuse, do not guess, and say which**: a
rotted excerpt is *withheld*, not caveated, and it is explicitly **not** re-resolved on the read path
(re-ranking is a write, and that route is readable with an unverified `?owner=`).

Revert-proofed: forcing `verifyEvidence` to return `verified` unconditionally makes **8 tests fail**,
including three named H-cases — `H:evidence-reverified-on-read`, `H:stale-evidence-not-absent`,
`H:evidence-verified-at-the-boundary` — with `actual: 'verified', expected: 'stale'`. (The same
revert also produces two `tsc` type errors, so it is guarded twice.) 108 pass / 8 fail; restored and
re-confirmed green.

This closes **AC-14** and **AC-22**, and it goes further than either asked: `EvidenceState` is a
closed enumeration — `none | verified | stale | misresolved | source_missing | unverified` — and the
`stale` / `misresolved` split is a distinction I did not think to ask for. A record that is
byte-identical while its offsets no longer name the quote means *the row was recorded wrong*, not
that the owner edited anything; blaming an edit they never made would be a false statement about
them, and the digest is exactly what separates the two.

**AC-38** also moves to pass: `tallyHealth()` counts each state as its own population, `evidenceHealth`
is served on the requirements payload beside per-row verdicts that name the requirement, and
`HEALTH_BUCKET` **throws** on an unbucketed state rather than letting a new state be silently
miscounted.

### AC-59's two remaining consumers are fixed

- `app/src/assetGate.js:91` now reads **"Must-haves your profile can evidence"** (was "Must-haves
  this document covers", which had stopped being what the check measures).
- `appReviewer.ts:190` now reads `const engineJudged = judgedMustHaveIds(requirements, scoreRow)` —
  no longer every must-have row while the check judges only `coverable`.

With the rail already fixed, all three consumers agree. **AC-59 → pass.**

### D-H survives, is now live on `main`, and has a guard that cannot see it

The one finding that made it through the merge unaddressed.

| Call site on `main` | Passes the owner's thresholds? |
|---|---|
| `appChecks.ts:109` — `evaluateArtifact` | **yes** |
| `appRequirements.ts:441` — `requirementsBackfill` | **no** — `writeEvidence(client, opp.id, profile.records)` |
| `appRequirements.ts:498` — **`POST /api/app/opportunity/{id}/evidence`** | **no** — same bare call |

`grep -c loadThresholds api/src/functions/tests/appRequirements.ts` → **0**. `writeEvidence` still
opens with `delete from requirement_evidence e using requirement r where … r.opp_id = $1`, so it
replaces every row for the opportunity: **calling the evidence endpoint overwrites the
threshold-respecting rows the checks path wrote with default-threshold ones.**

New this pass, and the part worth flagging: a test now exists —
`evidence.test.mjs:288`, `assert.match(appChecks, /writeEvidence\(…threshold: thresholds\.evidenceThreshold/)`
— which asserts the property **at the one call site that was fixed** and is blind to the other two.
That is the inverse of the cry-wolf failure the hardening rules guard against: not a guard that fires
on correct code, but a guard that certifies a property it only partially checks. If the rule is "the
owner's thresholds reach the resolver", the assertion has to be over the writers as a set — the same
"name the core source and grep every consumer" discipline that D-C was about.

### Not re-verified here — Section F has moved under a different spec

`app/src/screens/PostingAnalysis.jsx` now renders a posting-vs-profile `CompareRow` whose profile
cell is *"a `requirement_evidence` excerpt or a confirmed `owner_fact`, named either way"* — P8.4's
**SPEC 4.2** comparison, not AC-42's SPEC 4.1 disclosure-expansion model. It plausibly satisfies the
intent behind ACs 35 and 42–48, but it is a different design, it belongs to a different lane with its
own criteria (`docs/qc-evidence/AC-P8.4.md`, now on `main`), and confirming what it actually renders
needs `ui-verify.yml` against `main`. **I am not claiming those ACs as passed on the strength of
reading a component.** They stay `fail` against P8.3's criteria as written, with that caveat.

`AC-3` is **still fail**, though better factored: `pipeline.ts:93` now exports
`profileFromMasterContext(mc)` — but it was extracted so the remediation loop could reuse it, and it
still carries pipeline's own rule (`k !== 'itemsToOmit'`, joined with `' '`, `rowKey`/`etag`/
`timestamp` admitted as prose) and never calls `profileRecords`. Two rules for "what is the profile"
rather than three; the AC asks for one.

`AC-23` is still fail on its letter, but only just: five of its six named reasons now exist as
read-time states. The missing one is resolve-time — `resolveEvidence` still returns a bare `null` for
a quote below the length or token floor, with no reason attached.

### Corrected tally at `main` @ `3153f1a` — **48 pass · 11 fail · 4 not_applicable**

Moved to pass since `30bb129`: **14**, **22**, **38** (D19), **59** (both remaining consumers).

Still failing: **3, 20, 23, 33, 35, 41, 42, 43, 44, 47, 48** — of which 35 and 42–48 carry the
Section F caveat above. `not_applicable` remains **16, 45, 46, 49**.

**A correction to my own arithmetic.** Addendum 2 reported "45 pass · 14 fail · 4 not_applicable"
while listing fifteen failing criteria — the count and the list disagreed, and the list was right.
Recomputed from the per-criterion table: `8bf2b59` was 39/20/4, `30a236b` 40/19/4, `30bb129` 44/15/4,
and `main` is 48/11/4. The verdict on every individual criterion is unchanged; only the totals were
wrong.

Measured on `claude/qc-p8-3-verify` with `origin/main` @ `3153f1a` merged in. Nothing was fixed in
this pass either — D-H is reported, not patched.

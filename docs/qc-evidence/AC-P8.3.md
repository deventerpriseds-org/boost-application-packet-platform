# P8.3 — Evidence excerpts on every coverage claim (R2): acceptance criteria

Written **COLD** by an independent AC agent against `main` at `f4c2f43`, before any P8.3 code exists
and without sight of any implementation plan. Sources: `docs/qc-evidence/BACKLOG.md` §P8.3 (with
P1.1 / P1.2 / P2.1 / P2.3 for context), `docs/qc-evidence/SPEC.md` R2 and §4.1,
`.claude/QC-EVIDENCE-PLAN.md` §9 row C6, and the code as it stands. Every divergence below was
re-verified against the file and line cited. None is inferred.

Standing directive applied throughout: **default to what is already built; depart only for a NAMED
defect.** Where an AC forces a change to shipped behaviour, the defect is named in the criterion.

---

## What P8.3 actually is

R2 says a requirement is "evidenced" only when a verbatim excerpt **from the candidate's stored
profile** can be shown beside it with its source named. Today the coverage numerator is decided by
`covers()` (`api/src/functions/tests/checks.ts:338-346`) — token overlap against the **generated
artifact's** text (`covText`, `checks.ts:319`). That answers "did words land in the document",
not "does the profile support this". C6 replaces the first question with the second.

So P8.3 is three things, and the third is the one that can go wrong quietly:

1. a **profile record reader** that makes the profile addressable (it is not, today);
2. an **evidence row** per requirement, carrying a quote that resolves into one named record;
3. a **numerator swap** — and everything downstream of that numerator must move with it, or two
   screens will print different coverage for the same packet.

---

## The six criteria that decide whether P8.3 is honest

**P8.3-17 — a quote is resolvable only against the record it NAMES.** Resolving against the
concatenated profile blob, or against "some record", is the P8.3 form of the H16 defect: a citation
of the shape `profileText.includes(quote)` validates a quote pulled from a different job, a
different person's block, or the omission list, and it validates perfectly.

**P8.3-27 — one denominator, published.** `must_have_coverage` today prints
`mustHaves.length - uncovered.length` over `mustHaves.length` on the fail branch (`checks.ts:411`)
and `coverable.length` over `coverable.length` on the pass branch (`checks.ts:414`) — two
denominators in one check, and the score repeats the wider one (`artifactScore.ts:106-108`). Under
C6 that must resolve to a single stated population, with every excluded row counted by name.

**P8.3-34 — "we looked and found nothing" is NOT `not_applicable`.** A readable profile that does
not support a must-have is a determinate gap: the requirement is uncovered, stays in the
denominator, and escalates (R2). Filing it `not_applicable` drops it from the denominator and the
packet reads 100%. `not_applicable` is reserved for "the profile could not be read at all".

**P8.3-38 — an unresolvable quote is an accusation-grade finding, not a downgrade.** A stored
evidence row whose quote is not in the record it names is a fabrication. It is refused, never
rendered (H20), never counted covered, and counted as a finding in its own right — the same
posture `validateCitations` already takes (`reviewer.ts:225-268`).

**P8.3-45 — the employer's words and the candidate's words never share a container.** The JD row
already renders one blockquote labelled "The employer's words, characters X-Y of the posting"
(`app/src/screens/PostingAnalysis.jsx:52-63`). The profile excerpt is a second, differently
labelled quote. A screen where the two are indistinguishable is worse than no evidence layer.

**P8.3-52 — the composite stays null.** Recomputing `must_have_coverage` from evidence must not
give `keyword_coverage` or `seniority_alignment` a value they do not have (H7; the DB CHECK at
`schema.ts:463` enforces it).

---

## Definitions the acceptance sentence depends on (and does not supply)

The backlog's acceptance is *"an evidence quote is a substring of the stored profile record it
names."* Three of those words have no referent in the code today. The ACs below use these
definitions; a builder who uses different ones is building a different feature.

**PROFILE RECORD.** One named, individually addressable unit of the candidate's stored profile,
with a stable identifier, a stable position in a stable ordering, and text that is persisted (not
re-fetched). Today the profile is **one concatenated string** — `sourceText()` returns
`{ text, sources }` where `text` is `parts.join('\n\n')` and `sources` is coarse labels like
`MasterContext (14 blocks)` (`appFacts.ts:28-53`). **No record is named, so nothing today can
satisfy the acceptance sentence as written.** The 15 MasterContext keys (`mt13.ts:12-17`) are the
natural record grain; the resume template is a second source with its own problem (see D-4).

**RESOLVABLE.** A quote is resolvable when, at read time, it is located inside the current stored
text of the specific record its `source_label` names, at the offsets it recorded, by an exact
whitespace-tolerant match — the rule `findQuoteSpans` already implements (`reviewer.ts:203-215`).
Not resolvable: located in a different record; located only in the concatenation; located only
after fuzzy/similarity matching (H4, H4b); located in a record whose stored text has changed since
the offsets were measured.

**EVIDENCED.** A requirement with **at least one** resolvable evidence row. The backlog writes
`requirement.evidence` in the singular; SPEC §5 types it `evidence: {...} | null`; but the
acceptance sentence counts "requirements with **a** resolvable evidence quote", which is a
one-to-many with an existence test. One-to-many is the shape.

---

## A. The profile reader — extend, do not duplicate

1. Given the codebase before P8.3, when `grep -rn "MasterContext" api/src/functions/tests/*.ts` is
   run, then exactly **two** profile-prose readers exist (`appFacts.ts:46-49`,
   `pipeline.ts:149-151`); after P8.3 the count of profile-prose readers is **not greater than two**,
   and no third construction of profile text from MasterContext entries exists anywhere.
2. Given `sourceText()` is module-private (`appFacts.ts:28`, no `export`), when P8.3 needs profile
   text, then it obtains it from that same function made exported — not from a new function that
   re-reads `TableClient.fromConnectionString(CONN, 'MasterContext')` and re-implements the block
   filter.
3. Given the two existing readers disagree about what the profile IS — `appFacts.ts:47` excludes
   `odata*`, `partitionKey`, `rowKey`, `etag`, `timestamp` and joins with `\n\n`, while
   `pipeline.ts:150` excludes only `itemsToOmit` and joins with `' '` — when P8.3 records offsets,
   then those offsets index a reader whose membership and separator are pinned in exactly one place,
   and the other call site reads the same function (named defect: two profiles of different length
   and different content are both called "the profile", so an offset into one is meaningless
   against the other).
4. Given `itemsToOmit` is the owner's do-not-use list, when the reader enumerates records, then
   `itemsToOmit` is absent from the record set, and no evidence row may name it as a source
   (regression on `appFacts.ts:47` / `pipeline.ts:150`).
5. Given the reader returns records rather than a blob, when it is called, then it returns an
   ordered array of `{ record_id, kind, label, text }` with a deterministic order that does not
   depend on `Object.entries` iteration order of a Table entity, and calling it twice on unchanged
   storage returns byte-identical records in identical order.
6. Given each record's text will be indexed by character offsets, when the reader returns it, then
   the text contains no astral (non-BMP) characters, so a JS offset equals a Postgres `substring`
   offset (the H2 invariant, currently guaranteed only for posting text).
7. Given the resume template is fetched live over Google OAuth (`appFacts.ts:32-34`), when the
   fetch fails, then `sourceText`'s existing behaviour is preserved — the failure is recorded in
   `sources` as `resume template UNREADABLE: ...` (`appFacts.ts:35`) — and every record derived from
   it is **absent**, never empty-string, so no requirement can be evidenced against a record that
   was not read.
8. Given a rule module must be testable without Azure or a database (H12), when P8.3 adds quote
   resolution logic, then that logic lives in a module importing neither `@azure/functions` nor
   `./pgClient`, and that module is added to the H12 list in `api/test/hardening.test.mjs:239`.

## B. The evidence row

9. Given decision D1, when the evidence store is added, then it is a table declared in
   `SCHEMA_SQL` **and** listed in `EXPECTED_TABLES` (`schema.ts:571-576`), and the H11 test
   (`hardening.test.mjs:223`) is extended to include it — not an ad-hoc `ensure*()` ALTER.
10. Given a requirement may be evidenced by more than one record, when evidence is stored, then the
    store permits N rows per requirement and a uniqueness constraint prevents the same
    (requirement, record, offsets) triple being stored twice.
11. Given the backlog's field list, when a row is written, then it carries `quote`, `source_kind`,
    `source_label`, `extra`, `char_start`, `char_end`, and the id of the record the offsets index.
12. Given `source_kind` is an enum, when a row is written, then its value is constrained by a DB
    CHECK, and every permitted value maps to a record the reader can actually return (see D-3:
    `certification` maps to no record today and needs a decision before it may be persisted).
13. Given the pairing invariants the requirement spine already enforces (`schema.ts:316-318`), when
    an evidence row is written, then the same three checks hold for it: `char_start is null` iff
    `char_end is null`; `char_start is null` iff `quote is null`; and `char_start >= 0 and
    char_end > char_start`.
14. Given offsets rot when their source text changes — the reason `requirement.jd_text_sha256`
    exists (`schema.ts:312`, written at `appRequirements.ts:44-45`) — when an evidence row is
    written, then it records a hash of the exact record text its offsets index, and a read whose
    recomputed hash differs reports `stale` (mirroring `appRequirements.ts:95`).
15. Given `extra` is undefined in the backlog, when it is populated, then it holds only SPEC §4.1's
    "optional supporting note" and never a second quote, so nothing in `extra` is subject to — or
    escapes — the substring rule.
16. Given the evidence row is derived, not testimony, when a row is created by a model, then the
    row records that provenance, and a model-authored row that fails resolution is refused before
    persistence rather than stored and filtered at read time.

## C. Resolution — the substring rule, made binary

17. Given an evidence row naming record R with offsets [s,e), when the row is validated, then the
    quote is accepted **only if** `R.text.slice(s, e)` matches the quote under the
    whitespace-tolerant exact rule (`findQuoteSpans`, `reviewer.ts:203-215`) — matching anywhere in
    the concatenated profile, or in any record other than R, is a rejection.
18. Given an accepted quote, when it is stored or rendered, then the bytes shown are
    `R.text.slice(s, e)` — the profile's own bytes — and not the model's rendering of them (the H21
    invariant, `reviewer.ts:267`, `hardening.test.mjs:439`).
19. Given `similarity()` exists and rates "Skill number 0" and "Skill number 3" at >0.9 (H4), when
    evidence resolution runs, then no code path from the evidence resolver to the coverage verdict
    calls `similarity()` or any other ranked/thresholded string comparison, and a source-grep
    H-case asserts it (the H4b pattern, `hardening.test.mjs:91-97`).
20. Given a quote short enough to occur by accident, when it is validated, then it is rejected below
    a stated minimum length and word count, reusing the published thresholds
    (`MIN_QUOTE_CHARS = 20`, `MIN_QUOTE_WORDS = 4`, `reviewer.ts:157-158`) rather than a second set
    of numbers, and each threshold remains owner-overridable (no-hardcoded-config rule).
21. Given a quote that occurs more than once inside its named record, when it is validated, then
    resolution is deterministic (the same occurrence is chosen every run) and the chosen occurrence
    is the one at the recorded offsets.
22. Given the record set changes between write and read (owner edits MasterContext), when a stored
    evidence row is read back, then the row resolves against the **current** record text, and a row
    that no longer resolves is reported as unresolvable — not silently re-anchored to a new
    position.
23. Given a rejection, when it is recorded, then it names one reason from a closed enumeration
    covering at least: no profile text readable, record not found, quote too short, quote not in the
    named record, offsets outside the record, record text changed since the offsets were measured
    (the `DropReason` pattern, `reviewer.ts:234-266`).
24. Given a refused quote, when any surface renders the requirement, then the refused text does not
    appear in any stored field or any rendered string (the H20 invariant,
    `hardening.test.mjs:409-430`) — a refused quote must not reach the user through a second door.

## D. C6 — the numerator, and what must NOT change with it

25. Given C6, when `must_have_coverage` is computed, then a must-have counts as covered **only** if
    it has at least one resolvable evidence row; the presence of the requirement's words in the
    generated artifact (`covers()`, `checks.ts:338-346`) no longer makes a requirement covered on
    its own.
26. Given the same C6 change, when a requirement HAS a resolvable evidence row but the artifact text
    does not contain the requirement's words, then the requirement's *evidence* state and the
    *placement* state are reported as two distinct facts, and the one C6 names as the coverage
    numerator is the evidence state.
27. Given today's two denominators (`checks.ts:411` prints over `mustHaves.length`, `checks.ts:414`
    prints over `coverable.length`, and `artifactScore.ts:106-108` divides by `mustHaveTotal`),
    when the check reports, then exactly one population is the denominator on every branch, and
    `observed` states it in words.
28. Given must-haves that the engine deliberately removes from the coverage question — eligibility
    clauses no merge field can carry (`checks.ts:123,395`, `ELIGIBILITY_RE`) and requirements the
    owner's facts own (`checks.ts:393-396`) — when coverage is reported, then each excluded
    population is counted and named separately, and the identity
    `evidenced + no_evidence + unresolvable + fact_owned + eligibility == total must_haves`
    holds exactly for every artifact.
29. Given the fail branch today computes `mustHaves.length - uncovered.length` where `uncovered` is
    drawn from `coverable` only, when P8.3 lands, then eligibility rows and fact-`unknown` rows are
    **not** silently inside the covered numerator (named defect: with 10 must-haves, 3 eligibility
    and 2 genuinely uncovered, `checks.ts:411` and `artifactScore.ts:106` both report 8/10 covered,
    crediting three rows nothing measured — the exact "absent evidence read as pass" failure H6
    exists to prevent).
30. Given `artifactScore.computeArtifactScore` reads `must_have_coverage` from the check rather than
    recomputing it (`artifactScore.ts:86-93`), when P8.3 changes the numerator, then that
    single-source property is preserved — the score still reads the check, and no second
    implementation of the coverage rule appears.
31. Given the `#<seq> ...` offender string is a three-way contract — written at `checks.ts:412`,
    parsed at `artifactScore.ts:102-104`, and parsed again at `app/src/qcRail.js:463-466`
    (`offenderSeq`) — when P8.3 changes what goes into `offenders[]`, then all three sites are
    updated together and a test asserts a round-trip through all three.
32. Given `openSeqs` intersects each asset's uncovered set and requires the check to have actually
    run (`app/src/qcRail.js:470-492`), when coverage becomes evidence-derived and therefore
    identical across all four artifacts of a packet, then the intersection still produces the same
    answer as any single asset, and the rail does not report a packet-level number that disagrees
    with an asset-level one (R4).
33. Given P1.2's term `status` and P2.3's `keyword_coverage`, when C6 moves the *requirement*
    numerator to evidence rows, then the *term* numerator is either moved with it or explicitly left
    on term placement with the difference stated on screen — and in either case
    `keyword_coverage` remains null while no published term library version has scoreable entries
    (`artifactScore.ts:113-117`).

## E. The three absent-evidence states (this is where the house rule bites)

34. Given a profile that was read successfully and contains nothing supporting must-have #N, when
    coverage is computed, then #N is **uncovered**, remains in the denominator, appears in
    `offenders[]`, and `must_have_coverage` is `fail` — it is NOT `not_applicable` (named rule:
    filing a determinate gap as `not_applicable` removes it from the denominator and the packet
    reads 100% covered while a hard requirement is unmet).
35. Given the same requirement, when the JD step renders it, then it renders the literal state
    "no evidence found in your profile" (SPEC §4.1 / backlog P8.3 bullet 2) and offers no expansion,
    because there is nothing to expand to.
36. Given a requirement in that state, when any surface computes a coverage count, then it is not
    counted as covered on any screen, in any check, in any score component, or in any stored row —
    asserted at every consumer, not only at the one the fix was written in.
37. Given the profile could not be read at all — both `sourceText` sources failed
    (`appFacts.ts:35,50`) — when coverage is computed, then `must_have_coverage` is
    `not_applicable` with an `observed` naming the read failure, the score's `must_have_coverage`
    component is `null` (`artifactScore.ts:98-99`), and the gate is `warn`, never `pass` and never
    `fail` (`checks.ts:454-468`).
38. Given an evidence row exists but does not resolve, when coverage is computed, then the
    requirement is not covered, the row is counted in a distinct `evidence_unresolvable` population,
    and that population is reported as a finding with the offending requirement named — never folded
    into "no evidence found", because a fabricated quote and an honest gap need different remedies.
39. Given zero requirement rows for an opportunity, when checks run, then the existing
    `not_applicable` behaviour is unchanged (`checks.ts:349-350`), and P8.3 adds no path by which an
    opportunity with no requirements produces a coverage percentage.
40. Given every check in a run is `not_applicable`, when the gate aggregates, then it is `warn`
    (`checks.ts:467`), and `gateFor([])` is still `warn` (H22, `hardening.test.mjs:467`).
41. Given a requirement whose evidence is absent, when R2's escalation path is considered, then the
    requirement is marked for escalation without overloading `requirement.coverage='escalated'`,
    which already means "the quote could not be located **in the posting**" (`requirements.ts:392`)
    — two populations in one column makes both unreadable (this is P3's D-5 defect, arriving early).

## F. The JD analysis screen (SPEC §4.1)

42. Given a requirement with at least one resolvable evidence row, when its row is rendered on the
    JD step, then the row carries an "evidenced" state and an expansion affordance.
43. Given that row, when the affordance is activated, then the expansion shows the verbatim profile
    excerpt, the named source (`source_kind` + `source_label`), the optional supporting note
    (`extra`), and nothing that was not stored.
44. Given a requirement with no evidence, when its row is rendered, then it shows "no evidence found
    in your profile" and carries no expansion affordance and no green/covered indicator.
45. Given the row already renders the employer's quote (`PostingAnalysis.jsx:52-63`), when the
    profile excerpt is added, then the two quotes are separately labelled — the posting quote keeps
    its "The employer's words, characters X-Y of the posting" provenance line, and the profile
    excerpt names the profile record — and a reader can tell which is which without the ordering.
46. Given a row whose posting quote is absent (`match_method` unlocatable / beyond_model_window /
    no_posting), when profile evidence exists for it, then the existing "Model paraphrase - not a
    quote from the employer, because ..." treatment is preserved (`PostingAnalysis.jsx:65-70`) and
    the profile excerpt does not fill the visual slot the employer's quote vacated.
47. Given `scripts/ui-verify.mjs` supports `CLICK_SEL`, `EXPECT`, `EXPECT_ABSENT`, `COUNT_SEL`,
    when the expansion is built, then it carries `data-qc` hooks in the style already used
    (`data-qc="req-row"`, `data-qc="req-quote"`, `PostingAnalysis.jsx:37,50`) so the expanded state
    is assertable from a GH-runner run, and the AC names the exact `ROUTE` / `CLICK_SEL` / `EXPECT`
    that proves it.
48. Given tab counts must equal the rows inside them (SPEC §4.1 acceptance), when the JD step shows
    an `n/m evidenced` count, then `n` is the resolvable-evidence count and `m` is the same
    denominator AC-27 fixes, and no count on the screen is computed from a second filter.
49. Given `summarizeKindSource` already splits a count by whether the POSTING asserted the filing
    (`app/src/postingAnalysis.js:98-125`), when the evidenced count is displayed, then it is not
    conflated with the `kind_source` split — "3 marked required" and "3 evidenced" are different
    facts about the same three rows.
50. Given nice-to-haves are measured by no check today, and `qcRail.js:449-451` deliberately reports
    them as unmeasured rather than 0/N, when evidence rows exist for nice-to-haves, then either the
    rail's `nice_to_have` card gains a real measure or it stays explicitly unmeasured — it must not
    become an implicit 0/N or N/N by side effect.

## G. Regression guards — what must still be true afterwards

51. Given the requirement spine, when P8.3 has landed, then `buildRequirements` still makes no model
    call, is still deterministic on unchanged input, and every non-null `verbatim` is still exactly
    `jd_text.slice(char_start, char_end)` (`requirements.ts:254`, `hardening.test.mjs` H3/H5/H5c).
52. Given `artifact_score`, when P8.3 has landed, then `composite` is still null unless all three
    components are non-null, no component substitutes 0 for unknown (H7,
    `hardening.test.mjs:164-175`), and the DB CHECK at `schema.ts:463` is unchanged.
53. Given `gateFor`, when P8.3 has landed, then only `deterministic` rows can produce `fail`, a
    reviewer row can only degrade to `warn` (D6, `checks.ts:464-466`), and `must_have_coverage` is
    still read engine-filtered by the score (`artifactScore.ts:93`, H17).
54. Given the existing deterministic checks, when P8.3 has landed, then `skill_char_limit`,
    `changes_cited`, `company_named`, `template_reach`, `facts_settled`, `fact_shortfall` and
    `facts_needed` return identical results for identical inputs to before the change.
55. Given `checkAgainstFacts` returns `unknown` — never `satisfied` — for a missing or unconfirmed
    fact (`ownerFacts.ts:100-113`), when evidence rows exist, then an evidence row cannot promote an
    unconfirmed fact to satisfied, and a fact-owned requirement is not double-reported under both
    `facts_needed` and the evidence surface (the de-duplication at `checks.ts:381-396`).
56. Given `owner_fact.evidence` is free text (`schema.ts:492`) holding strings like
    `largest of 3 figure(s) in the source` (`ownerFacts.ts:265`), when the substring rule is
    introduced, then it is **not** retro-applied to that column — those values are descriptions, not
    quotes, and asserting the rule over them would fail on correct data.
57. Given `npm test` in `api/`, when P8.3 has landed, then every pre-existing assertion still passes
    with no test deleted, weakened, or marked skipped.
58. Given `npm run build` in both `api/` and `app/`, when P8.3 has landed, then both build clean and
    `app.http` registers no duplicate route.
59. Given the "fix all consumers" rule, when the coverage concept changes, then
    `grep -rn "must_have_coverage\|responsibilities_addressed" api/src app/src` lists the consumers
    and each one is shown to agree: `checks.ts`, `artifactScore.ts`, `appChecks.ts:131,201`,
    `appReviewer.ts:175,183,294,304`, `app/src/qcRail.js:447-500`.
60. Given `agreementFor` excludes judgements the deterministic engine never made
    (`reviewer.ts:368-377`, `not_comparable`), when the coverage population changes, then that
    exclusion still holds and reviewer agreement is not manufactured out of newly-silent rows.

## H. Hardening — the mistakes this change can make

61. Given the house rule that a mistake becomes a test, when P8.3 lands, then it adds H-cases (new
    ids, following `hardening.test.mjs`'s format: failure, evidence, invariant) covering at minimum:
    (a) a quote that resolves against the concatenated profile but not against the record it names
    is refused; (b) a readable profile with no support produces uncovered, not `not_applicable`;
    (c) the evidence resolver reaches for no ranking heuristic; (d) an unreadable profile produces a
    null score component, never a zero.
62. Given each new H-case, when it is written, then it records the measured evidence (row counts,
    the actual bad value, the run id) in its comment, strips comments before any source-grep
    assertion (`hardening.test.mjs:31-34`), and does not fire on correct code.
63. Given `.claude/actions.md` and `hardening.test.mjs` point at each other, when the H-cases are
    added, then the corresponding ACT entries are added in the same commit.

---

## SPEC-VS-CODE DIVERGENCES

Each is verified at the file and line cited. Default is to what is built; each departure below needs
a named defect or an owner decision.

| # | The backlog / task text says | Ground truth |
|---|---|---|
| **D-1** | `sourceText()` is "the exported canonical profile reader" | **It is not exported.** `appFacts.ts:28` reads `async function sourceText(...)` with no `export`. It is reachable only from `factsDerive` in the same file. Extending it requires exporting it — which is the correct move, but it is a code change, not a call. |
| **D-2** | "offsets into the profile record" | **There is no profile record.** `sourceText` returns `{ text, sources }` where `text` is `parts.join('\n\n')` (`appFacts.ts:52`) and `sources` is `['resume template <id>', 'MasterContext (N blocks)']` (`appFacts.ts:34,49`). The MasterContext block **keys are discarded** at `appFacts.ts:48` (`.map(([, v]) => v)`). Nothing names a record, so the acceptance sentence is unsatisfiable until the reader is changed to return named records. |
| **D-3** | `source_kind ∈ work_history / accomplishment / profile_field / certification` | **Two of the four map to no record.** MasterContext's 15 fields (`mt13.ts:12-17`) give `work_history` → `workHistory1..4` and `profile_field` → any key. But `coreAccomplishments` is **one prose block**, not a list — so `Accomplishment 3` (SPEC §4.1's own example label) has no referent, and `source_label` can only identify a paragraph or an offset. `certification` is not a record at all: certifications are regex-derived into the `owner_fact` row `education.certifications` (`ownerFacts.ts:200,244-247`). Decide: drop `certification`, or define it as "the profile record the cert text physically occurs in". |
| **D-4** | The profile is "stored" | **Half of it is fetched live and never persisted.** The resume template is read through Google OAuth at request time (`appFacts.ts:32-34`, `templateText(token, RESUME_TEMPLATE_ID, false)`) and its text is stored nowhere. Offsets into it cannot be re-verified later, and if the token fails the source silently disappears (`appFacts.ts:35`). The requirement spine solved exactly this by persisting `opportunity.jd_text` + `jd_text_sha256` (`appRequirements.ts:44-45`); P8.3 needs the same and the backlog does not mention it. |
| **D-5** | Implicitly, one profile | **There are two, and they disagree.** `appFacts.ts:46-49` excludes `itemsToOmit`, `odata*`, `partitionKey`, `rowKey`, `etag`, `timestamp` and joins with `\n\n`. `pipeline.ts:149-151` excludes only `itemsToOmit` and joins with `' '` — so its "profile" contains the row key, the etag and the timestamp as prose. Same name, different bytes, different length. Any offset is meaningless across them. |
| **D-6** | `requirement.evidence` (a field on the requirement) | **Ambiguous, and the acceptance sentence resolves it the other way.** SPEC §5 types it `evidence: {...} \| null` (one), the backlog bullet names five sub-fields as if a column group, but the acceptance counts "requirements with **a** resolvable evidence quote" — an existence test over many. D1 (`schema.ts:571-576`, H11) forces a registered table for the many case. Build the table. |
| **D-7** | "coverage counts recomputed from evidence rows" (C6) | **Evidence rows are per-requirement; requirements are per-opportunity (`requirement.opp_id`, `schema.ts:296`); coverage is judged per-ARTIFACT (`check_result.artifact_id`, `schema.ts:399`) and scored per-artifact (`artifact_score`).** If the numerator becomes evidence-derived, `must_have_coverage` becomes identical across an opportunity's four artifacts, and P2.3's "score each asset separately" loses its only per-asset input. `openSeqs`'s intersection over assets (`qcRail.js:470-492`) becomes a no-op. This is a structural consequence the backlog does not state and it needs an explicit answer. |
| **D-8** | Coverage today is "term placement" | **It is artifact-text token overlap, which is broader and worse.** `covers()` (`checks.ts:338-346`) tests the requirement's content words against `covText` — every populated merge field joined (`checks.ts:223,319`). It is already threshold-hardened (0.7, ≥3 tokens, ≥1 distinctive token, H5b) precisely because it was accusing on overlap. Replacing it wholesale is correct under C6; note that it is the only thing measuring **placement**, so if it is removed, "the requirement is evidenced but the document never says it" becomes unmeasured (see AC-26). |
| **D-9** | Nothing | **The current numerator already credits rows nothing measured.** `checks.ts:411` reports `mustHaves.length - uncovered.length` over `mustHaves.length` while `uncovered` is computed only over `coverable` (`checks.ts:396,407`); `artifactScore.ts:106-108` repeats it with `mustHaveTotal`. Eligibility rows and fact-`unknown` rows therefore count as **covered** in both the check string and the score. This is a live defect inside C6's blast radius and P8.3 must fix it or state that it is deliberately preserved. |
| **D-10** | A requirement with no evidence "cannot be counted as covered" | **True but insufficient — the backlog does not say whether it stays in the denominator.** If it is excluded, coverage reads 100% on a packet with unmet hard requirements; H6 (`hardening.test.mjs:151`) exists for exactly this class. The ACs above (34-37) fix it in the denominator and reserve `not_applicable` for an unreadable profile. |
| **D-11** | `coverage` on `requirement` is free for evidence use | **The column and its `escalated` value are already taken.** `requirements.ts:392` sets `coverage: loc.char_start === null ? 'escalated' : null` at extraction time, meaning "not located in the posting" — nothing to do with profile evidence. `schema.ts:307` permits `covered/partial/escalated`, and **nothing has ever written `covered`**. Writing evidence-derived coverage there merges two populations. |
| **D-12** | SPEC §4.1's source example `Accomplishment 3 · stored library` | **The stored library is empty.** `library_entity` has zero rows, zero write path and zero UI (plan §4, P6 row; it is nonetheless in `EXPECTED_TABLES`, `schema.ts:573`). No evidence row can name it as a source today. |
| **D-13** | The JD step "expands any evidenced row" | **Rows do not expand today.** `RequirementRow` (`PostingAnalysis.jsx:36-79`) renders flat — chip, quote or paraphrase, provenance line, `kind_source` note. There is no disclosure control and no coverage/evidence state anywhere on that screen. This is new UI, not a wiring change. The harness can verify it: `CLICK_SEL` and `EXPECT_ABSENT` landed in `scripts/ui-verify.mjs:16,12` (plan §6's harness gap is closed for this AC set). |
| **D-14** | Implicitly, that a substring test is the whole rule | **A bare substring test is the H16 defect in a new place.** `hardening.test.mjs:292-323` records that `postingText.includes(quote) && requirementExists(id)` accepted a quote lifted from an unrelated part of the document; the fix was to require the quote to land inside the cited requirement's span (`reviewer.ts:255-266`). "Substring of the profile" without "of the record it names" repeats it verbatim. |

---

## Verification vehicles

- **Sandbox** (`cd api && npm ci && npm run build && npm test`) settles every pure-rule criterion:
  1, 3-6, 8, 13, 17-23, 25-30, 33-34, 37-41, 51-58, 61-63.
- **`db-query.yml`** settles the persisted-shape and arithmetic criteria: 9-16, 24, 28, 31, 36 — in
  particular AC-28's identity, which is a single `GROUP BY` over the evidence and requirement tables.
- **`api-test.yml`** settles the live route behaviour: the evidence read endpoint, `stale`
  reporting (AC-14, 22), and the numerator as the deployed engine computes it.
- **`ui-verify.yml`** settles 42-50, using `ROUTE=#/packet/<id>/jd`, `CLICK_SEL` on the row's
  disclosure hook, `EXPECT` for the excerpt and its source label, and `EXPECT_ABSENT` to prove a
  no-evidence row prints no covered indicator. Note: a UI criterion is only claimable once P5's JD
  step is on `main` — do not claim coverage the harness cannot express.
- **Not claimable in the sandbox at all:** anything requiring the real MasterContext or the Google
  template (AC-7's live failure path). Those need `api-test.yml` against the deployed Function.

## What P8.3 must NOT touch

`requirements.ts` extraction rules and `EXTRACTOR_VERSION`; `jdText.ts` normalization; the
`requirement` table's columns and CHECKs; `gateFor`'s precedence; the null-composite rule; the
`#<seq>` offender contract (unless AC-31's three sites move together); and `owner_fact.evidence`'s
free-text meaning.

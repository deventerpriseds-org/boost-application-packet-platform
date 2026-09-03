<!-- WHAT:       Acceptance criteria for SPEC 4.6-8 (swap attribution): exact containment PROPOSES a
     placement claim, a new fourth judge CONFIRMS the causal claim ("Took the place of X"), on the
     same cite-and-verify-byte-exact contract as coverageJudge / stuffingJudge / supportJudge.
     WHY:        Owner's decision, ACT-68f (`.claude/actions.md`, 2026-09-02): two lanes, no overlap,
                 each claiming only what its own evidence supports.
     SUPERSEDES: nothing named in code. Flags one thing that IS superseded in effect: the causal
                 wording `keywordDisplacement`/`keywordDisplacementText` already renders live,
                 unverified and ungated (AC 0 / feasibility row 4).
     SUPERSEDED-BY: nothing -- current.
     EVIDENCE:   docs/qc-evidence/BRIEF-swap-attribution-judge.md, COST-swap-attribution-judge.md,
                 SCOPE-swap-driving-keyword.md, .claude/actions.md ACT-68d/68e/68f,
                 api/test/hardening.test.mjs:5654 (H:attribution-follows-the-posting-line-not-the-keyword),
                 app/test/proposedKeywords.test.mjs:49 (H:keyword-never-reaches-a-count),
                 app/test/assetBlocks.test.mjs:1585-1652 (existing keywordDisplacement tests). -->

# AC — swap attribution: exact PROPOSES, judge CONFIRMS (SPEC 4.6-8)

TIER 1. A stored verdict from this judge is a causal claim shown to the owner beside a "Put back
X" control that rewrites their document. Independent `verifier` pass required after implementation;
every new guard below must be mutation-proven before this ships.

All commands below were re-run against the current tree (`2cdee60`, packet
`2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`, `docs/qc-evidence/fixtures.json`) rather than trusted from
prior write-ups. Two numbers drifted from what `.claude/actions.md` ACT-68d reports (see rows 2-3);
neither drift changes the design.

## Feasibility table

| Dependency | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `swap_decision.requirement_id` -> `requirement` join | `attribute()`, `swaps.ts:224`, written by `writeSwaps` | none reads it for attribution today | Re-derived from `fixtures.json` (`/swaps` latest loop, `/requirements`): 43 total rows, loop 0 is latest, **30 `action='swapped'`, 17 of those carry `requirement_id`** | EXISTS |
| Fuzzy-link quality on those 17 | same | — | Same script: content-token overlap between `requirement.model_keyword` and `to_label` is **zero on 8 of 17** (e.g. `AI governance` vs `Risk Management` at `confidence:1`, `lean governance` vs `Operational Excellence` at `confidence:1`) | EXISTS-BUT-CONSTRAINED — confirms ACT-68d's finding; ~8/17 would be a false "this keyword drove it" claim if the fuzzy link were shown directly. Numbers match ACT-68d exactly. |
| Case-insensitive exact containment (Lane 1's own definition: `model_keyword` verbatim inside `to_label`) | computable from the same two API responses | not computed by any shipped function today (see next row) | Same script, case-INsensitive substring test: **2 of 17** (`global engineering` in `Global Engineering Teams`, and in `Leading Global Engineering Teams`) | EXISTS as a fact; ABSENT as code — see below |
| A causal "Took the place of X" sentence already live in the shipped UI | `keywordDisplacement`/`keywordDisplacementText` (`app/src/assetBlocks.js:591-611`), rendered unconditionally at `app/src/screens/AssetBlocks.jsx:1202` inside the open keyword panel | the reader, today, with no toggle | Read the function: match test is `normLabel(s.to_label) !== k` — **equality of the WHOLE normalized `to_label` against the keyword**, not containment. `keywordDisplacementText` emits `Took the place of ${from} in ${list}.` verbatim, no citation, no model. Tests pinning this exact behaviour exist at `app/test/assetBlocks.test.mjs:1585-1652` and pass today. | **EXISTS-BUT-WRONG.** This is a live precursor to 4.6-8 that already makes the stronger causal claim ACT-68f reserves for judge-confirmed rows, gated by nothing but an accidental equality match. It is not a foundation to extend unmodified — AC 0 below retires its wording. |
| The three-judge shared contract (cite, verify byte-exact, pure module, injected transport, dual version stamps, sha256 NUL-joined cache key) | `coverageJudge.ts`, `stuffingJudge.ts`, `supportJudge.ts` (read in full) | `appCoverage.ts` (impure half) | Read all three headers + bodies | EXISTS, three independent implementations of one contract, safe to extend as a fourth |
| A DDL template for a judge-verdict table (quote+offsets, dual version columns, `covered=(quote is not null)`-shaped CHECK, `EXPECTED_TABLES` registration) | `requirement_coverage` (`api/src/functions/tests/schema.ts`) | `appCoverage.ts` | `grep -n "create table if not exists requirement_coverage" api/src/functions/tests/schema.ts` → present, with matching CHECKs | EXISTS |
| The "key on TEXT, not on a churned id" pattern this table needs | `requirement_coverage.requirement_text`, `evidence_confirmation.requirement_text` — both keyed on text because `writeRequirements` deletes and reinserts `requirement` on every re-extraction | same two tables' own header comments | Read both tables' comments in `schema.ts` | EXISTS as precedent; the new table has the SAME exposure one level down — `writeSwaps` also deletes and reinserts `swap_decision` on every rebuild (`appSwaps.ts` loop-scoped delete), so a verdict FK'd to `swap_decision.id` would churn every pass. See AC 5. |
| An impure-runner precedent (cache-first, capped, "every failure mode yields no verdict, never a negative one") | `runCoverageJudge`/`runStuffingRead`, `api/src/functions/tests/appCoverage.ts` | invoked inline at `appChecks.ts:168,184` inside `evaluateArtifact` — the SCORING pipeline | Read `appCoverage.ts` in full | EXISTS-BUT-CONSTRAINED — the shape is reusable, the CALL SITE is not: this judge must not hang off `evaluateArtifact`, because "no gate/score may read the new verdict" (hard constraint). See AC 8. |
| `H:keyword-never-reaches-a-count` guard | `app/test/proposedKeywords.test.mjs:49` | — | `node --test --test-name-pattern="H:keyword-never-reaches-a-count" app/test/proposedKeywords.test.mjs` → **1 pass** | EXISTS and green today |
| `H:attribution-follows-the-posting-line-not-the-keyword` guard (landed same session, commit `2cdee60`) | `api/test/hardening.test.mjs:5654` | — | `node --test --test-name-pattern="H:attribution-follows-the-posting-line-not-the-keyword" api/test/hardening.test.mjs` → **1 pass** | EXISTS and green today |
| Owner-configurable toggle precedent for a judge | `CheckThresholds.coverageJudge` (`checks.ts:146,217`), default `false` | `runCoverageJudge` | `grep -rn coverageJudge app/src` → **zero results** | EXISTS-BUT-CONSTRAINED — the precedent itself is not wired into Settings. Not this AC pass's defect to fix, but AC 9 below must not silently repeat it for the new toggle. |
| Distinct requirements carrying a `model_keyword`, for shortlist sizing | `requirement.model_keyword` | judge shortlist (AC 3) | Same script: **35** distinct requirement rows carry a non-empty `model_keyword` on this opportunity | EXISTS |

## AC 0 — retire the ungated causal sentence before shipping the new one

1. Given the keyword detail panel open today, when `openKeywordDetail.keyword` resolves via
   `keywordDisplacement`'s equality match, then the panel MUST NOT render `Took the place of X`
   (or any causal wording) unless the row is backed by either a confirmed Lane 1 placement (AC 3)
   or a judge-confirmed verdict (AC 4). The existing equality-based `keywordDisplacement` function
   may be kept internally (its recorded-swap discipline — `action==='swapped'` only, `from !== to`,
   junk-tolerant — is sound and already mutation-proven), but its OUTPUT WORDING and its call site
   in `AssetBlocks.jsx:1202` must be replaced by the two-lane rendering in AC 6, not left reachable
   unmodified.
2. Given a rebuilt keyword panel, when no Lane 1 placement and no judge-confirmed verdict exist for
   the open keyword, then no sentence naming a predecessor item renders at all — silence, not a
   downgraded causal claim.

## AC 1 — Lane 1 (exact containment) computes a PLACEMENT claim, never a causal one, and needs no model

1. Given a `swap_decision` row with `action='swapped'` and a candidate requirement whose
   `model_keyword` is a non-empty, case-insensitive substring of that row's `to_label`, when Lane 1
   evaluates the pair, then it returns a placement result — `{ keyword, to_label, from_label, list }`
   — with no model call and no stored row.
2. Given the same inputs, when the panel renders it, then the sentence is worded as containment,
   not causation — e.g. `"global engineering" is in "Global Engineering Teams", which replaced
   "Agile Transformation"` — and never `Took the place of`.
3. Given `model_keyword` is present in `to_label` but ALSO equals `from_label` after `normLabel`
   folding (the swap replaced text with itself, or the keyword was already there), when Lane 1
   evaluates it, then it returns null — mirroring `H:displacement-never-says-a-term-replaced-itself`.
4. Given the fixture packet `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3` (loop 0, 17 swapped rows with a
   `requirement_id`), when Lane 1 runs over every swapped row's shortlist (AC 3), then it resolves
   exactly the 2 rows measured in the feasibility table and no others — regression-pinned by a test
   fixed to this fixture's counts, not a range.

## AC 2 — the fuzzy `requirement_id` link is demoted to a shortlist input, structurally, not by comment

1. Given the judge module (`attributionJudge.ts`, new), when its exported functions are inspected,
   then none of them accepts a `confidence` field or renders any string containing the substring
   `confidence` — the 0.34 score narrows which requirements are ASKED about; it never appears in a
   verdict or in panel copy.
2. Given `swap_decision.requirement_id` is present but the judge run returns no confirmed verdict
   for that (swap, requirement) pair, when the panel renders the keyword's detail, then no sentence
   attributes the swap to that requirement — the fuzzy link alone is never sufficient to say so,
   matching `H:attribution-follows-the-posting-line-not-the-keyword`.
3. A new guard, behavioural (not a source grep, matching the existing sibling's own reasoning for
   why it must be behavioural): construct a swap row whose `to_label` shares zero content tokens
   with its linked requirement's `verbatim` but scores >= `ATTRIBUTION_THRESHOLD` against it (the
   measured real shape — `AI governance` / `Risk Management`), run it through the shortlist
   builder AND a stub judge transport that always declines, and assert the panel-facing output is
   empty for that pair. Mutation: remove the "shortlist only, never a verdict" step and confirm the
   guard fails.

## AC 3 — the shortlist per swap row is deterministic, bounded, and reproducible

1. Given a `swap_decision` row with `action='swapped'` and a non-empty `to_label`, when the judge
   module builds its candidate shortlist for that row, then the shortlist is the UNION of: (a) the
   requirement referenced by the row's own `requirement_id`, if any, and (b) the top
   `attributionShortlistSize` (new setting, default 5 — see AC 9) requirements for this opportunity
   ranked by raw `similarity(to_label, requirement.verbatim)` with NO threshold filter (ranking
   narrows the SET; it never decides the answer — CLAUDE.md's fuzzy-matching rule), deduplicated by
   requirement id, in ranked order.
2. Given a swap row already resolved by Lane 1 (AC 1) for a given keyword, when the shortlist is
   built for the judge, then that requirement is excluded from the judge's call for that row — Lane
   1's placement is not re-asked (ACT-68f: "the judge does NOT re-check the exact matches").
3. Given a swap row whose shortlist (after excluding Lane-1-resolved requirements) is empty, when
   the judge run considers that row, then NO call is made and no verdict is stored for it — an empty
   shortlist is silence, not a call spent confirming nothing.
4. Given the fixture packet, when the shortlist builder runs over all 30 swapped rows minus the 2
   resolved by Lane 1, then it produces exactly 28 non-empty shortlists (one call each) —
   reproducing the COST doc's sizing exactly; a test pins this count against the fixture.

## AC 4 — the judge's assertion, its citation, and what code verifies

1. Given one swap row and its shortlist of candidate requirements, when the judge is called, then
   it is asked, for EACH shortlisted requirement, whether THIS swap (`from_label` replaced by
   `to_label`) was made because of THAT requirement — one call per swap row, all shortlisted
   requirements in that one call (mirroring `coverageJudge`'s "many requirements against one text"
   batching, applied here as "many candidate requirements against one swap").
2. Given the model asserts a requirement is confirmed, when it answers, then it MUST quote a span of
   `to_label` — never the posting, never `from_label`, never a synthesized string — exactly the
   "you quote our text, never the posting" discipline `stuffingJudge.ts`/`coverageJudge.ts` already
   state in their own system prompts.
3. Given a returned quote, when code parses the verdict, then it is verified with
   `to_label.indexOf(quote)` on the UN-normalised, stored `swap_decision.to_label` value — never a
   synthetic concatenation, never `from_label`. A quote that does not resolve is REFUSED before
   anyone sees it, exactly as `parseCoverageVerdicts`/`parseStuffing` do it.
4. Given a confirmed verdict with no quote, or a quote that fails byte-exact verification, when the
   result is parsed, then it is dropped into a `refused` list with a named reason
   (`confirmed_without_quote`, `quote_not_in_to_label`, `no_reason`, `unknown_requirement`) and is
   never stored as confirmed.
5. Given a shortlisted requirement the model does not mention at all in its answer, when the result
   is parsed, then that pair lands in `unjudged`, never silently treated as declined.

## AC 5 — storage: what survives a rebuild, and what does not

1. Given the same swap content (`from_label`, `to_label`, requirement text, model, judge/prompt
   version) recurs across two different builds of the same packet (where `swap_decision.id` and
   `packet` loop both change), when the judge re-runs, then it produces the SAME `verdict_key` and
   hits the cache — because the key is content-addressed (sha256, NUL-joined:
   `to_label`, `from_label`, `requirement_text`, `model`, `judge_version`, `prompt_version`), never
   built from a database id. Table name: `swap_attribution` (new). Identity anchor: `opp_id`
   (stable across rebuilds), not `swap_decision.id` or `packet_id` — mirroring
   `requirement_coverage`'s and `evidence_confirmation`'s own reasoning almost verbatim: `swap_id`
   would churn on every `writeSwaps` delete+reinsert exactly as `requirement.id` churns on every
   `writeRequirements` re-extraction.
2. Given `packet_id` and an FK to `swap_decision`/`artifact`, when either is included on the new
   table, then they are PROVENANCE ONLY (`on delete set null`), never part of the unique key or any
   lookup used to decide cache hits — same rule `requirement_coverage.artifact_id` already states in
   its own comment.
3. Given a DECLINED verdict (judge considered the pair and said no), when it is parsed, then it is
   STORED, not discarded — `confirmed=false` rows are cached exactly like `confirmed=true` rows, so
   a re-open of the panel after the first judge pass costs zero calls regardless of outcome (COST
   doc: "Cached steady state: 0"). A CHECK enforces `confirmed = (quote is not null)`, mirroring
   `requirement_coverage`'s `check (covered = (quote is not null))`.
4. Given the DDL is added, when it is registered, then `swap_attribution` is added to
   `EXPECTED_TABLES` in `schema.ts`, and any statement naming a column added by an idempotent ALTER
   appears after that ALTER (H39/H39b) — verified by running the table's DDL against a database
   already carrying `main`'s schema plus seeded `swap_decision`/`requirement` rows, per CLAUDE.md's
   "a schema change is not verified until it is EXECUTED" rule, before this ships.

## AC 6 — what the panel renders, for all four states, with no dead UI

1. Given a keyword with no Lane 1 hit and no judge verdict yet (never asked, or an empty shortlist),
   when the panel renders it, then it shows nothing about a predecessor — the existing "counts
   toward nothing" sentence stands alone, unchanged.
2. Given a keyword with a Lane 1 placement only (no judge verdict, or the requirement was excluded
   from the judge per AC 3.2), when the panel renders it, then it shows the containment sentence
   from AC 1.2, worded as placement.
3. Given a keyword with a judge-CONFIRMED verdict, when the panel renders it, then it shows
   `Took the place of X` (or `... in <list>` when the swap's `list` is non-blank, reusing
   `keywordDisplacementText`'s existing null-list handling), sourced from the stored `quote`/`why`,
   with a `Put back "X"` control wired the same way `restoreOptions`' existing seeders work (a
   REQUEST seeded into the field's ask box, unsent — never a silent auto-revert).
4. Given a keyword with a judge-DECLINED verdict (asked, answered, said no) or a REFUSED verdict
   (cited but the citation failed verification), when the panel renders it, then it shows neither
   a placement nor a causal sentence, and both states are indistinguishable from "never asked" to
   the reader — silence must look deliberate, and the distinction between declined/refused/unasked
   is a fact for logs and the cache, not for the owner-facing copy.
5. Given the keyword remains declared NEVER SCOREABLE, when either lane's sentence renders, then the
   existing "counts toward nothing" sentence in the keyword panel is UNCHANGED and continues to
   render beside it — a confirmed displacement claim is about placement in the document, never about
   coverage credit, and the two sentences must not read as contradicting each other.

## AC 7 — no gate, score, or coverage count reads the new verdict

1. Given the implementation lands, when `H:keyword-never-reaches-a-count`
   (`app/test/proposedKeywords.test.mjs:49`) is extended to also scan for the string
   `swap_attribution` (the new table name) inside `checks.ts`, `appChecks.ts`, and
   `artifactScore.ts`, then it passes — none of the three files reference the new table or its
   verdict shape.
2. Given `must_have_coverage` and `evidence_placed` are computed, when their inputs are traced, then
   neither reads `swap_attribution`, the new judge module, or its impure runner — verified by the
   same import-boundary discipline `H12` already enforces for the other three judges (new dedicated
   purity test for `attributionJudge.ts`, following `coverageJudge.test.mjs`'s own pattern: ban
   `@azure/functions`, `from './pgClient'`, `openaiJson`, `fetch(` inside the pure module).
3. Given the new impure runner (`appAttribution.ts`, new — mirroring `appCoverage.ts`), when its call
   sites are searched, then it is NOT invoked from `evaluateArtifact`/`appChecks.ts` (the scoring
   pipeline) — see AC 8 for where it IS invoked.

## AC 8 — trigger: on-demand per row, not eager per packet, and re-runnable over existing packets

1. Given the eager-eval-on-build alternative was considered and rejected: an eager pass would spend
   28 calls on every packet build whether or not the reader ever opens the keyword panel, and it
   would sit inside (or duplicate) the scoring pipeline's call site, in tension with AC 7. DECIDED:
   the judge is invoked LAZILY, scoped to one swap row, when the reader opens that row's keyword
   detail panel (`openKeyword` state in `AssetBlock`) — bounding spend to what is actually viewed.
2. Given the lazy trigger, when it fires, then it is a new route,
   `POST /api/app/packet/{packetId}/swap-attribution` (or equivalent), taking the opened keyword and
   the swap row's content (not a DB id — see AC 5), returning the Lane 1 result immediately (no
   call) and, if Lane 1 found nothing, running the judge for that ONE row's shortlist and returning
   its verdict.
3. Given a packet built before this feature existed (no `swap_attribution` rows at all), when the
   reader opens any keyword panel on it, then the route above answers exactly as it would for a
   packet built after this feature shipped — no separate backfill route, no cron, no migration of
   existing rows required. This is the "re-runnable over existing packets" property, proved by
   running the route against the fixture packet with zero pre-existing `swap_attribution` rows and
   observing a verdict is returned and then persisted.
4. Given the route is called twice for the same swap row and keyword with unchanged content, when
   the second call runs, then it hits the cache (AC 5.1) and makes zero model calls — proved by
   asserting call count via the injected `fetchJson` transport across two sequential invocations in
   a test.

## AC 9 — every threshold is an owner-changeable setting, seeded not hardcoded

1. Given `CheckThresholds` already carries `coverageJudge`/`coverageJudgeMaxCalls`/
   `coverageJudgeMinQuoteChars` as the established pattern for a judge's on/off + cost caps, when the
   new judge is added, then it extends the SAME interface with `attributionJudge: boolean` (default
   `false`) and `attributionShortlistSize: number` (default 5) — a new key on the existing settings
   object, not a parallel settings store ("Extend, don't duplicate").
2. Given the new keys are added to `CheckThresholds`, when `searchPrefsGet().checks` is read by the
   frontend, then both keys are present in the response and are the values the panel's lazy-trigger
   route actually enforces — no literal `5` or `false` inside the route or the judge module.
3. Given the toggle is off (`attributionJudge !== true`, the same guard shape `runCoverageJudge` uses
   for its own flag), when the lazy-trigger route is called, then it runs Lane 1 only (free, no
   model) and returns no judge verdict — mirroring the "OFF" early return `runCoverageJudge` already
   uses, never throwing.
4. Flagged, not required by this AC pass: `coverageJudge`'s own toggle is not wired into any Settings
   screen today (feasibility table, last row). This AC pass's new toggle inherits the same gap unless
   a Settings control is built for it; recorded here so it is not silently repeated as if it were new
   ground, and so the owner can decide whether to close both gaps together.

## AC 10 — cost is bounded and visible

1. Given the fixture packet (30 swapped rows, 2 resolved by Lane 1), when every remaining row's
   keyword panel is opened once each in sequence, then the total judge call count is exactly 28 (one
   per row, per AC 3.4/COST doc), never batched across rows into fewer or spread into more.
2. Given `attributionShortlistSize` bounds the candidates per call, when a shortlist would exceed it,
   then only the top-ranked `attributionShortlistSize` candidates (by raw similarity, per AC 3.1) are
   sent — prompt size is bounded independent of how many requirements the posting has.
3. Given a transport failure, an unparseable response, or any error during the judge call, when the
   route handles it, then it returns "no verdict yet" (same posture as `runCoverageJudge`'s failure
   handling) — never a stored `confirmed=false` fabricated from an error, and never a 500 that takes
   down the rest of the panel.

## Guards this pass must add and mutation-prove (`/workspace/eds-claude-skills/scripts/mutate.sh`)

- A citation-verification guard for the new judge, parallel to `coverageJudge`'s: a verdict whose
  quote is not byte-present in `to_label` is refused (AC 4.3/4.4).
- The extended `H:keyword-never-reaches-a-count` (AC 7.1), asserting the new table name is absent
  from the three scoring/gate files.
- A new purity guard for `attributionJudge.ts` (AC 7.2), mirroring `coverageJudge.test.mjs`'s network
  ban.
- A shortlist-boundedness guard (AC 2.3/3.1) proving the fuzzy `requirement_id` link alone, without a
  judge verdict, never reaches the panel as a claim — the direct descendant of
  `H:attribution-follows-the-posting-line-not-the-keyword`, extended to cover the new module's output
  rather than just `attribute()`'s input.
- A regression guard pinning the fixture's Lane 1 count (2) and shortlist call count (28) against
  `docs/qc-evidence/fixtures.json`, so a future change to `attribute()`, `similarity()`, or the
  containment rule is caught by a number moving, not discovered by re-reading prose.

## What this pass explicitly does NOT touch

- `buildSwaps`, `call3`, and the resume/cover-letter generation prompts — untouched, per the hard
  constraint. Nothing here changes what gets written into `to_label`.
- `must_have_coverage`, `evidence_placed`, `changes_cited`/`unattributed` (the EXISTING gate that
  already reads `swap_decision` at `appChecks.ts:75` for a different purpose) — none of these read
  the new table or module (AC 7).
- `term_library_entry.scoreable` / `requirement.model_keyword`'s NEVER SCOREABLE declaration — the
  judge's verdict is about placement/displacement in the document, never about coverage credit
  (AC 6.5).

---

## 2. ACCEPTANCE CRITERIA

Terms used below, fixed here so each criterion is binary:

- **pair** — one `(swap row, requirement)` question: does the swap's `to_label` answer that
  requirement's posting line? The keyword the panel shows is that requirement's `model_keyword`.
- **eligible row** — a `swap_decision` row with `action = 'swapped'`, a non-empty `from_label`, and
  `normLabel(from_label) !== normLabel(to_label)`. This is the same eligibility
  `keywordDisplacement` already enforces and `H:displacement-never-says-a-term-replaced-itself`
  already pins.
- **citable requirement** — a requirement with a non-null, non-empty `verbatim`. A requirement whose
  posting line was never located has nothing to quote, exactly as `attribute()` (`swaps.ts:227`)
  already refuses to match one.

### A. Lane 1 — exact containment, no model

1. Given a chip whose `model_keyword` appears as a whole-word run inside the `to_label` of an
   eligible swap row for the open field, when the keyword detail panel opens, then the panel renders
   exactly one line under a lane-1 hook naming all three strings — the keyword, the `to_label` that
   contains it, and the `from_label` — and that line contains **neither** the substring
   `Took the place of` nor any word asserting that the requirement caused the replacement.
   *Binary check on the measured packet:* the `skills_1` chip `global engineering` renders a line
   containing `global engineering`, `Global Engineering Teams` and `Agile Transformation`.
2. Given the same input, when presence is decided, then it is decided by the SAME derivation the
   highlight and the chip's present/absent state already use (`markRuns` via `keywordPresence`),
   not by `String.includes` and not by `similarity()`. A unit test asserts that a keyword which is a
   mid-word substring of `to_label` (e.g. `engineer` inside `Reengineering`) yields **no** lane-1
   line.
3. Given an eligible row whose `to_label` equals the keyword exactly after `normLabel`, when the
   panel opens, then it renders the lane-1 line (equality is subsumed by containment) and there is
   **no** second, separately-worded equality path left in the codebase — `grep -c` for a normalised
   `to_label === keyword` comparison in `app/src/assetBlocks.js` returns 0.
4. Given a lane-1 line is rendered, when the packet's stores are inspected, then **no row was
   written to any table** and **no model call was made** for it. Asserted by running the lane-1 unit
   tests with no transport supplied at all.

### B. Lane 2 — the judge, and what it must cite

5. Given a pure module `api/src/functions/tests/attributionJudge.ts`, when the repo is built, then
   the file carries the five-part header (`WHAT / WHY / SUPERSEDES / SUPERSEDED-BY / EVIDENCE`), its
   `SUPERSEDES` line states in words that the exact containment rule **REMAINS** as the cheap half,
   and `H12` passes — the module imports neither `@azure/functions` nor `pg` and every rule in it is
   exercised by tests with an injected transport.
6. Given the model returns a row for a pair, when the parser runs, then the row is accepted **only
   if all** of: (a) its item identifier is one this call asked about — matched by the exact
   identifier handed out, never by re-matching the label text; (b) its requirement `seq` is one this
   call asked about; (c) `why` is non-empty; (d) when it claims a link, `quote` is **byte-present in
   that requirement's `verbatim`** by `verbatim.indexOf(quote)` on the ORIGINAL string — no
   lower-casing, no normalisation, no fuzzy fallback. Any row failing any clause is dropped with a
   NAMED refusal reason and never reaches the screen.
7. Given an accepted linking verdict, when it is stored, then `quote` is the **requirement
   verbatim's own bytes at the found offsets** (`verbatim.slice(at, at + quote.length)`), never the
   model's string, and `char_start`/`char_end` index that `verbatim` — with `length(quote) =
   char_end - char_start` enforced by a DB CHECK, mirroring `requirement_coverage`
   (`schema.ts:590-598`).
8. Given the model quotes the *replacement label* instead of the posting line, when the parser runs,
   then the verdict is refused with reason `quote_not_in_requirement`. The judge cites the
   **employer's words only** — the same rule `swap_decision.verbatim_quote` states in its own
   comment ("the EMPLOYER's words, never a paraphrase") and the reason `to_label` is echoed for
   IDENTITY (clause 6a) but is never the citation.
9. Given a shortlisted requirement whose `verbatim` is null or empty, when the shortlist is built,
   then that pair is **excluded before any call is made** — it can never be cited, so asking about
   it spends a call on an answer the contract must discard. Asserted by a unit test that a
   verbatim-less requirement produces zero pairs.

### C. What is stored, including the negatives

10. Given the judge answers `absent` for a pair (a real answer: this replacement does not answer
    this line), when it is stored, then a row is written with `linked = false`, `quote = null`,
    `char_start = null`, `char_end = null`, a non-empty `why`, and the same version/model/cache-key
    columns — so re-opening the panel re-serves it and never re-asks. A DB CHECK enforces
    `linked = (quote is not null)`.
11. Given a row is REFUSED (clause 6), when the run finishes, then **nothing is stored as a
    verdict** for that pair, the refusal is counted and reported on the run result under its named
    reason, and the pair is reported as unanswered — never recorded or rendered as `absent`.
    "The judge said no" and "the model produced a claim it could not back" are different facts.
12. Given a pair the model returned nothing for, when the run finishes, then it lands in an
    `unjudged` list, is not stored, and the panel treats it identically to never-judged. Absent
    evidence is `not_applicable`, never `linked` and never `absent`.
13. Given the judge is switched off (its `checkPrefs` flag false, the default), or the transport
    throws, or the call cap is reached, when a packet is built, then the run returns an explicit
    off/failed result, **no verdict rows are written**, lane 1 still renders unchanged, and no error
    surfaces in the panel.

### D. What the panel renders — four states, no dead UI

14. Given a chip with a **confirmed** judge verdict for the open field, when the panel opens, then
    it renders exactly one line under a lane-2 hook, distinct from the lane-1 hook, reading
    `Took the place of "<from_label>"` (with the list clause when the row has a list, dropped when it
    does not — the behaviour `H:displacement-text-drops-the-list-clause-rather-than-printing-null`
    already pins), **accompanied by the verified posting quote**. A lane-2 line without its quote
    rendered beside it fails this criterion.
15. Given a chip with a stored `absent` verdict, or no verdict yet, or a refused verdict, when the
    panel opens, then the displacement region renders **nothing at all** — no empty box, no
    placeholder, no disabled control, no spinner — and the panel's other content (the `proposed`
    label, the "counts toward nothing" sentence, the verbatim or its "could not be located"
    fallback, the ask actions) is byte-identical to what it renders today. Silence here is the same
    silence 100% of chips show today, so it cannot read as newly broken.
16. Given a chip that satisfies BOTH lanes, when the panel opens, then exactly **one** line renders
    and it is the lane-1 line. Containment is free, already true, and needs no verdict; showing both
    would state the same fact twice in two different strengths.
17. Given more than one eligible row in the open field is linked to the same keyword, when the panel
    opens, then exactly one sentence renders and the row chosen is deterministic (lowest `seq`, then
    lowest `loop`) — asserted by a test that feeds the rows in reverse order and gets the same
    sentence. On the measured packet `AI governance` maps to three distinct swapped items and
    `global engineering` to two, so this is a live case, not a hypothetical.
18. Given the packet has rows from more than one pass, when the panel builds its displacement line,
    then it reads the LATEST loop's rows only (`latestLoopRows`, `assetBlocks.js:707`), for the same
    reason `omitListCaveat` and `restoreOptions` already do — a sentence about what happened must be
    built from the pass that happened.

### E. `Put back "<original>"` for a swap

19. Given a rendered displacement line (either lane) and an editable artifact, when the panel opens,
    then it offers exactly one `Put back "<from_label>"` control that seeds the field's ask box with
    a request naming both labels, and stores nothing — the same REQUEST shape `restoreOptions` and
    `keywordSwapOptions` already use.
20. Given the artifact is not editable (`canEdit` false — static block, or no artifact id), when the
    panel opens, then **no control renders at all** — not a disabled one. The standing no-dead-UI
    rule, and the behaviour `restoreOptions` already implements.
21. Given the swap's `from_label` would be re-removed deterministically on the next build, when the
    control is considered, then it is **not offered**. Both known deterministic reverters must be
    excluded by the same literals `restoreOptions` already holds — `OMIT_LIST_RATIONALE` (exact) and
    `CROSS_LIST_RATIONALE_PREFIX` (anchored at position 0) — and a test asserts a row carrying
    either produces no control. An earlier version of that function shipped with only the first
    exclusion and the second was a live defect found by an independent pass; a new caller repeating
    the omission repeats the defect.
22. Given the drop-scoped `restoreOptions` already renders `Put back “{label}”` at
    `AssetBlocks.jsx:962`, when the swap-scoped control is added, then it **extends the existing
    function or shares its ask-sentence builder** rather than composing a second `Put back` string
    in the component — `grep -c 'Put back' app/src/screens/AssetBlocks.jsx` does not increase, and
    the ask sentence has exactly one definition site.

### F. The 0.34 link is a shortlist input and nothing else

23. Given the shortlist is built for a packet, when it is assembled, then `requirement_id` (the
    `attribute()` 0.34 token-containment match) and the requirement `kind` may narrow which
    requirements a pair is formed against, and **no `confidence` value, no similarity score, and no
    requirement chosen solely by that match reaches any rendered sentence**. A source guard asserts
    that neither `similarity`, `ATTRIBUTION_THRESHOLD`, nor `confidence` is referenced by the new
    rendering path (comments stripped before the grep, per the precedent in
    `app/test/assetBlocks.test.mjs:35`).
24. Given a pair whose only support is the 0.34 match, when the judge answers `absent` or is not
    run, then the panel says **nothing** about that pair. The measured counter-example is the
    contract: `AI governance` → `Risk Management` scores **confidence 1.000** and shares zero
    content tokens with the keyword; a design that lets confidence speak would print that pairing as
    a finding.

### G. Cache key and re-runnability

25. Given a pair, when its cache key is computed, then it is `sha256` (imported from `evidence.ts`,
    never a second digest) over NUL-joined fields containing **all** of: `JUDGE_VERSION`,
    `PROMPT_VERSION`, `model`, the keyword text, the requirement `verbatim` text, `to_label`,
    `from_label`, and the `list`. Changing any one of those alone produces a different key —
    asserted by a table-driven test that mutates each field in turn and requires eight distinct
    keys.
26. Given the cache key, when it is inspected, then it contains **no** `packet_id`, `opp_id`,
    `loop`, `artifact_id`, `requirement_id`, timestamp, or row id. Those are provenance columns on
    the stored row; putting any of them in the key would make a rebuild pay again for a question
    whose every input is unchanged.
27. Given an existing packet that has never been judged, when the backfill entry point is run
    against it, then verdicts are produced from **stored rows only** — no regeneration, no `call3`,
    no `buildSwaps` invocation. Proven by `git diff --stat` showing zero changes under the
    generation path (`swaps.ts` `buildSwaps`, `pipeline.ts` call3, the generation prompts) plus a
    test that drives the runner with a stubbed transport and a fixture packet and asserts a verdict
    for `AI governance` → `Risk Management`.
28. Given a packet is rebuilt and one list is rewritten, when the judge runs again, then pairs whose
    `to_label`/`from_label`/requirement text are unchanged are served from cache and cost **zero**
    calls; only the rewritten rows are asked. Asserted by a test that runs twice against a counting
    transport and requires the second run's call count to equal the number of changed rows.

### H. Cost and batching shape

29. Given a packet, when the judge runs, then the default is **one request for the whole packet per
    loop** — every eligible replacement item against its shortlisted requirements in that one call.
    A test asserts the counting transport is invoked exactly once for the measured fixture packet
    (15 judgeable pairs: 17 attributed swapped rows minus the 2 settled by containment).
30. Given the assembled payload exceeds the configured cap, when the run batches, then it splits
    **per list** (`skills_1`, `skills_2`, `relevant_1..3`, `expertise`), deterministically and in a
    fixed order, to at most one call per list. A split is an overflow behaviour, never the default,
    and no configuration produces one call per swap row. A test asserts that a packet exceeding the
    cap produces ≤ 6 calls and that the pair set is identical to the unsplit run's.
31. Given the prompt is built, when a pair's question is read, then it is a **per-pair** question
    ("does this replacement answer this posting line — yes with a quote, or absent") and contains no
    cross-pair instruction (no "pick the best", "rank", "choose one", "the most likely"). This is
    what makes clause 25's key sound: if batch composition could change a pair's answer, a cached
    verdict from one batching would be wrong under another. Asserted by a source test on the prompt
    string plus a run asserting the same pair gets the same verdict under one-call and per-list
    batching with the same stub.
32. Given the run is configured, when the caps are read, then the enable flag, the max-call cap and
    the max-pairs-per-call cap are **settings in `checkPrefs`** alongside `chk_coverage_judge*`,
    seeded with defaults, not literals in the judge module — the no-hardcoded-config rule, and the
    same home the three shipped judges already use.
33. Given the cap on pairs per call is reached, when the run finishes, then the unasked pairs are
    reported as **unanswered** (clause 12), never as `absent`. "The cap is silence, not a no" —
    the rule `appCoverage.ts:123` already states for the sibling judge.

### I. Tier-1 wall: nothing scored, nothing gated

34. Given the new verdict table and module exist, when a source sweep runs, then **no scoring,
    gating, or counting module reads them**. The guard is a source test in the shape of the existing
    `H:keyword-never-reaches-a-count` (`app/test/proposedKeywords.test.mjs:49`): the new table name,
    the new module name and the verdict field names are absent from `checks.ts`, `dimensions.ts`,
    the gate assembly and every coverage-count path, comments stripped first.
35. Given the change lands, when `changes_cited` is evaluated, then it reads exactly what it reads
    today — `swap_decision.driver` and `verbatim_quote` — and its result on the fixture packet is
    byte-identical before and after. Asserted by running the existing check against the fixture on
    both sides of the change.
36. Given the change lands, when the `must_have_coverage` and `evidence_placed` populations are
    computed for the fixture packet, then both are byte-identical to their pre-change values. The
    brief's constraint, made checkable.

### J. Schema, and the migration actually executed

37. Given the new table is added to `SCHEMA_SQL`, when the schema is applied to a database that
    ALREADY carries `origin/main`'s schema **and seeded rows**, then it completes with
    `ON_ERROR_STOP=1` and exit 0. A fresh-database run alone does not satisfy this criterion —
    `create table if not exists` is a no-op on the database that matters, and this repo has lost a
    migration to exactly that twice (`schema.ts` records both: the composite FK with no unique
    target, and `create index … (packet_id, loop, …)` before the `ALTER` that adds `loop`).
38. Given any statement in the new block names a column or constraint added by an idempotent
    `ALTER`, when the file is read, then that statement appears **after** the `ALTER`, and any
    `ALTER` appears after its table's `CREATE` — the two-sided ordering rule `H39`/`H39b` already
    encodes.
39. Given the new table carries DB CHECKs, when they are inspected, then they enforce, at minimum:
    `linked = (quote is not null)`, `(quote is null) = (char_start is null)`,
    `(char_start is null) = (char_end is null)`, `char_start is null or (char_start >= 0 and
    char_end > char_start)`, `quote is null or length(quote) = char_end - char_start`, `why <> ''`,
    and a `unique` on `(packet_id, verdict_key)`. No-quote-no-claim is enforced in **both** the
    parser and the database, as `requirement_coverage` does.

### K. Regression guards, and the one that must be mutation-proven

40. Given the four shipped `H:displacement-*` tests, when the work lands, then each is either still
    passing unchanged or **updated in the same commit with its comment stating what changed and
    why** — specifically `H:displacement-text-drops-the-list-clause-rather-than-printing-null`,
    which pins the exact string `Took the place of Digital Transformation in Skills 1.` that clause
    14 moves behind a judge verdict. Silently deleting or weakening one of them fails this
    criterion.
41. Given `H:keyword-never-reaches-a-count` and `H12`, when the suite runs, then both pass unchanged.
42. Given every NEW guard added by this work, when it is mutation-proven with
    `/workspace/eds-claude-skills/scripts/mutate.sh`, then each reports **FIRED** — not `INERT`, and
    not `NOT-APPLIED`. At minimum these three mutations must each be shown to fail the suite:
    (a) replace the byte-exact `verbatim.indexOf(quote)` citation check with a case-insensitive or
    `similarity()`-based comparison; (b) remove the item-identity clause (6a) so an item label the
    call did not ask about is accepted; (c) make the panel render a lane-2 sentence from a stored
    `absent` or refused verdict. A mutation reported as `NOT-APPLIED` means the anchor never matched
    and nothing was tested — it is not a pass.
43. Given a new guard is behaviourally equivalent under its mutation (the mutation correctly fails
    to fail), when that is observed, then it is **said so explicitly** in the evidence file rather
    than claimed as proven.
44. Given the whole change, when `cd api && npm run build && node --test test/hardening.test.mjs`
    and `cd app && npm test` are run, then both complete with zero failures, and the H-case count
    does not decrease.
45. Given a new H-case is added, when it is named, then it uses a two-word-minimum **slug**, never a
    number — `H26` fails the suite on a new numeric id.

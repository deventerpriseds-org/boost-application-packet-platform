# AC — swap attribution: exact PROPOSES, judge CONFIRMS (SPEC 4.6-8)

Independent criteria pass. No source file was modified.

---

## 1. FEASIBILITY — what already exists, measured

### ALREADY BUILT (say it first)

**The "Took the place of X" sentence and its render slot are SHIPPED.**
`keywordDisplacement` / `keywordDisplacementText` (`app/src/assetBlocks.js:591,609`), rendered at
`app/src/screens/AssetBlocks.jsx:1202-1206` under `BLOCK_HOOKS.keywordDisplaced`
(`blocks-keyword-detail-displaced`), guarded by four tests in `app/test/assetBlocks.test.mjs`
(`H:displacement-*`, lines 1598-1651).

This changes the shape of the work in two ways the brief does not account for:

1. **The wording the brief assigns to lane 2 (the judge) is what lane 1 already prints today.**
   `keywordDisplacementText` returns `Took the place of ${d.from} in ${d.list}.` — the causal
   statement — from a purely deterministic match. The brief says the exact lane should be worded as
   PLACEMENT and the causal sentence reserved for the judge. So this is not a greenfield feature: it
   is a **re-wording of a live sentence plus a new second lane**, and the re-wording is itself a
   behaviour change to shipped UI with existing assertions pinned to the old string.
2. **The existing join is exact EQUALITY, not exact CONTAINMENT.** `keywordDisplacement` requires
   `normLabel(s.to_label) === normLabel(keyword)`. The brief's lane 1 is *containment*
   (`model_keyword` appears verbatim **in** `to_label`). Those are different populations, and on the
   measured packet they differ by 2 rows vs 0 rows (below). Lane 1 as the brief describes it is a
   **relaxation of an existing accusation-grade matcher**, not a new function.

### Feasibility table

Unless stated otherwise, every "Proof" below was run in this repo at
`claude/boost-app-setup-approach-6xdoef` (HEAD `3400eac`). The live-DB claims were re-derived from
the checked-in dump `docs/qc-evidence/fixtures.json` (packet `2cb56fb3-…`), not from Postgres — the
`boost-pg-mcp-write` connector is not authorized in this session, so no live query was possible.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| `swap_decision` rows with `from_label`/`to_label`/`action` | `writeSwaps` ← `buildSwaps` (`api/src/functions/tests/appSwaps.ts:71`, `swaps.ts:423`) | `GET /swaps` → `provenance.swaps.swaps` → `scopeSwaps` → `listBodyModel`, `restoreOptions`, `omitListCaveat`, `keywordDisplacement` | `python3` over `fixtures.json['/swaps']['swaps']` → **43 rows**; `Counter({swapped:30, dropped:8, merged:4, added:1})` | **EXISTS** |
| `swap_decision.requirement_id` (the 0.34 fuzzy link) | `attribute()` at `swaps.ts:224` via `ATTRIBUTION_THRESHOLD = 0.34`, resolved to an id in `appSwaps.ts` | `reqsForRow` (`assetBlocks.js:350`) → the requirement chips and `proposedKeywordsForRow` | same dump → **22 of 43 rows carry `requirement_id`; 17 of the 30 `swapped` rows do** | **EXISTS-BUT-CONSTRAINED** — it is a match against the requirement's `verbatim`, never against `model_keyword`; see the two rows below |
| Token overlap between `model_keyword` and `to_label` on attributed swaps | as above (nothing pairs them; the pairing is an accident of the shared `requirement_id`) | nothing today | joined the 17 rows to `requirements[]` by `requirement_id`, tokenised with `swaps.ts`'s own `itemTokens` stoplist → **8 of 17 share ZERO content tokens**, e.g. `AI governance` → `Risk Management` at **confidence 1.000**, `lean governance` → `Operational Excellence` at 1.000, `customer clarity` → `Agile Development` | **EXISTS** (the defect the work exists to fix is real and reproduced) |
| Exact CONTAINMENT of `model_keyword` in `to_label` (brief's lane 1) | — | — | same join → **2 of 17**: `global engineering` ⊂ `Global Engineering Teams` (replaced **`Agile Transformation`**, list `skills_1`) and ⊂ `Leading Global Engineering Teams` (replaced `KPI-driven performance management`, list `expertise`) | **EXISTS** — and the brief's worked example is confirmed verbatim, including the `from_label` |
| Exact EQUALITY of `model_keyword` and `to_label` (what ships today) | — | `keywordDisplacement` | `{normLabel(model_keyword)} ∩ {normLabel(to_label) where action='swapped'}` over the same dump → **0 of 30**. 35 distinct keywords, 30 distinct swapped to-labels, **empty intersection** | **EXISTS-BUT-CONSTRAINED** — the shipped line renders on **zero** rows of this packet. `AssetBlocks.jsx:1187` claims "11 of them joining … exactly" from production run 33687166561; that is a production-wide figure and **does not hold on this packet** |
| `requirement.model_keyword` | jd_table extraction (`requirements.ts`) | `proposedKeywordsForRow`, `proposedKeywordDetail`, `keywordGrade`, `keywordPresence` (`assetBlocks.js:384-437`) | `grep -n model_keyword app/src/assetBlocks.js` → 5 sites; `app/test/proposedKeywords.test.mjs:49` `H:keyword-never-reaches-a-count` asserts it is absent from every scoring/gating module | **EXISTS-BUT-CONSTRAINED** — declared NEVER SCOREABLE (`schema.ts:338`, `requirements.ts:59`); any new derivation inherits that wall |
| The judge contract to extend (header, citation check, versions, cache key) | `coverageJudge.ts` (pure), `stuffingJudge.ts`, `supportJudge.ts` | `appCoverage.ts` (impure half: transport + cache + caps) | read `coverageJudge.ts:1-330`: `JUDGE_VERSION`/`PROMPT_VERSION` (`:38,:48`), `parseCoverageVerdicts` with `text.indexOf(quote)` and six named `VerdictRefusal`s (`:151-215`), `verdictKey` (`:253`) | **EXISTS** |
| Purity rule for a new pure judge module | — | `api/test/hardening.test.mjs:311` `H12: rule modules import neither @azure/functions nor pg` | `grep -n "^import" coverageJudge.ts` → only `./swaps`, `./evidence` | **EXISTS** |
| Verdict table shape to mirror | `writeVerdicts` in `appCoverage.ts` | `readCached`, the UI's lexical-vs-judge comparison | `schema.ts:567-600`: `requirement_coverage` with `quote/char_start/char_end/why/judge_version/prompt_version/model`, `check (covered = (quote is not null))`, `check (quote is null or length(quote) = char_end - char_start)`, `unique (opp_id, verdict_key)` | **EXISTS** |
| An on/off setting + call cap for a judge | `checkPrefs.ts:62-66` (`chk_coverage_judge`, `chk_coverage_judge_max`, `chk_coverage_judge_min_quote`) | `appCoverage.ts:84,91,92` | `grep -n coverageJudge src/functions/tests/checkPrefs.ts` → the columns, defaults and `CheckThresholds` mapping | **EXISTS** — the config-not-hardcoded rule already has a home to extend |
| `Put back "<original>"` for a **swap's** predecessor | — | `restoreOptions` (`assetBlocks.js:754`) offers it for `action === 'dropped'` **only**, minus the two deterministic reverters | read `restoreOptions`: filter is `s.action === 'dropped' && rationale !== OMIT_LIST_RATIONALE && !isCrossListDrop(...)`; `AssetBlocks.jsx:962` renders `Put back “{label}”` | **ABSENT** for swaps — swept both producers (`buildSwaps` writes `swapped` rows with a real `from_label`) and consumers (`grep -rn "restoreOptions\|Put back" app/src app/test` → 3 source sites, all drop-scoped). The control exists; the **swap** case does not |
| Judge verdict reaching a gate/score | `checks.ts:1254-1275` `changes_cited` reads `swap_decision.driver`/`verbatim_quote` only | `runChecks` | `grep -rn changes_cited api/src/functions/tests/*.ts` → 5 sites, none reads a judge verdict | **EXISTS-BUT-CONSTRAINED** — the tier-1 wall the brief demands is currently intact and must be kept so |
| Live Postgres to re-measure against | Azure PG `boost_resume_n_packet_builder` | `db-query.yml`, `boost-pg-mcp-write` | session start reports `boost-pg-mcp-write` **requires authentication**; no query issued | **EXISTS-BUT-CONSTRAINED** — every number above is from the committed dump, not a live read |

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
    does not decrease. Baseline measured for this pass: `node --test app/test/assetBlocks.test.mjs`
    → **90 pass, 0 fail** at HEAD `3400eac`, so any failure after the change is caused by it.
45. Given a new H-case is added, when it is named, then it uses a two-word-minimum **slug**, never a
    number — `H26` fails the suite on a new numeric id.

---

## 3. What the brief gets wrong, and what could not be verified

### Found to be wrong

1. **The brief treats "Took the place of X" as the judge's exclusive wording. It is what the
   DETERMINISTIC lane prints today.** `keywordDisplacementText` (`assetBlocks.js:609`) returns
   exactly `Took the place of ${d.from} in ${d.list}.` and is rendered at `AssetBlocks.jsx:1202-1206`
   from a purely deterministic match. The owner's decision is still coherent, but the work is not
   "add a causal sentence behind a judge" — it is **move a live causal sentence behind a judge and
   re-word the deterministic lane**, which is a behaviour change to shipped UI with four existing
   tests pinned to the old string. Criteria 3, 14 and 40 exist for this.

2. **The brief's lane 1 is CONTAINMENT; what ships is EQUALITY, and on the measured packet equality
   fires zero times.** `keywordDisplacement` requires `normLabel(to_label) === normLabel(keyword)`.
   Over `fixtures.json`, the intersection of the 35 distinct normalised `model_keyword`s and the 30
   distinct normalised swapped `to_label`s is **empty**. The code comment at `AssetBlocks.jsx:1187`
   ("35 distinct swapped TO-labels, 11 of them joining a `requirement.model_keyword` exactly",
   production run 33687166561) is a **production-wide** figure and does not hold on this packet.
   Anyone reading it as "the line already renders on this packet" would be wrong.

3. **The COST doc's "exact containment removes 2 of 30 rows — about 7%" uses the wrong
   denominator.** Only **17** of the 30 swapped rows carry a `requirement_id` at all, so only 17 can
   produce a keyword pairing of any kind. Containment settles 2 of those 17 = **12%**, and the
   judgeable remainder is **15 pairs**, not 28. The "28 calls per packet" backfill figure carried
   forward in `docs/qc-evidence/COST-swap-attribution-judge.md` therefore overstates the population
   by ~87% even before batching. Criterion 29 pins 15.

4. **The brief's file inventory omits the hook the feature needs.** It names
   `blocks-keyword-detail`, `blocks-keyword-actions` and `blocks-keyword-no-action`; the render slot
   for this work is `blocks-keyword-detail-displaced` (`assetBlocks.js:79`), which already exists
   and is already wired.

5. **`Put back "<original>"` is described as if it were a new control.** It exists
   (`restoreOptions`, `AssetBlocks.jsx:962`) but is scoped to `action === 'dropped'` rows only, with
   two deterministic reverters excluded. The swap case is genuinely absent; the *control* is not.
   Criterion 22 requires extending the existing one rather than composing a second `Put back`
   string — the "extend, don't duplicate" rule, and the second exclusion here was already a live
   defect once.

### Confirmed exactly as stated

Every measured claim in the brief's "Measured ground truth" section reproduced from the committed
dump: 43 swap rows; 30 `swapped`; 17 of those carrying `requirement_id`; **8 of 17 sharing zero
content tokens** between `model_keyword` and `to_label`; `AI governance` → `Risk Management` at
confidence **1.000**; **2 of 17** with the keyword present verbatim in `to_label`. The brief's
worked lane-1 example is correct down to the predecessor: `global engineering` ⊂
`Global Engineering Teams`, which replaced **`Agile Transformation`**, in `skills_1`.
`swap_decision.requirement_id` is written from `attribute()` at `swaps.ts:224`, matched against the
requirement's `verbatim` (`swaps.ts:227` skips a requirement without one) at
`ATTRIBUTION_THRESHOLD = 0.34`.

### Could not be verified

- **No live database read was possible.** `boost-pg-mcp-write` reports *requires authentication* in
  this session and a CCR session cannot run the OAuth flow. Every number above comes from
  `docs/qc-evidence/fixtures.json`, a committed dump of packet `2cb56fb3-…`. If that dump is stale
  relative to production, so are these counts. The one query that would settle the production-wide
  version of finding 2 is
  `select count(*) from swap_decision s join requirement r on r.id = s.requirement_id
   where s.action='swapped' and lower(btrim(r.model_keyword)) = lower(btrim(s.to_label));`
- **The prototype at `docs/qc-evidence/qc/assets.jsx:53-88` was not read**, so the brief's claim
  about what the prototype's panel offers is neither confirmed nor contradicted here.
- **Nothing about the judge's actual accuracy is assessed.** These criteria constrain what it may
  claim and what code must verify; whether a model can tell that `Risk Management` does or does not
  answer an `AI governance` line is an empirical question no criteria pass can settle. Criterion 24
  is written so that being unable to tell produces silence rather than a sentence.

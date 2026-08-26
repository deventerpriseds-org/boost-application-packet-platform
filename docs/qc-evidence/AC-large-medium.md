# AC — the large and the two mediums (Group A 4.2-x, Group B 4.3-9/10/11, Group C 4.6-9/10/11)

Written by an independent AC agent, 2026-08-26, on `claude/three-small-ui-gaps`.
**Nothing here is implementation.** Written adversarially: these are the ACs that would catch an
implementing agent writing ACs that flatter its own plan.

Companion to `docs/qc-evidence/AC-three-small.md` (the previous batch, rows 1-3 of
`ACT-2026-08-26-a`). This covers rows 4, 5 and 6 of that same queue:

| # | row | tab | owner's size | state per `.claude/actions.md:3769-3771` |
|---|---|---|---|---|
| 4 | **4.2-1** + partials 4.2-2 / 4.2-4 / 4.2-13 — the four fit cards | 1 posting | large | queued |
| 5 | **4.3-9 / 10 / 11** — QC summary + score bars inside the ATS modal | 1 posting | medium | queued |
| 6 | **4.6-9 / 10 / 11** — keyword-panel escape hatches | 2-5 assets | medium | queued |

Line numbers are as of the working tree at `60edb7f`; every assertion is written to survive a move.

---

## HEADLINE — read this before the tables

Four of the eleven coverage verdicts in this batch are **wrong in a way that changes the work**, and
one whole group is **blocked on data that does not exist**. Stating this first is the point of the
feasibility rule.

| Row | Coverage doc says | What the sweep actually found | Consequence |
|---|---|---|---|
| **4.2-1** | `ABSENT` — "no card grid in `ProfileCompareCard`" | True as far as it goes, and **it hides the real problem: the prototype's four cards are not the app's axis at all.** The prototype groups by requirement **KIND** (`matchRows()`, `data.js:602-614`: responsibility / must_have / nice_to_have / keyword library). The app's comparison rows are role **DIMENSIONS** (Leadership tenure, Organization size, Budget owned, Compliance ownership, …). A card grid over `comparison.dimensions` is **6-8 cards on a different axis**, not the prototype's four. Building "the four cards" means **minting a per-kind coverage count the API does not produce.** | The AC must force a decision — cards over the EXISTING dimension rows (cheap, honest, not the prototype's four) vs. a NEW per-kind coverage number (tier 1, new API work). Not stating this is exactly how the work gets parked mid-build. |
| **4.2-2** | `PARTIAL` — survives per row | Correct. `covered`/`total` per dimension are **API-produced and stored** (`dimensions.ts:430,437,483,511`), served by `comparisonPayload`, already rendered at `PostingAnalysis.jsx:105`. **`EXISTS` for the dimension axis; `ABSENT` for the kind axis.** | Two verdicts, not one — see 4.2-1. |
| **4.2-4** | `PARTIAL` — "does not enumerate the missing items by name" | **WRONG. The app already enumerates the missing lines by name**, with their `#seq` and their text: `dimensions.ts:504` emits `…; no excerpt for: #12 <text>; #14 <text>` and `dimensions.ts:483` names *every* judgeable line for the nothing-found case. It renders today through `POSTING_HOOKS.compareNote`. | **4.2-4 is `ALREADY BUILT` on the dimension axis.** The AC is a **regression guard**, not a feature. Writing a `Missing:` feature here would be a second, divergent enumeration of the same fact. |
| **4.2-13** | `PARTIAL` — button points at extracted lines | **Half-`ALREADY BUILT` since `2de4ae5` (yesterday's batch).** `onOpenQc` is a live prop on `PostingAnalysisCard` (`PostingAnalysis.jsx:485,547-559`) and is already wired at `PacketBuilder.jsx:842` to `setActiveStep('qc')`. `ProfileCompareCard` is the *only* surface still missing it. | **4.2-13 is a two-line reuse** (thread the same prop to the sibling card), *not* new work — with one real hazard the AC names: two "open QC" controls would then sit on one screen. |
| **4.3-11** | `ABSENT **in this surface**` — "a relocation, not a missing component" | Correct, **and cheaper than the row implies.** `GateBadge` is already `export function` (`AssetGateDrawer.jsx:45`) and already imported by **three** files — including `PacketBuilder.jsx:15`, the very file that owns `atsOpen`. It is a shared component, not a local one. | The AC's job here is not to enable reuse — reuse is already possible — it is to **forbid the copy-paste** that the word "relocation" invites, and to settle *which component* owns the modal (see Group B). |
| **4.6-9** | `ABSENT` | **Confirmed absent, and it is absent at the DATA layer, not the UI layer.** There is no skill bank — no route, no table, no selector. See Group C. | 4.6-9's `<select>` would have nothing real to offer. Under the no-fake-data rule this row is **not buildable today**; 4.6-10 and 4.6-11 are. |

**One more thing the coverage doc gets wrong and that must not be inherited.** Row 4.2-1's evidence
cites `Swipe.jsx:211` as one of only two `{n} of {d}` sites in the app. That line is
`{done} of {total} reviewed` — the **swipe-queue progress counter** (`Swipe.jsx:202-204`:
`done = reviewed.size`, `left = queue.length`). It has nothing to do with requirement coverage. It
is a false lead; do not treat it as a precedent to copy.

---

## PART 1 — FEASIBILITY TABLES

### GROUP A — the four fit cards (4.2-1, 4.2-2, 4.2-4, 4.2-13)

**Verdict for the group: `EXISTS-BUT-CONSTRAINED`, and the constraint is which AXIS the cards count.**

**THE ONE CORE SYSTEM: `GET /api/app/opportunity/{id}/requirements`
(`appRequirements.ts:950`, handler `requirementsGet` `:667`) → `req.data` in `PacketBuilder.jsx` →
`ProfileCompareCard({ comparison })` (`PostingAnalysis.jsx:125`) via `comparisonState()`
(`postingAnalysis.js:101`).** One endpoint serves the requirement rows AND the comparison, on
purpose — `appRequirements.ts:696-698`: *"the comparison, from the SAME rows this response already
carries. Served by the ONE endpoint the JD step reads, so a dimension row and a requirement row
cannot come from two queries that disagree (R4)."* **Any new count must come out of that response.**

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command run + result) | Verdict |
|---|---|---|---|---|
| Per-**dimension** `covered` / `total` | `gradeDimensions()` in `api/src/functions/tests/dimensions.ts` — `covered: 1, total: 1` (`:430`), `covered: 0, total: 1` (`:437`), `covered: 0, total: judgeable.length` (`:483`), `covered: evidenced.length, total: judgeable.length` (`:511`). Typed on `DimensionRow` (`:279-280`). Stored, then re-read by `loadComparison` → `comparisonPayload` (`appDimensions.ts:254-265`) | `CompareRow` (`PostingAnalysis.jsx:104-106`): `{r.covered} of {r.total} line(s)` | `grep -n "covered\b\|\btotal\b" api/src/functions/tests/dimensions.ts` → the four emit sites above + the `DimensionRow` fields. `grep -n "comparisonPayload" -A 12 api/src/functions/tests/appDimensions.ts` → returns `{dimensions, summary, set, resolved, stale}`. `grep -n "comparison" app/src/screens/PacketBuilder.jsx` → `:829 comparison={req.data?.comparison}` | **`EXISTS`** — already stored, already served, already rendered |
| The API route that carries it, **owner-scoped** | `requirementsGet` → `resolveOwner(req)` (`appRequirements.ts:669`), then `where id=$1 and owner_email=$2` (`:675-677`) | `app/src/api.js` | `grep -n "requirements" app/src/api.js` — **see the row below; this is the one to check, not assume** | `EXISTS` |
| **Does the JD card's fetch pass `?owner=`?** | — | `api.requirements(id)` at `PacketBuilder.jsx:459` | `grep -n "requirements\|owner=" app/src/api.js` → **`api.js:139`: `` get(`/app/opportunity/${oppId}/requirements?owner=${encodeURIComponent(_owner)}`) ``**, with the comment *"Owner-scoped like every other read: without ?owner= resolveOwner() silently falls back to demo."* | **`EXISTS` — owner-scoped, confirmed by reading the call, not assumed** |
| ⚠ **A duplicate of that call already exists** | — | `api.js:139 requirements` (used by `PacketBuilder.jsx:459`) and `api.js:170 oppRequirements` (used by `AssetBlocks.jsx:68`) are **byte-identical URLs under two names** | `grep -rn "api.requirements\|oppRequirements" app/src` → 3 hits, two callers, two names | **`EXISTS-BUT-CONSTRAINED`** — pre-existing, not caused by this work, but **any new consumer of the comparison must use one of these two, never mint a third** (extend-don't-duplicate) |
| Per-**KIND** coverage (`responsibility` / `must_have` / `nice_to_have`) — *the prototype's actual axis* | **NOBODY.** `requirement.coverage` is typed `'escalated' \| null` with the comment *"never 'covered'/'partial' — no evidence engine exists yet (P2/P3)"* (`requirements.ts:61`) and is only ever written as `coverage: loc.char_start === null ? 'escalated' : null` (`:410`) | Nothing reads it as a coverage count | `grep -rn "coverage" api/src/functions/tests/requirements.ts` → 3 hits, none a covered/total count. `grep -rn "\.coverage\b\|coverage:" app/src --include=*.js --include=*.jsx` → 4 hits, none a per-kind count (`postingAnalysis.js:520,531` are `coverage: null` in the keyword groups; `:541` is the ATS percentage; `assetGate.js:182` is the `must_have_coverage` CHECK label) | **`ABSENT` as a stored number** — **the exact field `matchRows()` counts (`r.coverage === 'covered'`) does not exist in real data** |
| Per-kind coverage, **derivable on the client** | `shapeRequirementsForApi` (`appRequirements.ts:633-661`) returns each row with its `kind` **and** `evidenced: r.evidence_quote != null` (`:636`) | `groupRequirements(rows)` (`postingAnalysis.js:363-374`) already splits `responsibilities` / `mustHaves` / `niceToHaves` | `sed -n '633,662p' api/src/functions/tests/appRequirements.ts`; `grep -n "groupRequirements" -A 12 app/src/postingAnalysis.js` | **`EXISTS-BUT-CONSTRAINED`** — the *inputs* are on the client, but computing a coverage count there violates `PostingAnalysis.jsx:66-69` (*"nothing here is computed in the browser: the grade and the reason are read off the row the API stored, so the number on screen and the number a reviewer can query with one SQL statement are the same number"*) and creates a **fourth** coverage number (see the row below) |
| Whether a fourth coverage number is allowed at all | — | — | `sed -n '435,456p' app/src/postingAnalysis.js` — the module's own D14 note: *"Three systems already measure coverage against the candidate — `requirement_evidence` + the P8.3 resolver, `artifact_score.keyword_coverage` against the published term library, and the P8.4 posting-vs-profile comparison — and `requirements.ts` declares `model_keyword` never scoreable. **A fourth coverage number derived from a model's guess would have to agree with those three and could not.**"* | **`EXISTS-BUT-CONSTRAINED` — this is a standing in-repo prohibition, and it is the single strongest argument against building the prototype's four cards as specified** |
| **`Missing: <named>` — the missing lines enumerated BY NAME** | `gradeDimensions()` `dimensions.ts:504`: `` `; no excerpt for: ${unevidenced.map(label).join('; ')}` `` and `:483`: `` `nothing in your profile evidences the ${judgeable.length} line(s) … : ${judgeable.map(label).join('; ')}` ``, where `label(r) = "#${r.seq} ${text.slice(0,80)}"` (`dimensions.ts:287`) | `CompareRow`'s note span, `data-qc={POSTING_HOOKS.compareNote}` (`PostingAnalysis.jsx:110-119`) — mandatory for every moderate/weak/ungraded row | `sed -n '478,512p' api/src/functions/tests/dimensions.ts`; `sed -n '108,120p' app/src/screens/PostingAnalysis.jsx` | **`ALREADY BUILT`** — the coverage doc's *"it does not enumerate the missing items by name"* is **refuted by the producer's own source** |
| The graded verdict word + colour (4.2-3, cited as BUILT) | `gradeFit(covered, total)` (`dimensions.ts:211-213`), `shortfall` split | `fitLabel()` / `FIT_COLOR` (`postingAnalysis.js:66-89`), rendered `PostingAnalysis.jsx:97-104` | `grep -n "gradeFit" -A 4 api/src/functions/tests/dimensions.ts` | `EXISTS` — reusable by a card verbatim |
| **The ATS-keywords card (the prototype's 4th card)** | `appChecks.ts:128-141`: `scoreable` counts `term_library_entry` rows with `e.scoreable = true and l.published_at is not null`, and the code comment states *"Published, scoreable term-library entries are what keyword coverage needs; **there are none yet**"*. `artifactScore.ts:137-141` returns `{value: null, source: 'no published term-library version has scoreable entries yet'}` when `scoreable <= 0` | `keywordLibraryState(score)` (`postingAnalysis.js:517-545`) — three states, and today's is **`unpublished`**: *"The ATS term library has no published version yet… no coverage number is shown here — **an invented one is worse than none**"* | `grep -rn "scoreable" api/src app/src` → 16 hits; `sed -n '125,145p' api/src/functions/tests/appChecks.ts`; `sed -n '517,545p' app/src/postingAnalysis.js` | **`EXISTS-BUT-CONSTRAINED`, and the constraint bites.** An "ATS keywords **n of m**" card would have `n = null` today. `requirement.model_keyword` is declared *"MODEL-GENERATED … never scoreable"* (`requirements.ts:59`, `schema.ts:338`), so it **cannot** stand in as the numerator. **A card that renders a number here would be fabricated.** |
| **4.2-13 — a prop that opens QC from the JD step** | `setActiveStep('qc')` (`PacketBuilder.jsx:396`) | **Already threaded**: `onOpenQc={() => setActiveStep('qc')}` at `PacketBuilder.jsx:842`, consumed by `PostingAnalysisCard` at `PostingAnalysis.jsx:485` and rendered `:547-559` with `role="button"`, `tabIndex={0}`, `Enter`/`Space`, `POSTING_HOOKS.openQc`, and the sub-line *"opens the coverage list in QC, line by line"* | `grep -n "onOpenQc" app/src/screens/PacketBuilder.jsx app/src/screens/PostingAnalysis.jsx` → 5 hits, none on `ProfileCompareCard` | **`ALREADY BUILT` on the sibling card; `ABSENT` on `ProfileCompareCard` only.** Commit `2de4ae5`. **Cost: one prop + one control, reusing the existing hook pattern.** |
| `ProfileCompareCard`'s existing footer control | — | `PostingAnalysis.jsx:202-207`: `<button>See the lines this was built from</button>`, `onOpenRequirements` → `scrollIntoView('[data-qc="posting-analysis"]')` (`PacketBuilder.jsx:830-834`) | `sed -n '196,210p' app/src/screens/PostingAnalysis.jsx` | `EXISTS` — **and it is the collision risk**: adding `See how the assets answer these →` puts two navigation controls in one footer, one scrolling down and one leaving the step |
| `data-qc` hooks for anything new | `POSTING_HOOKS` (`postingAnalysis.js:52+`) | `app/test/postingAnalysis.test.mjs` asserts every key is rendered, none hand-typed, values unique; `assetGate.test.mjs` unions the four hook maps to catch a cross-screen collision | `grep -n "POSTING_HOOKS" app/src/postingAnalysis.js app/src/screens/PostingAnalysis.jsx` | `EXISTS` — **new keys are mandatory and enforced** |

**Origin check (required before calling this open).**
`grep -rniE "fit card|four card|card grid|4\.2-1\b" .claude/actions.md .claude/DEFERRED.md docs/qc-evidence/PULL-CANDIDATES.md` → **exactly one hit**:
`.claude/actions.md:3769` — `| 4 | **4.2-1** + partials 4.2-2/4/13 — the four fit cards | 1 posting | large | queued |`,
inside `ACT-2026-08-26-a`, whose header records the owner verbatim: *"do the three small ones on tab
6 and tab 1 first and then the large and medium."* **`.claude/DEFERRED.md` has no row. `PULL-CANDIDATES.md` has no row.**

**ORIGIN: the prototype inventory** (`PROTOTYPE-COVERAGE.md:174-187`, and `:674` ranks it *"#3 …
Moderate"*). The owner has asked for **the batch to be worked in this order** — they have *not*
specified the four cards' contents. Per CLAUDE.md: *"a row whose origin is 'the prototype' is a
PROPOSAL and is never something the owner is blocking."* **Nothing is blocked. The axis question
below is a scope decision the owner should make, not a technical blocker.**

**THE SCOPE DECISION THE IMPLEMENTER MUST NOT MAKE SILENTLY.**
There are three candidate builds hiding inside "4.2-1", and they cost wildly different amounts:

- **(A) Cards over the EXISTING dimension rows.** One card per `comparison.dimensions[]` row,
  showing `covered of total`, `fitLabel`, and the existing `note`. **Every number already exists,
  API-produced.** No new count, no new endpoint, no fourth coverage number. It is **not** the
  prototype's four cards — it is 6-8 cards on the dimension axis — and the card grid becomes a
  summary *of the table directly beneath it*, which is a duplication question, not a data question.
  **Tier 2. Small.**
- **(B) The prototype's four cards, faithfully.** Requires a per-KIND coverage count. That number
  does not exist; computing it in the browser breaks `PostingAnalysis.jsx:66-69` and mints the
  fourth coverage number `postingAnalysis.js:445` forbids. Doing it correctly means **new API work
  in `dimensions.ts`/`appRequirements.ts`** so the number is stored and queryable. **Tier 1.
  Genuinely large.** And its fourth card (ATS keywords) **still cannot render a number today.**
- **(C) A 3-card variant** — kinds only, no ATS card — which is (B) minus the unbuildable card.
  Still tier 1, still new API work.

**Recommendation, stated as an inference and not as proof:** (A) is the only branch that is
buildable today without minting a coverage number, and (B)'s fourth card is not honestly renderable
at all until a term-library version is published. **Confidence: high on the data facts (each is
read off the producer); the choice between (A) and (B) is the owner's, and the ACs below are written
to be correct under either.** Every AC that depends on the branch says so explicitly.

**Where the app DIVERGES from the prototype and is BETTER — keep the app's behaviour.**
1. **4.2-4.** The prototype prints `Missing: ${r.missing.map(m => m.competency || m.term).join(', ')}`
   — bare labels, no ids. The app prints `#12 <the posting's own line>` for each unevidenced line,
   *plus* the reason, *plus* the `nothing_found` / `falls_short` split (`postingAnalysis.js:66-81`),
   and makes the note **mandatory** for every moderate/weak/ungraded row. **The app's is strictly
   more informative. Do not regress it to prototype parity.**
2. **The prototype's `FIT_LABEL.weak = 'No evidence'`** (`data.js:583`) is a single word for two
   different findings; the app splits it. Keep the split.
3. **The prototype's own ATS card is fabricated** — `matchRows()` counts a hardcoded `TERM_LIB`
   fixture. The app refuses to print that number. **Keep the refusal.**
4. **4.2-13's label.** `PostingAnalysis.jsx:549-551` already carries the honesty sub-line *"opens
   the coverage list in QC, line by line"* because QC's `pick` filter cannot be set from outside.
   Any new QC control must carry the same disclosure — see AC A.9.

---

### GROUP B — QC summary inside the ATS/tally modal (4.3-9, 4.3-10, 4.3-11)

**Verdict for the group: `EXISTS-BUT-CONSTRAINED` — and it is markedly CHEAPER than the coverage
doc's three `ABSENT`s suggest. Every input is already in the modal's scope or one line from it.**

**THE ONE CORE SYSTEM: `useQcEntries(artifactList)` (`PacketBuilder.jsx:431`) →
`api.artifactChecksResult` → `GET /app/artifact/{id}/checks-result`, read through the selectors in
`app/src/assetGate.js` (+ `qcRail.js`, which re-exports them rather than restating them —
`qcRail.js:12`: *"It EXTENDS ../assetGate.js rather than restating it"*).** That is the same core
system Gap 4.8-10 in the previous batch funnels through. The tally modal must join it, not fetch.

**What the modal is, and what it renders TODAY** — `KeywordTallyOverlay`
(`PostingAnalysis.jsx:679-712`), mounted once for both layouts as `keywordTally`
(`PacketBuilder.jsx:1011-1017`), opened by `atsOpen` (`:402`) from `MatchEstimateButton` (`:714+`):

1. **Match estimate** — a 30px number, `POSTING_HOOKS.matchEstimate`, explicitly labelled *"One
   model's read… It is not keyword coverage, and no applicant tracking system produced it."*
2. **"Coverage against the ATS term library"** → `<KeywordLibraryState score={keywordScore} />`
3. `<ModelKeywords …/>` — the parsed / from-run / thin keyword groups
4. Two buttons: *Rebuild every asset from this posting*, *Go to the resume step*

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command run + result) | Verdict |
|---|---|---|---|---|
| **The score row itself** (`composite`, `band`, `must_have_coverage`, `keyword_coverage`, `seniority_alignment` + each `_source`) | `artifactScore.ts` → stored on `artifact_score`, served inside `checks-result` as `result.score` | **ALREADY INSIDE THE MODAL.** `PacketBuilder.jsx:439-440`: `resumeEntry = qcEntries.find(e => e.artifact.type === 'resume')`; `keywordScore = resumeEntry.result.score` — then passed at `:1014` as `keywordScore={keywordScore}` | `grep -n "keywordScore" -B 8 app/src/screens/PacketBuilder.jsx` → `:440` is the whole `artifact_score` row, **not** a keyword number. `grep -n "KeywordTallyOverlay" app/src/screens/PostingAnalysis.jsx` → `:679` signature takes `keywordScore` | **`ALREADY BUILT` as a data dependency.** `scoreParts(keywordScore)` would work in the modal **with zero new props**. The prop is merely **mis-named** — it is the resume's full score row |
| `scoreParts()` — the three named parts + their `_source` prose | `assetGate.js:382-389` — `[{key:'must', label:'Must-haves evidenced'}, {key:'kw', label:'Keywords present'}, {key:'sen', label:'Seniority fit'}]` | `AssetGateDrawer.jsx:286` (`MatchTab`), `qcRail.js:285` | `sed -n '374,390p' app/src/assetGate.js`; `grep -rn "scoreParts" app/src` → 6 hits across 3 files | **`EXISTS`** — exported, already shared by two screens. **This maps 1:1 onto the prototype's requirements / keywords / seniority.** |
| The composite + band + the **null-composite prose** | `artifactScore.ts`; the rule *"the composite is null unless all three exist"* (`assetGate.js:379-380`) | `MatchTab` (`AssetGateDrawer.jsx:288-301`) | `sed -n '282,320p' app/src/screens/AssetGateDrawer.jsx` | `EXISTS` — **and the null branch is mandatory, not optional**: *"A number built from part of the evidence is the one a reader trusts most and the one most likely to be wrong."* |
| **A rendered BAR component** (the prototype's `ScoreBlock compact`) | — | `MatchTab` (`AssetGateDrawer.jsx:282-325`) renders exactly this: `px-bar` per part, `not measured` Pill for a null part, and `p.source` beneath every part | `grep -n "^export \|^function " app/src/screens/AssetGateDrawer.jsx` → `MatchTab` at `:282` is a **plain `function`, not exported**; the file's exports are the `:32` re-export block, `GateBadge` (`:45`), `TABS` (`:123`) and the default | **`EXISTS-BUT-CONSTRAINED`** — the renderer exists and is **not currently importable**. It is also **tab-shaped** (it renders `Overall` + `What it is made of` + weights + history), so it is not a drop-in "compact" block |
| **`GateBadge`** (4.3-11) | `AssetGateDrawer.jsx:45` — `export function GateBadge({ result, loading, error, onClick, compact })` | **THREE files import it**: `PacketBuilder.jsx:15` (used `:184` on the artifact card and `:947` per asset), `Packets.jsx:7` (used `:140`), and `AssetGateDrawer.jsx` itself (`:509`, `:524`) | `grep -rn "GateBadge" app/src` → 11 hits. **`PacketBuilder.jsx:15` already imports it — the same file that owns `atsOpen` and mounts the modal** | **`EXISTS` — exported and already shared. The coverage doc's "relocation, not a missing component" is correct, and the relocation costs one import (or one already-present import).** |
| Per-asset gate rows to hang the badges on | `useQcEntries(artifactList, …)` (`PacketBuilder.jsx:431`) | `PacketBuilder.jsx:947` already does exactly the prototype's row: `<GateBadge result={(qcEntries.find(e => e.artifactId === a.id) \|\| {}).result} compact />`; `QcRail.jsx` per-asset chips | `grep -n "qcEntries" app/src/screens/PacketBuilder.jsx` → 10 hits, **including `:1011`, the mount point** — so `qcEntries` is in scope where the modal is constructed | **`EXISTS`** — one new prop; **the per-asset row pattern is already written at `:947` and is the thing to extend** |
| **A PACKET-level composite** (the prototype shows one `ScoreBlock` for the whole panel) | **NOBODY.** `artifact_score` is per artifact. The packet-level selectors that exist are `packetGate(entries)` → `'fail'\|'unchecked'\|'warn'\|'pass'` (`qcRail.js:887-895`), `qcStepState` (`:860`), `packetReadiness` (`:964`), `railTotals` (`:168`) — **gate words and counts, never a score** | `PacketBuilder.jsx:1142` renders `packetGate(qcEntries)` on the step circle | `grep -n "export function packetGate\|export function qcStepState\|export function railTotals" -A 12 app/src/qcRail.js` → no composite, no average | **`ABSENT`, and it must stay absent.** The prototype dodges this by scoring ONE type (`<ScoreBlock type="resume" compact />`). **Averaging four artifacts' composites would be a fabricated composite** — the exact thing `assetGate.js:379` and CLAUDE.md's *"Never fabricate a composite"* forbid |
| `Open QC →` from the modal | `setActiveStep('qc')` (`PacketBuilder.jsx:396`) | The modal already closes-and-navigates: `onGoResume={() => { setAtsOpen(false); setActiveStep('resume') }}` (`:1017`) | `sed -n '1011,1018p' app/src/screens/PacketBuilder.jsx` | **`EXISTS` — the exact pattern to copy, one prop, `onGoQc`** |
| `data-qc` hooks | `POSTING_HOOKS` (`postingAnalysis.js:52+`); the modal root is already `POSTING_HOOKS.tally` (`PostingAnalysis.jsx:686`) | `postingAnalysis.test.mjs`, `assetGate.test.mjs` cross-screen union | `grep -n "POSTING_HOOKS.tally" app/src/screens/PostingAnalysis.jsx` | `EXISTS` — new keys mandatory and enforced |

**⚠ THE DUPLICATION THE BRIEF ASKED ABOUT — YES, AND IT IS THE SAME DATABASE COLUMN.**
`KeywordLibraryState` already renders `score.keyword_coverage` in this modal as
*"ATS keyword coverage: N%"* (`postingAnalysis.js:517-545`, mounted `PostingAnalysis.jsx:698-701`).
`scoreParts(score)[1]` is `{key:'kw', label:'Keywords present', value: score.keyword_coverage}` —
**the same field**. Dropping a `ScoreBlock` in unchanged puts one number on one screen twice under
two different names, and the naming rule at `PostingAnalysis.jsx:10-13` (*"'ATS' belongs to the
keyword TERM LIBRARY and its COVERAGE, and to nothing else"*) means the two labels are not even
interchangeable. **AC B.4 forces this to be resolved, not shipped.** A second, quieter duplicate:
the modal's 30px **Match estimate** (a model number) would then sit inches from a **composite**
(a measured number) — two big numbers, different provenance, and `PostingAnalysis.jsx:691` exists
specifically to stop a reader conflating them.

**Origin check.** `grep -rniE "4\.3-9|4\.3-10|4\.3-11|QC Summary|ScoreBlock" .claude/actions.md .claude/DEFERRED.md docs/qc-evidence/PULL-CANDIDATES.md` → the only hit is
`.claude/actions.md:3770` — `| 5 | **4.3-9/10/11** — QC summary + score bars inside the ATS modal | 1 posting | medium | queued |`.
**No `DEFERRED.md` row. No `PULL-CANDIDATES.md` row. ORIGIN: the prototype inventory.**
Per CLAUDE.md this is a **PROPOSAL**; the owner is not blocking on it, and its
`additive`-mode-only framing in the prototype (`packet.jsx:337`, `{additive && (…)}`) means even the
prototype treats it as a mode-gated extra.

**Where the app deliberately DIVERGES from the prototype and is better — keep the app's behaviour.**
1. **The prototype's `ScoreBlock` has no null state.** The app's `MatchTab` refuses to print a
   composite unless all three parts exist and prints prose naming which are missing. **Any compact
   block must keep the null branch** — it is the `Never fabricate a composite` rule rendered.
2. **The prototype's per-asset rows are `['resume','compact_resume','cover','portfolio']` — a
   hardcoded list** (`packet.jsx:344`). The app's equivalent iterates the packet's REAL
   `artifactList` (`PacketBuilder.jsx:947`). **Iterate the real list**; a hardcoded four would show
   gate rows for artifacts a packet does not have, which is `No dead UI` + `no fake data` in one.
3. **The app names WHY a part is missing** (`p.source`) where the prototype shows a bare bar.

---

### GROUP C — keyword-panel escape hatches (4.6-9, 4.6-10, 4.6-11)

**Verdict for the group: SPLIT, and the split is the whole finding.**
**4.6-11 = `EXISTS-BUT-CONSTRAINED` (mechanism built, one sentence in it would be a lie).
4.6-10 = `EXISTS-BUT-CONSTRAINED` (buildable as a REQUEST, never as a persisted decision).
4.6-9 = `ABSENT` at the DATA layer — there is no skill bank to select from.**

**THE ONE CORE SYSTEM: the field's own ask box → `api.aiEditArtifact(artifactId, {instruction, section})`
→ `POST /app/artifact/{id}/ai-edit` (`api.js:217`, sent at `AssetBlocks.jsx:683`).** Every escape
hatch in this group must funnel through that one box. `AssetBlocks.jsx:516-519` states the rule
already: *"opens the field's OWN ask box with that sentence already typed — the same box, the same
`api.aiEditArtifact(..., { section })` route. **Not a second edit path**, and nothing is sent until
the reader presses Send, so the wording stays theirs to edit."*

**The target surface.** The app's equivalent of the prototype's keyword panel is
`BLOCK_HOOKS.keywordDetail` (`AssetBlocks.jsx:836-858`), opened by clicking a chip in
`BLOCK_HOOKS.keywordChips` (`:802-834`). It renders the keyword, the sentence *"A model reading this
posting proposed this keyword for the line below. Nothing has verified that this field contains it,
and **it counts toward nothing**"*, and the posting's verbatim quote or the reason there is none.
**It has no action controls of any kind today.** Confirmed by reading `:836-858` in full, not by a
string grep.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command run + result) | Verdict |
|---|---|---|---|---|
| **`seedAskReword` — the "phrase an assistant request" mechanism** | `AssetBlocks.jsx:520-523` — `setAsk('Reword "…" so it does not repeat the posting's wording.'); setAskOpen(true)` | Rendered as `Tweak this` under every kept posting phrase, `BLOCK_HOOKS.wordingAsk` (`:779-788`), with `role="button"`, `tabIndex={0}`, `Enter`/`Space` | `grep -n "seedAskReword" app/src/screens/AssetBlocks.jsx` → **3 hits: the definition `:520` and two call sites `:782`, `:786` — both inside the *kept-wording* list, none in the keyword panel** | **`EXISTS` — `ALREADY BUILT` as a mechanism, `ABSENT` on this panel.** 4.6-11 is **wiring an existing pattern to a sibling panel**, not new machinery |
| The ask box it opens, and its writer | `askOpen` / `ask` state (`AssetBlocks.jsx:512-515`); Send at `:679-688` → `api.aiEditArtifact(artifactId, {instruction, section: row.merge_field})` | `api.js:217` → `POST /app/artifact/{id}/ai-edit` | `grep -n "aiEditArtifact" app/src/api.js app/src/screens/AssetBlocks.jsx` → `api.js:217`, `AssetBlocks.jsx:683` | `EXISTS` — one route, one box, gated on `artifactId && !isStatic` |
| **A SKILL BANK to populate 4.6-9's `<select>`** | **NOTHING serves a list of skills to choose from.** The nearest real table is `skill_candidate` (`schema.ts:546-558`) — but its rows are *"One candidate row per item in every list, INCLUDING unchanged ones"* for **this packet's five named lists** (`skills_1/2`, `relevant_1/2/3`), `origin in ('profile_original','pass_a','pass_b')`. They are **the labels already in play**, not alternatives on offer | `GET /app/packet/{id}/swaps` (`appSwaps.ts:132`) returns `{candidates, swaps, current, …}`; read by `AssetBlocks.jsx:13` and shaped by `scopeSwaps` (`assetBlocks.js`) | `grep -rniE "skill_candidate\|skill_bank\|skillBank" api/src app/src` → **14 hits, ALL `skill_candidate`; zero `skill_bank`, zero `skillBank`.** `grep -rniE "profile\.skills\|\bskills\b" api/src/functions/tests/schema.ts` → one comment line, no skills table. `sed -n '90,132p' api/src/functions/tests/appSwaps.ts` → the payload is candidates + swap decisions, no catalogue | **`ABSENT`.** The prototype's `SKILL_BANK` is a **57-item hardcoded array in the fixture file** (`docs/qc-evidence/qc/data.js:140-151`). Nothing in the app produces it |
| The other candidate bank — the ATS term library | `term_library_entry` (`schema.ts:233`), `termMiner.ts` | `appChecks.ts:130-141` | `sed -n '125,145p' api/src/functions/tests/appChecks.ts` → *"Published, scoreable term-library entries are what keyword coverage needs; **there are none yet**"*; `AssetBlocks.jsx:844-845` — *"matchesEntry needs a published `term_library_entry` (**the library is off by owner decision**)"* | **`EXISTS-BUT-CONSTRAINED` and unusable today** — the table exists, has no published version, and is **off by an owner decision**. Populating a swap `<select>` from it would offer terms the owner switched off |
| **A WRITER for "drop it, leave the line open"** | **NOTHING.** There is no `keyword_decision` / `keyword_dropped` / `line_open` column, table or route. The only owner-originated persistence near this is `correction` rows with `source='owner_edit'`, surfaced back as `ownerLabels` (`swaps.ts:145-150`, read at `appSwaps.ts:45`) — a record of text the owner **edited**, not of a keyword they **declined** | — | `grep -rniE "skill_candidate\|skill_bank" api/src app/src` (above) plus reading `schema.ts:546-590` (`skill_candidate`, `swap_decision`) — `swap_decision.action` is `kept\|swapped\|merged\|dropped\|added` and is written **only by `buildSwaps`** from a build, never by a UI action | **`ABSENT`.** 4.6-10 can **phrase a request**; it **cannot record a decision**. An implementer who reads "Drop it" as a state change will look for a writer, find `swap_decision.action='dropped'`, and be tempted to write into the pipeline's audit table from the UI — **that would corrupt the build record.** AC C.6 forbids it |
| `driver='owner'` — is there an owner-decision channel at all? | `swaps.ts:279` — `driver: (to && ownerLabels && ownerLabels.has(to)) ? 'owner' : …`, i.e. **inferred on the NEXT build** from the owner's past edits | `appSwaps.ts:123` excludes `'owner'` from `unattributed` | `grep -rn "'owner'" api/src/functions/tests/swaps.ts api/src/functions/tests/appSwaps.ts` → 6 hits, all read-side or inference-side | **`EXISTS-BUT-CONSTRAINED`** — the owner's intent reaches the record **only by editing the text and rebuilding**. That is precisely why routing these controls through the ask box is the correct design, and a direct write would be the parallel system |
| **The coverage consequence the prototype's sentences state** | — | — | `sed -n '836,858p' app/src/screens/AssetBlocks.jsx` — the panel says the keyword *"counts toward nothing"*. `requirements.ts:59` / `schema.ts:338`: `model_keyword` is *"MODEL-GENERATED … **never scoreable**"*. `postingAnalysis.js:445`: a fourth coverage number *"would have to agree with those three and could not"* | **`ABSENT` — and this is the sharpest finding in Group C.** The prototype's sentences promise a coverage effect: *"record the keyword as **uncovered** rather than met"*, *"tell me **which posting line loses its coverage**"*, *"I would rather show a **gap**"* (`assets.jsx:72,82,85`). **In the app these keywords contribute to no coverage number at all.** Copying those sentences would put a false claim in the product, two inches below a sentence that says the opposite |
| `data-qc` hooks | `BLOCK_HOOKS` (`assetBlocks.js:55+`) | `assetGate.test.mjs` cross-screen hook union; the block hook tests | `grep -n "BLOCK_HOOKS" app/src/assetBlocks.js` | `EXISTS` — new keys mandatory and enforced |

**Origin check.** `grep -rniE "4\.6-9|4\.6-10|4\.6-11|skill bank|swap for another|leave the line open" .claude/actions.md .claude/DEFERRED.md docs/qc-evidence/PULL-CANDIDATES.md` → the only hit is
`.claude/actions.md:3771` — `| 6 | **4.6-9/10/11** — keyword panel escape hatches | 2-5 assets | medium | queued |`.
**No `DEFERRED.md` row. No `PULL-CANDIDATES.md` row. ORIGIN: the prototype inventory — a PROPOSAL,
not something the owner is blocking on.** Note also that the app has *already* declined three
neighbouring SPEC §4.6 items for the same reason (`AssetBlocks.jsx:843-847`: *"SPEC 4.6 asks for all
three and NONE has a source… Rendering them would be invention"*). **This group is in that
tradition, and the precedent for declining part of it is set in the file itself.**

**Where the app deliberately DIVERGES from the prototype and is better — keep the app's behaviour.**
1. **The panel's honesty sentence.** *"Nothing has verified that this field contains it, and it
   counts toward nothing."* The prototype instead shows a `MATCH_WORD` grade and a "took the place
   of" line, both of which `AssetBlocks.jsx:843-847` records as undecidable. **Keep the refusal.**
2. **Nothing is sent until the reader presses Send** (`:519`). The prototype's `onAsk` fires the
   request immediately. **Keep the app's confirm step.**
3. **One edit path.** The prototype has `onAsk` as a separate channel; the app deliberately reuses
   the field's own box. **Keep it — a second edit path is the parallel system the rules forbid.**

**What seeding a real skill bank would require (asked for explicitly in the brief).** In dependency
order, none of it small: (i) a source of truth — either publish a `term_library` version and turn
`scoreable` on (an **owner decision that is currently "off"**, per `AssetBlocks.jsx:845`), or add a
per-owner skills table fed from the master profile; (ii) a read route, owner-scoped, carrying
`?owner=` like every other read (`api.js:139`); (iii) an `api.js` client function; (iv) relevance
ordering, or the `<select>` is 57 unranked options; and (v) an answer to *what the swap actually
does* — since the keyword counts toward nothing, "swap" can only mean "ask the assistant to reword
the line", which is **4.6-11 with extra steps**. **Recommendation: do not build 4.6-9. Ship 4.6-10
and 4.6-11, and take 4.6-9 to the owner as the term-library decision it actually is.**

---

## PART 2 — ACCEPTANCE CRITERIA

Binary and observable. Where an AC names a file/line it is the *current* location; the
implementation may move it, but the assertion must survive the move.

### GROUP A — the four fit cards (4.2-1, 4.2-2, 4.2-4, 4.2-13)

**TIER: 1 — accusation grade.** Stated explicitly because the brief asked. The reason is not the
size of the change: **these cards render a COVERAGE COUNT.** `covered`/`total` is the numerator and
denominator of "how much of this posting your profile can evidence"; `gradeFit(covered, total)`
turns it into a verdict word; the same `must_have_coverage` concept decides the artifact gate
(`checks.ts:595` — *"This decides `must_have_coverage`, which decides the GATE, so it is an
accusation-grade test"*). A card that miscounts accuses the candidate of a gap they do not have, or
clears one they do. **Full process: this AC pass, an independent `verifier` after, mutation-proof
every new guard, live verification.**
*(4.2-13 alone, if split out and shipped by itself, is tier 2 — it moves no number. See PART 4.)*

**The branch decision, restated as AC A.0 because it gates everything below.**

**AC A.0 (the axis is chosen and STATED, before any card renders).**
Given the three candidate builds in the Group A feasibility table,
when the PR is opened,
then it names which of **(A) dimension-axis cards**, **(B) the prototype's kind-axis four** or
**(C) kinds-minus-ATS** was built, and — if (B) or (C) — links the API commit that **stores** the
per-kind count.
**It is a FAIL to ship a per-kind coverage number computed in the browser.**
*(Binary check: `grep -nE "\.filter\(.*(evidenced\|kind ===)" app/src/screens/PostingAnalysis.jsx app/src/postingAnalysis.js` returns no new coverage-counting hit attributable to this change. Rationale: `PostingAnalysis.jsx:66-69` — "nothing here is computed in the browser… the number on screen and the number a reviewer can query with one SQL statement are the same number" — and `postingAnalysis.js:445`, which forbids a fourth coverage number outright.)*

**AC A.1 (happy path — the cards exist and are one card per row of the chosen axis).**
Given a resolved comparison (`comparison.resolved === true`, `dimensions.length > 0`),
when the JD step (`#/packet/<id>/jd`) renders,
then a card region carrying a new `POSTING_HOOKS` value is present **above** the comparison table,
and the number of cards **equals the number of rows on the chosen axis** — for branch (A),
`comparison.dimensions.length`; for (B)/(C), the number of kinds with at least one line.
*(Binary and countable live: `count_sel` on the card hook with `count_min`/`count_max` both set to the number resolved from the DB first.)*

**AC A.2 (`n of m` is READ, never recomputed) — the tier-1 AC.**
Given any card,
when its big number renders,
then the numerator and denominator are `row.covered` and `row.total` **taken verbatim from the API
payload**, and for every fixture the card's pair is `assert.deepStrictEqual` to the pair the
corresponding `CompareRow` renders at `PostingAnalysis.jsx:104-106`.
*(Rationale — this is the repo's own named failure mode: a filter added to two screens and not a third, "the KPI shows 51 but the hero still shows 216". The card and the row beneath it are now two consumers of one number and they must not be able to disagree.)*

**AC A.3 (a card with no data says so, and does NOT say zero).**
Given a dimension row with `covered === null` or `total === null` (`dimensions.ts:351` mints exactly
this: `covered: null, total: null` for a `not_applicable` axis),
when its card renders,
then it renders **no `n of m` number at all** and instead shows the row's `reason`.
**It is a FAIL to render `0 of 0`, `— of —`, `null`, or a bar at 0%.**
*(Rationale: `CompareRow` already guards this with `{!na && r.total ? … : null}` (`:104`). Absent evidence is `not_applicable`, never `pass` — and never zero, which reads as a measured failure.)*

**AC A.4 (edge — zero requirements / unresolved comparison).**
Given `comparison.resolved === false` or `dimensions` empty,
when the JD step renders,
then the card region is **absent entirely** and the existing `POSTING_HOOKS.compareEmpty` state
(`PostingAnalysis.jsx:163-167`) renders unchanged with `comparisonState()`'s four distinct
sentences intact.
**It is a FAIL to render an empty card grid, or four cards reading `0 of 0`.**

**AC A.5 (the ATS-keywords card may not invent a number) — the no-fake-data AC.**
Given branch (B) — the prototype's four cards — and `keywordLibraryState(keywordScore).state` of
`'unknown'` or `'unpublished'` (**which is today's state**: `appChecks.ts:130` records *"there are
none yet"*),
when the ATS-keywords card renders,
then it shows **no numerator and no percentage**, and instead shows that state's own sentence
(*"The ATS term library has no published version yet… an invented one is worse than none"*).
**It is a FAIL to count `requirement.model_keyword` as the numerator** — `requirements.ts:59` and
`schema.ts:338` both declare it *"never scoreable"*.
*(Binary check: a unit test feeding `keywordScore = null` and `{keyword_coverage: null}` asserts the rendered model contains no digit-`of`-digit pair for that card.)*

**AC A.6 (4.2-4 — the existing named-missing note is PRESERVED, not replaced).**
Given a dimension row whose `note` contains the enumeration `no excerpt for: #<seq> …`
(`dimensions.ts:504`) or the nothing-found enumeration (`:483`),
when the JD step renders,
then that note **still renders in full** under `POSTING_HOOKS.compareNote`, with its `#seq` ids and
its 80-character line texts intact.
**It is a FAIL to replace it with a shortened `Missing: a, b, c` label, and a FAIL to render a
second, independently-derived list of missing items anywhere on the screen.**
*(Rationale — this is the ALREADY-BUILT row. The coverage doc says the app "does not enumerate the missing items by name"; `dimensions.ts:504` proves otherwise. If a card shows a `Missing:` line at all, it must be the SAME string the API produced, sliced by the API, not re-derived. Two enumerations of one fact is the divergence this repo has been bitten by.)*

**AC A.7 (4.2-4 — the deliberate improvements survive).**
Given a `weak` row,
when its verdict word renders on the card,
then `fitLabel(r.fit, r.shortfall)` is used, so `nothing_found` and `falls_short` still print as
**two different words** (`postingAnalysis.js:66-81`), and `not_applicable` still prints its own.
**It is a FAIL to collapse them to the prototype's single `No evidence`** (`data.js:583`).

**AC A.8 (4.2-13 — the sibling card gets the EXISTING prop, not a new mechanism).**
Given `ProfileCompareCard`,
when the QC control is added,
then it receives `onOpenQc` **threaded from `PacketBuilder.jsx` and calling the same
`setActiveStep('qc')`** already used at `:842`, and `PostingAnalysis.jsx` still imports nothing from
`state.jsx`.
*(Binary check: `grep -n "state.jsx" app/src/screens/PostingAnalysis.jsx` returns nothing, and `grep -c "setActiveStep('qc')" app/src/screens/PacketBuilder.jsx` shows the calls are the same expression, not a second navigation path.)*

**AC A.9 (4.2-13 — the label may not claim more than the control does).**
Given QC's `pick` filter is internal state with no prop and no route segment,
when the new control renders,
then it carries the same honesty disclosure the sibling already carries
(`PostingAnalysis.jsx:558`: *"opens the coverage list in QC, line by line"*), or wording that makes
the same limit clear.
**It is a FAIL to ship `See how the assets answer these →` implying per-line targeting the control
does not have.**

**AC A.10 (4.2-13 — TWO QC controls on one screen is a decision, not an accident).**
Given `PostingAnalysisCard` already renders a QC control (`POSTING_HOOKS.openQc`) and
`ProfileCompareCard` would now render a second, plus its existing *"See the lines this was built
from"* (`:202-207`),
when the JD step renders,
then the PR states whether that is deliberate, **and** either (a) both QC controls render with
distinct labels and distinct `data-qc` hooks, or (b) exactly one renders.
**It is a FAIL for two controls with the same label to appear on one screen** — the duplicate-surface
problem `PacketBuilder.jsx:1006-1010` and `PostingAnalysis.jsx:6-8` both exist to end.
*(Binary and live: `expect_absent` cannot express "appears twice", so this needs `count_sel` on the QC-link hook with `count_max` set to the intended number.)*

**AC A.11 (accessibility parity).**
Given any new control,
then it carries `role="button"`, `tabIndex={0}` and an `Enter`/`Space` handler, matching
`PostingAnalysis.jsx:549-556`.
*(Not boilerplate: `AssetBlocks.jsx:625-632` records a shipped control being reported MISSING because `compare-ui.mjs` collects `button, [role="button"], a` and a bare span was invisible to it.)*

**AC A.12 (hook hygiene, enforced).**
Given the new region,
when `app/test/postingAnalysis.test.mjs`'s *"every POSTING_HOOKS selector is rendered, and the card
hand-types none of them"* and `assetGate.test.mjs`'s cross-screen collision union run,
then both pass: every new key is rendered, no `data-qc` is hand-typed, values are unique across
`QC_HOOKS`/`BLOCK_HOOKS`/`PACKET_HOOKS`/`POSTING_HOOKS`/`GATE_HOOKS`.

**AC A.13 (responsive — the cards must not break the breakpoint rule).**
Given viewport widths of 1440 and 700,
when the JD step renders,
then the existing `compareColumns(vw)` 4-col/1-col rule still reports `data-qc-cols` of `4` and `1`
respectively (`postingAnalysis.js:127-141`, `COMPARE_WIDE_MIN = 900`), and the card grid reflows
without horizontal page scroll.
*(Live-provable: `viewport_w` + `count_sel`/`measure_sel`.)*

**AC A.14 (error state).**
Given `req.error` is set (the requirements fetch failed),
when the JD step renders,
then the card region is **hidden**, not rendered with empty or stale values, and the existing error
path is unchanged.

**REGRESSION GUARD A — the exact existing behaviour that must not break.**
`ProfileCompareCard`'s **comparison table** must remain: the four `COMPARE_COLUMNS` headings
(`postingAnalysis.js:153`, asserted by test to *be* the SPEC's), one `POSTING_HOOKS.compareRow` per
dimension with `data-qc-dimension` and `data-qc-fit`, the *"Model paraphrase - not the employer's
wording"* disclosure, the named profile source per cell, the **mandatory** `compareNote`,
`compareSummary`'s `strong · moderate · weak` line **with `notApplicable` still reported separately
and "not counted either way"**, `compareSetSource` (owner vs seeded), `compareStale`,
`COMPARE_SCOPE_NOTE`, and the *"See the lines this was built from"* button with its
`scrollIntoView` behaviour. Concretely: **`app/test/postingAnalysis.test.mjs` AND `app/test/postingCompare.test.mjs` must both pass
unmodified** — `postingCompare.test.mjs` is the suite dedicated to this exact card, and naming only
the first would leave the comparison's own guards unasserted — and `comparisonState()`'s four
distinct states must remain four distinct strings.

**Config check (Group A).**
- **Real, and it ALREADY EXISTS — extend it, do not add a second.** Which dimensions are compared is
  already a per-owner setting: `POST /app/dimension-prefs` (`appDimensions.ts:334`), read by
  `dimensionsFor(roleFamilyOf(role), stored)`, surfaced as `set.source === 'owner' | seeded`. **If
  branch (A) is chosen, the number of cards is already user-controlled and nothing new is needed —
  say so in the PR.** `appDimensions.ts:295-298` is the standing warning against the alternative:
  *"a stored default with no writer is a constant."*
- **The grading thresholds (`≥0.99` strong, `≥0.7` moderate, `gradeFit` `dimensions.ts:211-213`) are
  NOT config**, deliberately. They are graded server-side and stored on the row; making them
  client-changeable would let the card disagree with the stored `fit`. **Say "none" here on purpose.**
- **A card-count cap / "show more" threshold: add none.** The grid is bounded by the owner's own
  dimension set. If one is added it must be a setting, not a literal.
- **The card labels are NOT config** — they are `row.label` from the dimension catalogue.

**Blast radius (Group A).** Everything reading the comparison payload or the counts it carries, all
of which must still reconcile:
`comparisonPayload` (`appDimensions.ts:254`) → the single `requirementsGet` response;
`comparisonState()` (`postingAnalysis.js:101`) → headline/detail/rows and the four empty states;
`CompareRow` (`PostingAnalysis.jsx:71-122`) → `covered of total`, `fitLabel`, `compareNote`;
`summary` / `summarize()` → the `strong · moderate · weak · not compared` line;
`comparisonStaleness` (`appDimensions.ts:274`) → `compareStale`;
`set` / `dimensionPrefs` → `compareSetSource` **and** the Settings screen that writes it;
`compareColumns` / `compareGridTemplate` → the 900px breakpoint and `data-qc-cols`;
`api.requirements` (`api.js:139`, `PacketBuilder.jsx:459`) **and its twin `api.oppRequirements`
(`:170`, `AssetBlocks.jsx:68`)** — the same endpoint feeds the asset step, so a payload-shape change
lands in two screens;
`POSTING_HOOKS` → `postingAnalysis.test.mjs` + the cross-screen union in `assetGate.test.mjs`;
`scripts/compare-ui.mjs`'s control inventory — the JD step gains controls, **and if that inventory
pins an expected count it must be updated in the same commit or it fails.**
**Ten consumers, one payload.** If branch (B)/(C) is chosen, add: `dimensions.ts` (a new stored
count), `schema.ts` (a new column), and `api/test/hardening.test.mjs` (an H-case with a **slug**).

---

### GROUP B — QC summary inside the ATS/tally modal (4.3-9, 4.3-10, 4.3-11)

**TIER: 1.** Not because it is large — it is the smallest of the three — but because
`scoreParts`/`composite` **are** the score, and `GateBadge` **is** the gate word. Rendering either
one in a new place with a new derivation is accusation-grade by the CLAUDE.md definition
(*"anything that decides… the artifact gate, a score"*). If the implementation is a pure re-mount of
existing exports with **zero new derivation** — which the feasibility table says is achievable —
then it is tier 2 in practice, and **AC B.1 is the binary test of which it is.**

**AC B.1 (nothing new is derived) — the AC that sets the tier.**
Given the implementation,
when `KeywordTallyOverlay` (or whatever renders the QC summary) is read,
then it contains **no** gate derivation, **no** severity comparison, **no** composite arithmetic and
**no** `.filter(...).length` over check rows — every value comes from `scoreParts()`, `railGate()`,
`gateMeta()` / `GateBadge`, or a prop.
*(Binary check, modelled on the existing `qcRail.test.mjs` case: a source grep of the rendering file for `state === 'fail'`, `composite`-arithmetic, `/ 3`, `reduce(`, and `.filter(` over results returns no new hits. Rationale: `qcRail.js:12` — the rail EXTENDS `assetGate.js` rather than restating it; a third home for the same rule is how two screens come to disagree.)*

**AC B.2 (4.3-11 — `GateBadge` is IMPORTED, never copied).**
Given the per-asset gate rows,
when they render,
then they use `GateBadge` imported from `./AssetGateDrawer.jsx` — the same component
`PacketBuilder.jsx:15` already imports and `:947` already renders per asset.
**It is a FAIL to define a second badge component, to inline the badge's markup, or to re-derive its
five states.**
*(Binary check: `grep -rn "GateBadge" app/src` shows exactly one `export function GateBadge` and no new local definition. Rationale: the coverage doc calls this "a relocation"; a relocation that COPIES is the duplication the extend-don't-duplicate rule forbids, and `PacketBuilder.jsx:179-183` records that these "five well-built states already existed in GateBadge".)*

**AC B.3 (4.3-11 — the rows iterate the REAL artifact list).**
Given a packet,
when the per-asset rows render,
then there is exactly one row per artifact **in that packet's `artifactList`**, using the same
lookup shape as `PacketBuilder.jsx:947`.
**It is a FAIL to render the prototype's hardcoded `['resume','compact_resume','cover','portfolio']`**
(`packet.jsx:344`) — that would show gate rows for artifacts the packet does not have.

**AC B.4 (the keyword number does not appear twice under two names) — THE ADVERSARIAL AC.**
Given `KeywordLibraryState` already renders `score.keyword_coverage` in this modal as *"ATS keyword
coverage: N%"*, and `scoreParts(score)[1]` is `{label: 'Keywords present', value: score.keyword_coverage}` —
**the same database column**,
when the modal renders after the change,
then **one** of the following holds and the PR says which:
 (a) the score block **omits** the `kw` part, deferring to the existing `KeywordLibraryState`; or
 (b) `KeywordLibraryState` is removed and the score block's `kw` part carries its three states; or
 (c) both render and the copy makes explicit that they are one measurement shown two ways.
**It is a FAIL to ship (a)/(b)/(c) unstated, and a FAIL for the modal to show two different numbers
for `keyword_coverage`.**
*(Binary and live: `count_sel` over a hook that wraps any keyword-coverage number, with `count_max` set to the intended count. Note the naming rule at `PostingAnalysis.jsx:10-13` — "ATS" belongs to the term library and to nothing else — so the two labels are not interchangeable and (c) needs real copy, not a rename.)*

**AC B.5 (the two BIG numbers do not get conflated).**
Given the modal already renders a 30px **Match estimate** explicitly disclaimed as *"One model's
read… It is not keyword coverage, and no applicant tracking system produced it"*
(`PostingAnalysis.jsx:689-695`),
when a **composite** (a measured score) is added to the same modal,
then the composite carries its own provenance label, and the model-estimate disclaimer at `:690-692`
renders **unchanged**.
**It is a FAIL for a reader to see two large numbers with no way to tell which is measured.**

**AC B.6 (the null composite prose is carried, not dropped) — the no-fabricated-composite AC.**
Given `score.composite === null` (which happens whenever any of the three parts is null — and
`keyword_coverage` is null for every packet today, per `appChecks.ts:130`, **so this is the DEFAULT
path, not an edge case**),
when the score block renders,
then it renders **no composite number and no bar**, and shows prose naming **which** parts are
missing — the behaviour `MatchTab` already implements (`AssetGateDrawer.jsx:288-296`).
**It is a FAIL to render `0`, `—`, an empty bar, or a composite averaged over the parts that do exist.**
*(Rationale, verbatim from `assetGate.js:379-380`: "A missing component must say WHY - never 0, never blank… the composite is null unless all three exist." And CLAUDE.md: "Never fabricate a composite… a partial composite is the number a reviewer trusts most and the one most likely to be wrong.")*

**AC B.7 (a per-part null says WHY).**
Given any part with `value == null`,
when it renders,
then it shows `p.source` (the server's prose) and a `not measured` marker, and **no bar**.
**It is a FAIL to render a 0%-width bar for a null part** — a zero bar and a not-measured part are
two different claims.

**AC B.8 (the block is scoped to ONE artifact and says which).**
Given `keywordScore` is `resumeEntry.result.score` — **the resume's score, not the packet's**
(`PacketBuilder.jsx:439-440`),
when the score block renders,
then the surface **names the artifact it is scoring**.
**It is a FAIL to present a single artifact's composite as the packet's**, and a FAIL to average
artifact composites into a packet-level number — no such number exists
(`qcRail.js:887-895` gives `packetGate` as a **word**, deliberately never a score).

**AC B.9 (edge — a packet with NO artifacts).**
Given `artifactList` is empty (so `qcEntries` is empty, `resumeEntry` is null and `keywordScore` is
null — the exact `|| null` fallback at `PacketBuilder.jsx:440`),
when the modal opens,
then the QC Summary block renders an explicit *no assets to check* state — matching
`qcStepState`'s own sentence (`qcRail.js:862`: *"this packet has no assets to check"*) — and the
modal's existing sections still render.
**It is a FAIL to render an empty score block, a blank row list, or nothing at all.**

**AC B.10 (edge — a packet with no RESUME but other artifacts).**
Given `artifactList` is non-empty but contains no `type === 'resume'`,
when the modal opens,
then the score block says the resume has not been built (rather than showing another artifact's
score silently, and rather than showing the empty state of AC B.9), **and** the per-asset gate rows
still render one row per artifact that DOES exist.
*(This is the case `resumeEntry` returns null for while `qcEntries.length > 0` — two different empties, and `assetGate.js`'s standing rule is that they must not print the same sentence.)*

**AC B.11 (edge — assets never checked).**
Given every entry has `railGate(result) === 'unchecked'`,
when the rows render,
then each `GateBadge` shows its **unchecked** state (not `pass`, not blank), and the block does not
say the packet is clear.
*(Absent evidence is `not_applicable`, never `pass` — the vacuous-green failure the whole rail exists to prevent.)*

**AC B.12 (error / loading states are passed through, not swallowed).**
Given an entry with `resultError` or `resultLoading`,
when its row renders,
then `GateBadge` receives `loading`/`error` — the props it already takes
(`AssetGateDrawer.jsx:45`) — and the asset is **named**, never silently omitted.
*(An omitted asset reads as "nothing wrong with it".)*

**AC B.13 (`Open QC →` reuses the existing close-and-navigate pattern).**
Given the modal's footer,
when the QC control is activated by click **and** by `Enter`/`Space`,
then it closes the modal and calls `setActiveStep('qc')` — the identical shape to
`onGoResume={() => { setAtsOpen(false); setActiveStep('resume') }}` (`PacketBuilder.jsx:1017`),
threaded as a prop.
**It is a FAIL for `PostingAnalysis.jsx` to import navigation.**

**AC B.14 (a compact score block is EXTRACTED and shared, never duplicated).**
Given `MatchTab` (`AssetGateDrawer.jsx:282-325`) already renders exactly these bars and is a
non-exported local function,
when the compact block is built,
then the parts loop is **either** exported/extracted into a component both `MatchTab` and the modal
render, **or** the modal imports it — and `MatchTab`'s own output is unchanged.
**It is a FAIL to paste a second bar renderer**, and a FAIL for the drawer's Match tab to regress.
*(Binary check: `grep -rn "px-bar" app/src` shows no new hand-written bar markup for score parts; the drawer's Match-tab test output is byte-identical.)*

**AC B.15 (hook hygiene + no raw hex, enforced).**
Given the new block,
when the hook-render, no-hand-typed-`data-qc`, cross-screen-collision and no-raw-hex tests run,
then all pass. The modal root `POSTING_HOOKS.tally` (`PostingAnalysis.jsx:686`) still renders.

**REGRESSION GUARD B.** The tally modal's four existing sections must all still render, in order:
(1) **Match estimate** with `POSTING_HOOKS.matchEstimate`, its `not run yet` null state, and the
*"It is not keyword coverage, and no applicant tracking system produced it"* sentence;
(2) **Coverage against the ATS term library** → `KeywordLibraryState`'s **three** distinct states
(`unknown` / `unpublished` / `published`) as three distinct strings — *unless* AC B.4 branch (b) is
taken, in which case those three states must be carried into whatever replaces it, and the PR must
say so; (3) `ModelKeywords` with its parsed / from-run / thin groups, each keeping
`keywordGroupMeaning`'s `NOT_COMPARED_NOTE` — **the rule with "NO carve-outs"**
(`postingAnalysis.js:454-456`); (4) both footer buttons, *Rebuild every asset from this posting* and
*Go to the resume step*, still wired. `MatchEstimateButton` must still open the modal.
Concretely: **`app/test/postingAnalysis.test.mjs` passes unmodified**, and
`app/test/assetGate.test.mjs`'s `scoreParts` cases pass unmodified.

**Config check (Group B).**
- **Which artifact the score block scores** (`resume`, hardcoded at `PacketBuilder.jsx:439`) is a
  behaviour-affecting value a user could reasonably want to change. **It is ALREADY hardcoded on
  `main` — this change does not introduce it, and fixing it is out of scope — but the AC records it
  so the implementer does not deepen it.** If the block gains an artifact selector, it must be a
  setting; if it stays fixed to the resume, **AC B.8 requires the screen to SAY "resume"**, which is
  the honest minimum. Do not add a second hardcoded type list.
- **The gate/score thresholds and the band words are NOT config** — server-side, stored on
  `artifact_score`, and `checkPrefs`/`loadThresholds` already own the per-owner threshold concept.
  `appDimensions.ts:295-298` is the warning: `owner_search_prefs.chk_*` is *"read by `loadThresholds`
  and written by NOTHING"*, i.e. configurable on paper only. **Do not add another of those.**
- **Bar colours, part order and labels: none** — they come from `scoreParts()` and the shared CSS.

**Blast radius (Group B).**
`useQcEntries` (`PacketBuilder.jsx:431`) → the QC rail (`:923`), the step circle (`:1142` via
`packetGate`), the per-asset badges (`:947`), the artifact card badge (`:184`), `packetReadiness`
(`:750`), `packetFailList` (`:755`), and now the modal — **seven consumers of one fetch**;
`scoreParts` (`assetGate.js:382`) → `MatchTab` (`AssetGateDrawer.jsx:286`), `qcRail.js:285`, and now
the modal — **three**;
`GateBadge` → `PacketBuilder.jsx:184,947`, `Packets.jsx:140`, `AssetGateDrawer.jsx:509,524`, and now
the modal — **six mount sites of one component**;
`keywordScore` → `PostingAnalysisCard` (`:839`) **and** `KeywordTallyOverlay` (`:1014`) — **two
consumers, so a prop rename touches both**;
`KeywordLibraryState` / `keywordLibraryState()` → the modal and its test;
`POSTING_HOOKS` → `postingAnalysis.test.mjs` + the cross-screen union.
**If AC B.14's extraction is taken, add `AssetGateDrawer`'s Match tab as a consumer of the extracted
component — that is the one place a "compact block" refactor can silently regress a different screen.**

---

### GROUP C — keyword-panel escape hatches (4.6-9, 4.6-10, 4.6-11)

**TIER: 2 — ordinary logic, with ONE tier-1 sentence.** The controls seed text into an existing ask
box; they move no gate, no score and no count. **The exception is the COPY.** Any sentence claiming
a coverage consequence ("record it as uncovered", "which posting line loses its coverage") is a
claim about a coverage number — accusation-grade — and **is false in this app**. AC C.4 is
therefore tier 1 and gets a guard.

**AC C.0 (scope is declared before any control is built).**
Given the Group C feasibility table shows **no skill bank exists**,
when the PR is opened,
then it states that **4.6-9 is NOT built** and why, or links the commit that created a real,
owner-scoped skill source with a read route.
**It is a FAIL to populate a `Swap for another skill…` `<select>` from a hardcoded array**, from the
prototype's `SKILL_BANK` (`data.js:140-151`), or from an unpublished `term_library_entry` — the
library is off by owner decision (`AssetBlocks.jsx:845`). *(No dead UI; no fake data.)*

**AC C.1 (happy path — 4.6-11 — the actions appear in the panel that exists).**
Given a field with at least one proposed keyword and `artifactId && !isStatic`,
when the keyword chip is clicked and `BLOCK_HOOKS.keywordDetail` opens,
then the panel renders an actions region under a *"Not comfortable claiming this?"*-equivalent
heading, carrying a new `BLOCK_HOOKS` value, **below** the existing explanation and verbatim quote.

**AC C.2 (4.6-11 — it reuses `seedAskReword`'s mechanism, not a new one).**
Given each action,
when it is activated,
then it calls the **same** seed-then-open pattern as `seedAskReword` (`AssetBlocks.jsx:520-523`) —
setting `ask` text and `askOpen`, sending **nothing** — and the request travels only via the
existing Send button → `api.aiEditArtifact(artifactId, {instruction, section: row.merge_field})`.
**It is a FAIL to add a second POST, a second route, or an auto-send.**
*(Binary check: `grep -n "aiEditArtifact" app/src/screens/AssetBlocks.jsx` still returns exactly one call site. Rationale, verbatim from `:516-519`: "the same box, the same route. **Not a second edit path**, and nothing is sent until the reader presses Send, so the wording stays theirs to edit.")*

**AC C.3 (4.6-11 — the seeded sentence is EDITABLE and unsent).**
Given an action is activated,
when the ask box opens,
then the sentence is present in the editable textarea, the Send button is enabled only on non-empty
text, and **no network request has been made**.
*(Binary check: a test asserting the seed function sets state and returns without calling `api`.)*

**AC C.4 (the seeded sentence may not claim a coverage consequence) — THE TIER-1 AC.**
Given `requirement.model_keyword` is declared *"never scoreable"* (`requirements.ts:59`,
`schema.ts:338`) and the panel two lines above already tells the reader the keyword *"counts toward
nothing"* (`AssetBlocks.jsx:849-851`),
when any seeded sentence renders,
then it contains **no** claim that dropping or swapping the keyword changes a coverage number, a
gap, or a line's covered/uncovered state.
**It is a FAIL to copy the prototype's wording** — *"record the keyword as uncovered rather than
met"*, *"tell me which posting line loses its coverage"*, *"I would rather show a gap than
overstate"* (`assets.jsx:72,82,85`) — **because in this app there is no such coverage to lose.**
*(Guard required, mutation-proved: an assertion over the seeded strings that they contain none of `uncovered`, `loses its coverage`, `covered`, `coverage`, `show a gap`. Rationale: this is the same class as `H:no-stale-not-built-claim` — no screen may tell the owner something about a subsystem that is not true — and shipping it would put a contradiction two inches below `AssetBlocks.jsx:850`.)*

**AC C.5 (4.6-10 — the action is honestly named).**
Given the panel's *drop* action,
when it renders,
then its label describes what it actually does — **ask for the keyword to stop being used in this
field** — and does not promise a persisted state ("leave the line open") that nothing records.
**It is a FAIL to render a label implying a stored decision.**
*(See AC C.6 for why. The prototype's "Drop it, leave the line open" describes a state change; the app can only phrase a request.)*

**AC C.6 (nothing writes to the pipeline's audit tables) — the no-parallel-writer AC.**
Given `skill_candidate` and `swap_decision` are written **only** by `writeSwaps` from a build
(`appSwaps.ts:30,56,61`) and their `action`/`driver` vocabularies are the build's record,
when the drop/swap actions are implemented,
then **no** UI path inserts, updates or deletes a `skill_candidate` or `swap_decision` row, and no
new route does so on the UI's behalf.
*(Binary check: `grep -rn "skill_candidate\|swap_decision" api/src` shows no new write site outside `appSwaps.ts`. Rationale: `driver='owner'` is INFERRED on the next build from `ownerLabels` (`swaps.ts:279`, `appSwaps.ts:45`) — the owner's intent is designed to reach the record by editing the text and rebuilding. A direct write is the parallel system the extend-don't-duplicate rule forbids, and it would corrupt the loop's own audit trail — the exact failure `schema.ts:585-590` records for P3-21.)*

**AC C.7 (edge — a field with no proposed keywords).**
Given `proposedKeywordsForRow(reqs)` is empty,
when the field renders,
then the whole `BLOCK_HOOKS.keywordChips` region is absent as it is today, and no actions region is
rendered.
**It is a FAIL for an empty panel or a stray heading to appear.**

**AC C.8 (edge — a STATIC block, and a block with no `artifactId`).**
Given `isStatic === true` or `artifactId` is falsy,
when the field renders,
then the actions are **hidden**, matching the gate the sibling `Tweak this` control already uses
(`AssetBlocks.jsx:779`: `artifactId && !isStatic`).
**It is a FAIL to render an inert control** — a static block has no edit path at all.

**AC C.9 (edge — the posting line could not be located).**
Given `openKeywordDetail.verbatim` is null (the panel already prints *"The posting line could not be
located, so there is nothing to quote"*),
when an action's sentence is seeded,
then the sentence **quotes no posting text** and makes no claim about a posting line it cannot name.

**AC C.10 (error state).**
Given the ask POST fails,
when the action was seeded from the keyword panel,
then the existing `askError` path renders unchanged, the typed text is **retained** (not cleared),
and the keyword panel does not close or change state.
*(Binary check: `AssetBlocks.jsx:686` already only clears `ask` on success — assert that stays true.)*

**AC C.11 (accessibility parity).**
Given each new action,
then it carries `role="button"`, `tabIndex={0}` and an `Enter`/`Space` handler, matching
`BLOCK_HOOKS.wordingAsk` (`AssetBlocks.jsx:780-788`) and the chips (`:806-814`).

**AC C.12 (hook hygiene, enforced).**
Given the new controls,
when the `BLOCK_HOOKS` render test and `assetGate.test.mjs`'s cross-screen union run,
then both pass: new keys rendered, none hand-typed, no value colliding with
`QC_HOOKS`/`PACKET_HOOKS`/`POSTING_HOOKS`/`GATE_HOOKS`.

**REGRESSION GUARD C.** The keyword panel's existing content must survive **verbatim**:
`BLOCK_HOOKS.keywordDetail` with `data-qc-keyword`; the *"proposed"* marker; the sentence *"A model
reading this posting proposed this keyword for the line below. Nothing has verified that this field
contains it, and it counts toward nothing."*; the `Verbatim` quote **or** the could-not-be-located
sentence; and the deliberate **absence** of a match grade, an approximately-equal marker and a "took
the place of" line (`AssetBlocks.jsx:843-847`). The chips themselves must keep
`BLOCK_HOOKS.keywordChips`, `data-qc-n`, the click/keyboard toggle, and the
`kwPresence`-driven present/absent treatment — **one derivation feeding highlight, chip state and
the not-in-the-text line** (`:500-503`); a new control must not add a second. `seedAskReword`'s
existing `Tweak this` under kept wording must still render and still seed its original sentence.
Concretely: **`app/test/assetBlocks.test.mjs` AND `app/test/proposedKeywords.test.mjs` both pass
unmodified** — `proposedKeywords.test.mjs` is the suite that owns this panel's keyword derivation,
and a regression guard that names only `assetBlocks.test.mjs` is structurally blind to it.

**Config check (Group C).**
- **The seeded sentences themselves.** These are user-facing request templates the owner would
  plausibly want to word differently. **Recommended: NOT config, deliberately** — they are the
  product's copy, they must satisfy AC C.4's truthfulness guard, and a user-editable template is a
  user-editable way to reintroduce the false coverage claim. `seedAskReword`'s existing sentence is
  a code literal on `main` and the owner has not asked to change it; **stay consistent with the
  precedent rather than making one of the pair configurable and not the other.** Say this in the PR
  rather than leaving it implicit.
- **The skill bank's contents**, if 4.6-9 is ever built: **must** be user-changeable — and the
  correct home is the existing `term_library` publish flow, not a new list. That is the owner
  decision AC C.0 refers out.
- **Otherwise: none.** No threshold, cap, or toggle.

**Blast radius (Group C).**
`proposedKeywordsForRow` / `proposedKeywordDetail` (`assetBlocks.js`) → the chips (`:802`), the
detail panel (`:836`), and `keywordPresence` → `Marked`/`markRuns` highlighting (`:503`, `:507`) —
**one derivation, three consumers, and `:500-502` explicitly forbids a fourth**;
`seedAskReword` → `Tweak this` (`:782,:786`) and now the keyword panel — **two seeders, one box**;
the ask box → `api.aiEditArtifact` → `POST /app/artifact/{id}/ai-edit` → `correction` rows with
`source='owner_edit'` → **`ownerLabels` on the NEXT build (`appSwaps.ts:45`) → `driver='owner'`
(`swaps.ts:279`) → `unattributed` (`appSwaps.ts:123`) → the `changes_cited` gate.** *That chain is
the real downstream, and it is why the ask box is the right funnel: an owner edit already reaches
the gate correctly through it.*
`onCorrectionsChanged` (`:685`) → the change log / QC rail refresh;
`BLOCK_HOOKS` → the block hook tests + the cross-screen union.
**Six consumers.**

---

## PART 3 — VERIFICATION PLAN

**Harness constraints, stated once.** The sandbox **cannot** reach `*.azurestaticapps.net` or
`azurewebsites.net`, so no rendered-UI and no live-API claim may be made from here. Three harnesses:

- **`node --test` in `app/`** — pure logic and the source-grep structural guards
  (`postingAnalysis.test.mjs`, **`postingCompare.test.mjs`**, `assetGate.test.mjs`, `qcRail.test.mjs`,
  `assetBlocks.test.mjs`, **`proposedKeywords.test.mjs`**, `packetBuilder.test.mjs`).
  Seconds, deterministic → per CLAUDE.md §0c, **re-run in FULL on every loop.**
- **`.github/workflows/ui-verify.yml`** (`scripts/ui-verify.mjs`) — headless Chromium on a GH
  runner. **Run with `run_in_background: true`**, per the never-block-on-a-workflow rule.
- **`db-query.yml`** / **`api-test.yml`** — for the real ids and the ground-truth numbers every
  `expect` below has to be resolved against first.

### CORRECTION to the previous batch's plan, which the implementer will otherwise inherit

`AC-three-small.md` states that click-through ACs are unverifiable *"until `scripts/ui-verify.mjs`
gains a click step"*. **That is now out of date. The script already has one.** Reading
`scripts/ui-verify.mjs` (99 lines) and `ui-verify.yml`, the inputs are:
`route`, `owner`, `expect`, **`expect_absent`**, **`count_sel`** + `count_min`/`count_max`,
**`click_sel`** (+ `CLICK_WAIT`), **`measure_sel`**, **`viewport_w`/`viewport_h`**, `app_url`.
The click happens **before** `document.body.innerText` is read, so *"click X, then assert Y is on
screen"* is provable today.

**What it still CANNOT do — this is the honest limit, and it decides several ACs below:**

| Limitation | Consequence |
|---|---|
| **Exactly ONE click per run.** `CLICK_SEL` is a single selector, clicked once. | Any surface needing **two** interactions is unreachable. **This kills live proof of the entire Group C panel**: the keyword *chip* must be clicked to open `keywordDetail`, and the action inside it is a second click. **One run can open the panel and assert its contents; no run can activate an action inside it.** |
| **No assertion on `location.hash`.** The result object reports `url` (the requested route), never the post-click hash. | "The control navigates" is provable only **indirectly** — click it, then `expect` text unique to the destination step. That is adequate, but it proves *"destination text appeared"*, not *"the route changed"*. Say so; do not overclaim. |
| **`expect` is substring-over-`body.innerText`.** | It cannot prove **position/order**, cannot prove a value came from the API rather than a literal, and **cannot detect a duplicate** (a string present twice matches once). Order → a source-order unit test; duplication → `count_sel` + `count_max`. |
| **No screenshot assertion.** The PNG is uploaded for a human. | Colour, bar width and layout are **not** machine-verified. `measure_sel` gives width/height/visible only. |
| **Fixed 4.5s settle.** | A slow fetch reads as missing text. A failing run needs the `bodySnippet` read before it is called a defect. |

**What the script would need to gain**, in priority order, for the ACs marked *unprovable-live*:
(1) **`CLICK_SEL` accepting a `;`-separated sequence** — this single change unblocks all of Group C
and the second half of Group B; (2) **`hash` reported in the result** (one line:
`hash: await page.evaluate(() => location.hash)`) — turns every navigation AC from indirect to
direct; (3) an `EXPECT_ONCE` / per-string count, since `count_sel` needs a hook and cannot assert on
free text. **All three are small. (1) is the one that matters.**

### A precondition that must hold before ANY `ui-verify` run below is meaningful

Every route needs a **real packet id** for `von.ellis@enterpriseds.io` whose opportunity has a
**resolved comparison** and whose artifacts have **checks results**. Resolve it FIRST — via
`Boost_DB_Connector` if enabled in the chat (the ~1s path), else `db-query.yml`:

```sql
select p.id  as packet_id, o.id as opp_id,
       count(distinct a.id)  as artifacts,
       count(distinct d.dimension_key) as dimensions
  from packet p
  join opportunity o on o.id = p.opp_id
  left join artifact a on a.packet_id = p.id
  left join comparison_dimension d on d.opp_id = o.id
 where o.owner_email = 'von.ellis@enterpriseds.io'
 group by p.id, o.id
 having count(distinct d.dimension_key) > 0
 order by artifacts desc limit 5;
```

**A `ui-verify` run against a packet with no comparison would go green on an empty state and prove
nothing** — the vacuous pass this repo's rules exist to prevent. Resolve the **expected numbers**
too (`select dimension_key, covered, total, fit from comparison_dimension where opp_id = …`), because
`expect: "3 of 7"` is only a real assertion when 3 and 7 came from the database first.

### Group A

| AC | Harness | Concrete test |
|---|---|---|
| A.0 | Review + `node --test` | PR states the branch. Grep assert: no new client-side coverage-counting expression in `PostingAnalysis.jsx` / `postingAnalysis.js`. |
| A.1 | `ui-verify.yml` + `node --test` | Live: `route: "#/packet/<packetId>/jd"`, `owner: von.ellis@enterpriseds.io`, `count_sel: '[data-qc="posting-fit-card"]'`, `count_min`/`count_max` **both** = the dimension count from the DB query above. Unit: the card model emits one entry per payload row. |
| **A.2** | `node --test` (primary) + `ui-verify.yml` | **Unit is the real proof**: for every fixture, `assert.deepStrictEqual(cardModel(row).pair, [row.covered, row.total])` and equality with `CompareRow`'s pair. Live corroboration: `expect: "<n> of <m>"` using the DB's own numbers. |
| A.3 | `node --test` | Fixtures with `covered: null`, `total: null`, `total: 0`, `fit: 'not_applicable'` → assert the rendered model contains **no** `n of m` pair and **does** contain `reason`. |
| A.4 | `node --test` + `ui-verify.yml` | Unit: `{resolved:false}` and `{dimensions:[]}` → no cards, `compareEmpty` present. Live: a packet with no resolve → `count_sel` on the card hook with `count_max: 0`. |
| **A.5** | `node --test` | `keywordScore = null`, then `{keyword_coverage: null}` → assert the ATS card's model has no numeric pair and carries the `unpublished` sentence. **Also assert `model_keyword` appears nowhere in the card's numerator path** (source grep). |
| **A.6** | `node --test` | Fixture whose `note` contains `no excerpt for: #12 …` → assert that exact substring is in the rendered model **unchanged**, and that the model contains no *second* list of missing item names. |
| A.7 | `node --test` | Fixtures `{fit:'weak', shortfall:'nothing_found'}` vs `{fit:'weak', shortfall:'falls_short'}` → `assert.notEqual` on the two rendered words. |
| A.8 | `node --test` | Grep: `PostingAnalysis.jsx` has no `state.jsx` import and no bare `go(`; `PacketBuilder.jsx` passes `onOpenQc` to both cards. |
| A.9 | `ui-verify.yml` | `route: "#/packet/<id>/jd"`, `expect: "See how the assets answer these;opens the coverage list in QC"` (or the chosen disclosure). |
| **A.10** | `ui-verify.yml` | `count_sel` over a hook shared by every QC-link control, `count_max` = the intended number. **`expect_absent` cannot express "appears twice" — this AC needs `count_sel` and fails silently without it.** |
| A.11 | `node --test` | Source assert on the new control: `role="button"`, `tabIndex={0}`, `Enter`/`Space` handler. |
| A.12 | `node --test` | Existing hook-render + cross-screen-union tests, unmodified. |
| A.13 | `ui-verify.yml` ×2 | Same route at `viewport_w: 1440` then `700`; `measure_sel` on the card grid; confirm `data-qc-cols` via `expect` is not possible (attribute, not text) → assert it in a **unit** test on `compareColumns()` instead, and use `measure_sel` live for the reflow. |
| A.14 | `node --test` | `req.error` set → assert cards absent. |
| **Regression A** | `node --test` + `ui-verify.yml` | `app/test/postingAnalysis.test.mjs` **and `app/test/postingCompare.test.mjs`** pass **unmodified**. Live: same route, `expect` the four `COMPARE_COLUMNS` headings + `COMPARE_SCOPE_NOTE` + `"See the lines this was built from"`. |
| **Mutation proof (never skipped)** | `node --test` | Reinstate each defect and confirm the suite **FAILS**, then restore: recompute `covered` in the card instead of reading it (A.2); render `0 of 0` for a null pair (A.3); use `model_keyword.length` as the ATS numerator (A.5); truncate the `no excerpt for:` note (A.6); collapse the two `weak` words (A.7). |

### Group B

| AC | Harness | Concrete test |
|---|---|---|
| B.1 | `node --test` | Source grep over the rendering file (comments stripped): no `state === 'fail'`, no composite arithmetic, no `.filter(` over check rows. Model it on `qcRail.test.mjs`'s *"computes NO gate, NO severity, NO count"* case. |
| B.2 | `node --test` | `grep -rn "function GateBadge" app/src` → exactly one definition; the modal's source imports it. |
| B.3 | `node --test` | Fixture `artifactList` of 2 and of 5 → row count matches; grep asserts no literal `'compact_resume'`-and-`'portfolio'` array in the new code. |
| **B.4** | `ui-verify.yml` + review | `route: "#/packet/<id>/jd"`, **`click_sel: '[data-qc="match-estimate-button"]'`** (`POSTING_HOOKS.matchEstimateButton = 'match-estimate-button'`, `postingAnalysis.js:49` — resolved, not guessed), then `count_sel` over the keyword-coverage hook with `count_max` = 1 (branch a/b) or 2 (branch c). **The PR must name the branch, or the AC fails on review regardless of the run.** |
| B.5 | `ui-verify.yml` | Same run; `expect: "It is not keyword coverage, and no applicant tracking system produced it"` — proves the model-estimate disclaimer survived. |
| **B.6** | `node --test` | `{composite: null, keyword_coverage: null, …}` → assert the model has no composite digit and DOES name the missing parts. **This is today's default path, so it is also the live path**: the same `ui-verify` run should `expect` the null-composite prose, not a number. |
| B.7 | `node --test` | A part with `value: null` → `not measured` present, `source` present, **no bar element**. |
| B.8 | `ui-verify.yml` | Same run, `expect` includes the artifact name/word (e.g. `"Resume"`) adjacent to the score block. |
| B.9 | `node --test` | `qcEntries: []` → assert the *no assets to check* sentence; `assert.notEqual` against B.10's sentence. |
| B.10 | `node --test` | Non-empty `qcEntries` with no `type:'resume'` → assert a **different** sentence from B.9's, and one gate row per artifact present. |
| B.11 | `node --test` | All entries `unchecked` → every badge state is `unchecked`; assert the block does not contain a clear/pass sentence. |
| B.12 | `node --test` | Entries with `resultError` / `resultLoading` → the asset label still appears in the model. |
| B.13 | `ui-verify.yml` | **Two clicks needed (open modal, then click Open QC) — NOT provable in one run.** Prove the control **renders** with `click_sel: '[data-qc="match-estimate-button"]'` + `expect: "Open QC"`; prove it **navigates** by unit-asserting it calls the passed handler. **Report the navigation half as unverified-live until `CLICK_SEL` accepts a sequence.** |
| B.14 | `node --test` | `grep -rn "px-bar" app/src` shows no new hand-written score bars; the drawer Match-tab test output is byte-identical to `main`'s for the same fixture. |
| B.15 | `node --test` | Hook-render, no-hand-typed-`data-qc`, cross-screen-union and no-raw-hex tests, unmodified. |
| **Regression B** | `ui-verify.yml` + `node --test` | Live: one run with `click_sel: '[data-qc="match-estimate-button"]'` and `expect` all four sections — `"Match estimate"`, the ATS-library headline for the current state, a `ModelKeywords` group label + `NOT_COMPARED_NOTE`, `"Rebuild every asset from this posting"`, `"Go to the resume step"`. Unit: `postingAnalysis.test.mjs`, `assetGate.test.mjs` and `packetBuilder.test.mjs` pass unmodified. |
| **Mutation proof** | `node --test` | Reinstate: average the non-null parts into a composite (B.6); render a 0%-width bar for a null part (B.7); copy the badge markup inline (B.2); hardcode the four artifact types (B.3). Each must make the suite **FAIL**. |

### Group C

| AC | Harness | Concrete test |
|---|---|---|
| C.0 | Review | The PR states 4.6-9 is not built. **No test can prove a negative scope decision — this is a review gate.** |
| C.1 | `ui-verify.yml` | `route: "#/packet/<id>/resume"`, **`click_sel`** = the keyword-chip selector (`[data-qc="blocks-keyword-chips"] [role="button"]`), `expect` the actions heading. **This consumes the single available click.** |
| C.2 | `node --test` | `grep -n "aiEditArtifact" app/src/screens/AssetBlocks.jsx` → still exactly **one** call site. |
| C.3 | `node --test` | Call the seed function; assert it sets `ask`/`askOpen` and that no `api.*` was invoked (spy). |
| **C.4** | `node --test` | **New guard, tier 1**: assert every seeded sentence constant matches none of `/uncovered\|loses its coverage\|coverage\|covered\|show a gap/i`. Assert-the-invariant, not the incident — it must fire on **any** future seeded string, not just today's three. |
| C.5 | Review + `node --test` | Assert the drop action's label contains no persistence verb; reviewed for honesty against AC C.6. |
| **C.6** | `node --test` | `grep -rn "skill_candidate\|swap_decision" api/src` → no `insert`/`update`/`delete` outside `appSwaps.ts`. Structural grep is correct here (a runtime test cannot express "no new writer"). |
| C.7 | `node --test` | `reqs` with no `model_keyword` → chips region and actions region both absent. |
| C.8 | `node --test` | `isStatic: true`, then `artifactId: null` → actions absent in both. |
| C.9 | `node --test` | `verbatim: null` fixture → the seeded sentence contains no quoted posting text. |
| C.10 | `node --test` | Force the ask POST to reject → `askError` set, `ask` text **retained**, panel state unchanged. |
| C.11 | `node --test` | Source assert: `role="button"`, `tabIndex={0}`, `Enter`/`Space` on each new control. |
| C.12 | `node --test` | Hook-render + cross-screen-union, unmodified. |
| **Regression C** | `node --test` + `ui-verify.yml` | Unit: `app/test/assetBlocks.test.mjs` **and `app/test/proposedKeywords.test.mjs`** pass **unmodified**. Live: the C.1 run's `expect` also includes *"Nothing has verified that this field contains it, and it counts toward nothing"*, and `expect_absent` includes a match-grade word to prove the deliberately-absent grade did not return. |
| **Mutation proof** | `node --test` | Reinstate: seed the prototype's *"record the keyword as uncovered rather than met"* (C.4 — **this one is the whole point of the guard**); add a second `aiEditArtifact` call (C.2); render the actions on a static block (C.8); clear `ask` on error (C.10). Each must make the suite **FAIL**. |

### What CANNOT be proven, stated plainly

1. **Any Group C action being activated.** Two clicks are needed; the harness gives one. Provable:
   the panel opens and its contents render. **Not provable live: that clicking "Drop it" seeds the
   ask box.** Report it as unit-verified and live-unverified — do **not** infer it from an `expect`.
2. **AC B.13's navigation half**, for the same reason (open the modal, then click `Open QC →`).
3. **That any control actually changes the route.** The result object never reports the post-click
   hash; destination text is the only available proxy.
4. **Colour, bar width, card layout and visual order.** Screenshot only; a human reads it.
5. **That a rendered number came from the API rather than a literal.** `expect: "3 of 7"` passes on
   a hardcoded `3 of 7`. **Only AC A.2's unit equality proves provenance** — which is exactly why
   A.2 is the tier-1 AC and why the DB numbers must be resolved before the run.
6. **Anything about the live term library's state**, without `api-test.yml` → `/api/config-status`
   or a `db-query.yml` count of published scoreable entries. AC A.5's *today* branch rests on
   `appChecks.ts:130`'s comment plus `artifactScore.ts:137-141`'s null path — **that is the code's
   claim about itself, not a live measurement.** Confirm it with
   `select count(*) from term_library_entry e join term_library_version l on … where e.scoreable and l.published_at is not null;`
   **before** relying on it in a PR.

---

## PART 4 — SEQUENCING RECOMMENDATION

**The owner's order (A → B → C) should change, and the evidence is in the tables above.** Three of
these eleven rows are already built or nearly free, and one is blocked on data that does not exist —
so the cheapest, most honest order front-loads the finished work and takes the two real decisions to
the owner before either becomes a build. Recommended: **(1) 4.2-13 + 4.2-4 — hours, not days.**
4.2-13's mechanism shipped yesterday in `2de4ae5` (`onOpenQc` is live on the sibling card and wired
at `PacketBuilder.jsx:842`); it is one prop, one control and AC A.10's duplicate check. 4.2-4 is
`ALREADY BUILT` — `dimensions.ts:504` enumerates the missing lines by `#seq` and text — so it is a
**regression guard, not a feature**, and the coverage doc should be corrected to say so.
**(2) Group B — half a day**, and it is the best value in the batch: `GateBadge` is already exported
and already imported into the file that owns the modal, `scoreParts` is already shared by two
screens, and the resume's full score row is **already passed into the modal** as `keywordScore`
(`PacketBuilder.jsx:440`). The only real work is AC B.4's duplicate-keyword-number decision and
AC B.14's extraction of the bar renderer out of `MatchTab`. **(3) Group C, minus 4.6-9 — half a
day**: 4.6-10/11 are a wiring of `seedAskReword` to a sibling panel, gated on AC C.4's copy guard;
**4.6-9 should not be built at all** — `grep -rniE "skill_candidate|skill_bank|skillBank" api/src app/src`
returns 14 hits, all `skill_candidate` (a per-packet audit row), zero skill bank, and the only other
candidate source is a term library that is **off by owner decision**. **(4) 4.2-1 last — days, and
only after the owner picks an axis**: the prototype's four cards count requirement KINDS, the app
grades role DIMENSIONS, and per-kind coverage is not a number this system produces
(`requirements.ts:61`: `coverage` is `'escalated' | null`, *"never 'covered'/'partial'"*). Building
it means new stored API work plus a fourth coverage number that `postingAnalysis.js:445` says
"would have to agree with those three and could not" — while the cheap variant (cards over the
existing dimension rows) is a different feature wearing the same row number. **Two owner decisions
gate the batch and should be asked now, not discovered later: the Group A axis, and whether the term
library gets published — which is simultaneously 4.2-1's fourth card and 4.6-9's data source.**

---

## Appendix — corrections this pass made against ITSELF

Recorded because an AC doc that hides its own misses teaches the implementer to trust it uncritically.
Four claims were written and then refuted by a further grep, before publication:

| Claim first written | Refuted by | Correction |
|---|---|---|
| *"`GateBadge` is NOT exported from `AssetGateDrawer.jsx`"* | `grep -rn "GateBadge" app/src` → `export function GateBadge` at `:45`, imported by **three** files including `PacketBuilder.jsx:15` | It is exported and already shared. **This was the single-file-inference failure the feasibility rule names**, caught by sweeping consumers rather than reading one file. |
| The verification plan cited `dimension_result` as the comparison table | `grep -n "create table if not exists.*dimension"` → the table is **`comparison_dimension`**, keyed `opp_id` + `dimension_key` (`schema.ts:1002`, `appDimensions.ts:56,220`) | SQL corrected. A guessed table name would have failed the `db-query.yml` run for a reason unrelated to the work. |
| `click_sel` was written as `[data-qc="posting-match-estimate-button"]` | `postingAnalysis.js:49` → `matchEstimateButton: 'match-estimate-button'` | Resolved from source. A wrong selector reports `clicked: "not found"` and the run fails as if the feature were missing. |
| Regression guards named `postingAnalysis.test.mjs` and *"the AssetBlocks test file"* | `ls app/test/` → **`postingCompare.test.mjs`** (25 tests, *"the JD step's posting-vs-profile comparison"*) and **`proposedKeywords.test.mjs`** (7 tests, importing `proposedKeywordsForRow` / `proposedKeywordDetail`) are the suites that actually own these surfaces | Both added. A regression guard that names the wrong suite is **structurally blind** to the thing it claims to protect — the same shape as `H:correction-ddl-parity` comparing only the `source` domain. |

**One claim in this document is deliberately NOT ground-truthed and is labelled as such:** that the
term library has no published scoreable version *today*. That rests on `appChecks.ts:130`'s comment
and `artifactScore.ts:137-141`'s null path — **the code's claim about itself, which the feasibility
rule says is not the code.** PART 3, item 6 gives the one query that would settle it. Every other
verdict in Part 1 was read off a producer or a consumer in source.

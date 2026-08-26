# VERIFY — 4.2-1 fit cards (ProfileCompareCard dimension card grid)

Verifier agent. No shared context with the implementer. Target: commit `2ec3902`,
branch `claude/three-small-ui-gaps`, repo `/home/user/boost-application-packet-platform`.

Status: IN PROGRESS — appended incrementally. Nothing committed by this agent.

## Log
- [start] evidence file created before any investigation.

## Baseline established
- `git log --oneline -5`: HEAD = `c3122c5` (doc-only: `.claude/actions.md`, `.claude/memory.md`),
  parent = `2ec3902` (the code under test). Working tree clean apart from this file.
- `git show --stat 2ec3902` → 3 files, +56 -0:
  `app/src/postingAnalysis.js` (+3), `app/src/screens/PostingAnalysis.jsx` (+46),
  `scripts/render-app.mjs` (+7).
- Group A ACs = **A.0 … A.14 (15)**, `docs/qc-evidence/AC-large-medium.md:255-440`. Tier declared
  **1 — accusation grade** by the AC author ("these cards render a COVERAGE COUNT").

## Source reading (done before any test)

### Where the numbers come from — the A.2 chain, read end to end
- Producer: `api/src/functions/tests/dimensions.ts` — four emit sites, `grep -n` output:
  `:430 covered: 1, total: 1` · `:437 covered: 0, total: 1` · `:483 covered: 0, total: judgeable.length`
  · `:511 covered: evidenced.length, total: judgeable.length`. Plus `:351` `covered: null, total: null`
  inside the `na()` helper.
- Storage → re-read: `appDimensions.ts:218 loadComparison` — `select * from comparison_dimension`,
  mapped at `:228` as **`note: r.note, reason: r.reason, covered: r.covered, total: r.total`** —
  a straight column passthrough, no arithmetic.
- `comparisonPayload` (`appDimensions.ts:254-265`) → `{dimensions: rows, summary, set, resolved, stale}`.
- Client: `comparisonState()` (`postingAnalysis.js:104`) sets `rows = comparison.dimensions` **verbatim,
  unfiltered** (`const rows = Array.isArray(comparison.dimensions) ? comparison.dimensions : []`,
  returned as `rows` in both the `none_graded` and `graded` branches).
- Card: `PostingAnalysis.jsx:203-205` renders `{r.covered}` and `of {r.total}`. **No `.filter(`,
  no `.reduce(`, no arithmetic anywhere in the added block.**

### The `na()` audit that A.3 turns on
`na()` (`dimensions.ts:348-352`) hardcodes `covered: null, total: null` then spreads `...extra`.
`extra` COULD override them, so I enumerated all seven callers —
`grep -n "na(" dimensions.ts` → `:357 :358 :361 :368 :373 :420 :473`. Read each
(`sed -n '361,380p;415,430p;468,478p'`): the `extra` objects pass only
`posting` / `matched_seqs` / `numeric_verdict` / `profile`. **No caller sets `covered` or `total`.**
So today `fit === 'not_applicable'` ⇒ `total === null` from the producer.

### The A.6 enumeration lives in `note`, not `reason`
`dimensions.ts:482` (nothing-found) and `:500-503` (`; no excerpt for: ${unevidenced.map(label)...}`)
both write **`note`**, with `reason: null` on the same object (`:483`, `:508`). The card renders
`{r.note}` raw at `PostingAnalysis.jsx:216`. Conversely every `na()` row has `reason` set and
`note: null`. That asymmetry is the subject of DEFECT-1 below.

## Cheap + deterministic tier — re-run in full by me, not taken on trust

| check | command | result |
|---|---|---|
| unit suite | `cd app && npm test` | `# tests 319 / # pass 319 / # fail 0` |
| build | `cd app && npm run build` | `✓ 245 modules transformed … ✓ built in 3.29s`, exit 0 |
| smart quotes (Python codepoint scan, all 3 touched files) | `python3` scan for U+2018/2019/201C/201D | `total smart-quote hits: 0` |

## Expensive tier — MY OWN mutations, hunting the green-suite-broken-behaviour class

Method: patch the file, `cd app && npm test`, restore, `git diff --stat` clean after each.

| # | mutation (the defect it reinstates) | AC it violates | suite |
|---|---|---|---|
| M1 | `{r.covered}` → `{(r.matched_seqs \|\| []).length}` — the numerator RECOMPUTED in the browser | **A.2, the declared tier-1 AC** | **319 pass / 0 fail — GREEN** |
| M2 | card verdict → `{r.fit === 'weak' ? 'No evidence' : fitLabel(...)}` — the prototype's collapse | **A.7** | **319 pass / 0 fail — GREEN** |
| M3 | `Number(r.total) > 0` → `\|\| true` — fabricates `0 of 0` on every ungraded dimension | **A.3** | **319 pass / 0 fail — GREEN** |
| M4 | card note → `Missing: {matched_seqs.join(', ')}` — a second, client-derived enumeration | A.6 | **318 pass / 1 fail** — `not ok 243 - H:missing-lines-are-enumerated-ONCE-by-the-api` |
| M4b | same second enumeration, relabelled `Not evidenced:` instead of `Missing:` | A.6 | **319 pass / 0 fail — GREEN** |
| M5 | `rows.map(` → `rows.slice(0, 3).map(` — 3 cards over an 8-row table | **A.1** | **319 pass / 0 fail — GREEN** |
| M6 | **delete the feature outright** — the whole card block AND the three `POSTING_HOOKS` keys | A.0-A.14 | **319 pass / 0 fail, build ✓ — GREEN** |

**M6 is the headline.** `app/src/screens/PostingAnalysis.jsx` minus the card block and
`app/src/postingAnalysis.js` minus `compareCards`/`compareCard`/`compareCardNote` compiles and
passes 319/319. **The suite protects none of this region.** The implementer's own commit message
says so ("guards deliberately NOT written yet"); this measures exactly how much that costs.

**The one guard that does bite is not this commit's.** `H:missing-lines-are-enumerated-ONCE-by-the-api`
(`app/test/postingCompare.test.mjs:344`) came in with `eae3d37` (4.2-4/4.2-13), and it fires on the
card only because it greps the whole file for the literal token `Missing:` / `.missing`. M4b shows
it is **label-shaped, not concept-shaped**: any second enumeration under a different word passes.
Its A.7 half (`:357-361`) asserts `fitLabel()` the FUNCTION and the `FIT_LABEL` values — it never
asserts the CARD calls `fitLabel`, which is why M2 is green.

## CHALLENGE TO THE AXIS DECISION — the premise is overbroad, and materially so

**The implementer's stated premise** (commit `2ec3902` message, and repeated verbatim as a code
comment at `PostingAnalysis.jsx:186-188`):
> "per-kind coverage is not a number the system produces: requirements.ts:61 makes `coverage`
> 'escalated' | null, never 'covered'."

**OBSERVATION 1 — the narrow half is true.** `grep -n "coverage" api/src/functions/tests/requirements.ts`
→ 3 hits: `:61` the type, `:332` a comment, `:410` the only writer,
`coverage: loc.char_start === null ? 'escalated' as const : null`. The FIELD never says 'covered'.

**OBSERVATION 2 — the broad claim is REFUTED by the source.** Per-kind covered-of-total is produced
by this system, deterministically, server-side, in two places, and one of them is already on screen
in this app:

| kind | producer | the number it emits | already rendered? |
|---|---|---|---|
| `must_have` | `checks.ts` → `must_have_coverage` (deterministic engine); stored `appChecks.ts:169-174` into `artifact_score.must_have_coverage` | a 0-100 coverage over `coverable` must-haves with `uncovered_requirement_seqs`; `checks.ts:756-768` is an entire comment about getting the DENOMINATOR right ("3/4 must-haves covered") | **YES** — `app/src/assetGate.js:385`: `{ key: 'must', label: 'Must-haves evidenced', value: score.must_have_coverage, source: score.must_have_source }` |
| `responsibility` | `checks.ts:811-813` → `responsibilities_addressed` | observed literally `` `${resp.length - unaddressed.length}/${resp.length} responsibilities evidenced` `` — a covered-of-total on the responsibility kind | via the checks/gate surfaces |
| `nice_to_have` | **none** — `grep -rn "nice_to_have" api/src/functions/tests/checks.ts` → **0 hits** | — | no |
| ATS keywords | `artifactScore.ts:137-141` | `null` today (`appChecks.ts:130` "there are none yet") | AC A.5 already covers this |

And `remediation.ts:30-31` states what `must_have_coverage` MEANS: *"Since C6 it is computed purely
from `evidenceOf(r)` — whether the owner's stored PROFILE evidences the requirement — and never
consults the generated document."* That is exactly the semantics the prototype's must-have card
wants. It is not a document-similarity number.

**OBSERVATION 3 — the client-side inputs are also present.** `appRequirements.ts:661` returns
`{ requirements, evidenced, unevidenced, evidenceHealth }`, every row carrying `kind` (`requirements.ts:56`)
and `evidenced: r.evidence_quote != null` (`appRequirements.ts:636`); `groupRequirements()`
(`postingAnalysis.js:366-374`) already splits `responsibilities` / `mustHaves` / `niceToHaves`.
A per-kind `n of m` is one `.filter(r => r.evidenced).length` from data the JD step holds in hand.

**INTERPRETATION — what actually survives, and it is narrower than what was claimed.**
1. The "fourth coverage number" argument is weaker than stated. `postingAnalysis.js:445` names three
   systems, the first being *"`requirement_evidence` + the P8.3 resolver"*. A per-kind card sourced
   from `requirement.evidenced` is a re-presentation of that FIRST system grouped by kind, not an
   independent fourth measurement. `must_have_coverage` is itself derived from the same predicate.
2. What DOES survive is a **scope** constraint, not an existence one: `must_have_coverage` and
   `responsibilities_addressed` are `check_result` / `artifact_score` rows keyed
   `(artifact_id, run_id)` (`appChecks.ts:169`). The JD step's comparison card has neither an
   artifact nor a run, so there is no stored per-kind number to READ at that surface — surfacing one
   there is the "new API work in `dimensions.ts`/`appRequirements.ts`" the AC's branch (B) names.
3. And computing it in the browser instead is banned outright by **AC A.0** ("It is a FAIL to ship a
   per-kind coverage number computed in the browser") and by `PostingAnalysis.jsx:66-69`.

**So: the CONCLUSION (branch A) is sound; the PREMISE as written is not.** The honest sentence is
*"per-kind coverage is not a number available on the JD step's payload without new API work, and
deriving it in the browser is banned by A.0"* — not *"not a number the system produces"*, which the
`must_have_coverage` component already visible at `assetGate.js:385` refutes. The AC author had
already graded this `EXISTS-BUT-CONSTRAINED`, not `ABSENT`
(`AC-large-medium.md`, "Per-kind coverage, **derivable on the client**" row); the commit message
restates it as absence. **This matters because the owner approved the axis on the strength of the
stronger claim.**

## /tmp/fx-cards.json — FLATTERING, and in two places NOT PRODUCIBLE

The fixture the implementer rendered for the owner has 8 dimension rows under
`/opportunity/2cb56fb3-…/requirements` → `comparison`. I diffed every row against what
`dimensions.ts` actually emits.

| row | fixture | what `dimensions.ts` produces | verdict |
|---|---|---|---|
| `hiring` | `fit: 'weak'`, `shortfall: 'falls_short'`, **`covered: 1`, `total: 1`** | `fit = gradeFit(evidenced.length, judgeable.length)` (`:489`); `gradeFit(1,1)` → `ratio 1.0 >= STRONG_AT 0.99` → **`'strong'`** (`:211-217`) | **IMPOSSIBLE.** No branch of `buildComparison` emits weak at 1-of-1. The fact path's weak is `covered: 0, total: 1` (`:437`) |
| `leadership_tenure`, `org_size`, `compliance` | `fit: 'strong'`, `basis: 'evidence'`, **note present** | `:498-499` — `const note = fit === 'strong' && !uncomparableTail ? null : …` | **IMPOSSIBLE.** A strong evidence-path row has `note: null`. On real data these three cards render **no note at all** |
| all evidence-path notes | `'2 of 2 line(s) are evidenced by your profile'` | `:500` — `` `${evidenced.length} of ${judgeable.length} line(s) this posting asks on ${d.label.toLowerCase()} are evidenced by your profile` `` | hand-written: the `this posting asks on <label>` clause is missing |
| `fedramp` | `shortfall: 'nothing_found'` but note is the falls-short template `'0 of 1 line(s) are evidenced…; no excerpt for: #6 …'` | the nothing-found branch `:482` emits a *different* sentence: `` `nothing in your profile evidences the N line(s) this posting asks on X: <enumeration>` `` | wrong template for the branch |
| every row | `dimension_version: null` | always `DIMENSION_VERSION` (`:351, :430, :483, :511`) | suppresses `comparisonStaleness` → `rowVersion null` → `rules_changed false` → **the `compareStale` banner never renders in this fixture** |
| `not_applicable` population | exactly 1 of 8 | — | thin, and it is the only row that exercises the A.3 branch |

**The consequence that matters.** The commit message's headline evidence for AC A.7 is
*"FEDRAMP 0 of 1 'Nothing found' beside HIRING AT PACE 1 of 1 'Falls short'"*. **The `hiring` row is
a state the producer cannot emit.** The two-label split is genuinely implemented — `fitLabel()` is
called and I confirm it below on my own fixtures — but the screenshot that was sent to the owner
demonstrates it with a fabricated row. This is CLAUDE.md's own self-attack check 0b #2, *"Can the
system PRODUCE your fixture? Drive the real producer or check against what it emits"*, missed.

## RENDERED LOCALLY (never live — the sandbox cannot reach `*.azurestaticapps.net`)

Harness: `node scripts/render-app.mjs --route '#/packet/2cb56fb3-…/jd' --fixtures <f> …`,
Chromium from `/opt/pw-browsers`, `app/dist` rebuilt from the pristine tree first
(`npm run build` → `✓ built in 3.17s`). **`pageErrors: []` and `unmatched: []` on every run below.**

### The fixtures are mine, and five of six were built by DRIVING THE REAL PRODUCER
`node -e "require('./api/dist/functions/tests/dimensions.js').buildComparison({...})"` — so the rows
are what `gradeFit` / the note templates actually emit, not what a hand-written fixture asserts.

| fixture | how built | `[data-qc="compare-card"]` count | dimension rows |
|---|---|---|---|
| **F1** mixed | `buildComparison` — 12 requirement lines, real evidence objects | **8** | 8 |
| **F2** all-`not_applicable` | `buildComparison({stale: true})` — the producible all-NA path (`dimensions.ts:357`) | **8** | 8 |
| **F3** unresolved | `{dimensions: [], resolved: false}` | **0** | 0 |
| **F4** one dimension | F1 sliced to 1 row | **1** | 1 |
| **F5** very long note | `buildComparison` with 12 unevidenced lines on one axis → a **1122-char** note | **8** | 8 |
| **F6** hand-made, NOT producible | `covered:null,total:5` on one row; `fit:'not_applicable'` with `covered:2,total:3` on another | **8** | 8 |

### F1 — rendered card region, verbatim from `document.body.innerText`
```
LEADERSHIP TENURE      2 of 2   Strong match
ORGANIZATION SIZE      2 of 2   Strong match
BUDGET OWNED           1 of 2   Falls short
   1 of 2 line(s) this posting asks on budget owned are evidenced by your profile;
   no excerpt for: #7 Own the engineering P&L, roughly $18M annually
COMPLIANCE OWNERSHIP   1 of 1   Strong match
PLATFORM MODERNIZATION 2 of 3   Falls short
   2 of 3 line(s) … ; no excerpt for: #12 Plan the next phase of cloud-native migration and refactor
CYCLE TIME             0 of 1   Nothing found
   nothing in your profile evidences the 1 line(s) this posting asks on cycle time: #30 Improve cycle time
DOMAIN BACKGROUND      0 of 2   Nothing found
   nothing in your profile evidences the 2 line(s) … : #22 …; #23 …
PUBLIC SECTOR          nothing to count on this dimension   Not compared
```
and the table directly beneath it, same run: `2 of 2 line(s)` / `2 of 2 line(s)` / `1 of 2 line(s)` /
`1 of 1 line(s)` / `2 of 3 line(s)` / `0 of 1 line(s)` / `0 of 2 line(s)` / (no number).
**Every pair reconciles, on real producer output.** Screenshot `/tmp/vf-f1-1440.png`.

- **A.7 confirmed on rendered output**: `Falls short` (budget owned) and `Nothing found` (cycle time)
  appear as two different words in the same grid, and `not_applicable` prints `Not compared`.
- **A.6 confirmed**: the `#7` / `#12` / `#30` / `#22` / `#23` ids and their line texts are present
  verbatim; no `Missing:` list anywhere on the page.
- Note that on REAL producer output the three strong cards carry **no note at all**
  (`dimensions.ts:498-499` sets `note: null` for strong). `/tmp/fx-cards.json` gave them one.

### A.13 responsive — measured, not assumed
`--w 1440 --count '[data-qc="compare-cols"][data-qc-cols="4"]'` → **count 1**.
`--w 700  --count '[data-qc="compare-cols"][data-qc-cols="1"]'` → **count 1**.
Screenshot `/tmp/vf-f1-700.png`: the card grid reflows 5-up → 3-up, table drops to one column, no
horizontal page scroll visible. The existing `compareColumns` rule is untouched.

### A.4 confirmed — F3
`resolved: false`, `dimensions: []` → `[data-qc="compare-card"]` **count 0**, and the
`compareEmpty` note renders its own sentence: *"This posting has not been compared to your profile
yet. Nothing has been measured - which is not the same as nothing matching…"*. No empty grid.

---

## DEFECTS FOUND (stated, not fixed)

### DEFECT-1 — the card drops the row's `reason`, so a whole producible screen becomes 8 blank tiles
**`app/src/screens/PostingAnalysis.jsx:213`** — `{r.note && (` … the card renders **only** `note`.
`CompareRow` at **`:117`** renders `{r.note || r.reason}`.
Every `not_applicable` row has `reason` set and `note: null` (`dimensions.ts:348-352`), so the card
never shows why the dimension was not compared.

**AC A.3 says**: *"then it renders no `n of m` number at all **and instead shows the row's
`reason`**."* The first half holds; the second does not.

**Producible input, not synthetic — F2, `buildComparison({..., stale: true})`
(`dimensions.ts:357`)**, i.e. any posting whose text changed since its offsets were measured. Whole
rendered card grid:
```
LEADERSHIP TENURE       nothing to count on this dimension   Not compared
ORGANIZATION SIZE       nothing to count on this dimension   Not compared
BUDGET OWNED            nothing to count on this dimension   Not compared
COMPLIANCE OWNERSHIP    nothing to count on this dimension   Not compared
PLATFORM MODERNIZATION  nothing to count on this dimension   Not compared
CYCLE TIME              nothing to count on this dimension   Not compared
DOMAIN BACKGROUND       nothing to count on this dimension   Not compared
PUBLIC SECTOR           nothing to count on this dimension   Not compared
```
Eight identical, information-free tiles. The table below each one says
*"the posting changed since these offsets were measured, so nothing here has been compared."*
Also visible on the single NA row in F1 (`PUBLIC SECTOR`, reason *"this posting does not ask about
public sector"*, absent from the card) and on 7 of 8 cards in F5.

### DEFECT-2 — the card and the row use DIFFERENT guards for the same number
**Card `PostingAnalysis.jsx:200`**: `Number.isFinite(Number(r.total)) && Number(r.total) > 0`
**Row  `PostingAnalysis.jsx:104`**: `!na && r.total`
The row's guard excludes `not_applicable`; the card's does not.

Trigger (F6, exact input): a dimension row with `fit: 'not_applicable'`, `covered: 2`, `total: 3`.
Rendered, same page, same run:
- **card** → `2 of 3` under the heading `Not compared`
- **table row** → the fit column shows `Not compared` and **no number at all**

That is the two-consumers-of-one-number disagreement AC A.2's rationale exists to prevent
(*"the KPI shows 51 but the hero still shows 216"*). I could NOT produce that row from
`buildComparison` today — all seven `na()` call sites pass `covered: null, total: null` — so this is
a **latent** divergence in a **stored-row** payload (`loadComparison` is a straight column
passthrough of whatever is in `comparison_dimension`, including rows written at
`dimension_version: 1`). Latent, but it is the guard, not the producer, that AC A.2 asks about.

Second F6 input, `covered: null, total: 5`: the card renders a **blank 22px bold numerator** followed
by `of 5`. The table renders `of 5 line(s)` — equally blank, so this one is a shared pre-existing
shape rather than something the cards introduced.

### DEFECT-3 (layout, producible) — one long note stretches four sibling cards into ~740px of white
F5: 12 unevidenced lines on one axis → a 1122-char note (`dimensions.ts:482`, no truncation
server-side, none client-side). Screenshot `/tmp/vf-f5-1440.png`: the COMPLIANCE OWNERSHIP card
grows to roughly 740px and, because CSS grid stretches a row to its tallest item, the four cards
beside it become 740px of empty box. 12 unevidenced lines on one dimension of a long posting is an
ordinary state, not an edge case. `/tmp/fx-cards.json`'s longest note is 132 characters, which is
why this never showed up in the render sent to the owner.

### OBSERVATION (not a defect against any AC as written) — the enumeration now appears TWICE per screen
`/tmp/vf-f1-1440.png`: *"1 of 2 line(s) this posting asks on budget owned … no excerpt for: #7 Own
the engineering P&L, roughly $18M annually"* is printed in the BUDGET OWNED **card** and again under
the Budget owned **table row**. AC A.6's prohibition is on a *"second, independently-derived list"* —
this is the identical API string rendered twice, so it passes the letter of A.6. It does sit against
the AC's stated rationale (*"Two enumerations of one fact is the divergence…"*) and it is a treatment
decision the owner is being asked to confirm, so it is recorded rather than graded.

### OBSERVATION — `--scrollto` fails silently
`scripts/render-app.mjs:101`: `const el = document.querySelector(sel); if (el) el.scrollIntoView(...)`.
A selector that matches nothing produces a top-of-page screenshot and no warning, which reads as
"the region is missing". It is not reported in the JSON summary the way `unmatched` fixtures are.

## The two hook-hygiene mutations DO fail — this is the one guarded thing here

| # | mutation | suite |
|---|---|---|
| M7 | `compareCard: 'compare-card'` → `'qc-rail'` (collides with `QC_HOOKS.rail`) | **317 pass / 2 fail** |
| M8 | delete `data-qc={POSTING_HOOKS.compareCardNote}` from the JSX (declared, never rendered) | **317 pass / 2 fail** |

So **AC A.12 is mutation-proven**. A.1, A.2, A.3, A.7 are not — M5, M1, M3, M2 are all green.

## Which ACs still pass if the feature is DELETED (measured, M6)

| still passes with the cards gone | why |
|---|---|
| A.0, A.4, A.5, A.14 | all are prohibitions ("no browser-computed count", "card region absent", "no invented ATS number"). Vacuously satisfied by absence — **absent evidence, not a pass** |
| A.6, A.7 | satisfied by `CompareRow`, which pre-dates this commit; their guard (`postingCompare.test.mjs:344`) passes either way |
| A.8, A.9, A.10, A.11 | 4.2-13 — shipped in `eae3d37`, untouched by `2ec3902` |
| A.12, A.13 | no new hooks to check; `compareColumns` untouched |
| **A.1, A.2** | **the only two that genuinely require the cards to exist — and neither has a guard** |

## Verdict table

| # | claim | verdict | evidence |
|---|---|---|---|
| 1 | one card per dimension row; grid reflows auto-fit/minmax 190px | **CONFIRMED** | `[data-qc="compare-card"]` count = 8/8, 1/1, 0/0 rows across F1/F4/F3; `--w 1440` renders 5-up, `--w 700` 3-up (`/tmp/vf-f1-1440.png`, `/tmp/vf-f1-700.png`), no horizontal page scroll |
| 2 | `covered`/`total` READ from the payload, never recomputed (**tier-1 A.2**) | **CONFIRMED as built, UNGUARDED, and the guard DIVERGES from the table's** | chain: `dimensions.ts:430/437/483/511` → `appDimensions.ts:228` column passthrough → `postingAnalysis.js:104` verbatim `comparison.dimensions` → `PostingAnalysis.jsx:203-205`. Zero `.filter(`/`.reduce(` in the file. All 8 card pairs equal the table's on real producer output. **But M1 (recompute from `matched_seqs.length`) is 319/319 GREEN, and DEFECT-2 makes card and row disagree on `not_applicable` + `total>0`** |
| 3 | no fabricated `0 of 0`; "nothing to count on this dimension" instead | **CONFIRMED for the number; the AC (A.3) is REFUTED on its second half** | F1/F2 render "nothing to count on this dimension", never `0 of 0`. **DEFECT-1: `PostingAnalysis.jsx:213` drops `r.reason`, which A.3 explicitly requires** — F2 (`stale:true`, producible) renders 8 blank tiles. M3 green |
| 4 | `fitLabel(fit, shortfall)`; `weak` = two words; `not_applicable` its own | **CONFIRMED, UNGUARDED** | F1 rendered: `Falls short` (budget owned 1 of 2) and `Nothing found` (cycle time 0 of 1) side by side; `Not compared` on public sector. **M2 (hardcode `'No evidence'` for weak) is 319/319 GREEN** — the existing guard asserts `fitLabel()` the function, never that the card calls it |
| 5 | API enumeration verbatim; no second derived `Missing:` list | **CONFIRMED, partially guarded** | F1 card notes carry `#7`, `#12`, `#30`, `#22`, `#23` with their line texts, byte-identical to `dimensions.ts:482/500-503` output. No `Missing:` on the page. M4 fails (`H:missing-lines-are-enumerated-ONCE-by-the-api`); **M4b — the same second list relabelled `Not evidenced:` — is GREEN**, so the guard is label-shaped |
| 6 | every card figure reconciles with the table below | **CONFIRMED on producible data; REFUTED as a structural guarantee** | both grids `rows.map` the same `rows` const, so the COUNT cannot diverge (M5 notwithstanding). But the display GUARDS differ (`:200` vs `:104`) — F6, `fit:'not_applicable'` + `covered:2,total:3`: card prints `2 of 3`, the row prints no number |
| 7 | hook hygiene — new keys rendered, none hand-typed, no cross-screen collision | **CONFIRMED, and mutation-proven** | three new keys at `postingAnalysis.js:66-68`, all rendered; `every POSTING_HOOKS selector is rendered…` + `no hook value collides across the three screens` pass; M7 and M8 each fail 2 tests |
| 8 | regression: `compareSummary`, 4-col table, `COMPARE_SCOPE_NOTE`, tabs/columns pref, `openQc` + `compareOpenQc` | **CONFIRMED** | F1 rendered text contains `3 strong · 0 moderate · 4 weak · 1 not compared (Public sector), not counted either way`; `DIMENSION / THE POSTING ASKS FOR / YOUR PROFILE EVIDENCES / FIT`; `Fit is graded against your stored profile only…`; `Show as columns`; `See how the assets answer these →` **and** `See where each one is answered →` (distinct labels, distinct hooks); `Your dimension set for engineering.`; `postingAnalysis.test.mjs` + `postingCompare.test.mjs` pass unmodified inside 319/319 |
| — | **the axis premise**: "per-kind coverage is not a number the system produces" | **REFUTED as written; the CONCLUSION (branch A) survives** | `checks.ts:811-813` emits `` `${resp.length - unaddressed.length}/${resp.length} responsibilities evidenced` ``; `must_have_coverage` is a stored per-kind coverage (`appChecks.ts:169-174`) already rendered at `app/src/assetGate.js:385` as "Must-haves evidenced", and `remediation.ts:30-31` says it measures *the PROFILE*, not the document. What survives is scope — those rows are keyed `(artifact_id, run_id)`, which the JD step has neither of — plus AC A.0's browser-computation ban |
| — | `/tmp/fx-cards.json`, the fixture shown to the owner | **FLATTERING, and two rows are NOT PRODUCIBLE** | `hiring`: `weak` at `covered:1,total:1` — `gradeFit(1,1)` returns `'strong'` (`:211-217`), and it is the commit message's headline proof for A.7. Three `strong` rows carry notes that `:498-499` sets to `null`. Note wording omits the producer's `this posting asks on <label>` clause. `dimension_version: null` on every row suppresses the `compareStale` banner |
| — | A.11 accessibility on anything NEW | **NOT_APPLICABLE** | the cards add no interactive control — plain `div`s, no `onClick`, no `role`. The only QC control (`:271-274`, `role="button"`, `tabIndex={0}`, Enter/Space) came in `eae3d37`, not `2ec3902` |
| — | `scripts/compare-ui.mjs` pinned control count (AC blast radius) | **NOT_APPLICABLE** | `grep -nE "expect\|count\|EXPECTED" scripts/compare-ui.mjs` → it collects an inventory, it pins no expected count |
| — | live behaviour on `purple-ground-…azurestaticapps.net` | **UNPROVABLE-HERE** | sandbox egress blocks `*.azurestaticapps.net`; `2ec3902` is on `claude/three-small-ui-gaps`, and `executive-engine-deploy.yml` fires on `main` only, so this is not deployed |

**Bottom line.** The implementation does what claims 1, 4, 5, 7 and 8 say, on real producer output.
Claim 2 is true of the code as written and **is the single least protected thing in the change** —
M1 recomputes the tier-1 number in the browser with 319/319 green. Claim 3 renders no fabricated
zero but does not satisfy AC A.3, which asks for the reason as well; on a stale posting that costs
the entire card grid its content. Claim 6 holds by construction for the row COUNT but not for the
number GUARD. The axis premise the owner approved on is overbroad against the source.

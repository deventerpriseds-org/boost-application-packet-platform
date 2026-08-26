# VERIFY-f-guards — independent verification of the three F-guards (commit 34eda36)

Verifier: independent subagent. No shared context with the implementing agent.
Repo HEAD at start: 26ce997 (== origin/main). Branch: claude/three-small-ui-gaps.
Started: (in progress)

Scope: check the THREE GUARDS added to close prior verifier findings F-1/F-2/F-3
(`docs/qc-evidence/VERIFY-groups-bc.md`). NOT a re-verification of Groups B/C.

Method: every mutation run under `trap ... EXIT` restore; `git diff --stat` asserted
empty after each. Exact pass/fail counts recorded, never "should".

---

## Log

### Baseline (unmutated, HEAD 26ce997)

| suite | command | observed |
|---|---|---|
| node unit | `cd app && npm test` | `# pass 343  # fail 0` — 343/343 |
| tally probe | `cd app && npm run test:tally` | `50/50 checks passed`, incl. `PASS the score heading NAMES the asset the score belongs to` |

`git status --short` clean, HEAD == origin/main == 26ce997.

### What the three guards actually are (read from source, not from the commit message)

- **F-1** — `app/test/browser/run-keyword-tally.mjs:155-160`. On the `scored` case it reads
  `[data-qc="tally-qc-score"] > div` (first child = the heading), strips `/^match score\s*[-–—:]?\s*/i`,
  and asserts the remainder is non-empty AND `=== ` (case-insensitively) the text of
  `[data-qc="tally-qc-asset"][data-qc-type="resume"] span` (the resume row's label).
- **F-2** — `app/test/qcRail.test.mjs:1402-1420`, `H:band-tone-fails-closed`. Imports `bandTone`
  from `../src/assetGate.js`; asserts `strong→green`, `acceptable→yellow`, and that 10 other
  inputs (`'weak','poor','unknown','',null,undefined,'STRONG','Strong',0,'pass'`) all → `red`.
- **F-3** — `app/test/qcRail.test.mjs:1375-1388`, inside `H:tally-two-empties-two-sentences`.
  Two additions: (a) distinctness now over `sentence + ' || ' + detail` across all `cases`;
  (b) a `neverRan` model built from `resume(null)` and asserted same `state` but different
  `detail` from `cases.not_scored`.

**Provenance of the two sides of the F-1 comparison (the circularity question, answered):**
`qcRail.js:923` sets `subject = assetLabel(scoredType)`. The row label is
`e.label || assetLabel(e.type)` (`qcRail.js:932`). In the probe fixture
(`test/browser/keyword-tally-probe.jsx:24,78`) the entry carries a **hardcoded literal**
`'Resume'`, so the row side does NOT flow through `assetLabel()` in this test — the two sides
have different sources here. The comparison is therefore not trivially circular. Whether it is
circular in a way that matters is tested below (M1c/M1d).

### F-2 — `H:band-tone-fails-closed` (mutations run by me, not replays)

All under `trap restore EXIT`; `git diff --stat` on `app/src/*` empty after every run.

| id | mutation to `app/src/assetGate.js:397` | observed | verdict |
|---|---|---|---|
| M2a | final `'red'` → `'green'` | `# pass 342 # fail 1`, `not ok 334 - H:band-tone-fails-closed` | guard FIRES (matches claim exactly) |
| M2b | `acceptable → 'yellow'` changed to `'green'` | `# pass 342 # fail 1`, `not ok 334` | guard FIRES |
| M2c | whole fn made case-tolerant (`String(band).toLowerCase()`) | `# pass 342 # fail 1`, `not ok 334` | guard FIRES — the `'STRONG'`/`'Strong'` cases are load-bearing, not decoration |
| M2d | rewritten as a `BAND_TONE` lookup map + `hasOwnProperty` guard (behaviour-identical refactor) | `# pass 343 # fail 0` | does NOT cry wolf |

F-2 claim (`flip final 'red'→'green'` ⇒ `not ok 334`, baseline 343/0): **CONFIRMED**, exact
count match. The guard also catches two mutations the implementer never tried, and survives a
legitimate refactor.

### F-3 — strengthened `H:tally-two-empties-two-sentences`

| id | mutation to `app/src/qcRail.js` | observed | verdict |
|---|---|---|---|
| M3a | branch-1's `detail` copied over branch-2's | `# pass 341 # fail 2`, incl. `not ok 333 - H:tally-two-empties-two-sentences` | guard FIRES (matches claim) |
| M3b | **the two details SWAPPED** — never-ran now says "The checks ran but stored no score row", ran-and-stored-nothing now says "The checks have not been run" | `# pass 343 # fail 0` | **GUARD IS INERT** |
| M3c | branch-2 reworded, same meaning ("The run happened and stored no score row…") | `# pass 343 # fail 0` | does NOT cry wolf |
| M3d | branch-1's detail := branch-2's detail + a trailing space | `# pass 343 # fail 0` | trivial-distinctness hole (renders identically in HTML) |

(M3a was measured in a first sweep whose restore path was wrong, so it ran stacked on the M2a
mutation — hence `fail 2`. `not ok 333` is `H:tally-two-empties-two-sentences` and is independent
of `assetGate.js`, so the data point stands. Tree was restored to clean and re-verified before the
second sweep; all M2b–M3d rows above come from the clean sweep.)

F-3 claim (copying branch-1's detail over branch-2 ⇒ `not ok 333`): **CONFIRMED**.
But see NEW DEFECT 1 (M3b) and NEW DEFECT 2 (fixture reachability) below.

### F-1 — `the score heading NAMES the asset the score belongs to` (`run-keyword-tally.mjs:155-160`)

All under `trap restore EXIT`; `git diff --stat -- app/src` empty after every run.

| id | mutation | observed | verdict |
|---|---|---|---|
| M1a | delete `{model.subject}` from `PostingAnalysis.jsx:809` | `49/50`, `FAIL … head="MATCH SCORE" subject="" row="Resume"` | guard FIRES — exact match to the claimed measurement |
| M1b | heading hardcodes the WRONG asset: `Match score - Cover letter` | `49/50`, `FAIL … subject="COVER LETTER" row="Resume"` | guard FIRES — so the comparison is **not** trivially circular |
| M1c | heading stops reading `model.subject` and hardcodes a row lookup: `{(model.rows.find(r => r.type === 'resume')||{}).label}` | tally `50/50`, `npm test` `343/0`, `test:posting` `26/26` | **GUARD IS INERT** |
| M1d | upstream: `qcRail.js:923` `assetLabel(scoredType)` → `assetLabel('resume')` (ignores the caller's `scoredType` entirely) | tally `50/50`, `npm test` `343/0` | **GUARD IS INERT — and so is the whole suite** |
| M1e | separator → em dash AND `{model.subject}` wrapped in a `<span>` | `50/50` | does NOT cry wolf (extends the implementer's counter-proof) |
| M1f | `ASSET_LABEL.resume` `'Resume'` → `'Resume (CV)'` — a pure user-facing copy rename | `48/50`, `FAIL … head="MATCH SCORE - RESUME (CV)" subject="RESUME (CV)" row="Resume"` | **CRIES WOLF** |

F-1 claim (delete `{model.subject}` ⇒ tally FAILs at 49/50 with `subject="" row="Resume"`;
em-dash counter-proof still 50/50): **CONFIRMED**, exact count and exact detail string.

But two of the three things asked about it are **REFUTED**:

**(a) The comment's cry-wolf claim is false.** `run-keyword-tally.mjs:151` states: *"renaming the
label moves both sides together, so this cannot cry wolf on a copy change."* That is true of
PRODUCTION — `useQcEntries` (`QcRail.jsx:120`) emits `label: assetLabel(a.type)`, the same source
as `subject`. It is **not** true of the fixture the guard actually runs against: the probe entry
(`keyword-tally-probe.jsx:24,78`) carries a hardcoded literal `'Resume'`. So the two sides move
together everywhere except in the one place the assertion executes. M1f is a rename a product
owner could legitimately ask for, and it turns the suite red at 48/50 (it also takes a
pre-existing sibling assertion, *"the score says which asset it belongs to"*, down with it — so
the fixture-literal coupling is wider than the new guard).

**(b) The guard does not prove the property its own comment names.** The comment says the heading
*"names the asset because a packet has several and only one carries the score."* What the
assertion actually proves is *"the heading's tail is non-empty and equals the **resume row's**
label."* Because the probe hardcodes `scoredType: RESUME` and `scored: e[0]` (the resume), those
two propositions are indistinguishable in this fixture. M1c and M1d both sever the link between
the heading and the scored asset and every suite stays green.

M1d is the more serious of the two: `scoredType` can be discarded at the model, and `npm test`
stays 343/0 because **every one of the 11 `qcSummaryModel` call sites in the test suite passes
`scoredType: 'resume'`** (`test/qcRail.test.mjs:1365-1458`), and the one direct subject assertion
is `assert.equal(m.subject, 'Resume')` (`:1450`) — satisfied by a hardcoded `assetLabel('resume')`.

Honest caveat, stated so it is not oversold: **M1c and M1d are latent, not currently user-visible.**
`PacketBuilder.jsx:444` hardcodes `SCORED_TYPE = 'resume'` today, so all three variants render the
same string right now. They matter because the code beside that literal says the opposite:
*"Which artifact carries the packet's headline score is a behaviour-affecting choice the owner may
one day want to make in Settings."* The day it moves to Settings, the heading keeps saying
"Resume" for a cover-letter score and no test in the repo notices.

### Adversarial checks that came back CLEAN (hypotheses I tried to prove and could not)

- **A second, un-refactored copy of the band ternary.** `grep -rn "'strong'" app/src` returns
  exactly one other hit, `OppDetail.jsx:741`, and it is a different concept (`q.strength`, values
  `strong`/`gap`/other). `bandTone` has no unguarded sibling. The three claimed consumers are real
  and all import it: `QcRail.jsx:856`, `AssetGateDrawer.jsx:369`, `PostingAnalysis.jsx:813`.
- **F-2 crying wolf on a refactor.** M2d (lookup map) → 343/0.
- **F-3 crying wolf on a reword.** M3c → 343/0.
- **F-1 crying wolf on markup/punctuation change.** M1e → 50/50.

### NEW DEFECT 1 — F-3 is blind to the two details being SWAPPED (M3b)

`assert.notEqual(neverRan.detail, ranNoRow.detail)` asserts only that the two strings DIFFER. It
does not tie either string to the branch it belongs to. Swapping them (M3b) leaves `npm test` at
**343/0** while the screen now tells a user with an unchecked artifact *"The checks ran but stored
no score row"* and a user whose run stored nothing *"The checks have not been run"* — an inversion
of exactly the never-ran / ran-and-discarded distinction the guard's own comment calls "the whole
point". Same class as the finding it was written to close: the fact is asserted, the ATTRIBUTION
is not.

Fix shape: assert the content, not the difference — e.g. `assert.match(neverRan.detail, /have not
been run/)` and `assert.match(ranNoRow.detail, /ran but stored no score row/)`. That also closes
M3d (a trailing space satisfies `notEqual` while rendering identically in HTML).

### NEW DEFECT 2 — F-3's `neverRan` fixture is NOT producible by the real producer

`neverRan` is `resume(null)` → `{ result: null, resultLoading: false, resultError: null }`. I
traced every producer of that shape and found no path that emits it:

- `qcSummaryModel` has exactly one non-test caller: `PacketBuilder.jsx:449`, fed by
  `useQcEntries` (`grep -rn qcSummaryModel app/src`).
- `useQcEntries` (`QcRail.jsx:99-130`) sets `result: c.data`, `resultLoading: c.loading`,
  `resultError: c.error`. `c` is seeded `{loading:true,error:null,data:null}` → that is the
  `reading` state, not this one. It resolves to `{loading:false,error:null,data:r}` from
  `api.artifactChecksResult`, or `{loading:false,error:errText(e),data:null}` on rejection → the
  `unreadable` state.
- `api.artifactChecksResult` → `get()` (`api.js:67-71`) throws on `!res.ok`, else `res.json()`.
- The handler `artifactChecksGet` (`api/src/functions/tests/appChecks.ts`) has four returns:
  `204` (OPTIONS only), `404` and `500` (both `!res.ok` → throw → `resultError`), and `200` with
  an always-present `jsonBody` object. A 200 therefore never yields a falsy `result`.
- The only other writer, `setResult(artifactId, fresh)` (`QcRail.jsx:132`), is called from
  `refreshOne` (`:761`) and the drawer's `refresh` (`AssetGateDrawer.jsx:466`) — both pass the
  awaited `artifactChecksResult` payload.

So the non-loading arm of `if (!scored.result)` (`qcRail.js:961-973`) is unreachable in production
today, and the second half of F-3 pins a distinction between one live state and one dead one. The
commit message's justification — *"`score: null` on every production artifact means the app lives
in exactly these two states today"* — is true of branch 2 (`result.score` null) but **not** of
branch 1, which needs `result` itself to be null with neither a load nor an error in flight.

This is a pre-existing property of the branch, not something the guard introduced; the guard's
first half (the `claims` distinctness over the six `cases`) covers six states that ARE all
reachable. But as asked: yes, one of F-3's two assertions runs on a fixture the producer cannot
emit.

### Environment note

During the second sweep `git diff --stat` briefly reported `CLAUDE.md | 22 +++---` between two
runs and was clean again afterwards. I never touched `CLAUDE.md`; the mutated files
(`app/src/assetGate.js`, `app/src/qcRail.js`) restored to empty diff every time. Flagging it
because a concurrent writer in this container can corrupt a mutation sweep's evidence.

### Verdict

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1 | F-1: deleting `{model.subject}` makes `test:tally` FAIL at 49/50, `subject="" row="Resume"`; em-dash counter-proof still 50/50 | **CONFIRMED** | M1a `49/50 FAIL … head="MATCH SCORE" subject="" row="Resume"`; M1e `50/50` |
| 1b | F-1 comment: "cannot cry wolf on a copy change" | **REFUTED** | M1f — `ASSET_LABEL.resume` rename → `48/50`, two assertions red |
| 1c | F-1 proves the heading names the SCORED asset (the circularity question) | **REFUTED — guard is inert here** | M1c and M1d both green across tally 50/50, node 343/0, posting 26/26 |
| 2 | F-2: flipping final `'red'`→`'green'` ⇒ `not ok 334`, baseline 343/0 | **CONFIRMED** | M2a `342/1 not ok 334`; also catches M2b, M2c; M2d refactor stays 343/0 |
| 3 | F-3: copying branch-1's `detail` over branch-2 ⇒ `not ok 333` | **CONFIRMED** | M3a `not ok 333`; M3c reword stays 343/0 |
| 3b | F-3's second assertion is meaningful | **PARTIALLY CONFIRMED** | inert to a SWAP (M3b, 343/0); fixture not producible (traced above) |

**Baselines re-measured, not taken on trust: `npm test` 343/343, `npm run test:tally` 50/50.**

Working tree left clean: `git status --short` shows only this evidence file (untracked).

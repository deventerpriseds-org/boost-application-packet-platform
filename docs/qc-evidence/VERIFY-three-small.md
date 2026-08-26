# VERIFY-three-small — independent verification of `claude/three-small-ui-gaps`

Verifier agent. No shared context with the implementer. Written incrementally.

Branch: `claude/three-small-ui-gaps` — commits `2de4ae5`, `3101025`, `8d721a0` on `5e79581`.
Started: (in progress)

## Log

- [start] `git log --oneline -6` confirms the three commits exist on the branch, in the claimed order,
  on top of `5e79581`:
```
8d721a0 4.8-10: "Needs a decision" on the QC page, beside what the run settled
3101025 4.5-40: static blocks show the {{merge field}} inline, and stop contradicting it
2de4ae5 4.1-3: the JD step gets its only route into QC
02b8cd6 Loop-2 verification of F5 closes ...
5e79581 Loop-2 verifier work in flight ...
```
  `git status --short`: only two UNTRACKED files (`docs/qc-evidence/loop2-claims-2-5-6.mjs`,
  `docs/qc-evidence/loop2-safety-floor.mjs`) — no uncommitted modifications to the touched source.

## TIER: CHEAP + DETERMINISTIC — re-run in full by the verifier, not taken on the implementer's word

| Command (cwd) | Observed output | Verdict |
|---|---|---|
| `cd app && npm test` | `# tests 311 / # pass 311 / # fail 0 / duration_ms 903.166231` | matches the implementer's claim (311/0) |
| `cd app && npm run build` | `vite v5.4.21 ... 245 modules transformed ... built in 4.28s`, `dist/assets/index-B4gXmUqE.js 1,126.97 kB` — no error | clean |
| smart-quote codepoint scan (python3, U+2018/19/201C/201D) over all 10 touched files | `TOTAL SMART-QUOTE HITS: 0` | clean |
| `cd api && npm test` | `# tests 843 / # pass 843 / # fail 0` | api side green |
| `git diff 5e79581..HEAD -- api/ \| wc -l` | `0` | **`api/` is literally untouched by the three commits** — zero diff bytes, not merely "no logic change" |
| `cd api && npm run build` | `> tsc` and no diagnostics | clean |

**RADIUS CHALLENGE, part 1 — `api/` exclusion ACCEPTED, and on a stronger ground than the implementer gave.**
The implementer argued "no `api/` file was touched". The stronger proof is that `git diff 5e79581..HEAD -- api/`
emits **zero bytes**, so no `api/` behaviour can have changed by construction. `api` suite re-run anyway
(843/843) per 0c's cheap-tier rule.

---

## CLAIMS 1-5 — gap 4.1-3 (`See where each one is answered ->`)

**Claim 1 — control exists, navigates via `onOpenQc` -> `setActiveStep`, no router in the card. CONFIRMED.**
- `app/src/screens/PostingAnalysis.jsx:552-559` renders the control, hook `data-qc={POSTING_HOOKS.openQc}`,
  `onClick={onOpenQc}`.
- `app/src/postingAnalysis.js:35` — `openQc: 'jd-open-qc'` added to `POSTING_HOOKS`.
- `app/src/screens/PacketBuilder.jsx:842` — `onOpenQc={() => setActiveStep('qc')}`.
- `PacketBuilder.jsx:396-399` — `setActiveStep` calls `go('/packet/${id}/${key}')` after validating
  `key` against `STEPS`; `state.jsx:32` — `go` sets `window.location.hash` to `#/packet/<id>/qc`.
  So the hash target is confirmed by reading the chain, not by inference from the prop name.
- **No router in the card**, verified with a stricter grep than the implementer's test uses:
  `grep -nE "\bgo\s*\(|from '\.\./state|state\.jsx|useNavigate|location\.hash" app/src/screens/PostingAnalysis.jsx`
  -> `exit=1`, no output.

**Claim 2 — HIDDEN, not inert, on no requirements / `reqError`. CONFIRMED.**
`PostingAnalysis.jsx:551`: `{onOpenQc && !reqError && rows.length > 0 && (`. `rows` is
`groupRequirements(req?.requirements || []).all` (`PostingAnalysis.jsx:494-495`;
`postingAnalysis.js:363-376` returns `all` = the input array). So `req == null`, `req.requirements == []`,
or `reqError` truthy each collapse the whole element — nothing inert is rendered.

**Claim 3 — keyboard-reachable and visible to `compare-ui.mjs`. CONFIRMED.**
The control tag carries `role="button" tabIndex={0}` and
`onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenQc() } }}`.
`scripts/compare-ui.mjs:115` collects `document.querySelectorAll('button, [role="button"], a')`, so a
`role="button"` span IS collected. Two further filters on :116-117 were checked and the control survives
both: `.filter((t) => t && t.length < 40)` — the collected text is `See where each one is answered →`
(31 chars), and `!/@/.test(t)`. **Also checked, because the AC named it as a blast-radius risk:**
`compare-ui.mjs` has **no pinned expected control count** (`grep -nE "expected|EXPECTED|assert|toEqual"`
-> only two unrelated length filters), so adding a control cannot break it.

**Claim 11 — the mono slot label survives. CONFIRMED.**
`AssetBlocks.jsx:582-583` still renders `data-qc={BLOCK_HOOKS.fieldSlot}` with `{row.merge_field}` in a
monospace font stack. The `{{token}}` at `:404-406` is a second, separate element with its own new hook
`BLOCK_HOOKS.fieldPlaceholder`. Addition, not replacement.

**Claim 9 (first half) — the contradictory sentence is gone. CONFIRMED.**
`grep -rn "pipeline cannot see that text" app/src/` returns exactly ONE hit,
`app/src/screens/AssetBlocks.jsx:397`, and it is inside a `//` comment explaining the removal — not
inside any rendered JSX string.

---

## DEFECT F-1 (found by the verifier, NOT fixed) — the region prints "Nothing is waiting on you. Every check that could run is clear." while it is listing open findings

**Severity: this is the vacuous-green class AC 1.8 exists to prevent, arriving through the door AC 1.8
did not cover.** AC 1.8 forbids calling an *unchecked* packet *clear*. This is the same laundering one
step over: the footer calls the packet clear while the region **directly above it is rendering two
`CheckRow` findings**.

**Where.**
- `app/src/qcRail.js:662` — `anyOpen: assets.some((a) => a.status === 'open')`. An asset with findings
  but **no gate row** gets `status === 'unchecked'` (`qcRail.js:634-637`), never `'open'`, even though
  `a.rows` holds its findings. So `anyOpen` is **false** on a screen that lists rows.
- `app/src/screens/QcRail.jsx:704-709` — the footer renders on `{!model.anyOpen && (`, and picks its
  sentence on `model.anyChecked` alone. `anyChecked` is `totals.checked > 0`, which any OTHER checked
  asset satisfies.

**The input that triggers it** (`railGate` returns `'unchecked'` for `gate == null`, `qcRail.js:111-114`):
```js
[ { artifact:{id:'A'}, label:'A', result:{ gate:null,   attention:2, results:[failDet, failRev] } },
  { artifact:{id:'B'}, label:'B', result:{ gate:'pass', attention:0, results:[pass]           } } ]
```

**Observed** (`node` against the real `app/src/qcRail.js`, not a model of it):
```
statuses      : [ 'unchecked', 'clear' ]
A.rows.length : 2
A.anomalies   : [ 'this asset has no gate row, so its 2 open finding(s) are in neither number above ...' ]
d.rows        : 0   d.uncounted: 2
anyOpen       : false
anyChecked    : true
--> footer branch taken: "Nothing is waiting on you. Every check that could run is clear."
```

So the rendered region contains, top to bottom: asset A's two open `CheckRow`s + the anomaly note,
asset B's clear note, and then **"Nothing is waiting on you. Every check that could run is clear."**
Both halves of that sentence are false on that screen — two findings ARE waiting, and asset A's checks
never ran, so "every check that could run is clear" is absent evidence reported as a pass.

**A second, milder variant of the same root cause:** with asset A alone (`anyChecked === false`), the
footer reads *"No asset in this packet has been checked yet, so nothing has been decided either way."*
directly under two listed findings. Less false, still a footer implying emptiness over rendered rows.

**Why no guard catches it.** `H:decisions-report-the-uncounted` asserts on the MODULE's output
(`rows`, `uncounted`, `anomalies`) and never touches `anyOpen`; the footer's two sentences live in JSX
and are exercised by no test. The suite is **311/311 green with this defect live** — this is exactly
the "green while broken" class the brief asked me to hunt for.

**Not fixed, per the brief.** The narrow fix is for `anyOpen` to reflect any asset with rows
(`a.rows.length > 0`) rather than `status === 'open'`; the guard that would have caught it is an
assertion that the footer's clear-sentence branch is unreachable whenever `uncounted > 0`.

---

## INDEPENDENT MUTATION SWEEP (verifier's own list, not the implementer's)

Harness: apply the mutation to the working tree, run `cd app && npm test`, restore the file, report
`# pass` / `# fail`. Restore verified with `git diff --stat` after the first run (only this evidence
file was modified). A mutation that leaves the suite GREEN while breaking real behaviour is the
failure class this repo has actually paid for.

| # | Mutation | Real-world effect | Result |
|---|---|---|---|
| A | delete `onOpenQc={() => setActiveStep('qc')}` from `app/src/screens/PacketBuilder.jsx:842` | **The 4.1-3 control never renders at all** — the gate is `onOpenQc && …`, so the whole feature silently disappears from the live app | **311 pass / 0 fail — GREEN WHILE BROKEN** |
| B | `setActiveStep('qc')` -> `setActiveStep('jd')` in the same prop | the control renders and navigates to the **wrong step** — it re-opens the JD step it is already on | **311 pass / 0 fail — GREEN WHILE BROKEN** |
| C | delete the `<span data-qc={BLOCK_HOOKS.fieldPlaceholder}>` element from `AssetBlocks.jsx` | the 4.5-40 `{{token}}` never renders | 309 pass / **2 fail** — caught |
| F | `{DECISION_NOTE[a.status]}` -> `{DECISION_NOTE.clear}` in `QcRail.jsx:684` | **an UNCHECKED asset is reported to the owner as "Every check that could run is clear."** — verbatim the AC 1.8 vacuous-green failure | **311 pass / 0 fail — GREEN WHILE BROKEN** |
| G | delete the `{a.status === 'error' && (…)}` block from `QcRail.jsx:678-683` | an asset whose findings could not be read is silently omitted | 310 pass / **1 fail** — caught (incidentally, by the "every `QC_HOOKS` key is rendered" hygiene test, not by a semantic guard) |

### DEFECT F-2 — the 4.1-3 feature has NO guard on the half that makes it work

Mutations **A** and **B** both ship a dead or wrong control with a fully green suite. Every 4.1-3
assertion in `app/test/postingAnalysis.test.mjs:750-800` greps **`PostingAnalysis.jsx` only**. Nothing
anywhere asserts that `PacketBuilder.jsx` passes `onOpenQc`, or that what it passes calls
`setActiveStep('qc')`. This is structurally the same blind spot the implementer's own commit message
identifies elsewhere ("the existing 'computes nothing' guard … greps `QcRail.jsx` only") — it was fixed
for 4.8-10 and left open here.

Note the AC doc anticipated this exactly: AC 3.1 is *"it navigates for real"*, and its verification row
says **"Run (i) alone does not prove 3.1 — it proves the words are on screen, which is exactly the
dead-UI failure the standing rule names."** No harness in this branch closes that.

### DEFECT F-3 — claim 15's four-states guarantee is asserted on the module, never on the screen

Mutation **F** is green. `H:decisions-empty-is-not-one-sentence` asserts `DECISION_NOTE.clear !==
DECISION_NOTE.unchecked` and that `railDecisions()` returns the right `status` string — but nothing
asserts the JSX **looks the sentence up by that status**. The four sentences can be correct, the four
statuses can be correct, and the screen can still print "clear" over an unchecked asset.

---

## REFUTATION — the AC doc's PART 3 is WRONG about `scripts/ui-verify.mjs`

The brief asked me to confirm or refute the AC doc's statement that ACs 1.7 and 3.1-ii "cannot be
proven by an `expect` substring because `scripts/ui-verify.mjs` has no click step" (AC doc lines 536,
564, 581-583). **REFUTED by reading the script.**

`scripts/ui-verify.mjs` **already has a click step**, and has had one for longer than this branch:
```
:35  const CLICK_SEL   = process.env.CLICK_SEL || ''
:36  const CLICK_WAIT  = parseInt(process.env.CLICK_WAIT || '1200', 10)
:61  let clicked = null
:62  if (CLICK_SEL) {
:63    const target = page.locator(CLICK_SEL).first()
:64    if (await target.count()) { await target.click({ timeout: 5000 }).catch(...) ; ... clicked = 'ok' }
:65    else clicked = 'not found'
:66    await page.waitForTimeout(CLICK_WAIT)
:86  const clickOk = !CLICK_SEL || clicked === 'ok'
:88  const ok = missingExpect.length === 0 && presentForbidden.length === 0 && countOk && clickOk && ...
```
and `.github/workflows/ui-verify.yml` exposes it as the `click_sel` input (plus `expect_absent`,
`count_sel`/`count_min`/`count_max`, `measure_sel`, `viewport_w/h`). **No script change is needed** to
prove those two ACs. This is the AC doc's own "never claim a capability is ABSENT from a single-file
grep" rule failing in the AC doc itself.

**Residual, real limitation (this part stands):** the assertions run against `document.body.innerText`
only — the script never reads `location.hash`. So a run can prove *the QC step is now on screen*, it
cannot literally assert `location.hash === '#/packet/<id>/qc'`. Combine `expect` with `expect_absent`
to make that binary.

### The exact `ui-verify.yml` inputs that would prove each unprovable-here AC

Precondition (unchanged, and it is real): a packet id for `von.ellis@enterpriseds.io` whose assets
have fail/warn findings, resolved first via `db-query.yml` or `Boost_DB_Connector`. A run against a
findings-free packet goes green on an empty region and proves nothing.

| AC / claim | `route` | `click_sel` | `expect` | `expect_absent` |
|---|---|---|---|---|
| 3.1 / claim 1 — the control renders | `#/packet/<id>/jd` | — | `See where each one is answered;opens the coverage list in QC, line by line` | — |
| **3.1-ii / claim 1 — it NAVIGATES** (and this also kills mutations A and B) | `#/packet/<id>/jd` | `[data-qc="jd-open-qc"]` | `QC & evidence;Needs a decision;Done for you` | `Posting analysis - the source` |
| 3.4 branch (a) — Coverage is the landing tab | `#/packet/<id>/jd` | `[data-qc="jd-open-qc"]` | `Coverage` + a real posting line for that packet | — |
| 3.3 / 3.6 / claim 2 — hidden with no requirements | `#/packet/<id>/jd` for a packet with zero extracted requirements | — | — | `See where each one is answered` |
| 1.1 / claim 12 — the region is on the page | `#/packet/<id>/qc` | — | `Needs a decision;What the run could not settle on its own;Done for you` | — |
| 1.7 / claim 12 — `Open field ->` navigates | `#/packet/<id>/qc` | `[data-qc="qc-decisions"] [data-qc="qc-go-to-field"]` | text from the drafts step | `What the run could not settle on its own` |
| 2.1 / claim 6 — the `{{token}}` renders | `#/packet/<id>/<asset step>` | — | `{{` + the real `merge_field` for a `generated=false` row (resolve with `db-query.yml`, **never guess** — `D:compact-template-placeholder-mismatch`) + `the slot the pipeline expects to fill` | `The pipeline cannot see that text` |
| Regression 3 / claim 5 | `#/packet/<id>/jd` | `[data-qc="jd-open-qc"]`-adjacent columns toggle | `Show as columns` (or `Show as tabs`) | — |
| **F-1 (the defect above), live** | `#/packet/<id>/qc` for a packet with an ungated asset carrying findings | — | — | `Nothing is waiting on you. Every check that could run is clear.` |

Run with `run_in_background: true` per the never-block rule.

---

## RADIUS CHALLENGE — verdict: ACCEPTED for `api/`, REJECTED as stated for `app/`

**Accepted.** `api/` is untouched (zero diff bytes). The nine named consumers of the checks-result
payload do still reconcile, and I proved the load-bearing one far past the implementer's five fixtures:

**Claim 13, property-tested — CONFIRMED, stronger than claimed.** 20,000 randomly generated payloads
(50,101 assets) with random gates (`'pass'`/`'fail'`/`'warn'`/`null`/`undefined`), random states
(including `undefined`/`null`), random engines (including an unknown `'other'`), `resultError` and
`resultLoading` entries, `result: null` entries, and **both payload shapes** (25,818 grouped
`engines.{deterministic,reviewer}.results` / 24,283 flat `results` fallback):

```
payloads=20000 grouped-shape=25818 flat-shape=24283  rows!==toFix+toReview mismatches=0
```

The equality is structural, not coincidental: `railDecisions` filters with the SAME `NEEDS_ATTENTION`
const and the SAME `engineRows()` that `railCounts` uses, and excludes exactly the assets `railTotals`
excludes (`railGate(result) === 'unchecked'`, `qcRail.js:111-114`). The inner `['fail','warn']` loop is
an ORDERING key over an already-filtered set, so it cannot change membership — and if `NEEDS_ATTENTION`
were ever widened to a third state, rows would be dropped from the list while still counted in the
strip, which this equality guard would catch.

**Hook keys — CONFIRMED, no collision, no unrendered key.** Six new `QC_HOOKS` (`qc-decisions`,
`qc-decision-asset`, `-note`, `-error`, `-count`, `-anomaly`), one `POSTING_HOOKS` (`jd-open-qc`), one
`BLOCK_HOOKS` (`blocks-field-placeholder`). All eight render; the suite's "every key is rendered / none
hand-typed / values unique" tests and `assetGate.test.mjs`'s cross-screen union all pass (311/0), and
mutation **G** shows that union is live enough to fail when a hooked element is deleted.

**REJECTED, one item the implementer's radius excluded and should not have: `compare-ui.mjs`.**
The implementer's radius says "`app/` only", but the AC doc's blast radius for gap 3 explicitly names
`scripts/compare-ui.mjs`'s control inventory as a consumer, and `scripts/` is not `app/`. I checked it
rather than inherit the exclusion: `compare-ui.mjs:115-117` collects the control (it has
`role="button"`, its text is 31 chars against a `< 40` filter, and it contains no `@`), and the file
carries **no pinned expected control count**, so nothing there breaks. **The exclusion turns out to be
harmless, but it was not proven — the same shape as the loop-2 finding that the radius "was drawn for
the right reason with a false argument".**

**Double-reporting check (asked for explicitly) — no NEW double-report, one pre-existing overlap.**
`AssetGateDrawer.jsx` and `PacketBuilder.jsx` are byte-unchanged, so neither can newly double-report.
Within `QcRail.jsx`, the same finding is now reachable twice — once in the page-level `Decisions`
region and once in the `Checks`/`Independent review` tab panel — because both render the same
`CheckRow` from the same rows. That is inherent in SPEC 4.8's "on the page, not behind a tab" ask, and
the two surfaces cannot disagree (same selector chain), so I do not score it a defect. It is worth the
owner knowing the Checks tab is now a duplicate view rather than the only one.

---

## VERDICT TABLE

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | 4.1-3 control exists, navigates `#/packet/<id>/qc` via `onOpenQc` -> existing `setActiveStep`, no router in the card | **CONFIRMED (source) / UNPROVABLE-HERE (live)** | `PostingAnalysis.jsx:552-559`; `PacketBuilder.jsx:842`; `:396-399` -> `go()`; `state.jsx:32` sets the hash. Strict grep for a router in the card: `exit=1`, no output. Live render/navigation needs `ui-verify.yml` (inputs above). **See F-2: the `PacketBuilder` half is unguarded.** |
| 2 | HIDDEN, not inert, on no requirements or `reqError` | **CONFIRMED** | `PostingAnalysis.jsx:551` `{onOpenQc && !reqError && rows.length > 0 && (`; `rows` = `groupRequirements(req?.requirements \|\| []).all` (`postingAnalysis.js:363-376`) |
| 3 | keyboard-reachable and visible to `compare-ui.mjs` | **CONFIRMED** | `role="button" tabIndex={0}` + Enter/Space `onKeyDown` on the control's own tag; `compare-ui.mjs:115` selector matches; survives both :116-117 filters; no pinned count in that file |
| 4 | AC 3.4 — option (a) copy discharges the label | **CONFIRMED, with a reservation (judgement)** | see the AC 3.4 judgement section below |
| 5 | `Show as tabs/columns` + `ee_posting_columns` still work | **CONFIRMED** | `PostingAnalysis.jsx:490,491,536-538` unchanged in the diff; both controls now stack in a flex column, the toggle first. Live persistence across reload: UNPROVABLE-HERE |
| 6 | static blocks render `{{FieldName}}` from `row.merge_field`, no field-name list | **CONFIRMED** | `assetBlocks.js:placeholderToken`; `AssetBlocks.jsx:404-406`. The only literal field names added are inside a JSDoc comment recording run 32784628025 — no runtime list |
| 7 | `placeholderToken` returns null for missing/empty/whitespace | **CONFIRMED** | 9 edge inputs run against the real module: `null`, `undefined`, `{}`, `merge_field` `null`/`''`/`'   '`/`'\t\n '`/`0`/`false` -> all `null`. Never `{{}}`, `{{null}}`, `{{undefined}}` |
| 8 | non-static blocks byte-identical, incl. a stored literal `{{X}}` | **CONFIRMED** | `BlockBody`'s `list`/`pipe`/`prose` branches have **zero changed lines**; every `+`/`-` line in `AssetBlocks.jsx` is inside the `shape === 'static'` early return or the import statement |
| 9 | the contradictory sentence is gone AND the real limitation still stated | **CONFIRMED (with a gap on one path)** | `grep -rn "pipeline cannot see that text" app/src/` -> one hit, `AssetBlocks.jsx:397`, inside a `//` comment. The real limitation is restated at `:411-412`. **Gap: only on the token branch.** The no-merge-field branch (`:416`) says only "This block names no merge field, so there is nothing to point at" — the surrounding-words disclosure is absent there |
| 10 | the compact-resume open decision is not mis-stated | **CONFIRMED** | `PLACEHOLDER_NOTE` = *"the slot the pipeline expects to fill - the app has not read your document to confirm it is there"* — an assertion about the pipeline's expectation, explicitly disclaiming the document. True under either branch of `D:compact-template-placeholder-mismatch` |
| 11 | the mono slot label was NOT replaced | **CONFIRMED** | `AssetBlocks.jsx:582-583` still renders `data-qc={BLOCK_HOOKS.fieldSlot}` with `{row.merge_field}` in mono; the token at `:404-406` is a separate element with a separate hook |
| 12 | `Needs a decision` after the change log, before the tabs; `RAIL_TABS` unchanged | **CONFIRMED** | `<ChangeLog ` line 869 < `<Decisions ` line 874 < `RAIL_TABS.map(` line 878. `RAIL_TABS` appears in **no `+`/`-` diff hunk** in either src or test; the three test files are **pure additions** (one import line aside) |
| 13 | `railDecisions().rows === toFix + toReview` for every payload | **CONFIRMED (property-tested, 20k payloads, 0 mismatches)** | see the radius section |
| 14 | ordering is fail-then-warn, deterministic-then-reviewer, from the module | **CONFIRMED, with a correction to how the claim is worded** | measured emitted order on a 4-row fixture: `detFail/fix -> detWarn/fix -> revFail/review -> revWarn/review`. The primary key is **engine**, the secondary is **state** — so a *reviewer* `fail` sorts AFTER a *deterministic* `warn`. That satisfies AC 1.6 (under D6 only deterministic rows can block) but it is not "fail-then-warn" as a primary key. Produced by `qcRail.js:625-632`, not by JSX (`.sort(` / `.filter(` are asserted absent from the component) |
| 15 | `unchecked` / `clear` / `loading` / `error` are four different sentences | **CONFIRMED at the module, REFUTED as an end-to-end guarantee** | `DECISION_NOTE` holds three distinct sentences + a fourth inline error sentence, and `railDecisions` returns the right `status`. **But mutation F (`{DECISION_NOTE[a.status]}` -> `{DECISION_NOTE.clear}`) leaves the suite 311/0 while the screen reports an UNCHECKED asset as clear.** See F-3 |
| 16 | an ungated asset's finding is listed, counted in `uncounted`, contradiction reported | **CONFIRMED at the module, UNDERMINED on screen** | measured: `status='unchecked'`, `rows.length=2`, `d.rows=0`, `d.uncounted=2`, anomaly emitted. **But see F-1** — the region's footer then prints *"Nothing is waiting on you. Every check that could run is clear."* over those very rows |
| 17 | no third copy of the fail-or-warn predicate (still <= 2) | **CONFIRMED** | verifier's own comment-stripped count: `qcRail.js` 1, `assetGate.js` 1, **total 2**. `railDecisions` calls `engineRows()` + `NEEDS_ATTENTION`; its `['fail','warn']` literal is an ordering key over an already-filtered set and cannot change membership |
| 18 | `QcRail.jsx` still computes nothing; the pinned test unmodified | **CONFIRMED** | `git diff 5e79581..HEAD -- app/test/` produces exactly ONE `-` line across all three files, and it is an import-list line in `assetBlocks.test.mjs` that gains two names. No existing assertion was touched, and the suite is 311/0 |

### The AC 3.4 judgement (claim 4) — mine, independently

**The copy does discharge AC 3.4, narrowly, and I would not block on it.** The AC's binary failure
condition is *"ship the label `See where each one is answered →` with behaviour (a) while implying
(b)"*. The implementation ships the label but does not leave the implication standing: a second line
renders immediately beneath it, in the same block, unconditionally — *"opens the coverage list in QC,
line by line"*. That names the destination (the coverage list) and re-scopes "each one" to the list
rather than to a targeted line. The AC's option (a) asks for exactly *"the control's label/adjacent
copy makes clear it opens the coverage list, not a single line"*, and the adjacent copy does.

**My reservation, stated so the owner can overrule me.** The arrow and "each one" still do most of the
work visually; the qualifier is `px-small`, `--proto-ink3` (the faintest ink token), and is the thing a
scanning reader drops. A label that carried its own scope — *"See how these are answered in Coverage
→"* — would need no qualifier at all and would remove the disclaimer-under-a-stronger-claim shape.
That is a copy preference, not an AC failure.

**AC 3.4(a) also says "the QC step opens on the Coverage tab" — I chased that separately, and it
holds, but by inheritance rather than by anything this branch does.** Nothing in these three commits
sets a landing tab. What makes it true anyway: `QcRail.jsx:718` is
`const [tab, setTab] = useState('coverage')` — plain component state with **no persistence and no
route segment** — and `RAIL_TABS[0]` is `{ key: 'coverage', label: 'Coverage' }` (`qcRail.js:90-96`).
Navigating from the JD step changes the route, which remounts `QcRail`, which re-initialises `tab` to
`'coverage'`. So the control does land on Coverage.
**But no test pins it**, and a future change that persists the tab (the way `ee_posting_columns`
persists the columns preference on the very card this control lives on) would silently break AC 3.4(a)
with a green suite. That is a third instance of the F-2/F-3 pattern — the behaviour is right and
unguarded. The `ui-verify.yml` row in the table above is what would settle it live.

---

## REGRESSION BASELINE — stated honestly

The standing golden-path check (app loads at the live URL, Today/Opportunities/Pipeline render,
navigation works, no console errors) is **NOT_APPLICABLE from this sandbox**: egress is blocked from
`*.azurestaticapps.net` and `azurewebsites.net`, so no rendered-UI claim can be made here at all. What
I *could* substitute for it, and did:

| Substitute check | Result |
|---|---|
| `cd app && npm test` — the whole 311-case suite, including every pre-existing rail/blocks/posting guard | 311 pass / 0 fail |
| `cd app && npm run build` — the real production bundle, which is also the smart-quote parser guard | clean, 245 modules |
| `cd api && npm test` / `npm run build` | 843 pass / 0 fail; `tsc` clean |
| `app/test/corrections.test.mjs` (REGRESSION GUARD 1) unmodified and passing | included in the 311; zero `-` lines in the test diff |
| existing `app/test/qcRail.test.mjs` "computes NO gate, NO severity, NO count" pinned test unmodified | ditto |
| `git diff 5e79581..HEAD -- api/` | 0 bytes |

Live golden path remains for `ui-verify.yml`.

---

## SUMMARY

**CONFIRMED 15 / CONFIRMED-WITH-CORRECTION 2 (claims 14, 15) / CONFIRMED-BUT-UNDERMINED 1 (claim 16).
Zero claims outright REFUTED. Three defects found that the suite does not catch, and one factual
error in the AC doc.**

The implementation is what it says it is: a projection with no new derivation, no sixth tab, no third
predicate, no field-name list, no router in the child screen, `api/` untouched, and a rows-vs-strip
equality that survives 20,000 random payloads across both wire shapes. The counter-proofs and the
self-attack the implementer describes are real — mutations C and G confirm those guards bite.

What it does **not** have is guard coverage on the parts that make the features actually work:

- **F-1** (`qcRail.js:662` + `QcRail.jsx:704-709`) — a real, reachable, on-screen falsehood: the region
  prints *"Nothing is waiting on you. Every check that could run is clear."* while listing two open
  findings, whenever any asset carries findings without a gate row and any other asset is checked.
  Suite: 311/0.
- **F-2** — deleting or mis-pointing `onOpenQc` in `PacketBuilder.jsx` removes or misdirects the entire
  4.1-3 feature. Suite: 311/0 for both mutations.
- **F-3** — the four-sentences guarantee is asserted on the module and never on the screen; the JSX can
  report an unchecked asset as clear. Suite: 311/0.

All three share one shape, and it is the shape this repo already named: **a guard that greps one file
proves nothing about the file on the other side of the prop.** It was fixed for 4.8-10's predicate and
left open for 4.1-3's wiring and for the rail's own sentence lookup.

And the AC doc's PART 3 is wrong that `ui-verify.mjs` has no click step — it has had `click_sel` all
along, so ACs 1.7 and 3.1-ii were provable the whole time and were reported as unverifiable.

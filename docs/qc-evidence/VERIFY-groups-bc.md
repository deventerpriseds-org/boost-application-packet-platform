# VERIFY — Groups B & C (independent verifier)

Branch: `claude/three-small-ui-gaps` (head `67a7e6d`), main `b73f8d6`.
Verifier shares NO context with implementers. Started: (see git/timestamps below).
Everything below is observed output. Nothing is inherited from the lanes' own reports.

## Status: IN PROGRESS — appended as work proceeds

## 0. Scope of the diff — established first

```
$ git log --oneline -3
67a7e6d Group B 4.3-9/10/11: the QC summary inside the ATS modal
aa59426 Group C 4.6-10/11: the drop hatch - and it REFUTED my brief on where it writes
a8a1c40 Slides table reader: the source, now the sweep has finished with it
```

`main` = b73f8d6. **The branch contains a THIRD commit (`a8a1c40`, "Slides table reader") that is
neither Group B nor Group C.** That commit is the entire `api/` delta on the branch:

```
$ git diff --stat b73f8d6..67a7e6d -- api/
 api/src/functions/tests/diagSkillSources.ts |  41 +++++
 api/src/functions/tests/skillPool.ts        | 162 ++++++++++++++++
 api/src/functions/tests/slideTables.ts      | 117 ++++++++++++
 api/test/skillPool.test.mjs                 |  92 ++++++++++
 api/test/slideTables.test.mjs               | 111 ++++++++++++
```
```
$ git diff --stat a8a1c40..aa59426 -- api/   # Group C's own commit
(empty)
$ git diff --stat aa59426..67a7e6d -- api/   # Group B's own commit
(empty)
```

**Consequence for claim 8's `git diff --stat -- api/` is empty:** true for the two lanes' OWN
commits, FALSE for the branch vs `main`. Recorded precisely rather than as pass/fail — see the
verdict table.

Per-lane file lists (observed):
- **Group C** (`a8a1c40..aa59426`): `app/package.json`, `app/src/assetBlocks.js`,
  `app/src/screens/AssetBlocks.jsx`, `app/test/browser/keyword-tally-probe.{html,jsx}`,
  `app/test/browser/run-field-margin.mjs`, `app/test/browser/run-keyword-tally.mjs`,
  `app/test/proposedKeywords.test.mjs`, `docs/qc-evidence/BUILD-group-c.md`.
- **Group B** (`aa59426..67a7e6d`): `app/src/assetGate.js`, `app/src/postingAnalysis.js`,
  `app/src/qcRail.js`, `app/src/screens/{AssetGateDrawer,PacketBuilder,PostingAnalysis,QcRail}.jsx`,
  `app/test/{postingAnalysis,qcRail}.test.mjs`, `docs/qc-evidence/BUILD-group-b.md`,
  `scripts/render-app.mjs`.

## 1. CHEAP TIER — re-run in full by me, nothing inherited

| what | command | my observed result | lane claimed |
|---|---|---|---|
| unit suite | `cd app && npm test` | `# tests 342 / # pass 342 / # fail 0` (duration 667ms) | 342/342 ✔ |
| app build | `cd app && npm run build` | `✓ 245 modules transformed` … `✓ built in 3.15s`, no error | clean ✔ |
| api build | `cd api && npm run build` (`tsc`) | exit **0**, no output | (not claimed) ✔ |
| field-margin probe | `cd app && npm run test:margin` | **59/59 checks passed** | 59/59 ✔ |
| keyword-tally probe | `cd app && npm run test:tally` | **49/49 checks passed** | 49/49 ✔ |
| smart-quote codepoint scan | python scan over all **25** files in `git diff --name-only b73f8d6..67a7e6d` | **0 hits** | 0 ✔ |

### 1b. The "the 7 `test:qc` failures pre-date this work" claim — RE-PROVEN, by a stronger method

The lane proved it by reverting ONE file (`QcRail.jsx`) to HEAD. I did not inherit that. I built a
**clean worktree of `main` itself** and ran the same probe there:

```
$ git worktree add --detach <scratch>/main-tree b73f8d6
HEAD is now at b73f8d6 Add GET /api/diag/skill-sources ...
$ ln -s <branch>/app/node_modules <scratch>/main-tree/app/node_modules
$ cd <scratch>/main-tree/app && npm run test:qc
81/88 checks passed
$ cd <scratch>/main-tree/app && npm test
# tests 326 / # pass 326 / # fail 0
```

Branch `67a7e6d` `test:qc` → also **81/88**. The FAIL lines are **byte-identical sets** (sorted diff
empty):

```
FAIL  a corrected change and an undone one are told apart by their words, not only by colour
FAIL  dark: the change log's correctedWord is readable on its own ground (>= 4.5:1) :: element not found
FAIL  dark: the change log's undoneWord   ...                                    :: element not found
FAIL  light: the change log's correctedWord ...                                  :: element not found
FAIL  light: the change log's undoneWord   ...                                   :: element not found
FAIL  the loops tab says the loop controller is not built
FAIL  the picked requirement filters the Checks tab
```

**CONFIRMED — the 7 failures exist on `main` with none of this work present. Not a regression.**
Baseline unit count on `main` is **326**, so the branch's 342 is **+16** across all three commits
(Group C +5, Group B +11 by their own accounting — consistent with 326→331→342).

## 2. THE CLAIM MOST WANTED CHALLENGED — Group C's refutation of its own brief

**Both halves CONFIRMED against the API source, and both EXECUTED rather than reasoned about.**

### Half (a) — `owner-edit` would attribute nothing for a drop

`api/src/functions/tests/appSwaps.ts:45-49` (read verbatim):
```ts
const ownerLabels = (await client.query(
  `select distinct c.replacement from correction c
     join artifact a on a.id = c.artifact_id
    where a.packet_id = $1 and c.source = 'owner_edit' and c.reverted_at is null`,
  [packetId])).rows.map((r: any) => r.replacement).filter(Boolean)
```
`api/src/functions/tests/swaps.ts:279`:
```ts
driver: (to && ownerLabels && ownerLabels.has(to)) ? 'owner'
      : attributable && att ? 'posting' : 'unattributed',
```

**The lane UNDERSTATED its own case: the empty replacement is filtered TWICE.** `swaps.ts:174` is a
second filter the lane never cited:
```ts
const ownerLabels = new Set((input.ownerLabels || []).map((l) => String(l == null ? '' : l)).filter(Boolean))
```
Executed:
```
$ node -e "...rows=[{replacement:''},{replacement:'Directed hiring'},{replacement:null}]..."
ownerLabels array: ["Directed hiring"]
Set: [ 'Directed hiring' ]
has(''): false
```
An empty `replacement` never reaches the Set, and `swaps.ts:279` further guards on `to &&`.
**`driver:'owner'` cannot fire for a deletion. CONFIRMED.**

### Half (b) — `owner-edit` splices a hole

`api/src/functions/tests/appCorrections.ts:359` (the actual splice, read verbatim):
```ts
const next = current.slice(0, first) + replacement + current.slice(first + phrase.length)
```
Executed with the lane's own example:
```
BEFORE: "Led hiring technology initiatives across teams"
AFTER : "Led  initiatives across teams"
double space present: true
```
**CONFIRMED — `Led  initiatives`, exactly as claimed.**

### The one thing I would state MORE PRECISELY than the lane did
`artifactOwnerEdit` **explicitly supports a deletion** — `appCorrections.ts:331-333`:
*"An empty replacement is a DELETION, which is a legitimate edit; the database's own
`correction_phrase_nonempty` guards the other side. Only a no-op is refused."*
So "there is no writer" would be **false**; the lane did not say that. Its narrower claim — the
write is *available* but buys **no attribution** and produces **mangled prose** — is the correct
one, and is what the source shows. Verdict: **the lane's refutation stands. This is not tier-1 work
that skipped its write path.**

## 3. Group C source verification (claims 8-11)

| observation | evidence |
|---|---|
| `seedAsk` is the ONE primitive, `seedAskReword` delegates | `AssetBlocks.jsx:526-530`: `const seedAsk = (sentence) => { setAsk(sentence); setAskOpen(true) }` and `const seedAskReword = (phrase) => seedAsk(\`Reword "${phrase}" so it does not repeat the posting's wording.\`)` |
| the reword **sentence is unchanged** | `main` (`AssetBlocks.jsx:520-523`) held the identical template literal inside its own `setAsk`. Byte-compared: same string. |
| `seedAsk` sends nothing | its body is two `setState` calls. No `api`, no `fetch`. |
| exactly ONE `aiEditArtifact` call site on the screen | `grep -n aiEditArtifact app/src/screens/AssetBlocks.jsx` → one CALL at `:690` (inside Send), plus 2 comment mentions |
| `seedAsk` has exactly 2 callers | `:530` (`seedAskReword`) and `:883`/`:887` (the drop control's click + Enter/Space) |
| a keyword the draft does NOT contain renders no control | `assetBlocks.js:449`: `if (!present) return { ask: null, reason: 'This field does not contain it, so there is nothing here to drop.' }`; the JSX renders `act.reason` under `BLOCK_HOOKS.keywordNoAction` and returns `null` when both are null |
| the copy claims no coverage effect | rendered DOM, from my own `test:margin` run: `"Not comfortable claiming this? / Ask to drop it from this field / This asks for a rewrite and records no decision. Nothing is sent until you press Send."` and the seeded sentence `Drop "hiring technology" from this field. Rewrite the text without it rather than swapping in a synonym.` — no `coverage` / `uncovered` / `gap` |
| nothing sent on either path | my `test:margin` run, checks *"and activating it SENT NOTHING - no ai-edit, no owner-edit, no request at all :: []"* and *"and the keyboard path sent nothing either :: []"* — the recorded request array is empty |

## 4. Group B source verification (claims 1, 2, 4, 5, 7)

- **`qcSummaryModel`** is at `app/src/qcRail.js:921` (the claim said `:895-985`; the docblock starts
  at 894, the function at **921**, ends at 984 — a small drift, the function is where claimed).
  Read in full: no `railGate(`, no `.filter(...).length`, no arithmetic, no severity compare. It
  maps rows, picks a branch, and calls `railHeadline(score)` / `assetLabel()`. Six distinct `state`
  values: `no_assets`, `no_scored_asset`, `unreadable`, `reading`, `not_scored`, `scored`. **CONFIRMED.**
- **The fourth state.** `not_scored` is returned from **two** branches — `!scored.result` (never run)
  and `scored.result.score == null` (ran, stored no row) — with **different `detail` sentences**
  (`"The checks have not been run for it…"` vs `"The checks ran but stored no score row for it…"`),
  and both are distinct from `railHeadline().why` for `composite: null`
  (`"No overall number: a composite is only computed when all three parts exist…"`, `qcRail.js:288`).
  **CONFIRMED — three different claims, three different sentences.**
- **`ScoreParts` extracted, three homes → one.** On `main` there were **two** hand-written score-part
  bars: `QcRail.jsx:870` (`pctWidth`) and `AssetGateDrawer.jsx:316` (a hand-inlined
  `Math.max(0, Math.min(100, Number(p.value)))`). On the branch `grep -rn "px-bar" app/src` shows
  exactly **one** score-part bar, `AssetGateDrawer.jsx:154`, inside `ScoreParts`; three consumers
  (`AssetGateDrawer.jsx:374`, `QcRail.jsx:863`, `PostingAnalysis.jsx:827`). `AssetBlocks.jsx:233` is
  a completion meter, correctly left alone. **CONFIRMED.**
- **`pctWidth` / `bandTone` de-duplicated.** `pctWidth` now has one definition (`assetGate.js:407`),
  re-exported from `qcRail.js:23` so existing importers are unbroken. `bandTone` (`assetGate.js:397`)
  replaces the ternary that was typed out at `main`'s `QcRail.jsx:856` and `AssetGateDrawer.jsx:304`;
  three consumers now. `OppDetail.jsx:741` is a *different* ternary (`strength`, not `band`) and was
  correctly not folded in. **CONFIRMED.**
- **`GateBadge` IMPORTED.** `grep -rn "function GateBadge" app/src` → exactly one:
  `AssetGateDrawer.jsx:45`. `PostingAnalysis.jsx:35`: `import { GateBadge, ScoreParts } from './AssetGateDrawer.jsx'`.
  Six mount sites, none a copy. **CONFIRMED.**
- **`model.subject` renders.** `PostingAnalysis.jsx:806-810`: `Match score - {model.subject}`.
  **CONFIRMED** (it renders only in the `scored` state; in the other five the subject is carried in
  the sentence prose instead).
- **AC B.4 branch (a).** `TALLY_SCORE_DEFER` (`postingAnalysis.js:77-92`) is `{ kw: 'Shown once,
  above, …' }`; the block passes `defer={TALLY_SCORE_DEFER}` (`PostingAnalysis.jsx:828`). The
  probe's check is a literal occurrence count, which I read rather than trusted —
  `run-keyword-tally.mjs:135`: `const kwHits = (scoredModal.match(/71/g) || []).length` … `kwHits === 1`,
  over `innerText` of `[data-qc="keyword-tally"]` (the whole modal). The fixture uses four distinct
  values (62 must / **71 kw** / 55 sen / 78 composite) so the count is unambiguous. **CONFIRMED.**

## 5. INDEPENDENT MUTATIONS — my own set, not a replay of the lanes'

Method: apply one edit, assert `git status` shows it applied, run the relevant suite(s), `git checkout --`
the file, assert the tree is clean again. Every restore was verified. Baselines: node **342/0**,
`test:tally` **49/49**, `test:margin` **59/59** (main: **47/47**), `test:qc` **81/88**.

| # | mutation | node suite | browser probe | verdict |
|---|---|---|---|---|
| MV-B1 | delete `Match score - {model.subject}` from `QcSummaryBlock` | 342/0 | tally 49/49, posting 26/26 | **GREEN — GAP** |
| MV-B2 | `bandTone`: an UNRECOGNISED band falls to `green` instead of `red` | 342/0 | tally 49/49, qc 81/88 (same 7) | **GREEN — GAP** |
| MV-B3 | `pctWidth` loses its `Number.isFinite` guard (NaN% returns) | 341/1 — *a bar width is clamped and never NaN* | — | CAUGHT |
| MV-B4 | collapse the two `not_scored` **detail** sentences into one | 342/0 | tally 49/49 | **GREEN — minor gap** |
| MV-B5 | the asset row stops passing `error` to `GateBadge` | — | tally 48/49 — *it shows the unavailable state rather than a verdict :: ["unloaded","unloaded"]* | CAUGHT |
| MV-B6 | the DEFERRED part prints its number **as well as** the deferral sentence | — | tally 47/49 — *71 appears **2x*** + *the deferred part still prints no number* | CAUGHT |
| MV-B7 | `PacketBuilder` stops passing `qcSummary` to the modal | 341/1 — `H:tally-summary-is-wired-in-the-packet-screen` | — | CAUGHT |
| MV-B8 | `PacketBuilder` stops passing `onGoQc` | 341/1 — same guard | — | CAUGHT |
| MV-B9 | the model's rows become the prototype's fixed 4-type list | 339/3 | — | CAUGHT |
| MV-B10 | *(invalid — I used a hook value that does not exist, so nothing collided. My error, not the guard's.)* | 342/0 | — | VOID |
| MV-B10b | `POSTING_HOOKS.qcSummaryRow` set to the REAL `QC_HOOKS.component` value (`qc-score-component`) | 341/1 — *no hook value collides across the three screens* | — | CAUGHT |
| MV-B11 | a new `POSTING_HOOKS` key declared but never rendered | 341/1 — *every POSTING_HOOKS selector is rendered* | — | CAUGHT |
| MV-C1 | the seeded sentence loses the word "drop" (`Drop "x"` → `Remove "x"`) | 341/1 — `H:keyword-drop-offers-nothing-it-cannot-do` | — | **CAUGHT — loosened assertion 1 still fails its deletion** |
| MV-C2 | delete the on-screen *"records no decision"* disclosure | 341/1 — same guard | — | **CAUGHT — loosened assertion 2 still fails its deletion** |
| MV-C3 | `kwPresence` measured against `row.before_text` instead of `after_text` | — | margin **crashes**: `Cannot read properties of null (reading 'click')` | CAUGHT |
| MV-C5 | the drop control's **click** seeds `act.reason` instead of `act.ask` | 342/0 | margin **crashes**: `locator.focus: Timeout … waiting for [data-qc="blocks-keyword-drop"]` | CAUGHT (probe only) |
| MV-C6 | a new `BLOCK_HOOKS` value collides with a `POSTING_HOOKS` value | 341/1 | — | CAUGHT |

### The three GREEN-but-broken findings, stated with file:line and trigger

**F-1 — `model.subject` renders, but nothing guards that it does.** `app/src/screens/PostingAnalysis.jsx:809`
(`Match score - {model.subject}`). Deleting the `{model.subject}` interpolation leaves the node
suite at 342/0, `test:tally` at 49/49 and `test:posting` at 26/26. `app/test/qcRail.test.mjs:1412`
asserts `m.subject === 'Resume'` on the **model** only; no test reads the rendered heading.
**This is precisely the write-only condition the lane's own 0b hunt says it fixed** — the fix
shipped, the guard against it regressing did not. Trigger: remove the interpolation; nothing fails.
*(AC B.8 is still satisfied by the `scope` sentence, which IS asserted — so the screen would still
name the artifact. The gap is that the heading is unprotected, not that B.8 fails.)*

**F-2 — `bandTone`'s fail-closed rule is stated in a docblock and enforced by nothing.**
`app/src/assetGate.js:391-397`: *"`red` rather than to green, because an unrecognised verdict is not
permission."* Changing the final `'red'` to `'green'` leaves node 342/0, `test:tally` 49/49 and
`test:qc` 81/88 (the same 7 pre-existing failures, no new one). Trigger: any `band` value that is
neither `strong` nor `acceptable` — e.g. a future band word, or `null` — would render a **green**
pill. **Not a regression**: `main` had the identical ternary inlined at `QcRail.jsx:856` and
`AssetGateDrawer.jsx:304`, equally unguarded. What changed is that the lane gave the rule a name and
a docblock that asserts it, without a test behind the assertion.

**F-3 — the two `not_scored` branches differ only in `detail`, and nothing asserts the difference.**
`app/src/qcRail.js:955-971`. `H:tally-two-empties-two-sentences` (`qcRail.test.mjs:1357`) asserts
distinctness over `m.sentence`, and both branches share the sentence *"No score has been computed
for the resume yet."*; only `detail` differs (*"The checks have not been run for it…"* vs *"The
checks ran but stored no score row for it…"*). Copying the first branch's detail over the second
leaves 342/0 and 49/49. **This does NOT refute claim 4** — `not_scored` (no score row) IS modelled
distinctly from `composite: null` (which routes through `railHeadline().why`), and that distinction
IS guarded. It is the finer never-ran-vs-ran-and-stored-nothing split that is unguarded, and
`fixtures.json` shows the app is in exactly that state today.

**One behaviour change worth naming (not a defect).** The drawer's bar clamp changed from
`Math.max(0, Math.min(100, Number(p.value)))` to `pctWidth`, which returns `'0%'` rather than `'NaN%'`
for a non-numeric value. That is the improvement the lane claims. The golden-master parity check
(`keyword-tally-probe.jsx:104-133`) feeds only numeric values, so it does **not** exercise that
difference — the parity claim is "identical for numeric parts", which is what it should be, but it is
narrower than "byte-identical for all inputs".

## 6. BLAST RADIUS — challenged, and ACCEPTED

Claimed: `app/` only, plus `scripts/render-app.mjs`. **I accept it.** What I checked:

1. **`api/` is untouched by both lanes.** `git diff --stat a8a1c40..aa59426 -- api/` and
   `aa59426..67a7e6d -- api/` are both empty. The branch's `api/` delta belongs entirely to a third
   commit (`a8a1c40`, the slides-table reader) that is out of scope for this pass.
2. **`scripts/render-app.mjs` is additive and inert when unused.** The new `--click` block is inside
   `if (CLICK) { … }`; the only other change is a `clicked: CLICK || null` field in the JSON report.
3. **`app/package.json`** gains one line (`test:tally`). Nothing else.
4. **The moved/extracted symbols reconcile.**
   - `pctWidth`: one definition (`assetGate.js:407`), re-exported from `qcRail.js:23`, so
     `qcRail.test.mjs`'s existing import still resolves. Its only render consumer is `ScoreParts`.
   - `bandTone`: three consumers (`AssetGateDrawer.jsx:369`, `QcRail.jsx:856`, `PostingAnalysis.jsx:813`).
   - `ScoreParts`: three consumers. `GateBadge`: still one definition, six mount sites.
5. **`AssetGateDrawer.jsx`'s own rendering.** The whole diff is: the import line, the new `ScoreParts`
   block, `bandTone(s.band)` replacing the inline ternary, and `<ScoreParts …/>` replacing the
   `parts.map`. Nothing else in the drawer changed.
6. **The golden master is genuinely the PRE-extraction markup — verified against `main`, not against
   the comment that says so.** I read `main`'s `AssetGateDrawer.jsx:309-319` and `QcRail.jsx:861-874`
   in the clean `main` worktree and compared them to `keyword-tally-probe.jsx`'s `LegacyDrawerParts`
   / `LegacyRailParts`: same elements, same styles, same `Math.max(0, Math.min(100, Number(p.value)))`
   in the drawer copy and same `pctWidth` in the rail copy, same `data-qc` presence/absence.
   **The parity check is not vacuous.**
7. **THE STRONGEST RADIUS EVIDENCE — a real-app render diff, main vs branch.** I built `main` in a
   separate worktree and rendered three routes through `scripts/render-app.mjs` against the
   production fixtures on both trees:
   ```
   $ diff qc-main.txt qc-branch.txt      →  2a3 >   "clicked": null,
   $ diff resume-main.txt resume-branch.txt →  2a3 >   "clicked": null,
   $ diff jd-main.txt jd-branch.txt      →  2a3 >   "clicked": null,
   ```
   **The rendered body of the QC step, the resume step and the JD step is byte-identical between
   `main` and this branch.** The only difference is the render harness's own new JSON field. Both
   lanes' surfaces are behind a click (the tally modal; the keyword chip), so nothing default-visible
   moved. 926 → 927 lines, and the extra line is `"clicked": null`.

## 7. LOCAL RENDER — reproduced independently, on production fixtures

```
$ node scripts/render-app.mjs --route '#/packet/2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3/jd' \
    --fixtures docs/qc-evidence/fixtures.json --click '[data-qc="match-estimate-button"]' \
    --count '[data-qc="tally-qc-asset"]'
  "count": { "selector": "[data-qc=\"tally-qc-asset\"]", "count": 5 },
  "unmatched": [], "pageErrors": []
```
Rendered text, lines 249-266 of my own run:
```
QC summary
No score has been computed for the resume yet. The checks ran but stored no score row for it, so
  there is nothing to read. That is an absence, not a zero.
Resume only - there is no packet-wide score, and averaging the assets would invent one.
Every asset this packet actually has, with the gate the checks engine last recorded for it.
Compact resume  Blocked 11 to fix
Cover letter    Blocked 10 to fix
Portfolio       Blocked 10 to fix
Intro video     Not checked
Resume          Blocked 21 to fix
… Open QC - every finding, per asset
```
Five rows = the packet's five real artifacts, `Not checked` preserved for the video, no packet-wide
score, `pageErrors: []`. **Rendered locally.** The sandbox cannot reach `*.azurestaticapps.net` or
`azurewebsites.net`; nothing here is a live claim.

**What `ui-verify.yml` WOULD prove and cannot today** (`workflow_dispatch` runs are stuck queued):
```
workflow_id: ui-verify.yml, ref: main, inputs:
  route: "#/packet/2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3/jd"
  owner: "von.ellis@enterpriseds.io"
  click_sel: "[data-qc=\"match-estimate-button\"]"
  expect: "QC summary;there is no packet-wide score;Open QC;It is not keyword coverage, and no applicant tracking system produced it"
  count_sel: "[data-qc=\"tally-qc-asset\"]", count_min: "5"
```
That would prove the block reaches the DEPLOYED bundle with the real API behind it — the one thing a
fixture render cannot. A second run with `count_sel: '[data-qc="keyword-library-state"]'`,
`count_max: 1` is AC B.4's live check. Neither is available from here.

## 8. VERDICT TABLE

| # | claim | verdict | evidence |
|---|---|---|---|
| 1 | `qcSummaryModel()` is a pure six-state model deriving no gate/severity/count | **CONFIRMED** | read in full at `qcRail.js:921-984` (docblock from `:894`; the claimed `:895-985` is off by ~26 on the function head). No `railGate(`, no `.filter().length`, no arithmetic. Six distinct `state` values. MV-B9 CAUGHT (339/3) |
| 2 | `ScoreParts` EXTRACTED not copied; three homes → one; `pctWidth`/`bandTone` de-duplicated | **CONFIRMED** | `main` had 2 score-part bar copies (`QcRail.jsx:870`, `AssetGateDrawer.jsx:316` with a hand-inlined clamp) + 2 inline `bandTone` ternaries. Branch: one `px-bar` score-part site (`AssetGateDrawer.jsx:154`), 3 consumers; one `pctWidth`, one `bandTone`. Golden master verified against `main` itself |
| 3 | AC B.4 branch (a): with `keyword_coverage: 71`, `71` appears **exactly once** in the rendered modal | **CONFIRMED** | my own `test:tally` run: *"with every part measured, keyword coverage appears EXACTLY ONCE"* PASS. Guard read, not trusted: `run-keyword-tally.mjs:135` counts `/71/g` over the whole modal's innerText. **My own independent mutation MV-B6 makes it read `71 appears 2x` and FAIL** |
| 4 | a fourth state (`score: null`) modelled distinctly from `composite: null` | **CONFIRMED** | `qcRail.js:955-978`: `not_scored` vs `scored`→`railHeadline()`; distinct sentences, guarded by `H:tally-two-empties-two-sentences`. **Caveat F-3**: the finer never-ran vs ran-and-stored-nothing split lives only in `detail` and is unguarded (MV-B4 green) |
| 5 | `GateBadge` IMPORTED from `AssetGateDrawer.jsx:45`, never copy-pasted | **CONFIRMED** | exactly one `export function GateBadge` in `app/src`; `PostingAnalysis.jsx:35` imports it; 6 mount sites |
| 6 | 11 guards, M1-M14 mutation-proven, C1-C4 counter-proven | **PARTIALLY CONFIRMED** | **11 new `test('H:…')` cases confirmed** in the Group B commit, all slug-named, test files purely additive (only removed lines are imports). I did **not** replay M1-M14/C1-C4 (instructed not to); I ran 12 mutations of my own instead — 9 CAUGHT, 3 GREEN (F-1/F-2/F-3), 1 void |
| 7 | `model.subject` renders (was write-only) | **CONFIRMED, with a gap** | `PostingAnalysis.jsx:809` `Match score - {model.subject}`, seen in my own render. **F-1: deleting it leaves every suite green** — the fix is unguarded |
| 8 | a drop writes NOTHING at activation; on Send it is the field's existing ask box → `ai-edit`, one call site; `git diff --stat -- api/` empty | **CONFIRMED, with one precision** | `seedAsk` is two `setState` calls; `api.aiEditArtifact` has exactly 1 call site (`AssetBlocks.jsx:690`); my own `test:margin` shows the recorded-request array `[]` on **both** the click and the Enter path. **Precision:** `git diff --stat -- api/` is empty for each lane's own commit, but **NOT** for the branch vs `main` — commit `a8a1c40` adds 5 `api/` files. Neither lane authored them |
| 9 | `seedAskReword` DELEGATES to one `seedAsk` primitive, sentence unchanged | **CONFIRMED** | `AssetBlocks.jsx:526-530`; the template literal is byte-identical to `main`'s at `:521`; `seedAsk` has exactly 2 callers |
| 10 | a keyword the draft does NOT contain renders no control, only an explanation | **CONFIRMED** | `assetBlocks.js:449` returns `{ask:null, reason:'This field does not contain it, so there is nothing here to drop.'}`; my `test:margin` run shows the control absent (`:: null`) and the reason rendered |
| 11 | the copy claims no coverage effect | **CONFIRMED** | rendered DOM from my own run contains no `coverage`/`uncovered`/`gap`/`loses`; the seeded sentence is `Drop "hiring technology" from this field. Rewrite the text without it rather than swapping in a synonym.` |
| 12 | 13 mutations each failing its own guard; the two LOOSENED assertions still fail their deletion | **the loosened pair CONFIRMED; the 13 NOT REPLAYED (by instruction)** | MV-C1 (remove the word "drop" from the sentence) → 341/1; MV-C2 (delete the on-screen "records no decision" disclosure) → 341/1. Both fail `H:keyword-drop-offers-nothing-it-cannot-do`. 5 new Group C guards confirmed present |
| ★ | **Group C's refutation of the brief** — (a) `ownerLabels` filters the empty replacement so no attribution is gained; (b) `owner-edit` splices a hole | **CONFIRMED, BOTH HALVES** | (a) `appSwaps.ts:45-49` `.filter(Boolean)` **plus a second filter at `swaps.ts:174`** the lane never cited; `swaps.ts:279` also guards on `to &&`. Executed: `has('') → false`. (b) `appCorrections.ts:359` executed with the lane's own example → `"Led  initiatives across teams"`. **The lane is right; this is not tier-1 work that skipped its write path** |
| — | the 7 `test:qc` failures pre-date this work | **CONFIRMED, by a stronger method than the lane's** | a clean `main` worktree at `b73f8d6` gives **81/88 with the identical 7 FAIL lines**; branch also 81/88 |
| — | blast radius is `app/` + `scripts/render-app.mjs` | **ACCEPTED** | QC, resume and JD steps render **byte-identical** between `main` and the branch (only the harness's own new `"clicked": null` differs) |


## 9. Housekeeping and integrity of this pass

- **I committed nothing.** The parent committed this file mid-run as `35e2bf9` ("Verifier's
  in-flight output … still running"), and two doc commits (`bca75c0`, `e156744`) landed while I
  worked. Confirmed harmless to this pass:
  ```
  $ git diff --name-only 67a7e6d..HEAD -- app/ api/ scripts/    → (empty)
  $ git diff --stat 67a7e6d -- app/ api/ scripts/               → (empty)
  ```
  **No code changed after the commit I verified, and the working tree still matches it** — so every
  mutation restore above landed clean and every number is against `67a7e6d`'s source.
- Every mutation was applied, asserted-applied, run, reverted, and asserted-reverted. Final
  `git status --porcelain` shows only this evidence file.
- A scratch `git worktree` of `main` (`b73f8d6`) was used for every baseline; it is outside the repo
  tree and can be removed with `git worktree remove`.

## 10. What I could NOT verify from here

- **Nothing was verified against the deployed app.** The sandbox cannot reach
  `*.azurestaticapps.net` or `azurewebsites.net`, and `workflow_dispatch` runs are stuck queued, so
  `ui-verify.yml` was unavailable. Section 7 states the exact inputs it would need and what it would
  add. Everything in this report is **rendered locally** against `docs/qc-evidence/fixtures.json`.
- **The `scored` and `null_composite` states cannot be reached on real data.** Every artifact in the
  production fixtures carries `score: null`, so the live path is `not_scored` only. Those two states
  are provable in the probe and nowhere else until a checks run stores an `artifact_score` row.
  This is `not_applicable`, not `pass`.
- **`AssetGateDrawer`'s Match tab was not rendered end-to-end here** — it sits behind two clicks and
  `render-app.mjs --click` takes one selector. Its parity is covered by the probe's golden master,
  which I verified is a faithful copy of `main`'s markup, and by the byte-identical resume/QC/JD
  renders. That is narrower than a rendered Match tab, and I am not claiming more.
- **I did not replay the lanes' own M1-M14 / C1-C4 / 13-mutation lists** (instructed not to). Claim 6
  and claim 12 are therefore partially, not wholly, verified — see the verdict table.

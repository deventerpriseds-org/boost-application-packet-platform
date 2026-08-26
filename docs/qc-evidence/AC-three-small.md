# AC — three small UI gaps (4.8-10, 4.5-40, 4.1-3)

Written by an independent AC agent, 2026-08-26. **Nothing here is implementation.**
Written adversarially: the ACs below are the ones that would catch an implementing agent
writing ACs that flatter its own plan.

Scope, verbatim from `docs/qc-evidence/PROTOTYPE-COVERAGE.md`:

| # | Gap | Prototype source | Coverage verdict as written |
|---|---|---|---|
| 4.8-10 | **`Needs a decision`** list, on the QC page | `qc/evidence.jsx:92-121`, mounted `:367-372` | ABSENT |
| 4.5-40 | Static blocks show `{{merge field}}` placeholders inline | SPEC §4.5 | ABSENT |
| 4.1-3 | `See where each one is answered →` on the JD/extraction card | `qc/packet.jsx:159` | ABSENT |

> **Status: COMPLETE.** Every row in Part 1 carries the exact command that produced its verdict.
> Line numbers are as of the working tree on 2026-08-26; assertions are written to survive a move.

---

## PART 1 — FEASIBILITY TABLE

### Headline, before the table

**None of the three is ALREADY BUILT.** All three were checked against the mounting file's
*import list* and against the module the mounting file delegates to, not by a single-file grep.
But two of the three coverage-doc verdicts are **wrong in a way that changes the work**:

| Gap | Coverage doc says | What the sweep actually found | Consequence for the AC |
|---|---|---|---|
| 4.8-10 | `ABSENT` | The **rows, the severity split, the ordering and the deep-link target all exist** and are already rendered elsewhere (`ChecksTab`, `AssetGateDrawer`). What is absent is a *page-level mount*. This is `EXISTS-BUT-CONSTRAINED`, and the constraint is a missing selector + mount, not missing data. | The AC must forbid a new derivation. This is an **EXTEND**, not a build. |
| 4.5-40 | `ABSENT` | The **merge-field name** is already in the payload and already rendered in mono at `AssetBlocks.jsx:562`. The **template's surrounding prose** is genuinely not reachable by the app. So `{{FieldName}}` is buildable **today**; "the actual template text" from SPEC §4.5 is **not**. These are two different asks that the coverage row fuses into one. | The AC must **split the row** and explicitly scope out the prose half, or the work gets parked. |
| 4.1-3 | `ABSENT` | Confirmed absent as a control. Its *target* — deep-linking into QC at a specific requirement — needs a separate verdict (below). | See the 4.1-3 block. |

---

### Gap 4.8-10 — `Needs a decision` list on the QC page

**Verdict for the gap as a whole: `EXISTS-BUT-CONSTRAINED`.** Every input exists and is already
rendered on another surface. The missing pieces are (a) a selector in `qcRail.js` and (b) a mount
between `<ChangeLog/>` and the tab strip in `QcRail.jsx`.

**THE ONE CORE SYSTEM: `useQcEntries` → `api.artifactChecksResult` → `GET /app/artifact/{id}/checks-result`,
read through the selectors in `app/src/qcRail.js` + `app/src/assetGate.js`.**
`QcRail.jsx`'s own header comment states the rule this gap must obey:
*"THIS FILE COMPUTES NOTHING… app/test/qcRail.test.mjs greps this file to prove it does not."*

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command + result) | Verdict |
|---|---|---|---|---|
| The findings rows themselves (`results`, `engines.deterministic.results`, `engines.reviewer.results`) | `api/src/functions/tests/appChecks.ts:367` — `app.http('artifactChecksGet', … route: 'app/artifact/{artifactId}/checks-result')` | `useQcEntries` (`QcRail.jsx:39`) → `api.artifactChecksResult` (`api.js:184`); rows read via `engineRows()` (`assetGate.js:341`) | `grep -rn "checks-result" api/src --include=*.ts` → one route, `appChecks.ts:367`. `grep -n "artifactChecksResult" app/src/api.js` → `:184`, and it carries `?owner=`. | `EXISTS` |
| "needs attention" = `state==='fail' \|\| state==='warn'` | `assetGate.js:347` `const needsAttention` ; `qcRail.js:132` `const NEEDS_ATTENTION` | `attentionSplit()` (`assetGate.js:365`), `railCounts()` (`qcRail.js:146`) | `grep -rn "railAttention\|attentionSplit" --include=*.js --include=*.jsx --include=*.mjs --include=*.ts app/ api/` → 9 source sites + 15 test sites; **two identical predicates already exist in two files**. | `EXISTS` — **but see the duplicate-predicate risk below** |
| The severity split fix / review (never summed) | `attentionSplit()` → `{fix, review, listed, counted}` ; `railCounts()` → `{toFix, toReview}` | Header counts strip `QcRail.jsx:709-722`; per-asset chips `:757-760`; `AssetGateDrawer.jsx:62,188,460` | Read `assetGate.js:280-372` and `qcRail.js:127-180` in full. `railTotals` sums each field independently and there is *deliberately no `total`*. | `EXISTS` |
| A page-level list component rendering findings rows | — | `ChecksTab` (`QcRail.jsx:400-434`) renders `rowsForRequirement()` → `CheckRow`, but **inside the tab panel** (`:842`) | `sed -n '810,846p' app/src/screens/QcRail.jsx` → after `<ChangeLog …/>` (`:809`) the next element is the tab strip `<div … RAIL_TABS.map …>`. Nothing page-level between them. | `ABSENT` (the mount only) |
| A page-level list **precedent** to extend | `railChangeLog()` (`qcRail.js`) | `ChangeLog` (`QcRail.jsx:612-651`), mounted `:809` with the comment *"ON THE PAGE (SPEC 4.8) - not behind a tab and not behind a search."* | `sed -n '600,655p' app/src/screens/QcRail.jsx` | `EXISTS` — **this is the shape to copy** |
| `Open field →` deep link on an open item | `onGoToField` threaded `PacketBuilder.jsx:901` → `QcRail.jsx:837-838` → `AssetBlocks.jsx:1020` focus ring | `CheckRow` already takes `onOpen` + `onGoToField` (`QcRail.jsx:422`) | Coverage row 4.8-12 marks this BUILT; `grep -n "onGoToField" app/src/screens/QcRail.jsx` → threaded to `ChecksTab` and `ReviewTab`. | `EXISTS` |
| `Answer` control on an open question (prototype `evidence.jsx:80,112`) | Requires severity `open`, which `assetGate.js:78-87` **refuses to mint** from state the app does not have | nothing | Coverage row 4.8-13 records this as `DELIBERATE`, not missing. | `EXISTS-BUT-CONSTRAINED` — **out of scope; do not build `Answer`** |
| `data-qc` hook for the new region | `QC_HOOKS` (`qcRail.js:42-80`) | `qcRail.test.mjs:658` asserts **every** `QC_HOOKS` key is rendered and **no** `data-qc` value is hand-typed, and that values are unique | `sed -n '655,672p' app/test/qcRail.test.mjs` | `EXISTS` — a new hook is mandatory and is enforced |

**Origin check (required before calling this open).**
`grep -niE "needs a decision" .claude/actions.md` → **`.claude/actions.md:2804`**, in the
`render-spec.mjs` finding: *"Step 6 QC renders … 'Done for you — 15 corrections already applied' …
then **'Needs a decision'** (9 left) and the tabs"*. Origin is the **SPEC/prototype inventory**, and
the entry immediately following it records that the owner said *"you have not updated the boost app
to have the UI design, layout, buttons of the prototype"* — so the owner has asked for the
prototype's layout in general terms. `.claude/DEFERRED.md` has **no** row for it
(`grep -niE "needs a decision" .claude/DEFERRED.md` → one hit, `D:compound-requirements-unevidenceable`,
which is an unrelated use of the phrase in a *check* column). `PULL-CANDIDATES.md` → no hit.
**Not blocked by anything.**

**Two traps the implementing agent will walk into, named here so its own ACs cannot omit them:**

1. **`RAIL_TABS` labels are pinned by `assert.deepEqual`** (`qcRail.test.mjs:678-679`:
   `['Coverage','Original vs final','Remediation loops','Checks','Independent review']`).
   Adding "Needs a decision" as a **sixth tab** would break that assertion — correctly, because
   SPEC §4.8 says *on the page, not behind a tab*. If the implementer "fixes" the test by editing
   the expected array, that is the failure mode, not a fix.
2. **A third copy of the attention predicate.** `needsAttention` (`assetGate.js:347`) and
   `NEEDS_ATTENTION` (`qcRail.js:132`) are already two definitions of the same rule. A new
   `railDecisions()` that writes its own `state === 'fail' || state === 'warn'` makes three, and
   `qcRail.test.mjs:635-637` only greps `QcRail.jsx` — it is **structurally blind** to a third copy
   in `qcRail.js`. The AC below closes that.

---

### Gap 4.5-40 — `{{merge field}}` placeholders inline in static blocks

**Verdict for the gap as a whole: `EXISTS-BUT-CONSTRAINED`, and the row conflates two asks.**

SPEC §4.5 asks static blocks to show *"their **actual template text** — including the
`{{merge field}}` placeholders so the user can see where merged text lands"*. Those are two
separate data dependencies with two different verdicts, and the coverage row scores them as one.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command + result) | Verdict |
|---|---|---|---|---|
| The merge-field **NAME** for every block, filled or not | `mergeFieldsFor(type)` → `TEMPLATE_META[type].placeholders` (`packetTemplates.ts:22-56`); `buildInsertions` emits a row per field, `generated:false` when unfilled (`insertions.ts:28-40`) | `AssetBlocks.jsx:561-562` **already renders `{row.merge_field}` in monospace** as the slot label (`BLOCK_HOOKS.fieldSlot`) | `grep -n "function BlockBody" -A 25 app/src/screens/AssetBlocks.jsx` and `sed -n '555,568p' app/src/screens/AssetBlocks.jsx` | `EXISTS` — **the `{{…}}` half is buildable today with data already on the client** |
| The template's **surrounding prose** (the words around the placeholder) | Google Docs/Slides template; readable server-side only via `GET /diag/doc-structure` (`diagDocStructure.ts:172`) and `GET /diag/template-placeholders` (`diagTemplates.ts:49`) | **Nobody.** `grep -n "doc-structure\|template-placeholders" app/src/api.js` → **no output**. No app route delivers template body text. | Two greps above; plus `grep -n "route:\|app.http" api/src/functions/tests/appInsertions.ts` → only `app/artifact/{id}/insertions`, which returns `merge_field / generated / before_text / after_text / method / loop / list / item_count / requirement_seq / verbatim_quote / confidence` (`insertions.ts:29-40`) — no template body. | `ABSENT` from the app's data path; `EXISTS-BUT-CONSTRAINED` server-side (a diag route can read it, it is not wired, and it needs the Google token the browser does not hold) |
| The static/non-static classification | `shapeOf(row)` (`assetBlocks.js:144`): `if (!row \|\| !row.generated) return 'static'` | `AssetBlock` → `BlockBody` (`AssetBlocks.jsx:392-400`) | `sed -n '138,152p' app/src/assetBlocks.js` | `EXISTS` |
| Anything rendering `{{…}}` in the app today | — | — | `grep -rn '{{[A-Za-z@]' app/src` → **one hit, `assetBlocks.js:362`, a JSDoc return type `{{present: string[], absent: string[]}}`** — not a merge field. | `ABSENT` (confirms the coverage row on this narrow point) |
| Static-block editability (the round-trip risk) | — | `AssetBlocks.jsx:634` gates List Tweaks on `!isStatic && artifactId` | `grep -n "isStatic" app/src/screens/AssetBlocks.jsx` | `EXISTS-BUT-CONSTRAINED` — **static blocks have no save path, so a rendered placeholder cannot corrupt a stored value.** The round-trip risk is real only for *non-static* bodies; see AC 2.6. |

**THE CLAIM IN THE CODE THAT MUST NOT BE TAKEN AS PROOF.** `BlockBody`'s static branch currently
renders, to the owner:

> *"No value reached this merge field, so the document keeps whatever the template already says
> here. **The pipeline cannot see that text, so it is not shown as a draft.**"*

That is a sentence in the product, describing a limitation — a claim *about* the code. It is
**true of the template prose** (no app route carries it) and **false of the field name** (the app
has `row.merge_field` and prints it two lines above). Shipping `{{ResumeSummary}}` while that
sentence still says the pipeline cannot see the text would put a contradiction on one screen.
`H:no-stale-not-built-claim` (`qcRail.test.mjs:604`) exists for exactly this class — *"no screen
tells the owner a shipped subsystem does not exist"* — but it greps `qcRail.js` and `QcRail.jsx`
**only**, so it cannot see `AssetBlocks.jsx`. AC 2.5 closes that.

**Origin check.** `grep -niE "merge field|placeholder" .claude/DEFERRED.md` returns
`D:compact-template-placeholder-mismatch` (**OPEN**) — the owner's compact-resume Doc declares
`{{SkillsBullets}}` while `TEMPLATE_META.compact_resume` declares
`[ResumeSummary, SkillsBullets]`, and the fuller set is a stale copy of the full resume's seven.
**This is a live decision (A vs B) the owner has not made.** It does **not** block 4.5-40 — rendering
the name the app already holds is correct under either branch — but it *does* mean the placeholder
the app shows for `compact_resume` may **not match the placeholder in the real Doc**. AC 2.7 forces
that to be disclosed rather than asserted. `PULL-CANDIDATES.md:121` also names
`SkillsBullets1/2`, `RelevantBullets1/2/3` and *"refuse the compact one"*.


---

### Gap 4.1-3 — `See where each one is answered →` on the JD/extraction card

**Verdict for the gap as a whole: `EXISTS-BUT-CONSTRAINED`.** Navigating to the QC step is a
**solved, routed, deep-linkable** operation. Targeting a *specific requirement* inside QC is **not**
reachable from outside `QcRail`. So the control can be built today and wired for real — it just
cannot carry a requirement id, and the AC must say so rather than let the implementer quietly ship
a link that looks targeted and is not.

| Dependency | Producer (who writes it) | Consumer (who reads it today) | Proof (exact command + result) | Verdict |
|---|---|---|---|---|
| A route/hash for the QC step | `go()` (`state.jsx:32`) sets `window.location.hash`; `setActiveStep` (`PacketBuilder.jsx:396-399`) calls `go('/packet/${id}/${key}')` | `PacketBuilder({ id, step })`; `explicitStep` (`:394`) validates `step` against `STEPS` | `sed -n '390,400p' app/src/screens/PacketBuilder.jsx` → the step is in the ROUTE, with the comment *"It was component state, which meant no deep-link, no back-button, and nothing behind a step was reachable by the UI verifier."* `sed -n '97,110p' …` → `{ key: 'qc', num: 6, label: 'QC & evidence' }`. **The hash is `#/packet/<id>/qc`.** | `EXISTS` |
| A step-navigation API the card could call | `setActiveStep(key)` (`PacketBuilder.jsx:396`) | `goToField` (`:739`), the stepper (`:1040`, `:1132`), the Next buttons (`:867`, `:905`, `:924`) | `grep -n "setActiveStep" app/src/screens/PacketBuilder.jsx` → 12 call sites | `EXISTS` — **this is the mechanism to extend; do not import a router into `PostingAnalysis.jsx`** |
| A prop path from `PacketBuilder` into the card | — | `PostingAnalysisCard({ req, reqError, reloadReq, coveredKw, missingKw, gapsScoredAt, onParse, parseBusy, hasSummary, keywordScore })` (`PostingAnalysis.jsx:485`), mounted `PacketBuilder.jsx:835` | `grep -n "export function PostingAnalysisCard" -A 1 app/src/screens/PostingAnalysis.jsx` — **no `onOpenQC`, no `id`, no nav prop.** And `grep -n "state.jsx\|\bgo(" app/src/screens/PostingAnalysis.jsx` → **no output**: the file imports nothing from `state.jsx`, so it has no navigation of its own by design. | `ABSENT` (one prop) |
| **Requirement-level targeting inside QC** (the `→` implying "*each one*") | — | `QcRail`'s `pick` is **internal state**: `const [pick, setPick] = useState(null)` (`QcRail.jsx:660`), and the signature `QcRail({ packetId, company, role, entries, setResult, requirements, reqError, reqLoading, onGoToField })` (`:658`) has **no** `pick`/`focusRequirement` prop and no route segment | Read `QcRail.jsx:658-700` in full; `grep -n "setActiveStep\|hash" app/src/screens/PacketBuilder.jsx` shows the route carries `:id/:step` only — no third segment. | **`EXISTS-BUT-CONSTRAINED` — this is the one that will get the work parked if it is not stated up front.** |
| Reverse-direction precedent (`See the lines this was built from`, prototype `packet.jsx:204`) | — | — | `grep -rn "built from\|See the lines" app/src` → 10 hits, **all prose in comments/notes**; no such control exists in the app either. | `ABSENT` — **there is no sibling control to copy; the coverage row's mention of it is about the prototype only** |
| `data-qc` hook for the new control | `POSTING_HOOKS` (`postingAnalysis.js:26-65`) | `postingAnalysis.test.mjs:356-366` asserts every `POSTING_HOOKS` key is rendered, none is hand-typed, and values are unique; `assetGate.test.mjs:332-335` unions `QC_HOOKS`/`BLOCK_HOOKS`/`PACKET_HOOKS`/`POSTING_HOOKS` to catch a value colliding across screens | `grep -n "POSTING_HOOKS = {" -A 40 app/src/postingAnalysis.js` → **no QC-link hook exists** | `ABSENT` (a new key is mandatory and is enforced) |

**Exactly what the control can and cannot do today — state this to the owner, do not discover it later:**

- **CAN**: navigate from the JD step to the QC step, in the route (`#/packet/<id>/qc`), back-button
  correct, verifiable by `ui-verify.yml`, using the existing `setActiveStep('qc')`.
- **CANNOT**: land on a particular requirement with QC's `pick` filter pre-applied. QC's
  requirement filter (`filtered to #<seq>` + `clear`, `QcRail.jsx:820-830`) is real and works — but
  only when set from *inside* QC by clicking a coverage row. Making it settable from the JD step is
  a **separate change** (lift `pick` to `PacketBuilder`, or add a route segment/query), and it is
  **not** in scope for 4.1-3.
- **Therefore the label matters.** `See where each one is answered →` promises per-line targeting.
  Either (a) ship the untargeted link and let the QC Coverage tab be the answer to "each one" — the
  Coverage tab already lists the posting line by line (`CoverageTab`, `QcRail.jsx:246-299`,
  coverage row 4.8-14 = BUILT) — or (b) do the lift. **AC 3.4 forbids shipping a label that claims
  more than the control does**, whichever is chosen.

**Origin check.** `grep -niE "see where each one" .claude/actions.md .claude/DEFERRED.md docs/qc-evidence/PULL-CANDIDATES.md` → **no hits anywhere.** Origin is the **prototype inventory**
(`PROTOTYPE-COVERAGE.md:123`, and `:681` records it as *"just outside the ten"*). Per CLAUDE.md's
feasibility rule, *"a row whose origin is 'the prototype' is a PROPOSAL and is never something the
owner is blocking."* **Treat 4.1-3 as a proposal, not a commitment**, and confirm scope before
building.

---

## PART 2 — ACCEPTANCE CRITERIA

Binary and observable. Where an AC names a file/line it is the *current* location; the
implementation may move it, but the assertion must survive the move.

### Gap 1 — `Needs a decision` list on the QC page (4.8-10)

**The one core system, restated as a constraint on the implementation:** the list is a
**projection of `GET /app/artifact/{id}/checks-result`**, taken through a new selector in
`app/src/qcRail.js`, mounted between `<ChangeLog/>` and the tab strip in `QcRail.jsx`. It reuses
`CheckRow`. It is not a new fetch, not a new tab, and not a new derivation of "needs attention".

**AC 1.1 (happy path — it is on the page).**
Given a packet whose assets have at least one finding with `state` `fail` or `warn`,
when the QC step (`#/packet/<id>/qc`) is rendered with **no tab clicked and no filter set**,
then a region carrying a new `QC_HOOKS` value (e.g. `qc-decisions`) is present in the DOM,
positioned **after** the `QC_HOOKS.changeLog` region and **before** the first `QC_HOOKS.tab`
element, and it renders one row per fail/warn finding.

**AC 1.2 (it is not behind a tab — the SPEC's actual words).**
Given the QC step,
when `RAIL_TABS` is compared to its pinned expectation,
then it still equals exactly `['Coverage','Original vs final','Remediation loops','Checks','Independent review']` and `app/test/qcRail.test.mjs`'s `assert.deepEqual` on it is **unmodified**.
*(Binary failure condition: if the diff touches that expected array, the AC fails regardless of what renders.)*

**AC 1.3 (the numbers cannot diverge — the blast-radius AC).**
Given any packet payload,
when the page-level list is rendered,
then the number of rows it renders equals `railTotals(entries).toFix + railTotals(entries).toReview`
**as displayed in the counts strip** (`QC_HOOKS.toFix`, `QC_HOOKS.toReview`), for every payload in
the existing fixtures — **and** the list must obtain those rows from the same selector chain, never
by its own `.filter(...)`.
*(This is the CLAUDE.md "counts on Today vs Swipe vs Pipeline must reconcile" rule applied here:
the header strip, the per-asset chips, the Checks tab and this new list are four consumers of one
number.)*

**AC 1.4 (`QcRail.jsx` still computes nothing).**
Given the implementation,
when `app/test/qcRail.test.mjs`'s test *"QcRail.jsx renders values and computes NO gate, NO severity, NO count"* runs unmodified,
then it passes — i.e. the new component contains no `state === 'fail' || state === 'warn'`, no
`.filter(...).length + ...`, no `.filter(r => r.engine...)`, and no `arr(x.result.y).length`.

**AC 1.5 (ONE definition of "needs a decision" — the third-copy guard).**
Given the new selector,
when `app/src/qcRail.js` and `app/src/assetGate.js` are grepped for the literal predicate
`state === 'fail'` paired with `state === 'warn'`,
then the count of such definitions is **not greater than it is on `main` today (2)** — the new
selector must call `engineRows()`/`railCounts()`/`attentionSplit()` rather than restate the rule.
*(Rationale: `assetGate.js:347` and `qcRail.js:132` already disagree only in name. `qcRail.test.mjs:635`
greps `QcRail.jsx` only and is structurally blind to a third copy in a module.)*

**AC 1.6 (ordering is the module's, and it is asserted).**
Given findings of mixed severity across more than one asset,
when the list renders,
then blocking (`fail`, deterministic) rows precede review (`warn`/reviewer) rows, the order is
produced by the selector (not by JSX), and a unit test asserts the emitted order for a fixture
containing at least one `fail`, one `warn` and one reviewer row.

**AC 1.7 (deep link on every row).**
Given a row whose finding names a field,
when `Open field →` is activated by click **and** by `Enter`/`Space`,
then `onGoToField(artifactId, section)` is invoked and `PacketBuilder`'s `setFieldFocus` +
`setActiveStep` run — i.e. the route changes to `#/packet/<id>/<step>` and `AssetBlocks` applies
its focus ring. Given a finding that names **no** resolvable field, then the row renders the
non-navigating state already used elsewhere (`QC_HOOKS.countInert`), and **no dead control is
rendered**.

**AC 1.8 (edge — empty list, and the two empties are different sentences).**
Given a packet where every asset was checked and **zero** findings are fail/warn,
then the region renders and says every check that could run is clear.
Given a packet where **no asset has a gate row at all** (`railGate(result) === 'unchecked'`),
then the region says the checks have not been run — it must **NOT** say "nothing needs a decision".
*(Absent evidence is `not_applicable`, never `pass`. This is the vacuous-green failure the whole
rail exists to prevent, and `ChangeLog`'s four-state comment at `QcRail.jsx:604-611` is the
precedent to copy.)*

**AC 1.9 (edge — mixed: some assets checked, some not).**
Given a packet with one checked asset carrying findings and one unchecked asset,
when the region renders,
then the checked asset's rows appear **and** the unchecked asset is named as unchecked; the row
count still satisfies AC 1.3 and `totals.unchecked` in the header remains non-zero and unchanged.

**AC 1.10 (error state).**
Given an asset whose `checks-result` fetch failed (`resultError` set),
when the region renders,
then it names that asset and shows the error text, and it does **not** silently omit the asset
(an omitted asset reads as "nothing to decide" for it).
Given an asset still loading (`resultLoading`), then it shows a loading state, not an empty one.

**AC 1.11 (edge — server self-contradiction is reported, not resolved).**
Given a payload where `attentionSplit(result).listed !== attentionSplit(result).counted`,
when the region renders,
then `reconcile(result)`'s sentence is surfaced (as `ChangeLog` already does for
`QC_HOOKS.correctionAnomaly`) and the component does **not** pick a winner between the two numbers.

**AC 1.12 (hook hygiene, enforced).**
Given the new region,
when `app/test/qcRail.test.mjs`'s *"every QC_HOOKS selector is rendered…"* and
`assetGate.test.mjs`'s cross-screen hook-collision union run,
then both pass: every new key is rendered, no `data-qc` is hand-typed, and no value collides with
`BLOCK_HOOKS`/`PACKET_HOOKS`/`POSTING_HOOKS`/`GATE_HOOKS`.

**AC 1.13 (styling constraints already asserted).**
Given the new region,
when *"the rail uses the shared tab classes and the Overlay primitive, with no raw hex"* runs,
then it passes — no raw hex, no interpolated custom-property name.

**REGRESSION GUARD 1 — name the exact existing behaviour that must not break.**
`ChangeLog` ("Done for you") must remain **on the page, immediately after the summary box and before
the new region**, must still render `QC_HOOKS.changeLog`, its per-asset `corrected` / `undone`
counts, `CorrectionRow`'s `Undo` and `Suggest something different`, and its **four distinct empty
sentences**. Concretely: `app/test/corrections.test.mjs` (which slices the region by the
`P8.6-CHANGELOG-BEGIN` / `P8.6-CHANGELOG-END` sentinels) must pass **unmodified**, and its assertion
`railAttention(base) === railAttention(withCorrections)` — *"the server attention number is
untouched"* — must still hold, i.e. corrections must not leak into the new list's rows or count.

**Config check (gap 1).** **One value: how many rows the list shows before it truncates**, if the
implementer adds truncation. Per CLAUDE.md's no-hardcoded-config rule, a literal cap in code with
no UI path is not allowed. **Preferred answer: add no cap at all** — the list is bounded by real
findings, and every other list on this rail is uncapped. If a cap is added, it must be an owner
setting alongside the other QC thresholds (`targetFor`/`thresholds` already flow into
`AssetBlocks`), and the code may only seed the first value. **The severity ordering and the row
labels are NOT config** — they are the module's semantics, asserted by tests.

**Blast radius (gap 1).** Everything that reads the same `checks-result` payload or the same
counts, all of which must still reconcile: `railTotals` → header counts strip (`QcRail.jsx:709-738`);
`railCounts` → per-asset gate chips (`:744-768`); `railAttention` → the `n counted` label (`:761`);
`ChecksTab` (`:400-434`) and `ReviewTab` (`:437-466`) → the same rows in tab form;
`AssetGateDrawer.jsx:62,188,460` → `attentionSplit` for the drawer summary and footer;
`packetGate` / `qcStepState` / `packetReadiness` / `packetFailList` (`qcRail.js`) →
`PacketBuilder.jsx`'s step circle and the Review-&-send step (`:930+`);
`reconcile()` → the anomaly sentence. **Nine consumers, one payload.**

---

### Gap 2 — `{{merge field}}` placeholders inline in static blocks (4.5-40)

**Scope decision this AC forces, before any code.** SPEC §4.5's sentence contains two asks.
**In scope:** render the `{{FieldName}}` token, derived from `row.merge_field`, which the client
already has. **Out of scope, and it must be said in the same breath:** the template's surrounding
prose, which no app route delivers (`api.js` calls neither `diag/doc-structure` nor
`diag/template-placeholders`). An implementer who accepts the row as written will discover this
mid-build; an implementer who accepts this AC will not.

**AC 2.1 (happy path).**
Given an insertion row with `generated === false` (so `shapeOf(row) === 'static'`),
when its block body renders,
then the literal string `{{<row.merge_field>}}` — e.g. `{{SkillsBullets1}}` — appears in the body,
visually distinguished as a placeholder token, and carries a new `BLOCK_HOOKS` value so
`ui-verify.yml` can select it.

**AC 2.2 (the token is derived, never hardcoded).**
Given any artifact type,
when the placeholder renders,
then it is built from `row.merge_field` at render time; `AssetBlocks.jsx` and `assetBlocks.js`
contain **no literal list of field names** for this purpose.
*(Binary check: `grep -n "SkillsBullets1\|ResumeSummary\|@CoverLetterBody" app/src/screens/AssetBlocks.jsx app/src/assetBlocks.js` returns no new hits attributable to this change. `TEMPLATE_META` in `api/src` stays the one home for the field list — `insertions.ts:44` `mergeFieldsFor` already reads it.)*

**AC 2.3 (edge — a block with no merge fields / no field name).**
Given a row whose `merge_field` is null, empty, or whitespace,
when the block renders,
then **no** placeholder token is rendered (never `{{}}`, never `{{null}}`, never `{{undefined}}`),
and the block falls back to its existing static sentence.

**AC 2.4 (edge — a NON-static block must be untouched).**
Given a row with `generated === true` (shape `prose`, `list` or `pipe`),
when the block renders,
then **no** placeholder token is added to its body, and `Marked`/`ListBody`/the pipe branch render
exactly the bytes of `row.after_text` as they do on `main`.
*(Binary check: the rendered text of a generated block is byte-identical before and after the change.)*

**AC 2.5 (the contradictory sentence is resolved, not left standing).**
Given a static block that now shows `{{FieldName}}`,
when its body is read,
then it does **not** simultaneously assert *"The pipeline cannot see that text, so it is not shown
as a draft"* about the same thing it is now showing. The copy must distinguish: the app knows
**which slot** this is; it does **not** hold the template's surrounding words.
*(Guard: `H:no-stale-not-built-claim` (`qcRail.test.mjs:604`) enforces exactly this class but greps
only `qcRail.js` and `QcRail.jsx`. Extend its file list to include `screens/AssetBlocks.jsx` in the
same commit, or add a sibling H-case with a slug — never a number, per the H-case naming rule.)*

**AC 2.6 (round-trip — the rendering layer must not corrupt the stored value).**
Given a static block,
then it exposes **no** save path: `AssetBlocks.jsx`'s List-Tweaks control remains gated on
`!isStatic && artifactId`, so a placeholder cannot be submitted as content.
Given a **generated** block whose `after_text` happens to contain a literal `{{…}}` (a leftover
token — `stripLeftoverTokens` (`packetTemplates.ts:232`) runs on the *document*, not on the stored
package value, so this is reachable),
when the block renders and the user then uses List Tweaks or `Show original`,
then the text submitted to `POST /app/artifact/{id}/ai-edit` and the text shown by `originalState()`
are **byte-identical to `row.after_text`** — the placeholder styling is presentational only and
adds, removes or re-encodes nothing.
*(Binary check: a unit test asserting the submitted payload equals the source string for a fixture
whose `after_text` contains `{{X}}`.)*

**AC 2.7 (the compact-resume disclosure — the OPEN owner decision).**
Given `type === 'compact_resume'`,
when its placeholders render,
then the screen does not assert that these tokens exist in the owner's actual Doc.
*(Ground truth, measured: `D:compact-template-placeholder-mismatch` in `.claude/DEFERRED.md`, from
api-test run **32784628025** — the Doc contains `{{ResumeSummary}}` and `{{SkillsBullets}}` and is
**missing** `SkillsBullets1/2`, `ExpertiseBullets`, `RelevantBullets1/2/3`; `usableAsTemplate false`.
`TEMPLATE_META.compact_resume` is a stale copy of the full resume's seven. **The owner's A-vs-B
decision is still open.** Rendering `{{SkillsBullets1}}` for a compact resume would show the user a
slot their document does not have. Either scope this AC to types with a verified placeholder set, or
label the compact resume's tokens as the code's expectation rather than the document's contents.
Do not silently ship the mismatch.)*

**AC 2.8 (error state).**
Given the insertions fetch failed for an artifact,
when its blocks would render,
then the existing error path is unchanged and no placeholder is invented for a row that was never
received.

**REGRESSION GUARD 2.** `shapeOf(row)` must keep returning `'static'` for `!row.generated` and must
not gain a field-name allow-list (its own comment: *"A field-name allow-list would go stale the
moment a template gains a placeholder"*). `AssetBlocks.jsx:561-562` must still render
`{row.merge_field}` in mono under `BLOCK_HOOKS.fieldSlot` — the new inline token is **in addition
to** the slot label, and if the implementer replaces the slot label with the token, SPEC §4.5's
*"the real merge-field name in mono"* row regresses. `originalState()`'s three states
(`changed` / `identical` / `none`) and `ORIGINAL_NONE_NOTE` must be untouched; in particular a
static block must still be able to reach the `identical` state — *"Identical - template text is not
merged per packet"* — without the placeholder text being spliced into the comparison.

**Config check (gap 2).** **Two candidates, and one is real.**
(a) *Whether placeholders are shown at all* — a display toggle. Precedent exists on this exact card:
`ee_posting_columns` (`PostingAnalysis.jsx:490`) is a persisted user preference explicitly *"a
stored preference rather than a code constant so it is the user's to change, per the 'no hardcoded
config' rule."* If a toggle is added, follow that pattern (persisted, default seeded in code).
**Recommended: no toggle** — SPEC §4.5 asks for this unconditionally, and a hidden-by-default
control would be the dead-UI failure. State the choice; do not leave it implicit.
(b) *The delimiter style* (`{{ }}`) — **not config.** It is the template engine's syntax
(`packetTemplates.ts:127` builds `vars['{{'+key+'}}']`); making it user-changeable would let the UI
disagree with the document. **Say "none" here deliberately.**

**Blast radius (gap 2).** `shapeOf` (`assetBlocks.js:144`) → `BlockBody` (`AssetBlocks.jsx:392`)
and `AssetBlock`'s `isStatic` branches (`:546`, `:556`, `:566`, `:634`);
`mergeFieldsFor`/`TEMPLATE_META` (`insertions.ts:44`, `packetTemplates.ts:22`) → every artifact
type's field list, and `varsForType`/`injectValues`/`stripLeftoverTokens`
(`appPackets.ts:8,730`) which build the real document from the same names;
`meterModel`'s `Fields generated` stat with its *"N static template fields"* sub-line
(`assetBlocks.js:569`) — the count of static fields is already rendered and must not change;
`originalState` → the `Show original` panel; `keywordPresence`/`Marked` (`AssetBlocks.jsx:445`)
which must not mark inside a placeholder token. **Seven consumers.**

---

### Gap 3 — `See where each one is answered →` on the JD card (4.1-3)

**AC 3.1 (happy path — it navigates for real).**
Given the JD step (`#/packet/<id>/jd`) with at least one extracted requirement,
when the control in the extraction card's header is activated by click **and** by `Enter`/`Space`,
then `window.location.hash` becomes `#/packet/<id>/qc` and the QC step renders.
*(Binary and observable in `ui-verify.yml`: the QC step's own text must appear after activation.)*

**AC 3.2 (no dead UI, and no new router in the card).**
Given the implementation,
then `PostingAnalysis.jsx` still imports nothing from `state.jsx` — navigation arrives as a prop
threaded from `PacketBuilder.jsx:835`, and that prop calls the existing `setActiveStep('qc')`.
*(Binary check: `grep -n "state.jsx" app/src/screens/PostingAnalysis.jsx` returns nothing.
Rationale: `setActiveStep` is the single existing step-navigation API with 12 call sites; a second
`go()` in a child screen is the parallel system the extend-don't-duplicate rule forbids.)*

**AC 3.3 (edge — a JD with no requirements).**
Given a posting whose extraction returned zero requirements (`req.requirements` empty), or whose
extraction has not run,
when the card renders,
then the control is **hidden**, not rendered-and-inert.
*(CLAUDE.md: "If a feature isn't ready, hide the control — don't fake it." A link labelled
"see where each one is answered" with no "each one" is precisely the fake control.)*

**AC 3.4 (the label may not claim more than the control does) — THE ADVERSARIAL AC.**
Given that QC's `pick` filter is internal state with no prop and no route segment
(`QcRail.jsx:658-660`),
when the control is activated,
then **one** of the following holds, and which one is stated in the PR:
 (a) the QC step opens on the **Coverage** tab, which lists the posting line by line — and the
     control's label/adjacent copy makes clear it opens the coverage list, not a single line; **or**
 (b) requirement targeting is actually implemented (`pick` lifted to `PacketBuilder` or carried in
     the route) and activating the control from a specific row lands with `QC_HOOKS.filter` showing
     `filtered to #<seq>`.
**It is a FAIL to ship the label `See where each one is answered →` with behaviour (a) while
implying (b).**

**AC 3.5 (edge — the QC step has nothing to show).**
Given a packet with no artifacts, or whose artifacts have no gate rows,
when the control is activated,
then the QC step still renders its unchecked/empty states (AC 1.8) rather than an error or a blank
panel — i.e. the control never navigates into a broken screen.

**AC 3.6 (error state).**
Given `reqError` is set on the JD card,
when the card renders,
then the control follows AC 3.3 (hidden), because a failed extraction has no answers to point at.

**AC 3.7 (hook hygiene, enforced).**
Given the new control,
when `app/test/postingAnalysis.test.mjs`'s *"every POSTING_HOOKS selector is rendered, and the card
hand-types none of them"* and `assetGate.test.mjs`'s cross-screen collision union run,
then both pass: a new `POSTING_HOOKS` key exists, is rendered, is not hand-typed, and its value
collides with no other screen's hooks.

**AC 3.8 (accessibility parity with the controls beside it).**
Given the control is a `span`,
then it carries `role="button"`, `tabIndex={0}` and an `Enter`/`Space` handler.
*(This is not boilerplate: `AssetBlocks.jsx:625-632` records that a control existing since P8.6 was
reported as MISSING from the app because `compare-ui.mjs` collects `button, [role="button"], a` and
a bare span was invisible to it.)*

**REGRESSION GUARD 3.** The card's existing header control **`Show as tabs` / `Show as columns`**
(`PostingAnalysis.jsx:539`) must still render, still toggle, and still persist to
`localStorage.ee_posting_columns` across a reload — adding a sibling control to the same header row
must not displace it or break its persistence. The three tabs and their counts
(`POSTING_HOOKS.tab`, `groupCount`) and the always-present legend (`POSTING_HOOKS.legend`) must be
unchanged.

**Config check (gap 3).** **None.** The control is unconditional when requirements exist and hidden
when they do not (AC 3.3); there is no threshold, cap or label a user would reasonably want to
change. Its *destination* is fixed by the step model (`STEPS`), which is not user-configurable and
should not become so. **Explicitly: do not add a "show QC links" preference** — that would be a
toggle whose only purpose is to hide a one-line control, and `ee_posting_columns` is the precedent
for a preference that changes *layout*, not one that hides a link.

**Blast radius (gap 3).** `PostingAnalysisCard`'s prop list (`PostingAnalysis.jsx:485`) and its one
mount (`PacketBuilder.jsx:835`); `setActiveStep` (`PacketBuilder.jsx:396`) and its 12 existing call
sites, including `goToField` (`:733-740`) which depends on it for the finding→draft path;
the route contract `#/packet/:id/:step` and `explicitStep`'s validation (`:394`);
`POSTING_HOOKS` (consumed by `postingAnalysis.test.mjs` and the cross-screen union in
`assetGate.test.mjs`); `scripts/compare-ui.mjs`'s control inventory, which will now count one more
control on the JD step — **if that inventory has a pinned expected count, it must be updated in the
same commit or it fails.** **Six consumers.**

---

## PART 3 — VERIFICATION PLAN

**Harness constraints, stated once.** The sandbox **cannot** reach `*.azurestaticapps.net`, so no
rendered-UI claim may be made from here. Two harnesses:

- **`node --test` in `app/`** — pure logic and the source-grep structural guards
  (`app/test/qcRail.test.mjs`, `corrections.test.mjs`, `assetGate.test.mjs`,
  `postingAnalysis.test.mjs`, and whatever new file the selectors get). Runs locally, seconds,
  deterministic → per CLAUDE.md §0c this is re-run **in full on every loop**.
- **`.github/workflows/ui-verify.yml`** (`scripts/ui-verify.mjs`) — headless Chromium on a GH
  runner, seeds `localStorage.ee_auth_user` then **reloads**, navigates to a hash route, asserts
  `;`-separated `expect` substrings all appear, uploads a full-page screenshot. Read
  `UI_VERIFY_RESULT` in the job log. **Run it with `run_in_background: true`** per the
  never-block-on-a-workflow rule.

**A precondition that must be satisfied before any `ui-verify` run below is meaningful.**
Every route below needs a **real packet id** for `von.ellis@enterpriseds.io` whose assets have
findings. Get it first via `db-query.yml`, e.g.
`select p.id, count(*) from packet p join artifact a on a.packet_id=p.id where p.owner_email='von.ellis@enterpriseds.io' group by p.id order by 2 desc limit 5;`
— or `Boost_DB_Connector` if it is enabled in the chat (it is the ~1s path; GitHub Actions is the
fallback). **A `ui-verify` run against a packet with no findings would go green on an empty list and
prove nothing** — that is the vacuous-pass this repo's rules exist to prevent, and it is why AC 1.8
splits the two empty states.

### Gap 1

| AC | Harness | Concrete test |
|---|---|---|
| 1.1 | `ui-verify.yml` | `route: "#/packet/<packetId>/qc"`, `owner: von.ellis@enterpriseds.io`, `expect: "Needs a decision;Done for you"`. Then confirm ORDER from the uploaded screenshot + `bodySnippet` — `expect` proves presence, **not** position, so position is a second check. |
| 1.1 (position, deterministically) | `node --test` | New case in `qcRail.test.mjs`: read `screens/QcRail.jsx`, assert `indexOf('QC_HOOKS.changeLog') < indexOf('QC_HOOKS.decisions') < indexOf('RAIL_TABS.map')`. A source-order grep is legitimate here — it is a structural rule a DOM-free test cannot otherwise express. |
| 1.2 | `node --test` | Existing `assert.deepEqual(RAIL_TABS.map(t=>t.label), [...])` must pass **and** `git diff main -- app/test/qcRail.test.mjs` must show no change to that array. |
| 1.3 | `node --test` | For every fixture in `qcRail.test.mjs`/`corrections.test.mjs`, assert `selector(entries).rows.length === railTotals(entries).toFix + railTotals(entries).toReview`. Include the `FEWER_COUNTED_THAN_SENT` and `MORE_COUNTED_THAN_SENT` payloads from `assetGate.test.mjs:127,141`. |
| 1.4 | `node --test` | Run the existing *"computes NO gate, NO severity, NO count"* test unmodified. |
| 1.5 | `node --test` | New grep case: count occurrences of the fail-or-warn predicate across `src/qcRail.js` + `src/assetGate.js` (comments stripped via the existing `stripComments`) and assert `<= 2`. |
| 1.6 | `node --test` | Fixture with `[warn(reviewer), fail(deterministic), warn(deterministic)]` in that input order; assert the selector's output order puts the deterministic `fail` first. |
| 1.7 | `ui-verify.yml` | `route: "#/packet/<packetId>/qc"`, `expect: "Open field"`. Full click-through needs a bespoke Playwright step — extend `scripts/ui-verify.mjs` (or add a sibling script) to click `[data-qc="qc-go-to-field"]` and assert the hash changed to a non-`/qc` step. **Do not claim 1.7 from the `expect` substring alone** — presence of the words is not proof the click navigates. |
| 1.8 (empty) | `node --test` + `ui-verify.yml` | Unit: two fixtures (all-clear vs all-unchecked) yield **two different** strings, asserted as `assert.notEqual`. Live: a packet with a clean gate → `expect` the all-clear sentence. |
| 1.9 | `node --test` | Mixed fixture; assert row count per AC 1.3 and `railTotals(...).unchecked > 0`. |
| 1.10 | `node --test` | Fixture entries with `resultError` and with `resultLoading`; assert the asset label still appears in the model output. |
| 1.11 | `node --test` | `MORE_COUNTED_THAN_SENT` fixture; assert `reconcile()`'s sentence is in the rendered model. |
| 1.12 / 1.13 | `node --test` | Existing hook-hygiene, cross-screen-collision and no-raw-hex tests, unmodified. |
| **Regression 1** | `node --test` | `app/test/corrections.test.mjs` passes **unmodified**, including `railAttention(base) === railAttention(withCorrections)`. |
| **Mutation proof (never skipped)** | `node --test` | For each NEW guard (1.3, 1.5, 1.6, 1.8): reinstate the defect — make the selector recount rows locally (1.3), add a third predicate copy (1.5), sort by input order (1.6), return one shared empty string (1.8) — and confirm the suite **FAILS**, then restore. A guard that passes with its defect reinstated is inert. |

### Gap 2

| AC | Harness | Concrete test |
|---|---|---|
| 2.1 | `ui-verify.yml` | `route: "#/packet/<packetId>/resume"`, `owner: von.ellis@enterpriseds.io`, `expect: "{{"` plus a real static field name for that packet — resolve it first with `db-query.yml` against the insertion rows (`select merge_field from artifact_insertion where artifact_id=… and generated=false`). **Never guess the field name**: if `compact_resume` is the artifact, `TEMPLATE_META` and the real Doc disagree (`D:compact-template-placeholder-mismatch`), so a guessed `expect` fails for a reason unrelated to the change. |
| 2.2 | `node --test` | Grep `screens/AssetBlocks.jsx` + `assetBlocks.js` for literal merge-field names; assert no new hits vs `main`. |
| 2.3 | `node --test` | Rows with `merge_field` of `null`, `''`, `'   '`; assert the rendered model contains no `{{`. |
| 2.4 | `node --test` | For a `generated:true` fixture of each shape, assert the body text is byte-identical to `after_text` (and to `main`'s output for the same fixture). |
| 2.5 | `node --test` | Extend `H:no-stale-not-built-claim`'s file list to include `screens/AssetBlocks.jsx`, or add a sibling H-case with a **slug** name; assert the "pipeline cannot see that text" sentence does not coexist with the placeholder branch. |
| 2.6 | `node --test` | Fixture whose `after_text` contains `{{X}}`; assert (i) the `ai-edit` payload string `===` `after_text`, (ii) `originalState(row).text` `===` `before_text`. |
| 2.7 | `node --test` + `api-test.yml` | Unit: assert the compact-resume path renders the disclosure. Ground truth for the mismatch is re-confirmable via `api-test.yml` → `GET /api/diag/doc-structure?templateId=…&type=compact_resume` (the run that measured it was **32784628025**). |
| 2.8 | `node --test` | Insertions-error fixture; assert no placeholder is rendered. |
| **Regression 2** | `node --test` + `ui-verify.yml` | Unit: `shapeOf` truth table unchanged; `originalState`'s three states unchanged. Live: same route as 2.1, `expect` also includes a **generated** field's mono slot label, proving `BLOCK_HOOKS.fieldSlot` still renders. |
| **Mutation proof** | `node --test` | Reinstate: emit `{{}}` for a null field name (2.3); add the placeholder to a generated body (2.4); trim/normalise the submitted text (2.6). Each must make the suite FAIL. |

### Gap 3

| AC | Harness | Concrete test |
|---|---|---|
| 3.1 | `ui-verify.yml` | Two runs. (i) `route: "#/packet/<packetId>/jd"`, `expect: "See where each one is answered"` — proves the control renders. (ii) A click-through step (extend `scripts/ui-verify.mjs`): click the new `data-qc` hook, assert `location.hash === "#/packet/<packetId>/qc"` **and** that QC-step text is present. **Run (i) alone does not prove 3.1** — it proves the words are on screen, which is exactly the dead-UI failure the standing rule names. |
| 3.2 | `node --test` | `grep` assert: `screens/PostingAnalysis.jsx` contains no `state.jsx` import and no bare `go(`. |
| 3.3 | `node --test` | Render-model test with `req.requirements = []` and with `req = null`; assert the control is absent. |
| 3.4 | Review + `ui-verify.yml` | If (b) is chosen: `route: "#/packet/<packetId>/qc"` after a targeted activation, `expect: "filtered to #"`. If (a) is chosen: assert in the PR text which was chosen, and `expect` the Coverage tab is the active panel (`data-qc-active="1"` on the coverage tab). **A PR that does not state which branch was taken fails this AC.** |
| 3.5 | `ui-verify.yml` | A packet with no gate rows: `route: "#/packet/<id>/qc"`, `expect` the unchecked sentence; `conclusion=success` with no console errors captured by the script. |
| 3.6 | `node --test` | `reqError` set; assert control absent. |
| 3.7 | `node --test` | Existing `postingAnalysis.test.mjs` hook test + `assetGate.test.mjs` union, unmodified. |
| 3.8 | `node --test` | Source assert on the new control: `role="button"`, `tabIndex={0}`, and a key handler for `Enter`/`Space` — the same three the `compare-ui.mjs` incident (`AssetBlocks.jsx:625-632`) was caused by missing. |
| **Regression 3** | `ui-verify.yml` + manual | `route: "#/packet/<packetId>/jd"`, `expect: "Show as columns"` (or `"Show as tabs"` depending on stored state). Persistence across reload is a click-then-reload step in the script; `expect` alone cannot prove it. |
| **Mutation proof** | `node --test` | Reinstate: render the control with zero requirements (3.3); drop `role="button"` (3.8). Each must make the suite FAIL. |

### What CANNOT be proven from this sandbox, stated plainly

- That any of the three renders on the live app. Only `ui-verify.yml` can, and only against a real
  packet id that has findings.
- That the compact-resume placeholder matches the owner's real Doc. That needs
  `api-test.yml` → `GET /api/diag/doc-structure`, and it is **currently known to mismatch**.
- That the deep link in AC 3.1(ii) and AC 1.7 actually navigates, until `scripts/ui-verify.mjs`
  gains a click step. Until then those two ACs are **unverified**, and must be reported as
  unverified rather than inferred from an `expect` substring.

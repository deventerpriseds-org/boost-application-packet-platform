# AC — finishing the PACKET MODULE UI across all seven tabs

**Author:** independent AC agent (not the implementing agent). **Date:** 2026-08-27.
**Branch measured from:** see §0 below. **Source of truth for row meaning:**
`docs/qc-evidence/qc/*.jsx` (the prototype) + `docs/qc-evidence/PROTOTYPE-COVERAGE.md`.

> **Written incrementally.** Each section is appended as it is completed. If this file ends
> mid-table, everything above the cut is complete and citable; nothing below it was started.

**Adversarial stance.** Every ABSENT claim below was checked three ways before being written,
because this repo has three recorded misses of exactly this shape
(`PROTOTYPE-COVERAGE.md` §1c):
1. **Read the import list** of the mounting file — a control defined in an imported component
   has none of its strings in the file that mounts it.
2. **A code comment is a claim about the code, not the code.** Trace the data, not the prose.
3. **Reconcile against `.claude/actions.md` and `.claude/DEFERRED.md`** — a row shown as open
   may already be recorded done or deliberately declined.

---

## §0. Measurement basis

| | |
|---|---|
| Working tree | `/home/user/boost-application-packet-platform`, branch `claude/three-small-ui-gaps` |
| Local `HEAD` | `6b7a5c0` *Track the deferred MasterContext guard; 4.6-9 verified live* |
| `origin/main` | `605c9d8` (fetched 2026-08-27) — local is **1 commit AHEAD**, unpushed |
| `PROTOTYPE-COVERAGE.md` measured at | `d8aec3c`, 2026-08-25 — **two days and ~6 commits stale** |

**Consequence, stated up front:** every `file:line` in `PROTOTYPE-COVERAGE.md` has drifted. Nothing
below cites a line number from that document; every citation was re-derived by grep against the
tree above. Three of its statements were checked and found stale or wrong, and they are called out
in §2 rather than inherited.

**Two things `PROTOTYPE-COVERAGE.md` gets wrong that the implementer must not inherit:**

1. **§11's §4.10 tally is stale and self-contradicting.** The prose reads *"BUILT 2 · PARTIAL 2 ·
   ABSENT 4 … This is the weakest section in the spec"* while the table immediately above it scores
   **all eight rows BUILT**, and §13b's mechanically-regenerated table scores §4.10 at **8/0/0/0 =
   100%**. The table is right; the prose paragraph was never updated after `dd4f61c`. **§4.10 has
   no work in it** — do not open it.
2. **`requirements.ts:61`'s comment is stale.** It reads *"no evidence engine exists yet (P2/P3)"*.
   There **is** one now (`D:evidence-resolves-nothing` is CLOSED; rows 4.1-14→19 shipped off it).
   What the comment says about the **column** is still true — `requirement.coverage` really is only
   ever `'escalated'` or `null`, proven from the writer at `api/src/functions/tests/requirements.ts:410`,
   not from the comment. Believing the comment's *reason* instead of testing its *claim* would send
   the implementer looking for a coverage engine that exists under a different name.

---

## §1. FEASIBILITY TABLE

One row per element named in the brief. `Proof` is a command actually run against the tree in §0
and its result. **`ALREADY BUILT` is stated first wherever it was found.**

### §1a — Tab 1 · SPEC §4.1 · JD analysis, "Extracted from this posting"

| Row | Producer (writes the data) | Consumer (reads it today) | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.1-5** per-tab count `n/m` | `groupRequirements()` `app/src/postingAnalysis.js` → `.length` per class. **No `n` (covered) producer for this axis:** `requirement.coverage` is written `'escalated' \| null` and never `'covered'` | `TABS` `PostingAnalysis.jsx:236-240` renders `count: responsibilities.length` — a bare total | `sed -n '236,240p' app/src/screens/PostingAnalysis.jsx` → `count: responsibilities.length`; `grep -n coverage api/src/functions/tests/requirements.ts` → `:410 coverage: loc.char_start === null ? 'escalated' : null` (**the writer, not the comment**) | **EXISTS-BUT-CONSTRAINED** — the *denominator* exists, the *numerator* does not on this field. A real numerator exists elsewhere: see 4.1-10. |
| **4.1-6** count coloured green when complete, red when not | same as 4.1-5 | nothing — `PostingAnalysis.jsx:708` renders `({t.count})` with `opacity:.75` and no colour | `sed -n '703,710p' app/src/screens/PostingAnalysis.jsx` → no `color:` on the count span | **EXISTS-BUT-CONSTRAINED**, and **the prototype's rule is WRONG here** — see §2b. Unblocked only by choosing a *different* colour rule, not by finding data. |
| **4.1-10** sub-header `n/m evidenced` | **TWO producers already exist.** (a) `summarizeKindSource()` `postingAnalysis.js:434-459` already returns `{total, evidenced, defaulted}`. (b) the evidence endpoint's per-row verdict, six states, `EVIDENCE_TONE` `postingAnalysis.js:343-351`, adapted by `evidencePresentation()` `:360` | `Group` renders `({split.text})` — the *kind_source* breakdown. **`split.evidenced` is computed and thrown away.** `evidencePresentation().provable` is consumed per row by `EvidenceLine` (`:381`) but never aggregated | `grep -n "evidenced" app/src/postingAnalysis.js` → `:449 const evidenced = breakdown.filter(isEvidencedKindSource)…`, `:451 total:`, `:452 evidenced,`; `grep -n "split.evidenced" app/src/screens/PostingAnalysis.jsx` → **no match** | **ALREADY BUILT (producer) — render missing.** A one-line render of an existing field, *or* a ~5-line aggregation of `provable`. **The two are different numbers — see §2a. Picking the wrong one is the whole risk in this row.** |
| **4.1-12** requirement chip in a 150–210px right column | n/a — pure layout | `RequirementRow` `PostingAnalysis.jsx:316-340`: chip + competency in a `display:flex … flexWrap:'wrap'` header ABOVE the quote | `sed -n '316,326p' app/src/screens/PostingAnalysis.jsx` → `style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap', marginBottom:5 }}` | **EXISTS-BUT-CONSTRAINED** — a CSS change with a **breakpoint decision attached**; the app's row carries a blockquote + char offsets + a paraphrase branch + a disclosure that the prototype's row does not. See §2c. |
| **4.1-20** `Where it is used →` | `useAssetProvenance(id, packetId)` `PacketBuilder.jsx:413` (swaps); `swapsForRequirement()` `qcRail.js:684`; navigator `goToField(artifactId, section)` `PacketBuilder.jsx:742` | `goToField` is consumed at `PacketBuilder.jsx:937` (`onGoToField` → QcRail) and `:1000` (send-step rows). **`PostingAnalysisCard` is passed neither `swaps` nor `onGoToField`** | `grep -n "onGoToField\|swaps" app/src/screens/PostingAnalysis.jsx` → **no match**; `sed -n '847,854p' app/src/screens/PacketBuilder.jsx` → props are `req reqError reloadReq coveredKw missingKw gapsScoredAt onParse parseBusy hasSummary keywordScore onOpenQc` only | **EXISTS-BUT-CONSTRAINED**, with the unblock **already written down** — `.claude/DEFERRED.md:199` `D:jd-evidence-has-no-field-link`. See §2d; the fix is one derivation change plus a prop thread, **not** a new navigator. |

### §1b — Tab 1 · SPEC §4.2 · "Posting vs your profile"

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.2-2** card `n of m` big number | `dimensions.ts` → `covered` / `total` on each comparison row; passed through by `loadComparison` and **never recomputed client-side** | `PostingAnalysis.jsx:225-226`, inside the fit card: `<b style={{fontSize:22, color:FIT_COLOR[r.fit]}}>{r.covered}</b> <span>of {r.total}</span>` — guarded by `r.fit !== 'not_applicable' && r.total`, with `nothing to count on this dimension` as the honest alternative | `grep -n "r.covered" app/src/screens/PostingAnalysis.jsx` → `:113` (the table row) **and `:225` (the card)**; `sed -n '190,235p'` → the block's own comment reads `SPEC 4.2-1/2/4 - the fit CARDS` | **ALREADY BUILT.** `PROTOTYPE-COVERAGE.md`'s PARTIAL (*"survives only as … inside each comparison row"*) is **stale** — it describes the state before `b73f8d6` shipped the cards. **There is no work in §4.2. Write a regression guard or nothing.** |

**§4.2 has zero open rows.** The brief listed 4.2-2 as PARTIAL on the coverage doc's authority; the
code disagrees, and the code is the ground truth.

### §1c — Tab 1 · SPEC §4.3 · ATS analysis modal

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.3-12** `Open QC →` button in the modal | `setActiveStep('qc')` — the ONE step API, `PacketBuilder.jsx` | `KeywordTallyOverlay` takes an `onGoQc` prop (`PostingAnalysis.jsx:855`) and renders `<button data-qc={POSTING_HOOKS.tallyOpenQc} onClick={onGoQc}>Open QC - every finding, per asset</button>` at `:891-893`, **hidden rather than stubbed when no handler is supplied**. Wired at `PacketBuilder.jsx:1030` | `grep -n "onGoQc" app/src/screens/PostingAnalysis.jsx app/src/screens/PacketBuilder.jsx` → `PostingAnalysis.jsx:855,891,892`, `PacketBuilder.jsx:1030` | **ALREADY BUILT.** The coverage doc's PARTIAL (*"the modal does not link to it"*) is **factually wrong against this tree**. Regression guard only. |
| **4.3-13** any navigation out closes the modal first | the two exit handlers, both defined at the mount site | `PacketBuilder.jsx:1029-1030`: `onGoResume={() => { setAtsOpen(false); setActiveStep('resume') }}` and `onGoQc={() => { setAtsOpen(false); setActiveStep('qc') }}` — **`setAtsOpen(false)` is the first statement in both**, which is exactly the prototype's `setPanelOpen(false)` ordering (`packet.jsx:345,347,350`) | `sed -n '1024,1031p' app/src/screens/PacketBuilder.jsx` → both handlers, close-then-navigate | **ALREADY BUILT for every navigation that exists.** The coverage doc says this *"needs a runtime check"*; **reading the call site settles it — no runtime check is required to see which statement runs first.** ⚠️ **One real residual, and it is a different row:** the modal's per-asset gate rows (`PostingAnalysis.jsx:838-846`) have **no `onClick` at all** — the prototype's third exit (`setDrawer({type})`) does not exist here. There is no ordering bug; there is a *missing* navigation, and it is the same missing navigation as **4.4-14**. Treat it there, once, not twice. |

**§4.3 has zero build rows.** Both listed PARTIALs are built. The only §4.3-adjacent work is the
gate-row deep link, which belongs to 4.4-14.

### §1d — Tabs 2–5 (asset steps) · SPEC §4.4 · artifact card + asset header

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.4-24 / -25 / -26** per-kind `Must-haves` / `Responsibilities` / `Nice-to-haves` counters | `REQ_KIND_STATS` `app/src/assetBlocks.js:210-215` + the loop in `meterModel()` `:687-693`, which reuses `groupRequirements()` (imported `:220`) over `requirements.requirements` — the endpoint **already sends the rows, each carrying `kind`** | `DistributionMeter` `AssetBlocks.jsx:290` destructures `stats`; **every** stat renders at `:354` (`stats.map(s => <Stat …/>)`) and on the collapsed row at `:303` | `sed -n '685,694p' app/src/assetBlocks.js` → `for (const k of REQ_KIND_STATS) { … stats.push({ key: \`kind_${k.key}\`, n: placed, d: rows.length … }) }`; the block's own comment reads `Per-kind split (prototype §10)` | **ALREADY BUILT — all three.** `PROTOTYPE-COVERAGE.md`'s PARTIAL says these *"[need] per-kind denominators on `GET /app/opportunity/{id}/requirements` (returns `total` only) — an endpoint extension."* **That is wrong on both halves**: the endpoint returns `requirements` (the rows) as well as `total` (`api/src/functions/tests/appRequirements.ts:693`), and no endpoint change was needed or made. **Three rows of phantom API work. Do not open the endpoint.** |
| **4.4-14** the gate count deep-links to the first failing field | `packetFailList(entries)` `qcRail.js` → `{artifactId, type, check_key, mergeField, observed, offenders, unchecked}`; navigator `goToField(artifactId, section)` `PacketBuilder.jsx:742` | `packetFailList` is consumed on the **send** step (`PacketBuilder.jsx:1000` → `goToField(f.artifactId, f.mergeField)`). `GateBadge` **already accepts `onClick`** and, when given one, already renders `role="button"`, `tabIndex={0}` and an Enter/Space `onKeyDown` (`AssetGateDrawer.jsx`, `GateBadge`). **All three mounts omit it**: `PacketBuilder.jsx:184` (card), `:959` (send list), `PostingAnalysis.jsx:845` (tally modal) | `grep -n "GateBadge" app/src/screens/PacketBuilder.jsx app/src/screens/PostingAnalysis.jsx` → `:184`, `:959`, `:845` — **none passes `onClick`**; `sed -n '/export function GateBadge/,/^}/p' app/src/screens/AssetGateDrawer.jsx` → `onClick` in the signature, `role={onClick ? 'button' : undefined}` | **EXISTS-BUT-CONSTRAINED — the cheapest real row in this document.** Needs **a handler at three mount sites**, zero new derivation, zero new component, zero API. ⚠️ **The one real constraint:** `mergeField` is `CHECK_SUBJECT_FIELD[r.check_key] \|\| null` — it **can be null**, and `unchecked` items always have `mergeField: null`. A badge that navigates nowhere is the dead UI the standing rule forbids. See AC 4.4-14.2. |
| **4.4-8** the three links are real `nowrap` **buttons** | n/a — markup | `PacketBuilder.jsx:231-247`: `<a href={a.docUrl} target="_blank" rel="noreferrer" className="px-link">` ×2, and `<span className="px-link" role="button" tabIndex={0} onKeyDown=…>` for Copy | `sed -n '228,248p' app/src/screens/PacketBuilder.jsx` → the `<a>` and the `role="button"` span; the file's own comment records the a11y hole as already closed | **EXISTS-BUT-CONSTRAINED, and the prototype is WRONG here — see §2e. Recommend NOT building it as specified.** Converting a real `<a href target="_blank">` into a `<button>` **removes** middle-click, ⌘-click, open-in-new-tab and "Copy link address". The prototype uses a button only because its link has no destination. The genuinely missing half is one CSS property. |
| **4.4-29** `Go to field →` on the asset-header open-items list | `focusField` / `useScrollToFocus` (`focusRing.js`), `goToField` `PacketBuilder.jsx:742` | Deep links work, driven **from the QC rail** (`onGoToField` → `QcRail.jsx` → `AssetBlocks.jsx` focus ring). The asset header's own findings were **relocated** into each field's margin (4.4-28 / 4.5-23, `AssetBlocks.jsx:770`) | `grep -n "findingsByField\|fieldFindings" app/src/screens/AssetBlocks.jsx` → the findings render per field, in the margin | **EXISTS-BUT-CONSTRAINED by a deliberate relocation.** A finding already rendered **inside the field it belongs to** needs no "go to field" link — the reader is in the field. Building it means either re-creating the header list (a second enumeration of one fact, the thing `4.2-4` was guarded against) or adding a link that scrolls 200px. **Recommend closing as DELIBERATE, not building.** See AC 4.4-29.1. |

### §1e — Tabs 2–5 · SPEC §4.5 · field blocks

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.5-3** margin stacks at the spec's breakpoint | n/a — layout | `useWideRef(min = 700)` `AssetBlocks.jsx:166`; the grid at `:883` is `wide ? 'minmax(0,1fr) 250px' : '1fr'` | `grep -n "useWideRef" app/src/screens/AssetBlocks.jsx` → `:166 function useWideRef(min = 700)` | **EXISTS-BUT-CONSTRAINED — a one-character change with a real behaviour consequence.** SPEC §3 says **1080**; the code says **700**, with **no recorded decision** either way. Raising it to 1080 makes the 250px provenance margin *stack* on every viewport between 700 and 1080 — a visible regression for anyone on a 900px window who has the margin today. **This is an owner-visible choice, not a bug fix.** See AC 4.5-3.1. |
| **4.5-12** `PickList` — `type:'select'` field shape | **NOTHING.** `shapeOf(row)` returns only `static` / `pipe` / `list` / `prose`, and there is no `select`, `candidates`, or per-item candidacy anywhere on the insertions payload | nothing | `sed -n '/export function shapeOf/,/^}/p' app/src/assetBlocks.js` → four returns, no `select`; `grep -rn "'select'" api/src/functions/tests/*.ts` → no field-shape hit | **ABSENT — and absent at the PRODUCER, not the renderer.** This is the only row in the whole set with **no data behind it at all**: building `PickList` means first inventing per-item candidacy on the insertions payload. Portfolio-only, so **zero resume impact**. `PROTOTYPE-COVERAGE.md` §14 ranks it last of five and calls it *"Expensive, low value."* **Concur. Do not build. See AC 4.5-12.1 (a scope decision, not a build).** |

### §1f — Tabs 2–5 · SPEC §4.6 keyword panel · §4.7 inline ask

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.6-8** `Put back "<original>"` in the keyword detail panel | `swap_decision.from_label` (the original) is stored and rendered on the Original-vs-final tab; the only revert **mutation** in the system is `POST /app/correction/{correctionId}/revert` | `CorrectionRow`'s `Undo` (`QcRail.jsx`, imported into `AssetBlocks.jsx:44`) and the Original-vs-final tab. The keyword panel (`AssetBlocks.jsx`, `proposedKeywordDetail`) carries no action | `grep -rn "revert" api/src/functions/tests/*.ts \| grep "app.http"` → **`app/correction/{correctionId}/revert` ONLY** — there is **no swap revert route**; `grep -n revert app/src/api.js` → `:209 revertCorrection` only | **EXISTS-BUT-CONSTRAINED, and the constraint is an API one.** A keyword chip's "original" is a **swap**, and a swap cannot be reverted — only a *correction* can. Building `Put back` here means a new route + a new mutation on the provenance record, which is **accusation-grade (Tier 1)** work, not a panel button. The existing honest path is `Drop it` (4.6-10, verifier-CONFIRMED) which seeds the ask box and writes nothing at activation. |
| **4.7-7** confirms in place on send | `api.aiEditArtifact(artifactId, {instruction, section})`, then `onCorrectionsChanged()` reloads | `AssetBlocks.jsx` ask box: on success it runs `setAsk(''); setAskOpen(false); await onCorrectionsChanged()` — the box **closes and the block reloads, silently**. On failure `askError` renders **in place** (`{askError && <div className="px-note">…}`) | `sed -n '/BLOCK_HOOKS.askSend/,+12p' app/src/screens/AssetBlocks.jsx` → success path sets `askOpen(false)` and renders nothing; `askError` is the only in-place message | **EXISTS-BUT-CONSTRAINED — and the asymmetry is the finding.** Failure speaks in place; **success is silent**. The reader cannot distinguish "sent and applied" from "the button did nothing". No new data, no API: ~6 lines of local state that must **survive the box closing**. Genuinely cheap and genuinely worth doing. |
| **4.7-8** forwards to the assistant | — | — | `grep -rniE "assist" app/src` → `postingAnalysis.js` (a comment), `AssetBlocks.jsx:495` (a comment), `Call.jsx` (a different screen). Import lists of `PacketBuilder.jsx`, `AssetBlocks.jsx`, `QcRail.jsx`, `AssetGateDrawer.jsx` re-read — **none imports an assistant component** | **ABSENT, and NOT independently buildable.** It has no target. It moves with §4.11 and only with §4.11. **No build-AC is written for it** — see §5. |

### §1g — Tab 6 · SPEC §4.8 · QC & evidence step

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.8-2** header must-have coverage | `artifact_score.must_have_coverage` — the **deterministic** check, the one score part that IS non-null on live rows | `scoreParts()` `assetGate.js` returns `{key:'must', label:'Must-haves evidenced', value: score.must_have_coverage, source: score.must_have_source}`, rendered by `<ScoreParts>` in the rail | `sed -n '/export function scoreParts/,/^}/p' app/src/assetGate.js` → the `must` part is first in the list | **ALREADY BUILT.** The bar renders whenever the checks have run. `PROTOTYPE-COVERAGE.md`'s PARTIAL is about the *composite*, which is 4.8-1's problem, not this row's. |
| **4.8-1** header composite match | `computeArtifactScore` — emits a composite **only when all three parts exist**. `keyword_coverage` is null (no published term library) and `seniority_alignment` is null (the reviewer has not graded) | `railHeadline(score)` `qcRail.js:283-297` returns `{hasNumber:false, why:'No overall number: a composite is only computed when all three parts exist, and N of them do not - …'}` and the rail prints that sentence | `sed -n '276,297p' app/src/qcRail.js` → the docblock states the cause and the function prints the honest absence | **EXISTS-BUT-CONSTRAINED — and there is NO code to write.** The number is absent because **two of its three inputs are null**, and `keyword_coverage` is null *because of* `D:term-library-off-by-owner-decision`. **The composite will appear on its own the day the library publishes and the reviewer grades.** Writing anything here means fabricating a composite — banned outright by this repo's own standing rule (*"Never fabricate a composite"*). **Close as data-blocked; write a guard that the honest sentence still renders.** |
| **4.8-11** attention ordering fail → open → warn → fixed → soft | `railDecisions(entries)` `qcRail.js:617` orders **deterministic-fail → deterministic-warn → reviewer-fail → reviewer-warn**, filtered by `NEEDS_ATTENTION = state === 'fail' \|\| 'warn'`. `SEV_LABEL` `assetGate.js` defines all four severities: `fix` / `review` / `soft` ('Your call') / `fixed` | **Two on-page lists, in the prototype's order:** `<ChangeLog>` (the `fixed` group, 4.8-6) then `<Decisions>` (`QcRail.jsx:876`, the fail/warn group, 4.8-10 — shipped `8d721a0`+`1a886a8`) | `sed -n '/export function railDecisions/,+12p' app/src/qcRail.js` → the nested `for` loops give the ordering; `grep -n "<Decisions" app/src/screens/QcRail.jsx` → `:876`; `sed -n '/export const SEV_LABEL/,/^}/p' app/src/assetGate.js` → `soft: 'Your call'` | **ALREADY BUILT except for ONE severity.** `open` is DELIBERATE (`assetGate.js:78-87` refuses to mint it — 4.4-33/4.8-13). `fail`, `warn` and `fixed` all render on the page in order. **`soft` alone is missing from `Decisions`.** ⚠️ **And adding it is NOT a one-line filter change:** `railDecisions.rows` is asserted to reconcile with the counts strip (`toFix` + `toReview`), and `soft` is in **neither** count — so widening the filter breaks the reconciliation guard **by construction**. See AC 4.8-11.1. |
| **4.8-8** `Change it` on a done-for-you row | `api.aiEditArtifact(artifactId, {instruction, section})` — the same route the ask box and the keyword drop hatch use | The row carries `Undo` and `Review →`. The rewrite capability is the field's `List Tweaks` | `grep -n "aiEditArtifact" app/src/screens/AssetBlocks.jsx app/src/screens/QcRail.jsx` → `AssetBlocks.jsx` only | **EXISTS-BUT-CONSTRAINED — and there is a PROVEN pattern to copy.** `keywordActions()` (4.6-10/11, verifier-CONFIRMED) already establishes the app-native shape: **seed the field's existing ask box, write nothing at activation.** `Change it` is the same shape applied to a correction row. The only cost is that `CorrectionRow` lives in `QcRail.jsx` and the ask box lives in `AssetBlocks.jsx`, so the seed must travel via `onGoToField` + a seed argument. |
| **4.8-20** `Undo this` on a swap row | — for a *real* undo: **nothing.** There is no swap-revert route and no swap-revert mutation | `CompareTab` `QcRail.jsx` renders `Original \| Final \| What happened \| Why`, read-only | `grep -rn "revert" api/src/functions/tests/*.ts \| grep app.http` → correction revert only. **And read the prototype:** `docs/qc-evidence/qc/evidence.jsx:233` → `onClick={() => onAsk(\`Undo the swap of ${r.orig} in ${r.list}.\`)}` | **EXISTS-BUT-CONSTRAINED — and the prototype does NOT do what the row's name implies. See §2f.** The prototype's `Undo this` **undoes nothing**: it types a sentence into the **assistant panel**. Building a genuine per-swap undo would be building something the prototype never had, on an API route that does not exist, against the provenance record — Tier 1. |
| **4.8-21** `Ask why` on a swap row | — | The **`Why` column already renders the answer**, always: `verbatim_quote` → *the posting says "…"*, else the driver sentence (`you changed this yourself` / `no line of the posting backs this change`) or `rationale` | `sed -n '/^function CompareTab/,/^}/p' app/src/screens/QcRail.jsx` → the 4th column; prototype `evidence.jsx:234` → `onAsk(\`Why did you change ${r.orig} in ${r.list}?\`)` | **ABSENT as specified, and it is a §4.11 row wearing a §4.8 costume. See §2f.** `PROTOTYPE-COVERAGE.md` §14 calls it *"A one-liner."* **It is not** — its `onAsk` target is the assistant panel that does not exist. It is a one-liner only if it is redefined as "seed the ask box", and even then the app **already prints the why** in a column the prototype does not have. |

### §1h — Tab 6 · SPEC §4.9 · per-asset QC drawer

| Row | Producer | Consumer today | Proof (command + result) | Verdict |
|---|---|---|---|---|
| **4.9-12** `Ask for a change` in the drawer footer | `footerFor(result)` `assetGate.js` supplies the footer's states; `api.aiEditArtifact` supplies the capability | The equivalent lives on the artifact card (`PacketBuilder.jsx:290`, `List Tweaks`) and per field (`AssetBlocks.jsx`). The drawer footer (`AssetGateDrawer.jsx:512`, `const f = footerFor(result)`) carries approve states only | `grep -n "footerFor\|List Tweaks" app/src/screens/AssetGateDrawer.jsx` → `footerFor` at `:8,:35,:512`; **no ask control** | **EXISTS-BUT-CONSTRAINED by a deliberate relocation, same class as 4.4-29.** Adding a third mount of the same ask box in a drawer whose Blocks tab already deep-links into the fields that own it is duplication, not coverage. **Recommend closing as DELIBERATE.** See AC 4.9-12.1. |

---

## §2. WHAT THE FEASIBILITY PASS CHANGED — read this before writing code

### §2·0 — SEVEN of the twenty-three PARTIAL rows are ALREADY BUILT

Stated first, per the rule. These were checked against the tree in §0, not against the coverage
doc, and **every one of them has a `file:line` today**:

| Row | Coverage doc says | The code says |
|---|---|---|
| **4.2-2** card `n of m` big number | PARTIAL — *"survives only … inside each comparison row"* | `PostingAnalysis.jsx:225-226` — 22px, `FIT_COLOR[r.fit]`, in the card. Comment: *"SPEC 4.2-1/2/4 - the fit CARDS"* |
| **4.3-12** `Open QC →` in the modal | PARTIAL — *"the modal does not link to it"* | `PostingAnalysis.jsx:891-893`, prop `onGoQc` `:855`, wired `PacketBuilder.jsx:1030` |
| **4.3-13** navigation closes the modal first | PARTIAL — *"needs a runtime check"* | `PacketBuilder.jsx:1029-1030` — `setAtsOpen(false)` is the **first statement** in both exit handlers. No runtime check needed to read a statement order |
| **4.4-24** `Must-haves` counter | PARTIAL — *"needs … an endpoint extension"* | `assetBlocks.js:687-693`, rendered `AssetBlocks.jsx:354`. **No endpoint change was needed or made** |
| **4.4-25** `Responsibilities` counter | PARTIAL — same | same |
| **4.4-26** `Nice-to-haves` counter | PARTIAL — same | same |
| **4.8-2** header must-have coverage | PARTIAL | `scoreParts()` `assetGate.js` — `Must-haves evidenced`, the one non-null part |

**Consequence: 7 of 23 PARTIAL rows are regression-guard work, not feature work**, and one of them
(4.4-24/25/26) would have sent the implementer to open an API endpoint that needs nothing.
**`PROTOTYPE-COVERAGE.md` is a 2-day-old measurement and must not be used as a work queue.**

### §2a — 4.1-10: there are THREE different numbers called "evidenced", and they disagree

This is the single highest-risk row in the document, and the risk is not difficulty — it is
**picking the wrong number and shipping a false statement about the owner's profile.**

| # | Name in code | What it actually counts | Where |
|---|---|---|---|
| 1 | API `evidenced` | `r.evidence_quote != null` — a **stored** quote exists | `appRequirements.ts:665-666`, shipped in the payload today, **read by nothing in `app/src`** |
| 2 | `summarizeKindSource().evidenced` | rows whose **`kind_source` came from the posting** rather than a parser default | `postingAnalysis.js:449` — computed, returned, **never rendered** |
| 3 | `evidencePresentation().provable` | `evidenceState === 'verified'` — the excerpt **is those bytes in that record today** | `postingAnalysis.js:360-368`, consumed **per row** by `EvidenceLine`, never aggregated |

**#2 is a trap.** It is in the same file as `EVIDENCE_TONE`, it is literally named `evidenced`, and it
is the easiest one to render — `split.evidenced` is already destructured next to `split.text`. **It
means "the posting said so", not "your profile proves it".** Rendering it under the label
`n/m evidenced` is a false claim about the owner's profile — the exact failure
`postingAnalysis.js:296-315` was written to prevent.

**#1 and #3 differ on precisely the four `warn` states** (`stale`, `misresolved`, `source_missing`,
`unverified`). #1 counts a row whose quote is stored but no longer resolves; #3 does not.
`postingAnalysis.js:314` calls those four *"there IS evidence and we cannot stand behind it right
now"*. **#3 is the only number that means what the word "evidenced" means to a reader.**

`grep -rn "evidenced" app/src/` returns **no consumer of the API's `evidenced` field.** Every one of
the three is currently thrown away.

### §2b — 4.1-6: the prototype's colour rule is WRONG for this app, and cannot be ported

The prototype colours the count `t.n === t.d ? green : red`, over `r.coverage === 'covered'`
(`packet.jsx:118-123`). Three independent reasons that rule cannot be ported:

1. **`requirement.coverage` never says `'covered'` here.** Proven from the **writer**, not the
   comment: `api/src/functions/tests/requirements.ts:410` — `coverage: loc.char_start === null ?
   'escalated' : null`.
2. **This app's per-row evidence state has SIX values, four of which are `warn` on purpose.** A
   two-colour green/red rule must paint `stale` / `misresolved` / `source_missing` / `unverified`
   red. `EVIDENCE_TONE` (`postingAnalysis.js:343`) makes `none` **the only red**, because *"the four
   unprovable-but-present states are `warn` - something to fix in the pipeline, not a finding about
   the owner."* A red count over a `misresolved` row tells the owner their CV does not support a
   claim it does support.
3. **The third tab can never be coloured at all.** The prototype's third tab is `ATS keywords`,
   coloured off the term library. This app's third tab is `Keywords` (model-suggested), and
   `postingAnalysis.js:233-235` records that attaching a count to it *"made a suggestion look like a
   measurement — `model_keyword` is explicitly 'never scoreable' in `requirements.ts`."* A green/red
   rule applied to two of three tabs is worse than none.

**Do not port the rule. Specify a three-state tone (`green` / `warn` / `red`) driven by the SAME
`EVIDENCE_TONE` map the rows already use, or leave the count uncoloured.** AC 4.1-6.1 says which.

### §2c — 4.1-12: the prototype's row is a stub; this app's row is not

The prototype's right column holds a `ReqChip` and one status word (`packet.jsx:40-47`). This app's
row holds a chip, a competency, **a `<blockquote>` with the employer's words and character offsets,
a paraphrase branch, a `show the line` disclosure and an expandable evidence panel**
(`PostingAnalysis.jsx:316-380`). A `minmax(150px, 210px)` right column is right for the prototype's
content and cramped for this one at anything under ~1000px. **The row therefore carries a breakpoint
decision, and 4.5-3 carries the same one.** Do them together or not at all.

### §2d — 4.1-20: the unblock is already written down, and it is a DERIVATION change

`.claude/DEFERRED.md:199` (`D:jd-evidence-has-no-field-link`) states the diagnosis and the fix. The
diagnosis, re-verified: the `list → artifact` map (`listOwners`, `PacketBuilder.jsx:418`) is
populated by asset cards **registering as they render** (`onListsRendered`/`registerLists`,
`:915`) — so **on the JD step it is `{}`**, and the link would be absent exactly where SPEC asks for
it. The stated unblock, verbatim:

> *"Derive `list -> artifact` from the packet's own `artifacts` rather than from render-time
> registration, then thread `swaps` + `onGoToField` into `PostingAnalysisCard` and render the link
> ONLY where a swap actually names the requirement (no dead UI). Tier 2 - it navigates, it decides
> nothing."*

Two things this makes explicit that the coverage doc does not: it is **Tier 2** (no AC subagent, no
verifier — though this document exists anyway), and the render-time-registration source is to be
**replaced**, not supplemented. Note the blast radius the DEFERRED entry does not name: `listOwners`
is consumed by `AssetBlocks.jsx:367, 417, 569, 1158` (`sharedSourceNote`, `listBodyModel`). Changing
where it comes from touches all of them.

### §2e — 4.4-8: building this row as specified is a REGRESSION

`Open Google Doc ↗` and `Open Slides ↗` are real `<a href={a.docUrl} target="_blank">` elements. The
prototype renders them as `<button>` because **the prototype's link has no destination.** Turning a
real anchor into a button destroys middle-click, ⌘-click, open-in-new-tab and "Copy link address",
and gains nothing — the a11y hole the register flagged is **already closed** (`role` + `tabIndex` +
key handler on the Copy control, `PacketBuilder.jsx:237-247`), and the file records that closing it
also stopped `compare-ui.mjs` reporting the control as missing.

**The only defensible half of this row is `nowrap`** — one CSS property, so a link never wraps
mid-label. Specified as AC 4.4-8.1; the button conversion is specified as **declined**.

### §2f — 4.8-20 and 4.8-21 are §4.11 rows: in the prototype, neither one does what its name says

Read the prototype's own handlers (`docs/qc-evidence/qc/evidence.jsx:232-234`):

```js
onClick={(e) => { e.stopPropagation(); onAsk && onAsk(`Undo the swap of ${r.orig} in ${r.list}.`); }}   // "Undo this"
onClick={(e) => { e.stopPropagation(); onAsk && onAsk(`Why did you change ${r.orig} in ${r.list}?`); }} // "Ask why"
```

**`onAsk` is the assistant-panel seed.** `Undo this` **undoes nothing** and `Ask why` **answers
nothing** — both type a sentence into the §4.11 panel. So:

- `PROTOTYPE-COVERAGE.md` §14 rank 4 calls **4.8-21 *"A one-liner"***. **It is not.** Its target does
  not exist. It is a one-liner only after it is *redefined* away from the prototype.
- **4.8-20 is not a request for a per-swap undo.** Reading it as one leads to a new API route, a new
  mutation on the provenance record and Tier-1 process — for a row the prototype never implemented.
- The app **already prints the why**, always, in a `Why` column the prototype does not have (the
  prototype hides it behind a row expand). So `Ask why` adds a conversational follow-up to an answer
  already on screen.

**The honest app-native substitution already exists and is verifier-CONFIRMED**: `keywordActions()`
(4.6-10/11) **seeds the field's existing ask box and writes nothing at activation.** If these two
rows are built at all, that is the shape — and they should be counted as §4.11 substitutions, not
as §4.8 features. AC 4.8-20.1 / 4.8-21.1 specify exactly that, and specify what must NOT be claimed.

### §2g — the prototype's fixed artifact-type list is fake data, and one row still inherits it

`packet.jsx:344-349` / the prototype's QC summary iterate a **hardcoded** `['resume',
'compact_resume', 'cover', 'portfolio']`, drawing a gate row for every type whether or not the
packet has that asset. This app already refused that: 4.3-11 renders *"Every asset this packet
actually has"* (`PostingAnalysis.jsx:833-846`) off `qcSummaryModel`'s real artifact list, and names
an unreadable one `gate unavailable` rather than dropping it.

**Do not reintroduce the fixed list anywhere.** In particular, when wiring 4.4-14's deep link into
those same gate rows, the row set stays the packet's real artifacts.

---

## §3. SEQUENCE — what to do first, and what to land per tab

**The seven tabs** (`PacketBuilder.jsx:97-109`): 1 `jd` Posting analysis · 2 `resume` · 3 `cover` ·
4 `portfolio` · 5 `video` · 6 `qc` QC & evidence · 7 `send` Review & send.

Tabs 2–5 are **the same code** (`ArtifactCard` + `AssetBlocks`), so every §4.4/§4.5/§4.6/§4.7 row
lands once and appears on four tabs. **Tab 7 has no work at all** — §4.10 is 8/8 BUILT (§0 note 1).

### §3a — the order, by cost and risk

| # | Row(s) | Tab | Cost | Risk | One-liner? |
|---:|---|---|---|---|---|
| **1** | **4.4-14** gate count deep-links | 2–5 (+1, +7) | **1 handler × 3 mount sites** | Low — `GateBadge` already has the whole affordance | **Yes**, plus a null-field guard |
| **2** | **4.7-7** in-place send confirmation | 2–5 | ~6 lines of local state | Low — no data, no API | Near |
| **3** | **4.4-8** `nowrap` on the three links | 2–5 | **1 CSS property** | None | **Yes** |
| **4** | **4.1-10** `n/m evidenced` sub-header | 1 | 1 aggregation + 1 render | **HIGH — picking the wrong number ships a false claim (§2a)** | No. The render is one line; **choosing the number is the work** |
| **5** | **4.1-6** tone on the tab count | 1 | 1 map lookup + 1 style | **Medium — the prototype's rule is unportable (§2b)** | Only after the rule is redefined |
| **6** | **4.1-5** `n/m` on the tab | 1 | rides on #4 | Medium — same numerator question | Rides on #4 |
| **7** | **4.5-3 + 4.1-12** the breakpoint pair | 1, 2–5 | 1 default + 1 grid | **Medium — visible regression between 700 and 1080px (§2c)** | Yes, **but needs a decision first** |
| **8** | **4.8-8** `Change it` seeds the ask box | 6 | cross-file seed thread | Medium — `CorrectionRow` is in `QcRail.jsx`, the box in `AssetBlocks.jsx` | No |
| **9** | **4.1-20** `Where it is used →` | 1 | **1 derivation change + 1 prop thread** | **Medium-high — `listOwners` has 4 other consumers (§2d)** | No |
| **10** | **4.8-11** `soft` in the Decisions list | 6 | filter + a second count | **High — widening the filter breaks the reconciliation guard by construction** | **No — the coverage doc's framing is wrong** |

### §3b — regression guards only, no feature work (§2·0)

**4.2-2 · 4.3-12 · 4.3-13 · 4.4-24 · 4.4-25 · 4.4-26 · 4.8-2.** Already built. Write one `H:` case
each so the coverage doc's stale PARTIAL cannot send the next reader to rebuild them.

### §3c — recommend DECLINE: write the decision, not the code

| Row | Why | Where it gets recorded |
|---|---|---|
| **4.4-8** (button half) | Converting a real `<a href target="_blank">` to a `<button>` is a regression (§2e) | `PULL-CANDIDATES.md` |
| **4.4-29** `Go to field →` on the header list | The findings were **relocated into the field** — a link that scrolls to where the reader already is | `.claude/DEFERRED.md`, verdict DELIBERATE |
| **4.9-12** ask in the drawer footer | A third mount of one ask box, in a drawer that already deep-links to the fields that own it | same |
| **4.5-12** `PickList` | **No producer at all** — needs per-item candidacy invented on the insertions payload. Portfolio-only, zero resume impact | `.claude/DEFERRED.md`, verdict ABSENT-BY-SCOPE |
| **4.6-8** `Put back` in the keyword panel | A swap has **no revert route**; only a correction does. Tier 1 work for a panel button | same |
| **4.8-1** header composite | **Data-blocked, no code exists to write.** Two of three inputs are null; one of them by owner decision | `.claude/DEFERRED.md`, cross-ref `D:term-library-off-by-owner-decision` |
| **4.8-20 / 4.8-21** | §4.11 rows in disguise — their `onAsk` target does not exist (§2f) | Moves with §5 |

### §3d — landing per tab

| Tab | Rows that land there | Ships as |
|---|---|---|
| **1 `jd`** | 4.1-5, 4.1-6, 4.1-10, 4.1-12, 4.1-20 (+ guards 4.2-2, 4.3-12, 4.3-13) | **Two branches**, not one: the evidence-count trio (4.1-5/-6/-10) is one question; 4.1-20 is a separate derivation change |
| **2–5 assets** | 4.4-8, 4.4-14, 4.7-7 (+ guards 4.4-24/-25/-26), 4.5-3 | One branch — all three are independent leaf changes |
| **6 `qc`** | 4.8-8, 4.8-11 (+ guard 4.8-2) | One branch, **after** tab 2–5 lands: 4.8-8 seeds the ask box that tab 2–5 owns |
| **7 `send`** | **nothing** | — |

**Do tab 2–5 first.** It holds the two cheapest rows (#1, #3), has no unresolved question in it, and
4.8-8 on tab 6 depends on it.

---

## §4. ACCEPTANCE CRITERIA

Every AC is `Given … when … then …`, binary, and tagged with its row id. **An AC that cannot fail is
not an AC** — several below are deliberately written as *negative* criteria (something that must NOT
render) because that is where this repo's failures have been.

**Tier per the repo's own rule:** everything here is **Tier 2** (routes, UI wiring, mounts) **except
AC 8, 9 and 10**, which touch a count a reader will read as a measurement and are **Tier 1**.

---

### §4a — Tabs 2–5 (Resume · Cover letter · Portfolio · Intro video) — DO THIS FIRST

> One code path (`ArtifactCard` + `AssetBlocks`), four tabs. Verify on **at least two** of the four,
> and one of them must be **Intro video**, which has no merge fields (`PacketBuilder.jsx:290-292`
> exists precisely because of that) and is where a per-field assumption breaks.

**AC 1 · [4.4-14]** — Given an artifact whose gate is `fail` with at least one deterministic failing
row **that maps to a merge field**, when the reader clicks (or presses Enter on) the `N to fix` count
in the card's `GateBadge`, then the app scrolls to that field and paints the focus ring — the same
observable outcome the send step's `Open field →` already produces (`PacketBuilder.jsx:1000`).

**AC 2 · [4.4-14]** — Given an artifact whose only failing items have `mergeField === null` (every
`unchecked` item does, and so does any `check_key` absent from `CHECK_SUBJECT_FIELD`), when the card
renders, then the count is **not** clickable: no `onClick`, no `role="button"`, no pointer cursor.
*A badge that navigates nowhere is the dead UI the standing rule forbids, and `GateBadge` already
degrades correctly when `onClick` is undefined — pass `undefined`, never a no-op handler.*

**AC 3 · [4.4-14]** — Given the same artifact, when its `GateBadge` is rendered in **all three**
mount sites — the artifact card (`PacketBuilder.jsx:184`), the Review & send list (`:959`) and the
ATS tally modal's QC-summary rows (`PostingAnalysis.jsx:845`) — then **each one** deep-links, and
they all resolve to the **same field** for the same artifact, because all three read
`packetFailList()` and none re-derives "the first failing field".

**AC 4 · [4.4-14 / 4.3-13]** — Given the reader clicks a gate count **inside the ATS tally modal**,
when the navigation fires, then the modal is dismissed **before** the step changes — matching the
existing `onGoResume` / `onGoQc` shape (`PacketBuilder.jsx:1029-1030`), so no navigation leaves the
overlay on screen.

**AC 5 · [4.4-14]** — Given a packet where the checks have never run (`railGate(result) ===
'unchecked'`), when the card renders, then the badge still reads `unchecked` and is **not** styled as
clickable, and no code path treats `unchecked` as "nothing to fix".

**AC 6 · [4.7-7]** — Given the reader types an instruction into a field's `List Tweaks` box and
presses **Send**, and `api.aiEditArtifact` resolves, when the box closes, then a confirmation naming
**that merge field** remains visible on the field (e.g. *"Sent — `SUMMARY` is being rewritten."*),
and it survives `onCorrectionsChanged()` reloading the block. *Today the success path runs
`setAsk(''); setAskOpen(false); await onCorrectionsChanged()` and says nothing, while the failure
path renders `askError` in place — the reader cannot tell "applied" from "the button did nothing".*

**AC 7 · [4.7-7]** — Given `api.aiEditArtifact` **rejects**, when the send completes, then the
existing in-place `askError` renders **and the ask box stays open with the reader's text intact**,
and no confirmation from AC 6 appears. *Binary: a confirmation on a failed send is worse than none.*

**AC 8 · [4.4-8]** — Given an artifact with a `docUrl`, when the card renders at any viewport
between 320px and 1440px, then none of `Open Google Doc ↗` / `Open Slides ↗` / `⎘ Copy tracked link`
wraps mid-label. **AND**: `Open Google Doc ↗` / `Open Slides ↗` remain `<a href … target="_blank">`
elements — a middle-click still opens a new tab. *The prototype's `<button>` is declined; see §2e.
Converting them is a REGRESSION and this AC fails if it happens.*

**AC 9 · [4.5-3]** — **BLOCKED ON A DECISION — do not implement before §4e·D1 is answered.** Given
the decision is to follow SPEC §3, when `useWideRef`'s default changes from `700` to `1080`
(`AssetBlocks.jsx:166`), then the 250px provenance margin stacks below 1080px, and the change is
recorded in `PULL-CANDIDATES.md` naming the viewport band (700–1080px) that **loses** the side-by-side
margin it has today. *There is no recorded decision on either number. Changing it silently is how a
"deliberate-looking choice" gets made twice.*

**AC 10 · [4.4-24 / 4.4-25 / 4.4-26] — REGRESSION GUARD, NOT A FEATURE** — Given a packet whose
requirements include at least one must-have, one responsibility and one nice-to-have, when the asset
header's "What this asset answers" panel is expanded, then a `Must-haves answered`, a
`Responsibilities answered` and a `Nice-to-haves answered` stat each render with their own `n of d`
— **and** `Posting lines placed` still renders alongside them, not replaced by their sum. *The total
stays because `groupRequirements` classifies exactly three kinds and a row with a null/unrecognised
kind belongs to none — replacing the total with the parts would silently drop it.*

**AC 11 · [4.4-24/-25/-26]** — Given a posting that uses **no** nice-to-have lines, when the panel
renders, then **no** `Nice-to-haves answered` stat appears — not a `0 of 0`. *Already the behaviour
(`if (rows.length === 0) continue`); this AC exists so a refactor cannot lose it.*

**AC 12 · [4.4-29] — A DECISION, NOT A BUILD** — Given the asset-header findings were deliberately
relocated into each field's margin (4.4-28 / 4.5-23), when this row is closed, then it is recorded
in `.claude/DEFERRED.md` as **DELIBERATE** with the relocation named, **and no second enumeration of
the findings is added to the asset header**. *Building the prototype's list would create the divergent
second enumeration that 4.2-4 was guarded against rather than rebuilt.*

---

### §4b — Tab 1 (Posting analysis) · the evidence-count trio · **TIER 1**

> **Tier 1 because these three render a number a reader will read as a measurement of their own
> profile.** §2a is mandatory reading before the first line of code.

**AC 13 · [4.1-10] — THE DECIDING CRITERION** — Given a requirement group containing at least one
row in each of `verified`, `none` and one `warn` state (`stale` / `misresolved` / `source_missing` /
`unverified`), when the group's sub-header renders `n/m evidenced`, then **`n` counts ONLY rows whose
`evidencePresentation(row).provable` is true** (i.e. `evidenceState === 'verified'`), and:
- `n` does **NOT** equal `summarizeKindSource(rows).evidenced` — that number counts *"the posting said
  so"*, not *"your profile proves it"* (§2a #2);
- `n` does **NOT** equal the API's `evidenced` field — that counts a **stored** quote and includes
  rows that no longer resolve (§2a #1).

*This AC is written to FAIL on the two easiest implementations. That is its purpose.*

**AC 14 · [4.1-10]** — Given a group in which **every** row's `evidenceState` is `unknown` (an older
payload carrying no verdict), when the sub-header renders, then it shows **no ratio at all** — not
`0/m`. *`EVIDENCE_TONE.unknown` is `panel`, the shell's "no signal" grey, precisely because an
unchecked row must not be painted as either good or bad news. `0 of 12 evidenced` over unchecked rows
is a measurement that was never taken — this repo's named failure mode.*

**AC 15 · [4.1-10]** — Given the sub-header renders `n/m evidenced` and the reader expands the rows
beneath it, when they count the rows showing the `evidenced — show the line` disclosure, then that
count **equals `n` exactly**. *The disclosure renders only for `verified` (4.1-15). If the header and
the rows disagree, one of them is reading a different number — the cross-surface reconciliation rule.*

**AC 16 · [4.1-10]** — Given the ratio is derived, when `grep -rn "evidenced" app/src/` is run, then
there is **exactly one** producer of the rendered number, and it is the same
`evidencePresentation()` the rows already consume — no second aggregation, and
`summarizeKindSource().evidenced` is either **renamed** to say what it counts (e.g. `postingSourced`)
or left unrendered. *Two fields named `evidenced` in one file, meaning different things, is the
landmine; leaving it armed after touching this row is not acceptable.*

**AC 17 · [4.1-5]** — Given the `Responsibilities` and `Requirements` tabs, when the tab strip
renders, then each shows `n/m` where `m` is the lines extracted and `n` is the same `provable` count
AC 13 defines, **and the `Keywords` tab shows a bare total with no ratio**. *The prototype's third
tab is `ATS keywords`, scored off the term library. This app's third tab is model-suggested keywords,
which `requirements.ts` makes **"never scoreable"** — a ratio there would be the exact "made a
suggestion look like a measurement" failure `postingAnalysis.js:233-235` records.*

**AC 18 · [4.1-6] — THE COLOUR RULE, REDEFINED** — Given a tab whose `n/m` renders, when the count is
toned, then the tone comes from the **existing `EVIDENCE_TONE` vocabulary** and has **three** states,
not two:
- **green** only when `n === m` **and** no row in the group is in a `warn` state;
- **red** only when at least one row is `none` — *the only state that reports a real gap in the
  reader's profile*;
- **warn** whenever rows are `stale` / `misresolved` / `source_missing` / `unverified` and none is
  `none`.

**AC 19 · [4.1-6]** — Given a group containing one `misresolved` row and no `none` rows, when the tab
count renders, then it is **not red**. *This is the whole reason the prototype's `t.n === t.d ? green
: red` cannot be ported (§2b): red here tells the owner their CV does not support a claim it does
support. `postingAnalysis.js:296-315` exists because that exact bug was written once already.*

**AC 20 · [4.1-6]** — Given the `Keywords` tab, when it renders, then its count carries **no tone at
all** — it inherits the current `opacity: .75` treatment. *Two of three tabs coloured and one not is
correct here and must be visible as deliberate; add the one-line reason beside it.*

**AC 21 · [4.1-6 / 4.1-5]** — Given the tone or the ratio is added, when the JD step is rendered for a
packet whose checks have **never** run, then the tab strip renders exactly as it does today — total
only, no tone, no ratio — and no request is made for QC data the JD step does not already load.
*`PostingAnalysisCard` is currently passed no `qcEntries`; `qcSummary` and `qcEntries` are in scope at
its mount (`PacketBuilder.jsx:431, 449`), so threading them is one line — but doing so must not make
the JD step's rendering depend on a payload that may be absent.*

---

### §4c — Tab 1 · `Where it is used →` · **Tier 2, separate branch**

**AC 22 · [4.1-20]** — Given a requirement whose evidence row is expanded and for which
`swapsForRequirement(swaps, requirementId)` returns at least one swap, when the expanded panel
renders, then a `Where it is used →` control appears; and when it is activated, the app navigates to
the artifact and merge field that swap belongs to, using the **existing** `goToField(artifactId,
section)` (`PacketBuilder.jsx:742`) — **no second navigator is introduced**.

**AC 23 · [4.1-20]** — Given a requirement for which `swapsForRequirement` returns **nothing**, when
the panel renders, then **no** `Where it is used →` control appears — not a disabled one, not one
that navigates to the resume step generically. *No dead UI.*

**AC 24 · [4.1-20] — THE ROW'S ACTUAL BLOCKER** — Given the reader is on the **JD step** and no asset
card has rendered in this session, when the link resolves its target, then it resolves correctly —
because the `list → artifact` map is derived from **the packet's own `artifacts`**, not from
`listOwners` render-time registration (`PacketBuilder.jsx:418`, populated by `onListsRendered` at
`:915`, which on the JD step is `{}`). *This is the entire reason the row did not ship. An
implementation that reads `listOwners` will appear to work on the resume step and silently render
nothing on the JD step — the one step SPEC asks for it.*

**AC 25 · [4.1-20] — BLAST RADIUS** — Given the `list → artifact` derivation is changed, when
`grep -rn "listOwners" app/src/` is run, then **every** consumer still reconciles:
`AssetBlocks.jsx:367` (`ListBody`), `:417` (`BlockBody`), `:569` (`sharedSourceNote`), `:1158`, and
the two `PacketBuilder.jsx` mounts (`:200`, `:915`). Specifically: the "this list is shared with
another asset" note (`sharedSourceNote`) shows the **same** owners before and after. *`.claude/DEFERRED.md:199`
prescribes the derivation change but names none of these consumers.*

**AC 26 · [4.1-20]** — Given the change lands, when the JD step is loaded for a packet with **zero**
built artifacts, then the evidence panel renders exactly as today and throws nothing — the map is
empty and the link is simply absent (AC 23).

---

### §4d — Tab 6 (QC & evidence) · after tabs 2–5 land

**AC 27 · [4.8-8]** — Given a `Corrected for you` row in the on-page `ChangeLog` (`QcRail.jsx`),
when the reader activates a `Change it` control on it, then the app navigates to that correction's
field and **seeds that field's existing `List Tweaks` box** with a sentence naming the correction —
and **writes nothing at activation**. *This is the shape `keywordActions()` (4.6-10/11) already
proved and the verifier already CONFIRMED: the seeded box is the surface, `api.aiEditArtifact` on
Send is the only write.*

**AC 28 · [4.8-8]** — Given the seeded sentence, when it is read, then it states **only** what the
system can actually do — it does **not** promise a coverage effect or an undo. *`H:keyword-drop-offers-nothing-it-cannot-do`
exists because the equivalent copy for the drop hatch was drafted with a consequence clause the
system does not record. A `Change it` that implies the correction will be reverted is the same defect:
the revert path is `Undo` (`POST /app/correction/{id}/revert`), and `Change it` is not it.*

**AC 29 · [4.8-8]** — Given a correction whose field has already been edited since the correction was
written (the case `revertOne` REFUSES — `api.js:201`), when `Change it` is offered, then it still
works, because a rewrite is not a revert; **and `Undo` on the same row still reports its own refusal
unchanged**. *Binary: the two controls must not be wired to one another.*

**AC 30 · [4.8-11] — THE PART THE COVERAGE DOC GETS WRONG** — Given a packet with at least one `soft`
("Your call") finding, when the on-page `Decisions` list renders, then either (a) the `soft` rows
appear **in their own labelled group, counted separately** from `toFix` and `toReview`, or (b) they
are deliberately excluded and the exclusion is stated on screen. **What must NOT happen: `soft` rows
folded into `railDecisions.rows`.** *`railDecisions.rows` is asserted to reconcile with the counts
strip, and `soft` is in **neither** `toFix` **nor** `toReview` — widening `NEEDS_ATTENTION`
(`qcRail.js`) breaks that reconciliation by construction. This is not a one-line filter change, and
the coverage doc's "no page-level attention list" framing is stale: `<Decisions>` has been mounted at
`QcRail.jsx:876` since `8d721a0`.*

**AC 31 · [4.8-11]** — Given the ordering across the page, when the QC step is read top to bottom,
then `fixed` (the `ChangeLog`) precedes `fail`/`warn` (the `Decisions` list) or the deviation from
SPEC §5's `fail → open → warn → fixed → soft` is recorded — **and `open` is absent**, because
`assetGate.js:78-87` refuses to mint that severity from state the app does not have (the same
decision as 4.4-33 and 4.8-13).

**AC 32 · [4.8-2] — REGRESSION GUARD** — Given an artifact whose checks have run, when the QC rail's
header renders, then a `Must-haves evidenced` bar shows `must_have_coverage`; and given a part with
no source, then that part reads the server's own prose for why, **never `0`**.

**AC 33 · [4.8-1] — A DECISION, NOT A BUILD** — Given the composite is null because
`keyword_coverage` and `seniority_alignment` are null, when this row is closed, then
`railHeadline()`'s honest sentence still renders verbatim and a guard asserts that **no composite is
computed from fewer than three parts**. *No feature code. The number appears on its own the day the
term library publishes and the reviewer grades; `D:term-library-off-by-owner-decision` is the
dependency, and fabricating a partial composite is banned outright.*

**AC 34 · [4.8-20 / 4.8-21] — SCOPE, NOT BUILD** — Given the prototype's `Undo this` and `Ask why`
both call `onAsk(...)` — the **assistant-panel seed** (`docs/qc-evidence/qc/evidence.jsx:232-234`) —
when these rows are dispositioned, then they are recorded as **§4.11 substitutions, not §4.8
features**, and:
- **no per-swap undo mutation is built** (there is no swap-revert route; only
  `app/correction/{correctionId}/revert` exists), and
- **no `Ask why` is built while the `Why` column already prints the answer** on every row
  (`verbatim_quote` → *the posting says "…"*, else the driver sentence or `rationale`).

*If the owner later wants them, the correct shape is the proven one — seed the ask box — and they
should be counted under §4.11, not as §4.8 coverage. `PROTOTYPE-COVERAGE.md` §14's "A one-liner" for
4.8-21 is wrong: the control it describes has no target in this app.*

---

### §4e — DECISIONS THAT GATE THE ABOVE

These are **not** ACs. They are the questions whose answers change what gets built, and they are
listed separately so no one starts work on a premise nobody has confirmed.

| # | Question | Why it must be answered first | Default if unanswered |
|---|---|---|---|
| **D1** | **The margin breakpoint: 700 or 1080?** SPEC §3 says 1080; `AssetBlocks.jsx:166` says 700; **there is no recorded decision either way.** | Answering it settles **both** AC 9 (4.5-3) and the 4.1-12 right column together (§2c). Raising to 1080 stacks the provenance margin on every 700–1080px viewport — visible loss for anyone on a 900px window. | **Keep 700**, record it in `PULL-CANDIDATES.md` as a deliberate divergence from SPEC §3, and close 4.1-12 as "same decision". Reversible, non-destructive. |
| **D2** | **4.1-12: should the requirement chip move to a right column at all?** | This app's row carries a blockquote + char offsets + a paraphrase branch + a disclosure that the prototype's row does not (§2c). | **Do not move it.** Record as DELIBERATE. Revisit only if D1 answers 1080. |
| **D3** | **§4.11, the assistant panel** | Six ABSENT rows plus 4.7-8, 4.8-20 and 4.8-21 all hang off it. | **See §5 — this one is genuinely blocked and must not be defaulted.** |

---

## §5. §4.11 — THE ASSISTANT · an owner decision, and NO build-ACs are written for it

> **CORRECTION TO THIS AC PASS'S OWN BRIEF.** The brief states that `PROTOTYPE-COVERAGE.md` §12
> records the assistant as *"a deliberate architectural replacement, evidenced only by a code
> comment."* **That was true until 2026-08-25 and is no longer true.** §12 now carries a block headed
> **"ASKED AND ANSWERED, 2026-08-25 — and the answer was neither (a) nor (b)"**, and the decision is
> tracked as **`D:assistant-panel-owner-trialling`** (`.claude/DEFERRED.md:195`). The owner has
> already been asked. Re-asking as though they had not is the third failure mode in §1c of the
> coverage doc — *a row shown as open that is already recorded* — and this pass would have committed
> it had it trusted the brief over `.claude/DEFERRED.md`.

### §5a — what the owner actually said

> *"delay the panel work. I will have to use the systme for a couple of days to see if we need it. i
> may not need it for the packet creation flow but for assistance at some point while working
> throught the platform itself is possible."* — owner, 2026-08-25

**That is not a yes and it is not a no. It is a "not yet, and possibly somewhere else."**

### §5b — the decision is now DUE

The owner asked for *"a couple of days."* That was **2026-08-25**. Today is **2026-08-27**. The
trial window has elapsed; `D:assistant-panel-owner-trialling` says *"re-ask after the owner has used
the system for a few days"* and names the owner as the decider. **This is the single highest-value
action in this document** — it disposes of 6 ABSENT rows, plus 4.7-8, plus the correct reading of
4.8-20 and 4.8-21, and it moves headline coverage by ~4 points on its own.

### §5c — precisely what the owner must decide

**Not** "build the panel, yes or no." The owner's own answer already split the question in two, and
**they are not the same work**:

| Option | What it is | Size | What it costs if chosen wrongly |
|---|---|---|---|
| **A · Packet-step assistant** | The SPEC §4.11 panel as specced: docked right column ≥1440px, floating below, scope selector, quick actions, replies naming merge fields, Keep/Revert/Re-run QC | **8 rows** (4.11-1→8) + 4.7-8. A new surface, new ACs, new verification | Builds a conversational layer over an edit path that already works per field |
| **B · Platform-wide assistant** | Assistance *"while working through the platform itself"* — the owner's own framing | **A surface SPEC does not describe.** Needs its own AC pass from scratch | Out of scope for the packet module entirely; §4.11's rows would then be closed as NOT-APPLICABLE, not built |
| **C · Ratify the substitution** | Declare the per-field seeded ask box the app's answer to §4.11 | **0 rows of code.** 8 rows move ABSENT/PARTIAL → DELIBERATE | Flatters the coverage number by ~4 points on a decision the owner has not made — which is why the coverage doc explicitly refuses to do it unilaterally |
| **D · Keep deferring** | Extend the trial | 0 | The rows stay in the denominator, honestly, as they are today |

### §5d — the evidence on each side, so the owner can decide from facts

**FOR ratifying the substitution (option C):**

1. **The substitution is real, working, and architecturally deliberate — not an omission.**
   `AssetBlocks.jsx:541-550`: *"Here it opens the field's OWN ask box with that sentence already
   typed - the same box, the same `api.aiEditArtifact(..., { section })` route. Not a second edit
   path."* There is **ONE seed-then-open primitive** (`seedAskReword`) with two callers today,
   guarded by `H:wording-ask-reuses-the-field-edit-path`.
2. **The prototype's five quick actions are all just sentence templates.** `qc/assist.jsx:5-9`:
   `'Put back the original wording in '`, `'Undo the swap of '`, `'Shorten this to fit its word rule: '`,
   `'Why did you change '`, `'This keyword does not apply to me: '`. Every one is a seeded string —
   which is exactly what the app's per-field seed already does. **Three of the five already exist**
   as scoped in-place controls (4.11-5): undo (`CorrectionRow`), reword/say-why
   (`seedAskReword`), keyword-is-wrong (the `not in this text` chip).
3. **A scoped control is more honest than a conversational one here.** The field box states *"This
   rewrites `SUMMARY` only"*; a panel with a `This packet / This asset / My profile` scope selector
   makes a promise about blast radius that `artifactAiEdit` (which takes one `section`) does not
   keep.
4. **4.11-6 cannot be built honestly on today's data.** *"Replies list the exact merge fields they
   would touch"* requires knowing, before the edit, which fields a request will change.
   `api.aiEditArtifact` takes the section as an **input**, not a prediction — the app cannot list what
   it "would touch" without inventing it.

**AGAINST ratifying (i.e. for A or B):**

1. **Nobody has decided it.** The `AssetBlocks.jsx` comment is a claim about the code, not a decision
   by the owner — and `accuracy-log.md`'s **first** entry is exactly the failure of reading a code
   comment as a decision. `.claude/actions.md` records no sign-off.
2. **The owner explicitly left the door open**, and pointed it at the *platform*, not the packet flow.
   Closing §4.11 as "replaced" would answer a question they said they had not answered.
3. **The per-field substitution has no cross-field surface.** Two of the prototype's five quick
   actions — **`Put back an original`** and **`Shorten to fit`** — have **no control anywhere**
   (4.11-5). And two whole capabilities have nowhere to live: **4.11-7** (Keep / Revert / Re-run QC on
   a reply — the pieces exist, `Undo` and `runChecks`, *"there is no reply to attach them to"*) and
   **4.11-8** (the caveat that a change will be reverted by the next remediation run). **That last one
   is a real user-facing gap regardless of the panel** — nothing today warns the reader that a manual
   edit may be overwritten by the next loop.
4. **Ratifying moves the headline ~4 points** with no code written. That is precisely the shape of a
   flattered number, and the coverage doc refuses to do it on its own authority for that reason.

### §5e — what to do with §4.11 in the meantime

- **Do not build 4.11-1/-2/-3/-4/-6/-8.** No ACs are written for them here, deliberately.
- **Do not build 4.7-8** (`Forwards to the assistant`). It has no target; it moves with this decision
  and only with it.
- **Do not build 4.8-20 / 4.8-21 as §4.8 features** — §2f proves they are §4.11 rows whose `onAsk`
  target does not exist.
- **Do not reclassify the eight rows as DELIBERATE** to improve the coverage percentage. That is
  option C being taken by an implementer rather than by the owner.
- **One item is worth raising independently of the panel: 4.11-8.** *"A change will be reverted by
  the next run"* is a truth about this system's remediation loop that the reader is never told, and
  it does not need a conversational panel to say. If the owner defers again, ask specifically about
  this one.

---

## §6. SUMMARY — the 34 rows, dispositioned

| Disposition | Count | Rows |
|---|---:|---|
| **ALREADY BUILT** — guard, don't build | **7** | 4.2-2, 4.3-12, 4.3-13, 4.4-24, 4.4-25, 4.4-26, 4.8-2 |
| **BUILD — cheap, no open question** | **3** | 4.4-14 *(1 handler × 3 mounts)*, 4.7-7 *(~6 lines)*, 4.4-8 *(1 CSS property)* |
| **BUILD — needs the number decided first (Tier 1)** | **3** | 4.1-10, 4.1-5, 4.1-6 |
| **BUILD — real derivation change** | **3** | 4.1-20, 4.8-8, 4.8-11 |
| **BLOCKED ON DECISION D1/D2** | **2** | 4.5-3, 4.1-12 |
| **RECOMMEND DECLINE — record the decision** | **6** | 4.4-29, 4.9-12, 4.5-12, 4.6-8, 4.8-1, *(4.4-8 button half)* |
| **§4.11 — OWNER DECISION, no build-ACs** | **9** | 4.11-1/-2/-3/-4/-5/-6/-7/-8, 4.7-8, and the correct reading of 4.8-20/4.8-21 |

**The honest read:** of the 34 rows the brief lists, **7 are already built**, **6 should be declined
and recorded**, **9 wait on the owner**, and **9 are real work — of which 3 are effectively
one-liners.** The packet module is closer to done than the row count suggests, and the two largest
risks are not effort: they are **shipping the wrong "evidenced" number** (§2a) and **rebuilding
something already built because a two-day-old measurement said PARTIAL** (§2·0).

**Start with tabs 2–5, rows 4.4-14 → 4.7-7 → 4.4-8.** They are cheap, independent, carry no open
question, and 4.8-8 on tab 6 depends on the ask box they touch.

*AC pass complete. Nothing under `app/src` or `api/src` was modified; this file is the only one
written.*

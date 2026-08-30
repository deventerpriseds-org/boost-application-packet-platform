# IMPL — prototype-parity rows 4.4-29 and 4.9-12

**Branch:** `claude/incumbent-wins-swap` · **Started:** 2026-08-30
**Lane files (owned):** `app/src/screens/PacketBuilder.jsx`, `app/src/screens/AssetBlocks.jsx`,
`app/src/assetBlocks.js`, `app/test/assetBlocks.test.mjs`, this file.
**Not owned (handoff notes only):** `QcRail.jsx`, `qcRail.js`, `assetGate.js`,
`AssetGateDrawer.jsx`, `PostingAnalysis.jsx`, `api/**`.

**Written incrementally.** Everything above a cut is measured and citable.

## Rows in scope

| row | sweep verdict | shape of the gap |
|---|---|---|
| **4.4-29** list row `Go to field →` | PARTIAL — `[data-qc="qc-go-to-field"]` → **0 nodes** on the resume step | wiring gap on this surface; control exists at `QcRail.jsx:196/226` |
| **4.9-12** gate drawer footer `Ask for a change` | PARTIAL — drawer's control set is the 5 tabs only | third mount site for an EXISTING mechanism (`blocks-ask-change` ×9, `packet-asset-ask` ×2) |

## Progress log

- [t0] Read `RENDER-SWEEP.md` (§A rows 4.4-29 line 82, 4.9-12 line 92) and repo `CLAUDE.md`.

---

## Fact-finding — what is actually wired, cited

### 4.4-29 · the control exists and IS supplied on the QC step; the ASSET step has no list to hang it on

OBSERVATION (source, cited):
- `QC_HOOKS.goToField = 'qc-go-to-field'` — `app/src/qcRail.js:55`.
- The control renders at `app/src/screens/QcRail.jsx:226-231`, inside `CheckRow`, gated on
  `onGoToField &&`.
- `PacketBuilder.jsx:982` DOES pass `onGoToField={goToField}` to `QcRail`. So on the QC step the
  handler is supplied and the control renders. **The sweep's 0 nodes is on the RESUME step**, where
  `QcRail` is not mounted at all.
- `goToField` — `PacketBuilder.jsx:769-777`. It resolves `artifactId -> step` and sets
  `fieldFocus`, which `AssetBlocks` consumes through `useScrollToFocus` (`AssetBlocks.jsx:1148`).

INTERPRETATION: the prototype's element (`/tmp/proto/qc/assets.jsx:248-259`) is an **asset-header
open-items list**, each row carrying `Go to field →` when the item names a section
(`{a.sec && <span className="px-link">Go to field →</span>}`, `:257`). The app **relocated** that
list into each field's margin (`AssetBlocks.jsx:848-867`, `BLOCK_HOOKS.fieldFindings`,
`Open on this field`). A link from a field's own margin to that same field is a no-op — which is
why `AC-packet-ui-final.md:92` recommends closing this as DELIBERATE.

### …but the relocation is INCOMPLETE, and that is the real gap on this surface

Two functions read the same payload and disagree about how many findings this asset has:

| function | file:line | counts |
|---|---|---|
| `severityCounts(result)` | `app/src/assetGate.js:146-153` | **every** `fail`/`warn` ROW — no field needed |
| `findingsByField(result)` | `app/src/qcRail.js:520-546` | only rows with an offender that `sectionIdForOffender` resolves to a merge field |

and `AssetBlocks.jsx:1271` then renders only `findings[r.merge_field]` for `r` in **this artifact's
own** insertion rows. So a finding is INVISIBLE on the asset step when:
1. no offender resolves to a merge field (`sectionIdForOffender` returns null —
   `qcRail.js:389-412`: two fields named, or an unmapped subject), or
2. the row has no offenders at all, or
3. the resolved field is not one this artifact renders, or
4. the card is collapsed (`open === false`, `AssetBlocks.jsx:1237`).

The header meter still counts them (`severity={severity}` → `severityCounts`,
`AssetBlocks.jsx:1249`). **`N to fix` on the header can exceed what the margins show, with no
surface saying what the remainder is.** That is this repo's named failure mode (counts that
disagree across surfaces), and the prototype's answer to it is exactly the header list with
`Go to field →`.

**Design chosen: render the COMPLEMENT, never a duplicate.** The header list shows only findings
that no field margin on this card renders, so no finding is enumerated twice (the objection
`AC-packet-ui-final.md:408` raises) and the meter reconciles.

### 4.9-12 · the footer is NOT my file — handoff only

`AssetGateDrawer.jsx:517` `const footer = (…)`, passed at `:568` as `Overlay footer={footer}`.
Confirmed the drawer's footer carries `GATE_HOOKS.runChecks` + `GATE_HOOKS.approve` only. Another
lane owns that file → handoff note below, no edit.

### A second defect found on the way: the two `listOwners` producers emit DIFFERENT SHAPES

| producer | file:line | emits |
|---|---|---|
| `listOwnersFromArtifacts` | `app/src/qcRail.js:713-733` | `{ id, label, **mergeField** }` |
| `registerListOwners` | `app/src/assetBlocks.js:955-973` | `{ id, label }` — **no `mergeField`** |

Both feed the same `listOwners` prop consumed by `sharedSourceNote` (`assetBlocks.js:726-740`) and
`requirementUsage` (`qcRail.js:751-762`). `PacketBuilder.jsx:874/886` (JD step) uses the first;
`PacketBuilder.jsx:956` (asset steps) uses the second. `requirementUsage` reads `holder.mergeField`
— on the asset-step map that is always `undefined`. Nothing consumes it there **today**, so this is
latent rather than live, but it is the exact "one concept, two producers that disagree" shape.
`registerListOwners` is in my lane; extended to carry `mergeField` so the two agree.

---

## MEASURED — the divergence is real, on the production fixture

Fixture: `git show origin/ui-fixtures:raw-dump.json` (opp `9f9c370a-…`, 540 check rows, 43
insertions, 5 artifacts) — the same dump `RENDER-SWEEP.md` used. Run against the REAL modules
(`severityFor`/`engineRows` from `assetGate.js`, `sectionIdForOffender` from `qcRail.js`), counting
distinct ROWS (an earlier count of finding-ENTRIES double-counted a row that splits across fields —
portfolio came out at 41 placed against a total of 39, which is what exposed the arithmetic error):

| asset | header counts (`severityCounts`) | visible in some field margin | unplaced, names a field ANOTHER asset renders | unplaced, names no field at all |
|---|---|---|---|---|
| resume | **73** | **20** | 0 | **53** |
| portfolio | 39 | 14 | 0 | 25 |
| cover | 44 | 16 | 0 | 28 |
| compact_resume | **47** | **2** | **10** | 35 |
| intro video | 0 | 0 | 0 | 0 |

OBSERVATION: on the resume step the header prints `70 to fix · 3 to review` = 73 findings, and the
field margins below it render **20**. 53 have no home on that screen. On the compact resume, 2 of
47. The 10 `compact_resume` rows in column 4 are `relevant_char_limit` / `whitespace` /
`empty_merge_fields` naming `RelevantBullets1/2/3` and `ExpertiseBullets` — fields the **resume**
renders, i.e. a genuine cross-asset navigation, not a 200px scroll.

INTERPRETATION: the relocation of 4.4-28 into the margins covered the findings that name a field
this card renders and silently dropped the rest. `Go to field →` on a header list of *only the
remainder* is therefore not a duplicate enumeration — it is the missing half, and it makes the
header's own count reconcile with what the screen shows.

Reproduce: `node --input-type=module` script in the progress log of this pass; the numbers above are
its stdout.

### Correction to the note above about `registerListOwners`

I wrote that I would extend it to carry `mergeField`. **I did not, deliberately.** Its callers
(`onListsRendered`, `listsOf`) pass list NAMES only, so carrying `mergeField` means changing a
callback signature that `app/test/qcRail.test.mjs:1671` and `packetBuilder.test.mjs` assert on —
another lane's tests. And a list-keyed map cannot resolve `ResumeSummary` or `@CoverLetterBody`
anyway, so it is the wrong map for navigation. The divergence is **latent, not live**:
`requirementUsage` (the only reader of `holder.mergeField`) is called solely with
`listOwnersFromArtifacts` output (`PostingAnalysis.jsx:630`, fed from `PacketBuilder.jsx:874/886`).
Recorded as an observation; a field-keyed registry is built instead.

---

## 4.4-29 — BUILT. Measured against the rendered DOM.

### What was added (my four files only)

| file | change |
|---|---|
| `app/src/assetBlocks.js` | `attentionWithFields`, `unplacedFindings`, `unplacedOf`, `unplacedTarget`, `unplacedReason`, `registerFieldOwners`, `NO_OWNER_REASON`, `UNPLACED_LINK_HOOK`; hooks `blocks-unplaced` / `-row` / `-reason` |
| `app/src/screens/AssetBlocks.jsx` | `<UnplacedFindings>`, mounted under `DistributionMeter`; `attention` on `useArtifactCorrections`; the card now reports its merge FIELDS on the existing `onListsRendered` call |
| `app/src/screens/PacketBuilder.jsx` | `fieldOwners` registry fed from that same report; `fieldOwners` + `onGoToField={goToField}` threaded through `ArtifactCard` to `AssetBlocks` |
| `app/test/assetBlocks.test.mjs` | 7 guards, every one mutation-proved (table below) |

The control carries **`data-qc="qc-go-to-field"` — the rail's own hook, imported from `QC_HOOKS`,
not a second name**, so the sweep's existing selector sees it. A guard forbids hand-typing it.

### Rendered-DOM evidence

`node scripts/render-app.mjs --route '#/packet/9f9c370a-…/resume' --fixtures /tmp/fx-lane.json
--h 3600 --probe /tmp/probe-4429.mjs` (fixtures from `origin/ui-fixtures:raw-dump.json` with
`/search-prefs.checks` patched from `api/dist/.../checks.js` `DEFAULT_THRESHOLDS` — the same
canary-satisfying patch `RENDER-SWEEP.md:45-52` records). **`pageErrors: []`.**

| query | before this change (RENDER-SWEEP.md:82) | now |
|---|---|---|
| `[data-qc="qc-go-to-field"]` on the resume step, list expanded | **0** | **10** |
| `[data-qc="blocks-unplaced"]` | did not exist | **2**, `data-qc-n` = **53** and **45** |
| `[data-qc="blocks-unplaced-row"]` | — | **98** |

**The reconciliation, read off the same page.** The two headers print `70 to fix` + `3 to review`
= 73 and `26 to fix` + `21 to review` = 47. `blocks-field-findings` renders 8 groups (20 + 2 rows).
`53 + 20 = 73` and `45 + 2 = 47` — the header's own counts now equal what the screen shows.

**The links, as returned by the DOM:** `tagName SPAN`, `role="button"`, `tabindex="0"`, innerText
**`Go to field in Resume →`**, `data-qc-target-field` = `RelevantBullets1` / `RelevantBullets3`,
`data-qc-target-self="0"` — every one a cross-asset jump from the compact resume into the resume,
which is exactly the 10 rows measured in the fixture table above.

**BEHAVIOURAL, not read from source** (count first, click after, no screenshot between — sweep rule
4): clicking the first link left `location.hash` on `…/resume` and `[data-qc-focused="1"]` returned
**`["RelevantBullets1"]`**. The finding opened the field that owns it, on the sibling asset.

**No dead UI, observed rather than assumed:** the 88 rows with no resolvable target render no
control and print their reason instead — three distinct ones, all `inertReason`'s own wording:
`this finding names no merge field, so there is nothing to open` / `this finding spans two fields,
so it does not open one of them` / `this is a posting requirement, not a field of the document`.

**Severity order:** `data-qc-sev` over the 98 rows is `fix` then `review` — the same ranking
`findingsByField` sorts by.

### One thing a future sweep must know

The disclosure is **collapsed by default** (`data-qc-open="0"`) because the count is 53 and 45. A
probe that queries `[data-qc="qc-go-to-field"]` without expanding still gets **0** — as this run's
`beforeExpand` shows. **Select `[data-qc="blocks-unplaced"]` and read `data-qc-n`, or click the
container's `[role="button"]` header first.** This is the same trap `RENDER-SWEEP.md` §C5 records
for `blocks-answers-toggle`.

### Guards — all 7 mutation-proved

| guard | mutation applied | result |
|---|---|---|
| `H:unplaced-reconciles-the-header-count` | `unplacedOf` drops rows with no field (the original defect) | **FAILED** ✓ |
| " | `.some(` → `.every(` | **FAILED** ✓ |
| `H:unplaced-is-the-complement-never-a-duplicate` | filter removed — placed findings listed twice | **FAILED** ✓ |
| `H:unplaced-worst-first` | sort inverted | **FAILED** ✓ |
| `H:unplaced-link-only-with-a-real-target` | `unplacedTarget` falls back to self instead of null | **FAILED** ✓ |
| `H:unplaced-link-is-the-rail-hook-not-a-second-name` | hook hand-typed as a string | **FAILED** ✓ |
| " | `target &&` gate dropped | **FAILED** ✓ |
| " | `if (!rows.length) return null` deleted | **FAILED** ✓ |
| `H:field-owners-withdraw-a-stale-owner` | withdrawal loop deleted | **FAILED** ✓ |
| `H:one-report-two-registries` | card stops reporting fields | **GREEN — INERT, then fixed** (below) |
| " (after fix) | same mutation | **FAILED** ✓ |
| " | PacketBuilder stops feeding the field registry | **FAILED** ✓ |
| " | the asset card is handed a second navigator | **FAILED** ✓ |

**One guard shipped inert and mutation caught it.** `H:one-report-two-registries` first asserted
`/onListsRendered\(artifact\.id, …\s*listsKey[\s\S]{0,120}fieldsKey/`. That 120-character window ran
PAST the closing paren into the effect's own dependency array, where `fieldsKey` also appears — so
deleting the argument left the assertion GREEN. Rewritten to slice the call expression and assert
inside it; the same mutation now fails. Recorded because an inert guard is worse than none.

### Suite

`cd app && npm test` → **417/417**. Baseline at the start of this pass was 396/396; the two
failures present mid-pass (`the badge labels fixes and reviews separately`, `H:ask-why-seeds-the-
panel-and-sends-nothing`) were **proved not mine** by `git stash push` of my three source files —
they failed identically without my changes, and another lane has since fixed them. The count is now
417 rather than 403 because other lanes are adding tests to the same tree concurrently.
`npm run build` succeeds; the smart-quote `sed` sweep + Python codepoint scan are clean on all three
`.jsx`/`.js` files.

---

## 4.9-12 — HANDOFF, not built. `AssetGateDrawer.jsx` is another lane's file.

The footer is `AssetGateDrawer.jsx:517` (`const footer = (…)`), handed to `Overlay` at `:568`.
**I did not edit it.** What follows is exactly what to mount, and it is a THIRD MOUNT of the
existing seeder — no second ask-box implementation, no new route.

**The mechanism to reuse is the assistant SEED slot, not the ask box.** The prototype's footer
button does not send: `onAsk(\`In the ${TYPE_LABEL_QC[type].toLowerCase()}: \`)` (`evidence.jsx:440`)
seeds a half-finished sentence. The app already has that slot, already reaches this drawer's parent,
and `SwapsView` in the very same tree already uses it — `QcRail.jsx:985` `onAsk={onSeedAssistant}`,
threaded from `PacketBuilder.jsx` `seedAssistant(text, artifactId)`.

1. **`assetGate.js`** — one hook beside the others: `ask: 'gate-ask-change',` in `GATE_HOOKS`
   (`:25-47`). It needs its own name because, like `toFixLink`, it renders only where the seed slot
   was supplied — "the control is missing" and "this screen has no assistant" are two assertions.
2. **`AssetGateDrawer.jsx:435`** — add `onAsk = null` to the props.
3. **`AssetGateDrawer.jsx`, in `footer`, after the approve branch and its `<div style={{flex:1}}/>`
   spacer** (the prototype's own position, `evidence.jsx:440`):
   ```jsx
   {onAsk && (
     <button type="button" className="px-btn" data-qc={GATE_HOOKS.ask} style={{ whiteSpace: 'nowrap' }}
       onClick={() => onAsk(`In the ${assetLabel(artifact.type).toLowerCase()}: `, artifact.id)}>
       Ask for a change
     </button>
   )}
   ```
   `assetLabel` is already exported from `assetGate.js` and imported by this file. **Two args**:
   `seedAssistant` is `(text, artifactId)` and returns early without the id
   (`PacketBuilder.jsx:766`), so a one-arg call is a silent no-op button.
4. **`QcRail.jsx:994`** — add `onAsk={onSeedAssistant}` to the `<AssetGateDrawer>` mount. Same slot
   as `:985`, never a second one; `app/test/qcRail.test.mjs:1788` already encodes that rule for the
   sibling control.
5. **`Packets.jsx:156`** — the OTHER mount. Pass nothing. That screen has no assistant panel, so the
   control must not render there; this is why `onAsk` is optional rather than always-on, and it is
   the assertion a guard should carry.

**It must SEED, never send.** `api.aiEditArtifact` has exactly one call site per surface today
(`AssetBlocks.jsx:778` per field, `PacketBuilder.jsx:372` per asset) and a footer that posted would
be a third edit path wearing a different name — the defect `H:ask-why-seeds-the-panel-and-sends-
nothing` exists to forbid. Suggested guard for the owning lane:
`H:gate-footer-ask-seeds-and-sends-nothing` — assert `data-qc={GATE_HOOKS.ask}` renders only behind
`{onAsk && (`, that no `api.` call appears within 400 chars of it, and that `Packets.jsx` passes no
`onAsk`.

**⚠ A prior AC pass recommends DECLINING this row.** `AC-packet-ui-final.md:124` calls it
"EXISTS-BUT-CONSTRAINED by a deliberate relocation … **Recommend closing as DELIBERATE**", on the
grounds that the drawer's Blocks tab already deep-links into the fields that own the ask. That
recommendation is on the record and this brief overrides it; the owning lane should be told both,
because it is a decision, not a build question.

## Note on 4.4-29 and the same AC recommendation

`AC-packet-ui-final.md:92` and `:408` also recommend closing 4.4-29 as DELIBERATE, with the specific
condition that **"no second enumeration of the findings is added to the asset header"**. The build
above satisfies that condition literally: it renders the COMPLEMENT of what the margins show, so no
finding is enumerated twice. What the AC did not have is the measurement — 53 of the resume's 73
counted findings had no home on the screen at all. It reasoned about the findings that WERE
relocated; the ones that were not are the row.


> **CORRECTED 2026-08-30 by RENDER-SWEEP-2.md.** This file said the headers print `40 to fix + 33 to review`.
> The rendered badge prints **`70 to fix + 3 to review`**; 40/33 is what `severityCounts` returns, not what the
> screen shows. Both total 73, so the reconciliation this row rests on is unaffected - but the sentence was
> false against the DOM, which is the one thing an evidence file may never be.

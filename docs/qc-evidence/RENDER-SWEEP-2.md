# RENDER SWEEP 2 — re-probing five prototype-parity rows against the DOM

<!--
WHAT:       Independent re-run of RENDER-SWEEP.md's own probes against commit a86e8be,
            to establish whether five prototype-parity rows now actually RENDER.
WHY:        RENDER-SWEEP.md measured these rows as PARTIAL/ABSENT on 44cf80a. Two lanes
            then claimed to build them (IMPL-qcrail-rows.md, IMPL-blocks-rows.md). A claim
            in an implementer's own file is not a rendered DOM node.
SUPERSEDES: nothing — RENDER-SWEEP.md stands; this measures a later commit.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   this file; screenshots in docs/qc-evidence/screens/ named by row id.
-->

**Commit under test:** `a86e8be` ("QC rail lane: Undo this, attention ordering, and the gate deep link")
**Branch:** `claude/incumbent-wins-swap` · **Date:** 2026-08-30
**Instrument:** `scripts/render-app.mjs --probe` (real `app/dist`, real React, fixture-served
`/api/**`) + Playwright DOM queries. Method inherited from `RENDER-SWEEP.md`.

**No shared context with the implementers.** `IMPL-qcrail-rows.md` and `IMPL-blocks-rows.md` are
treated as CLAIMS TO TEST, never as findings.

**Rules carried forward from RENDER-SWEEP.md §C3/§C5** (each earned by a measured false ABSENT):
1. PRESENT only from a live DOM query, never from source.
2. ABSENT is the heaviest claim — render in the state that should show it, read the mounting file's
   IMPORT LIST, grep repo-wide for alternate spellings.
3. `document.body.innerText` EXCLUDES form-field values — use `inputValue()`.
4. Never screenshot between counting a node and clicking it (detaches the node).
5. A short screenshot proves nothing — check image height vs page height; use `--h 3600`, not `--full`.
6. Read `aria-expanded` before clicking a toggle — the two toggles on an asset card have OPPOSITE
   defaults; clicking `blocks-toggle` blindly COLLAPSES the card and manufactures a false ABSENT.
7. The JD step shows one list at a time; the gate drawer mounts from the QC step, not the asset step;
   the assistant panel overlays the QC tab strip.
8. Report `unmatched` API calls — an unfixtured endpoint falls through to `{}` and reads as absent.

---

## Instrument for this pass

```
git show origin/ui-fixtures:raw-dump.json > /tmp/raw-dump.json
node scripts/build-fixtures.mjs --raw /tmp/raw-dump.json --opp 9f9c370a-… --out /tmp/fx-base.json --allow-thin
node /tmp/patch-fx.mjs        # thresholds + skill-bank + templates + 2 injected corrections
cd app && npm run build
node scripts/render-app.mjs --route '#/packet/9f9c370a-…/<step>' --fixtures /tmp/fx.json --h 3600 \
     --probe <probe.mjs> --out docs/qc-evidence/screens/<row>.png
```

Same dump `RENDER-SWEEP.md` used (Trinnex · Director of Digital Technology Operations & Innovation;
5 artifacts, 43 insertions, 21 requirements, 540 checks, 4 gates, **39 swaps**, **0 corrections**).

**What was patched into the fixture, and why — stated, never hidden:**

| patch | shape taken from | needed for |
|---|---|---|
| `/search-prefs`.`checks` | `api/dist/functions/tests/checks.js` `DEFAULT_THRESHOLDS` (`skillMaxChars: 24`, `relevantMaxChars: 20`) | the dump carries no `checkPrefs` row; without it every rule label degrades (`RENDER-SWEEP.md:45-52`) |
| `/app/skill-bank`, `/config/templates` | `useSkillBank`'s `{entries:[{label,category}]}` | otherwise they fall through to `{}` and land in `unmatched` (`RENDER-SWEEP.md` §C3.4) |
| **2 corrections on the resume** | `correctionRow`'s own columns (`assetGate.js:678-703`) | the dump has **0 corrections**; 4.11-7's controls hang off a correction row and are otherwise `NOT_TESTABLE` |

`pageErrors: []` on **every** render in this pass (10 renders). `unmatched: []` on the resume, jd
and send steps; on the QC step five `/artifact/<id>/remediation` calls fall through to `{}` — see §6,
which explains why that is reported rather than fixtured, and why it touches none of these rows.

**The 39 swaps in the dump carry all four actions** — `swapped 5, dropped 19, added 10, **kept 5**` —
so 4.8-20's `kept`-row refusal is testable on real data, not an injected fixture.

---

## Verdict table

| row | VERDICT | selector queried + text returned |
|---|---|---|
| **4.4-29** `Go to field →` on the resume step | **CONFIRMED** | §1 |
| **4.4-14** gate count deep-link | **CONFIRMED** — with one measured label/destination divergence, §2b | §2 |
| **4.8-20** `Undo this` on a swap row | **CONFIRMED** | §3 |
| **4.8-11** attention ordering | **CONFIRMED** for `fix → review → soft` (the claimed inversion, proved on a constructed fixture); `open` / `fixed` **NOT_TESTABLE** — no producer | §4 |
| **4.11-7** `Re-run QC` / `Revert` / refused `Keep` | **CONFIRMED** | §5 |

### Regression spot-checks (rows `RENDER-SWEEP.md` §B recorded as BUILT)

| row | VERDICT | evidence |
|---|---|---|
| **4.4-3** card gate badge | **CONFIRMED** | §S1 |
| **4.4-11** `Approve` disabled when the gate fails | **CONFIRMED** | §S1 |
| **4.11-5** `Put back an original` | **CONFIRMED** | §S1 |
| **4.11-6** `Shorten to fit` | **CONFIRMED** | §S1 |
| **4.4-13** asset-level ask | **CONFIRMED** | §S1 |
| **4.7-8** forwards to the assistant | **CONFIRMED** | §S1 |
| **4.4-8** three doc links, `nowrap` | **CONFIRMED** (PARTIAL as recorded) | §S1 |
| **4.4-24 / 25 / 26** per-kind counters | **CONFIRMED** | §S1 |
| **4.1-3 / 4.1-4 / 4.1-11 / 4.1-13** JD step | **CONFIRMED** | §S2 |
| **4.1-29 / 4.1-30** keyword list | **CONFIRMED** | §S2 |
| **§4.10** review & send gate list | **CONFIRMED** | §S2 |

**Headline: 5 of 5 CONFIRMED.** Zero of the five rows was falsely claimed. **Zero regressions** in
**17** spot-checked rows across 4 steps (jd, resume, qc, send) — including every row the ordering
change and the gate-badge change could have touched. `app` suite **418 pass / 0 fail** and
`npm run build` **✓ built in 3.20s**, both re-run on this commit.

**Two findings raised that are NOT verdicts on these five rows:** a label/destination divergence on
the 4.4-14 badge (§2b), and two numbers quoted in `IMPL-blocks-rows.md` that are not the numbers on
the screen (§1b). Neither changes a CONFIRMED.

---

## 1. `4.4-29` — `[data-qc="qc-go-to-field"]` on the RESUME step · **CONFIRMED**

**Claim (`IMPL-blocks-rows.md:160`):** was 0, now 10, behind a disclosure collapsed by default.

**The trap was real and was walked into deliberately, to measure it.** Probing without expanding:

```
beforeExpand: { goToField: 0, unplacedContainers: 2, unplacedRows: 0 }
```

So a probe that queries the selector cold still reads **0** — exactly the false ABSENT
`IMPL-blocks-rows.md:187-191` warns about. The state is readable WITHOUT clicking, from the
container's own attributes (`AssetBlocks.jsx:295`):

| `[data-qc="blocks-unplaced"]` | `data-qc-n` | `data-qc-open` | header innerText |
|---|---|---|---|
| #1 (resume) | **53** | `0` | `53 open findings with no field of their own \| counted on this header, but they name no field this asset renders, so no margin below shows them \| Show` |
| #2 (compact resume) | **45** | `0` | `45 open findings with no field of their own \| … \| Show` |

**Expanded via each container's OWN `[role="button"]` header**, never `blocks-toggle` (RENDER-SWEEP
§C5 — clicking that one COLLAPSES the card). `aria-expanded` read first on both: `"false"`, `"false"`,
so the click opens rather than closes.

```
afterExpand: { goToField: 10, unplacedRows: 98, unplacedReasons: 88 }
data-qc-open after: "1", "1"
```

**OBSERVATION — `[data-qc="qc-go-to-field"]` → 10 nodes.** Shape, read off the DOM
(`AssetBlocks.jsx:322-327`): `tagName SPAN`, `role="button"`, `tabindex="0"`, innerText
**`Go to field in Resume →`**, `data-qc-target-field` ∈ {`RelevantBullets1` ×3, `RelevantBullets2` ×2,
`RelevantBullets3` ×1, `ExpertiseBullets` ×4}, `data-qc-target-self="0"` on every one.
The hook is the rail's own `QC_HOOKS.goToField` (`qcRail.js:61`), not a second name — which is why
`RENDER-SWEEP.md`'s existing selector sees it.

**No dead UI, observed.** 98 rows, 10 links, **88 reasons** — the remainder print why instead, in
three distinct wordings and no others:

```
"this finding names no merge field, so there is nothing to open"
"this finding spans two fields, so it does not open one of them"
"this is a posting requirement, not a field of the document"
```

**Severity order across the 98 rows in DOM order:** `fix×29, review×24, fix×25, review×20` — two
runs because the list is two containers concatenated (53 then 45); within each, `fix` precedes
`review`. Consistent with `unplacedOf`'s `{fix:3, review:2, soft:1}` sort (`assetBlocks.js:1064-1067`).

### 1b. The reconciliation claim — **CONFIRMED, with one correction to the implementer's own wording**

Claimed: `53 + 20 = 73` and `45 + 2 = 47`.

**Read off the DOM:**

| | `gate-to-fix` | `gate-to-review` | total | `blocks-unplaced` `data-qc-n` | implied placed |
|---|---|---|---|---|---|
| resume | `70 to fix` | `3 to review` | **73** | **53** | **20** |
| compact resume | `47 to fix` | *(none — 0)* | **47** | **45** | **2** |

**Cross-checked against the producers** on the same fixture payload
(`attentionWithFields` / `unplacedOf` from `assetBlocks.js`, `severityCounts` from `assetGate.js`):

```
resume  { severityCounts:{fix:40,review:33,soft:0}, attentionRows:73, unplaced:53, placed:20, renderedFields:7 }
compact { severityCounts:{fix:26,review:21,soft:0}, attentionRows:47, unplaced:45, placed:2,  renderedFields:2 }
```

**OBSERVATION:** both ends agree — `53 + 20 = 73`, `45 + 2 = 47`. The complement is exact.

**⚠ CORRECTION to `IMPL-blocks-rows.md:164`,** which states *"the two headers print `40 to fix` +
`33 to review` = 73"*. They do **not**. The rendered badge prints **`70 to fix` + `3 to review`**;
`40 / 33` is what `severityCounts` returns, and the badge's split comes from elsewhere. **Both splits
total 73**, so the reconciliation the row rests on is unaffected — but the implementer's file quotes
numbers that are not on the screen, and a later reader checking that sentence against the DOM would
find it false. Same for the compact resume: `26 + 21` vs the rendered `47 to fix` and no review pill.

**Screenshots:** `screens/4.4-29-unplaced-expanded.png` (1440×3600; the expanded container's own
`getBoundingClientRect()` is `top: 55, height: 7796` against `viewportH: 3600`, so the image is the
header plus the first ~3.5k px of the 53 rows — the box is genuinely taller than any single frame,
stated rather than passed off as the whole list) and
`screens/4.4-29-go-to-field-links.png`, scrolled to the first link, with **7 `Go to field in Resume →`
controls inside the viewport at capture time** (`RelevantBullets1/3/1/2/2/1`, `ExpertiseBullets`).

---

## 2. `4.4-14` — `[data-qc="gate-to-fix-link"]` · **CONFIRMED**

**Claim (`IMPL-qcrail-rows.md:194-251`):** the count is now a real control that resolves; the old
defect was a two-key `CHECK_SUBJECT_FIELD` map producing `null`. The implementer explicitly says
*"Not yet confirmed live … Re-running RENDER-SWEEP.md's 4.4-14 probe is what would confirm it."*
This is that probe.

**It is a real control** (`AssetGateDrawer.jsx:89-98`), 2 nodes:

| | tag | role | tabindex | computed `cursor` | innerText | wraps `gate-to-fix` |
|---|---|---|---|---|---|---|
| resume | `SPAN` | `button` | `0` | **`pointer`** | `70 to fix \| Skill lines fit the template ->` | `70 to fix` |
| compact | `SPAN` | `button` | `0` | **`pointer`** | `47 to fix \| Skill lines fit the template ->` | `47 to fix` |

`RENDER-SWEEP.md:78` measured the same badge as `role: null`, `tabindex: null`,
`cursor: "default"`, `0` inner controls. All four have flipped. `gate-to-fix` still renders and is
now `wrappedByLink: true` on both — the count survives the wrapper rather than being replaced by it.

**It RESOLVES — the failure mode the brief names specifically is not present.** Behavioural, count
first, click after, no screenshot in between:

```
before        : hash "#/packet/9f9c370a-…/resume", [data-qc-focused="1"] -> []
focus()       : document.activeElement data-qc -> "gate-to-fix-link"
Enter         : hash unchanged, [data-qc-focused="1"] -> ["RelevantBullets1"]
mouse click   : hash unchanged, [data-qc-focused="1"] -> ["RelevantBullets1"]
```

**OBSERVATION:** keyboard AND mouse both land on a real field. Nothing resolves to `undefined`.
The hash is unchanged because the destination field is on the step already open — the deep link's
job here is focus, not a route change (`goToField`, `PacketBuilder.jsx:769-777`, resolves
`artifactId -> step` and only moves the step when it differs).

### 2b. ⚠ A divergence this probe found: the label names a DIFFERENT finding from the one it opens

**OBSERVATION.** The badge reads `70 to fix — Skill lines fit the template →`, and clicking it
focuses `RelevantBullets1`. Those are two different findings. Computed from the same payload:

```
resume  { badgeTitleCheck:"skill_char_limit", badgeTitle:"Skill lines fit the template",
          targetField:"RelevantBullets1", landedOnCheck:"relevant_char_limit", sameCheck:false }
compact { … identical … }
```

**INTERPRETATION (mechanism read from source, not inferred from the symptom).** The title and the
destination come from two different selections that were never required to agree:

- `firstFixFinding(result)` (`assetGate.js:239-247`) takes the first `fix`-severity row **whatever
  its offenders say** — here `skill_char_limit`.
- `firstFixTarget(entries, id)` (`qcRail.js:1282-1292`) walks `packetFailList` and **skips every row
  whose `mergeField` is null** — and `skill_char_limit` is precisely the check
  `IMPL-qcrail-rows.md:224` documents as correctly unresolvable (its offenders carry no field
  prefix, `checks.ts:350`). So the title's own finding is the one the link cannot open.

This is not the defect the row was about — the count IS a live deep link and it DOES land somewhere
real — so **4.4-14 stands CONFIRMED**. But `n to fix → <title>` promises the title names where you
land, and on this fixture it names something else, on **both** assets. Raising it as a finding for
the owning lane rather than folding it into the verdict.

---

## S1. Regression spot-checks on the resume step — all **CONFIRMED**

Nothing here regressed under the ordering change or the gate-badge change.

| row | selector | returned |
|---|---|---|
| **4.4-3** gate badge | `[data-qc="gate-badge"]` ×2 | `Blocked \| 70 to fix \| Skill lines fit the template -> \| 3 to review`; sub-hooks all present inside it: `gate-word` → `Blocked`, `gate-to-fix` → `70 to fix`, `gate-to-review` → `3 to review`. **The only change from `RENDER-SWEEP.md:128` is the added `Skill lines fit the template ->` link text — the three sub-hooks are intact.** |
| **4.4-11** Approve disabled | `button` text match | `Approve` ×2, **`disabled: true`**, `title="The checks block this asset - open QC to see what must be fixed."`; sibling `Regenerate` ×2 `disabled: false` — a real conditional, not a blanket disable |
| **4.11-5** Put back an original | `[data-qc="blocks-restore-original"]` | **17** — `Put back “Digital Transformation”`, `Put back “Cloud Architecture”`, `Put back “Software Development”` (unchanged from the 17 recorded at `RENDER-SWEEP.md:135`) |
| **4.11-6** Shorten to fit | `[data-qc="blocks-shorten-to-fit"]` | **8** nodes, `Shorten to fit` |
| **4.4-13** asset-level ask | `[data-qc="blocks-ask-change"]` / `[data-qc="packet-asset-ask"]` | **9** and **2** — same two hooks, same counts as `RENDER-SWEEP.md:130` |
| **4.7-8** forward to assistant | `[data-qc="blocks-forward-assistant"]` | **9**, `Ask the assistant` |
| **4.4-8** doc links | `a.px-link` / `span.px-link[role=button]` | `✓ Open Google Doc ↗` → `tagName A`, `whiteSpace: nowrap`, `href` present; `⎘ Copy tracked link` → `tagName SPAN`, `whiteSpace: nowrap`. PARTIAL as recorded (neither is `px-btn`) — unchanged |
| **4.4-24/25/26** per-kind counters | `[data-qc="blocks-stat"]` after clicking `blocks-answers-toggle` | `aria-expanded` read first → `"false","false"` (so the click opens); `statsBefore: 0` → **9 nodes**: `MUST-HAVES ANSWERED 0 of 7`, `RESPONSIBILITIES ANSWERED 0 of 12`, `NICE-TO-HAVES ANSWERED 0 of 2` (resume) and `1 of 7` / `0 of 12` / `0 of 2` (compact). Denominators still reconcile: 7+12+2 = 21 = `POSTING LINES PLACED 0 of 21` |

---

## 3. `4.8-20` — `[data-qc="qc-undo-swap"]` on the `Original vs final` tab · **CONFIRMED**

**Claim (`IMPL-qcrail-rows.md:45-84`):** built as a seeded assistant request, absent on a `kept` row,
naming the list through `fieldLabel` and never the raw enum, with three distinct sentences.

`RENDER-SWEEP.md:91` measured this tab's **complete** control set as `["Ask why"]`, with
`undo` → **0 occurrences on the whole page**. That has changed.

**Reached by clicking `[data-qc="qc-tab"][data-qc-tab="compare"]`** (the tab the row lives on).

```
[data-qc="qc-undo-swap"] -> 34        [data-qc="qc-ask-why"] -> 39
undoByAction             -> { swapped: 5, dropped: 19, added: 10 }   (kept: absent)
```

39 swaps in the dump; 34 undo controls; the 5 missing are exactly the 5 `kept` rows.

### 3a. The `kept` refusal — **CONFIRMED**, and it is a divergence from `Ask why`, not a gap

Every `<tr>` in the swap table, classified by its action pill and which controls it carries:

| action pill | `qc-undo-swap` | `qc-ask-why` | rows |
|---|---|---|---|
| `swapped` | **true** | true | 5 |
| `dropped` | **true** | true | 19 |
| `added` | **true** | true | 10 |
| **`kept`** | **false** | **true** | **5** |

The `kept` row itself, innerText:
`Team Development ⇥ Team Development ⇥ kept ⇥ no line of the posting backs this change ⇥ | Ask why`

**OBSERVATION:** on a `kept` row `Undo this` is gone and `Ask why` remains. That is the exact
asymmetry `qcRail.js:869` implements (`if (String(s.action||'') === 'kept') return null`) and the
reason `QC_HOOKS.undoSwap` is a separate hook rather than a variant of `qc-ask-why`
(`qcRail.js:96-100`). **Per the brief, this absence is correct and is NOT reported as a defect.**

### 3b. The seeded sentence — read with `inputValue()`, never from `innerText`

The seed reaches the DOM only as the assistant textarea's **value**, so
`document.body.innerText` cannot see it (`RENDER-SWEEP.md` rule 3). Measured directly:

```
seedInputValue : Undo the swap of "Engineering Leadership" for "Engineering Execution" in Skills 1,
                 and tell me which posting line loses its coverage.
seedInBodyText : false      <- rule 3 demonstrated live on this very row
```

One click per action, each read back from `[data-qc="assistant-box"]`:

| action | seed returned | raw enum? | empty `""` pair? | says "swap"? |
|---|---|---|---|---|
| `swapped` | `Undo the swap of "Engineering Leadership" for "Engineering Execution" in **Skills 1**, and tell me which posting line loses its coverage.` | **no** | no | yes |
| `dropped` | `Put "Digital Transformation" back in **Skills 1** - it was dropped and I would rather keep it.` | **no** | no | **no** |
| `added` | `Undo adding "Technology Strategy" to **Skills 1**.` | **no** | no | **no** |

**OBSERVATION:** the list is named `Skills 1` in all three. Page-wide sweep for the raw
`CHECK`-constrained enums (`schema.ts:567`) on the compare tab —
`skills_1 / skills_2 / relevant_1 / relevant_2 / relevant_3` — **all five `false`**. The enum does
not reach the reader anywhere on the surface.

The three sentences are genuinely distinct, and only the `swapped` one uses the word "swap" — the
precise hole that `IMPL-qcrail-rows.md:280-285` records a surviving mutation for.

**Screenshot:** `screens/4.8-20-undo-this-swaps.png` (1440×3600) — scrolled to the swap table, with
**34 `Undo this` and 39 `Ask why` controls inside the viewport at capture time**; and
`screens/4.8-20-compare-tab.png`.

---

## 4. `4.8-11` — attention ordering · **CONFIRMED** (for what has a producer)

**Claim (`IMPL-qcrail-rows.md:118-157`):** `CheckRow` now emits `data-qc-sev`; the defect was
`severityWeight` sorting a reviewer `fail` (→ `soft`) **above** a reviewer `warn` (→ `review`),
opposite ends of `ATTENTION_ORDER = ['fix','open','review','fixed','soft']` (`assetGate.js:162`).

**`data-qc-sev` renders on 203/203 check nodes** (`QcRail.jsx:206`), read from `severityFor`, so the
order can be read as SEVERITY rather than re-derived from state+engine — which was the point.

### 4a. The production dump CANNOT exercise the defect — so a fixture was constructed

Engine/state census of the dump's 540 check rows:

```
deterministic/fail 111 · deterministic/warn 89 · deterministic/pass 289 · deterministic/not_applicable 46
reviewer/warn 3 · reviewer/pass 2 · reviewer/fail 0     <- NONE
```

`severityFor` (`assetGate.js:132-137`) only returns `soft` for a reviewer **fail**, and there are
none. On `/tmp/fx.json` the resume renders `fix ×40 → review(det) ×30 → review(reviewer) ×3` and
stops — correct, but it never puts a `soft` beside a `review`, so **it does not test the claim.**
Reporting that sequence as proof would have been a vacuous pass.

**Constructed:** two `reviewer` / `state: fail` rows (→ `soft`, the LAST bucket in `ATTENTION_ORDER`)
injected into the resume's `checks-result`, **placed FIRST** in both `results` and
`engines.reviewer.results`. If the sort were missing or wrong they would stay at the top.

### 4b. The result — the inversion is fixed

`data-qc-sev`/`state`/`engine` in DOM order across all 205 check nodes, run-length encoded, index in
brackets:

```
[0]   fix/fail/deterministic     ×40
[40]  review/warn/deterministic  ×30
[70]  review/warn/reviewer       ×3
[73]  soft/fail/reviewer         ×2     <- the two INJECTED rows
[75]  fix/fail/deterministic     ×21    <- next asset begins
[96]  review/warn/deterministic  ×18
[114] fix/fail/deterministic     ×24
[138] review/warn/deterministic  ×20
[158] fix/fail/deterministic     ×26
[184] review/warn/deterministic  ×21
```

Located by their own text: the rows carrying `INJECTED reviewer fail` are at **index 73 and 74** —
**last** in the resume's block, **below all three reviewer `warn` rows at 70-72**, having entered the
payload first.

**OBSERVATION:** `fix (0-39) → review (40-72) → soft (73-74)`. A reviewer `warn` now outranks a
reviewer `fail`. **Both are present in one list and the order is right.** Repeated per asset with no
exception across all five.

Ancestry of a check node: `DIV[qc-check] → DIV[qc-decision-asset] → DIV[qc-decisions] → DIV[qc-rail]`
— this is the "Needs a decision" list (`railDecisions`), the surface whose hand-rolled
`engine → ['fail','warn']` nest was the second home of the inversion.

Its per-asset heads still open on the worst finding: `Resume | Skill lines fit the template | 5 |
Fix before approval`, `Portfolio | Section word counts | 5 | Fix before approval`, … and
`Intro video | The checks have not been run on this asset, so nothing here has been decided either
way.` — an unchecked asset stated, not scored.

**Screenshot:** `screens/4.8-11-attention-order.png`, scrolled to the `review → soft` boundary; the
14 check rows in the viewport tail read
`review/reviewer ×2, **soft/reviewer ×2**, fix/deterministic ×10` — the transition is visible in one
frame.

### 4c. `open` and `fixed` — **NOT_TESTABLE**, and stated rather than passed

`ATTENTION_ORDER` has five buckets; `severityFor` can only ever produce three (`fix`, `review`,
`soft`). `open` has **no producer at all** (`assetGate.js:154`, on the record), and `fixed` is
corrections, which live in their own region and are counted separately. So the brief's
`fail → open → warn → fixed → soft` is verified for the **three positions that exist**; the other
two cannot be brought on screen by any fixture and are **not** claimed proven here.

### 4d. The drawer's Checks tab — **NOT_TESTABLE** for this defect, and structurally so

`ChecksTab` (`AssetGateDrawer.jsx:277-288`) reads `engineRows(result, 'deterministic')` — reviewer
rows never reach it. Opened live (via `qc-correction-open`), its `[data-qc="gate-check"]` sequence is
`fail ×40 → warn ×30 → not_applicable ×20 → pass ×92` (182 = the resume's deterministic rows exactly),
and the injected reviewer fails are **absent from it — correctly**. So `H:one-severity-ordering`'s
claim that the drawer now shares `bySeverity` is consistent with what renders, but the reviewer
inversion cannot manifest there and this pass did not prove that guard from the DOM.

---

## 5. `4.11-7` — `Re-run QC` / `Revert` / refused `Keep` on a correction row · **CONFIRMED**

**Precondition, stated:** the dump carries **0 corrections**, so `RENDER-SWEEP.md:93` correctly
marked this `NOT_TESTABLE`. Two rows were injected in `correctionRow`'s own column shape
(`assetGate.js:678-703`) — one deterministic whitespace fix, one a real reworded skill. **The
rendering is real; the data is fixture-fed.**

`[data-qc="qc-change-log"]` → 1 · `[data-qc="qc-correction"]` → **2**. Complete control set of each
row, from the DOM:

| hook | text | disabled |
|---|---|---|
| `qc-correction-open` | `Review →` | false |
| `qc-correction-undo` | **`Undo`** | false |
| `qc-correction-suggest` | `Change it` | false |
| **`qc-correction-rerun`** | **`Re-run QC`** | false |

Counts across the page: `undo: 2, rerun: 2, keepNote: 2, suggest: 2, open: 2` — one of each per row,
none orphaned.

**Row 2 innerText, in full:**

```
Corrected: "Engineering Leadership" rewritten as "Engineering Execution" in Skills 1. | SkillsBullets1
| Review → | why: reworded by the ATS pass | the replacement was deterministic
| Undo | Change it | Re-run QC
| this change is already applied to your text and recorded here, so there is nothing to accept -
  undo it if you would rather it was not
```

### 5a. `Keep` is REFUSED with the reason RENDERED — not a dead control, and not silence

`[data-qc="qc-correction-keep-note"]` → **2 nodes**, each:

> `this change is already applied to your text and recorded here, so there is nothing to accept -
> undo it if you would rather it was not`

**Falsification attempt:** swept the whole page for any control whose text is exactly "Keep" —
`[...document.querySelectorAll('button,[role="button"],a')].filter(e => /^\s*keep\s*$/i.test(e.innerText))`
→ **0**. So the button does not exist anywhere, and the sentence stands in its place.

**Per the brief, `Keep`'s absence is NOT reported as a defect** — the requirement was that the reason
render rather than a dead control, and it does, twice, in `keepAvailability`'s own wording.

**Also note the field naming:** the sentence says **`in Skills 1`**, and the row's field chip reads
`SkillsBullets1` (the merge-field name, which is what a reader would search the template for) — no
`skills_1` enum on either.

**Screenshot:** `screens/4.11-7-correction-row.png` (1440×3600) — scrolled to the change log, with
**both correction rows inside the viewport at capture time**.

---

## S2. Regression spot-checks on the JD and send steps — all **CONFIRMED**

| row | selector | returned |
|---|---|---|
| **4.1-3** `See where each one is answered →` | `[data-qc="jd-open-qc"]` | 1 node, `tagName SPAN`, `role="button"`, `tabindex="0"`, innerText `See where each one is answered →` (the real U+2192) |
| **4.1-4** three-tab strip | `[role="tablist"]` / `[data-qc="jd-tab"]` / `[data-qc="jd-tabpanel"]` | `1` tablist; `Responsibilities (12)=true`, `Requirements (9)=false`, `Keywords (21)=false`; **1** panel — one list at a time |
| **4.1-11** posting line verbatim | `[data-qc="req-quote"]` | `tagName BLOCKQUOTE`, `Lead engineering execution across software products and client-facing projects` |
| **4.1-13** competency beside the id | `[data-qc="req-row"]` | `RESP #0 \| competency unassigned \| Lead engineering execution… \| The employer's words, characters 2,509-2,587 of the posting …` |
| **4.1-29** model terms earn no credit | `[data-qc="model-keywords"]` | `Model-inferred words from this posting · A language model produced these, not the term library. They are excluded from ATS scoring …` |
| **4.1-30** keyword list 2-up ≥1040px | `[data-qc="keyword-columns"]` at viewport **1400** | `data-qc-cols="2"`, `getComputedStyle().gridTemplateColumns` = **`493.5px 493.5px`** — identical to `RENDER-SWEEP.md:124` |
| **§4.10** send gate list | send step | 5 `gate-badge`; the reconciled total **`112 items to fix across 5 assets`**; `Sending stays locked until each one is fixed or the decision is recorded.` present; **no `Send` control renders while blocked** (0 matches) |

**⚠ A probe error of mine, recorded so it is not mistaken for a finding.** My first JD probe queried
`[data-qc="keyword-columns"]` on the **default Responsibilities tab** and got `null`. That is
`RENDER-SWEEP.md` §C5's own trap — the JD step shows one list at a time. Re-probed with the Keywords
tab clicked (`aria-selected` flipped `true,false,false` → `false,false,true`) it returns the grid
above. **The null was my instrument, not the app**, and no negative verdict was written from it.

---

## 6. Instrument notes from this pass

- **`unmatched` was empty on the resume, jd and send steps.** On the **QC step** five calls fall
  through to `{}`: `/api/app/artifact/<id>/remediation` for all five artifacts. That feeds the
  **Remediation loops** tab only; none of the five rows above, and none of the spot-checks, reads it.
  Reported rather than papered over — a fixture for it was **not** invented, because the endpoint's
  shape was not read.
- **`pageErrors: []` on every render in this pass** (10 renders).
- **`aria-selected` is `null` on all five `[data-qc="qc-tab"]` nodes**, before and after activation —
  unlike `[data-qc="jd-tab"]`, which carries it. The tab still activates (the compare panel's 34
  `Undo this` controls render only after the click), so this is an accessibility gap on the QC rail's
  tab strip, not a functional one. Out of scope for these five rows; noted because a future probe
  that asserts activation via `aria-selected` on this strip will get a false negative.
- **Screenshot heights were checked against page height, not assumed.** All captures are
  `--h 3600` (never `--full`, per §C3.3) and every one is `1440×3600` (the 4.1-30 shot `1400×3600`).
  Where a region is taller than one frame this file says so and gives the measured
  `getBoundingClientRect()` — the 4.4-29 unplaced box is `height: 7796` against `viewportH: 3600`, so
  its screenshot is explicitly a partial view, and a second shot scrolled to the links carries the
  control evidence.
- **No commit, no push, no branch switch.** `git status` untouched apart from this file and
  `docs/qc-evidence/screens/*`.

## 7. Suite and build, re-run on `a86e8be`

```
cd app && npm test      -> 1..418  # tests 418  # pass 418  # fail 0  # duration_ms 838.658561   EXIT=0
cd app && npm run build -> ✓ 247 modules transformed · ✓ built in 3.20s · no errors
```

The implementers' claim of **418/418** is **CONFIRMED** exactly. (`IMPL-blocks-rows.md:219` says
417/417 and `IMPL-qcrail-rows.md:23` says 418 — the tree at `a86e8be` runs 418, so the qcrail lane's
number is the current one and the blocks lane's was taken before the last commit landed.)

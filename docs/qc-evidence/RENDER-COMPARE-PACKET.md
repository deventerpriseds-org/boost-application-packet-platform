# RENDER-COMPARE-PACKET.md

**Task:** Render the Executive Engine app LOCALLY (never "live" — the sandbox cannot reach
`*.azurestaticapps.net` or `azurewebsites.net`) and compare it TAB BY TAB against the rendered
prototype, for the PACKET MODULE only.

**Owner's question (verbatim):** *"what ui components / ux functions are still missing? how close is
each page to being functional?"*

**Branch:** `claude/three-small-ui-gaps` (== `main` at `028fdec`)
**Started:** 2026-08-26
**Status:** COMPLETE — all 7 tabs rendered on both sides and compared. Written incrementally; the
summary table is the last section.

**Bottom line:** six of the seven tabs are functional. `Review & send` is not — it says
*"Nothing blocks sending."* on a packet its own QC tab calls `Blocked` with 52 findings, because
`useQcEntries` entries carry no `artifactId` key and both consumers look one up. One-line fix at
`QcRail.jsx:104`. Full evidence in TAB 7.

---

## Method — what was actually run

**No new harness was invented.** `scripts/render-app.mjs` already exists for exactly this: it serves
the real `app/dist` bundle over localhost, fulfils every `/api/**` request from
`docs/qc-evidence/fixtures.json` (route-keyed, longest-match-wins), seeds `ee_auth_user` in
`localStorage`, reloads past the auth gate, and screenshots / dumps body text. `app/test/browser/*`
(Vite + Playwright component probes) were read and are cited where a claim needs a component-level
fact rather than a page-level one.

```
cd /home/user/boost-application-packet-platform/app && npm run build
# ✓ 245 modules transformed. dist/assets/index-mppgfN3g.js 1,127.52 kB. built in 4.42s
```

Fixture: `docs/qc-evidence/fixtures.json` — a REAL production packet pulled via `db-query.yml` and
assembled by `scripts/build-fixtures.mjs`. Opportunity `2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3`
(eMoney Advisor — SVP, Development and Enterprise Architecture), packet
`4860ae3b-fa3a-46d0-9cfc-e656ae6835a5`, status `review`, `jdAnalyzed: false`, 5 artifacts,
35 requirements, 22 merge fields in `pkg`, `coveredKw: []`, `missingKw: 8`, `atsScore: null`,
`mustHaves: []`.

**Tabs are read from `STEPS` in `app/src/screens/PacketBuilder.jsx:100-115`** — not assumed:

| # | key | label | sub |
|---|---|---|---|
| 1 | `jd` | Posting analysis | Requirements, responsibilities, keywords |
| 2 | `resume` | Resume | Keyword-tailored from master |
| 3 | `cover` | Cover letter | Tailored narrative |
| 4 | `portfolio` | Portfolio | Assemble work samples |
| 5 | `video` | Intro video | Script + record 60s |
| 6 | `qc` | QC & evidence | Coverage, checks, review |
| 7 | `send` | Review & send | Approval rounds |

---

## Log

- [init] File created before any investigation, per brief.
- [build] `app/dist` built, 4.42s, no errors.
- [done] 7 app renders + 7 prototype renders + 5 driven-state renders + 6 click-driven renders.


---

## A. WHAT ACTUALLY RENDERED — all 7 tabs, one command each

```
node scripts/render-app.mjs --route '#/packet/2cb56fb3-fc33-4b1a-85b9-06c7aea2fbb3/<step>' \
  --fixtures docs/qc-evidence/fixtures.json --text --settle 4000
```

| Step | `bodyLen` | `pageErrors` | Unmatched `/api/` calls (a screen rendering on `{}`) |
|---|---:|---|---|
| `jd` | 9,915 | `[]` | none |
| `resume` | 12,479 | `[]` | `/api/config/templates` |
| `cover` | 3,727 | `[]` | none |
| `portfolio` | 8,812 | `[]` | none |
| `video` | **724** | `[]` | none |
| `qc` | 78,767 | `[]` | `/api/app/artifact/{5 ids}/remediation` |
| `send` | **826** | `[]` | none |

Every tab rendered. **Zero page errors on all seven** — no tab is broken. Two tabs (`video`, `send`)
render under 1KB of text, and that is the finding, not a harness failure: their fixture data is
present and served, there is simply almost nothing on the page.

**Two fixture gaps are themselves findings, recorded here rather than papered over:**

1. `/api/config/templates` — unfixtured, so `ResumeTemplatePicker`
   (`PacketBuilder.jsx:41-98`) received `{}` and, by its own rule at line 56
   (`if (!rows || (rows.length < 2 && !value)) return null`), rendered **nothing**. Its behaviour
   with 2+ templates is `not_applicable` in this run, not `pass`. **Fixture needed:**
   `"/config/templates": { "templates": [{templateId,label,roleFocus}, …] }` (≥2 rows).
2. `/api/app/artifact/{id}/remediation` — unfixtured for all five artifacts, so the QC tab's
   **Remediation loops** sub-tab is driven by `{}`. Its populated state is `not_applicable`.
   **Fixture needed:** `"/artifact/<id>/remediation": {…}` per artifact.

`scripts/build-fixtures.mjs` does not emit either key — confirmed by the key list of
`fixtures.json` (21 keys, none matching `templates` or `remediation`).

---

# TAB 1 — `jd` · Posting analysis

## 1.1 What actually rendered

**App**, fixture `docs/qc-evidence/fixtures.json`, `bodyLen 9,915`, zero page errors. Rendered, in order:
`Extracted from triggering email` header strip (Source / Role / Comp / Location / Hiring manager) →
`Posting` box with a **Parse posting** button and the empty-state *"No posting text and no summary are
stored for this opportunity. Use \"Parse posting\" to fetch it from the source URL."* →
`This posting, against your profile` (ProfileCompareCard) → `Posting analysis - the source`
(PostingAnalysisCard) with a **Show as columns** toggle, a **See where each one is answered →** link,
a provenance strip (`lines extracted · located in the posting text · no posting text stored`) and
three sub-tabs **Responsibilities (21) / Requirements (14) / Keywords (35)**, 21 `RESP #n` rows each
carrying the employer's verbatim words + character offsets + `parser read it as:` paraphrase +
`Filed here because …` + `not checked for evidence` → a `Legend` line → `Match & keyword run` card with
**Run analysis** and **Build entire packet** → **Next: Resume →**.

**Prototype**, `node /tmp/pw/render-spec-text.mjs --step jd --vendor …` → `tokenValue rgb(248,249,250)`
(tokens resolved, so the render is the design), `pageErrors: []`, `notFound: []`. Rendered:
same email strip (populated: LinkedIn / $300–360k + eq / Austin, TX · hybrid / Kylie Brandt) →
`Job description parsed` + **Re-parse JD** + posting body → `Extracted from this posting` with sub-tabs
**Responsibilities 4/4 / Requirements 7/8 / ATS keywords 12/13**, 4 `D1–D4` rows each with an
`evidenced — show the line` affordance → a legend → `Posting vs your profile` with 4 fit cards
(RESPONSIBILITIES 4 of 4 · MUST-HAVE 5 of 5 · NICE-TO-HAVE 2 of 3 · ATS KEYWORDS 12 of 13) and an
8-row DIMENSION / THE POSTING ASKS FOR / YOUR PROFILE EVIDENCES / FIT table → **Run again** ·
**Build entire packet** → **Next: Resume →**.

## 1.2 An overturned first reading — recorded because it is exactly the trap this brief warns about

My first render showed **"Loading the comparison..." twice and no table**, which reads as an unbuilt
compare panel. **That is wrong, and the fixture caused it.** `ProfileCompareCard` is driven by
`req.data?.comparison` (`PacketBuilder.jsx:829`); `fixtures.json`'s `/requirements` value has only a
`requirements` array, and `scripts/build-fixtures.mjs` never emits a `comparison` key. The API DOES
return one — `appRequirements.ts:699,704` calls `comparisonPayload()`, which at
`appDimensions.ts:254-266` **always** returns an object carrying `resolved: rows.length > 0`. So the
the "loading" state is unreachable in production from this path.

I drove the two real states by hand-building fixtures (`/tmp/fx-unresolved.json`, `/tmp/fx-graded2.json`):

| Fixture | Rendered |
|---|---|
| `resolved:false, dimensions:[]` | *"This posting has not been compared to your profile yet. Nothing has been measured - which is not the same as nothing matching. Run the evidence resolve…"* + *"Seeded dimension set for engineering - you have not changed it yet."* |
| 3 dimensions, `stale` set | *"2 of 3 dimension(s) compared"*, *"Your dimension set for engineering."*, the stale banner, *"1 strong · 1 moderate · 0 weak · 1 not compared (AI/ML depth), not counted either way"*, and the full 4-column table with `Model paraphrase - not the employer's wording.` and `From your profile facts: Work history` sub-labels |

**Verdict: `ProfileCompareCard` is BETTER-THAN-PROTOTYPE.** The prototype's `ProfileCompare`
(`qc/packet.jsx:169-214`) has a hardcoded 8-row table and 4 fit cards with no notion of a dimension
SET, no source attribution per cell, no staleness, and no `not_applicable` class. The app has all
four, and its `not compared` exclusion is precisely the "absent evidence is not a pass" rule.

## 1.3 Present / Missing / Degraded

| Prototype element | Prototype `file:line` | App status | Evidence |
|---|---|---|---|
| Email-extraction strip (Source/Role/Comp/Location/Hiring manager) | `qc/packet.jsx:360-374` (rendered: "Extracted from triggering email") | **PRESENT** | App text `Extracted from triggering email / Source — / Role SVP,… / Comp — / Location — / Hiring manager —` |
| Posting body + re-parse control | prototype "Job description parsed" + **Re-parse JD** | **PRESENT (renamed)** | App: `Posting` + **Parse posting**. Rename, not a gap |
| Posting empty state | *not in prototype* — prototype hardcodes a posting body | **BETTER-THAN-PROTOTYPE** | App: *"No posting text and no summary are stored for this opportunity."* — a distinct empty state the prototype has no concept of |
| Extraction card w/ 3 sub-tabs | `qc/packet.jsx:27-168` (`ParsedBlocks`, `PARSED_LAYOUT='tabs'`) | **PRESENT** | App renders `Responsibilities (21) / Requirements (14) / Keywords (35)` |
| Per-line verbatim + id chip | `qc/assets.jsx:151-165` (`ReqChip`) | **BETTER-THAN-PROTOTYPE** | Prototype: `D1` + a short label. App: verbatim + `characters 61-181 of the posting (located by anchor, not an exact string match)` + `parser read it as:` + `Filed here because…` |
| Legend (M1–M5 / D1–D4 / N1–N3) | `qc/assets.jsx:166-180` (`ReqLegend`) | **PRESENT** | App: `Legend - MH must-have · NTH nice-to-have · RESP responsibility · #n the line's position…` |
| Per-line "evidenced — show the line" | prototype `ParsedBlocks` row affordance | **PARTIAL** | App renders `not checked for evidence` on every row — the *negative* half of the state. The positive half ("evidenced — show the line") did not appear because every fixture row is unevidenced. **`not_applicable`, not a pass** — needs a fixture with an evidenced requirement to settle |
| 4 fit summary cards (RESP / MUST / NICE / ATS) | `qc/packet.jsx:169-214` | **PARTIAL** | App has the *summary line* (`1 strong · 1 moderate · 0 weak · 1 not compared`) but not four discrete cards with a "Missing: FedRAMP" call-out. The counts exist; the card layout does not |
| Compare table (4 cols, 8 rows) | `qc/packet.jsx:169-214` | **BETTER-THAN-PROTOTYPE** | See §1.2 — same 4 columns plus set-source, staleness, per-cell provenance, `not_applicable` |
| Layout toggle | *not in prototype* | **BETTER-THAN-PROTOTYPE** | App: **Show as columns**, a persisted user preference (`PostingAnalysis.jsx:490`), per the no-hardcoded-config rule |
| Cross-link into QC coverage | prototype "See how the assets answer these →" | **PRESENT** | App: **See where each one is answered →** + subtitle *"opens the coverage list in QC, line by line"* |
| **Run again** / **Build entire packet** | `qc/packet.jsx` run row | **PRESENT** | App: **Run analysis** + **Build entire packet**, plus a queue-state line (`queued — starts within a minute` / `building on the server`) the prototype has no equivalent for |
| ATS score `92%` in header + `Keywords & ATS terms →` panel | `qc/shell.jsx:31` (`MatchScore`), `qc/packet.jsx:322-353` (`sidePanel`) | **PARTIAL** | App header renders `MATCH ESTIMATE / — / model estimate · keywords ↗` — the control and the modal exist (`MatchEstimateButton`, `KeywordTallyOverlay`), but the value is `—` because `atsScore: null` in this packet. Distinct-null, not a fake number |
| **Auto-optimize resume** button | `qc/packet.jsx:335` | **MISSING** | No counterpart anywhere in `app/src`. Its closest analogue is **Build entire packet** / **Regenerate** |

## 1.4 HOW CLOSE IS THIS PAGE TO FUNCTIONAL

**The job, in one sentence:** read what this posting actually asks for, see where the owner's profile
answers it and where it does not, and decide whether to build the packet.

- **Can a user complete it end to end?** Yes, for the read half. All 35 lines, their provenance, their
  class and their unevidenced status render from stored data. Both action buttons (**Run analysis**,
  **Build entire packet**) exist, and the run card carries a persistent result strip and a queue state.
- **What BLOCKS completion:** nothing on this tab. The two weak spots are *data*, not controls —
  `atsScore: null` leaves the header estimate as `—`, and `jd_text` is not stored for this
  opportunity so the provenance strip reads `no posting text stored`. Both are honest nulls.
- **Cosmetic only:** the 4 fit cards, and the `Auto-optimize resume` button (which duplicates
  Build/Regenerate).
- **VERDICT: `FUNCTIONAL`.**
- **Highest-value next fix:** teach `build-fixtures.mjs` to emit `comparison` (and `evidence`) so this
  tab's two most load-bearing panels can be measured locally at all. Everything else here is data.

---

# A FIXTURE DEFECT THAT INFLATES EVERY COUNT ON EVERY TAB — read before the per-tab numbers

`scripts/build-fixtures.mjs:56` builds each artifact's check payload as
`(raw.checks||[]).filter(c => c.artifact_id === artifactId)` — **filtered by artifact only.**
The real endpoint filters by artifact **AND run**:

```
api/src/functions/tests/appChecks.ts:257
select * from check_result where artifact_id=$1 and run_id=$2 order by check_key   // $2 = artifact_gate.run_id
```

Measured on the resume artifact `a79a889f`: **36 deterministic rows across 2 run_ids**
(`6ad33a07` 18 rows @ `2026-08-23T03:01:14Z`, `f0c109b4` 18 rows @ `03:36:48Z`). Production would
return 18. Consequences visible in the renders above:

- every asset card shows each finding **twice** (`Section word counts … 197 words` next to
  `Section word counts … 185 words`; `No stray spacing` twice);
- the QC step's headline count is **52 to fix**, roughly double the real figure;
- the app's own reconciliation guard fires and says so, correctly:
  *"the server counted 5 finding(s) needing attention but sent 21 such row(s)"*.

**That guard firing is BETTER-THAN-PROTOTYPE behaviour, not a bug.** The prototype has no concept of
two numbers that should agree disagreeing. Every count quoted below is therefore an upper bound; the
*shape* of each finding is unaffected.

---

# TAB 2-5 — the artifact steps (`resume`, `cover`, `portfolio`, `video`)

These four share one component (`PacketBuilder.jsx:867-919`, gated by
`['resume','cover','portfolio','video'].includes(activeStep)`), so they are assessed together and
their differences are called out individually.

## 2.1 What actually rendered

| Step | Cards rendered | Merge-field cards | Notable |
|---|---|---:|---|
| `resume` | **2** — `Compact resume` + `Resume` | 7 each | `Resume` header: `review` · `Blocked` · `21 to fix`; `Compact resume`: `11 to fix` |
| `cover` | 1 — `Cover letter` | 3 | `review` · `Blocked` · `10 to fix` · `1 corrected` |
| `portfolio` | 1 — `Portfolio one-pager` | 7 | `review` · `Blocked` · `10 to fix` |
| `video` | 1 — `Intro video` | **0** | `todo` · `Not checked` · only **Generate script** and **🎥 Generate clone video** |

**Why `video` renders 0 field cards — ground-truthed, not inferred.** `AssetBlocks` derives its rows
from `data.insertions` only (`assetBlocks.js:243-248`), the API builds one row per
`mergeFieldsFor(type)` (`insertions.ts:86`), and `mergeFieldsFor` reads
`TEMPLATE_META[type].placeholders` (`insertions.ts:43-45`). **`TEMPLATE_META` has no `video` key at
all** (`packetTemplates.ts:22-57` defines only `resume`, `compact_resume`, `portfolio`, `cover`), so
`mergeFieldsFor('video')` returns `[]` and there is nothing for the video card to show.
**The prototype's video step is equally bare** — `todo` + **Generate script** and nothing else
(`/tmp/proto/video.json` BODY). This is not an app gap.

**Why the resume shows no Work-experience block.** Same chain: `TEMPLATE_META.resume.placeholders`
is exactly `['ResumeSummary','SkillsBullets1','SkillsBullets2','ExpertiseBullets','RelevantBullets1',
'RelevantBullets2','RelevantBullets3']` — **seven fields, none of them work history** — even though
the packet's `pkg` carries `WorkHistoryBullets1-4`. The prototype states the identical fact in prose
(*"No merge field exists. The zap populates seven fields and none is work history"*) but still
**renders the static block so the reader can see it.** The app renders nothing at all. See §2.2 row.

## 2.2 Present / Missing / Degraded — the asset card

| Prototype element | Prototype `file:line` | App status | Evidence |
|---|---|---|---|
| Asset header: label + sub + status pill | `qc/assets.jsx:195-281` (`AssetHeader`) | **PRESENT** | `Resume / Keyword-tailored from your master resume / review` |
| Header gate + finding count (`97 · 3 to review`) | `qc/evidence.jsx:16-25` (`GateBadge`) | **PRESENT (different metric)** | App: `Blocked` + `21 to fix`. The app has no composite number to print (`score: null` in the fixture; QC says *"No overall number was stored for this run."*) — a distinct null, not a fabricated composite |
| `Open Google Doc ↗` / `Copy tracked link` | `qc/assets.jsx` header row | **PRESENT** | App renders **📄 Create Google Doc** when `docUrl` is null; with a `docUrl` the branch at `PacketBuilder.jsx:233-262` renders `✓ Open Google Doc ↗`, `⎘ Copy tracked link` and `↻ Rebuild from current draft`. `not_applicable` in this fixture (no `docUrl`) |
| Coverage strip (`5/5 must-haves · 11/13 keywords`) | `qc/assets.jsx:181-194` (`assetCoverage`) | **PARTIAL** | App: `What this resume answers` + `6 of 10 changes the posting drove` + `6 to fix` + `5 to review` + `1 corrected`. The must-have and keyword ratios are **absent from the asset header** (they live on the QC Coverage tab instead) |
| Per-field card: label, measurement, field name, body | `qc/assets.jsx:352-471` (`AssetBlock`) | **PRESENT** | `Resume summary / 61 words / ResumeSummary / <text>`; on portfolio also `field name asks for 55 words - this draft has 56 words` |
| **Show original** | `qc/assets.jsx` `AssetBlock` | **PRESENT** | Rendered on every field card |
| **Ask for a change** | `qc/assets.jsx:334-351` (`AskBox`) | **PRESENT (renamed "List Tweaks")** | Both per-field (`AssetBlocks.jsx:683`) and whole-asset (`PacketBuilder.jsx:PACKET_HOOKS.assetAsk`). Rename recorded in `CLAUDE.md` |
| `Written for this posting` / `pass N` | `qc/assets.jsx` `AssetBlock` | **PRESENT (renamed)** | App: `From profile` + `loop 0` |
| `KEYWORDS PLACED` chips + `≈` variant mark | `qc/assets.jsx:34-52` (`KeyChip`) | **PRESENT, and stricter** | App: `KEYWORDS FOR THIS LINE` + chip + `proposed` + `not in this text`. The prototype asserts a keyword is *placed*; the app refuses to and says the term is model-**proposed** and whether it actually appears |
| `Claimed but not in the text: X` | `qc/assets.jsx` `AssetBlock` footer | **PRESENT (per chip)** | The `not in this text` marker above is the same claim, attached to the specific term |
| `POSTING LINES ANSWERED` chips | `qc/assets.jsx:151-165` (`ReqChip`) | **BETTER-THAN-PROTOTYPE** | App adds the class word (`RESP responsibility`), the sentence *"Written against the posting line cited above."*, and the employer's verbatim: `Posting says: "Modernize development practices through AI-assisted engineering"` |
| `Corrected for you` inline banner | `qc/assets.jsx` | **PRESENT** | `CORRECTED FOR YOU / Corrected: "15" rewritten as "multiple" in Resume summary. / why: … / the replacement was generalised…` |
| `CHANGES MADE` panel: **Undo** + **Suggest something different** | `qc/assets.jsx:92-150` (`EchoTrail`) | **PRESENT (renamed)** | App: **Undo** + **Change it** |
| List rows: `unchanged` / `→ new` | `qc/assets.jsx:282-299` (`FieldList`) | **BETTER-THAN-PROTOTYPE** | App adds attribution per item (`swapped · posting` vs `swapped · unattributed`), scope (`packet-level`) and the sentence *"Packet-level decision - this list was decided once for the whole packet, so it also applies to Resume."* — the prototype has no notion of a decision shared between two assets |
| `WORDING KEPT FROM THE POSTING` + **Reword it** / **Ask assistant** | `qc/assets.jsx:92-150` (`EchoTrail`) | **PRESENT but `not_applicable` here** | The check exists: `assetGate.js:190` `posting_wording_kept: 'Wording kept from the posting'` (with a comment recording it was read off `qc/assets.jsx:124`). Its state in this fixture is **`pass` for every asset**, so no row renders. Needs a fixture with a `warn`/`fail` `posting_wording_kept` to settle its rendering. **Not a gap** |
| Static block `Work experience` / `Header, education, certifications` + `Template · same in every packet` | `qc/assets.jsx:352-471` | **PARTIAL — a real gap** | The app HAS the static shape (`AssetBlocks.jsx:394` `if (shape === 'static')`, `:704` renders `Template · same in every packet`, `assetBlocks.js:180` `if (!row.generated) return 'static'`), but the API never emits a row for a non-placeholder field, so **the block is unreachable for work history / header / education**. Shape built, data absent |
| `Needs your answer` block on the asset (`Two must-haves live only in generated fields`) | `qc/evidence.jsx:66-91` (`OpenItems`) | **PARTIAL** | The check exists (`assetGate.js:186` `template_reach: 'Requirements no block can carry'`) and is in the fixture — state **`pass`** on every asset, so nothing renders. The **`open` severity itself is deliberately absent**, recorded at `assetGate.js:98-100`: *"`open` ('Needs your answer') is deliberately ABSENT. In the prototype it comes from OPEN_ITEMS — a separate list of questions each carrying its own `ask` — and the app has no such source."* |
| Per-asset legend (M1–M5 / D1–D4 / N1–N3) | `qc/assets.jsx:166-180` (`ReqLegend`) | **MISSING on the asset step** | The legend renders on the `jd` tab only. `KIND_LEGEND` is imported into `AssetBlocks.jsx:33` but the asset cards print the class word inline instead (`RESP responsibility`), which arguably removes the need |
| **Approve** / **Regenerate** | `qc/packet.jsx:215-276` | **BETTER-THAN-PROTOTYPE** | App **Approve** is `disabled` when `qcResult.gate === 'fail'` with `title="The checks block this asset - open QC to see what must be fixed."` (`PacketBuilder.jsx:307-311`). The prototype offers an Approve the server would refuse |
| Open the per-asset QC drawer **from the asset card** | `qc/packet.jsx:420` (`onOpenQC` on `ArtifactCard`) | **MISSING** | `PacketBuilder.jsx:15` imports **only** `{ GateBadge }` from `AssetGateDrawer.jsx`; the drawer itself is mounted at `QcRail.jsx:908` (QC step) and `Packets.jsx:156` — **not on the asset step**. The card's `<GateBadge … compact />` (`:186`) has no `onClick`. So `Original vs final`, `Independent review` and `Match` for one asset are unreachable from the step where you are editing it |
| Per-asset QC drawer, 5 tabs | `qc/evidence.jsx:390-447` (`QCDrawer`: Fields / Checks / Swaps / Reviewer / Match) | **PRESENT** | `AssetGateDrawer.jsx:123-129` `TABS = Blocks & provenance / Checks / Original vs final / Independent review / Match` — 1:1, renamed |
| Assistant panel | `qc/assist.jsx:22-123` (`Assist`, docked, `Assistant · 1`) | **MISSING** | Sweep of `app/src` for `assist` returns `AssetBlocks.jsx` (a comment), `Call.jsx` (the voice coach, a different screen) and `postingAnalysis.js` (a comment). No docked packet assistant exists |
| **Auto-optimize resume** | `qc/packet.jsx:335` | **MISSING** | `grep -rniE "auto.?optim" app/src/ api/src/` → no matches |

## 2.3 One label oddity worth naming

The **Portfolio** card renders a field titled **"Letter body"** carrying `@CoverLetterBody`. That is
correct per `TEMPLATE_META.portfolio.placeholders` (which genuinely includes `@Company`,
`@CoverLetterDate`, `@CoverLetterBody`), so it is not a wiring bug — but a portfolio one-pager
showing "Dear Leadership Team, …" under a heading called *Letter body* reads as a mistake to a user.
Cosmetic, and it is a naming problem in `FIELD_LABEL`/the template, not in the render.

## 2.4 HOW CLOSE ARE THESE PAGES TO FUNCTIONAL

**The job, in one sentence:** read the draft field by field, see what the posting drove and what the
run corrected, ask for changes, and approve it — or send it back to be regenerated.

- **Can a user complete it end to end?** **Yes for `resume`, `cover`, `portfolio`.** Every control
  on the card does something real: **Show original**, **List Tweaks** (per field and per asset, both
  posting to `api.aiEditArtifact`), **Undo** / **Change it** on a correction, **Create Google Doc** /
  **Create Slides deck**, **Approve** (correctly disabled on a blocked gate, with the reason in the
  tooltip), **Regenerate** (which collects a steering note first — `regenerateWithNote`), and
  **go to the draft ->** deep links from findings. No dead UI was found on these three steps.
- **`video` — I got this wrong on the first read and corrected it by driving the state.** The
  fixture's video artifact is `status: 'todo'` with no `content`, which is why the tab renders 724
  bytes. I re-rendered against `/tmp/fx-video.json` (identical except `status: 'review'` plus a
  two-line script) and the step came back with the script rendered, prefaced by
  *"This draft has no per-field record, so it is shown as it was stored."*
  (`AssetBlocks.jsx:995-1005`, the `fallback` branch, which the comment at `:918-921` says exists
  precisely because *"the intro video has no merge fields"*), plus **List Tweaks**, **Approve**,
  **Regenerate** and **🎥 Generate clone video**. So the video step **is** a working review surface
  once a script exists. What it does NOT have — and cannot, since `TEMPLATE_META` has no `video`
  entry — is per-field provenance, keyword chips or posting-line attribution.
- **What is DEGRADED on `video`:** its gate is `Not checked`, and **Approve is offered anyway**.
  `gateBlocks` is `qcResult.gate === 'fail'` (`PacketBuilder.jsx:280`), so a null gate leaves the
  button live; the code comment at `:302-306` records this as deliberate — *"`unchecked` is NOT
  blocked here: the server refuses it too, but 'run the checks' is a different sentence from 'fix
  these findings' and the drawer is where that is said."* **But the drawer is not reachable from
  this step** (§2.2), so on the one asset that is never checked, the button that will be refused is
  live and the explanation for the refusal is two navigations away.
- **What is DEGRADED, all four:** the per-asset QC drawer is unreachable from the asset card
  (§2.2 last-but-two row). The gate badge states a verdict and offers no way to inspect it here.
- **Cosmetic only:** the per-asset legend, the "Letter body" heading on the portfolio, the missing
  must-have/keyword ratio in the asset header.
- **VERDICT:** `resume` / `cover` / `portfolio` — **`FUNCTIONAL`**.
  `video` — **`FUNCTIONAL WITH GAPS`** (works once a script exists; no provenance, and it offers an
  Approve the server will refuse with no on-screen way to learn why).
- **Highest-value next fix:** make the asset card's `GateBadge` open `AssetGateDrawer` — the
  component, its five tabs and its `focusField` deep-link all already exist and are mounted two
  screens away. One prop.

---

# TAB 6 — `qc` · QC & evidence

## 6.1 What actually rendered

`bodyLen 78,767`, zero page errors — by far the richest tab. Five sub-tabs, each driven and read:

| Sub-tab | Command | What came back |
|---|---|---|
| **Coverage** (default) | `--route …/qc --settle 4000` | 3 coverage cards: `Requirements · must have 1/13` (one `closed`, twelve `open`, each with the employer's line), `Requirements · nice to have **not measured**` with *"no check measures nice-to-have coverage — the engine judges must-haves and responsibilities only, so this is unmeasured rather than zero"*, `Responsibilities 0/21` |
| **Original vs final** | `--click 'Original vs final'` | *"Packet-level: one row here covers every asset built from this packet. 29 decision(s), 0 citing no line of the posting."* + a 4-column table `Original / Final / What happened / Why` × 29 rows, each `kept` or `swapped`, each with either the posting's verbatim or *"no line of the posting backs this change"* |
| **Remediation loops** | `--click 'Remediation loops'` | *"The remediation ledger has not been loaded for these assets, so this falls back to the pass record every asset has — insertion.loop… This is not the same as saying no remediation has run."* + per-asset `1 generation pass(es)`. **This is the honest fallback firing because `/remediation` is unfixtured** (§A) |
| **Checks** | `--click 'Checks'` | Per asset: *"11 to fix from the measured rules. 4 check(s) had nothing to test against and are not counted in either number - that is not a pass."* + each finding with `what we saw:` / `what it should be:` / offender rows, each offender either a **`go to the draft ->`** button or an inert row stating why it cannot open (`this finding spans two fields, so it does not open one of them`; `this finding names no merge field, so there is nothing to open`; `this is a posting requirement, not a field of the document`) |
| **Independent review** | `--click 'Independent review'` | *"A reviewer disagreement can ask for a decision, but it can never block an asset on its own - only the measured rules do that."* + per asset *"The independent reviewer has not run for this asset. Nothing here has been second-guessed."* |

Above the sub-tabs: `Blocked` · *"1 asset(s) have never been checked - that is not a pass"* ·
**52 to fix / 0 to review / 1 never checked / 2 corrected for you** · a paragraph explaining why
those four numbers are never added together · a per-asset strip · a `MATCH` block reading
*"Resume only - there is no packet-wide score, and averaging the assets would invent one"* and
*"No overall number was stored for this run."* · **Done for you** (per-asset change log with
**Undo** / **Change it** / **Review →**, and for the video *"The checks have not been run for this
asset, so there is no change log. That is not the same as nothing needing correction."*) ·
**Needs a decision**.

## 6.2 Present / Missing / Degraded

| Prototype element | Prototype `file:line` | App status | Evidence |
|---|---|---|---|
| Five QC sub-tabs | `qc/evidence.jsx:328-334` — `Coverage / Swaps / Passes / Checks / Review` | **PRESENT (renamed 1:1)** | App: `Coverage / Original vs final / Remediation loops / Checks / Independent review`, all five driven above |
| Per-asset header rows with gate | `qc/evidence.jsx:16-25` | **PRESENT** | `Compact resume Blocked 11 to fix 4 counted`, … `Intro video Not checked 0 counted` |
| `MATCH 97 / WARN` + 3 score parts (Requirements 100 · Keywords 92 · Seniority fit 96) | `qc/evidence.jsx:26-65` (`Bar`, `ScoreBlock`) | **PRESENT but `not_applicable` here** | The three parts exist as `must_have_source` / `keyword_source` / `seniority_source` (proved by `app/test/browser/run-qc-rail.mjs:48-56`, which drives exactly those keys). This packet's `score` is `null`, so the app prints *"No overall number was stored for this run."* rather than a composite. **Never fabricate a composite** — correct behaviour |
| **Done for you** — N corrections, `Change it` / `Review →` | prototype QC step | **BETTER-THAN-PROTOTYPE** | App adds **Undo** (a real `POST /correction/{id}/revert`), and distinguishes *"Nothing needed correcting: this run reported a change log and it is empty"* from *"The checks have not been run for this asset, so there is no change log."* The prototype has one state |
| **Needs a decision** with severity words | `qc/evidence.jsx:92-122` (`AttentionList`), prototype uses `Fix before approval` / `Needs your answer` / `Review` / `Your call` | **PARTIAL** | App `SEV_LABEL` (`assetGate.js:102-107`) has `fix` / `review` / `soft: 'Your call'` / `fixed: 'Corrected for you'`. **`open` ('Needs your answer') is deliberately absent** with the reason recorded in the same file at `:98-100` — the prototype's `OPEN_ITEMS` question list has no counterpart data source in the app. So the **Answer / Leave open** open-question workflow is genuinely MISSING, and the blocker named is the data, not the UI |
| `Open field →` / `Open asset →` from a finding | prototype `AttentionList` | **PRESENT** | App: **`go to the draft ->`**, and — better — the rows that CANNOT resolve are rendered inert **with the reason**, rather than as a button that lands nowhere |
| Coverage: Responsibilities / must-have / nice-to-have | `qc/evidence.jsx:123-196` (`CoverageView`) | **PRESENT** | 3 cards, above |
| Coverage: **Keywords card** with library version (`ENG-LEAD v4`) + per-term `N×` placement | `qc/evidence.jsx:123-196` | **MISSING — data-blocked** | `qcRail.js:716-718` defines exactly three classes (`must_have`, `nice_to_have`, `responsibility`); there is no keyword class. Sweep: **220 `app.http(...)` routes registered in `api/src`**, and the only term routes are `app/qc/terms/mine`, `app/qc/terms/candidates`, `app/qc/terms/candidate/{id}` (`termMiner.ts:223-225`) — **no per-asset term-placement route exists.** `AssetBlocks.jsx:20-24` records the same fact: *"`term_library_entry` has no published scoreable rows … and there is no per-asset term-placement endpoint"* |
| Swaps table | `qc/evidence.jsx:197-246` (`SwapsView`) | **BETTER-THAN-PROTOTYPE** | App's `Original vs final` names it packet-level, counts the unattributed (`0 citing no line of the posting`), and prints the employer's verbatim as the `Why` |
| Passes view | `qc/evidence.jsx:247-265` (`PassesView`) | **PARTIAL** | App `Remediation loops` renders, but on the ledger's **fallback** path and says so. Its populated state is `not_applicable` here — `/artifact/{id}/remediation` is unfixtured (§A) |
| Reviewer view | `qc/evidence.jsx:291-327` (`ReviewerView`) | **PRESENT** | Renders the never-ran state distinctly and states the D6 rule that a reviewer can never block |
| Per-asset QC drawer | `qc/evidence.jsx:390-447` | **PRESENT** | `QcRail.jsx:908` mounts `AssetGateDrawer` with all five tabs |

## 6.3 HOW CLOSE IS THIS PAGE TO FUNCTIONAL

**The job, in one sentence:** find out whether this packet may be sent, see every reason it may not,
and get to the field that fixes each one.

- **Can a user complete it end to end?** **Yes.** Every finding is named, counted, attributed to an
  asset and a merge field, and reachable via **go to the draft ->**. Every unresolvable finding says
  why it is unresolvable instead of pretending. Corrections can be reverted from here. All five
  sub-tabs render real content from stored data.
- **What BLOCKS completion:** nothing. Two things are *unmeasurable rather than missing* — the
  Keywords coverage card (no term-placement route among 220 registered routes; no published
  scoreable term-library rows) and the reviewer verdict (never run for these assets). Both are
  stated as unmeasured, which is the correct answer.
- **Cosmetic only:** the sub-tab renames.
- **VERDICT: `FUNCTIONAL`.** This is the strongest tab in the module and, on the evidence above, is
  ahead of the prototype on every state that involves absent evidence.
- **Highest-value next fix:** fixture `/artifact/{id}/remediation` so the Remediation loops tab can
  be measured at all; today it can only ever be seen in its fallback.

---

# TAB 7 — `send` · Review & send

## 7.1 What actually rendered — and the defect it exposes

`bodyLen 826`. Five asset rows, each reading **`not loaded`** next to its status pill, then a green
card reading **"Nothing blocks sending."**, then *"Approve all artifacts above to unlock sending."*

DOM probe (`/tmp/pw/render-app-probe.mjs`, same fixtures, `--settle 4500`):

```json
{ "sendGate": { "count": "0", "assets": "0", "text": "Nothing blocks sending." },
  "failRows": 0,
  "gates": ["not loaded","not loaded","not loaded","not loaded","not loaded", …] }
```

**Disconfirming test run:** re-rendered at `--settle 12000` in case this was a fetch race.
Identical output — `count 0`, `assets 0`, five `not loaded`. It is not a race.

## 7.2 DEFECT — the Review & send gate is vacuous. Two symptoms, one cause.

`useQcEntries` returns entries shaped `{ artifact, label, result, resultLoading, … }`
(`QcRail.jsx:100-116`). **There is no `artifactId` key and no `id` key on an entry.** Two consumers
read one:

```js
// app/src/screens/PacketBuilder.jsx:950   — the Review & send asset rows
<GateBadge result={(qcEntries.find((e) => e.artifactId === a.id) || {}).result} compact />

// app/src/qcRail.js:928                   — packetFailList(), which fills the send gate card
const artifactId = e && (e.artifactId || e.id)
...
if (!artifactId) continue
```

`e.artifactId` is `undefined` for every entry, so:

1. the `.find()` never matches → `GateBadge` receives `undefined` → **every asset row on this step
   renders `not loaded`, permanently, whatever the real gate is**;
2. `packetFailList` skips **every** entry at its `continue` → `{ items: [], count: 0, assets: 0 }` →
   the step **always** says **"Nothing blocks sending."** on a green rail, for every packet, no
   matter what the checks found.

**This is a cross-surface contradiction on the same data.** With identical fixtures, on the same
packet, in the same session: the **QC tab** says `Blocked`, `52 to fix`, `1 asset never checked`;
the **Send tab** says `Nothing blocks sending.` The repo's own standing rule — *"Counts on Today vs
Swipe vs Pipeline vs Opportunities must reconcile because they read the same funnel"* — is violated
here, and it fails **open**: the vacuous side is the permissive one. The comment above the card
(`PacketBuilder.jsx:964-975`) describes exactly the behaviour that is not happening: *"Counted from
the live checks, not from the stored status"*, and *"ONE ROW PER FAILING ITEM, each with a way to
reach it. A count with no rows tells the reader they are blocked and leaves them hunting."*

**Fix, one line:** add `artifactId: a.id` to the object `useQcEntries` builds at `QcRail.jsx:104`
(which also satisfies `packetFailList`'s existing `e.artifactId || e.id` read), or change
`PacketBuilder.jsx:950` to `e.artifact.id` **and** pass entries to `packetFailList` in a shape it can
read. The first is better — it fixes both call sites at the source, and it is the shape
`packetFailList` and the `run-qc-rail.mjs` probe fixtures already assume.

**Mutation note:** I did not mutation-prove a guard because I wrote no guard — the brief forbids
editing anything but this report. The evidence is the rendered DOM plus the two source reads, and
the negative control is the `--settle 12000` run.

## 7.3 Present / Missing / Degraded

| Prototype element | Prototype `file:line` | App status | Evidence |
|---|---|---|---|
| Per-asset row: label + gate + status | `qc/packet.jsx:429-478` | **PARTIAL — degraded** | Rows render; the gate is permanently `not loaded` (§7.2) |
| Per-asset score (`97 · 3 to review`) | `qc/evidence.jsx:16-25` | **MISSING here** | The app has no composite; the finding count would come from the same broken `.find()` |
| Blocking summary (`1 item to fix across 1 asset`) | `qc/packet.jsx:429-478` | **BUILT BUT VACUOUS** | The string, the plural handling, the red/green rail and `data-qc-count` are all implemented at `PacketBuilder.jsx:967-981` — and always evaluate to 0 |
| *"Sending stays locked until each one is fixed or the decision is recorded."* | prototype send step | **UNREACHABLE** | Rendered only when `failList.count > 0`, which never happens |
| One row per failing item + **Open field →** | prototype send step | **UNREACHABLE** | `failList.items.map(...)` at `:983-999` — implemented, including `goToField`, and never iterates |
| Unlock/handoff control | *not in prototype* | **PRESENT** | App adds **Go to outreach →** (`go('/compose/'+id)`), gated on `ready` (all artifacts approved). That gate reads artifact **status**, not `qcEntries`, so it is unaffected by §7.2 and correctly showed *"Approve all artifacts above to unlock sending."* |

## 7.4 HOW CLOSE IS THIS PAGE TO FUNCTIONAL

**The job, in one sentence:** confirm every asset is approved and nothing outstanding blocks the
packet, then hand off to outreach.

- **Can a user complete it end to end?** **Only by accident.** The approval half works: the five
  statuses are real and **Go to outreach →** is correctly withheld until all are approved.
- **What BLOCKS completion:** nothing blocks the *user*. What is broken is the opposite — the step
  fails open. A reader is told **"Nothing blocks sending."** on a packet the QC step calls `Blocked`
  with 52 findings and an asset that was never checked. Every gate badge reads `not loaded`, so there
  is no second signal to catch it.
- **Cosmetic only:** the missing per-asset score.
- **VERDICT: `NOT FUNCTIONAL`** — not because controls are missing, but because the one statement
  this page exists to make is computed from a lookup that never matches, and the wrong answer it
  gives is the permissive one.
- **Highest-value next fix — and the highest-value fix in the whole module:** add `artifactId: a.id`
  to the entry object at `QcRail.jsx:104`.

---

# UX FUNCTIONS — not just components

## Does every control DO something? (the no-dead-UI standing rule)

Interactive elements counted in the rendered DOM
(`button, [role="button"], a[href], select, textarea, input`):

| Tab | jd | resume | cover | portfolio | video | qc | send |
|---|---:|---:|---:|---:|---:|---:|---:|
| controls | 13 | 69 | 24 | 33 | 10 | 110 | 6 |

**Stub sweep:** `grep -rnE 'onClick=\{\(\) => (toast|alert|console)'` across `PacketBuilder.jsx`,
`AssetBlocks.jsx`, `QcRail.jsx`, `PostingAnalysis.jsx`, `AssetGateDrawer.jsx` → **no matches.**
No `onClick={() => toast('...')}` stubs exist in the packet module.

Controls I drove and confirmed do something, by clicking them in the rendered app:
`model estimate · keywords ↗` (opens the keyword tally overlay, §1.3), `QC & evidence` on the step
rail (navigates from step 1 to step 6 and the QC content loads), and all four non-default QC
sub-tabs. Controls whose handler I read but did not click: **List Tweaks** →
`api.aiEditArtifact(id, {instruction, section?})`, **Undo** →
`POST /correction/{id}/revert`, **Approve/Reopen** → `api.setArtifactStatus`, **Regenerate** →
`regenerateWithNote` (writes the note, awaits it, *then* generates — order enforced deliberately),
**go to the draft ->** → `goToField(artifactId, section)`, **Build entire packet** →
`api.queueFullPacket` + a poll.

**Two controls do nothing useful, and both are the §7.2 defect**, not stubs: the Review & send gate
card and its five gate badges are wired to a lookup that never matches.

## Can you get into and out of every step?

Yes. The step lives in the route (`#/packet/:id/:step`, `PacketBuilder.jsx:404-412`), so every one of
the seven is directly addressable — proved by rendering each from its own URL. Each step also carries
a forward control (`Next: Resume →` … `Next: Review & send →`) and the rail circles navigate
(clicking `QC & evidence` from step 1 loaded the QC step). `← Packets` exits the module. There is no
step whose content is unreachable.

## Are empty / loading / error states distinct?

This is where the app is furthest ahead of the prototype, and I drove each state rather than reading
for it:

| State | Driven with | What rendered |
|---|---|---|
| **Error** (packet endpoint returns `{error}`) | `/tmp/fx-err.json` | *"Could not reach the service layer"* + the server's own words, *"packet not found for this owner"* |
| **Never measured** vs **measured zero** | stock fixtures | `Requirements · nice to have` → **`not measured`** + *"no check measures nice-to-have coverage — the engine judges must-haves and responsibilities only, so this is unmeasured rather than zero"*, beside `Responsibilities 0/21` which IS a measured zero |
| **Never checked** vs **clear** | stock fixtures | `Intro video · Not checked · 0 counted`, and the packet headline *"1 asset(s) have never been checked - that is not a pass"* |
| **Empty change log** vs **no change log** | stock fixtures | *"Nothing needed correcting: this run reported a change log and it is empty"* vs *"The checks have not been run for this asset, so there is no change log. That is not the same as nothing needing correction."* |
| **Ledger absent** vs **no remediation ran** | `/remediation` unfixtured | *"The remediation ledger has not been loaded for these assets, so this falls back to the pass record… This is not the same as saying no remediation has run."* |
| **Unresolved comparison** vs **loading** | `/tmp/fx-unresolved.json` | *"This posting has not been compared to your profile yet. Nothing has been measured - which is not the same as nothing matching."* |
| **No posting text** | stock fixtures | *"No posting text and no summary are stored for this opportunity."* |
| **Null composite** | stock fixtures | *"No overall number was stored for this run."* — no number invented |
| **Offender that cannot be opened** | stock fixtures | three distinct reasons rendered inert rather than as a dead button |

The prototype has none of these distinctions — `qc/data.js` is one populated happy path.

## Is anything rendered as live data actually hardcoded?

**No.** `grep -rniE "safetyiq|von roberts|kylie brandt|FedRAMP|ENG-LEAD" app/src/` → **no matches**;
every one of those is prototype demo data that never entered the app. Every number I saw on screen
traced to a fixture key that traces to a production row. Check thresholds are read from the owner's
settings row rather than baked in (`AssetBlocks.jsx:939-948` — *"`searchPrefsGet().checks` is the
same row Settings writes - one source, so changing 24 to 30 there changes what this screen
promises"*), and the JD keyword-list layout is a persisted user preference. Both satisfy the
no-hardcoded-config rule.

---

# SUMMARY TABLE

MISSING = no counterpart exists and none is data-blocked. Rows scored `PARTIAL` because the fixture
could not reach the state are **excluded** from the MISSING count and named in the last column —
absent evidence is `not_applicable`, never a gap.

| # | Tab | Verdict | MISSING | What is missing | Highest-value next fix |
|---|---|---|---:|---|---|
| 1 | `jd` Posting analysis | **FUNCTIONAL** | **1** | `Auto-optimize resume` (duplicates Build/Regenerate) | Emit `comparison` from `build-fixtures.mjs` so the tab's main panel can be measured locally at all |
| 2 | `resume` | **FUNCTIONAL** | **3** | per-asset legend; open the QC drawer from the asset card; docked assistant | Give the card's `GateBadge` an `onClick` that opens `AssetGateDrawer` — the component and its 5 tabs already exist, mounted two screens away |
| 3 | `cover` | **FUNCTIONAL** | **3** | same three as `resume` | same |
| 4 | `portfolio` | **FUNCTIONAL** | **3** | same three as `resume` | same (plus rename the `@CoverLetterBody` heading inside a portfolio) |
| 5 | `video` | **FUNCTIONAL WITH GAPS** | **3** | same three; **plus** no per-field provenance at all — `TEMPLATE_META` has no `video` entry, so `mergeFieldsFor('video') === []`. The prototype's video step is equally bare | Stop offering **Approve** on an asset whose gate is `null`, or make the "run the checks" sentence reachable from this step |
| 6 | `qc` QC & evidence | **FUNCTIONAL** | **2** | Coverage tab's **Keywords** card (data-blocked: no per-asset term-placement route among 220 registered routes); the **Answer / Leave open** open-question workflow (data-blocked: no `OPEN_ITEMS` source — recorded at `assetGate.js:98-100`) | Fixture `/artifact/{id}/remediation` so Remediation loops can be seen outside its fallback |
| 7 | `send` Review & send | **NOT FUNCTIONAL** | **1** | per-asset composite score. *Nothing else is missing — the blocking summary, the fail rows and **Open field →** are all implemented and never execute* | **`artifactId: a.id` on the entry object at `QcRail.jsx:104`** — one line, fixes both the five `not loaded` badges and the vacuous "Nothing blocks sending." |

## Answering the owner's question directly

> *"what ui components / ux functions are still missing? how close is each page to being functional?"*

**Missing UI components across the whole packet module: seven distinct ones**, and only three of them
are ordinary build work —

1. a way to open the per-asset QC drawer **from** the asset card (the drawer exists, with all five
   tabs; it is just not mounted on that step);
2. the per-asset requirement **legend** on asset steps;
3. the **docked assistant** panel (`qc/assist.jsx`);
4. `Auto-optimize resume` — arguably shouldn't be built, it duplicates Build/Regenerate;
5. the Coverage tab's **Keywords** card — **blocked on data**, not UI;
6. the **Answer / Leave open** open-question workflow — **blocked on data**, not UI;
7. a per-asset **composite score** — deliberately absent; the app refuses to fabricate a composite.

**Six of the seven pages are functional.** The module is in far better shape than an element count
would suggest: on every state that involves *absent* evidence — never checked, not measured, no
change log, unresolved, null composite, an offender that resolves to nothing — the app is **ahead of
the prototype**, which has no vocabulary for any of them.

**The one thing that is actually broken is the last page, and it fails open.** `Review & send`
tells the reader **"Nothing blocks sending."** on a packet its own QC step calls `Blocked` with 52
findings and one asset never checked, and all five of its gate badges read `not loaded`. The cause is
a key that does not exist on the object being searched (`e.artifactId`, `QcRail.jsx:100-116` vs
`PacketBuilder.jsx:950` and `qcRail.js:928`), it survived a 12-second settle, and the fix is one
line.

---

## Caveats on this measurement

- **Rendered locally**, never live. The sandbox cannot reach `*.azurestaticapps.net` or
  `azurewebsites.net`. Everything above is `app/dist` served over localhost with `/api/**` fulfilled
  from `docs/qc-evidence/fixtures.json` (real production rows) plus five hand-built variants in
  `/tmp` used to drive states the stock fixture cannot reach.
- **Counts are upper bounds.** `build-fixtures.mjs:56` omits the `run_id` filter the real endpoint
  applies (`appChecks.ts:257`), so every check row appears twice locally. Shapes are unaffected.
- **Three states could not be reached and are recorded as `not_applicable`, not as passes:**
  the resume-template picker (needs `/config/templates` with ≥2 rows), the Remediation loops tab in
  its populated form (needs `/artifact/{id}/remediation`), and `posting_wording_kept` /
  `template_reach` in a non-`pass` state (needs a fixture where those checks fail or warn).
- **Nothing outside this file was modified.** Temporary harness variants live in `/tmp/pw/` and are
  thin copies of `scripts/render-app.mjs` and `scripts/render-spec.mjs` with a body-text dump, a
  click driver and a DOM probe added.

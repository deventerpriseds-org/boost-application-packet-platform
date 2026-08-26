# RENDER-COMPARE-PACKET.md

**Task:** Render the Executive Engine app LOCALLY (never "live" — the sandbox cannot reach
`*.azurestaticapps.net` or `azurewebsites.net`) and compare it TAB BY TAB against the rendered
prototype, for the PACKET MODULE only.

**Owner's question (verbatim):** *"what ui components / ux functions are still missing? how close is
each page to being functional?"*

**Branch:** `claude/three-small-ui-gaps` (== `main` at `028fdec`)
**Started:** 2026-08-26
**Status:** IN PROGRESS — appended incrementally as evidence arrives.

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

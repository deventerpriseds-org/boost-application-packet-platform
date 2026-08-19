# Packet QC & evidence layer — build spec

Handover spec for implementation. Written to be read by a developer (or Claude Code) with no
prior context on the prototype.

- Runnable reference: `Packet QC Prototype.html` (open it; it needs no build step)
- Source of every behavior described here: `qc/*.jsx` + `qc/data.js`
- Screenshots of every view and overlay: `screens/` (see `screens/INDEX.md`)
- Prioritized work with acceptance criteria: `BACKLOG.md`
- Data-shape reference: `Evidence Model & QC Lineage.html`
- What the current zap does today: `Zap 289877647 Workflow Baseline.html`

The prototype is a UI spec. It changes no prompts, no templates and no merge fields. Every field
it shows is a field the zap already populates.

---

## 1. Problem

The pipeline runs 16 silent QA checks and rewrites the candidate's stored words to match a
posting. Today none of that reaches the screen: the packet builder shows one collapsed draft
string, an ATS percentage, and a keyword list that is always empty because the API never returns
`missingKw`. The user cannot tell what was swapped, why, whether the posting drove it, or whether
the finished asset actually answers the ad.

This layer makes the run auditable and correctable without making the user do the pipeline's job.

---

## 2. Ground rules

These are decisions, not preferences. They constrain every screen below.

**R1 — Correct, then report.** Anything the system can fix, it fixes before the user sees it, and
records the fix. The user reviews a change log, not a to-do list. Framing is finished
("Corrected", "Changes made"), never pending ("needs fixing"). Only what genuinely cannot be
settled without the user appears as an open item.

**R2 — Evidence or escalate.** A requirement is "evidenced" only if a verbatim excerpt from the
stored profile can be shown next to it, with its source named. Nothing is written that the profile
cannot support; unsupported requirements are escalated as questions and the score stays honest.

**R3 — The posting's own figures never appear in the candidate's words.** `$18M`, `60+`,
`three business units`, `400+ industrial operators` and the like are the employer's numbers, not
evidence. They are rewritten automatically — with the candidate's own figure from the profile
where one exists, otherwise generalized — and each rewrite is logged and revertible. Reworded
(non-numeric) phrasing that echoes the ad is a softer case and stays a user judgement call.

**R4 — One source per number.** Any two counts describing the same population must be computed
from the same list with the same filter. Fixes and reviews are always counted separately and
labelled ("1 to fix · 3 to review"), never merged into one ambiguous number.

**R5 — Every count deep-links.** A badge that says "1 to fix" opens the exact field it refers to,
scrolls to it and outlines it. No number is a dead end.

**R6 — Ad-hoc correction over batch approval.** The user should be able to change anything they
happen to notice, in place, scoped to the field they are looking at — not only the items the
system flagged.

**R7 — Identifiers are always spelled out.** `M3` alone is meaningless; it always renders with its
kind and competency (`M3 · Platform modernization`) and a legend is present
(`M1–M5` must-have, `D1–D4` responsibility, `N1–N3` nice-to-have).

---

## 3. Information architecture

One screen — the packet builder — with a step rail:

```
1 JD analysis · 2 Resume · 3 Cover letter · 4 Portfolio · 5 Intro video · 6 QC & evidence · 7 Review & send
```

Step 6 is new. Everything else is the existing app plus the evidence layer inside it.

Overlays and off-page surfaces (all captured in `screens/`):

| Surface | Trigger | Screens |
|---|---|---|
| ATS analysis modal | click the header "ATS Match 92%" | 08 |
| Per-asset QC drawer (5 tabs) | any gate badge, or any "Open field →" | 39–43 |
| Keyword detail panel | click a keyword chip in a field margin | 17 |
| Inline "Ask for a change" | link on any field | 18 |
| Original / before text | "Show original" on any field | 12 |
| Assistant | docked column ≥ 1440px, else floating panel | 44 |
| Prototype-only mode bar | bottom pill: Current app / With QC layer / Highlight additions | 45–47 |

Responsive rules that are part of the spec, not incidental:

- Step rail: vertical list ≥ 1200px, horizontal chips below.
- Field blocks: content + 250px provenance margin ≥ 1080px, stacked below.
- JD extraction: tabbed (see §4.1). ATS keyword list: 2 columns ≥ 1040px, 1 column below.
- Assistant docks only ≥ 1440px so the content column keeps ~600px; below that it floats.
- Never a 2-column state for the requirement lists — 3 or 1 only (the old column layout is still
  in the code behind `PARSED_LAYOUT`).

---

## 4. Screens

### 4.1 JD analysis — extracted from this posting
`screens/01-jd-responsibilities.png` · `02-jd-requirements-must.png` ·
`03-jd-requirements-nice.png` · `04-jd-ats-keywords.png` · `05-jd-evidence-expanded.png`

Three tabs, each carrying its own count: **Responsibilities 4/4 · Requirements 7/8 ·
ATS keywords 12/13**. One list at a time; no side-by-side columns.

Each row (Responsibilities, Requirements):

- Left column: the posting line **verbatim**.
- Right column (150–210px): the requirement chip (`D2 Roadmap with Product`, pale grey fill,
  black text — this is context, not the headline) and beneath it either
  `evidenced — show the line` or `no evidence found` in red.
- Status dot: green covered, red open.
- Expanding a row shows the **verbatim profile excerpt** that evidenced it, its source
  (`Accomplishment 3 · stored library`, `Work history · VP Engineering, Resideo 2021–2025`), an
  optional supporting note, and `Where it is used →`.
- Requirements tab groups into MUST HAVE / NICE TO HAVE sub-headers, each with `n/m evidenced`.

ATS keywords tab: one row per library term — status dot, green (or red) term chip with black text,
`placed` / `nothing to place it on`, then the posting phrase it matched and
`answers M2 · appears 2× in the ad`. Footer names the library (`ENG-LEAD v4`, 1,840 terms, its
sources) and lists model-suggested terms that earn no score credit.

Legend row is always present.

**Acceptance:** every extracted line renders verbatim; every "evidenced" claim can be expanded to
a quote plus source; no requirement id appears without its competency; tab counts equal the row
counts inside.

### 4.2 JD analysis — posting vs your profile
`screens/06-jd-fit-cards.png` · `07-jd-compare-table.png`

Replaces the old counter strip ("6 of 12 posting lines · 3 passes"), which described the pipeline
rather than the comparison.

- Four fit cards: Responsibilities, Must-have requirements, Nice-to-have requirements, ATS
  keywords — each `n of m`, a graded verdict (Strong match / Moderate match / No evidence) and, if
  incomplete, what is missing by name.
- Comparison table, four columns: **Dimension · The posting asks for · Your profile evidences ·
  Fit**. Rows are the real dimensions (leadership tenure, organization size, budget owned,
  compliance ownership, platform modernization, cycle time, domain, public sector), each with the
  candidate's actual value and a note where the grade is qualified
  ("One programme, not a record across roles").
- Grading: covered/total ≥ 0.99 strong, ≥ 0.7 moderate, else weak. Fit is graded against the
  stored profile only — nothing has been written into an asset at this point, and the copy says so.

**Acceptance:** a first-time user can read this as a comparison without documentation; every
"moderate" carries the reason it is not strong.

### 4.3 ATS analysis modal
`screens/08-ats-analysis-modal.png`

Opened by clicking the header ATS Match score (the score is the affordance; a sub-label says
"Keywords & ATS terms →"). Contains the keyword tally, `12/13 placed`, "Auto-optimize resume",
and the QC summary (composite match, requirements / keywords / seniority bars, per-asset gate
rows). Nothing in this panel is duplicated on the page.

**Any navigation out of the modal closes it first** — "Open QC →" and the per-asset rows dismiss
the modal before switching step or opening the drawer.

### 4.4 Asset steps (Resume, Cover letter, Portfolio, Intro video)
`screens/09-resume-step-top.png` · `10-asset-header-expanded.png` · `19-cover-letter-step.png` ·
`20-cover-header-expanded.png` · `24-portfolio-step.png` · `27-intro-video-step.png`

Each artifact card: title, subtitle, gate badge (`97 · 3 to review`, `94 · 1 to fix · 3 to
review`), status pill, real buttons for **Open Google Doc ↗** / **Open Slides ↗** / **Copy tracked
link** (buttons, not text links, `nowrap`), then the asset's fields, then the action row
(Approve / Regenerate / Ask for a change, plus a deep-linking `n to fix — <title> →` button when
the gate blocks approval).

**Asset header — "What this <asset> answers"** is collapsed by default: one line reading
`4 corrected · 1 to fix · 3 to review · Show ▾`. Expanded it gives a plain-language summary
("Every must-have requirement is answered somewhere in this asset. 7 of 9 blocks were written for
this posting; the rest is template text you cannot change from the zap."), four counters
(must-haves / responsibilities / nice-to-haves / ATS keywords, each `n of m` scoped to this
asset), then the open items and an "Already corrected in this asset" group. Rows carry
`Go to field →`.

### 4.5 Field blocks
`screens/11-resume-summary-field.png` · `12-original-and-changes-made.png` ·
`13-skills-list-field.png` · `14-work-experience-static.png` · `15-ats-keyword-block.png` ·
`16-empty-merge-fields.png` · `21-cover-letter-body.png` · `22-cover-letter-body-lower.png` ·
`23-cover-letterhead-template.png` · `25-portfolio-accomplishments.png` ·
`26-portfolio-deck-skills.png`

One card per **merge field**, formatted the way the document formats it. Two columns: content left,
provenance margin right (250px).

Content column:

- Slot name, its live rule (`56 words · 55–60 words`, `longest 22 chars · ≤ 24 chars each`)
  computed from the string itself, and the real merge-field name in mono (`ResumeSummary`).
- Body, by field type: prose; list (`original → final` rows, `unchanged` where kept); pipe block
  (monospace); pick-list (checkbox list with the requirement each item answers, e.g. Core
  accomplishments — chosen from stored text, never rewritten).
- Keyword hits are highlighted **highlighter yellow** in the text; posting echoes are **pale tan**
  with an underline. Hovering a margin row highlights its phrase in the text and vice versa.
- `Show original` (present on every field, including static template blocks) and
  `Ask for a change`.

Margin column:

- Origin: `Written for this posting · pass 3`, `From profile`, or
  `Template · same in every packet`.
- Open/review items for this field (same place as every other field — never moved to the left
  column).
- `Changes made`: struck original → new wording, the reason, `Undo` and
  `Suggest something different`.
- `Keywords placed` chips (`≈` prefix = reworded rather than copied). Clicking one opens the
  keyword detail panel.
- `Posting lines answered`: requirement chips, green covered / red open.
- The prompt's own reason for the field, any keyword the field claims but does not contain, and
  `Wording kept from the posting` for non-figure echoes.

Static blocks (work experience, header/education/certifications, letterhead + signature, slide
layouts, the compact resume's empty `SkillsBullets1/2`) show their **actual template text** —
including the `{{merge field}}` placeholders so the user can see where merged text lands — and are
marked as template, with `Show original` behaving like every other block ("identical, template
text is not merged per packet").

### 4.6 Keyword detail panel
`screens/17-keyword-detail-panel.png`

Answers "what if I am not comfortable claiming this?". Shows match quality (Exact term /
Reworded / Loose — not scored), the posting phrase, the note explaining why the wording was
chosen, and what it displaced ("Took the place of **Agile Transformation** in Skills 1"). Actions:
**Put back "<original>"**, **Swap for another skill…** (from the profile's skill bank) + Swap, and
**Drop it, leave the line open** — each phrased as a request to the assistant that also states the
coverage consequence.

### 4.7 Inline "Ask for a change"
`screens/18-ask-for-a-change-inline.png`

Opens under the field, labelled `ASK FOR A CHANGE · RESUME SUMMARY`, with a textarea, `Scoped to
this field only.`, Cancel and Send. On send it confirms in place and forwards to the assistant.

### 4.8 QC & evidence step
`screens/28-qc-step-top.png` · `29-qc-done-for-you.png` · `30-qc-needs-a-decision.png` ·
`31-qc-needs-a-decision-lower.png` · `32-qc-coverage-tab.png` · `33-qc-swaps-tab.png` ·
`34-qc-passes-tab.png` · `35-qc-checks-tab.png` · `36-qc-reviewer-tab.png`

Header: composite match, must-have coverage, pass count, `n to fix, n to review`, and per-asset
gate chips.

Then two lists, **on the page, not behind a tab or a search**:

1. **Done for you** — "15 corrections already applied · change or revert any of them". Each row:
   `Corrected for you`, what changed (`"60+" rewritten as "62" in Relevant 2`), why, the asset, and
   `Change it` / `Review →`.
2. **Needs a decision** — "things the run could not settle on its own": fails first, then open
   questions, then reviews, then your-call items. Each row deep-links (`Open field →`) and
   questions offer `Answer`.

Below: five tabs — **Coverage** (posting line by line, click to expand where it is answered, with
the keyword tally beside it) · **Swaps** (every list item, original → final, the covering keyword,
the verbatim posting quote, the reason, Undo this / Ask why) · **Passes** (remediation loops: what
each pass closed, what remained, where it halted and why) · **Checks** (rules and reviewer checks
grouped by name, with observed vs target and named offenders) · **Review** (blind second model:
grade, agreement count, prompt version, citations, critique).

### 4.9 Per-asset QC drawer
`screens/39-drawer-fields-tab.png` · `40-drawer-checks-tab.png` · `41-drawer-swaps-tab.png` ·
`42-drawer-reviewer-tab.png` · `43-drawer-match-tab.png`

Right drawer over the current step. Header names the asset and repeats the gate badge. Tabs:
Fields · Checks · Swaps · Review · Match. Footer is driven by the asset's own item list:
`Approve` disabled + `3 to fix · <first title> · +2 more`, or `Approve with note` +
`n to review · records who approved and why`, or a plain `Approve`; plus `Ask for a change`.
Opening the drawer from a deep link scrolls to the target field and outlines it for ~2s.

### 4.10 Review & send
`screens/37-review-and-send.png` · `38-review-send-gate-list.png`

Per-asset list with gate badges and status pills, then the packet gate card derived from the live
fail list: `n items to fix across m assets`, "Sending stays locked until each one is fixed or the
decision is recorded", one row per failing item with `Open field →`. When the list empties the card
reads `Nothing blocks sending`.

### 4.11 Assistant
`screens/44-assistant-panel.png`

Docked right column ≥ 1440px (collapses to a card with an "Open assistant" button), floating panel
below that. Scope selector (This packet / This asset / My profile), quick actions (Put back an
original · Undo a swap · Shorten to fit · Say why · Keyword is wrong), and replies that list the
exact merge fields they would touch (`SkillsBullets2: Kubernetes → M&A Due Diligence`) with
Keep / Revert / Re-run QC and a caveat when a change will be reverted by the next run (omission
list). Every field-level action in the UI seeds this panel.

### 4.12 Prototype-only comparison mode
`screens/45-current-app-mode.png` · `46-current-app-mode-lower.png` ·
`47-qc-layer-highlight-off.png`

The bottom pill switches between **Current app** (the layer removed, with notes naming today's
bugs: empty `missingKw` chips, the invisible `todo` pill, the collapsed draft string, the parsed
requirements that are never read) and **With QC layer**, plus **Highlight additions**, which
outlines and labels everything that does not exist today. This is a review aid for the spec — do
not build it.

---

## 5. Data contracts

Shapes the UI needs. `qc/data.js` is the literal reference; `Evidence Model & QC Lineage.html`
carries the fuller model and weights. Field names below are the prototype's.

```
requirement       id (M1…/D1…/N1…), kind: must_have|nice_to_have|responsibility,
                  verbatim, competency, coverage: covered|open, pass, terms[],
                  evidence: { quote, source, extra } | null
ats_term          id, term, reqs[], source: library|model, freq, status: covered|inserted|open,
                  pass, match: exact|variant|loose|null, used, postingSays, note
section (field)   id, field (merge-field name|null), slot, type: text|list|pipe|select,
                  dynamic, edited, pass, rule, reqs[], terms[], before, after,
                  items[{orig, final, action, req, term, why} | {text, req, selected, blocked}],
                  why, sameAsBefore, missingTerms[], mirrors[]
swap              list, orig, final, action: kept|swapped|added, req, term, quote, why
check             a (asset), key, engine: rules|reviewer, sec, label, state: pass|warn|fail,
                  observed, expected, offenders[], soft, fixed
mirror            a, sec, slot, phrase, kind: figure|phrase, posting, fix, why
attention         id, sev: fail|open|warn|fixed|soft, asset, sec, title, detail, group, ask, req
verdict           grade, promptVersion, blind, agree, total, citations[{req,quote,claim}],
                  critique[{s,t}]
score             must, kw, sen, composite, open[]
```

Derivations that must not be duplicated in two places:

- `gate(asset)` = any fail → fail; else any warn → warn; else pass.
- Gate badge text and the asset header counters both read the asset's attention list with the same
  filters (fail / warn+open / soft / fixed). See R4.
- Word and character rules are computed from the strings themselves, so a check row can never
  disagree with the number rendered beside the field.
- Figure rewrites (R3) are applied to the rendered text; reverting one restores the ad's figure in
  place and flips that row to "Undone".
- Attention ordering: fail → open → warn → fixed → soft.

---

## 6. Component map

| UI element | Prototype component | File |
|---|---|---|
| Shell, step rail, mode bar | `DesktopShell`, `ProtoControls`, `Pill` | `qc/shell.jsx` |
| Extracted posting (tabs) | `ParsedBlocks` (`PARSED_LAYOUT`) | `qc/packet.jsx` |
| Posting vs profile | `ProfileCompare` (+ `matchRows`, `PROFILE_COMPARE`) | `qc/packet.jsx`, `qc/data.js` |
| Artifact card, ATS modal, steps | `ArtifactCard`, `PacketBuilderScreen` | `qc/packet.jsx` |
| Asset header / field blocks | `AssetHeader`, `AssetDocView`, `AssetBlock` | `qc/assets.jsx` |
| Highlighting | `Marked` + `mark.kw-mark` / `mark.echo-mark` | `qc/assets.jsx`, `Packet QC Prototype.html` |
| Change trail, undo | `EchoTrail` | `qc/assets.jsx` |
| Keyword options | `KeyChip`, `KeyDetail` | `qc/assets.jsx` |
| Requirement chips, legend | `ReqChip` (`quiet`), `ReqLegend` | `qc/assets.jsx` |
| Inline ask | `AskBox` | `qc/assets.jsx` |
| QC step, lists, tabs | `QCStep`, `AttentionList`, `CoverageView`, `SwapsView`, `PassesView`, `ChecksView`, `ReviewerView` | `qc/evidence.jsx` |
| Drawer | `QCDrawer` | `qc/evidence.jsx` |
| Gate badge, score block | `GateBadge`, `gateLabel`, `ScoreBlock` | `qc/evidence.jsx` |
| Assistant | `Assist` (`docked`) | `qc/assist.jsx` |

---

## 7. Copy rules

- Say what a number counts. "1 to fix · 3 to review", not "4 items".
- Finished framing for anything already done; pending framing only for what the user must decide.
- Name the profile ("your master profile"), name the library (`ENG-LEAD v4`), name the merge field.
- Reserve "ATS" for the keyword library and its coverage; requirements and responsibilities are
  posting analysis.
- No em-dash-heavy pipeline jargon in user-facing copy: "posting lines", "passes" and "distribution"
  are internal terms, not labels.

---

## 8. Out of scope in the prototype

Deliberately not built, and not to be inferred: authentication, the intake/profile editor (see
BACKLOG P6), template editing, the Google Docs/Slides render itself, the intro-video flow beyond
its card, mobile layouts below ~700px, and the Current app / Highlight additions comparison mode.

Prototype data is one worked example (SafetyIQ · Head of Engineering). Counts in the screenshots
are that example's, not fixtures to reproduce.

---

## 9. Build order

`BACKLOG.md` — P0 wiring bugs, P1 evidence spine, P2 checks and gate, P3 remediation loop,
P4 blind reviewer, P5 UI, P6 intake/profile, P7 pipeline hygiene, P8 the decisions in §2 of this
document. Each item there has acceptance criteria.

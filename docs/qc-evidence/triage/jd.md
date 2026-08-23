# Triage — `jd` step (proto "JD analysis" / app "Posting analysis")

Register section: `docs/qc-evidence/UI-GAP-REGISTER.md:73`.
Prototype ground truth: `docs/qc-evidence/qc/packet.jsx` (`PacketBuilderScreen` jd branch,
`ParsedBlocks`, `ProfileCompare`) + `docs/qc-evidence/qc/data.js`.
App under test: `app/src/screens/PacketBuilder.jsx` (jd branch, ~L542-645),
`app/src/screens/PostingAnalysis.jsx`, `app/src/postingAnalysis.js`.

Precedence: the prototype is behavioural ground truth for anything on screen.

Note on "already satisfied" STRUCTURAL rows: several register rows are real headings/labels that the
app **already renders** — the string diff caught them because the captured app state had no resolved
comparison (`comparisonState()` returns `unresolved`, which suppresses the table head and every fit
label). Those are marked ALREADY SATISFIED and are excluded from the close-first list.

### SafetyIQ · Head of Engineering
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:23` — `PACKET = { company: 'SafetyIQ', role: 'Head of Engineering', ... }`, rendered at `docs/qc-evidence/qc/packet.jsx:514` and again in the ATS modal header (`packet.jsx:296`).
- **App target:** n/a
- **Note:** The app renders the identical construction from live data at `app/src/screens/PacketBuilder.jsx:807` (`{p.company} · {p.role}`). Only the fixture's names differ.

### fail
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/data.js:574` — `PACKET_GATE`, rendered as the uppercase pill beside the header Match score at `docs/qc-evidence/qc/packet.jsx:523`.
- **App target:** `app/src/screens/PacketBuilder.jsx` header row (~L802-823) — extend the existing `packetGate(qcEntries)` + `railGateMeta()` pair that is ALREADY imported and used at L843, and render its `.word`/`.tone` through the existing `Pill` component that already sits there for "Ready to ship ✓". No new gate system: `GATE_META` (`app/src/assetGate.js:54`) already owns the vocabulary.
- **Note:** Today the packet gate reaches the header only as the QC step circle's COLOUR (`StepCircle tone=`), with no text anywhere — a colour-only gate signal a user cannot read. The word rendered would be `Blocked`, not `fail`; the app deliberately renames gate states (`GATE_META.fail.word = 'Blocked'`) and that deviation should stand.

### JD analysis
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate rename)
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:310` — `STEPS[0].label = 'JD analysis'`.
- **App target:** `app/src/screens/PacketBuilder.jsx:34` — existing `STEPS[0] = { key: 'jd', label: 'Posting analysis', ... }`.
- **Note:** The step exists with the same key and position; the label was deliberately changed under the P5.4 naming rule (the comment at L32-33 states it). No work.

### from email
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:365` — a hardcoded `<Pill tone="accent">from email</Pill>` beside "Extracted from triggering email".
- **App target:** n/a
- **Note:** The app already renders this exact pill at `app/src/screens/PacketBuilder.jsx:548`, but only when `opp.source === 'LinkedIn'`; the captured opportunity had a different source, so the literal string was absent. Data state, not a gap.

### Extracted from this posting
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate rename)
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:157` — `ParsedBlocks` card heading.
- **App target:** `app/src/screens/PostingAnalysis.jsx:432` — existing `PostingAnalysisCard` heading "Posting analysis - the source" plus its provenance strip (`{req.total} lines extracted · {req.located} located in the posting text`).
- **Note:** Same card, same job, stronger wording — the app's version also states how much of the employer's text was located, which the prototype's heading does not. No work.

### 12/13
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:311-313` (`TABS` counts, `cov(rows)`) and `packet.jsx:69,78` (`Sub`/`Head` "n/d evidenced"), computed over the `REQUIREMENTS[].coverage` fixture at `docs/qc-evidence/qc/data.js:47-77`.
- **App target:** n/a
- **Note:** The literal figure is the fixture's covered/total. The app shows a bare total per tab plus a `kind_source` split (`summarizeKindSource`, `PostingAnalysis.jsx:263-282`) and puts evidenced-vs-total on the QC step instead (`coverageCards()`, `app/src/qcRail.js:576`, three cards each with its own closed/total). That placement is a deliberate app decision, and `api/src/functions/tests/appRequirements.ts:136-138` is explicit that `requirement.coverage` does NOT mean "evidenced" — so reprinting an n/d here would restate a column that means something else.

### M1–M5
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:47-56` — `REQUIREMENTS[].id` for `kind: 'must_have'`, rendered by `ReqChip` in `ParsedBlocks` (`packet.jsx:44`).
- **App target:** n/a
- **Note:** Fixture ids. The app renders an equivalent stable per-line handle from live rows — `KIND_ABBR[r.kind] + '#' + r.seq` → `MH #1` (`app/src/screens/PostingAnalysis.jsx:220-222`, `app/src/postingAnalysis.js:161`).

### D1–D4
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:57-64` — `REQUIREMENTS[].id` for `kind: 'responsibility'`.
- **App target:** n/a
- **Note:** Same as M1–M5; the app's equivalent is `RESP #n`.

### N1–N3
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:65-77` — `REQUIREMENTS[].id` for `kind: 'nice_to_have'`.
- **App target:** n/a
- **Note:** Same as above; the app's equivalent is `NTH #n`.

### Posting vs your profile
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate rename)
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:398` — the `ProfileCompare` card heading.
- **App target:** `app/src/screens/PostingAnalysis.jsx:135` — existing `ProfileCompareCard` heading "This posting, against your profile", rendered above the extraction card from `PacketBuilder.jsx:603`.
- **Note:** The comparison card exists, is fed by `req.data.comparison` (`api/src/functions/tests/appDimensions.ts` → `comparisonPayload`), and carries the scoping sentence the prototype has (`COMPARE_SCOPE_NOTE`). No work.

### Strong match
- **Class:** STRUCTURAL (ALREADY SATISFIED)
- **Prototype source:** `docs/qc-evidence/qc/data.js:583` — `FIT_LABEL.strong`, rendered in the tiles and the Fit column of `ProfileCompare` (`packet.jsx:378,403`).
- **App target:** `app/src/postingAnalysis.js:70` — existing `FIT_LABEL.strong = 'Strong match'`, rendered via `fitLabel()` in `CompareRow` (`app/src/screens/PostingAnalysis.jsx:101`).
- **Note:** Byte-identical string already in the app. Absent from the capture only because `comparisonState()` was `unresolved`, so no rows rendered. No work.

### Must-have requirements
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate rename)
- **Prototype source:** `docs/qc-evidence/qc/data.js:609` — `matchRows()` row label, rendered as a summary tile in `ProfileCompare` (`packet.jsx:377`).
- **App target:** `app/src/screens/PostingAnalysis.jsx:415` — existing `<Group title="Must-have" qc="must_have">` inside `requirementsPane`; the per-class count/coverage tile equivalent is `coverageCards()` on the QC step (`app/src/qcRail.js:576`).
- **Note:** The class exists as its own titled, counted group with a note explaining the bar. The prototype's four `matchRows()` tiles are a summary of numbers the app already prints (group counts here, closed/total on QC). No work.

### Nice-to-have requirements
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate rename)
- **Prototype source:** `docs/qc-evidence/qc/data.js:610` — `matchRows()` row label.
- **App target:** `app/src/screens/PostingAnalysis.jsx:417` — existing `<Group title="Nice-to-have" qc="nice_to_have">`.
- **Note:** As above. No work.

### No evidence
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate, documented deviation)
- **Prototype source:** `docs/qc-evidence/qc/data.js:583` — `FIT_LABEL.weak = 'No evidence'`.
- **App target:** `app/src/postingAnalysis.js:70-81` — existing `FIT_LABEL.weak_nothing_found` / `weak_falls_short` + `fitLabel(fit, shortfall)`.
- **Note:** The app deliberately splits weak into "Nothing found" and "Falls short", and the comment at `postingAnalysis.js:65-69` cites this prototype line as the thing it is departing from: the prototype's single weak fixture happens to be a true absence, so "No evidence" would be a false statement whenever the profile speaks to the axis but falls short. Keep the app's split.

### ATS keywords
- **Class:** STRUCTURAL (ALREADY SATISFIED — deliberate rename)
- **Prototype source:** `docs/qc-evidence/qc/data.js:613` (`matchRows()` keyword row) and `packet.jsx:311,337` (`TABS[2].l`, `Head l="ATS keywords"`).
- **App target:** `app/src/screens/PostingAnalysis.jsx:406` — existing `TABS[2] = { key: 'keywords', label: 'Keywords' }`, with the ATS-named surface kept where it belongs: `KeywordLibraryState` under "Coverage against the ATS term library" (`PostingAnalysis.jsx:582`).
- **Note:** The P5.4 naming rule at the head of `PostingAnalysis.jsx` (L10-13) reserves "ATS" for the term library and its coverage, so a model-produced keyword tab may not carry it. Deliberate; do not revert.

### Moderate match
- **Class:** STRUCTURAL (ALREADY SATISFIED)
- **Prototype source:** `docs/qc-evidence/qc/data.js:583` — `FIT_LABEL.moderate`.
- **App target:** `app/src/postingAnalysis.js:72` — existing `FIT_LABEL.moderate = 'Moderate match'`.
- **Note:** Byte-identical string already in the app; suppressed in the capture by the unresolved comparison. No work.

### Dimension
- **Class:** STRUCTURAL (ALREADY SATISFIED)
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:394` — the comparison table's first column heading.
- **App target:** `app/src/postingAnalysis.js:150` — existing `COMPARE_COLUMNS[0]`, rendered by `ProfileCompareCard` at `app/src/screens/PostingAnalysis.jsx:187-189`.
- **Note:** The four headings are exported as one constant precisely so a test can assert they are the spec's. The whole header row is inside the `rows.length > 0` branch, so an unresolved comparison hides it. No work.

### The posting asks for
- **Class:** STRUCTURAL (ALREADY SATISFIED)
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:395`.
- **App target:** `app/src/postingAnalysis.js:150` — existing `COMPARE_COLUMNS[1]`.
- **Note:** Same constant as "Dimension". No work.

### Your profile evidences
- **Class:** STRUCTURAL (ALREADY SATISFIED)
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:395`.
- **App target:** `app/src/postingAnalysis.js:150` — existing `COMPARE_COLUMNS[2]`.
- **Note:** Same constant. The app's cell additionally names the provenance of the profile side ("From your profile facts: …"), which the prototype does not. No work.

### Leadership tenure
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:587` — `PROFILE_COMPARE[0].l`.
- **App target:** n/a
- **Note:** One row of the hand-written SafetyIQ comparison fixture. The app's dimension rows come from the owner's dimension set (`comparison.set`, `api/src/functions/tests/appDimensions.ts`), and the card even says whether that set is the owner's or a seeded one — so the row LABELS are owner data, not app constants.

### Organization size
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:588` — `PROFILE_COMPARE[1].l`.
- **App target:** n/a
- **Note:** As above.

### Budget owned
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:589` — `PROFILE_COMPARE[2].l`.
- **App target:** n/a
- **Note:** As above.

### Compliance ownership
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:590` — `PROFILE_COMPARE[3].l`.
- **App target:** n/a
- **Note:** As above.

### Platform modernization
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:591` — `PROFILE_COMPARE[4].l` (also `REQUIREMENTS.M3.competency`, `data.js:51`).
- **App target:** n/a
- **Note:** As above.

### Cycle time, regulated
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:592` — `PROFILE_COMPARE[5].l` (also `REQUIREMENTS.M4.competency`).
- **App target:** n/a
- **Note:** As above. Its `note` ("One programme, not a record across roles.") is the fixture's hand-written reason; the app renders the STORED reason in the same position (`CompareRow`, `PostingAnalysis.jsx:113-119`).

### Domain background
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:593` — `PROFILE_COMPARE[6].l`.
- **App target:** n/a
- **Note:** As above.

### Public sector
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:594` — `PROFILE_COMPARE[7].l`, the fixture's one `weak` row.
- **App target:** n/a
- **Note:** As above.

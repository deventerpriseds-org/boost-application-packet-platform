# Triage — `cover` (Cover letter step)

Register section: `docs/qc-evidence/UI-GAP-REGISTER.md:159-189` (23 panel strings + 3 controls).
Prototype = behavioural ground truth. Prototype files: `docs/qc-evidence/qc/{packet,assets,evidence,data}.js(x)`.
App files: `app/src/screens/PacketBuilder.jsx`, `app/src/screens/AssetBlocks.jsx`, `app/src/assetBlocks.js`, `app/src/assetGate.js`.

Rows are in register order; the three "Controls only in the prototype" are at the end.

### SafetyIQ · Head of Engineering
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:512` renders `{p.company} · {p.role}` from `PACKET` (`docs/qc-evidence/qc/data.js:23`, `{ company: 'SafetyIQ', role: 'Head of Engineering' }`); repeated in the ATS modal at `packet.jsx:294`.
- **App target:** n/a
- **Note:** The app renders the identical line at `app/src/screens/PacketBuilder.jsx:807` (`{p.company} · {p.role}`). The string differs only because the compared fixture packet is not SafetyIQ. No structural requirement.

### fail
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:520-528` — the header "Match" block prints `{PACKET_GATE}` as an uppercase pill beside the score; `PACKET_GATE` is derived at `data.js:574-577` (fails because `compact_resume` has a failing check). It is packet chrome, which is why the same string is listed under `jd`, `resume`, `portfolio` and `video` too.
- **App target:** `app/src/screens/PacketBuilder.jsx` header block (lines 799-823). Extend the EXISTING `packetGate(qcEntries)` + `railGateMeta(...)` pair already imported at line 15 and already used at line 843 for the QC step-circle tone — render its `word`/tone as a pill next to `MatchEstimateButton` instead of only tinting a circle.
- **Note:** Today the packet-level gate reaches the screen as a colour on one step circle and nowhere as a word, so a reader who is on the cover step cannot see that the packet is blocked. This is the one real header gap; it needs no new state, only a second consumer of the value already computed.

### approved
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:543` — `ARTIFACTS` entry `{ id: 'a3', type: 'cover', status: 'approved', ... }`, rendered by the `Pill` at `packet.jsx:228`.
- **App target:** n/a
- **Note:** The app renders the same status pill (`app/src/screens/PacketBuilder.jsx:107`, `<Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>`). The word differs only because the fixture artifact is not in `approved` status.

### 4 corrected
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:218` — the COLLAPSED `AssetHeader` row prints `{done.length} corrected` (also `N to fix` / `N to review` / `N your call`), from `attentionFor(type)` rows with `sev: 'fixed'`, built at `data.js:632-635` out of `MIRRORS` figure corrections.
- **App target:** `app/src/screens/AssetBlocks.jsx` — `DistributionMeter` (the "What this cover letter answers" panel), specifically the `BLOCK_HOOKS.meterSummary` line at lines 223-227. Extend the EXISTING `meterModel()` in `app/src/assetBlocks.js:351` to take the correction rows already loaded one component up by `useArtifactCorrections` (`AssetBlocks.jsx:95`, via `railChangeLog`) and emit a summary item; do not add a second corrections source.
- **Note:** The number 4 is demo, but the affordance is not: `ASSET_ANSWERS_DEFAULT_OPEN = false` (`assetBlocks.js:436`), so the collapsed row is all a user sees, and it currently never says that anything was auto-corrected in this asset. Corrections are visible only after expanding into a specific field's margin.

### Letter body
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/data.js:225` — `ASSET_DOCS.cover.sections[0].slot = 'Letter body'`, rendered as the block heading at `assets.jsx:384`.
- **App target:** `app/src/assetGate.js:166` `FIELD_LABEL['@CoverLetterBody'] = 'Letter body'`, consumed by `fieldLabel()` at `AssetBlocks.jsx:352`. ALREADY IMPLEMENTED — no work.
- **Note:** Per the brief this is not a missing string; it renders as soon as the artifact has an insertion row for `@CoverLetterBody`. The register hit is a fixture artifact (the compared app fixture had no cover insertion rows), not a code gap.

### 254 words · 250–400 words, one page
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:24-30` (`Rule`), fed by `data.js:225` `rule: '250–400 words, one page'`; the 254 is `wordCount()` over the demo `after` body at `data.js:228`, and the range is also enforced by `WORD_RULES` at `data.js:327`.
- **App target:** `app/src/screens/AssetBlocks.jsx:353-364` — the `{words} words` span plus `targetFor(row.merge_field, thresholds)` (`app/src/assetBlocks.js:466`, which maps `@CoverLetterBody -> coverWords`, default `[250,400]` at `api/src/functions/tests/checks.ts:144`). ALREADY IMPLEMENTED — no work.
- **Note:** The app prints "254 words" + "250–400 words" from the owner's threshold rather than a literal. Only the trailing prose "one page" is absent, and that is prototype copy on a demo rule string, not a measured contract — do not hardcode it.

### Keywords placed
- **Class:** BLOCKED-ON-DATA
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:436-444` — the per-field margin label `Keywords placed` with a `KeyChip` per `s.terms`, where `s.terms` are ids into `ATS_TERMS` (`data.js:80-95`) hand-attached to each section (`data.js:226` for C1).
- **App target:** n/a — `AssetBlocks.jsx:631` passes `terms={null}` into `DistributionMeter` on purpose, and `meterModel` emits `UNKNOWN_TERMS_NOTE` (`assetBlocks.js:345`) instead of a count.
- **Note:** Needs two things that do not exist app-side: published, scoreable `term_library_entry` rows (which is also why `appChecks.ts` leaves `keyword_coverage` null), and a per-field term-placement record joining a term to a merge field. Until an API returns "these terms landed in this field", any chip row here would be a browser-side keyword match — the thing `assetBlocks.js:245` explicitly refuses.

### Platform Modernization
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:80` — `ATS_TERMS` T1; reaches the cover step twice, as a `KeyChip` (`assets.jsx:440`) and highlighted inside the demo letter body (`data.js:228`, via `Marked`).
- **App target:** n/a
- **Note:** A fabricated library term from the Head of Engineering sample. It carries no heading, label or control.

### SOC 2 Type II
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:81` — `ATS_TERMS` T2, chipped and marked in the demo letter body (`data.js:228`).
- **App target:** n/a
- **Note:** Sample keyword content. Nothing structural depends on the string.

### ISO 27001
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js` `ATS_TERMS` T3 (referenced by C1's `terms` list at `data.js:226`) and the demo letter body at `data.js:228`.
- **App target:** n/a
- **Note:** Sample keyword content, same bucket as T1/T2.

### Posting lines answered
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:445-450` — margin label over one `ReqChip` per `s.reqs`; C1's `reqs` are at `data.js:226`.
- **App target:** `app/src/screens/AssetBlocks.jsx:473-482` — the `reqs.length > 0` block already prints `Posting line answered` / `Posting lines answered` over `ReqChip`s, fed by the existing `reqsForRow()` (`app/src/assetBlocks.js:247`) and `useAssetProvenance` → `api.oppRequirements`. ALREADY IMPLEMENTED — no work.
- **Note:** It renders only when an insertion row carries a `requirement_id` (or a scoped swap does). Absent from the compared run because the cover fixture had no requirement join, not because the panel is missing.

### Changes made
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:101` — `EchoTrail`'s heading over the figure corrections (`Corrected`, strike-through → fix, `Undo` / `Suggest something different`), built from `s.mirrors` (`data.js:437-445`).
- **App target:** `app/src/screens/AssetBlocks.jsx:462-471` — the same panel exists in the field margin under the heading `Corrected for you`, rendering the shared `CorrectionRow` from `./QcRail.jsx` over `correctionsForField()` (`assetBlocks.js:438`). The only delta is the heading word.
- **Note:** Lowest-value structural row on this step: the mechanism, the undo and the per-field placement all match the prototype. Note the prototype itself uses BOTH strings — `Changes made` as this heading and `Corrected for you` as `SEV_LABEL.fixed` (`data.js:638`) — so "the prototype wins" does not settle it; changing the app's wording needs an owner decision, not a defect fix.

### multiple business units
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:409` — `MIRROR_WATCH` entry `{ phrase: 'three business units', fix: 'multiple business units' }`. The `fix` string is what renders, both inside the corrected letter body and in the `EchoTrail` row.
- **App target:** n/a
- **Note:** The generalised replacement text for one fabricated posting figure. The app has the real mechanism (`correctionsState` / `CorrectionRow` / `railChangeLog`); only the phrase is sample data.

### sixty-two engineers
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:410` — `MIRROR_WATCH` `{ phrase: 'sixty engineers', fix: 'sixty-two engineers', why: 'Replaced with your own headcount from the profile (62).' }`.
- **App target:** n/a
- **Note:** Von Roberts' fabricated headcount. Carries no structural requirement beyond the corrections panel already triaged under "Changes made".

### 8-figure
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:412` — `MIRROR_WATCH` `{ phrase: '$18M', fix: '8-figure' }`, generalising the posting's own budget figure.
- **App target:** n/a
- **Note:** Sample correction output.

### a large industrial operator base
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:414` — `MIRROR_WATCH` `{ phrase: '400+ industrial operators', fix: 'a large industrial operator base' }`.
- **App target:** n/a
- **Note:** Sample correction output for the SafetyIQ posting's customer count.

### Company
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/data.js:230` — `ASSET_DOCS.cover` section C2, `slot: 'Company'`, heading rendered at `assets.jsx:384`.
- **App target:** `app/src/assetGate.js:164` `FIELD_LABEL['@Company'] = 'Company'` via `fieldLabel()` at `AssetBlocks.jsx:352`. ALREADY IMPLEMENTED — no work.
- **Note:** Per the brief, not to be re-reported as missing; it renders whenever the `@Company` insertion row exists.

### Date
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/data.js:232` — section C3, `slot: 'Date'` (`@CoverLetterDate`).
- **App target:** `app/src/assetGate.js:165` `FIELD_LABEL['@CoverLetterDate'] = 'Date'`. ALREADY IMPLEMENTED — no work.
- **Note:** Same as `Company` — fixture artifact, not a code gap.

### Letterhead, signature, layout
- **Class:** BLOCKED-ON-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:234-237` — section C4: `field: null`, `dynamic: false`, `sameAsBefore: true`, whose `after` is the slide frame (`VON ROBERTS ... {{@CoverLetterDate}} ... Hiring Committee {{@Company}} ... {{@CoverLetterBody}} ... Sincerely, Von Roberts`).
- **App target:** n/a — `AssetBlocks.jsx` renders one card per INSERTION ROW (`api.artifactInsertions` → `latestRows`), and every row is keyed by `merge_field`. A section with no merge field has no row, so no card can exist for it.
- **Note:** Structurally real and genuinely useful (it is the only place the reader sees where the three merged fields land on the page), but the app has no source for the template's static frame text. It would need the Slides/Docs template's non-merge content recorded somewhere the API can serve — e.g. a template static-block record returned alongside insertions — before any UI could show it. Do not synthesise it in the browser.

### Template · same in every packet
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:420` — the margin marker rendered when `!s.dynamic`; for cover that is section C4 only (`data.js:234`).
- **App target:** `app/src/screens/AssetBlocks.jsx:453` already renders the exact string for `shapeOf(row) === 'static'` (`app/src/assetBlocks.js:128`). ALREADY IMPLEMENTED — no work; the register's own "Closed so far" list names it.
- **Note:** On the cover step it cannot appear, because the only static section is the field-less C4 above. It will appear on a cover artifact whose `@Company`/`@CoverLetterDate`/`@CoverLetterBody` row comes back unfilled.

### M1–M5
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/assets.jsx:166-178` (`ReqLegend`), rendered at the foot of every `AssetDocView` (`assets.jsx:482`) and again under the JD parse table (`packet.jsx:163`). Counts come from `REQUIREMENTS` by kind (`data.js:48-70`).
- **App target:** `app/src/screens/AssetBlocks.jsx` — add the legend row after the `rows.map(...)` block (lines 634-649), built from the EXISTING `KIND_ABBR` / `KIND_WORD` tables in `app/src/assetBlocks.js:157-158` (already the source of truth for the `ReqChip` at `AssetBlocks.jsx:129-139`) and the requirement rows already loaded by `useAssetProvenance` → `api.oppRequirements`. Do not introduce a second kind-label table.
- **Note:** The app prints chips like `M3` with the meaning only in a `title` attribute; the prototype spells the ranges out in visible text. An id the reader cannot decode is the failure the prototype comment at `assets.jsx:149-150` names explicitly. One legend closes M/D/N together.

### D1–D4
- **Class:** STRUCTURAL
- **Prototype source:** Same `ReqLegend` (`assets.jsx:169-171`); `D` is the prototype's abbreviation for `responsibility` ("what you would do"), see `data.js:58-64` and `KIND_LABEL` at `data.js:597`.
- **App target:** Same legend, same `KIND_ABBR` in `app/src/assetBlocks.js:157`. NOTE THE CONFLICT: the app maps `responsibility -> 'R'`, the prototype uses `D`. Under the precedence rule the prototype wins, so closing this row means changing that ONE constant (and its consumers via `KIND_ABBR`), not adding a parallel map.
- **Note:** Worth flagging to the owner rather than silently flipping the letter: `R` is already rendered on live packets, and the abbreviation appears in `ReqChip` on every asset.

### N1–N3
- **Class:** STRUCTURAL
- **Prototype source:** Same `ReqLegend` (`assets.jsx:169-171`); `N` = nice-to-have (`data.js:66-70`).
- **App target:** Same as `M1–M5` — one legend component in `app/src/screens/AssetBlocks.jsx` over `KIND_ABBR`/`KIND_WORD`.
- **Note:** Not a separate piece of work; it is the third line of the one legend.

## Controls only in the prototype

### `Open Slides ↗`
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:237-241` — `ArtifactCard` renders the button only when `a.docUrl` exists; the demo cover artifact has `docUrl: 'https://docs.google.com/presentation/d/demo-cover'` (`data.js:543`), so the `/presentation/` branch picks "Open Slides ↗".
- **App target:** `app/src/screens/PacketBuilder.jsx:151-155` renders the identical `✓ Open Slides ↗` / `✓ Open Google Doc ↗` link off the same `a.docUrl.includes('/presentation/')` test. ALREADY IMPLEMENTED — no work.
- **Note:** Missing from the compared run only because the fixture cover artifact has no `docUrl`; the app shows `▦ Create Slides deck` in that state (line 176), which the prototype does not model at all.

### `Copy tracked link`
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:240` — a dead button inside the same `a.docUrl` branch.
- **App target:** `app/src/screens/PacketBuilder.jsx:156-159` — `⎘ Copy tracked link`, wired to `api.trackedLink(a.id)` via the clipboard. ALREADY IMPLEMENTED — no work, and the app's version is live where the prototype's is a stub.
- **Note:** Same `docUrl` gating as above.

### `Reopen`
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:260` — shown when `a.status === 'approved'`, which the demo cover artifact is (`data.js:543`).
- **App target:** `app/src/screens/PacketBuilder.jsx:205-207` — `<button className="px-btn" onClick={() => onSetStatus(a, 'review')}>Reopen</button>`, on the same `status === 'approved'` condition. ALREADY IMPLEMENTED — no work.
- **Note:** Absent from the compared run purely because the fixture artifact is not approved. This row is an artefact of the demo status, not a gap.

## Summary

| Class | Count |
|---|---:|
| DEMO-DATA | 9 |
| STRUCTURAL | 15 |
| BLOCKED-ON-DATA | 2 |
| **Total rows** | **26** (23 panels + 3 controls) |

Of the 15 STRUCTURAL rows, **9 are already implemented in the app** and appear in the register only because
the compared fixture lacked cover insertion rows, a `docUrl`, or an `approved` status: `Letter body`,
`Company`, `Date`, `254 words · 250–400 words, one page`, `Posting lines answered`,
`Template · same in every packet`, `Open Slides ↗`, `Copy tracked link`, `Reopen`. They need no work —
they need a better fixture.

**STRUCTURAL rows that actually need building, highest value first:**

1. **`M1–M5` / `D1–D4` / `N1–N3`** — one requirement legend at the foot of `AssetBlocks.jsx`, over the
   existing `KIND_ABBR` / `KIND_WORD`. Highest value because the app already renders undecodable ids
   (`M3`, `R1`) on every asset, and it is one component for three register rows. Surfaces the
   `responsibility -> 'R'` vs prototype `D` conflict, which needs an owner call.
2. **`fail`** — render the packet gate as a WORD in the `PacketBuilder.jsx` header, reusing
   `packetGate(qcEntries)` + `railGateMeta` already imported there. Colour-on-a-step-circle is the
   only carrier of a blocking gate today, and it is invisible from the cover step.
3. **`4 corrected`** — a corrections rollup on the COLLAPSED "What this cover letter answers" row,
   by extending `meterModel()` with the rows `useArtifactCorrections` already loads. The panel is
   collapsed by default, so silent auto-corrections are currently invisible until a field is opened.
4. **`Changes made`** — heading-wording only; the panel, the undo and the placement already match.
   Lowest value, and ambiguous (the prototype uses both wordings), so do not touch it without a decision.

**BLOCKED-ON-DATA (2):** `Keywords placed` needs published scoreable `term_library_entry` rows plus a
per-field term-placement record; `Letterhead, signature, layout` needs the template's static
(non-merge) frame text served alongside insertions. Neither may be synthesised in the browser.

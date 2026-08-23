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


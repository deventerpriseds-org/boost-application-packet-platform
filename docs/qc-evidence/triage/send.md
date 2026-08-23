# Triage — `send` (Review & send)

Register section: `docs/qc-evidence/UI-GAP-REGISTER.md:268` (`### \`send\``).
Prototype: `docs/qc-evidence/qc/packet.jsx:429-475` (the `activeStep === 'send'` block) + `docs/qc-evidence/qc/data.js`.
App: `app/src/screens/PacketBuilder.jsx:694-716` (the `activeStep === 'send'` block), `app/src/qcRail.js`, `app/src/assetGate.js`.

**What the app's send step renders today** (`PacketBuilder.jsx:694-716`), in full:
a "Review & send" heading, one row per artifact = `TYPE_LABEL[t]` + `<Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>` (line 703-704),
then either a `Go to outreach →` button or the sentence "Approve all artifacts above to unlock sending." (710-712).
There is **no gate badge and no findings list** — `GateBadge` is not imported into `PacketBuilder.jsx` at all
(`grep -n "GateBadge" app/src/screens/PacketBuilder.jsx` returns nothing).

**Key enabling fact for everything below:** the per-asset QC payload is fetched for the WHOLE screen, not
just the QC step — `PacketBuilder.jsx:273` `useQcEntries(artifactList, { withInsertions: activeStep === 'qc', ... })`.
Only the *insertions* and *remediation* extras are step-gated; `entries[].result` (gate, attention, results rows)
is live on the send step. So the send step is not data-blocked; it simply does not read what it already has.

### SafetyIQ · Head of Engineering
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:23` — `const PACKET = { company: 'SafetyIQ', role: 'Head of Engineering', ... }`, rendered by `packet.jsx:512` as `{p.company} · {p.role}` in the screen header (not by the send step itself).
- **App target:** n/a
- **Note:** The app renders the identical construct from live packet data — `PacketBuilder.jsx:807` (desktop) and `:745` (mobile), both `{p.company} · {p.role}`. The string differs only because the fixture is a different company/role. SPEC.md:379 says the prototype data is "one worked example ... not fixtures to reproduce."

### fail
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:436` — `<GateBadge type={a.type} small .../>` per artifact row, whose word comes from `gateFor()` (`data.js:548`) and is printed raw through `GATE_COLOR`/`GATE_SOFT` (`data.js:570-571`).
- **App target:** `app/src/screens/PacketBuilder.jsx:702-706` (the send-step artifact row). Extend by importing the EXISTING `GateBadge` from `app/src/screens/AssetGateDrawer.jsx:44` — already imported this way by `app/src/screens/Packets.jsx:7` — and feeding it `qcEntries.find(e => e.artifact.id === a.id).result`, which `PacketBuilder.jsx:273` already holds. No new component, no new gate derivation.
- **Note:** **Answering the specific question: it is BOTH, and the vocabulary half favours the app.** The app's send step renders NO gate word at all — `PacketBuilder.jsx:694-716` contains no `GateBadge`, no `gateMeta`, no `railGateMeta`; the only pill on that step is the artifact *status* (line 704), which is a different fact. That absence is a real gap. But the literal token `fail` must never be closed by copying it: `assetGate.js:51-58` states "Plain-language gate words (SPEC 7 bans the engine's own vocabulary as a user-facing label)" and maps `fail → 'Blocked'`, `warn → 'Needs a decision'`, `pass → 'Clear'`, with `gateMeta()` (`:59`) degrading an unknown/absent gate to `'Not checked'` rather than to a pass. `GateBadge` already prints `m.word` (`AssetGateDrawer.jsx:68`), so closing this row correctly makes the row read "Blocked · 1 to fix", never "fail".

### approved
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:543` — `ARTIFACTS` entry `a3` (`{ type: 'cover', status: 'approved' }`), printed by `packet.jsx:437` as `<Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>`.
- **App target:** n/a
- **Note:** The app renders the *same expression from the same map* on the same step — `PacketBuilder.jsx:704`, `<Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>`, with `STATUS_TONE` identical key-for-key to the prototype's (`PacketBuilder.jsx:28`, canonical copy at `assetGate.js:49`). The word is absent from the diff only because no artifact in the app fixture had status `approved`. Unlike `fail`, artifact status is not engine vocabulary, so rendering it raw is correct. (Housekeeping only, not a register row: `STATUS_TONE` is inlined in `PacketBuilder.jsx:28`, `Library.jsx:13` and `OppDetail.jsx:7` while `assetGate.js:49` exports the canonical copy — four copies of one map.)

### 1 item to fix across 1 asset
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:441-472` — the red blocking panel, headline at `:453-455` (`{fails.length} item{s} to fix across {byAsset.length} asset{s}`) built from `ATTENTION.filter(a => a.sev === 'fail')` (`data.js:622-640`), followed by "Sending stays locked until each one is fixed or the decision is recorded." (`:456`) and the `fails.length === 0` branch "Nothing blocks sending" (`:446-448`).
- **App target:** `app/src/screens/PacketBuilder.jsx:709-713` — replace the bare "Approve all artifacts above to unlock sending." sentence. Extend the EXISTING `railTotals()` (`app/src/qcRail.js:160`) and `qcStepState()` (`app/src/qcRail.js:655`); the latter is already computed on this screen as `qc` at `PacketBuilder.jsx:280` and already returns the sentence the panel needs (`'N asset(s) have blocking findings'`, `qcRail.js:668`). `railTotals(qcEntries)` gives `{ toFix, toReview, unchecked, assets }` directly.
- **Note:** The panel is real and the app is NOT data-blocked — `qcEntries` are fetched screen-wide (`PacketBuilder.jsx:273`). The *number* is demo. Two app rules must shape the closure: SPEC.md:363 "Say what a number counts. '1 to fix · 3 to review', not '4 items'" — so the app must NOT render the prototype's blended "1 item"; and `qcRail.js:145-150` `railCounts` forbids a `total`, noting the blended number "is what let a green gate render beside '1 to fix' in the reference prototype". `railTotals.unchecked` must also be surfaced (`qcRail.js:170`): the prototype's panel has no never-checked state and would show "Nothing blocks sending" for a packet nobody ran the checks on.

### ATS resume
- **Class:** APP-IS-CORRECT
- **Prototype source:** `docs/qc-evidence/qc/evidence.jsx:4` — `TYPE_LABEL_QC = { ..., compact_resume: 'ATS resume', ... }`, printed on the send step at `packet.jsx:435` and again as the fail row's asset label at `packet.jsx:460`.
- **App target:** n/a — the app's map is `ASSET_LABEL` (`app/src/assetGate.js:47`), `compact_resume: 'Compact resume'`, with `assetLabel()` (`:48`) degrading an unknown type to the opened-out type name rather than a blank.
- **Note:** A deliberate rename, and the prototype's own SPEC contradicts the prototype here: SPEC.md:366 — "Reserve 'ATS' for the keyword library and its coverage; requirements and responsibilities are posting analysis." `PacketBuilder.jsx:32-33` records the same reservation for step 1's rename. The register's own "Reading a row honestly" note (`UI-GAP-REGISTER.md`, item 2) already classifies this family of rows as renames. Do not change `ASSET_LABEL`.

### Every library keyword lands in a field
- **Class:** BLOCKED-ON-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:309` — the `CHECKS` row `{ a: 'compact_resume', key: 'ATS distribution', label: 'Every library keyword lands in a field', state: 'fail', observed: '11 of 13', offenders: ['FedRAMP — open', 'Roadmap Alignment — cut for length, not noted'] }`. It reaches the send step as `f.title` inside the fail list (`packet.jsx:462`). The `pass` twin for `resume` is `data.js:302`.
- **App target:** would be a new `check_key` in `CHECK_LABEL` (`app/src/assetGate.js:114-140`) — the right place to extend, but nothing may be added there until the server emits such a row. No `ats_distribution`/keyword-placement check exists in `api/src/functions/tests/checks.ts`.
- **Note:** This is the register's own already-declared blocker, re-surfacing on this step. `artifactScore.ts:73` records `keyword_coverage null — the term library has ZERO published entries (measured live)`, `appChecks.ts:164-170` writes that null, and `qcRail.js:272` and `assetBlocks.js:340` both restate it. The app-side data that would have to exist first: a published term library (per-term rows) plus a per-asset term-placement source saying which term landed in which merge field. Until then, rendering this check is inventing which keywords landed where.

### Control: `Open field →`
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:465` — `{f.sec ? 'Open field →' : 'Open asset →'}`, opening `setDrawer({ type: f.asset, sec: f.sec })` from a fail row.
- **App target:** `app/src/screens/PacketBuilder.jsx:709-713`, as part of the same panel as the "1 item to fix" row. The mechanism ALREADY exists and must be reused, not rebuilt: `countLink()` / `offenderLinks()` (`app/src/qcRail.js:439` / `:420`) resolve an offender to `{ artifact_id, section_id }`, and `QcRail.jsx:663` `openField` hands that to `AssetGateDrawer`. `PacketBuilder.jsx` would open the same drawer with the same pair.
- **Note:** One work item with the "1 item to fix" row — the control cannot exist without the findings list it hangs off. Reuse `countLink`'s `linkable`/`reason` contract verbatim: `qcRail.js:416-418` says an offender with no section must render inert WITH its reason, because "a count wired to a link that lands nowhere is worse than no link." That is the honest form of the prototype's `Open field →` / `Open asset →` fallback.

## Summary

| Class | Count | Rows |
|---|---:|---|
| DEMO-DATA | 2 | `SafetyIQ · Head of Engineering`, `approved` |
| STRUCTURAL | 3 | `fail`, `1 item to fix across 1 asset`, control `Open field →` |
| BLOCKED-ON-DATA | 1 | `Every library keyword lands in a field` |
| APP-IS-CORRECT | 1 | `ATS resume` |

7 register entries (6 text rows + 1 control).

### STRUCTURAL, highest value first

1. **`1 item to fix across 1 asset`** — the blocking summary panel on the send step. Highest value
   because it is the only row that changes what the reader is allowed to conclude: today the app says
   "Approve all artifacts above to unlock sending" (`PacketBuilder.jsx:712`), which names *status* as
   the only barrier and is silent about the gate that actually refuses the approval server-side
   (`approvalBlock()`, restated as `qcStepState()`, `qcRail.js:655-677`). Everything needed is already
   on the screen: `qc` at `PacketBuilder.jsx:280` and `railTotals(qcEntries)`. Render `toFix`,
   `toReview` and `unchecked` as three labelled numbers — never a blended "N items".
2. **Control `Open field →`** — ships with (1); it is the row-level deep link inside that panel, via
   the existing `countLink()` (`qcRail.js:439`) and the `AssetGateDrawer` open path. Listed second only
   because it has no meaning until the findings list from (1) exists.
3. **`fail`** — a `GateBadge` on each send-step artifact row (`PacketBuilder.jsx:702-706`), reusing
   `AssetGateDrawer.jsx:44` exactly as `Packets.jsx:7` already does. Cheapest of the three (one import
   plus one lookup into `qcEntries`) but ranked last because (1) already surfaces the packet-level
   verdict; this makes it per-asset. **Closing it must print `GATE_META`'s words** — `Blocked` /
   `Needs a decision` / `Clear` / `Not checked` (`assetGate.js:54-59`) — and never the engine token
   `fail`. If a future measurement run still reports "fail" missing after this lands, that is the
   register measuring a banned string, not a gap.

### Not to be closed

- `ATS resume` — a deliberate rename required by SPEC.md:366; the prototype violates its own copy rule.
- `Every library keyword lands in a field` — blocked until the term library is published and a
  per-asset term-placement source exists; already recorded under "Known blocked" in the register.
- `SafetyIQ · Head of Engineering`, `approved` — the app renders the identical expressions from live
  data (`PacketBuilder.jsx:807` and `:704`); only the fixture values differ.

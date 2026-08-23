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


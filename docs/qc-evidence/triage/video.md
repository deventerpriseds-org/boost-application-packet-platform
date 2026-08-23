# Triage — `video` (Intro video)

Register section: `docs/qc-evidence/UI-GAP-REGISTER.md:227` — 2 panels, 0 controls.
Prototype is behavioural ground truth. Triage was read-only against app source.

### SafetyIQ · Head of Engineering
- **Class:** DEMO-DATA
- **Prototype source:** `docs/qc-evidence/qc/data.js:23` — `const PACKET = { id: 'pk_1', company: 'SafetyIQ', role: 'Head of Engineering', ... }`, rendered by the shared packet header at `docs/qc-evidence/qc/packet.jsx:807` (`{p.company} · {p.role}`).
- **App target:** n/a — already rendered. `app/src/screens/PacketBuilder.jsx:807` (desktop header) and `:745` (mobile header) render the identical `{p.company} · {p.role}` line.
- **Note:** The app renders this exact structure; the comparator flags it only because it matches on TEXT and the app fixture packet is a different company/role than the prototype's fabricated SafetyIQ sample. Nothing to build.

### fail
- **Class:** STRUCTURAL
- **Prototype source:** `docs/qc-evidence/qc/packet.jsx:527` — the packet header badge rendering `{PACKET_GATE}`, computed at `docs/qc-evidence/qc/data.js:573-576` from `gateFor()` over resume / compact_resume / cover / portfolio. The literal word `fail` is data-dependent; the badge that names the packet-level verdict is not.
- **App target:** `app/src/screens/PacketBuilder.jsx` — extend the existing desktop header block at lines 800-822 (and the mobile header at 742-749) using the imports already present on line 15: `packetGate(qcEntries)` + `railGateMeta()` from `app/src/qcRail.js` (`RAIL_GATE_META` at `qcRail.js:109`, falling through to `GATE_META` at `app/src/assetGate.js:54`). Reuse the `Pill` already used in that header.
- **Note:** The app already computes the packet gate on this screen but consumes it as **colour only** — `PacketBuilder.jsx:843` passes `railGateMeta(...).tone` to the QC step circle and nothing renders the word. A user on the video step (or any non-QC step) has no text statement of whether the packet is blocked; that is missing regardless of which packet is loaded. **A colour-only signal is also invisible to a reader who cannot distinguish the hues** — the same objection the CorrectionRow comment already makes about pill tones.

## Summary

| Class | Count |
|---|---:|
| DEMO-DATA | 1 |
| STRUCTURAL | 1 |
| BLOCKED-ON-DATA | 0 |

**STRUCTURAL rows, highest value first:**

1. `fail` — surface the packet-level gate WORD in the packet-builder header on every step, via the
   already-imported `packetGate` + `railGateMeta` in `app/src/screens/PacketBuilder.jsx`. Low cost
   (one `Pill` in an existing header row, no new module), and it removes a colour-only signal that
   today is legible only if you open the QC step.

**Notes for the register**

- The app's wording is deliberately `Blocked` / `Needs a decision` / `Clear`
  (`assetGate.js:55-57`), not the raw token `fail` — SPEC 7 bans the engine's own vocabulary as a
  user-facing label. So closing this row will **not** make the register's text match. The row is
  retired by judgement, not by string equality, and the register must say so.
- `video` is the highest-alignment step in the module (77%, 2 panels, 0 controls). The prototype's
  video artifact carries no QC checks at all (`gateFor('video')` is `null`, no per-asset badge), so
  **both** remaining rows come from SHARED HEADER CHROME, not the video step body — the same two
  rows appear on every step until the header gate word lands.
- The app's video card is **ahead of** the prototype: `PacketBuilder.jsx:126-148` renders a real
  `<video>` player, a clone-render button, render-in-progress state and an archive control. The
  prototype's `ArtifactCard` (`packet.jsx:216-282`) only ever shows a `Generate script` button for
  `type === 'video'`. No gap to close in that direction.

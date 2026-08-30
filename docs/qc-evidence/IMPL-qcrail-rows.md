# IMPL — five prototype-parity rows on the QC rail / asset gate

**Branch:** `claude/incumbent-wins-swap` · **Started:** 2026-08-30 · written incrementally.
**Owned files:** `app/src/screens/QcRail.jsx`, `app/src/qcRail.js`, `app/src/assetGate.js`,
`app/src/screens/AssetGateDrawer.jsx`, `app/test/qcRail.test.mjs`, `app/test/assetGate.test.mjs`.
**Not mine (handoff notes only):** `PostingAnalysis.jsx`, `PacketBuilder.jsx`, `AssetBlocks.jsx`,
`assetBlocks.js`, anything under `api/`.

Baseline before any edit: `cd app && npm test` → recorded in §0.

| row | what it asks | state |
|---|---|---|
| 4.8-20 | `Undo this` on a swap row | not started |
| 4.11-7 | Keep / Revert / Re-run QC on an assistant reply | not started |
| 4.8-11 | attention ordering fail → open → warn → fixed → soft | not started |
| 4.6-8 | keyword panel action `Put back "<original>"` | not started |
| 4.4-14 | gate count deep-links `n to fix → <title>` | not started |

---

## 0. Baseline

(pending)

# IMPL — prototype-parity rows 4.4-29 and 4.9-12

**Branch:** `claude/incumbent-wins-swap` · **Started:** 2026-08-30
**Lane files (owned):** `app/src/screens/PacketBuilder.jsx`, `app/src/screens/AssetBlocks.jsx`,
`app/src/assetBlocks.js`, `app/test/assetBlocks.test.mjs`, this file.
**Not owned (handoff notes only):** `QcRail.jsx`, `qcRail.js`, `assetGate.js`,
`AssetGateDrawer.jsx`, `PostingAnalysis.jsx`, `api/**`.

**Written incrementally.** Everything above a cut is measured and citable.

## Rows in scope

| row | sweep verdict | shape of the gap |
|---|---|---|
| **4.4-29** list row `Go to field →` | PARTIAL — `[data-qc="qc-go-to-field"]` → **0 nodes** on the resume step | wiring gap on this surface; control exists at `QcRail.jsx:196/226` |
| **4.9-12** gate drawer footer `Ask for a change` | PARTIAL — drawer's control set is the 5 tabs only | third mount site for an EXISTING mechanism (`blocks-ask-change` ×9, `packet-asset-ask` ×2) |

## Progress log

- [t0] Read `RENDER-SWEEP.md` (§A rows 4.4-29 line 82, 4.9-12 line 92) and repo `CLAUDE.md`.

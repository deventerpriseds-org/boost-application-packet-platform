# AC — SPEC §4.11 Assistant Panel

**Author:** independent AC subagent (adversarial). **Date:** 2026-08-27.
**Repo:** `/home/user/boost-application-packet-platform` @ `e6e5a6a`.

**Source precedence (from `docs/qc-evidence/IMPORT-NOTE.md`), highest first:**
1. `docs/qc-evidence/Evidence Model & QC Lineage.html`
2. `docs/qc-evidence/SPEC.md` §4.11 + §5 (data contracts)
3. `docs/qc-evidence/qc/assist.jsx` (prototype, 123 lines)
4. `docs/qc-evidence/screens/44-assistant-panel.png` (render — never a source of intent)

Where sources disagree the higher one wins and the disagreement is stated explicitly.

**Owner decisions treated as CLOSED (not re-asked):**
- Scope `My profile` is **read-only / warn-only** (option (c)). No `owner_fact` write, no `MasterContext` write.
- The panel edits through the **existing `api.aiEditArtifact` only** — `H:one-edit-path` (`app/test/packetBuilder.test.mjs:167`) must keep passing.

_This file is written incrementally as the analysis proceeds; sections appear in the order they were completed._


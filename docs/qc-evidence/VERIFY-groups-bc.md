# VERIFY — Groups B & C (independent verifier)

Branch: `claude/three-small-ui-gaps` (head `67a7e6d`), main `b73f8d6`.
Verifier shares NO context with implementers. Started: (see git/timestamps below).
Everything below is observed output. Nothing is inherited from the lanes' own reports.

## Status: IN PROGRESS — appended as work proceeds

## 0. Scope of the diff — established first

```
$ git log --oneline -3
67a7e6d Group B 4.3-9/10/11: the QC summary inside the ATS modal
aa59426 Group C 4.6-10/11: the drop hatch - and it REFUTED my brief on where it writes
a8a1c40 Slides table reader: the source, now the sweep has finished with it
```

`main` = b73f8d6. **The branch contains a THIRD commit (`a8a1c40`, "Slides table reader") that is
neither Group B nor Group C.** That commit is the entire `api/` delta on the branch:

```
$ git diff --stat b73f8d6..67a7e6d -- api/
 api/src/functions/tests/diagSkillSources.ts |  41 +++++
 api/src/functions/tests/skillPool.ts        | 162 ++++++++++++++++
 api/src/functions/tests/slideTables.ts      | 117 ++++++++++++
 api/test/skillPool.test.mjs                 |  92 ++++++++++
 api/test/slideTables.test.mjs               | 111 ++++++++++++
```
```
$ git diff --stat a8a1c40..aa59426 -- api/   # Group C's own commit
(empty)
$ git diff --stat aa59426..67a7e6d -- api/   # Group B's own commit
(empty)
```

**Consequence for claim 8's `git diff --stat -- api/` is empty:** true for the two lanes' OWN
commits, FALSE for the branch vs `main`. Recorded precisely rather than as pass/fail — see the
verdict table.

Per-lane file lists (observed):
- **Group C** (`a8a1c40..aa59426`): `app/package.json`, `app/src/assetBlocks.js`,
  `app/src/screens/AssetBlocks.jsx`, `app/test/browser/keyword-tally-probe.{html,jsx}`,
  `app/test/browser/run-field-margin.mjs`, `app/test/browser/run-keyword-tally.mjs`,
  `app/test/proposedKeywords.test.mjs`, `docs/qc-evidence/BUILD-group-c.md`.
- **Group B** (`aa59426..67a7e6d`): `app/src/assetGate.js`, `app/src/postingAnalysis.js`,
  `app/src/qcRail.js`, `app/src/screens/{AssetGateDrawer,PacketBuilder,PostingAnalysis,QcRail}.jsx`,
  `app/test/{postingAnalysis,qcRail}.test.mjs`, `docs/qc-evidence/BUILD-group-b.md`,
  `scripts/render-app.mjs`.


# BUILD — GROUP B (4.3-9 / 4.3-10 / 4.3-11): QC summary inside the ATS/tally modal

Branch: `claude/three-small-ui-gaps`. Agent: Group B implementer. Started: (see git log)

**Status: IN PROGRESS — appended to as work proceeds.**

## Step 0 — orientation
- Created this file before reading anything else (per brief).

## Step 1 — what I read, and the ONE finding that changed the plan

Read: `CLAUDE.md`, `docs/qc-evidence/AC-large-medium.md` (Group B feasibility table + AC B.1-B.15 +
REGRESSION GUARD B), and the source of every surface named there.

**FINDING (0b check #3 — how many HOMES does the concept have): the compact score block ALREADY
EXISTS, and the AC did not know about it.**

The AC names `MatchTab` (`AssetGateDrawer.jsx:282-325`) as the only bar renderer. There is a
**second, and it is the compact one**: `QcRail.jsx:841-878` renders the composite headline + the
three parts + `px-bar` + the "not measured" Pill + the source prose, driven by an ALREADY-PURE,
ALREADY-TESTED model — `railHeadline(score)` (`qcRail.js:284-299`) — with hooks
`QC_HOOKS.headline` / `QC_HOOKS.component` and the shared clamp `pctWidth()` (`qcRail.js:690`).

`grep -rn "px-bar" app/src` →
```
src/theme.css:229,230           the class itself
src/screens/AssetBlocks.jsx:233 a completion meter (NOT a score part)
src/screens/QcRail.jsx:870      score part  <-- second home
src/screens/AssetGateDrawer.jsx:316 score part  <-- the home the AC names
```

Consequences for the build, all of which make it CHEAPER and more honest:
1. **The composite prose is already a pure function.** `railHeadline().why` says *"No overall number:
   a composite is only computed when all three parts exist, and N of them do not - keywords present,
   seniority fit."* — with no "below", so it is correct in a compact block too. AC B.6 needs **no new
   prose**; MatchTab's own longer sentence stays untouched (AC B.14's "MatchTab unchanged").
2. **AC B.14 becomes 3 homes -> 1**, not 2 -> 1. I extract ONE `ScoreParts` component and make
   MatchTab, QcRail AND the modal render it.
3. `QcRail.jsx:847-851` already carries AC B.8's sentence pattern ("<label> only - there is no
   packet-wide score, and averaging the assets would invent one").

**Second finding — the live data state is not the one the AC's examples assume.**
`docs/qc-evidence/fixtures.json` is real production data: **every artifact's `checks-result.score`
is `null`** (not merely `composite: null`). So today's live path is a FOURTH state — "no score row at
all" — distinct from AC B.6's `composite: null`. The model must separate them or it will print
`railHeadline(null).why` ("No overall number was stored for this run") for a resume that was never
scored, which is a different claim.

## Step 2 — the plan (branch decisions stated, per AC B.4 and the Config check)

- **AC B.4 → branch (a), with a visible deferral.** The score block does **not** print
  `keyword_coverage`. The `kw` part row renders its label and a pointer to the existing
  `KeywordLibraryState` section directly above it, with **no number and no bar**. One measurement,
  one place. `KeywordLibraryState` keeps all three of its states (REGRESSION GUARD B (2) intact).
- **Model:** new pure `qcSummaryModel(entries, { scored, scoredType })` in `app/src/qcRail.js`
  (the module that already owns every packet-level selector). It derives NO gate, NO severity and
  NO count; it reuses `railHeadline()` and passes each entry's `result` through untouched.
- **Renderer:** `ScoreParts` extracted from `MatchTab` into `AssetGateDrawer.jsx` (the file that
  already exports `GateBadge`), with a `variant` for the drawer's boxed rows and the rail's compact
  rows, an optional `hook`, and an optional `defer` map. Consumers: `MatchTab`, `QcRail.jsx`, the
  modal.
- **`GateBadge` is IMPORTED** into `PostingAnalysis.jsx` from `./AssetGateDrawer.jsx` (AC B.2).
- **The scored artifact type stays the ONE literal already at `PacketBuilder.jsx:439`** — lifted to a
  named const so there is exactly one occurrence. No second hardcoded type list (Config check).

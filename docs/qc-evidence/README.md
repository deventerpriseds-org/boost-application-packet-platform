# Packet QC & evidence layer — handoff package

Everything needed to build the QC/evidence layer for the exec pipeline packet builder.
Plain Markdown, PNG screenshots and runnable HTML/JSX — nothing here depends on a viewer.

## Read in this order

1. **`SPEC.md`** — the spec. Ground rules, information architecture, screen-by-screen behavior,
   data contracts, component map, copy rules, scope.
2. **`screens/INDEX.md`** — captions for all 47 screenshots, including every modal, drawer,
   popover and off-screen state.
3. **`BACKLOG.md`** — prioritized work with acceptance criteria (P0 wiring bugs → P8 the decisions
   from the design review).
4. **`Evidence Model & QC Lineage.html`** — data shapes, scoring weights, lineage model.
5. **`Zap 289877647 Workflow Baseline.html`** — what the pipeline does today, and its known defects.

## Running the prototype

Open `Packet QC Prototype.html` in a browser. No build, no server, no install. It loads
`app/src/theme.css` and `qc/*.jsx` from this folder (React + Babel come from unpkg, so first load
needs a network connection).

- Bottom pill: **Current app** vs **With QC layer**, and **Highlight additions** (outlines
  everything that does not exist in the app today). Both are review aids — do not build them.
- The worked example is one packet: SafetyIQ · Head of Engineering.
- Widen the window past 1440px to see the docked assistant layout.

## Files

```
SPEC.md                          the spec
BACKLOG.md                       prioritized work, acceptance criteria
screens/INDEX.md                 screenshot captions
screens/*.png                    47 captures, narrative order
Packet QC Prototype.html         runnable prototype (entry point)
qc/data.js                       all data shapes + derivations (checks, gates, corrections)
qc/shell.jsx                     app shell, step rail, prototype mode bar
qc/packet.jsx                    packet builder screen, JD analysis, artifact cards, ATS modal
qc/assets.jsx                    field blocks, provenance margin, change trail, keyword controls
qc/evidence.jsx                  QC step, attention lists, QC tabs, per-asset drawer
qc/assist.jsx                    assistant panel (docked + floating)
app/src/theme.css                tokens and utility classes the prototype uses
Evidence Model & QC Lineage.html data model reference
Zap 289877647 Workflow Baseline.html  current pipeline baseline
```

## For Claude Code

Suggested opening prompt:

> Read `SPEC.md` and `BACKLOG.md` in this folder, then implement P0 (wiring bugs) and P1.1–P1.2
> (requirement and ats_term rows). Follow the ground rules in SPEC §2 — especially R1
> (correct, then report) and R4 (one source per number). Use `screens/` for reference; the
> prototype in `Packet QC Prototype.html` is the behavioral ground truth, but it is a UI spec, not
> production code — do not port its inline styles.

The prototype's inline styles are a spec of intent, not an implementation. Values worth carrying
over verbatim: the highlight colors (keyword `#fff03a`, echo tint `#fbf2da` with `#c9b27a`
underline), the 250px provenance margin, and the breakpoints (1080 / 1200 / 1440).

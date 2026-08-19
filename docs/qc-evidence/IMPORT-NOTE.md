# Import note

This folder is the **QC & evidence layer handoff package**, delivered by the owner as
`Boost_Exec_Pipeline.zip` on 2026-08-19 and committed here verbatim so it survives session/context
loss. Nothing in it was authored in this repo.

- `SPEC.md` — the build spec. §2 (R1–R7) are ground rules that constrain every screen.
- `BACKLOG.md` — P0…P8 with the author's acceptance criteria.
- `screens/` + `screens/INDEX.md` — 47 captioned screenshots, narrative order.
- `Packet QC Prototype.html` + `qc/*.jsx` + `qc/data.js` — runnable prototype. **Behavioral ground
  truth, NOT production code.** Per its README: do not port its inline styles.
- `app/src/theme.css`, `app/src/tokens/*` — copies the prototype loads. The repo's real versions
  live at `app/src/`; these are here only so the prototype runs standalone. **Do not diff them
  against the app as if they were authoritative.**
- `Evidence Model & QC Lineage.html` — data shapes, scoring weights, lineage.
- `Zap 289877647 Workflow Baseline.html` — what the pipeline does today + known defects
  (§5 = the Q1–Q16 checks P2.1 ports; §6 = the hygiene items P7 lists).

**Values the README says to carry over verbatim:** keyword highlight `#fff03a`; posting-echo tint
`#fbf2da` with `#c9b27a` underline; 250px provenance margin; breakpoints 1080 / 1200 / 1440.

**Explicitly not to be built** (SPEC §8, §4.12): the Current-app / Highlight-additions comparison
mode, authentication, template editing, the Docs/Slides render itself, mobile below ~700px.

**Known premise error in the package** (verified against this repo 2026-08-19): `BACKLOG.md` P0.2
says `jd-analysis` "persists none of it". False — `appPackets.ts:491` persists `jd_analyzed`,
`ats_score` and `covered_kw`. Only `mustHaves` and `gaps` are discarded. See the plan file
`.claude/QC-EVIDENCE-PLAN.md` for the reconciled version of every item.

Working plan + live status: **`.claude/QC-EVIDENCE-PLAN.md`**.

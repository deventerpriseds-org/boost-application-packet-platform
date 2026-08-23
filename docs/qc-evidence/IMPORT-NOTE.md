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
- `Evidence Model & QC Lineage.html` — data shapes, scoring weights, lineage. **Updated 2026-08-23.
  Its §2/§3/§4 data-model content is current and authoritative. Its §5/§7 UI prose is NOT — see
  "Precedence" below. The PROTOTYPE outranks it on anything you can see on a screen.**
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

---

## The lineage doc is the newest artefact — it outranks the prototype and the screenshots

**Update 2026-08-23.** The owner re-supplied two HTML pages. Everything else in the package was
re-checked byte-for-byte and is **unchanged**: all 47 PNGs, all six `qc/*.jsx`, `qc/data.js`, the
four token/theme CSS files, `SPEC.md`, `BACKLOG.md`, `README.md`. Only these two moved:

| File | Change |
|---|---|
| `Packet QC Prototype.html` | 2 lines — a `color-scheme: light only` meta + style. No behaviour. |
| `Evidence Model & QC Lineage.html` | 121 lines — **first draft → as-built.** Substantive. |

The version committed on 2026-08-19 was the **first draft**: it said "Step one of two", carried
"Decision for you" open questions, listed **eight** records, and proposed a QC rail step. The
current file is the **settled, as-built** revision. What changed:

1. **The QC rail step is DROPPED.** §5a and §7 are explicit: *"New rail step at position 6 →
   **Dropped.** No QC step."* Evidence lives **in the asset, beside the line it explains**; the
   packet-level roll-up is the single **ATS Match** modal opened from the header composite. The
   per-asset right drawer is dropped with it. Rail stays `jd · resume · cover · portfolio · video · send`.
2. **A ninth record: `correction`** — `kind` (posting_figure | omit_list | markup_residue), `found`,
   `replaced_with`, `source` (posting_verbatim | profile_field | rule), `applied`, `undone_at`.
3. **A new pipeline step 2, auto-correct**, before the rules engine: hard fails with exactly one
   right answer are fixed *before display*, emitting reversible `correction` rows.
   Sequence is now generate → **auto-correct** → deterministic rules → blind reviewer → aggregate → gate.
4. **`swap_decision` gains `override_value` + `override_state`** (suggested | reverted | custom).
   §5c: the ⇄ control exchanges the two sides, and the *ships* value is text-editable so the user can
   type a third option. Nothing is applied silently; a reverted suggestion stays auditable.
5. **Two open questions settled:** a `warn` does **not** block approval (it needs a recorded
   override naming who and why); weights **50 / 30 / 20**, bands **85 / 70**, ATS-compact resume
   scored separately.
6. **Ordering rule:** QC leads with **"Done for you"** (corrections already applied) *before*
   **"Needs a decision"**. The flat Q1–Q16 list is a detail view inside the second group, never the
   top level.

### Precedence — the lineage doc contradicts its own prototype, and LOSES

**§5a and §7 of the lineage doc are wrong about the built UI. Do not act on them.**

They assert *"No QC rail step … New rail step at position 6 → **Dropped.**"*, and claim that
sections marked `as built` match `Packet QC Prototype.html`. They do not. The prototype **contains
the QC step**, and this was confirmed by EXECUTION, not by reading:

> The prototype was rendered headless (Chromium, `qc/*.jsx` served over HTTP so Babel can fetch
> them; React/ReactDOM/Babel taken from the published artifact bundle so no network is needed).
> Rendered rail: `JD analysis · 2 Resume · ✓ Cover letter · 4 Portfolio · 5 Intro video ·
> **6 QC & evidence** · 7 Review & send`. The step renders "Done for you" (15 corrections applied)
> and "Needs a decision" (9 left) **inside the step**, with tabs Coverage · Swaps · Passes ·
> Checks · Review — i.e. exactly what §5b attributes to a modal instead.

Three independent sources agree with each other and against the prose: the prototype as executed,
the 47 screenshots (`INDEX.md` 28–36 caption the QC step; 39–43 the drawer), and the owner viewing
the published prototype directly.

> **Rule: the PROTOTYPE is the behavioural ground truth for anything on a screen** — the package
> README says so explicitly. Where the lineage doc's §5/§7 prose disagrees with the prototype, the
> **prototype wins**. The doc's §2 (records), §3 (gate sequence) and §4 (score) remain authoritative
> — they describe data, not layout, and the prototype corroborates them.

**The QC rail step STAYS.** `app/src/screens/PacketBuilder.jsx:42` is correct and must not be removed.

*(Recorded because a session read §5a/§7 as settled fact and told the owner the step was dropped.
The owner corrected it from the rendered prototype. The guard is the render command above — run it
before making any claim about what a screen shows.)*

### How to render the prototype locally (no network, no live app)

```bash
# React/ReactDOM/Babel are embedded in the published artifact bundle; extract once, then:
python3 -m http.server 8899 --directory <proto-dir>   # Babel cannot XHR .jsx over file://
# then drive http://localhost:8899/index.html with playwright-core +
# /opt/pw-browsers/chromium-1194/chrome-linux/chrome
```
This is the only way to compare a screen against the design from inside the sandbox — the live app
is behind blocked egress, and `ui-verify.yml` reaches the live app but not the prototype.

### Divergences between the design and what is built (verified 2026-08-23)

| Design | This repo has | Status |
|---|---|---|
| QC rail step at position 6 (prototype, screens 28–36) | `PacketBuilder.jsx:42` | **Correct — keep.** |
| `correction` record (§2) | `schema.ts:370` | Built, matches. |
| Header shows an **auditable** composite + gate verdict (`ATS MATCH 92%`, `MATCH 95 FAIL`) | Live app renders `MATCH ESTIMATE — model estimate` | **Diverges.** No auditable composite, no gate verdict in the header. |
| `swap_decision.override_value` / `override_state` (§2, §5c) | Absent from `api/src` and `app/src` | **Not built.** The ⇄ swap-back and editable *ships* value. |
| "Done for you" group, ordered before "Needs a decision" | "Needs a decision" exists (`assetGate.js`); the "Done for you" grouping does not | **Partial.** |

The last two are the spec basis for the owner's *"put back the item it displaced"* complaint and for
defect-register items **C1 + C3**; `BACKLOG.md` P8.6 asks for the same control.

---

Working plan + live status: **`.claude/QC-EVIDENCE-PLAN.md`**.
